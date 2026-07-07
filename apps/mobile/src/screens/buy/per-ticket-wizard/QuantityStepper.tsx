import { Minus, Plus } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '~/theme';

interface QuantityStepperProps {
  value: number;
  min?: number;
  max: number;
  onChange: (next: number) => void;
}

export function QuantityStepper({ value, min = 1, max, onChange }: QuantityStepperProps) {
  const canDecrement = value > min;
  const canIncrement = value < max;

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => canDecrement && onChange(value - 1)}
        disabled={!canDecrement}
        style={[styles.button, !canDecrement && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel="Diminuir quantidade"
        accessibilityState={{ disabled: !canDecrement }}
      >
        <Minus color={canDecrement ? theme.colors.fg : theme.colors.muted} size={18} />
      </Pressable>

      <Text
        style={styles.value}
        accessibilityRole="text"
        accessibilityLabel={`Quantidade: ${value}`}
        accessibilityHint={`${value} de ${max} ingressos selecionados`}
      >
        {value}
      </Text>

      <Pressable
        onPress={() => canIncrement && onChange(value + 1)}
        disabled={!canIncrement}
        style={[styles.button, !canIncrement && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel="Aumentar quantidade"
        accessibilityState={{ disabled: !canIncrement }}
      >
        <Plus color={canIncrement ? theme.colors.fg : theme.colors.muted} size={18} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  value: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
    minWidth: 28,
    textAlign: 'center',
  },
});
