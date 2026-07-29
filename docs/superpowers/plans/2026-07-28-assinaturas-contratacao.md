# Assinaturas — contratação, módulos, cancelamento e histórico (plano de implementação)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o módulo de assinaturas multi-tier: contratação real com módulos opcionais em um único checkout, cancelamento pelo membro, histórico de cobranças e correção do `tierFromPrice()` hardcoded.

**Architecture:** Checkout multi-line-item numa Stripe Checkout Session em `mode: 'subscription'`. O normalizer do webhook devolve as linhas cruas da fatura e deixa `tier`, `baseAmountCents` e `devFeePercent` como placeholder. A rota do webhook resolve essas linhas contra o catálogo no banco, que é a fonte da verdade, e patcha o evento antes de despachar. Estado de assinatura só muda por webhook verificado: a rota de cancelamento fala com o Stripe e não escreve no banco.

**Tech Stack:** Fastify, Prisma, Postgres, Zod, Stripe SDK (`2026-04-22.dahlia`), Vitest, Testcontainers, Expo/React Native, expo-router.

**Spec:** `docs/superpowers/specs/2026-07-28-assinaturas-contratacao-design.md`
**Canon:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §F8.1–§F8.16

## Global Constraints

- Branch de trabalho: `feat/rebrand-ccc-app-sweep`. Nunca commitar em `production`.
- Zero migrations. Nenhuma alteração em `packages/db/prisma/schema.prisma`.
- Depois de qualquer mudança em `packages/shared`: `pnpm --filter @ccc/shared build`. Canon §F8.13.
- Nunca `npx turbo run build --force`. Buildar sequencialmente: `design` → `db` → `shared` → `api` → `admin`.
- `pnpm lint` na raiz estoura heap. Lintar por pacote.
- Testes de API usam Postgres real via Testcontainers. Nunca mock de banco.
- Filtrar teste é `pnpm --filter @ccc/api test <padrão>`, **sem `--`**. Com `--` o vitest recebe o literal e roda a suite inteira: 214 arquivos, 1932 testes, cerca de 12 minutos. Medido em 2026-07-28.
- O `pretest` do `@ccc/api` roda `prisma generate`, que renomeia `node_modules/.prisma/client/query_engine-windows.dll.node`. Nenhum outro processo Node pode ter essa DLL carregada. Na prática: o dev server da API precisa estar parado e nunca pode haver duas suites rodando ao mesmo tempo. Se houver, o teste morre com `EPERM: operation not permitted, rename` antes de rodar uma única asserção, e isso não é erro de código.
- `resetDatabase()` não limpa `PremiumPlan` nem `PremiumAddonModule`. Cada arquivo de teste declara seu próprio `resetCatalog()`.
- Estado de assinatura só muda por webhook verificado. Nenhuma rota de cliente escreve `PremiumMembership.status`.
- Canon §F8.5: quem chama `applyMembershipEvent` já fez `SELECT id FROM "Garage" WHERE id = $garageId FOR UPDATE` na mesma transação.
- Canon §F8.6: exatamente um `awardXp` por transação.
- Respostas de cliente nunca expõem `providerInvoiceRef`, `providerTransactionRef`, `stripePriceId` nem `providerItemRef`.
- Copy do mobile em PT-BR, centralizada em `apps/mobile/src/copy/assinaturas.ts`. Sem string solta em tela.
- iOS nunca chama Stripe. Lint rule `apps/mobile/eslint-rules/no-stripe-on-ios.cjs`.
- Todo dinheiro em centavos, inteiro. Moeda `'BRL'`.

---

## Estrutura de arquivos

**Criar**
- `apps/api/test/billing/premium-cancel.test.ts`
- `apps/api/test/billing/premium-invoices.test.ts`
- `apps/api/test/billing/premium-checkout-addons.test.ts`
- `apps/api/test/billing/normalize-stripe-lines.test.ts`
- `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx`
- `apps/mobile/src/screens/assinaturas/package-total.ts`
- `apps/mobile/src/screens/assinaturas/package-total.test.ts`
- `apps/mobile/src/screens/assinaturas/poll-subscription.ts`
- `apps/mobile/src/screens/assinaturas/checkout.test.ts`
- `apps/mobile/src/screens/assinaturas/TierCta.tsx`
- `apps/mobile/src/hooks/usePremiumInvoices.ts`
- `apps/mobile/app/(app)/assinaturas/contratar.tsx`
- `apps/mobile/app/(app)/assinaturas/checkout-return.tsx`

**Modificar**
- `packages/shared/src/premium.ts` — `addonKeys`, enum de tier
- `packages/shared/src/premium-subscription.ts` — `benefits`, `planDescription`, schema de invoices
- `apps/api/src/services/stripe/index.ts` — `priceIds`, `cancelSubscriptionAtPeriodEnd`, `expireCheckoutSession`
- `apps/api/src/services/stripe/fake.ts` — os três acima
- `apps/api/src/services/billing/types.ts` — `BillingLine`, `BillingAddonLine`
- `apps/api/src/services/billing/normalize-stripe.ts` — remover `tierFromPrice`, emitir `lines`
- `apps/api/src/services/billing/apply-membership-event.ts` — add-ons na tx de ativação
- `apps/api/src/routes/me-premium.ts` — checkout, cancel, invoices, rate limit, urls de retorno
- `apps/api/src/routes/me-premium-addons.ts` — `benefits` e `planDescription`
- `apps/api/src/routes/stripe-billing-webhook.ts` — resolução das linhas contra o catálogo
- `apps/api/test/billing/stripe-billing-webhook.test.ts` — casos multi-line
- `packages/ui/src/SheetShell.tsx` — props de tema opcionais
- `apps/mobile/src/copy/assinaturas.ts`
- `apps/mobile/src/api/premium.ts`
- `apps/mobile/src/api/premium-catalog.ts`
- `apps/mobile/src/screens/assinaturas/checkout.ts`
- `apps/mobile/src/screens/assinaturas/PlanosScreen.tsx`
- `apps/mobile/src/screens/assinaturas/PlanoDetalheScreen.tsx`
- `apps/mobile/src/screens/assinaturas/MinhaAssinaturaScreen.tsx`
- `apps/mobile/app/(app)/profile/index.tsx`
- `docs/stripe.md`

---

## Task 0: Confirmação de banco

**Files:**
- Nenhum. Esta task não escreve código.

**Interfaces:**
- Consumes: nada.
- Produces: confirmação escrita de que nenhuma migration é necessária.

- [ ] **Step 1: Verificar campo a campo**

Ler `packages/db/prisma/schema.prisma` e confirmar que cada requisito abaixo já tem tabela:

| Requisito | Tabela |
|---|---|
| Módulos no checkout | `PremiumMembershipAddon` + `PremiumAddonUsage` |
| Cancelamento | `PremiumMembership.cancelAtPeriodEnd`, `.cancelledAt`, status `cancel_scheduled` |
| Histórico de cobranças | `PremiumMembershipInvoice` |
| Benefícios em Minha Assinatura | `PremiumPlanBenefit` |

Confirmar também que `PremiumMembershipAddon` tem `@@unique([membershipId, addonKey])` sem filtro de status. Esse é o motivo do upsert da Task 7.

- [ ] **Step 2: Registrar**

Escrever a confirmação na resposta ao orquestrador. Não criar migration. Não alterar o schema. Se algum campo da tabela acima não existir, PARAR e reportar: o spec assume zero migrations e essa premissa precisa ser revista antes de qualquer código.

- [ ] **Step 3: Confirmar que a árvore está limpa**

Run: `git diff --stat packages/db`
Expected: vazio.

---

## Task 1: Schemas compartilhados

**Files:**
- Modify: `packages/shared/src/premium.ts:15-18`, `packages/shared/src/premium.ts:65`
- Modify: `packages/shared/src/premium-subscription.ts:39-52`

**Interfaces:**
- Consumes: nada.
- Produces: `premiumCheckoutRequestSchema` com `addonKeys?: string[]`; `premiumStatusSchema.tier` aceitando os três tiers; `mySubscriptionResponseSchema` com `benefits: string[]` e `planDescription: string | null`; `premiumInvoiceSchema` e `premiumInvoicesResponseSchema` exportados de `@ccc/shared/premium-subscription`.

- [ ] **Step 1: Ampliar `premiumCheckoutRequestSchema` e o enum de tier**

Em `packages/shared/src/premium.ts`, substituir o bloco de `premiumCheckoutRequestSchema`:

```ts
/**
 * POST /api/me/premium/checkout — request body.
 * Client sends cadence; server resolves priceId server-side (never trusts
 * client-supplied Stripe price IDs). `planSlug` is optional and additive.
 * `addonKeys` are add-on module keys resolved against the catalog server-side —
 * the client never sends prices. Max 10 keeps the Checkout Session line-item
 * count bounded.
 */
export const premiumCheckoutRequestSchema = z.object({
  cadence: z.enum(['monthly', 'annual']),
  planSlug: z.string().min(1).max(40).optional(),
  addonKeys: z.array(z.string().min(1).max(40)).max(10).optional(),
});
```

Na linha 65, trocar:

```ts
  /** Current premium tier. null when no active entitlement. */
  tier: z.enum(['bronze', 'silver', 'gold']).nullable(),
```

- [ ] **Step 2: Adicionar `benefits`, `planDescription` e o schema de invoices**

Em `packages/shared/src/premium-subscription.ts`, dentro de `mySubscriptionResponseSchema`, depois de `planName`:

```ts
  planDescription: z.string().nullable(),
```

E depois de `addons`:

```ts
  benefits: z.array(z.string()),
```

No fim do arquivo, adicionar:

```ts
/**
 * GET /api/me/premium/invoices — one billing charge as the member sees it.
 * Provider refs (providerInvoiceRef / providerTransactionRef) are NEVER
 * serialized here. `status` mirrors the free-form DB column.
 */
export const premiumInvoiceSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  paidAt: z.string().datetime(),
  grossAmountCents: z.number().int().nonnegative(),
  currency: z.string(),
  status: z.string(),
  refundedAt: z.string().datetime().nullable(),
});

export type PremiumInvoice = z.infer<typeof premiumInvoiceSchema>;

/** GET /api/me/premium/invoices — response. Newest first, capped at 24. */
export const premiumInvoicesResponseSchema = z.object({
  invoices: z.array(premiumInvoiceSchema),
});

export type PremiumInvoicesResponse = z.infer<typeof premiumInvoicesResponseSchema>;
```

- [ ] **Step 3: Buildar o pacote compartilhado**

Run: `pnpm --filter @ccc/shared build`
Expected: build sem erro. Canon §F8.13.

- [ ] **Step 4: Verificar que nada quebrou**

Run: `pnpm --filter @ccc/api typecheck`
Expected: PASS. Se alguma rota reclamar dos campos novos obrigatórios em `mySubscriptionResponseSchema`, é esperado. Anotar e corrigir na Task 8, não aqui.

Se o typecheck falhar apenas em `apps/api/src/routes/me-premium-addons.ts` por causa de `benefits` e `planDescription` faltando, seguir mesmo assim: a Task 8 fecha isso.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/premium.ts packages/shared/src/premium-subscription.ts
git commit -m "feat(shared): addonKeys no checkout, tier multi-valor e schema de invoices"
```

---

## Task 2: Rota de cancelamento

**Files:**
- Modify: `apps/api/src/services/stripe/index.ts` (tipos + `StripeClient` + impl real)
- Modify: `apps/api/src/services/stripe/fake.ts`
- Modify: `apps/api/src/routes/me-premium.ts`
- Test: `apps/api/test/billing/premium-cancel.test.ts`

**Interfaces:**
- Consumes: `LIVE_STATUSES` e `APPLE_MANAGE_URL` de `me-premium.ts:34,40`.
- Produces: `StripeClient.cancelSubscriptionAtPeriodEnd(input: { subscriptionId: string; idempotencyKey: string }) => Promise<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: Date }>`; `FakeStripe.nextCancelledSubscription`; rota `POST /api/me/premium/cancel`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/billing/premium-cancel.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedMembership = async (
  garageId: string,
  overrides: Partial<{ provider: 'stripe' | 'apple_revenuecat'; status: string }> = {},
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: overrides.provider ?? 'stripe',
      providerCustomerRef: 'cus_cancel_1',
      providerSubRef: 'sub_cancel_1',
      tier: 'gold',
      cadence: 'monthly',
      status: (overrides.status ?? 'active') as 'active',
      currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      baseAmountCents: 149000,
      devFeePercent: 10,
      devFeeAmountCents: 14900,
      grossAmountCents: 163900,
      currency: 'BRL',
    },
  });

describe('POST /api/me/premium/cancel', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects an unauthenticated request', async () => {
    const { app } = await makeAppWithFakeStripe();
    const res = await app.inject({ method: 'POST', url: '/api/me/premium/cancel' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('404s when there is no live membership', async () => {
    const { app } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'nolive@jdm.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/cancel',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('calls Stripe with cancel_at_period_end and does NOT write the DB', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'cancel@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const membership = await seedMembership(garage.id);
    stripe.nextCancelledSubscription = {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/cancel',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    });

    const call = stripe.calls.find((c) => c.kind === 'cancelSubscriptionAtPeriodEnd');
    expect(call?.payload).toEqual({
      subscriptionId: 'sub_cancel_1',
      idempotencyKey: `cancel_sub_${membership.id}`,
    });

    // Invariant: only the verified webhook mutates subscription state.
    const after = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(after.status).toBe('active');
    expect(after.cancelAtPeriodEnd).toBe(false);
    expect(after.cancelledAt).toBeNull();

    await app.close();
  });

  it('409s with the App Store manage url for an Apple membership', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'apple@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, { provider: 'apple_revenuecat' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/cancel',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'NotStripeSubscription',
      provider: 'apple_revenuecat',
      manageUrl: 'https://apps.apple.com/account/subscriptions',
    });
    expect(stripe.calls.some((c) => c.kind === 'cancelSubscriptionAtPeriodEnd')).toBe(false);

    await app.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test premium-cancel`
