import type { GarageStats } from '@ccc/shared/garage-progress';

import { BadgeGlyph } from './BadgeGlyph.js';

export type StatsRowWebProps = { stats: GarageStats };

// PT-BR abbreviated month names. Matches the "fev. 26" format locked
// by the plan §"Code shape". UTC accessors used below so SSR output is
// byte-stable regardless of server TZ.
const PT_BR_MONTHS_ABBR = [
  'jan.',
  'fev.',
  'mar.',
  'abr.',
  'mai.',
  'jun.',
  'jul.',
  'ago.',
  'set.',
  'out.',
  'nov.',
  'dez.',
];

function formatJoinedAt(iso: string): string {
  const d = new Date(iso);
  return `${PT_BR_MONTHS_ABBR[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}`;
}

type Tile = { label: string; icon: string; value: string; mono: boolean };

/**
 * StatsRowWeb — SSR-safe twin of the mobile StatsRow (chunk 37). 4-tile
 * CSS-grid strip (Eventos · Posts · Curtidas · Desde). Wrapper
 * (ProfileStatsWeb) owns the killswitch + hide-on-empty gates.
 *
 * Each tile stacks glyph → value → label, matching the RN twin's icon set
 * (flag · post · fire · pin), 14px at #8A8A93, and its type ramp: mono 17px
 * bold for counts, 13px bold sans for the join date, mono 9px uppercase for
 * the label. The icons are decorative — the visible label already names the
 * metric — so the glyph wrapper is aria-hidden.
 */
export function StatsRowWeb({ stats }: StatsRowWebProps) {
  const tiles: Tile[] = [
    { label: 'EVENTOS', icon: 'flag', value: String(stats.events), mono: true },
    { label: 'POSTS', icon: 'post', value: String(stats.posts), mono: true },
    { label: 'CURTIDAS', icon: 'fire', value: String(stats.likesReceived), mono: true },
    { label: 'DESDE', icon: 'pin', value: formatJoinedAt(stats.joinedAt), mono: false },
  ];
  return (
    <div className="grid grid-cols-4 gap-2 mx-4 mt-2.5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex flex-col items-center gap-[3px] rounded-xl border border-border bg-surface px-2 pt-2.5 pb-[9px] text-center"
        >
          <span aria-hidden className="mb-0.5 inline-flex">
            <BadgeGlyph name={tile.icon} size={14} color="#8A8A93" />
          </span>
          <div
            className={
              tile.mono
                ? 'font-mono text-[17px] font-bold leading-[23px] tracking-[-0.4px] text-fg'
                : 'text-[13px] font-bold leading-4 tracking-[-0.1px] text-fg'
            }
          >
            {tile.value}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
            {tile.label}
          </div>
        </div>
      ))}
    </div>
  );
}
