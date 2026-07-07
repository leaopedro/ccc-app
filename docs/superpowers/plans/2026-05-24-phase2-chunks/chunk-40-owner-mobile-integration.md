# Chunk 40 — Owner mobile integration (`<ProfileStats />` between IdentityCard and BadgeRow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Slot `<ProfileStats viewMode="owner" />` into the mobile owner garage route between the `GarageHeader` (which owns `IdentityCard`, Phase 1 chunk 08) and `BadgeRow` (Phase 1 chunk 19) so authenticated users see their XP scoreboard + 4 stats tiles above their badges. Killswitch off and fresh-signup states hide the block.

**Architecture:** Pure leaf wire-up. The composite `ProfileStats` already exists in `@jdm/ui` (chunk 39); chunk 40 derives its props from the in-flight `GarageReadResponse`, computes a `viewMode='owner'` `isFreshSignup` predicate that mirrors `showWelcomeBanner`, and renders the component inside the existing `ListHeaderComponent` JSX block in `apps/mobile/app/(app)/garage/index.tsx`. The killswitch is already read on the API side and surfaced through response top-level `gamification.enabled` (per outline §C10); the wrapper short-circuits on its own. A new viewmodel test file pins the visibility predicates so the route test stays focused on order.

**Tech Stack:** Expo + React Native (`apps/mobile`), `@jdm/ui` (`ProfileStats`, exported in chunk 39), `@jdm/shared/garage-progress` (`garageProgressSchema` + `garageStatsSchema` from chunk 24), vitest + jsdom (existing pattern in `__tests__/GarageIndexRoute.test.tsx`).

---

## Required reading (before first edit)

