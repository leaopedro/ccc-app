import type { GarageProgress } from '@ccc/shared/garage-progress';

import { garageTokens } from '../garage-tokens.js';

export interface XPScoreboardProps {
  /** Server-derived progress (chunk 24). MUST be non-null — wrapper short-circuits when missing. */
  progress: GarageProgress;
  /**
   * Tap handler for the `?` button. OPTIONAL (canon §12).
   * - Mobile composition (chunk 39 ProfileStats) passes the tooltip opener.
   * - SSR composition (chunk 41 ProfileStatsWeb) passes undefined so the `?` renders
   *   static + non-interactive (no <button>, no onClick).
   */
  onPressHint?: () => void;
  /** Used by tests + dispatch tracking. */
  testID?: string;
}

// 11 evenly-spaced ticker positions across the bar. i % 5 === 0 → tall hatch.
const TICKS = Array.from({ length: 11 }, (_, i) => i);

/**
 * XPScoreboard (web) — SSR-safe twin of the mobile XPScoreboard
 * (`packages/ui/src/XPScoreboard.tsx`). Same prop shape, same visual canon.
 * Mirrors `packages/ui/src/web/HexBadge.tsx` style: no `'use client'`, no
 * React state, plain DOM + Tailwind utility classes + inline styles.
 *
 * Renders:
 * - Jost 46px XP number with brand-tinted text-shadow glow.
 * - Rank pill (right-aligned, brand-tinted background + brand border).
 * - `?` hint element. OPTIONAL handler per canon §12: when defined renders a
 *   <button>; when undefined renders a static <span aria-hidden="true"> so
 *   the SSR composition (chunk 41) emits no interactive node.
 * - 8px brand-gradient progress bar with 11 mono ticker hatches (every 5th
 *   tall).
 * - Caption row (rank label left, `${xpToNext} → ${nextRank}` right or
 *   "Topo do ranking" at top tier).
 *
 * Top-tier sentinel per outline §C14: when `nextRank === null` the
 * derivation emits `tierSpan = 1` + `xpToNextRank = 0`. We branch on
 * `nextRank === null` BEFORE the division so the bar forces to 100% and the
 * caption swaps to "Topo do ranking". Mirrors canon `progress.jsx:263–265`.
 *
 * Animation deferred to Phase 2D (skeleton open-Q #1 default = hard-set on
 * read; no tween / glow pulse in v1).
 *
 * Server-rendered — NO `'use client'`. Public garage page is SSR-only;
 * tooltip interactivity (chunk 38) is mobile-only per canon §12 + skeleton
 * open-Q #3 default.
 */
export function XPScoreboard({ progress, onPressHint, testID }: XPScoreboardProps) {
  const isTopTier = progress.nextRank === null;
  // §C14 — force 100% BEFORE the division so the tierSpan=1 sentinel does
  // not divide xpInTier by 1 and overshoot. Mirrors canon progress.jsx:263.
  const pct = isTopTier
    ? 100
    : Math.max(0, Math.min(100, Math.round((progress.xpInTier / progress.tierSpan) * 100)));
  const caption = isTopTier
    ? 'Topo do ranking'
    : `${progress.xpToNextRank.toLocaleString('pt-BR')} → ${progress.nextRank ?? ''}`;

  const xpFormatted = progress.xp.toLocaleString('pt-BR');

  const hintStyle: React.CSSProperties = {
    width: 18,
    height: 18,
    borderRadius: 9,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: garageTokens.surface.alt,
    border: `1px solid ${garageTokens.surface.border}`,
    color: '#C8C8CE',
    fontFamily: 'inherit',
    fontWeight: 700,
    fontSize: 11,
    lineHeight: 1,
  };

  const hintEl =
    typeof onPressHint === 'function' ? (
      <button
        type="button"
        onClick={onPressHint}
        aria-label="Como ganhar XP"
        data-testid={testID ? `${testID}-hint` : 'xp-scoreboard-hint'}
        style={{ ...hintStyle, cursor: 'pointer', padding: 0 }}
      >
        ?
      </button>
    ) : (
      <span aria-hidden="true" style={hintStyle}>
        ?
      </span>
    );

  return (
    <div
      data-testid={testID}
      className="relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${garageTokens.brand.tint}, transparent 60%), ${garageTokens.surface.sheet}`,
        border: `1px solid ${garageTokens.surface.border}`,
        borderRadius: 14,
        padding: '14px 16px',
      }}
    >
      {/* corner racing-stripe accent */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 64,
          height: 4,
          background: `linear-gradient(90deg, transparent, ${garageTokens.brand.base})`,
        }}
      />

      {/* row 1 — label + rank pill */}
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <div
          className="inline-flex items-center"
          style={{
            gap: 6,
            fontFamily: 'JetBrainsMono, ui-monospace, monospace',
            fontSize: 10,
            color: '#8A8A93',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
          }}
        >
          <span>XP</span>
          {hintEl}
        </div>
        <span
          className="inline-flex items-center"
          style={{
            gap: 6,
            padding: '3px 9px',
            borderRadius: 4,
            backgroundColor: garageTokens.brand.tint,
            color: garageTokens.brand.soft,
            border: '1px solid rgba(212,175,55,0.45)',
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
          }}
        >
          {progress.rank}
        </span>
      </div>

      {/* row 2 — BIG number */}
      <div className="flex items-baseline" style={{ marginTop: 6, gap: 10 }}>
        <span
          aria-label={`${xpFormatted} XP`}
          style={{
            fontFamily: 'Jost_300Regular, ui-sans-serif, system-ui',
            fontSize: 46,
            lineHeight: 1,
            color: '#F5F5F5',
            letterSpacing: '-1.5px',
            textShadow: '0 0 24px rgba(212,175,55,0.18)',
          }}
        >
          {xpFormatted}
        </span>
        <span
          style={{
            fontFamily: 'JetBrainsMono, ui-monospace, monospace',
            fontSize: 11,
            color: '#8A8A93',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          pontos
        </span>
      </div>

      {/* row 3 — progress bar with mono ticks */}
      <div style={{ marginTop: 12 }}>
        <div
          className="relative overflow-hidden"
          style={{
            height: 8,
            borderRadius: 4,
            backgroundColor: garageTokens.surface.deep,
            border: `1px solid ${garageTokens.surface.border}`,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${garageTokens.brand.deep}, ${garageTokens.brand.base})`,
            }}
          />
          {/* ticker marks */}
          <span
            aria-hidden="true"
            className="flex items-center justify-between"
            style={{
              position: 'absolute',
              inset: 0,
              padding: '0 2px',
              pointerEvents: 'none',
            }}
          >
            {TICKS.map((i) => (
              <span
                key={i}
                style={{
                  width: 1,
                  height: i % 5 === 0 ? 8 : 4,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  borderRadius: 1,
                }}
              />
            ))}
          </span>
        </div>
        <div
          className="flex items-center justify-between"
          style={{
            marginTop: 6,
            fontFamily: 'JetBrainsMono, ui-monospace, monospace',
            fontSize: 10,
            color: '#8A8A93',
            letterSpacing: '0.04em',
          }}
        >
          <span>{progress.rank}</span>
          <span style={{ color: '#C8C8CE' }}>{caption}</span>
        </div>
      </div>
    </div>
  );
}
