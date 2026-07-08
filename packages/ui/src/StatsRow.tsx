import type { GarageStats } from '@ccc/shared/garage-progress';
import { Text, View } from 'react-native';

import { BadgeGlyph } from './BadgeGlyph.js';
import { garageTokens } from './garage-tokens.js';

/** See §"Component contract" for locale + UTC rationale. Exported only for direct unit testing. */
export function formatJoinedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(d);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  if (!month || !year) return '';
  return `${month} ${year}`;
}

export interface StatsRowProps {
  /** Wire shape from `garage.stats` per outline §395. */
  stats: GarageStats;
  /** Optional RN testID for parent test selectors. */
  testID?: string;
}

type Tile =
  | { kind: 'num'; label: string; icon: string; value: number }
  | { kind: 'date'; label: string; icon: string; value: string };

// Hardcoded mono fontFamily. Other `@ccc/ui` components avoid `Platform`
// because barrel re-exports load module-level Platform.select into every
// mobile test that imports from `@ccc/ui`, and most test files mock
// `react-native` without `Platform`. iOS renders 'Menlo' natively; Android
// falls through to the system default.
const MONO = 'Menlo';

const tileBoxStyle = {
  flex: 1,
  backgroundColor: garageTokens.surface.sheet,
  borderWidth: 1,
  borderColor: garageTokens.surface.border,
  borderRadius: 12,
  paddingTop: 10,
  paddingBottom: 9,
  paddingHorizontal: 8,
  alignItems: 'center' as const,
  gap: 3,
} as const;

const numValueStyle = {
  fontFamily: MONO,
  fontWeight: '700' as const,
  fontSize: 17,
  letterSpacing: -0.4,
  lineHeight: 17,
  color: '#F5F5F5',
} as const;

const dateValueStyle = {
  fontWeight: '700' as const,
  fontSize: 13,
  letterSpacing: -0.1,
  lineHeight: 13,
  color: '#F5F5F5',
} as const;

const labelStyle = {
  fontFamily: MONO,
  fontSize: 9,
  letterSpacing: 0.8,
  color: '#8A8A93',
  textTransform: 'uppercase' as const,
} as const;

/**
 * StatsRow — 4-tile strip (Eventos · Posts · Curtidas · Desde). Pure-prop;
 * killswitch + public hide-on-empty live on `ProfileStats` (chunk 39).
 * Visual canon: `.handoffs/xp-handoff/.../jdma-garage/progress.jsx` lines
 * 464–541. RN port uses `flex: 1` per tile in place of CSS grid.
 */
export function StatsRow({ stats, testID }: StatsRowProps) {
  const tiles: Tile[] = [
    { kind: 'num', label: 'Eventos', icon: 'flag', value: stats.events },
    { kind: 'num', label: 'Posts', icon: 'post', value: stats.posts },
    { kind: 'num', label: 'Curtidas', icon: 'fire', value: stats.likesReceived },
    { kind: 'date', label: 'Desde', icon: 'pin', value: formatJoinedAt(stats.joinedAt) },
  ];

  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }} testID={testID}>
      {tiles.map((t) => (
        <View key={t.label} style={tileBoxStyle}>
          <View style={{ marginBottom: 2 }}>
            <BadgeGlyph name={t.icon} size={14} color="#8A8A93" />
          </View>
          <Text style={t.kind === 'date' ? dateValueStyle : numValueStyle}>
            {t.kind === 'date' ? t.value : String(t.value)}
          </Text>
          <Text style={labelStyle}>{t.label.toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
}