1. `/Users/pedro/Projects/jdm-experience/CLAUDE.md` — branch preflight.
2. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 40" + §"Carry-over fold-ins" #3.
3. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` §C1–C14 (corrections override inline chunk text); then §"Phase 2C — UI" line 302–303.
4. `/Users/pedro/Projects/jdm-experience/docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` chunks 08 (IdentityCard), 14 (welcome banner + section header order), 19 (BadgeRow route integration).
5. `apps/mobile/app/(app)/garage/index.tsx` — current `ListHeaderComponent` block (`GarageHeader → WelcomeBanner? → ExpiredPremiumNotice? → BadgeRow? → VagasSectionHeader`). Insertion point is between the `ExpiredPremiumNotice` branch and the `BadgeRow` branch. `GarageHeader` already mounts the `IdentityCard` internally (see `apps/mobile/src/screens/garage/GarageHeader.tsx`).
6. `apps/mobile/src/screens/garage/garage-header-gates.ts` — `showWelcomeBanner` is the canonical fresh-signup predicate; this chunk reuses it.
7. `apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx` — established mocking pattern (jsdom + react-native shim + screen-level `vi.mock`).
8. `apps/mobile/src/screens/garage/__tests__/fixtures.ts` — `garageReadFixture*` payloads; extend in this chunk for `progress` + `stats`.

---

## Locked invariants (do NOT relax)

- The killswitch lives at the response TOP LEVEL: `data.gamification.enabled` (per outline §C10 / fix-canon §1). NEVER read `data.garage.gamification.enabled` — that path does not exist on the canonical envelope.
- The route's existing `useFocusEffect` (at `apps/mobile/app/(app)/garage/index.tsx` line 55) already refetches `getGarage()` on every focus event. A killswitch flip mid-session arrives via the next refetch, which propagates a fresh `gamification.enabled` flag into the next render. `<ProfileStats />` itself does NOT call `useFocusEffect`; it only gates on the props it receives. No new effect is introduced in this chunk (per Phase 2 outline §C5 and carry-over fold-in #3 — the existing route effect is what satisfies the re-paint requirement).
- `viewMode` is fixed to `'owner'` on this route. The public SSR view is chunk 41.
- `isFreshSignup` mirrors `showWelcomeBanner(data)` exactly. Do not invent a new predicate; reuse the existing pure predicate.
- Owner side is allowed to render with all-zero metrics (per outline §302 / chunk 39 acceptance). The fresh-signup gate is the ONLY owner-side hide reason besides the killswitch.
- Branch from a fresh `main`; never from `production` (CLAUDE.md preflight).

---

## File structure

### Modified files

- `apps/mobile/app/(app)/garage/index.tsx` — import `ProfileStats` from `@jdm/ui`; insert one JSX block between `ExpiredPremiumNotice` and `BadgeRow`; derive props from the existing `garage` state. No new effect — the existing `useFocusEffect` at line 55 already refetches `getGarage()` on focus, which propagates a fresh response-level `gamification.enabled` flag through render.
- `apps/mobile/src/screens/garage/__tests__/fixtures.ts` — extend the shared `ownerBase` (and per-fixture overrides where needed) with the new `progress` + `stats` blocks under `GarageOwner` so existing tests keep parsing through `garageReadResponseSchema` after chunk 24's schema extension landed. Owner fixtures always carry both fields; the zero-default fixture mirrors a fresh signup.

### New files

- `apps/mobile/src/screens/garage/garage-progression.viewmodel.ts` — one tiny pure helper `pickProfileStatsProps(data)` returning `{ progress, stats, gamificationEnabled, isFreshSignup, viewMode: 'owner' } | null`. Pulls the shape straight out of `GarageReadResponse`; returns `null` when the payload omits `progress`/`stats` (killswitch off — per §C10 the fields are `.optional()`).
- `apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts` — unit tests for `pickProfileStatsProps` covering shape, killswitch, fresh-signup, missing-optional-fields, and the focus-effect re-enable carry-over.

> **Why a helper file?** The plan's brief asked for a viewmodel test file; co-locating the predicate function next to the test keeps the route file thin (no inline derivation) and lets the test cover the predicate without booting jsdom + the screen mocks. The route's screen test (`GarageIndexRoute.test.tsx`) gets one new ordering-only assertion.

### Touched-path summary

```
apps/mobile/app/(app)/garage/index.tsx                                  (modify)
apps/mobile/src/screens/garage/garage-progression.viewmodel.ts          (new)
apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts  (new)
apps/mobile/src/screens/garage/__tests__/fixtures.ts                    (modify — add progress + stats)
apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx      (modify — add 2 ordering assertions)
```

---

## Code shape (canonical for this chunk)

### `garage-progression.viewmodel.ts` (new)

```ts
// Chunk 40 — pure derivation of <ProfileStats /> props from the in-flight
// GarageReadResponse. Returns null when the API omitted progress/stats
// (killswitch off per outline §C10 .optional() semantics). Owner fresh-signup
// mirrors showWelcomeBanner — keep the predicate in lockstep with chunk 14.
//
// Killswitch path is response TOP-LEVEL `data.gamification.enabled` per
// outline §C10 / fix-canon §1. Do NOT read `data.garage.gamification.enabled`.

import type { GarageReadResponse } from '~/api/garage';
import { showWelcomeBanner } from '~/screens/garage/garage-header-gates';

export type ProfileStatsViewModel = {
  progress: NonNullable<GarageReadResponse['progress']>;
  stats: NonNullable<GarageReadResponse['stats']>;
  gamificationEnabled: boolean;
  isFreshSignup: boolean;
  viewMode: 'owner';
};

