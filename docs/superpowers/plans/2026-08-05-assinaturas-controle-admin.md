# Aba "Assinaturas" no painel admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao admin controle operacional das assinaturas dos membros — detalhe, troca de plano, gestão de módulos adicionais com repasse a terceiros, alteração de status e histórico de pagamentos — dentro do painel Next.js que já existe.

**Architecture:** Modelo híbrido. A ação do admin chama a Stripe; o webhook verificado grava na `PremiumMembership`, preservando o invariante de que só webhook escreve status de cobrança. Assinatura Apple/RevenueCat é somente leitura. A lógica de vincular e desvincular módulo é extraída do route handler do membro para um serviço compartilhado, então admin e membro nunca duplicam regra.

**Tech Stack:** pnpm monorepo, TypeScript. Fastify + Prisma + Postgres (`apps/api`, `packages/db`). Next.js 16.2.6 App Router (`apps/admin`). Zod compartilhado (`packages/shared`). Vitest em toda parte, com Postgres real via Testcontainers na API.

## Global Constraints

- Branch de trabalho: `feat/assinaturas-controle-admin`. Não criar worktree. Não criar branch paralela.
- Nunca commitar nem fazer push em `production`.
- `apps/admin/AGENTS.md`: esta versão do Next.js tem breaking changes. Ler o guia relevante em `node_modules/next/dist/docs/` antes de escrever código de admin. Já verificado para este plano: `params` e `searchParams` são `Promise` e precisam de `await`; `redirect` vem de `next/navigation` e deve ser chamado **fora** de `try/catch`.
- Só webhook verificado escreve status de cobrança em `PremiumMembership`. Serviço de ação nunca escreve status.
- Contrato de lock, canon §F8.5: antes de `applyMembershipEvent`, `applyInvoiceRefund` ou `reconcileMembershipAddonsAmount`, o chamador precisa ter executado `SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE` na mesma transação.
- Ordem provider-first em toda mutação: chamada à Stripe antes da transação no banco. Stripe falha, banco não muda.
- Rateio: `proration_behavior: 'create_prorations'` em toda troca de plano e todo vínculo de módulo.
- Toda chamada à Stripe carrega `idempotencyKey` derivada de `membershipId` e da ação.
- Toda mutação admin grava `recordAudit`.
- Idioma primário PT-BR. Não existe dicionário central no admin: rótulos vão em `Record` local por arquivo.
- Cores no admin apenas por variável CSS, por exemplo `text-[color:var(--color-muted)]`. Cor crua do Tailwind só em pill de status.
- Depois de mexer em `packages/shared`, rodar `pnpm --filter @ccc/shared build` e typecheck em `@ccc/api`, `@ccc/admin` e `@ccc/mobile`.
- Spec de origem: `docs/superpowers/specs/2026-08-05-assinaturas-controle-admin-design.md`.

**Comandos exatos usados no plano**

```bash
pnpm --filter @ccc/db exec prisma migrate dev --name addon_payout_and_payment_method
pnpm --filter @ccc/db db:generate
pnpm --filter @ccc/shared build
pnpm --filter @ccc/api exec vitest run <caminho-do-teste>
pnpm --filter @ccc/admin exec vitest run <caminho-do-teste>
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/admin typecheck
pnpm --filter @ccc/mobile typecheck
```

## File Structure

**Criados**

| Arquivo                                                                            | Responsabilidade                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/db/prisma/migrations/<ts>_addon_payout_and_payment_method/migration.sql` | Seis colunas novas                                          |
| `packages/shared/src/admin-subscription.ts`                                        | Schemas Zod do detalhe e das mutações admin                 |
| `apps/api/src/services/billing/errors.ts`                                          | `BillingActionError` com código e status HTTP               |
| `apps/api/src/services/billing/addons.ts`                                          | `attachAddon` e `detachAddon`, extraídos do route do membro |
| `apps/api/src/services/billing/subscription-actions.ts`                            | Troca de plano, cancelar, retomar, pausar, retomar cobrança |
| `apps/api/src/services/billing/plan-item.ts`                                       | Resolver qual item da Stripe é o item de plano              |
| `apps/api/src/routes/admin/subscriptions.ts`                                       | Endpoints admin de assinatura                               |
| `apps/admin/app/(authed)/assinaturas/page.tsx`                                     | Lista                                                       |
| `apps/admin/app/(authed)/assinaturas/assinaturas-table.tsx`                        | Tabela, chips, paginação                                    |
| `apps/admin/app/(authed)/assinaturas/[id]/page.tsx`                                | Detalhe                                                     |
| `apps/admin/app/(authed)/assinaturas/[id]/plan-actions.tsx`                        | Troca de plano                                              |
| `apps/admin/app/(authed)/assinaturas/[id]/status-actions.tsx`                      | Cancelar, retomar, pausar                                   |
| `apps/admin/app/(authed)/assinaturas/[id]/addons-panel.tsx`                        | Vincular e desvincular módulo                               |
| `apps/admin/src/lib/assinaturas-actions.ts`                                        | Server actions                                              |

**Modificados**

| Arquivo                                                   | Mudança                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                        | Seis colunas                                                                        |
| `packages/db/prisma/seed.ts`                              | Campos de repasse nos dois módulos                                                  |
| `packages/shared/src/admin.ts`                            | Ações de auditoria, `premium_membership` como entityType, filtros e campos da lista |
| `packages/shared/package.json`                            | Subpath `./admin-subscription`                                                      |
| `apps/api/src/services/billing/types.ts`                  | `paused`, `resumed`, campos de método de pagamento                                  |
| `apps/api/src/services/billing/normalize-stripe.ts`       | Discriminador de `pause_collection`                                                 |
| `apps/api/src/services/billing/apply-membership-event.ts` | `handlePaused`, `handleResumed`, persistir método de pagamento                      |
| `apps/api/src/services/stripe/index.ts`                   | Quatro métodos novos no `StripeClient`                                              |
| `apps/api/src/services/stripe/fake.ts`                    | Fakes dos quatro métodos                                                            |
| `apps/api/src/routes/stripe-billing-webhook.ts`           | Resolver bandeira e final do cartão                                                 |
| `apps/api/src/routes/me-premium-addons.ts`                | Passa a chamar o serviço extraído                                                   |
| `apps/api/src/routes/admin/index.ts`                      | Registrar `adminSubscriptionRoutes`                                                 |
| `apps/api/src/routes/admin/finance.ts`                    | Filtros `addonKey` e `vendorName`, campos novos na linha                            |
| `apps/admin/src/components/authed-nav.tsx`                | Link `Assinaturas`                                                                  |
| `apps/admin/middleware.ts`                                | Matcher e gate de `staff`                                                           |
| `apps/admin/src/lib/admin-api.ts`                         | Funções tipadas dos endpoints novos                                                 |
| `apps/admin/app/(authed)/financeiro/membros/page.tsx`     | Vira redirect                                                                       |
| `apps/admin/src/components/garage-membership-history.tsx` | Link para `/assinaturas`                                                            |

**Removidos**

- `apps/admin/app/(authed)/financeiro/membros/membros-table.tsx`
- `apps/admin/app/(authed)/financeiro/membros/__tests__/page.test.tsx`

---

### Task 1: Migration e seed do repasse e do método de pagamento

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (models `PremiumAddonModule`, `PremiumMembershipAddon`, `PremiumMembership`)
- Modify: `packages/db/prisma/seed.ts:548-567`
- Create: `packages/db/prisma/migrations/<timestamp>_addon_payout_and_payment_method/migration.sql` (gerado pelo Prisma)

**Interfaces:**

- Consumes: nada.
- Produces: colunas `PremiumAddonModule.payoutAmountCents: Int`, `PremiumAddonModule.vendorName: String | null`, `PremiumMembershipAddon.payoutAmountCents: Int`, `PremiumMembershipAddon.vendorName: String | null`, `PremiumMembership.paymentBrand: String | null`, `PremiumMembership.paymentLast4: String | null`. Todas as tasks seguintes leem esses nomes.

- [ ] **Step 1: Adicionar as colunas ao `PremiumAddonModule`**

Em `packages/db/prisma/schema.prisma`, no model `PremiumAddonModule`, logo depois da linha `monthlyDeltaCents Int`:

```prisma
  /// Valor mensal repassado ao fornecedor terceiro. Margem = monthlyDeltaCents - payoutAmountCents.
  payoutAmountCents Int              @default(0)
  /// Fornecedor que presta o serviço deste módulo. Null = ainda não cadastrado.
  vendorName        String?          @db.VarChar(120)
```

- [ ] **Step 2: Adicionar as colunas ao `PremiumMembershipAddon`**

No model `PremiumMembershipAddon`, logo depois de `monthlyDeltaCents Int`:

```prisma
  /// Snapshot do repasse no momento do vinculo. Editar o catalogo NAO altera
  /// retroativamente um modulo ja vinculado, igual ao que ja vale para preco e cota.
  payoutAmountCents Int                @default(0)
  /// Snapshot do fornecedor no momento do vinculo.
  vendorName        String?            @db.VarChar(120)
```

- [ ] **Step 3: Adicionar as colunas ao `PremiumMembership`**

No model `PremiumMembership`, logo depois de `addonsAmountCents Int @default(0)`:

```prisma
  /// Snapshot do metodo de pagamento, preenchido pelo webhook de billing quando
  /// disponivel. Ausencia nunca e erro: a UI cai para rotulo derivado do provider.
  paymentBrand String? @db.VarChar(20)
  paymentLast4 String? @db.VarChar(4)
```

- [ ] **Step 4: Gerar a migration**

```bash
pnpm --filter @ccc/db exec prisma migrate dev --name addon_payout_and_payment_method
```

Esperado: cria a pasta de migration, aplica no banco local e roda `prisma generate`. O SQL gerado deve conter só `ALTER TABLE ... ADD COLUMN`, seis vezes, sem `DROP`. Se aparecer qualquer `DROP`, pare e investigue: significa drift do schema local.

- [ ] **Step 5: Conferir o SQL gerado**

```bash
cat packages/db/prisma/migrations/*_addon_payout_and_payment_method/migration.sql
```

Esperado: seis `ADD COLUMN`, com `DEFAULT 0` nos dois `payoutAmountCents` e nada mais.

- [ ] **Step 6: Preencher o seed com fornecedor e repasse**

Em `packages/db/prisma/seed.ts`, substituir o array `PREMIUM_ADDON_MODULES` (linhas 548 a 567) por:

```ts
const PREMIUM_ADDON_MODULES = [
  {
    key: 'detailing',
    name: 'Detailing',
    description: '3 acessos/mês para lavagem & detailing',
    monthlyDeltaCents: 15000,
    // Repasse real ainda nao definido pelo operador. Zero e null deliberadamente:
    // o seed nao inventa dado financeiro. Ate ser preenchido, a margem exibida no
    // admin iguala o valor cobrado.
    payoutAmountCents: 0,
    vendorName: null,
    quotaPerCycle: 3,
    quotaUnit: 'access' as const,
    sortOrder: 0,
  },
  {
    key: 'oficina',
    name: 'Oficina',
    description: '5 horas de oficina por mês',
    monthlyDeltaCents: 50000,
    payoutAmountCents: 0,
    vendorName: null,
    quotaPerCycle: 5,
    quotaUnit: 'hours' as const,
    sortOrder: 1,
  },
];
```

- [ ] **Step 7: Propagar os campos no upsert do seed**

Localizar, dentro de `seedPremiumCatalog`, o `prisma.premiumAddonModule.upsert` e acrescentar os dois campos em `update` **e** em `create`, junto de `monthlyDeltaCents`:

```ts
        payoutAmountCents: m.payoutAmountCents,
        vendorName: m.vendorName,
```

- [ ] **Step 8: Rodar o seed e verificar**

```bash
pnpm --filter @ccc/db db:seed
```

Esperado: termina sem erro.

- [ ] **Step 9: Typecheck do pacote de banco**

```bash
pnpm --filter @ccc/db typecheck
```

Esperado: zero erro.

- [ ] **Step 10: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/seed.ts packages/db/prisma/migrations
git commit -m "feat(db): repasse e fornecedor em modulos, metodo de pagamento na assinatura"
```

---

### Task 2: Schemas compartilhados

**Files:**

- Create: `packages/shared/src/admin-subscription.ts`
- Modify: `packages/shared/src/admin.ts` (`adminAuditActionSchema` ~linha 23, `adminAuditEntityTypeSchema` ~linha 117, `adminFinanceMembershipsQuerySchema` linha 693, `adminFinanceMembershipsItemSchema` linha 709)
- Modify: `packages/shared/package.json` (mapa `exports`)
- Test: `packages/shared/src/__tests__/admin-subscription.test.ts`

**Interfaces:**

- Consumes: nomes de coluna da Task 1.
- Produces:
  - `adminSubscriptionDetailSchema`, tipo `AdminSubscriptionDetail`
  - `adminSubscriptionAddonSchema`, tipo `AdminSubscriptionAddon`
  - `adminSubscriptionInvoiceSchema`, tipo `AdminSubscriptionInvoice`
  - `adminSubscriptionChangePlanSchema`, tipo `AdminSubscriptionChangePlan`
  - `adminSubscriptionAddonAttachSchema`, tipo `AdminSubscriptionAddonAttach`
  - `adminSubscriptionActionResponseSchema`, tipo `AdminSubscriptionActionResponse`
  - `adminSubscriptionAddonMutationResponseSchema`, tipo `AdminSubscriptionAddonMutationResponse`
  - Todos importáveis por `@ccc/shared/admin-subscription`
  - Em `@ccc/shared/admin`: `addonKey` e `vendorName` na query da lista; `userId`, `userEmail`, `baseAmountCents`, `addonsAmountCents`, `paymentBrand`, `paymentLast4`, `addonKeys` no item da lista

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/shared/src/__tests__/admin-subscription.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  adminSubscriptionActionResponseSchema,
  adminSubscriptionAddonMutationResponseSchema,
  adminSubscriptionChangePlanSchema,
  adminSubscriptionDetailSchema,
} from '../admin-subscription.js';

const validDetail = {
  membershipId: 'mem_1',
  userId: 'usr_1',
  userName: 'Ana',
  userEmail: 'ana@example.com',
  garageId: 'gar_1',
  garageSlug: 'ana',
  tier: 'gold' as const,
  planSlug: 'fundador',
  planName: 'Fundador',
  cadence: 'monthly' as const,
  status: 'active' as const,
  provider: 'stripe' as const,
  currentPeriodStart: '2026-08-01T00:00:00.000Z',
  currentPeriodEnd: '2026-09-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  baseAmountCents: 149000,
  addonsAmountCents: 15000,
  totalAmountCents: 164000,
  currency: 'BRL',
  paymentBrand: 'visa',
  paymentLast4: '4242',
  mutable: true,
  addons: [
    {
      key: 'detailing',
      name: 'Detailing',
      vendorName: 'Lava Rápido X',
      status: 'active' as const,
      quotaUnit: 'access' as const,
      quotaPerCycle: 3,
      monthlyDeltaCents: 15000,
      payoutAmountCents: 9000,
      marginCents: 6000,
      billingIntegrated: true,
      currentCycle: {
        cycleStart: '2026-08-01T00:00:00.000Z',
        cycleEnd: '2026-09-01T00:00:00.000Z',
        quotaTotal: 3,
        quotaUsed: 1,
        quotaRemaining: 2,
      },
    },
  ],
  invoices: [
    {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-01T00:00:00.000Z',
      paidAt: '2026-07-01T03:00:00.000Z',
      grossAmountCents: 164000,
      addonsAmountCents: 15000,
      currency: 'BRL',
      status: 'paid',
      refundedAt: null,
      refundedAmountCents: null,
    },
  ],
};

describe('adminSubscriptionDetailSchema', () => {
  it('aceita um detalhe completo', () => {
    expect(adminSubscriptionDetailSchema.parse(validDetail)).toEqual(validDetail);
  });

  it('aceita metodo de pagamento e ciclo ausentes', () => {
    const parsed = adminSubscriptionDetailSchema.parse({
      ...validDetail,
      paymentBrand: null,
      paymentLast4: null,
      addons: [{ ...validDetail.addons[0], currentCycle: null }],
    });
    expect(parsed.paymentBrand).toBeNull();
    expect(parsed.addons[0]?.currentCycle).toBeNull();
  });

  it('rejeita tier fora do enum', () => {
    expect(() =>
      adminSubscriptionDetailSchema.parse({ ...validDetail, tier: 'platinum' }),
    ).toThrow();
  });
});

describe('adminSubscriptionChangePlanSchema', () => {
  it('aceita tier e cadence validos', () => {
    expect(adminSubscriptionChangePlanSchema.parse({ tier: 'silver', cadence: 'monthly' })).toEqual(
      {
        tier: 'silver',
        cadence: 'monthly',
      },
    );
  });

  it('rejeita corpo sem cadence', () => {
    expect(() => adminSubscriptionChangePlanSchema.parse({ tier: 'silver' })).toThrow();
  });
});

describe('respostas de acao', () => {
  it('acao de provider e sempre pendente', () => {
    expect(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true })).toEqual({
      ok: true,
      pending: true,
    });
    expect(() =>
      adminSubscriptionActionResponseSchema.parse({ ok: true, pending: false }),
    ).toThrow();
  });

  it('mutacao de modulo nunca e pendente e devolve os totais', () => {
    expect(
      adminSubscriptionAddonMutationResponseSchema.parse({
        ok: true,
        pending: false,
        addonKey: 'detailing',
        status: 'active',
        addonsAmountCents: 15000,
        totalAmountCents: 164000,
      }),
    ).toMatchObject({ pending: false, addonKey: 'detailing' });
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/admin-subscription.test.ts
```

Esperado: FAIL, com erro de resolução do módulo `../admin-subscription.js`.

- [ ] **Step 3: Criar o arquivo de schemas**

Criar `packages/shared/src/admin-subscription.ts`:

```ts
import { z } from 'zod';

/**
 * Admin subscription control surface.
 *
 * Admin-only, portanto pode carregar dado financeiro interno que o schema
 * publico nao expoe (repasse, margem). Nao carrega referencia de provider:
 * providerCustomerRef, providerSubRef e providerItemRef ficam de fora
 * deliberadamente — o admin nao precisa deles para operar e expor id de
 * provider amplia a superficie sem ganho.
 */

const tierSchema = z.enum(['bronze', 'silver', 'gold']);
const cadenceSchema = z.enum(['monthly', 'annual']);
const providerSchema = z.enum(['stripe', 'apple_revenuecat']);
const membershipStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'cancel_scheduled',
  'expired',
  'paused',
]);
const addonStatusSchema = z.enum(['active', 'cancel_scheduled', 'cancelled']);
const quotaUnitSchema = z.enum(['access', 'hours']);

export const adminSubscriptionAddonCycleSchema = z.object({
  cycleStart: z.string().datetime(),
  cycleEnd: z.string().datetime(),
  quotaTotal: z.number().int().nonnegative(),
  quotaUsed: z.number().int().nonnegative(),
  quotaRemaining: z.number().int(),
});
export type AdminSubscriptionAddonCycle = z.infer<typeof adminSubscriptionAddonCycleSchema>;

export const adminSubscriptionAddonSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  vendorName: z.string().nullable(),
  status: addonStatusSchema,
  quotaUnit: quotaUnitSchema,
  quotaPerCycle: z.number().int().nonnegative(),
  /** Valor cobrado do membro por ciclo. */
  monthlyDeltaCents: z.number().int().nonnegative(),
  /** Valor repassado ao fornecedor por ciclo. */
  payoutAmountCents: z.number().int().nonnegative(),
  /** Derivado: monthlyDeltaCents - payoutAmountCents. Pode ser negativo. */
  marginCents: z.number().int(),
  /**
   * Derivado de providerItemRef !== null. Falso significa que a Stripe NAO esta
   * cobrando por este modulo, apesar de ele aparecer no valor total local.
   */
  billingIntegrated: z.boolean(),
  currentCycle: adminSubscriptionAddonCycleSchema.nullable(),
});
export type AdminSubscriptionAddon = z.infer<typeof adminSubscriptionAddonSchema>;

export const adminSubscriptionInvoiceSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  paidAt: z.string().datetime(),
  grossAmountCents: z.number().int().nonnegative(),
  addonsAmountCents: z.number().int().nonnegative(),
  currency: z.string(),
  status: z.string(),
  refundedAt: z.string().datetime().nullable(),
  refundedAmountCents: z.number().int().nullable(),
});
export type AdminSubscriptionInvoice = z.infer<typeof adminSubscriptionInvoiceSchema>;

export const adminSubscriptionDetailSchema = z.object({
  membershipId: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string(),
  userEmail: z.string(),
  garageId: z.string().min(1),
  garageSlug: z.string(),
  tier: tierSchema,
  planSlug: z.string().nullable(),
  planName: z.string().nullable(),
  cadence: cadenceSchema,
  status: membershipStatusSchema,
  provider: providerSchema,
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  cancelledAt: z.string().datetime().nullable(),
  baseAmountCents: z.number().int().nonnegative(),
  addonsAmountCents: z.number().int().nonnegative(),
  totalAmountCents: z.number().int().nonnegative(),
  currency: z.string(),
  paymentBrand: z.string().nullable(),
  paymentLast4: z.string().nullable(),
  /** provider === 'stripe'. Falso desabilita toda acao na interface. */
  mutable: z.boolean(),
  addons: z.array(adminSubscriptionAddonSchema),
  invoices: z.array(adminSubscriptionInvoiceSchema),
});
export type AdminSubscriptionDetail = z.infer<typeof adminSubscriptionDetailSchema>;

export const adminSubscriptionChangePlanSchema = z.object({
  tier: tierSchema,
  cadence: cadenceSchema,
});
export type AdminSubscriptionChangePlan = z.infer<typeof adminSubscriptionChangePlanSchema>;

export const adminSubscriptionAddonAttachSchema = z.object({
  addonKey: z.string().min(1).max(40),
});
export type AdminSubscriptionAddonAttach = z.infer<typeof adminSubscriptionAddonAttachSchema>;

/**
 * Resposta das acoes que so chamam a Stripe. pending e literal true: o banco
 * ainda nao mudou, quem escreve e o webhook. A interface usa isso para nao
 * mostrar o valor novo antes da confirmacao.
 */
export const adminSubscriptionActionResponseSchema = z.object({
  ok: z.literal(true),
  pending: z.literal(true),
});
export type AdminSubscriptionActionResponse = z.infer<typeof adminSubscriptionActionResponseSchema>;

/**
 * Resposta das mutacoes de modulo. pending e literal false: attach e detach
 * gravam no banco na hora, depois da chamada a Stripe, igual ao fluxo do membro.
 */
export const adminSubscriptionAddonMutationResponseSchema = z.object({
  ok: z.literal(true),
  pending: z.literal(false),
  addonKey: z.string().min(1),
  status: addonStatusSchema,
  addonsAmountCents: z.number().int().nonnegative(),
  totalAmountCents: z.number().int().nonnegative(),
});
export type AdminSubscriptionAddonMutationResponse = z.infer<
  typeof adminSubscriptionAddonMutationResponseSchema
>;
```

- [ ] **Step 4: Registrar o subpath no `package.json`**

Em `packages/shared/package.json`, no mapa `exports`, logo depois da entrada `"./admin"`, acrescentar:

```json
    "./admin-subscription": {
      "types": "./src/admin-subscription.ts",
      "default": "./dist/admin-subscription.js"
    },
```

- [ ] **Step 5: Rodar o teste para confirmar que passa**

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/admin-subscription.test.ts
```

Esperado: PASS, 6 testes.

- [ ] **Step 6: Acrescentar as ações de auditoria**

Em `packages/shared/src/admin.ts`, dentro de `adminAuditActionSchema`, no fim da lista de valores, antes do `])`:

```ts
  'premium.subscription.plan_changed',
  'premium.subscription.addon_attached',
  'premium.subscription.addon_detached',
  'premium.subscription.cancel_scheduled',
  'premium.subscription.resumed',
  'premium.subscription.paused',
```

- [ ] **Step 7: Acrescentar o entityType**

Em `packages/shared/src/admin.ts`, dentro de `adminAuditEntityTypeSchema`, no fim da lista:

```ts
  'premium_membership',
```

- [ ] **Step 8: Estender a query da lista**

Em `packages/shared/src/admin.ts`, dentro de `adminFinanceMembershipsQuerySchema` (linha 693), depois de `garageId`:

```ts
  /** Filtra assinaturas que possuem este modulo com status active ou cancel_scheduled. */
  addonKey: z.string().min(1).max(40).optional(),
  /**
   * Filtra assinaturas que possuem qualquer modulo deste fornecedor, mesmos
   * status. Casamento exato, nao contains: a origem dos valores e o proprio
   * catalogo, nao texto livre do usuario.
   */
  vendorName: z.string().min(1).max(120).optional(),
```

- [ ] **Step 9: Estender o item da lista**

Em `packages/shared/src/admin.ts`, dentro de `adminFinanceMembershipsItemSchema` (linha 709), depois de `userName`:

```ts
  userId: z.string().min(1),
  userEmail: z.string(),
```

E depois de `providerSubRef`:

```ts
  baseAmountCents: z.number().int().nonnegative(),
  addonsAmountCents: z.number().int().nonnegative(),
  paymentBrand: z.string().nullable(),
  paymentLast4: z.string().nullable(),
  /** Chaves dos modulos vinculados, para chips na tabela. */
  addonKeys: z.array(z.string()),
```

- [ ] **Step 9b: Expor repasse e fornecedor no catálogo admin**

Sem isto o admin não tem como cadastrar o valor de repasse, e o filtro por fornecedor
da lista não tem de onde tirar as opções.

