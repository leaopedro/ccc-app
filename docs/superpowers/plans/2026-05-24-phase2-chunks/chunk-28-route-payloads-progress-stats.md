# Chunk 28 — Wire `progress` + `stats` into Route Payloads + 404 Byte Parity + DSR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `GET /me/garage` and `GET /g/:slug` responses to carry **response-top-level** `progress`, `stats`, and `gamification: { enabled }` capability fields (per canon §1 — NEVER nested under `garage`). Read the killswitch synchronously on every request. Public route hides `progress` + `stats` when all four metrics (`xp`, `events`, `posts`, `likesReceived`) are zero. Add the byte-identical 404 regression test from §C9. Extend the DSR export route + anonymize service to cover the new XP surface per canon §14.

**Architecture:** Two route handlers in `apps/api/src/routes/garage.ts` gain optional fields at the response top level. Killswitch off → both routes omit `progress` + `stats` and return `gamification: { enabled: false }`. Killswitch on → owner always renders both; public applies hide-on-empty per "Locked invariants" #2 against all four metrics. Services `getGarageStats` (chunk 25) + `getGarageProgress` (chunk 26) ship the shapes; **both are called as `getGarageProgress(prisma, garage.id)` / `getGarageStats(prisma, garage.id)` — prisma FIRST per canon §3**. Shared schemas (chunk 24) accept them as `.optional()` per §C10. The 404 path on `/g/:slug` stays byte-identical (§C9). DSR: `data-export.ts` exports `Garage.xp` + `Garage.likesReceived` + the user's `XpEvent` rows; `anonymize.ts` resets both counters to 0 and deletes the user's `XpEvent` rows inside the existing anonymize tx (canon §14).

**Tech Stack:** Fastify, Prisma, `@ccc/shared` zod, Vitest + real Postgres via `makeApp` + `resetDatabase` helpers. Final 2A gate (skeleton "Parallel-with: none in 2A"). Reads from chunks 24/25/26 (and Phase 1 killswitch).

---

## Required reading before implementing

- `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 28" (lines 222-242) — acceptance criteria + deviation candidates.
- `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`: §C5 (lines 116-118) sync killswitch read; §C9 (lines 168-186) byte-identical 404 test verbatim; §C10 (lines 189-216) optional schemas; "Locked invariants" #2 (line 28) hide-on-empty; "API surface" (lines 370-404) payload shapes; "Killswitch" (lines 502-515) per-route behavior when disabled.
- `docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` — Phase 1 chunk 13 (SSR public payload), chunks 06-08 (owner shape) — confirms 404 invariant + serializer surface.
- `apps/api/src/routes/garage.ts` whole file — `loadOwnerView` + `/g/:slug` handler are the integration sites.
- `CLAUDE.md` — branch safety preflight + git flow.

---

## Pre-flight checklist (run once, before Task 1)

- [ ] **Pre-flight 1: Branch safety preflight (CLAUDE.md)**

```bash
git branch --show-current
```

Expected: NOT `production`. If output is `production`, STOP and run `git checkout main && git pull --ff-only origin main` before continuing.

- [ ] **Pre-flight 2: Confirm dependency chunks already merged**

```bash
ls packages/shared/src/garage-progress.ts \
   apps/api/src/services/garage/progress.ts \
   apps/api/src/services/garage/stats.ts \
   apps/api/src/services/garage/xp-awarder.ts \
   apps/api/src/services/garage/killswitch.ts
```

Expected: all 5 files exist. If any is missing, stop and finish the upstream chunk (24/25/26/27 or Phase 1 killswitch) before continuing.

- [ ] **Pre-flight 3: Confirm shared schemas already optional `progress` / `stats` and top-level `gamification` (chunk 24)**

```bash
grep -n "progress\|stats\|gamification" packages/shared/src/garage.ts packages/shared/src/garage-public.ts
```

Expected: both `garageReadSchema` and `garagePublicResponseSchema` contain `progress: garageProgressSchema.optional()`, `stats: garageStatsSchema.optional()`, and `gamification: z.object({ enabled: z.boolean() })` at the response top level (per §C10).

If missing, chunk 24 is incomplete — stop and finish it.

- [ ] **Pre-flight 4: Create branch from fresh main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-28
```

---

## Files touched

