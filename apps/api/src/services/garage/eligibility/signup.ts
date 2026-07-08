import type { Prisma } from '@prisma/client';

export type BadgeCode = string;

/**
 * Cut-off for the founder badge. UTC, NOT local. The signup hook runs
 * during the create-user transaction; `User.createdAt` here is the row
 * timestamp produced by Postgres.
 *
 * Today is 2026-05-24; the cutoff is one week out (T+8d). After this
 * instant the CCC-003 path will no-op for new users.
 */
export const FOUNDER_CUTOFF = new Date('2026-06-01T00:00:00.000Z');

/**
 * Compute the signup-surface badges a user is eligible for at account
 * creation time. Called from the signup transaction so the founder badge
 * lands in the same tx as the User + Garage rows.
 *
 * Codes:
 *   - CCC-003 — "Fundador" : `User.createdAt` strictly
 *               before `FOUNDER_CUTOFF` (premium-exclusive — the awarder
 *               will gate it; founders without a paid plan get no row,
 *               but if they upgrade later the recompute path can fill it).
 */
export const checkEligibility = (
  _tx: Prisma.TransactionClient,
  _userId: string,
  userCreatedAt: Date,
): BadgeCode[] => {
  const codes: BadgeCode[] = [];
  if (userCreatedAt.getTime() < FOUNDER_CUTOFF.getTime()) {
    codes.push('CCC-003');
  }
  return codes;
};
