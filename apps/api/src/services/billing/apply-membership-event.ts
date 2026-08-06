import type { Prisma, PremiumProvider, PrismaClient } from '@prisma/client';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';
import { awardXp } from '../garage/xp-awarder.js';

import type { BillingEvent } from './types.js';

/**
 * Writes the DB side-effects of a normalized BillingEvent inside the
 * caller's transaction. The caller MUST have already issued:
 *
 *   await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`
 *
 * before calling this function (canon §F8.5). This serializes concurrent
 * webhooks for the same garage.
 *
 * canon §F8.4 — Membership upsert + Invoice insert + Garage snapshot +
 *   awardXp all happen in the same tx. Ticket backfill is post-commit
 *   (chunk F8.06).
 */
export const applyMembershipEvent = async (
  tx: Prisma.TransactionClient,
  evt: BillingEvent,
): Promise<void> => {
  switch (evt.kind) {
    case 'subscription.activated':
      return handleActivated(tx, evt);
    case 'subscription.renewed':
      return handleRenewed(tx, evt);
    case 'subscription.cancelled':
      return handleCancelled(tx, evt);
    case 'subscription.uncancelled':
      return handleUncancelled(tx, evt);
    case 'subscription.expired':
      return handleExpired(tx, evt);
    case 'subscription.past_due':
      return handlePastDue(tx, evt);
    case 'subscription.tier_changed':
      return handleTierChanged(tx, evt);
    case 'subscription.paused':
      return handlePaused(tx, evt);
    case 'subscription.resumed':
      return handleResumed(tx, evt);
    default: {
      // Exhaustive check — TypeScript will error if BillingEvent grows a new kind
      // without a corresponding case.
      const _: never = evt;
      throw new Error(`applyMembershipEvent: unhandled kind ${(_ as BillingEvent).kind}`);
    }
  }
};

// ---------------------------------------------------------------------------
// subscription.activated
// ---------------------------------------------------------------------------

