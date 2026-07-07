# Phase 1 · F3 Events Catalog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only public events catalog: attendees can browse upcoming/past events filtered by state/city/type and view an event's full detail (hero, date, venue with map pin, tiers with prices). Organizer/admin event _creation_ ships in F7a; ticket _purchase_ ships in F4.

**Architecture:** Add `Event` and `TicketTier` tables to Prisma (no `Order`/`Ticket` yet — those are F4.1). Expose two public GET routes on the API — no auth, cursor-paginated list + slug-keyed detail — only returning `status = published`. Seed a handful of events via a Prisma seed script so the mobile screens can render before F7a admin lands. Mobile adds an Events tab to the `(app)` group with a tabs/list/detail screen trio wired to a shared Zod-typed client.

**Tech Stack:** Prisma, Fastify, Zod, Expo Router, React Native `FlatList`, `@react-navigation/material-top-tabs` (or a simple segmented-control if tabs feel heavy), `Linking` for map pin.

**Roadmap tasks covered:** 3.1, 3.2, 3.3, 3.4, 3.5.

---

## File structure

**`packages/db/prisma/schema.prisma`** — add `EventType`, `EventStatus` enums; add `Event` and `TicketTier` models with indexes.
**`packages/db/prisma/migrations/<timestamp>_events_catalog/migration.sql`** — generated migration.
**`packages/db/prisma/seed.ts`** (new) — dev-only seed inserting ~4 events (2 upcoming published, 1 past published, 1 draft) with 2 tiers each.
**`packages/db/package.json`** — add `"prisma": { "seed": "tsx prisma/seed.ts" }` + `db:seed` script; add `tsx` as devDep if missing.

**`packages/shared/src/events.ts`** — replace stub with `eventTypeSchema`, `eventStatusSchema`, `ticketTierSchema`, `eventSummarySchema`, `eventDetailSchema`, `eventListQuerySchema`, `eventListResponseSchema`.

**`apps/api/src/routes/events.ts`** (new) — `GET /events` (list with filters + cursor) and `GET /events/:slug` (detail). Both public.
**`apps/api/src/app.ts`** — register `eventRoutes`.
**`apps/api/test/helpers.ts`** — extend `resetDatabase` to clear `ticketTier` and `event` first (before `user`).
**`apps/api/test/events/list.test.ts`** (new) — filters, window, pagination, draft hidden.
**`apps/api/test/events/detail.test.ts`** (new) — happy, 404, draft hidden, tier remaining capacity.

**`apps/mobile/src/copy/events.ts`** (new) — PT-BR copy.
**`apps/mobile/src/api/events.ts`** (new) — `listEvents(query)`, `getEvent(slug)` using `request` (public) from `./client`.
**`apps/mobile/src/lib/format.ts`** (new) — `formatBRL(cents)`, `formatEventDateRange(startsAt, endsAt)` helpers.
**`apps/mobile/app/(app)/_layout.tsx`** — switch to a tab layout (Events / Garage / Profile) using `expo-router`'s `Tabs`, or keep `Stack` and add Events as a new entry + a home tab bar. Plan below assumes a simple `Tabs` layout.
**`apps/mobile/app/(app)/events/_layout.tsx`** (new) — `Stack` so list and detail can navigate.
**`apps/mobile/app/(app)/events/index.tsx`** (new) — list with segmented tabs (Próximos / Anteriores / Perto de mim), state filter chip, pull-to-refresh.
**`apps/mobile/app/(app)/events/[slug].tsx`** (new) — hero, description, date/time, venue card with map pin, tiers, disabled "Comprar" CTA (enabled in F4).

**`plans/roadmap.md`** — flip 3.1–3.5 `[ ]`→`[~]` on branch start, `[~]`→`[x]` on merge+deploy (per file rules in CLAUDE.md).
**`handoff.md`** — rewrite on PR creation.

---

## Conventions (read before any task)

- **Public routes:** `GET /events` and `GET /events/:slug` are unauthenticated. Do **not** attach `app.authenticate`. They must only return `status = 'published'` events.
- **No admin yet:** creation/mutation of events lives in F7a. Do not add any `POST /events` or write endpoints in this plan — the seed script is the only way to get data in.
- **Tiers live in F3:** `TicketTier` is introduced here so detail can show prices. `Order`/`Ticket` land in F4.1. `quantity_sold` stays at `0` in F3 (no purchase path) — `remainingCapacity` = `quantityTotal - quantitySold`.
- **Cursor pagination:** sort by `(starts_at ASC, id ASC)` for upcoming; `(starts_at DESC, id DESC)` for past. Cursor is opaque base64-encoded `{startsAt, id}`. Always include `nextCursor` (null when no more).
- **Slug is the public key.** Never expose Event `id` in URLs. Slug must be unique and immutable.
- **Tests:** every API test starts with `await resetDatabase(); app = await makeApp();` per `apps/api/test/helpers.ts`. Integration tests hit the real Postgres — no mocks (CLAUDE.md).
- **PT-BR copy:** strings in `apps/mobile/src/copy/events.ts`. No inline strings in screens.
- **Commits:** one commit per task. Conventional prefixes: `feat:`, `fix:`, `test:`, `chore:`, `docs:`.
- **Branch:** `feat/f3-events` off `main`.

---

## ✅ Task 1: Prisma schema — Event + TicketTier + enums

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create migration: `packages/db/prisma/migrations/<timestamp>_events_catalog/migration.sql` (via Prisma)

- [x] **Step 1: Edit `schema.prisma`** — append two enums and two models at the end of the file. Do not touch existing models except to note we'll add relations to `User` and `Event`/`TicketTier` in F4.

