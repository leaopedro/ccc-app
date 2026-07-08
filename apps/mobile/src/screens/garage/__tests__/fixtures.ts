// Inline garage fixtures for view-model + interaction tests.
// Mirrors the fixture set named in TASK-D §2 (per-user pivot has not shipped
// shared test-fixtures yet). Keep these payloads schema-shaped — they are
// also valid inputs to garageReadResponseSchema.

import type { GarageBadgeOwnerState } from '@ccc/shared/badges';

import type { GaragePurchaseOption, GarageReadResponse } from '~/api/garage';

const ISO = '2026-05-20T12:00:00.000Z';

const purchaseOption: GaragePurchaseOption = {
  variantId: 'var_garage',
  basePriceCents: 5000,
  displayPriceCents: 5500,
  devFeePercent: 10,
  currency: 'BRL',
};

// Chunk 40 — zero-default progress + stats blocks for owner fixtures. Chunk
// 24 made these `.optional()` on the schema; owner responses always carry
// them when `gamification.enabled === true` (outline §C10). The zero variant
// mirrors a fresh signup that has not earned anything yet.
const progressZero = {
  xp: 0,
  rank: 'Iniciante' as const,
  nextRank: 'Pilotador' as const,
  xpInTier: 0,
  xpToNextRank: 100,
  tierSpan: 100,
};
const statsZero = { events: 0, posts: 0, likesReceived: 0, joinedAt: ISO };

const ownerBase = {
  id: 'g_1',
  name: 'Garagem',
  slug: 'user-abc12345',
  description: null,
  isPublic: false,
  premiumTier: null,
  premiumUntil: null,
  isPremiumActive: false,
  coverPreset: null,
  coverImageObjectKey: null,
  coverImageUrl: null,
  daysLeftUntilExpiry: null,
  createdAt: ISO,
  updatedAt: ISO,
  // §15.6 capability surface — defaults to enabled at the API. Mobile fixtures
  // mirror the server contract so screen tests parse cleanly through
  // garageReadResponseSchema.
  gamification: { enabled: true },
  badges: [] as GarageBadgeOwnerState[],
} as const;

const carCivic = {
  id: 'car_civic',
  make: 'Honda',
  model: 'Civic',
  year: 2002,
  nickname: 'Apelidinho',
  modifications: [],
  photo: null,
  photos: [],
  isPremiumActive: false,
  createdAt: ISO,
  updatedAt: ISO,
};

const carSupra = {
  id: 'car_supra',
  make: 'Toyota',
  model: 'Supra',
  year: 1998,
  nickname: 'Branca',
  modifications: ['turbo'],
  photo: null,
  photos: [],
  isPremiumActive: false,
  createdAt: ISO,
  updatedAt: ISO,
};

export const garageReadFixtureEmptyFirstRun: GarageReadResponse = {
  garage: { ...ownerBase },
  cars: [],
  spots: [{ id: 'sp_1', source: 'default_free', carId: null, createdAt: ISO }],
  availableSlots: 1,
  freeLimit: 1,
  isUnlimited: false,
  gamification: { enabled: true },
  progress: progressZero,
  stats: statsZero,
  purchaseOption,
};

export const garageReadFixtureFreeLimitZero: GarageReadResponse = {
  garage: { ...ownerBase },
  cars: [],
  spots: [],
  availableSlots: 0,
  freeLimit: 0,
  isUnlimited: false,
  gamification: { enabled: true },
  progress: progressZero,
  stats: statsZero,
  purchaseOption,
};

export const garageReadFixtureMixed: GarageReadResponse = {
  garage: { ...ownerBase },
  cars: [carCivic],
  spots: [
    { id: 'sp_1', source: 'default_free', carId: 'car_civic', createdAt: ISO },
    { id: 'sp_2', source: 'purchase', carId: null, createdAt: ISO },
  ],
  availableSlots: 1,
  freeLimit: 1,
  isUnlimited: false,
  gamification: { enabled: true },
  progress: progressZero,
  stats: statsZero,
  purchaseOption,
};

export const garageReadFixtureAllFilled: GarageReadResponse = {
  garage: { ...ownerBase },
  cars: [carCivic, carSupra],
  spots: [
    { id: 'sp_1', source: 'default_free', carId: 'car_civic', createdAt: ISO },
    { id: 'sp_2', source: 'purchase', carId: 'car_supra', createdAt: ISO },
  ],
  availableSlots: 0,
  freeLimit: 1,
  isUnlimited: false,
  gamification: { enabled: true },
  progress: progressZero,
  stats: statsZero,
  purchaseOption,
};

export const garageReadFixtureUnlimited: GarageReadResponse = {
  garage: { ...ownerBase },
  cars: [],
  spots: [],
  availableSlots: 0,
  freeLimit: null,
  isUnlimited: true,
  gamification: { enabled: true },
  progress: progressZero,
  stats: statsZero,
  purchaseOption,
};

// Unlimited garage that already has one filled spot and zero empty spots.
// Without an add-card, the user would have no actionable surface.
export const garageReadFixtureUnlimitedAllFilled: GarageReadResponse = {
  garage: { ...ownerBase },
  cars: [carCivic],
  spots: [{ id: 'sp_1', source: 'default_free', carId: 'car_civic', createdAt: ISO }],
  availableSlots: 0,
  freeLimit: null,
  isUnlimited: true,
  gamification: { enabled: true },
  progress: progressZero,
  stats: statsZero,
  purchaseOption,
};

// Chunk 40 — active owner with non-zero metrics for ProfileStats viewmodel +
// route tests. Killswitch on, progress + stats populated. Has one car so
// `showWelcomeBanner` returns false (not fresh signup).
export const garageReadFixtureActiveOwner: GarageReadResponse = {
  garage: { ...ownerBase },
  cars: [carCivic],
  spots: [{ id: 'sp_1', source: 'default_free', carId: 'car_civic', createdAt: ISO }],
  availableSlots: 0,
  freeLimit: 1,
  isUnlimited: false,
  // Killswitch lives at the response top level per outline §C10 / fix-canon §1.
  gamification: { enabled: true },
  progress: {
    xp: 137,
    rank: 'Pilotador',
    nextRank: 'Veterano',
    xpInTier: 37,
    xpToNextRank: 363,
    tierSpan: 400,
  },
  stats: { events: 3, posts: 5, likesReceived: 12, joinedAt: ISO },
  purchaseOption,
};

// Chunk 40 — killswitch-off variant. Owner payload with the top-level
// gamification flag off and progress/stats absent (mirrors the server's
// §C10 `.optional()` contract).
export const garageReadFixtureKillswitchOff: GarageReadResponse = {
  ...garageReadFixtureMixed,
  // Top-level killswitch off — NOT nested under garage.
  gamification: { enabled: false },
  progress: undefined,
  stats: undefined,
};
