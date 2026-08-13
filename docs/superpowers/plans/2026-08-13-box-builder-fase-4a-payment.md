# Box Builder Fase 4a — Pagamento (Pix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assinante paga o extra da caixa por Pix; o Order vira `paid` so por webhook AbacatePay verificado; a caixa vai de `awaiting_payment` para `ready`.

**Architecture:** Novo `POST /me/box/checkout` cria a cobranca Pix (AbacatePay) pro Order de box ja criado no confirm, serializado sob o lock da `Garage`. O webhook existente roteia por `metadata.orderId`/`providerRef` para `settlePaidOrder`, que ganha um ramo `box` race-safe (flip so-se-pendente; Order cancelado no cutoff nunca vira `paid`). Mobile ganha tela `/caixa/pagar` que faz polling do `GET /me/box`.

**Tech Stack:** Fastify + Prisma + Postgres (Testcontainers), AbacatePay Pix, Zod (`@ccc/shared`), Expo/React Native, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-box-builder-fase-4a-payment-design.md`

## Global Constraints

- Order so vira `paid` por webhook verificado do provider. Nunca por chamada do cliente.
- Webhook idempotente: dedupe por event id (`PaymentWebhookEvent`), match por `orderId`/`providerRef`, assinatura verificada.
- O settle e a rede de seguranca, nao o expiry: so liquida Order `pending`; Order nao-pendente nunca vira `paid`.
- Toda mutacao de box que carimba cobranca ou liquida trava a linha da `Garage` (`FOR UPDATE`) e re-checa status dentro da transacao (igual `confirm.ts` e `box-cutoff.ts`).
- Totais sao verdade do servidor (`amountCents` fixado no confirm; nunca vem do cliente).
- Testes de integracao da API batem em Postgres real (Testcontainers), nunca mocks.
- Copy user-facing em PT-BR. Sem em-dash, sem clausula entre parenteses no copy.
- Sem dep nova no mobile. Reusa `HiddenQR`, `expo-clipboard`, RN core.
- Nao ligar `EXPO_PUBLIC_CAIXA_ENABLED` (config pos-QA, fora do escopo de codigo).
- Deixar o lint-staged rodar nos commits (sem `--no-verify`).

## File Structure

**Shared (`packages/shared/src/box.ts`):** `boxViewSchema` ganha `orderId`; novo `boxCheckoutResponseSchema` + tipo. Fixture de teste atualizado.

**API:**

- `apps/api/src/services/box/serialize.ts` — serializa `orderId`.
- `apps/api/src/services/orders/settle.ts` — ramo `box` (novo), variante `box` no `SettledOrderResult`.
- `apps/api/src/routes/abacatepay-webhook.ts` — hardening do ramo "already paid" (compara `providerRef`).
- `apps/api/src/services/box/checkout.ts` — novo; cria/reusa a cobranca Pix (3 fases, lock).
- `apps/api/src/routes/box.ts` — nova rota `POST /me/box/checkout` (scoped + rate limit).

**Mobile:**

- `apps/mobile/src/api/box.ts` — `checkoutBox()`.
- `apps/mobile/src/screens/caixa/pay-result.ts` — helpers puros (mapeamento de erro + outcome ready/trim).
- `apps/mobile/src/hooks/useBoxPay.ts` — dispara checkout, mapeia erro.
- `apps/mobile/src/hooks/useBoxPaymentPoll.ts` — polling do `getBox` (mecanica do `useOrderStatus`).
- `apps/mobile/src/copy/caixa.ts` — namespace `pay`; remove `awaiting.comingSoon`.
- `apps/mobile/app/(app)/caixa/pagar.tsx` — tela nova.
- `apps/mobile/app/(app)/caixa/revisar.tsx` — ramifica pra `/caixa/pagar` quando `chargeCents > 0`.
- `apps/mobile/app/(app)/caixa/index.tsx` — liga o botao "Retomar pagamento".

**Test commands:**

- API single file: `pnpm --filter @ccc/api exec vitest run <path>` (precisa Docker pro Testcontainers).
- Mobile single file: `pnpm --filter @ccc/mobile exec vitest run <path>`.
- Mobile typecheck: `pnpm --filter @ccc/mobile typecheck`.

---

### Task 1: Shared — `orderId` no BoxView + `boxCheckoutResponseSchema`

**Files:**

- Modify: `packages/shared/src/box.ts`
- Test: `packages/shared/src/__tests__/box.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `boxViewSchema` com `orderId: z.string().nullable()`; `boxCheckoutResponseSchema` = `z.object({ brCode: z.string(), amountCents: z.number().int(), expiresAt: z.string() })`; tipos `BoxView` (agora com `orderId`), `BoxCheckoutResponse`.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/__tests__/box.test.ts`:

```ts
import {
  boxConfirmSchema,
  boxSelectionUpdateSchema,
  boxViewSchema,
  boxCheckoutResponseSchema,
} from '../box.js';

it('parses a box view carrying an orderId', () => {
  const parsed = boxViewSchema.parse({
    id: 'box_1',
    status: 'awaiting_payment',
    cycleKey: '2026-08-01',
    cutoffAt: '2026-08-27T00:00:00.000Z',
    budgetCents: 10000,
    currency: 'BRL',
    itemsTotalCents: 12000,
    partnersTotalCents: 0,
    overflowCents: 2000,
    shippingCents: 0,
    chargeCents: 2000,
    orderId: 'ord_1',
    autoSendOptIn: false,
    shippingAddressId: 'addr_1',
    items: [],
    partnerItems: [],
  });
  expect(parsed.orderId).toBe('ord_1');
});

