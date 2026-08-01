# TASK-D — Mobile Garage UI Implementation Plan

> ## ⚠️ POST-PIVOT NOTICE (2026-05-20)
>
> **Canonical source:** [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](../../docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md).
>
> **What changes:**
>
> - Empty-spot card copy reads `source` (default_free / purchase / etc.) instead of `tier`. "Adicionar Carro" for `source=default_free`, "Preencher Vaga" for any other source. No `extra` / `free` tier strings on cars.
> - All garage settings (name, slug, description, `isPublic` toggle) live **inline on the existing `/garage` page** — no separate settings route. The page header gets edit affordances.
> - New "Tornar pública" toggle on the garage page. Share-link control respects toggle state (disabled / explanatory tooltip when `isPublic=false`).
> - Post-signin, the app lands on `/garage` (regardless of car count). Empty-state CTA "Adicione seu primeiro carro".
> - Public profile preview lives inside the `/garage` page (read-only render of what `/g/:slug` would show).
> - **No tier picker UI** — that scope is deleted (see TASK-E pivot notice).
> - `Car.description` is gone; car forms drop the field. `Car.modifications` and `Car.nickname` unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the garage list as a slot-aware grid with explicit placeholder cards (`Adicionar Carro` for empty free spots, `Preencher Vaga` for empty extra spots, `Comprar Vaga Adicional` when all spots are filled) wired to the new `GET /me/garage` payload and the `POST /me/garage/spots/cart` mutation, so attendees can add cars within their free limit and buy extra spots beyond it.

**Architecture:** Pure presentation helpers convert `GarageReadResponse` into a typed `GarageSlot[]` view-model in `src/screens/garage/garage-slots.ts`. The list screen consumes that view-model and renders one of three card components per slot. The buy-spot card calls `POST /me/garage/spots/cart` then routes to `/cart` after the global `CartProvider.refresh()` completes. Both `/garage` and `/profile/garage` route trees are updated symmetrically. There is no React Query or SWR in this app — fetching uses `useFocusEffect` + `useState` with `authedRequest`, the existing pattern.

**Tech Stack:** Expo Router, React 19, React Native 0.81, Zod schemas from `@ccc/shared`, vitest 3 + jsdom + react-dom for component-level tests (no `@testing-library/react-native` is installed — do not add it). All copy is plain strings imported from `~/copy/garage`. Theme tokens from `~/theme`.

---

## 1. Scope summary

In scope (this task):

- New garage Zod-typed API client method `getGarage()` calling `GET /me/garage`.
- New mutation client `addGarageSpotToCart()` calling `POST /me/garage/spots/cart`.
- Pure presentation helper `buildGarageSlots(garage)` that returns a `GarageSlot[]` list with deterministic ordering.
- New components:
  - `GarageSpotPlaceholderCard` — base dotted-border card used by Buy and Fill variants.
  - `BuySpotCard` — shows `formatBRL(purchaseOption.displayPriceCents)`, taps trigger the buy-spot flow.
  - `FillSpotCard` — empty extra slot card, routes to `/garage/new?spotId=...`.
  - `AddCarPlaceholderCard` — empty free slot card, routes to `/garage/new`.
- Updated garage list screens (`/garage/index.tsx` and `/profile/garage/index.tsx`) to render slots.
- New copy file `apps/mobile/src/copy/garage.ts` (PT-BR primary, EN scaffold under `en` key).
- Snapshot + interaction tests as detailed in §8.

Out of scope (handled in other tasks):

- Backend endpoints (TASK-B and TASK-C).
- Tier picker UI and `PremiumBadge` rendering on cars (TASK-E).
- Admin UI (TASK-F, TASK-G, TASK-H).
- Schema changes, seeds, settlement (TASK-A, TASK-C).
- Dev-fee math (already lives in API; mobile reads `displayPriceCents` directly).

## 2. Unblocking artifacts from TASK-B (what must exist before this task starts)

This task starts as soon as the following are **merged to main** and the `@ccc/shared` workspace is rebuilt (`pnpm --filter @ccc/shared build`). Endpoint runtime can still be missing — fixtures cover dev work.

Required artifacts:

1. `packages/shared/src/garage.ts` exporting:
   - `garageSpotTierSchema = z.enum(['free','extra','premium'])`
   - `garageSpotSourceSchema = z.enum(['default_free','purchase','admin_grant','premium_membership'])`
   - `garageSpotSchema` with `{ id, tier, source, carId, createdAt }`
   - `garagePurchaseOptionSchema` with `{ variantId, basePriceCents, displayPriceCents, devFeePercent, currency }`
   - `garageReadSchema` with `{ cars, spots, availableSlots, freeLimit, isUnlimited, purchaseOption }`
   - `garageCartResponseSchema` with shape `{ cartId, itemId }`.
