# Chunk 37 — `StatsRow` component (`@ccc/ui`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `<StatsRow />` in `@ccc/ui`: a pure-presentational 4-column tile grid (`Eventos · Posts · Curtidas · Desde`) consuming a `GarageStats` prop. Numeric tiles render mono digits, the date tile renders sans 13px with a PT-BR abbreviated month string (`fev. 26` style).

**Architecture:** One new RN component file in `packages/ui/src/`, one new test in the mobile workspace's vitest tree (where the other `@ccc/ui` mobile tests already live — `packages/ui` has no test runner of its own, see `BadgeRow.test.tsx` for the precedent). Export added to `packages/ui/src/index.ts`. Zero state, zero context, zero side effects. The date string is computed in a tiny pure helper colocated in the same file and exported for direct unit testing.

**Tech Stack:** TypeScript, React Native (`View`, `Text`), `lucide-react-native` (icons via `@ccc/ui` `BadgeGlyph`), `@ccc/ui/garage-tokens`, `@ccc/shared/garage-progress` (consumes `GarageStats` from chunk 24). Tests: Vitest + jsdom + the existing `react-native` / `lucide-react-native` jsdom mocks from `apps/mobile/src/screens/garage/__tests__/BadgeRow.test.tsx`.

**Spec references (read once, do not copy):**

- `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 37" — chunk contract.
- `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`:
  - §"Corrections applied 2026-05-21 post-review" (§C1–§C14) — read FIRST. §C4 is informational only for this leaf (likesReceived is a column-backed number; this chunk renders it as received).
  - §"Locked invariants" — public hide-on-empty is owned by `ProfileStats` (chunk 39), not this leaf.
  - §"Phase 2C — UI" / chunk 2C.37 (around line 300) — visual canon: 4-col grid, 12px radius, icon + mono number + uppercase mono label, "Desde" uses sans 13px with `'fev. 26'` PT-BR style.
  - §"`GarageStats`" (around line 395) — wire shape `{ events, posts, likesReceived, joinedAt: ISO string }`.
- `docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` §"File Structure" + §C12 — `@ccc/ui` conventions: pure-prop RN, JSDoc on the public component, design-canon link, no default exports.
- `CLAUDE.md` — branch safety preflight; PR to `main` only.
- Design canon `.handoffs/xp-handoff/design_handoff_garage_redesign_xp_delta/jdma-garage/progress.jsx` lines 464–541.
- Tone references: `packages/ui/src/BadgeRow.tsx`, `packages/ui/src/BadgeGlyph.tsx`, `apps/mobile/src/screens/garage/__tests__/BadgeRow.test.tsx` (mirror its `vi.mock` blocks verbatim).

---

## Scope

**In scope:**

- New file `packages/ui/src/StatsRow.tsx` exporting:
  - `StatsRow` — RN component (named export, no default).
  - `StatsRowProps` — public TS interface (also named).
  - `formatJoinedAt(iso: string): string` — pure helper. Exported only so the test can exercise it directly without rendering the tree. Marked as not part of the stable surface in JSDoc.
- New test `apps/mobile/src/screens/garage/__tests__/StatsRow.test.tsx`.
- Re-export from `packages/ui/src/index.ts` (`StatsRow` + `StatsRowProps`).

**Out of scope (covered elsewhere):** killswitch gate + public hide-on-empty (both chunk 39 wrapper), API payload wiring (chunk 28), `GarageStats` zod + type (chunk 24 owns it; per dependency graph this chunk's branch sees it when it opens from fresh `main`; otherwise fall back to inline local type per Task 1 / §"Deviations").

**Corrections that apply:** §C4 informational only (this leaf renders `stats.likesReceived` as received). No other §C overrides touch this chunk.

## Corrections (post-review 2026-05-24, phase2-plan-review)

Two MAJOR findings were raised against this plan; both fixed in place.

- **Canon §13 (MAJOR — UI test harness):** the original RN mock block omitted `ActivityIndicator`, `Image`, `Modal`, `ScrollView`, and the entire `react-native-svg` block. Importing `@ccc/ui` pulls in components (BadgesSheet, HexBadge, etc.) that touch these symbols at module-eval time, so the tests could explode before reaching `StatsRow`. Task 1 / Step 1.1 now mirrors `apps/mobile/src/screens/garage/__tests__/BadgeRow.test.tsx` verbatim for the RN + `react-native-svg` mock surface, with `Platform` retained on top for `Platform.select`. `lucide-react-native` mock kept (same Phase 1 pattern).
- **Canon §10 (MAJOR — filtered package commands):** every `pnpm --filter @ccc/mobile test -- apps/mobile/src/...` instance passed a repo-root path through `--`; the mobile script runs from `apps/mobile`, so vitest saw zero matching tests and exited 0 with `--passWithNoTests` masking the gap. All six command instances (Steps 1.2, 1.5, 2.2, 3.2, 4.1, and the PR checklist) now use `pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/StatsRow.test.tsx --passWithNoTests [-t <pattern>]`, package-root-relative.

---

## File structure

```
packages/ui/src/StatsRow.tsx                                          (NEW)
packages/ui/src/index.ts                                              (MODIFY — add export line)
apps/mobile/src/screens/garage/__tests__/StatsRow.test.tsx            (NEW)
```

Touched-paths only. No edits to `apps/admin`, `apps/api`, `packages/db`, `packages/shared`, `garage-tokens.ts`, or other `@ccc/ui` files. **No web twin in this chunk** — chunk 41 consumes `ProfileStats` (chunk 39), which is the surface-agnostic wrapper; the SSR/web port lands there.

---

## Branch + preflight

- [ ] **Step 0: Branch preflight** (CLAUDE.md "Branch safety preflight")

```bash
git branch --show-current
```

If output is `production`, STOP. Otherwise:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-37
```

