# Chunk 38 — `XPTooltip` component (`@ccc/ui`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a centered-card overlay in `@ccc/ui` listing the 8 XP-earning actions (icon + label + `+N XP`) and the dashed-bordered PT-BR footer disclaimer. **Tooltip, NOT a bottom sheet** — canonical UI deviation from Phase 1. **Mobile-only surface** (canon §12): SSR has no overlay; the `ProfileStatsWeb` wrapper omits the opener and renders `?` static.

**Architecture:** Single self-contained `XPTooltip.tsx`. RN `Modal` + transparent + full-bleed `Pressable` backdrop (Phase 1 idiom — `packages/ui/src/SheetShell.tsx:24-35`). Backdrop layer is an `expo-blur` `BlurView` (intensity 40, dark tint) wrapped in the dim `Pressable` — keeps the Phase 2 §2C.38 backdrop blur in scope. Card centered via flex. Backdrop tap → `onClose`. Inner `Pressable` swallows card-taps. Static 8-row `ScrollView`. Icons via `lucide-react-native` per `BadgeGlyph.tsx:1-19`. `XP_RULES` lives **inside `@ccc/ui`** — UI copy stays out of `@ccc/shared`.

**Tech Stack:** TS, React 19, RN 0.81, `lucide-react-native`, `expo-blur`, `garageTokens`. Tests on Vitest 3 + `@testing-library/react-native` (first test file in `packages/ui/` — harness setup is part of the chunk; mobile RN/SVG/`lucide-react-native` stubs reused).

**Spec references (read once, do not copy):**

