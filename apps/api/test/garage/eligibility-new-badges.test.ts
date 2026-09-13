import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkEligibility as checkEventEligibility } from '../../src/services/garage/eligibility/events.js';
import { checkEligibility as checkFeedEligibility } from '../../src/services/garage/eligibility/feed.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

// Conquistas novas do catálogo de 20: EVT-004, EVT-005, COM-008. As três
// reaproveitam superfícies de hook que já existem — check-in e criação de post
// — então entram sem tocar em nenhuma rota. Ficam num arquivo separado de
// `eligibility.test.ts` porque aquele já passa das 500 linhas.

describe('eligibility/events — EVT-004 Maratona + EVT-005 Fiel de Carteirinha', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // A janela da Maratona é relativa a AGORA, então as fixtures também têm de
  // ser. Datas literais como as dos specs de streak cairiam fora da janela
  // assim que o calendário andasse.
  const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 3600_000);

  const makeAttendedEvent = async (slug: string, startsAt: Date, userId: string) => {
    const event = await prisma.event.create({
      data: {
        slug,
        title: slug,
        description: 'desc',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3600_000),
        type: 'meeting',
        status: 'published',
        capacity: 100,
      },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'GA', priceCents: 0, currency: 'BRL', quantityTotal: 100 },
    });
    return prisma.ticket.create({
      data: {
        userId,
        eventId: event.id,
        tierId: tier.id,
        status: 'used',
        usedAt: new Date(startsAt.getTime() + 3600_000),
      },
    });
  };

  it('EVT-004 — três eventos distintos dentro da janela de 30 dias', async () => {
    const { user } = await createUser({ email: 'maratona@jdm.test', verified: true });
    await makeAttendedEvent('maratona-a', daysAgo(25), user.id);
    await makeAttendedEvent('maratona-b', daysAgo(12), user.id);
    const trigger = await makeAttendedEvent('maratona-c', daysAgo(1), user.id);

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).toContain('EVT-004');
  });

  it('EVT-004 — o terceiro evento fora da janela não conta', async () => {
    const { user } = await createUser({ email: 'maratona-fora@jdm.test', verified: true });
    await makeAttendedEvent('fora-a', daysAgo(45), user.id);
    await makeAttendedEvent('fora-b', daysAgo(12), user.id);
    const trigger = await makeAttendedEvent('fora-c', daysAgo(1), user.id);

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).not.toContain('EVT-004');
  });

  it('EVT-004 — três ingressos no mesmo evento são um evento só', async () => {
    // Mesma inflação por acompanhante que fez EVT-003 contar eventos
    // distintos em vez de check-ins.
    const { user } = await createUser({ email: 'maratona-guest@jdm.test', verified: true });
    const trigger = await makeAttendedEvent('guest-a', daysAgo(3), user.id);
    for (let i = 0; i < 2; i++) {
      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: trigger.eventId,
          tierId: trigger.tierId,
          status: 'used',
          usedAt: daysAgo(3),
        },
      });
    }

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, trigger.id));
    expect(codes).not.toContain('EVT-004');
  });

  it('EVT-005 — vinte e cinco eventos distintos', async () => {
    const { user } = await createUser({ email: 'fiel@jdm.test', verified: true });
    let triggerId = '';
    for (let i = 0; i < 25; i++) {
      const t = await makeAttendedEvent(`fiel-${i}`, daysAgo(200 - i * 2), user.id);
      triggerId = t.id;
    }

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, triggerId));
    expect(codes).toContain('EVT-005');
    expect(codes).toContain('EVT-003');
  });

  it('EVT-005 — vinte e quatro eventos ainda não bastam', async () => {
    const { user } = await createUser({ email: 'quase-fiel@jdm.test', verified: true });
    let triggerId = '';
    for (let i = 0; i < 24; i++) {
      const t = await makeAttendedEvent(`quase-${i}`, daysAgo(200 - i * 2), user.id);
      triggerId = t.id;
    }

    const codes = await prisma.$transaction((tx) => checkEventEligibility(tx, user.id, triggerId));
    expect(codes).not.toContain('EVT-005');
    expect(codes).toContain('EVT-003');
  });
});

describe('eligibility/feed — COM-008 Fotógrafo do Rolê', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const makeEvent = (slug: string) =>
    prisma.event.create({
      data: {
        slug,
        title: slug,
        description: 'desc',
        startsAt: new Date('2026-05-10T10:00:00Z'),
        endsAt: new Date('2026-05-10T20:00:00Z'),
        type: 'meeting',
        capacity: 100,
        status: 'published',
      },
    });

  const makePostWithPhotos = async (
    eventId: string,
    userId: string,
    photoCount: number,
    status: 'visible' | 'hidden' = 'visible',
  ) => {
    const post = await prisma.feedPost.create({
      data: { eventId, authorUserId: userId, body: 'foto', status },
    });
    for (let i = 0; i < photoCount; i++) {
      await prisma.feedPostPhoto.create({
        data: { postId: post.id, objectKey: `${post.id}-${i}.jpg`, sortOrder: i },
      });
    }
    return post;
  };

  it('vinte fotos publicadas rendem COM-008', async () => {
    const { user } = await createUser({ email: 'fotografo@jdm.test', verified: true });
    const event = await makeEvent('fotografo-event');
    await makePostWithPhotos(event.id, user.id, 15);
    const post = await makePostWithPhotos(event.id, user.id, 5);

    const codes = await prisma.$transaction((tx) => checkFeedEligibility(tx, user.id, post.id));
    expect(codes).toContain('COM-008');
  });

  it('dezenove fotos ainda não rendem COM-008', async () => {
    const { user } = await createUser({ email: 'quase-foto@jdm.test', verified: true });
    const event = await makeEvent('quase-foto-event');
    const post = await makePostWithPhotos(event.id, user.id, 19);

    const codes = await prisma.$transaction((tx) => checkFeedEligibility(tx, user.id, post.id));
    expect(codes).not.toContain('COM-008');
  });

  it('fotos de post oculto pela moderação não contam', async () => {
    const { user } = await createUser({ email: 'foto-oculta@jdm.test', verified: true });
    const event = await makeEvent('foto-oculta-event');
    await makePostWithPhotos(event.id, user.id, 15, 'hidden');
    const post = await makePostWithPhotos(event.id, user.id, 5);

    const codes = await prisma.$transaction((tx) => checkFeedEligibility(tx, user.id, post.id));
    expect(codes).not.toContain('COM-008');
  });
});
