// Seção 2 — benefícios da assinatura.
//
// Lista vinda do banco (HomeBenefit ativos, ordenados). Sem item ativo a
// seção inteira não renderiza: a tela nunca mostra cabeçalho sem conteúdo.

import type { HomeBenefit } from '@ccc/shared/home';
import { StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { homeIcon } from '~/screens/inicio/icons';
import { p } from '~/screens/inicio/palette';

export function BenefitsSection({ benefits }: { benefits: HomeBenefit[] }) {
  if (benefits.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.benefits} />
      <View style={styles.list}>
        {benefits.map((benefit) => {
          const Icon = homeIcon(benefit.icon);
          return (
            <View key={`${benefit.sortOrder}-${benefit.title}`} style={styles.row}>
              <Icon color={p.goldDeep} size={20} strokeWidth={1.75} />
              <View style={styles.text}>
                <Text style={styles.title}>{benefit.title}</Text>
                {benefit.description ? (
                  <Text style={styles.description}>{benefit.description}</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  list: { gap: 12 },
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
  },
  text: { flex: 1, gap: 3 },
  title: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 14,
    color: p.cream,
  },
  description: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: p.muted60,
  },
});
