# Pix na pré-venda Casa In Box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O comprador da pré-venda escolhe Pix, recebe o código copia-e-cola na página e por email, e a compra é honrada mesmo se ele pagar depois do prazo.

**Architecture:** O caminho de cartão não muda. O checkout ganha um ramo por `paymentMethod`: cartão segue para a Stripe, Pix cria cobrança no AbacatePay, guarda `brCode` e `expiresAt` no `Order` e dispara email com o código. A liquidação chega pelo webhook do AbacatePay, com o `pix-reconcile` como rede para webhook perdido.

**Tech Stack:** Fastify, Prisma, zod, Next.js App Router (`apps/garage`), AbacatePay.

**Spec:** `docs/superpowers/specs/2026-11-11-presale-pix-design.md`

## Global Constraints

- Pedido só vira `paid` por webhook verificado. Nenhuma rota de cliente escreve status.
- A chamada ao provedor acontece **fora** de qualquer transação Prisma.
- A pré-venda **não reserva estoque**. `quantitySold` só incrementa na liquidação.
- Nenhuma linha de `User` é criada ou tocada a partir do formulário público.
- Pedido de pré-venda **cartão** continua com `Order.expiresAt` nulo. Só pedido **Pix** recebe prazo.
- Janela do Pix: **3600 segundos**, passada como `expiresInSeconds` e refletida em `Order.expiresAt`.
- Copy PT-BR em `apps/garage/src/copy/presale.ts`. Nenhum literal solto em componente.
- Nenhuma alteração de comportamento em `routes/store.ts`, `routes/cart.ts`, `services/cart/*`, `services/box/*`.
- Nenhum teste com data fixa: injete `now` ou use datas relativas.
- Nenhum teste de DOM em `apps/garage` (`vitest.config.ts:20` é `environment: 'node'`; use `renderToStaticMarkup`).
- Cobrança Pix **não** envia `customer`, igual `routes/cart.ts:743`. Não coletar CPF.

## Review Focus

Cinco entradas que a spec implica e que nenhuma tarefa exercitaria sozinha. Cada uma tem o teste que a prende, na tarefa dona do código.

1. **Pagou depois do prazo.** Pedido já `expired` localmente, Pix liquidado no provedor: tem que virar `paid` e avisar o comprador. É a decisão central da spec. Teste na Task 5.
2. **Clicou em pagar duas vezes.** O segundo POST não pode criar cobrança nova nem segundo `brCode` para o mesmo pedido: devolve o código que já existe. Teste na Task 2.
3. **Provedor fora do ar.** `createPixBilling` falha: o pedido não pode ficar meio-criado sem código e sem erro. Teste na Task 2.
4. **Webhook repetido.** O mesmo evento do AbacatePay chega duas vezes: liquida uma vez, email sai uma vez. Teste na Task 4.
5. **Código morreu no provedor e o pedido continua `pending` local.** A página tem que dizer que o código expirou, não ficar "aguardando pagamento" para sempre. Teste na Task 6.

---

### Task 1: Contrato compartilhado e migração

**Files:**

- Modify: `packages/shared/src/presale.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_presale_pix/migration.sql`
- Test: `packages/shared/src/__tests__/presale.test.ts`

**Interfaces:**

- Produces: `presalePaymentMethodSchema` (`z.enum(['card','pix'])`); `paymentMethod` em `presaleCheckoutRequestSchema`, opcional com default `'card'`; `presaleCheckoutResponseSchema` discriminada por `paymentMethod`; campos `brCode`, `pixExpiresAt` em `presaleOrderStatusResponseSchema`; coluna `Order.pixCodeEmailSentAt DateTime?`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('paymentMethod default é card quando omitido', () => {
  expect(presaleCheckoutRequestSchema.parse(baseReq).paymentMethod).toBe('card');
});

it('resposta de cartão exige checkoutUrl e recusa brCode', () => {
  /* ... */
});

it('resposta de pix exige brCode e pixExpiresAt, e recusa checkoutUrl', () => {
  /* ... */
});

