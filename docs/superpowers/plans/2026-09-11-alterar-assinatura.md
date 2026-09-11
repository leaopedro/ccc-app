# Alterar assinatura e editar módulos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao membro com assinatura viva duas ações que hoje só o admin tem: trocar de plano, com uma tela que explica tudo antes de confirmar, e adicionar ou remover módulos.

**Architecture:** A API ganha `POST /api/me/premium/plan`, que reusa o serviço `changePlan` já existente e devolve `pending` sem escrever no banco, mantendo a invariante de que só webhook verificado altera assinatura. O payload de assinatura passa a expor `status` e `provider`, que é o que permite ao app decidir elegibilidade e barrar membership Apple antes de qualquer chamada. No mobile, a troca ganha tela própria de confirmação, e os módulos ganham ações sobre endpoints que já existem.

**Tech Stack:** Fastify + Prisma + Postgres (Testcontainers nos testes), Zod em `@ccc/shared`, Expo Router + React Native, vitest nos dois lados.

**Spec:** `docs/superpowers/specs/2026-09-11-alterar-assinatura-design.md`

## Global Constraints

- Toda copy nova entra em `apps/mobile/src/copy/assinaturas.ts` em PT-BR **com twin EN** em `assinaturasCopyEn`. É regra declarada no topo do próprio arquivo.
- Testes de API são integração contra Postgres real, via o global setup de Testcontainers. Nunca mock de banco.
- Nenhuma rota escreve em `PremiumMembership` na troca de plano. Só o webhook verificado grava.
- Entrada de compra segue o gate de plataforma: `requireSubscriptionsEnabled` na API, `subscriptionsEnabled` no app. Reduzir compromisso existente não segue.
- `pnpm --filter @ccc/mobile typecheck` e `lint` precisam passar. `lint-staged` roda eslint e prettier no commit.
- Worktree novo precisa de `pnpm install` e do build dos pacotes antes dos testes de mobile: `pnpm --filter @ccc/shared build && pnpm --filter @ccc/design build && pnpm --filter @ccc/ui build`.
- Branch a partir de `main`. PR para `main`. Nunca commitar em `production`.

---

### Task 1: Payload de assinatura expõe `status` e `provider`

Sem esses dois campos o app não consegue nem aplicar a regra de elegibilidade, nem impedir que um assinante Apple anexe módulo pago de graça pelo caminho local-only de `attachAddon`.

**Files:**

- Modify: `packages/shared/src/premium-subscription.ts` (`mySubscriptionResponseSchema`)
- Modify: `apps/api/src/routes/me-premium-addons.ts` (os dois ramos do GET `/api/me/premium/subscription`)
- Modify: `apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx` (fixture `activeSub`)
- Modify: `apps/mobile/src/screens/assinaturas/__tests__/BoasVindasScreen.test.tsx` (fixture `activeSub`)
- Test: `apps/api/test/billing/premium-subscription.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `MySubscriptionResponse.status: LiveMembershipStatus | null` e `MySubscriptionResponse.provider: 'stripe' | 'apple_revenuecat' | null`. Todas as tasks de mobile dependem dos dois.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/test/billing/premium-subscription.test.ts`, logo depois do teste `subscription read: live membership resolves plan + base amount`:

```ts
it('subscription read: exposes the membership status and provider', async () => {
  const { user } = await createUser({ verified: true });
  const g = await garageOf(user.id);
  await seedGoldPlan();
  await seedMembership(g.id, { status: 'past_due' });

  const res = await getSubscription(user.id);
  expect(res.statusCode).toBe(200);
  const body = mySubscriptionResponseSchema.parse(res.json());
  // `active` continua true para qualquer membership viva — e é exatamente
  // por isso que `status` precisa existir: sem ele o app não distingue um
  // membro em dia de um inadimplente.
  expect(body.active).toBe(true);
  expect(body.status).toBe('past_due');
  expect(body.provider).toBe('stripe');
});

it('subscription read: status and provider are null without a membership', async () => {
  const { user } = await createUser({ verified: true });

  const res = await getSubscription(user.id);
  const body = mySubscriptionResponseSchema.parse(res.json());
  expect(body.status).toBeNull();
  expect(body.provider).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test -- premium-subscription`
Expected: FAIL. O `parse` do Zod rejeita antes das asserções, porque `status` e `provider` não existem no schema.

- [ ] **Step 3: Adicionar os campos ao schema**

Em `packages/shared/src/premium-subscription.ts`, dentro de `mySubscriptionResponseSchema`, depois de `cancelAtPeriodEnd`:

```ts
  /**
   * Status da membership viva, ou null quando não há nenhuma. `active: true`
   * acima significa apenas "existe membership viva" e cobre past_due, paused e
   * cancel_scheduled — quem precisa decidir o que o membro pode fazer lê este
   * campo, não aquele.
   */
  status: z.enum([...LIVE_MEMBERSHIP_STATUSES]).nullable(),
  /**
   * Provider da membership. O app usa para barrar ações que só existem na
   * Stripe: para Apple, attach/detach de add-on cai no caminho local-only do
   * serviço (grava no banco, não cobra), então a UI precisa esconder a ação.
   */
  provider: z.enum(['stripe', 'apple_revenuecat']).nullable(),
```

O import de `LIVE_MEMBERSHIP_STATUSES` vem de `./premium.js`. Espalhar com `[...]` é necessário porque a constante é `as const` readonly e `z.enum` pede tupla mutável. Os valores de provider são escritos na mão, como `premiumCheckoutPrecheckResponseSchema` já faz: `@ccc/shared` não depende do client do Prisma.

- [ ] **Step 4: Preencher os dois ramos do serializer**

Em `apps/api/src/routes/me-premium-addons.ts`, no ramo sem membership (o que devolve `active: false`), acrescentar ao objeto passado para `mySubscriptionResponseSchema.parse`:

```ts
            status: null,
            provider: null,
```

E no ramo com membership viva, junto de `active: true`:

```ts
          status: membership.status,
          provider: membership.provider,
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test -- premium-subscription`
Expected: PASS, incluindo os testes que já existiam no arquivo.

- [ ] **Step 6: Consertar as fixtures do mobile**

Os dois arquivos de teste de mobile montam um `MySubscriptionResponse` completo e tipado. Campos novos não-opcionais quebram o typecheck. Em `MinhaAssinaturaScreen.test.tsx` e em `BoasVindasScreen.test.tsx`, dentro do objeto `activeSub`, acrescentar:

```ts
  status: 'active',
  provider: 'stripe',
```

- [ ] **Step 7: Verificar os dois lados**

