# Chunk 33 — Hook XP awarder into Conquistas badge award (+25/+50/+100) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 1 `awardBadge` service so a successful `GarageBadge` insert also fires `awardXp(tx, garageId, 'badge_award', { sourceRef: 'badge:<code>', rarity })` in the same transaction, awarding +25 / +50 / +100 by `Badge.rarity` (common / rare / legendary).

**Architecture:** Single splice inside `apps/api/src/services/garage/awarder.ts` — append one `awardXp(...)` call after the `tx.garageBadge.create({ ... })` succeeds and the `recordAudit(...)` runs, **before** the optional Notification block. The rarity → delta switch lives inside `xp-awarder.ts` (chunk 27), not inside `awardBadge`. The XP call must NOT fire on the P2002 re-grant path (idempotency stays upstream at the `GarageBadge` unique). Per canon §5: `awardXp` silently no-ops on killswitch-off + P2002 (returns `{ awarded: false, ... }`); any other error RETHROWS so the parent tx rolls back the badge insert + audit row together. Callers MUST NOT wrap `awardXp` in their own try/catch inside the parent tx.

**Tech Stack:** Fastify + Prisma (`@prisma/client`), TypeScript end-to-end, vitest with Testcontainers-Postgres (real DB per CLAUDE.md "Integration tests for the API must hit a real Postgres"). Workspace: `@ccc/api`.

---

## Required reading before coding

