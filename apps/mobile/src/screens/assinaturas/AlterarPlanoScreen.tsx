// Assinaturas — plan-change confirmation screen.
//
// The whole point of this screen (user's own words, carried into the spec):
// "antes de fazer a mudança tem que ter uma tela do que vai mudar, deixando
// claro como vai ficar." No sheet on top of it — this IS the confirmation.
//
// Load-bearing invariant: NO mutation call leaves before the CTA is tapped.
// Mounting the screen only reads (usePremiumSubscription, getPremiumPlan,
// usePremiumPlans); only `onSubmit` writes (changePremiumPlan).
//
// Refusals, evaluated in this order before the CTA can render:
//   1. slug === subscription.planSlug   → nothing to confirm, bounce back.
//   2. provider !== 'stripe'            → App Store block.
//   3. status outside active/cancel_scheduled → blocked block, with the
//      billing-portal link (this is where the member fixes a failed card).
//   4. subscriptionsEnabled === false   → unavailable block.
//   5. target plan has no price at the CURRENT cadence → the route would
//      404 PlanNotFound; blocked before that round trip.

import type { PremiumPlanDetailResponse } from '@ccc/shared/premium-catalog';
import { ArrowLeft, Check, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { changePremiumPlan, getPremiumStatus } from '~/api/premium';
import { getPremiumPlan } from '~/api/premium-catalog';
import { assinaturasCopy } from '~/copy/assinaturas';
import { usePremiumPlans } from '~/hooks/usePremiumPlans';
import { usePremiumSubscription } from '~/hooks/usePremiumSubscription';
import { formatBRL } from '~/lib/format';
import { showToast } from '~/lib/toast';
import {
  resolvePlanChangeError,
  type PlanChangeError,
} from '~/screens/assinaturas/plan-change-error';
import { pollSubscriptionTier } from '~/screens/assinaturas/poll-subscription';
import { TierCta } from '~/screens/assinaturas/TierCta';
import {
  c,
  orderedBenefits,
  priceForCadence,
  TIER_VISUAL,
  type ApiTier,
} from '~/screens/assinaturas/tier-visual';

const copy = assinaturasCopy.alterar;

// Same constant MinhaAssinaturaScreen uses for the Apple/RevenueCat manage
// link — there is no Stripe subscription here to point at instead.
const APPLE_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/assinaturas/minha-assinatura');
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

function BlockedState({
  title,
  body,
  cta,
  onPress,
  testID,
}: {
  title: string;
  body?: string;
  cta?: string;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.screen}>
      <Header />
      <View style={styles.centerFill}>
        <Text style={styles.stateTitle}>{title}</Text>
        {body ? <Text style={styles.stateSubcopy}>{body}</Text> : null}
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
    </View>
  );
}

