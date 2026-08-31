# Go-live da web, código — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar todo o trabalho de engenharia que o Spec A exige antes de a
primeira cobrança real entrar no `app.casacar.club`: LGPD do fanout de exclusão,
política de privacidade coerente com a Stripe, corte contábil dos pedidos
pré-cutover, recuperação de membership pelo admin, reconciliação do Pix,
reembolso pelo suporte, e verificação do comportamento de reembolso parcial.

**Architecture:** Nada de arquitetura nova. Um campo booleano em duas tabelas de
receita mais o filtro correspondente; dois endpoints de admin que mecanizam
procedimentos hoje manuais; um worker de varredura espelhando o
`billing-reconcile.ts`; e correções de documento legal. Nenhum pedido e nenhuma
membership muda de estado por chamada de cliente. As duas escritas novas de
admin são autenticadas, auditadas e passam pelos mesmos caminhos que o webhook
usa.

**Tech Stack:** Fastify 5, Zod, Prisma, Postgres via Testcontainers, node-cron,
Next.js App Router, vitest.

**Spec:** `docs/superpowers/specs/2026-08-12-stripe-live-web-design.md` (Spec A),
indexado e corrigido por
`docs/superpowers/specs/2026-08-29-pagamentos-mobile-consolidado-design.md`
(seções "Escopo que faltava" e "Ordem, corrigida").

## Dependência entre planos, leia antes de começar

Este plano é **independente dos Planos 1 a 3**, com uma exceção que é
load-bearing:

> **A Task 1 (`packages/shared/src/legal.ts`) precede qualquer submissão iOS.**
> `legal.ts` é empacotado no binário mobile por
> `apps/mobile/app/(auth)/privacidade.tsx:2`. Submeter um binário cuja política
> diz que assinatura é gerida pela RevenueCat, enquanto o app cobra por Stripe, é
> contradição visível ao revisor da App Review. Não é trabalho paralelo à
> submissão. É trabalho anterior a ela.

Fora isso, as onze tasks podem ser executadas em qualquer ordem, com duas
sequências internas obrigatórias: Task 3 antes de 4 antes de 5, e Task 8 antes
de 9.

## Global Constraints

- Idioma primário PT-BR. Copy nova de admin em português, sem tradução paralela
  (o admin não tem i18n; só o mobile tem).
- Teste de integração da API bate em Postgres real via Testcontainers. Nunca
  mock. Rodar exige Docker rodando.
- Comando de teste da API, sempre neste formato:
  `cd apps/api && pnpm exec vitest run test/<caminho>`.
  **Nunca** `pnpm --filter @ccc/api test -- <arquivo>`. O `--` não filtra e roda
  os ~2268 testes.
- **Pedido só vira `paid` por webhook verificado.** Nenhuma task deste plano
  cria caminho de cliente que escreva `paid`. O endpoint de reembolso escreve
  `refunded` só depois de a Stripe confirmar, e o de membership grant é
  autenticado como admin e auditado.
- Webhooks são idempotentes: dedupe por id de evento do provedor, upsert por
  `provider_ref`, assinatura verificada em todo handler. Nenhuma task afrouxa
  isso.
- Toda migração de banco ganha doc de rollback, seguindo a convenção dos três
  `docs/migration-rollback-*.md` que já existem.
- Rate limiting em endpoint relevante (CLAUDE.md). As duas rotas novas de admin
  são autenticadas e ficam sob o limite que `routes/admin/index.ts` já registra;
  confirmar isso lendo o arquivo, não presumir.
- Commits pequenos, um por task no mínimo.
- Branch a partir de `main` atualizada. Nunca commitar nem push em `production`.
- Todos os números de linha citados neste plano são **âncoras de 2026-08-29**.
  Ler o arquivo antes de editar. Se a âncora não bater, o arquivo andou e vale o
  conteúdo, não a linha.

---

### Task 1: `legal.ts` — assinatura passa da RevenueCat para a Stripe

O documento publicado hoje nomeia um Operador que não opera mais. Isso é
inexatidão de política de privacidade sob LGPD, e vira contradição visível ao
revisor da Apple no instante em que o iOS cobrar por Stripe.

**Dois efeitos que é fácil esquecer, e que precisam estar no corpo do PR:**

1. `PREVIOUS_PRIVACY_POLICY_VERSION` (`legal.ts:25`) também sobe. Ele é
   interpolado na seção 12 (`legal.ts:235`). Subir só o atual faz o documento
   anunciar uma versão nova e um predecessor de duas versões atrás, que é
   exatamente a contradição que o comentário em `:16-24` diz ter sido corrigida
   uma vez.
2. `apps/admin/src/components/cookie-banner.tsx:39` compara a versão guardada
   com a constante. Subir a versão **faz o banner de cookies reaparecer para
   todo usuário do admin**. Isso é comportamento pretendido para mudança de
   política, e é visível. Não é bug.

**Files:**

- Modify: `packages/shared/src/legal.ts:14`, `:25`, `:86`, `:123`
- Test: `packages/shared/src/__tests__/legal.test.ts` (criar se não existir;
  conferir antes com `ls packages/shared/src/__tests__/`)

**Interfaces:**

- Produces: `PRIVACY_POLICY_VERSION = 'privacy-2026-08-29'`,
  `PREVIOUS_PRIVACY_POLICY_VERSION = 'privacy-2026-08-14'`.
  Nenhuma assinatura de função muda.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/__tests__/legal.test.ts
import { describe, expect, it } from 'vitest';

import {
  PREVIOUS_PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_VERSION,
  privacyPolicySections,
} from '../legal.js';

const sectionBody = (id: string): string => {
  const section = privacyPolicySections.find((s) => s.id === id);
  if (!section) throw new Error(`section not found: ${id}`);
  return section.body;
};

