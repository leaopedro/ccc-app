# Chunk 27 — `XPAwarder` service (`awardXp` + `revertLikeXp`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Checkbox-tracked.

**Goal:** Chokepoint XP awarder. Owns the idempotency contract (`@@unique([garageId, reason, sourceRef])` + P2002 catch-and-skip per §C1), the sync killswitch gate (§C5), and the same-tx safety guarantee that every Phase 2B hook (chunks 29-35) depends on.

**Architecture:** Mirror Phase 1's `awardBadge` in `apps/api/src/services/garage/awarder.ts` (chunk 18). Killswitch read first via the passed `tx` so it joins the caller's snapshot. `tx.xpEvent.create` inside try/catch — `P2002` → silent `{ awarded: false, reason: 'duplicate' }`. On success, `tx.garage.update` with `xp: { increment: delta }`. `revertLikeXp` does conditional `findUnique` + `delete` + decrement-pair per §C2 — no-op when no prior row.

**Tech Stack:** Fastify + Prisma, `@prisma/client` `TransactionClient`, vitest + real Postgres via `apps/api/test/helpers.ts` (`makeApp`, `resetDatabase`, `createUser`). NO mocks (CLAUDE.md).

**Branch:** `feat/jdma-garage-phase2-27` from fresh `main`. NEVER branch from `production` (CLAUDE.md preflight).

---

## Required reading (before any code)

1. `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` — §C1, §C2, §C3, §C5, §C8 (corrections override inline outline), §437 (rules table), §"Locked invariants" #3 + #4, §455 rules 1-6.
2. `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` — §"Chunk 27".
3. `apps/api/src/services/garage/awarder.ts` — Phase 1 chunk 18 pattern. MIRROR this style.
4. `apps/api/src/services/garage/killswitch.ts` — `readGamificationEnabled(tx)`.
5. `apps/api/src/lib/prisma-errors.ts` — `isUniqueConstraintError(err)`.
6. `apps/api/test/garage/awarder.test.ts` — test style.
7. `CLAUDE.md` — branch preflight + real-Postgres integration tests.

## Dependencies (merged on `main` before this chunk)

- **Chunk 23** — `Garage.xp`, `Garage.likesReceived`, `XpEvent`, `XpReason`, `@@unique([garageId, reason, sourceRef])`.
- **Chunk 24** — shared zod (not consumed directly).
- **Chunk 26** — `RANK_TIERS` (sibling, not consumed).

If any is missing, STOP and dispatch it first.

## Corrections that apply

- **§C1** — DB-enforced uniqueness. Use `tx.xpEvent.create` inside try/catch for P2002. NEVER pre-read.
- **§C2** — `revertLikeXp(tx, postId, reactionId, authorGarageId)`. `findUnique` first; no row → `{ reverted: false }`. Row present → `delete` + decrement `xp` AND `likesReceived` in same tx.
- **§C3** — `sourceRef` for `post_like` is `post:<postId>:reaction:<reactionId>` (opaque reaction id, NOT `likerUserId`).
- **§C5** — Sync read every call. NO 30s cache. Pass `tx` so gate joins caller's snapshot. Chunk 27 owns this contract for every 2B hook.
- **§C8** — `admin_adjustment` is the ONLY signed-delta reason. All others positive; revert paths hard-delete.

### Fix canon decisions applied (from `/tmp/phase2-fix-canon.md`)

