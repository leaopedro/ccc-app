# Box Builder Fase 5 — Notificacoes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar um push transacional ao membro a cada marco do ciclo da caixa (pagamento confirmado, pronta no cutoff, enviada, entregue), reusando a infra de push existente.

**Architecture:** Abordagem "no ponto de gatilho". Cada push dispara no site que ja existe: webhook do Pix (`settle.ts` + `abacatepay-webhook.ts`), worker de cutoff (`box-cutoff.ts`), rota admin de advance (`fulfillment.ts` + `box-fulfillment-admin.ts`). Um helper unico (`services/box/notifications.ts`) centraliza copy + envio via `sendTransactionalPush`. Sem worker novo, sem polling, sem migration, sem mudanca mobile.

**Tech Stack:** TypeScript, Fastify, Prisma/Postgres, Zod, Vitest + Testcontainers.

**Spec:** `docs/superpowers/specs/2026-08-15-box-builder-fase-5-notifications-design.md`

## Global Constraints

- Copy PT-BR com acentos corretos. Valores exatos na Task 2 (normativos).
- Sem migration. Reusa `Notification`, `DeviceToken`, `sendTransactionalPush`.
- `dedupeKey = boxId`. Destino dos quatro: `{ kind: 'internal_path', path: '/caixa' }`.
- Push e fire-and-forget: erro sempre logado, nunca derruba o gatilho nem muda a resposta HTTP.
- Nunca tocar `Order.status`. So webhook verificado vira `paid`.
- Dono do box resolvido por `membership.garage.userId`.
- Testes de API batem Postgres real (Testcontainers), nunca mock.
- Nao tocar codigo mobile. Nao tocar codigo admin web.
- 4 kinds: `box.paid`, `box.ready`, `box.shipped`, `box.delivered`. `packed` NAO notifica.

---

### Task 1: Shared — novos push kinds

**Files:**

- Modify: `packages/shared/src/push.ts:22-28`
- Test: `packages/shared/src/__tests__/push.test.ts` (Create)

**Interfaces:**

- Consumes: nada.
- Produces: `pushKindSchema` aceita `box.paid`, `box.ready`, `box.shipped`, `box.delivered`. `PushKind` inclui os quatro. Consumido pelo helper (Task 2) e por `sendTransactionalPush` (cujo `kind: PushKind`).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/push.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pushKindSchema } from '../push.js';