Run: `pnpm --filter @ccc/shared build && pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile test src/screens/assinaturas`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/premium-subscription.ts apps/api/src/routes/me-premium-addons.ts apps/api/test/billing/premium-subscription.test.ts apps/mobile/src/screens/assinaturas/__tests__/
git commit -m "feat(api): assinatura do membro expoe status e provider"
```

---

### Task 2: Chave de idempotência de `changePlan` deixa de ser eterna

`plan_change_${membershipId}_${tier}_${cadence}` é estável demais. Gold para silver, silver para gold, gold para silver de novo dentro de 24h: a terceira chamada reusa a chave da primeira, a Stripe devolve a resposta em cache, nada muda, nenhum webhook dispara. Com admin era raro. Com membro, não.

**Files:**

- Modify: `apps/api/src/services/billing/subscription-actions.ts` (`changePlan`)
- Test: `apps/api/test/billing/subscription-actions.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `changePlan` continua com a mesma assinatura. Só a chave muda.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/test/billing/subscription-actions.test.ts`, dentro do describe existente. O `seed()` do arquivo já cria membership gold e catálogo com gold e silver:

```ts
it('gera chave de idempotencia nova depois que a troca anterior foi aplicada', async () => {
  const { membershipId } = await seed();
  const stripe = buildFakeStripe();
  stripe.nextRetrievedSubscription = {
    id: 'sub_1',
    items: { data: [{ id: 'si_plan', price: { id: 'price_gold' } }] },
  } as unknown as Stripe.Subscription;

  await changePlan({ membershipId, tier: 'silver', cadence: 'monthly', stripe });

  // O webhook aplicou a troca: a linha muda, e com ela o updatedAt.
  await prisma.premiumMembership.update({
    where: { id: membershipId },
    data: { tier: 'silver' },
  });
  await changePlan({ membershipId, tier: 'gold', cadence: 'monthly', stripe });

  await prisma.premiumMembership.update({
    where: { id: membershipId },
    data: { tier: 'gold' },
  });
  await changePlan({ membershipId, tier: 'silver', cadence: 'monthly', stripe });

  const keys = stripe.calls
    .filter((c) => c.kind === 'updateSubscriptionItemPrice')
    .map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);

  expect(keys).toHaveLength(3);
  // A terceira troca repete tier e cadencia da primeira. Se a chave repetir,
  // a Stripe devolve a resposta em cache e a troca nunca acontece.
  expect(new Set(keys).size).toBe(3);
});

