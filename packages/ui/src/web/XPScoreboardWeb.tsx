import type { GarageProgress } from '@ccc/shared/garage-progress';

import { garageTokens } from '../garage-tokens.js';

export type XPScoreboardWebProps = { progress: GarageProgress };

const BRAND_BASE = garageTokens.brand.base;
const BRAND_DEEP = garageTokens.brand.deep;
const BRAND_SOFT = garageTokens.brand.soft;
const BRAND_TINT = garageTokens.brand.tint;
/**
 * The card glow reads as full brand gold, NOT `brand.tint`'s 12%.
 * react-native-svg drops the alpha channel inside `stopColor`, so the RN
 * twin's `<Stop stopColor={garageTokens.brand.tint} />` ships opaque
 * #D4AF37 — which is what users actually see in the app today. Matching the
 * shipped render is the point of this component, so the glow is inlined here
 * instead of reusing the tint token. `brand.tint` is still correct for the
 * rank pill below, where RN honours the alpha normally.
 */
const BRAND_GLOW = garageTokens.brand.base;
// Explicit zero-alpha gold rather than `transparent` (= rgba(0,0,0,0)), which
// interpolates through grey and leaves a dirty band mid-gradient.
const BRAND_CLEAR = 'rgba(212,175,55,0)';

// 11 evenly-spaced ticker positions across the bar. i % 5 === 0 → tall hatch.
// Mirrors the TICKS constant in the RN twin.
const TICKS = Array.from({ length: 11 }, (_, i) => i);

/**
 * XPScoreboardWeb — SSR-safe twin of the mobile XPScoreboard (chunk 36).
 *
 * Visual canon is the RN twin in `packages/ui/src/XPScoreboard.tsx`, matched
 * row for row: dark `surface.sheet` card carrying a 135° brand TINT (12%
 * gold over #141414 — NOT a solid gold gradient), a 64×4 racing-stripe
 * accent in the top-right corner, then four rows —
 *   1. `XP` mono label + static `?` (left) · gold-tint rank pill (right)
 *   2. Jost 46px XP number + `PONTOS` caption
 *   3. 8px progress bar with 11 ticker hatches (every 5th tall)
 *   4. rank (left) · `<xpToNext> → <nextRank>` (right)
 *
 * Canon §12: the `?` is a static <span aria-hidden>, NOT a <button>. SSR v1
 * carries no onClick handler and no XPTooltip web twin — tooltip overlay is
 * mobile-only per skeleton §"Open questions" #2. The RN twin hides its own
 * static fallback from the a11y tree for the same reason.
 *
 * Top-tier sentinel per §C14: when nextRank === null we force pct to
 * 100 BEFORE the division so the tierSpan=1, xpInTier=0 sentinel does
 * not render an empty bar at the threshold. Mirrors mobile twin
 * (XPScoreboard.tsx line 63–68).
 *
 * Color tokens are inlined from `garageTokens.*` (concrete hex) — the host
 * app's `globals.css` exposes only `--color-*` theme vars, NOT `--brand-*`,
 * so referencing CSS vars would leave the gradients unresolved in production.
 */
export function XPScoreboardWeb({ progress }: XPScoreboardWebProps) {
  const isTopTier = progress.nextRank === null;
  const pct = isTopTier
    ? 100
    : progress.tierSpan > 0
      ? Math.max(0, Math.min(100, Math.round((progress.xpInTier / progress.tierSpan) * 100)))
      : 0;
  const caption = isTopTier
    ? 'Topo do ranking'
    : `${progress.xpToNextRank.toLocaleString('pt-BR')} → ${progress.nextRank ?? ''}`;
  const xpFormatted = progress.xp.toLocaleString('pt-BR');
  return (
    <section
      className="mx-4 mt-3 relative overflow-hidden rounded-[14px] border border-border px-4 py-3.5"
      style={{ backgroundColor: garageTokens.surface.sheet }}
    >
      {/* Brand glow burning in from the top-left corner.
          The angle is not decorative. The RN twin draws this with an SVG
          gradient in objectBoundingBox units, which weights the axes by the
          box's aspect: on the shipped 986×402 card the measured falloff is
          0.857·x + 0.143·y, i.e. very nearly horizontal. CSS corner keywords
          weight x and y EQUALLY, so `to bottom right` spread the gold far too
          wide vertically. 105deg reproduces the measured isolines — gold gone
          by ~62% of the width, a gentle dim top-to-bottom. See BRAND_GLOW. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(105deg, ${BRAND_GLOW} 0%, ${BRAND_CLEAR} 62%)` }}
      />
      {/* Top-right 64×4 racing-stripe accent. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-1 w-16"
        style={{ background: `linear-gradient(90deg, ${BRAND_CLEAR}, ${BRAND_BASE})` }}
      />

      {/* Row 1 — XP label + ? (left), rank pill (right). */}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">XP</span>
          {/* Static `?` — NOT a <button>, no onClick, no onPressHint prop.
              SSR v1 per canon §12 + skeleton §"Open questions" #2. */}
          <span
            aria-hidden
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-surface-alt text-[11px] font-bold leading-none"
            style={{ color: '#C8C8CE' }}
          >
            ?
          </span>
        </div>
        <span
          className="rounded-[4px] border px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{
            backgroundColor: BRAND_TINT,
            borderColor: 'rgba(212,175,55,0.45)',
            color: BRAND_SOFT,
          }}
        >
          {progress.rank}
        </span>
      </div>

      {/* Row 2 — BIG Jost XP number + "pontos" caption. */}
      <div className="relative mt-1.5 flex items-baseline">
        <span
          aria-label={`${xpFormatted} XP`}
          className="font-display text-[46px] leading-none tracking-[-1.5px] text-fg"
          style={{ textShadow: '0 0 24px rgba(212,175,55,0.18)' }}
        >
          {xpFormatted}
        </span>
        <span className="ml-2.5 font-mono text-[11px] uppercase tracking-[0.09em] text-muted">
          pontos
        </span>
      </div>

      {/* Row 3 — progress bar with mono ticker hatches. */}
      <div className="relative mt-3">
        <div className="relative h-2 w-full overflow-hidden rounded-[4px] border border-border bg-surface-deep">
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${BRAND_DEEP}, ${BRAND_BASE})`,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-between px-0.5"
          >
            {TICKS.map((i) => (
              <span
                key={i}
                className="w-px rounded-[1px]"
                style={{
                  height: i % 5 === 0 ? 8 : 4,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                }}
              />
            ))}
          </div>
        </div>
        {/* Caption row — rank left, next-rank delta right. */}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] tracking-[0.04em] text-muted">
            {progress.rank}
          </span>
          <span className="font-mono text-[10px] tracking-[0.04em]" style={{ color: '#C8C8CE' }}>
            {caption}
          </span>
        </div>
      </div>
    </section>
  );
}
