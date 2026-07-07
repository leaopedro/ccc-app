import type { GarageStats } from '@jdm/shared/garage-progress';

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

/**
 * StatsRowWeb — SSR-safe twin of the mobile StatsRow (chunk 37). 4-tile
 * CSS-grid strip (Eventos · Posts · Curtidas · Desde). Wrapper
 * (ProfileStatsWeb) owns the killswitch + hide-on-empty gates.
 */
export function StatsRowWeb({ stats }: StatsRowWebProps) {
  const tiles: Array<{ label: string; value: string; mono: boolean }> = [
    { label: 'EVENTOS', value: String(stats.events), mono: true },
    { label: 'POSTS', value: String(stats.posts), mono: true },
    { label: 'CURTIDAS', value: String(stats.likesReceived), mono: true },
    { label: 'DESDE', value: formatJoinedAt(stats.joinedAt), mono: false },
  ];
  return (
    <div className="grid grid-cols-4 gap-2 mx-4 mt-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-border bg-surface px-2 py-3 text-center"
        >
          <div
            className={
              tile.mono
                ? 'font-mono text-[20px] leading-none text-fg'
                : 'text-[13px] leading-none text-fg'
            }
          >
            {tile.value}
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase text-muted">{tile.label}</div>
        </div>
      ))}
    </div>
  );
}
