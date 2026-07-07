# Phase 1 · F2 Profile & Garage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user edit their profile (name, bio, city, state, avatar), manage a garage of cars, and attach a single photo to each car — backed by Cloudflare R2 via pre-signed PUT uploads.

**Architecture:** Extend the existing Prisma `User` with profile columns and add `Car` + `CarPhoto` tables. `CarPhoto` has a `@@unique([carId])` constraint enforcing one photo per car. Media lives in R2 — the API only issues pre-signed PUT URLs and stores object keys, never proxying bytes. All mutations require auth (`app.authenticate`) and use `findFirst({ where: { id, userId } })` as the ownership guard. Mobile replaces `/welcome` scaffolding with real profile and garage screens wired to a typed API client, using `expo-image-picker` + pre-signed uploads for avatars and car photos.

**Tech Stack:** Prisma, Fastify, Zod, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, Expo Router, `expo-image-picker`, `react-hook-form` + `@hookform/resolvers/zod`.

**Roadmap tasks covered:** 2.1–2.6.

---

## File structure

**`packages/db/prisma/schema.prisma`** — extend `User` (adds `avatarObjectKey`, not a URL); add `Car`, `CarPhoto` (stores `objectKey`, not `url`; `@@unique([carId])` — one photo per car).

**`packages/shared/src/profile.ts`** (new) — `updateProfileSchema`, `publicProfileSchema`.
**`packages/shared/src/cars.ts`** (new) — `carInputSchema`, `carSchema`, `carPhotoSchema`, `carListResponseSchema`.
**`packages/shared/src/uploads.ts`** (new) — `presignRequestSchema`, `presignResponseSchema`, `UPLOAD_KINDS`, `ALLOWED_IMAGE_TYPES`, `MAX_UPLOAD_BYTES`.
**`packages/shared/package.json`** — add `./profile`, `./cars`, `./uploads` to `exports`.

**`apps/api/src/env.ts`** — add R2 env vars.
**`apps/api/src/services/uploads/types.ts`** (new) — `Uploads` interface.
**`apps/api/src/services/uploads/r2.ts`** (new) — `R2Uploads` impl.
**`apps/api/src/services/uploads/dev.ts`** (new) — `DevUploads` impl for local/tests.
**`apps/api/src/services/uploads/index.ts`** (new) — `buildUploads(env)` factory.
**`apps/api/src/app.ts`** — decorate `app.uploads`.
**`apps/api/src/routes/me.ts`** — keep GET `/me`, add PATCH `/me`; extend public response shape.
**`apps/api/src/routes/uploads.ts`** (new) — POST `/uploads/presign`.
**`apps/api/src/routes/cars.ts`** (new) — `/me/cars` CRUD + `/me/cars/:id/photos`.

**`apps/api/test/helpers.ts`** — extend `resetDatabase` (drop `carPhoto`, `car`); add `stubUploads` helper.
**`apps/api/test/me.test.ts`** (rename from `apps/api/test/auth/me.test.ts` leaving a thin re-export if needed, or add `me.patch.test.ts`) — add PATCH tests.
**`apps/api/test/uploads/presign.test.ts`** (new).
**`apps/api/test/cars/*.test.ts`** (new) — list, create, update, delete, photos.

**`apps/mobile/src/copy/profile.ts`** (new) — PT-BR copy.
**`apps/mobile/src/api/profile.ts`** (new).
**`apps/mobile/src/api/cars.ts`** (new).
**`apps/mobile/src/api/uploads.ts`** (new).
**`apps/mobile/src/lib/upload-image.ts`** (new) — pick-then-PUT helper.
**`apps/mobile/app/(app)/_layout.tsx`** (new group) — authed tab/stack layout.
**`apps/mobile/app/(app)/profile.tsx`** (new).
**`apps/mobile/app/(app)/garage/index.tsx`** (new).
**`apps/mobile/app/(app)/garage/[id].tsx`** (new).
**`apps/mobile/app/(app)/garage/new.tsx`** (new).
**`apps/mobile/app/welcome.tsx`** — thin redirect to `/profile` (welcome no longer owns logged-in home).

**`handoff.md`** (root) — rewrite for F2 Chunk A-C handoff as work lands.
**`roadmap.md`** — flip 2.1–2.6 `[ ]`→`[~]` on branch start, `[~]`→`[x]` on merge+deploy, per file rules.

---

## Conventions (read before any task)

- **Ownership guard:** always `prisma.car.findFirst({ where: { id, userId: sub } })` — returning `null` ⇒ 404.
- **Never trust client-provided photo URLs.** Only accept opaque `objectKey` strings emitted by `/uploads/presign`. The database stores only `objectKey`; `url` is computed server-side at serialize time via `app.uploads.buildPublicUrl(objectKey)`. Same rule applies to avatars (`User.avatarObjectKey` → derived `avatarUrl` in the API response).
- **R2 key format:** `${kind}/${userId}/${cuid}.${ext}`. Server verifies the key prefix starts with `kind/${userId}/` before accepting it in a subsequent API call.
- **Test layout:** each API test file starts with `await resetDatabase(); app = await makeApp();` per `test/helpers.ts`.
- **PT-BR copy:** anything user-visible goes in `apps/mobile/src/copy/profile.ts`. Never inline strings in screens.
- **Commits:** one commit per task (not per step). Conventional Commit prefixes: `feat:`, `fix:`, `test:`, `chore:`, `docs:`.
- **Branch:** `feat/f2-profile` off `main`.

---

## Task 1: Prisma schema — profile fields + Car + CarPhoto

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create migration: `packages/db/prisma/migrations/<timestamp>_profile_cars/migration.sql` (via Prisma)

- [ ] **Step 1: Edit `schema.prisma`** — extend `User` and add the two new models. Append to the existing file (do not touch auth models except adding relations).

```prisma
// ... existing User model, add these fields after `updatedAt`:
model User {
  id              String    @id @default(cuid())
  email           String    @unique
  passwordHash    String?
  name            String
  role            UserRole  @default(user)
  emailVerifiedAt DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // profile (F2)
  bio             String? @db.VarChar(500)
  city            String? @db.VarChar(100)
  stateCode       String? @db.VarChar(2)
  avatarObjectKey String? @db.VarChar(300)

  authProviders       AuthProvider[]
  refreshTokens       RefreshToken[]
  verificationTokens  VerificationToken[]
  passwordResetTokens PasswordResetToken[]
  cars                Car[]

  @@index([createdAt])
}

model Car {
  id        String   @id @default(cuid())
  userId    String
  make      String   @db.VarChar(60)
  model     String   @db.VarChar(60)
  // range enforced at the Zod boundary (carInputSchema)
  year      Int
  nickname  String?  @db.VarChar(60)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user   User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  photos CarPhoto[]

  @@index([userId])
}

model CarPhoto {
  id        String   @id @default(cuid())
  carId     String   @unique   // one photo per car
  objectKey String   @db.VarChar(300)
  width     Int?
  height    Int?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  car Car @relation(fields: [carId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @jdm/db exec prisma migrate dev --name profile_cars`
