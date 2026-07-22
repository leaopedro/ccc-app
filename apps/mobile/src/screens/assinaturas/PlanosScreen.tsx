// Assinaturas — "Planos disponíveis" screen (non-subscriber).
//
// Recreated from the Claude Design handoff (design_handoff_assinaturas).
// First delivery: presentation only. Plan/module data is hardcoded in
// ~/screens/assinaturas/plans-data (API-ready shape). "ASSINAR {tier}" is a
// placeholder — it will route into the future checkout carrying selectedTier.
//
// Typography note: the handoff specifies Cormorant Garamond + Jost. Those fonts
// are not bundled in the app; per product decision this screen renders with the
// already-loaded Inter family (weights mapped 1:1). Layout, spacing, and color
// follow the handoff exactly.

import { ArrowLeft, Check, SprayCan, Wrench } from 'lucide-react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { assinaturasCopy } from '~/copy/assinaturas';
import { showToast } from '~/lib/toast';
import {
  ADDON_MODULES,
  PLANS,
  type AddonModule,
  type Plan,
  type PlanTier,
} from '~/screens/assinaturas/plans-data';

// Handoff palette (authoritative hex values).
const c = {
  bg: '#0A0A0A',
  surface: '#0F0E0B',
  elevated: '#14110a',
  cream: '#F2E8D8',
  goldDeep: '#C9A227',
  goldLight: '#E8CE86',
  gold: '#D4AF37',
  muted55: 'rgba(242,232,216,0.55)',
  muted50: 'rgba(242,232,216,0.5)',
  muted42: 'rgba(242,232,216,0.42)',
  muted40: 'rgba(242,232,216,0.4)',
  hairline: 'rgba(212,175,55,0.14)',
  tileBorder: 'rgba(212,175,55,0.22)',
};

// Per-tier visual treatment derived from the tier (kept out of the data model
// so the future API only supplies content, not styling).
function tierStyle(plan: Plan): {
  border: string;
  divider: string;
  btnBg: string;
  btnColor: string;
  btnBorder: string;
} {
  switch (plan.tier) {
    case 'bronze':
      return {
        border: 'rgba(192,138,78,0.34)',
        divider: 'rgba(192,138,78,0.2)',
        btnBg: 'transparent',
        btnColor: c.goldLight,
        btnBorder: 'rgba(192,138,78,0.55)',
      };
    case 'prata':
      return {
        border: 'rgba(199,204,209,0.34)',
        divider: 'rgba(199,204,209,0.2)',
        btnBg: 'transparent',
        btnColor: c.cream,
        btnBorder: 'rgba(199,204,209,0.6)',
      };
    case 'ouro':
    default:
      return {
        border: 'rgba(212,175,55,0.5)',
        divider: 'rgba(212,175,55,0.28)',
        btnBg: 'gradient',
        btnColor: '#0A0A0A',
        btnBorder: 'transparent',
      };
  }
}

const MODULE_ICON: Record<AddonModule['icon'], typeof SprayCan> = {
  detailing: SprayCan,
  oficina: Wrench,
};

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/events');
}

function onSubscribe(tier: PlanTier) {
  // Placeholder — checkout flow not built yet (future delivery). The selected
  // tier is what checkout will receive.
  showToast('Contratação em breve.');
  void tier;
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

function PlanCard({ plan }: { plan: Plan }) {
  const t = tierStyle(plan);
  const isOuro = plan.tier === 'ouro';
  const ctaLabel = `${assinaturasCopy.plans.ctaPrefix} ${plan.tierLabel}`;

  return (
    <View style={[styles.cardOuter, isOuro && styles.cardOuterOuro]}>
      {plan.recommended ? (
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
                style={[styles.tierDot, { backgroundColor: plan.accent, shadowColor: plan.accent }]}
              />
              <Text style={[styles.tierLabel, { color: plan.accent }]}>{plan.tierLabel}</Text>
            </View>
            <Text style={styles.planName}>{plan.name}</Text>
          </View>
          <View style={styles.cardHeaderRight}>
            <Text style={styles.planPrice}>{plan.priceLabel}</Text>
            <Text style={styles.perMonth}>{assinaturasCopy.plans.perMonth}</Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: t.divider }]} />

        <View style={styles.benefits}>
          {plan.benefits.map((benefit) => (
            <View key={benefit} style={styles.benefitRow}>
              <Check color={plan.accent} size={18} strokeWidth={2} style={styles.benefitIcon} />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        {t.btnBg === 'gradient' ? (
          <Pressable
            onPress={() => onSubscribe(plan.tier)}
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
            onPress={() => onSubscribe(plan.tier)}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            style={[styles.cta, { borderColor: t.btnBorder }]}
            testID={`assinar-${plan.tier}`}
          >
            <Text style={[styles.ctaText, { color: t.btnColor }]}>{ctaLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ModuleRow({ module }: { module: AddonModule }) {
  const Icon = MODULE_ICON[module.icon];
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
        <Text style={styles.modulePrice}>{module.priceLabel}</Text>
        <Text style={styles.modulePerMonth}>{assinaturasCopy.modules.perMonth}</Text>
      </View>
    </View>
  );
}

export default function PlanosScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Header bar */}
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

      {/* Plan cards */}
      <View style={styles.plans}>
        {PLANS.map((plan) => (
          <PlanCard key={plan.tier} plan={plan} />
        ))}
      </View>

      {/* Add-on modules */}
      <View style={styles.modulesSection}>
        <Text style={styles.modulesEyebrow}>{assinaturasCopy.modules.eyebrow}</Text>
        <Text style={styles.modulesSubcopy}>{assinaturasCopy.modules.subcopy}</Text>
        <View style={styles.modules}>
          {ADDON_MODULES.map((module) => (
            <ModuleRow key={module.key} module={module} />
          ))}
        </View>
        <Text style={styles.footnote}>{assinaturasCopy.modules.footnote}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 120 },

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
