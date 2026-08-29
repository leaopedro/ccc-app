# Pagamentos nativos na API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A API passa a emitir PaymentIntent nativa no avulso e assinatura
`default_incomplete` no premium, com as três corridas da Decisão 5 fechadas e a
guarda de duplicidade da Decisão 4 construída fora de `PremiumMembership`.

**Architecture:** `POST /api/cart/checkout` ganha um discriminador `flow`. O ramo
nativo cria a PaymentIntent com a mesma metadata que o webhook já lê, carimba
`providerRef` e devolve `clientSecret` com `checkoutUrl` nulo. As três corridas
são fechadas por cancelamento da PI na falha, por versão de carrinho na metadata
e por um worker de expiração real. A guarda de assinatura vira uma tabela nova de
tentativa pré-pagamento, com lock `FOR UPDATE` na `Garage`, chave determinística e
reaping por TTL. `PremiumMembership` não é tocada.

**Tech Stack:** Fastify 5, Zod, Prisma 6, Postgres via Testcontainers, `stripe`
22.1.0 com `apiVersion` `2026-04-22.dahlia`, node-cron, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-pagamentos-mobile-consolidado-design.md`
(Decisão 2, Decisão 4, Decisão 5 e "Escopo que faltava")

## Global Constraints

- Este plano assume que o **Plano 1 já entrou**. `request.clientPlatform` e
  `request.subscriptionsEnabled` existem em toda request, e `packages/shared` já
  carrega `subscriptionsEnabled` nos schemas de catálogo.
- Nenhum pedido e nenhuma membership muda de estado por chamada de cliente.
  Estado de pagamento só nasce de webhook verificado. Isto é invariante do repo.
- `premiumMembership.create` roda em um lugar só,
  `apps/api/src/services/billing/apply-membership-event.ts:97` (âncora de
  2026-08-29), dentro de `handleActivated`, disparado por `invoice.paid`.
  **Proibido** adicionar valor `incomplete` ao enum `PremiumMembershipStatus`
  (`packages/db/prisma/schema.prisma:269-276`, âncora de 2026-08-29) e
  **proibido** colocar índice único parcial em `PremiumMembership`.
- Teste de integração da API bate em Postgres real via Testcontainers. Nunca
  mock. Rodar exige Docker.
- Comando de teste da API é sempre `cd apps/api && pnpm exec vitest run test/<caminho>`.
  Nunca `pnpm --filter @ccc/api test -- <arquivo>`: o `--` não filtra e roda os
  ~2268 testes.
- `stripe` está fixado em 22.1.0 e o cliente usa `apiVersion: '2026-04-22.dahlia'`
  (`apps/api/src/services/stripe/index.ts:282`, âncora de 2026-08-29). Nesta
  versão `Invoice` tem `confirmation_secret` no topo
  (`node_modules/stripe/cjs/resources/Invoices.d.ts:207`) e **não** tem
  `payment_intent` no topo. O único `payment_intent` do arquivo, na linha 592,
  está dentro de `Invoice.LastFinalizationError`. Escrever
  `invoice.payment_intent` não compila.
- `receipt_email` é derivado do `sub` autenticado, no servidor. Nunca do corpo da
  requisição. Aceitar do corpo entrega uma primitiva de e-mail para destinatário
  arbitrário no domínio Stripe.
- `apps/api/src/app.ts:95` (âncora de 2026-08-29) constrói o Fastify **sem**
  `trustProxy`. Atrás do Railway, `req.ip` é o proxy de borda para todo mundo.
  Todo limite por IP é um balde global. Os limites deste plano são por usuário
  autenticado, o que contorna o problema, e isso está dito em cada task.
- Copy PT-BR. Commits pequenos, um por task no mínimo.
- Branch a partir de `main` atualizada. Nunca commitar em `production`.

---

### Task 1: `LIVE_STATUSES` unificada em `packages/shared`

Hoje a constante está duplicada em três lugares e omite `trialing` e `paused`:
`apps/api/src/routes/me-premium.ts:47`,
`apps/api/src/routes/me-premium-addons.ts:36` e, inline,
`apps/api/src/services/billing/apply-membership-event.ts:461` (âncoras de
2026-08-29). Um membro em trial ou pausado abre segunda assinatura sem nada
objetar.

Atenção ao efeito em `apply-membership-event.ts:461`. Aquele set decide se o
snapshot premium da `Garage` pode ser limpo. Incluir `trialing` e `paused` faz um
membro pausado segurar o snapshot. Isso é intencional e é o motivo do teste 3
abaixo.

**Files:**

- Modify: `packages/shared/src/premium.ts`
- Modify: `apps/api/src/routes/me-premium.ts:47-48`
- Modify: `apps/api/src/routes/me-premium-addons.ts:30-36`
- Modify: `apps/api/src/services/billing/apply-membership-event.ts:461`
- Test: `packages/shared/src/__tests__/premium-live-statuses.test.ts`
- Test: `apps/api/test/billing/live-statuses-unificada.test.ts`

**Interfaces:**

- Produces:
  - `LIVE_MEMBERSHIP_STATUSES: readonly ['trialing','active','past_due','cancel_scheduled','paused']`
  - `type LiveMembershipStatus = (typeof LIVE_MEMBERSHIP_STATUSES)[number]`
  - `isLiveMembershipStatus(status: string): status is LiveMembershipStatus`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/__tests__/premium-live-statuses.test.ts
import { describe, expect, it } from 'vitest';

import { LIVE_MEMBERSHIP_STATUSES, isLiveMembershipStatus } from '../premium.js';

describe('LIVE_MEMBERSHIP_STATUSES', () => {
  it('inclui trialing e paused, que as tres copias antigas omitiam', () => {
    expect([...LIVE_MEMBERSHIP_STATUSES]).toEqual([
      'trialing',
      'active',
      'past_due',
      'cancel_scheduled',
      'paused',
    ]);
  });

  // expired e o unico estado que libera nova assinatura. Se ele entrar aqui,
  // ninguem consegue mais recontratar depois de o periodo acabar.
  it('nao inclui expired', () => {
    expect(isLiveMembershipStatus('expired')).toBe(false);
  });

  it('reconhece os cinco estados vivos', () => {
    for (const s of LIVE_MEMBERSHIP_STATUSES) {
      expect(isLiveMembershipStatus(s)).toBe(true);
    }
  });
});
```

```typescript
// apps/api/test/billing/live-statuses-unificada.test.ts
import { prisma } from '@ccc/db';
import { LIVE_MEMBERSHIP_STATUSES } from '@ccc/shared/premium';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedMembership = async (garageId: string, status: 'trialing' | 'paused') => {
  await prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: `cus_${status}`,
      providerSubRef: `sub_${status}`,
      tier: 'gold',
      cadence: 'monthly',
      status,
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      baseAmountCents: 24_990,
      devFeePercent: 10,
      devFeeAmountCents: 2499,
      grossAmountCents: 27_489,
      currency: 'BRL',
    },
  });
};

describe('LIVE_STATUSES unificada', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('exporta os cinco estados vivos', () => {
    expect(LIVE_MEMBERSHIP_STATUSES).toHaveLength(5);
  });

  it('trata trialing como assinatura viva na precheck', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'trialing');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'web' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('trata paused como assinatura viva na precheck', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, 'paused');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'web' },
    });

    expect(res.statusCode).toBe(409);
  });
});
```

Nota para quem executa: a precheck exige `GROWTH_PREMIUM_BILLING_ENABLED`
ligada e passa por `enforceProfileGate`. Ler
`apps/api/test/billing/me-premium.test.ts` antes de rodar e copiar dali o setup
de env e de perfil que aquele arquivo já usa. Não inventar helper.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/premium-live-statuses.test.ts`
Expected: FAIL, `LIVE_MEMBERSHIP_STATUSES` não é exportada.

Run: `cd apps/api && pnpm exec vitest run test/billing/live-statuses-unificada.test.ts`
Expected: FAIL, os dois casos de precheck devolvem 200 em vez de 409.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/premium.ts`, no fim do arquivo:

```typescript
/**
 * Estados de membership que bloqueiam uma nova assinatura.
 *
 * Fonte unica. Antes disto a lista estava copiada em tres lugares
 * (me-premium.ts, me-premium-addons.ts e apply-membership-event.ts) e as tres
 * copias omitiam `trialing` e `paused`: um membro em trial ou com a cobranca
 * pausada abria uma segunda assinatura sem nada objetar.
 *
 * `expired` fica de fora de proposito. E o unico estado que libera recontratacao.
 */
export const LIVE_MEMBERSHIP_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'cancel_scheduled',
  'paused',
] as const;

export type LiveMembershipStatus = (typeof LIVE_MEMBERSHIP_STATUSES)[number];

export const isLiveMembershipStatus = (status: string): status is LiveMembershipStatus =>
  (LIVE_MEMBERSHIP_STATUSES as readonly string[]).includes(status);
```

Nos três consumidores, apagar a constante local e importar. Em
`apps/api/src/routes/me-premium.ts` a linha 47 vira:

```typescript
import { LIVE_MEMBERSHIP_STATUSES } from '@ccc/shared/premium';

const LIVE_STATUSES = LIVE_MEMBERSHIP_STATUSES;
const ACTIVE_STATUSES = new Set<string>(LIVE_STATUSES);
```

Manter o alias local `LIVE_STATUSES` evita tocar nas ~6 ocorrências do arquivo.
Mesmo padrão em `me-premium-addons.ts:36`.

Em `apply-membership-event.ts:461`, trocar o array inline pelo spread:

```typescript
      status: { in: [...LIVE_MEMBERSHIP_STATUSES] },
```

Conferir com `grep -n "'active', 'past_due', 'cancel_scheduled'" apps/api/src`
que não sobrou nenhuma quarta cópia.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/premium-live-statuses.test.ts`
Expected: PASS, 3 testes.

Run: `cd apps/api && pnpm exec vitest run test/billing/`
Expected: PASS, incluindo `apply-membership-event.test.ts`. Se algum teste
existente quebrar por causa de `paused` segurando o snapshot da `Garage`,
atualizar a expectativa daquele teste, não a constante.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/premium.ts packages/shared/src/__tests__/premium-live-statuses.test.ts apps/api/src/routes/me-premium.ts apps/api/src/routes/me-premium-addons.ts apps/api/src/services/billing/apply-membership-event.ts apps/api/test/billing/live-statuses-unificada.test.ts
git commit -m "refactor(shared): LIVE_STATUSES unica, com trialing e paused"
```

---

### Task 2: Decisão 2 — anual mais add-on vira rejeição tipada

Hoje a combinação cai no `catch` genérico de
`apps/api/src/routes/me-premium.ts:425-433` (âncora de 2026-08-29) e sai como
503 `ServiceUnavailable`. Um 503 diz ao cliente "tente de novo", e tentar de novo
nunca funciona.

O modelo prova a incompatibilidade sem consultar a Stripe.
`PremiumAddonModule` (`packages/db/prisma/schema.prisma:555-578`, âncora de
2026-08-29) tem `monthlyDeltaCents` e `quotaPerCycle`, e uma única
`stripePriceId`. Add-on é mensal por construção. Stripe recusa sessão de
assinatura com intervalos misturados. Logo anual mais add-on é rejeitável antes
de qualquer round-trip.

**Files:**

- Modify: `packages/shared/src/premium.ts`
- Modify: `apps/api/src/routes/me-premium.ts` (dentro de `checkoutHandler`, logo
  depois de `const selectedAddonKeys = ...` na linha 217)
- Test: `packages/shared/src/__tests__/premium-checkout-error.test.ts`
- Test: `apps/api/test/billing/premium-checkout-anual-addon.test.ts`

**Interfaces:**

- Produces:
  - `PREMIUM_CHECKOUT_ERROR_CODES = ['ANNUAL_CADENCE_ADDON_UNSUPPORTED'] as const`
  - `premiumCheckoutRejectionSchema`: `{ error: 'PremiumCheckoutRejected'; code: PremiumCheckoutErrorCode; message: string; addonKeys: string[] }`
  - `type PremiumCheckoutRejection`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/__tests__/premium-checkout-error.test.ts
