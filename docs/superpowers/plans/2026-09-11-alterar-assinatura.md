# Alterar assinatura e editar módulos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao membro com assinatura viva duas ações que hoje só o admin tem: trocar de plano, com uma tela que explica tudo antes de confirmar, e adicionar, remover ou reativar módulos.

**Architecture:** A API ganha `POST /api/me/premium/plan`, que reusa `changePlan` e devolve `pending` sem escrever no banco, mantendo a invariante de que só webhook verificado altera assinatura. Antes de qualquer UI, três guards que faltam nas rotas de add-on e a reversibilidade da remoção entram no servidor. O payload passa a expor `status`, `provider` e o preço do add-on, que é o que permite à tela decidir e mostrar números certos.

**Tech Stack:** Fastify + Prisma + Postgres (Testcontainers), Zod em `@ccc/shared`, Expo Router + React Native, vitest nos dois lados.

**Spec:** `docs/superpowers/specs/2026-09-11-alterar-assinatura-design.md`

## Global Constraints

- Copy nova em `apps/mobile/src/copy/assinaturas.ts` em PT-BR **com twin EN para cada chave**. Regra declarada no topo do arquivo.
- Uma única formulação de rateio, usada na troca de plano e nas ações de módulo: _"A mudança vale assim que você confirmar. Nada é cobrado agora: a diferença proporcional entra na sua próxima fatura, que pode ser a que fecha neste ciclo."_
- Testes de API são integração contra Postgres real. Nunca mock de banco.
- Nenhuma rota escreve em `PremiumMembership` na troca de plano.
- Entrada de compra segue o gate de plataforma. Reduzir compromisso existente não segue.
- **Comandos de teste não levam `--`.** Medido: `pnpm --filter @ccc/api test -- premium-change-plan` roda a suíte inteira, porque o pnpm 10.4.1 engole o `--`. A forma correta é `pnpm --filter @ccc/api test premium-change-plan`.
- `lint-staged` roda eslint e prettier, **não** roda `tsc`. Typecheck quebrado não bloqueia commit, então os passos de typecheck do plano são a única rede.
- Rotas tipadas estão ligadas (`app.config.ts:268`). Href dinâmico precisa de `as never`, como `PlanoDetalheScreen.tsx:199` já faz.
- Worktree novo: `pnpm install` e `pnpm --filter @ccc/shared build && pnpm --filter @ccc/design build && pnpm --filter @ccc/ui build` antes dos testes de mobile.
- Branch a partir de `main`. PR para `main`. Nunca commitar em `production`.

---

### Task 1: Payload ganha `status`, `provider` e o preço do add-on

**Files:**

- Modify: `packages/shared/src/premium-subscription.ts`
- Modify: `apps/api/src/routes/me-premium-addons.ts`
- Modify: `apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx` (duas fixtures)
- Modify: `apps/mobile/src/screens/assinaturas/__tests__/BoasVindasScreen.test.tsx`
- Modify: `apps/mobile/src/screens/assinaturas/__tests__/PlanosScreen.test.tsx`
- Test: `apps/api/test/billing/premium-subscription.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `MySubscriptionResponse.status: LiveMembershipStatus | null`, `.provider: 'stripe' | 'apple_revenuecat' | null`, e `MySubscriptionAddon.monthlyDeltaCents: number`. Tasks 5, 7, 9 e 10 dependem.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/test/billing/premium-subscription.test.ts`, depois de `subscription read: live membership resolves plan + base amount`:

```ts
it('subscription read: exposes the membership status and provider', async () => {
  const { user } = await createUser({ verified: true });
  const g = await garageOf(user.id);
  await seedGoldPlan();
  await seedMembership(g.id, { status: 'past_due' });

  const res = await getSubscription(user.id);
  expect(res.statusCode).toBe(200);
  const body = mySubscriptionResponseSchema.parse(res.json());
  // `active` continua true para qualquer membership viva — e é por isso que
  // `status` precisa existir: sem ele o app não distingue um membro em dia de
  // um inadimplente.
  expect(body.active).toBe(true);
  expect(body.status).toBe('past_due');
  expect(body.provider).toBe('stripe');
});

it('subscription read: status and provider are null without a membership', async () => {
  const { user } = await createUser({ verified: true });

  const body = mySubscriptionResponseSchema.parse((await getSubscription(user.id)).json());
  expect(body.status).toBeNull();
  expect(body.provider).toBeNull();
});
```

E no teste que já existe sobre uso de add-on (`attached add-on shows current-cycle usage`), acrescentar a asserção do preço:

```ts
// O snapshot da linha, não o preço atual do catálogo: editar o catálogo não
// pode mudar o que a tela diz que está sendo cobrado.
expect(body.addons[0]?.monthlyDeltaCents).toBe(1990);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test premium-subscription`

Expected: FAIL em `expect(undefined).toBe('past_due')` e no `monthlyDeltaCents`. **Não** é o Zod que rejeita: `mySubscriptionResponseSchema` é `z.object` sem `.strict()`, então chave desconhecida é descartada em silêncio e o `parse` passa. Quem esperar erro de schema vai consertar a coisa errada.

- [ ] **Step 3: Adicionar os campos ao schema**

Em `packages/shared/src/premium-subscription.ts`. O arquivo hoje importa **só zod**, então o import é novo:

```ts
import { LIVE_MEMBERSHIP_STATUSES } from './premium.js';
```

Sem risco de ciclo: `premium.ts` não importa nada além de zod.

Em `mySubscriptionAddonSchema`, depois de `quotaPerCycle`:

```ts
  /**
   * Snapshot do valor cobrado por este add-on, de PremiumMembershipAddon —
   * NUNCA o preço atual de PremiumAddonModule. Editar o catálogo não muda o
   * que o membro paga, e a tela precisa dizer o que a fatura vai dizer.
   */
  monthlyDeltaCents: z.number().int().nonnegative(),
```

Em `mySubscriptionResponseSchema`, depois de `cancelAtPeriodEnd`:

```ts
  /**
   * Status da membership viva, ou null quando não há nenhuma. `active: true`
   * acima significa apenas "existe membership viva" e cobre past_due, paused e
   * cancel_scheduled — quem decide o que o membro pode fazer lê este campo.
   */
  status: z.enum([...LIVE_MEMBERSHIP_STATUSES]).nullable(),
  /**
   * Provider da membership. Ações que só existem na Stripe não são oferecidas
   * para Apple. O servidor também barra; isto é para a UI não oferecer o que
   * vai ser recusado.
   */
  provider: z.enum(['stripe', 'apple_revenuecat']).nullable(),
```

- [ ] **Step 4: Preencher o serializer**

