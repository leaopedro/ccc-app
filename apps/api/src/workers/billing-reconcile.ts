import { prisma } from '@ccc/db';
import type { PremiumMembership } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import { applyMembershipEvent } from '../services/billing/apply-membership-event.js';
import { openMonthlyBoxIfEligible } from '../services/box/open.js';
import type { BillingEvent } from '../services/billing/types.js';
import type { RevenueCatClient } from '../services/revenuecat/client.js';
import type { StripeClient } from '../services/stripe/index.js';

export type ReconcileTickDeps = {
  stripe: StripeClient;
  rc: RevenueCatClient;
  alertDepth: number;
  flagEnabled?: boolean;
  now?: Date;
  log?: FastifyBaseLogger;
};

const STALE_STATUSES: Array<'active' | 'past_due' | 'cancel_scheduled'> = [
  'active',
  'past_due',
  'cancel_scheduled',
];
const QUERY_LIMIT = 200;
const STRIPE_EXPIRED_STATUSES = new Set(['canceled', 'incomplete_expired', 'unpaid']);
const RC_PREMIUM_ENTITLEMENT_KEY = 'premium_gold';
// Synthetic invoice period used for reconcile-synthesised renewals. Real
// invoice metadata is unknown from a single Subscription retrieve; the prior
// period is approximated as (newPeriodEnd - 30d) so the invoice row records
// a sane bracket. `apply-membership-event.handleRenewed` carries the canonical
// period on the membership row regardless.
const APPROX_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Per-row reconciliation helpers
// ---------------------------------------------------------------------------

/**
 * Reconcile one Stripe-backed membership. Returns the BillingEvent to apply,
 * or null if no action needed (in-flight dunning, status we do not handle).
 *
 * Stripe SDK 2026-04-22 dahlia exposes `current_period_{start,end}` on
 * `SubscriptionItem`, not on `Subscription` (see Subscriptions.d.ts +
 * SubscriptionItems.d.ts in the SDK). We read the first item's bracket.
 */
const reconcileStripeRow = async (
  row: PremiumMembership,
  stripe: StripeClient,
  now: Date,
): Promise<BillingEvent | null> => {
  const sub = await stripe.retrieveSubscription(row.providerSubRef);

  const item = sub.items.data[0];
  const itemPeriodEnd =
    item && typeof item.current_period_end === 'number' ? item.current_period_end : null;

  if (
    sub.status === 'active' &&
    itemPeriodEnd !== null &&
    itemPeriodEnd > Math.floor(now.getTime() / 1000)
  ) {
    // Webhook was lost — synthesise a renewal BillingEvent. Pricing is
    // re-snapshotted from Stripe.Price.metadata (canon §F8.1 — devFee from
    // provider, never from env). The reconcile-synthesised invoice ref is
    // stable across re-runs of the sweep so a second tick is idempotent
    // via the @@unique([provider, providerInvoiceRef]) + handleRenewed's
    // SAVEPOINT P2002 swallow.
    // `item` is non-null inside this branch — the guard above requires
    // `itemPeriodEnd !== null`, which only holds when `item` exists.
    const newPeriodEnd = new Date(itemPeriodEnd * 1000);
    const price = item!.price;
    // Use Number.isFinite to accept a valid `0` metadata value (e.g. a free
    // promotional Stripe price, or an Apple/RC-imported price whose dev fee
    // is genuinely 0). `|| row.devFeePercent` would treat 0 as falsy and
    // silently fall back to the prior snapshot, masking provider intent.
    const parsedBase = price
      ? parseInt(String(price.metadata?.baseAmountCents ?? ''), 10)
      : Number.NaN;
    const baseAmountCents = Number.isFinite(parsedBase) ? parsedBase : row.baseAmountCents;
    const parsedFee = price
      ? parseInt(String(price.metadata?.devFeePercent ?? ''), 10)
      : Number.NaN;
    const devFeePercent = Number.isFinite(parsedFee) ? parsedFee : row.devFeePercent;
    const devFeeAmountCents = Math.round((baseAmountCents * devFeePercent) / 100);
    const grossAmountCents = baseAmountCents + devFeeAmountCents;

    const periodStart = new Date(newPeriodEnd.getTime() - APPROX_PERIOD_MS);

    const renewalEvent: BillingEvent = {
      kind: 'subscription.renewed',
      provider: 'stripe',
      providerSubRef: row.providerSubRef,
      currentPeriodStart: periodStart,
      currentPeriodEnd: newPeriodEnd,
      pricing: {
        baseAmountCents,
        devFeePercent,
        devFeeAmountCents,
        grossAmountCents,
        currency: row.currency,
      },
      invoice: {
        providerInvoiceRef: `reconcile:${row.providerSubRef}:${itemPeriodEnd}`,
        periodStart,
        periodEnd: newPeriodEnd,
        paidAt: now,
      },
      // Genuinely empty, not a placeholder: this event is synthesised from a
      // single Stripe Subscription retrieve, which carries pricing straight
      // from the provider. There is no multi-line invoice here for a route
      // to decompose, so `lines` has nothing to carry.
      lines: [],
    };
    return renewalEvent;
  }

  if (STRIPE_EXPIRED_STATUSES.has(sub.status)) {
    const expiredEvent: BillingEvent = {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: row.providerSubRef,
      cancelledAt: now,
    };
    return expiredEvent;
  }

  return null; // in-flight (e.g. incomplete, paused, trialing) — no action this tick
};

