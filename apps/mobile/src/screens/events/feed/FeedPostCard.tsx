import type { Car } from '@jdm/shared/cars';
import type { FeedPostResponse } from '@jdm/shared/feed';
import { PremiumBadge } from '@jdm/ui';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { FeedComments } from './FeedComments';
import { FeedReactionsRow } from './FeedReactionsRow';
import { resolveFeedPostActionVisibility } from './post-actions';

import { feedCopy } from '~/copy/feed';
import { theme } from '~/theme';

function ModificationPills({ modifications }: { modifications: string[] }) {
  return (
    <View style={styles.pillsRow}>
      {modifications.map((mod, i) => (
        <View key={i} style={styles.pill}>
          <Text style={styles.pillText}>{mod}</Text>
        </View>
      ))}
    </View>
  );
}

type Props = {
  post: FeedPostResponse;
  myCars: Car[];
  isOwn: boolean;
  canModerate: boolean;
  canPost: boolean;
  reactionLoading: boolean;
  onToggleReaction: (postId: string, kind: 'like' | 'dislike') => void;
  onEdit?: (post: FeedPostResponse) => void;
  onDelete?: (post: FeedPostResponse) => void;
};

export function FeedPostCard({
  post,
  myCars,
  isOwn,
  canModerate,
  canPost,
  reactionLoading,
  onToggleReaction,
  onEdit,
  onDelete,
}: Props) {
  const car = post.car;
  const carLabel = car ? `${car.nickname ?? car.make} ${car.model} ${car.year}` : '—';
  const { showEdit, showDelete } = resolveFeedPostActionVisibility(isOwn, canModerate);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {car?.photo?.url ? (
          <Image
            source={{ uri: car.photo.url }}
            style={styles.carPhoto}
            accessibilityLabel={carLabel}
          />
        ) : (
          <View style={[styles.carPhoto, styles.carPhotoPlaceholder]} />
        )}
        <View style={styles.carInfo}>
          <View style={styles.carNameRow}>
            <Text style={styles.carName}>{carLabel}</Text>
            {car ? <PremiumBadge isPremiumActive={car.isPremiumActive} /> : null}
          </View>
          {car && car.modifications && car.modifications.length > 0 ? (
            <ModificationPills modifications={car.modifications} />
          ) : null}
        </View>
        {showEdit || showDelete ? (
          <View style={styles.actions}>
            {showEdit && onEdit ? (
              <Pressable
                onPress={() => onEdit(post)}
                accessibilityRole="button"
                accessibilityLabel={feedCopy.post.menu.edit}
                hitSlop={8}
                style={styles.actionBtn}
              >
                <Text style={styles.actionText}>{feedCopy.post.menu.edit}</Text>
              </Pressable>
            ) : null}
            {showDelete && onDelete ? (
              <Pressable
                onPress={() => onDelete(post)}
                accessibilityRole="button"
                accessibilityLabel={feedCopy.post.menu.delete}
                hitSlop={8}
                style={styles.actionBtn}
              >
                <Text style={[styles.actionText, styles.deleteText]}>
                  {feedCopy.post.menu.delete}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <Text style={styles.body}>{post.body}</Text>

      {post.photos.length > 0 ? (
        <Image
          source={{ uri: post.photos[0]?.url }}
          style={styles.photo}
          accessibilityLabel="Foto do post"
        />
      ) : null}

      <FeedReactionsRow
        reactions={post.reactions}
        myKind={post.reactions.mine ? 'like' : null}
        loading={reactionLoading}
        onToggle={(kind) => onToggleReaction(post.id, kind)}
      />

      <FeedComments
        eventId={post.eventId}
        postId={post.id}
        commentCount={post.commentCount}
        myCars={myCars}
        canPost={canPost}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  carPhoto: { width: 40, height: 40, borderRadius: 20 },
  carPhotoPlaceholder: { backgroundColor: theme.colors.bg },
  carInfo: { flex: 1 },
  carNameRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  carName: { color: theme.colors.fg, fontWeight: '600', fontSize: theme.font.size.sm },
  actions: { flexDirection: 'row', gap: theme.spacing.xs },
  actionBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xs,
  },
  actionText: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  deleteText: { color: theme.colors.accent },
  body: { color: theme.colors.fg, fontSize: theme.font.size.md, lineHeight: 20 },
  photo: { width: '100%', height: 200, borderRadius: theme.radii.md },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  pill: {
    backgroundColor: theme.colors.bg,
    borderRadius: 12,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  pillText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
  },
});