Expected: a new `migrations/<timestamp>_profile_cars/migration.sql` is created and applied; `prisma generate` runs; no errors.

- [ ] **Step 3: Verify client typecheck**

Run: `pnpm --filter @jdm/db typecheck && pnpm --filter api typecheck`
Expected: green. If `prisma/client` types are stale, `pnpm --filter @jdm/db exec prisma generate` then retry.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add profile fields, Car, CarPhoto models"
```

---

## Task 2: Shared Zod schemas — profile, cars, uploads

**Files:**

- Create: `packages/shared/src/profile.ts`
- Create: `packages/shared/src/cars.ts`
- Create: `packages/shared/src/uploads.ts`
- Modify: `packages/shared/package.json` (exports map)
- Modify: `packages/shared/src/index.ts` (re-export)

- [ ] **Step 1: Write failing smoke test**

Create `packages/shared/src/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { publicProfileSchema, updateProfileSchema } from './profile';

describe('updateProfileSchema', () => {
  it('accepts partial updates', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(true);
    expect(updateProfileSchema.safeParse({ bio: 'hi' }).success).toBe(true);
  });

  it('rejects state codes longer than 2 chars', () => {
    expect(updateProfileSchema.safeParse({ stateCode: 'SPX' }).success).toBe(false);
  });

  it('rejects bio over 500 chars', () => {
    expect(updateProfileSchema.safeParse({ bio: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('publicProfileSchema', () => {
  it('requires the auth fields plus profile fields', () => {
    const ok = publicProfileSchema.safeParse({
      id: 'u1',
      email: 'a@b.c',
      name: 'n',
      role: 'user',
      emailVerifiedAt: null,
      createdAt: new Date().toISOString(),
      bio: null,
      city: null,
      stateCode: null,
      avatarUrl: null,
    });
    expect(ok.success).toBe(true);
  });
});
```

Run: `pnpm --filter @jdm/shared test`
Expected: FAIL — modules don't exist.

- [ ] **Step 2: Implement `profile.ts`**

Create `packages/shared/src/profile.ts`:

```ts
import { z } from 'zod';

import { publicUserSchema } from './auth';

export const BRAZIL_STATE_CODES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
export const stateCodeSchema = z.enum(BRAZIL_STATE_CODES);

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    bio: z.string().trim().max(500),
    city: z.string().trim().min(1).max(100),
    stateCode: stateCodeSchema,
    avatarObjectKey: z.string().min(1).max(300).nullable(),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// publicProfileSchema is the API response shape. `avatarUrl` is server-derived
// from User.avatarObjectKey via app.uploads.buildPublicUrl.
export const publicProfileSchema = publicUserSchema.extend({
  bio: z.string().nullable(),
  city: z.string().nullable(),
  stateCode: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;
```

- [ ] **Step 3: Implement `uploads.ts`**

Create `packages/shared/src/uploads.ts`:

```ts
import { z } from 'zod';

export const UPLOAD_KINDS = ['avatar', 'car_photo'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const presignRequestSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type PresignRequest = z.infer<typeof presignRequestSchema>;

export const presignResponseSchema = z.object({
  uploadUrl: z.string().url(),
  objectKey: z.string().min(1),
  publicUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  headers: z.record(z.string()),
});
export type PresignResponse = z.infer<typeof presignResponseSchema>;
```

- [ ] **Step 4: Implement `cars.ts`**

Create `packages/shared/src/cars.ts`:

```ts
import { z } from 'zod';

export const carInputSchema = z.object({
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1),
  nickname: z.string().trim().min(1).max(60).optional(),
});
export type CarInput = z.infer<typeof carInputSchema>;

export const carUpdateSchema = carInputSchema.partial();
export type CarUpdateInput = z.infer<typeof carUpdateSchema>;

export const carPhotoSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sortOrder: z.number().int(),
});
export type CarPhoto = z.infer<typeof carPhotoSchema>;

export const carSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().nullable(),
  photo: carPhotoSchema.nullable(), // single photo (DB unique constraint)
  photos: z.array(carPhotoSchema), // legacy array kept for one release
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

- [ ] **Step 5: Update exports**

Edit `packages/shared/package.json` — add:

```json
"./profile": "./src/profile.ts",
"./cars": "./src/cars.ts",
"./uploads": "./src/uploads.ts"
```

Edit `packages/shared/src/index.ts` — append:

```ts
export * from './profile';
export * from './cars';
export * from './uploads';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @jdm/shared test && pnpm --filter @jdm/shared typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add profile, cars, uploads zod schemas"
```

---

## Task 3: API — GET /me extended response + PATCH /me

> **Depends on Task 4 (uploads service).** Serializing `User.avatarObjectKey` → `avatarUrl` uses `app.uploads.buildPublicUrl`. Run Task 4 before Task 3.

**Files:**

- Modify: `apps/api/src/routes/me.ts`
- Move/rename: `apps/api/test/auth/me.test.ts` → `apps/api/test/me/get.test.ts`
- Create: `apps/api/test/me/patch.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/me/patch.test.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('PATCH /me', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/me', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('updates allowed fields', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { name: 'Novo', bio: 'biker', city: 'SP', stateCode: 'SP' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: user.id,
      name: 'Novo',
      bio: 'biker',
      city: 'SP',
      stateCode: 'SP',
    });
  });

  it('rejects invalid state code', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { stateCode: 'XX' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('ignores unknown keys', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { role: 'admin', name: 'ok' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('user');
  });
});
```

Also move `apps/api/test/auth/me.test.ts` → `apps/api/test/me/get.test.ts` and extend the "valid token" assertion to include the new nullable fields:

```ts
expect(res.json()).toMatchObject({
  id: user.id,
  email: 'me@jdm.test',
  role: 'user',
  bio: null,
  city: null,
  stateCode: null,
  avatarUrl: null,
});
```

Run: `pnpm --filter api test -- me`
Expected: FAIL — PATCH /me route not defined, and GET /me does not return new fields.

- [ ] **Step 2: Implement**

Replace `apps/api/src/routes/me.ts`:

```ts
import { prisma } from '@jdm/db';
import { publicProfileSchema, updateProfileSchema } from '@jdm/shared/profile';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

import type { Uploads } from '../services/uploads/index.js';

type DbUser = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'organizer' | 'admin';
  emailVerifiedAt: Date | null;
  createdAt: Date;
  bio: string | null;
  city: string | null;
  stateCode: string | null;
  avatarObjectKey: string | null;
};

const serializeUser = (user: DbUser, uploads: Uploads) =>
  publicProfileSchema.parse({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    bio: user.bio,
    city: user.city,
    stateCode: user.stateCode,
    avatarUrl: user.avatarObjectKey ? uploads.buildPublicUrl(user.avatarObjectKey) : null,
  });

// eslint-disable-next-line @typescript-eslint/require-await
export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const user = await prisma.user.findUnique({ where: { id: sub } });
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    return serializeUser(user, app.uploads);
  });

  app.patch('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', issues: parsed.error.flatten() });
    }
    const user = await prisma.user.update({ where: { id: sub }, data: parsed.data });
    return serializeUser(user, app.uploads);
  });
};
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter api test -- me`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/me.ts apps/api/test/me
git rm apps/api/test/auth/me.test.ts 2>/dev/null || true
git commit -m "feat(api): extend /me with profile fields and PATCH"
```

---

## Task 4: Uploads service — env + factory + interface

**Files:**

- Modify: `apps/api/src/env.ts`
- Create: `apps/api/src/services/uploads/types.ts`
- Create: `apps/api/src/services/uploads/r2.ts`
- Create: `apps/api/src/services/uploads/dev.ts`
- Create: `apps/api/src/services/uploads/index.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/helpers.ts`
- Modify: `apps/api/package.json` (+`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)

- [ ] **Step 1: Install deps**

Run: `pnpm --filter api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
Expected: lockfile updates; `pnpm --filter api typecheck` still green.

- [ ] **Step 2: Extend env schema**

Edit `apps/api/src/env.ts` — add inside the `z.object({ … })`:

```ts
R2_ACCOUNT_ID: z.string().optional(),
R2_ACCESS_KEY_ID: z.string().optional(),
R2_SECRET_ACCESS_KEY: z.string().optional(),
R2_BUCKET: z.string().optional(),
R2_PUBLIC_BASE_URL: z.string().url().optional(),
UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
```

- [ ] **Step 3: Write the interface**

Create `apps/api/src/services/uploads/types.ts`:

```ts
export type PresignInput = {
  kind: 'avatar' | 'car_photo';
  userId: string;
  contentType: string;
  size: number;
};

export type PresignResult = {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  expiresAt: Date;
  headers: Record<string, string>;
};

export interface Uploads {
  presignPut(input: PresignInput): Promise<PresignResult>;
  buildPublicUrl(objectKey: string): string;
  isOwnedKey(objectKey: string, userId: string, kind: 'avatar' | 'car_photo'): boolean;
}
```

- [ ] **Step 4: DevUploads (used locally + in tests)**

Create `apps/api/src/services/uploads/dev.ts`:

```ts
import { createId } from '@paralleldrive/cuid2';

import type { PresignInput, PresignResult, Uploads } from './types.js';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export class DevUploads implements Uploads {
  constructor(
    private readonly publicBase = 'http://localhost:4000/dev-uploads',
    private readonly ttlSeconds = 300,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async presignPut(input: PresignInput): Promise<PresignResult> {
    const ext = EXT[input.contentType] ?? 'bin';
    const objectKey = `${input.kind}/${input.userId}/${createId()}.${ext}`;
    return {
      uploadUrl: `${this.publicBase}/put/${objectKey}`,
      objectKey,
      publicUrl: this.buildPublicUrl(objectKey),
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      headers: { 'content-type': input.contentType },
    };
  }

  buildPublicUrl(objectKey: string): string {
    return `${this.publicBase}/${objectKey}`;
  }

  isOwnedKey(objectKey: string, userId: string, kind: 'avatar' | 'car_photo'): boolean {
    return objectKey.startsWith(`${kind}/${userId}/`);
  }
}
```

Then install cuid2 (cuid already comes with Prisma's `@default(cuid())` but the SDK's `createId` is the standalone package):

Run: `pnpm --filter api add @paralleldrive/cuid2`

- [ ] **Step 5: R2Uploads**

Create `apps/api/src/services/uploads/r2.ts`:

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createId } from '@paralleldrive/cuid2';

import type { PresignInput, PresignResult, Uploads } from './types.js';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export class R2Uploads implements Uploads {
  private readonly client: S3Client;

  constructor(
    opts: { accountId: string; accessKeyId: string; secretAccessKey: string },
    private readonly bucket: string,
    private readonly publicBase: string,
    private readonly ttlSeconds: number,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
  }

  async presignPut(input: PresignInput): Promise<PresignResult> {
    const ext = EXT[input.contentType] ?? 'bin';
    const objectKey = `${input.kind}/${input.userId}/${createId()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.size,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.ttlSeconds });
    return {
      uploadUrl,
      objectKey,
      publicUrl: this.buildPublicUrl(objectKey),
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      headers: { 'content-type': input.contentType },
    };
  }

  buildPublicUrl(objectKey: string): string {
    return `${this.publicBase.replace(/\/$/, '')}/${objectKey}`;
  }

  isOwnedKey(objectKey: string, userId: string, kind: 'avatar' | 'car_photo'): boolean {
    return objectKey.startsWith(`${kind}/${userId}/`);
  }
}
```

- [ ] **Step 6: Factory**

Create `apps/api/src/services/uploads/index.ts`:

```ts
import type { Env } from '../../env.js';

import { DevUploads } from './dev.js';
import { R2Uploads } from './r2.js';
import type { Uploads } from './types.js';

export type { Uploads, PresignInput, PresignResult } from './types.js';
export { DevUploads } from './dev.js';

export const buildUploads = (env: Env): Uploads => {
  const r2Ready =
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET &&
    env.R2_PUBLIC_BASE_URL;
  if (env.NODE_ENV === 'production') {
    if (!r2Ready) throw new Error('R2 env vars required in production');
    return new R2Uploads(
      {
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
      env.R2_BUCKET!,
      env.R2_PUBLIC_BASE_URL!,
      env.UPLOAD_URL_TTL_SECONDS,
    );
  }
  if (r2Ready) {
    return new R2Uploads(
      {
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
      env.R2_BUCKET!,
      env.R2_PUBLIC_BASE_URL!,
      env.UPLOAD_URL_TTL_SECONDS,
    );
  }
  return new DevUploads();
};
```

- [ ] **Step 7: Wire `app.uploads`**

Edit `apps/api/src/app.ts` — in the `declare module 'fastify'` block add `uploads: Uploads;`, import `buildUploads` and `Uploads`, and decorate:

```ts
import { buildUploads, type Uploads } from './services/uploads/index.js';
// ...
declare module 'fastify' {
  interface FastifyInstance {
    mailer: Mailer;
    uploads: Uploads;
    env: Env;
  }
}
// ...
app.decorate('uploads', buildUploads(env));
```

- [ ] **Step 8: Extend `resetDatabase` for tests**

Edit `apps/api/test/helpers.ts` — in `resetDatabase`, add the new tables at the top (children before parent):

```ts
export const resetDatabase = async (): Promise<void> => {
  await prisma.carPhoto.deleteMany();
  await prisma.car.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.authProvider.deleteMany();
  await prisma.user.deleteMany();
};
```

- [ ] **Step 9: Run typecheck**

Run: `pnpm typecheck`
Expected: green.

- [ ] **Step 10: Commit**

```bash
git add apps/api apps/api/test/helpers.ts pnpm-lock.yaml
git commit -m "feat(api): add uploads service with R2 and dev backends"
```

---

## Task 5: API — POST /uploads/presign

**Files:**

- Create: `apps/api/src/routes/uploads.ts`
- Modify: `apps/api/src/app.ts` (register route)
- Create: `apps/api/test/uploads/presign.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/uploads/presign.test.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /uploads/presign', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      payload: { kind: 'avatar', contentType: 'image/jpeg', size: 1234 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns a signed URL for a valid avatar request', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(env, user.id) },
      payload: { kind: 'avatar', contentType: 'image/jpeg', size: 2048 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.objectKey).toMatch(new RegExp(`^avatar/${user.id}/`));
    expect(body.publicUrl).toContain(body.objectKey);
    expect(body.uploadUrl).toMatch(/^https?:\/\//);
    expect(body.headers['content-type']).toBe('image/jpeg');
  });

  it('rejects non-image content types', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(env, user.id) },
      payload: { kind: 'avatar', contentType: 'application/pdf', size: 2048 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects oversized uploads', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(env, user.id) },
      payload: { kind: 'avatar', contentType: 'image/jpeg', size: 11 * 1024 * 1024 },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

Run: `pnpm --filter api test -- uploads`
Expected: FAIL — route not defined (404).

- [ ] **Step 2: Implement**

Create `apps/api/src/routes/uploads.ts`:

```ts
import { presignRequestSchema } from '@jdm/shared/uploads';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.post('/uploads/presign', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const parsed = presignRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', issues: parsed.error.flatten() });
    }
    const result = await app.uploads.presignPut({
      kind: parsed.data.kind,
      userId: sub,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
    });
    return {
      uploadUrl: result.uploadUrl,
      objectKey: result.objectKey,
      publicUrl: result.publicUrl,
      expiresAt: result.expiresAt.toISOString(),
      headers: result.headers,
    };
  });
};
```

Edit `apps/api/src/app.ts` — register the route after `meRoutes`:

```ts
import { uploadRoutes } from './routes/uploads.js';
// ...
await app.register(uploadRoutes);
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter api test -- uploads`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/uploads.ts apps/api/src/app.ts apps/api/test/uploads
git commit -m "feat(api): add POST /uploads/presign"
```

---

## Task 6: API — list, create cars

**Files:**

- Create: `apps/api/src/routes/cars.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/cars/list.test.ts`
- Create: `apps/api/test/cars/create.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/cars/list.test.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@jdm/db';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /me/cars', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/cars' });
    expect(res.statusCode).toBe(401);
  });

  it('returns only the caller\u2019s cars, with photos', async () => {
    const { user: me } = await createUser({ email: 'me@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'o@jdm.test', verified: true });
    const mine = await prisma.car.create({
      data: { userId: me.id, make: 'Honda', model: 'Civic', year: 1999 },
    });
    await prisma.carPhoto.create({
      data: {
        carId: mine.id,
        objectKey: `car_photo/${me.id}/p1.jpg`,
        sortOrder: 0,
      },
    });
    await prisma.car.create({
      data: { userId: other.id, make: 'Toyota', model: 'Supra', year: 1998 },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: bearer(env, me.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cars).toHaveLength(1);
    expect(body.cars[0]).toMatchObject({ make: 'Honda', model: 'Civic', year: 1999 });
    expect(body.cars[0].photos).toHaveLength(1);
  });
});
```

Create `apps/api/test/cars/create.test.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /me/cars', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a car for the caller', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Mazda', model: 'RX-7', year: 1993, nickname: 'FD' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      make: 'Mazda',
      model: 'RX-7',
      year: 1993,
      nickname: 'FD',
      photos: [],
    });
  });

  it('rejects invalid year', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Mazda', model: 'RX-7', year: 1800 },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

Run: `pnpm --filter api test -- cars`
Expected: FAIL — 404.

- [ ] **Step 2: Implement**

Create `apps/api/src/routes/cars.ts`:

```ts
import { prisma } from '@jdm/db';
import { carInputSchema, carSchema } from '@jdm/shared/cars';
import type { Car as DbCar, CarPhoto as DbPhoto } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import type { Uploads } from '../services/uploads/index.js';

type CarWithPhotos = DbCar & { photos: DbPhoto[] };

const serializeCar = (car: CarWithPhotos, uploads: Uploads) =>
  carSchema.parse({
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname,
    createdAt: car.createdAt.toISOString(),
    updatedAt: car.updatedAt.toISOString(),
    photos: car.photos
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({
        id: p.id,
        url: uploads.buildPublicUrl(p.objectKey),
        width: p.width,
        height: p.height,
        sortOrder: p.sortOrder,
      })),
  });

// eslint-disable-next-line @typescript-eslint/require-await
export const carRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/cars', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const cars = await prisma.car.findMany({
      where: { userId: sub },
      include: { photos: true },
      orderBy: { createdAt: 'desc' },
    });
    return { cars: cars.map((c) => serializeCar(c, app.uploads)) };
  });

  app.post('/me/cars', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const parsed = carInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', issues: parsed.error.flatten() });
    }
    const car = await prisma.car.create({
      data: { ...parsed.data, userId: sub },
      include: { photos: true },
    });
    return reply.status(201).send(serializeCar(car, app.uploads));
  });
};
```

Edit `apps/api/src/app.ts` — register after `uploadRoutes`:

```ts
import { carRoutes } from './routes/cars.js';
// ...
await app.register(carRoutes);
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter api test -- cars`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/cars.ts apps/api/src/app.ts apps/api/test/cars
git commit -m "feat(api): list + create cars under /me/cars"
```

---

## Task 7: API — update + delete a car

**Files:**

- Modify: `apps/api/src/routes/cars.ts`
- Create: `apps/api/test/cars/update.test.ts`
- Create: `apps/api/test/cars/delete.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/cars/update.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('PATCH /me/cars/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('updates the caller\u2019s car', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993 },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/cars/${car.id}`,
      headers: { authorization: bearer(env, user.id) },
      payload: { nickname: 'FD3S' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ nickname: 'FD3S' });
  });

  it('returns 404 when car belongs to someone else', async () => {
    const { user: me } = await createUser({ email: 'me@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'o@jdm.test', verified: true });
    const theirs = await prisma.car.create({
      data: { userId: other.id, make: 'Honda', model: 'NSX', year: 1991 },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/cars/${theirs.id}`,
      headers: { authorization: bearer(env, me.id) },
      payload: { nickname: 'sneaky' },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

Create `apps/api/test/cars/delete.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('DELETE /me/cars/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes the car and cascades photos', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Nissan', model: 'Skyline', year: 1999 },
    });
    await prisma.carPhoto.create({
      data: {
        carId: car.id,
        objectKey: `car_photo/${user.id}/x.jpg`,
      },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/cars/${car.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.car.count()).toBe(0);
    expect(await prisma.carPhoto.count()).toBe(0);
  });

  it('returns 404 for missing car', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: '/me/cars/nonexistent',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

Run: `pnpm --filter api test -- cars`
Expected: FAIL on the new suites.

- [ ] **Step 2: Implement**

Append to `apps/api/src/routes/cars.ts` inside the plugin function, and import `carUpdateSchema`:

```ts
import { carInputSchema, carSchema, carUpdateSchema } from '@jdm/shared/cars';
// ...
app.patch('/me/cars/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const parsed = carUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'BadRequest', issues: parsed.error.flatten() });
  }
  const owned = await prisma.car.findFirst({ where: { id, userId: sub } });
  if (!owned) return reply.status(404).send({ error: 'NotFound' });
  const updated = await prisma.car.update({
    where: { id },
    data: parsed.data,
    include: { photos: true },
  });
  return serializeCar(updated, app.uploads);
});

app.delete('/me/cars/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const owned = await prisma.car.findFirst({ where: { id, userId: sub } });
  if (!owned) return reply.status(404).send({ error: 'NotFound' });
  await prisma.car.delete({ where: { id } });
  return reply.status(204).send();
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter api test -- cars`
Expected: PASS (all four cars test files green).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/cars.ts apps/api/test/cars
git commit -m "feat(api): update + delete own cars"
```

---

## Task 8: API — set + remove car photo (single-image cap)

**Files:**

- Modify: `apps/api/src/routes/cars.ts`
- Create: `apps/api/test/cars/photos.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/test/cars/photos.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('car photos', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('adds a photo when the objectKey belongs to the caller', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993 },
    });
    const env = loadEnv();
    const objectKey = `car_photo/${user.id}/abc.jpg`;
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${car.id}/photos`,
      headers: { authorization: bearer(env, user.id) },
      payload: { objectKey, width: 1200, height: 800 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0]).toMatchObject({ width: 1200, height: 800 });
    expect(body.photos[0].url).toContain(objectKey);
  });

  it('rejects an objectKey not owned by caller', async () => {
    const { user: me } = await createUser({ email: 'me@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'o@jdm.test', verified: true });
    const car = await prisma.car.create({
      data: { userId: me.id, make: 'Mazda', model: 'RX7', year: 1993 },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/me/cars/${car.id}/photos`,
      headers: { authorization: bearer(env, me.id) },
      payload: { objectKey: `car_photo/${other.id}/abc.jpg` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deletes a photo on the caller\u2019s car', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993 },
    });
    const photo = await prisma.carPhoto.create({
      data: {
        carId: car.id,
        objectKey: `car_photo/${user.id}/x.jpg`,
      },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/cars/${car.id}/photos/${photo.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.carPhoto.count()).toBe(0);
  });
});
```

Run: `pnpm --filter api test -- cars/photos`
Expected: FAIL — routes not defined.

- [ ] **Step 2: Implement**

Append to `apps/api/src/routes/cars.ts`:

```ts
import { addCarPhotoSchema, carInputSchema, carSchema, carUpdateSchema } from '@jdm/shared/cars';
// ... inside the plugin:
app.post('/me/cars/:id/photos', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const parsed = addCarPhotoSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'BadRequest', issues: parsed.error.flatten() });
  }
  if (!app.uploads.isOwnedKey(parsed.data.objectKey, sub, 'car_photo')) {
    return reply.status(400).send({ error: 'BadRequest', message: 'object key not owned' });
  }
  const car = await prisma.car.findFirst({ where: { id, userId: sub } });
  if (!car) return reply.status(404).send({ error: 'NotFound' });

  const existing = await prisma.carPhoto.findUnique({ where: { carId: id } });
  if (existing) {
    return reply.status(409).send({ error: 'Conflict', code: 'car_photo_limit_reached' });
  }
  await prisma.carPhoto.create({
    data: {
      carId: id,
      objectKey: parsed.data.objectKey,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
    },
  });
  const updated = await prisma.car.findUniqueOrThrow({
    where: { id },
    include: { photos: true },
  });
  return reply.status(201).send(serializeCar(updated, app.uploads));
});

