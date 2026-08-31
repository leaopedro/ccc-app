// Pure decisions over the cart's checkout/payment flow. The cart screen
// executes; this decides. Keeps the branching testable without rendering a
// 1300-line screen.

import { paymentsCopy } from '~/copy/payments';
import type { PaymentSheetOutcome } from '~/payments/payment-sheet';

export type CartPaymentAction =
  | { kind: 'pix'; orderId: string; brCode: string; expiresAt: string }
  | { kind: 'sheet'; clientSecret: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'error' };

export const resolveCartPaymentAction = (args: {
  paymentMethod: 'card' | 'pix';
  isWeb: boolean;
  clientSecret: string | null;
  checkoutUrl: string | null;
  brCode: string | null;
  reservationExpiresAt: string | null;
  firstOrderId: string | undefined;
}): CartPaymentAction => {
  if (args.paymentMethod === 'pix') {
    if (!args.brCode || !args.reservationExpiresAt || !args.firstOrderId) return { kind: 'error' };
    return {
      kind: 'pix',
      orderId: args.firstOrderId,
      brCode: args.brCode,
      expiresAt: args.reservationExpiresAt,
    };
  }
  if (args.isWeb) {
    return args.checkoutUrl ? { kind: 'redirect', url: args.checkoutUrl } : { kind: 'error' };
  }
  // Native card. Falling back to checkoutUrl here would open a hosted session
  // for a cart that already has a PaymentIntent — two payment paths, one cart,
  // and the second charge invisible to charge.refunded.
  return args.clientSecret ? { kind: 'sheet', clientSecret: args.clientSecret } : { kind: 'error' };
};

// What the cart screen does once the PaymentSheet resolves. Kept a separate,
// typed decision so "cancelled never renders as an error" is provable by a
// test, not just readable in an if/else inside a 1300-line component.
export type CartSheetOutcomeAction =
  | { kind: 'message'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'navigate' };

export const resolveCartSheetOutcomeAction = (
  outcome: PaymentSheetOutcome,
): CartSheetOutcomeAction => {
  if (outcome.kind === 'cancelled') {
    // A closed sheet is a choice, not a failure — never the error path.
    return { kind: 'message', text: paymentsCopy.sheet.cancelled };
  }
  if (outcome.kind === 'failed') {
    return { kind: 'error', text: paymentsCopy.sheet.failed };
  }
  // 'paid' on the sheet still waits on the webhook to flip the order; the
  // screen only navigates, it never writes order state itself.
  return { kind: 'navigate' };
};