export const pickProfileStatsProps = (data: GarageReadResponse): ProfileStatsViewModel | null => {
  // Killswitch off OR API omitted blocks under §C10 .optional() → render-nothing.
  if (!data.gamification?.enabled) return null;
  if (!data.progress || !data.stats) return null;

  return {
    progress: data.progress,
    stats: data.stats,
    gamificationEnabled: data.gamification.enabled,
    isFreshSignup: showWelcomeBanner(data),
    viewMode: 'owner',
  };
};
```

### `apps/mobile/app/(app)/garage/index.tsx` (modify)

Two imports: add `ProfileStats` to the existing `@jdm/ui` line; add `pickProfileStatsProps` from `~/screens/garage/garage-progression.viewmodel`. Derive once per render after the `if (!garage)` early-return:

```ts
const profileStatsProps = pickProfileStatsProps(garage);
```

JSX block, inserted between `ExpiredPremiumNotice` and `BadgeRow` inside `ListHeaderComponent`:

```tsx
{showExpiredPremiumNotice(garage) ? <ExpiredPremiumNotice /> : null}
{profileStatsProps ? (
  <ProfileStats
    progress={profileStatsProps.progress}
    stats={profileStatsProps.stats}
    gamificationEnabled={profileStatsProps.gamificationEnabled}
    isFreshSignup={profileStatsProps.isFreshSignup}
    viewMode={profileStatsProps.viewMode}
    testID="garage-profile-stats"
  />
) : null}
{renderBadgeRow && badgesAggregate ? (<BadgeRow ... />) : null}
```

No new effect — existing `useFocusEffect` at line 55 refetches `getGarage()` on focus. Killswitch re-enable mid-session arrives via a re-focus → next render flips `profileStatsProps` from `null` to a value.

### `fixtures.ts` (modify)

Chunk 24 makes the fields `.optional()`; owner responses always include them when `gamification.enabled === true` per §C10. Add zero-default constants + spread `progress: progressZero, stats: statsZero` into every existing fixture so prior tests stay deterministic:

```ts
const progressZero = {
  xp: 0,
  rank: 'Iniciante' as const,
  nextRank: 'Pilotador' as const,
  xpInTier: 0,
  xpToNextRank: 100,
  tierSpan: 100,
};
const statsZero = { events: 0, posts: 0, likesReceived: 0, joinedAt: ISO };
```

Add two new fixtures used by the viewmodel + route tests:

```ts
export const garageReadFixtureActiveOwner: GarageReadResponse = {
  garage: { ...ownerBase },
  cars: [carCivic],
  spots: [{ id: 'sp_1', source: 'default_free', carId: 'car_civic', createdAt: ISO }],
  availableSlots: 0,
  freeLimit: 1,
  isUnlimited: false,
  purchaseOption,
  // Killswitch lives at the response top level per outline §C10 / fix-canon §1.
  gamification: { enabled: true },
  progress: {
    xp: 137,
    rank: 'Pilotador',
    nextRank: 'Veterano',
    xpInTier: 37,
    xpToNextRank: 363,
    tierSpan: 400,
  },
  stats: { events: 3, posts: 5, likesReceived: 12, joinedAt: ISO },
};

export const garageReadFixtureKillswitchOff: GarageReadResponse = {
  ...garageReadFixtureMixed,
  // Top-level killswitch off — NOT nested under garage.
  gamification: { enabled: false },
  progress: undefined,
  stats: undefined,
};
```

---

## Branch preflight (run before first edit)

- [ ] **Step 0: confirm fresh `main` branch**

```bash
git branch --show-current
# Expect: main (NOT production — if production, STOP per CLAUDE.md)
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-40
```

Expected: clean branch off `main`, no merge conflicts.

---

## Task 1 — Extend fixtures with `progress` + `stats`

**Files:**

- Modify: `apps/mobile/src/screens/garage/__tests__/fixtures.ts`

- [ ] **Step 1: insert constants + new fixtures + spread**

Insert `progressZero`, `statsZero`, `garageReadFixtureActiveOwner`, `garageReadFixtureKillswitchOff` (code in §"Code shape"). Spread `gamification: { enabled: true }, progress: progressZero, stats: statsZero` into every existing fixture (`EmptyFirstRun`, `FreeLimitZero`, `Mixed`, `AllFilled`, `Unlimited`, `UnlimitedAllFilled`). The top-level `gamification` field is canonical per outline §C10; NEVER nest it under `garage`.

- [ ] **Step 2: commit** (typecheck deferred to Task 2 step 5)

```bash
git add apps/mobile/src/screens/garage/__tests__/fixtures.ts
git commit -m "test(mobile): extend garage fixtures with progress + stats blocks (chunk 40)"
```

---

## Task 2 — `pickProfileStatsProps` viewmodel helper + tests

**Files:**

- Create: `apps/mobile/src/screens/garage/garage-progression.viewmodel.ts`
- Create: `apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts`

- [ ] **Step 1: write the failing tests**

```ts
// apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts
import { describe, expect, it } from 'vitest';

