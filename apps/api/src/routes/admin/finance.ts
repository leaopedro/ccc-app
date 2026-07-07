import { prisma } from '@jdm/db';
import {
  adminFinanceMembershipsQuerySchema,
  adminFinanceQuerySchema,
  type AdminFinanceQuery,
} from '@jdm/shared/admin';
import {
  Prisma,
  type GaragePremiumTier,
  type OrderStatus,
  type PaymentMethod,
  type PaymentProvider,
  type PremiumCadence,
  type PremiumMembershipStatus,
  type PremiumProvider,
} from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

type FinanceOrderRecord = {
  id: string;
  eventId: string | null;
  amountCents: number;
  devFeeAmountCents: number;
  provider: PaymentProvider;
  method: PaymentMethod;
  status: OrderStatus;
  paidAt: Date | null;
  items: Array<{ subtotalCents: number; kind: 'ticket' | 'product' | 'extras' }>;
  event: null | {
    id: string;
    title: string;
    startsAt: Date;
    city: string | null;
    stateCode: string | null;
  };
};

const MIN_FINANCE_EXPORT_COHORT_SIZE = 5;

type FinanceExportBucket = {
  eventId: string;
  eventTitle: string;
  city: string;
  stateCode: string;
  currency: string;
  method: PaymentMethod;
  provider: PaymentProvider;
  status: OrderStatus;
  kind: string;
  productSignature: string;
  productOrCollection: string;
  orderCount: number;
  totalAmountCents: number;
  totalQuantity: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
};

function buildWhere(query: unknown): Prisma.OrderWhereInput {
  const q = adminFinanceQuerySchema.parse(query);
  const where: Prisma.OrderWhereInput = {};

  if (q.statuses && q.statuses.length > 0) {
    where.status = { in: q.statuses };
  } else {
    where.status = { in: ['paid', 'refunded'] };
  }

  if (q.from || q.to) {
    const dateFilter: Prisma.DateTimeNullableFilter<'Order'> = {};
    if (q.from) dateFilter.gte = new Date(`${q.from}T00:00:00.000Z`);
    if (q.to) dateFilter.lte = new Date(`${q.to}T23:59:59.999Z`);
    where.OR = [
      { status: 'paid', paidAt: dateFilter },
      { status: 'refunded', refundedAt: dateFilter },
    ];
  }

  if (q.provider) where.provider = q.provider;
  if (q.method) where.method = q.method;

  if (q.eventIds && q.eventIds.length > 0) {
    where.eventId = { in: q.eventIds };
  }

  if (q.search || q.city || q.stateCode) {
    where.event = {};
    if (q.search) {
      where.event.title = { contains: q.search, mode: 'insensitive' };
    }
    if (q.city) where.event.city = q.city;
    if (q.stateCode) where.event.stateCode = q.stateCode;
  }

  return where;
}

function getFinanceOrderRevenueCents(
  order: Pick<FinanceOrderRecord, 'amountCents' | 'items'>,
): number {
  if (order.items.length === 0) {
    return order.amountCents;
  }

  return order.items.reduce((sum, item) => sum + item.subtotalCents, 0);
}

function getOrderItemRevenueCents(
  order: Pick<FinanceOrderRecord, 'amountCents' | 'items'>,
  kind: 'ticket' | 'product' | 'extras',
): number {
  if (order.items.length === 0) return kind === 'ticket' ? order.amountCents : 0;
  return order.items.filter((i) => i.kind === kind).reduce((sum, i) => sum + i.subtotalCents, 0);
}

function hasProductItems(order: Pick<FinanceOrderRecord, 'items'>): boolean {
  return order.items.some((i) => i.kind === 'product');
}

function buildFinanceExportBucketKey(
  bucket: Pick<
    FinanceExportBucket,
    | 'eventId'
    | 'eventTitle'
    | 'city'
    | 'stateCode'
    | 'currency'
    | 'method'
    | 'provider'
    | 'status'
    | 'kind'
    | 'productSignature'
    | 'productOrCollection'
  >,
): string {
  return [
    bucket.eventId,
    bucket.eventTitle,
    bucket.city,
    bucket.stateCode,
    bucket.currency,
    bucket.method,
    bucket.provider,
    bucket.status,
    bucket.kind,
    bucket.productSignature,
    bucket.productOrCollection,
  ].join('\u001f');
}

