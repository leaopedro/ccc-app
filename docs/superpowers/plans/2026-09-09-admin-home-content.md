# Admin do conteúdo institucional da Início — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao admin uma tela para editar os quatro textos institucionais da tela de Início e trocar as duas imagens, com escrita auditada e validada.

**Architecture:** Nenhuma migration: `HomeContent` já é um singleton no Postgres servido pelo endpoint público `GET /api/home-content`. Este plano adiciona três rotas admin (`GET`/`PUT` do conteúdo, `POST` do presign), um `UploadKind` interno `home_media` que não é alcançável pelo presign público, e uma aba nova em `/configuracoes` no Next.js do admin. A escrita é diff-only, protegida por precondição de `updatedAt`, e recusa object key cujo prefixo não seja `home-media/`.

**Tech Stack:** Fastify + Prisma + Zod na API, Next.js App Router (Server Components + server actions) no admin, Vitest nos dois, Testcontainers com Postgres real nos testes de API.

**Spec:** `docs/superpowers/specs/2026-09-09-admin-home-content-design.md`

## Global Constraints

- PT-BR é a língua primária de toda copy visível. Sem em-dash.
- Testes de integração da API batem em Postgres real. Nunca mock de banco.
- **Docker precisa estar rodando** antes de qualquer teste de API: `test/global-setup.ts` sobe Postgres via Testcontainers para a suíte inteira.
- **Rodar um arquivo de teste da API:** `cd apps/api && pnpm exec vitest run test/<caminho>`. NÃO use `pnpm --filter @ccc/api test -- <arquivo>`: o `--` não filtra, roda os ~2253 testes (~13 min) e enterra o resultado.
- **Em worktree novo, buildar os pacotes antes:** `pnpm --filter @ccc/db --filter @ccc/shared --filter @ccc/design build`. Sem isso ~20 arquivos falham com `Failed to resolve entry for package "@ccc/db"`.
- Lint por pacote, nunca na raiz (`eslint` na raiz estoura memória). Baseline de `apps/api`: 79 warnings, 0 errors. Julgue o diff por não aumentar nenhum dos dois.
- Em worktree os git hooks não instalam, então rode `pnpm exec prettier --write` nos arquivos alterados antes de commitar.
- Branch: partir de `main` atualizado. Nunca commitar em `production`.
- Zod 3.23. `z.preprocess(...).optional()` curto-circuita em `undefined` antes do preprocess rodar.
- Limites que espelham `packages/db/prisma/schema.prisma:2083-2088`: `heroSubtitle` 200, `institutionalTitle` 120, `institutionalBody` 1000, object keys 300. `heroTitle` é a exceção deliberada: coluna 120, Zod 70, porque o hero é caixa de 210px com `overflow: hidden`.

## File Structure

**Criar:**

- `packages/shared/src/admin-home.ts` — schemas de leitura, update e presign do admin. Separado de `home.ts` porque aquele módulo se declara "Client-facing ONLY (…) o cliente nunca vê chave de objeto" e o admin precisa das keys.
- `packages/shared/src/__tests__/admin-home.test.ts`
- `apps/api/src/routes/admin/home-content.ts` — as três rotas.
- `apps/api/test/admin/home-content.test.ts`
- `apps/admin/app/(authed)/configuracoes/layout.tsx` — abas e gate de staff.
- `apps/admin/app/(authed)/configuracoes/settings-tabs.tsx`
- `apps/admin/app/(authed)/configuracoes/home/page.tsx`
- `apps/admin/app/(authed)/configuracoes/home-content-form.tsx`
- `apps/admin/app/(authed)/configuracoes/home-content-form.interaction.test.tsx`
- `apps/admin/src/components/home-image-uploader.tsx`
- `apps/admin/src/lib/home-content-actions.ts`

**Modificar:**

- `packages/shared/package.json` — entrada `./admin-home` no mapa de exports.
- `packages/shared/src/admin.ts` — `'home_content.update'` e `'home_content'` nas duas uniões.
- `apps/api/src/services/admin-audit.ts:8-36` — `'home_content'` em `RecordAuditInput['entityType']`.
- `apps/api/src/services/uploads/types.ts` — `home_media` no union e no `UPLOAD_KIND_PATH_PREFIX`.
- `apps/api/src/routes/admin/index.ts:69` — registrar `adminHomeContentRoutes`.
- `apps/admin/src/components/authed-nav.tsx:11-22` — link para `/configuracoes`.
- `apps/admin/src/components/authed-nav.test.tsx`
- `apps/admin/src/lib/admin-api.ts` — dois wrappers.
- `apps/admin/app/(authed)/configuracoes/page.tsx:10-22` — remover o gate de staff, que sobe para o layout.

**Não tocar:** `apps/admin/src/components/box-image-uploader.tsx` e seus seis call sites. A versão anterior do spec mandava extrair; foi revertido porque o componente não tem teste nenhum e as duas necessidades divergem (box é FormData com input hidden, home é action de objeto tipado com callback).

---

### Task 1: Schemas compartilhados

**Files:**

- Create: `packages/shared/src/admin-home.ts`
- Create: `packages/shared/src/__tests__/admin-home.test.ts`
- Modify: `packages/shared/package.json` (mapa `exports`)

**Interfaces:**

- Consumes: `HOME_CONTENT_SINGLETON_ID` de `./home.js`; `ALLOWED_IMAGE_TYPES`, `MAX_UPLOAD_BYTES` de `./uploads.js`.
- Produces: `adminHomeContentSchema` / `AdminHomeContent`, `homeContentUpdateSchema` / `HomeContentUpdate`, `adminHomeImagePresignRequestSchema`, `HERO_TITLE_MAX`, `HOME_MEDIA_OBJECT_KEY_PREFIX`.

- [ ] **Step 1: Escrever o teste que falha**

`packages/shared/src/__tests__/admin-home.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { HERO_TITLE_MAX, homeContentUpdateSchema } from '../admin-home.js';

const base = { expectedUpdatedAt: '2026-01-01T00:00:00.000Z' };

describe('homeContentUpdateSchema', () => {
  it('coage string vazia para null nos campos opcionais', () => {
    const parsed = homeContentUpdateSchema.parse({
      ...base,
      heroSubtitle: '',
      heroBannerObjectKey: '',
      institutionalImageObjectKey: '   ',
    });
    expect(parsed.heroSubtitle).toBeNull();
    expect(parsed.heroBannerObjectKey).toBeNull();
    expect(parsed.institutionalImageObjectKey).toBeNull();
  });

  it('aceita null explicito', () => {
    const parsed = homeContentUpdateSchema.parse({ ...base, heroSubtitle: null });
    expect(parsed.heroSubtitle).toBeNull();
  });

  it('trima os campos obrigatorios e recusa branco', () => {
    const parsed = homeContentUpdateSchema.parse({ ...base, heroTitle: '  MOTE  ' });
    expect(parsed.heroTitle).toBe('MOTE');
    expect(() => homeContentUpdateSchema.parse({ ...base, heroTitle: '   ' })).toThrow();
  });

  it('limita heroTitle ao que cabe no hero, nao ao tamanho da coluna', () => {
    expect(HERO_TITLE_MAX).toBe(70);
    expect(() => homeContentUpdateSchema.parse({ ...base, heroTitle: 'a'.repeat(71) })).toThrow();
    expect(() =>
      homeContentUpdateSchema.parse({ ...base, institutionalBody: 'a'.repeat(1001) }),
    ).toThrow();
  });

  it('exige expectedUpdatedAt', () => {
    expect(() => homeContentUpdateSchema.parse({ heroTitle: 'X' })).toThrow();
  });

  it('deixa campos ausentes como undefined', () => {
    const parsed = homeContentUpdateSchema.parse(base);
    expect(parsed.heroTitle).toBeUndefined();
    expect(parsed.heroSubtitle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/admin-home.test.ts`
