# Tela de Início — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar `/welcome` na vitrine do clube para usuário não logado, com conteúdo institucional, benefícios, planos e destaques vindos do banco de dados, sem republicar o app.

**Architecture:** Uma tabela singleton (`HomeContent`) mais duas tabelas filhas (`HomeBenefit`, `HomeHighlight`) alimentam um endpoint público único `GET /api/home-content`, que também serializa os planos existentes de `PremiumPlan`. Um segundo endpoint público `GET /api/club-stats` devolve os contadores do clube, com cache de cinco minutos. A rota `/welcome` renderiza dois estados isolados: `GuestHome` monta a vitrine do anônimo a partir do conteúdo institucional mais leituras públicas que já existiam (eventos, loja, planos, carros confirmados); `MemberHome` monta a home do membro conforme o handoff, surfando o que o app já tem (próximo evento, ingressos, garagem com XP e badges, assinatura, caixa) com degradação por bloco.

**Tech Stack:** Prisma 6 + Postgres, Zod 3, Fastify 5, Expo Router 6 + React Native, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-08-19-tela-inicio-design.md`
**Handoff de design:** `.handoffs/design_handoff_inicio/`

## Global Constraints

- Branch de trabalho: `feat/tela-inicial`. Nunca commitar em `production`. PR abre contra `main`.
- Todo texto de UI em PT-BR, literal, sem inventar copy nova fora dos arquivos `src/copy/*`.
- Sem em-dash e sem hífen de substituição em **copy de UI** (arquivos `src/copy/*`, textos que o usuário lê) e em mensagens de commit. Comentários de código seguem o estilo já estabelecido no arquivo vizinho: `packages/shared/src/premium-catalog.ts` e `apps/api/src/routes/premium-catalog.ts` usam em-dash em comentários, e divergir disso criaria inconsistência pior que a regra evita. Ruling do controller na Task 2, registrado no ledger.
- Não usar `Date.now()` em fixtures de teste onde a ordenação importe; usar datas fixas.
- Nenhum id de provider (`stripePriceId`, `rcProductId`) pode aparecer em resposta de API.
- `GET /api/home-content` é **unauthed**, igual `premium-catalog.ts` e `store.ts`.
- Não alterar `/api/plans`, `PremiumPlanPrice`, `PremiumPlanBenefit` nem qualquer tela fora da home.
- Não alterar os tokens de cor existentes em `packages/design` (`brandDeep`, `brandSoft`, `surface`). Só adicionar novos.
- Não tocar em `apps/mobile/src/screens/assinaturas/tier-visual.ts`. Ele duplica a paleta do handoff; a consolidação é dívida registrada para outro PR.
- Padrão de componente mobile desta tela: `StyleSheet.create` mais `Text`/`View` do `react-native`, seguindo `src/screens/assinaturas/PlanosScreen.tsx`. Não usar classes NativeWind nos componentes novos. `@ccc/ui` **é** permitido e desejado quando o componente já existe lá: `XPScoreboard`, `BadgeRow` e `PremiumBadge` são reusados na home do membro em vez de reimplementados. O que não se faz é criar primitivo novo dentro de `@ccc/ui` para esta tela.
- O boilerplate de render de teste (`container`, `root`, `render`, `click`, `beforeEach`/`afterEach` com `IS_REACT_ACT_ENVIRONMENT`) se repete por arquivo de teste de propósito. É a convenção já usada em `src/screens/assinaturas/__tests__/`, e extrair um helper compartilhado é refactor de infraestrutura de teste fora do escopo desta entrega.
- Ícones vêm de `lucide-react-native`. Nomes Material do handoff são mapeados, não importados.
- `GET /api/club-stats` é **unauthed** e **tem** cache de cinco minutos em memória. `GET /api/home-content` é unauthed e **não** tem cache. A assimetria é deliberada: contador defasado não muda decisão de ninguém, conteúdo editável precisa aparecer na hora.
- Regra de erro, diferente nos dois estados. No `GuestHome` a falha do conteúdo institucional é total, porque hero, benefícios, planos e destaques curados vêm todos dele. No `MemberHome` cada bloco falha para dentro de si e esconde só a própria seção, porque são seis fontes independentes.
- Nenhuma seção da vitrine do anônimo pode aparecer para o membro, e nenhuma seção do membro pode aparecer para o anônimo. Os dois testes de montagem travam isso explicitamente.
- Seção sem conteúdo renderiza `null`. A tela nunca mostra cabeçalho de seção sem nada abaixo. Zero é conteúdo válido nos contadores e renderiza normalmente.
- Componentes de seção são puros: recebem dados por prop e não chamam API. Quem busca é `GuestHome`, `MemberHome` ou um hook dedicado.
- Commits frequentes, um por task no mínimo.

## Estrutura de arquivos

| Arquivo                                                                   | Responsabilidade                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/db/prisma/schema.prisma`                                        | modelos `HomeContent`, `HomeBenefit`, `HomeHighlight`, enum `HomeHighlightKind`, coluna `PremiumPlan.homeFeatured` |
| `packages/db/prisma/migrations/20260819000000_home_content/migration.sql` | DDL                                                                                                                |
| `packages/db/prisma/seed.ts`                                              | `seedHomeContent()` idempotente                                                                                    |
| `packages/shared/src/home.ts`                                             | schemas Zod do payload da home                                                                                     |
| `packages/shared/package.json`                                            | entrada `./home` no mapa de exports                                                                                |
| `apps/api/src/services/home-content.ts`                                   | `ensureHomeContent()`                                                                                              |
| `apps/api/src/routes/home-content.ts`                                     | `GET /api/home-content`                                                                                            |
| `apps/api/src/app.ts`                                                     | registro do plugin                                                                                                 |
| `apps/api/test/helpers.ts`                                                | limpeza das tabelas novas                                                                                          |
| `apps/api/test/home-content.route.test.ts`                                | teste de integração                                                                                                |
| `packages/design/src/tokens.ts`                                           | tokens de cor do handoff                                                                                           |
| `packages/design/tailwind-preset.cjs`                                     | espelho dos tokens                                                                                                 |
| `apps/mobile/app/_layout.tsx`                                             | pesos Jost 500/600/700                                                                                             |
| `apps/mobile/src/copy/inicio.ts`                                          | copy PT-BR                                                                                                         |
| `apps/mobile/src/api/home.ts`                                             | `getHomeContent()`                                                                                                 |
| `apps/mobile/src/hooks/useHomeContent.ts`                                 | estado de carregamento                                                                                             |
| `apps/mobile/src/screens/inicio/palette.ts`                               | paleta derivada dos tokens                                                                                         |
| `apps/mobile/src/screens/inicio/icons.ts`                                 | mapa de chave de ícone para lucide                                                                                 |
| `apps/mobile/src/screens/inicio/components/SectionLabel.tsx`              | label dourado                                                                                                      |
| `apps/mobile/src/screens/inicio/components/GoldPill.tsx`                  | CTA gradiente dourado                                                                                              |
| `apps/mobile/src/screens/inicio/components/FeatureCard.tsx`               | card de destaque                                                                                                   |
| `apps/mobile/src/screens/inicio/sections/HeroSection.tsx`                 | Seção 1                                                                                                            |
| `apps/mobile/src/screens/inicio/sections/BenefitsSection.tsx`             | Seção 2                                                                                                            |
| `apps/mobile/src/screens/inicio/sections/CtaSection.tsx`                  | Seções 3 e 4                                                                                                       |
| `apps/mobile/src/screens/inicio/sections/PlansSection.tsx`                | Seção 5                                                                                                            |
| `apps/mobile/src/screens/inicio/sections/HighlightsSection.tsx`           | Seção 6                                                                                                            |
| `apps/mobile/src/screens/inicio/GuestHome.tsx`                            | monta as 6 seções                                                                                                  |
| `apps/mobile/src/screens/inicio/MemberHome.tsx`                           | estado logado, movido de `welcome.tsx`                                                                             |
| `apps/mobile/src/screens/inicio/InicioScreen.tsx`                         | escolhe guest, member ou skeleton                                                                                  |
| `apps/mobile/app/welcome.tsx`                                             | wrapper de uma linha                                                                                               |
| `apps/mobile/src/auth/redirect-intent.ts`                                 | libera `/assinaturas` no `next`                                                                                    |

---

### Task 1: Banco de dados

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260819000000_home_content/migration.sql`
- Modify: `packages/db/prisma/seed.ts`
- Modify: `apps/api/test/helpers.ts`

**Interfaces:**

- Consumes: nada.
- Produces: modelos Prisma `HomeContent`, `HomeBenefit`, `HomeHighlight`, enum `HomeHighlightKind` com valores `event | day_use | experience | partner`, coluna `PremiumPlan.homeFeatured: boolean`. Clientes Prisma: `prisma.homeContent`, `prisma.homeBenefit`, `prisma.homeHighlight`.

- [ ] **Step 1: Adicionar o enum e os modelos ao schema**

Em `packages/db/prisma/schema.prisma`, no fim do arquivo, adicionar:

```prisma
// Conteúdo institucional da tela de Início. Singleton no padrão de
// GeneralSettings / BoxSettings: uma linha só, id constante, todas as colunas
// com default para que o upsert de criação passe apenas o id.
// Editável direto no banco; o CRUD admin entra em PR seguinte.
model HomeContent {
  id                          String   @id
  heroTitle                   String   @default("DIRIGIR. CONECTAR. PERTENCER.") @db.VarChar(120)
  heroSubtitle                String?  @db.VarChar(200)
  heroBannerObjectKey         String?  @db.VarChar(300)
  institutionalTitle          String   @default("A Casa") @db.VarChar(120)
  institutionalBody           String   @default("Um clubhouse automotivo privado em Curitiba, feito para quem dirige, conecta e pertence.") @db.VarChar(1000)
  institutionalImageObjectKey String?  @db.VarChar(300)
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt
}

/// Benefício da assinatura exibido na Seção 2 da Início. `icon` é uma chave
/// resolvida no front (src/screens/inicio/icons.ts); chave desconhecida cai
/// no ícone padrão em vez de quebrar a renderização.
model HomeBenefit {
  id          String   @id @default(cuid())
  icon        String   @db.VarChar(40)
  title       String   @db.VarChar(80)
  description String?  @db.VarChar(240)
  active      Boolean  @default(true)
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([active, sortOrder])
}

enum HomeHighlightKind {
  event
  day_use
  experience
  partner
}

/// Destaque curado da Seção 6 da Início. Cobre Day Use e experiências
/// automotivas, que não têm modelo de domínio próprio. `linkPath` é uma rota
/// interna do app; nulo significa card informativo, não clicável.
model HomeHighlight {
  id             String            @id @default(cuid())
  kind           HomeHighlightKind
  title          String            @db.VarChar(80)
  subtitle       String?           @db.VarChar(140)
  imageObjectKey String?           @db.VarChar(300)
  linkPath       String?           @db.VarChar(200)
  active         Boolean           @default(true)
  sortOrder      Int               @default(0)
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  @@index([active, sortOrder])
}
```

- [ ] **Step 2: Adicionar `homeFeatured` ao `PremiumPlan`**

No modelo `PremiumPlan` existente (`packages/db/prisma/schema.prisma`, por volta da linha 501), depois de `sortOrder`, adicionar:

```prisma
  /// Status de exibição na Seção 5 da tela de Início. `active` e `sortOrder`
  /// continuam sendo a fonte da ordem e da disponibilidade do plano; esta
  /// coluna só decide se o plano aparece no resumo da home.
  homeFeatured          Boolean           @default(true)
```

- [ ] **Step 3: Escrever a migration**

Criar `packages/db/prisma/migrations/20260819000000_home_content/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "HomeHighlightKind" AS ENUM ('event', 'day_use', 'experience', 'partner');

-- CreateTable
CREATE TABLE "HomeContent" (
    "id" TEXT NOT NULL,
    "heroTitle" VARCHAR(120) NOT NULL DEFAULT 'DIRIGIR. CONECTAR. PERTENCER.',
    "heroSubtitle" VARCHAR(200),
    "heroBannerObjectKey" VARCHAR(300),
    "institutionalTitle" VARCHAR(120) NOT NULL DEFAULT 'A Casa',
    "institutionalBody" VARCHAR(1000) NOT NULL DEFAULT 'Um clubhouse automotivo privado em Curitiba, feito para quem dirige, conecta e pertence.',
    "institutionalImageObjectKey" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeBenefit" (
    "id" TEXT NOT NULL,
    "icon" VARCHAR(40) NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeHighlight" (
    "id" TEXT NOT NULL,
    "kind" "HomeHighlightKind" NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(140),
    "imageObjectKey" VARCHAR(300),
    "linkPath" VARCHAR(200),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeBenefit_active_sortOrder_idx" ON "HomeBenefit"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "HomeHighlight_active_sortOrder_idx" ON "HomeHighlight"("active", "sortOrder");

-- AlterTable
ALTER TABLE "PremiumPlan" ADD COLUMN "homeFeatured" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 4: Gerar o client e conferir que schema e migration batem**

```bash
pnpm --filter @ccc/db db:generate
```

Esperado: `Generated Prisma Client` sem erro.

```bash
pnpm --filter @ccc/db exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
```

Esperado: exit code 0, ou seja, nenhuma diferença entre a migration escrita à mão e o schema. Se a variável `SHADOW_DATABASE_URL` não estiver disponível no ambiente local, rodar em vez disso `pnpm --filter @ccc/db db:reset` contra o Postgres do `docker-compose.yml` e confirmar que aplica sem erro.

- [ ] **Step 5: Escrever o seed idempotente**

Em `packages/db/prisma/seed.ts`, antes de `const main`, adicionar:

```ts
// Keep in sync with HOME_CONTENT_SINGLETON_ID in @ccc/shared/home.
const HOME_CONTENT_SINGLETON_ID = 'home_default';

const HOME_BENEFITS = [
  {
    icon: 'calendar',
    title: 'Eventos exclusivos',
    description: 'Encontros, track days e drives fechados só para membros.',
  },
  {
    icon: 'sun',
    title: 'Day Use na sede',
    description: 'Acesso ao clubhouse em Curitiba nos dias liberados do seu plano.',
  },
  {
    icon: 'handshake',
    title: 'Benefícios com parceiros',
    description: 'Condições especiais em oficinas, estética e serviços automotivos.',
  },
  {
    icon: 'star',
    title: 'Módulos premium',
    description: 'Detalhamento, garagem estendida e serviços recorrentes opcionais.',
  },
  {
    icon: 'tag',
    title: 'Descontos em experiências',
    description: 'Valores de membro nas experiências e nas vagas de garagem.',
  },
] as const;

const HOME_HIGHLIGHTS = [
  {
    kind: 'event' as const,
    title: 'Próximos encontros',
    subtitle: 'A agenda do clube, mês a mês.',
    linkPath: '/events',
  },
  {
    kind: 'day_use' as const,
    title: 'Day Use',
    subtitle: 'Um dia na sede, com a sua máquina.',
    linkPath: null,
  },
  {
    kind: 'experience' as const,
    title: 'Experiências automotivas',
    subtitle: 'Drives guiados e track days.',
    linkPath: null,
  },
  {
    kind: 'partner' as const,
    title: 'Parceiros do clube',
    subtitle: 'Quem cuida do seu carro com condição de membro.',
    linkPath: null,
  },
] as const;

const seedHomeContent = async (): Promise<void> => {
  // Singleton: update vazio, para uma reexecução do seed não sobrescrever
  // texto ajustado direto no banco. Mesmo idiom de seedBoxSettings.
  await prisma.homeContent.upsert({
    where: { id: HOME_CONTENT_SINGLETON_ID },
    update: {},
    create: { id: HOME_CONTENT_SINGLETON_ID },
  });

  // Benefícios e destaques não têm unique natural além do título. Delete e
  // recria por bloco mantém a ordem autoritativa e é trivialmente idempotente,
  // mesmo idiom de premiumPlanBenefit em seedPremiumCatalog.
  await prisma.homeBenefit.deleteMany();
  await prisma.homeBenefit.createMany({
    data: HOME_BENEFITS.map((b, index) => ({
      icon: b.icon,
      title: b.title,
      description: b.description,
      active: true,
      sortOrder: index,
    })),
  });

  await prisma.homeHighlight.deleteMany();
  await prisma.homeHighlight.createMany({
    data: HOME_HIGHLIGHTS.map((h, index) => ({
      kind: h.kind,
      title: h.title,
      subtitle: h.subtitle,
      linkPath: h.linkPath,
      active: true,
      sortOrder: index,
    })),
  });

  console.log(
    `Seeded home content: 1 singleton, ${HOME_BENEFITS.length} benefits, ${HOME_HIGHLIGHTS.length} highlights.`,
  );
};
```

Dentro de `main`, depois de `await seedBoxSettings();`, adicionar:

```ts
await seedHomeContent();
```

- [ ] **Step 6: Limpar as tabelas novas entre testes**

Em `apps/api/test/helpers.ts`, dentro de `resetDatabase`, na linha imediatamente após `await prisma.generalSettings.deleteMany();`, adicionar:

```ts
// Home institucional: singleton + filhas. Sem FK entre elas, ordem livre.
// O singleton persiste entre testes e o endpoint público o cria on demand,
// então limpar aqui garante que cada spec controle o próprio conteúdo.
await prisma.homeBenefit.deleteMany();
await prisma.homeHighlight.deleteMany();
await prisma.homeContent.deleteMany();
```

- [ ] **Step 7: Rodar o seed contra o Postgres local, duas vezes**

```bash
docker compose up -d db
```

```bash
pnpm --filter @ccc/db db:deploy && pnpm --filter @ccc/db db:seed && pnpm --filter @ccc/db db:seed
```

Esperado: as duas execuções terminam com `Seeded home content: 1 singleton, 5 benefits, 4 highlights.` e sem erro de unique constraint.

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @ccc/db typecheck
```

Esperado: sem erro.

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/prisma/seed.ts apps/api/test/helpers.ts
git commit -m "feat(db): conteudo institucional da tela de inicio"
```

---

### Task 2: Contratos compartilhados

**Files:**

- Create: `packages/shared/src/home.ts`
- Create: `packages/shared/src/__tests__/home.test.ts`
- Modify: `packages/shared/package.json`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: nada da Task 1 em tempo de compilação. Os valores do enum `HomeHighlightKind` são replicados literalmente aqui.
- Produces: módulo `@ccc/shared/home` exportando `HOME_CONTENT_SINGLETON_ID: string`, `HOME_PLAN_BENEFITS_LIMIT: number`, e os schemas e tipos `homeHighlightKindSchema`/`HomeHighlightKind`, `homeHeroSchema`/`HomeHero`, `homeInstitutionalSchema`/`HomeInstitutional`, `homeBenefitSchema`/`HomeBenefit`, `homeHighlightSchema`/`HomeHighlight`, `homePlanSchema`/`HomePlan`, `homeContentResponseSchema`/`HomeContentResponse`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/shared/src/__tests__/home.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  HOME_CONTENT_SINGLETON_ID,
  HOME_PLAN_BENEFITS_LIMIT,
  homeContentResponseSchema,
} from '../home.js';

const VALID = {
  hero: {
    title: 'DIRIGIR. CONECTAR. PERTENCER.',
    subtitle: null,
    bannerUrl: null,
  },
  institutional: {
    title: 'A Casa',
    body: 'Um clubhouse automotivo privado em Curitiba.',
    imageUrl: 'https://cdn.example.com/casa.webp',
  },
  benefits: [
    {
      icon: 'calendar',
      title: 'Eventos exclusivos',
      description: 'Encontros fechados.',
      sortOrder: 0,
    },
  ],
  highlights: [
    {
      kind: 'day_use',
      title: 'Day Use',
      subtitle: null,
      imageUrl: null,
      linkPath: null,
      sortOrder: 0,
    },
  ],
  plans: [
    {
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      description: null,
      fromAmountCents: 49900,
      currency: 'BRL',
      benefits: ['Day Use ilimitado'],
      sortOrder: 0,
    },
  ],
} as const;

describe('homeContentResponseSchema', () => {
  it('constants match the DB singleton id and the benefits cap', () => {
    expect(HOME_CONTENT_SINGLETON_ID).toBe('home_default');
    expect(HOME_PLAN_BENEFITS_LIMIT).toBe(3);
  });

  it('accepts a full valid payload', () => {
    expect(() => homeContentResponseSchema.parse(VALID)).not.toThrow();
  });

  it('rejects an unknown highlight kind', () => {
    const bad = { ...VALID, highlights: [{ ...VALID.highlights[0], kind: 'meetup' }] };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('rejects a non-url bannerUrl', () => {
    const bad = { ...VALID, hero: { ...VALID.hero, bannerUrl: 'not-a-url' } };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('rejects a negative fromAmountCents', () => {
    const bad = { ...VALID, plans: [{ ...VALID.plans[0], fromAmountCents: -1 }] };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('accepts empty benefits, highlights and plans', () => {
    const empty = { ...VALID, benefits: [], highlights: [], plans: [] };
    expect(() => homeContentResponseSchema.parse(empty)).not.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @ccc/shared test -- home
```

Esperado: FAIL, `Cannot find module '../home.js'`.

- [ ] **Step 3: Escrever o módulo**

Criar `packages/shared/src/home.ts`:

```ts
// packages/shared/src/home.ts
// Tela de Início — schemas de leitura do conteúdo institucional.
// Backs GET /api/home-content.
//
// Client-facing ONLY. As colunas do banco guardam objectKey de R2; o backend
// resolve para URL pública antes de serializar, então o cliente nunca vê chave
// de objeto. Ids de provider de pagamento não entram aqui, igual
// ./premium-catalog.ts.

import { z } from 'zod';

/** Id da linha única de HomeContent. Espelhado em packages/db/prisma/seed.ts. */
export const HOME_CONTENT_SINGLETON_ID = 'home_default';