async function handleActivated(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.activated' }>,
): Promise<void> {
  const {
    garageId,
    provider,
    providerCustomerRef,
    providerSubRef,
    tier,
    cadence,
    currentPeriodStart,
    currentPeriodEnd,
    pricing,
    invoice,
    addons,
  } = evt;

  // Fix round 1, finding 5: `evt.addonsAmountCents` is the route's raw sum of
  // Stripe invoice line amounts (proration/discount included) — a one-off
  // number that means nothing added to baseAmountCents, which is the catalog
  // LIST price. Every other writer of this column (reconcileMembershipAddonsAmount
  // below, and the attach/detach routes in me-premium-addons.ts) sums the
  // catalog's monthlyDeltaCents across active add-ons instead. Match them here
  // so a later customer.subscription.updated reconciliation doesn't silently
  // "correct" a value we just wrote.
  const addonsAmountCents = addons.reduce((sum, a) => sum + a.monthlyDeltaCents, 0);

  // Stripe webhooks are NOT order-guaranteed: a delayed activation can arrive
  // AFTER a later renewal updated currentPeriodEnd forward. Read the existing
  // row first and branch so the canonical membership row never regresses on a
  // stale replay. The caller's SELECT FOR UPDATE on Garage (canon §F8.5) makes
  // the findUnique→write window race-free for this garage.
  const existing = await tx.premiumMembership.findUnique({
    where: { provider_providerSubRef: { provider, providerSubRef } },
  });

  let membership;
  let didAdvancePeriod = false;
  if (!existing) {
    membership = await tx.premiumMembership.create({
      data: {
        garageId,
        provider,
        providerCustomerRef,
        providerSubRef,
        tier,
        cadence,
        status: 'active',
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        baseAmountCents: pricing.baseAmountCents,
        devFeePercent: pricing.devFeePercent,
        devFeeAmountCents: pricing.devFeeAmountCents,
        grossAmountCents: pricing.grossAmountCents,
        currency: pricing.currency,
        addonsAmountCents,
      },
    });
    didAdvancePeriod = true;
  } else if (currentPeriodEnd > existing.currentPeriodEnd) {
    // Forward event: refresh period + pricing + status + cancel flags.
    membership = await tx.premiumMembership.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        baseAmountCents: pricing.baseAmountCents,
        devFeePercent: pricing.devFeePercent,
        devFeeAmountCents: pricing.devFeeAmountCents,
        grossAmountCents: pricing.grossAmountCents,
        currency: pricing.currency,
        addonsAmountCents,
      },
    });
    didAdvancePeriod = true;
  } else {
    // Stale (out-of-order) activation: do NOT regress period or pricing.
    // Still refresh re-activation hygiene fields so a prior cancel/expire
    // is cleared.
    membership = await tx.premiumMembership.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      },
    });
  }

  // Insert invoice — idempotent on (provider, providerInvoiceRef).
  // P2002 = replay; silently skip (the invoice already landed).
  // SAVEPOINT wrap mirrors xp-awarder pattern: Prisma's $transaction does
  // NOT auto-savepoint per statement, so a P2002 inside the create poisons
  // the parent tx (Postgres state 25P02). ROLLBACK TO SAVEPOINT clears it
  // before the parent continues to the snapshot + XP writes.
  await tx.$executeRawUnsafe('SAVEPOINT invoice_insert');
  try {
    await tx.premiumMembershipInvoice.create({
      data: {
        membershipId: membership.id,
        provider,
        providerInvoiceRef: invoice.providerInvoiceRef,
        providerTransactionRef: invoice.providerTransactionRef ?? null,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        baseAmountCents: pricing.baseAmountCents,
        devFeePercent: pricing.devFeePercent,
        devFeeAmountCents: pricing.devFeeAmountCents,
        grossAmountCents: pricing.grossAmountCents,
        currency: pricing.currency,
        paidAt: invoice.paidAt,
        status: 'paid',
      },
    });
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT invoice_insert');
  } catch (e) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invoice_insert');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT invoice_insert');
    if (!isUniqueConstraintError(e)) throw e;
    // Replay: invoice already exists; continue to snapshot + XP.
  }

  // Add-ons ride the SAME transaction as the activation — no partial state and
  // no external call inside the tx. The route resolved these against the
  // catalog; price/quota here are snapshots.
  //
  // Fix round 1, finding 2: gated on didAdvancePeriod, exactly like the Garage
  // snapshot below — same rationale. A stale (out-of-order) activation replay
  // carries an older snapshot of the subscription's add-on lines by
  // construction; writing add-on rows from it could resurrect a module the
  // member has since cancelled (and Stripe has since removed the
  // subscription item for), pointing providerItemRef at a deleted item and
  // handing out quota nobody is paying for. Skipping it here mirrors the
  // "do not regress" treatment pricing/period already get in this branch, and
  // it also fixes finding 3: since this only runs on the create/forward-advance
  // branches, `membership.currentPeriodStart/currentPeriodEnd` below are always
  // this event's period, never a stale one.
  //
  // Upsert, not create: @@unique([membershipId, addonKey]) has no status filter,
  // so re-subscribing a module that was previously cancelled would otherwise
  // violate the constraint.
  //
  // Fix round 1, finding 4: no SAVEPOINT here, unlike the invoice insert above.
  // The invoice insert needs one because a P2002 there is an EXPECTED, routine
  // replay outcome that must be swallowed so the rest of the tx (snapshot + XP)
  // can still run. There is no equivalent "expected duplicate" case for the
  // add-on upsert — if it ever throws (whatever the cause), letting it abort
  // the whole transaction is the correct, safe outcome: nothing has committed,
  // and Stripe's automatic retry re-runs handleActivated from a clean read.
  // Two claims this comment does NOT make, on purpose: (1) the caller's Garage
  // `FOR UPDATE` lock does NOT serialize this against a member's own
  // attach/detach — `me-premium-addons.ts` takes no Garage lock at all, so it
  // only protects webhook-vs-webhook, never webhook-vs-attach/detach; (2)
  // whether Prisma compiles this compound-unique upsert to a single atomic
  // `INSERT ... ON CONFLICT DO UPDATE` on Postgres, or falls back to
  // read-then-write, was not verified here. Either way the transaction-abort
  // fallback above makes a savepoint unnecessary regardless of which one it is.
  if (didAdvancePeriod) {
    for (const addon of addons) {
      const addonRow = await tx.premiumMembershipAddon.upsert({
        where: {
          membershipId_addonKey: { membershipId: membership.id, addonKey: addon.addonKey },
        },
        create: {
          membershipId: membership.id,
          addonKey: addon.addonKey,
          status: 'active',
          providerItemRef: addon.providerItemRef,
          monthlyDeltaCents: addon.monthlyDeltaCents,
          quotaPerCycle: addon.quotaPerCycle,
          quotaUnit: addon.quotaUnit,
          currency: addon.currency,
        },
        update: {
          status: 'active',
          providerItemRef: addon.providerItemRef,
          monthlyDeltaCents: addon.monthlyDeltaCents,
          quotaPerCycle: addon.quotaPerCycle,
          quotaUnit: addon.quotaUnit,
          currency: addon.currency,
        },
      });

      // One usage row per cycle. Upsert keeps an activation replay idempotent
      // without clobbering quotaUsed. Fix round 1, finding 3: cycle bounds
      // come from the membership row itself, not the event locals — identical
      // to evt.currentPeriodStart/End on both branches that reach this block,
      // but anchored to the row that is the actual source of truth.
      await tx.premiumAddonUsage.upsert({
        where: {
          membershipAddonId_cycleStart: {
            membershipAddonId: addonRow.id,
            cycleStart: membership.currentPeriodStart,
          },
        },
        create: {
          membershipAddonId: addonRow.id,
          cycleStart: membership.currentPeriodStart,
          cycleEnd: membership.currentPeriodEnd,
          quotaTotal: addon.quotaPerCycle,
        },
        update: {},
      });
    }
  }

  // Garage snapshot — max() rule (canon §F8.3).
  // Only write the snapshot when the membership row advanced. A stale
  // activation replay must not overwrite premiumTier with an outdated tier
  // (the row could have been updated by a later tier_changed event), and
  // the max() rule on premiumUntil is already guaranteed by the create/
  // advance branches above. Admin-grant may have extended premiumUntil
  // beyond the new sub's currentPeriodEnd; max() preserves it.
  if (didAdvancePeriod) {
    const garage = await tx.garage.findUniqueOrThrow({ where: { id: garageId } });
    const existingUntil = garage.premiumUntil ?? new Date(0);
    const newUntil = currentPeriodEnd > existingUntil ? currentPeriodEnd : existingUntil;

    await tx.garage.update({
      where: { id: garageId },
      data: { premiumTier: tier, premiumUntil: newUntil },
    });
  }

  // XP award — exactly one call per activation tx (canon §F8.6).
  // sourceRef 'garage:<garageId>' is the shared idempotency key across
  // admin grant and self-serve webhook (canon §F8.2). The XpEvent
  // @@unique([garageId, reason, sourceRef]) makes this one-shot-ever
  // per garage. P2002 is caught silently inside awardXp; any other error
  // rethrows. NO try/catch here — canon §5 mandates callers do not wrap.
  await awardXp(tx, garageId, 'premium_activation', {
    sourceRef: `garage:${garageId}`,
    delta: 200,
  });
}

