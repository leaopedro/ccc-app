// Caixa — "Montar a caixa" builder (design screens 02/03, Fase 3b-2a).
//
// Composes useBox + useBoxCatalog (data) with useBoxBuilder (optimistic
// selection + debounced writes) and the pure helpers from builder-selection.
// useBoxBuilder owns totals once mounted — it reconciles only from its own
// PUT responses, not from a fresh `box` prop — so this screen never calls
// useBox().refresh() to update the live budget bar; that's expected, see
// useBoxBuilder.ts.
//
// Non-open boxes are not this screen's problem: the home screen
// (/caixa/index.tsx) owns every read-only status. If the box isn't `open`
// (or doesn't exist), we bounce back there instead of rendering a builder
// over data it can't safely edit.

import type { BoxCatalog, BoxView } from '@ccc/shared/box';
import { Button, Text } from '@ccc/ui';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { useBox } from '~/hooks/useBox';
import { useBoxBuilder } from '~/hooks/useBoxBuilder';
import { useBoxCatalog } from '~/hooks/useBoxCatalog';
import { BudgetMeter } from '~/screens/caixa/BudgetMeter';
import {
  filterByCategory,
  summaryState,
  type OptimisticTotals,
} from '~/screens/caixa/builder-selection';
import { CaixaSkeleton } from '~/screens/caixa/CaixaSkeleton';
import { CatalogItemCard } from '~/screens/caixa/CatalogItemCard';
import { EmptyState } from '~/screens/caixa/EmptyState';
import { formatBRL, formatCountdown, isUrgent } from '~/screens/caixa/format';
import { OfflineBanner } from '~/screens/caixa/OfflineBanner';
import { theme } from '~/theme';

const GOLD_LABEL = '#C9A227';
const SURFACE = '#0F0E0B';
const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';
const OVERFLOW_BG = 'rgba(34,197,94,0.08)';
const OVERFLOW_BORDER = 'rgba(34,197,94,0.3)';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

/* ------------------------------------------------------------------ */
/* Chrome shared across the loading/error/empty bodies                 */
/* ------------------------------------------------------------------ */

function SimpleHeader() {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={8}
      >
        <ArrowLeft color={theme.colors.fg} size={24} strokeWidth={1.75} />
      </Pressable>
      <Text variant="body" weight="semibold">
        {caixaCopy.builder.title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Builder chrome                                                      */
/* ------------------------------------------------------------------ */

function BuilderHeader({ cutoffAt, onBack }: { cutoffAt: string; onBack: () => void }) {
  // Recomputed once a minute — this is a status readout, not a stopwatch
  // (same cadence as CutoffBanner on the home screen).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const msRemaining = new Date(cutoffAt).getTime() - now;
  const urgent = isUrgent(msRemaining);

  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={8}
      >
        <ArrowLeft color={theme.colors.fg} size={24} strokeWidth={1.75} />
      </Pressable>
      <Text variant="body" weight="semibold">
        {caixaCopy.builder.title}
      </Text>
      <Text
        variant="caption"
        weight="semibold"
        style={urgent ? styles.countdownUrgent : styles.countdown}
      >
        {formatCountdown(msRemaining)}
      </Text>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipActive]}
    >
      <Text variant="caption" weight="medium" style={selected ? styles.chipTextActive : undefined}>
        {label}
      </Text>
    </Pressable>
  );
}

function CategoryChips({
  categories,
  active,
  onSelect,
}: {
  categories: string[];
  active: string | null;
  onSelect: (next: string | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsRow}
    >
      <Chip
        label={caixaCopy.builder.all}
        selected={active === null}
        onPress={() => onSelect(null)}
      />
      {categories.map((category) => (
        <Chip
          key={category}
          label={category}
          selected={active === category}
          onPress={() => onSelect(category)}
        />
      ))}
    </ScrollView>
  );
}

