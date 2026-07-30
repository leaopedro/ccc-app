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

export type CheckoutOutcome =
  | { kind: 'redirected' }
  | { kind: 'returned' }
  | { kind: 'ios_unsupported' }
  | { kind: 'error'; message: string };

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
    return { kind: 'error', message: err instanceof Error ? err.message : 'checkout failed' };
  }

  if (Platform.OS === 'web') {
    window.location.href = url;
    return { kind: 'redirected' };
  }

  // Stripe's success_url is a fixed https URL (apps/api me-premium.ts), never
  // the app's deep link, so an auth-session's "did it come back via deep
  // link?" signal can never fire here. openBrowserAsync has no notion of a
  // successful close either way; it only resolves once the tab is dismissed,
  // for any reason. So any close is treated the same: go poll
  // pollSubscriptionActive, the only thing that actually knows whether the
  // payment went through.
  await WebBrowser.openBrowserAsync(url);
  return { kind: 'returned' };
}
