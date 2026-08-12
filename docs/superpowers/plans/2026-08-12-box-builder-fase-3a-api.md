# Box Builder — Fase 3a (API do atendente) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the attendee read/skip/history/preferences API the Fase 3 mobile builder consumes, on top of the Fase 2 runtime.

**Architecture:** Additive Fastify routes under `/me` plus small pure-ish service modules, mirroring the Fase 2 box code. No schema/migration changes: every field already exists. Shared Zod schemas in `@ccc/shared/box` grow the catalog/history/preferences contracts and enrich the box view. All box-mutating writes serialize on the existing `Garage`-row `FOR UPDATE` lock.

**Tech Stack:** Fastify + Prisma (Postgres), Zod (`@ccc/shared`), Vitest + Testcontainers (real Postgres). No new dependencies.

## Global Constraints

- Eligibility and cycle come from `PremiumMembership` (status `active`/`trialing`), via `loadEligibleMembership` in `apps/api/src/routes/box.ts`. History is the one exception: garage-scoped, auth-only.
- Every box-mutating path locks the `Garage` row first: `` await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE` `` then re-reads and re-checks status inside the transaction.
- Money is always `Int` cents. This phase reads money; it never creates or flips Orders. No Order ever becomes `paid` here.
- `autoSendOptIn` has exactly ONE write path after this phase: `PUT /me/box/preferences`. It is removed from the confirm body.
- Image URLs come from `app.uploads.buildPublicUrl(objectKey)`, `null` when the key is null (same as `apps/api/src/routes/admin/box-catalog-admin.ts:27`).
- API integration tests hit real Postgres via Testcontainers, never mocks. Test helpers: `makeApp`, `resetDatabase`, `createUser`, `bearer` from `apps/api/test/helpers.js`; `loadEnv` from `apps/api/src/env.js`.
- `@ccc/shared/box` runtime resolves to `packages/shared/dist/box.js`. After editing `packages/shared/src/box.ts`, run `pnpm -C packages/shared build` before the API can import the change.
- No em-dashes, no parenthetical asides in code comments or copy. PT-BR for any user-facing copy (none new in this phase).

## File Structure

New files:

- `apps/api/src/services/box/catalog.ts` — `buildBoxCatalog` read model (catalog + partners + soldOut).
- `apps/api/src/services/box/skip.ts` — `skipBox`, `unskipBox` (Garage lock + status guard).
- `apps/api/src/services/box/preferences.ts` — `setBoxPreferences` (Garage lock, address ownership, open-only).
- `apps/api/src/services/box/history.ts` — `listBoxHistory` (garage-scoped).
- Test files under `apps/api/test/box/` and `apps/api/test/services/box/`.

Modified files:

- `packages/shared/src/box.ts` — enrich `boxViewItemSchema`/`boxViewPartnerItemSchema` (add `imageUrl`, `included`, `dropReason`); drop `autoSendOptIn` from `boxConfirmSchema`; add `boxCatalogSchema`, `boxHistorySchema`, `boxPreferencesSchema`.
- `apps/api/src/services/box/serialize.ts` — enrich `serializeBox` (join images, emit all lines with `included`/`dropReason`, take an `Uploads`).
- `apps/api/src/routes/box.ts` — add `GET /me/box/catalog`, `POST /me/box/skip`, `POST /me/box/unskip`, `GET /me/boxes`, `PUT /me/box/preferences`; update `BOX_INCLUDE` and all `serializeBox` call sites; stop passing `autoSendOptIn` to `confirmBox`.
- `apps/api/src/services/box/confirm.ts` — drop the `autoSendOptIn` argument and its write.

---

### Task 1: Shared schemas — view enrichment + new contracts

**Files:**

- Modify: `packages/shared/src/box.ts`
- Test: `packages/shared/src/__tests__/box-fase3.test.ts` (create)

**Interfaces:**

- Produces: enriched `boxViewItemSchema` (adds `imageUrl: string | null`, `included: boolean`, `dropReason: string | null`), enriched `boxViewPartnerItemSchema` (same three), and new `boxCatalogSchema`, `boxHistorySchema`, `boxPreferencesSchema` with their inferred types `BoxCatalog`, `BoxHistory`, `BoxPreferences`. `boxConfirmSchema` is NOT changed here — its `autoSendOptIn` removal moves to Task 6, atomic with the callers.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/box-fase3.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  boxCatalogSchema,
  boxHistorySchema,
  boxPreferencesSchema,
  boxViewItemSchema,
} from '../box.js';

describe('box fase 3 schemas', () => {
  it('view item carries imageUrl, included, dropReason', () => {
    const parsed = boxViewItemSchema.parse({
      catalogItemId: 'c1',
      quantity: 2,
      unitPriceCents: 1000,
      subtotalCents: 2000,
      titleSnapshot: 'Item',
      imageUrl: null,
      included: true,
      dropReason: null,
    });
    expect(parsed.included).toBe(true);
  });

  it('preferences requires autoSendOptIn boolean, optional address', () => {
    expect(() => boxPreferencesSchema.parse({ autoSendOptIn: true })).not.toThrow();
    expect(() => boxPreferencesSchema.parse({ autoSendOptIn: 'yes' })).toThrow();
  });

  it('catalog parses categories, items, partners', () => {
    const parsed = boxCatalogSchema.parse({
      categories: ['acessorios'],
      items: [
        {
          id: 'c1',
          title: 'Item',
          category: 'acessorios',
          imageUrl: null,
          priceCents: 1000,
          maxPerCycle: null,
          soldOut: false,
        },
      ],
      partners: [
        {
          id: 'p1',
          name: 'Parceiro',
          logoUrl: null,
          description: null,
          modules: [{ id: 'm1', name: 'Mod', description: null, imageUrl: null, priceCents: 5000 }],
        },
      ],
    });
    expect(parsed.items[0].soldOut).toBe(false);
  });

  it('history is an array of cycle summaries', () => {
    const parsed = boxHistorySchema.parse([
      {
        id: 'b1',
        cycleKey: '2026-08-01',
        cycleStart: '2026-08-01T00:00:00.000Z',
        status: 'ready',
        chargeCents: 0,
        thumbnails: [],
        current: true,
      },
    ]);
    expect(parsed[0].current).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/shared exec vitest run src/__tests__/box-fase3.test.ts`
