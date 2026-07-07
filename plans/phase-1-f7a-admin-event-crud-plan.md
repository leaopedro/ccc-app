# Phase 1 · F7a Admin — Event CRUD (first pass) Implementation Plan

> 2026-05-02 hotfix note (`JDMA-171`): stale-session redirect loop fix shipped on `main` via `f6f8a93` (`/login?reauth=1` loop-break + forced auth-cookie expiry on reauth path + middleware auth-state tightening).

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give organizers/admins a first-pass web console to log in, create/edit/publish/cancel events, upload a cover image, and manage ticket tiers. Attendees in the mobile app immediately see any event flipped to `published`. All mutations are role-gated (`organizer | admin`) and audit-logged.

**Architecture:** All backend writes live on a new `/admin/*` route tree on the existing Fastify API, protected by a new role-guard preHandler built on top of the existing `app.authenticate`. A new `AdminAudit` Prisma model records `(actorId, action, entity, entityId, metadata, createdAt)` on every mutation. The admin Next.js 16 app acts as a thin BFF: a server action logs in against `/auth/login`, stashes the access + refresh tokens in httpOnly cookies, and every server component/action reads the access token from the cookie, refreshes on 401, and calls the API. Event covers use the existing pre-signed PUT flow with a new `event_cover` upload kind gated by role.

**Tech Stack:** Fastify, Prisma, Zod, Next.js 16 App Router (server actions + RSC), Tailwind v4, `@jdm/shared` (Zod schemas).

**Roadmap tasks covered:** 7.1, 7.2, 7.3, 7.4.

---

## File structure

### Prisma / shared schemas

- **`packages/db/prisma/schema.prisma`** — add `AdminAudit` model (new); no other schema changes (Event + TicketTier already exist from F3).
- **`packages/db/prisma/migrations/<timestamp>_admin_audit/migration.sql`** — generated migration.
- **`packages/shared/src/admin.ts`** (new) — Zod schemas for admin inputs:
  - `adminEventCreateSchema`, `adminEventUpdateSchema`, `adminEventStatusActionSchema`
  - `adminTierCreateSchema`, `adminTierUpdateSchema`
  - `adminEventRowSchema` (list row incl. `status`, `publishedAt`), `adminEventDetailSchema` (extends `eventDetailSchema` with admin-only fields: `status`, `publishedAt`, `createdAt`, `updatedAt`, and tiers including `quantitySold`).
  - `adminAuditRowSchema` (output; not required but exports the row shape so the admin UI can later render audits).
- **`packages/shared/src/index.ts`** — re-export `./admin`.
- **`packages/shared/package.json`** — add `"./admin": "./src/admin.ts"` to `exports`.
- **`packages/shared/src/uploads.ts`** — extend `UPLOAD_KINDS` from `['avatar','car_photo']` to `['avatar','car_photo','event_cover']`; no other change.

### API

