# F8.01 — Schema migration + env flag + zod skeletons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Prisma schema deltas for premium billing (`PremiumProvider`, `PremiumCadence`, `PremiumMembershipStatus` enums; `PremiumMembership`, `PremiumMembershipInvoice`, `SubscriptionWebhookEvent` models; `TicketTier.isPremiumGrantable` flag), append two raw-SQL partial unique indexes to the migration file, add `GROWTH_PREMIUM_BILLING_ENABLED`, `STRIPE_BILLING_WEBHOOK_SECRET`, and `REVENUECAT_WEBHOOK_AUTH_HEADER` to the env zod schema, and scaffold an empty `packages/shared/src/premium.ts` re-exported from `packages/shared/src/index.ts`.

**Architecture:** Schema-only delta + env flag + shared scaffold. No service code, no routes, no UI. Migration file is Prisma-generated with two raw SQL statements manually appended for the partial unique indexes that Prisma's DSL cannot express. Feature flag defaults to `false`; all F8 routes gate on it (canon §F8.11). `packages/shared/src/premium.ts` ships empty (`export {};`) so downstream F8 chunks can import from it without a build-order hazard — F8.11 populates the actual zod schemas.

**Tech Stack:** Prisma 5 + Postgres 16. Testcontainers-Postgres for integration tests (shared global-setup in `apps/api/test/global-setup.ts`). vitest. pnpm workspaces (`@jdm/db`, `@jdm/api`, `@jdm/shared`). zod (env schema in `apps/api/src/env.ts`).

---

## Branch safety preflight (per CLAUDE.md)

```bash
git branch --show-current
# If output is `production` → STOP. Switch to main first.
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-01
```

Never branch from `production`. Never commit on `production`. PRs target `main` only.

---

## File structure

```
packages/db/prisma/schema.prisma                                           (modify)
packages/db/prisma/migrations/<ts>_f8_premium_billing/migration.sql        (new, generated + appended)
packages/shared/src/premium.ts                                             (new — empty scaffold)
packages/shared/src/index.ts                                               (modify — add re-export)
apps/api/src/env.ts                                                        (modify — add 3 env entries)
apps/api/test/billing/schema-f8.test.ts                                    (new)
apps/api/test/env.test.ts                                                  (modify — extend)
```

---

## Canon refs for this chunk

- **§F8.8** — partial unique `ticket_one_premium_grant_per_user_event ON "Ticket" ("userId","eventId") WHERE status = 'valid' AND source = 'premium_grant'` lands here. **Narrowed scope vs initial draft:** an earlier draft of canon §F8.8 omitted the `source` predicate, but external review of PR #445 surfaced that migration `20260503163319_drop_ticket_user_event_unique` had explicitly dropped the broader form to support multi-ticket purchases (`Event.maxTicketsPerUser > 1`) and multi-comp grants. The premium-grant flows (F8.06 backfill, F8.07 publish-hook) only ever create `source='premium_grant'` rows; narrowing the index gives them DB-level idempotency without regressing purchase/comp flows.
- **§F8.11** — `GROWTH_PREMIUM_BILLING_ENABLED` feature flag added here; default `false`.
- **§F8.13** — rebuild `@jdm/shared` after any schema/export change.
- Phase 2 **§C1** — `XpEvent @@unique([garageId, reason, sourceRef])` carries forward; no change in this chunk.

---

## Task 1 — Extend `schema.prisma`

**Files:**

- Modify: `packages/db/prisma/schema.prisma` — add 3 enums, 3 models, 1 field on `TicketTier`.

- [ ] **Step 1.1 — Add the three new enums**

Place immediately after the `GaragePremiumTier` enum (currently ending around line 193) and before the `Garage` model:

```prisma
enum PremiumProvider {
  stripe
  apple_revenuecat
}

enum PremiumCadence {
  monthly
  annual
}

enum PremiumMembershipStatus {
  trialing
  active
  past_due
  cancel_scheduled
  expired
  paused
}
```

Notes:

- `trialing` is reserved for future use; v1 code paths never produce it (spec §2.1).
- `paused` is RC-specific; treated as inactive for entitlement checks.
- Enum placement before `Garage` keeps all premium types grouped with the existing `GaragePremiumTier` enum.

- [ ] **Step 1.2 — Add the `PremiumMembership` model**

Place after the `XpEvent` model (currently ending around line 285) and before the `Car` model:

```prisma
model PremiumMembership {
  id                  String                  @id @default(cuid())
  garageId            String
  provider            PremiumProvider
  providerCustomerRef String                  @db.VarChar(120)
  providerSubRef      String                  @db.VarChar(120)
  tier                GaragePremiumTier
  cadence             PremiumCadence
  status              PremiumMembershipStatus
  currentPeriodStart  DateTime
  currentPeriodEnd    DateTime
  cancelAtPeriodEnd   Boolean                 @default(false)
  cancelledAt         DateTime?

  // Pricing snapshot — refreshed on activation/renewal/tier_changed.
  // Stripe: baseAmountCents + devFeePercent from Stripe.Price.metadata (canon §F8.1).
  // Apple/RC: baseAmountCents = grossAmountCents, devFeePercent = 0, devFeeAmountCents = 0.
  baseAmountCents     Int
  devFeePercent       Int
  devFeeAmountCents   Int
  grossAmountCents    Int
  currency            String                  @db.VarChar(3)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  garage   Garage                       @relation(fields: [garageId], references: [id], onDelete: Cascade)
  invoices PremiumMembershipInvoice[]

  @@unique([provider, providerSubRef])
  @@index([garageId, status])
  @@index([currentPeriodEnd])
}
```

Notes:

- `devFeePercent Int` has **no default** — the server MUST always set this explicitly (spec §2.2). Prisma will require it on every create/update.
- `@@unique([provider, providerSubRef])` is the hard idempotency key for Stripe sub / RC entitlement ID.
- The partial unique `premium_membership_live_per_garage` (enforcing one live row per garage) is a raw-SQL index appended to the migration file in Task 2. Prisma's DSL cannot express `WHERE` clauses on unique indexes.
- Add back-relation to `Garage` in Step 1.5 below.

- [ ] **Step 1.3 — Add the `PremiumMembershipInvoice` model**

Place immediately after `PremiumMembership`:

```prisma
model PremiumMembershipInvoice {
  id                     String          @id @default(cuid())
  membershipId           String
  provider               PremiumProvider
  providerInvoiceRef     String          @db.VarChar(120)
  providerTransactionRef String?         @db.VarChar(200)
  periodStart            DateTime
  periodEnd              DateTime
  baseAmountCents        Int
  devFeePercent          Int
  devFeeAmountCents      Int
  grossAmountCents       Int
  currency               String          @db.VarChar(3)
  paidAt                 DateTime
  refundedAt             DateTime?
  refundedAmountCents    Int?
  status                 String          @db.VarChar(20)
  createdAt              DateTime        @default(now())

  membership PremiumMembership @relation(fields: [membershipId], references: [id], onDelete: Cascade)

  @@unique([provider, providerInvoiceRef])
  @@index([membershipId, periodStart])
  @@index([paidAt])
}
```

Notes:

- `status` is `String @db.VarChar(20)` not an enum because it has only three values (`'paid'`, `'refunded'`, `'partial_refund'`) and is mutation-only from webhook handlers — no enum migration penalty on value additions.
- `@@unique([provider, providerInvoiceRef])` is layer-(b) webhook idempotency (canon §F8.15).
- `providerTransactionRef` stores the Apple `original_transaction_id`; nullable for Stripe invoices.

- [ ] **Step 1.4 — Add the `SubscriptionWebhookEvent` model**

Place immediately after `PremiumMembershipInvoice`:

```prisma
model SubscriptionWebhookEvent {
  id              String          @id @default(cuid())
  provider        PremiumProvider
  providerEventId String          @db.VarChar(200)
  type            String          @db.VarChar(80)
  payload         Json
  receivedAt      DateTime        @default(now())
  processedAt     DateTime?

  @@unique([provider, providerEventId])
  @@index([receivedAt])
}
```

Notes:

- `payload Json` is **load-bearing** for production debugging (spec §2.4). Do not omit.
- Separate from `PaymentWebhookEvent` (which uses the `PaymentProvider` enum covering `stripe` + `abacatepay`) — extending that enum to add `apple_revenuecat` would create orphan values for one-time Order provider reads (spec §2.4).

- [ ] **Step 1.5 — Add `isPremiumGrantable` to `TicketTier` + compound index**

In the `TicketTier` model, add after `requiresCar` (currently around line 404):

```prisma
  isPremiumGrantable Boolean   @default(false)
```

Then update the model's `@@index` block — add a new index after `@@index([eventId, sortOrder])`:

```prisma
  @@index([eventId, isPremiumGrantable])
```

The full `TicketTier` index section should read:

```prisma
  @@index([eventId, sortOrder])
  @@index([eventId, isPremiumGrantable])
```

- [ ] **Step 1.6 — Add back-relations to `Garage`**

In the `Garage` model relations block (after `xpEvents XpEvent[]`, around line 213), add:

```prisma
  premiumMemberships PremiumMembership[]
```

- [ ] **Step 1.7 — Run `prisma format` and `prisma generate`**

```bash
pnpm --filter @jdm/db exec prisma format
pnpm --filter @jdm/db prisma generate
```

Expected: no parse errors. Client types now include `PremiumMembership`, `PremiumMembershipInvoice`, `SubscriptionWebhookEvent`, updated `TicketTier`. If `format` reorders declarations, accept — Prisma's canonical ordering wins.

---

## Task 2 — Generate + append the migration

**Files:**

- Create: `packages/db/prisma/migrations/<ts>_f8_premium_billing/migration.sql`

- [ ] **Step 2.1 — Generate the migration (no apply)**

```bash
pnpm --filter @jdm/db prisma migrate dev --create-only --name f8_premium_billing
```

`--create-only` produces the file without applying it to the local dev DB.

- [ ] **Step 2.2 — Verify the generated SQL shape**

Open the generated `migration.sql`. Prisma generates statements in this order: enums first, then table creates, then indexes, then foreign keys. Confirm the file includes:

```sql
-- CreateEnum
CREATE TYPE "PremiumProvider" AS ENUM ('stripe', 'apple_revenuecat');

-- CreateEnum
CREATE TYPE "PremiumCadence" AS ENUM ('monthly', 'annual');

-- CreateEnum
CREATE TYPE "PremiumMembershipStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancel_scheduled', 'expired', 'paused');

-- AlterTable (TicketTier.isPremiumGrantable)
ALTER TABLE "TicketTier" ADD COLUMN "isPremiumGrantable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable PremiumMembership
-- CreateTable PremiumMembershipInvoice
-- CreateTable SubscriptionWebhookEvent

-- CreateIndex (all @@index and @@unique declarations)

-- AddForeignKey (PremiumMembership → Garage, PremiumMembershipInvoice → PremiumMembership)
```

If Prisma omits or reorders anything, reconcile with the schema before proceeding.

- [ ] **Step 2.3 — Append the two raw partial unique indexes**

At the end of the generated `migration.sql`, append exactly:

```sql
-- Raw partial unique: one live PremiumMembership row per garage (spec §2.2 + canon §F8)
-- Expired rows accumulate as history. Re-subscribe = fresh row insert.
CREATE UNIQUE INDEX premium_membership_live_per_garage
  ON "PremiumMembership" ("garageId")
  WHERE status IN ('active', 'past_due', 'cancel_scheduled');

-- Raw partial unique: one valid premium_grant Ticket per (user, event) (spec §2.6 + canon §F8.8).
-- NARROWED to source='premium_grant'. Broader (status='valid') form was dropped earlier in
-- migration 20260503163319_drop_ticket_user_event_unique because multi-ticket purchases and
-- comp grants legitimately create multiple valid Ticket rows per (userId, eventId). The new
-- F8.06 backfill + F8.07 publish-hook only ever create source='premium_grant' rows, so this
-- narrowed index is their DB-level idempotency backstop without regressing purchase/comp.
CREATE UNIQUE INDEX ticket_one_premium_grant_per_user_event
  ON "Ticket" ("userId", "eventId")
  WHERE status = 'valid' AND source = 'premium_grant';
```

These two statements MUST be appended by hand — Prisma's schema DSL cannot express `WHERE` clauses on unique indexes. Do not add corresponding `@@unique` declarations to `schema.prisma`; the indexes will be managed by raw SQL only.

- [ ] **Step 2.4 — Apply the migration to the local dev DB**

```bash
pnpm --filter @jdm/db prisma migrate dev
```

Expected: applies cleanly. `prisma generate` runs implicitly at the tail.

- [ ] **Step 2.5 — Sanity-check the generated client types**

Confirm (via TypeScript hover or `index.d.ts`):

- `Prisma.PremiumMembershipCreateInput` exists and requires `devFeePercent`.
- `Prisma.PremiumMembershipInvoiceCreateInput` exists and requires `devFeePercent`, `status`.
- `Prisma.SubscriptionWebhookEventCreateInput` exists with `payload: Prisma.InputJsonValue`.
- `TicketTier` has `isPremiumGrantable: boolean`.
- `PremiumProvider`, `PremiumCadence`, `PremiumMembershipStatus` enums are exported from `@prisma/client`.

No file edits here — visual confirmation only.

---

## Task 3 — Add env entries

**Files:**

- Modify: `apps/api/src/env.ts` — add 3 entries to `envSchema`.

- [ ] **Step 3.1 — Write the failing env test**