Expected: FAIL. A rota não existe, então o primeiro caso volta 404 em vez de 401 e o resto quebra em `stripe.nextCancelledSubscription` indefinido.

- [ ] **Step 3: Adicionar o método ao cliente Stripe**

Em `apps/api/src/services/stripe/index.ts`, junto dos outros tipos de input:

```ts
/**
 * Schedule cancellation at the end of the current paid period. Never cancels
 * immediately: canon §F8.10 keeps entitlement alive until periodEnd. The DB is
 * written by the resulting customer.subscription.updated webhook, not here.
 */
export type CancelSubscriptionAtPeriodEndInput = {
  subscriptionId: string;
  idempotencyKey: string;
};

export type CancelSubscriptionAtPeriodEndResult = {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date;
};
```

Dentro de `StripeClient`, depois de `retrieveSubscription`:

```ts
  cancelSubscriptionAtPeriodEnd: (
    input: CancelSubscriptionAtPeriodEndInput,
  ) => Promise<CancelSubscriptionAtPeriodEndResult>;
```

Na implementação real de `buildStripe`, junto das outras funções de subscription:

```ts
    cancelSubscriptionAtPeriodEnd: async ({ subscriptionId, idempotencyKey }) => {
      const sub = await stripe.subscriptions.update(
        subscriptionId,
        { cancel_at_period_end: true },
        { idempotencyKey },
      );
      return {
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
      };
    },
```

- [ ] **Step 4: Adicionar ao FakeStripe**

Em `apps/api/src/services/stripe/fake.ts`, acrescentar `'cancelSubscriptionAtPeriodEnd'` à união `FakeCall['kind']`, importar os dois tipos novos de `./index.js` e adicionar ao tipo `FakeStripe`:

```ts
  /** Next payload returned by cancelSubscriptionAtPeriodEnd. */
  nextCancelledSubscription: CancelSubscriptionAtPeriodEndResult;
```

No objeto `fake`, junto dos outros defaults:

```ts
    nextCancelledSubscription: {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
    },
```

E o método:

```ts
    // eslint-disable-next-line @typescript-eslint/require-await
    cancelSubscriptionAtPeriodEnd: async (
      input: CancelSubscriptionAtPeriodEndInput,
    ): Promise<CancelSubscriptionAtPeriodEndResult> => {
      fake.calls.push({ kind: 'cancelSubscriptionAtPeriodEnd', payload: input });
      return fake.nextCancelledSubscription;
    },
```

- [ ] **Step 5: Escrever a rota**

Em `apps/api/src/routes/me-premium.ts`, depois do handler de `billing-portal`:

```ts
  /**
   * POST /api/me/premium/cancel
   *
   * Schedules cancellation at period end on Stripe and returns immediately.
   * Deliberately does NOT touch the DB: the resulting
   * customer.subscription.updated webhook normalizes to subscription.cancelled
   * and handleCancelled writes the row. Keeps the invariant that subscription
   * state only changes through a verified webhook.
   */
  app.post('/api/me/premium/cancel', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
    }

    const { sub } = requireUser(request);

    const garage = await prisma.garage.findUnique({
      where: { userId: sub },
      select: { id: true },
    });
    if (!garage) {
      return reply.status(404).send({ error: 'NotFound', message: 'no live membership' });
    }

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId: garage.id, status: { in: [...LIVE_STATUSES] } },
      select: { id: true, provider: true, providerSubRef: true },
    });
    if (!membership) {
      return reply.status(404).send({ error: 'NotFound', message: 'no live membership' });
    }

    if (membership.provider !== 'stripe') {
      return reply.status(409).send({
        error: 'NotStripeSubscription',
        provider: membership.provider,
        manageUrl: APPLE_MANAGE_URL,
      });
    }

    const result = await app.stripe.cancelSubscriptionAtPeriodEnd({
      subscriptionId: membership.providerSubRef,
      idempotencyKey: `cancel_sub_${membership.id}`,
    });

    return reply.status(200).send({
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      currentPeriodEnd: result.currentPeriodEnd.toISOString(),
    });
  });
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test premium-cancel`
Expected: PASS, 4 testes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/stripe/index.ts apps/api/src/services/stripe/fake.ts apps/api/src/routes/me-premium.ts apps/api/test/billing/premium-cancel.test.ts
git commit -m "feat(api): POST /api/me/premium/cancel agenda cancelamento no fim do periodo"
```

---

## Task 3: Rota de histórico de cobranças

**Files:**
- Modify: `apps/api/src/routes/me-premium.ts`
- Test: `apps/api/test/billing/premium-invoices.test.ts`

**Interfaces:**
- Consumes: `premiumInvoicesResponseSchema` de `@ccc/shared/premium-subscription` (Task 1).
- Produces: rota `GET /api/me/premium/invoices`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/billing/premium-invoices.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedMembership = (garageId: string, subRef: string) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: `cus_${subRef}`,
      providerSubRef: subRef,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      baseAmountCents: 149000,
      devFeePercent: 10,
      devFeeAmountCents: 14900,
      grossAmountCents: 163900,
      currency: 'BRL',
    },
  });

const seedInvoice = (membershipId: string, ref: string, monthIso: string) =>
  prisma.premiumMembershipInvoice.create({
    data: {
      membershipId,
      provider: 'stripe',
      providerInvoiceRef: ref,
      periodStart: new Date(monthIso),
      periodEnd: new Date(monthIso),
      baseAmountCents: 149000,
      devFeePercent: 10,
      devFeeAmountCents: 14900,
      grossAmountCents: 163900,
      currency: 'BRL',
      paidAt: new Date(monthIso),
      status: 'paid',
    },
  });

describe('GET /api/me/premium/invoices', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns an empty list when there are no invoices', async () => {
    const { app } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'empty@jdm.test' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/invoices',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ invoices: [] });
    await app.close();
  });

  it('orders newest first and never leaks provider refs', async () => {
    const { app } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'hist@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const membership = await seedMembership(garage.id, 'sub_hist_1');
    await seedInvoice(membership.id, 'in_may', '2026-05-01T00:00:00.000Z');
    await seedInvoice(membership.id, 'in_july', '2026-07-01T00:00:00.000Z');
    await seedInvoice(membership.id, 'in_june', '2026-06-01T00:00:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/invoices',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { invoices: Array<{ periodStart: string }> };
    expect(body.invoices.map((i) => i.periodStart)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
    ]);
    expect(res.payload).not.toContain('in_july');
    expect(res.payload).not.toContain('providerInvoiceRef');
    await app.close();
  });

  it('does not leak another user invoices', async () => {
    const { app } = await makeAppWithFakeStripe();
    const { user: a } = await createUser({ email: 'a@jdm.test' });
    const { user: b } = await createUser({ email: 'b@jdm.test' });
    const garageB = await prisma.garage.findUniqueOrThrow({ where: { userId: b.id } });
    const membershipB = await seedMembership(garageB.id, 'sub_hist_b');
    await seedInvoice(membershipB.id, 'in_b', '2026-07-01T00:00:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/invoices',
      headers: { authorization: bearer(env, a.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ invoices: [] });
    await app.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test premium-invoices`
Expected: FAIL com 404 em todos os casos. A rota não existe.

- [ ] **Step 3: Escrever a rota**

Em `apps/api/src/routes/me-premium.ts`, adicionar `premiumInvoicesResponseSchema` ao import de `@ccc/shared/premium-subscription` (criar o import se ainda não houver) e escrever o handler depois de `cancel`:

```ts
  /**
   * GET /api/me/premium/invoices
   *
   * Billing history as the member sees it. Reads every membership row of the
   * user's garage (expired rows accumulate as history), newest first, capped
   * at 24. Provider refs are never serialized.
   */
  app.get('/api/me/premium/invoices', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
    }

    const { sub } = requireUser(request);

    const garage = await prisma.garage.findUnique({
      where: { userId: sub },
      select: { id: true },
    });
    if (!garage) {
      return reply.status(200).send(premiumInvoicesResponseSchema.parse({ invoices: [] }));
    }

    const rows = await prisma.premiumMembershipInvoice.findMany({
      where: { membership: { garageId: garage.id } },
      orderBy: { periodStart: 'desc' },
      take: 24,
      select: {
        periodStart: true,
        periodEnd: true,
        paidAt: true,
        grossAmountCents: true,
        currency: true,
        status: true,
        refundedAt: true,
      },
    });

    return reply.status(200).send(
      premiumInvoicesResponseSchema.parse({
        invoices: rows.map((r) => ({
          periodStart: r.periodStart.toISOString(),
          periodEnd: r.periodEnd.toISOString(),
          paidAt: r.paidAt.toISOString(),
          grossAmountCents: r.grossAmountCents,
          currency: r.currency,
          status: r.status,
          refundedAt: r.refundedAt ? r.refundedAt.toISOString() : null,
        })),
      }),
    );
  });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test premium-invoices`
Expected: PASS, 3 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me-premium.ts apps/api/test/billing/premium-invoices.test.ts
git commit -m "feat(api): GET /api/me/premium/invoices com historico de cobrancas"
```

---

## Task 4: Checkout multi-line-item com módulos

**Files:**
- Modify: `apps/api/src/services/stripe/index.ts` (`priceIds`, `expireCheckoutSession`)
- Modify: `apps/api/src/services/stripe/fake.ts`
- Modify: `apps/api/src/routes/me-premium.ts:242-262`
- Test: `apps/api/test/billing/premium-checkout-addons.test.ts`

**Interfaces:**
- Consumes: `premiumCheckoutRequestSchema` com `addonKeys` (Task 1).
- Produces: `CreateSubscriptionCheckoutSessionInput.priceIds: string[]` no lugar de `priceId`; `StripeClient.expireCheckoutSession(sessionId: string) => Promise<void>`; idempotency key no formato `checkout_sub_{garageId}_{cadence}_{planSlugOuTier}_{digest}`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/billing/premium-checkout-addons.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const resetCatalog = async () => {
  await prisma.premiumAddonModule.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlan.deleteMany();
};

const seedPlan = async (stripePriceId: string | null) => {
  const plan = await prisma.premiumPlan.create({
    data: { tier: 'gold', slug: 'fundador', name: 'Fundador', active: true, sortOrder: 0 },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: plan.id,
      cadence: 'monthly',
      baseAmountCents: 149000,
      currency: 'BRL',
      stripePriceId,
      active: true,
    },
  });
  return plan;
};

const seedModule = (key: string, stripePriceId: string | null) =>
  prisma.premiumAddonModule.create({
    data: {
      key,
      name: key,
      description: `modulo ${key}`,
      monthlyDeltaCents: 15000,
      currency: 'BRL',
      quotaPerCycle: 3,
      quotaUnit: 'access',
      active: true,
      stripePriceId,
    },
  });

describe('POST /api/me/premium/checkout with add-ons', () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sends line items as [plan, ...modules] in order', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    await seedModule('detailing', 'price_addon_detailing');
    await seedModule('oficina', 'price_addon_oficina');
    const { user } = await createUser({ email: 'lines@jdm.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['oficina', 'detailing'] },
    });

    expect(res.statusCode).toBe(201);
    const call = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    const payload = call?.payload as { priceIds: string[] };
    expect(payload.priceIds[0]).toBe('price_plan_gold');
    expect(payload.priceIds.slice(1).sort()).toEqual([
      'price_addon_detailing',
      'price_addon_oficina',
    ]);
    await app.close();
  });

  it('503s listing the module keys missing a stripePriceId', async () => {
    const { app } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    await seedModule('detailing', null);
    const { user } = await createUser({ email: 'nolabel@jdm.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['detailing'] },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: 'ServiceUnavailable',
      missingAddonKeys: ['detailing'],
    });
    await app.close();
  });

  it('400s on an unknown add-on key', async () => {
    const { app } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    const { user } = await createUser({ email: 'unknown@jdm.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['inexistente'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest', unknownAddonKeys: ['inexistente'] });
    await app.close();
  });

  it('422s when addonKeys exceeds 10 entries', async () => {
    const { app } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    const { user } = await createUser({ email: 'toomany@jdm.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        cadence: 'monthly',
        planSlug: 'fundador',
        addonKeys: Array.from({ length: 11 }, (_, i) => `m${i}`),
      },
    });

    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('derives a different idempotency key per package selection', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    await seedModule('detailing', 'price_addon_detailing');
    const { user } = await createUser({ email: 'idem@jdm.test' });
    const auth = { authorization: bearer(env, user.id) };

    await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: auth,
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: [] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: auth,
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['detailing'] },
    });

    const keys = stripe.calls
      .filter((c) => c.kind === 'createSubscriptionCheckoutSession')
      .map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    await app.close();
  });

  it('expires the open session before creating a new one', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    const { user } = await createUser({ email: 'stale@jdm.test' });
    stripe.nextOpenSubscriptionCheckoutSessions = [
      { id: 'cs_stale_1', url: 'https://checkout.stripe.com/pay/cs_stale_1' },
    ];

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: [] },
    });

    expect(res.statusCode).toBe(201);
    const expireCall = stripe.calls.find((c) => c.kind === 'expireCheckoutSession');
    expect(expireCall?.payload).toEqual({ sessionId: 'cs_stale_1' });
    await app.close();
  });

  it('maps a Stripe session failure to a 503 (R1: mixed interval or currency)', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    await seedModule('detailing', 'price_addon_detailing');
    const { user } = await createUser({ email: 'mixed@jdm.test' });
    stripe.nextCreateSubscriptionCheckoutSessionError = new Error(
      'You cannot combine prices with different recurring intervals',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['detailing'] },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'ServiceUnavailable' });
    await app.close();
  });

  it('points the return urls at the assinaturas module', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    await seedPlan('price_plan_gold');
    const { user } = await createUser({ email: 'urls@jdm.test' });

    await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id) },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    const call = stripe.calls.find((c) => c.kind === 'createSubscriptionCheckoutSession');
    const payload = call?.payload as { successUrl: string; cancelUrl: string };
    expect(payload.successUrl).toBe(`${env.APP_WEB_BASE_URL}/assinaturas/checkout-return`);
    expect(payload.cancelUrl).toBe(`${env.APP_WEB_BASE_URL}/assinaturas`);
    await app.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test premium-checkout-addons`