1. `CLAUDE.md` — branch safety + load-bearing invariants.
2. `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 33" (line 321) — acceptance criteria, parallel-with list.
3. `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`:
   - §"Locked invariants" #8 (line 34) — killswitch sync read; awarder no-ops when off.
   - §C1 (line 43) — DB-enforced uniqueness on `(garageId, reason, sourceRef)`, catch P2002.
   - §C5 (line 116) — sync killswitch read, no TTL.
   - §C11 (line 218) — Phase 1 awarder lives at `apps/api/src/services/garage/awarder.ts` (chunk 18, NOT "Phase 2 chunk 2B.11").
   - §"XP-awarder rules" line 437–450 — `badge_award`: +25 / +50 / +100, idempotency key `(garageId, 'badge_award', 'badge:<code>')`.
4. `apps/api/src/services/garage/awarder.ts` — the actual `awardBadge`. Read top-to-bottom before editing.

---

## Branch safety preflight (per CLAUDE.md)

```bash
git branch --show-current
# If output is `production` → STOP. Switch to main first.
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-33
```

Never branch from `production`. Never commit on `production`. PR targets `main`.

---

## Corrections that apply

Pulled forward from `2026-05-21-garage-progression-phase2-xp.md` §"Corrections applied 2026-05-21 post-review":

- **§C1** — Idempotency for the `badge_award` XpEvent row is enforced by the DB `@@unique([garageId, reason, sourceRef])` landed in chunk 23. The XP awarder (chunk 27) catches the P2002 internally and returns `{ awarded: false, reason: 'duplicate' }` silently — `awardBadge` does NOT need its own try/catch around `awardXp`. The upstream `GarageBadge @@unique([garageId, badgeCode])` already prevents the chunk-33 site from reaching the XP call on a re-grant.
- **§C5** — The killswitch read inside the XP awarder is a sync `SELECT` (no TTL cache). The killswitch read inside `awardBadge` (line 95 of `awarder.ts`) already short-circuits any path that reaches the XP call. This chunk does NOT introduce a second killswitch read; it relies on the upstream one + the XP awarder's own re-check per §C5 invariant.
- **§C11** — All "Phase 2 chunk 2B.11" references in older docs mean Phase 1 chunk 18 today. The file we are extending is `apps/api/src/services/garage/awarder.ts` (verified by grep, not by doc text).
- **Canon §5 (cross-chunk error contract)** — `awardXp` silently catches killswitch-off + P2002 and returns `{ awarded: false, ... }`. Any other error RETHROWS. `awardBadge` calls `awardXp` **directly** after `recordAudit` with no local try/catch. If `awardXp` throws an unexpected error, the parent `$transaction` rolls back the GarageBadge insert + audit row atomically — this is the desired behavior, not an edge case to suppress.

Outline lines that are STALE but do NOT affect this chunk:

- §337 deviation candidate "rarity → delta mapping lives inside the XP awarder, NOT `awardBadge`" — this plan resolves it: we pass `rarity` through as an option; the switch lives in `xp-awarder.ts`.
- Earlier draft of this chunk proposed an `awardBadge`-local try/catch around `awardXp` with a `console.warn` swallow path. That is REMOVED per canon §5: the awarder's documented error contract is the single source of truth (silent on expected duplicates / killswitch, rethrow on unexpected). Wrapping at this site would mask genuine bugs and break same-tx atomicity.

---

## Locked invariants this chunk honors

From outline §"Locked invariants":

- **#8 killswitch.** Upstream short-circuit at `awardBadge` (line 95–96 of `awarder.ts`) means no `GarageBadge` row + no XP call when off. The XP awarder also re-reads the killswitch on entry per §C5 — belt-and-suspenders; if `awardBadge` were ever called without the upstream guard (it can't today, but the invariant must hold across refactors), the XP awarder still no-ops independently.
- **#3 XP cannot decrease except via like-revert or admin adjustment.** `badge_award` is always positive. No revert path on badge revoke for v1 (un-grant is a separate admin op; chunk 20 handles the GarageBadge delete, but does NOT delete the XpEvent — XP earned stays earned, matches the audit-trail philosophy at outline §4 footnote on like-revert simplicity). This is deliberate; document in §"Deviations" if product objects later.

---

## Scope

In-scope (this chunk only):

- `apps/api/src/services/garage/awarder.ts` — extend the success-path of `awardBadge` to call `awardXp` with rarity tier. ~4 lines of code (+ imports).
- `apps/api/test/garage/xp-badge-award.test.ts` — new test file, 7 tests against real Postgres.

Out-of-scope (other chunks; do NOT touch):

- `xp-awarder.ts` itself (chunk 27 — must exist + export `awardXp` with rarity-tiered delta before this chunk merges).
- The rarity → delta switch (lives in chunk 27's `xp-awarder.ts`).
- Other write-path hooks (event check-in → chunk 29; car create → 30; feed post → 31; reactions → 32; premium activation → 34; admin XP adjustment → 35).
- Badge revoke / un-grant XP-reversal (deferred; not in v1).
- Public/owner payload wiring of `progress.xp` (chunk 28).

---

## Dependency on chunk 27

This chunk imports `awardXp` from `apps/api/src/services/garage/xp-awarder.ts`. Chunk 27 ships that file. Canonical signature per canon §4 + §5:

```ts
export type AwardXpOpts = {
  sourceRef: string;                        // required, non-null (canon §7)
  rarity?: 'common' | 'rare' | 'legendary'; // badge_award ONLY (resolves +25 / +50 / +100)
  delta?: number;                           // admin_adjustment ONLY (signed)
};
export const awardXp = async (
  tx: Prisma.TransactionClient,
  garageId: string,
  reason: XpReason,
  opts: AwardXpOpts,
): Promise<{ awarded: boolean; reason?: 'duplicate' | 'gamification_disabled' }>;
```

Error contract (canon §5): killswitch-off + P2002 caught internally, returned as `{ awarded: false, reason }`. Any other error rethrows.

**Pre-flight before starting:** `grep -n 'export const awardXp' apps/api/src/services/garage/xp-awarder.ts`. If absent OR signature differs, STOP — either chunk 27 hasn't landed (block on it) or its signature drifted (flag as a chunk-27 deviation and revise this plan's code blocks). Silently re-aligning produces a green diff that doesn't do what this chunk specifies.

---

## File Structure

```
apps/api/src/services/garage/awarder.ts        (modify — splice awardXp after recordAudit)
apps/api/test/garage/xp-badge-award.test.ts    (new — 7 tests, real Postgres)
```

No new exports from `awarder.ts`. No shared-package changes. No prisma changes. No route changes.

---

## Task 1 — Add the failing test file (TDD)

**Files:**

- Create: `apps/api/test/garage/xp-badge-award.test.ts`

Test-design notes:

- Follow `apps/api/test/garage/awarder.test.ts` style: `prisma` from `@ccc/db`, `makeApp` + `resetDatabase` from `./helpers.js`, seed via `prisma.badge.create`, call `awardBadge` inside `prisma.$transaction((tx) => ...)`.
- One rarity per happy-path test so failures point at the exact bucket.
- Killswitch test asserts both upstream short-circuit AND absence of an `XpEvent` row.
- Re-grant test: second call returns `already_earned`, XpEvent count stays at 1.
- Admin override test: chunk-20 path (allowAdminOverride + notifyOnGrant) still fires XP — XP is rarity-driven, not premium-driven.
- Parent-tx-rollback test throws inside `$transaction` after `awardBadge` returns, asserts both rows get rolled back — proves the XP call participated in the parent tx (§456 #3).
- No awarder-throw-swallowing test (per canon §5: `awardXp` rethrows unexpected errors, parent tx must roll back the badge + audit). If product later needs swallow-at-this-site semantics, that's a new chunk + a canon amendment, not a local hack.

- [ ] **Step 1.1 — Create the test file skeleton**

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { awardBadge } from '../../src/services/garage/awarder.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const seedBadge = async (code: string, rarity: 'common' | 'rare' | 'legendary'): Promise<void> => {
  await prisma.badge.create({
    data: {
      code,
      category: code.startsWith('EVT')
        ? 'eventos'
        : code.startsWith('CAR')
          ? 'carros'
          : code.startsWith('COM')
            ? 'comunidade'
            : 'jdm',
      rarity,
      icon: 'flag',
      premiumExclusive: false,
    },
  });
};

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('awardBadge → awardXp splice (chunk 33)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // tests below
});
```

