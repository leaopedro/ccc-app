// Atalho do grid de acesso rapido: icone 24px dourado acima de um rotulo de
// 13px, alinhado a esquerda, conforme o handoff.

import { Pressable, StyleSheet, Text } from 'react-native';

import { homeIcon } from '~/screens/inicio/icons';
import { p } from '~/screens/inicio/palette';

export function QuickActionTile({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const Icon = homeIcon(icon);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}
    >
      <Icon color={p.gold} size={24} strokeWidth={1.75} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 96,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pressed: { opacity: 0.9 },
  label: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    color: p.cream,
  },
});
