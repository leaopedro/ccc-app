# Chunk 25 — `getGarageStats` service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pure read service `getGarageStats(client, garageId)` returning `{ events, posts, likesReceived, joinedAt }`. The `client` parameter accepts `PrismaClient | Prisma.TransactionClient` per canon §3 so callers can compose inside a `$transaction`. `likesReceived` reads the denormalized `Garage.likesReceived` column directly (§C4 forbids aggregating `FeedReaction`). `events` and `posts` use `client.ticket.count` (status = `used`) and `client.feedPost.count` (status = `visible`).

**Architecture:** New service in `apps/api/src/services/garage/stats.ts`, shape mirrors sibling services (`killswitch.ts`, `awarder.ts`, `badges-read.ts`). Pure read — no tx, no writes, no killswitch read (§C5: gating belongs to the serializer in chunks 28+). Integration test in `apps/api/test/garage/stats.test.ts` against the Testcontainers Postgres set up by `apps/api/test/helpers.ts`.

**Tech Stack:** Fastify + Prisma in `apps/api`, vitest + Testcontainers. `PrismaClient` from `@prisma/client`. No `@ccc/shared` import — returns a POJO; the serializer validates at the route boundary.

**Reads from:** chunk 23 (`Garage.likesReceived` column must exist), chunk 24 (`GarageStats` shape definition in `@ccc/shared`).

**Parallel-with:** chunk 26 (independent service — `progress.ts` does not touch the same files).

**Out of scope:** serializer wiring + killswitch gate (chunks 28/30/31), likesReceived writes (chunk 27 awarder), caching / memoization (§C5 forbids).

---

## File Structure

### New files

- `apps/api/src/services/garage/stats.ts` — `getGarageStats` + `GarageStats` type. ~60 lines including JSDoc.
- `apps/api/test/garage/stats.test.ts` — 7 integration tests against real Postgres.

### Modified files

None for chunk 25. The shared schema (`garageStatsSchema`) ships in chunk 24; the serializer that calls `getGarageStats` ships in chunk 28+.

---

## Branch safety preflight (per CLAUDE.md)

Run BEFORE the first edit. If `git branch --show-current` is `production`, STOP — do not edit, commit, or push.

```bash
# 1. Confirm we are NOT on production.
current=$(git branch --show-current)
if [ "$current" = "production" ]; then
  echo "ON PRODUCTION — STOP. Switch to main first." >&2
  exit 1
fi

# 2. Move to a fresh main and branch from it.
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-25
```

Never branch from `production`. Never push to `production`.

---

## Corrections that apply

Source: `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`.

### §C4 — `Garage.likesReceived` is the only read source

`FeedPost.likeCount` does not exist; likes are individual `FeedReaction` rows. The denormalized `Garage.likesReceived` is the only stats source — read directly, never aggregate.

**Rule:** `getGarageStats` MUST NOT touch `prisma.feedReaction.*`. Task 6 enforces this with a Proxy that throws on any `feedReaction` property access.

### §C5 — Sync read killswitch (NOT enforced inside this service)

The killswitch (`readGamificationEnabled()` in `apps/api/src/services/garage/killswitch.ts`) is the awarder + serializer concern. `getGarageStats` is pure computation — same pattern as `badges-read.ts`, which never reads the killswitch either. The serializer (chunk 28+) decides whether to include the `stats` block. No cache, no memoization here.

### Kickoff decision #5 — denormalize `likesReceived`

Like-awarder + un-like awarder maintain the column in-tx with the XP write. No aggregate SUM on read paths. Reinforces §C4.

### Canon §3 — `(client, garageId)` signature, client accepts both clients

Phase 2 fix canon §3 fixes the chunk 25 ↔ chunk 28 signature drift: `getGarageStats(client: PrismaClient | Prisma.TransactionClient, garageId: string)`. Chunk 28 passes `prisma` as the first arg; tx composition works without a wrapper. Resolves review D4 MAJOR + MINOR (this file). See D4 below.

---

## Deviation candidates

### D1 — `prisma.checkin` does not exist; use `prisma.ticket`

Skeleton + outline §259 reference `prisma.checkin.count`. No `Checkin` model exists in `packages/db/prisma/schema.prisma`. Check-ins are represented by `Ticket.status = 'used'` after `apps/api/src/services/tickets/check-in.ts` flips the row. Precedent: `apps/api/test/garage/badges-write-hooks.test.ts:113-150` awards EVT-001 by running `checkInTicket` and reading `Ticket`.

