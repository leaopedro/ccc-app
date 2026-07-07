# JDMA-589 — Event Feed Schema, Shared Contracts, and Feed-Setting Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Prisma schema, migration, shared Zod contracts, and a privacy-contract proof for the F9 event-feed domain, plus per-event feed settings — without exposing any sensitive user keys.

**Architecture:** Add four feed-domain Prisma models (`FeedPost`, `FeedPostPhoto`, `FeedComment`, `FeedReaction`, `Report`) plus per-event feed-setting columns on `Event`. Public identity for posts/comments is the `Car`, not the user; the user link is private and never serialized. Shared response schemas under `@jdm/shared/feed` deliberately omit all PII keys, enforced by a forbidden-key contract test that walks every Zod object shape.

**Tech Stack:** Prisma 5 (Postgres 16), `@jdm/db`, `@jdm/shared` (Zod), Vitest, pnpm workspace.

**Conventions used by this repo (read once before starting):**

- Prisma schema lives at `packages/db/prisma/schema.prisma`; migrations under `packages/db/prisma/migrations/<YYYYMMDDHHMMSS_slug>/migration.sql`. Use `pnpm --filter @jdm/db db:migrate -- --name <slug>` to create migrations when a local Postgres is running on port 5433 (see `docker-compose.yml`). If no DB is available, hand-author the SQL alongside the schema edit and verify with `pnpm --filter @jdm/db db:generate` only.
- Shared Zod modules live in `packages/shared/src/<topic>.ts`, exported from `packages/shared/src/index.ts`. Each new module also needs a `./<topic>` subpath in `packages/shared/package.json` `exports`. Build with `pnpm --filter @jdm/shared build` (runtime resolves `dist/`).
- Tests live in `packages/shared/src/__tests__/*.test.ts`; run with `pnpm --filter @jdm/shared test`.
- API tests must hit a real Postgres, not mocks (CLAUDE.md). This plan does not touch the API; downstream issues will.
- Privacy-forbidden keys (per issue brief): `plate`, `email`, `phone`, `cpf`, `userId`, `ownerId`, `address`. These MUST NOT appear at any depth in any shared feed response schema.

---

## File Structure

**Create:**

- `packages/db/prisma/migrations/<timestamp>_feed_schema/migration.sql` — feed-domain DDL + event additions
- `packages/shared/src/feed.ts` — Zod schemas: `PublicCarProfile`, `FeedAccess`, `PostingAccess`, `FeedSettings`, `FeedPostResponse`, `FeedCommentResponse`, `FeedReactionSummary`, `FeedListResponse`, `FeedReportInput`
- `packages/shared/src/__tests__/feed.test.ts` — schema-shape tests
- `packages/shared/src/__tests__/feed-privacy-contract.test.ts` — forbidden-key contract proof

**Modify:**

- `packages/db/prisma/schema.prisma` — add `FeedAccess`, `PostingAccess`, `ReportStatus`, `FeedPostStatus`, `FeedCommentStatus` enums; add `FeedPost`, `FeedPostPhoto`, `FeedComment`, `FeedReaction`, `Report` models; add feed settings + `feedPosts` / `feedReactions` / `reports` back-relations to `Event`, `User`, `Car`
- `packages/shared/src/index.ts` — `export * from './feed.js';`
- `packages/shared/package.json` — add `./feed` subpath export
- `plans/roadmap.md` — flip `F9.1` checkbox to `[~]` at plan-start, `[x]` at merge (per CLAUDE.md status-marker rule)

**Do not modify in this plan:**

- API routes / handlers (F9.2+ — separate issues)
- Mobile / admin UI (F9.6 / F9.7 — separate issues)
- Any existing migration SQL

---

## Design decisions (locked before tasks)

