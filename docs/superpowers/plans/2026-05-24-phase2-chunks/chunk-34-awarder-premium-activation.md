# Chunk 34 — Hook awarder into premium activation (+200 one-shot) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Splice `awardXp(tx, garageId, 'premium_activation', { sourceRef: 'garage:<garageId>' })` into the existing premium-grant write path so a fresh activation awards +200 XP exactly once per garage forever. Lapse + re-activate must NOT fire a second bonus.

**Architecture:** One call-site addition inside the existing admin premium-grant transaction (`apps/api/src/routes/admin/user-garage.ts` — the `POST /admin/users/:id/garage/premium` handler). The fixed `sourceRef = 'garage:<garageId>'` plus the `XpEvent` DB unique constraint introduced in chunk 23 / enforced via §C1 guarantees the one-shot-ever invariant — no application-layer history check needed. Awarder swallows the P2002 internally per §C1.

**Tech Stack:** TypeScript, Fastify, Prisma (Postgres), Vitest. Uses the existing `awardXp` from chunk 27 (`apps/api/src/services/garage/xp-awarder.ts`), the existing `admin-audit` recordAudit, and the `bearer` / `createUser` / `makeApp` / `resetDatabase` helpers in `apps/api/test/helpers.ts`.

**Spec references (read once, do not copy):**

