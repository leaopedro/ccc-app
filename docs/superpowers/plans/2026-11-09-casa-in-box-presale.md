# Casa In Box — Funil de Pré-venda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vender a Casa In Box para visitantes sem conta, por duas páginas públicas em `garage.casacar.club`, com pagamento único em BRL pela Stripe.

**Architecture:** Três camadas. (1) API Fastify ganha o namespace público `/presale/casa-in-box` com uma única função de elegibilidade compartilhada pelas três superfícies, serializador próprio, e um checkout que recalcula tudo no servidor. (2) O pedido é um `Order` normal com `kind: 'product'` e `origin: 'casa_in_box'`, pendurado num usuário-sistema, com os dados do comprador numa tabela `PresaleGuest`. (3) `apps/garage` ganha três rotas públicas, com a lógica de montagem em módulos puros e os componentes finos.

**Tech Stack:** TypeScript, Fastify, Prisma/Postgres, Next.js 16 App Router, Tailwind v4, Zod, Stripe Checkout Session, Vitest, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-11-09-casa-in-box-presale-design.md`

## Global Constraints

- Branch: nunca editar, commitar ou dar push em `production`. Branch nova a partir de `main` atualizado.
- Idioma de toda copy visível: PT-BR. Copy num módulo único por app, nunca literal solto em componente.
- A pré-venda **não** soma `DEV_FEE_PERCENT`. Todo pedido grava `devFeePercent: 0` e `devFeeAmountCents: 0` explicitamente (a coluna tem default 10).
- A pré-venda **não reserva estoque**. `Variant.quantitySold` só é incrementado na liquidação do pagamento, sem guarda de teto.
- Nenhuma linha de `User` é criada, atualizada ou tocada a partir de input do formulário público.
- `Order.expiresAt` fica **nulo** em pedido de pré-venda.
- `expires_at` da sessão Stripe = `Math.floor((Date.now() + 30 * 60 * 1000) / 1000)`, recalculado no momento da chamada.
- A chamada da Stripe acontece **fora** de qualquer transação Prisma.
- Toda mudança de schema exige migração commitada em `packages/db/prisma/migrations/`. `apps/api/test/global-setup.ts:22` roda `prisma migrate deploy`.
- Token de pedido viaja em corpo de `POST`, nunca em querystring.
- Nenhum teste de DOM no `apps/garage`: `apps/garage/vitest.config.ts:20` é `environment: 'node'` e não há jsdom nem `@testing-library/*`. Componentes se testam com `renderToStaticMarkup`.
- Nenhuma alteração de comportamento em `routes/store.ts`, `routes/cart.ts`, `services/cart/*` ou `services/box/*`.
- Nenhum teste com data fixa: use datas relativas ou injete `now`.

## Review Focus

Cinco classes de entrada que a spec implica e que nenhuma tarefa exercitaria por conta própria. Cada linha tem o teste que a prende, na tarefa dona do código.

1. **Faixas de CEP vazias.** Campanha com `deliveryCepRanges: []` tem que deixar a entrega **indisponível**, não liberada para todo mundo. Teste na Task 5.
2. **`variantId` repetido no payload.** Duas linhas do mesmo id têm que somar numa só, nunca virar dois `OrderItem` nem dobrar o frete. Teste na Task 7.
3. **Retirada com frete configurado.** `shippingFeeCents > 0` com `fulfillmentMethod: 'pickup'` tem que resultar em `shippingCents: 0`. Teste na Task 5.
4. **Produto elegível sem foto.** A loja exige foto para ativar, a pré-venda não pode confiar nisso: produto sem `ProductPhoto` sai da vitrine em vez de serializar `coverImageUrl: null` e quebrar o layout. Teste na Task 3.
5. **Quantidade inválida.** Zero, negativa, fracionária, acima de 20 ou não-numérica tem que ser recusada no schema, antes de qualquer leitura de banco. Teste na Task 2.

---

## File Structure

**Criar:**

- `packages/shared/src/presale.ts` — schemas Zod públicos da pré-venda (campanha, produto, variante, checkout, status do pedido)
- `packages/db/src/presale-system-user.ts` — email e garantia do usuário-sistema
- `apps/api/src/services/presale/eligibility.ts` — a única regra de elegibilidade
- `apps/api/src/services/presale/serialize.ts` — serializador próprio
- `apps/api/src/services/presale/totals.ts` — `cepInRanges`, `computePresaleTotals`
- `apps/api/src/services/presale/checkout.ts` — validação e criação do pedido
- `apps/api/src/services/presale/settings.ts` — `ensurePresaleSettings`
- `apps/api/src/services/presale/confirmation-email.ts` — envio com dedupe
- `apps/api/src/routes/presale.ts` — rotas públicas
- `apps/api/src/routes/admin/presale-admin.ts` — config da campanha e busca por email
- `apps/garage/src/lib/presale-api.ts` — cliente da API
- `apps/garage/src/lib/presale-box.ts` — store da caixa em `localStorage` (módulo puro)
- `apps/garage/src/copy/presale.ts` — toda a copy PT-BR
- `apps/garage/app/(garage)/layout.tsx` — coluna de 430px da garagem
- `apps/garage/app/casa-in-box/{page,montar/page,obrigado/page}.tsx`
- `apps/garage/src/components/presale/*` — componentes de apresentação
- `apps/admin/app/(authed)/loja/pre-venda/page.tsx` — config + busca
- `apps/garage/public/casa-in-box-hero.webp`

**Modificar:**

- `packages/db/prisma/schema.prisma` — `Product.visibleInPresale`, `PresaleSettings`, `PresaleGuest`, `OrderOrigin`, quatro colunas em `Order`
- `packages/db/prisma/seed.ts` — usuário-sistema e singleton
- `packages/shared/package.json` — entrada de export `./presale`
- `packages/shared/src/admin.ts` — `visibleInPresale` nos schemas de produto
- `apps/api/src/routes/admin/store/products.ts` — persistência do flag + rejeição de singleton
- `apps/api/src/routes/admin/store/serializers.ts` — flag no detalhe
- `apps/api/src/routes/admin/index.ts` — registrar rotas de pré-venda
- `apps/api/src/app.ts` — registrar `presaleRoutes`
- `apps/api/src/lib/qr.ts` — kind novo
- `apps/api/src/routes/stripe-webhook.ts` — três mudanças restritas a `origin: 'casa_in_box'`
- `apps/api/src/services/orders/settle.ts` — débito de estoque no ramo `product`
- `apps/api/src/services/orders/admin-detail.ts` — origem e dados do convidado
- `apps/api/src/workers/retention.ts` — purga de convidado abandonado
- `apps/admin/.../loja/produtos/[id]/product-form.tsx` — a checkbox
- `apps/admin/app/(authed)/pedidos/[id]/page.tsx` — exibir origem
- `apps/garage/app/layout.tsx` — tirar a coluna
- `apps/garage/app/not-found.tsx` — embrulhar na própria coluna
- `apps/garage/app/g/` → `apps/garage/app/(garage)/g/` (move, mais dois imports de teste)
- `docs/ropa.md`, `packages/shared/src/legal.ts`

---

## Task 1: Schema, migração e seed

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/prisma/seed.ts`
- Create: `packages/db/prisma/migrations/<timestamp>_presale_casa_in_box/migration.sql`
- Test: `apps/api/test/migrations/presale-schema.test.ts`

**Interfaces:**

- Produces: `Product.visibleInPresale: boolean`; model `PresaleSettings`; model `PresaleGuest`; enum `OrderOrigin { app, casa_in_box }`; `Order.origin`, `Order.clientRequestId`, `Order.checkoutUrl`, `Order.confirmationEmailSentAt`; constante exportada `PRESALE_SYSTEM_USER_EMAIL` em `packages/db/src/presale-system-user.ts`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/test/migrations/presale-schema.test.ts`, seguindo o padrão dos testes vizinhos em `apps/api/test/migrations/`:

```ts
it('product nasce fora da pré-venda', async () => {
  const product = await createProduct(); // helper existente de test/helpers.ts
  expect(product.visibleInPresale).toBe(false);
});

it('order nasce com origin app', async () => {
  const order = await createProductOrder();
  expect(order.origin).toBe('app');
  expect(order.clientRequestId).toBeNull();
  expect(order.confirmationEmailSentAt).toBeNull();
});

it('a unique de clientRequestId não impede dois pedidos sem id', async () => {
  await expect(Promise.all([createProductOrder(), createProductOrder()])).resolves.toHaveLength(2);
});

it('PresaleSettings nasce desligado', async () => {
  const s = await prisma.presaleSettings.create({ data: {} });
  expect(s.enabled).toBe(false);
  expect(s.shippingFeeCents).toBe(0);
  expect(s.deliveryCepRanges).toEqual([]);
});

it('PresaleGuest é apagado junto com o pedido', async () => {
  const order = await createProductOrder();
  await prisma.presaleGuest.create({ data: { orderId: order.id, name: 'A', email: 'a@b.c' } });
  await prisma.order.delete({ where: { id: order.id } });
  await expect(
    prisma.presaleGuest.findUnique({ where: { orderId: order.id } }),
  ).resolves.toBeNull();
});

it('o usuário-sistema não consegue autenticar', async () => {
  const u = await prisma.user.findUnique({ where: { email: PRESALE_SYSTEM_USER_EMAIL } });
  expect(INACTIVE_USER_STATUSES).toContain(u!.status);
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- presale-schema`
Expected: FAIL, coluna/modelo inexistente.

- [ ] **Step 3: Editar o schema**

Em `packages/db/prisma/schema.prisma`, exatamente os campos listados na seção "Banco" da spec. `PresaleGuest.orderId` é `@unique` com `onDelete: Cascade`. `Order` ganha `@@unique([origin, clientRequestId])` e a relação `presaleGuest PresaleGuest?`. `Product` ganha `@@index([visibleInPresale, status])`.

- [ ] **Step 4: Gerar a migração e commitá-la**

Run: `pnpm --filter @ccc/db exec prisma migrate dev --name presale_casa_in_box`
A pasta gerada **tem que entrar no commit**.

- [ ] **Step 5: Seed do usuário-sistema e do singleton**

Em `packages/db/src/presale-system-user.ts`, exportar `PRESALE_SYSTEM_USER_EMAIL` (endereço em domínio próprio, não roteável) e `ensurePresaleSystemUser(): Promise<string>` devolvendo o id. Em `seed.ts`, chamar essa função e criar o singleton de `PresaleSettings` se não existir. O usuário nasce `status: 'disabled'`, `passwordHash: null`, `role: 'user'`, `name: 'Casa In Box (convidado)'` — `disabled` está em `INACTIVE_USER_STATUSES` (`packages/shared/src/auth.ts:24`), que é checado em `login.ts:33`, `refresh.ts:32`, `mfa-verify.ts:52`, `forgot-password.ts` e `plugins/auth.ts:56`.

- [ ] **Step 6: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- presale-schema`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db apps/api/test/migrations/presale-schema.test.ts
git commit -m "feat(presale): schema, migracao e usuario-sistema da Casa In Box"
```

---

## Task 2: Schemas compartilhados

**Files:**

- Create: `packages/shared/src/presale.ts`
- Modify: `packages/shared/package.json`
- Test: `packages/shared/src/__tests__/presale.test.ts`

**Interfaces:**

- Produces: `presaleCampaignSchema`, `presaleProductSchema`, `presaleVariantSchema`, `presaleProductListResponseSchema`, `presaleCheckoutRequestSchema`, `presaleCheckoutResponseSchema`, `presaleOrderStatusRequestSchema`, `presaleOrderStatusResponseSchema`, `presaleFulfillmentMethodSchema`, e `PRESALE_MAX_QTY_PER_VARIANT = 20`. Tipos inferidos com os mesmos nomes em PascalCase.

Formato de `presaleCheckoutRequestSchema`: `{ clientRequestId: string (1..64), expectedTotalCents: int >= 0, fulfillmentMethod: 'pickup' | 'ship', items: Array<{ variantId: string, quantity: int 1..20 }> (1..50), guest: { name, email, phone? }, delivery?: { recipientName, line1, number, district, city, stateCode, postalCode }, acceptedTermsVersion: string, acceptedPrivacyVersion: string }`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('recusa quantidade fora de 1..20', () => {
  for (const quantity of [0, -1, 1.5, 21, '2' as unknown as number]) {
    expect(
      presaleCheckoutRequestSchema.safeParse(req({ items: [{ variantId: 'v1', quantity }] }))
        .success,
    ).toBe(false);
  }
});

it('recusa caixa vazia', () => {
  expect(presaleCheckoutRequestSchema.safeParse(req({ items: [] })).success).toBe(false);
});

it('exige delivery quando fulfillmentMethod é ship', () => {
  expect(
    presaleCheckoutRequestSchema.safeParse(req({ fulfillmentMethod: 'ship', delivery: undefined }))
      .success,
  ).toBe(false);
});

it('recusa delivery quando fulfillmentMethod é pickup', () => {
  expect(
    presaleCheckoutRequestSchema.safeParse(
      req({ fulfillmentMethod: 'pickup', delivery: validDelivery }),
    ).success,
  ).toBe(false);
});

it('recusa email malformado', () => {
  /* guest.email: 'nao-e-email' */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/shared test -- presale`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar `packages/shared/src/presale.ts`**

Reusar `cepSchema` de `./store.js` para `postalCode`. O cruzamento `ship` ⇄ `delivery` é um `.superRefine`. Adicionar a entrada `"./presale"` em `packages/shared/package.json`, no formato das entradas vizinhas.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/shared test -- presale && pnpm --filter @ccc/shared build`
Expected: PASS e build limpo.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(presale): schemas compartilhados da pre-venda"
```

---

## Task 3: Elegibilidade e serialização

**Files:**

- Create: `apps/api/src/services/presale/eligibility.ts`
- Create: `apps/api/src/services/presale/serialize.ts`
- Test: `apps/api/test/presale/eligibility.test.ts`

**Interfaces:**

- Consumes: schemas da Task 2.
- Produces: `PRESALE_PRODUCT_WHERE: Prisma.ProductWhereInput`, `PRESALE_PRODUCT_INCLUDE`, `loadEligiblePresaleProducts(): Promise<PresaleProductRow[]>`, `serializePresaleProduct(row): PresaleProduct`. `PRESALE_PRODUCT_WHERE` é a **única** definição de elegibilidade; a Task 7 importa esta mesma constante.

- [ ] **Step 1: Escrever o teste que falha**

Um caso por critério, cada um criando um produto que falha só naquele:

```ts
it.each([
  ['flag desmarcado', { visibleInPresale: false }],
  ['status draft', { status: 'draft' }],
  ['status archived', { status: 'archived' }],
  ['produto virtual', { virtual: true }],
  ['moeda não-BRL', { currency: 'USD' }],
])('exclui %s', async (_label, patch) => {
  await createPresaleProduct(patch);
  await expect(loadEligiblePresaleProducts()).resolves.toHaveLength(0);
});