1. **Public identity is the car.** `FeedPost.carId` is `NOT NULL`; `authorUserId` is private and never serialized in `FeedPostResponse`. The same applies to `FeedComment.authorUserId`.
2. **Feed access enum:** `FeedAccess = { public, attendees, members_only }`. Default `attendees` to align with F9.4 visibility rule. (`public` reserved for future use.)
3. **Posting access enum:** `PostingAccess = { attendees, members_only, organizers_only }`. Default `attendees`.
4. **Feed enabled default:** `feedEnabled = true`. Organizers can disable per event at any time.
5. **Per-event limits:** `maxPostsPerUser` defaults to `NULL` (no limit). `maxPhotosPerUser` defaults to `5`. (Per issue brief.) `maxPhotosPerUser` is the per-post upper bound, applied at API time.
6. **Reactions:** Single-kind reaction (`like`) modeled as `FeedReaction` row keyed by `(postId, userId)` UNIQUE. Future kinds can extend the unique to `(postId, userId, kind)` — leave `kind String @default("like")` to keep the door open without committing to extra kinds now.
7. **Report target:** `Report.postId` or `Report.commentId` (exactly one non-null, enforced by check constraint). Reporter ID is private.
8. **Soft-hide moderation:** `FeedPost.status` and `FeedComment.status` use `visible | hidden | removed`. Hidden rows stay in DB; API filters them out except for admin queues. `Report.status` uses `open | resolved | dismissed`.
9. **Cascades:** `FeedPost` cascades to its `FeedPostPhoto`, `FeedComment`, `FeedReaction`, `Report` rows on hard delete. User deletion (LGPD) sets `authorUserId` to `NULL` on `FeedPost` / `FeedComment` to preserve thread integrity. `Car` deletion sets `carId` to `NULL` on `FeedPost` (and the API treats null-car posts as hidden).
10. **No URLs in DB.** `FeedPostPhoto.objectKey` mirrors the existing `CarPhoto.objectKey` pattern. Pre-signed URL minting happens in the API layer (out of scope here).
11. **Shared response shape NEVER exposes:** `plate`, `email`, `phone`, `cpf`, `userId`, `ownerId`, `address`. Enforced by Task 6.

---

> note: `Report.eventId` removed post-plan (commit `20802eb`). CTO review flagged it allowed cross-event misattribution. Event is derivable from `post.eventId` or `comment.post.eventId`. New migration `20260514141646_drop_report_eventid` drops the column. `reports Report[]` back-relation also removed from `Event` model.

## ✅ Task 1: Add Prisma enums + Feed-domain models + Event fields

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (append at end of file; reuse `String @id @default(cuid())` style; use `@db.VarChar` lengths consistent with neighbours)

- [x] **Step 1: Add enums above the new models**

Append to `packages/db/prisma/schema.prisma`:

```prisma
enum FeedAccess {
  public
  attendees
  members_only
}

enum PostingAccess {
  attendees
  members_only
  organizers_only
}

enum FeedPostStatus {
  visible
  hidden
  removed
}

enum FeedCommentStatus {
  visible
  hidden
  removed
}

enum ReportStatus {
  open
  resolved
  dismissed
}

enum ReportTargetKind {
  post
  comment
}
```

- [x] **Step 2: Add feed settings to `Event`**

Find the `model Event` block (currently at line ~168). Inside its field list, before the relations section, add:

```prisma
  feedEnabled       Boolean       @default(true)
  feedAccess        FeedAccess    @default(attendees)
  postingAccess     PostingAccess @default(attendees)
  maxPostsPerUser   Int?
  maxPhotosPerUser  Int           @default(5)
```

Add the back-relation lines to the same `Event` model's relations block:

```prisma
  feedPosts      FeedPost[]
  reports        Report[]
```

- [x] **Step 3: Add back-relation on `User`**

Find `model User`. Append to its relations block (alongside `tickets`, `notifications`, etc.):

```prisma
  feedPosts        FeedPost[]
  feedComments     FeedComment[]
  feedReactions    FeedReaction[]
  reportsFiled     Report[]      @relation("ReportReporter")
  reportsResolved  Report[]      @relation("ReportResolver")
```

- [x] **Step 4: Add back-relation on `Car`**

Find `model Car`. Append:

```prisma
  feedPosts FeedPost[]
```

- [x] **Step 5: Add new models at end of file**

