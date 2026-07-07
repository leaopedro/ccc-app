# Chunk 32 — Hook awarder into feed-post like/unlike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `awardXp` (apply) + `revertLikeXp` (revert) into the feed reaction route so the 6 transitions in `2026-05-21-garage-progression-phase2-xp.md` §C4 produce the correct XP + `Garage.likesReceived` deltas on the post author's garage, all in the same transaction as the reaction row write.

**Architecture:** The reactions handler today runs four bare `prisma.*` calls with no `$transaction`. This chunk introduces a `prisma.$transaction` wrapper, computes the pre-transition `kind` once inside the tx, applies the reaction mutation, then dispatches to `awardXp`/`revertLikeXp` based on `(prevKind, nextKind)`. `sourceRef` uses the opaque `FeedReaction.id` per §C3. Per canon §5, the route does **NOT** wrap awarder calls in a `try/catch` inside the parent `$transaction`: chunk 27's awarder catches expected `P2002` duplicates and short-circuits on killswitch, while any other thrown error propagates so the parent tx rolls back (route surfaces 500). Per canon §6, the awarder owns the `Garage.likesReceived` movement end-to-end — `awardXp('post_like', ...)` increments both `xp` and `likesReceived` in one statement, `revertLikeXp` decrements both. The route never touches `likesReceived` directly.

**Tech Stack:** Fastify, Prisma `$transaction` (`Prisma.TransactionClient`), Vitest, real Postgres via the repo's testcontainer-style `resetDatabase()` helper.

---

## Verification context (read FIRST, drives every code decision below)

Findings captured by reading code on `main` before drafting wiring.

### FeedReaction — `packages/db/prisma/schema.prisma:1201-1214`

```prisma
model FeedReaction {
  id        String   @id @default(cuid())
  postId    String
  userId    String
  kind      String   @default("like") @db.VarChar(20)
  createdAt DateTime @default(now())
  post FeedPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([postId, userId])
  @@index([postId])
  @@index([userId])
}
```

Load-bearing facts:

- `kind` is free-form `VarChar(20)`, NOT a Prisma enum. Shared zod (`packages/shared/src/feed.ts:140-143`) constrains to `'like' | 'dislike'`. Only `'like'` rows move XP + `likesReceived`.
- `@@unique([postId, userId])` — one row per (post, user). Transitions are **same-row updates**, NOT delete+insert.
- `id` is an opaque cuid — used as `sourceRef` payload per §C3.
- `Garage.likesReceived` is added by chunk 23 (`schema.prisma:195-214`). Not on main yet. **Chunk 32 depends on chunk 23 merged first.**

### FeedPost — `packages/db/prisma/schema.prisma:1138-1162`

`authorUserId` is `String?` (SetNull on user delete). Author garage resolved via `prisma.garage.findUnique({ where: { userId: authorUserId } })`. Null author → skip awarder (no garage to credit).

### Reaction route — `apps/api/src/routes/feed.ts:594-653`

```
POST /events/:eventId/feed/:postId/reactions
Body: { kind: 'like' | 'dislike' }  (feedReactionInputSchema)
Auth + rate limit: scoped at lines 248-249
Response: 200 { likes: number, mine: boolean }
```

**Transition pattern observed at lines 622-640 — same-row update via try/catch on the unique constraint:**

```ts
const where = { postId_userId: { postId, userId: sub } };
let created = false;
try {
  await prisma.feedReaction.create({ data: { postId, userId: sub, kind } });
  created = true; // path A: no→like / no→dislike
} catch (err) {
  if (!isUniqueConstraintError(err)) throw err;
}
if (!created) {
  const existing = await prisma.feedReaction.findUnique({ where, select: { kind: true } });
  if (existing?.kind === kind) {
    await prisma.feedReaction.delete({ where }); // path B: like→none / dislike→none
  } else {
    await prisma.feedReaction.update({ where, data: { kind } }); // path C: like↔dislike
  }
}
```

Three code paths, six §C4 transitions:

| Path | Branch                            | `prevKind`      | `nextKind` | §C4 rows covered           |
| ---- | --------------------------------- | --------------- | ---------- | -------------------------- |
| A    | `create` succeeded                | `null`          | `kind`     | no→like, no→dislike        |
| B    | `existing.kind === kind` → delete | `existing.kind` | `null`     | like→none, dislike→none    |
| C    | `existing.kind !== kind` → update | `existing.kind` | `kind`     | like→dislike, dislike→like |