- **Canon §4** — `awardXp(tx, garageId, reason, opts)` positional 4-arg signature. Opts shape: `{ sourceRef: string; delta?: number; rarity?: BadgeRarity }`. Matches the skeleton + every consumer (chunks 29-35).
- **Canon §5** — Error contract: killswitch-off → `{ awarded: false, reason: 'gamification_disabled' }`; P2002 → silent `{ awarded: false, reason: 'duplicate' }`; any other error RETHROWS so the parent tx rolls back. Same shape for `revertLikeXp`.
- **Canon §6** — Awarder owns `Garage.likesReceived`. `awardXp('post_like', ...)` increments BOTH `xp` and `likesReceived` in one `prisma.garage.update`; `revertLikeXp` decrements both. Chunk 32 (route hook) MUST NOT touch `likesReceived` directly.
- **Canon §7** — `sourceRef` is non-null at the awarder boundary on every write (DB column stays nullable for migration compat).
- **Canon §8** — Test fixtures upsert `GeneralSettings` using `GENERAL_SETTINGS_SINGLETON_ID` (imported from `killswitch.ts`). Never `id: 1`.
- **Canon §10** — Filtered test/lint commands use `pnpm --filter @ccc/api exec vitest|eslint <PACKAGE-ROOT-RELATIVE-PATH>`.

## File structure (touched paths only)

```
apps/api/src/services/garage/xp-awarder.ts            (new)
apps/api/test/garage/xp-awarder.test.ts               (new)
apps/api/test/garage/xp-revert-on-unlike.test.ts      (new)
```

No other files. Phase 2B route hooks (29-35) wire callers; chunk 28 wires payload — both out of scope here.

---

## Canonical code shape — `apps/api/src/services/garage/xp-awarder.ts`

```ts
import type { Prisma, XpReason, BadgeRarity } from '@prisma/client';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';

import { readGamificationEnabled } from './killswitch.js';

export type AwardXpOutcome = {
  awarded: boolean;
  delta?: number;
  reason?: 'gamification_disabled' | 'duplicate';
};

export type RevertLikeXpOutcome = {
  reverted: boolean;
  reason?: 'gamification_disabled' | 'not_found';
};

/**
 * Positional 4-arg signature — `awardXp(tx, garageId, reason, opts)`.
 * Matches the skeleton and every consumer (chunks 29-35). Per fix canon §4.
 *
 *   - `sourceRef`: required, non-null at the awarder boundary (canon §7).
 *   - `delta`: ONLY `admin_adjustment` consumes this (signed; §C8). Other reasons
 *     resolve their delta from the §437 rules table.
 *   - `rarity`: ONLY `badge_award` consumes this (resolves +25 / +50 / +100).
 */
export type AwardXpOpts = {
  sourceRef: string;
  delta?: number;
  rarity?: BadgeRarity;
};

const XP_DELTAS = {
  event_checkin: 10,
  car_create: 5,
  post_create: 2,
  post_like: 1,
  badge_award: { common: 25, rare: 50, legendary: 100 } as const,
  premium_activation: 200,
} as const;

const resolveDelta = (reason: XpReason, opts: AwardXpOpts): number => {
  if (reason === 'admin_adjustment') {
    if (opts.delta === undefined) throw new Error('admin_adjustment requires opts.delta');
    return opts.delta; // signed §C8
  }
  if (reason === 'badge_award') {
    if (!opts.rarity) throw new Error('badge_award requires opts.rarity');
    return XP_DELTAS.badge_award[opts.rarity];
  }
  return XP_DELTAS[reason];
};

/**
 * Invariants:
 *   1. Killswitch first — sync read via `tx` (§C5). No cache. Returns
 *      `{ awarded: false, reason: 'gamification_disabled' }` without DB writes.
 *   2. Same-tx — caller owns the transaction. XpEvent + Garage.xp increment land
 *      or roll back atomically with the parent write.
 *   3. Idempotency — DB @@unique([garageId, reason, sourceRef]) (§C1). Catch
 *      P2002 → `{ awarded: false, reason: 'duplicate' }` silently. Never pre-read.
 *   4. `post_like` ALSO increments `Garage.likesReceived` in the SAME
 *      `prisma.garage.update` (canon §6). The awarder owns this counter end-to-end;
 *      chunk 32 (route hook) MUST NOT touch `likesReceived` directly.
 *   5. Error contract (canon §5): P2002 → silent duplicate; any other error
 *      RETHROWS so the parent tx rolls back. Callers MUST NOT wrap `awardXp`
 *      in try/catch inside their parent transaction.
 */
export const awardXp = async (
  tx: Prisma.TransactionClient,
  garageId: string,
  reason: XpReason,
  opts: AwardXpOpts,
): Promise<AwardXpOutcome> => {
  const enabled = await readGamificationEnabled(tx);
  if (!enabled) return { awarded: false, reason: 'gamification_disabled' };

  const delta = resolveDelta(reason, opts);
  // admin_adjustment is the only reason accepting non-positive deltas (§C8).
  // The admin route (chunk 35) rejects delta === 0 and bounds-checks [-10000, 10000].

  // post_like co-increments likesReceived in the same statement (canon §6).
  const garageData: Prisma.GarageUpdateInput =
    reason === 'post_like'
      ? { xp: { increment: delta }, likesReceived: { increment: 1 } }
      : { xp: { increment: delta } };

  try {
    await tx.xpEvent.create({
      data: { garageId, delta, reason, sourceRef: opts.sourceRef },
    });
    await tx.garage.update({ where: { id: garageId }, data: garageData });
    return { awarded: true, delta };
  } catch (e) {
    if (isUniqueConstraintError(e)) return { awarded: false, reason: 'duplicate' };
    throw e; // canon §5: rethrow non-P2002 so parent tx rolls back.
  }
};

/**
 * §C2 — Hard-delete the matching XpEvent row + decrement BOTH counters
 * (`xp` and `likesReceived`) in one `prisma.garage.update`. Awarder owns
 * `likesReceived` end-to-end (canon §6). NO -1 audit row left behind
 * (§"Locked invariants" #4). Conditional-on-row prevents counters going
 * negative when:
 *   - killswitch was off at like-time (no prior XpEvent),
 *   - like predates Phase 2 launch (no backfill),
 *   - replay / race (already reverted).
 *
 * Error contract mirrors `awardXp` (canon §5): silent no-op on
 * killswitch-off / not-found; any other error rethrows so the parent
 * tx rolls back.
 */
export const revertLikeXp = async (
  tx: Prisma.TransactionClient,
  postId: string,
  reactionId: string, // opaque, NOT likerUserId §C3
  authorGarageId: string,
): Promise<RevertLikeXpOutcome> => {
  const enabled = await readGamificationEnabled(tx);
  if (!enabled) return { reverted: false, reason: 'gamification_disabled' };

  const sourceRef = `post:${postId}:reaction:${reactionId}`;
  const row = await tx.xpEvent.findUnique({
    where: {
      garageId_reason_sourceRef: { garageId: authorGarageId, reason: 'post_like', sourceRef },
    },
  });
  if (!row) return { reverted: false, reason: 'not_found' };

  await tx.xpEvent.delete({ where: { id: row.id } });
  await tx.garage.update({
    where: { id: authorGarageId },
    data: { xp: { decrement: row.delta }, likesReceived: { decrement: 1 } },
  });
  return { reverted: true };
};
```

