import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { runOrderExpiryTick } from '../../src/workers/order-expiry.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('runOrderExpiryTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('expira pedido pendente vencido e cancela a PI', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_vencida',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });

    expect(result.expired).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent')).toHaveLength(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('expired');
  });

  it('nao toca em pedido pendente ainda dentro do prazo', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_viva',
        status: 'pending',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });

    expect(result.expired).toBe(0);
    expect(stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent')).toHaveLength(0);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('pending');
  });

  it('nao toca em pedido ja pago, mesmo com expiresAt no passado', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();

    await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_paga',
        status: 'paid',
        paidAt: new Date(),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });
    expect(result.expired).toBe(0);
  });

  // Pix nao tem PaymentIntent. Cancelar contra a Stripe um ref de AbacatePay
  // seria chamada garantidamente errada.
  it('nao chama a Stripe para pedido de outro provider', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();

    await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: 'bill_abacate',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });
    expect(result.expired).toBe(1);
    expect(result.cancelled).toBe(0);
  });

  // Uma PI que a Stripe ja fechou 400a no cancel. Isso nao pode travar a fila.
  it('continua a varredura quando o cancel de uma PI estoura', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();
    stripe.nextCancelPaymentIntentError = new Error('payment_intent_unexpected_state');

    await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_ruim',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });
    expect(result.expired).toBe(1);
    expect(result.cancelled).toBe(0);
  });
});
