// Card de destaque do handoff: raio 18, padding 16, borda dourada de ênfase,
// fundo escuro com tinta dourada.
//
// O card inteiro é uma única área de toque quando onPress é passado. Sem
// onPress ele é informativo, e não vira alvo de toque nem anuncia role de
// botão ao leitor de tela. Press escurece ~6%, conforme o handoff.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { p } from '~/screens/inicio/palette';

export function FeatureCard({
  children,
  onPress,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  if (!onPress) {
    return (
      <View style={styles.card} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: p.hairlineStrong,
    backgroundColor: p.featureSurface,
    gap: 14,
  },
  pressed: { opacity: 0.94 },
});
