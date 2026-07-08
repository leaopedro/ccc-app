# Garage UI Redesign (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the shipped garage-per-user feature to pixel parity with the design handoff at `.handoffs/design-handoff/design_handoff_garage_redesign/` (HTML prototype + IMPLEMENTATION.md + README.md + JSX atoms/screens/badges). Mobile + admin + SSR public profile. Owner + public surfaces. Dark mode only. PT-BR primary. No locked-contract changes.

**Architecture:** Additive tokens + new shared components in `@ccc/ui` + 2 new `Garage` columns (`coverPreset`, `coverImageUrl`) + 2 new cover endpoints + extension of `UploadKind` for `garage_cover` + new `garage-cover-*` upload route gate + replacement of placeholder stall cards with the parking-stall system + replacement of inline-edit `GarageHeader` with explicit `EditGarageSheet` + replacement of cart-deep-link buy-spot with `BuySpotSheet` + new SSR `/g/:slug` route on `apps/admin`. Premium remains serializer-computed. `/g/:slug` allowlist + anti-enumeration preserved.

**Tech Stack:** Expo + React Native (`apps/mobile`), Next.js App Router (`apps/admin`), Fastify (`apps/api`), Prisma (`packages/db`), zod (`packages/shared`), NativeWind 4 + Tailwind in `@ccc/ui`. RN libs already installed: `expo-linear-gradient`, `react-native-svg`, `expo-image-picker`. Sheets: RN `Modal` (existing pattern in `ExtrasDrawer`). Tests: vitest + Testcontainers Postgres (api), vitest + React Native Testing Library (mobile/ui).

**Out of scope (Phase 2 covers):** Conquistas / achievement badges — see `docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md`.

**Out of scope (deferred entirely):** light mode, tablet layout, EN-locale design exploration, real preset artwork (CSS-rendered placeholders for v1 ship; production needs 1920×720 JPEG+WebP per slug under R2 `garage-cover-presets/`).

---

## File Structure

### New files

- `packages/ui/src/garage-tokens.ts` — tier + paint + cover-rendering tokens (TS export, no Tailwind side-effects).
- `packages/ui/src/GarageCover.tsx` — cover-image renderer; preset gradient stack or R2 url + premium gating.
- `packages/ui/src/ParkingStallCard.tsx` — three-state stall card (filled / empty / buy); SVG paint lines + monospace slot plate + source-aware tape.
- `packages/ui/src/PremiumSheet.tsx` — explainer bottom sheet, tier-tinted hero + 4 benefit rows + near-expiry slot.
- `packages/ui/src/SheetShell.tsx` — shared bottom-sheet chrome (backdrop, grabber, header bar, scroll body).
- `packages/shared/src/garage-covers.ts` — `GARAGE_COVER_PRESETS` const + `garageCoverPresetSchema`.
- `apps/api/src/services/garage/cover.ts` — `applyCoverPatch` + premium gating + R2-URL allowlist + audit emit.
- `apps/mobile/src/screens/garage/EditGarageSheet.tsx` — bottom-sheet replacement for inline-edit.
- `apps/mobile/src/screens/garage/CoverPickerSheet.tsx` — preset grid + upload tile.
- `apps/mobile/src/screens/garage/BuySpotSheet.tsx` — in-context quick-confirm sheet.
- `apps/mobile/src/screens/garage/IdentityCard.tsx` — owner+public floating header card.
- `apps/mobile/src/screens/garage/WelcomeBanner.tsx` — fresh-signup brand-tinted card.
- `apps/mobile/src/screens/garage/ExpiredPremiumNotice.tsx` — warning-tinted inline notice.
- `apps/mobile/src/config/urls.ts` — `PUBLIC_PROFILE_BASE_URL` constant.
- `apps/admin/app/g/[slug]/page.tsx` — SSR public garage view.
- `apps/admin/app/g/[slug]/not-found.tsx` — anti-enumeration 404 HTML.
- `apps/admin/src/components/public-garage-view.tsx` — admin-side cover + identity + stall list.
- `packages/db/prisma/migrations/<ts>_garage_cover/migration.sql` — `coverPreset` + `coverImageUrl` additive ALTERs.

### Modified files

- `packages/shared/src/garage.ts` — extend `garageOwnerSchema` + `garagePatchSchema` + add `daysLeftUntilExpiry`.
- `packages/shared/src/garage-public.ts` — extend `garagePublicProfileSchema` with cover fields.
- `apps/api/src/services/garage/index.ts` — extend `serializeGarageOwner` + `serializeGaragePublic` for cover + daysLeft.
- `apps/api/src/services/uploads/types.ts` — add `'garage_cover'` to `UploadKind`.
- `apps/api/src/services/uploads/index.ts` (impl) — wire new kind into R2 path + cache control.
- `apps/api/src/routes/uploads.ts` — gate `garage_cover` upload kind (any authenticated user; premium gate happens at PATCH time).
- `apps/api/src/routes/garage.ts` — register cover routes, extend payload responses with cover fields.
- `packages/ui/src/PremiumBadge.tsx` — V2 variant (tier-tinted split-pill, key glyph, near-expiry clock, `onPress`).
- `packages/ui/src/index.ts` — export new components.
- `apps/mobile/src/theme/index.ts` — re-export `garageTokens` + add new color slots.
- `apps/mobile/src/screens/garage/GarageHeader.tsx` — gut, become a thin wrapper around `IdentityCard` + sheets.
- `apps/mobile/src/screens/garage/GarageListView.tsx` — render `ParkingStallCard` instead of legacy add/fill/buy cards; pass slot number.
- `apps/mobile/app/(app)/garage/index.tsx` — host all sheet state + handle `?highlight=` param + wire callbacks.
- `apps/mobile/src/copy/garage.ts` — add (canonical key names; every chunk imports the names defined here): `invalidSlug`, `editSheetTitle`, `editSlugHint`, `editVisibilityPublicConsequence` (function), `welcomeTitle`, `welcomeBody` (function), `expiredTitle`, `expiredBody`, `coverPickerHintFree`, `coverPickerHintPremium`, `coverUploadButton`, `coverUploadHint`, `premiumSheetTitle`, `premiumHeroTitle`, `premiumHeroBody`, `premiumTierLabel` (function), `premiumNearExpiry` (function), `premiumBenefits` (array), `premiumFooter`, `sectionVagasTitle`, `sectionVagasMode` (object). Update slug-error map.
- `apps/mobile/src/api/garage.ts` — add `patchGarageCover`, `presignGarageCoverUpload`.
- `apps/admin/src/components/premium-badge.tsx` — replace with import from new `@ccc/ui-web/PremiumBadge` (see chunk 05). Do NOT delete; rewrite as a thin re-export.
- `apps/admin/src/components/*` (every call site) — switch to `@ccc/ui-web` imports.

### Deleted files

- `apps/mobile/src/screens/garage/AddCarPlaceholderCard.tsx` — superseded by `ParkingStallCard` (empty state).
- `apps/mobile/src/screens/garage/FillSpotCard.tsx` — superseded by `ParkingStallCard` (empty/extra state).
- `apps/mobile/src/screens/garage/BuySpotCard.tsx` — superseded by `ParkingStallCard` (buy state) + `BuySpotSheet`.
- `apps/mobile/src/screens/garage/GarageSpotPlaceholderCard.tsx` — superseded by `ParkingStallCard`.

---

## Wave ordering

- **Wave A — structural floor (must ship together).** Chunks 01 → 06. After Wave A merges, the owner side is structurally correct: tokens, schema, PremiumBadge V2, IdentityCard, EditGarageSheet, ParkingStallCard. The app already works; sheets/cover come next.
- **Wave B — cover system + buy-flow + SSR + polish.** Chunks 07 → 14.

Each chunk = one PR, branch convention `feat/jdma-garage-redesign-NN`.

---

## Branch safety preflight (per CLAUDE.md)

Run BEFORE the first edit of EVERY chunk:

```bash
git branch --show-current
# If output is `production` → STOP. Switch to main first.
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-redesign-NN  # NN = chunk number
```

Never branch from `production`. Never commit/push to `production`. Never `--no-verify` or `--no-gpg-sign`.

---

## Locked invariants (do NOT relax)

These are load-bearing from `.handoffs/garage-spots-orchestration.md`. The redesign extends them; never breaks them.

1. **`isPremiumActive` is serializer-computed.** Never persisted. Never derived client-side from raw `premiumUntil`.
2. **`/g/:slug` payload is allowlist-strict.** Adding `coverPreset` + `coverImageUrl` is fine — they are not PII. Adding anything else needs separate review.
3. **404 for unknown slug === 404 for private slug.** Same status, same body, same headers, same render. SSR HTML 404 mirrors the JSON behavior byte-equivalent within the HTML envelope.
4. **Orders flip to `paid` only from verified webhook signatures.** Buy-spot sheet does NOT mutate order state; it routes through the existing cart → checkout → webhook pipeline.
5. **Webhooks idempotent.** No changes to webhook handlers in Phase 1.
6. **Premium cover when lapsed:** renderer treats `coverImageUrl` + non-`default-door` `coverPreset` as `'default-door'` when `isPremiumActive === false`. DB row stays intact (re-activate restores choice). This is renderer logic — do NOT add a sweep job.
7. **DSR export + anonymize:** garage row stays (user-anonymized, garage retained). FK cascade does NOT fire. New tx work required: explicitly clear `coverImageObjectKey`, queue R2 object deletion, `deleteMany` `GarageBadge` (chunk 18+), `deleteMany` `XpEvent` (Phase 2), reset `Garage.xp` + `Garage.likesReceived` to 0. See §Corrections / DSR.

---

## Corrections applied 2026-05-21 post-review

These overrides replace inline content in the chunks below. **Engineer reads this section first** — each correction supersedes the chunk text it cites. The chunk bodies stay verbatim so the rationale + scaffolding is visible; only the contract changes.

### C1 — Cover stored as object key, never URL (overrides chunks 02, 03, 07, 09, 13)

Schema:

```prisma
model Garage {
  // ...
  coverPreset           String?  @db.VarChar(40)
  coverImageObjectKey   String?  @db.VarChar(300)  // R2 key, e.g. 'garage-cover/<userId>/abc.jpg'
}
```

Migration (chunk 02 SQL):

```sql
ALTER TABLE "Garage"
  ADD COLUMN "coverPreset" VARCHAR(40),
  ADD COLUMN "coverImageObjectKey" VARCHAR(300);
```

Zod (chunk 02, replace any prior `coverImageUrl` zod entry):

```ts
const garageCoverObjectKeyRe = /^garage-cover\/[a-z0-9]+\/[^/]+$/i;
export const garageCoverObjectKeySchema = z.string().regex(garageCoverObjectKeyRe);
```

Serializer (chunk 02 §Step 2.9): `serializeGarageOwner` returns BOTH `coverImageObjectKey` (raw) AND `coverImageUrl` (resolved via `app.uploads.buildPublicUrl(key)`). `serializeGaragePublic` returns ONLY the resolved URL (public side has no use for the raw key). The resolver still applies the lapse mask via the shared `resolveGarageCoverSlug` helper.

Mobile + SSR: `<GarageCover />` accepts `coverImageUrl` (already-resolved). Never builds R2 URLs client-side.

PATCH body (chunk 03): `{ coverPreset?: string | null } | { coverImageObjectKey?: string | null }`. Validation rejects URLs in `coverImageObjectKey`. Object-key prefix MUST match `garage-cover/<requesterUserId>/`.

### C2 — Separate `garageCoverPatchSchema`, NOT extending `garagePatchSchema` (overrides chunk 02 §Step 2.3)

`garagePatchSchema` keeps its original fields only (`name`, `slug`, `description`, `isPublic`). Cover fields live in a separate schema bound to the separate cover route:

```ts
export const garageCoverPatchSchema = z.union([
  z.object({ coverPreset: garageCoverPresetSchema.nullable() }).strict(),
  z.object({ coverImageObjectKey: garageCoverObjectKeySchema.nullable() }).strict(),
]);
```

`PATCH /me/garage` rejects cover keys via `.strict()` zod behavior; `PATCH /me/garage/cover` accepts only the cover schema.

### C3 — Public serializer does NOT mask; renderer is sole gating site (overrides chunk 02 §Step 2.9 + chunk 07)

`serializeGaragePublic` returns the stored `coverPreset` + resolved `coverImageUrl` verbatim. The `resolveGarageCoverSlug` helper in `@ccc/shared/garage-covers` returns `default-door` when `!isPremiumActive`. Both mobile + SSR call the helper at render time. **Server never masks; renderer always resolves.** Eliminates the dual-gating contradiction.

### C4 — Missing cover endpoints (overrides chunk 03)

Three endpoints — per handoff §2.3:

```
GET   /me/garage/cover/presets    → { presets: [{ slug, label, premium }] }  (rate-limit 60/min/ip)
POST  /me/garage/cover/upload     → { uploadUrl, objectKey, publicUrl, expiresAt, headers }  (5/min/user)
PATCH /me/garage/cover            → { garage: GarageOwner }  (5/min/user)
```

`POST /me/garage/cover/upload` is a thin wrapper around `POST /uploads/presign` with `kind: 'garage_cover'` injected server-side (client never specifies kind for this endpoint). Server enforces `isPremiumActive` BEFORE returning the presign URL — free users get `400 premium_required`.

Mobile API client adds three helpers: `getCoverPresets()`, `requestGarageCoverUpload(input)`, `patchGarageCover(patch)`.

### C5 — Audit actions for cover changes (overrides chunk 03)

Extend `adminAuditActionSchema` (in `packages/shared/src/admin.ts`):

```ts
'garage.cover_set',
'garage.cover_reset',
```

Cover PATCH writes one `AdminAudit` row per successful change. `actorId` = the owning user (self-action). `entity` = `garage:<garageId>`. `metadata` = `{ from: <prevSlug|prevKey|null>, to: <newSlug|newKey|null> }`.

### C6 — Cover presign rate limit (overrides chunk 03)

`/uploads/presign` currently has no per-kind limiter. Add a per-user 5/min limiter scoped to `kind === 'garage_cover'` either via the new `POST /me/garage/cover/upload` wrapper (preferred — limiter lives on the wrapper route) or via a wrapper layer inside `uploads.ts`. Cover wrapper is preferred so the existing presign route stays unchanged.

### C7 — `invalid_slug` guard before zod parse (overrides chunk 08 + 12)

Zod throws on regex violation BEFORE reaching the route's `if (!SLUG_RE.test(...))` guard. Two options — pick A:

- **A** (preferred): zod schema for `garagePatchSchema.slug` uses `.transform()` + manual regex check that catches the error before zod's generic 400. Replace the `slug` field zod with:

  ```ts
  slug: z.string().trim().min(1).max(40).superRefine((value, ctx) => {
    if (!/^[a-z0-9-]+$/.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_slug' });
    }
  }),
  ```

  Route maps `ZodError` with message `'invalid_slug'` → `400 { error: 'invalid_slug' }`.

- **B**: pre-parse the raw body and check `slug` regex before passing to zod. Less elegant; same effect.

EditGarageSheet client trap maps both `400 { error: 'invalid_slug' }` (this fix) and `400 { error: 'reserved_slug' }` (existing) to the correct copy.

### C8 — ParkingStallCard `StallSource` includes all real values (overrides chunk 06)

```ts
export type StallSource = 'default_free' | 'purchase' | 'admin_grant' | 'premium_membership';
```

`premium_membership` paints same as `purchase` (gold rails + `RESERVADA` tape) — covered explicitly in `paintFor` + `tapeLabel` helpers. `buy` is NOT a source; it is the `state: 'buy'` prop and is paint-overridden in `paintFor` independent of source.

### C9 — ParkingStallCard asphalt + chevrons (overrides chunk 06 §Step 6.3)

Replace the "deviation: flat color in v1" comment + the missing chevron block with the real treatment. Asphalt grid via `react-native-svg` `Pattern` (already a dep). Two chevrons (skewed lines, 18×2pt, 45% opacity) at top. Reference `atoms.jsx` lines 353-380 for the exact pattern. Without this the prototype parity claim is broken.

### C10 — BuySpotSheet thin in-context return (overrides chunk 10)

v1 ships the sheet but Pix/Cartão CTAs STILL navigate to `/cart` — the in-context return path is a bigger change (web-checkout return, deep-link handler, webhook → push). Mark in the chunk that the 5-tap loop is **NOT fully fixed** in v1; only the entry sheet ships. Document the gap; the `?highlight=` pulse + deep-link return are scaffolded but rely on the existing cart return. Add a follow-up task to the plan's "Deferred" section.

### C11 — CoverPickerSheet locked tiles pressable (overrides chunk 09 §Step 9.2)

Drop `disabled={locked}` on both the preset tile and the upload tile. Keep them visually dimmed (`opacity: 0.45`). `onPress` checks `locked` + fires `onPremiumUpsell()` instead of selecting. Same for the upload tile when `!isPremiumActive`. Without this the upsell path is unreachable.

### C12 — `@ccc/ui` package depends on `expo-linear-gradient` + `@ccc/shared` (overrides chunk 07)

`packages/ui/package.json` MUST declare:

```json
"dependencies": {
  "@ccc/shared": "workspace:*",
  "expo-linear-gradient": "~15.0.7"
},
"peerDependencies": {
  "react-native": "*"
}
```

Run `pnpm install` after the edit. If RN-side dep resolution fails, move `GarageCover` to `apps/mobile/src/screens/garage/GarageCover.tsx` instead — kept simpler since SSR has its own renderer.

### C13 — SSR public garage renders real car photos + all 9 presets (overrides chunk 13)

`PublicGarageView`:

- Use `GARAGE_COVER_PRESETS` + `resolveGarageCoverSlug` for the cover. No hardcoded 3-preset palette table.
- Car cards render `car.photos[0]?.url` via `<img>` inside a parking-stall-styled wrapper. Match the mobile filled stall card visually (paint rails + slot plate dropped per public spec, but the car photo IS shown).
- Tailwind tokens needed (`bg-surface`, `bg-surface-alt`, `bg-surface-deep`, `text-fg-secondary`): extend `apps/admin/tailwind.config.ts` (or whatever the admin Tailwind config path is — verify via `git grep -l tailwind apps/admin/`) to add these names, mapping to the same hexes as the mobile theme. Single source of truth = the new `apps/admin/src/styles/garage-tokens.ts` exported file consumed by Tailwind config.

### C14 — Next 16 typed `Promise` params (overrides chunk 13 §Step 13.3)

```tsx
export default async function PublicGaragePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await fetchPublicGarage(slug);
  if (!data) notFound();
  return <PublicGarageView garage={data.garage} cars={data.cars} />;
}
```

### C15 — `@ccc/shared/garage-covers` subpath export (overrides chunk 01 §Step 1.6)

Edit `packages/shared/package.json` `exports` field — add the subpath:

```json
{
  "exports": {
    ".": { ... },
    "./garage": { ... },
    "./garage-public": { ... },
    "./garage-covers": {
      "import": "./dist/garage-covers.js",
      "types": "./dist/garage-covers.d.ts"
    }
  }
}
```

Same pattern for any new shared subpath added later (`./badges`, `./garage-progress`, etc.). Rebuild `@ccc/shared` after every `package.json` edit per memory rule.

### C16 — `GarageSlotV2` is exported + uses `Extract` (overrides chunk 06 §Step 6.6)

```ts
export type GarageSlotV2 =
  | { kind: 'filled'; index: number; source: StallSource; spot: GarageSpot; car: Car }
  | { kind: 'empty'; index: number; source: StallSource; spot: GarageSpot | null }
  | { kind: 'buy'; index: number; purchaseOption: PurchaseOption };

type FilledCar = Extract<GarageSlotV2, { kind: 'filled' }>['car'];

const toCarPayload = (car: FilledCar, isPremiumActive: boolean): ParkingStallCarPayload => ({
  /* ... */
});
```

`extends ... infer C` resolves to `never` over the union; `Extract` is the correct pattern.

### C17 — DSR explicit cleanup (replaces the cascade assumption in §Locked invariants #7)

Phase 1 anonymize-account transaction must explicitly:

1. `UPDATE "Garage" SET "coverImageObjectKey" = NULL, "coverPreset" = NULL WHERE "userId" = ?`.
2. Queue R2 deletion: enqueue any prior `coverImageObjectKey` value into the existing object-delete-queue (or — if no queue exists yet — call `app.uploads.deleteObject(key)` synchronously inside the tx).
3. Conquistas (chunk 18): `prisma.garageBadge.deleteMany({ where: { garage: { userId } } })`.
4. Killswitch is irrelevant for anonymize — it runs even when gamification is disabled.

DSR export must include the user's `Garage.coverImageObjectKey` + `coverPreset` + all `GarageBadge` rows in the exported tarball (these are user activity, the user has the right to see them).

Both flows live in `apps/api/src/services/account-deletion/*` + `apps/api/src/services/data-export.ts`. Extend the existing transaction; do not create a new one.

### C19 — Cover artwork bundled in repo (overrides chunks 01 + 07 + 09 + 13)

Source artwork lives at `docs/assets/garage-covers/<slug>@2x.png` (7 covers at 3392×1248) + `<slug>@1x-LOWRES.jpg` (3 covers at 1024×377 — flagged for regen). The `GARAGE_COVER_PRESETS` catalog (10 entries) is the SHIPPED slug list.

Implementation flow per chunk:

- **Chunk 01** — catalog matches the bundled file list verbatim. `slug` values: `default-door, tokyo-wangan, kanjo-loop, touge-pass, tsukuba-dawn, drift-smoke, workshop, autobahn-blue, vintage-meet, monaco-marble`.
- **Chunk 07** — `GarageCover` mobile renderer reads `app.uploads.buildPublicUrl('garage-cover-presets/<slug>@2x.jpg')` from the resolved-URL field on `GarageOwner.coverImageUrl` (server already resolved per §C1). The CSS gradient fallback only fires when the R2 image fails to load (network error or missing asset) — degrade gracefully to the `hues` gradient from the catalog.
- **Chunk 09** — `CoverPickerSheet` tiles render the same R2 URL at 80pt thumb size. Server has already resolved each preset's URL into the catalog response from `GET /me/garage/cover/presets`.
- **Chunk 13** — SSR view renders `<img src={publicUrl}>` directly. No need for the per-slug palette table (was a placeholder for the CSS-gradient era).

R2 upload step (one-time, before chunk 09 ships):