---

## Component contract (locked before any code)

Props (TS interface — final shape; tasks below assume this signature without re-stating it):

```ts
import type { GarageStats } from '@ccc/shared/garage-progress';

export interface StatsRowProps {
  /** Wire shape from `garage.stats` per outline §395. */
  stats: GarageStats;
  /** Optional RN testID for parent test selectors. */
  testID?: string;
}
```

Render contract (Task 3 carries the exact style objects; this section locks intent):

- Outer `<View>`: `flexDirection: 'row'`, 4 children, `gap: 8`, `marginTop: 10`. `flex: 1` per tile in lieu of CSS grid.
- Per-tile `<View>`: 12px `borderRadius`, 1px `garageTokens.surface.border`, `garageTokens.surface.sheet` background, `paddingTop: 10` / `paddingBottom: 9` / `paddingHorizontal: 8`, column flex, centered, 3px inner gap.
- Per-tile children: icon (14px Lucide via `BadgeGlyph`), value `<Text>`, label `<Text>`.
- Value styling: numeric tiles use mono (`Platform.select({ ios: 'Menlo', android: 'monospace' })`) 17/700/letterSpacing -0.4. The "Desde" tile drops the `fontFamily` override (system sans) at 13/700/letterSpacing -0.1.
- Label styling: mono 9, letterSpacing 0.8, `textTransform: 'uppercase'`, `#8A8A93`. Renderer also uppercases the literal string so the DOM-mock layer matches the visual layer.
- Tile order is fixed: Eventos, Posts, Curtidas, Desde. The renderer iterates an internal `const tiles` array — never `Object.keys` / `Object.entries`.
- Icons (via `BadgeGlyph`'s `ICON_MAP`): Eventos → `'flag'`, Posts → `'post'`, Curtidas → `'fire'`, Desde → `'pin'`. Matches design canon lines 474–477.
- Numeric values render via `String(value)`. NO thousand-separator (matches design canon — `{it.value}` raw, no `toLocaleString`). Locked as a deliberate deviation candidate so reviewers see it.
- `joinedAt` → `formatJoinedAt(stats.joinedAt)` returns `'fev. 26'`-shaped output. Locale `'pt-BR'`, `timeZone: 'UTC'` (so a midnight-UTC ISO never shifts month east of UTC), `formatToParts` to drop the locale-default `' de '` literal between month and year. Invalid input → `''`.

Reference (tone-only, do not copy): `packages/ui/src/BadgeRow.tsx` lines 78–115 (outer container patterns), `packages/ui/src/BadgeGlyph.tsx` (icon resolver — falls back to `HelpCircle` on unknown, so the four icons we pass are safe).

---

## Task 1 — Helper `formatJoinedAt`

**Files:**

- Create (initial scaffold): `packages/ui/src/StatsRow.tsx`
- Create (test file): `apps/mobile/src/screens/garage/__tests__/StatsRow.test.tsx`

Goal: drive the date formatter under test first. The component file in this task only exposes the helper; the JSX comes in Task 3.

- [ ] **Step 1.1: Write the failing test file (helper-only block)**

```tsx
// @vitest-environment jsdom
//
// StatsRow tests. The component lives in `packages/ui/src/StatsRow.tsx`, but
// tests live here so the mobile workspace's vitest picks them up — `@ccc/ui`
// has no test runner of its own (verified via packages/ui/package.json).
// Same mocking pattern as BadgeRow.test.tsx.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Mirror BadgeRow.test.tsx — keep the mock list aligned.
import { vi } from 'vitest';

// Mirror the Phase 1 reference `apps/mobile/src/screens/garage/__tests__/BadgeRow.test.tsx`
// RN mock block verbatim. Importing `@ccc/ui` also pulls in components that
// touch `ActivityIndicator`, `Image`, `Modal`, and `ScrollView` (BadgesSheet
// et al), so we MUST mock them here or the import-time evaluation crashes
// before any StatsRow assertion fires. `Platform` is added on top of the
// Phase 1 list because StatsRow itself calls `Platform.select` for mono font.
vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityHint,
        accessibilityRole,
        accessibilityState,
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        source,
        accessible,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityHint === 'string') aria['aria-description'] = accessibilityHint;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      const disabledFlag =
        accessibilityState &&
        typeof accessibilityState === 'object' &&
        (accessibilityState as { disabled?: boolean }).disabled === true;
      if (disabledFlag) aria['aria-disabled'] = 'true';
      if (typeof className === 'string') aria['data-classname'] = className;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void hitSlop;
      void numberOfLines;
      void source;
      void accessible;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ActivityIndicator: make('span'),
    Modal: make('div'),
    ScrollView: make('div'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
    Platform: {
      select: (o: { ios?: string; android?: string; default?: string }) =>
        o.ios ?? o.default ?? 'monospace',
      OS: 'ios',
    },
  };
});

// `@ccc/ui` re-exports components that pull `react-native-svg` (HexBadge,
// BadgesSheet). The Phase 1 reference test mocks the same surface; copy it
// verbatim so importing `@ccc/ui` does not blow up at module-eval time.
vi.mock('react-native-svg', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { ...rest } = props;
      return ReactMod.createElement(tag, { ref, ...rest });
    });
  return {
    default: make('svg'),
    Svg: make('svg'),
    Defs: make('defs'),
    Pattern: make('pattern'),
    Rect: make('rect'),
    Line: make('line'),
    G: make('g'),
    Polygon: make('polygon'),
    Path: make('path'),
  };
});

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const make = (label: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { color, size, strokeWidth, ...rest } = props;
      void color;
      void size;
      void strokeWidth;
      return ReactMod.createElement('i', { ref, 'data-icon': label, ...rest });
    });
  // The four icons StatsRow uses go through `BadgeGlyph`'s ICON_MAP, which
  // imports MapPin / Flag / Flame / MessageSquare. Mirror BadgeRow.test.tsx
  // export list so the resolver does not blow up on unrelated lookups.
  return {
    Car: make('Car'),
    CheckSquare: make('CheckSquare'),
    Crown: make('Crown'),
    Flag: make('Flag'),
    Flame: make('Flame'),
    HelpCircle: make('HelpCircle'),
    Home: make('Home'),
    Library: make('Library'),
    Lock: make('Lock'),
    MapPin: make('MapPin'),
    Medal: make('Medal'),
    MessageCircle: make('MessageCircle'),
    MessageSquare: make('MessageSquare'),
    ShieldCheck: make('ShieldCheck'),
    TrendingUp: make('TrendingUp'),
  };
});

describe('formatJoinedAt', () => {
  it('formats a UTC ISO date to "<mês>. <YY>" PT-BR style', async () => {
    const { formatJoinedAt } = await import('@ccc/ui');
    expect(formatJoinedAt('2026-02-14T00:00:00Z')).toBe('fev. 26');
  });

  it('always uses PT-BR regardless of host locale (no en-US fallback)', async () => {
    const { formatJoinedAt } = await import('@ccc/ui');
    // March → "mar." in pt-BR; "Mar" in en-US. Assert PT-BR shape.
    expect(formatJoinedAt('2025-03-01T12:00:00Z')).toBe('mar. 25');
  });

  it('uses UTC so a midnight-UTC ISO never shifts month for east-of-UTC hosts', async () => {
    const { formatJoinedAt } = await import('@ccc/ui');
    expect(formatJoinedAt('2026-02-01T00:00:00Z')).toBe('fev. 26');
  });

  it('returns "" for invalid input', async () => {
    const { formatJoinedAt } = await import('@ccc/ui');
    expect(formatJoinedAt('not-a-date')).toBe('');
  });
});
```

- [ ] **Step 1.2: Run the test — expect FAIL ("formatJoinedAt is not exported")**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/StatsRow.test.tsx --passWithNoTests -t formatJoinedAt`
Expected: all 4 cases FAIL with `TypeError: formatJoinedAt is not a function` (or import error). Note: package-root-relative path (canon §10); the filtered script runs from `apps/mobile`.

- [ ] **Step 1.3: Implement `formatJoinedAt` in a new `StatsRow.tsx` (stub component)**

```tsx
import type { GarageStats } from '@ccc/shared/garage-progress';

/** See §"Component contract" for locale + UTC rationale. Exported only for direct unit testing. */
export function formatJoinedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(d);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  if (!month || !year) return '';
  return `${month} ${year}`;
}

