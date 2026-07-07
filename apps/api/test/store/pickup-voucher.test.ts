import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { signQrCode } from '../../src/lib/qr.js';
import { assignEventPickupTicket } from '../../src/services/store/event-pickup.js';
import {
  claimPickupVoucher,
  InvalidVoucherCodeError,
  mintPickupVouchersForOrderTx,
  VoucherNotFoundError,
  VoucherRevokedError,
  VoucherWrongEventError,
} from '../../src/services/store/pickup-voucher.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const createEvent = async (title = 'Voucher Event') => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title,
      description: 'd',
      startsAt: new Date(Date.now() + 3600_000),
      endsAt: new Date(Date.now() + 7200_000),
      venueName: 'V',
      venueAddress: 'A',
      city: 'SP',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: 10,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'GA',
      priceCents: 1000,
      quantityTotal: 10,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  return { event, tier };
};

const createProductWithVariant = async () => {
  const productType = await prisma.productType.create({
    data: { name: `PT-${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      productTypeId: productType.id,
      slug: `p-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Camiseta JDM',
      description: 'd',
      basePriceCents: 9000,
      status: 'active',
      allowPickup: true,
      allowShip: false,
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Tamanho M / Preta',
      sku: 'TS-M-PT',
      priceCents: 9000,
      quantityTotal: 10,
      quantitySold: 1,
      attributes: { tamanho: 'M', cor: 'Preta' },
    },
  });
  return { product, variant };
};

const createPaidPickupOrder = async (
  userId: string,
  eventId: string,
  variantId: string,
  qty: number,
) => {
  const order = await prisma.order.create({
    data: {
      userId,
      kind: 'product',
      amountCents: 9000 * qty,
      quantity: qty,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      fulfillmentMethod: 'pickup',
      status: 'paid',
      paidAt: new Date(),
      pickupEventId: eventId,
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      kind: 'product',
      variantId,
      quantity: qty,
      unitPriceCents: 9000,
      subtotalCents: 9000 * qty,
    },
  });
  return order;
};

const createValidTicket = async (userId: string, eventId: string, tierId: string) =>
  prisma.ticket.create({
    data: { userId, eventId, tierId, status: 'valid', source: 'purchase' },
  });