Em `apps/api/src/routes/me-premium-addons.ts`, no ramo sem membership: `status: null,` e `provider: null,`. No ramo com membership viva: `status: membership.status,` e `provider: membership.provider,`. No `map` que serializa cada add-on: `monthlyDeltaCents: addon.monthlyDeltaCents,` (a coluna já existe na linha carregada).

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test premium-subscription`
Expected: PASS, incluindo os testes anteriores do arquivo.

- [ ] **Step 6: Consertar as QUATRO fixtures tipadas do mobile**

Campo novo não-opcional quebra todo literal anotado como `MySubscriptionResponse`. Varredura do repo: são exatamente quatro, e `apps/admin` não referencia esse tipo.

| Arquivo                               | Símbolo               | Acrescentar                            |
| ------------------------------------- | --------------------- | -------------------------------------- |
| `MinhaAssinaturaScreen.test.tsx:~253` | `inactiveSub`         | `status: null, provider: null`         |
| `MinhaAssinaturaScreen.test.tsx`      | `activeSub`           | `status: 'active', provider: 'stripe'` |
| `BoasVindasScreen.test.tsx`           | `activeSub`           | `status: 'active', provider: 'stripe'` |
| `PlanosScreen.test.tsx:~321`          | `ACTIVE_SUBSCRIPTION` | `status: 'active', provider: 'stripe'` |

E todo objeto de add-on dentro dessas fixtures ganha `monthlyDeltaCents: 15000`.

- [ ] **Step 7: Verificar os dois lados**

Run: `pnpm --filter @ccc/shared build && pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile test src/screens/assinaturas`
Expected: PASS, 0 erro de tipo.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/premium-subscription.ts apps/api/src/routes/me-premium-addons.ts apps/api/test/billing/premium-subscription.test.ts apps/mobile/src/screens/assinaturas/__tests__/
git commit -m "feat(api): assinatura do membro expoe status, provider e preco do modulo"
```

---

### Task 2: Chaves de idempotência deixam de ser eternas

**Files:**

- Modify: `apps/api/src/services/billing/subscription-actions.ts` (`changePlan`)
- Modify: `apps/api/src/services/billing/addons.ts` (as duas chaves)
- Test: `apps/api/test/billing/subscription-actions.test.ts` (**inclui consertar a asserção da linha 107**)

**Interfaces:**

- Consumes: nada. Produces: assinaturas inalteradas; só o valor das chaves muda.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/test/billing/subscription-actions.test.ts`. `seed()` do arquivo cria membership gold e catálogo com gold e silver; `FakeStripe.nextRetrievedSubscription` é sticky, então uma atribuição serve para as três chamadas:

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
  await prisma.premiumMembership.update({ where: { id: membershipId }, data: { tier: 'silver' } });
  await changePlan({ membershipId, tier: 'gold', cadence: 'monthly', stripe });
  await prisma.premiumMembership.update({ where: { id: membershipId }, data: { tier: 'gold' } });
  await changePlan({ membershipId, tier: 'silver', cadence: 'monthly', stripe });

  const keys = stripe.calls
    .filter((c) => c.kind === 'updateSubscriptionItemPrice')
    .map((c) => (c.payload as { idempotencyKey: string }).idempotencyKey);

  expect(keys).toHaveLength(3);
  // A terceira troca repete tier e cadência da primeira. Se a chave repetir, a
  // Stripe devolve a resposta em cache e a troca nunca acontece.
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

  // Duplo toque antes do webhook chegar: a chave TEM que repetir. É o caso que
  // a idempotência existe para cobrir, e é o que impede a "correção"
  // preguiçosa com Date.now() ou uuid.
  expect(keys[0]).toBe(keys[1]);
});
```

**Atenção, escrever num comentário no topo dos dois testes:** eles afirmam a FORMA da chave, não dedupe real. `FakeStripe.updateSubscriptionItemPrice` (`services/stripe/fake.ts:341-343`) só empurra em `calls` e não implementa idempotência, então nenhum teste deste repo pode provar que a Stripe deduplicou.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test subscription-actions`
Expected: o primeiro teste falha com `expected 2 to be 3`. O segundo já passa, e é a rede.

- [ ] **Step 3: Incluir `updatedAt` nas três chaves**

Em `subscription-actions.ts`, dentro de `changePlan` (`membership` já está em escopo, vindo de `loadMembership`):

```ts
await stripe.updateSubscriptionItemPrice({
  subscriptionItemId: planItemId,
  priceId: targetPriceId,
  // `updatedAt` entra na chave porque tier+cadencia sozinhos se repetem: um
  // membro que vai de gold para silver, volta, e vai de novo reusaria a chave
  // da primeira dentro da janela de 24h da Stripe, receberia a resposta em
  // cache, e a assinatura nao mudaria. Enquanto o webhook nao aplica nada,
  // `updatedAt` fica parado e o duplo toque continua deduplicando.
  //
  // Ressalva: `recomputeAddonsAmount` tambem escreve nessa linha, entao mexer
  // num modulo entre dois toques rotaciona a chave. Dano baixo (reaplicar o
  // mesmo price nao gera rateio novo), mas a rede nao e absoluta.
  idempotencyKey: `plan_change_${membershipId}_${tier}_${cadence}_${membership.updatedAt.getTime()}`,
});
```

Em `addons.ts`, mesma razão, agora que a Task 4 torna o ciclo attach/detach/attach/detach alcançável:

```ts
idempotencyKey: `addon_attach_${membership.id}_${addonKey}_${membership.updatedAt.getTime()}`,
```

```ts
idempotencyKey: `addon_detach_${addon.id}_${addon.updatedAt.getTime()}`,
```

- [ ] **Step 4: Consertar a asserção existente que o plano anterior quebrava**

`apps/api/test/billing/subscription-actions.test.ts:107` afirma a chave inteira dentro de um `toEqual`:

```ts
idempotencyKey: `plan_change_${membershipId}_silver_monthly`,
```

Trocar por uma asserção que sobreviva ao sufixo, carregando o motivo:

```ts
// O sufixo é o updatedAt da membership; o que importa aqui é o prefixo estável.
idempotencyKey: expect.stringContaining(`plan_change_${membershipId}_silver_monthly`),
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test subscription-actions`
Expected: PASS, incluindo o teste da linha 107.

- [ ] **Step 6: Rodar as suítes que usam os mesmos serviços**

Run: `pnpm --filter @ccc/api test admin/subscriptions` e depois `pnpm --filter @ccc/api test premium-addon-billing`
Expected: PASS nas duas.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/billing/ apps/api/test/billing/subscription-actions.test.ts
git commit -m "fix(api): chaves de billing nao sobrevivem a mudanca aplicada"
```

---

### Task 3: Guards de servidor nas rotas de add-on

Três buracos que só ficam perigosos quando a UI das Tasks 9 e 10 existir, e que precisam ser tapados **antes** dela. Mudança de comportamento em endpoint existente, deliberada (ver Decisões da spec).

