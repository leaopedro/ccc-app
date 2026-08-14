// Caixa — "Revisão + endereço" (design screen 05, Fase 3b-2b).
//
// Read-only view of the persisted box (built on the previous screens) plus
// shipping-address selection and the confirm CTA. Shipping is computed
// server-side at confirm from the chosen address CEP, so it is NOT shown here
// (spec Q1); a muted line says so. On confirm success we route to /caixa,
// where the home screen renders the awaiting_payment / ready read-only body.

import { Button, Text } from '@ccc/ui';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Home, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { useBox } from '~/hooks/useBox';
import { useBoxConfirm } from '~/hooks/useBoxConfirm';
import { useShippingAddresses } from '~/hooks/useShippingAddresses';
import { pickInitialAddressId } from '~/screens/caixa/address-select';
import { CaixaSkeleton } from '~/screens/caixa/CaixaSkeleton';
import { mapConfirmError, type ConfirmFeedback } from '~/screens/caixa/confirm-result';
import { formatBRL } from '~/screens/caixa/format';
import {
  canConfirm,
  reviewItemLines,
  reviewPartnerLines,
  type ReviewLine,
} from '~/screens/caixa/review-sections';
import { formatShippingAddress } from '~/shipping/format-address';
import { theme } from '~/theme';

const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';
const GOLD_LABEL = '#C9A227';
const SURFACE = '#0F0E0B';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

function openAddAddress() {
  router.push({
    pathname: '/profile/shipping/new',
    params: { returnTo: '/caixa/revisar' },
  } as never);
}

