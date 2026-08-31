// Web-only checkout return. Stripe sends the member here after a successful
// subscription session (see me-premium.ts successUrl). On Android the deep link
// resolves inside ContratarScreen and this route is never opened.
//
// Polls the subscription because the webhook is asynchronous — landing here
// does not prove the membership row exists yet.
//
// Deliberately NOT gated by useSubscriptionsGate. Landing here means a
// hosted checkout already completed — redirecting the member away from their
// own successful payment confirmation would be hostile, and the platform gate
// (which blocks starting a NEW purchase) is irrelevant to one already in
// flight.

import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { assinaturasCopy } from '~/copy/assinaturas';
import { pollSubscriptionActive } from '~/screens/assinaturas/poll-subscription';
import { c } from '~/screens/assinaturas/tier-visual';

const copy = assinaturasCopy.contratar;

export default function CheckoutReturnRoute() {
  const [pending, setPending] = useState(false);

  const poll = useCallback(async () => {
    const active = await pollSubscriptionActive();
    if (active) {
      router.replace('/assinaturas/minha-assinatura');
      return;
    }
    setPending(true);
  }, []);

  useEffect(() => {
    void poll();
  }, [poll]);

  if (pending) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>{copy.pendingTitle}</Text>
        <Text style={styles.subcopy}>{copy.pendingSubcopy}</Text>
        <Pressable
          onPress={() => router.replace('/assinaturas/minha-assinatura')}
          accessibilityRole="button"
          accessibilityLabel={copy.pendingCta}
          style={styles.cta}
          testID="checkout-return-pending-cta"
        >
          <Text style={styles.ctaText}>{copy.pendingCta}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={c.gold} />
      <Text style={styles.subcopy}>{copy.confirming}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: c.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    color: c.cream,
    textAlign: 'center',
  },
  subcopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: c.muted55,
    textAlign: 'center',
    maxWidth: 280,
  },
  cta: {
    marginTop: 6,
    borderRadius: 11,
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderWidth: 1,
    borderColor: c.tileBorder,
  },
  ctaText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: c.goldLight,
  },
});