```prisma
enum EventType {
  meeting
  drift
  other
}

enum EventStatus {
  draft
  published
  cancelled
}

model Event {
  id           String      @id @default(cuid())
  slug         String      @unique @db.VarChar(140)
  title        String      @db.VarChar(140)
  description  String      @db.Text
  coverObjectKey String?   @db.VarChar(300)
  startsAt     DateTime
  endsAt       DateTime
  venueName    String      @db.VarChar(140)
  venueAddress String      @db.VarChar(300)
  lat          Float
  lng          Float
  city         String      @db.VarChar(100)
  stateCode    String      @db.VarChar(2)
  type         EventType
  status       EventStatus @default(draft)
  capacity     Int
  publishedAt  DateTime?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  tiers TicketTier[]

  @@index([stateCode, city, startsAt])
  @@index([status, startsAt])
}

model TicketTier {
  id             String   @id @default(cuid())
  eventId        String
  name           String   @db.VarChar(80)
  priceCents     Int
  currency       String   @default("BRL") @db.VarChar(3)
  quantityTotal  Int
  quantitySold   Int      @default(0)
  salesOpenAt    DateTime?
  salesCloseAt   DateTime?
  sortOrder      Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([eventId, sortOrder])
}
```

- [x] **Step 2: Create the migration**

Run from repo root:

```bash
pnpm --filter @jdm/db prisma migrate dev --name events_catalog
```

> note: used `pnpm --filter @jdm/db exec prisma migrate dev --name events_catalog` (no `prisma` npm script exists). Migration folder: `20260419204258_events_catalog`.

Expected: new folder under `packages/db/prisma/migrations/<timestamp>_events_catalog/` containing `migration.sql` with `CREATE TYPE "EventType"`, `CREATE TYPE "EventStatus"`, `CREATE TABLE "Event"`, `CREATE TABLE "TicketTier"`, and the two `CREATE INDEX` statements. Prisma client is regenerated automatically.

- [x] **Step 3: Verify typecheck passes across the monorepo**

Run:

```bash
pnpm -w typecheck
```

Expected: all 6 packages clean.

> note: 5 packages have a typecheck script (`@jdm/tsconfig` is config-only); all 5 pass.

- [x] **Step 4: Commit**

```bash
git checkout -b feat/f3-events
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add Event + TicketTier models and enums"
```

> note: also first-committed the plan file itself on the new branch as `399d1f0 docs: add F3 events catalog implementation plan`, matching the pattern set by the F2b dev-upload plan.

---

## ✅ Task 2: Shared Zod schemas — events

**Files:**

- Modify: `packages/shared/src/events.ts`

- [x] **Step 1: Replace the stub with the full schema set**

```ts
import { z } from 'zod';

import { stateCodeSchema } from './profile.js';

export const eventTypeSchema = z.enum(['meeting', 'drift', 'other']);
export type EventType = z.infer<typeof eventTypeSchema>;

export const eventStatusSchema = z.enum(['draft', 'published', 'cancelled']);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const eventWindowSchema = z.enum(['upcoming', 'past', 'all']);
export type EventWindow = z.infer<typeof eventWindowSchema>;

// TicketTier: `remainingCapacity` is server-computed from
// quantityTotal - quantitySold; clients must not derive it.
export const ticketTierSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  quantityTotal: z.number().int().nonnegative(),
  remainingCapacity: z.number().int().nonnegative(),
  salesOpenAt: z.string().datetime().nullable(),
  salesCloseAt: z.string().datetime().nullable(),
  sortOrder: z.number().int(),
});
export type TicketTier = z.infer<typeof ticketTierSchema>;

// List item — lightweight, no tiers.
export const eventSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).max(140),
  title: z.string().min(1).max(140),
  coverUrl: z.string().url().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  venueName: z.string(),
  city: z.string(),
  stateCode: stateCodeSchema,
  type: eventTypeSchema,
});
export type EventSummary = z.infer<typeof eventSummarySchema>;

// Detail — full payload with tiers + venue geo.
export const eventDetailSchema = eventSummarySchema.extend({
  description: z.string(),
  venueAddress: z.string(),
  lat: z.number(),
  lng: z.number(),
  capacity: z.number().int().nonnegative(),
  tiers: z.array(ticketTierSchema),
});
export type EventDetail = z.infer<typeof eventDetailSchema>;

// Query: all filters optional. cursor is opaque base64 string.
export const eventListQuerySchema = z.object({
  window: eventWindowSchema.default('upcoming'),
  type: eventTypeSchema.optional(),
  stateCode: stateCodeSchema.optional(),
  city: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type EventListQuery = z.infer<typeof eventListQuerySchema>;

export const eventListResponseSchema = z.object({
  items: z.array(eventSummarySchema),
  nextCursor: z.string().nullable(),
});
export type EventListResponse = z.infer<typeof eventListResponseSchema>;
```

- [x] **Step 2: Confirm typecheck**

```bash
pnpm --filter @jdm/shared typecheck
```

Expected: clean.

- [x] **Step 3: Commit**

```bash
git add packages/shared/src/events.ts
git commit -m "feat(shared): add event zod schemas (summary, detail, list query)"
```

> note: follow-up `style(shared): drop em-dashes from events.ts comments` applied after code review.

---

## ✅ Task 3: API — GET /events (list with filters, window, cursor pagination) — TDD

**Files:**

- Create: `apps/api/src/routes/events.ts`
- Modify: `apps/api/src/app.ts` (register route)
- Modify: `apps/api/test/helpers.ts` (extend `resetDatabase`)
- Create: `apps/api/test/events/list.test.ts`

- [x] **Step 1: Extend `resetDatabase`**

Edit `apps/api/test/helpers.ts`, adding `ticketTier` and `event` deletes before `carPhoto`:

```ts
export const resetDatabase = async (): Promise<void> => {
  await prisma.ticketTier.deleteMany();
  await prisma.event.deleteMany();
  await prisma.carPhoto.deleteMany();
  await prisma.car.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.authProvider.deleteMany();
  await prisma.user.deleteMany();
};
```

- [x] **Step 2: Write failing tests** — create `apps/api/test/events/list.test.ts`