app.delete(
  '/me/cars/:id/photos/:photoId',
  { preHandler: [app.authenticate] },
  async (request, reply) => {
    const { sub } = requireUser(request);
    const { id, photoId } = request.params as { id: string; photoId: string };
    const car = await prisma.car.findFirst({ where: { id, userId: sub } });
    if (!car) return reply.status(404).send({ error: 'NotFound' });
    const photo = await prisma.carPhoto.findFirst({ where: { id: photoId, carId: id } });
    if (!photo) return reply.status(404).send({ error: 'NotFound' });
    await prisma.carPhoto.delete({ where: { id: photoId } });
    return reply.status(204).send();
  },
);
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter api test -- cars`
Expected: PASS on all five cars suites.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/cars.ts apps/api/test/cars
git commit -m "feat(api): add and remove car photos"
```

---

## Task 9: Mobile — profile API client + copy

**Files:**

- Create: `apps/mobile/src/api/profile.ts`
- Create: `apps/mobile/src/api/uploads.ts`
- Create: `apps/mobile/src/api/cars.ts`
- Create: `apps/mobile/src/copy/profile.ts`

- [ ] **Step 1: Create `profile.ts` client**

Create `apps/mobile/src/api/profile.ts`:

```ts
import {
  publicProfileSchema,
  type PublicProfile,
  updateProfileSchema,
  type UpdateProfileInput,
} from '@jdm/shared/profile';

import { authedRequest } from './client';

export const getProfile = (): Promise<PublicProfile> => authedRequest('/me', publicProfileSchema);

export const updateProfile = (input: UpdateProfileInput): Promise<PublicProfile> => {
  const parsed = updateProfileSchema.parse(input);
  return authedRequest('/me', publicProfileSchema, { method: 'PATCH', body: parsed });
};
```

