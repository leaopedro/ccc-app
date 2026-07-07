import { StyleSheet, Text, View } from 'react-native';

import { garageCopy } from '~/copy/garage';

export function ExpiredPremiumNotice() {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{garageCopy.garage.expiredTitle}</Text>
      <Text style={styles.body}>{garageCopy.garage.expiredBody}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
  },
  title: { color: '#FFC04A', fontSize: 13, fontWeight: '700' },
  body: { color: '#C9C9CD', fontSize: 12, marginTop: 4, lineHeight: 17 },
});