Em `packages/shared/src/admin.ts`, em `adminPremiumAddonModuleSchema` (linha 1332),
depois de `monthlyDeltaCents`:

```ts
  payoutAmountCents: z.number().int().nonnegative(),
  vendorName: z.string().nullable(),
```

Em `adminPremiumAddonModuleCreateSchema`, acrescentar:

```ts
  payoutAmountCents: z.number().int().nonnegative().default(0),
  vendorName: z.string().trim().min(1).max(120).nullable().optional(),
```

Em `adminPremiumAddonModuleUpdateSchema`, acrescentar os dois como opcionais:

```ts
  payoutAmountCents: z.number().int().nonnegative().optional(),
  vendorName: z.string().trim().min(1).max(120).nullable().optional(),
```

- [ ] **Step 9c: Propagar os campos na rota de catálogo**

Em `apps/api/src/routes/admin/premium-catalog-admin.ts`, localizar o `select` (ou o
mapeamento de resposta) dos módulos e acrescentar `payoutAmountCents` e `vendorName`.
Nos handlers de create e update do módulo, repassar os dois campos para o Prisma.

```bash
grep -n "monthlyDeltaCents" apps/api/src/routes/admin/premium-catalog-admin.ts
```

Cada ocorrência que carrega `monthlyDeltaCents` precisa carregar também os dois campos
novos. Se a rota usa `select` explícito, acrescente lá; se devolve o objeto inteiro do
Prisma, o `.parse()` do schema já vai exigir os campos e o teste acusa se faltar.

- [ ] **Step 9d: Atualizar a tela de catálogo do admin**

Em `apps/admin/app/(authed)/premium/catalogo/premium-catalog-client.tsx`, acrescentar
os dois campos ao formulário de módulo: um `input type="number"` para
`payoutAmountCents` em centavos e um `input type="text"` para `vendorName`. Mostrar a
margem derivada ao lado, com `monthlyDeltaCents - payoutAmountCents`.

Sem este passo o repasse fica sempre zero e a coluna Margem no detalhe iguala o valor
cobrado, que é o risco 4 registrado no spec.

- [ ] **Step 10: Compilar o pacote compartilhado**

```bash
pnpm --filter @ccc/shared build
```

Esperado: zero erro. Confere que `dist/admin-subscription.js` existe:

```bash
ls packages/shared/dist/admin-subscription.js
```

- [ ] **Step 11: Rodar a suíte do pacote compartilhado**

```bash
pnpm --filter @ccc/shared test
```

Esperado: PASS. Se algum teste antigo de `admin.ts` quebrar por causa dos campos novos obrigatórios, atualize a fixture desse teste — os campos são intencionalmente obrigatórios.

- [ ] **Step 12: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): schemas de controle admin de assinatura e filtros de modulo"
```

---

### Task 3: Métodos novos no cliente Stripe

**Files:**

- Modify: `apps/api/src/services/stripe/index.ts` (tipo `StripeClient` linhas 124-192, implementação `buildStripe` a partir da linha 205)
- Modify: `apps/api/src/services/stripe/fake.ts` (`FakeCall.kind` linhas 25-40, `FakeStripe` linhas 44-81, `buildFakeStripe`)
- Test: `apps/api/test/billing/stripe-client-subscription-actions.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces, em `StripeClient`:
  - `updateSubscriptionItemPrice(input: { subscriptionItemId: string; priceId: string; idempotencyKey: string }): Promise<void>`
  - `resumeSubscriptionCancellation(input: { subscriptionId: string; idempotencyKey: string }): Promise<void>`
  - `pauseSubscriptionCollection(input: { subscriptionId: string; idempotencyKey: string }): Promise<void>`
  - `resumeSubscriptionCollection(input: { subscriptionId: string; idempotencyKey: string }): Promise<void>`
  - No fake: `calls` registra os `kind` `'updateSubscriptionItemPrice'`, `'resumeSubscriptionCancellation'`, `'pauseSubscriptionCollection'`, `'resumeSubscriptionCollection'`; e os campos de erro injetável `nextUpdateSubscriptionItemPriceError`, `nextResumeSubscriptionCancellationError`, `nextPauseSubscriptionCollectionError`, `nextResumeSubscriptionCollectionError`, todos `Error | null` com default `null`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/billing/stripe-client-subscription-actions.test.ts`:

```ts
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { describe, expect, it } from 'vitest';

describe('fake stripe: acoes de assinatura', () => {
  it('registra a troca de preco do item com a chave de idempotencia', async () => {
    const stripe = buildFakeStripe();
    await stripe.updateSubscriptionItemPrice({
      subscriptionItemId: 'si_plan_1',
      priceId: 'price_gold_monthly',
      idempotencyKey: 'plan_change_mem_1_gold_monthly',
    });
    expect(stripe.calls).toEqual([
      {
        kind: 'updateSubscriptionItemPrice',
        payload: {
          subscriptionItemId: 'si_plan_1',
          priceId: 'price_gold_monthly',
          idempotencyKey: 'plan_change_mem_1_gold_monthly',
        },
      },
    ]);
  });

  it('registra retomada de cancelamento, pausa e retomada de cobranca', async () => {
    const stripe = buildFakeStripe();
    await stripe.resumeSubscriptionCancellation({ subscriptionId: 'sub_1', idempotencyKey: 'a' });
    await stripe.pauseSubscriptionCollection({ subscriptionId: 'sub_1', idempotencyKey: 'b' });
    await stripe.resumeSubscriptionCollection({ subscriptionId: 'sub_1', idempotencyKey: 'c' });
    expect(stripe.calls.map((c) => c.kind)).toEqual([
      'resumeSubscriptionCancellation',
      'pauseSubscriptionCollection',
      'resumeSubscriptionCollection',
    ]);
  });

  it('propaga o erro injetado em cada acao', async () => {
    const stripe = buildFakeStripe();
    stripe.nextUpdateSubscriptionItemPriceError = new Error('stripe down');
    await expect(
      stripe.updateSubscriptionItemPrice({
        subscriptionItemId: 'si_1',
        priceId: 'price_1',
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow('stripe down');

    stripe.nextPauseSubscriptionCollectionError = new Error('pause failed');
    await expect(
      stripe.pauseSubscriptionCollection({ subscriptionId: 'sub_1', idempotencyKey: 'k' }),
    ).rejects.toThrow('pause failed');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/stripe-client-subscription-actions.test.ts
```

Esperado: FAIL, `stripe.updateSubscriptionItemPrice is not a function`.

- [ ] **Step 3: Declarar os tipos de entrada e os métodos no `StripeClient`**

Em `apps/api/src/services/stripe/index.ts`, imediatamente antes de `export type StripeClient = {` (linha 124):

```ts
/**
 * Troca o Price de um SubscriptionItem existente. Usado pela troca de plano
 * iniciada pelo admin. proration_behavior fica em 'create_prorations': a
 * diferenca proporcional entra como credito ou debito na fatura seguinte, e nao
 * como cobranca imediata fora do ciclo. Mesma politica do vinculo de add-on.
 *
 * O DB nao e escrito aqui. O customer.subscription.updated resultante e que
 * dispara subscription.tier_changed e grava o snapshot novo.
 */
export type UpdateSubscriptionItemPriceInput = {
  subscriptionItemId: string;
  priceId: string;
  idempotencyKey: string;
};

/** Desfaz um cancelamento agendado: cancel_at_period_end volta para false. */
export type ResumeSubscriptionCancellationInput = {
  subscriptionId: string;
  idempotencyKey: string;
};

/**
 * Suspende a cobranca sem cancelar a assinatura. behavior 'void' descarta as
 * faturas do periodo pausado em vez de acumular divida para o membro.
 */
export type PauseSubscriptionCollectionInput = {
  subscriptionId: string;
  idempotencyKey: string;
};

/** Retoma a cobranca de uma assinatura pausada, limpando pause_collection. */
export type ResumeSubscriptionCollectionInput = {
  subscriptionId: string;
  idempotencyKey: string;
};
```

E dentro do tipo `StripeClient`, depois de `cancelSubscriptionAtPeriodEnd`:

```ts
updateSubscriptionItemPrice: (input: UpdateSubscriptionItemPriceInput) => Promise<void>;
resumeSubscriptionCancellation: (input: ResumeSubscriptionCancellationInput) => Promise<void>;
pauseSubscriptionCollection: (input: PauseSubscriptionCollectionInput) => Promise<void>;
resumeSubscriptionCollection: (input: ResumeSubscriptionCollectionInput) => Promise<void>;
```

- [ ] **Step 4: Implementar em `buildStripe`**

Em `apps/api/src/services/stripe/index.ts`, dentro do objeto retornado por `buildStripe`, depois da implementação de `cancelSubscriptionAtPeriodEnd`:

```ts
    updateSubscriptionItemPrice: async ({ subscriptionItemId, priceId, idempotencyKey }) => {
      await stripe.subscriptionItems.update(
        subscriptionItemId,
        { price: priceId, proration_behavior: 'create_prorations' },
        { idempotencyKey },
      );
    },
    resumeSubscriptionCancellation: async ({ subscriptionId, idempotencyKey }) => {
      await stripe.subscriptions.update(
        subscriptionId,
        { cancel_at_period_end: false },
        { idempotencyKey },
      );
    },
    pauseSubscriptionCollection: async ({ subscriptionId, idempotencyKey }) => {
      await stripe.subscriptions.update(
        subscriptionId,
        { pause_collection: { behavior: 'void' } },
        { idempotencyKey },
      );
    },
    resumeSubscriptionCollection: async ({ subscriptionId, idempotencyKey }) => {
      await stripe.subscriptions.update(
        subscriptionId,
        { pause_collection: null },
        { idempotencyKey },
      );
    },
```

- [ ] **Step 5: Estender o fake**

Em `apps/api/src/services/stripe/fake.ts`:

Nos imports de tipo, acrescentar `PauseSubscriptionCollectionInput`, `ResumeSubscriptionCancellationInput`, `ResumeSubscriptionCollectionInput`, `UpdateSubscriptionItemPriceInput`.

Na união `FakeCall.kind`, acrescentar:

```ts
    | 'updateSubscriptionItemPrice'
    | 'resumeSubscriptionCancellation'
    | 'pauseSubscriptionCollection'
    | 'resumeSubscriptionCollection';
```

No tipo `FakeStripe`, acrescentar:

```ts
/** When set, updateSubscriptionItemPrice throws this error. */
nextUpdateSubscriptionItemPriceError: Error | null;
/** When set, resumeSubscriptionCancellation throws this error. */
nextResumeSubscriptionCancellationError: Error | null;
/** When set, pauseSubscriptionCollection throws this error. */
nextPauseSubscriptionCollectionError: Error | null;
/** When set, resumeSubscriptionCollection throws this error. */
nextResumeSubscriptionCollectionError: Error | null;
```

No objeto `fake`, junto dos outros defaults:

```ts
    nextUpdateSubscriptionItemPriceError: null,
    nextResumeSubscriptionCancellationError: null,
    nextPauseSubscriptionCollectionError: null,
    nextResumeSubscriptionCollectionError: null,
```

E as quatro implementações, depois de `cancelSubscriptionAtPeriodEnd`:

```ts
    // eslint-disable-next-line @typescript-eslint/require-await
    updateSubscriptionItemPrice: async (input: UpdateSubscriptionItemPriceInput): Promise<void> => {
      fake.calls.push({ kind: 'updateSubscriptionItemPrice', payload: input });
      if (fake.nextUpdateSubscriptionItemPriceError) {
        throw fake.nextUpdateSubscriptionItemPriceError;
      }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    resumeSubscriptionCancellation: async (
      input: ResumeSubscriptionCancellationInput,
    ): Promise<void> => {
      fake.calls.push({ kind: 'resumeSubscriptionCancellation', payload: input });
      if (fake.nextResumeSubscriptionCancellationError) {
        throw fake.nextResumeSubscriptionCancellationError;
      }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    pauseSubscriptionCollection: async (
      input: PauseSubscriptionCollectionInput,
    ): Promise<void> => {
      fake.calls.push({ kind: 'pauseSubscriptionCollection', payload: input });
      if (fake.nextPauseSubscriptionCollectionError) {
        throw fake.nextPauseSubscriptionCollectionError;
      }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    resumeSubscriptionCollection: async (
      input: ResumeSubscriptionCollectionInput,
    ): Promise<void> => {
      fake.calls.push({ kind: 'resumeSubscriptionCollection', payload: input });
      if (fake.nextResumeSubscriptionCollectionError) {
        throw fake.nextResumeSubscriptionCollectionError;
      }
    },
```

- [ ] **Step 6: Rodar o teste para confirmar que passa**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/stripe-client-subscription-actions.test.ts
```

Esperado: PASS, 3 testes.

- [ ] **Step 7: Typecheck da API**

```bash
pnpm --filter @ccc/api typecheck
```

Esperado: zero erro. Se o SDK reclamar de `proration_behavior` em `subscriptionItems.update` ou do formato de `pause_collection`, abra `node_modules/stripe/types/` e ajuste ao tipo real da versão `2026-04-22.dahlia` — não force com `as`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/stripe apps/api/test/billing/stripe-client-subscription-actions.test.ts
git commit -m "feat(api): metodos de troca de preco, retomada e pausa no cliente Stripe"
```

---

### Task 4: Máquina de estados — pausar e retomar

**Files:**

- Modify: `apps/api/src/services/billing/types.ts` (união `BillingEvent`, linhas 52-120)
- Modify: `apps/api/src/services/billing/normalize-stripe.ts` (bloco `customer.subscription.updated`, linhas 169-245)
- Modify: `apps/api/src/services/billing/apply-membership-event.ts` (switch linhas 25-46, novos handlers)
- Test: `apps/api/test/billing/normalize-stripe-pause.test.ts`
- Test: `apps/api/test/billing/apply-membership-event-pause.test.ts`

**Interfaces:**

- Consumes: nada de tasks anteriores.
- Produces: variantes `{ kind: 'subscription.paused'; provider: PremiumProvider; providerSubRef: string }` e `{ kind: 'subscription.resumed'; provider: PremiumProvider; providerSubRef: string }` em `BillingEvent`. `normalizeStripeEvent` passa a emiti-las. `applyMembershipEvent` passa a tratá-las.

- [ ] **Step 1: Escrever o teste do normalizador**

Criar `apps/api/test/billing/normalize-stripe-pause.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { normalizeStripeEvent } from '../../src/services/billing/normalize-stripe.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';

const subUpdated = (object: Record<string, unknown>): WebhookEvent =>
  ({
    id: 'evt_1',
    type: 'customer.subscription.updated',
    data: { object },
  }) as unknown as WebhookEvent;

const baseSub = {
  id: 'sub_1',
  customer: 'cus_1',
  cancel_at_period_end: false,
  current_period_start: 1_700_000_000,
  current_period_end: 1_702_000_000,
  canceled_at: null,
  items: { data: [{ price: { id: 'price_gold', metadata: {} } }] },
};

describe('normalizeStripeEvent: pause_collection', () => {
  it('emite subscription.paused quando pause_collection aparece', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        pause_collection: { behavior: 'void' },
        previous_attributes: { pause_collection: null },
      }),
    );
    expect(result).toEqual({
      kind: 'subscription.paused',
      provider: 'stripe',
      providerSubRef: 'sub_1',
    });
  });

  it('emite subscription.resumed quando pause_collection volta a ser null', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        pause_collection: null,
        previous_attributes: { pause_collection: { behavior: 'void' } },
      }),
    );
    expect(result).toEqual({
      kind: 'subscription.resumed',
      provider: 'stripe',
      providerSubRef: 'sub_1',
    });
  });

  it('nao emite nada quando pause_collection nao muda', () => {
    expect(
      normalizeStripeEvent(
        subUpdated({ ...baseSub, pause_collection: null, previous_attributes: {} }),
      ),
    ).toBeNull();
  });

  it('flip de cancel_at_period_end tem prioridade sobre pause_collection', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        cancel_at_period_end: true,
        pause_collection: { behavior: 'void' },
        previous_attributes: { cancel_at_period_end: false, pause_collection: null },
      }),
    );
    expect(result).toMatchObject({ kind: 'subscription.cancelled' });
  });

  it('pause_collection tem prioridade sobre swap de preco', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        pause_collection: { behavior: 'void' },
        items: { data: [{ price: { id: 'price_silver', metadata: {} } }] },
        previous_attributes: {
          pause_collection: null,
          items: { data: [{ price: { id: 'price_gold' } }] },
        },
      }),
    );
    expect(result).toMatchObject({ kind: 'subscription.paused' });
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/normalize-stripe-pause.test.ts
```

Esperado: FAIL. Os dois primeiros casos devolvem `null` em vez do evento novo.

- [ ] **Step 3: Acrescentar as variantes em `types.ts`**

Em `apps/api/src/services/billing/types.ts`, no fim da união `BillingEvent`, depois da variante `subscription.tier_changed`:

```ts
  | {
      /**
       * Cobranca suspensa sem cancelamento (Stripe pause_collection). Produz o
       * status `paused`, que ja existia no enum do schema mas que nenhum evento
       * gerava antes desta mudanca.
       */
      kind: 'subscription.paused';
      provider: PremiumProvider;
      providerSubRef: string;
    }
  | {
      /** Cobranca retomada: pause_collection limpo. Volta para `active`. */
      kind: 'subscription.resumed';
      provider: PremiumProvider;
      providerSubRef: string;
    };
```

Trocar o `;` que fechava a variante anterior por nada, para a união continuar válida. O último membro fica com `;`.

- [ ] **Step 4: Acrescentar o discriminador no normalizador**

Em `apps/api/src/services/billing/normalize-stripe.ts`, no bloco `if (event.type === 'customer.subscription.updated')`, acrescentar `pause_collection` ao tipo local do objeto:

```ts
      pause_collection: { behavior?: string } | null;
```

e ao tipo de `previous_attributes`:

```ts
        pause_collection?: { behavior?: string } | null;
```

Depois, entre o bloco `// Discriminador 1: cancel_at_period_end flip` e o bloco `// Discriminador 2: price swap`, inserir:

```ts
// Discriminador 1.5: pause_collection flip.
//
// Avaliado DEPOIS do flip de cancel_at_period_end e ANTES do swap de preco.
// Ordem deliberada: um evento que cancela e pausa ao mesmo tempo e antes de
// tudo um cancelamento, que muda entitlement; pausa so muda cobranca. E a
// pausa da Stripe nao mexe em preco, entao vir antes do swap evita ler
// items.data[0] sem necessidade.
if (prev.pause_collection !== undefined) {
  const wasPaused = prev.pause_collection !== null;
  const isPaused = sub.pause_collection !== null;
  if (!wasPaused && isPaused) {
    return {
      kind: 'subscription.paused',
      provider: 'stripe',
      providerSubRef: sub.id,
    } satisfies BillingEvent & { kind: 'subscription.paused' };
  }
  if (wasPaused && !isPaused) {
    return {
      kind: 'subscription.resumed',
      provider: 'stripe',
      providerSubRef: sub.id,
    } satisfies BillingEvent & { kind: 'subscription.resumed' };
  }
}
```

- [ ] **Step 5: Rodar o teste do normalizador**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/normalize-stripe-pause.test.ts
```

Esperado: PASS, 5 testes.

- [ ] **Step 6: Rodar o teste do normalizador que já existia, para provar que nada regrediu**

```bash
pnpm --filter @ccc/api exec vitest run test/billing
```

Esperado: PASS. Se o `switch` de `applyMembershipEvent` ainda não trata os dois novos `kind`, o TypeScript acusa no typecheck, não aqui.

- [ ] **Step 7: Escrever o teste dos handlers**

Criar `apps/api/test/billing/apply-membership-event-pause.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import { createUser, resetDatabase } from '../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

async function seedMembership(status: 'active' | 'paused') {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await prisma.garage.update({
    where: { id: garage.id },
    data: { premiumTier: 'gold', premiumUntil: PERIOD_END },
  });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: 'sub_1',
      tier: 'gold',
      cadence: 'monthly',
      status,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 149000,
      currency: 'BRL',
    },
  });
  return { garageId: garage.id, membershipId: membership.id };
}

describe('applyMembershipEvent: paused e resumed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('paused muda o status e nao toca no snapshot da garagem', async () => {
    const { garageId, membershipId } = await seedMembership('active');

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.paused',
        provider: 'stripe',
        providerSubRef: 'sub_1',
      });
    });

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.status).toBe('paused');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil?.toISOString()).toBe(PERIOD_END.toISOString());
  });

  it('resumed volta para active e reaplica o snapshot com a regra de max', async () => {
    const { garageId, membershipId } = await seedMembership('paused');
    const farFuture = new Date('2027-01-01T00:00:00.000Z');
    await prisma.garage.update({
      where: { id: garageId },
      data: { premiumTier: null, premiumUntil: farFuture },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.resumed',
        provider: 'stripe',
        providerSubRef: 'sub_1',
      });
    });

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.status).toBe('active');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
    // max() rule: a concessao manual mais distante nao pode ser encurtada.
    expect(garage.premiumUntil?.toISOString()).toBe(farFuture.toISOString());
  });

  it('resumed limpa a flag de cancelamento agendado', async () => {
    const { garageId, membershipId } = await seedMembership('paused');
    await prisma.premiumMembership.update({
      where: { id: membershipId },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.resumed',
        provider: 'stripe',
        providerSubRef: 'sub_1',
      });
    });

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.cancelAtPeriodEnd).toBe(false);
    expect(membership.cancelledAt).toBeNull();
  });
});
```

- [ ] **Step 8: Rodar o teste dos handlers para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/apply-membership-event-pause.test.ts
```

Esperado: FAIL, com `applyMembershipEvent: unhandled kind subscription.paused`.

- [ ] **Step 9: Acrescentar os casos no switch**

Em `apps/api/src/services/billing/apply-membership-event.ts`, no `switch (evt.kind)`, depois do case `'subscription.tier_changed'`:

```ts
    case 'subscription.paused':
      return handlePaused(tx, evt);
    case 'subscription.resumed':
      return handleResumed(tx, evt);
```

- [ ] **Step 10: Implementar os dois handlers**

Em `apps/api/src/services/billing/apply-membership-event.ts`, depois de `handleTierChanged` e antes do bloco de `applyInvoiceRefund`:

```ts
// ---------------------------------------------------------------------------
// subscription.paused (Stripe pause_collection)
// ---------------------------------------------------------------------------

async function handlePaused(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.paused' }>,
): Promise<void> {
  const { provider, providerSubRef } = evt;

  // Status flip only. Snapshot da Garage fica intacto de proposito: o membro
  // mantem entitlement ate premiumUntil, mesma escolha ja feita em handlePastDue.
  // Pausa suspende cobranca, nao revoga o que ja foi pago.
  await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'paused' },
  });
}

// ---------------------------------------------------------------------------
// subscription.resumed (pause_collection cleared)
// ---------------------------------------------------------------------------

async function handleResumed(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.resumed' }>,
): Promise<void> {
  const { provider, providerSubRef } = evt;

  const membership = await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'active', cancelAtPeriodEnd: false, cancelledAt: null },
  });

  // Snapshot refresh com a regra de max() (canon §F8.3), igual a
  // handleUncancelled: uma concessao manual mais distante nao pode ser encurtada.
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
  const existingUntil = garage.premiumUntil ?? new Date(0);
  const newUntil =
    membership.currentPeriodEnd > existingUntil ? membership.currentPeriodEnd : existingUntil;

  await tx.garage.update({
    where: { id: membership.garageId },
    data: { premiumTier: membership.tier, premiumUntil: newUntil },
  });
}
```

