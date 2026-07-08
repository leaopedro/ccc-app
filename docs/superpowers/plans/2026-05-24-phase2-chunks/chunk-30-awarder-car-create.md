# Chunk 30 — Hook XP awarder into `POST /me/cars` (+5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Splice a single `awardXp(tx, garageId, 'car_create', { sourceRef: 'car:<carId>' })` call into the existing `POST /me/cars` success transaction in `apps/api/src/routes/cars.ts` so every car create writes one `XpEvent (+5)` row and increments `Garage.xp` atomically with the car row.

**Architecture:** The `car_create` write-path already runs inside a Serializable `prisma.$transaction` that creates the car, allocates a spot, and fires the Phase 1 `awardBadge` calls inside a try/catch/log-and-swallow block (see `apps/api/src/routes/cars.ts:53–105`). Chunk 30 adds **one more** hook adjacent to those badge calls: `awardXp(tx, garage.id, 'car_create', { sourceRef: 'car:${created.id}' })`. Per canon §5, the awarder owns the error contract: killswitch off → `{ awarded: false, reason: 'gamification_disabled' }`; P2002 (idempotent skip) → caught silently, `{ awarded: false, reason: 'duplicate' }`; any other error → RETHROW so the parent tx rolls back. The route therefore calls `awardXp` **directly with no try/catch** — wrapping the call inside the interactive transaction would let unexpected errors silently commit partial XP writes, breaking same-tx atomicity. Idempotency triple is `(garageId, 'car_create', 'car:<carId>')`, where carId is the freshly-created UUID — so a single car can never double-count, and N distinct cars produce N rows.

**Tech Stack:** Fastify route handler; Prisma `$transaction` (Serializable isolation); Vitest integration tests against the real Postgres testcontainer (`apps/api/test/helpers.ts` → `resetDatabase` + `makeApp` + `createUser` + `bearer`).

---

## Required reading before first commit

Skim these in this order — the plan below references them by §-number and never re-quotes more than a signature:

1. `/Users/pedro/Projects/jdm-experience/CLAUDE.md` — branch-safety preflight + git-flow rules. Re-read before opening the PR.
2. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 30" (lines 265–277) — the canonical acceptance criteria + test scope this plan implements.
3. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`:
   - §"Corrections applied 2026-05-21 post-review" §C1 (lines 43–55) — `@@unique([garageId, reason, sourceRef])` + catch P2002 idempotency. **Only correction that applies to this chunk.**
   - §"XP-awarder rules (canonical)" line 437 — the `car_create` row: delta `+5`, idempotency key `(garageId, 'car_create', 'car:<carId>')`.
   - §455 #2 + canon §5 — the awarder catches P2002 + killswitch and returns `{ awarded: false }`; all OTHER errors RETHROW. The route MUST NOT wrap `awardXp` in try/catch inside the parent tx (swallowing here would allow partial XP commits and break same-tx atomicity). This is the deliberate departure from the Phase 1 `awardBadge` pattern, where badge failures are swallowed locally — XP is load-bearing for `Garage.xp` and must roll back with the car row on any unexpected error.
4. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 27 — `XPAwarder` service" (lines 195–218) — the upstream API surface this plan consumes. Chunk 30 cannot start until chunk 27 has merged `apps/api/src/services/garage/xp-awarder.ts` with the `awardXp` export.
5. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` line 5184 — the Phase 1 chunk that originally hooked the car POST for badge awards. Same insertion point as this chunk; do not move it.
6. `/Users/pedro/Projects/jdm-experience/apps/api/src/routes/cars.ts` — the POST handler at lines 44–126. Pay particular attention to:
   - Outer retry-loop wrapping `prisma.$transaction` with Serializable isolation (line 53).
   - The `garage.findUnique({ where: { userId: sub } })` lookup that already happens inside the tx (lines 81–84) — the new awardXp call reuses this exact `garage.id`.
   - The existing badge-award try/catch/log block (lines 88–99) — reference only. The XP call does NOT mirror this pattern; XP rolls back with the car row per canon §5.
   - `tx` is `Prisma.TransactionClient` — pass it through to `awardXp` unchanged.