import { describe, expect, it } from 'vitest';

import { premiumCheckoutRejectionSchema } from '../premium.js';

describe('premiumCheckoutRejectionSchema', () => {
  it('aceita a rejeicao de anual mais add-on', () => {
    const parsed = premiumCheckoutRejectionSchema.parse({
      error: 'PremiumCheckoutRejected',
      code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED',
      message: 'Modulos adicionais sao mensais e nao podem ser contratados no plano anual.',
      addonKeys: ['detail'],
    });
    expect(parsed.code).toBe('ANNUAL_CADENCE_ADDON_UNSUPPORTED');
  });

  it('recusa um code que nao esta no catalogo de erros', () => {
    expect(() =>
      premiumCheckoutRejectionSchema.parse({
        error: 'PremiumCheckoutRejected',
        code: 'QUALQUER_COISA',
        message: 'x',
        addonKeys: [],
      }),
    ).toThrow();
  });
});
```

```typescript
// apps/api/test/billing/premium-checkout-anual-addon.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('POST /api/me/premium/checkout — anual mais add-on', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    ({ app } = await makeAppWithFakeStripe());
    await prisma.premiumAddonModule.create({
      data: {
        key: 'detail',
        name: 'Detailing',
        description: 'Lavagem mensal',
        monthlyDeltaCents: 9900,
        currency: 'BRL',
        quotaPerCycle: 1,
        quotaUnit: 'access',
        active: true,
        stripePriceId: 'price_addon_detail',
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('recusa com 422 tipado em vez de 503', async () => {
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'web' },
      payload: { cadence: 'annual', addonKeys: ['detail'] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: 'PremiumCheckoutRejected',
      code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED',
      addonKeys: ['detail'],
    });
  });

  it('nao recusa anual sem add-on', async () => {
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'web' },
      payload: { cadence: 'annual' },
    });

    expect(res.statusCode).not.toBe(422);
  });

  it('nao recusa mensal com add-on', async () => {
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'web' },
      payload: { cadence: 'monthly', addonKeys: ['detail'] },
    });

    expect(res.statusCode).not.toBe(422);
  });
});
```

Nota: `checkoutHandler` exige `GROWTH_PREMIUM_BILLING_ENABLED` e passa por
`enforceProfileGate`. Copiar o setup de env e de perfil de
`apps/api/test/billing/premium-checkout-addons.test.ts`, que já exercita esta
rota. Ler o arquivo antes de escrever o teste.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/premium-checkout-error.test.ts`
Expected: FAIL, `premiumCheckoutRejectionSchema` não existe.

Run: `cd apps/api && pnpm exec vitest run test/billing/premium-checkout-anual-addon.test.ts`
Expected: FAIL, recebe 503 ou 201 em vez de 422.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/premium.ts`:

```typescript
/**
 * Rejeicoes de checkout premium que o cliente consegue tratar. Sao erros de
 * combinacao, nao de disponibilidade: repetir a mesma requisicao nunca
 * funciona, entao 503 e a resposta errada.
 */
export const PREMIUM_CHECKOUT_ERROR_CODES = ['ANNUAL_CADENCE_ADDON_UNSUPPORTED'] as const;

export type PremiumCheckoutErrorCode = (typeof PREMIUM_CHECKOUT_ERROR_CODES)[number];

export const premiumCheckoutRejectionSchema = z.object({
  error: z.literal('PremiumCheckoutRejected'),
  code: z.enum(PREMIUM_CHECKOUT_ERROR_CODES),
  message: z.string().min(1),
  addonKeys: z.array(z.string()),
});

export type PremiumCheckoutRejection = z.infer<typeof premiumCheckoutRejectionSchema>;
```

Em `apps/api/src/routes/me-premium.ts`, logo depois de
`const selectedAddonKeys = [...new Set(addonKeys ?? [])].sort();` (linha 217):

```typescript
// Decisao 2. PremiumAddonModule so tem monthlyDeltaCents e uma unica
// stripePriceId: add-on e mensal por construcao. A Stripe recusa sessao de
// assinatura com intervalos misturados, e ate agora essa recusa vinha como
// 503 generico do catch la embaixo. 503 diz "tente de novo", e tentar de
// novo nunca funciona. Rejeitar aqui, tipado, antes de qualquer round-trip.
if (cadence === 'annual' && selectedAddonKeys.length > 0) {
  return reply.status(422).send(
    premiumCheckoutRejectionSchema.parse({
      error: 'PremiumCheckoutRejected',
      code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED',
      message: 'Modulos adicionais sao mensais e nao podem ser contratados no plano anual.',
      addonKeys: selectedAddonKeys,
    }),
  );
}
```

Acrescentar `premiumCheckoutRejectionSchema` ao import de `@ccc/shared/premium`
no topo do arquivo (linha 18-24).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/premium-checkout-error.test.ts`
Expected: PASS, 2 testes.

Run: `cd apps/api && pnpm exec vitest run test/billing/premium-checkout-anual-addon.test.ts test/billing/premium-checkout-addons.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/premium.ts packages/shared/src/__tests__/premium-checkout-error.test.ts apps/api/src/routes/me-premium.ts apps/api/test/billing/premium-checkout-anual-addon.test.ts
git commit -m "feat(api): anual mais add-on vira rejeicao tipada, nao 503"
```

---

### Task 3: `flow: native` no `POST /api/cart/checkout`

`apps/api/src/routes/cart.ts:722-750` (âncora de 2026-08-29) hoje sempre cria
Checkout Session hospedada e devolve `clientSecret: null`
(`cart.ts:769`). O ramo nativo cria a PaymentIntent direto, com **a mesma
metadata** que `handleCartPaymentSucceeded` já lê
(`apps/api/src/routes/stripe-webhook.ts:107` e `:399-401`, âncoras de
2026-08-29), carimba `providerRef` e devolve `clientSecret` com `checkoutUrl`
nulo.

Pix ignora `flow`: o ramo `input.paymentMethod === 'pix'` em `cart.ts:639`
retorna antes. Web não muda nada, porque o default é `hosted`.

`receipt_email` sai do `sub`, via `prisma.user.findUnique`. Nunca do corpo.

**Files:**

- Modify: `packages/shared/src/cart.ts:230-237`
- Modify: `apps/api/src/services/stripe/index.ts:8-13` e `:285-297`
- Modify: `apps/api/src/services/stripe/fake.ts:166-169`
- Modify: `apps/api/src/routes/cart.ts` (ramo Stripe, a partir da linha 708)
- Test: `apps/api/test/cart/checkout-native.test.ts`

**Interfaces:**

- Consumes: nada de tasks anteriores.
- Produces:
  - `beginCheckoutRequestSchema` ganha `flow: z.enum(['hosted','native']).default('hosted')`
  - `CreatePaymentIntentInput` ganha `receiptEmail?: string`
  - Resposta nativa: `provider: 'stripe'`, `providerRef: <pi_id>`,
    `clientSecret: <string>`, `checkoutUrl: null`, `brCode: null`
  - Metadata da PI nativa: `cartId`, `userId`, `orderIds`, `orderKinds`,
    `hasShippableItems`, `cartVersion`, e `shippingAddressId` quando houver

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/cart/checkout-native.test.ts
import { prisma } from '@ccc/db';
import { beginCheckoutResponseSchema } from '@ccc/shared/cart';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('POST /cart/checkout — flow native', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('devolve clientSecret e checkoutUrl nulo', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });

    expect(res.statusCode).toBe(201);
    const body = beginCheckoutResponseSchema.parse(res.json());
    expect(body.clientSecret).toBe('pi_test_1_secret_abc');
    expect(body.checkoutUrl).toBeNull();
    expect(body.provider).toBe('stripe');
    expect(body.providerRef).toBe('pi_test_1');
  });

  it('carimba providerRef no pedido canonico', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });

    const body = beginCheckoutResponseSchema.parse(res.json());
    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderIds[0]! } });
    expect(order.providerRef).toBe('pi_test_1');
  });

  // Sem esta metadata o webhook nao resolve o carrinho e a PI paga fica orfa.
  it('carrega a mesma metadata que o webhook de carrinho ja le', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    const body = beginCheckoutResponseSchema.parse(res.json());

    const call = stripe.calls.find((c) => c.kind === 'createPaymentIntent');
    expect(call).toBeDefined();
    const payload = call!.payload as {
      metadata: Record<string, string>;
      receiptEmail?: string;
    };
    expect(payload.metadata.cartId).toBe(body.checkoutId);
    expect(payload.metadata.userId).toBe(user.id);
    expect(JSON.parse(payload.metadata.orderIds)).toEqual(body.orderIds);
    expect(payload.metadata.cartVersion).toBeDefined();
  });

  // Aceitar receipt_email do corpo seria primitiva de e-mail para destinatario
  // arbitrario assinada pela nossa conta Stripe.
  it('deriva receipt_email do usuario autenticado e ignora o corpo', async () => {
    const { user } = await createUser({ verified: true, email: 'dono@casacar.test' });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: {
        paymentMethod: 'card',
        flow: 'native',
        receiptEmail: 'atacante@evil.test',
        receipt_email: 'atacante@evil.test',
      },
    });

    const call = stripe.calls.find((c) => c.kind === 'createPaymentIntent');
    const payload = call!.payload as { receiptEmail?: string };
    expect(payload.receiptEmail).toBe('dono@casacar.test');
  });

  it('o default continua hospedado: sem flow, devolve checkoutUrl', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card' },
    });

    const body = beginCheckoutResponseSchema.parse(res.json());
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_1');
    expect(body.clientSecret).toBeNull();
  });

  it('pix ignora flow e continua devolvendo brCode', async () => {
    // Ler apps/api/test/cart/checkout.test.ts e reusar o setup de Pix de la,
    // incluindo makeAppWithFakes em vez de makeAppWithFakeStripe.
  });
});
```

Nota importante: `seedPublishedEvent` e `addCartItem` **não** vêm de
`test/helpers.ts`. São helpers locais de `apps/api/test/cart/checkout.test.ts`
(âncora de 2026-08-29, ver as linhas 60-102 daquele arquivo). Ler o arquivo e
copiar os dois helpers para o topo do teste novo, ou extraí-los. Não inventar
assinatura.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/cart/checkout-native.test.ts`
Expected: FAIL, `clientSecret` vem null e `checkoutUrl` vem preenchido; o Zod
do request também recusa a chave `flow` desconhecida se o schema for strict.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/cart.ts:230`:

```typescript
export const beginCheckoutRequestSchema = z.object({
  paymentMethod: cartPaymentMethodSchema,
  /**
   * 'hosted' devolve checkoutUrl (Stripe Checkout, caminho da web).
   * 'native' devolve clientSecret para o PaymentSheet do app.
   *
   * Default 'hosted' de proposito: nenhum cliente existente muda de
   * comportamento no deploy. Pix ignora este campo.
   */
  flow: z.enum(['hosted', 'native']).default('hosted'),
  fulfillmentMethod: fulfillmentMethodSchema.optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  shippingAddressId: z.string().min(1).optional(),
  pickupEventId: z.string().min(1).optional(),
});
```

Em `apps/api/src/services/stripe/index.ts`, no `CreatePaymentIntentInput`:

```typescript
export type CreatePaymentIntentInput = {
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
  /**
   * Destinatario do recibo da Stripe. SEMPRE derivado do usuario autenticado
   * no servidor. Aceitar este valor do corpo da requisicao transformaria a
   * rota numa primitiva de e-mail para destinatario arbitrario, assinada pela
   * nossa conta Stripe.
   */
  receiptEmail?: string;
};
```

E na implementação real, `index.ts:285-297`:

```typescript
    createPaymentIntent: async ({
      amountCents,
      currency,
      metadata,
      idempotencyKey,
      receiptEmail,
    }) => {
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: currency.toLowerCase(),
          metadata,
          automatic_payment_methods: { enabled: true },
          ...(receiptEmail ? { receipt_email: receiptEmail } : {}),
        },
        { idempotencyKey },
      );
      if (!pi.client_secret) throw new Error('stripe paymentIntent missing client_secret');
      return { id: pi.id, clientSecret: pi.client_secret };
    },
