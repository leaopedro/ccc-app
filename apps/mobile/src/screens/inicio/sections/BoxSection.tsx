// Caixa do mês — benefício de assinante.
//
// `isPremiumActive` é verificado ANTES de `box`: a caixa é benefício de
// quem assina, então mostrar a seção pra quem não assina seria upsell
// disfarçado de feature. O mapa de status para PT-BR reusa
// `caixaCopy.history.status`, já usado no histórico de caixas, em vez de
// duplicar o enum aqui.

import { Pressable, StyleSheet, Text } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { inicioCopy } from '~/copy/inicio';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

import type { BoxView } from '@ccc/shared/box';

export function BoxSection({
  box,
  isPremiumActive,
  onPress,
}: {
  box: BoxView | null;
  isPremiumActive: boolean;
  onPress: () => void;
}) {
  if (!isPremiumActive) return null;
  if (!box) return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={inicioCopy.sections.box}
      testID="inicio-box"
      style={({ pressed }) => [styles.wrap, pressed ? styles.pressed : null]}
    >
      <SectionLabel label={inicioCopy.sections.box} />
      <Text style={styles.status}>{caixaCopy.history.status[box.status]}</Text>
      <Text style={styles.link}>{inicioCopy.cards.seeBox}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  pressed: { opacity: 0.9 },
  status: {
    fontFamily: 'Jost_500Medium',
    fontSize: 14,
    color: p.cream,
  },
  link: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 13,
    color: p.gold,
  },
});
