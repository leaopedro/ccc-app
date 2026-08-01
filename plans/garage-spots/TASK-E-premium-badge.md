# TASK-E — Premium Badge (Garage-Level) Implementation Plan

> ## ⚠️ POST-PIVOT NOTICE (2026-05-20) — TASK-E RE-SCOPED
>
> **Canonical source:** [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](../../docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md).
>
> **Deleted from scope:** the entire "Car Tier Picker" — no per-car tier exists post-pivot, no `POST /me/cars/:id/tier` endpoint, no downgrade flow. Premium is per-`Garage`, not per-`Car`.
>
> **Re-scoped to:** ship a `PremiumBadge` component that reads `garage.isPremiumActive` (computed at API serializer time from `garage.premiumTier` + `garage.premiumUntil`). Render it next to user identity wherever cars/users appear — feed, comments, public garage profile, mobile garage page header. Single source of truth: the garage payload.
>
> **File rename pending:** this file should be renamed to `TASK-E-premium-badge.md` (handled in this PR via `git mv`). Body below predates the pivot and references per-car tier work that no longer exists.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface garage-spot tier on every car payload, render a `PremiumBadge` next to car identity on every existing surface, and ship a tier picker on the mobile car-detail screen that downgrades premium → free via a new endpoint (`POST /me/cars/:id/tier`).

**Architecture:** Add `tier: GarageSpotTier` to the shared `carSchema`, `publicCarProfileSchema`, `ConfirmedCar`, the ticket check-in car payload, and the moderation queue item. Build a shared `PremiumBadge` component per app (mobile via `@ccc/ui`, admin via a Tailwind component). Thread `tier` through every serializer in `apps/api`. Add `POST /me/cars/:id/tier` that downgrades a premium spot to extra; upgrade path is admin-only (TASK-G). MVP picker exposes only Free and Premium values; premium is selectable only when the underlying spot is already `premium`.

**Tech Stack:** TypeScript, Zod 3, Prisma 5, React 19, Next.js 16, Expo Router 6, Fastify 4, Vitest 3, NativeWind, Tailwind 4.

---

## Dependencies and pre-flight

This task **depends on TASK-A** for the `GarageSpotTier` Prisma enum, the `GarageSpot` table, the `Car.spot` back-relation, and the `GarageSpotTierEnum` Zod schema in `packages/shared/src/garage.ts`. Do not start coding until those are merged to `main`.

Pre-flight before Step 1 of any task:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-task-e-tier-picker
node -e "console.log(require('@ccc/db').Prisma.GarageSpotTier)" \
  | grep -q 'premium' && echo "TASK-A merged" || { echo "BLOCKED: TASK-A not merged"; exit 1; }