- `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 38" (lines 430–448).
- `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` §C1–C14 (read first); only C8 (`admin_adjustment` excluded) + C13 (`+200` premium one-shot) are adjacent. §"Phase 2C" / 2C.38 (line 301) — centered card NOT bottom sheet, 8 rules, locked PT-BR footer. §"XP-awarder rules" (line 437) — source-of-truth deltas.
- `docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` — overlay-chrome convention.
- `CLAUDE.md` — branch preflight, PR-to-`main` only.

---

## Scope

**In scope:**

- `packages/ui/src/XPTooltip.tsx` (NEW) — exports `XPTooltip`, `XPTooltipProps`, `XP_RULES`, `XPRule`.
- `packages/ui/src/index.ts` (MODIFY) — re-export the 4 symbols.
- `packages/ui/src/__tests__/XPTooltip.test.tsx` (NEW; `__tests__/` dir is also new).
- `packages/ui/vitest.config.ts` (NEW) — mirrors `apps/mobile/vitest.config.ts` aliases (`lucide-react-native` stub).
- `packages/ui/test-stubs/lucide-react-native.tsx` (NEW) — copy of `apps/mobile/test-stubs/lucide-react-native.tsx` so `@ccc/ui` tests stand alone (canon §13).
- `packages/ui/package.json` (MODIFY) — test scripts + `expo-blur` peer dep + test devDeps.
- `pnpm-lock.yaml` (MODIFY) — picks up `expo-blur` + test devDeps (canon §13).
- `apps/mobile/test-stubs/expo-blur.tsx` (NEW) — barrel-cascade prophylactic (canon §15); mirrors `lucide-react-native.tsx` stub.
- `apps/mobile/vitest.config.ts` (MODIFY) — add `expo-blur` alias pointing at the new stub.

**Out of scope:** `ProfileStats` wrapper (chunk 39), `XPScoreboard` (36), `StatsRow` (37), mobile wiring (40), SSR variant (41), animations (Phase 2D).

## Corrections that apply

None of §C1–C14 directly. Adjacent: §C8 → `admin_adjustment` excluded (moderator-only); §C13 → `+200` premium is one-shot (locked in footer copy).

**Phase 2 fix-canon refs:**

- §12 (Tooltip handler contract) — `XPTooltip` is mobile-only; SSR `ProfileStatsWeb` passes `undefined` opener, renders static `?`.
- §13 (UI package dep + harness) — `expo-blur` added to `packages/ui/package.json` (peer + devDep); lockfile in touched paths; `lucide-react-native` test stub mirrors mobile.

## 8-row mapping (decision locked)

Outline §437 lists 10 awarder rows. Outline §301 mandates exactly 8 user-facing rules. Drop:

1. `post_like (revert)` — inverse of `apply`, not an earning action.
2. `admin_adjustment` — moderator path, not user-facing.

List **all 3 `badge_award` rarities separately** so users see the `+25 / +50 / +100` ramp explicitly — that ramp is the product hook for hunting rarer badges. Collapsing into one "Conquistas" row would hide it. **Final 8:** `event_checkin`, `car_create`, `post_create`, `post_like`, `badge_award_common`, `badge_award_rare`, `badge_award_legendary`, `premium_activation`.

## File structure

```
packages/ui/src/XPTooltip.tsx                   (NEW)
packages/ui/src/index.ts                        (MODIFY — add 4 re-exports)
packages/ui/src/__tests__/XPTooltip.test.tsx   (NEW)
packages/ui/vitest.config.ts                    (NEW)
packages/ui/test-stubs/lucide-react-native.tsx  (NEW — mobile-mirrored stub)
packages/ui/package.json                        (MODIFY — scripts + devDeps + expo-blur peer)
pnpm-lock.yaml                                  (MODIFY — picks up expo-blur + test devDeps)
apps/mobile/test-stubs/expo-blur.tsx            (NEW — canon §15 barrel-cascade prophylactic)
apps/mobile/vitest.config.ts                    (MODIFY — add expo-blur alias)
```

Nine paths. Nothing else.

## Branch preflight

- [ ] **Step 0** (CLAUDE.md §"Branch safety preflight")

```bash
git branch --show-current
# If `production` → STOP.
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-38
```

## Backdrop blur (spec-aligned)

Outline §2C.38 mandates "Backdrop + blur". Earlier draft dropped blur to a flat dim; that deviation is NOT authorized by §C1–C14. **Revert to the spec.** Add `expo-blur` (Expo SDK 54 ships ~`~15.x` — pin to match other Expo packages in `apps/mobile/package.json`) as a peer dep of `@ccc/ui` and a transitive dep via `apps/mobile/package.json` (Expo prebuild picks it up; no manual EAS native module wiring needed since `expo-blur` is an Expo Modules package).

Backdrop layer composition (inside Modal):

```tsx
<BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
<Pressable onPress={onClose} style={{ ...absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' }}>
  {/* card pressable */}
</Pressable>
```

`BlurView` underneath, then a 45%-black `Pressable` over it (still tap-dismissable; the dim improves contrast on photo-heavy garage backgrounds). Mirrors how Phase 1 `SheetShell` stacks chrome layers. Per canon §12, this overlay is **mobile-only** — SSR has no `XPTooltip` mount; `ProfileStatsWeb` passes `undefined` for the opener and the `?` renders static.

---

## Task 1 — Vitest harness for `@ccc/ui`

**Files:** `packages/ui/vitest.config.ts` (NEW), `packages/ui/test-stubs/lucide-react-native.tsx` (NEW), `packages/ui/package.json` (MODIFY), `pnpm-lock.yaml` (MODIFY).

`@ccc/ui` has no tests yet. Mirror `apps/mobile/vitest.config.ts` 1:1 — same `lucide-react-native` alias + the same `esbuild.jsx: 'automatic'` override + the same `deps.external` for native-only packages. The `lucide-react-native` stub is REQUIRED: `@ccc/ui` barrel already pulls `BadgeGlyph` → real lucide ESM, which vitest can't transform under jsdom (per the comment in the mobile stub file). Without the alias the harness will explode on any test that touches the barrel.

- [ ] **Step 1.1 — Create `packages/ui/test-stubs/lucide-react-native.tsx`**

Copy `apps/mobile/test-stubs/lucide-react-native.tsx` verbatim. Add the icons used by `XPTooltip` to the explicit re-export list at the bottom: `Car`, `Crown`, `Flag`, `Heart`, `Medal`, `MessageSquare` (the Proxy default covers any new addition, but explicit names keep editor tooling happy + the contract obvious).

- [ ] **Step 1.2 — Create `packages/ui/vitest.config.ts`**

```ts
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors apps/mobile/vitest.config.ts: lucide-react-native ESM
      // can't be transformed under jsdom; redirect to local stub.
      'lucide-react-native': path.resolve(__dirname, 'test-stubs/lucide-react-native.tsx'),
    },
  },
  // Same reason as mobile: tsconfig sets jsx="react-native" for Metro,
  // which esbuild treats as classic. Use the automatic runtime in tests.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: [],
    deps: {
      // expo-blur ships native binding; keep external in jsdom.
      external: ['expo-blur'],
    },
  },
});
```

- [ ] **Step 1.3 — Edit `packages/ui/package.json`**

Add to `scripts`:

```json
"test": "vitest run --passWithNoTests",
"test:watch": "vitest"
```

Add to `peerDependencies` (alphabetical):

```json
"expo-blur": ">=15.0.0"
```

And to `peerDependenciesMeta` (so non-Expo consumers don't blow up):

```json
"expo-blur": { "optional": false }
```

Add to `devDependencies` (alphabetical; versions match the mobile workspace pins):

```json
"@testing-library/react-native": "^12.7.2",
"expo-blur": "~15.0.0",
"jsdom": "^29.1.1",
"react-test-renderer": "19.1.0",
"vitest": "^3.0.0"
```

Mirror the `expo-blur` version pin to whichever Expo-SDK-54 minor lands; `jsdom: ^29.1.1` matches mobile.

> NOTE — agent does NOT run `pnpm install` itself per canon §13. The install in Step 1.4 is what touches `pnpm-lock.yaml`; agent stages the lockfile diff after install completes. `expo-blur` propagates to `apps/mobile` transitively through `@ccc/ui`'s peer dep; Expo prebuild walks workspace peer deps, so no separate edit to `apps/mobile/package.json` is needed.

- [ ] **Step 1.4 — Install + verify empty runner**

```bash
pnpm install
pnpm --filter @ccc/ui test
```

Expected: install completes; `pnpm-lock.yaml` diff shows `expo-blur` + the 5 new test devDeps only; `test` exits 0 via `passWithNoTests`.

- [ ] **Step 1.5 — Commit**

```bash
git add packages/ui/vitest.config.ts \
        packages/ui/test-stubs/lucide-react-native.tsx \
        packages/ui/package.json \
        pnpm-lock.yaml
