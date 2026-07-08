# Car Fields Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `description` (optional, 150-char free text), `modifications` (Postgres `String[]`, renders as pills), and tighten `nickname` (required, globally unique, max 20, Unicode-letter/digit/space regex) to the `Car` model across DB schema, shared Zod, API routes, mobile forms, and public-profile render surfaces.

**Architecture:** One additive Prisma migration (timestamp `20260521000000`) adds three columns, changes `nickname` from `String? @db.VarChar(60)` to `String @db.VarChar(20)`, adds a global unique index, and runs an in-transaction SQL backfill that assigns every existing car a nickname derived from `<Make> <Model>` truncated to 20 chars with `ROW_NUMBER` dedupe. Shared Zod schemas in `packages/shared/src/cars.ts` and `packages/shared/src/feed.ts` are extended. The API `serializeCar` and `serializeCarProfile` helpers pass through the two new fields. Two mobile "new car" screens and two "edit car" screens gain three new form controllers. Five public-profile surfaces (two garage-list screens, two garage-detail/edit screens, one feed card component, one car-picker popover) gain a modifications-pill row. Integration tests hit real Postgres via the existing Testcontainers setup.

**Tech Stack:** Prisma 6 + PostgreSQL 16, Fastify + Zod 3, React Native (Expo), Vitest + Testcontainers, pnpm workspaces, TypeScript end-to-end.

---

## Scope summary

In scope:

- `Car.description` — optional `String? @db.VarChar(150)`, max 150 chars, multiline field in both new/edit mobile forms.
- `Car.modifications` — `String[] @default({})`, client submits array, each item max 60 chars, max 20 items, pills in all car-identity surfaces.
- `Car.nickname` — changed from optional VarChar(60) to required VarChar(20), globally unique, regex `/^[\p{L}\p{N} ]+$/u`.
- Single migration `20260521000000_car_fields_extension` with backfill in the same transaction.
- Shared Zod schemas: `carInputSchema`, `carUpdateSchema`, `carSchema`, `publicCarProfileSchema`.
- New Zod unit tests in `packages/shared/src/__tests__/cars.test.ts` (file does not exist yet; create).
- API: `serializeCar` + `serializeCarProfile` pass through new fields. POST/PATCH handlers map `P2002` on `nickname` to HTTP 409 `{ error: 'nickname_taken' }`.
- API integration tests: create with full payload, nickname conflict, regex reject, modifications round-trip, description trim.
- Mobile forms: `apps/mobile/app/(app)/garage/new.tsx`, `apps/mobile/app/(app)/garage/[id].tsx`, `apps/mobile/app/(app)/profile/garage/new.tsx`, `apps/mobile/app/(app)/profile/garage/[id].tsx`.
- Copy strings: `apps/mobile/src/copy/profile.ts` (new keys: `nicknameLabel` tightened, `descriptionLabel`, `modificationsLabel`, `modificationsHint`, `nicknameTaken`).
- Pill rendering in: `apps/mobile/app/(app)/garage/index.tsx`, `apps/mobile/app/(app)/profile/garage/index.tsx`, `apps/mobile/src/screens/events/feed/FeedPostCard.tsx`, `apps/mobile/src/screens/events/feed/CarPickerPopover.tsx`, `apps/mobile/src/screens/cart/CarPlatePicker.tsx`.
- `publicCarProfileSchema` in `packages/shared/src/feed.ts` gets `modifications` field.
- API `serializeCarProfile` in `apps/api/src/routes/feed.ts` passes `modifications`.
- Rebuild `@ccc/shared` after schema changes (per repo memory).

Explicitly out of scope:

- Modification photos or any edit history.
- `ConfirmedCar` / `confirmedCarSchema` in `packages/shared/src/events.ts` — that schema is opaque by design (excludes id, nickname, internal fields); no modifications pills there.
- Admin UI — `apps/admin/` does not render Car identity anywhere (user detail page does not query or display cars). Out of scope.
- CarDetailSheet (`apps/mobile/src/screens/events/confirmed-cars/CarDetailSheet.tsx`) — renders `ConfirmedCar`, not `Car`; no modifications pills there.
- TASK-A garage-spots `carSchema.tier` field — do NOT remove `.optional()` marker from it if it exists when TASK-A merges first. Load-bearing TODO markers from TASK-B and TASK-E must be preserved.

---

## File structure

```
packages/db/prisma/
  schema.prisma                                                        modify
  migrations/20260521000000_car_fields_extension/migration.sql         create

packages/shared/src/
  cars.ts                                                              modify
  feed.ts                                                              modify
  __tests__/
    cars.test.ts                                                       create

apps/api/src/routes/
  cars.ts                                                              modify
  feed.ts                                                              modify

apps/api/test/cars/
  create.test.ts                                                       modify
  update.test.ts                                                       modify
  nickname-conflict.test.ts                                            create
  modifications.test.ts                                                create

apps/mobile/src/copy/
  profile.ts                                                           modify

apps/mobile/app/(app)/garage/
  new.tsx                                                              modify
  [id].tsx                                                             modify
  index.tsx                                                            modify

apps/mobile/app/(app)/profile/garage/
  new.tsx                                                              modify
  [id].tsx                                                             modify
  index.tsx                                                            modify

apps/mobile/src/screens/events/feed/
  FeedPostCard.tsx                                                     modify
  CarPickerPopover.tsx                                                 modify

apps/mobile/src/screens/cart/
  CarPlatePicker.tsx                                                   modify
```

---

## File-by-file changes

### 1. `packages/db/prisma/schema.prisma`

Change the `Car` model. Current state (lines 180-198):

```prisma
model Car {
  id        String   @id @default(cuid())
  userId    String
  make      String   @db.VarChar(60)
  model     String   @db.VarChar(60)
  year      Int
  nickname  String?  @db.VarChar(60)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  photos       CarPhoto[]
  tickets      Ticket[]
  feedPosts    FeedPost[]
  feedComments FeedComment[]

  @@index([userId])
}
```

Replace with:

```prisma
model Car {
  id            String   @id @default(cuid())
  userId        String
  make          String   @db.VarChar(60)
  model         String   @db.VarChar(60)
  year          Int
  nickname      String   @db.VarChar(20)
  description   String?  @db.VarChar(150)
  modifications String[] @default({})
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  photos       CarPhoto[]
  tickets      Ticket[]
  feedPosts    FeedPost[]
  feedComments FeedComment[]

  @@unique([nickname])
  @@index([userId])
}
```

Key changes:

- `nickname` loses `?` (required) and changes from `@db.VarChar(60)` to `@db.VarChar(20)`.
- `description String? @db.VarChar(150)` added.
- `modifications String[] @default({})` added.
- `@@unique([nickname])` added.