export default function AlterarPlanoScreen({ slug }: { slug: string | undefined }) {
  const {
    subscription,
    loading: subLoading,
    error: subError,
    billingUnavailable,
  } = usePremiumSubscription();
  const { subscriptionsEnabled, loading: plansLoading } = usePremiumPlans();

  const [plan, setPlan] = useState<PremiumPlanDetailResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(Boolean(slug));
  const [planError, setPlanError] = useState(false);

  const refreshPlan = useCallback(async () => {
    if (!slug) {
      setPlan(null);
      setPlanLoading(false);
      setPlanError(false);
      return;
    }
    setPlanLoading(true);
    setPlanError(false);
    try {
      setPlan(await getPremiumPlan(slug));
    } catch {
      setPlanError(true);
    } finally {
      setPlanLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  // Refusal 1: nothing to confirm when the target IS the current plan. A
  // side-effect (not an inline call during render), so it fires once the
  // subscription is known rather than on every render.
  const sameSlug = Boolean(subscription?.active && slug && subscription.planSlug === slug);
  useEffect(() => {
    if (sameSlug) router.replace('/assinaturas/minha-assinatura');
  }, [sameSlug]);

  // Refusal 3 needs a Stripe billing-portal URL for its CTA. GET
  // /api/me/premium/status already carries `manageUrl` precomputed
  // (same field PremiumScreen's "onManage" opens) — fetched only when the
  // blocked block is actually showing, and only as a read.
  const blockedStatus = Boolean(
    subscription?.active &&
    subscription.provider === 'stripe' &&
    subscription.status &&
    !['active', 'cancel_scheduled'].includes(subscription.status),
  );
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blockedStatus) return;
    let cancelled = false;
    getPremiumStatus()
      .then((status) => {
        if (!cancelled) setManageUrl(status.manageUrl);
      })
      .catch(() => {
        // Best-effort — the block still shows the copy without a working
        // link rather than crashing the screen.
      });
    return () => {
      cancelled = true;
    };
  }, [blockedStatus]);

  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<'form' | 'confirming' | 'pending'>('form');
  const [changeError, setChangeError] = useState<PlanChangeError | null>(null);
  // Checked and set in the same tick, before the first `await` — the same
  // shape as ContratarScreen.onSubmit and MinhaAssinaturaScreen's cancel
  // guard. `submitting` state is for the label/disabled/busy props only.
  const submittingRef = useRef(false);

  if (subLoading) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerFill}>
          <ActivityIndicator color={c.gold} />
        </View>
      </View>
    );
  }

  if (billingUnavailable) {
    return (
      <BlockedState
        title={assinaturasCopy.minhaAssinatura.unavailableTitle}
        body={assinaturasCopy.minhaAssinatura.unavailableSubcopy}
        testID="alterar-billing-unavailable"
      />
    );
  }

  if (subError || !subscription || !subscription.active) {
    return (
      <BlockedState
        title={subError ? assinaturasCopy.states.errorTitle : copy.errorNoMembership}
        testID="alterar-no-membership"
      />
    );
  }

  // Refusal 1 fires from the effect above; render nothing while it lands.
  if (sameSlug) return null;

  // Refusal 2: Apple/RevenueCat membership — no Stripe subscription here to
  // change, so no CTA that would 409.
  if (subscription.provider !== 'stripe') {
    return (
      <BlockedState
        title={copy.appleTitle}
        body={copy.appleBody}
        cta={copy.appleCta}
        onPress={() => void Linking.openURL(APPLE_MANAGE_URL)}
        testID="alterar-apple-cta"
      />
    );
  }

  // Refusal 3: status outside active/cancel_scheduled (past_due, paused,
  // trialing). The CTA points at the billing portal — the actual fix. A
  // silent dead button here would be the worst possible spot for one: it is
  // the only way out for a past_due member. Same pattern as
  // PremiumScreen.tsx's `showManageLink` — hide the CTA rather than render
  // one that does nothing when the portal URL failed to load.
  if (blockedStatus) {
    return (
      <BlockedState
        title={copy.blockedPastDueTitle}
        body={copy.blockedPastDueBody}
        testID="alterar-billing-portal-cta"
        {...(manageUrl
          ? { cta: copy.blockedPastDueCta, onPress: () => void Linking.openURL(manageUrl) }
          : {})}
      />
    );
  }

  if (plansLoading || planLoading) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerFill}>
          <ActivityIndicator color={c.gold} />
        </View>
      </View>
    );
  }

  if (planError || !plan) {
    return (
      <BlockedState
        title={planError ? assinaturasCopy.states.errorTitle : assinaturasCopy.detail.notFound}
        testID="alterar-retry"
        // Spread (not `cta={... : undefined}`) so the optional props are
        // omitted, not set-to-undefined — required under
        // exactOptionalPropertyTypes (same pattern as MinhaAssinaturaScreen).
        {...(planError
          ? { cta: assinaturasCopy.states.errorRetry, onPress: () => void refreshPlan() }
          : {})}
      />
    );
  }

  // Refusal 4: platform gate off.
  if (!subscriptionsEnabled) {
    return (
      <BlockedState
        title={assinaturasCopy.minhaAssinatura.unavailableTitle}
        body={assinaturasCopy.minhaAssinatura.unavailableSubcopy}
        testID="alterar-unavailable"
      />
    );
  }

  const cadence = subscription.cadence ?? 'monthly';
  const valorHoje = subscription.baseAmountCents;
  const valorNovo = priceForCadence(plan, cadence);

  // Refusal 5: target plan has no price at the cadence the member is
  // actually on — the route would 404 PlanNotFound. Reusing that same
  // "plan not available" copy rather than inventing a new alterar key (the
  // task's copy keys are already final).
  if (valorNovo === null) {
    return <BlockedState title={copy.errorPlanNotFound} testID="alterar-plano-indisponivel" />;
  }

  const diferenca = valorNovo - valorHoje;
  const signedDiferenca = `${diferenca >= 0 ? '+' : ''}${formatBRL(diferenca)}`;

  // `addons` includes cancel_scheduled entries, but `addonsAmountCents` sums
  // only active ones (me-premium-addons.ts:37 vs addons.ts:34-38). Without
  // this filter the screen would list a module as "continuing", with a
  // price, that does not enter the total below.
  const modulos = subscription.addons.filter((a) => a.status === 'active');
  const modulosCents = subscription.addonsAmountCents;
  const novoTotal = valorNovo + modulosCents;

  const atuais = subscription.benefits;
  const alvos = orderedBenefits(plan);
  const ganha = alvos.filter((b) => !atuais.includes(b));
  const perde = atuais.filter((b) => !alvos.includes(b));

  const currentVisual = subscription.tier ? TIER_VISUAL[subscription.tier as ApiTier] : null;
  const targetVisual = TIER_VISUAL[plan.tier];

  const onSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setChangeError(null);
    try {
      await changePremiumPlan({ planSlug: plan.slug, cadence });
      setPhase('confirming');
      const trocou = await pollSubscriptionTier(plan.tier, cadence);
      if (trocou) {
        showToast(copy.successToast);
        router.replace('/assinaturas/minha-assinatura');
      } else {
        setPhase('pending');
      }
    } catch (err) {
      setChangeError(resolvePlanChangeError(err));
      setPhase('form');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

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
      <BlockedState
        title={copy.pendingTitle}
        body={copy.pendingSubcopy}
        cta={copy.pendingCta}
        onPress={() => router.replace('/assinaturas/minha-assinatura')}
        testID="alterar-pending-cta"
      />
    );
  }

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.compareRow}>
          <View style={styles.compareCard}>
            <Text style={styles.compareLabel}>{copy.fromLabel}</Text>
            {currentVisual ? (
              <Text style={[styles.compareTier, { color: currentVisual.accent }]}>
                {currentVisual.label}
              </Text>
            ) : null}
            <Text style={styles.comparePlanName}>{subscription.planName ?? '—'}</Text>
            <Text style={styles.compareValueLabel}>{copy.currentValue(cadence)}</Text>
            <Text style={styles.compareValue}>{formatBRL(valorHoje)}</Text>
          </View>
          <View style={styles.compareCard}>
            <Text style={styles.compareLabel}>{copy.toLabel}</Text>
            <Text style={[styles.compareTier, { color: targetVisual.accent }]}>
              {targetVisual.label}
            </Text>
            <Text style={styles.comparePlanName}>{plan.name}</Text>
            <Text style={styles.compareValueLabel}>{copy.newValue(cadence)}</Text>
            <Text style={styles.compareValue}>{formatBRL(valorNovo)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{copy.valueTitle}</Text>
          <View style={styles.valueRow}>
            <Text style={styles.valueLabel}>{copy.currentValue(cadence)}</Text>
            <Text style={styles.valueAmount}>{formatBRL(valorHoje)}</Text>
          </View>
          <View style={styles.valueRow}>
            <Text style={styles.valueLabel}>{copy.newValue(cadence)}</Text>
            <Text style={styles.valueAmount}>{formatBRL(valorNovo)}</Text>
          </View>
          <View style={styles.valueRow}>
            <Text style={styles.valueLabel}>{copy.differenceLabel}</Text>
            <Text style={styles.valueAmount}>{signedDiferenca}</Text>
          </View>
          {modulosCents > 0 ? (
            <View style={styles.valueRow}>
              <Text style={styles.valueLabel}>{assinaturasCopy.contratar.summaryModules}</Text>
              <Text style={styles.valueAmount}>{formatBRL(modulosCents)}</Text>
            </View>
          ) : null}
          <View style={styles.valueDivider} />
          <View style={styles.valueRow}>
            <Text style={styles.valueTotalLabel}>{copy.newTotalLabel}</Text>
            <Text style={styles.valueTotalAmount}>{formatBRL(novoTotal)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{copy.gainTitle}</Text>
          <View style={styles.benefits}>
            {ganha.map((benefit) => (
              <View key={benefit} style={styles.benefitRow}>
                <Check color={c.goldLight} size={18} strokeWidth={2} style={styles.benefitIcon} />
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>
        </View>

        {perde.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{copy.loseTitle}</Text>
            <View style={styles.benefits}>
              {perde.map((benefit) => (
                <View key={benefit} style={styles.benefitRow}>
                  <X color={c.danger} size={18} strokeWidth={2} style={styles.benefitIcon} />
                  <Text style={styles.benefitText}>{benefit}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {modulos.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{copy.keptTitle}</Text>
            <View style={styles.modules}>
              {modulos.map((addon) => (
                <View key={addon.key} style={styles.moduleRow}>
                  <Text style={styles.moduleName}>{addon.name}</Text>
                  <Text style={styles.modulePrice}>{formatBRL(addon.monthlyDeltaCents)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{copy.whenTitle}</Text>
          <Text style={styles.whenBody}>{copy.whenBody}</Text>
        </View>

        {subscription.cancelAtPeriodEnd ? (
          <Text style={styles.cancelNote}>{copy.cancelScheduledNote}</Text>
        ) : null}

        {changeError ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>{changeError.message}</Text>
            {changeError.manageUrl ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  const url = changeError.manageUrl;
                  if (url) void Linking.openURL(url);
                }}
              >
                <Text style={styles.errorLink}>{copy.appleCta}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.ctaBar}>
        <TierCta
          tier={plan.tier}
          label={submitting ? copy.ctaLoading : copy.cta}
          onPress={() => void onSubmit()}
          disabled={submitting}
          loading={submitting}
          testID="alterar-cta"
        />
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={copy.voltar}
          style={styles.secondaryButton}
          testID="alterar-voltar"
        >
          <Text style={styles.secondaryButtonText}>{copy.voltar}</Text>
        </Pressable>
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

  // DE/PARA compare cards
  compareRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  compareCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.surface,
  },
  compareLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.4,
    color: c.goldDeep,
  },
  compareTier: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2,
    marginTop: 10,
  },
  comparePlanName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: c.cream,
    marginTop: 4,
  },
  compareValueLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: c.muted55,
    marginTop: 12,
  },
  compareValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: c.cream,
    marginTop: 2,
  },

  // Shared section
  section: { marginTop: 28 },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },

  // Value change
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  valueLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, color: c.muted55 },
  valueAmount: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: c.cream },
  valueDivider: { height: 1, backgroundColor: c.hairline, marginTop: 12 },
  valueTotalLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13.5,
    color: c.cream,
    marginTop: 0,
  },
  valueTotalAmount: { fontFamily: 'Inter_600SemiBold', fontSize: 18, color: c.goldLight },

  // Benefits (gain/lose)
  benefits: { marginTop: 14, gap: 12 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  benefitIcon: { marginTop: 1 },
  benefitText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 19,
    color: c.cream,
  },

  // Kept modules
  modules: { marginTop: 14, gap: 10 },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  moduleName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: c.cream },
  modulePrice: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: c.goldLight },

  // When it takes effect
  whenBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: c.muted55,
    marginTop: 10,
  },
  cancelNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    lineHeight: 19,
    color: c.muted50,
    marginTop: 20,
  },

  // Inline error (mid-submit failure)
  errorBlock: { marginTop: 20 },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    color: c.danger,
    textAlign: 'center',
  },
  errorLink: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12.5,
    color: c.danger,
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: 6,
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
  secondaryButton: { alignItems: 'center', paddingVertical: 6 },
  secondaryButtonText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: c.muted55,
  },
});