git commit -m "chore(ui): add vitest harness + RN testing-library + expo-blur for @ccc/ui"
```

---

## Task 1.5 — Mobile barrel-cascade prophylactic (canon §15) — **DEFERRED to Phase 2D**

> **chunk-38 execution status (2026-05-25):** chunk 38 shipped WITHOUT
> `expo-blur` — the runtime peer-dep tipped pnpm's workspace-root hoist
> (root `react-dom@19.2.4` while root `react@19.1.0` stayed pinned via
> mobile/UI workspaces), and admin's vitest run failed with a null hook
> dispatcher on ~195 unrelated specs. PR #434 therefore drops the
> BlurView layer entirely and renders a flat 45%-black dim backdrop.
> Phase 2D will revive blur (likely with a workspace-React alignment
> first) and re-attach this prophylactic. The Task 1.5 instructions
> below are preserved verbatim as Phase 2D reference material; chunk
> 38 itself skipped them.

**Files (Phase 2D):** `apps/mobile/test-stubs/expo-blur.tsx` (NEW), `apps/mobile/vitest.config.ts` (MODIFY).

**Why this task exists** (from `.handoffs/orchestrator-state.md` canon §15, added after chunk 36 + 37 cascade): adding ANY new runtime dep on `packages/ui/package.json` with untransformed-ESM-in-build (here: `expo-blur` ships native binding + ESM that vitest can't transform under jsdom) cascades into CI failures on ~30+ unrelated `apps/mobile` tests that load the new component through the `@ccc/ui` barrel — even though THIS chunk's own test (which keeps `expo-blur` `deps.external` in `packages/ui/vitest.config.ts`) passes locally. Per-file `vi.mock` does NOT scale once the dep enters the barrel.

Mirror the existing `lucide-react-native` global-alias pattern in `apps/mobile/vitest.config.ts`. The stub forwards-ref a `View` with no blur logic — tests assert text + structure, not blur pixels, so a no-op host is correct.

- [ ] **Step 1.5.1 — Create `apps/mobile/test-stubs/expo-blur.tsx`**

```tsx
/* expo-blur jsdom stub — see canon §15 (barrel-cascade prophylactic).
 *
 * Reason: real expo-blur ships native binding + ESM that vitest can't
 * transform under jsdom. `XPTooltip` lives in @ccc/ui's barrel and imports
 * `BlurView`; ~30+ mobile tests would explode on transitive load. Stub
 * mirrors the runtime ergonomics of the lucide-react-native stub.
 *
 * Tests assert text + structure, not blur pixels — a no-op host View is
 * sufficient. If a future test asserts blur intensity/tint, override
 * locally via vi.mock inside that file.
 */
import React from 'react';
import { View, type ViewProps } from 'react-native';

export type BlurViewProps = ViewProps & {
  intensity?: number;
  tint?: 'light' | 'dark' | 'default' | string;
};

export const BlurView = React.forwardRef<View, BlurViewProps>(function BlurView(
  { intensity: _intensity, tint: _tint, ...rest },
  ref,
) {
  return <View ref={ref} {...rest} />;
});