// Component arrives in Task 3.
export interface StatsRowProps {
  stats: GarageStats;
  testID?: string;
}
export function StatsRow(_props: StatsRowProps): null {
  return null;
}
```

- [ ] **Step 1.4: Add the export line to `packages/ui/src/index.ts`**

```ts
export { StatsRow, formatJoinedAt, type StatsRowProps } from './StatsRow.js';
```

Insert directly below the `BadgesSheet` export so all garage-redesign-related exports stay clustered (matches the existing ordering convention).

- [ ] **Step 1.5: Run the helper tests — expect PASS**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/StatsRow.test.tsx --passWithNoTests -t formatJoinedAt`
Expected: 4 passed.

If chunk 24 (`@ccc/shared/garage-progress`) has not yet merged, the import in `StatsRow.tsx` will not resolve. Fallback: inline the type as a local `type GarageStats = { events: number; posts: number; likesReceived: number; joinedAt: string };` declaration with a `// TODO(chunk-24): swap for @ccc/shared/garage-progress export` comment. Replace the local type with the real import in the same PR once chunk 24 is on `main`.

- [ ] **Step 1.6: Commit**

```bash
git add packages/ui/src/StatsRow.tsx packages/ui/src/index.ts apps/mobile/src/screens/garage/__tests__/StatsRow.test.tsx
git commit -m "feat(ui): formatJoinedAt helper for StatsRow"
```

