# Chunk 39 — `ProfileStats` composite wrapper (`@ccc/ui`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `packages/ui/src/ProfileStats.tsx` — a composite that owns the tooltip open/close state and applies both the gamification killswitch gate and the public hide-on-empty rule. Wires chunk 36 `XPScoreboard` + chunk 37 `StatsRow` + chunk 38 `XPTooltip` behind one ergonomic prop surface.

**Architecture:** Stateless from the outside — the only internal state is `tooltipOpen: boolean`, owned via `useState`. Children are dumb / controlled. The wrapper short-circuits to `null` in three cases before any child renders, in this order: killswitch off, owner+fresh-signup, public+all-zero. No hooks beyond `useState` and no side effects. The wrapper consumes `progress` + `stats` as **optional** per §C10 because the wire payload omits them when the killswitch is off OR when the public hide-on-empty rule fires server-side. Mobile clients re-apply the same predicate locally as a defence-in-depth. Past the three gates, `if (!progress || !stats) return null;` enforces the §C10 missing-payload contract (covered by tests 4 + 6 + 7 + 8).

**Tooltip handler boundary (Canon §12 — mobile vs SSR).** Mobile `ProfileStats` (this chunk) **owns tooltip state** and passes the opener via `XPScoreboard.onPressHint`. `XPScoreboard` declares `onPressHint?: () => void` as optional: when supplied, the `?` is interactive and mounts the modal; when omitted, the `?` renders static. This chunk **always supplies** the handler — mobile is the interactive surface. SSR / web public view uses a **separate component** `ProfileStatsWeb` (chunk 41) that passes `onPressHint={undefined}` and never mounts `XPTooltip` (RN Modal is mobile-only per skeleton open-Q default). No SSR branching lives in this file. The boundary is: mobile = this chunk, web = chunk 41; same shared `XPScoreboard` + `StatsRow` underneath, different wrappers above. Do not add a `tooltipMode` prop here.

**Tech Stack:** React 19 + React Native 0.81 (via NativeWind 4.x), TypeScript 5.7, Vitest 3.x with `@testing-library/react-native` (whatever the Phase 1 chunk 19 BadgeRow tests use — verify in pre-flight). No new dependencies.

**Spec anchors (read once, do not copy):**

- `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 39" (lines 452–469).
- `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`:
  - §"Locked invariants" #2 (line 28) — public hide-on-empty rule.
  - §C5 (line 116) — sync killswitch read; no caching at this layer.
  - §C10 (line 189) — `progress` + `stats` are `.optional()` on owner AND public envelopes.
  - §"Phase 2C — UI" line 302 — chunk 2C.39 contract.
  - §"Killswitch" line 502 (line 511 specifically) — "Mobile renders nothing — `<ProfileStats />` reads `gamification.enabled` from the response + returns null when false."
- `docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` — wrapper convention reference (e.g. `GarageHeader.tsx` post-chunk-08 thin wrapper) for state-owning composite tone.
- `CLAUDE.md` — branch safety preflight + PR-only-to-`main`.

---

## Pre-flight

Run before the first edit. Do not skip.

- [ ] **Step 0.1: Confirm branch is not `production`**

```bash
git -C /Users/pedro/Projects/jdm-experience branch --show-current
```

Expected: any non-`production` ref. If `production`: STOP. Switch to `main` first per CLAUDE.md §"Branch safety preflight".

- [ ] **Step 0.2: Sync `main`**

```bash
git -C /Users/pedro/Projects/jdm-experience checkout main
git -C /Users/pedro/Projects/jdm-experience pull --ff-only origin main
```

- [ ] **Step 0.3: Create the feature branch from fresh `main`**

```bash
git -C /Users/pedro/Projects/jdm-experience checkout -b feat/jdma-garage-phase2-39
```

- [ ] **Step 0.4: Re-read the live state of dependent files**

The plan was authored against a snapshot. Confirm chunks 36 / 37 / 38 landed and that their public surface matches the calls in Task 1 / Task 2 below. If any anchor below has drifted, reconcile inline before editing.

```bash
ls packages/ui/src/XPScoreboard.tsx packages/ui/src/StatsRow.tsx packages/ui/src/XPTooltip.tsx
grep -n "export.*XPScoreboard\b\|export.*StatsRow\b\|export.*XPTooltip\b" packages/ui/src/index.ts
grep -n "export interface XPScoreboardProps\|export interface StatsRowProps\|export interface XPTooltipProps" \
  packages/ui/src/XPScoreboard.tsx packages/ui/src/StatsRow.tsx packages/ui/src/XPTooltip.tsx
