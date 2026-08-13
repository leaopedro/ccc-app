# Fase 0 — Correções de billing: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os defeitos de billing confirmados no código para que nenhuma cobrança real possa entrar sem virar estado correto no banco.

**Architecture:** Todas as correções são no `apps/api`. Três eixos: o seam do webhook passa a carregar o envelope completo da Stripe; os normalizadores param de devolver `null` silencioso para formas desconhecidas e passam a falhar alto; e o caminho de carrinho ganha o `providerRef` que hoje não grava, destravando refund e revogação.

**Tech Stack:** Fastify, Prisma, Postgres, Stripe SDK 22.1.0 (`2026-04-22.dahlia`), vitest, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-08-12-billing-fixes-design.md`

## Global Constraints

- Nenhum pedido e nenhuma membership muda de estado por chamada do cliente. Só por webhook verificado.
- Dedupe por id de evento do provedor, via constraint única no banco, nunca leitura seguida de escrita.
- Testes de integração da API batem em Postgres real via Testcontainers, nunca mocks (CLAUDE.md).
- Rodar um arquivo: `cd apps/api && pnpm exec vitest run test/<caminho>`. **Não** usar `pnpm --filter @ccc/api test -- <arquivo>`: o `--` não filtra, roda a suíte inteira (2243 testes, cerca de 13 minutos) e mesmo assim mostra o resultado do arquivo no meio do ruído. Medido em 2026-08-13.
- Docker precisa estar rodando. O `test/global-setup.ts` sobe Postgres via Testcontainers para **toda** a suíte, inclusive testes puros de unidade como os do normalizador. Sem daemon, nada roda: `Could not find a working container runtime strategy`.
- `eslint` na raiz estoura memória; lintar por pacote com `cd apps/api && pnpm lint`. A base tem 72 warnings pré-existentes e 0 erros; o alvo é não aumentar nenhum dos dois.
- Idioma do código e dos comentários novos: inglês, como o resto de `apps/api`.
- Copy voltada ao usuário: PT-BR.
- Branch a partir de `main` fresco. PR para `main`. Nunca commitar em `production`.

---

## Task 1: Envelope do webhook carrega `previous_attributes` — CONCLUÍDA

> Executada em 2026-08-13, commit `69b8a8f`. O plano pedia migrar fixtures um a um;
> na prática bastou levantar o campo dentro do helper de evento de cada arquivo.
> Adicionado além do plano: pin de regressão no próprio seam
> (`test/billing/stripe-construct-webhook-event.test.ts`), verificado revertendo
> `index.ts` e vendo o teste falhar. O seam não tinha cobertura nenhuma do caminho
> de sucesso.

Sem isto, todo `customer.subscription.updated` normaliza para `null` e cancelamento nunca chega ao banco.

**Files:**

- Modify: `apps/api/src/services/stripe/index.ts` (tipo `WebhookEvent` na linha ~32, `constructWebhookEvent` na linha ~322)
- Modify: `apps/api/src/services/billing/normalize-stripe.ts:187-194`
- Test: `apps/api/test/billing/normalize-stripe.test.ts`
- Test: `apps/api/test/billing/normalize-stripe-pause.test.ts`
- Test: `apps/api/test/billing/normalize-stripe-price-swap.test.ts`
- Test: `apps/api/test/billing/stripe-billing-webhook.test.ts`

**Interfaces:**

- Consumes: nada de tarefas anteriores.
- Produces: `WebhookEvent.data.previous_attributes?: Record<string, unknown>`, lido por todas as tarefas seguintes que tocam o normalizador.

- [x] **Step 1: Escrever o teste que falha**

Em `apps/api/test/billing/normalize-stripe.test.ts`, adicionar um helper que monta o envelope na forma REAL da Stripe e um teste de cancelamento usando ele. O helper `mkEvent` atual só aceita `object`; adicione um segundo:

```ts
// Envelope real da Stripe: previous_attributes é IRMÃO de object, não filho.
const mkEventWithPrev = (
  type: string,
  object: Record<string, unknown>,
  previousAttributes: Record<string, unknown>,
): WebhookEvent => ({
  id: `evt_test_${type.replace(/\./g, '_')}`,
  type,
  data: { object, previous_attributes: previousAttributes },
});

it('normalizes cancel_at_period_end flip from envelope-level previous_attributes', () => {
  const result = normalizeStripeEvent(
    mkEventWithPrev(
      'customer.subscription.updated',
      {
        id: 'sub_test_001',
        customer: 'cus_test_001',
        status: 'active',
        cancel_at_period_end: true,
        current_period_end: 1750892000,
        canceled_at: null,
        pause_collection: null,
        items: {
          data: [
            {
              price: {
                id: 'price_monthly_test',
                metadata: { baseAmountCents: '4536', devFeePercent: '10' },
                recurring: { interval: 'month' },
              },
            },
          ],
        },
      },
      { cancel_at_period_end: false },
    ),
  );

  expect(result).not.toBeNull();
  expect(result?.kind).toBe('subscription.cancelled');
});
```

- [x] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/billing/normalize-stripe.test.ts`
Expected: FAIL. `result` é `null`, porque o normalizador lê `previous_attributes` de dentro de `data.object`.