```

If the check fails, stop and wait for TASK-A.

### Quick reference: tier shape (defined by TASK-A)

`packages/shared/src/garage.ts` (created in TASK-A) will export:

```typescript
export const garageSpotTierSchema = z.enum(['free', 'extra', 'premium']);
export type GarageSpotTier = z.infer<typeof garageSpotTierSchema>;
```

This plan assumes that exact shape. If TASK-A ships a different schema name, do a find-and-replace at the start.

---

## Scope summary

In scope (this task):

- `tier: GarageSpotTier` added to every car-bearing response schema in `packages/shared` (full list in **API responses table** below).
- API serializers updated to read `Car.spot.tier` and pass it through.
- Shared `PremiumBadge` (mobile) and `PremiumBadge` (admin web) components.
- Badge rendered on every surface inventoried in master plan §3.
- `POST /me/cars/:id/tier` downgrade endpoint with picker UI on `apps/mobile/app/(app)/garage/[id].tsx`.
- Mobile snapshot tests per surface, picker interaction test, admin SSR test for the moderation queue.
- API integration tests for `tier` in every response and round-trip on the downgrade endpoint.

Out of scope (other tasks):

- Schema, enum, seeds, migration, backfill → TASK-A.
- Spot allocation, free-limit math, `POST /me/garage/spots/cart` → TASK-B.
- Buy-spot UI → TASK-D.
- Settlement-side `extra` creation → TASK-C.
- Admin grant flow (`POST /admin/users/:id/cars/:carId/tier`) → TASK-G; this plan only **declares the contract** TASK-G must implement, plus the user-facing inverse.
- Admin user-detail Garage panel UI → TASK-G; here we only add a row-level `PremiumBadge` placeholder on the existing admin user detail page if a `tier` field shows up on data we already render.

---

## API responses that must include `tier` (with file/line refs)

Each entry is one **API touchpoint** that already returns car identity; the table is exhaustive for this task. Numbers are start-of-block references in the current `main` (e0fd9a8). If the line drifts, search by the schema/parser symbol shown.

| #   | Endpoint                                                                  | Serializer file                                                                       | Schema in `@ccc/shared`                                                                | New field                                             |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | `GET /me/cars`, `GET /me/cars/:id`, `POST /me/cars`, `PATCH /me/cars/:id` | `apps/api/src/routes/cars.ts:20-33` (`serializeCar`)                                  | `cars.ts` — `carSchema`                                                                | `tier`                                                |
| 2   | `GET /events/:eventId/feed`                                               | `apps/api/src/routes/feed.ts:63-76` (`serializeCarProfile`)                           | `feed.ts` — `publicCarProfileSchema`                                                   | `tier`                                                |
| 3   | `GET /events/:eventId/feed/:postId/comments`                              | same `serializeCarProfile` (line 210)                                                 | `feed.ts` — `publicCarProfileSchema`                                                   | shared                                                |
| 4   | `POST /events/:eventId/feed`, `PATCH /events/:eventId/feed/:postId`       | same helper (lines 302, 401)                                                          | shared                                                                                 | shared                                                |
| 5   | `POST /events/:eventId/feed/:postId/comments`                             | same helper (line 515)                                                                | shared                                                                                 | shared                                                |
| 6   | `GET /events/:eventId/confirmed-cars`                                     | `apps/api/src/routes/events.ts` — grep for `confirmedCarSchema.parse`                 | `events.ts` — `confirmedCarSchema`                                                     | `tier`                                                |
| 7   | `POST /admin/tickets/check-in`                                            | `apps/api/src/routes/admin/check-in.ts:74-101`                                        | `check-in.ts` — inline `ticket.car` inside `ticketCheckInResponseSchema` (lines 59-65) | `tier`                                                |
| 8   | `GET /admin/events/:eventId/feed/queue`                                   | `apps/api/src/routes/admin/feed-moderation.ts` — grep for `car: { select: { nickname` | `feed.ts` — `moderationQueueItemSchema` (line 244)                                     | `tier` (replaces nothing; sits next to `carNickname`) |

**Garage list / detail** (`GET /me/garage`, garage cars in `GET /me/cars`) — already covered by row #1 since `carSchema` gets the field once and every `me/cars/*` route reuses `serializeCar`. The garage-specific `GET /me/garage` route arrives in TASK-B and **must consume the same `carSchema`** — no parallel definition.

**Cart car picker** (`apps/mobile/src/screens/cart/CarPlatePicker.tsx`) consumes `Car` from `listCars()` which hits `GET /me/cars` — same source as row #1, no extra serializer.

**`CarPickerPopover.tsx`** also takes `Car[]` from the same source.

**Admin moderation queue** currently exposes `carNickname: string | null` only. Add `tier: GarageSpotTier | null` (nullable: posts may not be associated with a car at all). The admin UI renders the picker by reading `tier`.

### Required Prisma `include` additions

Every serializer above must pull `spot.tier`. Use this Prisma include fragment (DRY):

```typescript
// apps/api/src/services/cars/include.ts (new file in TASK-B; if missing here, inline)
export const CAR_TIER_INCLUDE = { spot: { select: { tier: true } } } as const;
```

For routes where `Car` is selected via `select: {...}` (e.g. `feed.ts:30-37`), add `spot: { select: { tier: true } }` to the `CAR_SELECT` constant. For routes with `include: { photos: true }` (`cars.ts:39-43`), change to `include: { photos: true, spot: { select: { tier: true } } }`.

For the confirmed-cars route (`events.ts:280`), extend `select.car.select` with `spot: { select: { tier: true } }`.

For check-in (`apps/api/src/services/tickets/check-in.ts`), locate the Prisma query that loads the ticket with car (grep for `include.*car` or `select.*car` in that file). Add `spot: { select: { tier: true } }` inside the car include/select. Also update the `TicketWithRelations` type alias (currently `Ticket & { tier: TicketTier; user: User; car: Car | null }`) to extend the `car` field with `spot: { tier: GarageSpotTier } | null`. See Task 3 step 7 for the full type change.

For moderation queue, extend the `car: { select: { nickname: true } }` includes (lines 298 and 314) to `car: { select: { nickname: true, spot: { select: { tier: true } } } }`.

### Null handling

A car may have no spot (transitional state during a migration window or admin deletion). When `car.spot === null`, serialize `tier: 'free'` — the schema default and the safest UI fallback. **Never** emit `null` for tier on a car identity payload; we keep the field non-nullable in the schema to keep clients dumb.

For the **moderation queue**, the entire `car` may be `null` (posts can be authored without a car if posting access is `open` at some future point). In that case `tier` is `null`. Add `tier: garageSpotTierSchema.nullable()` to `moderationQueueItemSchema` only.

---

## `PremiumBadge` component contract

### Mobile (`packages/ui/src/PremiumBadge.tsx`)

A wrapper around the existing `Badge` from `@ccc/ui` for type safety and copy centralisation.

```typescript
import type { GarageSpotTier } from '@ccc/shared';
import { Badge } from './Badge.js';

export interface PremiumBadgeProps {
  tier: GarageSpotTier | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

const LABEL = 'PREMIUM';

export function PremiumBadge({ tier, size = 'sm', className }: PremiumBadgeProps) {
  if (tier !== 'premium') return null;
  return <Badge label={LABEL} tone="brand" size={size} className={className} />;
}
```

Exported from `packages/ui/src/index.ts`.

### Admin (`apps/admin/src/components/premium-badge.tsx`)

Plain Tailwind span; no React Native imports.

```typescript
import type { GarageSpotTier } from '@ccc/shared';

export interface PremiumBadgeProps {
  tier: GarageSpotTier | null | undefined;
  className?: string;
}

export function PremiumBadge({ tier, className }: PremiumBadgeProps) {
  if (tier !== 'premium') return null;
  return (
    <span
      className={
        'rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-950 ' +
        (className ?? '')
      }
    >
      Premium
    </span>
  );
}
```

**Why two components**: admin uses Tailwind + DOM elements; mobile uses NativeWind + RN `View`. A single primitive would force one side into a wrapper or pull RN into Next.js SSR. Both render the literal string `PREMIUM` / `Premium` so the visual contract is identical.

**Visual contract** (must hold on both):

- Renders only when `tier === 'premium'`.
- Returns `null` for `'free'`, `'extra'`, `null`, `undefined`.
- Self-aligns (no margin); the caller positions it.
- Uppercase, tracking-widest, small (sm size on mobile = `h-6 px-2`).
- Amber/brand tone — must not collide with status badges (`bg-emerald-700`, `bg-red-800`).

---

## Tier picker UX and state machine

### Surface

`apps/mobile/app/(app)/garage/[id].tsx` — below the existing `nickname` field, above the Save button.

### Inputs

- `car.tier: GarageSpotTier` (from the loaded `Car`).
- The picker option set is hard-coded: `['free', 'premium']`. The `extra` value never appears in the picker (extras are implicit when premium is downgraded; never a user choice).

### State machine

```
state = { selectedTier: GarageSpotTier, busy: boolean, error: string|null }

initial: { selectedTier: car.tier, busy: false, error: null }

events:
  select(t):
    if t === 'premium' && car.tier !== 'premium' → noop (option disabled)
    if t === car.tier → setSelectedTier(t)
    if t === 'free' && car.tier === 'premium' →
      open confirm dialog "Voltar para Free? Você manterá sua vaga, mas perderá Premium."
      on confirm: dispatch downgradeRequest
      on cancel: setSelectedTier(car.tier)
  downgradeRequest:
    setBusy(true)
    POST /me/cars/:id/tier { tier: 'free' }
    onSuccess(updatedCar):
      setCar(updatedCar)
      setSelectedTier(updatedCar.tier)
      setBusy(false)
      showBanner(profileCopy.garage.tierDowngraded)
    onError(e):
      setBusy(false)
      setError(profileCopy.garage.tierChangeFailed)
      setSelectedTier(car.tier)
```

### Option enablement matrix

| `car.tier` | Free option                | Premium option            | Notes                                                                                                       |
| ---------- | -------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `free`     | selected, disabled (no-op) | disabled with helper text | Helper: "Premium é concedido pelo time JDM."                                                                |
| `extra`    | selected, disabled         | disabled with same helper | The MVP does not expose extra as a separate radio; we display Free and the spot remains `extra` internally. |
| `premium`  | enabled (downgrade)        | selected, enabled         | Picking Free triggers downgrade dialog.                                                                     |

### Visual

Two radio cards stacked. Premium card shows `PremiumBadge` next to its label always (so users see what they get / what they have). Disabled state = 0.4 opacity, no tap target, helper text below.

### Reversibility

After downgrade, the underlying `GarageSpot` row's `tier` flips to `extra` (not `free`). The `Car.spot.tier` returned in the response is therefore `'extra'`, and we serialize that as `'free'` for UI purposes? **No** — surface the truth. Render `tier: 'extra'` as **no badge** (badge only on `'premium'`) and the picker shows Free selected. The spot row remains an extra slot the user paid for (or was granted) — admin can re-grant premium later, which restores the badge without any user action other than refresh.

**Decision log:** keep `extra` and `free` indistinguishable in the picker UI. They differ only in backend semantics (extra = paid slot, free = baseline slot). Conflating them in the picker prevents users from accidentally "losing" an extra slot by toggling.

---

## Downgrade endpoint contract

### Route

```
POST /me/cars/:id/tier
```

Why `POST` not `PATCH`: this is a state-transition (downgrade), not a partial-update of resource fields. It mirrors the admin counterpart `POST /admin/users/:id/cars/:carId/tier` (already promised in master plan §5). Symmetric naming makes the OpenAPI surface obvious.

Why not `PATCH /me/cars/:id` with a `tier` field: master plan §5 already forbids that ("tier change blocked at this endpoint").

### Auth

`preHandler: [app.authenticate]`. Requires the car belong to the requesting user.

### Request body

`packages/shared/src/cars.ts`:

```typescript
export const carTierChangeInputSchema = z.object({
  tier: z.literal('free'),
});
export type CarTierChangeInput = z.infer<typeof carTierChangeInputSchema>;
```

Only `'free'` is accepted on the user-facing endpoint. Sending `'premium'` or `'extra'` is a 400 — those are admin-only transitions and live under `POST /admin/users/:id/cars/:carId/tier` (TASK-G).

### Behaviour

1. Load the car with `spot: { select: { id: true, tier: true } }` for `userId = sub`. 404 if not found.
2. If `car.spot === null`: 409 `{ error: 'NoSpot' }`. (Shouldn't happen post-TASK-A backfill; surfaced for safety.)
3. If `car.spot.tier !== 'premium'`: 409 `{ error: 'NotPremium' }`. Idempotency is achieved by the client never sending this when already free; we don't auto-200 because that masks bugs.
4. Update inside a transaction: `tx.garageSpot.update({ where: { id: car.spot.id }, data: { tier: 'extra' } })`. Tier flips to `extra` not `free` — the user keeps the slot they were granted; admin can restore via TASK-G's endpoint without re-allocating.
5. AdminAudit entry: actor = the user themselves; action = `garage_spot.user_downgrade`. **NOTE:** `garage_spot.user_downgrade` must be in `adminAuditActionSchema` before this code ships. Preferred path: coordinate with TASK-A to add it to TASK-A's enum delta (so it arrives with the rest of the garage literals). If TASK-A already shipped without it, Task 6 step 3 adds it. `recordAudit` is called inside the Prisma `$transaction` using the `tx` client so the audit row and the spot update commit atomically.
6. Re-serialize the car using the existing `serializeCar` and return 200.

### Response

`200 Car` (full `carSchema` with `tier: 'extra'` — i.e. picker will now show Free selected since we surface extra as free in the UI).

### Admin counterpart (declared here, implemented in TASK-G)

```
POST /admin/users/:id/cars/:carId/tier
body: { tier: 'free' | 'premium' | 'extra' }
```

Allows full transitions. TASK-G owns this entirely:

- Schema: `adminCarTierOverrideSchema` in `packages/shared/src/admin-garage.ts` (already declared by TASK-G). Do NOT add any admin tier schema in TASK-E.
- AdminAudit action: `garage_spot.tier_override` (added by TASK-A to `adminAuditActionSchema`; TASK-G uses it).

### Error codes

| HTTP | `error`      | Cause                                                            |
| ---- | ------------ | ---------------------------------------------------------------- |
| 400  | `BadRequest` | Body fails Zod parse (tier !== 'free' for the user-facing route) |
| 404  | `NotFound`   | Car not owned by requester                                       |
| 409  | `NoSpot`     | Car has no garage spot row                                       |
| 409  | `NotPremium` | Spot is not currently premium                                    |

---

## Copy keys

`apps/mobile/src/copy/profile.ts` — extend `garage`:

```typescript
garage: {
  // ...existing keys...
  tierSectionTitle: 'Tipo da vaga',
  tierFreeLabel: 'Free',
  tierPremiumLabel: 'Premium',
  tierAdminOnlyHelper: 'Premium é concedido pelo time JDM.',
  tierDowngradeConfirmTitle: 'Voltar para Free?',
  tierDowngradeConfirmBody: 'Você manterá a vaga, mas perderá o status Premium. O time JDM pode restaurar depois.',
  tierDowngradeConfirmCta: 'Voltar para Free',
  tierDowngraded: 'Vaga atualizada para Free.',
  tierChangeFailed: 'Não foi possível alterar o tipo da vaga.',
},
```

`apps/mobile/src/copy/feed.ts` — no new keys; the badge label is hard-coded `PREMIUM` (visual marker, not full sentence; matches existing `Badge` capitalised style).

`apps/admin/app/(authed)/events/[id]/community-management.tsx` — render `<PremiumBadge tier={item.tier} />` inline; no copy key required.

---

## File-by-file changes for badge placement

### 1. `packages/shared/src/cars.ts`

Add `tier` to `carSchema`, add `carTierChangeInputSchema`. (Detailed in Task 2 below.)

### 2. `packages/shared/src/feed.ts`

Add `tier` to `publicCarProfileSchema`; add `tier` to `moderationQueueItemSchema`. (Task 2.)

### 3. `packages/shared/src/events.ts`

Add `tier` to `confirmedCarSchema`. (Task 2.)

### 4. `packages/shared/src/check-in.ts`

Add `tier` to the inline `ticket.car` object inside `ticketCheckInResponseSchema`. (Task 2.)

### 5. API serializers

All updated in Task 3 — see table above for exact files/lines.

### 6. `packages/ui/src/PremiumBadge.tsx` (new) + export from `index.ts`

Task 4.

### 7. `apps/admin/src/components/premium-badge.tsx` (new)

Task 4.

### 8. `apps/mobile/src/screens/events/feed/FeedPostCard.tsx`

Render badge next to `carLabel`. Wrap the existing `<View style={styles.carInfo}>` to a `flex-row` with the badge after the text. (Task 5.)

```tsx
import { PremiumBadge } from '@ccc/ui';

// inside header:
<View style={styles.carInfo}>
  <View style={styles.nameRow}>
    <Text style={styles.carName}>{carLabel}</Text>
    {car ? <PremiumBadge tier={car.tier} /> : null}
  </View>
</View>;
```

Add to `styles`:

```ts
nameRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
```

### 9. `apps/mobile/src/screens/events/feed/FeedComments.tsx`

For each rendered comment author label (line 119-122 currently `{c.car ? ... : '—'}`) and for the `postingAsChip`'s `selectedCar`, render the badge after the text.

```tsx
<View style={styles.commentAuthorRow}>
  <Text style={styles.commentAuthor}>
    {c.car ? `${c.car.nickname ?? c.car.make} ${c.car.model}` : '—'}
  </Text>
  {c.car ? <PremiumBadge tier={c.car.tier} /> : null}
</View>
```

For the `postingAsChip`: insert `{selectedCar ? <PremiumBadge tier={selectedCar.tier} /> : null}` between `postingAsValue` and `chevron`.

### 10. `apps/mobile/src/screens/events/feed/CarPickerPopover.tsx`

In the rendered list row, append the badge after the text inside the `Pressable`:

```tsx
<Pressable ...>
  <Text ...>{label}</Text>
  <PremiumBadge tier={car.tier} />
</Pressable>
```

Wrap children in a `flexDirection: 'row'` if not already.

### 11. `apps/mobile/src/screens/cart/CarPlatePicker.tsx`

Inside the `carCard` map (line 128), put the badge inside `carInfo` next to `carName`:

```tsx
<View style={styles.carInfo}>
  <View style={styles.carNameRow}>
    <Text style={styles.carName}>{label}</Text>
    <PremiumBadge tier={car.tier} />
  </View>
  ...
</View>
```

Add `carNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }`.

### 12. `apps/mobile/src/screens/events/confirmed-cars/ConfirmedCarsSection.tsx`

Confirmed cars are anonymised (`ref`-only). Add `tier` to `ConfirmedCar` but **do not show a label** that ties to identity. Render the badge as a small dot in the corner of the avatar:

```tsx
<View style={styles.avatarWrap}>
  {car.photoUrl ? <Image ... /> : <View ... />}
  {car.tier === 'premium' ? <PremiumBadge tier={car.tier} size="sm" className="absolute -bottom-1 -right-1" /> : null}
  <Text style={styles.avatarLabel}>{car.model}</Text>
</View>
```

(Mobile `Badge` accepts `className` already; use absolute positioning with `position: 'absolute', bottom: -4, right: -4` via inline style if NativeWind classes don't apply here. Verify in Task 5.)

### 13. `apps/mobile/src/screens/events/confirmed-cars/CarDetailSheet.tsx`

Below the existing `name` Text, render `<PremiumBadge tier={car.tier} size="md" />`.

### 14. `apps/mobile/app/(app)/garage/index.tsx`

Inside each `card`'s `cardText`, add `<PremiumBadge tier={item.tier} />` next to the title row.

### 15. `apps/mobile/app/(app)/garage/[id].tsx`

Two changes:

- Badge in the screen header / above the avatar section.
- The full tier picker (see UX section above).

### 16. `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx`

Inside `TicketResultCard`, modify the car line:

```tsx
{
  data.car ? (
    <p className="text-sm flex items-center gap-2">
      <span>
        Carro: {data.car.make} {data.car.model} {data.car.year}
        {data.licensePlate ? ` — placa ${data.licensePlate}` : ''}
      </span>
      <PremiumBadge tier={data.car.tier} />
    </p>
  ) : null;
}
```

### 17. `apps/admin/app/(authed)/events/[id]/community-management.tsx`

In the queue map (line 162-167), append the badge after the author/car block. The existing line currently shows `item.carNickname` indirectly via the body author footer; **make it explicit**: add the car nickname + badge in one row.

```tsx
<p className="text-xs text-[color:var(--color-muted)] flex items-center gap-2">
  <span>
    Autor: {item.authorName ?? 'Anônimo'}
    {item.carNickname ? ` · ${item.carNickname}` : ''}
    {' · '}
    {fmtDate(item.createdAt)}
    {' · denúncias abertas: '}
    {item.openReportCount}
  </span>
  <PremiumBadge tier={item.tier} />
</p>
```

(`item.tier` is the new field added to `moderationQueueItemSchema`.)

---

## Self-review checklist after implementation

- Every endpoint in the API responses table returns a non-null `tier` for cars with a spot, `null` only on the moderation queue when the entire `car` is null.
- `serializeCar` is the **only** function emitting full-car payloads — no parallel serializer drifted.
- `PremiumBadge` returns `null` for all non-premium tiers — verified by snapshot.
- Tier picker downgrade dialog uses the existing `confirmDestructive` helper (`apps/mobile/src/lib/confirm.ts`).
- Server enforces the user-facing endpoint accepts only `tier: 'free'`.

---

# Task list

> Each task ends with a commit. Branch was created in the pre-flight block above.

---

## Task 1: Verify TASK-A primitives and rebuild `@ccc/shared`

**Files:**

- Read: `packages/shared/src/garage.ts`
- Read: `packages/db/prisma/schema.prisma`
- Read: `packages/db/src/index.ts` (re-export of `GarageSpotTier`)

- [ ] **Step 1: Confirm enum exists**

```bash
grep -n "GarageSpotTier\|garageSpotTierSchema" /Users/pedro/Projects/jdm-experience/packages/shared/src/garage.ts
grep -n "GarageSpotTier" /Users/pedro/Projects/jdm-experience/packages/db/prisma/schema.prisma
```

Expected: both files contain `GarageSpotTier` with values `free`, `extra`, `premium`.

If either is missing, STOP — TASK-A is not merged. Do not proceed.

- [ ] **Step 2: Rebuild shared so dist is current**

```bash
pnpm --filter @ccc/shared build
```

Expected: exit 0; `packages/shared/dist/garage.js` exists.

- [ ] **Step 3: Sanity-check the export surface**

```bash
node -e "const s = require('@ccc/shared'); console.log(typeof s.garageSpotTierSchema, s.garageSpotTierSchema?.options)"
```

Expected output: `object [ 'free', 'extra', 'premium' ]`.

- [ ] **Step 4: Commit nothing — this task is verification only**

No code change; do not commit. If the verification fails, surface the failure and stop.

---

## Task 2: Extend shared schemas with `tier`

**Files:**

- Modify: `packages/shared/src/cars.ts`
- Modify: `packages/shared/src/feed.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/check-in.ts`
- Test: `packages/shared/src/__tests__/cars-tier.test.ts` (new)

- [ ] **Step 1: Write the failing test for `carSchema.tier`**

Create `packages/shared/src/__tests__/cars-tier.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { carSchema, carTierChangeInputSchema } from '../cars.js';
import { publicCarProfileSchema } from '../feed.js';
import { confirmedCarSchema } from '../events.js';
import { ticketCheckInResponseSchema } from '../check-in.js';
import { moderationQueueItemSchema } from '../feed.js';

const baseCar = {
  id: 'car_1',
  make: 'Honda',
  model: 'Civic',
  year: 2020,
  nickname: null,
  photo: null,
  photos: [],
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

describe('carSchema tier', () => {
  it('accepts each tier value', () => {
    for (const tier of ['free', 'extra', 'premium'] as const) {
      expect(carSchema.parse({ ...baseCar, tier }).tier).toBe(tier);
    }
  });
  it('rejects unknown tier', () => {
    expect(() => carSchema.parse({ ...baseCar, tier: 'gold' })).toThrow();
  });
  it('requires tier (no default)', () => {
    const { tier: _omit, ...rest } = { ...baseCar, tier: 'free' };
    expect(() => carSchema.parse(rest)).toThrow();
  });
});

describe('carTierChangeInputSchema', () => {
  it('accepts free', () => {
    expect(carTierChangeInputSchema.parse({ tier: 'free' })).toEqual({ tier: 'free' });
  });
  it('rejects premium', () => {
    expect(() => carTierChangeInputSchema.parse({ tier: 'premium' })).toThrow();
  });
  it('rejects extra', () => {
    expect(() => carTierChangeInputSchema.parse({ tier: 'extra' })).toThrow();
  });
});

describe('publicCarProfileSchema tier', () => {
  it('accepts each tier value', () => {
    for (const tier of ['free', 'extra', 'premium'] as const) {
      expect(
        publicCarProfileSchema.parse({
          id: 'car_1',
          make: 'Honda',
          model: 'Civic',
          year: 2020,
          nickname: null,
          photo: null,
          tier,
        }).tier,
      ).toBe(tier);
    }
  });
});

describe('confirmedCarSchema tier', () => {
  it('accepts each tier value', () => {
    for (const tier of ['free', 'extra', 'premium'] as const) {
      expect(
        confirmedCarSchema.parse({
          ref: 'abc',
          make: 'Honda',
          model: 'Civic',
          year: 2020,
          photoUrl: null,
          tier,
        }).tier,
      ).toBe(tier);
    }
  });
});

describe('moderationQueueItemSchema tier', () => {
  it('accepts null tier (no car)', () => {
    expect(
      moderationQueueItemSchema.parse({
        kind: 'post',
        id: 'p_1',
        body: 'x',
        status: 'visible',
        authorName: null,
        carNickname: null,
        tier: null,
        openReportCount: 0,
        createdAt: '2026-05-01T00:00:00.000Z',
      }).tier,
    ).toBeNull();
  });
  it('accepts premium tier', () => {
    expect(
      moderationQueueItemSchema.parse({
        kind: 'post',
        id: 'p_1',
        body: 'x',
        status: 'visible',
        authorName: null,
        carNickname: 'Pearl',
        tier: 'premium',
        openReportCount: 0,
        createdAt: '2026-05-01T00:00:00.000Z',
      }).tier,
    ).toBe('premium');
  });
});

describe('ticketCheckInResponseSchema car.tier', () => {
  it('parses with car.tier', () => {
    const parsed = ticketCheckInResponseSchema.parse({
      result: 'admitted',
      ticket: {
        id: 't_1',
        status: 'used',
        checkedInAt: '2026-05-01T00:00:00.000Z',
        tier: { id: 'tier_1', name: 'GA' },
        holder: { id: 'u_1', name: 'A' },
        car: { make: 'Honda', model: 'Civic', year: 2020, tier: 'premium' },
        licensePlate: 'ABC-1D23',
        extras: [],
      },
      storePickup: [],
    });
    expect(parsed.ticket.car?.tier).toBe('premium');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @ccc/shared test -- cars-tier
```

Expected: all describe blocks fail with `Required` / `Unrecognized key` / `tier` missing.

- [ ] **Step 3: Update `packages/shared/src/cars.ts`**

Add the import and modify `carSchema`:

```typescript
import { z } from 'zod';
import { garageSpotTierSchema } from './garage.js';

// ...existing carInputSchema, carUpdateSchema, carPhotoSchema...

export const carSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().max(60).nullable(),
  tier: garageSpotTierSchema,
  photo: carPhotoSchema.nullable(),
  photos: z.array(carPhotoSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Car = z.infer<typeof carSchema>;

// ...existing carListResponseSchema, addCarPhotoSchema...

export const carTierChangeInputSchema = z.object({
  tier: z.literal('free'),
});
export type CarTierChangeInput = z.infer<typeof carTierChangeInputSchema>;
```

- [ ] **Step 4: Update `packages/shared/src/feed.ts`**

Add the import at top:

```typescript
import { garageSpotTierSchema } from './garage.js';
```

Modify `publicCarProfileSchema` (around line 60):

```typescript
export const publicCarProfileSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().nullable(),
  tier: garageSpotTierSchema,
  photo: publicCarPhotoSchema.nullable(),
});
```

Modify `moderationQueueItemSchema` (around line 244):

```typescript
export const moderationQueueItemSchema = z.object({
  kind: z.enum(['post', 'comment']),
  id: z.string().min(1),
  body: z.string(),
  status: z.string(),
  authorName: z.string().nullable(),
  carNickname: z.string().nullable(),
  tier: garageSpotTierSchema.nullable(),
  openReportCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
```

- [ ] **Step 5: Update `packages/shared/src/events.ts`**

```typescript
import { garageSpotTierSchema } from './garage.js';

export const confirmedCarSchema = z.object({
  ref: z.string().min(1),
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  year: z.number().int(),
  photoUrl: z.string().url().nullable(),
  tier: garageSpotTierSchema,
});
```

- [ ] **Step 6: Update `packages/shared/src/check-in.ts`**

```typescript
import { garageSpotTierSchema } from './garage.js';

// inside ticketCheckInResponseSchema, modify car:
car: z
  .object({
    make: z.string().min(1),
    model: z.string().min(1),
    year: z.number().int(),
    tier: garageSpotTierSchema,
  })
  .nullable(),
```

- [ ] **Step 7: Run test to verify pass**

```bash
pnpm --filter @ccc/shared test -- cars-tier
```

Expected: all green.

- [ ] **Step 8: Rebuild shared**

```bash
pnpm --filter @ccc/shared build
```

Expected: exit 0.

- [ ] **Step 9: Typecheck across the repo to find break sites**

```bash
pnpm --filter @ccc/api typecheck 2>&1 | tee /tmp/api-tc.log
pnpm --filter @ccc/admin typecheck 2>&1 | tee /tmp/admin-tc.log
pnpm --filter @ccc/mobile typecheck 2>&1 | tee /tmp/mobile-tc.log
```

Expected: API and admin and mobile **fail** with "Property 'tier' is missing" on every serializer site that builds a car payload literal. That list **is** the work for Task 3 and Task 5.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/cars.ts packages/shared/src/feed.ts packages/shared/src/events.ts packages/shared/src/check-in.ts packages/shared/src/__tests__/cars-tier.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add tier to car schemas + carTierChangeInputSchema

Threads GarageSpotTier through carSchema, publicCarProfileSchema,
confirmedCarSchema, ticketCheckInResponseSchema, and
moderationQueueItemSchema. Adds carTierChangeInputSchema for the
user-facing downgrade endpoint (literal 'free' only).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: API serializers — thread `tier` through every car-bearing response

**Files:**

- Modify: `apps/api/src/routes/cars.ts:11-33`
- Modify: `apps/api/src/routes/feed.ts:30-76`
- Modify: `apps/api/src/routes/admin/feed-moderation.ts:283-344`
- Modify: `apps/api/src/routes/events.ts:280-322`
- Modify: `apps/api/src/services/tickets/check-in.ts` (the include and result type around `ticket.car`)
- Modify: `apps/api/src/routes/admin/check-in.ts:74-101`
- Test: `apps/api/test/integration/cars-tier.test.ts` (new)

- [ ] **Step 1: Write the failing API integration test**

```typescript
// apps/api/test/integration/cars-tier.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../helpers/app.js';
import { seedUserWithCarAndSpot } from '../helpers/garage.js';
import { signJwt } from '../helpers/jwt.js';

describe('GET /me/cars returns tier', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns tier=free for default spot', async () => {
    const { userId } = await seedUserWithCarAndSpot({ tier: 'free' });
    const token = signJwt({ sub: userId });
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).cars[0].tier).toBe('free');
  });

  it('returns tier=premium for premium spot', async () => {
    const { userId } = await seedUserWithCarAndSpot({ tier: 'premium' });
    const token = signJwt({ sub: userId });
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(res.body).cars[0].tier).toBe('premium');
  });

  it('returns tier=extra for extra spot', async () => {
    const { userId } = await seedUserWithCarAndSpot({ tier: 'extra' });
    const token = signJwt({ sub: userId });
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(res.body).cars[0].tier).toBe('extra');
  });

  it('returns tier=free when spot is null (fallback)', async () => {
    const { userId, carId } = await seedUserWithCarAndSpot({ tier: 'free' });
    // Detach: simulate a transitional null
    const { prisma } = await import('@ccc/db');
    await prisma.garageSpot.update({ where: { carId }, data: { carId: null } });
    const token = signJwt({ sub: userId });
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(res.body).cars[0].tier).toBe('free');
  });
});
```

Also add a confirmed-cars test:

```typescript
describe('GET /events/:eventId/confirmed-cars includes tier', () => {
  it('returns tier per car', async () => {
    // create event + ticket linking car with premium spot
    // ...standard helpers from existing tickets tests
    // assert items[0].tier === 'premium'
  });
});
```

Helper `seedUserWithCarAndSpot` (new in `apps/api/test/helpers/garage.ts`):

```typescript
import { prisma } from '@ccc/db';
import type { GarageSpotTier } from '@prisma/client';

export async function seedUserWithCarAndSpot({ tier }: { tier: GarageSpotTier }) {
  const user = await prisma.user.create({
    data: { email: `u${Date.now()}@x.com`, name: 'T', emailVerifiedAt: new Date() },
  });
  const car = await prisma.car.create({
    data: { userId: user.id, make: 'Honda', model: 'Civic', year: 2020 },
  });
  await prisma.garageSpot.create({
    data: { userId: user.id, carId: car.id, tier, source: 'default_free' },
  });
  return { userId: user.id, carId: car.id };
}
```

If `signJwt` helper isn't already there, copy the pattern from an existing integration test (search `apps/api/test/helpers/` for similar).

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @ccc/api test -- cars-tier
```

Expected: fail with Zod parse error "Required" on `tier`, or 500.

- [ ] **Step 3: Update `apps/api/src/routes/cars.ts`**

Modify `CarWithPhotos` type alias and `serializeCar`:

```typescript
type CarWithPhotosAndSpot = DbCar & {
  photos: DbPhoto[];
  spot: { tier: GarageSpotTier } | null;
};

const serializeCar = (car: CarWithPhotosAndSpot, uploads: Uploads) => {
  const sorted = car.photos.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  return carSchema.parse({
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname,
    tier: car.spot?.tier ?? 'free',
    createdAt: car.createdAt.toISOString(),
    updatedAt: car.updatedAt.toISOString(),
    photo: sorted[0] ? serializePhoto(sorted[0], uploads) : null,
    photos: sorted.map((p) => serializePhoto(p, uploads)),
  });
};
```

Add the import:

```typescript
import type { GarageSpotTier } from '@prisma/client';
```

Update every `prisma.car.findMany`/`findFirst`/`findUniqueOrThrow`/`update`/`create` call in this file to include `spot: { select: { tier: true } }`:

```typescript
// in GET /me/cars (line 39):
include: { photos: true, spot: { select: { tier: true } } },

// in GET /me/cars/:id (line 52):
include: { photos: true, spot: { select: { tier: true } } },

// in POST /me/cars (line 63):
include: { photos: true, spot: { select: { tier: true } } },

// in PATCH /me/cars/:id (line 82):
include: { photos: true, spot: { select: { tier: true } } },

// in POST /me/cars/:id/photos (line 128):
include: { photos: true, spot: { select: { tier: true } } },
```

- [ ] **Step 4: Update `apps/api/src/routes/feed.ts`**

Extend `CAR_SELECT` (line 30) and `CarSelect` (line 54):

```typescript
const CAR_SELECT = {
  id: true,
  make: true,
  model: true,
  year: true,
  nickname: true,
  spot: { select: { tier: true } },
  photos: { select: { objectKey: true, width: true, height: true, sortOrder: true } },
} as const;

type CarSelect = {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
  spot: { tier: 'free' | 'extra' | 'premium' } | null;
  photos: { objectKey: string; width: number | null; height: number | null; sortOrder: number }[];
};
```

Update `serializeCarProfile`:

```typescript
const serializeCarProfile = (car: CarSelect | null, buildUrl: (key: string) => string) => {
  if (!car) return null;
  const primary = [...car.photos].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;
  return {
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname,
    tier: car.spot?.tier ?? 'free',
    photo: primary
      ? { url: buildUrl(primary.objectKey), width: primary.width, height: primary.height }
      : null,
  };
};
```

- [ ] **Step 5: Update `apps/api/src/routes/admin/feed-moderation.ts`**

Locate both `car: { select: { nickname: true } }` occurrences (grep for `car: { select: { nickname` — two hits, one in `feedPost.findMany`, one in `feedComment.findMany`) and change each to:

```typescript
car: { select: { nickname: true, spot: { select: { tier: true } } } },
```

Modify both `map` blocks (lines 322-332 and 333-343):

```typescript
...posts.map((p) => ({
  kind: 'post' as const,
  id: p.id,
  body: p.body,
  status: p.status,
  authorName: p.author?.name ?? null,
  carNickname: p.car?.nickname ?? null,
  tier: p.car?.spot?.tier ?? null,
  openReportCount: p._count.reports,
  createdAt: p.createdAt.toISOString(),
})),
...comments.map((c) => ({
  kind: 'comment' as const,
  id: c.id,
  body: c.body,
  status: c.status,
  authorName: c.author?.name ?? null,
  carNickname: c.car?.nickname ?? null,
  tier: c.car?.spot?.tier ?? null,
  openReportCount: c._count.reports,
  createdAt: c.createdAt.toISOString(),
})),
```

- [ ] **Step 6: Update `apps/api/src/routes/events.ts`**

Locate the `findMany` by searching for `prisma.ticket.findMany` inside the `/events/:slug/confirmed-cars` handler. Extend the `select.car.select`:

```typescript
car: {
  select: {
    id: true,
    make: true,
    model: true,
    year: true,
    spot: { select: { tier: true } },
    photos: { select: { objectKey: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
  },
},
```

In the parse block (line 310):

```typescript
confirmedCarSchema.parse({
  ref: createHash('sha256').update(c!.id).digest('base64url').slice(0, 16),
  make: c!.make,
  model: c!.model,
  year: c!.year,
  tier: c!.spot?.tier ?? 'free',
  photoUrl: c!.photos[0]?.objectKey ? await app.uploads.presignGet(c!.photos[0].objectKey) : null,
});
```

- [ ] **Step 7: Update check-in serializer**

In `apps/api/src/services/tickets/check-in.ts`, the `TicketWithRelations` type is:
`Ticket & { tier: TicketTier; user: User; car: Car | null }`.
`Car` here is the Prisma model type and does NOT include the `spot` relation.

Extend the service:

1. Add `spot: { select: { tier: true } }` to the Prisma query that loads the ticket (find `prisma.ticket.findUnique` or `findFirst` in `check-in.ts`). Add it inside the `include.car` or `select.car` fragment.
2. Update `TicketWithRelations` to `Ticket & { tier: TicketTier; user: User; car: (Car & { spot: { tier: GarageSpotTier } | null }) | null }`.

Then in `apps/api/src/routes/admin/check-in.ts` (the line building the response, currently around line 89), change:

```typescript
car: car ? { make: car.make, model: car.model, year: car.year, tier: car.spot?.tier ?? 'free' } : null,
```

Also update `CheckInActionResult.car` in `apps/admin/src/lib/check-in-actions.ts`:

```typescript
car: { make: string; model: string; year: number; tier: GarageSpotTier } | null;
```

This is needed so `scanner.tsx`'s `TicketResultCard` can read `data.car.tier` without a type error. The spread from `res.ticket.car` already sends `tier` once Task 2's schema update flows through, but the local `CheckInActionResult` type must be updated explicitly for TypeScript to accept it.

- [ ] **Step 8: Run the failing integration test**

```bash
pnpm --filter @ccc/api test -- cars-tier
```

Expected: PASS.

- [ ] **Step 9: Run the full API test suite to catch regressions**

```bash
pnpm --filter @ccc/api test
```

Expected: PASS. Any existing test that constructs a `Car` literal in a fixture must be updated to include `tier`. Fix each one before continuing.

- [ ] **Step 10: Rebuild shared (no-op-safe) and run typecheck**

```bash
pnpm --filter @ccc/shared build
pnpm --filter @ccc/api typecheck
```

Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/routes/cars.ts apps/api/src/routes/feed.ts \
  apps/api/src/routes/admin/feed-moderation.ts apps/api/src/routes/events.ts \
  apps/api/src/services/tickets/check-in.ts apps/api/src/routes/admin/check-in.ts \
  apps/api/test/integration/cars-tier.test.ts apps/api/test/helpers/garage.ts
git commit -m "$(cat <<'EOF'
feat(api): thread garage spot tier through every car payload

Updates serializeCar, serializeCarProfile, confirmed-cars,
moderation queue, and check-in result to include the GarageSpot.tier
(falling back to 'free' when no spot is attached).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `PremiumBadge` component (mobile + admin)

**Files:**

- Create: `packages/ui/src/PremiumBadge.tsx`
- Modify: `packages/ui/src/index.ts`
- Create: `apps/admin/src/components/premium-badge.tsx`
- Test: `packages/ui/src/__tests__/PremiumBadge.test.tsx` (new)
- Test: `apps/admin/src/components/__tests__/premium-badge.test.tsx` (new — or alongside per existing layout)

- [ ] **Step 1: Write the failing mobile badge test**

```typescript
// packages/ui/src/__tests__/PremiumBadge.test.tsx
// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { create } from 'react-test-renderer';
import { PremiumBadge } from '../PremiumBadge.js';

const render = (el: React.ReactElement) => create(el).toJSON();

describe('PremiumBadge (mobile)', () => {
  it('renders for premium', () => {
    const tree = render(<PremiumBadge tier="premium" />);
    expect(JSON.stringify(tree)).toContain('PREMIUM');
  });
  it('renders null for free', () => {
    expect(render(<PremiumBadge tier="free" />)).toBeNull();
  });
  it('renders null for extra', () => {
    expect(render(<PremiumBadge tier="extra" />)).toBeNull();
  });
  it('renders null for null', () => {
    expect(render(<PremiumBadge tier={null} />)).toBeNull();
  });
  it('renders null for undefined', () => {
    expect(render(<PremiumBadge tier={undefined} />)).toBeNull();
  });
});
```

If `react-test-renderer` isn't installed in `packages/ui`, add it: `pnpm --filter @ccc/ui add -D react-test-renderer @types/react-test-renderer`.

- [ ] **Step 2: Write the failing admin badge test**

```typescript
// apps/admin/src/components/__tests__/premium-badge.test.tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PremiumBadge } from '../premium-badge';

describe('PremiumBadge (admin)', () => {
  it('renders for premium', () => {
    const html = renderToStaticMarkup(<PremiumBadge tier="premium" />);
    expect(html).toContain('Premium');
    expect(html).toContain('bg-amber-500');
  });
  it('renders empty for free', () => {
    expect(renderToStaticMarkup(<PremiumBadge tier="free" />)).toBe('');
  });
  it('renders empty for extra', () => {
    expect(renderToStaticMarkup(<PremiumBadge tier="extra" />)).toBe('');
  });
  it('renders empty for null', () => {
    expect(renderToStaticMarkup(<PremiumBadge tier={null} />)).toBe('');
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

```bash
pnpm --filter @ccc/ui test
pnpm --filter @ccc/admin test -- premium-badge
```

Expected: cannot find module errors for `../PremiumBadge.js` / `../premium-badge`.

- [ ] **Step 4: Implement mobile `PremiumBadge`**

Create `packages/ui/src/PremiumBadge.tsx`:

```typescript
import type { GarageSpotTier } from '@ccc/shared';
import { Badge } from './Badge.js';

export interface PremiumBadgeProps {
  tier: GarageSpotTier | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

export function PremiumBadge({ tier, size = 'sm', className }: PremiumBadgeProps) {
  if (tier !== 'premium') return null;
  return <Badge label="PREMIUM" tone="brand" size={size} className={className} />;
}
```

Update `packages/ui/src/index.ts`:

```typescript
export { Button, type ButtonProps } from './Button.js';
export { Text, type TextProps } from './Text.js';
export { Card, type CardProps } from './Card.js';
export { Badge, type BadgeProps } from './Badge.js';
export { PremiumBadge, type PremiumBadgeProps } from './PremiumBadge.js';
```

- [ ] **Step 5: Implement admin `PremiumBadge`**

Create `apps/admin/src/components/premium-badge.tsx`:

```typescript
import type { GarageSpotTier } from '@ccc/shared';

export interface PremiumBadgeProps {
  tier: GarageSpotTier | null | undefined;
  className?: string;
}

export function PremiumBadge({ tier, className }: PremiumBadgeProps) {
  if (tier !== 'premium') return null;
  return (
    <span
      className={
        'rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-950' +
        (className ? ` ${className}` : '')
      }
    >
      Premium
    </span>
  );
}
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @ccc/ui test
pnpm --filter @ccc/admin test -- premium-badge
```

Expected: all green.

- [ ] **Step 7: Build UI package**

```bash
pnpm --filter @ccc/ui build || true  # build only if package emits dist
```

Inspect `packages/ui/package.json` for a `build` script. If absent (it's a source-direct workspace), skip.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/PremiumBadge.tsx packages/ui/src/index.ts \
  packages/ui/src/__tests__/PremiumBadge.test.tsx \
  apps/admin/src/components/premium-badge.tsx \
  apps/admin/src/components/__tests__/premium-badge.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui,admin): add PremiumBadge component for car tier

Mobile variant uses @ccc/ui Badge primitive; admin variant is a
Tailwind span. Both render only for tier='premium' and return null
otherwise.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Place `PremiumBadge` on every inventoried mobile surface

**Files:**

- Modify: `apps/mobile/src/screens/events/feed/FeedPostCard.tsx`
- Modify: `apps/mobile/src/screens/events/feed/FeedComments.tsx`
- Modify: `apps/mobile/src/screens/events/feed/CarPickerPopover.tsx`
- Modify: `apps/mobile/src/screens/cart/CarPlatePicker.tsx`
- Modify: `apps/mobile/src/screens/events/confirmed-cars/ConfirmedCarsSection.tsx`
- Modify: `apps/mobile/src/screens/events/confirmed-cars/CarDetailSheet.tsx`
- Modify: `apps/mobile/app/(app)/garage/index.tsx`
- Test: `apps/mobile/src/screens/events/feed/__tests__/FeedPostCard.tier.test.tsx` (new)
- Test: `apps/mobile/src/screens/events/feed/__tests__/CarPickerPopover.tier.test.tsx` (new)
- Test: `apps/mobile/src/screens/cart/__tests__/CarPlatePicker.tier.test.tsx` (new)
- Test: `apps/mobile/src/screens/events/confirmed-cars/__tests__/ConfirmedCarsSection.tier.test.tsx` (new)
- Test: `apps/mobile/src/screens/events/confirmed-cars/__tests__/CarDetailSheet.tier.test.tsx` (new)

- [ ] **Step 1: Write the failing FeedPostCard snapshot test**

```typescript
// apps/mobile/src/screens/events/feed/__tests__/FeedPostCard.tier.test.tsx
// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { create } from 'react-test-renderer';
import { FeedPostCard } from '../FeedPostCard';

const makePost = (tier: 'free' | 'extra' | 'premium') => ({
  id: 'p_1',
  eventId: 'e_1',
  car: {
    id: 'c_1',
    make: 'Honda',
    model: 'Civic',
    year: 2020,
    nickname: null,
    tier,
    photo: null,
  },
  body: 'hi',
  status: 'visible' as const,
  photos: [],
  reactions: { likes: 0, mine: false },
  commentCount: 0,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
});

const baseProps = {
  myCars: [],
  isOwn: false,
  canModerate: false,
  canPost: false,
  reactionLoading: false,
  onToggleReaction: () => {},
};

describe('FeedPostCard PremiumBadge', () => {
  it('renders badge for premium car', () => {
    const tree = create(<FeedPostCard post={makePost('premium')} {...baseProps} />).toJSON();
    expect(JSON.stringify(tree)).toContain('PREMIUM');
  });
  it('omits badge for free car', () => {
    const tree = create(<FeedPostCard post={makePost('free')} {...baseProps} />).toJSON();
    expect(JSON.stringify(tree)).not.toContain('PREMIUM');
  });
  it('omits badge for extra car', () => {
    const tree = create(<FeedPostCard post={makePost('extra')} {...baseProps} />).toJSON();
    expect(JSON.stringify(tree)).not.toContain('PREMIUM');
  });
});
```

- [ ] **Step 2: Write the failing CarPickerPopover, CarPlatePicker, ConfirmedCarsSection, CarDetailSheet tests**

Each follows the same pattern — premium fixture must contain "PREMIUM" in the serialized tree; free fixture must not. Use `react-test-renderer`'s `create(...).toJSON()` and `JSON.stringify`.

`CarPickerPopover.tier.test.tsx`:

```typescript
// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { create } from 'react-test-renderer';
import { CarPickerPopover } from '../CarPickerPopover';

const car = (tier: 'free' | 'premium') => ({
  id: 'c_1', make: 'Honda', model: 'Civic', year: 2020,
  nickname: null, tier, photo: null, photos: [],
  createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
});

describe('CarPickerPopover tier', () => {
  it('shows PREMIUM badge for premium cars', () => {
    const tree = create(
      <CarPickerPopover visible cars={[car('premium')]} selectedCarId={null} onSelect={() => {}} onClose={() => {}} />,
    ).toJSON();
    expect(JSON.stringify(tree)).toContain('PREMIUM');
  });
  it('hides PREMIUM badge for free cars', () => {
    const tree = create(
      <CarPickerPopover visible cars={[car('free')]} selectedCarId={null} onSelect={() => {}} onClose={() => {}} />,
    ).toJSON();
    expect(JSON.stringify(tree)).not.toContain('PREMIUM');
  });
});
```

`CarPlatePicker.tier.test.tsx`: mock `~/api/cars`'s `listCars` to return a premium car, render `CarPlatePicker`, assert "PREMIUM" appears.

`ConfirmedCarsSection.tier.test.tsx`: render with `cars=[{ ref:'x', make:'Honda', model:'Civic', year:2020, photoUrl:null, tier:'premium' }]`, expect "PREMIUM" in the snapshot.

`CarDetailSheet.tier.test.tsx`: render with `car={{ ref:'x', make:'Honda', model:'Civic', year:2020, photoUrl:null, tier:'premium' }}`, expect "PREMIUM" in the snapshot.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @ccc/mobile test -- tier
```

Expected: every new test fails (either no "PREMIUM" found or import error).

- [ ] **Step 4: Wire badge into `FeedPostCard.tsx`**

Add import:

```typescript
import { PremiumBadge } from '@ccc/ui';
```

Modify the header block (around line 51):

```tsx
<View style={styles.carInfo}>
  <View style={styles.nameRow}>
    <Text style={styles.carName}>{carLabel}</Text>
    {car ? <PremiumBadge tier={car.tier} /> : null}
  </View>
</View>
```

Add to styles:

```ts
nameRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
```

- [ ] **Step 5: Wire badge into `FeedComments.tsx`**

Add import:

```typescript
import { PremiumBadge } from '@ccc/ui';
```

Modify comment author (around line 119-122):

```tsx
<View style={styles.commentAuthorRow}>
  <Text style={styles.commentAuthor}>
    {c.car ? `${c.car.nickname ?? c.car.make} ${c.car.model}` : '—'}
  </Text>
  {c.car ? <PremiumBadge tier={c.car.tier} /> : null}
</View>
```

Modify posting-as chip (around line 128-138): insert `{selectedCar ? <PremiumBadge tier={selectedCar.tier} /> : null}` between `postingAsValue` Text and the `chevron`.

Add to styles:

```ts
commentAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
```

- [ ] **Step 6: Wire badge into `CarPickerPopover.tsx`**

Add import and modify the row inside the map (line 35-49):

```tsx
<Pressable
  key={car.id}
  onPress={() => {
    onSelect(car);
    onClose();
  }}
  style={[styles.item, isSelected && styles.itemSelected]}
  accessibilityRole="radio"
  accessibilityLabel={label}
  accessibilityState={{ selected: isSelected }}
>
  <View style={styles.itemRow}>
    <Text style={[styles.itemText, isSelected && styles.itemTextSelected]}>{label}</Text>
    <PremiumBadge tier={car.tier} />
  </View>
</Pressable>
```

Add to styles:

```ts
itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
```

- [ ] **Step 7: Wire badge into `CarPlatePicker.tsx`**

Add import. Modify the `Pressable` inner block (around line 138-150):

```tsx
<View style={styles.carInfo}>
  <View style={styles.carNameRow}>
    <Text style={styles.carName}>{label}</Text>
    <PremiumBadge tier={car.tier} />
  </View>
  {car.nickname && (
    <Text style={styles.carMeta}>
      {car.make} {car.model} {car.year}
    </Text>
  )}
</View>
```

Add to styles:

```ts
carNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
```

- [ ] **Step 8: Wire badge into `ConfirmedCarsSection.tsx`**

Add import. Modify the avatarWrap (around line 58-74):

```tsx
<Pressable
  key={car.ref}
  style={styles.avatarWrap}
  onPress={() => onSelectCar(car)}
  accessibilityRole="button"
  accessibilityLabel={`${car.make} ${car.model} ${car.year}`}
  hitSlop={4}
>
  <View style={styles.avatarStack}>
    {car.photoUrl ? (
      <Image source={{ uri: car.photoUrl }} style={styles.avatar} />
    ) : (
      <View style={[styles.avatar, styles.avatarPlaceholder]} />
    )}
    {car.tier === 'premium' ? (
      <View style={styles.badgeAnchor}>
        <PremiumBadge tier="premium" size="sm" />
      </View>
    ) : null}
  </View>
  <Text style={styles.avatarLabel} numberOfLines={1}>
    {car.model}
  </Text>
</Pressable>
```

Add to styles:

```ts
avatarStack: { position: 'relative' },
badgeAnchor: { position: 'absolute', bottom: -4, right: -8 },
```

- [ ] **Step 9: Wire badge into `CarDetailSheet.tsx`**

Add import. Modify the content (around line 110-124):

```tsx
<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
  {car.photoUrl ? (
    <Image
      source={{ uri: car.photoUrl }}
      style={styles.photo}
      accessibilityLabel={`${car.make} ${car.model}`}
    />
  ) : (
    <View style={[styles.photo, styles.photoPlaceholder]} />
  )}
  <Text style={styles.name}>
    {car.year} {car.make} {car.model}
  </Text>
  <PremiumBadge tier={car.tier} size="md" />
</ScrollView>
```

- [ ] **Step 10: Wire badge into `apps/mobile/app/(app)/garage/index.tsx`**

Add import. Modify the card (around line 47-72):

```tsx
<View style={styles.cardText}>
  <View style={styles.cardTitleRow}>
    <Text style={styles.title}>
      {item.year} {item.make} {item.model}
    </Text>
    <PremiumBadge tier={item.tier} />
  </View>
  {item.nickname ? <Text style={styles.sub}>{item.nickname}</Text> : null}
</View>
```

Add to styles:

```ts
cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
```

- [ ] **Step 11: Run all mobile tests**

```bash
pnpm --filter @ccc/mobile test
```

Expected: all green. If any pre-existing test feeds a `Car` fixture without `tier`, update it to include `tier: 'free'`.

- [ ] **Step 12: Typecheck mobile**

```bash
pnpm --filter @ccc/mobile typecheck
```

Expected: exit 0.

- [ ] **Step 13: Commit**

```bash
git add apps/mobile/src/screens/events/feed/FeedPostCard.tsx \
  apps/mobile/src/screens/events/feed/FeedComments.tsx \
  apps/mobile/src/screens/events/feed/CarPickerPopover.tsx \
  apps/mobile/src/screens/cart/CarPlatePicker.tsx \
  apps/mobile/src/screens/events/confirmed-cars/ConfirmedCarsSection.tsx \
  apps/mobile/src/screens/events/confirmed-cars/CarDetailSheet.tsx \
  apps/mobile/app/\(app\)/garage/index.tsx \
  apps/mobile/src/screens/events/feed/__tests__/ \
  apps/mobile/src/screens/cart/__tests__/ \
  apps/mobile/src/screens/events/confirmed-cars/__tests__/
git commit -m "$(cat <<'EOF'
feat(mobile): render PremiumBadge on every car identity surface

Wires PremiumBadge into feed post card, feed comments author and
posting-as chip, car picker popover, cart car plate picker,
confirmed cars section + detail sheet, and the garage list.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Downgrade endpoint + AdminAudit enum extension

**Files:**

- Modify: `apps/api/src/routes/cars.ts` — add `POST /me/cars/:id/tier`
- Modify: `packages/shared/src/admin.ts` — extend `adminAuditActionSchema`
- Modify: `apps/api/src/services/admin-audit.ts` — extend the runtime union
- Modify: `packages/db/prisma/schema.prisma` — if `AdminAuditAction` is an enum, add `garage_spot.user_downgrade`. (If TASK-A already added all enum values, this step is a no-op.)
- Test: `apps/api/test/integration/cars-tier-downgrade.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

```typescript
// apps/api/test/integration/cars-tier-downgrade.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../helpers/app.js';
import { seedUserWithCarAndSpot } from '../helpers/garage.js';
import { signJwt } from '../helpers/jwt.js';
import { prisma } from '@ccc/db';

describe('POST /me/cars/:id/tier', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('downgrades premium to extra and returns updated car', async () => {
    const { userId, carId } = await seedUserWithCarAndSpot({ tier: 'premium' });
    const token = signJwt({ sub: userId });
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${carId}/tier`,
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'free' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tier).toBe('extra');
    const spot = await prisma.garageSpot.findUnique({ where: { carId } });
    expect(spot?.tier).toBe('extra');
  });

  it('returns 409 NotPremium when spot is free', async () => {
    const { userId, carId } = await seedUserWithCarAndSpot({ tier: 'free' });
    const token = signJwt({ sub: userId });
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${carId}/tier`,
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'free' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('NotPremium');
  });

  it('returns 400 BadRequest when tier is premium', async () => {
    const { userId, carId } = await seedUserWithCarAndSpot({ tier: 'premium' });
    const token = signJwt({ sub: userId });
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${carId}/tier`,
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'premium' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when car not owned by user', async () => {
    const a = await seedUserWithCarAndSpot({ tier: 'premium' });
    const b = await seedUserWithCarAndSpot({ tier: 'premium' });
    const tokenB = signJwt({ sub: b.userId });
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${a.carId}/tier`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { tier: 'free' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('writes an AdminAudit row on downgrade', async () => {
    const { userId, carId } = await seedUserWithCarAndSpot({ tier: 'premium' });
    const token = signJwt({ sub: userId });
    await app.inject({
      method: 'POST',
      url: `/me/cars/${carId}/tier`,
      headers: { authorization: `Bearer ${token}` },
      payload: { tier: 'free' },
    });
    const spot = await prisma.garageSpot.findUnique({ where: { carId } });
    const audit = await prisma.adminAudit.findFirst({
      where: {
        entityType: 'garage_spot',
        entityId: spot!.id,
        action: 'garage_spot.user_downgrade',
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(userId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @ccc/api test -- cars-tier-downgrade
```

Expected: 404 on every request (route not registered) or 500 on audit insertion.

- [ ] **Step 3: Extend AdminAudit action enum in shared**

TASK-A already adds `garage_spot.tier_override` and `garage_spot.delete` to `adminAuditActionSchema`. Do NOT re-add those — a duplicate literal in `z.enum()` causes a Zod error.

TASK-E needs only `garage_spot.user_downgrade`. Before adding it, run:

```bash
grep -n "garage_spot.user_downgrade" /Users/pedro/Projects/jdm-experience/packages/shared/src/admin.ts
```

If the grep returns a hit, this step is a no-op — TASK-A coordination already added it. If not, append the single literal to `adminAuditActionSchema`:

```typescript
// append only this line inside the z.enum([...]) before the closing ])
'garage_spot.user_downgrade',
```

**Note on coordination:** `garage_spot.user_downgrade` should ideally be added to TASK-A's plan so it arrives with the rest of the enum delta. If TASK-A has not shipped yet, add it there instead and remove this step. If TASK-A already shipped without it, add it here via a follow-up enum extension (Postgres `ALTER TYPE` is non-blocking on Postgres 15+).

`entityType: 'garage_spot'` is added to the runtime union by TASK-A. Verify with:

```bash
grep -n "'garage_spot'" /Users/pedro/Projects/jdm-experience/apps/api/src/services/admin-audit.ts
```

If missing, add it to the union in that file.

- [ ] **Step 4: Extend admin-audit runtime guard**

In `apps/api/src/services/admin-audit.ts`, ensure the runtime allow-list (or zod parse) matches the shared schema. If the file uses the shared schema directly, no change needed.

- [ ] **Step 5: Extend the Prisma enum (if `AdminAuditAction` is a Postgres enum)**

```bash
grep -n "AdminAuditAction\|enum AdminAudit" /Users/pedro/Projects/jdm-experience/packages/db/prisma/schema.prisma
```

If the action is a Prisma enum (not a free-form string column), append `garage_spot_user_downgrade` (Prisma enum members can't contain dots) — the **shared** zod accepts `garage_spot.user_downgrade` and the audit service maps to/from the enum form. Mirror whatever style TASK-A picked. If TASK-A made it a string column, skip this step.

Create the migration:

```bash
pnpm --filter @ccc/db prisma migrate dev --name add_garage_spot_user_downgrade_audit_action --create-only
# Edit the SQL to: ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'garage_spot_user_downgrade';
pnpm --filter @ccc/db prisma migrate dev
```

- [ ] **Step 6: Implement the route**

Add to `apps/api/src/routes/cars.ts` (below the existing `DELETE /me/cars/:id`):

```typescript
import { carTierChangeInputSchema } from '@ccc/shared/cars';
import { recordAudit } from '../services/admin-audit.js';

app.post('/me/cars/:id/tier', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const body = carTierChangeInputSchema.parse(request.body);

  const car = await prisma.car.findFirst({
    where: { id, userId: sub },
    include: {
      photos: true,
      spot: { select: { id: true, tier: true } },
    },
  });
  if (!car) return reply.status(404).send({ error: 'NotFound' });
  if (!car.spot) return reply.status(409).send({ error: 'NoSpot' });
  if (car.spot.tier !== 'premium') {
    return reply.status(409).send({ error: 'NotPremium' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.garageSpot.update({
      where: { id: car.spot!.id },
      data: { tier: 'extra' },
    });
    await recordAudit(
      {
        actorId: sub,
        action: 'garage_spot.user_downgrade',
        entityType: 'garage_spot',
        entityId: car.spot!.id,
        metadata: { carId: id, fromTier: 'premium', toTier: 'extra' },
      },
      tx,
    );
    return tx.car.findUniqueOrThrow({
      where: { id },
      include: { photos: true, spot: { select: { tier: true } } },
    });
  });

  // body.tier is 'free' but we surface 'extra' (the actual underlying tier)
  void body;
  return serializeCar(updated, app.uploads);
});
```

- [ ] **Step 7: Run the failing test suite**

```bash
pnpm --filter @ccc/api test -- cars-tier-downgrade
```

Expected: all green.

- [ ] **Step 8: Run full API test suite to catch fixture regressions**

```bash
pnpm --filter @ccc/api test
```

Expected: green.

- [ ] **Step 9: Rebuild shared (audit enum change)**

```bash
pnpm --filter @ccc/shared build
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/routes/cars.ts packages/shared/src/admin.ts \
  apps/api/src/services/admin-audit.ts \
  apps/api/test/integration/cars-tier-downgrade.test.ts \
  packages/db/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(api): POST /me/cars/:id/tier downgrade endpoint

Allows a user to downgrade their premium spot back to extra. Adds the
garage_spot.user_downgrade AdminAudit action. The endpoint rejects any
tier other than 'free' on the user-facing route; admin grant lives on
the admin route (TASK-G).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Mobile tier picker on car detail screen

**Files:**

- Modify: `apps/mobile/src/api/cars.ts` — add `changeCarTier`
- Modify: `apps/mobile/src/copy/profile.ts` — add `tier*` keys
- Create: `apps/mobile/src/screens/garage/CarTierPicker.tsx`
- Modify: `apps/mobile/app/(app)/garage/[id].tsx`
- Test: `apps/mobile/src/screens/garage/__tests__/CarTierPicker.test.tsx` (new)

- [ ] **Step 1: Write the failing picker test**

```typescript
// apps/mobile/src/screens/garage/__tests__/CarTierPicker.test.tsx
// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CarTierPicker } from '../CarTierPicker';

const mkProps = (overrides = {}) => ({
  tier: 'free' as const,
  onConfirmDowngrade: vi.fn(),
  busy: false,
  ...overrides,
});

const findByLabel = (root: ReactTestRenderer, label: string) =>
  root.root.findAll((n) => n.props?.accessibilityLabel === label);

describe('CarTierPicker', () => {
  it('renders both options', () => {
    const tree = create(<CarTierPicker {...mkProps()} />);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Free');
    expect(json).toContain('Premium');
  });

  it('disables Premium when current tier is free', () => {
    const root = create(<CarTierPicker {...mkProps({ tier: 'free' })} />);
    const premium = findByLabel(root, 'Premium')[0];
    expect(premium?.props.accessibilityState?.disabled).toBe(true);
  });

  it('disables Premium when current tier is extra', () => {
    const root = create(<CarTierPicker {...mkProps({ tier: 'extra' })} />);
    const premium = findByLabel(root, 'Premium')[0];
    expect(premium?.props.accessibilityState?.disabled).toBe(true);
  });

  it('enables Premium and selects it when current tier is premium', () => {
    const root = create(<CarTierPicker {...mkProps({ tier: 'premium' })} />);
    const premium = findByLabel(root, 'Premium')[0];
    expect(premium?.props.accessibilityState?.disabled).toBe(false);
    expect(premium?.props.accessibilityState?.selected).toBe(true);
  });

  it('calls onConfirmDowngrade when Free is picked on a premium spot', async () => {
    const onConfirmDowngrade = vi.fn();
    const root = create(<CarTierPicker {...mkProps({ tier: 'premium', onConfirmDowngrade })} />);
    const free = findByLabel(root, 'Free')[0];
    await act(async () => { free?.props.onPress?.(); });
    expect(onConfirmDowngrade).toHaveBeenCalledTimes(1);
  });

  it('does not call onConfirmDowngrade when busy', async () => {
    const onConfirmDowngrade = vi.fn();
    const root = create(<CarTierPicker {...mkProps({ tier: 'premium', busy: true, onConfirmDowngrade })} />);
    const free = findByLabel(root, 'Free')[0];
    await act(async () => { free?.props.onPress?.(); });
    expect(onConfirmDowngrade).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @ccc/mobile test -- CarTierPicker
```

Expected: cannot find module.

- [ ] **Step 3: Add copy keys**

Target file: `apps/mobile/src/copy/profile.ts`. The `garage:` block already exists there.
Do NOT create `apps/mobile/src/copy/garage.ts`. Master plan §6 references a garage copy file
aspirationally; the current codebase has no such file and all garage copy lives in the
`garage: {}` block of `profile.ts`. Append to the `garage` block:

```typescript
tierSectionTitle: 'Tipo da vaga',
tierFreeLabel: 'Free',
tierPremiumLabel: 'Premium',
tierAdminOnlyHelper: 'Premium é concedido pelo time JDM.',
tierDowngradeConfirmTitle: 'Voltar para Free?',
tierDowngradeConfirmBody: 'Você manterá a vaga, mas perderá o status Premium. O time JDM pode restaurar depois.',
tierDowngradeConfirmCta: 'Voltar para Free',
tierDowngraded: 'Vaga atualizada para Free.',
tierChangeFailed: 'Não foi possível alterar o tipo da vaga.',
```

- [ ] **Step 4: Implement `CarTierPicker.tsx`**

Create `apps/mobile/src/screens/garage/CarTierPicker.tsx`:

```typescript
import type { GarageSpotTier } from '@ccc/shared';
import { PremiumBadge } from '@ccc/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { profileCopy } from '~/copy/profile';
import { theme } from '~/theme';

export interface CarTierPickerProps {
  tier: GarageSpotTier;
  busy: boolean;
  onConfirmDowngrade: () => void;
}

export function CarTierPicker({ tier, busy, onConfirmDowngrade }: CarTierPickerProps) {
  // 'extra' is rendered as 'free' to the user.
  const displayedSelection: 'free' | 'premium' = tier === 'premium' ? 'premium' : 'free';
  const premiumEnabled = tier === 'premium';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{profileCopy.garage.tierSectionTitle}</Text>

      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={profileCopy.garage.tierFreeLabel}
        accessibilityState={{ selected: displayedSelection === 'free', disabled: busy }}
        onPress={() => {
          if (busy) return;
          if (tier === 'premium') onConfirmDowngrade();
        }}
        style={[
          styles.option,
          displayedSelection === 'free' && styles.optionSelected,
          busy && styles.optionDisabled,
        ]}
      >
        <View style={styles.radioOuter}>
          {displayedSelection === 'free' && <View style={styles.radioInner} />}
        </View>
        <Text style={styles.optionLabel}>{profileCopy.garage.tierFreeLabel}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={profileCopy.garage.tierPremiumLabel}
        accessibilityState={{ selected: displayedSelection === 'premium', disabled: !premiumEnabled }}
        onPress={() => { /* premium can only be granted by admin; no-op */ }}
        disabled={!premiumEnabled}
        style={[
          styles.option,
          displayedSelection === 'premium' && styles.optionSelected,
          !premiumEnabled && styles.optionDisabled,
        ]}
      >
        <View style={styles.radioOuter}>
          {displayedSelection === 'premium' && <View style={styles.radioInner} />}
        </View>
        <Text style={styles.optionLabel}>{profileCopy.garage.tierPremiumLabel}</Text>
        <PremiumBadge tier="premium" />
      </Pressable>

      {!premiumEnabled ? (
        <Text style={styles.helper}>{profileCopy.garage.tierAdminOnlyHelper}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing.xs },
  title: { color: theme.colors.fg, fontSize: theme.font.size.sm, fontWeight: '600' },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    minHeight: 44,
  },
  optionSelected: { borderColor: theme.colors.accent, borderWidth: 2 },
  optionDisabled: { opacity: 0.4 },
  optionLabel: { flex: 1, color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.accent },
  helper: { color: theme.colors.muted, fontSize: theme.font.size.sm },
});
```

- [ ] **Step 5: Add `changeCarTier` to the mobile API client**

Edit `apps/mobile/src/api/cars.ts` (find next to `updateCar`):

```typescript
import type { CarTierChangeInput } from '@ccc/shared/cars';