---

## Task 2 — Failing component tests

**Files:**

- Modify: `apps/mobile/src/screens/garage/__tests__/StatsRow.test.tsx`

Now add the `describe('StatsRow', …)` block. Tests assert the four visible behaviors from the chunk skeleton:

1. Renders 4 tiles in fixed order (Eventos, Posts, Curtidas, Desde).
2. Zero values render as `'0'` (never blank, never `'undefined'`).
3. Large numeric values render raw (no thousand-separator) — locks the rendering rule.
4. `joinedAt` formats to `'fev. 26'` style via `formatJoinedAt` (component path).
5. PT-BR locale enforced on the date tile.
6. One icon renders per tile (the four `data-icon` attributes survive the mock).

- [ ] **Step 2.1: Append the component-block tests**

```tsx
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('StatsRow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderEl = async (el: React.ReactElement) => {
    await act(async () => {
      root.render(el);
      await flush();
    });
  };

  const STATS_NONZERO = {
    events: 7,
    posts: 12,
    likesReceived: 42,
    joinedAt: '2026-02-14T00:00:00Z',
  };

  const STATS_ZERO = {
    events: 0,
    posts: 0,
    likesReceived: 0,
    joinedAt: '2026-02-14T00:00:00Z',
  };

  it('renders 4 tiles in order: Eventos, Posts, Curtidas, Desde', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} />);
    const labels = Array.from(container.querySelectorAll('span'))
      .map((s) => s.textContent ?? '')
      .filter((t) => /^(EVENTOS|POSTS|CURTIDAS|DESDE)$/.test(t));
    expect(labels).toEqual(['EVENTOS', 'POSTS', 'CURTIDAS', 'DESDE']);
  });

  it('renders zero values as "0" (never blank, never "undefined")', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_ZERO} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('undefined');
    // The first three tiles must each render a literal "0" value.
    const zeros = Array.from(container.querySelectorAll('span')).filter(
      (s) => (s.textContent ?? '').trim() === '0',
    );
    expect(zeros.length).toBeGreaterThanOrEqual(3);
  });

  it('renders numeric values raw with no thousand-separator (PT-BR `.` not inserted)', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(
      <StatsRow stats={{ ...STATS_NONZERO, events: 1234, posts: 5678, likesReceived: 9012 }} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('1234');
    expect(text).toContain('5678');
    expect(text).toContain('9012');
    expect(text).not.toContain('1.234');
    expect(text).not.toContain('5.678');
  });

  it('formats joinedAt to "fev. 26" PT-BR abbreviated month', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} />);
    expect(container.textContent ?? '').toContain('fev. 26');
  });

  it('uses PT-BR locale on the date tile (never en-US "Feb")', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} />);
    expect(container.textContent ?? '').not.toMatch(/Feb\b/);
  });

  it('renders one icon per tile (flag, post, fire, pin via BadgeGlyph)', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} />);
    const icons = Array.from(container.querySelectorAll('i[data-icon]')).map((n) =>
      n.getAttribute('data-icon'),
    );
    // ICON_MAP: flag → Flag, post → MessageSquare, fire → Flame, pin → MapPin.
    expect(icons).toEqual(['Flag', 'MessageSquare', 'Flame', 'MapPin']);
  });

  it('forwards testID to the outer container', async () => {
    const { StatsRow } = await import('@ccc/ui');
    await renderEl(<StatsRow stats={STATS_NONZERO} testID="garage-stats-row" />);
    expect(container.querySelector('[data-testid="garage-stats-row"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2.2: Run the new tests — expect FAIL**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/StatsRow.test.tsx --passWithNoTests -t StatsRow`
