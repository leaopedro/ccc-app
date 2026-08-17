// Caixa — locked catalog card badge label (pure helper, kept out of
// CatalogItemCard.tsx so it can be unit-tested without a react-native
// transform).

import type { GaragePremiumTier } from '@ccc/shared/garage';

export function lockedBadgeLabel(minTier: GaragePremiumTier | null): string | null {
  if (!minTier) return null;
  return `${minTier.charAt(0).toUpperCase()}${minTier.slice(1)}+`;
}