Expected: FAIL — `Cannot find module '../admin-home.js'`.

- [ ] **Step 3: Implementar**

`packages/shared/src/admin-home.ts`:

```ts
// Schemas do admin para HomeContent. Mora fora de ./home.ts de proposito:
// aquele modulo se declara client-facing e promete que o cliente nunca ve
// chave de objeto, e o form do admin precisa justamente das keys para
// reenviar no save. Mesmo precedente de ./admin-box.ts.

import { z } from 'zod';

import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from './uploads.js';

/**
 * Cap do mote. A coluna aceita 120, mas o hero e uma caixa fixa de 210px com
 * overflow hidden (apps/mobile/src/screens/inicio/sections/HeroSection.tsx),
 * mote em 29/30 com ~306px uteis: acima de ~70 caracteres o topo do texto e
 * cortado sem aviso. A coluna fica em 120 para nao exigir migration se a
 * decisao mudar.
 */
export const HERO_TITLE_MAX = 70;

/** Prefixo R2 das imagens da home. Espelha UPLOAD_KIND_PATH_PREFIX.home_media. */
export const HOME_MEDIA_OBJECT_KEY_PREFIX = 'home-media';

/**
 * Campos nulaveis coagem vazio para null: o input do form entrega '' e nunca
 * null, entao um .min(1).nullable() puro tornaria o botao Remover inalcancavel.
 * Mesmo idiom do optionalText de ./admin.ts, redeclarado local porque la ele
 * nao e exportado.
 */
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().min(1).max(max).nullable(),
  );

export const adminHomeContentSchema = z.object({
  heroTitle: z.string().min(1),
  heroSubtitle: z.string().nullable(),
  heroBannerObjectKey: z.string().nullable(),
  heroBannerUrl: z.string().url().nullable(),
  institutionalTitle: z.string().min(1),
  institutionalBody: z.string().min(1),
  institutionalImageObjectKey: z.string().nullable(),
  institutionalImageUrl: z.string().url().nullable(),
  updatedAt: z.string().datetime(),
});
export type AdminHomeContent = z.infer<typeof adminHomeContentSchema>;

export const homeContentUpdateSchema = z.object({
  // Precondicao de escrita, nao conteudo. O cliente devolve o updatedAt que
  // leu; o handler responde 409 se a linha mudou nesse meio tempo.
  expectedUpdatedAt: z.string().datetime(),
  heroTitle: z.string().trim().min(1).max(HERO_TITLE_MAX).optional(),
  heroSubtitle: optionalText(200).optional(),
  heroBannerObjectKey: optionalText(300).optional(),
  institutionalTitle: z.string().trim().min(1).max(120).optional(),
  institutionalBody: z.string().trim().min(1).max(1000).optional(),
  institutionalImageObjectKey: optionalText(300).optional(),
});
export type HomeContentUpdate = z.infer<typeof homeContentUpdateSchema>;

export const adminHomeImagePresignRequestSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type AdminHomeImagePresignRequest = z.infer<typeof adminHomeImagePresignRequestSchema>;
```

- [ ] **Step 4: Registrar o subpath export**

Em `packages/shared/package.json`, no objeto `exports`, logo abaixo da entrada `"./admin-box"`:

```json
    "./admin-home": {
      "types": "./src/admin-home.ts",
      "default": "./dist/admin-home.js"
    },
```

Não adicionar a `src/index.ts`: schemas de admin não têm por que entrar no barrel que o mobile importa.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/admin-home.test.ts`
Expected: PASS, 6 testes.

Run: `cd packages/shared && pnpm typecheck && pnpm lint`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/shared/src/admin-home.ts packages/shared/src/__tests__/admin-home.test.ts packages/shared/package.json
git add packages/shared/src/admin-home.ts packages/shared/src/__tests__/admin-home.test.ts packages/shared/package.json
git commit -m "feat(shared): schemas de admin do conteudo da home"
```

---

### Task 2: GET /admin/home/content

**Files:**

- Create: `apps/api/src/routes/admin/home-content.ts`
- Create: `apps/api/test/admin/home-content.test.ts`
- Modify: `apps/api/src/routes/admin/index.ts:69`

**Interfaces:**

- Consumes: `adminHomeContentSchema` (Task 1); `ensureHomeContent` de `../../services/home-content.js`; `app.uploads.buildPublicUrl`.
- Produces: `adminHomeContentRoutes: FastifyPluginAsync`, e a função local `serializeAdminHomeContent(app, row)` que as Tasks 3 e 5 reusam.

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/test/admin/home-content.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { adminHomeContentSchema } from '@ccc/shared/admin-home';
import { HOME_CONTENT_SINGLETON_ID } from '@ccc/shared/home';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, resetDatabase, makeApp } from '../helpers.js';