**Resolution:** `events = prisma.ticket.count({ where: { userId: garage.userId, status: 'used' } })`. Chunk 27's `event_checkin` XP hook will fire on the same row flip.

### D2 — `joinedAt` derives from `Garage.createdAt`

Confirmed in outline §28 + §381. Signup auto-creates the garage in the same tx (see `apps/api/test/garage/signup-garage.test.ts`), so `Garage.createdAt` and `User.createdAt` match within a few ms. No `User` read needed.

### D3 — "3 reads in parallel" is actually 1 + 2

Outline §259 says "3 reads in parallel". The Garage row read must happen first (counters need `garage.userId`); then 2 counters run in parallel. A future caller that already has the Garage row could accept an overload `getGarageStatsFromRow(prisma, garage)`. Out of scope for chunk 25.

### D4 — Inject client as a parameter, accept both `PrismaClient` and `Prisma.TransactionClient`

Sibling `killswitch.ts` uses the same explicit-injection style. Per canon §3 the parameter type is `PrismaClient | Prisma.TransactionClient` so the function composes inside a `$transaction` block when a caller (e.g., chunk 28 serializer) needs that, and tests can wrap with a Proxy (Task 6). Resolves chunk 28's call-site expectation that `prisma` is the first arg (canon §3) and the MINOR drift that a bare `PrismaClient` type would reject `tx`.

---

### Task 1: Stub the type + signature

**Files:**

- Create: `apps/api/src/services/garage/stats.ts`

Type contract first; the runtime test in Task 2 is what fails initially.

- [ ] **Step 1: Create the file with type + stub body**

```ts
// apps/api/src/services/garage/stats.ts
import type { Prisma, PrismaClient } from '@prisma/client';

/** Either the root client or a transaction client — canon §3 (tx composition). */
export type StatsReadClient = PrismaClient | Prisma.TransactionClient;

export type GarageStats = {
  events: number;
  posts: number;
  likesReceived: number;
  joinedAt: string;
};

export class GarageNotFoundError extends Error {
  constructor(garageId: string) {
    super(`garage not found: ${garageId}`);
    this.name = 'GarageNotFoundError';
  }
}

export const getGarageStats = async (
  _client: StatsReadClient,
  _garageId: string,
): Promise<GarageStats> => {
  throw new Error('not implemented');
};
```

