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
  onManage,
  onSubscribe,
}: {
  status: PremiumStatus | null;
  onManage: () => void;
  onSubscribe: () => void;
}) {
  if (!status) return null;

  if (!status.active) {
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
