# Gate por plataforma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um gate por plataforma servido pela API e lido em runtime, capaz de
remover a entrada de assinatura no iOS sem tocar em web e Android, sem deixar
aba órfã e sem deixar rota alcançável por deep link.

**Architecture:** O cliente declara a plataforma num header `x-ccc-platform`. A
API resolve o header contra uma variável de ambiente por plataforma e devolve
`subscriptionsEnabled` nas três rotas de catálogo, que são as únicas que sempre
respondem. As rotas de escrita de assinatura e de add-on recusam quando a
plataforma está desligada. O mobile lê o booleano, esconde a entrada, esvazia o
slot da aba e redireciona os deep links.

**Tech Stack:** Fastify 5, Zod, Prisma, Postgres via Testcontainers, Expo Router,
React Native, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-pagamentos-mobile-consolidado-design.md`
(Decisão 1, corrigida pela revisão adversarial de 2026-08-29)

## Global Constraints

- Idioma primário PT-BR. Toda copy nova entra nos arquivos por tela em
  `apps/mobile/src/copy/`, nas duas versões, PT e EN, no mesmo arquivo.
- Teste de integração da API bate em Postgres real via Testcontainers. Nunca
  mock. Rodar exige Docker.
- Rate limiting é obrigatório em endpoint relevante (CLAUDE.md). As três rotas
  de catálogo hoje têm zero e passam a ser portadoras de decisão de compliance.
- Nenhum pedido e nenhuma membership muda de estado por chamada de cliente. Este
  plano não toca em nenhum caminho de pagamento; só em leitura e em recusa.
- O gate falha **fechado**: header ausente ou desconhecido, vindo de app nativo,
  resolve para desligado. Variável de ambiente ausente resolve para **ligada**,
  para que nenhum ambiente existente mude de comportamento no deploy.
- `GROWTH_PREMIUM_BILLING_ENABLED` continua global e **não** vira gate de
  plataforma. Não tocar nela.
- Commits pequenos e frequentes, um por task no mínimo.
- Branch a partir de `main` atualizada. Nunca commitar em `production`.

---

### Task 1: Resolver de plataforma, função pura

O núcleo do gate. Função sem dependência de Fastify, para poder ser testada
isoladamente e reusada nas rotas de leitura e de escrita.

**Files:**

- Create: `apps/api/src/services/platform-gate/resolve.ts`
- Test: `apps/api/test/platform-gate/resolve.test.ts`

**Interfaces:**

- Produces:
  - `type ClientPlatform = 'ios' | 'android' | 'web'`
  - `resolveClientPlatform(headers: { platform?: string; userAgent?: string }): ClientPlatform`
  - `subscriptionsEnabledFor(platform: ClientPlatform, env: PlatformGateEnv): boolean`
  - `type PlatformGateEnv = { ios: boolean; android: boolean; web: boolean }`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/platform-gate/resolve.test.ts
import { describe, expect, it } from 'vitest';

import {
  resolveClientPlatform,
  subscriptionsEnabledFor,
} from '../../src/services/platform-gate/resolve.js';

const ALL_ON = { ios: true, android: true, web: true };

describe('resolveClientPlatform', () => {
  it('trusts an explicit, known header', () => {
    expect(resolveClientPlatform({ platform: 'ios' })).toBe('ios');
    expect(resolveClientPlatform({ platform: 'android' })).toBe('android');
    expect(resolveClientPlatform({ platform: 'web' })).toBe('web');
  });

  it('is case-insensitive and trims', () => {
    expect(resolveClientPlatform({ platform: '  IOS ' })).toBe('ios');
  });

  it('falls back to web for a declared browser user-agent', () => {
    expect(
      resolveClientPlatform({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      }),
    ).toBe('web');
  });

  // Fail-closed: the whole point of the gate is that a missing header on a
  // native client must NOT be served the permissive answer.
  it('falls back to ios when the user-agent looks native and no header is present', () => {
    expect(
      resolveClientPlatform({ userAgent: 'CasaCarClub/1.4.0 CFNetwork/1494 Darwin/23.4.0' }),
    ).toBe('ios');
    expect(resolveClientPlatform({ userAgent: 'okhttp/4.12.0' })).toBe('android');
  });

  it('falls back to ios when nothing at all is known', () => {
    expect(resolveClientPlatform({})).toBe('ios');
  });

  it('ignores an unknown header value and falls back', () => {
    expect(resolveClientPlatform({ platform: 'windows-phone' })).toBe('ios');
  });
});

describe('subscriptionsEnabledFor', () => {
  it('is enabled when every platform var is on', () => {
    expect(subscriptionsEnabledFor('ios', ALL_ON)).toBe(true);
  });

  it('disables only the named platform', () => {
    const env = { ios: false, android: true, web: true };
    expect(subscriptionsEnabledFor('ios', env)).toBe(false);
    expect(subscriptionsEnabledFor('android', env)).toBe(true);
    expect(subscriptionsEnabledFor('web', env)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api exec vitest run test/platform-gate/resolve.test.ts`