Expected: 7 FAILs. `StatsRow` currently returns `null` so no tiles, no labels, no icons. Confirm each failure points at a missing label / icon / testID.

---

## Task 3 — Implement `StatsRow` JSX

**Files:**

- Modify: `packages/ui/src/StatsRow.tsx` (replace the stub `StatsRow` from Task 1)

- [ ] **Step 3.1: Replace the stub with the real implementation**

```tsx
import type { GarageStats } from '@ccc/shared/garage-progress';
import { Platform, Text, View } from 'react-native';

import { BadgeGlyph } from './BadgeGlyph.js';
import { garageTokens } from './garage-tokens.js';

export function formatJoinedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(d);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  if (!month || !year) return '';
  return `${month} ${year}`;
}

export interface StatsRowProps {
  stats: GarageStats;
  testID?: string;
}

type Tile =
  | { kind: 'num'; label: string; icon: string; value: number }
  | { kind: 'date'; label: string; icon: string; value: string };

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const tileBoxStyle = {
  flex: 1,
  backgroundColor: garageTokens.surface.sheet,
  borderWidth: 1,
  borderColor: garageTokens.surface.border,
  borderRadius: 12,
  paddingTop: 10,
  paddingBottom: 9,
  paddingHorizontal: 8,
  alignItems: 'center' as const,
  gap: 3,
} as const;

const numValueStyle = {
  fontFamily: MONO,
  fontWeight: '700' as const,
  fontSize: 17,
  letterSpacing: -0.4,
  lineHeight: 17,
  color: '#F5F5F5',
} as const;

const dateValueStyle = {
  fontWeight: '700' as const,
  fontSize: 13,
  letterSpacing: -0.1,
  lineHeight: 13,
  color: '#F5F5F5',
} as const;

const labelStyle = {
  fontFamily: MONO,
  fontSize: 9,
  letterSpacing: 0.8,
  color: '#8A8A93',
  textTransform: 'uppercase' as const,
} as const;

/**
 * StatsRow — 4-tile strip (Eventos · Posts · Curtidas · Desde). Pure-prop;
 * killswitch + public hide-on-empty live on `ProfileStats` (chunk 39).
 * Visual canon: `.handoffs/xp-handoff/.../jdma-garage/progress.jsx` lines
 * 464–541. RN port uses `flex: 1` per tile in place of CSS grid.
 */
export function StatsRow({ stats, testID }: StatsRowProps) {
  const tiles: Tile[] = [
    { kind: 'num', label: 'Eventos', icon: 'flag', value: stats.events },
    { kind: 'num', label: 'Posts', icon: 'post', value: stats.posts },
    { kind: 'num', label: 'Curtidas', icon: 'fire', value: stats.likesReceived },
    { kind: 'date', label: 'Desde', icon: 'pin', value: formatJoinedAt(stats.joinedAt) },
  ];

  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }} testID={testID}>
      {tiles.map((t) => (
        <View key={t.label} style={tileBoxStyle}>
          <View style={{ marginBottom: 2 }}>
            <BadgeGlyph name={t.icon} size={14} color="#8A8A93" />
          </View>
          <Text style={t.kind === 'date' ? dateValueStyle : numValueStyle}>
            {t.kind === 'date' ? t.value : String(t.value)}
          </Text>
          <Text style={labelStyle}>{t.label.toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
}
```