- **`apps/api/src/plugins/auth.ts`** — add `requireRole(...roles)` preHandler factory next to the existing `app.authenticate`. Wires 401 → unauth, 403 → wrong role.
- **`apps/api/src/services/uploads/types.ts`** — widen `PresignInput['kind']` and `isOwnedKey`'s `kind` to include `'event_cover'`.
- **`apps/api/src/services/uploads/dev.ts`** and **`apps/api/src/services/uploads/r2.ts`** — accept `event_cover` kind (same `${kind}/${userId}/${id}.${ext}` key shape, no new branching).
- **`apps/api/src/routes/uploads.ts`** — gate `kind === 'event_cover'` by organizer+ role (still scoped under the uploading user's id so `isOwnedKey` works).
- **`apps/api/src/routes/admin/`** (new dir):
  - **`index.ts`** — registers all admin sub-routes under `/admin` with `{ preHandler: [app.authenticate, app.requireRole('organizer','admin')] }` applied at the plugin level.
  - **`events.ts`** — `GET /admin/events`, `POST /admin/events`, `GET /admin/events/:id`, `PATCH /admin/events/:id`, `POST /admin/events/:id/publish`, `POST /admin/events/:id/cancel`.
  - **`tiers.ts`** — `GET /admin/events/:eventId/tiers`, `POST /admin/events/:eventId/tiers`, `PATCH /admin/events/:eventId/tiers/:tierId`, `DELETE /admin/events/:eventId/tiers/:tierId`.
- **`apps/api/src/services/admin-audit.ts`** (new) — `recordAudit(actorId, action, entityType, entityId, metadata?)` helper that inserts an `AdminAudit` row. Used by every admin mutation.
- **`apps/api/src/app.ts`** — register the new `adminRoutes` plugin (under `/admin` prefix).
- **`apps/api/test/helpers.ts`** — extend `resetDatabase` to `prisma.adminAudit.deleteMany()` before `ticketTier`. `bearer(env, userId, role)` already supports roles.

### API tests

- **`apps/api/test/admin/events/list.test.ts`** — returns all statuses, 401 unauthed, 403 for `user` role.
- **`apps/api/test/admin/events/create.test.ts`** — happy path, validation, 403 for `user`, audit row written.
- **`apps/api/test/admin/events/detail.test.ts`** — returns draft and cancelled events, 404 for unknown id.
- **`apps/api/test/admin/events/update.test.ts`** — partial update, slug uniqueness, audit row written.
- **`apps/api/test/admin/events/publish.test.ts`** — draft → published sets `publishedAt`; already-published no-op returns 409; event shows up on public `GET /events` immediately after.
- **`apps/api/test/admin/events/cancel.test.ts`** — published → cancelled; disappears from public `GET /events`.
- **`apps/api/test/admin/tiers/create.test.ts`** — create tier, ownership (wrong event id 404), audit row written.
- **`apps/api/test/admin/tiers/update.test.ts`** — happy, validation (priceCents >= 0).
- **`apps/api/test/admin/tiers/delete.test.ts`** — happy, 404 when tier belongs to a different event.
- **`apps/api/test/admin/uploads-event-cover.test.ts`** — `POST /uploads/presign { kind: 'event_cover' }` 403 for `user`, 200 for `organizer`/`admin`.
- **`apps/api/test/admin/audit.test.ts`** — (rolled up; or live inside other files) — asserts exactly one audit row per mutation with correct action string.

### Admin web

- **`apps/admin/package.json`** — add deps: `lucide-react` (icons; already a light dep if needed; otherwise inline SVGs). Keep minimal. No new deps if avoidable — prefer inline SVG.
- **`apps/admin/src/lib/api.ts`** — expand beyond `fetchHealth`:
  - `apiFetch<T>(path, init?)` — base fetch that sends `Authorization: Bearer <access>` read from the Next `cookies()` API; on 401, attempts refresh once, retries, else throws.
  - Strict `JSON.parse → schema.parse` — never return untyped data.
- **`apps/admin/src/lib/auth-session.ts`** (new) — cookie helpers: `readAccessToken()`, `readRefreshToken()`, `writeSession({ accessToken, refreshToken, user })`, `clearSession()`. Cookies are httpOnly, `sameSite=lax`, `secure` in prod, path=`/`.
- **`apps/admin/src/lib/auth-actions.ts`** (new) — server actions: `loginAction(formData)`, `logoutAction()`, `refreshAccessAction()`.
- **`apps/admin/middleware.ts`** (new) — route-level guard: redirects `/` (post-login landing), `/events/*` to `/login` when no session; redirects `/login` to `/events` when session already exists and role is organizer/admin. (Role is stored in a separate non-httpOnly `session_role` cookie so middleware can read it without decoding JWT.)
- **`apps/admin/app/login/page.tsx`** (new) — email+password form posting to `loginAction`.
- **`apps/admin/app/(authed)/layout.tsx`** (new) — server component that calls `readAccessToken()` and verifies role; renders nav + logout button.
- **`apps/admin/app/(authed)/events/page.tsx`** (new) — admin events list (server component; calls `/admin/events`).
- **`apps/admin/app/(authed)/events/new/page.tsx`** (new) — create event form (server action).
- **`apps/admin/app/(authed)/events/[id]/page.tsx`** (new) — edit form + tier editor + publish/cancel buttons.
- **`apps/admin/app/page.tsx`** — redirect to `/events` when authed, `/login` otherwise.
- **`apps/admin/src/components/cover-uploader.tsx`** (new) — a client component that calls `/uploads/presign` (via admin BFF action), PUTs the file, returns the object key to the parent form.
- **`apps/admin/src/lib/admin-api.ts`** (new) — typed wrappers for `/admin/events`, `/admin/events/:id/tiers`, returning parsed Zod types from `@jdm/shared/admin`.

### Other

- **`apps/admin/.env.example`** (new or updated) — document `NEXT_PUBLIC_API_BASE_URL`, `ADMIN_COOKIE_SECRET` (if we ever sign cookies — not needed in this pass since we only store bearer tokens).
- **`plans/roadmap.md`** — flip 7.1–7.4 `[ ]` → `[~]` on branch start, `[~]` → `[x]` on merge + deploy (per CLAUDE.md rules). Remove `[-]` from 0.13 (Vercel deploy) when admin actually deploys to Vercel as part of F7a delivery.
- **`handoff.md`** — rewrite on PR creation.

---

## Conventions (read before any task)

- **Admin routes live under `/admin/*`.** They are mounted as a single plugin with `{ preHandler: [app.authenticate, app.requireRole('organizer','admin')] }` applied at the plugin scope — every handler below inherits it. Never add admin routes without the guard.
- **Attendees read `GET /events` / `GET /events/:slug`.** Those still only return `status='published'`. Admins list everything via `GET /admin/events`. Don't add a "status" query param to the public list.
- **Slug is immutable after publish.** Admin create accepts a slug; update rejects slug changes when `status !== 'draft'`.
- **Status transitions:**
  - `draft → published` via `POST /admin/events/:id/publish` — sets `status='published'`, sets `publishedAt=now()` if null. Idempotent when called while already published (returns 200 with current state; no new audit row).
  - `draft|published → cancelled` via `POST /admin/events/:id/cancel` — sets `status='cancelled'`. `publishedAt` is preserved. Cancelled cannot be un-cancelled in this pass.
  - Other field edits use `PATCH /admin/events/:id`. Status is **not** editable via PATCH — only via the two action endpoints (keeps audit clean).
- **Audit rows are write-side-effect-only.** A mutation must both (a) perform the mutation, and (b) write an `AdminAudit` row within the same request. If the mutation fails, no audit row is written. Do not wrap them in a single DB transaction in this pass — audit is advisory, not financial. Tests assert the audit row exists _after_ a successful mutation.
- **Actions vocabulary** (stored as `AdminAudit.action`): `event.create`, `event.update`, `event.publish`, `event.cancel`, `tier.create`, `tier.update`, `tier.delete`. No free-form strings in code — use a literal union type in `@jdm/shared/admin`.
- **Tiers in admin detail include `quantitySold`** (that field is organizer-confidential). Public detail still omits it (already excluded in `@jdm/shared/events`' `ticketTierSchema`).
- **Uploads:** `event_cover` presign requires `role in ('organizer','admin')`. Object keys still live under `event_cover/${userId}/` so the existing `isOwnedKey` helper works unchanged — only the uploader can later link their own key to an Event.
- **Admin auth = cookies.** Server-side BFF: access token cookie is httpOnly, refresh token cookie is httpOnly, `session_role` is readable (non-sensitive, used only by middleware). Never expose the refresh token to the browser. Access token is also httpOnly — the admin UI never needs it directly; all API calls go through `apiFetch` which runs on the server.
- **Tests:** every API test starts with `await resetDatabase(); app = await makeApp();` per `apps/api/test/helpers.ts`. Integration tests hit the real Postgres — no mocks (CLAUDE.md).
- **Commits:** one commit per task. Conventional prefixes: `feat:`, `fix:`, `test:`, `chore:`, `docs:`.
- **Branch:** `feat/f7a-admin-event-crud` off `main`.

---

## ✅ Task 1: Branch + plan file

**Files:**

- Modify: `plans/roadmap.md` (flip 7.1–7.4 `[ ]` → `[~]`)
- Create: `plans/phase-1-f7a-admin-event-crud-plan.md` (this file — already exists at branch-start time)

- [ ] **Step 1:** Create branch from clean `main`.

```bash
git checkout main
git pull --ff-only
git switch -c feat/f7a-admin-event-crud
```

- [ ] **Step 2:** Flip the four roadmap checkboxes to `[~]` with a short note.

Edit `plans/roadmap.md` — change the four `7.1`/`7.2`/`7.3`/`7.4` checkbox lines from `- [ ]` to `- [~]` and append ` _(on feat/f7a-admin-event-crud)_` to the scope line of each.

- [ ] **Step 3:** Commit.

```bash
git add plans/phase-1-f7a-admin-event-crud-plan.md plans/roadmap.md
git commit -m "docs(plan): F7a admin event CRUD plan + roadmap tick"
```

---

## Task 2: Prisma — `AdminAudit` model + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_admin_audit/migration.sql` (via Prisma)

- [ ] **Step 1:** Append to `schema.prisma` (at the very bottom of the file):

```prisma
model AdminAudit {
  id         String   @id @default(cuid())
  actorId    String
  action     String   @db.VarChar(40)
  entityType String   @db.VarChar(40)
  entityId   String   @db.VarChar(40)
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([actorId, createdAt])
  @@index([entityType, entityId])
  @@index([createdAt])
}
```

Note: `actorId` is **not** a foreign key. If a user is later deleted we still want the audit row to survive (compliance). No `onDelete`.

- [ ] **Step 2:** Generate the migration against a local Postgres.

```bash
pnpm --filter @jdm/db exec prisma migrate dev --name admin_audit
```

Expected: new folder `packages/db/prisma/migrations/<timestamp>_admin_audit/` with a `migration.sql` that creates the table and three indexes. `prisma generate` reruns.

- [ ] **Step 3:** Extend `apps/api/test/helpers.ts` `resetDatabase`:

```ts
export const resetDatabase = async (): Promise<void> => {
  await prisma.adminAudit.deleteMany();
  await prisma.ticketTier.deleteMany();
  await prisma.event.deleteMany();
  // … rest unchanged
};
```

- [ ] **Step 4:** Run API tests to confirm nothing broke.

```bash
pnpm --filter api test
```

Expected: all existing tests green (ticket-tier + event deletes no longer the first line, but behavior is the same).

- [ ] **Step 5:** Commit.

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/api/test/helpers.ts
git commit -m "feat(db): add AdminAudit model and migration"
```

---

## Task 3: Shared admin schemas (`@jdm/shared/admin`)

**Files:**

- Create: `packages/shared/src/admin.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './admin';`)
- Modify: `packages/shared/package.json` (add `"./admin": "./src/admin.ts"`)
- Test: `packages/shared/src/__tests__/admin.test.ts` (new)

- [ ] **Step 1:** Write the failing test at `packages/shared/src/__tests__/admin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  adminAuditActionSchema,
  adminEventCreateSchema,
  adminEventUpdateSchema,
  adminTierCreateSchema,
  adminTierUpdateSchema,
} from '../admin.js';

describe('adminEventCreateSchema', () => {
  const base = {
    slug: 'encontro-sp-maio',
    title: 'Encontro SP',
    description: 'Descrição longa.',
    startsAt: '2026-05-10T14:00:00.000Z',
    endsAt: '2026-05-10T20:00:00.000Z',
    venueName: 'Autódromo',
    venueAddress: 'Rua X, 100',
    lat: -23.55,
    lng: -46.63,
    city: 'São Paulo',
    stateCode: 'SP',
    type: 'meeting',
    capacity: 200,
    coverObjectKey: null,
  };

  it('accepts a valid payload', () => {
    expect(() => adminEventCreateSchema.parse(base)).not.toThrow();
  });

  it('rejects endsAt before startsAt', () => {
    expect(() =>
      adminEventCreateSchema.parse({ ...base, endsAt: '2026-05-10T13:00:00.000Z' }),
    ).toThrow();
  });

  it('rejects slug with spaces', () => {
    expect(() => adminEventCreateSchema.parse({ ...base, slug: 'not a slug' })).toThrow();
  });

  it('rejects capacity < 0', () => {
    expect(() => adminEventCreateSchema.parse({ ...base, capacity: -1 })).toThrow();
  });
});

describe('adminEventUpdateSchema', () => {
  it('accepts a single-field patch', () => {
    expect(() => adminEventUpdateSchema.parse({ title: 'New title' })).not.toThrow();
  });

  it('accepts empty object (no-op)', () => {
    expect(() => adminEventUpdateSchema.parse({})).not.toThrow();
  });

  it('rejects status — must go through publish/cancel actions', () => {
    expect(() => adminEventUpdateSchema.parse({ status: 'published' })).toThrow();
  });
});

describe('adminTierCreateSchema', () => {
  const base = { name: 'Geral', priceCents: 5000, quantityTotal: 100 };

  it('accepts base', () => {
    expect(() => adminTierCreateSchema.parse(base)).not.toThrow();
  });

  it('accepts optional sales window', () => {
    expect(() =>
      adminTierCreateSchema.parse({
        ...base,
        salesOpenAt: '2026-05-01T00:00:00.000Z',
        salesCloseAt: '2026-05-10T14:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects priceCents < 0', () => {
    expect(() => adminTierCreateSchema.parse({ ...base, priceCents: -1 })).toThrow();
  });

  it('rejects salesCloseAt before salesOpenAt', () => {
    expect(() =>
      adminTierCreateSchema.parse({
        ...base,
        salesOpenAt: '2026-05-10T00:00:00.000Z',
        salesCloseAt: '2026-05-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('adminTierUpdateSchema', () => {
  it('accepts partial patch', () => {
    expect(() => adminTierUpdateSchema.parse({ priceCents: 7500 })).not.toThrow();
  });
});

describe('adminAuditActionSchema', () => {
  it.each([
    'event.create',
    'event.update',
    'event.publish',
    'event.cancel',
    'tier.create',
    'tier.update',
    'tier.delete',
  ])('accepts %s', (action) => {
    expect(adminAuditActionSchema.parse(action)).toBe(action);
  });

  it('rejects unknown action', () => {
    expect(() => adminAuditActionSchema.parse('event.explode')).toThrow();
  });
});
```

- [ ] **Step 2:** Run the tests to confirm they fail (module not found).

```bash
pnpm --filter @jdm/shared test
```

Expected: FAIL — `Cannot find module '../admin.js'` (or equivalent).

- [ ] **Step 3:** Create `packages/shared/src/admin.ts`:

```ts
import { z } from 'zod';

import {
  eventDetailSchema,
  eventTypeSchema,
  eventStatusSchema,
  ticketTierSchema,
} from './events.js';
import { stateCodeSchema } from './profile.js';

// Actions recorded in AdminAudit.action — literal union, no free-form strings.
export const adminAuditActionSchema = z.enum([
  'event.create',
  'event.update',
  'event.publish',
  'event.cancel',
  'tier.create',
  'tier.update',
  'tier.delete',
]);
export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>;

const slugSchema = z
  .string()
  .min(3)
  .max(140)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case');

const coverObjectKeySchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^event_cover\//, 'must be an event_cover key')
  .nullable();

export const adminEventCreateSchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(140),
    description: z.string().trim().min(1).max(10_000),
    coverObjectKey: coverObjectKeySchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    venueName: z.string().trim().min(1).max(140),
    venueAddress: z.string().trim().min(1).max(300),
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    city: z.string().trim().min(1).max(100),
    stateCode: stateCodeSchema,
    type: eventTypeSchema,
    capacity: z.number().int().nonnegative(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type AdminEventCreate = z.infer<typeof adminEventCreateSchema>;

// Slug is omitted here; admins must use a separate endpoint path if we ever
// allow slug edits. Status is explicitly not editable — use publish/cancel.
export const adminEventUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(140),
    description: z.string().trim().min(1).max(10_000),
    coverObjectKey: coverObjectKeySchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    venueName: z.string().trim().min(1).max(140),
    venueAddress: z.string().trim().min(1).max(300),
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    city: z.string().trim().min(1).max(100),
    stateCode: stateCodeSchema,
    type: eventTypeSchema,
    capacity: z.number().int().nonnegative(),
  })
  .partial()
  .strict();
export type AdminEventUpdate = z.infer<typeof adminEventUpdateSchema>;

// Admin tier view — includes the organizer-confidential quantitySold.
export const adminTicketTierSchema = ticketTierSchema.extend({
  quantitySold: z.number().int().nonnegative(),
});
export type AdminTicketTier = z.infer<typeof adminTicketTierSchema>;

// Admin event detail — public detail + admin-only fields, with adminTicketTierSchema tiers.
export const adminEventDetailSchema = eventDetailSchema.omit({ tiers: true }).extend({
  status: eventStatusSchema,
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  tiers: z.array(adminTicketTierSchema),
});
export type AdminEventDetail = z.infer<typeof adminEventDetailSchema>;

// List row — lean, suitable for a table.
export const adminEventRowSchema = z.object({
  id: z.string().min(1),
  slug: z.string(),
  title: z.string(),
  status: eventStatusSchema,
  type: eventTypeSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  city: z.string(),
  stateCode: stateCodeSchema,
  capacity: z.number().int().nonnegative(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AdminEventRow = z.infer<typeof adminEventRowSchema>;

export const adminEventListResponseSchema = z.object({
  items: z.array(adminEventRowSchema),
});
export type AdminEventListResponse = z.infer<typeof adminEventListResponseSchema>;

export const adminTierCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    priceCents: z.number().int().nonnegative(),
    currency: z.string().length(3).default('BRL'),
    quantityTotal: z.number().int().nonnegative(),
    salesOpenAt: z.string().datetime().nullable().optional(),
    salesCloseAt: z.string().datetime().nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine(
    (v) => !v.salesOpenAt || !v.salesCloseAt || new Date(v.salesCloseAt) > new Date(v.salesOpenAt),
    { message: 'salesCloseAt must be after salesOpenAt', path: ['salesCloseAt'] },
  );
export type AdminTierCreate = z.infer<typeof adminTierCreateSchema>;

export const adminTierUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    priceCents: z.number().int().nonnegative(),
    quantityTotal: z.number().int().nonnegative(),
    salesOpenAt: z.string().datetime().nullable(),
    salesCloseAt: z.string().datetime().nullable(),
    sortOrder: z.number().int(),
  })
  .partial()
  .strict();
export type AdminTierUpdate = z.infer<typeof adminTierUpdateSchema>;
```

- [ ] **Step 4:** Update `packages/shared/src/index.ts`:

```ts
export * from './ids';
export * from './health';
export * from './profile';
export * from './cars';
export * from './uploads';
export * from './events';
export * from './admin';
```

- [ ] **Step 5:** Update `packages/shared/package.json` — add the subpath export:

```json
"./admin": "./src/admin.ts",
```

(Keep the existing entries; alphabetize if the surrounding entries are alphabetized.)

- [ ] **Step 6:** Run tests to confirm green.

```bash
pnpm --filter @jdm/shared test
```

Expected: all new admin tests pass.

- [ ] **Step 7:** Typecheck workspace.

```bash
pnpm --filter @jdm/shared typecheck
pnpm --filter api typecheck
pnpm --filter admin typecheck
```

Expected: green across all three.

- [ ] **Step 8:** Commit.

```bash
git add packages/shared
git commit -m "feat(shared): admin event + tier + audit schemas"
```

---

## Task 4: Upload kind `event_cover` + role-gated presign

**Files:**

- Modify: `packages/shared/src/uploads.ts`
- Modify: `apps/api/src/services/uploads/types.ts`
- Modify: `apps/api/src/routes/uploads.ts`
- Test: `apps/api/test/admin/uploads-event-cover.test.ts` (new)

- [ ] **Step 1:** Write the failing test at `apps/api/test/admin/uploads-event-cover.test.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /uploads/presign { kind: event_cover }', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const body = { kind: 'event_cover', contentType: 'image/jpeg', size: 50_000 };

  it('401 without token', async () => {
    const res = await app.inject({ method: 'POST', url: '/uploads/presign', payload: body });
    expect(res.statusCode).toBe(401);
  });

  it('403 for plain user', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('200 for organizer', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { objectKey: string };
    expect(json.objectKey.startsWith(`event_cover/${user.id}/`)).toBe(true);
  });

  it('200 for admin', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true, role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  });

  it('still allows avatar for plain user', async () => {
    const { user } = await createUser({ email: 'u2@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: { kind: 'avatar', contentType: 'image/jpeg', size: 50_000 },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2:** Run it to watch it fail.

```bash
pnpm --filter api test -- admin/uploads-event-cover
```

Expected: FAIL — schema rejects `kind: 'event_cover'` (Zod 400 on all variants) OR the test file fails because helpers don't exist (they do — `bearer` already supports roles).

- [ ] **Step 3:** Widen the shared upload kind enum in `packages/shared/src/uploads.ts`:

```ts
export const UPLOAD_KINDS = ['avatar', 'car_photo', 'event_cover'] as const;
```

- [ ] **Step 4:** Widen `apps/api/src/services/uploads/types.ts`:

```ts
export type PresignInput = {
  kind: 'avatar' | 'car_photo' | 'event_cover';
  userId: string;
  contentType: string;
  size: number;
};

// …

export interface Uploads {
  presignPut(input: PresignInput): Promise<PresignResult>;
  buildPublicUrl(objectKey: string): string;
  isOwnedKey(
    objectKey: string,
    userId: string,
    kind: 'avatar' | 'car_photo' | 'event_cover',
  ): boolean;
}
```

Update `apps/api/src/services/uploads/dev.ts` `isOwnedKey` param type the same way (the implementation already uses `${kind}/` prefix match, no code change needed). Do the same for `r2.ts` if it declares the signature separately.

- [ ] **Step 5:** Gate `event_cover` in `apps/api/src/routes/uploads.ts`:

```ts
import { presignRequestSchema } from '@jdm/shared/uploads';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.post('/uploads/presign', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub, role } = requireUser(request);
    const { kind, contentType, size } = presignRequestSchema.parse(request.body);
    if (kind === 'event_cover' && role !== 'organizer' && role !== 'admin') {
      return reply
        .status(403)
        .send({ error: 'Forbidden', message: 'role cannot upload event covers' });
    }
    const result = await app.uploads.presignPut({ kind, userId: sub, contentType, size });
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

- [ ] **Step 6:** Re-run the test to confirm green.

```bash
pnpm --filter api test -- admin/uploads-event-cover
```

Expected: PASS (5/5).

- [ ] **Step 7:** Run the full api test suite — nothing else regressed.

```bash
pnpm --filter api test
```

Expected: green (previously-passing tests still green; 5 new tests added).

- [ ] **Step 8:** Commit.

```bash
git add packages/shared/src/uploads.ts apps/api/src/services/uploads apps/api/src/routes/uploads.ts apps/api/test/admin/uploads-event-cover.test.ts
git commit -m "feat(api): allow event_cover upload kind for organizer+ role"
```

---

## Task 5: `requireRole` preHandler

**Files:**

- Modify: `apps/api/src/plugins/auth.ts`
- Test: `apps/api/test/admin/require-role.test.ts` (new — a tiny unit that mounts a throwaway route to probe the guard)

- [ ] **Step 1:** Write the failing test at `apps/api/test/admin/require-role.test.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('requireRole preHandler', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    app.get(
      '/__role-probe',
      { preHandler: [app.authenticate, app.requireRole('organizer', 'admin')] },
      () => ({ ok: true }),
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/__role-probe' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/__role-probe',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'Forbidden' });
  });

  it('200 for organizer', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/__role-probe',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
  });

  it('200 for admin', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true, role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/__role-probe',
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2:** Run it to watch it fail (undefined `app.requireRole`).

```bash
pnpm --filter api test -- admin/require-role
```

Expected: FAIL — `app.requireRole is not a function`.

- [ ] **Step 3:** Extend `apps/api/src/plugins/auth.ts`. The full replacement file:

```ts
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';

import type { UserRoleName } from '@jdm/shared/auth';
import { verifyAccessToken, type AccessPayload } from '../services/auth/tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: UserRoleName[]) => preHandlerHookHandler;
  }
  interface FastifyRequest {
    user?: AccessPayload;
  }
}

export const requireUser = (request: FastifyRequest): AccessPayload => {
  if (!request.user) {
    throw new Error('requireUser called without authenticate preHandler');
  }
  return request.user;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const authPlugin = fp(async (app) => {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'missing bearer token' });
    }
    const token = header.slice('Bearer '.length);
    try {
      request.user = verifyAccessToken(token, app.env);
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid token' });
    }
    return undefined;
  });

  app.decorate('requireRole', (...roles: UserRoleName[]): preHandlerHookHandler => {
    const allowed = new Set(roles);
    return async (request, reply) => {
      const user = requireUser(request);
      if (!allowed.has(user.role)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'insufficient role' });
      }
      return undefined;
    };
  });
});
```

- [ ] **Step 4:** Re-run the test.

```bash
pnpm --filter api test -- admin/require-role
```

Expected: PASS (4/4).

- [ ] **Step 5:** Full api suite.

```bash
pnpm --filter api test
```

Expected: green across the board.

- [ ] **Step 6:** Commit.

```bash
git add apps/api/src/plugins/auth.ts apps/api/test/admin/require-role.test.ts
git commit -m "feat(api): add requireRole preHandler"
```

---

## Task 6: Admin audit service

**Files:**

- Create: `apps/api/src/services/admin-audit.ts`
- Test: `apps/api/test/services/admin-audit.test.ts` (new)

- [ ] **Step 1:** Write the failing test:

```ts
import { prisma } from '@jdm/db';
import { describe, expect, it, beforeEach } from 'vitest';

import { recordAudit } from '../../src/services/admin-audit.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('recordAudit', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('inserts a row with the given shape', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', role: 'admin', verified: true });
    await recordAudit({
      actorId: user.id,
      action: 'event.create',
      entityType: 'event',
      entityId: 'evt_123',
      metadata: { slug: 'x' },
    });
    const rows = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: user.id,
      action: 'event.create',
      entityType: 'event',
      entityId: 'evt_123',
      metadata: { slug: 'x' },
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('metadata is optional', async () => {
    const { user } = await createUser({ email: 'b@jdm.test', role: 'admin', verified: true });
    await recordAudit({
      actorId: user.id,
      action: 'tier.delete',
      entityType: 'tier',
      entityId: 'tier_1',
    });
    const [row] = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(row?.metadata).toBeNull();
  });
});
```

- [ ] **Step 2:** Run — expect fail (no module).

```bash
pnpm --filter api test -- services/admin-audit
```

Expected: FAIL.

- [ ] **Step 3:** Create `apps/api/src/services/admin-audit.ts`:

```ts
import { prisma } from '@jdm/db';

import type { AdminAuditAction } from '@jdm/shared/admin';

export type RecordAuditInput = {
  actorId: string;
  action: AdminAuditAction;
  entityType: 'event' | 'tier';
  entityId: string;
  metadata?: Record<string, unknown>;
};

export const recordAudit = async (input: RecordAuditInput): Promise<void> => {
  await prisma.adminAudit.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? null,
    },
  });
};
```

- [ ] **Step 4:** Re-run tests — expect pass.

```bash
pnpm --filter api test -- services/admin-audit
```

Expected: PASS (2/2).

- [ ] **Step 5:** Commit.

```bash
git add apps/api/src/services/admin-audit.ts apps/api/test/services/admin-audit.test.ts
git commit -m "feat(api): AdminAudit record helper"
```

---

## Task 7: Admin routes — scaffold + `POST /admin/events`

**Files:**

- Create: `apps/api/src/routes/admin/index.ts`
- Create: `apps/api/src/routes/admin/events.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/admin/events/create.test.ts` (new)

- [ ] **Step 1:** Write the failing test at `apps/api/test/admin/events/create.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const validBody = {
  slug: 'encontro-sp-maio',
  title: 'Encontro SP',
  description: 'Domingo no autódromo.',
  coverObjectKey: null,
  startsAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
  endsAt: new Date(Date.now() + 7 * 86400_000 + 6 * 3600_000).toISOString(),
  venueName: 'Autódromo',
  venueAddress: 'Rua X, 100',
  lat: -23.55,
  lng: -46.63,
  city: 'São Paulo',
  stateCode: 'SP',
  type: 'meeting',
  capacity: 200,
};

describe('POST /admin/events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/events', payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: validBody,
    });
    expect(res.statusCode).toBe(403);
  });

  it('201 creates a draft event and writes audit row', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; slug: string; status: string; publishedAt: unknown };
    expect(body.slug).toBe(validBody.slug);
    expect(body.status).toBe('draft');
    expect(body.publishedAt).toBeNull();

    const row = await prisma.event.findUniqueOrThrow({ where: { slug: validBody.slug } });
    expect(row.status).toBe('draft');
    expect(row.publishedAt).toBeNull();

    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'event.create',
      entityType: 'event',
      entityId: row.id,
    });
  });

  it('400 on duplicate slug', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const auth = { authorization: bearer(loadEnv(), user.id, 'organizer') };
    await app.inject({ method: 'POST', url: '/admin/events', headers: auth, payload: validBody });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: auth,
      payload: validBody,
    });
    expect(res.statusCode).toBe(409);
  });

  it('400 on endsAt before startsAt', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { ...validBody, endsAt: validBody.startsAt },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2:** Run — expect fail (route 404).

```bash
pnpm --filter api test -- admin/events/create
```

Expected: FAIL (routes not yet mounted, so Fastify's notFoundHandler returns 404; tests assert 401/403/201/409).

- [ ] **Step 3:** Create `apps/api/src/routes/admin/events.ts`:

```ts
import { prisma } from '@jdm/db';
import { adminEventCreateSchema, adminEventDetailSchema } from '@jdm/shared/admin';
import type { Event as DbEvent, TicketTier as DbTier, Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import type { Uploads } from '../../services/uploads/index.js';

const serializeDetail = (e: DbEvent & { tiers: DbTier[] }, uploads: Uploads) =>
  adminEventDetailSchema.parse({
    id: e.id,
    slug: e.slug,
    title: e.title,
    coverUrl: e.coverObjectKey ? uploads.buildPublicUrl(e.coverObjectKey) : null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    lat: e.lat,
    lng: e.lng,
    city: e.city,
    stateCode: e.stateCode,
    type: e.type,
    description: e.description,
    capacity: e.capacity,
    status: e.status,
    publishedAt: e.publishedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    tiers: e.tiers
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        id: t.id,
        name: t.name,
        priceCents: t.priceCents,
        currency: t.currency,
        quantityTotal: t.quantityTotal,
        quantitySold: t.quantitySold,
        remainingCapacity: Math.max(0, t.quantityTotal - t.quantitySold),
        salesOpenAt: t.salesOpenAt?.toISOString() ?? null,
        salesCloseAt: t.salesCloseAt?.toISOString() ?? null,
        sortOrder: t.sortOrder,
      })),
  });

// eslint-disable-next-line @typescript-eslint/require-await
export const adminEventRoutes: FastifyPluginAsync = async (app) => {
  app.post('/events', async (request, reply) => {
    const { sub } = requireUser(request);
    const input = adminEventCreateSchema.parse(request.body);
    try {
      const event = await prisma.event.create({
        data: {
          slug: input.slug,
          title: input.title,
          description: input.description,
          coverObjectKey: input.coverObjectKey,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          venueName: input.venueName,
          venueAddress: input.venueAddress,
          lat: input.lat,
          lng: input.lng,
          city: input.city,
          stateCode: input.stateCode,
          type: input.type,
          capacity: input.capacity,
          status: 'draft',
        },
        include: { tiers: true },
      });
      await recordAudit({
        actorId: sub,
        action: 'event.create',
        entityType: 'event',
        entityId: event.id,
        metadata: { slug: event.slug },
      });
      return reply.status(201).send(serializeDetail(event, app.uploads));
    } catch (e) {
      const err = e as Prisma.PrismaClientKnownRequestError;
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'Conflict', message: 'slug already exists' });
      }
      throw e;
    }
  });
};
```

- [ ] **Step 4:** Create `apps/api/src/routes/admin/index.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';

import { adminEventRoutes } from './events.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireRole('organizer', 'admin'));

  await app.register(adminEventRoutes, { prefix: '/events' });
};
```

- [ ] **Step 5:** Register in `apps/api/src/app.ts`. Add the import and the registration after `eventRoutes`:

```ts
import { adminRoutes } from './routes/admin/index.js';
// …
await app.register(eventRoutes);
await app.register(adminRoutes, { prefix: '/admin' });
await app.register(authRoutes, { prefix: '/auth' });
```

- [ ] **Step 6:** Re-run tests.

```bash
pnpm --filter api test -- admin/events/create
```

Expected: PASS (5/5).

- [ ] **Step 7:** Full suite.

```bash
pnpm --filter api test
```

Expected: green.

- [ ] **Step 8:** Commit.

```bash
git add apps/api/src/routes/admin apps/api/src/app.ts apps/api/test/admin/events/create.test.ts
git commit -m "feat(api): POST /admin/events with role guard + audit"
```

---

## Task 8: `GET /admin/events` (list, all statuses)

**Files:**

- Modify: `apps/api/src/routes/admin/events.ts`
- Test: `apps/api/test/admin/events/list.test.ts` (new)

- [ ] **Step 1:** Write the failing test at `apps/api/test/admin/events/list.test.ts`:

```ts
import { prisma } from '@jdm/db';
import { adminEventListResponseSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = (slug: string, status: 'draft' | 'published' | 'cancelled') =>
  prisma.event.create({
    data: {
      slug,
      title: slug,
      description: 'd',
      startsAt: new Date(Date.now() + 7 * 86400_000),
      endsAt: new Date(Date.now() + 7 * 86400_000 + 3600_000),
      venueName: 'v',
      venueAddress: 'a',
      lat: 0,
      lng: 0,
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      capacity: 10,
      status,
      publishedAt: status === 'published' ? new Date() : null,
    },
  });

describe('GET /admin/events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/events' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns all statuses (incl. draft + cancelled), newest first', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    await mkEvent('a', 'draft');
    await mkEvent('b', 'published');
    await mkEvent('c', 'cancelled');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminEventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug).sort()).toEqual(['a', 'b', 'c']);
    // newest first: c, b, a (createdAt desc)
    expect(body.items[0]?.slug).toBe('c');
  });
});
```

- [ ] **Step 2:** Run — expect fail.

```bash
pnpm --filter api test -- admin/events/list
```

Expected: FAIL (route 404; Fastify NotFound handler).

- [ ] **Step 3:** Add the list handler to `apps/api/src/routes/admin/events.ts` (append before the closing of the plugin function):

```ts
app.get('/events', async () => {
  const events = await prisma.event.findMany({ orderBy: { createdAt: 'desc' } });
  return {
    items: events.map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      status: e.status,
      type: e.type,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      city: e.city,
      stateCode: e.stateCode,
      capacity: e.capacity,
      publishedAt: e.publishedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
});
```

Note: the admin list is unpaginated in this pass. Add pagination in a follow-up if volumes grow.

- [ ] **Step 4:** Run tests.

```bash
pnpm --filter api test -- admin/events/list
```

Expected: PASS (3/3).

- [ ] **Step 5:** Commit.

```bash
git add apps/api/src/routes/admin/events.ts apps/api/test/admin/events/list.test.ts
git commit -m "feat(api): GET /admin/events — list all statuses"
```

---

## Task 9: `GET /admin/events/:id` (detail)

**Files:**

- Modify: `apps/api/src/routes/admin/events.ts`
- Test: `apps/api/test/admin/events/detail.test.ts` (new)

- [ ] **Step 1:** Write the failing test:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('GET /admin/events/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('404 for unknown id', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events/does-not-exist',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns a draft event (which is invisible on public)', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const event = await prisma.event.create({
      data: {
        slug: 'draft-x',
        title: 'Draft',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        lat: 0,
        lng: 0,
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'draft',
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; publishedAt: unknown; tiers: unknown[] };
    expect(body.status).toBe('draft');
    expect(body.publishedAt).toBeNull();
    expect(body.tiers).toEqual([]);
  });

  it('exposes quantitySold in admin tier', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const event = await prisma.event.create({
      data: {
        slug: 'with-tiers',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        lat: 0,
        lng: 0,
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'published',
        publishedAt: new Date(),
        tiers: {
          create: [
            { name: 'Geral', priceCents: 5000, quantityTotal: 100, quantitySold: 12, sortOrder: 0 },
          ],
        },
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    const body = res.json() as { tiers: { quantitySold: number; remainingCapacity: number }[] };
    expect(body.tiers[0]?.quantitySold).toBe(12);
    expect(body.tiers[0]?.remainingCapacity).toBe(88);
  });
});
```

- [ ] **Step 2:** Run — expect fail.

```bash
pnpm --filter api test -- admin/events/detail
```

Expected: FAIL (route 404).

- [ ] **Step 3:** Add the detail handler to `apps/api/src/routes/admin/events.ts`:

```ts
app.get('/events/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const event = await prisma.event.findUnique({ where: { id }, include: { tiers: true } });
  if (!event) return reply.status(404).send({ error: 'NotFound' });
  return serializeDetail(event, app.uploads);
});
```

- [ ] **Step 4:** Run tests.

```bash
pnpm --filter api test -- admin/events/detail
```

Expected: PASS (3/3).

- [ ] **Step 5:** Commit.

```bash
git add apps/api/src/routes/admin/events.ts apps/api/test/admin/events/detail.test.ts
git commit -m "feat(api): GET /admin/events/:id — admin detail incl. quantitySold"
```

---

## Task 10: `PATCH /admin/events/:id` (partial update)

**Files:**

- Modify: `apps/api/src/routes/admin/events.ts`
- Test: `apps/api/test/admin/events/update.test.ts` (new)

- [ ] **Step 1:** Write the failing test:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = () =>
  prisma.event.create({
    data: {
      slug: 'old',
      title: 'Old',
      description: 'd',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      lat: 0,
      lng: 0,
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      capacity: 10,
      status: 'draft',
    },
  });

describe('PATCH /admin/events/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('403 for user role', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: { title: 'New' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('applies a partial update and writes audit row', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { title: 'New' },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.title).toBe('New');
    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'event.update',
      entityType: 'event',
      entityId: event.id,
    });
  });

  it('rejects passing status via PATCH (use publish/cancel actions)', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { status: 'published' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 unknown id', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/events/missing',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { title: 'New' },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2:** Run — expect fail.

```bash
pnpm --filter api test -- admin/events/update
```

Expected: FAIL.

- [ ] **Step 3:** Add the handler:

```ts
import {
  adminEventCreateSchema,
  adminEventDetailSchema,
  adminEventUpdateSchema,
} from '@jdm/shared/admin';
// … existing imports above

app.patch('/events/:id', async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const input = adminEventUpdateSchema.parse(request.body);

  const existing = await prisma.event.findUnique({ where: { id } });
  if (!existing) return reply.status(404).send({ error: 'NotFound' });

  const data: Prisma.EventUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.coverObjectKey !== undefined) data.coverObjectKey = input.coverObjectKey;
  if (input.startsAt !== undefined) data.startsAt = new Date(input.startsAt);
  if (input.endsAt !== undefined) data.endsAt = new Date(input.endsAt);
  if (input.venueName !== undefined) data.venueName = input.venueName;
  if (input.venueAddress !== undefined) data.venueAddress = input.venueAddress;
  if (input.lat !== undefined) data.lat = input.lat;
  if (input.lng !== undefined) data.lng = input.lng;
  if (input.city !== undefined) data.city = input.city;
  if (input.stateCode !== undefined) data.stateCode = input.stateCode;
  if (input.type !== undefined) data.type = input.type;
  if (input.capacity !== undefined) data.capacity = input.capacity;

  const updated = await prisma.event.update({
    where: { id },
    data,
    include: { tiers: true },
  });
  await recordAudit({
    actorId: sub,
    action: 'event.update',
    entityType: 'event',
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return serializeDetail(updated, app.uploads);
});
```

(`adminEventUpdateSchema` uses `.strict()` so passing `status` already yields a ZodError → 400 via `errorHandlerPlugin`.)

- [ ] **Step 4:** Run tests.

```bash
pnpm --filter api test -- admin/events/update
```

Expected: PASS (4/4).

- [ ] **Step 5:** Commit.

```bash
git add apps/api/src/routes/admin/events.ts apps/api/test/admin/events/update.test.ts
git commit -m "feat(api): PATCH /admin/events/:id"
```

---

## Task 11: Publish + cancel actions

**Files:**

- Modify: `apps/api/src/routes/admin/events.ts`
- Test: `apps/api/test/admin/events/publish.test.ts` (new)
- Test: `apps/api/test/admin/events/cancel.test.ts` (new)

- [ ] **Step 1:** Write `apps/api/test/admin/events/publish.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = (status: 'draft' | 'published' = 'draft') =>
  prisma.event.create({
    data: {
      slug: 'ev-publish-test',
      title: 't',
      description: 'd',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      lat: 0,
      lng: 0,
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      capacity: 10,
      status,
      publishedAt: status === 'published' ? new Date() : null,
    },
  });

describe('POST /admin/events/:id/publish', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('flips draft → published, sets publishedAt, writes audit', async () => {
    const event = await mkEvent('draft');
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/publish`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.status).toBe('published');
    expect(row.publishedAt).not.toBeNull();
    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits.map((a) => a.action)).toContain('event.publish');
  });

  it('published event immediately shows up on public GET /events', async () => {
    const event = await mkEvent('draft');
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/publish`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    const publicRes = await app.inject({ method: 'GET', url: '/events' });
    const body = publicRes.json() as { items: { slug: string }[] };
    expect(body.items.map((i) => i.slug)).toContain(event.slug);
  });

  it('409 when already published', async () => {
    const event = await mkEvent('published');
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/publish`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
  });

  it('404 unknown id', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events/missing/publish',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2:** Write `apps/api/test/admin/events/cancel.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = (status: 'draft' | 'published' = 'published') =>
  prisma.event.create({
    data: {
      slug: 'ev-cancel-test',
      title: 't',
      description: 'd',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      lat: 0,
      lng: 0,
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      capacity: 10,
      status,
      publishedAt: status === 'published' ? new Date() : null,
    },
  });

describe('POST /admin/events/:id/cancel', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('flips published → cancelled and hides from public list', async () => {
    const event = await mkEvent('published');
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/cancel`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.status).toBe('cancelled');
    const publicRes = await app.inject({ method: 'GET', url: '/events' });
    const body = publicRes.json() as { items: { slug: string }[] };
    expect(body.items.map((i) => i.slug)).not.toContain(event.slug);
  });

  it('409 when already cancelled', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'already-cancelled',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        lat: 0,
        lng: 0,
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'cancelled',
      },
    });
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/cancel`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 3:** Run — expect fails.

```bash
pnpm --filter api test -- admin/events/publish admin/events/cancel
```

Expected: FAIL.

- [ ] **Step 4:** Add handlers to `apps/api/src/routes/admin/events.ts`:

```ts
app.post('/events/:id/publish', async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const existing = await prisma.event.findUnique({ where: { id } });
  if (!existing) return reply.status(404).send({ error: 'NotFound' });
  if (existing.status === 'published') {
    return reply.status(409).send({ error: 'Conflict', message: 'already published' });
  }
  if (existing.status === 'cancelled') {
    return reply
      .status(409)
      .send({ error: 'Conflict', message: 'cancelled events cannot be re-published' });
  }
  const updated = await prisma.event.update({
    where: { id },
    data: {
      status: 'published',
      publishedAt: existing.publishedAt ?? new Date(),
    },
    include: { tiers: true },
  });
  await recordAudit({
    actorId: sub,
    action: 'event.publish',
    entityType: 'event',
    entityId: id,
  });
  return serializeDetail(updated, app.uploads);
});

app.post('/events/:id/cancel', async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const existing = await prisma.event.findUnique({ where: { id } });
  if (!existing) return reply.status(404).send({ error: 'NotFound' });
  if (existing.status === 'cancelled') {
    return reply.status(409).send({ error: 'Conflict', message: 'already cancelled' });
  }
  const updated = await prisma.event.update({
    where: { id },
    data: { status: 'cancelled' },
    include: { tiers: true },
  });
  await recordAudit({
    actorId: sub,
    action: 'event.cancel',
    entityType: 'event',
    entityId: id,
  });
  return serializeDetail(updated, app.uploads);
});
```

- [ ] **Step 5:** Re-run tests.

```bash
pnpm --filter api test -- admin/events/publish admin/events/cancel
```

Expected: PASS (publish 4/4, cancel 2/2).

- [ ] **Step 6:** Full suite.

```bash
pnpm --filter api test
```

Expected: green.

- [ ] **Step 7:** Commit.

```bash
git add apps/api/src/routes/admin/events.ts apps/api/test/admin/events/publish.test.ts apps/api/test/admin/events/cancel.test.ts
git commit -m "feat(api): admin publish/cancel event actions"
```

---

## Task 12: Tier CRUD (nested under event)

**Files:**

- Create: `apps/api/src/routes/admin/tiers.ts`
- Modify: `apps/api/src/routes/admin/index.ts` (register)
- Test: `apps/api/test/admin/tiers/create.test.ts`
- Test: `apps/api/test/admin/tiers/update.test.ts`
- Test: `apps/api/test/admin/tiers/delete.test.ts`

- [ ] **Step 1:** Write `apps/api/test/admin/tiers/create.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = () =>
  prisma.event.create({
    data: {
      slug: 'ev-tiers',
      title: 't',
      description: 'd',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      lat: 0,
      lng: 0,
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      capacity: 10,
      status: 'draft',
    },
  });

describe('POST /admin/events/:eventId/tiers', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a tier and writes audit', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/tiers`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Geral', priceCents: 5000, quantityTotal: 100 },
    });
    expect(res.statusCode).toBe(201);
    const tiers = await prisma.ticketTier.findMany({ where: { eventId: event.id } });
    expect(tiers).toHaveLength(1);
    expect(tiers[0]?.currency).toBe('BRL');
    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits.map((a) => a.action)).toContain('tier.create');
  });

  it('404 for unknown event', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events/missing/tiers',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Geral', priceCents: 5000, quantityTotal: 100 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 on priceCents < 0', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/tiers`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { name: 'Geral', priceCents: -1, quantityTotal: 100 },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2:** Write `apps/api/test/admin/tiers/update.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('PATCH /admin/events/:eventId/tiers/:tierId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const seed = async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'e',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        lat: 0,
        lng: 0,
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'draft',
        tiers: { create: { name: 'Geral', priceCents: 5000, quantityTotal: 100, sortOrder: 0 } },
      },
      include: { tiers: true },
    });
    return { event, tier: event.tiers[0]! };
  };

  it('updates a field and writes audit', async () => {
    const { event, tier } = await seed();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}/tiers/${tier.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { priceCents: 7500 },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(row.priceCents).toBe(7500);
  });

  it('404 when tier belongs to a different event', async () => {
    const { tier } = await seed();
    const other = await prisma.event.create({
      data: {
        slug: 'other',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        lat: 0,
        lng: 0,
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'draft',
      },
    });
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${other.id}/tiers/${tier.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { priceCents: 7500 },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 3:** Write `apps/api/test/admin/tiers/delete.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('DELETE /admin/events/:eventId/tiers/:tierId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes a tier and writes audit', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'e',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        lat: 0,
        lng: 0,
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'draft',
        tiers: { create: { name: 'Geral', priceCents: 5000, quantityTotal: 100, sortOrder: 0 } },
      },
      include: { tiers: true },
    });
    const tier = event.tiers[0]!;
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/events/${event.id}/tiers/${tier.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(204);
    const remaining = await prisma.ticketTier.count({ where: { id: tier.id } });
    expect(remaining).toBe(0);
    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits.map((a) => a.action)).toContain('tier.delete');
  });

  it('404 when tier does not exist', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'e2',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        lat: 0,
        lng: 0,
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'draft',
      },
    });
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/events/${event.id}/tiers/missing`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 4:** Run — expect fails.

```bash
pnpm --filter api test -- admin/tiers
```

Expected: FAIL across all three.

- [ ] **Step 5:** Create `apps/api/src/routes/admin/tiers.ts`:

```ts
import { prisma } from '@jdm/db';
import { adminTierCreateSchema, adminTierUpdateSchema } from '@jdm/shared/admin';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminTierRoutes: FastifyPluginAsync = async (app) => {
  app.post('/events/:eventId/tiers', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId } = request.params as { eventId: string };
    const input = adminTierCreateSchema.parse(request.body);

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.status(404).send({ error: 'NotFound' });

    const nextSort = input.sortOrder ?? (await prisma.ticketTier.count({ where: { eventId } }));

    const tier = await prisma.ticketTier.create({
      data: {
        eventId,
        name: input.name,
        priceCents: input.priceCents,
        currency: input.currency,
        quantityTotal: input.quantityTotal,
        salesOpenAt: input.salesOpenAt ? new Date(input.salesOpenAt) : null,
        salesCloseAt: input.salesCloseAt ? new Date(input.salesCloseAt) : null,
        sortOrder: nextSort,
      },
    });

    await recordAudit({
      actorId: sub,
      action: 'tier.create',
      entityType: 'tier',
      entityId: tier.id,
      metadata: { eventId },
    });

    return reply.status(201).send({
      id: tier.id,
      name: tier.name,
      priceCents: tier.priceCents,
      currency: tier.currency,
      quantityTotal: tier.quantityTotal,
      quantitySold: tier.quantitySold,
      remainingCapacity: Math.max(0, tier.quantityTotal - tier.quantitySold),
      salesOpenAt: tier.salesOpenAt?.toISOString() ?? null,
      salesCloseAt: tier.salesCloseAt?.toISOString() ?? null,
      sortOrder: tier.sortOrder,
    });
  });

  app.patch('/events/:eventId/tiers/:tierId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId, tierId } = request.params as { eventId: string; tierId: string };
    const input = adminTierUpdateSchema.parse(request.body);

    const tier = await prisma.ticketTier.findFirst({ where: { id: tierId, eventId } });
    if (!tier) return reply.status(404).send({ error: 'NotFound' });

    const data: Prisma.TicketTierUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.quantityTotal !== undefined) data.quantityTotal = input.quantityTotal;
    if (input.salesOpenAt !== undefined)
      data.salesOpenAt = input.salesOpenAt ? new Date(input.salesOpenAt) : null;
    if (input.salesCloseAt !== undefined)
      data.salesCloseAt = input.salesCloseAt ? new Date(input.salesCloseAt) : null;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    const updated = await prisma.ticketTier.update({ where: { id: tierId }, data });
    await recordAudit({
      actorId: sub,
      action: 'tier.update',
      entityType: 'tier',
      entityId: tierId,
      metadata: { fields: Object.keys(input) },
    });
    return {
      id: updated.id,
      name: updated.name,
      priceCents: updated.priceCents,
      currency: updated.currency,
      quantityTotal: updated.quantityTotal,
      quantitySold: updated.quantitySold,
      remainingCapacity: Math.max(0, updated.quantityTotal - updated.quantitySold),
      salesOpenAt: updated.salesOpenAt?.toISOString() ?? null,
      salesCloseAt: updated.salesCloseAt?.toISOString() ?? null,
      sortOrder: updated.sortOrder,
    };
  });

  app.delete('/events/:eventId/tiers/:tierId', async (request, reply) => {
    const { sub } = requireUser(request);
    const { eventId, tierId } = request.params as { eventId: string; tierId: string };
    const tier = await prisma.ticketTier.findFirst({ where: { id: tierId, eventId } });
    if (!tier) return reply.status(404).send({ error: 'NotFound' });
    await prisma.ticketTier.delete({ where: { id: tierId } });
    await recordAudit({
      actorId: sub,
      action: 'tier.delete',
      entityType: 'tier',
      entityId: tierId,
      metadata: { eventId },
    });
    return reply.status(204).send();
  });
};
```

- [ ] **Step 6:** Register in `apps/api/src/routes/admin/index.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';

import { adminEventRoutes } from './events.js';
import { adminTierRoutes } from './tiers.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireRole('organizer', 'admin'));

  await app.register(adminEventRoutes);
  await app.register(adminTierRoutes);
};
```

(Note: drop the `{ prefix: '/events' }` from the previous task — both sub-plugins now declare their full paths like `/events` and `/events/:eventId/tiers`. This keeps admin routes grouped under a single `/admin` prefix applied by `app.ts`.)

- [ ] **Step 7:** Adjust `apps/api/src/routes/admin/events.ts` route paths. Every handler that was `/events/...` or `/events/:id/...` stays the same — but since we removed the per-plugin `prefix`, those paths are still correct. Double-check the file: each `app.post('/events', …)`, `app.get('/events', …)`, `app.get('/events/:id', …)`, etc. should already start with `/events`. No change needed.

- [ ] **Step 8:** Re-run all admin tests.

```bash
pnpm --filter api test -- admin/
```

Expected: PASS across list, create, detail, update, publish, cancel, tiers/create, tiers/update, tiers/delete, uploads-event-cover, require-role.

- [ ] **Step 9:** Full api suite.

```bash
pnpm --filter api test
```

Expected: green.

- [ ] **Step 10:** Commit.

```bash
git add apps/api/src/routes/admin apps/api/test/admin/tiers
git commit -m "feat(api): admin tier CRUD nested under event"
```

---

## Task 13: Admin web — API client + auth session

**Files:**

- Create: `apps/admin/src/lib/auth-session.ts`
- Create: `apps/admin/src/lib/admin-api.ts`
- Modify: `apps/admin/src/lib/api.ts`

- [ ] **Step 1:** Replace `apps/admin/src/lib/api.ts` (expanded base client):

```ts
import { cookies } from 'next/headers';

import { healthResponseSchema, type HealthResponse } from '@jdm/shared/health';

const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type FetchOptions = RequestInit & { auth?: boolean };

export const apiFetch = async <T>(
  path: string,
  opts: FetchOptions & { schema: import('zod').ZodType<T> },
): Promise<T> => {
  const { schema, auth = true, headers, ...rest } = opts;
  const jar = await cookies();
  const access = jar.get('session_access')?.value;
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  if (auth && access) h.set('authorization', `Bearer ${access}`);

  const res = await fetch(`${base}${path}`, { ...rest, headers: h, cache: 'no-store' });
  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, body.error ?? 'Error', body.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return schema.parse(json);
};

export const fetchHealth = async (): Promise<HealthResponse> =>
  apiFetch('/health', { schema: healthResponseSchema, auth: false });
```

- [ ] **Step 2:** Create `apps/admin/src/lib/auth-session.ts`:

```ts
import { cookies } from 'next/headers';

import type { AuthResponse } from '@jdm/shared/auth';

const ACCESS_COOKIE = 'session_access';
const REFRESH_COOKIE = 'session_refresh';
const ROLE_COOKIE = 'session_role';

const isProd = process.env.NODE_ENV === 'production';

export const writeSession = async (res: AuthResponse): Promise<void> => {
  const jar = await cookies();
  const secure = isProd;
  // Access token: short-lived but we don't decode it client-side. TTL in the JWT itself.
  jar.set(ACCESS_COOKIE, res.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  });
  jar.set(REFRESH_COOKIE, res.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  });
  jar.set(ROLE_COOKIE, res.user.role, {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    path: '/',
  });
};

export const clearSession = async (): Promise<void> => {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  jar.delete(ROLE_COOKIE);
};

export const readRole = async (): Promise<string | null> => {
  const jar = await cookies();
  return jar.get(ROLE_COOKIE)?.value ?? null;
};
```

- [ ] **Step 3:** Create `apps/admin/src/lib/admin-api.ts`:

```ts
import {
  adminEventDetailSchema,
  adminEventListResponseSchema,
  type AdminEventCreate,
  type AdminEventUpdate,
  type AdminTierCreate,
  type AdminTierUpdate,
  adminTicketTierSchema,
} from '@jdm/shared/admin';

import { apiFetch } from './api.js';

export const listAdminEvents = () =>
  apiFetch('/admin/events', { schema: adminEventListResponseSchema });

export const getAdminEvent = (id: string) =>
  apiFetch(`/admin/events/${id}`, { schema: adminEventDetailSchema });

export const createAdminEvent = (input: AdminEventCreate) =>
  apiFetch('/admin/events', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminEventDetailSchema,
  });

export const updateAdminEvent = (id: string, input: AdminEventUpdate) =>
  apiFetch(`/admin/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminEventDetailSchema,
  });

export const publishAdminEvent = (id: string) =>
  apiFetch(`/admin/events/${id}/publish`, {
    method: 'POST',
    schema: adminEventDetailSchema,
  });

export const cancelAdminEvent = (id: string) =>
  apiFetch(`/admin/events/${id}/cancel`, {
    method: 'POST',
    schema: adminEventDetailSchema,
  });

export const createTier = (eventId: string, input: AdminTierCreate) =>
  apiFetch(`/admin/events/${eventId}/tiers`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminTicketTierSchema,
  });