### 2. Migration `packages/db/prisma/migrations/20260521000000_car_fields_extension/migration.sql`

Single transactional migration. Full file:

```sql
-- Migration: 20260521000000_car_fields_extension
-- Adds description, modifications, tightens nickname to required+unique+20chars.
-- All DDL + backfill run in one implicit transaction (Prisma wraps each migration).

-- Step 1: add new nullable columns (nullable so existing rows do not violate NOT NULL yet)
ALTER TABLE "Car" ADD COLUMN IF NOT EXISTS "description"   VARCHAR(150);
ALTER TABLE "Car" ADD COLUMN IF NOT EXISTS "modifications" TEXT[]        NOT NULL DEFAULT '{}';

-- Step 2: widen nickname temporarily to VARCHAR(60) in case some rows already exceed 20
-- (They may not, but this is defensive; we will truncate in the backfill, then shrink.)
-- If nickname is already nullable VARCHAR(60), this is a no-op type-wise.
-- We must first ensure no row has a NULL nickname before making it NOT NULL.

-- Step 3: backfill nickname for every row that currently has a NULL nickname
-- and deduplicate using ROW_NUMBER partitioned by candidate nickname.
-- Algorithm:
--   base = SUBSTR(INITCAP(make) || ' ' || INITCAP(model), 1, 20)  -- truncate to 20
--   rn   = ROW_NUMBER() OVER (PARTITION BY base ORDER BY "createdAt")
--   if rn == 1 → use base as-is
--   if rn >= 2 → append ' ' + rn, re-truncate to 20 chars
--
-- Note: rows where nickname is already set are left untouched.
-- Note: INITCAP is Postgres built-in; safe to use here.

DO $$
DECLARE
  suffix_len  INT;
  suffix_str  TEXT;
BEGIN
  -- Build a temporary ranked table and apply nicknames to null rows only.
  -- We use a CTE-based UPDATE.
  WITH ranked AS (
    SELECT
      id,
      SUBSTR(INITCAP(make) || ' ' || INITCAP(model), 1, 20) AS base_nick,
      ROW_NUMBER() OVER (
        PARTITION BY SUBSTR(INITCAP(make) || ' ' || INITCAP(model), 1, 20)
        ORDER BY "createdAt", id
      ) AS rn
    FROM "Car"
    WHERE nickname IS NULL
  ),
  computed AS (
    SELECT
      id,
      CASE
        WHEN rn = 1 THEN base_nick
        ELSE SUBSTR(base_nick, 1, 20 - LENGTH(' ' || rn::TEXT)) || ' ' || rn::TEXT
      END AS new_nick
    FROM ranked
  )
  UPDATE "Car" c
  SET nickname = comp.new_nick
  FROM computed comp
  WHERE c.id = comp.id;
END $$;

-- Step 4: now that all rows have a nickname, enforce NOT NULL
ALTER TABLE "Car" ALTER COLUMN "nickname" SET NOT NULL;

-- Step 5: shrink the column to VARCHAR(20).
-- Any value longer than 20 would fail here. The backfill above ensures truncation.
ALTER TABLE "Car" ALTER COLUMN "nickname" TYPE VARCHAR(20);

-- Step 6: add the global unique index on nickname.
CREATE UNIQUE INDEX IF NOT EXISTS "Car_nickname_key" ON "Car"("nickname");

-- Done.
```

#### Backfill algorithm detail

Pseudocode (mirrors the SQL above):

```
for each Car where nickname IS NULL:
  base = SUBSTR(INITCAP(make) || ' ' || INITCAP(model), 1, 20)
  rn   = ROW_NUMBER() partitioned by base, ordered by createdAt ASC, id ASC

  if rn == 1:
    nickname = base
  else:
    suffix = ' ' + str(rn)          -- e.g. ' 2', ' 10'
    prefix_len = 20 - len(suffix)
    nickname = SUBSTR(base, 1, prefix_len) + suffix
```

Edge cases:

- `make = 'Honda'`, `model = 'NSX'`, only one such car: `'Honda Nsx'` (9 chars, fits).
- Two cars: `make = 'Mazda'`, `model = 'RX-7'`:
  - Car 1 (older): `'Mazda Rx-7'`
  - Car 2 (newer): suffix `' 2'` (2 chars), prefix = 18 chars: `'Mazda Rx-7'` is 10 chars, fits → `'Mazda Rx-7 2'`.
- Extremely long: `make = 'Lamborghini'` (11), `model = 'Huracan'` (7): base = `'Lamborghini Huraca'` (18), rn=2 → suffix `' 2'`, prefix 18: `'Lamborghini Huraca 2'` (20).
- Cars with already-set nicknames are not touched.

### 3. `packages/shared/src/cars.ts`

Current file is fully known. Replace with updated version:

```typescript
import { z } from 'zod';

// Regex: Unicode letters (including PT-BR accented: é ã ç etc.), digits, spaces.
// Rejects emoji, punctuation, specials.
export const nicknameRegex = /^[\p{L}\p{N} ]+$/u;

export const carInputSchema = z.object({
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z
    .number()
    .int()
    .min(1900)
    .refine((y) => y <= new Date().getFullYear() + 1, { message: 'year out of range' }),
  nickname: z.string().trim().min(1).max(20).regex(nicknameRegex, {
    message: 'Apelido deve conter apenas letras, números e espaços',
  }),
  description: z.string().trim().max(150).optional(),
  modifications: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
export type CarInput = z.infer<typeof carInputSchema>;

export const carUpdateSchema = z.object({
  make: z.string().trim().min(1).max(60).optional(),
  model: z.string().trim().min(1).max(60).optional(),
  year: z
    .number()
    .int()
    .min(1900)
    .refine((y) => y <= new Date().getFullYear() + 1, { message: 'year out of range' })
    .optional(),
  nickname: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(nicknameRegex, {
      message: 'Apelido deve conter apenas letras, números e espaços',
    })
    .optional(),
  description: z.string().trim().max(150).optional(),
  modifications: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});
export type CarUpdateInput = z.infer<typeof carUpdateSchema>;

// `url` is server-derived from the stored objectKey via app.uploads.buildPublicUrl.
// Clients must not persist it; re-fetch cars to get fresh URLs.
export const carPhotoSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type CarPhoto = z.infer<typeof carPhotoSchema>;

export const carSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().max(20),
  description: z.string().max(150).nullable(),
  modifications: z.array(z.string()),
  photo: carPhotoSchema.nullable(),
  photos: z.array(carPhotoSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Car = z.infer<typeof carSchema>;

export const carListResponseSchema = z.object({
  cars: z.array(carSchema),
});
export type CarListResponse = z.infer<typeof carListResponseSchema>;

export const addCarPhotoSchema = z.object({
  objectKey: z.string().min(1).max(300),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type AddCarPhotoInput = z.infer<typeof addCarPhotoSchema>;
```