describe('pushKindSchema', () => {
  it('accepts the box milestone kinds', () => {
    expect(pushKindSchema.parse('box.paid')).toBe('box.paid');
    expect(pushKindSchema.parse('box.ready')).toBe('box.ready');
    expect(pushKindSchema.parse('box.shipped')).toBe('box.shipped');
    expect(pushKindSchema.parse('box.delivered')).toBe('box.delivered');
  });

  it('still accepts existing kinds', () => {
    expect(pushKindSchema.parse('ticket.confirmed')).toBe('ticket.confirmed');
    expect(pushKindSchema.parse('broadcast')).toBe('broadcast');
  });

  it('rejects unknown kinds', () => {
    expect(pushKindSchema.safeParse('box.unknown').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/shared test -- push.test.ts`
Expected: FAIL (`box.paid` not in enum).

- [ ] **Step 3: Add the four kinds**

In `packages/shared/src/push.ts`, extend `pushKindSchema`:

```ts
export const pushKindSchema = z.enum([
  'ticket.confirmed',
  'event.reminder_24h',
  'event.reminder_1h',
  'broadcast',
  'box.paid',
  'box.ready',
  'box.shipped',
  'box.delivered',
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/shared test -- push.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/push.ts packages/shared/src/__tests__/push.test.ts
git commit -m "feat(shared): box milestone push kinds"
```

---

### Task 2: Helper de push da caixa

**Files:**

- Create: `apps/api/src/services/box/notifications.ts`
- Test: `apps/api/test/box/box-notifications.test.ts` (Create)

**Interfaces:**

- Consumes: `pushKindSchema` values (Task 1); `sendTransactionalPush` de `services/push/transactional.js`; `PushSender` de `services/push/index.js`.
- Produces: `sendBoxPush(sender: PushSender, input: { userId: string; boxId: string; kind: BoxPushKind }): Promise<void>` onde `type BoxPushKind = 'box.paid' | 'box.ready' | 'box.shipped' | 'box.delivered'`. Consumido pelas Tasks 3, 4, 5.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/box/box-notifications.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { sendBoxPush } from '../../src/services/box/notifications.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('sendBoxPush', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a notification with box copy, /caixa destination and boxId dedupe', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const sender = new DevPushSender();

    await sendBoxPush(sender, { userId: user.id, boxId: 'box_1', kind: 'box.shipped' });

    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'box.shipped' },
    });
    expect(notif.dedupeKey).toBe('box_1');
    expect(notif.title).toBe('Caixa enviada');
    expect(notif.destination).toEqual({ kind: 'internal_path', path: '/caixa' });
    expect(sender.captured.length).toBe(1);
  });

  it('dedupes a repeated send for the same box and kind', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const sender = new DevPushSender();

    await sendBoxPush(sender, { userId: user.id, boxId: 'box_1', kind: 'box.ready' });
    await sendBoxPush(sender, { userId: user.id, boxId: 'box_1', kind: 'box.ready' });

    const count = await prisma.notification.count({
      where: { userId: user.id, kind: 'box.ready' },
    });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- box-notifications.test.ts`
Expected: FAIL (module `notifications.js` not found).

- [ ] **Step 3: Create the helper**

Create `apps/api/src/services/box/notifications.ts`:

```ts
import type { PushSender } from '../push/index.js';
import { sendTransactionalPush } from '../push/transactional.js';

export type BoxPushKind = 'box.paid' | 'box.ready' | 'box.shipped' | 'box.delivered';

const COPY: Record<BoxPushKind, { title: string; body: string }> = {
  'box.paid': {
    title: 'Pagamento confirmado',
    body: 'Recebemos o pagamento. Sua caixa esta confirmada.',
  },
  'box.ready': {
    title: 'Caixa confirmada',
    body: 'Sua caixa deste mes foi fechada e entrou na fila.',
  },
  'box.shipped': {
    title: 'Caixa enviada',
    body: 'Sua caixa saiu para entrega.',
  },
  'box.delivered': {
    title: 'Caixa entregue',
    body: 'Sua caixa foi entregue. Aproveite.',
  },
};

// Single reuse point for all four box milestone pushes. dedupeKey = boxId
// (kind is already part of Notification's unique key). Destination lands the
// member on the Caixa screen after they open the inbox item.
export const sendBoxPush = async (
  sender: PushSender,
  input: { userId: string; boxId: string; kind: BoxPushKind },
): Promise<void> => {
  const copy = COPY[input.kind];
  await sendTransactionalPush(
    {
      userId: input.userId,
      kind: input.kind,
      dedupeKey: input.boxId,
      title: copy.title,
      body: copy.body,
      data: { boxId: input.boxId },
      destination: { kind: 'internal_path', path: '/caixa' },
    },
    { sender },
  );
};
```

Nota de acentos: ao escrever o arquivo, use os caracteres acentuados reais nas strings de copy (`esta` -> `está`, `mes` -> `mês`). O bloco acima usa ASCII so por limitacao do documento; a copy final deve ter acento.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- box-notifications.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/box/notifications.ts apps/api/test/box/box-notifications.test.ts
git commit -m "feat(api): box push helper (copy + send)"
```

---

### Task 3: Gatilho box.paid (webhook do Pix)

**Files:**

- Modify: `apps/api/src/services/orders/settle.ts:16-19` (result type), `:85-112` (box branch)
- Modify: `apps/api/src/routes/abacatepay-webhook.ts:548-554` (single-order settle callsite) + imports
- Test: `apps/api/test/box/box-settle.test.ts` (append), `apps/api/test/box/box-webhook.test.ts` (append)

**Interfaces:**

- Consumes: `sendBoxPush` (Task 2).
- Produces: `SettledOrderResult` ramo box vira `{ kind: 'box'; paidBox?: { userId: string; boxId: string } }`. `paidBox` presente quando o flip ocorreu.

- [ ] **Step 1: Write the failing service test**

Append to `apps/api/test/box/box-settle.test.ts` (dentro do `describe` existente; `seedAwaitingBox` ja existe no arquivo e retorna `{ user, order, box }` — confira o shape do retorno e ajuste a desestruturacao):

```ts
it('returns paidBox with owner userId and boxId on box settle', async () => {
  const { user, order, box } = await seedAwaitingBox(2000);
  const result = await settlePaidOrder(order.id, 'bill_paid_1', env);
  expect(result).toEqual({ kind: 'box', paidBox: { userId: user.id, boxId: box.id } });
});
```

Se `seedAwaitingBox` nao retornar `user`/`box`, ajuste-o para retornar `{ user, order, box }` sem alterar os testes existentes.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- box-settle.test.ts`
Expected: FAIL (`result` nao tem `paidBox`).

- [ ] **Step 3: Implement the settle return**

In `apps/api/src/services/orders/settle.ts`, update the box member of `SettledOrderResult`:

```ts
export type SettledOrderResult =
  | { kind: 'ticket' | 'extras_only'; issued: IssueResult }
  | { kind: 'product' | 'mixed'; issued?: IssueResult[] }
  | { kind: 'box'; paidBox?: { userId: string; boxId: string } };
```

In the box branch, extend the `findFirst` select and the return (current lines 85-112):

```ts
const box = await prisma.monthlyBox.findFirst({
  where: { orderId },
  select: {
    id: true,
    garageId: true,
    membership: { select: { garage: { select: { userId: true } } } },
  },
});
if (!box) throw new OrderNotPendingError(orderId, 'cancelled');

await prisma.$transaction(async (tx) => {
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
return {
  kind: 'box',
  paidBox: { userId: box.membership.garage.userId, boxId: box.id },
};
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `pnpm --filter @ccc/api test -- box-settle.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing webhook test**

Append to `apps/api/test/box/box-webhook.test.ts`. Seed a PENDING box order + `awaiting_payment` box, drive the webhook, assert the `box.paid` notification. Use the file's existing `makeV2TransparentCompletedPayload` and `app.inject` pattern; seed like `box-settle.test.ts`'s `seedAwaitingBox` (import prisma models inline). Hoist the sender so you can assert `captured`:

```ts
it('sends box.paid push when a pending box order settles', async () => {
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
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      kind: 'box',
      amountCents: 2000,
      baseAmountCents: 2000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
      method: 'pix',
      provider: 'abacatepay',
      status: 'pending',
      shippingCents: 0,
    },
  });
  await prisma.monthlyBox.create({
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
      chargeCents: 2000,
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: webhookUrl,
    headers: { 'content-type': 'application/json' },
    payload: makeV2TransparentCompletedPayload('bill_box_1', 'evt_box_1', { orderId: order.id }),
  });
  expect(res.statusCode).toBe(200);

  const notif = await prisma.notification.findFirst({
    where: { userId: user.id, kind: 'box.paid' },
  });
  expect(notif?.dedupeKey).toBeTruthy();
});
```

Se o `beforeEach`/`app` do arquivo construir o app com um `DevPushSender` novo inline, extraia-o para uma const de escopo do teste para poder inspecionar `captured` se quiser; a asercao por `prisma.notification` acima ja e suficiente.

- [ ] **Step 6: Run webhook test to verify it fails**

Run: `pnpm --filter @ccc/api test -- box-webhook.test.ts`
Expected: FAIL (nenhuma notification `box.paid`).

- [ ] **Step 7: Send the push from the webhook**

In `apps/api/src/routes/abacatepay-webhook.ts`, add the import near the other service imports:

```ts
import { sendBoxPush } from '../services/box/notifications.js';
```

After the single-order `settled` handling (right after the `settled.kind === 'ticket' || settled.kind === 'extras_only'` block, still inside the same `try`), add:

```ts
if (settled.kind === 'box' && settled.paidBox) {
  try {
    await sendBoxPush(app.push, {
      userId: settled.paidBox.userId,
      boxId: settled.paidBox.boxId,
      kind: 'box.paid',
    });
  } catch (pushErr) {
    request.log.warn(
      { err: pushErr, orderId: order.id },
      'abacatepay webhook: box.paid push failed',
    );
  }
}
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `pnpm --filter @ccc/api test -- box-settle.test.ts box-webhook.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/orders/settle.ts apps/api/src/routes/abacatepay-webhook.ts apps/api/test/box/box-settle.test.ts apps/api/test/box/box-webhook.test.ts
git commit -m "feat(api): box.paid push on Pix settle"
```

---

### Task 4: Gatilho box.ready (worker de cutoff)

**Files:**

- Modify: `apps/api/src/workers/box-cutoff.ts:9` (Deps), `:12-92` (resolveBudgetOnly return), `:94-171` (tick), `:173+` (start)
- Modify: `apps/api/src/app.ts:229` (pass sender)
- Test: `apps/api/test/box/box-cutoff.test.ts` (append)

**Interfaces:**

- Consumes: `sendBoxPush` (Task 2); `PushSender`.
- Produces: `type Deps = { log?: FastifyBaseLogger; sender?: PushSender }`. `resolveBudgetOnly(tx, boxId): Promise<'ready' | 'skipped'>`. Comportamento externo do tick inalterado exceto o push.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/box/box-cutoff.test.ts`. `makeBox` ja existe e retorna a caixa; confira se retorna `user`/`box` e ajuste. Import `DevPushSender`:

```ts
it('sends box.ready when a budget-only box resolves to ready at cutoff', async () => {
  const { user, box } = await makeBox({
    status: 'open',
    autoSendOptIn: true,
    withItem: true,
    withAddress: true,
    budget: 10000,
  });
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
  });
  const sender = new DevPushSender();

  await runBoxCutoffTick({ sender });

  const box2 = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
  expect(box2.status).toBe('ready');
  const notif = await prisma.notification.findFirst({
    where: { userId: user.id, kind: 'box.ready' },
  });
  expect(notif?.dedupeKey).toBe(box.id);
  expect(sender.captured.length).toBe(1);
});

it('does not send box.ready when a box is skipped at cutoff', async () => {
  const { user } = await makeBox({ status: 'open', withItem: false });
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
  });
  const sender = new DevPushSender();

  await runBoxCutoffTick({ sender });

  const count = await prisma.notification.count({
    where: { userId: user.id, kind: 'box.ready' },
  });
  expect(count).toBe(0);
  expect(sender.captured.length).toBe(0);
});
```

Se `makeBox` nao retornar `user`/`box`, ajuste-o para retornar ambos sem quebrar os testes existentes.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- box-cutoff.test.ts`
Expected: FAIL (`runBoxCutoffTick` nao aceita `sender` / nenhuma notification).

- [ ] **Step 3: Implement resolveBudgetOnly return + tick notify + Deps.sender**

In `apps/api/src/workers/box-cutoff.ts`:

Add the import:

```ts
import type { PushSender } from '../services/push/index.js';
import { sendBoxPush } from '../services/box/notifications.js';
```

Change `Deps`:

```ts
type Deps = { log?: FastifyBaseLogger; sender?: PushSender };
```

Change `resolveBudgetOnly` to return the resulting status. Its final block becomes:

```ts
await recalcBoxTotals(tx, boxId);
const remaining = await tx.monthlyBoxItem.count({ where: { boxId, included: true } });
const status = remaining === 0 ? 'skipped' : 'ready';
await tx.monthlyBox.update({ where: { id: boxId }, data: { status } });
return status;
```

Update its signature: `const resolveBudgetOnly = async (tx: Prisma.TransactionClient, boxId: string): Promise<'ready' | 'skipped'> => {`.

Rewrite `runBoxCutoffTick` so the transaction returns notify info and the push fires post-commit:

```ts
export const runBoxCutoffTick = async (deps: Deps): Promise<void> => {
  const now = new Date();
  const due = await prisma.monthlyBox.findMany({
    where: { status: { in: ['open', 'awaiting_payment'] }, cutoffAt: { lte: now } },
    select: { id: true, garageId: true },
    take: 50,
  });

  for (const { id, garageId } of due) {
    try {
      const notify = await prisma.$transaction(async (tx): Promise<{ userId: string } | null> => {
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
        const box = await tx.monthlyBox.findUnique({
          where: { id },
          include: {
            items: true,
            membership: { select: { garage: { select: { userId: true } } } },
          },
        });
        if (!box) return null;
        if (box.status !== 'open' && box.status !== 'awaiting_payment') return null;

        const hasItems = box.items.some((i) => i.included);
        const userId = box.membership.garage.userId;

        if (box.status === 'open') {
          if (!hasItems || !box.autoSendOptIn || !box.shippingAddressId) {
            await tx.monthlyBox.update({ where: { id }, data: { status: 'skipped' } });
            return null;
          }
          const status = await resolveBudgetOnly(tx, id);
          return status === 'ready' ? { userId } : null;
        }

        // awaiting_payment: cancel the pending Order unless it already settled.
        if (box.orderId) {
          const cancelled = await tx.order.updateMany({
            where: { id: box.orderId, status: 'pending' },
            data: { status: 'cancelled', fulfillmentStatus: 'cancelled' },
          });
          if (cancelled.count === 0) {
            const ord = await tx.order.findUnique({
              where: { id: box.orderId },
              select: { status: true },
            });
            if (ord?.status === 'paid') {
              // Pix already settled: leave for the paid path. box.paid already
              // fired at settle; do not double-notify here.
              return null;
            }
          }
          await tx.monthlyBox.update({ where: { id }, data: { orderId: null } });
          for (const line of box.items.filter((i) => i.included)) {
            await releaseCycleStock(tx, {
              catalogItemId: line.catalogItemId,
              cycleKey: box.cycleKey,
              quantity: line.quantity,
            });
          }
        }
        const status = await resolveBudgetOnly(tx, id);
        return status === 'ready' ? { userId } : null;
      });

      if (notify && deps.sender) {
        try {
          await sendBoxPush(deps.sender, { userId: notify.userId, boxId: id, kind: 'box.ready' });
        } catch (err) {
          deps.log?.error({ err, boxId: id }, '[box-cutoff] box.ready push failed');
        }
      }
    } catch (err) {
      deps.log?.error({ err, boxId: id }, '[box-cutoff] failed to resolve box');
    }
  }
};
```

Preserve os comentarios explicativos do bloco `awaiting_payment` original que ainda se aplicam (reserva/release). Nao mude a semantica de estoque.

- [ ] **Step 4: Wire the sender in app.ts**

In `apps/api/src/app.ts`, change the box cutoff worker start (line ~229):

```ts
const boxCutoffWorker = startBoxCutoffWorker({ log: app.log, sender: app.push });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ccc/api test -- box-cutoff.test.ts box-cutoff-optin.test.ts`
Expected: PASS (os testes antigos que chamam `runBoxCutoffTick({})` continuam verdes; `sender` e opcional).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/box-cutoff.ts apps/api/src/app.ts apps/api/test/box/box-cutoff.test.ts
git commit -m "feat(api): box.ready push on cutoff resolve"
```

---

### Task 5: Gatilho box.shipped / box.delivered (advance admin)

**Files:**

- Modify: `apps/api/src/services/box/fulfillment.ts:23-28` (result type), `:35-44` (select), `:107` (ok return)
- Modify: `apps/api/src/routes/admin/box-fulfillment-admin.ts:36-39` (ok case) + imports
- Test: `apps/api/test/box/box-fulfillment.test.ts` (append)

**Interfaces:**

- Consumes: `sendBoxPush` (Task 2).
- Produces: `BoxAdvanceResult` variante ok vira `{ kind: 'ok'; fulfillmentStatus: BoxFulfillmentStatus; userId: string; boxId: string }`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/box/box-fulfillment.test.ts`. O arquivo ja constroi um app e semeia caixas `ready`; siga o helper de seed existente (procure a funcao que cria a caixa `ready` com membership + garage). Precisa de um device token pro dono. Assert por notification:

```ts
it('sends box.shipped push on advance to shipped', async () => {
  // Seed a ready box (reuse the file's existing seed helper) and capture its
  // owner userId + boxId. Register a device token for the owner.
  const seeded = await seedReadyBox(); // use whatever the file already defines
  await prisma.deviceToken.create({
    data: {
      userId: seeded.userId,
      expoPushToken: 'ExponentPushToken[abc1234567]',
      platform: 'ios',
    },
  });

  // advance unfulfilled -> packed (no push), then packed -> shipped (push).
  await advanceBoxFulfillment({ boxId: seeded.boxId, to: 'packed', actorId: seeded.userId });
  const packedNotif = await prisma.notification.count({
    where: { userId: seeded.userId, kind: 'box.paid' },
  });
  expect(packedNotif).toBe(0);

  const res = await advanceBoxFulfillment({
    boxId: seeded.boxId,
    to: 'shipped',
    actorId: seeded.userId,
  });
  expect(res).toMatchObject({ kind: 'ok', userId: seeded.userId, boxId: seeded.boxId });
});
```

Nota: `advanceBoxFulfillment` (servico) NAO envia push; o envio e na rota. Para testar o envio, prefira exercitar a rota via `app.inject` se o arquivo ja constroi o app; nesse caso, apos o POST de advance para `shipped`, assert `prisma.notification.findFirst({ where: { kind: 'box.shipped' } })` existe, e apos um POST para `packed` que NAO existe notification. Se o arquivo so testa o servico, adicione um teste de rota no mesmo arquivo seguindo o padrao de `box-fulfillment-admin` (importe `buildApp` + `DevPushSender`). Escolha o caminho que casa com o setup existente do arquivo.

Assertions minimas exigidas:

- advance para `shipped` cria `Notification` kind `box.shipped` (dedupeKey = boxId).
- advance para `delivered` cria `Notification` kind `box.delivered`.
- advance para `packed` NAO cria nenhuma `Notification` de caixa.
- resultado ok do servico inclui `userId` e `boxId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api test -- box-fulfillment.test.ts`
Expected: FAIL (ok sem `userId`/`boxId`; nenhuma notification).

- [ ] **Step 3: Return owner from the advance service**

In `apps/api/src/services/box/fulfillment.ts`, update the ok member:

```ts
export type BoxAdvanceResult =
  | { kind: 'ok'; fulfillmentStatus: BoxFulfillmentStatus; userId: string; boxId: string }
  | { kind: 'not_found' }
  | { kind: 'not_ready' }
  | { kind: 'order_not_paid' }
  | { kind: 'invalid_transition'; from: BoxFulfillmentStatus; to: string };
```

Extend the initial `findUnique` select to include the owner:

```ts
const box = await prisma.monthlyBox.findUnique({
  where: { id: input.boxId },
  select: {
    id: true,
    status: true,
    fulfillmentStatus: true,
    orderId: true,
    order: { select: { status: true } },
    membership: { select: { garage: { select: { userId: true } } } },
  },
});
```

Update the final ok return (line ~107):

```ts
return {
  kind: 'ok',
  fulfillmentStatus: input.to,
  userId: box.membership.garage.userId,
  boxId: box.id,
};
```

- [ ] **Step 4: Send the push from the route**

In `apps/api/src/routes/admin/box-fulfillment-admin.ts`, add the import:

```ts
import { sendBoxPush } from '../../services/box/notifications.js';
```

Replace the `case 'ok':` block:

```ts
      case 'ok':
        if (body.to === 'shipped' || body.to === 'delivered') {
          try {
            await sendBoxPush(app.push, {
              userId: result.userId,
              boxId: result.boxId,
              kind: `box.${body.to}`,
            });
          } catch (err) {
            request.log.warn({ err, boxId: id }, 'admin box advance: push failed');
          }
        }
        return reply.send({ id, fulfillmentStatus: result.fulfillmentStatus });
```

`body.to` esta estreitado para `'shipped' | 'delivered'` no `if`, entao `` `box.${body.to}` `` tipa como `'box.shipped' | 'box.delivered'` (um `BoxPushKind` valido).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- box-fulfillment.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/box/fulfillment.ts apps/api/src/routes/admin/box-fulfillment-admin.ts apps/api/test/box/box-fulfillment.test.ts
git commit -m "feat(api): box.shipped/box.delivered push on advance"
```

---

## Verificacao final (apos todas as tasks)

- [ ] `pnpm --filter @ccc/shared test` verde.
- [ ] `pnpm --filter @ccc/api test -- box-` verde (suite de box).
- [ ] `pnpm -w typecheck` verde (ou o script de typecheck do repo).
- [ ] `pnpm -w lint` verde.
- [ ] Conferir manualmente que a copy nos arquivos finais tem acentos corretos (está, mês, aproveite).