Expected: FAIL, cannot resolve `../../src/services/platform-gate/resolve.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/services/platform-gate/resolve.ts
/**
 * Platform gate — resolves which client platform a request came from, and
 * whether premium subscriptions are enabled for it.
 *
 * Why the fallback is `ios` and not `web`: this gate exists to answer an App
 * Store rejection by removing the iOS subscription entry point. A request we
 * cannot classify must therefore get the RESTRICTIVE answer, not the
 * permissive one. Serving `subscriptionsEnabled: true` to an unclassified
 * native client is the exact failure the gate is built to prevent.
 *
 * The header is client-supplied and forgeable. That is acceptable: the threat
 * model is an App Review reviewer running an unmodified build, not an
 * adversary. Money still flows only through verified webhooks.
 */

export type ClientPlatform = 'ios' | 'android' | 'web';

export type PlatformGateEnv = {
  ios: boolean;
  android: boolean;
  web: boolean;
};

const KNOWN: readonly string[] = ['ios', 'android', 'web'];

/** Browsers all send a UA starting with `Mozilla/`. Native clients do not. */
const BROWSER_UA = /^Mozilla\//i;
const ANDROID_UA = /okhttp|Android/i;

export const resolveClientPlatform = (headers: {
  platform?: string;
  userAgent?: string;
}): ClientPlatform => {
  const declared = headers.platform?.trim().toLowerCase();
  if (declared && KNOWN.includes(declared)) return declared as ClientPlatform;

  const ua = headers.userAgent ?? '';
  if (BROWSER_UA.test(ua)) return 'web';
  if (ANDROID_UA.test(ua)) return 'android';

  return 'ios';
};

export const subscriptionsEnabledFor = (platform: ClientPlatform, env: PlatformGateEnv): boolean =>
  env[platform];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api exec vitest run test/platform-gate/resolve.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/platform-gate/resolve.ts apps/api/test/platform-gate/resolve.test.ts
git commit -m "feat(api): resolver de plataforma do gate, falhando fechado"
```

---

### Task 2: Variáveis de ambiente e decorator no Fastify

**Files:**

- Modify: `apps/api/src/env.ts` (junto do bloco `GROWTH_PREMIUM_BILLING_ENABLED`, linha ~74)
- Create: `apps/api/src/plugins/platform-gate.ts`
- Modify: `apps/api/src/app.ts` (registrar o plugin antes das rotas, junto dos demais `app.register`)
- Test: `apps/api/test/platform-gate/decorator.test.ts`

**Interfaces:**

- Consumes: `resolveClientPlatform`, `subscriptionsEnabledFor`, `PlatformGateEnv` da Task 1.
- Produces:
  - `request.clientPlatform: ClientPlatform`
  - `request.subscriptionsEnabled: boolean`
  - env: `PREMIUM_SUBSCRIPTIONS_IOS`, `PREMIUM_SUBSCRIPTIONS_ANDROID`, `PREMIUM_SUBSCRIPTIONS_WEB`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/platform-gate/decorator.test.ts
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp } from '../helpers.js';