| Path                                                         | Action | Responsibility                                                                                                                                    |
| ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/garage.ts`                              | Modify | Extend `loadOwnerView` + `/g/:slug` handler. Wire `getGarageProgress`, `getGarageStats`, top-level `gamification` flag, hide-on-empty for public. |
| `apps/api/src/services/data-export.ts`                       | Modify | Add `xp` + `likesReceived` to the garage select; add `xpEvents` to the collected bundle + manifest entities (canon §14).                          |
| `apps/api/src/services/account-deletion/anonymize.ts`        | Modify | Inside the existing anonymize tx, reset `Garage.xp = 0` + `Garage.likesReceived = 0` and `prisma.xpEvent.deleteMany` for the user (canon §14).    |
| `apps/api/test/garage/garage-route-progress-stats.test.ts`   | Create | 8 integration tests (owner + public payload + extra hide-on-empty reveals).                                                                       |
| `apps/api/test/garage/garage-public-404-byte-parity.test.ts` | Create | §C9 regression test.                                                                                                                              |
| `apps/api/test/garage/xp-dsr.test.ts`                        | Create | DSR export inclusion + anonymize cleanup tests (canon §14).                                                                                       |

Serializers in `apps/api/src/services/garage/index.ts` stay unchanged — `progress` + `stats` land at the **response top level** per canon §1 + chunk 24, not under `garage`. Route handler assembles the final object. Deviates from skeleton's "extend serializers" line — see "Deviations" at the end.

---

## Task 1 — Add 404 byte-parity regression test (§C9) FIRST

Write this test before any production change so we catch any byte-difference caused by the wiring later in the chunk. TDD discipline: the test must pass against the unmodified route (since chunk 28 has not added anything yet, parity is trivially true) AND must keep passing after every later task.

**Files:**

- Create: `apps/api/test/garage/garage-public-404-byte-parity.test.ts`

- [ ] **Step 1: Write the §C9 regression test**

```ts
// apps/api/test/garage/garage-public-404-byte-parity.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /g/:slug — 404 byte parity (§C9)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('unknown slug and private slug return byte-identical 404', async () => {
    const a = await app.inject({ method: 'GET', url: '/g/unknown-slug-12345' });
    const { user: owner } = await createUser({ verified: true });
    await prisma.garage.update({
      where: { userId: owner.id },
      data: { slug: 'private-slug-12345', isPublic: false },
    });
    const b = await app.inject({ method: 'GET', url: '/g/private-slug-12345' });

    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(404);
    expect(a.body).toBe(b.body);
    expect(a.headers['content-type']).toBe(b.headers['content-type']);
  });
});
```

- [ ] **Step 2: Run and confirm pass against current code**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/garage-public-404-byte-parity.test.ts`
Expected: PASS (existing handler already returns `{ error: 'NotFound' }` for both paths). This is our safety net for Task 3.

- [ ] **Step 3: Commit (test-only — no production change yet)**

```bash
git add apps/api/test/garage/garage-public-404-byte-parity.test.ts
git commit -m "test(garage): add §C9 404 byte-parity regression test"
```

---

## Task 2 — Failing tests for the new owner + public payload fields

Write all 8 integration tests for the new behavior. They WILL fail until Task 3 wires the route changes. Describes/test names include the route strings (`GET /me/garage` + `GET /g/:slug`) so the `-t` filters in Tasks 3 + 4 select the right subset.

**Files:**

- Create: `apps/api/test/garage/garage-route-progress-stats.test.ts`

- [ ] **Step 1: Write the full test file**