export const updateTier = (eventId: string, tierId: string, input: AdminTierUpdate) =>
  apiFetch(`/admin/events/${eventId}/tiers/${tierId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminTicketTierSchema,
  });

export const deleteTier = (eventId: string, tierId: string) =>
  apiFetch(`/admin/events/${eventId}/tiers/${tierId}`, {
    method: 'DELETE',
    schema: adminTicketTierSchema, // returns 204; apiFetch returns undefined
  });
```

- [ ] **Step 4:** Typecheck admin.

```bash
pnpm --filter admin typecheck
```

Expected: green.

- [ ] **Step 5:** Commit.

```bash
git add apps/admin/src/lib
git commit -m "feat(admin): API client + session cookie helpers"
```

---

## Task 14: Admin login page + server actions

**Files:**

- Create: `apps/admin/src/lib/auth-actions.ts`
- Create: `apps/admin/app/login/page.tsx`
- Modify: `apps/admin/app/page.tsx`

- [ ] **Step 1:** Create `apps/admin/src/lib/auth-actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';

import { authResponseSchema, loginSchema } from '@jdm/shared/auth';

import { apiFetch, ApiError } from './api.js';
import { clearSession, writeSession } from './auth-session.js';

export type LoginState = { error: string | null };

export const loginAction = async (_prev: LoginState, formData: FormData): Promise<LoginState> => {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Email ou senha inválidos.' };
  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      schema: authResponseSchema,
      auth: false,
    });
    if (res.user.role !== 'organizer' && res.user.role !== 'admin') {
      return { error: 'Conta sem permissão de administrador.' };
    }
    await writeSession(res);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { error: 'Credenciais inválidas.' };
    }
    if (e instanceof ApiError && e.status === 403) {
      return { error: 'Verifique seu email antes de entrar.' };
    }
    return { error: 'Erro ao entrar. Tente novamente.' };
  }
  redirect('/events');
};

export const logoutAction = async (): Promise<void> => {
  await clearSession();
  redirect('/login');
};
```

- [ ] **Step 2:** Create `apps/admin/app/login/page.tsx`:

```tsx
'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { loginAction, type LoginState } from '~/lib/auth-actions';

const initial: LoginState = { error: null };

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
    >
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  );
};

export default function LoginPage() {
  const [state, formAction] = useFormState(loginAction, initial);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold">JDM Admin · Entrar</h1>
      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Senha</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
        <SubmitButton />
      </form>
    </main>
  );
}
```

- [ ] **Step 3:** Replace `apps/admin/app/page.tsx` to redirect based on session:

```tsx
import { redirect } from 'next/navigation';

import { readRole } from '~/lib/auth-session';

export default async function RootPage() {
  const role = await readRole();
  if (role === 'organizer' || role === 'admin') redirect('/events');
  redirect('/login');
}
```

- [ ] **Step 4:** Typecheck + lint.

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
```

Expected: green.

- [ ] **Step 5:** Manual smoke test (optional; `[-]` for autonomous sessions):
  1. `pnpm --filter api dev` in one shell, ensure `/auth/login` works against a seeded organizer.
  2. Create an organizer user locally: `pnpm --filter @jdm/db exec prisma studio` → add a User with `role=organizer`, `emailVerifiedAt` set, a bcrypt hash you know the password for (or use signup + admin update).
  3. `pnpm --filter admin dev` → open `http://localhost:3000` → should redirect to `/login`.
  4. Log in → should redirect to `/events` (404 until Task 15).

- [ ] **Step 6:** Commit.

```bash
git add apps/admin/app/login apps/admin/src/lib/auth-actions.ts apps/admin/app/page.tsx
git commit -m "feat(admin): login page + session cookie actions"
```

---

## Task 15: Events list page + logout

**Files:**

- Create: `apps/admin/app/(authed)/layout.tsx`
- Create: `apps/admin/app/(authed)/events/page.tsx`
- Create: `apps/admin/src/components/status-badge.tsx`
- Create: `apps/admin/src/components/logout-button.tsx`
- Create: `apps/admin/middleware.ts`

- [ ] **Step 1:** Create the middleware at `apps/admin/middleware.ts`:

```ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = {
  matcher: ['/', '/events/:path*', '/login'],
};

export const middleware = (req: NextRequest) => {
  const role = req.cookies.get('session_role')?.value;
  const authed = role === 'organizer' || role === 'admin';
  const path = req.nextUrl.pathname;
  if (!authed && path !== '/login' && path !== '/') {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (authed && path === '/login') {
    return NextResponse.redirect(new URL('/events', req.url));
  }
  return NextResponse.next();
};
```

- [ ] **Step 2:** Create `apps/admin/src/components/logout-button.tsx`:

```tsx
'use client';

import { logoutAction } from '~/lib/auth-actions';

export const LogoutButton = () => (
  <form action={logoutAction}>
    <button
      type="submit"
      className="rounded border border-[color:var(--color-border)] px-3 py-1 text-sm hover:bg-[color:var(--color-border)]"
    >
      Sair
    </button>
  </form>
);
```

- [ ] **Step 3:** Create `apps/admin/src/components/status-badge.tsx`:

```tsx
import type { EventStatus } from '@jdm/shared/events';

const COPY: Record<EventStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  cancelled: 'Cancelado',
};

const TONE: Record<EventStatus, string> = {
  draft: 'bg-neutral-700 text-neutral-100',
  published: 'bg-emerald-700 text-emerald-50',
  cancelled: 'bg-red-800 text-red-50',
};

export const StatusBadge = ({ status }: { status: EventStatus }) => (
  <span className={`rounded px-2 py-0.5 text-xs ${TONE[status]}`}>{COPY[status]}</span>
);
```

- [ ] **Step 4:** Create `apps/admin/app/(authed)/layout.tsx`:

```tsx
import Link from 'next/link';

import { LogoutButton } from '~/components/logout-button';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <nav className="flex items-center justify-between border-b border-[color:var(--color-border)] px-6 py-3">
        <Link href="/events" className="font-semibold">
          JDM Admin
        </Link>
        <LogoutButton />
      </nav>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 5:** Create `apps/admin/app/(authed)/events/page.tsx`:

```tsx
import Link from 'next/link';

import { StatusBadge } from '~/components/status-badge';
import { listAdminEvents } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export default async function EventsPage() {
  const { items } = await listAdminEvents();
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Eventos</h1>
        <Link
          href="/events/new"
          className="rounded bg-[color:var(--color-accent)] px-3 py-2 text-sm font-semibold"
        >
          Novo evento
        </Link>
      </header>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Título</th>
            <th>Status</th>
            <th>Data</th>
            <th>Cidade</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} className="border-b border-[color:var(--color-border)]">
              <td className="py-2">
                <Link href={`/events/${e.id}`} className="hover:underline">
                  {e.title}
                </Link>
                <div className="text-xs text-[color:var(--color-muted)]">{e.slug}</div>
              </td>
              <td>
                <StatusBadge status={e.status} />
              </td>
              <td className="text-sm">{fmtDate(e.startsAt)}</td>
              <td className="text-sm">
                {e.city}/{e.stateCode}
              </td>
            </tr>
          ))}
          {items.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-6 text-center text-[color:var(--color-muted)]">
                Nenhum evento ainda.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 6:** Typecheck + lint.

```bash
pnpm --filter admin typecheck && pnpm --filter admin lint
```

Expected: green.

- [ ] **Step 7:** Commit.

```bash
git add apps/admin/app/\(authed\) apps/admin/src/components apps/admin/middleware.ts
git commit -m "feat(admin): events list page + middleware + logout"
```

---

## Task 16: New event form

**Files:**

- Create: `apps/admin/app/(authed)/events/new/page.tsx`
- Create: `apps/admin/src/lib/event-actions.ts`

- [ ] **Step 1:** Create `apps/admin/src/lib/event-actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { adminEventCreateSchema, adminEventUpdateSchema } from '@jdm/shared/admin';

import { ApiError } from './api.js';
import {
  cancelAdminEvent,
  createAdminEvent,
  publishAdminEvent,
  updateAdminEvent,
} from './admin-api.js';

export type EventFormState = { error: string | null };

const toNumber = (v: FormDataEntryValue | null) => (v == null || v === '' ? NaN : Number(v));
const toIso = (v: FormDataEntryValue | null) => {
  if (typeof v !== 'string' || v === '') return '';
  // HTML datetime-local returns "YYYY-MM-DDTHH:MM" — append :00Z for Zod datetime().
  return new Date(v).toISOString();
};

export const createEventAction = async (
  _prev: EventFormState,
  fd: FormData,
): Promise<EventFormState> => {
  const parsed = adminEventCreateSchema.safeParse({
    slug: fd.get('slug'),
    title: fd.get('title'),
    description: fd.get('description'),
    coverObjectKey: (fd.get('coverObjectKey') as string) || null,
    startsAt: toIso(fd.get('startsAt')),
    endsAt: toIso(fd.get('endsAt')),
    venueName: fd.get('venueName'),
    venueAddress: fd.get('venueAddress'),
    lat: toNumber(fd.get('lat')),
    lng: toNumber(fd.get('lng')),
    city: fd.get('city'),
    stateCode: fd.get('stateCode'),
    type: fd.get('type'),
    capacity: toNumber(fd.get('capacity')),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  let created;
  try {
    created = await createAdminEvent(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao criar.' };
  }
  revalidatePath('/events');
  redirect(`/events/${created.id}`);
};

export const updateEventAction = async (
  id: string,
  _prev: EventFormState,
  fd: FormData,
): Promise<EventFormState> => {
  const raw: Record<string, unknown> = {};
  for (const key of [
    'title',
    'description',
    'venueName',
    'venueAddress',
    'city',
    'stateCode',
    'type',
  ]) {
    const v = fd.get(key);
    if (typeof v === 'string' && v !== '') raw[key] = v;
  }
  for (const key of ['lat', 'lng', 'capacity']) {
    const v = fd.get(key);
    if (typeof v === 'string' && v !== '') raw[key] = Number(v);
  }
  for (const key of ['startsAt', 'endsAt']) {
    const v = fd.get(key);
    if (typeof v === 'string' && v !== '') raw[key] = new Date(v).toISOString();
  }
  const coverKey = fd.get('coverObjectKey');
  if (typeof coverKey === 'string') raw.coverObjectKey = coverKey === '' ? null : coverKey;

  const parsed = adminEventUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  try {
    await updateAdminEvent(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar.' };
  }
  revalidatePath(`/events/${id}`);
  revalidatePath('/events');
  return { error: null };
};

export const publishEventAction = async (id: string): Promise<EventFormState> => {
  try {
    await publishAdminEvent(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao publicar.' };
  }
  revalidatePath('/events');
  revalidatePath(`/events/${id}`);
  return { error: null };
};

export const cancelEventAction = async (id: string): Promise<EventFormState> => {
  try {
    await cancelAdminEvent(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao cancelar.' };
  }
  revalidatePath('/events');
  revalidatePath(`/events/${id}`);
  return { error: null };
};
```

- [ ] **Step 2:** Create `apps/admin/app/(authed)/events/new/page.tsx`:

```tsx
'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { BRAZIL_STATE_CODES } from '@jdm/shared/profile';

import { createEventAction, type EventFormState } from '~/lib/event-actions';

const initial: EventFormState = { error: null };

const Submit = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
    >
      {pending ? 'Criando…' : 'Criar evento'}
    </button>
  );
};

const Field = ({
  label,
  name,
  type = 'text',
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="flex flex-col gap-1">
    <span className="text-sm text-[color:var(--color-muted)]">{label}</span>
    <input
      name={name}
      type={type}
      {...rest}
      className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
    />
  </label>
);

export default function NewEventPage() {
  const [state, action] = useFormState(createEventAction, initial);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Novo evento</h1>
      <form action={action} className="grid grid-cols-2 gap-4">
        <Field label="Slug" name="slug" required placeholder="encontro-sp-maio" />
        <Field label="Título" name="title" required />
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Descrição</span>
          <textarea
            name="description"
            required
            rows={5}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <Field label="Início" name="startsAt" type="datetime-local" required />
        <Field label="Fim" name="endsAt" type="datetime-local" required />
        <Field label="Local (nome)" name="venueName" required />
        <Field label="Endereço" name="venueAddress" required />
        <Field label="Latitude" name="lat" type="number" step="0.000001" required />
        <Field label="Longitude" name="lng" type="number" step="0.000001" required />
        <Field label="Cidade" name="city" required />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Estado</span>
          <select
            name="stateCode"
            required
            defaultValue="SP"
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          >
            {BRAZIL_STATE_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Tipo</span>
          <select
            name="type"
            required
            defaultValue="meeting"
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          >
            <option value="meeting">Encontro</option>
            <option value="drift">Drift</option>
            <option value="other">Outro</option>
          </select>
        </label>
        <Field label="Capacidade" name="capacity" type="number" min={0} required />
        <input type="hidden" name="coverObjectKey" value="" />
        {state.error ? <p className="col-span-2 text-sm text-red-400">{state.error}</p> : null}
        <div className="col-span-2">
          <Submit />
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 3:** Typecheck + lint.

```bash
pnpm --filter admin typecheck && pnpm --filter admin lint
```

Expected: green.

- [ ] **Step 4:** Commit.

```bash
git add apps/admin/app/\(authed\)/events/new apps/admin/src/lib/event-actions.ts
git commit -m "feat(admin): create event form"
```

---

## Task 17: Edit event page + publish/cancel + cover upload

**Files:**

- Create: `apps/admin/app/(authed)/events/[id]/page.tsx`
- Create: `apps/admin/app/(authed)/events/[id]/event-form.tsx` (client sub-component)
- Create: `apps/admin/app/(authed)/events/[id]/tier-list.tsx` (client sub-component)
- Create: `apps/admin/src/components/cover-uploader.tsx`
- Create: `apps/admin/src/lib/tier-actions.ts`
- Create: `apps/admin/src/lib/upload-actions.ts`

- [ ] **Step 1:** Create `apps/admin/src/lib/upload-actions.ts` — server action that presigns then returns the payload:

```ts
'use server';

import { presignRequestSchema, presignResponseSchema } from '@jdm/shared/uploads';

import { apiFetch } from './api.js';

export type PresignInput = { contentType: string; size: number };

export const presignEventCoverAction = async (input: PresignInput) => {
  const body = presignRequestSchema.parse({ kind: 'event_cover', ...input });
  return apiFetch('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify(body),
    schema: presignResponseSchema,
  });
};
```

- [ ] **Step 2:** Create `apps/admin/src/lib/tier-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';

