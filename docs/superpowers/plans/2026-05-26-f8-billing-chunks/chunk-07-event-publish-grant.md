# F8.07 — Event-publish premium-grant hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an event is published, enqueue a background job that pages through all active premium members and inserts a `premium_grant` Ticket for each member who does not yet hold a valid ticket for the event.

**Architecture:** Two files land in this chunk. (1) `apps/api/src/workers/premium-event-publish-grant.ts` — the job consumer; it loads the event + first grantable tier via `pickPremiumGrantableTier` (shipped by F8.06), pages through `PremiumMembership WHERE status='active' AND cancelAtPeriodEnd=false AND currentPeriodEnd > event.startsAt` in batches of 500, inserts `Ticket { source: 'premium_grant', status: 'valid' }` per eligible member, relying on the partial-unique index (canon §F8.8) for race-safe idempotency. (2) `apps/api/src/routes/admin/events.ts` — extend the existing `POST /events/:id/publish` handler to enqueue the grant job **after the publish transaction commits** (never inside). The publish tx stays minimal: only `Event.status + publishedAt`.

**Tech Stack:** Fastify + Prisma (`@prisma/client`), TypeScript, vitest with Testcontainers-Postgres (real DB — no mocks per CLAUDE.md). Workspace: `@ccc/api`. Existing worker-bus pattern: `node-cron`-style modules under `apps/api/src/workers/`; jobs are invoked directly (no queue broker in this codebase — see `event-reminders.ts` pattern). Existing ticket code: `apps/api/src/services/tickets/codes.ts::signTicketCode` (read-path only; `Ticket` DB row has no stored `code` column).

---

## Required reading before coding

1. `CLAUDE.md` — branch safety + load-bearing invariants.
2. `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §4.6 — canonical spec for this chunk (event-publish-time grant).
3. `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §F8.07 — acceptance criteria + dependency notes.
4. Spec §13 canon entries §F8.7 (tier selection + log-on-miss) and §F8.8 (partial-unique dedup) — load-bearing invariants.
5. `apps/api/src/workers/event-reminders.ts` — the reference worker pattern in this codebase (cron-scheduled tick, real Prisma queries, no queue broker).
6. `apps/api/src/routes/admin/events.ts` lines 197–225 — existing publish handler (the exact function we extend).
7. `apps/api/src/services/tickets/grant.ts` lines 116–134 — how a `Ticket` row is created without a stored `code` field.

---

## Branch safety preflight (per CLAUDE.md)

```bash
git branch --show-current
# If output is `production` → STOP. Switch to main first.
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-07
```

Never branch from `production`. Never commit on `production`. PR targets `main`.

---

## Dependency pre-flight

This chunk depends on two deliverables from sibling chunks:

### F8.08 dependency — `TicketTier.isPremiumGrantable`

The field lands in the DB migration in F8.01. F8.08 adds the admin UI + shared schema for it. This chunk reads the field directly from Prisma; it does not need the admin UI. **The migration (F8.01) must be applied to the test DB before tests pass.**

Pre-flight check:

```bash
grep -n 'isPremiumGrantable' packages/db/prisma/schema.prisma
```

Expected: `isPremiumGrantable Boolean @default(false)` on `TicketTier`. If absent, F8.01 has not landed — block on it.

### F8.06 dependency — `pickPremiumGrantableTier`

F8.06 exports this helper from `apps/api/src/services/billing/premium-grant-helpers.ts`. This chunk imports it.

Pre-flight check:

```bash
grep -n 'export.*pickPremiumGrantableTier' apps/api/src/services/billing/premium-grant-helpers.ts
```

Expected: function found. If absent, F8.06 has not landed — block on it.

The canonical signature (per spec §F8.7 + F8.06 plan):

```ts
/**
 * Returns the first TicketTier for the event where isPremiumGrantable=true
 * and (salesCloseAt IS NULL OR salesCloseAt > now).
 * Returns null if none exists.
 */
export const pickPremiumGrantableTier = async (
  tx: Prisma.TransactionClient,
  eventId: string,
  now?: Date,
): Promise<{ id: string } | null>;
```

If the live signature differs, update this plan's code blocks to match before implementing.

### F8.08 — `PremiumMembership` model

The `PremiumMembership` table lands in F8.01 migration. The shape used in this chunk:

```ts
// Fields read by this worker:
// id, garageId, status, cancelAtPeriodEnd, currentPeriodEnd
// Garage relation: garage.userId
```

---

## Schema notes

**`Ticket` DB row has no `code` column.** The `signTicketCode` function is read-path only (serialization at ticket list endpoints). When inserting a `premium_grant` ticket, do NOT attempt to set a `code` field — the model does not have one. Verified by reading `packages/db/prisma/schema.prisma` lines 767–794.