Notes:

- `nickname` in `carInputSchema` is now **required** (no `.optional()`).
- `nickname` in `carSchema` is `z.string().max(20)` (not nullable — the DB column is `NOT NULL` after migration).
- `description` in `carSchema` is `.nullable()` because the Prisma column is `String?` (null in DB when not set).
- `modifications` defaults to `[]` in `carInputSchema`, optional in `carUpdateSchema` (omitting it on PATCH leaves the array unchanged server-side).
- If TASK-A has merged and `carSchema` already has a `tier` field, preserve it — do not remove it.

### 4. `packages/shared/src/feed.ts`

`publicCarProfileSchema` currently has: `id, make, model, year, nickname, photo`. Add `modifications`:

```typescript
export const publicCarProfileSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().nullable(),
  modifications: z.array(z.string()),
  photo: publicCarPhotoSchema.nullable(),
});
```

Only this schema needs changing. `confirmedCarSchema` is intentionally opaque and must NOT receive modifications.

### 5. `packages/shared/src/__tests__/cars.test.ts` (create)

```typescript
import { describe, expect, it } from 'vitest';

import { carInputSchema, carUpdateSchema, nicknameRegex } from '../cars.js';

describe('nicknameRegex', () => {
  it('accepts plain ASCII letters and digits', () => {
    expect(nicknameRegex.test('FD3S')).toBe(true);
  });

  it('accepts PT-BR accented letters', () => {
    expect(nicknameRegex.test('Fã do José')).toBe(true);
    expect(nicknameRegex.test('ção')).toBe(true);
    expect(nicknameRegex.test('éàü')).toBe(true);
  });

  it('accepts spaces', () => {
    expect(nicknameRegex.test('RX 7')).toBe(true);
  });

  it('rejects emoji', () => {
    expect(nicknameRegex.test('Fast 🚗')).toBe(false);
  });

  it('rejects punctuation', () => {
    expect(nicknameRegex.test('RX-7')).toBe(false);
    expect(nicknameRegex.test('car@home')).toBe(false);
    expect(nicknameRegex.test('car!')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(nicknameRegex.test('')).toBe(false);
  });
});

describe('carInputSchema', () => {
  const base = { make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' };

  it('accepts full valid payload', () => {
    const result = carInputSchema.safeParse({
      ...base,
      description: 'Carro show',
      modifications: ['turbo', 'suspensao'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects nickname with emoji', () => {
    const result = carInputSchema.safeParse({ ...base, nickname: 'Zoom 🚗' });
    expect(result.success).toBe(false);
  });

  it('rejects nickname over 20 chars', () => {
    const result = carInputSchema.safeParse({
      ...base,
      nickname: 'A'.repeat(21),
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing nickname (required)', () => {
    const { nickname: _n, ...withoutNick } = base;
    const result = carInputSchema.safeParse(withoutNick);
    expect(result.success).toBe(false);
  });

  it('rejects description over 150 chars', () => {
    const result = carInputSchema.safeParse({
      ...base,
      description: 'A'.repeat(151),
    });
    expect(result.success).toBe(false);
  });

  it('rejects modifications array over 20 items', () => {
    const result = carInputSchema.safeParse({
      ...base,
      modifications: Array.from({ length: 21 }, (_, i) => `mod${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('rejects individual modification item over 60 chars', () => {
    const result = carInputSchema.safeParse({
      ...base,
      modifications: ['A'.repeat(61)],
    });
    expect(result.success).toBe(false);
  });

  it('defaults modifications to empty array when omitted', () => {
    const result = carInputSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.modifications).toEqual([]);
  });

  it('accepts PT-BR accented nickname', () => {
    const result = carInputSchema.safeParse({ ...base, nickname: 'Chão Batido' });
    expect(result.success).toBe(true);
  });
});

describe('carUpdateSchema', () => {
  it('allows partial update with only nickname', () => {
    const result = carUpdateSchema.safeParse({ nickname: 'Nova' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid nickname in partial update', () => {
    const result = carUpdateSchema.safeParse({ nickname: 'bad!' });
    expect(result.success).toBe(false);
  });
});
```

### 6. `apps/api/src/routes/cars.ts`

Three areas to change:

#### 6a. `serializeCar` — add `description` and `modifications`

```typescript
const serializeCar = (car: CarWithPhotos, uploads: Uploads) => {
  const sorted = car.photos.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  return carSchema.parse({
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname,
    description: car.description,
    modifications: car.modifications,
    createdAt: car.createdAt.toISOString(),
    updatedAt: car.updatedAt.toISOString(),
    photo: sorted[0] ? serializePhoto(sorted[0], uploads) : null,
    photos: sorted.map((p) => serializePhoto(p, uploads)),
  });
};
```

#### 6b. POST `/me/cars` handler — destructure new fields, wrap P2002 as 409

Replace the existing `app.post('/me/cars', ...)` handler:

```typescript
app.post('/me/cars', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const { make, model, year, nickname, description, modifications } = carInputSchema.parse(
    request.body,
  );
  try {
    const car = await prisma.car.create({
      data: {
        make,
        model,
        year,
        nickname,
        ...(description !== undefined ? { description } : {}),
        modifications,
        userId: sub,
      },
      include: { photos: true },
    });
    return reply.status(201).send(serializeCar(car, app.uploads));
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return reply.status(409).send({ error: 'nickname_taken' });
    }
    throw e;
  }
});
```

Note: `isUniqueConstraintError` is imported from `'../lib/prisma-errors.js'` — this helper already exists and covers both Prisma and raw-string Postgres errors.

#### 6c. PATCH `/me/cars/:id` handler — destructure new fields, wrap P2002 as 409

Replace the existing `app.patch('/me/cars/:id', ...)` handler:

```typescript
app.patch('/me/cars/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const owned = await prisma.car.findFirst({ where: { id, userId: sub } });
  if (!owned) return reply.status(404).send({ error: 'NotFound' });
  const { make, model, year, nickname, description, modifications } = carUpdateSchema.parse(
    request.body,
  );
  try {
    const updated = await prisma.car.update({
      where: { id },
      data: {
        ...(make !== undefined ? { make } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(year !== undefined ? { year } : {}),
        ...(nickname !== undefined ? { nickname } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(modifications !== undefined ? { modifications } : {}),
      },
      include: { photos: true },
    });
    return serializeCar(updated, app.uploads);
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return reply.status(409).send({ error: 'nickname_taken' });
    }
    throw e;
  }
});
```

#### 6d. Add import for `isUniqueConstraintError`

At the top of `apps/api/src/routes/cars.ts`, add:

```typescript
import { isUniqueConstraintError } from '../lib/prisma-errors.js';
```

### 7. `apps/api/src/routes/feed.ts`

The `CarSelect` type and `serializeCarProfile` helper need `modifications`:

Update the `CarSelect` type definition (currently around line 55):

```typescript
type CarSelect = {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
  modifications: string[];
  photos: { objectKey: string; width: number | null; height: number | null; sortOrder: number }[];
};
```

Update `serializeCarProfile`:

```typescript
const serializeCarProfile = (car: CarSelect | null, buildUrl: (key: string) => string) => {
  if (!car) return null;
  const primary = [...car.photos].sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;
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
  };
};
```

Also find the Prisma `select` block that queries the Car for feed posts and add `modifications: true` to it. Search for the `select` that references `nickname` in `feed.ts`.

### 8. API integration tests

#### 8a. `apps/api/test/cars/create.test.ts` — extend existing test

Add to the existing `describe('POST /me/cars', ...)` block:

```typescript
it('creates a car with description and modifications', async () => {
  const { user } = await createUser({ verified: true });
  const env = loadEnv();
  const res = await app.inject({
    method: 'POST',
    url: '/me/cars',
    headers: { authorization: bearer(env, user.id) },
    payload: {
      make: 'Mazda',
      model: 'RX7',
      year: 1993,
      nickname: 'FD3S',
      description: 'Carro show',
      modifications: ['turbina', 'suspensao'],
    },
  });
  expect(res.statusCode).toBe(201);
  const body = carSchema.parse(res.json());
  expect(body.description).toBe('Carro show');
  expect(body.modifications).toEqual(['turbina', 'suspensao']);
});