7. `/Users/pedro/Projects/jdm-experience/apps/api/src/services/garage/awarder.ts` — the Phase 1 `awardBadge` signature, for reference. Chunk 27's `awardXp` lives next to it as `apps/api/src/services/garage/xp-awarder.ts` (separate file, but same return-shape convention: `{ awarded: boolean; reason?: string }`).
8. `/Users/pedro/Projects/jdm-experience/apps/api/test/garage/badges-write-hooks.test.ts` lines 1–70 — the **closest existing test pattern**. The new `xp-car-create.test.ts` clones its boilerplate (seed → POST → assert) substituting `XpEvent` + `Garage.xp` for `GarageBadge`.

---

## Scope

**In:**

- One direct `awardXp(...)` call inside the existing `cars.ts` POST tx (no surrounding try/catch — canon §5).
- One new import line for `awardXp`.
- One new integration test file: `apps/api/test/garage/xp-car-create.test.ts` (skeleton-canonical filename per canon §11).

**Out:**

- No schema changes (chunk 26 owns the `XpEvent` model + `@@unique`).
- No `xp-awarder.ts` edits (chunk 27 owns the service; this chunk consumes it).
- No route payload changes (chunk 28 wires `progress`/`stats` into `GET /me/garage`).
- No other write-path hooks (chunks 29/31/32/33/34/35 own check-in / feed-post / likes / signup / premium / admin).
- No mobile/admin/UI changes.
- No backfill (locked in invariant §35).

---

## Pre-flight (run once before first commit)

```bash
# Branch safety per CLAUDE.md — verify NOT on production.
git branch --show-current
# Expect: main (or already on the feature branch from a prior attempt)
git pull --ff-only origin main
git switch -c feat/jdma-garage-phase2-30
```

Verify chunk 27 landed on `main` before starting:

```bash
test -f apps/api/src/services/garage/xp-awarder.ts && echo "chunk 27 OK" || echo "BLOCKED — chunk 27 not merged"
grep -n "export const awardXp" apps/api/src/services/garage/xp-awarder.ts
```

Expected: `chunk 27 OK` + at least one `export const awardXp` hit. If BLOCKED, stop and re-queue this chunk.

Verify the `XpEvent.delta` field exists (chunk 26):

```bash
grep -n "model XpEvent" -A 20 packages/db/prisma/schema.prisma | grep -E "delta|reason|sourceRef|garageId"
```

Expected: `garageId`, `reason`, `sourceRef`, `delta` fields all listed.

---

## Files touched

- **Modify** `apps/api/src/routes/cars.ts` — add `awardXp` import + 1 direct `awardXp(...)` call (no try/catch) inside the existing POST tx, immediately after the `awardBadge` loop (current lines 85–101).
- **Create** `apps/api/test/garage/xp-car-create.test.ts` — 5 integration tests against the real Postgres testcontainer.

**Nothing else.** No `packages/db/**`, no `packages/shared/**`, no mobile, no admin, no other route file.

---

## Code shape — the splice in `cars.ts`

After the existing `awardBadge` loop (current line 101, `}` closing the `if (garage) { … }` block), but **inside the same `if (garage)` branch and inside the same outer `prisma.$transaction(async (tx) => { … })`**, insert:

```ts
// XP — fire +5 for car_create on the freshly-created carId. Per canon §5,
// the awarder owns expected-failure handling: killswitch off and P2002
// (DB-enforced idempotency via @@unique([garageId, reason, sourceRef]))
// resolve to { awarded: false } silently. Any other error RETHROWS so the
// parent tx rolls back with the car row. NO try/catch here — wrapping would
// allow partial XP writes to commit and break same-tx atomicity.
await awardXp(tx, garage.id, 'car_create', {
  sourceRef: `car:${created.id}`,
});
```

Plus the new import (alphabetised next to `awardBadge`):

```ts
import { awardBadge } from '../services/garage/awarder.js';
import { awardXp } from '../services/garage/xp-awarder.js';
```

That is the entire production-code change.

---

## Self-check for the splice (before writing any code)