import { pickProfileStatsProps } from '../garage-progression.viewmodel';

import {
  garageReadFixtureActiveOwner,
  garageReadFixtureAllFilled,
  garageReadFixtureEmptyFirstRun,
  garageReadFixtureKillswitchOff,
  garageReadFixtureMixed,
} from './fixtures';

describe('pickProfileStatsProps', () => {
  it('returns the derived props on an active owner with metrics', () => {
    const r = pickProfileStatsProps(garageReadFixtureActiveOwner);
    expect(r).not.toBeNull();
    expect(r!.viewMode).toBe('owner');
    expect(r!.gamificationEnabled).toBe(true);
    expect(r!.progress.xp).toBe(137);
    expect(r!.stats.events).toBe(3);
    expect(r!.isFreshSignup).toBe(false);
  });

  it('returns null when gamification.enabled === false (killswitch)', () => {
    expect(pickProfileStatsProps(garageReadFixtureKillswitchOff)).toBeNull();
  });

  it('returns null when the API omitted progress/stats (§C10 optional shape)', () => {
    // Mid-flight envelope: enabled flag still true but blocks absent.
    const malformed = {
      ...garageReadFixtureMixed,
      gamification: { enabled: true },
      progress: undefined,
      stats: undefined,
    };
    expect(pickProfileStatsProps(malformed)).toBeNull();
  });

  it('flags fresh signup (mirrors showWelcomeBanner)', () => {
    const r = pickProfileStatsProps(garageReadFixtureEmptyFirstRun);
    expect(r).not.toBeNull();
    expect(r!.isFreshSignup).toBe(true);
  });

  it('non-fresh-signup user with no metrics still derives props (owner always renders)', () => {
    const r = pickProfileStatsProps(garageReadFixtureAllFilled);
    expect(r).not.toBeNull();
    expect(r!.isFreshSignup).toBe(false); // has cars, even with zero xp
    expect(r!.progress.xp).toBe(0);
  });

  it('killswitch re-enable mid-session re-derives correctly (carry-over §"fold-ins" #3)', () => {
    // First call: killswitch off → null. Then the route's useFocusEffect
    // refetches; the new payload has enabled=true + populated blocks. The
    // helper is pure, so calling it again with the new data flips to a value.
    expect(pickProfileStatsProps(garageReadFixtureKillswitchOff)).toBeNull();
    expect(pickProfileStatsProps(garageReadFixtureActiveOwner)).not.toBeNull();
  });
});
```

- [ ] **Step 2: run the test, watch it fail**

```bash
pnpm --filter @jdm/mobile vitest run apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts
# Expected: FAIL — `Cannot find module '../garage-progression.viewmodel'`.
```

- [ ] **Step 3: implement `pickProfileStatsProps`**

Create `apps/mobile/src/screens/garage/garage-progression.viewmodel.ts` with the code from §"Code shape" (the `ProfileStatsViewModel` type + the `pickProfileStatsProps` function).

- [ ] **Step 4: run the test, watch it pass**

```bash
pnpm --filter @jdm/mobile vitest run apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts
# Expected: 6 passing.
```

- [ ] **Step 5: typecheck the mobile workspace**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors. If chunk 24's optional schema additions haven't
# resolved through @jdm/shared/dist, run `pnpm --filter @jdm/shared build`
# per CLAUDE.md memory rule "Rebuild @jdm/shared after schema changes".
```

- [ ] **Step 6: commit**

```bash
git add apps/mobile/src/screens/garage/garage-progression.viewmodel.ts \
        apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts
git commit -m "feat(mobile): pickProfileStatsProps viewmodel for chunk-40 owner integration"
```

---