describe('admin home content', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.homeContent.deleteMany();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const organizer = async () =>
    (await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' })).user;

  it('GET cria a linha com os defaults quando ainda nao existe', async () => {
    const user = await organizer();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/home/content',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminHomeContentSchema.parse(res.json());
    expect(body.heroTitle).toBe('DIRIGIR. CONECTAR. PERTENCER.');
    expect(body.heroBannerObjectKey).toBeNull();
    expect(body.heroBannerUrl).toBeNull();
  });

  it('GET resolve a URL publica a partir da object key', async () => {
    await prisma.homeContent.create({
      data: {
        id: HOME_CONTENT_SINGLETON_ID,
        heroBannerObjectKey: 'home-media/seed/banner.jpg',
      },
    });
    const user = await organizer();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/home/content',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    const body = adminHomeContentSchema.parse(res.json());
    expect(body.heroBannerObjectKey).toBe('home-media/seed/banner.jpg');
    expect(body.heroBannerUrl).toContain('home-media/seed/banner.jpg');
  });

  it('rejeita staff, user comum e request sem auth', async () => {
    const { user: staff } = await createUser({
      email: 'staff@jdm.test',
      verified: true,
      role: 'staff',
    });
    const { user: member } = await createUser({ email: 'member@jdm.test', verified: true });

    const anon = await app.inject({ method: 'GET', url: '/admin/home/content' });
    expect(anon.statusCode).toBe(401);

    for (const [id, role] of [
      [staff.id, 'staff'],
      [member.id, 'user'],
    ] as const) {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/home/content',
        headers: { authorization: bearer(loadEnv(), id, role) },
      });
      expect(res.statusCode).toBe(403);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts`
Expected: FAIL — 404 nas rotas (`/admin/home/content` não existe).

- [ ] **Step 3: Implementar a rota**

`apps/api/src/routes/admin/home-content.ts`:

```ts
/**
 * home-content admin — escrita do conteudo institucional da tela de Inicio.
 *
 *   GET  /admin/home/content
 *   PUT  /admin/home/content
 *   POST /admin/home/images/presign
 *
 * Registrado no bloco requireRole('organizer','admin') de ./index.ts, o mesmo
 * de general-settings. Staff e rejeitado la.
 */

import { prisma } from '@ccc/db';
import type { HomeContent as DbHomeContent } from '@prisma/client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { ensureHomeContent } from '../../services/home-content.js';

const serializeAdminHomeContent = (app: FastifyInstance, row: DbHomeContent) => {
  const mediaUrl = (key: string | null): string | null =>
    key ? app.uploads.buildPublicUrl(key) : null;
  return {
    heroTitle: row.heroTitle,
    heroSubtitle: row.heroSubtitle,
    heroBannerObjectKey: row.heroBannerObjectKey,
    heroBannerUrl: mediaUrl(row.heroBannerObjectKey),
    institutionalTitle: row.institutionalTitle,
    institutionalBody: row.institutionalBody,
    institutionalImageObjectKey: row.institutionalImageObjectKey,
    institutionalImageUrl: mediaUrl(row.institutionalImageObjectKey),
    updatedAt: row.updatedAt.toISOString(),
  };
};

// eslint-disable-next-line @typescript-eslint/require-await
export const adminHomeContentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/home/content', async () => {
    const row = await ensureHomeContent();
    return serializeAdminHomeContent(app, row);
  });
};
```

- [ ] **Step 4: Registrar**

Em `apps/api/src/routes/admin/index.ts`, importar junto dos outros:

```ts
import { adminHomeContentRoutes } from './home-content.js';
```

e registrar dentro do bloco `requireRole('organizer', 'admin')`, na linha seguinte a `await scope.register(adminGeneralSettingsRoutes);`:

```ts
await scope.register(adminHomeContentRoutes);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/api/src/routes/admin/home-content.ts apps/api/src/routes/admin/index.ts apps/api/test/admin/home-content.test.ts
git add apps/api/src/routes/admin/home-content.ts apps/api/src/routes/admin/index.ts apps/api/test/admin/home-content.test.ts
git commit -m "feat(api): GET /admin/home/content"
```

---

### Task 3: UploadKind home_media e uniões de auditoria

**Files:**

- Modify: `apps/api/src/services/uploads/types.ts`
- Modify: `packages/shared/src/admin.ts:23` e `:130`
- Modify: `apps/api/src/services/admin-audit.ts:8-36`

**Interfaces:**

- Produces: `'home_media'` como `UploadKind` válido com prefixo `home-media`, habilitando `app.uploads.isKindKey(key, 'home_media')` e `presignPut({ kind: 'home_media', ... })`; `'home_content.update'` como `AdminAuditAction`; `'home_content'` como `entityType` aceito por `recordAudit`.

Esta task é preparação de tipo para as Tasks 4 e 5. Não tem teste próprio: nenhuma das três mudanças tem comportamento observável até haver uma rota que as use. Os testes que as cobrem estão nas Tasks 4 e 5.

- [ ] **Step 1: Adicionar o kind**

Em `apps/api/src/services/uploads/types.ts`, no union `UploadKind`, depois de `'partner_module'`:

```ts
  | 'home_media'
```

e em `UPLOAD_KIND_PATH_PREFIX`, depois de `partner_module`:

```ts
  home_media: 'home-media',
```

`UPLOAD_KIND_PATH_PREFIX` é o único `Record<UploadKind, …>` exaustivo do repo, então o compilador aponta se faltar. Não adicionar a `UPLOAD_KINDS` em `packages/shared/src/uploads.ts`: aquela lista é o que `POST /uploads/presign` aceita de qualquer usuário autenticado.

- [ ] **Step 2: Adicionar a ação de auditoria**

Em `packages/shared/src/admin.ts`, dentro de `adminAuditActionSchema` (linha 23 em diante), junto das outras entradas de settings:

```ts
  'home_content.update',
```

e em `adminAuditEntityTypeSchema` (linha 130 em diante):

```ts
  'home_content',
```

Nota para quem revisar: `adminAuditEntityTypeSchema` não é referenciado por nada hoje. A união que o compilador cobra é a do passo seguinte.

- [ ] **Step 3: Adicionar o entityType que o compilador cobra**

Em `apps/api/src/services/admin-audit.ts`, no union `RecordAuditInput['entityType']`, depois de `'general_settings'`:

```ts
    | 'home_content'
```

- [ ] **Step 4: Verificar que nada quebrou**

Run: `cd packages/shared && pnpm typecheck && pnpm exec vitest run`
Expected: PASS. `packages/shared/src/__tests__/admin.test.ts` afirma sobre um subconjunto escolhido a mão de ações, então acrescentar uma não quebra.

Run: `cd apps/api && pnpm typecheck`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/api/src/services/uploads/types.ts packages/shared/src/admin.ts apps/api/src/services/admin-audit.ts
git add apps/api/src/services/uploads/types.ts packages/shared/src/admin.ts apps/api/src/services/admin-audit.ts
git commit -m "feat(api): kind home_media e auditoria de home_content"
```

---

### Task 4: PUT /admin/home/content

**Files:**

- Modify: `apps/api/src/routes/admin/home-content.ts`
- Modify: `apps/api/test/admin/home-content.test.ts`

**Interfaces:**

- Consumes: `homeContentUpdateSchema` (Task 1), `serializeAdminHomeContent` (Task 2), `'home_media'` e `'home_content'` (Task 3), `recordAudit` de `../../services/admin-audit.js`, `requireUser` de `../../plugins/auth.js`.
- Produces: `PUT /admin/home/content` respondendo `adminHomeContentSchema`, 400 em key de prefixo errado, 409 em escrita obsoleta.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar dentro do `describe` em `apps/api/test/admin/home-content.test.ts`. Adicionar o import `import { HOME_MEDIA_OBJECT_KEY_PREFIX } from '@ccc/shared/admin-home';` no topo do arquivo e este helper logo abaixo de `organizer`:

```ts
const readRow = () =>
  prisma.homeContent.findUniqueOrThrow({ where: { id: HOME_CONTENT_SINGLETON_ID } });

const put = async (userId: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'PUT',
    url: '/admin/home/content',
    headers: { authorization: bearer(loadEnv(), userId, 'organizer') },
    payload,
  });
```

e os casos:

```ts
it('PUT altera so os campos enviados', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  const res = await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    heroTitle: 'NOVO MOTE',
  });

  expect(res.statusCode).toBe(200);
  const body = adminHomeContentSchema.parse(res.json());
  expect(body.heroTitle).toBe('NOVO MOTE');
  expect(body.institutionalTitle).toBe('A Casa');
});

it('PUT identico nao escreve e nao audita', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);
  const seeded = await readRow();

  const res = await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    heroTitle: before.heroTitle,
    institutionalTitle: before.institutionalTitle,
    institutionalBody: before.institutionalBody,
  });

  expect(res.statusCode).toBe(200);
  const after = await readRow();
  // A assercao e sobre updatedAt, nao sobre contagem de auditoria: so contar
  // auditoria passa verde enquanto todo Salvar bumpa a linha, que e
  // exatamente a regressao que o diff existe para evitar.
  expect(after.updatedAt.getTime()).toBe(seeded.updatedAt.getTime());
  expect(await prisma.adminAudit.count()).toBe(0);
});

it('PUT com mudanca audita os campos tocados e o antes/depois das imagens', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    heroTitle: 'NOVO MOTE',
    heroBannerObjectKey: `${HOME_MEDIA_OBJECT_KEY_PREFIX}/${user.id}/banner.jpg`,
  });

  const audit = await prisma.adminAudit.findFirstOrThrow();
  expect(audit.action).toBe('home_content.update');
  expect(audit.entityType).toBe('home_content');
  expect(audit.entityId).toBe(HOME_CONTENT_SINGLETON_ID);
  const metadata = audit.metadata as {
    fields: string[];
    images: { heroBannerObjectKey: { previous: string | null; next: string | null } };
  };
  expect(metadata.fields).toContain('heroTitle');
  expect(metadata.images.heroBannerObjectKey).toEqual({
    previous: null,
    next: `${HOME_MEDIA_OBJECT_KEY_PREFIX}/${user.id}/banner.jpg`,
  });
});

it('PUT recusa object key de outro prefixo', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  for (const key of [
    'identity-document/someone/x.jpg',
    'feed_photo/someone/x.jpg',
    'avatar/someone/x.jpg',
  ]) {
    const res = await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      heroBannerObjectKey: key,
    });
    expect(res.statusCode).toBe(400);
  }
  expect((await readRow()).heroBannerObjectKey).toBeNull();
});

it('PUT com string vazia limpa a coluna em vez de dar 400', async () => {
  const user = await organizer();
  await prisma.homeContent.update({
    where: { id: HOME_CONTENT_SINGLETON_ID },
    data: {
      heroSubtitle: 'antigo',
      heroBannerObjectKey: `${HOME_MEDIA_OBJECT_KEY_PREFIX}/x/old.jpg`,
    },
  });
  const current = await readRow();

  const res = await put(user.id, {
    expectedUpdatedAt: current.updatedAt.toISOString(),
    heroSubtitle: '',
    heroBannerObjectKey: '',
  });

  expect(res.statusCode).toBe(200);
  const after = await readRow();
  expect(after.heroSubtitle).toBeNull();
  expect(after.heroBannerObjectKey).toBeNull();
});

it('PUT recusa titulo so com espaco e texto acima do limite', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  const blank = await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    heroTitle: '   ',
  });
  expect(blank.statusCode).toBe(400);

  const tooLong = await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    institutionalBody: 'a'.repeat(1001),
  });
  expect(tooLong.statusCode).toBe(400);
});

it('PUT com expectedUpdatedAt velho responde 409 e nao escreve', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);

  const first = await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    heroTitle: 'PRIMEIRO',
  });
  expect(first.statusCode).toBe(200);

  const stale = await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    heroTitle: 'SEGUNDO',
  });
  expect(stale.statusCode).toBe(409);
  expect((await readRow()).heroTitle).toBe('PRIMEIRO');
});

it('PUT rejeita staff', async () => {
  const { user: staff } = await createUser({
    email: 'staff2@jdm.test',
    verified: true,
    role: 'staff',
  });
  const res = await app.inject({
    method: 'PUT',
    url: '/admin/home/content',
    headers: { authorization: bearer(loadEnv(), staff.id, 'staff') },
    payload: { expectedUpdatedAt: new Date().toISOString(), heroTitle: 'X' },
  });
  expect(res.statusCode).toBe(403);
});
```

E o helper `ensureRowViaGet`, no topo do arquivo, fora do `describe`:

```ts
const ensureRowViaGet = async (app: FastifyInstance, userId: string) => {
  const res = await app.inject({
    method: 'GET',
    url: '/admin/home/content',
    headers: { authorization: bearer(loadEnv(), userId, 'organizer') },
  });
  return adminHomeContentSchema.parse(res.json());
};
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts`
Expected: FAIL — 404 no `PUT`.

- [ ] **Step 3: Implementar**

Em `apps/api/src/routes/admin/home-content.ts`, acrescentar aos imports:

```ts
import { homeContentUpdateSchema } from '@ccc/shared/admin-home';
import { HOME_CONTENT_SINGLETON_ID } from '@ccc/shared/home';
import type { Prisma } from '@prisma/client';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
```

e o handler, dentro do plugin, depois do `GET`:

```ts
// Campos de conteudo, na ordem em que aparecem no form. O diff percorre esta
// lista em vez de seis blocos repetidos.
const CONTENT_FIELDS = [
  'heroTitle',
  'heroSubtitle',
  'heroBannerObjectKey',
  'institutionalTitle',
  'institutionalBody',
  'institutionalImageObjectKey',
] as const;

const IMAGE_FIELDS = ['heroBannerObjectKey', 'institutionalImageObjectKey'] as const;

app.put('/home/content', async (request, reply) => {
  const { sub } = requireUser(request);
  const input = homeContentUpdateSchema.parse(request.body);

  // Prefixo antes de qualquer escrita. Sem isso um organizer aponta o banner
  // para feed_photo/<outro-usuario>/x.jpg e GET /api/home-content, que e
  // publico e sem auth, resolve e publica a foto. Mesma guarda de
  // box-catalog-admin.ts:52.
  for (const field of IMAGE_FIELDS) {
    const key = input[field];
    if (key && !app.uploads.isKindKey(key, 'home_media')) {
      return reply.status(400).send({ error: 'invalid_object_key', field });
    }
  }

  const existing = await ensureHomeContent();

  const data: Prisma.HomeContentUpdateManyMutationInput = {};
  const touched: string[] = [];
  for (const field of CONTENT_FIELDS) {
    const next = input[field];
    if (next !== undefined && next !== existing[field]) {
      (data as Record<string, unknown>)[field] = next;
      touched.push(field);
    }
  }

  // Nada mudou: nao bumpa updatedAt, nao audita. Sai antes da precondicao de
  // proposito, para um Salvar sem alteracao nao dar 409 por corrida alheia.
  if (touched.length === 0) {
    return serializeAdminHomeContent(app, existing);
  }

  if (existing.updatedAt.toISOString() !== input.expectedUpdatedAt) {
    return reply.status(409).send({ error: 'stale_write' });
  }

  // updateMany porque update nao aceita updatedAt no where. count === 0
  // significa que outra escrita entrou entre o read e este ponto.
  const written = await prisma.homeContent.updateMany({
    where: { id: HOME_CONTENT_SINGLETON_ID, updatedAt: existing.updatedAt },
    data,
  });
  if (written.count === 0) {
    return reply.status(409).send({ error: 'stale_write' });
  }

  const updated = await prisma.homeContent.findUniqueOrThrow({
    where: { id: HOME_CONTENT_SINGLETON_ID },
  });

  // O entityId e um singleton que o proximo save sobrescreve, entao so os
  // nomes dos campos nao respondem "quem pos aquela imagem na home e o que
  // havia antes". Texto fica de fora: institutionalBody tem 1000 chars.
  const images: Record<string, { previous: string | null; next: string | null }> = {};
  for (const field of IMAGE_FIELDS) {
    if (touched.includes(field)) {
      images[field] = { previous: existing[field], next: updated[field] };
    }
  }

  await recordAudit({
    actorId: sub,
    action: 'home_content.update',
    entityType: 'home_content',
    entityId: HOME_CONTENT_SINGLETON_ID,
    metadata: { fields: touched, images },
  });

  return serializeAdminHomeContent(app, updated);
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts`
Expected: PASS, 11 testes.

