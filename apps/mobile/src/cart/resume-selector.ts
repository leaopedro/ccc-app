// Render-time decision for the /profile/orders resume CTA.
//
// Stripe Checkout Session orders created from web have no PaymentIntent
// (Order.providerRef = null), so /orders/:id/resume returns 409 for
// them. On web we instead reopen the hosted Checkout URL captured at
// creation time and stored in sessionStorage against the canonical
// (first) order id of the cart. Sibling orders intentionally have no
// stored URL — see web-stripe-redirect.ts — so we hide the CTA for
// them rather than rendering a button that cannot resolve. The
// click-time freshness check lives in resume-web-checkout.ts.

import type { MyOrder } from '@jdm/shared/orders';

export type ResumeKind = 'pix' | 'web' | 'native-stripe' | 'none';

export interface ResumeContext {
  platform: 'web' | 'native';
  hasStoredCheckoutUrl: boolean;
  stripeAvailable: boolean;
}

export function selectResumeKind(order: Pick<MyOrder, 'provider'>, ctx: ResumeContext): ResumeKind {
  if (order.provider === 'abacatepay') return 'pix';
  if (ctx.platform === 'web') {
    return ctx.hasStoredCheckoutUrl ? 'web' : 'none';
  }
  if (ctx.stripeAvailable) return 'native-stripe';
  return 'none';
}