describe('platform gate decorator', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
    app = await makeApp();
  });

  afterEach(async () => {
    delete process.env.PREMIUM_SUBSCRIPTIONS_IOS;
    await app.close();
  });

  it('decorates the request with the resolved platform', async () => {
    app.get('/__probe', async (request) => ({
      platform: request.clientPlatform,
      enabled: request.subscriptionsEnabled,
    }));
    await app.ready();

    const ios = await app.inject({
      method: 'GET',
      url: '/__probe',
      headers: { 'x-ccc-platform': 'ios' },
    });
    expect(ios.json()).toEqual({ platform: 'ios', enabled: false });

    const web = await app.inject({
      method: 'GET',
      url: '/__probe',
      headers: { 'x-ccc-platform': 'web' },
    });
    expect(web.json()).toEqual({ platform: 'web', enabled: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api exec vitest run test/platform-gate/decorator.test.ts`
Expected: FAIL, `request.clientPlatform` is undefined.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/env.ts`, logo abaixo do bloco `GROWTH_PREMIUM_BILLING_ENABLED`,
seguindo exatamente o mesmo padrão `z.enum(['true','false']).default(...)`:

```typescript
  // Platform gate. Default 'true' per platform: absent means enabled, so no
  // existing environment changes behaviour on deploy. Flipping
  // PREMIUM_SUBSCRIPTIONS_IOS to 'false' removes the iOS subscription entry
  // point WITHOUT touching web, Android, or renewal webhook processing —
  // which is what GROWTH_PREMIUM_BILLING_ENABLED cannot do, because it is
  // global.
  PREMIUM_SUBSCRIPTIONS_IOS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  PREMIUM_SUBSCRIPTIONS_ANDROID: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  PREMIUM_SUBSCRIPTIONS_WEB: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
```

```typescript
// apps/api/src/plugins/platform-gate.ts
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import {
  resolveClientPlatform,
  subscriptionsEnabledFor,
  type ClientPlatform,
} from '../services/platform-gate/resolve.js';

declare module 'fastify' {
  interface FastifyRequest {
    clientPlatform: ClientPlatform;
    subscriptionsEnabled: boolean;
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('clientPlatform', null);
  app.decorateRequest('subscriptionsEnabled', null);

  app.addHook('onRequest', async (request) => {
    const platform = resolveClientPlatform({
      platform: request.headers['x-ccc-platform'] as string | undefined,
      userAgent: request.headers['user-agent'],
    });
    request.clientPlatform = platform;
    request.subscriptionsEnabled = subscriptionsEnabledFor(platform, {
      ios: app.env.PREMIUM_SUBSCRIPTIONS_IOS,
      android: app.env.PREMIUM_SUBSCRIPTIONS_ANDROID,
      web: app.env.PREMIUM_SUBSCRIPTIONS_WEB,
    });
  });
};

export const platformGatePlugin = fp(plugin, { name: 'platform-gate' });
```

Em `apps/api/src/app.ts`, registrar **antes** de qualquer rota, junto dos outros
plugins (o bloco de `app.register` que precede `premiumPricingRoutes` na linha
~163):

```typescript
await app.register(platformGatePlugin);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api exec vitest run test/platform-gate/decorator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/env.ts apps/api/src/plugins/platform-gate.ts apps/api/src/app.ts apps/api/test/platform-gate/decorator.test.ts
git commit -m "feat(api): variaveis por plataforma e decorator do gate"
```

---

### Task 3: `subscriptionsEnabled` nos schemas compartilhados

`GET /api/plans/:slug` hoje devolve o plano cru (`serializePlan`), sem envelope.
Para carregar o booleano ele precisa de envelope, e isso muda dois chamadores no
mobile. As duas rotas de lista já têm envelope e só ganham um campo irmão.

**Files:**

- Modify: `packages/shared/src/premium-catalog.ts`
- Test: `packages/shared/src/__tests__/premium-catalog.test.ts` (criar se não existir)

**Interfaces:**

- Produces:
  - `premiumPlanListResponseSchema` ganha `subscriptionsEnabled: boolean`
  - `premiumAddonModuleListResponseSchema` ganha `subscriptionsEnabled: boolean`
  - `premiumPlanDetailResponseSchema` novo: `{ plan: PremiumPlan; subscriptionsEnabled: boolean }`
  - `type PremiumPlanDetailResponse`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/__tests__/premium-catalog.test.ts
import { describe, expect, it } from 'vitest';

import {
  premiumPlanDetailResponseSchema,
  premiumPlanListResponseSchema,
} from '../premium-catalog.js';

const plan = {
  tier: 'gold' as const,
  slug: 'fundador',
  name: 'Fundador',
  description: null,
  sortOrder: 3,
  prices: [{ cadence: 'monthly' as const, baseAmountCents: 24990, currency: 'BRL' }],
  benefits: [{ label: 'Acesso ao clube 24 horas', sortOrder: 1 }],
};

describe('premium catalog response schemas', () => {
  it('requires subscriptionsEnabled on the list response', () => {
    expect(() => premiumPlanListResponseSchema.parse({ plans: [plan] })).toThrow();
    expect(
      premiumPlanListResponseSchema.parse({ plans: [plan], subscriptionsEnabled: false }),
    ).toMatchObject({ subscriptionsEnabled: false });
  });

  it('wraps the single-plan response so it can carry the gate', () => {
    expect(
      premiumPlanDetailResponseSchema.parse({ plan, subscriptionsEnabled: true }),
    ).toMatchObject({ subscriptionsEnabled: true, plan: { slug: 'fundador' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/shared exec vitest run src/__tests__/premium-catalog.test.ts`
Expected: FAIL, `premiumPlanDetailResponseSchema` is not exported.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/premium-catalog.ts`, substituir
`premiumPlanListResponseSchema` e acrescentar o detalhe:

```typescript
/**
 * GET /api/plans — full response.
 *
 * `subscriptionsEnabled` is the platform gate, resolved server-side from the
 * caller's `x-ccc-platform` header. It rides on the catalog reads because
 * those are the only premium routes that ALWAYS answer:
 * GET /api/premium/pricing 503s whenever GROWTH_PREMIUM_BILLING_ENABLED is
 * off, which is precisely when the gate would need to speak.
 */
export const premiumPlanListResponseSchema = z.object({
  plans: z.array(premiumPlanSchema),
  subscriptionsEnabled: z.boolean(),
});

export type PremiumPlanListResponse = z.infer<typeof premiumPlanListResponseSchema>;

/**
 * GET /api/plans/:slug — wrapped so it can carry the gate alongside the plan.
 * Previously this route returned a bare plan; the envelope is a breaking
 * change for `getPremiumPlan` in the mobile client, updated in the same PR.
 */
export const premiumPlanDetailResponseSchema = z.object({
  plan: premiumPlanSchema,
  subscriptionsEnabled: z.boolean(),
});

export type PremiumPlanDetailResponse = z.infer<typeof premiumPlanDetailResponseSchema>;
```

E acrescentar `subscriptionsEnabled: z.boolean()` ao
`premiumAddonModuleListResponseSchema`, no mesmo arquivo.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/shared exec vitest run src/__tests__/premium-catalog.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/premium-catalog.ts packages/shared/src/__tests__/premium-catalog.test.ts
git commit -m "feat(shared): subscriptionsEnabled nos schemas de catalogo premium"
```

---

### Task 4: Rotas de catálogo carregam o gate, com cache e limite

Três coisas na mesma task porque um reviewer não aceitaria uma sem as outras:
sem `Vary` um cache serve corpo de web para cliente iOS, que é a rejeição que o
gate existe para evitar; e sem rate limit a rota vira fan-out de banco não
autenticado.

**Files:**

- Modify: `apps/api/src/routes/premium-catalog.ts`
- Test: `apps/api/test/billing/premium-catalog.test.ts` (arquivo existente, acrescentar describe)

**Interfaces:**

- Consumes: `request.subscriptionsEnabled` (Task 2), os schemas da Task 3.
- Produces: as três rotas passam a responder com `subscriptionsEnabled`, com
  `Vary: x-ccc-platform` e `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing test**

```typescript
// acrescentar a apps/api/test/billing/premium-catalog.test.ts
describe('platform gate on the catalog reads', () => {
  beforeEach(async () => {
    await seedPlan({
      tier: 'gold',
      slug: 'fundador',
      name: 'Fundador',
      prices: [{ cadence: 'monthly', baseAmountCents: 24990 }],
      benefits: [{ label: 'Acesso ao clube 24 horas', sortOrder: 1 }],
    });
  });

  it('reports the gate as off for iOS and on for web', async () => {
    process.env.PREMIUM_SUBSCRIPTIONS_IOS = 'false';
    const gated = await makeApp();
    try {
      const ios = await gated.inject({
        method: 'GET',
        url: '/api/plans',
        headers: { 'x-ccc-platform': 'ios' },
      });
      expect(ios.json().subscriptionsEnabled).toBe(false);

      const web = await gated.inject({
        method: 'GET',
        url: '/api/plans',
        headers: { 'x-ccc-platform': 'web' },
      });
      expect(web.json().subscriptionsEnabled).toBe(true);
    } finally {
      delete process.env.PREMIUM_SUBSCRIPTIONS_IOS;
      await gated.close();
    }
  });

  it('wraps the single-plan response and carries the gate', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/plans/fundador',
      headers: { 'x-ccc-platform': 'web' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      plan: { slug: 'fundador' },
      subscriptionsEnabled: true,
    });
  });

  it('carries the gate on the addon modules read', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-modules',
      headers: { 'x-ccc-platform': 'web' },
    });
    expect(res.json()).toHaveProperty('subscriptionsEnabled', true);
  });

  // A cache in front of the API that ignores the header would serve a web body
  // to an iOS client. That is the exact rejection the gate exists to prevent.
  it('marks the response as varying on the platform header and uncacheable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/plans',
      headers: { 'x-ccc-platform': 'web' },
    });
    expect(res.headers.vary).toContain('x-ccc-platform');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('still 404s an unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plans/nao-existe' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/premium-catalog.test.ts`
Expected: FAIL. `subscriptionsEnabled` ausente, e o `:slug` devolve plano cru.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/routes/premium-catalog.ts`: importar `rateLimit` de
`@fastify/rate-limit` e `premiumPlanDetailResponseSchema` de
`@ccc/shared/premium-catalog`; registrar o limite no topo do plugin, no mesmo
formato de `badges-catalog.ts:26-31`; acrescentar um hook `onSend` de cabeçalho;
e passar o booleano nas três respostas.

```typescript
export const premiumCatalogRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `premium-catalog:${req.ip}`,
  });

  // The body varies on x-ccc-platform. Without both headers, any shared cache
  // may hand an iOS client the web answer.
  app.addHook('onSend', async (_request, reply) => {
    void reply.header('Vary', 'x-ccc-platform');
    void reply.header('Cache-Control', 'no-store');
  });

  app.get('/api/plans', async (request) => {
    const plans = await prisma.premiumPlan.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: PLAN_INCLUDE,
    });
    return premiumPlanListResponseSchema.parse({
      plans: plans.map(serializePlan),
      subscriptionsEnabled: request.subscriptionsEnabled,
    });
  });

  app.get('/api/plans/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const plan = await prisma.premiumPlan.findFirst({
      where: { slug, active: true },
      include: PLAN_INCLUDE,
    });
    if (!plan) return reply.status(404).send({ error: 'NotFound' });
    return premiumPlanDetailResponseSchema.parse({
      plan: serializePlan(plan),
      subscriptionsEnabled: request.subscriptionsEnabled,
    });
  });

  app.get('/api/addon-modules', async (request) => {
    const modules = await prisma.premiumAddonModule.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
    return premiumAddonModuleListResponseSchema.parse({
      modules: modules.map(serializeAddonModule),
      subscriptionsEnabled: request.subscriptionsEnabled,
    });
  });
};
```

Atualizar também o comentário de cabeçalho do arquivo, hoje nas linhas 11-13,
que afirma que estas rotas não são gateadas. Elas continuam não sendo gateadas
por `GROWTH_PREMIUM_BILLING_ENABLED`, mas agora carregam o gate de plataforma.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/premium-catalog.test.ts`
Expected: PASS, incluindo os testes que já existiam no arquivo. Os antigos vão
precisar de `subscriptionsEnabled` no `parse`; corrigir junto.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/premium-catalog.ts apps/api/test/billing/premium-catalog.test.ts
git commit -m "feat(api): catalogo premium carrega o gate, com Vary e rate limit"
```

---

### Task 5: Recusa na escrita, em `me-premium.ts`

Esconder o botão no cliente não fecha a rota. Sem isto, o gate é decorativo.

**Files:**

- Modify: `apps/api/src/routes/me-premium.ts`
- Test: `apps/api/test/billing/me-premium-platform-gate.test.ts`

**Interfaces:**

- Consumes: `request.subscriptionsEnabled` (Task 2).
- Produces: `403 PlatformNotSupported` em `/checkout`, `/checkout-precheck` e
  `/billing-portal` quando o gate está desligado para a plataforma do chamador.

- [ ] **Step 1: Write the failing test**

Escrever um teste de integração que autentica um usuário com garagem, seguindo o
padrão de autenticação já usado em `apps/api/test/billing/`, e afirma:

```typescript
it('refuses subscription checkout from a gated platform', async () => {
  const res = await gated.inject({
    method: 'POST',
    url: '/api/me/premium/checkout',
    headers: { authorization: `Bearer ${token}`, 'x-ccc-platform': 'ios' },
    payload: { planSlug: 'fundador', cadence: 'monthly' },
  });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ error: 'PlatformNotSupported' });
});

it('still allows the same call from web', async () => {
  const res = await gated.inject({
    method: 'POST',
    url: '/api/me/premium/checkout',
    headers: { authorization: `Bearer ${token}`, 'x-ccc-platform': 'web' },
    payload: { planSlug: 'fundador', cadence: 'monthly' },
  });
  expect(res.statusCode).not.toBe(403);
});
```

Repetir para `/api/me/premium/checkout-precheck` e
`/api/me/premium/billing-portal`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/me-premium-platform-gate.test.ts`
Expected: FAIL, recebe 200 ou 201 em vez de 403.

- [ ] **Step 3: Write minimal implementation**

Criar um preHandler compartilhado e aplicá-lo às três rotas:

```typescript
// no topo de apps/api/src/routes/me-premium.ts
const requireSubscriptionsEnabled = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  if (request.subscriptionsEnabled) return;
  await reply.status(403).send({
    error: 'PlatformNotSupported',
    message: 'subscriptions are not available on this platform',
  });
};
```

Encadear no `preHandler` existente de cada rota. Não substituir o preHandler de
autenticação; somar.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/me-premium-platform-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me-premium.ts apps/api/test/billing/me-premium-platform-gate.test.ts
git commit -m "feat(api): me-premium recusa escrita de plataforma gateada"
```

---

### Task 6: Recusa na escrita, em `me-premium-addons.ts`

Router separado, e foi exatamente o que a revisão adversarial encontrou aberto:
um cliente iOS anexava add-on recorrente passando ao largo do gate.

**Files:**

- Modify: `apps/api/src/routes/me-premium-addons.ts`
- Test: `apps/api/test/billing/me-premium-addons-platform-gate.test.ts`

**Interfaces:**

- Consumes: o mesmo `request.subscriptionsEnabled`.
- Produces: `403 PlatformNotSupported` em `POST /api/me/premium/addons` e em
  qualquer outra rota de escrita do arquivo.

- [ ] **Step 1: Write the failing test**

```typescript
it('refuses addon attach from a gated platform', async () => {
  const res = await gated.inject({
    method: 'POST',
    url: '/api/me/premium/addons',
    headers: { authorization: `Bearer ${token}`, 'x-ccc-platform': 'ios' },
    payload: { addonKeys: ['detail'] },
  });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ error: 'PlatformNotSupported' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/me-premium-addons-platform-gate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Extrair `requireSubscriptionsEnabled` da Task 5 para
`apps/api/src/services/platform-gate/guard.ts` e importar nos dois routers, em
vez de duplicar. Antes de mover, conferir que a Task 5 segue verde.

Enumerar **todas** as rotas de escrita de `me-premium-addons.ts` com
`grep -n "app.post\|app.put\|app.patch\|app.delete"` e aplicar o guard a cada
uma. Não confiar na lista deste plano; ler o arquivo.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/`
Expected: PASS, os dois arquivos de gate mais os que já existiam.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me-premium-addons.ts apps/api/src/routes/me-premium.ts apps/api/src/services/platform-gate/guard.ts apps/api/test/billing/me-premium-addons-platform-gate.test.ts
git commit -m "feat(api): addons recorrentes tambem respeitam o gate"
```

---

### Task 7: Mobile envia `x-ccc-platform`

**Files:**

- Modify: `apps/mobile/src/api/client.ts:33` e `:78`
- Test: `apps/mobile/src/api/__tests__/client-platform-header.test.ts`

**Interfaces:**

- Produces: todo request para a nossa API leva `x-ccc-platform: Platform.OS`.

Nota: `client.ts` não é o único ponto de saída do app.
`shipping/useCepLookup.ts:34` e `lib/upload-image.ts:70` também saem, mas para
viacep e para o R2, não para a nossa API. Não tocar neles.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/mobile/src/api/__tests__/client-platform-header.test.ts
import { Platform } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { request } from '../client';

const okResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);

describe('api client platform header', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends x-ccc-platform on unauthed requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => okResponse({ ok: 1 }));

    await request('/api/plans', z.object({ ok: z.number() }));

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-ccc-platform']).toBe(Platform.OS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/mobile exec vitest run src/api/__tests__/client-platform-header.test.ts`
Expected: FAIL, `headers['x-ccc-platform']` is undefined.

- [ ] **Step 3: Write minimal implementation**

Em `apps/mobile/src/api/client.ts`, importar `Platform` de `react-native` e
acrescentar o header nos dois construtores de header, linha 33 e linha 78:

```typescript
const headers: Record<string, string> = {
  'content-type': 'application/json',
  'x-ccc-platform': Platform.OS,
};
```

```typescript
const headers: Record<string, string> = {
  authorization: `Bearer ${token}`,
  'x-ccc-platform': Platform.OS,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/mobile exec vitest run src/api/__tests__/client-platform-header.test.ts`
Expected: PASS. Acrescentar um caso equivalente para `authedRequest`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/api/client.ts apps/mobile/src/api/__tests__/client-platform-header.test.ts
git commit -m "feat(mobile): cliente declara a plataforma no header"
```

---

### Task 8: Mobile consome o booleano

**Files:**

- Modify: `apps/mobile/src/api/premium-catalog.ts:36-37` (envelope novo do `:slug`)
- Modify: `apps/mobile/src/hooks/usePremiumPlans.ts`
- Modify: `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx:77` e `:291`
- Modify: `apps/mobile/src/screens/assinaturas/PlanosScreen.tsx:195`
- Modify: `apps/mobile/src/screens/assinaturas/PlanoDetalheScreen.tsx:80`
- Test: `apps/mobile/src/screens/assinaturas/__tests__/gate.test.tsx`

**Interfaces:**

- Consumes: `premiumPlanDetailResponseSchema` (Task 3), header (Task 7).
- Produces: `getPremiumPlan` passa a devolver `PremiumPlanDetailResponse`.
  `usePremiumPlans` expõe `subscriptionsEnabled`.

- [ ] **Step 1: Write the failing test**

Teste de render afirmando que, com `subscriptionsEnabled: false`, o CTA de
contratação **não** renderiza, e que com `true` ele renderiza. Hoje
`ContratarScreen.tsx:291` renderiza o CTA incondicionalmente fora do iOS.

```typescript
it('does not render the subscribe CTA when the gate is off', async () => {
  mockGetPremiumPlan.mockResolvedValue({ plan: goldPlan, subscriptionsEnabled: false });
  const { queryByTestId } = render(<ContratarScreen slug="fundador" />);
  await waitFor(() => expect(queryByTestId('contratar-cta')).toBeNull());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/assinaturas/__tests__/gate.test.tsx`
Expected: FAIL, o CTA renderiza.

- [ ] **Step 3: Write minimal implementation**

Trocar o retorno de `getPremiumPlan` para o envelope, propagar
`subscriptionsEnabled` pelos hooks, e condicionar o CTA. Ler cada arquivo antes
de editar; os números de linha aqui são âncoras de 2026-08-29 e podem ter
andado.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/assinaturas/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): telas de assinatura respeitam o gate servido pela API"
```

---

### Task 9: Slot da aba com terceiro estado

`resolveCaixaSlot` hoje devolve `'assinaturas'` incondicionalmente quando a
caixa está desligada, e a caixa **está** desligada em produção. Esconder
`assinaturas` no iOS sem isto deixa o slot premium com aba nenhuma.

**Files:**

- Modify: `apps/mobile/src/navigation/caixa-slot.ts`
- Modify: `apps/mobile/app/(app)/_layout.tsx:59-83`
- Test: `apps/mobile/src/navigation/__tests__/caixa-slot.test.ts` (arquivo existente)

**Interfaces:**

- Produces: `resolveCaixaSlot` passa a devolver `'caixa' | 'assinaturas' | 'none'`
  e a aceitar `subscriptionsEnabled: boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
it('empties the slot when caixa is off and subscriptions are gated', () => {
  expect(
    resolveCaixaSlot({ caixaEnabled: false, premiumActive: false, subscriptionsEnabled: false }),
  ).toBe('none');
});

it('keeps assinaturas when the gate is on', () => {
  expect(
    resolveCaixaSlot({ caixaEnabled: false, premiumActive: false, subscriptionsEnabled: true }),
  ).toBe('assinaturas');
});

it('keeps caixa for a premium member even when subscriptions are gated', () => {
  expect(
    resolveCaixaSlot({ caixaEnabled: true, premiumActive: true, subscriptionsEnabled: false }),
  ).toBe('caixa');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/mobile exec vitest run src/navigation/__tests__/caixa-slot.test.ts`
Expected: FAIL, devolve `'assinaturas'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type PremiumSlot = 'caixa' | 'assinaturas' | 'none';

export const resolveCaixaSlot = (args: {
  caixaEnabled: boolean;
  premiumActive: boolean;
  subscriptionsEnabled: boolean;
}): PremiumSlot => {
  if (args.caixaEnabled && args.premiumActive) return 'caixa';
  if (args.subscriptionsEnabled) return 'assinaturas';
  return 'none';
};
```

Em `app/(app)/_layout.tsx`, tratar `'none'`: nenhuma aba visível, e as duas
telas registradas com `href: null` para os deep links continuarem resolvendo até
a Task 10 os redirecionar.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/mobile exec vitest run src/navigation/`
Expected: PASS. Atualizar os testes de navegação existentes que chamam
`resolveCaixaSlot` com dois argumentos.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/navigation apps/mobile/app/\(app\)/_layout.tsx
git commit -m "feat(mobile): slot premium aceita estado vazio"
```

---

### Task 10: Deep links redirecionam quando o gate está desligado

Esconder a aba não remove a rota. `app/(app)/assinaturas/` tem `contratar`,
`[slug]`, `minha-assinatura` e `checkout-return`, todas alcançáveis por deep
link. Revisor que chega numa tela de assinatura que depois dá erro é achado 2.1
por conta própria.

**Files:**

- Create: `apps/mobile/src/screens/assinaturas/useSubscriptionsGate.ts`
- Modify: as quatro rotas em `apps/mobile/app/(app)/assinaturas/`
- Test: `apps/mobile/src/screens/assinaturas/__tests__/deep-link-gate.test.tsx`

**Interfaces:**

- Consumes: `subscriptionsEnabled` do hook da Task 8.
- Produces: `useSubscriptionsGate()` que redireciona para a home quando o gate
  está desligado.

- [ ] **Step 1: Write the failing test**

```typescript
it('redirects away from contratar when the gate is off', async () => {
  mockUsePremiumPlans.mockReturnValue({ plans: [], loading: false, subscriptionsEnabled: false });
  const replace = vi.fn();
  mockRouter({ replace });

  render(<ContratarRoute />);

  await waitFor(() => expect(replace).toHaveBeenCalledWith('/inicio'));
});
```

Repetir para as outras três rotas.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/assinaturas/__tests__/deep-link-gate.test.tsx`
Expected: FAIL, `replace` não é chamado.

- [ ] **Step 3: Write minimal implementation**

Hook pequeno que observa `subscriptionsEnabled` e chama `router.replace` num
efeito, e devolve um booleano para a rota não renderizar conteúdo no frame
intermediário.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/assinaturas/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/assinaturas apps/mobile/app/\(app\)/assinaturas
git commit -m "feat(mobile): deep link de assinatura redireciona com o gate desligado"
```

---

### Task 11: Suíte completa e documentação do gate

**Files:**

- Modify: `docs/observability.md` (tag nova de Sentry para recusa do gate)
- Modify: `docs/railway.md` (as três variáveis novas)

- [ ] **Step 1: Rodar a suíte inteira da API**

Run: `pnpm --filter @ccc/api test`
Expected: PASS. Docker precisa estar rodando para os Testcontainers.

- [ ] **Step 2: Rodar a suíte inteira do mobile**

Run: `pnpm --filter @ccc/mobile test`
Expected: PASS.

- [ ] **Step 3: Lint por pacote**

Run: `pnpm --filter @ccc/api lint && pnpm --filter @ccc/mobile lint && pnpm --filter @ccc/shared lint`
Expected: PASS. Não rodar `eslint .` na raiz; ele estoura memória.

- [ ] **Step 4: Documentar**

Em `docs/railway.md`, registrar `PREMIUM_SUBSCRIPTIONS_IOS`,
`PREMIUM_SUBSCRIPTIONS_ANDROID` e `PREMIUM_SUBSCRIPTIONS_WEB`, com o default
`true` e a advertência de que ausente significa ligada.

Em `docs/observability.md`, seguindo a convenção de regra por tag do arquivo,
registrar `tags[kind]:platform-gate-write-refused`, emitida quando o guard
recusa uma escrita. Volume alto e súbito significa cliente desatualizado ou
gate ligado por engano.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: variaveis do gate por plataforma e tag de observabilidade"
```

---

## Notas para quem executa

- O gate **não** é defesa contra adversário. O header é forjável e isso é
  aceito: o modelo de ameaça é um revisor da Apple rodando um build íntegro. O
  dinheiro continua entrando só por webhook verificado.
- Não promover `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` a gate. Ela é build-time,
  já controla quatro superfícies, e foi ligada em `preview` e `production` no
  commit `cc606ae`. São coisas diferentes.
- Não mexer em `GROWTH_PREMIUM_BILLING_ENABLED`. Desligá-la derruba web, Android
  e o processamento de renovação de quem já paga.
- `app.ts` não seta `trustProxy`. Atrás do Railway, `req.ip` é o proxy de borda
  para todo mundo, então o rate limit por IP da Task 4 é um balde global. Isso é
  aceito neste plano porque o limite é teto de proteção do banco, não defesa
  anti-abuso por cliente. Resolver `trustProxy` é trabalho à parte, já registrado
  nos follow-ups do ESP32.
