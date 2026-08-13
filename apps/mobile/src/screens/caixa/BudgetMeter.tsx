// Caixa — BudgetMeter.
//
// Read-only rendering of budgetMeter(box): the used amount, the budget total,
// and a two-segment bar (gold = included in plan, green = overflow). No width
// animation by default — read-only screens must not look interactive. The
// builder (Fase 3b-2) opts into the `animated` prop so the bar eases as the
// selection changes.
//
// Typography note: the design handoff specifies Cormorant Garamond for the
// large money value. That font is not bundled in the app (same call made in
// PlanosScreen.tsx for the assinaturas screens) — renders with the already
// loaded Inter family instead. Follow-up: revisit if/when the app adds
// Cormorant Garamond.

import { Text } from '@ccc/ui';
import type { BoxView } from '@ccc/shared/box';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { theme } from '~/theme';

import { budgetMeter } from './box-state';
import { formatBRL } from './format';

const CARD_SURFACE = '#0F0E0B';
const CARD_BORDER = 'rgba(212,175,55,0.14)';
const TRACK_BG = 'rgba(242,232,216,0.1)';
const BAR_ANIM_MS = 240;

type BudgetMeterProps = {
  box: Pick<BoxView, 'itemsTotalCents' | 'budgetCents' | 'overflowCents'>;
  compact?: boolean;
  animated?: boolean;
};

export function BudgetMeter({ box, compact = false, animated = false }: BudgetMeterProps) {
  const meter = budgetMeter(box);
  const hasOverflow = meter.overflowCents > 0;

  // Segment widths are flex-based (not pixel widths), so they can't ride the
  // native driver — useNativeDriver: false is required here.
  const fill = useRef(new Animated.Value(meter.fillRatio)).current;
  const over = useRef(new Animated.Value(meter.overflowRatio)).current;
  useEffect(() => {
    if (!animated) return;
    Animated.timing(fill, {
      toValue: meter.fillRatio,
      duration: BAR_ANIM_MS,
      useNativeDriver: false,
    }).start();
    Animated.timing(over, {
      toValue: meter.overflowRatio,
      duration: BAR_ANIM_MS,
      useNativeDriver: false,
    }).start();
  }, [animated, meter.fillRatio, meter.overflowRatio, fill, over]);

  // Mirrors the static branch's trailing spacer — without it, `fill` and
  // `over` alone (summing to < 1 whenever there's no overflow) would each
  // get sized as if they were the only two flex children, so `fill` renders
  // full-width instead of stopping at fillRatio.
  const rest = Animated.subtract(1, Animated.add(fill, over));

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={compact ? styles.valueRowCompact : styles.valueRow}>
        <Text style={compact ? styles.usedValueCompact : styles.usedValue}>
          {formatBRL(meter.usedCents)}
        </Text>
        <Text variant="bodySm" tone="muted" style={compact ? undefined : styles.ofPlan}>
          {caixaCopy.budget.ofPlan(formatBRL(meter.budgetCents))}
        </Text>
      </View>

      <View style={[styles.track, compact && styles.trackCompact]}>
        {animated ? (
          <>
            <Animated.View style={[styles.fill, { flex: fill }]} />
            <Animated.View style={[styles.overflowFill, { flex: over }]} />
            <Animated.View style={{ flex: rest }} accessible={false} />
          </>
        ) : (
          <>
            <View style={[styles.fill, { flex: meter.fillRatio }]} />
            {hasOverflow ? (
              <View style={[styles.overflowFill, { flex: meter.overflowRatio }]} />
            ) : null}
            <View
              style={{ flex: Math.max(0, 1 - meter.fillRatio - meter.overflowRatio) }}
              accessible={false}
            />
          </>
        )}
      </View>

      <View style={styles.captionsRow}>
        <Text variant="caption" tone="muted">
          {caixaCopy.budget.includedInPlan(formatBRL(meter.includedCents))}
        </Text>
        {hasOverflow ? (
          <Text variant="caption" weight="semibold" style={styles.overflowText}>
            {caixaCopy.budget.overflow(formatBRL(meter.overflowCents))}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_SURFACE,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    padding: theme.spacing.xl,
  },
  cardCompact: {
    padding: theme.spacing.md,
    borderRadius: theme.radii.lg,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: theme.spacing.sm,
  },
  valueRowCompact: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  usedValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    color: theme.colors.fg,
  },
  usedValueCompact: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.font.size.lg,
    color: theme.colors.fg,
  },
  ofPlan: {
    marginBottom: 2,
  },
  track: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    backgroundColor: TRACK_BG,
    overflow: 'hidden',
    marginTop: theme.spacing.lg,
  },
  trackCompact: {
    height: 6,
    borderRadius: 3,
    marginTop: theme.spacing.sm,
  },
  fill: {
    backgroundColor: theme.colors.accent,
  },
  overflowFill: {
    backgroundColor: theme.colors.success,
  },
  captionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing.md,
  },
  overflowText: {
    color: theme.colors.success,
  },
});
