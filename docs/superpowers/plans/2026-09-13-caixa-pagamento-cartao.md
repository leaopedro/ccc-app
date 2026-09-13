# Pagamento por cartão na Caixa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o assinante pague o excedente da Caixa com cartão via Stripe, além do Pix que já existe.

**Architecture:** O `Order` de caixa já nasce no confirm com `method: 'pix'`/`provider: 'abacatepay'`. O checkout passa a aceitar um método, cria a cobrança no provider correspondente e carimba `method`/`provider`/`providerRef` no Order.

A ideia que organiza tudo: **virar `Order.provider` para `'stripe'` não acrescenta um caminho, religa a maquinaria inteira da Stripe, que nunca soube que caixa existe.** Três rotas são chaveadas por provider e cegas a `kind`, e hoje estão seguras só porque nenhuma Order de caixa jamais foi `stripe`. As Tasks 2 e 3 fecham essas portas **antes** da Task 4 abrir o cartão. A ordem das tasks é load-bearing.

**Tech Stack:** Fastify + Prisma (`apps/api`), Zod 3.25.76 (`packages/shared`), Expo/React Native + `@stripe/stripe-react-native` (`apps/mobile`), Vitest nos três.

**Spec:** Não há spec separada. A Fase 4a (`docs/superpowers/specs/2026-08-13-box-builder-fase-4a-payment-design.md:22`) colocou Stripe/Apple Pay fora de escopo porque a Caixa era dark no iOS; essa justificativa caiu em 2026-09-12, quando `EXPO_PUBLIC_CAIXA_ENABLED` passou a `"true"` nos três profiles. O design da seleção de método está em `docs/design/box-builder/README.md:136-142` (tela 06). As decisões que faltavam estão abaixo.

## Decisões fechadas

Decididas antes do plano. Não reabrir durante a execução.

1. **O clube absorve a taxa do cartão.** Preço idêntico nos dois métodos. Nada muda em `chargeCents`, em `devFeePercent` (segue `0`) ou em `services/box/confirm.ts`. Consequência: o método é escolhido depois do confirm, e o `Order` continua nascendo com o valor único.
2. **O método trava no primeiro checkout.** Depois que `Order.providerRef` é carimbado, qualquer novo checkout devolve a cobrança existente, no método existente, ignorando o `method` pedido. A AbacatePay não tem API de cancelamento, então permitir a troca deixaria duas cobranças vivas. O cliente renderiza pelo `method` da **resposta**, nunca pelo que pediu.
3. **O seletor mora dentro de `caixa/pagar.tsx`,** não numa rota nova. `revisar.tsx` e `caixa/index.tsx` não mudam.
4. **Sem hosted checkout na caixa.** No web, ou num build sem `stripePublishableKey`, o cartão não aparece e o Pix segue único.
5. **Estorno de caixa continua fora de escopo (Fase 4c), mas agora precisa ser bloqueado explicitamente.** Ver Task 3.

## Global Constraints

- Branch a partir de `main` fresco (`git pull --ff-only origin main`). Nunca em `production`. PR para `main`.
- Order só vira `paid` por webhook verificado. Nunca por chamada do cliente.
- Webhook idempotente por event id. Toda saída nova de webhook **precisa** chamar `markProcessed` e devolver 200; um `throw` vira 500 e a Stripe reentrega por ~3 dias.
- Idioma da copy: PT-BR. Erros de rota em snake_case (`box_locked`, `box_not_eligible`), seguindo a convenção do endpoint. Não vazar `error.issues` do Zod para o cliente.
- Docker rodando antes de qualquer teste de `apps/api`.
- Rodar um arquivo da API: `cd apps/api && pnpm exec vitest run test/<path>`. **Não** usar `pnpm --filter @ccc/api test -- <file>`: o `--` não filtra e roda os ~2250 testes.
- **Editar `packages/shared` exige `pnpm --filter @ccc/shared build`** antes de `apps/api`/`apps/mobile` verem a mudança em runtime. A resolução passa por `dist/`, então o typecheck passa enquanto o teste lê o schema velho.
- Lint em `apps/api`: 0 errors. Medir warnings no ponto de branch e julgar o diff por não **acrescentar**. Nunca `git stash` para remedir: o repo é compartilhado via `.claude/worktrees/`.
- Em worktree, rodar `pnpm exec prettier --write` nos arquivos alterados antes de commitar (hooks não instalam lá).

### Fatos verificados do repo (não re-checar)

- Rota do webhook da Stripe: **`POST /stripe/webhook`** (`apps/api/src/routes/stripe-webhook.ts:484`, fixada por `apps/api/test/webhook-paths.test.ts:28`). Não é `/webhooks/stripe`. `/webhooks/stripe-billing` é outro handler, o de assinaturas, e engoliria um PI de caixa com 200.
- Fakes: chamadas da Stripe são `{ kind, payload }` (`services/stripe/fake.ts:31-56`); da AbacatePay são `{ method, args }` (`services/abacatepay/fake.ts:9`). `nextPaymentIntent`, `nextRetrievedPaymentIntent`, `nextCancelPaymentIntentError`, `nextSignatureValid` existem. **`nextPaymentIntentError` não existe** e precisa ser criado.
- `makeAppWithFakes()` devolve `{ app, stripe, abacatepay }` (`apps/api/test/helpers.ts:21-30`).
- `startBoxCutoffWorker` repassa o `Deps` inteiro (`workers/box-cutoff.ts:220-223`).
- `app.stripe` é sempre decorado (`app.ts:108`); `app.abacatepay` é nullable (`app.ts:109-118`).
- Order de caixa **nunca** tem `expiresAt` (`services/box/confirm.ts:112-127`), e `workers/order-expiry.ts:54` filtra `expiresAt: { not: null }`. Logo uma Order de caixa nunca chega em `'expired'`.
- Nenhuma migration é necessária: `enum PaymentMethod { card pix }` e `enum PaymentProvider { stripe abacatepay }` já existem (`packages/db/prisma/schema.prisma:1089-1097`). `brCode` é nullable (`:1327`). `MonthlyBox.orderId` é `@unique` (`:816`).
- **`apps/mobile` não tem `@testing-library/react-native`.** Os testes usam `react-dom` + `jsdom` com `createRoot(...).render()` e queries de DOM cru. Ver `apps/mobile/app/__tests__/cart-checkout-stripe-unavailable.test.tsx:281-282`.
- Nenhum teste existente **renderiza** `caixa/pagar.tsx` (`payment-screen-wiring.test.tsx` cobre só `CartScreen` e `ProfileOrdersScreen`), mas existem `src/hooks/useBoxPay.test.tsx` e `src/api/box.test.ts`, que cobrem as peças alteradas na Task 6. Rode os dois.

---

## Estrutura de arquivos

**Modificados**

| Arquivo                                               | Responsabilidade após a mudança                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/src/routes/stripe-webhook.ts:762-777`       | Catch-all de `OrderNotPendingError`: estorna, `markProcessed`, 200 |
| `apps/api/src/routes/orders.ts:620`                   | `/orders/:id/resume` recusa `kind: 'box'`                          |
| `apps/api/src/routes/admin/refunds.ts:118-131`        | Recusa estorno de `kind: 'box'` até a Fase 4c                      |
| `apps/api/src/services/stripe/index.ts:8-20, 382-399` | `CreatePaymentIntentInput` aceita `paymentMethodTypes` opcional    |
| `apps/api/src/services/stripe/fake.ts`                | `nextPaymentIntentError`                                           |
| `packages/shared/src/box.ts:79-84`                    | `boxCheckoutRequestSchema`; resposta vira união discriminada       |
| `apps/api/src/services/box/checkout.ts`               | Decide provider por método, cria cobrança, carimba                 |
| `apps/api/src/routes/box.ts:398-419`                  | Parseia o corpo, guarda por provider, serializa a união            |
| `apps/api/src/workers/box-cutoff.ts`                  | Cancela o PaymentIntent das Orders de cartão canceladas no corte   |
| `apps/api/src/app.ts:288`                             | Passa `app.stripe` ao worker                                       |
| `apps/mobile/src/copy/caixa.ts:28-40`                 | Copy do seletor e dos estados do cartão                            |
| `apps/mobile/src/api/box.ts:59-62`                    | `checkoutBox(method)`                                              |
| `apps/mobile/src/hooks/useBoxPay.ts`                  | `checkout(method)`                                                 |
| `apps/mobile/app/(app)/caixa/pagar.tsx`               | Seletor + ramo PaymentSheet                                        |

**Criados**

| Arquivo                                                      | Responsabilidade                               |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `apps/api/test/box/box-stripe-settle.test.ts`                | Webhook da Stripe liquidando e recusando caixa |
| `apps/api/test/box/box-provider-guards.test.ts`              | Resume e refund recusam caixa                  |
| `apps/api/test/box/box-card-checkout.test.ts`                | Checkout no cartão                             |
| `apps/mobile/src/screens/caixa/pay-method.ts`                | Decisão pura: o cartão está disponível?        |
| `apps/mobile/src/screens/caixa/__tests__/pay-method.test.ts` | Teste da decisão acima                         |
| `apps/mobile/app/__tests__/caixa-pagar-card.test.tsx`        | Tela com chave publicável                      |
| `apps/mobile/app/__tests__/caixa-pagar-no-stripe.test.tsx`   | Tela sem chave publicável                      |

---

### Task 1: Schema compartilhado do checkout

União discriminada por `method`, para o cliente saber qual tela renderizar.

**Compatibilidade, nas duas direções.** App antigo contra API nova: builds publicados fazem POST **sem corpo**; `authedRequest` omite o `content-type` quando `body` é `undefined` (`apps/mobile/src/api/client.ts:84`), então o Fastify entrega `request.body === undefined` e o `?? {}` cai no default `'pix'`. O `z.object` do cliente antigo descarta a chave `method` extra. Verificado.

App novo contra API antiga é o perigoso e **não** é resolvido por código: a API velha responde sem `method`, o `discriminatedUnion` lança `invalid_union_discriminator`, e a tela de pagamento quebra inclusive no Pix. A mitigação é ordem de deploy, e está no checklist final.

**Files:**

- Modify: `packages/shared/src/box.ts:79-84`
- Test: `packages/shared/src/__tests__/box.test.ts`

**Interfaces:**

- Produces: `boxCheckoutRequestSchema`; `BoxCheckoutRequest` (`{ method: 'pix' | 'card' }`); `boxCheckoutResponseSchema`; `BoxCheckoutResponse`. **`BoxCheckoutRequest['method']` é a ÚNICA fonte do tipo de método de pagamento da caixa.** Não criar aliases locais em `apps/api` nem em `apps/mobile`.

- [ ] **Step 1: Escrever o teste que falha**

Em `packages/shared/src/__tests__/box.test.ts`, dentro de `describe('box shared schemas', ...)`. Acrescentar `boxCheckoutRequestSchema` ao import da linha 8.

```ts
it('parses a pix checkout response', () => {
  const parsed = boxCheckoutResponseSchema.parse({
    method: 'pix',
    brCode: '00020126-BR',
    amountCents: 2000,
    expiresAt: '2026-09-20T00:00:00.000Z',
  });
  expect(parsed.method).toBe('pix');
  if (parsed.method === 'pix') expect(parsed.brCode).toBe('00020126-BR');
});

