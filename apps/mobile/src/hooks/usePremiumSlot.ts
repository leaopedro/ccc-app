import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { resolveCaixaSlot, type PremiumSlot } from '~/navigation/caixa-slot';
import { isCaixaBuildEnabled } from '~/screens/caixa/caixa-enabled';

import { usePremiumPlans } from './usePremiumPlans';
import { usePremiumSubscription } from './usePremiumSubscription';

const SEED_KEY = 'caixa.premiumActive';
// Fix (final review, Important 3): fail-closed on a cold start with no
// network (or a 429, see the rate-limit comment in premium-catalog.ts) was
// leaking to every platform, not just iOS — the gate defaults to `false`
// until the first fetch resolves, which hid the assinaturas tab from
// web/Android too, where the gate is never actually off. Seed it from
// AsyncStorage the same way `premiumActive` already is: a last-known-good
// value, refreshed on every foreground, NOT a module-level cache (Ruling 7
// deleted that deliberately — this still refetches every time).
const GATE_SEED_KEY = 'caixa.subscriptionsEnabled';

export function usePremiumSlot(): { slot: PremiumSlot } {
  const { subscription, loading, error, refresh } = usePremiumSubscription();
  // Platform gate from the plans catalog (public, unauthed). Read fresh on
  // every foreground below instead of cached, so ops can flip it off during a
  // live App Store rejection without shipping a new binary. `subscriptionsEnabled`
  // defaults to false until the first fetch resolves, which is also the
  // fail-closed behavior we want while loading.
  const {
    subscriptionsEnabled: resolvedSubscriptionsEnabled,
    loading: plansLoading,
    error: plansError,
    refresh: refreshPlans,
  } = usePremiumPlans();
  const [seed, setSeed] = useState<boolean | null>(null);
  const [gateSeed, setGateSeed] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(SEED_KEY).then((v) => setSeed(v === 'true'));
    void AsyncStorage.getItem(GATE_SEED_KEY).then((v) => setGateSeed(v === 'true'));
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

  // Same rule for the platform gate: persist only a known-good value. A
  // failed /api/plans fetch (or a 429) must never clobber a cached `true`
  // and hide the tab from web/Android, where the gate is never off.
  useEffect(() => {
    if (plansLoading || plansError) return;
    void AsyncStorage.setItem(GATE_SEED_KEY, resolvedSubscriptionsEnabled ? 'true' : 'false');
  }, [plansLoading, plansError, resolvedSubscriptionsEnabled]);

  // Until a fresh successful value lands, trust the cached seed — this avoids a
  // flicker and stops a transient error from reading as "inactive".
  const premiumActive = loading || error ? (seed ?? false) : resolvedActive;
  // Same fallback for the gate. `gateSeed` is `null` until AsyncStorage's own
  // read resolves and whenever nothing has ever been stored — both cases
  // must still fail closed (`?? false`), matching the deliberate default.
  const subscriptionsEnabled =
    plansLoading || plansError ? (gateSeed ?? false) : resolvedSubscriptionsEnabled;
  return { slot: resolveCaixaSlot({ caixaEnabled, premiumActive, subscriptionsEnabled }) };
}
