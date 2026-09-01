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
 * amountCents (optional, partial): passed straight through to Stripe. Read
 * stripe-webhook.ts's `charge.refunded` handler before trusting this path for
 * a partial — it deliberately REFUSES to flip status on `amount_refunded <
 * amount`, marks the event processed, and only alerts Sentry
 * (`payment-webhook-partial-refund`). So a partial refund via this route DOES
 * move money at Stripe, but the order stays `paid` locally until a human
 * resolves it. That is the same refusal the webhook already applies to a
 * partial refund issued by hand from the Stripe dashboard; this route does not
 * change or route around it.
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

    await app.stripe.refund(order.providerRef, input.reason, input.amountCents);

    await recordAudit({
      actorId,
      action: 'order.refund_requested',
      entityType: 'order',
      entityId: order.id,
      metadata: {
        reason: input.reason,
        amountCents: input.amountCents ?? order.amountCents,
        providerRef: order.providerRef,
      },
    });

    return reply
      .status(202)
      .send(adminOrderRefundResponseSchema.parse({ requested: true, provider: 'stripe' }));
  });
};
