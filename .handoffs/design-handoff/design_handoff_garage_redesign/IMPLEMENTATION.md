# Garage per-User Pivot — Redesign Handoff

**Prototype:** `JDMA-590 · Garagem.html` (root).
**Source spec:** [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](../../docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md) — invariants preserved.
**Status of redesign:** v1 — owner + public surfaces, sheets, and PremiumBadge directions. Dark mode only. Admin surfaces deferred to v2.
**LGPD posture:** unchanged. Neutral defaults, `isPublic=false` default, anti-enumeration 404, no PII derivations.

This doc tells the implementer agents what to change and in what order. Every section maps to either a screen, a data-model delta, an API surface, or a friction finding from `.handoffs/garage-spots-smoke-test-plan.md` §UX Audit.

> The brief asked for a Figma deliverable. We ship an HTML prototype instead — the existing JDMA-587/554 pattern. Same intent: states render side-by-side, tweaks toggle the variants, frames are copy-paste-spec-ready.

---

## 0. Reading order

1. This file.
2. The prototype HTML — `JDMA-590 · Garagem.html`. Use the Tweaks panel to flip badge variant + cover preset + near-expiry state.
3. Per-screen sections below (§4) for source-file deltas.

Everything cited as `tweak.foo` lives in the Tweaks panel of the prototype.

---

## 1. Visual direction — three additive systems

### 1.1 Cover image (LinkedIn-style hero)

- A new `Garage.coverImageUrl` _or_ `Garage.coverPreset` column (recommended: `coverPreset`; see §2.1). Owner picks from a curated set; premium also gets upload.
- Cover sits at the **top of `/garage` (owner) and `/g/:slug` (public)**, with the **identity card overlaid** by `margin-top: -44px`. The card shadow lifts it off the cover.
- Free tier: a single canonical `default-door` cover (bundled).
- Premium tier: 8 curated presets + custom upload.
- The cover does NOT include the user's name or any other PII — it is purely aesthetic.

### 1.2 Parking-stall card system (architectural / blueprint)

Replaces the dashed-border placeholder. Two-row card:

- **Stall floor** (top, 116px): asphalt texture + painted side rails + painted curb + monospace `SLOT NN` plate + (for non-free spots) a "Reservada" / "Cortesia" / "À venda" tape on the top-right.
- **Metadata band** (bottom): title + nickname + PremiumBadge (filled) or copy + price (empty/buy).

Source-aware paint color (additive token):

| Source         | Paint token  | Visual                                         |
| -------------- | ------------ | ---------------------------------------------- |
| `default_free` | `paintFree`  | neutral grey rails, no tape                    |
| `purchase`     | `paintExtra` | gold rails, "RESERVADA" tape (top-right)       |
| `admin_grant`  | `paintAdmin` | cyan rails, "CORTESIA" tape                    |
| buy-spot CTA   | `brandSoft`  | red rails, "À VENDA" tape, glowing centre icon |

A filled stall renders the existing car-photo placeholder _inside_ the painted lines (insets 22/22/18/36 from the card frame), with a real car photo when `cars[].photos[0]?.url` is present.

### 1.3 PremiumBadge — three directions (artboard R)

| Variant              | Treatment                                                                                                                               | When to use                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| V1                   | Tier-tinted sparkle chip + dashed pulsing ring on expiry                                                                                | Closest to current `tone="brand"` Badge. Lowest-risk migration.                          |
| **V2 (recommended)** | Split pill — solid tier-color block (`Bronze`/`Silver`/`Gold` + key glyph) + optional second block with `Nd` countdown when near expiry | Tier difference is decoded by label, not color. Expiry is a number, not a vibe.          |
| V3                   | Holographic — red brand base + iridescent gradient overlay                                                                              | Brand-loud. Use only if marketing wants "premium = JDM red". Hardest to keep accessible. |

**Default ship:** V2. The current implementation's amber-only badge is replaced by a tier-tinted variant. V1 and V3 stay as Tweak variants in the prototype for product to compare against.

Near-expiry trigger: `premiumUntil - now() < 7 days`. Compute serializer-side; expose `daysLeftUntilExpiry: number | null` on `GarageOwner` only (NOT on `GaragePublic` — that surface stays allowlist-strict).

---

## 2. Data-model + API deltas

> **Hard invariant:** the locked contracts in `.handoffs/garage-spots-orchestration.md` are preserved. `isPremiumActive` stays computed (never persisted). Public payload allowlist stays strict. Anti-enumeration 404 unchanged.

### 2.1 New columns on `Garage`

```prisma
model Garage {
  // ...existing...
  coverPreset      String?  @db.VarChar(40)   // slug of curated preset; null = default-door
  coverImageUrl    String?  @db.VarChar(500)  // R2-hosted custom upload; null = use coverPreset
}
```

