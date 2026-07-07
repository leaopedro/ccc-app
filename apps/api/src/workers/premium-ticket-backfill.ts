// apps/api/src/workers/premium-ticket-backfill.ts
//
// Post-commit ticket backfill worker for premium membership activation.
//
// Canon §F8.4: this worker runs POST-COMMIT from applyMembershipEvent.
//              It MUST NOT be called inside the activation tx.
// Canon §F8.7: pick first isPremiumGrantable tier; if none, log
//              premium_grant.no_tier + continue (NEVER throw).
// Canon §F8.8: rely on partial unique UNIQUE(userId,eventId) WHERE
//              status='valid' AND source='premium_grant' as the DB-level
//              dedup. Per-insert P2002 is swallowed and the loop continues.
//
// Job-table pattern mirrors data-export.ts (existing codebase pattern).
//
// Ticket.code is NOT a stored column (verified against schema). The signed
// HMAC code is generated on-demand from ticket.id at display time via
// signTicketCode(). This worker only creates the entitlement row.

import { prisma } from '@jdm/db';
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import { pickPremiumGrantableTier } from '../services/billing/tier-selection.js';

// Page size for the event scan. Each page is processed as a single inner tx
// per spec §4.2 ("Chunked 100 events per inner tx"). Per-insert P2002 inside
// the page tx requires SAVEPOINT (gap #12 — Postgres marks the tx aborted
// (state 25P02) on any error; catching the JS exception does NOT clear the
// aborted-tx state). Pattern mirrors F8.03 invoice-insert.
const EVENT_PAGE_SIZE = 100;

export type BackfillWorkerDeps = {
  env: Env;
  log?: FastifyBaseLogger;
};

// ── processBackfillJob ───────────────────────────────────────────────────────

export const processBackfillJob = async (
  jobId: string,
  deps: BackfillWorkerDeps,
): Promise<void> => {
  const { log } = deps;

  // Fetch job + garage in one query.
  const job = await prisma.premiumTicketBackfillJob.findUnique({
    where: { id: jobId },
    include: { garage: { select: { userId: true } } },
  });

  if (!job) {
    log?.warn({ jobId }, 'premium_grant.backfill_job_not_found');
    return;
  }

  if (job.status !== 'pending') {
    // Already processed by a concurrent tick or a prior run.
    return;
  }

  const userId = job.garage.userId;

  // Mark as processing so a concurrent tick does not pick it up again.
  await prisma.premiumTicketBackfillJob.update({
    where: { id: jobId },
    data: { status: 'processing' },
  });

  try {
    // Page through published future events.
    let cursor: string | undefined;

    while (true) {
      const events = await prisma.event.findMany({
        where: {
          status: 'published',
          startsAt: { gt: new Date() },
        },
        select: { id: true },
        // Secondary `id ASC` tiebreak so events sharing the same startsAt
        // are paged deterministically — without it cursor-based paging can
        // skip or duplicate rows on ties.
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: EVENT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (events.length === 0) break;

      // Process this page as one inner tx (each page is ≤ EVENT_PAGE_SIZE).
      await prisma.$transaction(async (tx) => {
        for (const event of events) {
          const tier = await pickPremiumGrantableTier(tx, event.id);

          if (!tier) {
            // Canon §F8.7: skip + structured log; never throw.
            log?.warn(
              {
                eventId: event.id,
                garageId: job.garageId,
                reason: 'no_premium_grantable_tier',
              },
              'premium_grant.no_tier',
            );
            continue;
          }

          // Belt-and-braces application-layer check before insert.
          // The partial unique (canon §F8.8) is the real backstop.
          //
          // Scope the check to source='premium_grant' — a user may already
          // hold a valid 'purchase' or 'comp' ticket for the event, but that
          // does NOT block a premium grant (canon §F8.7 + §F8.8 allow the
          // grant to coexist as an entitlement marker). Only an existing
          // premium_grant skips the insert.
          const alreadyHasGrant = await tx.ticket.findFirst({
            where: {
              userId,
              eventId: event.id,
              status: 'valid',
              source: 'premium_grant',
            },
            select: { id: true },
          });
          if (alreadyHasGrant) continue;

          // Insert the entitlement row. On P2002 (partial unique fired — race
          // or replay), swallow and continue. Any other Prisma error rethrows
          // and aborts this page's tx; the job is marked 'failed' below.
          // SAVEPOINT wrap (gap #12): Prisma's $transaction does NOT
          // auto-savepoint per statement, so a P2002 inside the create poisons
          // the parent tx (Postgres state 25P02). ROLLBACK TO SAVEPOINT clears
          // it before the loop continues to the next event.
          await tx.$executeRawUnsafe('SAVEPOINT ticket_insert');
          try {
            await tx.ticket.create({
              data: {
                userId,
                eventId: event.id,
                tierId: tier.id,
                source: 'premium_grant',
                status: 'valid',
              },
            });
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT ticket_insert');
          } catch (err) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT ticket_insert');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT ticket_insert');
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              // Canon §F8.8 dedup: user already has a valid premium_grant
              // ticket for this event. Continue.
              continue;
            }
            throw err;
          }
        }
      });

      if (events.length < EVENT_PAGE_SIZE) break;
      cursor = events[events.length - 1]!.id;
    }

    await prisma.premiumTicketBackfillJob.update({
      where: { id: jobId },
      data: { status: 'completed' },
    });

    log?.info({ jobId, garageId: job.garageId, userId }, 'premium_grant.backfill_completed');
  } catch (err) {
    await prisma.premiumTicketBackfillJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      },
    });
    log?.error({ err, jobId, garageId: job.garageId }, 'premium_grant.backfill_failed');
    // Do not rethrow — failed jobs are retryable on next tick via a manual
    // status reset (admin tool or reconciliation sweep).
  }
};

// ── runPremiumTicketBackfillTick ─────────────────────────────────────────────

export const runPremiumTicketBackfillTick = async (deps: BackfillWorkerDeps): Promise<void> => {
  const jobs = await prisma.premiumTicketBackfillJob.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  for (const job of jobs) {
    try {
      await processBackfillJob(job.id, deps);
    } catch (err) {
      deps.log?.error({ err, jobId: job.id }, '[premium-ticket-backfill] unexpected tick error');
    }
  }
};

// ── startPremiumTicketBackfillWorker ─────────────────────────────────────────

export const startPremiumTicketBackfillWorker = (
  deps: BackfillWorkerDeps,
): { stop: () => void } => {
  const task = cron.schedule('* * * * *', async () => {
    try {
      await runPremiumTicketBackfillTick(deps);
    } catch (err) {
      deps.log?.error({ err }, '[premium-ticket-backfill] tick error');
    }
  });

  return {
    stop: () => {
      void task.stop();
    },
  };
};