- [ ] **Step 1.2 — Test: common badge → +25 XP**

```ts
it('common badge award fires +25 XpEvent with sourceRef "badge:<code>"', async () => {
  await seedBadge('EVT-001', 'common');
  const { user } = await createUser({ email: 'c1@jdm.test', verified: true });
  const gid = await garageId(user.id);

  const outcome = await prisma.$transaction((tx) => awardBadge(tx, gid, 'EVT-001', 'check_in:t1'));
  expect(outcome).toEqual({ awarded: true });

  const xpRow = await prisma.xpEvent.findFirstOrThrow({
    where: { garageId: gid, reason: 'badge_award' },
  });
  expect(xpRow.delta).toBe(25);
  expect(xpRow.sourceRef).toBe('badge:EVT-001');

  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garage.xp).toBe(25);
});
```

- [ ] **Step 1.3 — Test: rare → +50**

```ts
it('rare badge award fires +50 XpEvent', async () => {
  await seedBadge('CAR-007', 'rare');
  const { user } = await createUser({ email: 'c2@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction((tx) => awardBadge(tx, gid, 'CAR-007', 'car:42'));

  const xpRow = await prisma.xpEvent.findFirstOrThrow({
    where: { garageId: gid, reason: 'badge_award' },
  });
  expect(xpRow.delta).toBe(50);
  expect(xpRow.sourceRef).toBe('badge:CAR-007');

  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garage.xp).toBe(50);
});
```

- [ ] **Step 1.4 — Test: legendary → +100**

```ts
it('legendary badge award fires +100 XpEvent', async () => {
  await seedBadge('JDM-099', 'legendary');
  const { user } = await createUser({ email: 'c3@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction((tx) => awardBadge(tx, gid, 'JDM-099', null));

  const xpRow = await prisma.xpEvent.findFirstOrThrow({
    where: { garageId: gid, reason: 'badge_award' },
  });
  expect(xpRow.delta).toBe(100);
  expect(xpRow.sourceRef).toBe('badge:JDM-099');

  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garage.xp).toBe(100);
});
```

- [ ] **Step 1.5 — Test: re-grant of same badge → no XpEvent duplication**

```ts
it('second awardBadge with same (garageId, code) does not write a second XpEvent', async () => {
  await seedBadge('COM-002', 'common');
  const { user } = await createUser({ email: 'c4@jdm.test', verified: true });
  const gid = await garageId(user.id);

  const first = await prisma.$transaction((tx) => awardBadge(tx, gid, 'COM-002', 'a'));
  const second = await prisma.$transaction((tx) => awardBadge(tx, gid, 'COM-002', 'b'));

  expect(first).toEqual({ awarded: true });
  expect(second).toEqual({ awarded: false, reason: 'already_earned' });

  const xpRows = await prisma.xpEvent.findMany({
    where: { garageId: gid, reason: 'badge_award' },
  });
  expect(xpRows).toHaveLength(1);
  expect(xpRows[0].delta).toBe(25);

  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garage.xp).toBe(25);
});
```