**Recommended approach (designer call):** keep both columns. `coverPreset` is the curated path (cheap to render, no R2 dependency for free tier). `coverImageUrl` only ever populated when the user uploads a custom file. Renderer prefers `coverImageUrl` if non-null, else falls back to `coverPreset` if non-null, else `'default-door'`.

Migration:

```sql
ALTER TABLE "Garage"
  ADD COLUMN "coverPreset" VARCHAR(40),
  ADD COLUMN "coverImageUrl" VARCHAR(500);
-- Backfill: leave both NULL. Renderer treats NULL as 'default-door'.
```

Reserved preset slugs (whitelist enforced server-side in zod):

```ts
export const GARAGE_COVER_PRESETS = [
  'default-door', // free
  'urban-night',
  'tokyo-wangan',
  'kanjo-loop',
  'tsukuba',
  'paddock',
  'drift-smoke',
  'workshop',
  'sunset-strip',
] as const;
```

### 2.2 Premium gating

- `coverPreset` may only be set to a **premium-locked** preset if `isPremiumActive === true`. Server-side check in `applyGaragePatch`. Frees who hit a locked preset get a `400 premium_required`.
- `coverImageUrl` accepts a value only if `isPremiumActive === true` AND the URL is an R2 URL under `garage-cover/<userId>/`. Same `400 premium_required` on miss.
- When premium **lapses** (`isPremiumActive` flips false): the existing TASK design says a sweep job handles `premium_membership` spots. We add a _non-destructive_ fallback for cover: the renderer treats `coverImageUrl` and any non-`default-door` `coverPreset` as `'default-door'` while premium is inactive. The DB row stays intact (so re-activating restores the choice). Implement in the _renderer_, not via a sweep — fewer moving parts.

### 2.3 New API endpoints

| Method  | Path                       | Body / Notes                                                                                      | Response                                                                                    |
| ------- | -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PATCH` | `/me/garage/cover`         | `{ coverPreset: PresetSlug \| null }` OR `{ coverImageUrl: string \| null }`. Mutually exclusive. | `{ garage: GarageOwner }`                                                                   |
| `POST`  | `/me/garage/cover/upload`  | `{ contentType: 'image/jpeg' \| 'image/png' \| 'image/webp', sizeBytes: number }`                 | `{ url, fields, putUrl }` (pre-signed R2 PUT, same pattern as cars)                         |
| `GET`   | `/me/garage/cover/presets` | —                                                                                                 | `{ presets: [{ slug, label, premium }] }` (static — could also be a constant on the client) |

The two PATCH paths could fold into the existing `PATCH /me/garage` if we extend `garagePatchSchema`. Keeping them separate clarifies the upload-then-link sequence and lets us rate-limit covers without rate-limiting slug edits.

### 2.4 Shared zod schemas (`packages/shared/src/garage.ts`)

```ts
export const garageCoverPresetSchema = z.enum(GARAGE_COVER_PRESETS);