```

O fake em `fake.ts:166-169` já grava o input inteiro em `fake.calls`, então não
precisa de mudança. Conferir isso ao ler o arquivo.

Em `apps/api/src/routes/cart.ts`, dentro do ramo Stripe. Extrair a metadata,
que hoje está duplicada, para uma const única acima do `if (input.flow === ...)`:

```typescript
// Mesma metadata nos dois ramos. handleCartPaymentSucceeded le cartId
// (stripe-webhook.ts:401) e settlePaidOrder le o resto. Divergir aqui deixa
// a PI nativa paga sem carrinho resolvivel.
//
// cartVersion e o discriminador de folha velha. handleCartFailure reabre o
// carrinho incrementando version (stripe-webhook.ts:362-366), entao uma PI
// minta antes da reabertura carrega uma versao que nao existe mais.
const stripeMetadata: Record<string, string> = {
  cartId: cart.id,
  userId: sub,
  orderIds: JSON.stringify(data.orders.map((o) => o.id)),
  orderKinds: JSON.stringify(data.orders.map((o) => o.kind)),
  hasShippableItems: requiresShipping ? 'true' : 'false',
  cartVersion: String(cart.version),
  ...(shippingAddressId ? { shippingAddressId } : {}),
};

if (input.flow === 'native') {
  const buyer = await prisma.user.findUnique({
    where: { id: sub },
    select: { email: true },
  });

  try {
    const intent = await app.stripe.createPaymentIntent({
      amountCents: data.totalAmountCents,
      currency: data.currency,
      metadata: stripeMetadata,
      idempotencyKey: `cart_native_${cart.id}_v${cart.version}`,
      // Derivado do sub. Nunca do corpo.
      ...(buyer?.email ? { receiptEmail: buyer.email } : {}),
    });

    await prisma.order.updateMany({
      where: { cartId: cart.id, status: 'pending' },
      data: { providerRef: null },
    });
    await prisma.order.update({
      where: { id: data.orders[0]!.id },
      data: { providerRef: intent.id },
    });

    const updatedCart = await prisma.cart.findUniqueOrThrow({
      where: { id: cart.id },
      include: CART_INCLUDE_FOR_SERIALIZE,
    });

    return reply.status(201).send(
      beginCheckoutResponseSchema.parse({
        checkoutId: cart.id,
        status: 'pending',
        cart: serializeCart(updatedCart, fulfillmentContext, {
          devFeePercent: app.env.DEV_FEE_PERCENT,
        }),
        orderIds: data.orders.map((o) => o.id),
        provider: 'stripe',
        providerRef: intent.id,
        clientSecret: intent.clientSecret,
        checkoutUrl: null,
        brCode: null,
        reservationExpiresAt: new Date(Date.now() + ORDER_EXPIRY_MS).toISOString(),
      }),
    );
  } catch (err) {
    await rollbackCartCheckout(cart.id, data.orders);
    throw err;
  }
}
```

No `createCheckoutSession` logo abaixo, trocar o literal de metadata por
`metadata: stripeMetadata`, para os dois ramos ficarem idênticos.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/cart/`
Expected: PASS, incluindo `checkout.test.ts` e `checkout-webhook.test.ts` que já
existiam.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/cart.ts apps/api/src/services/stripe/index.ts apps/api/src/routes/cart.ts apps/api/test/cart/checkout-native.test.ts
git commit -m "feat(api): flow native no checkout de carrinho, com receipt_email do servidor"
```

---

### Task 4: Recusar item `virtual: true` no iOS, no servidor

A questão aberta do spec é factual e não muda a correção. Aposentar a linha
"Vaga de Garagem Adicional" resolve a instância de hoje. O schema do carrinho
continua permitindo a próxima. A correção durável é recusar no servidor.

Task separada da 3 porque um reviewer pode aceitar o caminho nativo e discordar
do formato desta recusa.

**Files:**

- Modify: `apps/api/src/routes/cart.ts` (logo depois do bloco `storeDisabled` das
  linhas 499-508, âncora de 2026-08-29)
- Test: `apps/api/test/cart/checkout-ios-virtual.test.ts`

**Interfaces:**

- Consumes: `request.clientPlatform` (Plano 1).
- Produces: `403 { error: 'PlatformNotSupported', code: 'VIRTUAL_ITEM_IOS_BLOCKED', variantIds: string[] }`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/cart/checkout-ios-virtual.test.ts
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('POST /cart/checkout — item virtual no iOS', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    ({ app } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('recusa 403 quando o carrinho tem linha virtual e a plataforma e iOS', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await ensureGarageProduct();

    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { paymentMethod: 'card', flow: 'native' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: 'PlatformNotSupported',
      code: 'VIRTUAL_ITEM_IOS_BLOCKED',
    });
  });

  it('permite a mesma linha virtual na web', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await ensureGarageProduct();

    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'x-ccc-platform': 'web' },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('nao recusa carrinho so com item fisico no iOS', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { variant } = await seedPhysicalProduct();

    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: token, 'content-type': 'application/json' },
      payload: { item: { kind: 'product', variantId: variant.id, quantity: 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { paymentMethod: 'card', flow: 'native', fulfillmentMethod: 'ship' },
    });

    expect(res.statusCode).not.toBe(403);
  });
});
```

`ensureGarageProduct` e `seedPhysicalProduct` existem em
`apps/api/test/cart/virtual-guards.test.ts:11-80` (âncora de 2026-08-29). Ler o
arquivo e copiar os dois helpers. O terceiro teste também precisa de endereço de
entrega; ver como `virtual-guards.test.ts` monta isso antes de assumir 201.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/cart/checkout-ios-virtual.test.ts`
Expected: FAIL, o primeiro caso devolve 201 em vez de 403.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/cart.ts`, logo depois do bloco `storeDisabled` e **antes**
do `if (cart.status !== 'open')`, porque abaixo dessa linha o carrinho já muda
de estado:

```typescript
// Diretriz 3.1.3(e) da Apple isenta bens FISICOS consumidos fora do app.
// Um produto `virtual: true` e desbloqueio digital, e vender desbloqueio
// digital fora do IAP e rejeicao 3.1.1. Aposentar um SKU resolve a
// instancia de hoje; recusar aqui resolve a proxima.
//
// Recusa antes de reserveAndCreateOrders: abaixo desta linha o carrinho vai
// para `checking_out` e o estoque e reservado.
if (request.clientPlatform === 'ios') {
  const virtualVariantIds = cart.items
    .filter((item) => item.kind === 'product' && item.variant?.product.virtual === true)
    .map((item) => item.variant!.id);
  if (virtualVariantIds.length > 0) {
    return reply.status(403).send({
      error: 'PlatformNotSupported',
      code: 'VIRTUAL_ITEM_IOS_BLOCKED',
      message: 'Itens digitais nao podem ser comprados pelo aplicativo iOS.',
      variantIds: virtualVariantIds,
    });
  }
}
```

Conferir ao editar que `cart.items[].variant` traz `product.virtual` e
`variant.id` no include usado por `loadCartForCheckout`
(`apps/api/src/services/cart/checkout.ts:83`, `CART_CHECKOUT_INCLUDE`, âncora de
2026-08-29). O bloco de `storeDisabled` logo acima já lê
`item.variant.product.virtual`, então o campo está lá. Confirmar `variant.id`
antes de usá-lo; se não estiver no select, usar `item.id` no lugar.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/cart/`
Expected: PASS, incluindo `virtual-guards.test.ts` e `garage-checkout.test.ts`.
Os testes existentes de garagem não mandam `x-ccc-platform`, e o resolver do
Plano 1 falha fechado para `ios`. Se algum deles quebrar, acrescentar
`'x-ccc-platform': 'web'` naquele teste, que é a plataforma que ele sempre
representou.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/cart.ts apps/api/test/cart/checkout-ios-virtual.test.ts
git commit -m "feat(api): checkout recusa item virtual quando a plataforma e iOS"
```

---

### Task 5: Corrida (a) — `handleCartFailure` cancela a PaymentIntent

`apps/api/src/routes/stripe-webhook.ts:295-372` (âncora de 2026-08-29) marca os
pedidos `failed`, libera estoque e reabre o carrinho. Não cancela a PI. O
`PaymentSheet`, por design, continua montado para nova tentativa **na mesma PI**.
Recusa de 3DS seguida de sucesso na mesma folha cai no ramo `dead` de
`stripe-webhook.ts:161-183` e vira cobrança seguida de reembolso, com o estoque
já revendido. Recusa de 3DS é o modo de falha mais comum em cartão brasileiro.

Cancelar a PI é o que força a nova tentativa a passar por um checkout novo, que
reserva estoque de novo.

**Files:**

- Modify: `apps/api/src/routes/stripe-webhook.ts:295-372`
- Test: `apps/api/test/cart/checkout-failure-cancels-pi.test.ts`

**Interfaces:**

- Consumes: `app.stripe.cancelPaymentIntent` (já existe,
  `apps/api/src/services/stripe/index.ts:413`).