describe('privacy policy — subscription processor', () => {
  it('names Stripe, not RevenueCat, in the payment prose', () => {
    const body = sectionBody('dados-coletados');
    expect(body).not.toMatch(/RevenueCat/i);
    expect(body).toMatch(/Assinaturas premium:.*\*\*Stripe\*\*/);
  });

  it('lists Stripe and not RevenueCat in the subprocessor table', () => {
    const body = sectionBody('compartilhamento');
    expect(body).not.toMatch(/RevenueCat/i);
    expect(body).toMatch(
      /\| Stripe \| Processamento de pagamentos com cart..o e gest..o de assinaturas \| EUA \| Operador \|/,
    );
  });

  it('bumps both version constants together', () => {
    expect(PRIVACY_POLICY_VERSION).toBe('privacy-2026-08-29');
    // Bumping the current version without moving the previous one makes
    // section 12 announce a predecessor two versions back.
    expect(PREVIOUS_PRIVACY_POLICY_VERSION).toBe('privacy-2026-08-14');
  });

  it('interpolates both versions into section 12', () => {
    const body = sectionBody('alteracoes');
    expect(body).toContain('privacy-2026-08-29');
    expect(body).toContain('privacy-2026-08-14');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/legal.test.ts`
Expected: FAIL. A prosa ainda diz RevenueCat e a versão ainda é
`privacy-2026-08-14`.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/legal.ts:14` e `:25`, trocar as duas constantes e
substituir o comentário de bloco por um que descreva **este** bump:

```typescript
// Bumped 2026-08-29: subscription billing moved from RevenueCat to Stripe. The
// published document named RevenueCat as an Operador in both the payment prose
// and the subprocessor table, while the code charges through Stripe. Naming a
// processor that does not process is an LGPD accuracy defect, and it is a
// visible contradiction to an App Review reviewer once iOS charges via Stripe.
//
// This constant is NOT inert. Two consumers:
//   1. apps/admin/src/components/cookie-banner.tsx:39 compares it against the
//      stored consent version, so this bump re-shows the cookie banner to every
//      admin user. Intended for a policy change, and user-visible.
//   2. apps/mobile/app/(auth)/privacidade.tsx:2 bundles this module into the
//      iOS binary. That is why this change must land BEFORE submission, not in
//      parallel with it.
// The API does not read it. Whether existing users need fresh consent is a
// legal call, tracked in the payments roadmap.
export const PRIVACY_POLICY_VERSION = 'privacy-2026-08-29' as const;
```

```typescript
export const PREVIOUS_PRIVACY_POLICY_VERSION = 'privacy-2026-08-14' as const;
```

Em `legal.ts:86`, dentro da seção `dados-coletados`, substituir a linha da
RevenueCat:

```
- Assinaturas premium: gerenciadas pela **Stripe** (EUA), que recebe apenas o e-mail da conta e um identificador interno da garagem
```

Em `legal.ts:121-123`, dentro da tabela de subprocessadores da seção
`compartilhamento`: apagar a linha `| RevenueCat | ... |` inteira e reescrever a
linha da Stripe:

```
| Stripe | Processamento de pagamentos com cartão e gestão de assinaturas | EUA | Operador |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/legal.test.ts`
Expected: PASS, 4 testes.

Depois, rodar a suíte do admin, porque o banner de cookies tem teste próprio:
Run: `cd apps/admin && pnpm exec vitest run src`
Expected: PASS. Se algum teste fixa `privacy-2026-08-14` como literal, atualizar
para importar a constante em vez de repetir a string.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/legal.ts packages/shared/src/__tests__/legal.test.ts
git commit -m "fix(legal): assinatura passa da RevenueCat para a Stripe, com bump das duas versoes"
```

---

### Task 2: AbacatePay no fanout de exclusão de conta

`runVendorFanout` cobre Stripe, Expo, Sentry e Resend
(`apps/api/src/services/account-deletion/vendor-fanout.ts:27-58`). A AbacatePay é
Operador **nomeado** na tabela de subprocessadores da política
(`legal.ts:122`). Um fornecedor nomeado que não aparece no fanout é lacuna de
LGPD: o log de exclusão não consegue afirmar nada sobre ele.

Resolver como `skipped` com motivo documentado é resposta válida e é a resposta
correta aqui. O cliente da AbacatePay
(`apps/api/src/services/abacatepay/index.ts:58-62`) expõe três métodos:
`createPixBilling`, `getPixBilling` e `verifyWebhookSignature`. Nenhum deles é
deleção, e a AbacatePay não documenta API de exclusão de titular. O passo
registra isso explicitamente em vez de omitir o fornecedor.

**Files:**

- Modify: `apps/api/src/services/account-deletion/vendor-fanout.ts:56-58`
- Test: `apps/api/test/account-deletion/vendor-fanout-abacatepay.test.ts`

**Interfaces:**

- Consumes: `StepEntry` de `apps/api/src/services/account-deletion/anonymize.ts:10-15`,
  que é `{ step: string; status: 'ok' | 'skipped' | 'error'; error?: string; at: string }`.
- Produces: `runVendorFanout` passa a devolver também
  `{ step: 'abacatepay_customer_delete', status: 'skipped' }`. A assinatura
  `runVendorFanout(userId, stripe, env)` **não muda**.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/account-deletion/vendor-fanout-abacatepay.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { runVendorFanout } from '../../src/services/account-deletion/vendor-fanout.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('vendor fanout — AbacatePay', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // AbacatePay is a NAMED Operador in the published privacy policy
  // (packages/shared/src/legal.ts, subprocessor table). A named processor that
  // never appears in the deletion log is an LGPD gap: we cannot state what
  // happened to the data subject's records there.
  it('emits a step for AbacatePay', async () => {
    const { user } = await createUser({ email: 'abacate@jdm.test', verified: true });
    const steps = await runVendorFanout(user.id, buildFakeStripe(), env);

    const step = steps.find((s) => s.step === 'abacatepay_customer_delete');
    expect(step).toBeDefined();
    expect(step?.status).toBe('skipped');
    expect(step?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps every pre-existing vendor step', async () => {
    const { user } = await createUser({ email: 'abacate2@jdm.test', verified: true });
    const steps = await runVendorFanout(user.id, buildFakeStripe(), env);
    const names = steps.map((s) => s.step);

    expect(names).toContain('stripe_customer_delete');
    expect(names).toContain('expo_token_cleanup');
    expect(names).toContain('sentry_user_delete');
    expect(names).toContain('resend_contact_remove');
    expect(names).toContain('abacatepay_customer_delete');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/account-deletion/vendor-fanout-abacatepay.test.ts`
Expected: FAIL, `step` is undefined.

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/services/account-deletion/vendor-fanout.ts`, logo depois do
passo do Resend (`:58`) e antes do `return steps`:

```typescript
// AbacatePay: named Operador in the published privacy policy, so it must
// appear in the deletion log even when the answer is "nothing to purge".
// The client (services/abacatepay/index.ts) exposes createPixBilling,
// getPixBilling and verifyWebhookSignature — no deletion API exists, and
// AbacatePay documents none. We send no CPF (PixBillingCustomer.taxId has no
// caller today), so what the vendor holds for a Pix charge is the charge
// itself, retained by them under their own fiscal obligation. Recorded as
// `skipped` with this reason rather than omitted.
steps.push({ step: 'abacatepay_customer_delete', status: 'skipped', at: now() });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/account-deletion/`
Expected: PASS, o arquivo novo mais o `worker.test.ts` que já existia. O
`worker.test.ts:146-150` afirma que todo passo é `ok` ou `skipped`, e continua
verde.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/account-deletion/vendor-fanout.ts apps/api/test/account-deletion/vendor-fanout-abacatepay.test.ts
git commit -m "fix(lgpd): abacatepay entra no fanout de exclusao de conta"
```

---

### Task 3: Campo `livemode`, migração, backfill e doc de rollback

Não existe `livemode` em `Order` (`packages/db/prisma/schema.prisma:1234-1288`)
nem em `PremiumMembershipInvoice` (`:427-452`). `routes/admin/finance.ts` agrega
tudo junto, então o primeiro relatório de receita real somaria dinheiro de
teste com dinheiro de verdade.

O corte é por **instante de criação**, não por id. Ids de test mode de Customer,
Subscription e PaymentIntent são indistinguíveis dos live; o modo vive no campo
`livemode` do provedor. É o mesmo discriminador que
`apps/api/src/scripts/purge-test-mode.ts:48,62` já usa, e a mesma razão está
escrita em `docs/observability.md:104-108`.

Esta task entrega schema, script de backfill e doc de rollback. Ela **não** muda
nenhum número no admin ainda; isso é a Task 4. Rodar a migração sozinha deixa o
sistema exatamente como está hoje, porque o default é `true`.

**Files:**

- Modify: `packages/db/prisma/schema.prisma:1234-1288` e `:427-452`
- Create: `packages/db/prisma/migrations/20260829120000_order_livemode/migration.sql`
- Create: `apps/api/src/scripts/mark-pre-cutover-orders.ts`
- Create: `docs/migration-rollback-order-livemode.md`
- Test: `apps/api/test/scripts/mark-pre-cutover-orders.test.ts`

**Interfaces:**

- Produces:
  - `Order.livemode: Boolean @default(true)`
  - `PremiumMembershipInvoice.livemode: Boolean @default(true)`
  - `markPreCutoverRows(client, opts: { createdBefore: Date; dryRun?: boolean }): Promise<{ orders: number; membershipInvoices: number }>`
- Consumido pelas Tasks 4 e 5.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/scripts/mark-pre-cutover-orders.test.ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markPreCutoverRows } from '../../src/scripts/mark-pre-cutover-orders.js';
import { createUser, resetDatabase } from '../helpers.js';

const CUTOVER = new Date('2026-09-01T00:00:00.000Z');

describe('markPreCutoverRows', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  const makeOrder = async (userId: string, createdAt: Date) =>
    prisma.order.create({
      data: {
        userId,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: createdAt,
        createdAt,
      },
      select: { id: true, livemode: true },
    });

  it('defaults new rows to livemode true', async () => {
    const { user } = await createUser({ email: 'live@jdm.test' });
    const order = await makeOrder(user.id, new Date('2026-09-02T10:00:00.000Z'));
    expect(order.livemode).toBe(true);
  });

  it('flips only rows created before the cutover instant', async () => {
    const { user } = await createUser({ email: 'cut@jdm.test' });
    const before = await makeOrder(user.id, new Date('2026-08-20T10:00:00.000Z'));
    const after = await makeOrder(user.id, new Date('2026-09-02T10:00:00.000Z'));

    const result = await markPreCutoverRows(prisma, { createdBefore: CUTOVER });
    expect(result.orders).toBe(1);

    const rows = await prisma.order.findMany({
      where: { id: { in: [before.id, after.id] } },
      select: { id: true, livemode: true },
    });
    expect(rows.find((r) => r.id === before.id)?.livemode).toBe(false);
    expect(rows.find((r) => r.id === after.id)?.livemode).toBe(true);
  });

  // A dry run that writes is worse than no dry run: it is what the operator
  // uses to decide whether the cutoff instant is right.
  it('writes nothing in dry-run mode but reports the same count', async () => {
    const { user } = await createUser({ email: 'dry@jdm.test' });
    const before = await makeOrder(user.id, new Date('2026-08-20T10:00:00.000Z'));

    const result = await markPreCutoverRows(prisma, { createdBefore: CUTOVER, dryRun: true });
    expect(result.orders).toBe(1);

    const row = await prisma.order.findUnique({
      where: { id: before.id },
      select: { livemode: true },
    });
    expect(row?.livemode).toBe(true);
  });

  it('is idempotent — a second run finds nothing left to flip', async () => {
    const { user } = await createUser({ email: 'idem@jdm.test' });
    await makeOrder(user.id, new Date('2026-08-20T10:00:00.000Z'));

    await markPreCutoverRows(prisma, { createdBefore: CUTOVER });
    const second = await markPreCutoverRows(prisma, { createdBefore: CUTOVER });
    expect(second.orders).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/scripts/mark-pre-cutover-orders.test.ts`
Expected: FAIL. O módulo não existe e `livemode` não é campo conhecido do
Prisma Client.

- [ ] **Step 3: Write minimal implementation**

No `schema.prisma`, acrescentar o campo em `Order`, logo abaixo de `status`
(`:1258`), e um índice composto no bloco `@@index`:

```prisma
  livemode          Boolean           @default(true)
```

```prisma
  @@index([livemode, status, paidAt])
```

E em `PremiumMembershipInvoice`, logo abaixo de `status` (`:444`):

```prisma
  livemode               Boolean         @default(true)
```

```prisma
  @@index([livemode, paidAt])
```

Gerar a migração com `pnpm --filter @ccc/db exec prisma migrate dev --name order_livemode`
e conferir que o SQL gerado é aditivo. Deve sair equivalente a:

```sql
ALTER TABLE "Order" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PremiumMembershipInvoice" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "Order_livemode_status_paidAt_idx" ON "Order"("livemode", "status", "paidAt");
CREATE INDEX "PremiumMembershipInvoice_livemode_paidAt_idx" ON "PremiumMembershipInvoice"("livemode", "paidAt");
```

O script de backfill, espelhando a forma de
`apps/api/src/scripts/purge-test-mode.ts:119-138`, inclusive a ausência
deliberada de default para o instante de corte:

```typescript
// apps/api/src/scripts/mark-pre-cutover-orders.ts
/**
 * Marks pre-cutover revenue rows as `livemode = false`.
 *
 * Why creation time and not the provider id: Stripe test-mode ids for
 * Customer, Subscription and PaymentIntent are indistinguishable from live
 * ones. The mode lives in the provider's own `livemode` field, never in the
 * id string, so no string match can work. Same discriminator as
 * `purge-test-mode.ts`.
 *
 * There is no default cutoff on purpose. Guessing it hides real revenue from
 * the first finance report, or leaves test money in it. The instant is the
 * live cutover moment and it is a human decision.
 *
 * Idempotent: it only touches rows still at `livemode = true`.
 */
import { prisma, type Prisma, type PrismaClient } from '@ccc/db';

export type MarkPreCutoverResult = {
  orders: number;
  membershipInvoices: number;
};

type Client = PrismaClient | Prisma.TransactionClient;

export const markPreCutoverRows = async (
  client: Client,
  opts: { createdBefore: Date; dryRun?: boolean },
): Promise<MarkPreCutoverResult> => {
  const { createdBefore, dryRun = false } = opts;

  const orderWhere = { livemode: true, createdAt: { lt: createdBefore } };
  const invoiceWhere = { livemode: true, createdAt: { lt: createdBefore } };

  const orders = await client.order.count({ where: orderWhere });
  const membershipInvoices = await client.premiumMembershipInvoice.count({
    where: invoiceWhere,
  });

  if (dryRun) return { orders, membershipInvoices };

  await client.order.updateMany({ where: orderWhere, data: { livemode: false } });
  await client.premiumMembershipInvoice.updateMany({
    where: invoiceWhere,
    data: { livemode: false },
  });

  return { orders, membershipInvoices };
};

/**
 * CLI:
 *   tsx src/scripts/mark-pre-cutover-orders.ts --created-before=<ISO> --dry-run
 */
if (process.argv[1]?.endsWith('mark-pre-cutover-orders.ts')) {
  const raw = process.argv.find((a) => a.startsWith('--created-before='))?.split('=')[1];
  const dryRun = process.argv.includes('--dry-run');
  if (!raw) {
    console.error(
      'Missing --created-before=<ISO instant>. This is the live cutover moment: rows created before it are test-mode. There is no default on purpose.',
    );
    process.exit(1);
  } else {
    const createdBefore = new Date(raw);
    if (Number.isNaN(createdBefore.getTime())) {
      console.error(`--created-before is not a valid date: ${raw}`);
      process.exit(1);
    } else {
      markPreCutoverRows(prisma, { createdBefore, dryRun })
        .then((result) => {
          console.log(JSON.stringify({ dryRun, createdBefore: raw, ...result }, null, 2));
          return prisma.$disconnect();
        })
        .catch((err: unknown) => {
          console.error(err);
          process.exit(1);
        });
    }
  }
}
```

Nota para quem implementa: conferir em `purge-test-mode.ts:119-138` como o
guard de "sou o entrypoint" está escrito naquele arquivo e usar a mesma forma.
Se ele usar outro idiom, copiar o dele em vez do escrito acima.

O doc de rollback, seguindo a estrutura de
`docs/migration-rollback-cart-redesign.md`:

````markdown
<!-- docs/migration-rollback-order-livemode.md -->

# Migration Rollback — `Order.livemode` / `PremiumMembershipInvoice.livemode`

Cobre `20260829120000_order_livemode`, que adiciona a coluna booleana de corte
pré-cutover em `Order` e em `PremiumMembershipInvoice`, mais dois índices.

A migração é puramente aditiva e tem default `true`, então aplicá-la não muda
número nenhum no admin. O que muda os números é
`apps/api/src/scripts/mark-pre-cutover-orders.ts`, que roda depois e é
reversível separadamente.

## Preflight

```sql
-- Quantas linhas o script já marcou. Se for zero, o rollback é trivial:
-- ninguém consumiu o corte ainda.
SELECT COUNT(*) AS marked_orders FROM "Order" WHERE "livemode" = false;
SELECT COUNT(*) AS marked_invoices FROM "PremiumMembershipInvoice" WHERE "livemode" = false;
```

Se as contagens forem maiores que zero, **anote-as antes de continuar**. Dropar
a coluna apaga o corte, e reconstruí-lo exige rodar o script de novo com
exatamente o mesmo `--created-before`. Registre o instante usado junto das
contagens.

## Desfazer só o backfill, mantendo a coluna

Preferir isto quando o problema for o instante de corte escolhido, não o schema.

```sql
UPDATE "Order" SET "livemode" = true WHERE "livemode" = false;
UPDATE "PremiumMembershipInvoice" SET "livemode" = true WHERE "livemode" = false;
```

Depois rodar o script de novo com o instante correto.

## Rollback da migração

```sql
DROP INDEX IF EXISTS "Order_livemode_status_paidAt_idx";
DROP INDEX IF EXISTS "PremiumMembershipInvoice_livemode_paidAt_idx";

ALTER TABLE "Order" DROP COLUMN IF EXISTS "livemode";
ALTER TABLE "PremiumMembershipInvoice" DROP COLUMN IF EXISTS "livemode";

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260829120000_order_livemode';
```

Reverter o código junto. `routes/admin/finance.ts` passa a filtrar por
`livemode` e quebra contra um banco sem a coluna.
````

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/scripts/mark-pre-cutover-orders.test.ts`
Expected: PASS, 4 testes. Se o Prisma Client não reconhecer `livemode`, rodar
`pnpm --filter @ccc/db exec prisma generate` antes.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/api/src/scripts/mark-pre-cutover-orders.ts apps/api/test/scripts/mark-pre-cutover-orders.test.ts docs/migration-rollback-order-livemode.md
git commit -m "feat(db): livemode em Order e invoice de membership, com backfill e rollback"
```

---

### Task 4: `finance.ts` filtra por `livemode`

Com o campo existindo, o admin ganha o filtro. Default do endpoint: **só live**.
Ver dinheiro de teste passa a exigir pedido explícito.

Essa escolha de default é o ponto da task. Se o default fosse "tudo", o primeiro
relatório de receita real continuaria errado e ninguém perceberia.

**Files:**

- Modify: `packages/shared/src/admin.ts:617-631` (`adminFinanceQuerySchema`)
- Modify: `apps/api/src/routes/admin/finance.ts:59-96` (`buildWhere`),
  `:288-339` (`findMembershipInvoices`), `:219-227`
  (`MembershipInvoiceWhereInput`)
- Test: `apps/api/test/admin/finance-livemode.test.ts`

**Interfaces:**

- Consumes: `Order.livemode` e `PremiumMembershipInvoice.livemode` (Task 3).
- Produces:
  - `adminFinanceQuerySchema` ganha `livemode: z.enum(['live', 'test', 'all']).optional()`
  - `MembershipInvoiceWhereInput` ganha `livemode?: boolean`
  - Ausente resolve para `live` em todos os handlers de `/admin/finance/*`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/admin/finance-livemode.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('GET /admin/finance/summary — livemode', () => {
  let app: FastifyInstance;
  let auth: string;

  beforeAll(async () => {
    app = await makeApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    const { user } = await createUser({ email: 'fin@jdm.test', role: 'admin', verified: true });
    auth = bearer(env, user.id, 'admin');

    const { user: buyer } = await createUser({ email: 'buyer@jdm.test', verified: true });
    await prisma.order.createMany({
      data: [
        {
          userId: buyer.id,
          amountCents: 10_000,
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date('2026-09-02T12:00:00.000Z'),
          livemode: true,
        },
        {
          userId: buyer.id,
          amountCents: 999_00,
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date('2026-08-20T12:00:00.000Z'),
          livemode: false,
        },
      ],
    });
  });

  // The whole point of the column: the first real revenue report must not
  // include test money, and it must not require the operator to remember a
  // query parameter to be correct.
  it('excludes test-mode revenue by default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totalRevenueCents).toBe(10_000);
  });

  it('returns only test-mode revenue when asked', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?livemode=test',
      headers: { authorization: auth },
    });
    expect(res.json().totalRevenueCents).toBe(999_00);
  });

  it('returns both when asked for all', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?livemode=all',
      headers: { authorization: auth },
    });
    expect(res.json().totalRevenueCents).toBe(10_000 + 999_00);
  });

  it('applies the same default on the trend endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/trends',
      headers: { authorization: auth },
    });
    const total = res
      .json()
      .points.reduce((sum: number, p: { revenueCents: number }) => sum + p.revenueCents, 0);
    expect(total).toBe(10_000);
  });

  it('applies the same default on the export endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/export',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('99900');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/admin/finance-livemode.test.ts`
Expected: FAIL. O default devolve `10_000 + 999_00`.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/admin.ts`, dentro de `adminFinanceQuerySchema`
(`:617-631`), acrescentar:

```typescript
  /**
   * Revenue-mode scope. Absent means `live`.
   *
   * Before the live cutover, production ran entirely in Stripe test mode. Rows
   * from that period are marked `livemode = false` by
   * apps/api/src/scripts/mark-pre-cutover-orders.ts. Defaulting to `live` here
   * is what keeps the first real revenue report from silently including test
   * money; making the operator remember a parameter to be correct would not.
   */
  livemode: z.enum(['live', 'test', 'all']).optional(),
```

Em `apps/api/src/routes/admin/finance.ts`, acrescentar um helper junto dos
outros `normalize*` (`:274-286`):

```typescript
// Absent → 'live'. See the schema comment: the default has to be the safe one.
function resolveLivemodeFilter(q: AdminFinanceQuery): boolean | undefined {
  if (q.livemode === 'all') return undefined;
  if (q.livemode === 'test') return false;
  return true;
}
```

Dentro de `buildWhere` (`:59-96`), antes do `return where`:

```typescript
const livemode = resolveLivemodeFilter(q);
if (livemode !== undefined) where.livemode = livemode;
```

Em `MembershipInvoiceWhereInput` (`:219-227`), acrescentar `livemode?: boolean`.
Em `findMembershipInvoices` (`:288-339`), logo depois do bloco de `provider`
(`:305`):

```typescript
if (where.livemode !== undefined) filters.livemode = where.livemode;
```

E em cada um dos cinco pontos que montam um `MembershipInvoiceWhereInput`
(`:549` summary, `:817` trends, `:894` payment-mix, `:1137` export), setar
`livemode` a partir do mesmo helper. **Enumerar esses pontos com
`grep -n "MembershipInvoiceWhereInput" apps/api/src/routes/admin/finance.ts`
antes de editar**, em vez de confiar nesta lista: o arquivo tem mais de 1200
linhas e as âncoras podem ter andado.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/admin/`
Expected: PASS, incluindo `finance.test.ts`, `finance-kind-filter.test.ts`,
`finance-summary-memberships.test.ts` e `finance-memberships-list.test.ts`, que
já existiam. Se algum deles criava pedido sem `livemode`, o default `true` do
schema mantém o comportamento antigo e eles seguem verdes. Se algum quebrar, é
sinal de que o teste dependia de somar linhas de teste, e aí o teste é que está
errado.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/admin.ts apps/api/src/routes/admin/finance.ts apps/api/test/admin/finance-livemode.test.ts
git commit -m "feat(admin): financeiro exclui receita de test mode por padrao"
```

---

### Task 5: Filtro de `livemode` na UI de finanças

Sem controle na tela, o operador não consegue ver o histórico de teste nem
entender por que os números mudaram. E, mais importante, não fica evidente que o
que ele está olhando é só live.

**Files:**

- Modify: `apps/admin/app/(authed)/financeiro/components/filter-bar.tsx:7-20`
  (tipo `Filters`) e `:41-46` (junto dos `kindOptions`)
- Modify: `apps/admin/app/(authed)/financeiro/components/finance-dashboard.tsx:72-100`
  e `:189`
- Test: `apps/admin/app/(authed)/financeiro/components/__tests__/filter-bar.test.tsx`
  (arquivo existente, acrescentar `describe`)

**Interfaces:**

- Consumes: o parâmetro `livemode` da Task 4.
- Produces: `Filters` ganha `livemode?: string | null`. O `FilterBar` emite
  `onFilterChange('livemode', 'test' | 'all' | null)`.

- [ ] **Step 1: Write the failing test**

```typescript
// acrescentar a apps/admin/app/(authed)/financeiro/components/__tests__/filter-bar.test.tsx
describe('livemode filter', () => {
  const baseFilters = {
    from: null,
    to: null,
    provider: null,
    method: null,
    search: null,
    eventId: null,
  };

  it('renders a revenue-mode select defaulting to live', () => {
    render(
      <FilterBar
        filters={baseFilters}
        events={[]}
        onFilterChange={() => {}}
        onClear={() => {}}
        isPending={false}
      />,
    );
    const select = screen.getByLabelText('Modo de receita') as HTMLSelectElement;
    expect(select.value).toBe('live');
  });

  it('emits null when the operator picks live back again', () => {
    const onFilterChange = vi.fn();
    render(
      <FilterBar
        filters={{ ...baseFilters, livemode: 'test' }}
        events={[]}
        onFilterChange={onFilterChange}
        onClear={() => {}}
        isPending={false}
      />,
    );
    fireEvent.change(screen.getByLabelText('Modo de receita'), { target: { value: 'live' } });
    expect(onFilterChange).toHaveBeenCalledWith('livemode', null);
  });

  it('emits the raw value for test and all', () => {
    const onFilterChange = vi.fn();
    render(
      <FilterBar
        filters={baseFilters}
        events={[]}
        onFilterChange={onFilterChange}
        onClear={() => {}}
        isPending={false}
      />,
    );
    fireEvent.change(screen.getByLabelText('Modo de receita'), { target: { value: 'test' } });
    expect(onFilterChange).toHaveBeenCalledWith('livemode', 'test');
  });
});
```

Ler o topo de `filter-bar.test.tsx` antes de colar e reusar os imports que já
estão lá (`render`, `screen`, `fireEvent`, `vi`, `FilterBar`). Não duplicar
imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm exec vitest run app/\(authed\)/financeiro/components/__tests__/filter-bar.test.tsx`
Expected: FAIL, `Unable to find a label with the text of: Modo de receita`.

- [ ] **Step 3: Write minimal implementation**

Em `filter-bar.tsx`, no tipo `Filters` (`:7-20`), acrescentar
`livemode?: string | null;`. Junto dos outros arrays de opções (`:41-64`):

```typescript
// Pre-cutover rows are Stripe test mode. `live` is the default everywhere,
// including the API, so the operator has to opt IN to seeing test money.
const livemodeOptions = [
  { value: 'live', label: 'Receita real' },
  { value: 'test', label: 'Somente modo teste' },
  { value: 'all', label: 'Real + teste' },
];
```

E o select, dentro de `filterContent`, logo depois do select de `kind`:

```tsx
<select
  value={filters.livemode ?? 'live'}
  onChange={(e) => onFilterChange('livemode', e.target.value === 'live' ? null : e.target.value)}
  className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
  aria-label="Modo de receita"
>
  {livemodeOptions.map((o) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  ))}
</select>
```

Em `finance-dashboard.tsx`, ler `livemode` do `searchParams` e propagá-lo no
mesmo padrão que `kind` já usa em `:72`, `:100` e `:189`. Ler o arquivo antes de
editar; ele tem 307 linhas e o padrão de `searchParams` está repetido em três
lugares.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm exec vitest run app`
Expected: PASS, os três novos mais os que já existiam no arquivo.

- [ ] **Step 5: Commit**

```bash
git add "apps/admin/app/(authed)/financeiro"
git commit -m "feat(admin): seletor de modo de receita no financeiro"
```

---

### Task 6: `POST /admin/subscriptions/grant`, recuperação de membership

Ingresso tem `POST /admin/tickets/grant`
(`apps/api/src/routes/admin/tickets.ts:54`). Assinatura não tem equivalente. O
procedimento de hoje é manual e está escrito em prosa no Runbook 5 de
`docs/observability.md:312-320`: um desenvolvedor insere a linha de
`PremiumMembership` mais a de `PremiumMembershipInvoice` à mão, casando tier,
cadência, `baseAmountCents`, `devFeePercent` e limites de período com a invoice
da Stripe, dentro de uma transação segurando
`SELECT id FROM "Garage" ... FOR UPDATE`.

Isso é exatamente o caso "pagou e não recebeu". Fazer à mão, sob pressão, contra
produção, é como se erra o `devFeePercent` de um membro para sempre, porque a
linha da invoice é fonte da verdade e nunca é re-derivada.

O endpoint mecaniza o runbook chamando o mesmo `applyMembershipEvent` que o
webhook chama, com um `BillingEvent` de kind `subscription.activated`.

**Não é uma exceção à invariante de "membership só nasce de webhook
verificado".** É uma ação de admin autenticada, com `requireRole`, auditada em
`AdminAudit`, e o dinheiro já entrou pelo provedor. A invariante existe para
impedir que **cliente** crie membership. Escrever isso no comentário do handler.

**Files:**

- Modify: `apps/api/src/routes/admin/subscriptions.ts` (rota nova, junto das
  outras seis; o cabeçalho do arquivo em `:1-17` lista as rotas e precisa ser
  atualizado)
- Modify: `packages/shared/src/admin-subscription.ts` (schema novo)
- Modify: `docs/observability.md:312-320` (Runbook 5 passa a apontar para o
  endpoint em vez de descrever o INSERT à mão)
- Test: `apps/api/test/admin/subscriptions/grant.test.ts`
  (conferir o diretório com `ls apps/api/test/admin/subscriptions/`)

**Interfaces:**

- Consumes:
  - `applyMembershipEvent(tx: Prisma.TransactionClient, evt: BillingEvent): Promise<void>`
    de `apps/api/src/services/billing/apply-membership-event.ts:21`
  - `BillingEvent` variante `subscription.activated` de
    `apps/api/src/services/billing/types.ts`, que exige `provider`,
    `providerCustomerRef`, `providerSubRef`, `garageId`, `tier`, `cadence`,
    `currentPeriodStart`, `currentPeriodEnd`, `pricing`, `invoice`, `lines`,
    `addons`, `addonsAmountCents`
  - `recordAudit(input, client?)` de `apps/api/src/services/admin-audit.ts:44`
- Produces:
  - `adminSubscriptionGrantSchema` e `adminSubscriptionGrantResponseSchema` em
    `@ccc/shared/admin-subscription`
  - `POST /admin/subscriptions/grant` → `201 { membershipId }`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/admin/subscriptions/grant.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const env = loadEnv();

describe('POST /admin/subscriptions/grant', () => {
  let app: FastifyInstance;
  let adminAuth: string;
  let garageId: string;

  beforeAll(async () => {
    app = await makeApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    const { user: admin } = await createUser({
      email: 'admin@jdm.test',
      role: 'admin',
      verified: true,
    });
    adminAuth = bearer(env, admin.id, 'admin');

    const { user: member } = await createUser({ email: 'member@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { userId: member.id },
      select: { id: true },
    });
    garageId = garage.id;
  });

  const payload = () => ({
    garageId,
    tier: 'gold' as const,
    cadence: 'monthly' as const,
    providerCustomerRef: 'cus_live_recovery',
    providerSubRef: 'sub_live_recovery',
    providerInvoiceRef: 'in_live_recovery',
    baseAmountCents: 24_990,
    devFeePercent: 10,
    currentPeriodStart: '2026-09-01T00:00:00.000Z',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    reason: 'invoice.paid caiu em unknown-plan-price, evento ja marcado processado',
  });

  it('creates the membership and its invoice', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    expect(res.statusCode).toBe(201);

    const membership = await prisma.premiumMembership.findFirst({
      where: { providerSubRef: 'sub_live_recovery' },
      select: { id: true, tier: true, cadence: true, status: true, garageId: true },
    });
    expect(membership).toMatchObject({
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      garageId,
    });

    const invoice = await prisma.premiumMembershipInvoice.findFirst({
      where: { providerInvoiceRef: 'in_live_recovery' },
      select: { devFeePercent: true, baseAmountCents: true, grossAmountCents: true },
    });
    // devFee comes from the operator's reading of the real Stripe invoice, not
    // from env. The invoice line is the source of truth forever.
    expect(invoice).toMatchObject({
      devFeePercent: 10,
      baseAmountCents: 24_990,
      grossAmountCents: 27_489,
    });
  });

  it('updates the garage snapshot so the member is premium immediately', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: garageId },
      select: { premiumTier: true, premiumUntil: true },
    });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('records an audit row naming the actor and the reason', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'subscription.grant' },
      select: { entityType: true, metadata: true },
    });
    expect(audit?.entityType).toBe('PremiumMembership');
    expect(JSON.stringify(audit?.metadata)).toContain('unknown-plan-price');
  });

  // Replaying the same recovery must not double-charge the books.
  it('is idempotent on the provider invoice ref', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: payload(),
    });
    expect([200, 201, 409]).toContain(second.statusCode);

    const invoices = await prisma.premiumMembershipInvoice.count({
      where: { providerInvoiceRef: 'in_live_recovery' },
    });
    expect(invoices).toBe(1);
  });

  it('rejects a non-admin caller', async () => {
    const { user } = await createUser({ email: 'nobody@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: payload(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('404s an unknown garage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/subscriptions/grant',
      headers: { authorization: adminAuth },
      payload: { ...payload(), garageId: 'clzzzzzzzzzzzzzzzzzzzzzz' },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/admin/subscriptions/grant.test.ts`
Expected: FAIL com 404 na própria rota: ela não existe.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/admin-subscription.ts`:

```typescript
/**
 * Manual membership recovery. The "paid and got nothing" path.
 *
 * Every amount is typed in by the operator from the real provider invoice.
 * Nothing is derived from env: canon says the invoice line is the source of
 * truth forever, and a wrong devFeePercent here is permanent.
 */
export const adminSubscriptionGrantSchema = z.object({
  garageId: z.string().min(1),
  tier: z.enum(['bronze', 'silver', 'gold']),
  cadence: z.enum(['monthly', 'annual']),
  providerCustomerRef: z.string().min(1).max(200),
  providerSubRef: z.string().min(1).max(200),
  providerInvoiceRef: z.string().min(1).max(120),
  baseAmountCents: z.number().int().positive(),
  devFeePercent: z.number().int().min(0).max(100),
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  /** Free text, stored in the audit row. Required: a grant without a reason is unreviewable. */
  reason: z.string().min(10).max(500),
});
export type AdminSubscriptionGrant = z.infer<typeof adminSubscriptionGrantSchema>;

export const adminSubscriptionGrantResponseSchema = z.object({
  membershipId: z.string().min(1),
});
export type AdminSubscriptionGrantResponse = z.infer<typeof adminSubscriptionGrantResponseSchema>;
```

Em `apps/api/src/routes/admin/subscriptions.ts`, acrescentar a rota. Ela vai no
mesmo escopo `requireRole('organizer', 'admin')` em que
`adminSubscriptionRoutes` já é registrada por `routes/admin/index.ts:56-79`;
conferir isso lendo o arquivo antes.

```typescript
/**
 * POST /admin/subscriptions/grant
 *
 * Mechanises Runbook 5 of docs/observability.md: the member paid, the webhook
 * did not produce a membership (unknown-plan-price, or an event marked
 * processed before the catalog existed), and someone has to put the row in by
 * hand.
 *
 * This is NOT a hole in "memberships only ever come from a verified webhook".
 * That invariant exists to stop a CLIENT from minting entitlement. This route
 * is admin-authenticated, role-gated, audited, and only ever used after the
 * provider already took the money. Doing the same thing with a raw INSERT
 * against production, under pressure, is how a member's devFeePercent gets
 * wrong forever.
 *
 * It goes through applyMembershipEvent, the exact code path the webhook uses,
 * so the Garage snapshot, the invoice row and the FOR UPDATE lock all behave
 * identically. Idempotency comes free from
 * @@unique([provider, providerInvoiceRef]).
 */
app.post('/subscriptions/grant', async (request, reply) => {
  const { sub: actorId } = requireUser(request);
  const input = adminSubscriptionGrantSchema.parse(request.body);

  const garage = await prisma.garage.findUnique({
    where: { id: input.garageId },
    select: { id: true },
  });
  if (!garage) return reply.status(404).send({ error: 'NotFound', message: 'garage not found' });

  const devFeeAmountCents = Math.round((input.baseAmountCents * input.devFeePercent) / 100);
  const currentPeriodStart = new Date(input.currentPeriodStart);
  const currentPeriodEnd = new Date(input.currentPeriodEnd);

  const evt: BillingEvent = {
    kind: 'subscription.activated',
    provider: 'stripe',
    providerCustomerRef: input.providerCustomerRef,
    providerSubRef: input.providerSubRef,
    garageId: input.garageId,
    tier: input.tier,
    cadence: input.cadence,
    currentPeriodStart,
    currentPeriodEnd,
    pricing: {
      baseAmountCents: input.baseAmountCents,
      devFeePercent: input.devFeePercent,
      devFeeAmountCents,
      grossAmountCents: input.baseAmountCents + devFeeAmountCents,
      currency: 'BRL',
    },
    invoice: {
      providerInvoiceRef: input.providerInvoiceRef,
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd,
      paidAt: new Date(),
    },
    // Genuinely empty, not a placeholder: the operator transcribed the amounts
    // from the provider invoice, so there is no multi-line payload here for
    // the route to decompose. Add-ons are attached separately via
    // POST /admin/subscriptions/:id/addons.
    lines: [],
    addons: [],
    addonsAmountCents: 0,
  };

  // Canon §F8.5: hold SELECT FOR UPDATE on the Garage row before calling
  // applyMembershipEvent. Same lock the webhook takes.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${input.garageId} FOR UPDATE`;
    await applyMembershipEvent(tx, evt);
  });

  const membership = await prisma.premiumMembership.findFirstOrThrow({
    where: { providerSubRef: input.providerSubRef },
    select: { id: true },
  });

  await recordAudit({
    actorId,
    action: 'subscription.grant',
    entityType: 'PremiumMembership',
    entityId: membership.id,
    metadata: {
      garageId: input.garageId,
      providerInvoiceRef: input.providerInvoiceRef,
      reason: input.reason,
    },
  });

  return reply
    .status(201)
    .send(adminSubscriptionGrantResponseSchema.parse({ membershipId: membership.id }));
});
```

Atualizar o cabeçalho do arquivo (`:1-17`) com a linha nova, e o Runbook 5 de
`docs/observability.md:312-320`, trocando a descrição do INSERT manual por:

```markdown
**Criando uma membership por recuperação.** `POST /admin/subscriptions/grant`
existe para isso. Corpo: `garageId`, `tier`, `cadence`, `providerCustomerRef`,
`providerSubRef`, `providerInvoiceRef`, `baseAmountCents`, `devFeePercent`,
`currentPeriodStart`, `currentPeriodEnd` e `reason`. Todos os valores saem da
invoice real no dashboard da Stripe, não de suposição: a linha da invoice é
fonte da verdade para sempre e o `devFeePercent` não é re-derivado depois.

A rota passa pelo mesmo `applyMembershipEvent` do webhook, com o mesmo
`SELECT ... FOR UPDATE` na `Garage`, e grava linha em `AdminAudit`. Reexecutar
com o mesmo `providerInvoiceRef` não duplica a invoice.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/admin/subscriptions/`
Expected: PASS, os 6 novos mais os que já existiam no diretório.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/subscriptions.ts packages/shared/src/admin-subscription.ts apps/api/test/admin/subscriptions/grant.test.ts docs/observability.md
git commit -m "feat(admin): endpoint de recuperacao de membership, mecanizando o runbook 5"
```

---

### Task 7: Worker de reconciliação do Pix

`apps/api/src/workers/` tem dez workers e nenhum varre a AbacatePay.
`billing-reconcile.ts:237` faz isso para assinaturas Stripe e RevenueCat.

O buraco: se um `transparent.completed` se perde, o pedido fica `pending` com o
Pix pago. `abacatepay-webhook.ts:301` é o único caminho que liquida. A varredura
de expiração é preguiçosa, disparada por outro checkout do mesmo tier ou por
`GET /orders/:id`, e ela **expira** o pedido em vez de liquidá-lo. Resultado:
cliente pagou, estoque voltou para a prateleira, nenhum ingresso, nenhum
reembolso.

`getPixBilling` (`services/abacatepay/index.ts:130-140`) devolve
`{ id, status, paidAt }` e é a fonte autoritativa. `settlePaidOrder(orderId,
providerRef, env, intentMetadata?)` (`services/orders/settle.ts:22`) é o mesmo
caminho que o webhook usa.

**Files:**

- Create: `apps/api/src/workers/pix-reconcile.ts`
- Modify: `apps/api/src/app.ts:199-261` (registro do worker, dentro do bloco
  `WORKER_ENABLED && NODE_ENV === 'production'`)
- Test: `apps/api/test/workers/pix-reconcile.test.ts`

**Interfaces:**

- Consumes:
  - `AbacatePayClient.getPixBilling(id): Promise<{ id: string; status: string; paidAt: string | null }>`
  - `settlePaidOrder(orderId, providerRef, env, intentMetadata?)`
  - `buildFakeAbacatePay()` de `apps/api/src/services/abacatepay/fake.ts`, que
    expõe `calls`, `nextStatus` e devolve `status: 'PAID'` por default
- Produces:
  - `runPixReconcileTick(deps: PixReconcileTickDeps): Promise<void>`
  - `startPixReconcileWorker(deps: { abacatepay; env; log }): { stop: () => void }`
  - `type PixReconcileTickDeps = { abacatepay: AbacatePayClient; env: Env; alertDepth: number; now?: Date; log?: FastifyBaseLogger }`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/workers/pix-reconcile.test.ts
import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { buildFakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import { runPixReconcileTick } from '../../src/workers/pix-reconcile.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();
const NOW = new Date('2026-09-05T12:00:00.000Z');
const OLD = new Date('2026-09-05T11:00:00.000Z');

describe('runPixReconcileTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const makePendingPixOrder = async (providerRef: string | null, createdAt = OLD) => {
    const { user } = await createUser({ email: `pix-${providerRef ?? 'none'}@jdm.test` });
    return prisma.order.create({
      data: {
        userId: user.id,
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        status: 'pending',
        providerRef,
        createdAt,
      },
      select: { id: true },
    });
  };

  // The whole reason the worker exists: a lost transparent.completed leaves the
  // Pix paid and the order pending, and the lazy expiry sweep would EXPIRE it
  // rather than settle it. Money in, nothing out, stock back on the shelf.
  it('settles a pending order whose Pix the provider reports as PAID', async () => {
    const order = await makePendingPixOrder('pix_char_paid');
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = { id: 'pix_char_paid', status: 'PAID', paidAt: NOW.toISOString() };

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paidAt: true },
    });
    expect(row.status).toBe('paid');
    expect(row.paidAt).not.toBeNull();
  });

  it('leaves a still-pending Pix alone', async () => {
    const order = await makePendingPixOrder('pix_char_pending');
    const abacatepay = buildFakeAbacatePay();
    abacatepay.nextStatus = { id: 'pix_char_pending', status: 'PENDING', paidAt: null };

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe('pending');
  });

  it('skips orders with no providerRef instead of calling the provider', async () => {
    await makePendingPixOrder(null);
    const abacatepay = buildFakeAbacatePay();

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    expect(abacatepay.calls.filter((c) => c.method === 'getPixBilling')).toHaveLength(0);
  });

  it('ignores orders created inside the grace window', async () => {
    await makePendingPixOrder('pix_char_fresh', new Date(NOW.getTime() - 60_000));
    const abacatepay = buildFakeAbacatePay();

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    expect(abacatepay.calls.filter((c) => c.method === 'getPixBilling')).toHaveLength(0);
  });

  // One bad row must never stop the sweep. Same contract as billing-reconcile.
  it('continues past a provider error on one row', async () => {
    const bad = await makePendingPixOrder('pix_char_boom');
    const good = await makePendingPixOrder('pix_char_ok');

    const abacatepay = buildFakeAbacatePay();
    const original = abacatepay.getPixBilling;
    abacatepay.getPixBilling = (id: string) => {
      if (id === 'pix_char_boom') return Promise.reject(new Error('upstream 500'));
      return original(id);
    };

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    const rows = await prisma.order.findMany({
      where: { id: { in: [bad.id, good.id] } },
      select: { id: true, status: true },
    });
    expect(rows.find((r) => r.id === bad.id)?.status).toBe('pending');
    expect(rows.find((r) => r.id === good.id)?.status).toBe('paid');
  });

  it('is idempotent — a second tick does not re-settle', async () => {
    const order = await makePendingPixOrder('pix_char_twice');
    const abacatepay = buildFakeAbacatePay();

    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });
    await runPixReconcileTick({ abacatepay, env, alertDepth: 200, now: NOW });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    expect(row.status).toBe('paid');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/workers/pix-reconcile.test.ts`
Expected: FAIL, cannot resolve `../../src/workers/pix-reconcile.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/workers/pix-reconcile.ts
/**
 * Pix reconciliation sweep.
 *
 * Mirror of workers/billing-reconcile.ts, but for AbacatePay one-off charges
 * instead of Stripe subscriptions. Nothing swept them before this worker
 * existed.
 *
 * The failure it closes: a lost `transparent.completed` leaves the Pix paid at
 * the provider and the Order `pending` locally. The only settlement path is
 * routes/abacatepay-webhook.ts, and the expiry sweep is lazy — triggered by
 * another checkout on the same tier/variant, or by GET /orders/:id — and it
 * EXPIRES the order rather than settling it. So the customer pays, the stock
 * goes back on the shelf, no ticket is issued and no refund happens.
 *
 * Per row:
 *   1. Ask AbacatePay for the authoritative status (`getPixBilling`).
 *   2. If PAID, run the same `settlePaidOrder` the webhook runs.
 *   3. Anything else: leave it alone. The worker never expires and never
 *      refunds — both are other code's job, and guessing here loses money in
 *      the other direction.
 *
 * A row error never crashes the tick.
 */
import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import type { AbacatePayClient } from '../services/abacatepay/index.js';
import { settlePaidOrder } from '../services/orders/settle.js';

export type PixReconcileTickDeps = {
  abacatepay: AbacatePayClient;
  env: Env;
  alertDepth: number;
  now?: Date;
  log?: FastifyBaseLogger;
};

const QUERY_LIMIT = 200;

/**
 * Grace window. A Pix created seconds ago is not drift, it is a customer who
 * has not paid yet. Sweeping it would burn a provider call per tick per open
 * checkout for no reason.
 */
const GRACE_MS = 10 * 60 * 1000;

export const runPixReconcileTick = async (deps: PixReconcileTickDeps): Promise<void> => {
  const now = deps.now ?? new Date();
  const log = deps.log;

  const staleRows = await prisma.order.findMany({
    where: {
      provider: 'abacatepay',
      status: 'pending',
      providerRef: { not: null },
      createdAt: { lt: new Date(now.getTime() - GRACE_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: QUERY_LIMIT,
    select: { id: true, providerRef: true, cartId: true },
  });

  if (staleRows.length >= deps.alertDepth) {
    log?.warn(
      {
        kind: 'pix-reconcile.queue_depth_alert',
        depth: staleRows.length,
        alertDepth: deps.alertDepth,
      },
      'pix-reconcile: stale pending Pix queue depth at or above alert threshold',
    );
  }

  for (const row of staleRows) {
    const providerRef = row.providerRef;
    if (!providerRef) continue;

    try {
      const upstream = await deps.abacatepay.getPixBilling(providerRef);
      if (upstream.status !== 'PAID') continue;

      await settlePaidOrder(
        row.id,
        providerRef,
        deps.env,
        row.cartId ? { cartId: row.cartId } : undefined,
      );

      log?.warn(
        {
          kind: 'pix-reconcile.recovered',
          orderId: row.id,
          providerRef,
        },
        'pix-reconcile: settled a Pix the webhook never delivered',
      );
    } catch (err) {
      log?.error(
        { err, orderId: row.id, providerRef },
        'pix-reconcile: failed to reconcile row, continuing to next',
      );
      // Non-fatal: continue processing remaining rows.
    }
  }
};

export const startPixReconcileWorker = (deps: {
  abacatepay: AbacatePayClient;
  env: Env;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('*/15 * * * *', () => {
    void runPixReconcileTick({
      abacatepay: deps.abacatepay,
      env: deps.env,
      alertDepth: deps.env.RECONCILE_ALERT_DEPTH,
      log: deps.log,
    }).catch((err: unknown) => {
      deps.log.error({ err }, 'pix-reconcile tick failed');
    });
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
```

Em `apps/api/src/app.ts`, dentro do bloco
`if (env.WORKER_ENABLED && env.NODE_ENV === 'production')` (`:199`), **fora** do
`if (env.GROWTH_PREMIUM_BILLING_ENABLED)` de `:238`. O Pix avulso não é gateado
por essa flag: no instante em que a chave live entra, ele está valendo.

```typescript
// Pix avulso is NOT gated by GROWTH_PREMIUM_BILLING_ENABLED. That flag
// covers subscriptions. Registering this sweep inside the flag block would
// leave one-off Pix unswept exactly during the window the go-live plan
// keeps the flag off.
const pixReconcileWorker = startPixReconcileWorker({
  abacatepay: app.abacatepay,
  env,
  log: app.log,
});
app.addHook('onClose', () => {
  pixReconcileWorker.stop();
});
```

Conferir antes que `app.abacatepay` é mesmo o nome do decorator: ele é usado em
`routes/abacatepay-webhook.ts` como `app.abacatepay.getPixBilling`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/workers/pix-reconcile.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/pix-reconcile.ts apps/api/src/app.ts apps/api/test/workers/pix-reconcile.test.ts
git commit -m "feat(api): worker de reconciliacao do Pix da AbacatePay"
```

---

### Task 8: `POST /admin/orders/:id/refund`, o fluxo de reembolso pelo suporte

`app.stripe.refund` (`apps/api/src/services/stripe/index.ts:199,404`) só é
chamado de ramos automáticos dentro dos handlers de webhook: ingresso duplicado,
ingresso revogado, retirada indisponível, pedido expirado, carrinho pago depois
da expiração. Não existe endpoint e não existe tela.
`docs/observability.md:325-342` já registra isso, e a saída documentada é
"reembolse pelo dashboard da Stripe".

**Nome do fluxo: reembolso assistido.** Quem executa: **o fundador**, operando o
admin, com papel `admin`. Não é autoatendimento de cliente e não é automático.
A API pede o reembolso à Stripe; quem escreve `refunded` no banco continua sendo
o webhook `charge.refunded` verificado.

Essa divisão é o ponto da task. O endpoint **não** escreve status de pedido. Se
escrevesse, teríamos duas fontes da verdade para "este pedido foi reembolsado", e
a que o cliente vê poderia divergir da que a Stripe conhece.

**Files:**

- Create: `apps/api/src/routes/admin/refunds.ts`
- Modify: `apps/api/src/routes/admin/index.ts` (registrar no escopo
  `requireRole('admin')`, o mais restrito que o arquivo tiver; **ler o arquivo e
  escolher o escopo**, não presumir)
- Modify: `packages/shared/src/admin.ts` (schemas)
- Modify: `docs/observability.md:325-342` (a seção "Refunds and support")
- Test: `apps/api/test/admin/order-refund.test.ts`

**Interfaces:**

- Consumes: `app.stripe.refund(paymentIntentId: string, reason: string, amountCents?: number): Promise<void>`
- Produces:
  - `adminOrderRefundSchema = { reason: string; amountCents?: number }`
  - `POST /admin/orders/:id/refund` → `202 { requested: true, provider: 'stripe' }`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/admin/order-refund.test.ts
import { prisma } from '@ccc/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('POST /admin/orders/:id/refund', () => {
  let ctx: Awaited<ReturnType<typeof makeAppWithFakeStripe>>;
  let adminAuth: string;
  let orderId: string;

  beforeAll(async () => {
    ctx = await makeAppWithFakeStripe();
    await ctx.app.ready();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    ctx.stripe.calls.length = 0;

    const { user: admin } = await createUser({
      email: 'refund-admin@jdm.test',
      role: 'admin',
      verified: true,
    });
    adminAuth = bearer(env, admin.id, 'admin');

    const { user: buyer } = await createUser({ email: 'refund-buyer@jdm.test', verified: true });
    const order = await prisma.order.create({
      data: {
        userId: buyer.id,
        amountCents: 12_000,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date(),
        providerRef: 'pi_live_refundme',
      },
      select: { id: true },
    });
    orderId = order.id;
  });

  it('asks Stripe for the refund and returns 202', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'cliente desistiu dentro dos sete dias' },
    });
    expect(res.statusCode).toBe(202);
    expect(ctx.stripe.calls.some((c) => c.method === 'refund')).toBe(true);
  });

  // Load-bearing. The webhook owns the status column. If this route wrote it
  // too, "was this refunded" would have two answers that can disagree.
  it('does NOT flip the order status itself', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'cliente desistiu dentro dos sete dias' },
    });
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    expect(row.status).toBe('paid');
  });

  it('records an audit row with the reason', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'cliente desistiu dentro dos sete dias' },
    });
    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'order.refund_requested' },
      select: { entityId: true, metadata: true },
    });
    expect(audit?.entityId).toBe(orderId);
    expect(JSON.stringify(audit?.metadata)).toContain('sete dias');
  });

  it('422s an order that is not paid', async () => {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'pending' } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'tentativa em pedido nao pago' },
    });
    expect(res.statusCode).toBe(422);
  });

  // AbacatePay documents no refund API. Answering 501 with the manual path is
  // honest; pretending to refund is not.
  it('501s a Pix order and names the manual path', async () => {
    await prisma.order.update({
      where: { id: orderId },
      data: { provider: 'abacatepay', method: 'pix' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: adminAuth },
      payload: { reason: 'pix precisa de suporte do fornecedor' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ error: 'RefundNotSupported' });
  });

  it('rejects a non-admin caller', async () => {
    const { user } = await createUser({ email: 'notadmin@jdm.test', verified: true });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/admin/orders/${orderId}/refund`,
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { reason: 'nao deveria passar daqui' },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

Conferir a forma de `ctx.stripe.calls` em
`apps/api/src/services/stripe/fake.ts` antes de rodar. `buildFakeAbacatePay`
usa `{ method, args }`; se o fake da Stripe usar outra forma, ajustar a
asserção. **Não inventar a forma.**

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/admin/order-refund.test.ts`
Expected: FAIL com 404: a rota não existe.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/admin.ts`:

```typescript
/**
 * Assisted refund. Executed by the founder from the admin, never by the
 * customer and never automatically.
 *
 * `amountCents` is optional and means partial. Read the note in
 * apps/api/src/routes/stripe-webhook.ts before using it: the webhook currently
 * REFUSES to flip status on a partial refund and only flags Sentry.
 */
export const adminOrderRefundSchema = z.object({
  reason: z.string().min(10).max(500),
  amountCents: z.number().int().positive().optional(),
});
export type AdminOrderRefund = z.infer<typeof adminOrderRefundSchema>;

export const adminOrderRefundResponseSchema = z.object({
  requested: z.literal(true),
  provider: z.literal('stripe'),
});
export type AdminOrderRefundResponse = z.infer<typeof adminOrderRefundResponseSchema>;
```

```typescript
// apps/api/src/routes/admin/refunds.ts
/**
 * Reembolso assistido.
 *
 * Who runs it: the founder, from the admin, with role `admin`. Not the
 * customer, not a cron. Single operator, alerts by email, no paging —
 * docs/observability.md says the same thing about response expectations.
 *
 * What it does NOT do, deliberately: write Order.status. The `charge.refunded`
 * webhook owns that column, and it also revokes the tickets and fans out across
 * the whole cart (routes/stripe-webhook.ts). Writing the status here too would
 * give "was this refunded" two answers that can disagree — the local one and
 * the provider's. 202 means "asked Stripe", not "done".
 *
 * Pix: AbacatePay documents no refund API. We answer 501 and name the manual
 * path rather than pretending.
 */
import { prisma } from '@ccc/db';
import { adminOrderRefundResponseSchema, adminOrderRefundSchema } from '@ccc/shared/admin';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

export const adminRefundRoutes: FastifyPluginAsync = async (app) => {
  app.post('/orders/:id/refund', async (request, reply) => {
    const { sub: actorId } = requireUser(request);
    const { id } = request.params as { id: string };
    const input = adminOrderRefundSchema.parse(request.body);

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, provider: true, providerRef: true, amountCents: true },
    });
    if (!order) return reply.status(404).send({ error: 'NotFound' });

    if (order.provider !== 'stripe') {
      return reply.status(501).send({
        error: 'RefundNotSupported',
        message:
          'AbacatePay nao expoe API de reembolso. O caminho e o suporte do fornecedor, manualmente.',
      });
    }

    if (order.status !== 'paid') {
      return reply.status(422).send({
        error: 'OrderNotRefundable',
        message: `order status is ${order.status}, expected paid`,
      });
    }

    if (!order.providerRef) {
      return reply.status(422).send({
        error: 'OrderNotRefundable',
        message: 'order has no providerRef; refund from the Stripe dashboard',
      });
    }

    await app.stripe.refund(order.providerRef, input.reason, input.amountCents);

    await recordAudit({
      actorId,
      action: 'order.refund_requested',
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        reason: input.reason,
        amountCents: input.amountCents ?? order.amountCents,
        providerRef: order.providerRef,
      },
    });

    return reply
      .status(202)
      .send(adminOrderRefundResponseSchema.parse({ requested: true, provider: 'stripe' }));
  });
};
```

Registrar em `apps/api/src/routes/admin/index.ts`. Ler o arquivo e colocar no
escopo `requireRole('admin')` mais restrito que existir; hoje a maior parte das
rotas de finanças está em `requireRole('organizer', 'admin')` (`:56-79`).
Reembolso move dinheiro, então prefira o escopo só-admin se ele existir. Se não
existir, crie um.

Atualizar a seção "Refunds and support" de `docs/observability.md:325-342`,
trocando "There is no refund tooling in the product" por:

```markdown
## Refunds and support

