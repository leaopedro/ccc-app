import type { MyTicket } from '@jdm/shared/tickets';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { listMyTickets } from '~/api/tickets';
import { ticketsCopy } from '~/copy/tickets';
import { formatEventDateRange } from '~/lib/format';
import {
  TICKET_STATUS_FILTERS,
  applyEventFilter,
  applyStatusFilter,
  findEventTitle,
  type TicketStatusFilter,
} from '~/screens/tickets/filters';
import { theme } from '~/theme';
import { listSavedTickets } from '~/tickets/offline-storage';

const statusLabel = (status: MyTicket['status']): string => {
  if (status === 'valid') return ticketsCopy.detail.valid;
  if (status === 'used') return ticketsCopy.detail.used;
  return ticketsCopy.detail.revoked;
};

export default function TicketsIndex() {
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const rawEventId = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  const [items, setItems] = useState<MyTicket[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [offlineFallback, setOfflineFallback] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<TicketStatusFilter>('valid');
  const [eventFilterCleared, setEventFilterCleared] = useState(false);

  const eventId = eventFilterCleared ? null : (rawEventId ?? null);

  const load = useCallback(async () => {
    try {
      const res = await listMyTickets();
      setItems(res.items);
      setLoadError(false);
      setOfflineFallback(false);
    } catch {
      const saved = await listSavedTickets();
      if (saved.length > 0) {
        setItems(saved);
        setOfflineFallback(true);
        setLoadError(false);
      } else {
        setLoadError(true);
        setOfflineFallback(false);
        setItems([]);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const filtered = useMemo(() => {
    if (!items) return null;
    return applyEventFilter(applyStatusFilter(items, filter), eventId);
  }, [items, filter, eventId]);

  const eventTitle = useMemo(() => findEventTitle(items ?? [], eventId), [items, eventId]);

  const clearEventFilter = useCallback(() => {
    setEventFilterCleared(true);
    router.setParams({ eventId: undefined } as never);
  }, [router]);

  if (items === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>
          {loadError ? ticketsCopy.list.emptyFilter : ticketsCopy.list.empty}
        </Text>
        {loadError ? (
          <View style={styles.retryWrap}>
            <Pressable
              style={styles.retryBtn}
              onPress={() => void load()}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Tentar novamente</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {eventId && eventTitle ? (
        <View style={styles.eventBanner}>
          <Text style={styles.eventBannerText} numberOfLines={1}>
            {ticketsCopy.filters.event} {eventTitle}
          </Text>
          <Pressable
            onPress={clearEventFilter}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={ticketsCopy.filters.eventClear}
            style={styles.eventBannerClear}
          >
            <X color={theme.colors.bg} size={16} strokeWidth={2} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {TICKET_STATUS_FILTERS.map((f) => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={ticketsCopy.filters[f]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {ticketsCopy.filters[f]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {filtered!.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{ticketsCopy.list.emptyFilter}</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
          renderItem={({ item }) => {
            const nickname = item.nickname?.trim() || null;
            const pendingExtras = item.extras.filter((e) => e.status === 'valid');
            const pendingLabel =
              pendingExtras.length === 1
                ? ticketsCopy.list.pendingExtrasOne
                : ticketsCopy.list.pendingExtras;
            const pendingVouchers = item.pickupVouchers.filter((v) => v.status === 'valid');
            const pendingVoucherLabel =
              pendingVouchers.length === 1
                ? ticketsCopy.list.pendingVouchersOne
                : ticketsCopy.list.pendingVouchers;
            const a11yExtras =
              pendingExtras.length > 0
                ? `, ${pendingExtras.length} ${pendingLabel}: ${pendingExtras.map((e) => e.extraName).join(', ')}`
                : '';
            const a11yVouchers =
              pendingVouchers.length > 0
                ? `, ${pendingVouchers.length} ${pendingVoucherLabel}`
                : '';
            return (
              <Pressable
                style={styles.card}
                onPress={() =>
                  router.push({
                    pathname: '/tickets/[ticketId]',
                    params: { ticketId: item.id, ticket: JSON.stringify(item) },
                  } as never)
                }
                accessibilityRole="button"
                accessibilityLabel={`${nickname ? `${nickname}, ` : ''}${item.event.title}, ${item.tierName}, ${statusLabel(item.status)}${a11yExtras}${a11yVouchers}`}
                accessibilityHint="Opens ticket QR code"
              >
                {nickname ? (
                  <>
                    <Text style={styles.title}>{nickname}</Text>
                    <Text style={styles.eventName}>{item.event.title}</Text>
                  </>
                ) : (
                  <Text style={styles.title}>{item.event.title}</Text>
                )}
                <Text style={styles.sub}>
                  {formatEventDateRange(item.event.startsAt, item.event.endsAt)}
                </Text>
                <Text style={styles.sub}>{item.tierName}</Text>
                <Text style={[styles.status, item.status !== 'valid' && styles.statusMuted]}>
                  {statusLabel(item.status)}
                </Text>
                {offlineFallback ? (
                  <View style={styles.offlineBadgeRow}>
                    <Text style={styles.offlineBadge}>{ticketsCopy.offline.offlineBadge}</Text>
                  </View>
                ) : null}
                {pendingExtras.length > 0 && (
                  <View style={styles.pendingExtras}>
                    <Text style={styles.pendingExtrasLabel}>
                      {pendingExtras.length} {pendingLabel}
                    </Text>
                    <View style={styles.pendingExtrasChips}>
                      {pendingExtras.map((extra) => (
                        <View key={extra.id} style={styles.pendingExtraChip}>
                          <Text style={styles.pendingExtraChipText} numberOfLines={1}>
                            {extra.extraName}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
                {pendingVouchers.length > 0 && (
                  <View style={styles.pendingExtras}>
                    <Text style={styles.pendingExtrasLabel}>
                      {pendingVouchers.length} {pendingVoucherLabel}
                    </Text>
                    <View style={styles.pendingExtrasChips}>
                      {pendingVouchers.map((voucher) => (
                        <View key={voucher.id} style={styles.pendingExtraChip}>
                          <Text style={styles.pendingExtraChipText} numberOfLines={1}>
                            {voucher.productTitle ?? '—'}
                            {voucher.variantName ? ` · ${voucher.variantName}` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg,
  },
  empty: { color: theme.colors.muted },
  retryWrap: { marginTop: theme.spacing.md },
  retryBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  retryText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  eventBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.fg,
  },
  eventBannerText: {
    flex: 1,
    color: theme.colors.bg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  eventBannerClear: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'transparent',
  },
  chipActive: {
    backgroundColor: theme.colors.fg,
    borderColor: theme.colors.fg,
  },
  chipText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  chipTextActive: {
    color: theme.colors.bg,
  },
  list: { gap: theme.spacing.md, padding: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  title: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  eventName: { color: theme.colors.fg, fontSize: theme.font.size.sm, fontWeight: '500' },
  sub: { color: theme.colors.muted },
  status: { color: theme.colors.fg, fontWeight: '600', marginTop: theme.spacing.xs },
  statusMuted: { color: theme.colors.muted },
  offlineBadgeRow: {
    marginTop: theme.spacing.xs,
  },
  offlineBadge: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pendingExtras: {
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.muted,
    gap: theme.spacing.xs,
  },
  pendingExtrasLabel: {
    color: theme.colors.accent,
    fontSize: theme.font.size.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pendingExtrasChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  pendingExtraChip: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    maxWidth: '100%',
  },
  pendingExtraChipText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
});
