import type { Car } from '@jdm/shared/cars';
import type { FeedListResponse, FeedPostResponse, FeedSettings } from '@jdm/shared/feed';
import type { TicketSource } from '@jdm/shared/tickets';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { FeedComposerSheet } from './FeedComposerSheet';
import { FeedLockedCard } from './FeedLockedCard';
import { FeedPostCard } from './FeedPostCard';
import { TicketStrip } from './TicketStrip';
import { canModerateFeedPost } from './post-actions';

import { listCars } from '~/api/cars';
import {
  createFeedPost,
  deleteFeedPost,
  listFeedPosts,
  patchFeedPost,
  removeFeedReaction,
  toggleFeedReaction,
} from '~/api/feed';
import { useAuth } from '~/auth/context';
import { feedCopy } from '~/copy/feed';
import { theme } from '~/theme';

const PAGE_SIZE = 5;

type Props = {
  eventSlug: string;
  eventId: string;
  feedSettings: FeedSettings;
  ticketSource: TicketSource | null;
  embedded?: boolean;
};

export function EventFeedSection({
  eventSlug,
  eventId,
  feedSettings,
  ticketSource,
  embedded = false,
}: Props) {
  const { status: authStatus, user } = useAuth();
  const router = useRouter();
  const isAuthed = authStatus === 'authenticated';

  const [posts, setPosts] = useState<FeedPostResponse[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [myCars, setMyCars] = useState<Car[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<FeedPostResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [reactionLoadingIds, setReactionLoadingIds] = useState<Set<string>>(new Set());

  const hasTicket = ticketSource !== null;
  const isMember = ticketSource === 'premium_grant';
  const role = user?.role ?? 'user';
  const isViewStaff = role === 'organizer' || role === 'admin' || role === 'staff';
  const isPostStaff = canModerateFeedPost(role);

  const canView =
    isViewStaff ||
    feedSettings.feedAccess === 'public' ||
    (feedSettings.feedAccess === 'attendees' && hasTicket) ||
    (feedSettings.feedAccess === 'members_only' && isMember);
  const canPost =
    isPostStaff ||
    (feedSettings.postingAccess === 'attendees' && hasTicket) ||
    (feedSettings.postingAccess === 'members_only' && isMember);

  const loadPage = useCallback(
    async (p: number, replace: boolean) => {
      try {
        const res: FeedListResponse = await listFeedPosts(eventId, p);
        setPosts((prev) => (replace ? res.posts : [...prev, ...res.posts]));
        setPage(res.page);
        setTotalPages(res.totalPages);
        setLoadError(false);
      } catch {
        setLoadError(true);
      }
    },
    [eventId],
  );

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadPage(1, true).finally(() => setLoading(false));
  }, [canView, loadPage]);

  useEffect(() => {
    if (!isAuthed) {
      setMyCars([]);
      return;
    }
    void listCars()
      .then(setMyCars)
      .catch(() => setMyCars([]));
  }, [isAuthed]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadPage(1, true);
    setRefreshing(false);
  };

  const handleLoadMore = async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    await loadPage(page + 1, false);
    setLoadingMore(false);
  };

  const handleReaction = async (postId: string, kind: 'like' | 'dislike') => {
    setReactionLoadingIds((s) => new Set(s).add(postId));
    try {
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      const currentlyLiked = post.reactions.mine;
      if (currentlyLiked) {
        await removeFeedReaction(post.eventId, postId);
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? { ...p, reactions: { likes: Math.max(0, p.reactions.likes - 1), mine: false } }
              : p,
          ),
        );
      } else {
        const updated = await toggleFeedReaction(post.eventId, postId, kind);
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, reactions: updated } : p)));
      }
    } catch {
      // silent optimistic failure
    } finally {
      setReactionLoadingIds((s) => {
        const next = new Set(s);
        next.delete(postId);
        return next;
      });
    }
  };

  const handleComposerSubmit = async (body: string, carId: string | undefined) => {
    setSubmitting(true);
    try {
      if (editingPost) {
        const updated = await patchFeedPost(editingPost.eventId, editingPost.id, { body });
        setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } else {
        const newPost = await createFeedPost(eventId, { body, carId });
        setPosts((prev) => [newPost, ...prev]);
      }
      setComposerOpen(false);
      setEditingPost(null);
    } catch {
      Alert.alert(feedCopy.errors.postFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePost = (post: FeedPostResponse) => {
    Alert.alert(feedCopy.composer.deleteConfirm, undefined, [
      { text: feedCopy.composer.cancel, style: 'cancel' },
      {
        text: feedCopy.composer.delete,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteFeedPost(post.eventId, post.id);
              setPosts((prev) => prev.filter((p) => p.id !== post.id));
            } catch {
              Alert.alert(feedCopy.errors.postFailed);
            }
          })();
        },
      },
    ]);
  };

  const navigateToBuyTicket = () => {
    router.push({
      pathname: '/events/[slug]',
      params: { slug: eventSlug, purchaseMode: '1' },
    } as never);
  };

  const isComposerVisible = composerOpen || editingPost !== null;

  const feedPosts = canView ? (
    <>
      {loading ? (
        <ActivityIndicator color={theme.colors.muted} style={styles.spinner} />
      ) : loadError ? (
        <Text style={styles.errorText}>{feedCopy.errors.loadFailed}</Text>
      ) : posts.length === 0 ? (
        <>
          <Text style={styles.emptyText}>{feedCopy.pagination.empty}</Text>
        </>
      ) : (
        posts.map((post) => (
          <FeedPostCard
            key={post.id}
            post={post}
            myCars={myCars}
            isOwn={myCars.some((c) => c.id === post.car?.id)}
            canModerate={isPostStaff}
            canPost={canPost}
            reactionLoading={reactionLoadingIds.has(post.id)}
            onToggleReaction={(postId, kind) => {
              void handleReaction(postId, kind);
            }}
            {...(canPost
              ? {
                  onEdit: (p: FeedPostResponse) => {
                    setEditingPost(p);
                    setComposerOpen(true);
                  },
                }
              : {})}
            onDelete={handleDeletePost}
          />
        ))
      )}

      {!loading && page < totalPages ? (
        <TouchableOpacity
          onPress={() => void handleLoadMore()}
          disabled={loadingMore}
          style={styles.loadMoreBtn}
          accessibilityRole="button"
          accessibilityLabel={feedCopy.pagination.loadMore(PAGE_SIZE)}
        >
          {loadingMore ? (
            <ActivityIndicator color={theme.colors.muted} />
          ) : (
            <Text style={styles.loadMoreText}>{feedCopy.pagination.loadMore(PAGE_SIZE)}</Text>
          )}
        </TouchableOpacity>
      ) : null}

      {!loading && page >= totalPages && posts.length > 0 ? (
        <Text style={styles.noMoreText}>{feedCopy.pagination.noMore}</Text>
      ) : null}
    </>
  ) : null;

  return (
    <View
      style={embedded ? styles.containerEmbedded : styles.container}
      importantForAccessibility={isComposerVisible ? 'no-hide-descendants' : 'auto'}
    >
      <Text style={styles.feedTitle}>{feedCopy.title}</Text>
      {!embedded ? <TicketStrip onPress={navigateToBuyTicket} /> : null}

      {!canView ? <FeedLockedCard kind="view" onCtaPress={navigateToBuyTicket} /> : null}

      {canView && !canPost ? <FeedLockedCard kind="post" onCtaPress={navigateToBuyTicket} /> : null}

      {canView && canPost && isAuthed ? (
        <TouchableOpacity
          onPress={() => {
            setEditingPost(null);
            setComposerOpen(true);
          }}
          style={styles.composerEntry}
          accessibilityRole="button"
          accessibilityLabel={feedCopy.composer.placeholder}
        >
          <Text style={styles.composerEntryText}>{feedCopy.composer.placeholder}</Text>
        </TouchableOpacity>
      ) : null}

      {embedded ? (
        <View style={styles.feedEmbedded}>{feedPosts}</View>
      ) : (
        <ScrollView
          style={styles.feed}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={theme.colors.muted}
            />
          }
        >
          {feedPosts}
        </ScrollView>
      )}

      <FeedComposerSheet
        visible={isComposerVisible}
        cars={myCars}
        editingPost={editingPost}
        submitting={submitting}
        onSubmit={(body, carId) => void handleComposerSubmit(body, carId)}
        onClose={() => {
          setComposerOpen(false);
          setEditingPost(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  containerEmbedded: { paddingBottom: theme.spacing.xl },
  feedTitle: {
    color: theme.colors.fg,
    fontWeight: '700',
    fontSize: theme.font.size.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  feed: { flex: 1, paddingHorizontal: theme.spacing.lg },
  feedEmbedded: { paddingHorizontal: theme.spacing.lg },
  spinner: { marginTop: theme.spacing.xl },
  errorText: { color: theme.colors.muted, textAlign: 'center', marginTop: theme.spacing.xl },
  emptyText: { color: theme.colors.muted, textAlign: 'center', marginTop: theme.spacing.xl },
  composerEntry: {
    margin: theme.spacing.lg,
    padding: theme.spacing.md,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.border,
    minHeight: 44,
    justifyContent: 'center',
  },
  composerEntryText: { color: theme.colors.muted, fontSize: theme.font.size.md },
  loadMoreBtn: {
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  loadMoreText: { color: theme.colors.accent, fontWeight: '600', fontSize: theme.font.size.md },
  noMoreText: {
    color: theme.colors.muted,
    textAlign: 'center',
    marginVertical: theme.spacing.lg,
  },
});