**Reembolso assistido.** `POST /admin/orders/:id/refund`, executado pelo
fundador no admin, com papel `admin`. Corpo: `reason` (obrigatório, vai para o
`AdminAudit`) e `amountCents` opcional para parcial.

A rota pede o reembolso à Stripe e responde 202. Ela **não** escreve
`Order.status`: quem escreve é o webhook `charge.refunded` verificado, que
também revoga os ingressos e propaga para todos os pedidos do carrinho. 202
significa "pedimos", não "pronto". Confirmar no banco, não no dashboard.

- **Pix, via AbacatePay:** a rota responde 501. Não existe API de reembolso
  documentada (ver `plans/jdma-260-abacatepay-refund-api-path.md`). Vai pelo
  suporte do fornecedor, manualmente.
- **Reembolso parcial:** ver a nota no handler de `charge.refunded`. Hoje o
  webhook recusa virar o status num reembolso parcial e só alerta no Sentry com
  a tag `payment-webhook-partial-refund`.
- **Quem:** o fundador. Operador único, alertas por email, sem paging e sem
  rotação de plantão. Falha que começa às 02:00 é vista de manhã. Para
  pagamentos essa é a exposição aceita hoje; vale revisitar quando o volume
  tornar uma noite perdida cara.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/admin/order-refund.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/refunds.ts apps/api/src/routes/admin/index.ts packages/shared/src/admin.ts apps/api/test/admin/order-refund.test.ts docs/observability.md
