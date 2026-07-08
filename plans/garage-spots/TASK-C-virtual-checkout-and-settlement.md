# TASK-C: Virtual Product Checkout + Settlement Fulfillment

> ## ⚠️ POST-PIVOT NOTICE (2026-05-20)
>
> **Canonical source:** [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](../../docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md).
>
> **What changes:** Settlement creates `GarageSpot { source: 'purchase' }` — **no `tier` field**. The `GarageSpotTier` enum is dropped in TASK-B-prime; references to `tier: extra` in this plan are obsolete. Everything else in this plan is still valid: idempotency via `sourceOrderItemId @unique`, settlement-in-tx with order flip, `FulfillmentMethod=virtual` + `FulfillmentStatus=virtual_complete`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make virtual products (the garage-spot product) survive checkout without inventory reservation or shipping/pickup metadata, and have the order settlement service materialize one `GarageSpot{ source: 'purchase' }` row per paid garage `OrderItem`, idempotently, in the same transaction that flips the order to `paid`.

**Architecture:** Three surgical carve-outs for `variant.product.virtual === true` (checkout reservation skip, cart-route fulfillment-method skip, admin-activate photo/method skip), one shared `fulfillGarageSpotsForOrder(tx, orderId)` helper invoked from both the `product` and `mixed` settlement branches, and one new `FulfillmentMethod=virtual` value on garage `OrderItem`-derived order rows plus `FulfillmentStatus=virtual_complete` on the order when all items are virtual. Idempotency is structural: `GarageSpot.sourceOrderItemId` is `@unique`, so a replayed webhook hits a duplicate-key no-op.

**Tech Stack:** Fastify, Prisma 5, Postgres, vitest (real Postgres via existing `resetDatabase` helper), TypeScript end-to-end. Stripe + AbacatePay webhooks already route into `settlePaidOrder` / `issueTicketsForMixedOrder`.

**Depends on:** TASK-A (Prisma schema for `Product.virtual`, `Product.visibleInStore`, `GarageSpot`, `GarageSpotTier`, `GarageSpotSource`, `FulfillmentMethod=virtual`, `FulfillmentStatus=virtual_complete`, seed of the `garage_spot` ProductType and singleton Product+Variant). Do not start until TASK-A migrations + seed land on `main`.

**Parallel with:** TASK-B (public garage API + limit enforcement). TASK-C does **not** touch `POST /me/garage/spots/cart` or the public `/cart/items` reject — TASK-B owns those.

**Out of scope:**

- Schema additions or migrations (TASK-A).
- The `POST /me/garage/spots/cart` endpoint and the public `/cart/items` virtual+hidden reject (TASK-B).
- Admin UI carve-outs for the virtual product editor (TASK-H — UI only).
- Mobile UI (TASK-D / TASK-E).

---

## File map

| File                                                          | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Change kind |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `apps/api/src/services/cart/checkout.ts`                      | Skip inventory reservation for virtual variants; emit synthetic `fulfillmentMethod='virtual'` per line; widen `PreparedCartItem.fulfillmentMethod` union; widen the cart-level rollup so an all-virtual cart produces `fulfillmentMethod='virtual'` on the `Order` row.                                                                                                                                                                                                        | Modify      |
| `apps/api/src/services/cart/index.ts`                         | Loosen `validateProductCartItem` so virtual products do not fail on `quantityTotal/quantitySold` math; widen `computeAvailableFulfillmentMethods` so virtual product lines are ignored when computing pickup/ship intersection (and virtual-only carts return `['virtual']`).                                                                                                                                                                                                  | Modify      |
| `apps/api/src/routes/cart.ts`                                 | Treat virtual product items as non-product for the pickup/ship requirement; if every product line is virtual, skip the `FULFILLMENT_METHOD_REQUIRED` / shipping-address paths.                                                                                                                                                                                                                                                                                                 | Modify      |
| `apps/api/src/routes/admin/store/products.ts`                 | At the activate-product carve-out, skip the photo + fulfillment-method requirement when the product is virtual.                                                                                                                                                                                                                                                                                                                                                                | Modify      |
| `apps/api/src/services/orders/garage-fulfillment.ts`          | **NEW** — `fulfillGarageSpotsForOrder(tx, orderId)` shared helper: iterates `OrderItem` rows where `kind='product'` + linked variant's product is `virtual=true` + `productType.name='garage_spot'`, inserts one `GarageSpot{ tier: extra, source: purchase, sourceOrderItemId }` per row. Catches Prisma `P2002` on `sourceOrderItemId` for idempotency. Also sets `Order.fulfillmentStatus='virtual_complete'` when every `OrderItem` in the order is a virtual garage line. | Create      |
| `apps/api/src/services/orders/settle.ts`                      | In the `product` branch, after the `prisma.order.update({ status: 'paid' })`, wrap status flip + `fulfillGarageSpotsForOrder` in one `prisma.$transaction`.                                                                                                                                                                                                                                                                                                                    | Modify      |
| `apps/api/src/services/tickets/issue.ts`                      | In `issueTicketsForMixedOrder`, immediately before the existing `tx.order.update({ ... status: 'paid' ...})` (line ~483), call `fulfillGarageSpotsForOrder(tx, orderId)` inside the **same** `tx`.                                                                                                                                                                                                                                                                             | Modify      |
| `apps/api/test/orders/garage-fulfillment.test.ts`             | **NEW** — unit-ish integration tests for the helper: virtual+garage line creates one spot, replay no-ops via unique key, mixed order with a ticket line + a garage line creates one spot + one ticket, non-virtual products are ignored.                                                                                                                                                                                                                                       | Create      |
| `apps/api/test/cart/garage-checkout.test.ts`                  | **NEW** — integration tests covering the checkout carve-outs: virtual-only cart checkout returns no `FULFILLMENT_METHOD_REQUIRED`, does not bump `Variant.quantitySold`, produces an `Order` with `fulfillmentMethod='virtual'`; mixed virtual+physical cart still requires a fulfillment method for the physical line.                                                                                                                                                        | Create      |
| `apps/api/test/cart/garage-webhook-replay.test.ts`            | **NEW** — replays a paid webhook payload twice; asserts exactly one `GarageSpot` row exists with `tier=extra` and `source=purchase` linked to the `OrderItem.id`; refund regression test (refund flips `Order.status='refunded'` but spot row stays — refund-cleanup is explicitly deferred per Car_spot_plan §2).                                                                                                                                                             | Create      |
| `apps/api/test/admin/store-products-virtual-activate.test.ts` | **NEW** — admin PATCH product activate without photo/fulfillment-method succeeds when `virtual=true`, fails when `virtual=false` (regression on the existing path).                                                                                                                                                                                                                                                                                                            | Create      |

---

## Self-review checklist (run after writing tasks)

1. **Spec coverage**: every bullet from §9 TASK-C is mapped to a task — checkout bypass (Task 2), cart-route fulfillment filter (Task 3), admin activate carve-out (Task 4), settlement product branch (Task 6), tickets/issue.ts mixed branch (Task 7), transactional ordering (Task 6 + 7), idempotency (Task 5 + 8), `FulfillmentMethod=virtual` on order item / `FulfillmentStatus=virtual_complete` (Task 5 + 6), integration tests (Task 8 + 9 + 10).
2. **Placeholders**: none — every step shows real code.
3. **Type consistency**: `fulfillGarageSpotsForOrder(tx, orderId)` signature is identical in Tasks 5, 6, 7; `PreparedCartItem.fulfillmentMethod` widens to `'pickup' | 'ship' | 'virtual'` in Task 2 and is consumed the same way in Task 3.

---

## Task 1: Preflight — branch + verify TASK-A landed

**Files:**

- None (verification only)

- [ ] **Step 1: Branch from fresh main**

```bash
cd /Users/pedro/Projects/jdm-experience
git branch --show-current
# If not 'main', `git checkout main` first.
git pull --ff-only origin main
git checkout -b feat/jdma-garage-task-c-virtual-checkout
```

- [ ] **Step 2: Verify TASK-A artifacts — hard gate before any other task**

TASK-C requires all six artifacts below from TASK-A. Verify every one before proceeding. Three separate reviewers confirmed that as of the current `main`, **none** of these exist; the plan code that references them will not typecheck until they land.

Required TASK-A artifacts:

| Artifact                                        | Location                                  | Required value / existence                        |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `FulfillmentMethod.virtual` enum value          | `packages/db/prisma/schema.prisma`        | `enum FulfillmentMethod { ... virtual }`          |
| `FulfillmentStatus.virtual_complete` enum value | `packages/db/prisma/schema.prisma`        | `enum FulfillmentStatus { ... virtual_complete }` |
| `Product.virtual` column                        | `packages/db/prisma/schema.prisma`        | `virtual Boolean @default(false)`                 |
| `Product.visibleInStore` column                 | `packages/db/prisma/schema.prisma`        | `visibleInStore Boolean @default(true)`           |
| `model GarageSpot`                              | `packages/db/prisma/schema.prisma`        | model with `sourceOrderItemId @unique`            |
| Prisma client generated from the above schema   | `packages/db/node_modules/.prisma/client` | `prisma.garageSpot` resolves                      |

Verification commands:

```bash
grep -n "virtual\s*Boolean\|visibleInStore" packages/db/prisma/schema.prisma
grep -n "model GarageSpot" packages/db/prisma/schema.prisma
grep -n "virtual_complete" packages/db/prisma/schema.prisma
grep -n "virtual$" packages/db/prisma/schema.prisma  # FulfillmentMethod enum value
```

Then run the typecheck as a single binary pass/fail gate:

```bash
pnpm --filter @ccc/api tsc --noEmit
```

**If any grep returns 0 results, or if tsc reports errors for missing Prisma fields, STOP.** Do not continue to Task 2. Merge TASK-A first and re-run this preflight from Step 1.

- [ ] **Step 3: Verify seed for `garage_spot` ProductType and singleton Product**

```bash
grep -rn "garage_spot\|garage-spot" packages/db/prisma/seed*.ts packages/db/src/seed*.ts 2>/dev/null
```

Expected: at least one match showing the seed registers a ProductType named `garage_spot` and a Product with `slug='garage-spot'`, `virtual: true`, `visibleInStore: false`. If missing, **STOP**.

- [ ] **Step 4: Rebuild `@ccc/shared` and `@ccc/db` so downstream resolves the new types**

```bash
pnpm -C packages/db build
pnpm -C packages/shared build
```

Expected: both builds succeed. (Reminder per `feedback_rebuild_shared_after_schema_change` — runtime resolves `dist/`.)

- [ ] **Step 5: Run the existing cart + orders test files to confirm a green baseline**

```bash
pnpm -C apps/api test -- test/cart/checkout.test.ts test/cart/checkout-webhook.test.ts test/orders
```

Expected: all green. If anything fails on `main`, file a separate issue — do not start this work on a red baseline.

- [ ] **Step 6: Commit the empty starter (so subsequent commits diff cleanly)**

No code yet; skip commit. Proceed.

---

## Task 2: Checkout — bypass inventory reservation + emit `fulfillmentMethod='virtual'` for virtual variants

**Files:**

- Modify: `apps/api/src/services/cart/checkout.ts` (lines 16-55 include, lines 145-176 `PreparedCartItem`, lines 196-207 primary-shipping picker, lines 244-266 rollup, lines 385-460 `prepareProductCartItem`)
- Test: `apps/api/test/cart/garage-checkout.test.ts` (new — see Task 9)

- [ ] **Step 1: Write the failing checkout test scaffold**

Create `apps/api/test/cart/garage-checkout.test.ts` with one `it.todo` per behavior so vitest tracks them:

```ts
import { describe, it } from 'vitest';

describe('cart checkout — virtual garage product', () => {
  it.todo('virtual-only cart checkout does not require a fulfillment method');
  it.todo('virtual-only cart checkout does not increment Variant.quantitySold');
  it.todo('virtual-only cart order is created with fulfillmentMethod=virtual');
  it.todo('virtual-only cart order is created with fulfillmentStatus=virtual_complete');
  it.todo('mixed virtual + physical cart still requires fulfillment method for physical line');
  it.todo(
    'mixed virtual + physical cart settles physical-only fulfillmentStatus normally (unfulfilled)',
  );
});
```

Commit this stub so the next steps each fill exactly one `it` (TDD-style).

- [ ] **Step 2: Widen the `variant` include to surface `virtual` and `productType.name`**

In `apps/api/src/services/cart/checkout.ts`, the `CART_CHECKOUT_INCLUDE.items.include.variant.select.product.select` block (lines ~40-49) currently has:

```ts
product: {
  select: {
    id: true,
    title: true,
    status: true,
    currency: true,
    allowPickup: true,
    allowShip: true,
    shippingFeeCents: true,
  },
},
```

Change to:

```ts
product: {
  select: {
    id: true,
    title: true,
    status: true,
    currency: true,
    allowPickup: true,
    allowShip: true,
    shippingFeeCents: true,
    virtual: true,
    productType: { select: { name: true } },
  },
},
```

Mirror the same edit in the `CartWithItems` type alias at the top of the file (lines 16-55) so the inferred Prisma payload includes the new fields.

- [ ] **Step 3: Widen `PreparedCartItem.fulfillmentMethod` to allow `'virtual'`**

At line ~175:

```ts
fulfillmentMethod: 'pickup' | 'ship';
```

Change to:

```ts
fulfillmentMethod: 'pickup' | 'ship' | 'virtual';
```

- [ ] **Step 4: Skip the primary-shipping picker for virtual lines**

At lines 196-207, the `primaryShippingCartItemId` reducer iterates all product items. Virtual products have `shippingFeeCents=0` already, so they're naturally skipped by the `if (shippingFeeCents <= 0) return selectedId;` guard. **No change required**, but verify by reading the lines — if shippingFeeCents is `null` for virtual, the existing `?? 0` coerce keeps the guard correct.

- [ ] **Step 5: In `prepareProductCartItem`, branch on `variant.product.virtual` before reservation**

`prepareProductCartItem` body currently (lines 393-460):

```ts
if (!variant.active || variant.product.status !== 'active') {
  throw Object.assign(new Error(`variant ${variant.id} not active`), {
    code: 'VARIANT_NOT_ACTIVE',
  });
}

const sweep = await sweepExpiredOrdersForVariant(variant.id, tx);
expiredRefs.push(...sweep.expiredProviderRefs);

const reservation = await tx.variant.updateMany({
  where: { id: variant.id, quantitySold: { lte: variant.quantityTotal - item.quantity } },
  data: { quantitySold: { increment: item.quantity } },
});
if (reservation.count === 0) {
  throw Object.assign(new Error(`variant ${variant.id} sold out`), {
    code: 'VARIANT_SOLD_OUT',
    variantId: variant.id,
  });
}
```

Wrap the sweep + reservation block in an `if (!variant.product.virtual)`:

```ts
if (!variant.active || variant.product.status !== 'active') {
  throw Object.assign(new Error(`variant ${variant.id} not active`), {
    code: 'VARIANT_NOT_ACTIVE',
  });
}

if (!variant.product.virtual) {
  const sweep = await sweepExpiredOrdersForVariant(variant.id, tx);
  expiredRefs.push(...sweep.expiredProviderRefs);

  const reservation = await tx.variant.updateMany({
    where: { id: variant.id, quantitySold: { lte: variant.quantityTotal - item.quantity } },
    data: { quantitySold: { increment: item.quantity } },
  });
  if (reservation.count === 0) {
    throw Object.assign(new Error(`variant ${variant.id} sold out`), {
      code: 'VARIANT_SOLD_OUT',
      variantId: variant.id,
    });
  }
}
```

- [ ] **Step 6: Compute synthetic `fulfillmentMethod='virtual'` for virtual lines and skip shipping math**

Still inside `prepareProductCartItem`, replace the fulfillment-method selection block (lines 422-435) with:

```ts
const allowPickup = variant.product.allowPickup;
const allowShip = variant.product.allowShip;
let fulfillmentMethod: 'pickup' | 'ship' | 'virtual';
let appliedShippingCents = 0;
if (variant.product.virtual) {
  fulfillmentMethod = 'virtual';
} else if (requestedFulfillmentMethod === 'pickup' && allowPickup) {
  fulfillmentMethod = 'pickup';
} else if (requestedFulfillmentMethod === 'ship' && allowShip) {
  fulfillmentMethod = 'ship';
} else {
  // Back-compat fallback when caller did not pass an explicit method.
  fulfillmentMethod = allowShip && shippingAddressId ? 'ship' : allowPickup ? 'pickup' : 'ship';
}
if (fulfillmentMethod !== 'virtual') {
  appliedShippingCents = isPrimaryShipping ? (variant.product.shippingFeeCents ?? 0) : 0;
}
const shippingCents = fulfillmentMethod === 'ship' ? appliedShippingCents : 0;
const amountCents = variant.priceCents * item.quantity + shippingCents;
```

Then update the return object's `shippingAddressId`:

```ts
shippingAddressId: fulfillmentMethod === 'ship' ? shippingAddressId : null,
```

This is already correct because the comparison is strict.

- [ ] **Step 7: Cart-level rollup — pick `'virtual'` when every prepared item is virtual**

At lines 264-266:

```ts
const hasShippable = preparedItems.some((p) => p.fulfillmentMethod === 'ship');
const cartFulfillmentMethod = hasShippable ? 'ship' : ('pickup' as const);
const cartShippingAddressId = hasShippable ? (options.shippingAddressId ?? null) : null;
```

Replace with:

```ts
const hasShippable = preparedItems.some((p) => p.fulfillmentMethod === 'ship');
const hasPhysical = preparedItems.some(
  (p) => p.fulfillmentMethod === 'ship' || p.fulfillmentMethod === 'pickup',
);
const cartFulfillmentMethod: 'pickup' | 'ship' | 'virtual' = hasShippable
  ? 'ship'
  : hasPhysical
    ? 'pickup'
    : 'virtual';
const cartShippingAddressId = hasShippable ? (options.shippingAddressId ?? null) : null;
```

Note: `cartFulfillmentMethod` is typed as a local `'pickup' | 'ship' | 'virtual'` union here. The `tx.order.create` call at lines ~279-301 passes it directly as `fulfillmentMethod: cartFulfillmentMethod`. Once Prisma regenerates from TASK-A's schema (which adds `virtual` to the `FulfillmentMethod` enum), the Prisma client will accept the value. No extra edit is needed at the `order.create` call site.

