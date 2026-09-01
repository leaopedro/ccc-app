/**
 * "Money in, nothing out" alert for AbacatePay.
 *
 * AbacatePayClient exposes no refund call, so every settlement failure that
 * happens AFTER the Pix was paid can only be resolved by a human on the
 * provider's dashboard. This is how that human finds out.
 *
 * Lives in services/ rather than inside routes/abacatepay-webhook.ts because
 * the cart settle path is now shared between that route and
 * workers/pix-reconcile.ts — see services/orders/settle-cart.ts. Same tags,
 * same extras, same message shape it always had; alert rules keyed on
 * `kind: pix-manual-refund-needed` keep matching.
 */
import * as Sentry from '@sentry/node';

export type ManualRefundContext = {
  orderId?: string | null;
  cartId?: string | null;
  orderIds?: string[] | null;
  providerRef: string;
  userId: string;
  eventId: string | null;
  reason: string;
};

export const flagManualRefund = (context: ManualRefundContext): void => {
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'pix-manual-refund-needed');
    scope.setTag('provider', 'abacatepay');
    scope.setTag('reason', context.reason);
    scope.setExtras({
      orderId: context.orderId ?? null,
      cartId: context.cartId ?? null,
      orderIds: context.orderIds ?? null,
      providerRef: context.providerRef,
      userId: context.userId,
      eventId: context.eventId,
    });
    Sentry.captureMessage(`abacatepay: manual refund needed (${context.reason})`, 'error');
  });
};
