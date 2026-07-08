import { prisma } from '@ccc/db';
import type { GarageBadgeOwnerState, GarageBadgePublic } from '@ccc/shared/badges';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { Garage, GarageSpotSource, Prisma } from '@prisma/client';

// Inline the general-settings upsert here so we can run it inside the same
// transaction as reconcile/allocate. The dedicated `ensureGeneralSettings`
// helper uses the global prisma client; reusing it would break tx scoping.
const ensureGeneralSettingsTx = async (tx: Prisma.TransactionClient) =>
  tx.generalSettings.upsert({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    update: {},
    create: { id: GENERAL_SETTINGS_SINGLETON_ID },
  });

// Garage allocation + reconcile services. Free vs extra is derived from
// GarageSpot.source — there is no per-spot tier anymore. See spec §3 + §7.

export type SpotSource = GarageSpotSource;

export const EXTRA_SOURCES: ReadonlyArray<SpotSource> = [
  'purchase',
  'admin_grant',
  'premium_membership',
];

export const isExtraSource = (s: SpotSource): boolean => s !== 'default_free';

export type AllocateResult = { spotId: string; source: SpotSource };

export class GarageFullError extends Error {
  constructor() {
    super('garage_full');
    this.name = 'GarageFullError';
  }
}

const cuidLike = (): string =>
  // Mirrors Prisma's default cuid format closely enough for hand-rolled inserts.
  // We could call `prisma.$queryRaw` for SQL-side cuid generation but Prisma
  // applies its default at the client layer; doing it here keeps the code in
  // application space and serializable-friendly.
  `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

/**
 * Allocates a spot for a newly-created car. Precedence:
 *   1. Oldest empty default_free spot.
 *   2. If freeLimit is null (unlimited), create a new default_free spot.
 *   3. Oldest empty spot whose source is in EXTRA_SOURCES.
 *   4. Else GarageFullError.
 * Returns the spot id + source. The caller is responsible for the surrounding
 * transaction. Source semantics: `default_free` = free; anything else = extra.
 */
export const allocateSpotForCar = async (
  tx: Prisma.TransactionClient,
  userId: string,
  carId: string,
): Promise<AllocateResult> => {
  // 1. Oldest empty default_free spot.
  const freeEmpty = await tx.garageSpot.findFirst({
    where: { userId, carId: null, source: 'default_free' },
    orderBy: { createdAt: 'asc' },
  });
  if (freeEmpty) {
    await tx.garageSpot.update({ where: { id: freeEmpty.id }, data: { carId } });
    return { spotId: freeEmpty.id, source: 'default_free' };
  }

  // 2. Mint a default_free spot when the user has free quota remaining.
  // Covers two cases: (a) unlimited (freeLimit === null), and (b) bounded
  // cap where freeFilled < freeLimit (e.g. fresh signup with no
  // pre-materialized spots, since signup doesn't call reconcile). Step 1
  // already handled any pre-existing empty default_free row, so reaching
  // here means no empty exists; checking freeFilled vs cap is enough to
  // avoid overshoot.
  const settings = await ensureGeneralSettingsTx(tx);
  const freeLimit = settings.defaultFreeGarageSpots;
  if (freeLimit === null) {
    const created = await tx.garageSpot.create({
      data: { id: cuidLike(), userId, source: 'default_free', carId },
    });
    return { spotId: created.id, source: 'default_free' };
  }
  const freeFilled = await tx.garageSpot.count({
    where: { userId, source: 'default_free', carId: { not: null } },
  });
  if (freeFilled < freeLimit) {
    const created = await tx.garageSpot.create({
      data: { id: cuidLike(), userId, source: 'default_free', carId },
    });
    return { spotId: created.id, source: 'default_free' };
  }

  // 3. Oldest empty extra (purchase, admin_grant, premium_membership).
  const extraEmpty = await tx.garageSpot.findFirst({
    where: {
      userId,
      carId: null,
      source: { in: ['purchase', 'admin_grant', 'premium_membership'] },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (extraEmpty) {
    await tx.garageSpot.update({ where: { id: extraEmpty.id }, data: { carId } });
    return { spotId: extraEmpty.id, source: extraEmpty.source };
  }

  throw new GarageFullError();
};

export type ReconcileResult = {
  freeLimit: number | null;
  isUnlimited: boolean;
  added: number;
  removed: number;
};

const MAX_RECONCILE_RETRIES = 3;

const isSerializationConflict = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  const message = (err as { message?: unknown }).message;
  if (code === 'P2034') return true;
  if (typeof message === 'string' && message.toLowerCase().includes('serializ')) return true;
  return false;
};

/**
 * Reconciles a user's default_free empty spots against the current freeLimit.
 * Runs at Serializable isolation. Retries on P2034 up to MAX_RECONCILE_RETRIES.
 * NEVER deletes purchased or admin-granted spots; only `default_free` empties
 * are subject to limit-driven additions/removals. See spec §3.
 */
export const reconcileGarageSpots = async (userId: string): Promise<ReconcileResult> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const settings = await ensureGeneralSettingsTx(tx);
          const freeLimit = settings.defaultFreeGarageSpots;
          const isUnlimited = freeLimit === null;

          if (isUnlimited) {
            // Unlimited: nothing to reconcile. Free spots are minted on demand
            // by allocateSpotForCar.
            return { freeLimit, isUnlimited, added: 0, removed: 0 };
          }

          const freeFilled = await tx.garageSpot.count({
            where: { userId, source: 'default_free', carId: { not: null } },
          });
          const freeEmpty = await tx.garageSpot.findMany({
            where: { userId, source: 'default_free', carId: null },
            orderBy: { createdAt: 'asc' },
          });

          let added = 0;
          let removed = 0;

          const desiredEmpty = Math.max(0, freeLimit - freeFilled);
          if (freeEmpty.length > desiredEmpty) {
            // Trim newest empties first (keep oldest).
            const toRemove = freeEmpty.slice(desiredEmpty);
            await tx.garageSpot.deleteMany({
              where: { id: { in: toRemove.map((s) => s.id) } },
            });
            removed = toRemove.length;
          } else if (freeEmpty.length < desiredEmpty) {
            const toCreate = desiredEmpty - freeEmpty.length;
            for (let i = 0; i < toCreate; i++) {
              await tx.garageSpot.create({
                data: {
                  id: cuidLike(),
                  userId,
                  source: 'default_free',
                  carId: null,
                },
              });
              added += 1;
            }
          }

          return { freeLimit, isUnlimited, added, removed };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (attempt >= MAX_RECONCILE_RETRIES || !isSerializationConflict(err)) throw err;
    }
  }
};

// ── Read shapes ──────────────────────────────────────────────────────────

export const computeIsPremiumActive = (
  premiumTier: Garage['premiumTier'],
  premiumUntil: Garage['premiumUntil'],
  now: Date = new Date(),
): boolean => {
  if (premiumTier === null) return false;
  if (premiumUntil === null) return true;
  return premiumUntil.getTime() > now.getTime();
};

export type GarageOwnerSerialized = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isPublic: boolean;
  premiumTier: Garage['premiumTier'];
  premiumUntil: string | null;
  isPremiumActive: boolean;
  coverPreset: string | null;
  coverImageObjectKey: string | null;
  coverImageUrl: string | null;
  daysLeftUntilExpiry: number | null;
  createdAt: string;
  updatedAt: string;
  gamification: { enabled: boolean };
  badges: GarageBadgeOwnerState[];
};

export type GarageGamificationContext = {
  gamificationEnabled: boolean;
  badges: GarageBadgeOwnerState[];
};

export type GarageGamificationPublicContext = {
  gamificationEnabled: boolean;
  badges: GarageBadgePublic[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const computeDaysLeftUntilExpiry = (
  premiumUntil: Garage['premiumUntil'],
  now: Date = new Date(),
): number | null => {
  if (!premiumUntil) return null;
  const ms = premiumUntil.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
};

export const serializeGarageOwner = (
  g: Garage,
  uploads: { buildPublicUrl: (key: string) => string },
  ctx: GarageGamificationContext,
): GarageOwnerSerialized => {
  const isPremiumActive = computeIsPremiumActive(g.premiumTier, g.premiumUntil);
  return {
    id: g.id,
    name: g.name,
    slug: g.slug,
    description: g.description,
    isPublic: g.isPublic,
    premiumTier: g.premiumTier,
    premiumUntil: g.premiumUntil ? g.premiumUntil.toISOString() : null,
    isPremiumActive,
    coverPreset: g.coverPreset,
    coverImageObjectKey: g.coverImageObjectKey,
    coverImageUrl: g.coverImageObjectKey ? uploads.buildPublicUrl(g.coverImageObjectKey) : null,
    daysLeftUntilExpiry: isPremiumActive ? computeDaysLeftUntilExpiry(g.premiumUntil) : null,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
    gamification: { enabled: ctx.gamificationEnabled },
    badges: ctx.badges,
  };
};

export type GaragePublicSerialized = {
  name: string;
  slug: string;
  description: string | null;
  premiumTier: Garage['premiumTier'];
  isPremiumActive: boolean;
  coverPreset: string | null;
  coverImageUrl: string | null;
  gamification: { enabled: boolean };
  badges: GarageBadgePublic[];
};

export const serializeGaragePublic = (
  g: Garage,
  uploads: { buildPublicUrl: (key: string) => string },
  ctx: GarageGamificationPublicContext,
): GaragePublicSerialized => ({
  name: g.name,
  slug: g.slug,
  description: g.description,
  premiumTier: g.premiumTier,
  isPremiumActive: computeIsPremiumActive(g.premiumTier, g.premiumUntil),
  coverPreset: g.coverPreset,
  coverImageUrl: g.coverImageObjectKey ? uploads.buildPublicUrl(g.coverImageObjectKey) : null,
  gamification: { enabled: ctx.gamificationEnabled },
  badges: ctx.badges,
});

// ── Defaults shared by signup hook + backfill + admin tooling ───────────

/**
 * Derive the neutral default slug for a freshly-minted garage from a user id.
 * Always `user-<id8>`. Never derived from User.name. See spec §2.1, §5.3.
 */
export const defaultGarageSlugForUserId = (userId: string): string => {
  const prefix = userId.slice(0, 8).toLowerCase();
  return `user-${prefix}`;
};

/**
 * Find an unused garage slug starting from `base` by appending `-2`, `-3`, …
 * Collision-safe sibling of the migration backfill loop. Used by signup +
 * account anonymization (the `deleted-<id8>` rewrite).
 */
export const findFreeGarageSlug = async (
  tx: Prisma.TransactionClient,
  base: string,
): Promise<string> => {
  let candidate = base;
  let suffix = 2;
  // Practical bound: a numeric id-prefix collision storm beyond this would
  // indicate something catastrophic.
  while (suffix < 1_000_000) {
    const exists = await tx.garage.findUnique({ where: { slug: candidate } });
    if (!exists) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  throw new Error('findFreeGarageSlug: exhausted slug suffix space');
};