```ts
// apps/api/test/garage/garage-route-progress-stats.test.ts
import { prisma } from '@ccc/db';
import { garagePublicResponseSchema } from '@ccc/shared/garage-public';
import { garageReadSchema } from '@ccc/shared/garage';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const setGamificationEnabled = async (enabled: boolean) => {
  await prisma.generalSettings.upsert({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    update: { gamificationEnabled: enabled },
    create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: enabled },
  });
};

describe('garage routes — progress + stats payload (chunk 28)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  const getOwner = async (userId: string) => {
    const env = loadEnv();
    return app.inject({
      method: 'GET',
      url: '/me/garage',
      headers: { authorization: bearer(env, userId) },
    });
  };

  // Seed helpers for the public hide-on-empty "any metric reveals both
  // blocks" cases. Mirror apps/api/test/feed/crud.test.ts shape: published
  // event with type + capacity, feedAccess public so we do not need a ticket.
  const seedUsedTicket = async (userId: string) => {
    const event = await prisma.event.create({
      data: {
        slug: `evt-${userId.slice(0, 6)}`,
        title: 'Evt',
        type: 'meet',
        status: 'published',
        capacity: 50,
        feedAccess: 'public',
        startsAt: new Date(Date.now() - 2 * 3600_000),
        endsAt: new Date(Date.now() + 2 * 3600_000),
        organizerId: userId,
      },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'Geral', priceCents: 0, capacity: 50 },
    });
    await prisma.ticket.create({
      data: { eventId: event.id, tierId: tier.id, userId, status: 'used', usedAt: new Date() },
    });
  };

  const seedVisiblePost = (userId: string) =>
    prisma.feedPost.create({
      data: { authorUserId: userId, body: 'visible', status: 'published' },
    });

  describe('GET /me/garage', () => {
    it('owner: returns progress + stats when killswitch is on', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      const res = await getOwner(user.id);
      const body = garageReadSchema.parse(res.json());

      // Fresh garage but owner ALWAYS renders both when killswitch is on.
      expect(body.gamification.enabled).toBe(true);
      expect(body.progress).toEqual({
        xp: 0,
        rank: 'Iniciante',
        nextRank: 'Pilotador',
        xpToNextRank: 100,
        tierSpan: 100,
      });
      expect(body.stats).toMatchObject({ events: 0, posts: 0, likesReceived: 0 });
      expect(typeof body.stats!.joinedAt).toBe('string');
    });

    it('owner: omits progress + stats when killswitch is off', async () => {
      await setGamificationEnabled(false);
      const { user } = await createUser({ verified: true });
      const res = await getOwner(user.id);
      const body = garageReadSchema.parse(res.json());
      expect(body.gamification.enabled).toBe(false);
      expect(body.progress).toBeUndefined();
      expect(body.stats).toBeUndefined();
    });
  });

  describe('GET /g/:slug', () => {
    const publishGarage = (userId: string, slug: string, extra: Record<string, unknown> = {}) =>
      prisma.garage.update({
        where: { userId },
        data: { slug, isPublic: true, ...extra },
      });

    it('public: omits progress + stats when all metrics are zero (hide-on-empty)', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'empty-public');
      const res = await app.inject({ method: 'GET', url: '/g/empty-public' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.gamification.enabled).toBe(true);
      expect(body.progress).toBeUndefined();
      expect(body.stats).toBeUndefined();
    });

    it('public: returns progress + stats when xp > 0', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'has-xp', { xp: 42 });
      const res = await app.inject({ method: 'GET', url: '/g/has-xp' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.gamification.enabled).toBe(true);
      expect(body.progress!.xp).toBe(42);
      expect(body.progress!.rank).toBe('Iniciante');
      expect(body.stats!.events).toBe(0);
      expect(body.stats!.posts).toBe(0);
      expect(body.stats!.likesReceived).toBe(0);
    });

    it('public: returns progress + stats when likesReceived > 0', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'has-likes', { likesReceived: 3 });
      const res = await app.inject({ method: 'GET', url: '/g/has-likes' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.progress).toBeDefined();
      expect(body.stats!.likesReceived).toBe(3);
    });

    it('public: returns progress + stats when events > 0', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'has-events');
      await seedUsedTicket(user.id);
      const res = await app.inject({ method: 'GET', url: '/g/has-events' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.progress!.xp).toBe(0);
      expect(body.stats!.events).toBe(1);
      expect(body.stats!.posts).toBe(0);
      expect(body.stats!.likesReceived).toBe(0);
    });

    it('public: returns progress + stats when posts > 0', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'has-posts');
      await seedVisiblePost(user.id);
      const res = await app.inject({ method: 'GET', url: '/g/has-posts' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.progress).toBeDefined();
      expect(body.stats!.events).toBe(0);
      expect(body.stats!.posts).toBe(1);
      expect(body.stats!.likesReceived).toBe(0);
    });

    it('public: omits progress + stats when killswitch is off (overrides hide-on-empty)', async () => {
      await setGamificationEnabled(false);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'killed', { xp: 42 });
      const res = await app.inject({ method: 'GET', url: '/g/killed' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.gamification.enabled).toBe(false);
      expect(body.progress).toBeUndefined();
      expect(body.stats).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run and confirm 8 tests FAIL**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/garage-route-progress-stats.test.ts`