- [ ] **Step 11: Rodar o teste dos handlers**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/apply-membership-event-pause.test.ts
```

Esperado: PASS, 3 testes.

- [ ] **Step 12: Rodar toda a suíte de billing**

```bash
pnpm --filter @ccc/api exec vitest run test/billing
```

Esperado: PASS. Nada de billing pode regredir.

- [ ] **Step 13: Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Esperado: zero erro. O `switch` exaustivo com checagem `never` é a rede de segurança: se faltar um case, o erro aparece aqui.

- [ ] **Step 14: Commit**

```bash
git add apps/api/src/services/billing apps/api/test/billing
git commit -m "feat(api): estados paused e resumed na maquina de cobranca"
```

---

### Task 5: Snapshot de método de pagamento

**Files:**

- Modify: `apps/api/src/services/billing/types.ts` (`BillingPricing`, linhas 9-15)
- Modify: `apps/api/src/services/billing/apply-membership-event.ts` (`handleActivated`, `handleRenewed`)
- Modify: `apps/api/src/routes/stripe-billing-webhook.ts` (antes do `prisma.$transaction` da linha 537)
- Test: `apps/api/test/billing/payment-method-snapshot.test.ts`

**Interfaces:**

- Consumes: colunas `paymentBrand` e `paymentLast4` da Task 1.
- Produces: `BillingPricing.paymentBrand?: string` e `BillingPricing.paymentLast4?: string`. `handleActivated` e `handleRenewed` gravam esses valores quando presentes, e nunca sobrescrevem com `null`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/billing/payment-method-snapshot.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import { createUser, resetDatabase } from '../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

async function garageFor() {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return garage.id;
}

const activatedEvent = (
  garageId: string,
  payment: { paymentBrand?: string; paymentLast4?: string },
): BillingEvent => ({
  kind: 'subscription.activated',
  provider: 'stripe',
  providerCustomerRef: 'cus_1',
  providerSubRef: 'sub_1',
  garageId,
  tier: 'gold',
  cadence: 'monthly',
  currentPeriodStart: PERIOD_START,
  currentPeriodEnd: PERIOD_END,
  pricing: {
    baseAmountCents: 149000,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    grossAmountCents: 149000,
    currency: 'BRL',
    ...payment,
  },
  invoice: {
    providerInvoiceRef: 'in_1',
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    paidAt: PERIOD_START,
  },
  lines: [],
  addons: [],
  addonsAmountCents: 0,
});

const renewedEvent = (payment: { paymentBrand?: string; paymentLast4?: string }): BillingEvent => ({
  kind: 'subscription.renewed',
  provider: 'stripe',
  providerSubRef: 'sub_1',
  currentPeriodStart: PERIOD_END,
  currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
  pricing: {
    baseAmountCents: 149000,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    grossAmountCents: 149000,
    currency: 'BRL',
    ...payment,
  },
  invoice: {
    providerInvoiceRef: 'in_2',
    periodStart: PERIOD_END,
    periodEnd: new Date('2026-10-01T00:00:00.000Z'),
    paidAt: PERIOD_END,
  },
  lines: [],
});

async function apply(garageId: string, evt: BillingEvent) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
    await applyMembershipEvent(tx, evt);
  });
}

describe('snapshot de metodo de pagamento', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('grava bandeira e final na ativacao', async () => {
    const garageId = await garageFor();
    await apply(garageId, activatedEvent(garageId, { paymentBrand: 'visa', paymentLast4: '4242' }));

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.paymentBrand).toBe('visa');
    expect(membership.paymentLast4).toBe('4242');
  });

  it('ativacao sem o dado deixa as colunas nulas', async () => {
    const garageId = await garageFor();
    await apply(garageId, activatedEvent(garageId, {}));

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.paymentBrand).toBeNull();
    expect(membership.paymentLast4).toBeNull();
  });

  it('renovacao sem o dado NAO apaga o snapshot da ativacao', async () => {
    const garageId = await garageFor();
    await apply(garageId, activatedEvent(garageId, { paymentBrand: 'visa', paymentLast4: '4242' }));
    await apply(garageId, renewedEvent({}));

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.paymentBrand).toBe('visa');
    expect(membership.paymentLast4).toBe('4242');
  });

  it('renovacao com dado novo substitui o antigo', async () => {
    const garageId = await garageFor();
    await apply(garageId, activatedEvent(garageId, { paymentBrand: 'visa', paymentLast4: '4242' }));
    await apply(garageId, renewedEvent({ paymentBrand: 'mastercard', paymentLast4: '1111' }));

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.paymentBrand).toBe('mastercard');
    expect(membership.paymentLast4).toBe('1111');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/payment-method-snapshot.test.ts
```

Esperado: FAIL. O primeiro caso acha `null` onde esperava `'visa'`.

- [ ] **Step 3: Acrescentar os campos em `BillingPricing`**

Em `apps/api/src/services/billing/types.ts`, dentro de `BillingPricing`, depois de `currency`:

```ts
  /**
   * Bandeira e final do cartao, quando o provider os fornece.
   *
   * Vivem em BillingPricing porque ele ja e o portador de snapshot dos tres
   * eventos que reescrevem valores da assinatura (activated, renewed,
   * tier_changed). Nenhuma variante nova de BillingEvent, nenhuma assinatura
   * de funcao alterada.
   *
   * Opcionais de proposito. RevenueCat nunca preenche, e a Stripe so preenche
   * quando a rota consegue resolver o PaymentIntent. Ausencia nunca e erro.
   */
  paymentBrand?: string;
  paymentLast4?: string;
```

- [ ] **Step 4: Gravar na ativação**

Em `handleActivated`, no objeto de dados do `create`/`upsert` da `premiumMembership`, acrescentar junto de `currency`:

```ts
      ...(pricing.paymentBrand ? { paymentBrand: pricing.paymentBrand } : {}),
      ...(pricing.paymentLast4 ? { paymentLast4: pricing.paymentLast4 } : {}),
```

Se `handleActivated` também tiver um caminho de `update` para avanço de período, aplicar o mesmo spread lá.

- [ ] **Step 5: Gravar na renovação**

Em `handleRenewed`, no objeto de dados do `update` da `premiumMembership`, acrescentar junto de `currency` o mesmo spread condicional:

```ts
      // Spread condicional, nao atribuicao direta: uma renovacao sem o dado nao
      // pode apagar com null o snapshot bom gravado na ativacao.
      ...(pricing.paymentBrand ? { paymentBrand: pricing.paymentBrand } : {}),
      ...(pricing.paymentLast4 ? { paymentLast4: pricing.paymentLast4 } : {}),
```

- [ ] **Step 6: Rodar o teste**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/payment-method-snapshot.test.ts
```

Esperado: PASS, 4 testes.

- [ ] **Step 7: Resolver o método de pagamento na rota do webhook**

Em `apps/api/src/routes/stripe-billing-webhook.ts`, imediatamente antes do bloco `await prisma.$transaction(...)` da linha 537, inserir:

```ts
// -----------------------------------------------------------------------
// Metodo de pagamento (conveniencia para o admin, nao dado de cobranca)
//
// O payload de invoice.paid traz `payment_intent` como id, nao expandido,
// entao a bandeira e o final do cartao NAO estao no evento. O normalizador e
// puro e nao pode buscar: a resolucao fica aqui.
//
// Falha desta chamada nao derruba o webhook. Perder um dado de exibicao nao
// pode impedir o processamento de uma cobranca.
// -----------------------------------------------------------------------
if (
  (billingEvt.kind === 'subscription.activated' || billingEvt.kind === 'subscription.renewed') &&
  !billingEvt.pricing.paymentBrand
) {
  const paymentIntentId = (event.data.object as { payment_intent?: unknown }).payment_intent;
  if (typeof paymentIntentId === 'string' && paymentIntentId.length > 0) {
    try {
      const card = await app.stripe.retrievePaymentMethodCard(paymentIntentId);
      if (card) {
        billingEvt.pricing.paymentBrand = card.brand;
        billingEvt.pricing.paymentLast4 = card.last4;
      }
    } catch (err) {
      request.log.warn(
        { eventId: event.id, paymentIntentId, err },
        'stripe-billing webhook: falha ao resolver metodo de pagamento, seguindo sem ele',
      );
    }
  }
}
```

- [ ] **Step 8: Acrescentar `retrievePaymentMethodCard` ao cliente Stripe**

Em `apps/api/src/services/stripe/index.ts`, antes de `export type StripeClient = {`:

```ts
/**
 * Bandeira e final do cartao de um PaymentIntent, ou null quando o pagamento nao
 * foi por cartao ou o dado nao esta disponivel. Usado apenas para exibicao no
 * admin — nunca para decisao de cobranca.
 */
export type PaymentMethodCard = { brand: string; last4: string };
```

No tipo `StripeClient`, depois de `resumeSubscriptionCollection`:

```ts
retrievePaymentMethodCard: (paymentIntentId: string) => Promise<PaymentMethodCard | null>;
```

Na implementação de `buildStripe`:

```ts
    retrievePaymentMethodCard: async (paymentIntentId) => {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['payment_method'],
      });
      const pm = pi.payment_method;
      if (!pm || typeof pm === 'string' || pm.type !== 'card' || !pm.card) return null;
      return { brand: pm.card.brand, last4: pm.card.last4 };
    },
```

No fake, acrescentar `'retrievePaymentMethodCard'` à união `FakeCall.kind`, um campo `nextPaymentMethodCard: PaymentMethodCard | null` com default `null`, um campo `nextRetrievePaymentMethodCardError: Error | null` com default `null`, e a implementação:

```ts
    // eslint-disable-next-line @typescript-eslint/require-await
    retrievePaymentMethodCard: async (paymentIntentId: string) => {
      fake.calls.push({ kind: 'retrievePaymentMethodCard', payload: { paymentIntentId } });
      if (fake.nextRetrievePaymentMethodCardError) {
        throw fake.nextRetrievePaymentMethodCardError;
      }
      return fake.nextPaymentMethodCard;
    },
```

- [ ] **Step 9: Escrever o teste do webhook**

Acrescentar ao fim de `apps/api/test/billing/payment-method-snapshot.test.ts` um `describe` novo, importando `makeAppWithFakeStripe` de `../helpers.js`. Nele:

```ts
describe('webhook de billing: resolucao do metodo de pagamento', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('resolve o cartao via PaymentIntent e grava o snapshot', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    stripe.nextPaymentMethodCard = { brand: 'visa', last4: '4242' };
    // Monte o evento invoice.paid com billing_reason 'subscription_create',
    // customer com metadata garageId, e payment_intent como string 'pi_1'.
    // Reaproveite o helper de montagem de evento que os testes de
    // test/billing/stripe-billing-webhook.test.ts ja usam — nao duplique.
    // Depois de injetar o evento e chamar app.inject no POST
    // /webhooks/stripe-billing, asserte:
    //   - stripe.calls contem { kind: 'retrievePaymentMethodCard', ... }
    //   - a PremiumMembership criada tem paymentBrand 'visa' e paymentLast4 '4242'
    await app.close();
  });

  it('falha ao resolver o cartao nao derruba o webhook', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    stripe.nextRetrievePaymentMethodCardError = new Error('stripe down');
    // Mesmo evento do caso anterior. Asserte:
    //   - resposta 200
    //   - a PremiumMembership foi criada
    //   - paymentBrand e paymentLast4 sao null
    await app.close();
  });
});
```

Ao implementar, abra `apps/api/test/billing/stripe-billing-webhook.test.ts` e reutilize literalmente o helper de montagem de evento e de assinatura que ele já tem. Substitua os comentários acima por asserções reais no mesmo estilo do arquivo existente.

- [ ] **Step 10: Rodar os testes de billing**

```bash
pnpm --filter @ccc/api exec vitest run test/billing
```

Esperado: PASS, incluindo os dois casos novos de webhook.

- [ ] **Step 11: Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Esperado: zero erro.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src apps/api/test/billing
git commit -m "feat(api): snapshot de bandeira e final do cartao na assinatura"
```

---

### Task 6: Erros de domínio de billing

**Files:**

- Create: `apps/api/src/services/billing/errors.ts`
- Test: `apps/api/test/billing/errors.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces:
  - `type BillingActionCode = 'MembershipNotFound' | 'ModuleNotFound' | 'AddonAlreadyAttached' | 'AddonNotAttached' | 'InvalidStatus' | 'ProviderNotMutable' | 'NoChange' | 'PlanPriceMissing' | 'AmbiguousPlanItem'`
  - `class BillingActionError extends Error` com `readonly code: BillingActionCode`, `readonly httpStatus: number`, `readonly detail: Record<string, unknown> | undefined`
  - `const isBillingActionError = (err: unknown): err is BillingActionError`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/billing/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { BillingActionError, isBillingActionError } from '../../src/services/billing/errors.js';

describe('BillingActionError', () => {
  it('carrega codigo, status e detalhe', () => {
    const err = new BillingActionError('InvalidStatus', 'status atual: expired', {
      status: 'expired',
    });
    expect(err.code).toBe('InvalidStatus');
    expect(err.httpStatus).toBe(409);
    expect(err.message).toBe('status atual: expired');
    expect(err.detail).toEqual({ status: 'expired' });
  });

  it('mapeia cada codigo para o status HTTP certo', () => {
    const cases: Array<[string, number]> = [
      ['MembershipNotFound', 404],
      ['ModuleNotFound', 404],
      ['AddonNotAttached', 404],
      ['AddonAlreadyAttached', 409],
      ['InvalidStatus', 409],
      ['ProviderNotMutable', 409],
      ['NoChange', 409],
      ['AmbiguousPlanItem', 409],
      ['PlanPriceMissing', 422],
    ];
    for (const [code, status] of cases) {
      expect(new BillingActionError(code as never, 'x').httpStatus).toBe(status);
    }
  });

  it('e reconhecivel pelo type guard e nao confunde erro comum', () => {
    expect(isBillingActionError(new BillingActionError('NoChange', 'x'))).toBe(true);
    expect(isBillingActionError(new Error('x'))).toBe(false);
    expect(isBillingActionError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/errors.test.ts
```

Esperado: FAIL, módulo `errors.js` não resolve.

- [ ] **Step 3: Implementar**

Criar `apps/api/src/services/billing/errors.ts`:

```ts
/**
 * Erros de dominio das acoes de billing.
 *
 * Os servicos em addons.ts e subscription-actions.ts nao conhecem Fastify e nao
 * podem responder HTTP. Eles lancam BillingActionError com um codigo estavel; as
 * rotas traduzem esse codigo para o corpo de resposta que cada superficie ja
 * contratou. Isso e o que permite a rota do membro manter EXATAMENTE os codigos e
 * mensagens que ela ja retornava antes da extracao, enquanto a rota admin usa os
 * seus proprios.
 */

export type BillingActionCode =
  | 'MembershipNotFound'
  | 'ModuleNotFound'
  | 'AddonAlreadyAttached'
  | 'AddonNotAttached'
  | 'InvalidStatus'
  | 'ProviderNotMutable'
  | 'NoChange'
  | 'PlanPriceMissing'
  | 'AmbiguousPlanItem';

const HTTP_STATUS: Record<BillingActionCode, number> = {
  MembershipNotFound: 404,
  ModuleNotFound: 404,
  AddonNotAttached: 404,
  AddonAlreadyAttached: 409,
  InvalidStatus: 409,
  ProviderNotMutable: 409,
  NoChange: 409,
  AmbiguousPlanItem: 409,
  PlanPriceMissing: 422,
};

export class BillingActionError extends Error {
  readonly code: BillingActionCode;
  readonly httpStatus: number;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: BillingActionCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'BillingActionError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.detail = detail;
  }
}

export const isBillingActionError = (err: unknown): err is BillingActionError =>
  err instanceof BillingActionError;
```

- [ ] **Step 4: Rodar o teste**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/errors.test.ts
```

Esperado: PASS, 3 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/billing/errors.ts apps/api/test/billing/errors.test.ts
git commit -m "feat(api): erro de dominio tipado para acoes de billing"
```

---

### Task 7: Extrair o serviço de módulos

Esta é a task de refatoração. A prova de que ela deu certo é a suíte existente de `me-premium-addons` passar **sem nenhuma alteração**. Não edite nenhum teste em `apps/api/test/` que já exista para essa rota.

**Files:**

- Create: `apps/api/src/services/billing/addons.ts`
- Modify: `apps/api/src/routes/me-premium-addons.ts` (handler de attach linhas 162-315, handler de detach linhas 324-408)
- Test: `apps/api/test/billing/addons-service.test.ts`

**Interfaces:**

- Consumes: `BillingActionError` da Task 6; colunas `payoutAmountCents` e `vendorName` da Task 1; `StripeClient`.
- Produces:

  ```ts
  type AddonMutationResult = {
    addonKey: string;
    status: 'active' | 'cancel_scheduled' | 'cancelled';
    addonsAmountCents: number;
    totalAmountCents: number;
  };
  attachAddon(input: { membershipId: string; addonKey: string; stripe: StripeClient; logger: FastifyBaseLogger }): Promise<AddonMutationResult>
  detachAddon(input: { membershipId: string; addonKey: string; stripe: StripeClient; logger: FastifyBaseLogger }): Promise<AddonMutationResult>
  ```

- [ ] **Step 1: Escrever o teste do serviço**

Criar `apps/api/test/billing/addons-service.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attachAddon, detachAddon } from '../../src/services/billing/addons.js';
import { isBillingActionError } from '../../src/services/billing/errors.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as never;

async function seed(opts: { stripePriceId?: string | null } = {}) {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: 'sub_1',
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 149000,
      currency: 'BRL',
    },
  });
  await prisma.premiumAddonModule.create({
    data: {
      key: 'detailing',
      name: 'Detailing',
      description: '3 acessos',
      monthlyDeltaCents: 15000,
      payoutAmountCents: 9000,
      vendorName: 'Lava Rápido X',
      quotaPerCycle: 3,
      quotaUnit: 'access',
      currency: 'BRL',
      active: true,
      stripePriceId: opts.stripePriceId === undefined ? 'price_detailing' : opts.stripePriceId,
    },
  });
  return { membershipId: membership.id };
}

describe('attachAddon', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('snapshota repasse e fornecedor no vinculo', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    const result = await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    expect(result).toEqual({
      addonKey: 'detailing',
      status: 'active',
      addonsAmountCents: 15000,
      totalAmountCents: 164000,
    });

    const addon = await prisma.premiumMembershipAddon.findFirstOrThrow({
      where: { membershipId, addonKey: 'detailing' },
    });
    expect(addon.payoutAmountCents).toBe(9000);
    expect(addon.vendorName).toBe('Lava Rápido X');
    expect(addon.monthlyDeltaCents).toBe(15000);
    expect(addon.providerItemRef).toBe('si_fake_1');
  });

  it('chama a Stripe antes de gravar e abre o ciclo alinhado ao periodo', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    expect(stripe.calls).toEqual([
      {
        kind: 'addSubscriptionItem',
        payload: {
          subscriptionId: 'sub_1',
          priceId: 'price_detailing',
          idempotencyKey: `addon_attach_${membershipId}_detailing`,
        },
      },
    ]);

    const usage = await prisma.premiumAddonUsage.findFirstOrThrow({});
    expect(usage.cycleStart.toISOString()).toBe(PERIOD_START.toISOString());
    expect(usage.cycleEnd.toISOString()).toBe(PERIOD_END.toISOString());
    expect(usage.quotaTotal).toBe(3);
  });

  it('falha na Stripe deixa o banco intacto', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    stripe.nextAddSubscriptionItemError = new Error('stripe down');

    await expect(
      attachAddon({ membershipId, addonKey: 'detailing', stripe, logger }),
    ).rejects.toThrow('stripe down');

    expect(await prisma.premiumMembershipAddon.count()).toBe(0);
    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.addonsAmountCents).toBe(0);
  });

  it('sem stripePriceId cai em local-only sem lancar', async () => {
    const { membershipId } = await seed({ stripePriceId: null });
    const stripe = buildFakeStripe();

    const result = await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    expect(result.status).toBe('active');
    expect(stripe.calls).toEqual([]);
    const addon = await prisma.premiumMembershipAddon.findFirstOrThrow({ where: { membershipId } });
    expect(addon.providerItemRef).toBeNull();
  });

  it('modulo inexistente lanca ModuleNotFound', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger }).catch(
      () => undefined,
    );

    const err = await attachAddon({ membershipId, addonKey: 'inexistente', stripe, logger }).catch(
      (e: unknown) => e,
    );
    expect(isBillingActionError(err) && err.code).toBe('ModuleNotFound');
  });

  it('vinculo duplicado lanca AddonAlreadyAttached', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    const err = await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger }).catch(
      (e: unknown) => e,
    );
    expect(isBillingActionError(err) && err.code).toBe('AddonAlreadyAttached');
  });

  it('assinatura inexistente lanca MembershipNotFound', async () => {
    const stripe = buildFakeStripe();
    const err = await attachAddon({
      membershipId: 'mem_inexistente',
      addonKey: 'detailing',
      stripe,
      logger,
    }).catch((e: unknown) => e);
    expect(isBillingActionError(err) && err.code).toBe('MembershipNotFound');
  });
});

describe('detachAddon', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('marca cancel_scheduled, nunca apaga, e recalcula o total', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    await attachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    const result = await detachAddon({ membershipId, addonKey: 'detailing', stripe, logger });

    expect(result).toEqual({
      addonKey: 'detailing',
      status: 'cancel_scheduled',
      addonsAmountCents: 0,
      totalAmountCents: 149000,
    });

    const addon = await prisma.premiumMembershipAddon.findFirstOrThrow({ where: { membershipId } });
    expect(addon.status).toBe('cancel_scheduled');
    expect(stripe.calls.at(-1)).toEqual({
      kind: 'removeSubscriptionItem',
      payload: { subscriptionItemId: 'si_fake_1', idempotencyKey: `addon_detach_${addon.id}` },
    });
  });

  it('modulo nao vinculado lanca AddonNotAttached', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    const err = await detachAddon({ membershipId, addonKey: 'detailing', stripe, logger }).catch(
      (e: unknown) => e,
    );
    expect(isBillingActionError(err) && err.code).toBe('AddonNotAttached');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/addons-service.test.ts
```

Esperado: FAIL, módulo `addons.js` não resolve.

- [ ] **Step 3: Criar o serviço**

Criar `apps/api/src/services/billing/addons.ts`. O corpo é a lógica que hoje vive nos dois handlers de `me-premium-addons.ts`, movida sem mudança de comportamento, mais o snapshot de repasse e fornecedor:

```ts
import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';

import type { StripeClient } from '../stripe/index.js';

import { BillingActionError } from './errors.js';

/** Add-on statuses que ainda contam como vinculado (cobravel ou em encerramento). */
const ATTACHED_ADDON_STATUSES = ['active', 'cancel_scheduled'] as const;

export type AddonMutationResult = {
  addonKey: string;
  status: 'active' | 'cancel_scheduled' | 'cancelled';
  addonsAmountCents: number;
  totalAmountCents: number;
};

type AddonMutationInput = {
  membershipId: string;
  addonKey: string;
  stripe: StripeClient;
  logger: FastifyBaseLogger;
};

/**
 * Recalcula addonsAmountCents somando SO os add-ons `active`. Um add-on em
 * cancel_scheduled ja nao e cobrado pela Stripe, entao nao pode continuar
 * somando no total local.
 */
async function recomputeAddonsAmount(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  membershipId: string,
): Promise<number> {
  const agg = await tx.premiumMembershipAddon.aggregate({
    where: { membershipId, status: 'active' },
    _sum: { monthlyDeltaCents: true },
  });
  const addonsAmountCents = agg._sum.monthlyDeltaCents ?? 0;
  await tx.premiumMembership.update({
    where: { id: membershipId },
    data: { addonsAmountCents },
  });
  return addonsAmountCents;
}

/**
 * Vincula um modulo a uma assinatura.
 *
 * Ordem provider-first: o SubscriptionItem da Stripe e criado ANTES da
 * transacao. Falha da Stripe lanca aqui e deixa o estado local intocado, sem
 * necessidade de compensacao. O caso raro de orfao (Stripe ok, tx falha depois)
 * e reconciliado pelo sync do webhook de add-ons e pelo worker de reconciliacao.
 *
 * Fallback local-only, sem lancar, quando a assinatura nao tem providerSubRef OU
 * o modulo nao tem stripePriceId configurado.
 *
 * Preco, cota, repasse e fornecedor sao SNAPSHOTADOS no vinculo: editar o
 * catalogo depois nao altera um add-on ja ativo.
 *
 * Nao valida o status da assinatura. Isso e responsabilidade do chamador, porque
 * a lista de status aceitos difere entre a superficie do membro e a do admin.
 */
export const attachAddon = async ({
  membershipId,
  addonKey,
  stripe,
  logger,
}: AddonMutationInput): Promise<AddonMutationResult> => {
  const membership = await prisma.premiumMembership.findUnique({ where: { id: membershipId } });
  if (!membership) {
    throw new BillingActionError('MembershipNotFound', 'membership not found', { membershipId });
  }

  const addonModule = await prisma.premiumAddonModule.findUnique({ where: { key: addonKey } });
  if (!addonModule || !addonModule.active) {
    throw new BillingActionError('ModuleNotFound', 'add-on module not found', { addonKey });
  }

  const existing = await prisma.premiumMembershipAddon.findUnique({
    where: { membershipId_addonKey: { membershipId, addonKey } },
  });
  if (existing && existing.status !== 'cancelled') {
    throw new BillingActionError('AddonAlreadyAttached', 'add-on already attached', { addonKey });
  }

  const cycleStart = membership.currentPeriodStart ?? new Date();
  const cycleEnd = membership.currentPeriodEnd;

  let providerItemRef: string | null = null;
  const stripeBacked = membership.provider === 'stripe' && Boolean(membership.providerSubRef);
  if (stripeBacked && addonModule.stripePriceId) {
    const item = await stripe.addSubscriptionItem({
      subscriptionId: membership.providerSubRef,
      priceId: addonModule.stripePriceId,
      idempotencyKey: `addon_attach_${membership.id}_${addonKey}`,
    });
    providerItemRef = item.subscriptionItemId;
  } else {
    logger.info(
      {
        membershipId: membership.id,
        addonKey,
        provider: membership.provider,
        hasStripePrice: Boolean(addonModule.stripePriceId),
      },
      'billing/addons: attach local-only (no stripe sub ref or module stripePriceId)',
    );
  }

  const snapshot = {
    providerItemRef,
    monthlyDeltaCents: addonModule.monthlyDeltaCents,
    payoutAmountCents: addonModule.payoutAmountCents,
    vendorName: addonModule.vendorName,
    quotaPerCycle: addonModule.quotaPerCycle,
    quotaUnit: addonModule.quotaUnit,
    currency: addonModule.currency,
  };

  const addonsAmountCents = await prisma.$transaction(async (tx) => {
    if (existing) {
      // Re-vinculo de um add-on antes cancelado: refresca o snapshot para os
      // termos atuais do catalogo e reabre o ciclo de uso deste periodo.
      await tx.premiumMembershipAddon.update({
        where: { id: existing.id },
        data: { status: 'active', ...snapshot },
      });
      await tx.premiumAddonUsage.upsert({
        where: { membershipAddonId_cycleStart: { membershipAddonId: existing.id, cycleStart } },
        create: {
          membershipAddonId: existing.id,
          cycleStart,
          cycleEnd,
          quotaTotal: addonModule.quotaPerCycle,
          quotaUsed: 0,
        },
        update: {},
      });
    } else {
      const created = await tx.premiumMembershipAddon.create({
        data: { membershipId, addonKey, status: 'active', ...snapshot },
      });
      await tx.premiumAddonUsage.create({
        data: {
          membershipAddonId: created.id,
          cycleStart,
          cycleEnd,
          quotaTotal: addonModule.quotaPerCycle,
          quotaUsed: 0,
        },
      });
    }

    return recomputeAddonsAmount(tx, membershipId);
  });

  return {
    addonKey,
    status: 'active',
    addonsAmountCents,
    totalAmountCents: membership.baseAmountCents + addonsAmountCents,
  };
};

/**
 * Desvincula um modulo.
 *
 * Ordem provider-first, espelhando o attach. O item da Stripe e removido de
 * imediato, com rateio; a linha local vira `cancel_scheduled` para o membro
 * manter a cota ate o fim do periodo enquanto a Stripe para de cobrar. Isso e
 * uma simplificacao deliberada, herdada do fluxo do membro.
 *
 * Nunca faz hard delete: o historico de uso e preservado.
 */
export const detachAddon = async ({
  membershipId,
  addonKey,
  stripe,
  logger,
}: AddonMutationInput): Promise<AddonMutationResult> => {
  const membership = await prisma.premiumMembership.findUnique({ where: { id: membershipId } });
  if (!membership) {
    throw new BillingActionError('MembershipNotFound', 'membership not found', { membershipId });
  }

  const addon = await prisma.premiumMembershipAddon.findUnique({
    where: { membershipId_addonKey: { membershipId, addonKey } },
  });
  if (!addon || !(ATTACHED_ADDON_STATUSES as readonly string[]).includes(addon.status)) {
    throw new BillingActionError('AddonNotAttached', 'add-on not attached', { addonKey });
  }

  if (membership.provider === 'stripe' && addon.providerItemRef) {
    await stripe.removeSubscriptionItem({
      subscriptionItemId: addon.providerItemRef,
      idempotencyKey: `addon_detach_${addon.id}`,
    });
  } else {
    logger.info(
      { membershipId, addonKey, provider: membership.provider },
      'billing/addons: detach local-only (no provider item ref)',
    );
  }

  const addonsAmountCents = await prisma.$transaction(async (tx) => {
    await tx.premiumMembershipAddon.update({
      where: { id: addon.id },
      data: { status: 'cancel_scheduled' },
    });
    return recomputeAddonsAmount(tx, membershipId);
  });

  return {
    addonKey,
    status: 'cancel_scheduled',
    addonsAmountCents,
    totalAmountCents: membership.baseAmountCents + addonsAmountCents,
  };
};
```