- Produces: `handleCartFailure` cancela toda PI referenciada pelos pedidos
  pendentes do carrinho, depois do commit, sem deixar o erro escapar.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/cart/checkout-failure-cancels-pi.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('handleCartFailure cancela a PaymentIntent', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('cancela a PI e reabre o carrinho no payment_intent.payment_failed', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const checkout = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    const body = checkout.json() as { checkoutId: string; providerRef: string };

    stripe.nextEvent = {
      id: 'evt_failed_1',
      type: 'payment_intent.payment_failed',
      data: { object: { id: body.providerRef, metadata: { cartId: body.checkoutId } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    expect(res.statusCode).toBe(200);

    const cancels = stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent');
    expect(cancels).toHaveLength(1);
    expect(cancels[0]!.payload).toMatchObject({ paymentIntentId: body.providerRef });

    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: body.checkoutId } });
    expect(cart.status).toBe('open');
  });

  // O cancel e best-effort. Uma PI que a Stripe ja fechou 400a no cancel, e
  // deixar esse erro escapar faria a Stripe reentregar o evento por ~3 dias
  // contra um carrinho que ja foi reaberto corretamente.
  it('nao falha o webhook quando o cancel da Stripe estoura', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const checkout = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    const body = checkout.json() as { checkoutId: string; providerRef: string };

    stripe.nextCancelPaymentIntentError = new Error('payment_intent_unexpected_state');
    stripe.nextEvent = {
      id: 'evt_failed_2',
      type: 'payment_intent.payment_failed',
      data: { object: { id: body.providerRef, metadata: { cartId: body.checkoutId } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    expect(res.statusCode).toBe(200);
    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: body.checkoutId } });
    expect(cart.status).toBe('open');
  });
});
```

`seedPublishedEvent` e `addCartItem` vêm de
`apps/api/test/cart/checkout.test.ts` (linhas 60-102, âncora de 2026-08-29).
Copiar. O formato exato do payload de webhook do fake está em
`apps/api/test/cart/checkout-webhook.test.ts`; ler antes de escrever, porque o
fake ignora o corpo e usa `stripe.nextEvent`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/cart/checkout-failure-cancels-pi.test.ts`
Expected: FAIL, `cancels` vem com length 0.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/stripe-webhook.ts`, dentro de `handleCartFailure`.
Coletar as refs no início da transação e cancelar depois do commit:

```typescript
const handleCartFailure = async (
  cartId: string,
  webhookEvent: { id: string; type: string; data: { object: Record<string, unknown> } },
  request: { log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void } },
  reply: { status: (n: number) => { send: (b: unknown) => unknown } },
) => {
  const refsToCancel: string[] = [];

  await prisma.$transaction(async (tx) => {
    const cartOrders = await tx.order.findMany({
      where: { cartId, status: 'pending' },
    });

    for (const order of cartOrders) {
      if (order.provider === 'stripe' && order.providerRef) {
        refsToCancel.push(order.providerRef);
      }
      // ... resto do corpo existente, sem mudanca ...
    }

    // ... reabertura do carrinho existente, sem mudanca ...
  });

  // Cancelar a PI DEPOIS do commit, e nunca deixar o erro escapar.
  //
  // Sem isto o PaymentSheet segue montado sobre a mesma PI e uma segunda
  // tentativa bem-sucedida cai no ramo `dead` de :161-183: cobranca seguida
  // de reembolso, com o estoque ja revendido para outra pessoa. Recusa de 3DS
  // e o modo de falha mais comum em cartao brasileiro.
  //
  // Best-effort de proposito: a Stripe 400a o cancel de uma PI que ela
  // propria ja fechou, e deixar esse 400 escapar faria o evento ser
  // reentregue por ~3 dias contra um carrinho ja reaberto corretamente.
  for (const ref of [...new Set(refsToCancel)]) {
    try {
      await app.stripe.cancelPaymentIntent(ref);
    } catch (cancelErr) {
      request.log.warn(
        { err: cancelErr, cartId, providerRef: ref },
        'stripe webhook: falha ao cancelar a PI do carrinho reaberto',
      );
    }
  }

  const firstTime = await markProcessed(webhookEvent.id, webhookEvent);
  request.log.info({ cartId, firstTime }, 'stripe webhook: cart checkout failed/expired');
  return reply.status(200).send({ ok: true, deduped: !firstTime });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/cart/ test/stripe-webhook-push.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/stripe-webhook.ts apps/api/test/cart/checkout-failure-cancels-pi.test.ts
git commit -m "fix(api): reabrir o carrinho cancela a PaymentIntent da tentativa morta"
```

---

### Task 6: Corrida (b) — folha velha com `clientSecret` velho

A Task 5 fecha o caso comum, porque a Stripe recusa confirmar uma PI cancelada.
Ela não fecha o caso em que a PI ainda está viva e uma folha antiga confirma
depois de o carrinho ter sido reaberto por outro caminho: `checkout.session.expired`
onde o cancel falhou, ou o worker de expiração da Task 7. Nesse caso existem duas
PIs com o mesmo `cartId`, a segunda sem `providerRef`, invisível para
`charge.refunded` e para `charge.dispute.created`.

A Task 3 já coloca `cartVersion` na metadata. `handleCartFailure` incrementa
`version` ao reabrir (`stripe-webhook.ts:362-366`, âncora de 2026-08-29), e
`reserveAndCreateOrders` não mexe em `version`. Logo `cartVersion` é um
discriminador confiável de folha velha.

**Files:**

- Modify: `apps/api/src/routes/stripe-webhook.ts:107-127` (topo de
  `handleCartPaymentSucceeded`)
- Test: `apps/api/test/cart/checkout-stale-sheet.test.ts`

**Interfaces:**

- Consumes: `cartVersion` na metadata (Task 3).
- Produces: `handleCartPaymentSucceeded` reembolsa e alerta quando o
  `cartVersion` da PI não bate com a versão atual do carrinho. Metadata sem
  `cartVersion` passa direto, para não quebrar sessões hospedadas mintadas
  antes deste deploy.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/cart/checkout-stale-sheet.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('folha velha confirmando depois da reabertura do carrinho', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('reembolsa a PI cuja cartVersion nao bate com a do carrinho', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const checkout = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    const body = checkout.json() as { checkoutId: string; providerRef: string };
    const before = await prisma.cart.findUniqueOrThrow({ where: { id: body.checkoutId } });

    // O carrinho reabre e a versao anda. A folha velha ainda segura a PI antiga.
    await prisma.cart.update({
      where: { id: body.checkoutId },
      data: { status: 'open', version: { increment: 1 } },
    });

    stripe.nextEvent = {
      id: 'evt_stale_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: body.providerRef,
          metadata: { cartId: body.checkoutId, cartVersion: String(before.version) },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ refunded: true, reason: 'stale-cart-version' });

    const refunds = stripe.calls.filter((c) => c.kind === 'refund');
    expect(refunds).toHaveLength(1);

    // Nenhum pedido pode ter virado pago com estoque ja revendido.
    const paid = await prisma.order.count({ where: { cartId: body.checkoutId, status: 'paid' } });
    expect(paid).toBe(0);
  });

  it('liquida normalmente quando a cartVersion bate', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const checkout = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    const body = checkout.json() as { checkoutId: string; providerRef: string };
    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: body.checkoutId } });

    stripe.nextEvent = {
      id: 'evt_fresh_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: body.providerRef,
          metadata: { cartId: body.checkoutId, cartVersion: String(cart.version) },
        },
      },
    };

    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    const paid = await prisma.order.count({ where: { cartId: body.checkoutId, status: 'paid' } });
    expect(paid).toBeGreaterThan(0);
  });

  // Sessoes hospedadas mintadas antes deste deploy nao tem cartVersion.
  // Recusar por ausencia reembolsaria compras legitimas em voo.
  it('liquida normalmente quando a metadata nao tem cartVersion', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);
    const { event, tier } = await seedPublishedEvent();
    await addCartItem(app, token, { eventId: event.id, tierId: tier.id });

    const checkout = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: token },
      payload: { paymentMethod: 'card', flow: 'native' },
    });
    const body = checkout.json() as { checkoutId: string; providerRef: string };

    stripe.nextEvent = {
      id: 'evt_legacy_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: body.providerRef, metadata: { cartId: body.checkoutId } } },
    };

    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    const paid = await prisma.order.count({ where: { cartId: body.checkoutId, status: 'paid' } });
    expect(paid).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/cart/checkout-stale-sheet.test.ts`
Expected: FAIL no primeiro caso, que liquida em vez de reembolsar.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/stripe-webhook.ts`, no topo de
`handleCartPaymentSucceeded`, antes do `prisma.order.findMany`:

```typescript
// Guarda de folha velha.
//
// O PaymentSheet segura um clientSecret. handleCartFailure reabre o
// carrinho incrementando `version` (:362-366), e um novo checkout minta uma
// PI nova. As duas PIs carregam o mesmo cartId. Sem esta guarda a segunda
// cobranca liquida contra pedidos que a primeira ja consumiu, ou nasce sem
// providerRef, ficando invisivel para charge.refunded e
// charge.dispute.created.
//
// Metadata sem cartVersion passa direto: sessoes hospedadas mintadas antes
// deste deploy nao carregam o campo, e recusar por ausencia reembolsaria
// compras legitimas em voo.
const paidVersionRaw = (webhookEvent.data.object as { metadata?: Record<string, string> }).metadata
  ?.cartVersion;
if (paidVersionRaw !== undefined) {
  const paidVersion = Number(paidVersionRaw);
  const cartRow = await prisma.cart.findUnique({
    where: { id: cartId },
    select: { version: true },
  });
  if (Number.isFinite(paidVersion) && cartRow && cartRow.version !== paidVersion) {
    await app.stripe.refund(piId, 'stale-cart-version');
    Sentry.captureMessage('stripe webhook: folha velha pagou apos reabertura, reembolsado', {
      level: 'error',
      tags: { kind: 'stripe-stale-cart-version', provider: 'stripe' },
      extra: { cartId, paymentIntentId: piId, paidVersion, currentVersion: cartRow.version },
    });
    request.log.warn(
      { cartId, piId, paidVersion, currentVersion: cartRow.version },
      'stripe webhook: stale cart version, refunded',
    );
    await markProcessed(webhookEvent.id, webhookEvent);
    return reply.status(200).send({ ok: true, refunded: true, reason: 'stale-cart-version' });
  }
}
```

`Sentry` já está importado no arquivo. Conferir.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/cart/`
Expected: PASS. `checkout-webhook.test.ts` monta metadata à mão em vários
lugares; onde ele mandar `cartVersion` errado, corrigir para a versão real do
carrinho, não desligar a guarda.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/stripe-webhook.ts apps/api/test/cart/checkout-stale-sheet.test.ts
git commit -m "fix(api): reembolsar pagamento de folha velha por divergencia de cartVersion"
```

---

### Task 7: Corrida (c) — worker de expiração de pedidos

`apps/api/src/workers/` não tem nenhum worker de expiração. Toda varredura é
preguiçosa: `sweepExpiredOrdersForTier`
(`apps/api/src/services/orders/expire.ts:129`) e `sweepExpiredOrdersForVariant`
(`:174`) só rodam quando outro checkout do mesmo tier ou variant acontece, e
`expireSingleOrder` (`:242`) só roda em `GET /orders/:id`. Âncoras de
2026-08-29. "Cancela a PI quando a varredura expirar o pedido" não tem gatilho
confiável hoje.

O worker é o gatilho. Ele varre pedidos pendentes vencidos, expira, libera
estoque com o helper que já existe, e cancela a PI.

**Files:**

- Create: `apps/api/src/workers/order-expiry.ts`
- Modify: `apps/api/src/app.ts:199-262` (registrar junto dos demais workers)
- Test: `apps/api/test/workers/order-expiry.test.ts`

**Interfaces:**

- Consumes: `releaseAllReservationsForOrders` de
  `apps/api/src/services/orders/expire.ts:35`, `StripeClient.cancelPaymentIntent`.
- Produces:
  - `runOrderExpiryTick(deps: { stripe: StripeClient; now?: Date; log?: FastifyBaseLogger }): Promise<{ expired: number; cancelled: number }>`
  - `startOrderExpiryWorker(deps: { stripe: StripeClient; log: FastifyBaseLogger }): { stop: () => void }`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/workers/order-expiry.test.ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { runOrderExpiryTick } from '../../src/workers/order-expiry.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('runOrderExpiryTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('expira pedido pendente vencido e cancela a PI', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_vencida',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });

    expect(result.expired).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent')).toHaveLength(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('expired');
  });

  it('nao toca em pedido pendente ainda dentro do prazo', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_viva',
        status: 'pending',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });

    expect(result.expired).toBe(0);
    expect(stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent')).toHaveLength(0);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('pending');
  });

  it('nao toca em pedido ja pago, mesmo com expiresAt no passado', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();

    await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_paga',
        status: 'paid',
        paidAt: new Date(),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });
    expect(result.expired).toBe(0);
  });

  // Pix nao tem PaymentIntent. Cancelar contra a Stripe um ref de AbacatePay
  // seria chamada garantidamente errada.
  it('nao chama a Stripe para pedido de outro provider', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();

    await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: 'bill_abacate',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });
    expect(result.expired).toBe(1);
    expect(result.cancelled).toBe(0);
  });

  // Uma PI que a Stripe ja fechou 400a no cancel. Isso nao pode travar a fila.
  it('continua a varredura quando o cancel de uma PI estoura', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();
    stripe.nextCancelPaymentIntentError = new Error('payment_intent_unexpected_state');

    await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_ruim',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });
    expect(result.expired).toBe(1);
    expect(result.cancelled).toBe(0);
  });
});
```

Ler `apps/api/test/workers/billing-reconcile.test.ts` antes de escrever, para
copiar o padrão de setup e teardown daquele arquivo. Conferir também os campos
obrigatórios de `Order` no `create` acima contra
`packages/db/prisma/schema.prisma:1234-1288` (âncora de 2026-08-29); se o Prisma
reclamar de campo faltando, acrescentar, não remover a asserção.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/workers/order-expiry.test.ts`
Expected: FAIL, não resolve `../../src/workers/order-expiry.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/workers/order-expiry.ts
/**
 * Varredura de expiracao de pedidos.
 *
 * Ate aqui nenhuma varredura tinha gatilho proprio. sweepExpiredOrdersForTier e
 * sweepExpiredOrdersForVariant so rodam quando outro checkout do mesmo tier ou
 * variant acontece, e expireSingleOrder so roda em GET /orders/:id. Um pedido
 * de um tier que ninguem mais compra ficava pendente para sempre, segurando
 * estoque, com a PaymentIntent viva e pagavel.
 *
 * Este worker e o gatilho que faltava. Ele tambem e o unico lugar que cancela a
 * PI de um pedido que venceu sem que nenhum webhook tenha chegado.
 */
import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import { releaseAllReservationsForOrders } from '../services/orders/expire.js';
import type { StripeClient } from '../services/stripe/index.js';

export type OrderExpiryTickDeps = {
  stripe: StripeClient;
  now?: Date;
  log?: FastifyBaseLogger;
};

/** Teto por tick. Mesmo formato do QUERY_LIMIT do billing-reconcile. */
const QUERY_LIMIT = 200;

export const runOrderExpiryTick = async (
  deps: OrderExpiryTickDeps,
): Promise<{ expired: number; cancelled: number }> => {
  const now = deps.now ?? new Date();

  const stale = await prisma.order.findMany({
    where: { status: 'pending', expiresAt: { not: null, lt: now } },
    select: { id: true, provider: true, providerRef: true },
    orderBy: { expiresAt: 'asc' },
    take: QUERY_LIMIT,
  });

  if (stale.length === 0) return { expired: 0, cancelled: 0 };

  const ids = stale.map((o) => o.id);

  // Estado e estoque numa transacao so. A liberacao usa o mesmo helper das
  // varreduras preguicosas, entao pedido `mixed` e desenrolado igual.
  await prisma.$transaction(async (tx) => {
    await tx.order.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data: { status: 'expired' },
    });
    await releaseAllReservationsForOrders(tx, ids);
  });

  // Cancelar as PIs depois do commit. Best-effort: a Stripe 400a o cancel de
  // uma PI que ela propria ja fechou, e isso nao pode travar a fila.
  let cancelled = 0;
  for (const order of stale) {
    if (order.provider !== 'stripe' || !order.providerRef) continue;
    try {
      await deps.stripe.cancelPaymentIntent(order.providerRef);
      cancelled += 1;
    } catch (err) {
      deps.log?.warn(
        { err, orderId: order.id, providerRef: order.providerRef },
        '[order-expiry] falha ao cancelar a PI do pedido expirado',
      );
    }
  }

  deps.log?.info({ expired: ids.length, cancelled }, '[order-expiry] tick concluido');
  return { expired: ids.length, cancelled };
};

