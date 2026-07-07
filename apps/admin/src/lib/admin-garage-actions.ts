'use server';

import type {
  AdminGaragePatchInput,
  AdminGaragePremiumInput,
  AdminGarageSpotRevokeBody,
  AdminGarageSummary,
  AdminGarageSpotRow,
} from '@jdm/shared/admin-garage';
import { adminXpAdjustmentSchema, type AdminXpAdjustmentInput } from '@jdm/shared/admin-garage-xp';
import { revalidatePath } from 'next/cache';

import {
  adjustGarageXp,
  grantAdminUserBadge,
  grantAdminUserGarageSpot,
  patchAdminUserGarage,
  revokeAdminUserGarageSpot,
  setAdminUserGaragePremium,
} from './admin-garage-api';
import { ApiError } from './api';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const errFromApi = (err: unknown, fallback: string): string => {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Não encontrado.';
    if (err.status === 403) return 'Sem permissão.';
    if (err.status === 409) {
      if (err.code === 'slug_taken') return 'Slug já está em uso.';
      return 'Operação não permitida (conflito).';
    }
    if (err.status === 400) {
      if (err.code === 'reserved_slug') return 'Slug reservado, escolha outro.';
      return err.message || 'Dados inválidos.';
    }
    return err.message || fallback;
  }
  return fallback;
};

export const setAdminUserGaragePremiumAction = async (
  userId: string,
  input: AdminGaragePremiumInput,
): Promise<Result<AdminGarageSummary>> => {
  try {
    const data = await setAdminUserGaragePremium(userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao atualizar premium.') };
  }
};

export const patchAdminUserGarageAction = async (
  userId: string,
  input: AdminGaragePatchInput,
): Promise<Result<AdminGarageSummary>> => {
  try {
    const data = await patchAdminUserGarage(userId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao atualizar garagem.') };
  }
};

export const grantAdminUserGarageSpotAction = async (
  userId: string,
): Promise<Result<AdminGarageSpotRow>> => {
  try {
    const data = await grantAdminUserGarageSpot(userId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao adicionar vaga.') };
  }
};

export const revokeAdminUserGarageSpotAction = async (
  userId: string,
  spotId: string,
  body: AdminGarageSpotRevokeBody = {},
): Promise<Result<null>> => {
  try {
    await revokeAdminUserGarageSpot(userId, spotId, body);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao remover vaga.') };
  }
};

// Map the chunk-18 grant route's 409 reasons to PT-BR copy so the panel
// can surface them inline. `gamification_disabled` shows up only when the
// global killswitch is off — admin still gets a friendly explanation.
const errFromBadgeGrantApi = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Usuário não encontrado.';
    if (err.status === 400 && err.code === 'invalid_code') return 'Código de conquista inválido.';
    if (err.status === 409) {
      if (err.code === 'already_earned') return 'Conquista já concedida.';
      if (err.code === 'gamification_disabled') return 'Conquistas desativadas globalmente.';
      if (err.code === 'premium_required') return 'Esta conquista requer Premium.';
      return 'Operação não permitida (conflito).';
    }
    if (err.status === 429) return 'Muitas tentativas. Aguarde um minuto.';
    return err.message || 'Falha ao conceder conquista.';
  }
  return 'Falha ao conceder conquista.';
};

export const grantAdminUserBadgeAction = async (
  userId: string,
  code: string,
): Promise<Result<null>> => {
  try {
    await grantAdminUserBadge(userId, code);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: errFromBadgeGrantApi(err) };
  }
};

// Admin XP adjustment server action (chunk 35). Re-validates the body
// server-side via the shared zod schema, calls the admin fetcher, and
// invalidates the user-detail page cache so the refreshed xp renders without
// a manual reload. Returns the file-wide discriminated `Result<T>` envelope
// with the API error `code` preserved on the `{ ok: false }` branch, so the
// modal can branch on the canonical 409 `gamification_disabled` / 400
// `invalid_delta` codes. Custom Error subclasses are NOT used: Next.js server
// actions serialize thrown errors via RSC and strip non-standard fields like
// `status` / `body`, so the modal would otherwise lose the canonical code.
export type AdjustAdminUserGarageXpResult =
  | { ok: true; data: { xp: number } }
  | { ok: false; status: number; code: string };

export const adjustAdminUserGarageXpAction = async (
  userId: string,
  input: AdminXpAdjustmentInput,
): Promise<AdjustAdminUserGarageXpResult> => {
  // safeParse so a malformed direct invocation surfaces through the result
  // envelope instead of throwing across the RSC boundary. Modal already
  // pre-validates client-side; the server-side parse is defense in depth.
  const parsedResult = adminXpAdjustmentSchema.safeParse(input);
  if (!parsedResult.success) {
    return { ok: false, status: 400, code: 'invalid_body' };
  }
  try {
    const data = await adjustGarageXp(userId, parsedResult.data);
    revalidatePath(`/users/${userId}`);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, status: err.status, code: err.code };
    }
    throw err;
  }
};