```

Expected:

- All three files exist.
- All three `export …` lines present in `packages/ui/src/index.ts`.
- The three `*Props` interfaces are exported with at least the prop names this plan uses (see Task 1 step 1.3). If any prop name has drifted, update Task 1 step 1.3 inline rather than editing chunk 36/37/38.

- [ ] **Step 0.5: Confirm test runner conventions**

```bash
grep -n "render\|fireEvent\|@testing-library" packages/ui/src/__tests__/BadgeRow.test.tsx 2>/dev/null | head -10
cat packages/ui/package.json | grep -E '"test"|vitest|@testing-library'
```

If no `test` script / `@testing-library/react-native` is wired, **STOP** — that is chunks 36/37/38's responsibility. File a blocker comment, do not patch it here.

---

## File structure

| Path                                              | Action     | Responsibility                                                                              |
| ------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `packages/ui/src/ProfileStats.tsx`                | **create** | Composite component + the three short-circuit predicates. Owns `tooltipOpen` state.         |
| `packages/ui/src/__tests__/ProfileStats.test.tsx` | **create** | 8 vitest cases covering the three short-circuits + render-positive + tooltip state machine. |
| `packages/ui/src/index.ts`                        | **modify** | Add `export { ProfileStats, type ProfileStatsProps } from './ProfileStats.js';`             |

**NOT touched here** (downstream chunks):

- `apps/mobile/**` — chunk 40 slots `<ProfileStats />` into the owner garage screen.
- `apps/admin/**` — chunk 41 slots the same component into the SSR public view.
- `packages/ui/src/XPScoreboard.tsx`, `StatsRow.tsx`, `XPTooltip.tsx` — chunks 36/37/38 own those. If a prop is missing, do not patch the child; file a chunk-36/37/38 follow-up.
- `packages/shared/**` — chunk 24 already shipped the optional schemas; this chunk only consumes the types.

---

## Type contract (locked, used across all tasks)

The types below are referenced by **every** task. Define them in `ProfileStats.tsx` exactly as written. The `progress` + `stats` payload types come from `@ccc/shared/garage-progress` (chunk 24 §C12 subpath).

```ts
import type {
  GarageProgress, // chunk 24 — { xp, rank, nextRank, xpInTier, xpToNextRank, tierSpan }
  GarageStats, // chunk 24 — { events, posts, likesReceived, joinedAt }
} from '@ccc/shared/garage-progress';

export interface ProfileStatsProps {
  /** Progress block from the wire payload. Omitted when killswitch off (server) OR public hide-on-empty fires. */
  progress?: GarageProgress;
  /** Stats block from the wire payload. Same omission rules as `progress`. */
  stats?: GarageStats;
  /** `gamification.enabled` capability flag from the wire payload. Required: clients always know. */
  gamificationEnabled: boolean;
  /** Who is viewing. Drives the hide policy. */
  viewMode: 'owner' | 'public';
  /** Owner-only: when true (fresh signup, no activity yet), render nothing.
   *  Ignored when `viewMode === 'public'`. Public uses the all-zero predicate instead. */
  isFreshSignup?: boolean;
  /** Optional test hook + a11y label root. */
  testID?: string;
}
```

**Predicate order (Task 1 enforces):**

1. If `!gamificationEnabled` → `null`. (Killswitch wins regardless of view / freshness — §line 511.)
2. Else if `viewMode === 'owner' && isFreshSignup === true` → `null`. (Owner fresh-signup gate — outline §302 last sentence.)
3. Else if `viewMode === 'public'` AND every metric is zero/absent → `null`. (Public hide-on-empty — invariant #2.)
4. Else render `<View>…</View>` with `XPScoreboard` + `StatsRow` + `XPTooltip`.

**All-zero predicate (public branch only, defence-in-depth per §C10):**

```ts
const isAllZero =
  (progress?.xp ?? 0) === 0 &&
  (stats?.events ?? 0) === 0 &&
  (stats?.posts ?? 0) === 0 &&
  (stats?.likesReceived ?? 0) === 0;