export const garageCoverPatchSchema = z.union([
  z.object({ coverPreset: garageCoverPresetSchema.nullable() }),
  z.object({
    coverImageUrl: z
      .string()
      .url()
      .regex(/garage-cover\//)
      .nullable(),
  }),
]);

// extend existing garagePatchSchema:
export const garagePatchSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  slug: z.string().regex(SLUG_RE).max(40).optional(),
  description: z.string().max(500).nullable().optional(),
  isPublic: z.boolean().optional(),
  // new:
  coverPreset: garageCoverPresetSchema.nullable().optional(),
  coverImageUrl: z
    .string()
    .url()
    .regex(/garage-cover\//)
    .nullable()
    .optional(),
});
```

`GaragePublic` (in `packages/shared/src/garage-public.ts`) gains:

```ts
export const garagePublicProfileSchema = z.object({
  // ...existing...
  coverPreset: garageCoverPresetSchema.nullable(),
  coverImageUrl: z.string().url().nullable(), // already R2-public-readable
});
```

`GarageOwner` additionally gains `daysLeftUntilExpiry: number | null` (computed alongside `isPremiumActive`).

### 2.5 Audit-log entries

Add to `adminAuditActionSchema`:

- `garage.cover_set` (preset or URL change)
- `garage.cover_reset` (cleared to default)

---

## 3. Design tokens patch

### 3.1 Existing tokens — no change

Reuse `theme.colors.{fg, bg, border, muted, brand}` and the existing typographic scale on mobile + admin. The PremiumBadge V2 uses tier-tinted backgrounds but always pairs them with a label, not relying on color alone (WCAG-relevant — see §6).

### 3.2 New tier tokens — additive (no breaking change)

```ts
// packages/design/src/tokens/garage.ts (new)
export const garageTokens = {
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
  paint: {
    free: '#9AA0AC',
    extra: '#E8B339',
    adminGrant: '#4AD4E0',
    asphalt: '#15161A',
    asphaltLine: '#2C2D32',
  },
} as const;
```

Mobile picks these up via the existing `theme` re-export. Admin: Tailwind config gets a `garage` namespace under `theme.extend.colors`.

### 3.3 Cover preset definitions (constant, not a token)

Lives in `packages/shared/src/garage-covers.ts`. Slug, label, premium-required flag. Used by both server (validation) and client (picker).

---

## 4. Per-screen change list

> Map: prototype artboard → source file → before-state friction → redesign delta.

### 4.1 `A · Fresh signup` → `apps/mobile/app/(app)/garage/index.tsx` + `GarageHeader.tsx`

- **Before:** `ListEmptyComponent` renders `firstCarCta` as muted `<Text>`. Identity feels half-built (UX-Audit A.1).
- **Now:** cover (default-door) + IdentityCard with default name "Garagem" + neutral slug shown as monospace `jdmexp.app/g/user-XXXXXXXX`. A **brand-tinted welcome banner** ("Bem-vindo à sua Garagem") sits above the stall list, naming the construct and explaining the free-slot count.
- **Implementer note:** drop the `ListEmptyComponent` muted text. The empty state IS the stall grid — N painted stalls + the welcome banner. Inline-edit affordance ships as part of `GarageHeader` (see §4.5).

### 4.2 `B · Partial fill` & `C · At cap` & `D · Unlimited` → `GarageListView.tsx`

- **Before:** dashed-border placeholders are visually identical regardless of source (UX-Audit E.7).
- **Now:** every spot renders as a `ParkingStallCard`. Source drives the paint color + tape. The `BuySpotCard` becomes a stall with red paint + "À VENDA" tape + price in the metadata band — clearly distinguishable from the empty-add stalls (UX-Audit A.3 fix).
- The slot **number** (`SLOT 01..NN`) is rendered in monospace — makes the spot concept visible and makes screenshots auditable.

### 4.3 `E · Mixed` → `GarageListView.tsx`

- **Before:** `FillSpotCard` (extra) and `AddCarPlaceholderCard` (free) are visually identical except for subtitle (UX-Audit E.7).
- **Now:** the _paint color and tape_ are the differentiator, not the subtitle. "RESERVADA" tape lands top-right; gold rails replace grey. Color-blind safe because the tape includes a label.

### 4.4 `F-H · Premium owner` (gold/silver/bronze) → `GarageHeader.tsx`

- IdentityCard renders the PremiumBadge V2 (tier-tinted with key glyph + tier name). Glyph + label, never color-only (UX-Audit G.1 fix).
- The tier accent line at the top of the IdentityCard (a 2px gradient bar from tier color to transparent) is a quiet brand cue without dominating the card.

### 4.5 `Q · Edit garage sheet` → `GarageHeader.tsx`

- **Before:** the only edit affordance is `accessibilityLabel="Toque para editar"`. No pencil, no underline. **MAJOR friction per UX-Audit E.1 / J seed.**
- **Now:**
  - The IdentityCard shows a small `Pencil` glyph next to the garage name (always visible to owner).
  - Two explicit buttons in the action row: `[Capa]` and `[Editar]`.
  - Tapping `Editar` opens a bottom sheet (`EditGarageSheet`) with proper TextField labels, character counters, slug-prefix display, and a clear "Tornar pública" toggle with a copy-localized consequence sentence.
- **Slug error-mapping fix (UX-Audit B.3):** `EditGarageSheet` distinguishes `invalid_slug` (regex violation — "URL pode usar apenas letras minúsculas, números e hífens") from `slug_taken` ("Esta URL já está em uso"). Add `invalidSlug` entry to `~/copy/garage.ts`.

### 4.6 `M · Premium sheet` → `packages/ui/src/PremiumBadge.tsx` + new `PremiumSheet` component

- **Before:** badge has no `onPress`. Inert decoration (UX-Audit E.4).
- **Now:** PremiumBadge accepts `onPress`. Tapping opens `PremiumSheet`:
  - Hero block with tier name + tagline.
  - 4 benefit rows (Capas personalizadas, Selo Premium, Garagem em destaque, Página pública premium).
  - Near-expiry warning slot — only renders when `daysLeftUntilExpiry !== null && daysLeftUntilExpiry <= 7`.
  - Footer disclaimer: "Premium **nunca** limita o uso da sua garagem." Important for product positioning + LGPD posture.
- **Note for admin twin:** the admin badge follows the same V2 variant. The admin's `premium-badge.tsx` should re-export from the shared `@ccc/ui` build (per pivot orchestration's "no shared-tokens-via-copy" rule).

### 4.7 `N · Cover picker (premium)` + `O · Cover picker (free upsell)` → new `CoverPickerSheet`

- Grid: 8 curated presets + custom-upload tile. Each preset shows a thumbnail rendered from the same `GarageCover` component as the hero — guaranteed parity.
- Free users see locked tiles (greyed out + `Premium` lock pip in the corner). Tapping a locked tile is a no-op + (deferred) opens `PremiumSheet`.
- Selected preset gets a brand checkmark badge.
- Upload tile (premium-only): triggers `POST /me/garage/cover/upload` → R2 pre-signed PUT → on settle, calls `PATCH /me/garage/cover` with `coverImageUrl`.

### 4.8 `P · Buy-spot sheet` → new `BuySpotSheet`

- **Before:** `tap → cart → checkout → external payment → manual nav → reload` (J seed observation #2 — MAJOR).
- **Now:** the buy-spot stall card opens a sheet (NOT navigation to `/cart`). Sheet preview:
  - line item with price
  - 3 bullets explaining what happens (one-time, ~60s, auto-return)
  - two side-by-side payment CTAs (Pix / Cartão)
- After payment confirmation (webhook settle), the user is **deep-linked back to `/garage?highlight=<spotId>`** with a 2s pulse on the new card. Wire via universal-link handling in `_layout.tsx`.
- The sheet is the "thin" entry; the existing cart route still exists for mixed carts (ticket + spot), but a pure-virtual cart should stay in-context.

### 4.9 `J · Public populated` & `K · Public empty` & `L · 404` → new HTML SSR surface

- **Before:** `/g/:slug` returns JSON only. Owner shares a link, friend without the app sees raw JSON. **MAJOR (UX-Audit J seed observation #8).**
- **Now:** add an HTML view at `/g/:slug` rendered server-side (Next.js admin app is the natural home — same dark theme, same color tokens). The HTML view uses the same `GaragePublic` allowlist payload — **no new data exposure**. Anti-enumeration 404 preserved: private + unknown slugs serve the same HTML 404.
- The mobile app deep-links into `/g/:slug` open in-app; outside the app, the SSR HTML page renders.
- Empty public garages get a polished "Em construção" block, not raw `cars: []`.

### 4.10 Share link bug (UX-Audit J seed #5) → `GarageHeader.handleShare`

- **Before:** `Share.share({ message: '/g/${slug}' })` — path only.
- **Now:** `Share.share({ message: 'https://jdmexp.app/g/${slug}', url: 'https://jdmexp.app/g/${slug}', title: garage.name })`. Domain becomes a config constant in `apps/mobile/src/config/urls.ts` (`PUBLIC_PROFILE_BASE_URL`).

---

## 5. Component spec sheet

### 5.1 `ParkingStallCard` — new `@ccc/ui` export

```ts
type Props = {
  source: 'default_free' | 'purchase' | 'admin_grant' | 'buy';
  slotNumber: number; // 1-indexed; rendered as `SLOT NN`
  state: 'filled' | 'empty' | 'buy';
  // filled-state props:
  car?: CarPublic;
  premiumActive?: boolean;
  premiumTier?: 'bronze' | 'silver' | 'gold' | null;
  onBadgePress?: () => void; // opens PremiumSheet
  // empty/buy-state props:
  priceLabel?: string; // buy only
  // common:
  onPress: () => void;
  testID?: string;
};
```

Variants:

- `filled` — car photo inset inside painted lines; metadata band shows year/make/model + nickname + PremiumBadge if active.
- `empty` — center plus-icon ring; metadata band shows title + subtitle (source-aware).
- `buy` — red painted lines + glowing ring + "À VENDA" tape + price in metadata band.

States:

- pressed → opacity 0.6
- disabled → opacity 0.4 (used during buy-spot submitting latch)

Animation:

- `highlight` prop (boolean) — 2s pulse for post-purchase deep-link landing.

### 5.2 `PremiumBadge` — extended

```ts
type Props = {
  tier: 'bronze' | 'silver' | 'gold' | null;
  isPremiumActive: boolean | null | undefined;
  size?: 'sm' | 'md';
  variant?: 'v1' | 'v2' | 'v3'; // default 'v2'; configurable via tweak/feature flag
  daysLeftUntilExpiry?: number | null;
  onPress?: () => void; // optional; opens PremiumSheet when provided
  className?: string;
};
```

- `isPremiumActive !== true` → renders `null` (unchanged contract from current PremiumBadge).
- `daysLeftUntilExpiry <= 7 && > 0` → renders near-expiry treatment (V2 adds `Nd` block; V1 adds pulsing dashed ring; V3 unchanged visual — expiry is communicated via PremiumSheet only).
- `daysLeftUntilExpiry <= 0` → caller should not pass `isPremiumActive=true` (serializer-side flip).

Admin twin: same component imported from `@ccc/ui`. No more separate `apps/admin/src/components/premium-badge.tsx` (UX-Audit F.1 fix — kill the drift).

### 5.3 `GarageCover` — new shared component

```ts
type Props = {
  coverPreset: string | null;
  coverImageUrl: string | null;
  isPremiumActive: boolean;
  height?: number; // default 168 mobile, 220 desktop
};
```

Renderer precedence:

1. `coverImageUrl` if non-null AND `isPremiumActive`.
2. `coverPreset` if non-null AND (preset is `'default-door'` OR `isPremiumActive`).
3. Fall back to `'default-door'`.

This is the _only_ place the premium-gating renders to ensure consistent behavior across mobile + SSR.

### 5.4 `PremiumSheet`, `CoverPickerSheet`, `BuySpotSheet`, `EditGarageSheet`

All four follow the same `SheetShell` (already in the prototype) — bottom sheet with backdrop, grabber, title bar, scroll body. Build on whatever the codebase uses for bottom sheets today (`@gorhom/bottom-sheet` if present, RN `Modal` if not). Keep the prototype's visual proportions.

---

## 6. Accessibility checklist

| ID  | Check                                                     | Solution in redesign                                                                                                                                 |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | PremiumBadge has touch target ≥44pt on mobile             | V2 badge `size="md"` is 28px; **wrap in a 44pt-tall pressable region**, not the badge itself. Size up the bounding box without changing visual size. |
| A2  | Tier difference not color-only                            | V2 includes tier name as text ("Gold", "Silver", "Bronze"). Pass.                                                                                    |
| A3  | Empty stall free-vs-extra not color-only                  | "RESERVADA" / "CORTESIA" tape is a label, not a hue. Pass.                                                                                           |
| A4  | Color contrast for `text-fg-inverse` on tier color blocks | V2 tier solid block uses `#0A0A0A` text on tier hex — measure: gold 9.6:1, silver 9.0:1, bronze 5.4:1. All pass WCAG AA.                             |
| A5  | Sheet backdrop dismisses via swipe-down (gesture parity)  | Implementation detail — pass through to whichever sheet lib.                                                                                         |
| A6  | Slug field error code distinct from collision             | Already addressed (§4.5). Add `invalid_slug` copy entry.                                                                                             |
| A7  | Premium-expired state explained, not silent               | `OwnerGarage` renders an inline notice when `state === 'expired'`. UX-Audit B.7 fix.                                                                 |
| A8  | Screen-reader: PremiumBadge announces tier + expiry       | `aria-label` = "Premium Gold" / "Premium Gold, expira em 5 dias". V2 implemented.                                                                    |