Implementation notes: `textTransform: 'uppercase'` AND uppercasing the literal at render time is intentional — `textTransform` is a CSS prop the jsdom mock cannot apply to text content, so the assertion path needs the literal. The mobile runtime applies both layers consistently. `Platform.select` carries a `default` branch so the test environment (mock returns `'monospace'`) resolves cleanly. The outer `<View>` carries no `marginHorizontal`; `ProfileStats` (chunk 39) owns horizontal margins.

- [ ] **Step 3.2: Run all StatsRow tests — expect PASS**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/StatsRow.test.tsx --passWithNoTests`
Expected: 11 passed (4 helper + 7 component).

- [ ] **Step 3.3: Typecheck `@ccc/ui`**

Run: `pnpm --filter @ccc/ui typecheck`
Expected: 0 errors. If chunk 24 is not merged, expect `Cannot find module '@ccc/shared/garage-progress'` and fall back to the inline-type stub described in Task 1.

- [ ] **Step 3.4: Typecheck the mobile workspace (catches the export wiring)**

Run: `pnpm --filter @ccc/mobile typecheck`
Expected: 0 errors.

- [ ] **Step 3.5: Commit**

```bash
git add packages/ui/src/StatsRow.tsx apps/mobile/src/screens/garage/__tests__/StatsRow.test.tsx
git commit -m "feat(ui): StatsRow 4-tile component for garage profile"
```

---

## Task 4 — Verification sweep

- [ ] **Step 4.1: Targeted vitest run**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/StatsRow.test.tsx --passWithNoTests`
Expected: 11 passed, 0 failed.

- [ ] **Step 4.2: `@ccc/ui` typecheck**