it('parses a card checkout response', () => {
  const parsed = boxCheckoutResponseSchema.parse({
    method: 'card',
    clientSecret: 'pi_1_secret_abc',
    amountCents: 2000,
    expiresAt: '2026-09-20T00:00:00.000Z',
  });
  expect(parsed.method).toBe('card');
  if (parsed.method === 'card') expect(parsed.clientSecret).toBe('pi_1_secret_abc');
});

it('rejects a pix response missing the brCode', () => {
  expect(() =>
    boxCheckoutResponseSchema.parse({
      method: 'pix',
      amountCents: 2000,
      expiresAt: '2026-09-20T00:00:00.000Z',
    }),
  ).toThrow();
});

// Direcao perigosa: app novo contra API velha. O teste nao conserta nada, so
// documenta que a unica protecao e a ordem de deploy.
it('rejects a legacy response with no method (deploy order matters)', () => {
  expect(() =>
    boxCheckoutResponseSchema.parse({
      brCode: '00020126-BR',
      amountCents: 2000,
      expiresAt: '2026-09-20T00:00:00.000Z',
    }),
  ).toThrow();
});

it('defaults the checkout request method to pix', () => {
  expect(boxCheckoutRequestSchema.parse({}).method).toBe('pix');
});

it('rejects an unknown checkout request method', () => {
  expect(() => boxCheckoutRequestSchema.parse({ method: 'boleto' })).toThrow();
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/box.test.ts`
Expected: FAIL. `boxCheckoutRequestSchema is not defined`.

- [ ] **Step 3: Implementar**

Substituir `packages/shared/src/box.ts:79-84` por:

```ts
export const boxCheckoutRequestSchema = z.object({
  method: z.enum(['pix', 'card']).default('pix'),
});
export type BoxCheckoutRequest = z.infer<typeof boxCheckoutRequestSchema>;

// Uniao discriminada por `method` porque a tela de pagamento renderiza coisas
// diferentes: QR + copia-e-cola no Pix, PaymentSheet no cartao. O cliente
// decide pelo `method` da RESPOSTA, nunca pelo que pediu — o metodo trava na
// primeira cobranca e um segundo checkout devolve o que ja existe.
//
// Consequencia de deploy: uma API antiga responde sem `method` e este schema
// lanca `invalid_union_discriminator`, quebrando a tela ate no Pix. A API tem
// de subir ANTES de qualquer build ou OTA que carregue este schema.
export const boxCheckoutResponseSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('pix'),
    brCode: z.string(),
    amountCents: z.number().int(),
    expiresAt: z.string(),
  }),
  z.object({
    method: z.literal('card'),
    clientSecret: z.string(),
    amountCents: z.number().int(),
    expiresAt: z.string(),
  }),
]);
export type BoxCheckoutResponse = z.infer<typeof boxCheckoutResponseSchema>;
```

- [ ] **Step 4: Rodar, buildar, commitar**

```bash
cd packages/shared && pnpm exec vitest run src/__tests__/box.test.ts
cd ../.. && pnpm --filter @ccc/shared build
git add packages/shared/src/box.ts packages/shared/src/__tests__/box.test.ts
git commit -m "feat(caixa): schema de checkout com metodo de pagamento"
```

O build não é opcional: sem ele as tasks seguintes leem o schema velho de `dist/` em runtime.

---

### Task 2: Rede de segurança no webhook da Stripe

**Esta é a task que destrava o resto. Sem ela, cartão na caixa é perda de dinheiro silenciosa.**

Hoje `stripe-webhook.ts:762-776` só trata `OrderNotPendingError` quando o status é `'expired'`. Qualquer outro cai no `throw err` da linha 777, que vira 500 em `plugins/error-handler.ts`. E uma Order de caixa **nunca** pode ser `'expired'`: o confirm não grava `expiresAt` e o `order-expiry` filtra por ele. O cutoff grava `'cancelled'`.

Sequência real, com janela de 60 segundos (`MIN_WINDOW_MS` em `checkout.ts:6`) e cron de minuto em minuto (`box-cutoff.ts:221`): o assinante abre a sheet pouco antes do corte, o worker cancela a Order, ele confirma, chega `payment_intent.succeeded`, o settle lança, a rota dá 500. `markProcessed` nunca roda, então não há dedupe. A Stripe reentrega por ~3 dias, 500 toda vez, e acaba desativando o endpoint. Dinheiro entrou, nada saiu, nenhum alerta.

O lado Pix já resolveu isso: `abacatepay-webhook.ts:584-637` tem ramos para `paid`, `expired` e um catch-all `// H2` para `cancelled` e qualquer outro, todos com `markProcessed` + 200. A Stripe nunca ganhou o equivalente porque nenhuma Order de caixa jamais chegou por ali.

Diferença importante: a Stripe **tem** API de estorno (`app.stripe.refund`, já usada em `stripe-webhook.ts:750`). Aqui dá para estornar de verdade, não só flagar.

**Files:**

- Modify: `apps/api/src/routes/stripe-webhook.ts:762-777`
- Test: `apps/api/test/box/box-stripe-settle.test.ts` (criar)

**Interfaces:**

- Consumes: `OrderNotPendingError` (`services/orders/settle.ts`), `app.stripe.refund(paymentIntentId, reason)`, `markProcessed(eventId, event)`. Leia as assinaturas reais nos dois webhooks antes de escrever.
- Produces: garantia de que nenhum `payment_intent.succeeded` de caixa devolve 500.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/box/box-stripe-settle.test.ts`. Leia primeiro `apps/api/test/box/box-webhook.test.ts` (equivalente da AbacatePay, mostra como montar o evento assinado) e `apps/api/test/box/box-settle.test.ts:79-112`, que **já cobre no nível de serviço** os dois primeiros casos; aqui eles são reafirmados no nível da rota.

Seed: box `awaiting_payment` + Order `kind:'box'`, `method:'card'`, `provider:'stripe'`, `status:'pending'`, `providerRef:'pi_box_1'`. POST em **`/stripe/webhook`**.

```ts
it('payment_intent.succeeded liquida a caixa: order paid e box ready', async () => {
  // evento: { type: 'payment_intent.succeeded', livemode: false,
  //   data: { object: { id: 'pi_box_1', metadata: { orderId: order.id } } } }
  // expect(res.statusCode).toBe(200)
  // expect(order.status).toBe('paid'); expect(box.status).toBe('ready')
});

it('enfileira a notificacao box.paid', async () => {
  // expect(await prisma.notification.count({ where: { kind: 'box.paid' } })).toBe(1)
});

it('e idempotente: o mesmo event id duas vezes nao duplica', async () => {
  // dois POSTs com o mesmo event.id
  // expect(segundo.statusCode).toBe(200)
  // expect(notificacoes).toHaveLength(1)
});

it('order cancelada no corte: 200, estorno automatico, sem 500', async () => {
  // Order com status:'cancelled' ANTES do webhook.
  // expect(res.statusCode).toBe(200)   <- hoje e 500
  // expect(stripe.calls.filter((c) => c.kind === 'refund')).toHaveLength(1)
  // expect(order.status).toBe('cancelled')  // nunca vira paid
});

it('reentrega de uma order cancelada nao estorna duas vezes', async () => {
  // mesmo event.id duas vezes no cenario acima
  // expect(stripe.calls.filter((c) => c.kind === 'refund')).toHaveLength(1)
});

it('order ja paga com o mesmo PI: 200, dedupe, sem estorno', async () => {
  // expect(stripe.calls.filter((c) => c.kind === 'refund')).toHaveLength(0)
});
```

Confira o nome real do método de estorno no fake antes de assertar `c.kind === 'refund'`.

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd apps/api && pnpm exec vitest run test/box/box-stripe-settle.test.ts`
Expected: os três primeiros PASSAM sem mudança nenhuma (o caminho feliz já funciona). Os casos 4, 5 e 6 FALHAM com 500.

Se os três primeiros falharem, pare e leia o erro antes de mexer em produção. Causas prováveis, nesta ordem: o evento não tem `metadata.orderId`; o fake rejeitou a assinatura (`nextSignatureValid`); a rota não é `/stripe/webhook`.

- [ ] **Step 3: Implementar o catch-all**

Substituir o bloco `if (err instanceof OrderNotPendingError) { ... }` em `stripe-webhook.ts:762-776` pelo trecho abaixo. O `throw err` da linha 777 **permanece**, como último recurso para erros que não são este.