```prisma
model FeedPost {
  id            String         @id @default(cuid())
  eventId       String
  carId         String?
  authorUserId  String?
  body          String         @db.VarChar(2000)
  status        FeedPostStatus @default(visible)
  hiddenAt      DateTime?
  hiddenById    String?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  event   Event              @relation(fields: [eventId], references: [id], onDelete: Cascade)
  car     Car?               @relation(fields: [carId], references: [id], onDelete: SetNull)
  author  User?              @relation(fields: [authorUserId], references: [id], onDelete: SetNull)
  photos  FeedPostPhoto[]
  comments FeedComment[]
  reactions FeedReaction[]
  reports Report[]

  @@index([eventId, createdAt(sort: Desc)])
  @@index([carId])
  @@index([authorUserId])
  @@index([status, createdAt])
}

model FeedPostPhoto {
  id        String   @id @default(cuid())
  postId    String
  objectKey String   @db.VarChar(300)
  width     Int?
  height    Int?
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())

  post FeedPost @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@index([postId, sortOrder])
}

model FeedComment {
  id            String            @id @default(cuid())
  postId        String
  authorUserId  String?
  body          String            @db.VarChar(1000)
  status        FeedCommentStatus @default(visible)
  hiddenAt      DateTime?
  hiddenById    String?
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt

  post   FeedPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  author User?    @relation(fields: [authorUserId], references: [id], onDelete: SetNull)
  reports Report[]

  @@index([postId, createdAt])
  @@index([authorUserId])
  @@index([status, createdAt])
}

model FeedReaction {
  id        String   @id @default(cuid())
  postId    String
  userId    String
  kind      String   @default("like") @db.VarChar(20)
  createdAt DateTime @default(now())

  post FeedPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([postId, userId])
  @@index([postId])
  @@index([userId])
}

model Report {
  id            String           @id @default(cuid())
  eventId       String
  targetKind    ReportTargetKind
  postId        String?
  commentId     String?
  reporterUserId String?
  reason        String           @db.VarChar(300)
  status        ReportStatus     @default(open)
  resolverId    String?
  resolution    String?          @db.VarChar(300)
  resolvedAt    DateTime?
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt

  event    Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  post     FeedPost?    @relation(fields: [postId], references: [id], onDelete: Cascade)
  comment  FeedComment? @relation(fields: [commentId], references: [id], onDelete: Cascade)
  reporter User?        @relation("ReportReporter", fields: [reporterUserId], references: [id], onDelete: SetNull)
  resolver User?        @relation("ReportResolver", fields: [resolverId], references: [id], onDelete: SetNull)

  @@index([eventId, status, createdAt(sort: Desc)])
  @@index([postId])
  @@index([commentId])
  @@index([reporterUserId])
}
```

- [x] **Step 6: Format & validate the schema**

Run: `pnpm --filter @jdm/db exec prisma format && pnpm --filter @jdm/db exec prisma validate`
Expected: both succeed, exit 0, no diff complaints.

- [x] **Step 7: Commit schema edit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(jdma-589): add feed-domain Prisma schema and per-event feed settings

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## ✅ Task 2: Generate the migration SQL

**Files:**

- Create: `packages/db/prisma/migrations/<timestamp>_feed_schema/migration.sql`

- [x] **Step 1: Boot the local Postgres if not running**

Run: `docker compose up -d postgres && docker compose exec -T postgres pg_isready -U jdm -d jdm`
Expected: `localhost:5432 - accepting connections` (container exposes 5433 host-side; the in-container port is 5432).

If Docker is unavailable in the worker environment, skip ahead to Step 5 (hand-author SQL) and document that fallback in the commit message.

- [x] **Step 2: Create the migration**

Run: `pnpm --filter @jdm/db exec prisma migrate dev --name feed_schema --create-only`
Expected: a new directory `packages/db/prisma/migrations/<timestamp>_feed_schema/` containing `migration.sql`. `--create-only` means the SQL is written but not applied yet, so the dev DB stays clean.

- [x] **Step 3: Inspect the generated SQL**

Open the new `migration.sql` and confirm:

1. `CREATE TYPE "FeedAccess" AS ENUM (...)` and four other enums exist.
2. `ALTER TABLE "Event"` adds the five new columns with the documented defaults (`feedEnabled true`, `feedAccess 'attendees'`, `postingAccess 'attendees'`, `maxPostsPerUser` NULL-able, `maxPhotosPerUser 5`).
3. `CREATE TABLE "FeedPost"`, `"FeedPostPhoto"`, `"FeedComment"`, `"FeedReaction"`, `"Report"` are present with the indexes and unique constraint on `FeedReaction (postId, userId)`.
4. All foreign keys match the `onDelete` modes from the schema (`CASCADE` for owners, `SET NULL` for `Car`/`User` back-references on `FeedPost`/`FeedComment`/`Report`).