```ts
import { prisma } from '@jdm/db';
import { eventListResponseSchema } from '@jdm/shared/events';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

const makeEvent = async (
  overrides: Partial<{
    slug: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    status: 'draft' | 'published' | 'cancelled';
    type: 'meeting' | 'drift' | 'other';
    stateCode: string;
    city: string;
  }> = {},
) => {
  return prisma.event.create({
    data: {
      slug: overrides.slug ?? `e-${Math.random().toString(36).slice(2, 8)}`,
      title: overrides.title ?? 'Encontro',
      description: 'desc',
      startsAt: overrides.startsAt ?? new Date(Date.now() + 7 * 86400_000),
      endsAt: overrides.endsAt ?? new Date(Date.now() + 7 * 86400_000 + 3600_000),
      venueName: 'Autódromo',
      venueAddress: 'Rua X, 100',
      lat: -23.55,
      lng: -46.63,
      city: overrides.city ?? 'São Paulo',
      stateCode: overrides.stateCode ?? 'SP',
      type: overrides.type ?? 'meeting',
      status: overrides.status ?? 'published',
      capacity: 100,
      publishedAt: overrides.status === 'draft' ? null : new Date(),
    },
  });
};

describe('GET /events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns published upcoming events sorted by startsAt ASC', async () => {
    const soon = await makeEvent({ slug: 'soon', startsAt: new Date(Date.now() + 2 * 86400_000) });
    const later = await makeEvent({
      slug: 'later',
      startsAt: new Date(Date.now() + 10 * 86400_000),
    });
    await makeEvent({
      slug: 'past',
      startsAt: new Date(Date.now() - 86400_000),
      endsAt: new Date(Date.now() - 43200_000),
    });
    await makeEvent({ slug: 'draft', status: 'draft' });

    const res = await app.inject({ method: 'GET', url: '/events' });
    expect(res.statusCode).toBe(200);
    const body = eventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug)).toEqual([soon.slug, later.slug]);
    expect(body.nextCursor).toBeNull();
  });

  it('window=past returns only past events, DESC by startsAt', async () => {
    const old = await makeEvent({
      slug: 'old',
      startsAt: new Date(Date.now() - 30 * 86400_000),
      endsAt: new Date(Date.now() - 29 * 86400_000),
    });
    const recent = await makeEvent({
      slug: 'recent',
      startsAt: new Date(Date.now() - 2 * 86400_000),
      endsAt: new Date(Date.now() - 86400_000),
    });
    await makeEvent({ slug: 'future' });

    const res = await app.inject({ method: 'GET', url: '/events?window=past' });
    const body = eventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug)).toEqual([recent.slug, old.slug]);
  });

  it('window=all returns both, ASC by startsAt', async () => {
    await makeEvent({
      slug: 'a',
      startsAt: new Date(Date.now() - 86400_000),
      endsAt: new Date(Date.now() - 3600_000),
    });
    await makeEvent({ slug: 'b', startsAt: new Date(Date.now() + 86400_000) });
    const res = await app.inject({ method: 'GET', url: '/events?window=all' });
    const body = eventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug)).toEqual(['a', 'b']);
  });

  it('filters by stateCode and type', async () => {
    await makeEvent({ slug: 'sp-meet', stateCode: 'SP', type: 'meeting' });
    await makeEvent({ slug: 'rj-meet', stateCode: 'RJ', type: 'meeting' });
    await makeEvent({ slug: 'sp-drift', stateCode: 'SP', type: 'drift' });

    const res = await app.inject({ method: 'GET', url: '/events?stateCode=SP&type=meeting' });
    const body = eventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug)).toEqual(['sp-meet']);
  });

  it('paginates with cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await makeEvent({ slug: `p-${i}`, startsAt: new Date(Date.now() + (i + 1) * 86400_000) });
    }
    const first = await app.inject({ method: 'GET', url: '/events?limit=2' });
    const firstBody = eventListResponseSchema.parse(first.json());
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/events?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
    });
    const secondBody = eventListResponseSchema.parse(second.json());
    expect(secondBody.items).toHaveLength(2);
    expect(secondBody.items[0]!.slug).not.toBe(firstBody.items[0]!.slug);
  });

  it('rejects invalid stateCode with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/events?stateCode=XX' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [x] **Step 3: Run tests to confirm failure**

```bash
pnpm --filter @jdm/api test -- events/list.test.ts
```

Expected: FAIL — route not registered / 404s.

- [x] **Step 4: Implement `apps/api/src/routes/events.ts`**

```ts
import { prisma } from '@jdm/db';
import {
  eventListQuerySchema,
  eventListResponseSchema,
  eventSummarySchema,
} from '@jdm/shared/events';
import type { Event as DbEvent } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import type { Uploads } from '../services/uploads/index.js';

const encodeCursor = (e: Pick<DbEvent, 'startsAt' | 'id'>): string =>
  Buffer.from(JSON.stringify({ s: e.startsAt.toISOString(), i: e.id })).toString('base64url');

const decodeCursor = (raw: string): { startsAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { s: string; i: string };
  return { startsAt: new Date(parsed.s), id: parsed.i };
};

const serializeSummary = (e: DbEvent, uploads: Uploads) =>
  eventSummarySchema.parse({
    id: e.id,
    slug: e.slug,
    title: e.title,
    coverUrl: e.coverObjectKey ? uploads.buildPublicUrl(e.coverObjectKey) : null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    venueName: e.venueName,
    city: e.city,
    stateCode: e.stateCode,
    type: e.type,
  });