- [ ] **Step 2: Create `uploads.ts` client**

Create `apps/mobile/src/api/uploads.ts`:

```ts
import {
  presignRequestSchema,
  presignResponseSchema,
  type PresignRequest,
  type PresignResponse,
} from '@jdm/shared/uploads';

import { authedRequest } from './client';

export const requestPresign = (input: PresignRequest): Promise<PresignResponse> => {
  const parsed = presignRequestSchema.parse(input);
  return authedRequest('/uploads/presign', presignResponseSchema, {
    method: 'POST',
    body: parsed,
  });
};
```

- [ ] **Step 3: Create `cars.ts` client**

Create `apps/mobile/src/api/cars.ts`:

```ts
import {
  addCarPhotoSchema,
  type AddCarPhotoInput,
  type Car,
  carListResponseSchema,
  carSchema,
  type CarInput,
  carInputSchema,
  type CarUpdateInput,
  carUpdateSchema,
} from '@jdm/shared/cars';
import { z } from 'zod';

import { authedRequest } from './client';

export const listCars = async (): Promise<Car[]> => {
  const res = await authedRequest('/me/cars', carListResponseSchema);
  return res.cars;
};

export const createCar = (input: CarInput): Promise<Car> =>
  authedRequest('/me/cars', carSchema, {
    method: 'POST',
    body: carInputSchema.parse(input),
  });

export const updateCar = (id: string, input: CarUpdateInput): Promise<Car> =>
  authedRequest(`/me/cars/${id}`, carSchema, {
    method: 'PATCH',
    body: carUpdateSchema.parse(input),
  });

export const deleteCar = (id: string): Promise<void> =>
  authedRequest(`/me/cars/${id}`, z.unknown(), { method: 'DELETE' }).then(() => undefined);

export const addCarPhoto = (id: string, input: AddCarPhotoInput): Promise<Car> =>
  authedRequest(`/me/cars/${id}/photos`, carSchema, {
    method: 'POST',
    body: addCarPhotoSchema.parse(input),
  });

export const removeCarPhoto = (carId: string, photoId: string): Promise<void> =>
  authedRequest(`/me/cars/${carId}/photos/${photoId}`, z.unknown(), { method: 'DELETE' }).then(
    () => undefined,
  );
```