/**
 * Reconcile one RC-backed membership. Returns the BillingEvent to apply, or
 * null if no action needed. RC `expiresDate: null` denotes a non-expiring
 * (lifetime) entitlement.
 */
const reconcileRcRow = async (
  row: PremiumMembership,
  rc: RevenueCatClient,
  now: Date,
): Promise<BillingEvent | null> => {
  const subscriber = await rc.getSubscriber(row.providerCustomerRef);

  const entitlement = subscriber.entitlements[RC_PREMIUM_ENTITLEMENT_KEY];
  if (!entitlement) {
    return {
      kind: 'subscription.expired',
      provider: 'apple_revenuecat',
      providerSubRef: row.providerSubRef,
      cancelledAt: now,
    };
  }

  if (entitlement.expiresDate === null) {
    // Lifetime entitlement — entitlement still valid, no period to advance.
    return null;
  }

  const expiresAt = new Date(entitlement.expiresDate);
  if (expiresAt > now) {
    // Entitlement still valid — webhook was lost; synthesise renewal.
    // Apple/RC path: devFeePercent = 0 (canon §F8.1 — Apple takes the cut
    // upstream, so the platform does not double-charge a dev fee).
    const periodStart = new Date(expiresAt.getTime() - APPROX_PERIOD_MS);

    return {
      kind: 'subscription.renewed',
      provider: 'apple_revenuecat',
      providerSubRef: row.providerSubRef,
      currentPeriodStart: periodStart,
      currentPeriodEnd: expiresAt,
      pricing: {
        baseAmountCents: row.baseAmountCents,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        grossAmountCents: row.grossAmountCents,
        currency: row.currency,
      },
      invoice: {
        providerInvoiceRef: `reconcile:${row.providerSubRef}:${expiresAt.getTime()}`,
        periodStart,
        periodEnd: expiresAt,
        paidAt: now,
      },
      // Genuinely empty, not a placeholder: RC's getSubscriber reads pricing
      // straight from the provider (row snapshot below), never through a
      // multi-line invoice a route would need to decompose.
      lines: [],
    };
  }

  // expiresDate in the past — entitlement expired.
  return {
    kind: 'subscription.expired',
    provider: 'apple_revenuecat',
    providerSubRef: row.providerSubRef,
    cancelledAt: now,
  };
};

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

