# Admin da copy de gamificação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o admin edite título e descrição das 12 conquistas e o nome dos 5 níveis, com o texto chegando ao app sem republicar versão.

**Architecture:** Título e descrição viram colunas NOT NULL em `Badge`; os nomes de nível viram uma coluna JSON em `GeneralSettings`. `RANK_TIERS` deixa de encadear por nome e passa a encadear por índice. Os campos viajam opcionais no wire, e o mobile cai na copy do bundle quando a API não os manda. A escrita é uma transação cuja primeira operação é um compare-and-swap de versão.

**Tech Stack:** Prisma + Postgres, Fastify, Zod, Next.js App Router no admin, Expo no mobile, Vitest, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-09-admin-gamification-copy-design.md`

## Global Constraints

- PT-BR é a língua primária de toda copy visível. Sem em-dash.
- **Este plano assume que `docs/superpowers/plans/2026-09-09-admin-home-content.md` já foi executado.** Ele cria `configuracoes/layout.tsx` com o gate de staff, `settings-tabs.tsx`, e a entrada `/configuracoes` no menu. Se não foi, pare e execute aquele primeiro: sem o layout, `/configuracoes/conquistas` renderiza o editor para sessão staff, porque `apps/admin/middleware.ts:5-18` não cobre essa rota.
- Testes de integração da API batem em Postgres real. **Docker precisa estar rodando.**
- **Rodar um arquivo de teste da API:** `cd apps/api && pnpm exec vitest run test/<caminho>`. NÃO use `pnpm --filter @ccc/api test -- <arquivo>`: o `--` não filtra e roda os ~2253 testes.
- **Em worktree novo:** `pnpm --filter @ccc/db --filter @ccc/shared --filter @ccc/design build` antes de testar, e `pnpm exec prettier --write` nos arquivos alterados antes de commitar, porque os hooks não instalam.
- Lint por pacote, nunca na raiz. Baseline de `apps/api`: 79 warnings, 0 errors.
- Depois de mexer no `schema.prisma`, rode `pnpm --filter @ccc/db build` (gera o client) antes de qualquer typecheck em `apps/api`, senão os tipos novos não existem.
- Caps de Zod, vindos do que renderiza e não da coluna: `title` 40, `description` 240, nome de nível 20. Colunas: `title` VarChar(80), `description` VarChar(240).
- Branch: partir de `main` atualizado. PR contra `main`. Nunca `production`.

## File Structure

**Criar:**

- `packages/db/prisma/migrations/<timestamp>_gamification_copy/migration.sql`
- `docs/migration-rollback-gamification-copy.md` — exigido por `docs/engineering-workflow.md:310-313`
- `packages/shared/src/admin-gamification.ts`
- `packages/shared/src/__tests__/admin-gamification.test.ts`
- `apps/api/src/routes/admin/gamification-copy.ts`
- `apps/api/test/admin/gamification-copy.test.ts`
- `apps/admin/app/(authed)/configuracoes/conquistas/page.tsx`
- `apps/admin/app/(authed)/configuracoes/gamification-copy-form.tsx`
- `apps/admin/app/(authed)/configuracoes/gamification-copy-form.interaction.test.tsx`
- `apps/admin/src/lib/gamification-copy-actions.ts`

**Modificar:**

- `packages/db/prisma/schema.prisma` — `Badge` (+2 colunas), `GeneralSettings` (+2 colunas)
- `packages/db/prisma/seed.ts:431` (const `BADGES`)
- `packages/shared/src/badges.ts` — `badgeCatalogEntrySchema`
- `packages/shared/src/badges-copy.ts` — remover `BADGE_TITLES_PT_BR` e `badgeTitlePtBr`
- `packages/shared/src/admin.ts` e `apps/api/src/services/admin-audit.ts` — uniões de auditoria
- `packages/shared/package.json` — export `./admin-gamification`
- `apps/api/src/services/garage/progress.ts`
- `apps/api/src/services/garage/awarder.ts:4,166`
- `apps/api/src/routes/garage.ts:96-116` e `:510-522`
- `apps/api/src/routes/badges-catalog.ts:8-13,44-50`
- `apps/api/src/services/garage/badges-read.ts:39-45`
- `apps/api/src/routes/admin/index.ts`
- `apps/admin/src/lib/admin-api.ts`
- `apps/admin/app/(authed)/configuracoes/settings-tabs.tsx` — acrescentar a aba
- `apps/mobile/app/(app)/garage/index.tsx:31-37,252`
- Sete arquivos de fixture de teste (Task 1)

---

### Task 1: Colunas, migration, seed e fixtures

**Files:**

- Modify: `packages/db/prisma/schema.prisma`, `packages/db/prisma/seed.ts:431`
- Create: `packages/db/prisma/migrations/<timestamp>_gamification_copy/migration.sql`
- Create: `docs/migration-rollback-gamification-copy.md`
- Modify: `apps/api/test/garage/badges.test.ts:13`, `badges-write-hooks.test.ts:12`, `awarder.test.ts:8`, `xp-badge-award.test.ts:9`, `badges-dsr.test.ts:10,97`, `apps/api/test/admin/badge-manual-grant.test.ts:9`, `badge-notification.test.ts:21`

**Interfaces:**

- Produces: `Badge.title`, `Badge.description` (NOT NULL), `GeneralSettings.rankNames` (Json?), `GeneralSettings.gamificationCopyVersion` (Int, default 0). Tudo que vem depois depende destas colunas.

O deliverable desta task é a suíte existente verde com as colunas novas. Nenhum comportamento muda ainda.

- [ ] **Step 1: Alterar o schema**

Em `packages/db/prisma/schema.prisma`, no `model Badge` (~linha 329), depois de `code`:

```prisma
  title            String        @db.VarChar(80)
  description      String        @db.VarChar(240)
```

No `model GeneralSettings` (~linha 1286), depois de `gamificationEnabled`:

```prisma
  rankNames               Json?
  gamificationCopyVersion Int      @default(0)
```

- [ ] **Step 2: Gerar a migration sem aplicar**

Run: `pnpm db:migrate dev --name gamification_copy --create-only`

O `--create-only` é obrigatório: sem ele, Prisma tenta aplicar uma coluna NOT NULL contra o banco local já semeado, falha, e oferece reset.

- [ ] **Step 3: Reescrever o SQL gerado**

Substituir o conteúdo de `migration.sql` por três passos. Precedente de estilo:
`packages/db/prisma/migrations/20260521000000_car_fields_extension/migration.sql:74`.

```sql
-- Copy editável das conquistas. Passo 1: colunas nuláveis.
ALTER TABLE "Badge" ADD COLUMN "title" VARCHAR(80);
ALTER TABLE "Badge" ADD COLUMN "description" VARCHAR(240);

-- Passo 2: backfill dos 12 códigos do catálogo. Valores verbatim de
-- apps/mobile/src/copy/badges.ts — divergir aqui muda texto em produção
-- sem ninguém ter pedido.
UPDATE "Badge" SET "title" = 'Primeira Largada',  "description" = 'Seu primeiro check-in confirmado em um encontro CCC.'   WHERE "code" = 'EVT-001';
UPDATE "Badge" SET "title" = 'Sequência de Três', "description" = 'Três eventos consecutivos sem perder nenhum.'            WHERE "code" = 'EVT-002';
UPDATE "Badge" SET "title" = 'Veterano de Pista', "description" = 'Dez check-ins confirmados na sua trajetória CCC.'        WHERE "code" = 'EVT-003';
UPDATE "Badge" SET "title" = 'Garagem Aberta',    "description" = 'O primeiro carro estacionado na sua garagem.'            WHERE "code" = 'CAR-001';
UPDATE "Badge" SET "title" = 'Garagem Cheia',     "description" = 'Cinco carros ou mais ocupando suas vagas.'               WHERE "code" = 'CAR-002';
UPDATE "Badge" SET "title" = 'Curador CCC',       "description" = 'Dez carros ou mais na coleção da sua garagem.'           WHERE "code" = 'CAR-003';
UPDATE "Badge" SET "title" = 'Primeira Postagem', "description" = 'Sua estreia no feed de um evento.'                       WHERE "code" = 'COM-001';
UPDATE "Badge" SET "title" = 'Voz da Comunidade', "description" = 'Comentários ativos nas conversas dos encontros.'         WHERE "code" = 'COM-002';
UPDATE "Badge" SET "title" = 'Em Chamas',         "description" = 'Postagens engajadas em sequência na comunidade.'         WHERE "code" = 'COM-003';
UPDATE "Badge" SET "title" = 'Marco Fixado',      "description" = 'Primeiro local fixado no seu mapa CCC.'                  WHERE "code" = 'CCC-001';
UPDATE "Badge" SET "title" = 'Itinerário CCC',    "description" = 'Participação ativa na agenda nacional de eventos.'       WHERE "code" = 'CCC-002';
UPDATE "Badge" SET "title" = 'Fundador',          "description" = 'Você entrou antes de a comunidade decolar.'              WHERE "code" = 'CCC-003';