Expected: FAIL (schemas/fields not defined).

- [ ] **Step 3: Edit `packages/shared/src/box.ts`**

Add the three fields to both view-item schemas, then append the new schemas below:

```ts
export const boxViewItemSchema = z.object({
  catalogItemId: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  subtotalCents: z.number().int(),
  titleSnapshot: z.string(),
  imageUrl: z.string().nullable(),
  included: z.boolean(),
  dropReason: z.string().nullable(),
});

export const boxViewPartnerItemSchema = z.object({
  partnerModuleId: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  subtotalCents: z.number().int(),
  nameSnapshot: z.string(),
  imageUrl: z.string().nullable(),
  included: z.boolean(),
  dropReason: z.string().nullable(),
});
```

Do NOT touch `boxConfirmSchema` in this task. Dropping `autoSendOptIn` from it breaks its API callers (`box.ts` confirm route, `confirm.ts`) and the existing `box.test.ts` assertion, which are all updated atomically in Task 6. Leave `boxConfirmSchema` exactly as it is now (`{ shippingAddressId, autoSendOptIn: z.boolean().optional() }`).

Append the new schemas:

```ts
export const boxCatalogItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  imageUrl: z.string().nullable(),
  priceCents: z.number().int(),
  maxPerCycle: z.number().int().nullable(),
  soldOut: z.boolean(),
});

export const boxCatalogModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceCents: z.number().int(),
});

export const boxCatalogPartnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  description: z.string().nullable(),
  modules: z.array(boxCatalogModuleSchema),
});

export const boxCatalogSchema = z.object({
  categories: z.array(z.string()),
  items: z.array(boxCatalogItemSchema),
  partners: z.array(boxCatalogPartnerSchema),
});
export type BoxCatalog = z.infer<typeof boxCatalogSchema>;

export const boxHistoryEntrySchema = z.object({
  id: z.string(),
  cycleKey: z.string(),
  cycleStart: z.string(),
  status: boxStatusSchema,
  chargeCents: z.number().int(),
  thumbnails: z.array(z.string()),
  current: z.boolean(),
});
export const boxHistorySchema = z.array(boxHistoryEntrySchema);
export type BoxHistory = z.infer<typeof boxHistorySchema>;

export const boxPreferencesSchema = z.object({
  autoSendOptIn: z.boolean(),
  shippingAddressId: z.string().min(1).optional(),
});
export type BoxPreferences = z.infer<typeof boxPreferencesSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/shared exec vitest run src/__tests__/box-fase3.test.ts`
Expected: PASS.