```ts
// Order nao estava `pending` quando o pagamento chegou. Antes daqui so
// `expired` era tratado e todo o resto caia no `throw` abaixo -> 500.
// Para ingresso isso era quase inofensivo: `expired` era o unico estado
// alcancavel. Uma Order de caixa nunca pode ser `expired` (confirm nao
// grava `expiresAt`, order-expiry filtra por ele) e o cutoff grava
// `cancelled`, entao o pagador de ultima hora caia direto no 500: sem
// markProcessed, sem dedupe, a Stripe reentregando por ~3 dias ate
// desativar o endpoint. Dinheiro entrou, nada saiu.
// Espelha abacatepay-webhook.ts:584-637, que ja tinha os tres ramos.
if (err instanceof OrderNotPendingError) {
  const staleOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, providerRef: true },
  });

  // Ja pago: nada a fazer alem de deduplicar. Uma cobranca DISTINTA na
  // mesma Order e pagamento em dobro e precisa de estorno.
  if (staleOrder?.status === 'paid') {
    const firstTime = await markProcessed(event.id, event);
    if (firstTime && staleOrder.providerRef && staleOrder.providerRef !== intent.id) {
      await app.stripe.refund(intent.id, 'double-payment');
      request.log.warn(
        { orderId, paymentIntentId: intent.id, storedProviderRef: staleOrder.providerRef },
        'stripe webhook: distinct PI on an already-paid order, refunded',
      );
    }
    return reply.status(200).send({ ok: true, deduped: !firstTime });
  }

  // Qualquer outro estado nao-pendente: expired, cancelled, failed,
  // refunded. Estorna na primeira entrega e deduplica nas seguintes.
  // `markProcessed` PRIMEIRO, para que uma reentrega nao estorne duas
  // vezes se o refund ou o log falharem depois.
  const firstTime = await markProcessed(event.id, event);
  if (firstTime) {
    await app.stripe.refund(intent.id, `order-${staleOrder?.status ?? 'unknown'}`);
    request.log.warn(
      { orderId, paymentIntentId: intent.id, status: staleOrder?.status },
      'stripe webhook: order not pending at payment, refunded',
    );
  }
  return reply
    .status(200)
    .send({ ok: true, refunded: firstTime, reason: staleOrder?.status ?? 'unknown' });
}
```

Isto substitui o ramo `expired` existente, que vira um caso do catch-all com a mesma consequência (estorno + 200). Confirme lendo o bloco antigo que nada mais se perde; se ele fizer algo específico de ingresso além de estornar, preserve.

- [ ] **Step 4: Rodar**

```bash
cd apps/api && pnpm exec vitest run test/box/box-stripe-settle.test.ts test/box/box-settle.test.ts test/box/box-webhook.test.ts
pnpm exec vitest run test/orders test/webhook-paths.test.ts
```

Esta mudança afeta ingresso e loja, não só caixa. A segunda suíte não é opcional.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/stripe-webhook.ts apps/api/test/box/box-stripe-settle.test.ts
git commit -m "fix(webhook): estorna e deduplica order nao-pendente na stripe"
```

---

### Task 3: Fechar as rotas chaveadas por provider

Duas rotas tratam Order por `provider` e são cegas a `kind`. Hoje caixa não passa por elas por acidente. Depois da Task 4, passa.

**`GET /orders/:id/resume`** (`routes/orders.ts:620`). O ramo AbacatePay exige `order.expiresAt` (`:639-641`), que caixa nunca tem, então hoje devolve 409. O ramo Stripe (`:691`) exige só `providerRef`. Com `provider: 'stripe'`, a caixa vira resumível por uma rota que pula o `loadEligibleMembership`, pula a guarda de `box_locked` dos 60 segundos antes do corte, e roda no limiter de 60/min em vez do de 5/min da caixa. E o cliente já tem o id: `BoxView.orderId` está exposto em `packages/shared/src/box.ts:57`.

**Estorno no admin** (`routes/admin/refunds.ts:124`). Recusa tudo que não é `provider: 'stripe'`. É só isso que hoje impede estorno de caixa. Depois da Task 4 o botão funciona, mas `revokeTicketsForRefundedOrder` (`services/orders/revoke.ts:200-229`) não tem ramo de `box`: a Order vira `refunded`, o `MonthlyBox` fica `ready`, e a caixa é enviada mesmo assim. A decisão 5 mantém estorno de caixa fora de escopo, então o certo agora é recusar explicitamente em vez de deixar funcionar pela metade.

**Files:**

- Modify: `apps/api/src/routes/orders.ts:620` (logo após a checagem de `status !== 'pending'`)
- Modify: `apps/api/src/routes/admin/refunds.ts:118-131`
- Test: `apps/api/test/box/box-provider-guards.test.ts` (criar)

**Interfaces:**

- Consumes: nada novo.
- Produces: garantia de que `kind: 'box'` não entra por nenhuma das duas rotas. A Task 4 depende disso.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/box/box-provider-guards.test.ts`. Seed igual ao da Task 2 (Order de caixa `provider:'stripe'`, `providerRef:'pi_box_1'`).

```ts
it('resume recusa uma order de caixa mesmo com provider stripe', async () => {
  // GET /orders/:id/resume com o dono autenticado
  // expect(res.statusCode).toBe(409)
  // expect(stripe.calls.filter((c) => c.kind === 'retrievePaymentIntent')).toHaveLength(0)
});

it('resume continua funcionando para uma order de ingresso', async () => {
  // Regressao: a guarda nova nao pode fechar a porta para quem ela serve.
});

it('o admin recusa estornar uma order de caixa', async () => {
  // expect(res.statusCode).toBe(501)
  // expect(stripe.calls.filter((c) => c.kind === 'refund')).toHaveLength(0)
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd apps/api && pnpm exec vitest run test/box/box-provider-guards.test.ts`
Expected: FAIL nos casos 1 e 3.

- [ ] **Step 3: Implementar as duas guardas**

Em `routes/orders.ts`, logo depois do `if (order.status !== 'pending')` (linha ~632), antes do `reply.header('Cache-Control', ...)`:

```ts
// A caixa tem o proprio checkout (`POST /me/box/checkout`), com validacao
// de assinatura ativa e a guarda de `box_locked` nos 60s antes do corte.
// Esta rota e chaveada por provider e cega a kind: enquanto a caixa era
// sempre `abacatepay` ela caia no 409 por nao ter `expiresAt`, por
// acidente. Com cartao ela viraria resumivel aqui e escaparia das duas
// guardas. Explicito e melhor que acidental.
if (order.kind === 'box') {
  return reply.status(409).send({ error: 'OrderNotPending', status: order.status });
}
```

Confirme que o `select` de `expireSingleOrder` traz `kind`. Se não trouxer, acrescente.

Em `routes/admin/refunds.ts`, antes do `if (order.provider !== 'stripe')` da linha 124, acrescentando `kind: true` ao `select` da linha 121:

```ts
// Estorno de caixa e Fase 4c. Enquanto ela nao existir, o `MonthlyBox` nao
// acompanha o estorno: `revokeTicketsForRefundedOrder` nao tem ramo de box,
// entao a Order viraria `refunded` e a caixa seria enviada do mesmo jeito.
// Recusar e melhor que estornar pela metade.
if (order.kind === 'box') {
  return reply.status(501).send({
    error: 'RefundNotSupported',
    message: 'Estorno de caixa ainda nao e suportado. Ver Fase 4c.',
  });
}
```

- [ ] **Step 4: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/box/box-provider-guards.test.ts test/orders test/admin`
Expected: PASS. As suítes de orders e admin precisam passar inteiras: as guardas são novas num caminho compartilhado.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/routes/admin/refunds.ts apps/api/test/box/box-provider-guards.test.ts
git commit -m "fix(caixa): fecha resume e refund para orders de caixa"
```

---

### Task 4: Ramo de cartão no checkout da API

Agora sim. Três pontos sutis, todos vindos de revisão:

- **Reuso de cartão exige chamada externa.** O `clientSecret` não vai para o banco. O reuso busca o PI com `retrievePaymentIntent`, HTTP, portanto fora do lock. Mesmo padrão de `routes/orders.ts:697`.
- **Uma vez com `providerRef`, nunca voltar a `create`.** O código atual (`checkout.ts:43`) exige `providerRef && brCode` para reusar; uma linha com `providerRef` e `brCode` nulo cai em `create`, cria cobrança real, falha no carimbo e devolve `box_locked`. Cada retry gera outra órfã, 5 por minuto. O arquivo está sendo reescrito, então feche o buraco.
- **`automatic_payment_methods` sem restrição** (`services/stripe/index.ts:394`) pode oferecer métodos assíncronos numa conta BRL, que liquidam depois do corte. A copy diz "Crédito, em uma vez" e nada garante. Restringir a `card` sem alterar o comportamento de quem já usa o cliente.

**Files:**

- Modify: `apps/api/src/services/stripe/index.ts:8-20, 382-399`
- Modify: `apps/api/src/services/stripe/fake.ts`
- Modify: `apps/api/src/services/box/checkout.ts` (reescrito)
- Modify: `apps/api/src/routes/box.ts:398-419`
- Test: `apps/api/test/box/box-card-checkout.test.ts` (criar)

**Interfaces:**

- Consumes: `boxCheckoutRequestSchema` (Task 1); guardas das Tasks 2 e 3.
- Produces: `checkoutBoxOrder({ userId, membershipId, method, abacatepay, stripe })`. O tipo do método é `BoxCheckoutRequest['method']` de `@ccc/shared/box`. **Não declarar alias local.** A Task 5 depende de Order de cartão gravar `provider: 'stripe'` e `providerRef` do PI.

- [ ] **Step 1: `nextPaymentIntentError` no fake**

