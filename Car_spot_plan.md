# Car Garage Spots — High Level Plan (v2)

> ## ⚠️ POST-PIVOT NOTICE (2026-05-20)
>
> **Canonical source:** [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md). Read the spec first; this file is reference material.
>
> **What changed:** Premium membership moved from per-`GarageSpot` tier to a new per-user `Garage` model (name, slug, description, isPublic, premiumTier, premiumUntil). The `GarageSpotTier` enum (free/extra/premium) is dropped entirely — free vs extra is now derived from `GarageSpot.source`. `Car.description` (shipped in PR #356) is dropped; `Garage.description` is the canonical bio. `/g/:slug` public garage profile added. Signup creates the Garage row eagerly with neutral, non-PII defaults; `isPublic=false` by default so nothing leaks until the user opts in. DSR (export + anonymize) covers Garage.
>
> **Superseded sections of this file:** §2 schema (drop tier, add Garage), §3 limit math (use source, not tier), §4 endpoints (add PATCH /me/garage, GET /g/:slug), §5 backfill (add Garage backfill), §6 admin (premium grant/revoke + slug override), §7 mobile (inline edits on /garage, no separate settings screen), §8 admin UI (no spot-tier column). §9 wave plan re-shaped — see spec §7.
>
> **Still valid as written:** the singleton virtual garage Product from TASK-A, `GeneralSettings.defaultFreeGarageSpots`, `GarageSpotSource` enum, settlement-by-webhook invariant, idempotency via `sourceOrderItemId @unique`.

Status: revised after plan review. All blockers and majors from the review pass folded in. Per-task deep tech plans follow in separate files after approval.

> **Changelog vs v1**
>
> - Virtual product model added (`Product.virtual`) so garage spot bypasses Variant inventory, fulfillment, and active-product photo/method requirements.
> - Cart entry path locked: garage product rejected from public `/cart/items`; only internal service adds it via `POST /me/garage/spots/cart`.
> - Fulfillment moved into settlement service (covers `product` and `mixed`), not webhook routes.
> - Quantity per add forced to 1 in MVP; idempotency via `OrderItem.id` unique link. Bulk-buy via composite key deferred.
> - Free-limit decrease math corrected; eager backfill replaces lazy materialization.
> - Migration backfill specified for existing `Car` rows.
> - AdminAudit action enum + entityType extensions enumerated.
> - Admin Zod schemas separated; existing PUT verb honored.
> - Badge surfaces inventoried from grep.

## 1. Goal

Allow attendees to add cars up to a configurable free limit. Beyond that limit, they buy extra garage spots through the normal checkout. Each car sits in a `GarageSpot` row with a tier (`free`, `extra`, `premium`). Foundation for future premium membership and exclusive content.

## 2. Scope

In scope:

- `GeneralSettings.defaultFreeGarageSpots` admin control (nullable = unlimited).
- New `GarageSpot` table; each `Car` belongs to one spot.
- New `ProductType = garage_spot` flagged internal; new `Product.virtual` + `Product.visibleInStore` flags to support buyable products that have no inventory and no shipping/pickup.
- Singleton garage spot Product, virtual + hidden, single virtual `Variant` row to satisfy the existing `OrderItem.variantId` linkage.
- Mobile garage screen: placeholder card "Comprar Vaga Adicional" with dotted border, dev-fee aware price; "Preencher Vaga" cards for empty extra spots.
- Tier picker on car detail (Free / Premium). Premium badge wherever car identity renders.
- Admin: General Settings field for free limit + garage spot product price; user detail panel listing cars with edit + delete + tier override; manual empty-spot deletion for refunds; AdminAudit entries.
- Settlement-level fulfillment hook creating GarageSpot rows for paid garage product line items, in both `product` and `mixed` orders. Idempotent.
- Migration backfill for all existing users + cars.
- Roadmap section (premium membership, exclusive paid posts).

Out of scope (deferred):

- Recurring premium membership billing.
- Bulk garage spot purchase per cart line (quantity > 1 per line) — forced to one line per spot in MVP; composite uniqueness key documented for future.
- Refund automation for purchased spots (manual admin recipe included).
- Spot transfer between users.
- Per-spot photos.

## 3. Architecture overview

### Data model (additions to `packages/db/prisma/schema.prisma`)

```
enum GarageSpotTier { free  extra  premium }
enum GarageSpotSource { default_free  purchase  admin_grant  premium_membership }

model GarageSpot {
  id                String            @id @default(cuid())
  userId            String
  tier              GarageSpotTier    @default(free)
  source            GarageSpotSource
  carId             String?           @unique     // nullable = empty spot
  sourceOrderItemId String?           @unique     // links extra spot to purchase row; OrderItem.quantity forced to 1 for garage product
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  car  Car? @relation(fields: [carId],  references: [id], onDelete: SetNull)
  @@index([userId])
  @@index([userId, tier])
  @@index([userId, carId])   // supports availability count where carId is null
}

// FK lives on GarageSpot; Car has back-relation. Car create runs inside a transaction
// that first finds an available spot (carId=null) for the user, inserts the Car,
// then `tx.garageSpot.update` sets carId. Existing Car flow currently inserts car alone — see TASK-B.
```

```
model Product {
  // ...existing...
  visibleInStore Boolean @default(true)
  virtual        Boolean @default(false)   // bypasses Variant inventory + fulfillment requirements
}

model GeneralSettings {
  // ...existing...
  defaultFreeGarageSpots Int?     // null = unlimited
}
```

`ProductType` seed row: `{ name: "garage_spot", sortOrder: 99 }`. `Product` singleton seed: `{ slug: "garage-spot", title: "Vaga de Garagem Adicional", productType: garage_spot, status: 'active', visibleInStore: false, virtual: true, allowPickup: false, allowShip: false, basePriceCents: <admin configurable> }`. One `Variant` row tied to it (priceCents mirrors product, `quantityTotal=0` is ignored when virtual). Seed enforces immutability (script refuses to duplicate).

### Existing-code touchpoints (verified against repo)

| File                                                                           | Change                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/services/cart/index.ts:661`                                      | Allow `status=active` virtual products; **reject** garage variants entirely from this code path so only the internal garage service can add them.                                                                                                                                                                                               |
| `apps/api/src/services/cart/checkout.ts:411`                                   | If `variant.product.virtual`, skip `sweepExpiredOrdersForVariant`, skip `updateMany` reservation, and assign a synthetic `fulfillmentMethod` (new `FulfillmentMethod = virtual` enum value, see below).                                                                                                                                         |
| `apps/api/src/routes/cart.ts:501`                                              | `hasProductItems` check ignores items whose product is virtual (no pickup/ship required). Virtual products contribute zero to shipping or fulfillment requirement decisions.                                                                                                                                                                    |
| `apps/api/src/routes/admin/store/products.ts:121`                              | Activating a virtual product skips photo + fulfillment-method requirement. Admin UI hides those fields for virtual products.                                                                                                                                                                                                                    |
| `apps/api/src/routes/store.ts:345,451`                                         | `/store/product-types` filters out ProductTypes where every Product is `virtual=true` or `visibleInStore=false`. `/store/products/:slug` rejects when product is `visibleInStore=false`. `/store/products` list adds `visibleInStore=true` filter.                                                                                              |
| `apps/api/src/services/orders/settle.ts` (both `product` and `mixed` branches) | After the `Order.status='paid'` update, iterate `OrderItem` rows where `kind='product'` and the linked `Variant.product.productType.name === 'garage_spot'` and create one `GarageSpot{ tier: extra, source: purchase, sourceOrderItemId: orderItem.id }`. Idempotent via `sourceOrderItemId @unique`. Wrap in the same `tx` that flips status. |
| `apps/api/src/services/tickets/issue.ts:483` mixed-order settlement            | Same iteration; runs after the existing `tx.order.update(... status: 'paid' ...)`.                                                                                                                                                                                                                                                              |
| New `FulfillmentMethod = virtual` value (Prisma enum)                          | `FulfillmentStatus` for virtual orders is set to `fulfilled` on settle (or a new `virtual_complete`). Pick simplest in TASK-C: `fulfillmentStatus = 'picked_up'` requires no schema change but is semantically wrong. Decision in TASK-C tech plan: extend `FulfillmentStatus` with `virtual_complete`.                                         |

### Limit math (corrected)

For a user with `n` cars:

- `freeLimit = GeneralSettings.defaultFreeGarageSpots` (null = ∞).
- `freeFilled = GarageSpot.count(userId, tier=free, carId NOT NULL)`.
- `freeEmpty = GarageSpot.count(userId, tier=free, carId IS NULL)`.
- `extraEmpty = GarageSpot.count(userId, tier=extra, carId IS NULL)`.
- `availableSlots = freeEmpty + extraEmpty` (premium spots **excluded** — see below).

Rules:

- Free spots are materialized **eagerly**:
  - On user signup: create `freeLimit` rows of `tier=free, source=default_free, carId=null`. If `freeLimit=null` (unlimited), create rows lazily on car add instead — the only path that consumes a free slot.
  - On `PUT /admin/general/settings` save: enqueue background fanout that calls `reconcileGarageSpots(userId)` per user. MVP fanout is a synchronous loop bounded by user count, with a logged note that this becomes a job queue once user count grows.
- Adding a new car requires `availableSlots ≥ 1`. Allocation precedence: prefer `free` empty over `extra` empty. Premium empties never auto-allocated.
- Deleting a car sets `GarageSpot.carId = null`. Tier of the spot is preserved. UI labels emptied `extra` spots "Preencher Vaga"; emptied `free` spots are just slots.
- Reducing `defaultFreeGarageSpots`:
  - `targetFreeTotal = max(freeLimit, freeFilled)` — never delete a filled free spot, never undercount what's already in use.
  - `currentFreeTotal = freeFilled + freeEmpty`.
  - If `currentFreeTotal > targetFreeTotal` → delete `(currentFreeTotal - targetFreeTotal)` rows from `freeEmpty` (oldest first). Never touch filled rows. Never delete extra/premium.
- Increasing `defaultFreeGarageSpots`:
  - Insert `(freeLimit - currentFreeTotal)` new free rows for the user. No-op if non-positive.
- Concurrency: `reconcileGarageSpots(userId)` runs inside a Prisma transaction at `Serializable` isolation. Car create + spot allocation also runs in a transaction with `tx.garageSpot.updateMany({ where: { userId, carId: null, tier: <next> }, data: { carId }, limit 1 })` via `update` with a unique selection. Compound retry on `P2034`. Documented in TASK-B tech plan.

### Migration backfill

In the same migration that adds `GarageSpot`:

1. Read `GeneralSettings.defaultFreeGarageSpots` (default 1 if not yet set).
2. For each existing `Car`: insert one `GarageSpot{ userId, tier=free, source=default_free, carId, sourceOrderItemId=null }`. Cars exceeding the free limit are still tier=free with `source=default_free` (grandfathered) — they do not trigger purchase backfill.
3. For each existing user with no cars: insert `min(freeLimit, 1)` empty free spots (use `defaultFreeGarageSpots` default = 1). If `freeLimit=null` insert zero.
4. AdminAudit entry per backfill batch (`general_settings.garage_backfill`).

Migration runs in a transaction; rerun-safe via `INSERT ... ON CONFLICT DO NOTHING` on the `carId @unique` constraint.

### Product wiring (revised)

- `POST /me/garage/spots/cart` is the **only** entry that adds the garage product to a cart. It opens or reuses the user's open `Cart`, locates the singleton garage `Variant`, and inserts a `CartItem` with `quantity=1, kind='product'`. Repeated calls insert additional `CartItem` rows (one per extra spot bought).
- Public `POST /cart/items` rejects requests whose variant belongs to a virtual+hidden garage product (server-side type check, not flag-from-client). This is the spoof-resistant guard.
- Checkout: dev fee already applies via `applyDevFee` over `baseAmountCents`. Garage products contribute price to `baseAmountCents` like any product. `shippingCents = 0`, no `shippingAddressId` required for an all-virtual cart.
- Settlement (see touchpoints): each garage `OrderItem` → one `GarageSpot` row. Idempotent.

### Premium tier (scaffold-only this MVP)

- `GarageSpot.tier` includes `premium`. No purchase path. Admin grant **upgrades an existing GarageSpot's tier** for a selected car (`free` or `extra` → `premium`). Admin grant does **not** create a new empty premium spot in MVP. Future membership flow will create empty premium spots and let the user assign a car.
- Tier picker on car detail UI is **shipped now** but its options list is constrained to tiers the user can switch the spot to (`free` always, `premium` only if admin already upgraded that car's spot). In MVP a normal user sees the picker but only `free` is selectable. Decision: ship picker so admin-granted premium is reversible by user; if reviewer prefers to defer, fold into roadmap.
- Premium badge surfaces (inventoried by grep):
  - `apps/mobile/src/screens/events/feed/FeedComments.tsx`
  - `apps/mobile/src/screens/events/feed/FeedPostCard.tsx`
  - `apps/mobile/src/screens/cart/CarPlatePicker.tsx`
  - `apps/mobile/src/screens/events/feed/CarPickerPopover.tsx`
  - `apps/mobile/src/screens/events/confirmed-cars/ConfirmedCarsSection.tsx`
  - `apps/mobile/src/screens/events/confirmed-cars/CarDetailSheet.tsx`
  - Garage list, garage car detail
  - `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx`
  - `apps/admin/app/(authed)/events/[id]/community-management.tsx` (uses `carNickname`)
  - Admin user detail garage panel
- All surfaces consume a shared `PremiumBadge` component; car payloads gain a `tier` field in their Zod schema in `packages/shared/src/cars.ts`.

## 4. User-facing flows

### Mobile

- **Garage list (`/garage`)** with eager backfill, `availableSlots` is always > 0 unless the user has hit the limit:
  - For every empty spot: a "Preencher Vaga" card routes to `/garage/new?spotId=...`. Free empty cards use neutral copy ("Adicionar Carro" placeholder); extra empty cards use "Preencher Vaga" copy.
  - When all spots are filled, a final placeholder card "Comprar Vaga Adicional" appears, shows display price (dev-fee included), tap → `POST /me/garage/spots/cart` then routes to `/cart`.
  - First-run state (zero cars, `freeLimit ≥ 1`): one "Adicionar Carro" card (a free spot is already empty). No buy card shown.
  - First-run with `freeLimit = 0`: only the "Comprar Vaga Adicional" card.
- **Garage/new**: form unchanged; on submit if `spotId` query present, assign to that spot. Else allocate by precedence.
- **Car detail**: tier picker (Free / Premium). Premium option disabled with helper text in MVP unless the spot is already premium.
- **Cart**: garage spot line renders title "Vaga de Garagem Adicional".

### Admin

- **Configurações → Geral**: numeric field "Vagas de garagem grátis por usuário" + "Ilimitado" toggle. Saving uses existing **PUT** `/admin/general/settings` route. Save triggers `reconcileGarageSpots` fanout.
- **Loja → Produtos**: garage spot product appears in admin product listing (admin sees all products regardless of `visibleInStore`). Edit view hides photo + fulfillment-method fields for virtual products. Cannot be deleted (validation in PATCH).
- **Usuários → detalhe → Garagem**: car table with edit (make/model/year/nickname), delete, tier override (Free ↔ Premium), and per-spot delete for empty extras (refund-recipe support). All AdminAudit-logged.

## 5. API surface (high level)

- `GET /me/garage`:
  - Returns `{ cars: [...with tier...], spots: [{ id, tier, source, carId, createdAt }], availableSlots, freeLimit, purchaseOption }`.
  - `purchaseOption = { variantId, basePriceCents, displayPriceCents, devFeePercent, currency }`. Pulled from the singleton garage Variant + `applyDevFee`.
- `POST /me/garage/spots/cart`: adds one garage spot line to user's open cart (creates cart if needed). Returns updated cart. Rate limited under existing cart write bucket.
- `POST /me/cars`: existing; now requires `availableSlots ≥ 1`, allocates spot, returns car with `tier`.
- `DELETE /me/cars/:id`: existing; now clears `GarageSpot.carId` (preserves tier and row).
- `PATCH /me/cars/:id`: existing; tier change blocked at this endpoint (not user-facing).
- Admin endpoints (all AdminAudit logged):
  - `GET /admin/users/:id/garage` (cars + spots)
  - `PATCH /admin/users/:id/cars/:carId` (admin-only Zod schema; see TASK-G)
  - `DELETE /admin/users/:id/cars/:carId`
  - `POST /admin/users/:id/cars/:carId/tier` body `{ tier: 'premium' | 'free' | 'extra' }` — upgrades the existing spot tier
  - `DELETE /admin/users/:id/spots/:spotId` — only allowed when `carId IS NULL`
- General settings extension: existing **PUT** `/admin/general/settings` body extended with `defaultFreeGarageSpots: z.number().int().nonnegative().nullable()`.

All responses use Zod schemas from `packages/shared`. New schemas:

- `packages/shared/src/garage.ts`: `garageSpotSchema`, `garagePurchaseOptionSchema`, `garageReadSchema`.
- `packages/shared/src/cars.ts`: extend `carSchema` with `tier: GarageSpotTierEnum`.
- `packages/shared/src/admin.ts`: extend `adminAuditActionSchema` with `car.admin_update`, `car.admin_delete`, `garage_spot.tier_override`, `garage_spot.delete`, `general_settings.garage_backfill`. New `adminCarUpdateSchema` (admin-only fields).
- `apps/api/src/services/admin-audit.ts`: extend `entityType` union with `car`, `garage_spot`.

## 6. Mobile / Admin UI changes (summary)

- New components: `GarageSpotPlaceholderCard`, `BuySpotCard`, `FillSpotCard`, `PremiumBadge`.
- Copy lives in `apps/mobile/src/copy/garage.ts` (no shared locale package exists in repo today; consistent with current pattern).
- Admin pages updated under `apps/admin/app/(authed)/configuracoes`, `apps/admin/app/(authed)/users/[id]`, and `apps/admin/app/(authed)/loja` (for virtual product edit UX).

## 7. Cross-cutting

- LGPD: car edits/deletes by admin emit AdminAudit; no new PII surfaces.
- Rate limit: `POST /me/garage/spots/cart` under existing cart write bucket.
- Tests: integration tests (real Postgres) for limit math, reconciliation, fulfillment idempotency, admin overrides, virtual-product checkout, and migration backfill. Mobile snapshot for placeholder card states.
- Settlement remains the single source of truth that flips orders to `paid`; spot fulfillment runs in the same transaction as the status flip, idempotent on `sourceOrderItemId`.
- Analytics: **explicit decision — defer**. No analytics adapter exists. Hooks land later if/when product analytics is added; we do not introduce an adapter for this feature alone.
- Push notifications on admin premium grant: deferred (decision point flagged).

## 8. Roadmap (future, not in this MVP)

1. **Premium membership purchase**: recurring Stripe subscription product. On `subscription.active` create `GarageSpot{ tier: premium, source: premium_membership }` (empty premium spot). On `past_due` / `cancelled` downgrade tier to `extra` (grandfathered) without deleting cars.
2. **Exclusive paid feed posts**: car-owned posts visible only to premium subscribers of that car.
3. **Bulk garage spot purchase per cart line**: introduce `[sourceOrderItemId, sourceOrderItemUnitIndex] @@unique` and allow quantity > 1 per line.
4. **Spot transfer / gifting** between users.
5. **Bulk admin spot management**: prune empty extras, refund spots automatically.
6. **Per-spot analytics** for organizer dashboards.

## 9. Task breakdown (each gets its own deep tech plan)

1. **TASK-A — Schema, virtual product, seed, backfill**
   `GarageSpot` model, `GarageSpotTier`, `GarageSpotSource`, `Product.virtual`, `Product.visibleInStore`, `GeneralSettings.defaultFreeGarageSpots`, `FulfillmentMethod=virtual`, `FulfillmentStatus=virtual_complete`. AdminAudit action enum + entityType extension. Singleton `garage_spot` ProductType + Product + Variant seed. Migration backfill for existing Cars and Users. Tests against real Postgres. Internal-product validation: cannot delete the singleton.

2. **TASK-B — Public garage API + limit enforcement**
   `reconcileGarageSpots(userId)` service (Serializable tx). `GET /me/garage` with `purchaseOption`. Updated `POST /me/cars` (spot allocation precedence, transactional). `DELETE /me/cars/:id` (clears `carId`). `POST /me/garage/spots/cart` (internal-only, rejects public `/cart/items` for virtual+hidden). Zod schemas in `packages/shared`. Integration tests covering limit transitions, empty-spot reuse, concurrent car-add, and cart guard against direct POST.

3. **TASK-C — Virtual product checkout + settlement fulfillment**
   Cart service / checkout / cart route changes to handle virtual variants (no inventory reservation, no shipping/pickup). Settlement service iterates garage OrderItems for `product` and `mixed` orders, creates GarageSpot rows in the same transaction as `status='paid'` flip. `FulfillmentStatus=virtual_complete` set on the order. Idempotency tests using replayed webhook payloads.

4. **TASK-D — Mobile garage UI**
   Placeholder card, Buy Spot card with dynamic display price from `purchaseOption`, Fill Spot cards, copy strings in `apps/mobile/src/copy/garage.ts`, navigation wiring. Snapshot + interaction tests. **Starts** once TASK-B Zod schemas + `purchaseOption` shape are merged and a mock fixture is published in `packages/shared/test-fixtures`. Endpoint implementation does not need to be live for mobile work.

5. **TASK-E — Mobile + admin car tier picker + Premium badge**
   `PremiumBadge` component. Tier field threaded through `carSchema`. Badge placement at all surfaces inventoried in §3. Tier picker UI on car detail (MVP restricts options as documented).

6. **TASK-F — Admin General Settings field**
   "Vagas de garagem grátis" field + "Ilimitado" toggle. Extend existing **PUT** `/admin/general/settings`. Trigger reconcile fanout on save. AdminAudit entry. Tests.

7. **TASK-G — Admin user-detail car + spot management**
   Garage panel on user detail page. New admin endpoints (list, edit, delete car; tier override; delete empty spot). Admin Zod schemas (`adminCarUpdateSchema`). AdminAudit entries. Manual refund recipe documented as "delete empty extra spot + audit". Tests.

8. **TASK-H — Admin product editor support for virtual products**
   Trimmed to UI only: hide photo + fulfillment-method fields when `virtual=true`; show price editor; disable delete for the singleton garage product. (Schema, seed, validation moved to TASK-A.) Tests.

Sequencing:

- TASK-A first (schema + seed + virtual product capability + audit enum).
- TASK-B and TASK-C parallel after A.
- TASK-D parallel to TASK-B/C once `garageReadSchema` + `purchaseOption` + cart mutation contract are merged and fixtures published.
- TASK-E parallel to TASK-D once `carSchema.tier` is merged.
- TASK-F after A.
- TASK-G after A (depends on AdminAudit extension and admin Zod schemas from TASK-A).
- TASK-H after A (UI-only at this point).

## 10. Open questions / risks

- **Race: car-add while admin reduces free limit**. Resolved by Serializable tx in `reconcileGarageSpots` + `tx.garageSpot.updateMany` allocation in car-add.
- **Spoofed garage product in public cart**: resolved by server-side type check that rejects virtual+hidden variants from `/cart/items`.
- **Refund of garage spot**: manual recipe documented — admin deletes empty extra spot via `DELETE /admin/users/:id/spots/:spotId` and AdminAudit captures action. Automated refund deferred.
- **Premium picker dead UI**: shipping the picker now keeps the tier-toggle surface live for admin-granted premium. If reviewer prefers tighter scope, picker collapses to badge-only display until membership ships.
- **Fanout cost on settings change**: synchronous loop in MVP. Plan accepts a logged TODO to move to a job queue if `User` count grows past a documented threshold.
- **Tickets/check-in UI** (`apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx`) needs tier on the car payload — the check-in endpoint must include `car.tier` in its response. Captured in TASK-E.