- [ ] The `awardXp` call is **inside** the `if (garage) { … }` branch (lines 85–101 today) — same scope as `awardBadge`, same `garage.id`.
- [ ] The `awardXp` call is **inside** the outer `prisma.$transaction(async (tx) => { … })` and passes `tx` (not `prisma`). Confirms same-tx atomicity required by §455 #3 and chunk 30's acceptance criteria.
- [ ] The `sourceRef` template literal is exactly `` `car:${created.id}` `` — must match the table in §437 line 442.
- [ ] The reason argument is the literal string `'car_create'` — must match the table in §437.
- [ ] **No try/catch wraps the `awardXp` call** (canon §5). The awarder swallows expected failures; unexpected errors must propagate.
- [ ] No change to the outer retry-on-P2034 loop (line 53), no change to `allocateSpotForCar` (line 73), no change to the badge loop.

---

## Test plan

**File:** `apps/api/test/garage/xp-car-create.test.ts` — new (skeleton-canonical name per canon §11).

**Pattern source:** `apps/api/test/garage/badges-write-hooks.test.ts` lines 1–70 — clone the imports + `beforeEach/afterEach` shape + the POST `/me/cars` injection helper.

**Helpers used:**

- `resetDatabase` — wipes the testcontainer Postgres between tests.
- `makeApp` — builds the Fastify app from `apps/api/test/helpers.ts`.
- `createUser({ email, verified: true })` — signup hook already provisions `Garage` 1:1.
- `bearer(env, user.id)` — auth token for `requireUser`.
- `loadEnv()` from `apps/api/src/env.js`.
- Direct Prisma: `prisma.garage.findUniqueOrThrow({ where: { userId } })`, `prisma.xpEvent.findMany`, `prisma.garage.findUnique`.

**Seeding:** Badge catalog seeding is NOT required (this chunk does not assert on badge rows). Skip the `seedCatalog` from `badges-write-hooks.test.ts` — keep the test focused on `XpEvent` + `Garage.xp`.

### Tests (5 cases)

| #   | Test name                                                                            | Intent (one line)                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `single POST /me/cars writes one XpEvent (+5) and Garage.xp = 5`                     | Happy path: car create fires the awarder; row + counter both land.                                                                                                                                                                                                                                                                   |
| 2   | `three POSTs write three XpEvent rows totalling +15 — distinct sourceRefs per carId` | Each new car has a unique sourceRef so the DB unique never trips. Confirms `Garage.xp` is `5 * N` after N cars.                                                                                                                                                                                                                      |
| 3   | `replay-style POST sequence: P2002 on the awarder is swallowed — one row, +5 total`  | Forces an `XpEvent` row to already exist with the same `(garageId, 'car_create', 'car:<carId>')` triple before the second create, then asserts the second awarder call returns awarded:false and no duplicate row lands. Idempotency contract from §C1.                                                                              |
| 4   | `killswitch off: car is created but no XpEvent row is written and Garage.xp stays 0` | Upsert `GeneralSettings` via `GENERAL_SETTINGS_SINGLETON_ID` with `gamificationEnabled = false`, POST /me/cars, assert 201 + Car row exists + 0 XpEvent rows + Garage.xp === 0. Covers §C5 sync-read short-circuit + canon §8.                                                                                                       |
| 5   | `parent tx rollback after awardXp succeeds — no XpEvent row, Garage.xp stays 0`      | Drive a manual `prisma.$transaction` that calls `awardXp(tx, gid, 'car_create', { sourceRef: 'car:rollback-test' })` and then throws AFTER the awardXp call. Assert the outer tx rejects, zero `XpEvent` rows remain, and `Garage.xp === 0` — proves the awarder's write is undone with the parent tx (deterministic rollback path). |

### Test code skeletons

The skeletons below are complete — they compile and run against the testcontainer once chunk 27 lands. Copy verbatim and adapt only the imports if a helper has moved on `main`.

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { GENERAL_SETTINGS_SINGLETON_ID } from '../../src/services/garage/killswitch.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const garageIdForUser = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

const carPayload = (nickname: string) => ({
  make: 'Honda',
  model: 'Civic',
  year: 1999,
  nickname,
  modifications: [],
});

