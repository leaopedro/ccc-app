// Caixa — loading skeleton (README screen 13).
//
// Static blocks shaped like the open-state layout. No full-screen spinner,
// and — per the global read-only rule for this phase — no shimmer animation
// either (the handoff's subtle opacity loop is left as a follow-up).

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from '~/theme';

const BLOCK_COLOR = 'rgba(242,232,216,0.05)';

function Block({ style }: { style: StyleProp<ViewStyle> }) {
  return <View style={[styles.block, style]} />;
}

export function CaixaSkeleton() {
  return (
    <View style={styles.screen} accessibilityLabel="Carregando caixa do mês">
      <View style={styles.headerRow}>
        <Block style={styles.eyebrow} />
        <Block style={styles.title} />
      </View>
      <Block style={styles.banner} />
      <Block style={styles.meter} />
      <View style={styles.summary}>
        <Block style={styles.summaryRow} />
        <Block style={styles.summaryRow} />
        <Block style={styles.summaryRow} />
      </View>
      <Block style={styles.cta} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    gap: theme.spacing.xl,
  },
  block: {
    backgroundColor: BLOCK_COLOR,
    borderRadius: theme.radii.md,
  },
  headerRow: {
    gap: theme.spacing.sm,
  },
  eyebrow: {
    width: 110,
    height: 10,
  },
  title: {
    width: 160,
    height: 30,
  },
  banner: {
    height: 52,
    borderRadius: theme.radii.lg,
  },
  meter: {
    height: 150,
    borderRadius: 16,
  },
  summary: {
    gap: theme.spacing.md,
  },
  summaryRow: {
    height: 18,
  },
  cta: {
    height: 52,
    borderRadius: theme.radii.lg,
    marginTop: 'auto',
    marginBottom: theme.spacing.xl,
  },
});
