// Assinaturas — package-assembly ("contratação") screen.
//
// Member picks the plan's optional add-on modules and sees the total
// recalculate live; the CTA hands off to the real checkout seam (checkout.ts).
// The webhook that flips a subscription active is asynchronous, so after the
// checkout browser returns we poll (poll-subscription.ts) before navigating —
// a closed browser does not prove payment.

import type { PremiumPlan } from '@ccc/shared/premium-catalog';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getPremiumPlan } from '~/api/premium-catalog';
import { assinaturasCopy } from '~/copy/assinaturas';
import { usePremiumAddonModules } from '~/hooks/usePremiumAddonModules';
import { formatBRL } from '~/lib/format';
import { showToast } from '~/lib/toast';
import { startPremiumCheckout } from '~/screens/assinaturas/checkout';
import { packageTotalCents } from '~/screens/assinaturas/package-total';
import { pollSubscriptionActive } from '~/screens/assinaturas/poll-subscription';
import { TierCta } from '~/screens/assinaturas/TierCta';
import { c, monthlyPriceCents, TIER_VISUAL, tierStyle } from '~/screens/assinaturas/tier-visual';

const copy = assinaturasCopy.contratar;

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/assinaturas');
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

export default function ContratarScreen({ slug }: { slug: string | undefined }) {
  const [plan, setPlan] = useState<PremiumPlan | null>(null);
  const [loading, setLoading] = useState(Boolean(slug));
  const [error, setError] = useState(false);
  const { modules } = usePremiumAddonModules();

  const refresh = useCallback(async () => {
    if (!slug) {
      setPlan(null);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      setPlan(await getPremiumPlan(slug));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<'form' | 'confirming' | 'pending'>('form');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // `submitting` state does not apply synchronously, so a rapid second tap
  // can read it as stale `false` in its own closure before the first tap's
  // re-render lands. Gate on a ref instead — checked and set in the same
  // tick, before any `await` — and keep `submitting` purely for the visual
  // label/disabled/loading props on the CTA.
  const submittingRef = useRef(false);

  if (loading) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerFill}>
          <ActivityIndicator color={c.gold} />
        </View>
      </View>
    );
  }

  if (error || !plan) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerFill}>
          <Text style={styles.stateTitle}>
            {error ? assinaturasCopy.states.errorTitle : assinaturasCopy.detail.notFound}
          </Text>
          {error ? (
            <Pressable
              onPress={() => void refresh()}
              accessibilityRole="button"
              accessibilityLabel={assinaturasCopy.states.errorRetry}
              style={styles.retryButton}
              testID="contratar-retry"
            >
              <Text style={styles.retryText}>{assinaturasCopy.states.errorRetry}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  if (phase === 'confirming') {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerFill}>
          <ActivityIndicator color={c.gold} />
          <Text style={styles.stateSubcopy}>{copy.confirming}</Text>
        </View>
      </View>
    );
  }

  if (phase === 'pending') {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerFill}>
          <Text style={styles.stateTitle}>{copy.pendingTitle}</Text>
          <Text style={styles.stateSubcopy}>{copy.pendingSubcopy}</Text>
          <Pressable
            onPress={() => router.replace('/assinaturas/minha-assinatura')}
            accessibilityRole="button"
            accessibilityLabel={copy.pendingCta}
            style={styles.retryButton}
            testID="contratar-pending-cta"
          >
            <Text style={styles.retryText}>{copy.pendingCta}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const visual = TIER_VISUAL[plan.tier];
  const t = tierStyle(plan.tier);
  const priceCents = monthlyPriceCents(plan);
  const totals = packageTotalCents(priceCents, modules, selected);

  const onSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const outcome = await startPremiumCheckout({
        planSlug: plan.slug,
        addonKeys: [...selected],
      });
      if (outcome.kind === 'error') {
        setErrorMsg(copy.errorGeneric);
        return;
      }
      if (outcome.kind === 'returned') {
        setPhase('confirming');
        const active = await pollSubscriptionActive();
        if (active) {
          showToast(copy.successToast);
          router.replace('/assinaturas/minha-assinatura');
        } else {
          setPhase('pending');
        }
      }
      // 'redirected' → the web page is already navigating away.
      // 'ios_unsupported' → unreachable, the CTA is not rendered on iOS.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.planCard, { borderColor: t.border, backgroundColor: c.surface }]}>
          <Text style={styles.planEyebrow}>{copy.planLabel}</Text>
          <View style={styles.tierRow}>
            <View
              style={[
                styles.tierDot,
                { backgroundColor: visual.accent, shadowColor: visual.accent },
              ]}
            />
            <Text style={[styles.tierLabel, { color: visual.accent }]}>{visual.label}</Text>
          </View>
          <Text style={styles.planName}>{plan.name}</Text>
          <Text style={styles.planPrice}>{priceCents === null ? '—' : formatBRL(priceCents)}</Text>
        </View>

        {modules.length > 0 ? (
          <View style={styles.modulesSection}>
            <Text style={styles.modulesTitle}>{copy.modulesTitle}</Text>
            <Text style={styles.modulesSubcopy}>{copy.modulesSubcopy}</Text>
            <View style={styles.modules}>
              {modules.map((module) => {
                const isSelected = selected.has(module.key);
                const quotaText =
                  module.quotaUnit === 'hours'
                    ? copy.quotaHours(module.quotaPerCycle)
                    : copy.quotaAccess(module.quotaPerCycle);
                const toggleLabel = isSelected ? copy.remove : copy.add;
                return (
                  <View key={module.key} style={styles.moduleRow}>
                    <View style={styles.moduleMiddle}>
                      <Text style={styles.moduleTitle}>{module.name}</Text>
                      <Text style={styles.moduleDescription}>{module.description}</Text>
                      <Text style={styles.moduleQuota}>{quotaText}</Text>
                    </View>
                    <View style={styles.moduleRight}>
                      <Text style={styles.modulePrice}>+{formatBRL(module.monthlyDeltaCents)}</Text>
                      <Pressable
                        onPress={() => toggle(module.key)}
                        accessibilityRole="button"
                        accessibilityLabel={toggleLabel}
                        accessibilityState={{ selected: isSelected }}
                        style={[styles.moduleToggle, isSelected && styles.moduleToggleActive]}
                        testID={`contratar-modulo-${module.key}`}
                      >
                        <Text style={styles.moduleToggleText}>{toggleLabel}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Fixed footer — summary + CTA (or the iOS web-contract notice). */}
      <View style={styles.ctaBar}>
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{copy.summaryBase}</Text>
            <Text style={styles.summaryValue}>{formatBRL(totals.baseCents)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{copy.summaryModules}</Text>
            <Text style={styles.summaryValue}>{formatBRL(totals.addonsCents)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryTotalLabel}>{copy.summaryTotal}</Text>
            <Text style={styles.summaryTotalValue}>{formatBRL(totals.totalCents)}</Text>
          </View>
        </View>

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        {Platform.OS === 'ios' ? (
          <View style={styles.iosNotice}>
            <Text style={styles.iosTitle}>{copy.iosTitle}</Text>
            <Text style={styles.iosSubcopy}>{copy.iosSubcopy}</Text>
          </View>
        ) : (
          <TierCta
            tier={plan.tier}
            label={submitting ? copy.ctaLoading : copy.cta}
            onPress={() => void onSubmit()}
            disabled={submitting}
            loading={submitting}
            testID="contratar-cta"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 40 },

  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  stateTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
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
  retryButton: {
    borderRadius: 11,
    paddingVertical: 13,
    paddingHorizontal: 26,
    borderWidth: 1,
    borderColor: c.tileBorder,
  },
  retryText: {
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

  // Plan summary card
  planCard: {
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    marginTop: 8,
  },
  planEyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 },
  tierDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 4,
  },
  tierLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 2.8 },
  planName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 24,
    lineHeight: 26,
    color: c.cream,
    marginTop: 10,
  },
  planPrice: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 20,
    color: c.cream,
    marginTop: 8,
  },

  // Modules
  modulesSection: { marginTop: 28 },
  modulesTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },
  modulesSubcopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    lineHeight: 19,
    color: c.muted55,
    marginTop: 9,
  },
  modules: { marginTop: 16, gap: 12 },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: 16,
    padding: 16,
  },
  moduleMiddle: { flex: 1, minWidth: 0 },
  moduleTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.cream },
  moduleDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: c.muted50,
    marginTop: 2,
  },
  moduleQuota: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11.5,
    color: c.muted42,
    marginTop: 4,
  },
  moduleRight: { alignItems: 'flex-end', gap: 8 },
  modulePrice: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: c.goldLight },
  moduleToggle: {
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: c.tileBorder,
  },
  moduleToggleActive: {
    borderColor: c.goldDeep,
    backgroundColor: c.elevated,
  },
  moduleToggleText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.4,
    color: c.goldLight,
  },

  // Fixed footer
  ctaBar: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: c.hairline,
    backgroundColor: c.bg,
    gap: 12,
  },
  summary: { gap: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.muted55 },
  summaryValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: c.cream },
  summaryDivider: { height: 1, backgroundColor: c.hairline, marginVertical: 2 },
  summaryTotalLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: c.cream },
  summaryTotalValue: { fontFamily: 'Inter_600SemiBold', fontSize: 18, color: c.goldLight },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    color: c.danger,
    textAlign: 'center',
  },

  // iOS notice (no Stripe on iOS)
  iosNotice: {
    borderRadius: 11,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: c.tileBorder,
    alignItems: 'center',
    gap: 4,
  },
  iosTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: c.cream, textAlign: 'center' },
  iosSubcopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: c.muted55,
    textAlign: 'center',
  },
});