2. `packages/shared/src/index.ts` re-exports `./garage.js`.
3. `packages/shared/src/cars.ts` extended with `tier: garageSpotTierSchema` on `carSchema`. (TASK-E owns badge rendering but the schema extension lands in TASK-B per §3 of the master plan.)
4. Mock fixtures published. Location: `packages/shared/src/test-fixtures/garage.ts` (a new file — no shared fixtures dir exists today; create one as part of TASK-B's deliverable). Exports must include:
   - `garageReadFixtureEmptyFirstRun` (1 empty free spot, `freeLimit=1`, no cars, `purchaseOption` present).
   - `garageReadFixtureFreeLimitZero` (no spots, `freeLimit=0`, only buy card surfaces).
   - `garageReadFixtureMixed` (1 filled free, 1 empty extra, `freeLimit=1`, `availableSlots=1`).
   - `garageReadFixtureAllFilled` (2 filled, `availableSlots=0`).
   - `garageReadFixtureUnlimited` (`freeLimit=null`, `isUnlimited=true`, 0 spots, 0 cars, valid `purchaseOption` present — no buy card shown because `isUnlimited` suppresses it).

If TASK-B publishes fixtures at a different path, update the import path in `src/screens/garage/__tests__/garage-slots.test.ts` accordingly and document the change in the PR description.

## 3. File structure

```
apps/mobile/
  app/(app)/
    garage/
      index.tsx                          # MODIFY — render slot-aware list
      new.tsx                            # MODIFY — accept ?spotId= query
    profile/garage/
      index.tsx                          # MODIFY — same slot-aware render
      new.tsx                            # MODIFY — accept ?spotId= query
  src/
    api/
      garage.ts                          # CREATE — getGarage(), addGarageSpotToCart()
    copy/
      garage.ts                          # CREATE — PT-BR + EN copy
    screens/garage/
      garage-slots.ts                    # CREATE — buildGarageSlots() helper
      GarageSpotPlaceholderCard.tsx      # CREATE — base dotted card
      BuySpotCard.tsx                    # CREATE — Comprar Vaga Adicional
      FillSpotCard.tsx                   # CREATE — Preencher Vaga
      AddCarPlaceholderCard.tsx          # CREATE — Adicionar Carro
      GarageListView.tsx                 # CREATE — shared list renderer
      __tests__/
        garage-slots.test.ts             # CREATE — pure helper snapshots
        BuySpotCard.test.tsx             # CREATE — interaction test
        GarageListView.viewmodel.test.ts  # CREATE — view-model snapshots per fixture
```

Why split `GarageListView.tsx` from the route files: both `/garage/index.tsx` and `/profile/garage/index.tsx` need identical rendering. A shared component avoids duplication. Route files own only the loader + screen header + the `onAddCar` / `onFillSpot` callbacks that encode route-specific navigation paths.

## 4. Component breakdown and prop contracts

### 4.1 `garage-slots.ts` (pure helper, no React)

```ts
import type { Car } from '@ccc/shared/cars';
import type { GarageReadResponse, GarageSpot, GaragePurchaseOption } from '@ccc/shared/garage';

export type GarageSlot =
  | { kind: 'filled'; car: Car; spot: GarageSpot }
  | { kind: 'empty-free'; spot: GarageSpot }
  | { kind: 'empty-extra'; spot: GarageSpot }
  | { kind: 'buy'; purchaseOption: GaragePurchaseOption };

export function buildGarageSlots(payload: GarageReadResponse): GarageSlot[];
```

Ordering rules (deterministic — important for snapshot stability):

1. Iterate `payload.spots` in `spots` array order (server sorts by `createdAt ASC` per TASK-B contract — document expectation in JSDoc).
2. For each spot:
   - If `spot.carId` is set, find the car in `payload.cars` by id. If found → push `{ kind: 'filled', car, spot }`. If not found (defensive), skip the spot.
   - If `spot.carId` is null and `spot.tier === 'free'` → push `{ kind: 'empty-free', spot }`.
   - If `spot.carId` is null and `spot.tier === 'extra'` → push `{ kind: 'empty-extra', spot }`.
   - `premium` empty spots are not auto-allocated and not shown as fill cards in MVP (per master plan §3 "Premium empties never auto-allocated"). Skip them in MVP.
3. After the loop, append a buy card iff `!payload.isUnlimited && payload.availableSlots === 0`. `purchaseOption` is non-nullable so it cannot serve as a sentinel; use `isUnlimited` instead. The invariant matches master plan §4: "When all spots are filled, a final placeholder card 'Comprar Vaga Adicional' appears."
4. First-run with `freeLimit=0` produces zero spots → step 1 yields nothing → step 3 appends the buy card (assuming `isUnlimited` is false). Correct by construction.
5. Unlimited (`freeLimit=null`, `isUnlimited=true`): TASK-B sets `availableSlots=0` when unlimited (no pre-materialized empties). The helper suppresses the buy card via `!payload.isUnlimited`, not via `purchaseOption`. The unlimited fixture MUST include a valid `purchaseOption`; the schema is non-nullable.

Tie-breaking: in MVP the server is the source of truth on order. The helper does no resorting.

### 4.2 `GarageSpotPlaceholderCard.tsx`

Base card shared by Buy/Fill/Add variants. Owns the dotted-border style and the standard hit target.

```tsx
type Props = {
  title: string;
  subtitle?: string;
  priceLabel?: string; // e.g. formatBRL(displayPriceCents)
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
};
```

Style (locked into the component, no theming knobs in MVP):

- `borderStyle: 'dashed'`
- `borderWidth: 1`
- `borderColor: theme.colors.muted`
- `borderRadius: theme.radii.md`
- `padding: theme.spacing.lg`
- `minHeight: 88` (matches the existing filled `card` height to keep the list visually balanced)
- `gap: theme.spacing.xs`
- Title: `color: theme.colors.fg`, `fontSize: theme.font.size.md`, `fontWeight: '600'`
- Subtitle: `color: theme.colors.muted`, `fontSize: theme.font.size.sm`
- Price label: `color: theme.colors.fg`, `fontSize: theme.font.size.md`, `fontWeight: '700'`
- Pressed feedback: `opacity: 0.6` via `Pressable`'s `style` callback.
- Disabled feedback: `opacity: 0.4`, `accessibilityState: { disabled: true }`.

### 4.3 `AddCarPlaceholderCard.tsx`

```tsx
type Props = { onPress: () => void };
```

Renders `GarageSpotPlaceholderCard` with:

- `title = copy.garage.addCarTitle` (PT-BR: "Adicionar Carro")
- `subtitle = copy.garage.addCarSubtitle` (PT-BR: "Use uma das suas vagas grátis")
- `accessibilityLabel = copy.garage.addCarA11yLabel`
- `accessibilityHint = copy.garage.addCarA11yHint`
- `testID = 'garage-add-car-card'`

### 4.4 `FillSpotCard.tsx`

```tsx
type Props = { spotId: string; onPress: (spotId: string) => void };
```

Renders `GarageSpotPlaceholderCard` with:

- `title = copy.garage.fillSpotTitle` (PT-BR: "Preencher Vaga")
- `subtitle = copy.garage.fillSpotSubtitle` (PT-BR: "Vaga extra disponível")
- `onPress = () => onPress(spotId)`
- `accessibilityLabel = copy.garage.fillSpotA11yLabel`
- `testID = \`garage-fill-spot-${spotId}\``

### 4.5 `BuySpotCard.tsx`

```tsx
type Props = {
  purchaseOption: GaragePurchaseOption;
  onPurchase: () => Promise<void>; // injected by the screen; performs mutation + nav
};
```

State:

- `submitting: boolean` — true while `onPurchase()` is in flight, blocks repeat taps.
- Tap handler:

```tsx
const handlePress = async () => {
  if (submitting) return;
  setSubmitting(true);
  try {
    await onPurchase();
  } finally {
    setSubmitting(false);
  }
};
```

Visual contract:

- `title = copy.garage.buySpotTitle` (PT-BR: "Comprar Vaga Adicional")
- `subtitle = copy.garage.buySpotSubtitle` (PT-BR: "Vaga extra para cadastrar mais um carro")
- `priceLabel = formatBRL(purchaseOption.displayPriceCents)` — already dev-fee-inclusive (per master plan §3 `purchaseOption = { ..., displayPriceCents, devFeePercent, ... }`).
- `disabled = submitting`
- `accessibilityLabel = \`${copy.garage.buySpotTitle}, ${formatBRL(purchaseOption.displayPriceCents)}\``
- `accessibilityHint = copy.garage.buySpotA11yHint` ("Adiciona uma vaga ao carrinho")
- `testID = 'garage-buy-spot-card'`

The card does **not** know about navigation or the API call. The screen wires `onPurchase` so the card stays test-ergonomic and reusable.

### 4.6 `GarageListView.tsx`

```tsx
type Props = {
  slots: GarageSlot[];
  carDetailHref: (carId: string) => string;
  onBuySpot: () => Promise<void>;
  onAddCar: () => void;
  onFillSpot: (spotId: string) => void;
};
```

Note: `newCarHref` is NOT in this Props type. Navigation for add-car and fill-spot flows is handled by the `onAddCar` and `onFillSpot` callbacks injected by the route file. The component stays navigation-agnostic.

- Renders a `FlatList` with `keyExtractor` returning:
  - `\`filled-${slot.spot.id}\`` for filled
  - `\`empty-free-${slot.spot.id}\`` for empty-free
  - `\`empty-extra-${slot.spot.id}\`` for empty-extra
  - `'buy'` for buy
- `renderItem` switches on `slot.kind` and renders the matching card. The filled-car row keeps the existing card markup from `/garage/index.tsx` lines 47-72 unchanged so visual diff is minimal.
- `contentContainerStyle = { gap: theme.spacing.md, padding: theme.spacing.xl }`.
- When `slots.length === 0` (defensive — should never happen after backfill), render a neutral empty-state Text matching today's behavior.

### 4.7 Garage list route files

Both `app/(app)/garage/index.tsx` and `app/(app)/profile/garage/index.tsx` become thin loaders:

```tsx
const [garage, setGarage] = useState<GarageReadResponse | null>(null);
const { refresh } = useCart();

useFocusEffect(
  useCallback(() => {
    void (async () => setGarage(await getGarage()))();
  }, []),
);

const slots = useMemo(() => (garage ? buildGarageSlots(garage) : []), [garage]);

const handleBuySpot = useCallback(async () => {
  await addGarageSpotToCart();
  await refresh();
  router.push('/cart' as never);
}, [router, refresh]);
```

The `/profile/garage/index.tsx` variant passes `carDetailHref={(id) => \`/profile/garage/${id}\`}` and `onAddCar` / `onFillSpot` callbacks that push to `/profile/garage/new`. The `/garage/index.tsx` variant uses `/garage/${id}`and pushes to`/garage/new`. The existing `Button label={...add}` at the top of both screens is **removed** — the add flow now lives in the placeholder card grid. (This matches master plan §4: "First-run state ... one 'Adicionar Carro' card" — having both a top button and an Add Car card would be redundant.)

### 4.8 Garage new route files

Both `app/(app)/garage/new.tsx` and `app/(app)/profile/garage/new.tsx` extend `useLocalSearchParams` to read `spotId`:

```ts
const params = useLocalSearchParams<{ returnTo?: string; spotId?: string }>();
const returnTo = sanitizeNext(params.returnTo);
const spotId =
  typeof params.spotId === 'string' && params.spotId.length > 0 ? params.spotId : undefined;
```

Pass `spotId` through to `createCar`. The mobile API layer threads it as an optional body field. TASK-B's `POST /me/cars` schema accepts the optional `spotId`; if absent, server allocates by precedence. Even if TASK-B has not landed at the moment this task is implemented, the change is backwards-compatible (`spotId` is optional).

## 5. Fixture and mocking strategy for parallel dev

This task starts before the TASK-B endpoint is live. Three layers of indirection make this safe:

1. **Schemas:** `garageReadSchema` and friends are merged in TASK-B's schema PR. This task imports them as types only at first; runtime parse only happens once `getGarage()` is wired against the dev server.
2. **Fixtures:** TASK-B publishes fixtures at `packages/shared/src/test-fixtures/garage.ts`. Tests in this task import those fixtures directly. The fixtures double as Storybook-style examples for visual review.
3. **Dev-only mock:** A new env-gated helper at `apps/mobile/src/api/garage.ts`:

```ts
import { garageReadSchema, type GarageReadResponse } from '@ccc/shared/garage';
import { authedRequest } from './client';

const USE_MOCK = process.env.EXPO_PUBLIC_GARAGE_MOCK === '1';

export const getGarage = async (): Promise<GarageReadResponse> => {
  if (USE_MOCK) {
    const { garageReadFixtureMixed } = await import('@ccc/shared/test-fixtures/garage');
    return garageReadSchema.parse(garageReadFixtureMixed);
  }
  return authedRequest('/me/garage', garageReadSchema);
};
```

When the endpoint goes live, set `EXPO_PUBLIC_GARAGE_MOCK=0` (the default). Note: Metro does NOT tree-shake `process.env` conditional branches the way a bundler with dead-code elimination would. The mock branch and its dynamic import remain in the production bundle but the branch is never entered at runtime when the flag is `0`. Delete the mock branch (the entire `if (USE_MOCK)` block and the `USE_MOCK` constant) in a follow-up PR once TASK-B is verified in staging. Document this limitation and the cleanup step in the PR description.

## 6. Navigation flow (end-to-end)

```
/garage (or /profile/garage)
   │
   ├─ tap AddCarPlaceholderCard ──> router.push('/garage/new')        ──> back to /garage
   ├─ tap FillSpotCard(spotId)  ──> router.push('/garage/new?spotId') ──> back to /garage
   ├─ tap filled car            ──> router.push('/garage/{carId}')    (unchanged)
   └─ tap BuySpotCard           ──> await addGarageSpotToCart()
                                  ──> await useCart().refresh()
                                  ──> router.push('/cart')
```

Failure paths:

- `addGarageSpotToCart()` rejects → display a transient banner using the existing `showMessage` from `~/lib/confirm` (text: `copy.garage.buySpotFailed`). `submitting` resets to `false`. No navigation occurs.
- `getGarage()` rejects → screen shows the existing centered `ActivityIndicator` fallback; on next focus the effect retries. (Matches the current pattern: garage list does not have a retry button today; adding one is out of scope.)

## 7. Copy keys (PT-BR primary, EN scaffold)

CLAUDE.md mandates an i18n scaffold from day one. The repo has no shared locale package — copy lives per-app under `apps/mobile/src/copy/`. Use a two-level shape so future migration to a locale package is trivial.

Create `apps/mobile/src/copy/garage.ts`:

```ts
const ptBR = {
  garage: {
    listTitle: 'Garagem',
    listEmpty: 'Você ainda não tem vagas cadastradas.',

    addCarTitle: 'Adicionar Carro',
    addCarSubtitle: 'Use uma das suas vagas grátis',
    addCarA11yLabel: 'Adicionar carro a uma vaga grátis',
    addCarA11yHint: 'Abre o formulário de cadastro de carro',

    fillSpotTitle: 'Preencher Vaga',
    fillSpotSubtitle: 'Vaga extra disponível',
    fillSpotA11yLabel: 'Preencher vaga extra',
    fillSpotA11yHint: 'Abre o formulário de cadastro de carro para esta vaga',

    buySpotTitle: 'Comprar Vaga Adicional',
    buySpotSubtitle: 'Vaga extra para cadastrar mais um carro',
    buySpotA11yHint: 'Adiciona uma vaga ao carrinho',
    buySpotFailed: 'Não foi possível adicionar a vaga ao carrinho. Tente novamente.',
  },
} as const;

const en = {
  garage: {
    listTitle: 'Garage',
    listEmpty: 'You have no garage spots yet.',

    addCarTitle: 'Add Car',
    addCarSubtitle: 'Use one of your free spots',
    addCarA11yLabel: 'Add a car to a free spot',
    addCarA11yHint: 'Opens the car form',

    fillSpotTitle: 'Fill Spot',
    fillSpotSubtitle: 'Extra spot available',
    fillSpotA11yLabel: 'Fill extra garage spot',
    fillSpotA11yHint: 'Opens the car form targeting this spot',

    buySpotTitle: 'Buy Extra Spot',
    buySpotSubtitle: 'An extra spot to add another car',
    buySpotA11yHint: 'Adds a garage spot to your cart',
    buySpotFailed: 'Could not add the spot to your cart. Try again.',
  },
} as const;

export const garageCopy = ptBR;
export const garageCopyEn = en;
export type GarageCopy = typeof ptBR;
```

EN is exported but unused at runtime — it satisfies the i18n scaffold requirement and gives TASK-E or future locale work a single move target.

## 8. Test plan

The mobile workspace runs `vitest run` and supports `jsdom` via the existing `useMarketingConsentGate.test.tsx` pattern. There is no `@testing-library/react-native` and we are **not adding it**. Tests focus on:

1. Pure helper snapshots (no React).
2. View-model snapshots per fixture (no React).
3. One interaction test per card that owns behavior (`BuySpotCard`) using the existing jsdom + `react-dom/client` `act()` pattern.

### 8.1 `garage-slots.test.ts`

Covers each fixture from §2. For each fixture, `buildGarageSlots(fixture)` is snapshotted with `toMatchInlineSnapshot`. Cases:

- `empty-first-run` → 1 `empty-free` slot, no buy card.
- `free-limit-zero` → 0 empty slots, 1 `buy` slot.
- `mixed` → 1 `filled` + 1 `empty-extra`, no buy card.
- `all-filled` → 2 `filled` + 1 `buy` (because `availableSlots === 0` and `purchaseOption` is present).
- `unlimited` → 0 slots, no buy card (suppressed by `isUnlimited=true`; fixture has valid `purchaseOption`).
- A malformed fixture where `spot.carId` references an unknown car → that spot is skipped, no crash.

### 8.2 `GarageListView.viewmodel.test.ts`

Tests the **view-model** returned by `buildGarageSlots` paired with the `keyExtractor` shape — not the React tree. The file contains no `toMatchSnapshot()` calls; it asserts structural properties directly. Named `.viewmodel.test.ts` (not `.snapshot.test.ts`) to reflect what it tests. Asserts:

- `keyExtractor` produces stable, unique keys across all fixtures.
- The buy card always sorts last when present.
- An `empty-free` slot's `spotId` is preserved unchanged (used by `FillSpotCard` even though it routes to a different path — defensive coverage).

### 8.3 `BuySpotCard.test.tsx` (interaction test)

Pattern follows `apps/mobile/src/consent/__tests__/useMarketingConsentGate.test.tsx`: jsdom environment, mount the component into a `createRoot` container, drive interactions through `act()`.

To stub the React Native primitives in jsdom, mock `react-native` to map `Pressable`, `View`, `Text`, and `ActivityIndicator` to plain `div`/`span` shims. Add a `__mocks__/react-native.ts` adjacent to the test or use `vi.mock('react-native', ...)` inline. The existing test does not need RN mocks because it imports a hook, not RN components — this test does need them. Inline form:

```ts
vi.mock('react-native', () => {
  const React = require('react');
  const make = (tag: string) =>
    React.forwardRef((props: any, ref: any) => React.createElement(tag, { ...props, ref }));
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ActivityIndicator: make('span'),
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
  };
});
```

Test cases:

- **tap triggers onPurchase and only resolves once** — render with `onPurchase = vi.fn().mockResolvedValue(undefined)`. Simulate two synchronous `click` events on the button (both within the same `act`). Assert `onPurchase` called exactly once. (The `submitting` guard prevents the second call.)
- **disabled state while submitting** — `onPurchase = vi.fn(() => new Promise(...))` that does not resolve. After one click, the button has `aria-disabled="true"` or `disabled` attribute and a second click does not increment the call count.
- **success path: `onPurchase` resolves cleanly** — assert no exception, `submitting` returns to `false`, button re-enables.
- **failure path: `onPurchase` rejects** — wrap the call in a `.catch(() => {})` (component swallows nothing internally — see §4.5; the screen owns the error UX). Assert the button re-enables after the rejection (`submitting` reset in `finally`).
- **accessibility label includes price** — query the rendered button by `aria-label` and assert it includes `R$` and the formatted amount (e.g. `R$ 50,00`).

### 8.4 Optional smoke: list-screen integration test

If schedule allows, add `garage-list-integration.test.tsx` that:

1. Mocks `~/api/garage` to return `garageReadFixtureAllFilled`.
2. Mocks `~/cart/context` to expose a spy `refresh`.
3. Mocks `expo-router` `useRouter` to expose a spy `push`.
4. Renders `GarageListView` directly (skip the route file to avoid mocking `useFocusEffect`).
5. Locates the buy card via its `testID`, clicks it, asserts `addGarageSpotToCart` then `refresh` then `router.push('/cart')` were called in that order.

This is **nice-to-have**, not a gate. If RN-in-jsdom proves flaky, defer to manual QA captured in §10.

### 8.5 Manual QA checklist (executed at PR time)

- iOS simulator + Android emulator: each fixture rendered via the `EXPO_PUBLIC_GARAGE_MOCK=1` flag, then the live endpoint once TASK-B lands.
- Buy-spot tap with poor network: shows banner, no double-charge (server enforces dedup per master plan §3 idempotency).
- Hit target on each card ≥ 48dp tall (`minHeight: 88` plus `padding: theme.spacing.lg` yields >48dp).
- VoiceOver/TalkBack reads label + hint.

## 9. Accessibility notes

- All placeholder cards expose `accessibilityRole="button"`, an `accessibilityLabel`, and an `accessibilityHint` distinct from the label.
- `BuySpotCard.accessibilityLabel` includes the formatted price so screen-reader users hear the cost before activating.
- Disabled buy card sets `accessibilityState={{ disabled: true }}`.
- `Pressable` `hitSlop={8}` is **not** used because the card's own padding already satisfies the 44dp/48dp minimum (iOS/Android). Verify in manual QA.
- Color tokens (`theme.colors.muted` on `theme.colors.bg`) need a contrast check. The current muted token (#8A8A93) on bg (#0B0B0F) measures ≈4.6:1, which clears WCAG AA for non-text borders but is borderline for the subtitle text. If QA flags it, lift subtitle color to `theme.colors.fg` in `BuySpotCard` and `FillSpotCard`. Document the change inline.
- Tab order: `FlatList` items are focusable in render order. The buy card lives last, matching the visual order.

## 10. Risks and open questions

- **Fixture path drift.** TASK-B's fixture file path is documented in §2 but may shift. If TASK-B ships fixtures under a different path or names, update §2 and the imports — do not invent new fixtures here.
- **RN-in-jsdom mocks.** The `vi.mock('react-native', ...)` shim in §8.3 is the load-bearing trick. If a downstream React Native version changes the import shape (e.g. ESM-only), the mock needs to follow. Mitigate by keeping the shim local to the one test file that needs it.
- **`/garage` vs `/profile/garage` divergence.** Two route trees serve the garage today. Both must be updated symmetrically. The shared `GarageListView` component reduces drift to two thin route files. If a future refactor consolidates routes, both deletions land together.
- **Premium empty spots.** The helper skips empty premium spots in MVP per master plan §3. If TASK-E re-introduces a premium fill card, extend `GarageSlot` with `{ kind: 'empty-premium', spot }` and handle it explicitly — do not silently include it in `empty-extra`.
- **`availableSlots` for unlimited.** TASK-B contract confirmed: `availableSlots=0` when `isUnlimited=true`. `garage-slots.ts` uses `!payload.isUnlimited && payload.availableSlots === 0` for the buy-card condition.
- **Re-fetch after buy.** This task calls `useCart().refresh()` after the mutation. It does **not** re-fetch `/me/garage` — the spot only exists after webhook settlement, not at cart-add time. Confirm in TASK-C that returning to `/garage` after settlement triggers a refetch (the route uses `useFocusEffect`, so navigating away and back will refresh). No bug, but worth flagging during cross-task review.
- **Top-of-list Add button removed.** §4.7 removes the existing top-level "Adicionar carro" `Button` from both screens. This is a UX change. If product wants both surfaces, restore the top button and have it route to `/garage/new` — `AddCarPlaceholderCard` stays in the grid for first-run.
- **CROSS-TASK NOTE (TASK-E §14 file target).** TASK-E §14 currently says to add `PremiumBadge` inside `cardText` in `apps/mobile/app/(app)/garage/index.tsx`. TASK-D moves that card markup into `GarageListView.tsx`. TASK-E must target `apps/mobile/src/screens/garage/GarageListView.tsx` (inside the `'filled'` branch of `renderItem`) instead. TASK-E is locked and cannot be edited here; flag this in the TASK-D PR description and in the TASK-E code-review comment so the TASK-E implementer applies the badge in the correct file.
- **`+` icon in placeholder cards (open question).** Master plan §1 mentions the dotted-border placeholder card but does not specify a `+` icon. `AddCarPlaceholderCard` currently renders title + subtitle text only. Confirm with product whether a `+` icon (e.g. from `lucide-react-native`) is required before implementation. Default: no icon in MVP unless product confirms otherwise.

---

## 11. Task breakdown (TDD, bite-sized)

> Branch from fresh `main` per CLAUDE.md. Branch name suggestion: `feat/jdma-XXX-mobile-garage-ui` (replace XXX with the TASK-D Paperclip issue id once assigned).

### Task 1: Create copy module

**Files:**

- Create: `apps/mobile/src/copy/garage.ts`

- [ ] **Step 1: Write the file with the PT-BR + EN block from §7 verbatim.**

- [ ] **Step 2: Run mobile typecheck**

```
pnpm --filter @ccc/mobile typecheck
```

Expected: PASS (file is self-contained).

- [ ] **Step 3: Commit**

```
git add apps/mobile/src/copy/garage.ts
git commit -m "feat(mobile): add garage copy module (TASK-D)"
```

### Task 2: Create garage API client

**Files:**

- Create: `apps/mobile/src/api/garage.ts`
- Test: none (covered by helper + integration tests downstream)

- [ ] **Step 1: Write the client**

```ts
import { garageReadSchema, type GarageReadResponse } from '@ccc/shared/garage';
import { garageCartResponseSchema, type GarageCartResponse } from '@ccc/shared/garage';

import { authedRequest } from './client';

const USE_MOCK = process.env.EXPO_PUBLIC_GARAGE_MOCK === '1';

export const getGarage = async (): Promise<GarageReadResponse> => {
  if (USE_MOCK) {
    const { garageReadFixtureMixed } = await import('@ccc/shared/test-fixtures/garage');
    return garageReadSchema.parse(garageReadFixtureMixed);
  }
  return authedRequest('/me/garage', garageReadSchema);
};

export const addGarageSpotToCart = (): Promise<GarageCartResponse> =>
  authedRequest('/me/garage/spots/cart', garageCartResponseSchema, {
    method: 'POST',
    body: undefined,
  });
```

- [ ] **Step 2: Rebuild shared and typecheck**

```
pnpm --filter @ccc/shared build
pnpm --filter @ccc/mobile typecheck
```

Expected: PASS. If `@ccc/shared/test-fixtures/garage` is unresolved, TASK-B has not published fixtures yet — block this task per §2.

- [ ] **Step 3: Commit**

```
git add apps/mobile/src/api/garage.ts
git commit -m "feat(mobile): add garage api client (TASK-D)"
```

### Task 3: Write failing test for buildGarageSlots

**Files:**

- Test: `apps/mobile/src/screens/garage/__tests__/garage-slots.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest';
import {
  garageReadFixtureEmptyFirstRun,
  garageReadFixtureFreeLimitZero,
  garageReadFixtureMixed,
  garageReadFixtureAllFilled,
  garageReadFixtureUnlimited,
} from '@ccc/shared/test-fixtures/garage';

import { buildGarageSlots } from '../garage-slots';

describe('buildGarageSlots', () => {
  it('first-run free → single empty-free slot, no buy card', () => {
    const slots = buildGarageSlots(garageReadFixtureEmptyFirstRun);
    expect(slots.map((s) => s.kind)).toEqual(['empty-free']);
  });

  it('freeLimit=0 → only buy card', () => {
    const slots = buildGarageSlots(garageReadFixtureFreeLimitZero);
    expect(slots.map((s) => s.kind)).toEqual(['buy']);
  });

  it('mixed → filled + empty-extra, no buy card', () => {
    const slots = buildGarageSlots(garageReadFixtureMixed);
    expect(slots.map((s) => s.kind)).toEqual(['filled', 'empty-extra']);
  });

  it('all filled with availableSlots=0 → filled rows + buy card last', () => {
    const slots = buildGarageSlots(garageReadFixtureAllFilled);
    const kinds = slots.map((s) => s.kind);
    expect(kinds[kinds.length - 1]).toBe('buy');
    expect(kinds.filter((k) => k === 'filled').length).toBeGreaterThan(0);
  });

  it('unlimited with no cars → no slots (isUnlimited suppresses buy card)', () => {
    // garageReadFixtureUnlimited has isUnlimited=true and a valid purchaseOption.
    // The buy card is suppressed by isUnlimited, not by a null purchaseOption.
    const slots = buildGarageSlots(garageReadFixtureUnlimited);
    expect(slots).toEqual([]);
  });

  it('orphan spot.carId is skipped, not crashing', () => {
    const slots = buildGarageSlots({
      ...garageReadFixtureMixed,
      cars: [], // strip cars but keep spots referencing them
    });
    // The filled spot becomes effectively orphaned → skipped.
    expect(slots.every((s) => s.kind !== 'filled')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```
pnpm --filter @ccc/mobile test garage-slots.test.ts
```

Expected: FAIL with "Cannot find module '../garage-slots'".

### Task 4: Implement buildGarageSlots

**Files:**

- Create: `apps/mobile/src/screens/garage/garage-slots.ts`

- [ ] **Step 1: Write the implementation per §4.1**

```ts
import type { Car } from '@ccc/shared/cars';
import type { GarageReadResponse, GarageSpot, GaragePurchaseOption } from '@ccc/shared/garage';

export type GarageSlot =
  | { kind: 'filled'; car: Car; spot: GarageSpot }
  | { kind: 'empty-free'; spot: GarageSpot }
  | { kind: 'empty-extra'; spot: GarageSpot }
  | { kind: 'buy'; purchaseOption: GaragePurchaseOption };

/**
 * Converts a GarageReadResponse into a deterministic list of slots
 * suitable for FlatList rendering. Server is the source of truth for
 * ordering — this helper never resorts payload.spots.
 */
export function buildGarageSlots(payload: GarageReadResponse): GarageSlot[] {
  const carsById = new Map(payload.cars.map((c) => [c.id, c]));
  const slots: GarageSlot[] = [];

  for (const spot of payload.spots) {
    if (spot.carId !== null) {
      const car = carsById.get(spot.carId);
      if (!car) continue; // orphan defense
      slots.push({ kind: 'filled', car, spot });
      continue;
    }
    if (spot.tier === 'free') {
      slots.push({ kind: 'empty-free', spot });
      continue;
    }
    if (spot.tier === 'extra') {
      slots.push({ kind: 'empty-extra', spot });
      continue;
    }
    // premium empty spots are not surfaced as fill cards in MVP
  }

  if (!payload.isUnlimited && payload.availableSlots === 0) {
    slots.push({ kind: 'buy', purchaseOption: payload.purchaseOption });
  }

  return slots;
}
```

- [ ] **Step 2: Run the test, confirm it passes**

```
pnpm --filter @ccc/mobile test garage-slots.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```
git add apps/mobile/src/screens/garage/garage-slots.ts \
        apps/mobile/src/screens/garage/__tests__/garage-slots.test.ts
git commit -m "feat(mobile): add buildGarageSlots helper (TASK-D)"
```

### Task 5: Create GarageSpotPlaceholderCard

**Files:**

- Create: `apps/mobile/src/screens/garage/GarageSpotPlaceholderCard.tsx`

- [ ] **Step 1: Write the component per §4.2**

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '~/theme';

type Props = {
  title: string;
  subtitle?: string;
  priceLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
};

export function GarageSpotPlaceholderCard({
  title,
  subtitle,
  priceLabel,
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID={testID}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {priceLabel ? <Text style={styles.price}>{priceLabel}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: theme.colors.muted,
    borderRadius: theme.radii.md,
    padding: theme.spacing.lg,
    minHeight: 88,
    justifyContent: 'center',
  },
  content: { gap: theme.spacing.xs },
  title: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  subtitle: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  price: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '700' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @ccc/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```
git add apps/mobile/src/screens/garage/GarageSpotPlaceholderCard.tsx
git commit -m "feat(mobile): add GarageSpotPlaceholderCard (TASK-D)"
```

### Task 6: Create AddCarPlaceholderCard

**Files:**

- Create: `apps/mobile/src/screens/garage/AddCarPlaceholderCard.tsx`

- [ ] **Step 1: Write the component per §4.3**

```tsx
import { garageCopy } from '~/copy/garage';

import { GarageSpotPlaceholderCard } from './GarageSpotPlaceholderCard';

type Props = { onPress: () => void };

export function AddCarPlaceholderCard({ onPress }: Props) {
  return (
    <GarageSpotPlaceholderCard
      title={garageCopy.garage.addCarTitle}
      subtitle={garageCopy.garage.addCarSubtitle}
      onPress={onPress}
      accessibilityLabel={garageCopy.garage.addCarA11yLabel}
      accessibilityHint={garageCopy.garage.addCarA11yHint}
      testID="garage-add-car-card"
    />
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @ccc/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```
git add apps/mobile/src/screens/garage/AddCarPlaceholderCard.tsx
git commit -m "feat(mobile): add AddCarPlaceholderCard (TASK-D)"
```

### Task 7: Create FillSpotCard

**Files:**

- Create: `apps/mobile/src/screens/garage/FillSpotCard.tsx`

- [ ] **Step 1: Write the component per §4.4**

```tsx
import { garageCopy } from '~/copy/garage';

import { GarageSpotPlaceholderCard } from './GarageSpotPlaceholderCard';

type Props = { spotId: string; onPress: (spotId: string) => void };

export function FillSpotCard({ spotId, onPress }: Props) {
  return (
    <GarageSpotPlaceholderCard
      title={garageCopy.garage.fillSpotTitle}
      subtitle={garageCopy.garage.fillSpotSubtitle}
      onPress={() => onPress(spotId)}
      accessibilityLabel={garageCopy.garage.fillSpotA11yLabel}
      accessibilityHint={garageCopy.garage.fillSpotA11yHint}
      testID={`garage-fill-spot-${spotId}`}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @ccc/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```
git add apps/mobile/src/screens/garage/FillSpotCard.tsx
git commit -m "feat(mobile): add FillSpotCard (TASK-D)"
```

### Task 8: Write failing test for BuySpotCard

**Files:**

- Test: `apps/mobile/src/screens/garage/__tests__/BuySpotCard.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('react-native', () => {
  const ReactMod = require('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: any, ref: any) => ReactMod.createElement(tag, { ...props, ref }));
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ActivityIndicator: make('span'),
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
  };
});

import { BuySpotCard } from '../BuySpotCard';

const fixture = {
  variantId: 'var_garage',
  basePriceCents: 5000,
  displayPriceCents: 5500,
  devFeePercent: 10,
  currency: 'BRL' as const,
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('BuySpotCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it('calls onPurchase exactly once on tap', async () => {
    const onPurchase = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(<BuySpotCard purchaseOption={fixture} onPurchase={onPurchase} />);
      await flush();
    });

    const btn = container.querySelector('button')!;
    await act(async () => {
      btn.click();
      btn.click(); // second click should be ignored while submitting
      await flush();
    });

    expect(onPurchase).toHaveBeenCalledTimes(1);
  });

  it('disables the button while submitting', async () => {
    let resolve!: () => void;
    const onPurchase = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );

    await act(async () => {
      root.render(<BuySpotCard purchaseOption={fixture} onPurchase={onPurchase} />);
      await flush();
    });

    const btn = container.querySelector('button')!;
    await act(async () => {
      btn.click();
      await flush();
    });

    expect(btn.hasAttribute('disabled')).toBe(true);

    await act(async () => {
      resolve();
      await flush();
    });
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('re-enables after onPurchase rejects', async () => {
    const onPurchase = vi.fn().mockRejectedValue(new Error('network'));

    await act(async () => {
      root.render(<BuySpotCard purchaseOption={fixture} onPurchase={onPurchase} />);
      await flush();
    });

    const btn = container.querySelector('button')!;
    await act(async () => {
      try {
        btn.click();
      } catch {
        // no-op
      }
      await flush();
    });

    expect(btn.hasAttribute('disabled')).toBe(false);
    expect(onPurchase).toHaveBeenCalledTimes(1);
  });

  it('accessibility label includes formatted price', async () => {
    const onPurchase = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(<BuySpotCard purchaseOption={fixture} onPurchase={onPurchase} />);
      await flush();
    });

    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('accessibilityLabel') ?? '').toMatch(/R\$.*55,00/);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```
pnpm --filter @ccc/mobile test BuySpotCard.test.tsx
```

Expected: FAIL with "Cannot find module '../BuySpotCard'".

### Task 9: Implement BuySpotCard

**Files:**

- Create: `apps/mobile/src/screens/garage/BuySpotCard.tsx`

- [ ] **Step 1: Write the component per §4.5**

```tsx
import type { GaragePurchaseOption } from '@ccc/shared/garage';
import { useState } from 'react';

import { garageCopy } from '~/copy/garage';
import { formatBRL } from '~/lib/format';

import { GarageSpotPlaceholderCard } from './GarageSpotPlaceholderCard';

type Props = {
  purchaseOption: GaragePurchaseOption;
  onPurchase: () => Promise<void>;
};

export function BuySpotCard({ purchaseOption, onPurchase }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const priceLabel = formatBRL(purchaseOption.displayPriceCents);

  const handlePress = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onPurchase();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GarageSpotPlaceholderCard
      title={garageCopy.garage.buySpotTitle}
      subtitle={garageCopy.garage.buySpotSubtitle}
      priceLabel={priceLabel}
      onPress={() => void handlePress()}
      disabled={submitting}
      accessibilityLabel={`${garageCopy.garage.buySpotTitle}, ${priceLabel}`}
      accessibilityHint={garageCopy.garage.buySpotA11yHint}
      testID="garage-buy-spot-card"
    />
  );
}
```

- [ ] **Step 2: Run the test, confirm it passes**

```
pnpm --filter @ccc/mobile test BuySpotCard.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```
git add apps/mobile/src/screens/garage/BuySpotCard.tsx \
        apps/mobile/src/screens/garage/__tests__/BuySpotCard.test.tsx
git commit -m "feat(mobile): add BuySpotCard (TASK-D)"
```

### Task 10: Add view-model snapshot test

**Files:**

- Test: `apps/mobile/src/screens/garage/__tests__/GarageListView.viewmodel.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest';
import {
  garageReadFixtureEmptyFirstRun,
  garageReadFixtureFreeLimitZero,
  garageReadFixtureMixed,
  garageReadFixtureAllFilled,
} from '@ccc/shared/test-fixtures/garage';

import { buildGarageSlots, type GarageSlot } from '../garage-slots';

function keyOf(slot: GarageSlot): string {
  switch (slot.kind) {
    case 'filled':
      return `filled-${slot.spot.id}`;
    case 'empty-free':
      return `empty-free-${slot.spot.id}`;
    case 'empty-extra':
      return `empty-extra-${slot.spot.id}`;
    case 'buy':
      return 'buy';
  }
}

describe('GarageListView view-model', () => {
  it('keys are unique across all fixtures', () => {
    const fixtures = [
      garageReadFixtureEmptyFirstRun,
      garageReadFixtureFreeLimitZero,
      garageReadFixtureMixed,
      garageReadFixtureAllFilled,
    ];
    for (const f of fixtures) {
      const keys = buildGarageSlots(f).map(keyOf);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('buy card sorts last when present', () => {
    const slots = buildGarageSlots(garageReadFixtureAllFilled);
    expect(slots[slots.length - 1].kind).toBe('buy');
  });

  it('empty-extra preserves spot id', () => {
    const slots = buildGarageSlots(garageReadFixtureMixed);
    const extras = slots.filter(
      (s): s is Extract<GarageSlot, { kind: 'empty-extra' }> => s.kind === 'empty-extra',
    );
    expect(extras.length).toBeGreaterThan(0);
    for (const s of extras) {
      expect(typeof s.spot.id).toBe('string');
      expect(s.spot.id.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test, confirm it passes**

```
pnpm --filter @ccc/mobile test GarageListView.viewmodel.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```
git add apps/mobile/src/screens/garage/__tests__/GarageListView.viewmodel.test.ts
git commit -m "test(mobile): view-model snapshot for garage list (TASK-D)"
```

### Task 11: Create GarageListView component

**Files:**

- Create: `apps/mobile/src/screens/garage/GarageListView.tsx`

- [ ] **Step 1: Write the component per §4.6**

```tsx
import { Link } from 'expo-router';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '~/theme';

import { AddCarPlaceholderCard } from './AddCarPlaceholderCard';
import { BuySpotCard } from './BuySpotCard';
import { FillSpotCard } from './FillSpotCard';
import type { GarageSlot } from './garage-slots';

type Props = {
  slots: GarageSlot[];
  carDetailHref: (carId: string) => string;
  onBuySpot: () => Promise<void>;
  onAddCar: () => void;
  onFillSpot: (spotId: string) => void;
};

function keyOf(slot: GarageSlot): string {
  switch (slot.kind) {
    case 'filled':
      return `filled-${slot.spot.id}`;
    case 'empty-free':
      return `empty-free-${slot.spot.id}`;
    case 'empty-extra':
      return `empty-extra-${slot.spot.id}`;
    case 'buy':
      return 'buy';
  }
}

export function GarageListView({ slots, carDetailHref, onBuySpot, onAddCar, onFillSpot }: Props) {
  return (
    <FlatList
      data={slots}
      keyExtractor={keyOf}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        if (item.kind === 'filled') {
          const car = item.car;
          return (
            <Link href={carDetailHref(car.id) as never} asChild>
              <Pressable
                style={styles.card}
                accessibilityRole="link"
                accessibilityLabel={`${car.year} ${car.make} ${car.model}${car.nickname ? `, ${car.nickname}` : ''}`}
                accessibilityHint="Abre os detalhes do carro"
              >
                {car.photos[0] ? (
                  <Image
                    source={{ uri: car.photos[0].url }}
                    style={styles.thumb}
                    accessible={false}
                  />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]} />
                )}
                <View style={styles.cardText}>
                  <Text style={styles.title}>
                    {car.year} {car.make} {car.model}
                  </Text>
                  {car.nickname ? <Text style={styles.sub}>{car.nickname}</Text> : null}
                </View>
              </Pressable>
            </Link>
          );
        }
        if (item.kind === 'empty-free') {
          return <AddCarPlaceholderCard onPress={onAddCar} />;
        }
        if (item.kind === 'empty-extra') {
          return <FillSpotCard spotId={item.spot.id} onPress={onFillSpot} />;
        }
        return <BuySpotCard purchaseOption={item.purchaseOption} onPurchase={onBuySpot} />;
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { gap: theme.spacing.md, padding: theme.spacing.xl },
  card: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.border,
    borderRadius: theme.radii.md,
  },
  cardText: { flex: 1 },
  thumb: { width: 64, height: 64, borderRadius: theme.radii.sm },
  thumbPlaceholder: { backgroundColor: theme.colors.muted },
  title: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  sub: { color: theme.colors.muted },
});
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @ccc/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```
git add apps/mobile/src/screens/garage/GarageListView.tsx
git commit -m "feat(mobile): add GarageListView (TASK-D)"
```

### Task 12: Wire `/garage/index.tsx` to GarageListView

**Files:**

- Modify: `apps/mobile/app/(app)/garage/index.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import type { GarageReadResponse } from '@ccc/shared/garage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { addGarageSpotToCart, getGarage } from '~/api/garage';
import { useCart } from '~/cart/context';
import { garageCopy } from '~/copy/garage';
import { showMessage } from '~/lib/confirm';
import { theme } from '~/theme';

import { GarageListView } from '~/screens/garage/GarageListView';
import { buildGarageSlots } from '~/screens/garage/garage-slots';

export default function GarageIndex() {
  const router = useRouter();
  const { refresh } = useCart();
  const [garage, setGarage] = useState<GarageReadResponse | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => setGarage(await getGarage()))();
    }, []),
  );

  const slots = useMemo(() => (garage ? buildGarageSlots(garage) : []), [garage]);

  const handleBuySpot = useCallback(async () => {
    try {
      await addGarageSpotToCart();
      await refresh();
      router.push('/cart' as never);
    } catch {
      showMessage(garageCopy.garage.buySpotFailed);
    }
  }, [router, refresh]);

  const handleAddCar = useCallback(() => {
    router.push('/garage/new' as never);
  }, [router]);

  const handleFillSpot = useCallback(
    (spotId: string) => {
      router.push({ pathname: '/garage/new', params: { spotId } } as never);
    },
    [router],
  );

  if (!garage) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GarageListView
        slots={slots}
        carDetailHref={(id) => `/garage/${id}`}
        onBuySpot={handleBuySpot}
        onAddCar={handleAddCar}
        onFillSpot={handleFillSpot}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
});
```

- [ ] **Step 2: Typecheck + lint + tests**

```
pnpm --filter @ccc/mobile typecheck
pnpm --filter @ccc/mobile lint
pnpm --filter @ccc/mobile test
```

Expected: PASS for all three.

- [ ] **Step 3: Commit**

```
git add apps/mobile/app/(app)/garage/index.tsx
git commit -m "feat(mobile): wire /garage index to GarageListView (TASK-D)"
```

### Task 13: Wire `/profile/garage/index.tsx` to GarageListView

**Files:**

- Modify: `apps/mobile/app/(app)/profile/garage/index.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import type { GarageReadResponse } from '@ccc/shared/garage';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { addGarageSpotToCart, getGarage } from '~/api/garage';
import { useCart } from '~/cart/context';
import { garageCopy } from '~/copy/garage';
import { showMessage } from '~/lib/confirm';
import { theme } from '~/theme';

