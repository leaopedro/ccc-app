# Chunk 41 — Public SSR Integration (`apps/admin/app/g/[slug]`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a server-rendered ProfileStats block (XP scoreboard + 4-tile stats row + inert `?` button) on the SSR public garage page at `/g/:slug`, slotted between the IdentityCard section and the BadgeRow. Hide-on-empty (missing payload OR all-zero metrics) + killswitch-off both render nothing. The `?` is a static `<span>` — no overlay, no client JS in v1.

**Architecture:** Phase 1 chunk 13 owns the SSR page (`apps/admin/app/g/[slug]/page.tsx`) and its composition (`apps/admin/src/components/public-garage-view.tsx`). This chunk extends the composition to accept `progress` + `stats` + `gamificationEnabled` from chunk-28's response top-level fields, gates by `data.gamification.enabled` (response top-level per canon §1 / §C10), and adds three SSR-safe web twins (`XPScoreboardWeb`, `StatsRowWeb`, `ProfileStatsWeb`) under `packages/ui/src/web/` — same pattern Phase 1 chunk 21 used for `BadgeRow`. Phase 2D may replace the static `?` with a client-island.

**Tech Stack:** Next.js 16 App Router (server components), `@jdm/ui/web` subpath (HTML + Tailwind, no React Native), `@jdm/shared/garage-progress` zod types, `renderToStaticMarkup` for unit tests, Vitest in `@jdm/admin` + `@jdm/ui`.

---

## Required reading

1. `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 41" (lines 494–513) + §"Open questions" #2 (line 51 — SSR tooltip default: **static `?`, no overlay**).
2. `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` §C1–C14 first; then specifically:
   - §"Locked invariants" #2 (line 28) — hide-on-empty on public (any-zero-metric variant per §C10).
   - §"Phase 2C — UI" line 304 — chunk 2C.41 outline.
   - §"Killswitch" (lines 502–515) — SSR renders nothing when off.
   - §"Open questions" #3 (line 563) — static `?` locked.
   - §C5 / §C9 / §C10 / §C14 (cited inline below).
3. `docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` Chunk 13 (lines 4245+) — SSR page structure; chunk 21 (lines 5295–5305) — BadgeRow web-twin pattern.
4. `/tmp/phase2-fix-canon.md` §1 — `gamification.enabled` lives at the **response top-level**, NOT nested under `garage`. §2 — hide-on-empty rule. §12 — SSR has no tooltip overlay; web `?` is static.
5. `docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-28-route-payloads-progress-stats.md` §"Files touched" + §"Deviations" — `progress` + `stats` + `gamification` all land at response top-level, siblings of `garage`.
6. `apps/admin/CLAUDE.md` + `apps/admin/AGENTS.md` — "This is NOT the Next.js you know."
7. `CLAUDE.md` — branch preflight + git flow + touched-paths-only test scopes.

---

## Pre-flight checklist (before Task 1)

- [ ] **PF-1: Branch safety** — `git branch --show-current` must NOT be `production`. If it is, `git checkout main && git pull --ff-only origin main` first.

- [ ] **PF-2: Confirm upstream chunks merged**

```bash
ls packages/shared/src/garage-progress.ts \
   packages/ui/src/ProfileStats.tsx \
   packages/ui/src/XPScoreboard.tsx \
   packages/ui/src/StatsRow.tsx
grep -n "garageProgressSchema.optional\|garageStatsSchema.optional" \
   packages/shared/src/garage.ts packages/shared/src/garage-public.ts
```

Expected: all four files exist; both grep targets return `optional` matches. If any is missing, STOP — finish the upstream chunk (24 / 28 / 36 / 37 / 39).

- [ ] **PF-3: Verify `gamification.enabled` placement (canon §1 / §C10)**

```bash
grep -n "gamification" packages/shared/src/garage.ts packages/shared/src/garage-public.ts
```

Expected: `gamification: z.object({ enabled: z.boolean() })` appears at the **response top-level** of both `garageReadSchema` (owner) and `garagePublicResponseSchema` (public), as a sibling of `garage` / `progress` / `stats`. If `gamification` is ONLY nested under `garage`, chunk 24 + 28 drifted from canon §1 — STOP and reconcile with the chunk-24 / chunk-28 fix agents. Do NOT paper over locally; canon §1 wins.

- [ ] **PF-4: Verify chunk 28 ships `progress` + `stats` at response top-level**

```bash
grep -n "progress: garageProgressSchema\|stats: garageStatsSchema" \
   packages/shared/src/garage.ts packages/shared/src/garage-public.ts