- [ ] **Step 4: Create copy module**

Create `apps/mobile/src/copy/profile.ts`:

```ts
export const profileCopy = {
  profile: {
    title: 'Perfil',
    edit: 'Editar',
    save: 'Salvar',
    cancel: 'Cancelar',
    nameLabel: 'Nome',
    bioLabel: 'Bio',
    cityLabel: 'Cidade',
    stateLabel: 'Estado (UF)',
    avatarChange: 'Alterar foto',
    avatarUploading: 'Enviando foto…',
    saved: 'Perfil atualizado.',
    saveFailed: 'Não foi possível salvar.',
  },
  garage: {
    title: 'Garagem',
    empty: 'Você ainda não cadastrou carros.',
    add: 'Adicionar carro',
    makeLabel: 'Marca',
    modelLabel: 'Modelo',
    yearLabel: 'Ano',
    nicknameLabel: 'Apelido (opcional)',
    save: 'Salvar',
    delete: 'Excluir',
    deleteConfirm: 'Remover este carro?',
    addPhoto: 'Adicionar foto',
    photoUploading: 'Enviando foto…',
    removePhoto: 'Remover',
  },
  errors: {
    network: 'Sem conexão. Tente novamente.',
    unknown: 'Algo deu errado.',
    imageTooLarge: 'Imagem acima de 10 MB.',
    imagePicker: 'Não foi possível abrir a galeria.',
  },
};
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @jdm/mobile typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api apps/mobile/src/copy/profile.ts
git commit -m "feat(mobile): profile, cars, uploads api clients"
```