## Task 3 — Slot `<ProfileStats />` into the garage route

**Files:**

- Modify: `apps/mobile/app/(app)/garage/index.tsx`

- [ ] **Step 1: add imports** — append `ProfileStats` to the existing `@jdm/ui` import on line 2; add `import { pickProfileStatsProps } from '~/screens/garage/garage-progression.viewmodel';` next to the other `~/screens/garage/*` imports.

- [ ] **Step 2: derive props** — after the `if (!garage)` early-return (around line 153), before the `renderBadgeRow` const, add:

```ts
const profileStatsProps = pickProfileStatsProps(garage);
```

- [ ] **Step 3: insert the JSX block** in `ListHeaderComponent`, between `ExpiredPremiumNotice` and the `BadgeRow` branch (exact code in §"Code shape" above).

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors. ProfileStats prop drift here = chunk 39 contract miss → escalate.
git add apps/mobile/app/\(app\)/garage/index.tsx
git commit -m "feat(mobile): slot <ProfileStats /> between IdentityCard and BadgeRow on /garage (chunk 40)"
```

---

## Task 4 — Route ordering + visibility tests

**Files:**

- Modify: `apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx`

> Mock `@jdm/ui`'s `ProfileStats` the same way the existing test mocks `BadgeRow`-adjacent screen components — render a tagged `<div>` so order is checkable. Real `<ProfileStats />` behaviour is covered by chunk 39's tests; this chunk only validates insertion order + the killswitch + fresh-signup gates.

- [ ] **Step 1: extend the `@jdm/ui` mock to expose a stand-in ProfileStats + hoist the route component**

The current test does not mock `@jdm/ui` (it lets the real `BadgeRow` / `BadgesSheet` / `PremiumSheet` render). For ProfileStats we want a stand-in so the assertion targets a deterministic tag without booting the real component's RN canvas. Add a partial mock that preserves the real exports and overrides `ProfileStats`.

Also hoist the route component import to outer test scope (BEFORE the `describe` block, AFTER the `vi.mock` calls so the mocks apply at import time). The existing `mount()` helper imports the route internally; the focus-re-enable test below needs to re-render after `unmount()`, so the `Route` reference must live in outer scope. Add this single import:

```ts
import RouteIndex from '../../../../app/(app)/garage/index';
```

Mock setup:

```ts
vi.mock('@jdm/ui', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const { createElement: el } = await import('react');
  const Stub = (props: Record<string, unknown>) =>
    el(
      'div',
      {
        'data-testid': 'mock-profile-stats',
        'data-fresh': String(props.isFreshSignup ?? ''),
        'data-mode': String(props.viewMode ?? ''),
      },
      'ProfileStats',
    );
  return { ...real, ProfileStats: Stub };
});
```

- [ ] **Step 2: add new tests under the existing describe block**

```ts
// IMPORTANT: hoist the route component to outer test scope so the
// focus-re-enable test below can re-render it without re-deriving from
// inside the mount() helper. Place this import once near the top of the
// test file (after the @jdm/ui mock, before describe()):
//
//   import RouteIndex from '../../../../app/(app)/garage/index';
//
// All tests in this describe block reference `RouteIndex` directly when
// remounting. The existing mount() helper continues to import internally
// for the standard first-mount path.

