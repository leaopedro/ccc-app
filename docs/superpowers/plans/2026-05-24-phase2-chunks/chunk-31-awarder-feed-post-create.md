# Chunk 31 — Hook awarder into feed-post create (+2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Splice an `awardXp(tx, garageId, 'post_create', { sourceRef: 'post:<postId>' })` call into the existing `FeedPost.create` success path so a `+2 XpEvent` row + `Garage.xp += 2` lands atomically with the post and the Phase 1 badge grant.

**Architecture:** Same-tx splice. The route already wraps `tx.feedPost.create` + Phase 1 `awardBadge` in a `prisma.$transaction`. Awarder is called inside that tx, after `awardBadge`, never on a separate connection. Per fix-canon §5 the awarder catches `P2002` (duplicate) and `gamification_disabled` internally and returns a result object; **unexpected throws propagate** so the parent tx rolls back. The call site therefore does NOT wrap `awardXp` in `try/catch`.

**Tech Stack:** Fastify route handler + Prisma transaction client + `awardXp` service (shipped by chunk 27) + vitest against real Postgres.

---

## Required reading

1. `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 31" (line 281).
2. `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` — §C1–C14 FIRST (§C1 governs this chunk); then §"XP-awarder rules (canonical)" line 437 row `post_create`: `+2`, sourceRef `post:<postId>`, idempotency triple `(garageId, 'post_create', 'post:<postId>')`.
3. `/tmp/phase2-fix-canon.md` — canonical decisions §4 (signature), §5 (error contract), §8 (singleton id), §9 (feed/event fixtures), §10 (filtered commands), §11 (filenames).
4. `docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` line 5181 — Phase 1 awarder service file + feed POST hook insertion point.
5. `CLAUDE.md` — branch preflight + Git flow + "never run full test suite locally".
6. `apps/api/src/routes/feed.ts` lines 300–342 — parent tx pattern.
7. `apps/api/src/services/garage/awarder.ts` and `apps/api/src/services/garage/xp-awarder.ts` — `awardBadge` + `awardXp` signatures.
8. `apps/api/test/feed/crud.test.ts` lines 12–43 — canonical `seedEvent` / `seedTier` / `seedTicket` fixture (mirror this).
9. `apps/api/test/garage/badges-write-hooks.test.ts` — integration test shape (real DB, Fastify inject, `resetDatabase`, `createUser`).

---

## Scope

**In:** one call site in `apps/api/src/routes/feed.ts` POST `/events/:eventId/feed` handler, inside the existing `prisma.$transaction` block, after the `awardBadge` loop, before `return created`. NO `try/catch` around `awardXp` (fix-canon §5). Plus one new integration test file with 6 scenarios.

**Out:** `awardXp` implementation (chunk 27 owns). Schema (§C1 owned by chunk 23). Other awarder hooks (chunks 29/30/32/33/34/35). Refund on post delete — outline locks "no auto-revert path" (skeleton line 290).

**Invariants:**

1. XpEvent row + `Garage.xp += 2` in the **same tx** as `tx.feedPost.create` (outline §456).
2. Idempotency triple enforced by §C1 DB unique. On `P2002`, awarder catches internally and returns `{ awarded: false, reason: 'duplicate' }`.
3. Awarder swallows expected failures (duplicate + killswitch) but **rethrows unexpected errors** per fix-canon §5; the parent tx rolls back on those.
4. Killswitch off → awarder no-ops (`{ awarded: false, reason: 'gamification_disabled' }`) and the route still returns 201. Enforced inside `awardXp` by chunk 27.

---

## Files touched

- **Modify:** `apps/api/src/routes/feed.ts` — POST handler around lines 307–342. Add `awardXp` import from `../services/garage/xp-awarder.js` + one call site inside the tx, after `awardBadge` loop.
- **Create:** `apps/api/test/garage/xp-post-create.test.ts` — 6 specs (skeleton-canonical filename per fix-canon §11).

**Do NOT touch:** any other file. Awarder service, schema, killswitch, feed routes other than POST.

---

## Code shape (target final state)

In `apps/api/src/routes/feed.ts`:

```ts
import { awardBadge } from '../services/garage/awarder.js';
import { awardXp } from '../services/garage/xp-awarder.js';
```

Inside the existing `prisma.$transaction(async (tx) => { ... })` block, immediately after the `for (const code of codes) { try { await awardBadge(...) } catch ... }` loop and before `return created;`:

```ts
if (garage) {
  await awardXp(tx, garage.id, 'post_create', {
    sourceRef: `post:${created.id}`,
  });
}
```

Reuses the `garage` variable already fetched at line 324 — no extra query. **No `try/catch`** per fix-canon §5: the awarder catches expected `P2002` + killswitch internally; any other throw must propagate so the parent tx rolls back atomically. This is the load-bearing same-tx invariant.

---

## Task decomposition

Estimated total: ~45 minutes, 6 short tasks. Each task is one TDD cycle (red → green → commit) where applicable.

### Task 1: Branch + verify prerequisites (no commit)

- [ ] **Step 1: Branch preflight** (`CLAUDE.md`)

```bash
git branch --show-current   # must NOT be production
git switch main && git pull --ff-only origin main
git switch -c feat/jdma-garage-phase2-31
```

- [ ] **Step 2: Confirm chunks 23 + 27 prerequisites**

```bash
grep -n "export const awardXp\|export async function awardXp" apps/api/src/services/garage/xp-awarder.ts
grep -n "@@unique.*garageId.*reason.*sourceRef\|model XpEvent" packages/db/prisma/schema.prisma
grep -n "GENERAL_SETTINGS_SINGLETON_ID\|readGamificationEnabled" apps/api/src/services/garage/killswitch.ts
```

Expected: each grep returns at least one match. Zero on the first two = chunk 27 or 23 not landed → STOP, flag in §"Deviations".

- [ ] **Step 3: Confirm parent tx still wraps `tx.feedPost.create`**

Re-read `apps/api/src/routes/feed.ts` lines 300–345. Rule is "same tx as `tx.feedPost.create`", not "line 333". Adapt insertion point if the structure shifted.

---

### Task 2: Write the failing integration test file (red)

**Files:**

- Create: `apps/api/test/garage/xp-post-create.test.ts`

- [ ] **Step 1: Verify helpers + seed pattern**

`grep -n "export " apps/api/test/helpers.ts` — expect `makeApp`, `resetDatabase`, `createUser`, `bearer`. Skim `apps/api/test/feed/crud.test.ts` lines 12–43 — copy `seedEvent` / `seedTier` / `seedTicket` shape (per fix-canon §9: required `type`, `capacity`, published `status`, plus `feedAccess: 'public'` so any actor can post).

We deliberately **do NOT seed `COM-001`** here (fix-canon MAJOR — avoid collision with chunk 33's `badge_award` XP through the same `awardBadge` path). Assertions check the isolated `post_create` delta (a single XpEvent row with `reason: 'post_create'`), not total `Garage.xp`. Documented assumption: with `COM-001` absent from the catalog, `checkFeedEligibility` returns an empty array → no badge grant → only `post_create` XP fires.

- [ ] **Step 2: Write the new test file**

Create `apps/api/test/garage/xp-post-create.test.ts`:

```ts
import { prisma } from '@jdm/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@jdm/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as xpAwarder from '../../src/services/garage/xp-awarder.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// NOTE: COM-001 is intentionally NOT seeded. This isolates the `post_create`
// XP delta from chunk 33's badge_award XP (which fires through the same
// awardBadge path when an eligibility branch matches). With no badge catalog
// rows, checkFeedEligibility returns []; the only XP write is post_create.

