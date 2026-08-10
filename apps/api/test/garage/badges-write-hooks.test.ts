import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { checkInTicket } from '../../src/services/tickets/check-in.js';
import { signTicketCode } from '../../src/services/tickets/codes.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const seedCatalog = async () => {
  await prisma.badge.createMany({
    data: [
      { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag' },
      { code: 'CAR-001', category: 'carros', rarity: 'common', icon: 'car' },
      { code: 'COM-001', category: 'comunidade', rarity: 'common', icon: 'post' },
      { code: 'CCC-001', category: 'ccc', rarity: 'common', icon: 'pin' },
      { code: 'CCC-002', category: 'ccc', rarity: 'rare', icon: 'flagCheck' },
      {
        code: 'CCC-003',
        category: 'ccc',
        rarity: 'legendary',
        icon: 'founder',
        premiumExclusive: true,
      },
    ],
  });
};

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('write-path hooks — badges land atomically', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /me/cars awards CAR-001 on first car', async () => {
    await seedCatalog();
    const { user } = await createUser({ email: 'hook-cars@jdm.test', verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        make: 'Honda',
        model: 'Civic',
        year: 1999,
        nickname: 'hook civic',
        modifications: [],
      },
    });
    expect(res.statusCode).toBe(201);

    const gid = await garageId(user.id);
    const earned = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: gid, badgeCode: 'CAR-001' },
    });
    expect(earned.sourceRef).toMatch(/^car:/);
  });

  it('POST /events/:id/feed awards COM-001 on first post', async () => {
    await seedCatalog();
    const { user } = await createUser({ email: 'hook-feed@jdm.test', verified: true });
    const event = await prisma.event.create({
      data: {
        slug: 'hook-evt',
        title: 'Hook Event',
        description: 'd',
        startsAt: new Date('2026-05-10T10:00:00Z'),
        endsAt: new Date('2026-05-10T20:00:00Z'),
        type: 'meeting',
        status: 'published',
        capacity: 100,
        feedAccess: 'attendees',
        postingAccess: 'attendees',
      },
    });
    // Posting requires a valid ticket on `attendees` access.
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'GA', priceCents: 0, currency: 'BRL', quantityTotal: 100 },
    });
    await prisma.ticket.create({
      data: { userId: user.id, eventId: event.id, tierId: tier.id, status: 'valid' },
    });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed`,
      headers: { authorization: bearer(env, user.id) },
      payload: { body: 'meu primeiro post' },
    });
    expect(res.statusCode).toBe(201);

    const gid = await garageId(user.id);
    const earned = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: gid, badgeCode: 'COM-001' },
    });
    expect(earned.sourceRef).toMatch(/^feed_post:/);
  });

  it('check-in awards EVT-001 + CCC-001 (Curitiba) + CCC-002 (drift) in the same tx', async () => {
    await seedCatalog();
    const { user } = await createUser({ email: 'hook-checkin@jdm.test', verified: true });
    const event = await prisma.event.create({
      data: {
        slug: 'hook-drift-ctba',
        title: 'Drift CTBA',
        description: 'd',
        startsAt: new Date('2026-05-10T10:00:00Z'),
        endsAt: new Date('2026-05-10T20:00:00Z'),
        type: 'drift',
        city: 'Curitiba',
        status: 'published',
        capacity: 100,
      },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'GA', priceCents: 0, currency: 'BRL', quantityTotal: 100 },
    });
    const ticket = await prisma.ticket.create({
      data: { userId: user.id, eventId: event.id, tierId: tier.id, status: 'valid' },
    });
    const env = loadEnv();

    const code = signTicketCode(ticket.id, env);
    const outcome = await checkInTicket({ code, eventId: event.id }, env);
    expect(outcome.kind).toBe('admitted');

    const gid = await garageId(user.id);
    const earned = await prisma.garageBadge.findMany({
      where: { garageId: gid },
      orderBy: { badgeCode: 'asc' },
    });
    const codes = earned.map((r) => r.badgeCode).sort();
    expect(codes).toContain('EVT-001');
    expect(codes).toContain('CCC-001');
    expect(codes).toContain('CCC-002');
  });

  it('POST /auth/signup awards CCC-003 when override is on (premium-only, fresh user is free) → no row', async () => {
    await seedCatalog();
    // Signup runs the awarder WITHOUT override, so a fresh free user
    // gets `premium_required` and NO row lands. Verifies the gate is
    // enforced on the signup path too.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email: 'fundador-free@jdm.test',
        password: 'correct-horse-battery-staple',
        name: 'Fundador',
        ageAttestation: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ user: { id: string } }>();

    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: body.user.id } });
    const earned = await prisma.garageBadge.findMany({
      where: { garageId: garage.id, badgeCode: 'CCC-003' },
    });
    expect(earned).toHaveLength(0);
  });
});
