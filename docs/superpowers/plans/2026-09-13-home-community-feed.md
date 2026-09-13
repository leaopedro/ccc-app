# Feed da comunidade na Início — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma seção na tela de Início do app mobile com posts sorteados de eventos públicos, onde tocar num card abre a página do evento já rolada até o feed.

**Architecture:** Um endpoint novo e público (`GET /api/home-feed`) sorteia N posts dentre os 50 mais recentes de eventos com `feedAccess: 'public'`, reusando o serializador de post que hoje vive dentro de `routes/feed.ts`. A quantidade N sai de um campo novo no singleton `HomeContent`, editável no admin. O mobile consome com um hook simples e renderiza um carrossel horizontal em `GuestHome` e `MemberHome`.

**Tech Stack:** Fastify + Prisma (apps/api), Zod (packages/shared), Next.js App Router (apps/admin), Expo React Native + expo-router (apps/mobile), Vitest em todos.

**Spec:** `docs/superpowers/specs/2026-09-13-home-community-feed-design.md`

## Global Constraints

- Idioma da copy visível ao usuário: PT-BR.
- A resposta de `/api/home-feed` NUNCA pode conter `authorUserId`, nem nenhuma chave de `FEED_FORBIDDEN_RESPONSE_KEYS` (`plate`, `email`, `phone`, `cpf`, `userId`, `ownerId`, `address`). Autoria só via `isOwn: boolean`.
- Só entram posts de eventos com `feedEnabled: true` E `feedAccess: 'public'`. Nunca relaxar isso.
- `HOME_FEED_POOL_SIZE = 50`.
- `HomeContent.feedPostCount`: `Int @default(5)`, faixa aceita no admin `0..20`. Zero desliga a seção.
- Ordenação de qualquer query paginada de feed é total: `[{ createdAt: 'desc' }, { id: 'desc' }]`.
- Filtro de bloqueio precisa do ramo `authorUserId: null` no `OR`, senão posts de autor deletado somem.
- Rodar testes do `apps/api` exige Docker ligado (Testcontainers no `test/global-setup.ts`).
- Em worktree nova, antes do primeiro teste: `pnpm --filter @ccc/db --filter @ccc/shared --filter @ccc/design build`.
- Depois de editar qualquer schema em `packages/shared`, rodar `pnpm --filter @ccc/shared build` antes dos testes de `apps/api`. A resolução passa por `dist/`.
- Rodar um arquivo de teste da API com `cd apps/api && pnpm exec vitest run test/<path>`. Nunca `pnpm --filter @ccc/api test -- <file>`: o `--` não filtra e roda a suíte inteira (~13 min).
- Git hooks não instalam em worktree (`.git` é arquivo). Rodar `pnpm exec prettier --write` nos arquivos alterados antes de cada commit.

---

## File Structure

**packages/shared**
- Modificar `src/feed.ts` — acrescenta `HOME_FEED_POOL_SIZE`, `homeFeedItemSchema`, `homeFeedResponseSchema`, e registra os dois no `FEED_PUBLIC_RESPONSE_SCHEMAS`.
- Modificar `src/admin-home.ts` — `feedPostCount` na leitura e na escrita do admin.

**packages/db**
- Modificar `prisma/schema.prisma` — campo `feedPostCount` no model `HomeContent`.
- Criar `prisma/migrations/<timestamp>_home_feed_post_count/migration.sql`.

**apps/api**
- Criar `src/services/feed/serialize.ts` — `CAR_SELECT`, `POST_SELECT`, `serializeCarProfile`, `serializeFeedPost`, extraídos de `routes/feed.ts`. Responsabilidade única: transformar linha do Prisma em payload público de post.
- Modificar `src/routes/feed.ts` — passa a importar do módulo acima em vez de declarar local.
- Criar `src/routes/home-feed.ts` — só o `GET /api/home-feed`.
- Modificar `src/app.ts` — registra a rota.
- Modificar `src/routes/admin/home-content.ts` — `feedPostCount` no serializer e em `CONTENT_FIELDS`.
- Criar `test/home-feed.route.test.ts`.
- Modificar `test/admin/home-content.test.ts`.

**apps/admin**
- Modificar `app/(authed)/configuracoes/home-content-form.tsx` — bloco "Feed da comunidade".
- Modificar `app/(authed)/configuracoes/home-content-form.interaction.test.tsx`.

**apps/mobile**
- Criar `src/api/home-feed.ts` — cliente HTTP.
- Criar `src/hooks/useHomeFeed.ts` — estado do fetch.
- Criar `src/screens/inicio/components/FeedTeaserCard.tsx` — um card.
- Criar `src/screens/inicio/sections/CommunityFeedSection.tsx` — a seção.
- Modificar `src/copy/inicio.ts` — rótulo da seção.
- Modificar `src/screens/inicio/MemberHome.tsx` e `src/screens/inicio/GuestHome.tsx`.
- Modificar `app/(app)/events/[slug].tsx` — param `focus` e scroll.
- Criar `src/api/__tests__/home-feed.test.ts` e `src/screens/inicio/__tests__/CommunityFeedSection.test.tsx`.

---

### Task 1: Schemas compartilhados do home-feed

**Files:**
- Modify: `packages/shared/src/feed.ts`
- Test: `packages/shared/src/__tests__/feed-privacy-contract.test.ts` (já existe, itera `FEED_PUBLIC_RESPONSE_SCHEMAS` sozinho)

**Interfaces:**
- Consumes: nada.
- Produces: `HOME_FEED_POOL_SIZE: number`, `homeFeedItemSchema` (= `feedPostResponseSchema` + `event: { slug: string; title: string }`), `homeFeedResponseSchema` (= `{ posts: HomeFeedItem[] }`), tipos `HomeFeedItem` e `HomeFeedResponse`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/shared/src/__tests__/home-feed-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  FEED_PUBLIC_RESPONSE_SCHEMAS,
  HOME_FEED_POOL_SIZE,
  homeFeedItemSchema,
  homeFeedResponseSchema,
} from '../feed.js';

const item = {
  id: 'p1',
  eventId: 'e1',
  car: null,
  body: 'texto',
  status: 'visible' as const,
  photos: [],
  reactions: { likes: 0, mine: false },
  commentCount: 0,
  isOwn: false,
  createdAt: '2026-09-13T12:00:00.000Z',
  updatedAt: '2026-09-13T12:00:00.000Z',
  event: { slug: 'encontro-setembro', title: 'Encontro de Setembro' },
};

