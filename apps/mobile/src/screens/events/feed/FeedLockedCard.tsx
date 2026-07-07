import { Lock } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { feedCopy } from '~/copy/feed';
import { theme } from '~/theme';

type Props = {
  kind: 'view' | 'post';
  onCtaPress: () => void;
};

export function FeedLockedCard({ kind, onCtaPress }: Props) {
  const message = kind === 'view' ? feedCopy.locked.viewLocked : feedCopy.locked.postLocked;
  const cta = kind === 'view' ? feedCopy.locked.viewLockedCta : feedCopy.locked.postLockedCta;

  return (
    <View style={styles.card} accessibilityRole="alert">
      <Lock size={20} strokeWidth={2} color={theme.colors.muted} accessible={false} />
      <Text style={styles.message}>{message}</Text>
      <Pressable
        onPress={onCtaPress}
        accessibilityRole="button"
        accessibilityLabel={cta}
        style={styles.ctaBtn}
        hitSlop={8}
      >
        <Text style={styles.ctaText}>{cta}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  message: { color: theme.colors.muted, fontSize: theme.font.size.md, textAlign: 'center' },
  ctaBtn: {
    marginTop: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.accent,
    minHeight: 44,
    justifyContent: 'center',
  },
  ctaText: { color: theme.colors.fg, fontWeight: '700', fontSize: theme.font.size.md },
});
