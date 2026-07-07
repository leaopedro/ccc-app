// Additive tokens for the garage redesign. Values are locked in
// `.handoffs/design-handoff/design_handoff_garage_redesign/IMPLEMENTATION.md` §3.2.
// Contrast vs `#0A0A0A` text: gold 9.6:1, silver 9.0:1, bronze 5.4:1 — all WCAG AA.

export const garageTokens = {
  // Tier system — drives PremiumBadge V2, IdentityCard accent line,
  // PremiumSheet hero, CoverPicker locked-pip color.
  tier: {
    bronze: '#C58A52',
    bronzeDeep: '#7A4F2E',
    bronzeTint: 'rgba(197,138,82,0.14)',
    silver: '#D6D8DC',
    silverDeep: '#7C8088',
    silverTint: 'rgba(214,216,220,0.14)',
    gold: '#E8B339',
    goldDeep: '#8C6712',
    goldTint: 'rgba(232,179,57,0.16)',
  },
  // Paint system — drives ParkingStallCard rails + tape + chevron + plate.
  paint: {
    free: '#9AA0AC',
    extra: '#E8B339',
    adminGrant: '#4AD4E0',
    asphalt: '#15161A',
    asphaltLine: '#2C2D32',
  },
  // Surface ramp — used by sheets, identity card, stall metadata band.
  surface: {
    base: '#0A0A0A',
    sheet: '#141414',
    alt: '#1F1F1F',
    deep: '#0F0F0F',
    border: '#2A2A2A',
    borderStrong: '#3A3A3A',
  },
  // Brand ramp — sourced from @ccc/design brand.ts; keep in sync.
  brand: {
    base: '#D4AF37',
    deep: '#B8912A',
    soft: '#E8C874',
    tint: 'rgba(212,175,55,0.12)',
  },
  // Rarity ramp — drives HexBadge ring + glyph + tint. Mirrors the
  // `rarityColors()` helper in `.handoffs/.../jdma-garage/badges.jsx`
  // (lines 149–167): common = silver-deep, rare = gold, legendary = brand.
  rarity: {
    common: '#7C8088',
    commonDeep: '#5C5F66',
    commonTint: 'rgba(214,216,220,0.08)',
    rare: '#E8B339',
    rareDeep: '#8C6712',
    rareTint: 'rgba(232,179,57,0.16)',
    legendary: '#D4AF37',
    legendaryDeep: '#B8912A',
    legendaryTint: 'rgba(212,175,55,0.12)',
  },
} as const;

export type GarageTokens = typeof garageTokens;
export type GaragePremiumTier = 'bronze' | 'silver' | 'gold';
export type GarageRarity = 'common' | 'rare' | 'legendary';

export const rarityColors = (rarity: GarageRarity) => {
  if (rarity === 'legendary')
    return {
      main: garageTokens.rarity.legendary,
      deep: garageTokens.rarity.legendaryDeep,
      tint: garageTokens.rarity.legendaryTint,
      label: 'Lendário',
    };
  if (rarity === 'rare')
    return {
      main: garageTokens.rarity.rare,
      deep: garageTokens.rarity.rareDeep,
      tint: garageTokens.rarity.rareTint,
      label: 'Raro',
    };
  return {
    main: garageTokens.rarity.common,
    deep: garageTokens.rarity.commonDeep,
    tint: garageTokens.rarity.commonTint,
    label: 'Comum',
  };
};

export const tierColors = (tier: GaragePremiumTier | null) => {
  if (tier === 'gold')
    return {
      main: garageTokens.tier.gold,
      deep: garageTokens.tier.goldDeep,
      tint: garageTokens.tier.goldTint,
      label: 'Premium Gold',
    };
  if (tier === 'silver')
    return {
      main: garageTokens.tier.silver,
      deep: garageTokens.tier.silverDeep,
      tint: garageTokens.tier.silverTint,
      label: 'Premium Silver',
    };
  if (tier === 'bronze')
    return {
      main: garageTokens.tier.bronze,
      deep: garageTokens.tier.bronzeDeep,
      tint: garageTokens.tier.bronzeTint,
      label: 'Premium Bronze',
    };
  return {
    main: garageTokens.brand.base,
    deep: garageTokens.brand.deep,
    tint: garageTokens.brand.tint,
    label: 'Premium',
  };
};