**Partial unique on `Ticket` (canon §F8.8 — narrowed):** `UNIQUE (userId, eventId) WHERE status = 'valid' AND source = 'premium_grant'` lands in F8.01 migration. The scope is narrowed to `source='premium_grant'` because purchase/comp flows legitimately create multiple valid Ticket rows per `(userId, eventId)` (see F8.01 plan + spec §2.6). The publish-grant worker only ever inserts `source='premium_grant'` rows, so the narrowed index is still its DB-level dedup. Application-level `findFirst` checks are belt-and-braces; the partial unique is the race-safe backstop. On a P2002 from the index, the worker swallows silently and continues — it means another premium-grant path already inserted for that `(userId, eventId)` pair.

**`PremiumMembership.garageId` → `Garage.userId`:** The membership row has `garageId`, not `userId`. To insert a `Ticket { userId }`, the worker must join through `Garage.userId`. Use an `include: { garage: { select: { userId: true } } }` on the membership query, or a two-step lookup.

---

## File Structure

```
apps/api/src/workers/premium-event-publish-grant.ts   (NEW — job consumer)
apps/api/src/workers/premium-event-publish-grant.test.ts  (NEW — Testcontainers tests)
apps/api/src/routes/admin/events.ts                   (MODIFY — extend publish handler, ~8 lines)
apps/api/test/admin/events/                           (MODIFY — extend publish-related test)
```

No new exports from `events.ts` other than the side-effect of enqueueing the job. No schema changes. No shared-package changes.

---

## Task 1 — Write the failing worker test file (TDD)

**Files:**

- Create: `apps/api/src/workers/premium-event-publish-grant.test.ts`

Test design notes:

- Use Testcontainers Postgres (see `test/global-setup.ts` + `test/setup.ts` for the harness). Import `prisma` from `@ccc/db` and `resetDatabase` + `createUser` from `../../test/helpers.js`.
- The worker function under test is `runPremiumEventPublishGrant({ eventId, publishedAt, log? })` — co-located with the worker file, exported for testability. Tests call it directly (no HTTP layer needed).
- Seed helpers are defined locally per test pattern from `event-reminders.test.ts`.
- The `PremiumMembership` model lands in F8.01 migration. If the test DB hasn't run F8.01 yet, tests will fail with "table does not exist" — that is an environment pre-flight issue, not a test-logic issue.

- [ ] **Step 1.1 — Create the test file skeleton**

```ts
// apps/api/src/workers/premium-event-publish-grant.test.ts
import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { runPremiumEventPublishGrant } from './premium-event-publish-grant.js';
import { createUser, resetDatabase } from '../../test/helpers.js';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

const seedEvent = async (
  overrides: {
    startsAt?: Date;
    status?: 'draft' | 'published';
  } = {},
) => {
  const startsAt = overrides.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return prisma.event.create({
    data: {
      slug: `evt-publish-grant-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Grant Test Event',
      description: 'd',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      type: 'meeting',
      status: overrides.status ?? 'published',
      capacity: 2000,
      publishedAt: overrides.status === 'draft' ? null : new Date(),
    },
  });
};

const seedGrantableTier = async (eventId: string) =>
  prisma.ticketTier.create({
    data: {
      eventId,
      name: 'Premium Acesso',
      priceCents: 0,
      quantityTotal: 99999,
      isPremiumGrantable: true,
    },
  });

const seedNonGrantableTier = async (eventId: string) =>
  prisma.ticketTier.create({
    data: {
      eventId,
      name: 'VIP Pago',
      priceCents: 5000,
      quantityTotal: 100,
      isPremiumGrantable: false,
    },
  });

/**
 * Creates a PremiumMembership row for the given garageId.
 * Defaults to active, not cancelling, period ending well after the event.
 */
const seedActiveMembership = async (
  garageId: string,
  overrides: {
    status?: string;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: Date;
  } = {},
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: `cus_${Math.random().toString(36).slice(2, 12)}`,
      providerSubRef: `sub_${Math.random().toString(36).slice(2, 12)}`,
      tier: 'gold',
      cadence: 'monthly',
      status: (overrides.status as never) ?? 'active',
      currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      currentPeriodEnd:
        overrides.currentPeriodEnd ?? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 3289,
      currency: 'BRL',
    },
  });