it('exclui produto sem nenhuma foto', async () => {
  // Review Focus 4
  await createPresaleProduct({}, { photos: [] });
  await expect(loadEligiblePresaleProducts()).resolves.toHaveLength(0);
});

it('exclui produto cujas variantes estão todas inativas', async () => {
  /* ... */
});

it('inclui o produto elegível e serializa sem preço de display', async () => {
  const [row] = await loadEligiblePresaleProducts();
  const out = serializePresaleProduct(row);
  expect(out).not.toHaveProperty('displayPriceCents');
  expect(out.variants[0]!.priceCents).toBe(9900);
});

// O outro lado da divergência deliberada. Sem este teste, uma refatoração
// futura "conserta" a pré-venda somando a taxa, ou tira a taxa da loja, e
// nada acusa. DEV_FEE_PERCENT tem default 10 em apps/api/src/env.ts:67.
it('a loja continua somando a taxa no mesmo produto', async () => {
  const res = await app.inject({ method: 'GET', url: '/store/products' });
  const range = body(res).items[0].priceRange;
  expect(range.minPriceCents).toBe(9900);
  expect(range.minDisplayPriceCents).toBe(10890);
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- presale/eligibility`
Expected: FAIL.

- [ ] **Step 3: Implementar os dois módulos**

`PRESALE_PRODUCT_WHERE` cobre: `status: 'active'`, `visibleInPresale: true`, `virtual: false`, `currency: 'BRL'`, `photos: { some: {} }`, `variants: { some: { active: true } }`. O serializador monta a URL da foto com `app.uploads.buildPublicUrl` (recebido por parâmetro, não importado), ordena fotos por `sortOrder`, e emite **só** `priceCents` — nunca `displayPriceCents` nem `devFeePercent`. Não importar nada de `routes/store.ts`: os serializadores de lá são `const` privados e o schema público deles exige o preço com taxa.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- presale/eligibility`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/presale apps/api/test/presale
git commit -m "feat(presale): elegibilidade unica e serializador proprio"
```

---

## Task 4: Totais, frete e CEP

**Files:**

- Create: `apps/api/src/services/presale/totals.ts`
- Test: `apps/api/test/presale/totals.test.ts`

**Interfaces:**

- Produces: `cepInRanges(postalCode: string, ranges: Array<{from: string; to: string}>): boolean`; `computePresaleTotals(input: { items: Array<{ priceCents: number; quantity: number }>; fulfillmentMethod: 'pickup' | 'ship'; shippingFeeCents: number }): { subtotalCents: number; shippingCents: number; totalCents: number }`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('faixas vazias nunca liberam entrega', () => {
  // Review Focus 1
  expect(cepInRanges('80010000', [])).toBe(false);
});

it('aceita CEP dentro da faixa, com e sem máscara', () => {
  const r = [{ from: '80000-000', to: '83800-000' }];
  expect(cepInRanges('80010000', r)).toBe(true);
  expect(cepInRanges('80010-000', r)).toBe(true);
});

it('recusa CEP fora da faixa', () => {
  expect(cepInRanges('01001000', [{ from: '80000000', to: '83800000' }])).toBe(false);
});

it('retirada zera o frete mesmo com frete configurado', () => {
  // Review Focus 3
  const t = computePresaleTotals({
    items: [{ priceCents: 9900, quantity: 2 }],
    fulfillmentMethod: 'pickup',
    shippingFeeCents: 2500,
  });
  expect(t).toEqual({ subtotalCents: 19800, shippingCents: 0, totalCents: 19800 });
});

it('entrega soma o frete uma vez só, não por item', () => {
  const t = computePresaleTotals({
    items: [
      { priceCents: 9900, quantity: 2 },
      { priceCents: 4900, quantity: 3 },
    ],
    fulfillmentMethod: 'ship',
    shippingFeeCents: 2500,
  });
  expect(t).toEqual({ subtotalCents: 34500, shippingCents: 2500, totalCents: 37000 });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- presale/totals`
Expected: FAIL.

- [ ] **Step 3: Implementar `totals.ts`**

`cepInRanges` normaliza removendo não-dígitos e compara numericamente. Duplica deliberadamente a aritmética de `services/box/charge.ts:4-15`, que é código do Box mensal e fica intocado — anote isso num comentário no arquivo. Nenhuma função aqui aplica `DEV_FEE_PERCENT`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- presale/totals`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/presale/totals.ts apps/api/test/presale/totals.test.ts
git commit -m "feat(presale): calculo de subtotal, frete e faixa de CEP"
```

---

## Task 5: Token do pedido

**Files:**

- Modify: `apps/api/src/lib/qr.ts`
- Test: `apps/api/test/lib/qr.test.ts` (arquivo existente)

**Interfaces:**

- Produces: `QrKind` passa a incluir `'p'`; `signQrCode('p', orderId, env)` e `verifyQrCode` continuam com a assinatura atual.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao arquivo existente:

```ts
it('assina e verifica o kind de pré-venda', () => {
  const code = signQrCode('p', 'order_1', env);
  expect(verifyQrCode(code, env)).toEqual({ kind: 'p', id: 'order_1' });
});

it('rejeita um código de ticket apresentado como pré-venda', () => {
  const ticket = signQrCode('t', 'order_1', env);
  expect(verifyQrCode(ticket.replace(/^t\./, 'p.'), env)).toBeNull(); // ou throw, conforme o contrato atual do arquivo
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- lib/qr`
Expected: FAIL, `'p'` não é kind válido.

- [ ] **Step 3: Adicionar o kind**

Em `apps/api/src/lib/qr.ts:3,5`, incluir `'p'` em `QrKind` e em `VALID_KINDS`. Nada mais muda: o kind já entra no HMAC (`:10-11`), que é exatamente por que este arquivo foi escolhido em vez de `services/tickets/codes.ts`, que assina o id puro com o mesmo segredo.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- lib/qr`
Expected: PASS, incluindo os testes já existentes dos kinds `t`, `e`, `v`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/qr.ts apps/api/test/lib/qr.test.ts
git commit -m "feat(presale): kind proprio no HMAC para o token do pedido"
```

---

## Task 6: Settings e rotas públicas de leitura

**Files:**

- Create: `apps/api/src/services/presale/settings.ts`
- Create: `apps/api/src/routes/presale.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/presale/routes-read.test.ts`

**Interfaces:**

- Consumes: Tasks 2, 3.
- Produces: `ensurePresaleSettings(): Promise<PresaleSettings>` (no padrão de `services/store-settings.ts`); `presaleRoutes: FastifyPluginAsync`; `GET /presale/casa-in-box/campaign`; `GET /presale/casa-in-box/products`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('503 nas duas rotas quando a campanha está desligada', async () => {
  for (const url of ['/presale/casa-in-box/campaign', '/presale/casa-in-box/products']) {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(503);
  }
});

it('não é desligada pelo storeEnabled da loja', async () => {
  await setPresaleEnabled(true);
  await setStoreEnabled(false);
  expect(
    (await app.inject({ method: 'GET', url: '/presale/casa-in-box/products' })).statusCode,
  ).toBe(200);
});

it('devolve só os produtos elegíveis', async () => {
  /* um elegível, um com flag off */
});

it('campaign devolve os dados comerciais da campanha', async () => {
  /* pickupAddress, firstBatchLabel, shippingFeeCents, deliveryAreaLabel */
});

it('não exige autenticação', async () => {
  /* sem header Authorization */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- presale/routes-read`
Expected: FAIL.

- [ ] **Step 3: Implementar settings e as duas rotas**

`presaleRoutes` registra um `preHandler` próprio que devolve 503 quando `enabled` é falso, **sem** importar nada de `routes/store.ts` — o `preHandler` de lá (`store.ts:321-328`) desligaria a pré-venda junto com a loja. Registrar `@fastify/rate-limit` por rota no padrão de `routes/club-stats.ts:38-43`, com teto folgado: com `trustProxy` desligado (`app.ts:99-103`) a chave por IP colapsa num balde global, como `routes/premium-catalog.ts:78-86` documenta, então o teto é backstop de banco e não pode derrubar comprador legítimo num lançamento. Registrar `presaleRoutes` em `app.ts` junto dos demais.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- presale/routes-read`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/presale/settings.ts apps/api/src/routes/presale.ts apps/api/src/app.ts apps/api/test/presale/routes-read.test.ts
git commit -m "feat(presale): config da campanha e rotas publicas de leitura"
```

---

## Task 7: Checkout

**Files:**

- Create: `apps/api/src/services/presale/checkout.ts`
- Modify: `apps/api/src/routes/presale.ts`
- Test: `apps/api/test/presale/checkout.test.ts`

**Interfaces:**

- Consumes: Tasks 2-6. Elegibilidade pela **mesma** `PRESALE_PRODUCT_WHERE` da Task 3.
- Produces: `createPresaleOrder(input, deps): Promise<CreatePresaleOrderResult>`, onde o resultado é `{ ok: true; orderId; totalCents }` ou `{ ok: false; status; error; code; message; variantIds? }`; `POST /presale/casa-in-box/checkout`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('soma linhas repetidas do mesmo variantId numa só', async () => {
  // Review Focus 2
  const res = await post({
    items: [
      { variantId: v, quantity: 2 },
      { variantId: v, quantity: 3 },
    ],
    expectedTotalCents: 5 * 9900,
  });
  expect(res.statusCode).toBe(201);
  const items = await prisma.orderItem.findMany({ where: { orderId: body(res).orderId } });
  expect(items).toHaveLength(1);
  expect(items[0]!.quantity).toBe(5);
});

it('409 e nenhum pedido quando expectedTotalCents diverge', async () => {
  const res = await post({ expectedTotalCents: 1 });
  expect(res.statusCode).toBe(409);
  expect(body(res).code).toBe('PRESALE_TOTAL_CHANGED');
  expect(body(res).totalCents).toBe(19800);
  await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(0);
});

it('ignora preço mandado pelo cliente e cobra o do banco', async () => {
  /* amountCents === 19800 */
});

it('grava devFeePercent 0 e devFeeAmountCents 0', async () => {
  /* a coluna tem default 10 */
});

it('não reserva estoque: quantitySold fica igual', async () => {
  /* antes === depois */
});

it('deixa expiresAt nulo', async () => {
  /* senão o worker mata o pedido durante o 3DS */
});

it.each([
  ['flag desmarcado', 'PRESALE_ITEM_UNAVAILABLE'],
  ['produto draft', 'PRESALE_ITEM_UNAVAILABLE'],
  ['variante inativa', 'PRESALE_ITEM_UNAVAILABLE'],
])('recusa %s nomeando o variantId', async (_l, code) => {
  /* body.variantIds contém o id */
});

it('422 com mensagem própria quando o total é zero', async () => {
  expect(body(res).code).toBe('PRESALE_TOTAL_TOO_LOW');
});

it('recusa entrega com CEP fora da faixa', async () => {
  /* code: PRESALE_CEP_OUT_OF_AREA */
});

it('recusa entrega quando o produto não tem allowShip', async () => {
  /* ... */
});

it('grava PresaleGuest e aponta o pedido para o usuário-sistema', async () => {
  expect(order.userId).toBe(systemUserId);
  expect(guest.email).toBe('comprador@exemplo.com');
});

it('nenhuma linha de User é criada ou alterada pelo email do convidado', async () => {
  const before = await prisma.user.count();
  await post({ guest: { name: 'X', email: 'membro@existente.com' } });
  await expect(prisma.user.count()).resolves.toBe(before);
  const membro = await prisma.user.findUnique({ where: { email: 'membro@existente.com' } });
  expect(membro!.name).toBe('Nome Original');
});

it('clique duplo com o mesmo clientRequestId devolve o mesmo pedido e a mesma URL', async () => {
  const [a, b] = await Promise.all([post(payload), post(payload)]);
  expect(body(a).orderId).toBe(body(b).orderId);
  await expect(prisma.order.count({ where: { origin: 'casa_in_box' } })).resolves.toBe(1);
});

it('409 quando o clientRequestId reincide sobre pedido não-pendente', async () => {
  /* pedido vira failed, repost → 409 code PRESALE_REQUEST_STALE, não a URL morta */
});

it('expires_at da sessão é no mínimo 30 min à frente da criação', async () => {
  expect(
    fakeStripe.lastSessionInput.expiresAt! - Math.floor(Date.now() / 1000),
  ).toBeGreaterThanOrEqual(30 * 60 - 5);
});

it('falha da Stripe deixa o pedido failed e não cobra', async () => {
  /* fakeStripe.failNext() */
});

it('grava consentimento com canal web_public e evidence preenchido', async () => {
  expect(consent.channel).toBe('web_public');
  expect(consent.evidence).not.toBeNull(); // evidence é obrigatório sem default
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- presale/checkout`
Expected: FAIL.

- [ ] **Step 3: Implementar `createPresaleOrder` e a rota**

Ordem obrigatória, e a fronteira da transação é load-bearing:

Dentro de **uma** transação: normalizar itens somando quantidades por `variantId`; carregar variantes com produto aplicando `PRESALE_PRODUCT_WHERE`; validar recebimento contra `allowPickup`/`allowShip` e contra a campanha; `computePresaleTotals`; comparar com `expectedTotalCents` e abortar com 409 se divergir; recusar total zero ou abaixo do mínimo BRL com código próprio; criar `Order` (`kind: 'product'`, `origin: 'casa_in_box'`, `method: 'card'`, `provider: 'stripe'`, `status: 'pending'`, `userId` do usuário-sistema, `devFeePercent: 0`, `devFeeAmountCents: 0`, `expiresAt: null`), os `OrderItem`, a `PresaleGuest` e o `Consent`.

**Fora** da transação, depois do commit: `app.stripe.createCheckoutSession` com `idempotencyKey: presale_checkout_<orderId>`, `metadata: { orderId }`, e `expiresAt` recalculado na hora. Gravar `checkoutUrl`. Erro da Stripe marca o pedido `failed` e devolve 502 — não há reserva a devolver. Chamar a Stripe dentro da transação criaria sessão pagável para um `orderId` que o rollback apagou, e `routes/stripe-webhook.ts:891-928` não trata `OrderNotFoundError`, virando 500 eterno com dinheiro capturado.

P2002 em `(origin, clientRequestId)`: buscar o pedido existente; `status === 'pending'` devolve o `checkoutUrl` dele; qualquer outro status devolve 409 `PRESALE_REQUEST_STALE`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- presale/checkout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/presale/checkout.ts apps/api/src/routes/presale.ts apps/api/test/presale/checkout.test.ts
git commit -m "feat(presale): checkout com recalculo no servidor e sessao Stripe"
```

---

## Task 8: Liquidação, webhook e débito de estoque

**Files:**

- Modify: `apps/api/src/services/orders/settle.ts:73-102`
- Modify: `apps/api/src/routes/stripe-webhook.ts:912-928`, `:973-999`
- Test: `apps/api/test/presale/webhook.test.ts`

**Interfaces:**

- Consumes: Task 7.
- Produces: pedido de pré-venda chega a `paid` com `Variant.quantitySold` incrementado. Nenhuma mudança de comportamento para `kind` `ticket`, `extras_only`, `mixed` ou `box`, nem para pedido de produto com `cartId`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('debita quantitySold só na liquidação', async () => {
  expect(variantAfterCheckout.quantitySold).toBe(0);
  await settle();
  expect(variantAfterPaid.quantitySold).toBe(2);
});

it('permite passar do total, sem travar a liquidação', async () => {
  /* quantityTotal 1, pedido de 3 → paid, quantitySold 3 */
});

it('cartão recusado seguido de pagamento na mesma sessão liquida, não 500', async () => {
  await webhook(paymentIntentFailed({ orderId }));
  expect((await prisma.order.findUnique({ where: { id: orderId } }))!.status).toBe('pending');
  const res = await webhook(checkoutSessionCompleted({ orderId }));
  expect(res.statusCode).toBe(200);
  expect((await prisma.order.findUnique({ where: { id: orderId } }))!.status).toBe('paid');
});

it('pedido de pré-venda já failed ainda liquida quando a Stripe confirma', async () => {
  await prisma.order.update({ where: { id: orderId }, data: { status: 'failed' } });
  expect((await webhook(checkoutSessionCompleted({ orderId }))).statusCode).toBe(200);
});

it('os dois eventos de um mesmo pagamento debitam o estoque uma vez só', async () => {
  await webhook(paymentIntentSucceeded({ orderId }));
  await webhook(checkoutSessionCompleted({ orderId }));
  expect(variant.quantitySold).toBe(2);
});

it('reentrega do mesmo event.id é no-op', async () => {
  /* mesmo id duas vezes */
});

it('session.expired marca failed e não debita', async () => {
  /* ... */
});

it('pedido de ingresso com PI recusado continua virando failed', async () => {
  /* regressao: o comportamento antigo nao muda fora de origin casa_in_box */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- presale/webhook`
Expected: FAIL.

- [ ] **Step 3: As três mudanças, todas condicionadas a `origin: 'casa_in_box'`**

1. Em `stripe-webhook.ts:973-999`, o ramo `payment_intent.payment_failed && orderId` deixa o pedido de pré-venda em `pending`. Em Checkout hospedado o PI recusado não é terminal: a sessão segue aberta e a pessoa tenta outro cartão. Hoje o flip para `failed` faz a tentativa bem-sucedida seguinte lançar `OrderNotPendingError` num catch que só trata `expired` e `paid`, caindo no `throw err` de `:928`, virando 500 que a Stripe retenta por três dias, com o dinheiro já capturado.
2. Em `stripe-webhook.ts:912-927`, acrescentar o tratamento de `failed` para pedido de pré-venda: se a Stripe diz que o pagamento entrou, a verdade é o dinheiro. Liquida e loga.
3. Em `settle.ts:83-99`, dentro da transação `Serializable` que já existe no ramo `kind === 'product'`, incrementar `Variant.quantitySold` pelas quantidades dos `OrderItem` quando `origin === 'casa_in_box'`. Sem guarda de teto; logar quando passar de `quantityTotal`. O early-return de `status === 'paid'` em `:75` é o que garante o débito único entre os dois eventos.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- presale/webhook stripe orders`
Expected: PASS, incluindo a suíte existente de webhook e pedidos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/orders/settle.ts apps/api/src/routes/stripe-webhook.ts apps/api/test/presale/webhook.test.ts
git commit -m "fix(presale): liquidacao debita estoque e cartao recusado nao mata o pedido"
```

---

## Task 9: Email de confirmação e status do pedido

**Files:**

- Create: `apps/api/src/services/presale/confirmation-email.ts`
- Modify: `apps/api/src/routes/stripe-webhook.ts`, `apps/api/src/routes/presale.ts`
- Test: `apps/api/test/presale/confirmation.test.ts`

**Interfaces:**

- Consumes: Tasks 5, 7, 8.
- Produces: `sendPresaleConfirmationEmail(orderId, deps): Promise<boolean>` (devolve `false` quando já tinha sido enviado); `POST /presale/casa-in-box/orders/status`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('envia uma vez só mesmo com os dois eventos do mesmo pagamento', async () => {
  await webhook(paymentIntentSucceeded({ orderId }));
  await webhook(checkoutSessionCompleted({ orderId }));
  expect(mailer.sent).toHaveLength(1);
});

it('o email não repete o endereço completo', async () => {
  expect(mailer.sent[0]!.html).not.toContain('Rua das Flores, 123');
  expect(mailer.sent[0]!.html).toContain('/casa-in-box/obrigado');
});

it('falha de envio não derruba nem reverte o pedido', async () => {
  mailer.failNext();
  expect((await webhook(checkoutSessionCompleted({ orderId }))).statusCode).toBe(200);
  expect(order.status).toBe('paid');
});

it('status exige token válido', async () => {
  expect((await postStatus({ orderId, token: 'lixo' })).statusCode).toBe(404);
});

it('status cobre os quatro estados', async () => {
  for (const s of ['pending', 'paid', 'refunded', 'failed']) {
    /* ... */
  }
});

it('o token não aparece em querystring', () => {
  /* a rota é POST e lê do corpo: logger.ts:5-12 só limpa webhookSecret */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- presale/confirmation`
Expected: FAIL.

- [ ] **Step 3: Implementar o envio com dedupe e a rota de status**

O dedupe é compare-and-set: `updateMany({ where: { id, confirmationEmailSentAt: null }, data: { confirmationEmailSentAt: new Date() } })`, e só envia se `count === 1`. Isso é necessário, e não defensivo, porque `markProcessed` roda **depois** do dispatch de propósito (`stripe-webhook.ts:17-22`) e porque `createCheckoutSession` põe metadata na sessão e no PI (`services/stripe/index.ts:461,474`), então `payment_intent.succeeded` e `checkout.session.completed` liquidam o mesmo pedido sob `event.id` diferentes, que a unique de `PaymentWebhookEvent` não dedupa entre si.

O corpo do email traz composição, totais, forma de recebimento e o link de status com o token do kind `'p'` — não o endereço completo, porque o email não é verificado e um erro de digitação mandaria PII postal a um terceiro.

`POST /orders/status` recebe `{ orderId, token }`, verifica com `verifyQrCode`, e devolve 404 indistinguível para token inválido e pedido inexistente.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- presale`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/presale/confirmation-email.ts apps/api/src/routes/stripe-webhook.ts apps/api/src/routes/presale.ts apps/api/test/presale/confirmation.test.ts
git commit -m "feat(presale): email de confirmacao com dedupe e rota de status"
```

---

## Task 10: Flag no CRUD de produto

**Files:**

- Modify: `packages/shared/src/admin.ts:1020,1030,1049-1066`
- Modify: `apps/api/src/routes/admin/store/products.ts:133-150`
- Modify: `apps/api/src/routes/admin/store/serializers.ts`
- Modify: `apps/admin/app/(authed)/loja/produtos/[id]/product-form.tsx`
- Test: `apps/api/test/admin/store-products-presale-flag.test.ts`

**Interfaces:**

- Consumes: Task 1.
- Produces: `visibleInPresale` presente e **editável** em `adminStoreProductCreateSchema` (default `false`), `adminStoreProductUpdateSchema` (opcional) e `adminStoreProductDetailSchema`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('nasce desmarcado e o PATCH marca', async () => {
  await patch(productId, { visibleInPresale: true });
  expect((await prisma.product.findUnique({ where: { id: productId } }))!.visibleInPresale).toBe(
    true,
  );
});

it('desmarcar tira o produto da pré-venda', async () => {
  await patch(productId, { visibleInPresale: false });
  await expect(loadEligiblePresaleProducts()).resolves.toHaveLength(0);
});

it('400 ao tentar marcar um produto singleton', async () => {
  const res = await patch(garageSpotProductId, { visibleInPresale: true });
  expect(res.statusCode).toBe(400);
});

it('exige papel de admin', async () => {
  /* sem token e com token de user */
});

it('não altera visibleInStore', async () => {
  /* continua read-only */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- store-products-presale-flag`
Expected: FAIL.

- [ ] **Step 3: Adicionar o campo nas três camadas**

`visibleInStore` **não** é o padrão a copiar: ele está fora dos schemas de create e update de propósito, é descartado pelo zod (`products.ts:146-149`), e a UI o mostra `readOnly` e só para produto virtual. A pré-venda precisa de flag editável, então acrescente `visibleInPresale` aos schemas, persista no handler, e some uma rejeição 400 explícita para slugs em `SINGLETON_PRODUCT_SLUGS`, no mesmo formato das rejeições de `status` e `productTypeId` em `products.ts:133-145`. Na UI, checkbox "Mostrar na pré-venda Casa In Box" para todo produto, desmarcada por padrão.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- admin/store && pnpm --filter @ccc/admin test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/admin.ts apps/api/src/routes/admin/store apps/admin/app apps/api/test/admin
git commit -m "feat(presale): flag editavel de elegibilidade no CRUD de produto"
```

---

## Task 11: Admin da campanha, busca e origem no pedido

**Files:**

- Create: `apps/api/src/routes/admin/presale-admin.ts`
- Create: `apps/admin/app/(authed)/loja/pre-venda/page.tsx`
- Create: `apps/admin/src/lib/presale-admin-actions.ts`
- Modify: `apps/api/src/routes/admin/index.ts:70`
- Modify: `apps/api/src/services/orders/admin-detail.ts`
- Modify: `apps/admin/app/(authed)/pedidos/[id]/page.tsx`
- Test: `apps/api/test/admin/presale-admin.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 6, 7.
- Produces: `GET`/`PATCH /admin/presale/settings`; `GET /admin/presale/orders?email=`; `admin-detail` passa a devolver `origin` e, quando houver, os campos de `PresaleGuest`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('PATCH grava os dados comerciais e o GET devolve', async () => {
  /* pickupAddress, cepRanges, frete, lote */
});

it('a busca acha pedido de convidado em qualquer status', async () => {
  /* pending, failed e paid: a fila da loja filtra status:'paid' em
     services/store/orders.ts:348-353, por isso a busca mora aqui */
  expect(ids).toEqual(expect.arrayContaining([pendingId, failedId, paidId]));
});

it('a busca não vaza pedido de outro email', async () => {
  /* ... */
});

it('o detalhe do pedido traz origem e dados do convidado', async () => {
  expect(detail.origin).toBe('casa_in_box');
  expect(detail.presaleGuest!.email).toBe('comprador@exemplo.com');
});

it('exige papel de admin nas três rotas', async () => {
  /* ... */
});

it('pedido normal continua sem presaleGuest e com origin app', async () => {
  /* regressao */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- admin/presale-admin`
Expected: FAIL.

- [ ] **Step 3: Implementar as rotas e a tela**

Rotas no padrão de `routes/admin/box-settings-admin.ts`, registradas no scope `requireRole('organizer', 'admin')` de `admin/index.ts:60-87`. A tela `/loja/pre-venda` é um formulário único mais a busca por email, com link para `/pedidos/[id]`, usando o padrão de server action de `src/lib/box-admin-actions.ts`. A busca existe aqui porque sem ela "paguei e não recebi" não tem onde começar: a fila da loja só mostra `paid`, e o email do convidado não está em nenhuma linha de `User`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- admin && pnpm --filter @ccc/admin test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin apps/api/src/services/orders/admin-detail.ts apps/admin apps/api/test/admin/presale-admin.test.ts
git commit -m "feat(presale): admin da campanha, busca por email e origem no pedido"
```

---

## Task 12: Reestruturar o layout do garage

**Files:**

- Modify: `apps/garage/app/layout.tsx:30-43`
- Modify: `apps/garage/app/not-found.tsx`
- Create: `apps/garage/app/(garage)/layout.tsx`
- Move: `apps/garage/app/g/` → `apps/garage/app/(garage)/g/`
- Modify: `apps/garage/src/components/__tests__/public-garage-view.test.tsx:7`
- Test: as suítes existentes do garage

**Interfaces:**

- Produces: root layout sem a coluna; `(garage)/layout.tsx` com a coluna `max-w-[430px]`; `app/not-found.tsx` embrulhando o próprio conteúdo na mesma coluna.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `apps/garage/app/__tests__/not-found.test.tsx`:

```ts
it('o 404 global continua dentro da coluna de 430px', () => {
  expect(renderToStaticMarkup(<NotFound />)).toContain('max-w-[430px]');
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/garage test`
Expected: FAIL, a coluna ainda está no root layout.

- [ ] **Step 3: Mover a coluna**

Quatro passos, nesta ordem. Tirar a `div` da coluna de `app/layout.tsx:41`. Criar `app/(garage)/layout.tsx` com ela. Mover `app/g/` para `app/(garage)/g/`. Em `app/not-found.tsx`, embrulhar o conteúdo na mesma coluna.

`app/not-found.tsx` **fica no root** e precisa da coluna própria: ele é o 404 global de URLs não casadas e renderiza dentro do root layout, não dentro de layouts de route group. Um `not-found` dentro do grupo deixaria `garage.casacar.club/qualquer-coisa` cair no 404 cru do Next, e deixá-lo no root sem embrulho estica o `NotFoundShell` (`max-w-xs` centralizado) no desktop. Corrigir também o import de `public-garage-view.test.tsx:7`, que aponta para `'../../../app/g/[slug]/not-found'`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/garage test && pnpm --filter @ccc/garage typecheck && pnpm --filter @ccc/garage build`
Expected: PASS, as quatro suítes existentes inclusive.

- [ ] **Step 5: Commit**

```bash
git add apps/garage/app apps/garage/src
git commit -m "refactor(garage): coluna de 430px sai do root layout para o route group"
```

---

## Task 13: Cliente e estado da caixa no garage

**Files:**

- Create: `apps/garage/src/lib/presale-api.ts`
- Create: `apps/garage/src/lib/presale-box.ts`
- Create: `apps/garage/src/copy/presale.ts`
- Test: `apps/garage/src/lib/__tests__/presale-box.test.ts`

**Interfaces:**

- Consumes: Tasks 2, 6, 7, 9.
- Produces: `fetchPresaleCampaign()`, `fetchPresaleProducts()`, `startPresaleCheckout(payload)`, `fetchPresaleOrderStatus(orderId, token)`; `readBox(storage, now)`, `writeBox(storage, box, now)`, `clearBox(storage)`, `boxStorageKey(campaignId)`, `reconcileBox(box, products)`, `boxSubtotalCents(box, products)`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('a chave carrega a campanha, então campanha nova não ressuscita caixa velha', () => {
  expect(boxStorageKey('c1')).not.toBe(boxStorageKey('c2'));
});

it('descarta caixa com mais de 14 dias, sem avisos', () => {
  expect(readBox(storageWith(box, daysAgo(15)), now)).toEqual([]);
});

it('não quebra quando setItem lança', () => {
  expect(() => writeBox(throwingStorage, box, now)).not.toThrow();
});

it('reconcileBox nomeia o item que saiu da elegibilidade', () => {
  const r = reconcileBox([{ variantId: 'sumiu', quantity: 1 }], products);
  expect(r.removed).toEqual([{ variantId: 'sumiu', title: 'Boné CASA' }]);
  expect(r.box).toEqual([]);
});

it('boxSubtotalCents soma preço vezes quantidade, sem taxa', () => {
  expect(boxSubtotalCents([{ variantId: 'v', quantity: 3 }], products)).toBe(29700);
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/garage test -- presale-box`
Expected: FAIL.

- [ ] **Step 3: Implementar os três módulos**

Módulos puros: `Storage` e `now` entram por parâmetro, nada de acesso global a `window` nem a `Date.now()`, para rodarem no `environment: 'node'` do `apps/garage/vitest.config.ts:20` sem jsdom. `writeBox` engole exceção de quota (Safari privado faz `setItem` lançar) e quem chama degrada para memória. `presale-api.ts` segue o padrão de `src/lib/public-garage.ts`, validando toda resposta com os schemas da Task 2 e usando `NEXT_PUBLIC_API_BASE_URL`. O `clientRequestId` é gerado por tentativa de envio e **nunca** passa por `writeBox`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/garage test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/garage/src/lib apps/garage/src/copy
git commit -m "feat(presale): cliente da API e estado da caixa no garage"
```

---

## Task 14: Landing de pré-venda

**Files:**

- Create: `apps/garage/app/casa-in-box/page.tsx`
- Create: `apps/garage/src/components/presale/{Hero,HowItWorks,ProductShowcase,Faq,CtaButton}.tsx`
- Create: `apps/garage/public/casa-in-box-hero.webp`
- Test: `apps/garage/app/casa-in-box/__tests__/page.test.tsx`

**Interfaces:**

- Consumes: Tasks 6, 13.
- Produces: rota `/casa-in-box`, SSR.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('mostra título, texto e os dois CTAs', () => {
  const html = renderToStaticMarkup(<Landing campaign={c} products={p} />);
  expect(html).toContain('A cultura da CASA, em uma caixa que você monta.');
  expect(html.match(/Montar minha caixa/g)).toHaveLength(2);
});

it('identifica a composição da foto como ilustrativa', () => { /* legenda presente */ });

it('explica a compra em três passos', () => { /* os três rótulos */ });

it('omite a pergunta do FAQ cujo dado comercial está vazio', () => {
  expect(renderToStaticMarkup(<Faq campaign={{ ...c, pickupAddress: null }} />)).not.toContain('retirada');
});

it('não quebra com catálogo vazio', () => { /* products: [] renderiza sem throw e mantém o CTA */ });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/garage test -- casa-in-box`
Expected: FAIL.

- [ ] **Step 3: Converter a foto do hero**

Converter `/Users/pedro/Downloads/814F188B-9F21-4982-8F6D-CF7D3F6BB769.PNG` (a
composição enviada: boné, camiseta, carteira, chaveiro e dois aromatizantes numa
caixa) para `apps/garage/public/casa-in-box-hero.webp`, redimensionada para no
máximo 1600px de largura. Confirmar com o dono do produto que é a foto final
antes de commitar o binário.

- [ ] **Step 4: Implementar a landing**

Server component buscando campanha e produtos no servidor. Campanha desligada chama `notFound()`. Cores vêm das variáveis do `apps/garage/app/globals.css` (`--color-bg: #0b0b0f`, `--color-accent: #d4af37`, body `#050506`), **não** dos números de `packages/design/src/tokens.ts` — são ramps diferentes e misturar deixa dois dourados discordantes na mesma origem. Variável nova que faltar entra no `globals.css`. Copy vem inteira de `src/copy/presale.ts`. A foto fica em `apps/garage/public/`, porque nenhum app Next consome `packages/design/assets` e o campo `files` daquele pacote lista `assets/*.webp`, que não casa com subpasta.

- [ ] **Step 5: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/garage test && pnpm --filter @ccc/garage build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/garage/app/casa-in-box apps/garage/src/components/presale apps/garage/public
git commit -m "feat(presale): landing da Casa In Box"
```

---

## Task 15: Página de montagem

**Files:**

- Create: `apps/garage/app/casa-in-box/montar/page.tsx`
- Create: `apps/garage/src/components/presale/{BoxBuilder,ProductCard,VariantPicker,BoxSummary,FulfillmentPicker,CepField}.tsx`
- Test: `apps/garage/app/casa-in-box/montar/__tests__/page.test.tsx`

**Interfaces:**

- Consumes: Tasks 6, 7, 13.
- Produces: rota `/casa-in-box/montar`.

- [ ] **Step 1: Escrever o teste que falha**

Componentes se testam com `renderToStaticMarkup` sobre estado pré-montado; a lógica já tem teste na Task 13.

```ts
it('o resumo mostra itens, variantes, quantidades, subtotal, frete e total', () => {
  /* ... */
});

it('retirada mostra frete zero', () => {
  /* Review Focus 3, no nível da tela */
});

it('CEP fora da área bloqueia a entrega e oferece a retirada', () => {
  /* ... */
});

it('"Ir para pagamento" fica desabilitado com caixa vazia', () => {
  /* ... */
});

it('"Ir para pagamento" fica desabilitado sem recebimento completo', () => {
  /* ... */
});

it('caixa vazia, catálogo vazio e falha ao iniciar pagamento têm estado próprio', () => {
  /* três render */
});

it('item removido na revalidação aparece nomeado', () => {
  /* usa reconcileBox */
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/garage test -- montar`
Expected: FAIL.

- [ ] **Step 3: Implementar a montagem**

Client component sobre os módulos da Task 13. Resumo fixo e acessível no celular: a barra respeita `safe-area-inset-bottom` e o layout declara `viewport-fit=cover`, porque o garage hoje não declara `viewport` nem usa `env(safe-area-inset-*)` e uma barra em `bottom: 0` cai sob o home indicator do iPhone. Escuta o evento `storage` para não divergir entre abas. Manda `expectedTotalCents` no checkout; 409 `PRESALE_TOTAL_CHANGED` mostra o total novo e pede revisão sem redirecionar. Todo 409/422 com `variantIds` marca os itens na tela e dispara nova revalidação — sem isso, produto despublicado no meio da sessão vira erro genérico e segundo clique com o mesmo erro, sem saída. Botão desabilitado enquanto o POST está em voo.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/garage test && pnpm --filter @ccc/garage build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/garage/app/casa-in-box/montar apps/garage/src/components/presale
git commit -m "feat(presale): pagina de montagem da caixa"
```

---

## Task 16: Página de retorno

**Files:**

- Create: `apps/garage/app/casa-in-box/obrigado/page.tsx`
- Create: `apps/garage/src/components/presale/OrderStatusView.tsx`
- Test: `apps/garage/app/casa-in-box/obrigado/__tests__/page.test.tsx`

**Interfaces:**

- Consumes: Tasks 9, 13.
- Produces: rota `/casa-in-box/obrigado`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it.each(['pending', 'paid', 'refunded', 'failed'])('cobre o estado %s', (status) => {
  expect(renderToStaticMarkup(<OrderStatusView status={status} order={o} />)).not.toContain('undefined');
});

it('pending avisa que a confirmação pode levar instantes', () => { /* ... */ });

it('paid mostra composição e dados de recebimento', () => { /* ... */ });

it('refunded explica o estorno', () => { /* o link favoritado encontra isso dias depois */ });
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/garage test -- obrigado`
Expected: FAIL.

- [ ] **Step 3: Implementar a página**

Lê `orderId` e token da querystring do `success_url`, faz polling por `POST /orders/status` com intervalo e teto definidos aqui, e limpa a caixa do `localStorage` só no estado `paid`.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/garage test && pnpm --filter @ccc/garage build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/garage/app/casa-in-box/obrigado apps/garage/src/components/presale
git commit -m "feat(presale): pagina de retorno com os quatro estados do pedido"
```

---

## Task 17: LGPD e retenção

**Files:**

- Modify: `docs/ropa.md`
- Modify: `packages/shared/src/legal.ts`
- Modify: `apps/api/src/workers/retention.ts`
- Create: `apps/garage/app/(legal)/{privacidade,termos}/page.tsx`
- Test: `apps/api/test/presale/retention.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 7.
- Produces: `purgeAbandonedPresaleGuests(now, retentionDays)`; páginas de privacidade e termos servidas por `garage.casacar.club`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('purga convidado e pedido não pago depois do prazo', async () => {
  await purgeAbandonedPresaleGuests(now, 90);
  await expect(
    prisma.presaleGuest.findUnique({ where: { orderId: abandonedId } }),
  ).resolves.toBeNull();
});

it('nunca toca pedido pago, por mais antigo que seja', async () => {
  await purgeAbandonedPresaleGuests(now, 90);
  await expect(
    prisma.presaleGuest.findUnique({ where: { orderId: paidOldId } }),
  ).resolves.not.toBeNull();
});

it('nunca toca pedido que não é de pré-venda', async () => {
  /* origin app */
});
```

Use datas relativas a um `now` injetado, nunca literal fixo.

- [ ] **Step 2: Rodar e verificar que falha**

Run: `pnpm --filter @ccc/api test -- presale/retention`
Expected: FAIL.

- [ ] **Step 3: Implementar a purga e os artefatos**

A purga entra em `workers/retention.ts` no padrão das funções vizinhas. Os artefatos documentais são gate de release, não opcional: entrada nova no ROPA (`docs/ropa.md:3` obriga revisão em toda atividade nova de tratamento; `PAY-01`/`PAY-02` cobrem só ingresso), base legal e descrição de coleta para comprador sem conta em `legal.ts` §3 e §4 com bump de `PRIVACY_POLICY_VERSION`, e as páginas de privacidade e termos em `garage.casacar.club` — hoje o garage só serve `g/[slug]` e o 404, e um checkbox de consentimento apontando para documento que o titular não consegue ler na página que coleta não é consentimento informado.

- [ ] **Step 4: Rodar e verificar que passa**

Run: `pnpm --filter @ccc/api test -- presale && pnpm --filter @ccc/garage build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/ropa.md packages/shared/src/legal.ts apps/api/src/workers/retention.ts apps/garage/app apps/api/test/presale/retention.test.ts
git commit -m "feat(presale): retencao do convidado abandonado e artefatos de LGPD"
```

---

## Verificação final

- [ ] `pnpm lint && pnpm typecheck && pnpm test` na raiz, igual ao CI. Lint e format por pacote são mais fracos que o do CI, e CI vermelho vira deploy SKIPPED no Railway.
- [ ] Suítes existentes de loja, carrinho, webhook e garage passam sem alteração.
- [ ] Checklist de deploy da spec conferido, com atenção a `NEXT_PUBLIC_API_BASE_URL` no projeto Vercel do garage, que cai em `http://localhost:4000` em silêncio.
