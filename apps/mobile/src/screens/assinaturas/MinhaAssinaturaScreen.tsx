// Assinaturas — "Minha assinatura" screen.
//
// Consumes usePremiumSubscription (GET /api/me/premium/subscription). Renders the
// active membership (tier/plan, base + add-ons + total, per-add-on cycle usage)
// or a friendly empty state linking back to the plans. The 503 "billing off"
// case is surfaced as an informative state, never a crash.

import { SheetShell } from '@ccc/ui';
import type { MySubscriptionAddon, MySubscriptionResponse } from '@ccc/shared/premium-subscription';
import { ArrowLeft, Check } from 'lucide-react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiError } from '~/api/client';
import { cancelPremiumSubscription } from '~/api/premium';
import { assinaturasCopy } from '~/copy/assinaturas';
import { usePremiumInvoices } from '~/hooks/usePremiumInvoices';
import { usePremiumSubscription } from '~/hooks/usePremiumSubscription';
import { formatBRL } from '~/lib/format';
import { showToast } from '~/lib/toast';
import { c, TIER_VISUAL, type ApiTier } from '~/screens/assinaturas/tier-visual';

const copy = assinaturasCopy.minhaAssinatura;

const APPLE_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/assinaturas');
}

function goToPlans() {
  router.replace('/assinaturas');
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={copy.back}
        hitSlop={8}
        style={styles.backButton}
      >
        <ArrowLeft color={c.cream} size={26} strokeWidth={1.75} />
      </Pressable>
      <Text style={styles.headerTitle}>{copy.header}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function AddonRow({ addon }: { addon: MySubscriptionAddon }) {
  const cycle = addon.currentCycle;
  let usageText: string = copy.usageNoCycle;
  let remainingText: string | null = null;
  if (cycle) {
    usageText =
      addon.quotaUnit === 'hours'
        ? copy.usageHours(cycle.quotaUsed, cycle.quotaTotal)
        : copy.usageAccess(cycle.quotaUsed, cycle.quotaTotal);
    remainingText =
      addon.quotaUnit === 'hours'
        ? copy.usageRemainingHours(cycle.quotaRemaining)
        : copy.usageRemainingAccess(cycle.quotaRemaining);
  }
  return (
    <View style={styles.addonRow}>
      <View style={styles.addonHeaderRow}>
        <Text style={styles.addonName}>{addon.name}</Text>
        {addon.status === 'cancel_scheduled' ? (
          <Text style={styles.addonStatus}>{copy.addonStatusCancelScheduled}</Text>
        ) : null}
      </View>
      <Text style={styles.addonUsageLabel}>{copy.usageLabel}</Text>
      <Text style={styles.addonUsage}>{usageText}</Text>
      {remainingText ? <Text style={styles.addonRemaining}>{remainingText}</Text> : null}
    </View>
  );
}

function InvoiceHistory() {
  const { invoices, loading, error } = usePremiumInvoices();

  if (loading) return null;
  // A history failure must never take the screen down — the subscription card
  // is the important part.
  if (error) return <Text style={styles.historyError}>{copy.historico.error}</Text>;

  return (
    <View style={styles.historySection}>
      <Text style={styles.sectionTitle}>{copy.historico.title}</Text>
      {invoices.length === 0 ? (
        <Text style={styles.historyEmpty}>{copy.historico.empty}</Text>
      ) : (
        <View style={styles.historyList}>
          {invoices.map((inv) => (
            <View key={`${inv.periodStart}-${inv.paidAt}`} style={styles.historyRow}>
              <View style={styles.historyRowText}>
                <Text style={styles.historyPeriod}>
                  {dateFmt.format(new Date(inv.periodStart))}
                </Text>
                <Text style={styles.historyPaidAt}>
                  {copy.historico.paidAt(dateFmt.format(new Date(inv.paidAt)))}
                </Text>
              </View>
              <View style={styles.historyRowAmount}>
                <Text style={styles.historyAmount}>{formatBRL(inv.grossAmountCents)}</Text>
                {inv.refundedAt ? (
                  <Text style={styles.historyRefunded}>{copy.historico.refunded}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ActiveSubscription({
  sub,
  refresh,
}: {
  sub: MySubscriptionResponse;
  refresh: () => Promise<void>;
}) {
  const visual = sub.tier ? TIER_VISUAL[sub.tier as ApiTier] : null;
  const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const periodText = periodEnd
    ? sub.cancelAtPeriodEnd
      ? copy.cancelsAt(dateFmt.format(periodEnd))
      : copy.renewsAt(dateFmt.format(periodEnd))
    : null;

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isApple, setIsApple] = useState(false);
  // `cancelling` state does not apply synchronously, so a rapid second tap can
  // read it as stale `false` in its own closure before the first tap's
  // re-render lands. Gate on a ref instead — checked and set in the same
  // tick, before any `await` — and keep `cancelling` purely for the visual
  // label/disabled/busy props on the CTA.
  const cancellingRef = useRef(false);

  const onConfirmCancel = async () => {
    if (cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    try {
      await cancelPremiumSubscription();
      setCancelOpen(false);
      showToast(copy.cancelar.successToast);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setIsApple(true);
        return;
      }
      setCancelError(copy.cancelar.error);
    } finally {
      cancellingRef.current = false;
      setCancelling(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.planCard}>
          <Text style={styles.planEyebrow}>{copy.planLabel}</Text>
          <View style={styles.tierRow}>
            {visual ? (
              <View
                style={[
                  styles.tierDot,
                  { backgroundColor: visual.accent, shadowColor: visual.accent },
                ]}
              />
            ) : null}
            <Text style={styles.planName}>{sub.planName ?? visual?.label ?? '—'}</Text>
          </View>
          {periodText ? <Text style={styles.periodText}>{periodText}</Text> : null}

          <View style={styles.amountsBlock}>
            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>{copy.baseLabel}</Text>
              <Text style={styles.amountValue}>{formatBRL(sub.baseAmountCents)}</Text>
            </View>
            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>{copy.addonsLabel}</Text>
              <Text style={styles.amountValue}>{formatBRL(sub.addonsAmountCents)}</Text>
            </View>
            <View style={styles.amountDivider} />
            <View style={styles.amountRow}>
              <Text style={styles.totalLabel}>{copy.totalLabel}</Text>
              <Text style={styles.totalValue}>{formatBRL(sub.totalAmountCents)}</Text>
            </View>
          </View>
        </View>

        {sub.benefits.length > 0 ? (
          <View style={styles.benefitsSection}>
            <Text style={styles.sectionTitle}>{copy.benefitsTitle}</Text>
            <View style={styles.benefits}>
              {sub.benefits.map((benefit) => (
                <View key={benefit} style={styles.benefitRow}>
                  <Check color={c.goldLight} size={18} strokeWidth={2} style={styles.benefitIcon} />
                  <Text style={styles.benefitText}>{benefit}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {sub.addons.length > 0 ? (
          <View style={styles.addonsSection}>
            <Text style={styles.addonsTitle}>{copy.addonsTitle}</Text>
            <View style={styles.addons}>
              {sub.addons.map((addon) => (
                <AddonRow key={addon.key} addon={addon} />
              ))}
            </View>
          </View>
        ) : null}

        <InvoiceHistory />

        <Pressable
          onPress={() => router.push('/assinaturas?all=1')}
          accessibilityRole="button"
          accessibilityLabel={copy.seeAllPlans}
          style={styles.seeAllPlans}
        >
          <Text style={styles.seeAllPlansText}>{copy.seeAllPlans}</Text>
        </Pressable>

        <Pressable
          onPress={() => setCancelOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={copy.cancelar.trigger}
          style={styles.cancelTrigger}
          testID="assinatura-cancelar"
        >
          <Text style={styles.cancelTriggerText}>{copy.cancelar.trigger}</Text>
        </Pressable>
      </ScrollView>

      <SheetShell
        visible={cancelOpen}
        title={isApple ? copy.cancelar.appleTitle : copy.cancelar.sheetTitle}
        onClose={() => setCancelOpen(false)}
        theme={{
          surface: c.surface,
          border: c.hairline,
          titleColor: c.cream,
          titleFontFamily: 'Inter_600SemiBold',
        }}
        testID="assinatura-cancelar-sheet"
      >
        {isApple ? (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetText}>{copy.cancelar.appleBody}</Text>
            <Pressable
              onPress={() => void Linking.openURL(APPLE_MANAGE_URL)}
              accessibilityRole="button"
              accessibilityLabel={copy.cancelar.appleCta}
              style={styles.sheetKeep}
            >
              <Text style={styles.sheetKeepText}>{copy.cancelar.appleCta}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetText}>
              {periodEnd ? copy.cancelar.body(dateFmt.format(periodEnd)) : copy.cancelar.sheetTitle}
            </Text>
            {cancelError ? <Text style={styles.sheetError}>{cancelError}</Text> : null}
            <Pressable
              onPress={() => setCancelOpen(false)}
              accessibilityRole="button"
              accessibilityLabel={copy.cancelar.keep}
              style={styles.sheetKeep}
            >
              <Text style={styles.sheetKeepText}>{copy.cancelar.keep}</Text>
            </Pressable>
            <Pressable
              onPress={() => void onConfirmCancel()}
              disabled={cancelling}
              accessibilityRole="button"
              accessibilityLabel={copy.cancelar.confirm}
              accessibilityState={{ disabled: cancelling, busy: cancelling }}
              style={[styles.sheetConfirm, cancelling && styles.dimmed]}
              testID="assinatura-cancelar-confirmar"
            >
              <Text style={styles.sheetConfirmText}>
                {cancelling ? copy.cancelar.loading : copy.cancelar.confirm}
              </Text>
            </Pressable>
          </View>
        )}
      </SheetShell>
    </View>
  );
}

function CenteredState({
  title,
  subcopy,
  cta,
  onPress,
  testID,
}: {
  title: string;
  subcopy?: string;
  cta?: string;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.centerFill}>
      <Text style={styles.stateTitle}>{title}</Text>
      {subcopy ? <Text style={styles.stateSubcopy}>{subcopy}</Text> : null}
      {cta && onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={cta}
          style={styles.ctaButton}
          testID={testID}
        >
          <Text style={styles.ctaText}>{cta}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function MinhaAssinaturaScreen() {
  const { subscription, loading, error, billingUnavailable, refresh } = usePremiumSubscription();

  let body: ReactNode;
  if (loading) {
    body = (
      <View style={styles.centerFill}>
        <ActivityIndicator color={c.gold} />
        <Text style={styles.stateSubcopy}>{copy.loading}</Text>
      </View>
    );
  } else if (billingUnavailable) {
    body = (
      <CenteredState
        title={copy.unavailableTitle}
        subcopy={copy.unavailableSubcopy}
        testID="assinatura-unavailable"
      />
    );
  } else if (error) {
    body = (
      <CenteredState
        title={copy.errorTitle}
        cta={copy.errorRetry}
        onPress={() => void refresh()}
        testID="assinatura-retry"
      />
    );
  } else if (subscription && subscription.active) {
    body = <ActiveSubscription sub={subscription} refresh={refresh} />;
  } else {
    body = (
      <CenteredState
        title={copy.emptyTitle}
        subcopy={copy.emptySubcopy}
        cta={copy.emptyCta}
        onPress={goToPlans}
        testID="assinatura-empty-cta"
      />
    );
  }

  return (
    <View style={styles.screen}>
      <Header />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 120 },

  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  stateTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    color: c.cream,
    textAlign: 'center',
  },
  stateSubcopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: c.muted55,
    textAlign: 'center',
    maxWidth: 280,
  },
  ctaButton: {
    marginTop: 6,
    borderRadius: 11,
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderWidth: 1,
    borderColor: c.tileBorder,
  },
  ctaText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: c.goldLight,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 14,
    paddingHorizontal: 20,
  },
  backButton: { padding: 6 },
  headerTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.88,
    color: c.cream,
  },
  headerSpacer: { width: 38 },

  // Plan card
  planCard: {
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.5)',
    backgroundColor: c.surface,
    marginTop: 8,
  },
  planEyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  tierDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 4,
  },
  planName: { fontFamily: 'Inter_600SemiBold', fontSize: 26, lineHeight: 28, color: c.cream },
  periodText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    color: c.muted55,
    marginTop: 8,
  },
  amountsBlock: { marginTop: 20, gap: 12 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amountLabel: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: c.muted55 },
  amountValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: c.cream },
  amountDivider: { height: 1, backgroundColor: 'rgba(212,175,55,0.2)', marginVertical: 4 },
  totalLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: c.cream },
  totalValue: { fontFamily: 'Inter_600SemiBold', fontSize: 18, color: c.goldLight },

  // Add-ons
  addonsSection: { marginTop: 30 },
  addonsTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },
  addons: { marginTop: 14, gap: 12 },
  addonRow: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: 16,
    padding: 16,
  },
  addonHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  addonName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.cream },
  addonStatus: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color: c.muted50,
  },
  addonUsageLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.4,
    color: c.muted42,
    marginTop: 12,
  },
  addonUsage: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: c.cream, marginTop: 4 },
  addonRemaining: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: c.goldLight,
    marginTop: 3,
  },

  // Shared section title (benefits + history)
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },

  // Benefits
  benefitsSection: { marginTop: 30 },
  benefits: { marginTop: 14, gap: 13 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  benefitIcon: { marginTop: 1 },
  benefitText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 19,
    color: c.cream,
  },

  // Billing history
  historySection: { marginTop: 30 },
  historyError: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: c.cream,
    marginTop: 30,
  },
  historyEmpty: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: c.muted55,
    marginTop: 14,
  },
  historyList: { marginTop: 14, gap: 12 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: 16,
    padding: 16,
  },
  historyRowText: { flex: 1, minWidth: 0 },
  historyPeriod: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: c.cream },
  historyPaidAt: { fontFamily: 'Inter_400Regular', fontSize: 12, color: c.muted55, marginTop: 3 },
  historyRowAmount: { alignItems: 'flex-end', gap: 3 },
  historyAmount: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: c.cream },
  historyRefunded: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.5,
    color: c.muted50,
  },

  // See all plans
  seeAllPlans: {
    marginTop: 30,
    borderRadius: 11,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.tileBorder,
  },
  seeAllPlansText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: c.goldLight,
  },

  // Cancel trigger + sheet
  cancelTrigger: { marginTop: 16, alignItems: 'center', paddingVertical: 10 },
  cancelTriggerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: c.muted55,
  },
  sheetBody: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  sheetText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, color: c.cream },
  // Fix round 1: was c.cream (same as body text — a member could miss that
  // this was an error). Now uses c.danger, added to tier-visual.ts for this.
  sheetError: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.danger },
  sheetKeep: {
    borderRadius: 11,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.tileBorder,
  },
  sheetKeepText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: c.goldLight,
  },
  // Fix round 1: border/text were c.hairline/c.cream — the same visual
  // weight as "manter assinatura" above, so the destructive action didn't
  // read as destructive. Now uses c.danger/c.dangerBorder so the two
  // buttons are clearly different.
  sheetConfirm: {
    borderRadius: 11,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.dangerBorder,
  },
  sheetConfirmText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: c.danger,
  },
  dimmed: { opacity: 0.6 },
});