it('status devolve brCode e pixExpiresAt nulos em pedido de cartão', () => {
  /* ... */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/presale.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar schemas e migração**

A resposta vira união discriminada por `paymentMethod`: o ramo `card` mantém `checkoutUrl` obrigatório, o ramo `pix` traz `brCode: z.string().min(1)` e `pixExpiresAt: z.string().datetime()`. No status, os dois campos são nuláveis. A coluna nova é `pixCodeEmailSentAt DateTime?` em `Order`, sem default, espelhando `confirmationEmailSentAt`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd packages/shared && pnpm exec vitest run` e `pnpm --filter @ccc/shared build`
Expected: PASS. O build é obrigatório: `apps/api` resolve por `dist/`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src packages/db/prisma
git commit -m "feat(presale): contrato de pagamento por Pix e coluna de dedupe do email"
```

---

### Task 2: Cobrança Pix no checkout

**Files:**

- Modify: `apps/api/src/services/presale/checkout.ts`
- Test: `apps/api/test/presale/pix-checkout.test.ts`

**Interfaces:**

- Consumes: schemas da Task 1.
- Produces: `createPresaleOrder` passa a devolver resposta de Pix quando `paymentMethod === 'pix'`, com `brCode` e `pixExpiresAt`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('pix grava brCode, providerRef e expiresAt de 1h', async () => {
  /* ... */
});

it('clique duplo devolve o mesmo brCode e não cria segunda cobrança', async () => {
  /* Review Focus 2: assere que o fake do provedor foi chamado UMA vez */
});

it('provedor fora do ar devolve 502 e não deixa pedido sem código', async () => {
  /* Review Focus 3 */
});

it('cartão continua devolvendo checkoutUrl e expiresAt nulo', async () => {
  /* regressão */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd apps/api && pnpm exec vitest run test/presale/pix-checkout.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o ramo de Pix**

O guard de reentrada espelha `if (order.checkoutUrl) return succeed(...)` que já existe para cartão: se `order.brCode` já existe, devolve o que está gravado sem chamar o provedor. `createPixBilling` recebe `expiresInSeconds: 3600`, `metadata: { orderId }`, e **não** recebe `customer`. A chamada fica fora de transação, com o mesmo formato de `try` estreito que o ramo da Stripe usa: só a chamada do provedor dentro do `try`. `expiresAt` grava `criação + 3600s`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd apps/api && pnpm exec vitest run test/presale/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/presale apps/api/test/presale
git commit -m "feat(presale): checkout por Pix cria cobranca no AbacatePay"
```

---

### Task 3: Email com o código Pix

**Files:**

- Create: `apps/api/src/services/presale/pix-code-email.ts`
- Modify: `apps/api/src/services/presale/checkout.ts`
- Test: `apps/api/test/presale/pix-code-email.test.ts`

**Interfaces:**

- Consumes: `Order.pixCodeEmailSentAt` da Task 1.
- Produces: `sendPresalePixCodeEmail(orderId, deps): Promise<boolean>` — `true` se enviou, `false` se já tinha sido enviado.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('envia uma vez e marca pixCodeEmailSentAt', async () => {
  /* ... */
});

it('segunda chamada não reenvia', async () => {
  /* dedupe compare-and-set */
});

it('o email contém o brCode e o link de status do pedido', async () => {
  /* ... */
});

it('não envia para pedido que não é de pré-venda', async () => {
  /* escopo por origin */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd apps/api && pnpm exec vitest run test/presale/pix-code-email.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o envio**

Modelado em `confirmation-email.ts`, inclusive o dedupe por
`updateMany({ where: { id, pixCodeEmailSentAt: null }, ... })` com envio só se `count === 1`. O link de status usa `presaleOrderStatusUrl` de `@ccc/shared/presale`, o mesmo builder do email de confirmação. Escopado por `origin: 'casa_in_box'` **antes** de tocar o pedido. Chamado pelo checkout depois de gravar o `brCode`; falha de envio não derruba o checkout, que já respondeu com o código.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd apps/api && pnpm exec vitest run test/presale/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/presale apps/api/test/presale
git commit -m "feat(presale): email com o codigo Pix no momento da geracao"
```

---

### Task 4: Liquidação pelo webhook do AbacatePay

**Files:**

- Modify: `apps/api/src/routes/abacatepay-webhook.ts`
- Test: `apps/api/test/presale/pix-webhook.test.ts`

**Interfaces:**

- Consumes: `sendPresaleConfirmationEmail` de `services/presale/confirmation-email.ts`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('liquida pedido de pré-venda e envia email de confirmação', async () => {
  /* ... */
});

it('evento repetido liquida uma vez e envia email uma vez', async () => {
  /* Review Focus 4 */
});

it('pedido comum da loja não ganha comportamento novo', async () => {
  /* regressão */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd apps/api && pnpm exec vitest run test/presale/pix-webhook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Ligar o email na liquidação**

Depois da liquidação, chamar `sendPresaleConfirmationEmail` **escopado por `origin === 'casa_in_box'` antes de tocar o pedido**, pelo mesmo motivo registrado no achado I2 da pré-venda: envio não escopado carimbava pedido comum da loja. A idempotência do webhook já existe por event id; o dedupe do email é o compare-and-set que `confirmation-email.ts` já faz.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd apps/api && pnpm exec vitest run test/presale/ test/cart/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/abacatepay-webhook.ts apps/api/test/presale
git commit -m "feat(presale): webhook do AbacatePay liquida pre-venda e confirma por email"
```

---

### Task 5: Recuperação tardia avisa o comprador

**Files:**

- Modify: `apps/api/src/workers/pix-reconcile.ts`
- Test: `apps/api/test/presale/pix-recovery.test.ts`

**Interfaces:**

- Consumes: `sendPresaleConfirmationEmail`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('pedido expirado localmente e pago no provedor vira paid', async () => {
  /* Review Focus 1 — a decisão central da spec */
});

it('a recuperação envia email ao comprador, não só alerta interno', async () => {
  /* ... */
});

it('pedido de ingresso continua recebendo push, sem mudança', async () => {
  /* regressão */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd apps/api && pnpm exec vitest run test/presale/pix-recovery.test.ts`
Expected: FAIL.

- [ ] **Step 3: Permitir a liquidação tardia e avisar por email**

Hoje `notifyRecoveredOrder` sai cedo para qualquer `kind` que não seja `ticket` ou `extras_only`, e manda **push**. Convidado de pré-venda **não tem conta**, logo não tem `userId` e push é impossível: o aviso dele é email.

A condição que libera a liquidação tardia tem que ser escrita pelo **motivo**, não pelo rótulo: o pedido não reservou estoque, então nada foi devolvido à prateleira e liquidar não revende nada. Condicionar em "é pré-venda" repete a classe de bug de rota chaveada por `provider` e cega a `kind`. Deixe o motivo no comentário.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd apps/api && pnpm exec vitest run test/presale/ test/cart/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/pix-reconcile.ts apps/api/test/presale
git commit -m "feat(presale): pagamento tardio e honrado e o comprador e avisado"
```

---

### Task 6: Rota de status expõe o Pix

**Files:**

- Modify: `apps/api/src/routes/presale.ts`
- Test: `apps/api/test/presale/confirmation.test.ts`

**Interfaces:**

- Produces: `brCode` e `pixExpiresAt` na resposta de status, nulos em pedido de cartão.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('status de pedido pix devolve brCode e pixExpiresAt', async () => {
  /* ... */
});

it('status de pedido de cartão devolve os dois nulos', async () => {
  /* ... */
});

it('pix com prazo vencido e pedido ainda pending é sinalizado como expirado', async () => {
  /* Review Focus 5 — a página não pode dizer "aguardando" para sempre */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd apps/api && pnpm exec vitest run test/presale/confirmation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Acrescentar os campos**

A rota já valida a saída com `presaleOrderStatusResponseSchema.parse()` antes do `reply.send` — mantenha. O sinal de "código vencido" sai da comparação de `expiresAt` com o `now` injetado, nunca de `Date.now()` dentro do handler.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd apps/api && pnpm exec vitest run test/presale/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/presale.ts apps/api/test/presale
git commit -m "feat(presale): rota de status devolve codigo e prazo do Pix"
```

---

### Task 7: Escolha do método na página de venda

**Files:**

- Modify: `apps/garage/src/components/presale/CasaInBoxCheckout.tsx`
- Modify: `apps/garage/src/lib/presale-api.ts`
- Modify: `apps/garage/src/copy/presale.ts`
- Test: `apps/garage/app/casa-in-box/__tests__/page.test.tsx`

**Interfaces:**

- Consumes: `presaleCheckoutRequestSchema` com `paymentMethod`, resposta discriminada.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('oferece cartão e Pix, com cartão pré-selecionado', () => {
  /* ... */
});

it('o payload de checkout carrega o método escolhido', () => {
  /* função pura */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/garage test`
Expected: FAIL.

- [ ] **Step 3: Implementar o seletor**

`startPresaleCheckout` passa a tratar a resposta discriminada: cartão redireciona como hoje, Pix leva para a página de status do pedido, que é onde o código é exibido. Toda string nova vem de `copy/presale.ts`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/garage test && pnpm --filter @ccc/garage build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/garage/src apps/garage/app
git commit -m "feat(presale): escolha entre cartao e Pix na pagina de venda"
```

---

### Task 8: Código Pix na página de retorno

**Files:**

- Modify: `apps/garage/src/components/presale/OrderStatusView.tsx`
- Modify: `apps/garage/app/casa-in-box/obrigado/page.tsx`
- Modify: `apps/garage/src/copy/presale.ts`
- Test: `apps/garage/app/casa-in-box/obrigado/__tests__/page.test.tsx`

**Interfaces:**

- Consumes: `brCode` e `pixExpiresAt` do status (Task 6).

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('pendente com brCode mostra o código e o prazo', () => {
  /* ... */
});

it('pendente com prazo vencido diz que o código expirou', () => {
  /* ... */
});

it('pendente de cartão continua com a copy de cartão, sem código', () => {
  /* regressão */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/garage test`
Expected: FAIL.

- [ ] **Step 3: Implementar a exibição e ajustar o polling**

`OrderStatusView` continua puro: código e prazo chegam por prop. O teto de polling de 60s foi dimensionado para cartão; para Pix acompanhe enquanto a cobrança viver, parando no vencimento. Ao parar, a copy aponta o link do email como caminho de volta.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/garage test && pnpm --filter @ccc/garage typecheck && pnpm --filter @ccc/garage build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/garage/src apps/garage/app
git commit -m "feat(presale): pagina de retorno mostra o codigo Pix e o prazo"
```

---

## Verificação final

- [ ] `NODE_OPTIONS=--max-old-space-size=8192 pnpm exec eslint .` na raiz: zero errors.
- [ ] `pnpm typecheck` na raiz. Ele arrasta os builds pelo turbo e é o único que pega erro de fronteira cliente/servidor do Next; `tsc --noEmit` por pacote não pega.
- [ ] `pnpm format:check`.
- [ ] Suíte completa de `apps/api` (~18 min), mais `@ccc/shared`, `@ccc/garage` e `@ccc/admin`.
- [ ] Suítes de loja, carrinho e caixa passam sem alteração.
