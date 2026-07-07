# JDMA-481: Pending Payment Recovery

**Date:** 2026-05-09
**Issue:** JDMA-481
**Status:** Draft — pending CTO review

## Problem

User creates a Stripe or PIX order then leaves the checkout screen (app close, network error, back button). The "Meus Pedidos" screen shows the order as "Pagamento pendente" but offers no way to resume payment. The only recovery is waiting for the 15-min expiry and re-purchasing.

## Constraints

- PIX `brCode` is not persisted today — the AbacatePay `getPixBilling(id)` returns only `{ id, status, paidAt }`, not the brCode. Must store it in the DB.
- Stripe `clientSecret` can be re-fetched via `stripe.paymentIntents.retrieve(id)`. No DB storage needed.
- Stripe `clientSecret` must NOT be stored in DB (PCI hygiene, data minimization).
- `StripeClient` service has no `retrievePaymentIntent` method — must add one.
- `StripeProvider` wraps the whole app (`app/_layout.tsx`), so `useStripe()` is available everywhere.
- Orders expire at `expiresAt` (15 min from creation). An expired order must not be recoverable.
- One `Ticket` per `(user, event)` invariant — cannot create a new order for the same event if one already exists. Recovery must reuse the existing order.

## Approaches Considered

### A: Store `brCode` in DB + add `retrievePaymentIntent` to Stripe service (Recommended)

- One nullable column `brCode` on `Order` — additive migration, safe rollback.
- No Stripe secret stored in DB.
- New `GET /orders/:id/resume` reads `brCode` from DB (PIX) or calls Stripe (card).
- Clean, minimal.

### B: Store both `brCode` and `clientSecret` in DB

- Simpler at read time (pure DB), but stores a PCI-relevant secret at rest.
- Violates data-minimization principle. Rejected.

### C: Create a new AbacatePay billing on recovery

- New billing = new `brCode` = both the old and new billing can be paid.
- Creates double-payment risk. Rejected.

## Design

### 1. Database

Add `brCode String?` to `Order` model in `packages/db/prisma/schema.prisma`.

Rollback plan: `prisma migrate resolve --rolled-back <migration-name>` — column is nullable, additive only, safe to roll back.

### 2. API: Save `brCode` at PIX order creation

In `apps/api/src/routes/orders.ts`, after `billing = await app.abacatepay.createPixBilling(...)`, update the Prisma `order.update` call to also set `brCode: billing.brCode`.

### 3. API: Add `retrievePaymentIntent` to Stripe service

In `apps/api/src/services/stripe/index.ts`:

- Add `retrievePaymentIntent(id: string): Promise<PaymentIntentResult>` to `StripeClient` type.
- Implement with `stripe.paymentIntents.retrieve(id)` — guards for missing `client_secret`.

### 4. API: New `GET /orders/:id/resume` endpoint

In `apps/api/src/routes/orders.ts`:

```
GET /orders/:id/resume
Auth: bearer (must be authenticated)
```

Behavior:

1. Look up order by `id` where `userId === sub`. 404 if not found.
2. Run lazy expiry check (same as `GET /orders/:id`).
3. If `status !== 'pending'` → 409 `{ error: 'OrderNotPending', status: order.status }`.
4. For `provider === 'abacatepay'` (PIX): return `{ method: 'pix', orderId, brCode, expiresAt, amountCents, currency }`.
5. For `provider === 'stripe'` (card): call `stripe.retrievePaymentIntent(order.providerRef)` → return `{ method: 'card', orderId, clientSecret, amountCents, currency }`.

Response schema (discriminated union on `method`): `resumeOrderResponseSchema` in `packages/shared/src/orders.ts`.

Error responses:

- `404` — order not found / not owned by user
- `409` — order not pending (`OrderNotPending`, includes current `status`)
- `502` — upstream provider error (Stripe/AbacatePay unreachable)

### 5. Shared schema

Add to `packages/shared/src/orders.ts`:

```ts
export const resumePixOrderResponseSchema = z.object({
  method: z.literal('pix'),
  orderId: z.string().min(1),
  brCode: z.string().min(1),
  expiresAt: z.string().datetime(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export const resumeCardOrderResponseSchema = z.object({
  method: z.literal('card'),
  orderId: z.string().min(1),
  clientSecret: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export const resumeOrderResponseSchema = z.discriminatedUnion('method', [
  resumePixOrderResponseSchema,
  resumeCardOrderResponseSchema,
]);
export type ResumeOrderResponse = z.infer<typeof resumeOrderResponseSchema>;
```

### 6. Mobile: API client

Add to `apps/mobile/src/api/orders.ts`:

```ts
export async function resumeOrder(orderId: string): Promise<ResumeOrderResponse> {
  // GET /orders/:id/resume — returns payment credentials for pending order
}
```

### 7. Mobile: UI — "Pagar" button in OrderCard

In `apps/mobile/app/(app)/profile/orders.tsx`, inside `OrderCard`:

- Show "Pagar" button when `order.status === 'pending'` AND `expiresAt` is in the future.
- Position: inline in the footer row — total amount stays on the left (`Total: R$XX.XX`), "Pagar" accent pressable on the right (matches style of `ticketLinkText`).
- Loading state per-card (prevent double-tap).
- On tap:
  1. Call `resumeOrder(order.id)`.
  2. If 409 (OrderNotPending) → show toast "Pedido expirado ou já pago", refresh list.
  3. If response `method === 'pix'` → `router.push('/(app)/events/buy/checkout-pix', { orderId, brCode, expiresAt, amountCents, currency })`.
  4. If response `method === 'card'` → call `initPaymentSheet({ paymentIntentClientSecret: clientSecret })` → `presentPaymentSheet()` → on success refresh list.

### 8. Mobile: Copy

Add to `apps/mobile/src/copy/orders.ts`:

```ts
pay: 'Pagar',
paymentExpired: 'Pedido expirado ou já pago',
```

## Out of Scope

- Web checkout recovery (Stripe Checkout Session — different surface).
- Cart-level recovery (all orders are now single-order post JDMA-462).
- Admin view of pending orders (separate concern).

## Test Plan

**API integration tests** (hit real Postgres):

- PIX pending order → `GET /orders/:id/resume` → 200 with `brCode`.
- Stripe pending order → `GET /orders/:id/resume` → 200 with `clientSecret`.
- Expired order → 409 `OrderNotPending`.
- Paid order → 409 `OrderNotPending`.
- Other user's order → 404.
- Missing `brCode` (pre-migration row) → error handled gracefully.

**Mobile** (manual smoke test — no jsdom for RN):

- Pending PIX order in list → "Pagar" visible → tap → checkout-pix screen opens with QR.
- Pending Stripe order in list → "Pagar" visible → tap → PaymentSheet presents.
- Paid order → "Pagar" not visible.
- Expired order → "Pagar" not visible (expiresAt check client-side); if somehow called → toast shown.

## Rollback

- DB: `prisma migrate resolve --rolled-back` + deploy old API. Mobile "Pagar" button safe to ship before API (404 → toast, no crash).
- API endpoint: additive route, no existing behavior changed.
