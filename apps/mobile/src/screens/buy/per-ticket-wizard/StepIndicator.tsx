import { StyleSheet, Text, View } from 'react-native';

import { theme } from '~/theme';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  ticketLabel: string;
  stepLabel: string;
}

export function StepIndicator({
  currentStep,
  totalSteps,
  ticketLabel,
  stepLabel,
}: StepIndicatorProps) {
  const progress = currentStep / totalSteps;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.ticketLabel}>{ticketLabel}</Text>
        <Text style={styles.stepLabel}>{stepLabel}</Text>
      </View>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: totalSteps, now: currentStep }}
      >
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.counter}>
        {currentStep}/{totalSteps}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  ticketLabel: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  stepLabel: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: theme.colors.accent,
    borderRadius: 2,
  },
  counter: {
    color: theme.colors.muted,
    fontSize: 11,
    textAlign: 'right',
  },
});