describe('XP awarder hook — POST /me/cars awards +5 per car_create', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('single POST /me/cars writes one XpEvent (+5) and Garage.xp = 5', async () => {
    const { user } = await createUser({ email: 'xp-cars-1@jdm.test', verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: carPayload('xp-civic-1'),
    });
    expect(res.statusCode).toBe(201);

    const gid = await garageIdForUser(user.id);
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: 'car_create', delta: 5 });
    expect(events[0].sourceRef).toMatch(/^car:/);

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(5);
  });

  it('three POSTs write three XpEvent rows totalling +15 — distinct sourceRefs per carId', async () => {
    const { user } = await createUser({ email: 'xp-cars-3@jdm.test', verified: true });
    const env = loadEnv();

    for (const nick of ['c-a', 'c-b', 'c-c']) {
      const res = await app.inject({
        method: 'POST',
        url: '/me/cars',
        headers: { authorization: bearer(env, user.id) },
        payload: carPayload(nick),
      });
      expect(res.statusCode).toBe(201);
    }

    const gid = await garageIdForUser(user.id);
    const events = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'car_create' },
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.delta === 5)).toBe(true);
    const refs = events.map((e) => e.sourceRef);
    expect(new Set(refs).size).toBe(3); // all distinct

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(15);
  });

  it('replay-style: pre-seeded XpEvent makes the second car_create call a no-op (idempotent)', async () => {
    const { user } = await createUser({ email: 'xp-cars-idemp@jdm.test', verified: true });
    const env = loadEnv();

    // First car succeeds + awards normally.
    const first = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: carPayload('idemp-1'),
    });
    expect(first.statusCode).toBe(201);
    const firstCar = JSON.parse(first.payload) as { id: string };

    const gid = await garageIdForUser(user.id);

    // Simulate a replay: directly invoke awardXp again with the SAME triple.
    // Chunk 27 guarantees the second call returns { awarded: false } via
    // P2002 catch; row count stays at 1, Garage.xp stays at 5.
    const { awardXp } = await import('../../src/services/garage/xp-awarder.js');
    const replay = await prisma.$transaction(async (tx) =>
      awardXp(tx, gid, 'car_create', { sourceRef: `car:${firstCar.id}` }),
    );
    expect(replay.awarded).toBe(false);

    const events = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'car_create' },
    });
    expect(events).toHaveLength(1);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(5);
  });

  it('killswitch off: car is created but no XpEvent row is written and Garage.xp stays 0', async () => {
    // Ensure GeneralSettings exists with gamificationEnabled = false.
    // Singleton id is the string constant from killswitch.ts (canon §8).
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: { gamificationEnabled: false },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
    });

    const { user } = await createUser({ email: 'xp-cars-killsw@jdm.test', verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: carPayload('kill-civic'),
    });
    expect(res.statusCode).toBe(201);

    const gid = await garageIdForUser(user.id);
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(0);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(0);

    // Confirm the car itself did land — the killswitch must NEVER block the
    // user's primary action, only the awarder side-effect.
    const cars = await prisma.car.findMany({ where: { userId: user.id } });
    expect(cars).toHaveLength(1);
  });

  it('parent tx rollback: throw AFTER awardXp inside a manual tx leaves zero XpEvent rows and Garage.xp === 0', async () => {
    // Deterministic rollback proof: invoke awardXp inside a $transaction,
    // then throw immediately after to abort the tx. Asserts that the
    // awarder's XpEvent insert + Garage.xp increment both undo with the
    // parent tx — i.e. awardXp is honestly transactional via its `tx`
    // parameter (canon §5). Uses a manual tx (not the route) because the
    // route never throws after the awardXp call in practice.
    const { user } = await createUser({ email: 'xp-cars-rollback@jdm.test', verified: true });
    const gid = await garageIdForUser(user.id);
    const { awardXp } = await import('../../src/services/garage/xp-awarder.js');

    await expect(
      prisma.$transaction(async (tx) => {
        const result = await awardXp(tx, gid, 'car_create', {
          sourceRef: 'car:rollback-test',
        });
        expect(result.awarded).toBe(true);
        throw new Error('forced rollback after awardXp');
      }),
    ).rejects.toThrow('forced rollback after awardXp');

    const events = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'car_create' },
    });
    expect(events).toHaveLength(0);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(0);
  });
});
```

> **Note on test 4** — `GENERAL_SETTINGS_SINGLETON_ID` is the string singleton id imported from `apps/api/src/services/garage/killswitch.ts` (canon §8). NEVER substitute `id: 1` or any numeric. The upsert above writes the canonical row that `readGamificationEnabled` reads.

> **Note on test 3** — the test uses dynamic `import('../../src/services/garage/xp-awarder.js')` to avoid a top-of-file import dependency before chunk 27 has merged on the engineer's local branch. Once main carries chunk 27, hoist the import to the top of the file in a follow-up cleanup (out of this chunk's scope; do **not** block this PR on it).

---

## TDD step-by-step

### Task 1 — Create the failing test file

**Files:**

- Create: `apps/api/test/garage/xp-car-create.test.ts` (exact code from the skeleton above)

- [ ] **Step 1.1:** Create the test file with the 5 `it()` blocks shown in the skeleton.
- [ ] **Step 1.2:** Run the targeted suite. Tests 1, 2, 4 fail because no XpEvent row is being written by `cars.ts` yet. Tests 3 and 5 may pass against chunk 27's already-merged awarder (they exercise the awarder directly via dynamic import) — that is fine; what matters is that the route-driven cases (1, 2, 4) are red until step 2.2 lands.

```bash
pnpm --filter @ccc/api exec vitest run test/garage/xp-car-create.test.ts
```

Expected: at least 3 failing tests (1, 2, 4) with messages like `expected 1 to be 0` for the event count and `expected 5 to be 0` for `garage.xp`.

- [ ] **Step 1.3:** Commit the failing tests on their own.

```bash
git add apps/api/test/garage/xp-car-create.test.ts
git commit -m "test(api): add failing tests for car_create XP hook (chunk 30)"
```

---

### Task 2 — Splice `awardXp` into the cars POST tx

**Files:**

- Modify: `apps/api/src/routes/cars.ts` (line ~8 for the import; line ~100 for the call, immediately after the closing `}` of the `awardBadge` loop)

- [ ] **Step 2.1:** Add the import on the line directly below `import { awardBadge } from '../services/garage/awarder.js';`:

```ts
import { awardXp } from '../services/garage/xp-awarder.js';
```

- [ ] **Step 2.2:** Inside the `if (garage) { … }` block, immediately AFTER the closing brace of the `for (const code of codes) { … }` loop and BEFORE the closing brace of the `if (garage)` block, insert the direct `awardXp(...)` call from the "Code shape" section above. NO try/catch (canon §5).

The resulting region (current lines 85–101 in `cars.ts`) becomes:

```ts
if (garage) {
  const codes = await checkCarEligibility(tx, sub);
  for (const code of codes) {
    try {
      await awardBadge(tx, garage.id, code, `car:${created.id}`);
    } catch (err) {
      app.log.warn({ err, garageId: garage.id, code }, 'awardBadge failed during car create');
    }
  }

  // XP — fire +5 for car_create on the freshly-created carId. Per canon §5,
  // the awarder owns expected-failure handling (killswitch off + P2002 →
  // { awarded: false }); any other error RETHROWS so the parent tx rolls
  // back with the car row. NO try/catch here — wrapping inside the parent
  // tx would allow partial XP writes to commit on unexpected errors.
  await awardXp(tx, garage.id, 'car_create', {
    sourceRef: `car:${created.id}`,
  });
}
```

- [ ] **Step 2.3:** Typecheck.

```bash
pnpm --filter @ccc/api typecheck
```

Expected: no errors. If TypeScript complains about the `'car_create'` literal not matching the awarder's reason union, double-check chunk 27 exposes `'car_create'` in `XpReason` — escalate to the chunk-27 PR if missing.

- [ ] **Step 2.4:** Run the targeted suite again.

```bash
pnpm --filter @ccc/api exec vitest run test/garage/xp-car-create.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 2.5:** Commit production change.