// ---------------------------------------------------------------------------
// subscription.renewed
// ---------------------------------------------------------------------------

async function handleRenewed(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.renewed' }>,
): Promise<void> {
  const { provider, providerSubRef, currentPeriodStart, currentPeriodEnd, pricing, invoice } = evt;

  // Read existing row so a stale (out-of-order) renewal cannot push the
  // canonical membership.currentPeriodEnd backward.
  const existing = await tx.premiumMembership.findUniqueOrThrow({
    where: { provider_providerSubRef: { provider, providerSubRef } },
  });

  const isForward = currentPeriodEnd > existing.currentPeriodEnd;
  const membership = isForward
    ? await tx.premiumMembership.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
          baseAmountCents: pricing.baseAmountCents,
          devFeePercent: pricing.devFeePercent,
          devFeeAmountCents: pricing.devFeeAmountCents,
          grossAmountCents: pricing.grossAmountCents,
          currency: pricing.currency,
        },
      })
    : existing;

  // SAVEPOINT wrap (same rationale as handleActivated): P2002 inside the
  // create otherwise poisons the parent tx with Postgres state 25P02.
  await tx.$executeRawUnsafe('SAVEPOINT invoice_insert');
  try {
    await tx.premiumMembershipInvoice.create({
      data: {
        membershipId: membership.id,
        provider,
        providerInvoiceRef: invoice.providerInvoiceRef,
        providerTransactionRef: invoice.providerTransactionRef ?? null,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        baseAmountCents: pricing.baseAmountCents,
        devFeePercent: pricing.devFeePercent,
        devFeeAmountCents: pricing.devFeeAmountCents,
        grossAmountCents: pricing.grossAmountCents,
        currency: pricing.currency,
        paidAt: invoice.paidAt,
        status: 'paid',
      },
    });
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT invoice_insert');
  } catch (e) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invoice_insert');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT invoice_insert');
    if (!isUniqueConstraintError(e)) throw e;
  }

  // Garage snapshot — max() rule (canon §F8.3). No XP on renewal.
  // Skip on stale renewal: existing garage.premiumUntil is already >=
  // membership.currentPeriodEnd which is >= the stale event's
  // currentPeriodEnd, so the write would be a no-op.
  if (isForward) {
    const garage = await tx.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
    const existingUntil = garage.premiumUntil ?? new Date(0);
    const newUntil = currentPeriodEnd > existingUntil ? currentPeriodEnd : existingUntil;

    await tx.garage.update({
      where: { id: membership.garageId },
      data: { premiumUntil: newUntil },
    });
  }
}