Full JSDoc lands in Task 3.

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm --filter @ccc/api typecheck`
Expected: PASS.

- [ ] **Step 3: Do NOT commit yet** — wait for Task 3.

---

### Task 2: Write the "zero-default fresh garage" failing test

**Files:**

- Create: `apps/api/test/garage/stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/garage/stats.test.ts
import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { getGarageStats, GarageNotFoundError } from '../../src/services/garage/stats.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('getGarageStats', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns zero counters + joinedAt for a fresh garage', async () => {
    const { user } = await createUser({ email: 'stats-fresh@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const stats = await getGarageStats(prisma, garage.id);

    expect(stats.events).toBe(0);
    expect(stats.posts).toBe(0);
    expect(stats.likesReceived).toBe(0);
    expect(stats.joinedAt).toBe(garage.createdAt.toISOString());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test stats.test.ts -t 'returns zero counters'`
Expected: FAIL with `Error: not implemented` (stub throws).

- [ ] **Step 3: Do NOT commit yet.**

---

### Task 3: Implement the happy path

**Files:**

- Modify: `apps/api/src/services/garage/stats.ts`

- [ ] **Step 1: Replace the stub body**

```ts
// apps/api/src/services/garage/stats.ts
import type { Prisma, PrismaClient } from '@prisma/client';

/** Either the root client or a transaction client — canon §3 (tx composition). */
export type StatsReadClient = PrismaClient | Prisma.TransactionClient;

export type GarageStats = {
  events: number;
  posts: number;
  likesReceived: number;
  joinedAt: string;
};

export class GarageNotFoundError extends Error {
  constructor(garageId: string) {
    super(`garage not found: ${garageId}`);
    this.name = 'GarageNotFoundError';
  }
}

/**
 * Aggregate stats payload for `GET /me/garage` + `GET /g/:slug` (wired by
 * chunk 28+). The `client` parameter accepts either `PrismaClient` or
 * `Prisma.TransactionClient` (canon §3) so callers may compose inside a
 * `$transaction`. Read order:
 *
 *   1. Garage row — provides `userId` (FK for counters), `likesReceived`
 *      (denormalized, §C4), `createdAt` (`joinedAt`).
 *   2. Ticket.count where status='used' — events attended.
 *      (D1: no `Checkin` model in this repo; ticket-used = checkin.)
 *   3. FeedPost.count where status='visible' + authorUserId set.
 *
 * `likesReceived` reads the Garage column directly — NEVER aggregated from
 * `FeedReaction` (§C4). No killswitch read (§C5 — serializer gates).
 */
export const getGarageStats = async (
  client: StatsReadClient,
  garageId: string,
): Promise<GarageStats> => {
  const garage = await client.garage.findUnique({
    where: { id: garageId },
    select: { userId: true, likesReceived: true, createdAt: true },
  });
  if (!garage) throw new GarageNotFoundError(garageId);

  const [events, posts] = await Promise.all([
    client.ticket.count({ where: { userId: garage.userId, status: 'used' } }),
    client.feedPost.count({ where: { authorUserId: garage.userId, status: 'visible' } }),
  ]);

  return {
    events,
    posts,
    likesReceived: garage.likesReceived,
    joinedAt: garage.createdAt.toISOString(),
  };
};
```

Shape note: Garage row first (counters need `garage.userId`), then 2 counters in `Promise.all`. See deviation D3.

- [ ] **Step 2: Run the failing test from Task 2**

Run: `pnpm --filter @ccc/api test stats.test.ts -t 'returns zero counters'`
Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @ccc/api typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/garage/stats.ts apps/api/test/garage/stats.test.ts
git commit -m "feat(api): add getGarageStats service (chunk 25)

Returns { events, posts, likesReceived, joinedAt } for the garage
progression payload. Pure read path — likesReceived comes from the
denormalized Garage column (§C4 forbids aggregation over FeedReaction).
Events = Ticket where status='used'; posts = FeedPost where
status='visible'. Killswitch gating happens in the serializer (§C5),
not here.

Refs: docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md §Chunk 25"
```

---

### Task 4: Test — events count matches inserted used tickets

**Files:**

- Modify: `apps/api/test/garage/stats.test.ts`

- [ ] **Step 1: Add the failing test** (will pass on first run since impl already handles it — TDD discipline keeps the case explicit)

Hoist a tiny seed helper to the top of the test file (inside the module scope, above `describe`):

```ts
const seedEvent = async (slug: string) =>
  prisma.event.create({
    data: {
      slug,
      title: slug,
      description: 'd',
      startsAt: new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date('2026-05-10T20:00:00Z'),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      feedAccess: 'public',
      postingAccess: 'public',
    },
  });
```

Then add the test inside `describe('getGarageStats', ...)`:

```ts
it('events count matches Ticket rows with status="used" AND filters by userId', async () => {
  const { user } = await createUser({ email: 'stats-events@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

  // Second user — proves the `userId` filter; their `used` ticket MUST NOT be
  // counted toward `user`'s stats. A missing filter would return 4, not 3.
  const { user: other } = await createUser({
    email: 'stats-events-other@jdm.test',
    verified: true,
  });

  const event = await seedEvent('stats-evt');
  const tier = await prisma.ticketTier.create({
    data: { eventId: event.id, name: 'GA', priceCents: 0, currency: 'BRL', quantityTotal: 100 },
  });

  // 3 used by user (counted) + 1 valid + 1 revoked (excluded by status)
  // + 1 used by `other` (excluded by userId — proves filter).
  await prisma.ticket.createMany({
    data: [
      { userId: user.id, eventId: event.id, tierId: tier.id, status: 'used', usedAt: new Date() },
      { userId: user.id, eventId: event.id, tierId: tier.id, status: 'used', usedAt: new Date() },
      { userId: user.id, eventId: event.id, tierId: tier.id, status: 'used', usedAt: new Date() },
      { userId: user.id, eventId: event.id, tierId: tier.id, status: 'valid' },
      { userId: user.id, eventId: event.id, tierId: tier.id, status: 'revoked' },
      { userId: other.id, eventId: event.id, tierId: tier.id, status: 'used', usedAt: new Date() },
    ],
  });

  const stats = await getGarageStats(prisma, garage.id);
  expect(stats.events).toBe(3); // NOT 4 — `other`'s used ticket excluded.
  expect(stats.posts).toBe(0);
  expect(stats.likesReceived).toBe(0);
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @ccc/api test stats.test.ts -t 'events count matches'`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/garage/stats.test.ts
git commit -m "test(api): events count uses Ticket status='used' (chunk 25)"
```

---

### Task 5: Test — posts count excludes hidden + missing-author rows

**Files:**

- Modify: `apps/api/test/garage/stats.test.ts`

- [ ] **Step 1: Add the test**

```ts
it('posts count excludes hidden + removed + orphaned (authorUserId=null) rows', async () => {
  const { user } = await createUser({ email: 'stats-posts@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const event = await seedEvent('stats-posts-evt');

  await prisma.feedPost.createMany({
    data: [
      { eventId: event.id, authorUserId: user.id, body: 'v1', status: 'visible' },
      { eventId: event.id, authorUserId: user.id, body: 'v2', status: 'visible' },
      {
        eventId: event.id,
        authorUserId: user.id,
        body: 'h',
        status: 'hidden',
        hiddenAt: new Date(),
      },
      // Authored by `user` but soft-deleted — must be excluded by status filter.
      { eventId: event.id, authorUserId: user.id, body: 'r', status: 'removed' },
      { eventId: event.id, authorUserId: null, body: 'orphan', status: 'visible' },
    ],
  });

  const stats = await getGarageStats(prisma, garage.id);
  expect(stats.posts).toBe(2); // only the two `visible` authored rows.
});
```

Before running: confirm `FeedPostStatus` enum still has `visible` + `hidden` + `removed` (`grep -n "enum FeedPostStatus" packages/db/prisma/schema.prisma`). If any value is renamed, update the test + impl `where.status` together.

- [ ] **Step 2: Run**

Run: `pnpm --filter @ccc/api test stats.test.ts -t 'posts count excludes'`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/garage/stats.test.ts
git commit -m "test(api): posts count filters status='visible' + non-null author (chunk 25)"
```

---

### Task 6: Test — `likesReceived` reads column, not `FeedReaction`

This is the §C4 invariant test. We prove two things:

1. The value comes from `Garage.likesReceived` even when `FeedReaction` rows disagree.
2. The implementation never calls `prisma.feedReaction.*`.

**Files:**

- Modify: `apps/api/test/garage/stats.test.ts`

- [ ] **Step 1: Add the test**

```ts
it('likesReceived comes from Garage column — divergent FeedReaction rows are ignored (§C4)', async () => {
  const { user } = await createUser({ email: 'stats-likes@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

  // Bump the denormalized counter directly (chunk 27 will normally do this
  // via the like-awarder; we simulate by setting the column).
  await prisma.garage.update({
    where: { id: garage.id },
    data: { likesReceived: 7 },
  });

  // FeedReaction rows DISAGREE with the column (2 rows vs counter=7). §C4:
  // column wins — service must return 7.
  const event = await seedEvent('stats-likes-evt');
  const post = await prisma.feedPost.create({
    data: { eventId: event.id, authorUserId: user.id, body: 'p', status: 'visible' },
  });
  const { user: liker1 } = await createUser({ email: 'liker1@jdm.test', verified: true });
  const { user: liker2 } = await createUser({ email: 'liker2@jdm.test', verified: true });
  await prisma.feedReaction.createMany({
    data: [
      { postId: post.id, userId: liker1.id, kind: 'like' },
      { postId: post.id, userId: liker2.id, kind: 'like' },
    ],
  });

  const stats = await getGarageStats(prisma, garage.id);
  expect(stats.likesReceived).toBe(7); // column wins, not count(2)
});

it('does NOT touch prisma.feedReaction.* — column-direct (§C4)', async () => {
  const { user } = await createUser({ email: 'stats-no-agg@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await prisma.garage.update({ where: { id: garage.id }, data: { likesReceived: 3 } });

  // Proxy throws if `feedReaction` is accessed — structural §C4 assertion.
  const guardedPrisma = new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === 'feedReaction') {
        throw new Error('§C4 violation: getGarageStats accessed prisma.feedReaction');
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof prisma;

  const stats = await getGarageStats(guardedPrisma, garage.id);
  expect(stats.likesReceived).toBe(3);
});
```

- [ ] **Step 2: Run both tests**

Run: `pnpm --filter @ccc/api test stats.test.ts -t 'likesReceived'`
Expected: PASS for both cases.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/garage/stats.test.ts
git commit -m "test(api): assert likesReceived is column-direct, never aggregated (§C4)"
```

---

### Task 7: Test — concurrent calls return identical results

Sanity check against accidental shared mutable state.

**Files:**

- Modify: `apps/api/test/garage/stats.test.ts`

- [ ] **Step 1: Add the test**

```ts
it('concurrent invocations return identical results (no shared state)', async () => {
  const { user } = await createUser({ email: 'stats-concurrent@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await prisma.garage.update({ where: { id: garage.id }, data: { likesReceived: 5 } });

  const event = await seedEvent('stats-conc-evt');
  await prisma.feedPost.create({
    data: { eventId: event.id, authorUserId: user.id, body: 'p', status: 'visible' },
  });

  const [a, b, c] = await Promise.all([
    getGarageStats(prisma, garage.id),
    getGarageStats(prisma, garage.id),
    getGarageStats(prisma, garage.id),
  ]);

  expect(a).toEqual(b);
  expect(b).toEqual(c);
  expect(a.posts).toBe(1);
  expect(a.likesReceived).toBe(5);
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @ccc/api test stats.test.ts -t 'concurrent'`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/garage/stats.test.ts
git commit -m "test(api): concurrent getGarageStats calls are deterministic (chunk 25)"
```

---

### Task 8: Test — `GarageNotFoundError` on missing garage

**Files:**

- Modify: `apps/api/test/garage/stats.test.ts`

- [ ] **Step 1: Add the test**

```ts
it('throws GarageNotFoundError for an unknown garageId', async () => {
  await expect(getGarageStats(prisma, 'cuid-that-does-not-exist')).rejects.toBeInstanceOf(
    GarageNotFoundError,
  );
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @ccc/api test stats.test.ts -t 'GarageNotFoundError'`
Expected: PASS.

- [ ] **Step 3: Run the full stats test file one last time**

Run: `pnpm --filter @ccc/api test stats.test.ts`
Expected: ALL 7 tests pass.

- [ ] **Step 4: Run typecheck one last time**

Run: `pnpm --filter @ccc/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/garage/stats.test.ts
git commit -m "test(api): unknown garageId throws GarageNotFoundError (chunk 25)"
```

---

## Verification

Must be green before opening the PR:

```bash
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api test stats.test.ts
```

Do NOT run the full vitest sweep locally (memory rule `feedback_no_full_test_suite_locally`). No schema rebuilds and no `@ccc/shared` rebuild needed.

---

## Acceptance criteria (skeleton chunk 25 mapping)

- `getGarageStats(client, garageId): Promise<GarageStats>` returns 4 fields; `client` is `PrismaClient | Prisma.TransactionClient` per canon §3 — Tasks 1, 3.
- `events` via `client.ticket.count` (`userId` + `status='used'`) — Tasks 3, 4. **(D1)** Task 4 seeds a second user's `used` ticket to prove the `userId` filter exists.
- `posts` via `client.feedPost.count` (`authorUserId` + `status='visible'`); excludes `hidden`, `removed`, and orphan rows — Tasks 3, 5.
- `likesReceived` from `Garage.likesReceived` column, never aggregated (§C4) — Tasks 3, 6.
- `joinedAt` ISO of `Garage.createdAt` — Tasks 2, 3.
- Counter reads in parallel via `Promise.all` — Task 3. **(D3: 1 row + 2 counters, not 3)**
- No killswitch read inside service (§C5) — Task 3.
- Real-Postgres tests via Testcontainers + `resetDatabase` — all test tasks.

---

## PR checklist (`feat/jdma-garage-phase2-25` → `main`)

- [ ] Branch from fresh `main` (`git log main..HEAD --oneline` shows only chunk-25 commits).
- [ ] `pnpm --filter @ccc/api typecheck` green.
- [ ] `pnpm --filter @ccc/api test stats.test.ts` green (7 tests).
- [ ] Edits limited to `apps/api/src/services/garage/stats.ts` + `apps/api/test/garage/stats.test.ts`.
- [ ] `grep -n "feedReaction" apps/api/src/services/garage/stats.ts` returns nothing.
- [ ] `grep -n "readGamificationEnabled" apps/api/src/services/garage/stats.ts` returns nothing.
- [ ] PR description names deviations D1, D3, D4 and references §C4, §C5, kickoff #5, canon §3, skeleton chunk 25.
- [ ] Target branch is `main`. Never push to `production`.
- [ ] Review requested only after PR exists.

---

## Self-review

- All 4 skeleton "test scope" names land in Tasks 2, 4, 5, 6. Tasks 7-8 add concurrent + not-found coverage (sibling service convention).
- `GarageStats` field names match `garageStatsSchema` from chunk 24 / phase 2 plan §395.
- Service tone matches Phase 1 reference `cover.ts`: exported error class, exported pure function, explicit client injection.
- Signature follows canon §3 (`PrismaClient | Prisma.TransactionClient`) so chunk 28's serializer can call this from inside a `$transaction` without a wrapper.
