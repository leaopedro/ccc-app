// Acesso rápido — grid 2x2 de atalhos, sempre visível, sem depender de dado.

import { StyleSheet, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { QuickActionTile } from '~/screens/inicio/components/QuickActionTile';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';

const TILES = [
  { key: 'events', icon: 'calendar', path: '/events' },
  { key: 'tickets', icon: 'ticket', path: '/tickets' },
  { key: 'garage', icon: 'car', path: '/garage' },
  { key: 'store', icon: 'store', path: '/store' },
] as const;

export function QuickAccessSection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const rows = [TILES.slice(0, 2), TILES.slice(2, 4)];

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.quickAccess} />
      <View style={styles.grid}>
        {rows.map((row) => (
          <View key={row.map((tile) => tile.key).join('-')} style={styles.row}>
            {row.map((tile) => (
              <QuickActionTile
                key={tile.key}
                icon={tile.icon}
                label={inicioCopy.quickAccess[tile.key]}
                onPress={() => onNavigate(tile.path)}
                testID={`inicio-quick-${tile.key}`}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  grid: { gap: 12 },
  row: { flexDirection: 'row', gap: 12 },
});
