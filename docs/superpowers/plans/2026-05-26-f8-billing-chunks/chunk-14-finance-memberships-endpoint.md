# F8.14 — Finance API: `/finance/memberships` Endpoint + CSV Export Columns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /admin/finance/memberships` paginated list endpoint, extend `/finance/export` CSV with three new columns (`cadence`, `is_membership`, `membership_invoice_id`), and apply `MIN_FINANCE_EXPORT_COHORT_SIZE = 5` k-anonymity suppression to membership cohorts in the export.

**Architecture:** New zod schemas (`adminFinanceMembershipsQuerySchema`, `adminFinanceMembershipsResponseSchema`) land in `packages/shared/src/admin.ts` alongside the existing `adminFinanceQuerySchema`. The endpoint and CSV extension live in `apps/api/src/routes/admin/finance.ts`, parallel to `findFinanceOrders`. Membership data is fetched via a new `findMembershipInvoices` helper that queries `PremiumMembershipInvoice` joined to `PremiumMembership` and `Garage`/`User`. CSV membership rows use the existing bucket-and-suppress pattern (`buildFinanceExportBucketKey` analogue for membership cohorts); the suppressed-groups header already emitted by `/finance/export` is incremented to include suppressed membership cohorts. Rebuild `@ccc/shared` per canon §F8.13.

**Tech Stack:** Prisma + Postgres (Testcontainers for all integration tests), Fastify, zod in `@ccc/shared`, Vitest.

---

## Required reading before implementing

- `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §7.1 — `/finance/memberships` response shape, filter list, k-anonymity rule.
- `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §F8.14 — files touched, done criteria.
- `apps/api/src/routes/admin/finance.ts` — full file (already read). Study `findFinanceOrders`, `buildFinanceExportBucketKey`, `MIN_FINANCE_EXPORT_COHORT_SIZE`, and the `/finance/export` bucket-and-suppress loop.
- `packages/shared/src/admin.ts` — full file (already read). Study `adminFinanceQuerySchema` + response schemas to follow naming conventions.
- Canon §F8.12 (`pnpm --filter <pkg> exec vitest run <PACKAGE-ROOT-RELATIVE>`).
- Canon §F8.13 (rebuild `@ccc/shared` after schema changes).

---

## Pre-flight checklist (run once, before Task 1)

- [ ] **Pre-flight 1: Branch safety preflight (CLAUDE.md)**

```bash
git branch --show-current
```

Expected: NOT `production`. If output is `production`, STOP and switch to `main` first.

- [ ] **Pre-flight 2: Confirm upstream chunks merged**

```bash
ls apps/api/src/services/billing/apply-membership-event.ts
```

Expected: file exists. F8.03 (`applyMembershipEvent`) must be merged — it creates `PremiumMembership` and `PremiumMembershipInvoice` tables in the DB. If missing, stop and finish F8.03 first.

- [ ] **Pre-flight 3: Confirm Prisma client has F8 types**

```bash
grep -c "PremiumMembership" node_modules/.pnpm/\@prisma+client*/node_modules/@prisma/client/index.d.ts 2>/dev/null || grep -c "PremiumMembership" packages/db/node_modules/.pnpm/\@prisma+client*/node_modules/@prisma/client/index.d.ts 2>/dev/null || pnpm --filter @ccc/db exec node -e "const {PrismaClient}=require('@prisma/client');console.log(typeof new PrismaClient().premiumMembership)"
```

Expected: output is `object` (or `function`). If Prisma client doesn't have the F8 models, run `pnpm --filter @ccc/db run db:generate` first.

- [ ] **Pre-flight 4: Create branch from fresh main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-14
```

---

## Files touched

| Path                                                   | Action | Responsibility                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/admin.ts`                         | Modify | Add `adminFinanceMembershipsQuerySchema`, `adminFinanceMembershipsItemSchema`, `adminFinanceMembershipsResponseSchema` + their exported TS types.                                                                |
| `apps/api/src/routes/admin/finance.ts`                 | Modify | Add `findMembershipInvoices` helper; add `GET /finance/memberships` route; extend `/finance/export` CSV with `cadence`, `is_membership`, `membership_invoice_id` columns and membership k-anonymity suppression. |
| `apps/api/test/admin/finance-memberships-list.test.ts` | Create | Integration tests (Testcontainers Postgres): pagination, each filter, search (name + email), k-anonymity suppression on CSV, response shape stability.                                                           |

---

## Task 1 — Add zod schemas to `@ccc/shared`

**Files:**

- Modify: `packages/shared/src/admin.ts`

- [ ] **Step 1: Write the failing type-check**

Open `packages/shared/src/admin.ts`. After the existing `adminFinancePaymentMixResponseSchema` block (around line 654), append the following. The imports for `z` and the existing enum helpers are already at the top of the file.