Why this works: the upstream `GarageBadge @@unique([garageId, badgeCode])` fires P2002 on the second insert, the existing catch block at `awarder.ts:168` returns `{ awarded: false, reason: 'already_earned' }`, and the XP call **never runs** because it sits inside the try-block AFTER the insert. No need to rely on the chunk-23 `XpEvent` unique here.

- [ ] **Step 1.6 — Test: killswitch off → no badge + no XpEvent**

```ts
it('killswitch off short-circuits at awardBadge — no GarageBadge + no XpEvent', async () => {
  await seedBadge('EVT-002', 'common');
  await prisma.generalSettings.upsert({
    where: { id: 'general_default' },
    create: { id: 'general_default', gamificationEnabled: false },
    update: { gamificationEnabled: false },
  });
  const { user } = await createUser({ email: 'c5@jdm.test', verified: true });
  const gid = await garageId(user.id);

  const outcome = await prisma.$transaction((tx) => awardBadge(tx, gid, 'EVT-002'));
  expect(outcome).toEqual({ awarded: false, reason: 'gamification_disabled' });

  const badges = await prisma.garageBadge.count({ where: { garageId: gid } });
  expect(badges).toBe(0);

  const xpRows = await prisma.xpEvent.count({ where: { garageId: gid } });
  expect(xpRows).toBe(0);
});
```

Locked invariants #8 anchor — upstream short-circuit, no XP call attempted.

- [ ] **Step 1.7 — Test: admin manual grant (chunk-20 path) → XP awarded the same**

```ts
it('admin manual grant with allowAdminOverride awards XP by rarity', async () => {
  await seedBadge('JDM-555', 'legendary');
  // Mark legendary as premium-exclusive to exercise the override path.
  await prisma.badge.update({
    where: { code: 'JDM-555' },
    data: { premiumExclusive: true },
  });
  const { user } = await createUser({ email: 'c6@jdm.test', verified: true });
  const gid = await garageId(user.id);

  const outcome = await prisma.$transaction((tx) =>
    awardBadge(tx, gid, 'JDM-555', 'admin:adm_1', {
      actorId: 'admin:adm_1',
      allowAdminOverride: true,
      notifyOnGrant: true,
    }),
  );
  expect(outcome).toEqual({ awarded: true });

  const xpRow = await prisma.xpEvent.findFirstOrThrow({
    where: { garageId: gid, reason: 'badge_award' },
  });
  expect(xpRow.delta).toBe(100);
  expect(xpRow.sourceRef).toBe('badge:JDM-555');
});
```

Proves the splice fires on the chunk-20 (admin manual grant) code path identically — there is no admin-only fork in `awardBadge`.

- [ ] **Step 1.8 — Test: parent tx rollback drops both rows together**

```ts
it('parent tx rollback drops GarageBadge AND XpEvent', async () => {
  await seedBadge('EVT-777', 'rare');
  const { user } = await createUser({ email: 'c8@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await expect(
    prisma.$transaction(async (tx) => {
      await awardBadge(tx, gid, 'EVT-777', 'check_in:rollback');
      throw new Error('parent tx aborts');
    }),
  ).rejects.toThrow('parent tx aborts');

  const badges = await prisma.garageBadge.count({ where: { garageId: gid } });
  expect(badges).toBe(0);
  const xpRows = await prisma.xpEvent.count({ where: { garageId: gid } });
  expect(xpRows).toBe(0);
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garage.xp).toBe(0);
});
```

Pins outline §456 invariant #3: the XP write lives in the same tx so the audit can never disagree with `Garage.xp`. Doubles as the canon §5 anchor — proves an unexpected throw inside the parent tx rolls back the badge insert + audit row + XpEvent atomically.

- [ ] **Step 1.9 — Run the test file to confirm RED**

Run only this file:

```bash
pnpm --filter @ccc/api exec vitest run test/garage/xp-badge-award.test.ts
```

Expected: all 7 tests FAIL. The most common failure modes will be:

- "Cannot find module '../../src/services/garage/xp-awarder.js'" → chunk 27 hasn't shipped; STOP and unblock that first.
- `xpEvent.findFirstOrThrow` throws → expected; the splice isn't there yet.
- The killswitch test may pass accidentally because the upstream guard already prevents the badge insert and XP isn't called either way — that's fine, treat as a regression guard, not a TDD anchor.

Do NOT proceed to Task 2 until you have a confirmed RED log with the expected failure messages. Per CLAUDE.md "Test your code before declaring done" + the global skill "verification-before-completion".