**Files:**

- Modify: `apps/api/src/routes/me-premium-addons.ts`
- Test: `apps/api/test/billing/premium-subscription.test.ts`

**Interfaces:**

- Consumes: nada. Produces: `POST /addons` passa a responder 409 `InvalidStatus` e 409 `NotStripeSubscription`; `DELETE /addons/:key` passa a responder 409 `NotStripeSubscription` e a ter rate limit.

- [ ] **Step 1: Escrever os testes que falham**

No mesmo arquivo, usando os helpers `attach`, `detach`, `seedMembership`, `seedModule` e `seedGoldPlan` que já existem lá. Generalizar `seedMembership` para aceitar `{ status, provider }` em vez de só `status`.

```ts
it('attach: 409 InvalidStatus para membro past_due', async () => {
  const { user } = await createUser({ verified: true });
  const g = await garageOf(user.id);
  await seedGoldPlan();
  await seedMembership(g.id, { status: 'past_due' });
  await seedModule();

  const res = await attach(user.id, 'wash');
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ error: 'InvalidStatus', status: 'past_due' });
});

it('attach: 409 InvalidStatus para membro paused', async () => {
  const { user } = await createUser({ verified: true });
  const g = await garageOf(user.id);
  await seedGoldPlan();
  await seedMembership(g.id, { status: 'paused' });
  await seedModule();

  // A Stripe descarta as faturas do período pausado (behavior 'void'), então
  // anexar aqui é entregar módulo pago com receita zero.
  expect((await attach(user.id, 'wash')).statusCode).toBe(409);
});

it('attach: 409 NotStripeSubscription para membership Apple, sem gravar nada', async () => {
  const { user } = await createUser({ verified: true });
  const g = await garageOf(user.id);
  await seedGoldPlan();
  await seedMembership(g.id, { provider: 'apple_revenuecat' });
  await seedModule();

  const res = await attach(user.id, 'wash');
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ error: 'NotStripeSubscription' });
  // O buraco que isto fecha: attachAddon cairia no caminho local-only, gravaria
  // a linha, somaria em addonsAmountCents e não cobraria nada.
  expect(await prisma.premiumMembershipAddon.findMany()).toHaveLength(0);
});

it('detach: 409 NotStripeSubscription para membership Apple', async () => {
  const { user } = await createUser({ verified: true });
  const g = await garageOf(user.id);
  await seedGoldPlan();
  const m = await seedMembership(g.id, { provider: 'apple_revenuecat' });
  await seedModule();
  await prisma.premiumMembershipAddon.create({
    data: {
      membershipId: m.id,
      addonKey: 'wash',
      status: 'active',
      monthlyDeltaCents: 1990,
      payoutAmountCents: 0,
      quotaPerCycle: 4,
      quotaUnit: 'access',
      currency: 'BRL',
    },
  });

  expect((await detach(user.id, 'wash')).statusCode).toBe(409);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test premium-subscription`
Expected: FAIL nos quatro. Hoje o attach responde 201 e o detach 200.

- [ ] **Step 3: Implementar os guards**

Em `me-premium-addons.ts`, constante de módulo:

```ts
/**
 * Mesma lista da troca de plano (me-premium.ts). Mais estrita que a do admin,
 * que aceita past_due: quem tem cobranca pendente regulariza antes de assumir
 * compromisso novo. Vale so para o ATTACH — detach reduz compromisso e nao
 * pode ser barrado por inadimplencia.
 */
const MEMBER_ADDON_ATTACH_STATUS = ['active', 'cancel_scheduled'] as const;
```

No attach, depois de resolver a membership: recusar `provider !== 'stripe'` com 409 `NotStripeSubscription` + `manageUrl` de `APPLE_MANAGE_URL`, e recusar status fora da lista com 409 `InvalidStatus` carregando `status`. No detach: só o guard de provider.

`APPLE_MANAGE_URL` não existe neste arquivo hoje; importar de onde `me-premium.ts` o define ou duplicar a const com comentário apontando para a origem.

- [ ] **Step 4: Mover o DELETE para dentro do escopo com rate limit**

`me-premium-addons.ts:226` registra o DELETE em `app`, fora do bucket das linhas 269-284, que cobre só o POST. Cada chamada faz `stripe.removeSubscriptionItem` de verdade. Mover o registro para dentro do mesmo `app.register(async (scoped) => ...)`, preservando o `preHandler` atual. Ele **não** ganha `requireSubscriptionsEnabled`: reduzir compromisso não é compra, e o teste `me-premium-addons-platform-gate.test.ts` afirma exatamente isso.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test premium-subscription` e depois `pnpm --filter @ccc/api test me-premium-addons-platform-gate`
Expected: PASS nas duas, incluindo os testes anteriores de attach e detach.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/me-premium-addons.ts apps/api/test/billing/premium-subscription.test.ts
git commit -m "fix(api): attach de modulo valida status e provider, delete ganha rate limit"
```

---

### Task 4: Remover módulo passa a ser reversível

Hoje `detachAddon` grava `cancel_scheduled` e nada no repo escreve `cancelled`. O módulo removido nunca volta: `attachAddon` recusa para sempre e nem o admin resolve, porque usa o mesmo serviço. Expor a remoção num botão sem isto cria perda permanente.

**Files:**

- Modify: `apps/api/src/services/billing/addons.ts` (guard da linha 82)
- Test: `apps/api/test/billing/addons-service.test.ts`

**Interfaces:**

- Consumes: nada. Produces: `attachAddon` aceita linha em `cancel_scheduled` e recria o item na Stripe. A Task 9 expõe como `REATIVAR`.

- [ ] **Step 1: Escrever o teste que falha**

Seguindo a montagem que o arquivo já usa:

```ts
it('reativa um add-on removido, recriando o item na Stripe', async () => {
  // membership stripe + módulo com stripePriceId
  await attachAddon({ membershipId, addonKey: 'wash', stripe, logger });
  await detachAddon({ membershipId, addonKey: 'wash', stripe, logger });

  const result = await attachAddon({ membershipId, addonKey: 'wash', stripe, logger });

  expect(result.status).toBe('active');
  // O item foi removido da Stripe no detach; reativar precisa criar um novo,
  // senão a linha fica ativa no banco e ninguém cobra.
  expect(stripe.calls.filter((c) => c.kind === 'addSubscriptionItem')).toHaveLength(2);
  const row = await prisma.premiumMembershipAddon.findFirstOrThrow({
    where: { addonKey: 'wash' },
  });
  expect(row.status).toBe('active');
  expect(row.providerItemRef).not.toBeNull();
});

it('continua recusando um add-on que ja esta ativo', async () => {
  await attachAddon({ membershipId, addonKey: 'wash', stripe, logger });

  await expect(
    attachAddon({ membershipId, addonKey: 'wash', stripe, logger }),
  ).rejects.toMatchObject({ code: 'AddonAlreadyAttached' });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test addons-service`
