# Celebração de conquista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quando o usuário ganha uma conquista, o app escurece a tela e sobe a conquista com o texto; se o app estava fechado, chega push e o toque abre o app com a mesma animação.

**Architecture:** `GarageBadge.celebratedAt` é a fila: `null` significa "ainda não celebrada". O app busca as pendentes, anima, e faz ack. O ack carimba `celebratedAt` **e** `sentAt` das linhas de `Notification` ainda não enviadas, então o worker de push (cron de 1 min) não envia nada para quem estava com o app aberto. Quem estava fora recebe um push agrupado por usuário.

**Tech Stack:** Fastify + Prisma + Postgres (apps/api, packages/db), Zod (packages/shared), React Native / Expo com `Animated` (apps/mobile), componentes puros em packages/ui, vitest em todos.

**Spec:** `docs/superpowers/specs/2026-09-13-conquista-celebracao-design.md` — leia antes da Task 1. O plano argumenta a partir dela.

## Global Constraints

- **Branch:** `feat/conquista-celebracao`, criada de `origin/main`. Nunca commitar em `production`.
- **Idioma:** PT-BR é primário. Toda copy nova entra em `apps/mobile/src/copy/badges.ts` com espelho `en` obrigatório. Nenhuma string inline em `packages/ui`.
- **Docker precisa estar rodando** antes de qualquer teste de `apps/api`: `test/global-setup.ts` sobe Postgres via Testcontainers para a suíte inteira.
- **Rodar um arquivo de teste da API:** `cd apps/api && pnpm exec vitest run test/<caminho>`. **Nunca** `pnpm --filter @ccc/api test -- <arquivo>`: o `--` não filtra, roda os ~2253 testes (~13 min) e enterra o resultado.
- **Depois de editar qualquer coisa em `packages/shared`, rode `pnpm --filter @ccc/shared build`** antes de rodar testes de `apps/api` ou `apps/mobile`. A resolução passa por `dist/`, então o typecheck passa enquanto o teste ainda lê o schema velho.
- **Depois de editar `schema.prisma`, rode `pnpm --filter @ccc/db build`** (o `prebuild` chama `prisma generate`).
- **Baselines de lint medidos nesta branch, em `origin/main`:** `@ccc/api` 67 warnings / 0 errors. `@ccc/mobile` 75 warnings / 0 errors. `@ccc/shared` limpo. `@ccc/ui` não tem lint. Julgue seu diff por **não aumentar** nenhum dos dois números. Não rode `eslint` na raiz, ele estoura memória; lint por pacote.
- **Nunca rode `git stash`.** Este repo é compartilhado com outras sessões de agente via `.claude/worktrees/`, e um stash já destruiu trabalho de outro agente. Antes de commitar, rode `git status` e confirme que todo arquivo sujo é seu.
- **Kind canônico:** `badge_awarded`, de `BADGE_AWARDED_NOTIFICATION_KIND` em `@ccc/shared/badges-copy`. Nunca digite a string solta.
- **Teto da fila:** 10 conquistas por resposta. **Janela:** 7 dias.

---

### Task 1: Schemas compartilhados

**Files:**

- Modify: `packages/shared/src/badges.ts` (append ao fim)
- Modify: `packages/shared/src/push.ts:23-31`
- Modify: `packages/shared/src/badges-copy.ts` (append ao fim)
- Test: `packages/shared/src/__tests__/badges.test.ts` (append)

**Interfaces:**

- Consumes: `badgeCodeSchema` de `packages/shared/src/badges.ts:8`.
- Produces:
  - `badgeCelebrationSchema` → `{ code: string; earnedAt: string }`
  - `badgeCelebrationsResponseSchema` → `{ enabled: boolean; pending: BadgeCelebration[] }`, tipo `BadgeCelebrationsResponse`
  - `badgeCelebrationsAckRequestSchema` → `{ codes: string[] }` (1..10), tipo `BadgeCelebrationsAckRequest`
  - `badgeCelebrationsAckResponseSchema` → `{ acked: number }`, tipo `BadgeCelebrationsAckResponse`
  - `CELEBRATION_PAGE_SIZE = 10`, `CELEBRATION_WINDOW_DAYS = 7`
  - `BADGE_AWARDED_GROUP_NOTIFICATION_TITLE`, `badgeAwardedGroupBody(count)`
  - `'badge_awarded'` aceito por `pushKindSchema`

- [ ] **Step 1: Escreva o teste que falha**

Em `packages/shared/src/__tests__/badges.test.ts`, adicione ao fim:

```ts
import {
  badgeCelebrationsAckRequestSchema,
  badgeCelebrationsResponseSchema,
  CELEBRATION_PAGE_SIZE,
  CELEBRATION_WINDOW_DAYS,
} from '../badges.js';
import { pushKindSchema } from '../push.js';
import { badgeAwardedGroupBody } from '../badges-copy.js';

describe('celebrações', () => {
  it('aceita uma resposta de pendentes', () => {
    const parsed = badgeCelebrationsResponseSchema.parse({
      enabled: true,
      pending: [{ code: 'EVT-001', earnedAt: '2026-09-13T12:00:00.000Z' }],
    });
    expect(parsed.pending[0]!.code).toBe('EVT-001');
  });

  it('recusa código fora do formato de wire', () => {
    expect(() =>
      badgeCelebrationsResponseSchema.parse({
        enabled: true,
        pending: [{ code: 'evt-1', earnedAt: '2026-09-13T12:00:00.000Z' }],
      }),
    ).toThrow();
  });

  it('limita o ack ao tamanho da página e recusa lista vazia', () => {
    expect(() => badgeCelebrationsAckRequestSchema.parse({ codes: [] })).toThrow();
    const tooMany = Array.from({ length: CELEBRATION_PAGE_SIZE + 1 }, () => 'EVT-001');
    expect(() => badgeCelebrationsAckRequestSchema.parse({ codes: tooMany })).toThrow();
    expect(badgeCelebrationsAckRequestSchema.parse({ codes: ['EVT-001'] }).codes).toHaveLength(1);
  });

  it('fixa a janela em 7 dias', () => {
    expect(CELEBRATION_WINDOW_DAYS).toBe(7);
  });

  it('aceita badge_awarded como kind de push', () => {
    expect(pushKindSchema.parse('badge_awarded')).toBe('badge_awarded');
  });

  it('pluraliza o corpo do push agrupado', () => {
    expect(badgeAwardedGroupBody(3)).toBe('Você ganhou 3 conquistas.');
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

```bash
cd packages/shared && pnpm exec vitest run src/__tests__/badges.test.ts
```

Esperado: FAIL, `badgeCelebrationsResponseSchema is not exported`.

- [ ] **Step 3: Implemente**

Ao fim de `packages/shared/src/badges.ts`:

```ts
// Fila de celebração. `celebratedAt: null` no banco é a fila; o wire carrega
// só o código e quando foi ganha — título, descrição, raridade e ícone vêm do
// catálogo, que é editável pelo admin. Duplicar copy aqui criaria uma segunda
// fonte que sai de sincronia com /configuracoes/conquistas.
export const CELEBRATION_PAGE_SIZE = 10;

// Janela de skew de versão de app: a API entra antes do app, e um build antigo
// nunca chama o ack. Sem a janela, esse usuário atualiza semanas depois e
// recebe a fila histórica inteira de uma vez.
export const CELEBRATION_WINDOW_DAYS = 7;

export const badgeCelebrationSchema = z.object({
  code: badgeCodeSchema,
  earnedAt: z.string().datetime(),
});
export type BadgeCelebration = z.infer<typeof badgeCelebrationSchema>;

export const badgeCelebrationsResponseSchema = z.object({
  enabled: z.boolean(),
  pending: z.array(badgeCelebrationSchema),
});
export type BadgeCelebrationsResponse = z.infer<typeof badgeCelebrationsResponseSchema>;

export const badgeCelebrationsAckRequestSchema = z.object({
  codes: z.array(badgeCodeSchema).min(1).max(CELEBRATION_PAGE_SIZE),
});
export type BadgeCelebrationsAckRequest = z.infer<typeof badgeCelebrationsAckRequestSchema>;

export const badgeCelebrationsAckResponseSchema = z.object({
  acked: z.number().int().nonnegative(),
});
export type BadgeCelebrationsAckResponse = z.infer<typeof badgeCelebrationsAckResponseSchema>;
```

Em `packages/shared/src/push.ts`, acrescente `'badge_awarded'` ao `pushKindSchema`:

```ts
export const pushKindSchema = z.enum([
  'ticket.confirmed',
  'event.reminder_24h',
  'event.reminder_1h',
  'broadcast',
  'box.paid',
  'box.ready',
  'box.shipped',
  'box.delivered',
  'badge_awarded',
]);
```

Ao fim de `packages/shared/src/badges-copy.ts`:

```ts
/** Título do push quando mais de uma conquista cai no mesmo tick. */
export const BADGE_AWARDED_GROUP_NOTIFICATION_TITLE = 'Novas conquistas!';

/** Corpo do push agrupado. `count` é sempre >= 2 no uso real. */
export const badgeAwardedGroupBody = (count: number): string => `Você ganhou ${count} conquistas.`;
```

- [ ] **Step 4: Rode o teste e confirme que passa**

```bash
cd packages/shared && pnpm exec vitest run src/__tests__/badges.test.ts
pnpm --filter @ccc/shared build
```

Esperado: PASS. O build é obrigatório: as tasks seguintes leem `dist/`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/badges.ts packages/shared/src/push.ts packages/shared/src/badges-copy.ts packages/shared/src/__tests__/badges.test.ts
git commit -m "feat(conquistas): schemas da fila de celebracao e kind de push"
```

---

### Task 2: Campo e migrations

**Files:**

- Modify: `packages/db/prisma/schema.prisma:347-364`
- Create: `packages/db/prisma/migrations/20260913130000_badge_celebrated_at/migration.sql`
- Create: `packages/db/prisma/migrations/20260913130100_badge_celebration_backfill/migration.sql`

**Interfaces:**

- Produces: `GarageBadge.celebratedAt: Date | null` no cliente Prisma, e o índice `GarageBadge_garageId_celebratedAt_idx`.

- [ ] **Step 1: Conte as linhas afetadas antes de escrever qualquer SQL**

Contra o banco de desenvolvimento:

```bash
cd packages/db && pnpm exec prisma studio
```

Ou, mais direto, anote as duas contagens para levar ao PR:

```sql
SELECT count(*) FROM "GarageBadge";
SELECT count(*) FROM "Notification" WHERE kind = 'badge_awarded' AND "sentAt" IS NULL;
```

A segunda é a que ninguém sabe hoje e é o motivo do arquivo 2. Registre os dois números no corpo do PR.

- [ ] **Step 2: Edite o schema**

Em `packages/db/prisma/schema.prisma`, dentro de `model GarageBadge`, depois de `sourceRef`:

```prisma
  // `null` = pendente de celebração. É a fila inteira; não há tabela nova.
  // Carimbado pelo ack do app (POST /me/garage/badges/celebrations/ack) ou
  // pela própria rota de leitura, para linhas mais velhas que a janela.
  celebratedAt DateTime?
```

e acrescente o índice junto dos existentes:

```prisma
  @@index([garageId, celebratedAt])
```

- [ ] **Step 3: Gere a migration de DDL sem aplicar**

```bash
cd packages/db && pnpm exec prisma migrate dev --create-only --name badge_celebrated_at
```

Renomeie a pasta gerada para `20260913130000_badge_celebrated_at` se o timestamp divergir, e confira que o SQL contém **apenas** o `ALTER TABLE ... ADD COLUMN` e o `CREATE INDEX`, com o `CREATE INDEX` por último. Nenhum `UPDATE` neste arquivo.

Acrescente o comentário no topo do arquivo:

```sql
-- DDL apenas, de propósito. ADD COLUMN pega ACCESS EXCLUSIVE e segura até o
-- commit; o Prisma roda o arquivo inteiro numa transação. Um UPDATE de tabela
-- inteira aqui faria a reescrita toda dentro do lock, e check-in e
-- POST /me/cars (Serializable, timeout 15s, 3 tentativas) bloqueariam na fila
-- de lock até estourar. Coluna anulável sem default é metadata-only no PG 11+,
-- então este lock é instantâneo. Os backfills vivem na migration seguinte.
```

- [ ] **Step 4: Escreva a migration de backfill à mão**

Crie `packages/db/prisma/migrations/20260913130100_badge_celebration_backfill/migration.sql`:

```sql
-- Dois backfills, fora do lock de DDL do arquivo anterior.
--
-- 1. Fecha a fila de celebração de todo mundo que já existe. Sem isso, todo
--    usuário com conquistas abre o app depois do deploy e recebe a fila
--    histórica inteira de uma vez.
--
-- 2. Fecha a fila de PUSH, que é o mesmo problema uma tabela adiante e é fácil
--    de esquecer. Toda linha `badge_awarded` já escrita tem sentAt = null de
--    propósito (services/garage/awarder.ts nunca carimbou), e a query do
--    worker não tem piso de createdAt. No primeiro tick depois de
--    `badge_awarded` entrar em DELIVERABLE_KINDS, toda linha histórica do
--    grant manual do admin viraria push de conquista ganha há meses — e o
--    backfill acima acabou de garantir que não haveria animação nenhuma ao
--    abrir o app. Mesmo remédio de 20260816000000_notification_delivery_state.
--
-- O `WHERE ... IS NULL` não é cosmético: torna os dois statements
-- re-executáveis se a migration falhar no meio.

UPDATE "GarageBadge" SET "celebratedAt" = "earnedAt" WHERE "celebratedAt" IS NULL;

UPDATE "Notification" SET "sentAt" = "createdAt"
WHERE "kind" = 'badge_awarded' AND "sentAt" IS NULL;
```

- [ ] **Step 5: Aplique e regenere o cliente**

```bash
cd packages/db && pnpm exec prisma migrate dev
pnpm --filter @ccc/db build
```

Esperado: as duas migrations aplicam sem erro e `prisma generate` roda.

- [ ] **Step 6: Confirme que a coluna existe e que o backfill pegou**

```bash
cd apps/api && pnpm exec vitest run test/garage/awarder-savepoint.test.ts
```

Esperado: PASS. É o teste existente mais próximo do awarder e prova que o cliente regenerado ainda casa com o código.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(conquistas): celebratedAt em GarageBadge, com backfill das duas filas"
```

---

### Task 3: Awarder notifica em todos os caminhos

**Files:**

- Modify: `apps/api/src/services/garage/awarder.ts:45-59` (doc do campo), `:158` (default), `:172-200` (destination)
- Modify: `apps/api/test/admin/badge-notification.test.ts:131` e `:256` (invertendo os dois testes)

**Interfaces:**

- Consumes: `BADGE_AWARDED_NOTIFICATION_KIND`, `badgeAwardedDedupeKey` de `@ccc/shared/badges-copy`.
- Produces: toda concessão bem-sucedida passa a criar uma linha de `Notification` com `destination: { kind: 'internal_path', path: '/garage' }`, a menos que o chamador passe `notifyOnGrant: false`.

- [ ] **Step 1: Inverta os dois testes existentes**

Em `apps/api/test/admin/badge-notification.test.ts`, troque o teste da linha 131. O nome e a asserção mudam:

```ts
it('auto-award (write-path hook) mints a notification', async () => {
  const { user, tokens } = await createUser({ verified: true });
  const res = await app.inject({
    method: 'POST',
    url: '/me/cars',
    headers: bearer(tokens.accessToken),
    payload: { make: 'Honda', model: 'Civic', year: 2004 },
  });
  expect(res.statusCode).toBe(201);

  const inbox = await prisma.notification.count({
    where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
  });
  expect(inbox).toBe(1);
});

it('reavaliar a superficie nao cria segunda notificacao', async () => {
  const { user, tokens } = await createUser({ verified: true });
  for (const model of ['Civic', 'Integra']) {
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: bearer(tokens.accessToken),
      payload: { make: 'Honda', model, year: 2004 },
    });
    expect(res.statusCode).toBe(201);
  }
  // O segundo carro reencontra CAR-001. O create estoura P2002 e o controle
  // pula para o catch de fora, entao o bloco de notificacao e inalcancavel.
  // Este teste e a trava contra alguem hoistar a notificacao para fora do try.
  const inbox = await prisma.notification.count({
    where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
  });
  expect(inbox).toBe(1);
});
```

E o da linha 256:

```ts
it('awarder service: default opts mints inbox row', async () => {
  const { user } = await createUser({ verified: true });
  const gid = await garageId(user.id);
  await prisma.$transaction(async (tx) => {
    await awardBadge(tx, gid, 'EVT-001', 'test:default');
  });
  const row = await prisma.notification.findFirstOrThrow({
    where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
  });
  expect(row.dedupeKey).toBe(badgeAwardedDedupeKey('EVT-001', user.id));
  expect(row.destination).toEqual({ kind: 'internal_path', path: '/garage' });
});
```

Atualize também o comentário de contrato no topo do arquivo (`:14-17`), que hoje diz que os hooks de write NÃO podem notificar.

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd apps/api && pnpm exec vitest run test/admin/badge-notification.test.ts
```

Esperado: FAIL nos três, `expected 0 to be 1` e `expected null to equal { kind: ... }`.

- [ ] **Step 3: Implemente**

Em `apps/api/src/services/garage/awarder.ts`, troque a doc do campo `notifyOnGrant` (linhas 45-58) por:

```ts
  /**
   * Emit an in-app Notification row for the garage owner on a successful
   * award. Default `true`: é assim que a celebração chega ao usuário.
   *
   * Um caminho futuro de concessão em massa (recompute retroativo, por
   * exemplo) PRECISA passar `false` explícito, senão notifica a base inteira
   * de uma vez.
   *
   * Idempotência: a linha usa `dedupeKey = badge:${code}:${userId}` contra o
   * `@@unique([userId, kind, dedupeKey])`. Reavaliação da superfície não passa
   * por aqui: o P2002 do `garageBadge.create` já desviou para o catch de fora.
   */
  notifyOnGrant?: boolean;
```

Troque a condição (linha 158 na versão atual):

```ts
    if (opts.notifyOnGrant ?? true) {
```

E acrescente `destination` ao `create`:

```ts
await tx.notification.create({
  data: {
    userId: garage.userId,
    kind: BADGE_AWARDED_NOTIFICATION_KIND,
    title: BADGE_AWARDED_NOTIFICATION_TITLE,
    body: badge.title,
    data: { kind: BADGE_AWARDED_NOTIFICATION_KIND, code } as Prisma.InputJsonValue,
    destination: { kind: 'internal_path', path: '/garage' } as Prisma.InputJsonValue,
    dedupeKey: badgeAwardedDedupeKey(code, garage.userId),
  },
});
```

Ajuste o comentário do bloco (linhas 163-166), que hoje diz que só o admin opta por notificar.

- [ ] **Step 4: Rode e confirme que passa**

```bash
cd apps/api && pnpm exec vitest run test/admin/badge-notification.test.ts test/garage/awarder-savepoint.test.ts
```

Esperado: PASS em todos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/garage/awarder.ts apps/api/test/admin/badge-notification.test.ts
git commit -m "feat(conquistas): notifica em todo caminho de concessao"
```

---

### Task 4: Rota de leitura da fila

**Files:**

- Modify: `apps/api/src/routes/garage.ts` (novo bloco de escopo depois do de `/me/garage/badges`, que termina na linha 380)
- Create: `apps/api/test/garage/celebrations.test.ts`

**Interfaces:**

- Consumes: `badgeCelebrationsResponseSchema`, `CELEBRATION_PAGE_SIZE`, `CELEBRATION_WINDOW_DAYS` (Task 1); `GarageBadge.celebratedAt` (Task 2); `ensureGarageForUser` e `readGamificationEnabled`, já importados no topo de `garage.ts`.
- Produces: `GET /me/garage/badges/celebrations`.

- [ ] **Step 1: Escreva o teste que falha**

Crie `apps/api/test/garage/celebrations.test.ts`:

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const seedCatalog = async () => {
  await prisma.badge.createMany({
    data: [
      {
        code: 'EVT-001',
        category: 'eventos',
        rarity: 'common',
        icon: 'flag',
        title: 'A',
        description: 'a',
      },
      {
        code: 'CAR-001',
        category: 'carros',
        rarity: 'common',
        icon: 'car',
        title: 'B',
        description: 'b',
      },
    ],
  });
};

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('GET /me/garage/badges/celebrations', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalog();
    app = await makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('devolve so as pendentes, em ordem determinista', async () => {
    const { user, tokens } = await createUser({ verified: true });
    const gid = await garageId(user.id);
    const earnedAt = new Date('2026-09-13T12:00:00.000Z');
    // earnedAt identico de proposito: e o que acontece quando duas conquistas
    // caem na mesma transacao, porque now() no Postgres e o inicio da transacao.
    await prisma.garageBadge.createMany({
      data: [
        { garageId: gid, badgeCode: 'EVT-001', earnedAt },
        { garageId: gid, badgeCode: 'CAR-001', earnedAt },
      ],
    });
    await prisma.garageBadge.update({
      where: { garageId_badgeCode: { garageId: gid, badgeCode: 'EVT-001' } },
      data: { celebratedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges/celebrations',
      headers: bearer(tokens.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; pending: { code: string }[] };
    expect(body.enabled).toBe(true);
    expect(body.pending.map((p) => p.code)).toEqual(['CAR-001']);
  });

  it('desempata por badgeCode quando earnedAt empata', async () => {
    const { user, tokens } = await createUser({ verified: true });
    const gid = await garageId(user.id);
    const earnedAt = new Date('2026-09-13T12:00:00.000Z');
    await prisma.garageBadge.createMany({
      data: [
        { garageId: gid, badgeCode: 'EVT-001', earnedAt },
        { garageId: gid, badgeCode: 'CAR-001', earnedAt },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges/celebrations',
      headers: bearer(tokens.accessToken),
    });
    expect((res.json() as { pending: { code: string }[] }).pending.map((p) => p.code)).toEqual([
      'CAR-001',
      'EVT-001',
    ]);
  });

  it('carimba e omite pendentes mais velhas que a janela de 7 dias', async () => {
    const { user, tokens } = await createUser({ verified: true });
    const gid = await garageId(user.id);
    const velha = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.garageBadge.create({
      data: { garageId: gid, badgeCode: 'EVT-001', earnedAt: velha },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges/celebrations',
      headers: bearer(tokens.accessToken),
    });
    expect((res.json() as { pending: unknown[] }).pending).toHaveLength(0);

    const row = await prisma.garageBadge.findUniqueOrThrow({
      where: { garageId_badgeCode: { garageId: gid, badgeCode: 'EVT-001' } },
    });
    // Autolimpeza: a propria rota fecha o rabo da fila, sem worker.
    expect(row.celebratedAt).not.toBeNull();
  });

  it('devolve enabled false com o killswitch desligado', async () => {
    await prisma.generalSettings.updateMany({ data: { gamificationEnabled: false } });
    const { tokens } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges/celebrations',
      headers: bearer(tokens.accessToken),
    });
    expect(res.json()).toEqual({ enabled: false, pending: [] });
  });
});
```