Awarder dispatch is uniform on `(prevKind, nextKind)`:

```
prevKind !== 'like' && nextKind === 'like' → awardXp(...)           // no→like, dislike→like
prevKind === 'like' && nextKind !== 'like' → revertLikeXp(...)      // like→none, like→dislike
otherwise                                  → no XP movement
```

`reactionId` (opaque, for `sourceRef`) is the `FeedReaction.id` at the awarder call site. `@@unique([postId, userId])` makes it stable across path C's update (primary key is unchanged by an update to `kind`), and path B sees the same id that existed at apply time. Path A reads it from `create`'s return; paths B/C extend the existing-row `select` to include `id`.

### Awarder service — `apps/api/src/services/garage/xp-awarder.ts` (chunk 27 — assumed merged)

- `awardXp(tx, garageId, reason, opts)` — canonical 4-arg positional signature per fix-canon §4. Writes one `XpEvent` row + `Garage.update({ xp: { increment: delta }, likesReceived: { increment: 1 } })` for `post_like` (counters incremented in a single statement). Killswitch off → `{ awarded: false, reason: 'gamification_disabled' }`, no DB touch. `P2002` (duplicate sourceRef) → `{ awarded: false, reason: 'duplicate' }`, no DB rollback. Any other error → RETHROW so the parent tx rolls back. (Canon §5.)
- `revertLikeXp(tx, postId, reactionId, authorGarageId)` — exact §C2 signature. Killswitch off OR no matching `XpEvent` row → silent no-op, no `Garage` write. Hard-deletes the matching `XpEvent` and decrements `Garage.xp` AND `Garage.likesReceived` by 1 in one statement. Same rethrow contract for unexpected errors.

**`likesReceived` ownership (canon §6):** The awarder is the SINGLE source of truth for `Garage.likesReceived`. `awardXp('post_like')` and `revertLikeXp` each move both `xp` and `likesReceived` in a single `Garage.update`. The route MUST NOT issue any `Garage.update` for `likesReceived` (would double-count or drift).

### Reference patterns

- Tx pattern: feed-post create handler at `apps/api/src/routes/feed.ts:308-342` already uses `prisma.$transaction(async (tx) => { ... })` + `awardBadge(tx, ...)`. Mirror for reactions.
- Test scaffolding: `apps/api/test/helpers.ts` exposes `makeApp()`, `resetDatabase()` (already wipes `feedReaction`/`feedPost`/`garage`/`generalSettings`; chunk 23 adds `xpEvent`), `createUser`, `bearer`. Fixture pattern in `apps/api/test/garage/badges-write-hooks.test.ts`.

---

## Scope

**In:** wrap reactions handler (`feed.ts:594-653`) in `prisma.$transaction`; dispatch `awardXp`/`revertLikeXp` per `(prevKind, nextKind)`; sourceRef `post:<postId>:reaction:<reactionId>` (§C3); credit the **post author's garage**; let non-P2002 awarder errors propagate so the parent tx rolls back (canon §5); add `apps/api/test/garage/xp-post-like.test.ts` with 11 specs.

**Out:** payload serialization of `likesReceived` (chunk 28); self-like policy (see deviation below); pre-launch backfill (§C6 — no reconcile).

## File structure

