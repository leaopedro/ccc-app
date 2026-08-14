// Assinaturas — "Planos disponíveis" screen (non-subscriber).
//
// Recreated from the design handoff (design_handoff_assinaturas). Data
// now comes from the premium catalog API (usePremiumPlans / usePremiumAddonModules)
// — the visual treatment is unchanged. Tapping a plan (card or CTA) opens the
// plan detail screen, where the "Assinar" (contratação) stub lives.
//
// Typography note: the handoff specifies Cormorant Garamond + Jost. Those fonts
// are not bundled in the app; per product decision this screen renders with the
// already-loaded Inter family (weights mapped 1:1). Layout, spacing, and color
// follow the handoff exactly.

import type { PremiumAddonModule, PremiumPlan } from '@ccc/shared/premium-catalog';
import { ArrowLeft, Check, SprayCan, Wrench } from 'lucide-react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { assinaturasCopy } from '~/copy/assinaturas';
import { usePremiumAddonModules } from '~/hooks/usePremiumAddonModules';
import { usePremiumPlans } from '~/hooks/usePremiumPlans';
import { usePremiumSubscription } from '~/hooks/usePremiumSubscription';
import { formatBRL } from '~/lib/format';
import {
  c,
  monthlyPriceCents,
  orderedBenefits,
  TIER_VISUAL,
  tierStyle,
} from '~/screens/assinaturas/tier-visual';

// Add-on module icon by key. Falls back to the detailing glyph for unknown keys.
const MODULE_ICON: Record<string, typeof SprayCan> = {
  detailing: SprayCan,
  oficina: Wrench,
};

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/events');
}

function openPlan(slug: string) {
  router.push(`/assinaturas/${slug}` as never);
}

function OuroBackground() {
  // radial-gradient(130% 110% at 82% 0%, #241f13 0%, #100e09 58%, #14110a 100%)
  return (
    <Svg style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="ouroBg" cx="82%" cy="0%" rx="130%" ry="110%" fx="82%" fy="0%">
          <Stop offset="0" stopColor="#241f13" />
          <Stop offset="0.58" stopColor="#100e09" />
          <Stop offset="1" stopColor="#14110a" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#ouroBg)" />
    </Svg>
  );
}