---

## Task 1 — Scaffold service module (stubs that throw)

**Files:** Create `apps/api/src/services/garage/xp-awarder.ts`.

- [ ] **1.1:** Create file with the imports, types (`AwardXpOutcome`, `RevertLikeXpOutcome`, `AwardXpOpts`), the `XP_DELTAS` constant, and stubs for `awardXp(tx, garageId, reason, opts)` + `revertLikeXp` that `throw new Error('not implemented')`. The exported `awardXp` MUST use the canonical positional 4-arg signature so consumer chunks 29-35 compile.
- [ ] **1.2:** Run `pnpm --filter @ccc/api typecheck` → PASS. Confirms `XpReason` resolves (chunk 23 merged).
- [ ] **1.3:** Commit: `feat(api): scaffold XP awarder service module (chunk 27)`.

---

## Task 2 — `awardXp` happy path

**Files:** Create `apps/api/test/garage/xp-awarder.test.ts`. Modify `xp-awarder.ts`.

- [ ] **2.1:** Write the failing test. Test shell mirrors `awarder.test.ts`: `beforeEach resetDatabase + makeApp`; helper `garageId(userId)` does `prisma.garage.findUniqueOrThrow({ where: { userId } })`.

```ts
it('event_checkin writes one XpEvent row (+10) and increments Garage.xp', async () => {
  const { user } = await createUser({ email: 'xp1@jdm.test', verified: true });
  const gid = await garageId(user.id);
  const outcome = await prisma.$transaction((tx) =>
    awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' }),
  );
  expect(outcome).toEqual({ awarded: true, delta: 10 });
  const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ reason: 'event_checkin', sourceRef: 'event:e1', delta: 10 });
  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(10);
});
```

