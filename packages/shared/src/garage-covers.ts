import { z } from 'zod';

// Slug tuple is the source of truth for the catalog. Defined as an explicit
// `as const` tuple so the inferred type stays a literal union — not `string`.
// Cast-via-`[string, ...string[]]` was the prior approach and widened
// `GarageCoverPresetSlug` to plain `string`, defeating the wire-format contract.
export const GARAGE_COVER_PRESET_SLUG_TUPLE = [
  'default-door',
  'tokyo-wangan',
  'kanjo-loop',
  'touge-pass',
  'tsukuba-dawn',
  'drift-smoke',
  'workshop',
  'autobahn-blue',
  'vintage-meet',
  'monaco-marble',
] as const;

export const garageCoverPresetSchema = z.enum(GARAGE_COVER_PRESET_SLUG_TUPLE);
export type GarageCoverPresetSlug = z.infer<typeof garageCoverPresetSchema>;

export const GARAGE_COVER_PRESET_SLUGS: ReadonlySet<GarageCoverPresetSlug> = new Set(
  GARAGE_COVER_PRESET_SLUG_TUPLE,
);

// 9 curated covers + 1 free default. Slugs are the wire format and travel
// over the API verbatim. Hex stripe + hues drive the CSS-gradient fallback
// rendered when R2 artwork is unreachable; production artwork is bundled at
// `docs/assets/garage-covers/<slug>@2x.{png,jpg}` and uploaded to R2 under
// `garage-cover-presets/<slug>@2x.{jpg,webp}`.
export const GARAGE_COVER_PRESETS = [
  {
    slug: 'default-door',
    label: 'Garagem Padrão',
    premium: false,
    hues: ['#1F1F1F', '#0A0A0A'],
    stripe: '#9AA0AC',
  },
  {
    slug: 'tokyo-wangan',
    label: 'Tokyo Wangan',
    premium: true,
    hues: ['#1A0606', '#0A0A0A'],
    stripe: '#D4AF37',
  },
  {
    slug: 'kanjo-loop',
    label: 'Kanjo Loop',
    premium: true,
    hues: ['#1A1208', '#0A0A0A'],
    stripe: '#FFD24A',
  },
  {
    slug: 'touge-pass',
    label: 'Touge Pass',
    premium: true,
    hues: ['#0F1A26', '#06090E'],
    stripe: '#4A9EFF',
  },
  {
    slug: 'tsukuba-dawn',
    label: 'Tsukuba Dawn',
    premium: true,
    hues: ['#1C1822', '#0A0A0A'],
    stripe: '#FF8A3A',
  },
  {
    slug: 'drift-smoke',
    label: 'Drift Smoke',
    premium: true,
    hues: ['#241A24', '#080608'],
    stripe: '#FF7A3A',
  },
  {
    slug: 'workshop',
    label: 'Workshop',
    premium: true,
    hues: ['#1A1612', '#080806'],
    stripe: '#C58A52',
  },
  {
    slug: 'autobahn-blue',
    label: 'Autobahn',
    premium: true,
    hues: ['#0D1E3A', '#04060F'],
    stripe: '#4A9EFF',
  },
  {
    slug: 'vintage-meet',
    label: 'Vintage Meet',
    premium: true,
    hues: ['#1F1F22', '#0A0A0C'],
    stripe: '#9AA0AC',
  },
  {
    slug: 'monaco-marble',
    label: 'Monaco',
    premium: true,
    hues: ['#0F1418', '#050708'],
    stripe: '#E8B339',
  },
] as const satisfies ReadonlyArray<{
  slug: GarageCoverPresetSlug;
  label: string;
  premium: boolean;
  hues: readonly [string, string];
  stripe: string;
}>;

// Renderer precedence — used by GarageCover + SSR view + admin twin.
// Source of truth so the gating rule lives in exactly one place.
export const resolveGarageCoverSlug = (
  coverPreset: string | null,
  coverImageUrl: string | null,
  isPremiumActive: boolean,
): { kind: 'preset'; slug: GarageCoverPresetSlug } | { kind: 'url'; url: string } => {
  if (isPremiumActive && coverImageUrl) return { kind: 'url', url: coverImageUrl };
  if (
    coverPreset &&
    (coverPreset === 'default-door' || isPremiumActive) &&
    (GARAGE_COVER_PRESET_SLUGS as ReadonlySet<string>).has(coverPreset)
  ) {
    return { kind: 'preset', slug: coverPreset as GarageCoverPresetSlug };
  }
  return { kind: 'preset', slug: 'default-door' };
};
