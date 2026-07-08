import {
  badgeCodeSchema,
  garageBadgesOwnerResponseSchema,
  type GarageBadgesOwnerResponse,
} from '@ccc/shared/badges';
import {
  garageCoverPatchSchema,
  garageOwnerSchema,
  garagePatchSchema,
  garageReadSchema,
  type GarageCoverPatch,
  type GaragePatch,
} from '@ccc/shared/garage';
import { garageCoverPresetSchema } from '@ccc/shared/garage-covers';
import { z } from 'zod';

import { authedRequest } from './client';

// Local mirror of the purchase-option contract.
//
// Source of truth (post-merge): TASK-C / TASK-B-prime publishes the shape
// into `@ccc/shared/garage` (variantId, basePriceCents, displayPriceCents,
// devFeePercent, currency). API merge ordering decides whether TASK-C or
// this PR lands first; the mirror lets the buy-spot UI ship in parallel.
//
// Swap procedure once TASK-C ships the shared schema:
//   1. Delete this `garagePurchaseOptionSchema` + `GaragePurchaseOption`.
//   2. Import them from `@ccc/shared/garage`.
//   3. Update `garageReadResponseSchema` below to extend with the shared
//      type.
//   4. Verify shapes match — if TASK-C diverges (new fields, renamed
//      `currency`, etc.), update call sites (ParkingStallCard buy-state +
//      fixtures) in the same PR.
export const garagePurchaseOptionSchema = z.object({
  variantId: z.string().min(1),
  basePriceCents: z.number().int().nonnegative(),
  displayPriceCents: z.number().int().nonnegative(),
  devFeePercent: z.number().nonnegative(),
  currency: z.literal('BRL'),
});
export type GaragePurchaseOption = z.infer<typeof garagePurchaseOptionSchema>;

// Extended garage payload: shared schema today does not include the
// purchase option; surface it as optional so the API can start returning
// it without a client rev. The buy-spot UI treats it as required at use
// site (suppressed when absent). Inferred type carries the optional
// `purchaseOption` field cleanly through exactOptionalPropertyTypes.
export const garageReadResponseSchema = garageReadSchema.extend({
  purchaseOption: garagePurchaseOptionSchema.optional(),
});
export type GarageReadResponse = z.infer<typeof garageReadResponseSchema>;

// Local mirror of the POST /me/garage/spots/cart contract. TASK-C/TASK-B-prime
// owns this endpoint. Swap to shared once published.
export const garageCartResponseSchema = z.object({
  cartId: z.string().min(1),
  itemId: z.string().min(1),
});
export type GarageCartResponse = z.infer<typeof garageCartResponseSchema>;

export const garagePatchResponseSchema = z.object({ garage: garageOwnerSchema });
export type GaragePatchResponse = z.infer<typeof garagePatchResponseSchema>;

export const getGarage = (): Promise<GarageReadResponse> =>
  authedRequest('/me/garage', garageReadResponseSchema);

export const addGarageSpotToCart = (): Promise<GarageCartResponse> =>
  authedRequest('/me/garage/spots/cart', garageCartResponseSchema, {
    method: 'POST',
    body: {},
  });

export const patchGarage = (input: GaragePatch): Promise<GaragePatchResponse> =>
  authedRequest('/me/garage', garagePatchResponseSchema, {
    method: 'PATCH',
    body: garagePatchSchema.parse(input),
  });

// Local mirror of the GET /me/garage/cover/presets contract.
//
// Source-of-truth note: `@ccc/shared` does not yet export a presets-response
// schema (the server resolves each preset's R2 image URL into the response
// body). Mirror lives here so the picker can ship without a shared rev; once
// chunk 09's contract stabilizes, lift this into `@ccc/shared/garage-covers`
// and import here instead.
export const garageCoverPresetItemSchema = z.object({
  slug: garageCoverPresetSchema,
  label: z.string().min(1),
  premium: z.boolean(),
  imageUrl: z.string().url(),
});
export type GarageCoverPresetItem = z.infer<typeof garageCoverPresetItemSchema>;

export const garageCoverPresetsResponseSchema = z.object({
  presets: z.array(garageCoverPresetItemSchema),
});
export type GarageCoverPresetsResponse = z.infer<typeof garageCoverPresetsResponseSchema>;

export const getCoverPresets = (): Promise<GarageCoverPresetsResponse> =>
  authedRequest('/me/garage/cover/presets', garageCoverPresetsResponseSchema);

export const patchGarageCover = (patch: GarageCoverPatch): Promise<GaragePatchResponse> =>
  authedRequest('/me/garage/cover', garagePatchResponseSchema, {
    method: 'PATCH',
    body: garageCoverPatchSchema.parse(patch),
  });

// Chunk 19 — Conquistas owner-state read.
// GET /me/garage/badges returns the same `{ enabled, catalog, badges }`
// shape exposed under `GarageOwner.{gamification, badges}` on the main
// `GET /me/garage` payload, but is a standalone refetch surface so the
// route can re-sync after a pin/unpin without re-pulling the whole garage.
export const getMyBadges = (): Promise<GarageBadgesOwnerResponse> =>
  authedRequest('/me/garage/badges', garageBadgesOwnerResponseSchema);

// Chunk 19 — Conquistas pin/unpin toggle.
// PATCH /me/garage/badges/:code/pin body `{ pinned: boolean }`.
// Server enforces the 3-pin cap under a serializable tx + returns
// `409 { error: 'pin_limit' }` when transitioning the 4th badge to pinned.
// Callers are responsible for re-reading badges state on success.
const togglePinResponseSchema = z.object({
  badge: z.object({
    code: badgeCodeSchema,
    earnedAt: z.string().datetime(),
    pinned: z.boolean(),
    pinnedAt: z.string().datetime().nullable(),
  }),
});
export type TogglePinResponse = z.infer<typeof togglePinResponseSchema>;

export const togglePinBadge = (code: string, pinned: boolean): Promise<TogglePinResponse> =>
  authedRequest(`/me/garage/badges/${encodeURIComponent(code)}/pin`, togglePinResponseSchema, {
    method: 'PATCH',
    body: { pinned },
  });