Run: `cd apps/api && pnpm typecheck && pnpm lint`
Expected: sem erro, warnings não acima de 79.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/api/src/routes/admin/home-content.ts apps/api/test/admin/home-content.test.ts
git add apps/api/src/routes/admin/home-content.ts apps/api/test/admin/home-content.test.ts
git commit -m "feat(api): PUT /admin/home/content com guarda de prefixo e preconcicao"
```

---

### Task 5: Round trip até o endpoint público

**Files:**

- Modify: `apps/api/test/admin/home-content.test.ts`

**Interfaces:**

- Consumes: `PUT /admin/home/content` (Task 4), `GET /api/home-content` (já existe).
- Produces: nada de runtime. É o teste que prova a feature inteira.

Nenhum outro teste chega a popular uma key de imagem pelo caminho real: a linha auto-criada nasce com as duas nulas, então `heroBannerUrl` poderia devolver a key crua, ou nulo, ou prefixo duplicado, e tudo passaria verde.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao mesmo `describe`:

```ts
it('edicao no admin aparece no GET publico com a URL resolvida', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);
  const key = `${HOME_MEDIA_OBJECT_KEY_PREFIX}/${user.id}/banner.jpg`;

  const saved = await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    heroTitle: 'MOTE PUBLICO',
    heroSubtitle: 'subtitulo publico',
    heroBannerObjectKey: key,
    institutionalBody: 'Corpo institucional novo.',
  });
  expect(saved.statusCode).toBe(200);

  const publicRes = await app.inject({ method: 'GET', url: '/api/home-content' });
  expect(publicRes.statusCode).toBe(200);
  const body = homeContentResponseSchema.parse(publicRes.json());
  expect(body.hero.title).toBe('MOTE PUBLICO');
  expect(body.hero.subtitle).toBe('subtitulo publico');
  expect(body.hero.bannerUrl).toContain(key);
  expect(body.institutional.body).toBe('Corpo institucional novo.');
});

it('remover a imagem no admin zera a URL no GET publico', async () => {
  const user = await organizer();
  const before = await ensureRowViaGet(app, user.id);
  const key = `${HOME_MEDIA_OBJECT_KEY_PREFIX}/${user.id}/banner.jpg`;

  const first = await put(user.id, {
    expectedUpdatedAt: before.updatedAt,
    heroBannerObjectKey: key,
  });
  const afterFirst = adminHomeContentSchema.parse(first.json());

  await put(user.id, {
    expectedUpdatedAt: afterFirst.updatedAt,
    heroBannerObjectKey: '',
  });

  const publicRes = await app.inject({ method: 'GET', url: '/api/home-content' });
  const body = homeContentResponseSchema.parse(publicRes.json());
  expect(body.hero.bannerUrl).toBeNull();
});
```

Acrescentar ao import de `@ccc/shared/home` no topo:

```ts
import { HOME_CONTENT_SINGLETON_ID, homeContentResponseSchema } from '@ccc/shared/home';
```

- [ ] **Step 2: Rodar**

Run: `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts`
Expected: PASS, 13 testes. Se `bannerUrl` falhar em `z.string().url()`, o serializer do admin ou o `buildPublicUrl` está devolvendo key crua — corrigir o serializer, não relaxar o schema.

- [ ] **Step 3: Commit**

```bash
pnpm exec prettier --write apps/api/test/admin/home-content.test.ts
git add apps/api/test/admin/home-content.test.ts
git commit -m "test(api): round trip do conteudo da home ate o endpoint publico"
```

---

### Task 6: POST /admin/home/images/presign

**Files:**

- Modify: `apps/api/src/routes/admin/home-content.ts`
- Modify: `apps/api/test/admin/home-content.test.ts`

**Interfaces:**

- Consumes: `adminHomeImagePresignRequestSchema` (Task 1), `'home_media'` (Task 3), `app.uploads.presignPut`.
- Produces: `POST /admin/home/images/presign` respondendo o mesmo shape de `presignResponseSchema` (`uploadUrl`, `objectKey`, `publicUrl`, `expiresAt` ISO, `headers`), consumido pelo uploader da Task 9.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('presign devolve o shape padrao e uma key sob home-media/', async () => {
  const user = await organizer();
  const res = await app.inject({
    method: 'POST',
    url: '/admin/home/images/presign',
    headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    payload: { contentType: 'image/jpeg', size: 1024 },
  });
  expect(res.statusCode).toBe(200);
  const body = presignResponseSchema.parse(res.json());
  expect(body.objectKey.startsWith(`${HOME_MEDIA_OBJECT_KEY_PREFIX}/`)).toBe(true);
});

it('presign ignora contentType e size invalidos', async () => {
  const user = await organizer();
  for (const payload of [
    { contentType: 'application/pdf', size: 1024 },
    { contentType: 'image/jpeg', size: 0 },
    { contentType: 'image/jpeg', size: 10 * 1024 * 1024 + 1 },
  ]) {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/home/images/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload,
    });
    expect(res.statusCode).toBe(400);
  }
});

it('presign nao divide quota entre dois usuarios no mesmo IP', async () => {
  const a = await organizer();
  const { user: b } = await createUser({
    email: 'org2@jdm.test',
    verified: true,
    role: 'organizer',
  });

  const call = (id: string) =>
    app.inject({
      method: 'POST',
      url: '/admin/home/images/presign',
      headers: { authorization: bearer(loadEnv(), id, 'organizer') },
      payload: { contentType: 'image/jpeg', size: 1024 },
    });

  // Esgota a cota de A.
  for (let i = 0; i < 10; i++) await call(a.id);
  const exhausted = await call(a.id);
  expect(exhausted.statusCode).toBe(429);

  // B, mesmo IP, ainda passa. E isto que prova o hook: 'preHandler'; sem ele
  // o keyGenerator roda antes de request.user existir e cai para balde por IP.
  const other = await call(b.id);
  expect(other.statusCode).toBe(200);
});
```

