// Assinaturas — plan detail screen.
//
// Fetches GET /api/plans/:slug and renders full benefits + monthly price + the
// "Assinar" CTA. The CTA navigates to the contratação screen, which owns the
// real checkout seam (checkout.ts). Data source is the API; presentation
// reuses the shared handoff palette + tier treatment (tier-visual.ts).

import type { PremiumPlan } from '@ccc/shared/premium-catalog';
import { ArrowLeft, Check } from 'lucide-react-native';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { getPremiumPlan } from '~/api/premium-catalog';
import { assinaturasCopy } from '~/copy/assinaturas';
import { formatBRL } from '~/lib/format';
import { TierCta } from '~/screens/assinaturas/TierCta';
import {
  c,
  monthlyPriceCents,
  orderedBenefits,
  TIER_VISUAL,
  tierStyle,
} from '~/screens/assinaturas/tier-visual';

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/assinaturas');
}

function OuroBackground() {
  return (
    <Svg style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="ouroBgDetail" cx="82%" cy="0%" rx="130%" ry="110%" fx="82%" fy="0%">
          <Stop offset="0" stopColor="#241f13" />
          <Stop offset="0.58" stopColor="#100e09" />
          <Stop offset="1" stopColor="#14110a" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#ouroBgDetail)" />
    </Svg>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={assinaturasCopy.detail.back}
        hitSlop={8}
        style={styles.backButton}
      >
        <ArrowLeft color={c.cream} size={26} strokeWidth={1.75} />
      </Pressable>
      <Text style={styles.headerTitle}>{assinaturasCopy.detail.header}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

export default function PlanoDetalheScreen({ slug }: { slug: string | undefined }) {
  const [plan, setPlan] = useState<PremiumPlan | null>(null);
  // Platform gate from the same response — false (safe default) until the
  // fetch resolves, so the CTA never flashes before disappearing.
  const [subscriptionsEnabled, setSubscriptionsEnabled] = useState(false);
  const [loading, setLoading] = useState(Boolean(slug));
  const [error, setError] = useState(false);

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
      // Response is the plan fields FLATTENED with subscriptionsEnabled, not
      // nested under `plan` (final review, Important 2) — old installed
      // binaries parse the bare plan shape, so a nested envelope would have
      // broken every one of them the moment the API deploys.
      const response = await getPremiumPlan(slug);
      setPlan(response);
      setSubscriptionsEnabled(response.subscriptionsEnabled);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
              testID="detalhe-retry"
            >
              <Text style={styles.retryText}>{assinaturasCopy.states.errorRetry}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const visual = TIER_VISUAL[plan.tier];
  const t = tierStyle(plan.tier);
  const isOuro = plan.tier === 'gold';
  const priceCents = monthlyPriceCents(plan);
  const benefits = orderedBenefits(plan);

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { borderColor: t.border, backgroundColor: c.surface }]}>
          {isOuro ? <OuroBackground /> : null}
          {isOuro ? <View style={styles.ouroTopHighlight} pointerEvents="none" /> : null}

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

          <View style={styles.priceRow}>
            <Text style={styles.planPrice}>
              {priceCents === null ? '—' : formatBRL(priceCents)}
            </Text>
            <Text style={styles.perMonth}>{assinaturasCopy.detail.perMonth}</Text>
          </View>

          {plan.description ? <Text style={styles.description}>{plan.description}</Text> : null}
        </View>

        <Text style={styles.benefitsTitle}>{assinaturasCopy.detail.benefitsTitle}</Text>
        <View style={styles.benefits}>
          {benefits.map((benefit) => (
            <View key={benefit} style={styles.benefitRow}>
              <Check color={visual.accent} size={18} strokeWidth={2} style={styles.benefitIcon} />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        <View style={styles.caixaCard}>
          <Text style={styles.caixaTitle}>{assinaturasCopy.caixa.title}</Text>
          <Text style={styles.caixaBody}>{assinaturasCopy.caixa.body}</Text>
          <Text style={styles.caixaDelivery}>{assinaturasCopy.caixa.delivery}</Text>
        </View>
      </ScrollView>

      {/* Sticky CTA — navigates to the contratação screen (owns the checkout seam).
          Hidden when the platform gate is off; that screen would have no CTA
          of its own to land on. */}
      {subscriptionsEnabled ? (
        <View style={styles.ctaBar}>
          <TierCta
            tier={plan.tier}
            label={assinaturasCopy.detail.cta}
            onPress={() => router.push(`/assinaturas/contratar?slug=${plan.slug}` as never)}
            testID="detalhe-assinar"
          />
        </View>
      ) : null}
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
    fontSize: 15,
    color: c.cream,
    textAlign: 'center',
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

  // Card
  card: {
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 8,
  },
  ouroTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(232,206,134,0.12)',
  },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
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
    fontSize: 30,
    lineHeight: 32,
    color: c.cream,
    marginTop: 10,
  },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 14 },
  planPrice: { fontFamily: 'Inter_600SemiBold', fontSize: 34, lineHeight: 34, color: c.cream },
  perMonth: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.6,
    color: c.muted50,
    marginBottom: 4,
  },
  description: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13.5,
    lineHeight: 20,
    color: c.muted55,
    marginTop: 16,
  },

  // Benefits
  benefitsTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
    marginTop: 28,
  },
  benefits: { marginTop: 16, gap: 13 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  benefitIcon: { marginTop: 1 },
  benefitText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 19,
    color: c.cream,
  },

  // Caixa física
  caixaCard: {
    marginTop: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.tileBorder,
    backgroundColor: c.surface,
    padding: 18,
    gap: 8,
  },
  caixaTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },
  caixaBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20, color: c.cream },
  caixaDelivery: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: c.muted55 },

  // Sticky CTA
  ctaBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: c.hairline,
    backgroundColor: c.bg,
  },
});
