import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  expireSingleOrder,
  expireSingleOrderInTransaction,
  sweepExpiredOrdersForTier,
  sweepExpiredOrdersForVariant,
} from '../../src/services/orders/expire.js';
import { resetDatabase } from '../helpers.js';

const seedPublishedEvent = async (quantityTotal = 10) => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento',
      description: 'desc',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      type: 'meeting',
      status: 'published',
      capacity: quantityTotal,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      currency: 'BRL',
      quantityTotal,
      quantitySold: 0,
    },
  });
  return { event, tier };
};

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

const seedUser = async () =>
  prisma.user.create({
    data: {
      email: `u-${Math.random().toString(36).slice(2, 8)}@test.com`,
      name: 'Test User',
      emailVerifiedAt: new Date(),
    },
  });

type SeedMixedOrderArgs = {
  userId: string;
  eventId: string;
  tierId: string;
  variantId: string;
  ticketQuantity: number;
  productQuantity: number;
  expiresAt: Date;
  providerRef?: string | null;
};

const seedMixedPendingOrder = async ({
  userId,
  eventId,
  tierId,
  variantId,
  ticketQuantity,
  productQuantity,
  expiresAt,
  providerRef = null,
}: SeedMixedOrderArgs) => {
  const cart = await prisma.cart.create({
    data: { userId, status: 'checking_out' },
  });
  const order = await prisma.order.create({
    data: {
      userId,
      cartId: cart.id,
      eventId: null,
      tierId: null,
      kind: 'mixed',
      amountCents: 5000 * ticketQuantity + 9000 * productQuantity,
      quantity: ticketQuantity + productQuantity,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      providerRef,
      status: 'pending',
      expiresAt,
      fulfillmentMethod: 'pickup',
    },
  });
  await prisma.orderItem.createMany({
    data: [
      {
        orderId: order.id,
        kind: 'ticket',
        eventId,
        tierId,
        quantity: ticketQuantity,
        unitPriceCents: 5000,
        subtotalCents: 5000 * ticketQuantity,
      },
      {
        orderId: order.id,
        kind: 'product',
        variantId,
        quantity: productQuantity,
        unitPriceCents: 9000,
        subtotalCents: 9000 * productQuantity,
      },
    ],
  });
  await prisma.ticketTier.update({
    where: { id: tierId },
    data: { quantitySold: { increment: ticketQuantity } },
  });
  await prisma.variant.update({
    where: { id: variantId },
    data: { quantitySold: { increment: productQuantity } },
  });
  return { cart, order };
};

describe('expire.ts mixed-order coverage (JDMA-462)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sweepExpiredOrdersForTier releases mixed-order ticket AND product reservations', async () => {
    const user = await seedUser();
    const { event, tier } = await seedPublishedEvent(10);
    const { variant } = await seedActiveProduct(10);

    const { order } = await seedMixedPendingOrder({
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      variantId: variant.id,
      ticketQuantity: 2,
      productQuantity: 3,
      expiresAt: new Date(Date.now() - 1000),
      providerRef: 'pi_mixed_tier_sweep',
    });

    const result = await prisma.$transaction(async (tx) => sweepExpiredOrdersForTier(tier.id, tx));

    expect(result.count).toBe(1);
    expect(result.expiredProviderRefs).toEqual(['pi_mixed_tier_sweep']);

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('expired');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const reloadedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(reloadedVariant.quantitySold).toBe(0);
  });

  it('sweepExpiredOrdersForVariant releases mixed-order product AND ticket reservations', async () => {
    const user = await seedUser();
    const { event, tier } = await seedPublishedEvent(10);
    const { variant } = await seedActiveProduct(10);

    const { order } = await seedMixedPendingOrder({
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      variantId: variant.id,
      ticketQuantity: 2,
      productQuantity: 3,
      expiresAt: new Date(Date.now() - 1000),
      providerRef: 'pi_mixed_variant_sweep',
    });

    const result = await prisma.$transaction(async (tx) =>
      sweepExpiredOrdersForVariant(variant.id, tx),
    );

    expect(result.count).toBe(1);
    expect(result.expiredProviderRefs).toEqual(['pi_mixed_variant_sweep']);

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('expired');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const reloadedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(reloadedVariant.quantitySold).toBe(0);
  });

  it('expireSingleOrder releases mixed-order ticket AND product reservations on lazy expiry', async () => {
    const user = await seedUser();
    const { event, tier } = await seedPublishedEvent(10);
    const { variant } = await seedActiveProduct(10);

    const { order } = await seedMixedPendingOrder({
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      variantId: variant.id,
      ticketQuantity: 1,
      productQuantity: 2,
      expiresAt: new Date(Date.now() - 1000),
      providerRef: 'pi_mixed_lazy',
    });

    const outcome = await expireSingleOrder(order.id, user.id);

    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.wasExpired).toBe(true);
      expect(outcome.order.status).toBe('expired');
    }

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('expired');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const reloadedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(reloadedVariant.quantitySold).toBe(0);
  });

  it('expireSingleOrder does not release reservations when the pending update loses a race', async () => {
    const staleOrder = {
      id: 'ord_race',
      userId: 'user_race',
      tierId: null,
      kind: 'mixed',
      status: 'pending',
      expiresAt: new Date(Date.now() - 1000),
      amountCents: 23_000,
      currency: 'BRL',
      provider: 'stripe' as const,
      providerRef: 'pi_race',
    };
    const refreshedOrder = {
      ...staleOrder,
      status: 'paid',
      expiresAt: null,
    };

    const releaseTouch = vi.fn(() => Promise.resolve([]));
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const outcome = await expireSingleOrderInTransaction(
      {
        order: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(staleOrder)
            .mockResolvedValueOnce(refreshedOrder),
          updateMany,
        },
        orderItem: { findMany: releaseTouch },
        orderExtra: { findMany: releaseTouch },
        ticketTier: { updateMany: releaseTouch },
        variant: { updateMany: releaseTouch },
        ticketExtra: { updateMany: releaseTouch },
      } as never,
      staleOrder.id,
      staleOrder.userId,
    );

    expect(updateMany).toHaveBeenCalledOnce();
    expect(releaseTouch).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: 'ok',
      wasExpired: false,
      order: refreshedOrder,
    });
  });

  it('sweepExpiredOrdersForTier fails explicitly when reserved quantity is already below the release amount', async () => {
    const user = await seedUser();
    const { event, tier } = await seedPublishedEvent(10);
    const { variant } = await seedActiveProduct(10);

    const { order } = await seedMixedPendingOrder({
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      variantId: variant.id,
      ticketQuantity: 2,
      productQuantity: 3,
      expiresAt: new Date(Date.now() - 1000),
      providerRef: 'pi_mixed_underflow',
    });

    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    await expect(
      prisma.$transaction((tx) => sweepExpiredOrdersForTier(tier.id, tx)),
    ).rejects.toThrow(/reservation release/i);

    const reloadedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.status).toBe('pending');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(1);

    const reloadedVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(reloadedVariant.quantitySold).toBe(3);
  });
});