Se `generalSettings.updateMany` não for como o killswitch é desligado neste repo, abra `apps/api/src/services/garage/killswitch.ts` e espelhe a leitura; há testes existentes que já desligam o killswitch em `apps/api/test/garage/`.

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd apps/api && pnpm exec vitest run test/garage/celebrations.test.ts
```

Esperado: FAIL com 404 em todos.

- [ ] **Step 3: Implemente**

Em `apps/api/src/routes/garage.ts`, logo depois do bloco que registra `/me/garage/badges` (que fecha na linha 380), acrescente:

```ts
// GET /me/garage/badges/celebrations — fila de celebração pendente.
// 60/min/usuário, mesmo teto do read de badges.
await app.register(async (scoped) => {
  scoped.addHook('preHandler', app.authenticate);
  await scoped.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request) => {
      const user = request.user as { sub: string } | undefined;
      return `me-garage-celebrations:${user?.sub ?? request.ip}`;
    },
  });

  scoped.get('/me/garage/badges/celebrations', async (request) => {
    const { sub } = requireUser(request);
    const enabled = await readGamificationEnabled();
    if (!enabled) {
      return badgeCelebrationsResponseSchema.parse({ enabled: false, pending: [] });
    }

    const garage = await ensureGarageForUser(sub);
    const cutoff = new Date(Date.now() - CELEBRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Autolimpeza do rabo da fila. A API entra antes do app, então um build
    // antigo nunca chama o ack e deixa tudo que ganhar em `null`. Sem isto,
    // esse usuário atualiza semanas depois e toma a fila histórica inteira —
    // o mesmo problema que o backfill resolveu, reaberto pela porta dos
    // fundos. Fica aqui, e não num worker, porque é barato e auto-contido.
    await prisma.garageBadge.updateMany({
      where: { garageId: garage.id, celebratedAt: null, earnedAt: { lt: cutoff } },
      data: { celebratedAt: new Date() },
    });

    const rows = await prisma.garageBadge.findMany({
      where: { garageId: garage.id, celebratedAt: null, earnedAt: { gte: cutoff } },
      // Ordenação TOTAL. `@default(now())` no Postgres é o início da
      // transação, então conquistas da mesma transação empatam em `earnedAt`
      // exatamente; sem o desempate por código a ordem varia entre chamadas.
      orderBy: [{ earnedAt: 'asc' }, { badgeCode: 'asc' }],
      take: CELEBRATION_PAGE_SIZE,
      select: { badgeCode: true, earnedAt: true },
    });

    return badgeCelebrationsResponseSchema.parse({
      enabled: true,
      pending: rows.map((r) => ({ code: r.badgeCode, earnedAt: r.earnedAt.toISOString() })),
    });
  });
});
```

Acrescente ao import de `@ccc/shared/badges` no topo do arquivo: `badgeCelebrationsResponseSchema`, `CELEBRATION_PAGE_SIZE`, `CELEBRATION_WINDOW_DAYS`.

- [ ] **Step 4: Rode e confirme que passa**

```bash
cd apps/api && pnpm exec vitest run test/garage/celebrations.test.ts
```

Esperado: PASS nos quatro.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/garage.ts apps/api/test/garage/celebrations.test.ts
git commit -m "feat(conquistas): rota de leitura da fila de celebracao"
```

---

### Task 5: Rota de ack, que também cancela o push

**Files:**

- Modify: `apps/api/src/routes/garage.ts` (novo bloco de escopo, depois do da Task 4)
- Modify: `apps/api/test/garage/celebrations.test.ts` (append de um `describe`)

**Interfaces:**

- Consumes: `badgeCelebrationsAckRequestSchema`, `badgeCelebrationsAckResponseSchema` (Task 1); `badgeAwardedDedupeKey`, `BADGE_AWARDED_NOTIFICATION_KIND` de `@ccc/shared/badges-copy`.
- Produces: `POST /me/garage/badges/celebrations/ack`.

- [ ] **Step 1: Escreva o teste que falha**

Append em `apps/api/test/garage/celebrations.test.ts`:

```ts
describe('POST /me/garage/badges/celebrations/ack', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalog();
    app = await makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const ack = (token: string, codes: string[]) =>
    app.inject({
      method: 'POST',
      url: '/me/garage/badges/celebrations/ack',
      headers: bearer(token),
      payload: { codes },
    });

  it('carimba celebratedAt e e idempotente', async () => {
    const { user, tokens } = await createUser({ verified: true });
    const gid = await garageId(user.id);
    await prisma.garageBadge.create({ data: { garageId: gid, badgeCode: 'EVT-001' } });

    const first = await ack(tokens.accessToken, ['EVT-001']);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ acked: 1 });

    const second = await ack(tokens.accessToken, ['EVT-001']);
    expect(second.json()).toEqual({ acked: 0 });
  });

  it('carimba sentAt das notificacoes ainda nao enviadas', async () => {
    const { user, tokens } = await createUser({ verified: true });
    const gid = await garageId(user.id);
    await prisma.garageBadge.create({ data: { garageId: gid, badgeCode: 'EVT-001' } });
    await prisma.notification.create({
      data: {
        userId: user.id,
        kind: BADGE_AWARDED_NOTIFICATION_KIND,
        title: 'Nova conquista!',
        body: 'A',
        data: {},
        dedupeKey: badgeAwardedDedupeKey('EVT-001', user.id),
      },
    });

    await ack(tokens.accessToken, ['EVT-001']);

    const n = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: BADGE_AWARDED_NOTIFICATION_KIND },
    });
    // E isto que entrega "sem push quando o app esta aberto": o worker e cron
    // de 1 min, o ack chega antes, e nao sobra o que enviar.
    expect(n.sentAt).not.toBeNull();
  });

  it('ignora codigo que o usuario nao tem', async () => {
    const { tokens } = await createUser({ verified: true });
    const res = await ack(tokens.accessToken, ['CAR-001']);
    expect(res.json()).toEqual({ acked: 0 });
  });

  it('nao toca na conquista de outro usuario', async () => {
    const alvo = await createUser({ verified: true });
    const gidAlvo = await garageId(alvo.user.id);
    await prisma.garageBadge.create({ data: { garageId: gidAlvo, badgeCode: 'EVT-001' } });

    const intruso = await createUser({ verified: true });
    await ack(intruso.tokens.accessToken, ['EVT-001']);

    const row = await prisma.garageBadge.findUniqueOrThrow({
      where: { garageId_badgeCode: { garageId: gidAlvo, badgeCode: 'EVT-001' } },
    });
    expect(row.celebratedAt).toBeNull();
  });

  it('recusa corpo invalido', async () => {
    const { tokens } = await createUser({ verified: true });
    expect((await ack(tokens.accessToken, [])).statusCode).toBe(400);
    expect((await ack(tokens.accessToken, ['nao-e-codigo'])).statusCode).toBe(400);
  });
});
```

Acrescente ao import do topo do arquivo:

```ts
import { BADGE_AWARDED_NOTIFICATION_KIND, badgeAwardedDedupeKey } from '@ccc/shared/badges-copy';
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd apps/api && pnpm exec vitest run test/garage/celebrations.test.ts
```

Esperado: FAIL com 404 nos cinco novos.

- [ ] **Step 3: Implemente**

Em `apps/api/src/routes/garage.ts`, depois do bloco da Task 4:

```ts
// POST /me/garage/badges/celebrations/ack — 20/min/usuário.
await app.register(async (scoped) => {
  scoped.addHook('preHandler', app.authenticate);
  await scoped.register(rateLimit, {
    max: 20,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request) => {
      const user = request.user as { sub: string } | undefined;
      return `me-garage-celebrations-ack:${user?.sub ?? request.ip}`;
    },
  });

  scoped.post('/me/garage/badges/celebrations/ack', async (request, reply) => {
    const { sub } = requireUser(request);
    const parsed = badgeCelebrationsAckRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body' });
    const { codes } = parsed.data;

    const garage = await ensureGarageForUser(sub);
    const now = new Date();

    const acked = await prisma.$transaction(async (tx) => {
      const stamped = await tx.garageBadge.updateMany({
        where: { garageId: garage.id, badgeCode: { in: codes }, celebratedAt: null },
        data: { celebratedAt: now },
      });

      // Cancela o push. O worker é cron de 1 min: a linha nasce em t=0 e só
      // seria enviada em t<=60s. Um app em foreground já buscou, celebrou e
      // chegou aqui antes disso, então carimbar sentAt faz o worker não ter
      // o que enviar. É assim que "sem push com o app aberto" é decidido no
      // servidor, sem rastrear presença.
      await tx.notification.updateMany({
        where: {
          userId: sub,
          kind: BADGE_AWARDED_NOTIFICATION_KIND,
          sentAt: null,
          dedupeKey: { in: codes.map((c) => badgeAwardedDedupeKey(c, sub)) },
        },
        data: { sentAt: now },
      });

      return stamped.count;
    });

    return badgeCelebrationsAckResponseSchema.parse({ acked });
  });
});
```

Acrescente aos imports do topo: `badgeCelebrationsAckRequestSchema`, `badgeCelebrationsAckResponseSchema` de `@ccc/shared/badges`, e `BADGE_AWARDED_NOTIFICATION_KIND`, `badgeAwardedDedupeKey` de `@ccc/shared/badges-copy`.

- [ ] **Step 4: Rode e confirme que passa**

