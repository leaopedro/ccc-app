// Assinaturas — per-tier visual treatment + shared palette.
//
// The premium catalog API supplies only content (tier/name/prices/benefits).
// Styling is derived from the tier here so the API never carries presentation.
// Design handoff (design_handoff_assinaturas) palette + tier treatments are
// authoritative — do not alter without a design change.

import type { PremiumPlan } from '@jdm/shared/premium-catalog';

export type ApiTier = PremiumPlan['tier']; // 'bronze' | 'silver' | 'gold'

// Handoff palette (authoritative hex values).
export const c = {
  bg: '#0A0A0A',
  surface: '#0F0E0B',
  elevated: '#14110a',
  cream: '#F2E8D8',
  goldDeep: '#C9A227',
  goldLight: '#E8CE86',
  gold: '#D4AF37',
  muted55: 'rgba(242,232,216,0.55)',
  muted50: 'rgba(242,232,216,0.5)',
  muted42: 'rgba(242,232,216,0.42)',
  muted40: 'rgba(242,232,216,0.4)',
  hairline: 'rgba(212,175,55,0.14)',
  tileBorder: 'rgba(212,175,55,0.22)',
};

// Content-neutral per-tier presentation: uppercase label, accent color, and the
// "recommended" flag that drives the gold card treatment.
export const TIER_VISUAL: Record<ApiTier, { label: string; accent: string; recommended: boolean }> =
  {
    bronze: { label: 'BRONZE', accent: '#C08A4E', recommended: false },
    silver: { label: 'PRATA', accent: '#C7CCD1', recommended: false },
    gold: { label: 'OURO', accent: '#E8CE86', recommended: true },
  };

export type TierTreatment = {
  border: string;
  divider: string;
  btnBg: string;
  btnColor: string;
  btnBorder: string;
};

// Per-tier CTA + border treatment (kept out of the data model so the API only
// supplies content, not styling).
export function tierStyle(tier: ApiTier): TierTreatment {
  switch (tier) {
    case 'bronze':
      return {
        border: 'rgba(192,138,78,0.34)',
        divider: 'rgba(192,138,78,0.2)',
        btnBg: 'transparent',
        btnColor: c.goldLight,
        btnBorder: 'rgba(192,138,78,0.55)',
      };
    case 'silver':
      return {
        border: 'rgba(199,204,209,0.34)',
        divider: 'rgba(199,204,209,0.2)',
        btnBg: 'transparent',
        btnColor: c.cream,
        btnBorder: 'rgba(199,204,209,0.6)',
      };
    case 'gold':
    default:
      return {
        border: 'rgba(212,175,55,0.5)',
        divider: 'rgba(212,175,55,0.28)',
        btnBg: 'gradient',
        btnColor: '#0A0A0A',
        btnBorder: 'transparent',
      };
  }
}

// Monthly price is the source of truth for the card/detail price. Falls back to
// the first available price point when no monthly cadence exists.
export function monthlyPriceCents(plan: PremiumPlan): number | null {
  const monthly = plan.prices.find((p) => p.cadence === 'monthly');
  const price = monthly ?? plan.prices[0];
  return price ? price.baseAmountCents : null;
}

// Benefits ordered by sortOrder (defensive — API already orders them).
export function orderedBenefits(plan: PremiumPlan): string[] {
  return [...plan.benefits].sort((a, b) => a.sortOrder - b.sortOrder).map((b) => b.label);
}
