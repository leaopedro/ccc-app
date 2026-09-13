import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkEligibility as checkCarPhotoEligibility } from '../../src/services/garage/eligibility/car-photos.js';
import { checkEligibility as checkCommentEligibility } from '../../src/services/garage/eligibility/comments.js';
import { checkEligibility as checkLikeEligibility } from '../../src/services/garage/eligibility/likes.js';
import { checkEligibility as checkOrderEligibility } from '../../src/services/garage/eligibility/orders.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

// As regras das 7 conquistas com superfície de hook nova. Camada pura: cada
// função devolve códigos, nunca grava GarageBadge — o awarder é o único
// chokepoint de concessão.

const makeCar = (userId: string, nickname: string) =>
  prisma.car.create({
    data: { userId, make: 'Honda', model: 'Civic', year: 2000, nickname },
  });

describe('eligibility/car-photos — CAR-004 Álbum da Garagem', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('três carros com foto rendem CAR-004', async () => {
    const { user } = await createUser({ email: 'album@jdm.test', verified: true });
    for (let i = 0; i < 3; i++) {
      const car = await makeCar(user.id, `album-${i}`);
      await prisma.carPhoto.create({ data: { carId: car.id, objectKey: `album-${i}.jpg` } });
    }

    const codes = await prisma.$transaction((tx) => checkCarPhotoEligibility(tx, user.id));
    expect(codes).toContain('CAR-004');
  });

  it('carro sem foto não conta', async () => {
    // A regra é sobre carros RETRATADOS. Um carro na garagem sem foto é
    // exatamente o que a conquista pede para resolver.
    const { user } = await createUser({ email: 'album-sem-foto@jdm.test', verified: true });
    for (let i = 0; i < 2; i++) {
      const car = await makeCar(user.id, `parcial-${i}`);
      await prisma.carPhoto.create({ data: { carId: car.id, objectKey: `parcial-${i}.jpg` } });
    }
    await makeCar(user.id, 'sem-foto');

    const codes = await prisma.$transaction((tx) => checkCarPhotoEligibility(tx, user.id));
    expect(codes).not.toContain('CAR-004');
  });

  it('carro de outro dono não conta', async () => {
    const { user } = await createUser({ email: 'album-meu@jdm.test', verified: true });
    const { user: outro } = await createUser({ email: 'album-outro@jdm.test', verified: true });
    for (let i = 0; i < 2; i++) {
      const car = await makeCar(user.id, `meu-${i}`);
      await prisma.carPhoto.create({ data: { carId: car.id, objectKey: `meu-${i}.jpg` } });
    }
    const alheio = await makeCar(outro.id, 'alheio');
    await prisma.carPhoto.create({ data: { carId: alheio.id, objectKey: 'alheio.jpg' } });

    const codes = await prisma.$transaction((tx) => checkCarPhotoEligibility(tx, user.id));
    expect(codes).not.toContain('CAR-004');
  });
});

describe('eligibility/comments — COM-004 Bom de Papo + COM-005 Voz da Comunidade', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const makePost = async (userId: string, slug: string) => {
    const event = await prisma.event.create({
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
    return prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: userId, body: 'post', status: 'visible' },
    });
  };

  const makeComments = async (
    postId: string,
    userId: string,
    count: number,
    status: 'visible' | 'hidden' = 'visible',
  ) => {
    for (let i = 0; i < count; i++) {
      await prisma.feedComment.create({
        data: { postId, authorUserId: userId, body: `comentário ${i}`, status },
      });
    }
  };

  it('um comentário rende COM-004 e não COM-005', async () => {
    const { user } = await createUser({ email: 'papo@jdm.test', verified: true });
    const post = await makePost(user.id, 'papo-event');
    await makeComments(post.id, user.id, 1);

    const codes = await prisma.$transaction((tx) => checkCommentEligibility(tx, user.id));
    expect(codes).toContain('COM-004');
    expect(codes).not.toContain('COM-005');
  });

  it('dez comentários rendem COM-005', async () => {
    const { user } = await createUser({ email: 'voz@jdm.test', verified: true });
    const post = await makePost(user.id, 'voz-event');
    await makeComments(post.id, user.id, 10);

    const codes = await prisma.$transaction((tx) => checkCommentEligibility(tx, user.id));
    expect(codes).toContain('COM-005');
  });

  it('comentário oculto pela moderação não conta', async () => {
    const { user } = await createUser({ email: 'papo-oculto@jdm.test', verified: true });
    const post = await makePost(user.id, 'papo-oculto-event');
    await makeComments(post.id, user.id, 9, 'hidden');
    await makeComments(post.id, user.id, 1);

    const codes = await prisma.$transaction((tx) => checkCommentEligibility(tx, user.id));
    expect(codes).toContain('COM-004');
    expect(codes).not.toContain('COM-005');
  });

  it('sem comentário nenhum, lista vazia', async () => {
    const { user } = await createUser({ email: 'mudo@jdm.test', verified: true });
    const codes = await prisma.$transaction((tx) => checkCommentEligibility(tx, user.id));
    expect(codes).toEqual([]);
  });
});

