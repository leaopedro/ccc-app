// Label de seção do handoff: 10px, weight 600, letter-spacing .28em, dourado
// profundo, uppercase. É a peça que dá ritmo à tela; repetir sem variação.

import { StyleSheet, Text } from 'react-native';

import { p } from '~/screens/inicio/palette';

export function SectionLabel({ label }: { label: string }) {
  return (
    <Text style={styles.label} accessibilityRole="header">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: p.goldDeep,
    textTransform: 'uppercase',
  },
});