-- Sweep terminal. Badge.code só tem @unique, e o catálogo já foi reescrito em
-- produção uma vez (20260708000000_rebrand_badge_codes_ccc). Uma linha fora
-- dos 12 acima faria o SET NOT NULL abortar o preDeployCommand do Railway, e
-- Prisma marcaria a migration como failed: toda release seguinte falha até
-- alguém rodar `migrate resolve --rolled-back` contra prod. Fallback é o
-- próprio code, e não string vazia, porque os schemas Zod são min(1).
UPDATE "Badge"
   SET "title"       = COALESCE("title", "code"),
       "description" = COALESCE("description", "code")
 WHERE "title" IS NULL OR "description" IS NULL;

-- Passo 3: constraint.
ALTER TABLE "Badge" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "Badge" ALTER COLUMN "description" SET NOT NULL;

-- Nome de nível editável + token de versão do form de copy.
ALTER TABLE "GeneralSettings" ADD COLUMN "rankNames" JSONB;
ALTER TABLE "GeneralSettings" ADD COLUMN "gamificationCopyVersion" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 4: Aplicar e gerar o client**

Run: `pnpm db:migrate dev && pnpm --filter @ccc/db build`
Expected: migration aplicada, client regerado.

- [ ] **Step 5: Escrever o plano de rollback**

`docs/migration-rollback-gamification-copy.md`, no molde dos cinco
`docs/migration-rollback-*.md` que já existem:

````markdown
# Rollback — gamification_copy

## Reverter só o código

Seguro sem tocar no banco. Nenhum caminho de API escreve `Badge`, e as colunas
novas de `GeneralSettings` são nuláveis ou têm default, então a versão anterior
da API roda com o schema novo sem alteração.

## Reverter o schema

```sql
ALTER TABLE "Badge" DROP COLUMN "title", DROP COLUMN "description";
ALTER TABLE "GeneralSettings" DROP COLUMN "rankNames", DROP COLUMN "gamificationCopyVersion";
```
````

Destrutivo: apaga toda copy editada pelo admin. Exportar antes com
`SELECT code, title, description FROM "Badge" ORDER BY code;`.

## Se o `SET NOT NULL` abortar o deploy

O `preDeployCommand` do Railway roda `prisma migrate deploy`. Uma falha deixa a
migration marcada como `failed` em `_prisma_migrations`, e toda release seguinte
re-tenta e re-falha. Para destravar:

1. `prisma migrate resolve --rolled-back <nome_da_migration>` contra prod.
2. Achar a linha culpada: `SELECT code FROM "Badge" WHERE title IS NULL;`
3. Corrigir o backfill e reaplicar.

````

- [ ] **Step 6: Atualizar o seed**

Em `packages/db/prisma/seed.ts`, a const `BADGES` (~linha 431) ganha `title` e
`description` em cada uma das 12 entradas, com os mesmos valores do SQL acima.
Sem isso o `create: b` da linha 492 para de compilar, porque `BadgeCreateInput`
passou a exigir os dois campos.

`seedBadgeCatalog` **não** muda: o `update` continua sendo
`{ category, rarity, icon, premiumExclusive }`. Acrescentar `title` ali faria
uma execução manual do seed apagar tudo que o admin escreveu.

- [ ] **Step 7: Consertar as sete fixtures**

Cada uma cria `Badge` sem texto e para de compilar. Onde há helper, o default
entra no helper e resolve todos os call sites de uma vez.

`apps/api/test/garage/awarder.test.ts:12` e
`apps/api/test/garage/xp-badge-award.test.ts:9`, dentro do `prisma.badge.create`
de cada `seedBadge`:

```ts
      title: `Conquista ${code}`,
      description: `Descrição de ${code}`,
````

`apps/api/test/garage/badges.test.ts:15` — o `createMany` tem 12 literais.
Trocar por um `.map` que injeta os campos:

```ts
const seedCatalog = async () => {
  const rows = [
    { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag' },
    // ... as outras 11 entradas, inalteradas
  ] as const;
  await prisma.badge.createMany({
    data: rows.map((r) => ({
      ...r,
      title: `Conquista ${r.code}`,
      description: `Descrição de ${r.code}`,
    })),
  });
};
```

`badges-write-hooks.test.ts:12`, `badges-dsr.test.ts:10` e `:97`,
`admin/badge-manual-grant.test.ts:9`: acrescentar os dois campos no literal,
mesmo formato.

`admin/badge-notification.test.ts:21` é o caso especial e fica para a Task 5.
Por ora só adicione os dois campos para compilar; as asserções de `body` mudam lá.

- [ ] **Step 8: Provar que o seed nao reverte edicao**

Novo arquivo `apps/api/test/garage/badge-seed-preserves-copy.test.ts`. O spec
trata isso como invariante, e a unica coisa que o sustenta e a clausula
`update` do `seedBadgeCatalog`, que e facil de alguem "consertar" depois:

```ts
import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase } from '../helpers.js';

describe('seedBadgeCatalog preserva copy editada', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('upsert de catalogo nao sobrescreve title nem description', async () => {
    await prisma.badge.create({
      data: {
        code: 'EVT-001',
        category: 'eventos',
        rarity: 'common',
        icon: 'flag',
        premiumExclusive: false,
        title: 'Editado pelo admin',
        description: 'Descrição editada.',
      },
    });

    // Mesma forma do upsert de packages/db/prisma/seed.ts:488-500.
    await prisma.badge.upsert({
      where: { code: 'EVT-001' },
      create: {
        code: 'EVT-001',
        category: 'eventos',
        rarity: 'common',
        icon: 'flag',
        premiumExclusive: false,
        title: 'Primeira Largada',
        description: 'Desc canônica.',
      },
      update: { category: 'eventos', rarity: 'common', icon: 'flag', premiumExclusive: false },
    });

    const row = await prisma.badge.findUniqueOrThrow({ where: { code: 'EVT-001' } });
    expect(row.title).toBe('Editado pelo admin');
    expect(row.description).toBe('Descrição editada.');
  });
});
```

Run: `cd apps/api && pnpm exec vitest run test/garage/badge-seed-preserves-copy.test.ts`
Expected: PASS.

- [ ] **Step 9: Verificar**

Run: `pnpm --filter @ccc/db typecheck && cd apps/api && pnpm typecheck`
Expected: sem erro.

Run: `cd apps/api && pnpm exec vitest run test/garage test/admin`
Expected: PASS. Nenhum comportamento mudou ainda.

- [ ] **Step 10: Commit**

```bash
pnpm exec prettier --write packages/db/prisma/seed.ts packages/db/prisma/schema.prisma docs/migration-rollback-gamification-copy.md
git add packages/db docs/migration-rollback-gamification-copy.md apps/api/test
git commit -m "feat(db): colunas de copy editavel em Badge e GeneralSettings"
```

---

### Task 2: `RANK_TIERS` por chave e guard posicional

**Files:**

- Modify: `apps/api/src/services/garage/progress.ts`
- Modify: `apps/api/test/garage/progress.test.ts`

**Interfaces:**

- Produces: `RANK_KEYS`, `type RankKey`, `RANK_TIERS` com `key` e sem `next`/`nextAt` no topo, `deriveProgress(xp: number, names?: Partial<Record<RankKey, string>>)`, `RankName = string`. A Task 3 consome `deriveProgress` com o mapa; a Task 6 importa `RANK_KEYS`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `apps/api/test/garage/progress.test.ts`, dentro do
`describe('deriveProgress', ...)`:

```ts
it('resolve rank e nextRank pelo mapa de nomes', () => {
  const names = { pilotador: 'Piloto', veterano: 'Mestre' };
  expect(deriveProgress(100, names)).toEqual({
    xp: 100,
    rank: 'Piloto',
    nextRank: 'Mestre',
    xpInTier: 0,
    xpToNextRank: 400,
    tierSpan: 400,
  });
});

it('cai no nome de codigo quando a chave falta no mapa', () => {
  expect(deriveProgress(100, { veterano: 'Mestre' }).rank).toBe('Pilotador');
});

