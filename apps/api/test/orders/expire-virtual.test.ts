import { prisma, GARAGE_SPOT_PRODUCT_SLUG, GARAGE_SPOT_PRODUCT_TYPE_NAME } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  expireSingleOrder,
  sweepExpiredOrdersForVariant,
} from '../../src/services/orders/expire.js';
import { resetDatabase } from '../helpers.js';

const seedUser = async () =>
  prisma.user.create({
    data: {
      email: `u-${Math.random().toString(36).slice(2, 8)}@test.com`,
      name: 'Test User',
      emailVerifiedAt: new Date(),
    },
  });

const ensureGarageProduct = async () => {
  const pt = await prisma.productType.upsert({
    where: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME },
    update: {},
    create: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME, sortOrder: 99 },
  });
  const product = await prisma.product.upsert({
    where: { slug: GARAGE_SPOT_PRODUCT_SLUG },
    update: {},
    create: {
      slug: GARAGE_SPOT_PRODUCT_SLUG,
      title: 'Vaga de Garagem Adicional',
      description: '-',
      productTypeId: pt.id,
      basePriceCents: 5000,
      currency: 'BRL',
      status: 'active',
      allowPickup: false,
      allowShip: false,
      virtual: true,
      visibleInStore: false,
    },
  });
  let variant = await prisma.variant.findFirst({ where: { productId: product.id } });
  variant ??= await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Padrão',
      priceCents: 5000,
      quantityTotal: 0,
      quantitySold: 0,
      attributes: {},
      active: true,
    },
  });
  return { product, variant };
};

const seedPendingVirtualOrder = async ({
  userId,
  variantId,
  expiresAt,
}: {
  userId: string;
  variantId: string;
  expiresAt: Date;
}) => {
  const cart = await prisma.cart.create({
    data: { userId, status: 'checking_out' },
  });
  const order = await prisma.order.create({
    data: {
      userId,
      cartId: cart.id,
      kind: 'product',
      amountCents: 5000,
      quantity: 1,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      status: 'pending',
      expiresAt,
      fulfillmentMethod: 'virtual',
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      kind: 'product',
      variantId,
      quantity: 1,
      unitPriceCents: 5000,
      subtotalCents: 5000,
    },
  });
  return { cart, order };
};

describe('expire.ts virtual-order coverage (PR #364 review fix)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('expireSingleOrder does not throw for a stale virtual order without a reservation', async () => {
    const user = await seedUser();
    const { variant } = await ensureGarageProduct();
    const { order } = await seedPendingVirtualOrder({
      userId: user.id,
      variantId: variant.id,
      expiresAt: new Date(Date.now() - 1000),
    });

    const before = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });

    const outcome = await expireSingleOrder(order.id, user.id);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.wasExpired).toBe(true);
      expect(outcome.order.status).toBe('expired');
    }

    const after = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
    // Virtual variants never reserve stock; quantitySold must remain unchanged.
    expect(after.quantitySold).toBe(before.quantitySold);
  });

  it('sweepExpiredOrdersForVariant does not throw on a stale virtual order', async () => {
    const user = await seedUser();
    const { variant } = await ensureGarageProduct();
    await seedPendingVirtualOrder({
      userId: user.id,
      variantId: variant.id,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await prisma.$transaction(async (tx) =>
      sweepExpiredOrdersForVariant(variant.id, tx),
    );

    expect(result.count).toBe(1);
  });
});