async function findFinanceOrders(
  where: Prisma.OrderWhereInput,
  statuses: Array<'paid' | 'refunded'>,
): Promise<FinanceOrderRecord[]> {
  const orders = await prisma.order.findMany({
    where: {
      ...where,
      status: { in: statuses },
    },
    select: {
      id: true,
      eventId: true,
      amountCents: true,
      devFeeAmountCents: true,
      provider: true,
      method: true,
      status: true,
      paidAt: true,
      event: {
        select: {
          id: true,
          title: true,
          startsAt: true,
          city: true,
          stateCode: true,
        },
      },
    },
  });

  const orderIds = orders.map((order) => order.id);
  const orderItems =
    orderIds.length > 0
      ? await prisma.$queryRaw<
          Array<{ orderId: string; subtotalCents: number; kind: 'ticket' | 'product' | 'extras' }>
        >(Prisma.sql`
          SELECT "orderId", "subtotalCents", "kind"::"text" AS "kind"
          FROM "OrderItem"
          WHERE "orderId" IN (${Prisma.join(orderIds)})
        `)
      : [];

  const itemsByOrderId = new Map<
    string,
    Array<{ subtotalCents: number; kind: 'ticket' | 'product' | 'extras' }>
  >();
  for (const item of orderItems) {
    const bucket = itemsByOrderId.get(item.orderId) ?? [];
    bucket.push({ subtotalCents: item.subtotalCents, kind: item.kind });
    itemsByOrderId.set(item.orderId, bucket);
  }

  return orders.map((order) => ({
    ...order,
    items: itemsByOrderId.get(order.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Membership invoice query helper (F8.13)
// ---------------------------------------------------------------------------
//
// Forward-compatible filter object: F8.14 (memberships listing) + F8.16 (per-garage
// finance summary) reuse this helper. `garageId` lets F8.16 scope to a single garage.
// `cadence` + `tier` enable the F8.14 list filter UI. Keep the signature stable —
// downstream chunks import this without changes.
type MembershipInvoiceStatusFilter = string | { in: string[] };

type MembershipInvoiceWhereInput = {
  paidAtFrom?: Date;
  paidAtTo?: Date;
  status?: MembershipInvoiceStatusFilter;
  provider?: 'stripe' | 'apple_revenuecat';
  cadence?: 'monthly' | 'annual';
  tier?: 'bronze' | 'silver' | 'gold';
  garageId?: string;
};

type MembershipInvoiceRecord = {
  id: string;
  membershipId: string;
  provider: 'stripe' | 'apple_revenuecat';
  grossAmountCents: number;
  devFeeAmountCents: number;
  devFeePercent: number;
  baseAmountCents: number;
  status: string;
  paidAt: Date;
  refundedAmountCents: number | null;
  membership: {
    cadence: 'monthly' | 'annual';
    tier: 'bronze' | 'silver' | 'gold';
    status: string;
    garageId: string;
  };
};

// Memberships exist only on the `stripe` + `apple_revenuecat` providers, with
// synthetic methods `subscription` (Stripe) + `storekit` (RC). Any
// order-only provider (abacatepay) or order-only method (card, pix) excises
// memberships from the response — without this gate the membership rows
// would leak into provider/method-filtered finance numbers.
//
// F8.15 fix-up: `kind` adds an explicit scope toggle. `kind='tickets'` and
// `kind='store'` exclude memberships outright; `kind='membership'` excludes
// orders. `kind='all'` (or undefined) preserves the pre-F8.15 mixed view,
// but provider/method gating still applies.
function shouldIncludeMembership(q: AdminFinanceQuery): boolean {
  if (q.kind === 'tickets' || q.kind === 'store') return false;
  if (q.provider === 'abacatepay') return false;
  if (q.method !== undefined) return false;
  return true;
}

function shouldIncludeOrders(q: AdminFinanceQuery): boolean {
  // `kind='membership'` short-circuits the order side: zero out order-derived
  // counters and skip the (potentially large) Order/Ticket queries entirely.
  if (q.kind === 'membership') return false;
  return true;
}

// Treat the literal `'all'` sentinel the FilterBar emits as "no filter" — keeps
// the Prisma where clauses clean.
function normalizeMembershipCadence(q: AdminFinanceQuery): 'monthly' | 'annual' | undefined {
  return q.cadence && q.cadence !== 'all' ? q.cadence : undefined;
}

function normalizeMembershipTier(q: AdminFinanceQuery): 'gold' | undefined {
  return q.tier && q.tier !== 'all' ? q.tier : undefined;
}

function normalizeMembershipStatus(
  q: AdminFinanceQuery,
): 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | undefined {
  return q.membershipStatus && q.membershipStatus !== 'all' ? q.membershipStatus : undefined;
}

async function findMembershipInvoices(
  where: MembershipInvoiceWhereInput,
): Promise<MembershipInvoiceRecord[]> {
  const filters: Prisma.PremiumMembershipInvoiceWhereInput = {};

  // Default to revenue-bearing statuses (canon: refund still counts as a recognized
  // invoice; we net it against gross in the caller).
  filters.status =
    where.status !== undefined ? where.status : { in: ['paid', 'partial_refund', 'refunded'] };

  if (where.paidAtFrom || where.paidAtTo) {
    const paidAtFilter: Prisma.DateTimeFilter<'PremiumMembershipInvoice'> = {};
    if (where.paidAtFrom) paidAtFilter.gte = where.paidAtFrom;
    if (where.paidAtTo) paidAtFilter.lte = where.paidAtTo;
    filters.paidAt = paidAtFilter;
  }

  if (where.provider) filters.provider = where.provider;

  if (where.cadence || where.tier || where.garageId) {
    filters.membership = {};
    if (where.cadence) filters.membership.cadence = where.cadence;
    if (where.tier) filters.membership.tier = where.tier;
    if (where.garageId) filters.membership.garageId = where.garageId;
  }

  const invoices = await prisma.premiumMembershipInvoice.findMany({
    where: filters,
    select: {
      id: true,
      membershipId: true,
      provider: true,
      grossAmountCents: true,
      devFeeAmountCents: true,
      devFeePercent: true,
      baseAmountCents: true,
      status: true,
      paidAt: true,
      refundedAmountCents: true,
      membership: {
        select: {
          cadence: true,
          tier: true,
          status: true,
          garageId: true,
        },
      },
    },
  });

  return invoices;
}

// F8.14 — list-shape: one row per PremiumMembership with invoices joined for
// totalPaidCents + invoiceCount. Distinct from findMembershipInvoices, which
// is invoice-shape for revenue accounting.
type RawMembershipRow = {
  id: string;
  tier: GaragePremiumTier;
  cadence: PremiumCadence;
  status: PremiumMembershipStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  providerSubRef: string;
  provider: PremiumProvider;
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
  provider: PremiumProvider;
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
  if (query.garageId) where.garageId = query.garageId;

  if (query.from || query.to) {
    const periodFilter: Prisma.DateTimeFilter<'PremiumMembership'> = {};
    if (query.from) periodFilter.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) periodFilter.lte = new Date(`${query.to}T23:59:59.999Z`);
    where.currentPeriodEnd = periodFilter;
  }

  if (query.search) {
    where.garage = {
      user: {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      },
    };
  }

  const skip = (query.page - 1) * query.pageSize;

  const [memberships, total] = await Promise.all([
    prisma.premiumMembership.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

// eslint-disable-next-line @typescript-eslint/require-await
export const adminFinanceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/finance/summary', async (request) => {
    const where = buildWhere(request.query);
    const q = adminFinanceQuerySchema.parse(request.query);

    // Build a membership-scoped where independently of the order-scoped where.
    // Membership invoices are filtered by paidAt date range + optional provider.
    // Method/eventIds/search/city/state are order-only concepts → if any is
    // set, membership rows are excluded entirely so they do not leak into a
    // provider/method-filtered view (e.g. q.provider=abacatepay or q.method=pix).
    const fromDate = q.from ? new Date(`${q.from}T00:00:00.000Z`) : undefined;
    const toDate = q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined;
    const includeMembership = shouldIncludeMembership(q);
    const includeOrders = shouldIncludeOrders(q);
    // F8.15 fix-up: membership-side sub-filters apply when the caller is
    // explicitly scoping to membership-kind data.
    const membershipCadence = normalizeMembershipCadence(q);
    const membershipTier = normalizeMembershipTier(q);
    const membershipStatusFilter = normalizeMembershipStatus(q);
    const membershipWhere: MembershipInvoiceWhereInput = {};
    if (fromDate) membershipWhere.paidAtFrom = fromDate;
    if (toDate) membershipWhere.paidAtTo = toDate;
    if (q.provider === 'stripe') membershipWhere.provider = 'stripe';
    if (membershipCadence) membershipWhere.cadence = membershipCadence;
    if (membershipTier) membershipWhere.tier = membershipTier;

    // Membership row-level filters shared by the active-count + new-count + MRR.
    // status filter is OR'd between the FilterBar selection and the
    // "active-bearing" default; when set, callers want exactly that status.
    const activeStatusList: Array<'active' | 'cancel_scheduled' | 'past_due'> = [
      'active',
      'cancel_scheduled',
      'past_due',
    ];
    const membershipRowStatusForActiveCount: Prisma.PremiumMembershipWhereInput['status'] =
      membershipStatusFilter && membershipStatusFilter !== 'expired'
        ? membershipStatusFilter
        : { in: activeStatusList };

    const [
      orders,
      ticketCount,
      membershipInvoices,
      activeMembershipRows,
      newMemberships,
      churnedMemberships,
    ] = await Promise.all([
      includeOrders ? findFinanceOrders(where, ['paid', 'refunded']) : Promise.resolve([]),
      includeOrders
        ? prisma.ticket.count({
            where: {
              order: where,
              status: { in: ['valid', 'used'] },
            },
          })
        : Promise.resolve(0),
      includeMembership ? findMembershipInvoices(membershipWhere) : Promise.resolve([]),
      // Pull active rows once for both count + MRR (cadence/gross needed for MRR math).
      // F8.15 fix-up: when the caller scopes by membership cadence/tier/status,
      // narrow the active row set to match.
      includeMembership
        ? prisma.premiumMembership.findMany({
            where: {
              status: membershipRowStatusForActiveCount,
              ...(membershipCadence ? { cadence: membershipCadence } : {}),
              ...(membershipTier ? { tier: membershipTier } : {}),
            },
            select: { cadence: true, grossAmountCents: true },
          })
        : Promise.resolve([]),
      // newMembershipsCount: PremiumMembership.createdAt inside [from, to].
      includeMembership
        ? prisma.premiumMembership.count({
            where: {
              ...(fromDate || toDate
                ? {
                    createdAt: {
                      ...(fromDate ? { gte: fromDate } : {}),
                      ...(toDate ? { lte: toDate } : {}),
                    },
                  }
                : {}),
              ...(membershipCadence ? { cadence: membershipCadence } : {}),
              ...(membershipTier ? { tier: membershipTier } : {}),
              ...(membershipStatusFilter ? { status: membershipStatusFilter } : {}),
            },
          })
        : Promise.resolve(0),
      // churnedMembershipsCount: gap #2 — no `expiredAt` column, so use cancelledAt as
      // the proxy for "lifecycle ended inside the window". Pattern stays additive;
      // product confirmation pending. Comment kept in code for grep-discoverability.
      includeMembership
        ? prisma.premiumMembership.count({
            where: {
              status: 'expired',
              cancelledAt: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {}),
                not: null,
              },
              ...(membershipCadence ? { cadence: membershipCadence } : {}),
              ...(membershipTier ? { tier: membershipTier } : {}),
            },
          })
        : Promise.resolve(0),
    ]);

    let totalRevenueCents = 0;
    let refundedCents = 0;
    let orderCount = 0;
    let refundedCount = 0;
    let storeRevenueCents = 0;
    let storeOrderCount = 0;
    let devFeeCollectedCents = 0;
    let devFeeRefundedCents = 0;

    for (const order of orders) {
      const revenueCents = getFinanceOrderRevenueCents(order);
      if (order.status === 'paid') {
        totalRevenueCents += revenueCents;
        orderCount += 1;
        const storeRev = getOrderItemRevenueCents(order, 'product');
        storeRevenueCents += storeRev;
        if (hasProductItems(order)) storeOrderCount += 1;
        devFeeCollectedCents += order.devFeeAmountCents;
      } else {
        refundedCents += revenueCents;
        refundedCount += 1;
        devFeeRefundedCents += order.devFeeAmountCents;
      }
    }

    const avgOrderCents = orderCount > 0 ? Math.round(totalRevenueCents / orderCount) : 0;
    const netRevenueCents = totalRevenueCents - refundedCents;
    const netDevFeeCollectedCents = devFeeCollectedCents - devFeeRefundedCents;

    // ─── Membership aggregation (F8.13) ────────────────────────────────────
    // gross + devFee come from the per-invoice snapshot (canon §F8.1). We do
    // NOT re-derive devFee from env.
    //
    // devFee refund-adjustment: PremiumMembershipInvoice does not track a
    // separate `devFeeRefundedAmountCents` column, so we apportion the
    // refund proportionally to gross — matches the way an order-row refund
    // proportionally consumes its `devFeeAmountCents`. Without this the
    // metric labelled "collected" would actually be gross-of-refunds.
    let membershipRevenueCents = 0;
    let membershipRefundedCents = 0;
    let membershipDevFeeGrossCents = 0;
    let membershipDevFeeRefundedCents = 0;
    for (const inv of membershipInvoices) {
      membershipRevenueCents += inv.grossAmountCents;
      membershipDevFeeGrossCents += inv.devFeeAmountCents;
      if (inv.refundedAmountCents != null && inv.refundedAmountCents > 0) {
        membershipRefundedCents += inv.refundedAmountCents;
        if (inv.grossAmountCents > 0) {
          membershipDevFeeRefundedCents += Math.round(
            (inv.devFeeAmountCents * inv.refundedAmountCents) / inv.grossAmountCents,
          );
        }
      }
    }
    const membershipNetRevenueCents = membershipRevenueCents - membershipRefundedCents;
    const membershipDevFeeCollectedCents =
      membershipDevFeeGrossCents - membershipDevFeeRefundedCents;

    const activeMembershipsCount = activeMembershipRows.length;

    // MRR (spec §7.3): monthly → grossAmountCents; annual → Math.round(gross/12).
    let membershipMRRCents = 0;
    for (const m of activeMembershipRows) {
      if (m.cadence === 'monthly') {
        membershipMRRCents += m.grossAmountCents;
      } else {
        membershipMRRCents += Math.round(m.grossAmountCents / 12);
      }
    }

    // ARPU: guarded division — returns 0 when no active members.
    const membershipARPUCents =
      activeMembershipsCount > 0
        ? Math.round(membershipNetRevenueCents / activeMembershipsCount)
        : 0;

    return {
      totalRevenueCents,
      netRevenueCents,
      orderCount,
      avgOrderCents,
      ticketCount,
      refundedCents,
      refundedCount,
      storeRevenueCents,
      storeOrderCount,
      devFeePercent: app.env.DEV_FEE_PERCENT,
      devFeeCollectedCents: netDevFeeCollectedCents,
      membershipRevenueCents,
      membershipNetRevenueCents,
      membershipDevFeeCollectedCents,
      membershipRefundedCents,
      activeMembershipsCount,
      newMembershipsCount: newMemberships,
      churnedMembershipsCount: churnedMemberships,
      membershipMRRCents,
      membershipARPUCents,
    };
  });

  app.get('/finance/by-event', async (request) => {
    const where = buildWhere(request.query);
    const whereWithEvent: Prisma.OrderWhereInput = { ...where, eventId: { not: null } };
    const orders = await findFinanceOrders(whereWithEvent, ['paid', 'refunded']);
    const buckets = new Map<
      string,
      {
        eventId: string;
        eventTitle: string;
        startsAt: string;
        city: string | null;
        stateCode: string | null;
        revenueCents: number;
        orderCount: number;
        ticketCount: number;
        refundedCents: number;
      }
    >();

    for (const order of orders) {
      if (!order.eventId || !order.event) {
        continue;
      }

      const bucket = buckets.get(order.eventId) ?? {
        eventId: order.eventId,
        eventTitle: order.event.title,
        startsAt: order.event.startsAt.toISOString(),
        city: order.event.city,
        stateCode: order.event.stateCode,
        revenueCents: 0,
        orderCount: 0,
        ticketCount: 0,
        refundedCents: 0,
      };

      const revenueCents = getFinanceOrderRevenueCents(order);
      if (order.status === 'paid') {
        bucket.revenueCents += revenueCents;
        bucket.orderCount += 1;
      } else {
        bucket.refundedCents += revenueCents;
      }

      buckets.set(order.eventId, bucket);
    }

    const eventIds = Array.from(buckets.keys());
    const ticketCounts = await prisma.ticket.groupBy({
      by: ['eventId'],
      where: {
        eventId: { in: eventIds },
        order: whereWithEvent,
        status: { in: ['valid', 'used'] },
      },
      _count: { id: true },
    });
    const ticketMap = new Map(ticketCounts.map((t) => [t.eventId, t._count?.id ?? 0]));

    const items = Array.from(buckets.values())
      .map((bucket) => ({
        ...bucket,
        ticketCount: ticketMap.get(bucket.eventId) ?? 0,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);

    return { items };
  });

  app.get('/finance/trends', async (request) => {
    const where = buildWhere(request.query);
    const tq = adminFinanceQuerySchema.parse(request.query);

    // Membership invoices for this window — paid only on the trend curve.
    // Excise memberships entirely when the filter targets an order-only
    // provider (abacatepay) or method (card, pix). Stripe filter narrows to
    // Stripe-provider memberships only.
    // F8.15 fix-up: membership-side sub-filters carry through to the trend
    // bucket aggregation so `kind=membership&cadence=monthly` returns only
    // monthly-cadence revenue per day.
    const trendMembershipWhere: MembershipInvoiceWhereInput = { status: 'paid' };
    if (tq.from) trendMembershipWhere.paidAtFrom = new Date(`${tq.from}T00:00:00.000Z`);
    if (tq.to) trendMembershipWhere.paidAtTo = new Date(`${tq.to}T23:59:59.999Z`);
    if (tq.provider === 'stripe') trendMembershipWhere.provider = 'stripe';
    const trendCadence = normalizeMembershipCadence(tq);
    const trendTier = normalizeMembershipTier(tq);
    if (trendCadence) trendMembershipWhere.cadence = trendCadence;
    if (trendTier) trendMembershipWhere.tier = trendTier;
    const trendIncludeMembership = shouldIncludeMembership(tq);
    const trendIncludeOrders = shouldIncludeOrders(tq);

    const [orders, membershipInvoicesForTrend] = await Promise.all([
      trendIncludeOrders ? findFinanceOrders(where, ['paid']) : Promise.resolve([]),
      trendIncludeMembership ? findMembershipInvoices(trendMembershipWhere) : Promise.resolve([]),
    ]);

    const buckets = new Map<
      string,
      {
        revenueCents: number;
        orderCount: number;
        ticketRevenueCents: number;
        storeRevenueCents: number;
        membershipRevenueCents: number;
      }
    >();
    for (const o of orders) {
      if (!o.paidAt) continue;
      const date = o.paidAt.toISOString().slice(0, 10);
      const bucket = buckets.get(date) ?? {
        revenueCents: 0,
        orderCount: 0,
        ticketRevenueCents: 0,
        storeRevenueCents: 0,
        membershipRevenueCents: 0,
      };
      bucket.revenueCents += getFinanceOrderRevenueCents(o);
      bucket.orderCount += 1;
      bucket.ticketRevenueCents +=
        getOrderItemRevenueCents(o, 'ticket') + getOrderItemRevenueCents(o, 'extras');
      bucket.storeRevenueCents += getOrderItemRevenueCents(o, 'product');
      buckets.set(date, bucket);
    }

    // F8.13: fold membership invoices into the same daily buckets. Membership-only
    // days create new points where orderCount/ticketRevenue/storeRevenue stay at 0.
    for (const inv of membershipInvoicesForTrend) {
      const date = inv.paidAt.toISOString().slice(0, 10);
      const bucket = buckets.get(date) ?? {
        revenueCents: 0,
        orderCount: 0,
        ticketRevenueCents: 0,
        storeRevenueCents: 0,
        membershipRevenueCents: 0,
      };
      bucket.membershipRevenueCents += inv.grossAmountCents;
      bucket.revenueCents += inv.grossAmountCents;
      buckets.set(date, bucket);
    }

    const points = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    return { points };
  });

  app.get('/finance/payment-mix', async (request) => {
    const where = buildWhere(request.query);
    const pmq = adminFinanceQuerySchema.parse(request.query);

    // Excise membership rows when the filter targets an order-only provider
    // (abacatepay) or method (card, pix). Stripe narrows to Stripe-provider
    // memberships only. Without this gate the stripe:subscription + RC
    // storekit rows would appear even when filtering for, e.g., q.method=pix.
    // F8.15 fix-up: membership-side sub-filters carry through so the mix
    // narrows to e.g. only monthly-cadence revenue when requested.
    const pmMembershipWhere: MembershipInvoiceWhereInput = { status: 'paid' };
    if (pmq.from) pmMembershipWhere.paidAtFrom = new Date(`${pmq.from}T00:00:00.000Z`);
    if (pmq.to) pmMembershipWhere.paidAtTo = new Date(`${pmq.to}T23:59:59.999Z`);
    if (pmq.provider === 'stripe') pmMembershipWhere.provider = 'stripe';
    const pmCadence = normalizeMembershipCadence(pmq);
    const pmTier = normalizeMembershipTier(pmq);
    if (pmCadence) pmMembershipWhere.cadence = pmCadence;
    if (pmTier) pmMembershipWhere.tier = pmTier;
    const pmIncludeMembership = shouldIncludeMembership(pmq);
    const pmIncludeOrders = shouldIncludeOrders(pmq);

    const [orders, membershipInvoicesForMix] = await Promise.all([
      pmIncludeOrders ? findFinanceOrders(where, ['paid']) : Promise.resolve([]),
      pmIncludeMembership ? findMembershipInvoices(pmMembershipWhere) : Promise.resolve([]),
    ]);

    // Widen `provider` + `method` to string so synthetic membership keys (subscription,
    // storekit) and the apple_revenuecat provider fit into the same bucket map.
    const buckets = new Map<
      string,
      {
        provider: string;
        method: string;
        revenueCents: number;
        orderCount: number;
      }
    >();

    for (const order of orders) {
      const key = `${order.provider}:${order.method}`;
      const bucket = buckets.get(key) ?? {
        provider: order.provider,
        method: order.method,
        revenueCents: 0,
        orderCount: 0,
      };

      bucket.revenueCents += getFinanceOrderRevenueCents(order);
      bucket.orderCount += 1;
      buckets.set(key, bucket);
    }

    // F8.13: fold membership invoices in. Stripe membership invoices appear as
    // `stripe:subscription`; RevenueCat invoices appear as `apple_revenuecat:storekit`.
    for (const inv of membershipInvoicesForMix) {
      const method = inv.provider === 'stripe' ? 'subscription' : 'storekit';
      const key = `${inv.provider}:${method}`;
      const bucket = buckets.get(key) ?? {
        provider: inv.provider,
        method,
        revenueCents: 0,
        orderCount: 0,
      };
      bucket.revenueCents += inv.grossAmountCents;
      bucket.orderCount += 1;
      buckets.set(key, bucket);
    }

    const items = Array.from(buckets.values());
    const totalRevenue = items.reduce((sum, item) => sum + item.revenueCents, 0);

    return {
      items: items.map((item) => ({
        ...item,
        percentage:
          totalRevenue > 0 ? Math.round((item.revenueCents / totalRevenue) * 10000) / 100 : 0,
      })),
    };
  });

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

  app.get('/finance/by-product', async (request) => {
    const where = buildWhere(request.query);
    const orders = await findFinanceOrders(where, ['paid']);

    const productOrderIds = orders.filter((o) => hasProductItems(o)).map((o) => o.id);

    if (productOrderIds.length === 0) return { items: [] };

    const productItems = await prisma.orderItem.findMany({
      where: { orderId: { in: productOrderIds }, kind: 'product' },
      select: {
        orderId: true,
        quantity: true,
        subtotalCents: true,
        variant: {
          select: {
            product: { select: { id: true, title: true } },
          },
        },
      },
    });

    const buckets = new Map<
      string,
      {
        productId: string;
        productTitle: string;
        quantitySold: number;
        revenueCents: number;
        orderIds: Set<string>;
      }
    >();

    for (const item of productItems) {
      if (!item.variant?.product) continue;
      const { id: productId, title: productTitle } = item.variant.product;
      const bucket = buckets.get(productId) ?? {
        productId,
        productTitle,
        quantitySold: 0,
        revenueCents: 0,
        orderIds: new Set<string>(),
      };
      bucket.orderIds.add(item.orderId);
      bucket.quantitySold += item.quantity;
      bucket.revenueCents += item.subtotalCents;
      buckets.set(productId, bucket);
    }

    const items = Array.from(buckets.values())
      .map(({ orderIds, ...rest }) => ({ ...rest, orderCount: orderIds.size }))
      .sort((a, b) => b.revenueCents - a.revenueCents);

    return { items };
  });

  app.get('/finance/export', async (request, reply) => {
    const where = buildWhere(request.query);

    const orders = await prisma.order.findMany({
      where,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        method: true,
        provider: true,
        status: true,
        paidAt: true,
        createdAt: true,
        quantity: true,
        kind: true,
        event: { select: { id: true, title: true, city: true, stateCode: true } },
      },
      orderBy: { paidAt: 'desc' },
    });

    const exportOrderIds = orders.map((o) => o.id);
    const productRows =
      exportOrderIds.length > 0
        ? await prisma.$queryRaw<
            Array<{ orderId: string; productTitles: string; productIds: string }>
          >(Prisma.sql`
        SELECT
          oi."orderId",
          STRING_AGG(DISTINCT p."title", '; ' ORDER BY p."title") AS "productTitles",
          STRING_AGG(DISTINCT p."id", ';' ORDER BY p."id") AS "productIds"
        FROM "OrderItem" oi
        JOIN "Variant" v ON oi."variantId" = v."id"
        JOIN "Product" p ON v."productId" = p."id"
        WHERE oi."orderId" IN (${Prisma.join(exportOrderIds)})
          AND oi."kind" = 'product'::"OrderItemKind"
          AND oi."variantId" IS NOT NULL
        GROUP BY oi."orderId"
      `)
        : ([] as Array<{ orderId: string; productTitles: string; productIds: string }>);
    const productsByOrderId = new Map<string, { productTitles: string; productIds: string }>(
      productRows.map((r) => [
        r.orderId,
        {
          productTitles: r.productTitles,
          productIds: r.productIds,
        },
      ]),
    );

    const buckets = new Map<string, FinanceExportBucket>();
    for (const order of orders) {
      const productSummary = productsByOrderId.get(order.id);
      const bucketBase = {
        eventId: order.event?.id ?? '',
        eventTitle: order.event?.title ?? '',
        city: order.event?.city ?? '',
        stateCode: order.event?.stateCode ?? '',
        currency: order.currency,
        method: order.method,
        provider: order.provider,
        status: order.status,
        kind: order.kind,
        productSignature: productSummary?.productIds ?? '',
        productOrCollection: productSummary?.productTitles ?? '',
      };
      const bucketKey = buildFinanceExportBucketKey(bucketBase);
      const activityAt = order.paidAt ?? order.createdAt;
      const current = buckets.get(bucketKey) ?? {
        ...bucketBase,
        orderCount: 0,
        totalAmountCents: 0,
        totalQuantity: 0,
        firstOrderAt: activityAt,
        lastOrderAt: activityAt,
      };

      current.orderCount += 1;
      current.totalAmountCents += order.amountCents;
      current.totalQuantity += order.quantity;
      if (activityAt < current.firstOrderAt) current.firstOrderAt = activityAt;
      if (activityAt > current.lastOrderAt) current.lastOrderAt = activityAt;
      buckets.set(bucketKey, current);
    }

    const aggregatedRows = Array.from(buckets.values())
      .filter((bucket) => bucket.orderCount >= MIN_FINANCE_EXPORT_COHORT_SIZE)
      .sort((a, b) => {
        if (b.totalAmountCents !== a.totalAmountCents)
          return b.totalAmountCents - a.totalAmountCents;
        return a.eventTitle.localeCompare(b.eventTitle);
      });
    const suppressedOrderGroups = buckets.size - aggregatedRows.length;

    // F8.14 — Membership invoice rows. Bucket by (cadence, tier, provider) and
    // suppress cohorts where DISTINCT MEMBER count < MIN_FINANCE_EXPORT_COHORT_SIZE.
    // K-anonymity is about distinguishability of individuals — a single member
    // with 5 invoices does NOT defeat the threshold.
    //
    // The export-side provider filter (exportQuery.provider) is forwarded to the
    // membership invoice query so /finance/export?provider=stripe excludes
    // RevenueCat memberships, mirroring the order-side behavior.
    const exportQuery = adminFinanceQuerySchema.parse(request.query);
    const membershipInvoiceWhere: MembershipInvoiceWhereInput = { status: 'paid' };
    if (exportQuery.from)
      membershipInvoiceWhere.paidAtFrom = new Date(`${exportQuery.from}T00:00:00.000Z`);
    if (exportQuery.to)
      membershipInvoiceWhere.paidAtTo = new Date(`${exportQuery.to}T23:59:59.999Z`);
    // The order-side provider enum is `stripe | abacatepay`; membership-side is
    // `stripe | apple_revenuecat`. Only `stripe` overlaps. When the caller
    // filters by `stripe`, scope memberships to stripe too. `abacatepay` is
    // already excluded by `shouldIncludeMembership` above.
    if (exportQuery.provider === 'stripe') {
      membershipInvoiceWhere.provider = 'stripe';
    }
    const membershipInvoices = shouldIncludeMembership(exportQuery)
      ? await findMembershipInvoices(membershipInvoiceWhere)
      : [];

    type MembershipExportBucket = {
      cadence: PremiumCadence;
      tier: GaragePremiumTier;
      provider: PremiumProvider;
      memberIds: Set<string>;
      invoiceCount: number;
      totalAmountCents: number;
      firstPaidAt: Date;
      lastPaidAt: Date;
    };

    const membershipBuckets = new Map<string, MembershipExportBucket>();
    for (const inv of membershipInvoices) {
      const m = inv.membership;
      // Bucket key DROPS membership lifecycle status — only invoice status
      // (already filtered to 'paid') goes into the CSV row's status column.
      // Lifecycle status (active / past_due / cancel_scheduled) belongs in the
      // memberships list endpoint, not the revenue export.
      const bucketKey = `${m.cadence}|${m.tier}|${inv.provider}`;
      const current = membershipBuckets.get(bucketKey) ?? {
        cadence: m.cadence,
        tier: m.tier,
        provider: inv.provider,
        memberIds: new Set<string>(),
        invoiceCount: 0,
        totalAmountCents: 0,
        firstPaidAt: inv.paidAt,
        lastPaidAt: inv.paidAt,
      };
      current.memberIds.add(inv.membershipId);
      current.invoiceCount += 1;
      current.totalAmountCents += inv.grossAmountCents;
      if (inv.paidAt < current.firstPaidAt) current.firstPaidAt = inv.paidAt;
      if (inv.paidAt > current.lastPaidAt) current.lastPaidAt = inv.paidAt;
      membershipBuckets.set(bucketKey, current);
    }

    const aggregatedMembershipRows = Array.from(membershipBuckets.values()).filter(
      (b) => b.memberIds.size >= MIN_FINANCE_EXPORT_COHORT_SIZE,
    );
    const suppressedMembershipGroups = membershipBuckets.size - aggregatedMembershipRows.length;
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

    const membershipRowsCsv = aggregatedMembershipRows.map((m) => {
      const cols = [
        '',
        '',
        '',
        'BRL',
        '',
        m.provider,
        // Status column: invoice payment status. Order rows emit OrderStatus
        // (paid / refunded); membership rows emit the same vocabulary —
        // membershipInvoiceWhere filters to status='paid' so this is a constant.
        // (Membership lifecycle status lives on /finance/memberships, not here.)
        'paid',
        'membership',
        '',
        m.invoiceCount,
        m.totalAmountCents,
        m.invoiceCount,
        m.firstPaidAt.toISOString(),
        m.lastPaidAt.toISOString(),
        m.cadence,
        'true',
        '',
      ];
      return cols.join(',');
    });

    const csv = [header, ...orderRows, ...membershipRowsCsv].join('\n');
    void reply.header('content-type', 'text/csv; charset=utf-8');
    void reply.header('content-disposition', 'attachment; filename="finance-export.csv"');
    void reply.header('x-jdm-k-anonymity-min', String(MIN_FINANCE_EXPORT_COHORT_SIZE));
    void reply.header('x-jdm-k-anonymity-suppressed-groups', String(suppressedGroups));
    return csv;
  });
};

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