function Header() {
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
        {caixaCopy.review.title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function LineRow({ line }: { line: ReviewLine }) {
  return (
    <View style={styles.lineRow}>
      {line.imageUrl ? (
        <Image source={{ uri: line.imageUrl }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]} />
      )}
      <View style={styles.lineBody}>
        <Text
          variant="bodySm"
          numberOfLines={1}
          style={!line.included ? styles.dropped : undefined}
        >
          {line.title}
        </Text>
        <Text variant="caption" tone="muted">
          {caixaCopy.review.lineQty(line.quantity, formatBRL(line.unitPriceCents))}
        </Text>
      </View>
      <Text variant="bodySm" weight="semibold">
        {formatBRL(line.subtotalCents)}
      </Text>
    </View>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text variant="bodySm" tone={muted ? 'muted' : 'secondary'}>
        {label}
      </Text>
      <Text
        variant="bodySm"
        weight={muted ? 'regular' : 'semibold'}
        tone={muted ? 'muted' : 'primary'}
      >
        {value}
      </Text>
    </View>
  );
}

export default function RevisarCaixaScreen() {
  const { box, loading, error, refresh } = useBox();
  const {
    items: addresses,
    loading: loadingAddresses,
    error: addressesError,
    refresh: refreshAddresses,
  } = useShippingAddresses();
  const { confirm, confirming } = useBoxConfirm();

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ConfirmFeedback | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void refreshAddresses();
    }, [refresh, refreshAddresses]),
  );

  // Seed the address from the box first (spec: BoxView.shippingAddressId),
  // then the account default, without clobbering a manual pick.
  useEffect(() => {
    setSelectedAddressId((current) => {
      if (current && addresses.some((a) => a.id === current)) return current;
      return pickInitialAddressId(box?.shippingAddressId ?? null, addresses);
    });
  }, [box, addresses]);

  // Home owns every non-open status. If the box locked/confirmed while we were
  // away (e.g. refocus after cutoff), bounce back instead of showing an
  // editable confirm over a box the server will reject.
  const isOpen = !!box && box.status === 'open';
  useEffect(() => {
    if (loading || error) return;
    if (!isOpen) router.replace('/caixa' as never);
  }, [loading, error, isOpen]);

  if (loading && !box) return <CaixaSkeleton />;

  if (error || !box) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerBlock}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.loadError.title}
          </Text>
          <Button label={caixaCopy.actions.retry} onPress={() => void refresh()} className="mt-5" />
        </View>
      </View>
    );
  }

  const itemLines = reviewItemLines(box);
  const partnerLines = reviewPartnerLines(box);
  const includedCents = Math.min(box.itemsTotalCents, box.budgetCents);
  const confirmEnabled = canConfirm(box, selectedAddressId) && box.status === 'open' && !confirming;

  const onConfirm = async () => {
    if (!selectedAddressId) {
      setFeedback({ kind: 'address_error', message: caixaCopy.review.addressRequired });
      return;
    }
    setFeedback(null);
    const { result, box: confirmed } = await confirm({ shippingAddressId: selectedAddressId });
    if (result === 'ok') {
      // Route on the authoritative post-confirm charge, not the pre-confirm
      // box: confirm adds shipping and can drop out-of-stock lines.
      const charge = confirmed?.chargeCents ?? 0;
      router.replace((charge > 0 ? '/caixa/pagar' : '/caixa') as never);
      return;
    }
    setFeedback(mapConfirmError(result));
  };

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text variant="caption" tone="muted" style={styles.sectionLabel}>
            {caixaCopy.review.planItems}
          </Text>
          {itemLines.map((line) => (
            <LineRow key={line.id} line={line} />
          ))}
        </View>

        {partnerLines.length > 0 ? (
          <View style={styles.section}>
            <Text variant="caption" tone="muted" style={styles.sectionLabel}>
              {caixaCopy.review.partners}
            </Text>
            {partnerLines.map((line) => (
              <LineRow key={line.id} line={line} />
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text variant="caption" tone="muted" style={styles.sectionLabel}>
            {caixaCopy.review.delivery}
          </Text>
          {loadingAddresses ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.addressLoading} />
          ) : addressesError ? (
            <View style={styles.addressErrorBlock}>
              <Text variant="bodySm" tone="muted">
                {caixaCopy.loadError.body}
              </Text>
              <Pressable
                onPress={() => void refreshAddresses()}
                accessibilityRole="button"
                accessibilityLabel={caixaCopy.actions.retry}
                hitSlop={8}
              >
                <Text variant="bodySm" tone="brand" weight="semibold">
                  {caixaCopy.actions.retry}
                </Text>
              </Pressable>
            </View>
          ) : addresses.length === 0 ? (
            <View style={styles.noAddress}>
              <Text variant="bodySm" weight="semibold">
                {caixaCopy.empty.noAddress.title}
              </Text>
              <Text variant="bodySm" tone="muted" style={styles.noAddressBody}>
                {caixaCopy.empty.noAddress.body}
              </Text>
              <Pressable
                onPress={openAddAddress}
                accessibilityRole="button"
                accessibilityLabel={caixaCopy.actions.addAddress}
                style={styles.addAddressBtn}
                hitSlop={8}
              >
                <Plus color={theme.colors.accent} size={14} strokeWidth={2} />
                <Text variant="bodySm" tone="brand" weight="semibold">
                  {caixaCopy.actions.addAddress}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              {addresses.map((address) => {
                const isSelected = selectedAddressId === address.id;
                return (
                  <Pressable
                    key={address.id}
                    onPress={() => setSelectedAddressId(address.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.addressCard, isSelected && styles.addressCardSelected]}
                  >
                    <View style={styles.addressCardHeader}>
                      <Home color={GOLD_LABEL} size={16} strokeWidth={1.75} />
                      <Text variant="bodySm" weight="semibold" numberOfLines={1}>
                        {address.recipientName}
                      </Text>
                    </View>
                    <Text variant="bodySm" tone="muted" numberOfLines={2}>
                      {formatShippingAddress(address)}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={openAddAddress}
                accessibilityRole="button"
                accessibilityLabel={caixaCopy.actions.addAddress}
                style={styles.addAddressBtn}
                hitSlop={8}
              >
                <Plus color={theme.colors.accent} size={14} strokeWidth={2} />
                <Text variant="bodySm" tone="brand" weight="semibold">
                  {caixaCopy.actions.addAddress}
                </Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.totals}>
          <TotalRow
            label={caixaCopy.summary.catalogItems(itemLines.length)}
            value={formatBRL(box.itemsTotalCents)}
          />
          <TotalRow label={caixaCopy.summary.includedInPlan} value={formatBRL(includedCents)} />
          <TotalRow label={caixaCopy.summary.overflow} value={formatBRL(box.overflowCents)} />
          <TotalRow
            label={caixaCopy.summary.partners(partnerLines.length)}
            value={formatBRL(box.partnersTotalCents)}
          />
          <TotalRow label={caixaCopy.review.shippingAtConfirm} value="—" muted />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {box.chargeCents > 0 ? (
          <View style={styles.payRow}>
            <Text variant="bodySm" tone="secondary">
              {caixaCopy.budget.toPay}
            </Text>
            <Text style={styles.payValue}>{formatBRL(box.chargeCents)}</Text>
          </View>
        ) : null}
        <Text variant="caption" tone="muted" style={styles.lockWarning}>
          {caixaCopy.review.lockWarning}
        </Text>
        {feedback ? (
          <Text variant="bodySm" tone="danger" style={styles.feedbackText}>
            {feedback.message}
          </Text>
        ) : null}
        <Button
          label={confirming ? caixaCopy.preferences.saving : caixaCopy.review.confirmCta}
          onPress={() => void onConfirm()}
          disabled={!confirmEnabled}
          className="mt-2"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  headerSpacer: { width: 32 },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.lg,
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
  section: { gap: theme.spacing.sm },
  sectionLabel: { letterSpacing: 1 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  thumbFallback: { backgroundColor: 'rgba(242,232,216,0.05)' },
  lineBody: { flex: 1, gap: 2 },
  dropped: { textDecorationLine: 'line-through', opacity: 0.6 },
  addressLoading: { alignSelf: 'flex-start' },
  addressErrorBlock: { gap: theme.spacing.xs },
  noAddress: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 14,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  noAddressBody: { marginBottom: theme.spacing.xs },
  addressCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    gap: 2,
  },
  addressCardSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: `${theme.colors.accent}12`,
  },
  addressCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  addAddressBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
  },
  totals: {
    gap: theme.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: BORDER_GOLD_SOFT,
    paddingTop: theme.spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footer: {
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: BORDER_GOLD_SOFT,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  payValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: theme.font.size.xxl,
    color: theme.colors.accent,
  },
  lockWarning: { marginBottom: theme.spacing.xs },
  feedbackText: { marginBottom: theme.spacing.xs },
});