- [ ] **Step 5: Build shared so the API can import it**

Run: `pnpm -C packages/shared build`
Expected: tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/box.ts packages/shared/src/__tests__/box-fase3.test.ts
git commit -m "feat(shared): box fase3 schemas (catalog/history/preferences, view enrichment)"
```

---

### Task 2: Enrich `serializeBox` — images, dropped lines, `included`

**Files:**

- Modify: `apps/api/src/services/box/serialize.ts`
- Modify: `apps/api/src/routes/box.ts` (BOX_INCLUDE + call sites)
- Test: `apps/api/test/box/box-view-enrichment.test.ts` (create)

**Interfaces:**

- Consumes: `boxViewItemSchema` fields from Task 1; `app.uploads` (`Uploads` from `../../services/uploads/types.js`).
- Produces: `serializeBox(box, uploads)` where `box` is `MonthlyBoxWithLines` now including joined `catalogItem`/`partnerModule`; returns a `BoxView` with `imageUrl`/`included`/`dropReason` on every line, and includes dropped (`included: false`) lines.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/box/box-view-enrichment.test.ts`. It sets up a box with one included item (image key set) and one dropped item, then asserts the view exposes both with the right flags. Reuse the setup shape from `apps/api/test/box/box-get.test.ts`.

```ts
import { prisma } from '@ccc/db';
import { boxViewSchema } from '@ccc/shared/box';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('GET /me/box enrichment', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('returns imageUrl, included flag, and dropped lines with reason', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const membership = await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_1',
        providerSubRef: `sub_${user.id}`,
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
        baseAmountCents: 5000,
        devFeePercent: 10,
        devFeeAmountCents: 500,
        grossAmountCents: 5500,
        currency: 'BRL',
      },
    });
    const item = await prisma.boxCatalogItem.create({
      data: {
        slug: 'x1',
        title: 'Item X',
        description: 'd',
        priceCents: 1000,
        category: 'acessorios',
        imageObjectKey: 'box_item/u/x1.jpg',
      },
    });
    const box = await prisma.monthlyBox.create({
      data: {
        membershipId: membership.id,
        garageId: garage.id,
        cycleKey: '2026-08-01',
        cycleStart: membership.currentPeriodStart,
        cycleEnd: membership.currentPeriodEnd,
        cutoffAt: new Date('2026-08-26T00:00:00.000Z'),
        budgetCentsSnapshot: 15000,
      },
    });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: item.id,
        quantity: 1,
        unitPriceCents: 1000,
        subtotalCents: 1000,
        titleSnapshot: 'Item X',
        included: true,
      },
    });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: item.id + '_dropped',
        quantity: 0,
        unitPriceCents: 2000,
        subtotalCents: 0,
        titleSnapshot: 'Dropped',
        included: false,
        dropReason: 'cutoff_budget_only',
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/box',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const view = boxViewSchema.parse(res.json());
    const included = view.items.find((i) => i.included);
    const dropped = view.items.find((i) => !i.included);
    expect(included?.imageUrl).toContain('box_item/u/x1.jpg');
    expect(dropped?.dropReason).toBe('cutoff_budget_only');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run test/box/box-view-enrichment.test.ts`
Expected: FAIL (no `imageUrl`/`included` in the view; dropped line filtered out).

- [ ] **Step 3: Rewrite `apps/api/src/services/box/serialize.ts`**