---

## Task 10: Mobile — image pick + presigned PUT helper

**Files:**

- Create: `apps/mobile/src/lib/upload-image.ts`
- Modify: `apps/mobile/package.json` (+`expo-image-picker`)

- [ ] **Step 1: Install dep**

Run: `pnpm --filter @jdm/mobile add expo-image-picker`
Then: `pnpm --filter @jdm/mobile exec expo install --check`
Expected: version aligned with the Expo SDK in use.

- [ ] **Step 2: Write the helper**

Create `apps/mobile/src/lib/upload-image.ts`:

```ts
import * as ImagePicker from 'expo-image-picker';

import { requestPresign } from '~/api/uploads';
import type { UploadKind, PresignResponse } from '@jdm/shared/uploads';

export type PickedImage = {
  uri: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  width: number;
  height: number;
};

const MIME_FROM_EXT: Record<string, PickedImage['mime']> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const inferMime = (asset: ImagePicker.ImagePickerAsset): PickedImage['mime'] | null => {
  if (asset.mimeType && asset.mimeType in { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 }) {
    return asset.mimeType as PickedImage['mime'];
  }
  const ext = asset.uri.split('.').pop()?.toLowerCase() ?? '';
  return MIME_FROM_EXT[ext] ?? null;
};

export const pickImage = async (): Promise<PickedImage | null> => {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.85,
    exif: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  const mime = inferMime(asset);
  if (!mime) return null;
  return {
    uri: asset.uri,
    mime,
    size: asset.fileSize ?? 0,
    width: asset.width,
    height: asset.height,
  };
};

export const uploadToR2 = async (picked: PickedImage, presign: PresignResponse): Promise<void> => {
  const blob = await (await fetch(picked.uri)).blob();
  const res = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: presign.headers,
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`upload failed (${res.status})`);
  }
};

export const pickAndUpload = async (
  kind: UploadKind,
): Promise<{ picked: PickedImage; presign: PresignResponse } | null> => {
  const picked = await pickImage();
  if (!picked) return null;
  const presign = await requestPresign({
    kind,
    contentType: picked.mime,
    size: picked.size || 1,
  });
  await uploadToR2(picked, presign);
  return { picked, presign };
};
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @jdm/mobile typecheck`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/upload-image.ts apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat(mobile): image picker and presigned upload helper"
```

---

## Task 11: Mobile — (app) route group + profile screen

**Files:**

- Create: `apps/mobile/app/(app)/_layout.tsx`
- Create: `apps/mobile/app/(app)/profile.tsx`
- Modify: `apps/mobile/app/welcome.tsx` (redirect)
- Modify: `apps/mobile/app/_layout.tsx` (Gate adds `(app)` to authed prefix if needed)

- [ ] **Step 1: Route group layout**

Create `apps/mobile/app/(app)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
```

- [ ] **Step 2: Profile screen**

Create `apps/mobile/app/(app)/profile.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { type PublicProfile } from '@jdm/shared/profile';
import {
  BRAZIL_STATE_CODES,
  updateProfileSchema,
  type UpdateProfileInput,
} from '@jdm/shared/profile';