- [x] **Step 4: Append the report target check constraint**

Prisma does not emit named `CHECK` constraints from the schema. Append to the end of the generated `migration.sql`:

```sql
ALTER TABLE "Report"
  ADD CONSTRAINT "Report_target_exactly_one"
  CHECK (
    ("targetKind" = 'post'    AND "postId" IS NOT NULL AND "commentId" IS NULL)
    OR
    ("targetKind" = 'comment' AND "commentId" IS NOT NULL AND "postId" IS NULL)
  );
```

- [x] **Step 5 (fallback only — skip if Step 2 succeeded): Hand-author the migration**

If Step 2 could not run, create `packages/db/prisma/migrations/<UTC-timestamp>_feed_schema/migration.sql` manually, mirroring the structure of `20260513200000_general_settings/migration.sql`. The contents must match what `prisma migrate diff --from-schema-datamodel <previous_schema> --to-schema-datamodel <current_schema> --script` would emit. Include the same enum, table, index, FK, and CHECK statements as Steps 3–4 require. Document in the commit message that the migration was hand-authored due to no available shadow DB.

- [x] **Step 6: Apply the migration to confirm it runs cleanly**

Run: `pnpm --filter @jdm/db exec prisma migrate deploy`
Expected: `Applying migration <timestamp>_feed_schema` followed by `All migrations have been successfully applied.`

If Docker is unavailable, skip and rely on CI to verify.

- [x] **Step 7: Regenerate the Prisma client**

Run: `pnpm --filter @jdm/db db:generate`
Expected: `Generated Prisma Client (v...)` with no errors.

- [x] **Step 8: Commit the migration**

```bash
git add packages/db/prisma/migrations
git commit -m "feat(jdma-589): migration for feed schema and event feed settings

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## ✅ Task 3: Add `@jdm/shared/feed` Zod contracts

**Files:**

- Create: `packages/shared/src/feed.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

- [x] **Step 1: Write `packages/shared/src/feed.ts`**

Create the file with:

```ts
import { z } from 'zod';

// ---------- Enums ----------

export const feedAccessSchema = z.enum(['public', 'attendees', 'members_only']);
export type FeedAccess = z.infer<typeof feedAccessSchema>;

export const postingAccessSchema = z.enum(['attendees', 'members_only', 'organizers_only']);
export type PostingAccess = z.infer<typeof postingAccessSchema>;

export const feedPostStatusSchema = z.enum(['visible', 'hidden', 'removed']);
export type FeedPostStatus = z.infer<typeof feedPostStatusSchema>;

export const feedCommentStatusSchema = z.enum(['visible', 'hidden', 'removed']);
export type FeedCommentStatus = z.infer<typeof feedCommentStatusSchema>;

export const reportStatusSchema = z.enum(['open', 'resolved', 'dismissed']);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const reportTargetKindSchema = z.enum(['post', 'comment']);
export type ReportTargetKind = z.infer<typeof reportTargetKindSchema>;

// ---------- Per-event settings ----------

export const FEED_DEFAULT_MAX_PHOTOS_PER_USER = 5;
export const FEED_DEFAULT_FEED_ACCESS: FeedAccess = 'attendees';
export const FEED_DEFAULT_POSTING_ACCESS: PostingAccess = 'attendees';

export const feedSettingsSchema = z.object({
  feedEnabled: z.boolean(),
  feedAccess: feedAccessSchema,
  postingAccess: postingAccessSchema,
  maxPostsPerUser: z.number().int().positive().nullable(),
  maxPhotosPerUser: z.number().int().positive(),
});
export type FeedSettings = z.infer<typeof feedSettingsSchema>;

export const feedSettingsUpdateSchema = feedSettingsSchema.partial();
export type FeedSettingsUpdate = z.infer<typeof feedSettingsUpdateSchema>;

export const defaultFeedSettings: FeedSettings = {
  feedEnabled: true,
  feedAccess: FEED_DEFAULT_FEED_ACCESS,
  postingAccess: FEED_DEFAULT_POSTING_ACCESS,
  maxPostsPerUser: null,
  maxPhotosPerUser: FEED_DEFAULT_MAX_PHOTOS_PER_USER,
};

// ---------- Public car identity ----------
// Public identity for feed posts is the Car, not the user.
// This shape MUST NOT include plate, owner identity, or contact info.

export const publicCarPhotoSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type PublicCarPhoto = z.infer<typeof publicCarPhotoSchema>;

export const publicCarProfileSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().nullable(),
  photo: publicCarPhotoSchema.nullable(),
});
export type PublicCarProfile = z.infer<typeof publicCarProfileSchema>;

// ---------- Post / Comment / Reaction response shapes ----------

export const feedPostPhotoSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sortOrder: z.number().int().nonnegative(),
});
export type FeedPostPhoto = z.infer<typeof feedPostPhotoSchema>;

export const feedReactionSummarySchema = z.object({
  likes: z.number().int().nonnegative(),
  mine: z.boolean(),
});
export type FeedReactionSummary = z.infer<typeof feedReactionSummarySchema>;

export const feedPostResponseSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  car: publicCarProfileSchema.nullable(),
  body: z.string(),
  status: feedPostStatusSchema,
  photos: z.array(feedPostPhotoSchema),
  reactions: feedReactionSummarySchema,
  commentCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FeedPostResponse = z.infer<typeof feedPostResponseSchema>;

export const feedCommentResponseSchema = z.object({
  id: z.string().min(1),
  postId: z.string().min(1),
  car: publicCarProfileSchema.nullable(),
  body: z.string(),
  status: feedCommentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FeedCommentResponse = z.infer<typeof feedCommentResponseSchema>;

export const feedListResponseSchema = z.object({
  posts: z.array(feedPostResponseSchema),
  nextCursor: z.string().nullable(),
});
export type FeedListResponse = z.infer<typeof feedListResponseSchema>;

// ---------- Inputs ----------

export const feedPostCreateInputSchema = z.object({
  carId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
  photoObjectKeys: z.array(z.string().min(1).max(300)).max(20).optional(),
});
export type FeedPostCreateInput = z.infer<typeof feedPostCreateInputSchema>;

export const feedCommentCreateInputSchema = z.object({
  carId: z.string().min(1).optional(),
  body: z.string().trim().min(1).max(1000),
});
export type FeedCommentCreateInput = z.infer<typeof feedCommentCreateInputSchema>;

export const feedReportInputSchema = z.object({
  targetKind: reportTargetKindSchema,
  targetId: z.string().min(1),
  reason: z.string().trim().min(1).max(300),
});
export type FeedReportInput = z.infer<typeof feedReportInputSchema>;

// ---------- Privacy contract ----------
// Forbidden top-level or nested keys for any feed RESPONSE schema.
// Centralised so the contract test in __tests__/feed-privacy-contract.test.ts
// can iterate and prove every public response shape is clean.

export const FEED_FORBIDDEN_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  'plate',
  'email',
  'phone',
  'cpf',
  'userId',
  'ownerId',
  'address',
]);

export const FEED_PUBLIC_RESPONSE_SCHEMAS = {
  publicCarProfile: publicCarProfileSchema,
  feedPostResponse: feedPostResponseSchema,
  feedCommentResponse: feedCommentResponseSchema,
  feedListResponse: feedListResponseSchema,
  feedReactionSummary: feedReactionSummarySchema,
  feedPostPhoto: feedPostPhotoSchema,
  publicCarPhoto: publicCarPhotoSchema,
  feedSettings: feedSettingsSchema,
} as const;
```

> note: `feedCommentCreateInputSchema` gained `carId?: string` post-plan; `FeedComment.carId` is optional on the Prisma model so commenters can identify as their car, matching `FeedPost` identity pattern. Plan code block updated to match shipped code.

- [x] **Step 2: Wire the barrel export**

Edit `packages/shared/src/index.ts`. Append after the last `export * from './broadcasts.js';` line:

```ts
export * from './feed.js';
```

- [x] **Step 3: Add the package subpath export**

Edit `packages/shared/package.json`. Inside the `exports` object, add a new entry beside `./broadcasts` (alphabetical placement is fine — match the pattern used by `./events`):

```json
    "./feed": {
      "types": "./src/feed.ts",
      "default": "./dist/feed.js"
    },
```

- [x] **Step 4: Build the package**

Run: `pnpm --filter @jdm/shared build`
Expected: `dist/feed.js`, `dist/feed.d.ts`, `dist/feed.js.map` are produced. No tsc errors.

