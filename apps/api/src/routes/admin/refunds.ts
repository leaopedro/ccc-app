/**
 * Reembolso assistido.
 *
 * Who runs it: the founder, from the admin, with role `admin`. Not the
 * customer, not a cron. Single operator, alerts by email, no paging —
 * docs/observability.md says the same thing about response expectations.
 *
 * What it does NOT do, deliberately: write Order.status. The `charge.refunded`
 * webhook owns that column, and it also revokes the tickets and fans out across
 * the whole cart (routes/stripe-webhook.ts). Writing the status here too would
 * give "was this refunded" two answers that can disagree — the local one and
 * the provider's. 202 means "asked Stripe", not "done".
 *
 * Pix: AbacatePay documents no refund API. We answer 501 and name the manual
 * path rather than pretending.
 *
 * Partial refunds are REFUSED (fix round 1, IMPORTANT — overrides the
 * original design). This route exists to remove Stripe-dashboard trips for
 * the COMMON full-refund case. A partial refund really moves money at
 * Stripe, but stripe-webhook.ts's `charge.refunded` handler deliberately
 * leaves `Order.status` untouched when `amount_refunded < amount` (only a
 * `payment-webhook-partial-refund` Sentry alert fires) — so the 202 this
 * route would return is byte-identical for "done" and "money moved, order
 * will drift until a human reads a Sentry alert". A partial refund stays a
 * deliberate, visible action on the Stripe dashboard instead. `amountCents`
 * stays in the schema (a cleaner shape than removing it) but any value other
 * than the exact order total is rejected with 422.
 *
 * Double-refund guard (fix round 1, CRITICAL). Before this fix there was no
 * idempotency key on the Stripe call, no lock, and — by design — no local
 * status flip to act as a guard: `Order.status` stays `paid` until the async
 * `charge.refunded` webhook lands, often long after this request returns. Two
 * concurrent calls to this route for the same order pass identical
 * preconditions, and for a partial amount that would have meant certain
 * double money movement. Closed two ways:
 *   1. A Postgres advisory lock on the order id (`pg_advisory_xact_lock`,
 *      same primitive as services/tickets/locks.ts), held for the whole
 *      transaction — including the Stripe call — so concurrent requests for
 *      the SAME order serialise instead of racing.
 *   2. A deterministic idempotency key passed to Stripe, scoped to
 *      (providerRef, amount). This is the backstop for a request that
 *      reaches Stripe from outside this process's lock entirely (a retried
 *      request from a crashed pod), not the primary guard.
 * The primary guard is neither of those, though: it's `AdminAudit`. Order
 * status cannot be the "already requested" signal here (see above), so the
 * audit row written inside the SAME locked transaction as the Stripe call is
 * the only local marker. A second call that acquires the lock after the
 * first committed sees that row and is refused with 409 before ever calling
 * Stripe again.
 *
 * Stripe errors are caught and mapped to a clean 502 rather than surfacing as
 * an unhandled 500.
 */
import { prisma } from '@ccc/db';
import { adminOrderRefundResponseSchema, adminOrderRefundSchema } from '@ccc/shared/admin';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';

export const adminRefundRoutes: FastifyPluginAsync = async (app) => {
  app.post('/orders/:id/refund', async (request, reply) => {
    const { sub: actorId } = requireUser(request);
    const { id } = request.params as { id: string };
    const input = adminOrderRefundSchema.parse(request.body);

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, provider: true, providerRef: true, amountCents: true },
    });
    if (!order) return reply.status(404).send({ error: 'NotFound' });

    if (order.provider !== 'stripe') {
      return reply.status(501).send({
        error: 'RefundNotSupported',
        message:
          'AbacatePay nao expoe API de reembolso. O caminho e o suporte do fornecedor, manualmente.',
      });
    }

    if (order.status !== 'paid') {
      return reply.status(422).send({
        error: 'OrderNotRefundable',
        message: `order status is ${order.status}, expected paid`,
      });
    }

    if (!order.providerRef) {
      return reply.status(422).send({
        error: 'OrderNotRefundable',
        message: 'order has no providerRef; refund from the Stripe dashboard',
      });
    }
    const providerRef = order.providerRef;

    if (input.amountCents !== undefined && input.amountCents !== order.amountCents) {
      return reply.status(422).send({
        error: 'PartialRefundNotSupported',
        message:
          'reembolso parcial nao e suportado por este endpoint; use o dashboard da Stripe diretamente',
      });
    }

    let outcome: 'requested' | 'already_requested';
    try {
      outcome = await prisma.$transaction(async (tx) => {
        // Serialize concurrent refund requests for this exact order. Scope
        // string is namespaced so this lock space cannot collide with
        // services/tickets/locks.ts's (userId, eventId) locks.
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('admin-refund:' || $1))`,
          order.id,
        );

        const already = await tx.adminAudit.findFirst({
          where: { action: 'order.refund_requested', entityId: order.id },
          select: { id: true },
        });
        if (already) return 'already_requested' as const;

        await app.stripe.refund(
          providerRef,
          input.reason,
          undefined,
          `admin-refund:${providerRef}:${order.amountCents}`,
        );

        await recordAudit(
          {
            actorId,
            action: 'order.refund_requested',
            entityType: 'order',
            entityId: order.id,
            metadata: {
              reason: input.reason,
              amountCents: order.amountCents,
              providerRef,
            },
          },
          tx,
        );

        return 'requested' as const;
      });
    } catch (err) {
      request.log.error({ err, orderId: order.id }, 'admin refund: stripe call failed');
      return reply.status(502).send({
        error: 'RefundFailed',
        message: err instanceof Error ? err.message : 'stripe refund request failed',
      });
    }

    if (outcome === 'already_requested') {
      return reply.status(409).send({
        error: 'RefundAlreadyRequested',
        message: 'a refund has already been requested for this order',
      });
    }

    return reply
      .status(202)
      .send(adminOrderRefundResponseSchema.parse({ requested: true, provider: 'stripe' }));
  });
};
