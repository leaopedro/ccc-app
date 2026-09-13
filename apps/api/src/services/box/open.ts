import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import { Prisma, type PremiumMembership, type PrismaClient } from '@prisma/client';

import type { BillingEvent } from '../billing/types.js';
import { computeCutoffAt, deriveCycleKey } from './cycle.js';

const OPEN_KINDS = new Set(['subscription.activated', 'subscription.renewed']);
const ELIGIBLE_STATUSES = new Set(['active', 'trialing']);

/** The MonthlyBox row itself. Shared by the webhook path and the read path. */
const createCycleBox = async (
  client: PrismaClient,
  membership: PremiumMembership,
  cycleKey: string,
  cutoffAt: Date,
  budgetCentsSnapshot: number,
): Promise<void> => {
  await client.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: membership.garageId,
      cycleKey,
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt,
      budgetCentsSnapshot,
      currency: membership.currency,
    },
  });
};

/**
 * Post-commit, best-effort: open the current-cycle MonthlyBox for a membership
 * that just advanced its period. Idempotent by (membershipId, cycleKey) — a stale
 * or duplicate event resolves to the same cycleKey and is swallowed via P2002.
 * Never throws: a failed open just means no box this cycle, retried on next event.
 */
export const openMonthlyBoxIfEligible = async (
  client: PrismaClient,
  evt: BillingEvent,
): Promise<void> => {
  try {
    if (!OPEN_KINDS.has(evt.kind)) return;

    const membership = await client.premiumMembership.findUnique({
      where: {
        provider_providerSubRef: { provider: evt.provider, providerSubRef: evt.providerSubRef },
      },
    });
    if (!membership) return;
    if (!ELIGIBLE_STATUSES.has(membership.status)) return;

    const settings = await client.boxSettings.findUnique({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
    });
    if (!settings || !settings.boxEnabled) return;

    const plan = await client.premiumPlan.findUnique({ where: { tier: membership.tier } });
    const budgetCentsSnapshot = plan?.monthlyBoxBudgetCents ?? 0;

    const cycleKey = deriveCycleKey(membership.currentPeriodStart);
    const cutoffAt = computeCutoffAt(membership.currentPeriodEnd, settings.cutoffDaysBeforeRenewal);

    await createCycleBox(client, membership, cycleKey, cutoffAt, budgetCentsSnapshot);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return; // box for this cycle already exists — no-op
    }
    // Best-effort: log via console; the webhook route must not fail on this.
    console.error('[box-open] failed to open MonthlyBox', err);
  }
};

/**
 * Read-path backfill: open the current-cycle box for an eligible membership
 * that never got one, so the member is not left staring at "sem caixa".
 *
 * `openMonthlyBoxIfEligible` above only fires on `subscription.activated` /
 * `subscription.renewed`, and it reads `boxEnabled` at that instant. A member
 * who subscribed while the box feature was still off has no row, and nothing
 * backfills one: flipping the admin flag does not reach existing memberships,
 * so GET /me/box answers 404 until the next renewal. Same hole for a renewal
 * webhook that was lost — the reconcile worker only synthesises an event for a
 * row it finds out of date, not for one whose box merely failed to open.
 *
 * Deliberately does NOT open a box past its cutoff. The cutoff worker would
 * pick it up on the next tick and resolve it straight to `skipped` (no items,
 * no auto-send), which is worse than the empty state: it shows the member a
 * dead box they never had a chance to build. A membership whose period already
 * ended is past its cutoff by definition, so this one check covers it too.
 *
 * Never throws — a failed backfill just leaves the 404 in place, as before.
 */
export const ensureCurrentCycleBox = async (
  client: PrismaClient,
  membershipId: string,
): Promise<void> => {
  try {
    const membership = await client.premiumMembership.findUnique({ where: { id: membershipId } });
    if (!membership) return;
    if (!ELIGIBLE_STATUSES.has(membership.status)) return;

    const cycleKey = deriveCycleKey(membership.currentPeriodStart);
    const existing = await client.monthlyBox.findUnique({
      where: { membershipId_cycleKey: { membershipId, cycleKey } },
      select: { id: true },
    });
    if (existing) return;

    const settings = await client.boxSettings.findUnique({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
    });
    if (!settings || !settings.boxEnabled) return;

    const cutoffAt = computeCutoffAt(membership.currentPeriodEnd, settings.cutoffDaysBeforeRenewal);
    if (cutoffAt.getTime() <= Date.now()) return;

    const plan = await client.premiumPlan.findUnique({ where: { tier: membership.tier } });
    await createCycleBox(client, membership, cycleKey, cutoffAt, plan?.monthlyBoxBudgetCents ?? 0);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return; // raced with the webhook path — the box exists either way
    }
    console.error('[box-open] failed to backfill MonthlyBox', err);
  }
};