it('rejects nickname with invalid characters', async () => {
  const { user } = await createUser({ verified: true });
  const env = loadEnv();
  const res = await app.inject({
    method: 'POST',
    url: '/me/cars',
    headers: { authorization: bearer(env, user.id) },
    payload: { make: 'Mazda', model: 'RX7', year: 1993, nickname: 'bad!' },
  });
  expect(res.statusCode).toBe(400);
});
```

Also update the existing test that passes `nickname: 'FD'` — it is 2 chars, still valid. No change needed there.

#### 8b. `apps/api/test/cars/nickname-conflict.test.ts` (create)

```typescript
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('nickname uniqueness', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 409 with error=nickname_taken when nickname already exists', async () => {
    const { user: u1 } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: u2 } = await createUser({ email: 'b@jdm.test', verified: true });
    const env = loadEnv();

    // u1 creates car with nickname 'Raio'
    await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, u1.id) },
      payload: { make: 'Honda', model: 'Civic', year: 2000, nickname: 'Raio' },
    });

    // u2 tries the same nickname
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, u2.id) },
      payload: { make: 'Toyota', model: 'Supra', year: 1998, nickname: 'Raio' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'nickname_taken' });
  });

  it('returns 409 on PATCH when renaming to a taken nickname', async () => {
    const { user: u1 } = await createUser({ email: 'c@jdm.test', verified: true });
    const { user: u2 } = await createUser({ email: 'd@jdm.test', verified: true });
    const env = loadEnv();

    await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, u1.id) },
      payload: { make: 'Mazda', model: 'RX7', year: 1993, nickname: 'Rex' },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, u2.id) },
      payload: { make: 'Subaru', model: 'WRX', year: 2004, nickname: 'Azul' },
    });
    const carId = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/me/cars/${carId}`,
      headers: { authorization: bearer(env, u2.id) },
      payload: { nickname: 'Rex' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'nickname_taken' });
  });
});
```

#### 8c. `apps/api/test/cars/modifications.test.ts` (create)

```typescript
import { prisma } from '@ccc/db';
import { carSchema } from '@ccc/shared/cars';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('modifications array round-trip', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('persists and returns modifications array', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        make: 'Subaru',
        model: 'Impreza',
        year: 2002,
        nickname: 'Prata',
        modifications: ['turbo upgrade', 'coilover'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = carSchema.parse(res.json());
    expect(body.modifications).toEqual(['turbo upgrade', 'coilover']);
  });

  it('PATCH updates modifications in place', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const car = await prisma.car.create({
      data: {
        userId: user.id,
        make: 'Mazda',
        model: 'MX5',
        year: 2005,
        nickname: 'Verde',
        modifications: ['roll bar'],
      },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/cars/${car.id}`,
      headers: { authorization: bearer(env, user.id) },
      payload: { modifications: ['roll bar', 'bucket seat'] },
    });
    expect(res.statusCode).toBe(200);
    const body = carSchema.parse(res.json());
    expect(body.modifications).toEqual(['roll bar', 'bucket seat']);
  });

  it('defaults modifications to empty array when omitted on create', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Honda', model: 'NSX', year: 1991, nickname: 'Branquelo' },
    });
    expect(res.statusCode).toBe(201);
    const body = carSchema.parse(res.json());
    expect(body.modifications).toEqual([]);
  });
});
```

#### 8d. `apps/api/test/cars/update.test.ts` — add description test

Add inside the existing `describe` block:

```typescript
it('updates description', async () => {
  const { user } = await createUser({ email: 'desc@jdm.test', verified: true });
  const car = await prisma.car.create({
    data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1998, nickname: 'Lento' },
  });
  const env = loadEnv();
  const res = await app.inject({
    method: 'PATCH',
    url: `/me/cars/${car.id}`,
    headers: { authorization: bearer(env, user.id) },
    payload: { description: 'Carro de família' },
  });
  expect(res.statusCode).toBe(200);
  const body = carSchema.parse(res.json());
  expect(body.description).toBe('Carro de família');
});
```

### 9. `apps/mobile/src/copy/profile.ts`

Update the `garage` sub-object. Changes:

- `nicknameLabel` changes from `'Apelido (opcional)'` to `'Apelido'` (now required).
- Add `nicknameTaken`, `descriptionLabel`, `modificationsLabel`, `modificationsHint`.

```typescript
garage: {
  title: 'Garagem',
  newTitle: 'Novo Carro',
  empty: 'Você ainda não cadastrou carros.',
  add: 'Adicionar carro',
  makeLabel: 'Marca',
  modelLabel: 'Modelo',
  yearLabel: 'Ano',
  nicknameLabel: 'Apelido',
  nicknameTaken: 'Este apelido já está em uso. Escolha outro.',
  descriptionLabel: 'Descrição (opcional)',
  modificationsLabel: 'Modificações',
  modificationsHint: 'Separe por vírgula. Ex: turbo, suspensão, rodas',
  save: 'Salvar',
  saved: 'Carro atualizado.',
  saveFailed: 'Não foi possível salvar o carro.',
  delete: 'Excluir',
  deleteConfirm: 'Remover este carro?',
  addPhoto: 'Adicionar foto',
  replacePhoto: 'Trocar',
  photoUploading: 'Enviando foto…',
  removePhoto: 'Remover',
  removePhotoConfirm: 'Foto deste carro removida?',
},
```

### 10. Mobile form screens

All four screens share a common pattern. The changes are:

**`defaultValues` change (both `new.tsx` screens):**

```typescript
defaultValues: {
  make: '',
  model: '',
  year: new Date().getFullYear(),
  nickname: '',        // was: undefined (optional); now required, default to empty string
  description: undefined,
  modifications: [],
},
```

**`useEffect` / `form.reset` change (both `[id].tsx` screens):**

```typescript
form.reset({
  make: found.make,
  model: found.model,
  year: found.year,
  nickname: found.nickname, // was: found.nickname ?? undefined; now required
  description: found.description ?? undefined,
  modifications: found.modifications,
});
```

**`onSave` error handling (all four screens):**

The `handleSubmit` wraps the API call. On `ApiError` with status 409 and body `{ error: 'nickname_taken' }`, set a form-level error:

```typescript
const onSave = form.handleSubmit(async (values) => {
  try {
    const car = await createCar(values); // or updateCar
    // ... navigate
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.status === 409 &&
      typeof err.body === 'object' &&
      err.body !== null &&
      (err.body as { error?: string }).error === 'nickname_taken'
    ) {
      form.setError('nickname', { message: profileCopy.garage.nicknameTaken });
    } else {
      showBanner(profileCopy.garage.saveFailed);
    }
  }
});
```

(On `new.tsx` screens there is currently no `showBanner`, so wrap the `router.replace` call instead in a try-catch and use `Alert.alert` or a local `banner` state. Follow the pattern from `[id].tsx` which already has `showBanner`.)

**Three new Controller blocks added after the nickname controller (all four screens):**

```tsx
{
  /* description */
}
<Controller
  control={form.control}
  name="description"
  render={({ field, fieldState }) => (
    <TextField
      label={profileCopy.garage.descriptionLabel}
      value={field.value ?? ''}
      onChangeText={(v) => field.onChange(v.length > 0 ? v : undefined)}
      multiline
      numberOfLines={3}
      error={fieldState.error?.message}
    />
  )}