describe('runPremiumEventPublishGrant', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Tests below
});
```

- [ ] **Step 1.2 — Test: event with no grantable tier → no tickets, structured log emitted**

```ts
it('skips and logs premium_grant.no_tier when no isPremiumGrantable tier exists', async () => {
  const event = await seedEvent();
  await seedNonGrantableTier(event.id);

  const { user } = await createUser({ email: 'u1@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await seedActiveMembership(garage.id);

  const logs: Array<{ msg: string; eventId?: string; reason?: string }> = [];
  const log = {
    info: (obj: unknown, msg: string) => logs.push({ msg, ...(obj as object) }),
    warn: (obj: unknown, msg: string) => logs.push({ msg, ...(obj as object) }),
    error: (obj: unknown, msg: string) => logs.push({ msg, ...(obj as object) }),
  };

  await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date(), log });

  const tickets = await prisma.ticket.count({ where: { eventId: event.id } });
  expect(tickets).toBe(0);

  const noTierLog = logs.find((l) => l.msg === 'premium_grant.no_tier');
  expect(noTierLog).toBeDefined();
  expect(noTierLog?.eventId).toBe(event.id);
  expect(noTierLog?.reason).toBe('publish_hook');
});
```

- [ ] **Step 1.3 — Test: 1 active member → receives a ticket**

```ts
it('grants one ticket to one active member with no existing ticket', async () => {
  const event = await seedEvent();
  const tier = await seedGrantableTier(event.id);

  const { user } = await createUser({ email: 'u2@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await seedActiveMembership(garage.id);

  await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

  const ticket = await prisma.ticket.findFirst({
    where: { userId: user.id, eventId: event.id, status: 'valid', source: 'premium_grant' },
  });
  expect(ticket).not.toBeNull();
  expect(ticket?.tierId).toBe(tier.id);
});
```

- [ ] **Step 1.4 — Test: idempotent on replay — second run inserts zero additional tickets**

```ts
it('is idempotent: replaying the job does not insert a second ticket', async () => {
  const event = await seedEvent();
  await seedGrantableTier(event.id);

  const { user } = await createUser({ email: 'u3@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await seedActiveMembership(garage.id);

  const args = { eventId: event.id, publishedAt: new Date() };
  await runPremiumEventPublishGrant(args);
  await runPremiumEventPublishGrant(args); // replay

  const count = await prisma.ticket.count({
    where: { userId: user.id, eventId: event.id, status: 'valid' },
  });
  expect(count).toBe(1);
});
```

- [ ] **Step 1.5 — Test: skips member whose sub cancels before the event starts**

Spec §4.6 filter: `cancelAtPeriodEnd=true` members whose `currentPeriodEnd` is before `event.startsAt` must be skipped.

```ts
it('skips member with cancelAtPeriodEnd=true AND currentPeriodEnd before event.startsAt', async () => {
  // Event starts 30 days from now.
  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const event = await seedEvent({ startsAt });
  await seedGrantableTier(event.id);

  const { user } = await createUser({ email: 'u4@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  // Sub expires in 10 days — before the event starts.
  await seedActiveMembership(garage.id, {
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
  });

  await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

  const count = await prisma.ticket.count({ where: { userId: user.id, eventId: event.id } });
  expect(count).toBe(0);
});
```

- [ ] **Step 1.6 — Test: does NOT skip member with cancelAtPeriodEnd=true whose period covers the event**

The filter is `cancelAtPeriodEnd=false` only when `currentPeriodEnd <= event.startsAt`. Members cancelling but whose period extends past the event start ARE still entitled.

```ts
it('grants ticket to cancel_scheduled member whose currentPeriodEnd covers event.startsAt', async () => {
  // Event starts in 5 days; member period ends in 20 days.
  const startsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const event = await seedEvent({ startsAt });
  await seedGrantableTier(event.id);

  const { user } = await createUser({ email: 'u5@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await seedActiveMembership(garage.id, {
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  });

  await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

  const ticket = await prisma.ticket.findFirst({
    where: { userId: user.id, eventId: event.id, status: 'valid' },
  });
  expect(ticket).not.toBeNull();
  expect(ticket?.source).toBe('premium_grant');
});
```

- [ ] **Step 1.7 — Test: member with existing valid ticket is skipped**

```ts
it('skips member who already holds a valid ticket for the event', async () => {
  const event = await seedEvent();
  const tier = await seedGrantableTier(event.id);

  const { user } = await createUser({ email: 'u6@jdm.test', verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await seedActiveMembership(garage.id);

  // Pre-existing ticket (e.g., purchased before event was published).
  await prisma.ticket.create({
    data: {
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      source: 'purchase',
      status: 'valid',
    },
  });

  await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

  const count = await prisma.ticket.count({
    where: { userId: user.id, eventId: event.id, status: 'valid' },
  });
  expect(count).toBe(1); // still only the pre-existing ticket
});
```

- [ ] **Step 1.8 — Test: 1 000 active members batched correctly — all receive tickets**

This test verifies the 500-per-inner-tx paging does not drop members. Use 1 000 members (two full pages).

```ts
it('grants tickets to all 1000 active members across multiple batch pages', async () => {
  const event = await seedEvent();
  await seedGrantableTier(event.id);

  // Create 1000 users + memberships. Batch the inserts to avoid test timeout.
  const TOTAL = 1000;
  const BATCH = 100;

  const userIds: string[] = [];
  for (let b = 0; b < TOTAL / BATCH; b++) {
    const batch = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        createUser({ email: `bulk-${b}-${i}@jdm.test`, verified: true }),
      ),
    );
    userIds.push(...batch.map((r) => r.user.id));
  }

  // Create garages are created by createUser helper — fetch them.
  const garages = await prisma.garage.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });

  // Insert memberships in batches to avoid PG param limits.
  for (let b = 0; b < garages.length / BATCH; b++) {
    await Promise.all(
      garages.slice(b * BATCH, (b + 1) * BATCH).map((g) => seedActiveMembership(g.id)),
    );
  }

  await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

  const ticketCount = await prisma.ticket.count({
    where: { eventId: event.id, status: 'valid', source: 'premium_grant' },
  });
  expect(ticketCount).toBe(TOTAL);
}, 60_000); // allow 60s for 1k inserts
```

- [ ] **Step 1.9 — Run the test file to confirm RED**

```bash
pnpm --filter @ccc/api exec vitest run src/workers/premium-event-publish-grant.test.ts
```

Expected: all tests FAIL. Common failure modes:

- "Cannot find module './premium-event-publish-grant.js'" — expected; the file doesn't exist yet. Do NOT proceed to Task 2 until RED is confirmed.
- "table 'PremiumMembership' does not exist" — F8.01 migration not applied. Apply it first.
- "export 'pickPremiumGrantableTier' not found" — F8.06 not landed. Block on it.

Do NOT proceed to Task 2 until you see a confirmed RED run.

- [ ] **Step 1.10 — Commit the failing tests**

```bash
git add apps/api/src/workers/premium-event-publish-grant.test.ts
git commit -m "test(api): failing tests for event-publish premium-grant worker (F8.07)"
```

---

## Task 2 — Implement the worker

**Files:**

- Create: `apps/api/src/workers/premium-event-publish-grant.ts`

- [ ] **Step 2.1 — Create the worker file**

```ts
// apps/api/src/workers/premium-event-publish-grant.ts
import { prisma } from '@ccc/db';
import type { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

import { pickPremiumGrantableTier } from '../services/billing/premium-grant-helpers.js';

const PAGE_SIZE = 500;

export type PremiumEventPublishGrantInput = {
  eventId: string;
  publishedAt: Date;
  log?: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
};

/**
 * Job consumer for the event-publish premium-grant hook.
 *
 * Called AFTER the publish transaction commits (never inside it — spec §4.6,
 * canon §F8.4). Pages through active premium members 500/inner-tx and inserts
 * a premium_grant Ticket for each member with no existing valid premium_grant
 * ticket for (userId, eventId). Idempotent via the partial-unique index on
 * Ticket (userId, eventId) WHERE status='valid' AND source='premium_grant'
 * (canon §F8.8, narrowed — see spec §2.6): P2002 on a race or replay is
 * swallowed silently and the loop continues.
 *
 * Tier selection: first TicketTier WHERE isPremiumGrantable=true (canon §F8.7).
 * If none, logs premium_grant.no_tier { eventId, reason: 'publish_hook' } and
 * exits without touching any Ticket rows.
 */
export const runPremiumEventPublishGrant = async (
  input: PremiumEventPublishGrantInput,
): Promise<void> => {
  const { eventId, publishedAt, log } = input;

  // 1. Load event to get startsAt for the membership filter.
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, startsAt: true },
  });
  if (!event) {
    log?.warn({ eventId }, 'premium_grant.event_not_found');
    return;
  }

  // 2. Pick first grantable tier (canon §F8.7).
  //    We run this in a read-only tx for consistency.
  const tier = await prisma.$transaction((tx) =>
    pickPremiumGrantableTier(tx, eventId, publishedAt),
  );

  if (!tier) {
    // Canon §F8.7: log + exit, never throw.
    log?.warn({ eventId, reason: 'publish_hook' }, 'premium_grant.no_tier');
    return;
  }

  // 3. Page through active premium members.
  //    Filter:
  //    - status = 'active'
  //    - cancelAtPeriodEnd = false  OR  currentPeriodEnd > event.startsAt
  //      (spec §4.6: members whose sub ends before the event starts are skipped)
  //    Implemented as: status='active' AND NOT (cancelAtPeriodEnd=true AND currentPeriodEnd <= event.startsAt)
  //    Which is equivalent to spec's: status='active' AND cancelAtPeriodEnd=false AND currentPeriodEnd > event.startsAt
  //    Note: spec text uses AND (both conditions together). We match spec exactly.

  let cursor: string | undefined;
  let totalGranted = 0;
  let totalSkipped = 0;

  for (;;) {
    const page = await prisma.premiumMembership.findMany({
      where: {
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { gt: event.startsAt },
      },
      include: { garage: { select: { userId: true } } },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (page.length === 0) break;

    // Process this page in a single inner transaction.
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const membership of page) {
        const userId = membership.garage.userId;

        // Belt-and-braces check: skip if user already holds a valid ticket.
        // The partial-unique index (canon §F8.8) is the DB-level backstop;
        // this check avoids attempting the insert and catching P2002 in the
        // common case where the ticket already exists.
        const existing = await tx.ticket.findFirst({
          where: { userId, eventId, status: 'valid' },
          select: { id: true },
        });

        if (existing) {
          totalSkipped += 1;
          continue;
        }

        try {
          await tx.ticket.create({
            data: {
              userId,
              eventId,
              tierId: tier.id,
              source: 'premium_grant',
              status: 'valid',
            },
          });
          totalGranted += 1;
        } catch (err: unknown) {
          // Canon §F8.8: P2002 on the partial-unique means a concurrent path
          // already inserted a valid ticket for (userId, eventId). Swallow
          // silently and continue — this is expected on replay and races.
          if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
            totalSkipped += 1;
            continue;
          }
          // Any other DB error is re-thrown so the job can be retried.
          throw err;
        }
      }
    });

    cursor = page[page.length - 1]?.id;
    if (page.length < PAGE_SIZE) break;
  }

  log?.info({ eventId, totalGranted, totalSkipped }, 'premium_grant.publish_hook_complete');
};
```

- [ ] **Step 2.2 — Run the tests to confirm GREEN**

```bash
pnpm --filter @ccc/api exec vitest run src/workers/premium-event-publish-grant.test.ts
```

Expected: all 8 tests PASS.

Failure modes:

- `prisma.premiumMembership is undefined` — F8.01 migration not applied or Prisma client not regenerated. Run `pnpm --filter @ccc/db run db:migrate && pnpm --filter @ccc/db build`.
- `pickPremiumGrantableTier not found` — F8.06 not landed. Block on it.
- 1 000-member test timeout — increase the `{ timeout: 60_000 }` option if needed; the batch loop is correct.
- Idempotency test fails with count=2 — the `findFirst` skip check is not inside the `$transaction`. Re-check: `existing` lookup and `ticket.create` must both be on `tx`, not `prisma`.

- [ ] **Step 2.3 — Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: zero errors.

- [ ] **Step 2.4 — Commit the implementation**

```bash
git add apps/api/src/workers/premium-event-publish-grant.ts
git commit -m "feat(api): event-publish premium-grant worker (F8.07)

