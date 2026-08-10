# Box Builder - Fase 1 (Schema + Shared + Admin de configuração) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the configuration side of Box Builder so an organizer/admin can manage the box catalog, partners, per-plan budget, and box settings before any member runtime exists.

**Architecture:** Add config-only Prisma models (`BoxCatalogItem`, `Partner`, `PartnerModule`, `BoxSettings`) plus a `monthlyBoxBudgetCents` field on `PremiumPlan`. Expose admin REST endpoints under `/admin/box/*` following the existing `premium-catalog-admin.ts` pattern, validated by new Zod schemas in `@ccc/shared/admin-box`. Build Next.js admin pages under `/box/*` following the premium catalog admin (server component + client + server actions + `apiFetch`). Runtime models (`MonthlyBox*`, cycle stock, `OrderKind.box`) are deferred to Fase 2.

**Tech Stack:** Prisma + Postgres (`@ccc/db`), Zod (`@ccc/shared`), Fastify (`apps/api`), Next.js App Router (`apps/admin`), Vitest + Testcontainers, Cloudflare R2 presigned uploads.

## Global Constraints

- Language PT-BR for all user-facing copy; keep i18n-friendly (labels as literals in admin match existing admin, which is PT-BR literal).
- Money is integer cents; `currency String @default("BRL") @db.VarChar(3)` on every money-bearing model (schema convention).
- Admin write endpoints require role `organizer` or `admin`; staff gets 403 (matches premium catalog).
- Validation: routes use `safeParse` and return `422 { error: 'UnprocessableEntity', issues }`; `404 { error: 'NotFound' }`; `409 { error: 'AlreadyExists' }` on unique violations.
- Soft delete: DELETE sets `active: false`, never hard-deletes.
- Prisma ids are `cuid()`; models carry `createdAt @default(now())` and `updatedAt @updatedAt`.
- Prisma client is the singleton `import { prisma } from '@ccc/db'`.
- Integration tests hit a real Postgres via Testcontainers (never mocks).
- No em-dashes in code comments or copy.
- When a step shows `import` lines for a file that already exists, merge them into that file's existing top-of-file import block (ESM requires imports at the top, and server-action files keep `'use server'` as the first line). Only function bodies, consts, and schema additions are appended at the end of a file.

---

## File Structure

**Create:**

- `packages/shared/src/admin-box.ts` - Zod schemas + types for box catalog, partners, partner modules, box settings.
- `packages/shared/src/__tests__/admin-box.test.ts` - schema unit tests.
- `apps/api/src/routes/admin/box-catalog-admin.ts` - catalog item CRUD routes.
- `apps/api/src/routes/admin/box-partners-admin.ts` - partner + partner-module CRUD routes.
- `apps/api/src/routes/admin/box-settings-admin.ts` - box settings GET/PUT + plan budget PATCH.
- `apps/api/test/admin/box-catalog-admin.test.ts`
- `apps/api/test/admin/box-partners-admin.test.ts`
- `apps/api/test/admin/box-settings-admin.test.ts`
- `apps/admin/app/(authed)/box/catalogo/page.tsx`
- `apps/admin/app/(authed)/box/catalogo/box-catalog-client.tsx`
- `apps/admin/app/(authed)/box/parceiros/page.tsx`
- `apps/admin/app/(authed)/box/parceiros/box-partners-client.tsx`
- `apps/admin/app/(authed)/box/config/page.tsx`
- `apps/admin/app/(authed)/box/config/box-settings-client.tsx`
- `apps/admin/src/lib/box-admin-actions.ts` - server actions for all box admin mutations.
- `apps/admin/src/components/box-image-uploader.tsx` - reusable R2 image uploader for box images.
- `apps/admin/src/lib/box-admin-actions.test.ts`

**Modify:**

- `packages/db/prisma/schema.prisma` - add models + `PremiumPlan.monthlyBoxBudgetCents`.
- `packages/shared/src/uploads.ts` - add upload kinds `box_item`, `partner_logo`, `partner_module`.
- `packages/shared/package.json` - add `./admin-box` subpath export.
- `packages/shared/src/admin.ts` - add `monthlyBoxBudgetCents` to plan schemas.
- `apps/api/src/services/uploads/r2.ts` (or the path-prefix map file) - add prefixes for new kinds.
- `apps/api/src/routes/admin/index.ts` - register the three new route plugins under an organizer/admin scope.
- `apps/api/src/routes/admin/premium-catalog-admin.ts` - accept `monthlyBoxBudgetCents` in plan create/update.
- `apps/admin/src/lib/admin-api.ts` - one function per new endpoint.
- `apps/admin/src/components/authed-nav.tsx` - add `Box` nav entry.
- `apps/admin/middleware.ts` - block staff from `/box`.
- `apps/admin/app/(authed)/premium/catalogo/premium-catalog-client.tsx` - add budget field to the plan form.
- `packages/db/prisma/seed.ts` - seed a default `BoxSettings` row.

---

## Task 1: Prisma schema + migration (config models)

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: migration under `packages/db/prisma/migrations/`

**Interfaces:**

- Produces: Prisma models `BoxCatalogItem`, `Partner`, `PartnerModule`, `BoxSettings`; field `PremiumPlan.monthlyBoxBudgetCents Int`. These names/fields are consumed by every later task.

- [ ] **Step 1: Add models to schema.prisma**

Append these models near the other premium/store models. Add `monthlyBoxBudgetCents` to the existing `PremiumPlan` model.

```prisma
model BoxCatalogItem {
  id             String   @id @default(cuid())
  slug           String   @unique @db.VarChar(140)
  title          String   @db.VarChar(140)
  description    String   @db.Text
  priceCents     Int
  currency       String   @default("BRL") @db.VarChar(3)
  category       String   @db.VarChar(60)
  imageObjectKey String?  @db.VarChar(300)
  stockPerCycle  Int?
  maxPerCycle    Int?
  active         Boolean  @default(true)
  sortOrder      Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([active, sortOrder])
  @@index([category, active])
}

model Partner {
  id             String   @id @default(cuid())
  slug           String   @unique @db.VarChar(60)
  name           String   @db.VarChar(80)
  description    String?  @db.VarChar(240)
  logoObjectKey  String?  @db.VarChar(300)
  active         Boolean  @default(true)
  sortOrder      Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  modules PartnerModule[]

  @@index([active, sortOrder])
}

model PartnerModule {
  id             String   @id @default(cuid())
  partnerId      String
  name           String   @db.VarChar(80)
  description    String?  @db.VarChar(240)
  priceCents     Int
  currency       String   @default("BRL") @db.VarChar(3)
  imageObjectKey String?  @db.VarChar(300)
  active         Boolean  @default(true)
  sortOrder      Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Cascade)

  @@index([partnerId, active, sortOrder])
}

model BoxSettings {
  id                      String   @id @default(cuid())
  boxEnabled              Boolean  @default(false)
  cutoffDaysBeforeRenewal Int      @default(5)
  headerTitle             String?  @db.VarChar(140)
  headerSubtitle          String?  @db.VarChar(240)
  freeShippingCepRanges   Json     @default("[]")
  shippingFeeCents        Int      @default(0)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
}
```

Add to the existing `PremiumPlan` model (after `sortOrder`):

```prisma
  monthlyBoxBudgetCents Int @default(0)
```

- [ ] **Step 2: Create the migration**

Run from `packages/db`:

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/db
pnpm db:migrate --name box_builder_catalog_config
```

Expected: Prisma creates `migrations/<timestamp>_box_builder_catalog_config/migration.sql` and applies it to the dev DB. It generates `CREATE TABLE "BoxCatalogItem"`, `"Partner"`, `"PartnerModule"`, `"BoxSettings"`, and `ALTER TABLE "PremiumPlan" ADD COLUMN "monthlyBoxBudgetCents"`.

- [ ] **Step 3: Regenerate the client and typecheck**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/db
pnpm db:generate
pnpm exec tsc -p tsconfig.json --noEmit
```

Expected: no errors; `@prisma/client` now exposes `prisma.boxCatalogItem`, `prisma.partner`, `prisma.partnerModule`, `prisma.boxSettings`.

- [ ] **Step 4: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): box builder config models and plan budget"
```

---

## Task 2: R2 upload kinds for box images

**Files:**

- Modify: `packages/shared/src/uploads.ts`
- Modify: `apps/api/src/services/uploads/r2.ts`
- Test: `packages/shared/src/__tests__/uploads.test.ts` (create if absent; otherwise extend)

**Interfaces:**

- Consumes: existing `UPLOAD_KINDS`, `presignRequestSchema`, `UPLOAD_KIND_PATH_PREFIX`.
- Produces: kinds `'box_item' | 'partner_logo' | 'partner_module'` valid in `presignRequestSchema`.

- [ ] **Step 1: Write the failing test**

Create/extend `packages/shared/src/__tests__/uploads.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { presignRequestSchema } from '../uploads.js';

