import { carSchema } from '@ccc/shared/cars';
import type { Car as DbCar, CarPhoto as DbPhoto, Garage } from '@prisma/client';

import { computeIsPremiumActive } from '../services/garage/index.js';
import type { Uploads } from '../services/uploads/index.js';

// Garage shape required to compute isPremiumActive. The Prisma include only
// needs to pull premiumTier + premiumUntil; callers can pass `null` when the
// owner has no garage row (defensive: shouldn't happen post-pivot, but the
// serializer must not throw).
export type CarGarageInclude = Pick<Garage, 'premiumTier' | 'premiumUntil'> | null;

export type CarWithPhotos = DbCar & {
  photos: DbPhoto[];
  user?: { garage: CarGarageInclude } | null;
};

export const serializePhoto = (p: DbPhoto, uploads: Uploads) => ({
  id: p.id,
  url: uploads.buildPublicUrl(p.objectKey),
  width: p.width,
  height: p.height,
});

export const serializeCar = (car: CarWithPhotos, uploads: Uploads) => {
  const sorted = car.photos.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const garage = car.user?.garage ?? null;
  const isPremiumActive =
    garage === null ? false : computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
  return carSchema.parse({
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname,
    modifications: car.modifications,
    isPremiumActive,
    createdAt: car.createdAt.toISOString(),
    updatedAt: car.updatedAt.toISOString(),
    photo: sorted[0] ? serializePhoto(sorted[0], uploads) : null,
    photos: sorted.map((p) => serializePhoto(p, uploads)),
  });
};
