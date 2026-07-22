// Assinaturas — "Minha assinatura" screen.
//
// Consumes usePremiumSubscription (GET /api/me/premium/subscription). Renders the
// active membership (tier/plan, base + add-ons + total, per-add-on cycle usage)
// or a friendly empty state linking back to the plans. The 503 "billing off"
// case is surfaced as an informative state, never a crash.

import type { MySubscriptionAddon, MySubscriptionResponse } from '@ccc/shared/premium-subscription';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { assinaturasCopy } from '~/copy/assinaturas';
import { usePremiumSubscription } from '~/hooks/usePremiumSubscription';
import { formatBRL } from '~/lib/format';
import { c, TIER_VISUAL, type ApiTier } from '~/screens/assinaturas/tier-visual';

const copy = assinaturasCopy.minhaAssinatura;

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

function ActiveSubscription({ sub }: { sub: MySubscriptionResponse }) {
  const visual = sub.tier ? TIER_VISUAL[sub.tier as ApiTier] : null;
  const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const periodText = periodEnd
    ? sub.cancelAtPeriodEnd
      ? copy.cancelsAt(dateFmt.format(periodEnd))
      : copy.renewsAt(dateFmt.format(periodEnd))
    : null;

  return (
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
    </ScrollView>
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
    body = <ActiveSubscription sub={subscription} />;
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
});