Em `apps/api/src/services/stripe/fake.ts`: acrescentar ao tipo `FakeStripe` junto de `nextPaymentIntent` (linha 62), inicializar como `null` na linha 137, e em `createPaymentIntent` (linha 185) lançar **depois** do `fake.calls.push`, para a chamada continuar registrada:

```ts
if (fake.nextPaymentIntentError) throw fake.nextPaymentIntentError;
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `apps/api/test/box/box-card-checkout.test.ts`. O `seed` é copiado de `apps/api/test/box/box-checkout.test.ts:12-63` de propósito: os dois arquivos evoluem por motivos diferentes.

```ts
it('cria um PaymentIntent e carimba method/provider/providerRef', async () => {
  // payload { method: 'card' }; stripe.nextPaymentIntent = { id: 'pi_box_1', clientSecret: 'pi_box_1_secret' }
  // expect(res.json().method).toBe('card'); expect(res.json().clientSecret).toBe('pi_box_1_secret')
  // expect(fresh.method).toBe('card'); expect(fresh.provider).toBe('stripe')
  // expect(fresh.providerRef).toBe('pi_box_1'); expect(fresh.brCode).toBeNull()
  // expect(abacatepay.calls.filter((c) => c.method === 'createPixBilling')).toHaveLength(0)
  // metadata.orderId do PI === order.id
  // expect(payload.paymentMethodTypes).toEqual(['card'])
});

it('reusa o PaymentIntent na segunda chamada', async () => {
  // segundo POST com stripe.nextRetrievedPaymentIntent setado
  // mesmo clientSecret; createPaymentIntent 1x; retrievePaymentIntent 1x
});

it('trava o metodo: pedir pix depois do cartao devolve o cartao', async () => {
  // expect(res.json().method).toBe('card'); createPixBilling 0x
});

it('trava o metodo ao contrario: pedir cartao depois do pix devolve o pix', async () => {
  // expect(res.json().method).toBe('pix'); createPaymentIntent 0x
});

it('nunca recria cobranca numa linha com providerRef e brCode nulo', async () => {
  // Order com providerRef:'pix_char_1', method:'pix', brCode:null
  // Nem createPixBilling nem createPaymentIntent podem ser chamados.
  // Este e o buraco herdado do codigo atual; sem o teste ele volta.
});

it('422 num metodo desconhecido, snake_case e sem issues do zod', async () => {
  // expect(res.json().error).toBe('invalid_payment_method')
  // expect(res.json().issues).toBeUndefined()
});

it('sem corpo, continua caindo no pix (build antigo do app)', async () => {
  // inject sem `payload`
});

it('409 box_locked no cartao quando ja passou do cutoff', async () => {
  // createPaymentIntent 0x
});

it('502 quando a Stripe falha, sem carimbar nada', async () => {
  // stripe.nextPaymentIntentError = new Error('stripe down')
  // expect(fresh.providerRef).toBeNull()
  // expect(fresh.provider).toBe('abacatepay')
  // NAO assertar so `method`: o seed ja nasce 'pix' e a assercao seria vazia.
});

it('503 quando pedem pix sem abacatepay configurado', async () => {
  // buildApp sem o fake de abacatepay
});

it('reuso de cartao funciona mesmo sem abacatepay configurado', async () => {
  // A guarda de 503 e do metodo pedido, nao do reuso.
});
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `cd apps/api && pnpm exec vitest run test/box/box-card-checkout.test.ts`
Expected: FAIL. `method=card` cai no ramo Pix atual.

- [ ] **Step 4: Restringir o PaymentIntent a cartão sem afetar quem já usa**

Em `apps/api/src/services/stripe/index.ts`, acrescentar a `CreatePaymentIntentInput` (linhas 8-20):

```ts
  /**
   * Restringe os metodos oferecidos. Omitido => `automatic_payment_methods`, o
   * comportamento de sempre. A caixa passa `['card']` porque a cobranca tem
   * prazo duro (o cutoff) e um metodo assincrono liquidaria depois dele.
   */
  paymentMethodTypes?: string[];
```

e no corpo (linha ~391), acrescentando `paymentMethodTypes` à desestruturação, trocar a linha de `automatic_payment_methods` por:

```ts
          ...(paymentMethodTypes
            ? { payment_method_types: paymentMethodTypes }
            : { automatic_payment_methods: { enabled: true } }),
```

Registre o campo também no fake, já que os testes asseram sobre ele.

- [ ] **Step 5: Reescrever `services/box/checkout.ts`**