Expected: FAIL. `priceIds` não existe no payload, `expireCheckoutSession` não existe, as urls ainda apontam para `/premium/success`.

- [ ] **Step 3: Trocar `priceId` por `priceIds` e adicionar `expireCheckoutSession`**

Em `apps/api/src/services/stripe/index.ts`, no tipo `CreateSubscriptionCheckoutSessionInput`, substituir `priceId: string;` por:

```ts
  /**
   * All recurring prices in the session, plan first. Every price MUST share the
   * same interval and currency — Stripe rejects a mixed subscription session.
   */
  priceIds: string[];
```

Dentro de `StripeClient`, depois de `listOpenSubscriptionCheckoutSessions`:

```ts
  /**
   * Expire an open Checkout Session. Used before minting a new subscription
   * session so a member who abandoned checkout and changed their package is
   * not pushed back into the stale one.
   */
  expireCheckoutSession: (sessionId: string) => Promise<void>;
```

Na implementação real, o `line_items` de `createSubscriptionCheckoutSession` (hoje em `:341`) passa a mapear o array:

```ts
          line_items: priceIds.map((price) => ({ price, quantity: 1 })),
```

E o método novo:

```ts
    expireCheckoutSession: async (sessionId: string) => {
      await stripe.checkout.sessions.expire(sessionId);
    },
```

- [ ] **Step 4: Atualizar o FakeStripe**

Em `apps/api/src/services/stripe/fake.ts`, acrescentar `'expireCheckoutSession'` à união `FakeCall['kind']` e o método:

```ts
    // eslint-disable-next-line @typescript-eslint/require-await
    expireCheckoutSession: async (sessionId: string): Promise<void> => {
      fake.calls.push({ kind: 'expireCheckoutSession', payload: { sessionId } });
    },
```

Adicionar também o gancho de falha usado pelo teste do R1. No tipo `FakeStripe`:

```ts
  /** When set, createSubscriptionCheckoutSession throws this error. */
  nextCreateSubscriptionCheckoutSessionError: Error | null;
```

No objeto `fake`, `nextCreateSubscriptionCheckoutSessionError: null,` junto dos outros defaults, e no corpo de `createSubscriptionCheckoutSession`, logo depois do `calls.push`:

```ts
      if (fake.nextCreateSubscriptionCheckoutSessionError) {
        throw fake.nextCreateSubscriptionCheckoutSessionError;
      }
```

- [ ] **Step 5: Reescrever o miolo do handler de checkout**

Em `apps/api/src/routes/me-premium.ts`, acrescentar ao topo do arquivo:

```ts
import { createHash } from 'node:crypto';
```

Trocar a desestruturação em `:142` por:

```ts
      const { cadence, planSlug, addonKeys } = parsed.data;
      const selectedAddonKeys = [...new Set(addonKeys ?? [])].sort();
```

Depois do bloco que resolve `priceId` (que termina em `:189`), inserir a resolução dos módulos:

```ts
      // Resolve add-on prices from the catalog. Unknown/inactive key is a client
      // error (400); a known module with no stripePriceId is an operator
      // misconfiguration (503).
      const addonPriceIds: string[] = [];
      if (selectedAddonKeys.length > 0) {
        const modules = await prisma.premiumAddonModule.findMany({
          where: { key: { in: selectedAddonKeys }, active: true },
          select: { key: true, stripePriceId: true },
        });

        const found = new Set(modules.map((m) => m.key));
        const unknownAddonKeys = selectedAddonKeys.filter((k) => !found.has(k));
        if (unknownAddonKeys.length > 0) {
          return reply
            .status(400)
            .send({ error: 'BadRequest', message: 'unknown add-on key', unknownAddonKeys });
        }

        const missingAddonKeys = modules.filter((m) => !m.stripePriceId).map((m) => m.key);
        if (missingAddonKeys.length > 0) {
          request.log.error(
            { missingAddonKeys },
            'me-premium: checkout requested but add-on stripePriceId not configured',
          );
          return reply.status(503).send({
            error: 'ServiceUnavailable',
            message: 'add-on price not configured',
            missingAddonKeys,
          });
        }

        // Preserve catalog order for a stable session; the plan price stays first.
        for (const key of selectedAddonKeys) {
          const found = modules.find((m) => m.key === key);
          if (found?.stripePriceId) addonPriceIds.push(found.stripePriceId);
        }
      }
```

Substituir o bloco `:242-262` por:

```ts
      // A stale open session holds the previous package. Expire it so the member
      // is not pushed back into a selection they abandoned.
      const openSessions = await app.stripe.listOpenSubscriptionCheckoutSessions(customerId);
      for (const open of openSessions) {
        await app.stripe.expireCheckoutSession(open.id);
      }

      // The key must cover the whole package: same garage + cadence with a
      // different plan or module set is a genuinely different session, and
      // Stripe rejects a reused key carrying different params.
      const packageDigest = createHash('sha1')
        .update([planSlug ?? tier, ...selectedAddonKeys].join('|'))
        .digest('hex')
        .slice(0, 12);
      const idempotencyKey = `checkout_sub_${garage.id}_${cadence}_${packageDigest}`;

      // R1: a multi-line subscription session requires every price to share the
      // same interval and currency. Stripe rejects the mix, and that is an
      // operator catalog problem, not a client error — surface it as 503.
      let session;
      try {
        session = await app.stripe.createSubscriptionCheckoutSession({
          customerId,
          priceIds: [priceId, ...addonPriceIds],
          successUrl: `${app.env.APP_WEB_BASE_URL}/assinaturas/checkout-return`,
          cancelUrl: `${app.env.APP_WEB_BASE_URL}/assinaturas`,
          metadata: { garageId: garage.id, userId: sub, cadence },
          idempotencyKey,
        });
      } catch (err) {
        request.log.error(
          { err, priceIds: [priceId, ...addonPriceIds] },
          'me-premium: stripe rejected the subscription checkout session',
        );
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'could not start checkout' });
      }

      return reply
        .status(201)
        .send(premiumCheckoutResponseSchema.parse({ url: session.url, sessionId: session.id }));
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test premium-checkout-addons`
Expected: PASS, 8 testes.

- [ ] **Step 7: Rodar a suite de billing inteira**

Run: `pnpm --filter @ccc/api test billing`
Expected: PASS. Se algum teste antigo asserta `priceId` no payload da sessão, atualizar para `priceIds` — a troca de contrato é intencional.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/stripe/index.ts apps/api/src/services/stripe/fake.ts apps/api/src/routes/me-premium.ts apps/api/test/billing/premium-checkout-addons.test.ts apps/api/test/billing
git commit -m "feat(api): checkout multi-line-item com modulos e retorno no modulo assinaturas"
```

---

## Task 5: Normalizer devolve as linhas da fatura

**Files:**
- Modify: `apps/api/src/services/billing/types.ts`
- Modify: `apps/api/src/services/billing/normalize-stripe.ts`
- Test: `apps/api/test/billing/normalize-stripe-lines.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `BillingLine`, `BillingAddonLine` em `types.ts`; `subscription.activated` com `lines`, `addons`, `addonsAmountCents`; `subscription.renewed` com `lines`; `subscription.tier_changed` com `priceRef`. `tier`, `baseAmountCents` e `devFeePercent` saem do normalizer como placeholder.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/billing/normalize-stripe-lines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { normalizeStripeEvent } from '../../src/services/billing/normalize-stripe.js';

const invoicePaidEvent = () => ({
  id: 'evt_lines_1',
  type: 'invoice.paid',
  data: {
    object: {
      id: 'in_lines_1',
      subscription: 'sub_lines_1',
      customer: 'cus_lines_1',
      billing_reason: 'subscription_create',
      amount_paid: 164000,
      currency: 'brl',
      period_start: 1767225600,
      period_end: 1769904000,
      status_transitions: { paid_at: 1767225600 },
      lines: {
        data: [
          {
            price: {
              id: 'price_plan_gold',
              metadata: { devFeePercent: '10' },
              recurring: { interval: 'month' },
            },
            amount: 149000,
            subscription_item: 'si_plan',
          },
          {
            price: {
              id: 'price_addon_detailing',
              metadata: {},
              recurring: { interval: 'month' },
            },
            amount: 15000,
            subscription_item: 'si_addon',
          },
        ],
      },
    },
  },
});

