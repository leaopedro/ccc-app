// Two lists, deliberately different, both used in this file. Read the doc
// comments in @ccc/shared/premium before swapping one for the other:
//   LIVE_MEMBERSHIP_STATUSES        — entitlement: 5 wide, includes trialing/paused.
//   LIVE_PER_GARAGE_INDEX_STATUSES  — what premium_membership_live_per_garage
//                                     actually enforces: 3 wide.
// Pre-checks that exist to avoid a P2002 on that index must use the second one.
// handleExpired below asks the entitlement question, so it uses the first.
import { LIVE_MEMBERSHIP_STATUSES, LIVE_PER_GARAGE_INDEX_STATUSES } from '@ccc/shared/premium';
import type { Prisma, PremiumProvider, PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/node';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';
import { awardXp } from '../garage/xp-awarder.js';

import type { BillingEvent } from './types.js';

/**
 * What applyMembershipEvent actually did.
 *
 * `refused_live_conflict` is the only non-write outcome: the event would have
 * moved a row INTO the `premium_membership_live_per_garage` index while another
 * row for the same garage already occupies it, so the event was allowed to
 * complete without writing anything. Reported by handleActivated,
 * handleResumed, handleCancelled, handlePastDue and handleUncancelled — every
 * handler whose only job is a status the index would refuse. Post-commit hooks
 * must not fire work off it.
 *
 * handleRenewed hits the same conflict but does NOT report it here, and that is
 * deliberate — read the comment on its guard. A renewal that loses the index
 * race still writes its invoice and its period, so from a post-commit hook's
 * point of view the event genuinely applied.
 */
export type MembershipEventOutcome = 'applied' | 'refused_live_conflict';

/** Adapter for the handlers that have no refusal path and always write. */
const applied = async (p: Promise<void>): Promise<MembershipEventOutcome> => {
  await p;
  return 'applied';
};

/**
 * The row currently holding this garage's slot in
 * `premium_membership_live_per_garage`, excluding `exceptId`.
 *
 * Shared by every handler that writes a status the index covers ('active',
 * 'past_due', 'cancel_scheduled') and can therefore move a row INTO it. Six of
 * them: handleActivated, handleRenewed, handleResumed, handleCancelled,
 * handlePastDue, handleUncancelled. The last three go through
 * `refuseStatusFlipIfLiveElsewhere`; the first three each need their own
 * decision about what to keep, so they call this directly.
 *
 * Scope is LIVE_PER_GARAGE_INDEX_STATUSES, NOT LIVE_MEMBERSHIP_STATUSES. The
 * long comment on handleActivated's guard explains why widening it would create
 * the exact failure these guards exist to prevent; it applies verbatim here.
 *
 * `exceptId` is the row the caller is about to write. A row already inside the
 * index cannot conflict with itself, and the index guarantees no OTHER row is
 * live while it is, so passing it makes this return null for every ordinary
 * event at the cost of one indexed lookup.
 *
 * Race-free under the `SELECT ... FROM "Garage" ... FOR UPDATE` lock every
 * caller of applyMembershipEvent must already hold (canon §F8.5) — the same
 * contract the read-then-write in each handler already depends on.
 */
const findLiveIncumbent = async (
  tx: Prisma.TransactionClient,
  garageId: string,
  exceptId: string | null,
) =>
  tx.premiumMembership.findFirst({
    where: {
      garageId,
      status: { in: [...LIVE_PER_GARAGE_INDEX_STATUSES] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: {
      id: true,
      provider: true,
      providerSubRef: true,
      status: true,
      tier: true,
      grossAmountCents: true,
      currency: true,
      currentPeriodEnd: true,
    },
  });

/** The `extra` keys describing the incumbent, identical across all three alerts. */
const incumbentExtra = (incumbent: NonNullable<Awaited<ReturnType<typeof findLiveIncumbent>>>) => ({
  incumbentMembershipId: incumbent.id,
  incumbentProvider: incumbent.provider,
  incumbentProviderSubRef: incumbent.providerSubRef,
  incumbentStatus: incumbent.status,
  incumbentTier: incumbent.tier,
  incumbentGrossAmountCents: incumbent.grossAmountCents,
  incumbentCurrency: incumbent.currency,
  incumbentCurrentPeriodEnd: incumbent.currentPeriodEnd.toISOString(),
});

/**
 * The pure status flips: cancelled, past_due, uncancelled.
 *
 * All three write a status that is INSIDE the index
 * ('cancel_scheduled', 'past_due', 'active'), so all three can move a row into
 * it and raise the same P2002 the activation guard exists to prevent. PR #44
 * reported them safe; they are not. A probe against a real Postgres, run before
 * this change, threw `Unique constraint failed on the fields: (garageId)` on
 * each of the three. `tier_changed`, `expired`, `paused` and
 * `reconcileMembershipAddonsAmount` passed the same probe and need no guard —
 * `tier_changed` and the reconcile write no status at all, and `expired` /
 * `paused` write statuses OUTSIDE the index, so they only ever LEAVE it.
 *
 * Reachability differs a lot across the three, and the reasoning is recorded on
 * each handler. It does not change the treatment: they share one guard because
 * they share one situation. None of them carries money, none of them creates
 * entitlement, and the only thing each does is flip a status — so when the
 * status is the thing Postgres refuses, there is no partial write worth
 * salvaging (this is what separates them from handleRenewed, whose invoice
 * still has a correct home). Leave the row where it is, complete the event,
 * alert.
 *
 * Level is `error`. No charge happened inside these events, but reaching this
 * branch always means a garage is carrying two billing subscriptions with one
 * live row, and the state does not resolve itself.
 *
 * Returns the outcome to hand straight back from the handler.
 */
const refuseStatusFlipIfLiveElsewhere = async (
  tx: Prisma.TransactionClient,
  evt: Extract<
    BillingEvent,
    { kind: 'subscription.cancelled' | 'subscription.past_due' | 'subscription.uncancelled' }
  >,
  target: { id: string; garageId: string; status: string },
  attemptedStatus: string,
): Promise<MembershipEventOutcome> => {
  const liveElsewhere = await findLiveIncumbent(tx, target.garageId, target.id);
  if (!liveElsewhere) return 'applied';

  Sentry.captureMessage(
    `billing: ${evt.kind} not applied — garage already has a live membership under another subscription`,
    {
      level: 'error',
      tags: { kind: 'premium-live-membership-conflict', provider: evt.provider },
      extra: {
        garageId: target.garageId,
        eventKind: evt.kind,
        memberWasCharged: false,
        ...incumbentExtra(liveElsewhere),
        incomingProvider: evt.provider,
        incomingProviderSubRef: evt.providerSubRef,
        incomingMembershipId: target.id,
        incomingMembershipStatus: target.status,
        // The status the provider says this subscription is in, which the
        // index would not let us record. Without it the operator cannot tell
        // what our row is now wrong about.
        attemptedStatus,
        statusFlipRefused: true,
      },
    },
  );
  return 'refused_live_conflict';
};

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
): Promise<MembershipEventOutcome> => {
  switch (evt.kind) {
    case 'subscription.activated':
      return handleActivated(tx, evt);
    case 'subscription.renewed':
      return applied(handleRenewed(tx, evt));
    case 'subscription.cancelled':
      return handleCancelled(tx, evt);
    case 'subscription.uncancelled':
      return handleUncancelled(tx, evt);
    case 'subscription.expired':
      return applied(handleExpired(tx, evt));
    case 'subscription.past_due':
      return handlePastDue(tx, evt);
    case 'subscription.tier_changed':
      return applied(handleTierChanged(tx, evt));
    case 'subscription.paused':
      return applied(handlePaused(tx, evt));
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
): Promise<MembershipEventOutcome> {
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

  // -------------------------------------------------------------------------
  // Live-per-garage guard
  //
  // The lookup above keys ONLY on (provider, providerSubRef), but the DB also
  // carries the partial unique `premium_membership_live_per_garage`
  // (migration 20260527094120):
  //
  //   CREATE UNIQUE INDEX premium_membership_live_per_garage
  //     ON "PremiumMembership" ("garageId")
  //     WHERE status IN ('active', 'past_due', 'cancel_scheduled');
  //
  // A garage that already holds a live membership under a DIFFERENT
  // subscription made the findUnique miss and the create below raise P2002.
  // Nothing here, in applyMembershipEvent, or in the Stripe/RC webhook routes
  // caught it: the webhook 500'd, Stripe retried on its backoff, and every
  // retry hit the same violation. Worst shape in the billing system — the card
  // was charged, no membership row landed, and no refund was issued. Two real
  // ways to get here: the double native-checkout race documented in
  // routes/me-premium.ts (an attempt with no confirmation_secret leaves a live
  // sub behind and a retry mints a second one), and a member who already pays
  // through one provider subscribing again through the other.
  //
  // The guard sits ABOVE all three write branches, not only the create. Both
  // `existing` branches below also write status 'active', so an activation for
  // a row that is currently `expired`/`paused` moves that row INTO the live set
  // and violates the same index. That is a real Apple path, not a theoretical
  // one: normalize-revenuecat keys providerSubRef on `original_transaction_id`,
  // which Apple reuses across re-purchases, so a member who lets an Apple sub
  // expire and buys again comes back as INITIAL_PURCHASE onto the SAME row.
  // If a Stripe membership went live in between, the update is the P2002.
  //
  // `id: { not: existing.id }` on the existing branches: a row already inside
  // the index cannot conflict with itself, and the index itself guarantees no
  // OTHER row is live while it is, so this find returns null in the ordinary
  // case and costs one indexed lookup.
  //
  // Scope is LIVE_PER_GARAGE_INDEX_STATUSES, NOT LIVE_MEMBERSHIP_STATUSES. The
  // two differ on purpose and the difference is load-bearing here: the shared
  // "live" list also carries `trialing` and `paused`, which the index does not.
  // Checking the wider list would refuse activations Postgres would have
  // accepted — a member with a paused Stripe subscription subscribing on Apple
  // gets charged and provisioned nothing, which is the exact failure this guard
  // exists to prevent. Whether `trialing`/`paused` SHOULD also block a second
  // membership is an open product question; deciding it means changing the
  // index in a migration, not widening this pre-check.
  //
  // Chosen behaviour: the pre-existing live membership WINS and this activation
  // writes nothing. A route with a human on the other end could answer 409; a
  // webhook cannot — any non-2xx just buys another retry of the same violation
  // — so the event is allowed to complete and be marked processed, and the
  // alert is what carries it to a human.
  //
  // Why not supersede the incumbent instead: expiring it would hand entitlement
  // to the newest payment, but the superseded subscription is still live and
  // still billing at the provider, so its next renewal comes back through
  // handleRenewed, flips that row to 'active' and violates the same index from
  // the other side. Superseding trades one uncaught P2002 for a different one,
  // and it cancels nothing at the provider — the double charge stays either
  // way. Only a human can pick which subscription to keep and refund the other.
  //
  // Nothing is silently dropped: this is a Sentry `error` carrying the garage,
  // both providers, both subscription refs, both gross amounts and the
  // unrecorded invoice ref. The SubscriptionWebhookEvent row also keeps the raw
  // payload, so the paid invoice is never traceless.
  //
  // The remediation path (docs/observability.md, Runbook 5, "money in, nothing
  // out"): an operator refunds or cancels the duplicate at the provider and,
  // if the wrong subscription won, expires the incumbent and re-creates the
  // membership with `POST /admin/subscriptions/grant`, which replays this same
  // function under the same `SELECT ... FOR UPDATE` lock.
  //
  // No SAVEPOINT + P2002 catch as a backstop: this pre-check is race-free under
  // the lock every caller of applyMembershipEvent must already hold (canon
  // §F8.5, `SELECT ... FROM "Garage" ... FOR UPDATE`), which is the same
  // contract the findUnique→write window above already relies on.
  // -------------------------------------------------------------------------
  const liveElsewhere = await findLiveIncumbent(tx, garageId, existing?.id ?? null);
  if (liveElsewhere) {
    // Settle the originating attempt here instead of leaving it to the reaper.
    //
    // Without this the row stays `pending` until reapAbandonedAttempts
    // (workers/billing-reconcile.ts) flips it to `abandoned` hours later. Two
    // problems with that: `abandoned` means "the member gave up", which is a
    // lie about someone whose card was charged, and until the reaper runs the
    // partial unique on (garageId WHERE status='pending') keeps answering
    // `SubscriptionAttemptInFlight` for an attempt that will never resolve.
    //
    // `failed` is the honest state of the three that exist. It says the attempt
    // did not become a membership and the member did not walk away. There is no
    // `charged_not_provisioned` status and adding one is a migration this fix
    // does not need: the Sentry alert, not the enum, is what carries "the money
    // moved" to a human.
    //
    // Releasing the pending slot cannot mint a third subscription: reaching
    // this branch means the garage holds an INDEXED-live membership, so both
    // the precheck and checkout-native answer `AlreadySubscribed` before any
    // provider call.
    //
    // Scoped by garageId as well as providerSubRef. Provider subscription ids
    // are unique in practice, so no failure sequence was constructible from the
    // unscoped version — but "in practice" is not a constraint, `providerSubRef`
    // carries no unique index on this table, and settling another garage's
    // attempt is a write we can rule out for free instead of arguing about.
    const settledAttempts = await tx.premiumSubscriptionAttempt.updateMany({
      where: { garageId, providerSubRef, status: 'pending' },
      data: { status: 'failed' },
    });

    Sentry.captureMessage(
      'billing: activation refused, member WAS charged — garage already has a live membership under another subscription',
      {
        level: 'error',
        tags: { kind: 'premium-live-membership-conflict', provider },
        extra: {
          garageId,
          // Which of the three conflict shapes this is. Same tag for all three
          // so one Sentry alert rule and one runbook section cover them, but
          // the remediations differ enough that the operator must not have to
          // infer it from the message string.
          eventKind: evt.kind,
          // Explicit, because the whole point of the alert is that money moved
          // and nothing was provisioned for it.
          memberWasCharged: true,
          ...incumbentExtra(liveElsewhere),
          incomingProvider: provider,
          incomingProviderSubRef: providerSubRef,
          incomingProviderCustomerRef: providerCustomerRef,
          // Everything Runbook 5's hand-written row needs, so the operator can
          // execute the documented remediation from the alert alone without
          // going digging in the provider dashboard: tier, cadence,
          // baseAmountCents, devFeePercent and the period bounds.
          incomingTier: tier,
          incomingCadence: cadence,
          incomingBaseAmountCents: pricing.baseAmountCents,
          incomingDevFeePercent: pricing.devFeePercent,
          incomingGrossAmountCents: pricing.grossAmountCents,
          incomingCurrency: pricing.currency,
          incomingCurrentPeriodStart: currentPeriodStart.toISOString(),
          incomingCurrentPeriodEnd: currentPeriodEnd.toISOString(),
          // Null when the incoming subscription has no row yet (the create
          // case). Non-null means an existing, non-live row was about to be
          // flipped back to 'active' — the Apple re-purchase shape.
          incomingMembershipId: existing?.id ?? null,
          incomingMembershipStatus: existing?.status ?? null,
          // Paid at the provider and deliberately NOT written here: it belongs
          // to the losing subscription, and filing it under the incumbent
          // membership would corrupt that member's invoice history.
          unrecordedProviderInvoiceRef: invoice.providerInvoiceRef,
          unrecordedPaidAt: invoice.paidAt.toISOString(),
          unrecordedPeriodStart: invoice.periodStart.toISOString(),
          unrecordedPeriodEnd: invoice.periodEnd.toISOString(),
          settledAttempts: settledAttempts.count,
        },
      },
    );
    return 'refused_live_conflict';
  }

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
        ...(pricing.paymentBrand ? { paymentBrand: pricing.paymentBrand } : {}),
        ...(pricing.paymentLast4 ? { paymentLast4: pricing.paymentLast4 } : {}),
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
        ...(pricing.paymentBrand ? { paymentBrand: pricing.paymentBrand } : {}),
        ...(pricing.paymentLast4 ? { paymentLast4: pricing.paymentLast4 } : {}),
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

  // Task 9's native checkout (POST /checkout-native) leaves the originating
  // PremiumSubscriptionAttempt row 'pending' until the subscription is
  // actually confirmed paid — this event is that confirmation. updateMany
  // (not update): a hosted-checkout membership has no matching attempt row
  // at all, and a replay of this same event finds the row already
  // 'succeeded'; both must be a no-op, not a thrown "record not found".
  //
  // Scoped by garageId for the same reason the refusal branch above is: this
  // table carries no unique index on `providerSubRef`, so nothing but provider
  // convention stops the filter matching another garage's attempt. Both settles
  // in this handler now carry the same scope.
  await tx.premiumSubscriptionAttempt.updateMany({
    where: { garageId, providerSubRef, status: 'pending' },
    data: { status: 'succeeded' },
  });

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
        // exactOptionalPropertyTypes: omit the key when the normalizer had no
        // mode to report, so the column keeps its `true` default instead of
        // being written with undefined.
        ...(invoice.livemode !== undefined ? { livemode: invoice.livemode } : {}),
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
        // payoutAmountCents/vendorName so no create. Sao snapshot do momento do
        // vinculo, igual a preco e cota: um replay de activation nao pode
        // reescrever o que attachAddon ja gravou com o catalogo da epoca.
        create: {
          membershipId: membership.id,
          addonKey: addon.addonKey,
          status: 'active',
          providerItemRef: addon.providerItemRef,
          monthlyDeltaCents: addon.monthlyDeltaCents,
          payoutAmountCents: addon.payoutAmountCents,
          vendorName: addon.vendorName,
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

  return 'applied';
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

  // -------------------------------------------------------------------------
  // Live-per-garage guard — renewal variant
  //
  // The update below writes status 'active', so it moves the row INTO
  // `premium_membership_live_per_garage` exactly the way handleActivated's
  // writes can. If the renewing row is currently OUTSIDE the index
  // ('expired'/'paused') while a different row for the same garage is inside
  // it, Postgres raises the same P2002, it escapes the transaction, the webhook
  // 5xx's, and the provider retries the identical violation forever.
  //
  // Not theoretical, and it is the direct downstream of the activation guard:
  // that guard refuses an Apple re-purchase and leaves the Apple row `expired`,
  // but refusing it here does not cancel it at Apple. Apple keeps billing, and
  // the next RENEWAL arrives keyed on `original_transaction_id` (see
  // normalize-revenuecat) — the SAME row, still expired, still beside a live
  // Stripe row. The route's unknown-subscription branch does not catch it,
  // because the row does exist.
  //
  // Only the forward branch is guarded. A stale (out-of-order) renewal writes
  // no status at all, so it cannot enter the index and must not alert.
  //
  // WHY THIS IS NOT "incumbent wins, refuse, alert" like handleActivated.
  //
  // The activation guard refuses the WHOLE event because there is nothing it
  // can safely keep: the paid invoice belongs to a subscription with no
  // membership row, and filing it under the incumbent would corrupt that
  // member's invoice history. A renewal is a different situation on the one
  // point that matters — the row already exists. The invoice has a correct,
  // unambiguous home: its own subscription's membership. Refusing the whole
  // event would throw away a real payment we are perfectly able to record, and
  // "we lost the invoice" is a worse, less recoverable wrong than "the status
  // did not flip". So this branch refuses exactly what Postgres refuses, the
  // `status` write, and applies everything else:
  //
  //   - invoice: written. It is money, it is ours, and it has a home.
  //   - period + pricing: written. They describe the subscription the provider
  //     just billed; leaving them stale would make the row disagree with the
  //     invoice we just filed under it.
  //   - status: NOT written. The row keeps 'expired'/'paused'.
  //   - Garage snapshot: NOT written — see the `isForward && !liveElsewhere`
  //     gate below.
  //
  // The snapshot is the one judgement call worth stating, because the opposite
  // is arguable: the member did pay for this period, so extending
  // `premiumUntil` off it would keep entitlement alive. It is skipped anyway.
  // `premiumUntil` is entitlement, entitlement follows the row that holds the
  // index slot, and writing a snapshot from a row we are in the same breath
  // refusing to make live is internally contradictory. Worse, it would paper
  // over the conflict: the member would keep working premium while two
  // subscriptions bill, which is precisely the state that needs a human. The
  // incumbent is live and keeps its own snapshot current, so nothing is lost
  // today; the alert is what fixes the underlying double-billing.
  //
  // Outcome stays 'applied', not 'refused_live_conflict'. The invoice and the
  // period DID land, so post-commit hooks keyed on "this event applied" are
  // right to run. openMonthlyBoxIfEligible is the only one that reaches a
  // renewal and it re-reads the row's status itself, so the un-flipped row
  // correctly opens no box.
  // -------------------------------------------------------------------------
  const isForward = currentPeriodEnd > existing.currentPeriodEnd;
  const liveElsewhere = isForward
    ? await findLiveIncumbent(tx, existing.garageId, existing.id)
    : null;

  if (liveElsewhere) {
    Sentry.captureMessage(
      'billing: renewal paid but not activated — garage already has a live membership under another subscription',
      {
        level: 'error',
        tags: { kind: 'premium-live-membership-conflict', provider },
        extra: {
          garageId: existing.garageId,
          eventKind: evt.kind,
          // The renewal moved money. Entitlement did not follow it.
          memberWasCharged: true,
          ...incumbentExtra(liveElsewhere),
          incomingProvider: provider,
          incomingProviderSubRef: providerSubRef,
          incomingMembershipId: existing.id,
          // The status the row keeps. This is the whole refusal.
          incomingMembershipStatus: existing.status,
          incomingGrossAmountCents: pricing.grossAmountCents,
          incomingCurrency: pricing.currency,
          incomingCurrentPeriodStart: currentPeriodStart.toISOString(),
          incomingCurrentPeriodEnd: currentPeriodEnd.toISOString(),
          // Unlike the activation alert, this invoice IS recorded — under the
          // membership named by incomingMembershipId. The operator refunding
          // the duplicate needs to know it is already in the books.
          recordedProviderInvoiceRef: invoice.providerInvoiceRef,
          recordedPaidAt: invoice.paidAt.toISOString(),
          // What was deliberately not done, so the alert states its own
          // remediation rather than making the operator diff the code.
          statusFlipRefused: true,
          garageSnapshotRefused: true,
        },
      },
    );
  }

  const membership = isForward
    ? await tx.premiumMembership.update({
        where: { id: existing.id },
        data: {
          // The two fields withheld when another row holds the index slot.
          // `status` is the one Postgres would refuse; `cancelAtPeriodEnd`
          // rides with it because the pair describes one decision — "this
          // subscription is live and not winding down" — and writing half of
          // it leaves an `expired` row claiming it is not scheduled to cancel
          // while `cancelledAt` still holds a date. No reader is affected
          // either way; it is the admin detail view that reads wrong.
          // Omitted rather than written back from `existing`: this handler has
          // no business restating state it did not decide.
          ...(liveElsewhere ? {} : { status: 'active' as const, cancelAtPeriodEnd: false }),
          currentPeriodStart,
          currentPeriodEnd,
          baseAmountCents: pricing.baseAmountCents,
          devFeePercent: pricing.devFeePercent,
          devFeeAmountCents: pricing.devFeeAmountCents,
          grossAmountCents: pricing.grossAmountCents,
          currency: pricing.currency,
          // Spread condicional, nao atribuicao direta: uma renovacao sem o dado
          // nao pode apagar com null o snapshot bom gravado na ativacao.
          ...(pricing.paymentBrand ? { paymentBrand: pricing.paymentBrand } : {}),
          ...(pricing.paymentLast4 ? { paymentLast4: pricing.paymentLast4 } : {}),
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
        // exactOptionalPropertyTypes: omit the key when the normalizer had no
        // mode to report, so the column keeps its `true` default instead of
        // being written with undefined.
        ...(invoice.livemode !== undefined ? { livemode: invoice.livemode } : {}),
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
  // Skip on live conflict: the row did not become live, so it does not get to
  // move entitlement. Rationale in full on the guard above.
  if (isForward && !liveElsewhere) {
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
): Promise<MembershipEventOutcome> {
  const { provider, providerSubRef, cancelledAt } = evt;

  // `cancel_scheduled` is INSIDE premium_membership_live_per_garage, so this
  // write can move a row into the index. The most reachable of the three pure
  // flips, and it needs nothing more exotic than the self-serve Billing Portal:
  // pause the Stripe subscription (row leaves the index), buy on Apple (the
  // activation guard allows it, deliberately), then cancel the paused Stripe
  // subscription to tidy up. Discriminator 1 in normalize-stripe fires on the
  // cancel_at_period_end flip regardless of pause state, so that arrives here
  // as `subscription.cancelled` onto a `paused` row beside a live Apple one.
  // Our own admin cannot produce it — ADMIN_SUBSCRIPTION_ALLOWED_STATUS.cancel
  // excludes `paused` — but the portal is not our admin.
  const target = await tx.premiumMembership.findUniqueOrThrow({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    select: { id: true, garageId: true, status: true },
  });
  const refusal = await refuseStatusFlipIfLiveElsewhere(tx, evt, target, 'cancel_scheduled');
  if (refusal !== 'applied') return refusal;

  // Set flag + cancelledAt. No snapshot change — user remains active
  // through currentPeriodEnd (spec §3.5).
  await tx.premiumMembership.update({
    where: { id: target.id },
    data: { status: 'cancel_scheduled', cancelAtPeriodEnd: true, cancelledAt },
  });
  return 'applied';
}

// ---------------------------------------------------------------------------
// subscription.uncancelled (user reversed cancel before period end)
// ---------------------------------------------------------------------------

async function handleUncancelled(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.uncancelled' }>,
): Promise<MembershipEventOutcome> {
  const { provider, providerSubRef } = evt;

  // Writes 'active', so it is mechanically exposed like the other two, but the
  // hardest of the three to reach. The ordinary un-cancel acts on a row that is
  // `cancel_scheduled`, which is already INSIDE the index — and the index then
  // guarantees no other row is live, so the guard finds nothing. Getting the
  // row out of the index first takes a direct Stripe-dashboard sequence (pause
  // a cancel-scheduled subscription, then clear cancel_at_period_end); our
  // admin refuses it, since ADMIN_SUBSCRIPTION_ALLOWED_STATUS.pause excludes
  // `cancel_scheduled`. Guarded anyway: the check is one indexed lookup that
  // returns null on every real un-cancel, and the alternative is a webhook that
  // 5xx-retries forever if the sequence ever happens.
  const target = await tx.premiumMembership.findUniqueOrThrow({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    select: { id: true, garageId: true, status: true },
  });
  const refusal = await refuseStatusFlipIfLiveElsewhere(tx, evt, target, 'active');
  if (refusal !== 'applied') return refusal;

  const membership = await tx.premiumMembership.update({
    where: { id: target.id },
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
  return 'applied';
}

// ---------------------------------------------------------------------------
// subscription.expired
// ---------------------------------------------------------------------------

async function handleExpired(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.expired' }>,
): Promise<void> {
  // Audited, unguarded on purpose: 'expired' is OUTSIDE
  // premium_membership_live_per_garage, so this write only ever LEAVES the
  // index. Leaving is unconditionally accepted by a partial unique. Confirmed
  // against a real Postgres by the same probe that broke cancelled/past_due/
  // uncancelled.
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
      status: { in: [...LIVE_MEMBERSHIP_STATUSES] },
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
): Promise<MembershipEventOutcome> {
  const { provider, providerSubRef } = evt;

  // Writes 'past_due', which is INSIDE the index, so the probe reproduces the
  // P2002 here too. No LIVE path was constructible, though, and the reason is
  // worth recording rather than re-deriving: getting here needs an
  // `invoice.payment_failed` for a subscription whose row is OUTSIDE the index,
  // and the statuses outside it are `paused`, `expired` and `trialing`. Stripe
  // does not charge a paused or a cancelled subscription, so neither produces a
  // payment failure, and nothing in this codebase ever writes `trialing` — the
  // status exists in the enum and in LIVE_MEMBERSHIP_STATUSES but no handler,
  // route or worker sets it. Guarded on the same one-lookup terms as the other
  // two: "no path exists today" is a statement about today's normalizers.
  const target = await tx.premiumMembership.findUniqueOrThrow({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    select: { id: true, garageId: true, status: true },
  });
  const refusal = await refuseStatusFlipIfLiveElsewhere(tx, evt, target, 'past_due');
  if (refusal !== 'applied') return refusal;

  // Status flip only. No snapshot change — Stripe's automatic dunning
  // retries ~3× over 7d. Reconciliation sweep (chunk F8.12) handles
  // eventual snapshot expiry if dunning fails (spec §3.5).
  await tx.premiumMembership.update({
    where: { id: target.id },
    data: { status: 'past_due' },
  });
  return 'applied';
}

// ---------------------------------------------------------------------------
// subscription.tier_changed (cadence swap monthly↔annual in v1)
// ---------------------------------------------------------------------------

async function handleTierChanged(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.tier_changed' }>,
): Promise<void> {
  // Audited, unguarded on purpose: this handler writes no `status` at all, so
  // it cannot move a row into premium_membership_live_per_garage. It updates
  // tier/cadence/pricing and the Garage snapshot only.
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

  // Audited, unguarded on purpose: 'paused' is OUTSIDE
  // premium_membership_live_per_garage, so like handleExpired this write only
  // ever leaves the index.
  //
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
): Promise<MembershipEventOutcome> {
  const { provider, providerSubRef } = evt;

  // -------------------------------------------------------------------------
  // Live-per-garage guard — resume variant
  //
  // Third and last write of `status: 'active'` that can move a row into
  // `premium_membership_live_per_garage`, and the easiest of the three to
  // reach, because PR #44 opened the door on purpose. `paused` is inside
  // LIVE_MEMBERSHIP_STATUSES but OUTSIDE the index, and the activation guard is
  // scoped to the index precisely so a member with a paused Stripe subscription
  // can still buy on Apple without being charged for nothing. Correct call —
  // and it is what puts a paused row next to a live one. Clearing
  // pause_collection in the Billing Portal (or an admin resume, see
  // routes/admin/subscriptions.ts) then asks us to make the paused row active,
  // Postgres raises P2002, the webhook 5xx's and Stripe retries forever.
  //
  // Behaviour: refuse the whole event, keep the incumbent, alert. Same answer
  // as handleActivated and for the same reason handleRenewed does NOT get that
  // answer — a resume carries no money and no invoice. There is nothing here
  // worth salvaging from a partial write: the only thing this handler does is
  // decide which row is live, and that is exactly the thing it may not do.
  // Writing the period/snapshot half anyway would hand entitlement to a row we
  // just declined to activate.
  //
  // Level is `error`, not `warning`, even though nothing was charged in this
  // event. The provider has resumed collection regardless of what our DB says,
  // so this member is now on two billing subscriptions with one live row, and
  // the next cycle produces a real double charge. That is a state that has to
  // reach a human before the next invoice, not after.
  //
  // Cost on the ordinary path: one indexed lookup that returns null, because
  // `exceptId` excludes the resuming row and the index guarantees no other row
  // is live when it already is.
  // -------------------------------------------------------------------------
  const target = await tx.premiumMembership.findUniqueOrThrow({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    select: { id: true, garageId: true, status: true, tier: true, currentPeriodEnd: true },
  });
  const liveElsewhere = await findLiveIncumbent(tx, target.garageId, target.id);
  if (liveElsewhere) {
    Sentry.captureMessage(
      'billing: resume refused — garage already has a live membership under another subscription, and the provider resumed billing anyway',
      {
        level: 'error',
        tags: { kind: 'premium-live-membership-conflict', provider },
        extra: {
          garageId: target.garageId,
          eventKind: evt.kind,
          // No charge in THIS event. The next cycle is the problem.
          memberWasCharged: false,
          providerResumedBilling: true,
          ...incumbentExtra(liveElsewhere),
          incomingProvider: provider,
          incomingProviderSubRef: providerSubRef,
          incomingMembershipId: target.id,
          incomingMembershipStatus: target.status,
          incomingTier: target.tier,
          incomingCurrentPeriodEnd: target.currentPeriodEnd.toISOString(),
          statusFlipRefused: true,
          garageSnapshotRefused: true,
        },
      },
    );
    return 'refused_live_conflict';
  }

  // Fix round 2, finding 3: clearing cancelAtPeriodEnd/cancelledAt here is
  // copied from handleUncancelled, mas retomar cobranca (pause_collection
  // limpo) nao e a mesma intencao de reverter um cancelamento. Uma assinatura
  // pausada E com cancel_at_period_end=true na Stripe, apos um resume,
  // ficaria Ativo com "Cancelamento agendado: Nao" aqui, enquanto a Stripe
  // ainda cancela no fim do periodo.
  //
  // A combinacao foi considerada de proposito e o clear continua deliberado:
  // nao existe forma de o nosso admin produzir esse estado. Em
  // routes/admin/subscriptions.ts, ALLOWED_STATUS.pause exclui
  // cancel_scheduled e ALLOWED_STATUS.cancel exclui paused, entao
  // pausar-e-cancelar a mesma assinatura so acontece com alguem agindo direto
  // no dashboard da Stripe. Ficou registrado aqui em vez de mudar o
  // comportamento.
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

  return 'applied';
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
 * Audited against premium_membership_live_per_garage and deliberately
 * unguarded: writing no `status` means it cannot move a row into that index.
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
 * Second gate: `outcome`. An activation refused by the live-per-garage guard
 * wrote no membership, no invoice and no Garage snapshot, so backfilling
 * tickets off it is work scheduled from a no-op. The worker would find the
 * incumbent membership and do roughly the right thing, which is why this was
 * harmless rather than a bug, but a job queued by an event that wrote nothing
 * has no business existing. Defaults to 'applied' so callers that never see a
 * refusal (tests, the reconcile worker's synthesised events) stay unchanged.
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
  outcome: MembershipEventOutcome = 'applied',
): Promise<void> => {
  if (evt.kind !== 'subscription.activated') return;
  if (outcome !== 'applied') return;
  await client.premiumTicketBackfillJob.create({
    data: { garageId: evt.garageId, status: 'pending' },
  });
};