import { GarageListView } from '~/screens/garage/GarageListView';
import { buildGarageSlots } from '~/screens/garage/garage-slots';

export default function ProfileGarageIndex() {
  const router = useRouter();
  const { refresh } = useCart();
  const [garage, setGarage] = useState<GarageReadResponse | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => setGarage(await getGarage()))();
    }, []),
  );

  const slots = useMemo(() => (garage ? buildGarageSlots(garage) : []), [garage]);

  const handleBuySpot = useCallback(async () => {
    try {
      await addGarageSpotToCart();
      await refresh();
      router.push('/cart' as never);
    } catch {
      showMessage(garageCopy.garage.buySpotFailed);
    }
  }, [router, refresh]);

  const handleAddCar = useCallback(() => {
    router.push('/profile/garage/new' as never);
  }, [router]);

  const handleFillSpot = useCallback(
    (spotId: string) => {
      router.push({ pathname: '/profile/garage/new', params: { spotId } } as never);
    },
    [router],
  );

  const headerLeft = useCallback(
    () => (
      <Pressable onPress={() => router.back()} hitSlop={8}>
        <ChevronLeft color="#F5F5F5" size={24} />
      </Pressable>
    ),
    [router],
  );

  if (!garage) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: garageCopy.garage.listTitle, headerLeft }} />
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: garageCopy.garage.listTitle, headerLeft }} />
      <GarageListView
        slots={slots}
        carDetailHref={(id) => `/profile/garage/${id}`}
        onBuySpot={handleBuySpot}
        onAddCar={handleAddCar}
        onFillSpot={handleFillSpot}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
});
```

- [ ] **Step 2: Typecheck + lint + tests**

```
pnpm --filter @ccc/mobile typecheck
pnpm --filter @ccc/mobile lint
pnpm --filter @ccc/mobile test
```

Expected: PASS.

- [ ] **Step 3: Commit**

```
git add apps/mobile/app/(app)/profile/garage/index.tsx
git commit -m "feat(mobile): wire /profile/garage index to GarageListView (TASK-D)"
```

### Task 14: Thread `spotId` through `/garage/new`

**Files:**

- Modify: `apps/mobile/app/(app)/garage/new.tsx`
- Modify: `apps/mobile/src/api/cars.ts`
- Modify: `apps/mobile/app/(app)/profile/garage/new.tsx`

- [ ] **Step 1: Extend `createCar` to accept an optional `spotId`**

Edit `apps/mobile/src/api/cars.ts`:

```ts
export const createCar = (input: CarInput, spotId?: string): Promise<Car> =>
  authedRequest('/me/cars', carSchema, {
    method: 'POST',
    body: { ...carInputSchema.parse(input), ...(spotId ? { spotId } : {}) },
  });
