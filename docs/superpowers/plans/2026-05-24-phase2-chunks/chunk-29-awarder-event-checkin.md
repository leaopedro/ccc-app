# Chunk 29 — Hook awarder into event check-in (+10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside the existing check-in transaction in `apps/api/src/services/tickets/check-in.ts`, fire `awardXp(tx, garageId, 'event_checkin', { sourceRef: 'event:<eventId>' })` immediately after the Phase 1 `awardBadge` loop so a successful check-in writes `+10` XP atomically with the ticket flip.

**Architecture:** No new files in `src/`. The awarder splice is a 3-line addition inside the already-existing `prisma.$transaction` callback in `check-in.ts`. Per canon §5, `awardXp` silently no-ops on killswitch off and P2002 duplicates (returns `{ awarded: false, reason }`) but rethrows any other error. The call site does NOT wrap `awardXp` in a `try/catch` — unexpected errors must propagate so the parent transaction rolls back atomically with the ticket flip. This differs from the Phase 1 `awardBadge` swallow pattern: badges can fail open (the scan still admits), but XP atomicity is load-bearing for the same-tx contract in §288, so a thrown awarder error MUST abort the parent.

**Tech Stack:** Fastify + Prisma 5 + Postgres 16. Vitest + testcontainers-Postgres (per `apps/api/test/global-setup.ts`). pnpm workspaces (`@ccc/api`, `@ccc/db`).

---

## Scope

In-scope (this chunk only):

- `apps/api/src/services/tickets/check-in.ts` — splice `awardXp` into the existing `prisma.$transaction` block alongside the Phase 1 `awardBadge` loop.
- `apps/api/test/garage/xp-event-checkin.test.ts` — five integration tests against a real Postgres container.

Out-of-scope (later chunks; do NOT touch):

- The awarder service body itself (`apps/api/src/services/garage/xp-awarder.ts`) — chunk 27 owns it.
- Other write-path hooks: car create (chunk 30), feed post create (chunk 31), likes (chunk 32), badge-award (chunk 33), premium activation (chunk 34).
- Shared zod, route payload wiring, UI — chunks 24/25/26/28 + Phase 2C.
- `GeneralSettings` killswitch implementation — already on `main` from Phase 1 chunk 16; chunk 27 reads it.

## Branch safety preflight (per CLAUDE.md)

```bash
git branch --show-current
# If output is `production` → STOP.
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-29
```

Never branch from `production`. Never commit on `production`. PRs target `main`.

---

## Required reading (engineer reads these BEFORE coding)