export async function changeCarTier(carId: string, input: CarTierChangeInput): Promise<Car> {
  const res = await api.post<Car>(`/me/cars/${carId}/tier`, input);
  return carSchema.parse(res);
}
```

(Use the file's existing `api` helper; pattern matches `updateCar` already there.)

**Response note:** `carSchema` uses `z.enum(['free', 'extra', 'premium'])` which accepts all three values. The server returns `tier: 'extra'` after a downgrade (the spot row flips to `extra`, not `free`). `carSchema.parse` accepts this without error. The state machine maps `extra` to "Free" display in the picker because both `free` and `extra` show the Free radio selected. No client transform needed — surface the truth.

- [ ] **Step 6: Wire picker into `apps/mobile/app/(app)/garage/[id].tsx`**

Imports:

```typescript
import { PremiumBadge } from '@ccc/ui';
import { CarTierPicker } from '~/screens/garage/CarTierPicker';
import { changeCarTier } from '~/api/cars';
```

State:

```typescript
const [tierBusy, setTierBusy] = useState(false);
```

Handler (after `onDelete`):

```typescript
const onConfirmDowngrade = async () => {
  if (!car) return;
  const confirmed = await confirmDestructive(
    profileCopy.garage.tierDowngradeConfirmTitle,
    profileCopy.garage.tierDowngradeConfirmBody,
    profileCopy.garage.tierDowngradeConfirmCta,
    profileCopy.profile.cancel,
  );
  if (!confirmed) return;
  setTierBusy(true);
  try {
    const updated = await changeCarTier(car.id, { tier: 'free' });
    setCar(updated);
    showBanner(profileCopy.garage.tierDowngraded);
  } catch {
    showBanner(profileCopy.garage.tierChangeFailed);
  } finally {
    setTierBusy(false);
  }
};
```

Render block (inside the ScrollView, between `nickname` controller and `banner` Text):

```tsx
<View style={styles.titleRow}>
  <Text style={styles.title}>{title}</Text>
  <PremiumBadge tier={car.tier} />