---

## 7. PR-sized chunk list (ordered, dependency-tagged)

Branch each as `feat/jdma-garage-redesign-NN`. Convention matches the original wave plan.

| #   | Chunk                                                                                       | Depends on | Files                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| 01  | **Tokens** — additive tier + paint tokens; cover-preset constant                            | —          | `packages/design/src/tokens/garage.ts`; `packages/shared/src/garage-covers.ts`                                              |
| 02  | **Schema migration** — `coverPreset` + `coverImageUrl` columns + zod                        | 01         | `packages/db/prisma/...`; `packages/shared/src/garage.ts`                                                                   |
| 03  | **API** — `PATCH /me/garage/cover` + `/cover/upload` + premium-gating in `applyGaragePatch` | 02         | `apps/api/src/routes/garage.ts`; `apps/api/src/services/garage/index.ts`                                                    |
| 04  | **PremiumBadge v2** + `PremiumSheet` in `@ccc/ui`                                           | 01         | `packages/ui/src/PremiumBadge.tsx`; new `PremiumSheet.tsx`                                                                  |
| 05  | **Admin twin removal** — admin imports `@ccc/ui` PremiumBadge directly                      | 04         | `apps/admin/src/components/premium-badge.tsx` (delete); call sites updated                                                  |
| 06  | **ParkingStallCard** + replaces `GarageSpotPlaceholderCard` family                          | 01         | `packages/ui/src/ParkingStallCard.tsx` (new); `apps/mobile/src/screens/garage/*` (call sites)                               |
| 07  | **GarageCover** + cover-preset renderer (mobile)                                            | 02, 01     | `packages/ui/src/GarageCover.tsx`; `apps/mobile/src/screens/garage/GarageListView.tsx`                                      |
| 08  | **IdentityCard + EditGarageSheet** — replaces inline edits on `GarageHeader`                | 04, 06     | `apps/mobile/src/screens/garage/GarageHeader.tsx`; `apps/mobile/src/screens/garage/EditGarageSheet.tsx` (new); copy updates |
| 09  | **CoverPickerSheet** + R2 upload wiring                                                     | 03, 07     | `apps/mobile/src/screens/garage/CoverPickerSheet.tsx` (new); api client                                                     |
| 10  | **BuySpotSheet** + post-settlement deep-link return                                         | 06         | `apps/mobile/src/screens/garage/BuySpotSheet.tsx` (new); deep-link handler                                                  |
| 11  | **Share link fix** — `PUBLIC_PROFILE_BASE_URL` + `Share.share` payload                      | —          | `apps/mobile/src/screens/garage/GarageHeader.tsx`; new config                                                               |
| 12  | **Slug error mapping** — distinguish `invalid_slug` from `slug_taken`                       | —          | `apps/mobile/src/screens/garage/GarageHeader.tsx` (now `EditGarageSheet`); copy                                             |
| 13  | **SSR public profile** — HTML view at `/g/:slug` on admin/marketing app                     | 02         | new Next.js route + components; cover renderer + parking stall in SSR mode                                                  |
| 14  | **Welcome banner** — fresh-signup empty state                                               | 06, 07     | `apps/mobile/app/(app)/garage/index.tsx`                                                                                    |