- [ ] **Step 8: Persist `fulfillmentMethod='virtual'` on the Order row**

The existing `tx.order.create` (lines 279-301) already passes `fulfillmentMethod: cartFulfillmentMethod`. The new `'virtual'` value now flows through unchanged. **Verify** by reading the call — no edit needed if `cartFulfillmentMethod` is the only source.

Note on `PreparedCartItem.fulfillmentMethod` widening (Step 3): this is a widening of the local TypeScript type alias only. It does not write an enum value to the DB per item — `OrderItem` has no `fulfillmentMethod` column. The `'virtual'` string exists only in memory as the per-item rollup input; the persisted value is `Order.fulfillmentMethod`.

- [ ] **Step 9: Verify the file typechecks**

```bash
pnpm -C apps/api typecheck
```

Expected: no errors. The `FulfillmentMethod` enum in Prisma must already include `virtual` from TASK-A, otherwise Prisma client refuses the value.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/services/cart/checkout.ts apps/api/test/cart/garage-checkout.test.ts
git commit -m "feat(api): bypass variant reservation for virtual products in checkout (JDMA TASK-C)"
```

---

## Task 3: Cart route — skip pickup/ship requirement when all product items are virtual

**Files:**

- Modify: `apps/api/src/routes/cart.ts:497-526`
- Modify: `apps/api/src/services/cart/index.ts:200-252` (loosen `CartItemForFulfillment` shape and `computeAvailableFulfillmentMethods`)
- Test: `apps/api/test/cart/garage-checkout.test.ts` (extend stub from Task 2)

- [ ] **Step 1: Widen the shared `CartItemForFulfillment` shape with `virtual`**

`apps/api/src/services/cart/index.ts:200-204` currently:

```ts
export type CartItemForFulfillment = {
  id: string;
  kind: string;
  variant: { product: { allowShip: boolean; allowPickup: boolean } } | null;
};
```

Change to:

```ts
export type CartItemForFulfillment = {
  id: string;
  kind: string;
  variant: {
    product: { allowShip: boolean; allowPickup: boolean; virtual: boolean };
  } | null;
};
```

- [ ] **Step 2: Make `computeAvailableFulfillmentMethods` ignore virtual product items** _(apply atomically with Step 4 — see note below)_

`apps/api/src/services/cart/index.ts:238-252` currently:

```ts
export function computeAvailableFulfillmentMethods(
  items: CartItemForFulfillment[],
  context: CartFulfillmentContext,
): FulfillmentMethod[] {
  const productItems = items.filter((item) => item.kind === 'product' && !!item.variant);
  if (productItems.length === 0) return [];

  const everyCanPickup = productItems.every((item) => item.variant!.product.allowPickup);
  const everyCanShip = productItems.every((item) => item.variant!.product.allowShip);

  const methods: FulfillmentMethod[] = [];
  if (everyCanPickup && context.eventPickupEnabled) methods.push('pickup');
  if (everyCanShip) methods.push('ship');
  return methods;
}
```

Replace with:

```ts
export function computeAvailableFulfillmentMethods(
  items: CartItemForFulfillment[],
  context: CartFulfillmentContext,
): FulfillmentMethod[] {
  const productItems = items.filter((item) => item.kind === 'product' && !!item.variant);
  if (productItems.length === 0) return [];

  const physicalProductItems = productItems.filter((item) => !item.variant!.product.virtual);
  // All-virtual carts: no pickup or ship needed at all. Caller path treats this
  // as "no fulfillment method required" and the order row gets fulfillmentMethod='virtual'.
  if (physicalProductItems.length === 0) return [];

  const everyCanPickup = physicalProductItems.every((item) => item.variant!.product.allowPickup);
  const everyCanShip = physicalProductItems.every((item) => item.variant!.product.allowShip);

  const methods: FulfillmentMethod[] = [];
  if (everyCanPickup && context.eventPickupEnabled) methods.push('pickup');
  if (everyCanShip) methods.push('ship');
  return methods;
}
```

Rationale: a mixed virtual + physical cart still gates on the physical lines' allowPickup/allowShip. A pure-virtual cart returns `[]`, and the caller's `hasProductItems` branch in `routes/cart.ts` is what we change next so `[]` is no longer fatal.

> **ATOMIC PAIR: Steps 2 and 4 must be applied together in the same commit.** Step 2 changes `computeAvailableFulfillmentMethods` to return `[]` for all-virtual carts. If Step 4 has not yet renamed `hasProductItems` to `hasPhysicalProductItems` in `routes/cart.ts`, the `if (hasProductItems)` guard fires for an all-virtual cart (the cart does have items with `kind='product'`), finds `availableMethods.length === 0`, and returns `CART_INCOMPATIBLE_FULFILLMENT` — which is the wrong error. Apply both steps before running any test.

- [ ] **Step 3: Apply the same filter to `findIncompatibleProducts`**

`apps/api/src/services/cart/index.ts:206-236` currently filters by `kind === 'product'`. For virtual products to never trigger a "conflict" against incoming items, extend the existing filter:

At line 213:

```ts
const productItems = existingItems.filter(
  (item) =>
    item.kind === 'product' &&
    !!item.variant &&
    !item.variant.product.virtual &&
    (!options.excludeCartItemId || item.id !== options.excludeCartItemId),
);
```

(Inserted `!item.variant.product.virtual` line.)

Note: `!item.variant.product.virtual` compiles only after Step 1 has widened `CartItemForFulfillment.variant.product` to include `virtual: boolean`. Apply Step 1 before Step 3.

- [ ] **Step 4: Widen `routes/cart.ts` `hasProductItems` check** _(apply atomically with Step 2 — see note at end of Step 2)_

`apps/api/src/routes/cart.ts:497` currently:

```ts
const hasProductItems = cart.items.some((item) => item.kind === 'product');
```

Replace with:

```ts
const hasPhysicalProductItems = cart.items.some(
  (item) => item.kind === 'product' && item.variant && !item.variant.product.virtual,
);
```

Then update the `if (hasProductItems)` block at line 501 to `if (hasPhysicalProductItems)`. The body inside that block (lines 502-526) is unchanged.

- [ ] **Step 5: Update the `requiresShipping` predicate at line ~550-554**

Currently:

```ts
const requiresShipping =
  resolvedFulfillmentMethod === 'ship' &&
  cart.items.some(
    (item) => item.kind === 'product' && (item.variant?.product.shippingFeeCents ?? 0) > 0,
  );
```

Replace with:

```ts
const requiresShipping =
  resolvedFulfillmentMethod === 'ship' &&
  cart.items.some(
    (item) =>
      item.kind === 'product' &&
      item.variant &&
      !item.variant.product.virtual &&
      (item.variant.product.shippingFeeCents ?? 0) > 0,
  );
```

- [ ] **Step 6: Also widen the `storeDisabled` check at line ~476**

`cart.items.some((item) => item.kind === 'product')` — the storeDisabled gate should still apply to physical products only (virtual garage product is internal and not subject to store kill-switch). Change to:

```ts
if (
  cart.items.some(
    (item) => item.kind === 'product' && item.variant && !item.variant.product.virtual,
  ) &&
  (await storeDisabled())
) {
  return reply
    .status(503)
    .send({ error: 'ServiceUnavailable', message: 'store is currently disabled' });
}
```

- [ ] **Step 7: Ensure the cart include passed to `computeAvailableFulfillmentMethods` selects `virtual`**

`routes/cart.ts` uses `loadCartForCheckout`, which uses `CART_CHECKOUT_INCLUDE` from `services/cart/checkout.ts` (already widened in Task 2 Step 2). For the **other** consumer — `serializeCart` via `getActiveCart` — also widen `CART_INCLUDE_FOR_SERIALIZE` in `apps/api/src/services/cart/index.ts:58-89`:

In the `product.select` block at lines 76-83, add `virtual: true`:

```ts
product: {
  select: {
    id: true,
    slug: true,
    title: true,
    currency: true,
    allowPickup: true,
    allowShip: true,
    shippingFeeCents: true,
    virtual: true,
  },
},
```

Mirror the same in the `CartWithItems` type alias at lines 40-50.

- [ ] **Step 8: Loosen `validateProductCartItem` so virtual variants are not gated on stock math**

`apps/api/src/services/cart/index.ts:628-685`. Add `virtual: true` to the variant→product select at line 651, then guard the stock check at line 666:

```ts
const variant = await prisma.variant.findUnique({
  where: { id: variantId },
  select: {
    id: true,
    productId: true,
    priceCents: true,
    quantityTotal: true,
    quantitySold: true,
    active: true,
    product: {
      select: {
        id: true,
        status: true,
        currency: true,
        shippingFeeCents: true,
        allowShip: true,
        allowPickup: true,
        virtual: true,
      },
    },
  },
});
if (!variant) {
  throw codedError('Variant not found', 'VARIANT_NOT_FOUND', 404);
}
if (!variant.active || variant.product.status !== 'active') {
  throw codedError('Variant not available for sale', 'VARIANT_NOT_ACTIVE', 409);
}
void excludeCartItemId;