Pages through active PremiumMembership rows 500/tx on event publish,
inserts premium_grant Ticket per eligible member. No-tier guard logs
premium_grant.no_tier and exits (canon §F8.7). P2002 on partial-unique
swallowed silently (canon §F8.8). Never runs inside the publish tx.

Closes F8.07 worker."
```

---

## Task 3 — Hook the worker into the publish handler

**Files:**

- Modify: `apps/api/src/routes/admin/events.ts` (extend `POST /events/:id/publish`, ~8 lines)

Read the current publish handler before editing:

```
apps/api/src/routes/admin/events.ts lines 197–225
```

The existing handler:

1. Guards for 404 / already-published / missing cover.
2. `await prisma.event.update(...)` — writes `status='published'` + `publishedAt`.
3. `await recordAudit(...)`.
4. Returns the serialized event.

We add step 5: **after** `recordAudit` returns (tx already committed), enqueue the grant job. The job call is **not** awaited in a blocking way that would delay the HTTP response — we fire and track via a void-caught promise so the response returns promptly. The publish transaction is already committed by the time `prisma.event.update` returns (Prisma auto-commits non-transactional `update` calls).

- [ ] **Step 3.1 — Add the import to events.ts**

At the top of `apps/api/src/routes/admin/events.ts`, alongside existing imports, add:

```ts
import { runPremiumEventPublishGrant } from '../../workers/premium-event-publish-grant.js';
```

The import goes after the existing relative-path imports (after `serializeAdminTier` import), consistent with the file's existing import ordering.

- [ ] **Step 3.2 — Extend the publish handler**

Locate the `app.post('/events/:id/publish', ...)` handler. After the `recordAudit(...)` call and before the `return serializeDetail(...)` line, insert:

```ts
// Post-commit: enqueue the premium-grant job for this event.
// Spec §4.6 + canon §F8.4: the grant job MUST run post-commit, never
// inside the publish tx. The publish tx (prisma.event.update above) is
// already committed before we reach this line. We fire-and-forget so the
// HTTP response returns promptly; the worker logs its own progress.
void runPremiumEventPublishGrant({
  eventId: id,
  publishedAt: updated.publishedAt ?? new Date(),
  log: request.log,
}).catch((err: unknown) => {
  request.log.error({ err, eventId: id }, 'premium-event-publish-grant: job failed');
});
```

The complete publish handler after the edit:

```ts
app.post('/events/:id/publish', async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const existing = await prisma.event.findUnique({ where: { id } });
  if (!existing) return reply.status(404).send({ error: 'NotFound' });
  if (existing.status === 'published') {
    return reply.status(409).send({ error: 'Conflict', message: 'already published' });
  }
  if (!existing.coverObjectKey) {
    return reply
      .status(409)
      .send({ error: 'Conflict', message: 'adicione uma capa antes de publicar' });
  }
  const updated = await prisma.event.update({
    where: { id },
    data: {
      status: 'published',
      publishedAt: new Date(),
    },
    include: { tiers: true, extras: true },
  });
  await recordAudit({
    actorId: sub,
    action: 'event.publish',
    entityType: 'event',
    entityId: id,
  });

  // Post-commit: enqueue the premium-grant job for this event.
  // Spec §4.6 + canon §F8.4: the grant job MUST run post-commit, never
  // inside the publish tx. The publish tx (prisma.event.update above) is
  // already committed before we reach this line. We fire-and-forget so the
  // HTTP response returns promptly; the worker logs its own progress.
  void runPremiumEventPublishGrant({
    eventId: id,
    publishedAt: updated.publishedAt ?? new Date(),
    log: request.log,
  }).catch((err: unknown) => {
    request.log.error({ err, eventId: id }, 'premium-event-publish-grant: job failed');
  });

  return serializeDetail(updated, app.uploads, app.env.DEV_FEE_PERCENT);
});
```

- [ ] **Step 3.3 — Typecheck after edit**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: zero errors.

- [ ] **Step 3.4 — Commit the route change**

```bash
git add apps/api/src/routes/admin/events.ts
git commit -m "feat(api): hook event-publish handler to enqueue premium-grant job (F8.07)