git commit -m "feat(admin): reembolso assistido, pedido a Stripe sem escrever status"
```

---

### Task 9: Tela de reembolso no admin

Endpoint sem tela continua sendo "reembolse pelo dashboard da Stripe". A tela é
o que faz o fluxo existir de fato, e é o que grava o motivo no audit.

**Files:**

- Modify: a tela de detalhe de pedido do admin. **Localizar antes com
  `ls apps/admin/app/\(authed\)/` e `grep -rn "orders" apps/admin/app --include=*.tsx -l`.**
  Não presumir o caminho: este plano não verificou onde vive o detalhe de pedido,
  e `apps/admin/src/lib/finance-actions.ts` sugere que as chamadas de servidor
  ficam num módulo de actions, não no componente.
- Modify: `apps/admin/src/lib/finance-actions.ts` (ou o módulo de actions
  equivalente que a tela usar)
- Test: junto do componente, seguindo o padrão de
  `apps/admin/app/(authed)/financeiro/components/__tests__/`

**Interfaces:**

- Consumes: `POST /admin/orders/:id/refund` (Task 8).
- Produces: uma server action `requestOrderRefund(orderId: string, reason: string, amountCents?: number)`.

- [ ] **Step 1: Write the failing test**

```typescript
it('exige motivo antes de habilitar o botao de reembolso', () => {
  render(<RefundOrderForm orderId="ord_1" status="paid" provider="stripe" onDone={() => {}} />);
  const button = screen.getByRole('button', { name: 'Solicitar reembolso' });
  expect(button).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Motivo do reembolso'), {
    target: { value: 'cliente desistiu dentro dos sete dias' },
  });
  expect(button).toBeEnabled();
});