```

- [ ] **Step 2: Read `spotId` in `/garage/new.tsx` and pass it through**

In `apps/mobile/app/(app)/garage/new.tsx`, replace the `useLocalSearchParams` block and `onSave` body:

```tsx
const params = useLocalSearchParams<{ returnTo?: string; spotId?: string }>();
const returnTo = sanitizeNext(params.returnTo);
const spotId =
  typeof params.spotId === 'string' && params.spotId.length > 0 ? params.spotId : undefined;

const onSave = form.handleSubmit(async (values) => {
  const car = await createCar(values, spotId);
  if (returnTo) {
    router.replace(returnTo as never);
  } else {
    router.replace(`/garage/${car.id}` as never);
  }
});
```

- [ ] **Step 3: Same change in `/profile/garage/new.tsx`**

Mirror the change. Replace the route in the success path with `/profile/garage/${car.id}` to stay within the profile-scoped tree.

- [ ] **Step 4: Typecheck + lint + tests**

```
pnpm --filter @ccc/mobile typecheck
pnpm --filter @ccc/mobile lint
pnpm --filter @ccc/mobile test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add apps/mobile/src/api/cars.ts \
        apps/mobile/app/\(app\)/garage/new.tsx \
        apps/mobile/app/\(app\)/profile/garage/new.tsx