describe('normalizeStripeEvent — invoice lines', () => {
  it('carries every invoice line with its price ref, amount and item ref', () => {
    const result = normalizeStripeEvent(invoicePaidEvent());
    expect(result).not.toBeNull();
    if (!result || result.kind !== 'subscription.activated') throw new Error('wrong kind');

    expect(result.lines).toEqual([
      {
        priceRef: 'price_plan_gold',
        amountCents: 149000,
        subscriptionItemRef: 'si_plan',
        metadata: { devFeePercent: '10' },
      },
      {
        priceRef: 'price_addon_detailing',
        amountCents: 15000,
        subscriptionItemRef: 'si_addon',
        metadata: {},
      },
    ]);
  });

  it('leaves tier, baseAmountCents and devFeePercent as placeholders for the route', () => {
    const result = normalizeStripeEvent(invoicePaidEvent());
    if (!result || result.kind !== 'subscription.activated') throw new Error('wrong kind');

    expect(result.tier).toBe('bronze');
    expect(result.pricing.baseAmountCents).toBe(0);
    expect(result.pricing.devFeePercent).toBe(0);
    expect(result.addons).toEqual([]);
    expect(result.addonsAmountCents).toBe(0);
    // grossAmountCents and currency are real — they come from the invoice itself.
    expect(result.pricing.grossAmountCents).toBe(164000);
    expect(result.pricing.currency).toBe('BRL');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test normalize-stripe-lines`
Expected: FAIL. `result.lines` é `undefined` e `tier` volta `'gold'`.

- [ ] **Step 3: Estender os tipos do billing**

Em `apps/api/src/services/billing/types.ts`, no topo, acrescentar `PremiumAddonUnit` ao import de `@prisma/client` e adicionar antes de `BillingEvent`:

```ts
/**
 * One recurring line of a provider invoice, as the normalizer sees it. The
 * normalizer has no DB access, so it cannot say whether a line is the plan or
 * an add-on — the webhook route resolves that against the catalog.
 */
export type BillingLine = {
  priceRef: string;
  amountCents: number;
  subscriptionItemRef: string | null;
  metadata: Record<string, string>;
};

/**
 * An add-on line already resolved against the DB catalog by the webhook route.
 * Price and quota are snapshots: later catalog edits must not retroactively
 * change an attached add-on.
 */
export type BillingAddonLine = {
  addonKey: string;
  providerItemRef: string | null;
  monthlyDeltaCents: number;
  quotaPerCycle: number;
  quotaUnit: PremiumAddonUnit;
  currency: string;
};
```

No membro `subscription.activated`, adicionar:

```ts
      /** Raw invoice lines. Route resolves them against the catalog. */
      lines: BillingLine[];
      /** Resolved by the route; the normalizer always emits []. */
      addons: BillingAddonLine[];
      /** Resolved by the route; the normalizer always emits 0. */
      addonsAmountCents: number;
```

No membro `subscription.renewed`, adicionar:

```ts
      lines: BillingLine[];
```

No membro `subscription.tier_changed`, adicionar:

```ts
      /** The new price id, so the route can tell a plan swap from an add-on swap. */
      priceRef: string;
```

- [ ] **Step 4: Reescrever o normalizer**

Em `apps/api/src/services/billing/normalize-stripe.ts`:

Apagar `tierFromPrice` (`:21-25`) por inteiro.

Substituir `StripeInvoiceLineForPricing` e `pricingFromInvoice` (`:27-54`) por:

```ts
type StripeInvoiceLine = {
  price: { id: string; metadata?: Record<string, string>; recurring?: { interval?: string } };
  amount?: number;
  subscription_item?: string | null;
};

/**
 * Pricing shell from the invoice itself.
 *
 * baseAmountCents / devFeePercent / devFeeAmountCents are PLACEHOLDERS — with a
 * multi-line subscription the normalizer cannot tell which line is the plan.
 * The webhook route resolves the plan line against PremiumPlanPrice and patches
 * these three, exactly as it already patches garageId (see the header comment
 * on normalizeStripeEvent). grossAmountCents and currency are real.
 */
function pricingFromInvoice(invoice: { amount_paid: number; currency: string }) {
  return {
    baseAmountCents: 0,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    grossAmountCents: invoice.amount_paid,
    currency: (invoice.currency ?? 'brl').toUpperCase(),
  };
}

/** Map raw Stripe invoice lines to the provider-neutral BillingLine shape. */
function linesFromInvoice(lines: StripeInvoiceLine[]): BillingLine[] {
  return lines.map((line) => ({
    priceRef: line.price.id,
    amountCents: line.amount ?? 0,
    subscriptionItemRef: line.subscription_item ?? null,
    metadata: line.price.metadata ?? {},
  }));
}
```

Adicionar `BillingLine` ao import de `./types.js`.

No ramo `invoice.paid`, trocar o tipo de `lines` em ambos os lugares para `{ data: StripeInvoiceLine[] }`, e depois de `const pricing = pricingFromInvoice(invoice);` inserir:

```ts
    const lines = linesFromInvoice(invoice.lines.data);
```

Trocar `const tier = tierFromPrice(linePrice.metadata ?? {});` por:

```ts
    // Placeholder — the route patches this from the catalog, like garageId.
    const tier = 'bronze' as const;
```

No objeto de `subscription.activated`, adicionar `lines,`, `addons: [],` e `addonsAmountCents: 0,`. No de `subscription.renewed`, adicionar `lines,`.

No ramo `tier_changed` (`:198-222`), trocar as três linhas de metadata por placeholders e carregar o `priceRef`:

```ts
      const currentPrice = sub.items.data[0]!.price;
      const cadence = cadenceFromInterval(currentPrice.recurring?.interval);
      return {
        kind: 'subscription.tier_changed',
        provider: 'stripe',
        providerSubRef: sub.id,
        priceRef: currentPrice.id,
        // Placeholders — the route resolves tier + pricing from the catalog and
        // drops the event entirely when the swapped price is an add-on.
        tier: 'bronze',
        cadence,
        pricing: {
          baseAmountCents: 0,
          devFeePercent: 0,
          devFeeAmountCents: 0,
          grossAmountCents: 0,
          currency: 'BRL',
        },
      } satisfies BillingEvent & { kind: 'subscription.tier_changed' };
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test normalize-stripe-lines`
Expected: PASS, 2 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/billing/types.ts apps/api/src/services/billing/normalize-stripe.ts apps/api/test/billing/normalize-stripe-lines.test.ts
git commit -m "fix(api): normalizer devolve linhas da fatura e remove tierFromPrice hardcoded"
```

Nota: `pnpm --filter @ccc/api typecheck` vai falhar aqui, na rota do webhook e em `apply-membership-event`, porque os campos novos são obrigatórios. As Tasks 6 e 7 fecham isso. É o único ponto do plano onde o typecheck fica vermelho entre tasks.

---

## Task 6: Webhook resolve as linhas contra o catálogo

**Files:**
- Modify: `apps/api/src/routes/stripe-billing-webhook.ts:265-320`
- Test: `apps/api/test/billing/stripe-billing-webhook.test.ts`

**Interfaces:**
- Consumes: `BillingLine`, `BillingAddonLine` (Task 5).
- Produces: `BillingEvent` totalmente resolvido antes de `applyMembershipEvent`. Nenhuma exportação nova.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/test/billing/stripe-billing-webhook.test.ts`, adicionar ao final. Reusar os helpers já presentes no arquivo (`rawJson`, `buildBillingApp`), e declarar as fixtures de catálogo localmente:

```ts
describe('multi-line invoice resolution', () => {
  const seedCatalog = async () => {
    await prisma.premiumAddonModule.deleteMany();
    await prisma.premiumPlanPrice.deleteMany();
    await prisma.premiumPlan.deleteMany();
    const plan = await prisma.premiumPlan.create({
      data: { tier: 'silver', slug: 'estrada', name: 'Estrada', active: true, sortOrder: 0 },
    });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: plan.id,
        cadence: 'monthly',
        baseAmountCents: 89000,
        currency: 'BRL',
        stripePriceId: 'price_plan_silver',
        active: true,
      },
    });
    await prisma.premiumAddonModule.create({
      data: {
        key: 'detailing',
        name: 'Detailing',
        description: 'Lavagem detalhada',
        monthlyDeltaCents: 15000,
        currency: 'BRL',
        quotaPerCycle: 3,
        quotaUnit: 'access',
        active: true,
        stripePriceId: 'price_addon_detailing',
      },
    });
  };

  it('takes tier and baseAmountCents from the catalog, not from price metadata', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'multiline@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_ml_1', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_ml_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_ml_1',
          subscription: 'sub_ml_1',
          customer: 'cus_ml_1',
          billing_reason: 'subscription_create',
          amount_paid: 113900,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                price: {
                  id: 'price_plan_silver',
                  metadata: { devFeePercent: '10' },
                  recurring: { interval: 'month' },
                },
                amount: 89000,
                subscription_item: 'si_plan_1',
              },
              {
                price: {
                  id: 'price_addon_detailing',
                  metadata: {},
                  recurring: { interval: 'month' },
                },
                amount: 15000,
                subscription_item: 'si_addon_1',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });

    expect(res.statusCode).toBe(200);
    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_ml_1' } },
    });
    expect(membership.tier).toBe('silver');
    expect(membership.baseAmountCents).toBe(89000);
    expect(membership.devFeePercent).toBe(10);
    expect(membership.devFeeAmountCents).toBe(8900);
    await app.close();
  });
});
```

O `addonsAmountCents` e as linhas de `PremiumMembershipAddon` ficam para a Task 7: são escrita, não resolução.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test stripe-billing-webhook`
Expected: FAIL. `tier` volta `'bronze'` (o placeholder) e `baseAmountCents` volta 0.

- [ ] **Step 3: Escrever a resolução na rota**

Em `apps/api/src/routes/stripe-billing-webhook.ts`, adicionar ao import de `../services/billing/types.js`:

```ts
import type { BillingAddonLine, BillingEvent, BillingLine } from '../services/billing/types.js';
```

Adicionar, antes de `export const stripeBillingWebhookRoutes`:

```ts
/**
 * Resolve raw provider invoice lines against the DB catalog.
 *
 * The catalog is the source of truth for tier and base amount — NOT Stripe
 * Price metadata, which cannot be trusted to stay in sync and which the old
 * tierFromPrice() hardcoded to 'gold'. devFeePercent is the one value still
 * read from metadata (canon §F8.1), and only from the plan line.
 */
const resolveLinesAgainstCatalog = async (lines: BillingLine[]) => {
  const priceRefs = lines.map((l) => l.priceRef);

  const [planPrices, addonModules] = await Promise.all([
    prisma.premiumPlanPrice.findMany({
      where: { stripePriceId: { in: priceRefs } },
      select: { stripePriceId: true, baseAmountCents: true, plan: { select: { tier: true } } },
    }),
    prisma.premiumAddonModule.findMany({
      where: { stripePriceId: { in: priceRefs } },
      select: {
        key: true,
        stripePriceId: true,
        monthlyDeltaCents: true,
        quotaPerCycle: true,
        quotaUnit: true,
        currency: true,
      },
    }),
  ]);

  const planLine = lines.find((l) => planPrices.some((p) => p.stripePriceId === l.priceRef));
  const planPrice = planLine
    ? planPrices.find((p) => p.stripePriceId === planLine.priceRef)
    : undefined;

  const addons: BillingAddonLine[] = [];
  let addonsAmountCents = 0;
  for (const line of lines) {
    const mod = addonModules.find((m) => m.stripePriceId === line.priceRef);
    if (!mod) continue;
    addons.push({
      addonKey: mod.key,
      providerItemRef: line.subscriptionItemRef,
      monthlyDeltaCents: mod.monthlyDeltaCents,
      quotaPerCycle: mod.quotaPerCycle,
      quotaUnit: mod.quotaUnit,
      currency: mod.currency,
    });
    addonsAmountCents += line.amountCents;
  }

  const devFeePercent = parseInt(planLine?.metadata.devFeePercent ?? '0', 10);
  const baseAmountCents = planPrice?.baseAmountCents ?? 0;

  return {
    tier: planPrice?.plan.tier ?? null,
    baseAmountCents,
    devFeePercent,
    devFeeAmountCents: Math.round((baseAmountCents * devFeePercent) / 100),
    addons,
    addonsAmountCents,
  };
};
```

Logo depois de `const billingEvt: BillingEvent = normalized;` (`:268`), inserir:

```ts
    // Patch the catalog-resolved values into the event before dispatch, in the
    // same spirit as the garageId patch below.
    if (billingEvt.kind === 'subscription.activated' || billingEvt.kind === 'subscription.renewed') {
      const resolved = await resolveLinesAgainstCatalog(billingEvt.lines);
      billingEvt.pricing.baseAmountCents = resolved.baseAmountCents;
      billingEvt.pricing.devFeePercent = resolved.devFeePercent;
      billingEvt.pricing.devFeeAmountCents = resolved.devFeeAmountCents;
      if (billingEvt.kind === 'subscription.activated') {
        if (resolved.tier) billingEvt.tier = resolved.tier;
        billingEvt.addons = resolved.addons;
        billingEvt.addonsAmountCents = resolved.addonsAmountCents;
      }
    }

    // A tier_changed whose swapped price is an add-on is not a tier change at
    // all: reconcileMembershipAddonsAmount above already handled it.
    if (billingEvt.kind === 'subscription.tier_changed') {
      const resolved = await resolveLinesAgainstCatalog([
        { priceRef: billingEvt.priceRef, amountCents: 0, subscriptionItemRef: null, metadata: {} },
      ]);
      if (!resolved.tier) {
        await prisma.subscriptionWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
        request.log.info(
          { eventId: event.id, priceRef: billingEvt.priceRef },
          'stripe-billing webhook: item swap is an add-on, not a tier change',
        );
        return reply.status(200).send({ ok: true, ignored: true, reason: 'addon-item-swap' });
      }
      billingEvt.tier = resolved.tier;
      billingEvt.pricing.baseAmountCents = resolved.baseAmountCents;
      billingEvt.pricing.devFeePercent = resolved.devFeePercent;
      billingEvt.pricing.devFeeAmountCents = resolved.devFeeAmountCents;
      billingEvt.pricing.grossAmountCents = resolved.baseAmountCents + resolved.devFeeAmountCents;
    }
```

Nota de escopo: a renovação patcha só o `pricing`. Add-on que muda entre ciclos continua sendo reconciliado por `reconcileMembershipAddonsAmount` no `customer.subscription.updated`, que já roda em `:184-199`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test stripe-billing-webhook`
Expected: PASS, incluindo o caso novo.

Se `tier` ainda voltar `'bronze'`, o problema está no match: conferir que a seed usa `stripePriceId: 'price_plan_silver'` igual ao `price.id` do evento.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/stripe-billing-webhook.ts apps/api/test/billing/stripe-billing-webhook.test.ts
git commit -m "fix(api): webhook resolve tier e precos contra o catalogo do banco"
```

---

## Task 7: Add-ons criados na transação de ativação

**Files:**
- Modify: `apps/api/src/services/billing/apply-membership-event.ts:53-195`
- Test: `apps/api/test/billing/stripe-billing-webhook.test.ts`

**Interfaces:**
- Consumes: `BillingAddonLine` e `evt.addons` / `evt.addonsAmountCents` (Tasks 5 e 6).
- Produces: `PremiumMembershipAddon` e `PremiumAddonUsage` escritos na mesma tx da ativação.

- [ ] **Step 1: Escrever os testes que falham**

No mesmo `describe('multi-line invoice resolution')`, adicionar:

```ts
  it('creates the add-on and its usage cycle in the activation transaction', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'addontx@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    stripe.customers.set('cus_ml_2', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_ml_2',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_ml_2',
          subscription: 'sub_ml_2',
          customer: 'cus_ml_2',
          billing_reason: 'subscription_create',
          amount_paid: 113900,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                price: { id: 'price_plan_silver', metadata: { devFeePercent: '10' } },
                amount: 89000,
                subscription_item: 'si_plan_2',
              },
              {
                price: { id: 'price_addon_detailing', metadata: {} },
                amount: 15000,
                subscription_item: 'si_addon_2',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { provider_providerSubRef: { provider: 'stripe', providerSubRef: 'sub_ml_2' } },
    });
    expect(membership.addonsAmountCents).toBe(15000);

    const addon = await prisma.premiumMembershipAddon.findUniqueOrThrow({
      where: { membershipId_addonKey: { membershipId: membership.id, addonKey: 'detailing' } },
    });
    expect(addon.status).toBe('active');
    expect(addon.providerItemRef).toBe('si_addon_2');
    expect(addon.monthlyDeltaCents).toBe(15000);
    expect(addon.quotaPerCycle).toBe(3);

    const usage = await prisma.premiumAddonUsage.findFirstOrThrow({
      where: { membershipAddonId: addon.id },
    });
    expect(usage.quotaTotal).toBe(3);
    expect(usage.quotaUsed).toBe(0);
    expect(usage.cycleStart.toISOString()).toBe(membership.currentPeriodStart.toISOString());

    await app.close();
  });

  it('reactivates a previously cancelled add-on instead of violating the unique', async () => {
    const { app, stripe } = await buildBillingApp(true);
    await seedCatalog();
    const { user } = await createUser({ email: 'readd@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const stale = await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_ml_3',
        providerSubRef: 'sub_ml_3',
        tier: 'silver',
        cadence: 'monthly',
        status: 'expired',
        currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
        cancelAtPeriodEnd: false,
        baseAmountCents: 89000,
        devFeePercent: 10,
        devFeeAmountCents: 8900,
        grossAmountCents: 97900,
        currency: 'BRL',
      },
    });
    await prisma.premiumMembershipAddon.create({
      data: {
        membershipId: stale.id,
        addonKey: 'detailing',
        status: 'cancelled',
        providerItemRef: 'si_old',
        monthlyDeltaCents: 15000,
        quotaPerCycle: 3,
        quotaUnit: 'access',
        currency: 'BRL',
      },
    });

    stripe.customers.set('cus_ml_3', { garageId: garage.id });
    stripe.nextEvent = {
      id: 'evt_ml_3',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_ml_3',
          subscription: 'sub_ml_3',
          customer: 'cus_ml_3',
          billing_reason: 'subscription_create',
          amount_paid: 113900,
          currency: 'brl',
          period_start: 1767225600,
          period_end: 1769904000,
          status_transitions: { paid_at: 1767225600 },
          lines: {
            data: [
              {
                price: { id: 'price_plan_silver', metadata: { devFeePercent: '10' } },
                amount: 89000,
                subscription_item: 'si_plan_3',
              },
              {
                price: { id: 'price_addon_detailing', metadata: {} },
                amount: 15000,
                subscription_item: 'si_addon_3',
              },
            ],
          },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'stripe-signature': 't=1,v1=fake', 'content-type': 'application/json' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const addon = await prisma.premiumMembershipAddon.findUniqueOrThrow({
      where: { membershipId_addonKey: { membershipId: stale.id, addonKey: 'detailing' } },
    });
    expect(addon.status).toBe('active');
    expect(addon.providerItemRef).toBe('si_addon_3');
    await app.close();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test stripe-billing-webhook`
Expected: FAIL. `findUniqueOrThrow` do add-on estoura: nada foi criado.

- [ ] **Step 3: Escrever a criação dos add-ons**

Em `apps/api/src/services/billing/apply-membership-event.ts`, dentro de `handleActivated`, acrescentar `addons` e `addonsAmountCents` à desestruturação de `evt` (`:57-68`).

Adicionar `addonsAmountCents,` ao `data` do `create` (`:82-99`) e ao `data` do update do ramo de avanço (`:104-117`).

Depois do bloco de invoice e antes do snapshot do Garage (`:167`), inserir:

```ts
  // Add-ons ride the SAME transaction as the activation — no partial state and
  // no external call inside the tx. The route resolved these against the
  // catalog; price/quota here are snapshots.
  //
  // Upsert, not create: @@unique([membershipId, addonKey]) has no status filter,
  // so re-subscribing a module that was previously cancelled would otherwise
  // violate the constraint.
  for (const addon of addons) {
    const addonRow = await tx.premiumMembershipAddon.upsert({
      where: {
        membershipId_addonKey: { membershipId: membership.id, addonKey: addon.addonKey },
      },
      create: {
        membershipId: membership.id,
        addonKey: addon.addonKey,
        status: 'active',
        providerItemRef: addon.providerItemRef,
        monthlyDeltaCents: addon.monthlyDeltaCents,
        quotaPerCycle: addon.quotaPerCycle,
        quotaUnit: addon.quotaUnit,
        currency: addon.currency,
      },
      update: {
        status: 'active',
        providerItemRef: addon.providerItemRef,
        monthlyDeltaCents: addon.monthlyDeltaCents,
        quotaPerCycle: addon.quotaPerCycle,
        quotaUnit: addon.quotaUnit,
        currency: addon.currency,
      },
    });

    // One usage row per cycle. Upsert keeps an activation replay idempotent
    // without clobbering quotaUsed.
    await tx.premiumAddonUsage.upsert({
      where: {
        membershipAddonId_cycleStart: {
          membershipAddonId: addonRow.id,
          cycleStart: currentPeriodStart,
        },
      },
      create: {
        membershipAddonId: addonRow.id,
        cycleStart: currentPeriodStart,
        cycleEnd: currentPeriodEnd,
        quotaTotal: addon.quotaPerCycle,
      },
      update: {},
    });
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test stripe-billing-webhook`
Expected: PASS, incluindo os três casos novos da Task 6 e 7.

- [ ] **Step 5: Rodar a suite inteira e o typecheck**

Run: `pnpm --filter @ccc/api test`
Expected: PASS.

Run: `pnpm --filter @ccc/api typecheck`
Expected: PASS. O vermelho aberto na Task 5 fecha aqui.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/billing/apply-membership-event.ts apps/api/test/billing/stripe-billing-webhook.test.ts
git commit -m "feat(api): cria add-ons e ciclo de quota na transacao de ativacao"
```

---

## Task 8: `subscription` devolve benefícios e descrição

**Files:**
- Modify: `apps/api/src/routes/me-premium-addons.ts:48`
- Test: `apps/api/test/billing/premium-subscription.test.ts`

**Interfaces:**
- Consumes: `mySubscriptionResponseSchema` com `benefits` e `planDescription` (Task 1).
- Produces: resposta de `GET /api/me/premium/subscription` com os dois campos.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/test/billing/premium-subscription.test.ts`, adicionar um caso usando as fixtures que o arquivo já tem (`seedGoldPlan`, `seedMembership`):

```ts
  it('returns the plan benefits ordered by sortOrder and the plan description', async () => {
    const { app } = await makeAppWithFakeStripe();
    const plan = await seedGoldPlan();
    await prisma.premiumPlan.update({
      where: { id: plan.id },
      data: { description: 'O nivel mais alto da Casa.' },
    });
    await prisma.premiumPlanBenefit.createMany({
      data: [
        { planId: plan.id, label: 'Segundo', sortOrder: 2 },
        { planId: plan.id, label: 'Primeiro', sortOrder: 1 },
      ],
    });
    const { user } = await createUser({ email: 'benefits@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/subscription',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { benefits: string[]; planDescription: string | null };
    expect(body.benefits).toEqual(['Primeiro', 'Segundo']);
    expect(body.planDescription).toBe('O nivel mais alto da Casa.');
    await app.close();
  });
```

Se `seedGoldPlan` ou `seedMembership` tiverem outra assinatura no arquivo, adaptar a chamada ao que já existe ali. Não criar fixtures paralelas.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test premium-subscription`
Expected: FAIL. `benefits` é `undefined` e o `parse` do schema rejeita a resposta.

- [ ] **Step 3: Incluir os campos no handler**

Em `apps/api/src/routes/me-premium-addons.ts`, no handler de `GET /api/me/premium/subscription`, incluir os benefícios e a descrição no `select` do plano e no objeto de resposta. O plano já é carregado para resolver `planSlug` e `planName`; acrescentar ao `select`:

```ts
        description: true,
        benefits: { orderBy: { sortOrder: 'asc' }, select: { label: true } },
```

E no objeto passado para `mySubscriptionResponseSchema.parse`, junto de `planName`:

```ts
      planDescription: plan?.description ?? null,
      benefits: plan?.benefits.map((b) => b.label) ?? [],
```

No caminho de "sem assinatura viva", devolver `planDescription: null` e `benefits: []`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test premium-subscription`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me-premium-addons.ts apps/api/test/billing/premium-subscription.test.ts
git commit -m "feat(api): subscription devolve beneficios e descricao do plano"
```

---

## Task 9: Rate limit nas rotas premium

**Files:**
- Modify: `apps/api/src/routes/me-premium.ts`
- Modify: `apps/api/src/routes/me-premium-addons.ts`
- Test: `apps/api/test/billing/premium-cancel.test.ts`

**Interfaces:**
- Consumes: as rotas das Tasks 2, 3, 4.
- Produces: nenhuma exportação nova. `429` depois do limite.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/test/billing/premium-cancel.test.ts`, adicionar:

```ts
  it('rate limits cancel at 5 requests per minute', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'rl@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id);
    stripe.nextCancelledSubscription = {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
    };
    const headers = { authorization: bearer(env, user.id) };

    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/api/me/premium/cancel', headers });
      codes.push(res.statusCode);
    }

    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
    await app.close();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test premium-cancel`
Expected: FAIL. A sexta chamada volta 200.

- [ ] **Step 3: Envelopar as rotas em escopos com rate limit**

Em `apps/api/src/routes/me-premium.ts`, adicionar ao topo:

```ts
import rateLimit from '@fastify/rate-limit';
```

Mover os handlers de `checkout` e `cancel` para dentro de escopos encapsulados. O `hook: 'preHandler'` é obrigatório porque a chave usa `request.user`, que só existe depois do `authenticate`. Padrão de referência: `apps/api/src/routes/orders.ts:369`.

```ts
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => `premium-checkout:${req.user?.sub ?? req.ip}`,
    });
    scoped.post('/api/me/premium/checkout', checkoutHandler);
  });

  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.authenticate);
    await scoped.register(rateLimit, {
      max: 5,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => `premium-cancel:${req.user?.sub ?? req.ip}`,
    });
    scoped.post('/api/me/premium/cancel', cancelHandler);
  });
```

Extrair os corpos atuais dos dois handlers para `checkoutHandler` e `cancelHandler`, declarados como consts acima dos registros. Não duplicar a lógica: é um recorte, não uma reescrita. Remover o `{ preHandler: [app.authenticate] }` dos dois, porque o hook do escopo já cobre.

Em `apps/api/src/routes/me-premium-addons.ts`, aplicar o mesmo padrão em `POST /api/me/premium/addons`, com `max: 20` e chave `premium-addons:`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test premium-cancel`
Expected: PASS, 5 testes.

- [ ] **Step 5: Rodar toda a suite de API**

Run: `pnpm --filter @ccc/api test`
Expected: PASS. Se algum teste de checkout já existente agora bater no limite por fazer mais de 5 chamadas com o mesmo usuário, dividir em usuários diferentes. Não afrouxar o limite para acomodar teste.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/me-premium.ts apps/api/src/routes/me-premium-addons.ts apps/api/test/billing/premium-cancel.test.ts
git commit -m "feat(api): rate limit em checkout, cancel e addons"
```

**GATE DE BACKEND.** Não seguir para a Task 10 sem `pnpm --filter @ccc/api test` e `pnpm --filter @ccc/api typecheck` verdes.

---

## Task 10: Copy, clientes de API e hook de invoices no mobile

**Files:**
- Modify: `apps/mobile/src/copy/assinaturas.ts`
- Modify: `apps/mobile/src/api/premium.ts`
- Modify: `apps/mobile/src/api/premium-catalog.ts`
- Create: `apps/mobile/src/hooks/usePremiumInvoices.ts`

**Interfaces:**
- Consumes: `premiumInvoicesResponseSchema` de `@ccc/shared/premium-subscription`.
- Produces: `assinaturasCopy.contratar`, `assinaturasCopy.minhaAssinatura.historico`, `assinaturasCopy.minhaAssinatura.cancelar`; `createPremiumCheckout(input)`, `cancelPremiumSubscription()`, `listPremiumInvoices()`; `usePremiumInvoices()`.

- [ ] **Step 1: Escrever a copy**

Em `apps/mobile/src/copy/assinaturas.ts`, remover o bloco `checkout` atual e colocar no lugar:

```ts
  contratar: {
    header: 'CONTRATAR',
    back: 'Voltar',
    planLabel: 'PLANO ESCOLHIDO',
    modulesTitle: 'MÓDULOS ADICIONAIS',
    modulesSubcopy: 'Opcionais. Você pode adicionar ou remover depois.',
    add: 'ADICIONAR',
    remove: 'REMOVER',
    quotaAccess: (n: number) => `${n} acessos por mês`,
    quotaHours: (n: number) => `${n} horas por mês`,
    summaryBase: 'Mensalidade base',
    summaryModules: 'Módulos',
    summaryTotal: 'Total por mês',
    cta: 'IR PARA O PAGAMENTO',
    ctaLoading: 'PROCESSANDO...',
    confirming: 'Confirmando pagamento...',
    pendingTitle: 'Pagamento em processamento.',
    pendingSubcopy: 'Assim que o pagamento for confirmado sua assinatura aparece aqui.',
    pendingCta: 'VER MINHA ASSINATURA',
    successToast: 'Assinatura ativada.',
    errorGeneric: 'Não foi possível iniciar o pagamento. Tente novamente.',
    iosTitle: 'Contratação pelo site.',
    iosSubcopy: 'No iPhone a contratação é feita pelo site da Casa Car Club.',
  },
```

Dentro de `minhaAssinatura`, acrescentar:

```ts
    benefitsTitle: 'O QUE ESTÁ INCLUÍDO',
    seeAllPlans: 'VER TODOS OS PLANOS',
    historico: {
      title: 'HISTÓRICO DE COBRANÇAS',
      empty: 'Nenhuma cobrança ainda.',
      error: 'Não foi possível carregar o histórico.',
      refunded: 'Estornado',
      paidAt: (date: string) => `Pago em ${date}`,
    },
    cancelar: {
      trigger: 'Cancelar assinatura',
      sheetTitle: 'Cancelar assinatura',
      body: (date: string) =>
        `Sua assinatura continua ativa até ${date}. Depois dessa data você perde os benefícios e os módulos contratados.`,
      keep: 'MANTER ASSINATURA',
      confirm: 'CANCELAR ASSINATURA',
      loading: 'CANCELANDO...',
      successToast: 'Cancelamento agendado.',
      error: 'Não foi possível cancelar. Tente novamente.',
      appleTitle: 'Assinatura pela App Store',
      appleBody: 'Esta assinatura foi contratada pela App Store. O cancelamento é feito por lá.',
      appleCta: 'ABRIR APP STORE',
    },
```

- [ ] **Step 2: Escrever os clientes de API**

Em `apps/mobile/src/api/premium-catalog.ts`, acrescentar:

```ts
import {
  mySubscriptionResponseSchema,
  premiumInvoicesResponseSchema,
  type MySubscriptionResponse,
  type PremiumInvoicesResponse,
} from '@ccc/shared/premium-subscription';

const invoicesSchema =
  premiumInvoicesResponseSchema as z.ZodType<PremiumInvoicesResponse>;

export const listPremiumInvoices = (): Promise<PremiumInvoicesResponse> =>
  authedRequest('/api/me/premium/invoices', invoicesSchema);
```

Em `apps/mobile/src/api/premium.ts`, acrescentar (seguir o estilo de `authedRequest` já usado no arquivo, incluindo `method` e `body` como o arquivo faz hoje para POSTs):

```ts
import {
  premiumCheckoutResponseSchema,
  type PremiumCheckoutResponse,
} from '@ccc/shared/premium';

/** POST /api/me/premium/checkout — server resolves every price from the catalog. */
export const createPremiumCheckout = (input: {
  planSlug: string;
  addonKeys: string[];
}): Promise<PremiumCheckoutResponse> =>
  authedRequest('/api/me/premium/checkout', premiumCheckoutResponseSchema, {
    method: 'POST',
    body: { cadence: 'monthly', planSlug: input.planSlug, addonKeys: input.addonKeys },
  });

/** POST /api/me/premium/cancel — schedules cancellation at period end. */
export const cancelPremiumSubscription = (): Promise<{
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string;
}> =>
  authedRequest(
    '/api/me/premium/cancel',
    z.object({ cancelAtPeriodEnd: z.boolean(), currentPeriodEnd: z.string() }),
    { method: 'POST' },
  );
```

Conferir a assinatura real de `authedRequest` em `apps/mobile/src/api/client.ts:71` e ajustar a forma das options ao que o arquivo já usa. Não inventar uma terceira forma de chamar.

- [ ] **Step 3: Escrever o hook de invoices**

Criar `apps/mobile/src/hooks/usePremiumInvoices.ts`, espelhando `usePremiumSubscription.ts` linha a linha:

```ts
import type { PremiumInvoicesResponse } from '@ccc/shared/premium-subscription';
import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '~/api/client';
import { listPremiumInvoices } from '~/api/premium-catalog';

type Extra = { premiumBillingEnabled?: boolean };

const billingEnabled =
  (Constants.expoConfig?.extra as Extra | undefined)?.premiumBillingEnabled ?? false;

type UsePremiumInvoicesResult = {
  invoices: PremiumInvoicesResponse['invoices'];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

/**
 * GET /api/me/premium/invoices. Mirrors usePremiumSubscription: gated on the
 * billing flag, and a 503 is not an error — it just means no history to show.
 */
export function usePremiumInvoices(): UsePremiumInvoicesResult {
  const [invoices, setInvoices] = useState<PremiumInvoicesResponse['invoices']>([]);
  const [loading, setLoading] = useState(billingEnabled);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!billingEnabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const res = await listPremiumInvoices();
      setInvoices(res.invoices);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 503)) setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { invoices, loading, error, refresh };
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS. `PlanoDetalheScreen.tsx:19` ainda importa `startPremiumCheckout` na forma antiga — se o typecheck reclamar de `assinaturasCopy.checkout.comingSoon`, corrigir na Task 11, que é onde o seam muda.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/copy/assinaturas.ts apps/mobile/src/api/premium.ts apps/mobile/src/api/premium-catalog.ts apps/mobile/src/hooks/usePremiumInvoices.ts
git commit -m "feat(mobile): copy, clientes de API e hook de historico de cobrancas"
```

---

## Task 11: Seam de checkout

**Files:**
- Modify: `apps/mobile/src/screens/assinaturas/checkout.ts`
- Create: `apps/mobile/src/screens/assinaturas/checkout.test.ts`
- Create: `apps/mobile/src/screens/assinaturas/package-total.ts`
- Create: `apps/mobile/src/screens/assinaturas/package-total.test.ts`

**Interfaces:**
- Consumes: `createPremiumCheckout` (Task 10).
- Produces: `CheckoutOutcome`; `startPremiumCheckout(input: { planSlug: string; addonKeys: string[] }): Promise<CheckoutOutcome>`; `packageTotalCents(baseCents: number | null, modules: Array<{ key: string; monthlyDeltaCents: number }>, selected: Set<string>): { baseCents: number; addonsCents: number; totalCents: number }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/mobile/src/screens/assinaturas/package-total.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { packageTotalCents } from './package-total';

const modules = [
  { key: 'detailing', monthlyDeltaCents: 15000 },
  { key: 'oficina', monthlyDeltaCents: 50000 },
];

describe('packageTotalCents', () => {
  it('returns the base alone when nothing is selected', () => {
    expect(packageTotalCents(89000, modules, new Set())).toEqual({
      baseCents: 89000,
      addonsCents: 0,
      totalCents: 89000,
    });
  });

  it('sums only the selected modules', () => {
    expect(packageTotalCents(89000, modules, new Set(['oficina']))).toEqual({
      baseCents: 89000,
      addonsCents: 50000,
      totalCents: 139000,
    });
  });

  it('treats a null base as zero', () => {
    expect(packageTotalCents(null, modules, new Set(['detailing']))).toEqual({
      baseCents: 0,
      addonsCents: 15000,
      totalCents: 15000,
    });
  });

  it('ignores a selected key that is not in the catalog', () => {
    expect(packageTotalCents(89000, modules, new Set(['fantasma']))).toEqual({
      baseCents: 89000,
      addonsCents: 0,
      totalCents: 89000,
    });
  });
});
```

Criar `apps/mobile/src/screens/assinaturas/checkout.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAuthSessionAsync = vi.fn();
const createPremiumCheckout = vi.fn();
const platform = { OS: 'android' as string };

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync }));
vi.mock('~/api/premium', () => ({ createPremiumCheckout }));

const load = async () => import('./checkout');

describe('startPremiumCheckout', () => {
  beforeEach(() => {
    vi.resetModules();
    openAuthSessionAsync.mockReset();
    createPremiumCheckout.mockReset();
    platform.OS = 'android';
  });

  it('never touches the API on iOS', async () => {
    platform.OS = 'ios';
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });
    expect(out).toEqual({ kind: 'ios_unsupported' });
    expect(createPremiumCheckout).not.toHaveBeenCalled();
  });

  it('returns "returned" when the Android browser closes with success', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://stripe.test/s', sessionId: 'cs_1' });
    openAuthSessionAsync.mockResolvedValue({ type: 'success' });
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: ['detailing'] });
    expect(createPremiumCheckout).toHaveBeenCalledWith({
      planSlug: 'fundador',
      addonKeys: ['detailing'],
    });
    expect(openAuthSessionAsync).toHaveBeenCalledWith(
      'https://stripe.test/s',
      'ccc://premium/return',
    );
    expect(out).toEqual({ kind: 'returned' });
  });

  it('returns "dismissed" when the user closes the browser', async () => {
    createPremiumCheckout.mockResolvedValue({ url: 'https://stripe.test/s', sessionId: 'cs_1' });
    openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });
    expect(out).toEqual({ kind: 'dismissed' });
  });

  it('maps an API failure to an error outcome', async () => {
    createPremiumCheckout.mockRejectedValue(new Error('boom'));
    const { startPremiumCheckout } = await load();
    const out = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });
    expect(out.kind).toBe('error');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test package-total checkout`
Expected: FAIL. `package-total` não existe e `startPremiumCheckout` ainda é síncrono e devolve `undefined`.

- [ ] **Step 3: Escrever `package-total.ts`**

```ts
// Pure package arithmetic for the contratação screen. Kept out of the screen so
// the total is unit-testable without rendering React Native.

export type PackageModule = { key: string; monthlyDeltaCents: number };

export type PackageTotals = {
  baseCents: number;
  addonsCents: number;
  totalCents: number;
};

/** Base plan price plus every selected module. Unknown keys are ignored. */
export function packageTotalCents(
  baseCents: number | null,
  modules: PackageModule[],
  selected: Set<string>,
): PackageTotals {
  const base = baseCents ?? 0;
  const addonsCents = modules
    .filter((m) => selected.has(m.key))
    .reduce((sum, m) => sum + m.monthlyDeltaCents, 0);
  return { baseCents: base, addonsCents, totalCents: base + addonsCents };
}
```

- [ ] **Step 4: Reescrever `checkout.ts`**

```ts
// Contratação (checkout) seam.
//
// The SINGLE place that talks to a payment provider from the assinaturas
// module. Platform branching lives here so no screen has to know about it.
//
// iOS App Store rule: Stripe purchase must NOT run on iOS. The screen shows a
// "contract on the web" notice instead. Enforced by eslint-rules/no-stripe-on-ios.cjs.

import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { createPremiumCheckout } from '~/api/premium';

/** Deep link the Android auth session returns to. Mirrors the legacy PremiumScreen. */
const DEEP_LINK_RETURN = 'ccc://premium/return';

export type CheckoutOutcome =
  | { kind: 'redirected' }
  | { kind: 'returned' }
  | { kind: 'dismissed' }
  | { kind: 'ios_unsupported' }
  | { kind: 'error'; message: string };

export async function startPremiumCheckout(input: {
  planSlug: string;
  addonKeys: string[];
}): Promise<CheckoutOutcome> {
  if (Platform.OS === 'ios') return { kind: 'ios_unsupported' };

  let url: string;
  try {
    const session = await createPremiumCheckout(input);
    url = session.url;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'checkout failed' };
  }

  if (Platform.OS === 'web') {
    window.location.href = url;
    return { kind: 'redirected' };
  }

  const result = await WebBrowser.openAuthSessionAsync(url, DEEP_LINK_RETURN);
  return result.type === 'success' ? { kind: 'returned' } : { kind: 'dismissed' };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test package-total checkout`
Expected: PASS, 8 testes.

- [ ] **Step 6: Corrigir o call-site antigo**

`apps/mobile/src/screens/assinaturas/PlanoDetalheScreen.tsx:178,196` chama `startPremiumCheckout(plan.slug)`. Trocar os dois `onPress` para navegar até a tela de contratação:

```tsx
            onPress={() => router.push(`/assinaturas/contratar?slug=${plan.slug}`)}
```