if (!variant.product.virtual) {
  const available = variant.quantityTotal - variant.quantitySold;
  if (available < input.quantity) {
    throw codedError(`Only ${available} unit(s) remaining`, 'VARIANT_SOLD_OUT', 409);
  }
}
```

Note: this function is reached only via the public `/cart/items` route. TASK-B owns the **rejection** of virtual+hidden variants there. The loosening above is defensive — it lets the internal `POST /me/garage/spots/cart` reuse the same validator without tripping the stock check. If TASK-B uses a different code path that skips this validator entirely, the loosening is still safe (it's a no-op for non-virtual products).

- [ ] **Step 9: Typecheck**

```bash
pnpm -C apps/api typecheck
```

Expected: green.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/routes/cart.ts apps/api/src/services/cart/index.ts
git commit -m "feat(api): treat virtual product lines as non-physical in cart fulfillment gates (JDMA TASK-C)"
```

---

## Task 4: Admin store products route — skip photo + fulfillment-method requirements when virtual

**Files:**

- Modify: `apps/api/src/routes/admin/store/products.ts:118-152`
- Test: `apps/api/test/admin/store-products-virtual-activate.test.ts` (new)

- [ ] **Step 1: Write the failing admin activate test**

Create `apps/api/test/admin/store-products-virtual-activate.test.ts`:

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { createAdminUser, resetDatabase, signAccessToken } from '../helpers.js';

describe('PATCH /admin/store/products/:id — virtual product activate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp(loadEnv());
  });

  afterEach(async () => {
    await app.close();
  });

  const makeProduct = async (opts: { virtual: boolean }) => {
    const pt = await prisma.productType.create({
      data: { name: opts.virtual ? 'garage_spot' : `t-${Math.random().toString(36).slice(2, 6)}` },
    });
    return prisma.product.create({
      data: {
        slug: `p-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Vaga',
        description: 'd',
        productTypeId: pt.id,
        basePriceCents: 1000,
        currency: 'BRL',
        status: 'draft',
        allowPickup: false,
        allowShip: false,
        virtual: opts.virtual,
      },
    });
  };

  it('activates a virtual product with no photos and no fulfillment method', async () => {
    const admin = await createAdminUser();
    const token = signAccessToken(admin.id, ['admin']);
    const product = await makeProduct({ virtual: true });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { status: 'active' },
    });

    expect(res.statusCode).toBe(200);
    const refreshed = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.status).toBe('active');
  });

  it('rejects activating a non-virtual product with no photos', async () => {
    const admin = await createAdminUser();
    const token = signAccessToken(admin.id, ['admin']);
    const product = await makeProduct({ virtual: false });
    // allow some fulfillment method so the failure isolates to the photo check
    await prisma.product.update({
      where: { id: product.id },
      data: { allowPickup: true },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/store/products/${product.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { status: 'active' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/photo/);
  });
});
```

Confirm the helper names (`createAdminUser`, `signAccessToken`) match `apps/api/test/helpers.ts`. If they're named differently in this repo, swap to the actual helpers — do not invent new ones.

- [ ] **Step 2: Run the new test and confirm it fails**

```bash
pnpm -C apps/api test -- test/admin/store-products-virtual-activate.test.ts
```

Expected: the first case fails because the route currently rejects activation without photo for **all** products, virtual or not.

- [ ] **Step 3: Add the virtual carve-out**

`apps/api/src/routes/admin/store/products.ts:121` currently:

```ts
if (input.status === 'active' && existing.status !== 'active') {
  const photoCount = await prisma.productPhoto.count({ where: { productId: id } });
  if (photoCount === 0) {
    return reply.status(400).send({
      error: 'BadRequest',
      message: 'product requires at least one photo to activate',
    });
  }
  const nextAllowPickup = input.allowPickup ?? existing.allowPickup;
  const nextAllowShip = input.allowShip ?? existing.allowShip;
  if (!nextAllowPickup && !nextAllowShip) {
    return reply.status(400).send({
      error: 'BadRequest',
      message: 'product requires at least one fulfillment method to activate',
    });
  }
}
```

Replace with:

```ts
if (input.status === 'active' && existing.status !== 'active') {
  if (!existing.virtual) {
    const photoCount = await prisma.productPhoto.count({ where: { productId: id } });
    if (photoCount === 0) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'product requires at least one photo to activate',
      });
    }
    const nextAllowPickup = input.allowPickup ?? existing.allowPickup;
    const nextAllowShip = input.allowShip ?? existing.allowShip;
    if (!nextAllowPickup && !nextAllowShip) {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'product requires at least one fulfillment method to activate',
      });
    }
  }
}
```

Also guard the in-place edit at line 139-152 the same way (a virtual product staying active doesn't need fulfillment method):

```ts
if (
  existing.status === 'active' &&
  !existing.virtual &&
  (input.allowPickup !== undefined || input.allowShip !== undefined)
) {
  const nextAllowPickup =
    input.allowPickup !== undefined ? input.allowPickup : existing.allowPickup;
  const nextAllowShip = input.allowShip !== undefined ? input.allowShip : existing.allowShip;
  if (!nextAllowPickup && !nextAllowShip) {
    return reply.status(400).send({
      error: 'BadRequest',
      message: 'active product must keep at least one fulfillment method',
    });
  }
}
```

- [ ] **Step 4: Rerun the admin test**

```bash
pnpm -C apps/api test -- test/admin/store-products-virtual-activate.test.ts
```

Expected: both `it` cases pass.

- [ ] **Step 5: Rerun the existing admin store products tests to confirm no regressions**

```bash
pnpm -C apps/api test -- test/admin
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/store/products.ts apps/api/test/admin/store-products-virtual-activate.test.ts
git commit -m "feat(api): skip photo+fulfillment-method requirement for virtual products in admin activate (JDMA TASK-C)"
```

---

## Task 5: New `fulfillGarageSpotsForOrder` helper (settlement core)

**Files:**

- Create: `apps/api/src/services/orders/garage-fulfillment.ts`
- Test: `apps/api/test/orders/garage-fulfillment.test.ts` (new, Task 8)

This task lays the helper used by **both** the `product` branch (Task 6) and the `mixed` branch (Task 7). The helper accepts a Prisma `TransactionClient` so callers can compose it with the existing `status='paid'` flip inside one transaction. Idempotency comes from `GarageSpot.sourceOrderItemId @unique` (defined by TASK-A) — duplicate-key violation translates to "already fulfilled, no-op".

- [ ] **Step 1: Define the helper signature and types**

Create `apps/api/src/services/orders/garage-fulfillment.ts`:

```ts
import type { Prisma } from '@prisma/client';

export const GARAGE_SPOT_PRODUCT_TYPE_NAME = 'garage_spot' as const;

export type GarageFulfillmentResult = {
  /** OrderItem.ids that produced (or already had) a GarageSpot row. */
  fulfilledOrderItemIds: string[];
  /** True when every OrderItem in the order is a virtual garage line; in that case
   *  the caller should set order.fulfillmentStatus = 'virtual_complete'. */
  orderIsAllVirtual: boolean;
};

/**
 * Iterates OrderItem rows for `orderId` and, for each row whose kind='product'
 * and whose linked variant's product is virtual + productType.name='garage_spot',
 * inserts one GarageSpot{ tier: extra, source: purchase, sourceOrderItemId }.
 *
 * Idempotent via GarageSpot.sourceOrderItemId @unique: a replayed call hits a
 * Prisma P2002 which we swallow per-row.
 *
 * Caller MUST pass a TransactionClient bound to the same tx that flips
 * Order.status to 'paid' so the spot insert and the status flip are atomic.
 */
export async function fulfillGarageSpotsForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<GarageFulfillmentResult> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { id: true, userId: true },
  });

  const items = await tx.orderItem.findMany({
    where: { orderId, kind: 'product' },
    select: {
      id: true,
      variant: {
        select: {
          product: {
            select: {
              virtual: true,
              productType: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // Count all OrderItem rows (any kind) so we can decide if the order is
  // entirely virtual. A mixed order with a ticket + a garage line is NOT all-virtual.
  const totalItemCount = await tx.orderItem.count({ where: { orderId } });

  const garageItems = items.filter(
    (it) =>
      it.variant?.product?.virtual === true &&
      it.variant.product.productType?.name === GARAGE_SPOT_PRODUCT_TYPE_NAME,
  );

  const fulfilledOrderItemIds: string[] = [];
  for (const item of garageItems) {
    try {
      await tx.garageSpot.create({
        data: {
          userId: order.userId,
          tier: 'extra',
          source: 'purchase',
          sourceOrderItemId: item.id,
          carId: null,
        },
      });
    } catch (err: unknown) {
      // Idempotency: replayed webhook hits the @unique on sourceOrderItemId.
      const code =
        err instanceof Error && 'code' in err ? (err as { code: string }).code : undefined;
      if (code !== 'P2002') throw err;
    }
    fulfilledOrderItemIds.push(item.id);
  }

  // items contains only kind='product' rows. garageItems is the virtual+garage_spot subset.
  // Comparing garageItems.length === totalItemCount is sufficient: if all items in the
  // order are virtual garage rows then totalItemCount equals garageItems.length.
  // The second clause (items.length === totalItemCount) was redundant — 'items' never
  // contains ticket or extras rows, so it cannot catch mixed orders that include tickets.
  const orderIsAllVirtual = totalItemCount > 0 && garageItems.length === totalItemCount;

  return { fulfilledOrderItemIds, orderIsAllVirtual };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/api typecheck
```

Expected: green. If `tx.garageSpot` is unknown, TASK-A's migration + Prisma client generation has not been re-run; **STOP** and re-run `pnpm -C packages/db generate`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/orders/garage-fulfillment.ts
git commit -m "feat(api): add fulfillGarageSpotsForOrder helper for settlement (JDMA TASK-C)"
```

---

## Task 6: Wire helper into the `product` branch of `settlePaidOrder`

**Files:**

- Modify: `apps/api/src/services/orders/settle.ts:43-63`
- Test: `apps/api/test/orders/garage-fulfillment.test.ts` (Task 8)

- [ ] **Step 1: Read the current `product` branch to anchor the edit**

Current code at lines 43-63 of `apps/api/src/services/orders/settle.ts`:

```ts
if (order.kind === 'product') {
  if (order.status === 'paid') {
    await assignEventPickupTicket(orderId, env);
    return { kind: order.kind };
  }
  if (order.status !== 'pending') {
    throw new OrderNotPendingError(orderId, order.status);
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'paid',
      paidAt: new Date(),
      ...(order.cartId ? {} : { providerRef }),
    },
  });

  await assignEventPickupTicket(orderId, env);
  return { kind: order.kind };
}
```

The status flip is currently a bare `prisma.order.update` — **not** inside a `$transaction`. We need to wrap the status flip + garage fulfillment + (optional) `virtual_complete` flag in one tx.

- [ ] **Step 2: Replace the product branch with a transactional block**

```ts
if (order.kind === 'product') {
  if (order.status === 'paid') {
    await assignEventPickupTicket(orderId, env);
    return { kind: order.kind };
  }
  if (order.status !== 'pending') {
    throw new OrderNotPendingError(orderId, order.status);
  }

  await prisma.$transaction(async (tx) => {
    const result = await fulfillGarageSpotsForOrder(tx, orderId);
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'paid',
        paidAt: new Date(),
        ...(order.cartId ? {} : { providerRef }),
        ...(result.orderIsAllVirtual ? { fulfillmentStatus: 'virtual_complete' } : {}),
      },
    });
  });

  await assignEventPickupTicket(orderId, env);
  return { kind: order.kind };
}
```

Add the import at the top of the file:

```ts
import { fulfillGarageSpotsForOrder } from './garage-fulfillment.js';
```

**Ordering note** (load-bearing): `fulfillGarageSpotsForOrder` runs **before** `tx.order.update({ status: 'paid' })`. The earlier `findUnique` outside the tx already confirmed `status='pending'`. Doing the fulfill first guarantees: if the spot insert throws an unexpected error (i.e. anything other than `P2002`), the status never flips. The reverse order (status flip → spot insert) would leave an order in `paid` with no spot if the second step throws — that's the failure mode we explicitly avoid.

- [ ] **Step 3: Run the existing settle/webhook tests to confirm no regression**

```bash
pnpm -C apps/api test -- test/cart/checkout-webhook.test.ts test/orders
```

Expected: green. The product branch already settled non-garage product orders correctly — the new helper is a no-op when no garage items are present (returns `fulfilledOrderItemIds: []`, `orderIsAllVirtual: false`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/orders/settle.ts
git commit -m "feat(api): fulfill garage spots in product-order settlement tx (JDMA TASK-C)"
```