export const startOrderExpiryWorker = (deps: {
  stripe: StripeClient;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('* * * * *', async () => {
    try {
      await runOrderExpiryTick({ stripe: deps.stripe, log: deps.log });
    } catch (err) {
      deps.log.error({ err }, '[order-expiry] tick error');
    }
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
```

Em `apps/api/src/app.ts`, dentro do bloco
`if (env.WORKER_ENABLED && env.NODE_ENV === 'production')` que começa na linha
199 (âncora de 2026-08-29), **fora** do `if (env.GROWTH_PREMIUM_BILLING_ENABLED)`
das linhas 229-261, porque expiração de pedido não é assinatura:

```typescript
const orderExpiryWorker = startOrderExpiryWorker({ stripe: app.stripe, log: app.log });
app.addHook('onClose', () => {
  orderExpiryWorker.stop();
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/workers/order-expiry.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/order-expiry.ts apps/api/src/app.ts apps/api/test/workers/order-expiry.test.ts
git commit -m "feat(api): worker de expiracao de pedidos, cancelando a PI vencida"
```

---

### Task 8: Tabela `PremiumSubscriptionAttempt`, migração e rollback

O registro pré-pagamento da Decisão 4. `PremiumMembership` fica **intocada**,
o que preserva a invariante de que membership só nasce de webhook verificado.

Por que não índice parcial em `PremiumMembership`: `premiumMembership.create`
roda em um lugar só, `apply-membership-event.ts:97`, dentro de `handleActivated`,
disparado por `invoice.paid`. Um índice ali não impede a Stripe de criar a
segunda assinatura. Ele impede o banco de **registrar** uma que a Stripe já
cobrou. Caminho do desastre: segunda `invoice.paid` → `handleActivated` → P2002
→ escapa do `$transaction` → 500 → Stripe reentrega por ~3 dias → evento
perdido. Cobrança mensal recorrente, sem membership, sem entitlement, sem
reembolso. E `billing-reconcile.ts:22-26` (âncora de 2026-08-29) só varre
`active/past_due/cancel_scheduled`, então nada encontra.

Pelo mesmo motivo, **não** adicionar `incomplete` ao enum
`PremiumMembershipStatus`. O enum novo cascatearia por ~25 arquivos.

Prisma não suporta índice único parcial no DSL. O precedente do repo é escrever
o índice em SQL cru na migração:
`packages/db/prisma/migrations/20260504184500_cart_open_unique_per_user/migration.sql`
(âncora de 2026-08-29).

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (modelo novo, mais back-relation em
  `Garage`, linha 289-313)
- Create: `packages/db/prisma/migrations/20260829120000_premium_subscription_attempt/migration.sql`
- Create: `docs/migration-rollback-premium-subscription-attempt.md`
- Modify: `apps/api/test/helpers.ts` (limpeza no `resetDatabase`, antes de
  `prisma.premiumMembership.deleteMany()` na linha 78)
- Test: `apps/api/test/billing/premium-subscription-attempt-schema.test.ts`

**Interfaces:**

- Produces:
  - modelo `PremiumSubscriptionAttempt` com
    `id, garageId, cadence, planTier, packageDigest, idempotencyKey, providerSubRef, status, createdAt, updatedAt`
  - enum `PremiumSubscriptionAttemptStatus { pending succeeded abandoned }`
  - índice único parcial `PremiumSubscriptionAttempt_garageId_pending_unique`
    em `("garageId") WHERE "status" = 'pending'`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/billing/premium-subscription-attempt-schema.test.ts
import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

const attempt = (garageId: string, cadence: 'monthly' | 'annual', digest: string) => ({
  garageId,
  cadence,
  planTier: 'gold' as const,
  packageDigest: digest,
  idempotencyKey: `sub_${garageId}_${cadence}_${digest}_seed`,
  status: 'pending' as const,
});

describe('PremiumSubscriptionAttempt', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('aceita uma tentativa pendente por garagem', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const row = await prisma.premiumSubscriptionAttempt.create({
      data: attempt(garage.id, 'monthly', 'aaa'),
    });
    expect(row.status).toBe('pending');
  });

  // Esta e a guarda. Dois toques concorrentes tem que colapsar numa tentativa.
  it('recusa uma segunda tentativa pendente da mesma garagem', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    await prisma.premiumSubscriptionAttempt.create({
      data: attempt(garage.id, 'monthly', 'aaa'),
    });

    await expect(
      prisma.premiumSubscriptionAttempt.create({
        data: attempt(garage.id, 'annual', 'bbb'),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // Recontratar depois de cancelar e caso obrigatorio. O indice e parcial
  // exatamente para nao bloqueá-lo.
  it('aceita nova tentativa depois de a anterior sair de pending', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const first = await prisma.premiumSubscriptionAttempt.create({
      data: attempt(garage.id, 'monthly', 'aaa'),
    });
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: first.id },
      data: { status: 'succeeded', providerSubRef: 'sub_live_1' },
    });

    const second = await prisma.premiumSubscriptionAttempt.create({
      data: attempt(garage.id, 'monthly', 'ccc'),
    });
    expect(second.id).not.toBe(first.id);
  });

  it('permite tentativas pendentes de garagens diferentes', async () => {
    const a = await createUser({ verified: true, email: 'a@casacar.test' });
    const b = await createUser({ verified: true, email: 'b@casacar.test' });
    const ga = await prisma.garage.findUniqueOrThrow({ where: { userId: a.user.id } });
    const gb = await prisma.garage.findUniqueOrThrow({ where: { userId: b.user.id } });

    await prisma.premiumSubscriptionAttempt.create({ data: attempt(ga.id, 'monthly', 'aaa') });
    await prisma.premiumSubscriptionAttempt.create({ data: attempt(gb.id, 'monthly', 'aaa') });

    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(2);
  });

  // PremiumMembership tem que continuar sem restricao nenhuma de duplicidade
  // por garagem. Uma restricao ali impediria o BANCO de registrar assinatura
  // que a Stripe JA COBROU.
  it('PremiumMembership continua aceitando duas linhas vivas na mesma garagem', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const base = {
      garageId: garage.id,
      provider: 'stripe' as const,
      providerCustomerRef: 'cus_1',
      tier: 'gold' as const,
      cadence: 'monthly' as const,
      status: 'active' as const,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      baseAmountCents: 24_990,
      devFeePercent: 10,
      devFeeAmountCents: 2499,
      grossAmountCents: 27_489,
      currency: 'BRL',
    };

    await prisma.premiumMembership.create({ data: { ...base, providerSubRef: 'sub_1' } });
    await prisma.premiumMembership.create({ data: { ...base, providerSubRef: 'sub_2' } });

    expect(await prisma.premiumMembership.count({ where: { garageId: garage.id } })).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/billing/premium-subscription-attempt-schema.test.ts`
Expected: FAIL, `prisma.premiumSubscriptionAttempt` não existe no client.

- [ ] **Step 3: Write minimal implementation**

Em `packages/db/prisma/schema.prisma`, junto do bloco premium (perto da linha
383):

```prisma
enum PremiumSubscriptionAttemptStatus {
  pending
  succeeded
  abandoned
}

/// Registro PRE-pagamento de uma tentativa de assinatura premium.
///
/// Existe para que a guarda de duplicidade nao encoste em PremiumMembership.
/// premiumMembership.create roda so dentro do webhook invoice.paid
/// (services/billing/apply-membership-event.ts), entao uma restricao la
/// impediria o BANCO de registrar uma assinatura que a Stripe JA COBROU, e o
/// P2002 resultante escaparia do $transaction, viraria 500, e o evento se
/// perderia depois de ~3 dias de reentrega. Cobranca recorrente sem membership,
/// sem entitlement e sem reembolso.
///
/// O indice unico parcial por garageId onde status = 'pending' esta na
/// migracao em SQL cru; o Prisma nao suporta indice unico parcial no DSL.
/// Mesmo padrao de Cart_userId_open_unique.
model PremiumSubscriptionAttempt {
  id             String                           @id @default(cuid())
  garageId       String
  cadence        PremiumCadence
  planTier       GaragePremiumTier
  /// sha1 truncado dos price ids resolvidos, plano primeiro. Mesmo digest da
  /// chave de idempotencia do checkout hospedado em me-premium.ts.
  packageDigest  String                           @db.VarChar(24)
  /// sub_${garageId}_${cadence}_${digest}_${attemptId}. Guardada para o log de
  /// auditoria e para o replay de idempotencia da Stripe.
  idempotencyKey String                           @db.VarChar(200)
  /// Preenchida assim que subscriptions.create devolve. Null enquanto a
  /// chamada nao voltou.
  providerSubRef String?                          @db.VarChar(120)
  status         PremiumSubscriptionAttemptStatus @default(pending)
  createdAt      DateTime                         @default(now())
  updatedAt      DateTime                         @updatedAt

  garage Garage @relation(fields: [garageId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
  @@index([garageId, status])
  @@index([providerSubRef])
}
```

Em `model Garage`, acrescentar a back-relation junto das demais (linhas 305-309):

```prisma
  premiumSubscriptionAttempts PremiumSubscriptionAttempt[]
```

Gerar o esqueleto da migração e então escrever o índice parcial à mão:

```bash
cd packages/db && pnpm exec prisma migrate dev --name premium_subscription_attempt --create-only
```

No `migration.sql` gerado, acrescentar ao final:

```sql
-- Uma tentativa pendente por garagem. Parcial de proposito: recontratar depois
-- de cancelar precisa abrir uma tentativa nova, e uma unique total sobre
-- garageId bloquearia isso para sempre.
-- Prisma nao suporta indice unico parcial nativamente; mesmo padrao de
-- Cart_userId_open_unique (20260504184500).
CREATE UNIQUE INDEX "PremiumSubscriptionAttempt_garageId_pending_unique"
  ON "PremiumSubscriptionAttempt" ("garageId")
  WHERE "status" = 'pending';
```

Em `apps/api/test/helpers.ts`, antes de `await prisma.premiumMembership.deleteMany();`
(linha 78, âncora de 2026-08-29):

```typescript
await prisma.premiumSubscriptionAttempt.deleteMany();
```

Criar `docs/migration-rollback-premium-subscription-attempt.md`, no formato dos
três `docs/migration-rollback-*.md` que já existem:

````markdown
# Migration Rollback — PremiumSubscriptionAttempt

Cobre `20260829120000_premium_subscription_attempt`, a tabela de tentativa
pre-pagamento da guarda de duplicidade de assinatura (Decisao 4).

Puramente aditiva. Nenhuma coluna existente foi alterada, e
`PremiumMembership` nao foi tocada de proposito.

## Rollback SQL

```sql
DROP INDEX IF EXISTS "PremiumSubscriptionAttempt_garageId_pending_unique";
DROP TABLE IF EXISTS "PremiumSubscriptionAttempt";
DROP TYPE IF EXISTS "PremiumSubscriptionAttemptStatus";

DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260829120000_premium_subscription_attempt';
```

## Safety Notes

- Conferir se ha tentativa em voo antes de derrubar:

  ```sql
  SELECT COUNT(*) FROM "PremiumSubscriptionAttempt" WHERE status = 'pending';
  ```

  Cada linha pendente representa uma `subscriptions.create` que a Stripe pode
  ter aceito. Derrubar a tabela com linhas pendentes remove o unico registro
  local dessas assinaturas incompletas. Conferir cada uma no dashboard da
  Stripe pelo `providerSubRef` antes.

- Nenhuma membership e perdida no rollback. `PremiumMembership` continua sendo
  escrita so pelo webhook `invoice.paid`, que nao depende desta tabela.

- Depois do SQL, reverter o modelo e a back-relation em `Garage` no
  `schema.prisma` e rodar `pnpm --filter @ccc/db db:generate`.

- O endpoint de assinatura nativa **para de funcionar** sem esta tabela. Reverter
  o codigo da rota junto, ou desligar o gate de plataforma para nativo antes.
````

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/billing/premium-subscription-attempt-schema.test.ts`
Expected: PASS, 5 testes. O `global-setup.ts` roda `migrate deploy` contra o
Testcontainer; se o client não tiver o modelo, rodar
`pnpm --filter @ccc/db db:generate` antes.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations docs/migration-rollback-premium-subscription-attempt.md apps/api/test/helpers.ts apps/api/test/billing/premium-subscription-attempt-schema.test.ts
git commit -m "feat(db): tabela PremiumSubscriptionAttempt com unique parcial por garagem"
```

---

### Task 9: Endpoint de assinatura nativa

`POST /api/me/premium/checkout-native`. Cria a assinatura com
`payment_behavior: 'default_incomplete'` e devolve o `clientSecret` que o
`PaymentSheet` consome.

Sobre a forma da SDK, verificado em 2026-08-29 no `node_modules` desta árvore:

- `node_modules/stripe/package.json` → `22.1.0`
- `node_modules/stripe/cjs/apiVersion.d.ts` → `"2026-04-22.dahlia"`
- `Invoices.d.ts:207` → `confirmation_secret?: Invoice.ConfirmationSecret | null`
  no topo de `Invoice`
- `Invoices.d.ts:472-481` → `ConfirmationSecret { client_secret: string; type: string }`
- `Invoices.d.ts:592` → o único `payment_intent` do arquivo está dentro de
  `Invoice.LastFinalizationError`. **Não existe `Invoice.payment_intent` no
  topo.** Escrever `invoice.payment_intent.client_secret` não compila.
- `Subscriptions.d.ts:194` → `latest_invoice: string | Invoice | null`
- `Subscriptions.d.ts:1059` → `PaymentBehavior` inclui `'default_incomplete'`

`confirmation_secret` só vem preenchida com `expand`. Por isso o
`expand: ['latest_invoice.confirmation_secret']`.

A guarda tem quatro peças, todas nesta task: lock `FOR UPDATE` na `Garage` antes
de qualquer `subscriptions.create`, tentativa em `PremiumSubscriptionAttempt`,
chave determinística `sub_${garageId}_${cadence}_${digest}_${attemptId}`, e rate
limit por usuário autenticado.

O padrão do lock é o de `apps/api/src/routes/stripe-billing-webhook.ts:754`
(âncora de 2026-08-29):
`await tx.$queryRaw\`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE\``.

**Files:**

- Modify: `apps/api/src/services/stripe/index.ts` (método novo no `StripeClient`)
- Modify: `apps/api/src/services/stripe/fake.ts` (o mesmo método no fake)
- Modify: `packages/shared/src/premium.ts`
- Modify: `apps/api/src/routes/me-premium.ts`
- Test: `apps/api/test/billing/premium-native-subscription.test.ts`

**Interfaces:**

- Consumes: `PremiumSubscriptionAttempt` (Task 8),
  `premiumCheckoutRejectionSchema` (Task 2), `LIVE_MEMBERSHIP_STATUSES` (Task 1).
- Produces:
  - `StripeClient.createNativeSubscription(input: CreateNativeSubscriptionInput): Promise<NativeSubscriptionResult>`
  - `type CreateNativeSubscriptionInput = { customerId: string; priceIds: string[]; metadata: Record<string,string>; idempotencyKey: string }`
  - `type NativeSubscriptionResult = { subscriptionId: string; clientSecret: string | null; status: Stripe.Subscription.Status }`
  - `premiumNativeCheckoutResponseSchema`: `{ subscriptionId: string; clientSecret: string; attemptId: string }`
  - `FakeStripe.nextNativeSubscription: NativeSubscriptionResult`
  - `FakeStripe.nextCreateNativeSubscriptionError: Error | null`
  - `resolveSubscriptionPackage(request, reply): Promise<{ tier: 'gold'|'silver'|'bronze'; cadence: 'monthly'|'annual'; priceId: string; addonPriceIds: string[] } | null>`,
    extraída do `checkoutHandler` e usada pelos dois handlers. Devolve `null`
    quando já respondeu 404, 400, 422 ou 503 por conta própria.
  - rota `POST /api/me/premium/checkout-native`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/billing/premium-native-subscription.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedGoldMonthly = async () => {
  const plan = await prisma.premiumPlan.create({
    data: { tier: 'gold', slug: 'fundador', name: 'Fundador', sortOrder: 1, active: true },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: plan.id,
      cadence: 'monthly',
      baseAmountCents: 24_990,
      currency: 'BRL',
      stripePriceId: 'price_gold_monthly',
    },
  });
};

describe('POST /api/me/premium/checkout-native', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
    await seedGoldMonthly();
  });

  afterEach(async () => {
    await app.close();
  });

  it('devolve clientSecret e grava a tentativa como pending', async () => {
    const { user } = await createUser({ verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { clientSecret: string; subscriptionId: string; attemptId: string };
    expect(body.clientSecret).toBe('pi_sub_secret_fake');

    const attempt = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: body.attemptId },
    });
    expect(attempt.status).toBe('pending');
    expect(attempt.providerSubRef).toBe(body.subscriptionId);
  });

  it('usa a chave determinstica sub_{garageId}_{cadence}_{digest}_{attemptId}', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });
    const body = res.json() as { attemptId: string };

    const call = stripe.calls.find((c) => c.kind === 'createNativeSubscription');
    const payload = call!.payload as { idempotencyKey: string };
    expect(payload.idempotencyKey.startsWith(`sub_${garage.id}_monthly_`)).toBe(true);
    expect(payload.idempotencyKey.endsWith(`_${body.attemptId}`)).toBe(true);
  });

  // A guarda. Dois toques concorrentes tem que colapsar numa assinatura so.
  it('dois toques seguidos reusam a mesma tentativa e nao abrem segunda assinatura', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);

    const first = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(second.statusCode).toBe(201);
    expect((second.json() as { attemptId: string }).attemptId).toBe(
      (first.json() as { attemptId: string }).attemptId,
    );
    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(1);
  });

  it('recusa quando ja existe membership viva', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_x',
        providerSubRef: 'sub_x',
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        baseAmountCents: 24_990,
        devFeePercent: 10,
        devFeeAmountCents: 2499,
        grossAmountCents: 27_489,
        currency: 'BRL',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(409);
    expect(await prisma.premiumSubscriptionAttempt.count()).toBe(0);
  });

  it('herda a rejeicao de anual mais add-on da Decisao 2', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.premiumAddonModule.create({
      data: {
        key: 'detail',
        name: 'Detailing',
        description: 'Lavagem mensal',
        monthlyDeltaCents: 9900,
        currency: 'BRL',
        quotaPerCycle: 1,
        quotaUnit: 'access',
        active: true,
        stripePriceId: 'price_addon_detail',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'annual', planSlug: 'fundador', addonKeys: ['detail'] },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED' });
  });

  it('devolve 429 depois de 5 chamadas do mesmo usuario em um minuto', async () => {
    const { user } = await createUser({ verified: true });
    const token = bearer(env, user.id);

    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/me/premium/checkout-native',
        headers: { authorization: token, 'x-ccc-platform': 'ios' },
        payload: { cadence: 'monthly', planSlug: 'fundador' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: token, 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });
    expect(res.statusCode).toBe(429);
  });
});
```

Conferir os campos de `PremiumPlan` e `PremiumPlanPrice` em
`packages/db/prisma/schema.prisma` antes de rodar. `seedGoldMonthly` acima é um
palpite informado sobre a forma; ler o schema e corrigir, ou reusar o seed que
`apps/api/test/billing/premium-checkout-catalog.test.ts` já usa.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/billing/premium-native-subscription.test.ts`
Expected: FAIL, rota 404.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/services/stripe/index.ts`, junto dos demais tipos:

```typescript
export type CreateNativeSubscriptionInput = {
  customerId: string;
  /** Todos os prices recorrentes, plano primeiro. Mesmo intervalo e moeda. */
  priceIds: string[];
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export type NativeSubscriptionResult = {
  subscriptionId: string;
  /**
   * client_secret da confirmation_secret da latest_invoice. Null quando a
   * Stripe finaliza a fatura sem exigir confirmacao (valor zero, credito),
   * caso em que nao ha nada para o PaymentSheet apresentar.
   */
  clientSecret: string | null;
  status: Stripe.Subscription.Status;
};
```

Acrescentar ao tipo `StripeClient`:

```typescript
/**
 * Assinatura nativa para o PaymentSheet. payment_behavior
 * 'default_incomplete' faz a Stripe criar a assinatura em `incomplete` e
 * deixar a primeira fatura aguardando confirmacao no cliente.
 *
 * O segredo sai de `latest_invoice.confirmation_secret.client_secret`. Na SDK
 * 22.1.0 com apiVersion 2026-04-22.dahlia, `Invoice` NAO tem `payment_intent`
 * no topo (Invoices.d.ts:207 e :472-481); o unico `payment_intent` do arquivo
 * esta dentro de LastFinalizationError. `invoice.payment_intent` nao compila.
 *
 * `confirmation_secret` so vem preenchida com expand explicito.
 */
createNativeSubscription: (input: CreateNativeSubscriptionInput) =>
  Promise<NativeSubscriptionResult>;
```

E a implementação, junto de `createSubscriptionCheckoutSession`:

```typescript
    createNativeSubscription: async ({ customerId, priceIds, metadata, idempotencyKey }) => {
      const sub = await stripe.subscriptions.create(
        {
          customer: customerId,
          items: priceIds.map((price) => ({ price, quantity: 1 })),
          payment_behavior: 'default_incomplete',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          metadata,
          expand: ['latest_invoice.confirmation_secret'],
        },
        { idempotencyKey },
      );
      const invoice = typeof sub.latest_invoice === 'string' ? null : sub.latest_invoice;
      return {
        subscriptionId: sub.id,
        clientSecret: invoice?.confirmation_secret?.client_secret ?? null,
        status: sub.status,
      };
    },
```

No fake, acrescentar `'createNativeSubscription'` ao union `FakeCall['kind']`,
os dois campos ao tipo `FakeStripe`, os defaults, e o método:

```typescript
    nextNativeSubscription: {
      subscriptionId: 'sub_native_fake_1',
      clientSecret: 'pi_sub_secret_fake',
      status: 'incomplete',
    },
    nextCreateNativeSubscriptionError: null,

    createNativeSubscription: async (input) => {
      fake.calls.push({ kind: 'createNativeSubscription', payload: input });
      if (fake.nextCreateNativeSubscriptionError) throw fake.nextCreateNativeSubscriptionError;
      return fake.nextNativeSubscription;
    },
```

Em `packages/shared/src/premium.ts`:

```typescript
/**
 * POST /api/me/premium/checkout-native — resposta.
 *
 * clientSecret e obrigatorio: uma resposta 201 sem segredo daria ao app uma
 * folha de pagamento que nao pode cobrar nada.
 */
export const premiumNativeCheckoutResponseSchema = z.object({
  subscriptionId: z.string().min(1),
  clientSecret: z.string().min(1),
  attemptId: z.string().min(1),
});

export type PremiumNativeCheckoutResponse = z.infer<typeof premiumNativeCheckoutResponseSchema>;
```

Em `apps/api/src/routes/me-premium.ts`, um handler novo. A resolução de tier,
price e add-ons é a **mesma** de `checkoutHandler` (linhas 216-302, âncora de
2026-08-29). Extrair aquele bloco para uma função
`resolveSubscriptionPackage(request, reply)` e chamá-la nos dois handlers, em vez
de duplicar. Ler o bloco antes de extrair.

```typescript
/**
 * POST /api/me/premium/checkout-native
 *
 * Assinatura para o PaymentSheet. Guarda de duplicidade da Decisao 4, quatro
 * pecas:
 *
 *  1. SELECT ... FOR UPDATE na linha de Garage antes de qualquer
 *     subscriptions.create. Mesmo padrao de stripe-billing-webhook.ts:754.
 *     Dois toques concorrentes serializam.
 *  2. PremiumSubscriptionAttempt com unique parcial por garageId onde
 *     status = 'pending'. E o registro pre-pagamento. PremiumMembership fica
 *     intocada, o que PRESERVA a invariante de que membership so nasce de
 *     webhook verificado.
 *  3. Chave determinstica sub_${garageId}_${cadence}_${digest}_${attemptId}.
 *     Toques concorrentes caem na mesma tentativa e colapsam numa assinatura
 *     so. Recontratar depois de cancelar abre tentativa nova, e portanto
 *     assinatura nova, sem colisao de chave.
 *  4. Reaping por TTL de 23h no worker de reconciliacao (task separada), antes
 *     de a Stripe transicionar para incomplete_expired.
 */
const nativeCheckoutHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
    return reply
      .status(503)
      .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
  }

  const { sub } = requireUser(request);

  const gated = await enforceProfileGate(app, request, sub, reply, 'subscription');
  if (gated) return gated;

  const pkg = await resolveSubscriptionPackage(request, reply);
  if (!pkg) return reply; // resolveSubscriptionPackage ja respondeu

  const user = await prisma.user.findUnique({ where: { id: sub }, select: { email: true } });
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  const garage = await prisma.garage.upsert({
    where: { userId: sub },
    create: { userId: sub, name: 'Garagem', slug: `garage-${sub}` },
    update: {},
    select: { id: true },
  });

  const { customerId } = await app.stripe.findOrCreateCustomer({
    email: user.email,
    garageId: garage.id,
  });

  const packageDigest = createHash('sha1')
    .update([pkg.priceId, ...pkg.addonPriceIds].join('|'))
    .digest('hex')
    .slice(0, 12);

  // Lock + precheck + tentativa numa transacao so. O lock e o que faz dois
  // toques concorrentes serializarem em vez de criarem duas assinaturas.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garage.id} FOR UPDATE`;

    const live = await tx.premiumMembership.findFirst({
      where: { garageId: garage.id, status: { in: [...LIVE_STATUSES] } },
      select: { provider: true, providerCustomerRef: true },
    });
    if (live) return { kind: 'already' as const, live };

    const pending = await tx.premiumSubscriptionAttempt.findFirst({
      where: { garageId: garage.id, status: 'pending' },
    });
    if (pending) return { kind: 'reuse' as const, attempt: pending };

    const created = await tx.premiumSubscriptionAttempt.create({
      data: {
        garageId: garage.id,
        cadence: pkg.cadence,
        planTier: pkg.tier,
        packageDigest,
        idempotencyKey: '',
        status: 'pending',
      },
    });
    return { kind: 'created' as const, attempt: created };
  });

  if (outcome.kind === 'already') {
    return reply.status(409).send({
      error: 'AlreadySubscribed',
      provider: outcome.live.provider,
      message: 'ja existe assinatura viva para esta garagem',
    });
  }

  const attempt = outcome.attempt;
  const idempotencyKey = `sub_${garage.id}_${pkg.cadence}_${packageDigest}_${attempt.id}`;

  let result;
  try {
    result = await app.stripe.createNativeSubscription({
      customerId,
      priceIds: [pkg.priceId, ...pkg.addonPriceIds],
      metadata: { garageId: garage.id, userId: sub, cadence: pkg.cadence },
      idempotencyKey,
    });
  } catch (err) {
    // A tentativa vira abandoned imediatamente. Deixá-la pending travaria a
    // garagem por 23h por causa de uma falha que nem chegou na Stripe.
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: attempt.id },
      data: { status: 'abandoned' },
    });
    request.log.error(
      { err, garageId: garage.id },
      'me-premium: stripe recusou a assinatura nativa',
    );
    return reply
      .status(503)
      .send({ error: 'ServiceUnavailable', message: 'could not start checkout' });
  }

  if (!result.clientSecret) {
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: attempt.id },
      data: { status: 'abandoned', providerSubRef: result.subscriptionId, idempotencyKey },
    });
    request.log.error(
      { garageId: garage.id, subscriptionId: result.subscriptionId, status: result.status },
      'me-premium: assinatura nativa sem confirmation_secret',
    );
    return reply
      .status(503)
      .send({ error: 'ServiceUnavailable', message: 'could not start checkout' });
  }

  await prisma.premiumSubscriptionAttempt.update({
    where: { id: attempt.id },
    data: { providerSubRef: result.subscriptionId, idempotencyKey },
  });

  return reply.status(201).send(
    premiumNativeCheckoutResponseSchema.parse({
      subscriptionId: result.subscriptionId,
      clientSecret: result.clientSecret,
      attemptId: attempt.id,
    }),
  );
};
```

Registrar com rate limit, no mesmo formato do bloco de `me-premium.ts:752-761`
(âncora de 2026-08-29):

```typescript
// Limite por usuario autenticado, nao por IP. app.ts:95 nao seta trustProxy,
// entao atras do Railway req.ip e o proxy de borda para todo mundo e um
// limite por IP seria um balde global. Chavear no sub evita o problema.
// Sem limite, "UUID novo a cada toque" e torneira de assinaturas orfas.
await app.register(async (scoped) => {
  scoped.addHook('preHandler', app.authenticate);
  await scoped.register(rateLimit, {
    max: 5,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `premium-checkout-native:${req.user?.sub ?? req.ip}`,
  });
  scoped.post('/api/me/premium/checkout-native', nativeCheckoutHandler);
});
```

Aplicar também o guard de plataforma do Plano 1 nesta rota, pelo mesmo caminho
que a Task 5 do Plano 1 usou em `/checkout`. Ler
`apps/api/src/services/platform-gate/guard.ts` antes.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/billing/premium-native-subscription.test.ts`
Expected: PASS, 6 testes.

