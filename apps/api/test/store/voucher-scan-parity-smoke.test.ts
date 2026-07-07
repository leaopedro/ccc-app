import { prisma } from '@jdm/db';
import { myTicketsResponseSchema } from '@jdm/shared/tickets';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { assignEventPickupTicket } from '../../src/services/store/event-pickup.js';
import { signTicketCode } from '../../src/services/tickets/codes.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const dump = (label: string, value: unknown) => {
  // Smoke evidence: print the JSON the mobile client renders and the admin
  // claim/check-in responses so the reviewer can confirm voucher render,
  // voucher scan, and ticket-scan parity without a device run.

  console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);
};

const seedEventWithTier = async () => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Encontro Pickup Smoke',
      description: 'Smoke event',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      venueName: 'Autódromo',
      venueAddress: 'Av Pista 1',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      publishedAt: new Date(),
      capacity: 100,
      maxTicketsPerUser: 5,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Pista',
      priceCents: 8_000,
      currency: 'BRL',
      quantityTotal: 100,
    },
  });
  return { event, tier };
};

const seedVariant = async () => {
  const productType = await prisma.productType.create({
    data: { name: `Merch ${Math.random().toString(36).slice(2, 6)}` },
  });
  const product = await prisma.product.create({
    data: {
      slug: `produto-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Camiseta JDM',
      description: 'Algodão pesado',
      productTypeId: productType.id,
      basePriceCents: 12_000,
      currency: 'BRL',
      status: 'active',
      allowPickup: true,
      allowShip: false,
      shippingFeeCents: 0,
    },
  });
  return prisma.variant.create({
    data: {
      productId: product.id,
      name: 'Tamanho M / Preta',
      sku: `SKU-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      priceCents: 12_000,
      quantityTotal: 20,
      attributes: { tamanho: 'M', cor: 'Preta' },
      active: true,
    },
  });
};

