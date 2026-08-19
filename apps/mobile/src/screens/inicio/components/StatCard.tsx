// Stat card do handoff: icone 20px dourado, label de 9px com letter-spacing
// .22em, numeral grande embaixo.
//
// O handoff pede Cormorant Garamond no numeral. Cormorant nao esta no bundle
// (decisao registrada no spec: so serviria a esta peca), entao o numeral usa
// Jost 700. Tamanho, cor e layout seguem o handoff.

import { StyleSheet, Text, View } from 'react-native';

import { homeIcon } from '~/screens/inicio/icons';
import { p } from '~/screens/inicio/palette';

export function StatCard({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number | string;
}) {
  const Icon = homeIcon(icon);
  return (
    <View style={styles.card}>
      <Icon color={p.goldDeep} size={20} strokeWidth={1.75} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
  },
  label: {
    marginTop: 8,
    fontFamily: 'Jost_600SemiBold',
    fontSize: 9,
    letterSpacing: 2.2,
    color: p.muted50,
    textAlign: 'center',
  },
  value: {
    marginTop: 4,
    fontFamily: 'Jost_700Bold',
    fontSize: 26,
    color: p.cream,
  },
});