Run: `cd apps/api && pnpm exec vitest run test/billing/`
Expected: PASS. A extração de `resolveSubscriptionPackage` toca o
`checkoutHandler` hospedado; `premium-checkout-addons.test.ts` e
`premium-checkout-catalog.test.ts` são a rede de segurança dela.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/stripe/index.ts apps/api/src/services/stripe/fake.ts packages/shared/src/premium.ts apps/api/src/routes/me-premium.ts apps/api/test/billing/premium-native-subscription.test.ts
git commit -m "feat(api): assinatura nativa default_incomplete com guarda de tentativa"
```

---

### Task 10: Precheck consulta a tabela de tentativa

`listOpenSubscriptionCheckoutSessions`
(`apps/api/src/services/stripe/index.ts:231` e `:507-516`, âncoras de
2026-08-29) enumera Checkout Sessions. Uma assinatura `default_incomplete` não
cria nenhuma. Começar no iOS nativo e terminar na web cobra duas vezes, e a
precheck de hoje não vê nada.

**Files:**

- Modify: `apps/api/src/routes/me-premium.ts` (`GET /api/me/premium/checkout-precheck`,
  linhas 108-178, e o precheck inline do `checkoutHandler`, linhas 304-344)
- Test: `apps/api/test/billing/premium-precheck-attempt.test.ts`

**Interfaces:**

- Consumes: `PremiumSubscriptionAttempt` (Task 8).
- Produces: precheck e checkout hospedado devolvem
  `409 { error: 'SubscriptionAttemptInFlight', attemptId, startedAt }` quando
  existe tentativa pendente.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/billing/premium-precheck-attempt.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedPendingAttempt = async (garageId: string) =>
  prisma.premiumSubscriptionAttempt.create({
    data: {
      garageId,
      cadence: 'monthly',
      planTier: 'gold',
      packageDigest: 'aaa',
      idempotencyKey: `sub_${garageId}_monthly_aaa_x`,
      providerSubRef: 'sub_incomplete_1',
      status: 'pending',
    },
  });

describe('precheck ve a tentativa nativa em voo', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    ({ app } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET precheck devolve 409 com tentativa pendente', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const attempt = await seedPendingAttempt(garage.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'web' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'SubscriptionAttemptInFlight',
      attemptId: attempt.id,
    });
  });

  // Este e o caso do spec: comeca no iOS nativo, termina na web. Sem esta
  // guarda a Checkout Session hospedada cobra a segunda vez.
  it('POST checkout hospedado tambem recusa com tentativa pendente', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedPendingAttempt(garage.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'web' },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SubscriptionAttemptInFlight' });
  });

  it('tentativa abandoned nao bloqueia nada', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const attempt = await seedPendingAttempt(garage.id);
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: attempt.id },
      data: { status: 'abandoned' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'web' },
    });

    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/billing/premium-precheck-attempt.test.ts`