```

Expected: both schemas have `progress` + `stats` as `.optional()` siblings of `garage` (and `gamification`). If nested under the profile schemas instead, chunks 24 + 28 drifted — STOP and reconcile.

- [ ] **PF-5: Create branch from fresh `main`**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-41
```

---

## Files touched

| Path                                                              | Action | Responsibility                                                                                               |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `packages/ui/src/web/XPScoreboardWeb.tsx`                         | Create | HTML+Tailwind twin of `XPScoreboard.tsx` (chunk 36). Inert `?` `<span>` (no onClick).                        |
| `packages/ui/src/web/StatsRowWeb.tsx`                             | Create | HTML+Tailwind twin of `StatsRow.tsx` (chunk 37). 4-tile grid. PT-BR `joinedAt` formatter.                    |
| `packages/ui/src/web/ProfileStatsWeb.tsx`                         | Create | Composite twin of `ProfileStats.tsx` (chunk 39). Owns hide-on-empty + killswitch gate. Public-mode only.     |
| `packages/ui/src/web/index.ts`                                    | Modify | Export the three new twins.                                                                                  |
| `packages/ui/src/web/__tests__/profile-stats-web.test.tsx`        | Create | Twin unit tests (gate logic + static `?`).                                                                   |
| `apps/admin/src/components/public-garage-view.tsx`                | Modify | Accept `progress?` + `stats?` props; render `<ProfileStatsWeb />` between identity section + `<BadgeRow />`. |
| `apps/admin/app/g/[slug]/page.tsx`                                | Modify | Forward `data.progress` + `data.stats` into `<PublicGarageView />`.                                          |
| `apps/admin/src/components/__tests__/public-garage-view.test.tsx` | Modify | Extend with the 7 SSR integration specs.                                                                     |

**Do NOT touch:** any API route, any RN component, any non-Phase-2-XP file, `apps/admin/src/lib/public-garage.ts` (the zod parse already accepts the new optional fields via chunk 24).

---

## Code shape (final state — reference, not copy-paste)

### `packages/ui/src/web/XPScoreboardWeb.tsx`

```tsx
import type { GarageProgress } from '@jdm/shared/garage-progress';

export type XPScoreboardWebProps = { progress: GarageProgress };

export function XPScoreboardWeb({ progress }: XPScoreboardWebProps) {
  const pct =
    progress.tierSpan > 0 ? Math.min(100, (progress.xpInTier / progress.tierSpan) * 100) : 0;
  const caption =
    progress.nextRank === null
      ? 'Topo do ranking'
      : `${progress.xpToNextRank} XP até ${progress.nextRank}`;
  return (
    <section
      className="mx-4 mt-3 relative overflow-hidden rounded-2xl border border-border bg-surface p-4"
      style={{ background: 'linear-gradient(135deg, var(--brand-deep), var(--brand))' }}
    >
      <div
        aria-hidden
        className="absolute top-0 right-0 h-1 w-16"
        style={{ background: 'var(--brand-hot)' }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div
            className="font-[Anton] text-[46px] leading-none text-fg"
            style={{ textShadow: '0 0 24px rgba(225,6,0,0.18)' }}
          >
            {progress.xp.toLocaleString('pt-BR')}
          </div>
          <div className="text-muted text-[11px] font-mono uppercase mt-1">XP</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-surface-deep px-2.5 py-1 text-[11px] font-mono uppercase text-fg">
            {progress.rank}
          </span>
          {/* Static `?` — NOT a <button>, no onClick, no onPressHint prop. SSR v1 per canon §12 + §"Open questions" #2. */}
          <span
            aria-label="Sobre XP"
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-surface text-[11px] font-mono text-muted"
          >
            ?
          </span>
        </div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-deep">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--brand-deep), var(--brand))',
            boxShadow: '0 0 8px rgba(225,6,0,0.6)',
          }}
        />
      </div>
      <div className="mt-2 text-muted text-[11px] font-mono">{caption}</div>
    </section>
  );
}
```

