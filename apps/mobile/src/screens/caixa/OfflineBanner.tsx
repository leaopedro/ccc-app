// Caixa — offline/error top banner (README screen 15).
//
// The app has no connectivity detection library wired up yet, so this is
// rendered whenever the caixa load call fails (useBox's `error` flag) —
// the same simplification the tickets screen already uses for its own
// offline fallback badge.

import { Text } from '@ccc/ui';
import { CloudOff } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { theme } from '~/theme';

const BANNER_BG = 'rgba(212,175,55,0.12)';
const GOLD_LABEL = '#C9A227';

export function OfflineBanner() {
  return (
    <View style={styles.banner}>
      <CloudOff color={GOLD_LABEL} size={16} strokeWidth={1.75} />
      <Text variant="caption" style={styles.text}>
        {caixaCopy.offline.banner}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: BANNER_BG,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  text: {
    color: GOLD_LABEL,
    flexShrink: 1,
  },
});