- [ ] **Step 1.10 — Commit the failing tests**

```bash
git add apps/api/test/garage/xp-badge-award.test.ts
git commit -m "test(api): failing tests for awardBadge → XP splice (chunk 33)"
```

---

## Task 2 — Implement the splice

**Files:**

- Modify: `apps/api/src/services/garage/awarder.ts:1-12` (imports) + the success path inside the try block (around line 135, between `recordAudit` and the `notifyOnGrant` block).

- [ ] **Step 2.1 — Add the `awardXp` import**

Read `apps/api/src/services/garage/awarder.ts:1-14` first. Then insert the new import next to the existing service imports (after `killswitch.js`, before `index.js`):

```ts
import { readGamificationEnabled } from './killswitch.js';
import { awardXp } from './xp-awarder.js';

import { computeIsPremiumActive } from './index.js';
```

Why the import order: keeps the `garage/` peer modules grouped above the `index.js` re-export to preserve the existing visual block; ESLint's `import/order` config groups them by relative-path depth, so this stays sort-stable.

- [ ] **Step 2.2 — Insert the XP call after `recordAudit`, before `notifyOnGrant`**

Locate the success path (lines 122–167 of the current file). Insert the new block between the closing `recordAudit(...)` call and the `if (opts.notifyOnGrant) {` block:

```ts
    await recordAudit(
      {
        actorId: opts.actorId ?? 'system:awarder',
        action: 'badge.award',
        entityType: 'garage',
        entityId: garageId,
        metadata: { badgeCode: code, sourceRef },
      },
      tx,
    );

    // 4a. XP award for the badge. Rarity → delta mapping lives in the XP
    // awarder (chunk 27); we pass the rarity through. Per canon §5:
    // awardXp silently no-ops on killswitch-off + P2002 and returns
    // { awarded: false, ... }; any other error rethrows so the parent
    // $transaction rolls back the GarageBadge insert + audit row + the
    // would-be XpEvent atomically. NO local try/catch here — that would
    // mask genuine bugs and break same-tx atomicity (canon §5).
    await awardXp(tx, garageId, 'badge_award', {
      sourceRef: `badge:${code}`,
      rarity: badge.rarity,
    });

    if (opts.notifyOnGrant) {
```

Notes:

- `badge.rarity` is already loaded at `awarder.ts:101`. No second DB read.
- The XP call sits **inside** the outer `try { ... } catch (isUniqueConstraintError) ... }` block. The outer catch is keyed to the GarageBadge P2002 path; an `awardXp` rethrow on an unexpected error escapes both blocks and rolls the parent tx back — that is the intended behavior per canon §5.
- `awardXp` receives `tx`, not the top-level `prisma` — same-tx semantics per §456 #3.
- The return value of `awardXp` is intentionally not inspected: `{ awarded: false, reason: 'duplicate' }` only fires on a P2002 the chunk-23 XpEvent unique guards, which is impossible here because the upstream GarageBadge unique already short-circuits a re-grant before this line. Asserting on it would tie chunk 33 to chunk-23 unique semantics it doesn't need.

- [ ] **Step 2.3 — Run the test file to confirm GREEN**

```bash
pnpm --filter @ccc/api exec vitest run test/garage/xp-badge-award.test.ts
```

Expected: 7 PASS. Failure modes:

- `parent tx rollback` fails (XpEvent persists) → `awardXp` is using the top-level `prisma` instead of `tx`. Re-check.
- `re-grant` test fails with `findFirstOrThrow` on `XpEvent` → the splice was placed BEFORE the `tx.garageBadge.create` and runs on the doomed re-grant path; move it AFTER `recordAudit`.

- [ ] **Step 2.4 — Targeted typecheck + no-regression on existing tests**

```bash
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api exec vitest run test/garage/awarder.test.ts
```

Expected: zero typecheck errors; all existing `awardBadge — core service` tests still pass. If typecheck flags drift, the chunk-27 signature changed — revisit the dependency guard. If `awarder.test.ts` fails due to leftover XpEvent rows, audit `resetDatabase()` (chunk 23 should truncate `XpEvent` — file a chunk-23 bug if not, do not patch helpers here).

- [ ] **Step 2.5 — Commit the implementation**

