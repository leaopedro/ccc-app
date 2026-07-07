import type { BadgeCatalogEntry, GarageBadgePublic } from '@jdm/shared/badges';

import { garageTokens } from '../garage-tokens.js';

import { HexBadge } from './HexBadge.js';

const MAX_FEATURED = 4;

export interface BadgeRowProps {
  /** Pinned earned badges from the public payload (chunk 16). Ordered
   *  upstream by `pinnedAt DESC NULLS LAST`. */
  badges: GarageBadgePublic[];
  /** Badge catalog used to resolve `rarity` + `icon` for each pinned
   *  code. Fetched server-side from `GET /badges/catalog`. */
  catalog: BadgeCatalogEntry[];
}

/**
 * BadgeRow (web, SSR) — public garage Conquistas strip. Renders up to
 * 4 pinned earned badges followed by a `+N` overflow chip when more
 * are pinned. SSR-static: no click handlers, no `'use client'` —
 * matches the public payload's pinned-only constraint (no locked
 * tiles, no drilldown sheet on the public surface).
 *
 * Visual canon: `.handoffs/.../jdma-garage/badges.jsx` BadgeRow (lines
 * 554–667), public mode. The mobile owner twin
 * (`packages/ui/src/BadgeRow.tsx`) renders pinned + unpinned + locked
 * + an "Ver todas" sheet — owner-only behavior left out here.
 *
 * Catalog drift safety: any badge code not in the catalog is skipped
 * silently. Future server-side catalog additions degrade gracefully
 * to a smaller row until the next admin deploy picks up the entry.
 */
export function BadgeRow({ badges, catalog }: BadgeRowProps) {
  if (badges.length === 0) return null;

  const resolved = badges
    .map((b) => {
      const entry = catalog.find((c) => c.code === b.code);
      return entry ? { badge: b, entry } : null;
    })
    .filter((x): x is { badge: GarageBadgePublic; entry: BadgeCatalogEntry } => x !== null);

  if (resolved.length === 0) return null;

  const featured = resolved.slice(0, MAX_FEATURED);
  const overflow = Math.max(0, resolved.length - MAX_FEATURED);

  return (
    <section
      className="mx-4 mt-3 rounded-2xl border border-border bg-surface p-3"
      aria-label="Conquistas"
    >
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold text-fg tracking-tight">Conquistas</h2>
      </div>
      <div className="flex flex-wrap items-start gap-3.5">
        {featured.map(({ badge, entry }) => (
          <HexBadge
            key={badge.code}
            code={badge.code}
            variant="earned"
            rarity={entry.rarity}
            icon={entry.icon}
            size="md"
          />
        ))}
        {overflow > 0 ? (
          <span
            aria-label={`Mais ${overflow} conquistas`}
            className="inline-flex items-center justify-center rounded-lg border border-dashed bg-surface-deep text-[13px] font-bold text-fg-secondary"
            style={{
              width: 52,
              height: 52,
              borderColor: garageTokens.surface.border,
            }}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
    </section>
  );
}