/** Quantos benefícios de plano o resumo da home carrega. */
export const HOME_PLAN_BENEFITS_LIMIT = 3;

/**
 * Tipo do destaque da Seção 6. Espelha o enum HomeHighlightKind do Prisma.
 * `day_use` e `experience` não têm modelo de domínio próprio; são conteúdo
 * curado.
 */
export const homeHighlightKindSchema = z.enum(['event', 'day_use', 'experience', 'partner']);
export type HomeHighlightKind = z.infer<typeof homeHighlightKindSchema>;

/** Seção 1 — banner principal e mote. */
export const homeHeroSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  bannerUrl: z.string().url().nullable(),
});
export type HomeHero = z.infer<typeof homeHeroSchema>;

/** Seção 1 — bloco institucional. */
export const homeInstitutionalSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  imageUrl: z.string().url().nullable(),
});
export type HomeInstitutional = z.infer<typeof homeInstitutionalSchema>;

/** Seção 2 — um benefício da assinatura. `icon` é chave resolvida no cliente. */
export const homeBenefitSchema = z.object({
  icon: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type HomeBenefit = z.infer<typeof homeBenefitSchema>;

/** Seção 6 — um destaque. `linkPath` nulo significa card não clicável. */
export const homeHighlightSchema = z.object({
  kind: homeHighlightKindSchema,
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  linkPath: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type HomeHighlight = z.infer<typeof homeHighlightSchema>;

/**
 * Seção 5 — resumo de um plano. Derivado de PremiumPlan.
 * `fromAmountCents` é o menor preço ativo do plano, o "valor inicial" da
 * Story. `benefits` vem truncado em HOME_PLAN_BENEFITS_LIMIT; o detalhe
 * completo continua em GET /api/plans.
 */
export const homePlanSchema = z.object({
  tier: z.enum(['bronze', 'silver', 'gold']),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  fromAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  benefits: z.array(z.string()),
  sortOrder: z.number().int(),
});
export type HomePlan = z.infer<typeof homePlanSchema>;

/** GET /api/home-content — resposta completa, uma request por tela. */
export const homeContentResponseSchema = z.object({
  hero: homeHeroSchema,
  institutional: homeInstitutionalSchema,
  benefits: z.array(homeBenefitSchema),
  highlights: z.array(homeHighlightSchema),
  plans: z.array(homePlanSchema),
});
export type HomeContentResponse = z.infer<typeof homeContentResponseSchema>;
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @ccc/shared test -- home
```

Esperado: PASS, 6 testes.

- [ ] **Step 5: Publicar o subpath no mapa de exports**

Em `packages/shared/package.json`, no objeto `exports`, logo depois da entrada `"./health"`, adicionar:

```json
    "./home": {
      "types": "./src/home.ts",
      "default": "./dist/home.js"
    },
```

Em `packages/shared/src/index.ts`, no fim do arquivo, adicionar:

```ts
export * from './home.js';
```

- [ ] **Step 6: Build e typecheck**

```bash
pnpm --filter @ccc/shared build && pnpm --filter @ccc/shared typecheck && pnpm --filter @ccc/shared lint
```

Esperado: os três sem erro, e `packages/shared/dist/home.js` existe.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/home.ts packages/shared/src/__tests__/home.test.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(shared): schemas do payload da tela de inicio"
```

---

### Task 3: API

**Files:**

- Create: `apps/api/src/services/home-content.ts`
- Create: `apps/api/src/routes/home-content.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/home-content.route.test.ts`

**Interfaces:**

- Consumes: `@ccc/shared/home` (`HOME_CONTENT_SINGLETON_ID`, `HOME_PLAN_BENEFITS_LIMIT`, `homeContentResponseSchema`) da Task 2. Clientes Prisma da Task 1. `app.uploads.buildPublicUrl(objectKey: string): string` já existente em `src/services/uploads/index.ts`. `isUniqueConstraintError` de `src/lib/prisma-errors.js`.
- Produces: `ensureHomeContent(): Promise<HomeContent>` em `src/services/home-content.ts`. `homeContentRoutes: FastifyPluginAsync` em `src/routes/home-content.ts`. Rota `GET /api/home-content`.

- [ ] **Step 1: Escrever o teste de integração que falha**

Criar `apps/api/test/home-content.route.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { HOME_CONTENT_SINGLETON_ID, homeContentResponseSchema } from '@ccc/shared/home';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from './helpers.js';

const GET = { method: 'GET' as const, url: '/api/home-content' };

// resetDatabase NÃO limpa o catálogo premium: a convenção do repo é cada spec
// que toca em planos limpar por conta própria, filhas antes das pais. Mesmo
// idiom de test/billing/premium-catalog.test.ts. Sem isso, um plano vazado de
// outro spec colide no unique de PremiumPlan.tier.
const resetPremiumCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
};

const makePlan = (input: {
  tier: 'bronze' | 'silver' | 'gold';
  slug: string;
  name: string;
  sortOrder: number;
  active?: boolean;
  homeFeatured?: boolean;
  prices: { cadence: 'monthly' | 'annual'; baseAmountCents: number; active: boolean }[];
  benefits: string[];
}) =>
  prisma.premiumPlan.create({
    data: {
      tier: input.tier,
      slug: input.slug,
      name: input.name,
      sortOrder: input.sortOrder,
      active: input.active ?? true,
      homeFeatured: input.homeFeatured ?? true,
      prices: { create: input.prices.map((p) => ({ ...p, currency: 'BRL' })) },
      benefits: {
        create: input.benefits.map((label, index) => ({ label, sortOrder: index })),
      },
    },
  });

describe('GET /api/home-content', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await resetPremiumCatalog();
    app = await makeApp();
  });

  afterEach(async () => {
    await resetPremiumCatalog();
    await app.close();
  });

  it('responds 200 without auth and satisfies the shared schema', async () => {
    const res = await app.inject(GET);
    expect(res.statusCode).toBe(200);
    expect(() => homeContentResponseSchema.parse(res.json())).not.toThrow();
  });

  it('creates the singleton with defaults on first read', async () => {
    expect(await prisma.homeContent.count()).toBe(0);

    const res = await app.inject(GET);

    const body = homeContentResponseSchema.parse(res.json());
    expect(body.hero.title).toBe('DIRIGIR. CONECTAR. PERTENCER.');
    expect(body.hero.bannerUrl).toBeNull();
    expect(body.institutional.title).toBe('A Casa');
    expect(body.institutional.imageUrl).toBeNull();

    const row = await prisma.homeContent.findUnique({ where: { id: HOME_CONTENT_SINGLETON_ID } });
    expect(row).not.toBeNull();
  });

  it('returns persisted hero and institutional copy', async () => {
    await prisma.homeContent.create({
      data: {
        id: HOME_CONTENT_SINGLETON_ID,
        heroTitle: 'MOTE NOVO',
        heroSubtitle: 'Subtitulo',
        institutionalTitle: 'Titulo institucional',
        institutionalBody: 'Corpo institucional',
      },
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.hero.title).toBe('MOTE NOVO');
    expect(body.hero.subtitle).toBe('Subtitulo');
    expect(body.institutional.title).toBe('Titulo institucional');
    expect(body.institutional.body).toBe('Corpo institucional');
  });

  it('resolves objectKey columns into absolute urls', async () => {
    await prisma.homeContent.create({
      data: {
        id: HOME_CONTENT_SINGLETON_ID,
        heroBannerObjectKey: 'home/banner.webp',
        institutionalImageObjectKey: 'home/casa.webp',
      },
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.hero.bannerUrl).toContain('home/banner.webp');
    expect(body.institutional.imageUrl).toContain('home/casa.webp');
    expect(JSON.stringify(body)).not.toContain('objectKey');
  });

  it('hides inactive benefits and orders the active ones by sortOrder', async () => {
    await prisma.homeBenefit.createMany({
      data: [
        { icon: 'star', title: 'Segundo', active: true, sortOrder: 1 },
        { icon: 'tag', title: 'Oculto', active: false, sortOrder: 0 },
        { icon: 'sun', title: 'Primeiro', active: true, sortOrder: 0 },
      ],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.benefits.map((b) => b.title)).toEqual(['Primeiro', 'Segundo']);
  });

  it('hides inactive highlights and orders the active ones by sortOrder', async () => {
    await prisma.homeHighlight.createMany({
      data: [
        { kind: 'experience', title: 'Segundo', active: true, sortOrder: 1 },
        { kind: 'partner', title: 'Oculto', active: false, sortOrder: 0 },
        { kind: 'day_use', title: 'Primeiro', active: true, sortOrder: 0 },
      ],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.highlights.map((h) => h.title)).toEqual(['Primeiro', 'Segundo']);
    expect(body.highlights[0].kind).toBe('day_use');
  });

  it('uses the cheapest active price as fromAmountCents and caps benefits at three', async () => {
    await makePlan({
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      sortOrder: 0,
      prices: [
        { cadence: 'monthly', baseAmountCents: 49900, active: true },
        { cadence: 'annual', baseAmountCents: 39900, active: true },
      ],
      benefits: ['Um', 'Dois', 'Tres', 'Quatro'],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].fromAmountCents).toBe(39900);
    expect(body.plans[0].currency).toBe('BRL');
    expect(body.plans[0].benefits).toEqual(['Um', 'Dois', 'Tres']);
  });

  it('ignores inactive prices when computing fromAmountCents', async () => {
    await makePlan({
      tier: 'silver',
      slug: 'prata',
      name: 'Prata',
      sortOrder: 0,
      prices: [
        { cadence: 'monthly', baseAmountCents: 29900, active: true },
        { cadence: 'annual', baseAmountCents: 9900, active: false },
      ],
      benefits: ['Um'],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.plans[0].fromAmountCents).toBe(29900);
  });

  it('excludes plans that are inactive, not featured, or have no active price', async () => {
    await makePlan({
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      sortOrder: 0,
      homeFeatured: false,
      prices: [{ cadence: 'monthly', baseAmountCents: 49900, active: true }],
      benefits: ['Um'],
    });
    await makePlan({
      tier: 'silver',
      slug: 'prata',
      name: 'Prata',
      sortOrder: 1,
      active: false,
      prices: [{ cadence: 'monthly', baseAmountCents: 29900, active: true }],
      benefits: ['Um'],
    });
    await makePlan({
      tier: 'bronze',
      slug: 'bronze',
      name: 'Bronze',
      sortOrder: 2,
      prices: [{ cadence: 'monthly', baseAmountCents: 19900, active: false }],
      benefits: ['Um'],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.plans).toEqual([]);
  });

  it('orders featured plans by sortOrder', async () => {
    await makePlan({
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      sortOrder: 2,
      prices: [{ cadence: 'monthly', baseAmountCents: 49900, active: true }],
      benefits: ['Um'],
    });
    await makePlan({
      tier: 'bronze',
      slug: 'bronze',
      name: 'Bronze',
      sortOrder: 0,
      prices: [{ cadence: 'monthly', baseAmountCents: 19900, active: true }],
      benefits: ['Um'],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.plans.map((p) => p.slug)).toEqual(['bronze', 'ouro']);
  });

  it('never serializes provider price ids', async () => {
    await prisma.premiumPlan.create({
      data: {
        tier: 'gold',
        slug: 'ouro',
        name: 'Ouro',
        sortOrder: 0,
        active: true,
        homeFeatured: true,
        prices: {
          create: [
            {
              cadence: 'monthly',
              baseAmountCents: 49900,
              currency: 'BRL',
              active: true,
              stripePriceId: 'price_leak_me',
              rcProductId: 'rc_leak_me',
            },
          ],
        },
      },
    });

    const raw = (await app.inject(GET)).body;
    expect(raw).not.toContain('price_leak_me');
    expect(raw).not.toContain('rc_leak_me');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @ccc/api test -- home-content
```

Esperado: FAIL. Todos os casos retornam 404 porque a rota não existe.

- [ ] **Step 3: Escrever o service**

Criar `apps/api/src/services/home-content.ts`:

```ts
import { prisma } from '@ccc/db';
import { HOME_CONTENT_SINGLETON_ID } from '@ccc/shared/home';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';

/**
 * Lê a linha única de HomeContent, criando com os defaults do schema quando
 * ainda não existe. Mesmo idiom de ensureGeneralSettings: o upsert pode
 * colidir com uma request concorrente, e nesse caso a leitura vence.
 */
export const ensureHomeContent = async () => {
  try {
    return await prisma.homeContent.upsert({
      where: { id: HOME_CONTENT_SINGLETON_ID },
      update: {},
      create: { id: HOME_CONTENT_SINGLETON_ID },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return prisma.homeContent.findUniqueOrThrow({
        where: { id: HOME_CONTENT_SINGLETON_ID },
      });
    }
    throw err;
  }
};
```

- [ ] **Step 4: Escrever a rota**

Criar `apps/api/src/routes/home-content.ts`:

```ts
/**
 * home-content route — READ side do conteúdo institucional da tela de Início.
 *
 *   GET /api/home-content — hero, institucional, benefícios, destaques, planos
 *
 * UNAUTHED, como os outros catálogos de leitura (premium-catalog.ts, store.ts).
 * A Início é a primeira tela do app e roda antes do login.
 *
 * Sem cache em memória de propósito: o critério de aceite é conteúdo editável
 * no banco surtindo efeito sem republicar o app, e um TTL atrasaria isso. Se
 * virar problema de carga, o cache entra junto com o CRUD admin, que é quem
 * sabe invalidar.
 *
 * Uma request devolve a tela inteira. Ids de provider (stripePriceId,
 * rcProductId) ficam nas linhas do banco e nunca são serializados.
 */

import { prisma } from '@ccc/db';
import rateLimit from '@fastify/rate-limit';
import { HOME_PLAN_BENEFITS_LIMIT, homeContentResponseSchema } from '@ccc/shared/home';
import type {
  PremiumPlan as DbPremiumPlan,
  PremiumPlanBenefit as DbPremiumPlanBenefit,
  PremiumPlanPrice as DbPremiumPlanPrice,
} from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { ensureHomeContent } from '../services/home-content.js';

type PlanWithRelations = DbPremiumPlan & {
  prices: DbPremiumPlanPrice[];
  benefits: DbPremiumPlanBenefit[];
};

/**
 * Linha de preço mais barata entre as ativas. Devolve a linha inteira, e não
 * só o valor, para que a moeda serializada seja a do preço escolhido.
 */
const cheapestActivePrice = (plan: PlanWithRelations): DbPremiumPlanPrice | null =>
  plan.prices.reduce<DbPremiumPlanPrice | null>(
    (best, price) => (best === null || price.baseAmountCents < best.baseAmountCents ? price : best),
    null,
  );

export const homeContentRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `home-content:${req.ip}`,
  });

  app.get('/api/home-content', async () => {
    const [content, benefits, highlights, plans] = await Promise.all([
      ensureHomeContent(),
      prisma.homeBenefit.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.homeHighlight.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.premiumPlan.findMany({
        where: { active: true, homeFeatured: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          prices: { where: { active: true }, orderBy: { cadence: 'asc' } },
          benefits: { orderBy: { sortOrder: 'asc' } },
        },
      }),
    ]);

    const mediaUrl = (key: string | null): string | null =>
      key ? app.uploads.buildPublicUrl(key) : null;

    const serializedPlans = plans.flatMap((plan) => {
      const price = cheapestActivePrice(plan);
      // Plano sem preço ativo não tem "valor inicial" para mostrar. Fica fora
      // em vez de renderizar um card sem preço.
      if (price === null) return [];
      return [
        {
          tier: plan.tier,
          slug: plan.slug,
          name: plan.name,
          description: plan.description,
          fromAmountCents: price.baseAmountCents,
          currency: price.currency,
          benefits: plan.benefits.slice(0, HOME_PLAN_BENEFITS_LIMIT).map((b) => b.label),
          sortOrder: plan.sortOrder,
        },
      ];
    });

    return homeContentResponseSchema.parse({
      hero: {
        title: content.heroTitle,
        subtitle: content.heroSubtitle,
        bannerUrl: mediaUrl(content.heroBannerObjectKey),
      },
      institutional: {
        title: content.institutionalTitle,
        body: content.institutionalBody,
        imageUrl: mediaUrl(content.institutionalImageObjectKey),
      },
      benefits: benefits.map((b) => ({
        icon: b.icon,
        title: b.title,
        description: b.description,
        sortOrder: b.sortOrder,
      })),
      highlights: highlights.map((h) => ({
        kind: h.kind,
        title: h.title,
        subtitle: h.subtitle,
        imageUrl: mediaUrl(h.imageObjectKey),
        linkPath: h.linkPath,
        sortOrder: h.sortOrder,
      })),
      plans: serializedPlans,
    });
  });
};
```

- [ ] **Step 5: Registrar o plugin**

Em `apps/api/src/app.ts`, junto ao bloco de imports de rotas, em ordem alfabética entre `healthRoutes` e `meBlocksRoutes`, adicionar:

```ts
import { homeContentRoutes } from './routes/home-content.js';
```

E na sequência de registros, imediatamente depois de `await app.register(premiumCatalogRoutes);`, adicionar:

```ts
await app.register(homeContentRoutes);
```

- [ ] **Step 6: Rodar e confirmar que passa**

```bash
pnpm --filter @ccc/api test -- home-content
```

Esperado: PASS, 11 testes.

- [ ] **Step 7: Typecheck e lint**

```bash
pnpm --filter @ccc/api typecheck && pnpm --filter @ccc/api lint
```

Esperado: sem erro.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/home-content.ts apps/api/src/routes/home-content.ts apps/api/src/app.ts apps/api/test/home-content.route.test.ts
git commit -m "feat(api): endpoint publico GET /api/home-content"
```

---

### Task 4: API dos contadores do clube

**Files:**

- Create: `packages/shared/src/club-stats.ts`
- Create: `packages/shared/src/__tests__/club-stats.test.ts`
- Modify: `packages/shared/package.json`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/routes/club-stats.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/club-stats.route.test.ts`

**Interfaces:**

- Consumes: nada das tasks anteriores.
- Produces:
  - `clubStatsResponseSchema` / `ClubStatsResponse` em `@ccc/shared/club-stats`, com a forma `{ members: number; events: number; cars: number }`.
  - `CLUB_STATS_CACHE_TTL_MS: number` e `invalidateClubStatsCache(): void` exportados de `apps/api/src/routes/club-stats.ts`.
  - `clubStatsRoutes: FastifyPluginAsync`.
  - Rota `GET /api/club-stats`, unauthed.

**Semântica de cada contador, decidida aqui para não ficar ambígua:**

| Campo     | Query                                                                                   | Por quê                                                                      |
| --------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `members` | `prisma.user.count({ where: { status: <valor ativo do enum UserStatus> } })`            | membros do clube, não contas desativadas                                     |
| `events`  | `prisma.event.count({ where: { status: 'published', startsAt: { gte: new Date() } } })` | eventos futuros publicados. "6 EVENTOS" na home comunica agenda, não arquivo |
| `cars`    | `prisma.car.count()`                                                                    | total de carros cadastrados em garagens                                      |

**Por que esta rota TEM cache e `/api/home-content` não:** são três `COUNT` em tabelas que crescem, na tela mais acessada do app, e um contador defasado por cinco minutos não muda decisão de ninguém. Conteúdo institucional editável é o oposto: precisa aparecer na hora, e é por isso que a outra rota ficou sem cache.

- [ ] **Step 1: Confirmar os nomes reais no schema antes de escrever qualquer query**

Ler `packages/db/prisma/schema.prisma` e anotar:

1. O nome exato do valor "ativo" do enum `UserStatus`. O código abaixo assume `'active'`. Se for outro, usar o real.
2. Os campos obrigatórios do modelo `Car`, para a fixture do teste. O código abaixo assume `userId`, `make`, `model`, `year`. Se houver mais obrigatórios, incluir.
3. Os campos obrigatórios do modelo `Event`, para `makeEvent`. O código abaixo assume o conjunto usado em `apps/api/test/events/list.test.ts`.

Ler também `apps/api/test/helpers.ts` e anotar a assinatura real de `createUser` e o que ela devolve.

Registrar no report qualquer divergência entre o que o código abaixo assume e o que o schema tem, e usar sempre o que o schema tem.

- [ ] **Step 2: Escrever o teste do schema compartilhado, que falha**

Criar `packages/shared/src/__tests__/club-stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { clubStatsResponseSchema } from '../club-stats.js';

const VALID = { members: 128, events: 6, cars: 18 } as const;

describe('clubStatsResponseSchema', () => {
  it('accepts a valid payload and returns the parsed values', () => {
    expect(clubStatsResponseSchema.parse(VALID)).toEqual(VALID);
  });

  it('accepts zeros for a brand new club', () => {
    expect(clubStatsResponseSchema.parse({ members: 0, events: 0, cars: 0 })).toEqual({
      members: 0,
      events: 0,
      cars: 0,
    });
  });

  it('rejects a negative counter', () => {
    expect(() => clubStatsResponseSchema.parse({ ...VALID, members: -1 })).toThrow();
  });

  it('rejects a fractional counter', () => {
    expect(() => clubStatsResponseSchema.parse({ ...VALID, cars: 1.5 })).toThrow();
  });

  it('rejects a missing counter', () => {
    const { cars: _cars, ...missing } = VALID;
    expect(() => clubStatsResponseSchema.parse(missing)).toThrow();
  });

  it('strips unknown keys', () => {
    const parsed = clubStatsResponseSchema.parse({ ...VALID, secret: 'nope' });
    expect(parsed).not.toHaveProperty('secret');
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/club-stats.test.ts
```

Esperado: FAIL, `Cannot find module '../club-stats.js'`.

- [ ] **Step 4: Escrever o schema compartilhado**

Criar `packages/shared/src/club-stats.ts`:

```ts
// packages/shared/src/club-stats.ts
// Contadores agregados do clube, exibidos na secao "Status do clube" da tela
// de Inicio. Backs GET /api/club-stats.
//
// Sao contagens do clube, nunca do membro: o mesmo payload serve o anonimo e o
// membro logado.

import { z } from 'zod';

export const clubStatsResponseSchema = z.object({
  /** Usuarios com status ativo. */
  members: z.number().int().nonnegative(),
  /** Eventos publicados com inicio no futuro. */
  events: z.number().int().nonnegative(),
  /** Carros cadastrados em garagens. */
  cars: z.number().int().nonnegative(),
});

export type ClubStatsResponse = z.infer<typeof clubStatsResponseSchema>;
```

- [ ] **Step 5: Publicar o subpath e o barrel**

Em `packages/shared/package.json`, no objeto `exports`, logo depois da entrada `"./check-in"`, adicionar:

```json
    "./club-stats": {
      "types": "./src/club-stats.ts",
      "default": "./dist/club-stats.js"
    },
```

Em `packages/shared/src/index.ts`, no fim do arquivo, adicionar:

```ts
export * from './club-stats.js';
```

- [ ] **Step 6: Rodar e confirmar que passa, mais build**

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/club-stats.test.ts && pnpm --filter @ccc/shared build && pnpm --filter @ccc/shared typecheck && pnpm --filter @ccc/shared lint
```

Esperado: 6 testes PASS, e `packages/shared/dist/club-stats.js` existe. Sem o build, o import de `apps/api` não resolve.

- [ ] **Step 7: Escrever o teste de integração da rota, que falha**

Criar `apps/api/test/club-stats.route.test.ts`. Ajustar as fixtures ao que o Step 1 apurou:

```ts
import { prisma } from '@ccc/db';
import { clubStatsResponseSchema } from '@ccc/shared/club-stats';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { invalidateClubStatsCache } from '../src/routes/club-stats.js';

import { createUser, makeApp, resetDatabase } from './helpers.js';

const GET = { method: 'GET' as const, url: '/api/club-stats' };

// Datas fixas de proposito. A contagem de eventos depende de "futuro", entao
// uma fixture com Date.now() ficaria fragil na virada do dia.
const PAST = new Date('2026-01-10T20:00:00.000Z');
const PAST_END = new Date('2026-01-11T02:00:00.000Z');
const FUTURE = new Date('2099-01-10T20:00:00.000Z');
const FUTURE_END = new Date('2099-01-11T02:00:00.000Z');

const makeEvent = (slug: string, startsAt: Date, endsAt: Date, status: 'published' | 'draft') =>
  prisma.event.create({
    data: {
      slug,
      title: `Evento ${slug}`,
      description: 'd',
      startsAt,
      endsAt,
      venueName: 'Sede',
      venueAddress: 'Rua A, 1',
      city: 'Curitiba',
      stateCode: 'PR',
      type: 'meeting',
      status,
      capacity: 100,
      ...(status === 'published' ? { publishedAt: PAST } : {}),
    },
  });

describe('GET /api/club-stats', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    invalidateClubStatsCache();
    app = await makeApp();
  });

  afterEach(async () => {
    invalidateClubStatsCache();
    await app.close();
  });

  it('responds 200 without auth and satisfies the shared schema', async () => {
    const res = await app.inject(GET);
    expect(res.statusCode).toBe(200);
    expect(() => clubStatsResponseSchema.parse(res.json())).not.toThrow();
  });

  it('returns zeros on an empty database', async () => {
    const res = await app.inject(GET);
    expect(clubStatsResponseSchema.parse(res.json())).toEqual({
      members: 0,
      events: 0,
      cars: 0,
    });
  });

  it('counts only future published events', async () => {
    await makeEvent('futuro-publicado', FUTURE, FUTURE_END, 'published');
    await makeEvent('passado-publicado', PAST, PAST_END, 'published');
    await makeEvent('futuro-rascunho', FUTURE, FUTURE_END, 'draft');

    const res = await app.inject(GET);
    expect(res.statusCode).toBe(200);
    const body = clubStatsResponseSchema.parse(res.json());
    expect(body.events).toBe(1);
  });

  it('counts active members and cars', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.car.create({
      data: { userId: user.id, make: 'Nissan', model: 'Skyline', year: 1999 },
    });

    const res = await app.inject(GET);
    expect(res.statusCode).toBe(200);
    const body = clubStatsResponseSchema.parse(res.json());
    expect(body.members).toBe(1);
    expect(body.cars).toBe(1);
  });

  it('serves the cached payload on a second call within the TTL', async () => {
    const first = clubStatsResponseSchema.parse((await app.inject(GET)).json());
    expect(first.cars).toBe(0);

    const { user } = await createUser({ verified: true });
    await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'NSX', year: 1992 },
    });

    // Dentro do TTL, o cache ainda serve a contagem antiga. Isso e o
    // comportamento pretendido, nao um bug.
    const second = clubStatsResponseSchema.parse((await app.inject(GET)).json());
    expect(second.cars).toBe(0);

    // Invalidado, a proxima leitura ve o carro novo. Isso prova que o valor
    // antigo veio do cache e nao de uma query errada.
    invalidateClubStatsCache();
    const third = clubStatsResponseSchema.parse((await app.inject(GET)).json());
    expect(third.cars).toBe(1);
  });
});
```

- [ ] **Step 8: Rodar e confirmar que falha**

```bash
pnpm --filter @ccc/api exec vitest run test/club-stats.route.test.ts
```

Esperado: FAIL. O import de `../src/routes/club-stats.js` não resolve.

- [ ] **Step 9: Escrever a rota**

Criar `apps/api/src/routes/club-stats.ts`. Trocar `'active'` pelo valor real do enum apurado no Step 1:

```ts
/**
 * club-stats route — contadores agregados do clube.
 *
 *   GET /api/club-stats — { members, events, cars }
 *
 * UNAUTHED, como os outros catalogos de leitura (premium-catalog.ts, store.ts).
 * A secao "Status do clube" da tela de Inicio aparece nos dois estados, logado
 * e anonimo, entao o mesmo payload serve os dois.
 *
 * COM cache em memoria, ao contrario de /api/home-content. Aqui o cache e
 * correto: sao tres COUNT em tabelas que crescem, chamados na tela mais
 * acessada do app, e um contador defasado por cinco minutos nao muda decisao
 * de ninguem. Conteudo institucional editavel e o oposto, e por isso a outra
 * rota nao tem cache. Mesmo idiom de badges-catalog.ts.
 */