/**
 * One reconciliation tick (canon §F8.12, spec §6).
 *
 * Detects drift between provider-authoritative subscription state and the
 * local DB snapshot, then either replays a missed renewal or expires the
 * membership and clears the Garage snapshot.
 *
 * Query: `status IN ('active','past_due','cancel_scheduled') AND
 * currentPeriodEnd < now` LIMIT 200, ordered ascending by `currentPeriodEnd`
 * so the oldest drift drains first.
 *
 * Per row:
 *   1. Call provider (Stripe `subscriptions.retrieve` or RC `getSubscriber`).
 *   2. Synthesise a `BillingEvent` of kind `subscription.renewed` or
 *      `subscription.expired` (or skip — in-flight dunning, lifetime RC).
 *   3. Open a fresh `prisma.$transaction`, acquire `SELECT FOR UPDATE` on the
 *      Garage row (canon §F8.5), then call `applyMembershipEvent(tx, evt)`.
 *      This preserves the atomicity contract (§F8.4) untouched.
 *
 * Reconcile-synthesised invoices use `reconcile:<subRef>:<periodEndKey>` as
 * `providerInvoiceRef`. This is stable across re-runs, so the
 * `@@unique([provider, providerInvoiceRef])` constraint + handleRenewed's
 * SAVEPOINT P2002 swallow (apply-membership-event.ts:233) make subsequent
 * ticks idempotent.
 *
 * Errors on a single row never crash the tick — the row's error is logged
 * and the loop continues to the next row.
 *
 * Feature-flag gated: `flagEnabled: false` short-circuits with zero DB reads
 * (canon §F8.11).
 */
export const runReconcileTick = async (deps: ReconcileTickDeps): Promise<void> => {
  const flagEnabled = deps.flagEnabled ?? true;
  if (!flagEnabled) return;

  const now = deps.now ?? new Date();
  const log = deps.log;

  const staleRows = await prisma.premiumMembership.findMany({
    where: {
      status: { in: STALE_STATUSES },
      currentPeriodEnd: { lt: now },
    },
    orderBy: { currentPeriodEnd: 'asc' },
    take: QUERY_LIMIT,
  });

  if (staleRows.length >= deps.alertDepth) {
    log?.warn(
      {
        kind: 'reconcile.queue_depth_alert',
        depth: staleRows.length,
        alertDepth: deps.alertDepth,
      },
      'billing-reconcile: stale membership queue depth at or above alert threshold',
    );
  }

  for (const row of staleRows) {
    try {
      let evt: BillingEvent | null = null;

      if (row.provider === 'stripe') {
        evt = await reconcileStripeRow(row, deps.stripe, now);
      } else if (row.provider === 'apple_revenuecat') {
        evt = await reconcileRcRow(row, deps.rc, now);
      }

      if (!evt) {
        log?.info(
          { kind: 'reconcile.skipped', provider: row.provider, membershipId: row.id },
          'billing-reconcile: row in-flight or lifetime, skipping',
        );
        continue;
      }

      // Canon §F8.5: caller must hold `SELECT FOR UPDATE` on the Garage row
      // before calling applyMembershipEvent. We acquire it inside the same
      // $transaction so the lock is held end-to-end through the membership
      // upsert + invoice insert + snapshot update.
      const synthesised = evt;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${row.garageId} FOR UPDATE`;
        await applyMembershipEvent(tx, synthesised);
      });
      // Box Builder Fase 2: open the current-cycle box post-commit (best-effort).
      await openMonthlyBoxIfEligible(prisma, synthesised);

      const logKind =
        evt.kind === 'subscription.expired' ? 'reconcile.expired' : 'reconcile.recovered';
      log?.info(
        { kind: logKind, provider: row.provider, membershipId: row.id, eventKind: evt.kind },
        `billing-reconcile: ${logKind}`,
      );
    } catch (err) {
      log?.error(
        { err, membershipId: row.id, provider: row.provider },
        'billing-reconcile: failed to reconcile row, continuing to next',
      );
      // Non-fatal: continue processing remaining rows.
    }
  }
};

export const startReconcileWorker = (deps: {
  stripe: StripeClient;
  rc: RevenueCatClient;
  env: Env;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('0 * * * *', () => {
    void runReconcileTick({
      stripe: deps.stripe,
      rc: deps.rc,
      alertDepth: deps.env.RECONCILE_ALERT_DEPTH,
      flagEnabled: deps.env.GROWTH_PREMIUM_BILLING_ENABLED,
      log: deps.log,
    }).catch((err: unknown) => {
      deps.log.error({ err }, 'billing-reconcile tick failed');
    });
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
