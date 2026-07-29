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

/** Deep link the Android auth session returns to. Mirrors the legacy PremiumScreen. */
const DEEP_LINK_RETURN = 'ccc://premium/return';

export type CheckoutOutcome =
  | { kind: 'redirected' }
  | { kind: 'returned' }
  | { kind: 'dismissed' }
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

  const result = await WebBrowser.openAuthSessionAsync(url, DEEP_LINK_RETURN);
  return result.type === 'success' ? { kind: 'returned' } : { kind: 'dismissed' };
}