---

## Task 7: Wire helper into the `mixed` branch of `issueTicketsForMixedOrder`

**Files:**

- Modify: `apps/api/src/services/tickets/issue.ts:352-490` (specifically the `tx.order.update({ status: 'paid' })` at line 483-486)

- [ ] **Step 1: Read the existing mixed branch**

In `issueTicketsForMixedOrder` (line 352-490), the `tx.order.update` at line 483-486 currently:

```ts
await tx.order.update({
  where: { id: order.id },
  data: { status: 'paid', paidAt: new Date(), ...(order.cartId ? {} : { providerRef }) },
});

return results;
```

- [ ] **Step 2: Call `fulfillGarageSpotsForOrder` inside the same `tx` immediately before the status flip**

Add the import at the top of `apps/api/src/services/tickets/issue.ts`:

```ts
import { fulfillGarageSpotsForOrder } from '../orders/garage-fulfillment.js';
```

Replace the block at line 483-486 with:

```ts
const garageResult = await fulfillGarageSpotsForOrder(tx, order.id);
await tx.order.update({
  where: { id: order.id },
  data: {
    status: 'paid',
    paidAt: new Date(),
    ...(order.cartId ? {} : { providerRef }),
    ...(garageResult.orderIsAllVirtual ? { fulfillmentStatus: 'virtual_complete' } : {}),
  },
});

return results;
```

**Ordering note** (load-bearing): same as Task 6 — fulfill before flip. A mixed order can legitimately combine a ticket line and a garage line; `orderIsAllVirtual` will be false in that case (the ticket OrderItem is `kind='ticket'`, not `kind='product'`), so `fulfillmentStatus` stays at its default `unfulfilled`. That's the right outcome: the order is partially physical (ticket pickup voucher logic still applies) and partially virtual (spot already created). We do **not** set `virtual_complete` here because the ticket side is what `assignEventPickupTicket` and downstream ticket UI care about.

- [ ] **Step 3: Verify there's no double-flip race with the existing top-of-function `paid` short-circuit**

Lines 364-376 already handle the replay case — if the order is already `paid`, the function returns the existing tickets without calling our new fulfill helper. That's fine because Task 6/7 only call the helper inside the transition path, and the helper itself is idempotent. The replay safety net for the `mixed` branch's **garage** lines is the helper's `P2002` swallow, exercised when the webhook redelivers between the `status='paid'` flip and the response.

But: the current top-of-function early-return at line 364-376 means a redelivered mixed-order webhook **never** re-enters `fulfillGarageSpotsForOrder`. If the **first** delivery succeeded the spots are already in place. If the first delivery crashed _after_ `tx.order.update` (e.g. process killed mid-transaction), Postgres rolled back, so spots and the status flip both got reverted — the next delivery re-enters the not-yet-`paid` branch and re-runs the helper.

Conclusion: no extra handling needed. The single transaction wrapping spot inserts + status flip is the load-bearing invariant.

- [ ] **Step 4: Run mixed-order tests**

```bash
pnpm -C apps/api test -- test/orders/expire-mixed.test.ts test/orders/mixed-extras-only.test.ts test/cart/checkout-webhook.test.ts
```

Expected: green. None of these tests seed garage products, so the helper short-circuits to `[]`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/tickets/issue.ts
git commit -m "feat(api): fulfill garage spots inside mixed-order settlement tx (JDMA TASK-C)"
```

---

## Transactional ordering guarantee (recap)

Both Task 6 and Task 7 establish the same invariant:

```
BEGIN tx
  fulfillGarageSpotsForOrder(tx, orderId)
    -> for each garage OrderItem: tx.garageSpot.create({ sourceOrderItemId })
       on P2002 swallow (idempotent replay)
       on any other error: throw -> tx rolls back, status stays 'pending'
  tx.order.update({ status: 'paid', fulfillmentStatus?: 'virtual_complete' })
COMMIT
```

Why fulfill **before** status flip:

1. If the spot insert throws a non-P2002 error (DB outage mid-statement, FK violation from corrupt `userId`, etc.), the tx rolls back and the order stays `pending`. The next webhook delivery retries the whole path. This is the desired failure mode.
2. If we flipped status first and then crashed before the spot insert, Postgres still rolls back the **whole tx**, so the outcome is the same — but only because we're in one `$transaction`. Outside a tx, this ordering would leak `paid` orders with no spots. The transactional boundary is the load-bearing piece, not the statement order. Keeping fulfill-first is a belt-and-suspenders convention.
3. P2002 swallow per garage line means a partial replay (helper succeeded on line A, failed on line B, retry) is safe: line A's create raises P2002, helper moves on to line B.

Idempotency proof sketch:

- Definition: `settle(orderId, providerRef)` invoked N times produces the same DB state as one invocation.
- Order status: `tx.order.update` is conditional on `status='pending'` at function entry (top-of-function `findUnique` + early-return when `status='paid'`). On replay, status is `paid`, the early-return fires, the helper is never re-entered. Property holds.
- Spot rows: even if the early-return did not exist, `GarageSpot.sourceOrderItemId @unique` ensures `tx.garageSpot.create({ sourceOrderItemId: X })` succeeds at most once. The P2002 catch turns the second attempt into a no-op. Property holds.
- Mixed orders: ticket creation has its own pre-existing replay guard (line 364-376). Garage helper sits inside the same tx, so the ticket guard's early-return also skips garage re-entry. Property holds.

## Fulfillment-status semantics

- `Order.fulfillmentStatus = 'virtual_complete'` when **every** `OrderItem` in the order is a virtual garage line (i.e. `kind='product'` + `variant.product.virtual=true` + `productType.name='garage_spot'`). Set at the same tx as `status='paid'`.
- Mixed orders (ticket + garage) keep `fulfillmentStatus='unfulfilled'` because the ticket-pickup/voucher pipeline still treats them as physical fulfilment. The garage spot is created regardless, but the order-level status communicates that there's still pickup-side work to do.
- Refund path (`apps/api/src/services/orders/cancel.ts:79`) flips `status='cancelled'` and `fulfillmentStatus='cancelled'`. We deliberately do **not** delete the corresponding `GarageSpot` row in this task — per Car_spot_plan §2 "Refund automation for purchased spots" is out-of-scope MVP. The manual recipe is `DELETE /admin/users/:id/spots/:spotId` (TASK-G). Refund regression test (Task 10) locks this in.

---

## Task 8: Integration test — `garage-fulfillment.test.ts`

**Files:**

- Create: `apps/api/test/orders/garage-fulfillment.test.ts`

Tests the helper in isolation against a real Postgres via `prisma.$transaction`.

- [ ] **Step 1: Seed helpers**

In the new test file, build a `seedGaragePaidOrder(userId)` factory that:

1. Looks up the seeded singleton `garage_spot` ProductType + Product + Variant (TASK-A guarantees they exist after `resetDatabase` re-runs the seed). If `resetDatabase` skips seeds, the helper must `prisma.productType.upsert` + `prisma.product.upsert` + `prisma.variant.upsert` to materialize them here.
2. Creates a pending Order + one OrderItem with `kind='product'`, the seeded variantId, `quantity=1`.

- [ ] **Step 2: Write tests**

```ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fulfillGarageSpotsForOrder } from '../../src/services/orders/garage-fulfillment.js';
import { createUser, resetDatabase } from '../helpers.js';