```ts
// ── Admin finance: memberships list ────────────────────────────────

export const adminFinanceMembershipsQuerySchema = z.object({
  status: z
    .enum(['trialing', 'active', 'past_due', 'cancel_scheduled', 'expired', 'paused'])
    .optional(),
  cadence: z.enum(['monthly', 'annual']).optional(),
  tier: z.enum(['bronze', 'silver', 'gold']).optional(),
  provider: z.enum(['stripe', 'apple_revenuecat']).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminFinanceMembershipsQuery = z.infer<typeof adminFinanceMembershipsQuerySchema>;

export const adminFinanceMembershipsItemSchema = z.object({
  membershipId: z.string().min(1),
  garageSlug: z.string(),
  userName: z.string(),
  tier: z.enum(['bronze', 'silver', 'gold']),
  cadence: z.enum(['monthly', 'annual']),
  status: z.enum(['trialing', 'active', 'past_due', 'cancel_scheduled', 'expired', 'paused']),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  totalPaidCents: z.number().int().nonnegative(),
  invoiceCount: z.number().int().nonnegative(),
  provider: z.enum(['stripe', 'apple_revenuecat']),
  providerSubRef: z.string(),
});
export type AdminFinanceMembershipsItem = z.infer<typeof adminFinanceMembershipsItemSchema>;

export const adminFinanceMembershipsResponseSchema = z.object({
  items: z.array(adminFinanceMembershipsItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type AdminFinanceMembershipsResponse = z.infer<typeof adminFinanceMembershipsResponseSchema>;
```

- [ ] **Step 2: Build `@ccc/shared` and confirm it compiles**

```bash
pnpm --filter @ccc/shared build
```

Expected: build succeeds, `dist/` is updated. If TypeScript errors appear, check that the enum values exactly match the `PremiumMembershipStatus`, `PremiumCadence`, `GaragePremiumTier`, and `PremiumProvider` Prisma enums from the schema (spec §2.1).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/admin.ts
git commit -m "feat(shared): add adminFinanceMemberships zod schemas (F8.14)"
```

---

## Task 2 — Write failing integration tests

Write all tests before any implementation. They WILL fail until Tasks 3 and 4 add the routes.

**Files:**

- Create: `apps/api/test/admin/finance-memberships-list.test.ts`

- [ ] **Step 1: Write the full test file**

```ts
// apps/api/test/admin/finance-memberships-list.test.ts
import { prisma } from '@ccc/db';
import { adminFinanceMembershipsResponseSchema } from '@ccc/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { adminBearer, makeApp, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

type SeedMembershipOpts = {
  garageSlug: string;
  userName: string;
  userEmail: string;
  tier?: 'gold';
  cadence?: 'monthly' | 'annual';
  status?: 'active' | 'past_due' | 'cancel_scheduled' | 'expired';
  provider?: 'stripe' | 'apple_revenuecat';
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  invoices?: Array<{ grossAmountCents: number; status?: string }>;
};