// eslint-disable-next-line @typescript-eslint/require-await
export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get('/events', async (request, reply) => {
    const parsed = eventListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', issues: parsed.error.flatten() });
    }
    const { window, type, stateCode, city, cursor, limit } = parsed.data;
    const now = new Date();

    const where: Record<string, unknown> = { status: 'published' };
    if (type) where.type = type;
    if (stateCode) where.stateCode = stateCode;
    if (city) where.city = city;
    if (window === 'upcoming') where.endsAt = { gte: now };
    else if (window === 'past') where.endsAt = { lt: now };

    const asc = window !== 'past';
    const orderBy = [{ startsAt: asc ? 'asc' : 'desc' }, { id: asc ? 'asc' : 'desc' }] as const;

    if (cursor) {
      try {
        const { startsAt, id } = decodeCursor(cursor);
        const cmp = asc ? 'gt' : 'lt';
        where.OR = [{ startsAt: { [cmp]: startsAt } }, { startsAt, id: { [cmp]: id } }];
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
    }

    const rows = await prisma.event.findMany({
      where,
      orderBy: [...orderBy],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return eventListResponseSchema.parse({
      items: page.map((e) => serializeSummary(e, app.uploads)),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  });
};
```

- [x] **Step 5: Register route in `apps/api/src/app.ts`**

Add the import near the other route imports:

```ts
import { eventRoutes } from './routes/events.js';
```

And register it after `carRoutes` (order matters for readability only):

```ts
await app.register(carRoutes);
await app.register(eventRoutes);
```

- [x] **Step 6: Run tests to confirm pass**

```bash
pnpm --filter @jdm/api test -- events/list.test.ts
```

Expected: all 6 tests PASS.

- [x] **Step 7: Run full API suite + monorepo typecheck**

```bash
pnpm --filter @jdm/api test
pnpm -w typecheck
```

Expected: green across the board (prior 70 tests + new 6 = 76).

- [x] **Step 8: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/app.ts \
        apps/api/test/helpers.ts apps/api/test/events/list.test.ts
git commit -m "feat(api): GET /events with filters, window, cursor pagination"
```

> note: follow-up `99648de refactor(api): use Prisma.EventWhereInput and unify validation error shape` applied after code review (typed `where`, switched to `.parse` + global ZodError handler, added 2 tests: last-page null cursor, in-progress event included under window=upcoming).

---

## ✅ Task 4: API — GET /events/:slug (detail with tiers) — TDD

**Files:**

- Modify: `apps/api/src/routes/events.ts`
- Create: `apps/api/test/events/detail.test.ts`

- [x] **Step 1: Write failing tests** — `apps/api/test/events/detail.test.ts`

```ts
import { prisma } from '@jdm/db';
import { eventDetailSchema } from '@jdm/shared/events';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

describe('GET /events/:slug', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the published event with tiers and remaining capacity', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'encontro-sp',
        title: 'Encontro SP',
        description: 'Um belo encontro',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'Autódromo',
        venueAddress: 'Rua X, 100',
        lat: -23.55,
        lng: -46.63,
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        status: 'published',
        capacity: 200,
        publishedAt: new Date(),
        tiers: {
          create: [
            { name: 'Geral', priceCents: 5000, quantityTotal: 100, quantitySold: 10, sortOrder: 0 },
            { name: 'VIP', priceCents: 15000, quantityTotal: 20, quantitySold: 0, sortOrder: 1 },
          ],
        },
      },
    });

    const res = await app.inject({ method: 'GET', url: `/events/${event.slug}` });
    expect(res.statusCode).toBe(200);
    const body = eventDetailSchema.parse(res.json());
    expect(body.slug).toBe('encontro-sp');
    expect(body.tiers).toHaveLength(2);
    const general = body.tiers.find((t) => t.name === 'Geral');
    expect(general?.remainingCapacity).toBe(90);
    const vip = body.tiers.find((t) => t.name === 'VIP');
    expect(vip?.remainingCapacity).toBe(20);
  });

  it('returns tiers in sortOrder', async () => {
    await prisma.event.create({
      data: {
        slug: 'sorted',
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
        status: 'published',
        capacity: 10,
        publishedAt: new Date(),
        tiers: {
          create: [
            { name: 'B', priceCents: 100, quantityTotal: 5, sortOrder: 1 },
            { name: 'A', priceCents: 200, quantityTotal: 5, sortOrder: 0 },
          ],
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/events/sorted' });
    const body = eventDetailSchema.parse(res.json());
    expect(body.tiers.map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('returns 404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/events/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for draft event (draft not publicly visible)', async () => {
    await prisma.event.create({
      data: {
        slug: 'draft-one',
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
        status: 'draft',
        capacity: 10,
      },
    });
    const res = await app.inject({ method: 'GET', url: '/events/draft-one' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [x] **Step 2: Run tests to confirm failure**

```bash
pnpm --filter @jdm/api test -- events/detail.test.ts
```

Expected: FAIL (404 on all because route doesn't exist yet).

> note: 2 happy-path tests failed as expected; 2 404-case tests happened to pass pre-implementation because Fastify's default NotFound handler returned 404 for any unrouted path.

- [x] **Step 3: Extend `apps/api/src/routes/events.ts` with the detail route**

Add inside `eventRoutes` after the list handler. Also add imports + helpers at the top of the file:

```ts
// add to imports:
import { eventDetailSchema, ticketTierSchema } from '@jdm/shared/events';
import type { Event as DbEvent, TicketTier as DbTier } from '@prisma/client';

// add helper above eventRoutes:
const serializeTier = (t: DbTier) =>
  ticketTierSchema.parse({
    id: t.id,
    name: t.name,
    priceCents: t.priceCents,
    currency: t.currency,
    quantityTotal: t.quantityTotal,
    remainingCapacity: Math.max(0, t.quantityTotal - t.quantitySold),
    salesOpenAt: t.salesOpenAt?.toISOString() ?? null,
    salesCloseAt: t.salesCloseAt?.toISOString() ?? null,
    sortOrder: t.sortOrder,
  });

const serializeDetail = (e: DbEvent & { tiers: DbTier[] }, uploads: Uploads) =>
  eventDetailSchema.parse({
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
    tiers: e.tiers
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(serializeTier),
  });

// inside eventRoutes, after the list handler:
app.get('/events/:slug', async (request, reply) => {
  const { slug } = request.params as { slug: string };
  const event = await prisma.event.findFirst({
    where: { slug, status: 'published' },
    include: { tiers: true },
  });
  if (!event) return reply.status(404).send({ error: 'NotFound' });
  return serializeDetail(event, app.uploads);
});
```

- [x] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @jdm/api test -- events/detail.test.ts
```

Expected: all 4 tests PASS.

- [x] **Step 5: Run full suite + typecheck**

```bash
pnpm --filter @jdm/api test
pnpm -w typecheck
```

Expected: 80 tests pass, all packages typecheck clean.

> note: full suite lands at 82 passing (77 from Task 3 + 4 detail + 1 cancelled-404 follow-up).

- [x] **Step 6: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/test/events/detail.test.ts
git commit -m "feat(api): GET /events/:slug with tiers and remaining capacity"
```

> note: follow-up `16605d4 test(api): cover status=cancelled 404 on /events/:slug` added per code review (pin-test for cancelled events).

---

## ✅ Task 5: Prisma seed — sample events

**Files:**

- Create: `packages/db/prisma/seed.ts`
- Modify: `packages/db/package.json`

- [x] **Step 1: Create `packages/db/prisma/seed.ts`**

> note: em-dashes in the planned title/venue/placeholder strings were replaced with `:`, `,`, `-` per CLAUDE.md's no-em-dash rule. `eslint-disable-next-line no-console` directives were omitted (no `no-console` rule in project ESLint config; unused directives would be flagged). Also had to extend `packages/db/tsconfig.json` `include` to `["src/**/*", "prisma/**/*"]` for ESLint `projectService` to type-check the seed file.

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

const events = [
  {
    slug: 'encontro-jdm-sp-2026-05',
    title: 'Encontro JDM São Paulo — Maio',
    description: 'Domingo de exposição e rolê no autódromo. Traga seu carro e venha curtir.',
    startsAt: daysFromNow(14),
    endsAt: daysFromNow(14),
    venueName: 'Autódromo de Interlagos',
    venueAddress: 'Av. Senador Teotônio Vilela, 261 — Interlagos',
    lat: -23.7014,
    lng: -46.6973,
    city: 'São Paulo',
    stateCode: 'SP',
    type: 'meeting' as const,
    status: 'published' as const,
    capacity: 500,
    tiers: [
      { name: 'Pista', priceCents: 4000, quantityTotal: 400, sortOrder: 0 },
      { name: 'VIP', priceCents: 12000, quantityTotal: 50, sortOrder: 1 },
    ],
  },
  {
    slug: 'drift-day-curitiba-2026-06',
    title: 'Drift Day Curitiba',
    description: 'Sessão de drift aberta a inscritos. Vagas limitadas.',
    startsAt: daysFromNow(30),
    endsAt: daysFromNow(30),
    venueName: 'Autódromo Internacional de Curitiba',
    venueAddress: 'Av. Victor Ferreira do Amaral, 3700',
    lat: -25.4102,
    lng: -49.213,
    city: 'Curitiba',
    stateCode: 'PR',
    type: 'drift' as const,
    status: 'published' as const,
    capacity: 80,
    tiers: [{ name: 'Piloto', priceCents: 35000, quantityTotal: 80, sortOrder: 0 }],
  },
  {
    slug: 'encontro-jdm-rj-2026-03',
    title: 'Encontro JDM Rio — Março (encerrado)',
    description: 'Edição anterior.',
    startsAt: daysFromNow(-30),
    endsAt: daysFromNow(-30),
    venueName: 'Aterro do Flamengo',
    venueAddress: 'Av. Infante Dom Henrique',
    lat: -22.9285,
    lng: -43.1712,
    city: 'Rio de Janeiro',
    stateCode: 'RJ',
    type: 'meeting' as const,
    status: 'published' as const,
    capacity: 300,
    tiers: [{ name: 'Geral', priceCents: 3000, quantityTotal: 300, sortOrder: 0 }],
  },
  {
    slug: 'rascunho-secreto',
    title: 'Rascunho (não deve aparecer)',
    description: 'Evento em rascunho.',
    startsAt: daysFromNow(60),
    endsAt: daysFromNow(60),
    venueName: '—',
    venueAddress: '—',
    lat: 0,
    lng: 0,
    city: 'São Paulo',
    stateCode: 'SP',
    type: 'other' as const,
    status: 'draft' as const,
    capacity: 10,
    tiers: [{ name: 'Geral', priceCents: 0, quantityTotal: 10, sortOrder: 0 }],
  },
];

const main = async (): Promise<void> => {
  for (const e of events) {
    const { tiers, ...rest } = e;
    await prisma.event.upsert({
      where: { slug: rest.slug },
      update: {},
      create: {
        ...rest,
        publishedAt: rest.status === 'published' ? new Date() : null,
        tiers: { create: tiers },
      },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${events.length} events.`);
};

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
```

- [x] **Step 2: Wire seed into `packages/db/package.json`**

Check current contents:

```bash
cat packages/db/package.json
```

Add a `prisma` block and a `db:seed` script. If `tsx` isn't already a devDep, add it. Example edits (merge into existing JSON):

```jsonc
{
  // ...
  "scripts": {
    "typecheck": "tsc --noEmit",
    "db:seed": "tsx prisma/seed.ts",
    // ... existing scripts stay
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts",
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    // ... existing stay
  },
}
```

- [x] **Step 3: Install + run the seed against a local DB**

```bash
pnpm install
pnpm --filter @jdm/db db:seed
```

Expected: `Seeded 4 events.` and four rows visible in Prisma Studio.

- [x] **Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts packages/db/package.json pnpm-lock.yaml
git commit -m "chore(db): add dev seed script with sample events"
```

> note: follow-up `fix(db): refresh time fields on seed re-run and use accurate Curitiba coords` — `upsert.update` now rewrites `startsAt`/`endsAt`/`status`/`publishedAt` so the seed stays "upcoming" across days; Curitiba lat/lng and address corrected to the Pinhais track location.

---

## ✅ Task 6: Mobile — events API client

**Files:**

- Create: `apps/mobile/src/api/events.ts`

- [x] **Step 1: Create the client**

```ts
import {
  type EventDetail,
  eventDetailSchema,
  type EventListQuery,
  type EventListResponse,
  eventListResponseSchema,
} from '@jdm/shared/events';

import { request } from './client';

const buildQueryString = (q: Partial<EventListQuery>): string => {
  const params = new URLSearchParams();
  if (q.window) params.set('window', q.window);
  if (q.type) params.set('type', q.type);
  if (q.stateCode) params.set('stateCode', q.stateCode);
  if (q.city) params.set('city', q.city);
  if (q.cursor) params.set('cursor', q.cursor);
  if (q.limit) params.set('limit', String(q.limit));
  const s = params.toString();
  return s ? `?${s}` : '';
};

export const listEvents = (q: Partial<EventListQuery> = {}): Promise<EventListResponse> =>
  request(`/events${buildQueryString(q)}`, eventListResponseSchema);

export const getEvent = (slug: string): Promise<EventDetail> =>
  request(`/events/${encodeURIComponent(slug)}`, eventDetailSchema);
```

- [x] **Step 2: Typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
```

Expected: clean.

- [x] **Step 3: Commit**

```bash
git add apps/mobile/src/api/events.ts
git commit -m "feat(mobile): add events API client"
```

---

## ✅ Task 7: Mobile — events copy + formatting helpers

**Files:**

- Create: `apps/mobile/src/copy/events.ts`
- Create: `apps/mobile/src/lib/format.ts`

- [x] **Step 1: Create `apps/mobile/src/copy/events.ts`**

```ts
export const eventsCopy = {
  tabs: {
    upcoming: 'Próximos',
    past: 'Anteriores',
    nearby: 'Perto de mim',
  },
  filters: {
    title: 'Filtros',
    stateAll: 'Todos os estados',
    typeAll: 'Todos os tipos',
    typeMeeting: 'Encontro',
    typeDrift: 'Drift',
    typeOther: 'Outro',
    apply: 'Aplicar',
    clear: 'Limpar',
  },
  list: {
    empty: 'Nenhum evento encontrado.',
    loadMore: 'Carregar mais',
    refreshing: 'Atualizando…',
  },
  detail: {
    venue: 'Local',
    openMaps: 'Abrir no mapa',
    tiers: 'Ingressos',
    remaining: 'disponíveis',
    soldOut: 'Esgotado',
    buy: 'Comprar',
    buyDisabled: 'Em breve',
    back: 'Voltar',
  },
  errors: {
    load: 'Não foi possível carregar os eventos.',
    network: 'Sem conexão. Tente novamente.',
    notFound: 'Evento não encontrado.',
  },
};
```

- [x] **Step 2: Create `apps/mobile/src/lib/format.ts`**

```ts
export const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatEventDateRange = (startsAtIso: string, endsAtIso: string): string => {
  const start = new Date(startsAtIso);
  const end = new Date(endsAtIso);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${dateFmt.format(start)} – ${timeFmt.format(end)}`;
  }
  return `${dateFmt.format(start)} – ${dateFmt.format(end)}`;
};
```

- [x] **Step 3: Typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
git add apps/mobile/src/copy/events.ts apps/mobile/src/lib/format.ts
git commit -m "feat(mobile): add events copy (PT-BR) and format helpers"
```

---

## ✅ Task 8: Mobile — switch `(app)` to tab layout with Events tab

**Files:**

- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Create: `apps/mobile/app/(app)/events/_layout.tsx`

- [x] **Step 1: Replace `(app)/_layout.tsx` with Tabs**

> note: extra `(app)/garage/_layout.tsx` Stack wrapper added in the same commit — switching (app) to Tabs collapsed the implicit Stack that nested garage screens relied on. Also added a follow-up `fix(mobile): avoid double headers` setting Tabs `headerShown: false` (per-screen override on profile, which has no inner Stack).

```tsx
import { Tabs } from 'expo-router';

export default function AppLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="events" options={{ title: 'Eventos' }} />
      <Tabs.Screen name="garage" options={{ title: 'Garagem' }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil' }} />
    </Tabs>
  );
}
```

- [x] **Step 2: Create `apps/mobile/app/(app)/events/_layout.tsx`** so the list+detail stack sits under the tab

```tsx
import { Stack } from 'expo-router';

export default function EventsLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
```

- [x] **Step 3: Typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
git add apps/mobile/app/\(app\)/_layout.tsx apps/mobile/app/\(app\)/events/_layout.tsx
git commit -m "feat(mobile): introduce bottom tabs with events, garage, profile"
```

> note: final commit message used was `feat(mobile): switch (app) to bottom tabs with events, garage, profile`.

---

## ✅ Task 9: Mobile — events list screen

**Files:**

- Create: `apps/mobile/app/(app)/events/index.tsx`

- [x] **Step 1: Implement the list screen**

> notes:
>
> - Plan's `meAuthed` reference → actual export is `getProfile` in `apps/mobile/src/api/profile.ts`.
> - `myState` stored as `StateCode | null | undefined` (not `string | null`) so enum narrowing flows into `listEvents`.
> - `RefreshControl onRefresh` wrapped in a sync void arrow to satisfy `@typescript-eslint/no-misused-promises`.
> - Follow-up `fix(mobile): set events stack titles and drop redundant state coalesce` added titles to `events/_layout.tsx` (`index` → "Eventos", `[slug]` → blank so detail screen can set its own) and removed a redundant `?? undefined` call flagged in code review.

```tsx
import type { EventSummary, EventWindow } from '@jdm/shared/events';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { listEvents } from '~/api/events';
import { meAuthed } from '~/api/profile';
import { eventsCopy } from '~/copy/events';
import { formatEventDateRange } from '~/lib/format';
import { theme } from '~/theme';

type TabKey = 'upcoming' | 'past' | 'nearby';

const windowFor = (tab: TabKey): EventWindow => (tab === 'past' ? 'past' : 'upcoming');

export default function EventsIndex() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('upcoming');
  const [items, setItems] = useState<EventSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [myState, setMyState] = useState<string | null>(null);

  const load = useCallback(
    async (nextTab: TabKey) => {
      const stateCode = nextTab === 'nearby' ? (myState ?? undefined) : undefined;
      const res = await listEvents({ window: windowFor(nextTab), stateCode });
      setItems(res.items);
    },
    [myState],
  );

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        // Load current user to prefill "Perto de mim" with their stateCode.
        if (myState === null) {
          try {
            const me = await meAuthed();
            setMyState(me.stateCode ?? '');
          } catch {
            setMyState('');
          }
        }
        await load(tab);
      })();
    }, [tab, load, myState]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(tab);
    } finally {
      setRefreshing(false);
    }
  }, [load, tab]);

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['upcoming', 'past', 'nearby'] as TabKey[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {eventsCopy.tabs[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{eventsCopy.list.empty}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/events/${item.slug}` as never)}
            >
              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={styles.cover} />
              ) : (
                <View style={[styles.cover, styles.coverPlaceholder]} />
              )}
              <View style={styles.cardText}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.sub}>{formatEventDateRange(item.startsAt, item.endsAt)}</Text>
                <Text style={styles.sub}>
                  {item.venueName} — {item.city}/{item.stateCode}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  tabs: {
    flexDirection: 'row',
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  tab: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.border,
  },
  tabActive: { backgroundColor: theme.colors.fg },
  tabLabel: { color: theme.colors.fg },
  tabLabelActive: { color: theme.colors.bg, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: theme.colors.muted },
  list: { gap: theme.spacing.md, padding: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.border,
    borderRadius: theme.radii.md,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: 160 },
  coverPlaceholder: { backgroundColor: theme.colors.muted },
  cardText: { padding: theme.spacing.md, gap: theme.spacing.xs },
  title: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  sub: { color: theme.colors.muted },
});
```

> **Note:** If `meAuthed` is exported under a different name in `~/api/profile`, adjust the import. The plan assumes F2's mobile profile client exports an authed `GET /me` helper (mentioned in observation 387). Verify with `grep -n meAuthed apps/mobile/src/api/profile.ts` before Step 1 and rename if needed.

- [-] **Step 2: Manual smoke test**

Start API + mobile locally; open the app, sign in, and confirm the Events tab lists the 3 published seeded events with correct dates and state codes. Switch to "Anteriores" — the March RJ event shows. Switch to "Perto de mim" with profile state=SP — only SP events show.

> note: skipped per user rule (no background shells / autonomous verification). Typecheck stands in for the verification gate.

- [x] **Step 3: Typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
git add apps/mobile/app/\(app\)/events/index.tsx
git commit -m "feat(mobile): events list screen with tabs, filters, pull-to-refresh"
```

