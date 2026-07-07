# JDMA-504 — Cart fulfillment selector (hybrid model)

## Context

Cart currently derives `requiresShipping = allowShip && !allowPickup` per item
(`apps/api/src/services/cart/index.ts:192`) then aggregates to whole-cart mode
(`apps/mobile/app/(app)/cart/index.tsx:323,346`). Products with both methods
silently default to pickup. Mixed-incompatible carts (pickup-only + ship-only)
land in a broken state with no UI warning.

## Decisions locked

| Decision                    | Choice                                                                    |
| --------------------------- | ------------------------------------------------------------------------- |
| Model                       | Hybrid C — per-product capability + cart-level user choice                |
| Mixed-incompatible cart     | Block at add time (API returns 422)                                       |
| Fulfillment state           | Client-only component state (no DB column)                                |
| Default when both available | Pickup if cart has any ticket OR user owns valid future ticket, else ship |
| Scope                       | One PR end-to-end                                                         |

Pickup feature remains gated by global `StoreSettings.eventPickupEnabled`. No
per-event toggle exists or will be added.

## Out of scope

- New `StoreSettings.shippingEnabled` flag. Shipping stays implicitly available.
- Persisting fulfillment choice across reloads.
- Splitting orders into ship + pickup.
- Admin UX cleanup of duplicate "Retirada no evento" labels.

## Implementation order

### 1. Shared schema (`packages/shared/src/cart.ts`)

Replace the single `requiresShipping` flag on the cart item product with two
explicit capability flags:

```ts
canShip: z.boolean(),
canPickup: z.boolean(),
```

Add cart-level computed field on the cart response so the client does not have
to know about the global pickup flag:

```ts
availableFulfillmentMethods: z.array(z.enum(['pickup', 'ship'])),
```

Update `packages/shared/src/store.ts` product schema similarly (replace
`requiresShipping` with `canShip`/`canPickup`).

### 2. API serialization (`apps/api/src/services/cart/index.ts:192`)

Map per item:

```ts
canShip:   item.variant.product.allowShip,
canPickup: item.variant.product.allowPickup,
```

Compute `availableFulfillmentMethods` once per cart serialization:

```
methods = []
if (everyItem.canPickup && storeSettings.eventPickupEnabled) methods.push('pickup')
if (everyItem.canShip) methods.push('ship')
```

Items with no variant (ticket-only rows) are neutral — treat as
`canShip=true,canPickup=true`.

Load `StoreSettings.eventPickupEnabled` once per serialization. Cache hit not
required for v1.

### 3. API add-time guard (`apps/api/src/routes/cart.ts` add-item handler)

Before insert, compute the candidate effective method set with the new item
included. If empty, return 422:

```
{
  code: 'CART_INCOMPATIBLE_FULFILLMENT',
  message: 'Item nao compativel com os itens ja no carrinho.',
  conflictingItemIds: [...]
}
```

Skip the guard if the candidate item is a ticket (kind != 'product').

### 4. API checkout (`apps/api/src/routes/cart.ts:458`)

Accept `fulfillmentMethod: 'pickup' | 'ship'` on the checkout request body
(zod-validated in shared schema). Server-side:

- Reject if `fulfillmentMethod` not in `availableFulfillmentMethods` for the
  cart.
- Replace existing `requiresShipping` derivation with the submitted method:
  - `ship` → require `shippingAddressId`, set order fulfillment accordingly.
  - `pickup` → require `pickupEventId`, run `validateEventPickupSelection`.

Keep backward compatibility off — this is a breaking client change, mobile
ships in the same PR.

### 5. Mobile cart screen (`apps/mobile/app/(app)/cart/index.tsx`)

Replace the global `requiresShipping` aggregation:

- Read `cart.availableFulfillmentMethods` from the cart response.
- Compute default:
  ```
  hasTicketSignal = cart.items.some(isTicket) || ownsValidFutureTicket
  default = methods.includes('pickup') && hasTicketSignal ? 'pickup'
           : methods[0]
  ```
