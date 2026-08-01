// Chunk F8.14 — integration tests for:
//   GET /admin/finance/memberships  (new paginated list)
//   GET /admin/finance/export       (new membership CSV columns + k-anonymity)
//
// Testcontainers Postgres via `makeApp` + `resetDatabase`. No mocks.
import { prisma } from '@ccc/db';
import { adminFinanceMembershipsResponseSchema } from '@ccc/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

const env = loadEnv();

function uniq(label: string): string {
  return `${label}-${Math.random().toString(36).slice(2, 10)}`;
}

async function adminAuthHeader(label = 'admin'): Promise<{ authorization: string }> {
  const { user } = await createUser({
    email: `${uniq(label)}@jdm-test.local`,
    verified: true,
    role: 'admin',
  });
  return { authorization: bearer(env, user.id, 'admin') };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

type SeedMembershipOpts = {
  label: string;
  userName: string;
  garageSlug: string;
  tier?: 'bronze' | 'silver' | 'gold';
  cadence?: 'monthly' | 'annual';
  status?: 'trialing' | 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | 'paused';
  provider?: 'stripe' | 'apple_revenuecat';
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  invoices?: Array<{ grossAmountCents: number; status?: string }>;
};

async function seedMembership(opts: SeedMembershipOpts): Promise<{
  userId: string;
  garageId: string;
  membershipId: string;
}> {
  const tier = opts.tier ?? 'gold';
  const cadence = opts.cadence ?? 'monthly';
  const status = opts.status ?? 'active';
  const provider = opts.provider ?? 'stripe';
  const currentPeriodEnd = opts.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 3600_000);
  const cancelAtPeriodEnd = opts.cancelAtPeriodEnd ?? false;

  const { user } = await createUser({
    email: `${uniq(opts.label)}@jdm-test.local`,
    name: opts.userName,
    verified: true,
    role: 'user',
  });

  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  // createUser mints the garage with a slug derived from user.id; override so
  // tests can assert on a deterministic slug.
  await prisma.garage.update({
    where: { id: garage.id },
    data: { slug: opts.garageSlug },
  });

  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider,
      providerCustomerRef: `cus_test_${uniq(opts.garageSlug)}`,
      providerSubRef: `sub_test_${uniq(opts.garageSlug)}`,
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
        providerInvoiceRef: `inv_${uniq('r')}`,
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

  return { userId: user.id, garageId: garage.id, membershipId: membership.id };
}

// ---------------------------------------------------------------------------
// Tests — GET /admin/finance/memberships
// ---------------------------------------------------------------------------