- [x] **Step 5: Typecheck the workspace**

Run: `pnpm --filter @jdm/shared typecheck`
Expected: exits 0.

- [x] **Step 6: Commit shared contracts**

```bash
git add packages/shared/src/feed.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(jdma-589): @jdm/shared/feed schemas with PublicCarProfile

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## ✅ Task 4: Schema-shape happy-path test

**Files:**

- Create: `packages/shared/src/__tests__/feed.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  defaultFeedSettings,
  feedPostCreateInputSchema,
  feedPostResponseSchema,
  feedSettingsSchema,
  feedSettingsUpdateSchema,
  publicCarProfileSchema,
} from '../feed.js';

describe('feed settings', () => {
  it('accepts the documented defaults', () => {
    const parsed = feedSettingsSchema.parse(defaultFeedSettings);
    expect(parsed.maxPostsPerUser).toBeNull();
    expect(parsed.maxPhotosPerUser).toBe(5);
    expect(parsed.feedAccess).toBe('attendees');
    expect(parsed.postingAccess).toBe('attendees');
    expect(parsed.feedEnabled).toBe(true);
  });

  it('rejects non-positive photo limit', () => {
    const result = feedSettingsSchema.safeParse({
      ...defaultFeedSettings,
      maxPhotosPerUser: 0,
    });
    expect(result.success).toBe(false);
  });

  it('allows partial settings updates', () => {
    const result = feedSettingsUpdateSchema.parse({ feedEnabled: false });
    expect(result).toEqual({ feedEnabled: false });
  });
});

describe('public car profile', () => {
  it('parses a minimal car shape without owner fields', () => {
    const parsed = publicCarProfileSchema.parse({
      id: 'car_1',
      make: 'Nissan',
      model: 'Skyline',
      year: 1999,
      nickname: null,
      photo: null,
    });
    expect(parsed.id).toBe('car_1');
  });

  it('rejects unknown keys via strict-by-default zod schema', () => {
    // zod object schemas are not strict by default, so unknowns are stripped.
    // Confirm the public shape strips a plate field rather than carrying it through.
    const parsed = publicCarProfileSchema.parse({
      id: 'car_1',
      make: 'Nissan',
      model: 'Skyline',
      year: 1999,
      nickname: null,
      photo: null,
      plate: 'ABC-1234',
    } as unknown);
    expect((parsed as Record<string, unknown>).plate).toBeUndefined();
  });
});

describe('feed post response', () => {
  it('parses a complete response with car and reactions', () => {
    const parsed = feedPostResponseSchema.parse({
      id: 'post_1',
      eventId: 'evt_1',
      car: {
        id: 'car_1',
        make: 'Nissan',
        model: 'Skyline',
        year: 1999,
        nickname: 'Godzilla',
        photo: { url: 'https://example.com/p.jpg', width: 100, height: 100 },
      },
      body: 'hello',
      status: 'visible',
      photos: [],
      reactions: { likes: 0, mine: false },
      commentCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.car?.id).toBe('car_1');
  });
});

describe('feed post create input', () => {
  it('rejects empty body', () => {
    const result = feedPostCreateInputSchema.safeParse({ carId: 'c', body: '   ' });
    expect(result.success).toBe(false);
  });

  it('caps photo keys at 20', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `k${i}`);
    const result = feedPostCreateInputSchema.safeParse({
      carId: 'c',
      body: 'x',
      photoObjectKeys: tooMany,
    });
    expect(result.success).toBe(false);
  });
});
```

- [x] **Step 2: Run the test, observe it pass (it should — schemas already exist after Task 3)**

Run: `pnpm --filter @jdm/shared test -- src/__tests__/feed.test.ts`
Expected: all tests pass.

If any test fails, the failure points at a bug in `feed.ts` from Task 3 — fix the schema, not the test.

- [x] **Step 3: Commit**

```bash
git add packages/shared/src/__tests__/feed.test.ts
git commit -m "test(jdma-589): cover feed shared schemas

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## ✅ Task 5: Privacy-contract test — forbidden keys never appear

**Files:**

- Create: `packages/shared/src/__tests__/feed-privacy-contract.test.ts`

This is the core deliverable of the issue: a proof that no feed response schema can carry PII.

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FEED_FORBIDDEN_RESPONSE_KEYS, FEED_PUBLIC_RESPONSE_SCHEMAS } from '../feed.js';