Expected: 8 failures — `progress`/`stats` are `undefined` even when expected, and `garageReadSchema.parse` / `garagePublicResponseSchema.parse` reject because the current responses don't carry the top-level `gamification` flag (per canon §1, this chunk is the one that introduces it). This validates the tests have grip.

- [ ] **Step 3: Commit (failing tests only)**

```bash
git add apps/api/test/garage/garage-route-progress-stats.test.ts
git commit -m "test(garage): failing tests for progress+stats payload (chunk 28)"
```

---

## Task 3 — Wire the owner route (§"Killswitch" + §C5)

Extend `loadOwnerView` to read `progress` + `stats` in parallel and return them at the response top level. Always include `gamification: { enabled }`.

**Files:**

- Modify: `apps/api/src/routes/garage.ts:90-126` (`loadOwnerView` function)

- [ ] **Step 1: Add imports for the two service functions**

In `apps/api/src/routes/garage.ts`, add to the existing imports block:

```ts
import { getGarageProgress } from '../services/garage/progress.js';
import { getGarageStats } from '../services/garage/stats.js';
```

(Place these alphabetically among the other `../services/garage/*` imports, around lines 20-30.)

- [ ] **Step 2: Rewrite `loadOwnerView` to wire progress + stats**

Replace the body of `loadOwnerView` (current lines 90-126) with:

Existing reads (`prisma.car.findMany`, `prisma.garageSpot.findMany`) stay unchanged — add the two new awaited entries to the same `Promise.all`, and the three new keys to the final `garageReadSchema.parse({...})` object. Resulting shape:

```ts
const loadOwnerView = async (userId: string, uploads: Uploads) => {
  const garage = await ensureGarageForUser(userId);
  const reconciled = await reconcileGarageSpots(userId);
  const gamificationEnabled = await readGamificationEnabled();

  const [cars, spots, badgesState, progress, stats] = await Promise.all([
    ,
    ,
    /* prisma.car.findMany — UNCHANGED */ /* prisma.garageSpot.findMany — UNCHANGED */ gamificationEnabled
      ? readOwnerBadgesState(garage)
      : Promise.resolve(null),
    gamificationEnabled ? getGarageProgress(prisma, garage.id) : Promise.resolve(null),
    gamificationEnabled ? getGarageStats(prisma, garage.id) : Promise.resolve(null),
  ]);

  const availableSlots = spots.filter((s) => s.carId === null).length;
  const ownerBadges = badgesState?.badges ?? [];

  return garageReadSchema.parse({
    garage: serializeGarageOwner(garage, uploads, { gamificationEnabled, badges: ownerBadges }),
    cars: cars.map((c) => serializeCar(c, uploads)),
    spots: spots.map(serializeSpot),
    availableSlots,
    freeLimit: reconciled.freeLimit,
    isUnlimited: reconciled.isUnlimited,
    gamification: { enabled: gamificationEnabled },
    // Omit (not null) — §C10 uses `.optional()`, not `.nullable()`.
    ...(progress ? { progress } : {}),
    ...(stats ? { stats } : {}),
  });
};
```

**Notes:** single `Promise.all` keeps reads parallel. Killswitch read once (§C5). Conditional spread omits when null; `.optional()` (§C10) accepts absence. `gamification: { enabled }` always top-level (canon §1).

