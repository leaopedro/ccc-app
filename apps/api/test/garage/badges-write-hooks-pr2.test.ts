import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { settlePaidOrder } from '../../src/services/orders/settle.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// As 5 superfícies de hook novas, no nível em que o membro as aciona. Os
// testes de `eligibility-hook-badges.test.ts` cobrem a regra; estes cobrem a
// fiação: a conquista realmente cai na garagem certa quando o write acontece.

const CATALOG = [
  { code: 'CAR-004', category: 'carros', rarity: 'common', icon: 'album' },
  { code: 'COM-004', category: 'comunidade', rarity: 'common', icon: 'chat' },
  { code: 'COM-005', category: 'comunidade', rarity: 'rare', icon: 'megaphone' },
  { code: 'COM-006', category: 'comunidade', rarity: 'rare', icon: 'fire' },
  { code: 'COM-007', category: 'comunidade', rarity: 'legendary', icon: 'star' },
  { code: 'CCC-004', category: 'ccc', rarity: 'rare', icon: 'shield' },
  { code: 'CCC-005', category: 'ccc', rarity: 'common', icon: 'bag' },
] as const;

const seedCatalog = () =>
  prisma.badge.createMany({
    data: CATALOG.map((b) => ({
      ...b,
      title: `Conquista ${b.code}`,
      description: `Descrição de ${b.code}`,
      criteria: `Critério de ${b.code}`,
    })),
  });

const garageId = async (userId: string): Promise<string> =>
  (await prisma.garage.findUniqueOrThrow({ where: { userId }, select: { id: true } })).id;

const earnedCodes = async (gid: string): Promise<string[]> =>
  (await prisma.garageBadge.findMany({ where: { garageId: gid }, select: { badgeCode: true } }))
    .map((r) => r.badgeCode)
    .sort();