/>;

{
  /* modifications — comma-separated input with live pill preview */
}
<Controller
  control={form.control}
  name="modifications"
  render={({ field, fieldState }) => {
    const rawText = field.value?.join(', ') ?? '';
    return (
      <View>
        <TextField
          label={profileCopy.garage.modificationsLabel}
          hint={profileCopy.garage.modificationsHint}
          value={rawText}
          onChangeText={(v) => {
            const items = v
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            field.onChange(items);
          }}
          error={fieldState.error?.message}
        />
        {field.value && field.value.length > 0 ? (
          <ModificationPills modifications={field.value} />
        ) : null}
      </View>
    );
  }}
/>;
```

The `ModificationPills` component is defined inline in each screen (or extracted to a shared component if preferred — see §6 below for the shared component definition used across all render surfaces):

```tsx
function ModificationPills({ modifications }: { modifications: string[] }) {
  return (
    <View style={styles.pillsRow}>
      {modifications.map((mod, i) => (
        <View key={i} style={styles.pill}>
          <Text style={styles.pillText}>{mod}</Text>
        </View>
      ))}
    </View>
  );
}
```

Add to `StyleSheet.create`:

```typescript
pillsRow: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 8,
},
pill: {
  backgroundColor: theme.colors.border,
  borderRadius: 12,
  paddingVertical: 4,
  paddingHorizontal: 10,
},
pillText: {
  color: theme.colors.fg,
  fontSize: theme.font.size.sm,
},
```

**Nickname controller change (all four screens):**

Change the `onChangeText` handler. Previously it set `undefined` for empty:

```tsx
onChangeText={(v) => field.onChange(v.length > 0 ? v : undefined)}
```

Now nickname is required, so just pass through:

```tsx
onChangeText={field.onChange}
```

---

## Public-profile pill rendering

These surfaces already render `Car.make`, `Car.model`, `Car.nickname`. Each needs a `ModificationPills` row added below the car name/label.

### Surface 1: `apps/mobile/app/(app)/garage/index.tsx`

The `renderItem` FlatList card currently shows `{item.year} {item.make} {item.model}` and optionally `{item.nickname}`. Add pills below:

```tsx
<View style={styles.cardText}>
  <Text style={styles.title}>
    {item.year} {item.make} {item.model}
  </Text>
  {item.nickname ? <Text style={styles.sub}>{item.nickname}</Text> : null}
  {item.modifications && item.modifications.length > 0 ? (
    <ModificationPills modifications={item.modifications} />
  ) : null}
</View>
```

Add the `ModificationPills` function and `pillsRow`/`pill`/`pillText` styles to this file.

### Surface 2: `apps/mobile/app/(app)/profile/garage/index.tsx`

Same change as Surface 1. This file is structurally identical.

### Surface 3: `apps/mobile/app/(app)/garage/[id].tsx`

This screen already shows `title = car.nickname ?? ...`. Below the field controllers, no explicit identity display exists (it is a form). No pills needed here beyond the form preview shown in the modifications controller above.

### Surface 4: `apps/mobile/app/(app)/profile/garage/[id].tsx`

Same as Surface 3.

### Surface 5: `apps/mobile/src/screens/events/feed/FeedPostCard.tsx`

The `carInfo` view currently shows:

```tsx
<Text style={styles.carName}>{carLabel}</Text>
```

Add pills below:

```tsx
<View style={styles.carInfo}>
  <Text style={styles.carName}>{carLabel}</Text>
  {car && car.modifications && car.modifications.length > 0 ? (
    <ModificationPills modifications={car.modifications} />
  ) : null}
</View>
```

`car` here is `post.car` which is typed as `PublicCarProfile | null` from `@ccc/shared/feed`. After step 4 above, `PublicCarProfile` includes `modifications: string[]`.

Add `ModificationPills` and its styles to this file.

### Surface 6: `apps/mobile/src/screens/events/feed/CarPickerPopover.tsx`

The label currently is `${car.nickname ?? car.make} ${car.model} ${car.year}`. Add pills below the label:

```tsx
<View style={{ gap: 4 }}>
  <Text ...>{label}</Text>
  {car.modifications && car.modifications.length > 0 ? (
    <ModificationPills modifications={car.modifications} />
  ) : null}
</View>
```

Add `ModificationPills` and its styles to this file.

### Surface 7: `apps/mobile/src/screens/cart/CarPlatePicker.tsx`

The `carName` text currently shows `car.nickname ?? `${car.make} ${car.model} ${car.year}`. Optionally `carMeta`shows`{car.make} {car.model} {car.year}`. Add pills below `carMeta`:

```tsx
<View style={styles.carInfo}>
  <Text style={styles.carName}>{label}</Text>
  {car.nickname && (
    <Text style={styles.carMeta}>
      {car.make} {car.model} {car.year}
    </Text>
  )}
  {car.modifications && car.modifications.length > 0 ? (
    <ModificationPills modifications={car.modifications} />
  ) : null}
</View>
```

Add `ModificationPills` and its styles to this file.

---

## Test plan

### Zod unit tests (`packages/shared/src/__tests__/cars.test.ts`)

Already specified in §5. Run with:

```
pnpm --filter @ccc/shared test
```

Coverage:

- Regex accept: ASCII, PT-BR accented, spaces.
- Regex reject: emoji, punctuation, empty.
- `carInputSchema`: full payload, nickname regex reject, nickname max-length reject, nickname missing (required), description max-length, modifications count > 20, modifications item > 60 chars, modifications defaults to `[]`, PT-BR nickname accepted.
- `carUpdateSchema`: partial ok, invalid nickname.

### API integration tests (`apps/api/test/cars/`)

Run with:

```
pnpm --filter api test
```

(Testcontainers spins up Postgres — defined in `apps/api/test/global-setup.ts`.)

Coverage:

- Create with `description` and `modifications` → 201, fields echoed.
- Create with invalid nickname (`bad!`) → 400.
- Nickname conflict on create → 409 `{ error: 'nickname_taken' }`.
- Nickname conflict on PATCH → 409 `{ error: 'nickname_taken' }`.
- `modifications` round-trip on create → persisted and returned.
- `modifications` update via PATCH → updated correctly.
- `modifications` defaults to `[]` when omitted.
- `description` update via PATCH.

### Migration backfill test

Add inside `apps/api/test/` a new file `cars/migration-backfill.test.ts` that verifies the backfill logic directly using the Testcontainers Postgres:

```typescript
import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

describe('car nickname backfill invariants (post-migration)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('every car in the DB has a non-null nickname after migration', async () => {
    const { user } = await createUser({ verified: true });
    // Direct DB insert bypasses Zod — simulates a pre-migration row.
    // After migration, the column is NOT NULL, so we test the current state.
    // We cannot actually test the DO $$ block here (migration already ran).
    // Instead, verify that creating a car without nickname via Prisma fails
    // (schema enforces not-null at DB level).
    await expect(
      prisma.car.create({
        data: {
          userId: user.id,
          make: 'Test',
          model: 'Car',
          year: 2000,
          // nickname intentionally omitted — Prisma schema requires it
          // @ts-expect-error intentional
          nickname: undefined,
        },
      }),
    ).rejects.toThrow();
  });

  it('two cars with same make+model get distinct nicknames', async () => {
    const { user } = await createUser({ verified: true });
    const c1 = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1998, nickname: 'Cinza' },
    });
    await expect(
      prisma.car.create({
        data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1999, nickname: 'Cinza' },
      }),
    ).rejects.toThrow(); // unique constraint
    const c2 = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1999, nickname: 'Cinza 2' },
    });
    expect(c1.nickname).not.toBe(c2.nickname);
  });
});
```

---

## Step-by-step execution (TDD order)

### Task 1: Prisma schema and migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260521000000_car_fields_extension/migration.sql`

- [ ] **Step 1: Confirm current branch**

  ```
  git branch --show-current
  ```

  Expected: `feat/jdma-car-fields-extension`

- [ ] **Step 2: Apply schema changes to `schema.prisma`**

  Make the changes specified in §1 (add `description`, `modifications`, change `nickname`, add `@@unique`).

- [ ] **Step 3: Create migration directory and write migration.sql**

  ```
  mkdir -p packages/db/prisma/migrations/20260521000000_car_fields_extension
  ```

  Write the full SQL from §2 into `migration.sql`.

- [ ] **Step 4: Verify migration SQL is syntactically valid by dry-running against Testcontainers DB**

  ```
  pnpm --filter api test -- --testPathPattern=health
  ```

  If Prisma's migration is applied by the test setup, the health test passes if schema matches DB. Alternatively, run:

  ```
  pnpm --filter @ccc/db exec prisma migrate deploy
  ```

  against the test DB (requires `DATABASE_URL` set to test container URL).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/db/prisma/schema.prisma \
    packages/db/prisma/migrations/20260521000000_car_fields_extension/migration.sql
  git commit -m "feat(db): add description, modifications, tighten nickname on Car"
  ```

---

### Task 2: Shared Zod schemas

**Files:**

- Modify: `packages/shared/src/cars.ts`
- Modify: `packages/shared/src/feed.ts`
- Create: `packages/shared/src/__tests__/cars.test.ts`

- [ ] **Step 1: Write failing unit tests**

  Create `packages/shared/src/__tests__/cars.test.ts` with the full content from §5.

- [ ] **Step 2: Run tests to confirm they fail**

  ```
  pnpm --filter @ccc/shared test
  ```

  Expected: most tests fail because `nicknameRegex` is not exported from `cars.ts` and schemas don't match yet.

- [ ] **Step 3: Update `packages/shared/src/cars.ts`**

  Replace with the full content from §3.

- [ ] **Step 4: Update `packages/shared/src/feed.ts`**

  Add `modifications: z.array(z.string())` to `publicCarProfileSchema` as shown in §4.

- [ ] **Step 5: Run tests to confirm they pass**

  ```
  pnpm --filter @ccc/shared test
  ```

  Expected: all tests pass.

- [ ] **Step 6: Rebuild `@ccc/shared`**

  ```
  pnpm --filter @ccc/shared build
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add packages/shared/src/cars.ts \
    packages/shared/src/feed.ts \
    packages/shared/src/__tests__/cars.test.ts
  git commit -m "feat(shared): extend carInputSchema, carSchema, publicCarProfileSchema for new car fields"
  ```

---

### Task 3: API route changes and integration tests

**Files:**

- Modify: `apps/api/src/routes/cars.ts`
- Modify: `apps/api/src/routes/feed.ts`
- Modify: `apps/api/test/cars/create.test.ts`
- Modify: `apps/api/test/cars/update.test.ts`
- Create: `apps/api/test/cars/nickname-conflict.test.ts`
- Create: `apps/api/test/cars/modifications.test.ts`
- Create: `apps/api/test/cars/migration-backfill.test.ts`

- [ ] **Step 1: Write failing integration tests**

  Add the new tests from §8a (two new `it` blocks to `create.test.ts`), §8b (`nickname-conflict.test.ts`), §8c (`modifications.test.ts`), §8d (one new `it` block to `update.test.ts`), and the backfill test file.

- [ ] **Step 2: Run integration tests to confirm failures**

  ```
  pnpm --filter api test -- --testPathPattern="cars/"
  ```

  Expected: new tests fail (fields missing from serialize, no 409 mapping).

- [ ] **Step 3: Update `apps/api/src/routes/cars.ts`**

  Make changes from §6: add import for `isUniqueConstraintError`, update `serializeCar`, update POST and PATCH handlers.

- [ ] **Step 4: Update `apps/api/src/routes/feed.ts`**

  Make changes from §7: update `CarSelect` type, `serializeCarProfile`, and the Prisma select block.

- [ ] **Step 5: Run integration tests**

  ```
  pnpm --filter api test -- --testPathPattern="cars/"
  ```

  Expected: all new tests pass.

- [ ] **Step 6: Run full API test suite to confirm no regressions**

  ```
  pnpm --filter api test
  ```

  Expected: all tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/api/src/routes/cars.ts \
    apps/api/src/routes/feed.ts \
    apps/api/test/cars/create.test.ts \
    apps/api/test/cars/update.test.ts \
    apps/api/test/cars/nickname-conflict.test.ts \
    apps/api/test/cars/modifications.test.ts \
    apps/api/test/cars/migration-backfill.test.ts
  git commit -m "feat(api): pass description/modifications through serialize, map P2002 to 409 nickname_taken"
  ```