Expected: o primeiro teste falha com `AddonAlreadyAttached`. O segundo passa e impede que o guard seja simplesmente apagado.

- [ ] **Step 3: Afrouxar o guard**

`apps/api/src/services/billing/addons.ts:82`:

```ts
// `cancelled` e `cancel_scheduled` sao os dois estados a partir dos quais o
// re-vinculo e legitimo. Sem `cancel_scheduled` aqui, remover um modulo era
// permanente: nada no repo escreve `cancelled`, entao a linha ficava travada
// para sempre e nem o admin conseguia desfazer.
const REATTACHABLE: readonly string[] = ['cancelled', 'cancel_scheduled'];
if (existing && !REATTACHABLE.includes(existing.status)) {
  throw new BillingActionError('AddonAlreadyAttached', 'add-on already attached', { addonKey });
}
```

O ramo de re-vínculo que já existe (`addons.ts:121-126`) cuida do resto: refresca o snapshot para os termos atuais do catálogo e reabre o ciclo de uso. O `addSubscriptionItem` acima dele roda porque a linha destacada não tem mais item vivo na Stripe.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test addons-service` e depois `pnpm --filter @ccc/api test premium-addon-billing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/billing/addons.ts apps/api/test/billing/addons-service.test.ts
git commit -m "fix(api): modulo removido pode ser reativado"
```

---

### Task 5: `POST /api/me/premium/plan`

**Files:**

- Modify: `packages/shared/src/premium-subscription.ts` (request schema)
- Create: `apps/api/src/routes/billing-error-reply.ts`
- Modify: `apps/api/src/routes/admin/subscriptions.ts` (passa a importar o helper)
- Modify: `apps/api/src/routes/me-premium.ts` (rota nova)
- Test: `apps/api/test/billing/premium-change-plan.test.ts` (criar)
- Test: `apps/api/test/billing/me-premium-platform-gate.test.ts`

**Interfaces:**

- Consumes: `changePlan` (Task 2), `status`/`provider` (Task 1).
- Produces: `POST /api/me/premium/plan`, body `{ planSlug: string, cadence: 'monthly' | 'annual' }`, resposta `200 { ok: true, pending: true }`. A Task 6 consome.

- [ ] **Step 1: Schema de request**

Em `packages/shared/src/premium-subscription.ts`:

```ts
/** POST /api/me/premium/plan — troca de plano iniciada pelo membro. */
export const memberChangePlanRequestSchema = z.object({
  planSlug: z.string().min(1),
  cadence: z.enum(['monthly', 'annual']),
});

export type MemberChangePlanRequest = z.infer<typeof memberChangePlanRequestSchema>;
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `apps/api/test/billing/premium-change-plan.test.ts`. `seedSubscription` (`apps/api/test/admin/subscriptions/seed.ts`) cria membro gold (`fundador`), catálogo com silver (`estrada`), módulo `detailing` anexado, e devolve `{ membershipId, memberId, garageId }`. Aceita `{ provider, status, withAddon }`.

Boilerplate do arquivo:

```ts
import { prisma } from '@ccc/db';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { seedSubscription } from '../admin/subscriptions/seed.js';
import { bearer, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

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
```

Um `it` por linha da tabela: 401 sem auth; troca válida com `pending` e linha intacta; auditoria com `actorId` do membro e `actorKind: 'member'`; 409 `InvalidStatus` para `past_due`; troca permitida em `cancel_scheduled`; 409 `NotStripeSubscription` com `manageUrl` para Apple; 409 `NoChange`; 404 `PlanNotFound` para slug inexistente; 404 `PlanNotFound` para plano sem `stripePriceId` na cadência; 422 `AnnualCadenceAddonUnsupported` com `cadence: 'annual'` e o `detailing` anexado; 404 sem membership viva; 422 body inválido.

Caminho feliz:

```ts
it('troca valida responde pending e NAO escreve a membership', async () => {
  const { memberId, membershipId } = await seedSubscription();
  ctx.stripe.nextRetrievedSubscription = planItemSubscription;

  const res = await change(memberId, { planSlug: 'estrada', cadence: 'monthly' });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true, pending: true });
  const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membershipId } });
  expect(row.tier).toBe('gold');
  expect(ctx.stripe.calls.filter((c) => c.kind === 'updateSubscriptionItemPrice')).toHaveLength(1);
});
```

Todo teste de guard afirma `expect(ctx.stripe.calls).toHaveLength(0)` — a lista **inteira**, não só o `updateSubscriptionItemPrice`. É o que pega uma reordenação de guards que passe a chamar `retrieveSubscription` antes de recusar.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api test premium-change-plan`
Expected: FAIL. Tudo responde 404 de rota inexistente.

- [ ] **Step 4: Extrair `sendBillingError` para a camada de rota**

`sendBillingError` é `const` privado em `admin/subscriptions.ts:64` e recebe `FastifyReply`. Criar `apps/api/src/routes/billing-error-reply.ts` exportando a mesma função, e repontar os sete usos do admin (`:251, :296, :331, :359, :394, :420, :684`).

**Não** colocar em `services/billing/errors.ts`: o cabeçalho daquele arquivo declara que a camada não conhece Fastify e não responde HTTP.

- [ ] **Step 5: Implementar a rota**

Imports que **faltam** em `me-premium.ts` e precisam ser adicionados: `recordAudit` (`../services/admin-audit.js`), `changePlan` (`../services/billing/subscription-actions.js`), `isBillingActionError` (`../services/billing/errors.js`), `memberChangePlanRequestSchema` (`@ccc/shared/premium-subscription`).

Já presentes, não reimportar: `requireUser` (:37), `pickLiveMembership` (:38), `handleStaleRef` (:39), `requireSubscriptionsEnabled` (:41), `APPLE_MANAGE_URL` (const de módulo, :54), `checkAnnualCadenceAddonRejection` (:122).

Ordem do handler: 503 se billing off → 422 se body inválido → resolver garagem (404) → **abrir transação e travar a linha da garagem com `SELECT ... FOR UPDATE`, como `me-premium.ts:635` já faz** → `pickLiveMembership` (404) → provider (409 `NotStripeSubscription` + `manageUrl`) → status fora de `['active','cancel_scheduled']` (409 `InvalidStatus` com `status`) → plano por slug ativo (404 `PlanNotFound`) → **preço da cadência no catálogo** (404 `PlanNotFound`) → add-on anexado com `cadence === 'annual'` (422 `AnnualCadenceAddonUnsupported`, reusando `checkAnnualCadenceAddonRejection`) → mesmo tier e cadência (409 `NoChange`) → `changePlan` → auditoria → `200 { ok: true, pending: true }`.

O guard de preço fica **na rota**. Delegar para o `changePlan` produz `PlanPriceMissing` em 422, que nenhum mapeamento de cliente cobre, e que vira "tente novamente" num erro que nunca passa.

O `catch` usa um **mapa explícito**, não o repasse cru:

```ts
    } catch (err) {
      // Mapa explicito, como me-premium-addons.ts:200-216 faz e documenta.
      // Repassar err.code cru entregaria ao membro `PlanPriceMissing` ("target
      // plan has no stripePriceId configured") e `AmbiguousPlanItem` ("expected
      // exactly one plan item, found N"), que sao estado de operador.
      if (isBillingActionError(err)) {
        if (err.code === 'NoChange') {
          return reply.status(409).send({ error: 'NoChange', message: 'already on this plan' });
        }
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'plan change unavailable' });
      }
      throw err;
    }