1. `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` §437 (XP-awarder rules canonical table — the `event_checkin` row).
2. Same doc §25 "Locked invariants" #3 — XP cannot be purchased; the `event_checkin` path is the canonical +10 source for attendance.
3. Same doc §288 (Phase 2B "Risk" block) — awarder lives in the same tx as the parent write so a parent rollback aborts the XP write atomically. Per canon §5 the awarder rethrows any non-`P2002` error, and the call site does NOT swallow it.
4. Same doc §C1 — DB-enforced uniqueness `@@unique([garageId, reason, sourceRef])` on `XpEvent`. Our idempotency triple is `(garageId, 'event_checkin', 'event:<eventId>')` per §441.
5. Same doc §C5 — sync killswitch read inside `awardXp`. No TTL cache. Our call site does NOT read the killswitch; we just call the awarder.
6. `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §246–§261 (Chunk 29 entry).
7. Chunk 27 plan (sibling file in this dir; lands first) — gives the `awardXp` signature this chunk consumes. The canonical positional signature is `awardXp(tx, garageId, reason, opts)` per canon §4.
8. `apps/api/src/services/tickets/check-in.ts` — current state. Especially the `prisma.$transaction(async (tx) => …)` block at lines 78–106 + the `awardBadge` loop at lines 95–103.
9. `apps/api/test/garage/badges-write-hooks.test.ts` lines 113–150 — the existing "check-in awards badges in the same tx" test. We mirror its setup verbatim.
10. `CLAUDE.md` — branch rules, no full test suite locally, touched-paths only.
11. `/tmp/phase2-fix-canon.md` (canon) — §4 (signature), §5 (error contract), §11 (test filename).

---

## Corrections that apply

Pulled forward from `2026-05-21-garage-progression-phase2-xp.md` §"Corrections applied 2026-05-21 post-review" plus the cross-chunk canon in `/tmp/phase2-fix-canon.md`:

- **§C1** — Idempotency is enforced at the DB layer via `@@unique([garageId, reason, sourceRef])` on `XpEvent`. The awarder (chunk 27) catches `P2002` and returns `{ awarded: false, reason: 'duplicate' }` silently. This chunk's idempotency triple is `(garageId, 'event_checkin', 'event:<eventId>')` per §441. **No pre-check at the call site** — we just call the awarder once per successful flip.
- **§C5** — `readGamificationEnabled` is a sync read inside the awarder, not at our call site. Our call site stays ignorant of killswitch state. On killswitch off the awarder returns `{ awarded: false, reason: 'gamification_disabled' }` and writes nothing.
- **Canon §4 (positional 4-arg)** — The canonical `awardXp` signature is `awardXp(tx, garageId, reason, opts)`. This chunk uses that exact shape: `awardXp(tx, garage.id, 'event_checkin', { sourceRef: 'event:<eventId>' })`. Chunk 27 is being aligned to this signature; this chunk does not deviate.
- **Canon §5 (error contract)** — `awardXp` rethrows any error that is NOT a `P2002` or killswitch no-op. Callers MUST NOT wrap `awardXp` in `try/catch` inside their parent transaction — they let unexpected errors propagate so the parent tx rolls back atomically. This chunk follows §5: the call site is unwrapped. This explicitly overrides the Phase 1 badge swallow pattern referenced earlier in this file; the badge loop intentionally fails open, but XP must fail closed to preserve same-tx atomicity.
- **Canon §11 (test filenames)** — The test file is `apps/api/test/garage/xp-event-checkin.test.ts`. Skeleton-canonical name.

Outline lines that are STALE but do NOT affect this chunk's deliverable:

- §458 ("Cached for 30 seconds") — superseded by §C5. Doesn't touch this chunk; we don't call the killswitch directly.
- §454 ("application-layer pre-check") — superseded by §C1 (DB unique + P2002 catch). Doesn't touch this chunk.
- Earlier draft of this chunk wrapped `awardXp` in a defensive `try/catch` mirroring the badge loop. Superseded by canon §5 — removed.

---

## File Structure

```
apps/api/src/services/tickets/check-in.ts       (modify — 3-line splice + 1 import)
apps/api/test/garage/xp-event-checkin.test.ts   (new — 5 tests, real Postgres)
```

That's it. No new exports, no new types, no shared package changes.

---

## Code shape (target end-state)

The splice lands inside the existing `prisma.$transaction(async (tx) => { ... })` block in `check-in.ts`, immediately after the `awardBadge` loop closes (current line 103). The existing badge loop already lives inside the `if (garage) { ... }` guard — we reuse the same `garage.id` to avoid a duplicate `findUnique`.

Target lines 94–104 after the splice (additions marked with `+`, existing context shown for orientation only — DO NOT delete the badge loop):

```ts
if (garage) {
  const codes = await checkEventEligibility(tx, ticket.userId, ticketId);
  for (const code of codes) {
    try {
      await awardBadge(tx, garage.id, code, `check_in:${ticketId}`);
    } catch {
      // Swallow — badge grant must never block a check-in.
    }
  }
+
+  // XP: +10 for the event_checkin reason. Idempotency triple
+  // `(garageId, 'event_checkin', 'event:<eventId>')` is DB-enforced via
+  // @@unique on XpEvent (§C1). Per canon §5 the awarder silently no-ops
+  // on killswitch off + P2002 duplicates and RETHROWS any other error
+  // — we deliberately do NOT wrap this call in try/catch so the parent
+  // tx rolls back atomically with the ticket flip (same-tx contract
+  // from §288). This is the inverse of the badge swallow above:
+  // badges fail open, XP fails closed.
+  await awardXp(tx, garage.id, 'event_checkin', {
+    sourceRef: `event:${input.eventId}`,
+  });
}
```

And the new import near the top of the file (next to the existing `awardBadge` import):

```ts
import { awardBadge } from '../garage/awarder.js';
import { awardXp } from '../garage/xp-awarder.js';
```

That's the entire production diff.

---

## Task 1 — Write the failing tests (TDD)

**Files:**

- Create: `apps/api/test/garage/xp-event-checkin.test.ts`

The five tests cover: (1) happy path (+10 row + Garage.xp), (2) idempotent replay (no double-award), (3) killswitch off (no row, parent succeeds), (4) awarder throw aborts the parent — ticket NOT flipped, no XpEvent row, (5) parent route rollback proves the hook is inside the check-in tx.

Per canon §5 the awarder rethrows unexpected errors and the call site does NOT swallow them. Tests 4 and 5 are the load-bearing ones: they fail if the hook is moved outside the check-in tx, or wrapped in a `try/catch`.

Every test that asserts the hook fired also spies on the awarder module so the test physically proves `checkInTicket` is the call path — not just that an XpEvent row appeared.

- [ ] **Step 1.1: Create the test file**

Mirror `apps/api/test/garage/badges-write-hooks.test.ts` lines 113–150 for setup (event + tier + ticket + `signTicketCode` + `checkInTicket`). The `seedTicket` helper from `apps/api/test/tickets/check-in.test.ts` lines 17–57 is reusable inline.

```ts
import { prisma } from '@ccc/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as xpAwarder from '../../src/services/garage/xp-awarder.js';
import { checkInTicket } from '../../src/services/tickets/check-in.js';
import { signTicketCode } from '../../src/services/tickets/codes.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedEventTicket = async (email: string) => {
  const { user } = await createUser({ email, verified: true });
  const event = await prisma.event.create({
    data: {
      slug: `xp-evt-${Math.random().toString(36).slice(2, 8)}`,
      title: 'XP Test Event',
      description: 'd',
      startsAt: new Date(Date.now() + 3600_000),
      endsAt: new Date(Date.now() + 7200_000),
      venueName: 'V',
      venueAddress: 'A',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      publishedAt: new Date(),
      capacity: 10,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'GA',
      priceCents: 0,
      currency: 'BRL',
      quantityTotal: 10,
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      status: 'valid',
      source: 'purchase',
    },
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return { user, event, tier, ticket, garage, code: signTicketCode(ticket.id, env) };
};

describe('check-in fires awardXp for event_checkin (+10)', () => {
  beforeEach(async () => {
    await resetDatabase();
    // Killswitch on by default for these tests.
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: true },
      update: { gamificationEnabled: true },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successful check-in writes one XpEvent (+10) + Garage.xp += 10 in same tx', async () => {
    const { event, garage, code } = await seedEventTicket('xp-checkin-ok@jdm.test');

    // Spy on the awarder so we can physically prove `checkInTicket`
    // is the call path — not just that an XpEvent row materialised.
    const spy = vi.spyOn(xpAwarder, 'awardXp');

    const outcome = await checkInTicket({ code, eventId: event.id }, env);
    expect(outcome.kind).toBe('admitted');

    // awardXp invoked exactly once with the canon §4 positional shape.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.anything(), // tx client
      garage.id,
      'event_checkin',
      expect.objectContaining({ sourceRef: `event:${event.id}` }),
    );

    const rows = await prisma.xpEvent.findMany({
      where: { garageId: garage.id, reason: 'event_checkin' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delta: 10,
      sourceRef: `event:${event.id}`,
    });

    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(10);
  });

  it('replay (already_used) on the same event is idempotent — only one +10 row + xp stays 10', async () => {
    const { event, garage, code } = await seedEventTicket('xp-checkin-replay@jdm.test');

    const first = await checkInTicket({ code, eventId: event.id }, env);
    expect(first.kind).toBe('admitted');

    // Second call re-uses the same code. The flip's `updateMany` matches
    // zero rows (already `used`) so the route returns already_used.
    // The awarder branch sits inside the `if (garage)` arm after the
    // flip, and the flip's pre-conditions (status === 'valid') gate the
    // whole arm — so the awarder is not called again on replay. Even if
    // a regression caused a second call, §C1's DB unique on
    // (garageId, reason, sourceRef) would surface P2002 and the awarder
    // would return `{ awarded: false, reason: 'duplicate' }` silently.
    const second = await checkInTicket({ code, eventId: event.id }, env);
    expect(second.kind).toBe('already_used');

    const rows = await prisma.xpEvent.findMany({
      where: { garageId: garage.id, reason: 'event_checkin' },
    });
    expect(rows).toHaveLength(1);

    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(10);
  });

  it('killswitch off: check-in still succeeds, but no XpEvent row is written', async () => {
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { event, garage, code, ticket } = await seedEventTicket('xp-checkin-off@jdm.test');

    // Spy proves the hook is still wired even when the killswitch is off
    // — the awarder is called from `checkInTicket`, then internally
    // returns `{ awarded: false, reason: 'gamification_disabled' }`.
    // Without this assertion the test would also pass if the hook were
    // simply absent, which is what we want to rule out.
    const spy = vi.spyOn(xpAwarder, 'awardXp');

    const outcome = await checkInTicket({ code, eventId: event.id }, env);
    expect(outcome.kind).toBe('admitted');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      garage.id,
      'event_checkin',
      expect.objectContaining({ sourceRef: `event:${event.id}` }),
    );

    // Ticket actually flipped.
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(t.status).toBe('used');

    // No XP row, garage.xp untouched.
    const rows = await prisma.xpEvent.findMany({ where: { garageId: garage.id } });
    expect(rows).toHaveLength(0);

    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(0);
  });

  it('awardXp non-P2002 throw aborts the parent check-in tx (ticket NOT flipped, no XpEvent row)', async () => {
    const { event, garage, code, ticket } = await seedEventTicket('xp-checkin-throw@jdm.test');

    // Force awardXp to throw a non-P2002 error. Per canon §5 the
    // call site does NOT wrap awardXp in try/catch, so the throw
    // propagates and the `prisma.$transaction` callback in
    // `check-in.ts` aborts — ticket stays `valid`, no XpEvent row,
    // garage.xp untouched.
    //
    // This test FAILS if check-in.ts ever wraps the awardXp call
    // in a try/catch (which would let the parent tx commit and
    // flip the ticket to `used`).
    vi.spyOn(xpAwarder, 'awardXp').mockRejectedValue(new Error('boom — simulated awarder failure'));

    await expect(checkInTicket({ code, eventId: event.id }, env)).rejects.toThrow(
      /boom — simulated awarder failure/,
    );

    // Parent rolled back: ticket still valid (not used).
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(t.status).toBe('valid');
    expect(t.usedAt).toBeNull();

    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(0);

    const rows = await prisma.xpEvent.findMany({ where: { garageId: garage.id } });
    expect(rows).toHaveLength(0);
  });

  it('parent tx rollback proves the awardXp hook lives inside the check-in tx', async () => {
    const { event, garage, code, ticket } = await seedEventTicket('xp-checkin-rollback@jdm.test');

    // Drive the public `checkInTicket` API end-to-end. We force the
    // parent tx to abort AFTER awardXp has already written its row,
    // by spying on `awardXp` to call through and then throwing
    // synchronously from a post-hook step. We achieve this by
    // wrapping `awardXp` to delegate to the real impl, then having
    // it throw on the SAME call — i.e., it writes the XpEvent row
    // (the row materialises inside the tx) and then re-raises.
    //
    // Per canon §5 the throw propagates out of `check-in.ts` and
    // the parent `prisma.$transaction` rolls back. Because awardXp's
    // write is inside that same tx, the XpEvent row is gone.
    //
    // This test FAILS if the hook is moved outside the check-in tx
    // (e.g., to after `$transaction` commits), because then the
    // XpEvent row would survive after the parent rollback.
    const realAwardXp = xpAwarder.awardXp;
    vi.spyOn(xpAwarder, 'awardXp').mockImplementation(async (tx, garageId, reason, opts) => {
      // Call through — writes XpEvent + bumps Garage.xp inside the tx.
      const out = await realAwardXp(tx, garageId, reason, opts);
      // Now force the parent tx to abort.
      throw new Error('forced rollback after real awardXp write');
    });

    await expect(checkInTicket({ code, eventId: event.id }, env)).rejects.toThrow(
      /forced rollback after real awardXp write/,
    );

    // Ticket flip rolled back — parent tx aborted.
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(t.status).toBe('valid');
    expect(t.usedAt).toBeNull();

    // XpEvent row rolled back — proves awardXp ran inside the parent tx,
    // not in a separate connection or after commit.
    const rows = await prisma.xpEvent.findMany({ where: { garageId: garage.id } });
    expect(rows).toHaveLength(0);

    // Garage counter untouched.
    const after = await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } });
    expect(after.xp).toBe(0);
  });
});
```

Engineer notes:

- The awarder-throw test (4) and rollback test (5) are load-bearing: they fail if `check-in.ts` ever wraps `awardXp` in a `try/catch` or moves the hook outside the parent `$transaction`. That is the same-tx atomicity guarantee canon §5 enforces.
- Tests 1 + 3 spy on the awarder module so they fail if the hook is removed entirely — without those assertions, test 3 (killswitch off) could pass with no hook at all (which is the original review finding #3).
- The rollback test (5) drives the real `checkInTicket` route via spy-through, not a manual `$transaction`. Spying on the awarder module to delegate-then-throw is the deterministic way to assert "the row was written inside the parent tx and is now gone".

- [ ] **Step 1.2: Run the tests to verify they fail**

```bash
pnpm --filter @ccc/api exec vitest run test/garage/xp-event-checkin.test.ts
```

Expected before the splice lands (i.e., chunk 27 merged but the import + call in `check-in.ts` not yet added):

- **Test 1 (happy path)** — FAILS. `awardXp` spy never invoked; no XpEvent row.
- **Test 2 (idempotent replay)** — FAILS. No row written on the first call; `rows.length === 0` instead of 1.
- **Test 3 (killswitch off)** — FAILS on the spy assertion (`expect(spy).toHaveBeenCalledTimes(1)`). Without the spy assertion the test would falsely pass with no hook at all — that is the bug we are guarding against.
- **Test 4 (awarder throw aborts parent)** — FAILS. Without the hook, `awardXp` is never called, so `checkInTicket` does not throw and the ticket flips to `used`. The `rejects.toThrow` assertion fires.
- **Test 5 (rollback proves same-tx)** — FAILS for the same reason as test 4: the mock's "delegate then throw" branch is never reached.

Block this chunk on chunk 27's merge per skeleton §202 ("Reads from: chunk 27") — the `xpAwarder` module import resolves only after chunk 27 lands.

- [ ] **Step 1.3: Commit the failing tests**

```bash
git add apps/api/test/garage/xp-event-checkin.test.ts
git commit -m "test(api): failing integration tests for event_checkin xp hook