import { getProfile, updateProfile } from '~/api/profile';
import { Button } from '~/components/Button';
import { TextField } from '~/components/TextField';
import { profileCopy } from '~/copy/profile';
import { pickAndUpload } from '~/lib/upload-image';
import { theme } from '~/theme';

export default function ProfileScreen() {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: '', bio: '', city: '', stateCode: undefined },
  });

  useEffect(() => {
    void (async () => {
      const p = await getProfile();
      setProfile(p);
      form.reset({
        name: p.name,
        bio: p.bio ?? '',
        city: p.city ?? '',
        stateCode: (p.stateCode as UpdateProfileInput['stateCode']) ?? undefined,
      });
    })();
  }, [form]);

  const onSave = form.handleSubmit(async (values) => {
    try {
      const updated = await updateProfile(values);
      setProfile(updated);
      setBanner(profileCopy.profile.saved);
    } catch {
      setBanner(profileCopy.profile.saveFailed);
    }
  });

  const onChangeAvatar = async () => {
    setUploading(true);
    try {
      const up = await pickAndUpload('avatar');
      if (!up) return;
      const updated = await updateProfile({ avatarObjectKey: up.presign.objectKey });
      setProfile(updated);
    } catch {
      setBanner(profileCopy.errors.unknown);
    } finally {
      setUploading(false);
    }
  };

  if (!profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable
        onPress={() => void onChangeAvatar()}
        style={styles.avatarBtn}
        accessibilityRole="button"
      >
        {profile.avatarUrl ? (
          <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]} />
        )}
        <Text style={styles.link}>
          {uploading ? profileCopy.profile.avatarUploading : profileCopy.profile.avatarChange}
        </Text>
      </Pressable>

      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.profile.nameLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="bio"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.profile.bioLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            multiline
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="city"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.profile.cityLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="stateCode"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.profile.stateLabel}
            value={field.value ?? ''}
            onChangeText={(v) => field.onChange(v.toUpperCase().slice(0, 2))}
            autoCapitalize="characters"
            maxLength={2}
            error={fieldState.error?.message}
            placeholder={BRAZIL_STATE_CODES.join(', ')}
          />
        )}
      />

      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      <Button label={profileCopy.profile.save} onPress={() => void onSave()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.xl, gap: theme.spacing.md, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  avatarBtn: { alignItems: 'center', gap: theme.spacing.xs },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: { backgroundColor: theme.colors.muted },
  link: { color: theme.colors.fg, textDecorationLine: 'underline' },
  banner: { color: theme.colors.muted },
});
```

- [ ] **Step 3: Redirect welcome → profile**

Replace `apps/mobile/app/welcome.tsx` with:

```tsx
import { Redirect } from 'expo-router';

export default function Welcome() {
  return <Redirect href="/profile" />;
}
```

- [ ] **Step 4: Update Gate inAuth prefixes**

Inspect `apps/mobile/app/_layout.tsx` and make sure the `(app)` group is treated as an authed-only area. If the Gate uses a prefix list, add `/profile` and `/garage` to it.

Minimal change (no new code unless Gate already has an explicit allowlist): if Gate redirects unauthenticated users to `/login` for anything not in the `inAuth` list, add the new routes there; otherwise leave untouched.

- [ ] **Step 5: Run typegen + typecheck**

Run: `pnpm --filter @jdm/mobile typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app
git commit -m "feat(mobile): profile screen with avatar upload"
```

---

## Task 12: Mobile — garage list + new car

**Files:**

- Create: `apps/mobile/app/(app)/garage/index.tsx`
- Create: `apps/mobile/app/(app)/garage/new.tsx`

- [ ] **Step 1: List screen**

Create `apps/mobile/app/(app)/garage/index.tsx`:

```tsx
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Car } from '@jdm/shared/cars';

import { listCars } from '~/api/cars';
import { Button } from '~/components/Button';
import { profileCopy } from '~/copy/profile';
import { theme } from '~/theme';