```bash
# Convert source PNGs to web-ready JPEG q85 + WebP q80
mkdir -p /tmp/garage-covers-export
for f in docs/assets/garage-covers/*@2x.png; do
  slug=$(basename "$f" @2x.png)
  sips -s format jpeg -s formatOptions 85 "$f" --out "/tmp/garage-covers-export/$slug@2x.jpg"
  cwebp -q 80 "$f" -o "/tmp/garage-covers-export/$slug@2x.webp"
done
# LOWRES placeholders ship as-is to staging; production must regen first
cp docs/assets/garage-covers/*@1x-LOWRES.jpg /tmp/garage-covers-export/
# Upload to R2 under garage-cover-presets/
rclone copy /tmp/garage-covers-export/ r2:garage-cover-presets/ --include "*.jpg" --include "*.webp"
```

Regen-before-prod hard requirement: `autobahn-blue`, `vintage-meet`, `monaco-marble`. Engineer or designer reruns the AI prompts at 3840×1440 + replaces the source files in `docs/assets/garage-covers/` before the production R2 upload. Staging can ship with the LOWRES placeholders to unblock end-to-end testing.

### C18 — Admin SSR uses real Tailwind tokens (overrides chunk 13)

Either (preferred):

- Extend `apps/admin/tailwind.config.ts` `theme.extend.colors`:

  ```ts
  bg: '#0A0A0A',
  surface: '#141414',
  'surface-alt': '#1F1F1F',
  'surface-deep': '#0F0F0F',
  border: '#2A2A2A',
  fg: '#F5F5F5',
  'fg-secondary': '#C9C9CD',
  muted: '#8A8A93',
  brand: '#E10600',
  ```

Or use inline `style={{ backgroundColor: '#141414' }}` literals (worse but works).

---

---

## Chunk 01 — Tokens + cover preset constants

**Files:**

- Create: `packages/ui/src/garage-tokens.ts`
- Create: `packages/shared/src/garage-covers.ts`
- Create: `packages/shared/src/__tests__/garage-covers.test.ts`
- Modify: `packages/ui/src/index.ts` (export `garageTokens`)
- Modify: `packages/shared/src/index.ts` if it exists; otherwise add direct subpath export via `package.json` exports field (verify before adding)

Locked-contract impact: none. Pure additive constants.

### Step 1.1 — Write the failing test for `garageCoverPresetSchema`

- [ ] Create `packages/shared/src/__tests__/garage-covers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { GARAGE_COVER_PRESETS, garageCoverPresetSchema } from '../garage-covers.js';

describe('garageCoverPresetSchema', () => {
  it('accepts every catalog slug', () => {
    for (const preset of GARAGE_COVER_PRESETS) {
      expect(garageCoverPresetSchema.parse(preset.slug)).toBe(preset.slug);
    }
  });

  it('rejects an unknown slug', () => {
    expect(() => garageCoverPresetSchema.parse('not-a-real-cover')).toThrow();
  });

  it('exposes exactly one non-premium preset (default-door)', () => {
    const free = GARAGE_COVER_PRESETS.filter((p) => !p.premium);
    expect(free).toHaveLength(1);
    expect(free[0]?.slug).toBe('default-door');
  });

  it('every premium preset has a stable hex stripe + label', () => {
    for (const preset of GARAGE_COVER_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.stripe).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
```

### Step 1.2 — Run test to verify it fails

Run: `pnpm --filter @ccc/shared test -- garage-covers`
Expected: FAIL with "Cannot find module" or similar resolution error.

### Step 1.3 — Implement `garage-covers.ts`

- [ ] Create `packages/shared/src/garage-covers.ts`:

```ts
import { z } from 'zod';

// 9 curated covers + 1 free default. Slugs are the wire format and travel
// over the API verbatim. Hex stripe + hues drive the CSS-rendered prototype;
// production swaps these placeholders for R2 artwork under
// `garage-cover-presets/<slug>@2x.{jpg,webp}` but the slug list stays here.
// Slug list matches the bundled source artwork in `docs/assets/garage-covers/`.
// 7 covers ship at 3392×1248 PNG; 3 (autobahn-blue, vintage-meet, monaco-marble)
// ship as 1024×377 JPEG placeholders — regen at 3840×1440 before R2 upload.
// See docs/assets/garage-covers/README.md for the upload pipeline.
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
    stripe: '#E10600',
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
  slug: string;
  label: string;
  premium: boolean;
  hues: readonly [string, string];
  stripe: string;
}>;

const slugs = GARAGE_COVER_PRESETS.map((p) => p.slug) as [string, ...string[]];
export const garageCoverPresetSchema = z.enum(slugs);
export type GarageCoverPresetSlug = z.infer<typeof garageCoverPresetSchema>;

export const GARAGE_COVER_PRESET_SLUGS: ReadonlySet<string> = new Set(slugs);

// Renderer precedence — used by GarageCover + SSR view + admin twin.
// Source of truth so the gating rule lives in exactly one place.
export const resolveGarageCoverSlug = (
  coverPreset: string | null,
  coverImageUrl: string | null,
  isPremiumActive: boolean,
): { kind: 'preset'; slug: string } | { kind: 'url'; url: string } => {
  if (isPremiumActive && coverImageUrl) return { kind: 'url', url: coverImageUrl };
  if (
    coverPreset &&
    (coverPreset === 'default-door' || isPremiumActive) &&
    GARAGE_COVER_PRESET_SLUGS.has(coverPreset)
  ) {
    return { kind: 'preset', slug: coverPreset };
  }
  return { kind: 'preset', slug: 'default-door' };
};
```

### Step 1.4 — Run test to verify pass

Run: `pnpm --filter @ccc/shared test -- garage-covers`
Expected: PASS, 4 tests green.

### Step 1.5 — Implement `garage-tokens.ts`

- [ ] Create `packages/ui/src/garage-tokens.ts`:

```ts
// Additive tokens for the garage redesign. Values are locked in
// `.handoffs/design-handoff/design_handoff_garage_redesign/IMPLEMENTATION.md` §3.2.
// Contrast vs `#0A0A0A` text: gold 9.6:1, silver 9.0:1, bronze 5.4:1 — all WCAG AA.

export const garageTokens = {
  // Tier system — drives PremiumBadge V2, IdentityCard accent line,
  // PremiumSheet hero, CoverPicker locked-pip color.
  tier: {
    bronze: '#C58A52',
    bronzeDeep: '#7A4F2E',
    bronzeTint: 'rgba(197,138,82,0.14)',
    silver: '#D6D8DC',
    silverDeep: '#7C8088',
    silverTint: 'rgba(214,216,220,0.14)',
    gold: '#E8B339',
    goldDeep: '#8C6712',
    goldTint: 'rgba(232,179,57,0.16)',
  },
  // Paint system — drives ParkingStallCard rails + tape + chevron + plate.
  paint: {
    free: '#9AA0AC',
    extra: '#E8B339',
    adminGrant: '#4AD4E0',
    asphalt: '#15161A',
    asphaltLine: '#2C2D32',
  },
  // Surface ramp — used by sheets, identity card, stall metadata band.
  surface: {
    base: '#0A0A0A',
    sheet: '#141414',
    alt: '#1F1F1F',
    deep: '#0F0F0F',
    border: '#2A2A2A',
    borderStrong: '#3A3A3A',
  },
  // Brand ramp — keeps the legacy #E10600 alongside derived alts for
  // gradients, glows, and tinted backgrounds.
  brand: {
    base: '#E10600',
    deep: '#A30400',
    soft: '#FF1A0D',
    tint: 'rgba(225,6,0,0.12)',
  },
} as const;

export type GarageTokens = typeof garageTokens;
export type GaragePremiumTier = 'bronze' | 'silver' | 'gold';

export const tierColors = (tier: GaragePremiumTier | null) => {
  if (tier === 'gold')
    return {
      main: garageTokens.tier.gold,
      deep: garageTokens.tier.goldDeep,
      tint: garageTokens.tier.goldTint,
      label: 'Premium Gold',
    };
  if (tier === 'silver')
    return {
      main: garageTokens.tier.silver,
      deep: garageTokens.tier.silverDeep,
      tint: garageTokens.tier.silverTint,
      label: 'Premium Silver',
    };
  if (tier === 'bronze')
    return {
      main: garageTokens.tier.bronze,
      deep: garageTokens.tier.bronzeDeep,
      tint: garageTokens.tier.bronzeTint,
      label: 'Premium Bronze',
    };
  return {
    main: garageTokens.brand.base,
    deep: garageTokens.brand.deep,
    tint: garageTokens.brand.tint,
    label: 'Premium',
  };
};
```

### Step 1.6 — Export from `@ccc/ui` index

- [ ] Edit `packages/ui/src/index.ts`, append:

```ts
export {
  garageTokens,
  tierColors,
  type GarageTokens,
  type GaragePremiumTier,
} from './garage-tokens.js';
```

### Step 1.7 — Build + verify both packages

Run: `pnpm --filter @ccc/shared build && pnpm --filter @ccc/ui typecheck && pnpm --filter @ccc/shared test`
Expected: builds clean, tests pass.

### Step 1.8 — Commit

```bash
git add packages/ui/src/garage-tokens.ts \
        packages/shared/src/garage-covers.ts \
        packages/shared/src/__tests__/garage-covers.test.ts \
        packages/ui/src/index.ts
git commit -m "$(cat <<'EOF'
feat(garage): add tier/paint tokens + cover preset catalog

Additive tokens unblock PremiumBadge V2 and ParkingStallCard. Cover
preset catalog is the wire format for /me/garage/cover.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 02 — Schema migration + zod extension

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (Garage model)
- Create: `packages/db/prisma/migrations/<timestamp>_garage_cover/migration.sql`
- Modify: `packages/shared/src/garage.ts`
- Modify: `packages/shared/src/garage-public.ts`
- Modify: `packages/shared/src/__tests__/garage.test.ts` (extend existing)

Locked-contract impact: schema add only; both new columns NULL-safe; no data backfill needed.

### Step 2.1 — Write failing zod tests

- [ ] Edit `packages/shared/src/__tests__/garage.test.ts`, append:

```ts
describe('garageOwnerSchema (cover)', () => {
  it('accepts coverPreset + coverImageUrl + daysLeftUntilExpiry', () => {
    const parsed = garageOwnerSchema.parse({
      id: 'g1',
      name: 'Garagem',
      slug: 'user-12345678',
      description: null,
      isPublic: false,
      premiumTier: null,
      premiumUntil: null,
      isPremiumActive: false,
      coverPreset: 'tokyo-wangan',
      coverImageUrl: null,
      daysLeftUntilExpiry: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.coverPreset).toBe('tokyo-wangan');
    expect(parsed.daysLeftUntilExpiry).toBeNull();
  });

  it('rejects an unknown coverPreset slug', () => {
    expect(() =>
      garageOwnerSchema.parse({
        id: 'g1',
        name: 'Garagem',
        slug: 'user-12345678',
        description: null,
        isPublic: false,
        premiumTier: null,
        premiumUntil: null,
        isPremiumActive: false,
        coverPreset: 'totally-fake',
        coverImageUrl: null,
        daysLeftUntilExpiry: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it('rejects coverImageUrl outside garage-cover/ prefix', () => {
    expect(() =>
      garageOwnerSchema.parse({
        id: 'g1',
        name: 'Garagem',
        slug: 'user-12345678',
        description: null,
        isPublic: false,
        premiumTier: null,
        premiumUntil: null,
        isPremiumActive: false,
        coverPreset: null,
        coverImageUrl: 'https://r2.example.com/cars/x.jpg',
        daysLeftUntilExpiry: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});

describe('garagePatchSchema (cover)', () => {
  it('accepts coverPreset null (reset to default)', () => {
    const parsed = garagePatchSchema.parse({ coverPreset: null });
    expect(parsed.coverPreset).toBeNull();
  });

  it('accepts a known preset slug', () => {
    expect(garagePatchSchema.parse({ coverPreset: 'tokyo-wangan' }).coverPreset).toBe(
      'tokyo-wangan',
    );
  });

  it('rejects an unknown preset slug', () => {
    expect(() => garagePatchSchema.parse({ coverPreset: 'bogus' })).toThrow();
  });
});
```

### Step 2.2 — Run failing test