- Track `selectedFulfillmentMethod` in component state, initialised from
  default, reconciled when `availableFulfillmentMethods` changes.
- Segmented toggle (`Retirada` | `Entrega`) only when `methods.length === 2`.
- Single-method case renders read-only label.
- Empty-methods case (defensive — should be prevented by API guard) blocks
  `Pagar` with `cartCopy.fulfillment.incompatible` message.
- Pass `selectedFulfillmentMethod` to checkout payload.

### 6. Cart presentation helpers (`apps/mobile/src/screens/cart/presentation.ts`)

Add:

```ts
export type FulfillmentMethod = 'pickup' | 'ship';

export function computeDefaultFulfillmentMethod(
  methods: FulfillmentMethod[],
  signals: { cartHasTicket: boolean; userOwnsValidFutureTicket: boolean },
): FulfillmentMethod | null;
```

Unit-test in `__tests__/presentation.test.ts`.

### 7. Copy (`apps/mobile/src/copy/cart.ts`)

Add `fulfillment` keys:

- `ship.title` `'Entrega'`
- `pickup.title` already exists
- `toggle.label` `'Como receber'`
- `incompatible` `'Itens incompativeis. Remova um deles para continuar.'`
- `addBlocked` `'Este item nao pode ser combinado com os outros do carrinho.'`

### 8. Tests

- `packages/shared/test/cart.test.ts` — zod parses new fields.
- `apps/api/test/cart/add-item.test.ts` — add-time guard 422 on mismatch.
- `apps/api/test/cart/checkout.test.ts` — fulfillmentMethod required + validated.
- `apps/api/test/store/catalog.test.ts` — product response shape.
- `apps/mobile/src/screens/cart/__tests__/presentation.test.ts` — default
  selector matrix.

### 9. Verification

- `pnpm test` at root.
- `pnpm --filter @jdm/api build && pnpm --filter @jdm/api test`.
- Mobile web preview via dev server: smoke test
  1. Cart with both-enabled product + no ticket → defaults to ship.
  2. Cart with ticket + both-enabled product → defaults to pickup.
  3. Try adding pickup-only product to a cart with ship-only product → blocked.
  4. Toggle between pickup/ship in a both-available cart → totals update,
     pickup section reveal/hide.

## Files touched (estimated)

```
packages/shared/src/cart.ts
packages/shared/src/store.ts
packages/shared/test/cart.test.ts
apps/api/src/services/cart/index.ts
apps/api/src/routes/cart.ts
apps/api/src/routes/store.ts                  (product serialization parity)
apps/api/test/cart/add-item.test.ts           (new or extended)
apps/api/test/cart/checkout.test.ts
apps/api/test/store/catalog.test.ts
apps/mobile/app/(app)/cart/index.tsx
apps/mobile/src/api/cart.ts                   (request body type)
apps/mobile/src/copy/cart.ts
apps/mobile/src/screens/cart/presentation.ts
apps/mobile/src/screens/cart/__tests__/presentation.test.ts
apps/admin/...                                (consumer of product schema, if any)
```

## Prior branches to inspect first

- `feat/jdma-358-mixed-cart` — commit `a49c9a3 feat(mobile): group mixed cart items` (+262/-95 in cart UI). Likely a partial attempt at this same problem. Read the full diff before starting to avoid re-doing rejected work.
- `feat/jdma-391-event-pickup-selector` — review-fix commit only; check the underlying PR for context.
- `feat/jdma-359-checkout-fulfillment` — empty.

Commands:

```
git log --oneline main..feat/jdma-358-mixed-cart
git show a49c9a3
git diff main..feat/jdma-391-event-pickup-selector -- 'apps/mobile/**'
```

## Handoff notes

- Branch already created: `feat/jdma-504-cart-fulfillment-selector` at `.claude/worktrees/jdma-504`.
- Open new Claude session at that path so the branch guard hook allows edits.
- Root cause of the original report (cart message "A retirada no evento esta desativada") was `StoreSettings.eventPickupEnabled=false` in the running env. User already re-enabled it. This PR addresses the deeper UX gaps surfaced by that bug.