- [ ] **Step 4: Rodar o teste do serviço**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/addons-service.test.ts
```

Esperado: PASS, 9 testes.

- [ ] **Step 5: Reescrever o handler de attach do membro para chamar o serviço**

Em `apps/api/src/routes/me-premium-addons.ts`, substituir o corpo de `attachAddonHandler` a partir da linha que resolve o `module` (linha 198) até o `return reply.status(201)` inclusive, por:

```ts
try {
  const result = await attachAddon({
    membershipId: membership.id,
    addonKey,
    stripe: app.stripe,
    logger: request.log,
  });
  return reply.status(201).send(addonMutationResponseSchema.parse(result));
} catch (err) {
  if (isBillingActionError(err)) {
    // Mapeamento explicito para preservar EXATAMENTE os codigos e mensagens
    // que este endpoint ja retornava antes da extracao do servico. A suite
    // existente de me-premium-addons e a prova disso e nao deve ser editada.
    if (err.code === 'ModuleNotFound') {
      return reply.status(404).send({ error: 'NotFound', message: 'add-on module not found' });
    }
    if (err.code === 'AddonAlreadyAttached') {
      return reply.status(409).send({ error: 'AlreadyExists', message: 'add-on already attached' });
    }
  }
  throw err;
}
```

Manter intactos, acima disso: o gate de `GROWTH_PREMIUM_BILLING_ENABLED`, o `safeParse` com 422, a resolução da garagem com 404, e a resolução da assinatura viva com 409 `NoActiveMembership`. Esses três continuam sendo responsabilidade da rota.

Acrescentar os imports no topo do arquivo:

```ts
import { attachAddon, detachAddon } from '../services/billing/addons.js';
import { isBillingActionError } from '../services/billing/errors.js';
```

- [ ] **Step 6: Reescrever o handler de detach do membro**

Substituir, no handler de `DELETE /api/me/premium/addons/:addonKey`, o trecho da linha 353 (resolução do `addon`) até o `return reply.status(200)` inclusive, por:

```ts
try {
  const result = await detachAddon({
    membershipId: membership.id,
    addonKey,
    stripe: app.stripe,
    logger: request.log,
  });
  return reply.status(200).send(addonMutationResponseSchema.parse(result));
} catch (err) {
  if (isBillingActionError(err) && err.code === 'AddonNotAttached') {
    return reply.status(404).send({ error: 'NotFound', message: 'add-on not attached' });
  }
  throw err;
}
```

- [ ] **Step 7: Remover o que ficou morto na rota**

Apagar de `me-premium-addons.ts` a constante `ATTACHED_ADDON_STATUSES` **se** ela não for mais usada no arquivo (ela ainda é usada pelo `GET /api/me/premium/subscription`, então provavelmente fica). Verifique:

```bash
grep -n "ATTACHED_ADDON_STATUSES" apps/api/src/routes/me-premium-addons.ts
```

Se só aparecer na declaração, remova. Se aparecer no `GET`, mantenha.

- [ ] **Step 8: Rodar a suíte existente do endpoint do membro, sem editá-la**

```bash
pnpm --filter @ccc/api exec vitest run test/premium
```

Esperado: PASS, sem nenhuma alteração em arquivo de teste. Se algum teste desses falhar, a extração mudou comportamento: corrija o serviço ou o mapeamento de erro, nunca o teste.

Se os testes de `me-premium-addons` estiverem em outro diretório, localize-os antes:

```bash
grep -rl "me/premium/addons" apps/api/test
```

- [ ] **Step 9: Rodar a suíte completa da API**

```bash
pnpm --filter @ccc/api test
```

Esperado: PASS. Esta é a verificação de que a refatoração não vazou para nenhum outro fluxo.

- [ ] **Step 10: Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Esperado: zero erro.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/services/billing/addons.ts apps/api/src/routes/me-premium-addons.ts apps/api/test/billing/addons-service.test.ts
git commit -m "refactor(api): extrai attach e detach de modulo para servico compartilhado"
```

---

### Task 8: Resolver o item de plano e as ações de assinatura

**Files:**

- Create: `apps/api/src/services/billing/plan-item.ts`
- Create: `apps/api/src/services/billing/subscription-actions.ts`
- Test: `apps/api/test/billing/plan-item.test.ts`
- Test: `apps/api/test/billing/subscription-actions.test.ts`

**Interfaces:**

- Consumes: `BillingActionError` (Task 6); `updateSubscriptionItemPrice`, `resumeSubscriptionCancellation`, `pauseSubscriptionCollection`, `resumeSubscriptionCollection`, `retrieveSubscription`, `cancelSubscriptionAtPeriodEnd` do `StripeClient` (Task 3).
- Produces:

  ```ts
  // plan-item.ts
  resolvePlanSubscriptionItemId(input: { subscription: Stripe.Subscription; planPriceIds: ReadonlySet<string> }): string

  // subscription-actions.ts
  changePlan(input: { membershipId: string; tier: GaragePremiumTier; cadence: PremiumCadence; stripe: StripeClient }): Promise<void>
  scheduleCancel(input: { membershipId: string; stripe: StripeClient }): Promise<void>
  resumeCancel(input: { membershipId: string; stripe: StripeClient }): Promise<void>
  pauseCollection(input: { membershipId: string; stripe: StripeClient }): Promise<void>
  resumeCollection(input: { membershipId: string; stripe: StripeClient }): Promise<void>
  ```

  Nenhuma delas escreve em `PremiumMembership`.

- [ ] **Step 1: Escrever o teste do resolvedor de item de plano**

Criar `apps/api/test/billing/plan-item.test.ts`:

```ts
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { isBillingActionError } from '../../src/services/billing/errors.js';
import { resolvePlanSubscriptionItemId } from '../../src/services/billing/plan-item.js';

const sub = (items: Array<{ id: string; priceId: string }>): Stripe.Subscription =>
  ({
    id: 'sub_1',
    items: { data: items.map((i) => ({ id: i.id, price: { id: i.priceId } })) },
  }) as unknown as Stripe.Subscription;

const planPrices = new Set(['price_bronze', 'price_silver', 'price_gold']);

describe('resolvePlanSubscriptionItemId', () => {
  it('acha o item de plano quando ele e o unico', () => {
    expect(
      resolvePlanSubscriptionItemId({
        subscription: sub([{ id: 'si_1', priceId: 'price_gold' }]),
        planPriceIds: planPrices,
      }),
    ).toBe('si_1');
  });

  it('acha o item de plano mesmo quando modulos vem antes dele', () => {
    expect(
      resolvePlanSubscriptionItemId({
        subscription: sub([
          { id: 'si_addon_a', priceId: 'price_detailing' },
          { id: 'si_addon_b', priceId: 'price_oficina' },
          { id: 'si_plan', priceId: 'price_silver' },
        ]),
        planPriceIds: planPrices,
      }),
    ).toBe('si_plan');
  });

  it('lanca AmbiguousPlanItem quando nenhum item casa', () => {
    const err = (() => {
      try {
        resolvePlanSubscriptionItemId({
          subscription: sub([{ id: 'si_addon', priceId: 'price_detailing' }]),
          planPriceIds: planPrices,
        });
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(isBillingActionError(err) && err.code).toBe('AmbiguousPlanItem');
  });

  it('lanca AmbiguousPlanItem quando dois itens casam', () => {
    const err = (() => {
      try {
        resolvePlanSubscriptionItemId({
          subscription: sub([
            { id: 'si_a', priceId: 'price_gold' },
            { id: 'si_b', priceId: 'price_silver' },
          ]),
          planPriceIds: planPrices,
        });
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(isBillingActionError(err) && err.code).toBe('AmbiguousPlanItem');
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/plan-item.test.ts
```

Esperado: FAIL, módulo não resolve.

- [ ] **Step 3: Implementar o resolvedor**

Criar `apps/api/src/services/billing/plan-item.ts`:

```ts
import type Stripe from 'stripe';

import { BillingActionError } from './errors.js';

/**
 * Descobre qual SubscriptionItem da Stripe e o item de PLANO.
 *
 * Nao existe "o item do plano" por posicao. O comentario em services/stripe/index.ts
 * ja documenta que, com add-ons vinculados, a ordem dos itens nao e contratual.
 * A unica fonte confiavel e o catalogo: o item de plano e aquele cujo price.id
 * esta no conjunto de PremiumPlanPrice.stripePriceId.
 *
 * Zero ou mais de um casamento e ERRO, nao chute. Escolher o item errado trocaria
 * o preco de um modulo pelo preco de um plano, cobrando o membro errado e
 * corrompendo o snapshot. Falhar visivelmente e estritamente melhor.
 */
export const resolvePlanSubscriptionItemId = ({
  subscription,
  planPriceIds,
}: {
  subscription: Stripe.Subscription;
  planPriceIds: ReadonlySet<string>;
}): string => {
  const matches = subscription.items.data.filter((item) => planPriceIds.has(item.price.id));

  if (matches.length !== 1) {
    throw new BillingActionError(
      'AmbiguousPlanItem',
      `expected exactly one plan item on the subscription, found ${matches.length}`,
      {
        subscriptionId: subscription.id,
        matchCount: matches.length,
        itemPriceIds: subscription.items.data.map((i) => i.price.id),
      },
    );
  }

  return matches[0]!.id;
};
```

- [ ] **Step 4: Rodar o teste do resolvedor**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/plan-item.test.ts
```

Esperado: PASS, 4 testes.

- [ ] **Step 5: Escrever o teste das ações**

Criar `apps/api/test/billing/subscription-actions.test.ts`:

```ts
import { prisma } from '@ccc/db';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isBillingActionError } from '../../src/services/billing/errors.js';
import {
  changePlan,
  pauseCollection,
  resumeCancel,
  resumeCollection,
  scheduleCancel,
} from '../../src/services/billing/subscription-actions.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

async function seed() {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: 'sub_1',
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 149000,
      currency: 'BRL',
    },
  });

  const gold = await prisma.premiumPlan.create({
    data: { tier: 'gold', slug: 'fundador', name: 'Fundador', sortOrder: 2 },
  });
  const silver = await prisma.premiumPlan.create({
    data: { tier: 'silver', slug: 'estrada', name: 'Estrada', sortOrder: 1 },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: gold.id,
      cadence: 'monthly',
      baseAmountCents: 149000,
      currency: 'BRL',
      stripePriceId: 'price_gold',
    },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: silver.id,
      cadence: 'monthly',
      baseAmountCents: 89000,
      currency: 'BRL',
      stripePriceId: 'price_silver',
    },
  });

  return { membershipId: membership.id };
}

const fakeSubscription = (items: Array<{ id: string; priceId: string }>): Stripe.Subscription =>
  ({
    id: 'sub_1',
    items: { data: items.map((i) => ({ id: i.id, price: { id: i.priceId } })) },
  }) as unknown as Stripe.Subscription;

describe('changePlan', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('troca o preco do item de plano e nao escreve no banco', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    stripe.nextRetrievedSubscription = fakeSubscription([{ id: 'si_plan', priceId: 'price_gold' }]);

    await changePlan({ membershipId, tier: 'silver', cadence: 'monthly', stripe });

    expect(stripe.calls.at(-1)).toEqual({
      kind: 'updateSubscriptionItemPrice',
      payload: {
        subscriptionItemId: 'si_plan',
        priceId: 'price_silver',
        idempotencyKey: `plan_change_${membershipId}_silver_monthly`,
      },
    });

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.tier).toBe('gold');
    expect(membership.baseAmountCents).toBe(149000);
  });

  it('escolhe o item de plano certo quando ha dois modulos vinculados', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    stripe.nextRetrievedSubscription = fakeSubscription([
      { id: 'si_addon_a', priceId: 'price_detailing' },
      { id: 'si_plan', priceId: 'price_gold' },
      { id: 'si_addon_b', priceId: 'price_oficina' },
    ]);

    await changePlan({ membershipId, tier: 'silver', cadence: 'monthly', stripe });

    const call = stripe.calls.at(-1) as { payload: { subscriptionItemId: string } };
    expect(call.payload.subscriptionItemId).toBe('si_plan');
  });

  it('trocar para o plano atual lanca NoChange e nao chama a Stripe', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    const err = await changePlan({
      membershipId,
      tier: 'gold',
      cadence: 'monthly',
      stripe,
    }).catch((e: unknown) => e);

    expect(isBillingActionError(err) && err.code).toBe('NoChange');
    expect(stripe.calls).toEqual([]);
  });

  it('plano alvo sem stripePriceId lanca PlanPriceMissing e nao chama a Stripe', async () => {
    const { membershipId } = await seed();
    const bronze = await prisma.premiumPlan.create({
      data: { tier: 'bronze', slug: 'ingresso', name: 'Ingresso', sortOrder: 0 },
    });
    await prisma.premiumPlanPrice.create({
      data: {
        planId: bronze.id,
        cadence: 'monthly',
        baseAmountCents: 49000,
        currency: 'BRL',
        stripePriceId: null,
      },
    });
    const stripe = buildFakeStripe();

    const err = await changePlan({
      membershipId,
      tier: 'bronze',
      cadence: 'monthly',
      stripe,
    }).catch((e: unknown) => e);

    expect(isBillingActionError(err) && err.code).toBe('PlanPriceMissing');
    expect(stripe.calls).toEqual([]);
  });

  it('item de plano ambiguo lanca AmbiguousPlanItem e nao troca preco', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    stripe.nextRetrievedSubscription = fakeSubscription([
      { id: 'si_addon', priceId: 'price_detailing' },
    ]);

    const err = await changePlan({
      membershipId,
      tier: 'silver',
      cadence: 'monthly',
      stripe,
    }).catch((e: unknown) => e);

    expect(isBillingActionError(err) && err.code).toBe('AmbiguousPlanItem');
    expect(stripe.calls.map((c) => c.kind)).not.toContain('updateSubscriptionItemPrice');
  });

  it('assinatura inexistente lanca MembershipNotFound', async () => {
    const stripe = buildFakeStripe();
    const err = await changePlan({
      membershipId: 'mem_x',
      tier: 'silver',
      cadence: 'monthly',
      stripe,
    }).catch((e: unknown) => e);
    expect(isBillingActionError(err) && err.code).toBe('MembershipNotFound');
  });
});

describe('acoes de status', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('cada acao chama o metodo certo da Stripe com chave de idempotencia', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();

    await scheduleCancel({ membershipId, stripe });
    await resumeCancel({ membershipId, stripe });
    await pauseCollection({ membershipId, stripe });
    await resumeCollection({ membershipId, stripe });

    expect(stripe.calls).toEqual([
      {
        kind: 'cancelSubscriptionAtPeriodEnd',
        payload: { subscriptionId: 'sub_1', idempotencyKey: `sub_cancel_${membershipId}` },
      },
      {
        kind: 'resumeSubscriptionCancellation',
        payload: { subscriptionId: 'sub_1', idempotencyKey: `sub_resume_cancel_${membershipId}` },
      },
      {
        kind: 'pauseSubscriptionCollection',
        payload: { subscriptionId: 'sub_1', idempotencyKey: `sub_pause_${membershipId}` },
      },
      {
        kind: 'resumeSubscriptionCollection',
        payload: { subscriptionId: 'sub_1', idempotencyKey: `sub_resume_collect_${membershipId}` },
      },
    ]);
  });

  it('nenhuma acao de status escreve no banco', async () => {
    const { membershipId } = await seed();
    const stripe = buildFakeStripe();
    const before = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });

    await scheduleCancel({ membershipId, stripe });
    await pauseCollection({ membershipId, stripe });

    const after = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(after.status).toBe(before.status);
    expect(after.cancelAtPeriodEnd).toBe(before.cancelAtPeriodEnd);
  });
});
```

- [ ] **Step 6: Rodar para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/subscription-actions.test.ts
```

Esperado: FAIL, módulo `subscription-actions.js` não resolve.

- [ ] **Step 7: Implementar as ações**

Criar `apps/api/src/services/billing/subscription-actions.ts`:

```ts
import { prisma } from '@ccc/db';
import type { GaragePremiumTier, PremiumCadence, PremiumMembership } from '@prisma/client';

import type { StripeClient } from '../stripe/index.js';

import { BillingActionError } from './errors.js';
import { resolvePlanSubscriptionItemId } from './plan-item.js';

/**
 * Acoes de assinatura iniciadas pelo admin.
 *
 * INVARIANTE: nenhuma funcao deste arquivo escreve em PremiumMembership. Elas so
 * chamam a Stripe. Quem grava status, tier e valores e o webhook verificado, via
 * applyMembershipEvent. Por isso as respostas dessas acoes sao marcadas como
 * pending na camada HTTP.
 *
 * Nenhuma funcao daqui valida status nem provider. Isso e responsabilidade da
 * rota, porque a lista de status aceitos difere por acao.
 */

async function loadMembership(membershipId: string): Promise<PremiumMembership> {
  const membership = await prisma.premiumMembership.findUnique({ where: { id: membershipId } });
  if (!membership) {
    throw new BillingActionError('MembershipNotFound', 'membership not found', { membershipId });
  }
  return membership;
}

/**
 * Troca o plano da assinatura.
 *
 * Rateio em create_prorations, via updateSubscriptionItemPrice: a diferenca
 * proporcional entra como credito ou debito na fatura seguinte, nunca como
 * cobranca imediata fora do ciclo.
 */
export const changePlan = async ({
  membershipId,
  tier,
  cadence,
  stripe,
}: {
  membershipId: string;
  tier: GaragePremiumTier;
  cadence: PremiumCadence;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);

  if (membership.tier === tier && membership.cadence === cadence) {
    throw new BillingActionError('NoChange', 'subscription already on this plan and cadence', {
      tier,
      cadence,
    });
  }

  const targetPlan = await prisma.premiumPlan.findUnique({
    where: { tier },
    include: { prices: { where: { cadence } } },
  });
  const targetPriceId = targetPlan?.prices[0]?.stripePriceId ?? null;
  if (!targetPriceId) {
    throw new BillingActionError(
      'PlanPriceMissing',
      'target plan has no stripePriceId configured for this cadence',
      { tier, cadence },
    );
  }

  // Conjunto de TODOS os precos de plano do catalogo. Ler contra o catalogo e o
  // que permite distinguir o item de plano de um item de add-on.
  const allPlanPrices = await prisma.premiumPlanPrice.findMany({
    where: { stripePriceId: { not: null } },
    select: { stripePriceId: true },
  });
  const planPriceIds = new Set(
    allPlanPrices.map((p) => p.stripePriceId).filter((id): id is string => id !== null),
  );

  const subscription = await stripe.retrieveSubscription(membership.providerSubRef);
  const planItemId = resolvePlanSubscriptionItemId({ subscription, planPriceIds });

  await stripe.updateSubscriptionItemPrice({
    subscriptionItemId: planItemId,
    priceId: targetPriceId,
    idempotencyKey: `plan_change_${membershipId}_${tier}_${cadence}`,
  });
};

/** Agenda o cancelamento para o fim do periodo pago. Entitlement segue vivo. */
export const scheduleCancel = async ({
  membershipId,
  stripe,
}: {
  membershipId: string;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);
  await stripe.cancelSubscriptionAtPeriodEnd({
    subscriptionId: membership.providerSubRef,
    idempotencyKey: `sub_cancel_${membershipId}`,
  });
};

/** Desfaz um cancelamento agendado. */
export const resumeCancel = async ({
  membershipId,
  stripe,
}: {
  membershipId: string;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);
  await stripe.resumeSubscriptionCancellation({
    subscriptionId: membership.providerSubRef,
    idempotencyKey: `sub_resume_cancel_${membershipId}`,
  });
};

/** Suspende a cobranca sem cancelar. */
export const pauseCollection = async ({
  membershipId,
  stripe,
}: {
  membershipId: string;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);
  await stripe.pauseSubscriptionCollection({
    subscriptionId: membership.providerSubRef,
    idempotencyKey: `sub_pause_${membershipId}`,
  });
};

/** Retoma a cobranca de uma assinatura pausada. */
export const resumeCollection = async ({
  membershipId,
  stripe,
}: {
  membershipId: string;
  stripe: StripeClient;
}): Promise<void> => {
  const membership = await loadMembership(membershipId);
  await stripe.resumeSubscriptionCollection({
    subscriptionId: membership.providerSubRef,
    idempotencyKey: `sub_resume_collect_${membershipId}`,
  });
};
```

- [ ] **Step 8: Rodar o teste das ações**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/subscription-actions.test.ts
```

Esperado: PASS, 8 testes.

- [ ] **Step 9: Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Esperado: zero erro.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/services/billing apps/api/test/billing
git commit -m "feat(api): acoes de assinatura e resolucao do item de plano"
```

---

### Task 9: Endpoint de detalhe da assinatura

**Files:**

- Create: `apps/api/src/routes/admin/subscriptions.ts`
- Modify: `apps/api/src/routes/admin/index.ts:71` (registrar no escopo `organizer`/`admin`)
- Test: `apps/api/test/admin/subscriptions/detail.test.ts`

**Interfaces:**

- Consumes: `adminSubscriptionDetailSchema` (Task 2); colunas da Task 1.
- Produces: `export const adminSubscriptionRoutes: FastifyPluginAsync`, com `GET /admin/subscriptions/:id`. As tasks seguintes acrescentam mutações ao mesmo arquivo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/admin/subscriptions/detail.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { adminSubscriptionDetailSchema } from '@ccc/shared/admin-subscription';
import { loadEnv } from '../../../src/env.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

async function seedSubscription(provider: 'stripe' | 'apple_revenuecat' = 'stripe') {
  const { user: member } = await createUser({
    email: 'membro@example.com',
    name: 'Ana',
    verified: true,
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: member.id } });

  const plan = await prisma.premiumPlan.create({
    data: { tier: 'gold', slug: 'fundador', name: 'Fundador', sortOrder: 2 },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: plan.id,
      cadence: 'monthly',
      baseAmountCents: 149000,
      currency: 'BRL',
      stripePriceId: 'price_gold',
    },
  });
  await prisma.premiumAddonModule.create({
    data: {
      key: 'detailing',
      name: 'Detailing',
      description: '3 acessos',
      monthlyDeltaCents: 15000,
      payoutAmountCents: 9000,
      vendorName: 'Lava Rápido X',
      quotaPerCycle: 3,
      quotaUnit: 'access',
      currency: 'BRL',
      stripePriceId: 'price_detailing',
    },
  });

  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider,
      providerCustomerRef: 'cus_1',
      providerSubRef: 'sub_secreto_1',
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 149000,
      addonsAmountCents: 15000,
      currency: 'BRL',
      paymentBrand: 'visa',
      paymentLast4: '4242',
    },
  });

  const addon = await prisma.premiumMembershipAddon.create({
    data: {
      membershipId: membership.id,
      addonKey: 'detailing',
      status: 'active',
      providerItemRef: 'si_secreto_1',
      monthlyDeltaCents: 15000,
      payoutAmountCents: 9000,
      vendorName: 'Lava Rápido X',
      quotaPerCycle: 3,
      quotaUnit: 'access',
      currency: 'BRL',
    },
  });
  await prisma.premiumAddonUsage.create({
    data: {
      membershipAddonId: addon.id,
      cycleStart: PERIOD_START,
      cycleEnd: PERIOD_END,
      quotaTotal: 3,
      quotaUsed: 1,
    },
  });

  await prisma.premiumMembershipInvoice.create({
    data: {
      membershipId: membership.id,
      provider,
      providerInvoiceRef: 'in_1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 164000,
      addonsAmountCents: 15000,
      currency: 'BRL',
      paidAt: PERIOD_START,
      status: 'paid',
    },
  });

  return { membershipId: membership.id, memberId: member.id, garageId: garage.id };
}