// Guard de topo: com o encadeamento por indice, um `next === undefined`
// passaria pelo antigo `=== null` e produziria xpToNextRank negativo, que
// garageProgressSchema recusa e vira 500 em GET /me/garage.
it('mantem o sentinela de topo mesmo com os nomes remapeados', () => {
  const names = { hall_of_fame: 'Panteão' };
  expect(deriveProgress(5000, names)).toEqual({
    xp: 5000,
    rank: 'Panteão',
    nextRank: null,
    xpInTier: 0,
    xpToNextRank: 0,
    tierSpan: 1,
  });
  expect(deriveProgress(999999, names).xpToNextRank).toBe(0);
  expect(deriveProgress(999999, names).tierSpan).toBe(1);
});
```

Os 11 casos existentes chamam `deriveProgress(xp)` com um argumento só e
continuam válidos, porque `names` é opcional.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/garage/progress.test.ts`
Expected: FAIL — `deriveProgress` aceita um argumento só.

- [ ] **Step 3: Reescrever a tabela e a derivação**

Em `apps/api/src/services/garage/progress.ts`, substituir o bloco de
`RANK_TIERS` até o fim de `deriveProgress`:

```ts
// Chaves estáveis dos níveis. O NOME é editável pelo admin
// (GeneralSettings.rankNames), então nada pode encadear ou comparar por nome.
export const RANK_KEYS = [
  'iniciante',
  'pilotador',
  'veterano',
  'lendario',
  'hall_of_fame',
] as const;
export type RankKey = (typeof RANK_KEYS)[number];

// Tabela server-only. Os cortes continuam em código; só o nome sai daqui.
// A linha de topo NÃO tem `nextAt`: sem o campo, nenhuma leitura futura
// consegue tipar `null` como `number` no cálculo abaixo.
export const RANK_TIERS: { key: RankKey; name: string; min: number; nextAt?: number }[] = [
  { key: 'iniciante', name: 'Iniciante', min: 0, nextAt: 100 },
  { key: 'pilotador', name: 'Pilotador', min: 100, nextAt: 500 },
  { key: 'veterano', name: 'Veterano', min: 500, nextAt: 2000 },
  { key: 'lendario', name: 'Lendário', min: 2000, nextAt: 5000 },
  { key: 'hall_of_fame', name: 'Hall of Fame', min: 5000 },
];

// Era uma união literal derivada de RANK_TIERS[number]['name']. Com nome
// editável isso vira mentira, então alarga para string.
export type RankName = string;

export type GarageProgress = {
  xp: number;
  rank: RankName;
  nextRank: RankName | null;
  xpInTier: number;
  xpToNextRank: number;
  tierSpan: number;
};

export type RankNames = Partial<Record<RankKey, string>>;

// Parcial, não total: a resolução é `names[key] ?? nome de código`, e um
// Record total não teria chave ausente para cair no fallback.
const resolveName = (index: number, names: RankNames): string => {
  const tier = RANK_TIERS[index];
  if (!tier) return '';
  return names[tier.key] ?? tier.name;
};

export const deriveProgress = (xp: number, names: RankNames = {}): GarageProgress => {
  // Preserva o índice: o guard de topo é posicional agora.
  let index = 0;
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    const row = RANK_TIERS[i];
    if (row !== undefined && xp >= row.min) {
      index = i;
      break;
    }
  }

  const tier = RANK_TIERS[index]!;

  // §C14: o topo sai antes de qualquer leitura de nextAt. Posicional, e não
  // `next === null`: derivar `next` da linha seguinte produz `undefined`, que
  // não é `null`, e o topo cairia no cálculo abaixo com nextAt indefinido,
  // gerando xpToNextRank negativo. garageProgressSchema recusa negativo, o
  // que vira 500 em GET /me/garage e GET /g/:slug.
  const atTop = index === RANK_TIERS.length - 1;
  if (atTop) {
    return {
      xp,
      rank: resolveName(index, names),
      nextRank: null,
      xpInTier: xp - tier.min,
      xpToNextRank: 0,
      tierSpan: 1,
    };
  }

  const nextAt = tier.nextAt as number;
  return {
    xp,
    rank: resolveName(index, names),
    nextRank: resolveName(index + 1, names),
    xpInTier: xp - tier.min,
    xpToNextRank: nextAt - xp,
    tierSpan: nextAt - tier.min,
  };
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/garage/progress.test.ts`
Expected: PASS, 14 testes.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/api/src/services/garage/progress.ts apps/api/test/garage/progress.test.ts
git add apps/api/src/services/garage/progress.ts apps/api/test/garage/progress.test.ts
git commit -m "feat(api): niveis encadeiam por chave, guard de topo posicional"
```

---

### Task 3: Ler `rankNames` do banco e passar aos chamadores

**Files:**

- Modify: `apps/api/src/services/garage/progress.ts` (`getGarageProgress`)
- Modify: `apps/api/src/routes/garage.ts:96-116` e `:510-522`
- Create: `apps/api/src/services/garage/rank-names.ts`
- Modify: `apps/api/test/garage/progress.test.ts`

**Interfaces:**

- Consumes: `RankNames`, `deriveProgress` (Task 2).
- Produces: `readRankNames(client?): Promise<RankNames>` e `getGarageProgress(client, garageId, names?)`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/test/garage/progress.test.ts`, novo `describe`:

```ts
describe('readRankNames', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.generalSettings.deleteMany();
  });

  it('devolve mapa vazio quando a linha nao existe', async () => {
    expect(await readRankNames()).toEqual({});
  });

  it('devolve mapa vazio quando rankNames e nulo', async () => {
    await prisma.generalSettings.create({ data: { id: GENERAL_SETTINGS_SINGLETON_ID } });
    expect(await readRankNames()).toEqual({});
  });

  it('devolve o mapa quando valido', async () => {
    await prisma.generalSettings.create({
      data: {
        id: GENERAL_SETTINGS_SINGLETON_ID,
        rankNames: {
          iniciante: 'Novato',
          pilotador: 'Piloto',
          veterano: 'Veterano',
          lendario: 'Lenda',
          hall_of_fame: 'Panteão',
        },
      },
    });
    expect((await readRankNames()).iniciante).toBe('Novato');
  });

  // A coluna e Json sem forma no banco: migration, psql na mao ou um writer
  // futuro podem deixar lixo la. As duas rotas que consomem isso fazem parse
  // da propria resposta, entao um throw aqui e 500 em caminho quente.
  it('nao explode com forma invalida, cai no mapa vazio', async () => {
    await prisma.generalSettings.create({
      data: { id: GENERAL_SETTINGS_SINGLETON_ID, rankNames: { iniciante: 42 } },
    });
    expect(await readRankNames()).toEqual({});
  });
});
```

Imports novos no topo do arquivo:

```ts
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import { readRankNames } from '../../src/services/garage/rank-names.js';
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/garage/progress.test.ts`
Expected: FAIL — `rank-names.js` não existe.

- [ ] **Step 3: Implementar a leitura tolerante**

`apps/api/src/services/garage/rank-names.ts`:

```ts
import { prisma } from '@ccc/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import type { RankNames } from './progress.js';
import { RANK_KEYS } from './progress.js';

type ReadClient = PrismaClient | Prisma.TransactionClient;

// Leitura tolerante de propósito. A escrita valida forma completa
// (packages/shared/src/admin-gamification.ts); aqui qualquer coisa fora do
// formato cai no mapa vazio, que faz deriveProgress usar os nomes de código.
// Um throw neste ponto seria 500 em GET /me/garage e GET /g/:slug.
const loose = z.object(
  Object.fromEntries(RANK_KEYS.map((k) => [k, z.string().min(1).optional()])) as Record<
    (typeof RANK_KEYS)[number],
    z.ZodOptional<z.ZodString>
  >,
);

export const readRankNames = async (client: ReadClient = prisma): Promise<RankNames> => {
  const row = await client.generalSettings.findUnique({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    select: { rankNames: true },
  });
  if (!row?.rankNames) return {};
  const parsed = loose.safeParse(row.rankNames);
  return parsed.success ? parsed.data : {};
};
```

- [ ] **Step 4: Aceitar o mapa em `getGarageProgress`**

Em `apps/api/src/services/garage/progress.ts`, trocar a assinatura:

```ts
export const getGarageProgress = async (
  client: ReadClient,
  garageId: string,
  names: RankNames = {},
): Promise<GarageProgress> => {
  const row = await client.garage.findUniqueOrThrow({
    where: { id: garageId },
    select: { xp: true },
  });
  return deriveProgress(row.xp, names);
};
```

- [ ] **Step 5: Passar o mapa nos dois chamadores**