```ts
// apps/api/test/env.test.ts  (extend existing file — add these cases)
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/env.js';

describe('env: F8 billing entries (chunk F8.01)', () => {
  const baseEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    REFRESH_TOKEN_PEPPER: 'b'.repeat(32),
    APP_WEB_BASE_URL: 'http://localhost:3000',
    MAIL_FROM: 'test@jdm.test',
    STRIPE_SECRET_KEY: 'sk_test_' + 'c'.repeat(32),
    STRIPE_WEBHOOK_SECRET: 'd'.repeat(32),
    TICKET_CODE_SECRET: 'e'.repeat(32),
    FIELD_ENCRYPTION_KEY: 'f'.repeat(64),
  } as NodeJS.ProcessEnv;

  it('GROWTH_PREMIUM_BILLING_ENABLED defaults to false when absent', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.GROWTH_PREMIUM_BILLING_ENABLED).toBe(false);
  });

  it('GROWTH_PREMIUM_BILLING_ENABLED parses "true" as true', () => {
    const env = loadEnv({ ...baseEnv, GROWTH_PREMIUM_BILLING_ENABLED: 'true' });
    expect(env.GROWTH_PREMIUM_BILLING_ENABLED).toBe(true);
  });

  it('GROWTH_PREMIUM_BILLING_ENABLED parses "false" as false', () => {
    const env = loadEnv({ ...baseEnv, GROWTH_PREMIUM_BILLING_ENABLED: 'false' });
    expect(env.GROWTH_PREMIUM_BILLING_ENABLED).toBe(false);
  });

  it('STRIPE_BILLING_WEBHOOK_SECRET is optional and absent by default', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.STRIPE_BILLING_WEBHOOK_SECRET).toBeUndefined();
  });

  it('STRIPE_BILLING_WEBHOOK_SECRET parses when provided', () => {
    const env = loadEnv({ ...baseEnv, STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_test123' });
    expect(env.STRIPE_BILLING_WEBHOOK_SECRET).toBe('whsec_test123');
  });

  it('REVENUECAT_WEBHOOK_AUTH_HEADER is optional and absent by default', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.REVENUECAT_WEBHOOK_AUTH_HEADER).toBeUndefined();
  });

  it('REVENUECAT_WEBHOOK_AUTH_HEADER parses when provided', () => {
    const env = loadEnv({ ...baseEnv, REVENUECAT_WEBHOOK_AUTH_HEADER: 'Bearer rc_secret_xyz' });
    expect(env.REVENUECAT_WEBHOOK_AUTH_HEADER).toBe('Bearer rc_secret_xyz');
  });
});
```

- [ ] **Step 3.2 — Run the test to confirm it fails**

```bash
pnpm --filter @jdm/api exec vitest run test/env.test.ts
```

Expected: FAIL — `env.GROWTH_PREMIUM_BILLING_ENABLED` is `undefined`, properties don't exist yet.

- [ ] **Step 3.3 — Add the three entries to `apps/api/src/env.ts`**

In the `envSchema` object, add after the `DELETION_GRACE_DAYS` line (currently the last entry):

```ts
  GROWTH_PREMIUM_BILLING_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  STRIPE_BILLING_WEBHOOK_SECRET: z.string().min(1).optional(),
  REVENUECAT_WEBHOOK_AUTH_HEADER: z.string().min(1).optional(),
```

`STRIPE_BILLING_WEBHOOK_SECRET` and `REVENUECAT_WEBHOOK_AUTH_HEADER` are optional because the API boots without them when `GROWTH_PREMIUM_BILLING_ENABLED=false`. Webhook routes validate their presence at request time (not at boot time) when the flag is on.

- [ ] **Step 3.4 — Run the test to confirm it passes**

```bash
pnpm --filter @jdm/api exec vitest run test/env.test.ts
```

Expected: PASS — all 7 new cases green.

- [ ] **Step 3.5 — Commit env changes**

```bash
git add apps/api/src/env.ts apps/api/test/env.test.ts
git commit -m "$(cat <<'EOF'
feat(api/env): add GROWTH_PREMIUM_BILLING_ENABLED + billing webhook secrets (F8.01)

Adds three env entries: feature flag defaulting to false (canon §F8.11),
STRIPE_BILLING_WEBHOOK_SECRET, REVENUECAT_WEBHOOK_AUTH_HEADER (both optional
at boot; validated at request time when flag is on).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Scaffold `packages/shared/src/premium.ts`

**Files:**

- Create: `packages/shared/src/premium.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 4.1 — Write the failing shared build test**

There is no dedicated test file for this step — the test is `pnpm --filter @jdm/shared build` succeeding after the re-export is added. First confirm the build currently passes (baseline):