- [ ] **2.2:** Run `pnpm --filter @ccc/api test -- xp-awarder.test` → FAIL (`not implemented`).
- [ ] **2.3:** Replace the `awardXp` stub with the canonical body shown above.
- [ ] **2.4:** Re-run → PASS.
- [ ] **2.5:** Commit: `feat(api): awardXp happy path writes XpEvent and increments Garage.xp`.

---

## Task 3 — Cover every reason in the §437 rules table

**Files:** Modify `apps/api/test/garage/xp-awarder.test.ts`.

- [ ] **3.1:** Add 7 tests (each follows the Task-2 shape; vary `reason` + asserted delta; ALL use the canonical positional 4-arg `awardXp(tx, gid, reason, opts)` signature):
  - `car_create awards +5` — `awardXp(tx, gid, 'car_create', { sourceRef: 'car:c1' })`; expect `delta: 5`, garage.xp === 5.
  - `post_create awards +2` — `awardXp(tx, gid, 'post_create', { sourceRef: 'post:p1' })`; expect `delta: 2`.
  - `post_like awards +1 AND increments likesReceived (canon §6) with §C3 opaque-reaction-id sourceRef` — `awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' })`; assert the XpEvent row's `sourceRef` equals that exact string; assert `garage.xp === 1` AND `garage.likesReceived === 1` (the awarder owns BOTH counters in one update).
  - `badge_award rarity table — common +25, rare +50, legendary +100` — three sequential calls with `rarity: 'common' | 'rare' | 'legendary'`, distinct sourceRefs `badge:B1/B2/B3`; final `garage.xp === 175`.
  - `premium_activation awards +200 once and is idempotent on the one-shot triple` — call twice with the same `awardXp(tx, gid, 'premium_activation', { sourceRef: ` `garage:${gid}` ` })`; first → `{ awarded: true, delta: 200 }`; second → `{ awarded: false, reason: 'duplicate' }`; `garage.xp === 200` (§"Locked invariants" #3).
  - `admin_adjustment accepts a positive signed delta (§C8)` — `awardXp(tx, gid, 'admin_adjustment', { sourceRef: 'admin:admin1:uuid-1', delta: 75 })`; expect `delta: 75`, garage.xp === 75.
  - `admin_adjustment accepts a negative signed delta (§C8 — signed, not two-call)` — seed +100 first with `admin:admin1:uuid-seed`; then call with `delta: -40` and `admin:admin1:uuid-2`; final `garage.xp === 60`. Assert deltas as an unordered set: `expect(new Set(rows.map((e) => e.delta))).toEqual(new Set([100, -40]))` (Postgres row order is not guaranteed without `orderBy`).

- [ ] **3.2:** Run targeted test file → all 8 tests PASS (7 new + the Task-2 happy path).
- [ ] **3.3:** Commit: `test(api): cover all XP awarder reasons from §437 rules table`.

---

## Task 4 — Idempotency via P2002 catch-and-skip (§C1)

**Files:** Modify `apps/api/test/garage/xp-awarder.test.ts`.

- [ ] **4.1:** Add three tests (all use the positional 4-arg signature):
  - `is idempotent — second call with same (garageId, reason, sourceRef) triple returns duplicate`: same arguments twice via two separate `prisma.$transaction` calls; first `awarded: true`; second `{ awarded: false, reason: 'duplicate' }`; `xpEvent.count === 1`; `garage.xp === 10`. P2002 is caught SILENTLY — no error escapes (canon §5).
  - `different sourceRefs under the same reason are NOT duplicates`: two `car_create` with `car:c1` and `car:c2`; both `awarded: true`; `garage.xp === 10`.
  - `non-P2002 errors propagate so the parent tx rolls back (canon §5)`: call `awardXp(tx, '00000000-0000-0000-0000-000000000000', 'event_checkin', { sourceRef: 'event:e1' })` against a non-existent `garageId`. The `tx.xpEvent.create` FK violation throws a non-P2002 error; assert `prisma.$transaction(...)` REJECTS (does NOT resolve to a duplicate outcome); assert `xpEvent.count` for the real seeded garage stays 0. This pins the contract that the awarder rethrows unexpected errors.

This is THE invariant — any future regression where `awardXp` pre-reads instead of try/catching on P2002 will break the first test. Reviewer must verify the implementation has NO `findUnique` before `create` AND that only `isUniqueConstraintError(e)` is caught silently.

- [ ] **4.2:** Run → PASS. Commit: `test(api): assert XP awarder idempotency + non-P2002 rethrow contract`.

---

## Task 5 — Killswitch short-circuit (§C5)

**Files:** Modify `apps/api/test/garage/xp-awarder.test.ts`.

- [ ] **5.1:** Add the killswitch-off test:

```ts
import { GENERAL_SETTINGS_SINGLETON_ID } from '../../src/services/garage/killswitch.js';

it('killswitch off — short-circuits before any DB write (no XpEvent, no Garage.xp change)', async () => {
  const { user } = await createUser({ email: 'xp11@jdm.test', verified: true });
  const gid = await garageId(user.id);
  await prisma.generalSettings.upsert({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
    update: { gamificationEnabled: false },
  });
  const outcome = await prisma.$transaction((tx) =>
    awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' }),
  );
  expect(outcome).toEqual({ awarded: false, reason: 'gamification_disabled' });
  expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(0);
  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(0);
});
```

Note: §C5 mandates the read passes `tx`, NOT global `prisma`. Reviewer checks the implementation: `readGamificationEnabled(tx)` — without the `tx` arg, the gate would read from a different snapshot than the writes it guards under Serializable isolation. Mirrors Phase 1 awarder line 95.

- [ ] **5.2:** Run → PASS. Commit: `test(api): killswitch off short-circuits XP awarder before DB write`.

---

## Task 6 — Same-tx parent rollback safety (LOAD-BEARING)

This is the property that makes every 2B hook safe. Without it, a parent failure mid-write would leave an orphan XpEvent + an incremented `Garage.xp`.

**Files:** Modify `apps/api/test/garage/xp-awarder.test.ts`.

- [ ] **6.1:** Add the rollback test:

```ts
it('same-tx safety — parent tx rollback unwrites the XpEvent row and Garage.xp increment', async () => {
  const { user } = await createUser({ email: 'xp12@jdm.test', verified: true });
  const gid = await garageId(user.id);
  await expect(
    prisma.$transaction(async (tx) => {
      const outcome = await awardXp(tx, gid, 'event_checkin', { sourceRef: 'event:e1' });
      expect(outcome.awarded).toBe(true);
      throw new Error('forced parent rollback');
    }),
  ).rejects.toThrow('forced parent rollback');
  expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(0);
  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(0);
});
```

- [ ] **6.2:** Run → PASS. Commit: `test(api): parent tx rollback unwrites XP awarder row + counter`.

---

## Task 7 — `revertLikeXp` happy path (§C2)

**Files:** Create `apps/api/test/garage/xp-revert-on-unlike.test.ts`.

- [ ] **7.1:** Replace the `revertLikeXp` stub with the canonical body shown above. (The awardXp body is already in place; the same file just adds the second export.)

- [ ] **7.2:** Write the happy-path test. Pattern: seed a prior like via a single `awardXp(post_like)` call. The awarder owns BOTH `xp` and `likesReceived` (canon §6), so no manual `likesReceived` bump is needed:

```ts
it('hard-deletes the matching XpEvent row and decrements both counters', async () => {
  const { user } = await createUser({ email: 'rv1@jdm.test', verified: true });
  const gid = await garageId(user.id);
  await prisma.$transaction((tx) =>
    awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' }),
  );
  // Sanity: awarder seeded both counters in one update.
  const before = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(before.xp).toBe(1);
  expect(before.likesReceived).toBe(1);

  const outcome = await prisma.$transaction((tx) => revertLikeXp(tx, 'p1', 'r1', gid));
  expect(outcome).toEqual({ reverted: true });
  expect(await prisma.xpEvent.findMany({ where: { garageId: gid } })).toHaveLength(0);
  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(0);
  expect(g.likesReceived).toBe(0);
});
```

- [ ] **7.3:** Run `pnpm --filter @ccc/api test -- xp-revert-on-unlike.test` → PASS. Commit: `test(api): revertLikeXp hard-deletes XpEvent + decrements both counters`.

---

## Task 8 — `revertLikeXp` no-op safety cases (§C2)

**Files:** Modify `apps/api/test/garage/xp-revert-on-unlike.test.ts`.

- [ ] **8.1:** Add three tests:
  - `no prior row (killswitch was off at like time, then enabled before unlike) — returns reverted:false (replay-safe)`: with `gamificationEnabled: false`, call `awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' })` → outcome is `{ awarded: false, reason: 'gamification_disabled' }` so NO XpEvent is written; assert `xpEvent.count === 0` AND `garage.likesReceived === 0`. Now flip `gamificationEnabled: true` and call `revertLikeXp(tx, 'p1', 'r1', gid)`; expect `{ reverted: false, reason: 'not_found' }`; assert `garage.xp === 0` AND `garage.likesReceived === 0` (NEVER negative). This is the canonical §C2 no-prior-row case (canon §5: silent not_found, no rethrow).
  - `killswitch off at unlike-time — short-circuits without touching DB`: seed prior like via `awardXp(post_like)` while gamification is enabled (one call, awarder co-increments `likesReceived`); flip `gamificationEnabled: false`; call revert; expect `{ reverted: false, reason: 'gamification_disabled' }`; assert `xpEvent.count === 1` AND `garage.xp === 1` AND `garage.likesReceived === 1` (state preserved — re-enable restores intact).
  - `sourceRef format uses opaque reactionId (§C3) — wrong reactionId is a no-op`: seed with `r1` via `awardXp(post_like)`; call revert with `r-other`; expect `{ reverted: false, reason: 'not_found' }`; assert `xpEvent.count === 1` (the r1 row is untouched).

- [ ] **8.2:** Run → PASS. Commit: `test(api): revertLikeXp no-op cases (no prior row, killswitch off, wrong reactionId)`.

---

## Task 9 — Concurrent revert race never goes negative

**Files:** Modify `apps/api/test/garage/xp-revert-on-unlike.test.ts`.

- [ ] **9.1:** Add the race test:

```ts
it('concurrent reverts — only one succeeds, the other returns not_found or rolls back cleanly', async () => {
  const { user } = await createUser({ email: 'rv5@jdm.test', verified: true });
  const gid = await garageId(user.id);
  await prisma.$transaction((tx) =>
    awardXp(tx, gid, 'post_like', { sourceRef: 'post:p1:reaction:r1' }),
  );
  const [a, b] = await Promise.allSettled([
    prisma.$transaction((tx) => revertLikeXp(tx, 'p1', 'r1', gid)),
    prisma.$transaction((tx) => revertLikeXp(tx, 'p1', 'r1', gid)),
  ]);
  const successes = [a, b].filter((r) => r.status === 'fulfilled' && r.value.reverted === true);
  expect(successes).toHaveLength(1);
  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(0); // never -1
  expect(g.likesReceived).toBe(0); // never -1
  expect(await prisma.xpEvent.count({ where: { garageId: gid } })).toBe(0);
});
```

Loser may return `not_found` (read-committed sees the delete) OR throw `P2025` (delete-of-deleted). Either is acceptable; the invariant is `xp` and `likesReceived` end at exactly 0.

- [ ] **9.2:** Run → PASS. Commit: `test(api): concurrent revertLikeXp races keep counters at zero, never negative`.

---

## Task 10 — Final verification + branch hygiene

- [ ] **10.1:** `pnpm --filter @ccc/api typecheck` → PASS.
- [ ] **10.2:** `pnpm --filter @ccc/api exec vitest run test/garage/xp-awarder.test.ts test/garage/xp-revert-on-unlike.test.ts` → PASS. Expected counts: Task 2 (1) + Task 3 (7) + Task 4 (3) + Task 5 (1) + Task 6 (1) = **13 awarder tests**; Task 7 (1) + Task 8 (3) + Task 9 (1) = **5 revert tests**; **18 tests total**. Paths are package-root-relative per canon §10.
- [ ] **10.3:** `pnpm --filter @ccc/api exec eslint src/services/garage/xp-awarder.ts test/garage/xp-awarder.test.ts test/garage/xp-revert-on-unlike.test.ts` → PASS.
- [ ] **10.4:** `git status` shows exactly the 3 chunk files. Per CLAUDE.md memory `feedback_no_full_test_suite_locally.md`, DO NOT run the full test suite locally.
- [ ] **10.5:** `git push -u origin feat/jdma-garage-phase2-27`.

---

## PR checklist

**Branch:** `feat/jdma-garage-phase2-27` from fresh `main` (NOT `production` — CLAUDE.md preflight).

**Commit subject (squash-merge title):**
`feat(api): XP awarder service with idempotency + killswitch gate (chunk 27)`

**PR body (required sections):**

### Summary

Lands the Phase 2 XP chokepoint at `apps/api/src/services/garage/xp-awarder.ts`. Exposes `awardXp(tx, garageId, reason, opts)` (positional 4-arg per canon §4) and `revertLikeXp(tx, postId, reactionId, authorGarageId)`. Sync killswitch gate (§C5), DB-enforced idempotency via P2002 catch with non-P2002 rethrow (§C1, canon §5), opaque-reaction-id sourceRef (§C3), signed delta only for `admin_adjustment` (§C8), conditional-on-row revert (§C2). The awarder owns `Garage.likesReceived` end-to-end (canon §6): `awardXp(post_like)` and `revertLikeXp` co-update `xp` AND `likesReceived` in the same `prisma.garage.update`. Phase 2B hooks (chunks 29-35) consume this service in subsequent PRs.

### Test plan

- [x] `xp-awarder.test.ts` (13 tests): each reason from §437 → correct delta + `Garage.xp` increment; `post_like` also increments `Garage.likesReceived` in same update; idempotency on the (garageId, reason, sourceRef) triple; non-P2002 errors rethrow; killswitch-off short-circuit; same-tx parent rollback unwrites both rows.
- [x] `xp-revert-on-unlike.test.ts` (5 tests): hard-delete + both counter decrements; no-prior-row no-op (killswitch off at like time, then on at unlike); killswitch-off short-circuit at unlike; wrong-reactionId no-op; concurrent race never goes negative.
- [x] `pnpm --filter @ccc/api typecheck` green.
- [x] No full-suite local run (per `feedback_no_full_test_suite_locally.md`).

### Deviations from plan

1. **30s killswitch cache dropped** — outline §458 STALE; §C5 mandates sync read per call.
2. **Signed delta for `admin_adjustment`** — outline §362 STALE; §C8 supersedes the "two-call" pattern. Route (chunk 35) rejects `delta === 0` and bounds [-10000, 10000].
3. **`post_like` sourceRef uses opaque `reactionId`** — outline §444 STALE; §C3 supersedes `likerUserId`. DSR-safe (no leak of liker identity).
4. **`XP_DELTAS` rules table single source of truth** lives in `xp-awarder.ts`. Chunk 38 (`XPTooltip`) must consume the same rule set — copy-or-import decision deferred to that chunk's plan author.
5. **Concurrent revert losers** may throw `P2025` depending on isolation. Test asserts the strong invariant (counters never negative); loser outcome is not pinned.
6. **`awardXp` signature is POSITIONAL 4-arg `(tx, garageId, reason, opts)` per fix canon §4** — replaces the earlier draft `(tx, garageId, opts)` discriminated-union variant. The 4-arg form matches the skeleton + every 2B consumer (chunks 29-35). Opts shape: `{ sourceRef: string; delta?: number; rarity?: BadgeRarity }`. `delta` is REQUIRED for `admin_adjustment` and `rarity` REQUIRED for `badge_award` — validated at runtime by `resolveDelta`.
7. **Awarder owns `Garage.likesReceived` end-to-end per fix canon §6** — `awardXp('post_like', ...)` increments BOTH `xp` and `likesReceived` in a single `prisma.garage.update`; `revertLikeXp` decrements BOTH in a single statement. Chunk 32 (route hook) MUST NOT touch `likesReceived` directly.
8. **Non-P2002 errors RETHROW (canon §5)** — only `isUniqueConstraintError(e)` is caught silently. Any other error propagates so the parent tx rolls back. Callers (chunks 29-35) MUST NOT wrap `awardXp` in try/catch inside their parent transaction. This contract is pinned by an explicit non-P2002 rethrow test in Task 4.

### Reads from / parallel-with

- Reads: chunks 23 (schema), 24 (zod, not directly consumed), 26 (RANK_TIERS, not directly consumed). All merged on `main`.
- Parallel-with: none in Wave 2A. Chunk 28 (route payloads) depends on this landing first.

### Reviewer focus

1. **Signature is positional 4-arg** `awardXp(tx, garageId, reason, opts)` per canon §4 — must match the skeleton + every consumer (chunks 29-35). Drift here cascades into 7 downstream chunks.
2. Killswitch read MUST pass `tx` (`readGamificationEnabled(tx)`) — NOT global prisma. Otherwise Serializable isolation reads a different snapshot than the writes it gates. Mirrors Phase 1 awarder line 95.
3. **P2002 is the ONLY silent path (canon §5).** Any other error must rethrow so the parent tx rolls back. The non-P2002 rethrow test in Task 4 pins this.
4. `revertLikeXp` MUST `findUnique` first, never blind `delete`. Blind delete on missing row throws P2025 and crashes the unlike route on killswitch-flip / pre-launch likes / replay.
5. `admin_adjustment` is the ONLY reason whose delta can be non-positive. Verify `resolveDelta` switch: `opts.delta` only for admin; `XP_DELTAS` static for all others.
6. **`Garage.likesReceived` ownership lives here (canon §6).** `awardXp('post_like', ...)` increments BOTH `xp` and `likesReceived` in the SAME `prisma.garage.update`. `revertLikeXp` decrements both. Chunk 32's route hook MUST NOT touch `likesReceived` — verify it stays untouched outside this service.

---

## Self-review

- [x] **Spec coverage:** each of §C1, §C2, §C3, §C5, §C8 has ≥ 1 explicit test. §437 rules table: 1 test per reason. §"Locked invariants" #3 (premium one-shot) + #4 (like/unlike hard-delete) covered.
- [x] **No placeholders:** every step has runnable code or an exact command. No "TODO" / "handle edge cases" anywhere.
- [x] **Type consistency:** `AwardXpOutcome`, `RevertLikeXpOutcome`, `AwardXpOpts`, `awardXp(tx, garageId, reason, opts)`, `revertLikeXp` names + positional 4-arg signature match across service, both test files, PR body, and consumer chunks 29-35.
- [x] **Sentinel cases:** §C2 no-prior-row, killswitch-off at like vs unlike time, wrong reactionId, concurrent race — all explicit.
- [x] **Same-tx rollback** is its own task (Task 6) — the property every 2B hook depends on.
- [x] **Branch policy:** `feat/jdma-garage-phase2-27` from fresh `main`, NOT `production`.