Em `apps/api/src/routes/garage.ts`, `loadOwnerView` já lê o killswitch em
`await readGamificationEnabled()` antes do `Promise.all`. Ler os nomes junto,
uma vez, em vez de deixar `getGarageProgress` fazer uma segunda leitura do
mesmo singleton por request:

```ts
const gamificationEnabled = await readGamificationEnabled();
const rankNames = gamificationEnabled ? await readRankNames() : {};
```

e trocar a linha do `Promise.all`:

```ts
    gamificationEnabled ? getGarageProgress(prisma, garage.id, rankNames) : Promise.resolve(null),
```

Repetir exatamente o mesmo par no handler público, em volta do `Promise.all`
de `:514`. Import novo:

```ts
import { readRankNames } from '../services/garage/rank-names.js';
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/garage && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write apps/api/src/services/garage/rank-names.ts apps/api/src/services/garage/progress.ts apps/api/src/routes/garage.ts apps/api/test/garage/progress.test.ts
git add apps/api/src/services/garage apps/api/src/routes/garage.ts apps/api/test/garage/progress.test.ts
git commit -m "feat(api): nomes de nivel vem do banco com leitura tolerante"
```

---

### Task 4: `title` e `description` no wire

**Files:**

- Modify: `packages/shared/src/badges.ts`
- Modify: `apps/api/src/routes/badges-catalog.ts:8-13,44-50`
- Modify: `apps/api/src/services/garage/badges-read.ts:39-45`
- Modify: `apps/api/test/garage/badges.test.ts`

**Interfaces:**