import { adminTierCreateSchema, adminTierUpdateSchema } from '@jdm/shared/admin';

import { ApiError } from './api.js';
import { createTier, deleteTier, updateTier } from './admin-api.js';

export type TierFormState = { error: string | null };

const toNum = (v: FormDataEntryValue | null) => (v == null || v === '' ? NaN : Number(v));

export const createTierAction = async (
  eventId: string,
  _prev: TierFormState,
  fd: FormData,
): Promise<TierFormState> => {
  const parsed = adminTierCreateSchema.safeParse({
    name: fd.get('name'),
    priceCents: toNum(fd.get('priceCents')),
    quantityTotal: toNum(fd.get('quantityTotal')),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  try {
    await createTier(eventId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao criar tier.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};

export const updateTierAction = async (
  eventId: string,
  tierId: string,
  _prev: TierFormState,
  fd: FormData,
): Promise<TierFormState> => {
  const raw: Record<string, unknown> = {};
  if (typeof fd.get('name') === 'string' && fd.get('name') !== '') raw.name = fd.get('name');
  const price = fd.get('priceCents');
  if (typeof price === 'string' && price !== '') raw.priceCents = Number(price);
  const qty = fd.get('quantityTotal');
  if (typeof qty === 'string' && qty !== '') raw.quantityTotal = Number(qty);

  const parsed = adminTierUpdateSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  try {
    await updateTier(eventId, tierId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar tier.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};

export const deleteTierAction = async (eventId: string, tierId: string): Promise<TierFormState> => {
  try {
    await deleteTier(eventId, tierId);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao remover tier.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};
```

- [ ] **Step 3:** Create `apps/admin/src/components/cover-uploader.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { presignEventCoverAction } from '~/lib/upload-actions';

export const CoverUploader = ({
  initialKey,
  initialUrl,
}: {
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
      setError('Formato inválido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const presign = await presignEventCoverAction({ contentType: file.type, size: file.size });
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
      <span className="text-sm text-[color:var(--color-muted)]">Capa</span>
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="cover preview" className="h-32 w-auto rounded object-cover" />
      ) : null}
      <input type="file" accept="image/*" onChange={onChange} disabled={busy} />
      <input type="hidden" name="coverObjectKey" value={objectKey ?? ''} />
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
};
```

- [ ] **Step 4:** Create `apps/admin/app/(authed)/events/[id]/event-form.tsx`:

```tsx
'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { BRAZIL_STATE_CODES } from '@jdm/shared/profile';
import type { AdminEventDetail } from '@jdm/shared/admin';

import { CoverUploader } from '~/components/cover-uploader';
import {
  cancelEventAction,
  publishEventAction,
  updateEventAction,
  type EventFormState,
} from '~/lib/event-actions';

const initial: EventFormState = { error: null };

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  );
};

const isoToLocal = (iso: string) => iso.slice(0, 16);

export const EventForm = ({ event }: { event: AdminEventDetail }) => {
  const [state, action] = useFormState(updateEventAction.bind(null, event.id), initial);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        {event.status === 'draft' ? (
          <form action={publishEventAction.bind(null, event.id)}>
            <Submit label="Publicar" />
          </form>
        ) : null}
        {event.status !== 'cancelled' ? (
          <form action={cancelEventAction.bind(null, event.id)}>
            <button
              type="submit"
              className="rounded border border-red-700 px-3 py-2 text-sm text-red-400"
            >
              Cancelar evento
            </button>
          </form>
        ) : null}
      </div>

      <form action={action} className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Título</span>
          <input
            name="title"
            defaultValue={event.title}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <div className="col-span-2">
          <CoverUploader initialKey={null} initialUrl={event.coverUrl} />
        </div>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Descrição</span>
          <textarea
            name="description"
            defaultValue={event.description}
            rows={5}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Início</span>
          <input
            name="startsAt"
            type="datetime-local"
            defaultValue={isoToLocal(event.startsAt)}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Fim</span>
          <input
            name="endsAt"
            type="datetime-local"
            defaultValue={isoToLocal(event.endsAt)}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Local</span>
          <input
            name="venueName"
            defaultValue={event.venueName}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Endereço</span>
          <input
            name="venueAddress"
            defaultValue={event.venueAddress}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Latitude</span>
          <input
            name="lat"
            type="number"
            step="0.000001"
            defaultValue={event.lat}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Longitude</span>
          <input
            name="lng"
            type="number"
            step="0.000001"
            defaultValue={event.lng}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Cidade</span>
          <input
            name="city"
            defaultValue={event.city}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Estado</span>
          <select
            name="stateCode"
            defaultValue={event.stateCode}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          >
            {BRAZIL_STATE_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Tipo</span>
          <select
            name="type"
            defaultValue={event.type}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          >
            <option value="meeting">Encontro</option>
            <option value="drift">Drift</option>
            <option value="other">Outro</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Capacidade</span>
          <input
            name="capacity"
            type="number"
            min={0}
            defaultValue={event.capacity}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        {state.error ? <p className="col-span-2 text-sm text-red-400">{state.error}</p> : null}
        <div className="col-span-2">
          <Submit label="Salvar" />
        </div>
      </form>
    </div>
  );
};
```

- [ ] **Step 5:** Create `apps/admin/app/(authed)/events/[id]/tier-list.tsx`:

```tsx
'use client';

import { useFormState, useFormStatus } from 'react-dom';

import type { AdminTicketTier } from '@jdm/shared/admin';

import {
  createTierAction,
  deleteTierAction,
  updateTierAction,
  type TierFormState,
} from '~/lib/tier-actions';

const initial: TierFormState = { error: null };

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  );
};

const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const TierRow = ({ eventId, tier }: { eventId: string; tier: AdminTicketTier }) => {
  const [state, action] = useFormState(updateTierAction.bind(null, eventId, tier.id), initial);
  return (
    <tr className="border-b border-[color:var(--color-border)]">
      <td className="py-2">
        <form action={action} className="flex items-center gap-2">
          <input
            name="name"
            defaultValue={tier.name}
            className="w-32 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <input
            name="priceCents"
            type="number"
            min={0}
            defaultValue={tier.priceCents}
            className="w-24 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <input
            name="quantityTotal"
            type="number"
            min={0}
            defaultValue={tier.quantityTotal}
            className="w-24 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <Submit label="Salvar" />
          {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
        </form>
      </td>
      <td className="text-sm">{formatBRL(tier.priceCents)}</td>
      <td className="text-sm">
        {tier.quantitySold}/{tier.quantityTotal}
      </td>
      <td>
        <form action={deleteTierAction.bind(null, eventId, tier.id)}>
          <button type="submit" className="text-sm text-red-400 hover:underline">
            Remover
          </button>
        </form>
      </td>
    </tr>
  );
};

export const TierList = ({ eventId, tiers }: { eventId: string; tiers: AdminTicketTier[] }) => {
  const [state, action] = useFormState(createTierAction.bind(null, eventId), initial);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Ingressos</h2>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Tier</th>
            <th>Preço</th>
            <th>Vendidos</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <TierRow key={t.id} eventId={eventId} tier={t} />
          ))}
        </tbody>
      </table>
      <form
        action={action}
        className="flex items-end gap-2 border-t border-[color:var(--color-border)] pt-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[color:var(--color-muted)]">Nome</span>
          <input
            name="name"
            required
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[color:var(--color-muted)]">Preço (centavos)</span>
          <input
            name="priceCents"
            type="number"
            min={0}
            required
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[color:var(--color-muted)]">Quantidade</span>
          <input
            name="quantityTotal"
            type="number"
            min={0}
            required
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <Submit label="Adicionar" />
        {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
      </form>
    </section>
  );
};
```

- [ ] **Step 6:** Create the page `apps/admin/app/(authed)/events/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';

import { StatusBadge } from '~/components/status-badge';
import { getAdminEvent } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';

import { EventForm } from './event-form';
import { TierList } from './tier-list';

export const dynamic = 'force-dynamic';

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let event;
  try {
    event = await getAdminEvent(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <section className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-sm text-[color:var(--color-muted)]">{event.slug}</p>
        </div>
        <StatusBadge status={event.status} />
      </header>
      <EventForm event={event} />
      <TierList eventId={event.id} tiers={event.tiers} />
    </section>
  );
}
```

- [ ] **Step 7:** Typecheck + lint.

```bash
pnpm --filter admin typecheck && pnpm --filter admin lint
```

Expected: green.

- [ ] **Step 8:** Commit.

```bash
git add apps/admin/app/\(authed\)/events/\[id\] apps/admin/src/components/cover-uploader.tsx apps/admin/src/lib/tier-actions.ts apps/admin/src/lib/upload-actions.ts
git commit -m "feat(admin): edit event + publish/cancel + tier editor + cover upload"
```

---

## Task 18: CORS update + env + deploy prep

**Files:**

- Modify: `apps/api/src/env.ts` (no change; `CORS_ORIGINS` is comma-separated)
- Modify: Railway env (in `RAILWAY.md` note, not code)
- Modify: `apps/admin/.env.example` (new; lists `NEXT_PUBLIC_API_BASE_URL`)
- Modify: `docs/secrets.md` (note admin deploy)

- [ ] **Step 1:** Create `apps/admin/.env.example`:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT_ADMIN=
SENTRY_AUTH_TOKEN=
```

- [ ] **Step 2:** Update `docs/secrets.md` — add an "Admin (Vercel)" section listing the same vars plus a note that `NEXT_PUBLIC_API_BASE_URL` must point at the Railway API URL and that Railway's `CORS_ORIGINS` must include the admin origin (Vercel preview + prod domains).

- [ ] **Step 3:** Commit.

```bash
git add apps/admin/.env.example docs/secrets.md
git commit -m "docs(admin): env example + secrets checklist"
```

---

## Task 19: Update roadmap + handoff

**Files:**

- Modify: `plans/roadmap.md`
- Modify: `handoff.md`
- Modify: `plans/phase-1-f7a-admin-event-crud-plan.md` (this file — tick the plan-level boxes this task enumerates)

- [ ] **Step 1:** In `plans/roadmap.md`, flip 7.1–7.4 from `[~]` to `[x]` **only if** (a) the PR has merged to `main`, (b) Railway has deployed the new API, and (c) Vercel has deployed the admin app. If any of those is still pending, leave at `[~]`.

- [ ] **Step 2:** Also flip `0.13 Vercel deploy (Admin)` from `[-]`/`[~]` to `[x]` once admin is deployed, since F7a requires it.

- [ ] **Step 3:** Rewrite `handoff.md` for the next agent: summarize what shipped (admin CRUD + audit), what's left for F7 full-admin (check-in UI lives in F5; moderation lives in F9.7; F10 broadcast composer), and where the audit viewer will live (not built here).

- [ ] **Step 4:** Commit.

```bash
git add plans/roadmap.md handoff.md plans/phase-1-f7a-admin-event-crud-plan.md
git commit -m "docs: roadmap tick for F7a + handoff"
```

- [ ] **Step 5:** Push the branch and open a PR titled `feat(admin): F7a — event CRUD (first pass)` with a body linking to this plan file and listing the four roadmap tasks (7.1–7.4) as covered.

```bash
git push -u origin feat/f7a-admin-event-crud
gh pr create --title "feat(admin): F7a — event CRUD (first pass)" --body "$(cat <<'EOF'
## Summary

- Role-gated admin event + tier CRUD under `/admin/*`
- Publish / cancel transitions with audit rows
- `AdminAudit` model records every mutation
- Admin Next.js app: login, events list, create/edit/publish/cancel, cover upload via existing presign flow

## Covers roadmap tasks

- 7.1 Admin auth
- 7.2 Admin events list + CRUD
- 7.3 Admin ticket tier CRUD
- 7.4 Organizer-scoped mutations + audit log

Plan: `plans/phase-1-f7a-admin-event-crud-plan.md`

## Test plan

- [ ] `pnpm --filter api test` green
- [ ] `pnpm --filter admin typecheck && pnpm --filter admin lint` green
- [ ] Manual: log in as organizer → create event → publish → shows on mobile list
- [ ] Manual: edit tiers → mobile detail shows new prices + remaining
- [ ] Manual: cancel event → disappears from mobile list
EOF
)"
```

---

## Deferred / explicitly not in this plan

- **Audit viewer UI.** `AdminAudit` rows are written but there's no UI to browse them. Follow-up task can add `/admin/audit` list.
- **Slug edits after publish.** Deferred — in this pass slug is immutable via PATCH.
- **Event cover deletion when replacing.** Upload flow just stores the new key; old R2 objects are orphaned until a future GC job.
- **Soft delete for events.** Not in this pass; cancel is the terminal state.
- **Pagination on admin events list.** Unpaginated; revisit when volumes grow.
- **Dedicated `/admin/tiers/reorder`.** Tier reordering is done via `sortOrder` PATCH per tier; bulk reorder is a follow-up.
- **Rate limiting on `/admin/*`.** Admin is behind auth + role; revisit if abuse vectors emerge.

---

## Self-review checklist (run before marking complete)

- [ ] Every roadmap task (7.1, 7.2, 7.3, 7.4) has at least one API task + one admin-web task backing it.
- [ ] Every admin mutation writes exactly one `AdminAudit` row — `event.create/update/publish/cancel`, `tier.create/update/delete`.
- [ ] No placeholders (no "TODO", "TBD", "similar to above", etc.).
- [ ] Type names consistent (`AdminEventDetail`, `AdminTicketTier`, `AdminEventRow`).
- [ ] Every client-side import of `@jdm/shared/admin` schemas is also used in the corresponding API route (so the contract is single-sourced).
- [ ] Public `GET /events` still filters by `status='published'` — admin can see drafts, attendees cannot.