Chunk 29 of Phase 2B. Covers happy path (+10), idempotent replay,
killswitch off, awarder non-P2002 throw aborts parent, parent tx
rollback via real checkInTicket path (canon §5 same-tx atomicity)."
```

---

## Task 2 — Splice `awardXp` into the check-in tx

**Files:**

- Modify: `apps/api/src/services/tickets/check-in.ts:4` (import) and `:103` (call site).

- [ ] **Step 2.1: Add the `awardXp` import**

Edit `apps/api/src/services/tickets/check-in.ts` near the existing `awardBadge` import:

```ts
import { awardBadge } from '../garage/awarder.js';
import { awardXp } from '../garage/xp-awarder.js';
```

- [ ] **Step 2.2: Add the `awardXp` call inside the existing tx**

Edit `apps/api/src/services/tickets/check-in.ts` immediately after the `for (const code of codes)` loop closes (current line 103), still inside the `if (garage) { ... }` guard:

```ts
await awardXp(tx, garage.id, 'event_checkin', {
  sourceRef: `event:${input.eventId}`,
});
```

No surrounding `try/catch`. Per canon §5 the awarder silently no-ops on killswitch off + P2002 duplicates and rethrows any other error — letting it propagate is intentional, so the parent `prisma.$transaction` rolls back atomically with the ticket flip.

Idempotency triple: `(garage.id, 'event_checkin', 'event:<eventId>')` per §441. The DB `@@unique` on `XpEvent` (§C1) catches re-insertion and the awarder returns `{ awarded: false, reason: 'duplicate' }` silently — no exception at this site even on replay.

- [ ] **Step 2.3: Run the targeted tests**

```bash
pnpm --filter @ccc/api exec vitest run test/garage/xp-event-checkin.test.ts
```

Expected: all five PASS.

- [ ] **Step 2.4: Run typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: no errors. The new import resolves because chunk 27 already exports `awardXp` from `apps/api/src/services/garage/xp-awarder.ts`.

- [ ] **Step 2.5: Re-run the Phase 1 badge regression + check-in route tests**

```bash
pnpm --filter @ccc/api exec vitest run test/garage/badges-write-hooks.test.ts
pnpm --filter @ccc/api exec vitest run test/tickets/check-in.test.ts
```

Expected: the existing "check-in awards EVT-001 + JDM-001 + JDM-002 in the same tx" test (lines 113–150 of `badges-write-hooks.test.ts`) still passes. The XP splice MUST NOT regress the badge loop. The check-in route tests still pass with the new throw-on-awarder-failure semantics — no existing test forces an awarder failure path.

- [ ] **Step 2.6: Commit the production change**

```bash
git add apps/api/src/services/tickets/check-in.ts
git commit -m "feat(api): hook awardXp into event check-in (+10)

