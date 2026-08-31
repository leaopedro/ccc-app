/**
 * preHandler guard for subscription WRITE routes / purchase entry points.
 *
 * Refuses with 403 PlatformNotSupported when `request.subscriptionsEnabled`
 * (set by the platform-gate plugin's onRequest hook, Task 2) is false for
 * the caller's platform. Chain this AFTER the route's existing auth
 * preHandler — it does not replace authentication.
 *
 * Deliberately not applied to routes that let a member manage a
 * subscription they already hold (billing portal, cancel, status,
 * invoices): hiding the buy button does not mean locking out someone who
 * already paid.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

export const requireSubscriptionsEnabled = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  if (request.subscriptionsEnabled) return;
  await reply.status(403).send({
    error: 'PlatformNotSupported',
    message: 'subscriptions are not available on this platform',
  });
};