Run: `pnpm --filter @ccc/ui typecheck`
Expected: clean.

- [ ] **Step 4.3: Confirm no other workspace was disturbed**

```bash
git status
git diff --stat origin/main
```

Expected: exactly three files in the diff:

- `packages/ui/src/StatsRow.tsx`
- `packages/ui/src/index.ts`
- `apps/mobile/src/screens/garage/__tests__/StatsRow.test.tsx`

If any other path appears (especially `pnpm-lock.yaml`, `packages/shared/*`, `apps/admin/*`), revert it.

---

## Deviations / deferrals (document in PR body)

- **No thousand-separator.** Values render raw (`1234`, not `1.234`). Matches design canon. If product wants PT-BR `.`, swap to `value.toLocaleString('pt-BR')` and update test 3.
- **Date format `'fev. 26'` (period preserved, single space before year).** PT-BR `Intl.DateTimeFormat({ month: 'short' })` emits `'fev.'`; we keep the period and replace the locale `' de '` literal with a single space. Design canon `progress.jsx` strips the period; chunk skeleton + outline §300 explicitly call for the period.
- **Web twin deferred.** Skeleton says "Possibly a web twin." Chunk 41 imports `ProfileStats` (chunk 39); any DOM rendering falls to the wrapper. RN-only here.
- **No animation.** Matches §300 + the open-question default. Numbers hard-set on prop change.
- **Inline-type fallback for `GarageStats`.** If chunk 24 has not merged when this PR opens, declare a local type matching outline §395 and swap to `@ccc/shared/garage-progress` in the same PR before merge.
- **Test harness mirrors Phase 1 BadgeRow.** Post-review fix (canon §13): the test file copies the `react-native` (incl. `ActivityIndicator`, `Image`, `Modal`, `ScrollView`) + `react-native-svg` + `lucide-react-native` mock surface from `apps/mobile/src/screens/garage/__tests__/BadgeRow.test.tsx`, with `Platform` retained on top so `Platform.select` resolves to `'monospace'` in jsdom. Document in PR body so reviewers see the harness alignment.
- **Filtered vitest commands use `exec vitest run` with package-root-relative paths.** Post-review fix (canon §10): `pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/StatsRow.test.tsx --passWithNoTests [-t <pattern>]`. Never `pnpm --filter @ccc/mobile test -- apps/mobile/src/...` (the `--` strips through the script and the repo-root path resolves to zero matches; `--passWithNoTests` then exits 0 silently).

No §C correction is overridden by this chunk.

---

## PR checklist

- [ ] Branch `feat/jdma-garage-phase2-37` opened from fresh `main` (never `production`).
- [ ] Three files in the diff (see Step 4.3). No incidental changes (no `pnpm-lock.yaml`, no other workspaces).
- [ ] `pnpm --filter @ccc/ui typecheck` clean.
- [ ] `pnpm --filter @ccc/mobile exec vitest run src/screens/garage/__tests__/StatsRow.test.tsx --passWithNoTests` → 11/11 green.
- [ ] PR body lists the five deviations from §"Deviations / deferrals" so reviewers see them up front.
- [ ] PR opens against `main`. Do NOT push to `production`.
- [ ] If `@ccc/shared/garage-progress` was stubbed locally, the stub is removed before merge AND the PR body links chunk 24.
- [ ] PR title references chunk number (`Chunk 37 — StatsRow component`) and links the skeleton.

---

## Self-review summary

- **Spec coverage.** All six skeleton acceptance criteria mapped to tests (4-tile order, zero-defaults, raw numeric rendering, sans date with PT-BR locale, icon per tile, testID forwarding). Outline §300 visual canon → RN style objects in Task 3. §395 wire shape consumed as the prop type.
- **Placeholders.** None — every step has runnable code or an exact command.
- **Type consistency.** `StatsRowProps`, `formatJoinedAt`, `StatsRow` names stable across export, tests, and JSDoc. `GarageStats` is the single source for the prop shape (inline fallback documented only for chunk 24 ordering).
- **Locale.** PT-BR locked; tests assert the absence of en-US `Feb`.
