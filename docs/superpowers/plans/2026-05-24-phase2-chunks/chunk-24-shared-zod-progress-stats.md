# Chunk 24 — Shared zod (`garageProgressSchema` + `garageStatsSchema`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `packages/shared/src/garage-progress.ts` (two zod schemas + inferred types) and wire a `./garage-progress` subpath export. Extend the owner + public envelope schemas (`garageReadSchema`, `garagePublicResponseSchema`) with optional `progress` + `stats` blocks AND response-level `gamification` + `badges` per §C10. No runtime / route code touched — pure shared zod.

**Architecture:** Pure-zod. Schemas are server-authoritative shapes the API serializer fills; clients (mobile, admin SSR) consume the inferred types. Killswitch policy (§C10): both `progress` + `stats` are `.optional()` on owner AND public envelopes so a `gamification.enabled: false` payload (with both fields absent) still validates. Per Phase 2 fix canon §1, `gamification` lives at response **top-level** (`body.gamification.enabled`), not nested under `garage`. Consumers (chunk 28 routes, chunk 40 mobile viewmodel, chunk 41 SSR) read `data.gamification.enabled`. Per Phase 2 fix canon §C10 + MAJOR finding, public `badges` also lives at response top-level.

**Tech Stack:** TypeScript, zod 3.23.x, vitest 3.x, tsc 5.7.x. No DB / Postgres / network. No app-level wiring (chunks 25/26/28 do that).

**Spec anchors:**

- `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 24".
- `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` §C10, §C12, §"API surface" (≈ line 370–404), §"Killswitch" (≈ line 502–515).
- `/tmp/phase2-fix-canon.md` §1 (gamification top-level), §2 (progress/stats optional), §C10 review-MAJOR (response-level badges).
- `CLAUDE.md` §"Branch safety preflight" + §"Git flow" (PR → `main`).
- User memory: "Rebuild @ccc/shared after schema changes" — runtime resolves `dist/`; stale build masks zod break.

---

## Pre-flight (mandatory)

- [ ] **0.1:** `git branch --show-current` → must NOT be `production`. If it is: STOP, switch to `main`.
- [ ] **0.2:** `git checkout main && git pull --ff-only origin main`
- [ ] **0.3:** `git checkout -b feat/jdma-garage-phase2-24`
- [ ] **0.4:** Re-verify anchors haven't drifted: `garageGamificationCapabilitySchema` (garage.ts ≈ L54), `garageReadSchema` (garage.ts ≈ L95), `garagePublicResponseSchema` (garage-public.ts ≈ L40), `garageBadgeOwnerStateSchema` (badges.ts), `garageBadgePublicSchema` (badges.ts), `"./badges-copy"` entry in package.json. If anything moved, adjust line refs below before editing.

---

## File map

| Path                                                    | Action     | Responsibility                                                                                          |
| ------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/garage-progress.ts`                | **create** | Both schemas + inferred types. Pure module, no side effects.                                            |
| `packages/shared/src/__tests__/garage-progress.test.ts` | **create** | Schema accept/reject cases.                                                                             |
| `packages/shared/src/garage.ts`                         | **modify** | Import the two schemas; extend `garageReadSchema` with `progress?`, `stats?`, top-level `gamification`. |
| `packages/shared/src/garage-public.ts`                  | **modify** | Same on `garagePublicResponseSchema`, plus top-level `badges`.                                          |
| `packages/shared/package.json`                          | **modify** | Add `"./garage-progress"` subpath entry under `exports` (§C12 shape).                                   |
| `packages/shared/src/__tests__/garage.test.ts`          | **modify** | Envelope-extension cases for both owner + public.                                                       |

Not touched: `apps/**`, `packages/db/**`, `packages/ui/**`, the barrel `src/index.ts` (subpath-only, matches the `garage-covers` precedent).

---

## Corrections that apply

This plan implements the following authoritative corrections from the Phase 2 outline + fix canon:

- **§C10** — both `progress` + `stats` `.optional()` on owner + public envelopes so the killswitch-off branch validates. (Fix canon §2.)
- **§C10 + fix canon §1** — `gamification: { enabled: boolean }` at response **top-level** on both envelopes. Route layer reads `body.gamification.enabled`. The pre-existing Phase 1 nested `garage.gamification` from chunk 16 stays in place (chunk 24 does not remove it — coordinated cleanup is owned by downstream chunks 28/40/41 which adopt the top-level read).
- **§C10 + Phase 2 plan review (MAJOR)** — `badges` at response top-level on the public envelope (so SSR + mobile can read `body.badges` directly without descending into `body.garage`).
- **§C12** — `./garage-progress` subpath export uses the canonical `{ "types": "./dist/garage-progress.d.ts", "import": "./dist/garage-progress.js" }` shape.

---

## Deviations from the outline

**Deviation 1 — top-level `gamification` is additive, not replacement.** Phase 1 chunk 16 already placed `gamification: garageGamificationCapabilitySchema` **nested inside** `garageOwnerSchema` (≈ line 87) and `garagePublicProfileSchema` (≈ line 35). Per fix canon §1, the canonical read is response-level `body.gamification.enabled`. This chunk adds the top-level field on both response envelopes; it does NOT remove the Phase 1 nested field (removing it would break every Phase 1 consumer reading `garage.gamification.enabled` and exceed chunk 24's "pure shared zod" scope). Downstream chunks (28 route handlers, 40 mobile, 41 SSR) read the top-level field per canon; a follow-up clean-up chunk can remove the nested duplicate once all consumers migrate.

**Deviation 2 — owner-side `badges` stays nested.** Phase 2 review-MAJOR specifically calls out **public** envelope `badges` per §C10. The skeleton + outline §C10 describe public badges. Owner-side badges (`garageBadgeOwnerStateSchema`) remain nested in `garageOwnerSchema` (Phase 1 carry-over); this chunk does not duplicate them at the owner envelope top-level. Public envelope DOES get top-level `badges` per the MAJOR finding.

**Deviation 3 — `joinedAt` source.** Outline §28 says "GarageStats includes `joinedAt`". Schema carries the ISO string; chunk 25's serializer sources it from `Garage.createdAt`. Service-layer decision, schema is shape-only.

All three are re-stated in the PR body.

---

## Task 1: Create `garage-progress.ts` + standalone test

**Files:** create `packages/shared/src/garage-progress.ts`, `packages/shared/src/__tests__/garage-progress.test.ts`.

- [ ] **Step 1.1: Write the failing test first**

Create `packages/shared/src/__tests__/garage-progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  garageProgressSchema,
  garageStatsSchema,
  type GarageProgress,
  type GarageStats,
} from '../garage-progress.js';

const validProgress: GarageProgress = {
  xp: 1234,
  rank: 'Veterano',
  nextRank: 'Lendário',
  xpInTier: 234,
  xpToNextRank: 3766,
  tierSpan: 4000,
};

const validStats: GarageStats = {
  events: 12,
  posts: 4,
  likesReceived: 88,
  joinedAt: '2026-02-15T08:00:00.000Z',
};

describe('garageProgressSchema', () => {
  it('accepts canonical mid-tier shape', () => {
    expect(garageProgressSchema.parse(validProgress)).toEqual(validProgress);
  });

  it('accepts top-tier sentinel (nextRank=null, xpToNextRank=0, tierSpan=1)', () => {
    const top: GarageProgress = {
      xp: 50_000,
      rank: 'Hall of Fame',
      nextRank: null,
      xpInTier: 45_000,
      xpToNextRank: 0,
      tierSpan: 1,
    };
    expect(garageProgressSchema.parse(top)).toEqual(top);
  });

  it('accepts xp = 0 (fresh garage)', () => {
    expect(
      garageProgressSchema.parse({
        xp: 0,
        rank: 'Iniciante',
        nextRank: 'Aprendiz',
        xpInTier: 0,
        xpToNextRank: 100,
        tierSpan: 100,
      }),
    ).toBeTruthy();
  });

  it.each([
    ['xp', -1],
    ['xpInTier', -1],
    ['xpToNextRank', -1],
    ['tierSpan', 0],
    ['xp', 1.5],
    ['rank', ''],
    ['rank', 42],
    ['nextRank', ''],
  ] as const)('rejects bad %s = %p', (key, value) => {
    expect(() => garageProgressSchema.parse({ ...validProgress, [key]: value })).toThrow();
  });

  it('rejects missing required field', () => {
    const { xpInTier: _drop, ...partial } = validProgress;
    expect(() => garageProgressSchema.parse(partial)).toThrow();
  });
});

describe('garageStatsSchema', () => {
  it('accepts canonical shape', () => {
    expect(garageStatsSchema.parse(validStats)).toEqual(validStats);
  });

  it('accepts zero-default fresh garage', () => {
    expect(
      garageStatsSchema.parse({
        events: 0,
        posts: 0,
        likesReceived: 0,
        joinedAt: '2026-05-01T00:00:00.000Z',
      }),
    ).toBeTruthy();
  });

  it.each([
    ['events', -1],
    ['posts', -1],
    ['likesReceived', -1],
    ['events', 2.5],
    ['joinedAt', '2026-02-15'],
  ] as const)('rejects bad %s = %p', (key, value) => {
    expect(() => garageStatsSchema.parse({ ...validStats, [key]: value })).toThrow();
  });

  it('rejects missing joinedAt', () => {
    const { joinedAt: _drop, ...partial } = validStats;
    expect(() => garageStatsSchema.parse(partial)).toThrow();
  });
});
```

- [ ] **Step 1.2: Run — must FAIL** with `Cannot find module '../garage-progress.js'`:

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/garage-progress.test.ts
```

- [ ] **Step 1.3: Create `packages/shared/src/garage-progress.ts`:**

```ts
import { z } from 'zod';

// GarageProgress — server-authoritative rank-derivation payload block.
//
// Shape: outline §"API surface" lines 380-391. Rank-label derivation
// (RANK_TIERS + deriveProgress) lives in apps/api/src/services/garage/
// progress.ts — server-only, intentionally NOT exported via shared so the
// label catalog stays trivially mutable without forcing a client redeploy.
// This schema carries only the wire payload; `rank` + `nextRank` are
// validated as opaque non-empty strings.
//
// Top-tier sentinel per §C14: nextRank=null, xpToNextRank=0, tierSpan=1
// (avoids division-by-zero in the UI progress bar).
export const garageProgressSchema = z.object({
  xp: z.number().int().nonnegative(),
  rank: z.string().min(1),
  nextRank: z.string().min(1).nullable(),
  xpInTier: z.number().int().nonnegative(),
  xpToNextRank: z.number().int().nonnegative(),
  tierSpan: z.number().int().min(1),
});
export type GarageProgress = z.infer<typeof garageProgressSchema>;

// GarageStats — the 4-tile profile stats block (events / posts / likes /
// joined). Shape: outline §"API surface" lines 393-402. `likesReceived`
// MUST be read from the denormalized Garage.likesReceived column per §C4
// (the awarder maintains it in the same tx as the XP write); never an
// aggregate over FeedReaction. `joinedAt` is an ISO datetime — serializer
// (chunk 25) sources it from Garage.createdAt (Deviation 3). All counters
// are non-negative integers so a fresh garage with zero activity parses.
export const garageStatsSchema = z.object({
  events: z.number().int().nonnegative(),
  posts: z.number().int().nonnegative(),
  likesReceived: z.number().int().nonnegative(),
  joinedAt: z.string().datetime(),
});
export type GarageStats = z.infer<typeof garageStatsSchema>;
```

- [ ] **Step 1.4: Run — must PASS** (≈14 cases after `it.each` expansion):

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/garage-progress.test.ts
```

- [ ] **Step 1.5: Commit:**

```bash
git add packages/shared/src/garage-progress.ts packages/shared/src/__tests__/garage-progress.test.ts
git commit -m "feat(shared): add garageProgressSchema + garageStatsSchema (chunk 24)"
```

---

## Task 2: Wire the `./garage-progress` subpath export

§C12 — every shared module imported by subpath needs an explicit `exports` entry, otherwise runtime resolution fails. Use the §C12 canonical `dist`-pointing shape (not the source-pointing variant used by some legacy entries).

**Files:** modify `packages/shared/package.json` (the `exports` block, ≈ line 8-129).

- [ ] **Step 2.1: Insert the new subpath entry** adjacent to the existing `./garage-covers` entry. Find:

```json
    "./garage-covers": {
      "types": "./src/garage-covers.ts",
      "default": "./dist/garage-covers.js"
    },
    "./feed": {
```

Replace with:

```json
    "./garage-covers": {
      "types": "./src/garage-covers.ts",
      "default": "./dist/garage-covers.js"
    },
    "./garage-progress": {
      "types": "./dist/garage-progress.d.ts",
      "import": "./dist/garage-progress.js"
    },
    "./feed": {
```

Note: this uses §C12's canonical shape (`types: ./dist/.d.ts`, `import: ./dist/.js`) instead of the older source-pointing shape (`types: ./src/.ts`, `default: ./dist/.js`) used by neighboring entries. The new entry is correct per §C12; existing entries are not back-migrated in this chunk (out of scope). A `pnpm --filter @ccc/shared build` is required before any consumer can resolve the subpath because `types` now points at the emitted `.d.ts`.

- [ ] **Step 2.2: Verify JSON + rebuild + smoke** (CLAUDE.md memory rule — `dist/` MUST reflect new module):

```bash
node -e "JSON.parse(require('fs').readFileSync('packages/shared/package.json','utf8'))"
pnpm --filter @ccc/shared build
ls packages/shared/dist/garage-progress.{js,d.ts}
```

Both dist files must exist; `dist/garage-progress.d.ts` is now load-bearing for IDE jump-to-def + downstream typecheck.

- [ ] **Step 2.3: Commit:**

```bash
git add packages/shared/package.json
git commit -m "feat(shared): export ./garage-progress subpath (chunk 24)"
```

---

## Task 3: Extend `garageReadSchema` (owner envelope)

§C10 — both `progress` + `stats` blocks are `.optional()` so the killswitch-off branch (route omits both) still validates. The biconditional `gamification.enabled === true ⇔ progress + stats present` is enforced at the **route layer** (chunk 28), not the schema. Top-level `gamification: { enabled: boolean }` is added per fix canon §1.

**Files:** modify `packages/shared/src/garage.ts:1-103`, `packages/shared/src/__tests__/garage.test.ts`.

- [ ] **Step 3.1: Write the failing tests in `__tests__/garage.test.ts`**

The existing test file already constructs a full owner-garage literal — define a shared fixture once so the new cases stay terse. Inside `describe('garageReadSchema', ...)` (≈ line 132), at the top, add:

```ts
const baseOwnerGarage = {
  id: 'g_1',
  name: 'Garagem',
  slug: 'user-abc12345',
  description: null,
  isPublic: false,
  premiumTier: null,
  premiumUntil: null,
  isPremiumActive: false,
  coverPreset: null,
  coverImageObjectKey: null,
  coverImageUrl: null,
  daysLeftUntilExpiry: null,
  createdAt: '2026-05-20T12:00:00.000Z',
  updatedAt: '2026-05-20T12:00:00.000Z',
  gamification: { enabled: true as boolean },
  badges: [] as never[],
};
const baseRead = {
  garage: baseOwnerGarage,
  cars: [],
  spots: [],
  availableSlots: 1,
  freeLimit: 1,
  isUnlimited: false,
  gamification: { enabled: true as boolean },
};
const validProgress = {
  xp: 250,
  rank: 'Aprendiz',
  nextRank: 'Piloto',
  xpInTier: 150,
  xpToNextRank: 250,
  tierSpan: 400,
};
const validStats = {
  events: 3,
  posts: 1,
  likesReceived: 7,
  joinedAt: '2026-02-15T08:00:00.000Z',
};
```

Then append (still inside the same `describe`):

```ts
it('accepts owner read with top-level gamification + progress + stats present', () => {
  const parsed = garageReadSchema.parse({
    ...baseRead,
    progress: validProgress,
    stats: validStats,
  });
  expect(parsed.gamification.enabled).toBe(true);
  expect(parsed.progress?.rank).toBe('Aprendiz');
  expect(parsed.stats?.likesReceived).toBe(7);
});

it('accepts owner read with progress + stats omitted (killswitch off)', () => {
  const parsed = garageReadSchema.parse({
    ...baseRead,
    gamification: { enabled: false },
  });
  expect(parsed.gamification.enabled).toBe(false);
  expect(parsed.progress).toBeUndefined();
  expect(parsed.stats).toBeUndefined();
});

it('rejects owner read missing top-level gamification', () => {
  const { gamification: _drop, ...withoutGamification } = baseRead;
  expect(() => garageReadSchema.parse(withoutGamification)).toThrow();
});

it('rejects owner read whose progress has negative xp', () => {
  expect(() =>
    garageReadSchema.parse({
      ...baseRead,
      progress: { ...validProgress, xp: -1 },
    }),
  ).toThrow();
});

it('rejects owner read whose stats has bad joinedAt', () => {
  expect(() =>
    garageReadSchema.parse({
      ...baseRead,
      progress: validProgress,
      stats: { ...validStats, joinedAt: 'not-a-date' },
    }),
  ).toThrow();
});
```

- [ ] **Step 3.2: Run — must FAIL** (`parsed.progress?.rank` is `undefined` — zod drops unknown keys on loose `.object`, and top-level `gamification` not yet declared):

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/garage.test.ts -t "owner read"
```

- [ ] **Step 3.3: Extend `packages/shared/src/garage.ts`** — add import alongside existing imports:

```ts
import { garageProgressSchema, garageStatsSchema } from './garage-progress.js';
```

Replace `garageReadSchema` (≈ line 95-102) with:

```ts
export const garageReadSchema = z.object({
  garage: garageOwnerSchema,
  cars: z.array(carSchema),
  spots: z.array(garageSpotSchema),
  availableSlots: z.number().int().nonnegative(),
  freeLimit: z.number().int().nonnegative().nullable(),
  isUnlimited: z.boolean(),
  // Phase 2 (chunk 24, plan §C10 + fix canon §1). Top-level gamification
  // capability — canonical read path is `body.gamification.enabled`. The
  // Phase 1 nested `garage.gamification` stays for backward compat; chunks
  // 28/40 read this top-level field per fix canon §1.
  gamification: garageGamificationCapabilitySchema,
  // Both optional — the killswitch-off branch where the route omits BOTH
  // blocks must still validate. The route-layer invariant (biconditional
  // with gamification.enabled) is enforced in chunk 28, not here.
  progress: garageProgressSchema.optional(),
  stats: garageStatsSchema.optional(),
});
```

- [ ] **Step 3.4: Run — must PASS** (5 new + all existing):

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/garage.test.ts
```

- [ ] **Step 3.5: Commit:**

```bash
git add packages/shared/src/garage.ts packages/shared/src/__tests__/garage.test.ts
git commit -m "feat(shared): wire progress + stats + top-level gamification into garageReadSchema (chunk 24)"
```

---

## Task 4: Extend `garagePublicResponseSchema` (public envelope)

§C10 — same `.optional()` treatment on `progress` + `stats`. Public also honours the "hide-on-empty" rule (§Killswitch): even with `gamification.enabled === true`, route MAY omit when all metrics are zero. Schema accepts both presence + absence. Per fix canon §1 + the MAJOR finding on response-level `badges`, this chunk also adds top-level `gamification` + top-level `badges` to the public envelope.

**Files:** modify `packages/shared/src/garage-public.ts:1-45`, `packages/shared/src/__tests__/garage.test.ts`.

- [ ] **Step 4.1: Add `garagePublicResponseSchema` to the existing `../garage-public.js` import** at the top of `garage.test.ts`:

```ts
import {
  carPublicSchema,
  garagePublicProfileSchema,
  garagePublicResponseSchema,
} from '../garage-public.js';
```

- [ ] **Step 4.2: Append the failing tests at the bottom of `garage.test.ts`:**

```ts
describe('garagePublicResponseSchema (Phase 2 — progress + stats + top-level gamification/badges)', () => {
  const baseProfile = {
    name: 'Minha Garagem',
    slug: 'meu-slug',
    description: null,
    premiumTier: null,
    coverPreset: null,
    coverImageUrl: null,
    isPremiumActive: false,
    gamification: { enabled: true as boolean },
    badges: [] as never[],
  };
  const baseResponse = {
    garage: baseProfile,
    cars: [],
    gamification: { enabled: true as boolean },
    badges: [] as never[],
  };
  const validProgress = {
    xp: 500,
    rank: 'Piloto',
    nextRank: 'Veterano',
    xpInTier: 100,
    xpToNextRank: 400,
    tierSpan: 500,
  };
  const validStats = {
    events: 5,
    posts: 2,
    likesReceived: 10,
    joinedAt: '2026-02-15T08:00:00.000Z',
  };

  it('accepts public response with top-level gamification + progress + stats present', () => {
    const parsed = garagePublicResponseSchema.parse({
      ...baseResponse,
      progress: validProgress,
      stats: validStats,
    });
    expect(parsed.gamification.enabled).toBe(true);
    expect(parsed.progress?.rank).toBe('Piloto');
    expect(parsed.stats?.events).toBe(5);
  });

  it('accepts public response with progress + stats omitted (killswitch off OR hide-on-empty)', () => {
    const parsed = garagePublicResponseSchema.parse({
      ...baseResponse,
      gamification: { enabled: false },
    });
    expect(parsed.gamification.enabled).toBe(false);
    expect(parsed.progress).toBeUndefined();
    expect(parsed.stats).toBeUndefined();
  });

  it('accepts public response with empty top-level badges array', () => {
    const parsed = garagePublicResponseSchema.parse({
      ...baseResponse,
      badges: [],
    });
    expect(parsed.badges).toEqual([]);
  });

  it('rejects public response missing top-level gamification', () => {
    const { gamification: _drop, ...withoutGamification } = baseResponse;
    expect(() => garagePublicResponseSchema.parse(withoutGamification)).toThrow();
  });

  it('rejects public response missing top-level badges', () => {
    const { badges: _drop, ...withoutBadges } = baseResponse;
    expect(() => garagePublicResponseSchema.parse(withoutBadges)).toThrow();
  });

  it('rejects public response whose stats has bad joinedAt', () => {
    expect(() =>
      garagePublicResponseSchema.parse({
        ...baseResponse,
        progress: validProgress,
        stats: { ...validStats, joinedAt: 'not-a-date' },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 4.3: Run — must FAIL** on present-shape (unknown keys dropped, top-level fields not declared):

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/garage.test.ts -t "garagePublicResponseSchema (Phase 2"
```

- [ ] **Step 4.4: Extend `packages/shared/src/garage-public.ts`** — add imports alongside existing imports:

```ts
import { garageBadgePublicSchema } from './badges.js';
import { garageProgressSchema, garageStatsSchema } from './garage-progress.js';
```

(`garageBadgePublicSchema` is already imported on line 3 — keep one import.)

Replace `garagePublicResponseSchema` (≈ line 40-43) with:

```ts
export const garagePublicResponseSchema = z.object({
  garage: garagePublicProfileSchema,
  cars: z.array(carPublicSchema),
  // Phase 2 (chunk 24, fix canon §1). Top-level gamification capability —
  // canonical read path is `body.gamification.enabled` for SSR + mobile.
  // Phase 1 nested `garage.gamification` stays for backward compat.
  gamification: garageGamificationCapabilitySchema,
  // Phase 2 (chunk 24, §C10 + plan review MAJOR). Top-level public badges
  // (pinned subset) — SSR reads `data.badges` directly. Phase 1 nested
  // `garage.badges` stays for backward compat.
  badges: z.array(garageBadgePublicSchema),
  // Phase 2 (chunk 24, plan §C10). Both optional — route omits BOTH when
  // gamification.enabled === false (killswitch off) OR under the
  // public hide-on-empty rule (all metrics zero). Schema accepts both
  // presence + absence. See plan §"Killswitch".
  progress: garageProgressSchema.optional(),
  stats: garageStatsSchema.optional(),
});
```

If `garageGamificationCapabilitySchema` is not already imported in `garage-public.ts`, add it from `./garage.js` (or wherever it currently lives — re-verify at Step 0.4).

- [ ] **Step 4.5: Run — must PASS** (no regressions):

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/garage.test.ts
```

- [ ] **Step 4.6: Commit:**

```bash
git add packages/shared/src/garage-public.ts packages/shared/src/__tests__/garage.test.ts
git commit -m "feat(shared): wire progress + stats + top-level gamification/badges into garagePublicResponseSchema (chunk 24)"
```

---

## Task 5: Final verification + PR

- [ ] **Step 5.1: Final rebuild + typecheck + targeted vitest** (touched-files only per user memory; CI covers cross-package sweep). The barrel `src/index.ts` re-exports `garage.js` + `garage-public.js`; `garage-progress.js` is intentionally subpath-only (matches `garage-covers` precedent — do NOT add to the barrel).

```bash
pnpm --filter @ccc/shared build
pnpm --filter @ccc/shared typecheck
pnpm --filter @ccc/shared exec vitest run \
  src/__tests__/garage-progress.test.ts \
  src/__tests__/garage.test.ts
```

All three must exit clean. `dist/garage.js`, `dist/garage-public.js`, `dist/garage-progress.js`, `dist/garage-progress.d.ts` must all reflect the latest edits.

- [ ] **Step 5.2: Push:**

```bash
git push -u origin feat/jdma-garage-phase2-24
```

- [ ] **Step 5.3: Open PR (base = `main`):**

```bash
gh pr create --base main --head feat/jdma-garage-phase2-24 \
  --title "feat(shared): garageProgressSchema + garageStatsSchema (chunk 24)" \
  --body "$(cat <<'EOF'
## Summary

Phase 2 chunk 24 — pure-zod shared schemas for the new `progress` + `stats` payload blocks, plus the `./garage-progress` subpath export. Owner + public envelope schemas extended with both blocks as `.optional()` per §C10 so the killswitch-off branch still validates. Top-level `gamification` added to both envelopes per fix canon §1; top-level `badges` added to the public envelope per §C10 + plan review MAJOR.

- New module `packages/shared/src/garage-progress.ts` — `garageProgressSchema` (xp / rank / nextRank / xpInTier / xpToNextRank / tierSpan) + `garageStatsSchema` (events / posts / likesReceived / joinedAt) + inferred TS types.
- New subpath `@ccc/shared/garage-progress` in `packages/shared/package.json` `exports` (§C12 dist-pointing shape).
- `garageReadSchema` carries `gamification`, `progress?`, `stats?`.
- `garagePublicResponseSchema` carries `gamification`, `badges`, `progress?`, `stats?`.

No DB, no route, no UI. Chunks 25 / 26 / 28 wire them downstream.

## Corrections applied

- **§C10** — both fields `.optional()` on owner + public envelopes (killswitch-off branch validates).
- **§C10 + fix canon §1** — `gamification: { enabled: boolean }` at response top-level on both envelopes (route reads `body.gamification.enabled`).
- **§C10 + plan review MAJOR** — `badges` at response top-level on the public envelope.
- **§C12** — `./garage-progress` subpath uses canonical `{ types: ./dist/garage-progress.d.ts, import: ./dist/garage-progress.js }` shape.

## Documented deviations from the outline

1. **Top-level `gamification` is additive, not replacement.** Phase 1 chunk 16 placed `gamification` nested in `garageOwnerSchema` + `garagePublicProfileSchema`. This PR adds top-level `gamification` to the envelopes per fix canon §1 (the canonical read) but does NOT remove the Phase 1 nested field (out of scope; would break every existing consumer). Downstream chunks 28/40/41 read the top-level field.
2. **Owner-side `badges` stays nested.** Plan-review MAJOR specifically calls out public envelope `badges`. Owner-side `garageBadgeOwnerStateSchema` remains nested in `garageOwnerSchema` (Phase 1 carry-over). Public envelope DOES get top-level `badges`.
3. **`joinedAt` source.** Outline §28 says GarageStats includes `joinedAt`. Schema carries the ISO string; chunk 25's serializer sources it from `Garage.createdAt`. Service-layer decision.

## Verification

- `pnpm --filter @ccc/shared build` — clean (CLAUDE.md memory rule).
- `pnpm --filter @ccc/shared typecheck` — clean.
- `pnpm --filter @ccc/shared exec vitest run src/__tests__/garage-progress.test.ts src/__tests__/garage.test.ts` — all green.

## Test plan

- [x] `garage-progress.test.ts` — ≈14 cases (canonical / top-tier sentinel / zero-default accept; negative xp / xpInTier / xpToNextRank / tierSpan=0 / non-integer xp / empty rank / non-string rank / empty nextRank / missing field / non-ISO joinedAt / negative counters / non-integer events / missing joinedAt reject).
- [x] `garage.test.ts` — 5 new `garageReadSchema` cases (top-level gamification + progress + stats present, killswitch-off omits both, missing top-level gamification rejected, negative xp rejected, bad joinedAt rejected) + 6 new `garagePublicResponseSchema` cases (top-level gamification + progress + stats present, killswitch-off, empty top-level badges, missing top-level gamification rejected, missing top-level badges rejected, bad joinedAt rejected).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. CI on the PR runs the full cross-package sweep.

---

## Self-review

- **Spec coverage:** all 5 acceptance criteria from skeleton §"Chunk 24" map to tasks — schema shapes (Task 1), envelope optional fields + top-level gamification + top-level badges (Tasks 3+4), subpath export (Task 2), `@ccc/shared` rebuild (Step 2.3 + 5.1).
- **Placeholders:** none — every step ships actual command + code.
- **Type consistency:** the six `garageProgressSchema` fields are identical across Tasks 1 / 3 / 4; the four `garageStatsSchema` fields likewise. `.optional()` contract is identical on both envelopes. Top-level `gamification` schema reused (`garageGamificationCapabilitySchema`) on both envelopes.
- **Deviation candidates:** three — listed in §"Deviations from the outline" and re-stated in the PR body.
- **Integration test policy:** N/A — pure-zod, no Postgres needed.
- **`@ccc/shared` rebuild gate:** Step 2.3 + Step 5.1 (CLAUDE.md memory rule). The §C12 export shape means consumers cannot resolve `./garage-progress` until `dist/garage-progress.d.ts` exists.