- [x] **Step 3: Alargar o tipo `WebhookEvent`**

Em `apps/api/src/services/stripe/index.ts`, substituir a declaração:

```ts
export type WebhookEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
    /**
     * Sibling of `object` in Stripe's event envelope, present on `*.updated`
     * events. Load-bearing: the billing normalizer discriminates cancel,
     * uncancel, pause, resume and tier change by diffing against it. Dropping
     * it here silently disables every one of those transitions.
     */
    previous_attributes?: Record<string, unknown>;
  };
};
```

- [x] **Step 4: Carregar o campo no seam**

Em `constructWebhookEvent` (mesmo arquivo, ~linha 325), trocar o objeto retornado:

```ts
const event = stripe.webhooks.constructEvent(payload, signature, secret);
return {
  id: event.id,
  type: event.type,
  data: {
    object: event.data.object as unknown as Record<string, unknown>,
    ...(event.data.previous_attributes
      ? {
          previous_attributes: event.data.previous_attributes as unknown as Record<string, unknown>,
        }
      : {}),
  },
};
```

- [x] **Step 5: Ler do lugar certo no normalizador**

Em `apps/api/src/services/billing/normalize-stripe.ts`, no bloco de `customer.subscription.updated`: remover `previous_attributes` do type cast do `sub` (linhas ~187-192) e trocar a linha 194 por:

```ts
const prev = (event.data.previous_attributes ?? {}) as {
  cancel_at_period_end?: boolean;
  pause_collection?: { behavior?: string } | null;
  items?: { data: Array<{ price: { id: string } }> };
};
```

- [x] **Step 6: Rodar o teste novo**

Run: `cd apps/api && pnpm exec vitest run test/billing/normalize-stripe.test.ts`
Expected: PASS no teste novo. Os testes antigos que aninham `previous_attributes` dentro de `object` agora FALHAM, e é isso que queremos: eles codificavam o defeito.

- [x] **Step 7: Corrigir os fixtures antigos**

Nos quatro arquivos de teste listados em **Files**, todo lugar que monta `previous_attributes` dentro de `data.object` passa a usar `mkEventWithPrev` (ou equivalente local). Não apagar os casos, só mover o campo para o nível certo do envelope.

- [x] **Step 8: Suite completa de billing**

Run: `cd apps/api && pnpm exec vitest run test/billing`
Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add apps/api/src/services/stripe/index.ts apps/api/src/services/billing/normalize-stripe.ts apps/api/test/billing
git commit -m "fix(billing): carry previous_attributes through the webhook seam"
```

---

## Task 2: Forma de invoice desconhecida falha alto em vez de sumir

O normalizador lê `invoice.subscription`, `line.price` e `charge.invoice`. Nenhum dos três existe nos tipos do SDK fixado. Se um endpoint live renderizar a forma nova, `invoice.paid` vira `null`, o handler marca processado e responde 200. Cartão cobrado, membership inexistente, Stripe nunca reenvia.

Não dá para "ler as duas formas" e pronto: na forma nova, `line.pricing.price_details.price` traz só o **id** do Price, enquanto o normalizador precisa de `metadata` e `recurring` do objeto expandido. Ou seja, a forma nova não carrega os dados necessários.

Por isso o desenho é: defesa primária é fixar a versão de API do endpoint (operacional, Spec A §2); defesa secundária é distinguir "não é invoice de assinatura", que se ignora legitimamente, de "forma não reconhecida", que precisa gritar e ser reentregue.

**Files:**

- Modify: `apps/api/src/services/billing/normalize-stripe.ts`
- Modify: `apps/api/src/routes/stripe-billing-webhook.ts`
- Test: `apps/api/test/billing/normalize-stripe.test.ts`
- Test: `apps/api/test/billing/stripe-billing-webhook.test.ts`

**Interfaces:**

- Consumes: `WebhookEvent.data.previous_attributes` da Task 1.
- Produces: sentinela `UNRECOGNIZED_SHAPE` exportada de `normalize-stripe.ts`, tratada pela rota de billing. Assinatura: `export const UNRECOGNIZED_SHAPE = Symbol('unrecognized_stripe_shape');` e `NormalizeStripeResult` passa a incluir `typeof UNRECOGNIZED_SHAPE`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('flags an invoice.paid in the new API shape as unrecognized, not ignorable', () => {
  // Forma 2026+: subscription vive em parent.subscription_details, e a linha
  // traz pricing.price_details.price (um id), não price expandido.
  const result = normalizeStripeEvent(
    mkEvent('invoice.paid', {
      id: 'in_test_002',
      customer: 'cus_test_001',
      billing_reason: 'subscription_create',
      amount_paid: 4990,
      currency: 'brl',
      period_start: 1748300000,
      period_end: 1750892000,
      parent: { subscription_details: { subscription: 'sub_test_002' } },
      lines: { data: [{ pricing: { price_details: { price: 'price_monthly_test' } } }] },
    }),
  );

  expect(result).toBe(UNRECOGNIZED_SHAPE);
});

it('still returns null for a one-off invoice with no subscription at all', () => {
  const result = normalizeStripeEvent(
    mkEvent('invoice.paid', {
      id: 'in_test_003',
      customer: 'cus_test_001',
      billing_reason: 'manual',
      amount_paid: 1000,
      currency: 'brl',
      period_start: 1748300000,
      period_end: 1750892000,
      lines: { data: [] },
    }),
  );

  expect(result).toBeNull();
});
```