describe('eligibility/likes — COM-006 Em Chamas + COM-007 Ídolo da Garagem', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const garageWithLikes = async (email: string, likesReceived: number) => {
    const { user } = await createUser({ email, verified: true });
    return prisma.garage.update({
      where: { userId: user.id },
      data: { likesReceived },
      select: { id: true },
    });
  };

  it('cinquenta curtidas rendem COM-006', async () => {
    const garage = await garageWithLikes('chamas@jdm.test', 50);
    const codes = await prisma.$transaction((tx) => checkLikeEligibility(tx, garage.id));
    expect(codes).toContain('COM-006');
    expect(codes).not.toContain('COM-007');
  });

  it('quarenta e nove ainda não bastam', async () => {
    const garage = await garageWithLikes('quase-chamas@jdm.test', 49);
    const codes = await prisma.$transaction((tx) => checkLikeEligibility(tx, garage.id));
    expect(codes).toEqual([]);
  });

  it('duzentas e cinquenta rendem COM-007 junto de COM-006', async () => {
    const garage = await garageWithLikes('idolo@jdm.test', 250);
    const codes = await prisma.$transaction((tx) => checkLikeEligibility(tx, garage.id));
    expect(codes).toContain('COM-006');
    expect(codes).toContain('COM-007');
  });

  it('garagem inexistente devolve lista vazia em vez de estourar', async () => {
    // O caminho de reação já trata `authorGarageId` nulo, mas um id que não
    // resolve mais (autor apagado entre a leitura e o award) não pode virar
    // 500 numa curtida.
    const codes = await prisma.$transaction((tx) => checkLikeEligibility(tx, 'garagem-fantasma'));
    expect(codes).toEqual([]);
  });
});

describe('eligibility/orders — CCC-005 Cliente da Casa', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const makeOrder = (
    userId: string,
    kind: 'ticket' | 'product' | 'mixed' | 'box',
    status: 'pending' | 'paid',
  ) =>
    prisma.order.create({
      data: {
        userId,
        kind,
        status,
        amountCents: 1000,
        method: 'pix',
        provider: 'abacatepay',
        ...(status === 'paid' ? { paidAt: new Date() } : {}),
      },
    });

  it('um pedido de produto pago rende CCC-005', async () => {
    const { user } = await createUser({ email: 'cliente@jdm.test', verified: true });
    await makeOrder(user.id, 'product', 'paid');

    const codes = await prisma.$transaction((tx) => checkOrderEligibility(tx, user.id));
    expect(codes).toContain('CCC-005');
  });

  it('pedido misto também conta', async () => {
    const { user } = await createUser({ email: 'cliente-misto@jdm.test', verified: true });
    await makeOrder(user.id, 'mixed', 'paid');

    const codes = await prisma.$transaction((tx) => checkOrderEligibility(tx, user.id));
    expect(codes).toContain('CCC-005');
  });

  it('pedido pendente não conta', async () => {
    const { user } = await createUser({ email: 'cliente-pendente@jdm.test', verified: true });
    await makeOrder(user.id, 'product', 'pending');

    const codes = await prisma.$transaction((tx) => checkOrderEligibility(tx, user.id));
    expect(codes).toEqual([]);
  });

  it('ingresso e caixa não são compra na loja', async () => {
    // "Cliente da Casa" fala da loja. Ingresso pode ser de graça e a caixa é
    // a assinatura; nenhum dos dois é alguém comprando um produto.
    const { user } = await createUser({ email: 'cliente-ingresso@jdm.test', verified: true });
    await makeOrder(user.id, 'ticket', 'paid');
    await makeOrder(user.id, 'box', 'paid');

    const codes = await prisma.$transaction((tx) => checkOrderEligibility(tx, user.id));
    expect(codes).toEqual([]);
  });
});
