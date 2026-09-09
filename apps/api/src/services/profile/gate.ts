import { createHash } from 'node:crypto';

import { buildIncompleteProfileError, type ProfileScope } from '@ccc/shared/profile-status';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { loadProfileCompleteness, missingFor } from './completeness.js';

/**
 * Deterministic bucketing by user id. The same user must never see the gate
 * appear and disappear between requests, so the bucket cannot come from a
 * random draw or a request timestamp. Monotonic in `percent`: raising the
 * rollout only ever adds users.
 */
export const isInRollout = (userId: string, percent: number): boolean => {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const bucket = parseInt(createHash('sha1').update(userId).digest('hex').slice(0, 8), 16) % 100;
  return bucket < percent;
};

/**
 * Returns false when the request may proceed. Returns true when it may not,
 * and the 401/403 has ALREADY been sent by then, so callers write:
 *
 *   const blocked = await enforceProfileGate(app, request, sub, reply, 'checkout');
 *   if (blocked) return reply;
 *
 * NEVER change this back to returning the FastifyReply. A reply is a thenable
 * (`Reply.prototype.then`, fastify/lib/reply.js), so an async function that
 * resolves to one gets ADOPTED by the caller's `await`: the awaited value
 * comes back as `undefined`, not as the reply. `if (gated) return gated` then
 * never fires and the handler keeps running past a response it already sent —
 * a 403 checkout that still reserved tier stock, created a pending Order and
 * called Stripe. In CI that surfaced as the `blocks POST /orders` request
 * finishing its order INSERT after the next test had already truncated the
 * tables, failing gate-checkout.test.ts's afterEach with
 * `Foreign key constraint violated on Order_tierId_fkey` (runs 31438051862
 * and 34352280292). A boolean cannot be adopted, so the branch cannot be
 * silently skipped again.
 *
 * The sends are awaited so `true` also means the response has finished: the
 * caller's `return reply` is then a no-op instead of a second send.
 *
 * MUST be called before any stock reservation, Cart status transition, or
 * payment-provider call. A late block would leave a cart stuck in
 * `checking_out` with tiers reserved for a purchase that cannot complete.
 *
 * `request` is threaded through (rather than logging via `app.log`) so the
 * log line carries the request id — the rollout runbook
 * (docs/railway.md:170-176) watches `403 INCOMPLETE_PROFILE / checkout
 * attempts > 40%` at every step of the ladder, and this is the only line
 * that emits it.
 */
export const enforceProfileGate = async (
  app: FastifyInstance,
  request: FastifyRequest,
  userId: string,
  reply: FastifyReply,
  scope: ProfileScope,
): Promise<boolean> => {
  if (!app.env.PROFILE_GATE_ENABLED) return false;
  if (!isInRollout(userId, app.env.PROFILE_GATE_ROLLOUT_PERCENT)) return false;

  const completeness = await loadProfileCompleteness(userId);
  if (!completeness) {
    await reply.status(401).send({ error: 'Unauthorized', message: 'user not found' });
    return true;
  }

  const missing = missingFor(completeness, scope);
  if (missing.length === 0) return false;

  request.log.info({ userId, scope, missing }, 'profile gate blocked');
  await reply.status(403).send(buildIncompleteProfileError(missing));
  return true;
};