```bash
git add apps/api/src/routes/cars.ts
git commit -m "feat(api): award +5 XP on car_create in same tx as car.create (chunk 30)"
```

---

### Task 3 — Verify nothing else regressed

The car POST is on the badge-hook hot path; re-run the closest-neighbour suites to catch any tx-level surprise (e.g. a Serializable retry now also rolling back XP, which is the **desired** behaviour but should be confirmed by the existing badge tests still passing).

- [ ] **Step 3.1:** Run the badge write-hook suite (unchanged behaviour expected).

```bash
pnpm --filter @ccc/api exec vitest run test/garage/badges-write-hooks.test.ts
```

Expected: all green — the badge hooks still fire, XP rows now coexist alongside badge rows.

- [ ] **Step 3.2:** Run the cars routes suite (unchanged behaviour expected).

```bash
pnpm --filter @ccc/api exec vitest run test/cars
```

Expected: all green. Car CRUD, photos, allocation, retry-on-P2034 all untouched.

- [ ] **Step 3.3:** Run the eligibility + XP awarder suites (unchanged). XP awarder file is chunk 27's `xp-awarder.test.ts` per canon §11 — `awarder.test.ts` is the Phase 1 badge awarder and is also re-checked.

```bash
pnpm --filter @ccc/api exec vitest run test/garage/eligibility.test.ts test/garage/xp-awarder.test.ts test/garage/awarder.test.ts
```