Importar `UNRECOGNIZED_SHAPE` no topo do arquivo de teste.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/billing/normalize-stripe.test.ts`
Expected: FAIL. Hoje o primeiro caso devolve `null`, indistinguível do segundo.

- [ ] **Step 3: Exportar a sentinela e detectar a forma nova**

Em `normalize-stripe.ts`, no topo:

```ts
/**
 * The event carries a subscription invoice we could not parse — almost always
 * because the webhook endpoint renders a newer Stripe API version than the one
 * this normalizer was written against (`2026-04-22.dahlia`). Distinct from
 * `null`, which means "legitimately not our concern". The route must NOT mark
 * these processed: a silent drop here means a paid invoice never activates a
 * membership and Stripe never retries.
 */
export const UNRECOGNIZED_SHAPE = Symbol('unrecognized_stripe_shape');
```

Ajustar o tipo de retorno:

```ts
export type NormalizeStripeResult = BillingEvent | null | typeof UNRECOGNIZED_SHAPE;
```

No bloco `invoice.paid`, substituir os dois guards atuais (`if (!invoice.subscription) return null;` e `if (!linePrice) return null;`) por:

```ts
const newShapeSubRef = (obj as { parent?: { subscription_details?: { subscription?: string } } })
  .parent?.subscription_details?.subscription;

if (!invoice.subscription) {
  // Nova forma: sabemos que é assinatura, mas a linha não traz o Price
  // expandido (só o id), então não dá para ler metadata nem cadência.
  if (newShapeSubRef) return UNRECOGNIZED_SHAPE;
  return null;
}

const linePrice = invoice.lines.data[0]?.price;
if (!linePrice) return UNRECOGNIZED_SHAPE;
```

Aplicar o mesmo padrão nos blocos `invoice.payment_failed` e `charge.refunded`. Para `charge.refunded`, a forma nova não tem `charge.invoice`: se `charge.invoice` estiver ausente **e** existir `charge.payment_intent`, devolver `UNRECOGNIZED_SHAPE`; se não houver nem um nem outro, `null`.

- [ ] **Step 4: Rodar os testes do normalizador**

Run: `cd apps/api && pnpm exec vitest run test/billing/normalize-stripe.test.ts`
Expected: PASS.

- [ ] **Step 5: Escrever o teste de rota**

Em `apps/api/test/billing/stripe-billing-webhook.test.ts`, um teste de integração que entrega um `invoice.paid` na forma nova e afirma 503 mais linha não processada:

```ts
it('returns 503 and leaves the event unprocessed when the payload shape is unrecognized', async () => {
  fake.nextEvent = {
    id: 'evt_unrecognized_001',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_unrecognized_001',
        customer: 'cus_test_001',
        billing_reason: 'subscription_create',
        amount_paid: 4990,
        currency: 'brl',
        period_start: 1748300000,
        period_end: 1750892000,
        parent: { subscription_details: { subscription: 'sub_unrecognized_001' } },
        lines: { data: [{ pricing: { price_details: { price: 'price_monthly_test' } } }] },
      },
    },
  };

  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/stripe-billing',
    headers: { 'stripe-signature': 't=1,v1=fake' },
    payload: Buffer.from('{}'),
  });

  expect(res.statusCode).toBe(503);

  const row = await prisma.subscriptionWebhookEvent.findFirst({
    where: { providerEventId: 'evt_unrecognized_001' },
  });
  expect(row?.processedAt).toBeNull();
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/billing/stripe-billing-webhook.test.ts`
Expected: FAIL com 200, porque a rota trata `null` e `UNRECOGNIZED_SHAPE` do mesmo jeito.

- [ ] **Step 7: Tratar a sentinela na rota**

Em `apps/api/src/routes/stripe-billing-webhook.ts`, no ponto onde o resultado do normalizador é testado contra `null` (ramo de ignorar, ~linhas 335-345), inserir ANTES do teste de `null`:

```ts
if (normalized === UNRECOGNIZED_SHAPE) {
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'billing-webhook-unrecognized-shape');
    scope.setTag('provider', 'stripe');
    scope.setLevel('fatal');
    scope.setExtra('eventType', event.type);
    scope.setExtra('eventId', event.id);
    Sentry.captureMessage('stripe billing webhook: unrecognized payload shape');
  });
  // NÃO marcar processado: 503 faz a Stripe reentregar depois que o
  // endpoint for repinado na versão de API correta.
  return reply
    .status(503)
    .send({ error: 'ServiceUnavailable', message: 'unrecognized payload shape' });
}
```

Importar `UNRECOGNIZED_SHAPE` do normalizador.

- [ ] **Step 8: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/billing`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/billing/normalize-stripe.ts apps/api/src/routes/stripe-billing-webhook.ts apps/api/test/billing
git commit -m "fix(billing): fail loudly on unrecognized Stripe payload shape"
```

---

## Task 3: Pedido de carrinho grava `providerRef`, e refund encontra o carrinho

Hoje pedido de carrinho nunca recebe `providerRef`, então `charge.refunded` não acha o pedido, não marca `refunded` e não revoga o ingresso. Dinheiro sai, entrada continua válida.

**Files:**

- Modify: `apps/api/src/routes/stripe-webhook.ts` (`handleCartPaymentSucceeded` ~linha 107, ramo `charge.refunded` ~linha 310)
- Test: `apps/api/test/cart/` (arquivo novo `cart-refund.test.ts`)

**Interfaces:**

- Consumes: nada.
- Produces: garantia de que todo pedido de carrinho liquidado tem `providerRef` igual ao id da PaymentIntent.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/cart/cart-refund.test.ts`, teste de integração com Postgres real seguindo o padrão dos testes de cart existentes. O caso:

```ts
it('flips every cart order to refunded and revokes the ticket on charge.refunded', async () => {
  // Arrange: carrinho liquidado por payment_intent.succeeded com cartId.
  // (usar os helpers de seed já existentes em test/cart)
  await deliverEvent({
    id: 'evt_pi_succeeded_refund_case',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_refund_case', metadata: { cartId } } },
  });

  // Act
  await deliverEvent({
    id: 'evt_charge_refunded_case',
    type: 'charge.refunded',
    data: {
      object: { payment_intent: 'pi_refund_case', amount: 12000, amount_refunded: 12000 },
    },
  });

  // Assert: banco, não dashboard.
  const orders = await prisma.order.findMany({ where: { cartId } });
  expect(orders.every((o) => o.status === 'refunded')).toBe(true);

  const tickets = await prisma.ticket.findMany({ where: { orderId: orders[0]!.id } });
  expect(tickets.every((t) => t.status === 'revoked')).toBe(true);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/cart/cart-refund.test.ts`
Expected: FAIL. O pedido segue `paid` e o log traz `charge.refunded for unknown order`.

- [ ] **Step 3: Gravar `providerRef` na liquidação do carrinho**

Em `handleCartPaymentSucceeded`, logo após o loop de `settlePaidOrder` e antes do `prisma.cart.update` que marca `converted`:

```ts
// Cart orders are settled with `{ cartId }`, and settlePaidOrder skips
// providerRef for them. Without it, charge.refunded cannot resolve the
// order and the refund silently leaves the ticket valid. Write it on the
// canonical (first) order, matching the pendingOrderId convention.
const firstOrderId = orders[0]?.id;
if (firstOrderId) {
  await prisma.order.updateMany({
    where: { id: firstOrderId, providerRef: null },
    data: { providerRef: piId },
  });
}
```

- [ ] **Step 4: Resolver o carrinho inteiro no refund**

No ramo `charge.refunded`, substituir a busca de pedido único por uma que cubra os irmãos do carrinho:

```ts
const anchor = await prisma.order.findFirst({
  where: { provider: 'stripe', providerRef: piId },
  select: { id: true, status: true, cartId: true },
});

if (!anchor) {
  request.log.warn(
    { paymentIntentId: piId, eventId: event.id },
    'stripe webhook: charge.refunded for unknown order',
  );
  return reply.status(200).send({ ok: true, ignored: true, reason: 'unknown-order' });
}

const affected = anchor.cartId
  ? await prisma.order.findMany({
      where: { cartId: anchor.cartId, status: { in: ['paid', 'partial_refund'] } },
      select: { id: true, status: true },
    })
  : [{ id: anchor.id, status: anchor.status }];
```

Daí para baixo, o código que hoje opera sobre `order` passa a iterar sobre `affected`. O guard de refund parcial (`amountRefunded < amount`) continua antes do laço e inalterado.

- [ ] **Step 5: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/cart/cart-refund.test.ts`
Expected: PASS.

- [ ] **Step 6: Suite de cart e de webhook**

Run: `cd apps/api && pnpm exec vitest run test/cart test/stripe-webhook-push.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/stripe-webhook.ts apps/api/test/cart/cart-refund.test.ts
git commit -m "fix(orders): write providerRef on cart orders and refund the whole cart"
```

---

## Task 4: Pedido de carrinho pago depois de expirar é reembolsado, não descartado

`ORDER_EXPIRY_MS` é 15 minutos; a Checkout Session vive 30 ou mais. Pagando na janela do meio, o handler responde `ignored: true` e ninguém fica sabendo. O caminho de pedido único já reembolsa nesse caso; o de carrinho não.

**Files:**

- Modify: `apps/api/src/routes/stripe-webhook.ts:114-130`
- Test: `apps/api/test/cart/cart-expired-payment.test.ts` (novo)

**Interfaces:**

- Consumes: `providerRef` em pedido de carrinho, da Task 3.
- Produces: nada consumido adiante.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('refunds and alerts when a cart is paid after its orders expired', async () => {
  // Arrange: carrinho com pedidos já expirados pela varredura.
  await prisma.order.updateMany({ where: { cartId }, data: { status: 'expired' } });

  const res = await deliverEvent({
    id: 'evt_pi_succeeded_after_expiry',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_after_expiry', metadata: { cartId } } },
  });

  expect(res.statusCode).toBe(200);
  expect(fake.calls.filter((c) => c.kind === 'refund')).toHaveLength(1);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/cart/cart-expired-payment.test.ts`
