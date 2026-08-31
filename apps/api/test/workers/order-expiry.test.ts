import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { runOrderExpiryTick } from '../../src/workers/order-expiry.js';
import { createUser, resetDatabase } from '../helpers.js';

/** Active product + variant with real stock, mirrors test/orders/expire-mixed.test.ts. */
const seedActiveProduct = async (quantityTotal = 10) => {
  const productType = await prisma.productType.create({
    data: { name: `Tipo ${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      slug: `p-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Camiseta',
      description: 'desc',
      productTypeId: productType.id,
      basePriceCents: 9000,
      currency: 'BRL',
      status: 'active',
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'P',
      sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      priceCents: 9000,
      quantityTotal,
      quantitySold: 0,
      attributes: { size: 'P' },
      active: true,
    },
  });
  return { product, variant };
};

describe('runOrderExpiryTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('expira pedido pendente vencido, libera o estoque reservado e cancela a PI', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();
    const { variant } = await seedActiveProduct(10);

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 9000 * 2,
        baseAmountCents: 9000 * 2,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_vencida',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        kind: 'product',
        variantId: variant.id,
        quantity: 2,
        unitPriceCents: 9000,
        subtotalCents: 9000 * 2,
      },
    });
    // Reservation the checkout would have made at add-to-cart/checkout time.
    await prisma.variant.update({
      where: { id: variant.id },
      data: { quantitySold: { increment: 2 } },
    });

    const result = await runOrderExpiryTick({ stripe });

    expect(result.expired).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent')).toHaveLength(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('expired');

    // The half that matters: the worker must actually release the stock it
    // holds, not just flip the Order row.
    const reloadedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(reloadedVariant.quantitySold).toBe(0);
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

  // Uma PI que a Stripe ja fechou 400a no cancel. Isso nao pode travar a fila,
  // nem deixar o proprio pedido que estourou meio-processado, nem impedir que
  // o PROXIMO pedido da fila seja expirado.
  it('continua a varredura quando o cancel de uma PI estoura, sem meio-processar nada', async () => {
    const { user } = await createUser({ verified: true });
    const stripe = buildFakeStripe();
    stripe.nextCancelPaymentIntentError = new Error('payment_intent_unexpected_state');

    // Primeiro na fila (expiresAt mais antigo): a PI dele estoura no cancel.
    const failing = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_ruim',
        status: 'pending',
        expiresAt: new Date(Date.now() - 120_000),
      },
    });

    // Segundo na fila: provider diferente (abacatepay), entao nao depende do
    // cancel da Stripe para provar que foi processado — se o worker parasse
    // no primeiro pedido, este aqui continuaria 'pending'.
    const next = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        baseAmountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
        providerRef: 'bill_seguinte',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await runOrderExpiryTick({ stripe });

    expect(result.expired).toBe(2);
    expect(result.cancelled).toBe(0);
    expect(stripe.calls.filter((c) => c.kind === 'cancelPaymentIntent')).toHaveLength(1);

    // Nao meio-processado: o pedido cujo cancel estourou ainda foi expirado no
    // banco, nao ficou preso em 'pending'.
    const afterFailing = await prisma.order.findUniqueOrThrow({ where: { id: failing.id } });
    expect(afterFailing.status).toBe('expired');

    // Nao travou a fila: o pedido seguinte tambem foi expirado.
    const afterNext = await prisma.order.findUniqueOrThrow({ where: { id: next.id } });
    expect(afterNext.status).toBe('expired');
  });
});