Remover o import de `startPremiumCheckout` do arquivo. A tela de detalhe passa a só navegar; quem chama o seam é a `ContratarScreen`.

Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/assinaturas/checkout.ts apps/mobile/src/screens/assinaturas/checkout.test.ts apps/mobile/src/screens/assinaturas/package-total.ts apps/mobile/src/screens/assinaturas/package-total.test.ts apps/mobile/src/screens/assinaturas/PlanoDetalheScreen.tsx
git commit -m "feat(mobile): seam de checkout real com branch por plataforma"
```

---

## Task 12: Tela de contratação

**Files:**
- Create: `apps/mobile/src/screens/assinaturas/TierCta.tsx`
- Create: `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx`
- Create: `apps/mobile/app/(app)/assinaturas/contratar.tsx`
- Modify: `apps/mobile/src/screens/assinaturas/PlanoDetalheScreen.tsx:174-207`

**Interfaces:**
- Consumes: `startPremiumCheckout`, `packageTotalCents` (Task 11), `usePremiumAddonModules`, `getPremiumPlan`, `assinaturasCopy.contratar` (Task 10).
- Produces: `TierCta` (props `{ tier, label, onPress, disabled?, loading?, testID? }`); rota `/assinaturas/contratar?slug=`.

- [ ] **Step 1: Extrair o CTA duplicado para `TierCta.tsx`**

O bloco de `PlanoDetalheScreen.tsx:176-206` tem o mesmo Pressable escrito duas vezes, uma com gradiente e outra sem. Extrair:

```tsx
// Per-tier CTA. Gold renders a gradient; the other tiers render an outline.
// Extracted from PlanoDetalheScreen, where the two variants were duplicated.

import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { c, tierStyle, type ApiTier } from '~/screens/assinaturas/tier-visual';

export function TierCta({
  tier,
  label,
  onPress,
  disabled = false,
  loading = false,
  testID,
}: {
  tier: ApiTier;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const t = tierStyle(tier);
  const isGradient = t.btnBg === 'gradient';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        isGradient ? styles.gradient : styles.outline,
        !isGradient && { borderColor: t.btnBorder },
        (disabled || loading) && styles.dimmed,
      ]}
      testID={testID}
    >
      {isGradient ? (
        <LinearGradient
          colors={[c.goldLight, c.goldDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {loading ? <ActivityIndicator color={t.btnColor} /> : null}
      <Text style={[styles.label, { color: t.btnColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outline: {
    borderRadius: 11,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
  },
  gradient: {
    borderRadius: 11,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    overflow: 'hidden',
  },
  dimmed: { opacity: 0.6 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 2.4 },
});
```

Substituir o bloco `:175-207` de `PlanoDetalheScreen.tsx` por:

```tsx
      <View style={styles.ctaBar}>
        <TierCta
          tier={plan.tier}
          label={assinaturasCopy.detail.cta}
          onPress={() => router.push(`/assinaturas/contratar?slug=${plan.slug}`)}
          testID="detalhe-assinar"
        />
      </View>
```

Remover de `PlanoDetalheScreen.tsx` os estilos `cta`, `ctaGradient` e `ctaText`, e o import de `LinearGradient` se ficar sem uso.

- [ ] **Step 2: Escrever a tela**

Criar `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx`. Regras que o arquivo tem que cumprir, todas verificáveis por leitura:

- header idêntico ao de `PlanoDetalheScreen.tsx:48-64`, com `assinaturasCopy.contratar.header` e `back`;
- carrega o plano com `getPremiumPlan(slug)` e os módulos com `usePremiumAddonModules()`, cada um com o padrão `useState` + `useCallback refresh` + `useEffect` já usado no módulo;
- estado de seleção: `const [selected, setSelected] = useState<Set<string>>(new Set())`, alternado por `toggle(key)` que sempre cria um `Set` novo;
- totais derivados no render com `packageTotalCents(monthlyPriceCents(plan), modules, selected)`. Sem `useEffect` para o total;
- lista de módulos com nome, `description`, quota via `contratar.quotaAccess` / `quotaHours` conforme `quotaUnit`, preço com `formatBRL(monthlyDeltaCents)` e botão `add` / `remove`;
- barra fixa no rodapé com as três linhas do resumo e o `<TierCta>`;
- `const [submitting, setSubmitting] = useState(false)`, e o handler começa com `if (submitting) return;`;
- `const [phase, setPhase] = useState<'form' | 'confirming' | 'pending'>('form')`;
- `Platform.OS === 'ios'` renderiza `contratar.iosTitle` / `iosSubcopy` no lugar da barra de CTA e não monta o botão;
- erro fica num `Text` inline acima do CTA, alimentado por `const [errorMsg, setErrorMsg] = useState<string | null>(null)`;
- toda cor sai de `c` e `tierStyle()` de `tier-visual.ts`. Nenhum hex solto, nenhum import de `~/theme` nem de `@ccc/ui`.

Handler do CTA:

```tsx
  const onSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const outcome = await startPremiumCheckout({
        planSlug: plan.slug,
        addonKeys: [...selected],
      });
      if (outcome.kind === 'error') {
        setErrorMsg(assinaturasCopy.contratar.errorGeneric);
        return;
      }
      if (outcome.kind === 'returned') {
        setPhase('confirming');
        const active = await pollSubscriptionActive();
        if (active) {
          showToast(assinaturasCopy.contratar.successToast);
          router.replace('/assinaturas/minha-assinatura');
        } else {
          setPhase('pending');
        }
      }
      // 'redirected' → the web page is already navigating away.
      // 'dismissed'  → stay on the form untouched.
      // 'ios_unsupported' → unreachable, the CTA is not rendered on iOS.
    } finally {
      setSubmitting(false);
    }
  };
```

E o polling, num módulo próprio porque a Task 13 usa o mesmo. Criar `apps/mobile/src/screens/assinaturas/poll-subscription.ts`:

```ts
// Shared post-payment poller for the two checkout return paths (Android deep
// link inside ContratarScreen, and the web checkout-return route).
//
// The webhook is asynchronous — a closed browser does not prove payment. Poll
// until the membership flips active. Cadence mirrors
// app/(app)/events/buy/checkout-return.tsx.

import { getMyPremiumSubscription } from '~/api/premium-catalog';

export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_ATTEMPTS = 15;

/** Resolves true once the subscription is active, false when the attempts run out. */
export async function pollSubscriptionActive(): Promise<boolean> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    try {
      const sub = await getMyPremiumSubscription();
      if (sub.active) return true;
    } catch {
      // Transient failure — keep polling; the caller shows the pending state.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}
```

`ContratarScreen.tsx` importa `pollSubscriptionActive` desse módulo. Não redeclarar o loop na tela.

O estado `pending` renderiza `pendingTitle`, `pendingSubcopy` e um botão `pendingCta` que faz `router.replace('/assinaturas/minha-assinatura')`. O estado `confirming` renderiza `ActivityIndicator` mais `contratar.confirming`, no mesmo formato de `MinhaAssinaturaScreen.tsx:177-181`.

- [ ] **Step 3: Escrever o shim de rota**

Criar `apps/mobile/app/(app)/assinaturas/contratar.tsx`, no mesmo formato dos shims vizinhos:

```tsx
import { useLocalSearchParams } from 'expo-router';

import ContratarScreen from '~/screens/assinaturas/ContratarScreen';

export default function ContratarRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  return <ContratarScreen slug={slug} />;
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS.

Run: `pnpm --filter @ccc/mobile lint`
Expected: PASS. Se `no-stripe-on-ios.cjs` acusar, é porque algum caminho de iOS alcança o seam: conferir o guard de `Platform.OS === 'ios'`.

- [ ] **Step 5: Verificar na mão**

Subir `docker start jdm-postgres`, `cd apps/api && pnpm dev`, `cd apps/mobile && EXPO_NO_TELEMETRY=1 npx expo start`. Abrir `/assinaturas`, entrar num plano, tocar em ASSINAR, marcar e desmarcar módulos, conferir que o total recalcula na hora.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/assinaturas/TierCta.tsx apps/mobile/src/screens/assinaturas/ContratarScreen.tsx "apps/mobile/app/(app)/assinaturas/contratar.tsx" apps/mobile/src/screens/assinaturas/PlanoDetalheScreen.tsx
git commit -m "feat(mobile): tela de contratacao com montagem de pacote"
```

---

## Task 13: Retorno do checkout na web

**Files:**
- Create: `apps/mobile/app/(app)/assinaturas/checkout-return.tsx`

**Interfaces:**
- Consumes: `pollSubscriptionActive` de `~/screens/assinaturas/poll-subscription` (Task 12), `assinaturasCopy.contratar`.
- Produces: rota `/assinaturas/checkout-return`, que é o `successUrl` configurado na Task 4.

- [ ] **Step 1: Escrever a tela**

```tsx
// Web-only checkout return. Stripe sends the member here after a successful
// subscription session (see me-premium.ts successUrl). On Android the deep link
// resolves inside ContratarScreen and this route is never opened.
//
// Polls the subscription because the webhook is asynchronous — landing here
// does not prove the membership row exists yet.

import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { assinaturasCopy } from '~/copy/assinaturas';
import { pollSubscriptionActive } from '~/screens/assinaturas/poll-subscription';
import { c } from '~/screens/assinaturas/tier-visual';

const copy = assinaturasCopy.contratar;

export default function CheckoutReturnRoute() {
  const [pending, setPending] = useState(false);

  const poll = useCallback(async () => {
    const active = await pollSubscriptionActive();
    if (active) {
      router.replace('/assinaturas/minha-assinatura');
      return;
    }
    setPending(true);
  }, []);

  useEffect(() => {
    void poll();
  }, [poll]);

  if (pending) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>{copy.pendingTitle}</Text>
        <Text style={styles.subcopy}>{copy.pendingSubcopy}</Text>
        <Pressable
          onPress={() => router.replace('/assinaturas/minha-assinatura')}
          accessibilityRole="button"
          accessibilityLabel={copy.pendingCta}
          style={styles.cta}
          testID="checkout-return-pending-cta"
        >
          <Text style={styles.ctaText}>{copy.pendingCta}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={c.gold} />
      <Text style={styles.subcopy}>{copy.confirming}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: c.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    color: c.cream,
    textAlign: 'center',
  },
  subcopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: c.muted55,
    textAlign: 'center',
    maxWidth: 280,
  },
  cta: {
    marginTop: 6,
    borderRadius: 11,
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderWidth: 1,
    borderColor: c.tileBorder,
  },
  ctaText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: c.goldLight,
  },
});
```

- [ ] **Step 2: Verificar**

Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/app/(app)/assinaturas/checkout-return.tsx"
git commit -m "feat(mobile): tela de retorno do checkout na web"
```

---

## Task 14: `/assinaturas` redireciona assinante

**Files:**
- Modify: `apps/mobile/src/screens/assinaturas/PlanosScreen.tsx`

**Interfaces:**
- Consumes: `usePremiumSubscription`.
- Produces: redirect para `/assinaturas/minha-assinatura`, ignorado quando a rota recebe `?all=1`.

- [ ] **Step 1: Escrever o redirect**

Em `PlanosScreen.tsx`, aceitar a prop `showAll` e adicionar:

```tsx
  const { subscription, loading: subLoading } = usePremiumSubscription();

  // A member with a live subscription lands on "Minha assinatura", not on the
  // sales page. `?all=1` opts out so the upgrade path stays reachable from
  // inside Minha Assinatura.
  useEffect(() => {
    if (showAll || subLoading) return;
    if (subscription?.active) router.replace('/assinaturas/minha-assinatura');
  }, [showAll, subLoading, subscription?.active]);
```

A condição de loading da tela passa a incluir `subLoading`, para não piscar a lista de planos antes do redirect.

Em `apps/mobile/app/(app)/assinaturas/index.tsx`, ler o parâmetro e repassar:

```tsx
  const { all } = useLocalSearchParams<{ all?: string }>();
  return <PlanosScreen showAll={all === '1'} />;
```

- [ ] **Step 2: Verificar**

Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS.

- [ ] **Step 3: Verificar na mão**

Com um usuário sem assinatura, `/assinaturas` mostra os planos. Com um usuário com membership ativa no banco, `/assinaturas` cai direto em Minha Assinatura, e `/assinaturas?all=1` continua mostrando a lista.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/screens/assinaturas/PlanosScreen.tsx "apps/mobile/app/(app)/assinaturas/index.tsx"
git commit -m "feat(mobile): assinante cai em Minha Assinatura ao abrir /assinaturas"
```

---

## Task 15: Minha Assinatura ganha benefícios, histórico e cancelamento

**Files:**
- Modify: `packages/ui/src/SheetShell.tsx`
- Modify: `apps/mobile/src/screens/assinaturas/MinhaAssinaturaScreen.tsx`

**Interfaces:**
- Consumes: `usePremiumInvoices` (Task 10), `cancelPremiumSubscription` (Task 10), `subscription.benefits` (Task 8).
- Produces: `SheetShellProps` com `theme?: { surface?: string; border?: string; titleColor?: string; titleFontFamily?: string }`.

- [ ] **Step 1: Adicionar props de tema ao `SheetShell`**

Em `packages/ui/src/SheetShell.tsx`, estender a interface:

```ts
/**
 * Optional visual overrides. The assinaturas module owns an authoritative
 * palette of its own (see apps/mobile tier-visual.ts) and would otherwise look
 * like a different app inside this sheet. Additive and fully optional — every
 * existing caller keeps the garageTokens look.
 */