Expected: FAIL. Nenhum refund é chamado; a resposta é `ignored: true`.

- [ ] **Step 3: Tratar o ramo sem pendente e sem pago**

Em `handleCartPaymentSucceeded`, dentro de `if (orders.length === 0)`, depois do teste de `alreadyPaid`:

```ts
const dead = await prisma.order.findMany({
  where: { cartId, status: { in: ['expired', 'failed'] } },
  select: { id: true },
});

if (dead.length > 0) {
  // Paid inside a still-valid Checkout Session after the 15-minute
  // reservation sweep already expired the orders. The single-order path
  // refunds here; the cart path used to drop it on the floor.
  await app.stripe.refund(piId, 'order-expired');
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'cart-paid-after-expiry');
    scope.setLevel('error');
    scope.setExtra('cartId', cartId);
    scope.setExtra('paymentIntentId', piId);
    Sentry.captureMessage('stripe webhook: cart paid after expiry, refunded');
  });
  await markProcessed(webhookEvent.id, webhookEvent);
  return reply.status(200).send({ ok: true, refunded: true, reason: 'expired' });
}
```

- [ ] **Step 4: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/cart/cart-expired-payment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/stripe-webhook.ts apps/api/test/cart/cart-expired-payment.test.ts
git commit -m "fix(orders): refund cart payments that land after reservation expiry"
```

---

## Task 5: Disputas e chargebacks

Não existe `charge.dispute.*` em lugar nenhum do caminho Stripe. Ingresso disputado segue válido e a pessoa entra no evento.

**Files:**

- Modify: `apps/api/src/routes/stripe-webhook.ts`
- Test: `apps/api/test/cart/dispute.test.ts` (novo)

**Interfaces:**

- Consumes: `providerRef` da Task 3, e a resolução por carrinho do mesmo passo.
- Produces: nada consumido adiante.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('revokes tickets and alerts on charge.dispute.created', async () => {
  const res = await deliverEvent({
    id: 'evt_dispute_created_001',
    type: 'charge.dispute.created',
    data: { object: { id: 'dp_001', payment_intent: 'pi_refund_case', amount: 12000 } },
  });

  expect(res.statusCode).toBe(200);
  const tickets = await prisma.ticket.findMany({ where: { orderId } });
  expect(tickets.every((t) => t.status === 'revoked')).toBe(true);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/cart/dispute.test.ts`
Expected: FAIL. O evento cai no ramo genérico `{ ok: true, ignored: true }`.

- [ ] **Step 3: Implementar o ramo**

Em `stripe-webhook.ts`, junto dos demais testes de `event.type`:

```ts
if (event.type === 'charge.dispute.created') {
  const dispute = event.data.object as { payment_intent?: string; amount?: number };
  const piId = dispute.payment_intent;
  if (!piId) {
    return reply.status(200).send({ ok: true, ignored: true, reason: 'missing-pi' });
  }

  const anchor = await prisma.order.findFirst({
    where: { provider: 'stripe', providerRef: piId },
    select: { id: true, cartId: true },
  });

  Sentry.withScope((scope) => {
    scope.setTag('kind', 'stripe-dispute-opened');
    scope.setLevel('error');
    scope.setExtra('paymentIntentId', piId);
    scope.setExtra('orderId', anchor?.id ?? null);
    Sentry.captureMessage('stripe webhook: dispute opened');
  });

  if (anchor) {
    const ids = anchor.cartId
      ? (
          await prisma.order.findMany({
            where: { cartId: anchor.cartId },
            select: { id: true },
          })
        ).map((o) => o.id)
      : [anchor.id];
    for (const id of ids) await revokeTicketsForRefundedOrder(id);
  }

  await markProcessed(event.id, event);
  return reply.status(200).send({ ok: true, disputed: true });
}

if (event.type === 'charge.dispute.closed') {
  // Sem ação automática: ganhar ou perder a disputa não devolve o ingresso.
  // O alerta existe para que o operador decida.
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'stripe-dispute-closed');
    scope.setLevel('warning');
    scope.setExtra('eventId', event.id);
    Sentry.captureMessage('stripe webhook: dispute closed');
  });
  await markProcessed(event.id, event);
  return reply.status(200).send({ ok: true, disputeClosed: true });
}
```

`revokeTicketsForRefundedOrder` vem de `../services/orders/revoke.js` e já está
importado em `stripe-webhook.ts:7`. Nenhum import novo é necessário.

