import { garageTokens, rarityColors, type GarageRarity } from '../garage-tokens.js';

import { BadgeGlyph } from './BadgeGlyph.js';

export type HexBadgeVariant = 'earned' | 'locked' | 'locked_premium';
export type HexBadgeSize = 'sm' | 'md' | 'lg';

export interface HexBadgeProps {
  /** Badge code (e.g. `EVT-001`) — used for accessibility. */
  code: string;
  /** Visual state. Locked + locked_premium render grayscale + Lock glyph. */
  variant: HexBadgeVariant;
  /** Drives the hex ring colour + tint. */
  rarity: GarageRarity;
  /** Catalog `icon` wire string — resolved by `BadgeGlyph`. */
  icon: string;
  /** Outer hex diameter: sm=32, md=52, lg=96. */
  size: HexBadgeSize;
  /** Optional human-readable label rendered under the hex. */
  label?: string;
}

const SIZES: Record<HexBadgeSize, { outer: number; glyph: number; tagFontSize: number }> = {
  sm: { outer: 32, glyph: 14, tagFontSize: 8 },
  md: { outer: 52, glyph: 22, tagFontSize: 9 },
  lg: { outer: 96, glyph: 38, tagFontSize: 10 },
};

const RING_WIDTH: Record<HexBadgeSize, number> = { sm: 1.25, md: 1.5, lg: 2 };

// Flat-top hex polygon for the 100×100 viewBox. Matches the mobile
// `react-native-svg` `Polygon` (packages/ui/src/HexBadge.tsx) which itself
// mirrors the CSS `polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)`
// clip-path used by the design canon at
// `.handoffs/.../jdma-garage/badges.jsx:401`.
const HEX_OUTER = '25,5 75,5 100,50 75,95 25,95 0,50';
const HEX_INNER = '28,9 72,9 96,50 72,91 28,91 4,50';

/**
 * HexBadge (web) — SSR-safe twin of the mobile HexBadge primitive
 * (`packages/ui/src/HexBadge.tsx`). Renders a flat-top hexagon with a
 * rarity-tinted ring, a centered glyph, and an optional "Exclusivo
 * Premium" pill for locked-premium badges.
 *
 * Visual canon: `.handoffs/.../jdma-garage/badges.jsx` HexBadge (lines
 * 393–547). Identical sizes (sm=32, md=52, lg=96), identical rarity
 * palette via `garageTokens.rarity.*`, identical lock glyph fallback
 * for the locked / locked_premium variants.
 *
 * Server-rendered — NO `'use client'`. Public garage page is SSR-only;
 * a future hydrated owner-side variant can wrap this in a client
 * component if interactivity is needed (chunk 22+ scope).
 */
export function HexBadge({ code, variant, rarity, icon, size, label }: HexBadgeProps) {
  const r = rarityColors(rarity);
  const dim = SIZES[size].outer;
  const glyphSize = SIZES[size].glyph;
  const tagFs = SIZES[size].tagFontSize;
  const ringW = RING_WIDTH[size];
  const isEarned = variant === 'earned';
  const isPremiumLocked = variant === 'locked_premium';
  const ringColor = isEarned ? r.main : garageTokens.surface.borderStrong;
  const fillColor = isEarned ? garageTokens.surface.sheet : garageTokens.surface.alt;
  const glyphColor = isEarned ? r.main : '#8A8A93';
  const glyphName = isEarned ? icon : 'lock';

  const a11yLabel = `Conquista ${code}, ${isEarned ? 'desbloqueada' : 'bloqueada'}`;

  return (
    <span
      role="img"
      aria-label={a11yLabel}
      className="inline-flex flex-col items-center"
      style={{ opacity: isEarned ? 1 : 0.45 }}
    >
      <span className="relative inline-block" style={{ width: dim, height: dim }}>
        <svg
          width={dim}
          height={dim}
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <polygon
            points={HEX_OUTER}
            fill={ringColor}
            stroke={ringColor}
            strokeWidth={ringW * 2}
            strokeLinejoin="round"
          />
          <polygon points={HEX_INNER} fill={fillColor} />
        </svg>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <BadgeGlyph name={glyphName} size={glyphSize} color={glyphColor} />
        </span>
        {isEarned && rarity === 'legendary' && size !== 'sm' ? (
          <span
            data-testid="hex-legendary-dot"
            aria-hidden="true"
            className="pointer-events-none absolute rounded-full"
            style={{
              top: size === 'lg' ? 14 : 4,
              right: size === 'lg' ? 14 : 4,
              width: size === 'lg' ? 12 : 8,
              height: size === 'lg' ? 12 : 8,
              backgroundColor: r.main,
              boxShadow: `0 0 8px ${r.main}`,
            }}
          />
        ) : null}
      </span>

      {label ? (
        <span
          className="mt-1.5 text-center text-[11px] font-bold leading-tight"
          style={{
            color: isEarned ? '#F5F5F5' : '#8A8A93',
            maxWidth: dim + 28,
          }}
        >
          {label}
        </span>
      ) : null}

      {isPremiumLocked ? (
        <span
          className="mt-1 inline-flex items-center rounded-full px-1.5 py-0.5 font-bold uppercase tracking-widest"
          style={{
            backgroundColor: garageTokens.tier.goldTint,
            border: `1px solid ${garageTokens.tier.gold}66`,
            color: garageTokens.tier.gold,
            fontSize: tagFs,
            letterSpacing: '0.075em',
          }}
        >
          Exclusivo Premium
        </span>
      ) : null}
    </span>
  );
}