import { prisma } from '@ccc/db';
import rateLimit from '@fastify/rate-limit';
import { clubStatsResponseSchema, type ClubStatsResponse } from '@ccc/shared/club-stats';
import type { FastifyPluginAsync } from 'fastify';

export const CLUB_STATS_CACHE_TTL_MS = 5 * 60 * 1000;

let cached: ClubStatsResponse | null = null;
let cachedAt = 0;

/**
 * Descarta o cache em memoria. Existe para os testes controlarem o estado
 * entre casos, e para um futuro handler admin invalidar depois de uma escrita
 * que mude as contagens. Seguro chamar com o cache vazio.
 */
export const invalidateClubStatsCache = (): void => {
  cached = null;
  cachedAt = 0;
};

export const clubStatsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `club-stats:${req.ip}`,
  });

  app.get('/api/club-stats', async () => {
    const now = Date.now();
    if (cached && now - cachedAt <= CLUB_STATS_CACHE_TTL_MS) return cached;

    const [members, events, cars] = await Promise.all([
      prisma.user.count({ where: { status: 'active' } }),
      prisma.event.count({ where: { status: 'published', startsAt: { gte: new Date() } } }),
      prisma.car.count(),
    ]);

    cached = clubStatsResponseSchema.parse({ members, events, cars });
    cachedAt = now;
    return cached;
  });
};
```

- [ ] **Step 10: Registrar o plugin**

Em `apps/api/src/app.ts`, junto ao bloco de imports de rotas, adicionar em ordem alfabética (fica antes de `devUploadRoutes`):

```ts
import { clubStatsRoutes } from './routes/club-stats.js';
```

E na sequência de registros, imediatamente depois de `await app.register(homeContentRoutes);`, adicionar:

```ts
await app.register(clubStatsRoutes);
```

- [ ] **Step 11: Rodar e confirmar que passa**

```bash
pnpm --filter @ccc/api exec vitest run test/club-stats.route.test.ts
```

Esperado: PASS, 5 testes. Se o Postgres local não estiver de pé, subir com `docker compose up -d postgres` (o serviço se chama `postgres`, não `db`, e mapeia a porta 5433 no host). Não rodar `db:reset`.

- [ ] **Step 12: Typecheck e lint**

```bash
pnpm --filter @ccc/api typecheck && pnpm --filter @ccc/api lint
```

Esperado: sem erro. Warnings pré-existentes não contam.

- [ ] **Step 13: Commit**

```bash
git add packages/shared/src/club-stats.ts packages/shared/src/__tests__/club-stats.test.ts packages/shared/src/index.ts packages/shared/package.json apps/api/src/routes/club-stats.ts apps/api/src/app.ts apps/api/test/club-stats.route.test.ts
git commit -m "feat(api): endpoint publico GET /api/club-stats"
```

---

### Task 5: Fundação mobile — tokens, fontes, copy, API

**Files:**

- Modify: `packages/design/src/tokens.ts`
- Modify: `packages/design/tailwind-preset.cjs`
- Modify: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/src/copy/inicio.ts`
- Create: `apps/mobile/src/api/home.ts`
- Create: `apps/mobile/src/hooks/useHomeContent.ts`
- Create: `apps/mobile/src/api/__tests__/home.contract.test.ts`
- Create: `apps/mobile/src/screens/inicio/palette.ts`
- Create: `apps/mobile/src/screens/inicio/icons.ts`

**Interfaces:**

- Consumes: `@ccc/shared/home` da Task 2. `request` de `~/api/client`. `color` de `@ccc/design`.
- Produces:
  - `color.goldDeep`, `color.goldLight`, `color.surfaceGold`, `color.hairlineGold`, `color.hairlineGoldStrong` em `@ccc/design`.
  - `inicioCopy` em `~/copy/inicio`.
  - `getHomeContent(): Promise<HomeContentResponse>` em `~/api/home`.
  - `useHomeContent(): { content: HomeContentResponse | null; loading: boolean; error: boolean; refresh: () => Promise<void> }` em `~/hooks/useHomeContent`.
  - `p` (paleta) em `~/screens/inicio/palette`.
  - `homeIcon(key: string): LucideIcon` em `~/screens/inicio/icons`.

- [ ] **Step 1: Adicionar os tokens de cor**

Em `packages/design/src/tokens.ts`, dentro do objeto `color`, logo depois de `brandTint`, adicionar:

```ts
  // Paleta do handoff da tela de Início (design_handoff_inicio). Valores
  // finais definidos em design. Convivem com brandDeep / brandSoft / surface,
  // que NÃO são alterados: mudar os antigos repintaria todas as outras telas.
  goldDeep: '#C9A227',
  goldLight: '#E8CE86',
  surfaceGold: '#0F0E0B',
  hairlineGold: 'rgba(212,175,55,0.14)',
  hairlineGoldStrong: 'rgba(212,175,55,0.28)',
```

- [ ] **Step 2: Espelhar no preset do Tailwind**

Em `packages/design/tailwind-preset.cjs`, dentro de `colors`, logo depois do bloco `brand`, adicionar:

```js
        // Paleta do handoff da tela de Início — espelha src/tokens.ts.
        gold: {
          deep: '#C9A227',
          light: '#E8CE86',
        },
        'surface-gold': '#0F0E0B',
        hairline: {
          gold: 'rgba(212,175,55,0.14)',
          'gold-strong': 'rgba(212,175,55,0.28)',
        },
```

- [ ] **Step 3: Verificar o build do pacote de design**

```bash
pnpm --filter @ccc/design build && pnpm --filter @ccc/design typecheck
```

Esperado: sem erro.

- [ ] **Step 4: Carregar os pesos Jost que faltam**

Em `apps/mobile/app/_layout.tsx`, trocar a linha de import do Jost por:

```ts
// Display font. Jost ships its 300 weight as Jost_300Light; we register it
// under the brand key 'Jost_300Regular' (brand.typography.displayFont).
// Os pesos 500/600/700 entram para a tela de Início, que usa a escala do
// handoff (labels 600, mote 700). Cormorant Garamond fica de fora: só serve
// aos contadores da home do membro, que não entram nesta entrega.
import {
  Jost_300Light,
  Jost_500Medium,
  Jost_600SemiBold,
  Jost_700Bold,
} from '@expo-google-fonts/jost';
```

E no objeto passado a `useFonts` (por volta da linha 165), adicionar as três chaves depois de `Jost_300Regular: Jost_300Light,`:

```ts
    Jost_500Medium,
    Jost_600SemiBold,
    Jost_700Bold,
```

- [ ] **Step 5: Escrever a copy**

Criar `apps/mobile/src/copy/inicio.ts`:

```ts
// PT-BR copy da tela de Início (vitrine do usuário não logado).
// EN scaffold kept minimal per the i18n mandate (CLAUDE.md cross-cutting).
//
// Só rótulos de UI moram aqui. Título, subtítulo, texto institucional,
// benefícios e destaques vêm do banco via GET /api/home-content.

export const inicioCopy = {
  sections: {
    benefits: 'BENEFÍCIOS DA ASSINATURA',
    plans: 'CONHEÇA OS PLANOS',
    highlights: 'EVENTOS E EXPERIÊNCIAS',
  },
  cta: {
    signup: 'CRIAR CONTA',
    signupHint: 'Leva menos de um minuto.',
    subscribe: 'QUERO ASSINAR',
    subscribeHint: 'Escolha o plano que combina com o seu jeito de dirigir.',
  },
  plans: {
    from: 'A PARTIR DE',
    perMonth: '/MÊS',
    seeAll: 'Ver todos os planos',
  },
  highlightKind: {
    event: 'EVENTO',
    day_use: 'DAY USE',
    experience: 'EXPERIÊNCIA',
    partner: 'PARCEIRO',
  },
  states: {
    errorTitle: 'Não foi possível carregar a tela inicial.',
    errorRetry: 'Tentar novamente',
  },
} as const;
```

- [ ] **Step 6: Escrever o teste de contrato que falha**

Criar `apps/mobile/src/api/__tests__/home.contract.test.ts`:

```ts
import { homeContentResponseSchema } from '@ccc/shared/home';
import { describe, expect, it } from 'vitest';

// Fixture no formato exato que apps/api/src/routes/home-content.ts serializa.
// Se o backend mudar de forma, este teste quebra antes da tela.
const HOME_FIXTURE = {
  hero: {
    title: 'DIRIGIR. CONECTAR. PERTENCER.',
    subtitle: null,
    bannerUrl: 'https://cdn.example.com/home/banner.webp',
  },
  institutional: {
    title: 'A Casa',
    body: 'Um clubhouse automotivo privado em Curitiba.',
    imageUrl: null,
  },
  benefits: [
    {
      icon: 'calendar',
      title: 'Eventos exclusivos',
      description: 'Encontros fechados.',
      sortOrder: 0,
    },
  ],
  highlights: [
    {
      kind: 'day_use',
      title: 'Day Use',
      subtitle: 'Um dia na sede.',
      imageUrl: null,
      linkPath: null,
      sortOrder: 0,
    },
  ],
  plans: [
    {
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      description: null,
      fromAmountCents: 49900,
      currency: 'BRL',
      benefits: ['Day Use ilimitado', 'Vaga na garagem', 'Caixa mensal'],
      sortOrder: 0,
    },
  ],
} as const;

describe('GET /api/home-content contract', () => {
  it('parses the serialized backend shape', () => {
    const parsed = homeContentResponseSchema.parse(HOME_FIXTURE);
    expect(parsed.plans[0].benefits).toHaveLength(3);
    expect(parsed.highlights[0].kind).toBe('day_use');
  });
});
```

- [ ] **Step 7: Rodar e confirmar que passa**

```bash
pnpm --filter @ccc/mobile test -- home.contract
```

Esperado: PASS. O schema já existe da Task 2, então este teste passa de primeira. Ele serve de trava contra mudança de forma do backend.

- [ ] **Step 8: Escrever o cliente de API e o hook**

Criar `apps/mobile/src/api/home.ts`:

```ts
// Conteúdo institucional da tela de Início.
//
// PÚBLICO, sem token: a Início é a primeira tela e roda antes do login.
// Endpoint: GET /api/home-content.

import { homeContentResponseSchema, type HomeContentResponse } from '@ccc/shared/home';
import type { z } from 'zod';

import { request } from '~/api/client';

const homeSchema = homeContentResponseSchema as z.ZodType<HomeContentResponse>;

export const getHomeContent = (): Promise<HomeContentResponse> =>
  request('/api/home-content', homeSchema);
```

Criar `apps/mobile/src/hooks/useHomeContent.ts`:

```ts
import type { HomeContentResponse } from '@ccc/shared/home';
import { useCallback, useEffect, useState } from 'react';

import { getHomeContent } from '~/api/home';

type UseHomeContentResult = {
  content: HomeContentResponse | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

// GET /api/home-content (público). Uma request cobre a tela inteira, então a
// falha é total: não há degradação parcial por bloco.
export function useHomeContent(): UseHomeContentResult {
  const [content, setContent] = useState<HomeContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setContent(await getHomeContent());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { content, loading, error, refresh };
}
```

- [ ] **Step 9: Escrever a paleta e o mapa de ícones da tela**

Criar `apps/mobile/src/screens/inicio/palette.ts`:

```ts
// Paleta da tela de Início, derivada dos tokens de @ccc/design.
//
// Existe para o mesmo motivo de src/screens/assinaturas/tier-visual.ts: os
// componentes usam StyleSheet, não classes NativeWind, então precisam dos hex
// em runtime. A fonte da verdade é packages/design/src/tokens.ts; aqui só se
// dá nome curto ao que a tela usa.

import { color } from '@ccc/design';

export const p = {
  bg: color.bg,
  surface: color.surfaceGold,
  cream: color.textPrimary,
  gold: color.brand,
  goldDeep: color.goldDeep,
  goldLight: color.goldLight,
  hairline: color.hairlineGold,
  hairlineStrong: color.hairlineGoldStrong,
  muted60: 'rgba(242,232,216,0.6)',
  muted50: 'rgba(242,232,216,0.5)',
  muted45: 'rgba(242,232,216,0.45)',
} as const;
```

Criar `apps/mobile/src/screens/inicio/icons.ts`:

```ts
// Mapa de chave de ícone para glifo lucide.
//
// O handoff especifica nomes do Material Symbols, mas o app usa
// lucide-react-native. As chaves guardadas em HomeBenefit.icon são desta
// tabela, não do Material. Chave desconhecida cai em Star, para conteúdo novo
// cadastrado no banco nunca derrubar a tela.

import {
  Calendar,
  Car,
  CalendarCheck,
  Gift,
  Handshake,
  Sparkles,
  Star,
  Sun,
  Tag,
  Users,
} from 'lucide-react-native';

const HOME_ICON = {
  calendar: Calendar,
  'calendar-check': CalendarCheck,
  car: Car,
  gift: Gift,
  handshake: Handshake,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  tag: Tag,
  users: Users,
} as const;

export type HomeIconKey = keyof typeof HOME_ICON;

export const homeIcon = (key: string): (typeof HOME_ICON)[HomeIconKey] =>
  HOME_ICON[key as HomeIconKey] ?? Star;
```

- [ ] **Step 10: Typecheck e lint do mobile**

```bash
pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint
```

Esperado: sem erro.

- [ ] **Step 11: Commit**

```bash
git add packages/design/src/tokens.ts packages/design/tailwind-preset.cjs apps/mobile/app/_layout.tsx apps/mobile/src/copy/inicio.ts apps/mobile/src/api/home.ts apps/mobile/src/api/__tests__/home.contract.test.ts apps/mobile/src/hooks/useHomeContent.ts apps/mobile/src/screens/inicio/palette.ts apps/mobile/src/screens/inicio/icons.ts
git commit -m "feat(mobile): fundacao da tela de inicio, tokens, fontes e api"
```

#### Adendo da emenda de escopo

Esta task ganha dois arquivos e duas ampliações. Tudo acima continua valendo.

**Files adicionais:**

- Create: `apps/mobile/src/api/club-stats.ts`
- Create: `apps/mobile/src/hooks/useClubStats.ts`

**Interfaces adicionais produzidas:**

- `getClubStats(): Promise<ClubStatsResponse>` em `~/api/club-stats`.
- `useClubStats(): { stats: ClubStatsResponse | null; loading: boolean; error: boolean; refresh: () => Promise<void> }` em `~/hooks/useClubStats`.

- [ ] **Step A1: Escrever o cliente de API dos contadores**

Criar `apps/mobile/src/api/club-stats.ts`, no mesmo formato de `src/api/home.ts`:

```ts
// Contadores agregados do clube, para a secao "Status do clube" da Inicio.
//
// PUBLICO, sem token: a secao aparece nos dois estados da home.
// Endpoint: GET /api/club-stats.

import { clubStatsResponseSchema, type ClubStatsResponse } from '@ccc/shared/club-stats';
import type { z } from 'zod';

import { request } from '~/api/client';

const clubStatsSchema = clubStatsResponseSchema as z.ZodType<ClubStatsResponse>;

export const getClubStats = (): Promise<ClubStatsResponse> =>
  request('/api/club-stats', clubStatsSchema);
```

- [ ] **Step A2: Escrever o hook**

Criar `apps/mobile/src/hooks/useClubStats.ts`:

```ts
import type { ClubStatsResponse } from '@ccc/shared/club-stats';
import { useCallback, useEffect, useState } from 'react';

import { getClubStats } from '~/api/club-stats';

type UseClubStatsResult = {
  stats: ClubStatsResponse | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

// GET /api/club-stats (publico). O backend cacheia por cinco minutos, entao
// chamar em toda montagem da tela e barato.
export function useClubStats(): UseClubStatsResult {
  const [stats, setStats] = useState<ClubStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setStats(await getClubStats());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { stats, loading, error, refresh };
}
```

- [ ] **Step A3: Ampliar a copy**

Em `apps/mobile/src/copy/inicio.ts`, acrescentar as chaves abaixo ao objeto `inicioCopy`. Não remover nem renomear nenhuma das que já estão lá. As três chaves originais de `sections` (`benefits`, `plans`, `highlights`) permanecem.

```ts
  sections: {
    clubStats: 'STATUS DO CLUBE',
    store: 'NA LOJA',
    confirmedCars: 'QUEM JA CONFIRMOU',
    quickAccess: 'ACESSO RÁPIDO',
    myTickets: 'MEUS INGRESSOS',
    myGarage: 'MINHA GARAGEM',
    subscription: 'SUA ASSINATURA',
    box: 'CAIXA DO MÊS',
    nextEvent: 'PRÓXIMO EVENTO',
  },
  clubStats: {
    members: 'MEMBROS',
    events: 'EVENTOS',
    garage: 'GARAGEM',
  },
  member: {
    greeting: (firstName: string) => `BEM-VINDO DE VOLTA, ${firstName.toUpperCase()}`,
    greetingFallback: 'BEM-VINDO DE VOLTA',
    memberSince: (monthYear: string) => `MEMBRO DESDE ${monthYear.toUpperCase()}`,
  },
  quickAccess: {
    events: 'Eventos',
    tickets: 'Ingressos',
    garage: 'Garagem',
    store: 'Loja',
  },
  cards: {
    seeEvent: 'VER EVENTO',
    seeAllStore: 'Ver a loja',
    seeGarage: 'Ver minha garagem',
    seeSubscription: 'Ver minha assinatura',
    subscribeUpsell: 'ASSINAR',
    seeBox: 'Ver a caixa',
    seeTickets: 'Ver todos',
  },
  empty: {
    noNextEvent: 'Nenhum evento agendado.',
    noTickets: 'Você ainda não tem ingressos.',
  },
```

`member.memberSince` recebe uma string ja formatada como `mar 2026`. A formatação fica na tela, não na copy.

- [ ] **Step A4: Ampliar o mapa de ícones**

Em `apps/mobile/src/screens/inicio/icons.ts`, acrescentar ao objeto `HOME_ICON`:

```ts
  ticket: Ticket,
  store: Store,
  box: Package,
  crown: Crown,
```

Importar `Ticket`, `Store`, `Package` e `Crown` de `lucide-react-native` junto dos outros. Antes de importar, confirmar que cada nome existe no pacote instalado. Se algum não existir, escolher o equivalente mais próximo e registrar a substituição no report.

- [ ] **Step A5: Verificar e commitar junto com o resto da task**

```bash
pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint
```

Acrescentar os arquivos novos ao `git add` do Step de commit desta task.

---

### Task 6: Primitivos visuais do handoff

**Files:**

- Create: `apps/mobile/src/screens/inicio/components/SectionLabel.tsx`
- Create: `apps/mobile/src/screens/inicio/components/GoldPill.tsx`
- Create: `apps/mobile/src/screens/inicio/components/FeatureCard.tsx`
- Create: `apps/mobile/src/screens/inicio/components/__tests__/primitives.test.tsx`

**Interfaces:**

- Consumes: `p` de `~/screens/inicio/palette` (Task 4).
- Produces:
  - `SectionLabel({ label }: { label: string })`
  - `GoldPill({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string })`
  - `FeatureCard({ children, onPress, accessibilityLabel, testID }: { children: ReactNode; onPress?: () => void; accessibilityLabel?: string; testID?: string })`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/mobile/src/screens/inicio/components/__tests__/primitives.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// Os primitivos do handoff são puramente visuais, então o que vale pinar é o
// contrato de interação: o rótulo aparece, o toque dispara, e o FeatureCard
// sem onPress não é um alvo de toque.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeatureCard } from '../FeatureCard';
import { GoldPill } from '../GoldPill';
import { SectionLabel } from '../SectionLabel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('SectionLabel', () => {
  it('renders the label text', () => {
    render(<SectionLabel label="BENEFÍCIOS DA ASSINATURA" />);
    expect(container.textContent).toContain('BENEFÍCIOS DA ASSINATURA');
  });
});