Run: `pnpm --filter @ccc/shared test -- garage`
Expected: FAIL (schema doesn't carry the new fields yet).

### Step 2.3 — Extend `garageOwnerSchema` + `garagePatchSchema`

- [ ] Edit `packages/shared/src/garage.ts`. Add import at top:

```ts
import { garageCoverPresetSchema } from './garage-covers.js';
```

- [ ] Edit `garageOwnerSchema` — add three keys before `createdAt`:

```ts
  coverPreset: garageCoverPresetSchema.nullable(),
  coverImageUrl: z.string().url().regex(/\/garage-cover\//).nullable(),
  daysLeftUntilExpiry: z.number().int().nonnegative().nullable(),
```

- [ ] Replace `garagePatchSchema` definition with:

```ts
export const garagePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric or hyphen'),
    description: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().min(1).max(500).nullable(),
    ),
    isPublic: z.boolean(),
    coverPreset: garageCoverPresetSchema.nullable(),
    coverImageUrl: z
      .string()
      .url()
      .regex(/\/garage-cover\//)
      .nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
```

### Step 2.4 — Extend `garagePublicProfileSchema`

- [ ] Edit `packages/shared/src/garage-public.ts`, add import + extend schema:

```ts
import { garageCoverPresetSchema } from './garage-covers.js';

export const garagePublicProfileSchema = z.object({
  name: z.string().min(1).max(50),
  slug: z.string().min(1).max(40),
  description: z.string().max(500).nullable(),
  premiumTier: garagePremiumTierSchema.nullable(),
  isPremiumActive: z.boolean(),
  coverPreset: garageCoverPresetSchema.nullable(),
  coverImageUrl: z.string().url().nullable(),
});
```

### Step 2.5 — Run zod test pass

Run: `pnpm --filter @ccc/shared test -- garage`
Expected: PASS (all new + existing tests green).

### Step 2.6 — Prisma migration

- [ ] Edit `packages/db/prisma/schema.prisma`, extend `Garage` model. After `description` add:

```prisma
  coverPreset   String?  @db.VarChar(40)
  coverImageUrl String?  @db.VarChar(500)
```

- [ ] Generate the migration:

```bash
pnpm --filter @ccc/db prisma migrate dev --name garage_cover --create-only
```

- [ ] Open the generated SQL file under `packages/db/prisma/migrations/` and verify it is exactly:

```sql
ALTER TABLE "Garage"
  ADD COLUMN "coverPreset" VARCHAR(40),
  ADD COLUMN "coverImageUrl" VARCHAR(500);
```

If the generator added anything else (e.g. dropping/creating indexes unrelated to this change), abort, investigate the schema diff, and rerun. **Do not commit a migration that touches unrelated structures.**

### Step 2.7 — Apply the migration locally + generate client

```bash
pnpm --filter @ccc/db prisma migrate deploy
pnpm --filter @ccc/db prisma generate
pnpm --filter @ccc/shared build
```

### Step 2.8 — Run the existing api tests that touch GarageOwner serialization

Run: `pnpm --filter @ccc/api test -- garage/me-garage garage/public-garage`
Expected: PASS. (Serializer still returns old shape; new keys are optional in zod — wait, they are NOT optional, they are nullable. We added them to `garageOwnerSchema` as required+nullable. Serializer test will FAIL on schema parse.)

If FAIL, that means we have to land the serializer extension in this same PR. Continue:

### Step 2.9 — Extend serializer (sub-step, lives in same PR to keep tests green)

- [ ] Edit `apps/api/src/services/garage/index.ts`. Replace the existing `GarageOwnerSerialized` type + `serializeGarageOwner` function with:

```ts
export type GarageOwnerSerialized = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isPublic: boolean;
  premiumTier: Garage['premiumTier'];
  premiumUntil: string | null;
  isPremiumActive: boolean;
  coverPreset: string | null;
  coverImageUrl: string | null;
  daysLeftUntilExpiry: number | null;
  createdAt: string;
  updatedAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const computeDaysLeftUntilExpiry = (
  premiumUntil: Garage['premiumUntil'],
  now: Date = new Date(),
): number | null => {
  if (!premiumUntil) return null;
  const ms = premiumUntil.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
};

export const serializeGarageOwner = (g: Garage): GarageOwnerSerialized => {
  const isPremiumActive = computeIsPremiumActive(g.premiumTier, g.premiumUntil);
  return {
    id: g.id,
    name: g.name,
    slug: g.slug,
    description: g.description,
    isPublic: g.isPublic,
    premiumTier: g.premiumTier,
    premiumUntil: g.premiumUntil ? g.premiumUntil.toISOString() : null,
    isPremiumActive,
    coverPreset: g.coverPreset,
    coverImageUrl: g.coverImageUrl,
    daysLeftUntilExpiry: isPremiumActive ? computeDaysLeftUntilExpiry(g.premiumUntil) : null,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
};
```

- [ ] Replace `GaragePublicSerialized` + `serializeGaragePublic` with:

```ts
export type GaragePublicSerialized = {
  name: string;
  slug: string;
  description: string | null;
  premiumTier: Garage['premiumTier'];
  isPremiumActive: boolean;
  coverPreset: string | null;
  coverImageUrl: string | null;
};

export const serializeGaragePublic = (g: Garage): GaragePublicSerialized => {
  const isPremiumActive = computeIsPremiumActive(g.premiumTier, g.premiumUntil);
  // Lapse rule: when premium is inactive, custom cover is hidden. DB row
  // stays intact so re-activation restores the choice. Renderer-side gate.
  const coverImageUrl = isPremiumActive ? g.coverImageUrl : null;
  const coverPreset = isPremiumActive
    ? g.coverPreset
    : g.coverPreset === 'default-door'
      ? g.coverPreset
      : null;
  return {
    name: g.name,
    slug: g.slug,
    description: g.description,
    premiumTier: g.premiumTier,
    isPremiumActive,
    coverPreset,
    coverImageUrl,
  };
};
```

Note: the owner-side payload exposes the raw stored values (so the picker shows what the user previously chose even while lapsed); the public-side payload applies the lapse mask. Verify this matches `IMPLEMENTATION.md` §2.2 lapse rule.

### Step 2.10 — Tests pass

Run: `pnpm --filter @ccc/api test -- garage`
Expected: PASS.

### Step 2.11 — Add a serializer-specific test for the lapse rule

- [ ] Append to `apps/api/test/garage/me-garage.test.ts` (or create `apps/api/test/garage/cover-lapse.test.ts` if `me-garage.test.ts` is already crowded — verify file length first):

```ts
import { describe, it, expect } from 'vitest';
import { serializeGarageOwner, serializeGaragePublic } from '../../src/services/garage/index.js';

const baseGarage = (overrides: Partial<Parameters<typeof serializeGarageOwner>[0]> = {}) => ({
  id: 'g1',
  userId: 'u1',
  name: 'Garagem',
  slug: 'user-12345678',
  description: null,
  isPublic: true,
  premiumTier: null as 'gold' | 'silver' | 'bronze' | null,
  premiumUntil: null as Date | null,
  coverPreset: null as string | null,
  coverImageUrl: null as string | null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('cover lapse', () => {
  it('owner payload exposes raw cover even while lapsed', () => {
    const owner = serializeGarageOwner(
      baseGarage({
        premiumTier: 'gold',
        premiumUntil: new Date('2024-01-01T00:00:00Z'), // past
        coverPreset: 'tokyo-wangan',
        coverImageUrl: 'https://r2.example.com/garage-cover/u1/abc.jpg',
      }) as any,
    );
    expect(owner.isPremiumActive).toBe(false);
    expect(owner.coverPreset).toBe('tokyo-wangan');
    expect(owner.coverImageUrl).toBe('https://r2.example.com/garage-cover/u1/abc.jpg');
  });

  it('public payload masks custom cover when lapsed', () => {
    const pub = serializeGaragePublic(
      baseGarage({
        premiumTier: 'gold',
        premiumUntil: new Date('2024-01-01T00:00:00Z'),
        coverPreset: 'tokyo-wangan',
        coverImageUrl: 'https://r2.example.com/garage-cover/u1/abc.jpg',
      }) as any,
    );
    expect(pub.isPremiumActive).toBe(false);
    expect(pub.coverPreset).toBeNull();
    expect(pub.coverImageUrl).toBeNull();
  });

  it('public payload keeps default-door when lapsed (still a free option)', () => {
    const pub = serializeGaragePublic(
      baseGarage({
        premiumTier: 'gold',
        premiumUntil: new Date('2024-01-01T00:00:00Z'),
        coverPreset: 'default-door',
      }) as any,
    );
    expect(pub.coverPreset).toBe('default-door');
  });
});
```

Run: `pnpm --filter @ccc/api test -- cover-lapse` (or the file you appended to).
Expected: PASS.

### Step 2.12 — Commit

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/ \
        packages/shared/src/garage.ts \
        packages/shared/src/garage-public.ts \
        packages/shared/src/__tests__/garage.test.ts \
        apps/api/src/services/garage/index.ts \
        apps/api/test/garage/
git commit -m "$(cat <<'EOF'
feat(db,shared,api): add Garage.coverPreset + coverImageUrl

Additive columns + zod fields + serializer extensions. Public payload
masks custom cover during premium lapse; owner payload exposes raw
values so the picker restores the prior choice on re-activation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify CI green before chunk 03.

---

## Chunk 03 — Cover API endpoints + UploadKind extension

**Files:**

- Modify: `apps/api/src/services/uploads/types.ts`
- Modify: `apps/api/src/services/uploads/index.ts` (R2 + Dev impls — verify path scheme matches `garage-cover/<userId>/`)
- Modify: `packages/shared/src/uploads.ts` (extend `UploadKind` zod enum)
- Modify: `apps/api/src/routes/uploads.ts` (no extra gate — `garage_cover` is per-authenticated-user)
- Modify: `apps/api/src/routes/garage.ts` (register `PATCH /me/garage/cover` + reuse upload presign)
- Create: `apps/api/src/services/garage/cover.ts` (validation + premium gate + audit emit)
- Create: `apps/api/test/garage/cover.test.ts` (integration, real Postgres)

Locked-contract impact: rate-limit on cover PATCH (5/min/user) — anti-abuse for upload thrash.

### Step 3.1 — Extend `UploadKind` (api type + shared zod)

- [ ] Edit `apps/api/src/services/uploads/types.ts` — add `'garage_cover'`:

```ts
export type UploadKind =
  | 'avatar'
  | 'car_photo'
  | 'event_cover'
  | 'feed_photo'
  | 'product_photo'
  | 'support_attachment'
  | 'garage_cover';
```

- [ ] Edit `packages/shared/src/uploads.ts` (presignRequestSchema lives here — grep to confirm; extend its enum). Pattern is identical to the type union above.

### Step 3.2 — Wire `garage_cover` into both R2 + Dev upload impls

- [ ] Edit `apps/api/src/services/uploads/index.ts` — find the per-kind path/cache-control switch and add a case for `garage_cover`. Convention `garage-cover/<userId>/<random>.<ext>` (matches the existing `car-photo/<userId>/…` pattern).
- [ ] Use the helper that already builds object keys for other kinds; do not invent a new path-builder.
- [ ] Verify `isOwnedKey` returns true for `garage-cover/<userId>/…` calls.
- [ ] Allow image content types only: `image/jpeg`, `image/png`, `image/webp`.

### Step 3.3 — Write failing integration test

- [ ] Create `apps/api/test/garage/cover.test.ts`. Use the real helpers from `apps/api/test/helpers.ts` (`makeApp`, `resetDatabase`, `createUser`, `bearer`); set garage premium state via direct `prisma.garage.update` since `createUser` does not parameterize premium:

```ts
import { prisma } from '@ccc/db';
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { makeApp, resetDatabase, createUser, bearer } from '../helpers.js';

const setGaragePremium = async (userId: string, tier: 'gold' | 'silver' | 'bronze' = 'gold') =>
  prisma.garage.update({
    where: { userId },
    data: { premiumTier: tier, premiumUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });

describe('PATCH /me/garage/cover', () => {
  const app = makeApp();
  beforeAll(() => app.ready());
  afterAll(() => app.close());
  beforeEach(() => resetDatabase());

  it('sets default-door for free users', async () => {
    const { id } = await createUser();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: bearer(id),
      payload: { coverPreset: 'default-door' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().garage.coverPreset).toBe('default-door');
  });

  it('rejects a premium preset for free users with 400 premium_required', async () => {
    const { id } = await createUser();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: bearer(id),
      payload: { coverPreset: 'tokyo-wangan' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('premium_required');
  });

  it('accepts a premium preset for premium users', async () => {
    const { id } = await createUser();
    await setGaragePremium(id);
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: bearer(id),
      payload: { coverPreset: 'tokyo-wangan' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().garage.coverPreset).toBe('tokyo-wangan');
  });

  it('rejects a coverImageObjectKey outside garage-cover/<userId>/', async () => {
    const { id } = await createUser();
    await setGaragePremium(id);
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: bearer(id),
      payload: { coverImageObjectKey: 'cars/abc.jpg' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts coverImageObjectKey scoped to the owner', async () => {
    const { id } = await createUser();
    await setGaragePremium(id);
    const objectKey = `garage-cover/${id}/abc.jpg`;
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: bearer(id),
      payload: { coverImageObjectKey: objectKey },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().garage.coverImageObjectKey).toBe(objectKey);
    // Serializer hydrates a coverImageUrl from the object key.
    expect(res.json().garage.coverImageUrl).toMatch(/garage-cover\//);
  });

  it('rejects coverImageObjectKey belonging to another user', async () => {
    const owner = await createUser();
    const other = await createUser();
    await setGaragePremium(owner.id);
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: bearer(owner.id),
      payload: { coverImageObjectKey: `garage-cover/${other.id}/abc.jpg` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('clears cover when coverPreset: null', async () => {
    const { id } = await createUser();
    await setGaragePremium(id);
    await prisma.garage.update({ where: { userId: id }, data: { coverPreset: 'tokyo-wangan' } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers: bearer(id),
      payload: { coverPreset: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().garage.coverPreset).toBeNull();
  });

  it('rate-limits at 5 requests / minute / user', async () => {
    const { id } = await createUser();
    await setGaragePremium(id);
    const headers = bearer(id);
    for (let i = 0; i < 5; i++) {
      const ok = await app.inject({
        method: 'PATCH',
        url: '/me/garage/cover',
        headers,
        payload: { coverPreset: 'tokyo-wangan' },
      });
      expect(ok.statusCode).toBe(200);
    }
    const sixth = await app.inject({
      method: 'PATCH',
      url: '/me/garage/cover',
      headers,
      payload: { coverPreset: 'tokyo-wangan' },
    });
    expect(sixth.statusCode).toBe(429);
  });
});
```

Note: this test assumes `Garage.coverImageObjectKey` is the new column (server resolves it to a public URL on read) — see chunk 02 schema decision. The serializer returns BOTH `coverImageObjectKey` (raw) and `coverImageUrl` (resolved).

### Step 3.4 — Run failing test

Run: `pnpm --filter @ccc/api test -- garage/cover`
Expected: FAIL — route not registered.

### Step 3.5 — Implement `cover.ts` service

- [ ] Create `apps/api/src/services/garage/cover.ts`:

```ts
import type { Garage } from '@prisma/client';
import { GARAGE_COVER_PRESETS, GARAGE_COVER_PRESET_SLUGS } from '@ccc/shared/garage-covers';

import { computeIsPremiumActive } from './index.js';

export type CoverPatch = { coverPreset: string | null } | { coverImageUrl: string | null };

const PREMIUM_PRESET_SLUGS = new Set(
  GARAGE_COVER_PRESETS.filter((p) => p.premium).map((p) => p.slug),
);

export type CoverValidation =
  | { ok: true; field: 'coverPreset' | 'coverImageUrl'; value: string | null }
  | { ok: false; status: 400; error: 'premium_required' | 'invalid_cover' };

export const validateCoverPatch = (
  garage: Pick<Garage, 'userId' | 'premiumTier' | 'premiumUntil'>,
  patch: CoverPatch,
): CoverValidation => {
  const isPremium = computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);

  if ('coverPreset' in patch) {
    const slug = patch.coverPreset;
    if (slug === null) return { ok: true, field: 'coverPreset', value: null };
    if (!GARAGE_COVER_PRESET_SLUGS.has(slug))
      return { ok: false, status: 400, error: 'invalid_cover' };
    if (PREMIUM_PRESET_SLUGS.has(slug) && !isPremium)
      return { ok: false, status: 400, error: 'premium_required' };
    return { ok: true, field: 'coverPreset', value: slug };
  }

  // coverImageUrl branch
  const url = patch.coverImageUrl;
  if (url === null) return { ok: true, field: 'coverImageUrl', value: null };
  if (!isPremium) return { ok: false, status: 400, error: 'premium_required' };
  // Must be R2-public-ish URL with garage-cover/<userId>/ prefix in the path.
  // We don't restrict the host (R2 + dev have different hostnames) — only the
  // path token. URL parsing keeps a bogus host from sneaking past the regex.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 400, error: 'invalid_cover' };
  }
  const expected = `/garage-cover/${garage.userId}/`;
  if (!parsed.pathname.startsWith(expected))
    return { ok: false, status: 400, error: 'invalid_cover' };
  return { ok: true, field: 'coverImageUrl', value: url };
};
```

### Step 3.6 — Register route

- [ ] Edit `apps/api/src/routes/garage.ts`. Inside the existing scoped block that registers PATCH `/me/garage` (so it shares the auth + reuses rate-limit infrastructure), or in a sibling scoped block — choose whichever keeps both rate limiters readable. Add:

```ts
await app.register(async (scoped) => {
  scoped.addHook('preHandler', app.authenticate);
  await scoped.register(rateLimit, {
    max: 5,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request) => {
      const user = request.user as { sub: string } | undefined;
      return `garage-cover:${user?.sub ?? request.ip}`;
    },
  });

  scoped.patch('/me/garage/cover', async (request, reply) => {
    const { sub } = requireUser(request);
    const patch = garagePatchSchema.parse(request.body);
    const keys = Object.keys(patch);
    if (keys.length !== 1 || (keys[0] !== 'coverPreset' && keys[0] !== 'coverImageUrl')) {
      return reply.status(400).send({ error: 'invalid_cover' });
    }

    const existing = await ensureGarageForUser(sub);
    const validation = validateCoverPatch(existing, patch as CoverPatch);
    if (!validation.ok) {
      return reply.status(validation.status).send({ error: validation.error });
    }

    // Mutual exclusion at write: setting coverImageUrl always clears coverPreset
    // (keeps the renderer's precedence rule unambiguous in storage). Same the
    // other way around: setting coverPreset clears coverImageUrl.
    const data =
      validation.field === 'coverPreset'
        ? { coverPreset: validation.value, coverImageUrl: null }
        : { coverImageUrl: validation.value, coverPreset: null };

    const updated = await prisma.garage.update({ where: { userId: sub }, data });
    return { garage: serializeGarageOwner(updated) };
  });
});
```

Add the imports:

```ts
import { validateCoverPatch, type CoverPatch } from '../services/garage/cover.js';
```

### Step 3.7 — Run all garage tests

Run: `pnpm --filter @ccc/api test -- garage`
Expected: PASS.

### Step 3.8 — Smoke-check pre-signed upload manually

Quick exercise from a REST client to make sure `garage_cover` presign returns a URL with `garage-cover/<userId>/` prefix:

```bash
curl -X POST http://localhost:4000/uploads/presign \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{"kind":"garage_cover","contentType":"image/jpeg","size":1000000}'
```

Expected: 200 with `objectKey` starting `garage-cover/<userId>/`.

### Step 3.9 — Commit

```bash
git add apps/api/src/services/uploads/ \
        packages/shared/src/uploads.ts \
        apps/api/src/services/garage/cover.ts \
        apps/api/src/routes/garage.ts \
        apps/api/test/garage/cover.test.ts \
        apps/api/test/helpers/
git commit -m "$(cat <<'EOF'
feat(api): cover endpoints + garage_cover upload kind

PATCH /me/garage/cover (5/min/user) + premium gating + per-user R2
path scoping. Writes are mutually exclusive: setting a preset clears
the custom URL and vice-versa, so the renderer precedence is
unambiguous in storage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 04 — PremiumBadge V2 + PremiumSheet (shared UI)

**Files:**

- Modify: `packages/ui/src/PremiumBadge.tsx`
- Create: `packages/ui/src/PremiumSheet.tsx`
- Create: `packages/ui/src/SheetShell.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/mobile/src/screens/garage/__tests__/PremiumBadge.test.tsx`

Locked-contract impact: callers passing `isPremiumActive !== true` still get `null`. Adding the V2 variant is additive.

Visual canon: see `.handoffs/design-handoff/design_handoff_garage_redesign/jdma-garage/atoms.jsx` `PremiumBadgeV2` (lines 220-253) + `screens.jsx` `PremiumSheet` (lines 546-627). Use those as the pixel reference.

### Step 4.1 — Extend `PremiumBadge` props (failing test)

- [ ] Edit `apps/mobile/src/screens/garage/__tests__/PremiumBadge.test.tsx`. Add:

```tsx
import { render, fireEvent } from '@testing-library/react-native';
import { PremiumBadge } from '@ccc/ui';

describe('PremiumBadge V2', () => {
  it('renders tier label (Gold) for gold premium', () => {
    const { getByText } = render(<PremiumBadge isPremiumActive tier="gold" size="md" />);
    expect(getByText('Gold')).toBeTruthy();
  });

  it('renders the near-expiry days block when daysLeftUntilExpiry <= 7', () => {
    const { getByText } = render(
      <PremiumBadge isPremiumActive tier="gold" size="md" daysLeftUntilExpiry={3} />,
    );
    expect(getByText('3d')).toBeTruthy();
  });

  it('omits the days block when daysLeftUntilExpiry > 7', () => {
    const { queryByText } = render(
      <PremiumBadge isPremiumActive tier="gold" size="md" daysLeftUntilExpiry={30} />,
    );
    expect(queryByText('30d')).toBeNull();
  });

  it('invokes onPress when tapped', () => {
    const fn = vi.fn(); // requires: import { describe, expect, it, vi } from 'vitest';
    const { getByRole } = render(
      <PremiumBadge isPremiumActive tier="gold" size="md" onPress={fn} />,
    );
    fireEvent.press(getByRole('button'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns null when isPremiumActive !== true', () => {
    const { toJSON } = render(<PremiumBadge isPremiumActive={false} tier="gold" />);
    expect(toJSON()).toBeNull();
  });
});
```

### Step 4.2 — Run failing test

Run: `pnpm --filter @ccc/mobile test -- PremiumBadge`
Expected: FAIL — V2 visual not implemented.

### Step 4.3 — Rewrite `PremiumBadge.tsx`

- [ ] Replace contents of `packages/ui/src/PremiumBadge.tsx`:

```tsx
import { Pressable, Text, View } from 'react-native';

import { garageTokens, tierColors, type GaragePremiumTier } from './garage-tokens.js';

export interface PremiumBadgeProps {
  isPremiumActive: boolean | null | undefined;
  tier?: GaragePremiumTier | null;
  size?: 'sm' | 'md';
  daysLeftUntilExpiry?: number | null;
  onPress?: () => void;
  className?: string;
}

const heightFor = (size: 'sm' | 'md') => (size === 'md' ? 28 : 24);
const fontSizeFor = (size: 'sm' | 'md') => (size === 'md' ? 11 : 10);
const tierName = (tier: GaragePremiumTier | null | undefined): string => {
  if (tier === 'gold') return 'Gold';
  if (tier === 'silver') return 'Silver';
  if (tier === 'bronze') return 'Bronze';
  return 'Premium';
};

export function PremiumBadge({
  isPremiumActive,
  tier = null,
  size = 'sm',
  daysLeftUntilExpiry = null,
  onPress,
}: PremiumBadgeProps) {
  if (isPremiumActive !== true) return null;

  const t = tierColors(tier);
  const h = heightFor(size);
  const fs = fontSizeFor(size);
  const showDays =
    daysLeftUntilExpiry !== null && daysLeftUntilExpiry > 0 && daysLeftUntilExpiry <= 7;
  const a11yLabel = `${t.label}${showDays ? `, expira em ${daysLeftUntilExpiry} dias` : ''}`;

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'stretch',
        height: h,
        borderRadius: 6,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: `${t.main}66`,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 7,
          backgroundColor: t.main,
        }}
      >
        <Text
          style={{
            color: '#0A0A0A',
            fontSize: fs,
            fontWeight: '700',
            letterSpacing: 1.6,
            textTransform: 'uppercase',
          }}
        >
          {tierName(tier)}
        </Text>
      </View>
      {showDays ? (
        <View style={{ paddingHorizontal: 7, justifyContent: 'center' }}>
          <Text
            style={{
              color: t.main,
              fontSize: fs,
              fontWeight: '700',
              fontVariant: ['tabular-nums'],
            }}
          >
            {daysLeftUntilExpiry}d
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View
        accessibilityLabel={a11yLabel}
        // 44pt tactile region without inflating visual size — center the
        // visible badge inside the larger pressable bounds.
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={{ minHeight: 44, justifyContent: 'center' }}
    >
      {content}
    </Pressable>
  );
}
```

Note: dropped the `Badge` import + Tailwind classes in favor of pure RN styles. The old admin `bg-amber-500` drift dies in chunk 05.

### Step 4.4 — Implement `SheetShell.tsx`

- [ ] Create `packages/ui/src/SheetShell.tsx`:

```tsx
import { Modal, Pressable, ScrollView, Text, View, type ModalProps } from 'react-native';

import { garageTokens } from './garage-tokens.js';

export interface SheetShellProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
}

export function SheetShell({ visible, title, onClose, children, testID }: SheetShellProps) {
  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable
        accessibilityLabel="Fechar"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
      />
      <View
        accessibilityViewIsModal
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: garageTokens.surface.sheet,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          maxHeight: '88%',
          paddingBottom: 24,
        }}
      >
        <View style={{ alignItems: 'center', paddingTop: 6 }}>
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: garageTokens.surface.borderStrong,
            }}
          />
        </View>
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'center',
            borderBottomWidth: 1,
            borderBottomColor: garageTokens.surface.border,
          }}
        >
          <Text
            style={{
              flex: 1,
              color: '#F5F5F5',
              fontSize: 15,
              fontWeight: '700',
            }}
          >
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              backgroundColor: garageTokens.surface.alt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#C9C9CD', fontSize: 18, lineHeight: 18 }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 16 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}
```

### Step 4.5 — Implement `PremiumSheet.tsx`

- [ ] Create `packages/ui/src/PremiumSheet.tsx`. Visual canon: `.handoffs/design-handoff/.../screens.jsx` lines 546-627. Translate the CSS to RN styles:

```tsx
import { Text, View } from 'react-native';

import { SheetShell } from './SheetShell.js';
import { garageTokens, tierColors, type GaragePremiumTier } from './garage-tokens.js';

export interface PremiumSheetProps {
  visible: boolean;
  tier: GaragePremiumTier | null;
  isPremiumActive: boolean;
  daysLeftUntilExpiry: number | null;
  onClose: () => void;
  copy: {
    title: string;
    tierLabel: string; // 'GOLD TIER'
    heroTitle: string; // 'JDM Premium'
    heroBody: string;
    nearExpiry: (n: number) => string; // 'Expira em 3 dias · Renove …'
    benefits: ReadonlyArray<{ title: string; sub: string }>;
    footer: string; // 'Premium nunca limita …'
  };
}

export function PremiumSheet({
  visible,
  tier,
  isPremiumActive,
  daysLeftUntilExpiry,
  onClose,
  copy,
}: PremiumSheetProps) {
  const t = tierColors(tier);
  const showNearExpiry =
    isPremiumActive &&
    daysLeftUntilExpiry !== null &&
    daysLeftUntilExpiry > 0 &&
    daysLeftUntilExpiry <= 7;

  return (
    <SheetShell visible={visible} title={copy.title} onClose={onClose} testID="premium-sheet">
      <View style={{ padding: 16 }}>
        <View
          style={{
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
            borderWidth: 1,
            borderColor: `${t.main}44`,
            backgroundColor: t.tint,
          }}
        >
          <Text
            style={{
              color: t.main,
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 1.6,
              textTransform: 'uppercase',
            }}
          >
            {copy.tierLabel}
          </Text>
          <Text
            style={{
              marginTop: 6,
              color: '#F5F5F5',
              fontSize: 28,
              lineHeight: 30,
              fontWeight: '800',
              letterSpacing: -0.5,
            }}
          >
            {copy.heroTitle}
          </Text>
          <Text
            style={{
              marginTop: 6,
              color: '#C9C9CD',
              fontSize: 12.5,
              lineHeight: 18,
            }}
          >
            {copy.heroBody}
          </Text>

          {showNearExpiry ? (
            <View
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: 'rgba(245,158,11,0.35)',
                backgroundColor: 'rgba(245,158,11,0.10)',
              }}
            >
              <Text style={{ color: '#FFC04A', fontSize: 12 }}>
                {copy.nearExpiry(daysLeftUntilExpiry ?? 0)}
              </Text>
            </View>
          ) : null}
        </View>

        {copy.benefits.map((b) => (
          <View
            key={b.title}
            style={{
              flexDirection: 'row',
              gap: 12,
              padding: 12,
              borderRadius: 12,
              marginBottom: 10,
              backgroundColor: garageTokens.surface.deep,
              borderWidth: 1,
              borderColor: garageTokens.surface.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#F5F5F5', fontSize: 13, fontWeight: '700' }}>{b.title}</Text>
              <Text style={{ color: '#8A8A93', fontSize: 12, marginTop: 2, lineHeight: 17 }}>
                {b.sub}
              </Text>
            </View>
          </View>
        ))}

        <View
          style={{
            marginTop: 4,
            padding: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: garageTokens.surface.border,
          }}
        >
          <Text style={{ color: '#8A8A93', fontSize: 11.5, lineHeight: 17 }}>{copy.footer}</Text>
        </View>
      </View>
    </SheetShell>
  );
}
```

The benefit-row icon is dropped in v1 (Lucide RN icons are stroked SVGs; importing them here adds a dep + complicates the @ccc/ui surface). Caller passes pure text. Visual fidelity is preserved; we can add icons in a follow-up if product asks.

### Step 4.6 — Export from index

- [ ] Edit `packages/ui/src/index.ts`, append:

```ts
export { SheetShell, type SheetShellProps } from './SheetShell.js';
export { PremiumSheet, type PremiumSheetProps } from './PremiumSheet.js';
```

### Step 4.7 — Rebuild `@ccc/ui`

Run: `pnpm --filter @ccc/ui typecheck`
Expected: clean build.

### Step 4.8 — Run mobile test

Run: `pnpm --filter @ccc/mobile test -- PremiumBadge`
Expected: PASS (5 tests).

### Step 4.9 — Add copy entries for premium sheet

- [ ] Edit `apps/mobile/src/copy/garage.ts`. In `ptBR.garage` add:

```ts
    // Premium explainer sheet
    premiumSheetTitle: 'O que é Premium?',
    premiumHeroTitle: 'JDM Premium',
    premiumHeroBody:
      'Premium é uma membresia da sua conta. Aplica-se à garagem inteira — todos os carros recebem o selo automaticamente.',
    premiumTierLabel: (tier: 'gold' | 'silver' | 'bronze') => `${tier.toUpperCase()} TIER`,
    premiumNearExpiry: (n: number) =>
      `Expira em ${n} ${n === 1 ? 'dia' : 'dias'} · Renove para manter sua capa.`,
    premiumBenefits: [
      { title: 'Capas personalizadas', sub: 'Escolha entre 9 cenários ou envie a sua.' },
      { title: 'Selo Premium', sub: 'Aparece nos seus carros em todo o app.' },
      { title: 'Garagem em destaque', sub: 'Suas publicações ganham mais visibilidade no feed.' },
      { title: 'Página pública premium', sub: 'Sem rodapé promocional em /g/<slug>.' },
    ],
    premiumFooter: 'Premium nunca limita o uso da sua garagem. Carros, ingressos e check-in continuam grátis.',
```

Add equivalent EN entries to `en.garage`.

### Step 4.10 — Commit

```bash
git add packages/ui/src/PremiumBadge.tsx \
        packages/ui/src/SheetShell.tsx \
        packages/ui/src/PremiumSheet.tsx \
        packages/ui/src/index.ts \
        apps/mobile/src/screens/garage/__tests__/PremiumBadge.test.tsx \
        apps/mobile/src/copy/garage.ts
git commit -m "$(cat <<'EOF'
feat(ui): PremiumBadge V2 (tier-tinted) + PremiumSheet + SheetShell

V2 replaces the amber-only badge with a tier-tinted split-pill that
encodes tier as text (Gold/Silver/Bronze), not color. Near-expiry adds
an inline days block; tap opens PremiumSheet with benefits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 05 — `@ccc/ui-web` subpath + admin imports from web primitives

