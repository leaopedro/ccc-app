// Caixa — CutoffBanner.
//
// Read-only countdown to the cycle's cutoff. Ticks once a minute (not every
// second — this is a status banner, not a stopwatch) and switches to an
// urgent tone in the last 24h, per docs/design/box-builder/README.md screen 01.

import { Text } from '@ccc/ui';
import { Clock } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { theme } from '~/theme';

import { formatCountdown, isUrgent } from './format';

const MINUTE_MS = 60 * 1000;

// README design tokens not covered by ~/theme (card/label golds).
const GOLD_LABEL = '#C9A227';
const SURFACE_TINT = '#14110a';
const BORDER_GOLD = 'rgba(212,175,55,0.28)';

const cutoffDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

export function CutoffBanner({ cutoffAt }: { cutoffAt: string }) {
  const [msRemaining, setMsRemaining] = useState(() => new Date(cutoffAt).getTime() - Date.now());

  useEffect(() => {
    setMsRemaining(new Date(cutoffAt).getTime() - Date.now());
    const id = setInterval(() => {
      setMsRemaining(new Date(cutoffAt).getTime() - Date.now());
    }, MINUTE_MS);
    return () => clearInterval(id);
  }, [cutoffAt]);

  const urgent = isUrgent(msRemaining);
  const tint = urgent ? theme.colors.warning : GOLD_LABEL;

  return (
    <View style={[styles.banner, urgent && styles.bannerUrgent]}>
      <View style={styles.left}>
        <Clock color={tint} size={18} strokeWidth={1.75} />
        <Text variant="bodySm" weight="semibold" style={{ color: tint }}>
          {caixaCopy.cutoff.prefix} {formatCountdown(msRemaining)}
        </Text>
      </View>
      <Text variant="caption" tone="muted">
        {cutoffDateFormatter.format(new Date(cutoffAt))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: SURFACE_TINT,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    borderRadius: theme.radii.lg,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  bannerUrgent: {
    borderColor: 'rgba(245,158,11,0.4)',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
});