describe('GET /admin/finance/memberships', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/finance/memberships' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin role', async () => {
    const { user } = await createUser({
      email: `${uniq('u')}@jdm-test.local`,
      verified: true,
      role: 'user',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships',
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns empty page when no memberships exist', async () => {
    const headers = await adminAuthHeader('empty');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships',
      headers,
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
      label: 'shape',
      garageSlug: 'shape-test',
      userName: 'Marcos Lima',
      invoices: [{ grossAmountCents: 5489 }, { grossAmountCents: 5489 }],
    });

    const headers = await adminAuthHeader('shape-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships',
      headers,
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
        label: `pg-${i}`,
        garageSlug: `page-slug-${i}`,
        userName: `User ${i}`,
      });
    }

    const headers = await adminAuthHeader('pg-admin');

    const page1 = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?page=1&pageSize=2',
      headers,
    });
    const p1 = adminFinanceMembershipsResponseSchema.parse(page1.json());
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(2);

    const page2 = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?page=2&pageSize=2',
      headers,
    });
    const p2 = adminFinanceMembershipsResponseSchema.parse(page2.json());
    expect(p2.items).toHaveLength(2);
    expect(p2.page).toBe(2);

    const page3 = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?page=3&pageSize=2',
      headers,
    });
    const p3 = adminFinanceMembershipsResponseSchema.parse(page3.json());
    expect(p3.items).toHaveLength(1);
  });

  it('filters by status', async () => {
    await seedMembership({
      label: 'f-status-a',
      garageSlug: 'active-1',
      userName: 'A',
      status: 'active',
    });
    await seedMembership({
      label: 'f-status-b',
      garageSlug: 'expired-1',
      userName: 'B',
      status: 'expired',
    });
    await seedMembership({
      label: 'f-status-c',
      garageSlug: 'past-due-1',
      userName: 'C',
      status: 'past_due',
    });

    const headers = await adminAuthHeader('status-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?status=active',
      headers,
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.status).toBe('active');
  });

  it('filters by cadence', async () => {
    await seedMembership({
      label: 'f-cad-m',
      garageSlug: 'monthly-1',
      userName: 'M',
      cadence: 'monthly',
    });
    await seedMembership({
      label: 'f-cad-a',
      garageSlug: 'annual-1',
      userName: 'N',
      cadence: 'annual',
    });

    const headers = await adminAuthHeader('cad-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?cadence=annual',
      headers,
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.cadence).toBe('annual');
  });

  it('filters by tier', async () => {
    await seedMembership({
      label: 'f-tier-g',
      garageSlug: 'gold-1',
      userName: 'G',
      tier: 'gold',
    });
    await seedMembership({
      label: 'f-tier-s',
      garageSlug: 'silver-1',
      userName: 'S',
      tier: 'silver',
    });

    const headers = await adminAuthHeader('tier-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?tier=gold',
      headers,
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.tier).toBe('gold');
  });

  it('filters by provider', async () => {
    await seedMembership({
      label: 'f-prov-s',
      garageSlug: 'stripe-user',
      userName: 'S',
      provider: 'stripe',
    });
    await seedMembership({
      label: 'f-prov-a',
      garageSlug: 'apple-user',
      userName: 'P',
      provider: 'apple_revenuecat',
    });

    const headers = await adminAuthHeader('prov-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?provider=apple_revenuecat',
      headers,
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.provider).toBe('apple_revenuecat');
  });

  it('filters by from/to date range on currentPeriodEnd', async () => {
    const past = new Date('2025-01-15T12:00:00Z');
    const future = new Date('2027-06-01T12:00:00Z');

    await seedMembership({
      label: 'f-date-early',
      garageSlug: 'early-end',
      userName: 'Early',
      currentPeriodEnd: past,
    });
    await seedMembership({
      label: 'f-date-late',
      garageSlug: 'late-end',
      userName: 'Late',
      currentPeriodEnd: future,
    });

    const headers = await adminAuthHeader('date-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?from=2027-01-01&to=2027-12-31',
      headers,
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.garageSlug).toBe('late-end');
  });

  it('filters by search — matches userName (case-insensitive contains)', async () => {
    await seedMembership({
      label: 'f-search-c',
      garageSlug: 'carlos-garage',
      userName: 'Carlos Mendes',
    });
    await seedMembership({
      label: 'f-search-a',
      garageSlug: 'ana-garage',
      userName: 'Ana Souza',
    });

    const headers = await adminAuthHeader('search-name-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?search=carlos',
      headers,
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.userName).toBe('Carlos Mendes');
  });

  it('filters by search — matches userEmail (case-insensitive contains)', async () => {
    // Email-based seed: createUser builds a unique email from the label; use a
    // deterministic-enough label so the substring is searchable.
    const seedA = await seedMembership({
      label: 'findme-target',
      garageSlug: 'email-match',
      userName: 'Someone',
    });
    await seedMembership({
      label: 'other',
      garageSlug: 'no-match',
      userName: 'Other',
    });

    // The auto-generated email starts with `findme-target-…`. Search by that prefix.
    const headers = await adminAuthHeader('search-email-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships?search=findme-target',
      headers,
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.membershipId).toBe(seedA.membershipId);
  });

  it('filters by garageId (F8.16 forward-compat)', async () => {
    const a = await seedMembership({
      label: 'gid-a',
      garageSlug: 'gid-garage-a',
      userName: 'A',
    });
    await seedMembership({
      label: 'gid-b',
      garageSlug: 'gid-garage-b',
      userName: 'B',
    });

    const headers = await adminAuthHeader('gid-admin');
    const res = await app.inject({
      method: 'GET',
      url: `/admin/finance/memberships?garageId=${a.garageId}`,
      headers,
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.total).toBe(1);
    expect(body.items[0]!.membershipId).toBe(a.membershipId);
  });

  it('totalPaidCents sums only paid invoices (not refunded); invoiceCount counts all', async () => {
    await seedMembership({
      label: 'refund-test',
      garageSlug: 'refund-test',
      userName: 'Refund User',
      invoices: [
        { grossAmountCents: 5489, status: 'paid' },
        { grossAmountCents: 5489, status: 'refunded' },
      ],
    });

    const headers = await adminAuthHeader('refund-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/memberships',
      headers,
    });
    const body = adminFinanceMembershipsResponseSchema.parse(res.json());
    expect(body.items[0]!.totalPaidCents).toBe(5489); // only the paid one
    expect(body.items[0]!.invoiceCount).toBe(2); // count includes refunded
  });
});