describe('GET /admin/subscriptions/:id', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('401 sem token', async () => {
    const { membershipId } = await seedSubscription();
    const res = await app.inject({ method: 'GET', url: `/admin/subscriptions/${membershipId}` });
    expect(res.statusCode).toBe(401);
  });

  it('403 para role user', async () => {
    const { membershipId } = await seedSubscription();
    const { user: u } = await createUser({ email: 'u@example.com', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), u.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403 para role staff', async () => {
    const { membershipId } = await seedSubscription();
    const { user: u } = await createUser({ email: 's@example.com', role: 'staff', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), u.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('devolve o detalhe completo, validado pelo schema', async () => {
    const { membershipId, memberId, garageId } = await seedSubscription();
    const { user: admin } = await createUser({
      email: 'a@example.com',
      role: 'admin',
      verified: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    const body = adminSubscriptionDetailSchema.parse(res.json());

    expect(body.membershipId).toBe(membershipId);
    expect(body.userId).toBe(memberId);
    expect(body.userEmail).toBe('membro@example.com');
    expect(body.garageId).toBe(garageId);
    expect(body.planName).toBe('Fundador');
    expect(body.mutable).toBe(true);
    expect(body.paymentBrand).toBe('visa');
    expect(body.totalAmountCents).toBe(164000);

    expect(body.addons).toHaveLength(1);
    const addon = body.addons[0]!;
    expect(addon.vendorName).toBe('Lava Rápido X');
    expect(addon.payoutAmountCents).toBe(9000);
    expect(addon.marginCents).toBe(6000);
    expect(addon.billingIntegrated).toBe(true);
    expect(addon.currentCycle).toMatchObject({ quotaTotal: 3, quotaUsed: 1, quotaRemaining: 2 });

    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]?.grossAmountCents).toBe(164000);
  });

  it('nao vaza referencia de provider', async () => {
    const { membershipId } = await seedSubscription();
    const { user: admin } = await createUser({
      email: 'a2@example.com',
      role: 'admin',
      verified: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });

    expect(res.payload).not.toContain('sub_secreto_1');
    expect(res.payload).not.toContain('si_secreto_1');
    expect(res.payload).not.toContain('cus_1');
  });

  it('assinatura Apple vem com mutable falso', async () => {
    const { membershipId } = await seedSubscription('apple_revenuecat');
    const { user: admin } = await createUser({
      email: 'a3@example.com',
      role: 'admin',
      verified: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });

    expect(res.json()).toMatchObject({ mutable: false, provider: 'apple_revenuecat' });
  });

  it('404 para id inexistente', async () => {
    const { user: admin } = await createUser({
      email: 'a4@example.com',
      role: 'admin',
      verified: true,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/subscriptions/mem_inexistente',
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('leitura funciona com a flag de billing desligada', async () => {
    const { membershipId } = await seedSubscription();
    const { user: admin } = await createUser({
      email: 'a5@example.com',
      role: 'admin',
      verified: true,
    });
    const previous = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
    const flaggedApp = await makeApp();

    const res = await flaggedApp.inject({
      method: 'GET',
      url: `/admin/subscriptions/${membershipId}`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    await flaggedApp.close();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = previous;
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/subscriptions/detail.test.ts
```

Esperado: FAIL, 404 em todas as rotas porque elas ainda não existem.

- [ ] **Step 3: Criar o arquivo de rota com o GET**

Criar `apps/api/src/routes/admin/subscriptions.ts`:

```ts
/**
 * Controle administrativo de assinaturas.
 *
 *   GET    /admin/subscriptions/:id                    detalhe
 *   POST   /admin/subscriptions/:id/plan               troca de plano
 *   POST   /admin/subscriptions/:id/addons             vincula modulo
 *   DELETE /admin/subscriptions/:id/addons/:addonKey   desvincula modulo
 *   POST   /admin/subscriptions/:id/cancel             cancela ao fim do periodo
 *   POST   /admin/subscriptions/:id/resume             retoma cancelamento OU cobranca
 *   POST   /admin/subscriptions/:id/pause              pausa cobranca
 *
 * Modelo hibrido: as mutacoes chamam a Stripe e NAO escrevem status. Quem escreve
 * e o webhook verificado. Assinatura apple_revenuecat e somente leitura.
 *
 * A LISTA nao mora aqui: ela reusa GET /admin/finance/memberships.
 */

import { prisma } from '@ccc/db';
import { adminSubscriptionDetailSchema } from '@ccc/shared/admin-subscription';
import type { FastifyPluginAsync } from 'fastify';

export const adminSubscriptionRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /admin/subscriptions/:id
   *
   * Deliberadamente NAO gateado por GROWTH_PREMIUM_BILLING_ENABLED: o admin
   * precisa inspecionar assinaturas mesmo com a flag desligada. So as mutacoes
   * sao bloqueadas.
   */
  app.get('/subscriptions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const membership = await prisma.premiumMembership.findUnique({
      where: { id },
      include: {
        garage: {
          select: { id: true, slug: true, user: { select: { id: true, name: true, email: true } } },
        },
        addons: {
          orderBy: { createdAt: 'asc' },
          include: {
            module: { select: { name: true } },
            usage: { orderBy: { cycleStart: 'desc' }, take: 1 },
          },
        },
        invoices: { orderBy: { periodStart: 'desc' } },
      },
    });

    if (!membership) {
      return reply.status(404).send({ error: 'NotFound', message: 'subscription not found' });
    }

    const plan = await prisma.premiumPlan.findUnique({ where: { tier: membership.tier } });

    const totalAmountCents = membership.baseAmountCents + membership.addonsAmountCents;

    return reply.status(200).send(
      adminSubscriptionDetailSchema.parse({
        membershipId: membership.id,
        userId: membership.garage.user.id,
        userName: membership.garage.user.name ?? '',
        userEmail: membership.garage.user.email,
        garageId: membership.garage.id,
        garageSlug: membership.garage.slug ?? '',
        tier: membership.tier,
        planSlug: plan?.slug ?? null,
        planName: plan?.name ?? null,
        cadence: membership.cadence,
        status: membership.status,
        provider: membership.provider,
        currentPeriodStart: membership.currentPeriodStart.toISOString(),
        currentPeriodEnd: membership.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
        cancelledAt: membership.cancelledAt?.toISOString() ?? null,
        baseAmountCents: membership.baseAmountCents,
        addonsAmountCents: membership.addonsAmountCents,
        totalAmountCents,
        currency: membership.currency,
        paymentBrand: membership.paymentBrand,
        paymentLast4: membership.paymentLast4,
        // Apple e dona da assinatura: nossa API nao pode muta-la.
        mutable: membership.provider === 'stripe',
        addons: membership.addons.map((addon) => {
          const cycle = addon.usage[0] ?? null;
          return {
            key: addon.addonKey,
            name: addon.module.name,
            vendorName: addon.vendorName,
            status: addon.status,
            quotaUnit: addon.quotaUnit,
            quotaPerCycle: addon.quotaPerCycle,
            monthlyDeltaCents: addon.monthlyDeltaCents,
            payoutAmountCents: addon.payoutAmountCents,
            marginCents: addon.monthlyDeltaCents - addon.payoutAmountCents,
            // Falso = a Stripe nao esta cobrando por este modulo, apesar de ele
            // somar no total local. A UI avisa o admin.
            billingIntegrated: addon.providerItemRef !== null,
            currentCycle: cycle
              ? {
                  cycleStart: cycle.cycleStart.toISOString(),
                  cycleEnd: cycle.cycleEnd.toISOString(),
                  quotaTotal: cycle.quotaTotal,
                  quotaUsed: cycle.quotaUsed,
                  quotaRemaining: cycle.quotaTotal - cycle.quotaUsed,
                }
              : null,
          };
        }),
        invoices: membership.invoices.map((inv) => ({
          periodStart: inv.periodStart.toISOString(),
          periodEnd: inv.periodEnd.toISOString(),
          paidAt: inv.paidAt.toISOString(),
          grossAmountCents: inv.grossAmountCents,
          addonsAmountCents: inv.addonsAmountCents,
          currency: inv.currency,
          status: inv.status,
          refundedAt: inv.refundedAt?.toISOString() ?? null,
          refundedAmountCents: inv.refundedAmountCents,
        })),
      }),
    );
  });
};
```

- [ ] **Step 4: Registrar a rota**

Em `apps/api/src/routes/admin/index.ts`, acrescentar o import junto dos outros, em ordem alfabética:

```ts
import { adminSubscriptionRoutes } from './subscriptions.js';
```

E, dentro do escopo `requireRole('organizer', 'admin')`, depois de `adminPremiumCatalogRoutes` (linha 71):

```ts
await scope.register(adminSubscriptionRoutes);
```

- [ ] **Step 5: Rodar o teste**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/subscriptions/detail.test.ts
```

Esperado: PASS, 8 testes.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Esperado: zero erro.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin apps/api/test/admin/subscriptions
git commit -m "feat(api): endpoint admin de detalhe de assinatura"
```

---

### Task 10: Mutações administrativas

**Files:**

- Modify: `apps/api/src/routes/admin/subscriptions.ts` (acrescentar seis rotas)
- Test: `apps/api/test/admin/subscriptions/mutations.test.ts`

**Interfaces:**

- Consumes: `attachAddon`, `detachAddon` (Task 7); `changePlan`, `scheduleCancel`, `resumeCancel`, `pauseCollection`, `resumeCollection` (Task 8); `BillingActionError` (Task 6); schemas de request e response (Task 2); ações de auditoria (Task 2).
- Produces: as seis rotas de mutação. Nada consome isso na API; o consumidor é `apps/admin`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/admin/subscriptions/mutations.test.ts`. Reaproveite o helper `seedSubscription` de `detail.test.ts` extraindo-o para `apps/api/test/admin/subscriptions/seed.ts` e importando nos dois arquivos — não duplique o seed.

```ts
import { prisma } from '@ccc/db';
import { loadEnv } from '../../../src/env.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../../helpers.js';

import { seedSubscription } from './seed.js';

type App = Awaited<ReturnType<typeof makeAppWithFakeStripe>>;

const adminAuth = async (id = 'a@example.com') => {
  const { user: admin } = await createUser({ email: id, role: 'admin', verified: true });
  return bearer(loadEnv(), admin.id, 'admin');
};

const planItemSubscription = {
  id: 'sub_secreto_1',
  items: { data: [{ id: 'si_plan', price: { id: 'price_gold' } }] },
};

describe('mutacoes admin de assinatura', () => {
  let ctx: App;

  beforeEach(async () => {
    await resetDatabase();
    ctx = await makeAppWithFakeStripe();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('403 para staff em toda mutacao', async () => {
    const { membershipId } = await seedSubscription();
    const { user: staff } = await createUser({
      email: 's@example.com',
      role: 'staff',
      verified: true,
    });
    const auth = bearer(loadEnv(), staff.id, 'staff');

    for (const [method, url] of [
      ['POST', `/admin/subscriptions/${membershipId}/plan`],
      ['POST', `/admin/subscriptions/${membershipId}/addons`],
      ['POST', `/admin/subscriptions/${membershipId}/cancel`],
      ['POST', `/admin/subscriptions/${membershipId}/resume`],
      ['POST', `/admin/subscriptions/${membershipId}/pause`],
    ] as const) {
      const res = await ctx.app.inject({
        method,
        url,
        headers: { authorization: auth },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('troca de plano responde pending e grava auditoria', async () => {
    const { membershipId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription as never;
    const auth = await adminAuth();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/plan`,
      headers: { authorization: auth },
      payload: { tier: 'silver', cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, pending: true });

    const audit = await prisma.adminAudit.findMany({
      where: { entityType: 'premium_membership', entityId: membershipId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('premium.subscription.plan_changed');
  });

  it('vinculo de modulo responde pending falso com os totais', async () => {
    const { membershipId } = await seedSubscription({ withAddon: false });
    const auth = await adminAuth('b@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/addons`,
      headers: { authorization: auth },
      payload: { addonKey: 'detailing' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ok: true,
      pending: false,
      addonKey: 'detailing',
      status: 'active',
      addonsAmountCents: 15000,
    });

    const audit = await prisma.adminAudit.findFirstOrThrow({
      where: { entityType: 'premium_membership', entityId: membershipId },
    });
    expect(audit.action).toBe('premium.subscription.addon_attached');
  });

  it('desvinculo de modulo marca cancel_scheduled e audita', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('c@example.com');

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/admin/subscriptions/${membershipId}/addons/detailing`,
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pending: false, status: 'cancel_scheduled' });

    const audit = await prisma.adminAudit.findFirstOrThrow({
      where: { entityType: 'premium_membership', entityId: membershipId },
    });
    expect(audit.action).toBe('premium.subscription.addon_detached');
  });

  it('cancelar e pausar chamam a Stripe e nao escrevem status', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('d@example.com');

    await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/cancel`,
      headers: { authorization: auth },
      payload: {},
    });

    const after = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(after.status).toBe('active');
    expect(ctx.stripe.calls.map((c) => c.kind)).toContain('cancelSubscriptionAtPeriodEnd');
  });

  it('resume encaminha para retomada de cancelamento quando cancel_scheduled', async () => {
    const { membershipId } = await seedSubscription({ status: 'cancel_scheduled' });
    const auth = await adminAuth('e@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/resume`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(ctx.stripe.calls.map((c) => c.kind)).toContain('resumeSubscriptionCancellation');
  });

  it('resume encaminha para retomada de cobranca quando paused', async () => {
    const { membershipId } = await seedSubscription({ status: 'paused' });
    const auth = await adminAuth('f@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/resume`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(ctx.stripe.calls.map((c) => c.kind)).toContain('resumeSubscriptionCollection');
  });

  it('resume com assinatura active da 409 InvalidStatus', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('g@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/resume`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'InvalidStatus' });
    expect(ctx.stripe.calls).toEqual([]);
  });

  it('assinatura expirada da 409 InvalidStatus em toda mutacao', async () => {
    const { membershipId } = await seedSubscription({ status: 'expired' });
    const auth = await adminAuth('h@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/plan`,
      headers: { authorization: auth },
      payload: { tier: 'silver', cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'InvalidStatus' });
  });

  it('assinatura Apple da 409 ProviderNotMutable', async () => {
    const { membershipId } = await seedSubscription({ provider: 'apple_revenuecat' });
    const auth = await adminAuth('i@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/cancel`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'ProviderNotMutable' });
    expect(ctx.stripe.calls).toEqual([]);
  });

  it('gate de status vem antes do gate de provider', async () => {
    const { membershipId } = await seedSubscription({
      provider: 'apple_revenuecat',
      status: 'expired',
    });
    const auth = await adminAuth('j@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/cancel`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.json()).toMatchObject({ error: 'InvalidStatus' });
  });

  it('mutacao com a flag de billing desligada da 503', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('k@example.com');
    const previous = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
    const flagged = await makeAppWithFakeStripe();

    const res = await flagged.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/cancel`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(503);
    await flagged.app.close();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = previous;
  });

  it('troca para o plano atual da 409 NoChange', async () => {
    const { membershipId } = await seedSubscription();
    const auth = await adminAuth('l@example.com');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/plan`,
      headers: { authorization: auth },
      payload: { tier: 'gold', cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'NoChange' });
  });

  it('rateio create_prorations chega na Stripe', async () => {
    const { membershipId } = await seedSubscription();
    ctx.stripe.nextRetrievedSubscription = planItemSubscription as never;
    const auth = await adminAuth('m@example.com');

    await ctx.app.inject({
      method: 'POST',
      url: `/admin/subscriptions/${membershipId}/plan`,
      headers: { authorization: auth },
      payload: { tier: 'silver', cadence: 'monthly' },
    });

    const call = ctx.stripe.calls.find((c) => c.kind === 'updateSubscriptionItemPrice');
    expect(call?.payload).toMatchObject({ subscriptionItemId: 'si_plan', priceId: 'price_silver' });
  });
});
```

`seedSubscription` precisa aceitar `{ provider?, status?, withAddon? }` com defaults `'stripe'`, `'active'` e `true`. Ao extrair para `seed.ts`, adicione esses parâmetros e ajuste `detail.test.ts` para importar de lá.

O `create_prorations` em si é assertado no teste de unidade da Task 3, no `updateSubscriptionItemPrice` real. Aqui a asserção é de que o item e o preço certos chegam.

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/subscriptions/mutations.test.ts
```

Esperado: FAIL, 404 nas rotas de mutação.

- [ ] **Step 3: Acrescentar os guards e o mapeamento de erro**

Em `apps/api/src/routes/admin/subscriptions.ts`, depois do handler `GET` e ainda dentro de `adminSubscriptionRoutes`, inserir:

```ts
type MembershipStatus = Awaited<
  ReturnType<typeof prisma.premiumMembership.findUniqueOrThrow>
>['status'];

/**
 * Status aceitos POR ACAO. Nao existe um conceito unico de "assinatura viva"
 * que sirva para todas: resume precisa aceitar `paused`, que nao esta na lista
 * LIVE_STATUSES usada pela superficie do membro.
 */
const ALLOWED_STATUS: Record<string, ReadonlyArray<MembershipStatus>> = {
  plan: ['active', 'past_due', 'cancel_scheduled'],
  addon: ['active', 'past_due', 'cancel_scheduled'],
  cancel: ['active', 'past_due', 'trialing'],
  resume: ['cancel_scheduled', 'paused'],
  pause: ['active', 'past_due', 'trialing'],
};

/**
 * Ordem de avaliacao: existencia, flag, status, provider.
 *
 * Status antes de provider de proposito: o admin recebe o motivo mais
 * especifico. Uma assinatura Apple expirada acusa o status, nao o provider.
 */
const loadMutable = async (
  id: string,
  action: keyof typeof ALLOWED_STATUS,
  reply: FastifyReply,
) => {
  const membership = await prisma.premiumMembership.findUnique({ where: { id } });
  if (!membership) {
    void reply.status(404).send({ error: 'NotFound', message: 'subscription not found' });
    return null;
  }
  if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
    void reply
      .status(503)
      .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
    return null;
  }
  if (!ALLOWED_STATUS[action]!.includes(membership.status)) {
    void reply.status(409).send({
      error: 'InvalidStatus',
      message: `action not allowed while subscription is ${membership.status}`,
      status: membership.status,
    });
    return null;
  }
  if (membership.provider !== 'stripe') {
    void reply.status(409).send({
      error: 'ProviderNotMutable',
      message: 'subscription is managed by the App Store and cannot be changed here',
    });
    return null;
  }
  return membership;
};

/** Traduz BillingActionError para o corpo de resposta desta superficie. */
const sendBillingError = (err: unknown, reply: FastifyReply): boolean => {
  if (!isBillingActionError(err)) return false;
  const errorName =
    err.code === 'MembershipNotFound' || err.code === 'ModuleNotFound' ? 'NotFound' : err.code;
  void reply.status(err.httpStatus).send({ error: errorName, message: err.message });
  return true;
};
```

Acrescentar aos imports do arquivo:

```ts
import {
  adminSubscriptionActionResponseSchema,
  adminSubscriptionAddonAttachSchema,
  adminSubscriptionAddonMutationResponseSchema,
  adminSubscriptionChangePlanSchema,
  adminSubscriptionDetailSchema,
} from '@ccc/shared/admin-subscription';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import { recordAudit } from '../../services/admin-audit.js';
import { attachAddon, detachAddon } from '../../services/billing/addons.js';
import { isBillingActionError } from '../../services/billing/errors.js';
import {
  changePlan,
  pauseCollection,
  resumeCancel,
  resumeCollection,
  scheduleCancel,
} from '../../services/billing/subscription-actions.js';
import { requireUser } from '../../plugins/auth.js';
```

- [ ] **Step 4: Implementar a troca de plano**

Ainda em `adminSubscriptionRoutes`:

```ts
app.post('/subscriptions/:id/plan', async (request, reply) => {
  const { id } = request.params as { id: string };
  const membership = await loadMutable(id, 'plan', reply);
  if (!membership) return reply;

  const parsed = adminSubscriptionChangePlanSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(422).send({
      error: 'UnprocessableEntity',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }

  try {
    await changePlan({
      membershipId: id,
      tier: parsed.data.tier,
      cadence: parsed.data.cadence,
      stripe: app.stripe,
    });
  } catch (err) {
    if (sendBillingError(err, reply)) return reply;
    throw err;
  }

  const { sub } = requireUser(request);
  await recordAudit({
    actorId: sub,
    action: 'premium.subscription.plan_changed',
    entityType: 'premium_membership',
    entityId: id,
    metadata: {
      fromTier: membership.tier,
      fromCadence: membership.cadence,
      toTier: parsed.data.tier,
      toCadence: parsed.data.cadence,
    },
  });

  return reply
    .status(200)
    .send(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true }));
});
```

- [ ] **Step 5: Implementar vincular e desvincular módulo**

```ts
app.post('/subscriptions/:id/addons', async (request, reply) => {
  const { id } = request.params as { id: string };
  const membership = await loadMutable(id, 'addon', reply);
  if (!membership) return reply;

  const parsed = adminSubscriptionAddonAttachSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(422).send({
      error: 'UnprocessableEntity',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }

  let result;
  try {
    result = await attachAddon({
      membershipId: id,
      addonKey: parsed.data.addonKey,
      stripe: app.stripe,
      logger: request.log,
    });
  } catch (err) {
    if (sendBillingError(err, reply)) return reply;
    throw err;
  }

  const { sub } = requireUser(request);
  await recordAudit({
    actorId: sub,
    action: 'premium.subscription.addon_attached',
    entityType: 'premium_membership',
    entityId: id,
    metadata: { addonKey: parsed.data.addonKey, addonsAmountCents: result.addonsAmountCents },
  });

  // pending false: attach grava no banco na hora, depois da chamada a Stripe.
  return reply
    .status(201)
    .send(
      adminSubscriptionAddonMutationResponseSchema.parse({ ok: true, pending: false, ...result }),
    );
});

app.delete('/subscriptions/:id/addons/:addonKey', async (request, reply) => {
  const { id, addonKey } = request.params as { id: string; addonKey: string };
  const membership = await loadMutable(id, 'addon', reply);
  if (!membership) return reply;

  let result;
  try {
    result = await detachAddon({
      membershipId: id,
      addonKey,
      stripe: app.stripe,
      logger: request.log,
    });
  } catch (err) {
    if (sendBillingError(err, reply)) return reply;
    throw err;
  }

  const { sub } = requireUser(request);
  await recordAudit({
    actorId: sub,
    action: 'premium.subscription.addon_detached',
    entityType: 'premium_membership',
    entityId: id,
    metadata: { addonKey, addonsAmountCents: result.addonsAmountCents },
  });

  return reply
    .status(200)
    .send(
      adminSubscriptionAddonMutationResponseSchema.parse({ ok: true, pending: false, ...result }),
    );
});
```

- [ ] **Step 6: Implementar cancelar, retomar e pausar**

```ts
app.post('/subscriptions/:id/cancel', async (request, reply) => {
  const { id } = request.params as { id: string };
  const membership = await loadMutable(id, 'cancel', reply);
  if (!membership) return reply;

  try {
    await scheduleCancel({ membershipId: id, stripe: app.stripe });
  } catch (err) {
    if (sendBillingError(err, reply)) return reply;
    throw err;
  }

  const { sub } = requireUser(request);
  await recordAudit({
    actorId: sub,
    action: 'premium.subscription.cancel_scheduled',
    entityType: 'premium_membership',
    entityId: id,
    metadata: { fromStatus: membership.status },
  });

  return reply
    .status(200)
    .send(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true }));
});

/**
 * Um unico botao na interface. O backend decide pelo estado atual: retomar um
 * cancelamento agendado e retomar uma cobranca pausada sao acoes diferentes na
 * Stripe, mas a mesma intencao para quem opera.
 */
app.post('/subscriptions/:id/resume', async (request, reply) => {
  const { id } = request.params as { id: string };
  const membership = await loadMutable(id, 'resume', reply);
  if (!membership) return reply;

  try {
    if (membership.status === 'cancel_scheduled') {
      await resumeCancel({ membershipId: id, stripe: app.stripe });
    } else {
      await resumeCollection({ membershipId: id, stripe: app.stripe });
    }
  } catch (err) {
    if (sendBillingError(err, reply)) return reply;
    throw err;
  }

  const { sub } = requireUser(request);
  await recordAudit({
    actorId: sub,
    action: 'premium.subscription.resumed',
    entityType: 'premium_membership',
    entityId: id,
    metadata: { fromStatus: membership.status },
  });

  return reply
    .status(200)
    .send(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true }));
});

app.post('/subscriptions/:id/pause', async (request, reply) => {
  const { id } = request.params as { id: string };
  const membership = await loadMutable(id, 'pause', reply);
  if (!membership) return reply;

  try {
    await pauseCollection({ membershipId: id, stripe: app.stripe });
  } catch (err) {
    if (sendBillingError(err, reply)) return reply;
    throw err;
  }

  const { sub } = requireUser(request);
  await recordAudit({
    actorId: sub,
    action: 'premium.subscription.paused',
    entityType: 'premium_membership',
    entityId: id,
    metadata: { fromStatus: membership.status },
  });

  return reply
    .status(200)
    .send(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true }));
});
```

- [ ] **Step 7: Rodar o teste**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/subscriptions
```

Esperado: PASS, todos os casos de `detail.test.ts` e `mutations.test.ts`.

- [ ] **Step 8: Rodar a suíte completa da API**

```bash
pnpm --filter @ccc/api test
```

Esperado: PASS.

- [ ] **Step 9: Typecheck e lint**

```bash
pnpm --filter @ccc/api typecheck && pnpm --filter @ccc/api lint
```

Esperado: zero erro.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/routes/admin/subscriptions.ts apps/api/test/admin/subscriptions
git commit -m "feat(api): mutacoes admin de plano, modulos e status de assinatura"
```

---

### Task 11: Filtros de módulo e fornecedor na lista

**Files:**

- Modify: `apps/api/src/routes/admin/finance.ts` (`RawMembershipRow` linhas 344-361, `MembershipListItem` 363-376, `findMembershipRows` 378-458, `rowToListItem` 460-478)
- Test: `apps/api/test/admin/finance/memberships-filters.test.ts`

**Interfaces:**

- Consumes: `addonKey` e `vendorName` na query, campos novos no item (Task 2).
- Produces: `GET /admin/finance/memberships` aceitando `addonKey` e `vendorName`, e devolvendo `userId`, `userEmail`, `baseAmountCents`, `addonsAmountCents`, `paymentBrand`, `paymentLast4`, `addonKeys`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/admin/finance/memberships-filters.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { adminFinanceMembershipsResponseSchema } from '@ccc/shared/admin';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

const MODULES = [
  { key: 'detailing', name: 'Detailing', vendorName: 'Lava Rápido X', cents: 15000 },
  { key: 'oficina', name: 'Oficina', vendorName: 'Oficina Y', cents: 50000 },
] as const;

async function createSubscription(opts: {
  email: string;
  addonKey?: 'detailing' | 'oficina';
}): Promise<string> {
  const { user } = await createUser({ email: opts.email, name: opts.email, verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const mod = MODULES.find((m) => m.key === opts.addonKey);

  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: `cus_${opts.email}`,
      providerSubRef: `sub_${opts.email}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 149000,
      addonsAmountCents: mod?.cents ?? 0,
      currency: 'BRL',
    },
  });

  if (mod) {
    await prisma.premiumMembershipAddon.create({
      data: {
        membershipId: membership.id,
        addonKey: mod.key,
        status: 'active',
        monthlyDeltaCents: mod.cents,
        payoutAmountCents: Math.floor(mod.cents * 0.6),
        vendorName: mod.vendorName,
        quotaPerCycle: 3,
        quotaUnit: 'access',
        currency: 'BRL',
      },
    });
  }

  return membership.id;
}

describe('GET /admin/finance/memberships: filtros de modulo e fornecedor', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  let auth: string;
  let comDetailing: string;
  let comOficina: string;
  let semModulo: string;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();

    for (const m of MODULES) {
      await prisma.premiumAddonModule.create({
        data: {
          key: m.key,
          name: m.name,
          description: m.name,
          monthlyDeltaCents: m.cents,
          payoutAmountCents: Math.floor(m.cents * 0.6),
          vendorName: m.vendorName,
          quotaPerCycle: 3,
          quotaUnit: 'access',
          currency: 'BRL',
        },
      });
    }

    comDetailing = await createSubscription({ email: 'd@example.com', addonKey: 'detailing' });
    comOficina = await createSubscription({ email: 'o@example.com', addonKey: 'oficina' });
    semModulo = await createSubscription({ email: 'n@example.com' });

    const { user: admin } = await createUser({
      email: 'admin@example.com',
      role: 'admin',
      verified: true,
    });
    auth = bearer(loadEnv(), admin.id, 'admin');
  });

  afterEach(async () => {
    await app.close();
  });

  const list = async (qs: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/finance/memberships${qs}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    return adminFinanceMembershipsResponseSchema.parse(res.json());
  };

  it('addonKey retorna so quem tem o modulo vinculado', async () => {
    const body = await list('?addonKey=detailing');
    expect(body.items.map((i) => i.membershipId)).toEqual([comDetailing]);
    expect(body.total).toBe(1);
  });

  it('addonKey ignora vinculo cancelled', async () => {
    await prisma.premiumMembershipAddon.updateMany({
      where: { membershipId: comDetailing },
      data: { status: 'cancelled' },
    });
    const body = await list('?addonKey=detailing');
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('addonKey inclui vinculo cancel_scheduled', async () => {
    await prisma.premiumMembershipAddon.updateMany({
      where: { membershipId: comDetailing },
      data: { status: 'cancel_scheduled' },
    });
    const body = await list('?addonKey=detailing');
    expect(body.items.map((i) => i.membershipId)).toEqual([comDetailing]);
  });

  it('vendorName retorna quem tem qualquer modulo daquele fornecedor', async () => {
    const body = await list(`?vendorName=${encodeURIComponent('Oficina Y')}`);
    expect(body.items.map((i) => i.membershipId)).toEqual([comOficina]);
  });

  it('addonKey e vendorName combinados aplicam as duas restricoes', async () => {
    const body = await list(`?addonKey=detailing&vendorName=${encodeURIComponent('Oficina Y')}`);
    expect(body.items).toEqual([]);
  });

  it('from e to continuam filtrando currentPeriodEnd', async () => {
    const dentro = await list('?from=2026-08-25&to=2026-09-05');
    expect(dentro.total).toBe(3);

    const fora = await list('?from=2026-10-01&to=2026-10-31');
    expect(fora.total).toBe(0);
  });

  it('a resposta traz os campos novos', async () => {
    const body = await list('');

    const comMod = body.items.find((i) => i.membershipId === comDetailing);
    expect(comMod).toMatchObject({
      userEmail: 'd@example.com',
      baseAmountCents: 149000,
      addonsAmountCents: 15000,
      addonKeys: ['detailing'],
    });
    expect(comMod?.userId).toBeTruthy();

    const sem = body.items.find((i) => i.membershipId === semModulo);
    expect(sem?.addonKeys).toEqual([]);
    expect(sem?.addonsAmountCents).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/finance/memberships-filters.test.ts
```

Esperado: FAIL. Os filtros são ignorados e os campos novos não existem na resposta.

- [ ] **Step 3: Acrescentar o filtro de módulo e fornecedor**

Em `apps/api/src/routes/admin/finance.ts`, dentro de `findMembershipRows`, depois do bloco `if (query.garageId) where.garageId = query.garageId;`:

```ts
// Filtros de modulo. Ambos casam contra vinculos que ainda contam como ativos:
// `cancelled` fica de fora porque o membro ja nao tem o modulo.
if (query.addonKey || query.vendorName) {
  const addonFilter: Prisma.PremiumMembershipAddonWhereInput = {
    status: { in: ['active', 'cancel_scheduled'] },
  };
  // Casamento exato em vendorName, nao contains: a origem dos valores e o
  // proprio catalogo, nao texto livre digitado pelo admin.
  if (query.addonKey) addonFilter.addonKey = query.addonKey;
  if (query.vendorName) addonFilter.vendorName = query.vendorName;
  where.addons = { some: addonFilter };
}
```

- [ ] **Step 4: Selecionar os campos novos**

No `prisma.premiumMembership.findMany` de `findMembershipRows`, acrescentar ao `select`:

```ts
        baseAmountCents: true,
        addonsAmountCents: true,
        paymentBrand: true,
        paymentLast4: true,
        addons: {
          where: { status: { in: ['active', 'cancel_scheduled'] } },
          select: { addonKey: true },
        },
```

E no `garage.select.user.select`, acrescentar `id: true` junto de `name` e `email`.

- [ ] **Step 5: Estender os tipos de linha**

Em `RawMembershipRow`, acrescentar:

```ts
  userId: string;
  userEmail: string;
  baseAmountCents: number;
  addonsAmountCents: number;
  paymentBrand: string | null;
  paymentLast4: string | null;
  addonKeys: string[];
```

Em `MembershipListItem`, acrescentar os mesmos sete campos.

- [ ] **Step 6: Preencher no mapeamento**

No `const rows: RawMembershipRow[] = memberships.map((m) => ({ ... }))`, acrescentar:

```ts
    userId: m.garage.user.id,
    userEmail: m.garage.user.email,
    baseAmountCents: m.baseAmountCents,
    addonsAmountCents: m.addonsAmountCents,
    paymentBrand: m.paymentBrand,
    paymentLast4: m.paymentLast4,
    addonKeys: m.addons.map((a) => a.addonKey),
```

Em `rowToListItem`, no objeto retornado, acrescentar:

```ts
    userId: row.userId,
    userEmail: row.userEmail,
    baseAmountCents: row.baseAmountCents,
    addonsAmountCents: row.addonsAmountCents,
    paymentBrand: row.paymentBrand,
    paymentLast4: row.paymentLast4,
    addonKeys: row.addonKeys,
```

- [ ] **Step 7: Rodar o teste**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/finance
```

Esperado: PASS. Se algum teste antigo de finance quebrar por causa dos campos novos, é porque ele assertava igualdade estrita do objeto: troque por `toMatchObject`, não remova a asserção.

- [ ] **Step 8: Suíte completa e typecheck**

```bash
pnpm --filter @ccc/api test && pnpm --filter @ccc/api typecheck
```

Esperado: PASS e zero erro.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/admin/finance.ts apps/api/test/admin/finance
git commit -m "feat(api): filtro por modulo e fornecedor na lista de assinaturas"
```

---

### Task 12: Camada de acesso do admin

**Files:**

- Modify: `apps/admin/src/lib/admin-api.ts` (`getFinanceMemberships` linhas 498-516, funções novas depois dela)
- Create: `apps/admin/src/lib/assinaturas-actions.ts`

**Interfaces:**

- Consumes: schemas da Task 2; endpoints das Tasks 9, 10 e 11.
- Produces, em `admin-api.ts`:

  ```ts
  getAdminSubscription(id: string): Promise<AdminSubscriptionDetail>
  changeAdminSubscriptionPlan(id: string, input: AdminSubscriptionChangePlan): Promise<AdminSubscriptionActionResponse>
  attachAdminSubscriptionAddon(id: string, input: AdminSubscriptionAddonAttach): Promise<AdminSubscriptionAddonMutationResponse>
  detachAdminSubscriptionAddon(id: string, addonKey: string): Promise<AdminSubscriptionAddonMutationResponse>
  cancelAdminSubscription(id: string): Promise<AdminSubscriptionActionResponse>
  resumeAdminSubscription(id: string): Promise<AdminSubscriptionActionResponse>
  pauseAdminSubscription(id: string): Promise<AdminSubscriptionActionResponse>
  ```

  Em `assinaturas-actions.ts`, todas `'use server'`:

  ```ts
  type AssinaturaActionResult = { ok: true; pending: boolean } | { ok: false; error: string }
  fetchAdminSubscription(id: string): Promise<AdminSubscriptionDetail>
  changePlanAction(id: string, tier: string, cadence: string): Promise<AssinaturaActionResult>
  attachAddonAction(id: string, addonKey: string): Promise<AssinaturaActionResult>
  detachAddonAction(id: string, addonKey: string): Promise<AssinaturaActionResult>
  cancelSubscriptionAction(id: string): Promise<AssinaturaActionResult>
  resumeSubscriptionAction(id: string): Promise<AssinaturaActionResult>
  pauseSubscriptionAction(id: string): Promise<AssinaturaActionResult>
  ```

- [ ] **Step 1: Acrescentar `addonKey` e `vendorName` ao `getFinanceMemberships`**

Em `apps/admin/src/lib/admin-api.ts`, dentro de `getFinanceMemberships`, depois de `if (q?.garageId) params.set('garageId', q.garageId);`:

```ts
if (q?.addonKey) params.set('addonKey', q.addonKey);
if (q?.vendorName) params.set('vendorName', q.vendorName);
```

- [ ] **Step 2: Acrescentar as funções de assinatura**

Em `apps/admin/src/lib/admin-api.ts`, logo depois de `getFinanceMemberships`:

```ts
// ── Admin assinaturas ─────────────────────────────────────────────────

export const getAdminSubscription = (id: string) =>
  apiFetch(`/admin/subscriptions/${id}`, { schema: adminSubscriptionDetailSchema });

export const changeAdminSubscriptionPlan = (id: string, input: AdminSubscriptionChangePlan) =>
  apiFetch(`/admin/subscriptions/${id}/plan`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminSubscriptionActionResponseSchema,
  });

export const attachAdminSubscriptionAddon = (id: string, input: AdminSubscriptionAddonAttach) =>
  apiFetch(`/admin/subscriptions/${id}/addons`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminSubscriptionAddonMutationResponseSchema,
  });

export const detachAdminSubscriptionAddon = (id: string, addonKey: string) =>
  apiFetch(`/admin/subscriptions/${id}/addons/${encodeURIComponent(addonKey)}`, {
    method: 'DELETE',
    schema: adminSubscriptionAddonMutationResponseSchema,
  });

export const cancelAdminSubscription = (id: string) =>
  apiFetch(`/admin/subscriptions/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
    schema: adminSubscriptionActionResponseSchema,
  });

export const resumeAdminSubscription = (id: string) =>
  apiFetch(`/admin/subscriptions/${id}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
    schema: adminSubscriptionActionResponseSchema,
  });

export const pauseAdminSubscription = (id: string) =>
  apiFetch(`/admin/subscriptions/${id}/pause`, {
    method: 'POST',
    body: JSON.stringify({}),
    schema: adminSubscriptionActionResponseSchema,
  });
```

Acrescentar aos imports do arquivo:

```ts
import {
  adminSubscriptionActionResponseSchema,
  adminSubscriptionAddonMutationResponseSchema,
  adminSubscriptionDetailSchema,
  type AdminSubscriptionAddonAttach,
  type AdminSubscriptionChangePlan,
} from '@ccc/shared/admin-subscription';
```

- [ ] **Step 3: Criar as server actions**

Criar `apps/admin/src/lib/assinaturas-actions.ts`:

```ts
'use server';

import type { AdminSubscriptionDetail } from '@ccc/shared/admin-subscription';

import {
  attachAdminSubscriptionAddon,
  cancelAdminSubscription,
  changeAdminSubscriptionPlan,
  detachAdminSubscriptionAddon,
  getAdminSubscription,
  pauseAdminSubscription,
  resumeAdminSubscription,
} from './admin-api';
import { ApiError } from './api';

/**
 * pending diz se o valor novo ja esta no banco.
 *
 * false: vinculo e desvinculo de modulo, que gravam na hora.
 * true: troca de plano, cancelar, retomar e pausar, que so chamam a Stripe. O
 * banco so muda quando o webhook chegar, entao a tela nao pode antecipar.
 */
export type AssinaturaActionResult = { ok: true; pending: boolean } | { ok: false; error: string };

export async function fetchAdminSubscription(id: string): Promise<AdminSubscriptionDetail> {
  return getAdminSubscription(id);
}

const run = async (fn: () => Promise<{ pending: boolean }>): Promise<AssinaturaActionResult> => {
  try {
    const res = await fn();
    return { ok: true, pending: res.pending };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};

export async function changePlanAction(
  id: string,
  tier: 'bronze' | 'silver' | 'gold',
  cadence: 'monthly' | 'annual',
): Promise<AssinaturaActionResult> {
  return run(() => changeAdminSubscriptionPlan(id, { tier, cadence }));
}

export async function attachAddonAction(
  id: string,
  addonKey: string,
): Promise<AssinaturaActionResult> {
  return run(() => attachAdminSubscriptionAddon(id, { addonKey }));
}

export async function detachAddonAction(
  id: string,
  addonKey: string,
): Promise<AssinaturaActionResult> {
  return run(() => detachAdminSubscriptionAddon(id, addonKey));
}

export async function cancelSubscriptionAction(id: string): Promise<AssinaturaActionResult> {
  return run(() => cancelAdminSubscription(id));
}

export async function resumeSubscriptionAction(id: string): Promise<AssinaturaActionResult> {
  return run(() => resumeAdminSubscription(id));
}

export async function pauseSubscriptionAction(id: string): Promise<AssinaturaActionResult> {
  return run(() => pauseAdminSubscription(id));
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @ccc/admin typecheck
```

Esperado: zero erro. Se `apiFetch` reclamar de `method: 'DELETE'` sem `body`, confira a assinatura de `FetchOptions` em `apps/admin/src/lib/api.ts` e ajuste a chamada, não o helper.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib
git commit -m "feat(admin): camada de acesso e server actions de assinatura"
```

---

### Task 13: Navegação, gate de papel e redirect

**Files:**

- Modify: `apps/admin/src/components/authed-nav.tsx:11-20`
- Modify: `apps/admin/middleware.ts:5` e `:47`
- Modify: `apps/admin/app/(authed)/financeiro/membros/page.tsx` (substituição integral)
- Modify: `apps/admin/src/components/garage-membership-history.tsx:123`
- Delete: `apps/admin/app/(authed)/financeiro/membros/membros-table.tsx`
- Delete: `apps/admin/app/(authed)/financeiro/membros/__tests__/page.test.tsx`
- Test: `apps/admin/src/components/__tests__/authed-nav.test.tsx` (existente, acrescentar casos)
- Test: `apps/admin/middleware.test.ts` (existente, acrescentar casos)

**Interfaces:**

- Consumes: nada.
- Produces: rota `/assinaturas` acessível a `organizer` e `admin`, bloqueada para `staff`. `/financeiro/membros` redireciona preservando a query string.

- [ ] **Step 1: Acrescentar os casos de teste da navegação**

Em `apps/admin/src/components/__tests__/authed-nav.test.tsx`, acrescentar ao describe existente:

```ts
  it('mostra o link de Assinaturas para organizer', () => {
    const html = renderToStaticMarkup(<AuthedNav isStaff={false} />);
    expect(html).toContain('href="/assinaturas"');
    expect(html).toContain('Assinaturas');
  });

  it('nao mostra o link de Assinaturas para staff', () => {
    const html = renderToStaticMarkup(<AuthedNav isStaff={true} />);
    expect(html).not.toContain('href="/assinaturas"');
  });
```

Se o arquivo mocka `usePathname`, mantenha o mock existente. Não altere os casos que já existem.

- [ ] **Step 2: Acrescentar os casos de teste do middleware**

Em `apps/admin/middleware.test.ts`, acrescentar ao `describe('admin auth middleware')`,
reusando o helper `makeRequest` que já existe no topo do arquivo (linha 6):

```ts
it('redirects staff away from /assinaturas', () => {
  const res = middleware(
    makeRequest('/assinaturas', 'session_role=staff; session_refresh=valid_refresh_token'),
  );
  expect(res.headers.get('location')).toBe('https://jdm-admin-eight.vercel.app/check-in');
});

it('allows admin on /assinaturas', () => {
  const res = middleware(
    makeRequest('/assinaturas', 'session_role=admin; session_refresh=valid_refresh_token'),
  );
  expect(res.headers.get('location')).toBeNull();
});

it('allows organizer on a subscription detail page', () => {
  const res = middleware(
    makeRequest(
      '/assinaturas/mem-1',
      'session_role=organizer; session_refresh=valid_refresh_token',
    ),
  );
  expect(res.headers.get('location')).toBeNull();
});
```

- [ ] **Step 3: Rodar os testes para confirmar que falham**

```bash
pnpm --filter @ccc/admin exec vitest run src/components/__tests__/authed-nav.test.tsx middleware.test.ts
```

Esperado: FAIL nos quatro casos novos.

- [ ] **Step 4: Acrescentar o link na navegação**

Em `apps/admin/src/components/authed-nav.tsx`, em `ORGANIZER_LINKS`, entre a entrada de `/premium/catalogo` e a de `/users`:

```ts
  { href: '/assinaturas', label: 'Assinaturas' },
```

`STAFF_LINKS` fica intocado: `staff` nunca vê a aba.

- [ ] **Step 5: Estender o middleware**

Em `apps/admin/middleware.ts`, no `config.matcher` da linha 5, acrescentar `'/assinaturas/:path*'`:

```ts
export const config = {
  matcher: [
    '/',
    '/events/:path*',
    '/check-in/:path*',
    '/financeiro/:path*',
    '/assinaturas/:path*',
    '/login',
  ],
};
```

E no gate de papel da linha 47:

```ts
// Staff cannot touch /events/*, /financeiro/* or /assinaturas/*.
if (
  authedRole === 'staff' &&
  (path.startsWith('/events') || path.startsWith('/financeiro') || path.startsWith('/assinaturas'))
) {
  return NextResponse.redirect(new URL('/check-in', req.url));
}
```

- [ ] **Step 6: Rodar os testes**

```bash
pnpm --filter @ccc/admin exec vitest run src/components/__tests__/authed-nav.test.tsx middleware.test.ts
```

Esperado: PASS.

- [ ] **Step 7: Transformar `/financeiro/membros` em redirect**

Substituir o conteúdo integral de `apps/admin/app/(authed)/financeiro/membros/page.tsx` por:

```tsx
import { redirect } from 'next/navigation';

/**
 * A aba Assinaturas absorveu esta tela. A rota fica de pe so para nao quebrar
 * link salvo ou favorito, preservando os filtros que ja estavam na URL.
 *
 * redirect() lanca NEXT_REDIRECT, entao nunca pode ficar dentro de try/catch.
 */
export const dynamic = 'force-dynamic';

export default async function FinanceiroMembrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === 'string' && value.length > 0) params.set(key, value);
  }
  const qs = params.toString();
  redirect(qs ? `/assinaturas?${qs}` : '/assinaturas');
}
```

- [ ] **Step 8: Apagar o que ficou morto**

```bash
git rm "apps/admin/app/(authed)/financeiro/membros/membros-table.tsx"
git rm "apps/admin/app/(authed)/financeiro/membros/__tests__/page.test.tsx"
```

O comportamento migra para `assinaturas-table.tsx` na Task 14, com testes próprios. Manter o arquivo antigo sem consumidor seria código morto.

- [ ] **Step 9: Atualizar o link do histórico de membership**

Em `apps/admin/src/components/garage-membership-history.tsx`, na linha 123, trocar:

```tsx
                href={`/financeiro/membros?search=${encodeURIComponent(m.userName)}`}
```

por:

```tsx
                href={`/assinaturas?search=${encodeURIComponent(m.userName)}`}
```

- [ ] **Step 10: Confirmar que nada mais aponta para a rota antiga**

```bash
grep -rn "financeiro/membros" apps/admin --include="*.tsx" --include="*.ts"
```

Esperado: nenhuma ocorrência fora do próprio `page.tsx` de redirect.

- [ ] **Step 11: Typecheck e suíte do admin**

```bash
pnpm --filter @ccc/admin typecheck && pnpm --filter @ccc/admin test
```

Esperado: zero erro e PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): aba Assinaturas na navegacao e redirect de financeiro/membros"
```

---

### Task 14: Lista de assinaturas

**Files:**

- Create: `apps/admin/app/(authed)/assinaturas/page.tsx`
- Create: `apps/admin/app/(authed)/assinaturas/assinaturas-table.tsx`
- Create: `apps/admin/app/(authed)/assinaturas/__tests__/page.test.tsx`

**Interfaces:**

- Consumes: `fetchFinanceMemberships` de `~/lib/finance-actions`; `listAdminPremiumCatalog` (ou o nome real da função de catálogo em `admin-api.ts` — confirme com `grep -n "premium/catalog" apps/admin/src/lib/admin-api.ts`).
- Produces: `export function AssinaturasTable(props: Props)` com `Props` contendo `items`, `page`, `pageSize`, `total`, `activeFilters`, `preservedParams`, `moduleOptions`, `vendorOptions`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/admin/app/(authed)/assinaturas/__tests__/page.test.tsx`:

```tsx
import type { AdminFinanceMembershipsItem } from '@ccc/shared/admin';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AssinaturasTable } = await import('../assinaturas-table');

const item = (over: Partial<AdminFinanceMembershipsItem> = {}): AdminFinanceMembershipsItem => ({
  membershipId: 'mem-1',
  garageSlug: 'ana',
  userId: 'usr-1',
  userName: 'Ana',
  userEmail: 'ana@example.com',
  tier: 'gold',
  cadence: 'monthly',
  status: 'active',
  currentPeriodEnd: '2026-09-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  totalPaidCents: 164000,
  invoiceCount: 1,
  provider: 'stripe',
  providerSubRef: 'sub_1',
  baseAmountCents: 149000,
  addonsAmountCents: 15000,
  paymentBrand: 'visa',
  paymentLast4: '4242',
  addonKeys: ['detailing'],
  ...over,
});

const base = {
  page: 1,
  pageSize: 25,
  total: 1,
  activeFilters: {
    status: null,
    cadence: null,
    tier: null,
    provider: null,
    addonKey: null,
    vendorName: null,
  },
  preservedParams: {},
  moduleOptions: [{ key: 'detailing', name: 'Detailing' }],
  vendorOptions: ['Lava Rápido X'],
};

describe('AssinaturasTable', () => {
  it('renderiza a linha com nome, email, plano e metodo de pagamento', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[item()]} />);
    expect(html).toMatch(/data-testid="assinaturas-row-mem-1"/);
    expect(html).toContain('Ana');
    expect(html).toContain('ana@example.com');
    expect(html).toMatch(/data-testid="assinaturas-status-mem-1"[^>]*>Ativo</);
    expect(html).toContain('visa');
    expect(html).toContain('4242');
  });

  it('linka a linha para o detalhe', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[item()]} />);
    expect(html).toContain('href="/assinaturas/mem-1"');
  });

  it('cai para rotulo derivado do provider quando nao ha cartao', () => {
    const html = renderToStaticMarkup(
      <AssinaturasTable {...base} items={[item({ paymentBrand: null, paymentLast4: null })]} />,
    );
    expect(html).toContain('Cartão');
  });

  it('mostra App Store para assinatura Apple sem cartao', () => {
    const html = renderToStaticMarkup(
      <AssinaturasTable
        {...base}
        items={[item({ provider: 'apple_revenuecat', paymentBrand: null, paymentLast4: null })]}
      />,
    );
    expect(html).toContain('App Store');
  });

  it('renderiza chips de modulo e de fornecedor', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[item()]} />);
    expect(html).toContain('addonKey=detailing');
    expect(html).toContain(`vendorName=${encodeURIComponent('Lava Rápido X')}`);
  });

  it('mostra estado vazio quando nao ha itens', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[]} total={0} />);
    expect(html).toMatch(/data-testid="assinaturas-empty-state"/);
  });

  it('preserva filtros ativos ao paginar e reseta page ao trocar filtro', () => {
    const html = renderToStaticMarkup(
      <AssinaturasTable
        {...base}
        items={[item()]}
        page={2}
        total={60}
        activeFilters={{ ...base.activeFilters, status: 'active' }}
      />,
    );
    expect(html).toMatch(/data-testid="assinaturas-prev"/);
    expect(html).toMatch(/data-testid="assinaturas-page-indicator"/);
    // link de pagina carrega o filtro
    expect(html).toContain('status=active');
  });

  it('renderiza os campos de periodo de renovacao', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[item()]} />);
    expect(html).toMatch(/name="from"/);
    expect(html).toMatch(/name="to"/);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
