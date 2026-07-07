import { GENERAL_SETTINGS_SINGLETON_ID } from '@jdm/shared/general-settings';
import type { Prisma } from '@prisma/client';

// Badge codes — typed loosely as `string[]` since the awarder validates the
// code against `Badge.findUnique`. Eligibility doesn't import the catalog
// (would create a circular dep with the seed/test fixtures); the awarder
// surfaces `unknown badge` if a code drifts out of the seed.
export type BadgeCode = string;

/**
 * Compute the car-surface badges a garage is eligible to earn AFTER the
 * latest `Car.create` lands. Caller is responsible for running this inside
 * the same transaction as the create, then handing each returned code to
 * `awardBadge`.
 *
 * Codes:
 *   - CAR-001 — "Primeiro Carro"     : count(cars) >= 1   (always true here)
 *   - CAR-002 — "Garagem Completa"    : count(default_free spots filled) ===
 *                                       GeneralSettings.defaultFreeGarageSpots
 *                                       (free cap fully consumed). Skipped
 *                                       when the cap is `null` (unlimited).
 *   - CAR-003 — "Curador da Garagem" : count(cars) >= 5   (premium-exclusive)
 *
 * The awarder applies the premium-exclusive gate on CAR-003 separately; this
 * function only computes eligibility, not entitlement.
 */
export const checkEligibility = async (
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<BadgeCode[]> => {
  const codes: BadgeCode[] = [];

  const carCount = await tx.car.count({ where: { userId } });
  if (carCount >= 1) codes.push('CAR-001');
  if (carCount >= 5) codes.push('CAR-003');

  // CAR-002 fires the moment the user has filled every free spot. We compare
  // the count of filled `default_free` spots against the singleton cap; if the
  // cap is null (unlimited) the badge never fires (there is no "full" state).
  const settings = await tx.generalSettings.findUnique({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    select: { defaultFreeGarageSpots: true },
  });
  const freeLimit = settings?.defaultFreeGarageSpots ?? null;
  if (freeLimit !== null && freeLimit > 0) {
    const freeFilled = await tx.garageSpot.count({
      where: { userId, source: 'default_free', carId: { not: null } },
    });
    if (freeFilled >= freeLimit) codes.push('CAR-002');
  }

  return codes;
};