const ensureGarageProduct = async () => {
  const pt = await prisma.productType.upsert({
    where: { name: 'garage_spot' },
    update: {},
    create: { name: 'garage_spot', sortOrder: 99 },
  });
  const product = await prisma.product.upsert({
    where: { slug: 'garage-spot' },
    update: {},
    create: {
      slug: 'garage-spot',
      title: 'Vaga de Garagem Adicional',
      description: '-',
      productTypeId: pt.id,
      basePriceCents: 5000,
      currency: 'BRL',
      status: 'active',
      allowPickup: false,
      allowShip: false,
      virtual: true,
    },
  });
  const variant = await prisma.variant.findFirst({ where: { productId: product.id } });
  if (variant) return { product, variant };
  const created = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Padrão',
      priceCents: 5000,
      quantityTotal: 0,
      quantitySold: 0,
      attributes: {},
      active: true,
    },
  });
  return { product, variant: created };
};

const seedPendingGarageOrder = async (userId: string) => {
  const { variant } = await ensureGarageProduct();
  const order = await prisma.order.create({
    data: {
      userId,
      kind: 'product',
      amountCents: 5000,
      baseAmountCents: 5000,
      quantity: 1,
      method: 'card',
      provider: 'stripe',
      status: 'pending',
      currency: 'BRL',
      fulfillmentMethod: 'virtual',
      items: {
        create: {
          kind: 'product',
          variantId: variant.id,
          quantity: 1,
          unitPriceCents: 5000,
          subtotalCents: 5000,
        },
      },
    },
    include: { items: true },
  });
  return { order, orderItemId: order.items[0]!.id };
};

describe('fulfillGarageSpotsForOrder', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates one GarageSpot per garage OrderItem', async () => {
    const { user } = await createUser({ verified: true });
    const { order, orderItemId } = await seedPendingGarageOrder(user.id);

    const result = await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));

    expect(result.fulfilledOrderItemIds).toEqual([orderItemId]);
    expect(result.orderIsAllVirtual).toBe(true);

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({
      tier: 'extra',
      source: 'purchase',
      sourceOrderItemId: orderItemId,
      carId: null,
    });
  });

  it('is idempotent across replays', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedPendingGarageOrder(user.id);

    await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));
    await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
  });

  it('orderIsAllVirtual=false when the order also has a ticket OrderItem', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedPendingGarageOrder(user.id);

    const event = await prisma.event.create({
      data: {
        slug: `e-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Mixed',
        description: 'd',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'SP',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        capacity: 10,
        maxTicketsPerUser: 5,
        publishedAt: new Date(),
      },
    });
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Geral',
        priceCents: 1000,
        quantityTotal: 5,
        quantitySold: 0,
        sortOrder: 0,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        kind: 'ticket',
        eventId: event.id,
        tierId: tier.id,
        quantity: 1,
        unitPriceCents: 1000,
        subtotalCents: 1000,
      },
    });
    // Note: no order.kind mutation needed. fulfillGarageSpotsForOrder does not read
    // order.kind — it counts all OrderItems and checks whether all of them are
    // virtual garage rows. The ticket item added above is sufficient to make
    // orderIsAllVirtual=false without touching order.kind.

    const result = await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));

    expect(result.orderIsAllVirtual).toBe(false);
    expect(result.fulfilledOrderItemIds).toHaveLength(1);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
  });

  it('ignores non-virtual product OrderItems', async () => {
    const { user } = await createUser({ verified: true });

    const pt = await prisma.productType.create({
      data: { name: `phys-${Math.random().toString(36).slice(2, 6)}` },
    });
    const product = await prisma.product.create({
      data: {
        slug: `phys-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Camiseta',
        description: 'd',
        productTypeId: pt.id,
        basePriceCents: 9000,
        currency: 'BRL',
        status: 'active',
        allowPickup: true,
        virtual: false,
      },
    });
    const variant = await prisma.variant.create({
      data: {
        productId: product.id,
        name: 'M',
        priceCents: 9000,
        quantityTotal: 10,
        quantitySold: 0,
        attributes: {},
        active: true,
      },
    });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 9000,
        baseAmountCents: 9000,
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
        currency: 'BRL',
        fulfillmentMethod: 'pickup',
        items: {
          create: {
            kind: 'product',
            variantId: variant.id,
            quantity: 1,
            unitPriceCents: 9000,
            subtotalCents: 9000,
          },
        },
      },
    });

    const result = await prisma.$transaction((tx) => fulfillGarageSpotsForOrder(tx, order.id));
    expect(result.fulfilledOrderItemIds).toEqual([]);
    expect(result.orderIsAllVirtual).toBe(false);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the new test**

```bash
pnpm -C apps/api test -- test/orders/garage-fulfillment.test.ts
```

Expected: all four cases pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/orders/garage-fulfillment.test.ts
git commit -m "test(api): cover fulfillGarageSpotsForOrder helper (JDMA TASK-C)"
```

---

## Task 9: Integration test — checkout carve-outs (`garage-checkout.test.ts`)

**Files:**

- Modify (fill in stubs from Task 2 Step 1): `apps/api/test/cart/garage-checkout.test.ts`

- [ ] **Step 1: Replace the `it.todo` stubs with real assertions**

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase, signAccessToken } from '../helpers.js';

const ensureGarageProduct = async () => {
  const pt = await prisma.productType.upsert({
    where: { name: 'garage_spot' },
    update: {},
    create: { name: 'garage_spot', sortOrder: 99 },
  });
  const product = await prisma.product.upsert({
    where: { slug: 'garage-spot' },
    update: {},
    create: {
      slug: 'garage-spot',
      title: 'Vaga de Garagem Adicional',
      description: '-',
      productTypeId: pt.id,
      basePriceCents: 5000,
      currency: 'BRL',
      status: 'active',
      allowPickup: false,
      allowShip: false,
      virtual: true,
    },
  });
  let variant = await prisma.variant.findFirst({ where: { productId: product.id } });
  variant ??= await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Padrão',
      priceCents: 5000,
      quantityTotal: 0,
      quantitySold: 0,
      attributes: {},
      active: true,
    },
  });
  return { product, variant };
};

const seedOpenCartWithGarageItem = async (userId: string) => {
  const { variant } = await ensureGarageProduct();
  const cart = await prisma.cart.create({
    data: { userId, status: 'open' },
  });
  await prisma.cartItem.create({
    data: {
      cartId: cart.id,
      kind: 'product',
      variantId: variant.id,
      quantity: 1,
      amountCents: variant.priceCents,
      currency: 'BRL',
    },
  });
  return { cart, variant };
};

describe('cart checkout — virtual garage product', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp(loadEnv(), { stripe: buildFakeStripe() });
  });

  afterEach(async () => {
    await app.close();
  });

  it('virtual-only cart checkout does not require a fulfillment method', async () => {
    const { user } = await createUser({ verified: true });
    const token = signAccessToken(user.id);
    await seedOpenCartWithGarageItem(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().error).toBeUndefined();
  });

  it('virtual-only cart checkout does not increment Variant.quantitySold', async () => {
    const { user } = await createUser({ verified: true });
    const token = signAccessToken(user.id);
    const { variant } = await seedOpenCartWithGarageItem(user.id);
    const before = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });

    await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { paymentMethod: 'card' },
    });

    const after = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.quantitySold).toBe(before.quantitySold);
  });

  it('virtual-only cart order is created with fulfillmentMethod=virtual', async () => {
    const { user } = await createUser({ verified: true });
    const token = signAccessToken(user.id);
    await seedOpenCartWithGarageItem(user.id);

    await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { paymentMethod: 'card' },
    });

    const order = await prisma.order.findFirstOrThrow({ where: { userId: user.id } });
    expect(order.fulfillmentMethod).toBe('virtual');
    expect(order.fulfillmentStatus).toBe('unfulfilled'); // virtual_complete only on settle
  });

  it('mixed virtual + physical cart still requires fulfillment method for physical line', async () => {
    const { user } = await createUser({ verified: true });
    const token = signAccessToken(user.id);
    const { cart } = await seedOpenCartWithGarageItem(user.id);

    // Add a physical product
    const pt = await prisma.productType.create({
      data: { name: `t-${Math.random().toString(36).slice(2, 6)}` },
    });
    const physProduct = await prisma.product.create({
      data: {
        slug: `phys-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Camiseta',
        description: 'd',
        productTypeId: pt.id,
        basePriceCents: 9000,
        currency: 'BRL',
        status: 'active',
        allowPickup: true,
        allowShip: true,
        shippingFeeCents: 1500,
        virtual: false,
      },
    });
    const physVariant = await prisma.variant.create({
      data: {
        productId: physProduct.id,
        name: 'M',
        priceCents: 9000,
        quantityTotal: 10,
        quantitySold: 0,
        attributes: {},
        active: true,
      },
    });
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        kind: 'product',
        variantId: physVariant.id,
        quantity: 1,
        amountCents: 9000,
        currency: 'BRL',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('FULFILLMENT_METHOD_REQUIRED');
  });
});
```

- [ ] **Step 2: Run the file**

```bash
pnpm -C apps/api test -- test/cart/garage-checkout.test.ts
```

Expected: all four cases pass. If the seeded helper names differ in your `test/helpers.ts`, fix the imports — do not invent new helpers.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/cart/garage-checkout.test.ts
git commit -m "test(api): cover virtual-product checkout carve-outs (JDMA TASK-C)"
```