```

The `?? 0` coalescing handles the wire-omission case (server already short-circuited). A defence-in-depth render-null is correct here even though the server should not have sent the block.

---

## Task 1 — Failing tests first (TDD)

**Files:**

- Create: `packages/ui/src/__tests__/ProfileStats.test.tsx`

Tone: vitest + the package's existing test-library binding (verified in Step 0.5). Mirror the `describe`/`it` shape from Phase 1 chunk 19's BadgeRow test if it exists; otherwise follow the standard React-Native Testing Library pattern below.

- [ ] **Step 1.1: Author the test file with 12 failing cases**

Write the file in full — no test stubs.

```tsx
// packages/ui/src/__tests__/ProfileStats.test.tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react-native';

import { ProfileStats } from '../ProfileStats.js';
import type { GarageProgress, GarageStats } from '@ccc/shared/garage-progress';

const zeroProgress: GarageProgress = {
  xp: 0,
  rank: 'Iniciante',
  nextRank: 'Pilotador',
  xpInTier: 0,
  xpToNextRank: 100,
  tierSpan: 100,
};
const zeroStats: GarageStats = {
  events: 0,
  posts: 0,
  likesReceived: 0,
  joinedAt: '2026-02-01T00:00:00.000Z',
};
const activeProgress: GarageProgress = { ...zeroProgress, xp: 42, xpInTier: 42, xpToNextRank: 58 };
const activeStats: GarageStats = { ...zeroStats, events: 3, posts: 2, likesReceived: 5 };