- [ ] **Step 4: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/cart/dispute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/stripe-webhook.ts apps/api/test/cart/dispute.test.ts
git commit -m "feat(payments): handle Stripe disputes and revoke entitlement"
```

---

## Task 6: A flag para de descartar eventos

`GROWTH_PREMIUM_BILLING_ENABLED=false` faz a rota retornar antes de persistir o evento. A Stripe marca entregue e não há replay. É isso que torna impossível fazer smoke de assinatura antes de virar a flag.

**Files:**

- Modify: `apps/api/src/routes/stripe-billing-webhook.ts:190-198`
- Test: `apps/api/test/billing/stripe-billing-webhook.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('persists the event and asks Stripe to retry when the billing flag is off', async () => {
  const res = await appWithFlagOff.inject({
    method: 'POST',
    url: '/webhooks/stripe-billing',
    headers: { 'stripe-signature': 't=1,v1=fake' },
    payload: Buffer.from('{}'),
  });

  expect(res.statusCode).toBe(503);
  const row = await prisma.subscriptionWebhookEvent.findFirst({
    where: { providerEventId: fake.nextEvent!.id },
  });
  expect(row).not.toBeNull();
  expect(row?.processedAt).toBeNull();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/billing/stripe-billing-webhook.test.ts`
Expected: FAIL com 200 e nenhuma linha no banco.

- [ ] **Step 3: Mover o gate para depois do insert**

Remover o bloco do gate do topo da rota. Reinseri-lo logo após o `prisma.subscriptionWebhookEvent.create` bem-sucedido e antes do dispatch:

```ts
if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
  request.log.info(
    { eventId: event.id },
    'stripe-billing webhook: flag disabled, stored for replay',
  );
  // 503, não 200: o evento fica persistido e não processado, e a Stripe
  // reentrega. Assim o smoke de assinatura pode rodar logo após a flag
  // subir, sem perder as entregas da janela anterior.
  return reply.status(503).send({ error: 'ServiceUnavailable', message: 'billing disabled' });
}
```

Atenção: a verificação de assinatura precisa continuar acontecendo antes disso, senão a rota passa a persistir lixo não autenticado.

- [ ] **Step 4: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/billing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/stripe-billing-webhook.ts apps/api/test/billing
git commit -m "fix(billing): persist webhook events while the billing flag is off"
```

---

## Task 7: Guardas nas chamadas que quebram com refs de test mode

Depois da virada de chave, `cus_`, `pi_` e `sub_` de test viram `resource_missing`. Três chamadas não têm try/catch e viram 500 permanente.

**Files:**

- Modify: `apps/api/src/routes/me-premium.ts:97-101` e `:256-259`
- Modify: `apps/api/src/routes/orders.ts:690`
- Test: `apps/api/test/billing/stale-refs.test.ts` (novo)

**Interfaces:**

- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('returns a typed error instead of 500 when the Stripe customer no longer exists', async () => {
  fake.nextPortalError = Object.assign(new Error('No such customer'), {
    code: 'resource_missing',
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/me/premium/portal',
    headers: authHeader,
  });

  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ error: 'StaleBillingReference' });
});
```

Adicionar `nextPortalError` ao `fake.ts` seguindo o padrão dos demais campos `next*`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/billing/stale-refs.test.ts`
Expected: FAIL com 500.

- [ ] **Step 3: Envolver as três chamadas**

Criar um helper compartilhado em `apps/api/src/services/billing/stale-ref.ts`:

```ts
import * as Sentry from '@sentry/node';

/** Stripe raises this when a ref from another mode (test vs live) is used. */
const isResourceMissing = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'resource_missing';

/**
 * Rethrows anything that is not a cross-mode reference error. For those,
 * alerts and returns so the caller can answer 409 instead of 500. A stale ref
 * is permanent: retrying never fixes it, only a purge does.
 */
export const handleStaleRef = (err: unknown, ref: string, where: string): void => {
  if (!isResourceMissing(err)) throw err;
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'stripe-stale-ref');
    scope.setLevel('warning');
    scope.setExtra('ref', ref);
    scope.setExtra('where', where);
    Sentry.captureMessage('stripe: stale cross-mode reference');
  });
};
```

Nas duas mints de portal em `me-premium.ts`:

```ts
let portal;
try {
  portal = await app.stripe.createBillingPortalSession({
    customerId: membership.providerCustomerRef,
    returnUrl,
  });
} catch (err) {
  handleStaleRef(err, membership.providerCustomerRef, 'premium_portal');
  return reply
    .status(409)
    .send({ error: 'StaleBillingReference', message: 'billing reference no longer valid' });
}
```

E em `orders.ts:690`:

```ts
let pi;
try {
  pi = await app.stripe.retrievePaymentIntent(order.providerRef);
} catch (err) {
  handleStaleRef(err, order.providerRef, 'order_resume');
  return reply
    .status(409)
    .send({ error: 'StaleBillingReference', message: 'payment reference no longer valid' });
}
```

`createBillingPortalSession` é o nome no `StripeClient`
(`apps/api/src/services/stripe/index.ts:202`), recebendo
`{ customerId, returnUrl }` e devolvendo `{ url }`.