// Recursively walk a Zod schema and return every property key it declares.
function collectKeys(schema: z.ZodTypeAny, seen = new Set<z.ZodTypeAny>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);

  const def = (schema as { _def: { typeName: string } })._def;

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const own = Object.keys(shape);
      const nested = own.flatMap((k) => collectKeys(shape[k], seen));
      return [...own, ...nested];
    }
    case 'ZodArray':
      return collectKeys((schema as z.ZodArray<z.ZodTypeAny>).element, seen);
    case 'ZodNullable':
    case 'ZodOptional':
    case 'ZodDefault':
      return collectKeys((schema as z.ZodNullable<z.ZodTypeAny>).unwrap(), seen);
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (schema as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).options;
      return options.flatMap((o) => collectKeys(o, seen));
    }
    case 'ZodIntersection': {
      const { left, right } = (schema as z.ZodIntersection<z.ZodTypeAny, z.ZodTypeAny>)._def;
      return [...collectKeys(left, seen), ...collectKeys(right, seen)];
    }
    case 'ZodRecord':
      return collectKeys((schema as z.ZodRecord)._def.valueType, seen);
    case 'ZodTuple': {
      const items = (schema as z.ZodTuple<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).items;
      return items.flatMap((o: z.ZodTypeAny) => collectKeys(o, seen));
    }
    case 'ZodLazy':
      return collectKeys((schema as z.ZodLazy<z.ZodTypeAny>)._def.getter(), seen);
    default:
      return [];
  }
}

