import type { FeedReactionSummary } from '@jdm/shared/feed';
import { ThumbsUp } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { feedCopy } from '~/copy/feed';
import { theme } from '~/theme';

type Props = {
  reactions: FeedReactionSummary;
  myKind: 'like' | 'dislike' | null;
  loading: boolean;
  onToggle: (kind: 'like' | 'dislike') => void;
};

export function FeedReactionsRow({ reactions, myKind, loading, onToggle }: Props) {
  const likeActive = myKind === 'like';

  return (
    <View style={styles.row}>
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.muted} style={styles.spinner} />
      ) : null}
      <Pressable
        onPress={() => !loading && onToggle('like')}
        disabled={loading}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel={feedCopy.post.reactions.like}
        accessibilityState={{ selected: likeActive }}
        hitSlop={8}
      >
        <ThumbsUp
          size={16}
          strokeWidth={2}
          color={likeActive ? theme.colors.accent : theme.colors.muted}
        />
        {reactions.likes > 0 ? (
          <Text style={[styles.count, likeActive && styles.countActive]}>{reactions.likes}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  count: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  countActive: { color: theme.colors.accent },
  spinner: { marginRight: theme.spacing.xs },
});