```ts
import { prisma } from '@ccc/db';
import type { BoxCheckoutRequest } from '@ccc/shared/box';
import * as Sentry from '@sentry/node';

import { AbacatePayUpstreamError, type AbacatePayClient } from '../abacatepay/index.js';
import type { StripeClient } from '../stripe/index.js';

const MIN_WINDOW_MS = 60_000;

type Method = BoxCheckoutRequest['method'];

export type CheckoutResult =
  | { kind: 'ok'; method: 'pix'; brCode: string; amountCents: number; expiresAt: string }
  | { kind: 'ok'; method: 'card'; clientSecret: string; amountCents: number; expiresAt: string }
  | { kind: 'not_found' }
  | { kind: 'not_awaiting' }
  | { kind: 'locked' }
  | { kind: 'upstream' };

const monthYear = (cycleKey: string): string => cycleKey.slice(0, 7);

const captureUpstream = (
  err: unknown,
  provider: 'abacatepay' | 'stripe',
  context: Record<string, unknown>,
): void => {
  // Um `catch {}` pelado morava aqui. Chave revogada, 422 por mudanca de
  // payload e queda real do provider viravam o mesmo 502 opaco, sem nada
  // logado. Era o pior caminho de pagamento para diagnosticar em producao.
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'box-checkout-failed');
    scope.setTag('provider', provider);
    scope.setContext('box', {
      ...context,
      upstreamStatus: err instanceof AbacatePayUpstreamError ? err.status : null,
    });
    Sentry.captureException(err);
  });
};

export const checkoutBoxOrder = async (args: {
  userId: string;
  membershipId: string;
  method: Method;
  abacatepay: AbacatePayClient | undefined;
  stripe: StripeClient;
}): Promise<CheckoutResult> => {
  // Fase A: sob o lock da Garage, valida e curto-circuita numa cobranca ativa.
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
      select: {
        id: true,
        status: true,
        amountCents: true,
        currency: true,
        method: true,
        providerRef: true,
        brCode: true,
      },
    });
    if (!order || order.status !== 'pending') return { kind: 'not_awaiting' as const };

    // Com `providerRef` gravado NUNCA se cria outra cobranca. O metodo trava
    // aqui: devolvemos o que ja existe, ignorando `args.method`, porque a
    // AbacatePay nao cancela e duas cobrancas vivas na mesma Order e o pior
    // resultado possivel.
    //
    // A guarda antiga era `providerRef && brCode`, e uma linha com ref e brCode
    // nulo caia no `create` abaixo: cobranca real criada, carimbo falhando no
    // `where providerRef: null`, 409 `box_locked`, e outra orfa a cada retry.
    // Por isso este `if` externo nao tem saida para `create`.
    if (order.providerRef) {
      if (order.method === 'card') {
        return {
          kind: 'reuse_card' as const,
          providerRef: order.providerRef,
          amountCents: order.amountCents,
          expiresAt: box.cutoffAt.toISOString(),
        };
      }
      if (order.brCode) {
        return {
          kind: 'reuse_pix' as const,
          brCode: order.brCode,
          amountCents: order.amountCents,
          expiresAt: box.cutoffAt.toISOString(),
        };
      }
      // Pix carimbado sem brCode: linha corrompida. Nao ha o que mostrar e nao
      // se pode criar outra cobranca. Alerta e trata como indisponivel.
      Sentry.captureMessage('box checkout: pix order stamped without brCode', {
        level: 'error',
        tags: { kind: 'box-checkout-corrupt-row' },
        extra: { orderId: order.id, providerRef: order.providerRef },
      });
      return { kind: 'upstream' as const };
    }

    return {
      kind: 'create' as const,
      orderId: order.id,
      boxId: box.id,
      amountCents: order.amountCents,
      currency: order.currency,
      cutoffAt: box.cutoffAt,
      cycleKey: box.cycleKey,
    };
  });

  if (phaseA.kind === 'reuse_pix') {
    return {
      kind: 'ok',
      method: 'pix',
      brCode: phaseA.brCode,
      amountCents: phaseA.amountCents,
      expiresAt: phaseA.expiresAt,
    };
  }

  if (phaseA.kind === 'reuse_card') {
    // O clientSecret nunca vai para o banco, so o `providerRef`. Buscar o PI e
    // HTTP, logo roda fora do lock. Mesmo padrao de routes/orders.ts:697.
    try {
      const pi = await args.stripe.retrievePaymentIntent(phaseA.providerRef);
      return {
        kind: 'ok',
        method: 'card',
        clientSecret: pi.clientSecret,
        amountCents: phaseA.amountCents,
        expiresAt: phaseA.expiresAt,
      };
    } catch (err) {
      captureUpstream(err, 'stripe', { providerRef: phaseA.providerRef, phase: 'reuse' });
      return { kind: 'upstream' };
    }
  }

  if (phaseA.kind !== 'create') return phaseA;

  // Fase B: cria a cobranca fora do lock (HTTP externo).
  let providerRef: string;
  let brCode: string | null = null;
  let clientSecret: string | null = null;

  if (args.method === 'card') {
    try {
      const intent = await args.stripe.createPaymentIntent({
        amountCents: phaseA.amountCents,
        currency: phaseA.currency,
        idempotencyKey: phaseA.orderId,
        // Prazo duro: a cobranca morre no cutoff. Um metodo assincrono
        // liquidaria depois dele, direto no estorno automatico da Task 2.
        paymentMethodTypes: ['card'],
        metadata: {
          orderId: phaseA.orderId,
          boxId: phaseA.boxId,
          userId: args.userId,
        },
      });
      providerRef = intent.id;
      clientSecret = intent.clientSecret;
    } catch (err) {
      captureUpstream(err, 'stripe', {
        orderId: phaseA.orderId,
        boxId: phaseA.boxId,
        amountCents: phaseA.amountCents,
      });
      return { kind: 'upstream' };
    }
  } else {
    if (!args.abacatepay) return { kind: 'upstream' };
    const expiresInSeconds = Math.floor((phaseA.cutoffAt.getTime() - Date.now()) / 1000);
    try {
      const billing = await args.abacatepay.createPixBilling({
        amountCents: phaseA.amountCents,
        description: `Caixa ${monthYear(phaseA.cycleKey)}`,
        expiresInSeconds,
        metadata: { orderId: phaseA.orderId, boxId: phaseA.boxId, userId: args.userId },
      });
      providerRef = billing.id;
      brCode = billing.brCode;
    } catch (err) {
      captureUpstream(err, 'abacatepay', {
        orderId: phaseA.orderId,
        boxId: phaseA.boxId,
        amountCents: phaseA.amountCents,
      });
      return { kind: 'upstream' };
    }
  }

  // Fase C: de volta ao lock, carimba so se ainda estiver pending e sem ref.
  // Os quatro campos vao numa SQL so, entao nenhum interleaving separa
  // `providerRef` de `provider`.
  return prisma.$transaction(async (tx) => {
    const boxRow = await tx.monthlyBox.findUnique({
      where: { id: phaseA.boxId },
      select: { garageId: true },
    });
    if (!boxRow) return { kind: 'not_found' as const };
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${boxRow.garageId} FOR UPDATE`;
    const stamped = await tx.order.updateMany({
      where: { id: phaseA.orderId, status: 'pending', providerRef: null },
      data: {
        providerRef,
        brCode,
        method: args.method,
        provider: args.method === 'card' ? 'stripe' : 'abacatepay',
      },
    });
    if (stamped.count === 0) {
      // Ou o cutoff cancelou entre as fases, ou um checkout concorrente
      // carimbou primeiro. A Fase A comita SEM carimbar, entao dois pedidos
      // podem chegar aqui com cobrancas reais criadas. O perdedor fica com uma
      // cobranca viva que NAO esta gravada em lugar nenhum: o worker de cutoff
      // cancela `ord.providerRef`, que e a do vencedor. Uma Pix orfa expira no
      // cutoff; um PI orfao fica aberto ate a expiracao da propria Stripe.
      // Ninguem consegue pagar a orfa (o perdedor recebe 409 sem brCode nem
      // clientSecret), mas ela precisa estar no Sentry para ser conciliada.
      Sentry.captureMessage('box checkout: orphaned charge, lost the stamp race', {
        level: 'warning',
        tags: {
          kind: 'box-checkout-orphan',
          provider: args.method === 'card' ? 'stripe' : 'abacatepay',
        },
        extra: { orderId: phaseA.orderId, boxId: phaseA.boxId, orphanRef: providerRef },
      });
      return { kind: 'locked' as const };
    }
    if (args.method === 'card') {
      return {
        kind: 'ok' as const,
        method: 'card' as const,
        clientSecret: clientSecret!,
        amountCents: phaseA.amountCents,
        expiresAt: phaseA.cutoffAt.toISOString(),
      };
    }
    return {
      kind: 'ok' as const,
      method: 'pix' as const,
      brCode: brCode!,
      amountCents: phaseA.amountCents,
      expiresAt: phaseA.cutoffAt.toISOString(),
    };
  });
};
```

- [ ] **Step 6: Ligar a rota**

Acrescentar `boxCheckoutRequestSchema` ao import de `@ccc/shared/box` no topo de `apps/api/src/routes/box.ts`, e substituir o corpo de `scoped.post('/me/box/checkout', ...)` (linhas 398-419) por:

```ts
scoped.post('/me/box/checkout', async (request, reply) => {
  const { sub } = requireUser(request);
  const parsed = boxCheckoutRequestSchema.safeParse(request.body ?? {});
  // snake_case e sem `issues`: o resto do endpoint usa `box_locked` e
  // `box_not_eligible`, e vazar internals do Zod nao ajuda ninguem.
  if (!parsed.success) {
    return reply.status(422).send({ error: 'invalid_payment_method' });
  }
  const method = parsed.data.method;
  const membership = await loadEligibleMembership(sub);
  if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
  // `app.stripe` e sempre decorado (app.ts:108); so o Pix pode faltar. A
  // guarda de 503 mora DEPOIS do checkout para nao 503-ar um reuso de
  // cartao so porque quem pediu falou 'pix' — a Fase A ignora o metodo
  // pedido quando ja existe cobranca.
  const result = await checkoutBoxOrder({
    userId: sub,
    membershipId: membership.id,
    method,
    abacatepay: app.abacatepay,
    stripe: app.stripe,
  });
  if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
  if (result.kind === 'not_awaiting') return reply.status(409).send({ error: 'box_not_awaiting' });
  if (result.kind === 'locked') return reply.status(409).send({ error: 'box_locked' });
  if (result.kind === 'upstream') {
    if (method === 'pix' && !app.abacatepay) {
      return reply.status(503).send({ error: 'payment_unavailable' });
    }
    return reply.status(502).send({ error: 'payment_provider_error' });
  }
  if (result.method === 'card') {
    return reply.send({
      method: 'card',
      clientSecret: result.clientSecret,
      amountCents: result.amountCents,
      expiresAt: result.expiresAt,
    });
  }
  return reply.send({
    method: 'pix',
    brCode: result.brCode,
    amountCents: result.amountCents,
    expiresAt: result.expiresAt,
  });
});
```

- [ ] **Step 7: Rodar, typecheck, lint, commitar**

```bash
cd apps/api && pnpm exec vitest run test/box/box-card-checkout.test.ts test/box/box-checkout.test.ts
cd ../.. && pnpm --filter @ccc/api typecheck && pnpm --filter @ccc/api lint
git add apps/api/src/services/box/checkout.ts apps/api/src/routes/box.ts apps/api/src/services/stripe/index.ts apps/api/src/services/stripe/fake.ts apps/api/test/box/box-card-checkout.test.ts
git commit -m "feat(caixa): checkout do excedente por cartao"
```

`box-checkout.test.ts` continua valendo: faz POST sem corpo, que cai no default `'pix'`. Se algum caso dele falhar, o default quebrou. Conserte o default, não o teste.

---

### Task 5: Cancelar o PaymentIntent no corte

Um Pix morre sozinho: `expiresInSeconds` é o tempo até o corte. Um PI não. Sem esta task, o worker cancela a Order e o PI segue pagável, caindo no estorno automático da Task 2, que funciona mas é pior que nunca ter cobrado.

Três coisas vindas de revisão, já embutidas abaixo:

- **O flush roda depois do commit, nunca dentro.** A lista é declarada por caixa, dentro do `for` e antes do `try`. Rollback rejeita o `await` e o controle desvia para o `catch`, pulando o flush.
- **A decisão de "já pago" precisa da releitura DEPOIS do `updateMany`.** O código atual relê depois e é imune por construção. Ler antes cria um TOCTOU hoje bloqueado só por um lock que nenhum dos dois arquivos documenta. A leitura prévia serve apenas para `provider`/`providerRef`, que o update não toca.
- **Um cancel que falha porque o PI já está sendo pago não é "PI aberto sobrando".** É dinheiro cobrado com caixa cancelada, e precisa de tag própria no Sentry.

**Files:**

- Modify: `apps/api/src/workers/box-cutoff.ts` (tipo `Deps` na linha 11; o `for` abre na linha **138**; o bloco `if (box.orderId)` vai de **175 a 207**, incluindo o loop de `releaseCycleStock` em 200-206)
- Modify: `apps/api/src/app.ts:288`
- Test: `apps/api/test/box/box-cutoff.test.ts`

**Interfaces:**

- Consumes: Orders de caixa com `provider: 'stripe'` e `providerRef`, carimbadas na Task 4.
- Produces: `Deps` vira `{ log?: FastifyBaseLogger; stripe?: StripeClient }`. `runBoxCutoffTick(deps)` mantém a assinatura, e `startBoxCutoffWorker` já repassa o objeto inteiro (`box-cutoff.ts:220-223`) — nada a verificar ali.

- [ ] **Step 1: Escrever o teste que falha**

**O helper do arquivo é `makeBox(over)` (`box-cutoff.test.ts:9`) e ele não serve como está:** aceita `{status, autoSendOptIn, withItem, withAddress, budget}`, **sem `cutoffAt`** (usa o `pastCutoff` fixo da linha 7), devolve `{ user, box }` **sem `order`**, e **não cria Order nenhuma**. Cada teste abaixo precisa criar a Order e ligá-la com `monthlyBox.update({ orderId })` à mão. O padrão está em `box-cutoff.test.ts:190-206`.

```ts
it('cancela o PI quando a Order de cartao e cancelada no corte', async () => {
  // Order method:'card' provider:'stripe' providerRef:'pi_box_1' status:'pending'
  // await runBoxCutoffTick({ stripe })
  // cancelPaymentIntent 1x; order.status 'cancelled'; box.orderId null
});

it('nao cancela nada quando a Order de cartao ja estava paga', async () => {
  // Order status:'paid' -> cancelPaymentIntent 0x
});

it('nao chama a Stripe para uma Order de Pix', async () => {
  // provider segue 'abacatepay' -> cancelPaymentIntent 0x
});

it('uma falha no cancel nao derruba o tick', async () => {
  // stripe.nextCancelPaymentIntentError = new Error('stripe down')
  // await expect(runBoxCutoffTick({ stripe })).resolves.toBeUndefined()
  // order.status segue 'cancelled'
});