describe('pickup voucher mint + claim', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('mints one voucher per product unit when assignEventPickupTicket runs', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    const ticket = await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 3);

    const assignedId = await assignEventPickupTicket(order.id, env);
    expect(assignedId).toBe(ticket.id);

    const vouchers = await prisma.pickupVoucher.findMany({ where: { orderId: order.id } });
    expect(vouchers).toHaveLength(3);
    for (const v of vouchers) {
      expect(v.status).toBe('valid');
      expect(v.ticketId).toBe(ticket.id);
      expect(v.eventId).toBe(event.id);
      expect(v.variantId).toBe(variant.id);
      expect(v.code).toMatch(/^v\./);
    }
  });

  it('is idempotent: rerunning assignEventPickupTicket does not duplicate vouchers', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 2);

    await assignEventPickupTicket(order.id, env);
    await assignEventPickupTicket(order.id, env);

    const vouchers = await prisma.pickupVoucher.findMany({ where: { orderId: order.id } });
    expect(vouchers).toHaveLength(2);
  });

  it('serializes vouchers on /me/tickets for the bound ticket owner', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 2);
    await assignEventPickupTicket(order.id, env);

    const res = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      items: Array<{
        pickupVouchers: Array<{
          id: string;
          code: string;
          status: string;
          productTitle: string | null;
          variantName: string | null;
          orderId: string;
          orderShortId: string;
        }>;
      }>;
    }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.pickupVouchers).toHaveLength(2);
    for (const v of body.items[0]!.pickupVouchers) {
      expect(v.status).toBe('valid');
      expect(v.productTitle).toBe('Camiseta JDM');
      expect(v.variantName).toBe('Tamanho M / Preta');
      expect(v.orderId).toBe(order.id);
      expect(v.code).toMatch(/^v\./);
    }
  });

  it('claims a valid voucher, returning product + variant details', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 1);
    await assignEventPickupTicket(order.id, env);
    const voucher = await prisma.pickupVoucher.findFirstOrThrow({ where: { orderId: order.id } });

    const { user: staff } = await createUser({
      email: 's@jdm.test',
      verified: true,
      role: 'staff',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/store/pickup/voucher/claim',
      headers: { authorization: bearer(env, staff.id, 'staff') },
      payload: { code: voucher.code, eventId: event.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      result: string;
      voucher: {
        id: string;
        status: string;
        product: { title: string; variantName: string; variantAttributes: Record<string, string> };
        holder: { id: string; name: string };
        ticket: { id: string; tier: { name: string } };
      };
    }>();
    expect(body.result).toBe('claimed');
    expect(body.voucher.status).toBe('used');
    expect(body.voucher.product.title).toBe('Camiseta JDM');
    expect(body.voucher.product.variantName).toBe('Tamanho M / Preta');
    expect(body.voucher.product.variantAttributes).toEqual({ tamanho: 'M', cor: 'Preta' });
    expect(body.voucher.holder.id).toBe(user.id);
    expect(body.voucher.ticket.tier.name).toBe(tier.name);
  });

  it('idempotent claim: returns already_used on second scan', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 1);
    await assignEventPickupTicket(order.id, env);
    const voucher = await prisma.pickupVoucher.findFirstOrThrow({ where: { orderId: order.id } });
    const { user: staff } = await createUser({
      email: 's2@jdm.test',
      verified: true,
      role: 'staff',
    });
    const auth = { authorization: bearer(env, staff.id, 'staff') };

    await app.inject({
      method: 'POST',
      url: '/admin/store/pickup/voucher/claim',
      headers: auth,
      payload: { code: voucher.code, eventId: event.id },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/store/pickup/voucher/claim',
      headers: auth,
      payload: { code: voucher.code, eventId: event.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ result: string }>().result).toBe('already_used');

    const audits = await prisma.adminAudit.findMany({
      where: { action: 'store.pickup_voucher.claim' },
    });
    expect(audits).toHaveLength(1);
  });

  it('rejects voucher code for the wrong event', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent('Voucher A');
    const other = await createEvent('Voucher B');
    const { variant } = await createProductWithVariant();
    await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 1);
    await assignEventPickupTicket(order.id, env);
    const voucher = await prisma.pickupVoucher.findFirstOrThrow({ where: { orderId: order.id } });

    await expect(
      claimPickupVoucher(
        { code: voucher.code, eventId: other.event.id, actorUserId: user.id },
        env,
      ),
    ).rejects.toBeInstanceOf(VoucherWrongEventError);
  });

  it('rejects a ticket QR (wrong kind)', async () => {
    const { event } = await createEvent();
    const ticketCode = signQrCode('t', 'whatever', env);
    await expect(
      claimPickupVoucher({ code: ticketCode, eventId: event.id, actorUserId: 'x' }, env),
    ).rejects.toBeInstanceOf(InvalidVoucherCodeError);
  });

  it('returns VoucherNotFoundError for an orphan signed voucher code', async () => {
    const { event } = await createEvent();
    const orphan = signQrCode('v', 'no-such-voucher', env);
    await expect(
      claimPickupVoucher({ code: orphan, eventId: event.id, actorUserId: 'x' }, env),
    ).rejects.toBeInstanceOf(VoucherNotFoundError);
  });

  it('blocks claim of revoked voucher', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 1);
    await assignEventPickupTicket(order.id, env);
    const voucher = await prisma.pickupVoucher.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.pickupVoucher.update({
      where: { id: voucher.id },
      data: { status: 'revoked' },
    });
    await expect(
      claimPickupVoucher({ code: voucher.code, eventId: event.id, actorUserId: user.id }, env),
    ).rejects.toBeInstanceOf(VoucherRevokedError);
  });

  it('checking in the ticket does not change voucher state', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    const ticket = await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 2);
    await assignEventPickupTicket(order.id, env);

    // simulate ticket check-in: mark ticket used directly
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'used', usedAt: new Date() },
    });

    const vouchers = await prisma.pickupVoucher.findMany({ where: { orderId: order.id } });
    expect(vouchers).toHaveLength(2);
    for (const v of vouchers) {
      expect(v.status).toBe('valid');
      expect(v.usedAt).toBeNull();
    }
  });

  // Direct mint helper coverage to guard the txn-callable path independently.
  it('mintPickupVouchersForOrderTx is idempotent and preserves existing voucher state', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    const ticket = await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 3);

    await prisma.$transaction(async (tx) => {
      const minted = await mintPickupVouchersForOrderTx(order.id, ticket.id, event.id, tx, env);
      expect(minted).toHaveLength(3);
    });

    const all = await prisma.pickupVoucher.findMany({ where: { orderId: order.id } });
    expect(all).toHaveLength(3);
    await prisma.pickupVoucher.update({
      where: { id: all[0]!.id },
      data: { status: 'revoked' },
    });

    // Re-running mint must not duplicate rows and must not overwrite the
    // revoked unit's status.
    await prisma.$transaction(async (tx) => {
      await mintPickupVouchersForOrderTx(order.id, ticket.id, event.id, tx, env);
    });

    const after = await prisma.pickupVoucher.findMany({
      where: { orderId: order.id },
      orderBy: { unitIndex: 'asc' },
    });
    expect(after).toHaveLength(3);
    expect(after.filter((v) => v.status === 'revoked')).toHaveLength(1);
    expect(after.filter((v) => v.status === 'valid')).toHaveLength(2);
  });

  it('rejects non-staff user attempting admin voucher claim (403)', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 1);
    await assignEventPickupTicket(order.id, env);
    const voucher = await prisma.pickupVoucher.findFirstOrThrow({ where: { orderId: order.id } });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/store/pickup/voucher/claim',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { code: voucher.code, eventId: event.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('race-safe: concurrent mint calls never over-mint beyond quantity', async () => {
    const { user } = await createUser({ email: `o-${Math.random()}@jdm.test`, verified: true });
    const { event, tier } = await createEvent();
    const { variant } = await createProductWithVariant();
    const ticket = await createValidTicket(user.id, event.id, tier.id);
    const order = await createPaidPickupOrder(user.id, event.id, variant.id, 4);

    // Simulate two concurrent Stripe handlers (payment_intent.succeeded +
    // checkout.session.completed) racing to settle the same order.
    const runMint = () =>
      prisma.$transaction(async (tx) =>
        mintPickupVouchersForOrderTx(order.id, ticket.id, event.id, tx, env),
      );

    await Promise.all([runMint(), runMint(), runMint()]);

    const all = await prisma.pickupVoucher.findMany({
      where: { orderId: order.id },
      orderBy: { unitIndex: 'asc' },
    });
    expect(all).toHaveLength(4);
    expect(all.map((v) => v.unitIndex)).toEqual([0, 1, 2, 3]);
    const codes = new Set(all.map((v) => v.code));
    expect(codes.size).toBe(4);
  });
});