```

O código para provider errado é `NotStripeSubscription`, e não o `ProviderNotMutable` do admin, para casar com o que `/cancel` já devolve ao membro.

Registro: **escopo novo**, não um dos três que já existem (`:1157`, `:1176`, `:1191`), cada um com `max: 5` próprio — reusar o de checkout faria uma troca consumir tentativa de contratação:

```ts
await app.register(async (scoped) => {
  scoped.addHook('preHandler', app.authenticate);
  await scoped.register(rateLimit, {
    max: 5,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `premium-change-plan:${req.user?.sub ?? req.ip}`,
  });
  scoped.post(
    '/api/me/premium/plan',
    { preHandler: requireSubscriptionsEnabled },
    changePlanHandler,
  );
});
```

Auditoria: `recordAudit({ actorId: sub, action: 'premium.subscription.plan_changed', entityType: 'premium_membership', entityId: membership.id, metadata: { actorKind: 'member', fromTier, fromCadence, toTier, toCadence } })`. O `actorKind` impede a linha de conflar staff e membro.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @ccc/api test premium-change-plan`
Expected: PASS nos doze.

- [ ] **Step 7: Confirmar que o admin não quebrou**

Run: `pnpm --filter @ccc/api test admin/subscriptions`
Expected: PASS.

- [ ] **Step 8: Cobrir o gate de plataforma**

Em `apps/api/test/billing/me-premium-platform-gate.test.ts`, copiar a mecânica do caso de `/checkout` (flip de `PREMIUM_SUBSCRIPTIONS_IOS`, header de plataforma) e afirmar as duas direções para `POST /api/me/premium/plan`.

Run: `pnpm --filter @ccc/api test me-premium-platform-gate`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/premium-subscription.ts apps/api/src/routes/ apps/api/test/billing/
git commit -m "feat(api): membro troca de plano por POST /api/me/premium/plan"
```

---

### Task 6: Cliente mobile, mapeamento de erro e poll por tier + cadência

**Files:**

- Modify: `apps/mobile/src/api/premium.ts`
- Create: `apps/mobile/src/screens/assinaturas/plan-change-error.ts`
- Modify: `apps/mobile/src/screens/assinaturas/poll-subscription.ts`
- Modify: `apps/mobile/src/copy/assinaturas.ts` (bloco `alterar`, PT + twin EN)
- Modify: `apps/api/src/services/stripe/index.ts` (só o comentário errado)
- Test: `apps/mobile/src/screens/assinaturas/plan-change-error.test.ts` (criar)
- Test: `apps/mobile/src/screens/assinaturas/poll-subscription-tier.test.ts` (criar)

**Interfaces:**

- Consumes: a rota da Task 5.
- Produces:
  - `changePremiumPlan(input: { planSlug: string; cadence: 'monthly' | 'annual' }): Promise<{ ok: boolean; pending: boolean }>`
  - `resolvePlanChangeError(error: unknown): PlanChangeError`, com `reason: 'not_stripe' | 'invalid_status' | 'no_change' | 'plan_not_found' | 'annual_addon' | 'unavailable' | 'rate_limited' | 'unauthorized' | 'generic'` e `manageUrl?: string`
  - `pollSubscriptionTier(targetTier: string, targetCadence: string): Promise<boolean>`
  - `assinaturasCopy.alterar.*`

- [ ] **Step 1: Teste do mapeamento de erro**

Criar `plan-change-error.test.ts` espelhando `checkout-error.test.ts`. Casos: 409 `NotStripeSubscription` carrega `manageUrl`; 409 `InvalidStatus` vira `invalid_status` com `copy.errorPastDue`; 409 `NoChange` vira `no_change`; **422 `AnnualCadenceAddonUnsupported` vira `annual_addon`**; 404 vira `plan_not_found`; erro solto vira `generic`.

O caso 422 é o que faltava: sem ele, um erro permanente vira "tente novamente".

- [ ] **Step 2: Teste do poll**

Criar `poll-subscription-tier.test.ts`. `POLL_MAX_ATTEMPTS` é 15 e `POLL_INTERVAL_MS` é 2000 (`poll-subscription.ts`), então `advanceTimersByTimeAsync(4000)` dá exatamente duas chamadas e `2000 * 16` esgota.

```ts
it('resolve true quando tier E cadencia batem com o alvo', async () => {
  getMyPremiumSubscription
    .mockResolvedValueOnce({ active: true, tier: 'gold', cadence: 'monthly' })
    .mockResolvedValueOnce({ active: true, tier: 'silver', cadence: 'monthly' });

  const promise = pollSubscriptionTier('silver', 'monthly');
  await vi.advanceTimersByTimeAsync(4000);

  await expect(promise).resolves.toBe(true);
  expect(getMyPremiumSubscription).toHaveBeenCalledTimes(2);
});

it('nao da falso positivo quando so a cadencia muda', async () => {
  // O tier já é o alvo desde a primeira leitura. Comparar só o tier faria o
  // poll resolver true antes de qualquer webhook e mostrar sucesso para uma
  // mudança que não aconteceu.
  getMyPremiumSubscription.mockResolvedValue({ active: true, tier: 'gold', cadence: 'monthly' });

  const promise = pollSubscriptionTier('gold', 'annual');
  await vi.advanceTimersByTimeAsync(2000 * 16);

  await expect(promise).resolves.toBe(false);
});