// ---------------------------------------------------------------------------
// subscription.cancelled (cancel_at_period_end=true; entitlement still valid)
// ---------------------------------------------------------------------------

async function handleCancelled(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.cancelled' }>,
): Promise<void> {
  const { provider, providerSubRef, cancelledAt } = evt;

  // Set flag + cancelledAt. No snapshot change — user remains active
  // through currentPeriodEnd (spec §3.5).
  await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'cancel_scheduled', cancelAtPeriodEnd: true, cancelledAt },
  });
}

// ---------------------------------------------------------------------------
// subscription.uncancelled (user reversed cancel before period end)
// ---------------------------------------------------------------------------

async function handleUncancelled(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.uncancelled' }>,
): Promise<void> {
  const { provider, providerSubRef } = evt;

  const membership = await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'active', cancelAtPeriodEnd: false, cancelledAt: null },
  });

  // Snapshot refresh — uncancelled is treated as a re-activation of the
  // existing period. max() rule (canon §F8.3) still applies.
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
  const existingUntil = garage.premiumUntil ?? new Date(0);
  const newUntil =
    membership.currentPeriodEnd > existingUntil ? membership.currentPeriodEnd : existingUntil;

  await tx.garage.update({
    where: { id: membership.garageId },
    data: { premiumTier: membership.tier, premiumUntil: newUntil },
  });
}

// ---------------------------------------------------------------------------
// subscription.expired
// ---------------------------------------------------------------------------

async function handleExpired(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.expired' }>,
): Promise<void> {
  const { provider, providerSubRef, cancelledAt } = evt;

  const membership = await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'expired', cancelledAt: cancelledAt ?? null },
  });

  const garageId = membership.garageId;
  const now = new Date();

  // Conditional snapshot clear (spec §3.5):
  //   - premiumUntil must be <= now (no future-dated admin extension)
  //   - no other live membership row for this garage
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: garageId } });

  const hasActiveLiveMembership = await tx.premiumMembership.findFirst({
    where: {
      garageId,
      status: { in: ['active', 'past_due', 'cancel_scheduled'] },
      id: { not: membership.id },
    },
  });

  const premiumUntilExpired = !garage.premiumUntil || garage.premiumUntil <= now;

  if (!hasActiveLiveMembership && premiumUntilExpired) {
    await tx.garage.update({
      where: { id: garageId },
      data: { premiumTier: null, premiumUntil: null },
    });
  }
  // If admin-granted premiumUntil is in the future, leave snapshot alone —
  // the admin grant extends beyond the sub period. max() rule protects it.
}