git commit -m "feat(mobile): thread spotId through car-create flow (TASK-D)"
```

### Task 15: Manual QA pass

- [ ] **Step 1: Run with mock fixtures**

```
EXPO_PUBLIC_GARAGE_MOCK=1 pnpm --filter @ccc/mobile start
```

Open on iOS sim + Android emulator. Walk through the five fixtures by temporarily swapping the imported fixture in `apps/mobile/src/api/garage.ts`. Confirm each card renders.

- [ ] **Step 2: Run against live API**

Unset `EXPO_PUBLIC_GARAGE_MOCK`. Confirm `getGarage()` works once TASK-B is live. Test the buy flow end to end (cart receives the line, /cart route reachable).

- [ ] **Step 3: VoiceOver and TalkBack pass**

Enable VoiceOver (iOS) and TalkBack (Android). Walk through the garage list. Confirm:

- Each card's title is read.
- Buy card includes the price in the spoken label.
- Disabled buy card during submit announces as disabled.

- [ ] **Step 4: Open PR**

```
git push -u origin <branch-name>
gh pr create --base main --title "feat(mobile): garage spot UI (TASK-D)" --body "$(cat <<'EOF'
## Summary
- New garage list UI with Add Car, Fill Spot, and Buy Spot placeholder cards.
- Renders against the new GET /me/garage payload from TASK-B.
- Tap on Buy Spot calls POST /me/garage/spots/cart then routes to /cart.