```bash
cd apps/api && pnpm exec vitest run test/garage/celebrations.test.ts
```

Esperado: PASS nos nove.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/garage.ts apps/api/test/garage/celebrations.test.ts
git commit -m "feat(conquistas): ack da celebracao cancela o push pendente"
```

---

### Task 6: Entrega agrupada de push

**Files:**

- Create: `apps/api/src/services/push/grouped.ts`
- Modify: `apps/api/src/workers/notification-delivery.ts:8-23` e `:30-60`
- Modify: `apps/api/test/workers/notification-delivery.test.ts:70`
- Create: `apps/api/test/workers/badge-delivery.test.ts`

**Interfaces:**

- Consumes: `PushSender`, `PushMessage` de `../services/push/types.js`; `readGamificationEnabled` de `../services/garage/killswitch.js`; `BADGE_AWARDED_NOTIFICATION_KIND`, `BADGE_AWARDED_NOTIFICATION_TITLE`, `BADGE_AWARDED_GROUP_NOTIFICATION_TITLE`, `badgeAwardedGroupBody`.
- Produces: `deliverGroupedNotifications(input, deps)` em `grouped.ts`, com `input: { userId, notificationIds, title, body, data }` e retorno `{ sent, invalidatedTokens, delivered }`.

- [ ] **Step 1: Escreva o teste que falha**

Crie `apps/api/test/workers/badge-delivery.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { BADGE_AWARDED_NOTIFICATION_KIND } from '@ccc/shared/badges-copy';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { runNotificationDeliveryTick } from '../../src/workers/notification-delivery.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedBadgeNotification = async (userId: string, code: string) => {
  await prisma.notification.create({
    data: {
      userId,
      kind: BADGE_AWARDED_NOTIFICATION_KIND,
      title: 'Nova conquista!',
      body: `Título de ${code}`,
      data: { kind: BADGE_AWARDED_NOTIFICATION_KIND, code },
      dedupeKey: `badge:${code}:${userId}`,
    },
  });
};

const seedUserWithToken = async (token: string) => {
  const { user } = await createUser({ verified: true });
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: token, platform: 'ios' },
  });
  return user;
};

describe('entrega de badge_awarded', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('manda um push so para N conquistas do mesmo usuario', async () => {
    const user = await seedUserWithToken('ExponentPushToken[bgrp111111]');
    for (const code of ['EVT-001', 'CAR-001', 'COM-001']) {
      await seedBadgeNotification(user.id, code);
    }
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });

    // Tres linhas na central, um push so. Tres vibracoes no portao do evento
    // e o que este agrupamento existe para evitar.
    expect(sender.captured.length).toBe(1);
    expect(sender.captured[0]!.body).toContain('3');
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.sentAt !== null)).toBe(true);
  });

  it('usa o corpo da propria conquista quando e so uma', async () => {
    const user = await seedUserWithToken('ExponentPushToken[bone111111]');
    await seedBadgeNotification(user.id, 'EVT-001');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    expect(sender.captured.length).toBe(1);
    expect(sender.captured[0]!.body).toBe('Título de EVT-001');
  });

  it('nao entrega com o killswitch desligado, e nao queima a linha', async () => {
    await prisma.generalSettings.updateMany({ data: { gamificationEnabled: false } });
    const user = await seedUserWithToken('ExponentPushToken[bks1111111]');
    await seedBadgeNotification(user.id, 'EVT-001');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    expect(sender.captured.length).toBe(0);
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.sentAt).toBeNull();
  });

  it('respeita pushPrefs.transactional false', async () => {
    const user = await seedUserWithToken('ExponentPushToken[bpref11111]');
    await prisma.user.update({
      where: { id: user.id },
      data: { pushPrefs: { transactional: false, marketing: false } },
    });
    await seedBadgeNotification(user.id, 'EVT-001');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    expect(sender.captured.length).toBe(0);
    // A linha da central existe de qualquer jeito: a preferencia governa o
    // push, nao o inbox. Carimbada para nao voltar em todo tick.
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.sentAt).not.toBeNull();
  });

  it('nao mistura usuarios no mesmo push', async () => {
    const a = await seedUserWithToken('ExponentPushToken[bmixa11111]');
    const b = await seedUserWithToken('ExponentPushToken[bmixb11111]');
    await seedBadgeNotification(a.id, 'EVT-001');
    await seedBadgeNotification(b.id, 'CAR-001');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    expect(sender.captured.length).toBe(2);
  });
});
```

E em `apps/api/test/workers/notification-delivery.test.ts:70`, o teste existente `never delivers non-owned kinds (broadcast, badge_awarded)` precisa perder `badge_awarded`. Renomeie para `never delivers broadcast` e remova a linha que semeia a notificação de conquista.

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd apps/api && pnpm exec vitest run test/workers/badge-delivery.test.ts
```

Esperado: FAIL, `expected 0 to be 1` — o kind ainda não é entregável.

- [ ] **Step 3: Implemente a entrega agrupada**

Crie `apps/api/src/services/push/grouped.ts`:

```ts
import { prisma } from '@ccc/db';

import type { PushMessage, PushSender } from './types.js';

export type GroupedDeliveryInput = {
  userId: string;
  notificationIds: string[];
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export type GroupedDeliveryResult = {
  sent: number;
  invalidatedTokens: number;
  delivered: boolean;
};

/**
 * Entrega N linhas de Notification como UM push.
 *
 * Existe porque o awarder é por código e os hooks iteram uma lista: um
 * check-in que destrava três conquistas cria três linhas com `dedupeKey`
 * diferentes, e o índice único não as funde. Entregar linha a linha seriam
 * três vibrações no portão do evento, com o mesmo título nas três.
 *
 * A reivindicação é um `updateMany` sobre o grupo, mais fraca que o
 * compare-and-swap por linha de `deliverNotification`: duas réplicas que
 * observem o mesmo grupo podem ambas reivindicar. O que fecha isso na prática
 * é a guarda de não-sobreposição do worker. A troca é consciente: duplicar um
 * push de celebração é barato, e o alvo aqui é não vibrar N vezes.
 */
export const deliverGroupedNotifications = async (
  input: GroupedDeliveryInput,
  deps: { sender: PushSender; now?: Date },
): Promise<GroupedDeliveryResult> => {
  const now = deps.now ?? new Date();

  const claim = await prisma.notification.updateMany({
    where: { id: { in: input.notificationIds }, sentAt: null },
    data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
  });
  if (claim.count === 0) return { sent: 0, invalidatedTokens: 0, delivered: true };

  const markSent = async () => {
    await prisma.notification.updateMany({
      where: { id: { in: input.notificationIds }, sentAt: null },
      data: { sentAt: now, failureCode: null },
    });
  };

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: input.userId },
    select: { expoPushToken: true },
  });
  if (tokens.length === 0) {
    await markSent();
    return { sent: 0, invalidatedTokens: 0, delivered: true };
  }

  const messages: PushMessage[] = tokens.map((t) => ({
    to: t.expoPushToken,
    title: input.title,
    body: input.body,
    data: input.data,
  }));

  const result = await deps.sender.send(messages);

  let sent = 0;
  const invalid: string[] = [];
  let hasError = false;
  for (const [token, outcome] of result.outcomesByToken) {
    if (outcome.kind === 'ok') sent += 1;
    else if (outcome.kind === 'invalid-token') invalid.push(token);
    else hasError = true;
  }

  if (invalid.length > 0) {
    await prisma.deviceToken.deleteMany({
      where: { userId: input.userId, expoPushToken: { in: invalid } },
    });
  }

  if (sent > 0 || !hasError) {
    await markSent();
    return { sent, invalidatedTokens: invalid.length, delivered: true };
  }

  await prisma.notification.updateMany({
    where: { id: { in: input.notificationIds }, sentAt: null },
    data: { failureCode: 'send_error' },
  });
  return { sent, invalidatedTokens: invalid.length, delivered: false };
};

/** Carimba o grupo como resolvido sem enviar nada. Usado pelo gate de preferência. */
export const suppressGroup = async (notificationIds: string[], now: Date): Promise<void> => {
  await prisma.notification.updateMany({
    where: { id: { in: notificationIds }, sentAt: null },
    data: { sentAt: now, failureCode: null },
  });
};
```

- [ ] **Step 4: Ligue o worker**

Em `apps/api/src/workers/notification-delivery.ts`, acrescente `badge_awarded` a `DELIVERABLE_KINDS` e corrija o comentário de bloco acima dele, que hoje afirma que `badge_awarded` é inbox-only. Depois, no corpo de `runNotificationDeliveryTick`, separe o kind:

```ts
const BADGE_KIND = BADGE_AWARDED_NOTIFICATION_KIND;

const transactionalAllowed = (prefs: unknown): boolean => {
  // Coluna Json com default {"transactional":true,"marketing":false}. Linha
  // antiga pode não ter a chave, e ausência conta como `true`.
  if (typeof prefs !== 'object' || prefs === null) return true;
  const v = (prefs as Record<string, unknown>).transactional;
  return v !== false;
};
```

e, depois do `findMany` que já existe (troque o `select` para trazer `kind` e `userId`):

```ts
const pending = await prisma.notification.findMany({
  where: {
    kind: { in: [...DELIVERABLE_KINDS] },
    sentAt: null,
    attemptCount: { lt: MAX_DELIVERY_ATTEMPTS },
    OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: cutoff } }],
  },
  orderBy: { createdAt: 'asc' },
  take: 50,
  select: { id: true, kind: true, userId: true, body: true },
});

const badgeRows = pending.filter((n) => n.kind === BADGE_KIND);
const others = pending.filter((n) => n.kind !== BADGE_KIND);

for (const n of others) {
  // ...o laço existente, sem mudança...
}

if (badgeRows.length > 0) {
  // Killswitch, uma vez por tick. Sem isto o admin desliga a gamificação e
  // ainda vê push sair pelos próximos minutos, com o GET devolvendo
  // enabled:false e o app obrigado a não mostrar nada. As linhas ficam
  // pendentes de propósito: se religar, voltam a ser entregáveis.
  const enabled = await readGamificationEnabled();
  if (enabled) {
    const userIds = [...new Set(badgeRows.map((r) => r.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, pushPrefs: true },
    });
    const allowed = new Set(
      users.filter((u) => transactionalAllowed(u.pushPrefs)).map((u) => u.id),
    );

    for (const userId of userIds) {
      const group = badgeRows.filter((r) => r.userId === userId);
      const ids = group.map((r) => r.id);
      if (!allowed.has(userId)) {
        // Preferência governa o push, não o inbox: a linha da central fica,
        // e é carimbada para não voltar em todo tick.
        await suppressGroup(ids, now);
        continue;
      }
      const single = group.length === 1;
      try {
        await deliverGroupedNotifications(
          {
            userId,
            notificationIds: ids,
            title: single
              ? BADGE_AWARDED_NOTIFICATION_TITLE
              : BADGE_AWARDED_GROUP_NOTIFICATION_TITLE,
            body: single ? group[0]!.body : badgeAwardedGroupBody(group.length),
            data: { kind: BADGE_KIND, route: 'notifications', count: group.length },
          },
          { sender: deps.sender, now },
        );
      } catch (err) {
        deps.log?.error({ err, userId }, '[notification-delivery] badge group failed');
      }
    }
  }
}
```

