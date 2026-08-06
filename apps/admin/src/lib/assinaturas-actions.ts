'use server';

import type { AdminSubscriptionDetail } from '@ccc/shared/admin-subscription';

import {
  attachAdminSubscriptionAddon,
  cancelAdminSubscription,
  changeAdminSubscriptionPlan,
  detachAdminSubscriptionAddon,
  getAdminSubscription,
  pauseAdminSubscription,
  resumeAdminSubscription,
} from './admin-api';
import { ApiError } from './api';

/**
 * pending diz se o valor novo ja esta no banco.
 *
 * false: vinculo e desvinculo de modulo, que gravam na hora.
 * true: troca de plano, cancelar, retomar e pausar, que so chamam a Stripe. O
 * banco so muda quando o webhook chegar, entao a tela nao pode antecipar.
 */
export type AssinaturaActionResult = { ok: true; pending: boolean } | { ok: false; error: string };

export async function fetchAdminSubscription(id: string): Promise<AdminSubscriptionDetail> {
  return getAdminSubscription(id);
}

const run = async (
  fn: () => Promise<{ pending: boolean }>,
): Promise<AssinaturaActionResult> => {
  try {
    const res = await fn();
    return { ok: true, pending: res.pending };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};

export async function changePlanAction(
  id: string,
  tier: 'bronze' | 'silver' | 'gold',
  cadence: 'monthly' | 'annual',
): Promise<AssinaturaActionResult> {
  return run(() => changeAdminSubscriptionPlan(id, { tier, cadence }));
}

export async function attachAddonAction(
  id: string,
  addonKey: string,
): Promise<AssinaturaActionResult> {
  return run(() => attachAdminSubscriptionAddon(id, { addonKey }));
}

export async function detachAddonAction(
  id: string,
  addonKey: string,
): Promise<AssinaturaActionResult> {
  return run(() => detachAdminSubscriptionAddon(id, addonKey));
}

export async function cancelSubscriptionAction(id: string): Promise<AssinaturaActionResult> {
  return run(() => cancelAdminSubscription(id));
}

export async function resumeSubscriptionAction(id: string): Promise<AssinaturaActionResult> {
  return run(() => resumeAdminSubscription(id));
}

export async function pauseSubscriptionAction(id: string): Promise<AssinaturaActionResult> {
  return run(() => pauseAdminSubscription(id));
}
