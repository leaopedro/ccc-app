// The single PaymentSheet configuration for the whole app. Cart, subscription
// and order resumption all go through here, so a fix to one is a fix to three.
//
// No dedicated Apple Pay button: the sheet surfaces the wallet by itself when
// `applePay` is declared here AND `merchantIdentifier` reached StripeProvider
// (app.config.ts → extra.stripeMerchantIdentifier → app/_layout.tsx).
//
// Google Pay is deliberately absent. In @stripe/stripe-react-native 0.50.3 it
// is opt-in (`googlePay?: GooglePayParams`, PaymentSheet.d.ts:18), not on by
// default. Adding it is a product decision, tracked as H4 / Task 13.

import { brand } from '@ccc/design';
import { PaymentSheetError, useStripe } from '@stripe/stripe-react-native';
import type { SetupParams } from '@stripe/stripe-react-native';
import { Platform } from 'react-native';

export type PaymentSheetOutcome =
  | { kind: 'paid' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code?: string };

/**
 * Where the 3DS web view hands control back. `brand.app.scheme` is 'ccc' and is
 * the same value app.config.ts registers as the app scheme, so the OS routes
 * this back into the app.
 */
export const PAYMENT_SHEET_RETURN_URL = `${brand.app.scheme}://stripe-redirect`;

export const buildPaymentSheetConfig = (args: {
  clientSecret: string;
  platform: string;
}): SetupParams => ({
  paymentIntentClientSecret: args.clientSecret,
  merchantDisplayName: brand.name,
  returnURL: PAYMENT_SHEET_RETURN_URL,
  // Nothing we sell settles asynchronously through the sheet. Pix has its own
  // flow (AbacatePay), so delayed methods would only add ways to be told
  // "paid" before the money exists.
  allowsDelayedPaymentMethods: false,
  ...(args.platform === 'ios' ? { applePay: { merchantCountryCode: 'BR' } } : {}),
});

export const resolveSheetOutcome = (
  error: { code?: string } | null | undefined,
): PaymentSheetOutcome => {
  if (!error) return { kind: 'paid' };
  if (error.code === PaymentSheetError.Canceled) return { kind: 'cancelled' };
  return error.code ? { kind: 'failed', code: error.code } : { kind: 'failed' };
};

/** Init + present, collapsed into one call with one outcome union. */
export const usePaymentSheet = () => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const pay = async (clientSecret: string): Promise<PaymentSheetOutcome> => {
    const { error: initError } = await initPaymentSheet(
      buildPaymentSheetConfig({ clientSecret, platform: Platform.OS }),
    );
    if (initError) return resolveSheetOutcome(initError);
    const { error: presentError } = await presentPaymentSheet();
    return resolveSheetOutcome(presentError);
  };

  return { pay };
};