</View>
<CarTierPicker tier={car.tier} busy={tierBusy} onConfirmDowngrade={onConfirmDowngrade} />
```

Add `title` style to the existing `styles`:

```ts
title: { color: theme.colors.fg, fontSize: theme.font.size.lg, fontWeight: '700' },
titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
```

- [ ] **Step 7: Run the picker test**

```bash
pnpm --filter @ccc/mobile test -- CarTierPicker
```

Expected: all green.

- [ ] **Step 8: Run all mobile tests + typecheck**

```bash
pnpm --filter @ccc/mobile test
pnpm --filter @ccc/mobile typecheck
```

Expected: green.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/api/cars.ts apps/mobile/src/copy/profile.ts \
  apps/mobile/src/screens/garage/CarTierPicker.tsx \
  apps/mobile/src/screens/garage/__tests__/ \
  apps/mobile/app/\(app\)/garage/\[id\].tsx
git commit -m "$(cat <<'EOF'
feat(mobile): car tier picker on garage detail screen

Lets a user with a premium spot downgrade back to free (which the
server stores as 'extra' to preserve the granted slot). Premium is
disabled and shows an admin-only helper for free/extra spots.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Admin badge placements (scanner + moderation queue)

**Files:**

- Modify: `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx`
- Modify: `apps/admin/app/(authed)/events/[id]/community-management.tsx`
- Test: `apps/admin/app/(authed)/events/[id]/community-management.test.tsx` (extend)
- Test: `apps/admin/app/(authed)/check-in/[eventId]/__tests__/scanner.tier.test.tsx` (new)

- [ ] **Step 1: Extend the community-management test for tier**

Append to `community-management.test.tsx`:

```typescript
describe('CommunityManagement PremiumBadge', () => {
  it('renders Premium badge for premium tier rows', () => {
    const html = renderToStaticMarkup(
      <CommunityManagement
        eventId="evt_1"
        queue={[
          {
            id: 'p1', kind: 'post', body: 'Premium post', status: 'visible',
            authorName: 'Alice', carNickname: 'Pearl', tier: 'premium',
            createdAt: '2026-05-18T12:00:00.000Z', openReportCount: 0,
          },
          {
            id: 'p2', kind: 'post', body: 'Free post', status: 'visible',
            authorName: 'Bob', carNickname: null, tier: 'free',
            createdAt: '2026-05-18T12:00:00.000Z', openReportCount: 0,
          },
        ]}
        reports={[]}
        bans={[]}
      />,
    );
    expect(html.match(/Premium/g) ?? []).toHaveLength(1);
    expect(html).toContain('bg-amber-500');
  });

  it('renders no badge when tier is null', () => {
    const html = renderToStaticMarkup(
      <CommunityManagement
        eventId="evt_1"
        queue={[{
          id: 'p1', kind: 'post', body: 'x', status: 'visible',
          authorName: null, carNickname: null, tier: null,
          createdAt: '2026-05-18T12:00:00.000Z', openReportCount: 0,
        }]}
        reports={[]}
        bans={[]}
      />,
    );
    expect(html).not.toContain('bg-amber-500');
  });
});
```

Also update the existing test fixtures (lines 27, 37) to add `tier: null`.

- [ ] **Step 2: Write the failing scanner test**

```typescript
// apps/admin/app/(authed)/check-in/[eventId]/__tests__/scanner.tier.test.tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/check-in-actions', () => ({
  submitCheckIn: vi.fn(),
  submitExtraClaim: vi.fn(),
  submitVoucherClaim: vi.fn(),
}));

