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
 *      same primitive as services/tickets/locks.ts), held for the CLAIM
 *      transaction, so concurrent requests for the SAME order serialise
 *      instead of racing.
 *   2. A deterministic idempotency key passed to Stripe, scoped to
 *      (providerRef, amount). This is the backstop for a request that
 *      reaches Stripe from outside this process's lock entirely (a retried
 *      request from a crashed pod), not the primary guard.
 * The primary guard is neither of those, though: it's `AdminAudit`. Order
 * status cannot be the "already requested" signal here (see above), so the
 * audit row is the only local marker. A second call that acquires the lock
 * after the first committed sees that row and is refused with 409 before ever
 * calling Stripe again.
 *
 * Claim-then-call (fix round 2, IMPORTANT — replaces the round-1 shape). The
 * Stripe HTTP call used to happen INSIDE that transaction. Prisma's default
 * interaction timeout is 5s and packages/db sets no `transactionOptions`, so
 * a Stripe call that was ACCEPTED but answered in more than 5s aborted the
 * transaction with P2028: the audit row rolled back and the operator was
 * shown "a Stripe recusou a solicitação" — false, the money had already
 * moved. The documented next step from that screen is the Stripe dashboard,
 * and a manual refund there carries no idempotency key, so the wrong message
 * produced a real double refund. It also pinned a pool connection and the
 * advisory lock for the whole round-trip.
 *
 * The order is now: claim inside the short locked transaction, call Stripe
 * outside it, then record the outcome on the claimed row.
 *   - Two concurrent requests: the lock serialises them; the loser reads the
 *     committed claim and gets 409 without touching Stripe.
 *   - Crash between claim and settle: the claim stays `stripeStatus:
 *     'pending'` and every later attempt gets 409. That is deliberate — we do
 *     not know whether the money moved, and refusing is the only answer that
 *     cannot double-refund. The operator resolves it at the Stripe dashboard.
 *   - Stripe answered with an error: the claim is settled to `'failed'`,
 *     which does NOT block a retry. A retry is safe on two independent
 *     grounds — the deterministic idempotency key makes Stripe collapse it
 *     into the same refund for 24h, and after that window the
 *     `charge.refunded` webhook has flipped `Order.status` off `paid`, which
 *     this route refuses at the precondition above.
 *
 * Error mapping: a failure of the CLAIM transaction (P2028, pool exhaustion,
 * lock wait) answers 503 `RefundNotAttempted` — nothing was sent to Stripe,
 * and it must never be rendered as a provider rejection. Only a genuine
 * Stripe error answers 502 `RefundFailed`.
 */
import { prisma } from '@ccc/db';
import { adminOrderRefundResponseSchema, adminOrderRefundSchema } from '@ccc/shared/admin';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';

/**
 * Lifecycle of the claim row's `metadata.stripeStatus`:
 *   'pending'  — claimed, Stripe not answered yet (or we crashed before it
 *                did). BLOCKS every later attempt.
 *   'accepted' — Stripe took the refund. BLOCKS every later attempt.
 *   'failed'   — Stripe answered with an error. Does NOT block; see the
 *                claim-then-call note in the file header for why a retry
 *                cannot double-refund.
 */
type ClaimStripeStatus = 'pending' | 'accepted' | 'failed';