- Produces: `badgeCatalogEntrySchema` com `title?` e `description?`, e os dois serializers emitindo os campos. A Task 9 (mobile) consome.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/test/garage/badges.test.ts`, no bloco que já exercita
`GET /me/garage/badges`:

```ts
it('catalogo carrega title e description do banco', async () => {
  await seedCatalog();
  const { user } = await createUser({ email: 'copy@jdm.test', verified: true });
  await prisma.badge.update({
    where: { code: 'EVT-001' },
    data: { title: 'Título Editado', description: 'Descrição editada.' },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/me/garage/badges',
    headers: { authorization: bearer(loadEnv(), user.id, 'user') },
  });
  const body = garageBadgesOwnerResponseSchema.parse(res.json());
  const entry = body.catalog.find((c) => c.code === 'EVT-001');
  expect(entry?.title).toBe('Título Editado');
  expect(entry?.description).toBe('Descrição editada.');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/garage/badges.test.ts`
Expected: FAIL — `entry.title` é `undefined`.

- [ ] **Step 3: Alargar o schema**

Em `packages/shared/src/badges.ts`, dentro de `badgeCatalogEntrySchema`:

```ts
  // Opcionais no wire mesmo sendo NOT NULL no banco. É o que dá o fallback do
  // bundle: um app novo contra uma API velha não recebe os campos e usa a copy
  // embutida, em vez de estourar no parse. O caminho inverso já era seguro,
  // porque este objeto não é .strict() e app velho descarta chave nova.
  title: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(240).optional(),
```

- [ ] **Step 4: Emitir nos dois serializers**

Zod remove chave desconhecida, não adiciona: sem editar os dois, o schema novo
é inerte.

`apps/api/src/services/garage/badges-read.ts:39-45`, dentro do `.map`:

```ts
    title: b.title,
    description: b.description,
```

`apps/api/src/routes/badges-catalog.ts:44-50`, mesma adição no `.map`.

No mesmo arquivo, corrigir o comentário de `:8-13`, que hoje afirma que o
catálogo é imutável em runtime:

```ts
// Module-level catalog cache. O catálogo passou a ser mutável pelo admin
// (PUT /admin/gamification/copy), então o TTL não é mais seguro por premissa:
// aquele handler chama invalidateBadgesCatalogCache() depois de commitar. O
// killswitch continua fora do cache — ele MUST propagar em < 1s.
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/garage/badges.test.ts && cd ../../packages/shared && pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/shared/src/badges.ts apps/api/src/routes/badges-catalog.ts apps/api/src/services/garage/badges-read.ts apps/api/test/garage/badges.test.ts
git add packages/shared/src/badges.ts apps/api/src/routes/badges-catalog.ts apps/api/src/services/garage/badges-read.ts apps/api/test/garage/badges.test.ts
git commit -m "feat(api): catalogo de conquistas carrega titulo e descricao"
```

---

### Task 5: Awarder lê o título do banco

**Files:**

- Modify: `apps/api/src/services/garage/awarder.ts:4,166`
- Modify: `packages/shared/src/badges-copy.ts`
- Modify: `apps/api/test/admin/badge-notification.test.ts:21,79,111`

**Interfaces:**

- Produces: notificação de conquista com o título vindo de `Badge.title`. Remove `badgeTitlePtBr` e `BADGE_TITLES_PT_BR` do pacote shared.

- [ ] **Step 1: Corrigir as asserções e a fixture**

As duas asserções de hoje comparam contra a constante que vai sumir. Pior: se a
fixture receber o título canônico, o teste passa sem provar que o awarder lê do
banco. A fixture recebe um título **diferente** do canônico de propósito.

Em `apps/api/test/admin/badge-notification.test.ts:21`, na criação do badge:

```ts
      // Título deliberadamente diferente do canônico: é o que prova que o
      // corpo da notificação vem da linha do banco, e não de uma constante.
      title: 'Título Vindo do Banco',
      description: 'Descrição da fixture.',
```

Em `:79`:

```ts
expect(row.body).toBe('Título Vindo do Banco');
```

Em `:111`, o mesmo para o badge daquele bloco (`CAR-003`), usando o título que
a fixture correspondente definir.

Remover o import de `badgeTitlePtBr` no topo do arquivo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/admin/badge-notification.test.ts`
Expected: FAIL — `body` ainda é `'Primeira Largada'`, vindo da constante.

- [ ] **Step 3: Trocar a fonte no awarder**

`awarder.ts:101` já faz `const badge = await tx.badge.findUnique({ where: { code } })`
e `:102` lança se não achar, então a linha está em escopo. Em `:166`:

```ts
            body: badge.title,
```

Remover `badgeTitlePtBr` do import de `:4`.

- [ ] **Step 4: Deletar a constante**

Em `packages/shared/src/badges-copy.ts`, remover `BADGE_TITLES_PT_BR` e
`badgeTitlePtBr`. Com `Badge.title` NOT NULL e o awarder lendo a linha, os dois
ficam inalcançáveis. Manter `BADGE_AWARDED_NOTIFICATION_TITLE`,
`BADGE_AWARDED_NOTIFICATION_KIND` e `badgeAwardedDedupeKey`, e atualizar o
comentário do topo do arquivo, que descreve a tabela removida.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/admin test/garage && pnpm typecheck`
Expected: PASS. Se algum arquivo ainda importar `badgeTitlePtBr`, o typecheck aponta.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/api/src/services/garage/awarder.ts packages/shared/src/badges-copy.ts apps/api/test/admin/badge-notification.test.ts
git add apps/api/src/services/garage/awarder.ts packages/shared/src/badges-copy.ts apps/api/test/admin/badge-notification.test.ts
git commit -m "feat(api): notificacao de conquista usa o titulo do banco"
```

---

### Task 6: Schemas do admin e uniões de auditoria

**Files:**

- Create: `packages/shared/src/admin-gamification.ts`
- Create: `packages/shared/src/__tests__/admin-gamification.test.ts`
- Modify: `packages/shared/package.json`, `packages/shared/src/admin.ts`, `apps/api/src/services/admin-audit.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `RANK_KEYS` (reexportado), `rankNamesSchema`, `adminGamificationCopySchema`, `gamificationCopyUpdateSchema`, `BADGE_TITLE_MAX`, `RANK_NAME_MAX`. A Task 7 consome.

`RANK_KEYS` vive em `progress.ts`, que é server-only. Aqui a lista é
redeclarada, e um teste amarra as duas para não divergirem.

- [ ] **Step 1: Escrever os testes que falham**

`packages/shared/src/__tests__/admin-gamification.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  BADGE_TITLE_MAX,
  RANK_NAME_MAX,
  gamificationCopyUpdateSchema,
  rankNamesSchema,
} from '../admin-gamification.js';

const base = { expectedVersion: 0 };

describe('gamificationCopyUpdateSchema', () => {
  it('exige expectedVersion', () => {
    expect(() => gamificationCopyUpdateSchema.parse({})).toThrow();
  });

  it('trima titulo e recusa branco ou longo demais', () => {
    const ok = gamificationCopyUpdateSchema.parse({
      ...base,
      badges: [{ code: 'EVT-001', title: '  X  ', description: 'ok' }],
    });
    expect(ok.badges?.[0]?.title).toBe('X');
    expect(() =>
      gamificationCopyUpdateSchema.parse({
        ...base,
        badges: [{ code: 'EVT-001', title: '   ', description: 'ok' }],
      }),
    ).toThrow();
    expect(() =>
      gamificationCopyUpdateSchema.parse({
        ...base,
        badges: [{ code: 'EVT-001', title: 'a'.repeat(BADGE_TITLE_MAX + 1), description: 'ok' }],
      }),
    ).toThrow();
  });

  it('recusa mais de 12 entradas', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({
      code: `EVT-${String(i).padStart(3, '0')}`,
      title: 'T',
      description: 'D',
    }));
    expect(() => gamificationCopyUpdateSchema.parse({ ...base, badges: many })).toThrow();
  });

  // z.record(z.enum(...)) tipa como Record completo mas nao valida
  // exaustividade em runtime: um PUT com uma chave so passaria e apagaria
  // quatro nomes. Por isso rankNamesSchema e z.object com as cinco chaves.
  it('exige as cinco chaves de nivel', () => {
    expect(() => rankNamesSchema.parse({ iniciante: 'X' })).toThrow();
    const full = {
      iniciante: 'A',
      pilotador: 'B',
      veterano: 'C',
      lendario: 'D',
      hall_of_fame: 'E',
    };
    expect(rankNamesSchema.parse(full)).toEqual(full);
    expect(() =>
      rankNamesSchema.parse({ ...full, iniciante: 'a'.repeat(RANK_NAME_MAX + 1) }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/admin-gamification.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`packages/shared/src/admin-gamification.ts`:

```ts
// Schemas do admin para a copy de gamificação. As chaves de nível são
// redeclaradas aqui porque apps/api/.../progress.ts é server-only e não pode
// ser importado pelo admin; um teste em apps/api amarra as duas listas.

import { z } from 'zod';

import { badgeCodeSchema } from './badges.js';

export const RANK_KEYS = [
  'iniciante',
  'pilotador',
  'veterano',
  'lendario',
  'hall_of_fame',
] as const;
export type RankKey = (typeof RANK_KEYS)[number];

/**
 * Caps vindos do que renderiza, não da coluna. BadgeDetail centraliza o título
 * em fontSize 22 sem maxWidth nem numberOfLines, e a pílula de nível em
 * XPScoreboard é fontSize 10 uppercase com letterSpacing 1.6 numa row sem
 * flexShrink. Os títulos atuais têm no máximo 18 caracteres e o maior nome de
 * nível tem 12, então os caps são folgados. As colunas seguem em 80 e 240.
 */
export const BADGE_TITLE_MAX = 40;
export const BADGE_DESCRIPTION_MAX = 240;
export const RANK_NAME_MAX = 20;

/** Quantas conquistas o catálogo tem. Um PUT maior que isto é recusado. */
export const BADGE_COPY_MAX_ENTRIES = 12;

// z.object com as cinco chaves obrigatórias, não z.record: em Zod 3 um
// z.record(z.enum(...)) tipa a saída como Record completo mas não valida
// exaustividade em runtime.
export const rankNamesSchema = z.object({
  iniciante: z.string().trim().min(1).max(RANK_NAME_MAX),
  pilotador: z.string().trim().min(1).max(RANK_NAME_MAX),
  veterano: z.string().trim().min(1).max(RANK_NAME_MAX),
  lendario: z.string().trim().min(1).max(RANK_NAME_MAX),
  hall_of_fame: z.string().trim().min(1).max(RANK_NAME_MAX),
});
export type RankNamesInput = z.infer<typeof rankNamesSchema>;

// Escrita: capada no que renderiza.
export const badgeCopyEntrySchema = z.object({
  code: badgeCodeSchema,
  title: z.string().trim().min(1).max(BADGE_TITLE_MAX),
  description: z.string().trim().min(1).max(BADGE_DESCRIPTION_MAX),
});

// Leitura: capada no que a COLUNA aceita, não no cap de escrita. Um título de
// 60 caracteres gravado por SQL direto cabe na coluna (VarChar(80)) e faria o
// GET estourar se reusasse o cap de 40, transformando um dado estranho num 500.
export const badgeCopyReadEntrySchema = z.object({
  code: badgeCodeSchema,
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(BADGE_DESCRIPTION_MAX),
});

export const adminGamificationCopySchema = z.object({
  version: z.number().int().nonnegative(),
  badges: z.array(badgeCopyReadEntrySchema),
  rankNames: rankNamesSchema,
});
export type AdminGamificationCopy = z.infer<typeof adminGamificationCopySchema>;

export const gamificationCopyUpdateSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  badges: z.array(badgeCopyEntrySchema).max(BADGE_COPY_MAX_ENTRIES).optional(),
  rankNames: rankNamesSchema.optional(),
});
export type GamificationCopyUpdate = z.infer<typeof gamificationCopyUpdateSchema>;
```

- [ ] **Step 4: Export e uniões de auditoria**

Em `packages/shared/package.json`, no `exports`, abaixo de `"./admin-box"`:

```json
    "./admin-gamification": {
      "types": "./src/admin-gamification.ts",
      "default": "./dist/admin-gamification.js"
    },
```

Em `packages/shared/src/admin.ts`: `'gamification_copy.update'` em
`adminAuditActionSchema` e `'gamification_copy'` em
`adminAuditEntityTypeSchema`.

Em `apps/api/src/services/admin-audit.ts`: `| 'gamification_copy'` no union de
`RecordAuditInput['entityType']`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd packages/shared && pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/shared/src/admin-gamification.ts packages/shared/src/__tests__/admin-gamification.test.ts packages/shared/src/admin.ts packages/shared/package.json apps/api/src/services/admin-audit.ts
git add packages/shared apps/api/src/services/admin-audit.ts
git commit -m "feat(shared): schemas de admin da copy de gamificacao"
```

---

### Task 7: Rotas admin com compare-and-swap

**Files:**

- Create: `apps/api/src/routes/admin/gamification-copy.ts`
- Create: `apps/api/test/admin/gamification-copy.test.ts`
- Modify: `apps/api/src/routes/admin/index.ts`

**Interfaces:**

- Consumes: schemas da Task 6, `RANK_KEYS` de `progress.ts` (Task 2), `invalidateBadgesCatalogCache` de `routes/badges-catalog.js`, `ensureGeneralSettings`, `recordAudit`.
- Produces: `adminGamificationCopyRoutes`. A Task 8 consome pelo admin-api.

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/test/admin/gamification-copy.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { adminGamificationCopySchema } from '@ccc/shared/admin-gamification';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, resetDatabase, makeApp } from '../helpers.js';

const seedTwo = async () => {
  await prisma.badge.createMany({
    data: [
      {
        code: 'EVT-001',
        category: 'eventos',
        rarity: 'common',
        icon: 'flag',
        title: 'Primeira Largada',
        description: 'Desc 1',
      },
      {
        code: 'CAR-001',
        category: 'carros',
        rarity: 'common',
        icon: 'car',
        title: 'Garagem Aberta',
        description: 'Desc 2',
      },
    ],
  });
};

const FULL_RANKS = {
  iniciante: 'Novato',
  pilotador: 'Piloto',
  veterano: 'Veterano',
  lendario: 'Lenda',
  hall_of_fame: 'Panteão',
};

describe('admin gamification copy', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.generalSettings.deleteMany();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const admin = async () =>
    (await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' })).user;

  const get = (id: string) =>
    app.inject({
      method: 'GET',
      url: '/admin/gamification/copy',
      headers: { authorization: bearer(loadEnv(), id, 'admin') },
    });

  const put = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url: '/admin/gamification/copy',
      headers: { authorization: bearer(loadEnv(), id, 'admin') },
      payload,
    });

  it('GET funciona com a linha de GeneralSettings ausente', async () => {
    await seedTwo();
    const user = await admin();
    const res = await get(user.id);
    expect(res.statusCode).toBe(200);
    const body = adminGamificationCopySchema.parse(res.json());
    expect(body.version).toBe(0);
    expect(body.badges).toHaveLength(2);
    expect(body.rankNames.iniciante).toBe('Iniciante');
  });

  it('PUT altera texto e nomes, e o GET seguinte reflete', async () => {
    await seedTwo();
    const user = await admin();
    const before = adminGamificationCopySchema.parse((await get(user.id)).json());

    const res = await put(user.id, {
      expectedVersion: before.version,
      badges: [{ code: 'EVT-001', title: 'Largada', description: 'Nova desc.' }],
      rankNames: FULL_RANKS,
    });
    expect(res.statusCode).toBe(200);

    const after = adminGamificationCopySchema.parse((await get(user.id)).json());
    expect(after.badges.find((b) => b.code === 'EVT-001')?.title).toBe('Largada');
    expect(after.rankNames.hall_of_fame).toBe('Panteão');
    expect(after.version).toBe(before.version + 1);
  });

  it('codigo fora do catalogo responde 400 e nao cria linha', async () => {
    await seedTwo();
    const user = await admin();
    const res = await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'ZZZ-999', title: 'X', description: 'Y' }],
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.badge.count()).toBe(2);
  });

  it('codigo repetido responde 400', async () => {
    await seedTwo();
    const user = await admin();
    const res = await put(user.id, {
      expectedVersion: 0,
      badges: [
        { code: 'EVT-001', title: 'A', description: 'A' },
        { code: 'EVT-001', title: 'B', description: 'B' },
      ],
    });
    expect(res.statusCode).toBe(400);
  });

  it('expectedVersion velho responde 409 e nao escreve nada', async () => {
    await seedTwo();
    const user = await admin();
    await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Primeiro', description: 'D' }],
    });

    const stale = await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Segundo', description: 'D' }],
    });
    expect(stale.statusCode).toBe(409);
    const row = await prisma.badge.findUniqueOrThrow({ where: { code: 'EVT-001' } });
    expect(row.title).toBe('Primeiro');
  });

  // Serial nao prova nada aqui: ler-comparar-escrever passa em serie e perde
  // update em paralelo, porque Read Committed nao trava linha no SELECT.
  it('duas escritas concorrentes com a mesma versao: uma vence, a outra 409', async () => {
    await seedTwo();
    const user = await admin();
    const [a, b] = await Promise.all([
      put(user.id, {
        expectedVersion: 0,
        badges: [{ code: 'EVT-001', title: 'A', description: 'D' }],
      }),
      put(user.id, {
        expectedVersion: 0,
        badges: [{ code: 'EVT-001', title: 'B', description: 'D' }],
      }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const settings = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    expect(settings.gamificationCopyVersion).toBe(1);
  });

  it('PUT sem mudanca nao audita e nao incrementa versao', async () => {
    await seedTwo();
    const user = await admin();
    const res = await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Primeira Largada', description: 'Desc 1' }],
    });
    expect(res.statusCode).toBe(200);
    const body = adminGamificationCopySchema.parse(res.json());
    expect(body.version).toBe(0);
    expect(await prisma.adminAudit.count()).toBe(0);
  });

  it('PUT com mudanca audita os campos tocados', async () => {
    await seedTwo();
    const user = await admin();
    await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Largada', description: 'Desc 1' }],
    });
    const audit = await prisma.adminAudit.findFirstOrThrow();
    expect(audit.action).toBe('gamification_copy.update');
    expect(audit.entityType).toBe('gamification_copy');
    const metadata = audit.metadata as { fields: string[] };
    expect(metadata.fields).toContain('badge.EVT-001.title');
  });

  it('staff e organizer tomam 403, sem auth toma 401', async () => {
    const { user: staff } = await createUser({
      email: 's@jdm.test',
      verified: true,
      role: 'staff',
    });
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });

    expect((await app.inject({ method: 'GET', url: '/admin/gamification/copy' })).statusCode).toBe(
      401,
    );
    for (const [id, role] of [
      [staff.id, 'staff'],
      [org.id, 'organizer'],
    ] as const) {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/gamification/copy',
        headers: { authorization: bearer(loadEnv(), id, role) },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('GET /badges/catalog logo apos o PUT ja mostra o titulo novo', async () => {
    await seedTwo();
    const user = await admin();

    // Popula o cache de 5 minutos antes da escrita.
    await app.inject({ method: 'GET', url: '/badges/catalog' });

    await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Depois do PUT', description: 'D' }],
    });

    const res = await app.inject({ method: 'GET', url: '/badges/catalog' });
    const body = res.json() as { catalog: { code: string; title?: string }[] };
    expect(body.catalog.find((c) => c.code === 'EVT-001')?.title).toBe('Depois do PUT');
  });

  it('as chaves de nivel do shared batem com as do progress', async () => {
    const { RANK_KEYS: serverKeys } = await import('../../src/services/garage/progress.js');
    const { RANK_KEYS: sharedKeys } = await import('@ccc/shared/admin-gamification');
    expect([...sharedKeys]).toEqual([...serverKeys]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/admin/gamification-copy.test.ts`
Expected: FAIL — 404 nas rotas.

- [ ] **Step 3: Implementar**

`apps/api/src/routes/admin/gamification-copy.ts`:

```ts
/**
 * gamification-copy admin — texto das conquistas e nomes de nível.
 *
 *   GET /admin/gamification/copy
 *   PUT /admin/gamification/copy
 *
 * requireRole('admin'), e não organizer como general-settings: o título da
 * conquista vira o corpo da notificação que o grant manual
 * (admin/user-garage.ts:397, organizer, 30/min) manda para um usuário
 * escolhido. O canal deliberado de organizer para usuário é o broadcast,
 * limitado a 5 por 15 minutos. Deixar copy em organizer abriria um caminho
 * direcionado e 360x mais frouxo.
 */

import { prisma } from '@ccc/db';
import {
  RANK_KEYS,
  adminGamificationCopySchema,
  gamificationCopyUpdateSchema,
} from '@ccc/shared/admin-gamification';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { RANK_TIERS } from '../../services/garage/progress.js';
import { ensureGeneralSettings } from '../../services/general-settings.js';
import { invalidateBadgesCatalogCache } from '../badges-catalog.js';

const codeName = (key: (typeof RANK_KEYS)[number]): string =>
  RANK_TIERS.find((t) => t.key === key)?.name ?? key;

// eslint-disable-next-line @typescript-eslint/require-await
export const adminGamificationCopyRoutes: FastifyPluginAsync = async (app) => {
  const readCopy = async () => {
    // ensureGeneralSettings, não findUnique: a linha pode não existir (é por
    // isso que readGamificationEnabled faz `?? true`). Sem criar aqui, o
    // primeiro PUT num banco limpo daria 409 para sempre, porque o updateMany
    // não casaria nenhuma linha.
    const settings = await ensureGeneralSettings();
    const badges = await prisma.badge.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, title: true, description: true },
    });

    const stored = (settings.rankNames ?? {}) as Record<string, unknown>;
    const rankNames = Object.fromEntries(
      RANK_KEYS.map((key) => [
        key,
        typeof stored[key] === 'string' && stored[key] !== ''
          ? (stored[key] as string)
          : codeName(key),
      ]),
    );

    return adminGamificationCopySchema.parse({
      version: settings.gamificationCopyVersion,
      badges,
      rankNames,
    });
  };

  app.get('/gamification/copy', async () => readCopy());

  app.put('/gamification/copy', async (request, reply) => {
    const { sub } = requireUser(request);
    const input = gamificationCopyUpdateSchema.parse(request.body);
    const incoming = input.badges ?? [];

    const seen = new Set<string>();
    for (const entry of incoming) {
      if (seen.has(entry.code)) {
        return reply.status(400).send({ error: 'duplicate_code', code: entry.code });
      }
      seen.add(entry.code);
    }

    const existingBadges = await prisma.badge.findMany({
      select: { code: true, title: true, description: true },
    });
    const byCode = new Map(existingBadges.map((b) => [b.code, b]));
    for (const entry of incoming) {
      if (!byCode.has(entry.code)) {
        return reply.status(400).send({ error: 'unknown_badge', code: entry.code });
      }
    }

    const settings = await ensureGeneralSettings();

    const touched: string[] = [];
    const badgeWrites = incoming.filter((entry) => {
      const current = byCode.get(entry.code)!;
      const titleChanged = current.title !== entry.title;
      const descChanged = current.description !== entry.description;
      if (titleChanged) touched.push(`badge.${entry.code}.title`);
      if (descChanged) touched.push(`badge.${entry.code}.description`);
      return titleChanged || descChanged;
    });

    const storedRanks = (settings.rankNames ?? {}) as Record<string, unknown>;
    const ranksChanged =
      input.rankNames !== undefined &&
      RANK_KEYS.some((key) => storedRanks[key] !== input.rankNames![key]);
    if (ranksChanged) touched.push('rankNames');

    if (touched.length === 0) {
      return readCopy();
    }

    // A precondição É a escrita. Ler a versão, comparar em JS e depois gravar
    // perde update mesmo dentro de $transaction: o default é Read Committed e
    // um SELECT não trava linha, então dois admins que leem a versão 5 passam
    // os dois no teste e gravam os dois. Este updateMany é a primeira operação
    // da transação, e a linha de GeneralSettings serializa os concorrentes.
    let stale = false;
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.generalSettings.updateMany({
        where: {
          id: GENERAL_SETTINGS_SINGLETON_ID,
          gamificationCopyVersion: input.expectedVersion,
        },
        data: {
          gamificationCopyVersion: { increment: 1 },
          ...(ranksChanged ? { rankNames: input.rankNames } : {}),
        },
      });
      if (count !== 1) {
        stale = true;
        return;
      }

      for (const entry of badgeWrites) {
        await tx.badge.update({
          where: { code: entry.code },
          data: { title: entry.title, description: entry.description },
        });
      }

      await recordAudit(
        {
          actorId: sub,
          action: 'gamification_copy.update',
          entityType: 'gamification_copy',
          entityId: GENERAL_SETTINGS_SINGLETON_ID,
          metadata: { fields: touched },
        },
        tx,
      );
    });

    if (stale) {
      return reply.status(409).send({ error: 'stale_write' });
    }

    // DEPOIS do commit. Dentro da transação, uma leitura concorrente
    // repopularia `cached` com linhas pré-commit e fixaria texto velho pelo
    // TTL inteiro, pior que não invalidar.
    invalidateBadgesCatalogCache();

    return readCopy();
  });
};
```

- [ ] **Step 4: Registrar em bloco próprio**

Em `apps/api/src/routes/admin/index.ts`, importar e acrescentar um bloco novo,
no molde do bloco de documentos de identidade (`:132-145`):

```ts
// Copy de gamificação: admin-only (o título vira corpo de notificação que
// organizer consegue disparar via grant manual) com balde isolado de
// 30/min/ator. hook: 'preHandler' para o keyGenerator rodar DEPOIS de a auth
// popular request.user — sem isso o plugin corre em onRequest e cai num
// balde compartilhado por IP.
await app.register(async (scope) => {
  scope.addHook('preHandler', scope.requireRole('admin'));
  await scope.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => {
      const auth = (req as unknown as { user?: { sub?: string } }).user;
      return auth?.sub
        ? `admin-gamification-copy:${auth.sub}`
        : `admin-gamification-copy-ip:${req.ip}`;
    },
  });
  await scope.register(adminGamificationCopyRoutes);
});
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/admin/gamification-copy.test.ts`
Expected: PASS, 11 testes.

Run: `cd apps/api && pnpm typecheck && pnpm lint`
Expected: sem erro, warnings não acima de 79.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/api/src/routes/admin/gamification-copy.ts apps/api/src/routes/admin/index.ts apps/api/test/admin/gamification-copy.test.ts
git add apps/api/src/routes/admin apps/api/test/admin/gamification-copy.test.ts
git commit -m "feat(api): rotas admin da copy de gamificacao com CAS de versao"
```

---

### Task 8: Tela no admin

**Files:**

- Create: `apps/admin/app/(authed)/configuracoes/conquistas/page.tsx`, `configuracoes/gamification-copy-form.tsx`, `configuracoes/gamification-copy-form.interaction.test.tsx`, `apps/admin/src/lib/gamification-copy-actions.ts`
- Modify: `apps/admin/src/lib/admin-api.ts`, `apps/admin/app/(authed)/configuracoes/settings-tabs.tsx`

**Interfaces:**

- Consumes: rotas da Task 7, schemas da Task 6, e a infraestrutura de abas do plano da home.
- Produces: a rota `/configuracoes/conquistas`.

- [ ] **Step 1: Acrescentar a aba**

Em `apps/admin/app/(authed)/configuracoes/settings-tabs.tsx`, no `TABS`:

```ts
  { href: '/configuracoes/conquistas', label: 'Conquistas' },
```

A regra `isActiveTab` daquele arquivo já trata Gerais por igualdade exata, então
a aba nova não a ativa por prefixo. Não mexer nela.

- [ ] **Step 2: Wrappers e actions**

Em `apps/admin/src/lib/admin-api.ts`:

```ts
import {
  adminGamificationCopySchema,
  type AdminGamificationCopy,
  type GamificationCopyUpdate,
} from '@ccc/shared/admin-gamification';

export const getAdminGamificationCopy = (): Promise<AdminGamificationCopy> =>
  apiFetch('/admin/gamification/copy', { schema: adminGamificationCopySchema });

export const updateAdminGamificationCopy = (
  input: GamificationCopyUpdate,
): Promise<AdminGamificationCopy> =>
  apiFetch('/admin/gamification/copy', {
    method: 'PUT',
    body: JSON.stringify(input),
    schema: adminGamificationCopySchema,
  });
```

`apps/admin/src/lib/gamification-copy-actions.ts`:

```ts
'use server';

import type { AdminGamificationCopy, GamificationCopyUpdate } from '@ccc/shared/admin-gamification';
import { unstable_rethrow } from 'next/navigation';

import { getAdminGamificationCopy, updateAdminGamificationCopy } from './admin-api';
import { ApiError } from './api';

export type GamificationCopyActionResult =
  | { ok: true; copy: AdminGamificationCopy }
  | { ok: false; error: string };

export const fetchAdminGamificationCopy = async (): Promise<AdminGamificationCopy> =>
  getAdminGamificationCopy();

export const updateAdminGamificationCopyAction = async (
  input: GamificationCopyUpdate,
): Promise<GamificationCopyActionResult> => {
  try {
    const copy = await updateAdminGamificationCopy(input);
    return { ok: true, copy };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return {
          ok: false,
          error:
            'Alguém editou esta página enquanto você escrevia. Recarregue e refaça a alteração.',
        };
      }
      if (err.status === 400) {
        return { ok: false, error: 'Dados inválidos. Revise os campos e tente novamente.' };
      }
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};
```

- [ ] **Step 3: Escrever o teste de interação que falha**

`apps/admin/app/(authed)/configuracoes/gamification-copy-form.interaction.test.tsx`:

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { AdminGamificationCopy } from '@ccc/shared/admin-gamification';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));

vi.mock('~/lib/gamification-copy-actions', () => ({
  updateAdminGamificationCopyAction: updateMock,
}));

import { GamificationCopyForm } from './gamification-copy-form';

const initial: AdminGamificationCopy = {
  version: 3,
  badges: [
    { code: 'EVT-001', title: 'Primeira Largada', description: 'Desc 1' },
    { code: 'CAR-001', title: 'Garagem Aberta', description: 'Desc 2' },
  ],
  rankNames: {
    iniciante: 'Iniciante',
    pilotador: 'Pilotador',
    veterano: 'Veterano',
    lendario: 'Lendário',
    hall_of_fame: 'Hall of Fame',
  },
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const input = (label: string): HTMLInputElement =>
  container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

const setValue = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const clickByText = (text: string) => {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('GamificationCopyForm', () => {
  beforeEach(() => {
    updateMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('manda a versao lida junto com a edicao', async () => {
    updateMock.mockResolvedValue({ ok: true, copy: { ...initial, version: 4 } });
    await act(async () => {
      root.render(<GamificationCopyForm initial={initial} />);
    });

    setValue(input('Título de EVT-001'), 'Largada');
    await act(async () => {
      clickByText('Salvar');
    });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3 }));
    const sent = updateMock.mock.calls[0]![0] as { badges: { code: string; title: string }[] };
    expect(sent.badges.find((b) => b.code === 'EVT-001')?.title).toBe('Largada');
  });

  it('usa a versao nova depois de salvar', async () => {
    updateMock.mockResolvedValue({ ok: true, copy: { ...initial, version: 4 } });
    await act(async () => {
      root.render(<GamificationCopyForm initial={initial} />);
    });

    await act(async () => {
      clickByText('Salvar');
    });
    await act(async () => {
      clickByText('Salvar');
    });

    expect(updateMock.mock.calls[1]![0]).toEqual(expect.objectContaining({ expectedVersion: 4 }));
  });

  it('mostra a mensagem de conflito', async () => {
    updateMock.mockResolvedValue({ ok: false, error: 'Alguém editou esta página. Recarregue.' });
    await act(async () => {
      root.render(<GamificationCopyForm initial={initial} />);
    });
    await act(async () => {
      clickByText('Salvar');
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Recarregue');
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd apps/admin && pnpm exec vitest run "app/(authed)/configuracoes/gamification-copy-form.interaction.test.tsx"`
Expected: FAIL — módulo não existe.

- [ ] **Step 5: Form**

`apps/admin/app/(authed)/configuracoes/gamification-copy-form.tsx`:

```tsx
'use client';

import {
  BADGE_DESCRIPTION_MAX,
  BADGE_TITLE_MAX,
  RANK_KEYS,
  RANK_NAME_MAX,
  type AdminGamificationCopy,
} from '@ccc/shared/admin-gamification';
import { useState, useTransition } from 'react';

import { updateAdminGamificationCopyAction } from '~/lib/gamification-copy-actions';

const labelCls = 'flex flex-col gap-1 text-sm';
const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

const RANK_LABEL: Record<(typeof RANK_KEYS)[number], string> = {
  iniciante: 'Nível 1',
  pilotador: 'Nível 2',
  veterano: 'Nível 3',
  lendario: 'Nível 4',
  hall_of_fame: 'Nível 5',
};

export const GamificationCopyForm = ({ initial }: { initial: AdminGamificationCopy }) => {
  const [version, setVersion] = useState(initial.version);
  const [badges, setBadges] = useState(initial.badges);
  const [ranks, setRanks] = useState(initial.rankNames);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const patchBadge = (code: string, field: 'title' | 'description', value: string) =>
    setBadges((prev) => prev.map((b) => (b.code === code ? { ...b, [field]: value } : b)));

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateAdminGamificationCopyAction({
        expectedVersion: version,
        badges,
        rankNames: ranks,
      });
      if (result.ok) {
        setVersion(result.copy.version);
        setBadges(result.copy.badges);
        setRanks(result.copy.rankNames);
        setMessage({ kind: 'ok', text: 'Copy salva.' });
        return;
      }
      setMessage({ kind: 'error', text: result.error });
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Níveis</h2>
        {RANK_KEYS.map((key) => (
          <label key={key} className={labelCls}>
            <span>
              {RANK_LABEL[key]} ({ranks[key].length}/{RANK_NAME_MAX})
            </span>
            <input
              className={inputCls}
              aria-label={`Nome do ${RANK_LABEL[key]}`}
              maxLength={RANK_NAME_MAX}
              value={ranks[key]}
              onChange={(e) => setRanks((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </label>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Conquistas</h2>
        {badges.map((b) => (
          <div
            key={b.code}
            className="flex flex-col gap-2 rounded border border-[color:var(--color-border)] p-3"
          >
            <span className="text-xs font-mono text-[color:var(--color-muted)]">{b.code}</span>
            <label className={labelCls}>
              <span>
                Título ({b.title.length}/{BADGE_TITLE_MAX})
              </span>
              <input
                className={inputCls}
                aria-label={`Título de ${b.code}`}
                maxLength={BADGE_TITLE_MAX}
                value={b.title}
                onChange={(e) => patchBadge(b.code, 'title', e.target.value)}
              />
            </label>
            <label className={labelCls}>
              <span>
                Descrição ({b.description.length}/{BADGE_DESCRIPTION_MAX})
              </span>
              <input
                className={inputCls}
                aria-label={`Descrição de ${b.code}`}
                maxLength={BADGE_DESCRIPTION_MAX}
                value={b.description}
                onChange={(e) => patchBadge(b.code, 'description', e.target.value)}
              />
            </label>
          </div>
        ))}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
        >
          Salvar
        </button>
        {message ? (
          <p
            role="alert"
            className={message.kind === 'ok' ? 'text-sm text-green-400' : 'text-sm text-red-400'}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Page**

`apps/admin/app/(authed)/configuracoes/conquistas/page.tsx`:

```tsx
import { GamificationCopyForm } from '../gamification-copy-form';

import { fetchAdminGamificationCopy } from '~/lib/gamification-copy-actions';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesConquistasPage() {
  const copy = await fetchAdminGamificationCopy();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Conquistas e níveis</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Nome e descrição das conquistas e nome dos níveis. A alteração aparece no próximo
          carregamento da garagem, sem publicar versão nova.
        </p>
      </header>
      <GamificationCopyForm initial={copy} />
    </div>
  );
}
```

O gate de staff não é repetido aqui: mora em `configuracoes/layout.tsx`. A API
ainda barra staff e organizer com `requireRole('admin')`.

- [ ] **Step 7: Rodar e ver passar**

Run: `cd apps/admin && pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write "apps/admin/app/(authed)/configuracoes" apps/admin/src/lib/gamification-copy-actions.ts apps/admin/src/lib/admin-api.ts
git add "apps/admin/app/(authed)/configuracoes" apps/admin/src/lib
git commit -m "feat(admin): tela de copy de conquistas e niveis"
```

---

### Task 9: Mobile consome a copy da API

**Files:**

- Modify: `apps/mobile/app/(app)/garage/index.tsx:8,31-37,252`
- Modify: `apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx`

**Interfaces:**

- Consumes: `title`/`description` opcionais no catálogo (Task 4).
- Produces: nada. É o consumidor final.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx`. O
`CATALOG` do arquivo (`:356-365`) não traz `title` nem `description`, então
todos os testes existentes já exercitam o ramo de fallback sem alteração
nenhuma. Falta o ramo em que a API manda o texto:

```tsx
const CATALOG_WITH_COPY: GarageBadgesOwnerResponse['catalog'] = [
  {
    code: 'EVT-001',
    category: 'eventos',
    rarity: 'common',
    premiumExclusive: false,
    icon: 'flag',
    title: 'Título da API',
    description: 'Descrição da API.',
  },
  ...CATALOG.slice(1),
];
```

e o caso, no mesmo `describe` que já abre a `BadgesSheet` (copiar dele o setup
de mocks e a forma de abrir a sheet, que este arquivo já define):

```tsx
it('usa o texto da API quando o catalogo traz title', async () => {
  // ... mesmo setup dos testes de sheet deste arquivo, trocando o aggregate:
  // makeBadgesAggregate({ catalog: CATALOG_WITH_COPY, badges: [earnedBadge('EVT-001')] })
  expect(screen.getByText('Título da API')).toBeTruthy();
  expect(screen.queryByText('Primeira Largada')).toBeNull();
});
```

Ao escrever, copie o setup do teste de sheet vizinho em vez de inventar: este
arquivo tem mocks de router e de API próprios, e os seletores de acessibilidade
usados nele (`Conquista EVT-001`, de `packages/ui/src/HexBadge.tsx:85`) são
baseados em código, não em título, então continuam valendo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/garage/__tests__/GarageIndexRoute.test.tsx`
Expected: FAIL — renderiza `'Primeira Largada'`, do bundle.

- [ ] **Step 3: Derivar do catálogo**

Em `apps/mobile/app/(app)/garage/index.tsx`, remover o `BADGE_COPY` de escopo de
módulo (`:31-37`) e derivar por resposta, dentro do componente:

```tsx
// Copy vem da API quando disponível, com fallback para o bundle. O fallback
// não é zelo: `title`/`description` são opcionais no wire de propósito, para
// um app novo contra uma API velha não ficar sem texto.
const badgeCopy = useMemo<Record<string, BadgesSheetCopy | undefined>>(() => {
  const catalog = badgesAggregate?.catalog ?? [];
  return Object.fromEntries(
    catalog.map((entry) => [
      entry.code,
      {
        title: entry.title ?? badgesCopy.badges.catalog[entry.code]?.title,
        description: entry.description ?? badgesCopy.badges.catalog[entry.code]?.description,
      },
    ]),
  );
}, [badgesAggregate]);
```

Trocar o uso em `:252` de `BADGE_COPY` para `badgeCopy`. Acrescentar `useMemo`
ao import de `react`.

A `BadgesSheet` já é renderizada só quando `badgesAggregate !== null` (`:243`),
então o catálogo é sempre o mesmo objeto de resposta que trouxe as linhas.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/garage && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write "apps/mobile/app/(app)/garage/index.tsx" apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx
git add "apps/mobile/app/(app)/garage/index.tsx" apps/mobile/src/screens/garage/__tests__/GarageIndexRoute.test.tsx
git commit -m "feat(mobile): copy de conquista vem da API com fallback do bundle"
```

---

## Verificação final

- [ ] `cd packages/shared && pnpm exec vitest run && pnpm typecheck && pnpm lint`
- [ ] `cd packages/db && pnpm typecheck`
- [ ] `cd apps/api && pnpm typecheck && pnpm lint`
- [ ] `cd apps/admin && pnpm exec vitest run && pnpm typecheck && pnpm lint`
- [ ] `cd apps/mobile && pnpm exec vitest run && pnpm typecheck`
- [ ] Suíte cheia da API (~13 min) antes do PR: `cd apps/api && pnpm exec vitest run`
- [ ] Conferir na aplicação: editar um título no admin, recarregar a garagem no app, ver o texto novo sem republicar.
- [ ] PR contra `main`, nunca `production`.
