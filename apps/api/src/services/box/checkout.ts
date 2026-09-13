import { prisma } from '@ccc/db';
import type { BoxCheckoutRequest } from '@ccc/shared/box';
import * as Sentry from '@sentry/node';

import { AbacatePayUpstreamError, type AbacatePayClient } from '../abacatepay/index.js';
import type { StripeClient } from '../stripe/index.js';

const MIN_WINDOW_MS = 60_000;

type Method = BoxCheckoutRequest['method'];

export type CheckoutResult =
  | { kind: 'ok'; method: 'pix'; brCode: string; amountCents: number; expiresAt: string }
  | { kind: 'ok'; method: 'card'; clientSecret: string; amountCents: number; expiresAt: string }
  | { kind: 'not_found' }
  | { kind: 'not_awaiting' }
  | { kind: 'locked' }
  | { kind: 'upstream' };

const monthYear = (cycleKey: string): string => cycleKey.slice(0, 7);

const captureUpstream = (
  err: unknown,
  provider: 'abacatepay' | 'stripe',
  context: Record<string, unknown>,
): void => {
  // A bare `catch {}` used to sit here. A revoked API key, a 422 from a
  // payload-shape change and a genuine provider outage all became the same
  // opaque 502 `payment_provider_error`, with nothing logged anywhere. That
  // made this the hardest of the payment paths to diagnose in production,
  // and Pix has no automatic refund, so a silent failure here is expensive.
  Sentry.withScope((scope) => {
    scope.setTag('kind', 'box-checkout-failed');
    scope.setTag('provider', provider);
    scope.setContext('box', {
      ...context,
      upstreamStatus: err instanceof AbacatePayUpstreamError ? err.status : null,
    });
    Sentry.captureException(err);
  });
};

