// Seção 5 — resumo dos planos.
//
// Dados de GET /api/home-content, que filtra por active + homeFeatured e
// trunca os benefícios. O detalhe completo vive em /assinaturas, então aqui
// não há CTA de contratação: tocar no card leva para a jornada.
//
// O accent por tier é presentação derivada do tier, igual
// src/screens/assinaturas/tier-visual.ts faz. A API só entrega conteúdo.

import type { HomePlan } from '@ccc/shared/home';
import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { formatBRL } from '~/lib/format';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

const TIER_ACCENT: Record<HomePlan['tier'], string> = {
  bronze: '#C08A4E',
  silver: '#C7CCD1',
  gold: '#E8CE86',
};

export function PlansSection({
  plans,
  onOpenPlan,
  onSeeAll,
}: {
  plans: HomePlan[];
  onOpenPlan: (slug: string) => void;
  onSeeAll: () => void;
}) {
  if (plans.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.plans} />

      <View style={styles.list}>
        {plans.map((plan) => {
          const accent = TIER_ACCENT[plan.tier];
          return (
            <Pressable
              key={plan.slug}
              onPress={() => onOpenPlan(plan.slug)}
              accessibilityRole="button"
              accessibilityLabel={plan.name}
              testID={`inicio-plan-${plan.slug}`}
              style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
            >
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <View style={[styles.dot, { backgroundColor: accent }]} />
                  <Text style={styles.name}>{plan.name}</Text>
                </View>
                <View style={styles.headerRight}>
                  <Text style={styles.from}>{inicioCopy.plans.from}</Text>
                  <Text style={styles.price}>{formatBRL(plan.fromAmountCents)}</Text>
                  <Text style={styles.perMonth}>{inicioCopy.plans.perMonth}</Text>
                </View>
              </View>

              {plan.description ? (
                <Text style={styles.description}>{plan.description}</Text>
              ) : null}

              <View style={styles.benefits}>
                {plan.benefits.map((label) => (
                  <View key={label} style={styles.benefitRow}>
                    <Check color={accent} size={16} strokeWidth={2} />
                    <Text style={styles.benefitText}>{label}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={onSeeAll}
        accessibilityRole="link"
        accessibilityLabel={inicioCopy.plans.seeAll}
        testID="inicio-plans-see-all"
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        <Text style={styles.seeAll}>{inicioCopy.plans.seeAll}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  list: { gap: 12 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
    padding: 16,
    gap: 12,
  },
  pressed: { opacity: 0.9 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontFamily: 'Jost_600SemiBold', fontSize: 17, color: p.cream },
  headerRight: { alignItems: 'flex-end' },
  from: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 9,
    letterSpacing: 2.2,
    color: p.muted45,
  },
  price: { fontFamily: 'Jost_700Bold', fontSize: 19, color: p.cream },
  perMonth: {
    fontFamily: 'Jost_500Medium',
    fontSize: 10,
    letterSpacing: 1.2,
    color: p.muted45,
  },
  description: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: p.muted60,
  },
  benefits: { gap: 6 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  benefitText: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    color: p.muted60,
    flex: 1,
  },
  seeAll: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 13,
    color: p.gold,
    textAlign: 'center',
  },
});
