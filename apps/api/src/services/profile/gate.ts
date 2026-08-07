import { createHash } from 'node:crypto';

import { buildIncompleteProfileError, type ProfileScope } from '@ccc/shared/profile-status';
import type { FastifyInstance, FastifyReply } from 'fastify';

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
 * Returns null when the request may proceed. Returns the already-sent reply
 * when it may not, so callers write:
 *
 *   const gated = await enforceProfileGate(app, sub, reply, 'checkout');
 *   if (gated) return gated;
 *
 * MUST be called before any stock reservation, Cart status transition, or
 * payment-provider call. A late block would leave a cart stuck in
 * `checking_out` with tiers reserved for a purchase that cannot complete.
 */
export const enforceProfileGate = async (
  app: FastifyInstance,
  userId: string,
  reply: FastifyReply,
  scope: ProfileScope,
): Promise<FastifyReply | null> => {
  if (!app.env.PROFILE_GATE_ENABLED) return null;
  if (!isInRollout(userId, app.env.PROFILE_GATE_ROLLOUT_PERCENT)) return null;

  const completeness = await loadProfileCompleteness(userId);
  if (!completeness) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'user not found' });
  }

  const missing = missingFor(completeness, scope);
  if (missing.length === 0) return null;

  return reply.status(403).send(buildIncompleteProfileError(missing));
};
