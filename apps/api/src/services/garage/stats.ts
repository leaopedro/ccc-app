import type { Prisma, PrismaClient } from '@prisma/client';

import { countAttendedEvents } from './attendance.js';

/** Either the root client or a transaction client — canon §3 (tx composition). */
export type StatsReadClient = PrismaClient | Prisma.TransactionClient;

export type GarageStats = {
  events: number;
  posts: number;
  likesReceived: number;
  joinedAt: string;
};

export class GarageNotFoundError extends Error {
  constructor(garageId: string) {
    super(`garage not found: ${garageId}`);
    this.name = 'GarageNotFoundError';
  }
}

/**
 * Aggregate stats payload for `GET /me/garage` + `GET /g/:slug` (wired by
 * chunk 28+). The `client` parameter accepts either `PrismaClient` or
 * `Prisma.TransactionClient` (canon §3) so callers may compose inside a
 * `$transaction`. Read order:
 *
 *   1. Garage row — provides `userId` (FK for counters), `likesReceived`
 *      (denormalized, §C4), `createdAt` (`joinedAt`).
 *   2. `countAttendedEvents` — DISTINCT events attended, NOT used tickets.
 *      (D1: no `Checkin` model in this repo; attendance lives on `Ticket`.)
 *      A member who brings a guest scans two tickets at one event and that
 *      is one event here. `attendance.ts` owns the definition, shared with
 *      the EVT-* badge rules so the number a member reads on their garage
 *      and the number the badges score can never disagree.
 *   3. FeedPost.count where status='visible' + authorUserId set.
 *
 * `likesReceived` reads the Garage column directly — NEVER aggregated from
 * `FeedReaction` (§C4). No killswitch read (§C5 — serializer gates).
 */
export const getGarageStats = async (
  client: StatsReadClient,
  garageId: string,
): Promise<GarageStats> => {
  const garage = await client.garage.findUnique({
    where: { id: garageId },
    select: { userId: true, likesReceived: true, createdAt: true },
  });
  if (!garage) throw new GarageNotFoundError(garageId);

  const [events, posts] = await Promise.all([
    countAttendedEvents(client, garage.userId),
    client.feedPost.count({ where: { authorUserId: garage.userId, status: 'visible' } }),
  ]);

  return {
    events,
    posts,
    likesReceived: garage.likesReceived,
    joinedAt: garage.createdAt.toISOString(),
  };
};