Acrescentar ao topo: `import { presignResponseSchema } from '@ccc/shared/uploads';`

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts`
Expected: FAIL — 404 no presign.

- [ ] **Step 3: Implementar**

Acrescentar aos imports de `apps/api/src/routes/admin/home-content.ts`:

```ts
import rateLimit from '@fastify/rate-limit';
import { adminHomeImagePresignRequestSchema } from '@ccc/shared/admin-home';
```

e, ao final do plugin, um register interno só para o presign:

```ts
// Bloco proprio para o limiter nao vazar para as outras rotas admin: o bloco
// compartilhado de ./index.ts registra 25 plugins. hook: 'preHandler' para o
// keyGenerator rodar DEPOIS de a auth popular request.user; sem isso o plugin
// corre em onRequest e cai para um balde compartilhado por IP.
await app.register(async (scoped) => {
  await scoped.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request) => {
      const user = request.user as { sub?: string } | undefined;
      return user?.sub ? `home-media-presign:${user.sub}` : `home-media-presign-ip:${request.ip}`;
    },
  });

  scoped.post('/home/images/presign', async (request) => {
    const { sub } = requireUser(request);
    const { contentType, size } = adminHomeImagePresignRequestSchema.parse(request.body);

    // kind injetado aqui, nunca vindo do body: o cliente nao pode repontar o
    // presign para outra categoria de upload.
    const result = await app.uploads.presignPut({
      kind: 'home_media',
      userId: sub,
      contentType,
      size,
    });

    return {
      uploadUrl: result.uploadUrl,
      objectKey: result.objectKey,
      publicUrl: result.publicUrl,
      expiresAt: result.expiresAt.toISOString(),
      headers: result.headers,
    };
  });
});
```

Trocar a assinatura do plugin de `// eslint-disable-next-line @typescript-eslint/require-await` + `async (app)` para só `async (app)`, já que agora há `await` de verdade. Remover o comentário de eslint-disable.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts`
Expected: PASS, 16 testes.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/api/src/routes/admin/home-content.ts apps/api/test/admin/home-content.test.ts
git add apps/api/src/routes/admin/home-content.ts apps/api/test/admin/home-content.test.ts
git commit -m "feat(api): presign das imagens da home com balde por admin"
```

---

### Task 7: Menu e abas de Configurações

**Files:**

- Create: `apps/admin/app/(authed)/configuracoes/settings-tabs.tsx`
- Create: `apps/admin/app/(authed)/configuracoes/layout.tsx`
- Modify: `apps/admin/src/components/authed-nav.tsx:11-22`
- Modify: `apps/admin/src/components/authed-nav.test.tsx`
- Modify: `apps/admin/app/(authed)/configuracoes/page.tsx:10-22`

**Interfaces:**

- Produces: rota `/configuracoes` alcançável pelo menu, com barra de abas e gate de staff no layout. A Task 9 pendura `/configuracoes/home` nessas abas.

`/configuracoes` não tem link em lugar nenhum do admin hoje: um grep por `/configuracoes` em `apps/admin` não acha href. Sem este passo a aba nova fica pendurada numa rota órfã.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/admin/src/components/authed-nav.test.tsx`, no teste `renders top-level organizer nav links (groups excluded)`, acrescentar:

```tsx
expect(html).toContain('href="/configuracoes"');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/admin && pnpm exec vitest run src/components/authed-nav.test.tsx`
Expected: FAIL — o html não contém `/configuracoes`.

- [ ] **Step 3: Adicionar o link**

Em `apps/admin/src/components/authed-nav.tsx`, no fim de `ORGANIZER_LINKS`, depois de `{ href: '/check-in', label: 'Check-in' }`:

```ts
  { href: '/configuracoes', label: 'Configurações' },
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/admin && pnpm exec vitest run src/components/authed-nav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Criar as abas**

`apps/admin/app/(authed)/configuracoes/settings-tabs.tsx`, copiando a forma de `apps/admin/src/components/store-section-tabs.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/configuracoes', label: 'Gerais' },
  { href: '/configuracoes/home', label: 'Home' },
] as const;

// '/configuracoes' e prefixo de '/configuracoes/home', entao a aba Gerais so
// fica ativa em match exato.
const isActiveTab = (pathname: string, href: string) =>
  href === '/configuracoes' ? pathname === href : pathname.startsWith(href);

export const SettingsTabs = () => {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação das configurações"
      className="flex flex-wrap gap-2 border-b border-[color:var(--color-border)] pb-4"
    >
      {TABS.map((tab) => {
        const active = isActiveTab(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              active
                ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)] font-semibold text-black'
                : 'border-[color:var(--color-border)] text-[color:var(--color-muted)] hover:text-inherit',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
};
```

- [ ] **Step 6: Criar o layout com o gate**

`apps/admin/app/(authed)/configuracoes/layout.tsx`:

```tsx
import { SettingsTabs } from './settings-tabs';

import { readRole } from '~/lib/auth-session';

// O bloqueio de staff mora aqui, e nao em cada page: sob um layout, um
// "Acesso restrito" devolvido pela page apareceria embaixo da barra de abas.
export default async function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const role = await readRole();

  if (role === 'staff') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Acesso restrito</h1>
          <p className="mt-2 text-[color:var(--color-muted)]">
            Você não tem permissão para acessar esta página.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsTabs />
      {children}
    </div>
  );
}
```

- [ ] **Step 7: Tirar o gate duplicado da page**

Em `apps/admin/app/(authed)/configuracoes/page.tsx`, remover o `const role = await readRole();` e todo o bloco `if (role === 'staff') { … }`, junto do import de `readRole` que fica sem uso. O resto da page continua igual.

- [ ] **Step 8: Verificar**

Run: `cd apps/admin && pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: PASS, sem erro de tipo, sem import não usado.

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write "apps/admin/app/(authed)/configuracoes/settings-tabs.tsx" "apps/admin/app/(authed)/configuracoes/layout.tsx" "apps/admin/app/(authed)/configuracoes/page.tsx" apps/admin/src/components/authed-nav.tsx apps/admin/src/components/authed-nav.test.tsx
git add "apps/admin/app/(authed)/configuracoes" apps/admin/src/components/authed-nav.tsx apps/admin/src/components/authed-nav.test.tsx
git commit -m "feat(admin): menu e abas em configuracoes"
```

---

### Task 8: Cliente da API e server actions

**Files:**

- Modify: `apps/admin/src/lib/admin-api.ts`
- Create: `apps/admin/src/lib/home-content-actions.ts`

**Interfaces:**

- Consumes: `adminHomeContentSchema`, `homeContentUpdateSchema` (Task 1); as rotas das Tasks 2, 4 e 6.
- Produces: `fetchAdminHomeContent(): Promise<AdminHomeContent>`, `updateAdminHomeContentAction(input: HomeContentUpdate): Promise<HomeContentActionResult>`, `presignHomeImageAction(input: { contentType: string; size: number }): Promise<PresignResponse>`. A Task 9 consome os três.

- [ ] **Step 1: Wrappers em `admin-api.ts`**

Acrescentar aos imports de `@ccc/shared/...` no topo do arquivo:

```ts
import {
  adminHomeContentSchema,
  type AdminHomeContent,
  type HomeContentUpdate,
} from '@ccc/shared/admin-home';
```

e, logo abaixo de `updateAdminGeneralSettings`:

```ts
export const getAdminHomeContent = (): Promise<AdminHomeContent> =>
  apiFetch('/admin/home/content', { schema: adminHomeContentSchema });