it('sem cliente stripe, uma Order de cartao no corte e registrada', async () => {
  // runBoxCutoffTick({}) — sem stripe
  // Falhar em silencio aqui deixa todo PI vivo apos o corte. Asserte o log ou
  // o Sentry, o que o arquivo ja souber checar.
});
```

Importar `buildFakeStripe` de `../../src/services/stripe/fake.js`.

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd apps/api && pnpm exec vitest run test/box/box-cutoff.test.ts`
Expected: FAIL no primeiro caso, nenhuma chamada registrada.

- [ ] **Step 3: Ampliar o `Deps`**

Em `apps/api/src/workers/box-cutoff.ts`, acrescentar aos imports:

```ts
import * as Sentry from '@sentry/node';

import type { StripeClient } from '../services/stripe/index.js';
```

e trocar a linha 11:

```ts
type Deps = { log?: FastifyBaseLogger; stripe?: StripeClient };
```

- [ ] **Step 4: Coletar dentro da transação, cancelar depois**

Dentro do `for (const { id, garageId } of due) {` (abre na linha **138**), antes do `try`:

```ts
// Por caixa, e nao fora do loop: o flush so roda depois que a transacao
// daquela caixa comita. Um rollback rejeita o await abaixo e o fluxo
// desvia para o catch, entao a lista e descartada sem ser usada. Cancelar
// o PI de uma Order que continuou `pending` seria pior que nao cancelar.
const pendingCancels: string[] = [];
```

Substituir o bloco `if (box.orderId) { ... }` (linhas **175-207**, o fechamento vem depois do loop de `releaseCycleStock`) por:

```ts
// awaiting_payment: cancela a Order pendente, a menos que ja tenha
// liquidado. Uma caixa awaiting_payment sempre tem orderId na pratica
// (o confirm carimba); orderId nulo cai no resolveBudgetOnly sem nada
// para cancelar.
if (box.orderId) {
  // Leitura previa SO para provider/providerRef, que o update nao toca.
  // A decisao de "ja pago" usa a releitura pos-update abaixo: ler o
  // status aqui abriria um TOCTOU onde um settle concorrente faria o
  // worker destruir uma caixa ja paga.
  const ref = await tx.order.findUnique({
    where: { id: box.orderId },
    select: { provider: true, providerRef: true },
  });
  const cancelled = await tx.order.updateMany({
    where: { id: box.orderId, status: 'pending' },
    data: { status: 'cancelled', fulfillmentStatus: 'cancelled' },
  });
  if (cancelled.count === 0) {
    // Order nao estava pendente. Distingue pago dos demais estados.
    const ord = await tx.order.findUnique({
      where: { id: box.orderId },
      select: { status: true },
    });
    if (ord?.status === 'paid') {
      // Ja liquidou: box.paid disparou no settle. Deixa para o caminho
      // pago e nao re-resolve nem notifica de novo aqui.
      return;
    }
    // Cancelada/falha/expirada/estornada por outro caminho. Segue:
    // solta as reservas e resolve budget-only para a caixa nao ficar
    // presa em awaiting_payment para sempre.
  } else if (ref?.provider === 'stripe' && ref.providerRef) {
    // Um Pix morre sozinho no cutoff. Um PI nao: sem este cancel ele
    // continua pagavel depois do corte e cai no estorno automatico do
    // webhook, que funciona mas e pior que nunca ter cobrado.
    pendingCancels.push(ref.providerRef);
  }
  await tx.monthlyBox.update({ where: { id }, data: { orderId: null } });
  // Solta as reservas do confirm para as linhas incluidas.
  // resolveBudgetOnly re-reserva os sobreviventes logo abaixo, entao
  // soltar antes devolve o ledger ao baseline e evita reserva dupla.
  for (const line of box.items.filter((i) => i.included)) {
    await releaseCycleStock(tx, {
      catalogItemId: line.catalogItemId,
      cycleKey: box.cycleKey,
      quantity: line.quantity,
    });
  }
}
```

Depois do `});` que fecha o `await prisma.$transaction(...)` e antes do `} catch (err) {`:

```ts
if (pendingCancels.length > 0 && !deps.stripe) {
  // Falhar em silencio aqui deixa todo PI de caixa vivo apos o corte.
  deps.log?.error({ boxId: id, refs: pendingCancels }, '[box-cutoff] no stripe client');
  Sentry.captureMessage('box-cutoff: stripe client missing, PIs left open', {
    level: 'error',
    tags: { kind: 'box-cutoff-no-stripe' },
    extra: { boxId: id, refs: pendingCancels },
  });
}
for (const ref of pendingCancels) {
  try {
    await deps.stripe?.cancelPaymentIntent(ref);
  } catch (err) {
    // `cancel` falha quando o PI ja esta em `processing` ou `succeeded`.
    // Isso NAO e "sobrou um PI aberto": e dinheiro cobrado com a caixa
    // cancelada, e o webhook vai estornar (Task 2). Tag propria para nao
    // se perder no meio das falhas de rede.
    const alreadyPaying =
      err instanceof Error && /processing|succeeded|cannot be canceled/i.test(err.message);
    deps.log?.error(
      { err, providerRef: ref, alreadyPaying },
      '[box-cutoff] stripe PI cancel failed',
    );
    Sentry.withScope((scope) => {
      scope.setTag(
        'kind',
        alreadyPaying ? 'box-cutoff-pi-paid-after-cutoff' : 'box-cutoff-pi-cancel-failed',
      );
      scope.setTag('stripe_operation', 'cancel_payment_intent');
      scope.setTag('stripe_payment_intent_id', ref);
      Sentry.captureException(err);
    });
  }
}
```

- [ ] **Step 5: Passar o cliente na inicialização**

`apps/api/src/app.ts:288`:

```ts
const boxCutoffWorker = startBoxCutoffWorker({ log: app.log, stripe: app.stripe });
```

- [ ] **Step 6: Rodar e commitar**

```bash
cd apps/api && pnpm exec vitest run test/box/box-cutoff.test.ts test/box/box-cutoff-optin.test.ts
cd ../..
git add apps/api/src/workers/box-cutoff.ts apps/api/src/app.ts apps/api/test/box/box-cutoff.test.ts
git commit -m "feat(caixa): cancela o PaymentIntent da caixa no corte"
```

Os casos antigos do cutoff não podem regredir: a leitura extra mudou a ordem das queries dentro da transação.

---

### Task 6: Cliente e disponibilidade no mobile

Camada fina: mandar o método, e decidir se o cartão sequer aparece.

**O `publishableKey` é lido DENTRO do componente, não em escopo de módulo.** Em escopo de módulo o valor congela na primeira importação e os dois cenários de teste não coexistem. O carrinho faz em module scope (`cart/index.tsx:58-60`), e é exatamente por isso que o repo precisa de dois arquivos de teste separados para ele. Não repita.

**Não criar um tipo novo de método.** `BoxCheckoutRequest['method']` de `@ccc/shared/box` é a fonte. `packages/shared/src/orders.ts:5-6` já tem um `paymentMethodSchema` genérico; um terceiro e um quarto alias só criam divergência. E `apps/mobile/src/api/*` importando de `~/screens/*` inverteria camada sem precedente no repo.

**Files:**

- Create: `apps/mobile/src/screens/caixa/pay-method.ts`
- Create: `apps/mobile/src/screens/caixa/__tests__/pay-method.test.ts`
- Modify: `apps/mobile/src/api/box.ts:59-62`
- Modify: `apps/mobile/src/hooks/useBoxPay.ts`
- Modify: `apps/mobile/src/copy/caixa.ts:28-40`

**Interfaces:**

- Consumes: `BoxCheckoutResponse`, `BoxCheckoutRequest` (Task 1).
- Produces: `cardAvailable({ isWeb, publishableKey }): boolean`; `checkoutBox(method?)`; `useBoxPay().checkout(method?)` — **parâmetro opcional com default `'pix'`**, para o typecheck ficar verde neste commit; a Task 7 passa o valor explicitamente em todas as chamadas.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/mobile/src/screens/caixa/__tests__/pay-method.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { cardAvailable } from '../pay-method';