pnpm --filter @ccc/admin exec vitest run "app/(authed)/assinaturas/__tests__/page.test.tsx"
```

Esperado: FAIL, módulo `../assinaturas-table` não resolve.

- [ ] **Step 3: Criar a tabela**

Criar `apps/admin/app/(authed)/assinaturas/assinaturas-table.tsx`. Ela é a evolução direta de `membros-table.tsx`, que foi removida na Task 13. Regras que precisam ser mantidas do original: filtros são link que altera a query string, nunca estado de cliente; toda troca de filtro reseta `page`; chaves de query desconhecidas são preservadas verbatim.

Diferenças em relação ao original: `ActiveFilters` ganha `addonKey` e `vendorName`; `FILTER_KEYS` ganha as duas chaves; as colunas mudam; a linha linka para `/assinaturas/${membershipId}`; há um `<form method="get">` para `from` e `to`; todo `data-testid` usa o prefixo `assinaturas-`.

```tsx
import type { AdminFinanceMembershipsItem } from '@ccc/shared/admin';
import Link from 'next/link';

const statusLabel: Record<string, string> = {
  active: 'Ativo',
  past_due: 'Inadimplente',
  cancel_scheduled: 'Cancelamento agendado',
  expired: 'Expirado',
  trialing: 'Em teste',
  paused: 'Pausado',
};

