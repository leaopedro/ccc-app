# Feed da comunidade na Início — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma seção na tela de Início do app mobile com posts sorteados de eventos públicos, onde tocar num card abre a página do evento já rolada até o feed.

**Architecture:** Um endpoint novo e público (`GET /api/home-feed`) sorteia N posts dentre os 50 mais recentes de eventos elegíveis, reusando o serializador de post que hoje vive dentro de `routes/feed.ts`. A quantidade N sai de um campo novo no singleton `HomeContent`, editável no admin. O mobile consome com um hook simples e renderiza um carrossel horizontal em `GuestHome` e `MemberHome`.

**Tech Stack:** Fastify + Prisma (apps/api), Zod (packages/shared), Next.js App Router (apps/admin), Expo React Native + expo-router (apps/mobile), Vitest em todos.

**Spec:** `docs/superpowers/specs/2026-09-13-home-community-feed-design.md`

Este plano foi revisado por quatro revisores adversariais em 2026-09-13 (privacidade, backend/Prisma, React Native, executabilidade). As correções estão incorporadas. Onde um passo parece exagerado, ele paga um defeito concreto que a revisão encontrou; os comentários no código dizem qual.

## Global Constraints

- Idioma da copy visível ao usuário: PT-BR.
- A resposta de `/api/home-feed` NUNCA pode conter `authorUserId`, nem nenhuma chave de `FEED_FORBIDDEN_RESPONSE_KEYS` (`plate`, `email`, `phone`, `cpf`, `userId`, `ownerId`, `address`). Autoria só via `isOwn: boolean`.
- Elegibilidade de um post, todas obrigatórias: `FeedPost.status = 'visible'`, `Event.feedEnabled = true`, `Event.feedAccess = 'public'`, `Event.status = 'published'`, `authorUserId` não nulo, sem `FeedBan` do autor naquele evento, sem `Report` com `status: 'open'`. A tabela de motivos está no spec.
- `HOME_FEED_POOL_SIZE = 50`.
- `HomeContent.feedPostCount`: `Int @default(5)`, faixa `0..20` no admin. Zero desliga a seção. Campo vazio no form significa "não alterar", NUNCA zero.
- Ordenação de qualquer query paginada de feed é total: `[{ createdAt: 'desc' }, { id: 'desc' }]`.
- Comandos rodam a partir da RAIZ da worktree. Use `pnpm --filter <pkg> exec <cmd>` em vez de `cd apps/<x> && ...`: o diretório de trabalho do shell persiste entre comandos, e um `cd` deixa todos os caminhos relativos seguintes errados.
- Rodar um arquivo de teste da API: `pnpm --filter @ccc/api exec vitest run test/<path>`. Nunca `pnpm --filter @ccc/api test -- <file>`: o `--` não filtra e roda a suíte inteira (~13 min).
- Depois de editar qualquer schema em `packages/shared`, rodar `pnpm --filter @ccc/shared build` antes dos testes de `apps/api`. A resolução passa por `dist/`.
- O hook de pre-commit desta worktree ESTÁ ativo. Hooks são por repositório, não por worktree: `.git` aqui é um arquivo apontando para o `.git` principal, onde o `pre-commit` vive. Ele roda `scripts/guard-branch-context.sh` e `pnpm lint-staged` (eslint --fix + prettier --write nos arquivos staged). Portanto: não rode prettier à mão, e não commite antes do `pnpm install`, senão o hook falha com `Command "lint-staged" not found`.

---

## Task 0: Preparar a worktree

Sem isto nada roda. A worktree não tem `node_modules`, não tem `.env` do Prisma e não tem Postgres de pé.

- [ ] **Step 1: Instalar**

```bash
pnpm install
```

- [ ] **Step 2: Build dos pacotes de workspace**

```bash
pnpm --filter @ccc/db --filter @ccc/shared --filter @ccc/design build
```

Sem isto, ~20 arquivos de teste falham com `Failed to resolve entry for package "@ccc/db"`, um erro que não sugere a causa.

- [ ] **Step 3: Banco de desenvolvimento**

```bash
cp packages/db/.env.example packages/db/.env
docker ps --filter name=jdm-postgres --format '{{.Names}} {{.Status}}'
```

`packages/db/prisma/schema.prisma:8` lê `env("DATABASE_URL")`; a worktree só tem `.env.example`. A Task 2 precisa disso para gerar a migration.

O container `jdm-postgres` é único por máquina e compartilhado com o checkout principal. Se já estiver `Up` e saudável na 5433, use esse. Só rode `docker compose up -d postgres` se ele não existir. NUNCA remova ou recrie o container: ele pode ter o banco de dev de outra sessão.

- [ ] **Step 4: Docker para a suíte de testes**

O daemon do Docker precisa estar rodando: `apps/api/test/global-setup.ts` sobe um Postgres por Testcontainers para a suíte inteira, inclusive testes de unidade puros. Sem o daemon: `Could not find a working container runtime strategy`.

- [ ] **Step 5: Medir o baseline de lint**

```bash
pnpm --filter @ccc/api exec eslint src
pnpm --filter @ccc/admin exec eslint app src
pnpm --filter @ccc/mobile exec eslint app src
```

Anote as três contagens de warnings e errors. A Task 11 compara contra elas. Não use `git stash` para remedir depois: este repo é compartilhado com outras sessões via worktrees. `eslint` na raiz do monorepo estoura memória; sempre por pacote.

---

## File Structure

**packages/shared**

- Modificar `src/feed.ts` — `HOME_FEED_POOL_SIZE`, `homeFeedItemSchema`, `homeFeedResponseSchema`, registro em `FEED_PUBLIC_RESPONSE_SCHEMAS`.
- Criar `src/__tests__/home-feed-schema.test.ts`.
- Modificar `src/admin-home.ts` — `feedPostCount` na leitura e na escrita.

**packages/db**

- Modificar `prisma/schema.prisma` — `feedPostCount` no model `HomeContent`.
- Criar `prisma/migrations/<timestamp>_home_feed_post_count/migration.sql`.

**apps/api**

- Criar `src/services/feed/serialize.ts` — seleção e serialização de post, extraídas de `routes/feed.ts`.
- Modificar `src/routes/feed.ts` — usa o módulo acima nos três call sites.
- Criar `src/routes/home-feed.ts` — só o `GET /api/home-feed`.
- Modificar `src/app.ts` — registra a rota.
- Modificar `src/routes/admin/home-content.ts` — `feedPostCount` no serializer, em `CONTENT_FIELDS` e na auditoria.
- Criar `test/home-feed.route.test.ts`.
- Modificar `test/home-content.route.test.ts` e `test/admin/home-content.test.ts`.

**apps/admin**

- Modificar `app/(authed)/configuracoes/home-content-form.tsx` e o `.interaction.test.tsx` ao lado.

**apps/mobile**

- Criar `src/api/home-feed.ts`, `src/hooks/useHomeFeed.ts`.
- Criar `src/screens/inicio/components/FeedTeaserCard.tsx` e `src/screens/inicio/sections/CommunityFeedSection.tsx`.
- Modificar `src/copy/inicio.ts`, `src/screens/inicio/MemberHome.tsx`, `src/screens/inicio/GuestHome.tsx`, `app/(app)/events/[slug].tsx`.
- Criar `src/api/__tests__/home-feed.test.ts` e `src/screens/inicio/sections/__tests__/CommunityFeedSection.test.tsx`.
- Modificar `src/screens/inicio/__tests__/MemberHome.test.tsx` e `GuestHome.test.tsx`.

**docs**

- Modificar `docs/ropa.md` e `LGPD_scan.md`.

---

### Task 1: Schemas compartilhados do home-feed

**Files:**

- Modify: `packages/shared/src/feed.ts`
- Create: `packages/shared/src/__tests__/home-feed-schema.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `HOME_FEED_POOL_SIZE: number`; `homeFeedItemSchema` (= `feedPostResponseSchema` + `event: { slug: string; title: string }`); `homeFeedResponseSchema` (= `{ posts: HomeFeedItem[] }`); tipos `HomeFeedItem` e `HomeFeedResponse`.

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

Run: `pnpm --filter @ccc/shared exec vitest run src/__tests__/home-feed-schema.test.ts`
Expected: FAIL, `homeFeedItemSchema` não é exportado.

- [ ] **Step 3: Implementar**

Em `packages/shared/src/feed.ts`, logo depois do bloco `feedCommentListResponseSchema`:

```ts
/**
 * Quantos posts o sorteio da Início considera.
 *
 * O pool é cortado dos mais recentes e embaralhado em memória. `ORDER BY
 * random()` sobre a tabela inteira não usa índice nenhum. Ver a nota de custo
 * em routes/home-feed.ts: o LIMIT só ajuda se o WHERE casar cedo, e isso
 * depende de filtrar por eventId.
 */