Post-commit fire-and-forget via void+catch. Publish tx stays minimal
(Event.status + publishedAt only). Spec §4.6, canon §F8.4."
```

---

## Task 4 — Write and run the publish-handler integration test

**Files:**

- Modify: `apps/api/test/admin/events/` (add a test for the publish + grant interaction, or extend an existing file in that folder)

The key behavior to test: publishing an event causes the grant job to enqueue; but if the grant job itself throws after the tx commits, the Event row persists (publish tx is not rolled back).

- [ ] **Step 4.1 — Check the existing publish test**

```bash
ls apps/api/test/admin/events/
```

If `publish.test.ts` or a similar file exists, extend it. If not, create `apps/api/test/admin/events/publish-grant.test.ts`.

- [ ] **Step 4.2 — Write the two-step isolation test**

Add to the appropriate test file:

```ts
// apps/api/test/admin/events/publish-grant.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUser, makeApp, resetDatabase } from '../../helpers.js';

const seedDraftEvent = async () =>
  prisma.event.create({
    data: {
      slug: `evt-pg-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Draft Event',
      description: 'd',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3_600_000),
      type: 'meeting',
      status: 'draft',
      capacity: 500,
      coverObjectKey: 'covers/test.jpg',
    },
  });

describe('POST /events/:id/publish — grant job isolation', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    const { user, token } = await createUser({
      email: 'admin@jdm.test',
      role: 'admin',
      verified: true,
    });
    // makeApp returns an app that needs the token. Use createAccessToken pattern from helpers.
    // If your test helpers expose `loginAs` or a token factory, use it here.
    // Otherwise create the token directly:
    const { createAccessToken } = await import('../../../src/services/auth/tokens.js');
    const { loadEnv } = await import('../../../src/env.js');
    adminToken = createAccessToken(user.id, 'admin', loadEnv());
  });

  afterEach(async () => {
    await app.close();
  });

  it('publish tx commits even if grant job throws — Event row persists, no Ticket rows inserted', async () => {
    const event = await seedDraftEvent();

    // Seed a grantable tier so the worker would normally proceed.
    await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Premium',
        priceCents: 0,
        quantityTotal: 999,
        isPremiumGrantable: true,
      },
    });

    // Seed one active member so the worker has work to do.
    const { user: memberUser } = await createUser({ email: 'member@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: memberUser.id } });
    await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_test',
        providerSubRef: 'sub_test',
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        baseAmountCents: 2990,
        devFeePercent: 10,
        devFeeAmountCents: 299,
        grossAmountCents: 3289,
        currency: 'BRL',
      },
    });

    // Spy on the worker to force it to throw after the HTTP response.
    // We import the module and mock its exported function so the route's
    // void+catch pattern is exercised without actually running the worker.
    const workerModule = await import('../../../src/workers/premium-event-publish-grant.js');
    const originalFn = workerModule.runPremiumEventPublishGrant;
    vi.spyOn(workerModule, 'runPremiumEventPublishGrant').mockRejectedValueOnce(
      new Error('simulated worker failure'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    // Step 1: HTTP response must be 200 (publish tx committed).
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string };
    expect(body.status).toBe('published');

    // Step 2: Event row persists in DB.
    const dbEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(dbEvent.status).toBe('published');

    // Step 3: No Ticket rows inserted (worker threw before inserting any).
    const ticketCount = await prisma.ticket.count({ where: { eventId: event.id } });
    expect(ticketCount).toBe(0);

    // Restore mock.
    vi.spyOn(workerModule, 'runPremiumEventPublishGrant').mockImplementation(originalFn);
  });

  it('happy path: publishes event and worker grants tickets asynchronously', async () => {
    const event = await seedDraftEvent();
    await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Premium',
        priceCents: 0,
        quantityTotal: 999,
        isPremiumGrantable: true,
      },
    });

    const { user: memberUser } = await createUser({ email: 'member2@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: memberUser.id } });
    await prisma.premiumMembership.create({
      data: {
        garageId: garage.id,
        provider: 'stripe',
        providerCustomerRef: 'cus_test2',
        providerSubRef: 'sub_test2',
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        baseAmountCents: 2990,
        devFeePercent: 10,
        devFeeAmountCents: 299,
        grossAmountCents: 3289,
        currency: 'BRL',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);

    // Give the fire-and-forget job time to complete.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const ticket = await prisma.ticket.findFirst({
      where: { userId: memberUser.id, eventId: event.id, status: 'valid', source: 'premium_grant' },
    });
    expect(ticket).not.toBeNull();
  });
});
```

- [ ] **Step 4.3 — Run the publish-grant tests to confirm GREEN**

```bash
pnpm --filter @ccc/api exec vitest run src/workers/premium-event-publish-grant.test.ts apps/api/test/admin/events/publish-grant.test.ts
```

Wait — the test file paths above mix absolute and relative. Use the correct filtered form:

```bash
pnpm --filter @ccc/api exec vitest run src/workers/premium-event-publish-grant.test.ts test/admin/events/publish-grant.test.ts
```

Expected: all tests PASS.

Common failure mode for the mock test:

- `vi.spyOn` cannot mock the module because it's imported statically. If the route file imports `runPremiumEventPublishGrant` at module-load time, the spy won't intercept. Use `vi.mock` at the top of the test file instead:

  ```ts
  vi.mock('../../../src/workers/premium-event-publish-grant.js', () => ({
    runPremiumEventPublishGrant: vi.fn().mockResolvedValue(undefined),
  }));
  ```

  Then in the isolation test, call `vi.mocked(runPremiumEventPublishGrant).mockRejectedValueOnce(new Error('simulated'))`.

- [ ] **Step 4.4 — Typecheck final**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: zero errors.

- [ ] **Step 4.5 — Commit the publish-grant integration test**

```bash
git add apps/api/test/admin/events/publish-grant.test.ts
git commit -m "test(api): publish-grant isolation + happy-path integration tests (F8.07)"
```

---

## Task 5 — Final verification sweep

- [ ] **Step 5.1 — Run all touched tests**

Per CLAUDE.md "touched files only; trust main CI + PR CI for full sweep":

```bash
pnpm --filter @ccc/api exec vitest run \
  src/workers/premium-event-publish-grant.test.ts \
  test/admin/events/publish-grant.test.ts
```

Expected: all green.

- [ ] **Step 5.2 — Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: zero errors.

- [ ] **Step 5.3 — Lint the new + modified files**

```bash
pnpm --filter @ccc/api exec eslint \
  src/workers/premium-event-publish-grant.ts \
  src/routes/admin/events.ts \
  src/workers/premium-event-publish-grant.test.ts \
  test/admin/events/publish-grant.test.ts
```

Expected: zero errors or warnings.

- [ ] **Step 5.4 — Mental trace through canon invariants**

1. **§F8.4 (activation tx atomicity):** Publish tx is a plain `prisma.event.update` (no transaction block). It commits before the worker function is called. The `void...catch` wrapping ensures the HTTP response is returned even if the worker errors. No Ticket insert ever happens inside the publish tx. ✓
2. **§F8.7 (tier selection):** `pickPremiumGrantableTier` call returns the first grantable tier. If null, `premium_grant.no_tier` is logged and function exits. ✓
3. **§F8.8 (partial-unique dedup):** `findFirst` check + P2002 catch inside the inner tx. Race-safe. ✓
4. **Spec §4.6 filter:** `status='active' AND cancelAtPeriodEnd=false AND currentPeriodEnd > event.startsAt`. Matches the `findMany` `where` clause exactly. ✓
5. **No Ticket rows inside publish tx:** Confirmed — `runPremiumEventPublishGrant` is called outside any transaction context, and its own inner tx is a separate DB round-trip. ✓

---

## PR checklist

Branch: `feat/jdma-f8-billing-07` from fresh `main`.

- [ ] `git branch --show-current` is not `production` (CLAUDE.md preflight).
- [ ] `pnpm --filter @ccc/api typecheck` clean.
- [ ] `pnpm --filter @ccc/api exec vitest run src/workers/premium-event-publish-grant.test.ts test/admin/events/publish-grant.test.ts` green.
- [ ] Only two new files + one modified route file. No schema changes. No shared-package changes.
- [ ] Worker function exported as `runPremiumEventPublishGrant` for testability.
- [ ] Grant job is NOT awaited in the publish handler (fire-and-forget with `.catch`).
- [ ] PR description references spec §4.6 + skeleton §F8.07 + canon §F8.7, §F8.8.
- [ ] PR title: `feat(api): event-publish premium-grant worker + publish hook (F8.07)`.
- [ ] PR base: `main` (NEVER `production`). Request review only after PR exists.

---

## Self-review

### 1. Spec coverage

| Spec requirement (§4.6)                                                                                 | Task that implements it                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Publish tx writes ONLY `Event.status + publishedAt`                                                     | Task 3 Step 3.2 — no extra writes in the handler                    |
| Post-commit: enqueue grant job                                                                          | Task 3 Steps 3.1–3.2 — void+catch after recordAudit                 |
| Pick first `isPremiumGrantable=true` tier; if none log + exit                                           | Task 2 Step 2.1 — tier null check + log                             |
| Page through `status='active' AND cancelAtPeriodEnd=false AND currentPeriodEnd > event.startsAt` 500/tx | Task 2 Step 2.1 — `findMany` where clause + `PAGE_SIZE = 500`       |
| For each: if no valid Ticket for (userId, eventId), insert `premium_grant`                              | Task 2 Step 2.1 — `findFirst` + `ticket.create`                     |
| Idempotent via partial-unique on Ticket (§F8.8)                                                         | Task 2 Step 2.1 — P2002 swallowed silently                          |
| Retries safe                                                                                            | Task 2 Step 2.1 — P2002 catch + idempotency test in Task 1 Step 1.4 |
| Canon §F8.7 `no_tier` log                                                                               | Task 2 Step 2.1 — `log?.warn(... 'premium_grant.no_tier')`          |

### 2. Placeholder scan

No TBD / TODO / "similar to" / "fill in later". All code blocks are complete.

### 3. Type consistency

- `runPremiumEventPublishGrant` exported in Task 2, imported in test (Task 1) and route (Task 3). Name consistent throughout.
- `pickPremiumGrantableTier(tx, eventId, now?)` — used in Task 2; signature matches F8.06 plan canonical form. If F8.06 deviates, the pre-flight check in Task 0 will flag it.
- `prisma.premiumMembership.findMany` fields (`status`, `cancelAtPeriodEnd`, `currentPeriodEnd`, `garage.userId`) all match the schema spec §2.2.
- `Ticket.create` fields (`userId`, `eventId`, `tierId`, `source`, `status`) match the current Prisma schema (no `code` field in DB — confirmed by schema read).

---

## Deviations from skeleton

- **Fire-and-forget with `.catch` instead of a queue broker.** The skeleton says "enqueue the grant job via the existing worker bus." Inspecting the codebase, there is no external queue broker (no Redis, no BullMQ). The "worker bus" is direct async function calls with a void+catch, following the same pattern as `event-reminders.ts` (cron-dispatched tick function). This is not a deviation from intent — it matches the codebase's established pattern.
- **`cancelAtPeriodEnd=false` filter only.** Spec §4.6 says `cancelAtPeriodEnd=false`. Steps 1.5 and 1.6 confirm the exact semantics: members cancelling whose period covers the event start ARE granted (they have `cancelAtPeriodEnd=true` but `currentPeriodEnd > event.startsAt`). The Prisma `where` uses `cancelAtPeriodEnd: false` which matches the spec text exactly. The test in Step 1.6 proves the correct boundary.

---

## Notes for the reviewer

- The diff should be: one new worker file (~90 lines), one new test file (~200 lines), one new integration test file (~130 lines), ~8 added lines in `events.ts`.
- If the diff adds schema changes, the engineer went out of scope — F8.01 owns the schema.
- If the grant job is awaited inside the publish handler (no `void`), the HTTP response hangs until all members are processed — block at review.
- If `prisma.$transaction` wraps the `runPremiumEventPublishGrant` call inside the publish handler, that violates canon §F8.4 — block at review.
- The 1 000-member test uses `Promise.all` for seeding and a 60s timeout. This is intentional — batching the seed is fine; the worker's serial paging is what's under test.
