import type { NotificationListItem } from '@jdm/shared/notifications';
import { useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { listNotifications, markNotificationRead } from '~/api/notifications';
import { notificationsCopy } from '~/copy/notifications';
import { captureException } from '~/lib/sentry';
import { openDestination } from '~/notifications/destination';
import { theme } from '~/theme';

export default function NotificationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const markedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (cursor?: string) => {
    try {
      const res = await listNotifications(cursor ? { cursor } : {});
      setItems((prev) => (cursor ? [...prev, ...res.notifications] : res.notifications));
      setNextCursor(res.nextCursor);
      setError(false);
    } catch (err) {
      captureException(err, 'notifications.load');
      setError(true);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await load(nextCursor).finally(() => setLoadingMore(false));
  };

  const handlePress = async (item: NotificationListItem) => {
    if (!item.readAt && !markedRef.current.has(item.id)) {
      markedRef.current.add(item.id);
      try {
        await markNotificationRead(item.id);
        setItems((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)),
        );
      } catch (err) {
        captureException(err, 'notifications.mark-read');
      }
    }
    await openDestination(item.destination, (path) => router.push(path as never));
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyTitle}>{notificationsCopy.loadFailed}</Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            void load().finally(() => setLoading(false));
          }}
          style={styles.retryBtn}
        >
          <Text style={styles.retryText}>{notificationsCopy.retry}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <Bell color={theme.colors.muted} size={40} strokeWidth={1.5} />
        <Text style={[styles.emptyTitle, { marginTop: theme.spacing.lg }]}>
          {notificationsCopy.empty}
        </Text>
        <Text style={styles.emptySub}>{notificationsCopy.emptySub}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <NotificationRow item={item} onPress={() => void handlePress(item)} />
        )}
        onEndReached={() => void handleLoadMore()}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.footer} />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function NotificationRow({ item, onPress }: { item: NotificationListItem; onPress: () => void }) {
  const unread = !item.readAt;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
    >
      <View style={[styles.dot, unread ? styles.dotUnread : styles.dotRead]} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.rowBody} numberOfLines={3}>
          {item.body}
        </Text>
        <Text style={styles.rowDate}>{formatDate(item.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  list: { paddingVertical: theme.spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    flexShrink: 0,
  },
  dotUnread: { backgroundColor: theme.colors.accent },
  dotRead: { backgroundColor: 'transparent' },
  rowText: { flex: 1, gap: theme.spacing.xs },
  rowTitle: { color: theme.colors.muted, fontSize: theme.font.size.lg, fontWeight: '500' },
  rowTitleUnread: { color: theme.colors.fg, fontWeight: '700' },
  rowBody: { color: theme.colors.muted, fontSize: theme.font.size.md, lineHeight: 20 },
  rowDate: { color: theme.colors.muted, fontSize: theme.font.size.sm, marginTop: theme.spacing.xs },
  emptyTitle: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySub: { color: theme.colors.muted, fontSize: theme.font.size.md, textAlign: 'center' },
  retryBtn: {
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.accent,
  },
  retryText: { color: '#fff', fontSize: theme.font.size.md, fontWeight: '600' },
  footer: { paddingVertical: theme.spacing.lg },
});
