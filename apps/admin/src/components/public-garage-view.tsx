import type { BadgeCatalogEntry } from '@jdm/shared/badges';
import {
  GARAGE_COVER_PRESETS,
  resolveGarageCoverSlug,
  type GarageCoverPresetSlug,
} from '@jdm/shared/garage-covers';
import type { GaragePublicResponse } from '@jdm/shared/garage-public';
import { BadgeRow, ProfileStatsWeb } from '@jdm/ui/web';

import { PremiumBadge } from '~/components/premium-badge';

type Props = {
  garage: GaragePublicResponse['garage'];
  cars: GaragePublicResponse['cars'];
  /** Resolved badge catalog (chunk 21) — empty when the killswitch is
   *  off, the public payload has no pinned badges, or the catalog
   *  fetch failed (fail-open). */
  badgeCatalog?: BadgeCatalogEntry[];
  /** Top-level gamification capability flag (canon §1). Sourced from
   *  `data.gamification.enabled` in the SSR page — NOT from the nested
   *  `garage.gamification.enabled` (Phase 1 compat path). */
  gamificationEnabled?: boolean;
  /** Server-derived rank/XP block (chunk 24). Omitted under killswitch
   *  off OR public hide-on-empty (all-zero) per canon §2 / §C10. */
  progress?: GaragePublicResponse['progress'];
  /** 4-tile counters block (chunk 24). Same omission rules as `progress`. */
  stats?: GaragePublicResponse['stats'];
};

export function PublicGarageView({
  garage,
  cars,
  badgeCatalog = [],
  gamificationEnabled,
  progress,
  stats,
}: Props) {
  const showBadges =
    garage.gamification.enabled && garage.badges.length > 0 && badgeCatalog.length > 0;
  return (
    <main className="min-h-screen bg-bg">
      <PublicGarageCover
        coverPreset={garage.coverPreset}
        coverImageUrl={garage.coverImageUrl}
        isPremiumActive={garage.isPremiumActive}
      />
      <section className="-mt-11 mx-4 bg-surface border border-border rounded-2xl p-4 relative shadow-2xl">
        {garage.isPremiumActive ? (
          <div
            className="absolute top-0 left-4 right-4 h-0.5 rounded"
            style={{ background: 'linear-gradient(90deg, #E8B339, transparent 80%)' }}
          />
        ) : null}
        <div className="flex gap-3">
          <div className="w-13 h-13 rounded-xl bg-surface-alt border border-border flex items-center justify-center text-fg text-2xl font-bold">
            {garage.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-fg text-[17px] font-bold leading-tight tracking-tight">
                {garage.name}
              </h1>
              {garage.isPremiumActive ? (
                <PremiumBadge isPremiumActive tier={garage.premiumTier} size="sm" />
              ) : null}
            </div>
            <div className="text-muted text-[11.5px] font-mono mt-0.5">
              casacarclub.com.br/g/{garage.slug}
            </div>
          </div>
        </div>
        {garage.description ? (
          <p className="text-fg-secondary text-[13px] leading-relaxed mt-2.5">
            {garage.description}
          </p>
        ) : null}
      </section>

      <ProfileStatsWeb
        gamificationEnabled={gamificationEnabled ?? false}
        progress={progress}
        stats={stats}
      />

      {showBadges ? <BadgeRow badges={garage.badges} catalog={badgeCatalog} /> : null}

      <section className="px-4 mt-5">
        <h2 className="text-fg text-[15px] font-bold">
          Coleção <span className="text-muted text-xs font-mono">{cars.length}</span>
        </h2>
      </section>

      {cars.length === 0 ? (
        <div className="mx-4 mt-3 p-6 border border-dashed border-border rounded-2xl bg-surface text-center">
          <p className="text-fg text-sm font-bold">Nenhum carro publicado</p>
          <p className="text-muted text-xs mt-1">{garage.name} ainda não publicou carros.</p>
        </div>
      ) : (
        <ul className="px-4 mt-3 flex flex-col gap-3 pb-8">
          {cars.map((car) => {
            const photoUrl = car.photos[0]?.url ?? null;
            return (
              <li
                key={car.id}
                className="bg-surface border border-border rounded-2xl overflow-hidden"
              >
                {photoUrl ? (
                  <img src={photoUrl} alt="" className="w-full h-32 object-cover" />
                ) : (
                  <div className="h-32 bg-surface-deep" />
                )}
                <div className="px-4 py-3 bg-surface-deep border-t border-border">
                  <p className="text-fg text-sm font-bold">
                    {car.year} {car.make} {car.model}
                  </p>
                  {car.nickname ? (
                    <p className="text-muted text-xs mt-0.5">{car.nickname}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function PublicGarageCover({
  coverPreset,
  coverImageUrl,
  isPremiumActive,
}: {
  coverPreset: GarageCoverPresetSlug | null;
  coverImageUrl: string | null;
  isPremiumActive: boolean;
}) {
  const resolved = resolveGarageCoverSlug(coverPreset, coverImageUrl, isPremiumActive);
  if (resolved.kind === 'url') {
    return (
      <div className="w-full h-44 relative">
        <img src={resolved.url} alt="" className="w-full h-44 object-cover" />
      </div>
    );
  }
  const preset =
    GARAGE_COVER_PRESETS.find((p) => p.slug === resolved.slug) ?? GARAGE_COVER_PRESETS[0];
  const [top, bottom] = preset.hues;
  const imageUrl = presetImageUrl(preset.slug);
  return (
    <div
      className="w-full h-44 relative"
      style={{ background: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)` }}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-44 object-cover" />
      ) : null}
    </div>
  );
}

function presetImageUrl(slug: GarageCoverPresetSlug): string | null {
  const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/garage-cover-presets/${slug}@2x.jpg` : null;
}