**Files:**

- Create: `packages/ui/src/web/index.ts` — web subpath barrel.
- Create: `packages/ui/src/web/PremiumBadge.tsx` — web-safe twin (HTML+Tailwind, NOT React Native).
- Create: `packages/ui/src/web/tokens.ts` — re-export `garageTokens` + `tierColors` (single token source; both renderers read this).
- Modify: `packages/ui/package.json` — add `./web` export subpath.
- Modify: `apps/admin/package.json` — add `@ccc/ui` as workspace dep if absent. Verify before adding.
- Modify: `apps/admin/src/components/premium-badge.tsx` — replace body with `export { PremiumBadge } from '@ccc/ui-web';` (kept as a re-export shim so call-site imports continue to resolve while migrations happen).
- Modify: every admin call site that imports `@/components/premium-badge` → switch path to `~/components/premium-badge` (or directly to `@ccc/ui-web`).

Locked-contract impact: none. Visual parity between mobile RN render + admin web render guaranteed by shared `tierColors` + matching layout grammar.

**Rationale:** `@ccc/ui` exports `react-native` primitives (`View`, `Pressable`, `Text`, etc). Admin is Next.js — importing those without `react-native-web` setup breaks the SSR build. Splitting `@ccc/ui` into a default RN entry + a `/web` subpath is the cleanest fix. Both renderers read the same token source (`@ccc/ui/garage-tokens`), so a token change updates both apps simultaneously.

### Step 5.1 — Add web subpath export to `packages/ui/package.json`

```json
{
  "name": "@ccc/ui",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./garage-tokens": {
      "types": "./dist/garage-tokens.d.ts",
      "import": "./dist/garage-tokens.js"
    },
    "./web": {
      "types": "./dist/web/index.d.ts",
      "import": "./dist/web/index.js"
    }
  }
}
```

### Step 5.2 — Create the web subpath

- [ ] Create `packages/ui/src/web/PremiumBadge.tsx` — same V2 design as the RN component, rendered with HTML elements + Tailwind classes. Reads the shared token table for color values:

```tsx
import { tierColors, type GaragePremiumTier } from '../garage-tokens.js';

export interface PremiumBadgeProps {
  isPremiumActive: boolean | null | undefined;
  tier?: GaragePremiumTier | null;
  size?: 'sm' | 'md';
  daysLeftUntilExpiry?: number | null;
  onPress?: () => void;
}

const heightFor = (size: 'sm' | 'md') => (size === 'md' ? 'h-7' : 'h-6');
const fontSizeFor = (size: 'sm' | 'md') => (size === 'md' ? 'text-[11px]' : 'text-[10px]');
const tierName = (tier: GaragePremiumTier | null | undefined): string => {
  if (tier === 'gold') return 'Gold';
  if (tier === 'silver') return 'Silver';
  if (tier === 'bronze') return 'Bronze';
  return 'Premium';
};

export function PremiumBadge({
  isPremiumActive,
  tier = null,
  size = 'sm',
  daysLeftUntilExpiry = null,
  onPress,
}: PremiumBadgeProps) {
  if (isPremiumActive !== true) return null;
  const t = tierColors(tier);
  const showDays =
    daysLeftUntilExpiry !== null && daysLeftUntilExpiry > 0 && daysLeftUntilExpiry <= 7;
  const a11yLabel = `${t.label}${showDays ? `, expira em ${daysLeftUntilExpiry} dias` : ''}`;

  const inner = (
    <span
      className={`inline-flex items-stretch overflow-hidden rounded ${heightFor(size)}`}
      style={{ borderColor: `${t.main}66`, borderWidth: 1 }}
    >
      <span
        className={`inline-flex items-center px-[7px] font-bold uppercase tracking-widest ${fontSizeFor(size)}`}
        style={{ backgroundColor: t.main, color: '#0A0A0A' }}
      >
        {tierName(tier)}
      </span>
      {showDays ? (
        <span
          className={`inline-flex items-center px-[7px] font-bold ${fontSizeFor(size)} tabular-nums`}
          style={{ color: t.main }}
        >
          {daysLeftUntilExpiry}d
        </span>
      ) : null}
    </span>
  );

  if (!onPress) return <span aria-label={a11yLabel}>{inner}</span>;
  return (
    <button type="button" aria-label={a11yLabel} onClick={onPress} className="inline-flex">
      {inner}
    </button>
  );
}
```

- [ ] Create `packages/ui/src/web/index.ts`:

```ts
export { PremiumBadge, type PremiumBadgeProps } from './PremiumBadge.js';
export { garageTokens, tierColors, type GaragePremiumTier } from '../garage-tokens.js';
```

The web subpath is intentionally minimal in chunk 05. The Conquistas BadgeRow + BadgesSheet + ProfileStats (Phase 2 XP) will add their own web twins to the same subpath when those chunks land — see Conquistas chunk 21 + Phase 2 plan.

### Step 5.3 — Repoint admin call sites

- [ ] If `apps/admin/package.json` does not already depend on `@ccc/ui` as a workspace package, add it:

```json
"dependencies": {
  ...,
  "@ccc/ui": "workspace:*"
}
```

Run: `pnpm install`.

- [ ] Map admin call sites: `git grep -l "from '@/components/premium-badge'\|from '~/components/premium-badge'" apps/admin/`.

- [ ] For each match, replace the import path with `@ccc/ui-web` (or just `@ccc/ui/web` — the subpath form). Drop the relative import.

- [ ] Replace the body of `apps/admin/src/components/premium-badge.tsx` with a thin re-export so any path that was already correctly mapped keeps working:

```tsx
export { PremiumBadge, type PremiumBadgeProps } from '@ccc/ui/web';
```