describe('ProfileStats — short-circuits', () => {
  it('renders nothing when gamificationEnabled is false (owner with full data)', () => {
    const { toJSON } = render(
      <ProfileStats
        progress={activeProgress}
        stats={activeStats}
        gamificationEnabled={false}
        viewMode="owner"
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when gamificationEnabled is false (public with full data)', () => {
    const { toJSON } = render(
      <ProfileStats
        progress={activeProgress}
        stats={activeStats}
        gamificationEnabled={false}
        viewMode="public"
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('public view with all-zero metrics returns null (hide-on-empty)', () => {
    const { toJSON } = render(
      <ProfileStats
        progress={zeroProgress}
        stats={zeroStats}
        gamificationEnabled={true}
        viewMode="public"
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('public view with progress + stats omitted (server short-circuit) returns null', () => {
    const { toJSON } = render(<ProfileStats gamificationEnabled={true} viewMode="public" />);
    expect(toJSON()).toBeNull();
  });

  it('owner view with isFreshSignup=true returns null', () => {
    const { toJSON } = render(
      <ProfileStats
        progress={zeroProgress}
        stats={zeroStats}
        gamificationEnabled={true}
        viewMode="owner"
        isFreshSignup={true}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  // §C10 missing-payload contract — both fields are `.optional()` on the wire.
  // Past the killswitch + freshness + all-zero gates, any missing block forces
  // null render (defence-in-depth; the server should not have sent half a block).
  it('owner view returns null when progress is undefined', () => {
    const { toJSON } = render(
      <ProfileStats stats={activeStats} gamificationEnabled={true} viewMode="owner" />,
    );
    expect(toJSON()).toBeNull();
  });

  it('owner view returns null when stats is undefined', () => {
    const { toJSON } = render(
      <ProfileStats progress={activeProgress} gamificationEnabled={true} viewMode="owner" />,
    );
    expect(toJSON()).toBeNull();
  });

  it('owner view returns null when both progress and stats are undefined', () => {
    const { toJSON } = render(<ProfileStats gamificationEnabled={true} viewMode="owner" />);
    expect(toJSON()).toBeNull();
  });
});

describe('ProfileStats — renders', () => {
  it('owner view, non-fresh, all-zero metrics still renders the scoreboard', () => {
    const { getByTestId } = render(
      <ProfileStats
        progress={zeroProgress}
        stats={zeroStats}
        gamificationEnabled={true}
        viewMode="owner"
        isFreshSignup={false}
        testID="profile-stats"
      />,
    );
    expect(getByTestId('profile-stats')).toBeTruthy();
    expect(getByTestId('profile-stats-scoreboard')).toBeTruthy();
    expect(getByTestId('profile-stats-row')).toBeTruthy();
  });

  it('public view with any metric > 0 renders scoreboard + stats row', () => {
    const { getByTestId, queryByTestId } = render(
      <ProfileStats
        progress={activeProgress}
        stats={activeStats}
        gamificationEnabled={true}
        viewMode="public"
        testID="profile-stats"
      />,
    );
    expect(getByTestId('profile-stats-scoreboard')).toBeTruthy();
    expect(getByTestId('profile-stats-row')).toBeTruthy();
    // Tooltip is mounted-but-hidden by default; child decides its own visibility.
    expect(queryByTestId('profile-stats-tooltip')).toBeTruthy();
  });
});

describe('ProfileStats — tooltip open/close state', () => {
  it('tapping the scoreboard hint button opens the tooltip', () => {
    const { getByTestId } = render(
      <ProfileStats
        progress={activeProgress}
        stats={activeStats}
        gamificationEnabled={true}
        viewMode="owner"
        testID="profile-stats"
      />,
    );

    const tooltipBefore = getByTestId('profile-stats-tooltip');
    expect(tooltipBefore.props.visible).toBe(false);

    fireEvent.press(getByTestId('profile-stats-scoreboard-hint'));

    const tooltipAfter = getByTestId('profile-stats-tooltip');
    expect(tooltipAfter.props.visible).toBe(true);
  });

  it('tooltip closes when the backdrop is pressed', () => {
    const { getByTestId } = render(
      <ProfileStats
        progress={activeProgress}
        stats={activeStats}
        gamificationEnabled={true}
        viewMode="owner"
        testID="profile-stats"
      />,
    );

    fireEvent.press(getByTestId('profile-stats-scoreboard-hint'));
    expect(getByTestId('profile-stats-tooltip').props.visible).toBe(true);

    // Chunk 38 forwards `onClose` to `Modal.onRequestClose`; the live prop on the
    // rendered Modal is `onRequestClose`, not `onClose`. Press the exposed
    // `${testID}-backdrop` (chunk 38 wires it to dispatch close) to mirror the
    // real backdrop-tap dismiss path.
    fireEvent.press(getByTestId('profile-stats-tooltip-backdrop'));

    expect(getByTestId('profile-stats-tooltip').props.visible).toBe(false);
  });
});
```

Notes: tests assert on `props.visible` for the live `XPTooltip` node and dismiss via the `${testID}-backdrop` Pressable that chunk 38 exposes (`packages/ui/src/XPTooltip.tsx` line ~436 — `testID: \`${testID}-backdrop\``). We do NOT call `tooltip.props.onClose()`directly — chunk 38 forwards`onClose`to RN`Modal`as`onRequestClose`, so `onClose`is not a live prop on the rendered node.`profile-stats-scoreboard-hint`is chunk 36's`?` button testID (verify in 0.4; reconcile inline if drifted).

- [ ] **Step 1.2: Run the failing tests**

```bash
pnpm --filter @ccc/ui test -- ProfileStats.test.tsx
```

Expected: 12 failures, all with `Cannot find module '../ProfileStats.js'` (or the equivalent). If the test runner is not yet wired in `@ccc/ui`, that error is the engineer's signal — see Step 0.5.

- [ ] **Step 1.3: Verify child contracts**

```bash
grep -n "onPressHint\|testID\|XPScoreboardProps" packages/ui/src/XPScoreboard.tsx
grep -n "testID\|StatsRowProps" packages/ui/src/StatsRow.tsx
grep -n "visible\|onClose\|testID\|XPTooltipProps" packages/ui/src/XPTooltip.tsx
```

Expected props (chunks 36/37/38 skeleton):

- `XPScoreboardProps`: `progress: GarageProgress`, `onPressHint: () => void`, `testID?: string`.
- `StatsRowProps`: `stats: GarageStats`, `testID?: string`.
- `XPTooltipProps`: `visible: boolean`, `onClose: () => void`, `testID?: string`.

If any prop drifted, update Task 2 step 2.1 inline + add a one-line entry under §"Deviation log". **Do not** patch the child component.

---

## Task 2 — Minimal implementation

**Files:**

- Create: `packages/ui/src/ProfileStats.tsx`

- [ ] **Step 2.1: Write the component**

```tsx
// packages/ui/src/ProfileStats.tsx
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import type { GarageProgress, GarageStats } from '@ccc/shared/garage-progress';

import { StatsRow } from './StatsRow.js';
import { XPScoreboard } from './XPScoreboard.js';
import { XPTooltip } from './XPTooltip.js';

export interface ProfileStatsProps {
  /** Progress block from the wire payload. Omitted when killswitch off OR public hide-on-empty fires. */
  progress?: GarageProgress;
  /** Stats block from the wire payload. Same omission rules as `progress`. */
  stats?: GarageStats;
  /** `gamification.enabled` capability flag from the wire payload. */
  gamificationEnabled: boolean;
  /** Who is viewing. Drives the hide policy. */
  viewMode: 'owner' | 'public';
  /** Owner-only: when true (fresh signup, no activity yet), render nothing.
   *  Ignored when `viewMode === 'public'`. Public uses the all-zero predicate instead. */
  isFreshSignup?: boolean;
  testID?: string;
}

/** Composite owning tooltip state. Gate order: (1) killswitch, (2) owner-fresh,
 *  (3) public-all-zero. See phase2 plan §"Locked invariants" #2, §C5, §C10,
 *  §"Killswitch" line 511, §"Phase 2C" line 302. */
export function ProfileStats({
  progress,
  stats,
  gamificationEnabled,
  viewMode,
  isFreshSignup = false,
  testID,
}: ProfileStatsProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const onPressHint = useCallback(() => setTooltipOpen(true), []);
  const onClose = useCallback(() => setTooltipOpen(false), []);

  // (1) Killswitch wins regardless of view / freshness — §line 511.
  if (!gamificationEnabled) return null;
  // (2) Owner fresh-signup gate — §line 302 last sentence.
  if (viewMode === 'owner' && isFreshSignup) return null;
  // (3) Public hide-on-empty — §"Locked invariants" #2. Defence-in-depth.
  if (viewMode === 'public') {
    const isAllZero =
      (progress?.xp ?? 0) === 0 &&
      (stats?.events ?? 0) === 0 &&
      (stats?.posts ?? 0) === 0 &&
      (stats?.likesReceived ?? 0) === 0;
    if (isAllZero) return null;
  }
  // §C10 — past the three gates both should be present; never half-render.
  if (!progress || !stats) return null;

  return (
    <View testID={testID}>
      <XPScoreboard
        progress={progress}
        onPressHint={onPressHint}
        testID="profile-stats-scoreboard"
      />
      <StatsRow stats={stats} testID="profile-stats-row" />
      <XPTooltip visible={tooltipOpen} onClose={onClose} testID="profile-stats-tooltip" />
    </View>
  );
}
```

- [ ] **Step 2.2: Wire the export**

Open `packages/ui/src/index.ts` and append (alphabetical-ish placement is fine — chunks 36/37/38 will already have added their own lines).

```ts
export { ProfileStats, type ProfileStatsProps } from './ProfileStats.js';
```

- [ ] **Step 2.3: Run the tests — expect green**

```bash
pnpm --filter @ccc/ui test -- ProfileStats.test.tsx
```

Expected: **12 passing, 0 failing, 0 skipped** (8 short-circuits + 2 renders + 2 tooltip). If count is wrong, diff against Task 1 Step 1.1 verbatim.

- [ ] **Step 2.4: Commit Task 2**

```bash
git -C /Users/pedro/Projects/jdm-experience add \
  packages/ui/src/ProfileStats.tsx \
  packages/ui/src/__tests__/ProfileStats.test.tsx \
  packages/ui/src/index.ts
git -C /Users/pedro/Projects/jdm-experience commit -m "feat(ui): ProfileStats composite wrapper (chunk 39)"
```

---

## Task 3 — Typecheck

- [ ] **Step 3.1: Typecheck**

```bash
pnpm --filter @ccc/ui typecheck
```

Expected: clean. If `@ccc/shared/garage-progress` is unresolved, chunk 24's subpath export (§C12) `dist/` is stale (memory rule `feedback_rebuild_shared_after_schema_change.md`):

```bash
pnpm --filter @ccc/shared build && pnpm --filter @ccc/ui typecheck
```

This chunk does NOT modify `packages/shared`; rebuild is only to refresh `dist/` if a sibling chunk landed schema changes locally.

---

## Task 4 — Self-review against the spec

Read once with fresh eyes; fix inline, do not loop.

- [ ] **Step 4.1: Spec coverage walk**

Map each spec bullet → task:

- §line 302 "Owns tooltip-open state" → Task 2 (`useState` + memoized handlers).
- §line 302 public "Only renders if progress.xp > 0 || stats.events > 0 || …" → Task 2 (`isAllZero`); Task 1 cases 3 + 10.
- §line 302 "Owner view always renders unless `fresh` signup state" → Task 2 gate (2); Task 1 cases 5 + 9.
- §line 511 "Mobile renders nothing — reads `gamification.enabled` + returns null when false" → Task 2 gate (1); Task 1 cases 1 + 2.
- §"Locked invariants" #2 (line 28) public hide-on-empty → Task 2 gate (3); Task 1 case 3.
- §C5 (sync killswitch read, no cache) → Task 2 reads `gamificationEnabled` from props per render.
- §C10 (optional schemas + missing-payload contract) → Type contract + Task 2 (`progress?`, `stats?`, `?? 0`, post-gate `if (!progress || !stats) return null;`). Task 1 cases 4 + 6 + 7 + 8 cover every missing-payload permutation (public-both-missing, owner-progress-only-missing, owner-stats-only-missing, owner-both-missing).
- Skeleton "tooltip `?` tap toggles" → Task 1 cases 11 + 12.

- [ ] **Step 4.2: Placeholder scan**

Search for red-flag patterns:

```bash
grep -nE 'TODO|TBD|FIXME|implement later|fill in' \
  packages/ui/src/ProfileStats.tsx \
  packages/ui/src/__tests__/ProfileStats.test.tsx
```

Expected: zero hits. If any, replace with concrete content from this plan before committing.

- [ ] **Step 4.3: Type-consistency scan**

Confirm every type / prop name lines up across files:

```bash
grep -n "ProfileStatsProps\|onPressHint\|isFreshSignup\|gamificationEnabled" \
  packages/ui/src/ProfileStats.tsx \
  packages/ui/src/__tests__/ProfileStats.test.tsx \
  packages/ui/src/index.ts
```

Expected: every name appears with identical spelling in every file that uses it.

---

## Task 5 — Final verification

- [ ] **Step 5.1: Targeted vitest run**

```bash
pnpm --filter @ccc/ui test -- ProfileStats.test.tsx
```

Expected counts:

- `describe('ProfileStats — short-circuits', …)` → 8 passing (5 gate cases + 3 §C10 missing-payload cases).
- `describe('ProfileStats — renders', …)` → 2 passing.
- `describe('ProfileStats — tooltip open/close state', …)` → 2 passing.
- Total: **12 passing, 0 failing, 0 skipped**.

- [ ] **Step 5.2: Touched-file typecheck**

```bash
pnpm --filter @ccc/ui typecheck
```

Expected: clean.

- [ ] **Step 5.3: No collateral file changes**

```bash
git -C /Users/pedro/Projects/jdm-experience diff --stat main...HEAD
```

Expected staged paths only:

- `packages/ui/src/ProfileStats.tsx` (new)
- `packages/ui/src/__tests__/ProfileStats.test.tsx` (new)
- `packages/ui/src/index.ts` (1-line export addition)

Per CLAUDE.md memory `feedback_no_full_test_suite_locally.md`: do NOT run the full workspace test suite locally. CI on the PR runs the full sweep.

Per CLAUDE.md memory `feedback_no_background_shells.md`: do NOT spawn a watch-mode dev server or trigger-and-grep loop. The targeted vitest above is sufficient verification.

---

## Corrections applied

- **§C5** — props read per render; no `useMemo` / module cache. Server route owns per-request memoization, not the wrapper.
- **§C10** — `progress?` + `stats?` optional; predicate uses `?? 0`; `if (!progress || !stats) return null;` guard after the three gates. Missing-payload contract is covered by 3 dedicated tests (cases 6 / 7 / 8 — progress-only-missing, stats-only-missing, both-missing) plus the public-both-missing case 4.
- **§C12 (Canon §12 — tooltip handler contract)** — Mobile `ProfileStats` owns tooltip state and passes `onPressHint` to `XPScoreboard`. SSR is a separate component `ProfileStatsWeb` (chunk 41); this chunk does NOT branch on platform and does NOT accept a `tooltipMode` prop. The static-SSR variant is chunk 41's responsibility.
- **Canon §1 — joinedAt** — `GarageStats` field is `joinedAt` (ISO datetime string), matching chunk 24's authoritative schema. The plan no longer references `memberSince`.
- **Tooltip dismiss test** — chunk 38 forwards `onClose` to RN `Modal` via `onRequestClose`. The dismiss test therefore presses `${testID}-backdrop` (chunk 38's exposed Pressable testID) rather than invoking `tooltip.props.onClose()` (which would not exist on the rendered Modal node).

---

## Documented deviations from the outline

None expected at plan-write. Drift-resolution edits already applied from the 2026-05-24 Phase 2 plan review:

- **memberSince → joinedAt** (BLOCK in review §chunk-39) — chunk 24's `GarageStats` field is `joinedAt` (ISO datetime). Renamed in the type-contract comment and the `zeroStats` fixture. Canon §1.
- **Tooltip dismiss via backdrop press** (BLOCK in review §chunk-39) — chunk 38 routes `onClose` to RN `Modal.onRequestClose`, so the rendered Modal node has no `onClose` prop. The dismiss test now presses the chunk-38-exposed `${testID}-backdrop` Pressable. Canon §12.
- **§C10 missing-payload contract** (MAJOR in review §chunk-39) — added three owner-branch tests (cases 6 / 7 / 8) for `progress === undefined`, `stats === undefined`, and both undefined. Test total moved from 9 → 12. Canon §2.
- **Mobile / SSR tooltip boundary** (MAJOR in review §chunks 36/39/41) — documented in §Architecture above: this chunk is mobile-only; SSR uses `ProfileStatsWeb` (chunk 41). No `tooltipMode` prop here. Canon §12.

If pre-flight 0.4 surfaces a child-prop drift (e.g. chunk 36 named the hint prop `onHintPress`), append `- [file:line] § ref — reason` below and adjust Task 2 Step 2.1 inline. Do **not** modify chunk 36/37/38 from this chunk.

---

## Test plan (recap — 12 cases, counts must match Step 5.1)

1. `renders nothing when gamificationEnabled is false (owner with full data)` — killswitch wins, owner branch.
2. `renders nothing when gamificationEnabled is false (public with full data)` — killswitch wins, public branch.
3. `public view with all-zero metrics returns null (hide-on-empty)` — invariant #2 client mirror.
4. `public view with progress + stats omitted (server short-circuit) returns null` — §C10 optional ⇒ render null.
5. `owner view with isFreshSignup=true returns null` — owner fresh-signup gate (§302).
6. `owner view returns null when progress is undefined` — §C10 missing-payload contract (progress half).
7. `owner view returns null when stats is undefined` — §C10 missing-payload contract (stats half).
8. `owner view returns null when both progress and stats are undefined` — §C10 missing-payload contract (both).
9. `owner view, non-fresh, all-zero metrics still renders the scoreboard` — owner always sees own XP (§302).
10. `public view with any metric > 0 renders scoreboard + stats row` — positive-render public branch.
11. `tapping the scoreboard hint button opens the tooltip` — `tooltipOpen` flips false→true via `onPressHint`.
12. `tooltip closes when the backdrop is pressed` — `tooltipOpen` flips true→false via the `${testID}-backdrop` Pressable that chunk 38 exposes.

---

## PR checklist (branch `feat/jdma-garage-phase2-39`)

- [ ] Branch cut from a freshly-pulled `main` (pre-flight 0.1–0.3 ran clean). Never branched from `production`.
- [ ] Only three files changed: `packages/ui/src/ProfileStats.tsx` (new) + `packages/ui/src/__tests__/ProfileStats.test.tsx` (new) + `packages/ui/src/index.ts` (1-line export). Verify with `git diff --stat main...HEAD`.
- [ ] `pnpm --filter @ccc/ui typecheck` clean.
- [ ] Targeted vitest 12/12 in `ProfileStats.test.tsx`.
- [ ] No edits to `packages/shared`, `packages/db`, `apps/api`, `apps/mobile`, `apps/admin`, or the three child component files (`XPScoreboard.tsx`, `StatsRow.tsx`, `XPTooltip.tsx`).
- [ ] No edits on `production` (CLAUDE.md branch safety).
- [ ] PR opened against `main`, not `production` (CLAUDE.md §"Git flow").
- [ ] PR title: `feat(ui): ProfileStats composite wrapper (chunk 39)`.
- [ ] PR body links to (a) skeleton §"Chunk 39", (b) outline §302, (c) outline §C10, (d) outline §line 511. Reference paths only; do not copy the spec inline.
- [ ] §"Deviation log" above either says "none" or lists one-line drift entries with file:line + chunk reference.

---

## Self-review notes

- **Spec coverage:** skeleton lines 461–465 acceptance bullets all map to Task 1 cases (see Task 4 Step 4.1).
- **Placeholders:** none — every code block is final source.
- **Type consistency:** prop names spelled identically across component / test / index export / type contract; `joinedAt` matches chunk 24's authoritative `GarageStats` field name.
- **§C10:** `progress?` + `stats?` optional; predicate uses `?? 0`; `if (!progress || !stats) return null;` after the three gates; missing-payload contract covered by 4 dedicated cases (4, 6, 7, 8).
- **§C5:** `gamificationEnabled` read from props per render; no cache.
- **§line 511:** killswitch is the first gate.
- **Canon §12 (tooltip boundary):** mobile owns state; SSR is chunk 41's `ProfileStatsWeb`. No platform branching in this file.
- **Tooltip dismiss test:** uses `${testID}-backdrop` Pressable (chunk 38 exposed), not `tooltip.props.onClose()`.
- **Scope:** zero edits outside `packages/ui/`. Mobile + admin integration deferred to chunks 40 + 41.