Expected: FAIL, os dois primeiros casos devolvem 200 e 201.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/me-premium.ts`, um helper compartilhado no topo do
plugin:

```typescript
/**
 * Tentativa nativa em voo, se houver.
 *
 * listOpenSubscriptionCheckoutSessions so enxerga Checkout Sessions, e uma
 * assinatura default_incomplete nao cria nenhuma. Sem esta consulta, comecar no
 * iOS nativo e terminar na web cobra duas vezes: a precheck ve a garagem limpa
 * e a sessao hospedada abre a segunda assinatura.
 */
const findPendingAttempt = async (garageId: string) =>
  prisma.premiumSubscriptionAttempt.findFirst({
    where: { garageId, status: 'pending' },
    select: { id: true, createdAt: true },
  });
```

No `GET /checkout-precheck`, depois de resolver a garagem e **antes** da consulta
de `liveMembership` (linha 135):

```typescript
const pending = await findPendingAttempt(garage.id);
if (pending) {
  return reply.status(409).send({
    error: 'SubscriptionAttemptInFlight',
    attemptId: pending.id,
    startedAt: pending.createdAt.toISOString(),
    message: 'ja existe uma contratacao em andamento nesta garagem',
  });
}
```

O mesmo bloco no precheck inline do `checkoutHandler`, dentro do
`if (existingGarage)` da linha 310, antes do `findFirst` de `liveMembership`.

No `nativeCheckoutHandler` da Task 9 **não** repetir isto: lá a consulta já roda
sob o lock `FOR UPDATE`, e uma tentativa pendente é reusada em vez de recusada.
Essa diferença é deliberada.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/billing/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me-premium.ts apps/api/test/billing/premium-precheck-attempt.test.ts
git commit -m "feat(api): precheck enxerga a tentativa nativa em voo"
```

---

### Task 11: Reaping de tentativa abandonada a 23h