## Test plan
- [x] vitest unit + snapshot tests pass
- [ ] iOS simulator manual pass (each fixture)
- [ ] Android emulator manual pass
- [ ] VoiceOver + TalkBack readout

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 12. Self-review checklist

1. **Spec coverage:**
   - `GarageSpotPlaceholderCard` → Task 5.
   - `BuySpotCard` with dotted border and dynamic dev-fee aware price → Tasks 5+9, price from `purchaseOption.displayPriceCents`.
   - `FillSpotCard` → Task 7.
   - Copy strings in `apps/mobile/src/copy/garage.ts` → Task 1.
   - Empty `free` spot → "Adicionar Carro" routing to `/garage/new` → Task 11 + Task 12.
   - Empty `extra` spot → "Preencher Vaga" routing to `/garage/new?spotId=...` → Tasks 7, 11, 12, 14.
   - All filled → "Comprar Vaga Adicional" with tap triggering `POST /me/garage/spots/cart` then routing to `/cart` → Tasks 9, 11, 12.
   - First-run zero-cars with `freeLimit≥1` → only Add Car card → Task 4 helper + Task 3 test.
   - First-run with `freeLimit=0` → only Buy card → Task 4 helper + Task 3 test.
   - Snapshot + interaction tests → Tasks 3, 8, 10.
   - React Query / SWR pattern → §1 footnote + §4.7: the repo uses neither; this task continues with `useFocusEffect` + `useState` + `authedRequest`, matching existing code (`/garage/index.tsx`, `/profile/garage/index.tsx`).
   - Mobile client consumes `garageReadSchema` from `packages/shared` → Task 2 imports it; Task 12/13 use the parsed response.

2. **Placeholders:** none. All code blocks are complete. No "TBD", no "handle edge cases", no unreferenced names.

3. **Type consistency:**
   - `GarageSlot` shape declared in Task 4 is used identically in Tasks 10 and 11.
   - `BuySpotCard` props match between definition (Task 9) and test (Task 8).
   - `garageCopy.garage.*` keys match between Task 1 (definition) and Tasks 6, 7, 9, 12 (consumers).
   - `createCar(input, spotId?)` signature consistent between Task 14 client change and Task 14 callers.
