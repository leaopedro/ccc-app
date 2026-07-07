import { badgeCatalogResponseSchema, type BadgeCatalogResponse } from '@jdm/shared/badges';
import { garagePublicResponseSchema, type GaragePublicResponse } from '@jdm/shared/garage-public';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

// API contract: GET /g/:slug returns 404 for unknown OR private slugs.
// Indistinguishable by design (anti-enumeration). See apps/api/src/routes/garage.ts.
export const fetchPublicGarage = async (slug: string): Promise<GaragePublicResponse | null> => {
  const res = await fetch(`${API_BASE}/g/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const json: unknown = await res.json();
  return garagePublicResponseSchema.parse(json);
};

// Public badge catalog used by the SSR public garage to resolve rarity +
// icon for pinned earned badges (the chunk 16 public payload carries
// only codes + earnedAt). API caches for 5 minutes server-side; mirror
// that on the Next.js fetch cache so SSR pages dedupe in-flight requests
// and revalidate on the same cadence as the upstream. Fail open: a
// catalog fetch error must not break the public garage page — return
// `null` so the caller degrades by skipping the BadgeRow.
export const fetchBadgeCatalog = async (): Promise<BadgeCatalogResponse | null> => {
  try {
    const res = await fetch(`${API_BASE}/badges/catalog`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return badgeCatalogResponseSchema.parse(json);
  } catch {
    return null;
  }
};