export const HOME_FEED_POOL_SIZE = 50;

/**
 * Post do feed da Início. Carrega o evento porque a lista é cross-evento: o
 * card precisa rotular a origem e o toque precisa do slug para navegar.
 * `title` e `slug` só são públicos para evento PUBLICADO (routes/events.ts:172),
 * e é por isso que a rota filtra status: 'published'.
 */
export const homeFeedItemSchema = feedPostResponseSchema.extend({
  event: z.object({ slug: z.string().min(1), title: z.string().min(1) }),
});
export type HomeFeedItem = z.infer<typeof homeFeedItemSchema>;

/**
 * Sem page/total, ao contrário de feedListResponseSchema: a Início mostra um
 * punhado sorteado e não pagina. Um cursor aqui criaria a expectativa de uma
 * segunda página que o sorteio não sabe entregar sem repetir.
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

O que esse registro prova, e o que não prova: `feed-privacy-contract.test.ts:56` só compara chaves declaradas contra `FEED_FORBIDDEN_RESPONSE_KEYS`. Ele não sabe nada sobre `slug` de evento em rascunho. O controle real é o teste de integração da Task 4.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/shared exec vitest run src/__tests__/home-feed-schema.test.ts src/__tests__/feed-privacy-contract.test.ts`
Expected: PASS nos dois arquivos.

- [ ] **Step 5: Build e commit**

```bash
pnpm --filter @ccc/shared build
git add packages/shared/src/feed.ts packages/shared/src/__tests__/home-feed-schema.test.ts
git commit -m "feat(shared): schemas do feed da Inicio"
```

---

### Task 2: Campo feedPostCount no HomeContent

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (model `HomeContent`, `:2085-2095`)
- Create: `packages/db/prisma/migrations/<timestamp>_home_feed_post_count/migration.sql`
- Modify: `apps/api/test/home-content.route.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces: `HomeContent.feedPostCount: number` no client do Prisma, default 5.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/test/home-content.route.test.ts`, dentro do `describe('GET /api/home-content')`:

```ts
it('cria o singleton com feedPostCount 5', async () => {
  await app.inject(GET);

  const row = await prisma.homeContent.findUnique({ where: { id: HOME_CONTENT_SINGLETON_ID } });
  expect(row?.feedPostCount).toBe(5);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api exec vitest run test/home-content.route.test.ts`
Expected: FAIL em runtime, `expected undefined to be 5`. Não é falha de typecheck: vitest usa esbuild e não checa tipos.

- [ ] **Step 3: Implementar**

Em `packages/db/prisma/schema.prisma`, no model `HomeContent`, antes de `createdAt`:

```prisma
  /// Quantos posts o feed da Início sorteia. Zero desliga a seção sem exigir
  /// uma flag separada. O teto de 20 vive na validação do admin, não aqui: a
  /// coluna não precisa de migration se a decisão de produto mudar.
  feedPostCount               Int      @default(5)
```

Gerar a migration em dois passos. NÃO use `prisma migrate dev` sozinho: o Postgres de dev na porta 5433 é um container compartilhado com o checkout principal e com outras sessões, e `migrate dev` pode propor um reset do banco se detectar drift. `--create-only` escreve o arquivo sem aplicar, e `migrate deploy` aplica só o que está pendente e nunca reseta.

```bash
pnpm --filter @ccc/db exec prisma migrate dev --create-only --name home_feed_post_count
```

Se este comando pedir para resetar o banco, RESPONDA NÃO e reporte. Não é o seu banco.

Conferir o SQL gerado, depois aplicar:

```bash
pnpm --filter @ccc/db exec prisma migrate deploy
```

O SQL gerado tem que ser exatamente:

```sql
ALTER TABLE "HomeContent" ADD COLUMN     "feedPostCount" INTEGER NOT NULL DEFAULT 5;
```

Se o Prisma quiser alterar qualquer outra tabela, PARE e reporte. Não há drift conhecido — `prisma migrate diff` contra shadow DB sai vazio no estado atual — então alteração extra significa que algo mudou fora deste plano.

O arquivo de migration é obrigatório: `apps/api/test/global-setup.ts:22` roda `prisma migrate deploy` no container de teste.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/api exec vitest run test/home-content.route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma apps/api/test/home-content.route.test.ts
git commit -m "feat(db): feedPostCount no HomeContent"
```

---

### Task 3: Extrair o serializador de post do feed

Refatoração. O comportamento observável muda em dois pontos, ambos corrigindo bug, anotados no Step 2.

Existe porque a rota nova precisa exatamente do mesmo `POST_SELECT` e da mesma serialização. Atenção ao escopo: hoje `routes/feed.ts` monta o payload de post à mão em TRÊS lugares — o GET (por volta de `:173`), o POST (`:383-406`) e o PATCH (`:484-508`) — todos repetindo o `photos.sort().map()`, o `reactions`, o `commentCount` e os dois `toISOString()`. Extrair só para o GET criaria uma terceira fonte de verdade em vez de eliminar a duplicação. Os três passam a usar o módulo.

**Files:**

- Create: `apps/api/src/services/feed/serialize.ts`
- Modify: `apps/api/src/routes/feed.ts` — declarações locais em `:37-101`, o import de `computeIsPremiumActive` em `:24`, e os três call sites
- Test: `apps/api/test/feed/` (já existe, tem que continuar verde)

**Interfaces:**

- Consumes: nada.
- Produces:
  - `CAR_SELECT`, `POST_SELECT` — objetos `select` do Prisma.
  - `type CarSelect`, `type FeedPostRow` — tipos das linhas correspondentes.
  - `serializeCarProfile(car: CarSelect | null, buildUrl: (key: string) => string)`.
  - `serializeFeedPost(row: FeedPostRow, ctx: { isOwn: boolean; myReactions: Map<string, string>; buildUrl: (key: string) => string })` — objeto pronto para `feedPostResponseSchema.parse`.

`isOwn` é parâmetro explícito, e não derivado de um `userId` dentro da função, porque é a única coisa que difere entre os três call sites: no POST e no PATCH o autor é sempre quem fez a request.

- [ ] **Step 1: Medir o baseline**

Run: `pnpm --filter @ccc/api exec vitest run test/feed/`
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
  // `id` entra por causa do desempate em serializeCarProfile.
  photos: {
    select: { id: true, objectKey: true, width: true, height: true, sortOrder: true },
  },
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
  // NOT NULL no schema (schema.prisma:900, VarChar(20) e @@unique). O tipo
  // antigo em routes/feed.ts dizia `string | null`, o que fazia todo call
  // site carregar um fallback morto.
  nickname: string;
  modifications: string[];
  photos: {
    id: string;
    objectKey: string;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }[];
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
  // Desempate por id: CarPhoto.sortOrder tem @default(0) (schema.prisma:922),
  // então duas fotos sem ordem explícita deixavam o "primeiro" à mercê da
  // ordem de retorno do Postgres, que não é garantida sem ORDER BY — a foto
  // de capa do carro trocava sozinha entre requests.
  const primary =
    [...car.photos].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))[0] ??
    null;
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
 * `authorUserId` está em FeedPostRow só porque a query o seleciona, e NUNCA
 * sai no retorno. Ver a nota em feedPostResponseSchema: nenhum identificador
 * novo de usuário pode entrar num payload que leitor anônimo recebe. Por isso
 * `isOwn` é parâmetro, calculado por quem chama.
 */