```bash
pnpm --filter @jdm/shared build
```

Expected: PASS. This confirms the current state is clean before we touch it.

- [ ] **Step 4.2 — Create `packages/shared/src/premium.ts`**

```ts
// packages/shared/src/premium.ts
// Populated by F8.11 (premium status + checkout zod schemas).
// This scaffold exists so downstream F8 chunks can import from '@jdm/shared'
// without a build-order hazard.

export {};
```

- [ ] **Step 4.3 — Add the re-export to `packages/shared/src/index.ts`**

At the end of `packages/shared/src/index.ts`, append:

```ts
export * from './premium.js';
```

The existing pattern in `index.ts` uses the `.js` extension on all re-exports (e.g., `export * from './garage.js'`). Match it exactly.

- [ ] **Step 4.4 — Rebuild `@jdm/shared` and confirm it passes**

```bash
pnpm --filter @jdm/shared build
```

Expected: PASS. The empty export barrel compiles cleanly.

- [ ] **Step 4.5 — Commit shared scaffold**

```bash
git add packages/shared/src/premium.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): scaffold premium.ts export barrel (F8.01)

Empty re-export barrel; F8.11 populates premiumStatusSchema + checkout
zod schemas. Added to index.ts so downstream F8 chunks can import from
@jdm/shared without build-order hazard (canon §F8.13).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Migration integration test (real Postgres, partial unique indexes)

**Files:**

- Create: `apps/api/test/billing/schema-f8.test.ts`

This test uses the shared Testcontainers Postgres setup in `apps/api/test/global-setup.ts`. That setup runs `prisma migrate deploy` on startup, which picks up the new `f8_premium_billing` migration automatically. Use the shared `prisma` client from `@jdm/db`.

- [ ] **Step 5.1 — Write the failing test**

```ts
// apps/api/test/billing/schema-f8.test.ts
import { prisma } from '@jdm/db';
import { PremiumCadence, PremiumMembershipStatus, PremiumProvider } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

// Helpers
const garageFor = (userId: string) => prisma.garage.findUniqueOrThrow({ where: { userId } });

// Minimal valid PremiumMembership seed (no row insert helper in helpers.ts yet
// for F8 models — construct inline).
const makeMembership = (
  garageId: string,
  overrides: Partial<{
    status: PremiumMembershipStatus;
    provider: PremiumProvider;
    providerSubRef: string;
    providerCustomerRef: string;
  }> = {},
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: overrides.provider ?? PremiumProvider.stripe,
      providerCustomerRef: overrides.providerCustomerRef ?? 'cus_test001',
      providerSubRef: overrides.providerSubRef ?? `sub_${Date.now()}`,
      tier: 'gold',
      cadence: PremiumCadence.monthly,
      status: overrides.status ?? PremiumMembershipStatus.active,
      currentPeriodStart: new Date('2026-05-01'),
      currentPeriodEnd: new Date('2026-06-01'),
      baseAmountCents: 2000,
      devFeePercent: 10,
      devFeeAmountCents: 200,
      grossAmountCents: 2200,
      currency: 'BRL',
    },
  });