describe('uploads kinds - box builder', () => {
  it('accepts box_item, partner_logo, partner_module', () => {
    for (const kind of ['box_item', 'partner_logo', 'partner_module'] as const) {
      const parsed = presignRequestSchema.safeParse({
        kind,
        contentType: 'image/jpeg',
        size: 1024,
      });
      expect(parsed.success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/shared
pnpm exec vitest run src/__tests__/uploads.test.ts
```

Expected: FAIL (kinds rejected by the enum).

- [ ] **Step 3: Add the kinds**

In `packages/shared/src/uploads.ts`, add the three values to the `UPLOAD_KINDS` tuple (keep existing values):

```typescript
export const UPLOAD_KINDS = [
  'avatar',
  'car_photo',
  'event_cover',
  'feed_photo',
  'product_photo',
  'support_attachment',
  'box_item',
  'partner_logo',
  'partner_module',
] as const;
```

In `apps/api/src/services/uploads/r2.ts`, add path prefixes to `UPLOAD_KIND_PATH_PREFIX`:

```typescript
  box_item: 'box_item',
  partner_logo: 'partner_logo',
  partner_module: 'partner_module',
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/shared
pnpm exec vitest run src/__tests__/uploads.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add packages/shared/src/uploads.ts packages/shared/src/__tests__/uploads.test.ts apps/api/src/services/uploads/r2.ts
git commit -m "feat(uploads): box_item, partner_logo, partner_module kinds"
```

---

## Task 3: Shared Zod - catalog + partner schemas

**Files:**

- Create: `packages/shared/src/admin-box.ts`
- Modify: `packages/shared/src/index.ts` (re-export), `packages/shared/package.json` (subpath export)
- Test: `packages/shared/src/__tests__/admin-box.test.ts`

**Interfaces:**

- Produces (consumed by API + admin tasks):
  - `adminBoxCatalogItemSchema` / `AdminBoxCatalogItem`
  - `adminBoxCatalogItemCreateSchema` / `AdminBoxCatalogItemCreate`
  - `adminBoxCatalogItemUpdateSchema` / `AdminBoxCatalogItemUpdate`
  - `adminBoxCatalogListSchema` / `AdminBoxCatalogList`
  - `adminPartnerSchema` / `AdminPartner` (with nested `modules: AdminPartnerModule[]`)
  - `adminPartnerModuleSchema` / `AdminPartnerModule`
  - `adminPartnerCreateSchema`, `adminPartnerUpdateSchema`
  - `adminPartnerModuleCreateSchema`, `adminPartnerModuleUpdateSchema`
  - `adminPartnerListSchema` / `AdminPartnerList`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/admin-box.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  adminBoxCatalogItemCreateSchema,
  adminBoxCatalogItemSchema,
  adminPartnerModuleCreateSchema,
} from '../admin-box.js';

describe('admin-box catalog + partner schemas', () => {
  it('accepts a valid catalog item create', () => {
    const parsed = adminBoxCatalogItemCreateSchema.safeParse({
      slug: 'cafe-500g',
      title: 'Cafe 500g',
      description: 'Cafe especial',
      priceCents: 4500,
      category: 'bebidas',
      active: true,
      sortOrder: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects negative priceCents', () => {
    const parsed = adminBoxCatalogItemCreateSchema.safeParse({
      slug: 'x',
      title: 'X',
      description: 'x',
      priceCents: -1,
      category: 'c',
    });
    expect(parsed.success).toBe(false);
  });

  it('parses a full catalog item response', () => {
    const parsed = adminBoxCatalogItemSchema.parse({
      id: 'c1',
      slug: 'cafe',
      title: 'Cafe',
      description: 'd',
      priceCents: 4500,
      currency: 'BRL',
      category: 'bebidas',
      imageObjectKey: null,
      stockPerCycle: null,
      maxPerCycle: 3,
      active: true,
      sortOrder: 0,
    });
    expect(parsed.maxPerCycle).toBe(3);
  });

  it('accepts a valid partner module create', () => {
    const parsed = adminPartnerModuleCreateSchema.safeParse({
      name: 'Kit lavagem',
      priceCents: 9900,
      active: true,
      sortOrder: 0,
    });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/shared
pnpm exec vitest run src/__tests__/admin-box.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the schemas**

Create `packages/shared/src/admin-box.ts`:

```typescript
import { z } from 'zod';

const slug = z
  .string()
  .trim()
  .min(1)
  .max(140)
  .regex(/^[a-z0-9-]+$/, 'slug: only lowercase, digits, hyphen');

const objectKey = z.string().trim().min(1).max(300).nullable();
const cents = z.number().int().nonnegative();
const sortOrder = z.number().int().min(0).max(100_000);

// ----- Catalog item -----

export const adminBoxCatalogItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  priceCents: z.number().int(),
  currency: z.string(),
  category: z.string(),
  imageObjectKey: z.string().nullable(),
  stockPerCycle: z.number().int().nullable(),
  maxPerCycle: z.number().int().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type AdminBoxCatalogItem = z.infer<typeof adminBoxCatalogItemSchema>;

export const adminBoxCatalogItemCreateSchema = z.object({
  slug,
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().min(1).max(10_000),
  priceCents: cents,
  category: z.string().trim().min(1).max(60),
  imageObjectKey: objectKey.optional(),
  stockPerCycle: z.number().int().positive().max(1_000_000).nullable().optional(),
  maxPerCycle: z.number().int().positive().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminBoxCatalogItemCreate = z.infer<typeof adminBoxCatalogItemCreateSchema>;

export const adminBoxCatalogItemUpdateSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().min(1).max(10_000).optional(),
  priceCents: cents.optional(),
  category: z.string().trim().min(1).max(60).optional(),
  imageObjectKey: objectKey.optional(),
  stockPerCycle: z.number().int().positive().max(1_000_000).nullable().optional(),
  maxPerCycle: z.number().int().positive().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminBoxCatalogItemUpdate = z.infer<typeof adminBoxCatalogItemUpdateSchema>;

export const adminBoxCatalogListSchema = z.object({
  items: z.array(adminBoxCatalogItemSchema),
});
export type AdminBoxCatalogList = z.infer<typeof adminBoxCatalogListSchema>;

// ----- Partner module -----

export const adminPartnerModuleSchema = z.object({
  id: z.string(),
  partnerId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int(),
  currency: z.string(),
  imageObjectKey: z.string().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type AdminPartnerModule = z.infer<typeof adminPartnerModuleSchema>;

export const adminPartnerModuleCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable().optional(),
  priceCents: cents,
  imageObjectKey: objectKey.optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminPartnerModuleCreate = z.infer<typeof adminPartnerModuleCreateSchema>;

export const adminPartnerModuleUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).nullable().optional(),
  priceCents: cents.optional(),
  imageObjectKey: objectKey.optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminPartnerModuleUpdate = z.infer<typeof adminPartnerModuleUpdateSchema>;

// ----- Partner -----

export const adminPartnerSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  logoObjectKey: z.string().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  modules: z.array(adminPartnerModuleSchema),
});
export type AdminPartner = z.infer<typeof adminPartnerSchema>;

export const adminPartnerCreateSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable().optional(),
  logoObjectKey: objectKey.optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminPartnerCreate = z.infer<typeof adminPartnerCreateSchema>;

export const adminPartnerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).nullable().optional(),
  logoObjectKey: objectKey.optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
});
export type AdminPartnerUpdate = z.infer<typeof adminPartnerUpdateSchema>;

export const adminPartnerListSchema = z.object({
  partners: z.array(adminPartnerSchema),
});
export type AdminPartnerList = z.infer<typeof adminPartnerListSchema>;
```

Add to `packages/shared/src/index.ts`:

```typescript
export * from './admin-box.js';
```

Add to `packages/shared/package.json` `exports` map:

```json
    "./admin-box": { "types": "./src/admin-box.ts", "default": "./dist/admin-box.js" }
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/shared
pnpm exec vitest run src/__tests__/admin-box.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add packages/shared/src/admin-box.ts packages/shared/src/__tests__/admin-box.test.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(shared): box catalog + partner admin zod schemas"
```

---

## Task 4: Shared Zod - box settings + plan budget

**Files:**

- Modify: `packages/shared/src/admin-box.ts` (append settings schemas)
- Modify: `packages/shared/src/admin.ts` (add `monthlyBoxBudgetCents` to plan schemas)
- Test: `packages/shared/src/__tests__/admin-box.test.ts` (append)

**Interfaces:**

- Produces:
  - `adminBoxSettingsSchema` / `AdminBoxSettings`
  - `adminBoxSettingsUpdateSchema` / `AdminBoxSettingsUpdate`
  - `cepRangeSchema` / `CepRange`
- Modifies: `adminPremiumPlanSchema`, `adminPremiumPlanCreateSchema`, `adminPremiumPlanUpdateSchema` gain `monthlyBoxBudgetCents`.

- [ ] **Step 1: Write the failing test (append)**

Append to `packages/shared/src/__tests__/admin-box.test.ts`:

```typescript
import { adminBoxSettingsUpdateSchema } from '../admin-box.js';

describe('admin-box settings schema', () => {
  it('accepts settings with cep ranges', () => {
    const parsed = adminBoxSettingsUpdateSchema.safeParse({
      boxEnabled: true,
      cutoffDaysBeforeRenewal: 5,
      headerTitle: 'Sua caixa',
      freeShippingCepRanges: [{ from: '80000-000', to: '83800-999' }],
      shippingFeeCents: 1990,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a malformed cep', () => {
    const parsed = adminBoxSettingsUpdateSchema.safeParse({
      freeShippingCepRanges: [{ from: 'abc', to: '83800-999' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects cutoff out of range', () => {
    const parsed = adminBoxSettingsUpdateSchema.safeParse({ cutoffDaysBeforeRenewal: 40 });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/shared
pnpm exec vitest run src/__tests__/admin-box.test.ts
```

Expected: FAIL (`adminBoxSettingsUpdateSchema` not exported).

- [ ] **Step 3: Append settings schemas to admin-box.ts**

```typescript
const cep = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{3}$/, 'CEP invalido');

export const cepRangeSchema = z
  .object({ from: cep, to: cep })
  .refine((r) => r.from.replace('-', '') <= r.to.replace('-', ''), {
    message: 'from deve ser <= to',
    path: ['to'],
  });
export type CepRange = z.infer<typeof cepRangeSchema>;

export const adminBoxSettingsSchema = z.object({
  boxEnabled: z.boolean(),
  cutoffDaysBeforeRenewal: z.number().int(),
  headerTitle: z.string().nullable(),
  headerSubtitle: z.string().nullable(),
  freeShippingCepRanges: z.array(cepRangeSchema),
  shippingFeeCents: z.number().int(),
});
export type AdminBoxSettings = z.infer<typeof adminBoxSettingsSchema>;

export const adminBoxSettingsUpdateSchema = z.object({
  boxEnabled: z.boolean().optional(),
  cutoffDaysBeforeRenewal: z.number().int().min(0).max(28).optional(),
  headerTitle: z.string().trim().max(140).nullable().optional(),
  headerSubtitle: z.string().trim().max(240).nullable().optional(),
  freeShippingCepRanges: z.array(cepRangeSchema).max(50).optional(),
  shippingFeeCents: z.number().int().nonnegative().optional(),
});
export type AdminBoxSettingsUpdate = z.infer<typeof adminBoxSettingsUpdateSchema>;
```

- [ ] **Step 4: Add budget field to plan schemas in admin.ts**

Find `adminPremiumPlanSchema`, `adminPremiumPlanCreateSchema`, `adminPremiumPlanUpdateSchema` in `packages/shared/src/admin.ts`. Add a `monthlyBoxBudgetCents` field to each:

- In `adminPremiumPlanSchema` (response): `monthlyBoxBudgetCents: z.number().int(),`
- In `adminPremiumPlanCreateSchema`: `monthlyBoxBudgetCents: z.number().int().nonnegative().optional(),`
- In `adminPremiumPlanUpdateSchema`: `monthlyBoxBudgetCents: z.number().int().nonnegative().optional(),`

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/shared
pnpm exec vitest run src/__tests__/admin-box.test.ts src/__tests__/admin.test.ts
```

Expected: PASS (existing admin tests still green; new settings tests pass).

- [ ] **Step 6: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add packages/shared/src/admin-box.ts packages/shared/src/admin.ts packages/shared/src/__tests__/admin-box.test.ts
git commit -m "feat(shared): box settings zod + plan monthlyBoxBudgetCents"
```

---

## Task 5: API - box catalog admin routes

**Files:**

- Create: `apps/api/src/routes/admin/box-catalog-admin.ts`
- Modify: `apps/api/src/routes/admin/index.ts`
- Test: `apps/api/test/admin/box-catalog-admin.test.ts`

**Interfaces:**

- Consumes: `adminBoxCatalogItemSchema`, `adminBoxCatalogItemCreateSchema`, `adminBoxCatalogItemUpdateSchema`, `adminBoxCatalogListSchema` from `@ccc/shared/admin-box`; `prisma` from `@ccc/db`; test helpers `makeApp`, `resetDatabase`, `createUser`, `bearer`, `loadEnv`.
- Produces: routes `GET /admin/box/catalog-items`, `POST /admin/box/catalog-items`, `PATCH /admin/box/catalog-items/:id`, `DELETE /admin/box/catalog-items/:id`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin/box-catalog-admin.test.ts`:

```typescript
import { prisma } from '@ccc/db';
import { adminBoxCatalogItemSchema, adminBoxCatalogListSchema } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const auth = async (role: 'organizer' | 'staff') => {
  const { user } = await createUser({
    email: `${role}-${Date.now()}@jdm-test.local`,
    name: role,
    verified: true,
    role,
  });
  return bearer(env, user.id, role);
};

describe('admin box catalog', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects staff with 403', async () => {
    const header = await auth('staff');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates, lists, updates, and soft-deletes an item', async () => {
    const header = await auth('organizer');

    const create = await app.inject({
      method: 'POST',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
      payload: {
        slug: 'cafe-500g',
        title: 'Cafe 500g',
        description: 'Cafe especial',
        priceCents: 4500,
        category: 'bebidas',
      },
    });
    expect(create.statusCode).toBe(201);
    const created = adminBoxCatalogItemSchema.parse(create.json());
    expect(created.active).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
    });
    expect(list.statusCode).toBe(200);
    expect(adminBoxCatalogListSchema.parse(list.json()).items).toHaveLength(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/box/catalog-items/${created.id}`,
      headers: { authorization: header },
      payload: { priceCents: 5000 },
    });
    expect(patch.statusCode).toBe(200);
    expect(adminBoxCatalogItemSchema.parse(patch.json()).priceCents).toBe(5000);

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/box/catalog-items/${created.id}`,
      headers: { authorization: header },
    });
    expect(del.statusCode).toBe(200);
    expect(adminBoxCatalogItemSchema.parse(del.json()).active).toBe(false);
  });

  it('rejects duplicate slug with 409', async () => {
    const header = await auth('organizer');
    await prisma.boxCatalogItem.create({
      data: { slug: 'dup', title: 'x', description: 'x', priceCents: 1, category: 'c' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
      payload: { slug: 'dup', title: 'y', description: 'y', priceCents: 2, category: 'c' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects invalid body with 422', async () => {
    const header = await auth('organizer');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/box/catalog-items',
      headers: { authorization: header },
      payload: { slug: 'bad', title: 'x', description: 'x', priceCents: -1, category: 'c' },
    });
    expect(res.statusCode).toBe(422);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/api
pnpm exec vitest run test/admin/box-catalog-admin.test.ts
```

Expected: FAIL (routes 404, so assertions on 201/200 fail).

- [ ] **Step 3: Write the route plugin**

Create `apps/api/src/routes/admin/box-catalog-admin.ts`:

```typescript
import { prisma } from '@ccc/db';
import type { Prisma } from '@ccc/db';
import {
  adminBoxCatalogItemCreateSchema,
  adminBoxCatalogItemSchema,
  adminBoxCatalogItemUpdateSchema,
  adminBoxCatalogListSchema,
} from '@ccc/shared/admin-box';
import type { FastifyPluginAsync } from 'fastify';

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

type Row = Prisma.BoxCatalogItemGetPayload<Record<string, never>>;

const serialize = (row: Row) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  description: row.description,
  priceCents: row.priceCents,
  currency: row.currency,
  category: row.category,
  imageObjectKey: row.imageObjectKey,
  stockPerCycle: row.stockPerCycle,
  maxPerCycle: row.maxPerCycle,
  active: row.active,
  sortOrder: row.sortOrder,
});

export const adminBoxCatalogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/box/catalog-items', async (_request, reply) => {
    const rows = await prisma.boxCatalogItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return reply.send(adminBoxCatalogListSchema.parse({ items: rows.map(serialize) }));
  });

  app.post('/box/catalog-items', async (request, reply) => {
    const parsed = adminBoxCatalogItemCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;
    try {
      const created = await prisma.boxCatalogItem.create({
        data: {
          slug: input.slug,
          title: input.title,
          description: input.description,
          priceCents: input.priceCents,
          category: input.category,
          imageObjectKey: input.imageObjectKey ?? null,
          stockPerCycle: input.stockPerCycle ?? null,
          maxPerCycle: input.maxPerCycle ?? null,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      return reply.status(201).send(adminBoxCatalogItemSchema.parse(serialize(created)));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'AlreadyExists', message: 'slug already exists' });
      }
      throw err;
    }
  });

  app.patch('/box/catalog-items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminBoxCatalogItemUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const existing = await prisma.boxCatalogItem.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });

    const input = parsed.data;
    const data: Prisma.BoxCatalogItemUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.category !== undefined) data.category = input.category;
    if (input.imageObjectKey !== undefined) data.imageObjectKey = input.imageObjectKey;
    if (input.stockPerCycle !== undefined) data.stockPerCycle = input.stockPerCycle;
    if (input.maxPerCycle !== undefined) data.maxPerCycle = input.maxPerCycle;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const updated = await prisma.boxCatalogItem.update({ where: { id }, data });
    return reply.send(adminBoxCatalogItemSchema.parse(serialize(updated)));
  });

  app.delete('/box/catalog-items/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.boxCatalogItem.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const updated = await prisma.boxCatalogItem.update({
      where: { id },
      data: { active: false },
    });
    return reply.send(adminBoxCatalogItemSchema.parse(serialize(updated)));
  });
};
```

- [ ] **Step 4: Register the plugin**

In `apps/api/src/routes/admin/index.ts`, import at top:

```typescript
import { adminBoxCatalogRoutes } from './box-catalog-admin.js';
```

Add it inside the existing `organizer`/`admin` scope block (the one already guarding `adminEventRoutes`/`adminTierRoutes`):

```typescript
await scope.register(adminBoxCatalogRoutes);
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/api
pnpm exec vitest run test/admin/box-catalog-admin.test.ts
```

Expected: PASS (5 assertions/cases).

- [ ] **Step 6: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add apps/api/src/routes/admin/box-catalog-admin.ts apps/api/src/routes/admin/index.ts apps/api/test/admin/box-catalog-admin.test.ts
git commit -m "feat(api): admin box catalog CRUD routes"
```

---

## Task 6: API - box partners + modules admin routes

**Files:**

- Create: `apps/api/src/routes/admin/box-partners-admin.ts`
- Modify: `apps/api/src/routes/admin/index.ts`
- Test: `apps/api/test/admin/box-partners-admin.test.ts`

**Interfaces:**

- Consumes: `adminPartnerSchema`, `adminPartnerCreateSchema`, `adminPartnerUpdateSchema`, `adminPartnerListSchema`, `adminPartnerModuleSchema`, `adminPartnerModuleCreateSchema`, `adminPartnerModuleUpdateSchema` from `@ccc/shared/admin-box`.
- Produces: `GET /admin/box/partners`, `POST /admin/box/partners`, `PATCH /admin/box/partners/:id`, `DELETE /admin/box/partners/:id`, `POST /admin/box/partners/:id/modules`, `PATCH /admin/box/partner-modules/:moduleId`, `DELETE /admin/box/partner-modules/:moduleId`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin/box-partners-admin.test.ts`:

```typescript
import { adminPartnerListSchema, adminPartnerSchema } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();
const org = async () => {
  const { user } = await createUser({
    email: `org-${Date.now()}@jdm-test.local`,
    name: 'org',
    verified: true,
    role: 'organizer',
  });
  return bearer(env, user.id, 'organizer');
};

describe('admin box partners', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('creates a partner, adds a module, lists nested, soft-deletes', async () => {
    const header = await org();

    const p = await app.inject({
      method: 'POST',
      url: '/admin/box/partners',
      headers: { authorization: header },
      payload: { slug: 'oficina-x', name: 'Oficina X' },
    });
    expect(p.statusCode).toBe(201);
    const partner = adminPartnerSchema.parse(p.json());
    expect(partner.modules).toEqual([]);

    const m = await app.inject({
      method: 'POST',
      url: `/admin/box/partners/${partner.id}/modules`,
      headers: { authorization: header },
      payload: { name: 'Kit lavagem', priceCents: 9900 },
    });
    expect(m.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/admin/box/partners',
      headers: { authorization: header },
    });
    const parsed = adminPartnerListSchema.parse(list.json());
    expect(parsed.partners[0]?.modules).toHaveLength(1);

    const moduleId = parsed.partners[0]!.modules[0]!.id;
    const delMod = await app.inject({
      method: 'DELETE',
      url: `/admin/box/partner-modules/${moduleId}`,
      headers: { authorization: header },
    });
    expect(delMod.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/api
pnpm exec vitest run test/admin/box-partners-admin.test.ts
```

Expected: FAIL (routes 404).

- [ ] **Step 3: Write the route plugin**

Create `apps/api/src/routes/admin/box-partners-admin.ts`:

```typescript
import { prisma } from '@ccc/db';
import type { Prisma } from '@ccc/db';
import {
  adminPartnerCreateSchema,
  adminPartnerListSchema,
  adminPartnerModuleCreateSchema,
  adminPartnerModuleSchema,
  adminPartnerModuleUpdateSchema,
  adminPartnerSchema,
  adminPartnerUpdateSchema,
} from '@ccc/shared/admin-box';
import type { FastifyPluginAsync } from 'fastify';

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

const PARTNER_INCLUDE = {
  modules: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] },
} satisfies Prisma.PartnerInclude;

type PartnerRow = Prisma.PartnerGetPayload<{ include: typeof PARTNER_INCLUDE }>;
type ModuleRow = PartnerRow['modules'][number];

const serializeModule = (m: ModuleRow) => ({
  id: m.id,
  partnerId: m.partnerId,
  name: m.name,
  description: m.description,
  priceCents: m.priceCents,
  currency: m.currency,
  imageObjectKey: m.imageObjectKey,
  active: m.active,
  sortOrder: m.sortOrder,
});

const serializePartner = (p: PartnerRow) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  description: p.description,
  logoObjectKey: p.logoObjectKey,
  active: p.active,
  sortOrder: p.sortOrder,
  modules: p.modules.map(serializeModule),
});

export const adminBoxPartnersRoutes: FastifyPluginAsync = async (app) => {
  app.get('/box/partners', async (_request, reply) => {
    const rows = await prisma.partner.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: PARTNER_INCLUDE,
    });
    return reply.send(adminPartnerListSchema.parse({ partners: rows.map(serializePartner) }));
  });

  app.post('/box/partners', async (request, reply) => {
    const parsed = adminPartnerCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;
    try {
      const created = await prisma.partner.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          logoObjectKey: input.logoObjectKey ?? null,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
        include: PARTNER_INCLUDE,
      });
      return reply.status(201).send(adminPartnerSchema.parse(serializePartner(created)));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: 'AlreadyExists', message: 'slug already exists' });
      }
      throw err;
    }
  });

  app.patch('/box/partners/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminPartnerUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const existing = await prisma.partner.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const input = parsed.data;
    const data: Prisma.PartnerUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.logoObjectKey !== undefined) data.logoObjectKey = input.logoObjectKey;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    const updated = await prisma.partner.update({ where: { id }, data, include: PARTNER_INCLUDE });
    return reply.send(adminPartnerSchema.parse(serializePartner(updated)));
  });

  app.delete('/box/partners/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.partner.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const updated = await prisma.partner.update({
      where: { id },
      data: { active: false },
      include: PARTNER_INCLUDE,
    });
    return reply.send(adminPartnerSchema.parse(serializePartner(updated)));
  });

  app.post('/box/partners/:id/modules', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminPartnerModuleCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const partner = await prisma.partner.findUnique({ where: { id } });
    if (!partner) return reply.status(404).send({ error: 'NotFound' });
    const input = parsed.data;
    const created = await prisma.partnerModule.create({
      data: {
        partnerId: id,
        name: input.name,
        description: input.description ?? null,
        priceCents: input.priceCents,
        imageObjectKey: input.imageObjectKey ?? null,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return reply.status(201).send(adminPartnerModuleSchema.parse(serializeModule(created)));
  });

  app.patch('/box/partner-modules/:moduleId', async (request, reply) => {
    const { moduleId } = request.params as { moduleId: string };
    const parsed = adminPartnerModuleUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const existing = await prisma.partnerModule.findUnique({ where: { id: moduleId } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const input = parsed.data;
    const data: Prisma.PartnerModuleUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.imageObjectKey !== undefined) data.imageObjectKey = input.imageObjectKey;
    if (input.active !== undefined) data.active = input.active;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    const updated = await prisma.partnerModule.update({ where: { id: moduleId }, data });
    return reply.send(adminPartnerModuleSchema.parse(serializeModule(updated)));
  });

  app.delete('/box/partner-modules/:moduleId', async (request, reply) => {
    const { moduleId } = request.params as { moduleId: string };
    const existing = await prisma.partnerModule.findUnique({ where: { id: moduleId } });
    if (!existing) return reply.status(404).send({ error: 'NotFound' });
    const updated = await prisma.partnerModule.update({
      where: { id: moduleId },
      data: { active: false },
    });
    return reply.send(adminPartnerModuleSchema.parse(serializeModule(updated)));
  });
};
```

- [ ] **Step 4: Register the plugin**

In `apps/api/src/routes/admin/index.ts`, import and register inside the organizer/admin scope:

```typescript
import { adminBoxPartnersRoutes } from './box-partners-admin.js';
// ...
await scope.register(adminBoxPartnersRoutes);
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/api
pnpm exec vitest run test/admin/box-partners-admin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add apps/api/src/routes/admin/box-partners-admin.ts apps/api/src/routes/admin/index.ts apps/api/test/admin/box-partners-admin.test.ts
git commit -m "feat(api): admin box partners + modules CRUD routes"
```

---

## Task 7: API - box settings routes + plan budget PATCH

**Files:**

- Create: `apps/api/src/routes/admin/box-settings-admin.ts`
- Modify: `apps/api/src/routes/admin/index.ts`, `apps/api/src/routes/admin/premium-catalog-admin.ts`
- Test: `apps/api/test/admin/box-settings-admin.test.ts`

**Interfaces:**

- Consumes: `adminBoxSettingsSchema`, `adminBoxSettingsUpdateSchema` from `@ccc/shared/admin-box`.
- Produces: `GET /admin/box/settings`, `PUT /admin/box/settings`. Extends existing `POST/PATCH /admin/premium/plans` to persist `monthlyBoxBudgetCents`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin/box-settings-admin.test.ts`:

```typescript
import { adminBoxSettingsSchema } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();
const org = async () => {
  const { user } = await createUser({
    email: `org-${Date.now()}@jdm-test.local`,
    name: 'org',
    verified: true,
    role: 'organizer',
  });
  return bearer(env, user.id, 'organizer');
};

describe('admin box settings', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('returns defaults then persists an update', async () => {
    const header = await org();

    const get = await app.inject({
      method: 'GET',
      url: '/admin/box/settings',
      headers: { authorization: header },
    });
    expect(get.statusCode).toBe(200);
    const defaults = adminBoxSettingsSchema.parse(get.json());
    expect(defaults.boxEnabled).toBe(false);

    const put = await app.inject({
      method: 'PUT',
      url: '/admin/box/settings',
      headers: { authorization: header },
      payload: {
        boxEnabled: true,
        cutoffDaysBeforeRenewal: 7,
        freeShippingCepRanges: [{ from: '80000-000', to: '83800-999' }],
        shippingFeeCents: 1990,
      },
    });
    expect(put.statusCode).toBe(200);
    const saved = adminBoxSettingsSchema.parse(put.json());
    expect(saved.boxEnabled).toBe(true);
    expect(saved.cutoffDaysBeforeRenewal).toBe(7);
    expect(saved.freeShippingCepRanges).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/api
pnpm exec vitest run test/admin/box-settings-admin.test.ts
```

Expected: FAIL (routes 404).

- [ ] **Step 3: Write the settings route plugin**

Create `apps/api/src/routes/admin/box-settings-admin.ts`:

```typescript
import { prisma } from '@ccc/db';
import type { Prisma } from '@ccc/db';
import { adminBoxSettingsSchema, adminBoxSettingsUpdateSchema } from '@ccc/shared/admin-box';
import type { FastifyPluginAsync } from 'fastify';

type Row = Prisma.BoxSettingsGetPayload<Record<string, never>>;

const serialize = (row: Row) => ({
  boxEnabled: row.boxEnabled,
  cutoffDaysBeforeRenewal: row.cutoffDaysBeforeRenewal,
  headerTitle: row.headerTitle,
  headerSubtitle: row.headerSubtitle,
  freeShippingCepRanges: adminBoxSettingsSchema.shape.freeShippingCepRanges.parse(
    row.freeShippingCepRanges,
  ),
  shippingFeeCents: row.shippingFeeCents,
});

// Singleton row, mirrors StoreSettings/GeneralSettings usage.
const getOrCreate = async (): Promise<Row> => {
  const existing = await prisma.boxSettings.findFirst();
  if (existing) return existing;
  return prisma.boxSettings.create({ data: {} });
};

export const adminBoxSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/box/settings', async (_request, reply) => {
    const row = await getOrCreate();
    return reply.send(adminBoxSettingsSchema.parse(serialize(row)));
  });

  app.put('/box/settings', async (request, reply) => {
    const parsed = adminBoxSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'UnprocessableEntity', issues: parsed.error.issues });
    }
    const input = parsed.data;
    const current = await getOrCreate();
    const data: Prisma.BoxSettingsUpdateInput = {};
    if (input.boxEnabled !== undefined) data.boxEnabled = input.boxEnabled;
    if (input.cutoffDaysBeforeRenewal !== undefined)
      data.cutoffDaysBeforeRenewal = input.cutoffDaysBeforeRenewal;
    if (input.headerTitle !== undefined) data.headerTitle = input.headerTitle;
    if (input.headerSubtitle !== undefined) data.headerSubtitle = input.headerSubtitle;
    if (input.freeShippingCepRanges !== undefined)
      data.freeShippingCepRanges = input.freeShippingCepRanges as Prisma.InputJsonValue;
    if (input.shippingFeeCents !== undefined) data.shippingFeeCents = input.shippingFeeCents;
    const updated = await prisma.boxSettings.update({ where: { id: current.id }, data });
    return reply.send(adminBoxSettingsSchema.parse(serialize(updated)));
  });
};
```

- [ ] **Step 4: Register the plugin**

In `apps/api/src/routes/admin/index.ts`:

```typescript
import { adminBoxSettingsRoutes } from './box-settings-admin.js';
// ...
await scope.register(adminBoxSettingsRoutes);
```

- [ ] **Step 5: Persist budget in the existing plan handlers**

In `apps/api/src/routes/admin/premium-catalog-admin.ts`:

- In the POST `/premium/plans` create `data`, add:
  ```typescript
  monthlyBoxBudgetCents: input.monthlyBoxBudgetCents ?? 0,
  ```
- In the PATCH `/premium/plans/:id` data-building block, add:
  ```typescript
  if (input.monthlyBoxBudgetCents !== undefined)
    data.monthlyBoxBudgetCents = input.monthlyBoxBudgetCents;
  ```
- In the plan serializer (`serializePlan`), add:

  ```typescript
  monthlyBoxBudgetCents: plan.monthlyBoxBudgetCents,
  ```

- [ ] **Step 6: Run the tests to confirm they pass**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/api
pnpm exec vitest run test/admin/box-settings-admin.test.ts test/admin/premium-catalog-admin.test.ts
```

Expected: PASS (settings tests pass; the existing premium catalog tests still pass now that the serializer includes the new field, which the schema in Task 4 made required).

- [ ] **Step 7: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add apps/api/src/routes/admin/box-settings-admin.ts apps/api/src/routes/admin/index.ts apps/api/src/routes/admin/premium-catalog-admin.ts apps/api/test/admin/box-settings-admin.test.ts
git commit -m "feat(api): box settings routes + plan budget field"
```

---

## Task 8: Admin - nav, catalog page, image uploader, api client

**Files:**

- Modify: `apps/admin/src/components/authed-nav.tsx`, `apps/admin/middleware.ts`, `apps/admin/src/lib/admin-api.ts`
- Create: `apps/admin/src/components/box-image-uploader.tsx`, `apps/admin/src/lib/box-admin-actions.ts`, `apps/admin/app/(authed)/box/catalogo/page.tsx`, `apps/admin/app/(authed)/box/catalogo/box-catalog-client.tsx`, `apps/admin/src/lib/box-admin-actions.test.ts`

**Interfaces:**

- Consumes: `apiFetch` from `~/lib/api`; box schemas from `@ccc/shared/admin-box`; `presignRequestSchema`, `presignResponseSchema` from `@ccc/shared/uploads`.
- Produces admin-api functions used by later admin tasks:
  - `getBoxCatalog()`, `createBoxCatalogItem(input)`, `updateBoxCatalogItem(id, input)`, `deleteBoxCatalogItem(id)`
  - `getBoxPartners()`, `createBoxPartner(input)`, `updateBoxPartner(id, input)`, `deleteBoxPartner(id)`, `createBoxPartnerModule(id, input)`, `updateBoxPartnerModule(moduleId, input)`, `deleteBoxPartnerModule(moduleId)`
  - `getBoxSettings()`, `updateBoxSettings(input)`
  - `presignBoxImageAction(kind, { contentType, size })`
- Produces server-action state type `BoxFormState = { error: string | null }` and the catalog actions.

- [ ] **Step 1: Add admin-api functions**

Append to `apps/admin/src/lib/admin-api.ts`:

```typescript
import {
  adminBoxCatalogItemSchema,
  adminBoxCatalogListSchema,
  adminBoxSettingsSchema,
  adminPartnerListSchema,
  adminPartnerModuleSchema,
  adminPartnerSchema,
  type AdminBoxCatalogItemCreate,
  type AdminBoxCatalogItemUpdate,
  type AdminBoxSettingsUpdate,
  type AdminPartnerCreate,
  type AdminPartnerModuleCreate,
  type AdminPartnerModuleUpdate,
  type AdminPartnerUpdate,
} from '@ccc/shared/admin-box';

export const getBoxCatalog = () =>
  apiFetch('/admin/box/catalog-items', { schema: adminBoxCatalogListSchema });

export const createBoxCatalogItem = (input: AdminBoxCatalogItemCreate) =>
  apiFetch('/admin/box/catalog-items', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminBoxCatalogItemSchema,
  });

export const updateBoxCatalogItem = (id: string, input: AdminBoxCatalogItemUpdate) =>
  apiFetch(`/admin/box/catalog-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminBoxCatalogItemSchema,
  });

export const deleteBoxCatalogItem = (id: string) =>
  apiFetch(`/admin/box/catalog-items/${id}`, {
    method: 'DELETE',
    schema: adminBoxCatalogItemSchema,
  });

export const getBoxPartners = () =>
  apiFetch('/admin/box/partners', { schema: adminPartnerListSchema });

export const createBoxPartner = (input: AdminPartnerCreate) =>
  apiFetch('/admin/box/partners', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminPartnerSchema,
  });

export const updateBoxPartner = (id: string, input: AdminPartnerUpdate) =>
  apiFetch(`/admin/box/partners/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminPartnerSchema,
  });

export const deleteBoxPartner = (id: string) =>
  apiFetch(`/admin/box/partners/${id}`, { method: 'DELETE', schema: adminPartnerSchema });

export const createBoxPartnerModule = (id: string, input: AdminPartnerModuleCreate) =>
  apiFetch(`/admin/box/partners/${id}/modules`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminPartnerModuleSchema,
  });

export const updateBoxPartnerModule = (moduleId: string, input: AdminPartnerModuleUpdate) =>
  apiFetch(`/admin/box/partner-modules/${moduleId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminPartnerModuleSchema,
  });

export const deleteBoxPartnerModule = (moduleId: string) =>
  apiFetch(`/admin/box/partner-modules/${moduleId}`, {
    method: 'DELETE',
    schema: adminPartnerModuleSchema,
  });

export const getBoxSettings = () =>
  apiFetch('/admin/box/settings', { schema: adminBoxSettingsSchema });

export const updateBoxSettings = (input: AdminBoxSettingsUpdate) =>
  apiFetch('/admin/box/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
    schema: adminBoxSettingsSchema,
  });
```

- [ ] **Step 2: Add the nav entry and staff block**

In `apps/admin/src/components/authed-nav.tsx`, add to `ORGANIZER_LINKS` after the `Premium` entry:

```typescript
  { href: '/box/catalogo', label: 'Box' },
```

In `apps/admin/middleware.ts`, extend the staff-blocked check to include `/box`:

```typescript
if (
  authedRole === 'staff' &&
  (path.startsWith('/events') || path.startsWith('/financeiro') || path.startsWith('/box'))
) {
  return NextResponse.redirect(new URL('/check-in', req.url));
}
```

- [ ] **Step 3: Create the presign action + image uploader**

Add to `apps/admin/src/lib/box-admin-actions.ts` (top of the file; full actions come in later steps):

```typescript
'use server';

import { presignRequestSchema, presignResponseSchema } from '@ccc/shared/uploads';

import { apiFetch } from './api';

type BoxImageKind = 'box_item' | 'partner_logo' | 'partner_module';

export const presignBoxImageAction = async (
  kind: BoxImageKind,
  input: { contentType: string; size: number },
) => {
  const body = presignRequestSchema.parse({ kind, ...input });
  return apiFetch('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify(body),
    schema: presignResponseSchema,
  });
};
```

Create `apps/admin/src/components/box-image-uploader.tsx`:

```typescript
'use client';

import { useState } from 'react';

import { presignBoxImageAction } from '~/lib/box-admin-actions';

type Kind = 'box_item' | 'partner_logo' | 'partner_module';

export const BoxImageUploader = ({
  kind,
  name,
  initialKey,
  initialUrl,
}: {
  kind: Kind;
  name: string;
  initialKey: string | null;
  initialUrl: string | null;
}) => {
  const [objectKey, setObjectKey] = useState<string | null>(initialKey);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Formato invalido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const presign = await presignBoxImageAction(kind, {
        contentType: file.type,
        size: file.size,
      });
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: presign.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`PUT ${put.status}`);
      setObjectKey(presign.objectKey);
      setPreviewUrl(presign.publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-[color:var(--color-muted)]">Imagem</span>
      {previewUrl ? (
        <img src={previewUrl} alt="preview" className="h-24 w-auto rounded object-cover" />
      ) : null}
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => {
          void onChange(e);
        }}
      />
      <input type="hidden" name={name} value={objectKey ?? ''} />
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
};
```

- [ ] **Step 4: Write the failing action test**

Create `apps/admin/src/lib/box-admin-actions.test.ts`. Declare the COMPLETE mock for every box admin-api function up front so Tasks 9 and 10 only append `describe` blocks and never touch this factory (Vitest allows one `vi.mock` per module):

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// All box admin-api fns mocked here once. Later tasks reference these consts.
const createBoxCatalogItem = vi.fn<(input: unknown) => Promise<unknown>>();
const createBoxPartner = vi.fn<(input: unknown) => Promise<unknown>>();
const createBoxPartnerModule = vi.fn<(id: string, input: unknown) => Promise<unknown>>();
const updateBoxSettings = vi.fn<(input: unknown) => Promise<unknown>>();

vi.mock('./admin-api', () => ({
  createBoxCatalogItem: (input: unknown) => createBoxCatalogItem(input),
  updateBoxCatalogItem: vi.fn(),
  deleteBoxCatalogItem: vi.fn(),
  createBoxPartner: (input: unknown) => createBoxPartner(input),
  updateBoxPartner: vi.fn(),
  deleteBoxPartner: vi.fn(),
  createBoxPartnerModule: (id: string, input: unknown) => createBoxPartnerModule(id, input),
  updateBoxPartnerModule: vi.fn(),
  deleteBoxPartnerModule: vi.fn(),
  getBoxPartners: vi.fn(),
  getBoxSettings: vi.fn(),
  updateBoxSettings: (input: unknown) => updateBoxSettings(input),
}));

import { createBoxCatalogItemAction } from './box-admin-actions';

describe('box-admin-actions catalog', () => {
  beforeEach(() => {
    createBoxCatalogItem.mockReset().mockResolvedValue({});
  });

  it('parses form data and forwards to the api', async () => {
    const fd = new FormData();
    fd.set('slug', 'cafe-500g');
    fd.set('title', 'Cafe 500g');
    fd.set('description', 'Cafe especial');
    fd.set('priceCents', '4500');
    fd.set('category', 'bebidas');
    fd.set('active', 'on');
    fd.set('sortOrder', '2');

    const result = await createBoxCatalogItemAction({ error: null }, fd);
    expect(result).toEqual({ error: null });
    expect(createBoxCatalogItem).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'cafe-500g', priceCents: 4500, active: true, sortOrder: 2 }),
    );
  });

  it('returns a validation error for a bad price', async () => {
    const fd = new FormData();
    fd.set('slug', 'x');
    fd.set('title', 'X');
    fd.set('description', 'x');
    fd.set('priceCents', '-1');
    fd.set('category', 'c');
    const result = await createBoxCatalogItemAction({ error: null }, fd);
    expect(result.error).not.toBeNull();
    expect(createBoxCatalogItem).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin
pnpm exec vitest run src/lib/box-admin-actions.test.ts
```

Expected: FAIL (`createBoxCatalogItemAction` not exported).

- [ ] **Step 6: Write the catalog server actions**

Append to `apps/admin/src/lib/box-admin-actions.ts`:

```typescript
import {
  adminBoxCatalogItemCreateSchema,
  adminBoxCatalogItemUpdateSchema,
} from '@ccc/shared/admin-box';
import { revalidatePath } from 'next/cache';

import { createBoxCatalogItem, deleteBoxCatalogItem, updateBoxCatalogItem } from './admin-api';
import { ApiError } from './api';

export type BoxFormState = { error: string | null };

const CATALOG_PATH = '/box/catalogo';

const zodMessage = (issues: { message: string }[]): string =>
  issues.map((i) => i.message).join('; ');
const str = (fd: FormData, key: string): string | undefined => {
  const v = fd.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
};
const num = (fd: FormData, key: string): number | undefined => {
  const v = fd.get(key);
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  return Number(v);
};
const bool = (fd: FormData, key: string): boolean => fd.get(key) === 'on';

export const createBoxCatalogItemAction = async (
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminBoxCatalogItemCreateSchema.safeParse({
    slug: str(fd, 'slug'),
    title: str(fd, 'title'),
    description: str(fd, 'description'),
    priceCents: num(fd, 'priceCents'),
    category: str(fd, 'category'),
    imageObjectKey: str(fd, 'imageObjectKey') ?? null,
    stockPerCycle: num(fd, 'stockPerCycle') ?? null,
    maxPerCycle: num(fd, 'maxPerCycle') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await createBoxCatalogItem(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409) return { error: 'Slug ja existe.' };
      return { error: e.message };
    }
    return { error: 'Erro ao criar item.' };
  }
  revalidatePath(CATALOG_PATH);
  return { error: null };
};

export const updateBoxCatalogItemAction = async (
  id: string,
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminBoxCatalogItemUpdateSchema.safeParse({
    title: str(fd, 'title'),
    description: str(fd, 'description'),
    priceCents: num(fd, 'priceCents'),
    category: str(fd, 'category'),
    imageObjectKey: str(fd, 'imageObjectKey') ?? null,
    stockPerCycle: num(fd, 'stockPerCycle') ?? null,
    maxPerCycle: num(fd, 'maxPerCycle') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updateBoxCatalogItem(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar item.' };
  }
  revalidatePath(CATALOG_PATH);
  return { error: null };
};

export const deleteBoxCatalogItemAction = async (
  id: string,
  _prev: BoxFormState,
  _fd: FormData,
): Promise<BoxFormState> => {
  void _prev;
  void _fd;
  try {
    await deleteBoxCatalogItem(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao desativar item.' };
  }
  revalidatePath(CATALOG_PATH);
  return { error: null };
};
```

- [ ] **Step 7: Run the test to confirm it passes**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin
pnpm exec vitest run src/lib/box-admin-actions.test.ts
```

Expected: PASS (2 cases).

- [ ] **Step 8: Create the catalog page + client**

Create `apps/admin/app/(authed)/box/catalogo/page.tsx`:

```typescript
import { getBoxCatalog } from '~/lib/admin-api';

import { BoxCatalogClient } from './box-catalog-client';

export const dynamic = 'force-dynamic';

export default async function BoxCatalogoPage() {
  const catalog = await getBoxCatalog();
  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Catalogo do box</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Itens que o assinante escolhe dentro do budget mensal.
        </p>
      </header>
      <BoxCatalogClient catalog={catalog} />
    </section>
  );
}
```

Create `apps/admin/app/(authed)/box/catalogo/box-catalog-client.tsx`:

```typescript
'use client';

import type { AdminBoxCatalogList } from '@ccc/shared/admin-box';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { BoxImageUploader } from '~/components/box-image-uploader';
import {
  createBoxCatalogItemAction,
  deleteBoxCatalogItemAction,
  updateBoxCatalogItemAction,
  type BoxFormState,
} from '~/lib/box-admin-actions';

const initial: BoxFormState = { error: null };
const inputCls =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm';
const labelCls = 'flex flex-col gap-1 text-xs text-[color:var(--color-muted)]';

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
    >
      {pending ? '...' : label}
    </button>
  );
};

const Err = ({ state }: { state: BoxFormState }) =>
  state.error ? <span className="text-xs text-red-400">{state.error}</span> : null;

const CreateForm = () => {
  const [state, action] = useActionState(createBoxCatalogItemAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded border border-[color:var(--color-border)] p-4">
      <label className={labelCls}>Slug<input name="slug" required maxLength={140} className={inputCls} /></label>
      <label className={labelCls}>Titulo<input name="title" required maxLength={140} className={inputCls} /></label>
      <label className={labelCls}>Categoria<input name="category" required maxLength={60} className={inputCls} /></label>
      <label className={labelCls}>Preco (centavos)<input name="priceCents" type="number" min={0} required className={`${inputCls} w-28`} /></label>
      <label className={labelCls}>Estoque/ciclo<input name="stockPerCycle" type="number" min={1} className={`${inputCls} w-24`} /></label>
      <label className={labelCls}>Max/ciclo<input name="maxPerCycle" type="number" min={1} className={`${inputCls} w-24`} /></label>
      <label className={labelCls}>Descricao<textarea name="description" required className={inputCls} /></label>
      <BoxImageUploader kind="box_item" name="imageObjectKey" initialKey={null} initialUrl={null} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="active" defaultChecked /> Ativo</label>
      <label className={labelCls}>Ordem<input name="sortOrder" type="number" min={0} defaultValue={0} className={`${inputCls} w-20`} /></label>
      <Submit label="Criar item" />
      <Err state={state} />
    </form>
  );
};

const ItemRow = ({ item }: { item: AdminBoxCatalogList['items'][number] }) => {
  const [state, action] = useActionState(updateBoxCatalogItemAction.bind(null, item.id), initial);
  const [delState, delAction] = useActionState(deleteBoxCatalogItemAction.bind(null, item.id), initial);
  return (
    <article className="flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <span className="text-xs text-[color:var(--color-muted)]">{item.slug}</span>
        <label className={labelCls}>Titulo<input name="title" defaultValue={item.title} maxLength={140} className={inputCls} /></label>
        <label className={labelCls}>Categoria<input name="category" defaultValue={item.category} maxLength={60} className={inputCls} /></label>
        <label className={labelCls}>Preco<input name="priceCents" type="number" min={0} defaultValue={item.priceCents} className={`${inputCls} w-28`} /></label>
        <label className={labelCls}>Estoque/ciclo<input name="stockPerCycle" type="number" min={1} defaultValue={item.stockPerCycle ?? ''} className={`${inputCls} w-24`} /></label>
        <label className={labelCls}>Max/ciclo<input name="maxPerCycle" type="number" min={1} defaultValue={item.maxPerCycle ?? ''} className={`${inputCls} w-24`} /></label>
        <label className={labelCls}>Descricao<textarea name="description" defaultValue={item.description} className={inputCls} /></label>
        <BoxImageUploader kind="box_item" name="imageObjectKey" initialKey={item.imageObjectKey} initialUrl={null} />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="active" defaultChecked={item.active} /> Ativo</label>
        <label className={labelCls}>Ordem<input name="sortOrder" type="number" min={0} defaultValue={item.sortOrder} className={`${inputCls} w-20`} /></label>
        <Submit label="Salvar" />
        <Err state={state} />
      </form>
      <form action={delAction}>
        <button type="submit" className="text-xs text-red-400 underline">Desativar</button>
        <Err state={delState} />
      </form>
    </article>
  );
};

export const BoxCatalogClient = ({ catalog }: { catalog: AdminBoxCatalogList }) => (
  <div className="flex flex-col gap-6">
    <CreateForm />
    <div className="flex flex-col gap-4">
      {catalog.items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </div>
  </div>
);
```

- [ ] **Step 9: Typecheck the admin app**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin
pnpm exec tsc -p tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add apps/admin/src/lib/admin-api.ts apps/admin/src/components/authed-nav.tsx apps/admin/middleware.ts apps/admin/src/lib/box-admin-actions.ts apps/admin/src/components/box-image-uploader.tsx apps/admin/app/\(authed\)/box/catalogo apps/admin/src/lib/box-admin-actions.test.ts
git commit -m "feat(admin): box catalog admin page + api client + uploader"
```

---

## Task 9: Admin - partners page

**Files:**

- Modify: `apps/admin/src/lib/box-admin-actions.ts` (append partner actions)
- Create: `apps/admin/app/(authed)/box/parceiros/page.tsx`, `apps/admin/app/(authed)/box/parceiros/box-partners-client.tsx`
- Test: `apps/admin/src/lib/box-admin-actions.test.ts` (append)

**Interfaces:**

- Consumes: `createBoxPartner`, `updateBoxPartner`, `deleteBoxPartner`, `createBoxPartnerModule`, `updateBoxPartnerModule`, `deleteBoxPartnerModule`, `getBoxPartners` from `./admin-api`; `adminPartnerCreateSchema`, `adminPartnerModuleCreateSchema` from `@ccc/shared/admin-box`.
- Produces server actions: `createPartnerAction`, `updatePartnerAction(id)`, `deletePartnerAction(id)`, `createPartnerModuleAction(partnerId)`, `updatePartnerModuleAction(moduleId)`, `deletePartnerModuleAction(moduleId)`.

- [ ] **Step 1: Write the failing test (append)**

Append to `apps/admin/src/lib/box-admin-actions.test.ts`. The mock factory and the `createBoxPartner` / `createBoxPartnerModule` consts are already declared at the top of the file (Task 8 Step 4); do NOT redeclare `vi.mock`. Just add the import and a new `describe` block:

```typescript
import { createPartnerAction, createPartnerModuleAction } from './box-admin-actions';

describe('box-admin-actions partners', () => {
  beforeEach(() => {
    createBoxPartner.mockReset().mockResolvedValue({});
    createBoxPartnerModule.mockReset().mockResolvedValue({});
  });

  it('creates a partner from form data', async () => {
    const fd = new FormData();
    fd.set('slug', 'oficina-x');
    fd.set('name', 'Oficina X');
    fd.set('active', 'on');
    const result = await createPartnerAction({ error: null }, fd);
    expect(result).toEqual({ error: null });
    expect(createBoxPartner).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'oficina-x', name: 'Oficina X', active: true }),
    );
  });

  it('creates a module bound to a partner id', async () => {
    const fd = new FormData();
    fd.set('name', 'Kit');
    fd.set('priceCents', '9900');
    fd.set('active', 'on');
    const result = await createPartnerModuleAction('p1', { error: null }, fd);
    expect(result).toEqual({ error: null });
    expect(createBoxPartnerModule).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ name: 'Kit', priceCents: 9900 }),
    );
  });
});
```

Note: this test replaces the earlier `vi.mock('./admin-api', ...)` block from Task 8 Step 4 with the expanded one above (Vitest hoists a single mock per module). Keep the earlier `createBoxCatalogItem` const declaration; move the `vi.mock` to this expanded version and delete the Task 8 one.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin
pnpm exec vitest run src/lib/box-admin-actions.test.ts
```

Expected: FAIL (`createPartnerAction` not exported).

- [ ] **Step 3: Append partner actions**

Append to `apps/admin/src/lib/box-admin-actions.ts`:

```typescript
import {
  adminPartnerCreateSchema,
  adminPartnerModuleCreateSchema,
  adminPartnerModuleUpdateSchema,
  adminPartnerUpdateSchema,
} from '@ccc/shared/admin-box';

import {
  createBoxPartner,
  createBoxPartnerModule,
  deleteBoxPartner,
  deleteBoxPartnerModule,
  updateBoxPartner,
  updateBoxPartnerModule,
} from './admin-api';

const PARTNERS_PATH = '/box/parceiros';

export const createPartnerAction = async (
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminPartnerCreateSchema.safeParse({
    slug: str(fd, 'slug'),
    name: str(fd, 'name'),
    description: str(fd, 'description') ?? null,
    logoObjectKey: str(fd, 'logoObjectKey') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await createBoxPartner(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.status === 409 ? 'Slug ja existe.' : e.message };
    return { error: 'Erro ao criar parceiro.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const updatePartnerAction = async (
  id: string,
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminPartnerUpdateSchema.safeParse({
    name: str(fd, 'name'),
    description: str(fd, 'description') ?? null,
    logoObjectKey: str(fd, 'logoObjectKey') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updateBoxPartner(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar parceiro.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const deletePartnerAction = async (
  id: string,
  _prev: BoxFormState,
  _fd: FormData,
): Promise<BoxFormState> => {
  void _prev;
  void _fd;
  try {
    await deleteBoxPartner(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao desativar parceiro.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const createPartnerModuleAction = async (
  partnerId: string,
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminPartnerModuleCreateSchema.safeParse({
    name: str(fd, 'name'),
    description: str(fd, 'description') ?? null,
    priceCents: num(fd, 'priceCents'),
    imageObjectKey: str(fd, 'imageObjectKey') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await createBoxPartnerModule(partnerId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao criar modulo.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const updatePartnerModuleAction = async (
  moduleId: string,
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminPartnerModuleUpdateSchema.safeParse({
    name: str(fd, 'name'),
    description: str(fd, 'description') ?? null,
    priceCents: num(fd, 'priceCents'),
    imageObjectKey: str(fd, 'imageObjectKey') ?? null,
    active: bool(fd, 'active'),
    sortOrder: num(fd, 'sortOrder'),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updateBoxPartnerModule(moduleId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar modulo.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};

export const deletePartnerModuleAction = async (
  moduleId: string,
  _prev: BoxFormState,
  _fd: FormData,
): Promise<BoxFormState> => {
  void _prev;
  void _fd;
  try {
    await deleteBoxPartnerModule(moduleId);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao desativar modulo.' };
  }
  revalidatePath(PARTNERS_PATH);
  return { error: null };
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin
pnpm exec vitest run src/lib/box-admin-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Create the partners page + client**

Create `apps/admin/app/(authed)/box/parceiros/page.tsx`:

```typescript
import { getBoxPartners } from '~/lib/admin-api';

import { BoxPartnersClient } from './box-partners-client';

export const dynamic = 'force-dynamic';

export default async function BoxParceirosPage() {
  const data = await getBoxPartners();
  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Parceiros</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Cada parceiro oferece modulos cobrados a parte do budget.
        </p>
      </header>
      <BoxPartnersClient data={data} />
    </section>
  );
}
```

Create `apps/admin/app/(authed)/box/parceiros/box-partners-client.tsx`:

```typescript
'use client';

import type { AdminPartnerList } from '@ccc/shared/admin-box';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { BoxImageUploader } from '~/components/box-image-uploader';
import {
  createPartnerAction,
  createPartnerModuleAction,
  deletePartnerAction,
  deletePartnerModuleAction,
  updatePartnerAction,
  updatePartnerModuleAction,
  type BoxFormState,
} from '~/lib/box-admin-actions';

const initial: BoxFormState = { error: null };
const inputCls =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm';
const labelCls = 'flex flex-col gap-1 text-xs text-[color:var(--color-muted)]';

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50">
      {pending ? '...' : label}
    </button>
  );
};
const Err = ({ state }: { state: BoxFormState }) =>
  state.error ? <span className="text-xs text-red-400">{state.error}</span> : null;

const ModuleRow = ({ mod }: { mod: AdminPartnerList['partners'][number]['modules'][number] }) => {
  const [state, action] = useActionState(updatePartnerModuleAction.bind(null, mod.id), initial);
  const [delState, delAction] = useActionState(deletePartnerModuleAction.bind(null, mod.id), initial);
  return (
    <div className="flex flex-col gap-2 rounded border border-[color:var(--color-border)] p-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className={labelCls}>Nome<input name="name" defaultValue={mod.name} maxLength={80} className={inputCls} /></label>
        <label className={labelCls}>Preco<input name="priceCents" type="number" min={0} defaultValue={mod.priceCents} className={`${inputCls} w-28`} /></label>
        <label className={labelCls}>Descricao<input name="description" defaultValue={mod.description ?? ''} maxLength={240} className={inputCls} /></label>
        <BoxImageUploader kind="partner_module" name="imageObjectKey" initialKey={mod.imageObjectKey} initialUrl={null} />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="active" defaultChecked={mod.active} /> Ativo</label>
        <label className={labelCls}>Ordem<input name="sortOrder" type="number" min={0} defaultValue={mod.sortOrder} className={`${inputCls} w-20`} /></label>
        <Submit label="Salvar modulo" />
        <Err state={state} />
      </form>
      <form action={delAction}>
        <button type="submit" className="text-xs text-red-400 underline">Desativar modulo</button>
        <Err state={delState} />
      </form>
    </div>
  );
};

const AddModuleForm = ({ partnerId }: { partnerId: string }) => {
  const [state, action] = useActionState(createPartnerModuleAction.bind(null, partnerId), initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-t border-[color:var(--color-border)] pt-3">
      <label className={labelCls}>Novo modulo<input name="name" required maxLength={80} className={inputCls} /></label>
      <label className={labelCls}>Preco<input name="priceCents" type="number" min={0} required className={`${inputCls} w-28`} /></label>
      <label className={labelCls}>Descricao<input name="description" maxLength={240} className={inputCls} /></label>
      <BoxImageUploader kind="partner_module" name="imageObjectKey" initialKey={null} initialUrl={null} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="active" defaultChecked /> Ativo</label>
      <label className={labelCls}>Ordem<input name="sortOrder" type="number" min={0} defaultValue={0} className={`${inputCls} w-20`} /></label>
      <Submit label="Adicionar modulo" />
      <Err state={state} />
    </form>
  );
};

const PartnerCard = ({ partner }: { partner: AdminPartnerList['partners'][number] }) => {
  const [state, action] = useActionState(updatePartnerAction.bind(null, partner.id), initial);
  const [delState, delAction] = useActionState(deletePartnerAction.bind(null, partner.id), initial);
  return (
    <article className="flex flex-col gap-4 rounded border border-[color:var(--color-border)] p-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <span className="text-xs text-[color:var(--color-muted)]">{partner.slug}</span>
        <label className={labelCls}>Nome<input name="name" defaultValue={partner.name} maxLength={80} className={inputCls} /></label>
        <label className={labelCls}>Descricao<input name="description" defaultValue={partner.description ?? ''} maxLength={240} className={inputCls} /></label>
        <BoxImageUploader kind="partner_logo" name="logoObjectKey" initialKey={partner.logoObjectKey} initialUrl={null} />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="active" defaultChecked={partner.active} /> Ativo</label>
        <label className={labelCls}>Ordem<input name="sortOrder" type="number" min={0} defaultValue={partner.sortOrder} className={`${inputCls} w-20`} /></label>
        <Submit label="Salvar parceiro" />
        <Err state={state} />
      </form>
      <div className="flex flex-col gap-2">
        {partner.modules.map((mod) => (
          <ModuleRow key={mod.id} mod={mod} />
        ))}
        <AddModuleForm partnerId={partner.id} />
      </div>
      <form action={delAction}>
        <button type="submit" className="text-xs text-red-400 underline">Desativar parceiro</button>
        <Err state={delState} />
      </form>
    </article>
  );
};

const CreatePartnerForm = () => {
  const [state, action] = useActionState(createPartnerAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded border border-[color:var(--color-border)] p-4">
      <label className={labelCls}>Slug<input name="slug" required maxLength={60} className={inputCls} /></label>
      <label className={labelCls}>Nome<input name="name" required maxLength={80} className={inputCls} /></label>
      <label className={labelCls}>Descricao<input name="description" maxLength={240} className={inputCls} /></label>
      <BoxImageUploader kind="partner_logo" name="logoObjectKey" initialKey={null} initialUrl={null} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="active" defaultChecked /> Ativo</label>
      <label className={labelCls}>Ordem<input name="sortOrder" type="number" min={0} defaultValue={0} className={`${inputCls} w-20`} /></label>
      <Submit label="Criar parceiro" />
      <Err state={state} />
    </form>
  );
};

export const BoxPartnersClient = ({ data }: { data: AdminPartnerList }) => (
  <div className="flex flex-col gap-6">
    <CreatePartnerForm />
    <div className="flex flex-col gap-4">
      {data.partners.map((partner) => (
        <PartnerCard key={partner.id} partner={partner} />
      ))}
    </div>
  </div>
);
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin
pnpm exec tsc -p tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add apps/admin/src/lib/box-admin-actions.ts apps/admin/app/\(authed\)/box/parceiros apps/admin/src/lib/box-admin-actions.test.ts
git commit -m "feat(admin): box partners admin page"
```

---

## Task 10: Admin - box settings page + plan budget field

**Files:**

- Modify: `apps/admin/src/lib/box-admin-actions.ts` (append settings action)
- Create: `apps/admin/app/(authed)/box/config/page.tsx`, `apps/admin/app/(authed)/box/config/box-settings-client.tsx`
- Modify: `apps/admin/app/(authed)/premium/catalogo/premium-catalog-client.tsx` (add budget input)
- Test: `apps/admin/src/lib/box-admin-actions.test.ts` (append)

**Interfaces:**

- Consumes: `getBoxSettings`, `updateBoxSettings` from `./admin-api`; `adminBoxSettingsUpdateSchema` from `@ccc/shared/admin-box`.
- Produces server action: `updateBoxSettingsAction`.

- [ ] **Step 1: Write the failing test (append)**

Append to `apps/admin/src/lib/box-admin-actions.test.ts`. The `updateBoxSettings` const and its mock entry are already declared at the top of the file (Task 8 Step 4); do NOT redeclare them. Just add the import and a new `describe` block:

```typescript
import { updateBoxSettingsAction } from './box-admin-actions';

describe('box-admin-actions settings', () => {
  beforeEach(() => {
    updateBoxSettings.mockReset().mockResolvedValue({});
  });

  it('parses cutoff, fee, and cep ranges from form data', async () => {
    const fd = new FormData();
    fd.set('boxEnabled', 'on');
    fd.set('cutoffDaysBeforeRenewal', '7');
    fd.set('shippingFeeCents', '1990');
    fd.set('freeShippingCepRanges', '80000-000:83800-999\n81000-000:81999-999');
    const result = await updateBoxSettingsAction({ error: null }, fd);
    expect(result).toEqual({ error: null });
    expect(updateBoxSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        boxEnabled: true,
        cutoffDaysBeforeRenewal: 7,
        shippingFeeCents: 1990,
        freeShippingCepRanges: [
          { from: '80000-000', to: '83800-999' },
          { from: '81000-000', to: '81999-999' },
        ],
      }),
    );
  });

  it('rejects a malformed cep line', async () => {
    const fd = new FormData();
    fd.set('freeShippingCepRanges', 'bad-line');
    const result = await updateBoxSettingsAction({ error: null }, fd);
    expect(result.error).not.toBeNull();
    expect(updateBoxSettings).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin
pnpm exec vitest run src/lib/box-admin-actions.test.ts
```

Expected: FAIL (`updateBoxSettingsAction` not exported).

- [ ] **Step 3: Append the settings action**

Append to `apps/admin/src/lib/box-admin-actions.ts`:

```typescript
import { adminBoxSettingsUpdateSchema } from '@ccc/shared/admin-box';

import { updateBoxSettings } from './admin-api';

const SETTINGS_PATH = '/box/config';

// CEP ranges arrive as newline-separated "from:to" lines from a textarea.
const parseCepRanges = (raw: string | undefined): { from: string; to: string }[] =>
  (raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [from, to] = line.split(':');
      return { from: (from ?? '').trim(), to: (to ?? '').trim() };
    });

export const updateBoxSettingsAction = async (
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const parsed = adminBoxSettingsUpdateSchema.safeParse({
    boxEnabled: bool(fd, 'boxEnabled'),
    cutoffDaysBeforeRenewal: num(fd, 'cutoffDaysBeforeRenewal'),
    headerTitle: str(fd, 'headerTitle') ?? null,
    headerSubtitle: str(fd, 'headerSubtitle') ?? null,
    shippingFeeCents: num(fd, 'shippingFeeCents'),
    freeShippingCepRanges: parseCepRanges(str(fd, 'freeShippingCepRanges')),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updateBoxSettings(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar configuracoes.' };
  }
  revalidatePath(SETTINGS_PATH);
  return { error: null };
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin
pnpm exec vitest run src/lib/box-admin-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Create the settings page + client**

Create `apps/admin/app/(authed)/box/config/page.tsx`:

```typescript
import { getBoxSettings } from '~/lib/admin-api';

import { BoxSettingsClient } from './box-settings-client';

export const dynamic = 'force-dynamic';

export default async function BoxConfigPage() {
  const settings = await getBoxSettings();
  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Configuracoes do box</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Cutoff, frete e textos. Frete gratis por faixa de CEP (Curitiba e regiao).
        </p>
      </header>
      <BoxSettingsClient settings={settings} />
    </section>
  );
}
```

Create `apps/admin/app/(authed)/box/config/box-settings-client.tsx`:

```typescript
'use client';

import type { AdminBoxSettings } from '@ccc/shared/admin-box';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { updateBoxSettingsAction, type BoxFormState } from '~/lib/box-admin-actions';

const initial: BoxFormState = { error: null };
const inputCls =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm';
const labelCls = 'flex flex-col gap-1 text-xs text-[color:var(--color-muted)]';

const Submit = () => {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50">
      {pending ? '...' : 'Salvar configuracoes'}
    </button>
  );
};

export const BoxSettingsClient = ({ settings }: { settings: AdminBoxSettings }) => {
  const [state, action] = useActionState(updateBoxSettingsAction, initial);
  const cepText = settings.freeShippingCepRanges.map((r) => `${r.from}:${r.to}`).join('\n');
  return (
    <form action={action} className="flex flex-col gap-4 rounded border border-[color:var(--color-border)] p-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="boxEnabled" defaultChecked={settings.boxEnabled} /> Box habilitado
      </label>
      <label className={labelCls}>
        Dias de cutoff antes da renovacao
        <input name="cutoffDaysBeforeRenewal" type="number" min={0} max={28} defaultValue={settings.cutoffDaysBeforeRenewal} className={`${inputCls} w-24`} />
      </label>
      <label className={labelCls}>
        Titulo do header
        <input name="headerTitle" maxLength={140} defaultValue={settings.headerTitle ?? ''} className={inputCls} />
      </label>
      <label className={labelCls}>
        Subtitulo do header
        <input name="headerSubtitle" maxLength={240} defaultValue={settings.headerSubtitle ?? ''} className={inputCls} />
      </label>
      <label className={labelCls}>
        Frete padrao fora da regiao (centavos)
        <input name="shippingFeeCents" type="number" min={0} defaultValue={settings.shippingFeeCents} className={`${inputCls} w-28`} />
      </label>
      <label className={labelCls}>
        Faixas de CEP com frete gratis (uma por linha, formato de:ate)
        <textarea name="freeShippingCepRanges" rows={4} defaultValue={cepText} className={inputCls} placeholder="80000-000:83800-999" />
      </label>
      <div className="flex items-center gap-3">
        <Submit />
        {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
      </div>
    </form>
  );
};
```

- [ ] **Step 6: Add the budget field to the premium plan form**

In `apps/admin/app/(authed)/premium/catalogo/premium-catalog-client.tsx`, inside the plan detail `<form action={detailAction}>` (the one posting name/description/active/sortOrder), add a budget input:

```typescript
        <label className={labelCls}>
          Budget do box (centavos)
          <input
            name="monthlyBoxBudgetCents"
            type="number"
            min={0}
            defaultValue={plan.monthlyBoxBudgetCents}
            className={`${inputCls} w-32`}
          />
        </label>
```

In `apps/admin/src/lib/premium-catalog-actions.ts`, in `updatePlanAction`'s `safeParse` object, add:

```typescript
    monthlyBoxBudgetCents: num(fd, 'monthlyBoxBudgetCents'),
```

(`num` helper already exists in that file.)

- [ ] **Step 7: Typecheck + full admin unit tests**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec vitest run
```

Expected: no type errors; all admin unit tests pass (including the existing premium catalog action test, since `num(fd, 'monthlyBoxBudgetCents')` returns `undefined` when the field is absent).

- [ ] **Step 8: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add apps/admin/src/lib/box-admin-actions.ts apps/admin/app/\(authed\)/box/config apps/admin/app/\(authed\)/premium/catalogo/premium-catalog-client.tsx apps/admin/src/lib/premium-catalog-actions.ts apps/admin/src/lib/box-admin-actions.test.ts
git commit -m "feat(admin): box settings page + plan budget field"
```

---

## Task 11: Seed default BoxSettings

**Files:**

- Modify: `packages/db/prisma/seed.ts`

**Interfaces:**

- Consumes: `prisma.boxSettings`.
- Produces: one `BoxSettings` row after seeding (idempotent).

- [ ] **Step 1: Add a seed function**

In `packages/db/prisma/seed.ts`, add a function and call it from the main seed runner (follow the existing pattern where each `seedX` is awaited in `main`):

```typescript
const seedBoxSettings = async (): Promise<void> => {
  const existing = await prisma.boxSettings.findFirst();
  if (existing) return;
  await prisma.boxSettings.create({
    data: {
      boxEnabled: false,
      cutoffDaysBeforeRenewal: 5,
      headerTitle: 'Sua caixa do mes',
      shippingFeeCents: 0,
      freeShippingCepRanges: [{ from: '80000-000', to: '83800-999' }],
    },
  });
};
```

Add `await seedBoxSettings();` alongside the other seed calls in the main runner.

- [ ] **Step 2: Run the seed against the dev DB**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/db
pnpm db:seed
```

Expected: completes with no error; running it twice does not create a second row (idempotent guard).

- [ ] **Step 3: Verify the row exists**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/db
pnpm exec prisma studio
```

Expected: `BoxSettings` table has exactly one row with `boxEnabled=false`. (Close Studio when done. If a headless check is preferred, query via a one-off `node`/`tsx` script instead.)

- [ ] **Step 4: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git add packages/db/prisma/seed.ts
git commit -m "chore(db): seed default box settings"
```

---

## Final Verification

- [ ] **Run the full API integration suite** (spins up Testcontainers Postgres, runs all migrations):

```bash
cd /Users/pedro/Projects/ccc/ccc-app/apps/api
pnpm exec vitest run
```

Expected: all tests pass, including the three new box admin suites and the existing premium catalog suite.

- [ ] **Run shared + admin unit suites:**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/packages/shared && pnpm exec vitest run
cd /Users/pedro/Projects/ccc/ccc-app/apps/admin && pnpm exec vitest run
```

Expected: all pass.

- [ ] **Open a PR to `main`** (never to `production`):

```bash
cd /Users/pedro/Projects/ccc/ccc-app
git push -u origin feat/box-builder-design
gh pr create --base main --title "Box Builder Fase 1: config schema + admin" --body "Config side of Box Builder: catalog, partners, budget, settings. Runtime models deferred to Fase 2."
```