Chunks 01–06 are the structural floor; product can ship in two waves:

- **Wave A (must-ship):** 01 → 02 → 03 → 04 → 06 → 08 → 12 → 14. Owner side feels right; premium is purely cosmetic.
- **Wave B (premium polish):** 05 → 07 → 09 → 10 → 11 → 13. Cover system + SSR + buy-spot loop fix.

---

## 8. What's NOT in this v1

These are scoped out and need a follow-up pass:

- **Admin surfaces** — user-detail Garagem tab + general-settings + virtual-product editor. Deferred per scope question. The admin PremiumBadge alignment (§4.6 / chunk 05) is the only admin-side fix we landed.
- **Light mode** — every artboard is dark-mode. Brief required both. Follow-up needed.
- **Tablet / wide layout** — vertical stack only. Grid layout proposal deferred.
- **EN locale variants** — PT-BR copy only; EN scaffolding stays in `garageCopy` but no design exploration of layout shifts under longer English strings.
- **Real preset artwork** — the 8 cover presets are CSS-rendered placeholders in the prototype. Production needs PNG assets (recommended: 1920×720 @2x, AVIF + JPEG fallback, hosted on R2 under `garage-cover-presets/`). Asset bundle owed.
- **Buy-spot real cart preview** — sheet shows price + bullets; the actual line-item card from cart is not rendered. Implement when wiring chunk 10.
- **Animation polish** — post-purchase stall pulse, sheet-open spring curves, badge pulsing. All TBD with motion designer.