const stripeStatusOf = (metadata: unknown): ClaimStripeStatus | undefined => {
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const value = (metadata as { stripeStatus?: unknown }).stripeStatus;
  return value === 'pending' || value === 'accepted' || value === 'failed' ? value : undefined;
};

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

    // ---- Phase 1: claim. Short, locked, no external call inside. ----
    let claim: { kind: 'already_requested' } | { kind: 'claimed'; auditId: string };
    try {
      claim = await prisma.$transaction(async (tx) => {
        // Serialize concurrent refund requests for this exact order. Scope
        // string is namespaced so this lock space cannot collide with
        // services/tickets/locks.ts's (userId, eventId) locks.
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext('admin-refund:' || $1))`,
          order.id,
        );

        const previous = await tx.adminAudit.findMany({
          where: { action: 'order.refund_requested', entityId: order.id },
          select: { id: true, metadata: true },
        });
        // Anything that is not an explicitly recorded Stripe failure blocks:
        // 'pending' (unknown outcome), 'accepted' (done), and legacy rows
        // written before this field existed (no status ⇒ treat as done).
        const blocking = previous.find((row) => stripeStatusOf(row.metadata) !== 'failed');
        if (blocking) return { kind: 'already_requested' as const };

        // Written with the client directly rather than through recordAudit
        // because the outcome write below needs this row's id. Same action /
        // entityType / metadata shape recordAudit would have produced.
        const claimed = await tx.adminAudit.create({
          data: {
            actorId,
            action: 'order.refund_requested',
            entityType: 'order',
            entityId: order.id,
            metadata: {
              reason: input.reason,
              amountCents: order.amountCents,
              providerRef,
              stripeStatus: 'pending' satisfies ClaimStripeStatus,
            },
          },
          select: { id: true },
        });
        return { kind: 'claimed' as const, auditId: claimed.id };
      });
    } catch (err) {
      // NOT a Stripe rejection: this transaction never talks to Stripe. A
      // P2028 interaction timeout, a pool timeout or a lock wait lands here,
      // and the operator must be told nothing was sent — the old code mapped
      // this to 502 and the admin rendered it as "a Stripe recusou".
      request.log.error({ err, orderId: order.id }, 'admin refund: claim transaction failed');
      return reply.status(503).send({
        error: 'RefundNotAttempted',
        message:
          'nao foi possivel registrar a solicitacao; nada foi enviado a Stripe, tente novamente',
      });
    }

    if (claim.kind === 'already_requested') {
      return reply.status(409).send({
        error: 'RefundAlreadyRequested',
        message: 'a refund has already been requested for this order',
      });
    }

    const auditId = claim.auditId;

    // ---- Phase 2: the external call, with no transaction open. ----
    try {
      await app.stripe.refund(
        providerRef,
        input.reason,
        undefined,
        `admin-refund:${providerRef}:${order.amountCents}`,
      );
    } catch (err) {
      // Settle the claim as failed so a retry is possible. If THIS write also
      // fails the claim stays 'pending' and later attempts get 409 — the safe
      // direction, since a stuck claim only costs a dashboard trip while a
      // wrongly-cleared one costs a second refund.
      try {
        await prisma.adminAudit.update({
          where: { id: auditId },
          data: {
            metadata: {
              reason: input.reason,
              amountCents: order.amountCents,
              providerRef,
              stripeStatus: 'failed' satisfies ClaimStripeStatus,
              error: err instanceof Error ? err.message : 'stripe refund request failed',
            },
          },
        });
      } catch (settleErr) {
        request.log.error(
          { err: settleErr, orderId: order.id, auditId },
          'admin refund: could not mark the claim as failed; it stays pending and blocks retries',
        );
      }
      request.log.error({ err, orderId: order.id }, 'admin refund: stripe call failed');
      return reply.status(502).send({
        error: 'RefundFailed',
        message: err instanceof Error ? err.message : 'stripe refund request failed',
      });
    }

    // Stripe accepted. The 202 below is owed to the operator even if this
    // bookkeeping write fails — the money moved either way.
    try {
      await prisma.adminAudit.update({
        where: { id: auditId },
        data: {
          metadata: {
            reason: input.reason,
            amountCents: order.amountCents,
            providerRef,
            stripeStatus: 'accepted' satisfies ClaimStripeStatus,
          },
        },
      });
    } catch (settleErr) {
      request.log.error(
        { err: settleErr, orderId: order.id, auditId },
        'admin refund: stripe accepted but the claim could not be marked accepted',
      );
    }

    return reply
      .status(202)
      .send(adminOrderRefundResponseSchema.parse({ requested: true, provider: 'stripe' }));
  });
};
