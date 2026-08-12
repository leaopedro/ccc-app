import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { resolveCaixaSlot, type PremiumSlot } from '~/navigation/caixa-slot';
import { isCaixaBuildEnabled } from '~/screens/caixa/caixa-enabled';

import { usePremiumSubscription } from './usePremiumSubscription';

const SEED_KEY = 'caixa.premiumActive';

export function usePremiumSlot(): { slot: PremiumSlot } {
  const { subscription, loading } = usePremiumSubscription();
  const [seed, setSeed] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(SEED_KEY).then((v) => setSeed(v === 'true'));
  }, []);

  const caixaEnabled = isCaixaBuildEnabled();
  const resolvedActive = subscription?.active ?? false;

  useEffect(() => {
    if (loading) return;
    void AsyncStorage.setItem(SEED_KEY, resolvedActive ? 'true' : 'false');
  }, [loading, resolvedActive]);

  // Before the live value resolves, trust the seed to avoid a flicker.
  const premiumActive = loading ? (seed ?? false) : resolvedActive;
  return { slot: resolveCaixaSlot({ caixaEnabled, premiumActive }) };
}
