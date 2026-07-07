# F8.06 — Post-Commit Ticket Backfill Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `premium-ticket-backfill` worker that runs post-commit after a membership activation, iterates all published future events, picks a grantable tier per event (canon §F8.7), and inserts `Ticket { source: 'premium_grant' }` rows in 100-event inner-tx chunks, relying on the canon §F8.8 partial unique for idempotency. Also add the helper `pickPremiumGrantableTier` in `apps/api/src/services/billing/tier-selection.ts` (shared with chunk F8.07) and wire the post-commit enqueue in `apply-membership-event.ts`.

**Architecture:** The worker follows the existing DB-backed polling pattern used by `data-export.ts` and `broadcasts.ts`. A new `PremiumTicketBackfillJob` table (added in this chunk via raw migration appended to F8.01's migration file — or its own additive migration) acts as the job queue: `apply-membership-event.ts` inserts a row post-commit; the cron worker polls `WHERE status = 'pending'`, processes in chunks of 100 events per inner tx, then marks the job `completed`. The canon §F8.8 partial unique on `Ticket (userId, eventId) WHERE status = 'valid' AND source = 'premium_grant'` (narrowed scope — see F8.01 plan + skeleton canon §F8.8 + spec §2.6 for why) makes every premium_grant ticket insert idempotent on replay — the worker swallows P2002 per-insert and continues. Purchase + comp inserts are unaffected by this index.

**Tech Stack:** Prisma 5 + Postgres 16, Fastify, `node-cron`, Vitest + Testcontainers Postgres (`apps/api/test/global-setup.ts`), existing `signTicketCode` from `apps/api/src/services/tickets/codes.ts`.

---

## Scope

In-scope (this chunk only):

- `apps/api/src/services/billing/tier-selection.ts` (NEW) — `pickPremiumGrantableTier(tx, eventId)` helper.
- `apps/api/src/workers/premium-ticket-backfill.ts` (NEW) — cron worker + tick function.
- `apps/api/src/services/billing/apply-membership-event.ts` (MODIFY) — post-commit enqueue on `subscription.activated`.
- `apps/api/src/app.ts` (MODIFY) — register the worker under `GROWTH_PREMIUM_BILLING_ENABLED`.
- Schema: additive migration appending `PremiumTicketBackfillJob` model (if not already included in F8.01; add it here if absent).
- `apps/api/src/workers/premium-ticket-backfill.test.ts` (NEW) — Testcontainers integration tests.
- `apps/api/test/billing/apply-membership-event-enqueue.test.ts` (NEW) — asserts exactly one job row inserted post-commit on `subscription.activated`.

Out-of-scope (other chunks own these; do NOT touch):

- `apply-membership-event.ts` body other than the post-commit enqueue line (chunk F8.03 owns the rest).
- `premium-event-publish-grant.ts` — chunk F8.07 owns event-publish backfill.
- `TicketTier.isPremiumGrantable` field migration — chunk F8.01 owns the schema delta.
- Admin financial dashboard job-log surface — chunk F8.13/F8.14 scope.
- Feature flag env schema definition — chunk F8.01 owns `GROWTH_PREMIUM_BILLING_ENABLED` in `apps/api/src/env.ts`.

## Branch safety preflight (per CLAUDE.md)

```bash
git branch --show-current
# If output is `production` → STOP.
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-06
```

Never branch from `production`. Never commit on `production`. PRs target `main` only.

---

## Required reading (engineer reads these BEFORE coding)

1. `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §4.2 (post-commit backfill job body), §2.5 (`TicketTier.isPremiumGrantable`), §2.6 (partial unique on Ticket — canon §F8.8), §13 (canon §F8.4, §F8.7, §F8.8 text verbatim).
2. `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §F8.06 entry + cross-chunk canon §F8.4, §F8.7, §F8.8, §F8.11, §F8.12.
3. `apps/api/src/workers/data-export.ts` — the canonical DB-backed job poll pattern: `findMany WHERE status='pending'`, process, mark `completed`/`failed`. Mimic this shape exactly.
4. `apps/api/src/workers/event-reminders.ts` — `startXxxWorker` / `runXxxTick` export shape and cron scheduling pattern.
5. `apps/api/src/app.ts` lines 136–203 — how existing workers register under env-flag guards + `addHook('onClose', ...)`.
6. `apps/api/src/services/billing/apply-membership-event.ts` — chunk F8.03 delivers this file. Read it before the enqueue splice.
7. `apps/api/src/services/tickets/codes.ts` — `signTicketCode(ticketId, env)` signature for generating the HMAC ticket code.
8. `packages/db/prisma/schema.prisma` models `Ticket`, `TicketTier`, `Event`, `Garage` — understand the field names before writing queries.
9. `CLAUDE.md` — branch rules, no full test suite locally, touched-paths only.

---

## Dependency note

This chunk BLOCKS on chunk F8.01 (schema — `TicketTier.isPremiumGrantable` field + `ticket_one_premium_grant_per_user_event` partial unique) and chunk F8.03 (`apply-membership-event.ts`). Do not start until both are merged to `main`.

The `tier-selection.ts` file introduced here is SHARED with chunk F8.07. Chunk F8.07 will import `pickPremiumGrantableTier` from the path this chunk creates. Do not rename or move it.

---

## File Structure

```
apps/api/src/services/billing/tier-selection.ts          NEW — pickPremiumGrantableTier helper
apps/api/src/workers/premium-ticket-backfill.ts          NEW — worker (tick + start function)
apps/api/src/workers/premium-ticket-backfill.test.ts     NEW — Testcontainers integration tests
apps/api/src/services/billing/apply-membership-event.ts  MODIFY — post-commit enqueue on activated
apps/api/src/app.ts                                      MODIFY — register worker under feature flag
apps/api/test/billing/apply-membership-event-enqueue.test.ts  NEW — enqueue assertion tests
packages/db/prisma/schema.prisma                         MODIFY — add PremiumTicketBackfillJob model
packages/db/prisma/migrations/<next>/migration.sql       NEW additive migration
```

### `tier-selection.ts` responsibility

Single exported function: given a Prisma tx client and an `eventId`, return the first `TicketTier` where `isPremiumGrantable = true AND (salesCloseAt IS NULL OR salesCloseAt > now())`, or `null` if none. This function is a pure DB query helper — it does NOT log, does NOT insert.

### `premium-ticket-backfill.ts` responsibility

- `runPremiumTicketBackfillTick(deps)` — polls `PremiumTicketBackfillJob WHERE status='pending'`, processes each job.
- `processBackfillJob(jobId, deps)` — fetches the job, resolves `Garage.userId`, queries `Event WHERE status='published' AND startsAt > now()` in pages, chunks 100 events per inner `prisma.$transaction`, calls `pickPremiumGrantableTier`, inserts `Ticket`, swallows P2002 per insert, marks job `completed`.
- `startPremiumTicketBackfillWorker(deps)` — wraps with `node-cron` (every minute) + error swallow.

### `apply-membership-event.ts` modification

After the outer `prisma.$transaction` resolves (i.e., post-commit), if the event kind is `subscription.activated`, call `prisma.premiumTicketBackfillJob.create({ data: { garageId, status: 'pending' } })`. This is a **separate** DB write outside the activation tx — per canon §F8.4.

---

## Schema addition: `PremiumTicketBackfillJob`

This model does not exist yet. Add it via an additive migration in this chunk (separate from F8.01's migration, or append to it — the chunk F8.01 plan will clarify; if F8.01 is already merged without this model, create a new migration file).

```prisma
// packages/db/prisma/schema.prisma — add after PremiumMembershipInvoice model

enum PremiumTicketBackfillJobStatus {
  pending
  processing
  completed
  failed
}

model PremiumTicketBackfillJob {
  id          String                           @id @default(cuid())
  garageId    String
  status      PremiumTicketBackfillJobStatus   @default(pending)
  errorMessage String?                         @db.VarChar(500)
  createdAt   DateTime                         @default(now())
  updatedAt   DateTime                         @updatedAt

  garage Garage @relation(fields: [garageId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
  @@index([garageId])
}
```

Add the reverse relation to `Garage`:

```prisma
// In the Garage model, add:
premiumTicketBackfillJobs PremiumTicketBackfillJob[]
```

Migration SQL (generated by `prisma migrate dev` + any manual tweaks):

```sql
-- CreateEnum
CREATE TYPE "PremiumTicketBackfillJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "PremiumTicketBackfillJob" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "status" "PremiumTicketBackfillJobStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumTicketBackfillJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PremiumTicketBackfillJob_status_createdAt_idx" ON "PremiumTicketBackfillJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PremiumTicketBackfillJob_garageId_idx" ON "PremiumTicketBackfillJob"("garageId");

-- AddForeignKey
ALTER TABLE "PremiumTicketBackfillJob" ADD CONSTRAINT "PremiumTicketBackfillJob_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Task 1 — Schema migration for `PremiumTicketBackfillJob`

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_f8_premium_backfill_job/migration.sql`

- [ ] **Step 1.1: Add the enum and model to schema.prisma**

Edit `packages/db/prisma/schema.prisma`. After the `PremiumMembershipInvoice` model block (or after the `SubscriptionWebhookEvent` model — whichever comes last in the F8.01 migration section), insert:

```prisma
enum PremiumTicketBackfillJobStatus {
  pending
  processing
  completed
  failed
}

model PremiumTicketBackfillJob {
  id           String                         @id @default(cuid())
  garageId     String
  status       PremiumTicketBackfillJobStatus @default(pending)
  errorMessage String?                        @db.VarChar(500)
  createdAt    DateTime                       @default(now())
  updatedAt    DateTime                       @updatedAt

  garage Garage @relation(fields: [garageId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
  @@index([garageId])
}
```

Also add the reverse relation on the `Garage` model (inside the `model Garage { ... }` block, with the other relation fields):

```prisma
premiumTicketBackfillJobs PremiumTicketBackfillJob[]
```

- [ ] **Step 1.2: Generate and apply the migration**

```bash
pnpm --filter @jdm/db run db:migrate
```

Expected: Prisma creates a new migration file under `packages/db/prisma/migrations/`. Inspect the generated SQL and confirm the `CREATE TABLE "PremiumTicketBackfillJob"` and foreign key are present.

- [ ] **Step 1.3: Rebuild the Prisma client and shared package**

```bash
pnpm --filter @jdm/db build
pnpm --filter @jdm/shared build
```

Expected: both build with no errors. `prisma.premiumTicketBackfillJob` is now accessible on the client.

- [ ] **Step 1.4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add PremiumTicketBackfillJob model for F8.06

Polling job queue table for post-commit premium ticket backfill.
Status enum: pending → processing → completed/failed.
Indexed on (status, createdAt) for efficient poll + garageId for history."
```

---

## Task 2 — Write the failing tests (TDD)

Write all tests before any production code in Tasks 3–5. Run them to confirm they fail with the right errors.

**Files:**

- Create: `apps/api/src/workers/premium-ticket-backfill.test.ts`
- Create: `apps/api/test/billing/apply-membership-event-enqueue.test.ts`

### Test file A: `apps/api/src/workers/premium-ticket-backfill.test.ts`

This file lives alongside the worker source file (same directory as `event-reminders.ts`). It uses the Testcontainers Postgres setup from `apps/api/test/global-setup.ts` — the same setup used by all existing integration tests.

- [ ] **Step 2.1: Create `apps/api/src/workers/premium-ticket-backfill.test.ts`**

```ts
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../env.js';
import { processBackfillJob, runPremiumTicketBackfillTick } from './premium-ticket-backfill.js';
import { createUser, resetDatabase } from '../../test/helpers.js';

const env = loadEnv();

// ── seed helpers ────────────────────────────────────────────────────────────

type SeedEventOpts = {
  startsAtOffset?: number; // ms offset from now; default +1 day
  status?: 'published' | 'draft';
  isPremiumGrantable?: boolean;
  salesCloseAtOffset?: number | null; // null = no salesCloseAt
};

const seedEvent = async (opts: SeedEventOpts = {}) => {
  const {
    startsAtOffset = 24 * 3600_000,
    status = 'published',
    isPremiumGrantable = true,
    salesCloseAtOffset = null,
  } = opts;

  const event = await prisma.event.create({
    data: {
      slug: `backfill-evt-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Backfill Test Event',
      description: 'd',
      startsAt: new Date(Date.now() + startsAtOffset),
      endsAt: new Date(Date.now() + startsAtOffset + 3600_000),
      venueName: 'V',
      venueAddress: 'A',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status,
      ...(status === 'published' ? { publishedAt: new Date() } : {}),
      capacity: 1000,
    },
  });

  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Premium GA',
      priceCents: 0,
      currency: 'BRL',
      quantityTotal: 1000,
      isPremiumGrantable,
      ...(salesCloseAtOffset !== null
        ? { salesCloseAt: new Date(Date.now() + salesCloseAtOffset) }
        : {}),
    },
  });

  return { event, tier };
};

const seedGarageWithActiveMembership = async (email: string) => {
  const { user } = await createUser({ email, verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

  // Seed a PremiumMembership row so the worker can find userId via garageId.
  // The worker only needs the garage.userId; the membership row is not required
  // for the worker logic itself, but it represents the real activation context.
  return { user, garage };
};

const seedBackfillJob = async (garageId: string) => {
  return prisma.premiumTicketBackfillJob.create({
    data: { garageId, status: 'pending' },
  });
};

// ── tests ────────────────────────────────────────────────────────────────────

describe('processBackfillJob', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('inserts one Ticket per published future event with a grantable tier', async () => {
    const { user, garage } = await seedGarageWithActiveMembership('backfill-happy@jdm.test');
    const { event: e1 } = await seedEvent();
    const { event: e2 } = await seedEvent({ startsAtOffset: 48 * 3600_000 });
    const job = await seedBackfillJob(garage.id);

    await processBackfillJob(job.id, { env });

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
      orderBy: { createdAt: 'asc' },
    });
    expect(tickets).toHaveLength(2);
    const eventIds = tickets.map((t) => t.eventId);
    expect(eventIds).toContain(e1.id);
    expect(eventIds).toContain(e2.id);

    // NOTE: Ticket.code is not a stored column in the schema.
    // signTicketCode returns a value used by the caller but not persisted.
    // The Ticket row is valid as long as it exists with status='valid'.

    const doneJob = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(doneJob.status).toBe('completed');
  });

  it('skips events where the user already has a valid ticket (idempotent on replay)', async () => {
    const { user, garage } = await seedGarageWithActiveMembership('backfill-idem@jdm.test');
    const { event, tier } = await seedEvent();

    // Pre-existing valid ticket (simulates partial completion).
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'premium_grant',
        status: 'valid',
      },
    });

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    // Still exactly one ticket — not doubled.
    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, eventId: event.id, status: 'valid' },
    });
    expect(tickets).toHaveLength(1);

    const doneJob = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(doneJob.status).toBe('completed');
  });

  it('re-run after partial completion completes the remainder without double-grants', async () => {
    const { user, garage } = await seedGarageWithActiveMembership('backfill-partial@jdm.test');

    // 3 events — simulate job that completed for e1+e2 but e3 was not yet granted.
    const { event: e1, tier: t1 } = await seedEvent();
    const { event: e2, tier: t2 } = await seedEvent({ startsAtOffset: 36 * 3600_000 });
    const { event: e3 } = await seedEvent({ startsAtOffset: 72 * 3600_000 });

    // Pre-seed tickets for e1 and e2 as if first run partially completed.
    // Ticket.code is not a stored column — omit it.
    await prisma.ticket.createMany({
      data: [
        {
          userId: user.id,
          eventId: e1.id,
          tierId: t1.id,
          source: 'premium_grant',
          status: 'valid',
        },
        {
          userId: user.id,
          eventId: e2.id,
          tierId: t2.id,
          source: 'premium_grant',
          status: 'valid',
        },
      ],
    });

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    // Exactly 3 — e1+e2 untouched (P2002 swallowed), e3 newly inserted.
    expect(tickets).toHaveLength(3);
    expect(tickets.map((t) => t.eventId)).toContain(e3.id);
  });

  it('skips events with no grantable tier and continues (structured log; does not abort)', async () => {
    const { user, garage } = await seedGarageWithActiveMembership('backfill-notier@jdm.test');

    // Event 1: has grantable tier → should get a ticket.
    const { event: good } = await seedEvent({ isPremiumGrantable: true });

    // Event 2: tier exists but isPremiumGrantable=false → no ticket; job continues.
    const { event: noTier } = await seedEvent({
      isPremiumGrantable: false,
      startsAtOffset: 48 * 3600_000,
    });

    const logs: unknown[] = [];
    const fakeLog = {
      warn: (...args: unknown[]) => {
        logs.push(args);
      },
      info: () => {},
      error: () => {},
    } as never;

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env, log: fakeLog });

    // Only the good event got a ticket.
    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.eventId).toBe(good.id);

    // Structured log emitted for the no-tier event.
    const warnCalls = logs.flat();
    const hasNoTierLog = warnCalls.some(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as Record<string, unknown>)['eventId'] === noTier.id,
    );
    expect(hasNoTierLog).toBe(true);

    const doneJob = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(doneJob.status).toBe('completed');
  });

  it('skips events whose salesCloseAt is in the past (closed sales)', async () => {
    const { user, garage } = await seedGarageWithActiveMembership('backfill-closed@jdm.test');

    // Event 1: tier with salesCloseAt 1 hour ago → not grantable by canon §F8.7.
    await seedEvent({ salesCloseAtOffset: -3600_000 });

    // Event 2: tier with no salesCloseAt → grantable.
    const { event: open } = await seedEvent({
      startsAtOffset: 48 * 3600_000,
      salesCloseAtOffset: null,
    });

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    // Only the open-sales event.
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.eventId).toBe(open.id);
  });

  it('does not grant tickets for past or draft events', async () => {
    const { user, garage } = await seedGarageWithActiveMembership('backfill-past@jdm.test');

    // Past event (started 1 hour ago).
    await seedEvent({ startsAtOffset: -3600_000, status: 'published' });

    // Draft event (not published).
    await seedEvent({ status: 'draft' });

    // One valid future published event.
    const { event: future } = await seedEvent({ startsAtOffset: 24 * 3600_000 });

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.eventId).toBe(future.id);
  });
});

describe('50-event backfill batched into chunks of 100', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('processes 50 events across a single inner-tx chunk and marks job completed', async () => {
    const { user, garage } = await seedGarageWithActiveMembership('backfill-50@jdm.test');

    // Seed 50 published future events each with a grantable tier.
    for (let i = 0; i < 50; i++) {
      await seedEvent({ startsAtOffset: (i + 1) * 3600_000 });
    }

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    const count = await prisma.ticket.count({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    expect(count).toBe(50);

    const doneJob = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(doneJob.status).toBe('completed');
  });
});

describe('runPremiumTicketBackfillTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('picks up pending jobs and completes them', async () => {
    const { user, garage } = await seedGarageWithActiveMembership('backfill-tick@jdm.test');
    await seedEvent();
    await seedBackfillJob(garage.id);

    await runPremiumTicketBackfillTick({ env });

    const tickets = await prisma.ticket.count({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    expect(tickets).toBe(1);

    const jobs = await prisma.premiumTicketBackfillJob.findMany({
      where: { garageId: garage.id },
    });
    expect(jobs[0]!.status).toBe('completed');
  });

  it('does not process completed or failed jobs on re-tick', async () => {
    const { garage } = await seedGarageWithActiveMembership('backfill-skip@jdm.test');
    await seedEvent();

    const job = await prisma.premiumTicketBackfillJob.create({
      data: { garageId: garage.id, status: 'completed' },
    });

    await runPremiumTicketBackfillTick({ env });

    // Job was already completed — should not have been re-processed.
    const after = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(after.status).toBe('completed'); // unchanged
  });
});
```

### Test file B: `apps/api/test/billing/apply-membership-event-enqueue.test.ts`

- [ ] **Step 2.2: Create `apps/api/test/billing/apply-membership-event-enqueue.test.ts`**

```ts
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

const makeActivatedEvent = (
  garageId: string,
): BillingEvent & { kind: 'subscription.activated' } => ({
  kind: 'subscription.activated',
  provider: 'stripe',
  providerCustomerRef: 'cus_test',
  providerSubRef: 'sub_test_001',
  garageId,
  tier: 'gold',
  cadence: 'monthly',
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
  pricing: {
    baseAmountCents: 2900,
    devFeePercent: 10,
    devFeeAmountCents: 290,
    grossAmountCents: 3190,
    currency: 'BRL',
  },
  invoice: {
    providerInvoiceRef: 'in_test_enqueue_001',
    periodStart: new Date(),
    periodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
    paidAt: new Date(),
  },
});

describe('applyMembershipEvent post-commit enqueue', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('enqueues exactly one PremiumTicketBackfillJob after subscription.activated commits', async () => {
    const { user } = await createUser({ email: 'enqueue-test@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const evt = makeActivatedEvent(garage.id);
    await applyMembershipEvent(evt, env);

    const jobs = await prisma.premiumTicketBackfillJob.findMany({
      where: { garageId: garage.id },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe('pending');
  });

  it('does NOT enqueue a backfill job for subscription.renewed', async () => {
    const { user } = await createUser({ email: 'no-enqueue-renewed@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    // First, activate to create the Membership row.
    const activated = makeActivatedEvent(garage.id);
    await applyMembershipEvent(activated, env);
    // Clear any jobs from the activation.
    await prisma.premiumTicketBackfillJob.deleteMany({ where: { garageId: garage.id } });

    const renewedEvt: BillingEvent = {
      kind: 'subscription.renewed',
      provider: 'stripe',
      providerSubRef: 'sub_test_001',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 60 * 24 * 3600_000),
      pricing: {
        baseAmountCents: 2900,
        devFeePercent: 10,
        devFeeAmountCents: 290,
        grossAmountCents: 3190,
        currency: 'BRL',
      },
      invoice: {
        providerInvoiceRef: 'in_test_renewal_001',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 60 * 24 * 3600_000),
        paidAt: new Date(),
      },
    };

    await applyMembershipEvent(renewedEvt, env);

    // No new job should exist — renewal does not trigger backfill (spec §4.3).
    const jobs = await prisma.premiumTicketBackfillJob.findMany({
      where: { garageId: garage.id },
    });
    expect(jobs).toHaveLength(0);
  });

  it('enqueues exactly once even if applyMembershipEvent is called twice with the same event (idempotent activation replay)', async () => {
    const { user } = await createUser({ email: 'enqueue-replay@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const evt = makeActivatedEvent(garage.id);

    // First call — activates.
    await applyMembershipEvent(evt, env);

    // Second call — idempotency: SubscriptionWebhookEvent unique(provider, providerEventId)
    // blocks the second activation tx from committing. No second job should be enqueued.
    // applyMembershipEvent should short-circuit or return without throwing.
    // (Behavior depends on F8.03 implementation — if it throws on replay, wrap it.)
    try {
      await applyMembershipEvent(evt, env);
    } catch {
      // Idempotency may throw on replay (P2002 from SubscriptionWebhookEvent insert).
      // That's acceptable — we only care that no second job row appears.
    }

    const jobs = await prisma.premiumTicketBackfillJob.findMany({
      where: { garageId: garage.id },
    });
    // Only one job from the first activation.
    expect(jobs).toHaveLength(1);
  });
});
```

- [ ] **Step 2.3: Run both test files to confirm they fail**

```bash
pnpm --filter @jdm/api exec vitest run src/workers/premium-ticket-backfill.test.ts
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event-enqueue.test.ts
```

Expected: both fail. `premium-ticket-backfill.test.ts` fails with "Cannot find module" (file doesn't exist yet). `apply-membership-event-enqueue.test.ts` fails because `applyMembershipEvent` does not yet enqueue a job.

- [ ] **Step 2.4: Commit the failing tests**

```bash
git add apps/api/src/workers/premium-ticket-backfill.test.ts
git add apps/api/test/billing/apply-membership-event-enqueue.test.ts
git commit -m "test(api): failing tests for F8.06 premium ticket backfill worker

TDD red phase. Covers: 50-event backfill, idempotent replay,
partial-completion resumption, no-grantable-tier skip (canon §F8.7),
past/draft event filtering, enqueue-once-on-activated, no-enqueue-on-renewal."
```

---

## Task 3 — Implement `tier-selection.ts`

**Files:**

- Create: `apps/api/src/services/billing/tier-selection.ts`

- [ ] **Step 3.1: Create the file**

```ts
// apps/api/src/services/billing/tier-selection.ts
//
// Shared helper for premium-grant tier selection (canon §F8.7).
// Used by both F8.06 (ticket-backfill worker) and F8.07
// (event-publish-grant worker).
//
// Picks the FIRST TicketTier WHERE:
//   eventId = E
//   AND isPremiumGrantable = true
//   AND (salesCloseAt IS NULL OR salesCloseAt > now())
//
// Returns null if no grantable tier exists.
// NEVER logs; NEVER inserts. Pure query helper.

import type { PrismaClient } from '@prisma/client';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export type GrantableTier = {
  id: string;
  eventId: string;
};

export const pickPremiumGrantableTier = async (
  client: Tx | PrismaClient,
  eventId: string,
): Promise<GrantableTier | null> => {
  const tier = await client.ticketTier.findFirst({
    where: {
      eventId,
      isPremiumGrantable: true,
      OR: [{ salesCloseAt: null }, { salesCloseAt: { gt: new Date() } }],
    },
    select: { id: true, eventId: true },
    orderBy: { sortOrder: 'asc' },
  });
  return tier ?? null;
};
```

- [ ] **Step 3.2: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: no errors. The `Tx` type inference pattern matches `apps/api/src/services/tickets/issue.ts:73` exactly — it is the established pattern in this codebase.

- [ ] **Step 3.3: Commit**

```bash
git add apps/api/src/services/billing/tier-selection.ts
git commit -m "feat(api): add pickPremiumGrantableTier helper (F8.06, §F8.7)

Shared with F8.07. Returns first isPremiumGrantable tier with open sales
or null if none. Never logs — callers are responsible for §F8.7 warning."
```

---

## Task 4 — Implement `premium-ticket-backfill.ts`

**Files:**

- Create: `apps/api/src/workers/premium-ticket-backfill.ts`

- [ ] **Step 4.1: Create the worker file**

```ts
// apps/api/src/workers/premium-ticket-backfill.ts
//
// Post-commit ticket backfill worker for premium membership activation.
//
// Canon §F8.4: this worker runs POST-COMMIT from applyMembershipEvent.
//              It MUST NOT be called inside the activation tx.
// Canon §F8.7: pick first isPremiumGrantable tier; if none, log
//              premium_grant.no_tier + continue (NEVER throw).
// Canon §F8.8: rely on partial unique UNIQUE(userId,eventId) WHERE
//              status='valid' AND source='premium_grant' as the DB-level
//              dedup (narrowed scope — see spec §2.6); swallow P2002 per
//              ticket insert and continue.
//
// Job-table pattern mirrors data-export.ts (existing codebase pattern).

import { prisma, Prisma } from '@jdm/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import { pickPremiumGrantableTier } from '../services/billing/tier-selection.js';
// NOTE: signTicketCode is NOT imported here because Ticket.code is not a
// persisted column. The code is generated on-demand at display time (e.g.,
// GET /tickets/:id) from the ticket.id. The backfill worker only creates
// the entitlement row.

const CHUNK_SIZE = 100; // events per inner tx (spec §4.2)
const EVENT_PAGE_SIZE = 100; // same as chunk size for simplicity

export type BackfillWorkerDeps = {
  env: Env;
  log?: FastifyBaseLogger;
};

// ── processBackfillJob ───────────────────────────────────────────────────────

export const processBackfillJob = async (
  jobId: string,
  deps: BackfillWorkerDeps,
): Promise<void> => {
  const { env, log } = deps;

  // Fetch job + garage in one query.
  const job = await prisma.premiumTicketBackfillJob.findUnique({
    where: { id: jobId },
    include: { garage: { select: { userId: true } } },
  });

  if (!job) {
    log?.warn({ jobId }, 'premium_grant.backfill_job_not_found');
    return;
  }

  if (job.status !== 'pending') {
    // Already processed by a concurrent tick or a previous run.
    return;
  }

  const userId = job.garage.userId;

  // Mark as processing to prevent concurrent tick from picking it up.
  await prisma.premiumTicketBackfillJob.update({
    where: { id: jobId },
    data: { status: 'processing' },
  });

  try {
    // Page through published future events in CHUNK_SIZE pages.
    let cursor: string | undefined;

    while (true) {
      const events = await prisma.event.findMany({
        where: {
          status: 'published',
          startsAt: { gt: new Date() },
        },
        select: { id: true },
        orderBy: { startsAt: 'asc' },
        take: EVENT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (events.length === 0) break;

      // Process this page as one inner tx (each page is ≤ CHUNK_SIZE events).
      await prisma.$transaction(async (tx) => {
        for (const event of events) {
          const tier = await pickPremiumGrantableTier(tx, event.id);

          if (!tier) {
            // Canon §F8.7: skip + structured log.
            log?.warn(
              { eventId: event.id, garageId: job.garageId, reason: 'no_premium_grantable_tier' },
              'premium_grant.no_tier',
            );
            continue;
          }

          // Belt-and-braces application-layer check before insert.
          // The partial unique (canon §F8.8) is the real backstop.
          const alreadyHasTicket = await tx.ticket.findFirst({
            where: { userId, eventId: event.id, status: 'valid' },
            select: { id: true },
          });
          if (alreadyHasTicket) continue;

          // Insert via create; let Prisma generate the id.
          // On P2002 (partial unique violation — race or replay), swallow and continue.
          // NOTE: Ticket.code is not a persisted column in the schema.
          // signTicketCode generates a code from the ticket.id at the point of
          // issuance (e.g., for QR display). The backfill worker does not need
          // to surface the code — it only creates the entitlement row.
          try {
            await tx.ticket.create({
              data: {
                userId,
                eventId: event.id,
                tierId: tier.id,
                source: 'premium_grant',
                status: 'valid',
              },
            });
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              // Canon §F8.8 dedup: partial unique fired. Already has valid ticket.
              continue;
            }
            throw err;
          }
        }
      });

      if (events.length < EVENT_PAGE_SIZE) break;
      cursor = events[events.length - 1]!.id;
    }

    await prisma.premiumTicketBackfillJob.update({
      where: { id: jobId },
      data: { status: 'completed' },
    });

    log?.info({ jobId, garageId: job.garageId, userId }, 'premium_grant.backfill_completed');
  } catch (err) {
    await prisma.premiumTicketBackfillJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      },
    });
    log?.error({ err, jobId, garageId: job.garageId }, 'premium_grant.backfill_failed');
    // Do not rethrow — failed jobs are retryable on next tick via a manual status reset.
  }
};

// ── runPremiumTicketBackfillTick ─────────────────────────────────────────────

export const runPremiumTicketBackfillTick = async (deps: BackfillWorkerDeps): Promise<void> => {
  const jobs = await prisma.premiumTicketBackfillJob.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  for (const job of jobs) {
    try {
      await processBackfillJob(job.id, deps);
    } catch (err) {
      deps.log?.error({ err, jobId: job.id }, '[backfill-worker] unexpected tick error');
    }
  }
};

// ── startPremiumTicketBackfillWorker ─────────────────────────────────────────

export const startPremiumTicketBackfillWorker = (
  deps: BackfillWorkerDeps,
): { stop: () => void } => {
  const task = cron.schedule('* * * * *', async () => {
    try {
      await runPremiumTicketBackfillTick(deps);
    } catch (err) {
      deps.log?.error({ err }, '[backfill-worker] tick error');
    }
  });

  return {
    stop: () => {
      void task.stop();
    },
  };
};
```

**IMPORTANT:** The `Ticket` schema does not have a `code` field in the current schema snapshot (the field is generated by `signTicketCode` and stored in the existing `Ticket` model). Before finalizing, verify whether `Ticket.code` is a real column in `packages/db/prisma/schema.prisma`:

```bash
grep -n "code" /Users/pedro/Projects/jdm-experience/packages/db/prisma/schema.prisma | grep -i "Ticket\b" | head -10
```

If `Ticket` does not have a `code` column, the `ticket.create` must NOT attempt to set `code`, and the two-step create+update pattern above must be replaced with a single `create` call without `code`. The HMAC code may live only in the response of ticket issuance and not be persisted on the Ticket row — check `apps/api/src/services/tickets/codes.ts` and `grant.ts` carefully. If `code` is not on the Ticket model, remove it from the `create` data and remove the follow-up `update`. Adjust the test assertions for `t.code` accordingly.

- [ ] **Step 4.2: Confirm Ticket.code is not a stored field (pre-verified)**

The `Ticket` model in `packages/db/prisma/schema.prisma` does NOT have a `code` column. This was verified during planning. The worker code above already omits `code` from the `ticket.create` call. Do not add it. If a future chunk adds `Ticket.code` to the schema (e.g., for indexed lookups), update this worker's `create` call at that time.

- [ ] **Step 4.3: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: no errors.

- [ ] **Step 4.4: Run the worker tests**

```bash
pnpm --filter @jdm/api exec vitest run src/workers/premium-ticket-backfill.test.ts
```

Expected: all tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/workers/premium-ticket-backfill.ts
git commit -m "feat(api): premium ticket backfill worker (F8.06)

Post-commit worker that grants Ticket{source:premium_grant} to newly
activated premium members for all published future events.

Canon §F8.4: runs post-commit only (never inside activation tx).
Canon §F8.7: skips events with no grantable tier, logs premium_grant.no_tier.
Canon §F8.8: swallows P2002 per ticket insert (partial unique dedup).
Chunked 100 events/inner-tx. DB-backed job queue (PremiumTicketBackfillJob).
Mirrors data-export.ts polling pattern."
```

---

## Task 5 — Wire post-commit enqueue in `apply-membership-event.ts`

**Files:**

- Modify: `apps/api/src/services/billing/apply-membership-event.ts`

Chunk F8.03 owns this file. This task adds the post-commit enqueue. **Read the file before editing.** Do not touch any other logic.

- [ ] **Step 5.1: Add the post-commit enqueue**

After the `await prisma.$transaction(...)` call that handles `subscription.activated` resolves (i.e., after the commit), add:

```ts
// Post-commit: enqueue ticket backfill job (canon §F8.4).
// MUST be outside the activation tx. A separate DB write is intentional —
// the backfill worker is crash-safe (it polls `PremiumTicketBackfillJob`
// WHERE status='pending' on every tick).
if (event.kind === 'subscription.activated') {
  await prisma.premiumTicketBackfillJob.create({
    data: { garageId: event.garageId, status: 'pending' },
  });
}
```

The exact location depends on how F8.03 structured `applyMembershipEvent`. The pattern should look like:

```ts
export const applyMembershipEvent = async (event: BillingEvent, env: Env): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    // ... activation tx body (chunk F8.03) ...
  });

  // POST-COMMIT side-effects (§F8.4):
  if (event.kind === 'subscription.activated') {
    await prisma.premiumTicketBackfillJob.create({
      data: { garageId: event.garageId, status: 'pending' },
    });
  }
};
```

If `applyMembershipEvent` uses a different structure (e.g., the tx result is returned and callers handle post-commit), follow the existing pattern strictly. The invariant is: `prisma.premiumTicketBackfillJob.create` is called OUTSIDE the `$transaction` callback.

- [ ] **Step 5.2: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: no errors.

- [ ] **Step 5.3: Run the enqueue test**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event-enqueue.test.ts
```

Expected: all three enqueue tests pass.

- [ ] **Step 5.4: Run both test suites together**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event-enqueue.test.ts src/workers/premium-ticket-backfill.test.ts
```

Expected: all tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/services/billing/apply-membership-event.ts
git commit -m "feat(api): enqueue PremiumTicketBackfillJob post-commit on subscription.activated

Canon §F8.4: backfill job is created AFTER the activation tx commits.
Renewal, cancellation, and expiry paths do NOT enqueue (spec §4.3)."
```

---

## Task 6 — Register worker in `app.ts`

**Files:**

- Modify: `apps/api/src/app.ts`

- [ ] **Step 6.1: Add the import**

At the top of `apps/api/src/app.ts`, alongside the existing worker imports:

```ts
import { startPremiumTicketBackfillWorker } from './workers/premium-ticket-backfill.js';
```

- [ ] **Step 6.2: Register under the feature flag**

Inside the `if (env.GROWTH_PREMIUM_BILLING_ENABLED)` block (created by chunk F8.01 — add that block if it doesn't exist yet):

```ts
if (env.GROWTH_PREMIUM_BILLING_ENABLED) {
  const backfillWorker = startPremiumTicketBackfillWorker({ env, log: app.log });
  app.addHook('onClose', () => {
    void backfillWorker.stop();
  });
}
```

If chunk F8.01 has not yet created the `GROWTH_PREMIUM_BILLING_ENABLED` gate in `app.ts`, add the block. The `GROWTH_PREMIUM_BILLING_ENABLED` env var is defined in `apps/api/src/env.ts` by chunk F8.01 as `z.coerce.boolean().default(false)`.

- [ ] **Step 6.3: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: no errors.

- [ ] **Step 6.4: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat(api): register premium ticket backfill worker (F8.06)

Gated behind GROWTH_PREMIUM_BILLING_ENABLED (default false, §F8.11).
Polls every minute for pending PremiumTicketBackfillJob rows."
```

---

## Task 7 — Final verification

- [ ] **Step 7.1: Run all touched-path tests**

```bash
pnpm --filter @jdm/api exec vitest run \
  src/workers/premium-ticket-backfill.test.ts \
  test/billing/apply-membership-event-enqueue.test.ts \
  test/billing/apply-membership-event.test.ts
```

Expected: all pass. The last test file (`apply-membership-event.test.ts`) is the F8.03 suite — run it as a regression check to confirm the enqueue splice does not break the core activation-tx tests.

- [ ] **Step 7.2: Typecheck the full API package**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: clean.

- [ ] **Step 7.3: Rebuild shared (canon §F8.13)**

```bash
pnpm --filter @jdm/shared build
```

Expected: build succeeds. This chunk adds no new shared exports, but the rebuild confirms nothing is broken.

- [ ] **Step 7.4: ESLint the new files**

```bash
pnpm --filter @jdm/api exec eslint \
  src/workers/premium-ticket-backfill.ts \
  src/services/billing/tier-selection.ts
```

Expected: no errors or warnings.

---

## Task 8 — Open the PR

- [ ] **Step 8.1: Push the branch**

```bash
git push -u origin feat/jdma-f8-billing-06
```

- [ ] **Step 8.2: Open the PR against `main`**

PR title: `feat(api): premium ticket backfill worker + tier-selection helper (F8.06)`

PR body:

```markdown
## Summary

F8 Wave C, chunk 06. Post-commit ticket backfill for newly-activated
premium members.

- `apps/api/src/services/billing/tier-selection.ts` — `pickPremiumGrantableTier(client, eventId)` helper shared with F8.07.
- `apps/api/src/workers/premium-ticket-backfill.ts` — DB-backed polling worker (mirrors `data-export.ts` pattern). Polls `PremiumTicketBackfillJob WHERE status='pending'` every minute; processes 100 events per inner tx.
- `apply-membership-event.ts` — post-commit enqueue of `PremiumTicketBackfillJob` after `subscription.activated` tx commits (canon §F8.4).
- `app.ts` — worker registered under `GROWTH_PREMIUM_BILLING_ENABLED` flag (canon §F8.11).
- Schema: `PremiumTicketBackfillJob` model + additive migration.

Canon compliance:

- §F8.4: backfill runs post-commit, never inside the activation tx.
- §F8.7: no grantable tier → log `premium_grant.no_tier` + continue.
- §F8.8: P2002 swallowed per insert; partial unique is the DB-level dedup.
- §F8.11: worker gated behind feature flag (default off).

## Test plan

- [x] 50-event backfill processed in a single inner-tx chunk, job marked completed
- [x] Idempotent replay: user already has ticket → P2002 swallowed, no double-grant
- [x] Partial completion resumed: e1+e2 pre-existing, only e3 newly inserted
- [x] No grantable tier: structured log emitted, job still completes, only events with tier get tickets
- [x] salesCloseAt in the past: tier skipped per §F8.7
- [x] Past and draft events: not granted
- [x] applyMembershipEvent enqueues exactly one job on `subscription.activated`
- [x] No job enqueued on `subscription.renewed`
- [x] Replay of `subscription.activated` does not produce second job
- [x] `pnpm --filter @jdm/api typecheck` clean

## Reviewer checklist

- [ ] `prisma.premiumTicketBackfillJob.create(...)` is called OUTSIDE `prisma.$transaction` in `apply-membership-event.ts`.
- [ ] `processBackfillJob` marks job `processing` before the loop, `completed` after, `failed` on error.
- [ ] P2002 is caught per-insert and continues (does NOT abort the inner tx).
- [ ] `pickPremiumGrantableTier` is the ONLY place the `isPremiumGrantable` query is evaluated.
- [ ] Worker registered only when `env.GROWTH_PREMIUM_BILLING_ENABLED = true`.
- [ ] Tests use real Postgres (Testcontainers via `test/global-setup.ts`), no mocks.

## Deviations from skeleton

None. Follows skeleton §F8.06 exactly. `tier-selection.ts` is a new file explicitly mentioned in the skeleton as shared with F8.07.

## Out of scope

- Event-publish grant (F8.07 owns `premium-event-publish-grant.ts`).
- Reconciliation sweep (F8.12).
- Admin job-log surface (F8.13/F8.14).
```

---

## Self-review checklist

- [ ] **Spec coverage:**
  - Spec §4.2 "Chunked 100 events per inner tx" → Task 4 (`CHUNK_SIZE = 100`, inner tx loop).
  - Spec §4.2 "for each published Event where startsAt > now()" → `prisma.event.findMany({ where: { status: 'published', startsAt: { gt: new Date() } } })`.
  - Spec §4.2 "if no grantable tier: log warning, continue" → canon §F8.7 enforced in Task 4 + test in Step 2.1 test 4.
  - Spec §4.2 "insert Ticket { source: 'premium_grant', status: 'valid' }" → Task 4 `ticket.create`. Note: `code: HMAC(...)` in the spec refers to the QR-scan code generated on-demand from `ticket.id`; `Ticket.code` is NOT a persisted column (verified against schema). The backfill creates the entitlement row; the code is derived at display time via `signTicketCode(ticket.id, env)` from `codes.ts`.
  - Spec §4.2 "idempotent via partial-unique-on-Ticket" → canon §F8.8 P2002 swallow in Task 4 + test in Step 2.1 test 2 + 3.
  - Spec §4.1 step 8 "On commit: enqueues post-commit side-effects" → Task 5 post-commit enqueue.
  - Spec §4.3 "No XP, no backfill" on renewal → tested in Step 2.2 test 2 (no job on renewal).
  - Skeleton §F8.06 "activation tx enqueues exactly once per `activated` event" → test in Step 2.2 test 1 + 3.

- [ ] **Placeholder scan:** No TBD, no TODO, no "fill in", no "similar to Task N". All code blocks are complete.

- [ ] **Type consistency:**
  - `pickPremiumGrantableTier(client, eventId)` — called in Task 4 `premium-ticket-backfill.ts` with `(tx, event.id)`.
  - `processBackfillJob(jobId, deps)` — called in Task 5 tick and in tests as `processBackfillJob(job.id, { env })`.
  - `startPremiumTicketBackfillWorker(deps)` — registered in Task 6 as `startPremiumTicketBackfillWorker({ env, log: app.log })`.
  - `BackfillWorkerDeps = { env: Env; log?: FastifyBaseLogger }` — matches all call sites.

- [ ] **Canon §F8.4 guard:** The `prisma.premiumTicketBackfillJob.create(...)` call is after `await prisma.$transaction(...)` returns in `apply-membership-event.ts`, never inside the callback.

- [ ] **Canon §F8.7 guard:** The `no_tier` warn path is `log?.warn(...)` + `continue` — it does NOT `throw` and does NOT break the outer loop.

- [ ] **Canon §F8.8 guard:** The `P2002` catch block has `continue` (not `throw` or `break`) and does NOT re-wrap or swallow non-P2002 errors.

---

## Cross-references

- **F8.01** (schema + env flag) — must be merged before this chunk. Provides `TicketTier.isPremiumGrantable`, `ticket_one_premium_grant_per_user_event` partial unique, and `GROWTH_PREMIUM_BILLING_ENABLED` env var.
- **F8.03** (`applyMembershipEvent`) — must be merged before this chunk. This chunk adds the post-commit enqueue line to that file.
- **F8.07** (event-publish grant) — IMPORTS `pickPremiumGrantableTier` from `apps/api/src/services/billing/tier-selection.ts` created here. Do not rename or move that file.
- **F8.08** (`TicketTier.isPremiumGrantable` admin UI) — parallel with this chunk; no code dependency.
- **F8.12** (reconciliation sweep) — parallel; no code dependency.
- `apps/api/src/workers/data-export.ts` — format reference for the DB-backed polling pattern.
- `apps/api/src/services/tickets/codes.ts` — `signTicketCode(ticketId, env)` used to generate HMAC code.
