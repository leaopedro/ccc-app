// Caixa — home screen (read-only states, Fase 3b-1).
//
// Branches on useBox()'s loading/error/notOpen flags, then on
// homeVariant(box.status). Every state here is read-only; the interactive
// builder (Fase 3b-2) lives at /caixa/montar. See
// docs/design/box-builder/README.md screens 01/08/09/10/13/14/15.

import type { BoxView } from '@ccc/shared/box';
import { Button, Text } from '@ccc/ui';
import { router, useFocusEffect } from 'expo-router';
import {
  CheckCircle2,
  History,
  Hourglass,
  Lock,
  SlidersHorizontal,
  WifiOff,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { unskipBox } from '~/api/box';
import { caixaCopy } from '~/copy/caixa';
import { useBox } from '~/hooks/useBox';
import { BudgetMeter } from '~/screens/caixa/BudgetMeter';
import {
  budgetMeter,
  canUnskip,
  cycleMonthLabel,
  hasDroppedLines,
  homeVariant,
} from '~/screens/caixa/box-state';
import { CaixaSkeleton } from '~/screens/caixa/CaixaSkeleton';
import { CutoffBanner } from '~/screens/caixa/CutoffBanner';
import { EmptyState } from '~/screens/caixa/EmptyState';
import { FulfillmentTimeline } from '~/screens/caixa/FulfillmentTimeline';
import { formatBRL } from '~/screens/caixa/format';
import { OfflineBanner } from '~/screens/caixa/OfflineBanner';
import { SkipSheet } from '~/screens/caixa/SkipSheet';
import { theme } from '~/theme';

// README design tokens not covered by ~/theme.
const GOLD_LABEL = '#C9A227';
const SURFACE = '#0F0E0B';
const SURFACE_TINT = '#14110a';
const BORDER_GOLD = 'rgba(212,175,55,0.28)';
const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';

const closedDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' });

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function goToHistory() {
  router.push('/caixa/historico' as never);
}

function goToPreferences() {
  router.push('/caixa/preferencias' as never);
}

function goToMontar() {
  router.push('/caixa/montar' as never);
}

/* ------------------------------------------------------------------ */
/* Shared chrome                                                        */
/* ------------------------------------------------------------------ */

function Header({ title }: { title?: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTitles}>
        <Text variant="eyebrow" style={styles.eyebrow}>
          {caixaCopy.header.eyebrow}
        </Text>
        {title ? <Text style={styles.title}>{title}</Text> : null}
      </View>
      <View style={styles.headerButtons}>
        <Pressable
          onPress={goToPreferences}
          accessibilityRole="button"
          accessibilityLabel={caixaCopy.preferences.title}
          hitSlop={8}
          style={styles.historyButton}
        >
          <SlidersHorizontal color={theme.colors.fg} size={22} strokeWidth={1.75} />
        </Pressable>
        <Pressable
          onPress={goToHistory}
          accessibilityRole="button"
          accessibilityLabel={caixaCopy.history.title}
          hitSlop={8}
          style={styles.historyButton}
        >
          <History color={theme.colors.fg} size={22} strokeWidth={1.75} />
        </Pressable>
      </View>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  tone = 'primary',
}: {
  label: string;
  value: string;
  tone?: 'primary' | 'success';
}) {
  return (
    <View style={styles.summaryRow}>
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

function LineRow({
  title,
  meta,
  value,
  dropped = false,
}: {
  title: string;
  meta: string;
  value?: string;
  dropped?: boolean;
}) {
  return (
    <View style={[styles.lineRow, dropped && styles.lineRowDropped]}>
      <View style={styles.lineRowText}>
        <Text
          variant="bodySm"
          weight="medium"
          numberOfLines={1}
          style={dropped ? styles.strikethrough : undefined}
        >
          {title}
        </Text>
        <Text variant="caption" tone="muted">
          {meta}
        </Text>
      </View>
      {value ? (
        <Text variant="bodySm" weight="semibold">
          {value}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* homeVariant bodies                                                   */
/* ------------------------------------------------------------------ */

function OpenBody({ box, onSkip }: { box: BoxView; onSkip: () => void }) {
  const includedCents = budgetMeter(box).includedCents;

  return (
    <>
      <CutoffBanner cutoffAt={box.cutoffAt} />
      <BudgetMeter box={box} />
      <View style={styles.summaryCard}>
        <SummaryRow
          label={caixaCopy.summary.catalogItems(box.items.length)}
          value={formatBRL(box.itemsTotalCents)}
        />
        <SummaryRow label={caixaCopy.summary.includedInPlan} value={formatBRL(includedCents)} />
        {box.overflowCents > 0 ? (
          <SummaryRow
            label={caixaCopy.summary.overflow}
            value={formatBRL(box.overflowCents)}
            tone="success"
          />
        ) : null}
        <SummaryRow
          label={caixaCopy.summary.partners(box.partnerItems.length)}
          value={formatBRL(box.partnersTotalCents)}
        />
        <View style={styles.divider} />
        <View style={styles.payRow}>
          <Text variant="bodySm" tone="secondary">
            {caixaCopy.budget.toPay}
          </Text>
          <Text style={styles.payValue}>{formatBRL(box.chargeCents)}</Text>
        </View>
      </View>
      <Button label={caixaCopy.actions.edit} onPress={goToMontar} className="mt-2" />
      <Pressable
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel={caixaCopy.actions.skip}
        style={styles.skipLink}
      >
        <Text variant="bodySm" tone="muted">
          {caixaCopy.actions.skip}
        </Text>
      </Pressable>
    </>
  );
}

function SkippedBody({
  box,
  onUnskip,
  unskipping,
  unskipError,
}: {
  box: BoxView;
  onUnskip: () => void;
  unskipping: boolean;
  unskipError: boolean;
}) {
  const disabled = !canUnskip(box.cutoffAt) || unskipping;

  return (
    <View style={styles.centerBlock}>
      <Text variant="h3" style={styles.centerTitle}>
        {caixaCopy.skipped.title(cycleMonthLabel(box.cycleKey))}
      </Text>
      <Pressable
        onPress={onUnskip}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={caixaCopy.skipped.back}
        accessibilityState={{ disabled }}
        style={styles.textLink}
      >
        <Text variant="bodySm" tone={disabled ? 'muted' : 'brand'}>
          {caixaCopy.skipped.back}
        </Text>
      </Pressable>
      {unskipError ? (
        <Text variant="bodySm" tone="danger" style={styles.centerBody}>
          {caixaCopy.loadError.body}
        </Text>
      ) : null}
    </View>
  );
}

function AwaitingPaymentBody({ box }: { box: BoxView }) {
  const lines = [
    ...box.items.map((item) => ({
      key: `item-${item.catalogItemId}`,
      title: item.titleSnapshot,
      quantity: item.quantity,
      subtotalCents: item.subtotalCents,
    })),
    ...box.partnerItems.map((partnerItem) => ({
      key: `partner-${partnerItem.partnerModuleId}`,
      title: partnerItem.nameSnapshot,
      quantity: partnerItem.quantity,
      subtotalCents: partnerItem.subtotalCents,
    })),
  ];

  return (
    <>
      <View style={styles.lockBanner}>
        <Lock color={GOLD_LABEL} size={18} strokeWidth={1.75} />
        <Text variant="bodySm" weight="semibold" style={styles.lockBannerText}>
          {caixaCopy.awaiting.banner}
        </Text>
      </View>
      <CutoffBanner cutoffAt={box.cutoffAt} />
      <View style={[styles.linesCard, styles.readOnly72]}>
        {lines.map((line) => (
          <LineRow
            key={line.key}
            title={line.title}
            meta={`${line.quantity}×`}
            value={formatBRL(line.subtotalCents)}
          />
        ))}
      </View>
      <View style={styles.summaryCard}>
        <View style={styles.payRow}>
          <Text variant="bodySm" tone="secondary">
            {caixaCopy.budget.toPay}
          </Text>
          <Text style={styles.payValue}>{formatBRL(box.chargeCents)}</Text>
        </View>
      </View>
      <Button
        label={caixaCopy.actions.resumePayment}
        onPress={() => router.replace('/caixa/pagar' as never)}
        className="mt-2"
      />
      <Text variant="bodySm" tone="secondary" style={styles.centerCaption}>
        {caixaCopy.awaiting.note}
      </Text>
    </>
  );
}

function PostCutoffBody({ box }: { box: BoxView }) {
  const partnerLines = box.partnerItems.map((partnerItem) => ({
    key: `partner-${partnerItem.partnerModuleId}`,
    title: partnerItem.nameSnapshot,
    quantity: partnerItem.quantity,
    subtotalCents: partnerItem.subtotalCents,
    included: partnerItem.included,
    dropReason: partnerItem.dropReason,
  }));
  const itemLines = box.items.map((item) => ({
    key: `item-${item.catalogItemId}`,
    title: item.titleSnapshot,
    quantity: item.quantity,
    subtotalCents: item.subtotalCents,
    included: item.included,
    dropReason: item.dropReason,
  }));
  // Cutoff drop order is parceiros first, then catálogo (R2b) — mirrored here
  // for display, though what matters for this screen is just the split.
  const allLines = [...partnerLines, ...itemLines];
  const sentLines = allLines.filter((line) => line.included);
  const removedLines = allLines.filter((line) => !line.included);
  const sentTotalCents = sentLines.reduce((sum, line) => sum + line.subtotalCents, 0);

  return (
    <>
      <View style={styles.lockBanner}>
        <Hourglass color={GOLD_LABEL} size={18} strokeWidth={1.75} />
        <Text variant="bodySm" weight="semibold" style={styles.lockBannerText}>
          {caixaCopy.postCutoff.closedOn(closedDateFormatter.format(new Date(box.cutoffAt)))}
        </Text>
      </View>
      <FulfillmentTimeline status={box.fulfillmentStatus} />
      <Text variant="bodySm" tone="secondary">
        {caixaCopy.postCutoff.note}
      </Text>

      <View style={styles.linesSection}>
        <Text variant="caption" style={styles.sectionLabel}>
          {caixaCopy.postCutoff.sent} · {formatBRL(sentTotalCents)}
        </Text>
        <View style={styles.linesCard}>
          {sentLines.map((line) => (
            <LineRow
              key={line.key}
              title={line.title}
              meta={`${line.quantity}×`}
              value={formatBRL(line.subtotalCents)}
            />
          ))}
        </View>
      </View>

      {removedLines.length > 0 ? (
        <View style={styles.linesSection}>
          <Text variant="caption" style={styles.sectionLabel}>
            {caixaCopy.postCutoff.removed}
          </Text>
          <View style={[styles.linesCard, styles.removed45]}>
            {removedLines.map((line) => (
              <LineRow key={line.key} title={line.title} meta={line.dropReason ?? ''} dropped />
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

function ReadyBody({ box }: { box: BoxView }) {
  const thumbs = [
    ...box.items
      .filter((item) => item.included)
      .map((item) => ({ key: `item-${item.catalogItemId}`, imageUrl: item.imageUrl })),
    ...box.partnerItems
      .filter((partnerItem) => partnerItem.included)
      .map((partnerItem) => ({
        key: `partner-${partnerItem.partnerModuleId}`,
        imageUrl: partnerItem.imageUrl,
      })),
  ];

  return (
    <>
      <View style={styles.readyBanner}>
        <CheckCircle2 color={theme.colors.success} size={20} strokeWidth={1.75} />
        <Text variant="body" weight="semibold" style={styles.readyBannerText}>
          {caixaCopy.ready.banner}
        </Text>
      </View>
      <View style={styles.thumbGrid}>
        {thumbs.map((thumb) =>
          thumb.imageUrl ? (
            <Image
              key={thumb.key}
              source={{ uri: thumb.imageUrl }}
              style={styles.thumb}
              accessible={false}
            />
          ) : (
            <View key={thumb.key} style={[styles.thumb, styles.thumbPlaceholder]} />
          ),
        )}
      </View>
      <FulfillmentTimeline status={box.fulfillmentStatus} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                               */
/* ------------------------------------------------------------------ */

export default function CaixaHome() {
  const { box, loading, error, notOpen, refresh } = useBox();
  const [unskipping, setUnskipping] = useState(false);
  const [unskipError, setUnskipError] = useState(false);
  const [skipSheetVisible, setSkipSheetVisible] = useState(false);

  // Tab screens stay mounted, so a cutoff or payment transition that happens
  // while the member is on another tab would otherwise show stale state.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onUnskip = async () => {
    if (unskipping || !box || !canUnskip(box.cutoffAt)) return;
    setUnskipping(true);
    setUnskipError(false);
    try {
      await unskipBox();
      await refresh();
    } catch {
      // Surface the failure so an offline request or cutoff race is not silent.
      setUnskipError(true);
    } finally {
      setUnskipping(false);
    }
  };

  if (loading) {
    return <CaixaSkeleton />;
  }

  if (error) {
    return (
      <View style={styles.screen}>
        <OfflineBanner />
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

  if (notOpen || !box) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.notOpenWrap}>
          <EmptyState title={caixaCopy.notOpen.title} body={caixaCopy.notOpen.body} />
        </View>
      </View>
    );
  }

  const variant = homeVariant(box.status);
  const title = capitalize(cycleMonthLabel(box.cycleKey));
  const monthLabel = cycleMonthLabel(box.cycleKey);

  return (
    <View style={styles.screen}>
      <Header title={title} />
      <ScrollView contentContainerStyle={styles.content}>
        {variant === 'open' ? (
          <OpenBody box={box} onSkip={() => setSkipSheetVisible(true)} />
        ) : null}
        {variant === 'skipped' ? (
          <SkippedBody
            box={box}
            onUnskip={() => void onUnskip()}
            unskipping={unskipping}
            unskipError={unskipError}
          />
        ) : null}
        {variant === 'awaiting_payment' ? <AwaitingPaymentBody box={box} /> : null}
        {variant === 'ready' ? (
          hasDroppedLines(box) ? (
            <PostCutoffBody box={box} />
          ) : (
            <ReadyBody box={box} />
          )
        ) : null}
      </ScrollView>
      <SkipSheet
        visible={skipSheetVisible}
        month={monthLabel}
        onClose={() => setSkipSheetVisible(false)}
        onDone={() => void refresh()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
    gap: theme.spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  headerTitles: {
    gap: theme.spacing.xs,
  },
  eyebrow: {
    color: GOLD_LABEL,
    letterSpacing: 2.8,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    color: theme.colors.fg,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  historyButton: {
    padding: theme.spacing.xs,
  },
  summaryCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 16,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  summaryRow: {
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
  skipLink: {
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
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
  centerCaption: {
    textAlign: 'center',
  },
  textLink: {
    marginTop: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  lockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: SURFACE_TINT,
    borderWidth: 1,
    borderColor: BORDER_GOLD,
    borderRadius: theme.radii.lg,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  lockBannerText: {
    color: GOLD_LABEL,
  },
  linesCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 16,
    paddingHorizontal: theme.spacing.lg,
  },
  readOnly72: {
    opacity: 0.72,
  },
  removed45: {
    opacity: 0.45,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_GOLD_SOFT,
  },
  lineRowDropped: {},
  lineRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  strikethrough: {
    textDecorationLine: 'line-through',
  },
  linesSection: {
    gap: theme.spacing.sm,
  },
  sectionLabel: {
    color: GOLD_LABEL,
    letterSpacing: 2.8,
  },
  readyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
    borderRadius: theme.radii.lg,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  readyBannerText: {
    color: theme.colors.success,
  },
  thumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  thumb: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: theme.radii.md,
    backgroundColor: SURFACE,
  },
  thumbPlaceholder: {
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
  },
  notOpenWrap: {
    flex: 1,
    justifyContent: 'center',
  },
});