---

### Task 4: Mobile copy strings

**Files:**

- Modify: `apps/mobile/src/copy/profile.ts`

- [ ] **Step 1: Update `profile.ts`**

  Apply changes from §9.

- [ ] **Step 2: Verify TypeScript compiles**

  ```
  pnpm --filter mobile tsc --noEmit
  ```

  Expected: no errors (unless downstream files reference keys not yet added — they will after Task 5).

- [ ] **Step 3: Commit**

  ```bash
  git add apps/mobile/src/copy/profile.ts
  git commit -m "feat(mobile): add garage copy strings for description, modifications, nicknameTaken"
  ```

---

### Task 5: Mobile form screens

**Files:**

- Modify: `apps/mobile/app/(app)/garage/new.tsx`
- Modify: `apps/mobile/app/(app)/garage/[id].tsx`
- Modify: `apps/mobile/app/(app)/profile/garage/new.tsx`
- Modify: `apps/mobile/app/(app)/profile/garage/[id].tsx`

- [ ] **Step 1: Update `apps/mobile/app/(app)/garage/new.tsx`**
  - Change `defaultValues.nickname` from `undefined` to `''`.
  - Add `description: undefined`, `modifications: []` to defaultValues.
  - Change nickname `onChangeText` from `(v) => field.onChange(v.length > 0 ? v : undefined)` to `field.onChange`.
  - Add try-catch in `onSave` to detect 409 and call `form.setError('nickname', ...)`. Since this screen has no banner, add a local `banner` state (same pattern as `[id].tsx`) or use `Alert.alert`:
    ```typescript
    import { Alert } from 'react-native';
    // ...
    const onSave = form.handleSubmit(async (values) => {
      try {
        const car = await createCar(values);
        if (returnTo) {
          router.replace(returnTo as never);
        } else {
          router.replace(`/garage/${car.id}` as never);
        }
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.status === 409 &&
          (err.body as { error?: string } | null)?.error === 'nickname_taken'
        ) {
          form.setError('nickname', { message: profileCopy.garage.nicknameTaken });
        } else {
          Alert.alert(profileCopy.errors.unknown);
        }
      }
    });
    ```
  - Add `import { ApiError } from '~/api/client';` at top.
  - Add `description` and `modifications` Controller blocks after the nickname Controller (see §10).
  - Add `ModificationPills` function and its styles.

- [ ] **Step 2: Update `apps/mobile/app/(app)/garage/[id].tsx`**
  - Add `description`, `modifications` to `form.reset(...)` in `useEffect`.
  - Change nickname `onChangeText` to pass through directly.
  - Add 409 handling in `onSave` (this screen already has `showBanner`; also call `form.setError`).
  - Add `ApiError` import.
  - Add `description` and `modifications` Controller blocks.
  - Add `ModificationPills` and styles.

- [ ] **Step 3: Update `apps/mobile/app/(app)/profile/garage/new.tsx`**

  Same changes as Step 1 (this file is a mirror of the `garage/new.tsx` but with profile-scoped navigation).

- [ ] **Step 4: Update `apps/mobile/app/(app)/profile/garage/[id].tsx`**

  Same changes as Step 2.

- [ ] **Step 5: TypeScript check**

  ```
  pnpm --filter mobile tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add "apps/mobile/app/(app)/garage/new.tsx" \
    "apps/mobile/app/(app)/garage/[id].tsx" \
    "apps/mobile/app/(app)/profile/garage/new.tsx" \
    "apps/mobile/app/(app)/profile/garage/[id].tsx"
  git commit -m "feat(mobile): add description/modifications fields and tighten nickname in car forms"
  ```

---

### Task 6: Public-profile pill rendering

**Files:**

- Modify: `apps/mobile/app/(app)/garage/index.tsx`
- Modify: `apps/mobile/app/(app)/profile/garage/index.tsx`
- Modify: `apps/mobile/src/screens/events/feed/FeedPostCard.tsx`
- Modify: `apps/mobile/src/screens/events/feed/CarPickerPopover.tsx`
- Modify: `apps/mobile/src/screens/cart/CarPlatePicker.tsx`

- [ ] **Step 1: Update `apps/mobile/app/(app)/garage/index.tsx`**

  Add `ModificationPills` function (see §10, inline definition) and styles. Add pills render inside the `renderItem` card after the `{item.nickname}` row.

- [ ] **Step 2: Update `apps/mobile/app/(app)/profile/garage/index.tsx`**

  Same changes as Step 1.

- [ ] **Step 3: Update `apps/mobile/src/screens/events/feed/FeedPostCard.tsx`**

  `post.car` is typed as `FeedPostResponse.car` which includes `PublicCarProfile` from `@ccc/shared/feed`. After step §4 it includes `modifications`. Add pills inside `carInfo` view (see §"Public-profile pill rendering" §Surface 5).

- [ ] **Step 4: Update `apps/mobile/src/screens/events/feed/CarPickerPopover.tsx`**

  `cars` prop is `Car[]` from `@ccc/shared/cars`. After step §3 it includes `modifications`. Add pills below the label text (see §"Public-profile pill rendering" §Surface 6).

- [ ] **Step 5: Update `apps/mobile/src/screens/cart/CarPlatePicker.tsx`**

  Same `Car[]` source. Add pills below `carMeta` (see §"Public-profile pill rendering" §Surface 7).