export const updateAdminHomeContent = (input: HomeContentUpdate): Promise<AdminHomeContent> =>
  apiFetch('/admin/home/content', {
    method: 'PUT',
    body: JSON.stringify(input),
    schema: adminHomeContentSchema,
  });
```

- [ ] **Step 2: Server actions**

`apps/admin/src/lib/home-content-actions.ts`:

```ts
'use server';

import type { AdminHomeContent, HomeContentUpdate } from '@ccc/shared/admin-home';
import { presignResponseSchema } from '@ccc/shared/uploads';
import { unstable_rethrow } from 'next/navigation';

import { getAdminHomeContent, updateAdminHomeContent } from './admin-api';
import { ApiError, apiFetch } from './api';

export type HomeContentActionResult =
  | { ok: true; content: AdminHomeContent }
  | { ok: false; error: string; stale?: true };

export const fetchAdminHomeContent = async (): Promise<AdminHomeContent> => getAdminHomeContent();

export const updateAdminHomeContentAction = async (
  input: HomeContentUpdate,
): Promise<HomeContentActionResult> => {
  try {
    const content = await updateAdminHomeContent(input);
    return { ok: true, content };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return {
          ok: false,
          stale: true,
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

/**
 * Sem parametro `kind` na assinatura de proposito: o kind e injetado no
 * servidor pela rota admin, entao nem por esta action o cliente consegue
 * apontar o presign para outra categoria de upload.
 */
export const presignHomeImageAction = async (input: { contentType: string; size: number }) =>
  apiFetch('/admin/home/images/presign', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: presignResponseSchema,
  });
```

- [ ] **Step 3: Verificar**

Run: `cd apps/admin && pnpm typecheck && pnpm lint`
Expected: sem erro. Se `apiFetch` não estiver exportado de `./api`, importar de onde `box-admin-actions.ts` importa e ajustar.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write apps/admin/src/lib/admin-api.ts apps/admin/src/lib/home-content-actions.ts
git add apps/admin/src/lib/admin-api.ts apps/admin/src/lib/home-content-actions.ts
git commit -m "feat(admin): cliente e actions do conteudo da home"
```

---

### Task 9: Tela de edição

**Files:**

- Create: `apps/admin/src/components/home-image-uploader.tsx`
- Create: `apps/admin/app/(authed)/configuracoes/home-content-form.tsx`
- Create: `apps/admin/app/(authed)/configuracoes/home/page.tsx`
- Create: `apps/admin/app/(authed)/configuracoes/home-content-form.interaction.test.tsx`

**Interfaces:**

- Consumes: `fetchAdminHomeContent`, `updateAdminHomeContentAction`, `presignHomeImageAction` (Task 8); `HERO_TITLE_MAX` (Task 1).
- Produces: a rota `/configuracoes/home`.

Não reusar `box-image-uploader.tsx`: ele emite a key por `<input type="hidden">` porque box é fluxo de FormData, o label é a string fixa "Imagem", e não tem afordância de remover. Este form é action de objeto tipado e precisa de callback. Box fica intocado.

- [ ] **Step 1: Escrever o teste de interação que falha**

`apps/admin/app/(authed)/configuracoes/home-content-form.interaction.test.tsx`:

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { AdminHomeContent } from '@ccc/shared/admin-home';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateMock, presignMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  presignMock: vi.fn(),
}));

vi.mock('~/lib/home-content-actions', () => ({
  updateAdminHomeContentAction: updateMock,
  presignHomeImageAction: presignMock,
}));

import { HomeContentForm } from './home-content-form';

