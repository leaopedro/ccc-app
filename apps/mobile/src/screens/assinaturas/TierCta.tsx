// Per-tier CTA. Gold renders a gradient; the other tiers render an outline.
// Extracted from PlanoDetalheScreen, where the two variants were duplicated.

import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { c, tierStyle, type ApiTier } from '~/screens/assinaturas/tier-visual';

export function TierCta({
  tier,
  label,
  onPress,
  disabled = false,
  loading = false,
  testID,
}: {
  tier: ApiTier;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const t = tierStyle(tier);
  const isGradient = t.btnBg === 'gradient';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        isGradient ? styles.gradient : styles.outline,
        !isGradient && { borderColor: t.btnBorder },
        (disabled || loading) && styles.dimmed,
      ]}
      testID={testID}
    >
      {isGradient ? (
        <LinearGradient
          colors={[c.goldLight, c.goldDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {loading ? <ActivityIndicator color={t.btnColor} /> : null}
      <Text style={[styles.label, { color: t.btnColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outline: {
    borderRadius: 11,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
  },
  gradient: {
    borderRadius: 11,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    overflow: 'hidden',
  },
  dimmed: { opacity: 0.6 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 2.4 },
});