(Don't delete the file. The re-export shim is intentional.)

### Step 5.4 — Verify

Run:

```bash
pnpm --filter @ccc/ui typecheck && pnpm --filter @ccc/admin build
```

Expected: clean.

Visual smoke: open the admin user-detail page on a premium user. Badge renders pixel-identical to the mobile V2 (tier name in solid block, near-expiry days on the right). If admin uses Tailwind's `font-mono` for the days block but mobile uses `tabular-nums`, both should give the same visual result on common fonts — verify or harmonize.

### Step 5.5 — Commit

```bash
git add packages/ui/src/web/ packages/ui/package.json apps/admin/package.json apps/admin/src/components/
git commit -m "$(cat <<'EOF'
feat(ui,admin): split @ccc/ui into RN + web subpath; admin badges from @ccc/ui/web

@ccc/ui keeps its RN default export. New /web subpath exports HTML+Tailwind
twins of the same components that share the token table with the RN entry.
Admin imports PremiumBadge from @ccc/ui/web; visual + token parity is
guaranteed by the shared `tierColors` source. Eliminates the drift flagged
in UX-Audit F.1 without forcing react-native-web into the admin bundle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 06 — ParkingStallCard + GarageListView swap

**Files:**

- Create: `packages/ui/src/ParkingStallCard.tsx`
- Create: `packages/ui/src/__tests__/ParkingStallCard.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/mobile/src/screens/garage/GarageListView.tsx`
- Modify: `apps/mobile/src/screens/garage/garage-slots.ts` (add slot number derivation if not already)
- Delete: `apps/mobile/src/screens/garage/AddCarPlaceholderCard.tsx`
- Delete: `apps/mobile/src/screens/garage/FillSpotCard.tsx`
- Delete: `apps/mobile/src/screens/garage/BuySpotCard.tsx`
- Delete: `apps/mobile/src/screens/garage/GarageSpotPlaceholderCard.tsx`
- Modify: existing mobile tests that imported the deleted cards

Locked-contract impact: none. Component swap. Slot ordering still server-controlled.

Visual canon: `atoms.jsx` lines 353-559 (`StallFloor`, `FilledStallCard`, `EmptyStallCard`, `BuySpotStallCard`).

### Step 6.1 — Failing test

- [ ] Create `packages/ui/src/__tests__/ParkingStallCard.test.tsx`:

```tsx
import { render, fireEvent } from '@testing-library/react-native';
import { ParkingStallCard } from '../ParkingStallCard.js';

describe('ParkingStallCard', () => {
  it('renders SLOT 01 plate for slotNumber=1', () => {
    const { getByText } = render(
      <ParkingStallCard
        state="empty"
        source="default_free"
        slotNumber={1}
        onPress={() => undefined}
      />,
    );
    expect(getByText('SLOT 01')).toBeTruthy();
  });

  it('renders RESERVADA tape for purchase source', () => {
    const { getByText } = render(
      <ParkingStallCard state="empty" source="purchase" slotNumber={3} onPress={() => undefined} />,
    );
    expect(getByText('RESERVADA')).toBeTruthy();
  });

  it('renders CORTESIA tape for admin_grant source', () => {
    const { getByText } = render(
      <ParkingStallCard
        state="empty"
        source="admin_grant"
        slotNumber={2}
        onPress={() => undefined}
      />,
    );
    expect(getByText('CORTESIA')).toBeTruthy();
  });

  it('renders no tape for default_free', () => {
    const { queryByText } = render(
      <ParkingStallCard
        state="empty"
        source="default_free"
        slotNumber={1}
        onPress={() => undefined}
      />,
    );
    expect(queryByText('RESERVADA')).toBeNull();
    expect(queryByText('CORTESIA')).toBeNull();
  });

  it('renders price label in buy state', () => {
    const { getByText } = render(
      <ParkingStallCard
        state="buy"
        source="default_free"
        slotNumber={3}
        priceLabel="R$ 9,90"
        onPress={() => undefined}
      />,
    );
    expect(getByText('R$ 9,90')).toBeTruthy();
    expect(getByText('À VENDA')).toBeTruthy();
  });

  it('renders year/make/model + PremiumBadge for filled state with premium', () => {
    const car = {
      id: 'c1',
      year: 1991,
      make: 'Nissan',
      model: 'Skyline GT-R',
      nickname: 'Godzilla',
      isPremiumActive: true,
    };
    const { getByText } = render(
      <ParkingStallCard
        state="filled"
        source="default_free"
        slotNumber={1}
        car={car}
        premiumTier="gold"
        onPress={() => undefined}
      />,
    );
    expect(getByText(/1991 Nissan Skyline GT-R/)).toBeTruthy();
    expect(getByText('Gold')).toBeTruthy();
  });

  it('fires onPress when tapped', () => {
    const fn = vi.fn(); // requires: import { describe, expect, it, vi } from 'vitest';
    const { getByRole } = render(
      <ParkingStallCard state="empty" source="default_free" slotNumber={1} onPress={fn} />,
    );
    fireEvent.press(getByRole('button'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

### Step 6.2 — Run failing test

Run: `pnpm --filter @ccc/mobile test -- ParkingStallCard`
Expected: FAIL — module not found.

Note: `@ccc/ui` package has no `test` script. Component tests live under `apps/mobile/src/screens/garage/__tests__/` (mobile vitest workspace). The plan files the tests as `packages/ui/src/__tests__/*` for component co-location, but they execute via the mobile workspace (vitest picks them up via shared config). Verify the workspace test glob covers the path before merging.

### Step 6.3 — Implement `ParkingStallCard.tsx`

- [ ] Create `packages/ui/src/ParkingStallCard.tsx`. Translate the CSS-rendered prototype to RN. The painted U-rails are simple absolutely positioned `View`s with `backgroundColor`. The asphalt texture comes from `react-native-svg`'s `Pattern` — keep it dirt cheap, just two `Line` arrays at 4px spacing — or settle for a flat asphalt color. The HTML uses repeating linear gradients; an RN equivalent is two superimposed SVG patterns. Use `expo-linear-gradient` ONLY if visual diffs vs the prototype are unacceptable.

For v1: ship with a flat asphalt color + the painted rails. Texture is "nice to have", not load-bearing. Document the deviation in a comment.

```tsx
import { Image, Pressable, Text, View } from 'react-native';

import { PremiumBadge } from './PremiumBadge.js';
import { garageTokens, type GaragePremiumTier } from './garage-tokens.js';

export type StallSource = 'default_free' | 'purchase' | 'admin_grant';

export interface ParkingStallCarPayload {
  id: string;
  year: number;
  make: string;
  model: string;
  nickname?: string | null;
  isPremiumActive?: boolean | null;
  photoUrl?: string | null;
}

export interface ParkingStallCardProps {
  slotNumber: number;
  source: StallSource;
  state: 'filled' | 'empty' | 'buy';
  car?: ParkingStallCarPayload;
  premiumTier?: GaragePremiumTier | null;
  daysLeftUntilExpiry?: number | null;
  onBadgePress?: () => void;
  priceLabel?: string;
  onPress: () => void;
  highlight?: boolean;
  testID?: string;
}

const paintFor = (source: StallSource, state: 'filled' | 'empty' | 'buy'): string => {
  if (state === 'buy') return garageTokens.brand.soft;
  if (source === 'purchase') return garageTokens.paint.extra;
  if (source === 'admin_grant') return garageTokens.paint.adminGrant;
  return garageTokens.paint.free;
};

const tapeLabel = (source: StallSource, state: 'filled' | 'empty' | 'buy'): string | null => {
  if (state === 'buy') return 'À VENDA';
  if (source === 'purchase') return 'RESERVADA';
  if (source === 'admin_grant') return 'CORTESIA';
  return null;
};

const subtitleFor = (source: StallSource): string => {
  if (source === 'purchase') return 'Vaga extra disponível';
  if (source === 'admin_grant') return 'Vaga concedida disponível';
  return 'Use uma das suas vagas grátis';
};

export function ParkingStallCard({
  slotNumber,
  source,
  state,
  car,
  premiumTier = null,
  daysLeftUntilExpiry = null,
  onBadgePress,
  priceLabel,
  onPress,
  highlight = false,
  testID,
}: ParkingStallCardProps) {
  const paint = paintFor(source, state);
  const tape = tapeLabel(source, state);
  const slotPlate = `SLOT ${String(slotNumber).padStart(2, '0')}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        state === 'filled' && car
          ? `Vaga ${slotNumber}, ${car.year} ${car.make} ${car.model}`
          : state === 'buy'
            ? 'Comprar vaga adicional'
            : `Vaga ${slotNumber} vazia`
      }
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: garageTokens.surface.sheet,
        borderWidth: 1,
        borderColor: state === 'buy' ? 'rgba(225,6,0,0.4)' : garageTokens.surface.border,
        ...(highlight
          ? {
              borderColor: garageTokens.brand.base,
              shadowColor: garageTokens.brand.base,
              shadowOpacity: 0.55,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 0 },
            }
          : {}),
      })}
    >
      {/* Stall floor */}
      <View
        style={{ height: 116, position: 'relative', backgroundColor: garageTokens.paint.asphalt }}
      >
        {/* Asphalt subtle grid (deviation: flat color in v1 — texture deferred) */}

        {/* Painted rails */}
        <View
          style={{
            position: 'absolute',
            left: 10,
            top: 10,
            bottom: 10,
            width: 3,
            backgroundColor: paint,
            borderRadius: 2,
            opacity: 0.85,
          }}
        />
        <View
          style={{
            position: 'absolute',
            right: 10,
            top: 10,
            bottom: 10,
            width: 3,
            backgroundColor: paint,
            borderRadius: 2,
            opacity: 0.85,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 10,
            height: 3,
            backgroundColor: paint,
            borderRadius: 2,
            opacity: 0.85,
          }}
        />

        {/* Slot plate */}
        <View style={{ position: 'absolute', top: 14, left: 18 }}>
          <Text
            style={{
              color: paint,
              fontFamily: 'JetBrainsMono_600SemiBold',
              fontSize: 11,
              letterSpacing: 1,
            }}
          >
            {slotPlate}
          </Text>
        </View>

        {/* Source tape */}
        {tape ? (
          <View
            style={{
              position: 'absolute',
              top: 12,
              right: 14,
              paddingVertical: 2,
              paddingHorizontal: 7,
              borderRadius: 3,
              borderWidth: 1,
              borderStyle: state === 'buy' ? 'solid' : 'dashed',
              borderColor: paint,
              backgroundColor:
                state === 'buy'
                  ? garageTokens.brand.tint
                  : source === 'purchase'
                    ? 'rgba(232,179,57,0.18)'
                    : 'rgba(74,212,224,0.18)',
            }}
          >
            <Text style={{ color: paint, fontSize: 9, fontWeight: '700', letterSpacing: 1.4 }}>
              {tape}
            </Text>
          </View>
        ) : null}

        {/* Center content per state */}
        {state === 'filled' && car ? (
          <View
            style={{
              position: 'absolute',
              left: 22,
              right: 22,
              top: 36,
              bottom: 18,
              borderRadius: 10,
              overflow: 'hidden',
              backgroundColor: '#2A2A2A',
            }}
          >
            {car.photoUrl ? (
              <Image source={{ uri: car.photoUrl }} style={{ width: '100%', height: '100%' }} />
            ) : null}
          </View>
        ) : null}

        {state === 'empty' || state === 'buy' ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                borderWidth: 1.5,
                borderStyle: state === 'buy' ? 'solid' : 'dashed',
                borderColor: state === 'buy' ? garageTokens.brand.base : paint,
                backgroundColor:
                  state === 'buy' ? garageTokens.brand.tint : 'rgba(255,255,255,0.02)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: paint, fontSize: 22, lineHeight: 22 }}>+</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Metadata band */}
      <View
        style={{
          paddingTop: 10,
          paddingBottom: 12,
          paddingHorizontal: 14,
          backgroundColor: garageTokens.surface.deep,
          borderTopWidth: 1,
          borderTopColor: garageTokens.surface.border,
        }}
      >
        {state === 'filled' && car ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text
                style={{
                  flex: 1,
                  color: '#F5F5F5',
                  fontSize: 14,
                  fontWeight: '700',
                  letterSpacing: -0.1,
                }}
                numberOfLines={1}
              >
                {car.year} {car.make} {car.model}
              </Text>
              {car.isPremiumActive ? (
                <PremiumBadge
                  isPremiumActive
                  tier={premiumTier}
                  size="sm"
                  daysLeftUntilExpiry={daysLeftUntilExpiry}
                  onPress={onBadgePress}
                />
              ) : null}
            </View>
            {car.nickname ? (
              <Text style={{ color: '#8A8A93', fontSize: 12, marginTop: 2 }}>{car.nickname}</Text>
            ) : null}
          </>
        ) : null}

        {state === 'empty' ? (
          <>
            <Text style={{ color: '#F5F5F5', fontSize: 14, fontWeight: '600' }}>
              Adicionar Carro
            </Text>
            <Text style={{ color: '#8A8A93', fontSize: 12, marginTop: 2 }}>
              {subtitleFor(source)}
            </Text>
          </>
        ) : null}

        {state === 'buy' ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: '#F5F5F5', fontSize: 14, fontWeight: '700' }}>
                Comprar Vaga Adicional
              </Text>
              <Text style={{ color: '#8A8A93', fontSize: 12, marginTop: 2 }}>
                Vaga extra para outro carro
              </Text>
            </View>
            {priceLabel ? (
              <Text style={{ color: '#F5F5F5', fontSize: 15, fontWeight: '700' }}>
                {priceLabel}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
```

### Step 6.4 — Export

- [ ] Edit `packages/ui/src/index.ts`, append:

```ts
export {
  ParkingStallCard,
  type ParkingStallCardProps,
  type ParkingStallCarPayload,
  type StallSource,
} from './ParkingStallCard.js';
```

### Step 6.5 — Run failing test → green

Run: `pnpm --filter @ccc/mobile test -- ParkingStallCard`
Expected: PASS all 7 tests.

### Step 6.6 — Swap call sites in `GarageListView.tsx`

- [ ] Edit `apps/mobile/src/screens/garage/garage-slots.ts` — find the existing `GarageSlot` discriminated union + the builder. The current shape (per investigator) has kinds `filled / empty-free / empty-extra / add-card / buy`. For redesign the renderer needs the source string (`default_free | purchase | admin_grant`) AND a global slot number. Adapt the builder to emit:

```ts
type GarageSlotV2 =
  | {
      kind: 'filled';
      index: number;
      source: 'default_free' | 'purchase' | 'admin_grant';
      spot: GarageSpot;
      car: Car;
    }
  | {
      kind: 'empty';
      index: number;
      source: 'default_free' | 'purchase' | 'admin_grant';
      spot: GarageSpot | null;
    }
  | { kind: 'buy'; index: number; purchaseOption: PurchaseOption };
```

`index` is the 1-based render position. Maintain it in the builder by counting in iteration order. Tests under `apps/mobile/src/screens/garage/__tests__/garage-slots.test.ts` will need updates — extend them in this PR.

- [ ] Replace `GarageListView.tsx` body with:

```tsx
import { type ParkingStallCarPayload, ParkingStallCard } from '@ccc/ui';
import { Link } from 'expo-router';
import type { ReactElement } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import type { GarageSlotV2 } from './garage-slots';
import { theme } from '~/theme';

type Props = {
  slots: GarageSlotV2[];
  premiumTier: 'gold' | 'silver' | 'bronze' | null;
  daysLeftUntilExpiry: number | null;
  highlightSpotId?: string | null;
  onBadgePress: () => void;
  onBuySpot: () => void;
  onAddCar: () => void;
  onFilledCarPress: (carId: string) => void;
  ListHeaderComponent?: ReactElement | null;
};

const keyOf = (slot: GarageSlotV2): string => {
  if (slot.kind === 'filled') return `f-${slot.spot.id}`;
  if (slot.kind === 'empty') return `e-${slot.spot?.id ?? `idx-${slot.index}`}`;
  return `buy-${slot.index}`;
};

const toCarPayload = (
  car: GarageSlotV2 extends { car: infer C } ? C : never,
  isPremiumActive: boolean,
): ParkingStallCarPayload => ({
  id: car.id,
  year: car.year,
  make: car.make,
  model: car.model,
  nickname: car.nickname,
  isPremiumActive,
  photoUrl: car.photos[0]?.url ?? null,
});

export function GarageListView({
  slots,
  premiumTier,
  daysLeftUntilExpiry,
  highlightSpotId,
  onBadgePress,
  onBuySpot,
  onAddCar,
  onFilledCarPress,
  ListHeaderComponent,
}: Props) {
  return (
    <FlatList
      data={slots}
      keyExtractor={keyOf}
      contentContainerStyle={styles.list}
      {...(ListHeaderComponent ? { ListHeaderComponent } : {})}
      renderItem={({ item }) => {
        if (item.kind === 'filled') {
          const carPayload = toCarPayload(
            item.car as any,
            Boolean((item.car as any).isPremiumActive),
          );
          return (
            <ParkingStallCard
              state="filled"
              source={item.source}
              slotNumber={item.index}
              car={carPayload}
              premiumTier={premiumTier}
              daysLeftUntilExpiry={daysLeftUntilExpiry}
              onBadgePress={onBadgePress}
              highlight={highlightSpotId === item.spot.id}
              onPress={() => onFilledCarPress(item.car.id)}
            />
          );
        }
        if (item.kind === 'empty') {
          return (
            <ParkingStallCard
              state="empty"
              source={item.source}
              slotNumber={item.index}
              highlight={highlightSpotId === (item.spot?.id ?? null)}
              onPress={onAddCar}
            />
          );
        }
        return (
          <ParkingStallCard
            state="buy"
            source="default_free"
            slotNumber={item.index}
            priceLabel={formatPrice(item.purchaseOption.priceCents)}
            onPress={onBuySpot}
          />
        );
      }}
    />
  );
}

const formatPrice = (cents: number): string => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

const styles = StyleSheet.create({
  list: { gap: theme.spacing.md, padding: theme.spacing.lg },
});
```

### Step 6.7 — Delete the legacy cards

```bash
rm apps/mobile/src/screens/garage/AddCarPlaceholderCard.tsx \
   apps/mobile/src/screens/garage/FillSpotCard.tsx \
   apps/mobile/src/screens/garage/BuySpotCard.tsx \
   apps/mobile/src/screens/garage/GarageSpotPlaceholderCard.tsx
```

- [ ] Remove tests that exclusively cover the deleted cards. Check `apps/mobile/src/screens/garage/__tests__/BuySpotCard.test.tsx` — if it tests pricing/CTA logic worth keeping, fold those assertions into `ParkingStallCard.test.tsx` step 6.1. Otherwise delete.

### Step 6.8 — Wire `apps/mobile/app/(app)/garage/index.tsx`

- [ ] Edit the route. Replace the existing call to `GarageListView` to pass the new props. Drop the `ListEmptyComponent` (the empty-state IS the stall list now). Wire `onBadgePress` to a no-op temporarily (chunk 08 hooks it to PremiumSheet visibility):

```tsx
return (
  <View style={styles.container}>
    <GarageListView
      slots={slots}
      premiumTier={garage.garage.premiumTier}
      daysLeftUntilExpiry={garage.garage.daysLeftUntilExpiry}
      onBuySpot={handleBuySpot}
      onAddCar={handleAddCar}
      onFilledCarPress={(carId) => router.push(`/garage/${carId}` as never)}
      onBadgePress={() => undefined /* wired in chunk 08 */}
      ListHeaderComponent={
        <View style={styles.header}>
          <GarageHeader
            garage={garage.garage}
            carCount={garage.cars.length}
            onUpdated={(next) => setGarage((prev) => (prev ? { ...prev, garage: next } : prev))}
          />
        </View>
      }
    />
  </View>
);
```

### Step 6.9 — Run all mobile + ui tests

Run: `pnpm --filter @ccc/mobile test -- garage`
Expected: PASS.

### Step 6.10 — Commit

```bash
git add -A packages/ui/ apps/mobile/src/screens/garage/ apps/mobile/app/
git commit -m "$(cat <<'EOF'
feat(ui,mobile): ParkingStallCard replaces placeholder cards

Three-state card (filled / empty / buy) with source-aware paint +
SLOT NN plate + RESERVADA / CORTESIA / À VENDA tape. Renders the
car photo parked inside the painted rails when filled. Empty + buy
states share the painted-stall vocabulary instead of the dashed
muted text the legacy cards used.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Wave A done after this chunk. Verify staging/preview deploy before chunk 07.

---

## Chunk 07 — GarageCover component + cover slot in IdentityCard (no wiring yet)

**Files:**

- Create: `packages/ui/src/GarageCover.tsx`
- Create: `packages/ui/src/__tests__/GarageCover.test.tsx`
- Modify: `packages/ui/src/index.ts`

Locked-contract impact: none. Pure rendering component.

### Step 7.1 — Failing test

```tsx
import { render } from '@testing-library/react-native';
import { GarageCover } from '../GarageCover.js';

describe('GarageCover', () => {
  it('renders the default-door preset when nothing else is set', () => {
    const { getByTestId } = render(
      <GarageCover
        coverPreset={null}
        coverImageUrl={null}
        isPremiumActive={false}
        testID="cover"
      />,
    );
    expect(getByTestId('cover')).toBeTruthy();
  });

  it('prefers coverImageUrl when premium', () => {
    const { getByTestId } = render(
      <GarageCover
        coverPreset="urban-night"
        coverImageUrl="https://r2.example.com/garage-cover/u1/abc.jpg"
        isPremiumActive
        testID="cover"
      />,
    );
    expect(getByTestId('cover-image')).toBeTruthy();
  });

  it('ignores premium preset when isPremiumActive is false', () => {
    const { getByTestId, queryByTestId } = render(
      <GarageCover
        coverPreset="urban-night"
        coverImageUrl={null}
        isPremiumActive={false}
        testID="cover"
      />,
    );
    expect(getByTestId('cover-preset-default-door')).toBeTruthy();
    expect(queryByTestId('cover-preset-urban-night')).toBeNull();
  });
});
```

### Step 7.2 — Implement

- [ ] Create `packages/ui/src/GarageCover.tsx`. Use `expo-linear-gradient` (already installed) for the hues + the diagonal "speed lines" + the bottom scrim. R2-image branch uses `<Image />` with `resizeMode="cover"`. Add a `<Text>` corner pill rendering `cover · <slug>` in mono (matches prototype).

```tsx
import { LinearGradient } from 'expo-linear-gradient';
import { Image, Text, View } from 'react-native';

import { GARAGE_COVER_PRESETS, resolveGarageCoverSlug } from '@ccc/shared/garage-covers';

import { garageTokens } from './garage-tokens.js';

export interface GarageCoverProps {
  coverPreset: string | null;
  coverImageUrl: string | null;
  isPremiumActive: boolean;
  height?: number;
  testID?: string;
}

export function GarageCover({
  coverPreset,
  coverImageUrl,
  isPremiumActive,
  height = 168,
  testID,
}: GarageCoverProps) {
  const resolved = resolveGarageCoverSlug(coverPreset, coverImageUrl, isPremiumActive);

  if (resolved.kind === 'url') {
    return (
      <View testID={testID} style={{ width: '100%', height, position: 'relative' }}>
        <Image
          testID="cover-image"
          source={{ uri: resolved.url }}
          style={{ width: '100%', height }}
          resizeMode="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']}
          locations={[0, 0.6, 1]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' }}
        />
      </View>
    );
  }

  const preset =
    GARAGE_COVER_PRESETS.find((p) => p.slug === resolved.slug) ?? GARAGE_COVER_PRESETS[0];

  return (
    <View
      testID={testID}
      style={{ width: '100%', height, position: 'relative', overflow: 'hidden' }}
    >
      {/* Base hue ramp */}
      <LinearGradient
        colors={[preset.hues[0], preset.hues[1]]}
        style={{ position: 'absolute', inset: 0 as unknown as number, width: '100%', height }}
      />
      {/* Stripe glow */}
      <View
        testID={`cover-preset-${preset.slug}`}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          opacity: 0.4,
          backgroundColor: `${preset.stripe}1f`,
        }}
      />
      {/* Bottom scrim */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']}
        locations={[0, 0.6, 1]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' }}
      />
      {/* Corner slug label */}
      <View style={{ position: 'absolute', top: 14, right: 14 }}>
        <Text
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 9,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          cover · {preset.slug}
        </Text>
      </View>
    </View>
  );
}
```

Note: the `inset: 0` trick may need an RN-style equivalent (`left: 0, right: 0, top: 0, bottom: 0`). Adjust the absolute positioning per RN — RN does not accept `inset` as a number.

### Step 7.3 — Export + tests green

- [ ] Edit `packages/ui/src/index.ts`, append:

```ts
export { GarageCover, type GarageCoverProps } from './GarageCover.js';
```

Run: `pnpm --filter @ccc/mobile test -- GarageCover`
Expected: PASS.

### Step 7.4 — Commit

```bash
git add packages/ui/src/GarageCover.tsx \
        packages/ui/src/__tests__/GarageCover.test.tsx \
        packages/ui/src/index.ts
git commit -m "$(cat <<'EOF'
feat(ui): GarageCover component (preset gradient or R2 image)

Renders the cover hero at the top of /garage and /g/:slug. Resolver
defers to @ccc/shared/garage-covers so server + client agree on the
precedence rule. Premium-lapse mask handled by the resolver, not by
two parallel branches in the renderer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 08 — IdentityCard + EditGarageSheet + GarageHeader gut

**Files:**

- Create: `apps/mobile/src/screens/garage/IdentityCard.tsx`
- Create: `apps/mobile/src/screens/garage/EditGarageSheet.tsx`
- Modify: `apps/mobile/src/screens/garage/GarageHeader.tsx` (turn into thin wrapper)
- Modify: `apps/mobile/app/(app)/garage/index.tsx` (host sheet state, wire PremiumSheet)
- Modify: `apps/mobile/src/copy/garage.ts`
- Modify: `apps/mobile/src/api/garage.ts` (no changes likely, but verify `patchGarage` returns the new fields)

Locked-contract impact: edit affordances become visible. Slug error mapping distinguishes `invalid_slug` from `slug_taken` (UX-Audit B.3 fix).

Visual canon: `screens.jsx` lines 22-146 (`IdentityCard`) + 778-846 (`EditGarageSheet`).

### Step 8.1 — Copy entries

- [ ] Edit `apps/mobile/src/copy/garage.ts`. In `ptBR.garage` add:

```ts
    invalidSlug: 'URL pode usar apenas letras minúsculas, números e hífens.',
    editSheetTitle: 'Editar Garagem',
    editSlugHint: 'Apenas letras minúsculas, números e hífens.',
    editVisibilityPublicConsequence: (slug: string) =>
      `Qualquer pessoa pode ver sua garagem em jdmexp.app/g/${slug}.`,
    welcomeTitle: 'Bem-vindo à sua Garagem',
    welcomeBody: (limit: number | null) =>
      limit === null
        ? 'Toque numa vaga abaixo para adicionar seu primeiro carro. Você tem vagas ilimitadas.'
        : `Toque numa vaga abaixo para adicionar seu primeiro carro. Você tem ${limit} ${limit === 1 ? 'vaga grátis' : 'vagas grátis'}.`,
    expiredTitle: 'Seu Premium expirou',
    expiredBody:
      'Sua garagem continua acessível, mas o selo Premium e a capa personalizada foram desativados. Renove para reativá-los.',
    sectionVagasTitle: 'Vagas',
    sectionVagasMode: {
      gratis: 'GRÁTIS',
      gratisExtra: 'GRÁTIS + EXTRA',
      atCap: 'NO LIMITE',
      unlimited: 'ILIMITADO',
    },
```

Add EN equivalents.

### Step 8.2 — IdentityCard

- [ ] Create `apps/mobile/src/screens/garage/IdentityCard.tsx`:

```tsx
import { type GarageOwner } from '@ccc/shared/garage';
import { PremiumBadge } from '@ccc/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { garageCopy } from '~/copy/garage';
import { theme } from '~/theme';

type Props = {
  garage: GarageOwner;
  carCount: number;
  isOwner: boolean;
  onEdit?: () => void;
  onCoverEdit?: () => void;
  onShare?: () => void;
  onBadgePress?: () => void;
};

export function IdentityCard({
  garage,
  carCount,
  isOwner,
  onEdit,
  onCoverEdit,
  onShare,
  onBadgePress,
}: Props) {
  return (
    <View style={styles.card}>
      {garage.isPremiumActive ? <View style={styles.accentLine} /> : null}

      <View style={styles.topRow}>
        <View style={styles.glyph}>
          <Text style={styles.glyphChar}>{garage.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.titleColumn}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {garage.name}
            </Text>
            {isOwner ? <Text style={styles.pencilGlyph}>✎</Text> : null}
            {garage.isPremiumActive ? (
              <PremiumBadge
                isPremiumActive
                tier={garage.premiumTier}
                daysLeftUntilExpiry={garage.daysLeftUntilExpiry}
                size="sm"
                onPress={onBadgePress}
              />
            ) : null}
          </View>
          <Text style={styles.slug}>
            {garage.isPublic ? '🌐 ' : '🔒 '}jdmexp.app/g/{garage.slug}
          </Text>
        </View>
      </View>

      {garage.description ? <Text style={styles.description}>{garage.description}</Text> : null}

      <View style={styles.actionRow}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>
            {carCount} {carCount === 1 ? 'CARRO' : 'CARROS'}
          </Text>
        </View>
        <View style={[styles.pill, garage.isPublic ? styles.pillSuccess : styles.pillNeutral]}>
          <Text
            style={[
              styles.pillText,
              garage.isPublic ? styles.pillTextSuccess : styles.pillTextNeutral,
            ]}
          >
            {garage.isPublic ? 'Pública' : 'Privada'}
          </Text>
        </View>

        <View style={styles.flex} />

        {isOwner ? (
          <>
            <Pressable onPress={onCoverEdit} accessibilityRole="button" style={styles.outlineBtn}>
              <Text style={styles.outlineBtnLabel}>Capa</Text>
            </Pressable>
            <Pressable onPress={onEdit} accessibilityRole="button" style={styles.fillBtn}>
              <Text style={styles.fillBtnLabel}>Editar</Text>
            </Pressable>
          </>
        ) : null}

        {garage.isPublic ? (
          <Pressable onPress={onShare} accessibilityRole="button" style={styles.brandBtn}>
            <Text style={styles.brandBtnLabel}>{isOwner ? 'Link' : 'Compartilhar'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: -44,
    marginHorizontal: 16,
    position: 'relative',
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 12 },
  },
  accentLine: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    height: 2,
    backgroundColor: '#E10600',
    borderRadius: 2,
  },
  topRow: { flexDirection: 'row', gap: 12 },
  glyph: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#1F1F1F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphChar: { color: '#C9C9CD', fontSize: 20, fontWeight: '700' },
  titleColumn: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { color: '#F5F5F5', fontSize: 17, fontWeight: '700', letterSpacing: -0.2, lineHeight: 22 },
  pencilGlyph: { color: '#8A8A93', fontSize: 13 },
  slug: { color: '#8A8A93', fontSize: 11.5, marginTop: 3, fontFamily: 'JetBrainsMono_400Regular' },
  description: { marginTop: 10, color: '#C9C9CD', fontSize: 13, lineHeight: 19 },
  actionRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  pill: {
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#1F1F1F',
    justifyContent: 'center',
  },
  pillText: {
    color: '#C9C9CD',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  pillSuccess: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)' },
  pillTextSuccess: { color: '#5DE08A' },
  pillNeutral: {},
  pillTextNeutral: {},
  flex: { flex: 1 },
  outlineBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  outlineBtnLabel: { color: '#C9C9CD', fontSize: 12, fontWeight: '600' },
  fillBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#1F1F1F',
    borderWidth: 1,
    borderColor: '#3A3A3A',
  },
  fillBtnLabel: { color: '#F5F5F5', fontSize: 12, fontWeight: '600' },
  brandBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#E10600',
  },
  brandBtnLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
```

(Production should swap the inline hex literals for theme tokens once `apps/mobile/src/theme/index.ts` is expanded — see step 8.6.)

### Step 8.3 — EditGarageSheet

- [ ] Create `apps/mobile/src/screens/garage/EditGarageSheet.tsx`:

```tsx
import { GARAGE_RESERVED_SLUGS, type GarageOwner, type GaragePatch } from '@ccc/shared/garage';
import { SheetShell } from '@ccc/ui';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { ApiError } from '~/api/client';
import { patchGarage } from '~/api/garage';
import { garageCopy } from '~/copy/garage';
import { showMessage } from '~/lib/confirm';
import { theme } from '~/theme';

type Props = {
  visible: boolean;
  garage: GarageOwner;
  onClose: () => void;
  onSaved: (next: GarageOwner) => void;
};

const SLUG_RE = /^[a-z0-9-]+$/;

const validate = (input: { name: string; slug: string; description: string }): string | null => {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 50) return 'invalid_name';
  const slug = input.slug.trim();
  if (slug.length === 0 || slug.length > 40) return 'invalid_slug_length';
  if (!SLUG_RE.test(slug)) return 'invalid_slug';
  if (GARAGE_RESERVED_SLUGS.has(slug)) return 'reserved_slug';
  if (input.description.length > 500) return 'invalid_description';
  return null;
};

export function EditGarageSheet({ visible, garage, onClose, onSaved }: Props) {
  const [name, setName] = useState(garage.name);
  const [slug, setSlug] = useState(garage.slug);
  const [description, setDescription] = useState(garage.description ?? '');
  const [isPublic, setIsPublic] = useState(garage.isPublic);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{
    field: 'name' | 'slug' | 'description';
    msg: string;
  } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(garage.name);
    setSlug(garage.slug);
    setDescription(garage.description ?? '');
    setIsPublic(garage.isPublic);
    setError(null);
  }, [visible, garage.id, garage.name, garage.slug, garage.description, garage.isPublic]);

  const handleSave = async () => {
    const v = validate({ name, slug, description });
    if (v === 'invalid_slug') {
      setError({ field: 'slug', msg: garageCopy.garage.invalidSlug });
      return;
    }
    if (v === 'invalid_slug_length') {
      setError({ field: 'slug', msg: garageCopy.garage.invalidSlug });
      return;
    }
    if (v === 'reserved_slug') {
      setError({ field: 'slug', msg: garageCopy.garage.reservedSlug });
      return;
    }
    if (v === 'invalid_description') {
      setError({ field: 'description', msg: garageCopy.garage.descriptionTooLong });
      return;
    }
    if (v === 'invalid_name') {
      setError({ field: 'name', msg: garageCopy.garage.nameTooLong });
      return;
    }

    const patch: GaragePatch = {};
    if (name.trim() !== garage.name) patch.name = name.trim();
    if (slug.trim() !== garage.slug) patch.slug = slug.trim();
    const nextDescription = description.trim() === '' ? null : description.trim();
    if (nextDescription !== garage.description) patch.description = nextDescription;
    if (isPublic !== garage.isPublic) patch.isPublic = isPublic;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await patchGarage(patch);
      onSaved(res.garage);
      showMessage(garageCopy.garage.saveSuccess);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError({ field: 'slug', msg: garageCopy.garage.slugTaken });
      } else if (err instanceof ApiError && err.status === 400) {
        const body = err.body as { error?: string } | null | undefined;
        if (body?.error === 'reserved_slug') {
          setError({ field: 'slug', msg: garageCopy.garage.reservedSlug });
        } else if (body?.error === 'invalid_slug') {
          setError({ field: 'slug', msg: garageCopy.garage.invalidSlug });
        } else {
          showMessage(garageCopy.garage.saveFailed);
        }
      } else {
        showMessage(garageCopy.garage.saveFailed);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SheetShell
      visible={visible}
      title={garageCopy.garage.editSheetTitle}
      onClose={onClose}
      testID="edit-garage-sheet"
    >
      <View style={styles.body}>
        <Field label="Nome" error={error?.field === 'name' ? error.msg : undefined}>
          <TextInput value={name} onChangeText={setName} maxLength={50} style={styles.input} />
          <Counter value={name.length} max={50} />
        </Field>

        <Field
          label="URL pública"
          hint={garageCopy.garage.editSlugHint}
          error={error?.field === 'slug' ? error.msg : undefined}
        >
          <View style={styles.slugWrap}>
            <Text style={styles.slugPrefix}>/g/</Text>
            <TextInput
              value={slug}
              onChangeText={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              maxLength={40}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.slugInput]}
            />
          </View>
        </Field>

        <Field label="Descrição" error={error?.field === 'description' ? error.msg : undefined}>
          <TextInput
            value={description}
            onChangeText={setDescription}
            maxLength={500}
            multiline
            placeholder={garageCopy.garage.descriptionPlaceholder}
            placeholderTextColor="#8A8A93"
            style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
          />
          <Counter value={description.length} max={500} />
        </Field>

        <View style={styles.toggleRow}>
          <View style={styles.flex}>
            <Text style={styles.toggleTitle}>Tornar pública</Text>
            <Text style={styles.toggleHint}>
              {isPublic
                ? garageCopy.garage.editVisibilityPublicConsequence(slug)
                : garageCopy.garage.visibilityPrivateHint}
            </Text>
          </View>
          <Switch value={isPublic} onValueChange={setIsPublic} disabled={submitting} />
        </View>

        <View style={styles.btnRow}>
          <Pressable
            onPress={onClose}
            disabled={submitting}
            style={styles.btnSecondary}
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryLabel}>Cancelar</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleSave()}
            disabled={submitting}
            style={styles.btnPrimary}
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryLabel}>Salvar</Text>
          </Pressable>
        </View>
      </View>
    </SheetShell>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  const near = value / max > 0.9;
  return (
    <Text style={[styles.counter, near && { color: '#F59E0B' }]}>
      {value}/{max}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, gap: 12 },
  field: {},
  fieldLabel: { color: '#C9C9CD', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  fieldHint: { color: '#8A8A93', fontSize: 11, marginTop: 4 },
  fieldError: { color: '#EF4444', fontSize: 11, marginTop: 4 },
  input: {
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F5F5F5',
    fontSize: 13,
  },
  slugWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  slugPrefix: { color: '#8A8A93', paddingLeft: 12, paddingRight: 8, fontSize: 13 },
  slugInput: { borderWidth: 0, backgroundColor: 'transparent', flex: 1, paddingLeft: 0 },
  counter: { color: '#8A8A93', fontSize: 10, marginTop: 4, textAlign: 'right' },
  toggleRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
  },
  toggleTitle: { color: '#F5F5F5', fontSize: 13, fontWeight: '600' },
  toggleHint: { color: '#8A8A93', fontSize: 11.5, marginTop: 2, lineHeight: 17 },
  flex: { flex: 1 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1F1F1F',
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
  },
  btnSecondaryLabel: { color: '#F5F5F5', fontSize: 13, fontWeight: '600' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#E10600',
    alignItems: 'center',
  },
  btnPrimaryLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