// ---------------------------------------------------------------------------
// subscription.past_due
// ---------------------------------------------------------------------------

async function handlePastDue(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.past_due' }>,
): Promise<void> {
  const { provider, providerSubRef } = evt;

  // Status flip only. No snapshot change — Stripe's automatic dunning
  // retries ~3× over 7d. Reconciliation sweep (chunk F8.12) handles
  // eventual snapshot expiry if dunning fails (spec §3.5).
  await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'past_due' },
  });
}

// ---------------------------------------------------------------------------
// subscription.tier_changed (cadence swap monthly↔annual in v1)
// ---------------------------------------------------------------------------

async function handleTierChanged(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.tier_changed' }>,
): Promise<void> {
  const { provider, providerSubRef, tier, cadence, pricing } = evt;

  const membership = await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: {
      tier,
      cadence,
      baseAmountCents: pricing.baseAmountCents,
      devFeePercent: pricing.devFeePercent,
      devFeeAmountCents: pricing.devFeeAmountCents,
      grossAmountCents: pricing.grossAmountCents,
      currency: pricing.currency,
    },
  });

  // Snapshot tier refresh — max() rule on period end still applies
  // (canon §F8.3). No XP on tier change (§4.4 — premium_activation
  // is one-shot-ever per garage).
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
  const existingUntil = garage.premiumUntil ?? new Date(0);
  const newUntil =
    membership.currentPeriodEnd > existingUntil ? membership.currentPeriodEnd : existingUntil;

  await tx.garage.update({
    where: { id: membership.garageId },
    data: { premiumTier: tier, premiumUntil: newUntil },
  });
}

// ---------------------------------------------------------------------------
// subscription.paused (Stripe pause_collection)
// ---------------------------------------------------------------------------

async function handlePaused(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.paused' }>,
): Promise<void> {
  const { provider, providerSubRef } = evt;

  // Status flip only. Snapshot da Garage fica intacto de proposito: o membro
  // mantem entitlement ate premiumUntil, mesma escolha ja feita em handlePastDue.
  // Pausa suspende cobranca, nao revoga o que ja foi pago.
  await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'paused' },
  });
}

// ---------------------------------------------------------------------------
// subscription.resumed (pause_collection cleared)
// ---------------------------------------------------------------------------

async function handleResumed(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.resumed' }>,
): Promise<void> {
  const { provider, providerSubRef } = evt;

  const membership = await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'active', cancelAtPeriodEnd: false, cancelledAt: null },
  });

  // Snapshot refresh com a regra de max() (canon §F8.3), igual a
  // handleUncancelled: uma concessao manual mais distante nao pode ser encurtada.
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
  const existingUntil = garage.premiumUntil ?? new Date(0);
  const newUntil =
    membership.currentPeriodEnd > existingUntil ? membership.currentPeriodEnd : existingUntil;

  await tx.garage.update({
    where: { id: membership.garageId },
    data: { premiumTier: membership.tier, premiumUntil: newUntil },
  });
}

// ---------------------------------------------------------------------------
// applyInvoiceRefund — invoice status only (canon §F8.10)
// ---------------------------------------------------------------------------

/**
 * Flips the matching PremiumMembershipInvoice to 'refunded' or 'partial_refund'.
 * Does NOT touch PremiumMembership or Garage snapshot (canon §F8.10).
 * Entitlement persists through currentPeriodEnd. Admin force-revoke via
 * POST /users/:id/garage/premium { tier: null } is the only mid-period revoke.
 *
 * The (provider, providerInvoiceRef) tuple matches the schema's
 * @@unique([provider, providerInvoiceRef]) so the lookup hits at most one
 * row across Stripe + RevenueCat. Identical providerInvoiceRef values can
 * coexist across providers; the provider qualifier prevents a Stripe refund
 * from updating a RevenueCat invoice row (or vice versa).
 *
 * Lock contract (canon §F8.5): the caller MUST hold the garage-level
 * `SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE` before
 * invoking this function. Webhook routes (F8.04 Stripe, F8.05 RC) resolve
 * the garageId from `providerCustomerRef` / `providerSubRef` and take the
 * lock at the route layer — same serialization rule as activation/renewal.
 * The findUnique→update read-modify-write here is safe only under that lock.
 */
