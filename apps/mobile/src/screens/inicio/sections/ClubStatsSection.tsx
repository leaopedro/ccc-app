// Secao "Status do clube": grid de tres contadores.
//
// Os numeros vem de GET /api/club-stats e sao contagens do clube, nunca do
// membro. A secao aparece nos dois estados da home, entao nao conhece auth.
//
// Zero e um valor legitimo e renderiza normalmente. Somente `stats` nulo
// (falha ou carregando) esconde a secao, para nao deixar cabecalho sem
// conteudo.

import type { ClubStatsResponse } from '@ccc/shared/club-stats';
import { StyleSheet, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { StatCard } from '~/screens/inicio/components/StatCard';

export function ClubStatsSection({ stats }: { stats: ClubStatsResponse | null }) {
  if (!stats) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.clubStats} />
      <View style={styles.grid}>
        <StatCard icon="users" label={inicioCopy.clubStats.members} value={stats.members} />
        <StatCard icon="calendar" label={inicioCopy.clubStats.events} value={stats.events} />
        <StatCard icon="car" label={inicioCopy.clubStats.garage} value={stats.cars} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  grid: { flexDirection: 'row', gap: 12 },
});