Imports novos no topo do worker:

```ts
import {
  BADGE_AWARDED_GROUP_NOTIFICATION_TITLE,
  BADGE_AWARDED_NOTIFICATION_KIND,
  BADGE_AWARDED_NOTIFICATION_TITLE,
  badgeAwardedGroupBody,
} from '@ccc/shared/badges-copy';

import { readGamificationEnabled } from '../services/garage/killswitch.js';
import { deliverGroupedNotifications, suppressGroup } from '../services/push/grouped.js';
```

- [ ] **Step 5: Rode e confirme que passa**

```bash
cd apps/api && pnpm exec vitest run test/workers/badge-delivery.test.ts test/workers/notification-delivery.test.ts
```

Esperado: PASS nos dois arquivos. Se `DevPushSender.captured` não expuser `body`, abra `apps/api/src/services/push/dev.ts` e ajuste a asserção ao que ele guarda.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/push/grouped.ts apps/api/src/workers/notification-delivery.ts apps/api/test/workers/
git commit -m "feat(conquistas): push agrupado por usuario, com killswitch e preferencia"
```

---

### Task 7: Componente visual da celebração

**Files:**

- Create: `packages/ui/src/BadgeCelebration.tsx`
- Modify: `packages/ui/src/index.ts` (append do export)
- Create: `packages/ui/src/__tests__/BadgeCelebration.test.tsx`

**Interfaces:**

- Consumes: `HexBadge` de `./HexBadge.js`, `garageTokens` de `./garage-tokens.js`, tipos de `@ccc/shared/badges`.
- Produces:

```ts
export interface BadgeCelebrationEntry {
  code: string;
  title: string;
  description: string;
  rarity: GarageRarity;
  icon: string;
}
export interface BadgeCelebrationCopy {
  titleOne: string;
  titleMany: (count: number) => string;
  close: string;
  more: (count: number) => string;
}
export interface BadgeCelebrationProps {
  entries: BadgeCelebrationEntry[];
  copy: BadgeCelebrationCopy;
  onClose: () => void;
  reduceMotion?: boolean;
  /** `insets.bottom` do consumidor. `packages/ui` não importa safe-area. */
  insetBottom?: number;
  testID?: string;
}
```

`BadgeCelebrationCopy.titleMany` e `.more` são **funções** de `count`, não strings: o número entra no meio da frase e em `en` a ordem das palavras muda.

- [ ] **Step 1: Escreva o teste que falha**

Crie `packages/ui/src/__tests__/BadgeCelebration.test.tsx`, espelhando o harness de `packages/ui/src/__tests__/XPTooltip.test.tsx` (leia esse arquivo primeiro: ele mocka `react-native` para tags do jsdom e renderiza via `createRoot`, porque `@testing-library/react-native` não parseia o source em Flow do RN sob vitest). Casos:

```ts
  it('mostra titulo e descricao quando e uma conquista', () => {
    render(
      <BadgeCelebration
        entries={[entry('EVT-001', 'Primeira Largada', 'Seu primeiro check-in.')]}
        copy={copy}
        onClose={() => {}}
        reduceMotion
      />,
    );
    expect(container.textContent).toContain('Primeira Largada');
    expect(container.textContent).toContain('Seu primeiro check-in.');
  });

  it('agrega o titulo e lista os nomes quando sao varias', () => {
    render(
      <BadgeCelebration
        entries={[entry('EVT-001', 'A', 'a'), entry('CAR-001', 'B', 'b'), entry('COM-001', 'C', 'c')]}
        copy={copy}
        onClose={() => {}}
        reduceMotion
      />,
    );
    expect(container.textContent).toContain('VOCE GANHOU 3 CONQUISTAS');
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('C');
  });

  it('corta em 6 hexagonos e indica o resto', () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(`EVT-00${i % 3}`, `T${i}`, 'd'));
    render(<BadgeCelebration entries={many} copy={copy} onClose={() => {}} reduceMotion />);
    // Sete hexagonos md (52pt) com espacamento nao cabem em 375pt de largura.
    expect(container.querySelectorAll('[data-testid^="celebration-hex-"]').length).toBe(6);
    expect(container.textContent).toContain('+4');
  });

  it('chama onClose no botao Fechar', () => {
    const onClose = vi.fn();
    render(<BadgeCelebration entries={[entry('EVT-001', 'A', 'a')]} copy={copy} onClose={onClose} reduceMotion />);
    click(container.querySelector('[data-testid="celebration-close"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd packages/ui && pnpm exec vitest run src/__tests__/BadgeCelebration.test.tsx
```

Esperado: FAIL, módulo não encontrado.

- [ ] **Step 3: Implemente**

`packages/ui/src/BadgeCelebration.tsx`. Requisitos não negociáveis, todos vindos do review:

- Envolve tudo num `Modal` da React Native, `transparent`, `animationType="none"`, `visible`, com `accessibilityViewIsModal` na view interna (espelhe `SheetShell.tsx:42` e `:55`). Uma `View` irmã das tabs ficaria **atrás** de toda folha do app, porque `Modal` é janela nativa separada.
- Backdrop escuro pressionável que chama `onClose`.
- `Animated.timing` na opacidade do backdrop e `Animated.spring` no `translateY` e na escala do bloco central, ambos `useNativeDriver: true`. O precedente correto é `apps/mobile/src/screens/events/feed/FeedComposerSheet.tsx:64-84`. **Não** copie `BudgetMeter.tsx`: ele usa `useNativeDriver: false` e tem comentário dizendo que precisa.
- `reduceMotion` verdadeiro pula spring e stagger e entra com o conteúdo já posicionado.
- `HexBadge` `lg` quando `entries.length === 1`, `md` com quebra de linha quando são várias, teto de 6 visíveis mais `copy.more(resto)`.
- `accessibilityLabel` com o **título** da conquista. `HexBadge.tsx:85` monta `Conquista ${code}, desbloqueada`, então sem isso o leitor de tela anuncia "Conquista EVT-001, desbloqueada".
- Botão "Fechar" visível, com `accessibilityRole="button"` e `accessibilityLabel={copy.close}`. Toque fora é invisível e não alcançável por leitor de tela; não pode ser a única saída.
- `testID` `celebration-hex-<code>` em cada hexágono e `celebration-close` no botão.
- Zero string literal de UI no arquivo. Tudo vem de `copy`.
- `insetBottom` aplicado como `paddingBottom` do bloco do botão. `packages/ui` não importa `react-native-safe-area-context`; quem sabe o inset é o provider.

Esqueleto, para fixar a estrutura e os `testID` que o teste procura:

```tsx
const MAX_VISIBLE = 6;

export const BadgeCelebration = ({
  entries,
  copy,
  onClose,
  reduceMotion = false,
  insetBottom = 0,
  testID,
}: BadgeCelebrationProps) => {
  const single = entries.length === 1;
  const visible = entries.slice(0, MAX_VISIBLE);
  const rest = entries.length - visible.length;

  const backdrop = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const rise = useRef(new Animated.Value(reduceMotion ? 0 : 40)).current;
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.85)).current;

  useEffect(() => {
    if (reduceMotion) return;
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
    ]).start();
  }, [reduceMotion, backdrop, rise, scale]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <Modal transparent animationType="none" visible onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={styles.backdropPress} onPress={onClose} accessible={false} />
        <Animated.View
          accessibilityViewIsModal
          testID={testID ?? 'celebration'}
          style={[styles.card, { transform: [{ translateY: rise }, { scale }] }]}
        >
          <View style={single ? styles.hexSingle : styles.hexRow}>
            {visible.map((e) => (
              <View key={e.code} testID={`celebration-hex-${e.code}`}>
                <HexBadge
                  code={e.code}
                  variant="earned"
                  rarity={e.rarity}
                  icon={e.icon}
                  size={single ? 'lg' : 'md'}
                />
              </View>
            ))}
            {rest > 0 ? <Text style={styles.more}>{copy.more(rest)}</Text> : null}
          </View>

          <Text style={styles.title}>
            {single ? copy.titleOne : copy.titleMany(entries.length)}
          </Text>

          {single ? (
            <>
              <Text style={styles.badgeTitle}>{entries[0]!.title}</Text>
              <Text style={styles.badgeDescription}>{entries[0]!.description}</Text>
            </>
          ) : (
            entries.map((e) => (
              <Text key={e.code} style={styles.badgeTitle}>
                {e.title}
              </Text>
            ))
          )}

          <Pressable
            testID="celebration-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={copy.close}
            style={[styles.close, { paddingBottom: insetBottom }]}
          >
            <Text style={styles.closeLabel}>{copy.close}</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};
```

O `accessibilityLabel` de cada hexágono precisa do **título**, não do código: `HexBadge.tsx:85` monta `Conquista ${code}, desbloqueada`, então do jeito acima o leitor de tela anuncia "Conquista EVT-001, desbloqueada". Envolva cada `HexBadge` numa `View` com `accessible` e `accessibilityLabel={e.title}`, ou acrescente a prop de override no `HexBadge`. Os estilos ficam por sua conta, com os tokens de `garage-tokens.js`.

Export em `packages/ui/src/index.ts`:

```ts
export {
  BadgeCelebration,
  type BadgeCelebrationProps,
  type BadgeCelebrationEntry,
  type BadgeCelebrationCopy,
} from './BadgeCelebration.js';
```

- [ ] **Step 4: Rode e confirme que passa**

```bash
cd packages/ui && pnpm exec vitest run src/__tests__/BadgeCelebration.test.tsx
```

Esperado: PASS nos quatro.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/BadgeCelebration.tsx packages/ui/src/index.ts packages/ui/src/__tests__/BadgeCelebration.test.tsx
git commit -m "feat(conquistas): componente visual da celebracao"
```

---

### Task 8: Hold, para o overlay não subir na hora errada

**Files:**

- Create: `packages/ui/src/celebration-hold.ts`
- Modify: `packages/ui/src/index.ts` (append)
- Modify: `packages/ui/src/SheetShell.tsx`
- Modify: `apps/mobile/src/payments/payment-sheet.ts`
- Modify: `apps/mobile/src/screens/events/feed/FeedComposerSheet.tsx`
- Modify: `apps/mobile/app/(app)/tickets/[ticketId].tsx`
- Create: `packages/ui/src/__tests__/celebration-hold.test.ts`

**Interfaces:**

- Produces:

```ts
export const acquireCelebrationHold: () => () => void;
export const isCelebrationHeld: () => boolean;
export const subscribeCelebrationHold: (l: (held: boolean) => void) => () => void;
export const useCelebrationHold: (active: boolean) => void;
```

- [ ] **Step 1: Escreva o teste que falha**

Crie `packages/ui/src/__tests__/celebration-hold.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  acquireCelebrationHold,
  isCelebrationHeld,
  subscribeCelebrationHold,
} from '../celebration-hold.js';

describe('celebration hold', () => {
  it('conta aninhado e so libera no ultimo', () => {
    expect(isCelebrationHeld()).toBe(false);
    const a = acquireCelebrationHold();
    const b = acquireCelebrationHold();
    expect(isCelebrationHeld()).toBe(true);
    a();
    expect(isCelebrationHeld()).toBe(true);
    b();
    expect(isCelebrationHeld()).toBe(false);
  });

  it('liberar duas vezes nao zera o contador de outro dono', () => {
    const a = acquireCelebrationHold();
    const b = acquireCelebrationHold();
    a();
    a();
    expect(isCelebrationHeld()).toBe(true);
    b();
    expect(isCelebrationHeld()).toBe(false);
  });

  it('notifica assinantes na virada', () => {
    const seen: boolean[] = [];
    const unsub = subscribeCelebrationHold((held) => seen.push(held));
    const a = acquireCelebrationHold();
    a();
    unsub();
    expect(seen).toEqual([true, false]);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd packages/ui && pnpm exec vitest run src/__tests__/celebration-hold.test.ts
```

- [ ] **Step 3: Implemente o módulo**

`packages/ui/src/celebration-hold.ts`:

```ts
import { useEffect } from 'react';

/**
 * Hold da celebração. Enquanto a contagem for maior que zero, o overlay de
 * conquista espera.
 *
 * Por que não uma lista de rotas: o PaymentSheet da Stripe é apresentado
 * imperativamente e `usePathname` não muda enquanto ele está aberto, então
 * roteador é o sinal errado por natureza. E `SheetShell` usa `Modal`, que é
 * janela nativa separada — o overlay sobe ATRÁS de toda folha do app,
 * inclusive da `BadgesSheet`. Cada ponto que chama daqui é chokepoint único,
 * então a cobertura não sai de sincronia quando alguém adiciona uma tela.
 */
let holds = 0;
const listeners = new Set<(held: boolean) => void>();

const emit = (): void => {
  const held = holds > 0;
  for (const l of listeners) l(held);
};

export const acquireCelebrationHold = (): (() => void) => {
  holds += 1;
  if (holds === 1) emit();
  let released = false;
  return () => {
    // Idempotente: um `release` chamado duas vezes não pode derrubar o hold
    // de outro dono.
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) emit();
  };
};

export const isCelebrationHeld = (): boolean => holds > 0;

export const subscribeCelebrationHold = (l: (held: boolean) => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Segura enquanto `active` for verdadeiro, e libera no unmount. */
export const useCelebrationHold = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;
    const release = acquireCelebrationHold();
    return release;
  }, [active]);
};
```

Export em `packages/ui/src/index.ts`:

```ts
export {
  acquireCelebrationHold,
  isCelebrationHeld,
  subscribeCelebrationHold,
  useCelebrationHold,
} from './celebration-hold.js';
```

- [ ] **Step 4: Ligue os quatro pontos**

Em `packages/ui/src/SheetShell.tsx`, dentro do componente, antes do `return`:

```ts
// Pega TODAS as folhas do app de uma vez, incluindo a BadgesSheet.
useCelebrationHold(visible);
```

(use o nome real da prop de visibilidade do `SheetShell`; leia o arquivo.)

Em `apps/mobile/src/payments/payment-sheet.ts`, no chokepoint que apresenta a sheet, envolva:

```ts
const release = acquireCelebrationHold();
try {
  // ...apresentação existente...
} finally {
  release();
}
```

Isto cobre os quatro chamadores de `usePaymentSheet` de uma vez: `cart/index.tsx`, `caixa/pagar.tsx`, `profile/orders.tsx` e `assinaturas/ContratarScreen.tsx`.

Em `apps/mobile/src/screens/events/feed/FeedComposerSheet.tsx`:

```ts
// Não é Modal, é Animated.View inline, então o overlay CONSEGUIRIA cobrir
// este compositor, derrubar o teclado e pôr o rascunho em risco. E é onde o
// usuário está quando ganha a conquista de post.
useCelebrationHold(visible);
```

Em `apps/mobile/app/(app)/tickets/[ticketId].tsx`, segure enquanto a tela está focada:

```ts
useFocusEffect(
  useCallback(() => {
    // A tela do QR. O usuário está com o telefone estendido no portão, brilho
    // no máximo, e o check-in que acabou de acontecer é o caminho que concede
    // mais conquistas de uma vez. Escurecer a tela e cobrir o QR com um modal
    // sem auto-dismiss, com fila atrás, é o pior resultado deste projeto.
    const release = acquireCelebrationHold();
    return release;
  }, []),
);
```

- [ ] **Step 5: Rode e confirme que passa**

```bash
cd packages/ui && pnpm exec vitest run src/__tests__/celebration-hold.test.ts
cd ../../apps/mobile && pnpm exec vitest run
pnpm --filter @ccc/mobile typecheck
```

Esperado: PASS, e nenhum teste de mobile quebrado pelos quatro pontos.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/celebration-hold.ts packages/ui/src/index.ts packages/ui/src/SheetShell.tsx packages/ui/src/__tests__/celebration-hold.test.ts apps/mobile/src/payments/payment-sheet.ts apps/mobile/src/screens/events/feed/FeedComposerSheet.tsx "apps/mobile/app/(app)/tickets/[ticketId].tsx"
git commit -m "feat(conquistas): hold que impede a celebracao na hora errada"
```

---

### Task 9: Copy e client da API no mobile

**Files:**

- Modify: `apps/mobile/src/copy/badges.ts` (blocos `ptBR` e `en`)
- Modify: `apps/mobile/src/api/garage.ts` (append)
- Create: `apps/mobile/src/api/__tests__/celebrations.test.ts`

**Interfaces:**

- Produces:
  - `badgesCopy.badges.celebration = { titleOne, titleMany, close, more }` nos dois idiomas
  - `listCelebrations(): Promise<BadgeCelebrationsResponse>`
  - `ackCelebrations(codes: string[]): Promise<BadgeCelebrationsAckResponse>`

- [ ] **Step 1: Escreva o teste que falha**

Crie `apps/mobile/src/api/__tests__/celebrations.test.ts` seguindo o padrão de `apps/mobile/src/api/box.test.ts` (leia primeiro para o jeito de mockar `fetch` e o provider de token). Casos:

```ts
it('faz GET na rota de celebracoes e valida a resposta', async () => {
  mockJson({ enabled: true, pending: [{ code: 'EVT-001', earnedAt: '2026-09-13T12:00:00.000Z' }] });
  const res = await listCelebrations();
  expect(lastUrl()).toContain('/me/garage/badges/celebrations');
  expect(res.pending[0]!.code).toBe('EVT-001');
});

it('faz POST no ack com os codigos', async () => {
  mockJson({ acked: 2 });
  const res = await ackCelebrations(['EVT-001', 'CAR-001']);
  expect(lastBody()).toEqual({ codes: ['EVT-001', 'CAR-001'] });
  expect(res.acked).toBe(2);
});

it('recusa lista vazia antes de sair da rede', async () => {
  await expect(ackCelebrations([])).rejects.toThrow();
});
```

E um teste de copy, no mesmo arquivo ou em `apps/mobile/src/copy/__tests__/`:

```ts
it('espelha as chaves de celebracao em en', () => {
  expect(Object.keys(badgesCopy.badges.celebration).sort()).toEqual(
    Object.keys(enBadgesCopy.badges.celebration).sort(),
  );
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd apps/mobile && pnpm exec vitest run src/api/__tests__/celebrations.test.ts
```

- [ ] **Step 3: Implemente a copy**

Em `apps/mobile/src/copy/badges.ts`, dentro de `ptBR.badges`, ao lado de `emptyBody`:

```ts
    celebration: {
      titleOne: 'NOVA CONQUISTA!',
      titleMany: (count: number) => `VOCÊ GANHOU ${count} CONQUISTAS`,
      close: 'Fechar',
      more: (count: number) => `+${count}`,
    },
```

E o espelho em `en.badges`, obrigatório:

```ts
    celebration: {
      titleOne: 'NEW BADGE!',
      titleMany: (count: number) => `YOU EARNED ${count} BADGES`,
      close: 'Close',
      more: (count: number) => `+${count}`,
    },
```

Título e descrição de cada conquista continuam vindo do catálogo do banco. Só a moldura é copy de bundle.

- [ ] **Step 4: Implemente o client**

Ao fim de `apps/mobile/src/api/garage.ts`:

```ts
export const listCelebrations = (): Promise<BadgeCelebrationsResponse> =>
  authedRequest('/me/garage/badges/celebrations', badgeCelebrationsResponseSchema);

export const ackCelebrations = (codes: string[]): Promise<BadgeCelebrationsAckResponse> => {
  const parsed = badgeCelebrationsAckRequestSchema.parse({ codes });
  return authedRequest('/me/garage/badges/celebrations/ack', badgeCelebrationsAckResponseSchema, {
    method: 'POST',
    body: parsed,
  });
};
```

com os imports correspondentes de `@ccc/shared/badges`.

- [ ] **Step 5: Rode e confirme que passa**

```bash
cd apps/mobile && pnpm exec vitest run src/api/__tests__/celebrations.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/copy/badges.ts apps/mobile/src/api/garage.ts apps/mobile/src/api/__tests__/celebrations.test.ts
git commit -m "feat(conquistas): copy e client da fila de celebracao"
```

---

### Task 10: Barramento de refresh e a fila no cliente

**Files:**

- Create: `apps/mobile/src/celebrations/refresh-bus.ts`
- Create: `apps/mobile/src/celebrations/queue.ts`
- Create: `apps/mobile/src/celebrations/__tests__/queue.test.ts`

**Interfaces:**

- Produces:
  - `requestCelebrationRefresh(): void`, `subscribeCelebrationRefresh(l: () => void): () => void`
  - `resolveEntries(pending, catalog, bundled): { entries: BadgeCelebrationEntry[]; ackOnly: string[]; resolvable: boolean }`

- [ ] **Step 1: Escreva o teste que falha**

Crie `apps/mobile/src/celebrations/__tests__/queue.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { requestCelebrationRefresh, subscribeCelebrationRefresh } from '../refresh-bus';
import { resolveEntries } from '../queue';

const pending = [{ code: 'EVT-001', earnedAt: '2026-09-13T12:00:00.000Z' }];

describe('refresh bus', () => {
  it('avisa os assinantes e para depois do unsubscribe', () => {
    const spy = vi.fn();
    const unsub = subscribeCelebrationRefresh(spy);
    requestCelebrationRefresh();
    unsub();
    requestCelebrationRefresh();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('resolveEntries', () => {
  const catalog = [
    {
      code: 'EVT-001',
      rarity: 'common' as const,
      icon: 'flag',
      title: 'Do banco',
      description: 'd',
    },
  ];
  const bundled = { 'EVT-001': { title: 'Do bundle', description: 'b' } };

  it('prefere o catalogo da API', () => {
    const out = resolveEntries(pending, catalog, bundled);
    expect(out.entries[0]!.title).toBe('Do banco');
    expect(out.resolvable).toBe(true);
  });

  it('cai no bundle quando a API nao manda titulo', () => {
    const semTitulo = [{ code: 'EVT-001', rarity: 'common' as const, icon: 'flag' }];
    const out = resolveEntries(pending, semTitulo, bundled);
    expect(out.entries[0]!.title).toBe('Do bundle');
  });

  it('marca para ack sem animar o codigo ausente de um catalogo carregado', () => {
    const out = resolveEntries([{ code: 'CAR-009', earnedAt: '...' }], catalog, bundled);
    expect(out.entries).toHaveLength(0);
    expect(out.ackOnly).toEqual(['CAR-009']);
  });

  it('NAO marca nada para ack quando o catalogo nao carregou', () => {
    // Regra load-bearing: acked aqui queimaria a fila inteira, para sempre,
    // por causa de uma requisicao ruim.
    const out = resolveEntries(pending, null, bundled);
    expect(out.ackOnly).toEqual([]);
    expect(out.resolvable).toBe(false);
  });

  it('NAO marca nada para ack quando o catalogo veio vazio', () => {
    const out = resolveEntries(pending, [], bundled);
    expect(out.ackOnly).toEqual([]);
    expect(out.resolvable).toBe(false);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd apps/mobile && pnpm exec vitest run src/celebrations/__tests__/queue.test.ts
```

- [ ] **Step 3: Implemente**

`apps/mobile/src/celebrations/refresh-bus.ts`:

```ts
/**
 * Gatilho imperativo de refetch. Existe para que as telas que CAUSAM uma
 * concessão possam pedir a celebração na hora, sem prop drilling.
 *
 * É o gatilho principal: sem ele, nenhum caminho dispara antes do cron de um
 * minuto do worker, e a média entre a ação e a animação fica em ~30s. Trinta
 * segundos depois de cadastrar um carro, um modal escuro no meio de outra tela
 * não é celebração, é interrupção.
 */
const listeners = new Set<() => void>();

export const requestCelebrationRefresh = (): void => {
  for (const l of listeners) l();
};

export const subscribeCelebrationRefresh = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
```

`apps/mobile/src/celebrations/queue.ts`:

```ts
import type { BadgeCatalogEntry, BadgeCelebration } from '@ccc/shared/badges';
import type { BadgeCelebrationEntry } from '@ccc/ui';

export type BundledCopy = Record<string, { title: string; description: string } | undefined>;

export type ResolveResult = {
  /** O que vai animar, na ordem em que veio do servidor. */
  entries: BadgeCelebrationEntry[];
  /** Códigos a carimbar SEM animar. Só sai não vazio com catálogo carregado. */
  ackOnly: string[];
  /** `false` quando o catálogo não deu para carregar. Nada pode ser acked. */
  resolvable: boolean;
};

/**
 * Junta a fila pendente com o catálogo e com a copy do bundle.
 *
 * A regra load-bearing é a de `resolvable`. Uma versão anterior do desenho
 * dizia "se não resolve o código, faz ack e não anima", justificada por
 * "código removido do catálogo". Esse estado é impossível: a FK de
 * `GarageBadge.badgeCode` é `onDelete: Restrict` e a migration de prune se
 * recusa a apagar `Badge` com dono. O único jeito real de um código não
 * resolver é o fetch do catálogo falhar, ou o killswitch virar entre as duas
 * chamadas. Fazer ack nesse caso queima a fila inteira, para sempre, por causa
 * de uma requisição ruim.
 */
export const resolveEntries = (
  pending: BadgeCelebration[],
  catalog: BadgeCatalogEntry[] | null,
  bundled: BundledCopy,
): ResolveResult => {
  // Catálogo ausente ou vazio: dá para não animar, mas NUNCA para fazer ack.
  if (catalog === null || catalog.length === 0) {
    return { entries: [], ackOnly: [], resolvable: false };
  }

  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const entries: BadgeCelebrationEntry[] = [];
  const ackOnly: string[] = [];

  for (const p of pending) {
    const cat = byCode.get(p.code);
    if (!cat) {
      // Ausente de um catálogo que carregou. Único caso em que o ack sem
      // animação é correto, e existe só para a fila não travar no topo dos 10.
      ackOnly.push(p.code);
      continue;
    }
    // `title`/`description` são opcionais no wire de propósito
    // (`packages/shared/src/badges.ts:23-31`): app novo contra API velha não
    // recebe os campos e usa a copy embutida em vez de estourar no parse.
    const fallback = bundled[p.code];
    const title = cat.title ?? fallback?.title;
    const description = cat.description ?? fallback?.description;
    if (!title) {
      ackOnly.push(p.code);
      continue;
    }
    entries.push({
      code: p.code,
      title,
      description: description ?? '',
      rarity: cat.rarity,
      icon: cat.icon,
    });
  }

  return { entries, ackOnly, resolvable: true };
};
```

- [ ] **Step 4: Rode e confirme que passa**

```bash
cd apps/mobile && pnpm exec vitest run src/celebrations/__tests__/queue.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/celebrations
git commit -m "feat(conquistas): barramento de refresh e resolucao da fila"
```

---

### Task 11: Provider

**Files:**

- Create: `apps/mobile/src/celebrations/provider.tsx`
- Create: `apps/mobile/src/celebrations/__tests__/provider.test.tsx`

**Interfaces:**

- Consumes: `listCelebrations`, `ackCelebrations` (Task 9); `getMyBadges` de `apps/mobile/src/api/garage.ts:113`, que já devolve `{ enabled, catalog, badges }` e é de onde sai o catálogo — o app **não** tem cliente de `/badges/catalog` e não deve ganhar um; `resolveEntries` (Task 10), `subscribeCelebrationRefresh` (Task 10), `subscribeCelebrationHold` e `isCelebrationHeld` (Task 8), `BadgeCelebration` (Task 7), `badgesCopy` (Task 9), `useAuth` de `apps/mobile/src/auth/context.tsx:206`.
- Produces: `BadgeCelebrationProvider({ children }: { children: ReactNode })`.

- [ ] **Step 1: Escreva o teste que falha**

Crie `apps/mobile/src/celebrations/__tests__/provider.test.tsx`. Casos obrigatórios, cada um vindo de um achado de review:

```ts
it('nao busca nada sem usuario autenticado', async () => {
  /* status: 'unauthenticated' → zero fetch */
});

it('busca quando o refresh bus dispara', async () => {
  /* requestCelebrationRefresh() → 1 fetch */
});

it('nao dispara GET concorrente', async () => {
  // Dois pushes seguidos disparam dois GETs; sem a guarda, o segundo resolve
  // DEPOIS do ack e ressuscita a conquista que o usuario acabou de fechar.
});

it('nao reanima codigo ja acked localmente, mesmo se o GET voltar com ele', async () => {});

it('nao reanima quando o POST de ack falha', async () => {
  // Ack e 20/min e o GET e 60/min: sem o conjunto local, uma conexao ruim
  // vira overlay de tela cheia a cada tick, sem auto-dismiss e sem como
  // desligar. Nao e repeat benigno, e loop.
});

it('segura a fila enquanto o hold esta ativo e anima ao liberar', async () => {});

it('faz ack sem animar codigo ausente de catalogo carregado', async () => {});

it('NAO faz ack quando o catalogo falha', async () => {});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd apps/mobile && pnpm exec vitest run src/celebrations/__tests__/provider.test.tsx
```

- [ ] **Step 3: Implemente**

`apps/mobile/src/celebrations/provider.tsx`:

```tsx
import { BadgeCelebration, isCelebrationHeld, subscribeCelebrationHold } from '@ccc/ui';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ackCelebrations, getMyBadges, listCelebrations } from '~/api/garage';
import { useAuth } from '~/auth/context';
import { badgesCopy } from '~/copy/badges';
import { captureException } from '~/lib/sentry';

import { resolveEntries, type ResolveResult } from './queue';
import { subscribeCelebrationRefresh } from './refresh-bus';

// Cinco minutos, não sessenta segundos. Com o gatilho de escrita no lugar, o
// timer só cobre check-in e grant de admin. Um timer global de 60s seriam 1440
// requisições por usuário por dia para um evento que acontece meia dúzia de
// vezes na vida de uma conta.
const POLL_INTERVAL_MS = 5 * 60_000;

export const BadgeCelebrationProvider = ({ children }: { children: ReactNode }) => {
  const { status } = useAuth();
  const authed = status === 'authenticated';
  const insets = useSafeAreaInsets();

  const [queue, setQueue] = useState<ResolveResult['entries']>([]);
  const [held, setHeld] = useState(() => isCelebrationHeld());
  const [reduceMotion, setReduceMotion] = useState(false);

  // Bloqueia GET concorrente. Sem isto, dois pushes seguidos disparam dois
  // GETs e o segundo resolve DEPOIS do ack, ressuscitando a conquista que o
  // usuário acabou de fechar.
  const inFlight = useRef(false);
  // Códigos já acked NESTE ciclo de app. Filtra toda resposta, inclusive a de
  // um GET que já estava em voo quando o ack saiu. Também é o que impede o
  // loop quando o POST de ack falha: o ack é 20/min e o GET é 60/min, então
  // sem isto uma conexão ruim vira overlay de tela cheia a cada tick, sem
  // auto-dismiss e sem como desligar.
  const ackedLocally = useRef<Set<string>>(new Set());
  const visibleRef = useRef(false);
  visibleRef.current = queue.length > 0;

  const refresh = useCallback(async () => {
    if (!authed || inFlight.current) return;
    // Com o overlay na tela, refazer o fetch só reiniciaria a animação por
    // baixo do usuário: o ack só sai no fechamento, então a lista é a mesma.
    if (visibleRef.current) return;
    inFlight.current = true;
    try {
      const res = await listCelebrations();
      if (!res.enabled || res.pending.length === 0) return;

      let catalog = null;
      try {
        const badges = await getMyBadges();
        catalog = badges.enabled ? badges.catalog : null;
      } catch (err) {
        captureException(err, 'celebrations.catalog');
        catalog = null;
      }

      const pending = res.pending.filter((p) => !ackedLocally.current.has(p.code));
      const resolved = resolveEntries(pending, catalog, badgesCopy.badges.catalog);
      if (!resolved.resolvable) return;

      if (resolved.ackOnly.length > 0) {
        for (const code of resolved.ackOnly) ackedLocally.current.add(code);
        void ackCelebrations(resolved.ackOnly).catch((err) =>
          captureException(err, 'celebrations.ack-unknown'),
        );
      }
      if (resolved.entries.length > 0) setQueue(resolved.entries);
    } catch (err) {
      captureException(err, 'celebrations.fetch');
    } finally {
      inFlight.current = false;
    }
  }, [authed]);

  // Ack no FECHAMENTO, não na abertura. Se o app morrer no meio da animação,
  // ela volta na próxima abertura. Repetir é melhor que perder.
  const close = useCallback(() => {
    const codes = queue.map((e) => e.code);
    setQueue([]);
    for (const code of codes) ackedLocally.current.add(code);
    if (codes.length > 0) {
      void ackCelebrations(codes).catch((err) => captureException(err, 'celebrations.ack'));
    }
  }, [queue]);

  useEffect(() => subscribeCelebrationHold(setHeld), []);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!authed) return;
    void refresh();

    const offBus = subscribeCelebrationRefresh(() => void refresh());
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);

    // Na web `addNotificationReceivedListener` é um stub que só avisa no
    // console. Guarda explícita, igual a `use-push-open-handler.ts:22`.
    const pushSub =
      Platform.OS === 'web'
        ? null
        : Notifications.addNotificationReceivedListener(() => void refresh());

    return () => {
      offBus();
      appSub.remove();
      clearInterval(timer);
      pushSub?.remove();
    };
  }, [authed, refresh]);

  // Buscar pode a qualquer momento; EXIBIR é que espera o hold.
  const show = queue.length > 0 && !held;

  return (
    <View style={{ flex: 1 }}>
      {children}
      {show ? (
        <BadgeCelebration
          entries={queue}
          copy={{
            titleOne: badgesCopy.badges.celebration.titleOne,
            titleMany: badgesCopy.badges.celebration.titleMany,
            close: badgesCopy.badges.celebration.close,
            more: badgesCopy.badges.celebration.more,
          }}
          onClose={close}
          reduceMotion={reduceMotion}
          insetBottom={insets.bottom}
        />
      ) : null}
    </View>
  );
};
```

Confira contra os requisitos abaixo antes de dar por pronto:

- **Só roda autenticado.** `useAuth().status === 'authenticated'`. Sem isso, `(app)/_layout.tsx` monta para anônimo em `/inicio`, `/events` e `/store`, cada tick estoura `ApiError(401, 'no access token')` em `client.ts:92`, e com refresh expirado o caminho de falha chama `onSignOut` (`client.ts:112-118`) — um poll global vira um jeito novo de deslogar o usuário no meio de um pagamento.
- **Ref de in-flight** que bloqueia GET concorrente.
- **Conjunto em memória de códigos já acked localmente**, aplicado como filtro em toda resposta, inclusive nas que chegam de um GET que já estava em voo.
- **Cinco gatilhos:** `subscribeCelebrationRefresh` (o principal), montagem, `AppState` virando `active`, `Notifications.addNotificationReceivedListener` com guarda `Platform.OS === 'web'` (espelhe `use-push-open-handler.ts:22`), e um timer de **5 minutos**. Cinco minutos, não sessenta segundos: com o gatilho de escrita no lugar, o timer só cobre check-in e grant de admin, e um timer global de 60s seriam 1440 requisições por usuário por dia para um evento que acontece meia dúzia de vezes na vida da conta.
- **O timer pausa enquanto o overlay está visível.** Sem isso, com o ack só no fechamento, cada tick devolve a mesma lista e reinicia a animação por baixo do usuário.
- **Respeita o hold.** `isCelebrationHeld()` no momento de exibir, mais `subscribeCelebrationHold` para destravar quando liberar. Buscar pode; exibir, não.
- **Ack no fechamento, não na abertura.** Se o app morrer no meio da animação, ela volta. Repetir é melhor que perder.
- **Falha de ack ainda entra no conjunto local**, com retry no próximo ciclo.
- `AccessibilityInfo.isReduceMotionEnabled()` alimenta a prop `reduceMotion` do `BadgeCelebration`.
- Envolve o `BadgeCelebration` com `useSafeAreaInsets`, senão o botão Fechar cai embaixo do home indicator.
- Erro de rede é silencioso, com `captureException` no padrão de `apps/mobile/app/(app)/notifications/index.tsx:36`.

- [ ] **Step 4: Rode e confirme que passa**

```bash
cd apps/mobile && pnpm exec vitest run src/celebrations/
pnpm --filter @ccc/mobile typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/celebrations
git commit -m "feat(conquistas): provider da celebracao"
```

---

### Task 12: Montagem e gatilho de escrita

**Files:**

- Modify: `apps/mobile/app/(app)/_layout.tsx` (o `AppLayout` do fim do arquivo)
- Modify: o handler de sucesso da criação de carro (procure por `createCar` em `apps/mobile/src`)
- Modify: o handler de sucesso do post no feed (procure por `createFeedPost` em `apps/mobile/src`)
- Modify: `apps/mobile/src/celebrations/__tests__/provider.test.tsx` (append)

**Interfaces:**

- Consumes: `BadgeCelebrationProvider`, `requestCelebrationRefresh`.

- [ ] **Step 1: Escreva o teste que falha**

Append em `provider.test.tsx`, ou num arquivo de wiring ao lado, dois casos:

```ts
it('pede refresh depois de criar carro', async () => {
  /* mock do submit → espera requestCelebrationRefresh */
});
it('pede refresh depois de postar no feed', async () => {});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
cd apps/mobile && pnpm exec vitest run src/celebrations/
```

- [ ] **Step 3: Monte o provider**

Em `apps/mobile/app/(app)/_layout.tsx`, no `AppLayout`:

```tsx
export default function AppLayout() {
  return (
    <CartProvider>
      <BadgeCelebrationProvider>
        <AppTabs />
      </BadgeCelebrationProvider>
    </CartProvider>
  );
}
```

- [ ] **Step 4: Ligue o gatilho de escrita**

No sucesso de criar carro e no sucesso de postar no feed, depois da resposta OK:

```ts
requestCelebrationRefresh();
```

Check-in fica **de fora de propósito**: quem dispara é o scanner do admin, o app do usuário não sabe de nada, e esse caso depende dos outros gatilhos.

- [ ] **Step 5: Trave a supressão de banner em foreground**

Crie `apps/mobile/src/notifications/__tests__/no-foreground-handler.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// "Sem push com o app aberto" é o requisito que o usuário pediu nos dois
// ramos, e hoje ele é satisfeito por AUSÊNCIA de código: o app não registra
// setNotificationHandler, e o default do expo-notifications é não apresentar a
// notificação em foreground (documentado na fonte do pacote, em
// NotificationsHandler.ts). Uma linha de código nova quebra isso em silêncio.
//
// Este teste afirma que NÃO EXISTE handler, não que o handler tem tal campo.
// Uma versão anterior do plano afirmava "nenhum handler com
// shouldShowAlert: true": nessa versão do pacote esse campo é deprecado em
// favor de shouldShowBanner/shouldShowList, e o exemplo da própria doc usa
// shouldShowBanner. Quem adicionasse um handler copiando a doc passaria pelo
// teste e quebraria o requisito.
describe('supressao de banner em foreground', () => {
  it('nao existe setNotificationHandler no app', () => {
    let out = '';
    try {
      out = execFileSync(
        'grep',
        ['-rl', 'setNotificationHandler', 'app', 'src', '--include=*.ts', '--include=*.tsx'],
        { cwd: process.cwd(), encoding: 'utf8' },
      );
    } catch {
      // grep sai com 1 quando não acha nada. É o caminho de sucesso.
      out = '';
    }
    const hits = out.split('\n').filter((l) => l.length > 0 && !l.includes('__tests__'));
    expect(hits).toEqual([]);
  });
});
```

Rode e confirme que passa hoje:

```bash
cd apps/mobile && pnpm exec vitest run src/notifications/__tests__/no-foreground-handler.test.ts
```

Esperado: PASS. Se falhar, alguém adicionou um handler e o requisito já está quebrado — pare e reporte antes de seguir.

- [ ] **Step 6: Rode tudo**

```bash
cd apps/mobile && pnpm exec vitest run
pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint
cd ../api && pnpm exec vitest run test/garage/ test/workers/ test/admin/badge-notification.test.ts
pnpm --filter @ccc/api typecheck && pnpm --filter @ccc/api lint
```

Esperado: tudo PASS. Lint sem aumentar 67 (api) nem 75 (mobile), zero errors nos dois.

- [ ] **Step 7: Commit**

```bash
git add "apps/mobile/app/(app)/_layout.tsx" apps/mobile/src
git commit -m "feat(conquistas): monta o provider e dispara na escrita"
```

---

### Task 13: ROPA

**Files:**

- Modify: `docs/ropa.md` (nova linha depois de `MKT-01`, linha 21)

- [ ] **Step 1: Escreva a entrada**

Acrescente uma linha `GAM-01` — Push de conquista — à tabela, espelhando exatamente as colunas de `MSG-01` e `MKT-01`. Conteúdo:

- **Dados:** Expo push token, plataforma, título e corpo da mensagem, código da conquista.
- **Titulares:** usuários autenticados com conquista concedida.
- **Base legal:** Art. 7, IX — legítimo interesse, com opt-out por `pushPrefs.transactional` e pelas permissões do sistema operacional.
- **Retenção:** `Notification` alvo de 90 dias, igual a `MSG-01`.
- **Destinatários e transferência:** Railway (BR), Expo Push (US), `Yes`, ANPD SCC — idêntico às outras duas linhas.
- **Salvaguardas:** payload sem nome, e-mail, placa ou valor; título fixo e corpo com o título da conquista, que é editável pelo admin em `/configuracoes/conquistas`; agrupamento por usuário; gate de preferência aplicado no worker.

- [ ] **Step 2: Confirme a consistência**

A frase que o app mostra ao usuário em `apps/mobile/src/copy/profile.ts:88-89` enumera o que é transacional: "confirmação de ingresso e lembretes de evento". Conquista **não** entra nessa frase, e é por isso que a base legal aqui é outra. Não altere essa copy.

- [ ] **Step 3: Commit**

```bash
git add docs/ropa.md
git commit -m "docs(lgpd): entrada de ROPA para push de conquista"
```

---

## Ordem e paralelismo

Task 1 e Task 2 são independentes entre si. Tasks 3, 4, 5 e 6 dependem das duas primeiras. Task 6 depende da 1 pela copy de grupo. Tasks 7 e 8 são só de cliente e podem andar em paralelo com o bloco de API. Task 9 depende da 1 (build de `@ccc/shared`). Tasks 10, 11 e 12 são sequenciais. Task 13 é independente de tudo.

## Antes de abrir o PR

- Os dois números contados na Task 2, Step 1, no corpo do PR.
- Suíte completa da API uma vez: `cd apps/api && pnpm exec vitest run` (~13 min). Este projeto toca o awarder, que é compartilhado por carros, feed e check-in.
- `git status` limpo, e todo arquivo sujo é seu. Este repo é compartilhado com outras sessões via `.claude/worktrees/`.
