import { prisma } from '@ccc/db';
import { incompleteProfileErrorSchema } from '@ccc/shared/profile-status';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { encryptField } from '../../src/services/crypto/field-encryption.js';
import { bearer, createUser, makeAppWithFakes, resetDatabase } from '../helpers.js';

const CPF = '52998224725';
const PHONE = '11987654321';

// Minimal published event + tier + an open cart holding one ticket line.
const seedTicketCart = async (userId: string) => {
  const event = await prisma.event.create({
    data: {
      title: 'Encontro CCC',
      slug: `encontro-${Date.now()}`,
      description: 'Encontro de teste',
      type: 'meeting',
      status: 'published',
      capacity: 100,
      startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000 + 3600 * 1000),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Pista',
      priceCents: 5000,
      currency: 'BRL',
      quantityTotal: 10,
      quantitySold: 0,
      requiresCar: false,
    },
  });
  const cart = await prisma.cart.create({ data: { userId, status: 'open' } });
  await prisma.cartItem.create({
    data: {
      cartId: cart.id,
      kind: 'ticket',
      eventId: event.id,
      tierId: tier.id,
      quantity: 1,
      amountCents: 5000,
      tickets: [{ extras: [] }],
    },
  });
  return { event, tier, cart };
};

describe('checkout profile gate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    process.env.PROFILE_GATE_ENABLED = 'true';
    process.env.PROFILE_GATE_ROLLOUT_PERCENT = '100';
    ({ app } = await makeAppWithFakes());
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  it('blocks POST /cart/checkout with 403 and the standard payload', async () => {
    const { user } = await createUser({ verified: true });
    const { tier, cart } = await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(403);
    const body = incompleteProfileErrorSchema.parse(res.json());
    expect(body.status).toBe('incomplete_profile');
    expect(body.code).toBe('INCOMPLETE_PROFILE');
    expect(body.missing).toEqual(['cpf', 'phone']);

    // Nothing may have moved: this is the whole point of gating early.
    const cartRow = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(cartRow.status).toBe('open');
    const tierRow = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierRow.quantitySold).toBe(0);
    expect(await prisma.order.count({ where: { userId: user.id } })).toBe(0);
  });

  it('reports only phone as missing when the cpf is already set', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { cpf: encryptField(CPF, loadEnv().FIELD_ENCRYPTION_KEY) },
    });
    await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['phone']);
  });

  it('lets the checkout through once cpf and phone are set', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { cpf: encryptField(CPF, loadEnv().FIELD_ENCRYPTION_KEY), phone: PHONE },
    });
    const { tier } = await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
    const tierRow = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierRow.quantitySold).toBe(1);
  });

  it('does not require a document for one-off purchases', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: { cpf: encryptField(CPF, loadEnv().FIELD_ENCRYPTION_KEY), phone: PHONE },
    });
    await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(await prisma.userDocument.count({ where: { userId: user.id } })).toBe(0);
    expect(res.statusCode).toBe(201);
  });

  it('blocks POST /orders', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        quantity: 1,
        method: 'card',
        tickets: [{}],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['cpf', 'phone']);
    const tierRow = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierRow.quantitySold).toBe(0);
  });

  it('blocks POST /orders/checkout', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: {
        eventId: event.id,
        tierId: tier.id,
        quantity: 1,
        method: 'card',
        tickets: [{}],
        successUrl: 'http://localhost:3000/ok',
        cancelUrl: 'http://localhost:3000/cancel',
      },
    });

    expect(res.statusCode).toBe(403);
    const tierRow = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierRow.quantitySold).toBe(0);
  });

  it('is inert when the flag is off', async () => {
    await app.close();
    process.env.PROFILE_GATE_ENABLED = 'false';
    ({ app } = await makeAppWithFakes());

    const { user } = await createUser({ verified: true });
    await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('is inert at 0 percent rollout even with the flag on', async () => {
    await app.close();
    process.env.PROFILE_GATE_ENABLED = 'true';
    process.env.PROFILE_GATE_ROLLOUT_PERCENT = '0';
    ({ app } = await makeAppWithFakes());

    const { user } = await createUser({ verified: true });
    await seedTicketCart(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/cart/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { paymentMethod: 'card' },
    });

    expect(res.statusCode).toBe(201);
  });
});
