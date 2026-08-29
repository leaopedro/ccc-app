// Sua assinatura — status ativo mostra o selo do tier, inativo mostra o
// upsell. `tier` pode ser nulo mesmo com `active` verdadeiro no schema
// (premiumStatusSchema não amarra os dois campos); `PremiumBadge` já lida
// com tier nulo, caindo no rótulo genérico "Premium".

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PremiumBadge } from '@ccc/ui';

import { inicioCopy } from '~/copy/inicio';
import { GoldPill } from '~/screens/inicio/components/GoldPill';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

import type { PremiumStatus } from '@ccc/shared/premium';

export function SubscriptionSection({
  status,
  subscriptionsEnabled,
  onManage,
  onSubscribe,
}: {
  status: PremiumStatus | null;
  subscriptionsEnabled: boolean;
  onManage: () => void;
  onSubscribe: () => void;
}) {
  if (!status) return null;

  if (!status.active) {
    // Fix (final review, Critical 1): /inicio is the very route the platform
    // gate redirects TO, so this pill would bounce a gated member straight
    // back to where they already are. Same standard as MinhaAssinaturaScreen
    // (Task 10): a button that bounces is worse than no button, so it only
    // renders when the gate is on. No informative state either — there is
    // nothing left to show a non-member here when the whole entry point is off.
    if (!subscriptionsEnabled) return null;
    return (
      <View style={styles.wrap}>
        <SectionLabel label={inicioCopy.sections.subscription} />
        <GoldPill
          label={inicioCopy.cards.subscribeUpsell}
          onPress={onSubscribe}
          testID="inicio-subscription-upsell"
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.subscription} />
      <PremiumBadge isPremiumActive={status.active} tier={status.tier} size="md" />
      <Pressable
        onPress={onManage}
        accessibilityRole="link"
        accessibilityLabel={inicioCopy.cards.seeSubscription}
        testID="inicio-subscription-active"
      >
        <Text style={styles.link}>{inicioCopy.cards.seeSubscription}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  link: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 13,
    color: p.gold,
  },
});