describe('cardAvailable', () => {
  it('libera o cartao no nativo com chave publicavel', () => {
    expect(cardAvailable({ isWeb: false, publishableKey: 'pk_live_1' })).toBe(true);
  });

  it('esconde o cartao no web', () => {
    // A caixa nao tem hosted checkout (decisao 4): sem PaymentSheet nao ha como
    // cobrar no cartao, entao a opcao nao pode aparecer.
    expect(cardAvailable({ isWeb: true, publishableKey: 'pk_live_1' })).toBe(false);
  });

  it('esconde o cartao sem chave publicavel', () => {
    expect(cardAvailable({ isWeb: false, publishableKey: undefined })).toBe(false);
    expect(cardAvailable({ isWeb: false, publishableKey: '' })).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/caixa/__tests__/pay-method.test.ts`
Expected: FAIL. `Failed to resolve import "../pay-method"`.

- [ ] **Step 3: Implementar**

Criar `apps/mobile/src/screens/caixa/pay-method.ts`:

```ts
// Decisao pura sobre a disponibilidade do cartao na caixa. Separada da tela
// para ser testavel sem renderizar.

/**
 * A caixa nao tem hosted checkout: sem PaymentSheet nao ha cobranca no cartao.
 * Logo, no web ou num build sem chave publicavel, o cartao nao e oferecido e o
 * Pix segue como unico caminho.
 */
export const cardAvailable = (args: {
  isWeb: boolean;
  publishableKey: string | undefined;
}): boolean => !args.isWeb && !!args.publishableKey;
```

Em `apps/mobile/src/api/box.ts`, acrescentar `type BoxCheckoutRequest` ao import de `@ccc/shared/box` e trocar as linhas 59-62:

```ts
export const checkoutBox = (
  method: BoxCheckoutRequest['method'] = 'pix',
): Promise<BoxCheckoutResponse> =>
  authedRequest('/me/box/checkout', boxCheckoutResponseSchema as z.ZodType<BoxCheckoutResponse>, {
    method: 'POST',
    body: { method },
  });
```

Em `apps/mobile/src/hooks/useBoxPay.ts`, importar `type BoxCheckoutRequest` de `@ccc/shared/box` e trocar a assinatura, mantendo o corpo do `catch` intacto:

```ts
export function useBoxPay(): {
  checkout: (method?: BoxCheckoutRequest['method']) => Promise<Outcome>;
  loading: boolean;
} {
  const [loading, setLoading] = useState(false);

  const checkout = async (method: BoxCheckoutRequest['method'] = 'pix'): Promise<Outcome> => {
    setLoading(true);
    try {
      const data = await checkoutBox(method);
      return { result: 'ok', data };
    } catch (e) {
      // ... inalterado
```

Em `apps/mobile/src/copy/caixa.ts`, dentro de `pay`, após `reconnect`:

```ts
    methodTitle: 'Como você quer pagar?',
    methodPix: 'Pix',
    methodPixHint: 'Confirmação na hora',
    methodCard: 'Cartão',
    methodCardHint: 'Crédito, em uma vez',
    cardInstruction: 'Preencha os dados do cartão pra concluir.',
    cardOpenSheet: 'Pagar com cartão',
    cardWaiting: 'Confirmando o pagamento...',
    sheetCancelled: 'Pagamento cancelado. Você pode tentar de novo.',
    sheetFailed: 'O pagamento não foi aprovado. Tente de novo.',
    expiredCard: 'O prazo acabou. A caixa fechou no corte.',
```

- [ ] **Step 4: Rodar, typecheck, commitar**

```bash
cd apps/mobile && pnpm exec vitest run src/screens/caixa/__tests__/pay-method.test.ts
cd ../.. && pnpm --filter @ccc/mobile typecheck
git add apps/mobile/src/screens/caixa/pay-method.ts apps/mobile/src/screens/caixa/__tests__/pay-method.test.ts apps/mobile/src/api/box.ts apps/mobile/src/hooks/useBoxPay.ts apps/mobile/src/copy/caixa.ts
git commit -m "feat(caixa): cliente mobile envia o metodo de pagamento"
```

O typecheck **tem** de ficar verde, mas o default `'pix'` sozinho não basta. Medido na execução: o erro real não é a chamada sem argumento e sim `data.brCode` em `pagar.tsx:97`, que deixa de existir na união. Estreite a condição para `data.method === 'pix'` neste commit; a Task 7 reescreve o bloco inteiro.

---

### Task 7: Seletor e PaymentSheet na tela de pagamento

A tela deixa de disparar o checkout no mount. Passa a: mostrar o seletor, disparar na escolha, e ramificar entre QR (Pix) e PaymentSheet (cartão).

**Cinco armadilhas encontradas em revisão do desenho anterior. Todas estão resolvidas no código abaixo. Não as reintroduza.**

1. **`checkoutError` não pode estar nas deps do efeito.** `runCheckout` começa com `setCheckoutError(null)`, então o botão "Reconectar" muda a dep e o efeito dispara um segundo checkout concorrente. Um dos dois perde a corrida do carimbo, leva 409 `box_locked`, e `mapPayError` manda para `/caixa` no meio da sheet.
2. **O ramo do cartão não pode vir antes dos ramos de `status`.** Se vier, `cardPhase: 'waiting'` é terminal: a tela de sucesso fica inalcançável, e um `status: 'error'` do poll (que **não reagenda**, `useBoxPaymentPoll.ts:50-52`) prende o usuário num spinner sem saída.
3. **Toda chamada a `runCheckout` precisa passar o método atual.** Há uma em `pagar.tsx:156`, no botão de erro. Escrever `runCheckout('pix')` ali faria quem escolheu cartão e teve um 502 receber cobrança Pix, travada para sempre pela decisão 2.
4. **O retry do cartão precisa de guarda de toque duplo.** O carrinho tem `checkingOutRef` justamente por isso (`cart/index.tsx:370-376`), com comentário explicando que um toque duplo rápido lê um `false` velho no próprio closure. Duas `presentPaymentSheet` concorrentes no mesmo client secret é comportamento indefinido.
5. **O poll não pode rodar com a sheet aberta.** `expiresAt` é setado antes do `await pay(...)`, então o poll dispararia a cada 3s enquanto o usuário digita o cartão. Uma falha de rede ali trava o `status` em `error` para sempre, e um webhook rápido navega para `/caixa` por baixo de um modal nativo aberto.

**Files:**

- Modify: `apps/mobile/app/(app)/caixa/pagar.tsx`
- Test: `apps/mobile/app/__tests__/caixa-pagar-card.test.tsx` e `apps/mobile/app/__tests__/caixa-pagar-no-stripe.test.tsx` (criar os dois)

**Interfaces:**

- Consumes: `cardAvailable` (Task 6); `usePaymentSheet().pay(clientSecret)` com a união `{paid|cancelled|failed}` (`src/payments/payment-sheet.ts:17-20`); `useBoxPay().checkout(method)`; `useBoxPaymentPoll`.

- [ ] **Step 1: Escrever os testes que falham**

**Dois arquivos, não um.** `vi.mock('expo-constants', ...)` é hoisted por módulo, então "com chave" e "sem chave" não coexistem no mesmo arquivo. É por isso que o repo já separa `payment-screen-wiring.test.tsx:161-163` (com chave) de `cart-checkout-stripe-unavailable.test.tsx:83-87` (sem chave).

**Não há `@testing-library/react-native` neste repo.** Os testes usam `react-dom` + `jsdom`, `createRoot(...).render()` e queries de DOM cru. Copie a estrutura de `cart-checkout-stripe-unavailable.test.tsx`, incluindo o `vi.mock('react-native')` e o `await import(...)` dinâmico dentro do teste. Atenção: sob aquele shim, `Pressable` vira `div[role="button"]`, então o helper `findButton` existente **não** acha os cards do seletor; só o `Button` de `@ccc/ui` emite um `<button>` real. O padrão de `querySelectorAll` + `textContent` está em `cart-checkout-stripe-unavailable.test.tsx:281-282`.

`caixa-pagar-card.test.tsx` (chave presente):

```
- mostra o seletor no mount, sem chamar checkout
- escolher cartao chama checkout('card') e depois pay('cs_1')
- escolher pix renderiza o brCode e nunca chama pay
- sheet cancelada mostra sheetCancelled e NAO e tratada como erro
- sheet falhada mostra sheetFailed
- sheet paga com poll ainda pendente mostra cardWaiting, nao o sucesso
- sheet paga e poll 'paid' CHEGA na tela de sucesso   <- o caso que o desenho
  anterior tornava inalcancavel; sem ele a regressao volta
- poll 'error' depois de uma sheet paga mostra o botao de retry, nao um
  spinner eterno
- toque duplo no retry do cartao chama checkout uma vez so
- o botao de erro de checkout re-tenta com o MESMO metodo escolhido
```

`caixa-pagar-no-stripe.test.tsx` (chave ausente):

```
- pula o seletor e chama checkout('pix') no mount
- nao renderiza methodTitle em momento nenhum
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd apps/mobile && pnpm exec vitest run app/__tests__/caixa-pagar-card.test.tsx app/__tests__/caixa-pagar-no-stripe.test.tsx`
Expected: FAIL. A tela dispara checkout no mount e não existe seletor.

- [ ] **Step 3: Implementar**

Imports novos em `pagar.tsx`:

```ts
import type { BoxCheckoutRequest } from '@ccc/shared/box';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { usePaymentSheet } from '~/payments/payment-sheet';
import { cardAvailable } from '~/screens/caixa/pay-method';

type Method = BoxCheckoutRequest['method'];
```

Trocar o bloco de estado (linhas 75-80):

```tsx
const { checkout, loading } = useBoxPay();
const { pay } = usePaymentSheet();
// Lido DENTRO do componente: em escopo de modulo o valor congela na primeira
// importacao e os dois cenarios de teste (com e sem chave) nao coexistem.
const publishableKey = (
  Constants.expoConfig?.extra as { stripePublishableKey?: string } | undefined
)?.stripePublishableKey;
const canUseCard = cardAvailable({ isWeb: Platform.OS === 'web', publishableKey });
// `null` = ainda escolhendo. Sem cartao disponivel nao ha o que escolher,
// entao ja comeca em 'pix' e o efeito de mount dispara o checkout.
const [method, setMethod] = useState<Method | null>(canUseCard ? null : 'pix');
const [cardPhase, setCardPhase] = useState<'idle' | 'sheet' | 'waiting'>('idle');
const [sheetMessage, setSheetMessage] = useState<string | null>(null);
const [brCode, setBrCode] = useState<string | null>(null);
const [amountCents, setAmountCents] = useState(0);
const [expiresAt, setExpiresAt] = useState<string | null>(null);
const [checkoutError, setCheckoutError] = useState<PayErrorFeedback | null>(null);
const [copied, setCopied] = useState(false);
// Guarda de toque duplo. Um `useState` nao serve: dois toques rapidos leem o
// mesmo `false` velho nos proprios closures antes do re-render chegar. Mesmo
// motivo do `checkingOutRef` do carrinho (cart/index.tsx:370-376).
const runningRef = useRef(false);
```

Trocar `runCheckout` (linhas 90-114):

```tsx
const runCheckout = useCallback(async (chosen: Method) => {
  if (runningRef.current) return;
  runningRef.current = true;
  setCheckoutError(null);
  setSheetMessage(null);
  try {
    const { result, data } = await checkout(chosen);
    // A tela pode ter desmontado com o checkout em voo; uma resposta atrasada
    // nao pode navegar nem setar estado numa tela morta.
    if (!activeRef.current) return;

    if (result !== 'ok') {
      const feedback = mapPayError(result);
      if (feedback.kind === 'toast_home') {
        router.replace('/caixa' as never);
        return;
      }
      setCheckoutError(feedback);
      return;
    }
    if (!data) {
      setCheckoutError({ kind: 'retry', message: caixaCopy.pay.error });
      return;
    }

    setAmountCents(data.amountCents);
    setExpiresAt(data.expiresAt);
    // O servidor trava o metodo na primeira cobranca, entao quem pediu cartao
    // pode receber Pix de volta. Renderiza pela RESPOSTA.
    setMethod(data.method);

    if (data.method === 'pix') {
      setBrCode(data.brCode);
      return;
    }

    setCardPhase('sheet');
    const outcome = await pay(data.clientSecret);
    if (!activeRef.current) return;
    if (outcome.kind === 'cancelled') {
      // Sheet fechada e escolha do usuario, nunca o caminho de erro.
      setCardPhase('idle');
      setSheetMessage(caixaCopy.pay.sheetCancelled);
      return;
    }
    if (outcome.kind === 'failed') {
      setCardPhase('idle');
      setSheetMessage(caixaCopy.pay.sheetFailed);
      return;
    }
    // 'paid' na sheet ainda depende do webhook virar a Order. A tela so
    // espera o poll; ela nunca escreve estado de pedido.
    setCardPhase('waiting');
  } finally {
    runningRef.current = false;
  }
  // Sem deps: `checkout` e `pay` tem identidade nova a cada render, e isto so
  // roda quando chamado.
}, []);
```

Trocar o efeito de mount (linhas 116-118). **`checkoutError` fora das deps, de propósito** — armadilha 1:

```tsx
const startedRef = useRef(false);
useEffect(() => {
  if (method === null) return; // aguardando a escolha
  if (startedRef.current) return;
  startedRef.current = true;
  void runCheckout(method);
}, [method, runCheckout]);
```

Gatear o poll (linhas 121-124) — armadilha 5:

```tsx
const { status, retry } = useBoxPaymentPoll({
  expiresAt: expiresAt ?? '',
  // Nao pollar com a sheet presente: uma falha de rede ali trava o status em
  // 'error' para sempre (o hook nao reagenda), e um webhook rapido navegaria
  // para /caixa por baixo de um modal nativo aberto.
  enabled: expiresAt !== null && cardPhase !== 'sheet',
});
```

Trocar a chamada do botão de erro na linha 156 — armadilha 3:

```tsx
            onPress={() => void runCheckout(method ?? 'pix')}
```

Acrescentar a tela de seleção **antes** do `if (loading || ...)` da linha 142. Essa ordem é load-bearing: invertida, o skeleton engole o seletor, porque no primeiro render `loading` é false e `expiresAt` é null. **Sem bloco de `sheetMessage` aqui:** `method` nunca volta a `null`, então seria código morto.

```tsx
if (method === null) {
  return (
    <View style={styles.screen}>
      <Header />
      <View style={styles.center}>
        <Text variant="h3" style={styles.centerTitle}>
          {caixaCopy.pay.methodTitle}
        </Text>
        {(
          [
            ['pix', caixaCopy.pay.methodPix, caixaCopy.pay.methodPixHint],
            ['card', caixaCopy.pay.methodCard, caixaCopy.pay.methodCardHint],
          ] as const
        ).map(([value, label, hint]) => (
          <Pressable
            key={value}
            style={styles.methodCard}
            accessibilityRole="radio"
            accessibilityState={{ selected: false }}
            accessibilityLabel={`${label}. ${hint}`}
            onPress={() => setMethod(value)}
          >
            <Text variant="body" weight="semibold">
              {label}
            </Text>
            <Text variant="bodySm" tone="muted">
              {hint}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
```

`accessibilityRole="radio"` + `accessibilityState` é o padrão da casa para escolha mutuamente exclusiva. O seletor Pix/cartão do carrinho (`cart/index.tsx:971-984`) é literalmente a mesma decisão noutra tela. Leia antes de escrever e siga.

Acrescentar os ramos do cartão **DEPOIS** de todos os ramos de `status` (ou seja, depois do bloco `status === 'error'` que termina na linha 220), imediatamente antes do `return` final do Pix — armadilha 2:

```tsx
// Depois dos ramos de `status`, nao antes: 'paid', 'closed_budget_only',
// 'expired' e 'error' precisam vencer o spinner do cartao. Colocado antes,
// `cardPhase: 'waiting'` vira terminal — a tela de sucesso fica inalcancavel
// e um erro do poll (que nao reagenda) prende o usuario para sempre.
if (method === 'card' && cardPhase !== 'idle') {
  return (
    <View style={styles.screen}>
      <Header />
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text variant="h3" style={styles.centerTitle}>
          {cardPhase === 'sheet' ? caixaCopy.pay.cardInstruction : caixaCopy.pay.cardWaiting}
        </Text>
      </View>
    </View>
  );
}

if (method === 'card') {
  // cardPhase 'idle' com metodo cartao: a sheet fechou sem pagar.
  return (
    <View style={styles.screen}>
      <Header />
      <View style={styles.center}>
        {sheetMessage ? (
          <Text variant="bodySm" tone="secondary" style={styles.centerBody}>
            {sheetMessage}
          </Text>
        ) : null}
        <Button
          label={caixaCopy.pay.cardOpenSheet}
          onPress={() => void runCheckout('card')}
          className="mt-5"
        />
      </View>
    </View>
  );
}
```

Trocar a mensagem de expiração (linha 201):

```tsx
{
  method === 'card' ? caixaCopy.pay.expiredCard : caixaCopy.pay.expired;
}
```

E acrescentar ao `StyleSheet.create`:

```ts
  methodCard: {
    width: '100%',
    padding: theme.spacing.md,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
```

- [ ] **Step 4: Rodar tudo do mobile**

```bash
cd apps/mobile && pnpm exec vitest run app/__tests__/caixa-pagar-card.test.tsx app/__tests__/caixa-pagar-no-stripe.test.tsx
cd ../.. && pnpm --filter @ccc/mobile test
pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint
```

Nenhum teste existente renderiza `pagar.tsx`, então não há rede de regressão para o mount que mudou. Os dois arquivos novos são ela.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(app)/caixa/pagar.tsx" apps/mobile/app/__tests__/caixa-pagar-card.test.tsx apps/mobile/app/__tests__/caixa-pagar-no-stripe.test.tsx
git commit -m "feat(caixa): seletor de metodo e PaymentSheet na tela de pagamento"
```

---

## Verificação final antes do PR

- [ ] Suíte inteira da API: `cd apps/api && pnpm exec vitest run`. ~13 min. Se o runner for morto pelo limite de tempo do ambiente, rode em blocos por diretório e some os totais; `test/stripe` como filtro casa também com `test/stripe-webhook-push.test.ts`, então a soma dos blocos passa do numero de arquivos no disco. Este trabalho toca settle, cutoff, webhook, resume e refund, caminhos compartilhados com ingressos, loja e garagem.
- [ ] `pnpm --filter @ccc/shared test && pnpm --filter @ccc/mobile test`
- [ ] Lint e typecheck nos três pacotes; warnings não sobem.
- [ ] **QA do caminho infeliz, que é o motivo da Task 2 existir.** No sandbox: confirmar uma caixa, gerar o PI, esperar o cutoff cancelar a Order, e só então pagar. Esperado: webhook 200, estorno automático, Order segue `cancelled`, caixa não envia. Se der 500, a Task 2 não ficou certa.
- [ ] QA do caminho feliz: pagar no cartão e confirmar que a caixa vira `ready` só depois do webhook, não quando a sheet fecha.
- [ ] QA da trava: gerar Pix, voltar, escolher cartão, confirmar que a tela mostra o Pix de novo.
- [ ] QA das guardas: com uma Order de caixa no cartão, chamar `GET /orders/:id/resume` e o estorno do admin. Esperado 409 e 501.
- [ ] Build antigo do app continua no Pix: `curl -X POST` sem `--data` e sem `content-type`.
- [ ] **Ordem de deploy, obrigatória: API no Railway ANTES de qualquer build EAS ou OTA da Expo.** O schema novo rejeita resposta sem `method`, então um app novo contra API velha quebra a tela de pagamento inclusive no Pix.
- [ ] Abrir o PR para `main`.

## Fora de escopo, registrado

- **Estorno e chargeback de caixa (Fase 4c).** A Task 3 fecha a porta do admin. Falta: `stripe-webhook.ts:650-656` marca `refunded` e chama `revokeTicketsForRefundedOrder`, que não tem ramo de `box` (`services/orders/revoke.ts:200-229`), então uma caixa contestada segue `ready` e é enviada. Antes deste trabalho isso era inalcançável; depois dele passa a ser possível por disputa, que não dá para bloquear. Priorizar a 4c.
- **Reconciliação de PI de caixa.** Não há worker do lado Stripe: `order-expiry` age por `expiresAt`, que caixa não tem. Um `payment_intent.succeeded` perdido só aparece no corte, como falha de cancel com a tag `box-cutoff-pi-paid-after-cutoff` da Task 5. É por isso que a tag existe.
- **Cobrança órfã da corrida de duplo checkout.** A Fase A comita sem carimbar, então dois pedidos concorrentes podem criar duas cobranças reais. Só uma é carimbada e mostrada; a perdedora vai para o Sentry com a tag `box-checkout-orphan`. Prevenir a criação exigiria pré-claim sob o lock, fora de escopo desde a 4a.
- Hosted checkout da caixa no web.
- Repasse da taxa do cartão (decisão 1).
- Google Pay na sheet.
