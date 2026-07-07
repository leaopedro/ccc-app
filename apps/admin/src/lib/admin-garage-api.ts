import {
  adminGarageReadSchema,
  adminGarageSpotRowSchema,
  adminGarageSummarySchema,
  type AdminGaragePatchInput,
  type AdminGaragePremiumInput,
  type AdminGarageSpotRevokeBody,
} from '@jdm/shared/admin-garage';
import type { AdminXpAdjustmentInput } from '@jdm/shared/admin-garage-xp';
import { z } from 'zod';

import { apiFetch } from './api';

const adminXpAdjustmentResponseSchema = z.object({ xp: z.number().int() });

// Wire shape returned by POST /admin/users/:id/garage/badges/:code/grant
// when the award succeeds (chunk 18). The error branch is mapped to
// ApiError by `apiFetch` and handled in admin-garage-actions.
const adminBadgeGrantResponseSchema = z.object({
  awarded: z.literal(true),
  code: z.string(),
});

export const getAdminUserGarage = (userId: string) =>
  apiFetch(`/admin/users/${userId}/garage`, { schema: adminGarageReadSchema });

export const setAdminUserGaragePremium = (userId: string, input: AdminGaragePremiumInput) =>
  apiFetch(`/admin/users/${userId}/garage/premium`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminGarageSummarySchema,
  });

export const patchAdminUserGarage = (userId: string, input: AdminGaragePatchInput) =>
  apiFetch(`/admin/users/${userId}/garage`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminGarageSummarySchema,
  });

export const grantAdminUserGarageSpot = (userId: string) =>
  apiFetch(`/admin/users/${userId}/garage/spots`, {
    method: 'POST',
    body: JSON.stringify({}),
    schema: adminGarageSpotRowSchema,
  });

export const revokeAdminUserGarageSpot = (
  userId: string,
  spotId: string,
  body: AdminGarageSpotRevokeBody = {},
) =>
  apiFetch(`/admin/users/${userId}/garage/spots/${spotId}`, {
    method: 'DELETE',
    body: JSON.stringify(body),
    schema: z.unknown(),
  });

// Manual badge grant. Body is empty per chunk-18 contract. The route is
// rate-limited server-side (30/min/admin) and the awarder runs with
// `allowAdminOverride: true` so premium-exclusive specs are reachable.
export const grantAdminUserBadge = (userId: string, code: string) =>
  apiFetch(`/admin/users/${userId}/garage/badges/${code}/grant`, {
    method: 'POST',
    schema: adminBadgeGrantResponseSchema,
  });

// Admin XP adjustment (chunk 35). Body is { delta, reason }; route is
// admin-only and rate-limited 30/min/admin in its own bucket. Server returns
// `{ xp }` with the post-adjustment Garage.xp on success; non-OK responses
// surface as `ApiError` so the modal can branch on `body.error`.
export const adjustGarageXp = (userId: string, input: AdminXpAdjustmentInput) =>
  apiFetch(`/admin/users/${userId}/garage/xp-adjustment`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminXpAdjustmentResponseSchema,
  });
