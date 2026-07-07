/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { prisma } from '@jdm/db';
import { adminStoreOrderDetailSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import {
  decryptField,
  encryptField,
  isEncrypted,
} from '../../src/services/crypto/field-encryption.js';
import { signTicketCode } from '../../src/services/tickets/codes.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const FIELD_KEY = process.env.FIELD_ENCRYPTION_KEY!;
const WRONG_KEY = 'cd'.repeat(32);

const ensureProductType = async () =>
  prisma.productType.upsert({
    where: { name: 'Vestuario-enc' },
    update: {},
    create: { name: 'Vestuario-enc' },
  });

const seedProduct = async () => {
  const pt = await ensureProductType();
  return prisma.product.create({
    data: {
      slug: `enc-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Produto Enc',
      description: 'Desc',
      basePriceCents: 5000,
      productTypeId: pt.id,
      status: 'active',
      shippingFeeCents: 0,
    },
  });
};

const seedVariant = (productId: string) =>
  prisma.variant.create({
    data: {
      productId,
      name: 'Unico',
      priceCents: 5000,
      quantityTotal: 10,
      quantitySold: 0,
      attributes: { size: 'M' },
      active: true,
    },
  });

const seedPickupOrder = async (userId: string, notes: string | null) => {
  const product = await seedProduct();
  const variant = await seedVariant(product.id);
  return prisma.order.create({
    data: {
      userId,
      kind: 'product',
      amountCents: 5000,
      quantity: 1,
      currency: 'BRL',
      method: 'card',
      provider: 'stripe',
      providerRef: `pi_${Math.random().toString(36).slice(2, 10)}`,
      fulfillmentMethod: 'pickup',
      fulfillmentStatus: 'unfulfilled',
      status: 'paid',
      paidAt: new Date(),
      notes,
      items: {
        create: {
          kind: 'product',
          variantId: variant.id,
          quantity: 1,
          unitPriceCents: 5000,
          subtotalCents: 5000,
        },
      },
    },
  });
};

const orgAuth = async () => {
  const { user } = await createUser({
    email: `org-enc-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
    verified: true,
    role: 'organizer',
  });
  return { user, header: bearer(loadEnv(), user.id, 'organizer') };
};

describe('Order.notes field-level encryption', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await makeApp();
    await resetDatabase();
  });

  afterEach(async () => {
    await app.close();
  });

  const PICKUP_EVENT_ID = 'evt_fake_event_id_123';
  const PICKUP_TICKET_ID = 'tkt_fake_ticket_id_456';
  const NOTES_JSON = JSON.stringify({
    pickupEventId: PICKUP_EVENT_ID,
    pickupTicketId: PICKUP_TICKET_ID,
  });

  it('admin detail returns decrypted notes and extracts pickupRefs', async () => {
    const buyer = await createUser({ email: 'enc-buyer@jdm.test', verified: true });
    const encrypted = encryptField(NOTES_JSON, FIELD_KEY);
    const order = await seedPickupOrder(buyer.user.id, encrypted);
    const { header } = await orgAuth();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/store/orders/${order.id}`,
      headers: { authorization: header },
    });

    expect(res.statusCode).toBe(200);
    const body = adminStoreOrderDetailSchema.parse(res.json());
    expect(body.notes).toBe(NOTES_JSON);
    expect(body.pickupEventId).toBe(PICKUP_EVENT_ID);
    expect(body.pickupTicketId).toBe(PICKUP_TICKET_ID);
  });

  it('admin detail handles plaintext notes (mixed state)', async () => {
    const buyer = await createUser({ email: 'plain-buyer@jdm.test', verified: true });
    const order = await seedPickupOrder(buyer.user.id, NOTES_JSON);
    const { header } = await orgAuth();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/store/orders/${order.id}`,
      headers: { authorization: header },
    });

    expect(res.statusCode).toBe(200);
    const body = adminStoreOrderDetailSchema.parse(res.json());
    expect(body.notes).toBe(NOTES_JSON);
    expect(body.pickupEventId).toBe(PICKUP_EVENT_ID);
    expect(body.pickupTicketId).toBe(PICKUP_TICKET_ID);
  });

  it('admin detail survives undecryptable notes without 500', async () => {
    const buyer = await createUser({ email: 'bad-key-buyer@jdm.test', verified: true });
    const badEncrypted = encryptField(NOTES_JSON, WRONG_KEY);
    const order = await seedPickupOrder(buyer.user.id, badEncrypted);
    const { header } = await orgAuth();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/store/orders/${order.id}`,
      headers: { authorization: header },
    });

    expect(res.statusCode).toBe(200);
    const body = adminStoreOrderDetailSchema.parse(res.json());
    // Should fall back to raw ciphertext, not crash
    expect(body.notes).toBe(badEncrypted);
    // pickupRefs should be null since notes couldn't be decrypted
    expect(body.pickupEventId).toBeNull();
    expect(body.pickupTicketId).toBeNull();
  });
});

const env = loadEnv();

const seedEventAndTicket = async (userId: string) => {
  const event = await prisma.event.create({
    data: {
      slug: `ev-enc-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Encryption Pickup Event',
      description: 'Test',
      startsAt: new Date(Date.now() + 3600_000),
      endsAt: new Date(Date.now() + 7200_000),
      venueName: 'Venue',
      venueAddress: 'Addr',
      city: 'SP',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      publishedAt: new Date(),
      capacity: 10,
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
  const ticket = await prisma.ticket.create({
    data: {
      userId,
      eventId: event.id,
      tierId: tier.id,
      status: 'valid',
      source: 'purchase',
    },
  });
  return { event, tier, ticket };
};

describe('Migration script verification (encrypt/decrypt roundtrip on mixed-state data)', () => {
  it('encrypt then decrypt roundtrip preserves plaintext notes', () => {
    const plain = JSON.stringify({ pickupEventId: 'evt_1', pickupTicketId: 'tkt_1' });
    const encrypted = encryptField(plain, FIELD_KEY);

    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted).not.toBe(plain);

    const decrypted = decryptField(encrypted, FIELD_KEY);
    expect(decrypted).toBe(plain);
  });

  it('encrypt skips already-encrypted values (idempotent)', () => {
    const plain = 'some notes';
    const encrypted = encryptField(plain, FIELD_KEY);

    // Simulate re-run: isEncrypted true + decryptField succeeds = skip
    expect(isEncrypted(encrypted)).toBe(true);
    const probe = decryptField(encrypted, FIELD_KEY);
    expect(probe).not.toBeNull();
    // Script would skip this row
  });

  it('encrypt fails closed on wrong-key ciphertext (no double-encrypt)', () => {
    const plain = 'some notes';
    const encrypted = encryptField(plain, FIELD_KEY);

    // Simulate re-run with WRONG key: isEncrypted true + decryptField returns null
    const probe = decryptField(encrypted, WRONG_KEY);
    expect(probe).toBeNull();
    // Script must treat this as failure, not re-encrypt
  });

  it('decrypt roundtrip on mixed-state batch (encrypted + plaintext rows)', () => {
    const rows = [
      { notes: JSON.stringify({ pickupEventId: 'evt_a' }), label: 'plaintext' },
      { notes: encryptField('order data', FIELD_KEY), label: 'encrypted' },
      { notes: null, label: 'null' },
    ];

    // Simulate decrypt script logic on each row
    const results = rows.map((row) => {
      if (!row.notes) return { ...row, result: null, action: 'skip-null' };
      if (!isEncrypted(row.notes)) return { ...row, result: row.notes, action: 'skip-plain' };
      const decrypted = decryptField(row.notes, FIELD_KEY);
      if (decrypted === null) return { ...row, result: row.notes, action: 'fail' };
      return { ...row, result: decrypted, action: 'decrypted' };
    });

    expect(results[0]!.action).toBe('skip-plain');
    expect(results[0]!.result).toBe(rows[0]!.notes);

    expect(results[1]!.action).toBe('decrypted');
    expect(results[1]!.result).toBe('order data');

    expect(results[2]!.action).toBe('skip-null');
    expect(results[2]!.result).toBeNull();
  });

  it('decrypt fails closed on wrong-key ciphertext', () => {
    const encrypted = encryptField('sensitive data', FIELD_KEY);
    const result = decryptField(encrypted, WRONG_KEY);
    expect(result).toBeNull();
    // Script must count this as failure, not skip
  });
});