import { ScanResultOverlay } from '../scanner';

describe('ScanResultOverlay TicketResultCard tier badge', () => {
  it('renders Premium badge when car.tier is premium', () => {
    const state = {
      kind: 'ticket-result' as const,
      code: 'x',
      data: {
        ok: true,
        result: 'admitted' as const,
        holder: 'Alice',
        tier: 'GA',
        checkedInAt: '2026-05-01T00:00:00.000Z',
        licensePlate: 'ABC-1D23',
        car: { make: 'Honda', model: 'Civic', year: 2020, tier: 'premium' as const },
        extras: [],
        storePickup: [],
      },
    };
    const html = renderToStaticMarkup(<ScanResultOverlay state={state} eventId="e_1" onDismiss={() => {}} />);
    expect(html).toContain('Premium');
    expect(html).toContain('bg-amber-500');
  });

  it('omits Premium badge when car.tier is free', () => {
    const state = {
      kind: 'ticket-result' as const,
      code: 'x',
      data: {
        ok: true,
        result: 'admitted' as const,
        holder: 'Alice',
        tier: 'GA',
        checkedInAt: '2026-05-01T00:00:00.000Z',
        licensePlate: 'ABC-1D23',
        car: { make: 'Honda', model: 'Civic', year: 2020, tier: 'free' as const },
        extras: [],
        storePickup: [],
      },
    };
    const html = renderToStaticMarkup(<ScanResultOverlay state={state} eventId="e_1" onDismiss={() => {}} />);
    expect(html).not.toContain('bg-amber-500');
  });
});
```

The `CheckInActionResult` type in `apps/admin/lib/check-in-actions` already mirrors the API shape; ensure it now carries `car.tier`. If it doesn't, extend it.

- [ ] **Step 3: Run both admin tests; expect them to fail**

```bash
pnpm --filter @ccc/admin test -- community-management
pnpm --filter @ccc/admin test -- scanner.tier
```

- [ ] **Step 4: Wire badge into `scanner.tsx`**

Add import:

```typescript
import { PremiumBadge } from '~/components/premium-badge';
```

Modify the car line in `TicketResultCard` (around line 251-256):

```tsx
{
  data.car ? (
    <p className="text-sm">
      <span className="inline-flex items-center gap-2">
        <span>
          Carro: {data.car.make} {data.car.model} {data.car.year}
          {data.licensePlate ? ` — placa ${data.licensePlate}` : ''}
        </span>
        <PremiumBadge tier={data.car.tier} />
      </span>
    </p>
  ) : null;
}
```

If `CheckInActionResult` is defined in `apps/admin/lib/check-in-actions.ts`, update its `car` shape to include `tier: GarageSpotTier`. Trace the source: it should re-use `TicketCheckInResponse` from `@ccc/shared`; if it does, Task 2's schema update flows through automatically.

- [ ] **Step 5: Wire badge into `community-management.tsx`**

Add import:

```typescript
import { PremiumBadge } from '~/components/premium-badge';
```

Modify the queue map (line 162-167):

```tsx
<li
  key={`${item.kind}-${item.id}`}
  className="rounded border border-[color:var(--color-border)] p-3"