- `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 34" (line 342) — chunk contract + parallel-with set.
- `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`:
  - §"Locked invariants" #3 (line 29) — premium +200 XP, one-shot ever; lapse + re-activate does NOT re-fire.
  - §"Locked invariants" #6 (line 32) — `isPremiumActive` serializer-computed; bonus fires from existing grant path, never client.
  - §"XP-awarder rules" table (line 437–450) — `premium_activation` row + idempotency triple.
  - §"Awarder rules" 1–5 (line 452–458) — same-tx, non-throwing, killswitch short-circuit.
  - §"Decisions locked at kickoff" #1 (line 552) — one-shot ever per garage.
  - §C1 (line 43) — DB `@@unique([garageId, reason, sourceRef])`; awarder catches P2002. **Fixed sourceRef makes P2002 the one-shot enforcer.**
  - §"Phased outline" 2B.34 (line 281).
- `docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` — admin-route tone (small additive splice, mirror existing `recordAudit`-in-tx pattern).
- `CLAUDE.md` — branch safety preflight; PR-only-to-`main`; no `production` edits; no full test suite locally.

---

## Scope

**In scope:**

- One call-site edit inside the `POST /admin/users/:id/garage/premium` handler in `apps/api/src/routes/admin/user-garage.ts`. After the `garage.update({ premiumTier, premiumUntil })` line succeeds, and ONLY when the call is a grant (not a revoke — `input.tier !== null`), call `awardXp(tx, garage.id, 'premium_activation', { sourceRef: 'garage:<garageId>' })` inside the same transaction. Per fix-canon §4, the canonical 4-arg positional signature `awardXp(tx, garageId, reason, opts)` matches chunk 27 and all 2B consumers.
- New integration test file `apps/api/test/garage/awarder-premium-activation.test.ts` covering: first activation awards +200; lapse-then-reactivate awards nothing; killswitch off awards nothing (premium still grants); revoke alone (no prior grant) does not award; concurrent two-request premium grants are idempotent (final `Garage.xp === 200`, exactly one `premium_activation` `XpEvent` row, P2002 on the loser).

**Out of scope (covered by other chunks):**

- `awardXp` implementation, killswitch read, P2002 catch — chunk 27.
- `XpEvent` model + `@@unique([garageId, reason, sourceRef])` migration — chunk 23.
- AbacatePay / Stripe webhook driven premium grants — **the skeleton seed mentions these as candidates; verification below confirms neither exists in this repo today. Document under Deviation log.**
- Admin XP manual adjustment route — chunk 35.
- UI XPScoreboard / tooltip — chunks 36–38.

**Corrections that apply to this chunk:** §C1 only. The fixed `sourceRef = 'garage:<garageId>'` + the DB unique constraint together enforce one-shot-ever — the awarder's P2002 catch in chunk 27 turns the second activation into a silent `awarded:false`. No application-layer history scan needed.

**Fix-canon decisions applied (from `/tmp/phase2-fix-canon.md`):**

- §4 (awardXp signature): canonical 4-arg positional `awardXp(tx, garageId, reason, opts)`. Matches the call in Task 2: `awardXp(tx, garage.id, 'premium_activation', { sourceRef: \`garage:${garage.id}\` })`.
- §5 (awardXp error contract): callers MUST NOT wrap `awardXp` in try/catch inside the parent tx. The premium-grant handler relies on chunk 27's contract — killswitch returns `awarded:false`, P2002 returns `awarded:false`, any other error rethrows and rolls back the parent tx. The throw-swallow and parent-tx-rollback runtime tests are chunk 27's responsibility, not this chunk's.
- §7 (non-null sourceRef at awarder boundary): the fixed `garage:<garageId>` is non-null and server-generated, so the DB `@@unique` enforces idempotency cleanly.

---

## Premium-grant write path verification (read-before-edit)

Skeleton line 357 hedges between `stripe-webhook.ts`, `abacatepay-webhook.ts`, and the admin route. Verify on `main` at kickoff:

```bash
grep -rn "premiumTier\s*:\|premiumUntil\s*:" apps/api/src/ \
  | grep -v test | grep -v ".d.ts" | grep -v "select" | grep -v "computeIsPremium"
```

Expected write sites:

- `apps/api/src/routes/admin/user-garage.ts:158-159` — `POST /admin/users/:id/garage/premium`. **Only premium-grant write path on `main` today.**
- `apps/api/src/services/account-deletion/anonymize.ts:154-155` — LGPD scrub. **Not a grant; not a hook target.**

If grep at implementation time surfaces additional write paths (e.g. a new Stripe webhook), splice the same `awardXp(...)` into each grant-direction tx and add a parallel test. Note in §Deviation log.

---

## File structure

```
apps/api/src/routes/admin/user-garage.ts                       (MODIFY)
apps/api/test/garage/awarder-premium-activation.test.ts        (NEW)
```

Touched-paths only. No edits to `xp-awarder.ts`, `killswitch.ts`, `packages/shared`, `packages/db`, or any other route file.

---

## Branch + preflight

- [ ] **Step 0: Branch preflight** (CLAUDE.md "Branch safety preflight")

```bash
git branch --show-current
```

If output is `production`, STOP. Otherwise:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-34
```

---

## Task 1 — Failing test: first premium grant awards +200

**Files:**

- Create: `apps/api/test/garage/awarder-premium-activation.test.ts`

Tone: mirror `apps/api/test/admin/user-garage/admin-user-garage.test.ts` (route-level injection via `app.inject`, `bearer` for the admin token, `adminGarageSummarySchema` parse for the response). Cross-check the awarder-side assertion shape against `apps/api/test/garage/awarder.test.ts` for the `XpEvent` / `Garage.xp` read pattern.

- [ ] **Step 1.1: Write the failing test file (one `it` to start; the rest land in Tasks 2–6)**

```ts
// apps/api/test/garage/awarder-premium-activation.test.ts
import { prisma } from '@ccc/db';
import { adminGarageSummarySchema } from '@ccc/shared/admin-garage';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const grantPremium = async (
  app: FastifyInstance,
  orgId: string,
  targetId: string,
  payload: { tier: 'bronze' | 'silver' | 'gold' | null; premiumUntil: string | null },
) => {
  const env = loadEnv();
  return app.inject({
    method: 'POST',
    url: `/admin/users/${targetId}/garage/premium`,
    headers: { authorization: bearer(env, orgId, 'organizer') },
    payload,
  });
};

const garageIdFor = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('premium_activation XP hook (chunk 34)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('first premium grant awards +200 XP and writes one XpEvent row', async () => {
    const { user: org } = await createUser({
      email: 'o1@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't1@jdm.test', verified: true });
    const gid = await garageIdFor(target.id);

    const res = await grantPremium(app, org.id, target.id, {
      tier: 'gold',
      premiumUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageSummarySchema.parse(res.json());
    expect(body.premiumTier).toBe('gold');
    expect(body.isPremiumActive).toBe(true);

    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);

    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe('premium_activation');
    expect(events[0]!.delta).toBe(200);
    expect(events[0]!.sourceRef).toBe(`garage:${gid}`);
  });
});
```

- [ ] **Step 1.2: Run the file to confirm it fails on the missing XP**

```bash
pnpm --filter @ccc/api test -- apps/api/test/garage/awarder-premium-activation.test.ts
```

Expected: `expect(g.xp).toBe(200)` fails with `Received: 0`. (Premium grants succeed; the XP hook is not wired yet.)

- [ ] **Step 1.3: Commit the failing test**

```bash
git add apps/api/test/garage/awarder-premium-activation.test.ts
git commit -m "test(api): add failing premium_activation XP hook (chunk 34)"
```

---

## Task 2 — Implement the splice in the premium-grant tx

**Files:**

- Modify: `apps/api/src/routes/admin/user-garage.ts` (the `POST /users/:id/garage/premium` handler block — lines 137–182 today).

Goal: add `awardXp(tx, garage.id, 'premium_activation', { sourceRef: \`garage:${garage.id}\` })` inside the existing `$transaction` callback, **only** on the grant branch (`!isRevoke`), positioned AFTER the `tx.garage.update({ premiumTier, premiumUntil })` so the XP awarder sees the row in its just-updated state if it inspects it.

- [ ] **Step 2.1: Add the awardXp import**

At the top of `apps/api/src/routes/admin/user-garage.ts`, alongside the existing `import { awardBadge } from '../../services/garage/awarder.js';` line, add the XP awarder import (chunk 27 placed it in a sibling file):

```ts
import { awardXp } from '../../services/garage/xp-awarder.js';
```

Place it directly under the `awardBadge` import to keep the related-services block contiguous.

- [ ] **Step 2.2: Splice the call inside the grant tx**

Inside `POST /users/:id/garage/premium`, the existing tx body ends with `await recordAudit(...)` then `return u;`. Add the awardXp call between those two statements, gated on `!isRevoke`. After-edit shape:

```ts
const updated = await prisma.$transaction(async (tx) => {
  const u = await tx.garage.update({
    where: { id: garage.id },
    data: {
      premiumTier: input.tier,
      premiumUntil: nextPremiumUntil ? new Date(nextPremiumUntil) : null,
    },
  });
  await recordAudit(/* existing args unchanged */, tx);

  // §"Locked invariants" #3 + §"Decisions locked at kickoff" #1:
  // premium_activation is +200 XP, one-shot ever per garage. Fixed
  // sourceRef `garage:<garageId>` + the XpEvent unique (§C1) make P2002
  // the one-shot enforcer — awarder catches it and returns awarded:false
  // silently on re-activation. Only fires on grant; revoke leaves
  // historical XP intact (XP cannot decrease except via like-revert or
  // admin_adjustment).
  if (!isRevoke) {
    await awardXp(tx, garage.id, 'premium_activation', {
      sourceRef: `garage:${garage.id}`,
    });
  }

  return u;
});
```

Keep `recordAudit` BEFORE the XP write so the audit row lands even when the awarder swallowed-P2002 path is the desired no-op (re-activation after lapse — audit records the admin action; XP correctly stays put).

- [ ] **Step 2.3: Run the Task-1 test to confirm it now passes**

```bash
pnpm --filter @ccc/api test -- apps/api/test/garage/awarder-premium-activation.test.ts
```

Expected: 1 passing.

- [ ] **Step 2.4: Touched-file typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: clean.

- [ ] **Step 2.5: Commit the splice**

```bash
git add apps/api/src/routes/admin/user-garage.ts
git commit -m "feat(api): award +200 XP on first premium grant (chunk 34)"
```

---

## Task 3 — Test: lapse + re-activate does NOT award a second +200

**Files:**

- Modify: `apps/api/test/garage/awarder-premium-activation.test.ts`

This is the §"Locked invariants" #3 + §"Decisions locked at kickoff" #1 contract. Implementation already correct (the awarder's P2002 swallow in chunk 27 handles it) — this test just locks the behavior.

- [ ] **Step 3.1: Add the failing-then-passing test (it will pass immediately because the implementation is already correct; that's fine — the test still locks the contract)**

Append inside the `describe` block:

```ts
it('lapse + re-activate does NOT award a second +200 (one-shot ever per §invariant 3)', async () => {
  const { user: org } = await createUser({
    email: 'o2@jdm.test',
    verified: true,
    role: 'organizer',
  });
  const { user: target } = await createUser({ email: 't2@jdm.test', verified: true });
  const gid = await garageIdFor(target.id);

  // First grant.
  const r1 = await grantPremium(app, org.id, target.id, {
    tier: 'bronze',
    premiumUntil: '2030-01-01T00:00:00.000Z',
  });
  expect(r1.statusCode).toBe(200);

  // Revoke (simulates lapse — admin pulls it; or premiumUntil elapses,
  // which the serializer handles, but the awarder side cares about the
  // grant write path either way).
  const r2 = await grantPremium(app, org.id, target.id, {
    tier: null,
    premiumUntil: null,
  });
  expect(r2.statusCode).toBe(200);

  // Re-grant (the "re-activate after lapse" boundary).
  const r3 = await grantPremium(app, org.id, target.id, {
    tier: 'silver',
    premiumUntil: '2031-01-01T00:00:00.000Z',
  });
  expect(r3.statusCode).toBe(200);

  // §invariant 3: still exactly one XpEvent + Garage.xp still 200.
  // The awarder caught P2002 on the re-grant and returned awarded:false
  // silently (§C1). The admin audit row for the re-grant still landed.
  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(200);

  const events = await prisma.xpEvent.findMany({
    where: { garageId: gid, reason: 'premium_activation' },
  });
  expect(events).toHaveLength(1);
  expect(events[0]!.sourceRef).toBe(`garage:${gid}`);

  // Audit row count: 3 admin actions (grant, revoke, re-grant). The
  // awarder.swallowed-P2002 path MUST NOT touch the AdminAudit table.
  const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
  const actions = audits.map((a) => a.action).sort();
  expect(actions).toEqual([
    'garage.premium_grant',
    'garage.premium_grant',
    'garage.premium_revoke',
  ]);
});
```

- [ ] **Step 3.2: Run the new test to confirm pass**

```bash
pnpm --filter @ccc/api test -- apps/api/test/garage/awarder-premium-activation.test.ts -t 'lapse'
```

Expected: 1 passing.

- [ ] **Step 3.3: Commit**

```bash
git add apps/api/test/garage/awarder-premium-activation.test.ts
git commit -m "test(api): lock one-shot-ever premium_activation (chunk 34)"
```

---

## Task 4 — Test: killswitch off — premium grants succeed, no XpEvent

**Files:**

- Modify: `apps/api/test/garage/awarder-premium-activation.test.ts`

§"Awarder rules" #5 (line 458) + §"Killswitch" (line 502). When `GeneralSettings.gamificationEnabled = false`, the awarder short-circuits at entry and returns `{ awarded: false, reason: 'gamification_disabled' }` without writing the XpEvent. The premium grant itself MUST still succeed — the killswitch gates gamification, not the underlying premium membership.

- [ ] **Step 4.1: Add the test**

Append:

```ts
it('killswitch off — premium grants succeed but no XpEvent or Garage.xp change', async () => {
  // Flip the killswitch before the grant.
  await prisma.generalSettings.upsert({
    where: { id: 'general_default' },
    update: { gamificationEnabled: false },
    create: { id: 'general_default', gamificationEnabled: false },
  });

  const { user: org } = await createUser({
    email: 'o3@jdm.test',
    verified: true,
    role: 'organizer',
  });
  const { user: target } = await createUser({ email: 't3@jdm.test', verified: true });
  const gid = await garageIdFor(target.id);

  const res = await grantPremium(app, org.id, target.id, {
    tier: 'gold',
    premiumUntil: '2030-01-01T00:00:00.000Z',
  });
  // Premium grant still works — killswitch only gates gamification.
  expect(res.statusCode).toBe(200);
  const body = adminGarageSummarySchema.parse(res.json());
  expect(body.premiumTier).toBe('gold');
  expect(body.isPremiumActive).toBe(true);

  // No XpEvent, Garage.xp unchanged.
  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(0);
  const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
  expect(events).toHaveLength(0);
});
```

- [ ] **Step 4.2: Run + commit**

```bash
pnpm --filter @ccc/api test -- apps/api/test/garage/awarder-premium-activation.test.ts -t 'killswitch'
```

Expected: 1 passing.

```bash
git add apps/api/test/garage/awarder-premium-activation.test.ts
git commit -m "test(api): killswitch off skips premium_activation XP (chunk 34)"
```

---

## Task 5 — Call-site placement static verification (no new runtime tests)

Per fix-canon §5, `awardXp`'s throw/swallow contract and same-tx rollback are chunk 27's contract — NOT this chunk's. Callers MUST NOT wrap `awardXp` in try/catch inside the parent tx, and runtime proof of swallow + rollback lives in chunk 27's `xp-awarder.test.ts`. This chunk only verifies call-site placement statically:

- [ ] **Step 5.1: Verify call-site placement with `git diff`**

```bash
git diff main...HEAD apps/api/src/routes/admin/user-garage.ts
```

Expected: the new `awardXp(...)` call sits **between** `await recordAudit(...)` and `return u;`, inside the `prisma.$transaction(async (tx) => { ... })` callback. First argument is the **`tx` from the callback**, NOT `prisma`. The call is NOT wrapped in try/catch (fix-canon §5 — callers let unexpected errors propagate so the parent tx rolls back).

Task 3's re-grant case (third `grantPremium` call returning 200 even though the awarder hits P2002 internally) is itself the duplicate-swallow proof at the integration boundary. Chunk 27's unit-level tests cover both the non-P2002 throw → rethrow → parent-tx-rollback path and the silent P2002 swallow path; those contracts are out of scope here.

---

## Task 6 — Test: revoke alone does not award

**Files:**

- Modify: `apps/api/test/garage/awarder-premium-activation.test.ts`

The `!isRevoke` guard in Task 2 must hold — a revoke against a never-granted garage MUST NOT award.

- [ ] **Step 6.1: Add the test**

Append:

```ts
it('revoke (no prior grant) does not award XP', async () => {
  const { user: org } = await createUser({
    email: 'o4@jdm.test',
    verified: true,
    role: 'organizer',
  });
  const { user: target } = await createUser({ email: 't4@jdm.test', verified: true });
  const gid = await garageIdFor(target.id);

  // A revoke against a never-granted garage. Admin UI shouldn't surface
  // this button, but the API must be defensive: tier=null with no prior
  // tier should NOT award the bonus.
  const res = await grantPremium(app, org.id, target.id, {
    tier: null,
    premiumUntil: null,
  });
  expect(res.statusCode).toBe(200);

  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(0);
  const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
  expect(events).toHaveLength(0);
});
```

- [ ] **Step 6.2: Run + commit**

```bash
pnpm --filter @ccc/api test -- apps/api/test/garage/awarder-premium-activation.test.ts
```

Expected: 4 passing (first-grant, lapse+reactivate, killswitch off, revoke-alone).

```bash
git add apps/api/test/garage/awarder-premium-activation.test.ts
git commit -m "test(api): revoke alone does not award premium_activation XP (chunk 34)"
```

---

## Task 7 — Concurrent two-request premium grant idempotency

**Files:**

- Modify: `apps/api/test/garage/awarder-premium-activation.test.ts`

Skeleton §Chunk 34 acceptance: "concurrent activation events idempotent — DB unique catches P2002." Fix-canon §4 + outline §C1 together: the fixed `sourceRef = 'garage:<garageId>'` plus `@@unique([garageId, reason, sourceRef])` mean that when two grant requests race, one wins the row insert and the other's `XpEvent.create` raises `P2002`, which the awarder swallows silently. Final state: `Garage.xp === 200`, exactly one `premium_activation` `XpEvent` row.

- [ ] **Step 7.1: Add the concurrent grants test**

Append inside the `describe` block:

```ts
it('concurrent two-request premium grants — final Garage.xp === 200, exactly one XpEvent row (one-shot per §C1 + canon §4)', async () => {
  const { user: org } = await createUser({
    email: 'o5@jdm.test',
    verified: true,
    role: 'organizer',
  });
  const { user: target } = await createUser({ email: 't5@jdm.test', verified: true });
  const gid = await garageIdFor(target.id);

  // Two simultaneous grants targeting the same garage. The DB
  // `@@unique([garageId, reason, sourceRef])` plus the fixed
  // `sourceRef = 'garage:<garageId>'` make the loser hit P2002 inside
  // awardXp; chunk 27 catches it and returns awarded:false silently.
  // Both HTTP responses still succeed — premium grant itself does not
  // depend on the awarder write (fix-canon §5).
  const [r1, r2] = await Promise.all([
    grantPremium(app, org.id, target.id, {
      tier: 'gold',
      premiumUntil: '2030-01-01T00:00:00.000Z',
    }),
    grantPremium(app, org.id, target.id, {
      tier: 'silver',
      premiumUntil: '2031-01-01T00:00:00.000Z',
    }),
  ]);
  expect(r1.statusCode).toBe(200);
  expect(r2.statusCode).toBe(200);

  // Final XP exactly +200 — the duplicate side's P2002 was swallowed.
  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(200);

  // Exactly one premium_activation row with the canonical sourceRef.
  const events = await prisma.xpEvent.findMany({
    where: { garageId: gid, reason: 'premium_activation' },
  });
  expect(events).toHaveLength(1);
  expect(events[0]!.sourceRef).toBe(`garage:${gid}`);
  expect(events[0]!.delta).toBe(200);
});
```

- [ ] **Step 7.2: Run + commit**

```bash
pnpm --filter @ccc/api test -- apps/api/test/garage/awarder-premium-activation.test.ts -t 'concurrent'
```

Expected: 1 passing.

```bash
git add apps/api/test/garage/awarder-premium-activation.test.ts
git commit -m "test(api): concurrent premium grants stay one-shot (chunk 34)"
```

---

## Verification (final)

- [ ] **Step V.1: Targeted vitest run — full file**

```bash
pnpm --filter @ccc/api test -- apps/api/test/garage/awarder-premium-activation.test.ts
```

Expected: **5 passing, 0 failing, 0 skipped**.

Test names (verbatim, for the PR body):

1. `first premium grant awards +200 XP and writes one XpEvent row`
2. `lapse + re-activate does NOT award a second +200 (one-shot ever per §invariant 3)`
3. `killswitch off — premium grants succeed but no XpEvent or Garage.xp change`
4. `revoke (no prior grant) does not award XP`
5. `concurrent two-request premium grants — final Garage.xp === 200, exactly one XpEvent row (one-shot per §C1 + canon §4)`

- [ ] **Step V.2: Regression — existing premium-grant tests still pass**

The chunk-2A admin premium-grant tests in `apps/api/test/admin/user-garage/admin-user-garage.test.ts` MUST stay green — the splice is additive, not breaking.

```bash
pnpm --filter @ccc/api test -- apps/api/test/admin/user-garage/admin-user-garage.test.ts
```

Expected: all existing tests pass (the count is whatever's on `main` at chunk-34 time; the splice should not change it).

- [ ] **Step V.3: Touched-file typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: clean.

- [ ] **Step V.4: Memory-rule check — no shared rebuild needed**

`@ccc/shared` was not touched (the awarder call uses an internal API). `packages/db` was not touched (XpEvent model is chunk 23 — already on `main` when this chunk lands). The CLAUDE.md memory rule about rebuilding `@ccc/shared/dist` does NOT apply.

```bash
git status
```

Expected staged paths only:

- `apps/api/src/routes/admin/user-garage.ts` (modified, ~5 lines added)
- `apps/api/test/garage/awarder-premium-activation.test.ts` (new)

Per CLAUDE.md memory `feedback_no_full_test_suite_locally.md`: do NOT run the full workspace test suite locally. CI on the PR will run the full sweep.

---

## Deviation log

Document anything that drifted from the skeleton seed.

- **Skeleton seed line 357 mentioned `stripe-webhook.ts` and `abacatepay-webhook.ts` as possible premium-grant write paths.** Verified on `main` at chunk-34 kickoff: **only `apps/api/src/routes/admin/user-garage.ts` (`POST /admin/users/:id/garage/premium`) is a premium write path**. Stripe + AbacatePay handlers in this repo grant `eventTickets` / event entitlements, not garage premium. The skeleton seed hedged correctly; verification narrowed it to one site. **Not a true deviation** — the skeleton allowed for "verify before editing." Note in PR §"Verification" so the next reviewer doesn't re-grep.

If a Stripe-driven premium subscription path lands BEFORE this PR merges, splice the same `awardXp(tx, garage.id, 'premium_activation', { sourceRef: \`garage:${garage.id}\` })` into the matching grant-direction tx in that handler, and add a parallel test case. Append a line here.

---

## PR checklist (branch `feat/jdma-garage-phase2-34`)

- [ ] Branch was cut from a freshly-pulled `main` (Step 0 preflight passed).
- [ ] Only two files changed: `apps/api/src/routes/admin/user-garage.ts` (modified) + `apps/api/test/garage/awarder-premium-activation.test.ts` (new). Verify with `git diff --stat main...HEAD`.
- [ ] `awardXp` call lives **inside** the `prisma.$transaction(async (tx) => { ... })` callback in the `POST /users/:id/garage/premium` handler (not after it).
- [ ] First argument to `awardXp` is the **`tx` from the callback**, NOT `prisma`.
- [ ] `awardXp` call is gated by `if (!isRevoke)` — revoke does NOT award.
- [ ] `sourceRef` is exactly `\`garage:${garage.id}\`` — string-interpolated against the just-loaded garage row, NOT `\`garage:${id}\``(the param is`userId`, not `garageId`).
- [ ] Reason string is exactly `'premium_activation'` (matches the XpReason enum from chunk 23).
- [ ] No call to `awardXp` from a revoke branch or from the `PATCH /users/:id/garage` route.
- [ ] All 5 tests in `awarder-premium-activation.test.ts` pass (including the concurrent two-request grant case).
- [ ] `awardXp` call is NOT wrapped in try/catch (fix-canon §5 — callers let unexpected errors propagate so the parent tx rolls back).
- [ ] Existing `admin-user-garage.test.ts` regression: still green.
- [ ] `pnpm --filter @ccc/api typecheck` clean.
- [ ] No edits to `packages/shared`, `packages/db`, `xp-awarder.ts`, `killswitch.ts`, or any other route file.
- [ ] No edits to `production` branch (CLAUDE.md branch safety).
- [ ] PR opened against `main` (not `production`).
- [ ] PR body links to: (a) skeleton §Chunk 34, (b) outline §"Locked invariants" #3 + #6, (c) outline §"Decisions locked at kickoff" #1, (d) outline §C1, (e) outline §437 awarder-rules table row `premium_activation`. Reference paths only; do not copy.
- [ ] PR title: `feat(api): award +200 XP on first premium activation (chunk 34)`.
- [ ] PR §"Deviations" notes the single-call-site finding (skeleton seed mentioned two webhook paths; verified one).

---

## Self-review notes

- **Spec coverage:** skeleton acceptance criteria → tasks:
  - "First premium activation +200" → Task 1.
  - "Lapse + re-activation no second +200" → Task 3.
  - "AbacatePay path treated identically" → §Deviation log: path does not write premium today; if it ever does, same splice applies.
  - "Concurrent activation events idempotent (DB unique catches P2002)" → Task 7 (concurrent two-request grant via `Promise.all`); chunk 27's unit-level idempotency test is the canonical proof; this chunk asserts it at the route boundary.
- **Placeholders:** none. Every code block is final source.
- **Type consistency:** `awardXp` 4-arg positional signature matches fix-canon §4 and chunk 27. `'premium_activation'` matches `XpReason` enum from chunk 23 / outline §332. `sourceRef` format `garage:<garageId>` matches outline line 449.
- **§C1 compliance:** fixed `sourceRef` + DB `@@unique([garageId, reason, sourceRef])` are the one-shot enforcer. No app-layer history scan. Tasks 3 and 7 lock contract via runtime tests (sequential and concurrent); chunk 27 covers the P2002 swallow at unit level.
- **Tx safety:** `awardXp` first arg is `tx`, not `prisma` — verified Task 5 Step 5.1. PR checklist re-verifies. No try/catch around `awardXp` (fix-canon §5).
- **Scope vs verification alignment:** Scope no longer claims awarder-throw swallowing or parent-tx rollback as in-scope runtime cases — both are chunk 27's contract. Task 5 only does static call-site verification, matching Scope.
