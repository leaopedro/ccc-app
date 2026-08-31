// What the order-resume button does once the shared PaymentSheet seam
// resolves. Kept a separate, typed decision — same shape as
// resolveCartSheetOutcomeAction (payments/cart-payment-flow.ts) — so
// "cancelled never renders as an error" is provable by a test, not just
// readable in an if/else inside a big screen component.

import { paymentsCopy } from '~/copy/payments';
import type { PaymentSheetOutcome } from '~/payments/payment-sheet';

export type ResumeSheetOutcomeAction =
  | { kind: 'silent' }
  | { kind: 'error'; text: string }
  | { kind: 'reload' };

export const resolveResumeSheetOutcomeAction = (
  outcome: PaymentSheetOutcome,
): ResumeSheetOutcomeAction => {
  if (outcome.kind === 'cancelled') {
    // A closed sheet is a choice, not a failure — never the error path.
    return { kind: 'silent' };
  }
  if (outcome.kind === 'failed') {
    // Stripe has no distinct code for "the PaymentIntent was already
    // cancelled" (e.g. the order-expiry worker got to it first) — it comes
    // back as a plain `Failed` like any other decline. This still resolves
    // to an intelligible, worded failure rather than a bare/silent one; the
    // member's retry then hits the order's real status through resumeOrder.
    return { kind: 'error', text: paymentsCopy.sheet.failed };
  }
  // 'paid' on the sheet still waits on the webhook to flip the order; the
  // caller only reloads the list, it never writes order state itself.
  return { kind: 'reload' };
};