---

## Task 10: Integration test — webhook replay idempotency + refund regression

**Files:**

- Create: `apps/api/test/cart/garage-webhook-replay.test.ts`

- [ ] **Step 1: Build the test**

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const ensureGarageProduct = async () => {
  const pt = await prisma.productType.upsert({
    where: { name: 'garage_spot' },
    update: {},
    create: { name: 'garage_spot', sortOrder: 99 },
  });
  const product = await prisma.product.upsert({
    where: { slug: 'garage-spot' },
    update: {},
    create: {
      slug: 'garage-spot',
      title: 'Vaga',
      description: '-',
      productTypeId: pt.id,
      basePriceCents: 5000,
      currency: 'BRL',
      status: 'active',
      virtual: true,
    },
  });
  let variant = await prisma.variant.findFirst({ where: { productId: product.id } });
  variant ??= await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Padrão',
      priceCents: 5000,
      quantityTotal: 0,
      quantitySold: 0,
      attributes: {},
      active: true,
    },
  });
  return { product, variant };
};

const seedPendingGarageOrderWithCart = async (userId: string) => {
  const { variant } = await ensureGarageProduct();
  const cart = await prisma.cart.create({
    data: { userId, status: 'checking_out' },
  });
  const order = await prisma.order.create({
    data: {
      userId,
      kind: 'product',
      cartId: cart.id,
      amountCents: 5000,
      baseAmountCents: 5000,
      quantity: 1,
      method: 'card',
      provider: 'stripe',
      status: 'pending',
      currency: 'BRL',
      fulfillmentMethod: 'virtual',
      items: {
        create: {
          kind: 'product',
          variantId: variant.id,
          quantity: 1,
          unitPriceCents: 5000,
          subtotalCents: 5000,
        },
      },
    },
    include: { items: true },
  });
  return { cart, order, orderItemId: order.items[0]!.id };
};