- [ ] **Step 4: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/billing/stale-refs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me-premium.ts apps/api/src/routes/orders.ts apps/api/src/services/stripe/fake.ts apps/api/test/billing/stale-refs.test.ts
git commit -m "fix(billing): handle stale test-mode Stripe references"
```

---

## Task 8: Script de purga de test mode

Roda uma vez, antes da virada de chave. Sem isso, memberships com `sub_` de test nunca expiram e dão entitlement premium vitalício, silenciosamente.

**Files:**

- Create: `apps/api/src/scripts/purge-test-mode.ts`
- Test: `apps/api/test/billing/purge-test-mode.test.ts` (novo)

**Interfaces:**

- Consumes: nada.
- Produces: `purgeTestMode(prisma): Promise<{ memberships: number; orders: number; garages: number }>`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('expires memberships with test-mode refs and clears the garage snapshot', async () => {
  const result = await purgeTestMode(prisma);

  expect(result.memberships).toBe(1);
  const m = await prisma.premiumMembership.findFirstOrThrow({ where: { id: membershipId } });
  expect(m.status).toBe('expired');
  const g = await prisma.garage.findFirstOrThrow({ where: { id: garageId } });
  expect(g.premiumTier).toBeNull();
  expect(g.premiumUntil).toBeNull();
});

it('leaves live-mode rows untouched', async () => {
  await purgeTestMode(prisma);
  const live = await prisma.premiumMembership.findFirstOrThrow({ where: { id: liveMembershipId } });
  expect(live.status).toBe('active');
});
```

Semear duas memberships: uma com `providerSubRef: 'sub_test_...'` e outra com `sub_live_...`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/billing/purge-test-mode.test.ts`
Expected: FAIL, o módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import type { PrismaClient } from '@prisma/client';

/**
 * Stripe test-mode object ids carry `_test_` after the prefix
 * (`cus_test_...`, `sub_test_...`, `pi_test_...`). Live ids do not.
 * Confirm this holds against a production dump before running for real —
 * some accounts have legacy ids that predate the convention.
 */
const TEST_REF = '_test_';

export type PurgeResult = { memberships: number; orders: number; garages: number };

export const purgeTestMode = async (
  prisma: PrismaClient,
  opts: { dryRun?: boolean } = {},
): Promise<PurgeResult> => {
  const staleMemberships = await prisma.premiumMembership.findMany({
    where: {
      OR: [
        { providerSubRef: { contains: TEST_REF } },
        { providerCustomerRef: { contains: TEST_REF } },
      ],
      status: { notIn: ['expired'] },
    },
    select: { id: true, garageId: true },
  });

  const stalePending = await prisma.order.findMany({
    where: { status: 'pending', providerRef: { contains: TEST_REF } },
    select: { id: true },
  });

  const result: PurgeResult = {
    memberships: staleMemberships.length,
    orders: stalePending.length,
    garages: new Set(staleMemberships.map((m) => m.garageId)).size,
  };

  if (opts.dryRun) return result;

  await prisma.$transaction(async (tx) => {
    await tx.premiumMembership.updateMany({
      where: { id: { in: staleMemberships.map((m) => m.id) } },
      data: { status: 'expired' },
    });
    // Entitlement snapshot lives on Garage; leaving it set is what produces
    // permanent free premium after the key flip.
    await tx.garage.updateMany({
      where: { id: { in: [...new Set(staleMemberships.map((m) => m.garageId))] } },
      data: { premiumTier: null, premiumUntil: null },
    });
    await tx.order.updateMany({
      where: { id: { in: stalePending.map((o) => o.id) } },
      data: { status: 'expired' },
    });
  });

  return result;
};
```

Adicionar um entry point que lê `--dry-run` de `process.argv` e imprime o
`PurgeResult` como JSON. Confirmar os nomes exatos dos campos
`providerSubRef`, `providerCustomerRef`, `premiumTier` e `premiumUntil` contra
`packages/db/prisma/schema.prisma` antes de rodar: um typo aqui apaga
entitlement de quem paga.

- [ ] **Step 4: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/billing/purge-test-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scripts/purge-test-mode.ts apps/api/test/billing/purge-test-mode.test.ts
git commit -m "chore(billing): add test-mode purge script for the live cutover"
```

---

## Task 9: Carrinho não replica sessão morta, e evento envenenado escala

Duas correções pequenas e independentes, mesma área.

**Files:**

- Modify: `apps/api/src/routes/stripe-webhook.ts` (`handleCartFailure`, ~linha 270)
- Modify: `apps/api/src/routes/stripe-billing-webhook.ts:283-297`
- Test: `apps/api/test/cart/cart-retry.test.ts` (novo)

**Interfaces:**

- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('bumps cart.version on failure so the next checkout gets a fresh session', async () => {
  const before = await prisma.cart.findUniqueOrThrow({ where: { id: cartId } });

  await deliverEvent({
    id: 'evt_pi_failed_001',
    type: 'payment_intent.payment_failed',
    data: { object: { id: 'pi_failed_001', metadata: { cartId } } },
  });

  const after = await prisma.cart.findUniqueOrThrow({ where: { id: cartId } });
  expect(after.status).toBe('open');
  expect(after.version).toBe(before.version + 1);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/api && pnpm exec vitest run test/cart/cart-retry.test.ts`
Expected: FAIL, `version` não muda.

- [ ] **Step 3: Incrementar a versão**

Em `handleCartFailure`, na `tx.cart.update` que devolve o carrinho para `open`:

```ts
await tx.cart.update({
  where: { id: cartId },
  data: { status: 'open', version: { increment: 1 } },
});
```

