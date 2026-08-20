// Header do app conforme o handoff: monograma 40x40 mais o bloco de texto
// CASA CAR CLUB / CURITIBA, e um slot livre a direita.
//
// O slot existe porque os dois estados da home querem coisas diferentes ali:
// o anonimo quer um botao Entrar, o membro quer o sino de notificacoes. A
// decisao fica fora deste componente.

import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { p } from '~/screens/inicio/palette';

const WORDMARK = 'CASA CAR CLUB';
const LOCATION = 'CURITIBA';

export function AppHeader({ right }: { right?: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Image
          source={require('@ccc/design/assets/brand/monogram-ccc-circle-gold.png')}
          accessible={false}
          style={styles.monogram}
        />
        <View>
          <Text style={styles.wordmark}>{WORDMARK}</Text>
          <Text style={styles.location}>{LOCATION}</Text>
        </View>
      </View>
      {right ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 18,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  monogram: { width: 40, height: 40, resizeMode: 'contain' },
  wordmark: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.9,
    color: p.cream,
  },
  location: {
    marginTop: 3,
    fontFamily: 'Jost_500Medium',
    fontSize: 9,
    letterSpacing: 3.1,
    color: p.goldDeep,
  },
});