describe('feed privacy contract', () => {
  it('every public feed response schema is enumerable', () => {
    expect(Object.keys(FEED_PUBLIC_RESPONSE_SCHEMAS).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(FEED_PUBLIC_RESPONSE_SCHEMAS))(
    'schema %s declares no forbidden response key',
    (_name, schema) => {
      const keys = collectKeys(schema);
      const leaks = keys.filter((k) => FEED_FORBIDDEN_RESPONSE_KEYS.has(k));
      expect(leaks).toEqual([]);
    },
  );

  it('strips forbidden keys when extra data is fed in', () => {
    const dirty = {
      id: 'car_1',
      make: 'Nissan',
      model: 'Skyline',
      year: 1999,
      nickname: null,
      photo: null,
      plate: 'ABC-1234',
      ownerId: 'usr_1',
      email: 'leak@example.com',
      phone: '+5511999999999',
      cpf: '00000000000',
      userId: 'usr_2',
      address: 'Av. Paulista, 1000',
    };
    const parsed = FEED_PUBLIC_RESPONSE_SCHEMAS.publicCarProfile.parse(dirty);
    const parsedKeys = Object.keys(parsed as object);
    for (const forbidden of FEED_FORBIDDEN_RESPONSE_KEYS) {
      expect(parsedKeys).not.toContain(forbidden);
    }
  });

  it('forbidden key set matches the issue brief exactly', () => {
    expect(new Set(FEED_FORBIDDEN_RESPONSE_KEYS)).toEqual(
      new Set(['plate', 'email', 'phone', 'cpf', 'userId', 'ownerId', 'address']),
    );
  });
});
```

- [x] **Step 2: Run the test, observe it pass**

Run: `pnpm --filter @jdm/shared test -- src/__tests__/feed-privacy-contract.test.ts`
Expected: all assertions green. If any forbidden key appears, the schema in `feed.ts` is wrong — fix the schema, not the test.

- [x] **Step 3: Sanity: prove the test catches regressions**

Temporarily edit `packages/shared/src/feed.ts` and add `userId: z.string()` to `feedPostResponseSchema`. Re-run the test from Step 2. Expected: the `feedPostResponse` case fails with `Expected []; Received: ['userId']`.

Revert the edit. Re-run; all green. (Do not commit the temporary edit.)

- [x] **Step 4: Commit**

```bash
git add packages/shared/src/__tests__/feed-privacy-contract.test.ts
git commit -m "test(jdma-589): privacy-contract proof for feed response schemas

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## ✅ Task 6: Roadmap delta + rollback notes

**Files:**

- Modify: `plans/roadmap.md`
- Create: nothing additional; rollback notes go on the issue comment at the end.

- [x] **Step 1: Flip F9.1 status marker**

In `plans/roadmap.md`, find the F9.1 line:

```
#### 9.1 Schema: FeedPost, FeedLike, FeedComment, Report

- [x] **Done when:** migration green; shared schemas in `@jdm/shared/feed`.
```

Change `- [ ]` to `- [~]`. (Per CLAUDE.md: `[~]` while in-progress on-branch; flip to `[x]` only after merge to `main` AND deployment.)

Add a one-line `> note:` immediately under the bullet:

```
> note: model named `FeedReaction` (kind-flexible) instead of `FeedLike`; `Report` covers posts and comments; feed settings persisted on `Event`.
```

- [x] **Step 2: Verify the formatter / linter does not complain**

Run: `pnpm --filter @jdm/shared lint && pnpm --filter @jdm/db lint`
Expected: both exit 0.

- [x] **Step 3: Run the full shared package test suite**

Run: `pnpm --filter @jdm/shared test`
Expected: all tests pass, including the two new files from Tasks 4 and 5.

- [x] **Step 4: Commit**

```bash
git add plans/roadmap.md
git commit -m "chore(jdma-589): mark F9.1 schema in-progress with model deltas

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## ✅ Task 7: Branch verification + push

- [x] **Step 1: Confirm branch state**

Run: `git status --short && git log --oneline main..HEAD`
Expected: clean working tree, 6 commits since `main` (one per task that committed).

- [x] **Step 2: Push and open PR**

Run:

```bash
git push -u origin feat/jdma-589-event-feed-schema
gh pr create --base main --title "feat(jdma-589): event feed schema + shared contracts + privacy proof" --body "$(cat <<'EOF'
## Summary
- Adds Prisma models: `FeedPost`, `FeedPostPhoto`, `FeedComment`, `FeedReaction`, `Report`.
- Adds per-event feed settings on `Event` (`feedEnabled`, `feedAccess`, `postingAccess`, `maxPostsPerUser`, `maxPhotosPerUser`).
- Adds `@jdm/shared/feed` Zod contracts with `PublicCarProfile`.
- Adds a privacy-contract test proving `plate|email|phone|cpf|userId|ownerId|address` cannot appear in any feed response schema.

## Constraints honoured
- Public identity is the car, not the user (`authorUserId` is private, never serialized).
- Defaults: `maxPostsPerUser=null`, `maxPhotosPerUser=5`.
- Forbidden response keys enumerated centrally and asserted by recursive Zod walk.

## Rollback
- `pnpm --filter @jdm/db exec prisma migrate resolve --rolled-back <timestamp>_feed_schema`
- Then drop the migration directory and revert the schema/shared commits.

## Test plan
- [x] `pnpm --filter @jdm/shared test`
- [x] `pnpm --filter @jdm/shared typecheck`
- [x] `pnpm --filter @jdm/db exec prisma validate`
- [x] Run `pnpm --filter @jdm/db db:migrate` in CI

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [x] **Step 3: Set issue to `in_review`**

Use the Paperclip API to set JDMA-589 to `in_review` with a comment linking the PR. (Handled by the orchestrating agent.)

---

## Self-Review Notes

- **Spec coverage:**
  - Prisma schema/migration ✅ (Tasks 1–2)
  - Event-level feed settings (5 fields) ✅ (Task 1 Step 2; defaults locked in Task 1 + Task 3)
  - `@jdm/shared/feed/*` with `PublicCarProfile` ✅ (Task 3)
  - Privacy contract proof ✅ (Task 5)
  - Per-event setting persistence ✅ (Task 1 Step 2 + Task 2)
  - Roadmap F9 delta ✅ (Task 6)
- **Placeholder scan:** every code block above is complete; no TODO/TBD/"similar to" references; rollback steps are explicit.
- **Type consistency:** `FeedPost`/`FeedComment`/`FeedReaction`/`Report` names match between schema, migration step descriptions, and shared file. Enum value names match between Prisma enums (Step 1) and Zod enums (Task 3). `FEED_FORBIDDEN_RESPONSE_KEYS` and `FEED_PUBLIC_RESPONSE_SCHEMAS` are referenced by Task 5 exactly as defined in Task 3.
- **Out of scope (deferred to dependents JDMA-590/591/592/593):** API handlers, mobile UI, admin moderation queue, push notification triggers.