export default { BlurView };
```

- [ ] **Step 1.5.2 — Edit `apps/mobile/vitest.config.ts` — add the alias**

In the `resolve.alias` block, append below the existing `lucide-react-native` line:

```ts
// `expo-blur` ships a native binding + ESM that vitest can't transform
// under jsdom. Once `XPTooltip` (chunk 38) joined `@ccc/ui`'s barrel,
// every mobile test that pulls anything from `@ccc/ui` started loading
// expo-blur transitively. Redirect to the local stub. (Canon §15.)
'expo-blur': path.resolve(__dirname, 'test-stubs/expo-blur.tsx'),
```

- [ ] **Step 1.5.3 — Verify the cascade prophylactic actually works**

Run two unrelated mobile tests that load `@ccc/ui` (per canon §15 mandate — chunk's own test alone is insufficient):

```bash
pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/BadgesSheet.test.tsx
pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/CoverPickerSheet.test.tsx
```

Both must PASS. If either FAILs with `expo-blur` parse / resolve errors, the alias is mis-placed or the stub path is wrong — fix before proceeding to Task 2.

- [ ] **Step 1.5.4 — Commit**

```bash
git add apps/mobile/test-stubs/expo-blur.tsx \
        apps/mobile/vitest.config.ts
git commit -m "chore(mobile): add expo-blur vitest stub + alias (canon §15)"
```

---

## Task 2 — Write the failing tests

**Files:** `packages/ui/src/__tests__/XPTooltip.test.tsx` (NEW).

Write all 8 tests up-front. They WILL fail (component doesn't exist) — that's TDD.

- [ ] **Step 2.1 — Create the test file**

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { XP_RULES, XPTooltip } from '../XPTooltip.js';

describe('XP_RULES', () => {
  it('contains exactly 8 entries in the canonical order', () => {
    expect(XP_RULES).toHaveLength(8);
    expect(XP_RULES.map((r) => r.key)).toEqual([
      'event_checkin',
      'car_create',
      'post_create',
      'post_like',
      'badge_award_common',
      'badge_award_rare',
      'badge_award_legendary',
      'premium_activation',
    ]);
  });

  it('matches the awarder deltas at outline §437', () => {
    const byKey = Object.fromEntries(XP_RULES.map((r) => [r.key, r.delta]));
    expect(byKey).toEqual({
      event_checkin: 10,
      car_create: 5,
      post_create: 2,
      post_like: 1,
      badge_award_common: 25,
      badge_award_rare: 50,
      badge_award_legendary: 100,
      premium_activation: 200,
    });
  });
});

describe('<XPTooltip />', () => {
  it('renders all 8 rule labels when visible', () => {
    const { getByText } = render(<XPTooltip visible onClose={() => {}} />);
    for (const rule of XP_RULES) expect(getByText(rule.label)).toBeTruthy();
  });

  it('renders all 8 +N XP deltas when visible', () => {
    const { getByText } = render(<XPTooltip visible onClose={() => {}} />);
    for (const rule of XP_RULES) expect(getByText(`+${rule.delta} XP`)).toBeTruthy();
  });

  it('renders the locked PT-BR footer disclaimer verbatim', () => {
    const { getByText } = render(<XPTooltip visible onClose={() => {}} />);
    expect(
      getByText(
        'XP não expira e não pode ser comprado. Premium dá um bônus único de +200 XP no momento da ativação.',
      ),
    ).toBeTruthy();
  });

  it('renders nothing when visible={false}', () => {
    const { queryByText } = render(<XPTooltip visible={false} onClose={() => {}} />);
    expect(queryByText(XP_RULES[0]!.label)).toBeNull();
  });

  it('calls onClose when the backdrop is pressed', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<XPTooltip visible onClose={onClose} testID="xp-tooltip" />);
    fireEvent.press(getByTestId('xp-tooltip-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Android back / Modal onRequestClose fires', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<XPTooltip visible onClose={onClose} testID="xp-tooltip" />);
    fireEvent(getByTestId('xp-tooltip'), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2.2 — Run; confirm 8 fail with "module not found"**

```bash
pnpm --filter @ccc/ui test
```

Expected: all 8 FAIL with `Cannot find module '../XPTooltip.js'`. Any other failure mode = harness bug; fix Task 1 first. Task 3 adds the file (constant + a temporary `XPTooltip` stub) so the failure narrows from "module not found" → "rules pass, component renders nothing" — locked sequencing per canon §"failing-test sequencing".

---

## Task 3 — Implement `XP_RULES` + `XPRule` + temporary `XPTooltip` stub

**Files:** `packages/ui/src/XPTooltip.tsx` (NEW — constant + type + temporary stub).

Icons selected from `lucide-react-native` per `BadgeGlyph.tsx:1-19` precedent: `Flag` for check-in, `Car` for car-create, `MessageSquare` for post, `Heart` for like, `Medal` for the 3 badge tiers (color-tinted via `garageTokens.rarity`), `Crown` for premium. All seven names are valid Lucide exports.

**Why the stub:** the test file static-imports `XPTooltip`. Without an export of that name, Task 2 fails with `Cannot find module` for every test — the 2 rules-only tests cannot pass partially. The stub renders `null` for any `visible` value and accepts the prop shape; rules tests then PASS, component tests FAIL with assertion errors (e.g. "no element with text X found"). That is the narrow-advancing failure pattern called out in the canon.

- [ ] **Step 3.1 — Create the file**

```tsx
import {
  Car,
  Crown,
  Flag,
  Heart,
  type LucideIcon,
  Medal,
  MessageSquare,
} from 'lucide-react-native';