const initial: AdminHomeContent = {
  heroTitle: 'DIRIGIR. CONECTAR. PERTENCER.',
  heroSubtitle: null,
  heroBannerObjectKey: 'home-media/u1/banner.jpg',
  heroBannerUrl: 'http://localhost:4000/dev-uploads/home-media/u1/banner.jpg',
  institutionalTitle: 'A Casa',
  institutionalBody: 'Um clubhouse automotivo privado em Curitiba.',
  institutionalImageObjectKey: null,
  institutionalImageUrl: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const input = (label: string): HTMLInputElement =>
  container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const findAlert = (): HTMLElement | null => container.querySelector('[role="alert"]');

const clickByText = (text: string) => {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('HomeContentForm', () => {
  beforeEach(() => {
    updateMock.mockReset();
    presignMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('manda o campo editado e o expectedUpdatedAt que leu', async () => {
    updateMock.mockResolvedValue({ ok: true, content: { ...initial, heroTitle: 'NOVO' } });
    await act(async () => {
      root.render(<HomeContentForm initial={initial} />);
    });

    setValue(input('Mote do hero'), 'NOVO');
    await act(async () => {
      clickByText('Salvar');
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ heroTitle: 'NOVO', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }),
    );
  });

  it('remover imagem manda string vazia', async () => {
    updateMock.mockResolvedValue({ ok: true, content: { ...initial, heroBannerObjectKey: null } });
    await act(async () => {
      root.render(<HomeContentForm initial={initial} />);
    });

    await act(async () => {
      clickByText('Remover banner do hero');
    });
    await act(async () => {
      clickByText('Salvar');
    });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ heroBannerObjectKey: '' }));
  });

  it('mostra o erro do servidor', async () => {
    updateMock.mockResolvedValue({ ok: false, error: 'Dados inválidos.' });
    await act(async () => {
      root.render(<HomeContentForm initial={initial} />);
    });

    await act(async () => {
      clickByText('Salvar');
    });

    expect(findAlert()?.textContent).toContain('Dados inválidos.');
  });

  it('mostra a mensagem de recarregar no conflito', async () => {
    updateMock.mockResolvedValue({
      ok: false,
      stale: true,
      error: 'Alguém editou esta página enquanto você escrevia. Recarregue e refaça a alteração.',
    });
    await act(async () => {
      root.render(<HomeContentForm initial={initial} />);
    });

    await act(async () => {
      clickByText('Salvar');
    });

    expect(findAlert()?.textContent).toContain('Recarregue');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/admin && pnpm exec vitest run "app/(authed)/configuracoes/home-content-form.interaction.test.tsx"`
Expected: FAIL — `./home-content-form` não existe.

- [ ] **Step 3: Uploader**

`apps/admin/src/components/home-image-uploader.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { presignHomeImageAction } from '~/lib/home-content-actions';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export const HomeImageUploader = ({
  label,
  removeLabel,
  objectKey,
  previewUrl,
  onChange,
}: {
  label: string;
  removeLabel: string;
  objectKey: string | null;
  previewUrl: string | null;
  onChange: (next: { objectKey: string | null; previewUrl: string | null }) => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError('Formato inválido. Use JPG, PNG ou WebP.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const presign = await presignHomeImageAction({ contentType: file.type, size: file.size });
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: presign.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`PUT ${put.status}`);
      onChange({ objectKey: presign.objectKey, previewUrl: presign.publicUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-[color:var(--color-muted)]">{label}</span>
      {previewUrl ? (
        <img src={previewUrl} alt={label} className="h-24 w-auto rounded object-cover" />
      ) : null}
      <input
        type="file"
        accept="image/*"
        aria-label={label}
        disabled={busy}
        onChange={(e) => {
          void onFile(e);
        }}
      />
      {objectKey ? (
        <button
          type="button"
          className="self-start text-sm underline"
          onClick={() => onChange({ objectKey: null, previewUrl: null })}
        >
          {removeLabel}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 4: Form**

`apps/admin/app/(authed)/configuracoes/home-content-form.tsx`:

```tsx
'use client';

import { HERO_TITLE_MAX, type AdminHomeContent } from '@ccc/shared/admin-home';
import { useState, useTransition } from 'react';

import { HomeImageUploader } from '~/components/home-image-uploader';
import { updateAdminHomeContentAction } from '~/lib/home-content-actions';

const labelCls = 'flex flex-col gap-1 text-sm';
const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

type ImageState = { objectKey: string | null; previewUrl: string | null };

export const HomeContentForm = ({ initial }: { initial: AdminHomeContent }) => {
  const [content, setContent] = useState(initial);
  const [heroTitle, setHeroTitle] = useState(initial.heroTitle);
  const [heroSubtitle, setHeroSubtitle] = useState(initial.heroSubtitle ?? '');
  const [institutionalTitle, setInstitutionalTitle] = useState(initial.institutionalTitle);
  const [institutionalBody, setInstitutionalBody] = useState(initial.institutionalBody);
  const [banner, setBanner] = useState<ImageState>({
    objectKey: initial.heroBannerObjectKey,
    previewUrl: initial.heroBannerUrl,
  });
  const [institutionalImage, setInstitutionalImage] = useState<ImageState>({
    objectKey: initial.institutionalImageObjectKey,
    previewUrl: initial.institutionalImageUrl,
  });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      // String vazia, e nao null: o schema coage vazio para null no servidor, e
      // o form nunca precisa distinguir "nao mexi" de "apaguei" porque sempre
      // envia o payload inteiro. O diff do handler resolve o resto.
      const result = await updateAdminHomeContentAction({
        expectedUpdatedAt: content.updatedAt,
        heroTitle,
        heroSubtitle,
        heroBannerObjectKey: banner.objectKey ?? '',
        institutionalTitle,
        institutionalBody,
        institutionalImageObjectKey: institutionalImage.objectKey ?? '',
      });

      if (result.ok) {
        setContent(result.content);
        setBanner({
          objectKey: result.content.heroBannerObjectKey,
          previewUrl: result.content.heroBannerUrl,
        });
        setInstitutionalImage({
          objectKey: result.content.institutionalImageObjectKey,
          previewUrl: result.content.institutionalImageUrl,
        });
        setMessage({ kind: 'ok', text: 'Conteúdo salvo.' });
        return;
      }
      setMessage({ kind: 'error', text: result.error });
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Hero</h2>
        <label className={labelCls}>
          <span>
            Mote do hero ({heroTitle.length}/{HERO_TITLE_MAX})
          </span>
          <input
            className={inputCls}
            aria-label="Mote do hero"
            maxLength={HERO_TITLE_MAX}
            value={heroTitle}
            onChange={(e) => setHeroTitle(e.target.value)}
          />
        </label>
        <label className={labelCls}>
          <span>Subtítulo ({heroSubtitle.length}/200)</span>
          <input
            className={inputCls}
            aria-label="Subtítulo do hero"
            maxLength={200}
            value={heroSubtitle}
            onChange={(e) => setHeroSubtitle(e.target.value)}
          />
        </label>
        <HomeImageUploader
          label="Banner do hero"
          removeLabel="Remover banner do hero"
          objectKey={banner.objectKey}
          previewUrl={banner.previewUrl}
          onChange={setBanner}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Institucional</h2>
        <label className={labelCls}>
          <span>Título ({institutionalTitle.length}/120)</span>
          <input
            className={inputCls}
            aria-label="Título institucional"
            maxLength={120}
            value={institutionalTitle}
            onChange={(e) => setInstitutionalTitle(e.target.value)}
          />
        </label>
        <label className={labelCls}>
          <span>Texto ({institutionalBody.length}/1000)</span>
          <textarea
            className={`${inputCls} min-h-32`}
            aria-label="Texto institucional"
            maxLength={1000}
            value={institutionalBody}
            onChange={(e) => setInstitutionalBody(e.target.value)}
          />
        </label>
        <HomeImageUploader
          label="Imagem institucional"
          removeLabel="Remover imagem institucional"
          objectKey={institutionalImage.objectKey}
          previewUrl={institutionalImage.previewUrl}
          onChange={setInstitutionalImage}
        />
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

- [ ] **Step 5: Page**

`apps/admin/app/(authed)/configuracoes/home/page.tsx`:

```tsx
import { HomeContentForm } from '../home-content-form';

import { fetchAdminHomeContent } from '~/lib/home-content-actions';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesHomePage() {
  const content = await fetchAdminHomeContent();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Conteúdo da Início</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Texto e imagens da primeira tela do app. A alteração aparece no próximo carregamento da
          tela, sem publicar versão nova.
        </p>
      </header>
      <HomeContentForm initial={content} />
    </div>
  );
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd apps/admin && pnpm exec vitest run "app/(authed)/configuracoes/home-content-form.interaction.test.tsx"`
Expected: PASS, 4 testes.

Run: `cd apps/admin && pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Verificar na aplicação de verdade**

Subir a API e o admin, entrar como organizer, abrir Configurações, aba Home. Editar o mote, salvar, e conferir que `GET /api/home-content` devolve o texto novo. Subir uma imagem e conferir que a key resultante começa com `home-media/`.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write apps/admin/src/components/home-image-uploader.tsx "apps/admin/app/(authed)/configuracoes/home-content-form.tsx" "apps/admin/app/(authed)/configuracoes/home/page.tsx" "apps/admin/app/(authed)/configuracoes/home-content-form.interaction.test.tsx"
git add apps/admin/src/components/home-image-uploader.tsx "apps/admin/app/(authed)/configuracoes"
git commit -m "feat(admin): tela de edicao do conteudo da home"
```

---

## Verificação final

- [ ] `cd packages/shared && pnpm exec vitest run && pnpm typecheck && pnpm lint`
- [ ] `cd apps/api && pnpm exec vitest run test/admin/home-content.test.ts && pnpm typecheck && pnpm lint`
- [ ] `cd apps/admin && pnpm exec vitest run && pnpm typecheck && pnpm lint`
- [ ] Suíte cheia da API (~13 min) antes de abrir o PR: `cd apps/api && pnpm exec vitest run`
- [ ] PR contra `main`, nunca `production`.