export const serializeFeedPost = (
  row: FeedPostRow,
  ctx: {
    isOwn: boolean;
    myReactions: Map<string, string>;
    buildUrl: (key: string) => string;
  },
) => ({
  id: row.id,
  eventId: row.eventId,
  isOwn: ctx.isOwn,
  car: serializeCarProfile(row.car, ctx.buildUrl),
  body: row.body,
  status: row.status,
  photos: [...row.photos]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
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

Mudanças de comportamento deliberadas, ambas corrigindo bug:

1. Desempate por `id` na escolha da foto primária do carro e na ordem das fotos do post.
2. `CAR_SELECT.photos` passa a selecionar `id`, necessário para o desempate.

- [ ] **Step 3: Apontar `routes/feed.ts` para o módulo**

1. Apagar as declarações locais de `CAR_SELECT`, `POST_SELECT`, `type CarSelect` e `serializeCarProfile` (`:37-101`).
2. Apagar a linha `24`, o import de `computeIsPremiumActive`. Depois da extração ele fica sem nenhum uso no arquivo, e `@typescript-eslint/no-unused-vars` é `error` aqui (`eslint.config.js:44`). Isto não é condicional: `:88` era a única referência e sai junto.
3. Acrescentar o import, respeitando a ordem alfabética que `import/order` exige (`eslint.config.js:49-56`):

```ts
import {
  CAR_SELECT,
  POST_SELECT,
  serializeCarProfile,
  serializeFeedPost,
} from '../services/feed/serialize.js';
```

4. No `GET /events/:eventId/feed`, trocar o `posts.map(...)` inteiro por:

```ts
        posts: posts.map((p) =>
          feedPostResponseSchema.parse(
            serializeFeedPost(p, {
              isOwn: userId !== null && p.authorUserId === userId,
              myReactions,
              buildUrl,
            }),
          ),
        ),
```

5. Nos handlers `POST /events/:eventId/feed` e `PATCH /events/:eventId/feed/:postId`, trocar cada objeto montado à mão por uma chamada ao serializador. Antes de trocar, LEIA o handler e confira como ele calcula `reactions.mine` hoje; preserve esse valor em vez de zerar. Se ele hoje devolve `mine: false` fixo, um `myReactions` vazio reproduz isso:

```ts
      feedPostResponseSchema.parse(
        serializeFeedPost(post, { isOwn: true, myReactions: new Map(), buildUrl }),
      ),
```

Adapte o nome da variável da linha (`post`, `created`, `updated` — use o que estiver lá) e garanta que a query daquele handler seleciona `POST_SELECT`. `isOwn: true` porque nos dois casos o autor é quem fez a request.

- [ ] **Step 4: Rodar testes, typecheck e lint**

Run: `pnpm --filter @ccc/api exec vitest run test/feed/`
Run: `pnpm --filter @ccc/api typecheck`
Run: `pnpm --filter @ccc/api exec eslint src`
Expected: PASS, com o mesmo número de testes do Step 1 e sem lint novo.

Se algum teste de `test/feed/crud.test.ts` falhar por ordem de fotos, veja se ele dependia da ordem não determinística antiga. Nesse caso o teste é que estava errado; conserte e diga isso no commit.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/feed/serialize.ts apps/api/src/routes/feed.ts apps/api/test/feed
git commit -m "refactor(api): extrai o serializador de post do feed"
```

---

### Task 4: Rota GET /api/home-feed

**Files:**

- Create: `apps/api/src/routes/home-feed.ts`
- Modify: `apps/api/src/app.ts:29` (import) e `:169` (registro)
- Create: `apps/api/test/home-feed.route.test.ts`

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

// createUser usa 'user@jdm.test' por padrao e User.email e unique, entao todo
// teste que cria mais de um usuario precisa passar emails distintos.
let seq = 0;
const newUser = async () => (await createUser({ email: `home-feed-${(seq += 1)}@jdm.test` })).user;

const seedEvent = (
  title: string,
  overrides: {
    feedAccess?: 'public' | 'attendees' | 'members_only';
    feedEnabled?: boolean;
    status?: 'draft' | 'published' | 'cancelled';
  } = {},
) =>
  prisma.event.create({
    data: {
      title,
      slug: `hf-${Math.random().toString(36).slice(2, 10)}`,
      description: 'desc',
      startsAt: new Date('2026-07-01T18:00:00Z'),
      endsAt: new Date('2026-07-01T22:00:00Z'),
      type: 'meeting',
      status: overrides.status ?? 'published',
      capacity: 100,
      feedEnabled: overrides.feedEnabled ?? true,
      feedAccess: overrides.feedAccess ?? 'public',
      postingAccess: 'attendees',
    },
  });

const seedPost = async (eventId: string, body: string, authorUserId?: string) =>
  prisma.feedPost.create({
    data: { eventId, body, authorUserId: authorUserId ?? (await newUser()).id, status: 'visible' },
  });

const setCount = (feedPostCount: number) =>
  prisma.homeContent.upsert({
    where: { id: HOME_CONTENT_SINGLETON_ID },
    create: { id: HOME_CONTENT_SINGLETON_ID, feedPostCount },
    update: { feedPostCount },
  });

const bodies = (payload: unknown) =>
  homeFeedResponseSchema
    .parse(payload)
    .posts.map((p) => p.body)
    .sort();

describe('GET /api/home-feed', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.homeContent.deleteMany();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serve post de evento public e published sem auth', async () => {
    const event = await seedEvent('Encontro Publico');
    await seedPost(event.id, 'ola mundo');

    const res = await app.inject(GET);

    expect(res.statusCode).toBe(200);
    expect(bodies(res.json())).toEqual(['ola mundo']);
  });

  it('embute slug e titulo do evento em cada item', async () => {
    const event = await seedEvent('Encontro Publico');
    await seedPost(event.id, 'ola mundo');

    const body = homeFeedResponseSchema.parse((await app.inject(GET)).json());

    expect(body.posts[0]?.event).toEqual({ slug: event.slug, title: event.title });
  });

  it('nao serve post de evento attendees nem members_only', async () => {
    const attendees = await seedEvent('Fechado', { feedAccess: 'attendees' });
    const members = await seedEvent('Premium', { feedAccess: 'members_only' });
    await seedPost(attendees.id, 'secreto a');
    await seedPost(members.id, 'secreto b');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post de evento em rascunho', async () => {
    const draft = await seedEvent('Surpresa', { status: 'draft' });
    await seedPost(draft.id, 'nao anunciado');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post de evento cancelado', async () => {
    const cancelled = await seedEvent('Cancelado', { status: 'cancelled' });
    await seedPost(cancelled.id, 'nao vai rolar');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post de evento com feed desligado', async () => {
    const event = await seedEvent('Desligado', { feedEnabled: false });
    await seedPost(event.id, 'invisivel');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post escondido nem removido', async () => {
    const event = await seedEvent('Encontro Publico');
    const hidden = await seedPost(event.id, 'escondido');
    await prisma.feedPost.update({ where: { id: hidden.id }, data: { status: 'hidden' } });
    const removed = await seedPost(event.id, 'removido');
    await prisma.feedPost.update({ where: { id: removed.id }, data: { status: 'removed' } });
    await seedPost(event.id, 'visivel');

    expect(bodies((await app.inject(GET)).json())).toEqual(['visivel']);
  });

  it('nao serve post com denuncia aberta', async () => {
    const event = await seedEvent('Encontro Publico');
    const denounced = await seedPost(event.id, 'denunciado');
    await seedPost(event.id, 'limpo');
    const reporter = await newUser();
    await prisma.report.create({
      data: {
        targetKind: 'post',
        postId: denounced.id,
        reporterUserId: reporter.id,
        reason: 'spam',
        status: 'open',
      },
    });

    expect(bodies((await app.inject(GET)).json())).toEqual(['limpo']);
  });

  it('nao serve post de autor banido naquele evento', async () => {
    const event = await seedEvent('Encontro Publico');
    const other = await seedEvent('Outro Encontro');
    const troll = await newUser();
    const moderator = await newUser();
    await seedPost(event.id, 'do banido', troll.id);
    await seedPost(other.id, 'do mesmo autor em outro evento', troll.id);
    await prisma.feedBan.create({
      data: { eventId: event.id, userId: troll.id, scope: 'post', bannedById: moderator.id },
    });

    expect(bodies((await app.inject(GET)).json())).toEqual(['do mesmo autor em outro evento']);
  });

  it('nao serve post de conta apagada', async () => {
    const event = await seedEvent('Encontro Publico');
    await prisma.feedPost.create({
      data: { eventId: event.id, body: 'tombstone', authorUserId: null, status: 'visible' },
    });
    await seedPost(event.id, 'com autor');

    expect(bodies((await app.inject(GET)).json())).toEqual(['com autor']);
  });

  it('respeita feedPostCount', async () => {
    const event = await seedEvent('Encontro Publico');
    for (let i = 0; i < 8; i += 1) await seedPost(event.id, `post ${i}`);
    await setCount(3);

    expect(homeFeedResponseSchema.parse((await app.inject(GET)).json()).posts).toHaveLength(3);
  });

  it('feedPostCount zero devolve lista vazia', async () => {
    const event = await seedEvent('Encontro Publico');
    await seedPost(event.id, 'post');
    await setCount(0);

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('sorteia em vez de devolver sempre os mais novos', async () => {
    const event = await seedEvent('Encontro Publico');
    for (let i = 0; i < 20; i += 1) await seedPost(event.id, `post ${i}`);
    await setCount(3);

    const seen = new Set<string>();
    for (let call = 0; call < 6; call += 1) {
      for (const body of bodies((await app.inject(GET)).json())) seen.add(body);
    }

    // Catches: trocar shuffle(pool).slice(0, N) por pool.slice(0, N). Com 20
    // posts, 3 por chamada e 6 chamadas, ver so 3 distintos tem probabilidade
    // desprezivel; sem sorteio, e o resultado garantido.
    expect(seen.size).toBeGreaterThan(3);
  });

  it('esconde post de autor bloqueado em qualquer direcao', async () => {
    const event = await seedEvent('Encontro Publico');
    const reader = await newUser();
    const blocked = await newUser();
    const blocker = await newUser();
    await seedPost(event.id, 'do bloqueado', blocked.id);
    await seedPost(event.id, 'de quem me bloqueou', blocker.id);
    await seedPost(event.id, 'de terceiro');
    await prisma.userBlock.create({ data: { blockerId: reader.id, blockedId: blocked.id } });
    await prisma.userBlock.create({ data: { blockerId: blocker.id, blockedId: reader.id } });

    const res = await app.inject({ ...GET, headers: { authorization: bearer(env, reader.id) } });

    expect(bodies(res.json())).toEqual(['de terceiro']);
  });

  it('esconde o evento inteiro de quem tem FeedBan de view', async () => {
    const banned = await seedEvent('Banido');
    const open = await seedEvent('Aberto');
    const reader = await newUser();
    const moderator = await newUser();
    await seedPost(banned.id, 'do evento banido');
    await seedPost(open.id, 'do evento aberto');
    await prisma.feedBan.create({
      data: { eventId: banned.id, userId: reader.id, scope: 'view', bannedById: moderator.id },
    });

    const res = await app.inject({ ...GET, headers: { authorization: bearer(env, reader.id) } });

    expect(bodies(res.json())).toEqual(['do evento aberto']);
  });

  it('marca isOwn no post do proprio leitor e nunca expoe authorUserId', async () => {
    const event = await seedEvent('Encontro Publico');
    const reader = await newUser();
    await seedPost(event.id, 'meu post', reader.id);

    const res = await app.inject({ ...GET, headers: { authorization: bearer(env, reader.id) } });

    const body = homeFeedResponseSchema.parse(res.json());
    expect(body.posts[0]?.isOwn).toBe(true);
    // JSON cru, antes do .parse: o parse do zod faria o strip e esconderia o
    // vazamento que este teste existe para pegar.
    expect(JSON.stringify(res.json())).not.toContain('authorUserId');
  });

  it('isOwn e false para leitor anonimo', async () => {
    const event = await seedEvent('Encontro Publico');
    await seedPost(event.id, 'post alheio');

    const body = homeFeedResponseSchema.parse((await app.inject(GET)).json());
    expect(body.posts[0]?.isOwn).toBe(false);
  });
});
```

Os helpers são os que `apps/api/test/helpers.ts` já exporta: `makeApp` (`:10`), `resetDatabase` (`:32`), `createUser` (`:159`, devolve `{ user, password }`) e `bearer` (`:212`, devolve o header inteiro). `loadEnv` vem de `../src/env.js`, mesmo idiom de `test/feed/crud.test.ts:6`. `FeedBan.bannedById` é obrigatório (`schema.prisma:1790`) e está nos dois testes que criam ban.

Antes de rodar, confira os campos obrigatórios de `Report` em `schema.prisma:1880-1910` e ajuste o `prisma.report.create` se algum faltar.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api exec vitest run test/home-feed.route.test.ts`
Expected: FAIL com 404 em toda request; a rota ainda não existe.

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
 * Sem query param de quantidade de propósito. O número vem de
 * HomeContent.feedPostCount, então a configuração fica num lugar só e a URL
 * não vira um jeito de pedir a tabela inteira.
 */

import { prisma } from '@ccc/db';
import { HOME_FEED_POOL_SIZE, homeFeedResponseSchema } from '@ccc/shared/feed';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { blockedUserIdsFor } from '../services/feed/blocks.js';
import { POST_SELECT, serializeFeedPost } from '../services/feed/serialize.js';
import { ensureHomeContent } from '../services/home-content.js';

/** Fisher-Yates sobre uma cópia. */
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
    // Teto alto de propósito, no molde de premium-catalog.ts:78-95. trustProxy
    // NÃO está ligado em app.ts:98, então atrás do Railway `req.ip` é o
    // endereço do proxy para todo caller e a chave por IP colapsa num balde
    // global: com 60/min, 61 pessoas abrindo o app no mesmo minuto derrubariam
    // a seção para a frota inteira. Chaveamos por usuário quando há sessão,
    // que é o único identificador confiável hoje.
    max: 6000,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `home-feed:${req.user?.sub ?? req.ip}`,
  });

  app.get('/api/home-feed', { preHandler: [app.tryAuth] }, async (request, reply) => {
    const userId = request.user?.sub ?? null;

    // Quatro leituras independentes; nenhuma depende da outra.
    const [content, eligibleEvents, blockedIds, viewBans] = await Promise.all([
      ensureHomeContent(),
      prisma.event.findMany({
        where: { status: 'published', feedEnabled: true, feedAccess: 'public' },
        select: { id: true },
      }),
      blockedUserIdsFor(userId),
      userId
        ? prisma.feedBan.findMany({ where: { userId, scope: 'view' }, select: { eventId: true } })
        : Promise.resolve([] as { eventId: string }[]),
    ]);

    const bannedForReader = new Set(viewBans.map((b) => b.eventId));
    const eventIds = eligibleEvents.map((e) => e.id).filter((id) => !bannedForReader.has(id));

    if (content.feedPostCount <= 0 || eventIds.length === 0) {
      return reply.status(200).send(homeFeedResponseSchema.parse({ posts: [] }));
    }

    // `eventId: { in: [...] }` em vez de `where.event.feedAccess: 'public'`.
    // Medido em Postgres 16 com 400k posts: o filtro relacional vira um
    // semi-join que varre o índice [status, createdAt] de trás para frente
    // procurando 50 linhas que casem — 392 mil linhas e 9.127 buffers quando
    // não há nenhum evento público, que é o estado inicial desta feature. Com
    // a lista de ids o planner usa [eventId, createdAt desc]: 63 buffers.
    const pool = await prisma.feedPost.findMany({
      where: {
        status: 'visible',
        eventId: { in: eventIds },
        // Conta apagada: anonymize.ts:107 preserva o body e anula o autor. No
        // feed do evento isso mantém a thread íntegra; aqui viraria promoção
        // do conteúdo de quem pediu eliminação, para anônimo, na primeira
        // tela do app. Ver "Conta apagada" no spec.
        //
        // O `notIn` do bloqueio mora na MESMA chave, então os dois vivem neste
        // objeto único. Perder o `not: null` aqui reintroduziria o problema do
        // `NULL NOT IN (...)` que routes/feed.ts:131-138 documenta.
        authorUserId: blockedIds.length > 0 ? { not: null, notIn: blockedIds } : { not: null },
        // Denúncia aberta: o auto-hide só dispara com 3 denunciantes distintos
        // (services/feed/report.ts:13). Dois é tolerável dentro do evento, não
        // na vitrine do app.
        reports: { none: { status: 'open' } },
      },
      select: { ...POST_SELECT, event: { select: { slug: true, title: true } } },
      // Ordenação total. Sem o desempate por id, dois posts com o mesmo
      // createdAt podem trocar de lugar entre requests e o corte do pool fica
      // não determinístico de um jeito que nenhum teste pega.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HOME_FEED_POOL_SIZE,
    });

    // Autor banido no evento onde postou. FeedBan não mexe em FeedPost.status
    // (routes/admin/feed-moderation.ts:245), então sem isto banir um
    // assediador deixa o conteúdo dele sendo promovido à primeira tela.
    // Filtrado depois do pool, não no where: é um par (eventId, authorUserId),
    // e o encolhimento é tolerável com pool de 50 e corte de 5.
    const authorIds = [
      ...new Set(pool.map((p) => p.authorUserId).filter((id): id is string => id !== null)),
    ];
    const authorBans = await prisma.feedBan.findMany({
      where: { eventId: { in: eventIds }, userId: { in: authorIds } },
      select: { eventId: true, userId: true },
    });
    const bannedPairs = new Set(authorBans.map((b) => `${b.eventId}:${b.userId}`));
    const eligible = pool.filter((p) => !bannedPairs.has(`${p.eventId}:${p.authorUserId ?? ''}`));

    const picked = shuffle(eligible).slice(0, content.feedPostCount);

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
          ...serializeFeedPost(p, {
            isOwn: userId !== null && p.authorUserId === userId,
            myReactions,
            buildUrl,
          }),
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

E logo depois de `await app.register(homeContentRoutes);` (`:169`):

```ts
await app.register(homeFeedRoutes);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/api exec vitest run test/home-feed.route.test.ts`
Run: `pnpm --filter @ccc/api typecheck`
Run: `pnpm --filter @ccc/api exec eslint src`
Expected: PASS nos 17 testes, sem lint novo.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/home-feed.ts apps/api/src/app.ts apps/api/test/home-feed.route.test.ts
git commit -m "feat(api): GET /api/home-feed"
```

---

### Task 5: feedPostCount editável no admin

**Files:**

- Modify: `packages/shared/src/admin-home.ts` (`adminHomeContentSchema` e `homeContentUpdateSchema`)
- Modify: `apps/api/src/routes/admin/home-content.ts` (serializer `:27-40`, `CONTENT_FIELDS` `:50-58`, auditoria `:118-135`)
- Modify: `apps/admin/app/(authed)/configuracoes/home-content-form.tsx`
- Modify: `apps/api/test/admin/home-content.test.ts`
- Modify: `apps/admin/app/(authed)/configuracoes/home-content-form.interaction.test.tsx`

**Interfaces:**

- Consumes: `HomeContent.feedPostCount` da Task 2.
- Produces: `feedPostCount: number` em `adminHomeContentSchema`; `feedPostCount?: number` em `homeContentUpdateSchema`.

- [ ] **Step 1: Testes da API que falham**

O arquivo tem um `describe('admin home content')` só, sem sub-describe por método. Os helpers reais são `organizer()` (`:33`), `ensureRowViaGet(app, userId)` (`:11`), `readRow()` (`:36`) e `put(userId, payload)` — **dois** argumentos (`:39`). Acrescentar:

```ts
it('PUT persiste feedPostCount', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  const res = await put(user.id, { expectedUpdatedAt: before.updatedAt, feedPostCount: 8 });

  expect(res.statusCode).toBe(200);
  expect(adminHomeContentSchema.parse(res.json()).feedPostCount).toBe(8);
  expect((await readRow()).feedPostCount).toBe(8);
});

it('PUT recusa feedPostCount acima do teto', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  const res = await put(user.id, { expectedUpdatedAt: before.updatedAt, feedPostCount: 21 });

  expect(res.statusCode).toBe(400);
});

it('PUT aceita feedPostCount zero', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  const res = await put(user.id, { expectedUpdatedAt: before.updatedAt, feedPostCount: 0 });

  expect(res.statusCode).toBe(200);
  expect((await readRow()).feedPostCount).toBe(0);
});

it('PUT trata string vazia como nao alterar, e nao como zero', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  const res = await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    heroTitle: 'OUTRO MOTE',
    feedPostCount: '',
  });

  // Catches: z.coerce.number() puro, onde Number('') === 0 passa em min(0).
  // O organizer que limpa o campo para redigitar e clica Salvar apagaria a
  // secao da Inicio de todo mundo, com 200 e sem aviso.
  expect(res.statusCode).toBe(200);
  expect((await readRow()).feedPostCount).toBe(5);
});

it('PUT audita o valor anterior e o novo de feedPostCount', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  await put(user.id, { expectedUpdatedAt: before.updatedAt, feedPostCount: 12 });

  const entry = await prisma.adminAudit.findFirst({
    where: { action: 'home_content.update' },
    orderBy: { createdAt: 'desc' },
  });
  expect(entry?.metadata).toMatchObject({ values: { feedPostCount: { previous: 5, next: 12 } } });
});
```

Referências verificadas para estes testes: o model de auditoria é `AdminAudit` (`schema.prisma:1048`), a `action` é `'home_content.update'` e o `metadata` hoje é `{ fields: touched, images }` (`routes/admin/home-content.ts:128-133`). 400 em entrada inválida é o comportamento estabelecido do handler — `test/admin/home-content.test.ts:226` e `:232` já dependem dele.

- [ ] **Step 2: Teste do form que falha**

Em `apps/admin/app/(authed)/configuracoes/home-content-form.interaction.test.tsx`:

1. Acrescentar `feedPostCount: 5` ao objeto `initial` (`:22-32`).
2. Acrescentar o teste. Renderizar dentro de `act` ANTES de tocar no DOM, e clicar com `clickByText('Salvar')` (`:52`): `container.querySelector('button')` pegaria o primeiro botão da página, que vem do `HomeImageUploader` renderizado antes do Salvar.

```tsx
it('envia feedPostCount como numero no save', async () => {
  updateMock.mockResolvedValue({ ok: true, content: { ...initial, feedPostCount: 3 } });

  await act(async () => {
    root.render(<HomeContentForm initial={initial} />);
    await Promise.resolve();
  });

  setValue(input('Posts no feed da Início'), '3');

  await act(async () => {
    clickByText('Salvar');
    await Promise.resolve();
  });

  // Numero, nao string: HomeContentUpdate e o tipo de SAIDA do zod, entao
  // feedPostCount e `number | undefined`, e o estado do form e string.
  expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ feedPostCount: 3 }));
});
```

Confira em `:36-70` as assinaturas reais de `input`, `setValue` e `clickByText` e use-as como estão.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @ccc/api exec vitest run test/admin/home-content.test.ts`
Run: `pnpm --filter @ccc/admin exec vitest run "app/(authed)/configuracoes/home-content-form.interaction.test.tsx"`
Expected: FAIL nos dois.

- [ ] **Step 4: Schema compartilhado**

Em `packages/shared/src/admin-home.ts`, em `adminHomeContentSchema`, antes de `updatedAt`:

```ts
  /**
   * `.default(5)` na LEITURA: a API roda no Railway e o admin na Vercel, com
   * deploys independentes. Sem o default, um deploy do admin que chegue antes
   * do da API faz este parse lançar a página inteira de configurações.
   */
  feedPostCount: z.number().int().min(0).default(5),
```

E em `homeContentUpdateSchema`, depois de `institutionalImageObjectKey`:

```ts
  /**
   * Quantos posts a seção de feed da Início sorteia. Zero desliga a seção. O
   * teto de 20 é de produto, não de banco: a Início é uma tela de resumo.
   *
   * O preprocess é load-bearing, no mesmo espírito do optionalText acima. O
   * input do form entrega '' e nunca undefined; `z.coerce.number()` puro faz
   * Number('') === 0, que passa em min(0) e DESLIGA a seção. Vazio tem que
   * significar "não alterar".
   */
  feedPostCount: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce.number().int().min(0).max(20).optional(),
  ),
```

Depois: `pnpm --filter @ccc/shared build`.

- [ ] **Step 5: API admin**

Em `apps/api/src/routes/admin/home-content.ts`:

1. Em `serializeAdminHomeContent`, antes de `updatedAt`:

```ts
    feedPostCount: row.feedPostCount,
```

2. Em `CONTENT_FIELDS`, depois de `'institutionalImageObjectKey'`:

```ts
    'feedPostCount',
```

3. Auditoria com valor. Ao lado de `IMAGE_FIELDS`:

```ts
// feedPostCount controla quanto UGC vai para a vitrine do app, então a
// trilha precisa do antes/depois. Texto continua de fora: institutionalBody
// tem 1000 chars. Mesmo tratamento que IMAGE_FIELDS já recebe.
const VALUE_FIELDS = ['feedPostCount'] as const;
```

O bloco atual (`:121-133`) monta `images` com um loop e passa `metadata: { fields: touched, images }`. Acrescentar o loop irmão logo depois do de `images`, e a chave no `metadata`:

```ts
const values: Record<string, { previous: number; next: number }> = {};
for (const field of VALUE_FIELDS) {
  if (touched.includes(field)) {
    values[field] = { previous: existing[field], next: updated[field] };
  }
}

await recordAudit({
  actorId: sub,
  action: 'home_content.update',
  entityType: 'home_content',
  entityId: HOME_CONTENT_SINGLETON_ID,
  metadata: { fields: touched, images, values },
});
```

- [ ] **Step 6: Form do admin**

Em `apps/admin/app/(authed)/configuracoes/home-content-form.tsx`:

1. Novo estado, junto dos outros:

```ts
const [feedPostCount, setFeedPostCount] = useState(String(initial.feedPostCount));
```

2. No payload de `save`, depois de `institutionalImageObjectKey`:

```ts
        // Omitir quando vazio, em vez de mandar '' ou NaN. HomeContentUpdate
        // e o tipo de SAIDA do zod, entao feedPostCount e `number | undefined`
        // e passar a string crua nao compila. Campo vazio significa "nao
        // alterar", e omitir e exatamente isso.
        ...(feedPostCount.trim() === '' ? {} : { feedPostCount: Number(feedPostCount) }),
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
    Só entram posts de eventos publicados e com o feed marcado como público.
  </p>
</section>
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @ccc/api exec vitest run test/admin/home-content.test.ts`
Run: `pnpm --filter @ccc/admin exec vitest run`
Run: `pnpm --filter @ccc/api typecheck`
Run: `pnpm --filter @ccc/admin typecheck`
Expected: PASS em tudo.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/admin-home.ts apps/api/src/routes/admin/home-content.ts apps/api/test/admin/home-content.test.ts "apps/admin/app/(authed)/configuracoes"
git commit -m "feat(admin): quantidade de posts do feed da Inicio"
```

---

### Task 6: Cliente e hook do home-feed no mobile

**Files:**

- Create: `apps/mobile/src/api/home-feed.ts`
- Create: `apps/mobile/src/hooks/useHomeFeed.ts`
- Create: `apps/mobile/src/api/__tests__/home-feed.test.ts`

**Interfaces:**

- Consumes: `homeFeedResponseSchema`, `HomeFeedItem` da Task 1.
- Produces: `listHomeFeed(): Promise<HomeFeedResponse>`; `useHomeFeed(): { posts: HomeFeedItem[]; loading: boolean; refresh: () => Promise<void> }`.

- [ ] **Step 1: Escrever o teste que falha**

Abra `apps/mobile/src/api/__tests__/home.test.ts` e siga o idiom dele: dois spies DISTINTOS para `request` e `authedRequest`, com asserção explícita sobre qual foi usado. Um mock compartilhado passaria com as duas implementações e não pegaria o bug que este teste existe para pegar.

Criar `apps/mobile/src/api/__tests__/home-feed.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequest, mockAuthedRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockAuthedRequest: vi.fn(),
}));

vi.mock('~/api/client', () => ({
  request: mockRequest,
  authedRequest: mockAuthedRequest,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { listHomeFeed } from '../home-feed';

describe('listHomeFeed', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockAuthedRequest.mockReset();
  });

  it('usa authedRequest para GET /api/home-feed', async () => {
    mockAuthedRequest.mockResolvedValue({ posts: [] });

    await listHomeFeed();

    // Load-bearing: com `request` puro o header de auth nunca sai
    // (src/api/client.ts:34-41), request.user e sempre undefined no servidor,
    // e o filtro de bloqueio da rota nunca roda em producao — enquanto os
    // testes da API, que injetam o header na mao, ficam verdes.
    expect(mockAuthedRequest).toHaveBeenCalledWith('/api/home-feed', expect.anything());
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('cai para request anonimo quando nao ha token no boot', async () => {
    mockAuthedRequest.mockRejectedValue(new Error('no access token'));
    mockRequest.mockResolvedValue({ posts: [] });

    await listHomeFeed();

    expect(mockRequest).toHaveBeenCalledWith('/api/home-feed', expect.anything());
  });
});
```

Confira a assinatura real do construtor de `ApiError` em `apps/mobile/src/api/client.ts` e ajuste o mock para ela.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/api/__tests__/home-feed.test.ts`
Expected: FAIL, módulo `../home-feed` não existe.

- [ ] **Step 3: Implementar o cliente**

Criar `apps/mobile/src/api/home-feed.ts`:

```ts
import { type HomeFeedResponse, homeFeedResponseSchema } from '@ccc/shared/feed';

import { ApiError, authedRequest, request } from '~/api/client';

const PATH = '/api/home-feed';

/**
 * GET /api/home-feed.
 *
 * authedRequest com fallback anônimo, o mesmo idiom de listFeedPosts
 * (src/api/feed.ts:23-38). O token não é opcional aqui: `request` só manda
 * `authorization` se receber um token explícito (client.ts:34-41), e sem ele o
 * servidor trata todo mundo como anônimo — `blockedUserIdsFor(null)` devolve
 * [] e o membro que bloqueou um assediador continuaria vendo os posts dele na
 * primeira tela do app, com a suíte da API verde.
 *
 * O fallback existe porque o boot na web chega no feed antes do provider de
 * token subir.
 */
export const listHomeFeed = async (): Promise<HomeFeedResponse> => {
  try {
    return await authedRequest(PATH, homeFeedResponseSchema);
  } catch (error) {
    if (
      (error instanceof ApiError && error.status === 401) ||
      (error instanceof Error &&
        (error.message === 'token provider not registered' || error.message === 'no access token'))
    ) {
      return request(PATH, homeFeedResponseSchema);
    }
    throw error;
  }
};
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

Run: `pnpm --filter @ccc/mobile exec vitest run src/api/__tests__/home-feed.test.ts`
Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api/home-feed.ts apps/mobile/src/hooks/useHomeFeed.ts apps/mobile/src/api/__tests__/home-feed.test.ts
git commit -m "feat(mobile): cliente e hook do feed da Inicio"
```

---

### Task 7: Card e seção do feed na Início

**Files:**

- Create: `apps/mobile/src/screens/inicio/components/FeedTeaserCard.tsx`
- Create: `apps/mobile/src/screens/inicio/sections/CommunityFeedSection.tsx`
- Modify: `apps/mobile/src/copy/inicio.ts` (objeto `sections`, `:8-21`)
- Create: `apps/mobile/src/screens/inicio/sections/__tests__/CommunityFeedSection.test.tsx`

O teste vai em `sections/__tests__/`, não em `inicio/__tests__/`: é ali que moram todos os testes de seção.

**Interfaces:**

- Consumes: `HomeFeedItem` da Task 1.
- Produces:
  - `FeedTeaserCard({ post, onPress }: { post: HomeFeedItem; onPress: () => void })`
  - `CommunityFeedSection({ posts, onOpenEvent }: { posts: HomeFeedItem[]; onOpenEvent: (slug: string) => void })` — renderiza `null` com a lista vazia.

- [ ] **Step 1: Escrever o teste que falha**

O repositório NÃO tem `@testing-library/react-native`. Não existe `render`, `fireEvent`, `getByText` nem `toJSON`. O idiom real é jsdom + `createRoot` de `react-dom/client` + um `vi.mock('react-native', ...)` por arquivo que traduz componentes RN para tags DOM (`testID` vira `data-testid`, `onPress` vira `onClick`).

Montar o arquivo assim:

1. Copiar as linhas `1-86` de `apps/mobile/src/screens/inicio/sections/__tests__/ConfirmedCarsSection.test.tsx`: o pragma `// @vitest-environment jsdom`, o `declare global`, o `resolveStyle` e o `vi.mock('react-native', ...)` inteiro. São ~75 linhas de mock; não há como evitá-las.
2. Copiar também o `vi.mock('expo-linear-gradient', ...)` de `apps/mobile/src/screens/inicio/sections/__tests__/HeroSection.test.tsx:82-90`, porque o card usa `LinearGradient`.
3. Copiar o bloco `let container` / `beforeEach` / `afterEach` de `ConfirmedCarsSection.test.tsx:114-136`.

Depois disso, o corpo:

```tsx
import type { HomeFeedItem } from '@ccc/shared/feed';

import { inicioCopy } from '~/copy/inicio';

import { CommunityFeedSection } from '../CommunityFeedSection';

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
  it('nao renderiza nada com a lista vazia', async () => {
    await act(async () => {
      root.render(<CommunityFeedSection posts={[]} onOpenEvent={() => {}} />);
    });

    // Catches: perder a guarda posts.length === 0, que deixaria o rotulo
    // "DA COMUNIDADE" sozinho na tela — o caso mais comum, porque o feed so
    // enche quando alguem marca eventos como public.
    expect(container.textContent).toBe('');
    expect(container.firstChild).toBeNull();
  });

  it('mostra o rotulo, o corpo do post e o titulo do evento', async () => {
    await act(async () => {
      root.render(<CommunityFeedSection posts={[post()]} onOpenEvent={() => {}} />);
    });

    expect(container.textContent).toContain(inicioCopy.sections.communityFeed);
    expect(container.textContent).toContain('que encontro bom');
    expect(container.textContent).toContain('Encontro de Setembro');
  });

  it('abre o evento do post tocado', async () => {
    const opened: string[] = [];

    await act(async () => {
      root.render(<CommunityFeedSection posts={[post()]} onOpenEvent={(s) => opened.push(s)} />);
    });

    await act(async () => {
      container
        .querySelector('[data-testid="inicio-feed-card-p1"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(opened).toEqual(['encontro-setembro']);
  });

  it('inclui o corpo do post no rotulo de acessibilidade', async () => {
    await act(async () => {
      root.render(<CommunityFeedSection posts={[post()]} onOpenEvent={() => {}} />);
    });

    const label = container
      .querySelector('[data-testid="inicio-feed-card-p1"]')
      ?.getAttribute('aria-label');

    // Catches: um label tipo "Post em X". Pressable colapsa os filhos num no
    // so, entao o que nao estiver no label nao existe para leitor de tela.
    expect(label).toContain('que encontro bom');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/inicio/sections/__tests__/CommunityFeedSection.test.tsx`
Expected: FAIL, módulo `../CommunityFeedSection` não existe.

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
 * exceção. A foto, quando existe, vira fundo sob o mesmo degradê de três
 * paradas do HeroSection: p.scrimBottom sozinho é 86% de preto chapado e
 * apagaria a foto que ele deveria realçar.
 */

import type { HomeFeedItem } from '@ccc/shared/feed';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { p } from '~/screens/inicio/palette';

const CARD_WIDTH = 240;

export function FeedTeaserCard({ post, onPress }: { post: HomeFeedItem; onPress: () => void }) {
  const photo = post.photos[0] ?? null;
  const car = post.car;
  // Car.nickname é NOT NULL no schema; sem carro, o post é de um membro que
  // não escolheu carro na hora de postar.
  const authorLabel = car ? car.nickname : 'Membro';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // O corpo entra no label porque Pressable colapsa os filhos num nó só:
      // o que não estiver aqui não existe para leitor de tela.
      accessibilityLabel={`${post.event.title}. ${post.body}. Por ${authorLabel}`}
      accessibilityHint="Abre a página do evento"
      testID={`inicio-feed-card-${post.id}`}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {photo ? (
        <>
          <Image source={{ uri: photo.url }} style={styles.fill} accessible={false} />
          <LinearGradient
            colors={[p.scrimTop, p.scrimMid, p.scrimBottom]}
            style={styles.fill}
            pointerEvents="none"
          />
        </>
      ) : null}

      <View style={styles.content}>
        <Text style={styles.event} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {post.event.title}
        </Text>
        <Text style={styles.body} numberOfLines={3} maxFontSizeMultiplier={1.3}>
          {post.body}
        </Text>
        <View style={styles.authorRow}>
          {car?.photo ? (
            <Image source={{ uri: car.photo.url }} style={styles.avatar} accessible={false} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]} />
          )}
          <Text style={styles.author} numberOfLines={1} maxFontSizeMultiplier={1.3}>
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
    // minHeight, não height: lineHeight de StyleSheet não escala com Dynamic
    // Type, e altura fixa mais overflow hidden cortaria o texto em 150%.
    minHeight: 168,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.featureSurface,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },
  // absoluteFill, não absoluteFillObject: é o que o repo usa nos cinco call
  // sites existentes e o único que os mocks de teste expõem.
  fill: StyleSheet.absoluteFill,
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
    // Jost_400Regular NÃO existe neste app: _layout.tsx:177-180 registra só
    // Jost_300Regular (alias de Jost_300Light), 500Medium, 600SemiBold e
    // 700Bold. Um nome não registrado cai no system font sem aviso.
    fontFamily: 'Jost_500Medium',
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