describe('POST /stripe/webhook — garage spot fulfillment', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    stripe = buildFakeStripe();
    app = await buildApp(loadEnv(), { stripe, push: new DevPushSender() });
  });

  afterEach(async () => {
    await app.close();
  });

  it('settles a virtual-only order and creates exactly one GarageSpot', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, order, orderItemId } = await seedPendingGarageOrderWithCart(user.id);

    stripe.nextEvent = {
      id: 'evt_garage_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_garage_1',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify([order.id]),
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const settled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(settled.status).toBe('paid');
    expect(settled.fulfillmentStatus).toBe('virtual_complete');

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({
      tier: 'extra',
      source: 'purchase',
      sourceOrderItemId: orderItemId,
      carId: null,
    });
  });

  it('replayed webhook does not duplicate the GarageSpot', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, order } = await seedPendingGarageOrderWithCart(user.id);

    stripe.nextEvent = {
      id: 'evt_garage_replay',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_garage_replay',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify([order.id]),
          },
        },
      },
    };

    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(second.statusCode).toBe(200);

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
  });

  it('mixed order (ticket + garage) creates one spot and one ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { variant } = await ensureGarageProduct();

    const event = await prisma.event.create({
      data: {
        slug: `e-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Evento',
        description: 'd',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'SP',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        capacity: 10,
        maxTicketsPerUser: 5,
        publishedAt: new Date(),
      },
    });
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Geral',
        priceCents: 1000,
        quantityTotal: 5,
        quantitySold: 0,
        sortOrder: 0,
      },
    });
    const cart = await prisma.cart.create({ data: { userId: user.id, status: 'checking_out' } });
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'mixed',
        cartId: cart.id,
        amountCents: 6000,
        baseAmountCents: 6000,
        quantity: 2,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
        currency: 'BRL',
        fulfillmentMethod: 'pickup',
        items: {
          create: [
            {
              kind: 'ticket',
              eventId: event.id,
              tierId: tier.id,
              quantity: 1,
              unitPriceCents: 1000,
              subtotalCents: 1000,
            },
            {
              kind: 'product',
              variantId: variant.id,
              quantity: 1,
              unitPriceCents: 5000,
              subtotalCents: 5000,
            },
          ],
        },
      },
    });

    stripe.nextEvent = {
      id: 'evt_garage_mixed',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_garage_mixed',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify([order.id]),
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const settled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(settled.status).toBe('paid');
    expect(settled.fulfillmentStatus).toBe('unfulfilled'); // not all virtual

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(1);
  });

  it('refunding a paid garage order leaves the GarageSpot intact (manual recipe scope)', async () => {
    const { user } = await createUser({ verified: true });
    const { cart, order } = await seedPendingGarageOrderWithCart(user.id);

    // Settle first
    stripe.nextEvent = {
      id: 'evt_garage_refund_settle',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_garage_refund_settle',
          metadata: {
            cartId: cart.id,
            userId: user.id,
            orderIds: JSON.stringify([order.id]),
          },
        },
      },
    };
    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });

    // Simulate refund: mutate order status directly to assert GarageSpot durability.
    // This test does NOT exercise services/orders/cancel.ts — it only validates
    // that a status change to 'refunded' does not cascade-delete the GarageSpot row.
    // The point: GarageSpot has no cascade rule tied to Order.status; removal is
    // intentionally manual in MVP (TASK-G admin recipe).
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'refunded', refundedAt: new Date(), fulfillmentStatus: 'cancelled' },
    });

    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]?.tier).toBe('extra');
  });
});
```

- [ ] **Step 2: Run the file**

```bash
pnpm -C apps/api test -- test/cart/garage-webhook-replay.test.ts
```

Expected: all four cases pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/cart/garage-webhook-replay.test.ts
git commit -m "test(api): cover garage settlement webhook replay + refund regression (JDMA TASK-C)"
```

---

## Task 11: Full suite green

- [ ] **Step 1: Run the full API test suite**

```bash
pnpm -C apps/api test
```

Expected: all green. The carve-outs are guarded by `variant.product.virtual`; non-virtual paths are unchanged.

- [ ] **Step 1b: Grep for unhandled `fulfillmentMethod` / `fulfillmentStatus` consumers (Risk 9)**

```bash
grep -rn "fulfillmentMethod\s*===" apps/api/src/ apps/admin/ apps/mobile/ 2>/dev/null
grep -rn "fulfillmentStatus\s*===" apps/api/src/ apps/admin/ apps/mobile/ 2>/dev/null
```

Review each match. If any switch statement or exhaustive narrowing does not handle `'virtual'` or `'virtual_complete'`, fix the API-side cases in this PR. Flag cross-platform (admin/mobile) cases as follow-up items in TASK-D/TASK-H. **Do not merge if any API-side switch is unhandled.**

- [ ] **Step 2: Lint + typecheck**

```bash
pnpm -C apps/api lint
pnpm -C apps/api typecheck
```

Expected: green.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/jdma-garage-task-c-virtual-checkout
gh pr create --base main --title "feat(api): virtual product checkout + garage spot settlement fulfillment (JDMA TASK-C)" --body "$(cat <<'EOF'
## Summary
- Bypass Variant inventory reservation in cart checkout when variant.product.virtual=true; cart-level fulfillmentMethod resolves to 'virtual' for all-virtual carts.
- Skip pickup/ship requirement in cart route when no physical product line exists; skip photo+fulfillment-method requirement when activating a virtual product in admin.
- Settlement creates one GarageSpot{tier:extra, source:purchase, sourceOrderItemId} per garage OrderItem in the same transaction as the status='paid' flip, for both `product` and `mixed` orders. fulfillmentStatus='virtual_complete' is set when every OrderItem is virtual.
- Idempotency via GarageSpot.sourceOrderItemId @unique; replays no-op via P2002 swallow.

## Test plan
- [ ] `pnpm -C apps/api test -- test/orders/garage-fulfillment.test.ts`
- [ ] `pnpm -C apps/api test -- test/cart/garage-checkout.test.ts`
- [ ] `pnpm -C apps/api test -- test/cart/garage-webhook-replay.test.ts`
- [ ] `pnpm -C apps/api test -- test/admin/store-products-virtual-activate.test.ts`
- [ ] Full suite: `pnpm -C apps/api test`
- [ ] Lint: `pnpm -C apps/api lint`
- [ ] Typecheck: `pnpm -C apps/api typecheck`

Depends on TASK-A (schema). Parallel to TASK-B (public garage API).
EOF
)"
```

---

## Risks and open questions

1. **`assignEventPickupTicket` runs outside the settlement tx (pre-existing risk, not introduced by TASK-C).** This pattern existed before this task: in the `product` branch, `assignEventPickupTicket` ran after the bare `prisma.order.update`. TASK-C preserves that pattern — `assignEventPickupTicket` sits after `prisma.$transaction(...)`. For pure-garage orders `assignEventPickupTicket` is a no-op anyway (no `pickupEventId`). The residual risk applies only to hypothetical mixed product+physical orders and is the same risk that pre-existed for all product orders. Out of scope to fix here. The existing retry path (next webhook delivery sees `status='paid'`, early-return fires, `assignEventPickupTicket` is re-attempted) covers the failure mode.

2. **`OrderItem` has no `fulfillmentMethod` column.** Task description says "Set `FulfillmentMethod=virtual` on garage `OrderItem`". The schema (lines 663-687 of `schema.prisma`) only has `kind`, `variantId`, `tierId`, `extraId`, `eventId`, `quantity`, `unitPriceCents`, `subtotalCents`, `tickets`. The fulfillment method lives on `Order`. **Resolution**: we set `Order.fulfillmentMethod='virtual'` for all-virtual orders and treat the OrderItem-level "virtual" assertion as derived from `variant.product.virtual` (the source of truth). If TASK-A added a per-item column, surface it and update Task 6 to write it. **Open question: confirm with TASK-A author.**

3. **`reservationExpiresAt` on `CartItem`** is not touched by virtual products in checkout. The expiry sweep at `sweepExpiredOrdersForVariant` was the mechanism to release stale reservations; virtual products never reserve so they need no sweep. This is correct, but if a non-virtual variant ever shares an order with a virtual one, the sweep still fires per-variant for the physical lines. Verified by reading the loop in `prepareProductCartItem`.

4. **Singleton variant `quantityTotal=0`.** Cart Item creation via the public `/cart/items` route hits `validateProductCartItem`, which had a `quantityTotal - quantitySold < quantity` gate. We loosen that gate for virtual products (Task 3 Step 8). TASK-B's public-route reject is the authoritative spoof guard; this loosening is defensive for the internal `POST /me/garage/spots/cart` path.

5. **Race between two paid webhook deliveries for the same mixed order.** `issueTicketsForMixedOrder` short-circuits at line 364-376 if `status='paid'`. The garage helper sits inside the same transaction. Two concurrent webhook handlers attempting the same orderId will both enter the tx; one wins, the other sees `status='paid'` on the second read inside the tx and either returns early (current code, after our edit) or hits the P2002 catch on `sourceOrderItemId`. Verified safe.

6. **Refund automation deferred.** §2 of Car_spot_plan flags refund automation as out of scope. The refund regression test (Task 10) locks the contract: settlement is a one-way operation against `GarageSpot`. The admin recipe (`DELETE /admin/users/:id/spots/:spotId`, TASK-G) is the manual path.

7. **`storeDisabled` kill-switch — trade-off accepted.** We extended the gate to apply only to physical products, so a `storeDisabled=true` flag does not block garage-spot checkout. The emergency lever for garage-spot sales is `Product.status='draft'` on the singleton garage product.

   Trade-off to be aware of: setting `status='draft'` is caught at checkout (`VARIANT_NOT_ACTIVE`), not at cart-add. A user can add the item to their cart successfully and only see the rejection when they attempt to pay. This is worse UX than a `503` at cart-add time. Accepted for MVP: the singleton garage product is an internal SKU, not a public store listing, so ops-triggered draft flips are rare and can be communicated to in-flight users via support channels.

   If stricter UX is required later (block at cart-add instead of at checkout), scope a virtual-aware `storeDisabled` bypass that also checks `Product.status` on the singleton at cart-add time. That work belongs in TASK-H. **Flag in TASK-H.**

8. **Webhook routing for AbacatePay (Pix) — test coverage required.** AbacatePay's `transparent.completed` event also calls `settlePaidOrder` (confirmed: `apps/api/src/routes/abacatepay-webhook.ts` line ~415 and ~548). The same `product`-branch garage carve-out applies automatically. However, the test suite in Task 10 only covers the Stripe path.

   Add a `describe` block in `apps/api/test/cart/garage-webhook-replay.test.ts` (Task 10 Step 1) for the AbacatePay path:

   ```ts
   describe('POST /abacatepay/webhook — garage spot fulfillment', () => {
     it('transparent.completed for a virtual-only order creates one GarageSpot and sets virtual_complete', async () => {
       const { user } = await createUser({ verified: true });
       const { cart, order, orderItemId } = await seedPendingGarageOrderWithCart(
         user.id,
         'abacatepay',
       );

       // Re-seed the order with provider='abacatepay' and a billingId metadata.
       // The route reads cartId from billing metadata to find pending orders.
       const billingId = `bill_test_${Math.random().toString(36).slice(2, 8)}`;
       await prisma.order.update({
         where: { id: order.id },
         data: { provider: 'abacatepay' },
       });

       const payload = {
         id: `evt_abacate_1`,
         event: 'transparent.completed',
         devMode: false,
         data: {
           billing: {
             id: billingId,
             metadata: { cartId: cart.id, userId: user.id, orderIds: JSON.stringify([order.id]) },
           },
         },
       };

       const res = await app.inject({
         method: 'POST',
         url: '/abacatepay/webhook',
         headers: { 'content-type': 'application/json', 'x-api-key': 'test-webhook-secret' },
         payload,
       });
       expect(res.statusCode).toBe(200);

       const settled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
       expect(settled.status).toBe('paid');
       expect(settled.fulfillmentStatus).toBe('virtual_complete');

       const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
       expect(spots).toHaveLength(1);
       expect(spots[0]).toMatchObject({
         tier: 'extra',
         source: 'purchase',
         sourceOrderItemId: orderItemId,
       });
     });

     it('replayed transparent.completed does not duplicate the GarageSpot', async () => {
       // ... same seed, fire webhook twice, assert spots.length === 1
     });
   });
   ```

   Notes: the event type name is `transparent.completed` (not `payment_confirmed`). The route is `POST /abacatepay/webhook`. The `abacatepay` service is optional; the test app must be built with `buildApp(loadEnv(), { abacatepay: buildFakeAbacatePay() })` or equivalent. Confirm the fake/test helper name in `apps/api/src` before writing. If the AbacatePay fake is not yet wired for test, stub this describe block as `it.todo` and track as a follow-up.

   **The Stripe test in Task 10 is not sufficient alone — AbacatePay settlement must also be covered since both payment paths can produce garage orders.**

9. **`Order.fulfillmentMethod='virtual'` consumers — grep required before merge.** Routes that render orders to the user (`apps/api/src/routes/me-orders.ts`, `apps/api/src/services/store/orders.ts`) may switch on `fulfillmentMethod` or `fulfillmentStatus`. This grep is now part of Task 11 Step 1 (not deferred to TASK-D/TASK-H) and must pass before PR merge:

```bash
grep -rn "fulfillmentMethod\s*===" apps/api/src/ apps/admin/ apps/mobile/
grep -rn "fulfillmentStatus\s*===" apps/api/src/ apps/admin/ apps/mobile/
```

If any consumer narrows the union with `'pickup' | 'ship'` in a switch/exhaustive check, widen to include `'virtual'` (and the same for `'virtual_complete'`). **Block PR merge on any unhandled switch case.** Cross-platform follow-up (TASK-D admin UI / TASK-H mobile) may still apply, but the API-side narrowing must be resolved in this PR.

---

## Execution handoff

Plan complete and saved to `plans/garage-spots/TASK-C-virtual-checkout-and-settlement.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Pick one before starting.

---

## Reviewer pushback

One finding is rejected. All others were accepted and applied above.

**Finding: Risk 8 event type `payment_confirmed`**

The reviewer cited `payment_confirmed` as the AbacatePay event type to test. This is wrong. Confirmed by reading `apps/api/src/routes/abacatepay-webhook.ts`: the handled event type is `transparent.completed` (line 23, line 302). There is no `payment_confirmed` event anywhere in that file. The test block added under Risk 8 uses `transparent.completed`. If the reviewer was thinking of a different provider's naming convention, it does not apply here.