describe('JDMA-540 voucher render + voucher scan + ticket-scan parity smoke (no-device evidence)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('end-to-end: render two vouchers, scan one voucher (other stays valid), scan ticket (vouchers untouched), scan second voucher (ticket untouched)', async () => {
    // ── Seed ──────────────────────────────────────────────────────────
    const { user } = await createUser({
      email: `holder-${Math.random()}@jdm.test`,
      verified: true,
    });
    const { user: staff } = await createUser({
      email: `staff-${Math.random()}@jdm.test`,
      verified: true,
      role: 'staff',
    });
    const { event, tier } = await seedEventWithTier();
    const variant = await seedVariant();

    // Bound ticket that the pickup order will attach to. Pickup is purchased
    // separately from the ticket — the bind happens in
    // assignEventPickupTicket().
    const ticket = await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    const pickup = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'product',
        amountCents: 24_000,
        currency: 'BRL',
        quantity: 2,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date(),
        fulfillmentMethod: 'pickup',
        fulfillmentStatus: 'unfulfilled',
        pickupEventId: event.id,
        items: {
          create: [
            {
              kind: 'product',
              variantId: variant.id,
              quantity: 2,
              unitPriceCents: 12_000,
              subtotalCents: 24_000,
            },
          ],
        },
      },
    });

    const assignedTicketId = await assignEventPickupTicket(pickup.id, env);
    expect(assignedTicketId).toBe(ticket.id);

    const mintedVouchers = await prisma.pickupVoucher.findMany({
      where: { orderId: pickup.id },
      orderBy: { unitIndex: 'asc' },
    });
    expect(mintedVouchers).toHaveLength(2);
    for (const v of mintedVouchers) {
      expect(v.status).toBe('valid');
      expect(v.code).toMatch(/^v\./);
    }

    // ── Stage 1: Voucher render on /me/tickets ────────────────────────
    const ticketsBefore = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(ticketsBefore.statusCode).toBe(200);
    const tBefore = myTicketsResponseSchema.parse(ticketsBefore.json());
    const ticketRowBefore = tBefore.items.find((t) => t.id === ticket.id);
    expect(ticketRowBefore?.pickupVouchers).toHaveLength(2);
    for (const v of ticketRowBefore!.pickupVouchers) {
      expect(v.status).toBe('valid');
      expect(v.code).toMatch(/^v\./);
      expect(v.productTitle).toBe('Camiseta JDM');
      expect(v.variantName).toBe('Tamanho M / Preta');
      expect(v.orderId).toBe(pickup.id);
    }
    dump('stage-1 /me/tickets — voucher render (both valid, QR codes signed)', {
      ticketId: ticketRowBefore!.id,
      pickupVouchers: ticketRowBefore!.pickupVouchers.map((v) => ({
        id: v.id,
        status: v.status,
        code: v.code,
        productTitle: v.productTitle,
        variantName: v.variantName,
        orderId: v.orderId,
        orderShortId: v.orderShortId,
      })),
    });

    // ── Stage 2: Admin scans voucher #1 ───────────────────────────────
    const firstVoucher = mintedVouchers[0]!;
    const claim1 = await app.inject({
      method: 'POST',
      url: '/admin/store/pickup/voucher/claim',
      headers: { authorization: bearer(env, staff.id, 'staff') },
      payload: { code: firstVoucher.code, eventId: event.id },
    });
    expect(claim1.statusCode).toBe(200);
    const claim1Body = claim1.json<{
      result: string;
      voucher: { id: string; status: string; product: { title: string; variantName: string } };
    }>();
    expect(claim1Body.result).toBe('claimed');
    expect(claim1Body.voucher.status).toBe('used');
    expect(claim1Body.voucher.product.title).toBe('Camiseta JDM');
    dump('stage-2 POST /admin/store/pickup/voucher/claim — voucher scan #1', claim1Body);

    // Voucher #2 must still be `valid` after voucher #1 is claimed.
    const afterClaim1 = await prisma.pickupVoucher.findMany({
      where: { orderId: pickup.id },
      orderBy: { unitIndex: 'asc' },
    });
    expect(afterClaim1[0]!.status).toBe('used');
    expect(afterClaim1[1]!.status).toBe('valid');

    const ticketAfterClaim1 = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(ticketAfterClaim1.status).toBe('valid');
    expect(ticketAfterClaim1.usedAt).toBeNull();
    dump('stage-2 parity check — ticket untouched after voucher #1 claim', {
      ticket: { id: ticketAfterClaim1.id, status: ticketAfterClaim1.status },
      vouchers: afterClaim1.map((v) => ({ id: v.id, unitIndex: v.unitIndex, status: v.status })),
    });

    // ── Stage 3: Admin scans the bound ticket QR ──────────────────────
    const ticketCode = signTicketCode(ticket.id, env);
    const ticketScan = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, staff.id, 'staff') },
      payload: { code: ticketCode, eventId: event.id },
    });
    expect(ticketScan.statusCode).toBe(200);
    const ticketScanBody = ticketScan.json<{
      result: string;
      ticket: { id: string; status: string };
    }>();
    expect(ticketScanBody.result).toBe('admitted');
    expect(ticketScanBody.ticket.status).toBe('used');
    dump('stage-3 POST /admin/tickets/check-in — ticket scan (parity)', ticketScanBody);

    // Critical parity claim: ticket check-in must NOT touch voucher state.
    const afterTicketScan = await prisma.pickupVoucher.findMany({
      where: { orderId: pickup.id },
      orderBy: { unitIndex: 'asc' },
    });
    expect(afterTicketScan[0]!.status).toBe('used');
    expect(afterTicketScan[1]!.status).toBe('valid');
    dump('stage-3 parity check — vouchers untouched after ticket scan', {
      vouchers: afterTicketScan.map((v) => ({
        id: v.id,
        unitIndex: v.unitIndex,
        status: v.status,
      })),
    });

    // ── Stage 4: Admin scans voucher #2 (ticket already used) ─────────
    const secondVoucher = afterTicketScan[1]!;
    const claim2 = await app.inject({
      method: 'POST',
      url: '/admin/store/pickup/voucher/claim',
      headers: { authorization: bearer(env, staff.id, 'staff') },
      payload: { code: secondVoucher.code, eventId: event.id },
    });
    expect(claim2.statusCode).toBe(200);
    const claim2Body = claim2.json<{
      result: string;
      voucher: { id: string; status: string };
    }>();
    expect(claim2Body.result).toBe('claimed');
    expect(claim2Body.voucher.status).toBe('used');
    dump('stage-4 POST /admin/store/pickup/voucher/claim — voucher scan #2 (after ticket used)', {
      result: claim2Body.result,
      voucher: { id: claim2Body.voucher.id, status: claim2Body.voucher.status },
    });

    // ── Stage 5: Re-fetch /me/tickets — final state ────────────────────
    const ticketsAfter = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    const tAfter = myTicketsResponseSchema.parse(ticketsAfter.json());
    const ticketRowAfter = tAfter.items.find((t) => t.id === ticket.id);
    expect(ticketRowAfter?.status).toBe('used');
    expect(ticketRowAfter?.pickupVouchers).toHaveLength(2);
    for (const v of ticketRowAfter!.pickupVouchers) {
      expect(v.status).toBe('used');
    }
    dump('stage-5 /me/tickets — final state (ticket used, both vouchers used)', {
      ticket: { id: ticketRowAfter!.id, status: ticketRowAfter!.status },
      pickupVouchers: ticketRowAfter!.pickupVouchers.map((v) => ({
        id: v.id,
        status: v.status,
        code: v.code,
      })),
    });

    // ── Stage 6: Idempotent re-scan of voucher #1 ─────────────────────
    const claim1Replay = await app.inject({
      method: 'POST',
      url: '/admin/store/pickup/voucher/claim',
      headers: { authorization: bearer(env, staff.id, 'staff') },
      payload: { code: firstVoucher.code, eventId: event.id },
    });
    expect(claim1Replay.statusCode).toBe(200);
    const replayBody = claim1Replay.json<{ result: string }>();
    expect(replayBody.result).toBe('already_used');
    dump('stage-6 idempotent re-scan voucher #1 returns already_used', replayBody);
  });
});