Chunk 29 of Phase 2B. Splices awardXp into the existing
check-in transaction immediately after the awardBadge loop.
Idempotency triple (garageId, 'event_checkin', 'event:<eventId>')
is DB-enforced via @@unique on XpEvent (§C1).

No call-site try/catch: per canon §5 the awarder silently
no-ops on killswitch + P2002 and rethrows any other error so
the parent tx rolls back atomically with the ticket flip.

Refs: outline §437, §C1, §C5; canon §4 (signature), §5 (error
contract), §11 (test filename)."
```

---

## Verification — run before pushing the PR

```bash
# Touched-paths only per CLAUDE.md "never run full test suite locally".
# Canon §10: package-root-relative paths via `exec vitest run`.
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api exec vitest run test/garage/xp-event-checkin.test.ts
pnpm --filter @ccc/api exec vitest run test/garage/badges-write-hooks.test.ts
pnpm --filter @ccc/api exec vitest run test/tickets/check-in.test.ts
pnpm --filter @ccc/api exec eslint src/services/tickets/check-in.ts test/garage/xp-event-checkin.test.ts
```

Trust main CI + PR CI for the full sweep.

---

## Task 3 — Open the PR

- [ ] **Step 3.1: Push the branch**

```bash
git push -u origin feat/jdma-garage-phase2-29
```

- [ ] **Step 3.2: Open the PR against `main`**

PR title: `feat(api): hook awardXp into event check-in (chunk 29)`

PR body sections (use this exact structure):

```markdown
## Summary