it('renders ProfileStats between GarageHeader (IdentityCard) and BadgeRow when an owner has progress + stats', async () => {
  setApi({
    garage: makeGarage({
      garage: makeGarageOwner({ badges: [earnedBadge('EVT-001')] }),
      cars: [carCivic],
      gamification: { enabled: true },
      progress: {
        xp: 137,
        rank: 'Pilotador',
        nextRank: 'Veterano',
        xpInTier: 37,
        xpToNextRank: 363,
        tierSpan: 400,
      },
      stats: { events: 3, posts: 5, likesReceived: 12, joinedAt: ISO },
    }),
    badges: makeBadgesAggregate({ badges: [earnedBadge('EVT-001')] }),
  });
  await mount();
  const header = container.querySelector('[data-testid="mock-garage-header"]');
  const profileStats = container.querySelector('[data-testid="mock-profile-stats"]');
  const badgeRow = container.querySelector('[data-testid="garage-badge-row"]');
  expect(header).not.toBeNull();
  expect(profileStats).not.toBeNull();
  expect(badgeRow).not.toBeNull();
  const all = Array.from(container.querySelectorAll('*'));
  expect(all.indexOf(header!)).toBeLessThan(all.indexOf(profileStats!));
  expect(all.indexOf(profileStats!)).toBeLessThan(all.indexOf(badgeRow!));
  // Owner viewMode + non-fresh user.
  expect(profileStats!.getAttribute('data-mode')).toBe('owner');
  expect(profileStats!.getAttribute('data-fresh')).toBe('false');
});

it('hides ProfileStats when gamification.enabled === false (killswitch)', async () => {
  setApi({
    // Killswitch lives at the response top level per outline §C10 / fix-canon §1.
    garage: makeGarage({
      garage: makeGarageOwner(),
      gamification: { enabled: false },
      progress: undefined,
      stats: undefined,
    }),
    badges: makeBadgesAggregate({ enabled: false }),
  });
  await mount();
  expect(container.querySelector('[data-testid="mock-profile-stats"]')).toBeNull();
});

it('hides ProfileStats when isFreshSignup is true (owner default per outline §302)', async () => {
  setApi({
    garage: makeGarage({
      // Fresh: zero cars, no premium tier → showWelcomeBanner=true.
      garage: makeGarageOwner(),
      cars: [],
      gamification: { enabled: true },
      progress: {
        xp: 0,
        rank: 'Iniciante',
        nextRank: 'Pilotador',
        xpInTier: 0,
        xpToNextRank: 100,
        tierSpan: 100,
      },
      stats: { events: 0, posts: 0, likesReceived: 0, joinedAt: ISO },
    }),
  });
  await mount();
  // Chunk 39 itself hides on isFreshSignup. Stub mirrors the contract via the
  // data-fresh attribute. The route still RENDERS the wrapper (passes the
  // flag); the wrapper is what hides. Assert flag passes through correctly.
  const node = container.querySelector('[data-testid="mock-profile-stats"]');
  expect(node).not.toBeNull();
  expect(node!.getAttribute('data-fresh')).toBe('true');
});

it('does not render ProfileStats until the garage query resolves (loading state)', async () => {
  // Defer the promise resolution so the route's <ActivityIndicator /> is
  // visible and the ListHeaderComponent block is unmounted.
  let resolve: ((v: GarageReadResponse) => void) | null = null;
  apiState.getGarage.mockImplementation(
    () => new Promise<GarageReadResponse>((r) => (resolve = r)),
  );
  apiState.getMyBadges.mockResolvedValue(makeBadgesAggregate());
  await act(async () => {
    root.render(<RouteIndex />);
    await flush();
  });
  expect(container.querySelector('[data-testid="mock-profile-stats"]')).toBeNull();
  // Resolve and let the chain settle.
  await act(async () => {
    resolve!(
      makeGarage({
        gamification: { enabled: true },
        progress: {
          xp: 10,
          rank: 'Iniciante',
          nextRank: 'Pilotador',
          xpInTier: 10,
          xpToNextRank: 90,
          tierSpan: 100,
        },
        stats: { events: 1, posts: 0, likesReceived: 0, joinedAt: ISO },
        cars: [carCivic],
      }),
    );
    for (let i = 0; i < 6; i++) await flush();
  });
  expect(container.querySelector('[data-testid="mock-profile-stats"]')).not.toBeNull();
});