| File                                        | Action                            | Responsibility                                                                                                              |
| ------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/feed.ts`               | Modify (~45 LOC at lines 594-653) | Wrap in `$transaction`, capture prev/next kind + reactionId, dispatch awarder (no local try/catch)                          |
| `apps/api/test/garage/xp-post-like.test.ts` | Create                            | 11 specs: 6 §C4 transitions + idempotency + killswitch + §C6 + awarder-throw rollback + mid-tx rollback + tombstoned author |

No new shared schemas, no migration, no new service file. `awardXp` + `revertLikeXp` come from chunk 27.

---

## Code shape — final route (after this chunk)

The block currently at lines 594-653 becomes:

```ts
// ---- POST /events/:eventId/feed/:postId/reactions ----
scoped.post('/events/:eventId/feed/:postId/reactions', {}, async (request, reply) => {
  const { sub, role } = requireUser(request);
  const { eventId, postId } = postIdParam.parse(request.params);
  const { kind } = feedReactionInputSchema.parse(request.body);

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { feedEnabled: true },
  });
  if (!event) return reply.status(404).send({ error: 'NotFound', message: 'Event not found' });
  if (!event.feedEnabled)
    return reply.status(403).send({ error: 'Forbidden', message: 'Feed disabled' });

  const access = await checkFeedReadAccess(eventId, sub, role);
  if (access === 'banned')
    return reply.status(403).send({ error: 'Forbidden', message: 'Banned from feed' });
  if (access === 'forbidden')
    return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });

  const post = await prisma.feedPost.findFirst({
    where: { id: postId, eventId, status: 'visible' },
    select: { id: true, authorUserId: true },
  });
  if (!post) return reply.status(404).send({ error: 'NotFound', message: 'Post not found' });

  const where = { postId_userId: { postId, userId: sub } };

  // Resolve the author's garageId once — used for both apply and revert paths.
  // Outside the tx: this is a read-only lookup that does not mutate state.
  // If the author has been tombstoned (authorUserId === null) OR has no garage,
  // skip awarder entirely. The reaction still lands.
  let authorGarageId: string | null = null;
  if (post.authorUserId) {
    const g = await prisma.garage.findUnique({
      where: { userId: post.authorUserId },
      select: { id: true },
    });
    authorGarageId = g?.id ?? null;
  }

  const txResult = await prisma.$transaction(async (tx) => {
    let prevKind: string | null = null;
    let nextKind: string | null = null;
    let reactionId: string | null = null;

    let created = false;
    try {
      const row = await tx.feedReaction.create({
        data: { postId, userId: sub, kind },
        select: { id: true },
      });
      created = true;
      prevKind = null;
      nextKind = kind;
      reactionId = row.id;
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
    }

    if (!created) {
      const existing = await tx.feedReaction.findUnique({
        where,
        select: { id: true, kind: true },
      });
      if (!existing) {
        // Race: row vanished between create-failure and re-read. Treat as no-op.
        return;
      }
      reactionId = existing.id;
      prevKind = existing.kind;
      if (existing.kind === kind) {
        await tx.feedReaction.delete({ where });
        nextKind = null;
      } else {
        await tx.feedReaction.update({ where, data: { kind } });
        nextKind = kind;
      }
    }

    // Awarder dispatch. No local try/catch (canon §5): the awarder swallows
    // expected P2002 + killswitch internally; any other throw rolls back the
    // entire reaction transaction (route surfaces 500). Both calls are no-ops
    // when authorGarageId is null (tombstoned author or author has no garage).
    if (!authorGarageId || !reactionId) return;
    const sourceRef = `post:${postId}:reaction:${reactionId}`;

    if (prevKind !== 'like' && nextKind === 'like') {
      await awardXp(tx, authorGarageId, 'post_like', { sourceRef });
    } else if (prevKind === 'like' && nextKind !== 'like') {
      await revertLikeXp(tx, postId, reactionId, authorGarageId);
    }
    // All other (prevKind, nextKind) pairs: no XP movement.
  });
  void txResult;

  const [likes, mine] = await Promise.all([
    prisma.feedReaction.count({ where: { postId, kind: 'like' } }),
    prisma.feedReaction.findUnique({
      where,
      select: { kind: true },
    }),
  ]);

  const result = { likes, mine: mine?.kind === 'like' };

  return reply.status(200).send(result);
});
```

Awarder + revert imports go next to the existing `awardBadge` import at `apps/api/src/routes/feed.ts:19`:

```ts
import { awardBadge } from '../services/garage/awarder.js';
import { awardXp, revertLikeXp } from '../services/garage/xp-awarder.js';
```

§C4 transition matrix → code path mapping (proof every row is covered):

| Transition     | Code path observed | `prevKind`  | `nextKind`  | Awarder dispatch     | XP delta | likesReceived delta |
| -------------- | ------------------ | ----------- | ----------- | -------------------- | -------- | ------------------- |
| no → like      | A (`create`)       | `null`      | `'like'`    | `awardXp(post_like)` | +1       | +1                  |
| like → none    | B (`delete`)       | `'like'`    | `null`      | `revertLikeXp`       | -1       | -1                  |
| no → dislike   | A (`create`)       | `null`      | `'dislike'` | neither              | 0        | 0                   |
| dislike → none | B (`delete`)       | `'dislike'` | `null`      | neither              | 0        | 0                   |
| like → dislike | C (`update`)       | `'like'`    | `'dislike'` | `revertLikeXp`       | -1       | -1                  |
| dislike → like | C (`update`)       | `'dislike'` | `'like'`    | `awardXp(post_like)` | +1       | +1                  |

---

## Task 1: Test fixture + happy-path no→like

**Files:** Create `apps/api/test/garage/xp-post-like.test.ts`. Modify `apps/api/src/routes/feed.ts`.

- [ ] **Step 1: Write the failing test (fixture + first spec)**

```ts
import { prisma } from '@jdm/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@jdm/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as xpAwarder from '../../src/services/garage/xp-awarder.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