describe('GoldPill', () => {
  it('renders the label and fires onPress', () => {
    const onPress = vi.fn();
    render(<GoldPill label="QUERO ASSINAR" onPress={onPress} testID="pill" />);
    expect(container.textContent).toContain('QUERO ASSINAR');
    click('pill');
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('FeatureCard', () => {
  it('renders children and fires onPress when pressable', () => {
    const onPress = vi.fn();
    render(
      <FeatureCard onPress={onPress} accessibilityLabel="Day Use" testID="card">
        <Text>Day Use</Text>
      </FeatureCard>,
    );
    expect(container.textContent).toContain('Day Use');
    click('card');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders children without a press target when onPress is omitted', () => {
    render(
      <FeatureCard testID="static-card">
        <Text>Só informativo</Text>
      </FeatureCard>,
    );
    expect(container.textContent).toContain('Só informativo');
    expect(container.querySelector('[data-testid="static-card"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @ccc/mobile test -- primitives
```

Esperado: FAIL, `Failed to resolve import "../SectionLabel"`.

- [ ] **Step 3: Escrever `SectionLabel`**

Criar `apps/mobile/src/screens/inicio/components/SectionLabel.tsx`:

```tsx
// Label de seção do handoff: 10px, weight 600, letter-spacing .28em, dourado
// profundo, uppercase. É a peça que dá ritmo à tela; repetir sem variação.

import { StyleSheet, Text } from 'react-native';

import { p } from '~/screens/inicio/palette';

export function SectionLabel({ label }: { label: string }) {
  return (
    <Text style={styles.label} accessibilityRole="header">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: p.goldDeep,
    textTransform: 'uppercase',
  },
});
```

- [ ] **Step 4: Escrever `GoldPill`**

Criar `apps/mobile/src/screens/inicio/components/GoldPill.tsx`:

```tsx
// CTA pequeno do handoff: gradiente dourado 135deg, texto preto, raio 9.
// Alvo de toque mínimo de 44px de altura, por acessibilidade.

import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text } from 'react-native';

import { p } from '~/screens/inicio/palette';

export function GoldPill({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.wrap, pressed ? styles.pressed : null]}
    >
      <LinearGradient
        colors={[p.goldLight, p.goldDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <Text style={styles.label}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 9, overflow: 'hidden' },
  pressed: { opacity: 0.85 },
  gradient: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.8,
    color: p.bg,
    textTransform: 'uppercase',
  },
});
```

- [ ] **Step 5: Escrever `FeatureCard`**

Criar `apps/mobile/src/screens/inicio/components/FeatureCard.tsx`:

```tsx
// Card de destaque do handoff: raio 18, padding 16, borda dourada de ênfase,
// fundo escuro com tinta dourada.
//
// O card inteiro é uma única área de toque quando onPress é passado. Sem
// onPress ele é informativo, e não vira alvo de toque nem anuncia role de
// botão ao leitor de tela. Press escurece ~6%, conforme o handoff.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { p } from '~/screens/inicio/palette';

export function FeatureCard({
  children,
  onPress,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  if (!onPress) {
    return (
      <View style={styles.card} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: p.hairlineStrong,
    backgroundColor: '#100e09',
    gap: 14,
  },
  pressed: { opacity: 0.94 },
});
```

- [ ] **Step 6: Rodar e confirmar que passa**

```bash
pnpm --filter @ccc/mobile test -- primitives
```

Esperado: PASS, 4 testes.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/inicio/components
git commit -m "feat(mobile): primitivos visuais do handoff da inicio"
```

#### Adendo da emenda de escopo

Esta task ganha três primitivos e a cópia de um asset de marca. Tudo acima continua valendo.

**Files adicionais:**

- Create: `apps/mobile/src/screens/inicio/components/StatCard.tsx`
- Create: `apps/mobile/src/screens/inicio/components/QuickActionTile.tsx`
- Create: `apps/mobile/src/screens/inicio/components/AppHeader.tsx`
- Create: `packages/design/assets/monogram-ccc-circle-gold.png`

**Interfaces adicionais produzidas:**

- `StatCard({ icon, label, value }: { icon: string; label: string; value: number | string })`
- `QuickActionTile({ icon, label, onPress, testID }: { icon: string; label: string; onPress: () => void; testID?: string })`
- `AppHeader({ right }: { right?: ReactNode })`

`icon` nos dois primeiros é uma chave do mapa de `~/screens/inicio/icons`, resolvida por `homeIcon(key)`. Chave desconhecida cai no ícone padrão.

- [ ] **Step B1: Copiar o asset de marca**

```bash
cp ".handoffs/design_handoff_inicio/assets/brand/monogram-ccc-circle-gold.png" "packages/design/assets/monogram-ccc-circle-gold.png"
```

Conferir que `packages/design/package.json` expõe `"./assets/*": "./assets/*"` no mapa de exports. O campo `files` hoje lista `assets/*.webp`; acrescentar `assets/*.png` e registrar no report.

- [ ] **Step B2: Escrever os testes dos três primitivos, que falham**

Acrescentar ao `apps/mobile/src/screens/inicio/components/__tests__/primitives.test.tsx` que esta task já cria, reusando o boilerplate de `render` e `click` que já está no arquivo. Importar `StatCard`, `QuickActionTile` e `AppHeader` no topo, junto dos outros.

```tsx
describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard icon="users" label="MEMBROS" value={128} />);
    expect(container.textContent).toContain('MEMBROS');
    expect(container.textContent).toContain('128');
  });

  it('renders with an unknown icon key without crashing', () => {
    render(<StatCard icon="chave-que-nao-existe" label="EVENTOS" value={6} />);
    expect(container.textContent).toContain('EVENTOS');
  });
});

describe('QuickActionTile', () => {
  it('renders the label and fires onPress', () => {
    const onPress = vi.fn();
    render(<QuickActionTile icon="car" label="Garagem" onPress={onPress} testID="tile" />);
    expect(container.textContent).toContain('Garagem');
    click('tile');
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('AppHeader', () => {
  it('renders the wordmark and the location', () => {
    render(<AppHeader />);
    expect(container.textContent).toContain('CASA CAR CLUB');
    expect(container.textContent).toContain('CURITIBA');
  });

  it('renders the right slot when provided', () => {
    render(<AppHeader right={<Text>ENTRAR</Text>} />);
    expect(container.textContent).toContain('ENTRAR');
  });
});
```

- [ ] **Step B3: Escrever StatCard**

Criar `apps/mobile/src/screens/inicio/components/StatCard.tsx`:

```tsx
// Stat card do handoff: icone 20px dourado, label de 9px com letter-spacing
// .22em, numeral grande embaixo.
//
// O handoff pede Cormorant Garamond no numeral. Cormorant nao esta no bundle
// (decisao registrada no spec: so serviria a esta peca), entao o numeral usa
// Jost 700. Tamanho, cor e layout seguem o handoff.

import { StyleSheet, Text, View } from 'react-native';

import { homeIcon } from '~/screens/inicio/icons';
import { p } from '~/screens/inicio/palette';

export function StatCard({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number | string;
}) {
  const Icon = homeIcon(icon);
  return (
    <View style={styles.card}>
      <Icon color={p.goldDeep} size={20} strokeWidth={1.75} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
  },
  label: {
    marginTop: 8,
    fontFamily: 'Jost_600SemiBold',
    fontSize: 9,
    letterSpacing: 2.2,
    color: p.muted50,
    textAlign: 'center',
  },
  value: {
    marginTop: 4,
    fontFamily: 'Jost_700Bold',
    fontSize: 26,
    color: p.cream,
  },
});
```

- [ ] **Step B4: Escrever QuickActionTile**

Criar `apps/mobile/src/screens/inicio/components/QuickActionTile.tsx`:

```tsx
// Atalho do grid de acesso rapido: icone 24px dourado acima de um rotulo de
// 13px, alinhado a esquerda, conforme o handoff.

import { Pressable, StyleSheet, Text } from 'react-native';

import { homeIcon } from '~/screens/inicio/icons';
import { p } from '~/screens/inicio/palette';

export function QuickActionTile({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const Icon = homeIcon(icon);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}
    >
      <Icon color={p.gold} size={24} strokeWidth={1.75} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 96,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pressed: { opacity: 0.9 },
  label: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    color: p.cream,
  },
});
```

- [ ] **Step B5: Escrever AppHeader**

Criar `apps/mobile/src/screens/inicio/components/AppHeader.tsx`:

```tsx
// Header do app conforme o handoff: monograma 40x40 mais o bloco de texto
// CASA CAR CLUB / CURITIBA, e um slot livre a direita.
//
// O slot existe porque os dois estados da home querem coisas diferentes ali:
// o anonimo quer um botao Entrar, o membro quer o sino de notificacoes. A
// decisao fica fora deste componente.

import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { p } from '~/screens/inicio/palette';

const WORDMARK = 'CASA CAR CLUB';
const LOCATION = 'CURITIBA';

export function AppHeader({ right }: { right?: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
          source={require('@ccc/design/assets/monogram-ccc-circle-gold.png')}
          accessibilityLabel={WORDMARK}
          style={styles.monogram}
        />
        <View>
          <Text style={styles.wordmark}>{WORDMARK}</Text>
          <Text style={styles.location}>{LOCATION}</Text>
        </View>
      </View>
      {right ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 18,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  monogram: { width: 40, height: 40, resizeMode: 'contain' },
  wordmark: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 12,
    letterSpacing: 2.9,
    color: p.cream,
  },
  location: {
    marginTop: 3,
    fontFamily: 'Jost_500Medium',
    fontSize: 9,
    letterSpacing: 3.1,
    color: p.goldDeep,
  },
});
```

- [ ] **Step B6: Rodar e commitar junto com o resto da task**

```bash
pnpm --filter @ccc/mobile test -- primitives
```

Esperado: PASS, os 4 casos originais mais os 5 novos.

---

### Task 7: Seções 1 e 2 — apresentação e benefícios

**Files:**

- Create: `apps/mobile/src/screens/inicio/sections/HeroSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/BenefitsSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/HeroSection.test.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/BenefitsSection.test.tsx`

**Interfaces:**

- Consumes: `HomeHero`, `HomeInstitutional`, `HomeBenefit` de `@ccc/shared/home`. `SectionLabel` da Task 5. `p` e `homeIcon` da Task 4. `inicioCopy` da Task 4.
- Produces:
  - `HeroSection({ hero, institutional }: { hero: HomeHero; institutional: HomeInstitutional })`
  - `BenefitsSection({ benefits }: { benefits: HomeBenefit[] })`, que renderiza `null` quando a lista está vazia.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/mobile/src/screens/inicio/sections/__tests__/HeroSection.test.tsx`:

```tsx
// @vitest-environment jsdom

import type { HomeHero, HomeInstitutional } from '@ccc/shared/home';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HeroSection } from '../HeroSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const HERO: HomeHero = {
  title: 'DIRIGIR. CONECTAR. PERTENCER.',
  subtitle: 'O clube de carros de Curitiba.',
  bannerUrl: 'https://cdn.example.com/banner.webp',
};

const INSTITUTIONAL: HomeInstitutional = {
  title: 'A Casa',
  body: 'Um clubhouse automotivo privado em Curitiba.',
  imageUrl: 'https://cdn.example.com/casa.webp',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

describe('HeroSection', () => {
  it('renders the mote, the subtitle and the institutional block', () => {
    render(<HeroSection hero={HERO} institutional={INSTITUTIONAL} />);
    expect(container.textContent).toContain('DIRIGIR. CONECTAR. PERTENCER.');
    expect(container.textContent).toContain('O clube de carros de Curitiba.');
    expect(container.textContent).toContain('A Casa');
    expect(container.textContent).toContain('Um clubhouse automotivo privado em Curitiba.');
  });

  it('omits the subtitle line when subtitle is null', () => {
    render(<HeroSection hero={{ ...HERO, subtitle: null }} institutional={INSTITUTIONAL} />);
    expect(container.textContent).toContain('DIRIGIR. CONECTAR. PERTENCER.');
    expect(container.textContent).not.toContain('O clube de carros de Curitiba.');
  });

  it('renders without images when both urls are null', () => {
    render(
      <HeroSection
        hero={{ ...HERO, bannerUrl: null }}
        institutional={{ ...INSTITUTIONAL, imageUrl: null }}
      />,
    );
    expect(container.textContent).toContain('A Casa');
    expect(container.querySelector('img')).toBeNull();
  });
});
```

Criar `apps/mobile/src/screens/inicio/sections/__tests__/BenefitsSection.test.tsx`:

```tsx
// @vitest-environment jsdom

import type { HomeBenefit } from '@ccc/shared/home';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

import { BenefitsSection } from '../BenefitsSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const BENEFITS: HomeBenefit[] = [
  {
    icon: 'calendar',
    title: 'Eventos exclusivos',
    description: 'Encontros fechados.',
    sortOrder: 0,
  },
  { icon: 'chave-que-nao-existe', title: 'Day Use', description: null, sortOrder: 1 },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

describe('BenefitsSection', () => {
  it('renders the section label and every benefit', () => {
    render(<BenefitsSection benefits={BENEFITS} />);
    expect(container.textContent).toContain(inicioCopy.sections.benefits);
    expect(container.textContent).toContain('Eventos exclusivos');
    expect(container.textContent).toContain('Encontros fechados.');
    expect(container.textContent).toContain('Day Use');
  });

  it('renders an unknown icon key without crashing', () => {
    render(<BenefitsSection benefits={[BENEFITS[1]]} />);
    expect(container.textContent).toContain('Day Use');
  });

  it('renders nothing when the list is empty', () => {
    render(<BenefitsSection benefits={[]} />);
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

```bash
pnpm --filter @ccc/mobile test -- HeroSection BenefitsSection
```

Esperado: FAIL, `Failed to resolve import "../HeroSection"`.

- [ ] **Step 3: Escrever `HeroSection`**

Criar `apps/mobile/src/screens/inicio/sections/HeroSection.tsx`:

```tsx
// Seção 1 — apresentação do clube.
//
// Bloco de 210px com foto full-bleed, gradiente vertical por cima e o mote
// alinhado embaixo à esquerda, conforme o handoff. Abaixo, o bloco
// institucional com imagem e texto. Sem banner cadastrado, o hero cai num
// fundo escuro sólido em vez de deixar um buraco na tela.

import type { HomeHero, HomeInstitutional } from '@ccc/shared/home';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';

import { p } from '~/screens/inicio/palette';

export function HeroSection({
  hero,
  institutional,
}: {
  hero: HomeHero;
  institutional: HomeInstitutional;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        {hero.bannerUrl ? (
          <Image
            source={{ uri: hero.bannerUrl }}
            accessible={false}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : null}
        <LinearGradient
          colors={['rgba(10,10,10,0.15)', 'rgba(10,10,10,0.35)', 'rgba(10,10,10,0.86)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.heroContent}>
          <Text style={styles.mote} accessibilityRole="header">
            {hero.title}
          </Text>
          <View style={styles.rule} />
        </View>
      </View>

      {hero.subtitle ? <Text style={styles.subtitle}>{hero.subtitle}</Text> : null}

      <View style={styles.institutional}>
        {institutional.imageUrl ? (
          <Image
            source={{ uri: institutional.imageUrl }}
            accessible={false}
            style={styles.institutionalImage}
            resizeMode="cover"
          />
        ) : null}
        <Text style={styles.institutionalTitle} accessibilityRole="header">
          {institutional.title}
        </Text>
        <Text style={styles.institutionalBody}>{institutional.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 22 },
  hero: {
    height: 210,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.16)',
    overflow: 'hidden',
    backgroundColor: p.surface,
    justifyContent: 'flex-end',
  },
  heroContent: { padding: 22 },
  mote: {
    fontFamily: 'Jost_700Bold',
    fontSize: 29,
    lineHeight: 30,
    letterSpacing: -0.29,
    color: p.cream,
  },
  rule: {
    width: 44,
    height: 3,
    borderRadius: 2,
    marginTop: 14,
    backgroundColor: p.goldDeep,
  },
  subtitle: {
    fontFamily: 'Jost_500Medium',
    fontSize: 15,
    lineHeight: 22,
    color: p.muted60,
  },
  institutional: { gap: 12 },
  institutionalImage: {
    width: '100%',
    height: 160,
    borderRadius: 14,
    backgroundColor: p.surface,
  },
  institutionalTitle: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 19,
    color: p.cream,
  },
  institutionalBody: {
    fontFamily: 'Jost_500Medium',
    fontSize: 14,
    lineHeight: 22,
    color: p.muted60,
  },
});
```

- [ ] **Step 4: Escrever `BenefitsSection`**

Criar `apps/mobile/src/screens/inicio/sections/BenefitsSection.tsx`:

```tsx
// Seção 2 — benefícios da assinatura.
//
// Lista vinda do banco (HomeBenefit ativos, ordenados). Sem item ativo a
// seção inteira não renderiza: a tela nunca mostra cabeçalho sem conteúdo.

import type { HomeBenefit } from '@ccc/shared/home';
import { StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { homeIcon } from '~/screens/inicio/icons';
import { p } from '~/screens/inicio/palette';

export function BenefitsSection({ benefits }: { benefits: HomeBenefit[] }) {
  if (benefits.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.benefits} />
      <View style={styles.list}>
        {benefits.map((benefit) => {
          const Icon = homeIcon(benefit.icon);
          return (
            <View key={`${benefit.sortOrder}-${benefit.title}`} style={styles.row}>
              <Icon color={p.goldDeep} size={20} strokeWidth={1.75} />
              <View style={styles.text}>
                <Text style={styles.title}>{benefit.title}</Text>
                {benefit.description ? (
                  <Text style={styles.description}>{benefit.description}</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  list: { gap: 12 },
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
  },
  text: { flex: 1, gap: 3 },
  title: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 14,
    color: p.cream,
  },
  description: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: p.muted60,
  },
});
```

- [ ] **Step 5: Rodar e confirmar que passam**

```bash
pnpm --filter @ccc/mobile test -- HeroSection BenefitsSection
```

Esperado: PASS, 6 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/inicio/sections
git commit -m "feat(mobile): secoes de apresentacao e beneficios da inicio"
```

#### Adendo da emenda de escopo

Esta task ganha a seção de contadores, usada pelos dois estados da home.

**Files adicionais:**

- Create: `apps/mobile/src/screens/inicio/sections/ClubStatsSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/ClubStatsSection.test.tsx`

**Interfaces adicionais produzidas:**

- `ClubStatsSection({ stats }: { stats: ClubStatsResponse | null })`, que renderiza `null` quando `stats` é `null`.

- [ ] **Step C1: Escrever o teste, que falha**

Criar `apps/mobile/src/screens/inicio/sections/__tests__/ClubStatsSection.test.tsx`, no mesmo boilerplate dos outros testes de seção desta task:

```tsx
// @vitest-environment jsdom

import type { ClubStatsResponse } from '@ccc/shared/club-stats';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

import { ClubStatsSection } from '../ClubStatsSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const STATS: ClubStatsResponse = { members: 128, events: 6, cars: 18 };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

describe('ClubStatsSection', () => {
  it('renders the section label and the three counters', () => {
    render(<ClubStatsSection stats={STATS} />);
    expect(container.textContent).toContain(inicioCopy.sections.clubStats);
    expect(container.textContent).toContain(inicioCopy.clubStats.members);
    expect(container.textContent).toContain('128');
    expect(container.textContent).toContain(inicioCopy.clubStats.events);
    expect(container.textContent).toContain('6');
    expect(container.textContent).toContain(inicioCopy.clubStats.garage);
    expect(container.textContent).toContain('18');
  });

  it('renders zeros for a brand new club rather than hiding the section', () => {
    render(<ClubStatsSection stats={{ members: 0, events: 0, cars: 0 }} />);
    expect(container.textContent).toContain(inicioCopy.sections.clubStats);
    expect(container.textContent).toContain('0');
  });

  it('renders nothing when stats are unavailable', () => {
    render(<ClubStatsSection stats={null} />);
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step C2: Escrever ClubStatsSection**

Criar `apps/mobile/src/screens/inicio/sections/ClubStatsSection.tsx`:

```tsx
// Secao "Status do clube": grid de tres contadores.
//
// Os numeros vem de GET /api/club-stats e sao contagens do clube, nunca do
// membro. A secao aparece nos dois estados da home, entao nao conhece auth.
//
// Zero e um valor legitimo e renderiza normalmente. Somente `stats` nulo
// (falha ou carregando) esconde a secao, para nao deixar cabecalho sem
// conteudo.

import type { ClubStatsResponse } from '@ccc/shared/club-stats';
import { StyleSheet, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { StatCard } from '~/screens/inicio/components/StatCard';

export function ClubStatsSection({ stats }: { stats: ClubStatsResponse | null }) {
  if (!stats) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.clubStats} />
      <View style={styles.grid}>
        <StatCard icon="users" label={inicioCopy.clubStats.members} value={stats.members} />
        <StatCard icon="calendar" label={inicioCopy.clubStats.events} value={stats.events} />
        <StatCard icon="car" label={inicioCopy.clubStats.garage} value={stats.cars} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  grid: { flexDirection: 'row', gap: 12 },
});
```

- [ ] **Step C3: Rodar e commitar junto com o resto da task**

```bash
pnpm --filter @ccc/mobile test -- ClubStatsSection
```

Esperado: PASS, 3 testes.

---

### Task 8: Seções 3 e 4 — CTAs, e liberação de `/assinaturas` no redirect

**Files:**

- Create: `apps/mobile/src/screens/inicio/sections/CtaSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/CtaSection.test.tsx`
- Modify: `apps/mobile/src/auth/redirect-intent.ts`
- Modify: `apps/mobile/src/auth/__tests__/redirect-intent.test.ts` (criar se não existir)

**Interfaces:**

- Consumes: `GoldPill` da Task 5. `inicioCopy` da Task 4. `buildLoginHref` de `~/auth/redirect-intent`.
- Produces: `CtaSection({ onCreateAccount, onSubscribe }: { onCreateAccount: () => void; onSubscribe: () => void })`. O prefixo `/assinaturas` passa a ser aceito por `sanitizeNext`.

- [ ] **Step 1: Confirmar que `/assinaturas` é hoje rejeitado**

```bash
cd apps/mobile && grep -n "NEXT_ALLOWED_PREFIXES" -A 12 src/auth/redirect-intent.ts
```

Esperado: a lista não contém `/assinaturas`.

- [ ] **Step 2: Escrever o teste que falha para o sanitizador**

Verificar se `apps/mobile/src/auth/__tests__/redirect-intent.test.ts` já existe. Se existir, acrescentar apenas o bloco `describe` abaixo. Se não existir, criar o arquivo com:

```ts
import { describe, expect, it } from 'vitest';

import { buildLoginHref, sanitizeNext } from '~/auth/redirect-intent';

describe('sanitizeNext — jornada de assinatura', () => {
  it('accepts /assinaturas so the subscribe CTA survives the login round trip', () => {
    expect(sanitizeNext('/assinaturas')).toBe('/assinaturas');
  });

  it('accepts a plan detail path under /assinaturas', () => {
    expect(sanitizeNext('/assinaturas/ouro')).toBe('/assinaturas/ouro');
  });

  it('still rejects absolute and protocol-relative urls', () => {
    expect(sanitizeNext('https://evil.example.com/assinaturas')).toBeNull();
    expect(sanitizeNext('//evil.example.com')).toBeNull();
  });
});

describe('buildLoginHref', () => {
  it('carries /assinaturas as the next param', () => {
    expect(buildLoginHref('/assinaturas')).toContain('assinaturas');
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter @ccc/mobile test -- redirect-intent
```

Esperado: FAIL. `sanitizeNext('/assinaturas')` devolve `null` porque o prefixo não está na allowlist.

- [ ] **Step 4: Liberar o prefixo**

Em `apps/mobile/src/auth/redirect-intent.ts`, dentro de `NEXT_ALLOWED_PREFIXES`, depois de `'/caixa',`, adicionar:

```ts
  // Seção 4 da tela de Início manda o anônimo para o login com
  // next=/assinaturas. Sem o prefixo aqui o sanitizador descarta o destino e o
  // usuário aterrissa em DEFAULT_POST_AUTH, quebrando a jornada de assinatura.
  '/assinaturas',
```

`/assinaturas` NÃO entra em `PUBLIC_EXACT`: a Story manda seguir o fluxo de login e cadastro para usuário não autenticado.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter @ccc/mobile test -- redirect-intent
```

Esperado: PASS.

- [ ] **Step 6: Escrever o teste do `CtaSection` que falha**

Criar `apps/mobile/src/screens/inicio/sections/__tests__/CtaSection.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

import { CtaSection } from '../CtaSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('CtaSection', () => {
  it('renders both CTAs', () => {
    render(<CtaSection onCreateAccount={vi.fn()} onSubscribe={vi.fn()} />);
    expect(container.textContent).toContain(inicioCopy.cta.signup);
    expect(container.textContent).toContain(inicioCopy.cta.subscribe);
  });

  it('fires onCreateAccount from the primary CTA', () => {
    const onCreateAccount = vi.fn();
    const onSubscribe = vi.fn();
    render(<CtaSection onCreateAccount={onCreateAccount} onSubscribe={onSubscribe} />);
    click('inicio-cta-signup');
    expect(onCreateAccount).toHaveBeenCalledTimes(1);
    expect(onSubscribe).not.toHaveBeenCalled();
  });

  it('fires onSubscribe from the secondary CTA', () => {
    const onCreateAccount = vi.fn();
    const onSubscribe = vi.fn();
    render(<CtaSection onCreateAccount={onCreateAccount} onSubscribe={onSubscribe} />);
    click('inicio-cta-subscribe');
    expect(onSubscribe).toHaveBeenCalledTimes(1);
    expect(onCreateAccount).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

```bash
pnpm --filter @ccc/mobile test -- CtaSection
```

Esperado: FAIL, `Failed to resolve import "../CtaSection"`.

- [ ] **Step 8: Escrever `CtaSection`**

Criar `apps/mobile/src/screens/inicio/sections/CtaSection.tsx`:

```tsx
// Seções 3 e 4 — criar conta e assinar.
//
// "Criar conta" é o CTA principal, em gradiente dourado. "Assinar" é o
// secundário de destaque, contornado. A decisão de para onde cada um navega
// (e do desvio pelo login quando anônimo) fica no GuestHome, não aqui: esta
// seção só dispara os callbacks.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { GoldPill } from '~/screens/inicio/components/GoldPill';
import { p } from '~/screens/inicio/palette';

export function CtaSection({
  onCreateAccount,
  onSubscribe,
}: {
  onCreateAccount: () => void;
  onSubscribe: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.block}>
        <GoldPill
          label={inicioCopy.cta.signup}
          onPress={onCreateAccount}
          testID="inicio-cta-signup"
        />
        <Text style={styles.hint}>{inicioCopy.cta.signupHint}</Text>
      </View>

      <View style={styles.block}>
        <Pressable
          onPress={onSubscribe}
          accessibilityRole="button"
          accessibilityLabel={inicioCopy.cta.subscribe}
          testID="inicio-cta-subscribe"
          style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
        >
          <Text style={styles.secondaryLabel}>{inicioCopy.cta.subscribe}</Text>
        </Pressable>
        <Text style={styles.hint}>{inicioCopy.cta.subscribeHint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  block: { gap: 8 },
  secondary: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: p.gold,
    backgroundColor: 'transparent',
  },
  pressed: { opacity: 0.85 },
  secondaryLabel: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.8,
    color: p.gold,
    textTransform: 'uppercase',
  },
  hint: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: p.muted50,
    textAlign: 'center',
  },
});
```

- [ ] **Step 9: Rodar e confirmar que passa**

```bash
pnpm --filter @ccc/mobile test -- CtaSection redirect-intent
```

Esperado: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/screens/inicio/sections/CtaSection.tsx apps/mobile/src/screens/inicio/sections/__tests__/CtaSection.test.tsx apps/mobile/src/auth/redirect-intent.ts apps/mobile/src/auth/__tests__/redirect-intent.test.ts
git commit -m "feat(mobile): CTAs de criar conta e assinar na inicio"
```

---

### Task 9: Seções 5 e 6 — planos e destaques

**Files:**

- Create: `apps/mobile/src/screens/inicio/sections/PlansSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/HighlightsSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/PlansSection.test.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/HighlightsSection.test.tsx`

**Interfaces:**

- Consumes: `HomePlan`, `HomeHighlight` de `@ccc/shared/home`. `SectionLabel`, `FeatureCard` da Task 5. `inicioCopy`, `p` da Task 4. `formatBRL` de `~/lib/format`.
- Produces:
  - `PlansSection({ plans, onOpenPlan, onSeeAll }: { plans: HomePlan[]; onOpenPlan: (slug: string) => void; onSeeAll: () => void })`, `null` com lista vazia.
  - `HighlightsSection({ highlights, onOpenLink }: { highlights: HomeHighlight[]; onOpenLink: (path: string) => void })`, `null` com lista vazia.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/mobile/src/screens/inicio/sections/__tests__/PlansSection.test.tsx`:

```tsx
// @vitest-environment jsdom

import type { HomePlan } from '@ccc/shared/home';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

import { PlansSection } from '../PlansSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const PLANS: HomePlan[] = [
  {
    tier: 'bronze',
    slug: 'bronze',
    name: 'Bronze',
    description: 'Entrada no clube.',
    fromAmountCents: 19900,
    currency: 'BRL',
    benefits: ['Eventos abertos', 'Day Use avulso'],
    sortOrder: 0,
  },
  {
    tier: 'gold',
    slug: 'ouro',
    name: 'Ouro',
    description: null,
    fromAmountCents: 49900,
    currency: 'BRL',
    benefits: ['Day Use ilimitado', 'Vaga na garagem', 'Caixa mensal'],
    sortOrder: 1,
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('PlansSection', () => {
  it('renders the label, plan names, formatted starting price and benefits', () => {
    render(<PlansSection plans={PLANS} onOpenPlan={vi.fn()} onSeeAll={vi.fn()} />);
    expect(container.textContent).toContain(inicioCopy.sections.plans);
    expect(container.textContent).toContain('Bronze');
    expect(container.textContent).toContain('Ouro');
    expect(container.textContent).toContain(inicioCopy.plans.from);
    expect(container.textContent).toContain('199');
    expect(container.textContent).toContain('Day Use ilimitado');
    expect(container.textContent).toContain('Entrada no clube.');
  });

  it('passes the plan slug to onOpenPlan', () => {
    const onOpenPlan = vi.fn();
    render(<PlansSection plans={PLANS} onOpenPlan={onOpenPlan} onSeeAll={vi.fn()} />);
    click('inicio-plan-ouro');
    expect(onOpenPlan).toHaveBeenCalledWith('ouro');
  });

  it('fires onSeeAll from the footer link', () => {
    const onSeeAll = vi.fn();
    render(<PlansSection plans={PLANS} onOpenPlan={vi.fn()} onSeeAll={onSeeAll} />);
    click('inicio-plans-see-all');
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there are no featured plans', () => {
    render(<PlansSection plans={[]} onOpenPlan={vi.fn()} onSeeAll={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});
```

Criar `apps/mobile/src/screens/inicio/sections/__tests__/HighlightsSection.test.tsx`:

```tsx
// @vitest-environment jsdom

import type { HomeHighlight } from '@ccc/shared/home';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

import { HighlightsSection } from '../HighlightsSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const HIGHLIGHTS: HomeHighlight[] = [
  {
    kind: 'event',
    title: 'Próximos encontros',
    subtitle: 'A agenda do clube.',
    imageUrl: null,
    linkPath: '/events',
    sortOrder: 0,
  },
  {
    kind: 'day_use',
    title: 'Day Use',
    subtitle: null,
    imageUrl: null,
    linkPath: null,
    sortOrder: 1,
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('HighlightsSection', () => {
  it('renders the label, the kind eyebrow and every highlight', () => {
    render(<HighlightsSection highlights={HIGHLIGHTS} onOpenLink={vi.fn()} />);
    expect(container.textContent).toContain(inicioCopy.sections.highlights);
    expect(container.textContent).toContain(inicioCopy.highlightKind.event);
    expect(container.textContent).toContain(inicioCopy.highlightKind.day_use);
    expect(container.textContent).toContain('Próximos encontros');
    expect(container.textContent).toContain('A agenda do clube.');
    expect(container.textContent).toContain('Day Use');
  });

  it('passes the linkPath to onOpenLink for a linked highlight', () => {
    const onOpenLink = vi.fn();
    render(<HighlightsSection highlights={HIGHLIGHTS} onOpenLink={onOpenLink} />);
    click('inicio-highlight-0');
    expect(onOpenLink).toHaveBeenCalledWith('/events');
  });

  it('does not call onOpenLink for a highlight without linkPath', () => {
    const onOpenLink = vi.fn();
    render(<HighlightsSection highlights={HIGHLIGHTS} onOpenLink={onOpenLink} />);
    click('inicio-highlight-1');
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it('renders nothing when the list is empty', () => {
    render(<HighlightsSection highlights={[]} onOpenLink={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

```bash
pnpm --filter @ccc/mobile test -- PlansSection HighlightsSection
```

Esperado: FAIL, `Failed to resolve import "../PlansSection"`.

- [ ] **Step 3: Escrever `PlansSection`**

Criar `apps/mobile/src/screens/inicio/sections/PlansSection.tsx`:

```tsx
// Seção 5 — resumo dos planos.
//
// Dados de GET /api/home-content, que filtra por active + homeFeatured e
// trunca os benefícios. O detalhe completo vive em /assinaturas, então aqui
// não há CTA de contratação: tocar no card leva para a jornada.
//
// O accent por tier é presentação derivada do tier, igual
// src/screens/assinaturas/tier-visual.ts faz. A API só entrega conteúdo.

import type { HomePlan } from '@ccc/shared/home';
import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { formatBRL } from '~/lib/format';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

const TIER_ACCENT: Record<HomePlan['tier'], string> = {
  bronze: '#C08A4E',
  silver: '#C7CCD1',
  gold: '#E8CE86',
};

export function PlansSection({
  plans,
  onOpenPlan,
  onSeeAll,
}: {
  plans: HomePlan[];
  onOpenPlan: (slug: string) => void;
  onSeeAll: () => void;
}) {
  if (plans.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.plans} />

      <View style={styles.list}>
        {plans.map((plan) => {
          const accent = TIER_ACCENT[plan.tier];
          return (
            <Pressable
              key={plan.slug}
              onPress={() => onOpenPlan(plan.slug)}
              accessibilityRole="button"
              accessibilityLabel={plan.name}
              testID={`inicio-plan-${plan.slug}`}
              style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
            >
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <View style={[styles.dot, { backgroundColor: accent }]} />
                  <Text style={styles.name}>{plan.name}</Text>
                </View>
                <View style={styles.headerRight}>
                  <Text style={styles.from}>{inicioCopy.plans.from}</Text>
                  <Text style={styles.price}>{formatBRL(plan.fromAmountCents)}</Text>
                  <Text style={styles.perMonth}>{inicioCopy.plans.perMonth}</Text>
                </View>
              </View>

              {plan.description ? <Text style={styles.description}>{plan.description}</Text> : null}

              <View style={styles.benefits}>
                {plan.benefits.map((label) => (
                  <View key={label} style={styles.benefitRow}>
                    <Check color={accent} size={16} strokeWidth={2} />
                    <Text style={styles.benefitText}>{label}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={onSeeAll}
        accessibilityRole="link"
        accessibilityLabel={inicioCopy.plans.seeAll}
        testID="inicio-plans-see-all"
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        <Text style={styles.seeAll}>{inicioCopy.plans.seeAll}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  list: { gap: 12 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
    padding: 16,
    gap: 12,
  },
  pressed: { opacity: 0.9 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontFamily: 'Jost_600SemiBold', fontSize: 17, color: p.cream },
  headerRight: { alignItems: 'flex-end' },
  from: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 9,
    letterSpacing: 2.2,
    color: p.muted45,
  },
  price: { fontFamily: 'Jost_700Bold', fontSize: 19, color: p.cream },
  perMonth: {
    fontFamily: 'Jost_500Medium',
    fontSize: 10,
    letterSpacing: 1.2,
    color: p.muted45,
  },
  description: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: p.muted60,
  },
  benefits: { gap: 6 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  benefitText: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    color: p.muted60,
    flex: 1,
  },
  seeAll: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 13,
    color: p.gold,
    textAlign: 'center',
  },
});
```

- [ ] **Step 4: Escrever `HighlightsSection`**

Criar `apps/mobile/src/screens/inicio/sections/HighlightsSection.tsx`:

```tsx
// Seção 6 — eventos e experiências.
//
// Destaques curados no banco (HomeHighlight ativos, ordenados). Cobre Day Use
// e experiências automotivas, que não têm modelo de domínio próprio. Destaque
// sem linkPath é informativo: FeatureCard não recebe onPress e portanto não
// vira alvo de toque nem anuncia role de botão.

import type { HomeHighlight } from '@ccc/shared/home';
import { Image, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { FeatureCard } from '~/screens/inicio/components/FeatureCard';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

export function HighlightsSection({
  highlights,
  onOpenLink,
}: {
  highlights: HomeHighlight[];
  onOpenLink: (path: string) => void;
}) {
  if (highlights.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.highlights} />
      <View style={styles.list}>
        {highlights.map((highlight, index) => {
          const { linkPath } = highlight;
          return (
            <FeatureCard
              key={`${highlight.sortOrder}-${highlight.title}`}
              testID={`inicio-highlight-${index}`}
              accessibilityLabel={highlight.title}
              onPress={linkPath ? () => onOpenLink(linkPath) : undefined}
            >
              {highlight.imageUrl ? (
                <Image
                  source={{ uri: highlight.imageUrl }}
                  accessible={false}
                  style={styles.image}
                  resizeMode="cover"
                />
              ) : null}
              <Text style={styles.eyebrow}>{inicioCopy.highlightKind[highlight.kind]}</Text>
              <Text style={styles.title}>{highlight.title}</Text>
              {highlight.subtitle ? (
                <Text style={styles.subtitle}>{highlight.subtitle}</Text>
              ) : null}
            </FeatureCard>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  list: { gap: 12 },
  image: {
    width: '100%',
    height: 140,
    borderRadius: 12,
    backgroundColor: p.surface,
  },
  eyebrow: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: p.goldDeep,
  },
  title: { fontFamily: 'Jost_600SemiBold', fontSize: 17, color: p.cream },
  subtitle: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: p.muted60,
  },
});
```

Nota sobre o `gap` do `FeatureCard`: ele já aplica `gap: 14`, então as seções filhas não repetem espaçamento vertical.

- [ ] **Step 5: Rodar e confirmar que passam**

```bash
pnpm --filter @ccc/mobile test -- PlansSection HighlightsSection
```

Esperado: PASS, 8 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/inicio/sections
git commit -m "feat(mobile): secoes de planos e destaques da inicio"
```

#### Adendo da emenda de escopo

Esta task ganha duas seções novas e uma ampliação em `HighlightsSection`.

**Files adicionais:**

- Create: `apps/mobile/src/screens/inicio/sections/StoreTeaserSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/ConfirmedCarsSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/StoreTeaserSection.test.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/ConfirmedCarsSection.test.tsx`

**Ampliação de `HighlightsSection`:** passa a receber `events` além de `highlights`, e renderiza os eventos reais **antes** dos destaques curados.

```ts
HighlightsSection({
  highlights,
  events,
  onOpenLink,
  onOpenEvent,
}: {
  highlights: HomeHighlight[];
  events: EventSummary[];
  onOpenLink: (path: string) => void;
  onOpenEvent: (slug: string) => void;
})
```

Renderiza `null` somente quando `highlights` e `events` estão ambos vazios. Cada evento é um `FeatureCard` clicável com eyebrow `inicioCopy.highlightKind.event`, título, data formatada por `formatEventDateRange` de `~/lib/format`, e `onPress` chamando `onOpenEvent(event.slug)`. `testID` de cada evento: `inicio-event-<slug>`.

Acrescentar aos testes existentes de `HighlightsSection` os casos: eventos aparecem antes dos destaques; tocar num evento chama `onOpenEvent` com o slug; lista de eventos vazia com destaques presentes ainda renderiza a seção; ambas vazias renderiza `null`.

- [ ] **Step D1: Ler as formas exatas antes de escrever**

Antes de codar, ler e anotar:

1. `packages/shared/src/events.ts` — a forma de `EventSummary` (campos `id`, `slug`, `title`, `coverUrl`, `startsAt`, `endsAt`, `city`, `stateCode`, `type`, `status`).
2. `packages/shared/src/store.ts` — a forma do produto devolvido por `listStoreProducts`, em especial o nome do campo de preço e o de imagem.
3. `apps/mobile/src/hooks/useStoreProducts.ts` — a assinatura real, incluindo o parâmetro de query e o que devolve.
4. `apps/mobile/src/api/events.ts` — a assinatura de `getConfirmedCars` e a forma de `ConfirmedCar` em `packages/shared/src/events.ts`.
5. `apps/mobile/src/lib/format.ts` — `formatBRL` e `formatEventDateRange`.

O código abaixo assume nomes plausíveis. Onde divergir do real, usar o real e registrar no report.

- [ ] **Step D2: Escrever StoreTeaserSection**

Criar `apps/mobile/src/screens/inicio/sections/StoreTeaserSection.tsx`. Faixa horizontal de produtos, cada card navegando para `/store/<slug>`. A loja já é rota pública, então isto funciona para o anônimo sem login.

Requisitos:

- Usa `useStoreProducts` com um limite pequeno. Se o hook não aceitar limite, fatiar o resultado no componente e comentar por quê.
- `SectionLabel` com `inicioCopy.sections.store`, e um link de rodapé com `inicioCopy.cards.seeAllStore` navegando para `/store`.
- Cada card: imagem quando houver, nome do produto, preço formatado com `formatBRL`. `testID`: `inicio-store-<slug>`.
- Renderiza `null` quando a lista está vazia ou o hook está em erro. Nunca mostra cabeçalho sem conteúdo.
- `ScrollView` horizontal com `showsHorizontalScrollIndicator={false}`, no padrão do rail de eventos que já existe no `welcome.tsx` atual.

Teste: label e produtos aparecem; tocar num card chama a navegação com o slug; lista vazia renderiza `null`. Mocar `~/hooks/useStoreProducts` e `expo-router` no padrão dos outros testes.

- [ ] **Step D3: Escrever ConfirmedCarsSection**

Criar `apps/mobile/src/screens/inicio/sections/ConfirmedCarsSection.tsx`. Prova social: carros já confirmados no próximo evento.

Requisitos:

- Recebe `eventSlug: string | null` e busca via `getConfirmedCars`. Com `eventSlug` nulo, renderiza `null` sem chamar a API.
- `SectionLabel` com `inicioCopy.sections.confirmedCars`.
- Faixa horizontal de miniaturas. Cada item mostra a foto quando houver e o nome do carro. Sem foto, cai num placeholder da cor de superfície.
- **Renderiza `null` quando a lista volta vazia**, que é o caso mais comum. Isto foi decidido explicitamente: a seção só aparece quando tem substância.
- Não é clicável nesta entrega. É prova social, não navegação.

Teste: com carros, label e nomes aparecem; com lista vazia, renderiza `null`; com `eventSlug` nulo, renderiza `null` e a função de API não é chamada. Mocar `~/api/events`.

- [ ] **Step D4: Rodar e commitar junto com o resto da task**

```bash
pnpm --filter @ccc/mobile test -- HighlightsSection StoreTeaserSection ConfirmedCarsSection PlansSection
```

## Esperado: PASS em todos.

### Task 10: Seções do membro logado

**Files:**

- Create: `apps/mobile/src/screens/inicio/sections/MemberGreeting.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/NextEventCard.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/MyTicketsSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/MyGarageSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/SubscriptionSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/BoxSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/QuickAccessSection.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/member-sections.test.tsx`
- Create: `apps/mobile/src/screens/inicio/format-member.ts`

**Interfaces:**

- Consumes: `SectionLabel`, `GoldPill`, `FeatureCard`, `QuickActionTile` da Task 6. `p` e `homeIcon` da Task 5. `inicioCopy` da Task 5.
- Produces, todos com props explícitas e sem buscar dados por conta própria (quem busca é o `MemberHome` da Task 11):
  - `formatMemberSince(iso: string): string` em `~/screens/inicio/format-member`, devolvendo algo como `mar 2026`.
  - `MemberGreeting({ firstName, createdAt }: { firstName: string | null; createdAt: string | null })`
  - `NextEventCard({ event, onPress }: { event: EventSummary | null; onPress: (slug: string) => void })`
  - `MyTicketsSection({ tickets, onOpenTicket, onSeeAll }: { tickets: MyTicket[]; onOpenTicket: (id: string) => void; onSeeAll: () => void })`
  - `MyGarageSection({ garage, onPress }: { garage: GarageReadResponse | null; onPress: () => void })`
  - `SubscriptionSection({ status, onManage, onSubscribe }: { status: PremiumStatus | null; onManage: () => void; onSubscribe: () => void })`
  - `BoxSection({ box, isPremiumActive, onPress }: { box: BoxView | null; isPremiumActive: boolean; onPress: () => void })`
  - `QuickAccessSection({ onNavigate }: { onNavigate: (path: string) => void })`

**Princípio que vale para todas as sete:** são componentes puros de apresentação. Recebem dados já carregados e renderizam `null` quando não há o que mostrar. Nenhuma delas chama API, nenhuma conhece `useAuth`. Isso é o que permite testar cada uma isolada e é o que faz a regra de erro por bloco da Task 11 funcionar.

- [ ] **Step 1: Ler as formas exatas antes de escrever qualquer linha**

Ler e anotar os tipos reais. O código desta task depende deles e o plano não pode adivinhar:

1. `packages/shared/src/events.ts` — `EventSummary`.
2. `packages/shared/src/tickets.ts` — `MyTicket`, em especial `id`, `status`, `tierName` e o objeto `event` embutido.
3. `packages/shared/src/garage.ts` e `packages/shared/src/garage-progress.ts` — `GarageReadResponse`, com `garage.badges`, `garage.premiumTier`, `garage.isPremiumActive`, `cars`, `spots`, `gamification.enabled`, `progress` e `stats`. Anotar quais campos são opcionais.
4. `packages/shared/src/premium.ts` — a forma devolvida por `getPremiumStatus` (`active`, `tier`, `currentPeriodEnd`, `cancelAtPeriodEnd`).
5. `packages/shared/src/box.ts` — `BoxView` e o enum de status do ciclo.
6. `packages/ui/src/index.ts` — as props reais de `XPScoreboard`, `BadgeRow` e `PremiumBadge`. Ler os arquivos dos componentes, não só o barrel.
7. `apps/mobile/src/lib/format.ts` — `formatBRL` e `formatEventDateRange`.

Registrar no report qualquer divergência entre o que esta task assume e o que os tipos realmente têm, e usar sempre o real.

- [ ] **Step 2: Escrever o helper de data e seu teste**

Criar `apps/mobile/src/screens/inicio/format-member.ts`:

```ts
// MEMBRO DESDE <MES> <ANO>, derivado de user.createdAt.
//
// O handoff pede MEMBRO #0001, mas nao existe campo de numero de membro no
// banco. Decisao de produto registrada no spec: usar a data de entrada, que
// comunica pertencimento sem inventar coluna nem expor o tamanho da base.

const MONTHS_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

/**
 * Recebe um ISO 8601 e devolve `mes ano` em PT-BR abreviado, por exemplo
 * `mar 2026`. Devolve string vazia para entrada invalida, para a tela poder
 * esconder a linha em vez de mostrar `Invalid Date`.
 */
export const formatMemberSince = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${MONTHS_PT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};
```

Teste em `apps/mobile/src/screens/inicio/__tests__/format-member.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { formatMemberSince } from '../format-member';

describe('formatMemberSince', () => {
  it('formats an ISO date as abbreviated PT-BR month and year', () => {
    expect(formatMemberSince('2026-03-14T12:00:00.000Z')).toBe('mar 2026');
  });

  it('handles January and December without off-by-one', () => {
    expect(formatMemberSince('2026-01-01T00:00:00.000Z')).toBe('jan 2026');
    expect(formatMemberSince('2026-12-31T23:59:59.000Z')).toBe('dez 2026');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatMemberSince('not-a-date')).toBe('');
  });
});
```

Rodar e confirmar RED, então GREEN:

```bash
pnpm --filter @ccc/mobile test -- format-member
```

- [ ] **Step 3: Escrever MemberGreeting**

Criar `apps/mobile/src/screens/inicio/sections/MemberGreeting.tsx`:

```tsx
// Saudacao do membro, conforme o handoff.
//
// Sem primeiro nome, cai na saudacao generica em vez de renderizar uma virgula
// solta. Sem createdAt valido, a segunda linha nao renderiza.

import { StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { formatMemberSince } from '~/screens/inicio/format-member';
import { p } from '~/screens/inicio/palette';

export function MemberGreeting({
  firstName,
  createdAt,
}: {
  firstName: string | null;
  createdAt: string | null;
}) {
  const since = createdAt ? formatMemberSince(createdAt) : '';
  const greeting = firstName
    ? inicioCopy.member.greeting(firstName)
    : inicioCopy.member.greetingFallback;

  return (
    <View style={styles.wrap}>
      <Text style={styles.greeting} accessibilityRole="header">
        {greeting}
      </Text>
      {since ? <Text style={styles.since}>{inicioCopy.member.memberSince(since)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  greeting: {
    fontFamily: 'Jost_700Bold',
    fontSize: 19,
    letterSpacing: 0.19,
    color: p.cream,
  },
  since: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 2.9,
    color: p.muted45,
  },
});
```

- [ ] **Step 4: Escrever NextEventCard**

Criar `apps/mobile/src/screens/inicio/sections/NextEventCard.tsx`, no tratamento do handoff.

Requisitos:

- `FeatureCard` clicável inteiro, com `testID` `inicio-next-event`. A pílula `VER EVENTO` (`GoldPill` sem `onPress` próprio, ou um `View` com o mesmo tratamento visual) é affordance, não um segundo alvo de toque. Se `GoldPill` exigir `onPress`, passar o mesmo handler do card, mas garantir que o card inteiro também dispara.
- Label `inicioCopy.sections.nextEvent` como eyebrow dourado.
- Título do evento em 17px weight 600.
- Duas metalinhas de 13px com ícone dourado de 16px: `calendar` mais a data via `formatEventDateRange`, e `car` mais cidade e estado quando houver.
- Thumb do evento à direita com 96px de largura e raio 12, quando `coverUrl` existir.
- `event` nulo renderiza um vazio discreto com `inicioCopy.empty.noNextEvent`, não `null`. Este é o eixo visual da tela e um buraco aqui fica pior que uma linha de texto. Isto responde a primeira pergunta aberta do handoff em "Antes de implementar".

- [ ] **Step 5: Escrever MyTicketsSection**

Requisitos:

- `SectionLabel` com `inicioCopy.sections.myTickets`, mais link de rodapé `inicioCopy.cards.seeTickets` chamando `onSeeAll`.
- Faixa horizontal. Cada card mostra o título do evento, a data, e o `tierName`. `testID`: `inicio-ticket-<id>`.
- Filtra apenas ingressos válidos. Conferir no Step 1 o nome exato do valor de `status` que representa válido e usar o real.
- Renderiza `null` quando a lista filtrada está vazia.

- [ ] **Step 6: Escrever MyGarageSection**

Requisitos:

- Renderiza `null` quando `garage` é nulo **ou** quando `garage.gamification.enabled` é falso. O killswitch de gamificação já existe no backend e precisa ser respeitado aqui.
- `SectionLabel` com `inicioCopy.sections.myGarage`.
- Reusa `XPScoreboard` de `@ccc/ui` alimentado por `garage.progress`. Se `progress` estiver ausente, não renderiza o scoreboard mas ainda renderiza o resto.
- Reusa `BadgeRow` de `@ccc/ui` com `garage.garage.badges`. Se a lista estiver vazia, omite a fileira.
- Uma linha com a contagem de carros e de vagas, derivada de `garage.cars.length` e `garage.spots.length`.
- Todo o bloco é clicável, chamando `onPress`, com `testID` `inicio-garage`.
- **Não reimplementar XP nem badges.** Se as props reais de `XPScoreboard` ou `BadgeRow` não encaixarem no que `getGarage` devolve, parar e reportar em vez de escrever uma versão paralela.

- [ ] **Step 7: Escrever SubscriptionSection**

Requisitos:

- `status` nulo renderiza `null`.
- `status.active` verdadeiro: `SectionLabel` com `inicioCopy.sections.subscription`, `PremiumBadge` de `@ccc/ui` com o tier, e um link chamando `onManage`. `testID`: `inicio-subscription-active`.
- `status.active` falso: bloco de upsell com `GoldPill` de rótulo `inicioCopy.cards.subscribeUpsell` chamando `onSubscribe`. `testID`: `inicio-subscription-upsell`.
- Conferir no Step 1 se `tier` pode ser nulo com `active` verdadeiro. Se puder, tratar.

- [ ] **Step 8: Escrever BoxSection**

Requisitos:

- Renderiza `null` quando `isPremiumActive` é falso, **antes** de olhar `box`. A caixa é benefício de assinante e não deve aparecer para quem não é.
- Renderiza `null` quando `box` é nulo.
- `SectionLabel` com `inicioCopy.sections.box`, uma linha com o estado do ciclo corrente, e um link `inicioCopy.cards.seeBox` chamando `onPress`. `testID`: `inicio-box`.
- Para o texto do estado, mapear o enum de status de `BoxView` para PT-BR. Se `apps/mobile/src/copy/caixa.ts` já tiver esse mapa, **reusar** em vez de duplicar.

- [ ] **Step 9: Escrever QuickAccessSection**

Requisitos:

- `SectionLabel` com `inicioCopy.sections.quickAccess`.
- Grid 2x2 de `QuickActionTile`, gap 12, com os quatro atalhos: `event` para `/events`, `ticket` para `/tickets`, `car` para `/garage`, `store` para `/store`. Rótulos de `inicioCopy.quickAccess`.
- `testID` de cada tile: `inicio-quick-<chave>`, por exemplo `inicio-quick-events`.
- Sempre renderiza. Não depende de dado nenhum.

- [ ] **Step 10: Escrever os testes das seis seções**

Criar `apps/mobile/src/screens/inicio/sections/__tests__/member-sections.test.tsx`, um `describe` por componente, reusando o boilerplate de `render` e `click` dos outros testes de seção.

Cobertura mínima, um caso por linha:

- `MemberGreeting`: com nome e data renderiza as duas linhas; sem nome usa a saudação genérica; com data inválida omite a segunda linha.
- `NextEventCard`: com evento renderiza título, data e a pílula; tocar chama `onPress` com o slug; sem evento renderiza o vazio e não o card.
- `MyTicketsSection`: renderiza os válidos; tocar chama `onOpenTicket` com o id; lista vazia renderiza `null`; lista só com inválidos renderiza `null`.
- `MyGarageSection`: com gamificação ligada renderiza; com `gamification.enabled` falso renderiza `null`; com `garage` nulo renderiza `null`; tocar chama `onPress`.
- `SubscriptionSection`: ativa mostra o tier e chama `onManage`; inativa mostra o upsell e chama `onSubscribe`; nula renderiza `null`.
- `BoxSection`: premium ativo com box renderiza; premium inativo renderiza `null` mesmo com box presente; box nulo renderiza `null`.
- `QuickAccessSection`: renderiza os quatro rótulos; cada tile chama `onNavigate` com o path certo.

Mocar `@ccc/ui` apenas se `XPScoreboard`, `BadgeRow` ou `PremiumBadge` não renderizarem sob jsdom. Preferir usar os componentes reais; mocar é o último recurso e precisa de justificativa no report.

- [ ] **Step 11: Rodar tudo**

```bash
pnpm --filter @ccc/mobile test -- member-sections format-member
```

Esperado: PASS em todos os casos.

```bash
pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint
```

Esperado: sem erro.

- [ ] **Step 12: Commit**

```bash
git add apps/mobile/src/screens/inicio
git commit -m "feat(mobile): secoes da home do membro logado"
```

---

### Task 11: MemberHome, a home do membro conforme o handoff

**Files:**

- Create: `apps/mobile/src/screens/inicio/MemberHome.tsx`
- Create: `apps/mobile/src/screens/inicio/useMemberHomeData.ts`
- Create: `apps/mobile/src/screens/inicio/__tests__/MemberHome.test.tsx`

**Interfaces:**

- Consumes: as sete seções da Task 10. `HeroSection` e `ClubStatsSection` da Task 7. `AppHeader` da Task 6. `useHomeContent` e `useClubStats` da Task 5. `useUnreadCount` de `~/hooks/useUnreadCount`. `useAuth` de `~/auth/context`.
- Produces:
  - `useMemberHomeData(): MemberHomeData` em `~/screens/inicio/useMemberHomeData`.
  - `MemberHome()` em `~/screens/inicio/MemberHome`.

**Substitui** o plano original, que movia o `welcome.tsx` atual sem alterar nada. Decisão do usuário registrada no ledger: a home do membro passa a ser reescrita conforme o handoff, surfando o que o app já tem.

**Regra de erro, diferente do GuestHome:** o `GuestHome` é uma request única, então falha é total. O `MemberHome` junta seis fontes independentes, então **falha de um bloco esconde só aquele bloco** e não derruba a tela. Cada bloco tem seu próprio carregamento e vazio. Isto responde a terceira pergunta aberta do handoff em "Antes de implementar", e é o motivo de as seções da Task 10 serem puras.

- [ ] **Step 1: Escrever o hook agregador**

Criar `apps/mobile/src/screens/inicio/useMemberHomeData.ts`.

Requisitos:

- Dispara em paralelo, cada um com seu próprio estado, sem que a falha de um cancele os outros. Usar `Promise.allSettled` ou um `useState` por fonte. Nunca `Promise.all`, que propagaria a primeira rejeição.
- Fontes: `getProfile()`, `listEvents({ window: 'upcoming', limit: 1 })`, `listMyTickets()`, `getGarage()`, `getPremiumStatus()`, `getBox()`.
- **`getBox()` só é chamado quando a garagem já respondeu com `isPremiumActive` verdadeiro.** Chamar para quem não é assinante gera 4xx previsível e ruído no Sentry. Se isso obrigar a uma segunda fase, fazer em duas fases e comentar por quê.
- Devolve um objeto com um campo por fonte, cada um no formato `{ data, loading, error }`, mais um `refreshAll()`.
- Tipar o retorno explicitamente com um `type MemberHomeData` exportado, para o `MemberHome` e o teste não dependerem de inferência.
- Nada de `captureException` para falha de leitura esperada. Seguir o que `welcome.tsx` fazia: falha de rede vira estado, não exceção reportada.

- [ ] **Step 2: Escrever o teste do MemberHome, que falha**

Criar `apps/mobile/src/screens/inicio/__tests__/MemberHome.test.tsx`.

Mocar `~/screens/inicio/useMemberHomeData`, `~/hooks/useHomeContent`, `~/hooks/useClubStats`, `~/hooks/useUnreadCount` e `expo-router`, no padrão de `GuestHome.test.tsx`. Um objeto `vi.hoisted` mutável por hook, reatribuído no `beforeEach`, para cada caso montar o cenário que quer.

Casos obrigatórios:

- Cenário completo renderiza, na ordem: header, hero, saudação, próximo evento, status do clube, meus ingressos, minha garagem, assinatura, caixa, acesso rápido.
- **Nenhuma seção da vitrine do anônimo aparece.** Assertar explicitamente que `inicioCopy.cta.signup`, `inicioCopy.cta.subscribe` e `inicioCopy.sections.plans` NÃO estão no `textContent`. Esta é a trava contra vazamento entre os dois estados.
- Falha só no bloco de ingressos: o resto da tela continua renderizando, e o rótulo de `myTickets` não aparece.
- Falha só no bloco de garagem: o resto continua, e o rótulo de `myGarage` não aparece.
- Falha no `useHomeContent`: o hero não aparece, mas saudação, próximo evento e acesso rápido continuam. Prova que a regra por bloco vale também para o conteúdo institucional.
- Membro não premium: `inicio-box` não existe e `inicio-subscription-upsell` existe.
- Membro premium: `inicio-box` existe e `inicio-subscription-active` existe.
- Sino de notificações com não lidas mostra o badge; sem não lidas, não mostra.
- Tocar no sino navega para `/notifications`.
- Tocar num tile do acesso rápido navega para o path correspondente.

- [ ] **Step 3: Escrever MemberHome**

Criar `apps/mobile/src/screens/inicio/MemberHome.tsx`.

Requisitos de montagem, na ordem vertical:

1. `AppHeader` com o sino de notificações no slot `right`. Badge de não lidas via `useUnreadCount(true)`, no mesmo tratamento visual que o `welcome.tsx` atual usa (círculo com a contagem, `99+` acima de 99). Tocar navega para `/notifications`.
2. `HeroSection` com `content.hero` e `content.institutional` de `useHomeContent`. Não renderiza quando o conteúdo falhou.
3. `MemberGreeting` com o primeiro nome de `user.name` e `createdAt` do perfil.
4. `NextEventCard` com o primeiro item de `listEvents`, navegando para `/events/<slug>`.
5. `ClubStatsSection` com `stats` de `useClubStats`.
6. `MyTicketsSection`, navegando para `/tickets/<id>` e `/tickets`.
7. `MyGarageSection`, navegando para `/garage`.
8. `SubscriptionSection`, navegando para `/assinaturas/minha-assinatura` quando ativa e `/assinaturas` quando não.
9. `BoxSection`, navegando para `/caixa`.
10. `QuickAccessSection`.

Estrutura: `SafeAreaView` com `backgroundColor` de `p.bg`, `ScrollView` com `contentContainerStyle` de padding lateral 20, `paddingTop: 6`, `paddingBottom: 48` e `gap: 26`, `showsVerticalScrollIndicator={false}`. Mesmo esqueleto do `GuestHome`.

O primeiro nome sai de `user.name` do `useAuth`, com fallback para o `name` do perfil carregado. Extrair com `(name ?? '').trim().split(/\s+/)[0] ?? ''`, o mesmo idiom que o `welcome.tsx` atual já usa.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @ccc/mobile test -- MemberHome
```

Esperado: PASS em todos os casos do Step 2.

- [ ] **Step 5: Typecheck e lint**

```bash
pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint
```

Esperado: sem erro.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/inicio
git commit -m "feat(mobile): home do membro logado conforme o handoff"
```

---

### Task 12: Montagem da tela

**Files:**

- Create: `apps/mobile/src/screens/inicio/GuestHome.tsx`
- Create: `apps/mobile/src/screens/inicio/InicioScreen.tsx`
- Modify: `apps/mobile/app/welcome.tsx`
- Create: `apps/mobile/src/screens/inicio/__tests__/GuestHome.test.tsx`
- Create: `apps/mobile/src/screens/inicio/__tests__/InicioScreen.test.tsx`

**Interfaces:**

- Consumes: todas as seções das Tasks 6 a 9. `useHomeContent` e `useClubStats` da Task 5. `MemberHome` da Task 11. `useAuth` de `~/auth/context`. `buildLoginHref` de `~/auth/redirect-intent`.
- Produces: `GuestHome()`, `InicioScreen()` (export default em `InicioScreen.tsx`).

- [ ] **Step 1: CANCELADO. Não criar `MemberHome.tsx`.**

O Step 1 original mandava criar `MemberHome.tsx` com o conteúdo atual de `app/welcome.tsx`, sem alterar comportamento. Isso foi **cancelado pela emenda de escopo**: a Task 11 já criou `apps/mobile/src/screens/inicio/MemberHome.tsx` do zero, conforme o handoff, junto com `useMemberHomeData.ts` e seus testes.

**Não sobrescrever, não recriar e não mover nada para esse arquivo.** Ele está pronto, revisado e commitado. `MemberHome` é apenas consumido por `InicioScreen` no Step 8.

O conteúdo antigo de `app/welcome.tsx` é descartado quando o Step 9 o substitui pelo wrapper. Se algum helper do arquivo antigo (`isSoon`, `venueLine`, `eventTypeLabel`) for útil e não existir em `~/lib/format`, movê-lo para onde faça sentido em vez de deixar código morto, e registrar a decisão no report.

- [ ] **Step 2: Escrever o teste do `GuestHome` que falha**

Criar `apps/mobile/src/screens/inicio/__tests__/GuestHome.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// GuestHome é a vitrine do não logado. O que vale pinar: as seis seções
// renderizam com dados do backend, os CTAs desviam pelo login, seção vazia
// não deixa cabeçalho órfão, e loading e erro têm tratamento próprio.

import type { HomeContentResponse } from '@ccc/shared/home';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inicioCopy } from '~/copy/inicio';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const routerPush = vi.fn();

const hookState = vi.hoisted(() => ({
  home: {
    content: null as HomeContentResponse | null,
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  },
}));

vi.mock('~/hooks/useHomeContent', () => ({
  useHomeContent: () => hookState.home,
}));

vi.mock('expo-router', () => ({
  router: { push: (href: string) => routerPush(href) },
  useRouter: () => ({ push: (href: string) => routerPush(href) }),
}));

const { GuestHome } = await import('../GuestHome');

const CONTENT: HomeContentResponse = {
  hero: {
    title: 'DIRIGIR. CONECTAR. PERTENCER.',
    subtitle: 'O clube de carros de Curitiba.',
    bannerUrl: null,
  },
  institutional: {
    title: 'A Casa',
    body: 'Um clubhouse automotivo privado em Curitiba.',
    imageUrl: null,
  },
  benefits: [{ icon: 'calendar', title: 'Eventos exclusivos', description: null, sortOrder: 0 }],
  highlights: [
    {
      kind: 'event',
      title: 'Próximos encontros',
      subtitle: null,
      imageUrl: null,
      linkPath: '/events',
      sortOrder: 0,
    },
  ],
  plans: [
    {
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      description: null,
      fromAmountCents: 49900,
      currency: 'BRL',
      benefits: ['Day Use ilimitado'],
      sortOrder: 0,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  routerPush.mockReset();
  hookState.home = {
    content: CONTENT,
    loading: false,
    error: false,
    refresh: () => Promise.resolve(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () => act(() => root.render(<GuestHome />));

const click = (testID: string) => {
  const el = container.querySelector(`[data-testid="${testID}"]`);
  expect(el).not.toBeNull();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('GuestHome', () => {
  it('renders all six sections', () => {
    render();
    expect(container.textContent).toContain('DIRIGIR. CONECTAR. PERTENCER.');
    expect(container.textContent).toContain('A Casa');
    expect(container.textContent).toContain(inicioCopy.sections.benefits);
    expect(container.textContent).toContain(inicioCopy.cta.signup);
    expect(container.textContent).toContain(inicioCopy.cta.subscribe);
    expect(container.textContent).toContain(inicioCopy.sections.plans);
    expect(container.textContent).toContain(inicioCopy.sections.highlights);
  });

  it('sends the create-account CTA straight to signup', () => {
    render();
    click('inicio-cta-signup');
    expect(routerPush).toHaveBeenCalledWith('/signup');
  });

  it('routes the subscribe CTA through login carrying /assinaturas', () => {
    render();
    click('inicio-cta-subscribe');
    expect(routerPush).toHaveBeenCalledTimes(1);
    const href = routerPush.mock.calls[0][0] as string;
    expect(href).toContain('/login');
    expect(href).toContain('assinaturas');
  });

  it('routes a plan card through login as well', () => {
    render();
    click('inicio-plan-ouro');
    const href = routerPush.mock.calls[0][0] as string;
    expect(href).toContain('/login');
    expect(href).toContain('assinaturas');
  });

  it('shows a skeleton while loading and no section labels', () => {
    hookState.home = {
      content: null,
      loading: true,
      error: false,
      refresh: () => Promise.resolve(),
    };
    render();
    expect(container.querySelector('[data-testid="inicio-skeleton"]')).not.toBeNull();
    expect(container.textContent).not.toContain(inicioCopy.sections.plans);
  });

  it('shows the error state with a retry that calls refresh', () => {
    const refresh = vi.fn(() => Promise.resolve());
    hookState.home = { content: null, loading: false, error: true, refresh };
    render();
    expect(container.textContent).toContain(inicioCopy.states.errorTitle);
    click('inicio-error-retry');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('omits a section entirely when its list is empty', () => {
    hookState.home = {
      content: { ...CONTENT, plans: [], highlights: [] },
      loading: false,
      error: false,
      refresh: () => Promise.resolve(),
    };
    render();
    expect(container.textContent).toContain(inicioCopy.sections.benefits);
    expect(container.textContent).not.toContain(inicioCopy.sections.plans);
    expect(container.textContent).not.toContain(inicioCopy.sections.highlights);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter @ccc/mobile test -- GuestHome
```

Esperado: FAIL, `Failed to resolve import "../GuestHome"`.

- [ ] **Step 4: Escrever `GuestHome`**

Criar `apps/mobile/src/screens/inicio/GuestHome.tsx`:

```tsx
// Vitrine da tela de Início para o usuário não logado.
//
// Seis seções na ordem da User Story: apresentação, benefícios, CTA criar
// conta, CTA assinar, planos, eventos e experiências. Todo o conteúdo vem de
// GET /api/home-content, então mudar uma linha no banco muda a tela sem
// republicar o app.
//
// Uma request cobre a tela inteira, então a falha é total: não há degradação
// parcial por bloco. Seção sem item ativo simplesmente não renderiza.

import { router } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { buildLoginHref } from '~/auth/redirect-intent';
import { inicioCopy } from '~/copy/inicio';
import { useHomeContent } from '~/hooks/useHomeContent';
import { BenefitsSection } from '~/screens/inicio/sections/BenefitsSection';
import { CtaSection } from '~/screens/inicio/sections/CtaSection';
import { HeroSection } from '~/screens/inicio/sections/HeroSection';
import { HighlightsSection } from '~/screens/inicio/sections/HighlightsSection';
import { PlansSection } from '~/screens/inicio/sections/PlansSection';
import { p } from '~/screens/inicio/palette';

// Anônimo tocando em assinar ou num plano vai para o login carregando
// next=/assinaturas. O prefixo está liberado em src/auth/redirect-intent.ts,
// senão o destino seria descartado e o usuário cairia em DEFAULT_POST_AUTH.
const SUBSCRIBE_PATH = '/assinaturas';

export function GuestHome() {
  const { content, loading, error, refresh } = useHomeContent();

  const goSignup = () => router.push('/signup');
  const goSubscribe = () => router.push(buildLoginHref(SUBSCRIBE_PATH));
  const goLink = (path: string) => router.push(path as never);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <InicioSkeleton /> : null}

        {!loading && error ? <InicioError onRetry={() => void refresh()} /> : null}

        {!loading && !error && content ? (
          <>
            <HeroSection hero={content.hero} institutional={content.institutional} />
            <BenefitsSection benefits={content.benefits} />
            <CtaSection onCreateAccount={goSignup} onSubscribe={goSubscribe} />
            <PlansSection plans={content.plans} onOpenPlan={goSubscribe} onSeeAll={goSubscribe} />
            <HighlightsSection highlights={content.highlights} onOpenLink={goLink} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// Skeleton nos formatos reais: hero, faixa de benefícios, cards de plano.
// Nunca spinner de tela cheia.
function InicioSkeleton() {
  return (
    <View style={styles.skeletonWrap} testID="inicio-skeleton">
      <View style={styles.skeletonHero} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonRow} />
      <View style={styles.skeletonRow} />
      <View style={styles.skeletonCard} />
      <View style={styles.skeletonCard} />
    </View>
  );
}

function InicioError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.errorWrap}>
      <Text style={styles.errorText}>{inicioCopy.states.errorTitle}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={inicioCopy.states.errorRetry}
        testID="inicio-error-retry"
        style={({ pressed }) => [styles.retry, pressed ? styles.pressed : null]}
      >
        <Text style={styles.retryLabel}>{inicioCopy.states.errorRetry}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 48, gap: 26 },
  skeletonWrap: { gap: 14 },
  skeletonHero: { height: 210, borderRadius: 20, backgroundColor: p.surface },
  skeletonLine: { height: 14, width: '60%', borderRadius: 7, backgroundColor: p.surface },
  skeletonRow: { height: 72, borderRadius: 14, backgroundColor: p.surface },
  skeletonCard: { height: 140, borderRadius: 14, backgroundColor: p.surface },
  errorWrap: { gap: 16, alignItems: 'flex-start' },
  errorText: {
    fontFamily: 'Jost_500Medium',
    fontSize: 14,
    lineHeight: 21,
    color: p.muted60,
  },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: p.gold,
  },
  pressed: { opacity: 0.85 },
  retryLabel: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.8,
    color: p.gold,
    textTransform: 'uppercase',
  },
});
```

Nota: `onOpenPlan` recebe o slug mas o destino é a jornada de assinatura, igual ao CTA. `goSubscribe` ignora o argumento de propósito, porque o anônimo não entra direto no detalhe do plano. Quando o estado logado ganhar a Seção 5, o handler passa a usar o slug.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter @ccc/mobile test -- GuestHome
```

Esperado: PASS, 7 testes.

- [ ] **Step 6: Escrever o teste do `InicioScreen` que falha**

Criar `apps/mobile/src/screens/inicio/__tests__/InicioScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// InicioScreen só decide entre três estados de autenticação. GuestHome e
// MemberHome são stubados: o comportamento de cada um tem teste próprio.
// O que vale pinar aqui é que o membro NÃO vê a vitrine, e que o anônimo NÃO
// vê a home do membro, sem flicker durante o carregamento da sessão.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const authState = vi.hoisted(() => ({
  status: 'unauthenticated' as 'loading' | 'unauthenticated' | 'authenticated',
}));

vi.mock('~/auth/context', () => ({
  useAuth: () => authState,
}));

vi.mock('~/screens/inicio/GuestHome', () => ({
  GuestHome: () => <Text>GUEST_HOME</Text>,
}));

vi.mock('~/screens/inicio/MemberHome', () => ({
  MemberHome: () => <Text>MEMBER_HOME</Text>,
}));

const InicioScreen = (await import('../InicioScreen')).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () => act(() => root.render(<InicioScreen />));

describe('InicioScreen', () => {
  it('renders the guest showcase for an anonymous visitor', () => {
    authState.status = 'unauthenticated';
    render();
    expect(container.textContent).toContain('GUEST_HOME');
    expect(container.textContent).not.toContain('MEMBER_HOME');
  });

  it('renders the member home for an authenticated member', () => {
    authState.status = 'authenticated';
    render();
    expect(container.textContent).toContain('MEMBER_HOME');
    expect(container.textContent).not.toContain('GUEST_HOME');
  });

  it('renders neither variant while the session is still loading', () => {
    authState.status = 'loading';
    render();
    expect(container.textContent).not.toContain('GUEST_HOME');
    expect(container.textContent).not.toContain('MEMBER_HOME');
    expect(container.querySelector('[data-testid="inicio-auth-pending"]')).not.toBeNull();
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

```bash
pnpm --filter @ccc/mobile test -- InicioScreen
```

Esperado: FAIL, `Failed to resolve import "../InicioScreen"`.

- [ ] **Step 8: Escrever `InicioScreen`**

Criar `apps/mobile/src/screens/inicio/InicioScreen.tsx`:

```tsx
// Tela de Início — ponto de entrada de /welcome.
//
// Duas variantes: a vitrine do não logado (GuestHome) e a home do membro
// (MemberHome, comportamento atual preservado). Enquanto a sessão não
// resolveu, nenhuma das duas renderiza: mostrar MemberHome e trocar por
// GuestHome logo depois causaria flicker no anônimo.
//
// A entrada da tela (fade mais translateY de 10px, 320ms) fica em cada
// variante, quando entrar. Não implementada nesta primeira versão.

import { View, StyleSheet } from 'react-native';

import { useAuth } from '~/auth/context';
import { GuestHome } from '~/screens/inicio/GuestHome';
import { MemberHome } from '~/screens/inicio/MemberHome';
import { p } from '~/screens/inicio/palette';

export default function InicioScreen() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <View style={styles.pending} testID="inicio-auth-pending" />;
  }

  return status === 'unauthenticated' ? <GuestHome /> : <MemberHome />;
}

const styles = StyleSheet.create({
  pending: { flex: 1, backgroundColor: p.bg },
});
```

- [ ] **Step 9: Trocar `welcome.tsx` pelo wrapper**

Substituir todo o conteúdo de `apps/mobile/app/welcome.tsx` por:

```tsx
// A rota /welcome não muda: continua sendo a primeira tela do app, e segue em
// PUBLIC_EXACT em src/auth/redirect-intent.ts. O conteúdo mora em
// src/screens/inicio, no padrão das outras áreas do app.

import InicioScreen from '~/screens/inicio/InicioScreen';

export default function WelcomeRoute() {
  return <InicioScreen />;
}
```

- [ ] **Step 10: Rodar toda a suíte do mobile**

```bash
pnpm --filter @ccc/mobile test
```

Esperado: PASS em tudo, incluindo os testes pré-existentes de outras telas.

- [ ] **Step 11: Typecheck e lint**

```bash
pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint
```

Esperado: sem erro. Se o lint reclamar de import não usado em `MemberHome.tsx` (por exemplo `useAuth` continuar necessário lá), corrigir mantendo o comportamento.

- [ ] **Step 12: Commit**

```bash
git add apps/mobile/src/screens/inicio apps/mobile/app/welcome.tsx
git commit -m "feat(mobile): monta a tela de inicio com vitrine do nao logado"
```

#### Adendo da emenda de escopo

Duas mudanças nesta task.

**1. O Step 1 original está CANCELADO.** Ele mandava mover o conteúdo de `app/welcome.tsx` para `MemberHome.tsx` sem alterar nada. A Task 11 já criou o `MemberHome` do zero, conforme o handoff. **Não mover nada de `welcome.tsx`.** O conteúdo antigo do `welcome.tsx` é descartado quando o Step 9 o substitui pelo wrapper. Se algum helper do arquivo antigo (`isSoon`, `venueLine`, `eventTypeLabel`) for útil e não existir em `~/lib/format`, movê-lo para onde faça sentido em vez de deixar código morto, e registrar a decisão no report.

**2. O `GuestHome` ganha o header e as duas seções novas.** A ordem vertical passa a ser:

1. `AppHeader` com um botão `ENTRAR` no slot `right`, navegando para `buildLoginHref('/welcome')`. `testID`: `inicio-guest-login`.
2. `HeroSection`
3. `BenefitsSection`
4. `ClubStatsSection` com `stats` de `useClubStats`
5. `CtaSection`
6. `PlansSection`
7. `HighlightsSection`, agora recebendo também `events` de `listEvents({ window: 'upcoming', limit: 3 })`
8. `StoreTeaserSection`
9. `ConfirmedCarsSection`, com o slug do primeiro evento próximo, ou `null` quando não houver

O `GuestHome` passa a consumir `useClubStats` além de `useHomeContent`, e a buscar os próximos eventos. **A regra de erro não muda:** a falha do `useHomeContent` continua sendo total, porque hero, benefícios, planos e destaques curados vêm todos dele e sem eles não há tela. Já `useClubStats`, os eventos, a loja e os carros confirmados são complementares: cada um falha para dentro da própria seção, que simplesmente não renderiza. Comentar essa assimetria no arquivo.

Acrescentar aos testes do `GuestHome`:

- O header renderiza e o botão `ENTRAR` navega para o login carregando `next=/welcome`.
- `ClubStatsSection` aparece com stats e desaparece sem.
- Falha nos eventos não impede o resto de renderizar.
- **Nenhuma seção do membro aparece:** assertar que `inicioCopy.sections.myTickets`, `inicioCopy.sections.myGarage` e `inicioCopy.sections.quickAccess` NÃO estão no `textContent`. Trava simétrica à do `MemberHome`.

---

### Task 13: Verificação de ponta a ponta

**Files:**

- Nenhum arquivo novo. Correções pontuais no que a verificação apontar.

**Interfaces:**

- Consumes: tudo das Tasks 1 a 9.
- Produces: evidência de que o monorepo está verde e a tela funciona no app rodando.

- [ ] **Step 1: Rodar a suíte inteira do monorepo**

```bash
pnpm -r test
```

Esperado: PASS em `@ccc/shared`, `@ccc/api`, `@ccc/mobile`, `@ccc/ui`, `@ccc/admin`. Se `@ccc/api` falhar por falta de Postgres, subir `docker compose up -d db` e repetir.

- [ ] **Step 2: Typecheck e lint do monorepo**

```bash
pnpm -r typecheck && pnpm -r lint
```

Esperado: sem erro.

- [ ] **Step 3: Subir a API e conferir a resposta real do endpoint**

```bash
pnpm --filter @ccc/api dev
```

Em outro terminal:

```bash
curl -s http://localhost:3000/api/home-content | head -c 800
```

Esperado: JSON com as chaves `hero`, `institutional`, `benefits`, `highlights`, `plans`, com os 5 benefícios e 4 destaques do seed. Confirmar que a string `objectKey` não aparece na resposta.

- [ ] **Step 4: Conferir o rate limit**

```bash
for i in $(seq 1 65); do curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/api/home-content; done; echo
```

Esperado: os primeiros retornam `200` e os últimos `429`.

- [ ] **Step 5: Rodar o app e verificar a tela como usuário não logado**

Iniciar o preview do mobile com a ferramenta de preview do harness (`.claude/launch.json`, entrada do Expo web) ou:

```bash
pnpm --filter @ccc/mobile start:web
```

Abrir `/welcome` deslogado e conferir, item por item:

1. Seção 1 mostra o mote, o subtítulo e o bloco institucional.
2. Seção 2 lista os 5 benefícios do seed com ícone.
3. Seção 3 leva para o cadastro ao tocar em CRIAR CONTA.
4. Seção 4 leva para o login com `next=/assinaturas` ao tocar em QUERO ASSINAR, e após autenticar aterrissa em `/assinaturas`.
5. Seção 5 mostra os planos com valor inicial formatado em reais e até 3 benefícios.
6. Seção 6 mostra os 4 destaques, e o de "Próximos encontros" navega para `/events`.
7. Nenhum erro no console do navegador.

- [ ] **Step 6: Verificar que o membro logado não regrediu**

Autenticar no app e voltar para `/welcome`. Esperado: a tela é visualmente idêntica à de antes desta entrega (próximo evento em destaque, eventos secundários, header com sino e perfil). Nenhuma das seis seções de vitrine aparece.

- [ ] **Step 7: Registrar a evidência e commitar eventuais correções**

Se algum passo de 1 a 6 falhou, corrigir e repetir do Step 1. Só depois:

```bash
git add -A
git commit -m "fix(inicio): ajustes da verificacao de ponta a ponta"
```

Se nada precisou de correção, pular o commit.

- [ ] **Step 8: Abrir o PR contra `main`**

```bash
git push -u origin feat/tela-inicial
```

```bash
gh pr create --base main --title "feat: tela de inicio para usuario nao logado" --body-file docs/superpowers/specs/2026-08-19-tela-inicio-design.md
```

O corpo do PR deve listar explicitamente o que ficou fora de escopo, copiado da seção "Fora de escopo" do spec.

#### Adendo da emenda de escopo

Acrescentar à verificação:

- [ ] **Step A: Conferir o endpoint de contadores na API rodando**

```bash
curl -s http://localhost:3000/api/club-stats
```

Esperado: JSON `{"members":N,"events":N,"cars":N}` com inteiros não negativos. Conferir que o número de eventos corresponde apenas aos publicados com início no futuro, comparando com o que `GET /events?window=upcoming` devolve.

- [ ] **Step B: Conferir o cache dos contadores**

Chamar duas vezes seguidas e confirmar que a segunda resposta é imediata. Depois criar um carro no banco, chamar de novo dentro dos cinco minutos, e confirmar que o número **não** mudou. Este é o comportamento pretendido.

- [ ] **Step C: Verificar a home do membro no app**

Autenticar e abrir `/welcome`. Conferir item por item:

1. Header com monograma e sino, badge de não lidas quando houver.
2. Hero institucional com o mesmo conteúdo do estado anônimo.
3. Saudação com o primeiro nome e a linha `MEMBRO DESDE`.
4. Card do próximo evento, navegando para o detalhe.
5. Status do clube com os três contadores.
6. Meus ingressos, quando houver ingresso válido.
7. Minha garagem com XP e badges, quando a gamificação estiver ligada.
8. Assinatura: tier quando ativa, upsell quando não.
9. Caixa do mês, apenas quando premium ativo.
10. Acesso rápido, com os quatro atalhos navegando certo.
11. **Nenhuma seção da vitrine do anônimo aparece.**

- [ ] **Step D: Verificar a degradação por bloco**

Com a API de pé, derrubar propositalmente uma fonte (por exemplo parando o container do Postgres por alguns segundos, ou apontando o app para uma porta errada só para um teste manual) e confirmar que o `MemberHome` esconde os blocos que falharam sem virar tela de erro inteira. Registrar como foi feito.

- [ ] **Step E: Conferir que o anônimo não regrediu**

Deslogar e conferir as nove seções do `GuestHome`, incluindo o botão `ENTRAR` do header, a vitrine da loja e a seção de carros confirmados (que provavelmente não aparece, e isso é o esperado).

---

## Desvios em relação ao spec aprovado

Um item do spec não é implementado.

1. **Animação de entrada não é implementada.** O spec pede fade mais
   `translateY` de 10px em 320ms respeitando "reduzir movimento". Ficou de fora
   por ser puro polimento visual, e por `Animated` mais `AccessibilityInfo`
   exigirem harness de teste próprio sob jsdom, o que custaria mais que o ganho
   nesta entrega. Registrado como dívida abaixo.

`AppHeader` **é** implementado (Task 6). Estava na lista de desvios na primeira
versão deste plano e saiu dela quando o usuário escolheu o header de marca para
o estado anônimo.

`MemberHome` **é** reescrito conforme o handoff (Tasks 10 e 11). A primeira
versão deste plano o mantinha byte a byte; a emenda de escopo do usuário
substituiu essa decisão.

## Dívidas registradas

1. `apps/mobile/src/screens/assinaturas/tier-visual.ts` duplica a paleta do
   handoff (`goldDeep`, `goldLight`, surface `#0F0E0B`, hairline
   `rgba(212,175,55,0.14)`) que a Task 5 promove a token em `packages/design`.
   Consolidar num PR separado, migrando `tier-visual.ts` para os tokens. Não
   fazer aqui: mexeria em telas fora do escopo.
2. CRUD administrativo do conteúdo institucional, incluindo upload das imagens
   de banner e institucional para R2.
3. Animação de entrada da tela (fade mais `translateY` de 10px em 320ms,
   respeitando "reduzir movimento").
4. Pull-to-refresh na Início.
5. Sem gate automático de drift entre migration e schema no CI.
   `.github/workflows/ci.yml` roda apenas `prisma migrate deploy`; não existe
   `prisma validate` nem `prisma format --check` em nenhum workflow ou script.
   Como este repo escreve migrations à mão, divergência só é pega por acidente.
   Achado da review da Task 1.
6. `seed.ts` faz `homeBenefit.deleteMany()` e `homeHighlight.deleteMany()` sem
   `where`. Quando o CRUD admin existir, rodar `db:seed` apaga linhas curadas.
   Levar para as notas do PR de CRUD admin. Achado da review da Task 1.
7. `cheapestActivePrice` em `apps/api/src/routes/home-content.ts` depende do
   `where: { active: true }` do chamador em vez de filtrar por conta própria.
   Um segundo chamador sem essa cláusula pegaria preço inativo em silêncio.
   Achado da review da Task 3.
8. Tab bar do handoff (Início, Comunidade, Garagem, Perfil). O app tem uma tab
   bar diferente e `/welcome` não está nela. Fora do escopo desta entrega.
9. Endpoint público de parceiros. `Partner` e `PartnerModule` só existem em CRUD
   admin e dentro do `/me/box/catalog` autenticado, então a Seção 6 usa
   destaques curados para representar parceiros em vez de dados reais.

---

### Task 14: Aba Início na tab bar

Pedida pelo usuário depois da Task 13. A tela existe e funciona, mas só é
alcançável em `/welcome`, que é rota de topo e não está no grupo `(app)` de
tabs. O usuário quer um botão Início na tab bar, primeiro da esquerda para a
direita, abrindo esta tela nos dois estados.

Isto sai da lista de dívidas (item 8) e entra em escopo.

**Files:**

- Create: `apps/mobile/app/(app)/inicio.tsx`
- Modify: `apps/mobile/src/navigation/app-tabs.ts`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Modify: `apps/mobile/app/index.tsx`
- Modify: `apps/mobile/app/welcome.tsx`
- Modify: `apps/mobile/src/auth/redirect-intent.ts`
- Modify: `apps/mobile/src/screens/inicio/GuestHome.tsx`
- Modify: `apps/mobile/src/auth/__tests__/redirect-intent.test.ts`
- Modify: `apps/mobile/src/screens/inicio/__tests__/GuestHome.test.tsx`
- Create: `apps/mobile/app/__tests__/inicio-route.test.tsx`

**Interfaces:**

- Consumes: `InicioScreen` da Task 12.
- Produces: rota `/inicio` dentro do grupo `(app)`, registrada como primeira aba.

**Por que dentro de `(app)` e não um link para `/welcome`:** `(app)/_layout.tsx`
não tem gate de autenticação, só `CartProvider` e `Tabs`, então o anônimo pode
estar dentro do grupo. Uma aba precisa de uma rota irmã das outras para o estado
ativo, o histórico e o comportamento de voltar funcionarem como nas demais. Um
`href` apontando para fora do grupo daria aba sem estado ativo.

- [ ] **Step 1: Levantar o que depende dos índices de `APP_TAB_SPECS`**

`_layout.tsx` referencia `APP_TAB_SPECS[0]`, `[2]`, `[4]` e `[5]` por posição.
Inserir uma entrada no começo desloca todos. Antes de mexer:

```bash
grep -rn "APP_TAB_SPECS" apps/mobile
```

Anotar cada uso e cada teste que dependa de posição ou de contagem. Corrigir
todos. Se existir teste que assere a lista inteira, ele passa a esperar sete
entradas com `inicio` na primeira posição.

- [ ] **Step 2: Escrever os testes que falham**

Cobrir, com a mutação que cada um pega anotada no report:

1. `APP_TAB_SPECS[0]` é `{ name: 'inicio', title: 'Início', visible: true }`, e
   a ordem das outras seis não mudou. Mutação pega: inserir em outra posição.
2. `apps/mobile/app/(app)/inicio.tsx` renderiza `InicioScreen` e nada mais.
   Mutação pega: reintroduzir lógica de tela no arquivo de rota.
3. `sanitizeNext('/inicio')` devolve `/inicio`, e `isPublicPath('/inicio')` é
   `true`. Mutação pega: esquecer de liberar a rota, o que mandaria o anônimo
   para o login ao tocar na aba.
4. `sanitizeNext('/inicioEVIL')` devolve `null`. Mutação pega: matching por
   prefixo cru em vez de fronteira de segmento.
5. `/welcome` continua público e continua sobrevivendo ao `sanitizeNext`, para
   deep links antigos não quebrarem.
6. O botão `ENTRAR` do `GuestHome` navega para o login carregando
   `next=/inicio`. Mutação pega: continuar apontando para `/welcome`, o que
   jogaria o usuário fora do grupo de tabs depois do login.

- [ ] **Step 3: Criar a rota da aba**

Criar `apps/mobile/app/(app)/inicio.tsx`:

```tsx
// Aba Início. Primeira da tab bar.
//
// Fica dentro do grupo (app) para ser irmã das outras abas: estado ativo,
// historico e comportamento de voltar iguais aos demais. O grupo nao tem gate
// de autenticacao, so CartProvider e Tabs, entao o anonimo tambem entra aqui e
// ve a vitrine.

import InicioScreen from '~/screens/inicio/InicioScreen';

export default function InicioTabRoute() {
  return <InicioScreen />;
}
```

- [ ] **Step 4: Registrar a aba como primeira**

Em `apps/mobile/src/navigation/app-tabs.ts`, inserir como primeira entrada de
`APP_TAB_SPECS`:

```ts
  { name: 'inicio', title: 'Início', visible: true },
```

Em `apps/mobile/app/(app)/_layout.tsx`:

1. Importar `Home` de `lucide-react-native` junto dos outros ícones.
2. Declarar o ícone no mesmo formato dos vizinhos:

```tsx
const InicioIcon = ({ color }: { color: string }) => (
  <Home color={color} size={22} strokeWidth={1.75} />
);
```

3. Adicionar como **primeiro** filho de `<Tabs>`, antes de `events`, com o mesmo
   tratamento de `tabPress` que `events` usa e pelo mesmo motivo:

```tsx
<Tabs.Screen
  name="inicio"
  options={{ title: APP_TAB_SPECS[0].title, tabBarIcon: InicioIcon }}
  listeners={{
    tabPress: (e) => {
      e.preventDefault();
      router.replace('/inicio');
    },
  }}
/>
```

4. Corrigir todos os índices deslocados que o Step 1 apurou.

- [ ] **Step 5: Apontar a entrada do app para a aba**

`apps/mobile/app/index.tsx` passa a redirecionar para `/inicio`:

```tsx
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/inicio" />;
}
```

`apps/mobile/app/welcome.tsx` deixa de renderizar a tela e passa a redirecionar,
para deep links antigos, e-mails e qualquer `next=/welcome` gravado continuarem
funcionando:

```tsx
// /welcome virou alias historico. A tela agora mora na aba /inicio, dentro do
// grupo (app), para ter estado ativo na tab bar. Este redirect existe para nao
// quebrar deep link antigo nem `next=/welcome` ja persistido.

import { Redirect } from 'expo-router';

export default function WelcomeRoute() {
  return <Redirect href="/inicio" />;
}
```

- [ ] **Step 6: Liberar `/inicio` no redirect de auth**

Em `apps/mobile/src/auth/redirect-intent.ts`:

1. Acrescentar `'/inicio'` a `PUBLIC_EXACT`. Sem isso, o anônimo tocando na aba
   cai no login, que é exatamente o oposto do pedido.
2. Acrescentar `'/inicio'` a `NEXT_ALLOWED_PREFIXES`.
3. **Manter `/welcome` nos dois.** O alias precisa continuar público para o
   redirect do Step 5 ser alcançável.

- [ ] **Step 7: Apontar o CTA de login do `GuestHome` para a aba**

Em `apps/mobile/src/screens/inicio/GuestHome.tsx`, o `ENTRAR` do header passa a
usar `buildLoginHref('/inicio')`. Deixar `/welcome` ali devolveria o usuário para
fora do grupo de tabs depois do login.

Conferir se há outro `buildLoginHref('/welcome')` no `GuestHome` ou no
`MemberHome` e atualizar todos.

- [ ] **Step 8: Rodar tudo**

```bash
pnpm --filter @ccc/mobile exec vitest run
```

Esperado: PASS, incluindo os testes de aba e de navegação pré-existentes.

```bash
pnpm --filter @ccc/mobile typecheck && pnpm --filter @ccc/mobile lint
```

- [ ] **Step 9: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): aba inicio como primeira da tab bar"
```