it('repete a chave enquanto a troca ainda nao foi aplicada', async () => {
  const { membershipId } = await seed();
  const stripe = buildFakeStripe();
  stripe.nextRetrievedSubscription = {
    id: 'sub_1',
    items: { data: [{ id: 'si_plan', price: { id: 'price_gold' } }] },
  } as unknown as Stripe.Subscription;

  await changePlan({ membershipId, tier: 'silver', cadence: 'monthly', stripe });
  await changePlan({ membershipId, tier: 'silver', cadence: 'monthly', stripe });

  const keys = stripe.calls
    .filter((c) => c.kind === 'updateSubscriptionItemPrice')
    .map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);

  // Duplo toque antes do webhook chegar: a chave TEM que repetir. É o caso
  // que a idempotência existe para cobrir.
  expect(keys[0]).toBe(keys[1]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test -- subscription-actions`
Expected: o primeiro teste FALHA com `expected 2 to be 3` (a primeira e a terceira chave são idênticas). O segundo teste passa desde já, e é a rede de proteção contra uma correção que quebre o dedupe.

- [ ] **Step 3: Incluir `updatedAt` na chave**

Em `apps/api/src/services/billing/subscription-actions.ts`, dentro de `changePlan`:

```ts
await stripe.updateSubscriptionItemPrice({
  subscriptionItemId: planItemId,
  priceId: targetPriceId,
  // `updatedAt` entra na chave porque tier+cadencia sozinhos se repetem: um
  // membro que vai de gold para silver, volta, e vai de novo reusaria a
  // chave da primeira troca dentro da janela de 24h da Stripe, receberia a
  // resposta em cache, e a assinatura nao mudaria. Enquanto o webhook nao
  // aplica nada, `updatedAt` fica parado e o duplo toque continua
  // deduplicando, que e o que a chave existe para fazer.
  idempotencyKey: `plan_change_${membershipId}_${tier}_${cadence}_${membership.updatedAt.getTime()}`,
});
```

`membership` já está em escopo, vindo de `loadMembership` no topo da função.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test -- subscription-actions`
Expected: PASS nos dois testes novos e em todos os que já existiam.

- [ ] **Step 5: Rodar a suíte de admin, que usa o mesmo serviço**

Run: `pnpm --filter @ccc/api test -- admin/subscriptions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/billing/subscription-actions.ts apps/api/test/billing/subscription-actions.test.ts
git commit -m "fix(api): chave de troca de plano nao sobrevive a troca aplicada"
```

---

### Task 3: `POST /api/me/premium/plan`

**Files:**

- Modify: `packages/shared/src/premium-subscription.ts` (request schema)
- Modify: `apps/api/src/routes/me-premium.ts` (rota nova)
- Test: `apps/api/test/billing/premium-change-plan.test.ts` (criar)

**Interfaces:**

- Consumes: `changePlan` da Task 2, `status`/`provider` da Task 1.
- Produces: `POST /api/me/premium/plan`, body `{ planSlug: string, cadence: 'monthly' | 'annual' }`, resposta `200 { ok: true, pending: true }`. Erros: 503, 422, 404 `NotFound`, 409 `NotStripeSubscription` (com `manageUrl`), 409 `InvalidStatus` (com `status`), 404 `PlanNotFound`, 409 `NoChange`. A Task 4 consome tudo isso.

- [ ] **Step 1: Escrever o schema de request**

Em `packages/shared/src/premium-subscription.ts`:

```ts
/** POST /api/me/premium/plan — troca de plano iniciada pelo membro. */
export const memberChangePlanRequestSchema = z.object({
  planSlug: z.string().min(1),
  cadence: z.enum(['monthly', 'annual']),
});

export type MemberChangePlanRequest = z.infer<typeof memberChangePlanRequestSchema>;
```

`planSlug` e não `tier` porque é o vocabulário que o mobile já usa em `createPremiumCheckout`.

- [ ] **Step 2: Escrever os testes que falham**

Criar `apps/api/test/billing/premium-change-plan.test.ts`. O `seedSubscription` de `apps/api/test/admin/subscriptions/seed.ts` já cria membro gold, catálogo com gold (`fundador`) e silver (`estrada`), e devolve `memberId`:

```ts
/**
 * POST /api/me/premium/plan — troca de plano iniciada pelo membro.
 *
 * A rota nao escreve em PremiumMembership: quem grava tier e snapshot de preco
 * e o webhook. Por isso a resposta e `pending` e os testes afirmam que a linha
 * NAO mudou.
 */

import { prisma } from '@ccc/db';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';
import { seedSubscription } from '../admin/subscriptions/seed.js';

const resetCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

const planItemSubscription = {
  id: 'sub_secreto_1',
  items: { data: [{ id: 'si_plan', price: { id: 'price_gold' } }] },
} as unknown as Stripe.Subscription;

describe('POST /api/me/premium/plan', () => {
  let ctx: Awaited<ReturnType<typeof makeAppWithFakeStripe>>;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    ctx = await makeAppWithFakeStripe();
  });

  afterEach(async () => {
    await ctx.app.close();
    await resetDatabase();
    await resetCatalog();
  });

  const change = (userId: string, payload: unknown) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/me/premium/plan',
      headers: { authorization: bearer(env, userId) },
      payload,
    });

  it('401 sem autenticacao', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/me/premium/plan', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('troca valida responde pending e NAO escreve a membership', async () => {
    const { memberId, membershipId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, pending: true });

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(row.tier).toBe('gold');

    const calls = ctx.stripe.calls.filter((c) => c.kind === 'updateSubscriptionItemPrice');
    expect(calls).toHaveLength(1);
  });

  it('grava auditoria com o proprio membro como ator', async () => {
    const { memberId, membershipId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    const audit = await prisma.adminAudit.findMany({
      where: { entityType: 'premium_membership', entityId: membershipId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('premium.subscription.plan_changed');
    expect(audit[0]?.actorId).toBe(memberId);
  });

  it('409 InvalidStatus para membro past_due', async () => {
    const { memberId } = await seedSubscription({ status: 'past_due' });
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'InvalidStatus', status: 'past_due' });
    expect(ctx.stripe.calls.filter((c) => c.kind === 'updateSubscriptionItemPrice')).toHaveLength(
      0,
    );
  });

  it('permite trocar com cancelamento agendado', async () => {
    const { memberId } = await seedSubscription({ status: 'cancel_scheduled' });
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(200);
  });

  it('409 NotStripeSubscription para membership Apple, com manageUrl', async () => {
    const { memberId } = await seedSubscription({ provider: 'apple_revenuecat' });

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; manageUrl: string };
    expect(body.error).toBe('NotStripeSubscription');
    expect(body.manageUrl).toContain('apps.apple.com');
  });

  it('409 NoChange quando o plano e o mesmo', async () => {
    const { memberId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription;

    const res = await change(memberId, { planSlug: 'fundador', cadence: 'monthly' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'NoChange' });
  });

  it('404 PlanNotFound para slug inexistente', async () => {
    const { memberId } = await seedSubscription();

    const res = await change(memberId, { planSlug: 'nao-existe', cadence: 'monthly' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'PlanNotFound' });
  });

  it('404 quando o usuario nao tem membership viva', async () => {
    const { memberId } = await seedSubscription();
    await prisma.premiumMembership.updateMany({ data: { status: 'expired' } });

    const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

    expect(res.statusCode).toBe(404);
  });

  it('422 para body invalido', async () => {
    const { memberId } = await seedSubscription();

    const res = await change(memberId, { planSlug: '', cadence: 'weekly' });

    expect(res.statusCode).toBe(422);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test -- premium-change-plan`
Expected: FAIL. Todas as chamadas devolvem 404 de rota inexistente.

- [ ] **Step 4: Implementar a rota**

Em `apps/api/src/routes/me-premium.ts`, junto das outras ações de membro. `APPLE_MANAGE_URL`, `requireUser`, `pickLiveMembership`, `handleStaleRef`, `recordAudit` e `sendBillingError` já existem no arquivo ou nos módulos que ele importa; o handler novo é:

```ts
/**
 * POST /api/me/premium/plan
 *
 * Troca de plano iniciada pelo membro. Reusa o mesmo `changePlan` do admin,
 * entao o rateio e o mesmo (create_prorations: a diferenca entra na fatura
 * seguinte, nunca como cobranca imediata).
 *
 * Como /cancel, NAO escreve no banco. O customer.subscription.updated
 * resultante e que grava tier, cadencia e o snapshot de preco. Por isso a
 * resposta e `pending`.
 */
const changePlanHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
    return reply
      .status(503)
      .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
  }

  const { sub } = requireUser(request);

  const parsed = memberChangePlanRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(422).send({
      error: 'UnprocessableEntity',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }

  const garage = await prisma.garage.findUnique({ where: { userId: sub }, select: { id: true } });
  if (!garage) {
    return reply.status(404).send({ error: 'NotFound', message: 'no membership found' });
  }

  const membership = await pickLiveMembership(prisma, garage.id);
  if (!membership) {
    return reply.status(404).send({ error: 'NotFound', message: 'no active membership found' });
  }

  if (membership.provider !== 'stripe') {
    return reply.status(409).send({
      error: 'NotStripeSubscription',
      message: 'manage your subscription in the App Store',
      manageUrl: APPLE_MANAGE_URL,
    });
  }

  // Mais estrito que ADMIN_SUBSCRIPTION_ALLOWED_STATUS.plan, que tambem
  // aceita past_due. A regra de membro e propria de proposito: quem esta com
  // cobranca pendente regulariza antes de mexer no plano. Nao reusar a
  // constante do admin aqui e deliberado — reusar esconderia a divergencia.
  const MEMBER_CHANGE_PLAN_STATUS = ['active', 'cancel_scheduled'] as const;
  if (!(MEMBER_CHANGE_PLAN_STATUS as readonly string[]).includes(membership.status)) {
    return reply.status(409).send({
      error: 'InvalidStatus',
      message: `plan change not allowed while subscription is ${membership.status}`,
      status: membership.status,
    });
  }

  const targetPlan = await prisma.premiumPlan.findFirst({
    where: { slug: parsed.data.planSlug, active: true },
    select: { tier: true },
  });
  if (!targetPlan) {
    return reply.status(404).send({ error: 'PlanNotFound', message: 'plan not available' });
  }

  try {
    await changePlan({
      membershipId: membership.id,
      tier: targetPlan.tier,
      cadence: parsed.data.cadence,
      stripe: app.stripe,
    });
  } catch (err) {
    if (sendBillingError(err, reply)) return reply;
    throw err;
  }

  await recordAudit({
    actorId: sub,
    action: 'premium.subscription.plan_changed',
    entityType: 'premium_membership',
    entityId: membership.id,
    metadata: {
      fromTier: membership.tier,
      fromCadence: membership.cadence,
      toTier: targetPlan.tier,
      toCadence: parsed.data.cadence,
    },
  });

  return reply.status(200).send({ ok: true, pending: true });
};
```

Registro, dentro do mesmo escopo com rate limit por usuário que o arquivo já usa para as outras ações de compra (ver o bloco `app.register(async (scoped) => ...)` no fim do arquivo). `requireSubscriptionsEnabled` entra como `preHandler` da rota, porque trocar de plano é entrada de compra:

```ts
scoped.post('/api/me/premium/plan', { preHandler: requireSubscriptionsEnabled }, changePlanHandler);
```

`sendBillingError` hoje mora em `apps/api/src/routes/admin/subscriptions.ts`. Mover para `apps/api/src/services/billing/errors.ts` e importar nos dois lugares, para os códigos (`NoChange`, `PlanPriceMissing`, `PlanItemNotFound`) não divergirem entre as superfícies. Ajustar o import do admin na mesma mudança.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test -- premium-change-plan`
Expected: PASS nos dez testes.

- [ ] **Step 6: Confirmar que o admin não quebrou com a mudança do `sendBillingError`**

Run: `pnpm --filter @ccc/api test -- admin/subscriptions`
Expected: PASS.

- [ ] **Step 7: Cobrir o gate de plataforma**

Em `apps/api/test/billing/me-premium-platform-gate.test.ts`, seguindo o padrão dos casos que já existem no arquivo (flipar `PREMIUM_SUBSCRIPTIONS_IOS`, injetar com o header de plataforma que o arquivo já usa), acrescentar um caso afirmando que `POST /api/me/premium/plan` é recusado na plataforma barrada e aceito na liberada. Copiar a mecânica do caso de `/checkout` do mesmo arquivo.

Run: `pnpm --filter @ccc/api test -- me-premium-platform-gate`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/premium-subscription.ts apps/api/src/routes/me-premium.ts apps/api/src/routes/admin/subscriptions.ts apps/api/src/services/billing/errors.ts apps/api/test/billing/
git commit -m "feat(api): membro troca de plano por POST /api/me/premium/plan"
```

---

### Task 4: Cliente mobile, mapeamento de erro e poll por tier

**Files:**

- Modify: `apps/mobile/src/api/premium.ts` (`changePremiumPlan`)
- Create: `apps/mobile/src/screens/assinaturas/plan-change-error.ts`
- Modify: `apps/mobile/src/screens/assinaturas/poll-subscription.ts` (`pollSubscriptionTier`)
- Modify: `apps/mobile/src/copy/assinaturas.ts` (bloco `alterar`, PT + twin EN)
- Test: `apps/mobile/src/screens/assinaturas/plan-change-error.test.ts` (criar)
- Test: `apps/mobile/src/screens/assinaturas/poll-subscription-tier.test.ts` (criar)

**Interfaces:**

- Consumes: a rota da Task 3.
- Produces:
  - `changePremiumPlan(input: { planSlug: string; cadence: 'monthly' | 'annual' }): Promise<{ ok: boolean; pending: boolean }>`
  - `resolvePlanChangeError(error: unknown): PlanChangeError`, com `PlanChangeError = { reason: 'not_stripe' | 'invalid_status' | 'no_change' | 'plan_not_found' | 'unavailable' | 'rate_limited' | 'unauthorized' | 'generic'; message: string; manageUrl?: string }`
  - `pollSubscriptionTier(targetTier: string): Promise<boolean>`
  - `assinaturasCopy.alterar.*`
  - A Task 5 consome os quatro.

- [ ] **Step 1: Escrever o teste do mapeamento de erro**

Criar `apps/mobile/src/screens/assinaturas/plan-change-error.test.ts`, espelhando `checkout-error.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ApiError } from '~/api/client';
import { assinaturasCopy } from '~/copy/assinaturas';
import { resolvePlanChangeError } from './plan-change-error';

const copy = assinaturasCopy.alterar;

describe('resolvePlanChangeError', () => {
  it('carrega o manageUrl da App Store no caso Apple', () => {
    const err = new ApiError(409, 'conflict', {
      error: 'NotStripeSubscription',
      manageUrl: 'https://apps.apple.com/account/subscriptions',
    });
    const resolved = resolvePlanChangeError(err);
    expect(resolved.reason).toBe('not_stripe');
    expect(resolved.manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('distingue status invalido de conflito generico', () => {
    const err = new ApiError(409, 'conflict', { error: 'InvalidStatus', status: 'past_due' });
    expect(resolvePlanChangeError(err).reason).toBe('invalid_status');
    expect(resolvePlanChangeError(err).message).toBe(copy.errorPastDue);
  });

  it('nao manda tentar de novo quando o plano ja e o atual', () => {
    const err = new ApiError(409, 'conflict', { error: 'NoChange' });
    const resolved = resolvePlanChangeError(err);
    expect(resolved.reason).toBe('no_change');
    expect(resolved.message).toBe(copy.errorNoChange);
  });

  it('cai no generico para status desconhecido', () => {
    expect(resolvePlanChangeError(new Error('boom')).reason).toBe('generic');
  });
});
```

- [ ] **Step 2: Escrever o teste do poll por tier**

Criar `apps/mobile/src/screens/assinaturas/poll-subscription-tier.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMyPremiumSubscription = vi.hoisted(() => vi.fn());

vi.mock('~/api/premium-catalog', () => ({ getMyPremiumSubscription }));

import { pollSubscriptionTier } from './poll-subscription';

describe('pollSubscriptionTier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getMyPremiumSubscription.mockReset();
  });

  it('resolve true assim que o tier do servidor bate com o alvo', async () => {
    getMyPremiumSubscription
      .mockResolvedValueOnce({ active: true, tier: 'gold' })
      .mockResolvedValueOnce({ active: true, tier: 'silver' });

    const promise = pollSubscriptionTier('silver');
    await vi.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.toBe(true);
    expect(getMyPremiumSubscription).toHaveBeenCalledTimes(2);
  });

  it('resolve false quando as tentativas acabam com o tier antigo', async () => {
    getMyPremiumSubscription.mockResolvedValue({ active: true, tier: 'gold' });

    const promise = pollSubscriptionTier('silver');
    await vi.advanceTimersByTimeAsync(2000 * 16);

    await expect(promise).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/plan-change-error.test.ts src/screens/assinaturas/poll-subscription-tier.test.ts`
Expected: FAIL. `resolvePlanChangeError` e `pollSubscriptionTier` não existem, e `assinaturasCopy.alterar` é `undefined`.

- [ ] **Step 4: Escrever a copy**

Em `apps/mobile/src/copy/assinaturas.ts`, bloco novo `alterar` no mesmo nível de `contratar`:

```ts
  // Troca de plano de quem ja assina. A tela inteira e a confirmacao: ela
  // precisa dizer o que muda no valor, o que se ganha, o que se perde, e
  // quando passa a valer, ANTES de qualquer chamada.
  alterar: {
    header: 'ALTERAR ASSINATURA',
    back: 'Voltar',
    fromLabel: 'PLANO ATUAL',
    toLabel: 'NOVO PLANO',
    valueTitle: 'O QUE MUDA NO VALOR',
    currentMonthly: 'Mensalidade de hoje',
    newMonthly: 'Nova mensalidade',
    difference: 'Diferença',
    modulesKept: 'Módulos mantidos',
    newTotal: 'Novo total por mês',
    gainTitle: 'O QUE VOCÊ GANHA',
    loseTitle: 'O QUE VOCÊ PERDE',
    keptTitle: 'SEUS MÓDULOS CONTINUAM',
    whenTitle: 'QUANDO VALE',
    // Precisa dizer que nada e cobrado agora: create_prorations lanca a
    // diferenca na fatura seguinte, nunca fora do ciclo.
    whenBody:
      'A troca vale assim que você confirmar. Nada é cobrado agora: a diferença proporcional entra como crédito ou débito na sua próxima fatura.',
    cancelScheduledNote:
      'Seu cancelamento continua agendado. Trocar de plano não desfaz o cancelamento.',
    cta: 'CONFIRMAR ALTERAÇÃO',
    ctaLoading: 'ALTERANDO...',
    back2: 'VOLTAR',
    confirming: 'Confirmando a alteração...',
    pendingTitle: 'Alteração em processamento.',
    pendingSubcopy: 'Assim que ela for confirmada, seu plano novo aparece aqui.',
    pendingCta: 'VER MINHA ASSINATURA',
    successToast: 'Plano alterado.',
    appleTitle: 'Assinatura pela App Store',
    appleBody: 'Esta assinatura foi contratada pela App Store. A troca de plano é feita por lá.',
    appleCta: 'ABRIR APP STORE',
    errorPastDue:
      'Há uma cobrança pendente na sua assinatura. Regularize o pagamento antes de trocar de plano.',
    errorNoChange: 'Esse já é o seu plano atual.',
    errorPlanNotFound: 'Esse plano não está mais disponível.',
    errorUnavailable: 'A alteração está indisponível agora. Tente mais tarde.',
    errorRateLimited: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
    errorUnauthorized: 'Sua sessão expirou. Entre de novo para continuar.',
    errorGeneric: 'Não foi possível alterar seu plano. Tente novamente.',
  },
```

E o twin em `assinaturasCopyEn`:

```ts
  alterar: {
    header: 'CHANGE MEMBERSHIP',
    fromLabel: 'CURRENT PLAN',
    toLabel: 'NEW PLAN',
    valueTitle: 'WHAT CHANGES IN THE PRICE',
    currentMonthly: "Today's monthly",
    newMonthly: 'New monthly',
    difference: 'Difference',
    modulesKept: 'Modules kept',
    newTotal: 'New monthly total',
    gainTitle: 'WHAT YOU GAIN',
    loseTitle: 'WHAT YOU LOSE',
    keptTitle: 'YOUR MODULES STAY',
    whenTitle: 'WHEN IT APPLIES',
    whenBody:
      'The change applies as soon as you confirm. Nothing is charged now: the prorated difference lands as a credit or a charge on your next invoice.',
    cancelScheduledNote:
      'Your cancellation stays scheduled. Changing plan does not undo the cancellation.',
    cta: 'CONFIRM CHANGE',
    successToast: 'Plan changed.',
    errorPastDue:
      'Your membership has an outstanding charge. Settle the payment before changing plan.',
    errorNoChange: 'That is already your current plan.',
  },
```

- [ ] **Step 5: Implementar o cliente, o mapeamento e o poll**

Em `apps/mobile/src/api/premium.ts`:

```ts
/**
 * POST /api/me/premium/plan — troca de plano. A resposta e `pending`: quem
 * grava o tier novo e o webhook, entao a tela poll antes de mostrar sucesso.
 */
export const changePremiumPlan = (input: {
  planSlug: string;
  cadence: 'monthly' | 'annual';
}): Promise<{ ok: boolean; pending: boolean }> =>
  authedRequest('/api/me/premium/plan', z.object({ ok: z.boolean(), pending: z.boolean() }), {
    method: 'POST',
    body: { planSlug: input.planSlug, cadence: input.cadence },
  });
```

Criar `apps/mobile/src/screens/assinaturas/plan-change-error.ts` com a mesma estrutura de `checkout-error.ts`: helper `body()` que extrai o corpo de um `ApiError`, `switch` no status, e dentro do 409 um `if` por `b.error` para separar `NotStripeSubscription` (carrega `manageUrl`), `InvalidStatus` (usa `copy.errorPastDue`) e `NoChange`. 503 vira `unavailable`, 429 `rate_limited`, 404 `plan_not_found`, 401 `unauthorized`, resto `generic`.

Em `poll-subscription.ts`, ao lado do poller que já existe:

```ts
/**
 * Resolve true quando o tier do servidor bate com o alvo, false quando as
 * tentativas acabam. `pollSubscriptionActive` nao serve para a troca de plano:
 * a assinatura esta viva o tempo todo, e o que muda e o tier.
 */
export async function pollSubscriptionTier(targetTier: string): Promise<boolean> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    try {
      const sub = await getMyPremiumSubscription();
      if (sub.tier === targetTier) return true;
    } catch {
      // Falha transitoria — segue tentando; quem chama mostra o estado pendente.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/plan-change-error.test.ts src/screens/assinaturas/poll-subscription-tier.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/api/premium.ts apps/mobile/src/screens/assinaturas/plan-change-error.ts apps/mobile/src/screens/assinaturas/plan-change-error.test.ts apps/mobile/src/screens/assinaturas/poll-subscription.ts apps/mobile/src/screens/assinaturas/poll-subscription-tier.test.ts apps/mobile/src/copy/assinaturas.ts
git commit -m "feat(mobile): cliente, erros e poll da troca de plano"
```

---

### Task 5: `AlterarPlanoScreen`, a tela de confirmação

O ponto da task: **nenhuma chamada de mutação sai antes do toque no CTA**, e o membro vê o que perde antes de confirmar.

**Files:**

- Create: `apps/mobile/src/screens/assinaturas/AlterarPlanoScreen.tsx`
- Create: `apps/mobile/app/(app)/assinaturas/alterar.tsx`
- Test: `apps/mobile/src/screens/assinaturas/__tests__/AlterarPlanoScreen.test.tsx` (criar)

**Interfaces:**

- Consumes: `changePremiumPlan`, `resolvePlanChangeError`, `pollSubscriptionTier`, `assinaturasCopy.alterar`, `usePremiumSubscription`, `getPremiumPlan`, `usePremiumPlans` (para `subscriptionsEnabled`).
- Produces: rota `/assinaturas/alterar?slug={slug}`. A Task 6 aponta para ela.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/mobile/src/screens/assinaturas/__tests__/AlterarPlanoScreen.test.tsx`. Copiar o harness de mocks de `BoasVindasScreen.test.tsx` (mock de `react-native`, de `lucide-react-native`, de `expo-router`) e acrescentar os mocks de `~/api/premium`, `~/api/premium-catalog`, `~/hooks/usePremiumSubscription`, `~/hooks/usePremiumPlans` e `~/screens/assinaturas/poll-subscription`. Os testes:

```ts
it('mostra o que ganha e o que perde antes de qualquer chamada', async () => {
  // assinatura atual gold com dois beneficios; plano alvo silver com um deles
  // mais um novo.
  await render();

  expect(text()).toContain(copy.gainTitle);
  expect(text()).toContain('Convite para o track day');
  expect(text()).toContain(copy.loseTitle);
  expect(text()).toContain('Estacionamento prioritário em eventos');
  // O que importa nesta linha: montar a tela nao muda nada no servidor.
  expect(changePremiumPlan).not.toHaveBeenCalled();
});

it('esconde o bloco de perda quando o upgrade so acrescenta', async () => {
  // alvo contem todos os beneficios atuais mais um.
  await render();

  expect(text()).toContain(copy.gainTitle);
  expect(text()).not.toContain(copy.loseTitle);
});

it('so chama a API no toque do CTA, e navega apos o poll', async () => {
  changePremiumPlan.mockResolvedValue({ ok: true, pending: true });
  pollSubscriptionTier.mockResolvedValue(true);
  await render();
  expect(changePremiumPlan).not.toHaveBeenCalled();

  await click('alterar-cta');

  expect(changePremiumPlan).toHaveBeenCalledWith({ planSlug: 'estrada', cadence: 'monthly' });
  expect(pollSubscriptionTier).toHaveBeenCalledWith('silver');
  expect(showToast).toHaveBeenCalledWith(copy.successToast);
  expect(replace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
});

it('cai no estado pendente quando o poll estoura', async () => {
  changePremiumPlan.mockResolvedValue({ ok: true, pending: true });
  pollSubscriptionTier.mockResolvedValue(false);
  await render();

  await click('alterar-cta');

  expect(text()).toContain(copy.pendingTitle);
  expect(replace).not.toHaveBeenCalled();
});

it('nao chama a API para membership Apple, e oferece a App Store', async () => {
  setSubscription({ provider: 'apple_revenuecat' });
  await render();

  expect(text()).toContain(copy.appleBody);
  expect(container.querySelector('[data-testid="alterar-cta"]')).toBeNull();
  expect(changePremiumPlan).not.toHaveBeenCalled();
});

it('bloqueia membro past_due com copy propria e sem CTA', async () => {
  setSubscription({ status: 'past_due' });
  await render();

  expect(text()).toContain(copy.errorPastDue);
  expect(container.querySelector('[data-testid="alterar-cta"]')).toBeNull();
});

it('avisa que o cancelamento agendado continua de pe', async () => {
  setSubscription({ status: 'cancel_scheduled', cancelAtPeriodEnd: true });
  await render();

  expect(text()).toContain(copy.cancelScheduledNote);
});

it('ignora o segundo toque no CTA', async () => {
  let resolveChange: (v: unknown) => void = () => {};
  changePremiumPlan.mockImplementation(
    () =>
      new Promise((r) => {
        resolveChange = r;
      }),
  );
  await render();

  await clickTwice('alterar-cta');

  expect(changePremiumPlan).toHaveBeenCalledTimes(1);
  resolveChange({ ok: true, pending: true });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/AlterarPlanoScreen.test.tsx`
Expected: FAIL, com erro de resolução do módulo `../AlterarPlanoScreen`.

- [ ] **Step 3: Implementar a tela**

Criar `apps/mobile/src/screens/assinaturas/AlterarPlanoScreen.tsx`. Estrutura, seguindo o vocabulário visual de `tier-visual.ts` e a forma de `ContratarScreen`:

- `usePremiumSubscription()` para a assinatura atual, `getPremiumPlan(slug)` num `useEffect` para o alvo, `usePremiumPlans()` para `subscriptionsEnabled`. Enquanto qualquer um dos dois carrega, `ActivityIndicator`.
- Derivar: `visualAtual`, `visualAlvo`, `mensalidadeAtual = subscription.baseAmountCents`, `mensalidadeNova = monthlyPriceCents(planoAlvo)`, `diferenca = nova - atual`, `modulos = subscription.addons`, `modulosCents = subscription.addonsAmountCents`, `novoTotal = nova + modulosCents`.
- Diff de benefícios por igualdade de texto. Os rótulos vêm do mesmo cadastro em `/premium/catalogo`, então o texto serve de identidade; quem reescrever a redação de um benefício faz ele aparecer como perdido e ganhado ao mesmo tempo, e isso está registrado nos Riscos da spec.

```tsx
const atuais = subscription?.benefits ?? [];
const alvos = orderedBenefits(planoAlvo);
const ganha = alvos.filter((b) => !atuais.includes(b));
const perde = atuais.filter((b) => !alvos.includes(b));
```

Renderizar o bloco `loseTitle` só quando `perde.length > 0`. Num upgrade puro ele não existe; num downgrade ele é o motivo de a tela existir.

- Ordem das seções, exatamente a da spec: header, `DE`/`PARA`, `O QUE MUDA NO VALOR`, ganho, perda, `SEUS MÓDULOS CONTINUAM`, `QUANDO VALE`, nota de cancelamento agendado quando `cancelAtPeriodEnd`, CTA `alterar-cta` e o secundário de voltar.
- Desvios avaliados antes de renderizar o CTA: `provider !== 'stripe'` troca o CTA pelo bloco Apple com `Linking.openURL(APPLE_MANAGE_URL)`; `status` fora de `active`/`cancel_scheduled` troca por `copy.errorPastDue` sem CTA; `subscriptionsEnabled` false renderiza o bloco de indisponível igual ao de `ContratarScreen`.
- `onSubmit`, com a guarda de duplo toque no mesmo formato de `ContratarScreen.onSubmit` (ref checada e setada no mesmo tick, antes do primeiro `await`; o state de `submitting` serve só para rótulo e disabled):

```tsx
const onSubmit = async () => {
  if (submittingRef.current) return;
  submittingRef.current = true;
  setSubmitting(true);
  setError(null);
  try {
    await changePremiumPlan({ planSlug: planoAlvo.slug, cadence: 'monthly' });
    // A resposta e `pending`: quem grava o tier novo e o webhook. Ate ele
    // chegar, nada mudou do ponto de vista do app.
    setPhase('confirming');
    const trocou = await pollSubscriptionTier(planoAlvo.tier);
    if (trocou) {
      showToast(copy.successToast);
      router.replace('/assinaturas/minha-assinatura');
    } else {
      setPhase('pending');
    }
  } catch (err) {
    setError(resolvePlanChangeError(err));
    setPhase('form');
  } finally {
    submittingRef.current = false;
    setSubmitting(false);
  }
};
```

As fases `confirming` e `pending` renderizam como em `ContratarScreen`: spinner com `copy.confirming`, e o estado pendente com `copy.pendingTitle`, `copy.pendingSubcopy` e um CTA para Minha Assinatura.

Criar `apps/mobile/app/(app)/assinaturas/alterar.tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';

import AlterarPlanoScreen from '~/screens/assinaturas/AlterarPlanoScreen';

// Confirmacao da troca de plano. Sem gate de rota: quem nao pode trocar ve o
// motivo dentro da tela (Apple, past_due, plataforma barrada), o que e mais
// util do que ser jogado para outro lugar sem explicacao.
export default function AlterarRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  return <AlterarPlanoScreen slug={slug} />;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/AlterarPlanoScreen.test.tsx`
Expected: PASS nos oito testes.

- [ ] **Step 5: Typecheck e lint**

Run: `pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint`
Expected: 0 erros. `typegen.js` precisa ver a rota nova; se algum `router.push` reclamar de tipo, é porque o destino não existe.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/assinaturas/AlterarPlanoScreen.tsx "apps/mobile/app/(app)/assinaturas/alterar.tsx" apps/mobile/src/screens/assinaturas/__tests__/AlterarPlanoScreen.test.tsx
git commit -m "feat(mobile): tela de confirmacao da troca de plano"
```

---

### Task 6: Entradas para a troca

**Files:**

- Modify: `apps/mobile/src/screens/assinaturas/PlanosScreen.tsx`
- Modify: `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx`
- Modify: `apps/mobile/src/copy/assinaturas.ts` (`plans.currentBadge`, `plans.changePrefix`)
- Test: `apps/mobile/src/screens/assinaturas/__tests__/PlanosScreen.test.tsx`
- Test: `apps/mobile/src/screens/assinaturas/__tests__/ContratarScreen.test.tsx`

**Interfaces:**

- Consumes: a rota `/assinaturas/alterar` da Task 5.
- Produces: nada que tasks posteriores consumam.

- [ ] **Step 1: Escrever os testes que falham**

Em `PlanosScreen.test.tsx`, com a assinatura mockada ativa em gold e `showAll` ligado:

```ts
it('marca o plano atual e nao oferece assinar de novo', async () => {
  await renderWithSubscription({ active: true, tier: 'gold', planSlug: 'fundador' });

  expect(text()).toContain(assinaturasCopy.plans.currentBadge);
  const atual = container.querySelector('[data-testid="plano-cta-fundador"]');
  expect(atual).toBeNull();
});

it('leva para a tela de alteracao nos outros planos', async () => {
  await renderWithSubscription({ active: true, tier: 'gold', planSlug: 'fundador' });

  const cta = container.querySelector('[data-testid="plano-cta-estrada"]') as HTMLElement;
  cta.click();

  expect(push).toHaveBeenCalledWith('/assinaturas/alterar?slug=estrada');
});
```

Em `ContratarScreen.test.tsx`:

```ts
it('redireciona assinante ativo para a tela de alteracao', async () => {
  setSubscription({ active: true, tier: 'gold', planSlug: 'fundador' });
  await renderScreen();

  expect(routerReplace).toHaveBeenCalledWith('/assinaturas/alterar?slug=fundador');
  expect(container.querySelector('[data-testid="contratar-cta"]')).toBeNull();
});
```

Nenhum dos dois arquivos mocka `usePremiumSubscription` hoje. Acrescentar o mock nos dois, com `active: false` como padrão no `beforeEach`, para que todos os testes que já existem continuem vendo a tela de compra. `PlanosScreen.test.tsx` já mocka `expo-router` com `replace`; incluir `push` no mesmo mock, porque é ele que o CTA de troca usa.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/PlanosScreen.test.tsx src/screens/assinaturas/__tests__/ContratarScreen.test.tsx`
Expected: FAIL nos três testes novos.

- [ ] **Step 3: Copy nova**

Em `assinaturasCopy.plans`:

```ts
    currentBadge: 'SEU PLANO ATUAL',
    // Rotulo do CTA quando ja existe assinatura: "TROCAR PARA {TIER}".
    changePrefix: 'TROCAR PARA',
```

Twin EN em `assinaturasCopyEn.plans`: `currentBadge: 'YOUR CURRENT PLAN'`, `changePrefix: 'SWITCH TO'`.

- [ ] **Step 4: Implementar**

Em `PlanosScreen.tsx`, dentro do map dos cards: quando `subscription?.active` e `plan.slug === subscription.planSlug`, renderizar o selo `currentBadge` no lugar do CTA. Quando `subscription?.active` e o slug é outro, o CTA usa `changePrefix` e navega para `/assinaturas/alterar?slug=${plan.slug}`. Sem assinatura ativa, tudo segue como está hoje.

Em `ContratarScreen.tsx`, junto dos outros `useEffect` do topo:

```tsx
// Assinante ativo nao monta pacote: ate hoje ele percorria a tela inteira
// para so no fim bater no 409 AlreadySubscribed do checkout. O redirect leva
// direto para a confirmacao da troca, inclusive quem chega por deep link.
useEffect(() => {
  if (subLoading || !subscription?.active || !slug) return;
  router.replace(`/assinaturas/alterar?slug=${slug}`);
}, [subLoading, subscription?.active, slug]);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas`
Expected: PASS, incluindo os testes que já existiam nos dois arquivos.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/assinaturas/PlanosScreen.tsx apps/mobile/src/screens/assinaturas/ContratarScreen.tsx apps/mobile/src/copy/assinaturas.ts apps/mobile/src/screens/assinaturas/__tests__/
git commit -m "feat(mobile): planos e contratar levam assinante para a alteracao"
```

---

### Task 7: Remover módulo em Minha Assinatura

**Files:**

- Modify: `apps/mobile/src/api/premium.ts` (`detachPremiumAddon`)
- Create: `apps/mobile/src/screens/assinaturas/addon-error.ts`
- Modify: `apps/mobile/src/screens/assinaturas/MinhaAssinaturaScreen.tsx`
- Modify: `apps/mobile/src/copy/assinaturas.ts` (`minhaAssinatura.modulos`, PT + twin EN)
- Test: `apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`

**Interfaces:**

- Consumes: `provider` da Task 1.
- Produces:
  - `detachPremiumAddon(addonKey: string): Promise<AddonMutationResponse>`
  - `resolveAddonError(error: unknown, action: 'attach' | 'detach'): { reason: string; message: string }` — a ação é parâmetro porque um 404 significa coisas diferentes nos dois lados: no attach é módulo fora do catálogo, no detach é módulo que não está anexado
  - `assinaturasCopy.minhaAssinatura.modulos.*`
  - A Task 8 consome os três.

- [ ] **Step 1: Escrever os testes que falham**

Em `MinhaAssinaturaScreen.test.tsx`:

```ts
it('confirma antes de remover, e so chama a API no confirmar', async () => {
  detachPremiumAddon.mockResolvedValue({
    addonKey: 'detailing',
    status: 'cancel_scheduled',
    addonsAmountCents: 0,
    totalAmountCents: 29900,
  });
  await renderScreen();

  await click('modulo-remover-detailing');
  expect(detachPremiumAddon).not.toHaveBeenCalled();
  // O sheet precisa dizer as duas coisas que surpreendem: a cota sobrevive ao
  // ciclo, e nao da para desfazer antes disso.
  expect(text()).toContain(copy.modulos.removerBody);
  expect(text()).toContain(copy.modulos.removerSemVolta);

  await click('modulo-remover-confirmar');
  expect(detachPremiumAddon).toHaveBeenCalledWith('detailing');
  expect(refresh).toHaveBeenCalled();
});

it('nao oferece remover num modulo ja com cancelamento agendado', async () => {
  setSubscription({ addons: [{ ...addon, status: 'cancel_scheduled' }] });
  await renderScreen();

  expect(container.querySelector('[data-testid="modulo-remover-detailing"]')).toBeNull();
});

it('esconde a acao de remover em membership Apple', async () => {
  setSubscription({ provider: 'apple_revenuecat' });
  await renderScreen();

  expect(container.querySelector('[data-testid="modulo-remover-detailing"]')).toBeNull();
  expect(text()).toContain(copy.modulos.appleNote);
});

it('mostra erro sem derrubar a tela quando a remocao falha', async () => {
  detachPremiumAddon.mockRejectedValue(new ApiError(404, 'not found', { error: 'NotFound' }));
  await renderScreen();

  await click('modulo-remover-detailing');
  await click('modulo-remover-confirmar');

  expect(text()).toContain(copy.modulos.errorNaoAnexado);
  expect(text()).toContain('Detailing');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`
Expected: FAIL nos quatro testes novos.

- [ ] **Step 3: Copy nova**

Em `assinaturasCopy.minhaAssinatura`, bloco `modulos`:

```ts
    // Add/remove de modulo. Os dois endpoints sao sincronos e escrevem o banco
    // na hora, diferente da troca de plano — nao ha poll aqui.
    modulos: {
      disponiveisTitle: 'MÓDULOS DISPONÍVEIS',
      adicionar: 'ADICIONAR',
      remover: 'REMOVER',
      adicionarTitle: 'Adicionar módulo',
      adicionarBody: (nome: string, valor: string, total: string) =>
        `${nome} custa ${valor} por mês. Seu novo total fica ${total} por mês, com a cobrança começando agora e rateada na próxima fatura.`,
      adicionarConfirmar: 'ADICIONAR MÓDULO',
      removerTitle: 'Remover módulo',
      // A cota sobreviver ao ciclo e generosidade do servidor, nao erro: o item
      // sai da Stripe na hora, mas o add-on fica cancel_scheduled.
      removerBody: (nome: string, total: string) =>
        `A cobrança de ${nome} para agora e seu total cai para ${total} por mês. Você continua usando a cota deste módulo até o fim do ciclo atual.`,
      removerSemVolta: 'Não é possível desfazer antes do fim do ciclo.',
      removerConfirmar: 'REMOVER MÓDULO',
      manter: 'MANTER MÓDULO',
      loading: 'PROCESSANDO...',
      appleNote: 'Módulos de assinaturas da App Store são gerenciados por lá.',
      errorJaAnexado: 'Esse módulo já está na sua assinatura.',
      errorNaoAnexado: 'Esse módulo não está na sua assinatura.',
      errorIndisponivel: 'Esse módulo não está disponível agora.',
      errorRateLimited: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
      errorGeneric: 'Não foi possível atualizar seus módulos. Tente novamente.',
    },
```

Twin EN com as mesmas chaves em `assinaturasCopyEn.minhaAssinatura`.

- [ ] **Step 4: Implementar**

Em `apps/mobile/src/api/premium.ts`:

```ts
/** DELETE /api/me/premium/addons/:key — agenda o cancelamento do modulo. */
export const detachPremiumAddon = (addonKey: string): Promise<AddonMutationResponse> =>
  authedRequest(`/api/me/premium/addons/${addonKey}`, addonMutationResponseSchema, {
    method: 'DELETE',
  });
```

Criar `addon-error.ts` com `resolveAddonError(error: unknown, action: 'attach' | 'detach')`, mapeando: 409 com `error: 'AlreadyExists'` → `errorJaAnexado`; 409 `NoActiveMembership` → `errorGeneric`; 404 → `errorNaoAnexado` quando `action === 'detach'` e `errorIndisponivel` quando `'attach'`; 429 → `errorRateLimited`; 503 → `errorIndisponivel`; resto → `errorGeneric`. Nesta task só o caminho `'detach'` é exercido; a Task 8 exercita o outro.

Em `MinhaAssinaturaScreen.tsx`, dentro de `AddonRow`: quando `addon.status === 'active'` e `sub.provider === 'stripe'`, renderizar o `REMOVER` com `testID={'modulo-remover-' + addon.key}`. O `SheetShell` de confirmação reusa o padrão do sheet de cancelamento que já existe no arquivo, com o mesmo guard de duplo toque por ref. No confirmar: `detachPremiumAddon(addon.key)`, e em seguida `refresh()` do hook. Em erro, `resolveAddonError` e a mensagem dentro do sheet, sem fechar. Quando `sub.provider !== 'stripe'`, a seção mostra `appleNote` e nenhuma ação.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/premium.ts apps/mobile/src/screens/assinaturas/addon-error.ts apps/mobile/src/screens/assinaturas/MinhaAssinaturaScreen.tsx apps/mobile/src/copy/assinaturas.ts apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx
git commit -m "feat(mobile): remover modulo em minha assinatura"
```

---

### Task 8: Adicionar módulo em Minha Assinatura

**Files:**

- Modify: `apps/mobile/src/api/premium.ts` (`attachPremiumAddon`)
- Modify: `apps/mobile/src/screens/assinaturas/MinhaAssinaturaScreen.tsx`
- Test: `apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`

**Interfaces:**

- Consumes: `resolveAddonError` e a copy da Task 7, `subscriptionsEnabled` de `usePremiumPlans` (o hook já é consumido por esta tela), `usePremiumAddonModules` para o catálogo.
- Produces: `attachPremiumAddon(addonKey: string): Promise<AddonMutationResponse>`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
  it('lista so os modulos do catalogo que ainda nao estao anexados', async () => {
    setModules([{ key: 'detailing', ... }, { key: 'lavagem', ... }]);
    setSubscription({ addons: [addonDetailing] });
    await renderScreen();

    expect(text()).toContain(copy.modulos.disponiveisTitle);
    expect(container.querySelector('[data-testid="modulo-adicionar-lavagem"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="modulo-adicionar-detailing"]')).toBeNull();
  });

  it('confirma com os numeros antes de adicionar', async () => {
    attachPremiumAddon.mockResolvedValue({
      addonKey: 'lavagem',
      status: 'active',
      addonsAmountCents: 1990,
      totalAmountCents: 31890,
    });
    await renderScreen();

    await click('modulo-adicionar-lavagem');
    expect(attachPremiumAddon).not.toHaveBeenCalled();
    expect(text()).toContain('R$ 19,90');

    await click('modulo-adicionar-confirmar');
    expect(attachPremiumAddon).toHaveBeenCalledWith('lavagem');
    expect(refresh).toHaveBeenCalled();
  });

  it('esconde adicionar quando o gate de plataforma esta desligado', async () => {
    plansState.current.subscriptionsEnabled = false;
    await renderScreen();

    expect(container.querySelector('[data-testid="modulo-adicionar-lavagem"]')).toBeNull();
    // Remover continua: reduzir o que ja se paga nunca foi compra, e a API
    // tambem nao gateia o DELETE.
    expect(container.querySelector('[data-testid="modulo-remover-detailing"]')).not.toBeNull();
  });

  it('esconde adicionar em membership Apple', async () => {
    setSubscription({ provider: 'apple_revenuecat' });
    await renderScreen();

    expect(container.querySelector('[data-testid="modulo-adicionar-lavagem"]')).toBeNull();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`
Expected: FAIL nos quatro testes novos.

- [ ] **Step 3: Implementar**

Em `apps/mobile/src/api/premium.ts`:

```ts
/** POST /api/me/premium/addons — vincula um modulo. Cobra na hora, com rateio. */
export const attachPremiumAddon = (addonKey: string): Promise<AddonMutationResponse> =>
  authedRequest('/api/me/premium/addons', addonMutationResponseSchema, {
    method: 'POST',
    body: { addonKey },
  });
```

Em `MinhaAssinaturaScreen.tsx`, bloco `MÓDULOS DISPONÍVEIS` depois da lista de módulos anexados. Fonte: `usePremiumAddonModules()`, filtrando fora as chaves que já aparecem em `sub.addons` com status `active` ou `cancel_scheduled`. Renderiza só quando `subscriptionsEnabled` **e** `sub.provider === 'stripe'`. Cada linha traz nome, descrição, `formatBRL(monthlyDeltaCents)` e o botão `modulo-adicionar-{key}`. O sheet usa `copy.modulos.adicionarBody(nome, valor, novoTotal)`, com `novoTotal = sub.totalAmountCents + module.monthlyDeltaCents`. Mesmo guard de duplo toque, mesmo `refresh()` no sucesso, mesmo `resolveAddonError` no erro.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Suíte inteira, typecheck e lint**

Run: `pnpm --filter @ccc/mobile test && pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint && pnpm --filter @ccc/api test -- billing`
Expected: PASS em tudo, 0 erros de lint.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/premium.ts apps/mobile/src/screens/assinaturas/MinhaAssinaturaScreen.tsx apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx
git commit -m "feat(mobile): adicionar modulo em minha assinatura"
```

---

## Cobertura da spec

| Seção da spec                                    | Task          |
| ------------------------------------------------ | ------------- |
| 1. Contrato compartilhado (`status`, `provider`) | 1             |
| 2. `POST /api/me/premium/plan`                   | 3             |
| 3. Chave de idempotência                         | 2             |
| 4. Tela de confirmação e entradas                | 4, 5, 6       |
| 5. Editar módulos                                | 7, 8          |
| Copy PT + twin EN                                | 4, 6, 7       |
| Testes de API com Postgres real                  | 1, 2, 3       |
| Testes de mobile                                 | 4, 5, 6, 7, 8 |
