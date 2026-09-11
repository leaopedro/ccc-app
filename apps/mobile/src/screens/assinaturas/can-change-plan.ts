// Shared gate for the three purchase-flow entry points (PlanosScreen,
// ContratarScreen, PlanoDetalheScreen) that decide whether a member should be
// steered to AlterarPlanoScreen instead of a fresh checkout.
//
// `subscription.active` is true for ANY live membership — past_due and paused
// included. Gating on `active` alone would redirect a past_due member into
// AlterarPlanoScreen, which blocks that status outright (see
// AlterarPlanoScreen's own InvalidStatus guard) and would strand them: the
// current 409 AlreadySubscribed path on ContratarScreen is what surfaces
// GERENCIAR ASSINATURA, the Stripe portal link where they actually fix the
// failed card. So this checks `status` too, and only these two statuses may
// go through.

import type { MySubscriptionResponse } from '@ccc/shared/premium-subscription';

/** Troca de plano exige membership viva E em dia. past_due e paused ficam de fora. */
export const canChangePlan = (sub: MySubscriptionResponse | null): boolean =>
  Boolean(sub?.active && (sub.status === 'active' || sub.status === 'cancel_scheduled'));