describe('schema: F8 premium billing tables + partial unique indexes (chunk F8.01)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  // ── PremiumMembership ──────────────────────────────────────────────────────

  it('creates PremiumMembership with all required fields', async () => {
    const { user } = await createUser({ email: 'pm1@jdm.test' });
    const garage = await garageFor(user.id);
    const membership = await makeMembership(garage.id);
    expect(membership.id).toBeTruthy();
    expect(membership.devFeePercent).toBe(10);
    expect(membership.status).toBe('active');
  });

  it('partial unique index: rejects second active row for same garage (premium_membership_live_per_garage)', async () => {
    const { user } = await createUser({ email: 'pm2@jdm.test' });
    const garage = await garageFor(user.id);

    await makeMembership(garage.id, { providerSubRef: 'sub_first' });

    // Second active row for the same garage must be rejected by the partial index.
    await expect(makeMembership(garage.id, { providerSubRef: 'sub_second' })).rejects.toMatchObject(
      { code: 'P2002' },
    );
  });

  it('partial unique index: allows a second row when first row is expired (history accumulates)', async () => {
    const { user } = await createUser({ email: 'pm3@jdm.test' });
    const garage = await garageFor(user.id);

    // First membership is expired — not covered by the partial index.
    await makeMembership(garage.id, {
      providerSubRef: 'sub_expired',
      status: PremiumMembershipStatus.expired,
    });

    // Re-subscribe: fresh active row must succeed.
    const resub = await makeMembership(garage.id, {
      providerSubRef: 'sub_active_resub',
      status: PremiumMembershipStatus.active,
    });
    expect(resub.status).toBe('active');
  });

  it('partial unique covers all three live statuses (active, past_due, cancel_scheduled)', async () => {
    const statuses: PremiumMembershipStatus[] = [
      PremiumMembershipStatus.active,
      PremiumMembershipStatus.past_due,
      PremiumMembershipStatus.cancel_scheduled,
    ];

    for (const liveStatus of statuses) {
      // Fresh user+garage for each status to avoid cross-contamination.
      const { user } = await createUser({ email: `pm-live-${liveStatus}@jdm.test` });
      const garage = await garageFor(user.id);

      // First row with this live status is fine.
      await makeMembership(garage.id, {
        providerSubRef: `sub_first_${liveStatus}`,
        status: liveStatus,
      });

      // Second row with ANY live status must be blocked.
      await expect(
        makeMembership(garage.id, {
          providerSubRef: `sub_second_${liveStatus}`,
          status: PremiumMembershipStatus.active,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    }
  });

  it('confirms partial unique index exists in pg_indexes', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'PremiumMembership'
        AND indexname = 'premium_membership_live_per_garage'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/WHERE/i);
  });

  // ── Ticket partial unique ──────────────────────────────────────────────────

  it('confirms ticket_one_premium_grant_per_user_event partial unique index exists in pg_indexes', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'Ticket'
        AND indexname = 'ticket_one_premium_grant_per_user_event'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/WHERE/i);
  });

  // ── TicketTier.isPremiumGrantable ──────────────────────────────────────────

  it('TicketTier.isPremiumGrantable defaults to false', async () => {
    // Use raw SQL to bypass Prisma's default substitution and confirm the column
    // default is physically false at the DB level.
    // Find an existing TicketTier row (or create one via prisma if none).
    // The testcontainer starts empty so we need a full event + tier scaffold.
    // We only care about the column default, not the full event lifecycle.
    const event = await prisma.event.create({
      data: {
        slug: 'test-event-f8-01',
        title: 'Test Event F8',
        description: 'schema test',
        startsAt: new Date('2026-07-01'),
        endsAt: new Date('2026-07-01'),
        type: 'meeting',
        capacity: 100,
        tiers: {
          create: {
            name: 'Standard',
            priceCents: 0,
            quantityTotal: 100,
          },
        },
      },
      include: { tiers: true },
    });

    const tier = event.tiers[0]!;

    const rows = await prisma.$queryRaw<Array<{ isPremiumGrantable: boolean }>>`
      SELECT "isPremiumGrantable" FROM "TicketTier" WHERE id = ${tier.id}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isPremiumGrantable).toBe(false);
  });

  it('TicketTier.isPremiumGrantable can be set to true', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'test-event-f8-02',
        title: 'Test Event F8 Grantable',
        description: 'schema test grantable',
        startsAt: new Date('2026-07-01'),
        endsAt: new Date('2026-07-01'),
        type: 'meeting',
        capacity: 100,
        tiers: {
          create: {
            name: 'Premium',
            priceCents: 0,
            quantityTotal: 100,
            isPremiumGrantable: true,
          },
        },
      },
      include: { tiers: true },
    });

    const tier = event.tiers[0]!;
    expect(tier.isPremiumGrantable).toBe(true);
  });

  // ── SubscriptionWebhookEvent ───────────────────────────────────────────────

  it('creates SubscriptionWebhookEvent with payload Json', async () => {
    const swe = await prisma.subscriptionWebhookEvent.create({
      data: {
        provider: PremiumProvider.stripe,
        providerEventId: 'evt_test_001',
        type: 'invoice.paid',
        payload: { raw: 'stripe_payload' },
      },
    });
    expect(swe.processedAt).toBeNull();
    expect(swe.payload).toEqual({ raw: 'stripe_payload' });
  });

  it('rejects duplicate (provider, providerEventId) on SubscriptionWebhookEvent (replay dedup)', async () => {
    await prisma.subscriptionWebhookEvent.create({
      data: {
        provider: PremiumProvider.stripe,
        providerEventId: 'evt_replay_001',
        type: 'invoice.paid',
        payload: {},
      },
    });

    await expect(
      prisma.subscriptionWebhookEvent.create({
        data: {
          provider: PremiumProvider.stripe,
          providerEventId: 'evt_replay_001',
          type: 'invoice.paid',
          payload: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // ── PremiumMembershipInvoice ───────────────────────────────────────────────

  it('creates PremiumMembershipInvoice linked to PremiumMembership', async () => {
    const { user } = await createUser({ email: 'pmi1@jdm.test' });
    const garage = await garageFor(user.id);
    const membership = await makeMembership(garage.id, { providerSubRef: 'sub_inv_test' });

    const invoice = await prisma.premiumMembershipInvoice.create({
      data: {
        membershipId: membership.id,
        provider: PremiumProvider.stripe,
        providerInvoiceRef: 'in_test_001',
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-06-01'),
        baseAmountCents: 2000,
        devFeePercent: 10,
        devFeeAmountCents: 200,
        grossAmountCents: 2200,
        currency: 'BRL',
        paidAt: new Date(),
        status: 'paid',
      },
    });

    expect(invoice.membershipId).toBe(membership.id);
    expect(invoice.status).toBe('paid');
  });

  it('rejects duplicate (provider, providerInvoiceRef) on PremiumMembershipInvoice (webhook dedup)', async () => {
    const { user } = await createUser({ email: 'pmi2@jdm.test' });
    const garage = await garageFor(user.id);
    const membership = await makeMembership(garage.id, { providerSubRef: 'sub_inv_dup' });

    const invoiceData = {
      membershipId: membership.id,
      provider: PremiumProvider.stripe,
      providerInvoiceRef: 'in_dup_001',
      periodStart: new Date('2026-05-01'),
      periodEnd: new Date('2026-06-01'),
      baseAmountCents: 2000,
      devFeePercent: 10,
      devFeeAmountCents: 200,
      grossAmountCents: 2200,
      currency: 'BRL',
      paidAt: new Date(),
      status: 'paid',
    };

    await prisma.premiumMembershipInvoice.create({ data: invoiceData });

    await expect(
      prisma.premiumMembershipInvoice.create({ data: invoiceData }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
```

- [ ] **Step 5.2 — Run the test to confirm it fails before migration is applied**

If you haven't applied the migration yet, run:

```bash
pnpm --filter @jdm/api exec vitest run test/billing/schema-f8.test.ts
```

Expected: FAIL — tables/columns don't exist yet (or Prisma client types missing).

If migration was already applied in Task 2.4, run `pnpm --filter @jdm/db build` first to ensure the Prisma client output is current, then run the test. It should PASS (the Testcontainers container runs `prisma migrate deploy` on fresh start).

- [ ] **Step 5.3 — Build `@jdm/db` to refresh the Prisma client**

```bash
pnpm --filter @jdm/db build
```

Expected: PASS.

- [ ] **Step 5.4 — Run the test suite against the fresh container**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/schema-f8.test.ts
```

Expected: PASS — all 12 cases green. The Testcontainers setup runs `prisma migrate deploy` which picks up the new migration including the appended raw SQL.

If the partial unique index tests fail with "no rows returned", confirm the two raw SQL statements were appended to the migration file in Task 2.3 before `prisma migrate dev` was run. The global-setup applies migrations via `prisma migrate deploy` — it won't apply unapplied ones; re-run `prisma migrate dev` locally to apply, then restart the test run.

---

## Task 6 — Commit schema + migration

**Files:**

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<ts>_f8_premium_billing/migration.sql`
- `apps/api/test/billing/schema-f8.test.ts`

- [ ] **Step 6.1 — Stage and commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/ \
        apps/api/test/billing/schema-f8.test.ts
git commit -m "$(cat <<'EOF'
feat(db): F8 premium billing schema — enums, models, partial indexes (F8.01)

Adds PremiumProvider/PremiumCadence/PremiumMembershipStatus enums,
PremiumMembership/PremiumMembershipInvoice/SubscriptionWebhookEvent models,
TicketTier.isPremiumGrantable Boolean (default false). Migration appends two
raw partial unique indexes: premium_membership_live_per_garage (one live row
per garage, canon §F8) and ticket_one_premium_grant_per_user_event (one valid
premium_grant Ticket per user+event — narrowed to source='premium_grant' so
multi-ticket purchase + multi-comp grant flows are unaffected; canon §F8.8).
No service/route/UI changes in this chunk.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Open PR

- [ ] **Step 7.1 — Push branch and create PR**

```bash
git push -u origin feat/jdma-f8-billing-01
gh pr create --base main \
  --title "feat(db): F8.01 schema migration + env flag + shared scaffold" \
  --body "$(cat <<'EOF'
## Summary

F8 chunk 01 — additive schema migration + env flag + shared export scaffold.

- **Enums:** `PremiumProvider` (stripe, apple_revenuecat), `PremiumCadence` (monthly, annual), `PremiumMembershipStatus` (trialing, active, past_due, cancel_scheduled, expired, paused)
- **Models:** `PremiumMembership`, `PremiumMembershipInvoice`, `SubscriptionWebhookEvent`
- **Field:** `TicketTier.isPremiumGrantable Boolean @default(false)` + compound index `(eventId, isPremiumGrantable)`
- **Raw SQL appended to migration:** `premium_membership_live_per_garage` partial unique (one live row per garage; expired rows accumulate as history — canon §F8) + `ticket_one_premium_grant_per_user_event` partial unique (narrowed: DB backstop for one valid `premium_grant` Ticket per user+event — canon §F8.8; multi-ticket purchase + multi-comp flows are unaffected)
- **Env:** `GROWTH_PREMIUM_BILLING_ENABLED` (default false, canon §F8.11), `STRIPE_BILLING_WEBHOOK_SECRET` (optional), `REVENUECAT_WEBHOOK_AUTH_HEADER` (optional)
- **Shared scaffold:** `packages/shared/src/premium.ts` (empty export barrel; F8.11 populates zod schemas — canon §F8.13)

## Deviations from skeleton

None. All schema text mirrors spec §2 verbatim. `devFeePercent Int` has no DB default (server must set explicitly per spec §2.2 note).

## Out of scope (later chunks)

BillingEvent types (F8.02), applyMembershipEvent service (F8.03), webhook routes (F8.04–F8.05), ticket backfill worker (F8.06), event-publish grant hook (F8.07), admin event-tier UI (F8.08), checkout routes (F8.09), RC SDK (F8.10), premium status endpoint (F8.11 — populates premium.ts), reconciliation sweep (F8.12), finance dashboard (F8.13–F8.16), subscribe UI (F8.17–F8.18), smoke + flag flip (F8.19).

## Test plan

- [ ] `pnpm --filter @jdm/db exec prisma format` — no parse errors
- [ ] `pnpm --filter @jdm/db prisma generate` — client builds
- [ ] `pnpm --filter @jdm/db prisma migrate dev` — migration applies forward cleanly
- [ ] `pnpm --filter @jdm/db build` — package builds
- [ ] `pnpm --filter @jdm/shared build` — shared builds (canon §F8.13)
- [ ] `pnpm --filter @jdm/api typecheck` — green
- [ ] `pnpm --filter @jdm/api exec vitest run test/billing/schema-f8.test.ts` — 12 cases pass
- [ ] `pnpm --filter @jdm/api exec vitest run test/env.test.ts` — 7 new cases pass

## Reviewer checklist

- [ ] Migration SQL includes the two raw partial unique indexes (after the Prisma-generated block).
- [ ] `PremiumMembership.devFeePercent` has no `@default` in schema — required field.
- [ ] `SubscriptionWebhookEvent.payload Json` is present (load-bearing per spec §2.4).
- [ ] `packages/shared/src/index.ts` re-exports `./premium.js` (`.js` extension per existing pattern).
- [ ] `GROWTH_PREMIUM_BILLING_ENABLED` defaults to `false` in env schema.
- [ ] No service/route/UI changes in this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Verification commands (run in order before marking done)

```bash
# 1. Format + client validation
pnpm --filter @jdm/db exec prisma format
pnpm --filter @jdm/db prisma generate

# 2. Migration forward-apply
pnpm --filter @jdm/db prisma migrate dev

# 3. Build packages
pnpm --filter @jdm/db build
pnpm --filter @jdm/shared build

# 4. Type-check api
pnpm --filter @jdm/api typecheck

# 5. Targeted test runs only (per feedback_no_full_test_suite_locally.md)
pnpm --filter @jdm/api exec vitest run test/billing/schema-f8.test.ts
pnpm --filter @jdm/api exec vitest run test/env.test.ts
```

Stop at the first failure. Do not run the full `@jdm/api` suite locally — trust CI for the cross-cutting sweep.

---

## Deviations / Open questions

**No deviations.** Schema text mirrors spec §2 verbatim.

**Open question for future chunks (not blocking F8.01):** The spec §9 says "migration number TBD by Prisma migrate state at land time." The actual migration directory timestamp is generated by `prisma migrate dev --create-only` and will differ from the `0042_` prefix shown in the spec. The spec's reference number is illustrative only — do not rename the generated directory to match it.

**Note on `devFeePercent` no-default:** The `devFeePercent Int` field on both `PremiumMembership` and `PremiumMembershipInvoice` has no Prisma `@default`. This is intentional per spec §2.2: "no default — server MUST set explicitly." If any downstream chunk attempts to insert without it, the Prisma client will throw a TypeScript compile error, not a runtime error — which is exactly the desired behavior.