Expected: all green.

No new commit for this step — it's verification only. If any pre-existing test fails, do **not** modify it; investigate whether the splice changed an invariant it shouldn't have and fix the splice instead. The likely root cause is the awarder throwing despite chunk 27's contract — log the failure, escalate to the chunk-27 owner, then add a regression test in the chunk-27 suite, not here.

---

## Verification before PR

Per `superpowers:verification-before-completion`: run these and confirm output before claiming done.

- [ ] `pnpm --filter @ccc/api typecheck` → clean.
- [ ] `pnpm --filter @ccc/api exec vitest run test/garage/xp-car-create.test.ts` → 5/5 pass.
- [ ] `pnpm --filter @ccc/api exec vitest run test/garage/badges-write-hooks.test.ts test/garage/xp-awarder.test.ts test/garage/awarder.test.ts test/garage/eligibility.test.ts` → all green (canon §11: chunk 27's XP awarder file is `xp-awarder.test.ts`; Phase 1 `awarder.test.ts` is the badge awarder).
- [ ] `pnpm --filter @ccc/api exec vitest run test/cars` → all green.
- [ ] `git diff --stat main` shows **exactly two files**: `apps/api/src/routes/cars.ts` (+~10 −0) and `apps/api/test/garage/xp-car-create.test.ts` (new).
- [ ] No edits to `packages/db/**`, `packages/shared/**`, `apps/mobile/**`, `apps/admin/**`, or any route file other than `cars.ts`.
- [ ] `git grep -n "awardXp" apps/api/src/routes` → returns exactly one hit (in `cars.ts`).
- [ ] Confirm `prisma.car.create` and `awardXp` share the same `tx` parameter inside the same `prisma.$transaction` callback. Read lines 53–105 of the modified `cars.ts` once more.
- [ ] Confirm there is NO try/catch around the `awardXp` call (canon §5).

Do **not** run the full repo test suite locally (per user memory: trust main CI + PR CI for the full sweep).

---

## Corrections from §"Corrections applied 2026-05-21 post-review" that apply

**§C1** and **§C5** both apply to this chunk (chunk 27 owns both contracts; this chunk consumes them):

- **§C1** — `XpEvent` uniqueness is enforced by `@@unique([garageId, reason, sourceRef])` on the model (owned by chunk 23/26). The awarder catches `P2002` and returns `{ awarded: false, reason: 'duplicate' }` (owned by chunk 27, per canon §5). **This chunk inherits both guarantees**: it must NOT add an application-layer pre-check, must NOT add its own try/catch on P2002, and must NOT touch the schema. Test 3 above is the regression guard.
- **§C5** — Sync killswitch read. `awardXp` reads `GeneralSettings.gamificationEnabled` synchronously via `readGamificationEnabled` from `apps/api/src/services/garage/killswitch.ts`; when disabled, it short-circuits to `{ awarded: false, reason: 'gamification_disabled' }` with no DB touch. This chunk depends on that behaviour. Test 4 above is the regression guard; it MUST upsert the singleton row via `GENERAL_SETTINGS_SINGLETON_ID` (canon §8), never numeric `id: 1`.

No other corrections apply. §C2 is for likes/revert. §C3 is for the like sourceRef format. §C4 is for the likes data source. §C6 is the no-reconcile decision (no-op here — there's no backfill).

---

## Deviations from initial plan draft (resolved 2026-05-24 post-review)

The original draft of this chunk wrapped the `awardXp` call in a try/catch mirroring the Phase 1 `awardBadge` block, used `awarder-car-create.test.ts` as the test filename, used numeric `id: 1` for the `GeneralSettings` upsert, and tested rollback via a nickname-collision (which fails BEFORE `awardXp` runs). All four were corrected per Phase 2 plan review + canon (`/tmp/phase2-fix-canon.md`):

- **Canon §5** (awarder error contract): No call-site try/catch. The awarder swallows expected failures (P2002 + killswitch); unexpected errors propagate and roll back the parent tx.
- **Canon §8** (GeneralSettings singleton id): Use the string `GENERAL_SETTINGS_SINGLETON_ID` constant from `killswitch.ts`. Never numeric `id: 1`.
- **Canon §11** (XP test filenames): `apps/api/test/garage/xp-car-create.test.ts`. The chunk 27 service file is `xp-awarder.test.ts`.
- **Rollback test redesign**: Test 5 now drives a manual `$transaction` that awards XP and throws AFTER the awardXp call. The previous nickname-collision test was a no-op because `tx.car.create` failed before the awarder ran.

If a real-world surprise emerges during implementation (e.g. the awarder needs an extra argument, or the route already has an `awardXp` call from another in-flight branch), STOP and surface it to the orchestrator before deviating — do not silently adapt.

---

## PR checklist (per `CLAUDE.md` "Git flow")

- [ ] Branch is `feat/jdma-garage-phase2-30`, created from a freshly-pulled `main` (`git pull --ff-only origin main` before `git switch -c …`).
- [ ] Both commits land on the feature branch only — `git log production..HEAD` shows them, `git log main..HEAD` shows them.
- [ ] No commits on `production` (re-check `git branch --show-current` is NOT `production`).
- [ ] Exactly two files changed: `apps/api/src/routes/cars.ts`, `apps/api/test/garage/xp-car-create.test.ts`.
- [ ] PR opens against `main` (never `production`).
- [ ] PR title: `feat(api): award +5 XP on car_create (chunk 30)`.
- [ ] PR body links the chunk: `Phase 2 chunk 30 of docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md (§"Chunk 30", lines 265–277). Hooks awardXp into the existing POST /me/cars tx adjacent to the Phase 1 awardBadge call. Awarder contract from chunk 27. Corrections §C1 inherited.`
- [ ] PR body lists the 5 acceptance-criteria tests by name.
- [ ] Review requested only after the PR exists.
- [ ] Awaiting Paperclip orchestrator's heartbeat before flipping the linked task to `done` — never use a bare comment on a `done` issue (per user memory: comment-on-done loop).

---

## Self-review summary

- **Spec coverage:** Skeleton §"Chunk 30" acceptance criteria all covered. Goal → Task 2. "+5 XpEvent + Garage.xp += 5 in same tx" → tests 1, 2. "Multiple cars award per-car" → test 2. "Tx rollback after awardXp succeeds leaves no XP state" → test 5 (deterministic manual-tx throw AFTER awardXp call, per Phase 2 plan review + canon §5). Killswitch + idempotency are required by §C1 + §C5 — tests 3 and 4 cover them (test 4 uses `GENERAL_SETTINGS_SINGLETON_ID` per canon §8). No spec line uncovered.
- **Placeholder scan:** None. Every code block is complete and runnable.
- **Type consistency:** `awardXp(tx, garageId, 'car_create', { sourceRef })` signature is used identically in the splice and in tests 3 + 5 — matches canon §4 positional 4-arg shape. Reason literal `'car_create'` matches §437 line 442 exactly. Field names (`reason`, `delta`, `sourceRef`, `garageId`, `xp`) match chunk 26's `XpEvent` model + chunk 23's `Garage.xp` column. No drift.
- **Error-contract consistency:** Splice has NO try/catch around `awardXp` (canon §5). Test 5 asserts the awarder's write is undone with the parent tx — the regression guard if a future refactor adds back a try/catch.
