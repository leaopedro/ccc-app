// apps/api/src/workers/premium-event-publish-grant.ts
//
// Event-publish premium-grant worker (chunk F8.07).
//
// Canon §F8.4: this worker runs POST-COMMIT from the admin publish handler.
//              It MUST NOT be called inside the publish tx.
// Canon §F8.7: pick first isPremiumGrantable tier; if none, log
//              premium_grant.no_tier { eventId, reason: 'publish_hook' }
//              and exit (NEVER throw).
// Canon §F8.8: rely on partial unique UNIQUE(userId, eventId) WHERE
//              status='valid' AND source='premium_grant' as the DB-level
//              dedup. Per-insert P2002 is swallowed silently and the loop
//              continues. SAVEPOINT wrap is required because Prisma's
//              $transaction does NOT auto-savepoint per statement, so a
//              P2002 inside ticket.create poisons the parent tx (Postgres
//              state 25P02). Pattern mirrors F8.06 (premium-ticket-backfill).
//
// Spec §4.6 membership filter (AND, not OR):
//   status = 'active'
//   AND cancelAtPeriodEnd = false
//   AND currentPeriodEnd > event.startsAt
// Members with cancelAtPeriodEnd=true are skipped regardless of period end.
//
// Ticket.code is NOT a stored column. signTicketCode is read-path only.
// This worker only writes the entitlement row (userId, eventId, tierId,
// source, status).

import { prisma } from '@jdm/db';
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

import { pickPremiumGrantableTier } from '../services/billing/tier-selection.js';

// Inner-tx page size for the membership scan. Per spec §4.6 ("500 garages
// per inner tx"). Each page is processed as a single $transaction.
const PAGE_SIZE = 500;

export type PremiumEventPublishGrantInput = {
  eventId: string;
  publishedAt: Date;
  log?: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
};

export const runPremiumEventPublishGrant = async (
  input: PremiumEventPublishGrantInput,
): Promise<void> => {
  const { eventId, publishedAt, log } = input;

  // 1. Load event to get startsAt for the membership filter.
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, startsAt: true },
  });
  if (!event) {
    log?.warn({ eventId }, 'premium_grant.event_not_found');
    return;
  }

  // 2. Pick first grantable tier (canon §F8.7).
  //    Pin tier eligibility to `publishedAt` so a job retried minutes later
  //    still picks the tier that was eligible at publish time. Without this,
  //    salesCloseAt could expire between publish and retry, dropping grants
  //    that should have succeeded.
  const tier = await pickPremiumGrantableTier(prisma, eventId, publishedAt);

  if (!tier) {
    log?.warn({ eventId, reason: 'publish_hook' }, 'premium_grant.no_tier');
    return;
  }

  // 3. Page through active premium members whose period covers the event.
  //    Filter matches spec §4.6 AND-semantics exactly.
  let cursor: string | undefined;
  let totalGranted = 0;
  let totalSkipped = 0;

  while (true) {
    const page = await prisma.premiumMembership.findMany({
      where: {
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { gt: event.startsAt },
      },
      include: { garage: { select: { userId: true } } },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (page.length === 0) break;

    // Process this page in a single inner transaction.
    await prisma.$transaction(async (tx) => {
      for (const membership of page) {
        const userId = membership.garage.userId;

        // Belt-and-braces application-layer check. The partial unique
        // (canon §F8.8) is the real backstop; this skip avoids attempting
        // the insert in the common already-granted case.
        // Scope to source='premium_grant' — a coexisting purchase or comp
        // ticket does NOT block the grant (canon §F8.8 narrowed unique).
        const alreadyHasGrant = await tx.ticket.findFirst({
          where: { userId, eventId, status: 'valid', source: 'premium_grant' },
          select: { id: true },
        });

        if (alreadyHasGrant) {
          totalSkipped += 1;
          continue;
        }

        // SAVEPOINT wrap: P2002 inside the inner tx would otherwise abort
        // the entire $transaction (Postgres state 25P02). ROLLBACK TO
        // SAVEPOINT clears it so the loop continues to the next member.
        await tx.$executeRawUnsafe('SAVEPOINT ticket_insert');
        try {
          await tx.ticket.create({
            data: {
              userId,
              eventId,
              tierId: tier.id,
              source: 'premium_grant',
              status: 'valid',
            },
          });
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT ticket_insert');
          totalGranted += 1;
        } catch (err) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT ticket_insert');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT ticket_insert');
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            // Canon §F8.8: concurrent path already inserted. Continue.
            totalSkipped += 1;
            continue;
          }
          throw err;
        }
      }
    });

    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1]?.id;
  }

  log?.info({ eventId, totalGranted, totalSkipped }, 'premium_grant.publish_hook_complete');
};