Tokens (`--brand`, `--brand-deep`, `--brand-hot`) are Phase 1 admin Tailwind CSS variables already wired in `apps/admin/app/globals.css`. Do not add new tokens.

### `packages/ui/src/web/StatsRowWeb.tsx`

Shape: 4-column CSS grid (`grid-cols-4 gap-2 mx-4 mt-2`), each tile is `rounded-xl border border-border bg-surface px-2 py-3 text-center`. Tile renders a top-line value (mono 20px for the three counters, sans 13px for `joinedAt`) and a bottom-line uppercase mono label (`EVENTOS` / `POSTS` / `CURTIDAS` / `DESDE`). `joinedAt` formatter — PT-BR abbreviated `"<month-abbr>. <yy>"` (e.g. `"fev. 26"`):

```ts
const PT_BR_MONTHS_ABBR = [
  'jan.',
  'fev.',
  'mar.',
  'abr.',
  'mai.',
  'jun.',
  'jul.',
  'ago.',
  'set.',
  'out.',
  'nov.',
  'dez.',
];
function formatJoinedAt(iso: string): string {
  const d = new Date(iso);
  return `${PT_BR_MONTHS_ABBR[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}`;
}
```

Use `getUTCMonth` / `getUTCFullYear` (not local-time variants) so SSR output is byte-stable regardless of server TZ. Props: `{ stats: GarageStats }`.

### `packages/ui/src/web/ProfileStatsWeb.tsx`

```tsx
import type { GarageProgress, GarageStats } from '@jdm/shared/garage-progress';
import { StatsRowWeb } from './StatsRowWeb.js';
import { XPScoreboardWeb } from './XPScoreboardWeb.js';

export type ProfileStatsWebProps = {
  gamificationEnabled: boolean;
  progress?: GarageProgress;
  stats?: GarageStats;
};

export function ProfileStatsWeb({ gamificationEnabled, progress, stats }: ProfileStatsWebProps) {
  if (!gamificationEnabled) return null; // killswitch gate (canon §1)
  if (!progress || !stats) return null; // missing-payload guard (canon §2)
  // All-zero hide-on-empty (canon §2 + outline §C10). API already strips when all-zero,
  // but the wrapper enforces the same predicate so a server-side regression cannot leak
  // an empty block to the public surface.
  if (progress.xp === 0 && stats.events === 0 && stats.posts === 0 && stats.likesReceived === 0) {
    return null;
  }
  return (
    <>
      <XPScoreboardWeb progress={progress} />
      <StatsRowWeb stats={stats} />
    </>
  );
}
```

### `packages/ui/src/web/index.ts` (modify)

Append after the existing `BadgeRow` export:

```ts
export { XPScoreboardWeb, type XPScoreboardWebProps } from './XPScoreboardWeb.js';
export { StatsRowWeb, type StatsRowWebProps } from './StatsRowWeb.js';
export { ProfileStatsWeb, type ProfileStatsWebProps } from './ProfileStatsWeb.js';
```

### `apps/admin/src/components/public-garage-view.tsx` (modify)

Four changes:

1. Add `ProfileStatsWeb` to the `from '@jdm/ui/web'` import (alongside `BadgeRow`).
2. Extend `Props` with three new optional fields:
   - `gamificationEnabled?: boolean` — response top-level flag (canon §1).
   - `progress?: GaragePublicResponse['progress']`.
   - `stats?: GaragePublicResponse['stats']`.
3. Insert `<ProfileStatsWeb gamificationEnabled={gamificationEnabled ?? false} progress={progress} stats={stats} />` between the identity `<section>` (closes around line 61) and the existing `{showBadges ? <BadgeRow … /> : null}` line.
4. Do NOT read `garage.gamification.enabled`. Canon §1 — `gamification.enabled` lives at the **response top-level**, not nested inside the `garage` payload.

Insertion order is load-bearing: identity → ProfileStats → BadgeRow → Coleção. Owner mobile chunk 40 enforces the same order; an SSR insertion-order regression test covers it.

### `apps/admin/app/g/[slug]/page.tsx` (modify)

Forward the new fields (note `gamificationEnabled` is sourced from `data.gamification.enabled`, the response top-level path):

```tsx
return (
  <PublicGarageView
    garage={data.garage}
    cars={data.cars}
    gamificationEnabled={data.gamification?.enabled ?? false}
    progress={data.progress}
    stats={data.stats}
    badgeCatalog={badgeCatalog}
  />
);
```

`data.gamification` is optional in the zod parse for safety against pre-chunk-28 envelopes; once chunk 28 lands it is always present. `fetchPublicGarage` parses `progress` + `stats` + `gamification` via the chunk-24 envelope extension.

---

## Test plan

All tests use `renderToStaticMarkup` from `react-dom/server` (already imported in the existing admin test file). SSR == bytes — we assert against the HTML string.

### `packages/ui/src/web/__tests__/profile-stats-web.test.tsx` (new — 10 specs)

| #   | Test name                                                                             | Intent                                                 |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | `renders XPScoreboard + StatsRow when gamificationEnabled + progress + stats present` | Happy composite path.                                  |
| 2   | `returns null when gamificationEnabled === false`                                     | Killswitch gate (canon §1).                            |
| 3   | `returns null when progress is undefined`                                             | Missing-payload guard (canon §2).                      |
| 4   | `returns null when stats is undefined`                                                | Symmetric guard.                                       |
| 5   | `returns null when xp/events/posts/likesReceived are all zero`                        | All-zero hide-on-empty (canon §2 / §C10).              |
| 6   | `XPScoreboardWeb renders '?' as <span>, not <button>`                                 | §"Open questions" #2 default — static `?` (canon §12). |
| 7   | `XPScoreboardWeb has no 'onclick' attribute in the rendered markup`                   | No JS handler in SSR v1 (canon §12).                   |
| 8   | `XPScoreboardWeb caption is "Topo do ranking" when nextRank === null`                 | Top-tier sentinel (§C14).                              |
| 9   | `XPScoreboardWeb caption is "<N> XP até <NextRank>" when nextRank is set`             | Mid-tier caption.                                      |
| 10  | `StatsRowWeb formats joinedAt as "fev. 26" for an ISO datetime in Feb 2026`           | PT-BR locale rendering.                                |

Fixtures (top of file):

```ts
const progress: GarageProgress = {
  xp: 1234,
  rank: 'Veterano',
  nextRank: 'Lendário',
  xpInTier: 234,
  xpToNextRank: 3766,
  tierSpan: 4000,
};
const stats: GarageStats = {
  events: 12,
  posts: 4,
  likesReceived: 88,
  joinedAt: '2026-02-15T08:00:00.000Z',
};
```

Representative assertions:

```ts
// Test 6 — static `?` is a <span>, not a <button>
const html = renderToStaticMarkup(<XPScoreboardWeb progress={progress} />);
expect(html).toMatch(/<span[^>]*aria-label="Sobre XP"/);
expect(html).not.toMatch(/<button[^>]*aria-label="Sobre XP"/);

// Test 7 — no JS handler attribute survives SSR
expect(html).not.toContain('onclick');
expect(html).not.toContain('onClick');

// Test 2 — killswitch off renders empty
expect(renderToStaticMarkup(
  <ProfileStatsWeb gamificationEnabled={false} progress={progress} stats={stats} />
)).toBe('');

// Test 5 — all-zero present payload renders empty (canon §2)
const zeroProgress: GarageProgress = {
  xp: 0,
  rank: 'Iniciante',
  nextRank: 'Aprendiz',
  xpInTier: 0,
  xpToNextRank: 100,
  tierSpan: 100,
};
const zeroStats: GarageStats = {
  events: 0,
  posts: 0,
  likesReceived: 0,
  joinedAt: '2026-02-15T08:00:00.000Z',
};
expect(renderToStaticMarkup(
  <ProfileStatsWeb gamificationEnabled={true} progress={zeroProgress} stats={zeroStats} />
)).toBe('');

// Test 8
const top = { ...progress, nextRank: null, xpToNextRank: 0, tierSpan: 1 };
expect(renderToStaticMarkup(<XPScoreboardWeb progress={top} />)).toContain('Topo do ranking');

// Test 9
expect(renderToStaticMarkup(<XPScoreboardWeb progress={progress} />))
  .toContain('3766 XP até Lendário');

// Test 10
expect(renderToStaticMarkup(<StatsRowWeb stats={stats} />)).toContain('fev. 26');
```

### `apps/admin/src/components/__tests__/public-garage-view.test.tsx` (extend — 7 new specs)

Add a `describe('PublicGarageView — ProfileStats (chunk 41)', ...)` block. Reuse the existing `baseGarage`. Pass `gamificationEnabled` as a top-level prop (canon §1) — do NOT mutate `baseGarage.gamification`.

| #   | Test name                                                                             | Intent                                              |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | `renders ProfileStats when progress + stats present and gamificationEnabled === true` | Happy SSR composition.                              |
| 2   | `omits ProfileStats when progress is undefined`                                       | SSR mirrors server-side hide-on-empty.              |
| 3   | `omits ProfileStats when stats is undefined`                                          | Symmetric guard.                                    |
| 4   | `omits ProfileStats when gamificationEnabled === false (response top-level flag)`     | SSR killswitch gate (canon §1 / §C10 top-level).    |
| 5   | `renders the static '?' as inert (no onclick) inside the composed page`               | §"Open questions" #2 default carried into the page. |
| 6   | `inserts ProfileStats between the identity section and the BadgeRow when both render` | Insertion-order regression (outline §303).          |
| 7   | `produces byte-stable HTML for identical input (same input → same bytes)`             | SSR determinism.                                    |

Test 6 ordering check (substring positions):

```ts
const idxSlug = html.indexOf(`jdmexp.app/g/${garage.slug}`); // identity section
const idxScoreboard = html.indexOf('Veterano'); // ProfileStats
const idxBadgeRow = html.indexOf('Conquista JDM-003'); // BadgeRow
expect(idxSlug).toBeGreaterThan(-1);
expect(idxScoreboard).toBeGreaterThan(idxSlug);
expect(idxBadgeRow).toBeGreaterThan(idxScoreboard);
```

Test 4 fixture (killswitch off via top-level prop, canon §1):

```ts
const html = renderToStaticMarkup(
  <PublicGarageView
    garage={baseGarage}
    cars={[]}
    gamificationEnabled={false}
    progress={progress}
    stats={stats}
  />,
);
expect(html).not.toContain('Veterano');
expect(html).not.toContain('EVENTOS');
```

Test 7 byte-stable:

```ts
const a = renderToStaticMarkup(
  <PublicGarageView
    garage={baseGarage}
    cars={[]}
    gamificationEnabled={true}
    progress={progress}
    stats={stats}
  />,
);
const b = renderToStaticMarkup(
  <PublicGarageView
    garage={baseGarage}
    cars={[]}
    gamificationEnabled={true}
    progress={progress}
    stats={stats}
  />,
);
expect(a).toBe(b);
```

Reuse the same `progress` + `stats` fixtures (paste them above the new `describe` block, alongside the existing `baseGarage` / `carWithPhoto` fixtures).

---

## Task decomposition

Five TDD tasks, ~70 min total. Each ends with a commit.

### Task 1 — Create three web twins + their unit tests (red → green)

**Files:** `packages/ui/src/web/{XPScoreboardWeb,StatsRowWeb,ProfileStatsWeb,index}.tsx`/`.ts` + `packages/ui/src/web/__tests__/profile-stats-web.test.tsx`.

- [ ] **1.1 — Write the failing twin test file** with all 10 specs from §"Test plan".

- [ ] **1.2 — Run, confirm failures**

```bash
pnpm --filter @jdm/ui exec vitest run src/web/__tests__/profile-stats-web.test.tsx
```

Expected: "Cannot find module '../index.js'" or "ProfileStatsWeb is not a function" — twins don't exist yet. Confirms test reach.

- [ ] **1.3 — Write the three twin files** per §"Code shape".

- [ ] **1.4 — Append the three exports** to `packages/ui/src/web/index.ts`.

- [ ] **1.5 — Run, confirm all 10 PASS**

```bash
pnpm --filter @jdm/ui exec vitest run src/web/__tests__/profile-stats-web.test.tsx
```

- [ ] **1.6 — Typecheck `@jdm/ui`**

```bash
pnpm --filter @jdm/ui typecheck
```

- [ ] **1.7 — Commit**

```bash
git add packages/ui/src/web/XPScoreboardWeb.tsx packages/ui/src/web/StatsRowWeb.tsx \
        packages/ui/src/web/ProfileStatsWeb.tsx packages/ui/src/web/index.ts \
        packages/ui/src/web/__tests__/profile-stats-web.test.tsx
git commit -m "feat(ui/web): add ProfileStatsWeb + XPScoreboardWeb + StatsRowWeb twins (chunk 41)"
```

---

### Task 2 — Extend the admin test file with the 7 SSR specs (red)

**File:** `apps/admin/src/components/__tests__/public-garage-view.test.tsx`.

- [ ] **2.1 — Add imports + fixtures + new `describe` block** from §"Test plan". Import `GarageProgress` + `GarageStats` from `@jdm/shared/garage-progress`. The new specs pass `gamificationEnabled` as a **top-level prop** on `<PublicGarageView />` (canon §1) — do NOT mutate `baseGarage.gamification`.

- [ ] **2.2 — Run, confirm 7 NEW failures**

```bash
pnpm --filter @jdm/admin exec vitest run public-garage-view
```

Expected: 7 failures + the existing 12 specs still PASS. TypeScript complains about unknown `progress` / `stats` / `gamificationEnabled` props on `<PublicGarageView />` — that's the red signal we want.

- [ ] **2.3 — Commit the failing test extension**

```bash
git add apps/admin/src/components/__tests__/public-garage-view.test.tsx
git commit -m "test(admin): failing chunk-41 ProfileStats SSR specs"
```

---

### Task 3 — Wire `ProfileStatsWeb` into `public-garage-view.tsx` (green)

**File:** `apps/admin/src/components/public-garage-view.tsx`.

- [ ] **3.1 — Apply the three changes** from §"Code shape": import, props extension, JSX insertion between identity section and BadgeRow.

- [ ] **3.2 — Run, confirm all 19 specs PASS**

```bash
pnpm --filter @jdm/admin exec vitest run public-garage-view
```

- [ ] **3.3 — Typecheck `@jdm/admin`**

```bash
pnpm --filter @jdm/admin typecheck
```

If `data.progress` / `data.stats` typecheck-fail at the page level, that's expected; Task 4 wires the page.

- [ ] **3.4 — Commit**

```bash
git add apps/admin/src/components/public-garage-view.tsx
git commit -m "feat(admin): slot ProfileStatsWeb into SSR public garage (chunk 41)"
```

---

### Task 4 — Forward `progress` + `stats` from `page.tsx`

**File:** `apps/admin/app/g/[slug]/page.tsx`.

- [ ] **4.1 — Apply the §"Code shape" diff** — add `progress={data.progress}` and `stats={data.stats}` to the `<PublicGarageView />` call.

- [ ] **4.2 — Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

If TypeScript says `Property 'progress' does not exist on type 'GaragePublicResponse'`, the chunk-24 envelope extension never merged or chunk 28 shipped a different shape — STOP and reconcile with the chunk-24 / chunk-28 authors. Do NOT paper over locally.

- [ ] **4.3 — Re-run the test scope**

```bash
pnpm --filter @jdm/admin exec vitest run public-garage-view
```

Expected: all 19 specs still PASS.

- [ ] **4.4 — Commit**

```bash
git add apps/admin/app/g/[slug]/page.tsx
git commit -m "feat(admin): forward progress + stats from SSR page to PublicGarageView (chunk 41)"
```

---

### Task 5 — Verification + lint sweep

- [ ] **5.1 — Verify §C9 byte-identical 404 parity is not regressed (real route-level check)**

Chunk 41 only touches the happy-path render in `page.tsx`; the `notFound()` short-circuit is untouched. But §C9 invariant requires unknown-slug AND private-slug responses to be byte-identical (status, body, headers). The existing admin component test only renders a component — it does NOT exercise the route, the `fetchPublicGarage` 404 mapping, or the response envelope. Run the route-level §C9 spec instead.

If the chunk-13 / chunk-28 §C9 test exists at `apps/api/test/public-garage/404-byte-parity.test.ts` (API-side authoritative source), run:

```bash
pnpm --filter @jdm/api exec vitest run test/public-garage/404-byte-parity.test.ts
```

Otherwise run the admin route-level equivalent at `apps/admin/src/app/g/[slug]/__tests__/not-found-byte-parity.test.ts` (or wherever Phase 1 chunk 13 / 14 parked it — `grep -rn "byte" apps/admin/src/app/g/`):

```bash
pnpm --filter @jdm/admin exec vitest run --testPathPattern "g/\\[slug\\].*not-found"
```

Both variants must hit BOTH paths (unknown slug + private slug) and compare status code, response body, and response headers. The admin component-level test does NOT satisfy this — that test only proves the React component renders nothing on a `notFound()` throw, it does not exercise the route handler or assert byte equality across paths.

Expected: route-level §C9 test PASSes; unknown-slug response is byte-identical to private-slug response. If the test is missing entirely, STOP and escalate to the chunk-13 / chunk-28 owners — chunk 41 does not introduce or relocate the §C9 spec.

- [ ] **5.2 — Both typechecks clean**

```bash
pnpm --filter @jdm/ui typecheck
pnpm --filter @jdm/admin typecheck
```

- [ ] **5.3 — Lint touched files only** (per CLAUDE.md "touched-paths only"):

```bash
pnpm --filter @jdm/admin lint -- \
  apps/admin/src/components/public-garage-view.tsx \
  apps/admin/app/g/[slug]/page.tsx \
  apps/admin/src/components/__tests__/public-garage-view.test.tsx
```

If errors, fix in a separate cleanup commit before opening the PR.

- [ ] **5.4 — Push the branch**

```bash
git push -u origin feat/jdma-garage-phase2-41
```

---

## Corrections applied

| §                                       | Status                     | How chunk 41 honors it                                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canon §1 (gamification top-level)       | Authoritative              | SSR reads `data.gamification.enabled` from the **response top-level** (NOT `data.garage.gamification.enabled`). `PublicGarageView` exposes a `gamificationEnabled` prop; `page.tsx` sources it from `data.gamification?.enabled ?? false`.       |
| Canon §2 (hide-on-empty all-zero)       | Authoritative              | `ProfileStatsWeb` returns `null` when (a) gamification disabled, OR (b) `progress`/`stats` missing, OR (c) `progress.xp === 0 && stats.events === 0 && stats.posts === 0 && stats.likesReceived === 0`. Twin tests 2/3/4/5 cover all four paths. |
| Canon §12 (SSR tooltip = static `?`)    | Authoritative              | `XPScoreboardWeb` renders a static `<span aria-label="Sobre XP">?</span>` — no `<button>`, no `onclick`, no `onPressHint` prop, no `XPTooltip` web twin. Twin tests 6 + 7 enforce. Mobile `XPTooltip` (chunk 38) untouched.                      |
| §C5 (sync killswitch read)              | Upstream (chunks 26/27/28) | API reads killswitch sync; SSR receives the boolean in the response top-level. No new policy here.                                                                                                                                               |
| §C9 (404 byte parity)                   | Chunk 13/28 own            | Not regressed — chunk 41 only touches the happy-path branch in `page.tsx`; the `notFound()` short-circuit is untouched. Task 5.1 runs the real route-level §C9 test (API or admin route-level), NOT the admin component test.                    |
| §C10 (optional schemas)                 | Chunk 24 owns              | Both `progress` + `stats` typed `.optional()` on the public envelope; `gamification` is also at response top-level. `ProfileStatsWeb` returns `null` when either is undefined OR all-zero (belt-and-suspenders).                                 |
| §C11 (Phase 1 chunk renumbering)        | Phase 1 closeout           | Skeleton already cites "Phase 1 chunk 13" + "BadgeRow (Phase 1 chunk 19)" — chunk 41 uses those numbers verbatim.                                                                                                                                |
| §C14 (`nextAt: null` top-tier sentinel) | Chunk 26 owns              | Service ships `nextRank: null`, `xpToNextRank: 0`, `tierSpan: 1` at top tier. `XPScoreboardWeb` checks `nextRank === null` for caption + uses `tierSpan > 0 ? … : 0` for the bar (defensive).                                                    |

---

## Deviations (locked at plan time)

1. **SSR tooltip is static (`<span>`, no overlay).** Per skeleton §"Open questions" #2 + xp-plan §"Open questions" #3 + canon §12, locked default for v1: static `?` span, no overlay, no JS bundle for tooltip. `XPScoreboardWeb` does NOT accept an `onPressHint` prop (canon §12 — SSR composition passes `undefined` to the mobile twin contract, but the web twin doesn't even expose the prop because there is no overlay to open). Client-island variant deferred to Phase 2D. Twin tests 6 + 7 enforce: no `<button>`, no `onclick`.

2. **No `XPTooltip` web twin.** Outline §301 tooltip overlay does NOT apply to the SSR variant. Mobile `XPTooltip` (chunk 38) is a centered overlay with backdrop + tap-to-dismiss; the SSR `?` is inert and renders nothing on hover/click. Chunk 38's mobile-only scope is unchanged. No `packages/ui/src/web/XPTooltipWeb.tsx` is created.

3. **Three web twins created, not one.** Skeleton listed only `public-garage-view.tsx` + `page.tsx` + the test file. Reality: `ProfileStatsWeb` + `XPScoreboardWeb` + `StatsRowWeb` are HTML+Tailwind twins under `packages/ui/src/web/` — RN-side `XPScoreboard.tsx` etc. cannot SSR because they import `react-native` primitives. Mirrors the Phase 1 chunk 21 `BadgeRow` web-twin pattern. Additive, not a behavior change.

4. **`gamification.enabled` read from response top-level (canon §1).** Per canon §1 + outline §C10, `gamification: { enabled: boolean }` lives at the **response top-level**, sibling of `garage` / `progress` / `stats`. This chunk reads `data.gamification.enabled` in `page.tsx` and threads it through `PublicGarageView` as a `gamificationEnabled` prop. The previous draft of this plan read `garage.gamification.enabled` (nested) — that path is INVALID and has been removed. If a nested `gamification` accidentally ships from chunk 24/28 in addition to the top-level field, ignore it; only the top-level is canonical.

5. **All-zero hide-on-empty enforced client-side (canon §2).** API already strips `progress` + `stats` from the public response when `xp === 0 && events === 0 && posts === 0 && likesReceived === 0` (chunk 28 owns the server-side predicate). `ProfileStatsWeb` re-asserts the same predicate as belt-and-suspenders so a server regression cannot leak an empty block to the public page. Twin test 5 covers the all-zero-present case.

6. **Owner mode not implemented in `ProfileStatsWeb`.** The twin accepts public-mode props only. Owner SSR doesn't exist (owner is mobile-only per outline §303), so adding `mode='owner'` would be YAGNI. Phase 2D may add an owner SSR variant in a new chunk.

---

## PR checklist (after Task 5)

- [ ] Branch `feat/jdma-garage-phase2-41` from fresh `main` (PF-1 + PF-5 verified).
- [ ] All 19 specs in `public-garage-view.test.tsx` PASS (12 existing + 7 new).
- [ ] All 10 specs in `profile-stats-web.test.tsx` PASS.
- [ ] `pnpm --filter @jdm/ui typecheck` clean.
- [ ] `pnpm --filter @jdm/admin typecheck` clean.
- [ ] Lint clean on touched files (per CLAUDE.md).
- [ ] Real route-level §C9 404 byte-parity spec PASSes (Task 5.1 — NOT the admin component test).
- [ ] PR body documents the six §"Deviations" entries (especially #1 — static `?`; #4 — top-level `gamification.enabled`; #5 — all-zero hide-on-empty).
- [ ] PR title: `feat(admin): public SSR ProfileStats integration (chunk 41)`.
- [ ] PR target: `main`. No `production` touches anywhere.
- [ ] Cross-references in PR body: skeleton §"Chunk 41" (line 494), xp-plan §304 + §559 #3, this plan file.
- [ ] CI green on the PR before requesting review.

---

## Out of scope (Phase 2D)

- Animated tweens on `XPScoreboardWeb` (xp-plan §"Open questions" #1: hard-set in v1).
- Client-island `?` tooltip on SSR (overlay surfaces only on mobile in v1).
- Owner-mode SSR ProfileStats (no owner SSR surface exists).
- `XPScoreboardWeb` font-loading optimization (Anton 46px via `font-[Anton]`; address if FOUT visible).
- Shared `joinedAt` locale formatter between mobile + web `StatsRow` (each renderer formats independently in v1).
