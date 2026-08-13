// Caixa — box history screen (design screen 12).
//
// Read-only list of past cycles. Cards are NOT navigable yet — there is no
// box-detail route in this phase (Fase 3b-1), so each row is a plain View
// with a decorative chevron, not a Pressable. Wiring a detail screen is
// follow-up work for a later phase.

import type { BoxHistory } from '@ccc/shared/box';
import { Button, Text } from '@ccc/ui';
import { router } from 'expo-router';
import { ArrowLeft, ChevronRight, WifiOff } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { useBoxHistory } from '~/hooks/useBoxHistory';
import { boxStatusLabel, cycleMonthYearLabel } from '~/screens/caixa/box-state';
import { EmptyState } from '~/screens/caixa/EmptyState';
import { formatBRL } from '~/screens/caixa/format';
import { theme } from '~/theme';

// README design tokens not covered by ~/theme.
const GOLD_LABEL = '#C9A227';
const SURFACE = '#0F0E0B';
const BORDER_GOLD = 'rgba(212,175,55,0.28)';
const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';
const BLOCK_COLOR = 'rgba(242,232,216,0.05)';

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={8}
        style={styles.backButton}
      >
        <ArrowLeft color={theme.colors.fg} size={24} strokeWidth={1.75} />
      </Pressable>
      <Text variant="body" weight="semibold">
        {caixaCopy.history.title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function HistorySkeleton() {
  return (
    <View style={styles.skeletonList} accessibilityLabel="Carregando histórico de caixas">
      {[0, 1, 2, 3].map((key) => (
        <View key={key} style={styles.skeletonCard}>
          <View style={styles.skeletonThumb} />
          <View style={styles.skeletonLines}>
            <View style={styles.skeletonLineLg} />
            <View style={styles.skeletonLineSm} />
          </View>
        </View>
      ))}
    </View>
  );
}

function HistoryCard({ entry }: { entry: BoxHistory[number] }) {
  const thumbUrl = entry.thumbnails[0];

  return (
    <View style={[styles.card, entry.current ? styles.cardCurrent : styles.cardDefault]}>
      {thumbUrl ? (
        <Image source={{ uri: thumbUrl }} style={styles.thumb} accessible={false} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]} />
      )}
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {capitalize(cycleMonthYearLabel(entry.cycleKey))}
          </Text>
          {entry.current ? (
            <View style={styles.currentBadge}>
              <Text style={styles.currentBadgeText}>{caixaCopy.history.current}</Text>
            </View>
          ) : null}
        </View>
        <Text
          variant="bodySm"
          style={entry.current ? styles.cardSubtitleCurrent : styles.cardSubtitleMuted}
        >
          {boxStatusLabel(entry.status)} · {formatBRL(entry.chargeCents)}
        </Text>
      </View>
      <ChevronRight color={theme.colors.muted} size={20} strokeWidth={1.75} />
    </View>
  );
}

export default function BoxHistoryScreen() {
  const { entries, loading, error, refresh } = useBoxHistory();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  if (loading && entries.length === 0) {
    return (
      <View style={styles.screen}>
        <Header />
        <HistorySkeleton />
      </View>
    );
  }

  if (error && entries.length === 0) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerBlock}>
          <WifiOff color={theme.colors.muted} size={32} strokeWidth={1.75} />
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.loadError.title}
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.centerBody}>
            {caixaCopy.loadError.body}
          </Text>
          <Button label={caixaCopy.actions.retry} onPress={() => void refresh()} className="mt-5" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Header />
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        renderItem={({ item }) => <HistoryCard entry={item} />}
        ListEmptyComponent={
          <EmptyState title={caixaCopy.history.empty.title} body={caixaCopy.history.empty.body} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  headerSpacer: {
    width: 32,
  },
  list: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.md,
    flexGrow: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderRadius: 14,
    padding: theme.spacing.md,
  },
  cardDefault: {
    borderColor: BORDER_GOLD_SOFT,
  },
  cardCurrent: {
    borderColor: BORDER_GOLD,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.bg,
  },
  thumbPlaceholder: {
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  cardTitle: {
    flexShrink: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: theme.colors.fg,
  },
  currentBadge: {
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    backgroundColor: 'rgba(212,175,55,0.14)',
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: GOLD_LABEL,
  },
  cardSubtitleMuted: {
    color: theme.colors.muted,
  },
  cardSubtitleCurrent: {
    color: GOLD_LABEL,
  },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  centerTitle: {
    textAlign: 'center',
  },
  centerBody: {
    textAlign: 'center',
    maxWidth: 280,
  },
  skeletonList: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 14,
    padding: theme.spacing.md,
  },
  skeletonThumb: {
    width: 52,
    height: 52,
    borderRadius: theme.radii.md,
    backgroundColor: BLOCK_COLOR,
  },
  skeletonLines: {
    flex: 1,
    gap: theme.spacing.sm,
  },
  skeletonLineLg: {
    height: 14,
    width: '55%',
    borderRadius: theme.radii.sm,
    backgroundColor: BLOCK_COLOR,
  },
  skeletonLineSm: {
    height: 12,
    width: '40%',
    borderRadius: theme.radii.sm,
    backgroundColor: BLOCK_COLOR,
  },
});
