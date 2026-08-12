// Caixa — BudgetMeter.
//
// Read-only rendering of budgetMeter(box): the used amount, the budget total,
// and a two-segment bar (gold = included in plan, green = overflow). No width
// animation this phase — read-only screens must not look interactive; the
// animated version belongs to the builder (Fase 3b-2).
//
// Typography note: the design handoff specifies Cormorant Garamond for the
// large money value. That font is not bundled in the app (same call made in
// PlanosScreen.tsx for the assinaturas screens) — renders with the already
// loaded Inter family instead. Follow-up: revisit if/when the app adds
// Cormorant Garamond.

import { Text } from '@ccc/ui';
import type { BoxView } from '@ccc/shared/box';
import { StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { theme } from '~/theme';

import { budgetMeter } from './box-state';
import { formatBRL } from './format';

const CARD_SURFACE = '#0F0E0B';
const CARD_BORDER = 'rgba(212,175,55,0.14)';
const TRACK_BG = 'rgba(242,232,216,0.1)';

type BudgetMeterProps = {
  box: Pick<BoxView, 'itemsTotalCents' | 'budgetCents' | 'overflowCents'>;
  compact?: boolean;
};

export function BudgetMeter({ box, compact = false }: BudgetMeterProps) {
  const meter = budgetMeter(box);
  const hasOverflow = meter.overflowCents > 0;

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
        <View style={[styles.fill, { flex: meter.fillRatio }]} />
        {hasOverflow ? <View style={[styles.overflowFill, { flex: meter.overflowRatio }]} /> : null}
        <View
          style={{ flex: Math.max(0, 1 - meter.fillRatio - meter.overflowRatio) }}
          accessible={false}
        />
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