it('defaults orderId to null and parses a checkout response', () => {
  const view = boxViewSchema.parse({
    id: 'box_1',
    status: 'open',
    cycleKey: '2026-08-01',
    cutoffAt: '2026-08-27T00:00:00.000Z',
    budgetCents: 10000,
    currency: 'BRL',
    itemsTotalCents: 0,
    partnersTotalCents: 0,
    overflowCents: 0,
    shippingCents: 0,
    chargeCents: 0,
    orderId: null,
    autoSendOptIn: false,
    shippingAddressId: null,
    items: [],
    partnerItems: [],
  });
  expect(view.orderId).toBeNull();
  const res = boxCheckoutResponseSchema.parse({
    brCode: '00020126...',
    amountCents: 2000,
    expiresAt: '2026-08-27T00:00:00.000Z',
  });
  expect(res.brCode).toContain('000201');
});
```

Also update the existing `'parses a full box view'` fixture (`box.test.ts:8-33`) to include `orderId: null` right after `chargeCents: 0,`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/shared exec vitest run src/__tests__/box.test.ts`
Expected: FAIL (`boxCheckoutResponseSchema` undefined; `orderId` unknown key stripped so first test's `orderId` is undefined).

- [ ] **Step 3: Write minimal implementation**

In `packages/shared/src/box.ts`, add `orderId` to `boxViewSchema` right after the `chargeCents` line (box.ts:47):

```ts
  chargeCents: z.number().int(),
  orderId: z.string().nullable(),
```

Add, after the `boxConfirmSchema` block:

```ts
export const boxCheckoutResponseSchema = z.object({
  brCode: z.string(),
  amountCents: z.number().int(),
  expiresAt: z.string(),
});
export type BoxCheckoutResponse = z.infer<typeof boxCheckoutResponseSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/shared exec vitest run src/__tests__/box.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/box.ts packages/shared/src/__tests__/box.test.ts
git commit -m "feat(shared): add orderId to BoxView and boxCheckoutResponseSchema"
```

---

### Task 2: API — serializar `orderId` no BoxView

**Files:**

- Modify: `apps/api/src/services/box/serialize.ts`
- Test: `apps/api/test/box/box-confirm.test.ts` (asserção adicional)

**Interfaces:**

- Consumes: `BoxView.orderId` (Task 1).
- Produces: `serializeBox` inclui `orderId: box.orderId`.

- [ ] **Step 1: Write the failing test**

In `apps/api/test/box/box-confirm.test.ts`, inside the existing `'overflow creates a pending box Order and goes awaiting_payment'` test, after the existing assertions, add:

```ts
const view = res.json();
expect(view.orderId).toBe(fresh.orderId);
expect(view.orderId).not.toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api exec vitest run test/box/box-confirm.test.ts`
Expected: FAIL (`view.orderId` is undefined — serialize does not emit it; zod would also have stripped it).

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/services/box/serialize.ts`, add to the returned object literal (right after `chargeCents: box.chargeCents,`):

```ts
  chargeCents: box.chargeCents,
  orderId: box.orderId,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api exec vitest run test/box/box-confirm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/box/serialize.ts apps/api/test/box/box-confirm.test.ts
git commit -m "feat(api): serialize box orderId in BoxView"
```

---

### Task 3: API — ramo `box` no `settlePaidOrder`

**Files:**

- Modify: `apps/api/src/services/orders/settle.ts`
- Test: `apps/api/test/box/box-settle.test.ts` (novo)

**Interfaces:**

- Consumes: `settlePaidOrder(orderId, providerRef, env)`; `OrderNotPendingError`.
- Produces: `SettledOrderResult` ganha `| { kind: 'box' }`. Ramo `box`: flip so-se-`pending` sob lock da Garage; box `awaiting_payment -> ready`; Order nao-pendente -> `throw OrderNotPendingError`.

**Context:** o worker de cutoff (`box-cutoff.ts`) roda em paralelo e cancela o Order via `updateMany(where status:'pending')`, nulando `box.orderId`. O ramo `box` NAO pode copiar o padrao do ramo `product` (que le status fora da transacao e escreve incondicional, so salvo por `Serializable`). Em vez disso, o flip e condicional em `status:'pending'` e re-checado sob o lock.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/box/box-settle.test.ts`. Reuse the `setup` seeding shape from `box-confirm.test.ts` but leave the box `awaiting_payment` with a pending Order, then call `settlePaidOrder` directly.

```ts
import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { settlePaidOrder } from '../../src/services/orders/settle.js';
import { OrderNotPendingError } from '../../src/services/tickets/issue.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

// Seeds a premium member with a box in awaiting_payment + a pending box Order.
const seedAwaitingBox = async (chargeCents: number) => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: `sub_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      kind: 'box',
      amountCents: chargeCents,
      baseAmountCents: chargeCents,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
      method: 'pix',
      provider: 'abacatepay',
      status: 'pending',
      shippingCents: 0,
    },
  });
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: new Date('2026-08-26T00:00:00.000Z'),
      budgetCentsSnapshot: 10000,
      status: 'awaiting_payment',
      orderId: order.id,
      chargeCents,
    },
  });
  return { user, order, box };
};