Sem isto, quem toca em assinar e fecha o app fica travado para sempre: o índice
parcial recusa toda tentativa nova. 23h é antes de a Stripe transicionar a
assinatura `incomplete` para `incomplete_expired`, que acontece em 24h. Reapar
depois disso deixaria a tentativa apontando para uma assinatura já morta sem
nunca ter dado a chance de o pagamento chegar.

**Files:**

- Modify: `apps/api/src/workers/billing-reconcile.ts` (nova função, chamada no
  topo de `runReconcileTick`, linha 238, âncora de 2026-08-29)
- Test: `apps/api/test/workers/premium-attempt-reaping.test.ts`

**Interfaces:**

- Consumes: `PremiumSubscriptionAttempt` (Task 8).
- Produces: `reapAbandonedAttempts(now: Date, log?: FastifyBaseLogger): Promise<number>`,
  exportada, e chamada por `runReconcileTick`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/workers/premium-attempt-reaping.test.ts
import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { reapAbandonedAttempts } from '../../src/workers/billing-reconcile.js';
import { createUser, resetDatabase } from '../helpers.js';

const HOUR = 60 * 60 * 1000;

const seedAttempt = async (garageId: string, ageMs: number) => {
  const row = await prisma.premiumSubscriptionAttempt.create({
    data: {
      garageId,
      cadence: 'monthly',
      planTier: 'gold',
      packageDigest: 'aaa',
      idempotencyKey: `sub_${garageId}_monthly_aaa_x`,
      status: 'pending',
    },
  });
  // createdAt tem default(now()); empurrar para tras direto no banco.
  await prisma.$executeRaw`UPDATE "PremiumSubscriptionAttempt"
    SET "createdAt" = ${new Date(Date.now() - ageMs)} WHERE id = ${row.id}`;
  return row;
};

describe('reapAbandonedAttempts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('reapa tentativa pendente com mais de 23h', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const attempt = await seedAttempt(garage.id, 24 * HOUR);

    const reaped = await reapAbandonedAttempts(new Date());

    expect(reaped).toBe(1);
    const after = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(after.status).toBe('abandoned');
  });

  it('nao reapa tentativa com 22h', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const attempt = await seedAttempt(garage.id, 22 * HOUR);

    expect(await reapAbandonedAttempts(new Date())).toBe(0);
    const after = await prisma.premiumSubscriptionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(after.status).toBe('pending');
  });

  // Reapar libera o indice parcial. Sem isso o membro fica travado para sempre.
  it('depois do reaping a garagem aceita tentativa nova', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedAttempt(garage.id, 24 * HOUR);

    await reapAbandonedAttempts(new Date());

    const nova = await prisma.premiumSubscriptionAttempt.create({
      data: {
        garageId: garage.id,
        cadence: 'monthly',
        planTier: 'gold',
        packageDigest: 'bbb',
        idempotencyKey: `sub_${garage.id}_monthly_bbb_y`,
        status: 'pending',
      },
    });
    expect(nova.status).toBe('pending');
  });

  it('nao mexe em tentativa que ja virou succeeded', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const attempt = await seedAttempt(garage.id, 48 * HOUR);
    await prisma.premiumSubscriptionAttempt.update({
      where: { id: attempt.id },
      data: { status: 'succeeded' },
    });

    expect(await reapAbandonedAttempts(new Date())).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/workers/premium-attempt-reaping.test.ts`
Expected: FAIL, `reapAbandonedAttempts` não é exportada.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/workers/billing-reconcile.ts`, perto do topo, junto das outras
constantes de módulo (linhas 22-35, âncora de 2026-08-29):

```typescript
/**
 * TTL da tentativa de assinatura nativa.
 *
 * 23h, nao 24h, e nao e arredondamento. A Stripe transiciona uma assinatura
 * `incomplete` para `incomplete_expired` em 24h. Reapar depois disso deixaria a
 * tentativa apontando para uma assinatura ja morta, e o membro travado no
 * intervalo. Reapar antes devolve a garagem ao estado limpo enquanto ainda ha
 * chance de o pagamento chegar.
 *
 * Sem reaping nenhum, quem toca em assinar e fecha o app fica travado para
 * sempre: o indice unico parcial recusa toda tentativa nova.
 */
const ATTEMPT_TTL_MS = 23 * 60 * 60 * 1000;

export const reapAbandonedAttempts = async (
  now: Date,
  log?: FastifyBaseLogger,
): Promise<number> => {
  const cutoff = new Date(now.getTime() - ATTEMPT_TTL_MS);
  const result = await prisma.premiumSubscriptionAttempt.updateMany({
    where: { status: 'pending', createdAt: { lt: cutoff } },
    data: { status: 'abandoned' },
  });
  if (result.count > 0) {
    log?.info(
      { kind: 'reconcile.attempts_reaped', count: result.count },
      'billing-reconcile: tentativas de assinatura abandonadas reapadas',
    );
  }
  return result.count;
};
```

Chamar no topo de `runReconcileTick`, logo depois de `const now = ...`
(linha ~242):

```typescript
await reapAbandonedAttempts(now, log);
```

O worker já está registrado em `apps/api/src/app.ts:238`, sob
`GROWTH_PREMIUM_BILLING_ENABLED`. Nada a registrar.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/workers/premium-attempt-reaping.test.ts test/workers/billing-reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/billing-reconcile.ts apps/api/test/workers/premium-attempt-reaping.test.ts
git commit -m "feat(api): reaping de tentativa de assinatura abandonada em 23h"
```

---

### Task 12: Tags de Sentry, documentação e suíte completa

`docs/observability.md` usa convenção de regra por tag, com condição, motivo e
runbook. Os modos de falha que este plano introduz hoje não têm observabilidade
nenhuma.

**Files:**

- Modify: `apps/api/src/routes/me-premium.ts` (tag na assinatura nativa sem
  segredo e na Stripe recusando)
- Modify: `apps/api/src/workers/order-expiry.ts` (tag no cancel que falhou)
- Modify: `docs/observability.md`
- Modify: `docs/stripe.md` (as duas rotas novas)
- Test: `apps/api/test/billing/premium-native-sentry-tags.test.ts`

**Interfaces:**

- Produces: as tags `stripe-stale-cart-version` (já emitida na Task 6),
  `premium-native-subscription-no-secret`, `premium-attempt-reaped` e
  `order-expiry-cancel-failed`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/billing/premium-native-sentry-tags.test.ts
import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('tags de Sentry dos modos de falha novos', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('emite premium-native-subscription-no-secret quando a fatura vem sem confirmation_secret', async () => {
    const captured = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'id');
    const { user } = await createUser({ verified: true });
    // Reusar seedGoldMonthly de premium-native-subscription.test.ts.
    await seedGoldMonthly();

    stripe.nextNativeSubscription = {
      subscriptionId: 'sub_sem_segredo',
      clientSecret: null,
      status: 'incomplete',
    };

    await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(captured).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tags: expect.objectContaining({ kind: 'premium-native-subscription-no-secret' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/billing/premium-native-sentry-tags.test.ts`
Expected: FAIL, `captureMessage` não foi chamada.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/me-premium.ts`, no ramo `if (!result.clientSecret)` da
Task 9, junto do `request.log.error`:

```typescript
Sentry.captureMessage('me-premium: assinatura nativa sem confirmation_secret', {
  level: 'error',
  tags: { kind: 'premium-native-subscription-no-secret', provider: 'stripe' },
  extra: { subscriptionId: result.subscriptionId, status: result.status },
});
```

Importar `* as Sentry from '@sentry/node'` no topo do arquivo se ainda não
estiver lá.

Em `apps/api/src/workers/order-expiry.ts`, no `catch` do cancel:

```typescript
Sentry.captureMessage('order-expiry: falha ao cancelar a PI do pedido expirado', {
  level: 'warning',
  tags: { kind: 'order-expiry-cancel-failed', provider: 'stripe' },
  extra: { orderId: order.id, providerRef: order.providerRef },
});
```

Em `docs/observability.md`, na seção de alert rules, seguindo exatamente o
formato de "2d. Cart paid after expiry" (linhas 88-95, âncora de 2026-08-29):

```markdown
### 2f. Folha velha pagou apos reabertura

- **Condition:** `tags[kind]:stripe-stale-cart-version`, threshold ≥ 1.
- **Why:** um PaymentSheet antigo confirmou um clientSecret mintado antes de o
  carrinho ser reaberto. A API reembolsa sozinha. O alerta existe porque o
  estoque pode ja ter sido revendido para outra pessoa, e alguem precisa falar
  com quem pagou. Volume alto significa que o cancelamento da PI em
  handleCartFailure parou de funcionar.

### 2g. Assinatura nativa sem segredo de confirmacao

- **Condition:** `tags[kind]:premium-native-subscription-no-secret`, threshold ≥ 1.
- **Why:** a Stripe criou a assinatura mas a primeira fatura voltou sem
  `confirmation_secret`. O membro recebe 503 e nao consegue assinar pelo app.
  Causa tipica: o `expand` de `latest_invoice.confirmation_secret` caiu num
  refactor, ou o price esta configurado com valor zero.

### 2h. Falha ao cancelar PI de pedido expirado

- **Condition:** `tags[kind]:order-expiry-cancel-failed` em 1 hora, threshold ≥ 5.
- **Why:** uma ocorrencia isolada e normal: a Stripe 400a o cancel de uma PI que
  ela propria ja fechou. Cinco em uma hora significa que a chave Stripe perdeu
  permissao ou que os refs do banco apontam para o outro modo.
```

Em `docs/stripe.md`, registrar as duas rotas novas, `flow: native` no checkout de
carrinho e `POST /api/me/premium/checkout-native`, com a observação de que
`receipt_email` é derivado do servidor.

- [ ] **Step 4: Rodar tudo**

Run: `cd apps/api && pnpm exec vitest run test/billing/premium-native-sentry-tags.test.ts`
Expected: PASS.

Run: `pnpm --filter @ccc/api test`
Expected: PASS. Docker precisa estar rodando para os Testcontainers.

Run: `pnpm --filter @ccc/shared test`
Expected: PASS.

Run: `pnpm --filter @ccc/api lint && pnpm --filter @ccc/shared lint && pnpm --filter @ccc/db lint`
Expected: PASS. Não rodar `eslint .` na raiz; ele estoura memória.

Run: `pnpm --filter @ccc/api typecheck`
Expected: PASS. É aqui que um `invoice.payment_intent` acidental aparece.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src docs/ apps/api/test/billing/premium-native-sentry-tags.test.ts
git commit -m "feat(api): tags de Sentry dos modos de falha novos, mais docs"
```

---

## Notas para quem executa

- A regra que não se negocia: **nada** neste plano pode adicionar `incomplete` ao
  enum `PremiumMembershipStatus`, e **nada** pode colocar índice único parcial em
  `PremiumMembership`. Se uma task parecer mais simples fazendo isso, ela está
  errada. Ler `apps/api/src/services/billing/apply-membership-event.ts:97` de
  novo antes de tentar.
- `app.ts:95` não seta `trustProxy`. Todo limite deste plano é chaveado no `sub`
  autenticado justamente por isso. Não trocar por `req.ip` em nenhuma das rotas
  novas. Resolver `trustProxy` é trabalho à parte, já registrado nos follow-ups
  do ESP32.
- A Task 3 acrescenta `cartVersion` na metadata e a Task 6 depende disso.
  Executá-las fora de ordem entrega uma guarda que nunca dispara.
- As Tasks 5, 6 e 7 são as três corridas da Decisão 5 e se sustentam mutuamente.
  A 5 fecha o caso comum, a 6 é a rede quando a 5 não pega, e a 7 é o gatilho que
  não existia. Não mergear parcialmente.
- Comando de teste é sempre `cd apps/api && pnpm exec vitest run test/<caminho>`.
  `pnpm --filter @ccc/api test -- <arquivo>` não filtra: o `--` é engolido e a
  suíte inteira roda.
- Números de linha citados são âncoras de 2026-08-29. Ler o arquivo antes de
  editar; eles podem ter andado.