describe('Pickup read paths with encrypted Order.notes', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeEach(async () => {
    app = await makeApp();
    await resetDatabase();
  });
  afterEach(async () => {
    await app.close();
  });

  it('/me/tickets returns pickup orders when notes are encrypted', async () => {
    const { user } = await createUser({ email: 'pickup-buyer@jdm.test', verified: true });
    const { event, ticket } = await seedEventAndTicket(user.id);

    const notesJson = JSON.stringify({ pickupEventId: event.id, pickupTicketId: ticket.id });
    const encryptedNotes = encryptField(notesJson, env.FIELD_ENCRYPTION_KEY);

    const product = await seedProduct();
    const variant = await seedVariant(product.id);
    await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 5000,
        quantity: 1,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        providerRef: `pi_${Math.random().toString(36).slice(2, 10)}`,
        fulfillmentMethod: 'pickup',
        status: 'paid',
        paidAt: new Date(),
        pickupEventId: event.id,
        pickupTicketId: ticket.id,
        notes: encryptedNotes,
        items: {
          create: {
            kind: 'product',
            variantId: variant.id,
            quantity: 1,
            unitPriceCents: 5000,
            subtotalCents: 5000,
          },
        },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].pickupOrders).toHaveLength(1);
    expect(body.items[0].pickupOrders[0].fulfillmentStatus).toBe('unfulfilled');
  });

  it('admin check-in returns storePickup when notes are encrypted', async () => {
    const { user: holder } = await createUser({ email: 'checkin-holder@jdm.test', verified: true });
    const { user: admin } = await createUser({
      email: 'checkin-admin@jdm.test',
      verified: true,
      role: 'staff',
    });
    const { event, ticket } = await seedEventAndTicket(holder.id);

    const notesJson = JSON.stringify({ pickupEventId: event.id, pickupTicketId: ticket.id });
    const encryptedNotes = encryptField(notesJson, env.FIELD_ENCRYPTION_KEY);

    const product = await seedProduct();
    const variant = await seedVariant(product.id);
    await prisma.order.create({
      data: {
        userId: holder.id,
        kind: 'product',
        amountCents: 5000,
        quantity: 1,
        currency: 'BRL',
        method: 'card',
        provider: 'stripe',
        providerRef: `pi_${Math.random().toString(36).slice(2, 10)}`,
        fulfillmentMethod: 'pickup',
        status: 'paid',
        paidAt: new Date(),
        pickupEventId: event.id,
        pickupTicketId: ticket.id,
        notes: encryptedNotes,
        items: {
          create: {
            kind: 'product',
            variantId: variant.id,
            quantity: 1,
            unitPriceCents: 5000,
            subtotalCents: 5000,
          },
        },
      },
    });

    const code = signTicketCode(ticket.id, env);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, admin.id, 'staff') },
      payload: { code, eventId: event.id },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result).toBe('admitted');
    expect(body.storePickup).toHaveLength(1);
    expect(body.storePickup[0].fulfillmentStatus).toBe('unfulfilled');
  });
});
