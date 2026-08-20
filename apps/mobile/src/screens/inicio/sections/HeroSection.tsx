// Seção 1 — apresentação do clube.
//
// Bloco de 210px com foto full-bleed, gradiente vertical por cima e o mote
// alinhado embaixo à esquerda, conforme o handoff. Abaixo, o bloco
// institucional com imagem e texto. Sem banner cadastrado, o hero cai num
// fundo escuro sólido em vez de deixar um buraco na tela.

import type { HomeHero, HomeInstitutional } from '@ccc/shared/home';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';

import { p } from '~/screens/inicio/palette';

export function HeroSection({
  hero,
  institutional,
}: {
  hero: HomeHero;
  institutional: HomeInstitutional;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        {hero.bannerUrl ? (
          <Image
            source={{ uri: hero.bannerUrl }}
            accessible={false}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : null}
        <LinearGradient
          colors={[p.scrimTop, p.scrimMid, p.scrimBottom]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.heroContent}>
          <Text style={styles.mote} accessibilityRole="header">
            {hero.title}
          </Text>
          <LinearGradient
            colors={[p.goldLight, p.goldDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.rule}
          />
        </View>
      </View>

      {hero.subtitle ? <Text style={styles.subtitle}>{hero.subtitle}</Text> : null}

      <View style={styles.institutional}>
        {institutional.imageUrl ? (
          <Image
            source={{ uri: institutional.imageUrl }}
            accessible={false}
            style={styles.institutionalImage}
            resizeMode="cover"
          />
        ) : null}
        <Text style={styles.institutionalTitle} accessibilityRole="header">
          {institutional.title}
        </Text>
        <Text style={styles.institutionalBody}>{institutional.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 22 },
  hero: {
    height: 210,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: p.heroBorder,
    overflow: 'hidden',
    backgroundColor: p.surface,
    justifyContent: 'flex-end',
  },
  heroContent: { padding: 22 },
  mote: {
    fontFamily: 'Jost_700Bold',
    fontSize: 29,
    lineHeight: 30,
    letterSpacing: -0.29,
    color: p.cream,
  },
  rule: {
    width: 44,
    height: 3,
    borderRadius: 2,
    marginTop: 14,
  },
  subtitle: {
    fontFamily: 'Jost_500Medium',
    fontSize: 15,
    lineHeight: 22,
    color: p.muted60,
  },
  institutional: { gap: 12 },
  institutionalImage: {
    width: '100%',
    height: 160,
    borderRadius: 14,
    backgroundColor: p.surface,
  },
  institutionalTitle: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 19,
    color: p.cream,
  },
  institutionalBody: {
    fontFamily: 'Jost_500Medium',
    fontSize: 14,
    lineHeight: 22,
    color: p.muted60,
  },
});