Se `StyleSheet.absoluteFill` der erro de tipo dentro de `StyleSheet.create`, escreva os quatro offsets explicitamente em vez de forçar um cast.

- [ ] **Step 5: Seção**

Criar `apps/mobile/src/screens/inicio/sections/CommunityFeedSection.tsx`:

```tsx
/**
 * Seção — posts sorteados de eventos públicos.
 *
 * Some por completo quando a lista vem vazia, igual ConfirmedCarsSection. A
 * lista fica vazia com frequência por desenho: só entram eventos publicados e
 * com feedAccess 'public', e o default de Event é 'attendees'.
 *
 * Recebe `posts` por prop em vez de buscar sozinha porque as duas homes já
 * chamam o hook no topo — a do membro precisa do refresh no pull-to-refresh.
 */

import type { HomeFeedItem } from '@ccc/shared/feed';
import { ScrollView, StyleSheet, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { FeedTeaserCard } from '~/screens/inicio/components/FeedTeaserCard';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';

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
          <FeedTeaserCard key={post.id} post={post} onPress={() => onOpenEvent(post.event.slug)} />
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

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/inicio/sections/__tests__/CommunityFeedSection.test.tsx`
Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS nos 4 testes.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/inicio apps/mobile/src/copy/inicio.ts
git commit -m "feat(mobile): secao do feed da comunidade na Inicio"
```

---

### Task 8: Ligar a seção nas duas homes

**Files:**

- Modify: `apps/mobile/src/screens/inicio/MemberHome.tsx` — hooks em `:51-58`, `refreshing` em `:63-64`, render depois do `NextEventCard` (`:125`)
- Modify: `apps/mobile/src/screens/inicio/GuestHome.tsx` — hooks em `:58-60`, render depois do `HighlightsSection`
- Modify: `apps/mobile/src/screens/inicio/__tests__/MemberHome.test.tsx` e `GuestHome.test.tsx`

**Interfaces:**

- Consumes: `useHomeFeed` da Task 6, `CommunityFeedSection` da Task 7.
- Produces: nada que outra task use.

- [ ] **Step 1: Mockar o hook novo nos testes existentes**

Isto vem primeiro e é obrigatório. `MemberHome.test.tsx:201-205` documenta que os hooks reais puxam `~/api/client` → `expo-constants`, que lança `__DEV__ is not defined` sob jsdom. Sem mockar `~/hooks/useHomeFeed`, TODOS os testes existentes dessas duas telas quebram no instante em que a seção for ligada.

O idiom dos dois arquivos é `vi.hoisted` com um objeto de estado por hook e uma factory que lê esse objeto:

```ts
const homeFeedState = vi.hoisted(() => ({
  value: { posts: [] as unknown[], loading: false, refresh: async () => {} },
}));
vi.mock('~/hooks/useHomeFeed', () => ({ useHomeFeed: () => homeFeedState.value }));
```

Abra `MemberHome.test.tsx:190-231` e `GuestHome.test.tsx:124-167` e encaixe no formato exato de cada um. Resete `homeFeedState.value` no `beforeEach`, junto dos outros.

- [ ] **Step 2: Escrever o teste que falha**

Em cada um dos dois arquivos. Use a função de render que o arquivo já tem — `renderMemberHome()` em `MemberHome.test.tsx:438` e `render()` SEM argumentos em `GuestHome.test.tsx:301` — e asserção por `container.textContent`:

```tsx
it('renderiza o feed da comunidade quando ha posts', async () => {
  homeFeedState.value = {
    posts: [
      {
        id: 'p1',
        eventId: 'e1',
        car: null,
        body: 'que encontro bom',
        status: 'visible',
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
    refresh: async () => {},
  };

  await renderMemberHome();

  expect(container.textContent).toContain('que encontro bom');
});
```

No `GuestHome.test.tsx`, trocar `renderMemberHome()` por `render()`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/inicio/__tests__/MemberHome.test.tsx src/screens/inicio/__tests__/GuestHome.test.tsx`
Expected: FAIL nos dois testes novos; os existentes continuam passando.

- [ ] **Step 4: MemberHome**

Em `apps/mobile/src/screens/inicio/MemberHome.tsx`:

1. Imports:

```ts
import { useHomeFeed } from '~/hooks/useHomeFeed';
import { CommunityFeedSection } from '~/screens/inicio/sections/CommunityFeedSection';
```

2. Junto dos outros hooks:

```ts
const { posts: feedPosts, loading: feedLoading, refresh: refreshFeed } = useHomeFeed();
```

3. Somar ao `refreshing` (`:63-64`), que hoje é a disjunção dos cinco loadings da fase 1:

```ts
const refreshing =
  profile.loading ||
  nextEvent.loading ||
  tickets.loading ||
  garage.loading ||
  premium.loading ||
  feedLoading;
```

Sem isso o spinner some antes do feed voltar, e o carrossel troca de conteúdo sozinho com a tela já parecendo pronta.

4. No `refreshControl`, trocar `onRefresh={() => void refreshAll()}` por:

```tsx
            onRefresh={() => void Promise.all([refreshAll(), refreshFeed()])}
```

5. Logo depois do `<NextEventCard ... />`:

```tsx
<CommunityFeedSection
  posts={feedPosts}
  onOpenEvent={(slug) =>
    router.push({ pathname: '/events/[slug]', params: { slug, focus: 'feed' } } as never)
  }
/>
```

A forma-objeto com `as never` é o idiom de `app/(app)/events/[slug].tsx:157-160`. `MemberHome.tsx:125` usa template string sem cast, mas aquela forma não carrega params extras.

- [ ] **Step 5: GuestHome**

Em `apps/mobile/src/screens/inicio/GuestHome.tsx`:

1. Mesmos dois imports.
2. Junto de `useHomeContent`:

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

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/inicio/`
Run: `pnpm --filter @ccc/mobile typecheck`
Expected: PASS, incluindo todos os testes que já existiam.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/inicio
git commit -m "feat(mobile): feed da comunidade nas duas homes"
```

---

### Task 9: Scroll até o feed na página do evento

**Files:**

- Modify: `apps/mobile/app/(app)/events/[slug].tsx` — params em `:44-47`, `ScrollView` em `:215`, bloco do feed em `:348-362`

**Interfaces:**

- Consumes: o param `focus: 'feed'` que a Task 8 passa no push.
- Produces: nada.

- [ ] **Step 1: Ler o param**

A desestruturação atual (`:44-47`) é `{ slug, tierId: requestedTierId }`. Trocar por:

```ts
const {
  slug,
  tierId: requestedTierId,
  focus,
} = useLocalSearchParams<{
  slug: string;
  tierId?: string;
  // string | string[]: useLocalSearchParams devolve array para param
  // repetido, e na web ?focus=a&focus=b faria um `focus !== 'feed'` puro
  // passar sempre.
  focus?: string | string[];
}>();
```

- [ ] **Step 2: Ref e estado**

Junto dos outros hooks do componente:

```ts
const scrollRef = useRef<ScrollView>(null);
// Guarda de disparo único, latcheada DENTRO do timer (ver Step 3).
const didFocusFeedRef = useRef(false);
// Estado, não só ref: o onLayout do bloco do feed chega depois do primeiro
// render, e um ref puro não acordaria o efeito.
const [feedPosition, setFeedPosition] = useState<number | null>(null);
```

Acrescentar `useRef` ao import de `react` no topo.

- [ ] **Step 3: Efeito de scroll**

Depois dos efeitos de carregamento existentes:

```ts
useEffect(() => {
  if (focus !== 'feed' || didFocusFeedRef.current) return;
  if (feedPosition === null || !event) return;

  const timer = setTimeout(() => {
    // Latchear AQUI, e não antes do setTimeout. `event` é
    // `commerceEvent ?? publicEvent` (linha 101) e getEventCommerce resolve
    // numa request separada de getEvent: latchear antes faz o cleanup deste
    // efeito cancelar o timer enquanto a guarda já bloqueia a reexecução, e
    // o scroll nunca acontece. Latcheando dentro, reagendar com o y mais
    // novo vira o comportamento em vez do bug.
    didFocusFeedRef.current = true;
    scrollRef.current?.scrollTo({ y: feedPosition, animated: true });
  }, 50);

  return () => clearTimeout(timer);
}, [focus, event, feedPosition]);
```

O `y` do `onLayout` é relativo ao content container do `ScrollView`, a mesma origem de `scrollTo`: o bloco do feed é filho direto dele e `styles.container` não tem `paddingTop`. O atraso de 50ms existe porque no Android o `onLayout` chega antes de o `ScrollView` conhecer a altura total e o `scrollTo` é engolido.

- [ ] **Step 4: Envolver o bloco do feed e dar ref ao ScrollView**

No `<ScrollView>` da linha 215, acrescentar `ref={scrollRef}`.

Trocar o bloco `{event.feedEnabled ? (...) : null}` (`:348-362`) por:

```tsx
{
  event.feedEnabled ? (
    <View onLayout={(e) => setFeedPosition(e.nativeEvent.layout.y)}>
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
  ) : null;
}
```

- [ ] **Step 5: Verificar**

Run: `pnpm --filter @ccc/mobile typecheck`
Run: `pnpm --filter @ccc/mobile exec eslint app src`
Run: `pnpm --filter @ccc/mobile exec vitest run`
Expected: PASS, sem warning novo.

Verificação manual, obrigatória antes do commit — nenhum teste automatizado cobre este passo:

1. `pnpm --filter @ccc/mobile start:web`
2. No admin, marcar um evento publicado como `feedAccess: 'public'`.
3. Criar um post nesse evento.
4. Abrir a Início e tocar no card.
5. A página do evento tem que abrir já rolada até o feed, com a lista de tiers já carregada acima.

Se o scroll parar no meio da descrição, é o conteúdo acima (`ConfirmedCarsSection` em `:289-298` e a lista de tiers em `:300-331`) ainda crescendo depois do timer. Reporte antes de aumentar o timeout às cegas.

Registrar no corpo do commit o que foi observado.

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile/app/(app)/events/[slug].tsx"
git commit -m "feat(mobile): rola ate o feed ao abrir evento pela Inicio"
```

---

### Task 10: Atualizar os documentos de privacidade

Não é burocracia opcional. A rota nova muda quem recebe UGC do feed, e os dois documentos hoje descrevem outra coisa.

**Files:**

- Modify: `docs/ropa.md` (linha COMM-01)
- Modify: `LGPD_scan.md` (a linha que descreve o feed, hoje `:134`)

- [ ] **Step 1: ROPA**

Em `docs/ropa.md`, COMM-01, a coluna de medidas de segurança diz "Controle de acesso por evento, soft moderation". A rota `/api/home-feed` não passa por `checkFeedReadAccess`. Atualizar para registrar:

- que existe uma superfície pública cross-evento, restrita a eventos publicados com `feedAccess: 'public'`;
- que a categoria de destinatário passa a incluir público anônimo, não só usuários do app;
- que posts de conta eliminada ficam de fora dessa superfície.

- [ ] **Step 2: LGPD_scan**

Em `LGPD_scan.md`, na descrição do feed, acrescentar a rota nova e o fato de que ela filtra por `feedAccess: 'public'` + `status: 'published'` em vez de `checkFeedReadAccess`.

- [ ] **Step 3: Commit**

```bash
git add docs/ropa.md LGPD_scan.md
git commit -m "docs(lgpd): registra a superficie publica do feed da Inicio"
```

---

### Task 11: Verificação final

- [ ] **Step 1: Suíte da API inteira**

Run: `pnpm --filter @ccc/api exec vitest run`
Expected: PASS. Leva ~13 min. Por inteiro porque a Task 3 mexeu num serializador que os handlers de post, comentário e moderação compartilham.

- [ ] **Step 2: Suítes de admin e mobile**

Run: `pnpm --filter @ccc/admin exec vitest run`
Run: `pnpm --filter @ccc/mobile exec vitest run`

- [ ] **Step 3: Lint contra o baseline da Task 0**

Run: `pnpm --filter @ccc/api exec eslint src`
Run: `pnpm --filter @ccc/admin exec eslint app src`
Run: `pnpm --filter @ccc/mobile exec eslint app src`

Comparar com os números anotados na Task 0 Step 5. Julgar por ter ADICIONADO warning ou error, nunca por um valor absoluto.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ccc/shared --filter @ccc/db --filter @ccc/api --filter @ccc/admin --filter @ccc/mobile typecheck`

- [ ] **Step 5: PR**

```bash
git push -u origin worktree-home-community-feed
gh pr create --base main --title "feat: feed da comunidade na Inicio" --body "<corpo>"
```

Contra `main`, nunca contra `production`. O corpo precisa dizer:

- a seção nasce vazia até alguém marcar eventos publicados como `feedAccess: 'public'`;
- **ordem de deploy**: a API (Railway) antes do admin (Vercel). `adminHomeContentSchema` ganha `feedPostCount` com `.default(5)` justamente para o caso inverso não quebrar a página de configurações, mas a ordem certa evita o assunto;
- o que foi observado na verificação manual da Task 9;
- os achados deixados fora de escopo, listados no spec.

---

## Achados pré-existentes, fora do escopo deste plano

Não corrigir aqui. Abrir issue separada.

1. `DELETE /events/:eventId/feed/:postId/reactions` não existe na API. `apps/mobile/src/api/feed.ts:74` chama, `EventFeedSection.tsx:156` engole o 404, e o estado local já decrementou.
2. Upload de foto no composer do mobile está morto. A API aceita `photoObjectKeys`, nenhum call site do mobile envia.
3. `trustProxy` desligado em `apps/api/src/app.ts:98` torna todo rate limit por IP um balde global atrás do Railway. Afeta `/api/home-content`, `/api/premium-catalog` e agora `/api/home-feed`.
4. `apps/api/src/routes/admin/events.ts:188` audita `event.update` só por nome de campo. Virar um evento para `feedAccess: 'public'` é a alavanca que de fato publica o feed, e a trilha não guarda o valor anterior.
5. Pool global de 50: um evento com muito movimento pode ocupar o pool inteiro e esconder os demais eventos públicos até o movimento passar.
