import type { GarageReadResponse } from '~/api/garage';

// Pure predicates for the chunk-14 ListHeaderComponent gating logic. Live
// outside the screen so the branches are unit-testable across the fresh /
// lapsed / active-expiring-today / active / non-empty cases without booting
// expo-router.

export const showWelcomeBanner = (data: GarageReadResponse): boolean =>
  data.cars.length === 0 && !data.garage.isPremiumActive && data.garage.premiumTier === null;

export const showExpiredPremiumNotice = (data: GarageReadResponse): boolean =>
  data.garage.premiumTier !== null && !data.garage.isPremiumActive;

export const hasExtraSpots = (data: GarageReadResponse): boolean =>
  data.spots.some((s) => s.source !== 'default_free');