it('resolve false quando as tentativas acabam com o plano antigo', async () => {
  getMyPremiumSubscription.mockResolvedValue({ active: true, tier: 'gold', cadence: 'monthly' });

  const promise = pollSubscriptionTier('silver', 'monthly');
  await vi.advanceTimersByTimeAsync(2000 * 16);

  await expect(promise).resolves.toBe(false);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/plan-change-error.test.ts src/screens/assinaturas/poll-subscription-tier.test.ts`
Expected: FAIL. Os dois módulos não existem e `assinaturasCopy.alterar` é `undefined`.

- [ ] **Step 4: Copy**

Bloco `alterar` no mesmo nível de `contratar`, com twin EN de **cada** chave: `header`, `back`, `fromLabel`, `toLabel`, `valueTitle`, `gainTitle`, `loseTitle`, `keptTitle`, `whenTitle`, `whenBody`, `cta`, `ctaLoading`, `voltar`, `confirming`, `pendingTitle`, `pendingSubcopy`, `pendingCta`, `successToast`, `appleTitle`, `appleBody`, `appleCta`, `blockedPastDueTitle`, `blockedPastDueBody`, `blockedPastDueCta`, `unavailableCadence`, `cancelScheduledNote`, e os `error*`.

Os rótulos de valor são **funções da cadência**, porque `baseAmountCents` é o snapshot da cadência contratada e chamar um snapshot anual de "mensalidade" erra por um fator de doze:

```ts
    currentValue: (cadence: 'monthly' | 'annual') =>
      cadence === 'annual' ? 'Valor anual de hoje' : 'Valor mensal de hoje',
    newValue: (cadence: 'monthly' | 'annual') =>
      cadence === 'annual' ? 'Novo valor anual' : 'Novo valor mensal',
```

A frase de rateio é a formulação única da Global Constraint, literal:

```ts
    whenBody:
      'A mudança vale assim que você confirmar. Nada é cobrado agora: a diferença proporcional entra na sua próxima fatura, que pode ser a que fecha neste ciclo.',
```

- [ ] **Step 5: Corrigir o comentário errado que gerou a confusão**

`apps/api/src/services/stripe/index.ts:664-666` afirma que `create_prorations` cobra "immediately". Falso: ele cria itens de fatura pendentes, coletados na próxima fatura; cobrar na hora exigiria `always_invoice`. O comentário de `updateSubscriptionItemPrice` (`:190-192`) já diz o certo. Corrigir o de `addSubscriptionItem` para casar, senão a próxima pessoa escreve a copy errada lendo ele.

- [ ] **Step 6: Implementar cliente, mapeamento e poll**

`apps/mobile/src/api/premium.ts`:

```ts
export const changePremiumPlan = (input: {
  planSlug: string;
  cadence: 'monthly' | 'annual';
}): Promise<{ ok: boolean; pending: boolean }> =>
  authedRequest('/api/me/premium/plan', z.object({ ok: z.boolean(), pending: z.boolean() }), {
    method: 'POST',
    body: { planSlug: input.planSlug, cadence: input.cadence },
  });
```

`plan-change-error.ts` com a mesma estrutura de `checkout-error.ts`: helper `body()`, `switch` no status, `if` por `b.error` dentro do 409, e um ramo 422 que separa `AnnualCadenceAddonUnsupported` do resto.

`poll-subscription.ts`:

```ts
/**
 * Resolve true quando tier E cadencia batem com o alvo. `pollSubscriptionActive`
 * nao serve para a troca: a assinatura esta viva o tempo todo. E comparar so o
 * tier daria falso positivo numa troca que nao muda o tier.
 */
export async function pollSubscriptionTier(
  targetTier: string,
  targetCadence: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    try {
      const sub = await getMyPremiumSubscription();
      if (sub.tier === targetTier && sub.cadence === targetCadence) return true;
    } catch {
      // Falha transitoria — segue tentando; quem chama mostra o estado pendente.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/plan-change-error.test.ts src/screens/assinaturas/poll-subscription-tier.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/api/premium.ts apps/mobile/src/screens/assinaturas/plan-change-error* apps/mobile/src/screens/assinaturas/poll-subscription* apps/mobile/src/copy/assinaturas.ts apps/api/src/services/stripe/index.ts
git commit -m "feat(mobile): cliente, erros e poll da troca de plano"
```

---

### Task 7: `AlterarPlanoScreen`

O ponto: **nenhuma chamada de mutação sai antes do toque no CTA**, e o membro vê o que perde antes de confirmar.

**Files:**

- Create: `apps/mobile/src/screens/assinaturas/AlterarPlanoScreen.tsx`
- Create: `apps/mobile/app/(app)/assinaturas/alterar.tsx`
- Test: `apps/mobile/src/screens/assinaturas/__tests__/AlterarPlanoScreen.test.tsx` (criar)

**Interfaces:**

- Consumes: tudo da Task 6, mais `usePremiumSubscription`, `getPremiumPlan`, `usePremiumPlans`.
- Produces: rota `/assinaturas/alterar?slug={slug}`. A Task 8 aponta para ela.

- [ ] **Step 1: Escrever os testes que falham**

Criar o arquivo copiando o harness de `BoasVindasScreen.test.tsx` (mock de `react-native`, `lucide-react-native`, `expo-router`) e acrescentando mocks de `~/api/premium`, `~/api/premium-catalog`, `~/hooks/usePremiumSubscription`, `~/hooks/usePremiumPlans` e `~/screens/assinaturas/poll-subscription`.

**Helpers não existem neste repo.** Não usar `setSubscription`, `setModules`, `click` nem `clickTwice`: nenhum deles aparece em nenhum `__tests__/`. O idioma real é `hookState.value = {...}` no `beforeEach` e `container.querySelector(...)` seguido de `.click()` dentro de `act`, como `MinhaAssinaturaScreen.test.tsx` faz.

Casos: mostra ganho e perda sem chamar nada; esconde o bloco de perda no upgrade puro; só chama a API no CTA e navega após o poll; cai em pendente quando o poll estoura; Apple não chama e oferece App Store; `past_due` bloqueia **com o link do billing-portal**; `slug` igual ao atual sai da tela; membership anual rotula os valores como anuais e envia `cadence: 'annual'`.

O teste do valor anual é o que pega o erro de fator doze:

```ts
it('rotula e envia a cadencia vigente, sem converter assinante anual', async () => {
  hookState.value = result({ ...activeSub, cadence: 'annual', baseAmountCents: 1490000 });
  await render();

  expect(text()).toContain(copy.currentValue('annual'));
  expect(text()).not.toContain(copy.currentValue('monthly'));

  await act(async () => {
    (container.querySelector('[data-testid="alterar-cta"]') as HTMLElement).click();
    await flush();
  });

  expect(changePremiumPlan).toHaveBeenCalledWith({ planSlug: 'estrada', cadence: 'annual' });
});
```

O anti duplo toque precisa ser **dois cliques dentro de um único `act`**, sem flush entre eles. É o único jeito de exercitar um guard por ref; com flush no meio, um `useState` puro também passaria e o teste não provaria nada. `MinhaAssinaturaScreen.test.tsx:534-538` já faz assim, com comentário explicando:

```ts
await act(async () => {
  cta.click();
  cta.click();
  await flush();
});
expect(changePremiumPlan).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/AlterarPlanoScreen.test.tsx`
Expected: FAIL, erro de resolução de `../AlterarPlanoScreen`.

- [ ] **Step 3: Implementar a tela**

Derivações. `monthlyPriceCents` (`tier-visual.ts:90`) devolve `number | null`, então a aritmética precisa de guarda — sem ela o typecheck do Step 5 quebra:

```tsx
const cadence = subscription.cadence ?? 'monthly';
const valorHoje = subscription.baseAmountCents;
const valorNovo = priceForCadence(planoAlvo, cadence); // number | null
// Plano sem preço na cadência vigente não tem troca a oferecer: a rota
// responderia 404 PlanNotFound. Bloqueia antes, com copy própria.
if (valorNovo === null) return <BlocoIndisponivel />;
const diferenca = valorNovo - valorHoje;

// `addons` inclui cancel_scheduled, mas `addonsAmountCents` soma só active
// (me-premium-addons.ts:37 vs addons.ts:34-38). Sem o filtro, a tela listaria
// como "continua", com preço, um módulo que não entra no total.
const modulos = subscription.addons.filter((a) => a.status === 'active');
const modulosCents = subscription.addonsAmountCents;
const novoTotal = valorNovo + modulosCents;

const atuais = subscription.benefits;
const alvos = orderedBenefits(planoAlvo);
const ganha = alvos.filter((b) => !atuais.includes(b));
const perde = atuais.filter((b) => !alvos.includes(b));
```

`priceForCadence` é um helper novo ao lado de `monthlyPriceCents` em `tier-visual.ts`, que devolve o preço da cadência pedida ou `null`. `monthlyPriceCents` cai no primeiro preço quando não há linha mensal, o que é aceitável na vitrine e não é aceitável aqui.

Recusas antes do CTA, nesta ordem: `slug === subscription.planSlug` → `router.replace('/assinaturas/minha-assinatura')`; `provider !== 'stripe'` → bloco App Store; `status` fora de `['active','cancel_scheduled']` → bloco bloqueado **com CTA para o billing-portal**; `subscriptionsEnabled` false → bloco indisponível.

Seções, na ordem da spec: header, `DE`/`PARA`, `O QUE MUDA NO VALOR`, ganho, perda (só se `perde.length > 0`), `SEUS MÓDULOS CONTINUAM`, `QUANDO VALE`, linha de cancelamento agendado, CTA `alterar-cta` e secundário.

`onSubmit`, com a guarda de duplo toque no formato de `ContratarScreen.onSubmit`:

```tsx
const onSubmit = async () => {
  if (submittingRef.current) return;
  submittingRef.current = true;
  setSubmitting(true);
  setError(null);
  try {
    await changePremiumPlan({ planSlug: planoAlvo.slug, cadence });
    setPhase('confirming');
    const trocou = await pollSubscriptionTier(planoAlvo.tier, cadence);
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

A rota `apps/mobile/app/(app)/assinaturas/alterar.tsx` lê `slug` de `useLocalSearchParams` e renderiza a tela. Sem gate de rota: quem não pode trocar vê o motivo dentro da tela, o que é mais útil do que ser jogado para outro lugar sem explicação.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/AlterarPlanoScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck e lint**

Run: `pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/assinaturas/ "apps/mobile/app/(app)/assinaturas/alterar.tsx"
git commit -m "feat(mobile): tela de confirmacao da troca de plano"
```

---

### Task 8: Entradas para a troca

**Files:**

- Create: `apps/mobile/src/screens/assinaturas/can-change-plan.ts`
- Modify: `apps/mobile/src/screens/assinaturas/PlanosScreen.tsx`
- Modify: `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx`
- Modify: `apps/mobile/src/screens/assinaturas/PlanoDetalheScreen.tsx`
- Modify: `apps/mobile/src/copy/assinaturas.ts`
- Test: os três `__tests__` correspondentes

- [ ] **Step 1: Escrever os testes que falham**

Fatos verificados sobre os harnesses, ao contrário do que a versão anterior deste plano afirmava:

- `PlanosScreen.test.tsx` **já** mocka `usePremiumSubscription` (`:45-47`), **já** tem `push` no mock de `expo-router` (`:128`), e `PlanosScreen.tsx:213` já consome o hook. Não duplicar nada disso.
- O helper de render é `renderScreen(showAll = false)`. Os testes novos precisam passar `showAll = true`, senão a tela cai no `router.replace` para Minha Assinatura e o selo nunca renderiza.
- `ContratarScreen.tsx` **não** consome `usePremiumSubscription`. Esta task adiciona o hook, e `ContratarScreen.test.tsx:62-64` mocka `~/api/premium-catalog` com **só** `getPremiumPlan` — assim que o hook entra, `getMyPremiumSubscription` precisa estar nessa factory ou todos os testes do arquivo quebram.

Casos: plano atual com selo e sem CTA; outro plano leva a `/assinaturas/alterar?slug=`; `ContratarScreen` com membership `active` redireciona; `ContratarScreen` com `past_due` **não** redireciona; `PlanoDetalheScreen` do próprio plano não oferece contratar.

O teste de `past_due` protege a saída do inadimplente:

```ts
it('nao redireciona membro past_due, que precisa do link do portal', async () => {
  hookState.value = result({ active: true, status: 'past_due', planSlug: 'fundador' });
  await renderScreen();

  // O caminho atual termina no 409 AlreadySubscribed, que traz
  // GERENCIAR ASSINATURA — o portal onde se troca o cartão que falhou.
  // Mandá-lo para uma tela sem CTA tiraria a única saída que existe.
  expect(routerReplace).not.toHaveBeenCalledWith(expect.stringContaining('/assinaturas/alterar'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas`
Expected: FAIL só nos testes novos.

- [ ] **Step 3: Copy**

Em `assinaturasCopy.plans`: `currentBadge: 'SEU PLANO ATUAL'` e `changePrefix: 'TROCAR PARA'`. Twins EN: `'YOUR CURRENT PLAN'` e `'SWITCH TO'`.

- [ ] **Step 4: Implementar**

Regra compartilhada em `can-change-plan.ts`, para as três telas não divergirem:

```ts
/** Troca de plano exige membership viva E em dia. past_due e paused ficam de fora. */
export const canChangePlan = (sub: MySubscriptionResponse | null): boolean =>
  Boolean(sub?.active && (sub.status === 'active' || sub.status === 'cancel_scheduled'));
```

`PlanosScreen`: card cujo `slug === subscription.planSlug` mostra `currentBadge` no lugar do CTA; os outros usam `changePrefix` e navegam com `as never`, como `PlanoDetalheScreen.tsx:199` já faz:

```tsx
router.push(`/assinaturas/alterar?slug=${plan.slug}` as never);
```

`ContratarScreen`: adicionar `usePremiumSubscription` e o efeito de redirect, gateado por `canChangePlan`:

```tsx
useEffect(() => {
  if (subLoading || !slug || !canChangePlan(subscription)) return;
  router.replace(`/assinaturas/alterar?slug=${slug}` as never);
}, [subLoading, subscription, slug]);
```

`PlanoDetalheScreen`: mesmo gate no destino do CTA, e nada de contratar no próprio plano.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas && pnpm --filter @ccc/mobile typecheck`
Expected: PASS, 0 erro de tipo.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/assinaturas/ apps/mobile/src/copy/assinaturas.ts
git commit -m "feat(mobile): entradas levam assinante em dia para a alteracao"
```

---

### Task 9: Remover e reativar módulo

**Files:**

- Modify: `apps/mobile/src/api/premium.ts`
- Create: `apps/mobile/src/screens/assinaturas/addon-error.ts`
- Modify: `apps/mobile/src/screens/assinaturas/MinhaAssinaturaScreen.tsx`
- Modify: `apps/mobile/src/copy/assinaturas.ts`
- Test: `apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`

**Interfaces:**

- Consumes: `provider` e `monthlyDeltaCents` (Task 1), re-vínculo (Task 4), guards (Task 3).
- Produces: `detachPremiumAddon(addonKey)`, `attachPremiumAddon(addonKey)`, `resolveAddonError(error, action: 'attach' | 'detach')`. A Task 10 consome.

- [ ] **Step 1: Preparar o harness antes dos testes**

Quatro ajustes, senão os testes novos nem compilam:

1. `vi.mock('~/api/premium', ...)` (`:77-79`) é factory fechada: acrescentar `detachPremiumAddon` e `attachPremiumAddon`.
2. `ApiError` é **mockado** no arquivo (`:82-94`), não importado. Usar a classe do mock, não um import novo.
3. `usePremiumAddonModules` não é mockado e a tela não o consome hoje. Acrescentar o mock agora (a Task 10 depende).
4. As fixtures de add-on precisam de `monthlyDeltaCents` (feito na Task 1).

- [ ] **Step 2: Escrever os testes que falham**

Casos: confirma antes de remover e só chama no confirmar; o sheet mostra os **números formatados**; módulo `cancel_scheduled` oferece `REATIVAR` e não `REMOVER`; Apple esconde as duas ações; erro não derruba a tela.

A copy de sheet é **função**, então o teste precisa chamá-la. Passar a função crua para `toContain` não compila e não afirma nada:

```ts
expect(text()).toContain(copy.modulos.removerBody('Detailing', 'R$ 299,00'));
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`
Expected: FAIL nos testes novos.

- [ ] **Step 4: Copy**

Bloco `modulos` em `minhaAssinatura`, com twin EN de cada chave. A de remoção diz a verdade que a Task 4 tornou verdadeira:

```ts
      removerBody: (nome: string, total: string) =>
        `A cobrança de ${nome} para agora e seu total cai para ${total} por mês. Você continua usando a cota deste módulo até o fim do ciclo atual.`,
      // Verdade a partir da Task 4. Antes dela, o módulo removido ficava
      // travado em cancel_scheduled para sempre.
      removerReversivel: 'Você pode reativar este módulo quando quiser.',
```

As ações de adicionar e reativar reusam `assinaturasCopy.alterar.whenBody`, a formulação única de rateio.

- [ ] **Step 5: Implementar**

Cliente em `api/premium.ts`, com o import de `addonMutationResponseSchema` e `AddonMutationResponse` de `@ccc/shared/premium-subscription` (o arquivo só importa de `@ccc/shared/premium` hoje).

`addon-error.ts` com `resolveAddonError(error: unknown, action: 'attach' | 'detach')`. A ação é parâmetro porque 404 significa coisas diferentes: no attach é módulo fora do catálogo, no detach é módulo não anexado. Mapear também os códigos novos da Task 3: 409 `InvalidStatus` e 409 `NotStripeSubscription`.

`AddonRow` precisa da assinatura mudada: hoje é `({ addon }: { addon: MySubscriptionAddon })` (`MinhaAssinaturaScreen.tsx:71`) e não enxerga `sub`. Passar `provider` e `subscriptionsEnabled` por prop.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/api/premium.ts apps/mobile/src/screens/assinaturas/ apps/mobile/src/copy/assinaturas.ts
git commit -m "feat(mobile): remover e reativar modulo em minha assinatura"
```

---

### Task 10: Adicionar módulo

**Files:**

- Modify: `apps/mobile/src/screens/assinaturas/MinhaAssinaturaScreen.tsx`
- Test: `apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`

- [ ] **Step 1: Escrever os testes que falham**

Casos: lista só o que não está anexado; **o bloco aparece com zero add-ons**; o sheet mostra os números antes de chamar; gate desligado esconde `ADICIONAR` e mantém `REMOVER`; Apple esconde `ADICIONAR`.

O caso de zero add-ons pega a condição existente: `MinhaAssinaturaScreen.tsx:251` renderiza a seção de módulos só quando `sub.addons.length > 0`, e o bloco de disponíveis precisa aparecer justamente para quem não tem nenhum.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`
Expected: FAIL nos cinco.

- [ ] **Step 3: Implementar**

Bloco `MÓDULOS DISPONÍVEIS` fora da condição de `addons.length > 0`. Fonte: `usePremiumAddonModules()`, filtrando as chaves já anexadas com status `active` ou `cancel_scheduled` (essas aparecem como `REATIVAR` na lista de cima, não aqui). Renderiza só com `subscriptionsEnabled` **e** `provider === 'stripe'`. Sheet com `monthlyDeltaCents` do catálogo (aqui o preço do catálogo é o correto: é o que vai ser cobrado ao anexar) e `novoTotal = sub.totalAmountCents + module.monthlyDeltaCents`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile test src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Suíte inteira**

Run: `pnpm --filter @ccc/mobile test && pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint && pnpm --filter @ccc/api test billing`
Expected: PASS em tudo, 0 erro de lint.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/assinaturas/
git commit -m "feat(mobile): adicionar modulo em minha assinatura"
```

---

## Cobertura da spec

| Seção da spec                     | Task    |
| --------------------------------- | ------- |
| 1. Contrato compartilhado         | 1       |
| 2. `POST /api/me/premium/plan`    | 5       |
| 3. Chaves de idempotência         | 2       |
| 4. Tela de confirmação e entradas | 6, 7, 8 |
| 5. Editar módulos (servidor)      | 3, 4    |
| 5. Editar módulos (app)           | 9, 10   |
| Copy PT + twin EN                 | 6, 8, 9 |
| Comentário errado de proration    | 6       |
| Testes de API com Postgres real   | 1–5     |
| Testes de mobile                  | 6–10    |