// ---------------------------------------------------------------------------
// Tests — GET /admin/finance/export — membership columns + k-anonymity
// ---------------------------------------------------------------------------

describe('GET /admin/finance/export — membership columns + k-anonymity', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('CSV header includes cadence, is_membership, membership_invoice_id', async () => {
    const headers = await adminAuthHeader('csv-header-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/export',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const lines = res.body.split('\n');
    const header = lines[0]!;
    expect(header).toContain('cadence');
    expect(header).toContain('is_membership');
    expect(header).toContain('membership_invoice_id');
  });

  it('membership cohort >= 5 appears in CSV with is_membership=true', async () => {
    for (let i = 0; i < 6; i++) {
      await seedMembership({
        label: `csv-member-${i}`,
        garageSlug: `csv-member-${i}`,
        userName: `Member ${i}`,
        cadence: 'monthly',
        tier: 'gold',
        provider: 'stripe',
      });
    }

    const headers = await adminAuthHeader('csv-cohort-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/export',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const lines = res.body.split('\n').filter(Boolean);
    // At least one data row with is_membership=true
    const membershipRows = lines.slice(1).filter((l) => l.includes(',true,'));
    expect(membershipRows.length).toBeGreaterThan(0);
  });

  it('membership cohort with fewer than 5 invoices is suppressed', async () => {
    for (let i = 0; i < 3; i++) {
      await seedMembership({
        label: `small-cohort-${i}`,
        garageSlug: `small-cohort-${i}`,
        userName: `Small ${i}`,
        cadence: 'annual',
        tier: 'gold',
        provider: 'apple_revenuecat',
      });
    }

    const headers = await adminAuthHeader('csv-suppress-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/export',
      headers,
    });
    expect(res.statusCode).toBe(200);

    // No membership rows should appear in CSV body.
    const lines = res.body.split('\n').filter(Boolean);
    const membershipRows = lines.slice(1).filter((l) => l.includes(',true,'));
    expect(membershipRows).toHaveLength(0);

    // The suppressed-groups header should reflect the suppressed cohort.
    const suppressed = Number(res.headers['x-ccc-k-anonymity-suppressed-groups']);
    expect(suppressed).toBeGreaterThanOrEqual(1);
  });

  it('header has at least 17 columns (original 14 + 3 new)', async () => {
    const headers = await adminAuthHeader('csv-cols-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/export',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const lines = res.body.split('\n').filter(Boolean);
    const headerCols = lines[0]!.split(',').length;
    expect(headerCols).toBe(17);
  });

  // Reviewer fix: k-anonymity must count distinct members, not invoices. A
  // single member with 6 invoices does NOT defeat the threshold.
  it('single member with 6 invoices is suppressed (distinct-member k-anonymity)', async () => {
    await seedMembership({
      label: 'one-member-many-invoices',
      garageSlug: 'one-member-many-invoices',
      userName: 'Solo Heavy',
      cadence: 'monthly',
      tier: 'gold',
      provider: 'stripe',
      invoices: [
        { grossAmountCents: 5489 },
        { grossAmountCents: 5489 },
        { grossAmountCents: 5489 },
        { grossAmountCents: 5489 },
        { grossAmountCents: 5489 },
        { grossAmountCents: 5489 },
      ],
    });

    const headers = await adminAuthHeader('csv-distinct-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/export',
      headers,
    });
    expect(res.statusCode).toBe(200);

    const lines = res.body.split('\n').filter(Boolean);
    const membershipRows = lines.slice(1).filter((l) => l.includes(',true,'));
    expect(membershipRows).toHaveLength(0);

    const suppressed = Number(res.headers['x-ccc-k-anonymity-suppressed-groups']);
    expect(suppressed).toBeGreaterThanOrEqual(1);
  });

  // Reviewer fix: /finance/export?provider=stripe must exclude apple_revenuecat
  // membership invoices, mirroring the order-side provider filter behavior.
  it('provider filter excludes other-provider memberships from CSV', async () => {
    // Seed 6 stripe members + 6 apple_revenuecat members (each cohort large
    // enough to survive distinct-member k-anonymity on its own).
    for (let i = 0; i < 6; i++) {
      await seedMembership({
        label: `prov-stripe-${i}`,
        garageSlug: `prov-stripe-${i}`,
        userName: `Stripe ${i}`,
        cadence: 'monthly',
        tier: 'gold',
        provider: 'stripe',
      });
      await seedMembership({
        label: `prov-rc-${i}`,
        garageSlug: `prov-rc-${i}`,
        userName: `RC ${i}`,
        cadence: 'monthly',
        tier: 'gold',
        provider: 'apple_revenuecat',
      });
    }

    const headers = await adminAuthHeader('csv-provider-filter-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/export?provider=stripe',
      headers,
    });
    expect(res.statusCode).toBe(200);

    const lines = res.body.split('\n').filter(Boolean);
    const membershipRows = lines.slice(1).filter((l) => l.includes(',true,'));
    // Stripe cohort survives; apple_revenuecat cohort is filtered out before
    // bucketing — so exactly one membership row appears (the stripe one).
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0]).toContain(',stripe,');
    expect(membershipRows[0]).not.toContain(',apple_revenuecat,');
  });

  // Reviewer fix: the status column on membership rows MUST be the invoice
  // payment status (paid / refunded), not the membership lifecycle status
  // (active / past_due / cancel_scheduled / etc.). The membershipInvoiceWhere
  // filter already restricts to status='paid', so the column is a constant.
  it('CSV status column for membership rows is invoice status (not lifecycle)', async () => {
    // Seed 6 active members + 1 cancel_scheduled member with same bucket.
    // All produce a status='paid' invoice. The lifecycle status on the
    // membership row varies; the CSV row's status column MUST NOT leak it.
    for (let i = 0; i < 6; i++) {
      await seedMembership({
        label: `status-active-${i}`,
        garageSlug: `status-active-${i}`,
        userName: `Active ${i}`,
        cadence: 'annual',
        tier: 'gold',
        provider: 'stripe',
        status: 'active',
      });
    }
    await seedMembership({
      label: 'status-cancel-scheduled',
      garageSlug: 'status-cancel-scheduled',
      userName: 'Bye',
      cadence: 'annual',
      tier: 'gold',
      provider: 'stripe',
      status: 'cancel_scheduled',
    });

    const headers = await adminAuthHeader('csv-status-admin');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/export',
      headers,
    });
    expect(res.statusCode).toBe(200);

    const lines = res.body.split('\n').filter(Boolean);
    const membershipRows = lines.slice(1).filter((l) => l.includes(',true,'));
    // One bucketed row (cadence=annual, tier=gold, provider=stripe). Status
    // column should be 'paid', NOT 'active' / 'cancel_scheduled'.
    expect(membershipRows).toHaveLength(1);
    const row = membershipRows[0]!;
    const cols = row.split(',');
    // Column 7 (index 6) is `status` per header order.
    expect(cols[6]).toBe('paid');
    expect(row).not.toContain(',active,');
    expect(row).not.toContain(',cancel_scheduled,');
  });
});