import { garageTokens } from './garage-tokens.js';

export interface XPRule {
  key:
    | 'event_checkin'
    | 'car_create'
    | 'post_create'
    | 'post_like'
    | 'badge_award_common'
    | 'badge_award_rare'
    | 'badge_award_legendary'
    | 'premium_activation';
  icon: LucideIcon;
  iconColor: string;
  /** PT-BR locked copy. */
  label: string;
  /** Positive integer delta — mirrors outline §437. */
  delta: number;
}

/**
 * XP_RULES — canonical user-facing list (8 entries). Mirrors outline §437
 * but drops `post_like (revert)` (inverse op) + `admin_adjustment`
 * (moderator-only) and lists the 3 `badge_award` rarities separately, per
 * outline §301. Single source of truth for user-visible XP copy; server
 * deltas live in the awarder service. The contract test
 * (`__tests__/XPTooltip.test.tsx` → "matches the awarder deltas at outline
 * §437") fails if either side drifts.
 */
export const XP_RULES: readonly XPRule[] = [
  {
    key: 'event_checkin',
    icon: Flag,
    iconColor: garageTokens.brand.base,
    label: 'Check-in em evento',
    delta: 10,
  },
  {
    key: 'car_create',
    icon: Car,
    iconColor: '#C9C9CD',
    label: 'Adicionar carro à garagem',
    delta: 5,
  },
  {
    key: 'post_create',
    icon: MessageSquare,
    iconColor: '#C9C9CD',
    label: 'Publicar no feed',
    delta: 2,
  },
  {
    key: 'post_like',
    icon: Heart,
    iconColor: garageTokens.brand.base,
    label: 'Curtida recebida em post',
    delta: 1,
  },
  {
    key: 'badge_award_common',
    icon: Medal,
    iconColor: garageTokens.rarity.common,
    label: 'Conquistar uma medalha comum',
    delta: 25,
  },
  {
    key: 'badge_award_rare',
    icon: Medal,
    iconColor: garageTokens.rarity.rare,
    label: 'Conquistar uma medalha rara',
    delta: 50,
  },
  {
    key: 'badge_award_legendary',
    icon: Medal,
    iconColor: garageTokens.rarity.legendary,
    label: 'Conquistar uma medalha lendária',
    delta: 100,
  },
  {
    key: 'premium_activation',
    icon: Crown,
    iconColor: garageTokens.tier.gold,
    label: 'Ativar Premium (bônus único)',
    delta: 200,
  },
] as const;

// --- TEMPORARY stub so Task 2 tests can resolve the symbol. ---
// Replaced wholesale in Task 4 with the real Modal-based component.
// Task 4 step 4.1 deletes this block before appending the real export.
export interface XPTooltipProps {
  visible: boolean;
  onClose: () => void;
  testID?: string;
}
export function XPTooltip(_props: XPTooltipProps) {
  return null;
}
```

- [ ] **Step 3.2 — Re-run tests**

```bash
pnpm --filter @ccc/ui test
```

Expected:

- **2/2 `XP_RULES` tests PASS** (count + delta contract).
- **6 `<XPTooltip />` tests FAIL** — but with assertion errors ("unable to find element with text …"), NOT module errors. The stub renders `null`, so labels/deltas/footer queries return undefined and the backdrop/`onClose` testID queries find nothing.

Narrow advancing failure — exactly the TDD shape canon mandates.

---

## Task 4 — Implement the `XPTooltip` component

**Files:** `packages/ui/src/XPTooltip.tsx` (replace the Task 3 stub block with the real component).

- [ ] **Step 4.1 — Delete the Task 3 stub + append the real component**

Delete the `// --- TEMPORARY stub …` block (`XPTooltipProps` interface + null-returning `XPTooltip`) added in Task 3.2. Append the imports + the real component below `XP_RULES`:

```tsx
import { BlurView } from 'expo-blur';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

export interface XPTooltipProps {
  visible: boolean;
  /** Fires on backdrop tap or Android back. */
  onClose: () => void;
  /** `${testID}-backdrop` is exposed on the dim layer. */
  testID?: string;
}

const FOOTER_DISCLAIMER =
  'XP não expira e não pode ser comprado. Premium dá um bônus único de +200 XP no momento da ativação.';

const ruleRowStyle: StyleProp<ViewStyle> = {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 10,
  borderBottomWidth: 1,
  borderBottomColor: garageTokens.surface.border,
};
const iconWrapStyle: StyleProp<ViewStyle> = {
  width: 32,
  height: 32,
  borderRadius: 8,
  marginRight: 12,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: garageTokens.surface.alt,
};
const deltaStyle = {
  color: garageTokens.brand.base,
  fontSize: 13,
  marginLeft: 8,
  fontWeight: '700' as const,
  fontVariant: ['tabular-nums'] as const,
};
const footerNoteStyle: StyleProp<ViewStyle> = {
  marginTop: 14,
  padding: 12,
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: garageTokens.surface.borderStrong,
  backgroundColor: garageTokens.surface.deep,
};

/**
 * XPTooltip — centered overlay with the 8 XP_RULES + dashed-bordered
 * footer disclaimer. **Centered card, NOT a bottom sheet** — canonical
 * deviation from Phase 1's `SheetShell` pattern (outline §2C.38).
 *
 * Backdrop stacks `expo-blur` `BlurView` (intensity 40, dark tint) UNDER
 * a 45%-black dim `Pressable` — keeps Phase 2 §2C.38 blur in scope.
 * Backdrop-tap dispatches `onClose`. Inner Pressable swallows card-taps
 * so they don't dismiss. Android hardware back fires
 * `Modal.onRequestClose`, also routed to `onClose`.
 *
 * Mobile-only (canon §12). SSR's `ProfileStatsWeb` never mounts this
 * component — the `?` renders static instead.
 *
 * Stateless — composer (chunk 39 `ProfileStats`) owns `visible`.
 */
export function XPTooltip({ visible, onClose, testID }: XPTooltipProps) {
  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
      {...(testID !== undefined ? { testID } : {})}
    >
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <Pressable
        accessibilityLabel="Fechar"
        accessibilityRole="button"
        onPress={onClose}
        {...(testID !== undefined ? { testID: `${testID}-backdrop` } : {})}
        style={{
          flex: 1,
          padding: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.45)',
        }}
      >
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 360,
            maxHeight: '80%',
            borderRadius: 18,
            borderWidth: 1,
            paddingTop: 18,
            paddingBottom: 16,
            paddingHorizontal: 16,
            backgroundColor: garageTokens.surface.sheet,
            borderColor: garageTokens.surface.border,
          }}
        >
          <Text style={{ color: '#F5F5F5', fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
            Como ganhar XP
          </Text>
          <Text style={{ color: '#C9C9CD', fontSize: 12, marginBottom: 14 }}>
            Suas ações na comunidade somam pontos.
          </Text>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 4 }}>
            {XP_RULES.map((rule) => {
              const Icon = rule.icon;
              return (
                <View key={rule.key} style={ruleRowStyle}>
                  <View style={iconWrapStyle}>
                    <Icon size={18} color={rule.iconColor} />
                  </View>
                  <Text style={{ flex: 1, color: '#F5F5F5', fontSize: 13 }}>{rule.label}</Text>
                  <Text style={deltaStyle}>+{rule.delta} XP</Text>
                </View>
              );
            })}
          </ScrollView>

          <View style={footerNoteStyle}>
            <Text style={{ color: '#C9C9CD', fontSize: 11, lineHeight: 16 }}>
              {FOOTER_DISCLAIMER}
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
```

Notes:

- Pressable-backdrop chrome mirrors `SheetShell.tsx:31-35` (same `accessibilityLabel="Fechar"`, role, idiom).
- `BlurView` is OUTSIDE the `Pressable` so taps land on the dim layer, not the blur. Both layers fill the modal via `StyleSheet.absoluteFill` / `flex: 1`.
- Inner `Pressable` with no-op `onPress` is the standard RN trick to stop outer-backdrop dismissal on card-taps. A `View` won't intercept.
- `accessibilityViewIsModal` mirrors `SheetShell` so screen readers trap focus.
- `fontVariant: ['tabular-nums']` aligns digits (`+1 XP` vs `+200 XP`). Convention: `BadgesSheet.tsx:137`.
- Footer copy lives in a module `const` — the contract test verifies the rendered string, not the export, on purpose. That guards against accidental edits.
- `expo-blur` is `deps.external` in the vitest config (Step 1.2); jsdom can't render the native `BlurView` but `external` means the import resolves and the component renders as a no-op host — does not break tests, and tests assert text/structure, not blur pixels.

- [ ] **Step 4.2 — Run tests; expect 8/8 PASS**

```bash
pnpm --filter @ccc/ui test
```

If the `onRequestClose` test fails, it's testID propagation: some `@testing-library/react-native` versions surface `Modal` differently. Fallback: query `getByA11yLabel('Fechar')` for the backdrop and restructure the request-close case to fire on the Modal host directly via `UNSAFE_root`. Investigate before patching the component.

- [ ] **Step 4.3 — Typecheck**

```bash
pnpm --filter @ccc/ui typecheck
```

Expected: clean. `LucideIcon` import path matches `BadgeGlyph.tsx`.

---

## Task 5 — Export from `index.ts`

**Files:** `packages/ui/src/index.ts` (MODIFY).

- [ ] **Step 5.1 — Append after the existing `BadgesSheet` export (current line 31)**

```ts
export { XPTooltip, XP_RULES, type XPTooltipProps, type XPRule } from './XPTooltip.js';
```

- [ ] **Step 5.2 — Re-verify**

```bash
pnpm --filter @ccc/ui typecheck
pnpm --filter @ccc/ui test
```

Expected: typecheck clean, 8/8 tests pass.

---

## Task 6 — Commit + PR

- [ ] **Step 6.1 — Commit**

```bash
git add packages/ui/src/XPTooltip.tsx \
        packages/ui/src/__tests__/XPTooltip.test.tsx \
        packages/ui/src/index.ts
git commit -m "feat(ui): add XPTooltip centered-overlay component with 8 XP rules"
```

- [ ] **Step 6.2 — Push + open PR (base `main`)**

```bash
git push -u origin feat/jdma-garage-phase2-38
gh pr create --base main \
  --title "feat(ui): XPTooltip centered-overlay component (chunk 38)" \
  --body "$(cat <<'EOF'
Chunk 38 — `XPTooltip` (`@ccc/ui`).

## Summary
- Centered-overlay component (NOT bottom sheet — outline §301 deviation).
- Local `XP_RULES` (8 entries) — single source of truth for user-facing XP copy. Awarder deltas mirrored from outline §437; drift guarded by contract test.
- Locked PT-BR dashed-bordered footer: "XP não expira e não pode ser comprado. Premium dá um bônus único de +200 XP no momento da ativação."
- First test harness in `@ccc/ui` (vitest + @testing-library/react-native).

## Deviations
- **No tween/scale-pop animation.** RN `Modal animationType="fade"` only. Tween/scale-pop is Phase 2D.
- **8-row mapping.** Outline §2C.38 mandates 8; outline §437 lists 10. Drop `post_like (revert)` (inverse op) + `admin_adjustment` (moderator-only). List all 3 badge rarities separately — preserves the `+25 / +50 / +100` ramp.
- **No `XPTooltip` in SSR.** Per canon §12, web `ProfileStatsWeb` renders `?` static; tooltip stays mobile-only.

## Test plan
- [x] `pnpm --filter @ccc/ui test` — 8/8
- [x] `pnpm --filter @ccc/ui typecheck` — clean
- [ ] Visual QA in chunk 40 (mobile owner integration) — out of scope here.

## Refs
- skeleton §"Chunk 38" (lines 430–448)
- outline §301, §437
EOF
)"
```

- [ ] **Step 6.3 — Confirm base is `main`**

```bash
gh pr view --json baseRefName
```

Expected `{"baseRefName":"main"}`. Never merge feature → `production`; per CLAUDE.md, `production` is updated only by local-board manual merge from `main`.

---

## Verification

```bash
pnpm --filter @ccc/ui typecheck
pnpm --filter @ccc/ui test
# Canon §15 cascade verification — MANDATORY.
pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/BadgesSheet.test.tsx
pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/CoverPickerSheet.test.tsx
```

