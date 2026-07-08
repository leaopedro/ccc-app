import type { GarageProgress } from '@ccc/shared/garage-progress';

import { garageTokens } from '../garage-tokens.js';

export type XPScoreboardWebProps = { progress: GarageProgress };

const BRAND_BASE = garageTokens.brand.base;
const BRAND_DEEP = garageTokens.brand.deep;
const BRAND_SOFT = garageTokens.brand.soft;

/**
 * XPScoreboardWeb — SSR-safe twin of the mobile XPScoreboard (chunk 36).
 *
 * Visual: brand-gradient card, Jost 46px XP number, rank pill, static
 * `?` mark, brand-gradient progress bar, caption row.
 *
 * Canon §12: the `?` is a static <span aria-label="Sobre XP">, NOT a
 * <button>. SSR v1 carries no onClick handler and no XPTooltip web twin
 * — tooltip overlay is mobile-only per skeleton §"Open questions" #2.
 *
 * Top-tier sentinel per §C14: when nextRank === null we force pct to
 * 100 BEFORE the division so the tierSpan=1, xpInTier=0 sentinel does
 * not render an empty bar at the threshold. Mirrors mobile twin
 * (XPScoreboard.tsx line 62–67).
 *
 * Color tokens are inlined from `garageTokens.brand.*` (concrete hex) —
 * admin `globals.css` exposes only `--color-*` theme vars, NOT
 * `--brand-*`, so referencing CSS vars would leave the gradient
 * unresolved in production.
 */
export function XPScoreboardWeb({ progress }: XPScoreboardWebProps) {
  const isTopTier = progress.nextRank === null;
  const pct = isTopTier
    ? 100
    : progress.tierSpan > 0
      ? Math.min(100, (progress.xpInTier / progress.tierSpan) * 100)
      : 0;
  const caption = isTopTier
    ? 'Topo do ranking'
    : `${progress.xpToNextRank} XP até ${progress.nextRank}`;
  return (
    <section
      className="mx-4 mt-3 relative overflow-hidden rounded-2xl border border-border bg-surface p-4"
      style={{ background: `linear-gradient(135deg, ${BRAND_DEEP}, ${BRAND_BASE})` }}
    >
      <div
        aria-hidden
        className="absolute top-0 right-0 h-1 w-16"
        style={{ background: BRAND_SOFT }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div
            className="font-display text-[46px] leading-none text-fg"
            style={{ textShadow: '0 0 24px rgba(212,175,55,0.18)' }}
          >
            {progress.xp.toLocaleString('pt-BR')}
          </div>
          <div className="text-muted text-[11px] font-mono uppercase mt-1">XP</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-surface-deep px-2.5 py-1 text-[11px] font-mono uppercase text-fg">
            {progress.rank}
          </span>
          {/* Static `?` — NOT a <button>, no onClick, no onPressHint prop.
              SSR v1 per canon §12 + skeleton §"Open questions" #2. */}
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
            background: `linear-gradient(90deg, ${BRAND_DEEP}, ${BRAND_BASE})`,
            boxShadow: '0 0 8px rgba(212,175,55,0.6)',
          }}
        />
      </div>
      <div className="mt-2 text-muted text-[11px] font-mono">{caption}</div>
    </section>
  );
}