type Fixture = {
  authorId: string;
  authorGarageId: string;
  likerId: string;
  eventId: string;
  postId: string;
};

// Canon §8 — singleton id is a string constant, never numeric 1.
const enableGamification = async () => {
  await prisma.generalSettings.upsert({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    update: { gamificationEnabled: true },
    create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: true },
  });
};

const disableGamification = async () => {
  await prisma.generalSettings.upsert({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    update: { gamificationEnabled: false },
    create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
  });
};

// Canon §9 — Event fixture must include type, capacity, published status, and
// feedAccess: 'public' (or a valid ticket for the liker). Mirrors apps/api/test/feed/crud.test.ts.
const buildFixture = async (): Promise<Fixture> => {
  const { user: author } = await createUser({ email: 'author@jdm.test', verified: true });
  const { user: liker } = await createUser({ email: 'liker@jdm.test', verified: true });
  const authorGarage = await prisma.garage.findUniqueOrThrow({ where: { userId: author.id } });
  const event = await prisma.event.create({
    data: {
      slug: 'react-evt',
      title: 'React Event',
      description: 'd',
      type: 'meeting',
      status: 'published',
      capacity: 100,
      startsAt: new Date('2026-06-01T10:00:00Z'),
      endsAt: new Date('2026-06-01T12:00:00Z'),
      feedEnabled: true,
      feedAccess: 'public',
    },
  });
  const post = await prisma.feedPost.create({
    data: {
      eventId: event.id,
      authorUserId: author.id,
      body: 'fixture post',
      status: 'visible',
    },
  });
  return {
    authorId: author.id,
    authorGarageId: authorGarage.id,
    likerId: liker.id,
    eventId: event.id,
    postId: post.id,
  };
};

const react = async (
  app: FastifyInstance,
  env: ReturnType<typeof loadEnv>,
  fx: Fixture,
  kind: 'like' | 'dislike',
) =>
  app.inject({
    method: 'POST',
    url: `/events/${fx.eventId}/feed/${fx.postId}/reactions`,
    headers: { authorization: bearer(env, fx.likerId) },
    payload: { kind },
  });