export const applyInvoiceRefund = async (
  tx: Prisma.TransactionClient,
  provider: PremiumProvider,
  providerInvoiceRef: string,
  refundedAmountCents: number,
): Promise<void> => {
  const invoice = await tx.premiumMembershipInvoice.findUnique({
    where: { provider_providerInvoiceRef: { provider, providerInvoiceRef } },
  });
  if (!invoice) return; // Unknown invoice; log at call site.

  const isFullRefund = refundedAmountCents >= invoice.grossAmountCents;

  await tx.premiumMembershipInvoice.update({
    where: { id: invoice.id },
    data: {
      refundedAt: new Date(),
      refundedAmountCents,
      status: isFullRefund ? 'refunded' : 'partial_refund',
    },
  });
};

// ---------------------------------------------------------------------------
// reconcileMembershipAddonsAmount — P5 additive add-ons sync
// ---------------------------------------------------------------------------

/**
 * Recompute PremiumMembership.addonsAmountCents from the active
 * PremiumMembershipAddon rows (sum of monthlyDeltaCents where status='active').
 *
 * This mirrors EXACTLY how the attach/detach routes compute the total, so the
 * membership snapshot stays consistent when a Stripe
 * `customer.subscription.updated` event lands (e.g. an add-on item was added or
 * removed out-of-band via the Billing Portal). It is deliberately independent
 * of the tier/status normalization in applyMembershipEvent — it ONLY touches
 * addonsAmountCents and never the tier, status, period, or pricing snapshot.
 *
 * No-op when the (provider, providerSubRef) membership is unknown.
 *
 * Lock contract (canon §F8.5): the caller MUST hold the garage-level
 * `SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE` inside the same
 * transaction before invoking this.
 */
export const reconcileMembershipAddonsAmount = async (
  tx: Prisma.TransactionClient,
  provider: PremiumProvider,
  providerSubRef: string,
): Promise<void> => {
  const membership = await tx.premiumMembership.findUnique({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    select: { id: true, addonsAmountCents: true },
  });
  if (!membership) return;

  const agg = await tx.premiumMembershipAddon.aggregate({
    where: { membershipId: membership.id, status: 'active' },
    _sum: { monthlyDeltaCents: true },
  });
  const addonsAmountCents = agg._sum.monthlyDeltaCents ?? 0;

  if (addonsAmountCents === membership.addonsAmountCents) return; // already in sync

  await tx.premiumMembership.update({
    where: { id: membership.id },
    data: { addonsAmountCents },
  });
};

// ---------------------------------------------------------------------------
// enqueuePremiumTicketBackfillIfActivated — F8.06 post-commit hook
// ---------------------------------------------------------------------------

/**
 * Post-commit enqueue (canon §F8.4). Callers MUST invoke this AFTER the
 * activation tx has committed, never inside it. The job is picked up by the
 * premium-ticket-backfill worker on the next tick (every minute).
 *
 * Gate: only `subscription.activated` enqueues. Renewals, cancels, expiry,
 * past_due, uncancellation, and tier changes do NOT enqueue (spec §4.3,
 * §4.4). Mid-cycle event publishes are handled by F8.07's separate
 * event-publish hook.
 *
 * Idempotency: this function ALWAYS creates a new row when called with an
 * activated event. Upstream (`SubscriptionWebhookEvent` unique on
 * `(provider, providerEventId)`) is responsible for ensuring this is called
 * at most once per Stripe/RC event. The worker itself is crash-safe — even
 * if the same job runs twice, the canon §F8.8 partial unique on Ticket
 * dedups the inserts (P2002 swallowed per row).
 */
export const enqueuePremiumTicketBackfillIfActivated = async (
  client: PrismaClient,
  evt: BillingEvent,
): Promise<void> => {
  if (evt.kind !== 'subscription.activated') return;
  await client.premiumTicketBackfillJob.create({
    data: { garageId: evt.garageId, status: 'pending' },
  });
};