it('focus re-enable repaints ProfileStats when killswitch flips on mid-session', async () => {
  // First focus → killswitch off → wrapper hidden. Second focus refetches and
  // flips on. Killswitch path is response top-level per outline §C10 / canon §1.
  apiState.getMyBadges.mockResolvedValue(makeBadgesAggregate());
  apiState.getGarage
    .mockResolvedValueOnce(
      makeGarage({
        garage: makeGarageOwner(),
        gamification: { enabled: false },
        progress: undefined,
        stats: undefined,
        cars: [carCivic],
      }),
    )
    .mockResolvedValueOnce(
      makeGarage({
        garage: makeGarageOwner(),
        cars: [carCivic],
        gamification: { enabled: true },
        progress: {
          xp: 42,
          rank: 'Iniciante',
          nextRank: 'Pilotador',
          xpInTier: 42,
          xpToNextRank: 58,
          tierSpan: 100,
        },
        stats: { events: 1, posts: 0, likesReceived: 0, joinedAt: ISO },
      }),
    );
  await mount();
  expect(container.querySelector('[data-testid="mock-profile-stats"]')).toBeNull();
  // Simulate a focus event by remounting the route (expo-router's
  // useFocusEffect runs on mount in the test shim). The second mock value
  // is what getGarage resolves on the second call. RouteIndex is hoisted
  // to outer test scope (see comment above this describe block).
  await act(async () => {
    root.unmount();
    root = createRoot(container);
    root.render(<RouteIndex />);
    for (let i = 0; i < 6; i++) await flush();
  });
  expect(container.querySelector('[data-testid="mock-profile-stats"]')).not.toBeNull();
});
```

> **Note on the focus-effect test:** the existing route test treats every mount as a fresh focus event because the `useFocusEffect` shim in test env is just `useEffect`. This is sufficient to cover the killswitch-re-enable carry-over (skeleton §"Carry-over fold-ins" #3) without a custom focus-event helper. If the harness already exposes a `triggerFocus` helper from a prior chunk, prefer that — but the remount-style assertion is what landed for chunk 19 and is the canon pattern.

- [ ] **Step 3: run the route tests**

```bash
pnpm --filter @jdm/mobile vitest run apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx
# Expected: pre-existing chunk-19 tests still pass + 5 new tests pass.
```

- [ ] **Step 4: typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors.
```

- [ ] **Step 5: commit**

```bash
git add apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx
git commit -m "test(mobile): route-level ordering + killswitch + loading tests for ProfileStats (chunk 40)"
```

---

## Verification (final)

- [ ] **A. Typecheck the mobile workspace**

```bash
pnpm --filter @jdm/mobile typecheck
# Expected: 0 errors.
```

- [ ] **B. Run the two touched test files**

```bash
pnpm --filter @jdm/mobile vitest run \
  apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts \
  apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx
# Expected: 11+ passing (6 viewmodel + existing chunk-19 + 5 new route tests).
```

- [ ] **C. Confirm no full suite run** — per the user-memory rule "Never run full test suite locally" (touched files only; trust CI for the sweep).

> Do NOT run pnpm migrate, pnpm build, or pnpm test (full suite). CI runs on PR push.

---

## Corrections that apply

- **Fix-canon §1 — `gamification` lives at the response TOP LEVEL.** All reads use `data.gamification.enabled` (per outline §C10). The viewmodel, route, fixtures, and route tests are all aligned to this path. The legacy `data.garage.gamification.enabled` form is REMOVED throughout this chunk.
- **§C5 — sync killswitch read.** Handled upstream by the route: every `useFocusEffect`-triggered `getGarage()` call hits the server, which calls `readGamificationEnabled()` on every request (no cache). The flag arrives fresh at the response top level. Chunk 40 does NOT introduce any client-side cache or memoization for the flag, and does NOT add a second effect inside `ProfileStats` — the existing route effect is the sole re-fetch trigger.
- **§C10 — envelope shapes.** Owner response carries `progress` + `stats` as `.optional()` AND `gamification: { enabled }` at the top level. The viewmodel treats `undefined` on either field as "render nothing" — matches the schema contract. The fixtures explicitly cover the killswitch-off variant with `gamification: { enabled: false }` and both `progress`/`stats` undefined.
- **§C11 — Phase 1 chunk references corrected.** IdentityCard is Phase 1 **chunk 08**; BadgeRow is Phase 1 **chunk 19** (NOT "Phase 2 chunk 2B.11"). All in-PR comments + commit messages cite the corrected numbers.