export default function GarageIndex() {
  const router = useRouter();
  const [cars, setCars] = useState<Car[] | null>(null);

  useEffect(() => {
    void (async () => setCars(await listCars()))();
  }, []);

  if (!cars) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Button label={profileCopy.garage.add} onPress={() => router.push('/garage/new' as never)} />
      {cars.length === 0 ? (
        <Text style={styles.empty}>{profileCopy.garage.empty}</Text>
      ) : (
        <FlatList
          data={cars}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Link href={`/garage/${item.id}` as never} asChild>
              <Pressable style={styles.card}>
                {item.photos[0] ? (
                  <Image source={{ uri: item.photos[0].url }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>
                    {item.year} {item.make} {item.model}
                  </Text>
                  {item.nickname ? <Text style={styles.sub}>{item.nickname}</Text> : null}
                </View>
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  empty: { color: theme.colors.muted },
  list: { gap: theme.spacing.md },
  card: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
  },
  thumb: { width: 64, height: 64, borderRadius: theme.radius.sm },
  thumbPlaceholder: { backgroundColor: theme.colors.muted },
  title: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  sub: { color: theme.colors.muted },
});
```

- [ ] **Step 2: New car screen**

Create `apps/mobile/app/(app)/garage/new.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { carInputSchema, type CarInput } from '@jdm/shared/cars';

import { createCar } from '~/api/cars';
import { Button } from '~/components/Button';
import { TextField } from '~/components/TextField';
import { profileCopy } from '~/copy/profile';
import { theme } from '~/theme';

export default function NewCar() {
  const router = useRouter();
  const form = useForm<CarInput>({
    resolver: zodResolver(carInputSchema),
    defaultValues: { make: '', model: '', year: new Date().getFullYear(), nickname: undefined },
  });

  const onSave = form.handleSubmit(async (values) => {
    const car = await createCar(values);
    router.replace(`/garage/${car.id}` as never);
  });

  return (
    <View style={styles.container}>
      <Controller
        control={form.control}
        name="make"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.makeLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="model"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.modelLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="year"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.yearLabel}
            keyboardType="number-pad"
            value={String(field.value ?? '')}
            onChangeText={(v) => field.onChange(Number(v) || 0)}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="nickname"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.nicknameLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Button label={profileCopy.garage.save} onPress={() => void onSave()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
});
```

- [ ] **Step 3: Typecheck + typegen**

Run: `pnpm --filter @jdm/mobile typecheck`
Expected: green (typegen runs as pretypecheck).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(app\)/garage
git commit -m "feat(mobile): garage list and new-car screens"
```

---

## Task 13: Mobile — car detail (edit + single photo + delete)

**Files:**

- Create: `apps/mobile/app/(app)/garage/[id].tsx`

- [ ] **Step 1: Detail screen**

Create `apps/mobile/app/(app)/garage/[id].tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { type Car, carUpdateSchema, type CarUpdateInput } from '@jdm/shared/cars';

import { addCarPhoto, deleteCar, listCars, removeCarPhoto, updateCar } from '~/api/cars';
import { Button } from '~/components/Button';
import { TextField } from '~/components/TextField';
import { profileCopy } from '~/copy/profile';
import { pickAndUpload } from '~/lib/upload-image';
import { theme } from '~/theme';

export default function CarDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [car, setCar] = useState<Car | null>(null);
  const [uploading, setUploading] = useState(false);

  const form = useForm<CarUpdateInput>({
    resolver: zodResolver(carUpdateSchema),
    defaultValues: {},
  });

  useEffect(() => {
    void (async () => {
      const all = await listCars();
      const found = all.find((c) => c.id === id) ?? null;
      setCar(found);
      if (found) {
        form.reset({
          make: found.make,
          model: found.model,
          year: found.year,
          nickname: found.nickname ?? undefined,
        });
      }
    })();
  }, [form, id]);

  const onSave = form.handleSubmit(async (values) => {
    if (!car) return;
    const updated = await updateCar(car.id, values);
    setCar(updated);
  });

  const onSetPhoto = async () => {
    if (!car) return;
    setUploading(true);
    try {
      if (car.photo) {
        await removeCarPhoto(car.id, car.photo.id);
      }
      const up = await pickAndUpload('car_photo');
      if (!up) return;
      const updated = await addCarPhoto(car.id, {
        objectKey: up.presign.objectKey,
        width: up.picked.width,
        height: up.picked.height,
      });
      setCar(updated);
    } finally {
      setUploading(false);
    }
  };

  const onRemovePhoto = async () => {
    if (!car?.photo) return;
    await removeCarPhoto(car.id, car.photo.id);
    setCar({ ...car, photo: null, photos: [] });
  };

  const onDelete = () => {
    if (!car) return;
    Alert.alert(profileCopy.garage.deleteConfirm, '', [
      { text: profileCopy.garage.save, style: 'cancel' },
      {
        text: profileCopy.garage.delete,
        style: 'destructive',
        onPress: async () => {
          await deleteCar(car.id);
          router.replace('/garage' as never);
        },
      },
    ]);
  };

  if (!car) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.photoRow}>
        {car.photo ? (
          <Pressable onLongPress={() => void onRemovePhoto()}>
            <Image source={{ uri: car.photo.url }} style={styles.photo} />
          </Pressable>
        ) : (
          <Pressable style={[styles.photo, styles.photoAdd]} onPress={() => void onSetPhoto()}>
            <Text style={styles.photoAddLabel}>
              {uploading ? profileCopy.garage.photoUploading : profileCopy.garage.addPhoto}
            </Text>
          </Pressable>
        )}
      </View>

      <Controller
        control={form.control}
        name="make"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.makeLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="model"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.modelLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="year"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.yearLabel}
            keyboardType="number-pad"
            value={String(field.value ?? '')}
            onChangeText={(v) => field.onChange(Number(v) || 0)}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="nickname"
        render={({ field, fieldState }) => (
          <TextField
            label={profileCopy.garage.nicknameLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />

      <Button label={profileCopy.garage.save} onPress={() => void onSave()} />
      <Button label={profileCopy.garage.delete} onPress={onDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.xl, gap: theme.spacing.md, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  photoRow: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  photo: { width: 120, height: 120, borderRadius: theme.radius.sm },
  photoAdd: {
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoAddLabel: {
    color: theme.colors.fg,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @jdm/mobile typecheck`
Expected: green.

- [ ] **Step 3: Manual smoke (web preview)**

Run: `pnpm --filter @jdm/mobile dev --web` and verify `/profile`, `/garage`, `/garage/new`, `/garage/<id>` render against a running API (`pnpm --filter api dev`). Confirm:

- Profile save persists after reload.
- Car create/edit/delete all work.
- Avatar upload attaches to profile.
- Car photo upload attaches to the car (one photo max; second upload returns 409).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(app\)/garage/\[id\].tsx
git commit -m "feat(mobile): car detail with photo and edit flows"
```

---

## Task 14: Lint/typecheck/test sweep + roadmap + handoff

**Files:**

- Modify: `roadmap.md` (flip 2.1–2.6 markers per rules)
- Modify: `handoff.md` (rewrite for F2)

- [ ] **Step 1: Full check**

Run:

```
pnpm typecheck
pnpm test
pnpm --filter api test
```

Expected: all green.

- [ ] **Step 2: Flip roadmap markers**

Edit `roadmap.md` — flip the six F2 task boxes: when the branch is first pushed, flip `[ ]` → `[~]` on 2.1–2.6. When this PR merges to `main` and the API is redeployed to Railway, flip `[~]` → `[x]`. Per the roadmap file's own rules, `[x]` only lands if deployed — if Railway deploy hasn't happened yet by merge, leave them `[~]` with the same rationale footnote used for F1.1–F1.9 in the Deferred section.

- [ ] **Step 3: Rewrite `handoff.md`**

Replace `handoff.md` with a F2-scoped handoff covering:

- PR link and branch name.
- What landed (API endpoints + mobile screens + R2 wiring).
- Env vars required on Railway (R2\_\*) — flag that uploads silently use `DevUploads` if any R2 var is missing.
- Outstanding follow-ups (delete orphaned R2 objects when photos/avatars are replaced; LGPD `/me/export` and `/me/delete` still pending in Phase X.2).
- Smoke commands.

- [ ] **Step 4: Commit + open PR**

```bash
git add roadmap.md handoff.md
git commit -m "docs: flip roadmap F2 markers and rewrite handoff"
git push -u origin feat/f2-profile
gh pr create --title "feat(f2): profile and garage" --body-file handoff.md
```

Expected: PR opens green on CI.

---

## Self-review checklist (run before handing off)

- [ ] Every task commits, runs green locally, can be reverted cleanly.
- [ ] No secrets committed. R2 vars only in `.env.example` (add them to secrets doc in a follow-up if needed).
- [ ] PATCH `/me` never accepts `role`, `email`, or `emailVerifiedAt`.
- [ ] `/me/cars/:id` always uses `findFirst({ where: { id, userId: sub } })` as the ownership check.
- [ ] `addCarPhoto` refuses any `objectKey` whose prefix doesn't match the caller's user id.
- [ ] Photos cascade-delete with car (verified by `delete.test.ts`).
- [ ] Uploads max size enforced by Zod at the request boundary (`MAX_UPLOAD_BYTES`).
- [ ] Mobile uses `pickAndUpload` for both avatar and car photos — no duplicated upload code.
- [ ] Copy lives entirely in `src/copy/profile.ts`.
- [ ] `pnpm typecheck && pnpm test` green across workspace.