Motivo, em comentário: a chave de idempotência do checkout é `cart_checkout_${id}_v${version}`, e sem o incremento a Stripe replica por 24 horas a sessão já consumida.

- [ ] **Step 4: Escalar evento envenenado**

Primeiro a coluna, em `packages/db/prisma/schema.prisma`, no model
`SubscriptionWebhookEvent`:

```prisma
  /// Retentativas da Stripe que caíram no ramo de replay não processado.
  /// A partir de POISON_PILL_THRESHOLD o evento é escalado: sem isso ele
  /// dá 503 por ~3 dias e depois a Stripe desiste, perdendo o evento.
  attempts Int @default(0)
```

Gerar a migration com `pnpm --filter @ccc/db db:migrate`.

Depois, no ramo de 503 por `processedAt: null` em `stripe-billing-webhook.ts`:

```ts
const POISON_PILL_THRESHOLD = 5;

// ... dentro do ramo de replay não processado:
const bumped = await prisma.subscriptionWebhookEvent.update({
  where: { provider_providerEventId: { provider: 'stripe', providerEventId: event.id } },
  data: { attempts: { increment: 1 } },
  select: { attempts: true },
});

if (bumped.attempts >= POISON_PILL_THRESHOLD) {
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'billing-webhook-poison-pill');
    scope.setLevel('fatal');
    scope.setExtra('eventId', event.id);
    scope.setExtra('eventType', event.type);
    scope.setExtra('attempts', bumped.attempts);
    Sentry.captureMessage('stripe billing webhook: event stuck, will be dropped by Stripe');
  });
}

return reply.status(503).send({ error: 'ServiceUnavailable', message: 'event in flight' });
```

Conferir o nome do índice composto gerado pelo Prisma para
`@@unique([provider, providerEventId])`. Se o schema nomeia a constraint, o
`where` usa esse nome em vez de `provider_providerEventId`.

- [ ] **Step 5: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/cart test/billing`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/stripe-webhook.ts apps/api/src/routes/stripe-billing-webhook.ts packages/db/prisma apps/api/test
git commit -m "fix(payments): bump cart version on failure, escalate poison-pill events"
```

---

## Task 10: Observabilidade e procedimentos

Sem código de produto. Fecha as lacunas operacionais que o spec nomeia.

**Files:**

- Modify: `docs/observability.md`
- Modify: `docs/stripe.md`

**Interfaces:**

- Consumes: os eventos e tags de Sentry criados nas Tasks 2, 4 e 5.
- Produces: nada.

- [ ] **Step 1: Estender a regra de alerta aos três endpoints**

Em `docs/observability.md:55-63`, a regra 2 hoje só cobre `transaction:POST /stripe/webhook`. Estender para `/webhooks/stripe-billing` e `/abacatepay/webhook`, e adicionar regras para as tags novas: `billing-webhook-unrecognized-shape` e `stripe-dispute-opened` em nível error ou fatal, com notificação imediata.

- [ ] **Step 2: Escrever o runbook de "pagou e não recebeu"**

Novo runbook em `docs/observability.md`, cobrindo os dois casos. Ingresso: existe `POST /admin/tickets/grant`. Membership: não existe endpoint equivalente, então o procedimento é manual e precisa estar escrito passo a passo, incluindo quais linhas criar e em que ordem.

- [ ] **Step 3: Escrever o fluxo de reembolso do suporte**

Nomear quem executa e por onde. Stripe pelo dashboard. Pix pela AbacatePay, que não tem API de refund documentada conforme `plans/jdma-260-abacatepay-refund-api-path.md`, então o caminho é suporte do fornecedor. Registrar a expectativa de resposta, dado que a operação é de uma pessoa só.

- [ ] **Step 4: Reescrever `docs/stripe.md`**

Trocar todo o conteúdo JDM. Precisa conter: os três paths reais, a query string do segredo da AbacatePay, o descritor de fatura `CASA CAR CLUB`, e uma seção sobre fixar a versão de API dos endpoints. Remover a afirmação de que o Stripe Tax funciona porque o Checkout coleta endereço de cobrança: nenhum criador de sessão seta `billing_address_collection` nem `automatic_tax`.

- [ ] **Step 5: Commit**

```bash
git add docs/observability.md docs/stripe.md
git commit -m "docs(payments): alert coverage, recovery runbooks, rewrite stripe doc"
```

---

## Ordem e dependências

Tasks 1 e 2 são a espinha: as duas mexem no normalizador e a 2 depende do tipo alargado na 1. Task 3 precisa vir antes das Tasks 4 e 5, que dependem do `providerRef` em pedido de carrinho. Tasks 6 a 9 são independentes entre si e podem ir em paralelo. Task 10 fecha, depois que as tags de Sentry existem.

## Verificação final antes de fechar a Fase 0

- [ ] `pnpm --filter @ccc/api test` inteiro passa.
- [ ] `pnpm --filter @ccc/api typecheck` passa.
- [ ] `pnpm --filter @ccc/api lint` passa.
- [ ] `purge-test-mode --dry-run` rodado contra um dump de produção, com as contagens conferidas à mão antes de rodar valendo.