---

## Deviations / deferrals

1. **`ProfileStats` `viewMode` prop name:** the skeleton brief uses `viewMode="owner"` while chunk 39's outline (§302) names it `mode`. Plan assumes `viewMode` per the brief's exact call signature. If chunk 39 shipped `mode`, swap both names in Task 3 step 4 + Task 4 step 1 stub before commit — no other code paths change. **Verify chunk 39 prop names at the top of Task 3 before editing the JSX.**
2. **Focus-effect carry-over (skeleton §"Carry-over fold-ins" #3):** absorbed via the remount-style assertion in Task 4 step 2's last test. If chunk 0 polish landed a more idiomatic focus-event helper, prefer that and update the test, but the remount form is the chunk-19 canon pattern. The remount test requires the route component to be hoisted into outer test scope (Task 4 step 1) so `unmount()` + re-render can reference it without a fresh `import()` call.
3. **No new effects added.** The existing `useFocusEffect` (route, line 55) covers re-render on focus; this chunk does NOT introduce a second effect inside `<ProfileStats />`. The wrapper only gates on the props it receives — the route owns the killswitch refetch, the wrapper owns the render gate.
4. **Killswitch path canonicalized.** Per fix-canon §1, every read in this chunk uses response top-level `data.gamification.enabled`. Earlier draft text referencing `data.garage.gamification.enabled` is fully purged from the viewmodel, route, fixtures, and test snippets.

---

## PR checklist

- [ ] Branch is `feat/jdma-garage-phase2-40`, created from a fresh `main` (CLAUDE.md preflight).
- [ ] Five files touched (matches §"Touched-path summary").
- [ ] No edits outside the five touched paths.
- [ ] `pnpm --filter @jdm/mobile typecheck` clean.
- [ ] Touched-file vitest runs green (viewmodel + GarageIndexRoute).
- [ ] `<ProfileStats />` import added to the existing `@jdm/ui` line — not a new import.
- [ ] JSX insertion is between `ExpiredPremiumNotice` and `BadgeRow` inside `ListHeaderComponent` — verified by ordering assertion.
- [ ] `pickProfileStatsProps` returns `null` on killswitch off + on `progress`/`stats` undefined; flips `isFreshSignup` via `showWelcomeBanner`.
- [ ] Owner-side empty metrics still derive props (no hide); fresh signup propagates the flag through `data-fresh="true"` for chunk-39's own visibility logic.
- [ ] PR body cites: skeleton §"Chunk 40", outline §302–303, §C5, §C10, §C11. Calls out the §"Deviations" prop-name caveat if `mode` vs `viewMode` differed at chunk 39's PR.
- [ ] `Co-Authored-By` trailer included in every commit.
- [ ] No `--no-verify`, no `--no-gpg-sign`.
- [ ] PR opened against `main`, never `production`.

---

## Self-review checklist (run before opening the PR)

1. **Spec coverage:** brief asked for (a) insertion between IdentityCard + BadgeRow → Task 3; (b) viewmodel test file with insertion-point + killswitch + fresh-signup + tooltip-open + focus-effect + loading tests → Tasks 2 + 4 collectively cover all six. **Tooltip `?` tap test:** intentionally NOT in this chunk's scope — tooltip behaviour lives inside `ProfileStats` (chunk 39's `XPTooltip` integration). Re-asserting it here would duplicate coverage. The route only validates that `ProfileStats` mounts with the right props; the component owns its own interaction tests.
2. **Placeholder scan:** no "TODO", no "add appropriate error handling", no "similar to X". Every step shows the exact code or command.
3. **Type consistency:** `pickProfileStatsProps` return type matches the props consumed at the JSX insertion. `ProfileStats` props per the skeleton brief (`progress`, `stats`, `gamificationEnabled`, `viewMode`, `isFreshSignup`). If chunk 39 used `mode`, see §"Deviations" item 1.
