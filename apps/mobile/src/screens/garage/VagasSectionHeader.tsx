import { StyleSheet, Text, View } from 'react-native';

import { garageCopy } from '~/copy/garage';

type Props = {
  carCount: number;
  freeLimit: number | null;
  isUnlimited: boolean;
  hasExtra: boolean;
};

const modeLabel = (props: Props): string => {
  if (props.isUnlimited) return garageCopy.garage.sectionVagasMode.unlimited;
  if (props.hasExtra) return garageCopy.garage.sectionVagasMode.gratisExtra;
  if (props.freeLimit !== null && props.carCount >= props.freeLimit)
    return garageCopy.garage.sectionVagasMode.atCap;
  return garageCopy.garage.sectionVagasMode.gratis;
};

const denomFor = (props: Props): string => {
  if (props.isUnlimited) return garageCopy.garage.sectionVagasUnlimitedDenom;
  if (props.freeLimit === null) return garageCopy.garage.sectionVagasUnknownDenom;
  return String(props.freeLimit);
};

export function VagasSectionHeader(props: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={1}>
          {garageCopy.garage.sectionVagasTitle}
        </Text>
        <Text style={styles.count} numberOfLines={1}>
          {props.carCount}/{denomFor(props)}
        </Text>
      </View>
      <Text style={styles.mode} numberOfLines={1}>
        {modeLabel(props)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 },
  title: { color: '#F5F5F5', fontSize: 15, fontWeight: '700', letterSpacing: -0.1 },
  count: { color: '#8A8A93', fontSize: 12, flexShrink: 1 },
  mode: {
    color: '#8A8A93',
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    flexShrink: 0,
    textAlign: 'right',
  },
});