---

## ✅ Task 10: Mobile — event detail screen

**Files:**

- Create: `apps/mobile/app/(app)/events/[slug].tsx`
- Modify: `apps/mobile/src/components/Button.tsx` (added `disabled` prop)

- [x] **Step 1: Implement the detail screen**

```tsx
import type { EventDetail } from '@jdm/shared/events';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getEvent } from '~/api/events';
import { Button } from '~/components/Button';
import { eventsCopy } from '~/copy/events';
import { formatBRL, formatEventDateRange } from '~/lib/format';
import { theme } from '~/theme';

export default function EventDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      try {
        setEvent(await getEvent(slug));
      } catch {
        setError(eventsCopy.errors.notFound);
      }
    })();
  }, [slug]);

  const openMap = (e: EventDetail) => {
    const q = encodeURIComponent(`${e.venueName}, ${e.venueAddress}`);
    const url = `https://www.google.com/maps/search/?api=1&query=${q}&ll=${e.lat},${e.lng}`;
    void Linking.openURL(url);
  };

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!event) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {event.coverUrl ? (
        <Image source={{ uri: event.coverUrl }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]} />
      )}
      <View style={styles.section}>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.sub}>{formatEventDateRange(event.startsAt, event.endsAt)}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>{eventsCopy.detail.venue}</Text>
        <Text style={styles.body}>{event.venueName}</Text>
        <Text style={styles.sub}>
          {event.venueAddress} - {event.city}/{event.stateCode}
        </Text>
        <Pressable onPress={() => openMap(event)} style={styles.mapButton}>
          <Text style={styles.mapLabel}>{eventsCopy.detail.openMaps}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.body}>{event.description}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>{eventsCopy.detail.tiers}</Text>
        {event.tiers.map((t) => {
          const soldOut = t.remainingCapacity === 0;
          return (
            <View key={t.id} style={styles.tier}>
              <View style={styles.tierTop}>
                <Text style={styles.tierName}>{t.name}</Text>
                <Text style={styles.tierPrice}>{formatBRL(t.priceCents)}</Text>
              </View>
              <Text style={styles.sub}>
                {soldOut
                  ? eventsCopy.detail.soldOut
                  : `${t.remainingCapacity} ${eventsCopy.detail.remaining}`}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Button label={eventsCopy.detail.buyDisabled} onPress={() => undefined} disabled />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: theme.spacing.xl, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cover: { width: '100%', height: 220 },
  coverPlaceholder: { backgroundColor: theme.colors.border },
  section: { padding: theme.spacing.lg, gap: theme.spacing.xs },
  title: { color: theme.colors.fg, fontSize: theme.font.size.lg, fontWeight: '700' },
  h2: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  body: { color: theme.colors.fg, fontSize: theme.font.size.md },
  sub: { color: theme.colors.muted },
  error: { color: theme.colors.muted },
  mapButton: {
    marginTop: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.border,
    alignSelf: 'flex-start',
  },
  mapLabel: { color: theme.colors.fg },
  tier: {
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
  tierTop: { flexDirection: 'row', justifyContent: 'space-between' },
  tierName: { color: theme.colors.fg, fontWeight: '600' },
  tierPrice: { color: theme.colors.fg },
});
```

> **Note:** If `Button` doesn't accept a `disabled` prop, extend it with an optional `disabled?: boolean` that applies `opacity: 0.5` and blocks `onPress`. Verify in `apps/mobile/src/components/Button.tsx` before Step 1.

> note: Button did not accept `disabled`. Extended with `disabled?: boolean`: sets `Pressable` `disabled`, `accessibilityState.disabled`, and `opacity: 0.5` when true. Also swapped the em-dash separator in the venue line for a plain ASCII `-` per CLAUDE.md formatting rules.

- [-] **Step 2: Manual smoke test**

Skipped per user rule (no autonomous verification / background shells). Typecheck stands in.

- [x] **Step 3: Typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
git add apps/mobile/app/\(app\)/events/\[slug\].tsx apps/mobile/src/components/Button.tsx
git commit -m "feat(mobile): event detail screen with tiers, map link, disabled buy CTA"
```

---

## ✅ Task 11: Roadmap + handoff updates

**Files:**

- Modify: `plans/roadmap.md`
- Modify: `handoff.md`

- [x] **Step 1: Flip roadmap statuses on branch start**

In `plans/roadmap.md`, change the checkbox on each of 3.1, 3.2, 3.3, 3.4, 3.5 from `[ ]` to `[~]` with a note referencing the PR once it's open. Example for 3.1:

```markdown
#### 3.1 Schema: Event + enums

- [~] **Scope:** Event model; event type + status enums; indexes on
  (state, city, starts*at), (status, starts_at). *(on feat/f3-events)\_
- **Done when:** migration green.
```

Do the same for 3.2–3.5. **Do not** mark them `[x]` — that happens only after merge-to-main + Railway/EAS deploy, per the file's own rules.

- [x] **Step 2: Rewrite `handoff.md`**

Replace the F2 handoff with an F3 handoff summarizing:

1. Branch: `feat/f3-events`.
2. What shipped: 2 API routes, shared Zod schemas, 1 migration, seed script, mobile tabs + list + detail.
3. How to run: `pnpm --filter @jdm/db db:seed`, then start API + Expo.
4. Test status: full API suite green at NN tests; mobile typecheck clean.
5. Known next steps: F7a will add admin event CRUD; F4 will wire the Buy CTA and add `Order`/`Ticket` models.
6. Open edges: no real geolocation for "Perto de mim" — currently uses profile state code.

- [-] **Step 3: Commit**

```bash
git add plans/roadmap.md handoff.md
git commit -m "docs: mark roadmap 3.1-3.5 in-progress; update handoff for F3"
```

> note: skipped — `plans/roadmap.md` and `handoff.md` are in `.git/info/exclude` per CLAUDE.md (local-only). Edits live on disk for this session but aren't tracked. The plan file itself was updated in place and its edits rode along with the feature commits.

---

## Task 12: Final verification before PR

- [ ] **Step 1: Full suite**

```bash
pnpm -w typecheck
pnpm --filter @jdm/api test
pnpm --filter @jdm/shared test
pnpm --filter @jdm/mobile typecheck
```

Expected: all green. API tests ≥ 80 passing.

- [ ] **Step 2: Manual end-to-end check**

1. `pnpm --filter @jdm/db db:seed`
2. Start API + Expo mobile
3. Sign in, tap **Eventos** tab
4. See 2 upcoming events ("Próximos")
5. Switch to "Anteriores" — see the RJ March event
6. Open the SP May event — cover, date, tiers render; "Abrir no mapa" opens maps
7. Confirm the draft event is **not** visible anywhere

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin feat/f3-events
gh pr create --title "feat: F3 events catalog (read-only)" --body "$(cat <<'EOF'
## Summary
- Adds Event + TicketTier schema, GET /events (list, filters, cursor), GET /events/:slug (detail + tiers).
- Adds dev seed script with 4 sample events.
- Adds mobile Events tab with list + detail screens.

## Test plan
- [ ] `pnpm -w typecheck` clean
- [ ] `pnpm --filter @jdm/api test` green
- [ ] `pnpm --filter @jdm/db db:seed` populates 4 events locally
- [ ] Events list shows upcoming/past filters; "Perto de mim" uses profile stateCode
- [ ] Detail shows tiers with BRL prices and remaining capacity
- [ ] "Abrir no mapa" launches maps
- [ ] Draft event is hidden from both endpoints

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (run before handoff)

**Spec coverage vs. roadmap 3.1–3.5:**

- 3.1 Schema + enums + indexes → Task 1 ✓
- 3.2 GET /events with filters + cursor pagination → Task 3 ✓
- 3.3 GET /events/:slug with tiers + remaining capacity → Task 4 ✓ (concurrent-purchase correctness is deferred to F4 when Ticket model exists — noted in handoff)
- 3.4 Mobile events list with tabs + pull-to-refresh → Task 9 ✓
- 3.5 Mobile event detail with venue map pin → Task 10 ✓

**Deferred to later features:**

- Admin event CRUD → F7a
- Order/Ticket models + purchase race-condition tests → F4
- `TicketTier.type` enum (general, vip, pit, etc): **F4 must add this**. Current schema has name, price, and quantity but no tier category field. Needed for Stripe metadata and analytics grouping.
- Real geolocation for "Perto de mim" → tracked as open edge in handoff
- Event cover upload by organizers → F7a (uses existing `/uploads/presign` with new `UPLOAD_KINDS` entry)