export const checkoutBoxOrder = async (args: {
  userId: string;
  membershipId: string;
  method: Method;
  abacatepay: AbacatePayClient | null | undefined;
  stripe: StripeClient;
}): Promise<CheckoutResult> => {
  // Phase A: under the Garage lock, validate + short-circuit on an active charge.
  const phaseA = await prisma.$transaction(async (tx) => {
    const boxRef = await tx.monthlyBox.findFirst({
      where: { membershipId: args.membershipId },
      orderBy: { cycleStart: 'desc' },
      select: { id: true, garageId: true },
    });
    if (!boxRef) return { kind: 'not_found' as const };
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${boxRef.garageId} FOR UPDATE`;
    const box = await tx.monthlyBox.findUnique({
      where: { id: boxRef.id },
      select: { id: true, status: true, cutoffAt: true, cycleKey: true, orderId: true },
    });
    if (!box || !box.orderId) return { kind: 'not_found' as const };
    if (box.status !== 'awaiting_payment') return { kind: 'not_awaiting' as const };
    if (box.cutoffAt.getTime() - Date.now() < MIN_WINDOW_MS) return { kind: 'locked' as const };
    const order = await tx.order.findUnique({
      where: { id: box.orderId },
      select: {
        id: true,
        status: true,
        amountCents: true,
        currency: true,
        method: true,
        providerRef: true,
        brCode: true,
      },
    });
    if (!order || order.status !== 'pending') return { kind: 'not_awaiting' as const };

    // Once `providerRef` is stamped we NEVER create another charge. The method
    // locks here: we return whatever already exists, ignoring `args.method`,
    // because AbacatePay has no cancel API and two live charges on one Order is
    // the worst possible outcome.
    //
    // The old guard was `providerRef && brCode`, so a row with a ref and a null
    // brCode fell through to `create` below: a real charge got minted, the
    // stamp failed on `where providerRef: null`, the caller got a misleading
    // 409 `box_locked`, and every retry made another orphan. Hence this outer
    // `if` has no path to `create`.
    if (order.providerRef) {
      if (order.method === 'card') {
        return {
          kind: 'reuse_card' as const,
          providerRef: order.providerRef,
          amountCents: order.amountCents,
          expiresAt: box.cutoffAt.toISOString(),
        };
      }
      if (order.brCode) {
        return {
          kind: 'reuse_pix' as const,
          brCode: order.brCode,
          amountCents: order.amountCents,
          expiresAt: box.cutoffAt.toISOString(),
        };
      }
      // Pix stamped without a brCode: corrupt row. There is nothing to show and
      // creating another charge is not allowed. Alert and fail closed.
      Sentry.captureMessage('box checkout: pix order stamped without brCode', {
        level: 'error',
        tags: { kind: 'box-checkout-corrupt-row' },
        extra: { orderId: order.id, providerRef: order.providerRef },
      });
      return { kind: 'upstream' as const };
    }

    return {
      kind: 'create' as const,
      orderId: order.id,
      boxId: box.id,
      amountCents: order.amountCents,
      currency: order.currency,
      cutoffAt: box.cutoffAt,
      cycleKey: box.cycleKey,
    };
  });

  if (phaseA.kind === 'reuse_pix') {
    return {
      kind: 'ok',
      method: 'pix',
      brCode: phaseA.brCode,
      amountCents: phaseA.amountCents,
      expiresAt: phaseA.expiresAt,
    };
  }

  if (phaseA.kind === 'reuse_card') {
    // The clientSecret never reaches the database, only `providerRef`. Fetching
    // the PI is an HTTP call, so it runs off-lock. Same pattern as the resume
    // branch in routes/orders.ts.
    try {
      const pi = await args.stripe.retrievePaymentIntent(phaseA.providerRef);
      return {
        kind: 'ok',
        method: 'card',
        clientSecret: pi.clientSecret,
        amountCents: phaseA.amountCents,
        expiresAt: phaseA.expiresAt,
      };
    } catch (err) {
      captureUpstream(err, 'stripe', { providerRef: phaseA.providerRef, phase: 'reuse' });
      return { kind: 'upstream' };
    }
  }

  if (phaseA.kind !== 'create') return phaseA;

  // Phase B: create the charge off-lock (external HTTP).
  let providerRef: string;
  let brCode: string | null = null;
  let clientSecret: string | null = null;

  if (args.method === 'card') {
    try {
      const intent = await args.stripe.createPaymentIntent({
        amountCents: phaseA.amountCents,
        currency: phaseA.currency,
        idempotencyKey: phaseA.orderId,
        // Hard deadline: the charge dies at the cutoff. An asynchronous method
        // would settle after it, landing straight in the webhook's refund path.
        paymentMethodTypes: ['card'],
        metadata: {
          orderId: phaseA.orderId,
          boxId: phaseA.boxId,
          userId: args.userId,
        },
      });
      providerRef = intent.id;
      clientSecret = intent.clientSecret;
    } catch (err) {
      captureUpstream(err, 'stripe', {
        orderId: phaseA.orderId,
        boxId: phaseA.boxId,
        amountCents: phaseA.amountCents,
      });
      return { kind: 'upstream' };
    }
  } else {
    if (!args.abacatepay) return { kind: 'upstream' };
    const expiresInSeconds = Math.floor((phaseA.cutoffAt.getTime() - Date.now()) / 1000);
    try {
      const billing = await args.abacatepay.createPixBilling({
        amountCents: phaseA.amountCents,
        description: `Caixa ${monthYear(phaseA.cycleKey)}`,
        expiresInSeconds,
        metadata: { orderId: phaseA.orderId, boxId: phaseA.boxId, userId: args.userId },
      });
      providerRef = billing.id;
      brCode = billing.brCode;
    } catch (err) {
      captureUpstream(err, 'abacatepay', {
        orderId: phaseA.orderId,
        boxId: phaseA.boxId,
        amountCents: phaseA.amountCents,
      });
      return { kind: 'upstream' };
    }
  }

  // Phase C: under the lock again, stamp only if still pending and unstamped.
  // All four columns go in one statement, so no interleaving can separate
  // `providerRef` from `provider`.
  return prisma.$transaction(async (tx) => {
    const boxRow = await tx.monthlyBox.findUnique({
      where: { id: phaseA.boxId },
      select: { garageId: true },
    });
    if (!boxRow) return { kind: 'not_found' as const };
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${boxRow.garageId} FOR UPDATE`;
    const stamped = await tx.order.updateMany({
      where: { id: phaseA.orderId, status: 'pending', providerRef: null },
      data: {
        providerRef,
        brCode,
        method: args.method,
        provider: args.method === 'card' ? 'stripe' : 'abacatepay',
      },
    });
    if (stamped.count === 0) {
      // Either the cutoff worker cancelled between phases, or a concurrent
      // checkout stamped first. Phase A commits WITHOUT stamping, so two
      // requests can both reach here holding real charges. The loser's charge
      // is recorded nowhere: the cutoff worker cancels `ord.providerRef`, which
      // is the winner's. An orphan Pix expires at the cutoff; an orphan PI
      // stays open until Stripe's own expiry. Nobody can pay the orphan (the
      // loser gets a 409 with no brCode and no clientSecret), but it has to be
      // in Sentry to be reconciled.
      Sentry.captureMessage('box checkout: orphaned charge, lost the stamp race', {
        level: 'warning',
        tags: {
          kind: 'box-checkout-orphan',
          provider: args.method === 'card' ? 'stripe' : 'abacatepay',
        },
        extra: { orderId: phaseA.orderId, boxId: phaseA.boxId, orphanRef: providerRef },
      });
      return { kind: 'locked' as const };
    }
    if (args.method === 'card') {
      return {
        kind: 'ok' as const,
        method: 'card' as const,
        clientSecret: clientSecret!,
        amountCents: phaseA.amountCents,
        expiresAt: phaseA.cutoffAt.toISOString(),
      };
    }
    return {
      kind: 'ok' as const,
      method: 'pix' as const,
      brCode: brCode!,
      amountCents: phaseA.amountCents,
      expiresAt: phaseA.cutoffAt.toISOString(),
    };
  });
};