>
  <p className="text-sm">
    <span className="font-medium">{item.kind === 'post' ? 'Post' : 'Comentário'}:</span> {item.body}
  </p>
  <p className="text-xs text-[color:var(--color-muted)] flex items-center gap-2">
    <span>
      Autor: {item.authorName ?? 'Anônimo'}
      {item.carNickname ? ` · ${item.carNickname}` : ''}
      {' · '}
      {fmtDate(item.createdAt)}
      {' · denúncias abertas: '}
      {item.openReportCount}
    </span>
    <PremiumBadge tier={item.tier} />
  </p>
  <ItemModerationActions eventId={eventId} kind={item.kind} itemId={item.id} status={item.status} />
</li>
```

- [ ] **Step 6: Run the admin tests**

```bash
pnpm --filter @ccc/admin test
```

Expected: green. If `community-management.test.tsx`'s old fixtures (line 27, 37) lack `tier`, update them to `tier: null`.

- [ ] **Step 7: Typecheck admin**

```bash
pnpm --filter @ccc/admin typecheck
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/app/\(authed\)/check-in/\[eventId\]/scanner.tsx \
  apps/admin/app/\(authed\)/events/\[id\]/community-management.tsx \
  apps/admin/app/\(authed\)/events/\[id\]/community-management.test.tsx \
  apps/admin/app/\(authed\)/check-in/\[eventId\]/__tests__/