function PlanCard({ plan }: { plan: PremiumPlan }) {
  const t = tierStyle(plan.tier);
  const visual = TIER_VISUAL[plan.tier];
  const isOuro = plan.tier === 'gold';
  const priceCents = monthlyPriceCents(plan);
  const benefits = orderedBenefits(plan);
  const ctaLabel = `${assinaturasCopy.plans.ctaPrefix} ${visual.label}`;

  return (
    <Pressable
      onPress={() => openPlan(plan.slug)}
      accessibilityRole="button"
      accessibilityLabel={plan.name}
      style={[styles.cardOuter, isOuro && styles.cardOuterOuro]}
      testID={`plan-${plan.slug}`}
    >
      {visual.recommended ? (
        <View style={styles.recommendedWrap} pointerEvents="none">
          <View style={styles.recommendedPill}>
            <Text style={styles.recommendedText}>RECOMENDADO</Text>
          </View>
        </View>
      ) : null}

      <View style={[styles.card, { borderColor: t.border, backgroundColor: c.surface }]}>
        {isOuro ? <OuroBackground /> : null}
        {isOuro ? <View style={styles.ouroTopHighlight} pointerEvents="none" /> : null}

        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderLeft}>
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
          </View>
          <View style={styles.cardHeaderRight}>
            <Text style={styles.planPrice}>
              {priceCents === null ? '—' : formatBRL(priceCents)}
            </Text>
            <Text style={styles.perMonth}>{assinaturasCopy.plans.perMonth}</Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: t.divider }]} />

        <View style={styles.benefits}>
          {benefits.map((benefit) => (
            <View key={benefit} style={styles.benefitRow}>
              <Check color={visual.accent} size={18} strokeWidth={2} style={styles.benefitIcon} />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        {t.btnBg === 'gradient' ? (
          <Pressable
            onPress={() => openPlan(plan.slug)}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            style={styles.ctaGradient}
            testID={`assinar-${plan.tier}`}
          >
            <LinearGradient
              colors={[c.goldLight, c.goldDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={[styles.ctaText, { color: t.btnColor }]}>{ctaLabel}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => openPlan(plan.slug)}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            style={[styles.cta, { borderColor: t.btnBorder }]}
            testID={`assinar-${plan.tier}`}
          >
            <Text style={[styles.ctaText, { color: t.btnColor }]}>{ctaLabel}</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

function ModuleRow({ module }: { module: PremiumAddonModule }) {
  const Icon = MODULE_ICON[module.key] ?? SprayCan;
  return (
    <View style={styles.moduleRow}>
      <View style={styles.moduleIconTile}>
        <Icon color={c.gold} size={23} strokeWidth={1.75} />
      </View>
      <View style={styles.moduleMiddle}>
        <Text style={styles.moduleTitle}>{module.name}</Text>
        <Text style={styles.moduleSubtitle}>{module.description}</Text>
      </View>
      <View style={styles.moduleRight}>
        <Text style={styles.modulePrice}>+{formatBRL(module.monthlyDeltaCents)}</Text>
        <Text style={styles.modulePerMonth}>{assinaturasCopy.modules.perMonth}</Text>
      </View>
    </View>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={assinaturasCopy.header.back}
        hitSlop={8}
        style={styles.backButton}
      >
        <ArrowLeft color={c.cream} size={26} strokeWidth={1.75} />
      </Pressable>
      <Text style={styles.headerTitle}>{assinaturasCopy.header.title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

export default function PlanosScreen({ showAll = false }: { showAll?: boolean }) {
  const { plans, loading, error, refresh } = usePremiumPlans();
  const { modules } = usePremiumAddonModules();
  const { subscription, loading: subLoading } = usePremiumSubscription();

  // A member with a live subscription lands on "Minha assinatura", not on the
  // sales page. `?all=1` opts out so the upgrade path stays reachable from
  // inside Minha Assinatura.
  useEffect(() => {
    if (showAll || subLoading) return;
    if (subscription?.active) router.replace('/assinaturas/minha-assinatura');
  }, [showAll, subLoading, subscription?.active]);

  if (loading || subLoading) {
    return (
      <View style={styles.screen}>
        <View style={styles.centerFill}>
          <ActivityIndicator color={c.gold} />
          <Text style={styles.stateText}>{assinaturasCopy.states.loading}</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.screen}>
        <View style={styles.centerFill}>
          <Text style={styles.stateTitle}>{assinaturasCopy.states.errorTitle}</Text>
          <Pressable
            onPress={() => void refresh()}
            accessibilityRole="button"
            accessibilityLabel={assinaturasCopy.states.errorRetry}
            style={styles.retryButton}
            testID="planos-retry"
          >
            <Text style={styles.retryText}>{assinaturasCopy.states.errorRetry}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Header />

      {/* Intro block */}
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>{assinaturasCopy.intro.eyebrow}</Text>
        <Text style={styles.heading}>
          {assinaturasCopy.intro.heading[0]}
          {'\n'}
          {assinaturasCopy.intro.heading[1]}
        </Text>
        <Text style={styles.subcopy}>{assinaturasCopy.intro.subcopy}</Text>
      </View>

      {plans.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.stateTitle}>{assinaturasCopy.states.empty}</Text>
        </View>
      ) : (
        <View style={styles.plans}>
          {plans.map((plan) => (
            <PlanCard key={plan.slug} plan={plan} />
          ))}
        </View>
      )}

      {/* Add-on modules */}
      {modules.length > 0 ? (
        <View style={styles.modulesSection}>
          <Text style={styles.modulesEyebrow}>{assinaturasCopy.modules.eyebrow}</Text>
          <Text style={styles.modulesSubcopy}>{assinaturasCopy.modules.subcopy}</Text>
          <View style={styles.modules}>
            {modules.map((module) => (
              <ModuleRow key={module.key} module={module} />
            ))}
          </View>
          <Text style={styles.footnote}>{assinaturasCopy.modules.footnote}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 120 },

  // State screens
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  stateText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: c.muted55,
    textAlign: 'center',
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
  emptyBlock: { marginTop: 40, alignItems: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 14,
  },
  backButton: { padding: 6 },
  headerTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.88,
    color: c.cream,
  },
  headerSpacer: { width: 38 },

  // Intro
  intro: { alignItems: 'center', paddingTop: 4, paddingBottom: 6 },
  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 3,
    color: c.goldDeep,
  },
  heading: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 30,
    lineHeight: 33,
    color: c.cream,
    marginTop: 8,
    textAlign: 'center',
  },
  subcopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: c.muted55,
    maxWidth: 280,
    textAlign: 'center',
    marginTop: 12,
  },

  // Plans
  plans: { marginTop: 24, gap: 16 },
  cardOuter: { borderRadius: 20, position: 'relative' },
  cardOuterOuro: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 12,
  },
  card: {
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    overflow: 'hidden',
  },
  ouroTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(232,206,134,0.12)',
  },
  recommendedWrap: {
    position: 'absolute',
    top: -11,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  recommendedPill: {
    backgroundColor: c.goldLight,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  recommendedText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1.98,
    color: '#0A0A0A',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardHeaderLeft: { flexShrink: 1 },
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
    fontSize: 26,
    lineHeight: 26,
    color: c.cream,
    marginTop: 8,
  },
  cardHeaderRight: { alignItems: 'flex-end' },
  planPrice: { fontFamily: 'Inter_600SemiBold', fontSize: 32, lineHeight: 32, color: c.cream },
  perMonth: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.6,
    color: c.muted50,
    marginTop: 5,
  },
  divider: { height: 1, marginVertical: 18 },
  benefits: { gap: 11 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  benefitIcon: { marginTop: 1 },
  benefitText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13.5,
    lineHeight: 18,
    color: c.cream,
  },
  cta: {
    marginTop: 20,
    borderRadius: 11,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  ctaGradient: {
    marginTop: 20,
    borderRadius: 11,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ctaText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 2.4 },

  // Modules
  modulesSection: { marginTop: 34 },
  modulesEyebrow: {
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
  moduleIconTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.elevated,
    borderWidth: 1,
    borderColor: c.tileBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleMiddle: { flex: 1, minWidth: 0 },
  moduleTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.cream },
  moduleSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: c.muted50,
    marginTop: 2,
  },
  moduleRight: { alignItems: 'flex-end' },
  modulePrice: { fontFamily: 'Inter_600SemiBold', fontSize: 17, color: c.goldLight },
  modulePerMonth: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.26,
    color: c.muted42,
    marginTop: 2,
  },
  footnote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11.5,
    lineHeight: 17,
    color: c.muted40,
    textAlign: 'center',
    marginTop: 16,
  },
});