```bash
git add apps/api/src/services/garage/awarder.ts
git commit -m "feat(api): hook awarder into Conquistas badge award (+25/+50/+100)

Phase 1 awardBadge success now fires awardXp with rarity-tiered delta
(+25 common, +50 rare, +100 legendary). sourceRef 'badge:<code>',
same parent transaction. No local try/catch: awardXp silently
no-ops on killswitch + P2002 and rethrows unexpected errors so the
parent tx rolls back the GarageBadge + audit atomically (canon §5).

Closes JDMA Phase 2 chunk 33."
```

---

## Task 3 — Verification before PR

- [ ] **Step 3.1 — Touched-paths sweep** (per CLAUDE.md memory "touched files only; trust CI"):

```bash
pnpm --filter @ccc/api exec vitest run test/garage/xp-badge-award.test.ts test/garage/awarder.test.ts
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api exec eslint src/services/garage/awarder.ts test/garage/xp-badge-award.test.ts
```

Expected: all green. With the try/catch + `console.warn` removed, there is no `no-console` risk and no need for an eslint-disable comment.

- [ ] **Step 3.2 — Mental trace through locked invariants**

1. Killswitch off (#8) → `readGamificationEnabled(tx)` false at line 95 → early return → XP never reached.
2. Re-grant (`GarageBadge @@unique`) → P2002 → outer catch returns `already_earned` → XP never reached.
3. Premium-required → returns at line 114 → XP never reached.
4. Happy path → badge insert → audit → XP call (silent killswitch/P2002 returns ignored) → `{ awarded: true }`.
5. Unexpected XP error → propagates out of `awardBadge` → parent `$transaction` rolls back badge + audit + XpEvent atomically (canon §5).
6. Parent tx aborts mid-flight → rollback drops badge + audit + XpEvent atomically.

Any case that does not trace cleanly → re-read the diff and reconcile.

---

## PR checklist

Branch: `feat/jdma-garage-phase2-33` from fresh `main`.

- [ ] CLAUDE.md preflight (`git branch --show-current` is not `production`).
- [ ] `pnpm --filter @ccc/api typecheck` clean.
- [ ] `pnpm --filter @ccc/api exec vitest run test/garage/xp-badge-award.test.ts test/garage/awarder.test.ts` green.
- [ ] Only `apps/api/src/services/garage/awarder.ts` + the new test file modified. No prisma / xp-awarder / route changes.
- [ ] No new exports from `awarder.ts`.
- [ ] PR description references skeleton §329–334 + outline §437 + locked-invariant #8 + chunk-27 runtime dependency.
- [ ] PR title: `feat(api): hook awarder into Conquistas badge award (chunk 33)`.
- [ ] PR base: `main` (NEVER `production`). Request review only after PR exists.

---

## Self-review

1. **Spec coverage:** all 5 acceptance criteria (skeleton §329–334) covered — common/rare/legendary deltas, sourceRef idempotency, killswitch short-circuit. Chunk-20 admin path: Step 1.7. Parent-tx atomicity (canon §5): Step 1.8.
2. **Placeholder scan:** no TBD / TODO / "fill in" / "similar to Task N". All code complete, imports resolved.
3. **Type consistency:** `awardXp('badge_award', ...)` matches `XpReason` (chunk 23 / outline §332). `rarity: 'common' | 'rare' | 'legendary'` matches `BadgeRarity` (`schema.prisma:223-227`). `sourceRef: \`badge:${code}\`` is identical in tests + impl.

---

## Deviations from inline outline / skeleton

- **No badge-revoke XP-reversal.** Outline does not specify what happens when an admin un-grants a badge (chunk 20 admin path). v1 keeps XP earned. Documented under "Locked invariants this chunk honors" above. If product requests reversal later, a new chunk lands a `revertBadgeXp` mirror to `revertLikeXp` (§C2).

---

## Notes for the reviewer

- Diff is intentionally small (~10 lines + test file) because rarity → delta lives in chunk 27 and there is no local try/catch (canon §5). If the diff balloons, the engineer either inlined the rarity table (duplicate source of truth), refactored `awardBadge` (out of scope), or re-introduced a local swallow (canon §5 violation — block at review).
- Chunk 33 is parallel-with 29–35 (skeleton §328) but **NOT** parallel with chunk 27. If 27 hasn't merged, the import fails at typecheck — rebase.
- Re-grant idempotency relies on the Phase 1 `GarageBadge @@unique`, not the chunk-23 `XpEvent @@unique`. The chunk-23 unique is the safety net for chunks 29–34 where the parent write has no uniqueness.