```ts
import type { BoxView } from '@ccc/shared/box';
import type { Prisma } from '@prisma/client';

import type { Uploads } from '../uploads/types.js';

export type MonthlyBoxWithLines = Prisma.MonthlyBoxGetPayload<{
  include: {
    items: { include: { catalogItem: true } };
    partnerItems: { include: { partnerModule: true } };
  };
}>;

export const serializeBox = (box: MonthlyBoxWithLines, uploads: Uploads): BoxView => ({
  id: box.id,
  status: box.status,
  cycleKey: box.cycleKey,
  cutoffAt: box.cutoffAt.toISOString(),
  budgetCents: box.budgetCentsSnapshot,
  currency: box.currency,
  itemsTotalCents: box.itemsTotalCents,
  partnersTotalCents: box.partnersTotalCents,
  overflowCents: box.overflowCents,
  shippingCents: box.shippingCents,
  chargeCents: box.chargeCents,
  autoSendOptIn: box.autoSendOptIn,
  items: box.items.map((i) => ({
    catalogItemId: i.catalogItemId,
    quantity: i.quantity,
    unitPriceCents: i.unitPriceCents,
    subtotalCents: i.subtotalCents,
    titleSnapshot: i.titleSnapshot,
    imageUrl: i.catalogItem?.imageObjectKey
      ? uploads.buildPublicUrl(i.catalogItem.imageObjectKey)
      : null,
    included: i.included,
    dropReason: i.dropReason,
  })),
  partnerItems: box.partnerItems.map((i) => ({
    partnerModuleId: i.partnerModuleId,
    quantity: i.quantity,
    unitPriceCents: i.unitPriceCents,
    subtotalCents: i.subtotalCents,
    nameSnapshot: i.nameSnapshot,
    imageUrl: i.partnerModule?.imageObjectKey
      ? uploads.buildPublicUrl(i.partnerModule.imageObjectKey)
      : null,
    included: i.included,
    dropReason: i.dropReason,
  })),
});
```

Note: a dropped line may reference a `catalogItemId` whose catalog row still exists; the join is a left join by relation, so `catalogItem` can be present or absent. The `?.` guard handles both.

- [ ] **Step 4: Update `apps/api/src/routes/box.ts`**

Change `BOX_INCLUDE` and pass `app.uploads` to every `serializeBox` call:

```ts
const BOX_INCLUDE = {
  items: { include: { catalogItem: true } },
  partnerItems: { include: { partnerModule: true } },
} as const;
```

In the GET handler: `return reply.send(serializeBox(box, app.uploads));`
In the PUT handler final read: change `include: { items: true, partnerItems: true }` to `include: BOX_INCLUDE` and `return reply.send(serializeBox(fresh, app.uploads));`
In the confirm handler final read: same include change and `serializeBox(fresh, app.uploads)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run test/box/box-view-enrichment.test.ts test/box/box-get.test.ts`
Expected: PASS. `box-get.test.ts` still green (its assertions do not touch the new fields).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm -C apps/api exec tsc --noEmit`
Expected: exits 0.

```bash
git add apps/api/src/services/box/serialize.ts apps/api/src/routes/box.ts apps/api/test/box/box-view-enrichment.test.ts
git commit -m "feat(api): enrich box view with images, included flag, dropped lines"
```

---

### Task 3: `GET /me/box/catalog`

**Files:**

- Create: `apps/api/src/services/box/catalog.ts`
- Modify: `apps/api/src/routes/box.ts`
- Test: `apps/api/test/box/box-catalog.test.ts` (create)

**Interfaces:**

- Consumes: `loadEligibleMembership` (exported from `box.ts`), `boxCatalogSchema` (Task 1), `Uploads`.
- Produces: `buildBoxCatalog(uploads, cycleKey): Promise<BoxCatalog>`.

**Cycle context:** the catalog is scoped to the member's current box cycle. The route loads the latest box for the eligible membership to get `cycleKey`; 404 `box_not_open` when there is none.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/box/box-catalog.test.ts`: an eligible member with an open box, one active item with `stockPerCycle: 2` fully reserved in the ledger (soldOut true), one active unlimited item (soldOut false), one archived item (absent), and a partner with one active module. Assert 403 without membership, and the shape/flags. Follow the setup style of `box-get.test.ts` (create garage via `createUser`, membership, box). Include a ledger row:

```ts
await prisma.boxCatalogItemCycleStock.create({
  data: { catalogItemId: soldOutItem.id, cycleKey: '2026-08-01', total: 2, reserved: 2 },
});
```