function SummaryLine({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <View style={styles.summaryLine}>
      <Text variant="bodySm" tone="secondary">
        {label}
      </Text>
      <Text
        variant="bodySm"
        weight="semibold"
        style={tone === 'success' ? styles.successText : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

function SummaryFooter({
  totals,
  partnerCount,
  writeError,
  onRetry,
  onReview,
}: {
  totals: OptimisticTotals;
  partnerCount: number;
  writeError: boolean;
  onRetry: () => void;
  onReview: () => void;
}) {
  const summary = summaryState(totals);
  const ctaDisabled = summary.catalogCount === 0;

  return (
    <View style={styles.footer}>
      {writeError ? (
        <View style={styles.writeErrorRow}>
          <Text variant="caption" tone="danger" style={styles.writeErrorText}>
            {caixaCopy.builder.writeError}
          </Text>
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={caixaCopy.actions.retry}
          >
            <Text variant="caption" tone="brand" weight="semibold">
              {caixaCopy.actions.retry}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {summary.collapsed ? (
        <View style={styles.summaryCollapsed}>
          <Text variant="bodySm" weight="semibold">
            {caixaCopy.builder.withinBudget(summary.catalogCount)}
          </Text>
          <Text variant="caption" style={styles.successText}>
            {caixaCopy.builder.noExtraCharge}
          </Text>
        </View>
      ) : (
        <View style={styles.summaryExpanded}>
          <SummaryLine
            label={caixaCopy.summary.includedInPlan}
            value={formatBRL(totals.includedCents)}
          />
          <SummaryLine
            label={caixaCopy.summary.overflow}
            value={formatBRL(totals.overflowCents)}
            tone="success"
          />
          <SummaryLine
            label={caixaCopy.summary.partners(partnerCount)}
            value={formatBRL(totals.partnersTotalCents)}
          />
          <View style={styles.divider} />
          <View style={styles.payRow}>
            <Text variant="bodySm" tone="secondary">
              {caixaCopy.budget.toPay}
            </Text>
            <Text style={styles.payValue}>{formatBRL(totals.chargeCents)}</Text>
          </View>
        </View>
      )}

      <Button
        label={caixaCopy.builder.reviewCta}
        onPress={onReview}
        disabled={ctaDisabled}
        className="mt-3"
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Builder body — only mounts once box/catalog are ready, so the       */
/* useBoxBuilder hook is always called in the same position.           */
/* ------------------------------------------------------------------ */

function BuilderBody({ box, catalog }: { box: BoxView; catalog: BoxCatalog }) {
  const builder = useBoxBuilder(box, catalog);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const hasOverflow = builder.totals.overflowCents > 0;

  const filteredItems = useMemo(
    () => filterByCategory(catalog.items, activeCategory),
    [catalog.items, activeCategory],
  );

  const partnerCount = useMemo(
    () => Object.values(builder.partners).filter((qty) => qty > 0).length,
    [builder.partners],
  );

  const meterBox = useMemo(
    () => ({
      itemsTotalCents: builder.totals.itemsTotalCents,
      budgetCents: box.budgetCents,
      overflowCents: builder.totals.overflowCents,
    }),
    [builder.totals.itemsTotalCents, builder.totals.overflowCents, box.budgetCents],
  );

  const remainingCents = Math.max(0, box.budgetCents - builder.totals.itemsTotalCents);

  const handleBack = () => {
    void builder.flush();
    goBack();
  };

  const handleReview = () => {
    void builder.flush().then(() => {
      router.push('/caixa/revisar' as never);
    });
  };

  return (
    <View style={styles.screen}>
      <BuilderHeader cutoffAt={box.cutoffAt} onBack={handleBack} />

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        style={styles.list}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <BudgetMeter box={meterBox} compact animated />
            <Text variant="caption" tone="muted" style={styles.remainingText}>
              {caixaCopy.builder.remaining(formatBRL(remainingCents))}
            </Text>
            <CategoryChips
              categories={catalog.categories}
              active={activeCategory}
              onSelect={setActiveCategory}
            />
            {hasOverflow ? (
              <View style={styles.overflowBanner}>
                <Text variant="bodySm" weight="medium" style={styles.overflowBannerText}>
                  {caixaCopy.builder.overflowBanner(formatBRL(builder.totals.overflowCents))}
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <CatalogItemCard
            item={item}
            qty={builder.items[item.id] ?? 0}
            isOverflow={hasOverflow}
            onChange={(next) => builder.setItemQty(item.id, next)}
          />
        )}
      />

      <SummaryFooter
        totals={builder.totals}
        partnerCount={partnerCount}
        writeError={builder.writeError}
        onRetry={() => void builder.retry()}
        onReview={handleReview}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                               */
/* ------------------------------------------------------------------ */

export default function MontarCaixaScreen() {
  const { box, loading: boxLoading, error: boxError, refresh: refreshBox } = useBox();
  const {
    catalog,
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
  } = useBoxCatalog();

  const isOpen = !!box && box.status === 'open';

  useEffect(() => {
    if (boxLoading || boxError) return;
    if (!isOpen) router.replace('/caixa' as never);
  }, [boxLoading, boxError, isOpen]);

  if (boxLoading || catalogLoading) {
    return <CaixaSkeleton />;
  }

  if (boxError || catalogError) {
    return (
      <View style={styles.screen}>
        <OfflineBanner />
        <SimpleHeader />
        <View style={styles.centerBlock}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.loadError.title}
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.centerBody}>
            {caixaCopy.loadError.body}
          </Text>
          <Button
            label={caixaCopy.actions.retry}
            onPress={() => {
              void refreshBox();
              void refreshCatalog();
            }}
            className="mt-5"
          />
        </View>
      </View>
    );
  }

  // Not open (or missing): home owns every non-open state. Render the
  // skeleton for the brief moment until the redirect effect above fires.
  if (!isOpen || !box) {
    return <CaixaSkeleton />;
  }

  if (!catalog || catalog.items.length === 0) {
    return (
      <View style={styles.screen}>
        <SimpleHeader />
        <View style={styles.centerBlock}>
          <EmptyState title={caixaCopy.empty.catalog.title} body={caixaCopy.empty.catalog.body} />
        </View>
      </View>
    );
  }

  return <BuilderBody box={box} catalog={catalog} />;
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
  headerSpacer: {
    width: 32,
  },
  countdown: {
    color: GOLD_LABEL,
  },
  countdownUrgent: {
    color: theme.colors.warning,
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
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  listHeader: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  remainingText: {
    marginTop: -theme.spacing.xs,
  },
  row: {
    gap: theme.spacing.sm,
  },
  chipsRow: {
    gap: theme.spacing.sm,
  },
  chip: {
    height: 32,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: GOLD_LABEL,
    backgroundColor: 'rgba(212,175,55,0.12)',
  },
  chipTextActive: {
    color: GOLD_LABEL,
  },
  overflowBanner: {
    backgroundColor: OVERFLOW_BG,
    borderWidth: 1,
    borderColor: OVERFLOW_BORDER,
    borderRadius: theme.radii.lg,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  overflowBannerText: {
    color: theme.colors.success,
  },
  footer: {
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: BORDER_GOLD_SOFT,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  writeErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  writeErrorText: {
    flexShrink: 1,
  },
  summaryCollapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryExpanded: {
    gap: theme.spacing.sm,
  },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  successText: {
    color: theme.colors.success,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER_GOLD_SOFT,
    marginVertical: theme.spacing.xs,
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  payValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: theme.font.size.xxl,
    color: theme.colors.accent,
  },
});
