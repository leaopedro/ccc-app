// CTA pequeno do handoff: gradiente dourado 135deg, texto preto, raio 9.
// Alvo de toque mínimo de 44px de altura, por acessibilidade.

import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text } from 'react-native';

import { p } from '~/screens/inicio/palette';

export function GoldPill({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.wrap, pressed ? styles.pressed : null]}
    >
      <LinearGradient
        colors={[p.goldLight, p.goldDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <Text style={styles.label}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 9, overflow: 'hidden' },
  pressed: { opacity: 0.85 },
  gradient: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.8,
    color: p.bg,
    textTransform: 'uppercase',
  },
});