```

### Step 8.4 — Gut GarageHeader.tsx → wrapper

- [ ] Replace `apps/mobile/src/screens/garage/GarageHeader.tsx` with a thin wrapper that:
  1. Renders the `<GarageCover />` hero (always — premium gate is inside the renderer).
  2. Overlays the `<IdentityCard />`.
  3. Owns the `editSheetOpen` + `coverSheetOpen` + `premiumSheetOpen` state.
  4. Hosts `<EditGarageSheet />` and `<PremiumSheet />`. (CoverPickerSheet wires in chunk 09.)
  5. Exposes `handleShare` — fixed in chunk 11.

```tsx
import { type GarageOwner } from '@ccc/shared/garage';
import { GarageCover, PremiumSheet } from '@ccc/ui';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { garageCopy } from '~/copy/garage';
import { showMessage } from '~/lib/confirm';

import { EditGarageSheet } from './EditGarageSheet';
import { IdentityCard } from './IdentityCard';

type Props = {
  garage: GarageOwner;
  onUpdated: (next: GarageOwner) => void;
  carCount: number;
  onCoverEdit: () => void;
};

export function GarageHeader({ garage, onUpdated, carCount, onCoverEdit }: Props) {
  const [editSheet, setEditSheet] = useState(false);
  const [premiumSheet, setPremiumSheet] = useState(false);

  const handleShare = async () => {
    // Chunk 11 replaces the path-only URL with PUBLIC_PROFILE_BASE_URL.
    if (!garage.isPublic) {
      showMessage(garageCopy.garage.shareLinkDisabledHint);
      return;
    }
    try {
      await Share.share({ message: `/g/${garage.slug}`, title: garage.name });
    } catch {
      /* user-dismiss */
    }
  };

  return (
    <View>
      <GarageCover
        coverPreset={garage.coverPreset}
        coverImageUrl={garage.coverImageUrl}
        isPremiumActive={garage.isPremiumActive}
      />
      <IdentityCard
        garage={garage}
        carCount={carCount}
        isOwner
        onEdit={() => setEditSheet(true)}
        onCoverEdit={onCoverEdit}
        onShare={() => void handleShare()}
        onBadgePress={() => setPremiumSheet(true)}
      />
      <EditGarageSheet
        visible={editSheet}
        garage={garage}
        onClose={() => setEditSheet(false)}
        onSaved={onUpdated}
      />
      <PremiumSheet
        visible={premiumSheet}
        tier={garage.premiumTier}
        isPremiumActive={garage.isPremiumActive}
        daysLeftUntilExpiry={garage.daysLeftUntilExpiry}
        onClose={() => setPremiumSheet(false)}
        copy={{
          title: garageCopy.garage.premiumSheetTitle,
          tierLabel: garageCopy.garage.premiumTierLabel(garage.premiumTier ?? 'gold'),
          heroTitle: garageCopy.garage.premiumHeroTitle,
          heroBody: garageCopy.garage.premiumHeroBody,
          nearExpiry: garageCopy.garage.premiumNearExpiry,
          benefits: garageCopy.garage.premiumBenefits,
          footer: garageCopy.garage.premiumFooter,
        }}
      />
    </View>
  );
}
```

### Step 8.5 — Wire `onCoverEdit` from the route stub

- [ ] Edit `apps/mobile/app/(app)/garage/index.tsx`. Add a placeholder `onCoverEdit={() => undefined}` for now. Chunk 09 replaces with real wiring.

### Step 8.6 — Re-run mobile tests

Run: `pnpm --filter @ccc/mobile test -- garage`
Expected: PASS. Update `GarageListView.viewmodel.test.ts` / `garage-slots.test.ts` if any assertions rely on the old `GarageHeader` shape.

### Step 8.7 — Visual smoke

- [ ] Open Expo + run the mobile app. Navigate to `/garage`. Verify:
  - Cover renders (default-door for free users)
  - IdentityCard overlays with `-44pt` margin
  - Tapping the pencil glyph / `Editar` button opens `EditGarageSheet`
  - Typing an invalid slug character (e.g. `Á`) is filtered client-side
  - Submitting an empty + reserved slug shows the correct copy
  - Tapping the PremiumBadge opens `PremiumSheet`

### Step 8.8 — Commit

```bash
git add apps/mobile/src/screens/garage/IdentityCard.tsx \
        apps/mobile/src/screens/garage/EditGarageSheet.tsx \
        apps/mobile/src/screens/garage/GarageHeader.tsx \
        apps/mobile/app/\(app\)/garage/index.tsx \
        apps/mobile/src/copy/garage.ts
git commit -m "$(cat <<'EOF'
feat(mobile): IdentityCard + EditGarageSheet + PremiumSheet wiring

GarageHeader becomes a thin wrapper: GarageCover hero + IdentityCard
overlay + 2 sheets (edit, premium). Inline-edit affordance (UX-Audit
E.1) becomes a pencil glyph + explicit Editar button + sheet.
Slug error mapping distinguishes invalid_slug from slug_taken
(UX-Audit B.3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 09 — CoverPickerSheet + R2 upload wiring

**Files:**

- Create: `apps/mobile/src/screens/garage/CoverPickerSheet.tsx`
- Modify: `apps/mobile/src/api/garage.ts` — add `patchGarageCover`
- Modify: `apps/mobile/src/api/uploads.ts` (or wherever the presign helper lives — grep for existing usage)
- Modify: `apps/mobile/src/screens/garage/GarageHeader.tsx` (host CoverPickerSheet state) — actually, push the sheet up to the route so the highlight pulse from chunk 10 can share state. Easier: keep it in the header, route receives the patch through `onUpdated` which already exists.

Locked-contract impact: cover patch goes through chunk 03's server validation. Client just calls the endpoint.

### Step 9.1 — Add `patchGarageCover` + `presignGarageCoverUpload` to mobile API client

- [ ] Edit `apps/mobile/src/api/garage.ts`. Add:

```ts
export type GarageCoverPatch = { coverPreset: string | null } | { coverImageUrl: string | null };

export const patchGarageCover = async (
  patch: GarageCoverPatch,
): Promise<GarageReadResponse['garage']> => {
  const res = await apiClient.request<{ garage: GarageReadResponse['garage'] }>({
    method: 'PATCH',
    url: '/me/garage/cover',
    body: patch,
  });
  return res.garage;
};
```

(Adjust to whatever apiClient signature `apps/mobile/src/api/client.ts` exposes.)

- [ ] Open `apps/mobile/src/api/uploads.ts` (the cars-photo upload flow already lives here — `git grep "presign" apps/mobile/src/api/` to confirm location). If a generic `presignUpload({ kind, contentType, size })` helper exists, add the `garage_cover` thin wrapper:

```ts
export const presignGarageCoverUpload = (input: {
  contentType: string;
  size: number;
}): Promise<{
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
}> => presignUpload({ kind: 'garage_cover', contentType: input.contentType, size: input.size });
```

If the existing helper is hardcoded to `car_photo`, generalize it instead of cloning. Helper must call `POST /uploads/presign` (the route registered in Phase 1 chunk 03) and return the API response verbatim.

- [ ] Same file. Add the `putToR2` helper if it does not exist (cars-photo flow likely has it; reuse). Concrete signature:

```ts
export const putToR2 = async (
  uploadUrl: string,
  localUri: string,
  contentType: string,
  headers: Record<string, string>,
): Promise<void> => {
  const body = await fetch(localUri).then((r) => r.blob());
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, ...headers },
    body,
  });
  if (!res.ok) throw new Error(`R2 PUT failed: ${res.status}`);
};
```

### Step 9.2 — Create the sheet

- [ ] Create `apps/mobile/src/screens/garage/CoverPickerSheet.tsx`. Visual canon: `screens.jsx` lines 630-711.

```tsx
import { GARAGE_COVER_PRESETS } from '@ccc/shared/garage-covers';
import { GarageCover, SheetShell } from '@ccc/ui';
import * as ImagePicker from 'expo-image-picker';
import { Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native';

import { patchGarageCover } from '~/api/garage';
import { presignGarageCoverUpload, putToR2 } from '~/api/uploads';
import { garageCopy } from '~/copy/garage';
import { showMessage } from '~/lib/confirm';

type Props = {
  visible: boolean;
  isPremiumActive: boolean;
  currentSlug: string | null;
  currentImageUrl: string | null;
  onClose: () => void;
  onCoverChanged: (next: { coverPreset: string | null; coverImageUrl: string | null }) => void;
  onPremiumUpsell: () => void;
};

export function CoverPickerSheet({
  visible,
  isPremiumActive,
  currentSlug,
  currentImageUrl,
  onClose,
  onCoverChanged,
  onPremiumUpsell,
}: Props) {
  const selectPreset = async (slug: string, premium: boolean) => {
    if (premium && !isPremiumActive) {
      onPremiumUpsell();
      return;
    }
    try {
      const garage = await patchGarageCover({ coverPreset: slug });
      onCoverChanged({ coverPreset: garage.coverPreset, coverImageUrl: garage.coverImageUrl });
      onClose();
    } catch {
      showMessage(garageCopy.garage.saveFailed);
    }
  };

  const handleUpload = async () => {
    if (!isPremiumActive) {
      onPremiumUpsell();
      return;
    }
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.9,
    });
    if (pickerResult.canceled || pickerResult.assets.length === 0) return;
    const asset = pickerResult.assets[0]!;
    const mime = asset.mimeType ?? 'image/jpeg';
    try {
      const presign = await presignGarageCoverUpload({
        contentType: mime,
        size: asset.fileSize ?? 1_000_000,
      });
      await putToR2(presign.uploadUrl, asset.uri, mime, presign.headers);
      const garage = await patchGarageCover({ coverImageUrl: presign.publicUrl });
      onCoverChanged({ coverPreset: garage.coverPreset, coverImageUrl: garage.coverImageUrl });
      onClose();
    } catch (err) {
      showMessage(garageCopy.garage.saveFailed);
    }
  };

  return (
    <SheetShell visible={visible} title="Capa da Garagem" onClose={onClose}>
      <View style={styles.body}>
        <Text style={styles.hint}>
          {isPremiumActive
            ? garageCopy.garage.coverPickerHintPremium
            : garageCopy.garage.coverPickerHintFree}
        </Text>
        <View style={styles.grid}>
          {GARAGE_COVER_PRESETS.map((p) => {
            const locked = p.premium && !isPremiumActive;
            const selected =
              currentImageUrl === null &&
              (currentSlug === p.slug || (currentSlug === null && p.slug === 'default-door'));
            return (
              <Pressable
                key={p.slug}
                onPress={() => void selectPreset(p.slug, p.premium)}
                disabled={locked}
                style={[styles.tile, selected && styles.tileSelected, locked && styles.tileLocked]}
                accessibilityRole="button"
                accessibilityLabel={p.label}
              >
                <View style={styles.tileCover}>
                  <GarageCover
                    coverPreset={p.slug}
                    coverImageUrl={null}
                    isPremiumActive
                    height={80}
                  />
                  {selected ? (
                    <View style={styles.checkBadge}>
                      <Text style={styles.checkLabel}>✓</Text>
                    </View>
                  ) : null}
                  {locked ? (
                    <View style={styles.lockPip}>
                      <Text style={styles.lockLabel}>Premium</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.tileMeta}>
                  <Text style={styles.tileLabel}>{p.label}</Text>
                  <Text style={styles.tileSlug}>{p.slug}</Text>
                </View>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => void handleUpload()}
            disabled={!isPremiumActive}
            style={[styles.tile, styles.uploadTile, !isPremiumActive && styles.tileLocked]}
            accessibilityRole="button"
            accessibilityLabel={garageCopy.garage.coverUploadButton}
          >
            <View style={[styles.tileCover, styles.uploadTilePreview]}>
              <Text style={styles.uploadGlyph}>⤴</Text>
              <Text style={styles.uploadLabel}>{garageCopy.garage.coverUploadButton}</Text>
            </View>
            <View style={styles.tileMeta}>
              <Text style={styles.tileLabel}>Personalizada</Text>
              <Text style={styles.tileSlug}>{garageCopy.garage.coverUploadHint}</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18 },
  hint: { color: '#8A8A93', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#2A2A2A',
    backgroundColor: '#141414',
  },
  tileSelected: { borderColor: '#E10600' },
  tileLocked: { opacity: 0.45 },
  uploadTile: { borderStyle: 'dashed' },
  tileCover: { height: 80, position: 'relative' },
  uploadTilePreview: {
    backgroundColor: '#0F0F0F',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  uploadGlyph: { color: '#F5F5F5', fontSize: 20, lineHeight: 22 },
  uploadLabel: { color: '#F5F5F5', fontSize: 12, fontWeight: '600' },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E10600',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLabel: { color: '#FFFFFF', fontSize: 12, lineHeight: 12 },
  lockPip: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(232,179,57,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(232,179,57,0.4)',
  },
  lockLabel: {
    color: '#E8B339',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  tileMeta: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: '#0F0F0F',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
  },
  tileLabel: { color: '#F5F5F5', fontSize: 12, fontWeight: '600' },
  tileSlug: {
    color: '#8A8A93',
    fontSize: 10,
    marginTop: 1,
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
```

### Step 9.3 — Copy entries

- [ ] Edit `apps/mobile/src/copy/garage.ts`. Add:

```ts
    coverPickerHintFree:
      'Você está usando a capa padrão. Assinaturas Premium desbloqueiam 9 cenários curados e upload.',
    coverPickerHintPremium:
      'Escolha entre os 9 cenários curados ou envie sua imagem (máx. 4 MB, 1600×600 mín).',
    coverUploadButton: 'Enviar imagem',
    coverUploadHint: 'r2://garage-cover/...',
```

EN equivalents added.

### Step 9.4 — Wire from GarageHeader

- [ ] Edit `apps/mobile/src/screens/garage/GarageHeader.tsx`. Add `coverSheet` state + render `<CoverPickerSheet />`. The route's `onCoverEdit` no longer makes sense — push that responsibility back into the header. Replace the `onCoverEdit` prop with an internal state toggle, and the route stops needing the prop.

### Step 9.5 — Failing → green test

- [ ] Optional integration test: mount `CoverPickerSheet` with `isPremiumActive=false`, tap a locked tile, assert `onPremiumUpsell` fires. Tap `default-door`, assert `onCoverChanged` is invoked with the slug. Add to `apps/mobile/src/screens/garage/__tests__/CoverPickerSheet.test.tsx`.

### Step 9.6 — Visual smoke

Tap "Capa" on a free account. Sheet opens with 8 locked tiles + 1 unlocked (`default-door`) + 1 locked upload. Tap any premium tile → upsell. Promote the user to premium via admin, retry: tile selection persists across a refetch.

### Step 9.7 — Commit

```bash
git add apps/mobile/src/screens/garage/CoverPickerSheet.tsx \
        apps/mobile/src/screens/garage/GarageHeader.tsx \
        apps/mobile/src/api/ \
        apps/mobile/src/copy/garage.ts
git commit -m "$(cat <<'EOF'
feat(mobile): CoverPickerSheet (preset grid + R2 upload)

Cover picker shows the 8-preset grid with a locked-pip overlay for
free users. Premium users get the upload tile, which presigns an R2
PUT under garage-cover/<userId>/ and then PATCHes the cover URL.
Picker tiles render via the same GarageCover component as the hero,
guaranteeing parity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 10 — BuySpotSheet + post-purchase highlight

**Files:**

- Create: `apps/mobile/src/screens/garage/BuySpotSheet.tsx`
- Modify: `apps/mobile/app/(app)/garage/index.tsx` (host sheet + handle `?highlight=` param)
- Modify: `apps/mobile/src/screens/garage/GarageListView.tsx` (`highlightSpotId` prop already added in chunk 06; verify it wires through)
- (Optional) Modify: cart webhook settle callback to deep-link to `/garage?highlight=<spotId>` — if a webhook → mobile push deep-link already exists, extend it; otherwise leave the URL params handling as the entry point.

Locked-contract impact: order settlement still goes through the same cart → checkout → webhook pipeline. This chunk only changes the _entry point_ (sheet) + the _return path_ (highlight pulse).

Visual canon: `screens.jsx` lines 714-775.

### Step 10.1 — BuySpotSheet

- [ ] Create `apps/mobile/src/screens/garage/BuySpotSheet.tsx`:

```tsx
import { SheetShell } from '@ccc/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { garageCopy } from '~/copy/garage';

type Props = {
  visible: boolean;
  priceLabel: string;
  onClose: () => void;
  onCheckoutPix: () => void;
  onCheckoutCard: () => void;
  submitting?: boolean;
};

export function BuySpotSheet({
  visible,
  priceLabel,
  onClose,
  onCheckoutPix,
  onCheckoutCard,
  submitting,
}: Props) {
  return (
    <SheetShell visible={visible} title="Comprar vaga adicional" onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.itemRow}>
          <View style={styles.itemGlyph} />
          <View style={styles.flex}>
            <Text style={styles.itemTitle}>Vaga adicional</Text>
            <Text style={styles.itemSub}>+1 espaço permanente na sua garagem.</Text>
          </View>
          <Text style={styles.itemPrice}>{priceLabel}</Text>
        </View>

        {[
          'Pagamento único (não é assinatura).',
          'A vaga aparece em até 60s após a confirmação.',
          'Você volta para a garagem automaticamente.',
        ].map((line) => (
          <View key={line} style={styles.bullet}>
            <Text style={styles.bulletDot}>✓</Text>
            <Text style={styles.bulletText}>{line}</Text>
          </View>
        ))}

        <View style={styles.ctas}>
          <Pressable
            onPress={onCheckoutPix}
            disabled={submitting}
            style={styles.ctaPix}
            accessibilityRole="button"
            accessibilityLabel="Pagar com Pix"
          >
            <Text style={styles.ctaPixLabel}>Pix</Text>
          </Pressable>
          <Pressable
            onPress={onCheckoutCard}
            disabled={submitting}
            style={styles.ctaCard}
            accessibilityRole="button"
            accessibilityLabel="Pagar com cartão"
          >
            <Text style={styles.ctaCardLabel}>Cartão</Text>
          </Pressable>
        </View>

        <Text style={styles.disclaimer}>Você pode cancelar antes de finalizar o pagamento.</Text>
      </View>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, gap: 12 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    gap: 12,
    marginBottom: 4,
  },
  itemGlyph: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(225,6,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(225,6,0,0.35)',
  },
  itemTitle: { color: '#F5F5F5', fontSize: 14, fontWeight: '700' },
  itemSub: { color: '#8A8A93', fontSize: 12, marginTop: 2 },
  itemPrice: { color: '#F5F5F5', fontSize: 15, fontWeight: '700' },
  flex: { flex: 1 },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletDot: { color: '#5DE08A', fontSize: 13 },
  bulletText: { flex: 1, color: '#C9C9CD', fontSize: 12, lineHeight: 17 },
  ctas: { flexDirection: 'row', gap: 8, marginTop: 6 },
  ctaPix: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#E10600',
    alignItems: 'center',
  },
  ctaPixLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  ctaCard: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1F1F1F',
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
  },
  ctaCardLabel: { color: '#F5F5F5', fontSize: 13, fontWeight: '700' },
  disclaimer: { color: '#8A8A93', fontSize: 11, textAlign: 'center', marginTop: 6, lineHeight: 16 },
});
```

### Step 10.2 — Wire from the route

- [ ] Edit `apps/mobile/app/(app)/garage/index.tsx`. Replace `handleBuySpot` with a sheet-opener instead of a cart-add + nav. Inside the sheet, the Pix/Cartão CTAs do exactly what `handleBuySpot` used to: call `addGarageSpotToCart` then push `/cart` for the existing flow. The sheet's value is keeping the user oriented before they leave.

```tsx
const [buySheet, setBuySheet] = useState<{ priceLabel: string } | null>(null);

const handleBuySpot = useCallback(() => {
  // Existing purchase-option resolution lives on the garage payload; lift
  // the label out (or re-fetch when the user taps Pix/Cartão).
  const priceCents = garage?.purchaseOption?.priceCents ?? 990;
  setBuySheet({ priceLabel: `R$ ${(priceCents / 100).toFixed(2).replace('.', ',')}` });
}, [garage]);

const goCheckout = useCallback(async () => {
  try {
    await addGarageSpotToCart();
    await refresh();
  } catch {
    showMessage(garageCopy.garage.buySpotFailed);
    return;
  }
  setBuySheet(null);
  router.push('/cart' as never);
}, [router, refresh]);

return (
  <View style={styles.container}>
    {/* ...GarageListView... */}
    <BuySpotSheet
      visible={buySheet !== null}
      priceLabel={buySheet?.priceLabel ?? ''}
      onClose={() => setBuySheet(null)}
      onCheckoutPix={() => void goCheckout()}
      onCheckoutCard={() => void goCheckout()}
    />
  </View>
);
```

For v1 both Pix and Cartão go to the same cart route. A real Pix-direct flow would skip `/cart`; deferred.

### Step 10.3 — `?highlight=<spotId>` handler

- [ ] Same route. Use `useLocalSearchParams` from `expo-router` to read `highlight`. Pass it to `GarageListView` via the `highlightSpotId` prop (already plumbed in chunk 06). Auto-clear after 2s via a `setTimeout`.

```tsx
const params = useLocalSearchParams<{ highlight?: string }>();
const [highlightSpotId, setHighlightSpotId] = useState<string | null>(null);

useEffect(() => {
  if (typeof params.highlight === 'string' && params.highlight.length > 0) {
    setHighlightSpotId(params.highlight);
    const t = setTimeout(() => setHighlightSpotId(null), 2000);
    return () => clearTimeout(t);
  }
  return undefined;
}, [params.highlight]);
```

### Step 10.4 — Visual smoke

- Tap a buy-spot stall. Sheet opens. Tap Pix. Sheet closes, `/cart` opens. (Existing cart flow takes over.)
- Manually navigate to `/garage?highlight=<an-existing-spot-id>`. The matching stall card pulses for 2s.

### Step 10.5 — Commit

```bash
git add apps/mobile/src/screens/garage/BuySpotSheet.tsx \
        apps/mobile/app/\(app\)/garage/index.tsx \
        apps/mobile/src/screens/garage/GarageListView.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): BuySpotSheet replaces direct /cart deep-link

Buy-spot stall card now opens a quick-confirm sheet (line item +
3 bullets + Pix/Cartão CTAs) before pushing to /cart. ?highlight=
URL param pulses the affected stall for 2s on return.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 11 — Share link fix (PUBLIC_PROFILE_BASE_URL)

**Files:**

- Create: `apps/mobile/src/config/urls.ts`
- Modify: `apps/mobile/src/screens/garage/GarageHeader.tsx` (the wrapper from chunk 8)

### Step 11.1 — Config constant

- [ ] Create `apps/mobile/src/config/urls.ts`:

```ts
// Public profile base — full URL is needed for Share.share so the recipient
// sees a tappable link, not a path-only string. Domain is env-dependent in
// the long run; for now hardcoded to the production app domain.
export const PUBLIC_PROFILE_BASE_URL = 'https://jdmexp.app/g';

export const publicGarageUrl = (slug: string): string => `${PUBLIC_PROFILE_BASE_URL}/${slug}`;
```

### Step 11.2 — Replace `handleShare`

- [ ] Edit `apps/mobile/src/screens/garage/GarageHeader.tsx`. Replace the share call with:

```tsx
import { publicGarageUrl } from '~/config/urls';

const url = publicGarageUrl(garage.slug);
await Share.share({ message: url, url, title: garage.name });
```

### Step 11.3 — Commit

```bash
git add apps/mobile/src/config/urls.ts apps/mobile/src/screens/garage/GarageHeader.tsx
git commit -m "$(cat <<'EOF'
fix(mobile): share full https URL not bare path

Share.share now emits https://jdmexp.app/g/<slug> across both message
and url payloads. Path-only share was untappable on iOS.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 12 — Slug error mapping refinement

Most of the work already landed in chunk 08 (`EditGarageSheet`). The server side may still need to emit `invalid_slug` instead of relying on the zod parse error.

### Step 12.1 — Audit server response codes

Run: `git grep -n "invalid_slug\|reserved_slug\|slug_taken" apps/api/src/`
Verify: route emits `400 reserved_slug` for reserved set, `409 slug_taken` for unique-constraint, and zod parse failures bubble as the existing global 400 schema. The client trap in `EditGarageSheet` already maps the zod body shape.

If the server's zod parse error doesn't expose `error: 'invalid_slug'`, add a guard in the route handler before passing to Prisma:

```ts
if (patch.slug !== undefined && !/^[a-z0-9-]+$/.test(patch.slug)) {
  return reply.status(400).send({ error: 'invalid_slug' });
}
```

### Step 12.2 — Add server-side integration test

- [ ] Extend `apps/api/test/garage/me-garage.test.ts` (or a sibling file): PATCH with `slug: 'Foo Bar!'`. Expect `400` with body `error: invalid_slug`.

### Step 12.3 — Commit

```bash
git add apps/api/src/routes/garage.ts apps/api/test/garage/
git commit -m "$(cat <<'EOF'
fix(api): emit 400 invalid_slug for regex-violating slugs

