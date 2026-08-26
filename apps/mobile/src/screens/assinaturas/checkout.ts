// Contratação (checkout) seam.
//
// The SINGLE place that talks to a payment provider from the assinaturas
// module. Platform branching lives here so no screen has to know about it.
//
// iOS App Store rule: Stripe purchase must NOT run on iOS. The screen shows a
// "contract on the web" notice instead. Enforced by eslint-rules/no-stripe-on-ios.cjs.

import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { createPremiumCheckout } from '~/api/premium';

import { resolveCheckoutError, type CheckoutError } from './checkout-error';

export type CheckoutOutcome =
  | { kind: 'redirected' }
  | { kind: 'returned' }
  | { kind: 'ios_unsupported' }
  | { kind: 'error'; error: CheckoutError };

export async function startPremiumCheckout(input: {
  planSlug: string;
  addonKeys: string[];
}): Promise<CheckoutOutcome> {
  if (Platform.OS === 'ios') return { kind: 'ios_unsupported' };

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
  await WebBrowser.openAuthSessionAsync(url);
  return { kind: 'returned' };
}