describe('settlePaidOrder — box', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.boxSettings.upsert({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      update: { boxEnabled: true },
      create: { id: BOX_SETTINGS_SINGLETON_ID, boxEnabled: true, shippingFeeCents: 0 },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('settles a pending box order to paid and flips the box to ready', async () => {
    const { order, box } = await seedAwaitingBox(2000);
    const result = await settlePaidOrder(order.id, 'pix_char_1', env);
    expect(result.kind).toBe('box');
    const freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(freshOrder.status).toBe('paid');
    expect(freshOrder.paidAt).not.toBeNull();
    expect(freshOrder.providerRef).toBe('pix_char_1');
    expect(freshBox.status).toBe('ready');
    expect(freshBox.orderId).toBe(order.id);
    expect(freshBox.fulfillmentStatus).toBe('unfulfilled');
  });

  it('is idempotent: a second settle on an already-paid order throws OrderNotPendingError', async () => {
    const { order } = await seedAwaitingBox(2000);
    await settlePaidOrder(order.id, 'pix_char_1', env);
    await expect(settlePaidOrder(order.id, 'pix_char_1', env)).rejects.toBeInstanceOf(
      OrderNotPendingError,
    );
  });

  it('never flips a cutoff-cancelled order to paid', async () => {
    const { order, box } = await seedAwaitingBox(2000);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    await prisma.monthlyBox.update({ where: { id: box.id }, data: { orderId: null } });
    await expect(settlePaidOrder(order.id, 'pix_char_1', env)).rejects.toBeInstanceOf(
      OrderNotPendingError,
    );
    const freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(freshOrder.status).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api exec vitest run test/box/box-settle.test.ts`
Expected: FAIL — the current box guard throws `Error('box orders are not settled in this phase')`, not the expected behavior.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/services/orders/settle.ts`:

Add `'box'` to the result union:

```ts
export type SettledOrderResult =
  | { kind: 'ticket' | 'extras_only'; issued: IssueResult }
  | { kind: 'product' | 'mixed'; issued?: IssueResult[] }
  | { kind: 'box' };
```

Replace the box guard block (settle.ts:76-80) with:

```ts
if (order.kind === 'box') {
  // Fase 4a: only a still-pending box order settles. The cutoff worker runs in
  // parallel and cancels via updateMany(where status:'pending'); a cancelled
  // order must never flip to paid. Non-pending -> throw so the webhook's
  // OrderNotPendingError branch flags a manual refund (Pix has no refund API).
  if (order.status !== 'pending') {
    throw new OrderNotPendingError(orderId, order.status);
  }
  const box = await prisma.monthlyBox.findFirst({
    where: { orderId },
    select: { id: true, garageId: true },
  });
  if (!box) throw new OrderNotPendingError(orderId, 'cancelled');

  await prisma.$transaction(async (tx) => {
    // Same lock the cutoff worker takes, so the flip and a concurrent cancel
    // serialize on the Garage row.
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${box.garageId} FOR UPDATE`;
    const flipped = await tx.order.updateMany({
      where: { id: orderId, status: 'pending' },
      data: { status: 'paid', paidAt: new Date(), providerRef },
    });
    if (flipped.count === 0) {
      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      throw new OrderNotPendingError(orderId, current?.status ?? 'unknown');
    }
    await tx.monthlyBox.updateMany({
      where: { id: box.id, status: 'awaiting_payment' },
      data: { status: 'ready' },
    });
  });
  return { kind: 'box' };
}
```

Ensure `OrderNotPendingError` is imported in `settle.ts` (it already imports from `../tickets/issue.js`; confirm `OrderNotPendingError` is in that import list, add it if missing).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api exec vitest run test/box/box-settle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/orders/settle.ts apps/api/test/box/box-settle.test.ts
git commit -m "feat(api): settle box orders on paid webhook, race-safe against cutoff"
```

---

### Task 4: API — webhook double-payment hardening

**Files:**

- Modify: `apps/api/src/routes/abacatepay-webhook.ts`
- Test: `apps/api/test/abacatepay/box-webhook.test.ts` (novo)

**Interfaces:**

- Consumes: `settlePaidOrder` box branch (Task 3); `flagManualRefund` (webhook-local).
- Produces: no ramo `OrderNotPendingError` -> `staleOrder.status === 'paid'`, compara `providerRef` gravado com o `billingId` do evento; diferente -> `flagManualRefund(reason: 'double-payment')`.

**Context:** hoje o ramo "already paid" faz `markProcessed` + 200 silencioso, sem distinguir redelivery benigno do mesmo charge de um segundo charge distinto pago pro mesmo Order. Generico (vale pra todo Order do single-order dispatch), fecha o buraco que o design 4a citou.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/abacatepay/box-webhook.test.ts`. Boot the app with the fake AbacatePay (`buildApp(env, { stripe, abacatepay })`), seed a PAID box order whose `providerRef` is `pix_char_A`, then POST a valid webhook whose billingId is `pix_char_B` (different). Assert `flagManualRefund` fired via the Sentry mock, and the order stays `paid`.

Mirror the harness from `apps/api/test/abacatepay/webhook.test.ts:1-34,333-350` (Sentry `vi.mock`, `TEST_WEBHOOK_SECRET`, `webhookUrl`, `buildFakeAbacatePay`, `getPixBilling` returns PAID by default). Use `Sentry.captureMessage` mock to assert the manual-refund message. Also add a second test where billingId equals the stored `providerRef` and assert NO manual-refund message fired (benign replay).

```ts
it('flags a manual refund when a second distinct billing settles an already-paid box order', async () => {
  // seed: box order, status 'paid', providerRef 'pix_char_A'
  // POST webhook with billingId 'pix_char_B', getPixBilling(PAID)
  // expect Sentry.captureMessage called with a message containing 'double-payment'
});

it('does not flag on a benign redelivery of the same billing', async () => {
  // seed: box order, status 'paid', providerRef 'pix_char_A'
  // POST webhook with billingId 'pix_char_A'
  // expect NO Sentry manual-refund message
});
```

(Fill the seeding + POST body from the existing `webhook.test.ts` order-fixture-per-billingId pattern at `:181-201`, using `kind: 'box'`, `status: 'paid'`, `providerRef: 'pix_char_A'`. The webhook event payload shape and `extractOrderIdFromMetadata` are exercised there; pass `metadata.orderId` = the seeded order id.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api exec vitest run test/abacatepay/box-webhook.test.ts`
Expected: FAIL on the first test (no manual-refund message fires; the paid branch is silent).

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/routes/abacatepay-webhook.ts`, in the single-order `OrderNotPendingError` handler, expand the `staleOrder` select to include `providerRef` and harden the `paid` branch:

```ts
        if (err instanceof OrderNotPendingError) {
          const staleOrder = await prisma.order.findUnique({
            where: { id: order.id },
            select: { status: true, providerRef: true },
          });
          if (staleOrder?.status === 'paid') {
            if (staleOrder.providerRef && staleOrder.providerRef !== billingId) {
              flagManualRefund({
                orderId: order.id,
                providerRef: billingId,
                userId: order.userId,
                eventId: order.eventId,
                reason: 'double-payment',
              });
            }
            await markProcessed(event.id, event);
            return reply.status(200).send({ ok: true });
          }
```

(Leave the `expired` and catch-all branches unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api exec vitest run test/abacatepay/box-webhook.test.ts`
Expected: PASS (2 tests). Also run the existing webhook suite to check no regression: `pnpm --filter @ccc/api exec vitest run test/abacatepay/webhook.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/abacatepay-webhook.ts apps/api/test/abacatepay/box-webhook.test.ts
git commit -m "fix(api): flag manual refund on a distinct second billing for a paid order"
```

---

### Task 5: API — `POST /me/box/checkout`

**Files:**

- Create: `apps/api/src/services/box/checkout.ts`
- Modify: `apps/api/src/routes/box.ts`
- Test: `apps/api/test/box/box-checkout.test.ts` (novo)

**Interfaces:**

- Consumes: `loadEligibleMembership(userId)` (box.ts:20); `createPixBilling` (`CreatePixBillingInput` -> `PixBillingResult`); `BoxCheckoutResponse` (Task 1).
- Produces: `checkoutBoxOrder(args: { userId: string; membershipId: string; abacatepay: AbacatePayClient }): Promise<CheckoutResult>` where `CheckoutResult = { kind: 'ok'; brCode: string; amountCents: number; expiresAt: string } | { kind: 'not_found' } | { kind: 'not_awaiting' } | { kind: 'locked' } | { kind: 'upstream' }`. Route `POST /me/box/checkout` maps kinds to HTTP.

**Design (3 fases, spec Unidade 1):** Fase A e C sob `Garage FOR UPDATE`; Fase B (createPixBilling) fora do lock. `expiresInSeconds = floor((cutoffAt - now)/1000)`; margem minima 60s. Reuse: se o Order ja tem `providerRef` + `brCode`, retorna eles sem chamar o provider (expiry = cutoff, e Fase A ja garante `now < cutoffAt`).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/box/box-checkout.test.ts`. Boot with `makeAppWithFakes()` (gives `abacatepay: FakeAbacatePay`). Seed an `awaiting_payment` box + pending box Order (reuse the `seedAwaitingBox` shape from Task 3, but via the app so `loadEligibleMembership` finds the membership). Set `abacatepay.nextBilling` and assert the stamp + response + idempotent reuse.

```ts
import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { bearer, createUser, makeAppWithFakes, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seed = async (opts: { cutoffAt: Date; chargeCents: number }) => {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: `sub_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      kind: 'box',
      amountCents: opts.chargeCents,
      baseAmountCents: opts.chargeCents,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
      method: 'pix',
      provider: 'abacatepay',
      status: 'pending',
      shippingCents: 0,
    },
  });
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: opts.cutoffAt,
      budgetCentsSnapshot: 10000,
      status: 'awaiting_payment',
      orderId: order.id,
      chargeCents: opts.chargeCents,
    },
  });
  return { user, order, box };
};

describe('POST /me/box/checkout', () => {
  let app: FastifyInstance;
  let abacatepay: FakeAbacatePay;
  beforeEach(async () => {
    await resetDatabase();
    await prisma.boxSettings.upsert({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      update: { boxEnabled: true },
      create: { id: BOX_SETTINGS_SINGLETON_ID, boxEnabled: true, shippingFeeCents: 0 },
    });
    ({ app, abacatepay } = await makeAppWithFakes());
  });
  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const future = new Date(Date.now() + 3 * 24 * 3600_000);

  it('creates a Pix billing, stamps the order, returns the brCode', async () => {
    const { user, order } = await seed({ cutoffAt: future, chargeCents: 2000 });
    abacatepay.nextBilling = {
      id: 'pix_char_1',
      brCode: '00020126-BR',
      amount: 2000,
      expiresAt: future.toISOString(),
      status: 'PENDING',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().brCode).toBe('00020126-BR');
    expect(res.json().amountCents).toBe(2000);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.providerRef).toBe('pix_char_1');
    expect(fresh.brCode).toBe('00020126-BR');
    const createCalls = abacatepay.calls.filter((c) => c.method === 'createPixBilling');
    expect(createCalls).toHaveLength(1);
    expect(
      (createCalls[0].args[0] as { metadata?: Record<string, string> }).metadata?.orderId,
    ).toBe(order.id);
  });

  it('reuses the active billing on a second call (idempotent, no duplicate)', async () => {
    const { user } = await seed({ cutoffAt: future, chargeCents: 2000 });
    abacatepay.nextBilling = {
      id: 'pix_char_1',
      brCode: '00020126-BR',
      amount: 2000,
      expiresAt: future.toISOString(),
      status: 'PENDING',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(first.json().brCode).toBe(second.json().brCode);
    expect(abacatepay.calls.filter((c) => c.method === 'createPixBilling')).toHaveLength(1);
  });

  it('409 box_locked when past cutoff', async () => {
    const { user } = await seed({ cutoffAt: new Date(Date.now() - 1000), chargeCents: 2000 });
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('box_locked');
  });

  it('409 box_not_awaiting when the box is not awaiting_payment', async () => {
    const { user, box } = await seed({ cutoffAt: future, chargeCents: 2000 });
    await prisma.monthlyBox.update({ where: { id: box.id }, data: { status: 'ready' } });
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('box_not_awaiting');
  });

  it('502 when AbacatePay upstream fails, leaving the order unstamped', async () => {
    const { user, order } = await seed({ cutoffAt: future, chargeCents: 2000 });
    abacatepay.nextBillingError = new Error('upstream down');
    const res = await app.inject({
      method: 'POST',
      url: '/me/box/checkout',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(502);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.providerRef).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api exec vitest run test/box/box-checkout.test.ts`
Expected: FAIL (route 404 — `/me/box/checkout` does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/services/box/checkout.ts`:

```ts
import { prisma } from '@ccc/db';

import type { AbacatePayClient } from '../abacatepay/index.js';

const MIN_WINDOW_MS = 60_000;

export type CheckoutResult =
  | { kind: 'ok'; brCode: string; amountCents: number; expiresAt: string }
  | { kind: 'not_found' }
  | { kind: 'not_awaiting' }
  | { kind: 'locked' }
  | { kind: 'upstream' };

const monthYear = (cycleKey: string): string => cycleKey.slice(0, 7);

export const checkoutBoxOrder = async (args: {
  userId: string;
  membershipId: string;
  abacatepay: AbacatePayClient;
}): Promise<CheckoutResult> => {
  // Phase A: under the Garage lock, validate + short-circuit on an active charge.
  const phaseA = await prisma.$transaction(async (tx) => {
    const boxRef = await tx.monthlyBox.findFirst({
      where: { membershipId: args.membershipId },
      orderBy: { cycleStart: 'desc' },
      select: { id: true, garageId: true },
    });
    if (!boxRef) return { kind: 'not_found' as const };
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${boxRef.garageId} FOR UPDATE`;
    const box = await tx.monthlyBox.findUnique({
      where: { id: boxRef.id },
      select: { id: true, status: true, cutoffAt: true, cycleKey: true, orderId: true },
    });
    if (!box || !box.orderId) return { kind: 'not_found' as const };
    if (box.status !== 'awaiting_payment') return { kind: 'not_awaiting' as const };
    if (box.cutoffAt.getTime() - Date.now() < MIN_WINDOW_MS) return { kind: 'locked' as const };
    const order = await tx.order.findUnique({
      where: { id: box.orderId },
      select: { id: true, status: true, amountCents: true, providerRef: true, brCode: true },
    });
    if (!order || order.status !== 'pending') return { kind: 'not_awaiting' as const };
    if (order.providerRef && order.brCode) {
      // Active charge (expiry = cutoff; we are before cutoff). Reuse, no provider call.
      return {
        kind: 'reuse' as const,
        brCode: order.brCode,
        amountCents: order.amountCents,
        expiresAt: box.cutoffAt.toISOString(),
      };
    }
    return {
      kind: 'create' as const,
      orderId: order.id,
      boxId: box.id,
      amountCents: order.amountCents,
      cutoffAt: box.cutoffAt,
      cycleKey: box.cycleKey,
    };
  });

  if (phaseA.kind !== 'create') {
    if (phaseA.kind === 'reuse') {
      return {
        kind: 'ok',
        brCode: phaseA.brCode,
        amountCents: phaseA.amountCents,
        expiresAt: phaseA.expiresAt,
      };
    }
    return phaseA;
  }

  // Phase B: create the Pix billing off-lock (external HTTP).
  const expiresInSeconds = Math.floor((phaseA.cutoffAt.getTime() - Date.now()) / 1000);
  let billing;
  try {
    billing = await args.abacatepay.createPixBilling({
      amountCents: phaseA.amountCents,
      description: `Caixa ${monthYear(phaseA.cycleKey)}`,
      expiresInSeconds,
      metadata: { orderId: phaseA.orderId, boxId: phaseA.boxId, userId: args.userId },
    });
  } catch {
    return { kind: 'upstream' };
  }

  // Phase C: under the lock again, stamp only if still pending.
  return prisma.$transaction(async (tx) => {
    const boxRow = await tx.monthlyBox.findUnique({
      where: { id: phaseA.boxId },
      select: { garageId: true, status: true },
    });
    if (!boxRow) return { kind: 'not_found' as const };
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${boxRow.garageId} FOR UPDATE`;
    const stamped = await tx.order.updateMany({
      where: { id: phaseA.orderId, status: 'pending' },
      data: { providerRef: billing.id, brCode: billing.brCode },
    });
    if (stamped.count === 0) {
      // Cutoff worker cancelled between phases. Orphan billing expires at cutoff.
      return { kind: 'locked' as const };
    }
    return {
      kind: 'ok' as const,
      brCode: billing.brCode,
      amountCents: phaseA.amountCents,
      expiresAt: phaseA.cutoffAt.toISOString(),
    };
  });
};
```

In `apps/api/src/routes/box.ts`, add the import and a scoped, rate-limited route. Near the other imports:

```ts
import rateLimit from '@fastify/rate-limit';
import { checkoutBoxOrder } from '../services/box/checkout.js';
```

Register the route (inside the box routes plugin, wrapped in a scoped register so the rate limit is per-route + per-user, mirroring `me-premium.ts:645-664`):

```ts
await app.register(async (scoped) => {
  scoped.addHook('preHandler', app.authenticate);
  await scoped.register(rateLimit, {
    max: 5,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `box-checkout:${req.user?.sub ?? req.ip}`,
  });
  scoped.post('/me/box/checkout', async (request, reply) => {
    const { sub } = requireUser(request);
    if (!app.abacatepay) return reply.status(503).send({ error: 'payment_unavailable' });
    const membership = await loadEligibleMembership(sub);
    if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
    const result = await checkoutBoxOrder({
      userId: sub,
      membershipId: membership.id,
      abacatepay: app.abacatepay,
    });
    if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
    if (result.kind === 'not_awaiting')
      return reply.status(409).send({ error: 'box_not_awaiting' });
    if (result.kind === 'locked') return reply.status(409).send({ error: 'box_locked' });
    if (result.kind === 'upstream')
      return reply.status(502).send({ error: 'payment_provider_error' });
    return reply.send({
      brCode: result.brCode,
      amountCents: result.amountCents,
      expiresAt: result.expiresAt,
    });
  });
});
```

(If `box.ts` does not already reference `app.abacatepay`, confirm the decorator exists on the Fastify instance — it is registered in `app.ts` alongside `app.stripe`. The type is `AbacatePayClient | undefined`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api exec vitest run test/box/box-checkout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/box/checkout.ts apps/api/src/routes/box.ts apps/api/test/box/box-checkout.test.ts
git commit -m "feat(api): POST /me/box/checkout creates a Pix charge, serialized under the Garage lock"
```

---

### Task 6: Mobile — `checkoutBox` client + copy `pay` namespace

**Files:**

- Modify: `apps/mobile/src/api/box.ts`
- Modify: `apps/mobile/src/copy/caixa.ts`
- Test: (typecheck only; client functions have no unit test in this repo, matching `getBox`/`confirmBox`)

**Interfaces:**

- Consumes: `boxCheckoutResponseSchema`, `BoxCheckoutResponse` (Task 1).
- Produces: `checkoutBox(): Promise<BoxCheckoutResponse>`; `caixaCopy.pay` namespace. Note: `caixaCopy.awaiting.comingSoon` stays until Task 10 (it is still referenced by `index.tsx`; removing it here would break typecheck).

- [ ] **Step 1: Add the client function**

In `apps/mobile/src/api/box.ts`, add (mirroring `confirmBox`):

```ts
export const checkoutBox = (): Promise<BoxCheckoutResponse> =>
  authedRequest('/me/box/checkout', boxCheckoutResponseSchema as z.ZodType<BoxCheckoutResponse>, {
    method: 'POST',
  });
```

Add `boxCheckoutResponseSchema` + `BoxCheckoutResponse` to the existing `@ccc/shared/box` import.

- [ ] **Step 2: Add the copy namespace**

In `apps/mobile/src/copy/caixa.ts`, add a `pay` namespace (top-level key in `caixaCopy`). Leave `awaiting.comingSoon` in place for now; Task 10 removes it when it rewires the home:

```ts
  pay: {
    title: 'Pagar a caixa',
    instruction: 'Escaneie o QR ou copie o codigo Pix pra pagar.',
    copyButton: 'Copiar codigo Pix',
    copied: 'Codigo copiado',
    expiresIn: 'Expira em',
    amount: 'Valor',
    success: 'Pagamento confirmado. Sua caixa esta a caminho.',
    closedBudgetOnly: 'A caixa fechou no corte e seguiu so com o budget. Nada foi cobrado.',
    expired: 'O prazo do Pix acabou. A caixa fechou no corte.',
    error: 'Nao foi possivel gerar o Pix. Tente de novo.',
    reconnect: 'Reconectar',
  },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS (additive copy + new client function; `comingSoon` still present).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/api/box.ts apps/mobile/src/copy/caixa.ts
git commit -m "feat(mobile): box checkout client + pay copy namespace"
```

---

### Task 7: Mobile — pure pay helpers (error map + ready/trim outcome)

**Files:**

- Create: `apps/mobile/src/screens/caixa/pay-result.ts`
- Test: `apps/mobile/src/screens/caixa/pay-result.test.ts`

**Interfaces:**

- Consumes: `BoxView` (Task 1); `caixaCopy.pay` (Task 6).
- Produces:
  - `type BoxPayResult = 'ok' | 'locked' | 'not_awaiting' | 'not_eligible' | 'not_found' | 'unavailable' | 'error'`.
  - `mapPayError(result: Exclude<BoxPayResult, 'ok'>): { kind: 'toast_home' | 'retry'; message: string }`.
  - `boxPayOutcome(box: BoxView): 'paid' | 'closed_budget_only' | 'pending'` — `ready` + `orderId !== null` -> paid; (`ready`|`skipped`) + `orderId === null` -> closed_budget_only; else pending. Used only on the pay screen, where an order existed at entry.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/screens/caixa/pay-result.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BoxView } from '@ccc/shared/box';

import { boxPayOutcome, mapPayError } from './pay-result';

const base: BoxView = {
  id: 'b',
  status: 'awaiting_payment',
  cycleKey: '2026-08-01',
  cutoffAt: '2026-08-27T00:00:00.000Z',
  budgetCents: 10000,
  currency: 'BRL',
  itemsTotalCents: 12000,
  partnersTotalCents: 0,
  overflowCents: 2000,
  shippingCents: 0,
  chargeCents: 2000,
  orderId: 'ord_1',
  autoSendOptIn: false,
  shippingAddressId: 'a',
  items: [],
  partnerItems: [],
};

describe('boxPayOutcome', () => {
  it('ready with orderId is a paid success', () => {
    expect(boxPayOutcome({ ...base, status: 'ready', orderId: 'ord_1' })).toBe('paid');
  });
  it('ready with null orderId is a cutoff-trim close', () => {
    expect(boxPayOutcome({ ...base, status: 'ready', orderId: null })).toBe('closed_budget_only');
  });
  it('skipped with null orderId is a cutoff-trim close', () => {
    expect(boxPayOutcome({ ...base, status: 'skipped', orderId: null })).toBe('closed_budget_only');
  });
  it('still awaiting_payment is pending', () => {
    expect(boxPayOutcome(base)).toBe('pending');
  });
});

describe('mapPayError', () => {
  it('routes lock/awaiting errors back home', () => {
    expect(mapPayError('locked').kind).toBe('toast_home');
    expect(mapPayError('not_awaiting').kind).toBe('toast_home');
    expect(mapPayError('not_eligible').kind).toBe('toast_home');
    expect(mapPayError('not_found').kind).toBe('toast_home');
  });
  it('routes provider errors to an in-screen retry', () => {
    expect(mapPayError('unavailable').kind).toBe('retry');
    expect(mapPayError('error').kind).toBe('retry');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/pay-result.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `apps/mobile/src/screens/caixa/pay-result.ts`:

```ts
import type { BoxView } from '@ccc/shared/box';

import { caixaCopy } from '~/copy/caixa';

export type BoxPayResult =
  | 'ok'
  | 'locked'
  | 'not_awaiting'
  | 'not_eligible'
  | 'not_found'
  | 'unavailable'
  | 'error';

export type PayErrorFeedback = { kind: 'toast_home' | 'retry'; message: string };

export function mapPayError(result: Exclude<BoxPayResult, 'ok'>): PayErrorFeedback {
  switch (result) {
    case 'locked':
    case 'not_awaiting':
    case 'not_eligible':
    case 'not_found':
      return { kind: 'toast_home', message: caixaCopy.pay.closedBudgetOnly };
    case 'unavailable':
    case 'error':
      return { kind: 'retry', message: caixaCopy.pay.error };
  }
}

export function boxPayOutcome(box: BoxView): 'paid' | 'closed_budget_only' | 'pending' {
  if (box.status === 'ready' && box.orderId !== null) return 'paid';
  if ((box.status === 'ready' || box.status === 'skipped') && box.orderId === null) {
    return 'closed_budget_only';
  }
  return 'pending';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/pay-result.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/caixa/pay-result.ts apps/mobile/src/screens/caixa/pay-result.test.ts
git commit -m "feat(mobile): pure box-pay helpers (error map + ready/trim outcome)"
```

---

### Task 8: Mobile — `useBoxPay` hook

**Files:**

- Create: `apps/mobile/src/hooks/useBoxPay.ts`
- Test: `apps/mobile/src/hooks/useBoxPay.test.tsx`

**Interfaces:**

- Consumes: `checkoutBox()` (Task 6); `ApiError`; `BoxPayResult` (Task 7); `BoxCheckoutResponse`.
- Produces: `useBoxPay()` returning `{ checkout: () => Promise<{ result: BoxPayResult; data?: BoxCheckoutResponse }>; loading: boolean }`. Maps: 409 `box_locked` -> `locked`; 409 `box_not_awaiting` -> `not_awaiting`; 403 -> `not_eligible`; 404 -> `not_found`; 503 -> `unavailable`; else `error`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/hooks/useBoxPay.test.tsx`, mirroring `useBoxConfirm.test.tsx` (jsdom pragma, `vi.hoisted`, `vi.mock('~/api/box')`, `vi.mock('~/api/client')`, `Probe`, `flush`, `mount`):

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkoutBox } = vi.hoisted(() => ({ checkoutBox: vi.fn() }));
vi.mock('~/api/box', () => ({ checkoutBox: () => checkoutBox() }));
vi.mock('~/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body?: unknown;
    constructor(status: number, body?: unknown) {
      super('x');
      this.status = status;
      this.body = body;
    }
  },
}));

import { ApiError as RealApiError } from '~/api/client';
import { useBoxPay } from './useBoxPay';

const ApiError = RealApiError as unknown as new (status: number, body?: unknown) => Error;

let snap: ReturnType<typeof useBoxPay>;
function Probe() {
  snap = useBoxPay();
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => checkoutBox.mockReset());
async function mount() {
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<Probe />);
    await flush();
  });
}

describe('useBoxPay', () => {
  it('returns ok + data on success', async () => {
    checkoutBox.mockResolvedValueOnce({ brCode: 'x', amountCents: 2000, expiresAt: 'z' });
    await mount();
    let out: { result: string } | undefined;
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('ok');
  });

  it('maps 409 box_locked to locked', async () => {
    checkoutBox.mockRejectedValueOnce(new ApiError(409, { error: 'box_locked' }));
    await mount();
    let out: { result: string } | undefined;
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('locked');
  });

  it('maps 409 box_not_awaiting to not_awaiting', async () => {
    checkoutBox.mockRejectedValueOnce(new ApiError(409, { error: 'box_not_awaiting' }));
    await mount();
    let out: { result: string } | undefined;
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('not_awaiting');
  });

  it('maps 503 to unavailable and other errors to error', async () => {
    checkoutBox.mockRejectedValueOnce(new ApiError(503, { error: 'payment_unavailable' }));
    await mount();
    let out: { result: string } | undefined;
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('unavailable');
    checkoutBox.mockRejectedValueOnce(new Error('net'));
    await act(async () => {
      out = await snap.checkout();
    });
    expect(out?.result).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/mobile exec vitest run src/hooks/useBoxPay.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `apps/mobile/src/hooks/useBoxPay.ts`:

```ts
import type { BoxCheckoutResponse } from '@ccc/shared/box';
import { useState } from 'react';

import { checkoutBox } from '~/api/box';
import { ApiError } from '~/api/client';
import type { BoxPayResult } from '~/screens/caixa/pay-result';

type Outcome = { result: BoxPayResult; data?: BoxCheckoutResponse };

export function useBoxPay(): { checkout: () => Promise<Outcome>; loading: boolean } {
  const [loading, setLoading] = useState(false);

  const checkout = async (): Promise<Outcome> => {
    setLoading(true);
    try {
      const data = await checkoutBox();
      return { result: 'ok', data };
    } catch (e) {
      if (e instanceof ApiError) {
        const code = (e.body as { error?: string } | undefined)?.error;
        if (code === 'box_locked') return { result: 'locked' };
        if (code === 'box_not_awaiting') return { result: 'not_awaiting' };
        if (e.status === 403) return { result: 'not_eligible' };
        if (e.status === 404) return { result: 'not_found' };
        if (e.status === 503) return { result: 'unavailable' };
      }
      return { result: 'error' };
    } finally {
      setLoading(false);
    }
  };

  return { checkout, loading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/mobile exec vitest run src/hooks/useBoxPay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/useBoxPay.ts apps/mobile/src/hooks/useBoxPay.test.tsx
git commit -m "feat(mobile): useBoxPay hook maps checkout errors"
```

---

### Task 9: Mobile — payment polling hook

**Files:**

- Create: `apps/mobile/src/hooks/useBoxPaymentPoll.ts`
- Test: `apps/mobile/src/hooks/useBoxPaymentPoll.test.tsx`

**Interfaces:**

- Consumes: `getBox()` (`~/api/box`); `boxPayOutcome` (Task 7); the interval/backoff shape of `useOrderStatus`.
- Produces: `useBoxPaymentPoll({ expiresAt, enabled }): { status: 'polling' | 'paid' | 'closed_budget_only' | 'expired' | 'error'; retry: () => void }`. Polls `getBox` every `BASE_INTERVAL_MS` (3000) with backoff after 30s; stops on a terminal outcome; `expired` when past `expiresAt`; `error` on a failed fetch.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/hooks/useBoxPaymentPoll.test.tsx` (jsdom + fake timers). Mock `~/api/box`'s `getBox`. Verify: resolves to `paid` when `getBox` returns a `ready` box with `orderId`; to `closed_budget_only` when `orderId` null; to `error` when `getBox` throws; to `expired` when `expiresAt` is in the past.

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoxView } from '@ccc/shared/box';

const { getBox } = vi.hoisted(() => ({ getBox: vi.fn() }));
vi.mock('~/api/box', () => ({ getBox: () => getBox() }));

import { useBoxPaymentPoll } from './useBoxPaymentPoll';

const view = (over: Partial<BoxView>): BoxView => ({
  id: 'b',
  status: 'awaiting_payment',
  cycleKey: '2026-08-01',
  cutoffAt: '2026-08-27T00:00:00.000Z',
  budgetCents: 10000,
  currency: 'BRL',
  itemsTotalCents: 0,
  partnersTotalCents: 0,
  overflowCents: 0,
  shippingCents: 0,
  chargeCents: 2000,
  orderId: 'ord_1',
  autoSendOptIn: false,
  shippingAddressId: 'a',
  items: [],
  partnerItems: [],
  ...over,
});

let snap: ReturnType<typeof useBoxPaymentPoll>;
function Probe({ expiresAt }: { expiresAt: string }) {
  snap = useBoxPaymentPoll({ expiresAt, enabled: true });
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const future = new Date(Date.now() + 3_600_000).toISOString();

beforeEach(() => getBox.mockReset());
afterEach(() => vi.useRealTimers());

async function mount(expiresAt = future) {
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<Probe expiresAt={expiresAt} />);
    await flush();
  });
}

describe('useBoxPaymentPoll', () => {
  it('resolves paid when the box goes ready with an orderId', async () => {
    getBox.mockResolvedValueOnce(view({ status: 'ready', orderId: 'ord_1' }));
    await mount();
    expect(snap.status).toBe('paid');
  });

  it('resolves closed_budget_only when the box goes ready with null orderId', async () => {
    getBox.mockResolvedValueOnce(view({ status: 'ready', orderId: null }));
    await mount();
    expect(snap.status).toBe('closed_budget_only');
  });

  it('resolves error when getBox throws', async () => {
    getBox.mockRejectedValueOnce(new Error('net'));
    await mount();
    expect(snap.status).toBe('error');
  });

  it('resolves expired when expiresAt is in the past', async () => {
    getBox.mockResolvedValue(view({}));
    await mount(new Date(Date.now() - 1000).toISOString());
    expect(snap.status).toBe('expired');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/mobile exec vitest run src/hooks/useBoxPaymentPoll.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `apps/mobile/src/hooks/useBoxPaymentPoll.ts`, adapting `useOrderStatus` (poll `getBox`, decide via `boxPayOutcome`, keep the interval/backoff refs, expose `retry`):

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

import { getBox } from '~/api/box';
import { boxPayOutcome } from '~/screens/caixa/pay-result';

type PollStatus = 'polling' | 'paid' | 'closed_budget_only' | 'expired' | 'error';

const BASE_INTERVAL_MS = 3000;
const BACKOFF_AFTER_MS = 30_000;
const MAX_INTERVAL_MS = 15_000;

export function useBoxPaymentPoll({
  expiresAt,
  enabled = true,
}: {
  expiresAt: string;
  enabled?: boolean;
}) {
  const [status, setStatus] = useState<PollStatus>('polling');
  const [retryCount, setRetryCount] = useState(0);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  const getInterval = useCallback(() => {
    const elapsed = Date.now() - startedAt.current;
    if (elapsed < BACKOFF_AFTER_MS) return BASE_INTERVAL_MS;
    const factor = Math.min(Math.floor((elapsed - BACKOFF_AFTER_MS) / 10_000) + 1, 4);
    return Math.min(BASE_INTERVAL_MS * Math.pow(1.5, factor), MAX_INTERVAL_MS);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    activeRef.current = true;
    startedAt.current = Date.now();

    const poll = async () => {
      if (!activeRef.current) return;
      if (new Date(expiresAt).getTime() <= Date.now()) {
        setStatus('expired');
        return;
      }
      try {
        const box = await getBox();
        if (!activeRef.current) return;
        const outcome = boxPayOutcome(box);
        if (outcome === 'paid') return setStatus('paid');
        if (outcome === 'closed_budget_only') return setStatus('closed_budget_only');
        timerRef.current = setTimeout(() => void poll(), getInterval());
      } catch {
        if (activeRef.current) setStatus('error');
      }
    };

    void poll();
    return () => {
      activeRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [expiresAt, enabled, getInterval, retryCount]);

  const retry = useCallback(() => {
    setStatus('polling');
    startedAt.current = Date.now();
    setRetryCount((c) => c + 1);
  }, []);

  return { status, retry };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/mobile exec vitest run src/hooks/useBoxPaymentPoll.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/useBoxPaymentPoll.ts apps/mobile/src/hooks/useBoxPaymentPoll.test.tsx
git commit -m "feat(mobile): useBoxPaymentPoll polls the box until paid or closed"
```

---

### Task 10: Mobile — `/caixa/pagar` screen + entry-point wiring

**Files:**

- Create: `apps/mobile/app/(app)/caixa/pagar.tsx`
- Modify: `apps/mobile/app/(app)/caixa/revisar.tsx`
- Modify: `apps/mobile/app/(app)/caixa/index.tsx`
- Test: typecheck + the pure helpers already cover logic (this repo has no RN render tests for caixa screens).

**Interfaces:**

- Consumes: `useBoxPay` (Task 8), `useBoxPaymentPoll` (Task 9), `caixaCopy.pay` (Task 6), `HiddenQR`, `expo-clipboard`, `useCountdown` pattern from `checkout-pix.tsx`.
- Produces: route `/caixa/pagar`; `revisar.tsx` navigates there on `chargeCents > 0`; `index.tsx` "Retomar pagamento" navigates there.

- [ ] **Step 1: Build the pay screen**

Create `apps/mobile/app/(app)/caixa/pagar.tsx`. On mount: call `useBoxPay().checkout()`. States:

- loading -> `CaixaSkeleton`.
- checkout error `retry` -> banner with `caixaCopy.pay.error` + `caixaCopy.pay.reconnect` button re-running checkout.
- checkout error `toast_home` -> `router.replace('/caixa')`.
- ok -> render `HiddenQR value={data.brCode}` + copy button (`Clipboard.setStringAsync`) + countdown to `data.expiresAt` (reuse the `useCountdown` helper shape from `checkout-pix.tsx:13-28`) + start `useBoxPaymentPoll({ expiresAt: data.expiresAt })`.
- poll `paid` -> success view (`caixaCopy.pay.success`) then back to `/caixa`.
- poll `closed_budget_only` -> `caixaCopy.pay.closedBudgetOnly` then back to `/caixa`.
- poll `expired` -> `caixaCopy.pay.expired`.
- poll `error` -> retry banner (`useBoxPaymentPoll().retry`).
  Header with a back arrow + `router.replace('/caixa')` fallback (mirror `revisar.tsx`'s `Header`). Do NOT extract a shared cart component; reuse only `HiddenQR` + `expo-clipboard`.

- [ ] **Step 2: Wire the entry points**

In `apps/mobile/app/(app)/caixa/revisar.tsx`, change the `onConfirm` success branch (revisar.tsx:177-180) from:

```tsx
if (result === 'ok') {
  router.replace('/caixa' as never);
  return;
}
```

to:

```tsx
if (result === 'ok') {
  router.replace((box.chargeCents > 0 ? '/caixa/pagar' : '/caixa') as never);
  return;
}
```

In `apps/mobile/app/(app)/caixa/index.tsx`, replace the disabled "Retomar pagamento" button + `comingSoon` caption (index.tsx:294-301) with:

```tsx
<Button
  label={caixaCopy.actions.resumePayment}
  onPress={() => router.replace('/caixa/pagar' as never)}
  className="mt-2"
/>
```

Remove the now-dead `caixaCopy.awaiting.comingSoon` reference. If `router` is not imported in `index.tsx`, add `import { router } from 'expo-router';`.

- [ ] **Step 3: Typecheck + run the mobile caixa tests**

Run: `pnpm --filter @ccc/mobile typecheck`
Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa src/hooks`
Expected: PASS, no dangling `comingSoon` reference.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(app\)/caixa/pagar.tsx apps/mobile/app/\(app\)/caixa/revisar.tsx apps/mobile/app/\(app\)/caixa/index.tsx apps/mobile/src/copy/caixa.ts
git commit -m "feat(mobile): box Pix pay screen + resume/confirm entry points"
```

---

## Post-plan verification

- [ ] Full API suite: `pnpm --filter @ccc/api test` (Docker up).
- [ ] Full mobile suite: `pnpm --filter @ccc/mobile test` + `pnpm --filter @ccc/mobile typecheck`.
- [ ] Shared: `pnpm --filter @ccc/shared test`.
- [ ] Manual/QA before go-live (NOT code): AbacatePay sandbox — confirm a Pix charge is unpayable after `expiresIn`. Documented as the load-bearing assumption in the spec. Only then flip `EXPO_PUBLIC_CAIXA_ENABLED`.

## Out of scope (do not build)

- Fulfillment status/timeline/admin (Screen 09) — 4b.
- Refund flow + any post-cutoff late-payment recovery beyond the manual-refund flag — 4c.
- Stripe/Apple Pay for box (box dark on iOS).
- A generic Pix reconciliation worker (tracked in the payments roadmap; when built it must sweep `kind:'box'`).