- [ ] **Step 3: Run owner-side tests; confirm they pass**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/garage-route-progress-stats.test.ts -t "GET /me/garage"`
Expected: 2 tests PASS (owner with killswitch on, owner with killswitch off). The `-t` filter matches the inner `describe('GET /me/garage', ...)` block.

- [ ] **Step 4: Run the existing `me-garage.test.ts` to confirm no regression**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/me-garage.test.ts`
Expected: existing tests still PASS (they only assert fields that didn't change).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/garage.ts
git commit -m "feat(api): wire progress+stats into GET /me/garage (chunk 28)"
```

---

## Task 4 — Wire the public route + hide-on-empty rule (§"Locked invariants" #2)

Extend `GET /g/:slug` to read `progress` + `stats` and apply the hide-on-empty rule. The 404 path stays untouched.

**Files:**

- Modify: `apps/api/src/routes/garage.ts:487-533` (the public `/g/:slug` handler)

- [ ] **Step 1: Rewrite the public handler**

Replace the public route's handler body (currently inside the `scoped.get<{ Params: { slug: string } }>('/g/:slug', async (request, reply) => { ... })` registration, lines 487-533) with:

```ts
scoped.get<{ Params: { slug: string } }>('/g/:slug', async (request, reply) => {
  const { slug } = request.params;
  const garage = await prisma.garage.findUnique({ where: { slug } });
  if (!garage || !garage.isPublic) {
    return reply.status(404).send({ error: 'NotFound' });
  }

  const gamificationEnabled = await readGamificationEnabled();
  const [cars, publicBadges, progress, stats] = await Promise.all([
    prisma.car.findMany({
      where: { userId: garage.userId },
      include: { photos: true },
      orderBy: { createdAt: 'desc' },
    }),
    gamificationEnabled ? readPublicBadges(garage) : Promise.resolve([]),
    gamificationEnabled ? getGarageProgress(prisma, garage.id) : Promise.resolve(null),
    gamificationEnabled ? getGarageStats(prisma, garage.id) : Promise.resolve(null),
  ]);

  // Hide-on-empty per "Locked invariants" #2: public-only; owner always renders.
  const allZero =
    !!progress &&
    !!stats &&
    progress.xp === 0 &&
    stats.events === 0 &&
    stats.posts === 0 &&
    stats.likesReceived === 0;
  const includeProgressStats = gamificationEnabled && !allZero;

  // Cars-mapping block (photos + projection) unchanged from current impl —
  // copy it verbatim from the existing handler. Only the final response
  // object below gains `gamification` + the conditional `progress`/`stats`.
  return garagePublicResponseSchema.parse({
    garage: serializeGaragePublic(garage, app.uploads, {
      gamificationEnabled,
      badges: publicBadges,
    }),
    cars: cars.map((c) => /* UNCHANGED — keep existing photo sort + projection */),
    gamification: { enabled: gamificationEnabled },
    ...(includeProgressStats && progress ? { progress } : {}),
    ...(includeProgressStats && stats ? { stats } : {}),
  });
});
```

**Notes:** 404 branch unchanged → §C9 stays green. 4 reads parallel; killswitch gates 3. Hide-on-empty checked **after** the parallel fetch against resolved values. `gamification: { enabled }` always top-level (canon §1).

- [ ] **Step 2: Run public-side tests; confirm they pass**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/garage-route-progress-stats.test.ts -t "GET /g/:slug"`
Expected: 6 tests PASS (hide-on-empty, xp>0, likesReceived>0, events>0, posts>0, killswitch-off overrides). The `-t` filter matches the inner `describe('GET /g/:slug', ...)` block.

- [ ] **Step 3: Run the §C9 byte-parity test again to confirm 404 is still identical**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/garage-public-404-byte-parity.test.ts`
Expected: PASS. If this fails, the public handler accidentally introduced a divergence between the unknown-slug and private-garage paths — revert step 1 and re-do, ensuring the 404 branch returns before any new code runs.

- [ ] **Step 4: Run the existing `public-garage.test.ts` to confirm no regression**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/public-garage.test.ts`
Expected: all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/garage.ts
git commit -m "feat(api): wire progress+stats into GET /g/:slug with hide-on-empty (chunk 28)"
```

---

## Task 5 — DSR export + anonymize for XP surface (canon §14)

Extend the existing DSR export route + anonymize service so the new XP surface (`Garage.xp`, `Garage.likesReceived`, `XpEvent` rows) is covered by §"LGPD posture" + Phase 2 invariant #7. Tests first, then implementation.

**Files:**

- Create: `apps/api/test/garage/xp-dsr.test.ts`
- Modify: `apps/api/src/services/data-export.ts` (extend the garage `select` + bundle)
- Modify: `apps/api/src/services/account-deletion/anonymize.ts` (extend the existing tx)

- [ ] **Step 1: Write failing DSR tests**

```ts
// apps/api/test/garage/xp-dsr.test.ts
import { prisma } from '@ccc/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { anonymizeUser } from '../../src/services/account-deletion/anonymize.js';
import { _collectUserDataForTest } from '../../src/services/data-export.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const garageOf = async (userId: string) => prisma.garage.findUniqueOrThrow({ where: { userId } });

describe('DSR — XP surface coverage (chunk 28, canon §14)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('export: includes Garage.xp, Garage.likesReceived, and the user XpEvent rows', async () => {
    const { user } = await createUser({ email: 'dsr-xp@jdm.test', verified: true });
    const g = await garageOf(user.id);
    await prisma.garage.update({ where: { id: g.id }, data: { xp: 42, likesReceived: 3 } });
    await prisma.xpEvent.createMany({
      data: [
        { garageId: g.id, delta: 10, reason: 'post_create', sourceRef: 'post:abc' },
        { garageId: g.id, delta: 25, reason: 'badge_award', sourceRef: 'badge:COM-001' },
      ],
    });

    const bundle = await _collectUserDataForTest(user.id);
    const [garage] = bundle.data.garage as Array<Record<string, unknown>>;
    expect(garage.xp).toBe(42);
    expect(garage.likesReceived).toBe(3);

    const xpEvents = bundle.data.xpEvents as Array<Record<string, unknown>>;
    expect(xpEvents).toHaveLength(2);
    expect(xpEvents.map((e) => e.reason).sort()).toEqual(['badge_award', 'post_create']);
    expect(bundle.manifest.entities.map((e) => e.entity)).toContain('xpEvents');
  });

  it('anonymize: resets Garage.xp + likesReceived to 0 and deletes user XpEvent rows', async () => {
    const { user } = await createUser({ email: 'dsr-anon-xp@jdm.test', verified: true });
    const g = await garageOf(user.id);
    await prisma.garage.update({ where: { id: g.id }, data: { xp: 42, likesReceived: 3 } });
    await prisma.xpEvent.create({
      data: { garageId: g.id, delta: 10, reason: 'post_create', sourceRef: 'post:abc' },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date(Date.now() - 31 * 24 * 3600_000) },
    });
    await prisma.deletionLog.create({ data: { userId: user.id, requestedAt: new Date() } });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);
    const scrubbed = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    expect(scrubbed.xp).toBe(0);
    expect(scrubbed.likesReceived).toBe(0);
    expect(await prisma.xpEvent.count({ where: { garageId: g.id } })).toBe(0);
  });

  it('anonymize: cleans XP surface even when the gamification killswitch is off', async () => {
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
      update: { gamificationEnabled: false },
    });
    const { user } = await createUser({ email: 'dsr-kill@jdm.test', verified: true });
    const g = await garageOf(user.id);
    await prisma.garage.update({ where: { id: g.id }, data: { xp: 7, likesReceived: 2 } });
    await prisma.xpEvent.create({
      data: { garageId: g.id, delta: 7, reason: 'post_create', sourceRef: 'post:xyz' },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt: new Date(Date.now() - 31 * 24 * 3600_000) },
    });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);
    const scrubbed = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    expect(scrubbed.xp).toBe(0);
    expect(scrubbed.likesReceived).toBe(0);
    expect(await prisma.xpEvent.count({ where: { garageId: g.id } })).toBe(0);
  });
});
```

Run: `pnpm --filter @ccc/api exec vitest run test/garage/xp-dsr.test.ts`
Expected: 3 failures — export omits `xpEvents` + the counters; anonymize leaves both untouched.

- [ ] **Step 2: Extend `data-export.ts`**

In `apps/api/src/services/data-export.ts`:

1. Add `xp: true` + `likesReceived: true` to the existing `prisma.garage.findUnique({ ..., select: { ... } })` block (~line 79-91).
2. Add a parallel `prisma.xpEvent.findMany` read inside the same `Promise.all` and destructure it as `xpEvents`:

```ts
prisma.xpEvent.findMany({
  where: { garage: { userId } },
  select: { delta: true, reason: true, sourceRef: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
}),
```

3. Add `xpEvents` to the `data` record alongside `garageBadges`. The manifest `entities` mapping is automatic via `Object.entries(data)`.

- [ ] **Step 3: Extend `anonymize.ts`**

In `apps/api/src/services/account-deletion/anonymize.ts`, inside the existing `prisma.$transaction(async (tx) => { ... })` block, inside the `if (existingGarage)` branch, BEFORE the existing `tx.garage.update`:

```ts
// Canon §14: XP surface cleanup. Delete XpEvent rows BEFORE resetting the
// counters so the deletion is observable against the original garageId.
// Killswitch-INDEPENDENT — anonymization MUST clean up regardless.
await tx.xpEvent.deleteMany({ where: { garageId: existingGarage.id } });
```

Extend the existing `tx.garage.update` data block to also set `xp: 0` + `likesReceived: 0` alongside the existing scrub fields. Append two step entries after the existing `'anonymize_garage'` / `'delete_garage_badges'` pushes:

```ts
steps.push({ step: 'delete_xp_events', status: 'ok', at: new Date().toISOString() });
steps.push({ step: 'reset_xp_counters', status: 'ok', at: new Date().toISOString() });
```

- [ ] **Step 4: Run DSR tests; confirm 3 PASS**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/xp-dsr.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Run the existing DSR neighborhood to confirm no regression**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/data-export-garage.test.ts test/garage/anonymize-garage.test.ts test/garage/badges-dsr.test.ts test/me-data-export.test.ts`
Expected: all existing tests PASS (we only ADDED entities + reset fields; nothing existing changes shape).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/data-export.ts \
        apps/api/src/services/account-deletion/anonymize.ts \
        apps/api/test/garage/xp-dsr.test.ts
git commit -m "feat(api): DSR export + anonymize cover XP surface (chunk 28, canon §14)"
```

---

## Task 6 — Full verification sweep

- [ ] **Step 1: Build @ccc/shared (memory rule — rebuild after schema changes)**

Run: `pnpm --filter @ccc/shared build` — clean build.

- [ ] **Step 2: Typecheck the API package**

Run: `pnpm --filter @ccc/api typecheck` — 0 errors. If TS fails, most likely the response object shape doesn't match `garageReadSchema.parse` / `garagePublicResponseSchema.parse` — re-check the optional-spread in Task 3/4.

- [ ] **Step 3: Run all three new test files**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/garage-route-progress-stats.test.ts test/garage/garage-public-404-byte-parity.test.ts test/garage/xp-dsr.test.ts`
Expected: 8 + 1 + 3 = 12 PASS.

- [ ] **Step 4: Run the touched neighborhood of existing tests**

Run: `pnpm --filter @ccc/api exec vitest run test/garage/me-garage.test.ts test/garage/public-garage.test.ts test/garage/data-export-garage.test.ts test/garage/anonymize-garage.test.ts test/garage/badges-dsr.test.ts test/me-data-export.test.ts`
Expected: all existing tests PASS.

> **Do NOT** run the full test suite locally (memory rule "Never run full test suite locally"). CI on the PR covers the full sweep.

- [ ] **Step 5: No additional commit** — code is unchanged from Tasks 3 + 4 + 5; just verifying.

---

## Task 7 — Open PR to `main`

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/jdma-garage-phase2-28
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --title "feat(api): wire progress+stats payloads + 404 parity + DSR (chunk 28)" --body "$(cat <<'EOF'
## Summary

- Wires `progress` (chunk 26) and `stats` (chunk 25) into `GET /me/garage` and `GET /g/:slug`. Adds response-top-level `gamification: { enabled }` capability flag (canon §1).
- Owner: always renders both when killswitch on; omits both when off.
- Public: applies "Locked invariants" #2 hide-on-empty against all four metrics (xp + events + posts + likesReceived all zero → omit). Killswitch off overrides and omits regardless.
- Killswitch read sync per request (§C5).
- 404 on `/g/:slug` byte-identical between unknown-slug and private-garage (§C9 regression test added).
- DSR (canon §14): export carries `Garage.xp`, `Garage.likesReceived`, and the user's `XpEvent` rows. Anonymize resets both counters to 0 and deletes XpEvent rows inside the existing anonymize tx (killswitch-independent).

## Test plan

- [ ] `pnpm --filter @ccc/api exec vitest run test/garage/garage-route-progress-stats.test.ts` (8 pass)
- [ ] `pnpm --filter @ccc/api exec vitest run test/garage/garage-public-404-byte-parity.test.ts` (1 pass)
- [ ] `pnpm --filter @ccc/api exec vitest run test/garage/xp-dsr.test.ts` (3 pass)
- [ ] `pnpm --filter @ccc/api exec vitest run test/garage/me-garage.test.ts test/garage/public-garage.test.ts test/garage/data-export-garage.test.ts test/garage/anonymize-garage.test.ts test/garage/badges-dsr.test.ts test/me-data-export.test.ts` (no regression)
- [ ] `pnpm --filter @ccc/api typecheck` clean
- [ ] `pnpm --filter @ccc/shared build` clean
- [ ] CI green

## Corrections applied

Canon §1 (top-level `gamification`); canon §3 (service `(prisma, garageId)` signature); §C5 sync killswitch read; §C9 404 byte parity test; §C10 optional schemas consumed; canon §14 (DSR export + anonymize cover XP surface).

## Deviations

Serializer signatures unchanged — chunk 24 placed `progress` + `stats` at response top level, not under `garageOwnerSchema` / `garagePublicProfileSchema` (canon §1).

## Out of scope

Awarder hooks (chunks 29-35); UI (Phase 2C); admin endpoint extension (deferred per outline §378).
EOF
)"
```

- [ ] **Step 3: Return the PR URL** so reviewers can pick it up.

---

## Corrections that apply

- **Canon §1** — `gamification: { enabled }` lives at the **response top level**, never nested under `garage`. Chunk 28 is the canonical placement; chunk 24 was/will be aligned to ship the schema accordingly. Tests assert `body.gamification.enabled` directly after `garageReadSchema.parse` / `garagePublicResponseSchema.parse`.
- **Canon §3** — service signatures `(prisma, garageId)`. Both route handlers call `getGarageProgress(prisma, garage.id)` + `getGarageStats(prisma, garage.id)` — prisma FIRST.
- **Canon §14** — DSR coverage. Task 5 extends `data-export.ts` to include `Garage.xp`, `Garage.likesReceived`, and the user's `XpEvent` rows; extends `anonymize.ts` to reset both counters to 0 and `prisma.xpEvent.deleteMany` inside the existing anonymize tx. Killswitch-independent (anonymization MUST clean up even when gamification is off).
- **§C5** sync killswitch read — `await readGamificationEnabled()` once per handler call, no TTL cache.
- **§C9** byte-identical 404 — Task 1 regression test; Task 4 step 3 re-runs after wiring.
- **§C10** optional schemas — `...(progress ? { progress } : {})` relies on chunk 24's `.optional()` shape.
- **"Locked invariants" #2** hide-on-empty — public-only; owner always renders when killswitch on. All four metrics (`xp`, `events`, `posts`, `likesReceived`) covered by Task 2 reveal tests.
- **§"Killswitch"** — both routes omit progress+stats and report `gamification: { enabled: false }` when off.
- **§"API surface"** — defines `GarageProgress` + `GarageStats` consumed here.

---

## Deviations from skeleton

1. **`apps/api/src/services/garage/index.ts` NOT touched.** Skeleton listed it for serializer extension. Chunk 24 placed `progress` + `stats` at the **response** top level (`garageReadSchema` / `garagePublicResponseSchema`) per canon §1, not nested under `garageOwnerSchema` / `garagePublicProfileSchema`. Serializers unchanged; route handler assembles the final object. Matches outline §"API surface" lines 374-378.
2. **Three test files instead of one.** Skeleton suggested "extend or new file" for `garage-route.test.ts`, which doesn't exist on `main`. We split into `garage-route-progress-stats.test.ts` (payload behavior, with inner `describe('GET /me/garage')` + `describe('GET /g/:slug')` so `-t` filters work), `garage-public-404-byte-parity.test.ts` (§C9 regression), and `xp-dsr.test.ts` (canon §14 DSR coverage) — keeps each concern in its own durable home.
3. **DSR scope added to chunk 28.** Skeleton did not list DSR explicitly; canon §14 routes the export + anonymize coverage through this chunk so the XP surface is LGPD-compliant from day one. Touches `apps/api/src/services/data-export.ts` + `apps/api/src/services/account-deletion/anonymize.ts` in addition to the original three files.

---

## Self-review

**Spec coverage:** skeleton §"Chunk 28" bullets → Task 2 tests + Task 3/4 impl. §C9 → Task 1 + Task 4 step 3 re-run. §C10 → Pre-flight 3. §C5 → `await readGamificationEnabled()` per request (no caching). Canon §1 → top-level `gamification` in tests + impl. Canon §3 → `(prisma, garage.id)` call sites. Canon §14 → Task 5 DSR.

**Type consistency:** `getGarageProgress` / `getGarageStats` / `readGamificationEnabled` consistent with `(prisma, garageId)` signature. Return types match chunk 24's `.optional()`.

**Out of scope:** awarder write-path hooks (29-35); UI (Phase 2C); admin endpoint extension (deferred §378); killswitch internals (Phase 1); no caching on `readGamificationEnabled` (§C5 forbids).
