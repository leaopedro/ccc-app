// Assinaturas — post-purchase welcome.
//
// Reached ONLY after pollSubscriptionActive resolved true (ContratarScreen on
// native/web-return, checkout-return.tsx on web), so the membership already
// exists by the time this renders. It is the confirmation of the payment, not
// a step in it: no back affordance, and every entry point uses
// `router.replace` so a consumed checkout never sits in the history stack.
//
// The plan name and the benefit list come from the subscription payload (the
// same GET Minha Assinatura reads) rather than from copy, so the welcome can
// never advertise a benefit the membership does not actually carry. A failed
// or slow read degrades to the welcome + next steps WITHOUT the benefits
// block — a confirmed payment must never render as an error screen.

import { Check, ChevronRight } from 'lucide-react-native';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { assinaturasCopy } from '~/copy/assinaturas';
import { usePremiumSubscription } from '~/hooks/usePremiumSubscription';
import { isCaixaBuildEnabled } from '~/screens/caixa/caixa-enabled';
import { c, TIER_VISUAL, type ApiTier } from '~/screens/assinaturas/tier-visual';

const copy = assinaturasCopy.boasVindas;

// `href` is narrowed to the three destinations rather than `string` so the
// typed-routes check (scripts/typegen.js) catches a step pointing at a route
// that does not exist.
type StepHref = '/caixa/montar' | '/events' | '/garage/new';

type Step = { key: string; title: string; body: string; href: StepHref };

function steps(): Step[] {
  const list: Step[] = [];
  // Same build flag as the caixa block in ContratarScreen — a step linking
  // into a module that is not in this build would be a dead end.
  if (isCaixaBuildEnabled()) {
    list.push({
      key: 'caixa',
      title: copy.steps.caixaTitle,
      body: copy.steps.caixaBody,
      href: '/caixa/montar',
    });
  }
  list.push({
    key: 'eventos',
    title: copy.steps.eventosTitle,
    body: copy.steps.eventosBody,
    href: '/events',
  });
  list.push({
    key: 'garagem',
    title: copy.steps.garagemTitle,
    body: copy.steps.garagemBody,
    href: '/garage/new',
  });
  return list;
}

export default function BoasVindasScreen() {
  const { subscription, loading } = usePremiumSubscription();

  if (loading) {
    return (
      <View style={styles.screen}>
        <View style={styles.centerFill}>
          <ActivityIndicator color={c.gold} />
          <Text style={styles.loadingText}>{copy.loading}</Text>
        </View>
      </View>
    );
  }

  const visual = subscription?.tier ? TIER_VISUAL[subscription.tier as ApiTier] : null;
  const planName = subscription?.planName ?? visual?.label ?? null;
  const benefits = subscription?.benefits ?? [];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subcopy}>{copy.subcopy}</Text>

        {planName ? (
          <View style={[styles.planCard, visual ? { borderColor: visual.accent } : null]}>
            <Text style={styles.planLabel}>{copy.planLabel}</Text>
            <View style={styles.planRow}>
              {visual ? (
                <View
                  style={[
                    styles.tierDot,
                    { backgroundColor: visual.accent, shadowColor: visual.accent },
                  ]}
                />
              ) : null}
              <Text style={styles.planName}>{planName}</Text>
            </View>
          </View>
        ) : null}

        {benefits.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{copy.benefitsTitle}</Text>
            <View style={styles.benefits}>
              {benefits.map((benefit) => (
                <View key={benefit} style={styles.benefitRow}>
                  <Check
                    color={visual?.accent ?? c.goldLight}
                    size={18}
                    strokeWidth={2}
                    style={styles.benefitIcon}
                  />
                  <Text style={styles.benefitText}>{benefit}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{copy.nextTitle}</Text>
          <View style={styles.steps}>
            {steps().map((step) => (
              <Pressable
                key={step.key}
                onPress={() => router.push(step.href)}
                accessibilityRole="button"
                accessibilityLabel={step.title}
                style={styles.stepRow}
                testID={`boas-vindas-passo-${step.key}`}
              >
                <View style={styles.stepText}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepBody}>{step.body}</Text>
                </View>
                <ChevronRight color={c.goldLight} size={20} strokeWidth={1.75} />
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.ctaBar}>
        <Pressable
          onPress={() => router.replace('/assinaturas/minha-assinatura')}
          accessibilityRole="button"
          accessibilityLabel={copy.cta}
          style={styles.cta}
          testID="boas-vindas-cta"
        >
          <Text style={styles.ctaText}>{copy.cta}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 40 },

  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  loadingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: c.muted55,
    textAlign: 'center',
  },

  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 30,
    lineHeight: 36,
    color: c.cream,
    marginTop: 14,
  },
  subcopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color: c.muted55,
    marginTop: 12,
  },

  planCard: {
    marginTop: 26,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.tileBorder,
    backgroundColor: c.surface,
    padding: 20,
  },
  planLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  tierDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 4,
  },
  planName: { fontFamily: 'Inter_600SemiBold', fontSize: 24, lineHeight: 28, color: c.cream },

  section: { marginTop: 32 },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
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

  steps: { marginTop: 16, gap: 12 },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: 16,
    padding: 16,
  },
  stepText: { flex: 1, minWidth: 0 },
  stepTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: c.cream },
  stepBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    lineHeight: 18,
    color: c.muted55,
    marginTop: 3,
  },

  ctaBar: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: c.hairline,
    backgroundColor: c.bg,
  },
  cta: {
    borderRadius: 11,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.tileBorder,
  },
  ctaText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: c.goldLight,
  },
});
