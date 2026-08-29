import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { resolveCaixaSlot, type PremiumSlot } from '~/navigation/caixa-slot';
import { isCaixaBuildEnabled } from '~/screens/caixa/caixa-enabled';

import { usePremiumPlans } from './usePremiumPlans';
import { usePremiumSubscription } from './usePremiumSubscription';

const SEED_KEY = 'caixa.premiumActive';

export function usePremiumSlot(): { slot: PremiumSlot } {
  const { subscription, loading, error, refresh } = usePremiumSubscription();
  // Platform gate from the plans catalog (public, unauthed). Read fresh on
  // every foreground below instead of cached, so ops can flip it off during a
  // live App Store rejection without shipping a new binary. `subscriptionsEnabled`
  // defaults to false until the first fetch resolves, which is also the
  // fail-closed behavior we want while loading.
  const { subscriptionsEnabled, refresh: refreshPlans } = usePremiumPlans();
  const [seed, setSeed] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(SEED_KEY).then((v) => setSeed(v === 'true'));
  }, []);

  // Re-check membership and the subscriptions gate when the app returns to
  // the foreground. Activation (Android checkout), revocation, and a
  // server-side gate flip all happen outside this layout's mounted lifetime,
  // so without this the slot stays stale until a remount.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
        void refreshPlans();
      }
    });
    return () => sub.remove();
  }, [refresh, refreshPlans]);

  const caixaEnabled = isCaixaBuildEnabled();
  const resolvedActive = subscription?.active ?? false;

  // Persist only a KNOWN-GOOD value. A failed request leaves `subscription`
  // null with `error` set; writing that would clobber a cached `true` and hide
  // Caixa from an active member on this and every later launch.
  useEffect(() => {
    if (loading || error) return;
    void AsyncStorage.setItem(SEED_KEY, resolvedActive ? 'true' : 'false');
  }, [loading, error, resolvedActive]);

  // Until a fresh successful value lands, trust the cached seed — this avoids a
  // flicker and stops a transient error from reading as "inactive".
  const premiumActive = loading || error ? (seed ?? false) : resolvedActive;
  return { slot: resolveCaixaSlot({ caixaEnabled, premiumActive, subscriptionsEnabled }) };
}
