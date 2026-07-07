# Handoff: Garage Per-User Pivot — Redesign

## Overview

Visual + interaction redesign of the **garage per-user** feature in the JDM Experience app. The feature already shipped end-to-end (PRs #355 → #366 on `main` of `jdm-experience/`); this handoff is the **second pass that makes it look and feel right** — without rewriting the backend or breaking any locked contract.

In scope for this v1 redesign:

- Mobile `/garage` (owner view) — all states (fresh signup, partial, at-cap, unlimited, mixed sources, premium gold/silver/bronze, expired).
- Mobile `/g/:slug` (public profile) — populated, empty, anti-enumeration 404.
- A new **parking-stall card** system replacing the dashed-border placeholder.
- A new **cover image** system (LinkedIn-style hero) with curated presets + R2 upload.
- A new **PremiumBadge** (3 directions shown; V2 tier-pill recommended) — tappable, with a "What is Premium?" sheet.
- Edit affordance via a sheet (replaces the invisible inline-edit on `GarageHeader`).
- Buy-spot quick-confirm sheet (cuts the 5-tap loop).
- **Conquistas (achievement badges)** — hex-emblem gamification layer with 12 badges across 4 categories × 3 rarities, owner + public placement, and a dedicated drawer with detail view + pin model.

**Out of scope** (deferred to v2): admin surfaces, light mode, tablet layout, EN copy, real preset artwork.

---

## About the design files

The HTML in this bundle is **design reference, not production code**. It's a hi-fi prototype built with React 18 + inline Babel, run as a single `JDMA-590 · Garagem.html` page. The componentry mirrors the structure of the real codebase but uses local sample data and CSS-rendered placeholders for things that don't exist yet (cover preset images, car photos).

Your task is to **recreate these designs inside the existing `jdm-experience/` monorepo** using its established stack:

- **Mobile:** Expo + React Native + the `@jdm/ui` shared library (`packages/ui/src/*`) + RN StyleSheet patterns. Existing screens live under `apps/mobile/src/screens/garage/*` and `apps/mobile/app/(app)/garage/*`.
- **Admin:** Next.js + Tailwind + `apps/admin/src/components/*`.
- **Shared:** zod schemas in `packages/shared/src/*`. Prisma schema in `packages/db/prisma/`.
- **API:** Fastify in `apps/api/src/routes/garage.ts` + services in `apps/api/src/services/garage/`.

The prototype does NOT change any of the locked contracts in `.handoffs/garage-spots-orchestration.md`. Premium stays serializer-computed. `/g/:slug` stays allowlist-only. Anti-enumeration 404 stays identical for unknown vs private slugs.

---

## Fidelity

**High-fidelity.** Pixel-perfect mockups. Exact hex values, font sizes, spacing, and radii are encoded in `jdma-garage/atoms.jsx` under the `JDM` token object. Recreate using:

- `theme.colors.*` (existing) for the unchanged tokens.
- `garageTokens.tier.*` and `garageTokens.paint.*` (NEW — see §3.2 of `IMPLEMENTATION.md`) for the new ones.

The PT-BR copy in the prototype is the canonical copy. EN scaffolding exists in `apps/mobile/src/copy/garage.ts` but no design exploration of EN strings was done.

---

## Where to start

1. **Read `IMPLEMENTATION.md`** in this folder — that's the canonical change list. It has:
   - Data-model deltas (`Garage.coverPreset` + `Garage.coverImageUrl`).
   - New API endpoints (`PATCH /me/garage/cover`, `POST /me/garage/cover/upload`).
   - New shared zod schemas.
   - Tokens patch.
   - 14 PR-sized chunks, ordered + dependency-tagged.
   - Tie-back to every UX-Audit J observation.

2. **Open `JDMA-590 · Garagem.html`** in a browser and use the Tweaks panel to flip badge variant + cover preset + near-expiry state. Every screen reacts live.

3. **Skim `jdma-garage/atoms.jsx` + `jdma-garage/screens.jsx`** — these are the canonical visual reference. The `JDM` object at the top of `atoms.jsx` is the token table. The components are structured 1:1 to how they should land in `@jdm/ui` and `apps/mobile/src/screens/garage/`.

4. **Cross-reference `.handoffs/garage-spots-smoke-test-plan.md` §UX Audit** in the main repo — every "MAJOR" finding maps to a fix in this redesign. The mapping table is at the bottom of `IMPLEMENTATION.md`.

---

## Screens / Views

### Owner — `/garage`

**Source file (existing):** `apps/mobile/app/(app)/garage/index.tsx` + `apps/mobile/src/screens/garage/GarageListView.tsx` + `GarageHeader.tsx`.

**Layout (top → bottom):**

1. **Status bar** (44pt). Light glyphs (the page is dark).
2. **Cover image** (168pt). Full-bleed. `GarageCover` component (new). Renders preset or custom R2 image. Includes a subtle bottom scrim for legibility.
3. **Identity card** — overlaid via `margin-top: -44px`. Contains:
   - Garage glyph (52×52, rounded 12px). Tier-tinted background + matching icon color when premium active; neutral surfaceAlt otherwise.
   - Garage name (Inter 700 / 17px / letter-spacing -0.2). Pencil glyph (14px) inline after name for owner.
   - PremiumBadge (next to name, when active).
   - `jdmexp.app/g/<slug>` in JetBrains Mono 11.5px with lock/globe glyph prefix.
   - Description (Inter 400 / 13px / line-height 1.5) below the title row when present.
   - Action row: car-count Pill + visibility Pill, then `[Capa]` + `[Editar]` buttons (owner) or `[Compartilhar]` button (public viewer).
   - When `isPremiumActive`, a 2px gradient bar at the top of the card from tier color to transparent.
4. **Welcome banner** (only when state === `'fresh'`) — brand-tinted card with sparkle glyph + "Bem-vindo à sua Garagem" + slot-count explainer.
5. **Section header** "Vagas" + count pill (e.g. `2/3`) + capacity-mode label in mono caps (`GRÁTIS` / `ILIMITADO` / `GRÁTIS + EXTRA` / `NO LIMITE`).
6. **Stall list** (vertical stack, 12px gap, 16px horizontal padding). Each stall is a `ParkingStallCard` (NEW — see §5.1 of IMPLEMENTATION.md).
7. **Expired notice** (only when state === `'expired'`) — warning-tinted card explaining the badge + cover were disabled.

**Stall card anatomy** — two-row card, 14px radius, surface bg, border `JDM.border`:

- **Stall floor** (top, 116pt):
  - Asphalt texture: 1px grid with `JDM.asphaltLine` over `JDM.asphalt`.
  - Painted U: 3px wide rails on left + right inset 10pt; 3px curb on bottom inset 10pt. Paint color = source-aware.
  - Faint chevron at top (two 18×2pt skewed lines, 45% opacity).
  - **Slot plate**: monospace `SLOT NN` at top-left, paint-colored, 11px, weight 600.
  - **Source tape** at top-right (when source !== `default_free`): 2×7pt padding, 3px radius, dashed border, mono 9px:
    - `purchase` → "RESERVADA" in gold over rgba(232,179,57,0.18).
    - `admin_grant` → "CORTESIA" in cyan over rgba(74,212,224,0.18).
    - buy-CTA → "À VENDA" in red, solid border.
- **Metadata band** (bottom, padding 10/14/12, `surfaceDeep` bg, border-top):
  - **Filled:** `<year> <make> <model>` (Inter 700 / 14px) + nickname (Inter 400 / 12px / muted). PremiumBadge on the right when active.
  - **Empty:** "Adicionar Carro" (Inter 600 / 14px) + source-aware subtitle.
  - **Buy:** "Comprar Vaga Adicional" + subtitle on the left, price (mono 700 / 15px) on the right.

**Filled stall — car photo placement**: insets 22 (left/right), 36 (top — clears the slot plate), 18 (bottom — clears curb). 10px inner radius. Shadow `0 6px 18px rgba(0,0,0,0.5)`.

### Public — `/g/:slug`

**Source file (existing):** none on mobile yet — currently API-JSON only. **NEW:** add HTML route on the admin/marketing app for non-app visitors (chunk 13 in IMPLEMENTATION.md).

**Layout:** identical to owner (cover + IdentityCard + section header + stall list) but:

- No edit affordances. No `[Capa]` / `[Editar]` buttons.
- Stall cards render WITHOUT source-aware tape (the spot concept is internal to the owner). All cars show as standard free-paint stalls.
- "Compartilhar" replaces "Editar" in the action row.
- Empty state: dashed-border placeholder block with garage glyph + "Nenhum carro publicado" + "<garage name> ainda não publicou carros."

### Public — 404 (anti-enumeration)

**Source file (existing):** route returns same body for unknown vs private slugs — DO NOT add any signal that distinguishes them.

**Layout:** centered single column. Lock glyph in a circle, "Garagem não encontrada", muted explainer, monospace pill showing `HTTP 404 · /g/<slug>`. Same dark background. No status difference from unknown-slug 404.

### Sheets

All four sheets share a `SheetShell` base — backdrop (rgba 0,0,0,0.55 + 2px blur), bottom-anchored panel, 18px top corners, grabber bar at top center, title + close button bar, scrolling body.

1. **PremiumSheet** — opens when PremiumBadge is tapped. Hero block (tier-tinted gradient) + 4 benefit rows + near-expiry warning (conditional) + "Premium NUNCA limita o uso" footer disclaimer.
2. **CoverPickerSheet** — 2-column grid of 8 presets + 1 upload tile. Free users see locked tiles with a "Premium" lock pip. Selected gets a brand-red checkmark badge. Each preset thumb is a 80pt mini render of the same `GarageCover` component.
3. **BuySpotSheet** — replaces direct nav to `/cart`. Line-item card + 3-bullet explainer (Pagamento único / 60s / auto-return) + side-by-side Pix + Cartão CTAs.
4. **EditGarageSheet** — replaces the invisible inline edit on `GarageHeader`. Three fields (Nome, URL pública with `/g/` prefix, Descrição) with character counters. Visibility toggle in its own card. Cancel + Salvar at the bottom.
5. **BadgesSheet** — drawer for the Conquistas system. Big count display + 5 category tabs (All / Eventos / Carros / Comunidade / JDM) + 3-column hex grid. Tap a badge → in-sheet drilldown to `BadgeDetail` (header swaps to "Voltar"). See §11 of `IMPLEMENTATION.md`.

---

## Interactions & behavior

- **PremiumBadge tap** → opens `PremiumSheet`. The badge is `<span role="button" tabIndex={0}>` (not `<button>`) so it can nest inside the parent stall-card's `Pressable` without DOM-nesting issues.
- **Stall card tap (filled)** → navigates to `/garage/<carId>` (unchanged from current behavior).
- **Stall card tap (empty)** → opens add-car flow (unchanged).
- **Stall card tap (buy)** → opens `BuySpotSheet` (CHANGED — used to push `/cart` directly).
- **`[Capa]` button** → opens `CoverPickerSheet`.
- **`[Editar]` button** → opens `EditGarageSheet`.
- **Cover preset tap (premium)** → calls `PATCH /me/garage/cover` with `{ coverPreset }`, optimistic update.
- **Cover preset tap (locked)** → opens `PremiumSheet` (upsell).
- **Upload tile tap** → `POST /me/garage/cover/upload` → R2 pre-signed PUT → on settle, `PATCH /me/garage/cover` with `{ coverImageUrl }`.
- **Post-purchase webhook settle** → deep-link back to `/garage?highlight=<spotId>` with a 2s pulse on the new card (chunk 10).
- **Share link** → fully-qualified URL `https://jdmexp.app/g/<slug>` via `Share.share({ message, url, title })`. Domain constant in `apps/mobile/src/config/urls.ts` (NEW).

**Slug error mapping (fix UX-Audit B.3):**

- regex violation → `invalidSlug` copy: "URL pode usar apenas letras minúsculas, números e hífens." (NEW copy entry needed in `~/copy/garage.ts`.)
- reserved word → `reservedSlug` copy (existing).
- 409 collision → `slugTaken` copy (existing).

The `EditGarageSheet` text input must auto-lowercase + filter non `[a-z0-9-]` characters client-side before sending, but the error mapping above runs against server response codes — `invalid_slug` + `reserved_slug` are server-recognized error codes; trap both in the catch block.

---

## State management

**Reuse existing patterns** — TanStack Query for fetches, `useState` for local form state. No new state-management library.

New state needed on the owner garage screen:

- `coverEditorOpen: boolean`
- `editSheetOpen: boolean`
- `premiumSheetOpen: boolean`
- `buySheetOpen: boolean`
- `highlightSpotId: string | null` — populated from URL param after webhook deep-link return; auto-clears after 2s.

API client additions (`apps/mobile/src/api/garage.ts`):

```ts
patchGarageCover({ coverPreset?: string | null, coverImageUrl?: string | null }): Promise<{ garage: GarageOwner }>
requestCoverUploadUrl({ contentType, sizeBytes }): Promise<{ url, fields, putUrl }>
```

---

## Design tokens

### Existing (unchanged)

- `theme.colors.fg` `#F5F5F5`
- `theme.colors.bg` `#0A0A0A`
- `theme.colors.surface` `#141414`
- `theme.colors.surfaceAlt` `#1F1F1F`
- `theme.colors.surfaceDeep` `#0F0F0F`
- `theme.colors.border` `#2A2A2A`
- `theme.colors.borderStrong` `#3A3A3A`
- `theme.colors.muted` `#8A8A93`
- `theme.colors.brand` `#E10600`
- Brand soft `#FF1A0D`, brand tint `rgba(225,6,0,0.12)`
- Fonts: Anton (display), Inter (sans), JetBrains Mono (mono)

### New — additive (no breaking changes)

Tier tokens — for PremiumBadge V2:

| Token         | Hex        | Notes                                                 |
| ------------- | ---------- | ----------------------------------------------------- |
| `tier.bronze` | `#C58A52`  | Solid block bg. Contrast vs `#0A0A0A` text = 5.4:1.   |
| `tier.silver` | `#D6D8DC`  | Contrast vs `#0A0A0A` = 9.0:1.                        |
| `tier.gold`   | `#E8B339`  | Contrast vs `#0A0A0A` = 9.6:1.                        |
| `tier.*Deep`  | (see code) | Reserved for hover/active darken; unused in v1.       |
| `tier.*Tint`  | rgba       | Used for benefit-row icon backgrounds + cover scrims. |

Paint tokens — for ParkingStallCard:

| Token               | Hex / RGB          | Use                            |
| ------------------- | ------------------ | ------------------------------ |
| `paint.free`        | `#9AA0AC`          | default_free stall rails       |
| `paint.extra`       | `#E8B339` (= gold) | purchase stall rails + tape    |
| `paint.adminGrant`  | `#4AD4E0`          | admin_grant stall rails + tape |
| `paint.asphalt`     | `#15161A`          | stall floor base               |
| `paint.asphaltLine` | `#2C2D32`          | 1px grid texture on the floor  |

### Spacing / radii — reuse existing `theme.spacing` + `theme.radii`

- Card radius: 14 (stall card) / 16 (identity card) / 18 (sheet top corners).
- Stall card metadata padding: `10px 14px 12px`.
- Identity card padding: `14px 16px 14px`.
- Stall list gap: `12px`. Outer padding: `16px`.

### Typography sizes

- Garage name (identity card): Inter 700 17px, letter-spacing -0.2.
- Stall title: Inter 700 14px.
- Stall subtitle / nickname: Inter 400 12px.
- Slot plate: JetBrains Mono 600 11px, letter-spacing 1.
- Tape: JetBrains Mono 600 9px, letter-spacing 1.4, uppercase.
- Pill: Inter 600 11px, letter-spacing 1.4 (or 0 + mono true).
- Section header: Inter 700 15px.

---

## Cover presets

8 curated slugs (constant in `packages/shared/src/garage-covers.ts`):

| Slug           | Label                 | Premium | Use case                         |
| -------------- | --------------------- | ------- | -------------------------------- |
| `default-door` | Garage Door · Default | no      | Free tier, fallback when expired |
| `urban-night`  | Urban Night           | yes     | Default for first-time premium   |
| `tokyo-wangan` | Tokyo Wangan          | yes     |                                  |
| `kanjo-loop`   | Kanjo Loop            | yes     |                                  |
| `tsukuba`      | Tsukuba Dawn          | yes     |                                  |
| `paddock`      | Paddock               | yes     |                                  |
| `drift-smoke`  | Drift Smoke           | yes     |                                  |
| `workshop`     | Workshop              | yes     |                                  |
| `sunset-strip` | Sunset Strip          | yes     |                                  |

**The prototype renders these via CSS gradients + scanlines** — they are placeholders. Production needs real artwork:

- 1920×720 @2x (3840×1440), JPEG primary + WebP fallback.
- Hosted on R2 under `garage-cover-presets/<slug>@2x.{jpg,webp}`.
- Should feel premium, not stock. Brief explicitly calls this out.

Until real artwork exists, the implementer can ship the CSS-rendered versions in `GarageCover` as a first pass.

---

## Conquistas (achievement badges)

A gamification layer that sits alongside (not replacing) `PremiumBadge`. Premium is paid; Conquistas are earned.

**Catalog v1 — 12 badges, 4 categories × 3 rarities.** Stable codes (`AAA-NNN`) are the wire format; titles + descriptions live in `~/copy/badges.ts` (PT-BR primary, EN scaffold).

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

### Visual standard (locked in)

Every badge is an instance of `HexBadge` (new — `packages/ui/src/HexBadge.tsx`).

- **Shape** — flat-top hexagon. Exact `clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)`. Two-layer (outer ring + inner fill). Never use circular/square/shield variants for new badges.
- **Sizes** — `sm: 32` (inline mentions), `md: 52` (rows/grids), `lg: 96` (detail hero).
- **Ring color (rarity)** — common `JDM.silverDeep` · rare `JDM.gold` · legendary `JDM.brand`.
- **Inner tint** — radial gradient at 50%/60% using the rarity's `*Tint` token.
- **Glyph** — Lucide-style 1.75-stroke line icon centered (14/22/38px per size), color = ring color.
- **Legendary mark** — 8px dot (12px on `lg`) at top-right with rarity-colored glow.
- **Locked state** — `filter: grayscale(1)` + lock glyph + diagonal hatch inside the hex.
- **Label** — (optional) Inter 700 11px title + JetBrains Mono 9px code stacked below the hex.
- **Touch target** — when pressable, the parent `<button>` reaches ≥44pt via padding (visual hex stays at 52).

### Placement

| Surface           | What renders                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner `/garage`   | `BadgeRow` after IdentityCard, before "Vagas". Up to 4 (pinned + recent) + `+N` chip. Hidden on fresh signup.                                           |
| Public `/g/:slug` | Same `BadgeRow`, but only the **pinned** ones (max 3). If owner pinned zero, row is hidden entirely.                                                    |
| `BadgesSheet`     | Full drawer — count display, 5 category tabs, 3-column hex grid. Owner sees locked; public viewer sees only earned.                                     |
| `BadgeDetail`     | In-sheet drilldown. 96pt hex + rarity/category pills + title (Anton 30px) + description. Earned shows date + (owner) pin toggle. Locked shows criteria. |

### Pin model

Owner can pin up to **3 badges** for public display. Pin state is mutable from `BadgeDetail`. Server enforces the cap with a `409 pin_limit` response on a 4th pin.

### Data model + API (new)

- New tables `Badge` (catalog) + `GarageBadge` (join). Schemas in §11.4 of `IMPLEMENTATION.md`.
- New endpoints: `GET /me/garage/badges` + `PATCH /me/garage/badges/:code/pin`.
- `GarageOwner` and `GaragePublic` payloads gain a `badges` field. **Public allowlist stays strict** — only `{ code, earnedAt }` for pinned earned. Locked badges and unpinned earned badges are owner-private.
- Awarder service hooks into existing service-layer write paths (check-in, car-create, post-create). Idempotent via `@@unique([garageId, badgeCode])`.

### Source files (this bundle)

- `jdma-garage/badges.jsx` — catalog data, `HexBadge`, `BadgeRow`, `BadgesSheet`, `BadgeDetail`.
- `JDMA-590 · Garagem.html` Row 5 (artboards T–Y) — system overview + owner placement + public placement + drawer + earned detail + locked detail.
- `IMPLEMENTATION.md` §11 — full data-model + API + chunks 15–22.

---

## Assets

- **Icons** — Lucide React Native (already a dependency). All icons in the prototype map 1:1 to `lucide-react-native` exports. Names:
  `ArrowLeft`, `Share2`, `Pencil`, `Plus`, `Image`, `Lock`, `Globe`, `Check`, `X`, `ChevronRight`, `Key`, `Sparkles`, `Clock`, `Warehouse` (closest to garage glyph), `ShoppingCart`, `Upload`. Stroke width 1.75 to match brand.
- **Pix icon** — there's no Lucide equivalent. Use the inline SVG from `jdma-garage/atoms.jsx` `Icon.Pix` (4-diamond shape) or pull the official Pix-banco-central asset bundled in the app.
- **Cover preset artwork** — TBD per above. Placeholder is fine for v1.
- **Sample car data** — the `SAMPLE_CARS` array in `atoms.jsx` is for prototype-rendering only. Real data comes from `GET /me/garage` + `GET /g/:slug`.

---

## Files

This bundle contains:

- `JDMA-590 · Garagem.html` — the main prototype. Open in a browser.
- `jdma-garage/atoms.jsx` — design tokens + sample data + parking-stall components + 3 PremiumBadge directions + cover renderer.
- `jdma-garage/screens.jsx` — `OwnerGarage`, `PublicGarage`, `PublicGarage404`, `IdentityCard`, and the 4 sheets.
- `jdma-garage/badges.jsx` — **Conquistas system.** Catalog (12 badges), sample earned set, `HexBadge`, `BadgeRow`, `BadgesSheet`, `BadgeDetail`. See §11 of `IMPLEMENTATION.md` for the data model + chunks.
- `jdma-garage/design-canvas.jsx`, `ios-frame.jsx`, `tweaks-panel.jsx` — prototype framework (panning canvas, device frame, tweaks panel). Not for production — these are just to view multiple states side-by-side.
- `IMPLEMENTATION.md` — the canonical change list. 22 PR-sized chunks, ordered by dependency, with file paths into `jdm-experience/`. **Read this first.**

---

## When you start coding

1. **Clone or `cd` into `jdm-experience/`** (the existing monorepo).
2. **Read `IMPLEMENTATION.md`** end-to-end. The "PR-sized chunk list" at the bottom is the build order.
3. **Start with chunk 01 (Tokens)**. It's a pure additive change and unblocks chunks 02 → 06.
4. **Honor the locked contracts in `.handoffs/garage-spots-orchestration.md`** — premium-active is computed, public allowlist is strict, anti-enumeration 404 is identical for unknown vs private. The redesign does NOT relax any of these.
5. **Follow the existing test pattern** — vitest for unit + integration, Testcontainers for real Postgres. Each chunk should land with its own test pass.
6. **Branch convention:** `feat/jdma-garage-redesign-NN` per chunk.

If you get stuck on what a screen should look like, open `JDMA-590 · Garagem.html` in a browser and use the Tweaks panel to navigate to the relevant state.