Assertions: `boxCatalogSchema.parse(res.json())`; the sold-out item has `soldOut === true`; the unlimited item `soldOut === false`; the archived item id is not present; `partners[0].modules` has length 1; `categories` contains the active items' categories.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run test/box/box-catalog.test.ts`
Expected: FAIL (route 404s / not implemented).

- [ ] **Step 3: Create `apps/api/src/services/box/catalog.ts`**

```ts
import type { BoxCatalog } from '@ccc/shared/box';
import { prisma } from '@ccc/db';

import type { Uploads } from '../uploads/types.js';

/** Read model for the attendee builder: active catalog + partners with soldOut flags. */
export const buildBoxCatalog = async (uploads: Uploads, cycleKey: string): Promise<BoxCatalog> => {
  const items = await prisma.boxCatalogItem.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  });
  const ledger = await prisma.boxCatalogItemCycleStock.findMany({ where: { cycleKey } });
  const reservedById = new Map(ledger.map((l) => [l.catalogItemId, l.reserved]));

  const catalogItems = items.map((i) => {
    const reserved = reservedById.get(i.id) ?? 0;
    // soldOut only when a finite stock exists and nothing is left. Advisory:
    // the atomic reservation at confirm/cutoff is the real gate. Read is
    // intentionally outside any transaction.
    const soldOut = i.stockPerCycle != null && i.stockPerCycle - reserved <= 0;
    return {
      id: i.id,
      title: i.title,
      category: i.category,
      imageUrl: i.imageObjectKey ? uploads.buildPublicUrl(i.imageObjectKey) : null,
      priceCents: i.priceCents,
      maxPerCycle: i.maxPerCycle,
      soldOut,
    };
  });

  const partners = await prisma.partner.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    include: { modules: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
  });

  return {
    categories: [...new Set(items.map((i) => i.category))],
    items: catalogItems,
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      logoUrl: p.logoObjectKey ? uploads.buildPublicUrl(p.logoObjectKey) : null,
      description: p.description,
      modules: p.modules.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        imageUrl: m.imageObjectKey ? uploads.buildPublicUrl(m.imageObjectKey) : null,
        priceCents: m.priceCents,
      })),
    })),
  };
};
```

- [ ] **Step 4: Add the route in `apps/api/src/routes/box.ts`**

Import `buildBoxCatalog` and add, inside `boxRoutes`:

```ts
app.get('/me/box/catalog', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const membership = await loadEligibleMembership(sub);
  if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
  const box = await prisma.monthlyBox.findFirst({
    where: { membershipId: membership.id },
    orderBy: { cycleStart: 'desc' },
    select: { cycleKey: true },
  });
  if (!box) return reply.status(404).send({ error: 'box_not_open' });
  return reply.send(await buildBoxCatalog(app.uploads, box.cycleKey));
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C apps/api exec vitest run test/box/box-catalog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/box/catalog.ts apps/api/src/routes/box.ts apps/api/test/box/box-catalog.test.ts
git commit -m "feat(api): GET /me/box/catalog attendee read model"
```

---

### Task 4: `POST /me/box/skip` and `POST /me/box/unskip`

**Files:**

- Create: `apps/api/src/services/box/skip.ts`
- Modify: `apps/api/src/routes/box.ts`
- Test: `apps/api/test/box/box-skip.test.ts` (create)

**Interfaces:**

- Consumes: `loadEligibleMembership`.
- Produces: `skipBox(membershipId): Promise<SkipResult>` and `unskipBox(membershipId): Promise<SkipResult>` where `type SkipResult = { kind: 'ok' } | { kind: 'not_found' } | { kind: 'conflict' }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/box/box-skip.test.ts`. Cases: skip an open box → 200 and status `skipped`, selection rows still present; unskip → 200 and status `open`; skip when box already `awaiting_payment` → 409; unskip a box past `cutoffAt` → 409. Use the `box-get.test.ts` setup shape; set `cutoffAt` in the past for the last case.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run test/box/box-skip.test.ts`
Expected: FAIL (routes not implemented).

- [ ] **Step 3: Create `apps/api/src/services/box/skip.ts`**

```ts
import { prisma } from '@ccc/db';

export type SkipResult = { kind: 'ok' } | { kind: 'not_found' } | { kind: 'conflict' };