it('nao renderiza o formulario para pedido Pix', () => {
  render(
    <RefundOrderForm orderId="ord_2" status="paid" provider="abacatepay" onDone={() => {}} />,
  );
  expect(screen.queryByRole('button', { name: 'Solicitar reembolso' })).toBeNull();
  expect(screen.getByText(/suporte da AbacatePay/i)).toBeInTheDocument();
});

it('avisa que o status so muda quando o webhook chegar', () => {
  render(<RefundOrderForm orderId="ord_3" status="paid" provider="stripe" onDone={() => {}} />);
  expect(screen.getByText(/status muda quando o webhook/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm exec vitest run app`
Expected: FAIL, `RefundOrderForm` não existe.

- [ ] **Step 3: Write minimal implementation**

Um componente cliente com um `textarea` para o motivo, um campo opcional de
valor parcial, e um botão desabilitado até o motivo ter dez caracteres, que é o
mínimo que `adminOrderRefundSchema` aceita.

Três textos são obrigatórios na tela, e eles são o conteúdo, não decoração:

- Para `provider === 'abacatepay'`: nenhum botão, e a frase
  "Reembolso de Pix vai pelo suporte da AbacatePay, manualmente."
- Abaixo do botão: "O status do pedido só muda quando o webhook `charge.refunded`
  chegar. Confirme no pedido, não no dashboard."
- No campo de valor parcial: "Reembolso parcial hoje **não** vira status de
  reembolsado. O webhook só alerta. Use total, a menos que saiba o que está
  fazendo."

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && pnpm exec vitest run app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): tela de reembolso assistido no detalhe do pedido"
```

---

### Task 10: Reembolso parcial, teste de caracterização

O rastreador diz, em "Fora de escopo, registrado de propósito":

> Reembolso parcial continua ignorado. Hoje funciona por acidente, porque
> carrinho gera um único `Order`, então o refund parcial acaba sendo integral.
> Confirmar antes do go-live.

**Isso está errado, e a leitura do código de 2026-08-29 mostra outra coisa.**
`apps/api/src/routes/stripe-webhook.ts:505-516` detecta o parcial
explicitamente, **recusa** virar o status, marca o evento como processado e
emite `payment-webhook-partial-refund` no Sentry. Não é acidente e não vira
integral. É uma recusa deliberada, com o comentário de `:502-504` dizendo por
quê.

A task não conserta nada. Ela **prende o comportamento real num teste**, para
que a próxima pessoa que leia o rastreador não parta de uma premissa falsa, e
para que a recusa não seja removida por acidente numa refatoração. Confirmar por
teste é literalmente o que o Spec A pediu.

**Files:**

- Test: `apps/api/test/stripe/partial-refund.test.ts` (conferir com
  `ls apps/api/test/stripe/` onde os testes de `charge.refunded` já vivem, e
  preferir acrescentar um `describe` ao arquivo existente)
- Modify: `apps/api/src/routes/stripe-webhook.ts:502-504` (só o comentário)
- Modify: `docs/superpowers/plans/2026-08-13-pagamentos-roadmap.md:347-350`
  (corrigir a afirmação)

**Interfaces:**

- Produces: nenhuma. Task de caracterização mais correção de documento.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/stripe/partial-refund.test.ts
//
// Characterisation test. It asserts what the code DOES today, on purpose.
//
// The payments tracker claimed partial refunds "work by accident, because a
// cart produces a single Order, so a partial refund ends up being total". That
// is false. stripe-webhook.ts detects the partial explicitly and REFUSES to
// flip the status, flagging Sentry instead. These tests pin that refusal so a
// refactor cannot delete it silently, and so nobody plans against the wrong
// premise.
describe('charge.refunded — partial', () => {
  it('leaves every order in the cart `paid` on a partial refund', async () => {
    // Two orders under one cartId, one PaymentIntent, amount 12000.
    const { cartId, orderIds } = await seedPaidCart({ amountCents: 12_000 });

    const res = await postStripeWebhook(app, {
      type: 'charge.refunded',
      data: {
        object: {
          payment_intent: 'pi_partial',
          amount: 12_000,
          amount_refunded: 3_000,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ignored: true, reason: 'partial-refund' });

    const rows = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { status: true },
    });
    expect(rows.every((r) => r.status === 'paid')).toBe(true);
    void cartId;
  });

  it('leaves the tickets valid on a partial refund', async () => {
    const { orderIds } = await seedPaidCart({ amountCents: 12_000 });
    await postStripeWebhook(app, {
      type: 'charge.refunded',
      data: {
        object: { payment_intent: 'pi_partial2', amount: 12_000, amount_refunded: 3_000 },
      },
    });
    const tickets = await prisma.ticket.findMany({
      where: { orderId: { in: orderIds } },
      select: { status: true },
    });
    expect(tickets.every((t) => t.status === 'valid')).toBe(true);
  });

  it('still flips the whole cart when the refund is total', async () => {
    const { orderIds } = await seedPaidCart({ amountCents: 12_000 });
    await postStripeWebhook(app, {
      type: 'charge.refunded',
      data: {
        object: { payment_intent: 'pi_total', amount: 12_000, amount_refunded: 12_000 },
      },
    });
    const rows = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { status: true },
    });
    expect(rows.every((r) => r.status === 'refunded')).toBe(true);
  });
});
```

`seedPaidCart` e `postStripeWebhook` **não existem** com esses nomes. Ler
`apps/api/test/stripe/` e reusar o que os testes de `charge.refunded` que já
existem usam para montar carrinho pago e assinar um payload de webhook. Se não
houver helper, escrever um local no próprio arquivo. Não inventar import.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/stripe/partial-refund.test.ts`
Expected: FAIL na primeira execução, porque os helpers ainda não estão
resolvidos. Depois de fiá-los aos helpers reais, os três devem passar sem tocar
no código de produção. **Se algum falhar, o comportamento não é o que este
plano descreve, e aí a task vira investigação, não caracterização.** Reportar em
vez de "consertar" o teste.

- [ ] **Step 3: Write minimal implementation**

Nenhuma mudança de comportamento. Só o comentário de
`stripe-webhook.ts:502-504`, que hoje cita um ticket de issue e não explica a
escolha:

```typescript
// Partial refunds are refused here, deliberately, and this is asserted by
// test/stripe/partial-refund.test.ts. Flipping the order to `refunded`
// would revoke a ticket the buyer only partially got money back for; not
// flipping but writing a partial amount would need line-item attribution
// and a refundedCents column that does not exist. So: leave the row
// alone, mark the event processed, and put a human on it via Sentry
// (`payment-webhook-partial-refund`). Do not "fix" this by flipping the
// status.
```

E corrigir `docs/superpowers/plans/2026-08-13-pagamentos-roadmap.md:347-350`:

```markdown
- Reembolso parcial é **recusado**, não ignorado por acidente. Uma versão
  anterior desta linha dizia que carrinho gera um único `Order` e que por isso o
  parcial acaba integral. É falso: `stripe-webhook.ts` compara
  `amount_refunded < amount`, deixa o status intacto, marca o evento processado
  e alerta com `payment-webhook-partial-refund`. Comportamento fixado em
  `apps/api/test/stripe/partial-refund.test.ts`. Atribuição por linha e coluna
  de valor reembolsado parcial seguem fora de escopo.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/stripe/`
Expected: PASS, incluindo os testes de webhook que já existiam.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/stripe apps/api/src/routes/stripe-webhook.ts docs/superpowers/plans/2026-08-13-pagamentos-roadmap.md
git commit -m "test(stripe): fixa a recusa de reembolso parcial e corrige o rastreador"
```

---

### Task 11: Os três webhooks, fixados por teste, e o fecho dos documentos

**Leia esta seção inteira antes de escrever código. Três dos itens que o Spec A
pedia já estão feitos, e refazê-los é trabalho jogado fora.**

Verificado em 2026-08-29:

| Item do Spec A                        | Estado real                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alerta do Sentry nos três endpoints   | **Feito.** `docs/observability.md:56-65`, regra 2, já lista os três, com nota do que era antes.                                                                |
| `docs/stripe.md` reescrito            | **Feito.** O arquivo inteiro já é do Casa Car Club. §0 corrige o pin de versão, §6 mata a afirmação falsa de Stripe Tax, §2 traz a query string da AbacatePay. |
| `docs/revenuecat.md` marcado dormente | **Feito.** Bloco de aviso nas linhas 3-19, com data e motivo.                                                                                                  |

O que **não** está feito, e é o conteúdo desta task:

1. Nada no repositório garante que os três caminhos de webhook continuem sendo
   os três caminhos que a regra 2 do Sentry nomeia. A regra casa por nome de
   transaction. Renomear uma rota apaga um alerta em silêncio. Isso é código, e
   é testável.
2. `docs/stripe.md` não diz contra **qual host** registrar os endpoints. O Spec A
   levanta que o perfil `production` do `eas.json` aponta para
   `ccc-app-production.up.railway.app` e não para `api.casacar.club`, e manda
   confirmar antes de registrar webhook. Sem isso na runbook, o operador escolhe
   sozinho, no meio do go-live.
3. `docs/stripe.md` não menciona o worker de reconciliação do Pix (Task 7) nem o
   reembolso assistido (Task 8).

**Files:**

- Test: `apps/api/test/webhook-paths.test.ts`
- Modify: `docs/stripe.md` (seção 2, host; seção nova ao fim)

**Interfaces:**

- Produces: nenhuma. Teste de contorno mais documentação.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/webhook-paths.test.ts
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeApp } from './helpers.js';

/**
 * The three webhook paths are load-bearing OUTSIDE this repo.
 *
 * They are typed by hand into three provider dashboards, and Sentry alert rule
 * 2 (docs/observability.md) matches on the transaction name, which is the path.
 * Renaming a route here silently deletes an alert there, and silently 404s a
 * provider that will keep retrying for three days and then give up.
 *
 * The AbacatePay one also authenticates by query-string secret, not header
 * (routes/abacatepay-webhook.ts). Registering the URL without
 * `?webhookSecret=<value>` makes every delivery 401.
 */
const EXPECTED_WEBHOOK_PATHS = [
  'POST /stripe/webhook',
  'POST /webhooks/stripe-billing',
  'POST /abacatepay/webhook',
] as const;

describe('webhook route paths', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await makeApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers exactly the three paths the dashboards and the Sentry rule name', () => {
    const printed = app.printRoutes({ commonPrefix: false });
    for (const path of EXPECTED_WEBHOOK_PATHS) {
      const [, url] = path.split(' ');
      expect(printed, `missing webhook route ${path}`).toContain(url);
    }
  });

  it('none of the three sits behind a prefix', () => {
    const printed = app.printRoutes({ commonPrefix: false });
    expect(printed).not.toContain('/api/stripe/webhook');
    expect(printed).not.toContain('/admin/stripe/webhook');
  });
});
```

Conferir a saída de `app.printRoutes({ commonPrefix: false })` na versão do
Fastify em uso antes de confiar no formato. Se o formato de árvore não permitir
`toContain` direto, trocar por uma varredura via `app.addHook('onRoute')` num
app construído só para o teste. **Não inventar a forma da saída.**

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/webhook-paths.test.ts`
Expected: neste caso o teste pode passar de primeira, porque as três rotas já
existem. Isso é aceitável para um teste de contorno: o valor dele é falhar no
**futuro**. Provar que ele morde renomeando temporariamente `/stripe/webhook`
para `/stripe/webhook-x` em `apps/api/src/app.ts:156-159`, rodar, ver FAIL, e
desfazer.

- [ ] **Step 3: Write minimal implementation**

Nenhuma mudança de código. Documentação.

Em `docs/stripe.md`, na seção 2 (`:105-118`), acrescentar antes da tabela:

```markdown
**Contra qual host.** Confirmar o domínio que a API atende **antes** de registrar
qualquer endpoint. O perfil `production` do `apps/mobile/eas.json` aponta
`EXPO_PUBLIC_API_BASE_URL` para `https://ccc-app-production.up.railway.app`, que
é o host gerado pelo Railway, não `api.casacar.club`. Registrar os webhooks no
host gerado significa que uma troca de serviço no Railway derruba as três
entregas de uma vez, sem aviso. Registrar no domínio próprio exige que ele esteja
apontado e servindo. Escolher um, e registrar os três no mesmo.
```

E uma seção nova ao fim do arquivo:

```markdown
---

## 7. O que roda sozinho depois do go-live

Duas coisas que não são painel e que o operador precisa saber que existem.

**Reconciliação do Pix.** `apps/api/src/workers/pix-reconcile.ts` varre a cada
15 minutos os pedidos `pending` da AbacatePay com mais de 10 minutos, pergunta o
status autoritativo ao provedor e liquida os que estiverem `PAID`. Ele existe
porque um `transparent.completed` perdido deixava o Pix pago e o pedido pendente
até a varredura preguiçosa **expirar** o pedido, devolvendo o estoque à
prateleira sem emitir ingresso e sem reembolsar. Ele nunca expira e nunca
reembolsa; só liquida. Ele **não** é gateado por
`GROWTH_PREMIUM_BILLING_ENABLED`.

**Reembolso assistido.** `POST /admin/orders/:id/refund`, com tela no admin.
Pede o reembolso à Stripe e responde 202. Quem escreve `Order.status` continua
sendo o webhook `charge.refunded`. Pix responde 501: a AbacatePay não expõe API
de reembolso e o caminho é o suporte do fornecedor. Detalhes e o runbook em
`docs/observability.md`, seção "Refunds and support".
```

- [ ] **Step 4: Rodar as suítes inteiras**

Run: `cd apps/api && pnpm exec vitest run`
Expected: PASS. Docker precisa estar rodando para os Testcontainers.

Run: `cd packages/shared && pnpm exec vitest run`
Expected: PASS.

Run: `cd apps/admin && pnpm exec vitest run`
Expected: PASS.

Run: `pnpm --filter @ccc/api lint && pnpm --filter @ccc/admin lint && pnpm --filter @ccc/shared lint`
Expected: PASS. Não rodar `eslint .` na raiz; ele estoura memória.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/webhook-paths.test.ts docs/stripe.md
git commit -m "test(api): fixa os tres caminhos de webhook e documenta host e workers"
```

---

## Pré-requisitos de dono humano

Fora de escopo de engenharia, e o go-live não acontece sem eles. Listados aqui
para não se perderem entre os documentos. Nenhum vira task neste plano.

1. **Ativar a conta Stripe do CNPJ.** LIONS HUB ENGENHARIA DE SOFTWARE LTDA,
   40.142.944/0001-18. Chaves, secrets de webhook e endpoints são todos novos.
   Consequência que muda o resto: **todo `price_...` muda**, e todo `cus_`,
   `sub_` e `pi_` guardado no banco fica inválido.
2. **Criar produtos e preços live.** Um Product por plano e um por add-on. Todos
   no mesmo intervalo e moeda, senão a Stripe recusa a sessão combinada e a API
   traduz para 503. Metadata `devFeePercent` em **todo** Price de plano: omitir
   grava o split como `0` na invoice, sem alerta, e a linha da invoice é fonte da
   verdade para sempre. Metadata `baseAmountCents` igual ao `unit_amount`.
3. **Descritor de fatura da conta como `CASA CAR CLUB`**, antes da primeira
   cobrança. Nenhum criador de sessão seta `statement_descriptor` no código, então
   vale o da conta.
4. **Portal de billing habilitado**, com cancelamento ao fim do período e
   histórico de invoices.
5. **Registrar os três webhooks**, nos caminhos exatos de `docs/stripe.md` §2,
   contra o host confirmado. **O da AbacatePay precisa de `?webhookSecret=<valor>`
   na query string.** Sem isso toda entrega devolve 401 e o Pix não funciona.
   Registrar também os dois eventos de disputa no endpoint de avulso.
6. **Variáveis no Railway**, com `GROWTH_PREMIUM_BILLING_ENABLED=false` até o
   smoke de avulso passar. Não esquecer `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` e
   `_ANNUAL`: para gold, catálogo vazio cai silenciosamente no preço do env, e
   valor de test sob chave live monta checkout com preço de test.
7. **Rodar a purga e escolher o instante de corte.**
   `tsx src/scripts/purge-test-mode.ts --created-before=<ISO> --dry-run` primeiro,
   contra um dump, conferindo as contagens à mão. Falso positivo revoga
   entitlement de quem paga. **O mesmo instante alimenta o backfill da Task 3**
   (`mark-pre-cutover-orders.ts`). Anotar o valor: usar dois instantes diferentes
   nos dois scripts produz um recorte contábil que não bate com o recorte de
   dados.
8. **Nota fiscal.** Zero ocorrências no repositório. Decidir: emitir desde a
   primeira venda via integração, ou aceitar a exposição com dono e prazo
   datados.
9. **Stripe Tax.** Decisão do contador. A configuração herdada era de produto
   digital; o CCC vende físico e presencial. Stripe Tax calcula imposto e não
   emite documento fiscal brasileiro.
10. **Parcelamento no cartão.** Hoje desligado, sem `payment_method_options`. No
    Brasil, ticket acima de uns R$200 sem parcelamento converte materialmente
    pior. Decidir explicitamente e registrar a decisão.

## Notas para quem executa

- O instante de corte do item 7 acima é a única dependência real entre humano e
  código neste plano. A Task 3 entrega o script; ela não escolhe a data.
- A Task 6 e a Task 8 criam as duas primeiras escritas de admin que tocam
  dinheiro. Ambas são auditadas. Se você se pegar removendo o `recordAudit` para
  simplificar, pare: sem ele não há como responder "quem reembolsou este pedido e
  por quê".
- Três itens de documentação que o Spec A pedia já estavam feitos em 2026-08-29,
  e estão listados na tabela da Task 11. Conferir antes de reescrever.
- A afirmação do rastreador sobre reembolso parcial está errada. A Task 10
  explica por quê e corrige o documento.