export interface SheetShellTheme {
  surface?: string;
  border?: string;
  titleColor?: string;
  titleFontFamily?: string;
}

export interface SheetShellProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
  closeLabel?: string;
  theme?: SheetShellTheme;
}
```

No corpo, resolver os defaults e usar nos três lugares (container, borda do header, texto do título):

```tsx
  const surface = theme?.surface ?? garageTokens.surface.sheet;
  const border = theme?.border ?? garageTokens.surface.border;
  const titleColor = theme?.titleColor ?? '#F5F5F5';
```

`titleFontFamily` entra no style do `<Text>` do título apenas quando definido.

Exportar `SheetShellTheme` no barrel de `packages/ui`.

Run: `pnpm --filter @ccc/ui typecheck`
Expected: PASS.

- [ ] **Step 2: Adicionar a seção de benefícios**

Em `MinhaAssinaturaScreen.tsx`, dentro de `ActiveSubscription`, depois do card do plano:

```tsx
      {sub.benefits.length > 0 ? (
        <View style={styles.benefitsSection}>
          <Text style={styles.sectionTitle}>{copy.benefitsTitle}</Text>
          <View style={styles.benefits}>
            {sub.benefits.map((benefit) => (
              <View key={benefit} style={styles.benefitRow}>
                <Check color={c.goldLight} size={18} strokeWidth={2} style={styles.benefitIcon} />
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
```

Importar `Check` de `lucide-react-native`. Copiar os estilos `benefitRow`, `benefitIcon` e `benefitText` de `PlanoDetalheScreen.tsx:320-329`, e reusar o `sectionTitle` no mesmo formato de `addonsTitle` (`:322-327`).

- [ ] **Step 3: Adicionar a seção de histórico**

Componente local no mesmo arquivo:

```tsx
function InvoiceHistory() {
  const { invoices, loading, error } = usePremiumInvoices();

  if (loading) return null;
  // A history failure must never take the screen down — the subscription card
  // is the important part.
  if (error) return <Text style={styles.historyError}>{copy.historico.error}</Text>;

  return (
    <View style={styles.historySection}>
      <Text style={styles.sectionTitle}>{copy.historico.title}</Text>
      {invoices.length === 0 ? (
        <Text style={styles.historyEmpty}>{copy.historico.empty}</Text>
      ) : (
        <View style={styles.historyList}>
          {invoices.map((inv) => (
            <View key={`${inv.periodStart}-${inv.paidAt}`} style={styles.historyRow}>
              <View style={styles.historyRowText}>
                <Text style={styles.historyPeriod}>
                  {dateFmt.format(new Date(inv.periodStart))}
                </Text>
                <Text style={styles.historyPaidAt}>
                  {copy.historico.paidAt(dateFmt.format(new Date(inv.paidAt)))}
                </Text>
              </View>
              <View style={styles.historyRowAmount}>
                <Text style={styles.historyAmount}>{formatBRL(inv.grossAmountCents)}</Text>
                {inv.refundedAt ? (
                  <Text style={styles.historyRefunded}>{copy.historico.refunded}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
```

Renderizar `<InvoiceHistory />` depois da seção de módulos.

- [ ] **Step 4: Adicionar o cancelamento**

Ainda em `ActiveSubscription`, um `Pressable` de texto em tom danger no fim do scroll, que abre o sheet:

```tsx
      <Pressable
        onPress={() => setCancelOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={copy.cancelar.trigger}
        style={styles.cancelTrigger}
        testID="assinatura-cancelar"
      >
        <Text style={styles.cancelTriggerText}>{copy.cancelar.trigger}</Text>
      </Pressable>
```

E o sheet, fora do `ScrollView`:

```tsx
      <SheetShell
        visible={cancelOpen}
        title={isApple ? copy.cancelar.appleTitle : copy.cancelar.sheetTitle}
        onClose={() => setCancelOpen(false)}
        theme={{
          surface: c.surface,
          border: c.hairline,
          titleColor: c.cream,
          titleFontFamily: 'Inter_600SemiBold',
        }}
        testID="assinatura-cancelar-sheet"
      >
        {isApple ? (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetText}>{copy.cancelar.appleBody}</Text>
            <Pressable
              onPress={() => void Linking.openURL(APPLE_MANAGE_URL)}
              accessibilityRole="button"
              accessibilityLabel={copy.cancelar.appleCta}
              style={styles.sheetKeep}
            >
              <Text style={styles.sheetKeepText}>{copy.cancelar.appleCta}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetText}>
              {periodEnd ? copy.cancelar.body(dateFmt.format(periodEnd)) : copy.cancelar.sheetTitle}
            </Text>
            {cancelError ? <Text style={styles.sheetError}>{cancelError}</Text> : null}
            <Pressable
              onPress={() => setCancelOpen(false)}
              accessibilityRole="button"
              accessibilityLabel={copy.cancelar.keep}
              style={styles.sheetKeep}
            >
              <Text style={styles.sheetKeepText}>{copy.cancelar.keep}</Text>
            </Pressable>
            <Pressable
              onPress={() => void onConfirmCancel()}
              disabled={cancelling}
              accessibilityRole="button"
              accessibilityLabel={copy.cancelar.confirm}
              accessibilityState={{ disabled: cancelling, busy: cancelling }}
              style={[styles.sheetConfirm, cancelling && styles.dimmed]}
              testID="assinatura-cancelar-confirmar"
            >
              <Text style={styles.sheetConfirmText}>
                {cancelling ? copy.cancelar.loading : copy.cancelar.confirm}
              </Text>
            </Pressable>
          </View>
        )}
      </SheetShell>
```

`APPLE_MANAGE_URL` é a constante `'https://apps.apple.com/account/subscriptions'`, declarada no topo do arquivo. `Linking` vem de `react-native`.

Estilos novos:

```ts
  sheetBody: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  sheetText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, color: c.cream },
  sheetError: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#EF4444' },
  sheetKeep: {
    borderRadius: 11,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.tileBorder,
  },
  sheetKeepText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: c.goldLight,
  },
  sheetConfirm: {
    borderRadius: 11,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.55)',
  },
  sheetConfirmText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: '#EF4444',
  },
  dimmed: { opacity: 0.6 },
```

Handler:

```tsx
  const onConfirmCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelPremiumSubscription();
      setCancelOpen(false);
      showToast(copy.cancelar.successToast);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setIsApple(true);
        return;
      }
      setCancelError(copy.cancelar.error);
    } finally {
      setCancelling(false);
    }
  };
```

Estados novos na tela: `cancelOpen`, `cancelling`, `cancelError`, `isApple`. O `refresh` vem do `usePremiumSubscription` que a tela já usa (`:173`), então o card volta com "Cancela em {data}" sem UI nova.

- [ ] **Step 5: Adicionar o link de ver todos os planos**

No fim do scroll, antes do gatilho de cancelamento:

```tsx
      <Pressable
        onPress={() => router.push('/assinaturas?all=1')}
        accessibilityRole="button"
        accessibilityLabel={copy.seeAllPlans}
        style={styles.seeAllPlans}
      >
        <Text style={styles.seeAllPlansText}>{copy.seeAllPlans}</Text>
      </Pressable>
```

- [ ] **Step 6: Verificar**

Run: `pnpm --filter @ccc/ui build`
Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS nos dois.

- [ ] **Step 7: Verificar na mão**

Com uma membership ativa no banco, abrir Minha Assinatura. Conferir benefícios, histórico (inserir uma linha em `PremiumMembershipInvoice` na mão para ver a lista preenchida), o sheet de cancelamento e o toast.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/SheetShell.tsx packages/ui/src/index.ts apps/mobile/src/screens/assinaturas/MinhaAssinaturaScreen.tsx
git commit -m "feat(mobile): beneficios, historico e cancelamento em Minha Assinatura"
```

---

## Task 16: Card premium no Perfil e remoção do menu legado

**Files:**
- Modify: `apps/mobile/app/(app)/profile/index.tsx:168-175`, `:232-237`

**Interfaces:**
- Consumes: `usePremiumSubscription`, `PremiumBadge` de `@ccc/ui`.
- Produces: nada exportado.

- [ ] **Step 1: Mostrar o tier no hero card**

Em `apps/mobile/app/(app)/profile/index.tsx`, dentro de `ProfileMenuScreen`:

```tsx
  const { subscription } = usePremiumSubscription();
```

Dentro de `styles.heroText`, depois da linha de localização (`:171`):

```tsx
          {subscription?.active && subscription.tier ? (
            <View style={styles.premiumRow}>
              <PremiumBadge isPremiumActive tier={subscription.tier} />
              <Text style={styles.premiumLabel}>{profileCopy.profile.memberTier(subscription.tier)}</Text>
            </View>
          ) : null}
```

Em `apps/mobile/src/copy/profile.ts`, dentro de `profile`, adicionar:

```ts
    memberTier: (tier: 'bronze' | 'silver' | 'gold') =>
      tier === 'gold' ? 'Membro Ouro' : tier === 'silver' ? 'Membro Prata' : 'Membro Bronze',
```

Estilos novos no `StyleSheet` do arquivo:

```ts
  premiumRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  premiumLabel: { color: theme.colors.fg, fontSize: 12, fontWeight: '600' },
```

O hook já é 503-safe, então com a flag de billing desligada nada renderiza e nada quebra.

- [ ] **Step 2: Remover a entrada legada do menu**

Apagar o `<MenuRow>` de `:232-237` que aponta para `/profile/premium`. Não apagar `apps/mobile/src/screens/settings/PremiumScreen.tsx` nem a rota: decisão 3 do spec manda manter os arquivos, só sem link.

Se o import do ícone usado só ali ficar órfão, remover o import.

- [ ] **Step 3: Verificar**

Run: `pnpm --filter @ccc/mobile typecheck`
Run: `pnpm --filter @ccc/mobile lint`
Expected: PASS nos dois.

- [ ] **Step 4: Verificar na mão**

Abrir o Perfil com uma membership ativa: o badge e "Membro Ouro" aparecem sob a cidade. Sem membership, nada aparece. O menu tem uma única entrada premium, a do ícone `Gem` para `/assinaturas`.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(app)/profile/index.tsx" apps/mobile/src/copy/profile.ts
git commit -m "feat(mobile): tier premium no perfil e remocao da entrada legada"
```

---

## Task 17: Documentar o passo de ops no `docs/stripe.md`

**Files:**
- Modify: `docs/stripe.md`

**Interfaces:**
- Consumes: nada.
- Produces: seção de assinaturas multi-tier no doc que o operador segue.

- [ ] **Step 1: Escrever a seção**

Adicionar ao fim de `docs/stripe.md`:

```markdown
## Assinaturas multi-tier com módulos

1. Crie um Product por plano (Ingresso, Estrada, Fundador) e um por módulo (Detailing, Oficina).
2. Em cada um, crie um Price **recorrente, mensal, em BRL**. Todos os prices precisam
   compartilhar o mesmo intervalo e a mesma moeda: o checkout junta plano e módulos numa
   única Checkout Session e o Stripe rejeita uma sessão com intervalos misturados.
3. No Price de cada **plano**, preencha a metadata `devFeePercent` (por exemplo `10`).
   Isso é obrigatório. Sem a metadata, a taxa é gravada como 0 na fatura e na membership.
   Módulos não precisam de metadata.
4. Copie cada `price_...` e cole no admin, em `/premium/catalogo`.
5. Confira em `GET /api/plans` que os três planos aparecem. Se algum `stripePriceId` ficou
   vazio, o checkout responde 503 listando exatamente as chaves que faltam.
6. Webhook: endpoint `/webhooks/stripe-billing`, secret em `STRIPE_BILLING_WEBHOOK_SECRET`,
   eventos `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`,
   `customer.subscription.deleted` e `charge.refunded`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/stripe.md
git commit -m "docs: passo a passo dos price ids de assinatura multi-tier"
```

---

## Verificação final

- [ ] `pnpm --filter @ccc/shared build`
- [ ] `pnpm --filter @ccc/api test` verde
- [ ] `pnpm --filter @ccc/api typecheck` verde
- [ ] `pnpm --filter @ccc/mobile test` verde
- [ ] `pnpm --filter @ccc/mobile typecheck` verde
- [ ] `pnpm --filter @ccc/mobile lint` verde
- [ ] `pnpm --filter @ccc/ui typecheck` verde
- [ ] `pnpm --filter @ccc/admin typecheck` verde
- [ ] `git diff --stat packages/db/prisma/schema.prisma` vazio. Zero migrations é requisito, não meta.
- [ ] Nenhuma resposta de cliente contém `providerInvoiceRef`, `providerTransactionRef`, `stripePriceId` ou `providerItemRef`.
- [ ] Nenhuma rota de cliente escreve `PremiumMembership.status`.
