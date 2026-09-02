// Contratação (checkout) seam.
//
// The SINGLE place that talks to a payment provider from the assinaturas
// module. Platform branching lives here so no screen has to know about it.
//
// Until 2026-08-29 iOS returned `ios_unsupported` and the screen rendered a
// "contract on the website" notice. That notice was in-app steering to an
// external purchase method on the Brazil storefront, which the 3.1.3 chapeau
// forbids outright (the exception is US-storefront only). iOS now pays through
// the native PaymentSheet — when the build actually carries a publishable key
// to mount StripeProvider with. Without one the sheet cannot exist at all, and
// iOS reports the contratação as unavailable rather than opening a hosted
// checkout: while the caixa flag is off this membership ships as cosmetics
// only, so steering to a web purchase would be the very 3.1.3 violation the
// paragraph above describes. Supplying the key is a human prerequisite this
// code cannot satisfy for itself; see the note at the branch.
//
// Android stays on the hosted browser flow below, same as before this
// branch and same as PremiumScreen.tsx's onSubscribeAndroid — whether
// Android also migrates to the sheet is a product decision parked on a
// human (final review I1), not something to decide in code.
//
// Stripe's success_url is a fixed https URL (apps/api me-premium.ts), never
// a deep link, so the "did it come back via deep link?" signal
// openAuthSessionAsync is built around can never fire here; `result.type`
// is therefore never 'success' and must not be branched on.
//
// openAuthSessionAsync is still the right call to make, though: on
// Android, expo-web-browser implements it as a Promise.race between (a)
// waiting for the deep-link redirect (never resolves, see above) and (b)
// _openBrowserAndWaitAndroidAsync, which opens the tab and does not
// resolve until AppState returns to 'active', meaning the tab has actually
// been closed. (See node_modules/expo-web-browser/src/WebBrowser.ts,
// `_openAuthSessionPolyfillAsync`.) That AppState wait is exactly the
// "block until the tab closes" behavior this flow needs before polling.
//
// openBrowserAsync does NOT provide that: on Android it resolves the
// instant the tab opens ({type: 'opened'}), per that same file's own
// comment ("openBrowserAsync on Android doesn't wait until closed, so we
// need to polyfill it with AppState"). Using it directly here previously
// caused polling to start immediately, racing the poller's budget against
// a member who hasn't finished paying yet. Do not reintroduce that call.

import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { createPremiumCheckout, createPremiumSubscriptionNative } from '~/api/premium';

import { assinaturasCopy } from '~/copy/assinaturas';

import { resolveCheckoutError, type CheckoutError } from './checkout-error';

/**
 * Whether this build actually carries a Stripe publishable key.
 *
 * Same signal the cart uses (app/(app)/cart/index.tsx STRIPE_AVAILABLE) and the
 * same one `shouldMountStripeProvider` gates the provider on: with no key,
 * StripeProvider never mounts, so `usePaymentSheet` can never present a sheet.
 *
 * Read at call time, not at import time, so the value tracks the runtime config
 * rather than module-load order.
 */
const hasStripePublishableKey = (): boolean =>
  (
    (Constants.expoConfig?.extra as { stripePublishableKey?: string } | undefined)
      ?.stripePublishableKey ?? ''
  ).length > 0;

export type CheckoutOutcome =
  | { kind: 'redirected' }
  | { kind: 'returned' }
  | { kind: 'sheet'; clientSecret: string }
  | { kind: 'error'; error: CheckoutError };

export async function startPremiumCheckout(input: {
  planSlug: string;
  addonKeys: string[];
}): Promise<CheckoutOutcome> {
  // iOS only, and only when a publishable key exists: create the subscription
  // server-side and drive Task 4's PaymentSheet with its first invoice's
  // client secret. The subscription is `payment_behavior:
  // 'default_incomplete'` — nothing is charged and no membership exists until
  // the sheet confirms and the `invoice.paid` webhook lands.
  //
  // Final review C1: the key check must happen BEFORE the server call. Without
  // it, a keyless build (eas.json `production` ships no
  // EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY) created a real Stripe subscription and
  // a `pending` attempt row, and only then failed to present a sheet that
  // could never mount — a generic error for the member plus an attempt lock
  // that blocks switching plans (409 SubscriptionAttemptInFlight). Deciding
  // first means a keyless build never creates either.
  if (Platform.OS === 'ios') {
    if (!hasStripePublishableKey()) {
      // Fix round 3. iOS must NOT fall through to the hosted browser flow.
      //
      // Round 2 sent a keyless iOS build to `WebBrowser.openAuthSessionAsync`,
      // reasoning that a working purchase beats a dead end. That reasoning is
      // wrong for THIS product on THIS platform. With EXPO_PUBLIC_CAIXA_ENABLED
      // absent from both eas profiles, the shipped membership is `capas
      // personalizadas` plus `selo Premium` (copy/garage.ts premiumBenefits) —
      // in-app cosmetics, with no physical component. A digital subscription
      // sold through an in-app link to an external checkout is the 3.1.3
      // chapeau violation this branch exists to remove, and it is worse than
      // an error because it actually completes.
      //
      // The cart keeps its hosted fallback on purpose: it sells physical goods
      // and event tickets, where 3.1.3(e) REQUIRES a non-IAP method. That
      // carve-out does not reach a cosmetics-only membership.
      //
      // Setting EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY on the production profile
      // restores the native PaymentSheet and makes this branch unreachable.
      // That is the real remedy; this only refuses to violate in its absence.
      return {
        kind: 'error',
        error: { reason: 'unavailable', message: assinaturasCopy.contratar.errorUnavailable },
      };
    }
    try {
      const intent = await createPremiumSubscriptionNative(input);
      return { kind: 'sheet', clientSecret: intent.clientSecret };
    } catch (err) {
      // Same mapper as the hosted path below: checkout-native shares
      // resolveSubscriptionPackage with checkoutHandler on the API side, so
      // it returns the identical 503/409/422/403/404 shapes.
      return { kind: 'error', error: resolveCheckoutError(err) };
    }
  }

  let url: string;
  try {
    const session = await createPremiumCheckout(input);
    url = session.url;
  } catch (err) {
    // Keep the status and body. Collapsing them into `err.message` here is what
    // made every failure read as the same generic sentence: authedRequest
    // throws ApiError with the literal message 'request failed' for every
    // non-2xx, so the message carried no information at all.
    return { kind: 'error', error: resolveCheckoutError(err) };
  }

  if (Platform.OS === 'web') {
    window.location.href = url;
    return { kind: 'redirected' };
  }

  // Android only: hosted browser flow, restored to its pre-branch behaviour.
  // iOS can no longer reach this line — see the 3.1.3 note above.
  await WebBrowser.openAuthSessionAsync(url);
  return { kind: 'returned' };
}
