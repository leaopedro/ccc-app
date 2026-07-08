import { brand } from '@ccc/design';
import { StyleSheet, Text, View } from 'react-native';

import { garageCopy } from '~/copy/garage';

export function WelcomeBanner({ freeLimit }: { freeLimit: number | null }) {
  return (
    <View style={styles.card}>
      <View style={styles.glyph}>
        <Text style={styles.glyphChar}>{garageCopy.garage.welcomeGlyph}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{garageCopy.garage.welcomeTitle}</Text>
        <Text style={styles.bodyText}>{garageCopy.garage.welcomeBody(freeLimit)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: brand.color.brandTint,
    borderWidth: 1,
    borderColor: `${brand.color.brand}59`,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  glyph: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: `${brand.color.brand}2E`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphChar: { color: brand.color.brandSoft, fontSize: 14, lineHeight: 16 },
  body: { flex: 1 },
  title: { color: brand.color.textPrimary, fontSize: 13, fontWeight: '700' },
  bodyText: { color: brand.color.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 17 },
});