describe('awarder hook — feed post reactions', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await enableGamification();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('no → like awards +1 XP and +1 likesReceived to the post author', async () => {
    const env = loadEnv();
    const fx = await buildFixture();

    const res = await react(app, env, fx, 'like');
    expect(res.statusCode).toBe(200);

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
    expect(garage.xp).toBe(1);
    expect(garage.likesReceived).toBe(1);

    const reaction = await prisma.feedReaction.findUniqueOrThrow({
      where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
    });
    const xp = await prisma.xpEvent.findFirstOrThrow({
      where: { garageId: fx.authorGarageId, reason: 'post_like' },
    });
    expect(xp.delta).toBe(1);
    expect(xp.sourceRef).toBe(`post:${fx.postId}:reaction:${reaction.id}`);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @jdm/api exec vitest run test/garage/xp-post-like.test.ts -t 'no → like'` — expect FAIL (`garage.xp === 0`, awarder not wired).
- [ ] **Step 3: Wire awarder.** In `apps/api/src/routes/feed.ts` add `import { awardXp, revertLikeXp } from '../services/garage/xp-awarder.js';` next to line 19, then replace lines 594-653 with the full route shown in §"Code shape" above.
- [ ] **Step 4: Run** same vitest command — expect PASS.
- [ ] **Step 5: Commit** `feat(api): wire xp awarder into feed reaction no→like path`.

---

**Tasks 2-11 share the same shape:** modify `apps/api/test/garage/xp-post-like.test.ts`, add the spec, run `pnpm --filter @jdm/api exec vitest run test/garage/xp-post-like.test.ts -t '<title>'` to confirm PASS, then `git add` the test file + commit. The wiring from Task 1 covers every transition branch — no further edits to `feed.ts` are needed.

## Task 2: like → none (revert)

- [ ] Add spec; run; commit `test(api): cover like→none revert`.

```ts
it('like → none hard-deletes the XpEvent row, -1 XP, -1 likesReceived', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  await react(app, env, fx, 'like');
  const res = await react(app, env, fx, 'like'); // toggle off
  expect(res.statusCode).toBe(200);
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(0);
  expect(garage.likesReceived).toBe(0);
  const xpRows = await prisma.xpEvent.findMany({
    where: { garageId: fx.authorGarageId, reason: 'post_like' },
  });
  expect(xpRows).toHaveLength(0);
  const reaction = await prisma.feedReaction.findUnique({
    where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
  });
  expect(reaction).toBeNull();
});
```

## Task 3: no → dislike + dislike → none (zero-XP paths)

- [ ] Add both specs; run; commit `test(api): cover dislike paths are XP-neutral`.

```ts
it('no → dislike moves no XP, no likesReceived', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  const res = await react(app, env, fx, 'dislike');
  expect(res.statusCode).toBe(200);
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(0);
  expect(garage.likesReceived).toBe(0);
  const xpRows = await prisma.xpEvent.findMany({
    where: { garageId: fx.authorGarageId, reason: 'post_like' },
  });
  expect(xpRows).toHaveLength(0);
});

it('dislike → none moves no XP, no likesReceived', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  await react(app, env, fx, 'dislike');
  const res = await react(app, env, fx, 'dislike'); // toggle off
  expect(res.statusCode).toBe(200);
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(0);
  expect(garage.likesReceived).toBe(0);
  const reaction = await prisma.feedReaction.findUnique({
    where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
  });
  expect(reaction).toBeNull();
});
```

## Task 4: like → dislike (revert via §C2)

- [ ] Add spec; run; commit `test(api): cover like→dislike revert`.

```ts
it('like → dislike reverts via revertLikeXp: -1 XP, -1 likesReceived, no XpEvent row', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  await react(app, env, fx, 'like');
  const res = await react(app, env, fx, 'dislike');
  expect(res.statusCode).toBe(200);
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(0);
  expect(garage.likesReceived).toBe(0);
  const xpRows = await prisma.xpEvent.findMany({
    where: { garageId: fx.authorGarageId, reason: 'post_like' },
  });
  expect(xpRows).toHaveLength(0);
  const reaction = await prisma.feedReaction.findUniqueOrThrow({
    where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
  });
  expect(reaction.kind).toBe('dislike'); // row still exists, flipped
});
```

## Task 5: dislike → like

- [ ] Add spec; run; commit `test(api): cover dislike→like transition`.

```ts
it('dislike → like awards +1 XP and +1 likesReceived', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  await react(app, env, fx, 'dislike');
  const res = await react(app, env, fx, 'like');
  expect(res.statusCode).toBe(200);
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(1);
  expect(garage.likesReceived).toBe(1);
  const reaction = await prisma.feedReaction.findUniqueOrThrow({
    where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
  });
  expect(reaction.kind).toBe('like');
  const xp = await prisma.xpEvent.findFirstOrThrow({
    where: { garageId: fx.authorGarageId, reason: 'post_like' },
  });
  expect(xp.delta).toBe(1);
  expect(xp.sourceRef).toBe(`post:${fx.postId}:reaction:${reaction.id}`);
});
```

## Task 6: Idempotency on retry — duplicate like POST nets zero

A second POST of the same kind is a toggle-off (path B). The pair net-zeroes both `XpEvent` row count and `Garage` counters.

- [ ] Add spec; run; commit `test(api): assert duplicate like POST nets zero`.

```ts
it('duplicate like POST (toggle-off) nets zero — no double XP increment', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  await react(app, env, fx, 'like');
  const beforeXp = await prisma.xpEvent.count({
    where: { garageId: fx.authorGarageId, reason: 'post_like' },
  });
  expect(beforeXp).toBe(1);
  await react(app, env, fx, 'like'); // toggle off
  const afterXp = await prisma.xpEvent.count({
    where: { garageId: fx.authorGarageId, reason: 'post_like' },
  });
  expect(afterXp).toBe(0);
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(0);
  expect(garage.likesReceived).toBe(0);
});
```

## Task 7: Killswitch OFF — reaction succeeds, no XP movement

Chunk 27's `awardXp` short-circuits on killswitch per §C5; the route still 200s.

- [ ] Add spec; run; commit `test(api): killswitch off keeps reaction working with no XP`.

```ts
it('killswitch off: like succeeds, no XP, no likesReceived', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  await disableGamification();
  const res = await react(app, env, fx, 'like');
  expect(res.statusCode).toBe(200);
  const reaction = await prisma.feedReaction.findUniqueOrThrow({
    where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
  });
  expect(reaction.kind).toBe('like');
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(0);
  expect(garage.likesReceived).toBe(0);
  const xpRows = await prisma.xpEvent.findMany({
    where: { garageId: fx.authorGarageId, reason: 'post_like' },
  });
  expect(xpRows).toHaveLength(0);
});
```

## Task 8: §C6 — pre-launch like has no XpEvent, unlike is safe no-op

Simulates §C6 launch day: an existing `FeedReaction` row with no corresponding `XpEvent`. `revertLikeXp` early-returns per §C2 line 75 — counters must NOT go negative.

- [ ] Add spec; run; commit `test(api): pre-launch unlike is safe no-op (§C6)`.

```ts
it('§C6: pre-launch like has no XpEvent — unlike is a safe no-op (no negative counters)', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  // Pre-launch state: FeedReaction row exists with no XpEvent. Garage stays at 0.
  await prisma.feedReaction.create({
    data: { postId: fx.postId, userId: fx.likerId, kind: 'like' },
  });
  const res = await react(app, env, fx, 'like'); // toggle off
  expect(res.statusCode).toBe(200);
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(0); // not -1
  expect(garage.likesReceived).toBe(0); // not -1
});
```

## Task 9: Non-P2002 awarder throw rolls back the parent tx (canon §5)

Asserts the canonical error contract: chunk 27's awarder swallows expected `P2002` + killswitch internally; any other thrown error propagates so the route's `$transaction` rolls back the reaction write. The route MUST NOT swallow.

Mocking strategy (per review MAJOR — `vi.spyOn(prisma.garage, 'update')` does NOT intercept `tx.garage.update`, because tx and base client are separate proxies). Mock the AWARDER MODULE itself — that interception fires regardless of which client the route hands to the awarder.

- [ ] Add spec; run; commit `test(api): non-P2002 awarder throw rolls back reaction tx`.

```ts
it('non-P2002 awarder throw rolls back the entire reaction tx — no FeedReaction row, route 500s', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  // Force the awarder to throw an unexpected error inside the parent tx.
  // Mocking the awarder module call intercepts the route's awarder dispatch
  // regardless of which prisma client (tx or base) is passed in.
  const spy = vi.spyOn(xpAwarder, 'awardXp').mockImplementationOnce(async () => {
    throw new Error('forced non-P2002 awarder failure');
  });

  const res = await react(app, env, fx, 'like');
  expect(res.statusCode).toBe(500); // route does NOT swallow; throw propagates

  // Tx rollback: no FeedReaction row, no XpEvent row, garage counters untouched.
  const reaction = await prisma.feedReaction.findUnique({
    where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
  });
  expect(reaction).toBeNull();
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(0);
  expect(garage.likesReceived).toBe(0);
  const xpRows = await prisma.xpEvent.findMany({ where: { garageId: fx.authorGarageId } });
  expect(xpRows).toHaveLength(0);

  spy.mockRestore();
});
```

## Task 10: Parent tx rollback through the path-C revert branch

Asserts §456 #3 ("XpEvent row in the same transaction as the parent write"). On a `like → dislike` transition (path C), `revertLikeXp` runs inside the same `$transaction` as the `feedReaction.update`. If the awarder throws here, the reaction update MUST roll back too — the original `like` row survives and counters stay at their post-Task-1 values.

Mocking strategy (per review MAJOR — `vi.spyOn(prisma.feedReaction, 'update')` does NOT intercept `tx.feedReaction.update`). Mock the awarder MODULE's `revertLikeXp` to throw; this fires regardless of which prisma client the route hands in, and the throw originates from inside the parent `$transaction`'s callback, so the tx aborts.

- [ ] Add spec; run; commit `test(api): parent tx rollback via revert path leaves prior state intact`.

```ts
it('parent tx rollback: throw inside revertLikeXp leaves XP + counters + reaction at pre-attempt values', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  await react(app, env, fx, 'like'); // baseline: xp=1, likesReceived=1, one XpEvent row, reaction.kind = 'like'

  // Force revertLikeXp to throw inside the parent tx. The route does NOT
  // catch awarder errors (canon §5), so the throw aborts the $transaction
  // and rolls back the feedReaction.update that already ran in this branch.
  const spy = vi.spyOn(xpAwarder, 'revertLikeXp').mockImplementationOnce(async () => {
    throw new Error('forced parent-tx rollback via revert path');
  });

  const res = await react(app, env, fx, 'dislike'); // path C — will throw
  expect(res.statusCode).toBe(500); // route surfaces the throw

  spy.mockRestore();

  const after = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(after.xp).toBe(1); // rollback held
  expect(after.likesReceived).toBe(1);
  const afterXpCount = await prisma.xpEvent.count({
    where: { garageId: fx.authorGarageId, reason: 'post_like' },
  });
  expect(afterXpCount).toBe(1);
  const reaction = await prisma.feedReaction.findUniqueOrThrow({
    where: { postId_userId: { postId: fx.postId, userId: fx.likerId } },
  });
  expect(reaction.kind).toBe('like'); // original 'like' row survived rollback
});
```

## Task 11: Tombstoned author (`authorUserId === null`) — reaction succeeds, no awarder dispatch

`FeedPost.authorUserId` is `String?` (SetNull on user delete). The route's `if (post.authorUserId)` guard + the tx's `if (!authorGarageId) return` guard must skip the awarder cleanly.

- [ ] Add spec; run; commit `test(api): tombstoned post author skips awarder cleanly`.

```ts
it('post with tombstoned author (authorUserId null): like succeeds, no XP movement anywhere', async () => {
  const env = loadEnv();
  const fx = await buildFixture();
  await prisma.feedPost.update({
    where: { id: fx.postId },
    data: { authorUserId: null }, // simulate User deletion → SetNull
  });
  const res = await react(app, env, fx, 'like');
  expect(res.statusCode).toBe(200);
  const xpRows = await prisma.xpEvent.findMany({});
  expect(xpRows).toHaveLength(0);
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: fx.authorGarageId } });
  expect(garage.xp).toBe(0);
  expect(garage.likesReceived).toBe(0);
});
```

---

## Verification (whole-chunk gate)

- [ ] `pnpm --filter @jdm/api exec vitest run test/garage/xp-post-like.test.ts` — 11 pass.
- [ ] `pnpm --filter @jdm/api typecheck` — 0 errors.
- [ ] `pnpm --filter @jdm/api exec eslint src/routes/feed.ts test/garage/xp-post-like.test.ts` — 0 errors. (Canon §10: package-root-relative paths via `exec eslint`.)
- [ ] `grep -n 'reaction:' apps/api/src/routes/feed.ts` — exactly one match (the sourceRef template literal). §C3 hand-confirm.
- [ ] `grep -n 'likesReceived' apps/api/src/routes/feed.ts` — zero matches. Canon §6: route never touches `likesReceived`.

## Corrections applied (from `2026-05-21-garage-progression-phase2-xp.md` + `2026-05-24-phase2-fix-canon`)

- **§C1** — `XpEvent.@@unique([garageId, reason, sourceRef])` at DB. Awarder catches `P2002` → `{ awarded: false, reason: 'duplicate' }`. Toggle path's net-zero idempotency (Task 6) relies on `FeedReaction.@@unique([postId, userId])` already blocking duplicate inserts at the row level.
- **§C2** — `revertLikeXp(tx, postId, reactionId, authorGarageId)` exact signature. No-prior-row early return powers Task 8 (§C6).
- **§C3** — `sourceRef = post:<postId>:reaction:<reactionId>` (opaque `FeedReaction.id`). Never `likerUserId`. Asserted in Tasks 1 + 5.
- **§C4** — Likes data source is `FeedReaction` (verified). Transition matrix §C4 lines 105-112 covered by Tasks 1-5 + the §"Code shape" mapping table.
- **§C6** — No launch reconcile. Day-one `Garage.likesReceived = 0`. Pre-launch reactions have no `XpEvent`; `revertLikeXp` is a safe no-op (Task 8).
- **Fix-canon §4** — `awardXp(tx, garageId, reason, opts)` positional 4-arg signature used at the route call site (BLOCK fix; was previously assumed to match an options-object variant — chunks 27 + 29-35 align on the positional shape).
- **Fix-canon §5** — Awarder error contract: route does NOT wrap awarder calls in `try/catch` inside the parent tx. Awarder swallows expected `P2002` + killswitch; any other error rethrows so the parent `$transaction` rolls back. Task 9 asserts the rollback path; Task 10 asserts the same via the revert branch.
- **Fix-canon §6** — `Garage.likesReceived` ownership is the awarder, NOT the route. `awardXp('post_like')` increments both `xp` and `likesReceived` in one statement; `revertLikeXp` decrements both. The route never issues a `Garage.update` for `likesReceived`. Tasks 1-5 assert counter movement on the garage, proving ownership flows through the awarder; verification `grep` step asserts zero `likesReceived` mentions in the route source.
- **Fix-canon §8** — `enableGamification` / `disableGamification` test helpers use `GENERAL_SETTINGS_SINGLETON_ID` string constant (imported from `@jdm/shared/general-settings`), never numeric `id: 1`.
- **Fix-canon §9** — `buildFixture` seeds `Event.type='meeting'`, `capacity=100`, `status='published'`, `feedAccess='public'`. Mirrors `apps/api/test/feed/crud.test.ts`. No ticket needed because feed is public.
- **Fix-canon §10** — Filtered vitest + eslint commands use `pnpm --filter @jdm/api exec ...` with package-root-relative paths (`test/garage/xp-post-like.test.ts`, `src/routes/feed.ts`).
- **Fix-canon §11** — Test filename is `apps/api/test/garage/xp-post-like.test.ts` (skeleton-canonical), not `awarder-feed-post-like.test.ts`.

## Deviations

1. **Self-like policy (skeleton §312, outline silent):** allowed — awards XP exactly like any other like. Symmetric data path; reaction model has no author-vs-liker constraint. Blocking it is a separate input-validation ticket, not an awarder change. Flag for reviewer.
2. **Skeleton §307-309 transition shape (unknown until verify):** confirmed **same-row update** (`feedReaction.update` for like↔dislike, `delete` for toggle-off, `create` only for first reaction). Wiring codifies this.
3. **Skeleton §301 file location (`services/feed/reactions.ts`?):** route lives at `apps/api/src/routes/feed.ts:594-653`. No relocation.
4. **Skeleton §315 stale outline §278 sourceRef (`post:<postId>:like:<likerUserId>`):** NOT used. §C3 format used instead.
5. **Tx wrapper introduced:** reactions handler currently uses bare `prisma.*` with no `$transaction`. This chunk wraps it — a real behavior change (rollback semantics now apply to the reaction write). Task 10 asserts it.
6. **Route 500 on unexpected awarder failure (new behavior):** previously this plan caught awarder errors inside the tx and 200'd. Canon §5 reverses that — non-P2002/non-killswitch awarder errors now propagate, the parent tx rolls back, and the route surfaces 500. This is the correct atomicity contract: a partial XP write must never commit alongside a reaction write. Flag for reviewer (alert/observability follow-up may be wanted in a separate ticket, but is out of scope here).

## PR checklist

- [ ] Branch `feat/jdma-garage-phase2-32` from freshly pulled `main` (`git pull --ff-only origin main`).
- [ ] Confirm `git branch --show-current` is NOT `production` before first edit (CLAUDE.md preflight).
- [ ] All 11 specs pass against real Postgres (CLAUDE.md integration-test rule).
- [ ] `pnpm --filter @jdm/api typecheck` clean.
- [ ] No edits outside `apps/api/src/routes/feed.ts` + the new test file.
- [ ] PR body cites §C2, §C3, §C4, §C6, §437 + fix-canon §4/§5/§6/§8/§9/§10/§11.
- [ ] PR body lists the 6 deviations so reviewer decides self-like policy + 500-on-awarder-failure observability explicitly.
- [ ] PR targets `main`. Request review only after the PR exists.