---

## 9. Tie-back to the UX Audit J seed observations

| Friction (J seed)                                | Severity | Where it's addressed                                                              |
| ------------------------------------------------ | -------- | --------------------------------------------------------------------------------- |
| Inline edit affordances invisible                | MAJOR    | §4.5 — IdentityCard pencil glyph + explicit `[Editar]` button + `EditGarageSheet` |
| Buy-spot is 5+ taps + manual return              | MAJOR    | §4.8 — `BuySpotSheet` in-context + deep-link return + highlight pulse             |
| Free vs extra slot cards visually identical      | MINOR    | §1.2 / §4.3 — source-aware paint + tape labels                                    |
| Mobile vs admin badge color drift                | MINOR    | §4.6 / chunk 05 — admin imports shared `@ccc/ui` PremiumBadge                     |
| Share link is path-only (no domain)              | MAJOR    | §4.10 / chunk 11 — `PUBLIC_PROFILE_BASE_URL` + full URL                           |
| Slug regex error shows "URL já está em uso" copy | MAJOR    | §4.5 / chunk 12 — distinguish `invalid_slug` vs `slug_taken`                      |
| First-car CTA is muted text, not a button        | MAJOR    | §4.1 / chunk 14 — welcome banner + painted stalls as the empty UI                 |
| PremiumBadge has no onPress / explainer          | MINOR†   | §4.6 / chunk 04 — `onPress` + `PremiumSheet`                                      |
| `/g/:slug` returns raw JSON to non-app visitors  | MAJOR    | §4.9 / chunk 13 — SSR HTML public profile                                         |

† Upgrade to **MAJOR** if premium upsell is a launch-window product goal.

---

## 10. Open questions for product