Server now distinguishes invalid_slug from reserved_slug and
slug_taken. Mobile EditGarageSheet maps each to the correct copy
(UX-Audit B.3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 13 — SSR public garage view

**Files:**

- Create: `apps/admin/app/g/[slug]/page.tsx`
- Create: `apps/admin/app/g/[slug]/not-found.tsx`
- Create: `apps/admin/src/components/public-garage-view.tsx`
- Create: `apps/admin/src/lib/public-garage.ts` (server-side fetch helper that hits the api)
- (Optional) Modify: `apps/admin/next.config.{ts,js}` to handle the `/g/:slug` route under the public area without auth

Locked-contract impact: anti-enumeration 404 must be identical for unknown slug vs private slug. Same status, same body, same render.

### Step 13.1 — Server-side fetch helper

- [ ] Create `apps/admin/src/lib/public-garage.ts`:

```ts
import { garagePublicResponseSchema, type GaragePublicResponse } from '@ccc/shared/garage-public';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const fetchPublicGarage = async (slug: string): Promise<GaragePublicResponse | null> => {
  const res = await fetch(`${API_BASE}/g/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const json: unknown = await res.json();
  return garagePublicResponseSchema.parse(json);
};
```

### Step 13.2 — `not-found.tsx` (anti-enumeration)

- [ ] Create `apps/admin/app/g/[slug]/not-found.tsx`:

```tsx
// lucide-react is not an admin dependency in this workspace. Inline an SVG
// glyph or use an existing icon source. Example placeholder:
const LockIcon = ({ size = 28 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export default function PublicGarageNotFound() {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-8 text-center">
      <div className="w-18 h-18 rounded-full bg-surface-alt border border-border flex items-center justify-center text-muted mb-4">
        <LockIcon size={28} />
      </div>
      <h1 className="text-fg text-lg font-bold">Garagem não encontrada</h1>
      <p className="text-muted text-sm mt-1 leading-relaxed max-w-xs">
        Este link pode ter sido removido, estar privado ou nunca ter existido.
      </p>
      <div className="mt-4 px-2.5 py-1.5 rounded bg-surface-alt border border-border text-muted text-[10px] tracking-wider font-mono">
        HTTP 404 · /g/{'<slug>'}
      </div>
    </div>
  );
}
```

### Step 13.3 — `page.tsx`

- [ ] Create `apps/admin/app/g/[slug]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';

import { PublicGarageView } from '~/components/public-garage-view';
import { fetchPublicGarage } from '~/lib/public-garage';

export default async function PublicGaragePage({ params }: { params: { slug: string } }) {
  const data = await fetchPublicGarage(params.slug);
  if (!data) notFound();
  return <PublicGarageView garage={data.garage} cars={data.cars} />;
}
```

### Step 13.4 — Component

- [ ] Create `apps/admin/src/components/public-garage-view.tsx`. SSR-friendly version of the IdentityCard + cover. Cars rendered without source-aware tape (per design §"Public — /g/:slug"). Use Tailwind classes that already exist in the admin config.

```tsx
import type { GaragePublicResponse } from '@ccc/shared/garage-public';
import { PremiumBadge } from '@ccc/ui';

type Props = {
  garage: GaragePublicResponse['garage'];
  cars: GaragePublicResponse['cars'];
};

export function PublicGarageView({ garage, cars }: Props) {
  // SSR-side cover: render preset gradient via inline CSS to avoid pulling
  // expo-linear-gradient into next.js. Keep the resolver logic in shared.
  return (
    <main className="min-h-screen bg-bg">
      <PublicGarageCover preset={garage.coverPreset} customUrl={garage.coverImageUrl} />
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
              jdmexp.app/g/{garage.slug}
            </div>
          </div>
        </div>
        {garage.description ? (
          <p className="text-fg-secondary text-[13px] leading-relaxed mt-2.5">
            {garage.description}
          </p>
        ) : null}
      </section>

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
          {cars.map((car) => (
            <li
              key={car.id}
              className="bg-surface border border-border rounded-2xl overflow-hidden"
            >
              {/* Mirror the ParkingStallCard layout but skip the slot plate + source tape */}
              <div className="h-32 bg-surface-deep" /* preview placeholder */ />
              <div className="px-4 py-3 bg-surface-deep border-t border-border">
                <p className="text-fg text-sm font-bold">
                  {car.year} {car.make} {car.model}
                </p>
                {car.nickname ? <p className="text-muted text-xs mt-0.5">{car.nickname}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function PublicGarageCover({
  preset,
  customUrl,
}: {
  preset: string | null;
  customUrl: string | null;
}) {
  if (customUrl) {
    return (
      <div className="w-full h-44 relative">
        <img src={customUrl} alt="" className="w-full h-44 object-cover" />
      </div>
    );
  }
  // See §C13 — use GARAGE_COVER_PRESETS + resolveGarageCoverSlug for all
  // 10 presets, not a hardcoded subset. With bundled artwork the SSR view
  // renders `<img src={publicUrl(garage-cover-presets/<slug>@2x.jpg)} />`
  // instead of a gradient fallback. Gradient fallback only kicks in when
  // R2 artwork is missing (dev / staging-without-upload).
  const palette = ['#1F1F1F', '#0A0A0A']; // default-door fallback gradient only
  return (
    <div
      className="w-full h-44"
      style={{ background: `linear-gradient(180deg, ${palette[0]} 0%, ${palette[1]} 100%)` }}
    />
  );
}
```

(Production cleanup: extract the palette table into a shared util once SSR + mobile share enough of `GarageCover` to avoid duplication. For v1, duplication is acceptable.)

### Step 13.5 — Anti-enumeration test

- [ ] Add `apps/admin/src/__tests__/public-garage-page.test.tsx` (or wherever the existing admin SSR tests live):
  1. Mock `fetchPublicGarage` to return `null`. Assert `notFound()` was called.
  2. Mock the fetch to return a valid payload. Assert `<PublicGarageView />` renders.
  3. Verify the not-found.tsx output does NOT include any text that differs between "unknown slug" and "private slug" cases — both must render the exact same component.

### Step 13.6 — Commit

```bash
git add apps/admin/app/g/ apps/admin/src/components/public-garage-view.tsx apps/admin/src/lib/public-garage.ts
git commit -m "$(cat <<'EOF'
feat(admin): SSR public garage view at /g/:slug

Non-app visitors get a polished HTML view instead of raw JSON.
404 mirrors the API's anti-enumeration behavior: unknown slug and
private slug render the identical not-found page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 14 — Welcome banner + section header + expired notice

**Files:**

- Create: `apps/mobile/src/screens/garage/WelcomeBanner.tsx`
- Create: `apps/mobile/src/screens/garage/ExpiredPremiumNotice.tsx`
- Create: `apps/mobile/src/screens/garage/VagasSectionHeader.tsx`
- Modify: `apps/mobile/app/(app)/garage/index.tsx`
- Modify: `apps/mobile/src/screens/garage/GarageListView.tsx` (accept these as `ListHeaderComponent` children)

Locked-contract impact: none. Pure presentation.

### Step 14.1 — WelcomeBanner

- [ ] Create `apps/mobile/src/screens/garage/WelcomeBanner.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';

import { garageCopy } from '~/copy/garage';

export function WelcomeBanner({ freeLimit }: { freeLimit: number | null }) {
  return (
    <View style={styles.card}>
      <View style={styles.glyph}>
        <Text style={styles.glyphChar}>✨</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{garageCopy.garage.welcomeTitle}</Text>
        <Text style={styles.bodyText}>{garageCopy.garage.welcomeBody(freeLimit)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(225,6,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(225,6,0,0.35)',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  glyph: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(225,6,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphChar: { color: '#FF1A0D', fontSize: 14, lineHeight: 16 },
  body: { flex: 1 },
  title: { color: '#F5F5F5', fontSize: 13, fontWeight: '700' },
  bodyText: { color: '#C9C9CD', fontSize: 12, marginTop: 2, lineHeight: 17 },
});
```

### Step 14.2 — ExpiredPremiumNotice

- [ ] Create `apps/mobile/src/screens/garage/ExpiredPremiumNotice.tsx`:

```tsx
import { StyleSheet, Text, View } from 'react-native';

import { garageCopy } from '~/copy/garage';

export function ExpiredPremiumNotice() {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{garageCopy.garage.expiredTitle}</Text>
      <Text style={styles.body}>{garageCopy.garage.expiredBody}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
  },
  title: { color: '#FFC04A', fontSize: 13, fontWeight: '700' },
  body: { color: '#C9C9CD', fontSize: 12, marginTop: 4, lineHeight: 17 },
});
```

### Step 14.3 — VagasSectionHeader

- [ ] Create `apps/mobile/src/screens/garage/VagasSectionHeader.tsx`. Computes the capacity-mode label from `garage` + `slotsInUse`:

```tsx
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

export function VagasSectionHeader(props: Props) {
  const denom = props.isUnlimited ? '∞' : String(props.freeLimit ?? '—');
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={styles.title}>{garageCopy.garage.sectionVagasTitle}</Text>
        <Text style={styles.count}>
          {props.carCount}/{denom}
        </Text>
      </View>
      <Text style={styles.mode}>{modeLabel(props)}</Text>
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
  },
  left: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { color: '#F5F5F5', fontSize: 15, fontWeight: '700', letterSpacing: -0.1 },
  count: { color: '#8A8A93', fontSize: 12 },
  mode: { color: '#8A8A93', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
});
```

### Step 14.4 — Hook into the route header

- [ ] Edit `apps/mobile/app/(app)/garage/index.tsx`. Replace the `ListHeaderComponent` with a fragment that stacks:
  1. `<GarageHeader … />` (cover + identity card + sheets)
  2. `<WelcomeBanner />` when fresh-signup (`cars.length === 0 && !garage.garage.isPremiumActive`)
  3. `<ExpiredPremiumNotice />` when `daysLeftUntilExpiry === 0` AND `premiumTier !== null`
  4. `<VagasSectionHeader />`

The "state" classification (`fresh`/`partial`/`at-cap`/`unlimited`/`mixed`/`expired`) doesn't need to live in state — derive at render from `garage` + `cars`. Keep helper functions local to this file.

### Step 14.5 — Visual smoke

Confirm each state renders correctly:

- Fresh signup: welcome banner present, no expired notice.
- Free-but-populated: no banner, section header reads `GRÁTIS` or `NO LIMITE`.
- Premium expired: expired notice present, cover falls back to default-door (renderer rule), badge hidden.

### Step 14.6 — Commit

```bash
git add apps/mobile/src/screens/garage/WelcomeBanner.tsx \
        apps/mobile/src/screens/garage/ExpiredPremiumNotice.tsx \
        apps/mobile/src/screens/garage/VagasSectionHeader.tsx \
        apps/mobile/app/\(app\)/garage/index.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): welcome banner + expired notice + vagas section header

Fresh-signup state explains the garage construct + slot count.
Expired-premium state surfaces a warning-tinted notice. Section
header carries the capacity mode (GRÁTIS / GRÁTIS+EXTRA / NO LIMITE
/ ILIMITADO). Together they close the UX-Audit A.1 + B.7 gaps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

# Conquistas (chunks 15-22)

Pulled into Phase 1 per the post-review decision. Catalog of 12 hex-shaped achievement badges across 4 categories × 3 rarities. Owner-side full catalog + locked states; public-side allowlist-strict pinned subset, ordered by `pinnedAt DESC NULLS LAST`. Awarder fires from existing service write paths. Premium membership and Conquistas are independent EXCEPT for the `premiumExclusive: boolean` discriminator on the `Badge` model — premium-exclusive entries gate on `isPremiumActive` at award time AND on public render after lapse (the public profile hides earned premium-exclusive badges while premium is inactive).

**Locked at kickoff (in addition to Phase 1's locked invariants):**

- Killswitch `GeneralSettings.gamificationEnabled` (single source of truth for Phase 1 Conquistas + Phase 2 XP). Awarders + serializers read it synchronously every call — no cache.
- Public payload for Conquistas: `{ code, earnedAt }[]` pinned-only, ordered `pinnedAt DESC NULLS LAST`. Premium-exclusive entries omitted from this array when `isPremiumActive === false`.
- DSR anonymize MUST `prisma.garageBadge.deleteMany({ where: { garage: { userId } } })` explicitly inside the existing anonymization tx. FK cascade does NOT fire (Garage row scrubbed, not deleted).
- COM-002, COM-003: catalog entries seeded (so `GET /badges/catalog` shows them as locked), awarders deferred to a follow-up. Acceptable user-visible state in v1: "Bloqueado" with criteria copy + no progress bar.
- EVT-002: ordered streak query — most recent 3 consecutive `Checkin` rows by `event.startsAt` (no missed events in between). Reset on any non-consecutive check-in.
- JDM-003 ("Fundador"): awarder hooks into the signup tx (not backfill — Phase 2 dropped backfill globally). Award if `User.createdAt < 2026-06-01` at signup time. Manual admin grant covers any user who slipped through.

---

## Chunk 15 — Conquistas foundations (schema + killswitch + zod + copy + catalog)

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (extend Garage relations + `GeneralSettings` + new Badge/GarageBadge models + enums).
- Create: `packages/db/prisma/migrations/<ts>_garage_conquistas/migration.sql`.
- Modify: `packages/db/prisma/seed.ts` (seed 12-row catalog).
- Create: `packages/shared/src/badges.ts`.
- Modify: `packages/shared/src/admin.ts` — add audit actions.
- Modify: `packages/shared/package.json` — add `./badges` subpath export.
- Create: `apps/mobile/src/copy/badges.ts` (+ EN scaffold).

### Step 15.1 — Schema delta

Add to `schema.prisma`:

```prisma
enum BadgeCategory { eventos carros comunidade jdm }
enum BadgeRarity   { common rare legendary }

model Badge {
  id                String        @id @default(cuid())
  code              String        @unique @db.VarChar(20)
  category          BadgeCategory
  rarity            BadgeRarity
  premiumExclusive  Boolean       @default(false)
  icon              String        @db.VarChar(40)  // glyph key matching BadgeGlyph map
  createdAt         DateTime      @default(now())

  garageBadges GarageBadge[]
}

model GarageBadge {
  id        String    @id @default(cuid())
  garageId  String
  badgeCode String    @db.VarChar(20)
  earnedAt  DateTime  @default(now())
  pinned    Boolean   @default(false)
  pinnedAt  DateTime?
  sourceRef String?   @db.VarChar(120)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  garage Garage @relation(fields: [garageId], references: [id], onDelete: Cascade)
  badge  Badge  @relation(fields: [badgeCode], references: [code], onDelete: Restrict)

  @@unique([garageId, badgeCode])
  @@index([garageId, pinned])
  @@index([garageId, pinnedAt])
}
```

Add `garageBadges GarageBadge[]` to the existing `Garage` model.

Extend the existing `GeneralSettings` (verify model name via `grep -n 'model GeneralSettings' packages/db/prisma/schema.prisma`; if it does not exist as a standalone, find the row carrying `defaultFreeGarageSpots`):

```prisma
  gamificationEnabled Boolean @default(true)
```

Generate the migration:

```bash
pnpm --filter @ccc/db prisma migrate dev --name garage_conquistas --create-only
```

Verify generated SQL adds enums + tables + the single column to `GeneralSettings` + nothing else.

### Step 15.2 — Catalog seed

Edit `packages/db/prisma/seed.ts` (verify path; the file may live under `packages/db/src/seed.ts` — adjust accordingly). Add:

```ts
const BADGES = [
  { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag', premiumExclusive: false },
  { code: 'EVT-002', category: 'eventos', rarity: 'rare', icon: 'streak', premiumExclusive: false },
  {
    code: 'EVT-003',
    category: 'eventos',
    rarity: 'legendary',
    icon: 'medal',
    premiumExclusive: false,
  },
  { code: 'CAR-001', category: 'carros', rarity: 'common', icon: 'car', premiumExclusive: false },
  {
    code: 'CAR-002',
    category: 'carros',
    rarity: 'rare',
    icon: 'garageFull',
    premiumExclusive: false,
  },
  {
    code: 'CAR-003',
    category: 'carros',
    rarity: 'legendary',
    icon: 'curator',
    premiumExclusive: false,
  },
  {
    code: 'COM-001',
    category: 'comunidade',
    rarity: 'common',
    icon: 'post',
    premiumExclusive: false,
  },
  {
    code: 'COM-002',
    category: 'comunidade',
    rarity: 'rare',
    icon: 'chat',
    premiumExclusive: false,
  },
  {
    code: 'COM-003',
    category: 'comunidade',
    rarity: 'legendary',
    icon: 'fire',
    premiumExclusive: false,
  },
  { code: 'JDM-001', category: 'jdm', rarity: 'common', icon: 'pin', premiumExclusive: false },
  { code: 'JDM-002', category: 'jdm', rarity: 'rare', icon: 'flagCheck', premiumExclusive: false },
  {
    code: 'JDM-003',
    category: 'jdm',
    rarity: 'legendary',
    icon: 'founder',
    premiumExclusive: false,
  },
] as const;

for (const b of BADGES) {
  await prisma.badge.upsert({
    where: { code: b.code },
    create: b,
    update: {
      category: b.category,
      rarity: b.rarity,
      icon: b.icon,
      premiumExclusive: b.premiumExclusive,
    },
  });
}
```

### Step 15.3 — Shared zod schemas

Create `packages/shared/src/badges.ts`:

```ts
import { z } from 'zod';

export const BADGE_CODE_RE = /^[A-Z]{3}-\d{3}$/;
export const badgeCodeSchema = z.string().regex(BADGE_CODE_RE);

export const badgeCategorySchema = z.enum(['eventos', 'carros', 'comunidade', 'jdm']);
export const badgeRaritySchema = z.enum(['common', 'rare', 'legendary']);

export const badgeCatalogEntrySchema = z.object({
  code: badgeCodeSchema,
  category: badgeCategorySchema,
  rarity: badgeRaritySchema,
  premiumExclusive: z.boolean(),
  icon: z.string().min(1).max(40),
});

// Owner-shape: includes locked + earned + lockedPremium states.
export const garageBadgeOwnerStateSchema = z.union([
  z.object({
    code: badgeCodeSchema,
    state: z.literal('earned'),
    earnedAt: z.string().datetime(),
    pinned: z.boolean(),
    pinnedAt: z.string().datetime().nullable(),
  }),
  z.object({ code: badgeCodeSchema, state: z.literal('locked') }),
  z.object({ code: badgeCodeSchema, state: z.literal('locked_premium') }), // gated on isPremiumActive
]);
export type GarageBadgeOwnerState = z.infer<typeof garageBadgeOwnerStateSchema>;

// Public-shape: pinned earned only.
export const garageBadgePublicSchema = z.object({
  code: badgeCodeSchema,
  earnedAt: z.string().datetime(),
});

export const garageBadgesOwnerResponseSchema = z.object({
  enabled: z.boolean(), // mirrors gamification flag
  catalog: z.array(badgeCatalogEntrySchema),
  badges: z.array(garageBadgeOwnerStateSchema),
});

export const badgeCatalogResponseSchema = z.object({
  enabled: z.boolean(),
  catalog: z.array(badgeCatalogEntrySchema),
});
```

Add to `packages/shared/package.json` exports:

```json
"./badges": { "types": "./dist/badges.d.ts", "import": "./dist/badges.js" }
```

Rebuild: `pnpm --filter @ccc/shared build`.

### Step 15.4 — Audit actions

Extend `packages/shared/src/admin.ts` `adminAuditActionSchema`:

```ts
'badge.award',
'badge.pin',
'badge.unpin',
'gamification.toggle',
```

### Step 15.5 — Copy

Create `apps/mobile/src/copy/badges.ts` (PT-BR primary). Catalog titles + descriptions + criteria — 12 entries, copy verbatim from the design `badges.jsx` lines 18-35. Include category labels (Eventos / Carros / Comunidade / JDM) + rarity labels (Comum / Raro / Lendário) + locked-premium label ("Exclusivo Premium"). Add EN scaffold same shape.

### Step 15.6 — Capability flag on existing garage payloads

Extend `garageReadSchema` (chunk 02 / 04) + `garagePublicResponseSchema` with a `gamification: { enabled: boolean }` capability flag. Both serializers read `GeneralSettings.gamificationEnabled` synchronously per request. **No cache.** When `false`: every Conquistas response (this chunk + the routes in chunk 17) returns `enabled: false` + empty arrays.

### Step 15.7 — Commit

```bash
git add packages/db/prisma/ packages/shared/src/badges.ts packages/shared/src/admin.ts packages/shared/package.json apps/mobile/src/copy/badges.ts
git commit -m "$(cat <<'EOF'
feat(db,shared,mobile): Conquistas foundations + killswitch + catalog seed

Badge + GarageBadge models + 12-row catalog seed. GeneralSettings.gamificationEnabled
killswitch column. Shared zod for owner/public/catalog payloads. Audit
action enum extended. PT-BR + EN copy scaffolding.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 16 — Badges API routes

**Files:**

- Create: `apps/api/src/routes/badges-catalog.ts` — `GET /badges/catalog` (public, no auth).
- Modify: `apps/api/src/routes/garage.ts` — register `GET /me/garage/badges` + `PATCH /me/garage/badges/:code/pin`.
- Modify: `apps/api/src/app.ts` — register the new catalog route.
- Modify: `apps/api/src/routes/garage.ts` serializer paths — `serializeGarageOwner` + `serializeGaragePublic` start returning `badges` array.
- Create: `apps/api/src/services/garage/badges-read.ts` — owner-state aggregator (earned + locked + lockedPremium classification).
- Create: `apps/api/test/garage/badges.test.ts` — integration tests, real Postgres.

### Step 16.1 — Catalog route

```ts
// apps/api/src/routes/badges-catalog.ts
import type { FastifyPluginAsync } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@ccc/db';

import { readGamificationEnabled } from '../services/garage/killswitch.js';

let cachedAt = 0;
let cached: Awaited<ReturnType<typeof prisma.badge.findMany>> | null = null;

const TTL_MS = 5 * 60 * 1000;

export const badgesCatalogRoute: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `badges-catalog:${req.ip}`,
  });

  app.get('/badges/catalog', async () => {
    const enabled = await readGamificationEnabled();
    if (!enabled) return { enabled: false, catalog: [] };
    const now = Date.now();
    if (!cached || now - cachedAt > TTL_MS) {
      cached = await prisma.badge.findMany({ orderBy: { code: 'asc' } });
      cachedAt = now;
    }
    return {
      enabled: true,
      catalog: cached.map((b) => ({
        code: b.code,
        category: b.category,
        rarity: b.rarity,
        premiumExclusive: b.premiumExclusive,
        icon: b.icon,
      })),
    };
  });
};
```

`readGamificationEnabled()` lives at `apps/api/src/services/garage/killswitch.js`:

```ts
import { prisma } from '@ccc/db';

export const readGamificationEnabled = async (): Promise<boolean> => {
  const row = await prisma.generalSettings.findFirst({ select: { gamificationEnabled: true } });
  return row?.gamificationEnabled ?? true;
};
```

**No cache** on this helper — read every call. The catalog itself can be cached (5min) because it never changes at runtime; the flag cannot be cached because admin must propagate killswitch in < 1s.

### Step 16.2 — Cache invalidation on toggle

The general-settings PATCH handler that flips `gamificationEnabled` MUST clear the catalog cache:

```ts
import { invalidateBadgesCatalogCache } from '../../routes/badges-catalog.js';
// ...
invalidateBadgesCatalogCache();
```

Export an `invalidateBadgesCatalogCache()` function from `badges-catalog.ts` that sets `cached = null`.

### Step 16.3 — Owner badges route + serializer extension

Add to `apps/api/src/routes/garage.ts` (inside the existing authenticated scope):

```ts
scoped.get('/me/garage/badges', async (request) => {
  const { sub } = requireUser(request);
  const enabled = await readGamificationEnabled();
  if (!enabled) return { enabled: false, catalog: [], badges: [] };

  const garage = await ensureGarageForUser(sub);
  const [catalog, earned] = await Promise.all([
    prisma.badge.findMany({ orderBy: { code: 'asc' } }),
    prisma.garageBadge.findMany({
      where: { garageId: garage.id },
      orderBy: { earnedAt: 'desc' },
    }),
  ]);
  const isPremiumActive = computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
  const earnedMap = new Map(earned.map((e) => [e.badgeCode, e]));

  const states = catalog.map((b) => {
    const e = earnedMap.get(b.code);
    if (e) {
      return {
        code: b.code,
        state: 'earned' as const,
        earnedAt: e.earnedAt.toISOString(),
        pinned: e.pinned,
        pinnedAt: e.pinnedAt?.toISOString() ?? null,
      };
    }
    if (b.premiumExclusive && !isPremiumActive) {
      return { code: b.code, state: 'locked_premium' as const };
    }
    return { code: b.code, state: 'locked' as const };
  });

  return {
    enabled: true,
    catalog: catalog.map((b) => ({
      code: b.code,
      category: b.category,
      rarity: b.rarity,
      premiumExclusive: b.premiumExclusive,
      icon: b.icon,
    })),
    badges: states,
  };
});
```

### Step 16.4 — Pin route (3-cap)

```ts
scoped.patch<{ Params: { code: string }; Body: { pinned: boolean } }>(
  '/me/garage/badges/:code/pin',
  async (request, reply) => {
    const { sub } = requireUser(request);
    const enabled = await readGamificationEnabled();
    if (!enabled) return reply.status(409).send({ error: 'gamification_disabled' });

    const { code } = request.params;
    const { pinned } = z.object({ pinned: z.boolean() }).parse(request.body);

    const garage = await ensureGarageForUser(sub);
    const existing = await prisma.garageBadge.findUnique({
      where: { garageId_badgeCode: { garageId: garage.id, badgeCode: code } },
    });
    if (!existing) return reply.status(404).send({ error: 'not_found' });

    if (pinned) {
      const currentPins = await prisma.garageBadge.count({
        where: { garageId: garage.id, pinned: true },
      });
      if (!existing.pinned && currentPins >= 3)
        return reply.status(409).send({ error: 'pin_limit' });
    }

    const updated = await prisma.garageBadge.update({
      where: { garageId_badgeCode: { garageId: garage.id, badgeCode: code } },
      data: { pinned, pinnedAt: pinned ? new Date() : null },
    });

    await writeAdminAudit({
      actorId: sub,
      action: pinned ? 'badge.pin' : 'badge.unpin',
      entity: `garage:${garage.id}`,
      metadata: { badgeCode: code },
    });

    return {
      badge: {
        code: updated.badgeCode,
        earnedAt: updated.earnedAt.toISOString(),
        pinned: updated.pinned,
        pinnedAt: updated.pinnedAt?.toISOString() ?? null,
      },
    };
  },
);
```

Rate-limit `20/min/user` via the existing scoped limiter or a new one. `writeAdminAudit` is the existing helper (verify name via `grep -nE 'writeAdminAudit|adminAudit\.create' apps/api/src/`).

### Step 16.5 — Extend GarageOwner + GaragePublic serializers

Owner serializer adds `badges` field (full owner-state array). Public serializer adds `badges` field (pinned-only, ordered `pinnedAt DESC NULLS LAST`, premium-exclusive **omitted while `!isPremiumActive`**):

```ts
const publicBadges = await prisma.garageBadge.findMany({
  where: {
    garageId: garage.id,
    pinned: true,
    badge: isPremiumActive ? undefined : { premiumExclusive: false },
  },
  orderBy: [{ pinnedAt: 'desc' }],
  include: { badge: { select: { premiumExclusive: true } } },
});
return publicBadges.map((b) => ({ code: b.badgeCode, earnedAt: b.earnedAt.toISOString() }));
```

The `isPremiumActive ? undefined : { premiumExclusive: false }` predicate hides earned-but-premium-exclusive badges on the public profile while premium is inactive — per locked decision.

### Step 16.6 — Integration tests

`apps/api/test/garage/badges.test.ts` uses real helpers (`makeApp`, `resetDatabase`, `createUser`, `bearer`) + direct `prisma.garageBadge.create()` to seed badge state. Tests cover: empty state, pinned ordering, 3-pin cap (4th = 409), locked vs lockedPremium classification, killswitch off → empty arrays + `enabled: false`, premium-exclusive hidden on public after premium lapse.

### Step 16.7 — Commit

```bash
git add apps/api/src/routes/badges-catalog.ts \
        apps/api/src/services/garage/killswitch.ts \
        apps/api/src/services/garage/badges-read.ts \
        apps/api/src/routes/garage.ts \
        apps/api/src/app.ts \
        apps/api/test/garage/badges.test.ts
git commit -m "$(cat <<'EOF'
feat(api): badges catalog + owner badges read + pin route + killswitch

GET /badges/catalog (5-min cache, killswitch-aware), GET /me/garage/badges
(per-user owner-state classification), PATCH /me/garage/badges/:code/pin
(3-cap, pinned/pinnedAt updates, audit). Public payload pins ordered
pin-time desc, premium-exclusive masked under lapse.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 17 — HexBadge + BadgeRow + BadgesSheet + BadgeDetail (mobile RN)

**Files:**

- Create: `packages/ui/src/HexBadge.tsx`
- Create: `packages/ui/src/BadgeRow.tsx`
- Create: `packages/ui/src/BadgesSheet.tsx`
- Create: `packages/ui/src/BadgeDetail.tsx`
- Create: `packages/ui/src/BadgeGlyph.tsx` — Lucide-RN icon keyed by catalog `icon` field.
- Create: `packages/ui/src/__tests__/HexBadge.test.tsx`, `BadgeRow.test.tsx`
- Modify: `packages/ui/src/index.ts` — export all four

Visual canon: `.handoffs/design-handoff/design_handoff_garage_redesign/jdma-garage/badges.jsx`. Translate 1:1 to RN. `clip-path` doesn't exist in RN — use `react-native-svg` `Polygon` for the hex shape. Sizes `sm: 32`, `md: 52`, `lg: 96`. Earned/locked/locked_premium variants. `premiumExclusive` prop accepted; v1 renders an "Exclusivo Premium" tag on the locked_premium variant.

Tests cover: earned variant renders glyph, locked renders lock glyph + grayscale, locked_premium renders Premium tag, onPress fires.

Commit message: `feat(ui): HexBadge + BadgeRow + BadgesSheet + BadgeDetail (mobile)`.

---

## Chunk 18 — Awarder service + write-path hooks

**Files:**

- Create: `apps/api/src/services/garage/awarder.ts` — `awardBadge(tx, garageId, code, sourceRef?)` core.
- Create: `apps/api/src/services/garage/eligibility/{cars,events,feed,signup}.ts` — one file per surface, each exports a `checkEligibility(tx, garageId): Promise<BadgeCode[]>` function.
- Modify: `apps/api/src/services/tickets/check-in.ts` — invoke `checkEligibility(eventsSurface)` in same tx as the Checkin.create. Awards `EVT-001`, `EVT-002` (streak query), `EVT-003`, `JDM-001` (city = Curitiba), `JDM-002` (event.type = drift).
- Modify: `apps/api/src/routes/cars.ts` (POST handler) — invoke `checkEligibility(carsSurface)` after `prisma.car.create`. Awards `CAR-001`, `CAR-002` (free limit fully consumed), `CAR-003` (5+ cars).
- Modify: `apps/api/src/routes/feed.ts` (POST feed) — invoke `checkEligibility(feedSurface)`. Awards `COM-001` only (COM-002 + COM-003 deferred — see lockedfor scope).
- Modify: signup tx (locate via `grep -nE 'POST /auth/signup|prisma.user.create' apps/api/src/`) — invoke `checkEligibility(signupSurface)`. Awards `JDM-003` if `User.createdAt < 2026-06-01`.
- Modify: admin user-detail route — admin manual grant `POST /admin/users/:id/garage/badges/:code/grant` (admin-only, rate-limited, audit-logged).

**Premium-exclusive gate (CRITICAL — enforced at every award path):**

```ts
// apps/api/src/services/garage/awarder.ts (excerpt)
export const awardBadge = async (
  tx: Prisma.TransactionClient,
  garageId: string,
  code: string,
  sourceRef: string | null,
  opts: { actorId?: string; allowAdminOverride?: boolean } = {},
): Promise<{
  awarded: boolean;
  reason?: 'gamification_disabled' | 'premium_required' | 'already_earned';
}> => {
  const enabled = await readGamificationEnabled();
  if (!enabled) return { awarded: false, reason: 'gamification_disabled' };

  const badge = await tx.badge.findUnique({ where: { code } });
  if (!badge) throw new Error(`unknown badge ${code}`);

  const garage = await tx.garage.findUnique({ where: { id: garageId } });
  if (!garage) throw new Error(`unknown garage ${garageId}`);

  if (badge.premiumExclusive) {
    const isPremium = computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
    if (!isPremium && !opts.allowAdminOverride) {
      return { awarded: false, reason: 'premium_required' };
    }
  }

  try {
    await tx.garageBadge.create({
      data: { garageId, badgeCode: code, sourceRef },
    });
    await writeAdminAudit({
      actorId: opts.actorId ?? `system:awarder`,
      action: 'badge.award',
      entity: `garage:${garageId}`,
      metadata: { badgeCode: code, sourceRef },
    });
    return { awarded: true };
  } catch (e) {
    if (isUniqueConstraintError(e)) return { awarded: false, reason: 'already_earned' };
    throw e;
  }
};
```

**Manual admin grant explicit override:** admin route passes `opts.allowAdminOverride: true` so the premium-exclusive gate can be bypassed for support cases (decision was made at kickoff: admin CAN grant premium-exclusive to non-premium users intentionally). Decision deviates from the reviewer's recommendation; document the exception in a route comment.

**EVT-002 (streak) query:**

```ts
// Eligibility: last 3 Checkin rows by Ticket.event.startsAt are consecutive (no missed events between them).
// 'Consecutive' = the user's last 3 attended events match the global last 3 events they were registered for.
// This is the simplest streak definition; product can refine later.
```

Provide the exact query in the eligibility file. Skip pseudocode; ship a Prisma `findMany` + an explicit ordering check.

### Step 18.x — Manual admin grant route

`POST /admin/users/:id/garage/badges/:code/grant` (admin-role gated via the existing `requireAdmin` middleware; verify name with `grep`). Body empty. Rate-limit 30/min/admin. Audit-log entry `badge.award` with `actorId: <adminUserId>` + `sourceRef: 'admin:<adminUserId>'`. Premium-exclusive gate is bypassable via `allowAdminOverride: true`.

### Step 18.y — Integration tests (real Postgres)

- Awarder idempotency: calling twice with same `(garageId, code)` → `already_earned` on the second.
- Premium-exclusive gate fires on non-admin path.
- Admin override bypass works.
- Killswitch off → no awards happen.
- Like-revert (Phase 2 will handle XP; Phase 1 Conquistas does not have a revert path — badges, once earned, stay).

### Step 18.z — Commit

`feat(api): badge awarder + write-path hooks + admin manual grant`.

---

## Chunk 19 — Mobile route integration

**Files:**

- Modify: `apps/mobile/app/(app)/garage/index.tsx` — render `<BadgeRow />` between `<GarageHeader />` and `<VagasSectionHeader />` in the route's `ListHeaderComponent` fragment. (NOT inside `GarageHeader`. The chunk 14 layout already established that header composition lives in the route, not inside the header component.)
- Modify: `apps/mobile/app/(app)/garage/index.tsx` — host `<BadgesSheet />` state + open from `BadgeRow` tap.
- Modify: `apps/mobile/src/api/garage.ts` — add `getMyBadges()`, `togglePinBadge(code, pinned)`.

**Insertion order in `ListHeaderComponent`:**

1. `<GarageHeader>` (cover + IdentityCard + sheets)
2. `<WelcomeBanner>` (fresh signup only)
3. `<ExpiredPremiumNotice>` (lapse only)
4. `<BadgeRow />` (NEW — hidden when `garage.gamification.enabled === false` OR `badges.length === 0` AND signup is fresh)
5. `<VagasSectionHeader />`

`BadgeRow` reads `garage.gamification.enabled` from the response. Returns null when disabled. Returns null when no badges earned AND signup is fresh (avoid empty teaser on day-1 user). Otherwise shows up to 4 (pinned + recent) + `+N` chip.

---

## Chunk 20 — Admin manual grant panel + audit visibility

**Files:**

- Create: `apps/admin/src/components/garage-badges-panel.tsx` — full catalog + earned indicator + manual grant button.
- Modify: existing user-detail page to mount the panel.
- Modify: admin audit visibility — `badge.award/pin/unpin` rows render appropriately in the audit log viewer.

Renders the badges-grid using `@ccc/ui/web` `HexBadge` (web twin lands in chunk 21).

---

## Chunk 21 — Web-safe Conquistas primitives (`@ccc/ui/web`)

**Files:**

- Create: `packages/ui/src/web/HexBadge.tsx` — HTML+Tailwind+SVG twin of the mobile HexBadge.
- Create: `packages/ui/src/web/BadgeRow.tsx` — for SSR public `/g/:slug` rendering.
- Modify: `packages/ui/src/web/index.ts` — export both.
- Modify: `apps/admin/app/g/[slug]/page.tsx` (Phase 1 chunk 13 SSR page) — render `<BadgeRow />` when present in public payload.

Web HexBadge uses inline SVG for the hexagon (Polygon path same as the RN react-native-svg version). Reads `garageTokens` for ring colors. Identical visual to RN.

---

## Chunk 22 — In-app notification on admin manual grant

**Files:**

- Modify: `apps/api/src/services/garage/awarder.ts` — when invoked from the admin manual grant path, also emit a notification via the existing `Notification` model.
- Verify infrastructure: use existing `Notification` rows with required fields (`title`, `body`, `data`, `dedupeKey`). Locate via `grep -nE 'model Notification' packages/db/prisma/schema.prisma`. If the model is missing required fields, add them in a separate sub-step.

Notification shape:

```ts
{
  userId: garage.userId,
  title: 'Nova conquista!',
  body: garageBadgeCopy[code].title,  // PT-BR from copy file
  data: { kind: 'badge_awarded', code },
  dedupeKey: `badge:${code}:${garage.userId}`,
}
```

`dedupeKey` ensures re-grant after un-grant doesn't double-notify.

Push notification deferred to Phase 2D (separate plan if/when needed). In-app surfaces on next mobile garage load via the existing `GET /me/notifications` poll.

---

## Conquistas DSR

Anonymize transaction (extends the C17 cover-cleanup from §Corrections):

```ts
await tx.garageBadge.deleteMany({ where: { garage: { userId } } });
```

Inside the existing `apps/api/src/services/account-deletion/*` tx. Verify the existing test extension assertion: post-anonymize, `prisma.garageBadge.count({ where: { garage: { userId } } }) === 0`.

DSR export adds the user's `GarageBadge` rows to the exported tarball.

---

## Final cross-cutting tasks

### Run full local test suite

(Recall: CLAUDE.md says **never run the full test suite locally**. Run the changed paths in each PR. CI on `main` covers the full sweep after merge.)

### Verify @ccc/shared is rebuilt

After every schema/export change, ensure consumers rebuild:

```bash
pnpm --filter @ccc/shared build
pnpm --filter @ccc/ui typecheck
```

(Memory rule: stale `@ccc/shared` `dist/` masks zod break that CI catches. See `feedback_rebuild_shared_after_schema_change.md`.)

### Self-review pass before opening each PR

For each chunk, before opening the PR:

1. Confirm the change matches the chunk scope (no scope creep into adjacent chunks).
2. Confirm `git status` shows only files in the chunk's file-list.
3. Confirm tests pass on the affected packages.
4. Open a draft PR; request review (per CLAUDE.md, **2 rounds of review with fresh subagent context**).

---

## Tie-back to UX Audit J observations

| Friction                                        | Severity | Addressed in chunk |
| ----------------------------------------------- | -------- | ------------------ |
| Inline edit affordances invisible               | MAJOR    | 08                 |
| Buy-spot is 5+ taps + manual return             | MAJOR    | 10                 |
| Free vs extra slot cards visually identical     | MINOR    | 06                 |
| Mobile vs admin badge color drift               | MINOR    | 05                 |
| Share link is path-only (no domain)             | MAJOR    | 11                 |
| Slug regex error shows "URL já está em uso"     | MAJOR    | 08 + 12            |
| First-car CTA is muted text, not a button       | MAJOR    | 06 + 14            |
| PremiumBadge has no onPress / explainer         | MINOR    | 04 + 08            |
| `/g/:slug` returns raw JSON to non-app visitors | MAJOR    | 13                 |

---

## Deferred (not in Phase 1)

- Conquistas / achievement badges → Phase 2 (separate plan).
- XP + ranking + stats → Phase 2 (`docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`).
- Light mode.
- Tablet / wide layout.
- EN locale design exploration.
- ~~Real preset artwork~~ — **bundled in repo** at `docs/assets/garage-covers/`. 7 covers ship at 3392×1248 PNG source; 3 (`autobahn-blue`, `vintage-meet`, `monaco-marble`) ship as 1024×377 LOWRES placeholders requiring regen at 3840×1440 before R2 upload. See `docs/assets/garage-covers/README.md` for the conversion + upload pipeline.
- Buy-spot real cart preview inside the sheet (only price label for v1).
- Animation polish (post-purchase pulse beyond the 2s border highlight; sheet-open spring curves).
- Asphalt-texture SVG pattern on `ParkingStallCard` (flat color v1).
- Admin's `general-settings` + virtual-product editor redesign.

## Forward-pointers (do NOT implement in Phase 1)

These are mentioned so the Phase 1 engineer does not collide with them later:

- **Phase 2 (XP + ranking + stats)** — `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`. Adds `Garage.xp` + `Garage.likesReceived` columns. Additive — no migration ordering conflict with Phase 1's `coverPreset` + `coverImageObjectKey`.
- **Gamification killswitch already lives in Phase 1** — see chunk 15 (Conquistas foundations). `GeneralSettings.gamificationEnabled: Boolean @default(true)`. Single flag disables every gamification surface (badges, Phase 2 XP scoreboard, stats, awarders) when set to `false`. Phase 2 reuses the same flag — no second column added.
- **Premium-exclusive badges** — Schema column + awarder gate ship in Phase 1 chunk 15. Visual upgrade + actual premium-exclusive seed entries deferred to a future "premium tiers" phase. PremiumBadge (paid membership marker) and Conquistas (gamification) live side-by-side and are independent except for the award-time `isPremiumActive` gate on `premiumExclusive: true` badges.