const statusColor: Record<string, string> = {
  active: 'bg-emerald-900 text-emerald-300',
  past_due: 'bg-red-900 text-red-300',
  cancel_scheduled: 'bg-yellow-900 text-yellow-300',
  expired: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
  trialing: 'bg-blue-900 text-blue-300',
  paused: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
};

const cadenceLabel: Record<string, string> = { monthly: 'Mensal', annual: 'Anual' };
const tierLabel: Record<string, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const providerLabel: Record<string, string> = {
  stripe: 'Stripe',
  apple_revenuecat: 'Apple / RC',
};

/**
 * Metodo de pagamento so existe como snapshot para assinaturas que renovaram
 * depois da mudanca. Sem o snapshot, cai para um rotulo derivado do provider.
 */
function paymentLabel(item: AdminFinanceMembershipsItem): string {
  if (item.paymentBrand && item.paymentLast4) {
    return `${item.paymentBrand} ····${item.paymentLast4}`;
  }
  return item.provider === 'apple_revenuecat' ? 'App Store' : 'Cartão';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

type ActiveFilters = {
  status: string | null;
  cadence: string | null;
  tier: string | null;
  provider: string | null;
  addonKey: string | null;
  vendorName: string | null;
};

type Props = {
  items: AdminFinanceMembershipsItem[];
  page: number;
  pageSize: number;
  total: number;
  activeFilters: ActiveFilters;
  preservedParams: Record<string, string>;
  moduleOptions: Array<{ key: string; name: string }>;
  vendorOptions: string[];
};

const FILTER_KEYS = new Set([
  'status',
  'cadence',
  'tier',
  'provider',
  'addonKey',
  'vendorName',
  'page',
]);

function seedPreserved(params: URLSearchParams, preserved: Record<string, string>): void {
  for (const [k, v] of Object.entries(preserved)) {
    if (FILTER_KEYS.has(k)) continue;
    if (v) params.set(k, v);
  }
}

function applyFilters(params: URLSearchParams, f: ActiveFilters): void {
  if (f.status) params.set('status', f.status);
  if (f.cadence) params.set('cadence', f.cadence);
  if (f.tier) params.set('tier', f.tier);
  if (f.provider) params.set('provider', f.provider);
  if (f.addonKey) params.set('addonKey', f.addonKey);
  if (f.vendorName) params.set('vendorName', f.vendorName);
}

// Null limpa a chave. Sempre derruba `page`: trocar filtro volta para a pagina 1.
// Chaves desconhecidas (`from`, `to`, `search`) sao preservadas verbatim.
function buildFilterHref(
  preserved: Record<string, string>,
  current: ActiveFilters,
  key: keyof ActiveFilters,
  value: string | null,
): string {
  const params = new URLSearchParams();
  seedPreserved(params, preserved);
  applyFilters(params, { ...current, [key]: value });
  const qs = params.toString();
  return qs ? `?${qs}` : '?';
}

function buildPageHref(
  preserved: Record<string, string>,
  current: ActiveFilters,
  page: number,
): string {
  const params = new URLSearchParams();
  seedPreserved(params, preserved);
  applyFilters(params, current);
  params.set('page', String(page));
  return `?${params.toString()}`;
}

function buildClearHref(preserved: Record<string, string>): string {
  const params = new URLSearchParams();
  seedPreserved(params, preserved);
  const qs = params.toString();
  return qs ? `?${qs}` : '?';
}

function Chip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]'
          : 'border-[color:var(--color-border)] text-[color:var(--color-muted)] hover:border-[color:var(--color-muted)]'
      }`}
    >
      {label}
    </Link>
  );
}

export function AssinaturasTable({
  items,
  page,
  pageSize,
  total,
  activeFilters,
  preservedParams,
  moduleOptions,
  vendorOptions,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const statusOptions = ['active', 'past_due', 'cancel_scheduled', 'paused', 'expired'];
  const cadenceOptions = ['monthly', 'annual'];
  const tierOptions = ['bronze', 'silver', 'gold'];
  const providerOptions = ['stripe', 'apple_revenuecat'];

  const hasAnyFilter = Object.values(activeFilters).some(Boolean);

  const chipGroup = (
    key: keyof ActiveFilters,
    options: ReadonlyArray<{ value: string; label: string }>,
  ) =>
    options.map((o) => (
      <Chip
        key={`${key}-${o.value}`}
        href={buildFilterHref(
          preservedParams,
          activeFilters,
          key,
          activeFilters[key] === o.value ? null : o.value,
        )}
        label={o.label}
        active={activeFilters[key] === o.value}
      />
    ));

  const divider = <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          {chipGroup(
            'status',
            statusOptions.map((s) => ({ value: s, label: statusLabel[s] ?? s })),
          )}
          {divider}
          {chipGroup(
            'tier',
            tierOptions.map((t) => ({ value: t, label: tierLabel[t] ?? t })),
          )}
          {divider}
          {chipGroup(
            'cadence',
            cadenceOptions.map((c) => ({ value: c, label: cadenceLabel[c] ?? c })),
          )}
          {divider}
          {chipGroup(
            'provider',
            providerOptions.map((p) => ({ value: p, label: providerLabel[p] ?? p })),
          )}
        </div>

        {moduleOptions.length > 0 || vendorOptions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[color:var(--color-muted)]">Módulo</span>
            {chipGroup(
              'addonKey',
              moduleOptions.map((m) => ({ value: m.key, label: m.name })),
            )}
            {vendorOptions.length > 0 ? (
              <>
                {divider}
                <span className="text-xs text-[color:var(--color-muted)]">Fornecedor</span>
                {chipGroup(
                  'vendorName',
                  vendorOptions.map((v) => ({ value: v, label: v })),
                )}
              </>
            ) : null}
          </div>
        ) : null}

        {/*
          Periodo de renovacao. Formulario GET em vez de chip porque o valor e
          continuo, nao uma escolha entre opcoes. Os filtros ativos viajam em
          campos hidden para o submit nao apagar o resto do estado.
        */}
        <form method="get" className="flex flex-wrap items-end gap-2">
          {Object.entries(preservedParams)
            .filter(([k]) => k !== 'from' && k !== 'to')
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          {(Object.keys(activeFilters) as Array<keyof ActiveFilters>)
            .filter((k) => activeFilters[k])
            .map((k) => (
              <input key={k} type="hidden" name={k} value={activeFilters[k] as string} />
            ))}
          <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
            Renova de
            <input
              type="date"
              name="from"
              defaultValue={preservedParams.from ?? ''}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]"
              data-testid="assinaturas-from"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
            até
            <input
              type="date"
              name="to"
              defaultValue={preservedParams.to ?? ''}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]"
              data-testid="assinaturas-to"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
            Buscar
            <input
              type="search"
              name="search"
              defaultValue={preservedParams.search ?? ''}
              placeholder="nome ou email"
              className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]"
              data-testid="assinaturas-search"
            />
          </label>
          <button
            type="submit"
            className="rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
            data-testid="assinaturas-apply"
          >
            Aplicar
          </button>
          {hasAnyFilter || preservedParams.from || preservedParams.to || preservedParams.search ? (
            <Link
              href={buildClearHref({})}
              className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
            >
              Limpar filtros
            </Link>
          ) : null}
        </form>
      </div>

      {items.length === 0 ? (
        <div
          className="flex min-h-[20vh] items-center justify-center rounded border border-[color:var(--color-border)]"
          data-testid="assinaturas-empty-state"
        >
          <p className="text-sm text-[color:var(--color-muted)]">Nenhuma assinatura encontrada.</p>
        </div>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
              <th className="py-2 pr-3">Membro</th>
              <th className="pr-3">Plano</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">Pagamento</th>
              <th className="pr-3">Renovação</th>
              <th className="pr-3">Mensal</th>
              <th className="pr-3">Módulos</th>
              <th className="pr-3">Total pago</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.membershipId}
                className="border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-border)]/30"
                data-testid={`assinaturas-row-${item.membershipId}`}
              >
                <td className="py-2 pr-3">
                  <Link
                    href={`/assinaturas/${item.membershipId}`}
                    className="font-medium hover:underline"
                    data-testid={`assinaturas-row-link-${item.membershipId}`}
                  >
                    {item.userName}
                  </Link>
                  <div className="text-xs text-[color:var(--color-muted)]">{item.userEmail}</div>
                </td>
                <td className="pr-3">
                  {tierLabel[item.tier] ?? item.tier} / {cadenceLabel[item.cadence] ?? item.cadence}
                </td>
                <td className="pr-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor[item.status] ?? ''}`}
                    data-testid={`assinaturas-status-${item.membershipId}`}
                  >
                    {statusLabel[item.status] ?? item.status}
                  </span>
                </td>
                <td className="pr-3 text-xs">{paymentLabel(item)}</td>
                <td className="pr-3">{fmtDate(item.currentPeriodEnd)}</td>
                <td className="pr-3">{fmtBRL(item.baseAmountCents + item.addonsAmountCents)}</td>
                <td className="pr-3">
                  {item.addonKeys.length === 0 ? (
                    <span className="text-xs text-[color:var(--color-muted)]">—</span>
                  ) : (
                    <span
                      className="text-xs"
                      data-testid={`assinaturas-addons-${item.membershipId}`}
                    >
                      {item.addonKeys.join(', ')}
                    </span>
                  )}
                </td>
                <td className="pr-3">{fmtBRL(item.totalPaidCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link
              href={buildPageHref(preservedParams, activeFilters, page - 1)}
              className="rounded border border-[color:var(--color-border)] px-3 py-1"
              data-testid="assinaturas-prev"
            >
              Anterior
            </Link>
          ) : (
            <span
              className="rounded border border-[color:var(--color-border)] px-3 py-1 opacity-40"
              data-testid="assinaturas-prev"
            >
              Anterior
            </span>
          )}
          <span
            className="text-xs text-[color:var(--color-muted)]"
            data-testid="assinaturas-page-indicator"
          >
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={buildPageHref(preservedParams, activeFilters, page + 1)}
              className="rounded border border-[color:var(--color-border)] px-3 py-1"
              data-testid="assinaturas-next"
            >
              Próxima
            </Link>
          ) : (
            <span
              className="rounded border border-[color:var(--color-border)] px-3 py-1 opacity-40"
              data-testid="assinaturas-next"
            >
              Próxima
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Criar a página de lista**

Criar `apps/admin/app/(authed)/assinaturas/page.tsx`:

```tsx
import { AssinaturasTable } from './assinaturas-table';

import { getAdminPremiumCatalog } from '~/lib/admin-api';
import { fetchFinanceMemberships } from '~/lib/finance-actions';

export const dynamic = 'force-dynamic';

type StatusFilter = 'trialing' | 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | 'paused';
type CadenceFilter = 'monthly' | 'annual';
type TierFilter = 'bronze' | 'silver' | 'gold';
type ProviderFilter = 'stripe' | 'apple_revenuecat';

const statusValues: ReadonlyArray<StatusFilter> = [
  'trialing',
  'active',
  'past_due',
  'cancel_scheduled',
  'expired',
  'paused',
];
const cadenceValues: ReadonlyArray<CadenceFilter> = ['monthly', 'annual'];
const tierValues: ReadonlyArray<TierFilter> = ['bronze', 'silver', 'gold'];
const providerValues: ReadonlyArray<ProviderFilter> = ['stripe', 'apple_revenuecat'];

export default async function AssinaturasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const getStr = (key: string) => {
    const v = sp[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  const pageRaw = Number(getStr('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const pageSize = 25;

  const rawStatus = getStr('status');
  const rawCadence = getStr('cadence');
  const rawTier = getStr('tier');
  const rawProvider = getStr('provider');

  const status = statusValues.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : undefined;
  const cadence = cadenceValues.includes(rawCadence as CadenceFilter)
    ? (rawCadence as CadenceFilter)
    : undefined;
  const tier = tierValues.includes(rawTier as TierFilter) ? (rawTier as TierFilter) : undefined;
  const provider = providerValues.includes(rawProvider as ProviderFilter)
    ? (rawProvider as ProviderFilter)
    : undefined;

  const from = getStr('from');
  const to = getStr('to');
  const search = getStr('search');
  const addonKey = getStr('addonKey');
  const vendorName = getStr('vendorName');

  // O catalogo alimenta as opcoes de modulo e a lista de fornecedores distintos.
  // Falha aqui nao pode derrubar a lista inteira: sem catalogo, os dois grupos
  // de chip simplesmente nao aparecem.
  let moduleOptions: Array<{ key: string; name: string }> = [];
  let vendorOptions: string[] = [];
  try {
    const catalog = await getAdminPremiumCatalog();
    const activeModules = catalog.modules.filter((m) => m.active);
    moduleOptions = activeModules.map((m) => ({ key: m.key, name: m.name }));
    vendorOptions = Array.from(
      new Set(
        activeModules
          .map((m) => m.vendorName)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  } catch {
    moduleOptions = [];
    vendorOptions = [];
  }

  const data = await fetchFinanceMemberships({
    status,
    cadence,
    tier,
    provider,
    from,
    to,
    search,
    addonKey,
    vendorName,
    page,
    pageSize,
  });

  const preservedParams: Record<string, string> = {};
  if (from) preservedParams.from = from;
  if (to) preservedParams.to = to;
  if (search) preservedParams.search = search;

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Assinaturas</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Controle das assinaturas dos membros, planos e módulos adicionais.
        </p>
      </header>
      <AssinaturasTable
        items={data.items}
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        activeFilters={{
          status: status ?? null,
          cadence: cadence ?? null,
          tier: tier ?? null,
          provider: provider ?? null,
          addonKey: addonKey ?? null,
          vendorName: vendorName ?? null,
        }}
        preservedParams={preservedParams}
        moduleOptions={moduleOptions}
        vendorOptions={vendorOptions}
      />
    </section>
  );
}
```

Nomes já verificados contra o código: a função é `getAdminPremiumCatalog`, exportada em
`apps/admin/src/lib/admin-api.ts:252`, e a resposta traz `{ plans, modules }` — o array
é `modules`, não `addonModules`. O campo `vendorName` nos módulos vem da Task 2,
Step 9b.

- [ ] **Step 5: Rodar o teste**

```bash
pnpm --filter @ccc/admin exec vitest run "app/(authed)/assinaturas/__tests__/page.test.tsx"
```

Esperado: PASS, 8 testes.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @ccc/admin typecheck
```

Esperado: zero erro.

- [ ] **Step 7: Commit**

```bash
git add "apps/admin/app/(authed)/assinaturas"
git commit -m "feat(admin): lista de assinaturas com filtros de modulo, fornecedor e renovacao"
```

---

### Task 15: Tela de detalhe

**Files:**

- Create: `apps/admin/app/(authed)/assinaturas/[id]/page.tsx`
- Create: `apps/admin/app/(authed)/assinaturas/[id]/__tests__/page.test.tsx`

**Interfaces:**

- Consumes: `fetchAdminSubscription` (Task 12); `AdminSubscriptionDetail` (Task 2).
- Produces: a página de detalhe. Os três painéis de ação da Task 16 são plugados nos pontos 6, 7 e 5 do layout.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/admin/app/(authed)/assinaturas/[id]/__tests__/page.test.tsx`. Como a página é async e busca dados, o teste renderiza o resultado de `await AssinaturaDetalhePage({ params })` com `fetchAdminSubscription` mockado:

```tsx
import type { AdminSubscriptionDetail } from '@ccc/shared/admin-subscription';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchAdminSubscription = vi.fn();
vi.mock('~/lib/assinaturas-actions', () => ({
  fetchAdminSubscription: (id: string) => fetchAdminSubscription(id),
}));

// Os paineis de acao sao client components com estado; aqui so importa que a
// pagina os posiciona e passa `mutable`. Stub simples mantem o teste em node.
vi.mock('../plan-actions', () => ({
  PlanActions: ({ mutable }: { mutable: boolean }) => (
    <div data-testid="assinaturas-plan-actions" data-mutable={String(mutable)} />
  ),
}));
vi.mock('../status-actions', () => ({
  StatusActions: ({ mutable }: { mutable: boolean }) => (
    <div data-testid="assinaturas-status-actions" data-mutable={String(mutable)} />
  ),
}));
vi.mock('../addons-panel', () => ({
  AddonsPanel: ({ mutable }: { mutable: boolean }) => (
    <div data-testid="assinaturas-addons-panel" data-mutable={String(mutable)} />
  ),
}));

const Page = (await import('../page')).default;

const detail = (over: Partial<AdminSubscriptionDetail> = {}): AdminSubscriptionDetail => ({
  membershipId: 'mem-1',
  userId: 'usr-1',
  userName: 'Ana',
  userEmail: 'ana@example.com',
  garageId: 'gar-1',
  garageSlug: 'ana',
  tier: 'gold',
  planSlug: 'fundador',
  planName: 'Fundador',
  cadence: 'monthly',
  status: 'active',
  provider: 'stripe',
  currentPeriodStart: '2026-08-01T00:00:00.000Z',
  currentPeriodEnd: '2026-09-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  baseAmountCents: 149000,
  addonsAmountCents: 15000,
  totalAmountCents: 164000,
  currency: 'BRL',
  paymentBrand: 'visa',
  paymentLast4: '4242',
  mutable: true,
  addons: [
    {
      key: 'detailing',
      name: 'Detailing',
      vendorName: 'Lava Rápido X',
      status: 'active',
      quotaUnit: 'access',
      quotaPerCycle: 3,
      monthlyDeltaCents: 15000,
      payoutAmountCents: 9000,
      marginCents: 6000,
      billingIntegrated: true,
      currentCycle: {
        cycleStart: '2026-08-01T00:00:00.000Z',
        cycleEnd: '2026-09-01T00:00:00.000Z',
        quotaTotal: 3,
        quotaUsed: 1,
        quotaRemaining: 2,
      },
    },
  ],
  invoices: [
    {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-01T00:00:00.000Z',
      paidAt: '2026-07-01T03:00:00.000Z',
      grossAmountCents: 164000,
      addonsAmountCents: 15000,
      currency: 'BRL',
      status: 'paid',
      refundedAt: null,
      refundedAmountCents: null,
    },
  ],
  ...over,
});

const render = async (d: AdminSubscriptionDetail) => {
  fetchAdminSubscription.mockResolvedValueOnce(d);
  const el = await Page({ params: Promise.resolve({ id: d.membershipId }) });
  return renderToStaticMarkup(el);
};

describe('tela de detalhe da assinatura', () => {
  it('mostra membro, email e link para o usuario', async () => {
    const html = await render(detail());
    expect(html).toContain('Ana');
    expect(html).toContain('ana@example.com');
    expect(html).toContain('href="/users/usr-1"');
  });

  it('mostra plano, valores e metodo de pagamento', async () => {
    const html = await render(detail());
    expect(html).toContain('Fundador');
    expect(html).toMatch(/data-testid="assinaturas-detalhe-total"/);
    expect(html).toContain('visa');
    expect(html).toContain('4242');
  });

  it('cai para rotulo do provider quando nao ha cartao', async () => {
    const html = await render(detail({ paymentBrand: null, paymentLast4: null }));
    expect(html).toContain('Cartão');
  });

  it('mostra o modulo com fornecedor, repasse e margem', async () => {
    const html = await render(detail());
    expect(html).toMatch(/data-testid="assinaturas-detalhe-modulo-detailing"/);
    expect(html).toContain('Lava Rápido X');
    // cobrado 150,00 / repasse 90,00 / margem 60,00
    expect(html).toContain('90,00');
    expect(html).toContain('60,00');
  });

  it('avisa quando o modulo nao esta integrado a cobranca', async () => {
    const d = detail();
    d.addons[0]!.billingIntegrated = false;
    const html = await render(d);
    expect(html).toMatch(/data-testid="assinaturas-detalhe-modulo-sem-cobranca-detailing"/);
  });

  it('mostra o historico de pagamentos', async () => {
    const html = await render(detail());
    expect(html).toMatch(/data-testid="assinaturas-detalhe-fatura-0"/);
  });

  it('avisa e desabilita acoes em assinatura da Apple', async () => {
    const html = await render(detail({ provider: 'apple_revenuecat', mutable: false }));
    expect(html).toMatch(/data-testid="assinaturas-detalhe-imutavel"/);
    expect(html).toContain('data-mutable="false"');
  });

  it('mostra os tres paineis de acao', async () => {
    const html = await render(detail());
    expect(html).toMatch(/data-testid="assinaturas-plan-actions"/);
    expect(html).toMatch(/data-testid="assinaturas-status-actions"/);
    expect(html).toMatch(/data-testid="assinaturas-addons-panel"/);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
pnpm --filter @ccc/admin exec vitest run "app/(authed)/assinaturas/[id]/__tests__/page.test.tsx"
```

Esperado: FAIL, `../page` não resolve.

- [ ] **Step 3: Criar a página de detalhe**

Criar `apps/admin/app/(authed)/assinaturas/[id]/page.tsx`:

```tsx
import type { AdminSubscriptionDetail } from '@ccc/shared/admin-subscription';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AddonsPanel } from './addons-panel';
import { PlanActions } from './plan-actions';
import { StatusActions } from './status-actions';

import { ApiError } from '~/lib/api';
import { fetchAdminSubscription } from '~/lib/assinaturas-actions';

export const dynamic = 'force-dynamic';

const statusLabel: Record<string, string> = {
  active: 'Ativo',
  past_due: 'Inadimplente',
  cancel_scheduled: 'Cancelamento agendado',
  expired: 'Expirado',
  trialing: 'Em teste',
  paused: 'Pausado',
};

const statusColor: Record<string, string> = {
  active: 'bg-emerald-900 text-emerald-300',
  past_due: 'bg-red-900 text-red-300',
  cancel_scheduled: 'bg-yellow-900 text-yellow-300',
  expired: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
  trialing: 'bg-blue-900 text-blue-300',
  paused: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
};

const cadenceLabel: Record<string, string> = { monthly: 'Mensal', annual: 'Anual' };
const tierLabel: Record<string, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const providerLabel: Record<string, string> = {
  stripe: 'Stripe',
  apple_revenuecat: 'Apple / RevenueCat',
};
const addonStatusLabel: Record<string, string> = {
  active: 'Ativo',
  cancel_scheduled: 'Cancelamento agendado',
  cancelled: 'Cancelado',
};
const quotaUnitLabel: Record<string, string> = { access: 'acessos', hours: 'horas' };
const invoiceStatusLabel: Record<string, string> = {
  paid: 'Pago',
  refunded: 'Estornado',
  partial_refund: 'Estorno parcial',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function paymentLabel(d: AdminSubscriptionDetail): string {
  if (d.paymentBrand && d.paymentLast4) return `${d.paymentBrand} ····${d.paymentLast4}`;
  return d.provider === 'apple_revenuecat' ? 'App Store' : 'Cartão';
}

function Tile({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] p-3" data-testid={testId}>
      <div className="text-xs uppercase tracking-[0.16em] text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

export default async function AssinaturaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: AdminSubscriptionDetail;
  try {
    detail = await fetchAdminSubscription(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const attachedKeys = detail.addons.filter((a) => a.status !== 'cancelled').map((a) => a.key);

  return (
    <section className="flex flex-col gap-6">
      <Link
        href="/assinaturas"
        className="text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
      >
        ← Assinaturas
      </Link>

      {/* Card do membro */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border)] p-4">
        <div>
          <Link
            href={`/users/${detail.userId}`}
            className="text-xl font-bold hover:underline"
            data-testid="assinaturas-detalhe-membro"
          >
            {detail.userName}
          </Link>
          <div className="text-sm text-[color:var(--color-muted)]">{detail.userEmail}</div>
          <div className="text-xs text-[color:var(--color-muted)]">{detail.garageSlug}</div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${statusColor[detail.status] ?? ''}`}
            data-testid="assinaturas-detalhe-status"
          >
            {statusLabel[detail.status] ?? detail.status}
          </span>
          <span className="text-xs text-[color:var(--color-muted)]">
            {providerLabel[detail.provider] ?? detail.provider}
          </span>
        </div>
      </div>

      {!detail.mutable ? (
        <div
          className="rounded-lg border border-yellow-900 bg-yellow-900/20 p-3 text-sm text-yellow-300"
          data-testid="assinaturas-detalhe-imutavel"
        >
          Esta assinatura é gerenciada pela App Store. Alterações precisam ser feitas pelo próprio
          membro, no dispositivo. As ações abaixo ficam desabilitadas.
        </div>
      ) : null}

      {/* Tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Plano"
          value={`${detail.planName ?? tierLabel[detail.tier] ?? detail.tier}`}
          testId="assinaturas-detalhe-plano"
        />
        <Tile label="Cadência" value={cadenceLabel[detail.cadence] ?? detail.cadence} />
        <Tile label="Valor base" value={fmtBRL(detail.baseAmountCents)} />
        <Tile label="Módulos" value={fmtBRL(detail.addonsAmountCents)} />
        <Tile
          label="Total mensal"
          value={fmtBRL(detail.totalAmountCents)}
          testId="assinaturas-detalhe-total"
        />
        <Tile label="Renovação" value={fmtDate(detail.currentPeriodEnd)} />
        <Tile label="Cancelamento agendado" value={detail.cancelAtPeriodEnd ? 'Sim' : 'Não'} />
        <Tile
          label="Pagamento"
          value={paymentLabel(detail)}
          testId="assinaturas-detalhe-pagamento"
        />
      </div>

      {/* Modulos */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Módulos adicionais</h2>
        {detail.addons.length === 0 ? (
          <p
            className="text-sm text-[color:var(--color-muted)]"
            data-testid="assinaturas-detalhe-sem-modulos"
          >
            Nenhum módulo vinculado.
          </p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
                <th className="py-2 pr-3">Módulo</th>
                <th className="pr-3">Fornecedor</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Cota do ciclo</th>
                <th className="pr-3">Cobrado</th>
                <th className="pr-3">Repasse</th>
                <th className="pr-3">Margem</th>
              </tr>
            </thead>
            <tbody>
              {detail.addons.map((addon) => (
                <tr
                  key={addon.key}
                  className="border-b border-[color:var(--color-border)]"
                  data-testid={`assinaturas-detalhe-modulo-${addon.key}`}
                >
                  <td className="py-2 pr-3">
                    <div className="font-medium">{addon.name}</div>
                    {!addon.billingIntegrated ? (
                      <div
                        className="text-xs text-yellow-300"
                        data-testid={`assinaturas-detalhe-modulo-sem-cobranca-${addon.key}`}
                      >
                        A Stripe não está cobrando por este módulo.
                      </div>
                    ) : null}
                  </td>
                  <td className="pr-3">
                    {addon.vendorName ?? (
                      <span className="text-[color:var(--color-muted)]">Não cadastrado</span>
                    )}
                  </td>
                  <td className="pr-3 text-xs">{addonStatusLabel[addon.status] ?? addon.status}</td>
                  <td className="pr-3 text-xs">
                    {addon.currentCycle
                      ? `${addon.currentCycle.quotaUsed} de ${addon.currentCycle.quotaTotal} ${quotaUnitLabel[addon.quotaUnit] ?? addon.quotaUnit}`
                      : '—'}
                  </td>
                  <td className="pr-3">{fmtBRL(addon.monthlyDeltaCents)}</td>
                  <td className="pr-3">{fmtBRL(addon.payoutAmountCents)}</td>
                  <td className="pr-3">{fmtBRL(addon.marginCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AddonsPanel
          membershipId={detail.membershipId}
          mutable={detail.mutable}
          attachedKeys={attachedKeys}
        />
      </div>

      {/* Acoes */}
      <div className="grid gap-4 md:grid-cols-2">
        <PlanActions
          membershipId={detail.membershipId}
          mutable={detail.mutable}
          currentTier={detail.tier}
          currentCadence={detail.cadence}
        />
        <StatusActions
          membershipId={detail.membershipId}
          mutable={detail.mutable}
          status={detail.status}
        />
      </div>

      {/* Historico */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Histórico de pagamentos</h2>
        {detail.invoices.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Nenhuma fatura registrada.</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
                <th className="py-2 pr-3">Período</th>
                <th className="pr-3">Pago em</th>
                <th className="pr-3">Valor</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Estorno</th>
              </tr>
            </thead>
            <tbody>
              {detail.invoices.map((inv, i) => (
                <tr
                  key={`${inv.periodStart}-${i}`}
                  className="border-b border-[color:var(--color-border)]"
                  data-testid={`assinaturas-detalhe-fatura-${i}`}
                >
                  <td className="py-2 pr-3">
                    {fmtDate(inv.periodStart)} — {fmtDate(inv.periodEnd)}
                  </td>
                  <td className="pr-3">{fmtDate(inv.paidAt)}</td>
                  <td className="pr-3">{fmtBRL(inv.grossAmountCents)}</td>
                  <td className="pr-3 text-xs">{invoiceStatusLabel[inv.status] ?? inv.status}</td>
                  <td className="pr-3 text-xs">
                    {inv.refundedAt
                      ? `${fmtDate(inv.refundedAt)} · ${fmtBRL(inv.refundedAmountCents ?? 0)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Passar o catálogo de módulos para o painel**

Os três painéis já existem, criados na Task 16, que roda antes desta. Buscar o catálogo
com o mesmo tratamento tolerante a falha usado na lista e repassar ao `AddonsPanel`.

No topo da página, junto das outras buscas:

```tsx
// Sem catalogo o admin ainda ve a assinatura; so nao consegue vincular modulo.
let moduleOptions: Array<{ key: string; name: string }> = [];
try {
  const catalog = await getAdminPremiumCatalog();
  moduleOptions = catalog.modules
    .filter((m) => m.active)
    .map((m) => ({ key: m.key, name: m.name }));
} catch {
  moduleOptions = [];
}
```

Acrescentar `getAdminPremiumCatalog` aos imports de `~/lib/admin-api`, e passar
`moduleOptions={moduleOptions}` no `<AddonsPanel />`.

- [ ] **Step 4b: Rodar o teste**

```bash
pnpm --filter @ccc/admin exec vitest run "app/(authed)/assinaturas/[id]/__tests__/page.test.tsx"
```

Esperado: PASS, 8 testes.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @ccc/admin typecheck
```

Esperado: zero erro.

- [ ] **Step 6: Commit**

```bash
git add "apps/admin/app/(authed)/assinaturas/[id]"
git commit -m "feat(admin): tela de detalhe da assinatura com modulos e historico"
```

---

### Task 16: Painéis de ação

**Executar ANTES da Task 15.** As duas são independentes, e nesta ordem a Task 15 não
precisa de stub nenhum. A Task 15 apenas importa e posiciona o que esta task cria.

**Files:**

- Create: `apps/admin/app/(authed)/assinaturas/[id]/use-action-toast.tsx`
- Create: `apps/admin/app/(authed)/assinaturas/[id]/plan-actions.tsx`
- Create: `apps/admin/app/(authed)/assinaturas/[id]/status-actions.tsx`
- Create: `apps/admin/app/(authed)/assinaturas/[id]/addons-panel.tsx`
- Create: `apps/admin/app/(authed)/assinaturas/[id]/__tests__/actions.interaction.test.tsx`

**Interfaces:**

- Consumes: as server actions da Task 12.
- Produces: `PlanActions`, `StatusActions`, `AddonsPanel`, todos `'use client'`.

- [ ] **Step 1: Escrever o teste de interação**

Criar `apps/admin/app/(authed)/assinaturas/[id]/__tests__/actions.interaction.test.tsx`:

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const cancelSubscriptionAction = vi.fn();
const resumeSubscriptionAction = vi.fn();
const pauseSubscriptionAction = vi.fn();
const changePlanAction = vi.fn();
const detachAddonAction = vi.fn();

vi.mock('~/lib/assinaturas-actions', () => ({
  cancelSubscriptionAction: (...a: unknown[]) => cancelSubscriptionAction(...a),
  resumeSubscriptionAction: (...a: unknown[]) => resumeSubscriptionAction(...a),
  pauseSubscriptionAction: (...a: unknown[]) => pauseSubscriptionAction(...a),
  changePlanAction: (...a: unknown[]) => changePlanAction(...a),
  attachAddonAction: vi.fn(),
  detachAddonAction: (...a: unknown[]) => detachAddonAction(...a),
}));

const { StatusActions } = await import('../status-actions');
const { PlanActions } = await import('../plan-actions');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const click = async (testId: string) => {
  const el = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing ${testId}`);
  await act(async () => {
    el.click();
  });
};

describe('StatusActions', () => {
  it('cancela, mostra aviso de pendente e chama refresh', async () => {
    cancelSubscriptionAction.mockResolvedValue({ ok: true, pending: true });
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="active" />);
    });

    await click('assinaturas-acao-cancelar');

    expect(cancelSubscriptionAction).toHaveBeenCalledWith('mem-1');
    expect(refresh).toHaveBeenCalled();
    expect(container.textContent).toContain('enviada');
  });

  it('mostra o erro devolvido pela action', async () => {
    cancelSubscriptionAction.mockResolvedValue({ ok: false, error: 'assinatura Apple' });
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="active" />);
    });

    await click('assinaturas-acao-cancelar');

    expect(container.textContent).toContain('assinatura Apple');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('desabilita tudo quando mutable e falso', async () => {
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={false} status="active" />);
    });
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="assinaturas-acao-cancelar"]',
    );
    expect(btn?.disabled).toBe(true);
  });

  it('mostra retomar em vez de cancelar quando cancel_scheduled', async () => {
    resumeSubscriptionAction.mockResolvedValue({ ok: true, pending: true });
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="cancel_scheduled" />);
    });

    expect(container.querySelector('[data-testid="assinaturas-acao-cancelar"]')).toBeNull();
    await click('assinaturas-acao-retomar');
    expect(resumeSubscriptionAction).toHaveBeenCalledWith('mem-1');
  });

  it('mostra retomar quando paused e nao mostra pausar', async () => {
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="paused" />);
    });
    expect(container.querySelector('[data-testid="assinaturas-acao-retomar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="assinaturas-acao-pausar"]')).toBeNull();
  });
});

describe('PlanActions', () => {
  it('envia tier e cadence selecionados', async () => {
    changePlanAction.mockResolvedValue({ ok: true, pending: true });
    await act(async () => {
      root.render(
        <PlanActions
          membershipId="mem-1"
          mutable={true}
          currentTier="gold"
          currentCadence="monthly"
        />,
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="assinaturas-plano-tier"]',
    );
    await act(async () => {
      select!.value = 'silver';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await click('assinaturas-acao-trocar-plano');

    expect(changePlanAction).toHaveBeenCalledWith('mem-1', 'silver', 'monthly');
  });

  it('avisa sobre rateio na proxima fatura', async () => {
    await act(async () => {
      root.render(
        <PlanActions
          membershipId="mem-1"
          mutable={true}
          currentTier="gold"
          currentCadence="monthly"
        />,
      );
    });
    expect(container.textContent).toContain('próxima fatura');
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
pnpm --filter @ccc/admin exec vitest run "app/(authed)/assinaturas/[id]/__tests__/actions.interaction.test.tsx"
```

Esperado: FAIL, os stubs renderizam `null`.

- [ ] **Step 3: Criar o hook de toast compartilhado pelos três painéis**

Não existe toast compartilhado no admin: o padrão é copiar o bloco local. Para não copiá-lo três vezes dentro da mesma pasta, criar `apps/admin/app/(authed)/assinaturas/[id]/use-action-toast.tsx`:

```tsx
'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { AssinaturaActionResult } from '~/lib/assinaturas-actions';

type Toast = { kind: 'success' | 'error'; message: string } | null;

/**
 * Estado compartilhado pelos tres paineis desta tela.
 *
 * O admin nao tem sistema de toast: o padrao do projeto e um bloco local com
 * role="status" por componente. Aqui os tres paineis vivem na mesma pasta e
 * teriam o bloco identico, entao o hook fica local a esta rota. Nao e uma
 * abstracao nova para o app inteiro.
 */
export function useActionToast() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast>(null);

  const run = useCallback(
    (fn: () => Promise<AssinaturaActionResult>) => {
      startTransition(async () => {
        const result = await fn();
        if (result.ok) {
          setToast({
            kind: 'success',
            message: result.pending
              ? 'Alteração enviada ao provedor. Aparece aqui em instantes.'
              : 'Alteração aplicada.',
          });
          // Sempre relê. Quando pending e true, a tela pode continuar mostrando o
          // valor antigo — isso e a verdade ate o webhook chegar.
          router.refresh();
        } else {
          setToast({ kind: 'error', message: result.error });
        }
        setTimeout(() => setToast(null), 2400);
      });
    },
    [router],
  );

  return { pending, toast, run };
}

export function ActionToast({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 rounded px-4 py-2 text-sm ${
        toast.kind === 'success' ? 'bg-emerald-900 text-emerald-200' : 'bg-red-900 text-red-200'
      }`}
      data-testid="assinaturas-toast"
    >
      {toast.message}
    </div>
  );
}
```

- [ ] **Step 4: Implementar `StatusActions`**

Substituir `apps/admin/app/(authed)/assinaturas/[id]/status-actions.tsx`:

```tsx
'use client';

import {
  cancelSubscriptionAction,
  pauseSubscriptionAction,
  resumeSubscriptionAction,
} from '~/lib/assinaturas-actions';

import { ActionToast, useActionToast } from './use-action-toast';

type Props = {
  membershipId: string;
  mutable: boolean;
  status: 'trialing' | 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | 'paused';
};

const CANCELABLE = ['active', 'past_due', 'trialing'];
const RESUMABLE = ['cancel_scheduled', 'paused'];
const PAUSABLE = ['active', 'past_due', 'trialing'];

const btn =
  'rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40';

export function StatusActions({ membershipId, mutable, status }: Props) {
  const { pending, toast, run } = useActionToast();
  const disabled = !mutable || pending;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] p-4">
      <h2 className="text-lg font-semibold">Status</h2>
      <div className="flex flex-wrap gap-2">
        {CANCELABLE.includes(status) ? (
          <button
            type="button"
            className={btn}
            disabled={disabled}
            data-testid="assinaturas-acao-cancelar"
            onClick={() => run(() => cancelSubscriptionAction(membershipId))}
          >
            Cancelar ao fim do período
          </button>
        ) : null}
        {RESUMABLE.includes(status) ? (
          <button
            type="button"
            className={btn}
            disabled={disabled}
            data-testid="assinaturas-acao-retomar"
            onClick={() => run(() => resumeSubscriptionAction(membershipId))}
          >
            Retomar
          </button>
        ) : null}
        {PAUSABLE.includes(status) ? (
          <button
            type="button"
            className={btn}
            disabled={disabled}
            data-testid="assinaturas-acao-pausar"
            onClick={() => run(() => pauseSubscriptionAction(membershipId))}
          >
            Pausar cobrança
          </button>
        ) : null}
      </div>
      <p className="text-xs text-[color:var(--color-muted)]">
        A alteração é enviada ao provedor e confirmada por webhook. O valor na tela só muda depois
        da confirmação.
      </p>
      <ActionToast toast={toast} />
    </div>
  );
}
```

- [ ] **Step 5: Implementar `PlanActions`**

Substituir `apps/admin/app/(authed)/assinaturas/[id]/plan-actions.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { changePlanAction } from '~/lib/assinaturas-actions';

import { ActionToast, useActionToast } from './use-action-toast';

type Tier = 'bronze' | 'silver' | 'gold';
type Cadence = 'monthly' | 'annual';

type Props = {
  membershipId: string;
  mutable: boolean;
  currentTier: Tier;
  currentCadence: Cadence;
};

const tierLabel: Record<Tier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const cadenceLabel: Record<Cadence, string> = { monthly: 'Mensal', annual: 'Anual' };

const field =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]';

export function PlanActions({ membershipId, mutable, currentTier, currentCadence }: Props) {
  const { pending, toast, run } = useActionToast();
  const [tier, setTier] = useState<Tier>(currentTier);
  const [cadence, setCadence] = useState<Cadence>(currentCadence);

  const unchanged = tier === currentTier && cadence === currentCadence;
  const disabled = !mutable || pending || unchanged;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] p-4">
      <h2 className="text-lg font-semibold">Plano</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
          Tier
          <select
            className={field}
            value={tier}
            disabled={!mutable || pending}
            data-testid="assinaturas-plano-tier"
            onChange={(e) => setTier(e.target.value as Tier)}
          >
            {(Object.keys(tierLabel) as Tier[]).map((t) => (
              <option key={t} value={t}>
                {tierLabel[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
          Cadência
          <select
            className={field}
            value={cadence}
            disabled={!mutable || pending}
            data-testid="assinaturas-plano-cadencia"
            onChange={(e) => setCadence(e.target.value as Cadence)}
          >
            {(Object.keys(cadenceLabel) as Cadence[]).map((c) => (
              <option key={c} value={c}>
                {cadenceLabel[c]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={disabled}
          data-testid="assinaturas-acao-trocar-plano"
          onClick={() => run(() => changePlanAction(membershipId, tier, cadence))}
        >
          Trocar plano
        </button>
      </div>
      <p className="text-xs text-[color:var(--color-muted)]">
        A diferença proporcional entra como crédito ou débito na próxima fatura. Nenhuma cobrança
        imediata fora do ciclo.
      </p>
      <ActionToast toast={toast} />
    </div>
  );
}
```

- [ ] **Step 6: Implementar `AddonsPanel`**

Substituir `apps/admin/app/(authed)/assinaturas/[id]/addons-panel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

import { attachAddonAction, detachAddonAction } from '~/lib/assinaturas-actions';

import { ActionToast, useActionToast } from './use-action-toast';

type Props = {
  membershipId: string;
  mutable: boolean;
  /** Chaves ja vinculadas, para nao oferecer duplicata no select. */
  attachedKeys: string[];
  /** Catalogo de modulos ativos. Vem do server component pai. */
  moduleOptions?: Array<{ key: string; name: string }>;
};

export function AddonsPanel({ membershipId, mutable, attachedKeys, moduleOptions = [] }: Props) {
  const { pending, toast, run } = useActionToast();
  const available = moduleOptions.filter((m) => !attachedKeys.includes(m.key));
  const [selected, setSelected] = useState<string>(available[0]?.key ?? '');

  // O catalogo pode chegar depois de um refresh; mantem a selecao valida.
  useEffect(() => {
    if (selected && available.some((m) => m.key === selected)) return;
    setSelected(available[0]?.key ?? '');
  }, [available, selected]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
          Vincular módulo
          <select
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]"
            value={selected}
            disabled={!mutable || pending || available.length === 0}
            data-testid="assinaturas-modulo-select"
            onChange={(e) => setSelected(e.target.value)}
          >
            {available.length === 0 ? (
              <option value="">Nenhum módulo disponível</option>
            ) : (
              available.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={!mutable || pending || !selected}
          data-testid="assinaturas-acao-vincular-modulo"
          onClick={() => run(() => attachAddonAction(membershipId, selected))}
        >
          Vincular
        </button>
      </div>

      {attachedKeys.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachedKeys.map((key) => (
            <button
              key={key}
              type="button"
              className="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs disabled:opacity-40"
              disabled={!mutable || pending}
              data-testid={`assinaturas-acao-remover-modulo-${key}`}
              onClick={() => run(() => detachAddonAction(membershipId, key))}
            >
              Remover {key}
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-[color:var(--color-muted)]">
        Vincular ou remover módulo aplica de imediato, com rateio na próxima fatura.
      </p>
      <ActionToast toast={toast} />
    </div>
  );
}
```

- [ ] **Step 7: Rodar os testes de interação**

```bash
pnpm --filter @ccc/admin exec vitest run "app/(authed)/assinaturas/[id]/__tests__/actions.interaction.test.tsx"
```

Esperado: PASS, 7 testes. A tela de detalhe ainda não existe; ela vem na Task 15 e
importa estes três componentes.

- [ ] **Step 8: Suíte e typecheck do admin**

```bash
pnpm --filter @ccc/admin test && pnpm --filter @ccc/admin typecheck && pnpm --filter @ccc/admin lint
```

Esperado: PASS e zero erro.

- [ ] **Step 9: Commit**

```bash
git add "apps/admin/app/(authed)/assinaturas/[id]"
git commit -m "feat(admin): paineis de plano, status e modulos da assinatura"
```

---

### Task 17: Verificação final

**Files:** nenhum arquivo novo. Esta task só verifica e corrige o que aparecer.

**Interfaces:**

- Consumes: tudo.
- Produces: evidência de que o trabalho está completo.

- [ ] **Step 1: Suíte completa do monorepo**

```bash
pnpm test
```

Esperado: PASS em todos os pacotes. Cole a linha final de resumo de cada pacote no relatório.

- [ ] **Step 2: Typecheck dos três consumidores de `@ccc/shared`**

```bash
pnpm --filter @ccc/api typecheck && pnpm --filter @ccc/admin typecheck && pnpm --filter @ccc/mobile typecheck
```

Esperado: zero erro nos três. O typecheck do mobile é obrigatório mesmo sem mudança no mobile: houve incidente anterior de mobile ficar vermelho por 15 commits porque só a API foi conferida.

- [ ] **Step 3: Lint e formatação**

```bash
pnpm lint && pnpm format:check
```

Esperado: zero erro. Se `format:check` reclamar, rode `pnpm format` e faça um commit de formatação separado.

- [ ] **Step 4: Confirmar que a suíte do membro não foi tocada**

```bash
git diff --stat main...HEAD -- apps/api/test
```

Esperado: nenhum arquivo de teste pré-existente de `me-premium-addons` aparece como modificado. Só arquivos novos. Se algum teste antigo foi editado, a refatoração da Task 7 mudou comportamento: reverta a edição do teste e conserte o serviço.

- [ ] **Step 5: Conferir que a migration é aditiva**

```bash
grep -i "drop\|alter column\|not null" packages/db/prisma/migrations/*_addon_payout_and_payment_method/migration.sql
```

Esperado: nenhuma ocorrência de `DROP`. `NOT NULL` só é aceitável junto de `DEFAULT`.

- [ ] **Step 6: Subir o admin e conferir a tela**

```bash
pnpm --filter @ccc/admin dev
```

Com a API rodando, abrir `/assinaturas`. Conferir manualmente: a aba aparece no menu; a lista carrega; os chips de status, tier, cadência, provider, módulo e fornecedor filtram; o período de renovação filtra; clicar numa linha abre o detalhe; o detalhe mostra módulos com repasse e margem, método de pagamento e histórico.

Registrar o que foi verificado. Se a Stripe não estiver em modo de teste configurada, as ações de mutação **não** podem ser validadas aqui: anote isso explicitamente como pendência, não como aprovado.

- [ ] **Step 7: Revisão de código**

Invocar a skill `superpowers:requesting-code-review` sobre o diff completo da branch.

- [ ] **Step 8: Abrir o PR**

```bash
git push -u origin feat/assinaturas-controle-admin
```

Abrir PR para `main`. Nunca para `production`.

---

## Notas para quem for executar

**A ordem importa.** Tasks 1 e 2 destravam tudo. Tasks 3, 4 e 5 são independentes entre si
e podem ser paralelizadas. Task 6 destrava 7 e 8. Tasks 9, 10 e 11 dependem de 7 e 8.
Tasks 12 em diante dependem de 9, 10 e 11.

**A Task 16 roda antes da Task 15.** As duas são independentes, e nesta ordem a tela de
detalhe importa painéis que já existem, em vez de stubs que retornam `null`. Ordem de
execução: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, **16, 15**, 17.

**A Task 7 é a mais delicada em risco de regressão.** Ela move regra de negócio existente. O critério de aceite não é o teste novo passar: é o teste antigo passar sem edição.

**A Task 4 é a mais delicada em risco de correção.** Ela estende a máquina de estados de cobrança. Escreva os testes antes dos handlers, como o plano manda, e confie no `switch` exaustivo.

**Ponto de incerteza conhecido, sinalizado no spec.** A forma de `payment_method_details` na versão de API `2026-04-22.dahlia` precisa ser confirmada contra o SDK na Task 5, Step 8. Se `payment_method` não expandir como esperado, o fallback é deixar as duas colunas sempre nulas e exibir só o rótulo derivado do provider. Isso não bloqueia nenhuma outra task.
