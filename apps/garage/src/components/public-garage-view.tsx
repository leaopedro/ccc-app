import type { BadgeCatalogEntry } from '@ccc/shared/badges';
import {
  GARAGE_COVER_PRESETS,
  resolveGarageCoverSlug,
  type GarageCoverPresetSlug,
} from '@ccc/shared/garage-covers';
import type { GaragePublicResponse } from '@ccc/shared/garage-public';
import { BadgeRow, garageTokens, ProfileStatsWeb } from '@ccc/ui/web';

import { PremiumBadge } from '~/components/premium-badge';

// Mobile renders the cover at 168px and pulls the identity card 44px up over
// it (GarageCover default height + IdentityCard marginTop). Both numbers are
// mirrored here so the overlap reads identically on the web column.
const COVER_HEIGHT = 168;

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
      {/* Geometry mirrors mobile IdentityCard: -44px overlap, 16px gutter,
          14px padding, 16px radius, 12px gap. */}
      <section className="-mt-11 mx-4 bg-surface border border-border rounded-2xl p-3.5 relative shadow-2xl">
        {garage.isPremiumActive ? (
          <div
            className="absolute top-0 left-4 right-4 h-0.5 rounded-sm"
            style={{ backgroundColor: garageTokens.brand.base }}
          />
        ) : null}
        <div className="flex gap-3">
          <div
            className="w-13 h-13 shrink-0 rounded-xl bg-surface-alt border border-border flex items-center justify-center text-[20px] font-bold"
            style={{ color: '#C9C9CD' }}
          >
            {garage.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-fg text-[17px] font-bold leading-[22px] tracking-[-0.2px]">
                {garage.name}
              </h1>
              {garage.isPremiumActive ? (
                <PremiumBadge isPremiumActive tier={garage.premiumTier} size="sm" />
              ) : null}
            </div>
            {/* The globe prefix is the mobile slug row's public marker. This
                view only ever renders public garages, so it is unconditional. */}
            <div className="text-muted text-[11.5px] font-mono mt-[3px]">
              🌐 garage.casacar.club/g/{garage.slug}
            </div>
          </div>
        </div>
        {garage.description ? (
          <p className="text-fg-secondary text-[13px] leading-[19px] mt-2.5">
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
        <div className="mx-4 mt-3 p-6 border border-dashed border-border rounded-[14px] bg-surface text-center">
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
                className="bg-surface border border-border rounded-[14px] overflow-hidden"
              >
                {/* 116px photo band on the asphalt fill, matching the mobile
                    ParkingStallCard. The asphalt colour doubles as the
                    no-photo placeholder there and here. */}
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt=""
                    className="w-full h-29 object-cover"
                    style={{ backgroundColor: garageTokens.paint.asphalt }}
                  />
                ) : (
                  <div className="h-29" style={{ backgroundColor: garageTokens.paint.asphalt }} />
                )}
                <div className="px-3.5 py-2.5 bg-surface-deep border-t border-border">
                  <p className="text-fg text-[14px] font-bold">
                    {car.year} {car.make} {car.model}
                  </p>
                  {car.nickname ? (
                    <p className="text-muted text-[12px] mt-0.5">{car.nickname}</p>
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
      <div className="w-full relative overflow-hidden" style={{ height: COVER_HEIGHT }}>
        <img src={resolved.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <CoverScrim />
      </div>
    );
  }
  const preset =
    GARAGE_COVER_PRESETS.find((p) => p.slug === resolved.slug) ?? GARAGE_COVER_PRESETS[0];
  const [top, bottom] = preset.hues;
  const imageUrl = presetImageUrl(preset.slug);
  return (
    <div
      className="w-full relative overflow-hidden"
      style={{
        height: COVER_HEIGHT,
        background: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`,
      }}
    >
      {/* Stripe glow — the preset's accent hue at 40% over the hue ramp. Also
          the load/error fallback tint under the R2 artwork. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{ backgroundColor: preset.stripe }}
      />
      {imageUrl ? (
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : null}
      <CoverScrim />
      {/* Corner slug label, same copy and placement as the mobile twin. */}
      <span
        className="absolute top-3.5 right-3.5 text-[9px] uppercase tracking-[0.11em]"
        style={{ color: 'rgba(255,255,255,0.55)' }}
      >
        cover · {preset.slug}
      </span>
    </div>
  );
}

/** Bottom-up black scrim so the identity card has something to sit on. */
function CoverScrim() {
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 bottom-0 h-[70%]"
      style={{
        background:
          'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.85) 100%)',
      }}
    />
  );
}

function presetImageUrl(slug: GarageCoverPresetSlug): string | null {
  const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/garage-cover-presets/${slug}@2x.jpg` : null;
}