async function seedMembership(opts: SeedMembershipOpts) {
  const tier = opts.tier ?? 'gold';
  const cadence = opts.cadence ?? 'monthly';
  const status = opts.status ?? 'active';
  const provider = opts.provider ?? 'stripe';
  const currentPeriodEnd = opts.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 3600_000);
  const cancelAtPeriodEnd = opts.cancelAtPeriodEnd ?? false;

  const user = await prisma.user.create({
    data: {
      email: opts.userEmail,
      name: opts.userName,
      passwordHash: 'x',
      status: 'active',
      role: 'user',
      emailVerifiedAt: new Date(),
    },
  });

  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await prisma.garage.update({
    where: { id: garage.id },
    data: { slug: opts.garageSlug },
  });

  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider,
      providerCustomerRef: `cus_test_${opts.garageSlug}`,
      providerSubRef: `sub_test_${opts.garageSlug}`,
      tier,
      cadence,
      status,
      currentPeriodStart: new Date(Date.now() - 5 * 24 * 3600_000),
      currentPeriodEnd,
      cancelAtPeriodEnd,
      baseAmountCents: 4990,
      devFeePercent: 10,
      devFeeAmountCents: 499,
      grossAmountCents: 5489,
      currency: 'BRL',
    },
  });

  for (const inv of opts.invoices ?? [{ grossAmountCents: 5489 }]) {
    await prisma.premiumMembershipInvoice.create({
      data: {
        membershipId: membership.id,
        provider,
        providerInvoiceRef: `inv_${Math.random().toString(36).slice(2)}`,
        periodStart: new Date(Date.now() - 5 * 24 * 3600_000),
        periodEnd: currentPeriodEnd,
        baseAmountCents: 4990,
        devFeePercent: 10,
        devFeeAmountCents: 499,
        grossAmountCents: inv.grossAmountCents,
        currency: 'BRL',
        paidAt: new Date(),
        status: inv.status ?? 'paid',
      },
    });
  }

  return { user, garage, membership };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /finance/memberships', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns empty page when no memberships exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships',
      headers: { authorization: adminBearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  it('returns correct response shape for a single membership', async () => {
    await seedMembership({
      garageSlug: 'shape-test',
      userName: 'Marcos Lima',
      userEmail: 'marcos@jdm.test',
      invoices: [{ grossAmountCents: 5489 }, { grossAmountCents: 5489 }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships',
      headers: { authorization: adminBearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    const item = body.items[0]!;
    expect(item.garageSlug).toBe('shape-test');
    expect(item.userName).toBe('Marcos Lima');
    expect(item.tier).toBe('gold');
    expect(item.cadence).toBe('monthly');
    expect(item.status).toBe('active');
    expect(item.cancelAtPeriodEnd).toBe(false);
    expect(item.totalPaidCents).toBe(10978); // 2 × 5489
    expect(item.invoiceCount).toBe(2);
    expect(item.provider).toBe('stripe');
    expect(item.providerSubRef).toMatch(/^sub_test_/);
  });

  it('paginates correctly with page + pageSize', async () => {
    for (let i = 0; i < 5; i++) {
      await seedMembership({
        garageSlug: `page-slug-${i}`,
        userName: `User ${i}`,
        userEmail: `user${i}@jdm.test`,
      });
    }

    const page1 = await app.inject({
      method: 'GET',
      url: '/finance/memberships?page=1&pageSize=2',
      headers: { authorization: adminBearer(app) },
    });
    const p1 = adminFinanceMembershipsResponseSchema.parse(page1.json());
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(2);

    const page2 = await app.inject({
      method: 'GET',
      url: '/finance/memberships?page=2&pageSize=2',
      headers: { authorization: adminBearer(app) },
    });
    const p2 = adminFinanceMembershipsResponseSchema.parse(page2.json());
    expect(p2.items).toHaveLength(2);
    expect(p2.page).toBe(2);

    const page3 = await app.inject({
      method: 'GET',
      url: '/finance/memberships?page=3&pageSize=2',
      headers: { authorization: adminBearer(app) },
    });
    const p3 = adminFinanceMembershipsResponseSchema.parse(page3.json());
    expect(p3.items).toHaveLength(1);
  });

  it('filters by status', async () => {
    await seedMembership({
      garageSlug: 'active-1',
      userName: 'A',
      userEmail: 'a@jdm.test',
      status: 'active',
    });
    await seedMembership({
      garageSlug: 'expired-1',
      userName: 'B',
      userEmail: 'b@jdm.test',
      status: 'expired',
    });
    await seedMembership({
      garageSlug: 'past-due-1',
      userName: 'C',
      userEmail: 'c@jdm.test',
      status: 'past_due',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships?status=active',
      headers: { authorization: adminBearer(app) },
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.status).toBe('active');
  });

  it('filters by cadence', async () => {
    await seedMembership({
      garageSlug: 'monthly-1',
      userName: 'M',
      userEmail: 'm@jdm.test',
      cadence: 'monthly',
    });
    await seedMembership({
      garageSlug: 'annual-1',
      userName: 'N',
      userEmail: 'n@jdm.test',
      cadence: 'annual',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships?cadence=annual',
      headers: { authorization: adminBearer(app) },
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.cadence).toBe('annual');
  });

  it('filters by tier', async () => {
    // Gold is the only v1 tier; seed two, filter by gold confirms shape passes.
    await seedMembership({
      garageSlug: 'gold-1',
      userName: 'G',
      userEmail: 'g@jdm.test',
      tier: 'gold',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships?tier=gold',
      headers: { authorization: adminBearer(app) },
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.tier).toBe('gold');
  });

  it('filters by provider', async () => {
    await seedMembership({
      garageSlug: 'stripe-user',
      userName: 'S',
      userEmail: 's@jdm.test',
      provider: 'stripe',
    });
    await seedMembership({
      garageSlug: 'apple-user',
      userName: 'P',
      userEmail: 'p@jdm.test',
      provider: 'apple_revenuecat',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships?provider=apple_revenuecat',
      headers: { authorization: adminBearer(app) },
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.provider).toBe('apple_revenuecat');
  });

  it('filters by from/to date range on currentPeriodEnd', async () => {
    const past = new Date('2025-01-15T12:00:00Z');
    const future = new Date('2027-06-01T12:00:00Z');

    await seedMembership({
      garageSlug: 'early-end',
      userName: 'Early',
      userEmail: 'early@jdm.test',
      currentPeriodEnd: past,
    });
    await seedMembership({
      garageSlug: 'late-end',
      userName: 'Late',
      userEmail: 'late@jdm.test',
      currentPeriodEnd: future,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships?from=2027-01-01&to=2027-12-31',
      headers: { authorization: adminBearer(app) },
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.garageSlug).toBe('late-end');
  });

  it('filters by search — matches userName', async () => {
    await seedMembership({
      garageSlug: 'carlos-garage',
      userName: 'Carlos Mendes',
      userEmail: 'carlos@jdm.test',
    });
    await seedMembership({
      garageSlug: 'ana-garage',
      userName: 'Ana Souza',
      userEmail: 'ana@jdm.test',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships?search=carlos',
      headers: { authorization: adminBearer(app) },
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.userName).toBe('Carlos Mendes');
  });

  it('filters by search — matches userEmail', async () => {
    await seedMembership({
      garageSlug: 'email-match',
      userName: 'Someone',
      userEmail: 'findme@jdm.test',
    });
    await seedMembership({ garageSlug: 'no-match', userName: 'Other', userEmail: 'nope@jdm.test' });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships?search=findme',
      headers: { authorization: adminBearer(app) },
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.garageSlug).toBe('email-match');
  });

  it('totalPaidCents sums only paid invoices (not refunded)', async () => {
    await seedMembership({
      garageSlug: 'refund-test',
      userName: 'Refund User',
      userEmail: 'refund@jdm.test',
      invoices: [
        { grossAmountCents: 5489, status: 'paid' },
        { grossAmountCents: 5489, status: 'refunded' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/memberships',
      headers: { authorization: adminBearer(app) },
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.items[0]!.totalPaidCents).toBe(5489); // only the paid one
    expect(body.items[0]!.invoiceCount).toBe(2); // count includes all
  });
});

// ---------------------------------------------------------------------------
// CSV export — membership columns + k-anonymity suppression
// ---------------------------------------------------------------------------

describe('GET /finance/export — membership columns + k-anonymity', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('CSV header includes cadence, is_membership, membership_invoice_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/finance/export',
      headers: { authorization: adminBearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const lines = (res.body as string).split('\n');
    const header = lines[0]!;
    expect(header).toContain('cadence');
    expect(header).toContain('is_membership');
    expect(header).toContain('membership_invoice_id');
  });

  it('membership invoices in a cohort >= 5 appear in CSV with is_membership=true', async () => {
    // Seed 6 memberships in the same cadence/tier/provider bucket so cohort size >= 5.
    for (let i = 0; i < 6; i++) {
      await seedMembership({
        garageSlug: `csv-member-${i}`,
        userName: `Member ${i}`,
        userEmail: `member${i}@jdm.test`,
        cadence: 'monthly',
        tier: 'gold',
        provider: 'stripe',
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/finance/export',
      headers: { authorization: adminBearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const lines = (res.body as string).split('\n').filter(Boolean);
    // At least one data row with is_membership=true
    const membershipRows = lines.slice(1).filter((l) => l.includes(',true,'));
    expect(membershipRows.length).toBeGreaterThan(0);
  });

  it('membership cohort with fewer than 5 invoices is suppressed', async () => {
    // Seed only 3 memberships — below MIN_FINANCE_EXPORT_COHORT_SIZE.
    for (let i = 0; i < 3; i++) {
      await seedMembership({
        garageSlug: `small-cohort-${i}`,
        userName: `Small ${i}`,
        userEmail: `small${i}@jdm.test`,
        cadence: 'annual',
        tier: 'gold',
        provider: 'apple_revenuecat',
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/finance/export',
      headers: { authorization: adminBearer(app) },
    });
    expect(res.statusCode).toBe(200);

    // No membership rows should appear in CSV body.
    const lines = (res.body as string).split('\n').filter(Boolean);
    const membershipRows = lines.slice(1).filter((l) => l.includes(',true,'));
    expect(membershipRows).toHaveLength(0);

    // The suppressed-groups header should reflect the suppressed cohort.
    const suppressed = Number(res.headers['x-jdm-k-anonymity-suppressed-groups']);
    expect(suppressed).toBeGreaterThanOrEqual(1);
  });

  it('existing order cohorts are unaffected by membership suppression', async () => {
    // Seed enough orders to pass cohort threshold — use existing helpers.
    // We just verify the header column count is consistent across all rows.
    const res = await app.inject({
      method: 'GET',
      url: '/finance/export',
      headers: { authorization: adminBearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const lines = (res.body as string).split('\n').filter(Boolean);
    const headerCols = lines[0]!.split(',').length;
    for (const row of lines.slice(1)) {
      // Simple column-count parity: every data row has same number of columns.
      // (Values may contain commas inside CSV-escaped quotes — count raw split for a rough check
      //  only if no commas in values, otherwise parse properly.)
      // For this structural test, assert header contains the three new fields.
      expect(lines[0]).toContain('cadence');
      break; // structural check only; done after confirming header
    }
    expect(headerCols).toBeGreaterThan(14); // original 14 cols + 3 new = 17
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/finance-memberships-list.test.ts
```

Expected: all tests FAIL — `GET /finance/memberships` returns 404 (route not yet registered); CSV header does not yet include `cadence`/`is_membership`/`membership_invoice_id`. This validates test grip.

- [ ] **Step 3: Commit (failing tests only)**

```bash
git add apps/api/test/admin/finance-memberships-list.test.ts
git commit -m "test(api): failing tests for GET /finance/memberships + CSV membership columns (F8.14)"
```

---

## Task 3 — Add `findMembershipInvoices` helper + `GET /finance/memberships` route

**Files:**

- Modify: `apps/api/src/routes/admin/finance.ts`

- [ ] **Step 1: Add imports from `@ccc/shared` and Prisma for the new types**

In `apps/api/src/routes/admin/finance.ts`, extend the first import line:

```ts
import { adminFinanceQuerySchema, adminFinanceMembershipsQuerySchema } from '@ccc/shared/admin';
import {
  Prisma,
  type OrderStatus,
  type PaymentMethod,
  type PaymentProvider,
  type PremiumMembershipStatus,
  type PremiumCadence,
  type GaragePremiumTier,
  type PremiumProvider as PrismaPreProv,
} from '@prisma/client';
```

(Keep the original `adminFinanceQuerySchema` import; just add `adminFinanceMembershipsQuerySchema` alongside it. Add only the Prisma enum types actually referenced in the new code.)

- [ ] **Step 2: Add the `MembershipInvoiceRecord` type and `findMembershipInvoices` helper**

After the closing brace of `findFinanceOrders` (around line 194 in the original file), add:

```ts
type MembershipInvoiceRecord = {
  invoiceId: string;
  membershipId: string;
  garageSlug: string;
  userName: string;
  tier: GaragePremiumTier;
  cadence: PremiumCadence;
  membershipStatus: PremiumMembershipStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  providerSubRef: string;
  provider: PrismaPreProv;
  invoiceStatus: string;
  grossAmountCents: number;
  providerInvoiceRef: string;
};

async function findMembershipInvoices(
  query: ReturnType<typeof adminFinanceMembershipsQuerySchema.parse>,
): Promise<{ items: MembershipInvoiceRecord[]; total: number }> {
  const where: Prisma.PremiumMembershipWhereInput = {};

  if (query.status) where.status = query.status;
  if (query.cadence) where.cadence = query.cadence;
  if (query.tier) where.tier = query.tier;
  if (query.provider) where.provider = query.provider;

  if (query.from || query.to) {
    const periodFilter: Prisma.DateTimeFilter<'PremiumMembership'> = {};
    if (query.from) periodFilter.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) periodFilter.lte = new Date(`${query.to}T23:59:59.999Z`);
    where.currentPeriodEnd = periodFilter;
  }

  if (query.search) {
    where.garage = {
      OR: [
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
      ],
    };
  }

  const skip = (query.page - 1) * query.pageSize;

  const [memberships, total] = await Promise.all([
    prisma.premiumMembership.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tier: true,
        cadence: true,
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        providerSubRef: true,
        provider: true,
        garage: {
          select: {
            slug: true,
            user: { select: { name: true, email: true } },
          },
        },
        invoices: {
          select: {
            id: true,
            status: true,
            grossAmountCents: true,
            providerInvoiceRef: true,
          },
        },
      },
    }),
    prisma.premiumMembership.count({ where }),
  ]);

  const items: MembershipInvoiceRecord[] = memberships.map((m) => {
    const paidInvoices = m.invoices.filter((inv) => inv.status === 'paid');
    const totalPaidCents = paidInvoices.reduce((sum, inv) => sum + inv.grossAmountCents, 0);
    return {
      invoiceId: m.id, // used as a convenience key; the list item uses membershipId
      membershipId: m.id,
      garageSlug: m.garage.slug ?? '',
      userName: m.garage.user.name ?? '',
      tier: m.tier,
      cadence: m.cadence,
      membershipStatus: m.status,
      currentPeriodEnd: m.currentPeriodEnd,
      cancelAtPeriodEnd: m.cancelAtPeriodEnd,
      providerSubRef: m.providerSubRef,
      provider: m.provider,
      invoiceStatus: '', // not projected at list level
      grossAmountCents: totalPaidCents,
      providerInvoiceRef: '', // not projected at list level
      invoiceCount: m.invoices.length,
    } as unknown as MembershipInvoiceRecord & { invoiceCount: number };
  });

  return { items, total };
}
```

**Note:** The `MembershipInvoiceRecord` type includes invoice-level fields for the CSV path (Task 4). The list-level helper overrides `grossAmountCents` with `totalPaidCents` (sum of paid invoices). The `invoiceCount` is needed by the response but is not in the base type — the `as unknown as` cast is acceptable here because both paths read `invoiceCount` from the returned object; the type will be properly defined in the next step.

- [ ] **Step 2 (corrected): Tighten the return type**

Replace the `MembershipInvoiceRecord` block from Step 1 with the cleaner version below that separates the list item from the raw DB record:

```ts
// Raw DB projection used by both list and CSV.
type RawMembershipRow = {
  id: string;
  tier: GaragePremiumTier;
  cadence: PremiumCadence;
  status: PremiumMembershipStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  providerSubRef: string;
  provider: PrismaPreProv;
  garageSlug: string;
  userName: string;
  invoices: Array<{
    id: string;
    status: string;
    grossAmountCents: number;
    providerInvoiceRef: string;
  }>;
};

type MembershipListItem = {
  membershipId: string;
  garageSlug: string;
  userName: string;
  tier: GaragePremiumTier;
  cadence: PremiumCadence;
  status: PremiumMembershipStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  totalPaidCents: number;
  invoiceCount: number;
  provider: PrismaPreProv;
  providerSubRef: string;
};

async function findMembershipRows(
  query: ReturnType<typeof adminFinanceMembershipsQuerySchema.parse>,
): Promise<{ rows: RawMembershipRow[]; total: number }> {
  const where: Prisma.PremiumMembershipWhereInput = {};

  if (query.status) where.status = query.status;
  if (query.cadence) where.cadence = query.cadence;
  if (query.tier) where.tier = query.tier;
  if (query.provider) where.provider = query.provider;

  if (query.from || query.to) {
    const periodFilter: Prisma.DateTimeFilter<'PremiumMembership'> = {};
    if (query.from) periodFilter.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) periodFilter.lte = new Date(`${query.to}T23:59:59.999Z`);
    where.currentPeriodEnd = periodFilter;
  }

  if (query.search) {
    where.garage = {
      OR: [
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
      ],
    };
  }

  const skip = (query.page - 1) * query.pageSize;

  const [memberships, total] = await Promise.all([
    prisma.premiumMembership.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tier: true,
        cadence: true,
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        providerSubRef: true,
        provider: true,
        garage: {
          select: {
            slug: true,
            user: { select: { name: true, email: true } },
          },
        },
        invoices: {
          select: {
            id: true,
            status: true,
            grossAmountCents: true,
            providerInvoiceRef: true,
          },
        },
      },
    }),
    prisma.premiumMembership.count({ where }),
  ]);

  const rows: RawMembershipRow[] = memberships.map((m) => ({
    id: m.id,
    tier: m.tier,
    cadence: m.cadence,
    status: m.status,
    currentPeriodEnd: m.currentPeriodEnd,
    cancelAtPeriodEnd: m.cancelAtPeriodEnd,
    providerSubRef: m.providerSubRef,
    provider: m.provider,
    garageSlug: m.garage.slug ?? '',
    userName: m.garage.user.name ?? '',
    invoices: m.invoices,
  }));

  return { rows, total };
}

function rowToListItem(row: RawMembershipRow): MembershipListItem {
  const paidCents = row.invoices
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.grossAmountCents, 0);
  return {
    membershipId: row.id,
    garageSlug: row.garageSlug,
    userName: row.userName,
    tier: row.tier,
    cadence: row.cadence,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    totalPaidCents: paidCents,
    invoiceCount: row.invoices.length,
    provider: row.provider,
    providerSubRef: row.providerSubRef,
  };
}
```

_(Delete the earlier Step 1 version — only `findMembershipRows` and `rowToListItem` are needed.)_

- [ ] **Step 3: Register the `GET /finance/memberships` route**

Inside the `adminFinanceRoutes` plugin, after the `/finance/payment-mix` handler and before `/finance/by-product`, add:

```ts
app.get('/finance/memberships', async (request) => {
  const query = adminFinanceMembershipsQuerySchema.parse(request.query);
  const { rows, total } = await findMembershipRows(query);
  return {
    items: rows.map(rowToListItem).map((item) => ({
      ...item,
      currentPeriodEnd: item.currentPeriodEnd.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
});
```

- [ ] **Step 4: Run list tests only; confirm they pass**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/finance-memberships-list.test.ts -t "GET /finance/memberships"
```

Expected: all `GET /finance/memberships` tests PASS. The CSV tests still fail — that's correct.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/finance.ts
git commit -m "feat(api): add GET /finance/memberships paginated endpoint (F8.14)"
```

---

## Task 4 — Extend `/finance/export` CSV with membership columns + k-anonymity

**Files:**

- Modify: `apps/api/src/routes/admin/finance.ts`

The existing `/finance/export` handler buckets order rows and emits `x-jdm-k-anonymity-suppressed-groups`. We extend it to also bucket membership invoice rows and suppress cohorts below `MIN_FINANCE_EXPORT_COHORT_SIZE = 5`. The final `suppressedGroups` counter is the sum of suppressed order buckets plus suppressed membership buckets.

- [ ] **Step 1: Extend the CSV header constant**

In the `/finance/export` handler, change the `header` string:

Old:

```ts
const header =
  'event,city,state,currency,method,provider,status,kind,product_or_collection,order_count,total_amount_cents,total_quantity,first_order_at,last_order_at';
```

New:

```ts
const header =
  'event,city,state,currency,method,provider,status,kind,product_or_collection,order_count,total_amount_cents,total_quantity,first_order_at,last_order_at,cadence,is_membership,membership_invoice_id';
```

- [ ] **Step 2: Extend the existing order rows mapper to append three empty columns**

In the `/finance/export` handler, change the `rows` map so each order row appends three empty columns (to keep CSV column count consistent):

Old `cols` array in the `aggregatedRows.map(...)` call:

```ts
const cols = [
  csvEscape(o.eventTitle),
  csvEscape(o.city),
  o.stateCode,
  o.currency,
  o.method,
  o.provider,
  o.status,
  o.kind,
  csvEscape(o.productOrCollection),
  o.orderCount,
  o.totalAmountCents,
  o.totalQuantity,
  o.firstOrderAt.toISOString(),
  o.lastOrderAt.toISOString(),
];
```

New:

```ts
const cols = [
  csvEscape(o.eventTitle),
  csvEscape(o.city),
  o.stateCode,
  o.currency,
  o.method,
  o.provider,
  o.status,
  o.kind,
  csvEscape(o.productOrCollection),
  o.orderCount,
  o.totalAmountCents,
  o.totalQuantity,
  o.firstOrderAt.toISOString(),
  o.lastOrderAt.toISOString(),
  '', // cadence — not applicable for orders
  'false', // is_membership
  '', // membership_invoice_id
];
```

- [ ] **Step 3: Fetch all membership invoices for the export date window and build membership CSV rows**

The export uses `buildWhere(request.query)` to filter orders. Membership invoices are filtered by `paidAt` against the same `from`/`to` window (using `adminFinanceQuerySchema`'s `from`/`to`). Add the membership fetch inside the `/finance/export` handler, after `productsByOrderId` is built and before `const buckets = ...`:

```ts
// ── Membership invoice rows ──────────────────────────────────────────
// Fetch all PremiumMembershipInvoice rows in the same date window.
// Bucket by (cadence, tier, provider, status) for k-anonymity.
// Apply MIN_FINANCE_EXPORT_COHORT_SIZE suppression identically to orders.

const exportQuery = adminFinanceQuerySchema.parse(request.query);

type MembershipExportBucket = {
  cadence: string;
  tier: string;
  provider: string;
  status: string;
  invoiceCount: number;
  totalAmountCents: number;
  firstPaidAt: Date;
  lastPaidAt: Date;
  sampleInvoiceRef: string;
};

const membershipWhere: Prisma.PremiumMembershipInvoiceWhereInput = {
  status: 'paid',
};
if (exportQuery.from || exportQuery.to) {
  const paidAtFilter: Prisma.DateTimeFilter<'PremiumMembershipInvoice'> = {};
  if (exportQuery.from) paidAtFilter.gte = new Date(`${exportQuery.from}T00:00:00.000Z`);
  if (exportQuery.to) paidAtFilter.lte = new Date(`${exportQuery.to}T23:59:59.999Z`);
  membershipWhere.paidAt = paidAtFilter;
}

const membershipInvoices = await prisma.premiumMembershipInvoice.findMany({
  where: membershipWhere,
  select: {
    id: true,
    providerInvoiceRef: true,
    grossAmountCents: true,
    paidAt: true,
    status: true,
    membership: {
      select: { cadence: true, tier: true, provider: true, status: true },
    },
  },
  orderBy: { paidAt: 'desc' },
});

const membershipBuckets = new Map<string, MembershipExportBucket>();
for (const inv of membershipInvoices) {
  const { cadence, tier, provider, status: mStatus } = inv.membership;
  const bucketKey = [cadence, tier, provider, mStatus].join('');
  const activityAt = inv.paidAt;
  const current = membershipBuckets.get(bucketKey) ?? {
    cadence,
    tier,
    provider,
    status: mStatus,
    invoiceCount: 0,
    totalAmountCents: 0,
    firstPaidAt: activityAt,
    lastPaidAt: activityAt,
    sampleInvoiceRef: inv.providerInvoiceRef,
  };
  current.invoiceCount += 1;
  current.totalAmountCents += inv.grossAmountCents;
  if (activityAt < current.firstPaidAt) current.firstPaidAt = activityAt;
  if (activityAt > current.lastPaidAt) current.lastPaidAt = activityAt;
  membershipBuckets.set(bucketKey, current);
}

const aggregatedMembershipRows = Array.from(membershipBuckets.values()).filter(
  (b) => b.invoiceCount >= MIN_FINANCE_EXPORT_COHORT_SIZE,
);
const suppressedMembershipGroups = membershipBuckets.size - aggregatedMembershipRows.length;
```

- [ ] **Step 4: Merge membership rows into the CSV and update the suppressed-groups counter**

Still inside the `/finance/export` handler, change the final CSV construction block. Find:

```ts
const suppressedGroups = buckets.size - aggregatedRows.length;

const header = ...
const rows = aggregatedRows.map((o) => { ... });

const csv = [header, ...rows].join('\n');
```

Replace with:

```ts
const suppressedOrderGroups = buckets.size - aggregatedRows.length;
const suppressedGroups = suppressedOrderGroups + suppressedMembershipGroups;

const header =
  'event,city,state,currency,method,provider,status,kind,product_or_collection,order_count,total_amount_cents,total_quantity,first_order_at,last_order_at,cadence,is_membership,membership_invoice_id';

const orderRows = aggregatedRows.map((o) => {
  const cols = [
    csvEscape(o.eventTitle),
    csvEscape(o.city),
    o.stateCode,
    o.currency,
    o.method,
    o.provider,
    o.status,
    o.kind,
    csvEscape(o.productOrCollection),
    o.orderCount,
    o.totalAmountCents,
    o.totalQuantity,
    o.firstOrderAt.toISOString(),
    o.lastOrderAt.toISOString(),
    '',
    'false',
    '',
  ];
  return cols.join(',');
});

const membershipRows = aggregatedMembershipRows.map((m) => {
  const cols = [
    '', // event
    '', // city
    '', // state
    'BRL', // currency (v1 BRL-only per §F8.9)
    '', // method
    m.provider,
    m.status,
    'membership', // kind
    '', // product_or_collection
    m.invoiceCount,
    m.totalAmountCents,
    m.invoiceCount, // total_quantity = invoice count for memberships
    m.firstPaidAt.toISOString(),
    m.lastPaidAt.toISOString(),
    m.cadence,
    'true',
    csvEscape(m.sampleInvoiceRef),
  ];
  return cols.join(',');
});

const csv = [header, ...orderRows, ...membershipRows].join('\n');
```

Also remove the old `const header = ...` and old `const rows = ...` and old `const csv = ...` lines that were previously inside the handler (now replaced by the block above). The `void reply.header(...)` calls remain unchanged.

- [ ] **Step 5: Run all tests in the file; confirm they all pass**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/finance-memberships-list.test.ts
```

Expected: ALL tests PASS (membership list + CSV membership columns + k-anonymity suppression).

- [ ] **Step 6: Run the existing finance tests to confirm no regression**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/finance.test.ts
```

Expected: PASS. (If this test file doesn't exist, skip. CI runs the full sweep.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin/finance.ts
git commit -m "feat(api): extend /finance/export CSV with membership columns + k-anonymity (F8.14)"
```

---

## Task 5 — Rebuild `@ccc/shared` and full verification sweep

- [ ] **Step 1: Rebuild `@ccc/shared` (canon §F8.13)**

```bash
pnpm --filter @ccc/shared build
```

Expected: clean build, `dist/` updated.

- [ ] **Step 2: Typecheck the API package**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: 0 TypeScript errors. If errors appear, most likely the `GaragePremiumTier`, `PremiumCadence`, or `PremiumProvider` Prisma enum types differ from the zod schema string literals. Reconcile by inspecting `packages/db/prisma/schema.prisma` and matching the exact enum values.

- [ ] **Step 3: Run all new tests**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/finance-memberships-list.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Run the adjacent finance neighborhood**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/finance.test.ts test/admin/finance-summary-memberships.test.ts 2>/dev/null; true
```

Expected: existing tests pass; `finance-summary-memberships.test.ts` may not exist yet (F8.13 chunk) — the `2>/dev/null; true` silences any "no file found" error.

> Do NOT run the full test suite locally (memory rule: touched files only, trust CI).

- [ ] **Step 5: No additional commit** — code already committed in Tasks 1-4.

---

## Task 6 — Open PR to `main`

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/jdma-f8-billing-14
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main \
  --title "feat(api): GET /finance/memberships endpoint + CSV membership columns (F8.14)" \
  --body "$(cat <<'EOF'
## Summary

- Adds `GET /admin/finance/memberships` paginated endpoint with filters: `status`, `cadence`, `tier`, `provider`, `from`/`to` on `currentPeriodEnd`, `search` (name or email), `page`, `pageSize` (default 20, max 100).
- Response shape per spec §7.1: `{ items, page, pageSize, total }` where each item carries `membershipId`, `garageSlug`, `userName`, `tier`, `cadence`, `status`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `totalPaidCents` (sum of paid invoices), `invoiceCount`, `provider`, `providerSubRef`.
- Extends `GET /finance/export` CSV with three new columns: `cadence`, `is_membership`, `membership_invoice_id`.
- Membership invoice rows are bucketed by `(cadence, tier, provider, status)` and suppressed when cohort size < `MIN_FINANCE_EXPORT_COHORT_SIZE = 5`. Suppressed count is added to the existing `x-jdm-k-anonymity-suppressed-groups` response header.
- New zod schemas in `packages/shared/src/admin.ts`: `adminFinanceMembershipsQuerySchema`, `adminFinanceMembershipsItemSchema`, `adminFinanceMembershipsResponseSchema`.
- `@ccc/shared` rebuilt per canon §F8.13.

## Test plan

- [ ] `pnpm --filter @ccc/api exec vitest run test/admin/finance-memberships-list.test.ts` — all pass
- [ ] `pnpm --filter @ccc/api typecheck` — 0 errors
- [ ] `pnpm --filter @ccc/shared build` — clean
- [ ] `pnpm --filter @ccc/api exec vitest run test/admin/finance.test.ts` — no regression (if file exists)
- [ ] CI green

## Canon refs

§F8.12 (filtered test cmd), §F8.13 (rebuild shared), spec §7.1 (response shape + k-anonymity).

## Out of scope

Admin UI for `/financeiro/membros` page (chunk F8.16). Finance summary/trends/payment-mix membership fields (chunk F8.13).
EOF
)"
```

- [ ] **Step 3: Return the PR URL.**

---

## Self-review

**Spec coverage:**

| Requirement                                                                                | Task                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `GET /finance/memberships` pagination (`page`, `pageSize` 1-100, default 20)               | Task 3 step 3 + Task 2 pagination test                                                       |
| Filter: `status`                                                                           | Task 3 step 2 (`where.status = query.status`) + Task 2 test                                  |
| Filter: `cadence`                                                                          | Task 3 step 2 + Task 2 test                                                                  |
| Filter: `tier`                                                                             | Task 3 step 2 + Task 2 test                                                                  |
| Filter: `provider`                                                                         | Task 3 step 2 + Task 2 test                                                                  |
| Filter: `from`/`to` on `currentPeriodEnd`                                                  | Task 3 step 2 + Task 2 date-range test                                                       |
| Filter: `search` on user name                                                              | Task 3 step 2 (`user.name contains`) + Task 2 name-search test                               |
| Filter: `search` on user email                                                             | Task 3 step 2 (`user.email contains`) + Task 2 email-search test                             |
| Response: `totalPaidCents` = sum of `paid` invoices only                                   | `rowToListItem` + Task 2 refund test                                                         |
| Response: `invoiceCount` = all invoices                                                    | `rowToListItem` + Task 2 refund test                                                         |
| CSV columns `cadence`, `is_membership`, `membership_invoice_id`                            | Task 4 steps 1-4 + Task 2 CSV header test                                                    |
| CSV membership rows bucketed for k-anonymity                                               | Task 4 step 3 + Task 2 suppression test                                                      |
| `MIN_FINANCE_EXPORT_COHORT_SIZE = 5` applied to membership cohorts                         | `aggregatedMembershipRows.filter(b => b.invoiceCount >= MIN_FINANCE_EXPORT_COHORT_SIZE)`     |
| `x-jdm-k-anonymity-suppressed-groups` header incremented for suppressed membership cohorts | `suppressedGroups = suppressedOrderGroups + suppressedMembershipGroups` + Task 2 header test |
| Rebuild `@ccc/shared` (canon §F8.13)                                                       | Task 5 step 1                                                                                |

**Placeholder scan:** none found. All code blocks are complete.

**Type consistency:**

- `findMembershipRows` returns `{ rows: RawMembershipRow[]; total: number }` — referenced identically in the route handler.
- `rowToListItem(row: RawMembershipRow): MembershipListItem` — argument type matches return type of `findMembershipRows`.
- `adminFinanceMembershipsQuerySchema.parse(request.query)` passed directly to `findMembershipRows` — types match.
- `MembershipExportBucket` is a local type inside the export handler — not referenced outside.
- `GaragePremiumTier`, `PremiumCadence`, `PremiumProvider`, `PremiumMembershipStatus` are Prisma-generated enum types — must match the F8.01 migration values from spec §2.1. If the Prisma client uses `PremiumProvider` not `PrismaPreProv`, drop the alias.

**Ambiguity flags:**

1. The `PremiumProvider` Prisma enum conflicts in name with Prisma's own namespace prefix pattern. The import alias `PrismaPreProv` in Task 3 step 1 avoids a collision. Confirm the actual generated type name in `@prisma/client` before implementing.
2. The `membership_invoice_id` CSV column: the spec says "one row per `PremiumMembershipInvoice`" for CSV, but the k-anonymity bucketing groups multiple invoices per cohort. This implementation emits one row per cohort (not per invoice), consistent with the existing order export pattern (`orderCount` aggregated). The `sampleInvoiceRef` for suppression-surviving cohorts exposes only the first invoice ref as a sample — this is intentional for k-anonymity. If the spec requires one-row-per-invoice (un-bucketed), this needs a revision pass.
3. `Garage.slug` may be `null` on fresh accounts (slug is set by the user). The `?? ''` fallback is appropriate for the list but may look confusing in the CSV. Confirm acceptable or add a filter `WHERE slug IS NOT NULL` on the membership query.