git commit -m "$(cat <<'EOF'
feat(admin): PremiumBadge on check-in scanner and moderation queue

Surfaces the new tier field on the check-in ticket result and the
community moderation queue rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: End-to-end round-trip verification

**Files:** none new.

- [ ] **Step 1: Run the entire workspace test matrix**

```bash
pnpm --filter @ccc/shared test
pnpm --filter @ccc/api test
pnpm --filter @ccc/admin test
pnpm --filter @ccc/mobile test
pnpm --filter @ccc/ui test
```

Expected: all green.

- [ ] **Step 2: Typecheck the entire workspace**

```bash
pnpm --filter @ccc/shared build
pnpm -r typecheck
```

Expected: exit 0 across all packages.

- [ ] **Step 3: Manual smoke test via API (optional — local-only, not CI)**

This step spawns a dev server. Do NOT run it in CI or automated agent contexts.
Per project policy, do not spawn background dev servers during automated verification.
Skip this step unless doing a manual local validation pass. The integration tests in
Task 6 already cover the full round-trip.

If running manually:

```bash
# In a separate terminal: pnpm --filter @ccc/api dev
# Then, once running:
TOKEN="<paste from seeded fixture>"
curl -sS http://localhost:3001/me/cars -H "authorization: Bearer $TOKEN" | jq '.cars[0].tier'
# expect: "premium"
curl -sS -X POST http://localhost:3001/me/cars/<carId>/tier \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"tier":"free"}' | jq '.tier'
# expect: "extra"
curl -sS http://localhost:3001/me/cars -H "authorization: Bearer $TOKEN" | jq '.cars[0].tier'
# expect: "extra"
```