const seedEvent = (overrides: { feedAccess?: 'public' | 'attendees' | 'members_only' } = {}) =>
  prisma.event.create({
    data: {
      title: 'XP Post Create Test',
      slug: `xp-pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'd',
      startsAt: new Date('2026-06-01T10:00:00Z'),
      endsAt: new Date('2026-06-01T20:00:00Z'),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      feedEnabled: true,
      feedAccess: overrides.feedAccess ?? 'public',
      postingAccess: 'attendees',
    },
  });

const garageIdFor = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

const createPost = async (
  app: FastifyInstance,
  env: ReturnType<typeof loadEnv>,
  userId: string,
  eventId: string,
  body = 'hello',
) =>
  app.inject({
    method: 'POST',
    url: `/events/${eventId}/feed`,
    headers: { authorization: bearer(env, userId) },
    payload: { body },
  });

describe('awarder hook — feed-post create awards +2 XP', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('single post awards +2 (1 XpEvent row, isolated post_create delta)', async () => {
    const event = await seedEvent();
    const { user } = await createUser({ email: 'xp-post-1@jdm.test', verified: true });
    const env = loadEnv();

    const res = await createPost(app, env, user.id, event.id);
    expect(res.statusCode).toBe(201);
    const postId = res.json().id as string;

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: 'post_create',
      sourceRef: `post:${postId}`,
      delta: 2,
    });
    // Assertion is on the post_create delta in isolation, NOT total Garage.xp,
    // because chunk 33 may later add badge_award XP through the same code path.
    // See note at top of file.
  });

  it('two posts award two post_create rows (idempotency on distinct sourceRefs)', async () => {
    const event = await seedEvent();
    const { user } = await createUser({ email: 'xp-post-2@jdm.test', verified: true });
    const env = loadEnv();

    const r1 = await createPost(app, env, user.id, event.id, 'one');
    const r2 = await createPost(app, env, user.id, event.id, 'two');
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create' },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sourceRef)).toEqual([
      `post:${r1.json().id as string}`,
      `post:${r2.json().id as string}`,
    ]);
  });

  it('same-sourceRef double-call is idempotent (P2002 swallowed by awarder)', async () => {
    // Drive idempotency directly through awardXp using a fixed sourceRef.
    // The HTTP route can't repeat the same postId naturally, so this asserts
    // the §C1 DB unique constraint is caught inside awardXp per fix-canon §5.
    const event = await seedEvent();
    const { user } = await createUser({ email: 'xp-post-3@jdm.test', verified: true });
    const env = loadEnv();

    const res = await createPost(app, env, user.id, event.id);
    expect(res.statusCode).toBe(201);
    const postId = res.json().id as string;
    const gid = await garageIdFor(user.id);

    // Re-invoke awardXp with the exact same triple; should return duplicate.
    const second = await prisma.$transaction(async (tx) =>
      xpAwarder.awardXp(tx, gid, 'post_create', { sourceRef: `post:${postId}` }),
    );
    expect(second).toMatchObject({ awarded: false, reason: 'duplicate' });

    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create', sourceRef: `post:${postId}` },
    });
    expect(rows).toHaveLength(1);
  });

  it('killswitch off → post created, no post_create XpEvent row', async () => {
    // Use the canonical singleton id constant (fix-canon §8). NEVER id: 1.
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: { gamificationEnabled: false },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
    });
    const event = await seedEvent();
    const { user } = await createUser({ email: 'xp-post-4@jdm.test', verified: true });
    const env = loadEnv();

    const res = await createPost(app, env, user.id, event.id);
    expect(res.statusCode).toBe(201);

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create' },
    });
    expect(rows).toHaveLength(0);
  });

  it('unexpected awarder throw rolls back the parent tx (no post, no XP row)', async () => {
    // Per fix-canon §5: awardXp catches only P2002 + killswitch; any other
    // error propagates so the parent prisma.$transaction rolls back. This is
    // the load-bearing same-tx invariant. The route MUST NOT wrap awardXp in
    // try/catch — if it did, the post would commit while XP is missing.
    const event = await seedEvent();
    const { user } = await createUser({ email: 'xp-post-5@jdm.test', verified: true });
    const env = loadEnv();

    const spy = vi
      .spyOn(xpAwarder, 'awardXp')
      .mockRejectedValueOnce(new Error('synthetic awarder failure'));

    const res = await createPost(app, env, user.id, event.id);
    // Route propagates the failure → 500.
    expect(res.statusCode).toBe(500);

    // No feed post should exist for this event.
    const posts = await prisma.feedPost.findMany({ where: { eventId: event.id } });
    expect(posts).toHaveLength(0);

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(rows).toHaveLength(0);

    spy.mockRestore();
  });

  it('route-level same-tx rollback: post + XP row are linked via parent tx', async () => {
    // Drives the REAL feed POST route (not a manual $transaction) and forces
    // a failure AFTER awardXp would have written its row, so we prove the
    // hook splice is inside the parent feed-post transaction. We do this by
    // stubbing awardXp to throw on the second call inside the route. With
    // the hook inside the parent tx, the feedPost.create row is rolled back
    // alongside the (would-be) XpEvent.
    const event = await seedEvent();
    const { user } = await createUser({ email: 'xp-post-6@jdm.test', verified: true });
    const env = loadEnv();

    // First call: let the awarder run normally (succeeds, +2).
    const r1 = await createPost(app, env, user.id, event.id, 'will-commit');
    expect(r1.statusCode).toBe(201);

    // Second call: force the awarder to throw → parent tx must roll back.
    const spy = vi.spyOn(xpAwarder, 'awardXp').mockRejectedValueOnce(new Error('forced rollback'));
    const r2 = await createPost(app, env, user.id, event.id, 'will-rollback');
    expect(r2.statusCode).toBe(500);
    spy.mockRestore();

    const gid = await garageIdFor(user.id);
    const rows = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'post_create' },
    });
    // Exactly one XP row from the first (committed) call. The second
    // attempt's row was rolled back with the parent tx.
    expect(rows).toHaveLength(1);

    const posts = await prisma.feedPost.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
    });
    // Only the first post survived; the second was rolled back.
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toBe('will-commit');
  });
});
```

Notes:

- Test 3 (idempotency) calls `awardXp` directly with a known-existing `sourceRef`. The HTTP route can't naturally produce a duplicate `post:<postId>`, so direct-call style asserts §C1's DB unique catches re-entry inside the awarder (fix-canon §5 returns `{ awarded: false, reason: 'duplicate' }`).
- Test 5 uses `vi.spyOn(xpAwarder, 'awardXp').mockRejectedValueOnce(...)` to simulate an unexpected throw. Per fix-canon §5 the call site does NOT catch — the parent `prisma.$transaction` rolls back, so the response is 500 and no feed post survives.
- Test 6 routes through the real POST handler twice. The first call commits; the second forces an awarder throw, proving the post + XP write are siblings inside the same parent tx (replaces the previous manual-$transaction rollback test that didn't exercise the hook).
- Killswitch test uses `GENERAL_SETTINGS_SINGLETON_ID` constant (fix-canon §8). Never numeric `id: 1`.

- [ ] **Step 3: Verify test fails (red)**

```bash
pnpm --filter @jdm/api exec vitest run test/garage/xp-post-create.test.ts
```

Expected: compile error on `awardXp` import OR specs 1, 2, 3 fail (no XP row), spec 5 fails (no awarder call → route still 201 → expected 500), spec 6 fails (second call still 201 → expected 500 + no second post). Spec 4 may pass for the wrong reason (no hook = no row regardless of killswitch). Compile error → return to Task 1 and confirm chunk 27's module path.

- [ ] **Step 4: Commit the failing baseline**

```bash
git add apps/api/test/garage/xp-post-create.test.ts
git commit -m "test(api): failing specs for feed-post create XP hook (chunk 31)"
```

---

### Task 3: Splice `awardXp` into the route (green)

**Files:**

- Modify: `apps/api/src/routes/feed.ts`

- [ ] **Step 1: Add the `awardXp` import**

Locate the existing `import { awardBadge } from '../services/garage/awarder.js';` (around line 19). Add directly below:

```ts
import { awardXp } from '../services/garage/xp-awarder.js';
```

(Per fix-canon §11 + chunk 27, `awardXp` lives in `xp-awarder.ts`, not `awarder.ts`.)

- [ ] **Step 2: Insert the awarder call inside the existing tx**

Locate the existing block (currently ~lines 324–340):

```ts
const garage = await tx.garage.findUnique({
  where: { userId: sub },
  select: { id: true },
});
if (garage) {
  const codes = await checkFeedEligibility(tx, sub, created.id);
  for (const code of codes) {
    try {
      await awardBadge(tx, garage.id, code, `feed_post:${created.id}`);
    } catch (err) {
      app.log.warn({ err, garageId: garage.id, code }, 'awardBadge failed during feed post create');
    }
  }
}
return created;
```

Change the inner `if (garage) { ... }` block to:

```ts
if (garage) {
  const codes = await checkFeedEligibility(tx, sub, created.id);
  for (const code of codes) {
    try {
      await awardBadge(tx, garage.id, code, `feed_post:${created.id}`);
    } catch (err) {
      app.log.warn({ err, garageId: garage.id, code }, 'awardBadge failed during feed post create');
    }
  }
  await awardXp(tx, garage.id, 'post_create', {
    sourceRef: `post:${created.id}`,
  });
}
return created;
```

Rationale:

- Reuses the already-fetched `garage` — no extra round trip.
- Same `tx` client — atomic with `feedPost.create`.
- After the badge loop so badge logging isn't interleaved with XP failure.
- **No `try/catch`** per fix-canon §5: the awarder swallows expected `P2002` (duplicate) and killswitch internally. Any other throw must propagate so the parent tx rolls back. Catching here would commit a partial post with no XP record and break invariant 3.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @jdm/api exec tsc --noEmit
```

Expected: clean. If `awardXp` signature mismatch surfaces here → re-check fix-canon §4: `awardXp(tx, garageId, reason, opts)` positional 4-arg.

- [ ] **Step 4: Run the new test file (green)**

```bash
pnpm --filter @jdm/api exec vitest run test/garage/xp-post-create.test.ts
```

Expected: all 6 specs pass.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/api/src/routes/feed.ts
git commit -m "feat(api): splice awardXp(post_create, +2) into feed POST tx (chunk 31)"
```

---

### Task 4: Regression check (no commit)

Phase 1 + chunk 27 share the same surfaces. Confirm nothing perturbed.

```bash
pnpm --filter @jdm/api exec vitest run test/garage/badges-write-hooks.test.ts
pnpm --filter @jdm/api exec vitest run test/garage/xp-awarder.test.ts
pnpm --filter @jdm/api exec vitest run test/garage/xp-revert-on-unlike.test.ts
pnpm --filter @jdm/api exec vitest run test/feed/crud.test.ts
```

(Per fix-canon §11: chunk 27 canonical regression files are `xp-awarder.test.ts` and `xp-revert-on-unlike.test.ts`. The old `awarder.test.ts` reference is replaced.)

Expected: all green. Per `CLAUDE.md`: do NOT run `pnpm test` at repo root. Touched-paths only. Trust main CI.

---

### Task 5: Self-review (no commit)

- [ ] **Spec coverage** against §437 row `post_create`: delta +2 (in `awardXp`), trigger = `FeedPost.create` success, sourceRef = `` `post:${created.id}` ``, same-tx via inherited `tx`, killswitch via `awardXp` entry guard, unexpected-throw propagation proven by route-level rollback (test 6).

- [ ] **Placeholder scan:** `git diff main -- apps/api/src/routes/feed.ts apps/api/test/garage/xp-post-create.test.ts | grep -E 'TODO|TBD|FIXME'` → zero matches.

- [ ] **Namespace check:** `'post_create'` (snake_case) and `` `post:${...}` `` (NOT `feed_post:` — that's the badge hook's namespace, do not unify).

- [ ] **No try/catch around awardXp:** `grep -n "awardXp" apps/api/src/routes/feed.ts` → exactly one call, no surrounding `try`.

- [ ] **Diff shape:** `git diff main -- apps/api/src/routes/feed.ts` → 1 import-line added + 3 lines inserted inside the tx. No unrelated reformatting.

---

### Task 6: Open the PR

- [ ] **Step 1: Push**

```bash
git push -u origin feat/jdma-garage-phase2-31
```

- [ ] **Step 2: Create the PR**

```bash
gh pr create --base main --title "feat(api): hook awardXp(+2) into feed-post create (chunk 31)" --body "$(cat <<'EOF'
## Summary
- Splices `awardXp(tx, garageId, 'post_create', { sourceRef: 'post:<postId>' })` into the existing `prisma.$transaction` that wraps `FeedPost.create` + Phase 1 `awardBadge`.
- No `try/catch` around `awardXp` (fix-canon §5): the awarder catches expected `P2002` + killswitch; unexpected throws propagate so the parent tx rolls back atomically.
- Adds 6 integration specs (real Postgres) covering single +2 (isolated delta), two posts, idempotency, killswitch off, unexpected-throw propagation, and route-level same-tx rollback.
- No schema, no service-layer code. Chunk 27 owns `awardXp` itself; this chunk is the route-side splice only.

## Plan
- `docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-31-awarder-feed-post-create.md`
- Outline: `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` §437 + §C1.
- Canon: `/tmp/phase2-fix-canon.md` §4 §5 §8 §9 §11.

## Test plan
- [x] `pnpm --filter @jdm/api exec tsc --noEmit`
- [x] `pnpm --filter @jdm/api exec vitest run test/garage/xp-post-create.test.ts`
- [x] `pnpm --filter @jdm/api exec vitest run test/garage/badges-write-hooks.test.ts` (regression)
- [x] `pnpm --filter @jdm/api exec vitest run test/garage/xp-awarder.test.ts` (regression)
- [x] `pnpm --filter @jdm/api exec vitest run test/garage/xp-revert-on-unlike.test.ts` (regression)
- [ ] Main CI: full suite

## Risk
- Low. One same-tx call site addition mirroring an existing pattern. Awarder swallows expected failures; unexpected throws roll back the parent tx by design.
EOF
)"
```

- [ ] **Step 3: Wait for CI**

Do not request review until CI is green on the PR. Per `CLAUDE.md` git flow.

---

## Verification commands

Per fix-canon §10 — package-root-relative paths, `pnpm --filter <pkg> exec vitest run` (no `--` separator that swallows the path).

- `pnpm --filter @jdm/api exec tsc --noEmit` — after every `feed.ts` edit. Clean.
- `pnpm --filter @jdm/api exec vitest run test/garage/xp-post-create.test.ts` — Task 2 red, Task 3 green.
- `pnpm --filter @jdm/api exec vitest run test/garage/badges-write-hooks.test.ts` — Phase 1 regression. Green.
- `pnpm --filter @jdm/api exec vitest run test/garage/xp-awarder.test.ts` — chunk 27 regression. Green.
- `pnpm --filter @jdm/api exec vitest run test/garage/xp-revert-on-unlike.test.ts` — chunk 27 regression. Green.

Do NOT run `pnpm test` at repo root. Touched paths only. Trust main CI.

---

## Corrections that apply

- **§C1** — `XpEvent` DB unique `(garageId, reason, sourceRef)` is the idempotency source of truth. Chunk 23 ships the migration; chunk 27 ships `awardXp` with `P2002` catch. This chunk consumes both.
- **§C5** — killswitch read inside `awardXp` makes the call a no-op when `gamificationEnabled === false`. Covered by test 4.

Fix-canon decisions applied:

- **§4** — `awardXp(tx, garageId, reason, opts)` positional 4-arg signature; chunk 27 conforms to consumers.
- **§5** — Call site does **not** wrap `awardXp` in `try/catch`. The awarder catches expected `P2002` + killswitch internally; unexpected throws propagate so the parent tx rolls back. Test 5 + test 6 verify this contract.
- **§8** — Killswitch test uses `GENERAL_SETTINGS_SINGLETON_ID` constant. Never numeric `id: 1`.
- **§9** — `seedEvent` mirrors `apps/api/test/feed/crud.test.ts` with `type`, `capacity`, published `status`, and `feedAccess: 'public'` (no ticket needed).
- **§10** — Vitest + lint commands use `pnpm --filter @jdm/api exec vitest run <package-root-relative-path>`.
- **§11** — Test file renamed to skeleton-canonical `xp-post-create.test.ts` (was `awarder-feed-post-create.test.ts`). Chunk 27 regression files are `xp-awarder.test.ts` + `xp-revert-on-unlike.test.ts` (replaces the old `awarder.test.ts` reference).

No other corrections apply (§C2/C3/C4 cover likes; §C6+ unrelated).

---

## Deviations / open questions

- **Badge-collision isolation (canon MAJOR):** `COM-001` is intentionally NOT seeded in this test file to keep the `post_create` XP delta isolated from chunk 33's future `badge_award` XP through the same `awardBadge` path. Assertions check only `XpEvent.reason = 'post_create'` rows, never total `Garage.xp`. When chunk 33 lands, this stays correct because the badge branch never fires here. Phase 1 `COM-001` coverage continues to live in `badges-write-hooks.test.ts`.
- If chunk 27 lands with a non-canonical `awardXp` signature (e.g. options-object instead of positional 4-arg), STOP and reconcile against fix-canon §4 BEFORE editing the route. Do not paper over the drift with a local adapter.

---

## PR checklist

- [ ] Branch `feat/jdma-garage-phase2-31` from fresh `main` (NOT from `production`, NOT from another phase-2 branch).
- [ ] `git branch --show-current` = `main` before branching (`CLAUDE.md` preflight).
- [ ] Diff is exactly 2 files: `apps/api/src/routes/feed.ts` + `apps/api/test/garage/xp-post-create.test.ts`.
- [ ] `awardXp` imported from `../services/garage/xp-awarder.js` (NOT `awarder.js`).
- [ ] `awardXp` call inside the existing `prisma.$transaction`, after `awardBadge` loop, before `return created`.
- [ ] Call site is **NOT** wrapped in `try/catch` (fix-canon §5).
- [ ] `sourceRef` is exactly `` `post:${created.id}` `` (NOT `feed_post:` — that's the badge namespace).
- [ ] 6 specs all pass against real Postgres.
- [ ] Killswitch test uses `GENERAL_SETTINGS_SINGLETON_ID` (fix-canon §8).
- [ ] `seedEvent` includes `type`, `capacity`, `status: 'published'`, `feedAccess: 'public'` (fix-canon §9).
- [ ] Test filename is `xp-post-create.test.ts` (fix-canon §11).
- [ ] No edits to schema, killswitch, awarder service, other routes.
- [ ] `pnpm --filter @jdm/api exec tsc --noEmit` green.
- [ ] `pnpm --filter @jdm/api exec vitest run test/garage/xp-post-create.test.ts` green.
- [ ] Regression: `badges-write-hooks.test.ts`, `xp-awarder.test.ts`, `xp-revert-on-unlike.test.ts` still green.
- [ ] PR opens against `main` (never `production`). Review requested only after PR + CI green.
