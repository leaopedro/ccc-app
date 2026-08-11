import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import { Prisma, type PrismaClient } from '@prisma/client';

import type { BillingEvent } from '../billing/types.js';
import { computeCutoffAt, deriveCycleKey } from './cycle.js';

const OPEN_KINDS = new Set(['subscription.activated', 'subscription.renewed']);
const ELIGIBLE_STATUSES = new Set(['active', 'trialing']);

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
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return; // box for this cycle already exists — no-op
    }
    // Best-effort: log via console; the webhook route must not fail on this.
    console.error('[box-open] failed to open MonthlyBox', err);
  }
};