describe('hooks novos de conquista', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    await seedCatalog();
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------
  // CAR-004 — foto de carro
  // -------------------------------------------------------------------

  it('POST /me/cars/:id/photos concede CAR-004 na terceira foto', async () => {
    const { user } = await createUser({ email: 'hook-album@jdm.test', verified: true });
    const env = loadEnv();
    const auth = { authorization: bearer(env, user.id) };

    const carIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/me/cars',
        headers: auth,
        payload: {
          make: 'Honda',
          model: 'Civic',
          year: 1999 + i,
          nickname: `album ${i}`,
          modifications: [],
        },
      });
      expect(res.statusCode).toBe(201);
      carIds.push(res.json<{ id: string }>().id);
    }

    const gid = await garageId(user.id);
    for (const [i, carId] of carIds.entries()) {
      const res = await app.inject({
        method: 'POST',
        url: `/me/cars/${carId}/photos`,
        headers: auth,
        payload: { objectKey: `car_photo/${user.id}/${carId}.jpg` },
      });
      expect(res.statusCode).toBe(201);
      // Só a terceira fecha o álbum. Conferir no meio do caminho é o que
      // separa "a regra roda" de "a regra roda no limiar certo".
      const codes = await earnedCodes(gid);
      expect(codes.includes('CAR-004')).toBe(i === 2);
    }

    const row = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: gid, badgeCode: 'CAR-004' },
    });
    expect(row.sourceRef).toMatch(/^car_photo:/);
  });

  // -------------------------------------------------------------------
  // COM-004 / COM-005 — comentário
  // -------------------------------------------------------------------

  // `postingAccess: 'attendees'` é o default do produto, então quem comenta ou
  // curte precisa de ingresso. O helper entrega um para cada participante do
  // spec em vez de afrouxar o evento, que testaria um caminho que ninguém usa.
  const eventWithPost = async (slug: string, authorId: string, alsoTicket: string[] = []) => {
    const event = await prisma.event.create({
      data: {
        slug,
        title: slug,
        description: 'd',
        startsAt: new Date('2026-05-10T10:00:00Z'),
        endsAt: new Date('2026-05-10T20:00:00Z'),
        type: 'meeting',
        status: 'published',
        capacity: 100,
        feedAccess: 'public',
        postingAccess: 'attendees',
      },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'GA', priceCents: 0, currency: 'BRL', quantityTotal: 100 },
    });
    for (const userId of [authorId, ...alsoTicket]) {
      await prisma.ticket.create({
        data: { userId, eventId: event.id, tierId: tier.id, status: 'valid' },
      });
    }
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: authorId, body: 'post', status: 'visible' },
    });
    return { event, post };
  };

  it('POST de comentário concede COM-004 no primeiro e COM-005 no décimo', async () => {
    const { user } = await createUser({ email: 'hook-papo@jdm.test', verified: true });
    const { event, post } = await eventWithPost('hook-papo-evt', user.id);
    const auth = { authorization: bearer(loadEnv(), user.id) };
    const gid = await garageId(user.id);

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/events/${event.id}/feed/${post.id}/comments`,
        headers: auth,
        payload: { body: `comentário ${i}` },
      });
      expect(res.statusCode).toBe(201);
      const codes = await earnedCodes(gid);
      expect(codes).toContain('COM-004');
      expect(codes.includes('COM-005')).toBe(i === 9);
    }

    const row = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: gid, badgeCode: 'COM-004' },
    });
    expect(row.sourceRef).toMatch(/^feed_comment:/);
  });

  // -------------------------------------------------------------------
  // COM-006 / COM-007 — curtida recebida
  // -------------------------------------------------------------------

  it('a curtida que cruza 50 concede COM-006 ao AUTOR, não a quem curtiu', async () => {
    const { user: autor } = await createUser({ email: 'hook-autor@jdm.test', verified: true });
    const { user: fa } = await createUser({ email: 'hook-fa@jdm.test', verified: true });
    const { event, post } = await eventWithPost('hook-chamas-evt', autor.id, [fa.id]);
    const autorGid = await garageId(autor.id);
    const faGid = await garageId(fa.id);

    // 49 curtidas já contabilizadas: o contador é a coluna que o awardXp
    // mantém, então o teste parte dela em vez de simular 49 requisições.
    await prisma.garage.update({ where: { id: autorGid }, data: { likesReceived: 49 } });

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      headers: { authorization: bearer(loadEnv(), fa.id) },
      payload: { kind: 'like' },
    });
    expect(res.statusCode).toBeLessThan(300);

    expect(await earnedCodes(autorGid)).toContain('COM-006');
    expect(await earnedCodes(faGid)).toEqual([]);
  });

  it('curtida abaixo do limiar não concede nada', async () => {
    const { user: autor } = await createUser({ email: 'hook-autor2@jdm.test', verified: true });
    const { user: fa } = await createUser({ email: 'hook-fa2@jdm.test', verified: true });
    const { event, post } = await eventWithPost('hook-chamas2-evt', autor.id, [fa.id]);
    const autorGid = await garageId(autor.id);
    await prisma.garage.update({ where: { id: autorGid }, data: { likesReceived: 10 } });

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/feed/${post.id}/reactions`,
      headers: { authorization: bearer(loadEnv(), fa.id) },
      payload: { kind: 'like' },
    });

    expect(await earnedCodes(autorGid)).toEqual([]);
  });

  // -------------------------------------------------------------------
  // CCC-004 — ativação premium
  // -------------------------------------------------------------------

  it('o grant de premium pelo admin concede CCC-004', async () => {
    const { user: admin } = await createUser({
      email: 'hook-admin@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user } = await createUser({ email: 'hook-socio@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/garage/premium`,
      headers: { authorization: bearer(loadEnv(), admin.id, 'admin') },
      payload: {
        tier: 'gold',
        premiumUntil: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      },
    });
    expect(res.statusCode).toBe(200);

    const gid = await garageId(user.id);
    const row = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: gid, badgeCode: 'CCC-004' },
    });
    expect(row.sourceRef).toMatch(/^garage:/);
  });

  it('regrant de premium não duplica CCC-004', async () => {
    const { user: admin } = await createUser({
      email: 'hook-admin2@jdm.test',
      verified: true,
      role: 'admin',
    });
    const { user } = await createUser({ email: 'hook-socio2@jdm.test', verified: true });
    const auth = { authorization: bearer(loadEnv(), admin.id, 'admin') };
    const until = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();

    await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/garage/premium`,
      headers: auth,
      payload: { tier: 'gold', premiumUntil: until },
    });
    await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/garage/premium`,
      headers: auth,
      payload: { tier: 'silver', premiumUntil: until },
    });

    const gid = await garageId(user.id);
    const rows = await prisma.garageBadge.findMany({
      where: { garageId: gid, badgeCode: 'CCC-004' },
    });
    expect(rows).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // CCC-005 — pedido pago
  // -------------------------------------------------------------------

  const pendingOrder = (userId: string, kind: 'product' | 'ticket') =>
    prisma.order.create({
      data: {
        userId,
        kind,
        status: 'pending',
        amountCents: 5000,
        method: 'pix',
        provider: 'abacatepay',
      },
    });

  it('liquidar um pedido de produto concede CCC-005', async () => {
    const { user } = await createUser({ email: 'hook-cliente@jdm.test', verified: true });
    const order = await pendingOrder(user.id, 'product');

    await settlePaidOrder(order.id, 'ref-produto-1', loadEnv());

    const gid = await garageId(user.id);
    const row = await prisma.garageBadge.findFirstOrThrow({
      where: { garageId: gid, badgeCode: 'CCC-005' },
    });
    expect(row.sourceRef).toMatch(/^order:/);
  });

  it('a conquista nunca derruba a liquidação', async () => {
    // O catálogo sem CCC-005 faz o awarder lançar `unknown badge`. O pedido
    // TEM de continuar pago: nenhuma conquista vale reverter um pagamento
    // que o provedor já confirmou.
    await prisma.badge.delete({ where: { code: 'CCC-005' } });
    const { user } = await createUser({ email: 'hook-cliente2@jdm.test', verified: true });
    const order = await pendingOrder(user.id, 'product');

    await settlePaidOrder(order.id, 'ref-produto-2', loadEnv());

    const settled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(settled.status).toBe('paid');
    expect(settled.paidAt).not.toBeNull();
  });
});