Phase 2B chunk 29. Hooks the XP awarder into the existing check-in
transaction in `apps/api/src/services/tickets/check-in.ts` so a
successful ticket flip writes `+10` XP atomically with the badge
loop and the ticket status update.

- Same-tx splice: `awardXp(tx, garage.id, 'event_checkin', { sourceRef: 'event:<eventId>' })` immediately after the Phase 1 `awardBadge` loop.
- Idempotency: DB-enforced via `@@unique([garageId, reason, sourceRef])` on `XpEvent` (§C1). The triple is `(garageId, 'event_checkin', 'event:<eventId>')` per §441.
- Killswitch: read inside the awarder (§C5). Call site stays ignorant.
- No call-site `try/catch`: per canon §5 the awarder rethrows non-`P2002` / non-killswitch errors so the parent tx rolls back atomically. XP fails closed; badges (which already swallow) fail open.

## Spec references

- `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` §437 (canonical rules table — `event_checkin` row), §25 #3 (invariants — XP cannot be purchased), §288 (Risk: same-tx splice).
- §C1 (DB-enforced uniqueness on `XpEvent`), §C5 (sync killswitch read).
- `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §246 (Chunk 29 entry).
- `/tmp/phase2-fix-canon.md` §4 (positional signature), §5 (error contract — no call-site catch), §11 (test filename `xp-event-checkin.test.ts`).

## Test plan

- [x] `awardXp` fires +10 on successful check-in, spy proves invocation from `checkInTicket`
- [x] Replay on the same event is idempotent — only one row, xp stays 10
- [x] Killswitch off: check-in still admits, no XpEvent row, spy still proves the hook is wired
- [x] Awarder non-P2002 throw aborts the parent: ticket stays `valid`, no XpEvent row (canon §5)
- [x] Parent tx rollback via real `checkInTicket` path: awardXp writes inside tx then we throw — row is gone
- [x] Phase 1 `badges-write-hooks` "check-in awards EVT-001 + JDM-001 + JDM-002" regression still passes
- [x] Existing `check-in.test.ts` route suite still passes
- [x] `pnpm --filter @ccc/api typecheck` clean

## Reviewer checklist

- [ ] `awardXp` is called from inside the existing `prisma.$transaction` block — NOT after it commits.
- [ ] The call site uses `garage.id` (already looked up at line 89), not a duplicate `findUnique`.
- [ ] NO `try/catch` around the `awardXp` call — canon §5.
- [ ] Positional 4-arg signature `awardXp(tx, garage.id, 'event_checkin', { sourceRef })` — canon §4.
- [ ] No new exports from `check-in.ts`.
- [ ] No new files in `src/` (only the test file is new, named `xp-event-checkin.test.ts` per canon §11).
- [ ] No killswitch read at the call site — it lives in the awarder per §C5.
- [ ] Test file uses a real Postgres container (via `apps/api/test/global-setup.ts`), not mocks.
- [ ] Spy assertions in tests 1 + 3 prove the hook is wired (would catch a "hook deleted" regression).
- [ ] Test 4 + 5 fail if a future PR wraps `awardXp` in `try/catch` or moves the call outside the parent tx.

## Deviations from plan

- Earlier draft had a defensive call-site `try/catch` swallowing awarder throws. Removed per canon §5 (error contract). The new contract is "XP fails closed — parent tx rolls back on unexpected awarder errors", which is the inverse of the Phase 1 badge swallow pattern. The same-tx atomicity guarantee in §288 requires this behavior.
- Earlier draft used filename `awarder-event-checkin.test.ts`. Renamed to `xp-event-checkin.test.ts` per canon §11 (skeleton-canonical name).
- Earlier rollback test drove a manual `$transaction` instead of `checkInTicket`. Rewritten to drive the real route via a spy that delegates-then-throws, so it fails if the hook is moved outside the parent tx.

## Out of scope

- Car create XP (chunk 30).
- Feed-post create XP (chunk 31).
- Likes XP (chunk 32).
- Badge-award XP (chunk 33).
- Premium-activation XP (chunk 34).
- Admin manual XP adjustment endpoint (chunk 35).
```