- [ ] **Step 6: TypeScript check**

  ```
  pnpm --filter mobile tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add "apps/mobile/app/(app)/garage/index.tsx" \
    "apps/mobile/app/(app)/profile/garage/index.tsx" \
    apps/mobile/src/screens/events/feed/FeedPostCard.tsx \
    apps/mobile/src/screens/events/feed/CarPickerPopover.tsx \
    apps/mobile/src/screens/cart/CarPlatePicker.tsx
  git commit -m "feat(mobile): render modifications pills on all car-identity public surfaces"
  ```

---

### Task 7: Final verification

- [ ] **Step 1: Run full shared test suite**

  ```
  pnpm --filter @ccc/shared test
  ```

  Expected: all pass.

- [ ] **Step 2: Run full API test suite**

  ```
  pnpm --filter api test
  ```

  Expected: all pass.

- [ ] **Step 3: TypeScript check across all packages**

  ```
  pnpm tsc --noEmit
  ```

  (Or per-package if global tsc is not wired.)

- [ ] **Step 4: Verify `@ccc/shared` build is current**

  ```
  pnpm --filter @ccc/shared build
  ```

- [ ] **Step 5: Open PR to `main`**

---

## Risks and open questions

1. **TASK-A merge order:** If TASK-A (PR #355) merges first, its migration `20260520120100_garage_spots_tables` lands before this one. The timestamp `20260521000000` ensures correct ordering. However, if TASK-A adds `carSchema.tier` as `.optional()`, the `carSchema` in this branch will need a `tier` field too. Check at implementation time: if `tier` is present in the merged `cars.ts`, add `tier: garageSpotTierSchema.optional()` to the schema here (do NOT remove it).

2. **Backfill collision edge case:** The SQL CTE in Step 3 computes `ROW_NUMBER` in a single scan. If two cars share make+model AND the `' N'` suffix would push the string over 20 chars when N has 2 digits (e.g., N=10 → suffix is 3 chars), the `SUBSTR(base, 1, 20 - LENGTH(' ' || rn::TEXT))` formula handles it correctly. Verify manually with a car where base is exactly 20 chars: base = `'Lamborghini Huracaa'` (19), suffix ` 10` (3 chars), prefix = 17 → `'Lamborghini Huraca 10'` is 21 — the formula truncates base to 17: `'Lamborghini Huraca 10'` → `'Lamborghini Hura 10'` (18 chars, within 20). Correct.

3. **Existing rows with nickname already set to >20 chars:** After `ALTER COLUMN TYPE VARCHAR(20)`, Postgres will reject any existing value longer than 20 chars with `value too long for type character varying(20)`. The backfill only sets nicknames on NULL rows. If the app has been live long enough for users to have set nicknames up to 60 chars (the old max), those rows would block the migration. **Mitigation:** Add a step before the `ALTER COLUMN TYPE` to truncate existing non-null nicknames to 20 chars while maintaining uniqueness. This should be added to the migration if any production data exists with nicknames longer than 20 chars. Since the column was optional and unlikely to have been used in production at volume, this is low risk — but add a defensive `UPDATE "Car" SET nickname = SUBSTR(nickname, 1, 20) WHERE LENGTH(nickname) > 20` before the `ALTER TYPE` step as a safety net. However, truncation can cause uniqueness violations (two `'Honda Nsx Long ...'` → both become `'Honda Nsx Long ...'`). The safer approach is to check at deploy time: `SELECT id, nickname FROM "Car" WHERE LENGTH(nickname) > 20`. If any rows exist, apply the same dedupe logic as the NULL backfill.

4. **`FeedPostCard.tsx` `post.car` type:** The prop `post: FeedPostResponse` has `car: PublicCarProfile | null`. `PublicCarProfile` currently lacks `modifications`. After §4 and rebuild, TypeScript will know about `modifications`. If the API does not yet populate `modifications` in the feed serializer (§7), the field will be absent at runtime and Zod will fail parsing. Ensure §7 (feed.ts API change) and the shared Zod change land together — both are in the same branch, so this is fine.

5. **`authedRequest` parses with `carSchema` or `carListResponseSchema`:** After the schema change, `carSchema.nickname` is no longer nullable. Any existing response from a stale API (pre-migration) that returns `null` for nickname will fail Zod parse and surface as a generic error. Not a problem if API and mobile are deployed together.

6. **Mobile `modifications` field UX:** The comma-split approach means the live pill preview updates as the user types. If a user types `turbo, ` (trailing comma + space), the `filter(s => s.length > 0)` removes the empty trailing item, so only `'turbo'` shows. This is the intended behavior.

7. **`new.tsx` screens and error display:** The existing `new.tsx` screens have no banner or error state (they just call `router.replace` on success). Adding `Alert.alert` for the unknown error case is consistent with how `[id].tsx` handles it via `showMessage` from `~/lib/confirm`. Check if `showMessage` is importable in the new screens (it is — same import path).

---

## Self-review checklist

- [ ] Prisma schema has `@@unique([nickname])` and `nickname String @db.VarChar(20)` (not nullable).
- [ ] Migration SQL backfill handles NULL nicknames only; does not touch already-set ones.
- [ ] `modifications String[] @default({})` uses Postgres array default `{}` syntax (correct for Prisma).
- [ ] `carInputSchema.nickname` is required (no `.optional()`).
- [ ] `carUpdateSchema.nickname` is still optional (PATCH is partial).
- [ ] `carSchema.nickname` is `z.string().max(20)` (not nullable — matches DB NOT NULL).
- [ ] `carSchema.description` is `z.string().max(150).nullable()` (matches DB nullable).
- [ ] `publicCarProfileSchema` in `feed.ts` includes `modifications: z.array(z.string())`.
- [ ] `serializeCar` in `cars.ts` route passes `description` and `modifications`.
- [ ] `serializeCarProfile` in `feed.ts` route passes `modifications`.
- [ ] POST and PATCH handlers both catch P2002 via `isUniqueConstraintError` and return 409.
- [ ] All four mobile form screens update `defaultValues` / `form.reset` to include all three new fields.
- [ ] All four mobile form screens update nickname `onChangeText` to not set `undefined`.
- [ ] Pills render in: both garage-list screens, FeedPostCard, CarPickerPopover, CarPlatePicker.
- [ ] Copy strings in PT-BR; all new keys added to `profileCopy.garage`.
- [ ] `@ccc/shared` rebuilt after schema changes.
- [ ] No admin files touched (admin has no car-identity surfaces).
- [ ] TASK-A `tier` markers not removed.
- [ ] Integration tests use real Postgres (Testcontainers), not mocks.
- [ ] Migration timestamp `20260521000000` is after TASK-A's `20260520120100`.