describe('home feed schemas', () => {
  it('aceita um item com o evento embutido', () => {
    expect(() => homeFeedItemSchema.parse(item)).not.toThrow();
  });

  it('recusa um item sem o evento', () => {
    const { event: _event, ...withoutEvent } = item;
    expect(() => homeFeedItemSchema.parse(withoutEvent)).toThrow();
  });

  it('descarta authorUserId em vez de propagar', () => {
    const parsed = homeFeedItemSchema.parse({ ...item, authorUserId: 'u1' });
    expect(parsed).not.toHaveProperty('authorUserId');
  });

  it('envelopa a lista', () => {
    expect(homeFeedResponseSchema.parse({ posts: [item] }).posts).toHaveLength(1);
  });

  it('expoe o tamanho do pool sorteado', () => {
    expect(HOME_FEED_POOL_SIZE).toBe(50);
  });

  it('entra no contrato de privacidade', () => {
    expect(FEED_PUBLIC_RESPONSE_SCHEMAS).toHaveProperty('homeFeedItem');
    expect(FEED_PUBLIC_RESPONSE_SCHEMAS).toHaveProperty('homeFeedResponse');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/home-feed-schema.test.ts`
Expected: FAIL, `homeFeedItemSchema` não é exportado.

- [ ] **Step 3: Implementar**

Em `packages/shared/src/feed.ts`, logo depois do bloco `feedCommentListResponseSchema`:

```ts
/**
 * Quantos posts o sorteio da Início considera. O pool é cortado dos mais
 * recentes e embaralhado em memória; `ORDER BY random()` sobre a tabela
 * inteira degradaria conforme FeedPost cresce, e não usa o índice
 * [eventId, createdAt].
 */
export const HOME_FEED_POOL_SIZE = 50;

/**
 * Post do feed da Início. Carrega o evento porque a lista é cross-evento: o
 * card precisa rotular a origem e o toque precisa do slug para navegar.
 * `title` e `slug` já são públicos em GET /api/events.
 */
export const homeFeedItemSchema = feedPostResponseSchema.extend({
  event: z.object({ slug: z.string().min(1), title: z.string().min(1) }),
});
export type HomeFeedItem = z.infer<typeof homeFeedItemSchema>;

/**
 * Sem page/total, ao contrário de feedListResponseSchema: a Início mostra um
 * punhado sorteado e não pagina. Expor um cursor aqui só criaria a expectativa
 * de uma segunda página que o sorteio não sabe entregar sem repetir.
 */
export const homeFeedResponseSchema = z.object({
  posts: z.array(homeFeedItemSchema),
});
export type HomeFeedResponse = z.infer<typeof homeFeedResponseSchema>;
```

E dentro de `FEED_PUBLIC_RESPONSE_SCHEMAS`, depois de `feedCommentListResponse`:

```ts
  homeFeedItem: homeFeedItemSchema,
  homeFeedResponse: homeFeedResponseSchema,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/home-feed-schema.test.ts src/__tests__/feed-privacy-contract.test.ts`
Expected: PASS nos dois arquivos.

- [ ] **Step 5: Build e commit**

```bash
pnpm --filter @ccc/shared build
pnpm exec prettier --write packages/shared/src/feed.ts packages/shared/src/__tests__/home-feed-schema.test.ts
git add packages/shared/src/feed.ts packages/shared/src/__tests__/home-feed-schema.test.ts
git commit -m "feat(shared): schemas do feed da Inicio"
```

---

### Task 2: Campo feedPostCount no HomeContent

**Files:**
- Modify: `packages/db/prisma/schema.prisma:2085-2095`
- Create: `packages/db/prisma/migrations/<timestamp>_home_feed_post_count/migration.sql`
- Test: `apps/api/test/home-content.route.test.ts` (modificar)

**Interfaces:**
- Consumes: nada.
- Produces: `HomeContent.feedPostCount: number` no client do Prisma, default 5.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/test/home-content.route.test.ts`, dentro do `describe('GET /api/home-content')`, acrescentar:

```ts
  it('cria o singleton com feedPostCount 5', async () => {
    await app.inject(GET);

    const row = await prisma.homeContent.findUnique({ where: { id: HOME_CONTENT_SINGLETON_ID } });
    expect(row?.feedPostCount).toBe(5);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/home-content.route.test.ts`
Expected: FAIL de typecheck ou `undefined` em `row.feedPostCount`.

- [ ] **Step 3: Implementar**

Em `packages/db/prisma/schema.prisma`, dentro do model `HomeContent`, antes de `createdAt`:

```prisma
  /// Quantos posts o feed da Início sorteia. Zero desliga a seção sem exigir
  /// uma flag separada. O teto de 20 vive na validação do admin, não aqui: a
  /// coluna não precisa de migration se a decisão de produto mudar.
  feedPostCount               Int      @default(5)
```

Gerar a migration:

```bash
pnpm --filter @ccc/db exec prisma migrate dev --name home_feed_post_count
```

Conferir que o SQL gerado é só:

```sql
ALTER TABLE "HomeContent" ADD COLUMN "feedPostCount" INTEGER NOT NULL DEFAULT 5;
```

Se o Prisma quiser alterar qualquer outra tabela, PARE e reporte: significa que a migration anterior divergiu do schema, e isso não é assunto desta tarefa.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/home-content.route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/api/test/home-content.route.test.ts
git add packages/db/prisma apps/api/test/home-content.route.test.ts
git commit -m "feat(db): feedPostCount no HomeContent"
```

---

### Task 3: Extrair o serializador de post do feed

Refatoração pura. Nenhum comportamento muda. Existe porque a rota nova precisa exatamente do mesmo `POST_SELECT` e da mesma serialização, e duplicá-los garantiria divergência: um dos dois lados esqueceria o `isPremiumActive` do carro ou a ordenação das fotos.

**Files:**
- Create: `apps/api/src/services/feed/serialize.ts`
- Modify: `apps/api/src/routes/feed.ts:36-100` (remove as declarações locais), imports no topo
- Test: `apps/api/test/feed/crud.test.ts` (já existe, tem que continuar verde)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `CAR_SELECT` — objeto `select` do Prisma para `Car`.
  - `POST_SELECT` — objeto `select` do Prisma para `FeedPost`.
  - `type FeedPostRow` — tipo da linha que `POST_SELECT` devolve.
  - `serializeCarProfile(car: CarSelect | null, buildUrl: (key: string) => string)` — perfil público do carro ou `null`.
  - `serializeFeedPost(row: FeedPostRow, ctx: { userId: string | null; myReactions: Map<string, string>; buildUrl: (key: string) => string })` — objeto pronto para `feedPostResponseSchema.parse`.

- [ ] **Step 1: Medir o baseline**

Run: `cd apps/api && pnpm exec vitest run test/feed/`
Expected: PASS. Anote o número de testes. Se já falhar antes da refatoração, PARE e reporte.

- [ ] **Step 2: Criar o módulo**

Criar `apps/api/src/services/feed/serialize.ts`:

```ts
/**
 * Seleção e serialização de um post do feed.
 *
 * Mora fora de routes/feed.ts porque GET /api/home-feed precisa do MESMO
 * payload, cross-evento. Duplicar POST_SELECT garantiria divergência: o lado
 * esquecido perde isPremiumActive no carro ou a ordenação das fotos, e a
 * diferença só aparece em produção.
 */

import { computeIsPremiumActive } from '../garage/index.js';

export const CAR_SELECT = {
  id: true,
  make: true,
  model: true,
  year: true,
  nickname: true,
  modifications: true,
  photos: { select: { objectKey: true, width: true, height: true, sortOrder: true } },
  // Needed to compute isPremiumActive on the public car profile. The badge
  // tone is per-Garage (one badge per car owner), so we pull premiumTier +
  // premiumUntil and feed them through computeIsPremiumActive at serialize
  // time. Never expose the raw timestamp publicly.
  user: { select: { garage: { select: { premiumTier: true, premiumUntil: true } } } },
} as const;

export const POST_SELECT = {
  id: true,
  eventId: true,
  body: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  authorUserId: true,
  car: { select: CAR_SELECT },
  photos: { select: { id: true, objectKey: true, width: true, height: true, sortOrder: true } },
  _count: {
    select: { reactions: { where: { kind: 'like' } }, comments: { where: { status: 'visible' } } },
  },
} as const;

export type CarSelect = {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
  modifications: string[];
  photos: { objectKey: string; width: number | null; height: number | null; sortOrder: number }[];
  user: {
    garage: {
      premiumTier: 'bronze' | 'silver' | 'gold' | null;
      premiumUntil: Date | null;
    } | null;
  } | null;
};

export type FeedPostRow = {
  id: string;
  eventId: string;
  body: string;
  status: 'visible' | 'hidden' | 'removed';
  createdAt: Date;
  updatedAt: Date;
  authorUserId: string | null;
  car: CarSelect | null;
  photos: {
    id: string;
    objectKey: string;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }[];
  _count: { reactions: number; comments: number };
};

export const serializeCarProfile = (car: CarSelect | null, buildUrl: (key: string) => string) => {
  if (!car) return null;
  const primary = [...car.photos].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;
  const garage = car.user?.garage ?? null;
  const isPremiumActive =
    garage === null ? false : computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
  return {
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname,
    modifications: car.modifications,
    photo: primary
      ? { url: buildUrl(primary.objectKey), width: primary.width, height: primary.height }
      : null,
    isPremiumActive,
  };
};

/**
 * `authorUserId` entra aqui só para calcular `isOwn` e NUNCA sai no retorno.
 * Ver a nota em feedPostResponseSchema: nenhum identificador novo de usuário
 * pode entrar num payload que leitor anônimo recebe.
 */
export const serializeFeedPost = (
  row: FeedPostRow,
  ctx: {
    userId: string | null;
    myReactions: Map<string, string>;
    buildUrl: (key: string) => string;
  },
) => ({
  id: row.id,
  eventId: row.eventId,
  isOwn: ctx.userId !== null && row.authorUserId === ctx.userId,
  car: serializeCarProfile(row.car, ctx.buildUrl),
  body: row.body,
  status: row.status,
  photos: [...row.photos]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((ph) => ({
      id: ph.id,
      url: ctx.buildUrl(ph.objectKey),
      width: ph.width,
      height: ph.height,
      sortOrder: ph.sortOrder,
    })),
  reactions: { likes: row._count.reactions, mine: ctx.myReactions.get(row.id) === 'like' },
  commentCount: row._count.comments,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
```

- [ ] **Step 3: Apontar a rota antiga para o módulo**

Em `apps/api/src/routes/feed.ts`:

1. Apagar as declarações locais de `CAR_SELECT`, `POST_SELECT`, `type CarSelect` e `serializeCarProfile` (hoje entre a linha 36 e a linha 100).
2. Acrescentar o import:

```ts
import {
  CAR_SELECT,
  POST_SELECT,
  serializeCarProfile,
  serializeFeedPost,
} from '../services/feed/serialize.js';
```

3. No handler `GET /events/:eventId/feed`, trocar o bloco `posts.map((p) => feedPostResponseSchema.parse({ ... }))` por:

```ts
        posts: posts.map((p) =>
          feedPostResponseSchema.parse(serializeFeedPost(p, { userId, myReactions, buildUrl })),
        ),
```

4. Se `computeIsPremiumActive` ficar sem uso em `routes/feed.ts`, remover o import. Se ainda for usado por outro handler, deixar.
5. `CAR_SELECT` e `serializeCarProfile` continuam importados porque os handlers de comentário os usam. Se o lint apontar import não usado, remova só o que sobrou.

- [ ] **Step 4: Rodar os testes de feed e o typecheck**

Run: `cd apps/api && pnpm exec vitest run test/feed/ && pnpm typecheck`
Expected: PASS, com o mesmo número de testes do Step 1.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/api/src/services/feed/serialize.ts apps/api/src/routes/feed.ts
git add apps/api/src/services/feed/serialize.ts apps/api/src/routes/feed.ts
git commit -m "refactor(api): extrai o serializador de post do feed"
```

---

### Task 4: Rota GET /api/home-feed

**Files:**
- Create: `apps/api/src/routes/home-feed.ts`
- Modify: `apps/api/src/app.ts:29` (import) e `:169` (registro)
- Test: `apps/api/test/home-feed.route.test.ts`

**Interfaces:**
- Consumes: `POST_SELECT`, `serializeFeedPost` da Task 3; `homeFeedResponseSchema`, `HOME_FEED_POOL_SIZE` da Task 1; `HomeContent.feedPostCount` da Task 2.
- Produces: `homeFeedRoutes: FastifyPluginAsync`, servindo `GET /api/home-feed` com corpo `{ posts: HomeFeedItem[] }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/home-feed.route.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { homeFeedResponseSchema } from '@ccc/shared/feed';
import { HOME_CONTENT_SINGLETON_ID } from '@ccc/shared/home';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from './helpers.js';

const env = loadEnv();

const GET = { method: 'GET' as const, url: '/api/home-feed' };

// createUser usa 'user@jdm.test' por padrao e email e unique, entao todo teste
// que cria mais de um usuario precisa passar emails distintos.
let seq = 0;
const newUser = () => createUser({ email: `home-feed-${(seq += 1)}@jdm.test` });

const seedEvent = (
  title: string,
  feedAccess: 'public' | 'attendees' | 'members_only',
  feedEnabled = true,
) =>
  prisma.event.create({
    data: {
      title,
      slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'desc',
      startsAt: new Date('2026-07-01T18:00:00Z'),
      endsAt: new Date('2026-07-01T22:00:00Z'),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      feedEnabled,
      feedAccess,
      postingAccess: 'attendees',
    },
  });

const seedPost = (eventId: string, body: string, authorUserId: string | null = null) =>
  prisma.feedPost.create({ data: { eventId, body, authorUserId, status: 'visible' } });

const bodies = (payload: unknown) =>
  homeFeedResponseSchema
    .parse(payload)
    .posts.map((p) => p.body)
    .sort();

describe('GET /api/home-feed', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serve post de evento public sem auth', async () => {
    const event = await seedEvent('Encontro Publico', 'public');
    await seedPost(event.id, 'ola mundo');

    const res = await app.inject(GET);

    expect(res.statusCode).toBe(200);
    expect(bodies(res.json())).toEqual(['ola mundo']);
  });

  it('embute slug e titulo do evento em cada item', async () => {
    const event = await seedEvent('Encontro Publico', 'public');
    await seedPost(event.id, 'ola mundo');

    const body = homeFeedResponseSchema.parse((await app.inject(GET)).json());

    expect(body.posts[0]?.event).toEqual({ slug: event.slug, title: event.title });
  });

  it('nao serve post de evento attendees nem members_only', async () => {
    const attendees = await seedEvent('Fechado', 'attendees');
    const members = await seedEvent('Premium', 'members_only');
    await seedPost(attendees.id, 'secreto a');
    await seedPost(members.id, 'secreto b');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post de evento com feed desligado', async () => {
    const event = await seedEvent('Desligado', 'public', false);
    await seedPost(event.id, 'invisivel');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post escondido ou removido', async () => {
    const event = await seedEvent('Encontro Publico', 'public');
    const hidden = await seedPost(event.id, 'escondido');
    await prisma.feedPost.update({ where: { id: hidden.id }, data: { status: 'hidden' } });
    await seedPost(event.id, 'visivel');

    expect(bodies((await app.inject(GET)).json())).toEqual(['visivel']);
  });

  it('respeita feedPostCount', async () => {
    const event = await seedEvent('Encontro Publico', 'public');
    for (let i = 0; i < 8; i += 1) await seedPost(event.id, `post ${i}`);
    await prisma.homeContent.upsert({
      where: { id: HOME_CONTENT_SINGLETON_ID },
      create: { id: HOME_CONTENT_SINGLETON_ID, feedPostCount: 3 },
      update: { feedPostCount: 3 },
    });

    expect(homeFeedResponseSchema.parse((await app.inject(GET)).json()).posts).toHaveLength(3);
  });

  it('feedPostCount zero devolve lista vazia', async () => {
    const event = await seedEvent('Encontro Publico', 'public');
    await seedPost(event.id, 'post');
    await prisma.homeContent.upsert({
      where: { id: HOME_CONTENT_SINGLETON_ID },
      create: { id: HOME_CONTENT_SINGLETON_ID, feedPostCount: 0 },
      update: { feedPostCount: 0 },
    });

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('esconde post de autor bloqueado em qualquer direcao', async () => {
    const event = await seedEvent('Encontro Publico', 'public');
    const reader = await newUser();
    const blocked = await newUser();
    const blocker = await newUser();
    await seedPost(event.id, 'do bloqueado', blocked.user.id);
    await seedPost(event.id, 'de quem me bloqueou', blocker.user.id);
    await seedPost(event.id, 'de ninguem', null);
    await prisma.userBlock.create({
      data: { blockerId: reader.user.id, blockedId: blocked.user.id },
    });
    await prisma.userBlock.create({
      data: { blockerId: blocker.user.id, blockedId: reader.user.id },
    });

    const res = await app.inject({
      ...GET,
      headers: { authorization: bearer(env, reader.user.id) },
    });

    expect(bodies(res.json())).toEqual(['de ninguem']);
  });

  it('mantem post de autor deletado para leitor com bloqueios', async () => {
    const event = await seedEvent('Encontro Publico', 'public');
    const reader = await newUser();
    const blocked = await newUser();
    await seedPost(event.id, 'tombstone', null);
    await prisma.userBlock.create({
      data: { blockerId: reader.user.id, blockedId: blocked.user.id },
    });

    const res = await app.inject({
      ...GET,
      headers: { authorization: bearer(env, reader.user.id) },
    });

    expect(bodies(res.json())).toEqual(['tombstone']);
  });

  it('esconde o evento inteiro de quem tem FeedBan de view', async () => {
    const banned = await seedEvent('Banido', 'public');
    const open = await seedEvent('Aberto', 'public');
    const reader = await newUser();
    await seedPost(banned.id, 'do evento banido');
    await seedPost(open.id, 'do evento aberto');
    await prisma.feedBan.create({
      data: { eventId: banned.id, userId: reader.user.id, scope: 'view' },
    });

    const res = await app.inject({
      ...GET,
      headers: { authorization: bearer(env, reader.user.id) },
    });

    expect(bodies(res.json())).toEqual(['do evento aberto']);
  });

  it('marca isOwn no post do proprio leitor e nunca expoe authorUserId', async () => {
    const event = await seedEvent('Encontro Publico', 'public');
    const reader = await newUser();
    await seedPost(event.id, 'meu post', reader.user.id);

    const res = await app.inject({
      ...GET,
      headers: { authorization: bearer(env, reader.user.id) },
    });

    const body = homeFeedResponseSchema.parse(res.json());
    expect(body.posts[0]?.isOwn).toBe(true);
    expect(JSON.stringify(res.json())).not.toContain('authorUserId');
  });

  it('isOwn e false para leitor anonimo', async () => {
    const event = await seedEvent('Encontro Publico', 'public');
    const author = await newUser();
    await seedPost(event.id, 'post alheio', author.user.id);

    const body = homeFeedResponseSchema.parse((await app.inject(GET)).json());
    expect(body.posts[0]?.isOwn).toBe(false);
  });
});
```

Os helpers usados acima são os que `apps/api/test/helpers.ts` já exporta: `makeApp`, `resetDatabase`, `createUser` e `bearer`. `bearer(env, userId)` monta o header inteiro (`Bearer <token>`), e `env` vem de `loadEnv()` chamado no topo do arquivo, mesmo idiom de `test/feed/crud.test.ts:10`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/home-feed.route.test.ts`
Expected: FAIL com 404 em toda request, a rota ainda não existe.

- [ ] **Step 3: Implementar a rota**

Criar `apps/api/src/routes/home-feed.ts`:

```ts
/**
 * home-feed route — posts sorteados de eventos públicos, para a tela de Início.
 *
 *   GET /api/home-feed
 *
 * UNAUTHED como /api/home-content: a Início roda antes do login. Usa tryAuth,
 * não authenticate, só para conseguir aplicar os filtros de bloqueio e ban de
 * quem por acaso está logado.
 *
 * Só eventos com feedAccess 'public'. Nunca relaxe isso: em 'attendees' o
 * checkFeedReadAccess exige Ticket válido, e um feed na primeira tela do app
 * publicaria para anônimos conteúdo que a API promete ser de portador de
 * ingresso.
 *
 * Sem query param de quantidade de propósito. O número vem de
 * HomeContent.feedPostCount, então a configuração fica num lugar só e a URL
 * não vira um jeito de pedir a tabela inteira.
 */

import { prisma } from '@ccc/db';
import rateLimit from '@fastify/rate-limit';
import { HOME_FEED_POOL_SIZE, homeFeedResponseSchema } from '@ccc/shared/feed';
import type { FastifyPluginAsync } from 'fastify';

import { blockedUserIdsFor } from '../services/feed/blocks.js';
import { POST_SELECT, serializeFeedPost } from '../services/feed/serialize.js';
import { ensureHomeContent } from '../services/home-content.js';

/**
 * Fisher-Yates sobre uma cópia. Embaralhar em memória, e não com
 * `ORDER BY random()`, mantém o index scan de [status, createdAt] e não
 * degrada conforme FeedPost cresce.
 */
const shuffle = <T>(items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

export const homeFeedRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `home-feed:${req.ip}`,
  });

  app.get('/api/home-feed', { preHandler: [app.tryAuth] }, async (request, reply) => {
    const content = await ensureHomeContent();
    if (content.feedPostCount <= 0) {
      return reply.status(200).send(homeFeedResponseSchema.parse({ posts: [] }));
    }

    const userId = request.user?.sub ?? null;

    // Os dois filtros são resolvidos ANTES da query e entram no where. Filtrar
    // depois do fetch encolheria o pool: um leitor com muitos bloqueios
    // receberia menos posts que feedPostCount sem motivo aparente.
    const [blockedIds, bans] = await Promise.all([
      blockedUserIdsFor(userId),
      userId
        ? prisma.feedBan.findMany({ where: { userId, scope: 'view' }, select: { eventId: true } })
        : Promise.resolve([]),
    ]);
    const bannedEventIds = bans.map((b) => b.eventId);

    const pool = await prisma.feedPost.findMany({
      where: {
        status: 'visible',
        event: { feedEnabled: true, feedAccess: 'public' },
        ...(bannedEventIds.length > 0 ? { eventId: { notIn: bannedEventIds } } : {}),
        // OR com `authorUserId: null` é load-bearing: SQL `NULL NOT IN (...)`
        // avalia para NULL, então um notIn puro derruba todo post cujo autor
        // apagou a conta (a FK é onDelete: SetNull). Mesma armadilha
        // documentada em routes/feed.ts.
        ...(blockedIds.length > 0
          ? { OR: [{ authorUserId: null }, { authorUserId: { notIn: blockedIds } }] }
          : {}),
      },
      select: { ...POST_SELECT, event: { select: { slug: true, title: true } } },
      // Ordenação total. Sem o desempate por id, dois posts com o mesmo
      // createdAt podem trocar de lugar entre requests e o corte do pool fica
      // não determinístico de um jeito que nenhum teste pega.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HOME_FEED_POOL_SIZE,
    });

    const picked = shuffle(pool).slice(0, content.feedPostCount);

    let myReactions = new Map<string, string>();
    if (userId && picked.length > 0) {
      const reactions = await prisma.feedReaction.findMany({
        where: { postId: { in: picked.map((p) => p.id) }, userId },
        select: { postId: true, kind: true },
      });
      myReactions = new Map(reactions.map((r) => [r.postId, r.kind]));
    }

    const buildUrl = (key: string) => app.uploads.buildPublicUrl(key);

    return reply.status(200).send(
      homeFeedResponseSchema.parse({
        posts: picked.map((p) => ({
          ...serializeFeedPost(p, { userId, myReactions, buildUrl }),
          event: { slug: p.event.slug, title: p.event.title },
        })),
      }),
    );
  });
};
```

- [ ] **Step 4: Registrar no app**

Em `apps/api/src/app.ts`, junto do import da linha 29:

```ts
import { homeFeedRoutes } from './routes/home-feed.js';
```

E logo depois de `await app.register(homeContentRoutes);` na linha 169:

```ts
  await app.register(homeFeedRoutes);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/home-feed.route.test.ts && pnpm typecheck`
Expected: PASS nos 12 testes.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/api/src/routes/home-feed.ts apps/api/src/app.ts apps/api/test/home-feed.route.test.ts
git add apps/api/src/routes/home-feed.ts apps/api/src/app.ts apps/api/test/home-feed.route.test.ts
git commit -m "feat(api): GET /api/home-feed"
```

---

### Task 5: feedPostCount editável no admin

**Files:**
- Modify: `packages/shared/src/admin-home.ts:47-70`
- Modify: `apps/api/src/routes/admin/home-content.ts:27-58`
- Modify: `apps/admin/app/(authed)/configuracoes/home-content-form.tsx`
- Test: `apps/api/test/admin/home-content.test.ts`, `apps/admin/app/(authed)/configuracoes/home-content-form.interaction.test.tsx`

**Interfaces:**
- Consumes: `HomeContent.feedPostCount` da Task 2.
- Produces: `feedPostCount: number` em `adminHomeContentSchema` (leitura) e `feedPostCount?: number` em `homeContentUpdateSchema` (escrita, 0..20).

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/test/admin/home-content.test.ts`, acrescentar dentro do describe do `PUT`:

```ts
  it('persiste feedPostCount', async () => {
    const before = await readContent();

    const res = await put({ ...fullPayload(before), feedPostCount: 8 });

    expect(res.statusCode).toBe(200);
    expect(res.json().feedPostCount).toBe(8);
    expect((await readContent()).feedPostCount).toBe(8);
  });

  it('recusa feedPostCount acima do teto', async () => {
    const before = await readContent();

    const res = await put({ ...fullPayload(before), feedPostCount: 21 });

    expect(res.statusCode).toBe(400);
  });

  it('aceita feedPostCount zero', async () => {
    const before = await readContent();

    const res = await put({ ...fullPayload(before), feedPostCount: 0 });

    expect(res.statusCode).toBe(200);
    expect(res.json().feedPostCount).toBe(0);
  });
```

Ler o arquivo antes de editar e reusar os helpers que já existirem lá (`put`, `readContent`, a montagem do payload). Se tiverem outro nome, use os nomes reais em vez de criar helpers paralelos.

Em `apps/admin/app/(authed)/configuracoes/home-content-form.interaction.test.tsx`:

1. Acrescentar `feedPostCount: 5` ao objeto `initial`.
2. Acrescentar o teste:

```ts
  it('envia feedPostCount editado no save', async () => {
    updateMock.mockResolvedValue({ ok: true, content: { ...initial, feedPostCount: 3 } });

    setValue(input('Posts no feed da Início'), '3');
    await act(async () => {
      (container.querySelector('button') as HTMLButtonElement).click();
    });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ feedPostCount: 3 }));
  });
```

Conferir como os testes existentes no arquivo localizam o botão Salvar e reusar o mesmo idiom.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts`
Run: `cd apps/admin && pnpm exec vitest run "app/(authed)/configuracoes/home-content-form.interaction.test.tsx"`
Expected: FAIL nos dois.

- [ ] **Step 3: Schema compartilhado**

Em `packages/shared/src/admin-home.ts`, em `adminHomeContentSchema`, antes de `updatedAt`:

```ts
  feedPostCount: z.number().int().min(0),
```

E em `homeContentUpdateSchema`, depois de `institutionalImageObjectKey`:

```ts
  /**
   * Quantos posts a seção de feed da Início sorteia. Zero desliga a seção.
   * O teto de 20 é de produto, não de banco: a Início é uma tela de resumo,
   * e uma lista maior que isso vira scroll infinito no lugar errado.
   */
  feedPostCount: z.coerce.number().int().min(0).max(20).optional(),
```

`z.coerce` porque o input do form entrega string.

Depois: `pnpm --filter @ccc/shared build`.

- [ ] **Step 4: API admin**

Em `apps/api/src/routes/admin/home-content.ts`:

1. Em `serializeAdminHomeContent`, antes de `updatedAt`:

```ts
    feedPostCount: row.feedPostCount,
```

2. Em `CONTENT_FIELDS`, depois de `'institutionalImageObjectKey'`:

```ts
    'feedPostCount',
```

Nada mais muda: o loop de diff, a precondição `expectedUpdatedAt` e o `recordAudit` já percorrem `CONTENT_FIELDS`.

- [ ] **Step 5: Form do admin**

Em `apps/admin/app/(authed)/configuracoes/home-content-form.tsx`:

1. Novo estado, junto dos outros:

```ts
  const [feedPostCount, setFeedPostCount] = useState(String(initial.feedPostCount));
```

2. No payload de `save`, depois de `institutionalImageObjectKey`:

```ts
        feedPostCount,
```

3. No `if (result.ok)`, junto dos outros setters:

```ts
        setFeedPostCount(String(result.content.feedPostCount));
```

4. Nova seção, antes do bloco do botão Salvar:

```tsx
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Feed da comunidade</h2>
        <label className={labelCls}>
          <span>Posts no feed da Início (0 a 20, zero esconde a seção)</span>
          <input
            className={inputCls}
            aria-label="Posts no feed da Início"
            type="number"
            min={0}
            max={20}
            value={feedPostCount}
            onChange={(e) => setFeedPostCount(e.target.value)}
          />
        </label>
        <p className="text-xs opacity-70">
          Só entram posts de eventos com o feed marcado como público.
        </p>
      </section>
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts && pnpm typecheck`
Run: `cd apps/admin && pnpm exec vitest run && pnpm typecheck`
Expected: PASS nos dois.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/shared/src/admin-home.ts apps/api/src/routes/admin/home-content.ts "apps/admin/app/(authed)/configuracoes/home-content-form.tsx"
git add packages/shared/src/admin-home.ts apps/api/src/routes/admin/home-content.ts apps/api/test/admin/home-content.test.ts "apps/admin/app/(authed)/configuracoes"
git commit -m "feat(admin): quantidade de posts do feed da Inicio"
```

---

### Task 6: Cliente e hook do home-feed no mobile

**Files:**
- Create: `apps/mobile/src/api/home-feed.ts`
- Create: `apps/mobile/src/hooks/useHomeFeed.ts`
- Test: `apps/mobile/src/api/__tests__/home-feed.test.ts`

**Interfaces:**
- Consumes: `homeFeedResponseSchema`, `HomeFeedItem` da Task 1.
- Produces:
  - `listHomeFeed(): Promise<HomeFeedResponse>`
  - `useHomeFeed(): { posts: HomeFeedItem[]; loading: boolean; refresh: () => Promise<void> }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/mobile/src/api/__tests__/home-feed.test.ts`. Abrir antes `apps/mobile/src/api/__tests__/home.test.ts` e copiar dali o idiom de mock do `request` — o repo já tem um padrão para isso e este teste tem que segui-lo, não inventar outro.

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('../client', () => ({
  request: requestMock,
  authedRequest: requestMock,
  ApiError: class ApiError extends Error {},
}));

import { listHomeFeed } from '../home-feed';

describe('listHomeFeed', () => {
  beforeEach(() => requestMock.mockReset());

  it('chama GET /api/home-feed', async () => {
    requestMock.mockResolvedValue({ posts: [] });

    await listHomeFeed();

    expect(requestMock).toHaveBeenCalledWith('/api/home-feed', expect.anything());
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/mobile && pnpm exec vitest run src/api/__tests__/home-feed.test.ts`
Expected: FAIL, módulo `../home-feed` não existe.

- [ ] **Step 3: Implementar o cliente**

Criar `apps/mobile/src/api/home-feed.ts`:

```ts
import { type HomeFeedResponse, homeFeedResponseSchema } from '@ccc/shared/feed';

import { request } from './client';

/**
 * GET /api/home-feed. Request anônima sempre, mesmo com sessão aberta: a
 * personalização que a rota faz com token (isOwn, filtro de bloqueio) não
 * muda o que o card da Início mostra, e usar `request` evita o caminho de
 * boot em que o provider de token ainda não subiu — o mesmo 401 que
 * listFeedPosts precisa tratar com fallback.
 */
export const listHomeFeed = (): Promise<HomeFeedResponse> =>
  request('/api/home-feed', homeFeedResponseSchema);
```

- [ ] **Step 4: Implementar o hook**

Criar `apps/mobile/src/hooks/useHomeFeed.ts`:

```ts
import type { HomeFeedItem } from '@ccc/shared/feed';
import { useCallback, useEffect, useState } from 'react';

import { listHomeFeed } from '~/api/home-feed';

type UseHomeFeedResult = {
  posts: HomeFeedItem[];
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Sem estado de erro exposto: a seção some quando a lista está vazia, e falha
 * de rede colapsa para o mesmo vazio. Mesmo tratamento de
 * ConfirmedCarsSection — uma seção de descoberta não ganha spinner nem retry
 * próprio numa tela que já tem dez blocos.
 */
export function useHomeFeed(): UseHomeFeedResult {
  const [posts, setPosts] = useState<HomeFeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPosts((await listHomeFeed()).posts);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { posts, loading, refresh };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/mobile && pnpm exec vitest run src/api/__tests__/home-feed.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/mobile/src/api/home-feed.ts apps/mobile/src/hooks/useHomeFeed.ts apps/mobile/src/api/__tests__/home-feed.test.ts
git add apps/mobile/src/api/home-feed.ts apps/mobile/src/hooks/useHomeFeed.ts apps/mobile/src/api/__tests__/home-feed.test.ts
git commit -m "feat(mobile): cliente e hook do feed da Inicio"
```

---

### Task 7: Card e seção do feed na Início

**Files:**
- Create: `apps/mobile/src/screens/inicio/components/FeedTeaserCard.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/CommunityFeedSection.tsx`
- Modify: `apps/mobile/src/copy/inicio.ts:8-21`
- Test: `apps/mobile/src/screens/inicio/__tests__/CommunityFeedSection.test.tsx`

**Interfaces:**
- Consumes: `HomeFeedItem` da Task 1.
- Produces:
  - `FeedTeaserCard({ post, onPress }: { post: HomeFeedItem; onPress: () => void })`
  - `CommunityFeedSection({ posts, onOpenEvent }: { posts: HomeFeedItem[]; onOpenEvent: (slug: string) => void })` — renderiza `null` quando `posts` está vazio.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/mobile/src/screens/inicio/__tests__/CommunityFeedSection.test.tsx`. Abrir antes `apps/mobile/src/screens/inicio/__tests__/GuestHome.test.tsx` e usar o mesmo setup de render que ele já usa.

```tsx
import type { HomeFeedItem } from '@ccc/shared/feed';
import { describe, expect, it, vi } from 'vitest';

import { CommunityFeedSection } from '../sections/CommunityFeedSection';

const post = (overrides: Partial<HomeFeedItem> = {}): HomeFeedItem => ({
  id: 'p1',
  eventId: 'e1',
  car: null,
  body: 'que encontro bom',
  status: 'visible',
  photos: [],
  reactions: { likes: 2, mine: false },
  commentCount: 1,
  isOwn: false,
  createdAt: '2026-09-13T12:00:00.000Z',
  updatedAt: '2026-09-13T12:00:00.000Z',
  event: { slug: 'encontro-setembro', title: 'Encontro de Setembro' },
  ...overrides,
});

describe('CommunityFeedSection', () => {
  it('nao renderiza nada com a lista vazia', () => {
    const tree = render(<CommunityFeedSection posts={[]} onOpenEvent={vi.fn()} />);
    expect(tree.toJSON()).toBeNull();
  });

  it('mostra o corpo do post e o titulo do evento', () => {
    const tree = render(<CommunityFeedSection posts={[post()]} onOpenEvent={vi.fn()} />);
    expect(tree.getByText('que encontro bom')).toBeTruthy();
    expect(tree.getByText('Encontro de Setembro')).toBeTruthy();
  });

  it('abre o evento do post tocado', () => {
    const onOpenEvent = vi.fn();
    const tree = render(<CommunityFeedSection posts={[post()]} onOpenEvent={onOpenEvent} />);
    fireEvent.press(tree.getByTestId('inicio-feed-card-p1'));
    expect(onOpenEvent).toHaveBeenCalledWith('encontro-setembro');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/inicio/__tests__/CommunityFeedSection.test.tsx`
Expected: FAIL, módulo não existe.

- [ ] **Step 3: Copy**

Em `apps/mobile/src/copy/inicio.ts`, dentro de `sections`, depois de `confirmedCars`:

```ts
    communityFeed: 'DA COMUNIDADE',
```

- [ ] **Step 4: Card**

Criar `apps/mobile/src/screens/inicio/components/FeedTeaserCard.tsx`:

```tsx
/**
 * Card de um post no carrossel da Início.
 *
 * Texto-first porque o composer do mobile ainda não envia foto
 * (FeedComposerSheet.onSubmit só passa body e carId), então post com foto é a
 * exceção. A foto, quando existe, vira fundo com scrim em vez de um bloco de
 * imagem separado: assim o card tem uma altura só nos dois casos e a linha do
 * carrossel não fica serrilhada.
 */

import type { HomeFeedItem } from '@ccc/shared/feed';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { p } from '~/screens/inicio/palette';

const CARD_WIDTH = 240;

export function FeedTeaserCard({ post, onPress }: { post: HomeFeedItem; onPress: () => void }) {
  const photo = post.photos[0] ?? null;
  const car = post.car;
  const authorLabel = car ? (car.nickname ?? `${car.make} ${car.model}`) : 'Membro';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Post em ${post.event.title}`}
      testID={`inicio-feed-card-${post.id}`}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {photo ? (
        <Image source={{ uri: photo.url }} style={styles.photo} accessible={false} />
      ) : null}
      {photo ? <View style={styles.scrim} /> : null}

      <View style={styles.content}>
        <Text style={styles.event} numberOfLines={1}>
          {post.event.title}
        </Text>
        <Text style={styles.body} numberOfLines={3}>
          {post.body}
        </Text>
        <View style={styles.authorRow}>
          {car?.photo ? (
            <Image source={{ uri: car.photo.url }} style={styles.avatar} accessible={false} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]} />
          )}
          <Text style={styles.author} numberOfLines={1}>
            {authorLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: 168,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.featureSurface,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },
  photo: { ...StyleSheet.absoluteFillObject },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: p.scrimBottom },
  content: { flex: 1, padding: 14, gap: 8 },
  event: {
    fontFamily: 'Jost_500Medium',
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: p.gold,
  },
  body: {
    flex: 1,
    fontFamily: 'Jost_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: p.cream,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 22, height: 22, borderRadius: 11 },
  avatarPlaceholder: { backgroundColor: p.surface },
  author: { flex: 1, fontFamily: 'Jost_500Medium', fontSize: 11, color: p.muted60 },
});
```

Antes de commitar, conferir os nomes de fonte (`Jost_400Regular`, `Jost_500Medium`) contra os que as outras seções usam e corrigir se divergir. `lineHeight: 20` sobre `fontSize: 14` é folgado de propósito: lineHeight abaixo da altura natural do glifo corta o topo do texto no iOS.

- [ ] **Step 5: Seção**

Criar `apps/mobile/src/screens/inicio/sections/CommunityFeedSection.tsx`:

```tsx
/**
 * Seção — posts sorteados de eventos públicos.
 *
 * Some por completo quando a lista vem vazia, igual ConfirmedCarsSection. A
 * lista fica vazia com frequência por desenho: só entram eventos com
 * feedAccess 'public', e o default de Event é 'attendees'.
 *
 * Recebe `posts` por prop em vez de buscar sozinha porque as duas homes já
 * chamam o hook no topo — a do membro precisa do refresh no pull-to-refresh.
 */

import type { HomeFeedItem } from '@ccc/shared/feed';
import { ScrollView, StyleSheet, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { FeedTeaserCard } from '~/screens/inicio/components/FeedTeaserCard';

export function CommunityFeedSection({
  posts,
  onOpenEvent,
}: {
  posts: HomeFeedItem[];
  onOpenEvent: (slug: string) => void;
}) {
  if (posts.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.communityFeed} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {posts.map((post) => (
          <FeedTeaserCard
            key={post.id}
            post={post}
            onPress={() => onOpenEvent(post.event.slug)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  row: { gap: 12 },
});
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/inicio/__tests__/CommunityFeedSection.test.tsx && pnpm typecheck`
Expected: PASS nos 3 testes.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write apps/mobile/src/screens/inicio/components/FeedTeaserCard.tsx apps/mobile/src/screens/inicio/sections/CommunityFeedSection.tsx apps/mobile/src/copy/inicio.ts apps/mobile/src/screens/inicio/__tests__/CommunityFeedSection.test.tsx
git add apps/mobile/src/screens/inicio apps/mobile/src/copy/inicio.ts
git commit -m "feat(mobile): secao do feed da comunidade na Inicio"
```

---

### Task 8: Ligar a seção nas duas homes

**Files:**
- Modify: `apps/mobile/src/screens/inicio/MemberHome.tsx:51-58` e `:125`
- Modify: `apps/mobile/src/screens/inicio/GuestHome.tsx:58-62` e `:110-122`
- Test: `apps/mobile/src/screens/inicio/__tests__/MemberHome.test.tsx`, `apps/mobile/src/screens/inicio/__tests__/GuestHome.test.tsx`

**Interfaces:**
- Consumes: `useHomeFeed` da Task 6, `CommunityFeedSection` da Task 7.
- Produces: nada que outra task use.

- [ ] **Step 1: Escrever os testes que falham**

Abrir `MemberHome.test.tsx` e `GuestHome.test.tsx` e ver como cada um mocka os hooks de dados. Acrescentar o mock de `~/hooks/useHomeFeed` no mesmo bloco onde os outros já são mockados, devolvendo `{ posts: [], loading: false, refresh: vi.fn() }` por padrão.

Em cada arquivo, acrescentar:

```tsx
  it('renderiza o feed da comunidade quando ha posts', () => {
    useHomeFeedMock.mockReturnValue({
      posts: [
        {
          id: 'p1',
          eventId: 'e1',
          car: null,
          body: 'que encontro bom',
          status: 'visible' as const,
          photos: [],
          reactions: { likes: 0, mine: false },
          commentCount: 0,
          isOwn: false,
          createdAt: '2026-09-13T12:00:00.000Z',
          updatedAt: '2026-09-13T12:00:00.000Z',
          event: { slug: 'encontro-setembro', title: 'Encontro de Setembro' },
        },
      ],
      loading: false,
      refresh: vi.fn(),
    });

    const tree = render(<MemberHome />);

    expect(tree.getByText('que encontro bom')).toBeTruthy();
  });
```

No `GuestHome.test.tsx`, trocar `<MemberHome />` por `<GuestHome />`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/inicio/__tests__/MemberHome.test.tsx src/screens/inicio/__tests__/GuestHome.test.tsx`
Expected: FAIL, o texto não aparece.

- [ ] **Step 3: MemberHome**

Em `apps/mobile/src/screens/inicio/MemberHome.tsx`:

1. Imports:

```ts
import { useHomeFeed } from '~/hooks/useHomeFeed';
import { CommunityFeedSection } from '~/screens/inicio/sections/CommunityFeedSection';
```

2. No corpo, junto dos outros hooks:

```ts
  const { posts: feedPosts, refresh: refreshFeed } = useHomeFeed();
```

3. No `refreshControl`, trocar `onRefresh={() => void refreshAll()}` por:

```tsx
            onRefresh={() => void Promise.all([refreshAll(), refreshFeed()])}
```

4. Logo depois do `<NextEventCard ... />`:

```tsx
        <CommunityFeedSection
          posts={feedPosts}
          onOpenEvent={(slug) =>
            router.push({ pathname: '/events/[slug]', params: { slug, focus: 'feed' } } as never)
          }
        />
```

- [ ] **Step 4: GuestHome**

Em `apps/mobile/src/screens/inicio/GuestHome.tsx`:

1. Imports:

```ts
import { useHomeFeed } from '~/hooks/useHomeFeed';
import { CommunityFeedSection } from '~/screens/inicio/sections/CommunityFeedSection';
```

2. No corpo, junto de `useHomeContent`:

```ts
  const { posts: feedPosts } = useHomeFeed();
```

3. Logo depois do `<HighlightsSection ... />`:

```tsx
            <CommunityFeedSection
              posts={feedPosts}
              onOpenEvent={(slug) =>
                router.push({
                  pathname: '/events/[slug]',
                  params: { slug, focus: 'feed' },
                } as never)
              }
            />
```

O `as never` segue o mesmo idiom que `goEvent` e `goLink` já usam neste arquivo para href dinâmico.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/inicio/ && pnpm typecheck`
Expected: PASS, incluindo os testes que já existiam.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/mobile/src/screens/inicio/MemberHome.tsx apps/mobile/src/screens/inicio/GuestHome.tsx
git add apps/mobile/src/screens/inicio
git commit -m "feat(mobile): feed da comunidade nas duas homes"
```

---

### Task 9: Scroll até o feed na página do evento

**Files:**
- Modify: `apps/mobile/app/(app)/events/[slug].tsx:44-47` (params), `:215` (ScrollView), `:347-362` (bloco do feed)

**Interfaces:**
- Consumes: o param `focus: 'feed'` que a Task 8 passa no push.
- Produces: nada.

- [ ] **Step 1: Ler o param**

Na desestruturação de `useLocalSearchParams`:

```ts
  const { slug, tierId: requestedTierId, focus } = useLocalSearchParams<{
    slug: string;
    tierId?: string;
    focus?: string;
  }>();
```

Se o arquivo já declarar `purchaseMode` ali, mantenha e só acrescente `focus`.

- [ ] **Step 2: Ref e posição**

Junto dos outros `useState` do componente:

```ts
  const scrollRef = useRef<ScrollView>(null);
  // Guarda de disparo único. Sem ela, cada re-render (o feed carrega depois da
  // página) rebobinaria o scroll e o usuário não conseguiria sair do lugar.
  const didFocusFeedRef = useRef(false);
  // Estado, e não só ref: o onLayout do bloco do feed chega DEPOIS do primeiro
  // render, e um ref puro não acordaria o efeito que faz o scroll.
  const [feedPosition, setFeedPosition] = useState<number | null>(null);
```

Acrescentar `useRef` ao import de `react` no topo do arquivo.

- [ ] **Step 3: Efeito de scroll**

Depois dos efeitos de carregamento já existentes:

```ts
  useEffect(() => {
    if (focus !== 'feed' || didFocusFeedRef.current) return;
    if (feedPosition === null || !event) return;
    didFocusFeedRef.current = true;
    // Um tick depois do layout: no Android o onLayout do bloco chega antes do
    // ScrollView conhecer a altura total do conteúdo, e o scrollTo é engolido.
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: feedPosition, animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [focus, event, feedPosition]);
```

- [ ] **Step 4: Envolver o bloco do feed**

Trocar o bloco atual por:

```tsx
        {event.feedEnabled ? (
          <View
            onLayout={(e) => setFeedPosition(e.nativeEvent.layout.y)}
          >
            <EventFeedSection
              eventSlug={event.slug}
              eventId={event.id}
              feedSettings={{
                feedEnabled: event.feedEnabled,
                feedAccess: event.feedAccess,
                postingAccess: event.postingAccess,
                maxPostsPerUser: null,
                maxPhotosPerUser: 5,
              }}
              ticketSource={ticketSource}
              embedded
            />
          </View>
        ) : null}
```

E no `<ScrollView>` da linha 215, acrescentar `ref={scrollRef}`.

- [ ] **Step 5: Verificar**

Run: `cd apps/mobile && pnpm typecheck && pnpm lint && pnpm exec vitest run`
Expected: PASS, sem warning novo de lint.

Verificação manual, obrigatória antes do commit: subir o app (`pnpm --filter @ccc/mobile start:web`), marcar um evento como `feedAccess: 'public'` no admin, criar um post nele, abrir a Início e tocar no card. A página do evento tem que abrir já rolada até o feed. Registrar no commit o que foi visto.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write "apps/mobile/app/(app)/events/[slug].tsx"
git add "apps/mobile/app/(app)/events/[slug].tsx"
git commit -m "feat(mobile): rola ate o feed ao abrir evento pela Inicio"
```

---

### Task 10: Verificação final

- [ ] **Step 1: Suíte da API inteira**

Run: `cd apps/api && pnpm exec vitest run`
Expected: PASS. Leva ~13 min. Rodar por inteiro porque a Task 3 mexeu num serializador que os handlers de comentário e de moderação compartilham.

- [ ] **Step 2: Lint por pacote**

Run: `cd apps/api && pnpm lint`
Run: `cd apps/admin && pnpm lint`
Run: `cd apps/mobile && pnpm lint`

Medir a contagem de warnings no commit base ANTES de comparar, e julgar o diff por ter ADICIONADO warning ou error, nunca por um número absoluto. Não usar `git stash` para medir: este repo é compartilhado com outras sessões via worktrees.

- [ ] **Step 3: Typecheck de tudo**

Run: `pnpm --filter @ccc/shared --filter @ccc/db --filter @ccc/api --filter @ccc/admin --filter @ccc/mobile typecheck`
Expected: PASS.

- [ ] **Step 4: Abrir o PR**

PR contra `main`, nunca contra `production`. Corpo com: o que foi feito, o fato de a seção nascer vazia até alguém marcar eventos como `public`, e os dois bugs pré-existentes listados em "Fora de escopo" no spec.

---

## Achados pré-existentes, fora do escopo deste plano

Não corrigir aqui. Abrir issue separada.

1. `DELETE /events/:eventId/feed/:postId/reactions` não existe na API. `apps/mobile/src/api/feed.ts:74` chama, `EventFeedSection.tsx:156` engole o 404, e o estado local já decrementou: a UI mostra descurtido e o servidor mantém o like.
2. Upload de foto no composer do mobile está morto. A API aceita `photoObjectKeys`, nenhum call site do mobile envia.