---

## Self-review checklist (do before requesting review)

- [ ] **Spec coverage:** Every acceptance criterion from skeleton §254–§258 has a corresponding test in `xp-event-checkin.test.ts`.
  - "Successful check-in writes `+10 XpEvent` + `Garage.xp += 10` in the SAME tx" → test 1 (happy path) + spy assertion.
  - "Failed check-in rolls back the XP write" → test 5 (rollback via real `checkInTicket` path).
  - "Duplicate check-in attempt (idempotent) does not double-award" → test 2.
  - Plus two corrections-derived tests: test 3 (killswitch off, with spy assertion to prove the hook is still wired) and test 4 (awarder non-P2002 throw aborts parent — proves canon §5).
- [ ] **Placeholder scan:** No TBD, no "TODO", no "fill in", no "similar to". Every code block is complete.
- [ ] **Canon §4 signature:** `awardXp(tx, garageId, reason, opts)` with `opts.sourceRef` required.
- [ ] **Canon §5 error contract:** NO call-site `try/catch` around `awardXp`; tests 4 + 5 enforce this.
- [ ] **Canon §11 filename:** `apps/api/test/garage/xp-event-checkin.test.ts`.
- [ ] **No new files in `src/`** — only the test file is new, matching skeleton §249–§251.
- [ ] **Branch + PR pointed at `main`**, not `production` (CLAUDE.md branch safety).
- [ ] **Real Postgres in tests** — no Prisma mocks, no in-memory shims (CLAUDE.md "Real Postgres for tests").

---

## Cross-references

- Chunk 27 (sibling) — `XPAwarder` service definition that exports `awardXp`. **Block on chunk 27's merge** before starting this chunk.
- Chunk 28 (sibling) — payload wiring of `progress` + `stats`. Independent — runs in parallel.
- Chunks 30–35 — sibling awarder hooks for other write paths. All parallel-with chunk 29 per skeleton §253.
- Phase 1 chunk 18 — the badge hook this chunk slots in alongside. Reference for the in-tx swallow pattern.
- `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` — canonical XP outline.
- `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` — Phase 2 chunk skeleton.