All four must exit clean. The two mobile-barrel runs are the canon §15 cascade gate — failure on either means the `expo-blur` alias / stub in Task 1.5 didn't land correctly. Do **not** run the full repo sweep locally (`feedback_no_full_test_suite_locally`). Visual QA is deferred to chunk 40 (no Storybook/Snack scaffold in this repo).

---

## Test plan

File: `packages/ui/src/__tests__/XPTooltip.test.tsx`. **Total: 8 tests.**

1. `XP_RULES contains exactly 8 entries in the canonical order` — count + key order locked to outline §301.
2. `XP_RULES matches the awarder deltas at outline §437` — contract test; fails on either-side drift.
3. `<XPTooltip /> renders all 8 rule labels when visible` — visibility + label render; smoke for the row loop.
4. `<XPTooltip /> renders all 8 +N XP deltas when visible` — delta render + `+N XP` formatting.
5. `<XPTooltip /> renders the locked PT-BR footer disclaimer` — verbatim copy guard.
6. `<XPTooltip /> renders nothing when visible={false}` — Modal gates children on `visible`.
7. `<XPTooltip /> calls onClose when the backdrop is pressed` — backdrop-tap dismiss (AC).
8. `<XPTooltip /> calls onClose when Android back fires` — `Modal.onRequestClose` → `onClose` (AC).

---

## PR checklist

- [ ] Branched from fresh `main` (not `production`).
- [ ] `pnpm --filter @ccc/ui typecheck` clean.
- [ ] `pnpm --filter @ccc/ui test` — 8/8.
- [ ] No edits outside the 9 touched paths.
- [ ] `XP_RULES` order matches outline §437 top-to-bottom.
- [ ] Footer disclaimer matches outline §2C.38 verbatim.
- [ ] `expo-blur` peer + devDep declared in `packages/ui/package.json`.
- [ ] `pnpm-lock.yaml` diff staged + limited to `expo-blur` + 5 test devDeps.
- [ ] `lucide-react-native` test stub present in `packages/ui/test-stubs/` (canon §13).
- [ ] `expo-blur` test stub present in `apps/mobile/test-stubs/` + alias in `apps/mobile/vitest.config.ts` (canon §15).
- [ ] `BadgesSheet.test.tsx` + `CoverPickerSheet.test.tsx` PASS from the chunk worktree (canon §15 cascade gate).
- [ ] No animation code (Phase 2D defer noted).
- [ ] `admin_adjustment` NOT in `XP_RULES` (per §C8).
- [ ] PR base ref is `main`.

---

## Deviations / deferrals

1. **Backdrop blur** → IN SCOPE this chunk via `expo-blur` `BlurView` + 45%-black dim. Earlier draft dropped blur; that deviation was not authorized by §C1–C14, reverted to spec per Phase 2 plan review.
2. **Animation** → only RN `Modal animationType="fade"`. Tween/scale-pop is Phase 2D.
3. **SSR variant** → chunk 41; default static `?` with no overlay (skeleton line 51). Canon §12: `XPTooltip` is mobile-only.
4. **Badge-tier collapse** → not done. 3 separate rows preserve the rarity-ramp signal.

---

## Self-review

- [x] **Spec coverage:** every skeleton AC (centered card / 8 rules / dashed footer / backdrop dismiss / esc-back dismiss / backdrop blur) maps to a task + a test.
- [x] **Placeholder scan:** all code blocks are complete; no TBD / hand-waved tests.
- [x] **Type consistency:** `XPRule.key` literal-union matches `XP_RULES` rows exactly (verified by test #1). `XPTooltipProps` shape stable across the Task 3 stub, Task 4 real component, and the future chunk 39 wrapper.
- [x] **Single source of truth:** `XP_RULES` lives in `@ccc/ui` per the hard rule (UI copy stays out of `@ccc/shared`). Server-deltas drift guarded by test #2.
- [x] **Canon §12:** `XPTooltip` mobile-only; SSR has no overlay — documented in arch + deviations + component JSDoc.
- [x] **Canon §13:** `pnpm-lock.yaml` + `packages/ui/package.json` in touched paths; `lucide-react-native` test stub mirrors `apps/mobile/test-stubs/lucide-react-native.tsx`.
- [x] **Failing-test sequencing:** Task 3 ships a `null`-returning `XPTooltip` stub so 2 rules tests PASS + 6 component tests FAIL with assertion errors (not module errors). Task 4 deletes the stub then appends the real component.
- [x] **Branch safety:** Step 0 + Step 6.3 enforce CLAUDE.md preflight + PR-base check.