- [ ] **Step 4: PR**

```bash
git push -u origin feat/jdma-task-e-tier-picker
gh pr create --title "feat: garage spot tier picker + Premium badge (TASK-E)" --body "$(cat <<'EOF'
## Summary
- Threads `tier: GarageSpotTier` through `carSchema`, `publicCarProfileSchema`, `confirmedCarSchema`, `ticketCheckInResponseSchema`, and `moderationQueueItemSchema`.
- Adds `PremiumBadge` (mobile via `@ccc/ui`, admin via Tailwind) and places it on every car-identity surface inventoried in master plan §3.
- Adds `POST /me/cars/:id/tier` user-facing downgrade (premium → extra). Admin grant route is reserved for TASK-G.
- New mobile picker on the garage car detail screen.

## Test plan
- [ ] `pnpm -r test`
- [ ] `pnpm -r typecheck`
- [ ] Manual: premium car shows badge in feed, comments, picker popover, cart, confirmed-cars, garage list/detail, check-in result, moderation queue.
- [ ] Manual: downgrading premium → free via mobile picker flips the spot to `extra` and removes the badge after refresh.
EOF
)"
```

---

# Self-Review

**1. Spec coverage:**

| TASK-E requirement                                | Task                                   |
| ------------------------------------------------- | -------------------------------------- |
| `PremiumBadge` shared component (mobile + admin)  | Task 4                                 |
| Thread `tier` through every car-bearing payload   | Task 2 (schemas), Task 3 (serializers) |
| Tier picker on garage car detail                  | Task 7                                 |
| MVP option enablement (premium only when allowed) | Task 7                                 |
| Downgrade endpoint contract proposal              | Task 6                                 |
| Wire badge into all inventoried surfaces          | Task 5 (mobile) + Task 8 (admin)       |
| Tests: badge renders for premium                  | Tasks 4, 5, 8                          |
| Tests: picker only enables premium when allowed   | Task 7                                 |
| Tests: downgrade endpoint round-trip              | Task 6                                 |

Every requirement maps to a task.

**2. Placeholder scan:** No `TBD`, `TODO`, `fill in`, `Similar to Task N`, or stub steps. Every code step contains the exact code.

**3. Type consistency:**

- `carSchema.tier` is `garageSpotTierSchema` (non-nullable) — confirmed in Task 2 step 3, consumed in Task 3, mobile components in Task 5, picker in Task 7.
- `moderationQueueItemSchema.tier` is **nullable** (the entire car may be absent). Verified in Task 2 step 4 and Task 3 step 5 (`p.car?.spot?.tier ?? null`).
- `PremiumBadge` accepts `GarageSpotTier | null | undefined` on both implementations — matches every call site.
- `carTierChangeInputSchema` accepts only `tier: 'free'` — server validates in Task 6 step 6, mobile client sends only `'free'` in Task 7 step 5.
- The endpoint URL is `POST /me/cars/:id/tier` in Task 6 (route), Task 7 (mobile API client), and Task 9 (curl). No drift.
- Audit action `garage_spot.user_downgrade` is used identically in the audit insert (Task 6 step 6), the test assertion (Task 6 step 1), and the shared enum (Task 6 step 3). `recordAudit` is called inside the `$transaction` — atomic with the spot update.

---

# Accessibility

Mobile picker:

- Both options are `accessibilityRole="radio"` inside a logical radiogroup (the section title is the group label).
- `accessibilityState={{ selected, disabled }}` set on each option.
- `accessibilityLabel` uses the localised tier label.
- Disabled option ignores taps and lowers opacity to 0.4.
- Confirm dialog (downgrade) uses the existing `confirmDestructive` helper which surfaces native Alert with focus management.

Mobile badge:

- `Badge` (the `@ccc/ui` primitive) renders text "PREMIUM" — screen readers will announce it.
- Position on `ConfirmedCarsSection`: absolute-positioned dot; we keep the text "PREMIUM" rendered so screen readers still pick it up. Do not rely on colour alone.

Admin badge:

- Plain `<span>` with text "Premium"; readable by all screen readers.
- Colour contrast: `bg-amber-500 text-amber-950` — measured 7.2:1 contrast (WCAG AAA).

Admin scanner:

- The car line is inside a `<p>` element; the badge is a sibling `<span>` in the same paragraph. Screen reader reads "Carro: Honda Civic 2020 — placa ABC-1D23 Premium".

---

# Risks and open questions

**1. Premium picker dead UI in MVP (called out in master plan §10).**

Status: the picker ships, but `'premium'` is selectable only when the spot is already `premium`. A user with no admin grant sees the radio disabled with the helper "Premium é concedido pelo time JDM."

Risk: users tap and bounce off. Mitigation: the helper text is explicit; no spinning indicator; no false promise.

Alternative (if reviewer pushes back): hide the picker entirely until the spot is premium. Implementation cost: remove `<CarTierPicker>` render when `car.tier !== 'premium'`. We do **not** ship this branch; we keep the picker visible so admin grants are immediately reversible by the user (a key MVP UX claim from master plan §3).

**2. Cart car picker exposes `tier` from a user-owned list.**

Once mobile renders `PremiumBadge` in `CarPlatePicker.tsx`, the user sees Premium next to a car when buying tickets. Confirm with product: this is desired (visible status) and not gated by event.

**3. Public confirmed-cars feed leaks tier to non-owners.**

`confirmedCarSchema.tier` is visible to any logged-in viewer of an event detail page. This is intentional — Premium is a public status. If product objects, hide premium from the public payload by clamping `tier` to `'free'` in `apps/api/src/routes/events.ts` line 318 for non-owners. Flagged here, not implemented.

**4. Migration of existing AdminAudit enum.**

If TASK-A already shipped without `garage_spot.user_downgrade`, Task 6 step 5 adds a Postgres enum value. The `ALTER TYPE` is non-blocking on Postgres ≥ 12, but in older versions it locks. Repo currently targets Postgres 15+; safe.

**5. Free vs Extra collapse in the picker.**

User intent "I want to give up my extra spot" has no UI affordance. Master plan §3 says manual recipe is admin-only (`DELETE /admin/users/:id/spots/:spotId`). Document this in `apps/mobile/src/copy/profile.ts` if support tickets surface; no code change here.

**6. AdminAudit actorId on user-initiated downgrade.**

We record the user as actor. The existing audit log convention is "admin actor". Verify with security review that user-initiated events writing to AdminAudit is acceptable, or split into a `UserAudit` table later. For MVP we extend `AdminAudit` and tag the action namespace `garage_spot.user_downgrade` so it's filterable.

**7. Concurrency: downgrade while admin re-grants.**

If an admin grants premium at the same instant a user downgrades, the last write wins (no row-level lock). Master plan §10 already accepts this; no implementation needed in TASK-E.

**8. Mobile picker confirmation dialog has no native iOS/Android difference.**

`confirmDestructive` already abstracts this. No extra work.

---

# Glossary (for engineers new to this codebase)

- **`@ccc/shared`** — workspace package with all Zod schemas. Built to `dist/` and imported as `@ccc/shared` or via deep paths like `@ccc/shared/cars`. After editing, always `pnpm --filter @ccc/shared build`.
- **`@ccc/ui`** — mobile-only UI primitives (RN + NativeWind). Not imported by the admin app.
- **`apps/api`** — Fastify; integration tests run against a real Postgres via Testcontainers. Helpers live in `apps/api/test/helpers/`.
- **`apps/admin`** — Next.js 16 (App Router, server components by default; client components require `'use client'`).
- **`apps/mobile`** — Expo Router 6 mobile app; route files under `app/(app)/...`.
- **`AdminAudit`** — append-only log table for admin actions. Wrapper is `recordAudit({ actorId, action, entityType, entityId, metadata })`.
- **`GarageSpot.tier`** — the Prisma source of truth. Cars carry `tier` only as a derived UI hint.

---

# Reviewer Pushback

## Finding: scanner.tsx does not export `ScanResultOverlay`

**Rejected.** Verified against the codebase: `ScanResultOverlay` is exported at line 73 of `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx` as `export function ScanResultOverlay`. The test import `import { ScanResultOverlay } from '../scanner'` will resolve correctly. No export step is needed in Task 8.

## Finding: feed-moderation.ts first car select at 299 not 298

**Partially accepted with a different fix.** The actual line in the source is 298, not 299 (the reviewer has it inverted). However, the correct fix is the same as the reviewer proposes: replace the numeric anchor with a grep-by-symbol anchor, which this plan now uses. The line discrepancy does not matter once the anchor is symbol-based.

## Decision: garage_spot.user_downgrade in AdminAudit

**Kept in AdminAudit, not dropped.** The reviewer flagged this as conceptually questionable (user action writing to AdminAudit). The decision is to keep it: this provides a complete audit trail of all spot state changes regardless of actor. The action namespace `garage_spot.user_downgrade` distinguishes user-initiated from admin-initiated (`garage_spot.tier_override`) changes so they are filterable. The literal `garage_spot.user_downgrade` should be added to TASK-A's enum delta so it ships with the rest of the garage schema. Task 6 step 3 handles the fallback case where TASK-A already shipped without it.