1. Are the 8 cover presets the final set, or should we add seasonal / event-tied ones (e.g., a Tokyo Meet 2026 collab cover for that event's attendees)?
2. Does premium-membership purchase ship with this redesign, or stay deferred per spec §9? The PremiumSheet has a benefits list but no "Comprar" CTA — wire it when purchase ships.
3. Should the SSR public profile (`/g/:slug` HTML) live under the admin app or a new public-web app? Admin app is fastest; new app is cleanest separation.
4. Confirm `coverPreset` vs `coverImageUrl` is the right split. The alternative is one column with a sentinel prefix (`preset:tokyo-wangan` vs `https://r2/...`) — uglier but simpler migration.

---

## 11. Gamification — Conquistas (achievement badges)

> Additive system. Lives next to (not replacing) `PremiumBadge`. Premium is a paid membership state; Conquistas are earned through user actions.

### 11.1 What

Hexagonal achievement badges shown on the owner's and (a curated subset on) public garages. Tappable → opens a dedicated drawer with the full catalog + per-badge detail.

**Catalog (v1) — 12 badges, 4 categories × 3 rarities:**

| Code      | Category   | Rarity   | Title (PT-BR)   | Criteria                          |
| --------- | ---------- | -------- | --------------- | --------------------------------- |
| `EVT-001` | Eventos    | Comum    | Primeiro Evento | Compareça a 1 evento.             |
| `EVT-002` | Eventos    | Raro     | Sequência de 3  | 3 eventos consecutivos.           |
| `EVT-003` | Eventos    | Lendário | Veterano        | 10 eventos no total.              |
| `CAR-001` | Carros     | Comum    | Primeiro Motor  | Cadastre 1 carro.                 |
| `CAR-002` | Carros     | Raro     | Garagem Cheia   | Preencha o limite grátis.         |
| `CAR-003` | Carros     | Lendário | Curador         | 5 carros cadastrados.             |
| `COM-001` | Comunidade | Comum    | Primeiro Post   | Publique 1 post no feed.          |
| `COM-002` | Comunidade | Raro     | Iniciador       | Receba 10 comentários em 1 post.  |
| `COM-003` | Comunidade | Lendário | Volta Famosa    | 50 curtidas em 1 post.            |
| `JDM-001` | JDM        | Comum    | Curitibano      | 1 evento em Curitiba.             |
| `JDM-002` | JDM        | Raro     | Pista           | 1 track day.                      |
| `JDM-003` | JDM        | Lendário | Fundador        | Conta criada antes de 01/06/2026. |

Codes are stable identifiers (`AAA-NNN`). Titles + descriptions are PT-BR-localized via `~/copy/badges.ts` (new). EN scaffold same shape as `~/copy/garage.ts`.

### 11.2 Design standard

Every badge is an instance of `HexBadge` (`packages/ui/src/HexBadge.tsx`, new).

| Aspect         | Spec                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shape          | Flat-top hexagon. `clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)`. Two layers — outer (rarity color) + inner (`JDM.surface`). |
| Sizes          | `sm: 32` (chips, inline mentions), `md: 52` (rows, grids), `lg: 96` (detail hero).                                                                     |
| Ring colors    | `common` → `JDM.silverDeep`; `rare` → `JDM.gold`; `legendary` → `JDM.brand`.                                                                           |
| Inner tint     | Radial gradient at 50%/60% using the rarity's `*Tint` token.                                                                                           |
| Glyph          | Lucide-style 1.75-stroke line icon, 14/22/38 px per size. Color = ring color.                                                                          |
| Legendary mark | 8px dot at top-right (12px on `lg`), glowing in ring color.                                                                                            |
| Locked state   | `filter: grayscale(1)`. Lock glyph replaces icon. Diagonal hatch in the inner tint.                                                                    |
| Label          | (Optional) Inter 700 / 11px + JetBrains Mono 9px code, stacked below the hex.                                                                          |
| Touch target   | When `onPress`, the whole `<button>` is ≥44pt by padding (visual hex stays 52).                                                                        |

The hex shape + mono code is the brand commitment — never use circular, square, or shield variants. New badges = new entries in the catalog, never new shapes.

### 11.3 Placement

**Owner `/garage`** (after IdentityCard, before "Vagas" section):

- New `BadgeRow` card: shows up to **4 badges** (owner's pinned + most-recent). Trailing `+N` chip if more earned. `[Ver todas]` link → opens `BadgesSheet`.
- Hidden on fresh-signup (no badges yet) — the welcome banner takes its place.

**Public `/g/:slug`** (same position):

- Shows only the **pinned 3** (max). If the owner pinned zero, the row is hidden entirely (deliberate — no signal-of-effort if the owner doesn't curate).
- Anonymous viewer cannot see locked badges — only the pinned earned ones plus a count ("3 conquistas").

**Drawer (`BadgesSheet`)** — full bottom sheet:

- Header: total earned count, big display number ("6 / 12").
- Category tabs: All / Eventos / Carros / Comunidade / JDM.
- 3-column hex grid with title + code under each badge.
- Tap a badge → drilldown to `BadgeDetail` (in-sheet, header swaps to "Voltar"):
  - 96pt hex centered + rarity & category pills + title in Anton 30px + mono code + description.
  - Earned: "Conquistado em DD MMM YYYY" + (owner-only) pin/unpin toggle.
  - Locked: "Bloqueado" + criteria sentence + (deferred) progress bar.

**Pin model**: owner can pin up to **3** badges for public display. Pin state is a per-badge boolean on the join row. Public profile only renders pinned earned badges.

### 11.4 Data model

```prisma
model Badge {
  id          String          @id @default(cuid())
  code        String          @unique  // 'EVT-001'
  category    BadgeCategory
  rarity      BadgeRarity
  // title + description live in client copy; only code travels over the wire.
  createdAt   DateTime        @default(now())
}

enum BadgeCategory { eventos carros comunidade jdm }
enum BadgeRarity   { common rare legendary }

model GarageBadge {
  id         String   @id @default(cuid())
  garageId   String
  badgeCode  String
  earnedAt   DateTime @default(now())
  pinned     Boolean  @default(false)
  sourceRef  String?  // e.g. eventId, postId — for auditability
  garage     Garage   @relation(fields: [garageId], references: [id], onDelete: Cascade)
  @@unique([garageId, badgeCode])
  @@index([garageId, pinned])
}
```

- `Badge` is seeded once; the **code** is the source of truth (client knows codes, server enforces existence). Adding badges = inserting `Badge` rows + a copy-file entry.
- `GarageBadge` is the join. Server-side awarder writes new rows; `pinned` is owner-mutable.

### 11.5 API surface (additive)

| Method                                                                         | Path                          | Body                  | Response                    |
| ------------------------------------------------------------------------------ | ----------------------------- | --------------------- | --------------------------- |
| `GET`                                                                          | `/me/garage/badges`           | —                     | `{ earned: GarageBadge[] }` |
| `PATCH`                                                                        | `/me/garage/badges/:code/pin` | `{ pinned: boolean }` | `{ badge: GarageBadge }`    |
| (implicit) `GET /me/garage` and `GET /g/:slug` payloads gain a `badges` field. |

**Public payload shape** (`GaragePublic.badges`) is allowlist-strict — only `{ code, earnedAt }` for pinned earned. No `pinned` flag (it's always true on public). No locked entries.

**Pin limit:** server-enforced at 3. Attempting to pin a 4th returns `409 pin_limit`.

### 11.6 Awarder

A separate `badge-awarder` service hooked into the relevant write paths:

- Event check-in → consider `EVT-001`, `EVT-002`, `EVT-003`, `JDM-001`, `JDM-002`.
- Car create → `CAR-001`, `CAR-002`, `CAR-003`.
- Post create / engagement counter → `COM-001`, `COM-002`, `COM-003`.
- Signup (one-shot at migration + per-signup) → `JDM-003` if `createdAt < 2026-06-01`.

Awarder is idempotent (the `@@unique([garageId, badgeCode])` constraint enforces it). The awarder fires from the existing service-layer write paths (no event bus needed for v1). Each award also writes an `AdminAudit` entry with `action: 'badge.award'` for traceability.

### 11.7 PR-sized chunks (continues from §7)

| #   | Chunk                                                                                  | Depends on  | Files                                                                     |
| --- | -------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| 15  | **Schema** — `Badge` + `GarageBadge` + enums + migration + seed                        | 01          | `packages/db/prisma/schema.prisma`; new migration; seed adds 12 codes     |
| 16  | **Shared schemas + copy** — `badgeCodeSchema`, `garageBadgeSchema`; `~/copy/badges.ts` | 15          | `packages/shared/src/badges.ts` (new); `apps/mobile/src/copy/badges.ts`   |
| 17  | **API** — `GET /me/garage/badges`, `PATCH .../pin`, `badges` in payloads               | 15          | `apps/api/src/routes/garage.ts`; `apps/api/src/services/garage/badges.ts` |
| 18  | **HexBadge + BadgeRow + BadgesSheet + BadgeDetail** in `@ccc/ui`                       | 16, 18 (UI) | `packages/ui/src/HexBadge.tsx` etc                                        |
| 19  | **GarageListView** integration — `BadgeRow` slot between header and stalls             | 18, 06      | `apps/mobile/src/screens/garage/GarageListView.tsx`                       |
| 20  | **SSR public profile** picks up `badges` field                                         | 13, 17      | new Next.js components                                                    |
| 21  | **Awarder service** — wired into check-in, car-create, post-create                     | 17          | `apps/api/src/services/garage/badges.ts`; call sites in events/cars/feed  |
| 22  | **Admin user-detail panel** — surface earned badges + manual grant                     | 17          | `apps/admin/app/(authed)/users/[id]/garage-badges-panel.tsx` (new)        |

Chunks 15–20 are the gameplay loop. 21 makes badges actually fire. 22 lets organizers grant manually for one-off awards.

### 11.8 LGPD posture (unchanged invariants)

- Public payload allowlist stays strict. `badges` on `GaragePublic` only includes pinned earned (`{ code, earnedAt }`), nothing else.
- Locked badges and unpinned earned badges are owner-private — never on `GaragePublic`.
- DSR export includes the user's `GarageBadge` rows.
- Anonymization deletes the `GarageBadge` rows in the same transaction (FK cascade does it; verify in the existing anonymize integration test).

### 11.9 Friction / UX-Audit ties

This system addresses two product needs implicit in the brief but not in the UX Audit:

- "Premium does not gate functional access" — but free users still need a sense of progression. Conquistas provide that without paywalling.
- "First-impression empty state" — the welcome banner explains the construct, but once the user adds a car they need a _next_ thing to chase. The badge row (after first earn) gives ongoing surface for re-engagement.

### 11.10 Out of scope for v1

- Progress bars on locked badges. The `criteria` sentence is enough for v1; progress requires per-badge counters.
- Badge "secret" treatment (titles hidden until earned). Could add a `secret: boolean` flag on `Badge` later.
- Push notifications on award. The award row is logged; UI surfaces it on next garage load. Push is a follow-up.
- Cross-user comparison ("Você vs Caio: 6 a 9"). Out of scope.
