// Contratação (checkout) seam — HONEST stub for P4.
//
// Multi-tier checkout + provider wiring is P5. This is the SINGLE place P5
// replaces: swap the body of startPremiumCheckout for the real flow (Stripe
// web/Android, RevenueCat iOS). No purchase is faked here — it only informs the
// member that contratação is coming.
//
// iOS App Store rule: Stripe purchase must NOT run on iOS. P5 branches by
// platform here; P4 has no payment SDK calls at all.

import { assinaturasCopy } from '~/copy/assinaturas';
import { showToast } from '~/lib/toast';

// TODO(P5): wire real checkout (Stripe web/Android, RevenueCat iOS).
// Receives the selected plan slug so P5 can resolve the provider price.
export function startPremiumCheckout(planSlug: string): void {
  void planSlug;
  showToast(assinaturasCopy.checkout.comingSoon);
}