const transition = async (
  membershipId: string,
  from: 'open' | 'skipped',
  to: 'skipped' | 'open',
): Promise<SkipResult> => {
  const ref = await prisma.monthlyBox.findFirst({
    where: { membershipId },
    orderBy: { cycleStart: 'desc' },
    select: { id: true, garageId: true },
  });
  if (!ref) return { kind: 'not_found' };

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${ref.garageId} FOR UPDATE`;
    const box = await tx.monthlyBox.findUnique({
      where: { id: ref.id },
      select: { status: true, cutoffAt: true },
    });
    // Box locks at the cutoff instant even if the cron worker has not run yet.
    if (!box || box.status !== from || box.cutoffAt <= new Date()) {
      return { kind: 'conflict' as const };
    }
    await tx.monthlyBox.update({ where: { id: ref.id }, data: { status: to } });
    return { kind: 'ok' as const };
  });
};

/** Open box the member chose to skip this cycle. Selection is preserved. */
export const skipBox = (membershipId: string): Promise<SkipResult> =>
  transition(membershipId, 'open', 'skipped');

/** Reopen a skipped box while the cutoff has not passed. */
export const unskipBox = (membershipId: string): Promise<SkipResult> =>
  transition(membershipId, 'skipped', 'open');
```

- [ ] **Step 4: Add the routes in `apps/api/src/routes/box.ts`**

Import `skipBox, unskipBox`. Add:

```ts
app.post('/me/box/skip', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const membership = await loadEligibleMembership(sub);
  if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
  const result = await skipBox(membership.id);
  if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
  if (result.kind === 'conflict') return reply.status(409).send({ error: 'box_locked' });
  return reply.status(204).send();
});

app.post('/me/box/unskip', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const membership = await loadEligibleMembership(sub);
  if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
  const result = await unskipBox(membership.id);
  if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
  if (result.kind === 'conflict') return reply.status(409).send({ error: 'box_locked' });
  return reply.status(204).send();
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C apps/api exec vitest run test/box/box-skip.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/box/skip.ts apps/api/src/routes/box.ts apps/api/test/box/box-skip.test.ts
git commit -m "feat(api): POST /me/box/skip and /unskip with garage-row lock"
```

---

### Task 5: `GET /me/boxes` history

**Files:**

- Create: `apps/api/src/services/box/history.ts`
- Modify: `apps/api/src/routes/box.ts`
- Test: `apps/api/test/box/box-history.test.ts` (create)

**Interfaces:**

- Consumes: `boxHistorySchema` (Task 1), `Uploads`.
- Produces: `listBoxHistory(uploads, garageId): Promise<BoxHistory>`. Garage-scoped, newest first, up to 3 thumbnails per box from included items' catalog images. `current` marks the newest box.

**Scope:** auth-only, resolved by garage, NOT gated on an active membership, so a lapsed or resubscribed member still sees past boxes.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/box/box-history.test.ts`. Create a garage via `createUser`, then two boxes for it under a membership whose status is `cancelled` (proving history is not eligibility-gated). Assert: `GET /me/boxes` → 200, `boxHistorySchema.parse(...)`, two entries newest-first, the newest has `current === true`. Note the route needs the garage id from the user, so add a helper in the route (below) that loads the garage directly, not `loadEligibleMembership`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api exec vitest run test/box/box-history.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/services/box/history.ts`**

```ts
import type { BoxHistory } from '@ccc/shared/box';
import { prisma } from '@ccc/db';

import type { Uploads } from '../uploads/types.js';

/** Garage-scoped box history, newest first. Not gated on active membership. */
export const listBoxHistory = async (uploads: Uploads, garageId: string): Promise<BoxHistory> => {
  const boxes = await prisma.monthlyBox.findMany({
    where: { garageId },
    orderBy: { cycleStart: 'desc' },
    include: {
      items: {
        where: { included: true },
        take: 3,
        include: { catalogItem: { select: { imageObjectKey: true } } },
      },
    },
  });
  return boxes.map((b, index) => ({
    id: b.id,
    cycleKey: b.cycleKey,
    cycleStart: b.cycleStart.toISOString(),
    status: b.status,
    chargeCents: b.chargeCents,
    thumbnails: b.items
      .map((i) => i.catalogItem?.imageObjectKey)
      .filter((k): k is string => Boolean(k))
      .map((k) => uploads.buildPublicUrl(k)),
    current: index === 0,
  }));
};
```

- [ ] **Step 4: Add the route in `apps/api/src/routes/box.ts`**

```ts
app.get('/me/boxes', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const garage = await prisma.garage.findUnique({ where: { userId: sub }, select: { id: true } });
  if (!garage) return reply.send([]);
  return reply.send(await listBoxHistory(app.uploads, garage.id));
});
```

Import `listBoxHistory`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C apps/api exec vitest run test/box/box-history.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/box/history.ts apps/api/src/routes/box.ts apps/api/test/box/box-history.test.ts
git commit -m "feat(api): GET /me/boxes garage-scoped history"
```

---

### Task 6: `PUT /me/box/preferences` + single auto-send write path

**Files:**

- Create: `apps/api/src/services/box/preferences.ts`
- Modify: `apps/api/src/services/box/confirm.ts`
- Modify: `apps/api/src/routes/box.ts`
- Test: `apps/api/test/box/box-preferences.test.ts` (create)
- Test: `apps/api/test/box/box-cutoff-optin.test.ts` (create)

**Interfaces:**

- Consumes: `boxPreferencesSchema` (Task 1), `loadEligibleMembership`.
- Produces: `setBoxPreferences(args): Promise<PrefsResult>` where `args = { userId, membershipId, autoSendOptIn, shippingAddressId? }` and `type PrefsResult = { kind: 'ok' } | { kind: 'not_found' } | { kind: 'conflict' } | { kind: 'bad_address' }`.
- Changes: `confirmBox` no longer takes or writes `autoSendOptIn`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/box/box-preferences.test.ts`: (a) open box + owned address + `autoSendOptIn: true` → 204, and the box row now has `autoSendOptIn === true` and the `shippingAddressId` set; (b) an address owned by another user → 400 `bad_address`; (c) a box in `awaiting_payment` → 409.

Create `apps/api/test/box/box-cutoff-optin.test.ts`: proves the Q10 gate. Two open boxes past `cutoffAt`, each with an included item and a saved `shippingAddressId`; one with `autoSendOptIn: true`, one `false`. Run the cutoff tick, then assert the opt-in box resolved to `ready` and the non-opt-in box is `skipped`. Import the tick:

```ts
import { runBoxCutoffTick } from '../../src/workers/box-cutoff.js';
// ...
await runBoxCutoffTick({});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C apps/api exec vitest run test/box/box-preferences.test.ts test/box/box-cutoff-optin.test.ts`
Expected: box-preferences FAILs (route missing). box-cutoff-optin should PASS already if the Fase 2 worker enforces the gate; if it FAILs, the worker gate is missing and must be fixed in this task. Record which.

- [ ] **Step 3: Create `apps/api/src/services/box/preferences.ts`**

```ts
import { prisma } from '@ccc/db';

export type PrefsResult =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'bad_address' };

export const setBoxPreferences = async (args: {
  userId: string;
  membershipId: string;
  autoSendOptIn: boolean;
  shippingAddressId?: string;
}): Promise<PrefsResult> => {
  const ref = await prisma.monthlyBox.findFirst({
    where: { membershipId: args.membershipId },
    orderBy: { cycleStart: 'desc' },
    select: { id: true, garageId: true },
  });
  if (!ref) return { kind: 'not_found' };

  if (args.shippingAddressId) {
    const address = await prisma.shippingAddress.findUnique({
      where: { id: args.shippingAddressId },
      select: { userId: true },
    });
    if (!address || address.userId !== args.userId) return { kind: 'bad_address' };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${ref.garageId} FOR UPDATE`;
    const box = await tx.monthlyBox.findUnique({
      where: { id: ref.id },
      select: { status: true, cutoffAt: true },
    });
    if (!box || box.status !== 'open' || box.cutoffAt <= new Date()) {
      return { kind: 'conflict' as const };
    }
    await tx.monthlyBox.update({
      where: { id: ref.id },
      data: {
        autoSendOptIn: args.autoSendOptIn,
        ...(args.shippingAddressId ? { shippingAddressId: args.shippingAddressId } : {}),
      },
    });
    return { kind: 'ok' as const };
  });
};
```

- [ ] **Step 4: Remove `autoSendOptIn` from the confirm path end to end (atomic)**

This removal spans the shared schema, its rebuild, the confirm service, and the existing shared test. Do all of it in this step so no intermediate tree fails `tsc`.

(a) `packages/shared/src/box.ts` — drop `autoSendOptIn` from `boxConfirmSchema`:

```ts
export const boxConfirmSchema = z.object({
  shippingAddressId: z.string().min(1),
});
export type BoxConfirm = z.infer<typeof boxConfirmSchema>;
```

(b) `packages/shared/src/__tests__/box.test.ts` — the existing test `accepts a confirm payload with opt-in and address` asserts `expect(parsed.autoSendOptIn).toBe(true)`, which now strips to `undefined`. Replace that test body so it no longer references `autoSendOptIn`:

```ts
it('accepts a confirm payload with an address', () => {
  const parsed = boxConfirmSchema.parse({ shippingAddressId: 'addr_1' });
  expect(parsed.shippingAddressId).toBe('addr_1');
});
```

(c) Rebuild shared so the API sees it: `pnpm -C packages/shared build`.

(d) `apps/api/src/services/box/confirm.ts` — remove `autoSendOptIn` from the args type (line ~20) and from the `tx.monthlyBox.update` data block that writes `shippingAddressId`/`shippingCents` (line ~61). Leave everything else. `autoSendOptIn` is now owned solely by `PUT /me/box/preferences` and the open-time default.

- [ ] **Step 5: Wire the route + fix the confirm call**

In `apps/api/src/routes/box.ts`: import `setBoxPreferences` and `boxPreferencesSchema`. Update the confirm handler to stop passing `autoSendOptIn`:

```ts
const result = await confirmBox({
  userId: sub,
  membershipId: membership.id,
  shippingAddressId: parsed.data.shippingAddressId,
});
```

Add the preferences route:

```ts
app.put('/me/box/preferences', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const parsed = boxPreferencesSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
  }
  const membership = await loadEligibleMembership(sub);
  if (!membership) return reply.status(403).send({ error: 'box_not_eligible' });
  const result = await setBoxPreferences({
    userId: sub,
    membershipId: membership.id,
    autoSendOptIn: parsed.data.autoSendOptIn,
    shippingAddressId: parsed.data.shippingAddressId,
  });
  if (result.kind === 'not_found') return reply.status(404).send({ error: 'box_not_open' });
  if (result.kind === 'bad_address') return reply.status(400).send({ error: 'bad_address' });
  if (result.kind === 'conflict') return reply.status(409).send({ error: 'box_locked' });
  return reply.status(204).send();
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm -C apps/api exec vitest run test/box/box-preferences.test.ts test/box/box-cutoff-optin.test.ts`
Expected: PASS. If box-cutoff-optin required a worker fix in Step 2, that fix is in `apps/api/src/workers/box-cutoff.ts` and is included in this commit.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm -C apps/api exec tsc --noEmit`
Expected: exits 0 (confirm signature change has no stragglers).

```bash
git add apps/api/src/services/box/preferences.ts apps/api/src/services/box/confirm.ts apps/api/src/routes/box.ts apps/api/test/box/box-preferences.test.ts apps/api/test/box/box-cutoff-optin.test.ts
git commit -m "feat(api): PUT /me/box/preferences, single auto-send write path, cutoff opt-in test"
```

---

## Final verification

- [ ] Run the full box suite: `pnpm -C apps/api exec vitest run test/box test/services/box`
- [ ] Run `pnpm -C apps/api exec tsc --noEmit` and `pnpm -C packages/shared exec tsc -p tsconfig.build.json`
- [ ] Confirm no route besides `/me/boxes` skips the eligibility gate.

## Notes for the mobile plan (Fase 3b)

- The box view now returns dropped lines; the client filters `included` for the builder and shows `!included` on screen 10.
- `autoSendOptIn` is written only via `PUT /me/box/preferences`; confirm carries only `shippingAddressId`.
- `soldOut` is advisory. The client shows "Sem estoque" on `soldOut`, never a remaining count.
