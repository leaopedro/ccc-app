import { Pressable, StyleSheet, Text } from 'react-native';
import type { PressableProps } from 'react-native';

import { theme } from '../theme';

type Props = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
};

export const Button = ({ label, variant = 'primary', disabled = false, ...rest }: Props) => {
  const bg = variant === 'primary' ? theme.colors.accent : 'transparent';
  const fg = variant === 'primary' ? theme.colors.fg : theme.colors.fg;
  const borderColor = variant === 'secondary' ? theme.colors.border : bg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          borderColor,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
      {...rest}
    >
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: theme.font.size.lg,
    fontWeight: '600',
  },
});
