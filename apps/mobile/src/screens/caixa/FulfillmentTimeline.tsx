// Caixa — fulfillment timeline (Fase 4b). Thin presentational component;
// all mapping logic is in boxTimelineSteps (box-state.ts, unit-tested). No
// tracking, no push — the timeline is inline. See spec section 4.

import type { BoxFulfillmentStatus } from '@ccc/shared/box';
import { Text } from '@ccc/ui';
import { StyleSheet, View } from 'react-native';

import { boxTimelineSteps, type TimelineStepState } from '~/screens/caixa/box-state';
import { theme } from '~/theme';

const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';

function dotStyle(state: TimelineStepState) {
  if (state === 'done') return styles.dotDone;
  if (state === 'current') return styles.dotCurrent;
  return styles.dotPending;
}

export function FulfillmentTimeline({ status }: { status: BoxFulfillmentStatus }) {
  const steps = boxTimelineSteps(status);

  return (
    <View style={styles.row} accessibilityRole="summary">
      {steps.map((step, index) => (
        <View key={step.label} style={styles.step}>
          {index > 0 ? <View style={styles.connector} /> : null}
          <View style={[styles.dot, dotStyle(step.state)]} />
          <Text
            variant="caption"
            tone={step.state === 'pending' ? 'muted' : 'secondary'}
            style={styles.label}
          >
            {step.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const DOT = 14;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  step: {
    flex: 1,
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  connector: {
    position: 'absolute',
    top: DOT / 2 - 0.5,
    right: '50%',
    width: '100%',
    height: 1,
    backgroundColor: BORDER_GOLD_SOFT,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  dotDone: {
    backgroundColor: theme.colors.success,
  },
  dotCurrent: {
    backgroundColor: theme.colors.success,
    borderWidth: 3,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  dotPending: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
  },
  label: {
    textAlign: 'center',
  },
});
