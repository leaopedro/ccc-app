import { prisma } from '@ccc/db';
import { homeFeedResponseSchema } from '@ccc/shared/feed';
import { HOME_CONTENT_SINGLETON_ID } from '@ccc/shared/home';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from './helpers.js';

const env = loadEnv();

const GET = { method: 'GET' as const, url: '/api/home-feed' };

// createUser usa 'user@jdm.test' por padrao e User.email e unique, entao todo
// teste que cria mais de um usuario precisa passar emails distintos.
let seq = 0;
const newUser = async () => (await createUser({ email: `home-feed-${(seq += 1)}@jdm.test` })).user;

const seedEvent = (
  title: string,
  overrides: {
    feedAccess?: 'public' | 'attendees' | 'members_only';
    feedEnabled?: boolean;
    status?: 'draft' | 'published' | 'cancelled';
  } = {},
) =>
  prisma.event.create({
    data: {
      title,
      slug: `hf-${Math.random().toString(36).slice(2, 10)}`,
      description: 'desc',
      startsAt: new Date('2026-07-01T18:00:00Z'),
      endsAt: new Date('2026-07-01T22:00:00Z'),
      type: 'meeting',
      status: overrides.status ?? 'published',
      capacity: 100,
      feedEnabled: overrides.feedEnabled ?? true,
      feedAccess: overrides.feedAccess ?? 'public',
      postingAccess: 'attendees',
    },
  });

const seedPost = async (eventId: string, body: string, authorUserId?: string) =>
  prisma.feedPost.create({
    data: { eventId, body, authorUserId: authorUserId ?? (await newUser()).id, status: 'visible' },
  });

const setCount = (feedPostCount: number) =>
  prisma.homeContent.upsert({
    where: { id: HOME_CONTENT_SINGLETON_ID },
    create: { id: HOME_CONTENT_SINGLETON_ID, feedPostCount },
    update: { feedPostCount },
  });

const bodies = (payload: unknown) =>
  homeFeedResponseSchema
    .parse(payload)
    .posts.map((p) => p.body)
    .sort();

describe('GET /api/home-feed', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.homeContent.deleteMany();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serve post de evento public e published sem auth', async () => {
    const event = await seedEvent('Encontro Publico');
    await seedPost(event.id, 'ola mundo');

    const res = await app.inject(GET);

    expect(res.statusCode).toBe(200);
    expect(bodies(res.json())).toEqual(['ola mundo']);
  });

  it('embute slug e titulo do evento em cada item', async () => {
    const event = await seedEvent('Encontro Publico');
    await seedPost(event.id, 'ola mundo');

    const body = homeFeedResponseSchema.parse((await app.inject(GET)).json());

    expect(body.posts[0]?.event).toEqual({ slug: event.slug, title: event.title });
  });

  it('nao serve post de evento attendees nem members_only', async () => {
    const attendees = await seedEvent('Fechado', { feedAccess: 'attendees' });
    const members = await seedEvent('Premium', { feedAccess: 'members_only' });
    await seedPost(attendees.id, 'secreto a');
    await seedPost(members.id, 'secreto b');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post de evento em rascunho', async () => {
    const draft = await seedEvent('Surpresa', { status: 'draft' });
    await seedPost(draft.id, 'nao anunciado');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post de evento cancelado', async () => {
    const cancelled = await seedEvent('Cancelado', { status: 'cancelled' });
    await seedPost(cancelled.id, 'nao vai rolar');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post de evento com feed desligado', async () => {
    const event = await seedEvent('Desligado', { feedEnabled: false });
    await seedPost(event.id, 'invisivel');

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('nao serve post escondido nem removido', async () => {
    const event = await seedEvent('Encontro Publico');
    const hidden = await seedPost(event.id, 'escondido');
    await prisma.feedPost.update({ where: { id: hidden.id }, data: { status: 'hidden' } });
    const removed = await seedPost(event.id, 'removido');
    await prisma.feedPost.update({ where: { id: removed.id }, data: { status: 'removed' } });
    await seedPost(event.id, 'visivel');

    expect(bodies((await app.inject(GET)).json())).toEqual(['visivel']);
  });

  it('nao serve post com denuncia aberta', async () => {
    const event = await seedEvent('Encontro Publico');
    const denounced = await seedPost(event.id, 'denunciado');
    await seedPost(event.id, 'limpo');
    const reporter = await newUser();
    await prisma.report.create({
      data: {
        targetKind: 'post',
        postId: denounced.id,
        reporterUserId: reporter.id,
        reason: 'spam',
        status: 'open',
      },
    });

    expect(bodies((await app.inject(GET)).json())).toEqual(['limpo']);
  });

  it('nao serve post de autor banido naquele evento', async () => {
    const event = await seedEvent('Encontro Publico');
    const other = await seedEvent('Outro Encontro');
    const troll = await newUser();
    const moderator = await newUser();
    await seedPost(event.id, 'do banido', troll.id);
    await seedPost(other.id, 'do mesmo autor em outro evento', troll.id);
    await prisma.feedBan.create({
      data: { eventId: event.id, userId: troll.id, scope: 'post', bannedById: moderator.id },
    });

    expect(bodies((await app.inject(GET)).json())).toEqual(['do mesmo autor em outro evento']);
  });

  it('nao serve post de conta apagada', async () => {
    const event = await seedEvent('Encontro Publico');
    await prisma.feedPost.create({
      data: { eventId: event.id, body: 'tombstone', authorUserId: null, status: 'visible' },
    });
    await seedPost(event.id, 'com autor');

    expect(bodies((await app.inject(GET)).json())).toEqual(['com autor']);
  });

  it('nao serve post de autor que pediu exclusao e ainda esta na carencia', async () => {
    const event = await seedEvent('Encontro Publico');
    const leaving = await newUser();
    await seedPost(event.id, 'do autor saindo', leaving.id);
    await seedPost(event.id, 'de quem fica');
    await prisma.user.update({
      where: { id: leaving.id },
      data: { status: 'deleted', deletedAt: new Date() },
    });

    // Catches: confiar so em `authorUserId: { not: null }`. O worker de
    // anonimizacao so anula o autor depois de DELETION_GRACE_DAYS (default
    // 30), entao durante a carencia o post continuaria na vitrine publica.
    expect(bodies((await app.inject(GET)).json())).toEqual(['de quem fica']);
  });

  it('nao serve post de autor desabilitado', async () => {
    const event = await seedEvent('Encontro Publico');
    const banned = await newUser();
    await seedPost(event.id, 'do banido da plataforma', banned.id);
    await seedPost(event.id, 'de quem fica');
    await prisma.user.update({ where: { id: banned.id }, data: { status: 'disabled' } });

    expect(bodies((await app.inject(GET)).json())).toEqual(['de quem fica']);
  });

  it('respeita feedPostCount', async () => {
    const event = await seedEvent('Encontro Publico');
    for (let i = 0; i < 8; i += 1) await seedPost(event.id, `post ${i}`);
    await setCount(3);

    expect(homeFeedResponseSchema.parse((await app.inject(GET)).json()).posts).toHaveLength(3);
  });

  it('feedPostCount zero devolve lista vazia', async () => {
    const event = await seedEvent('Encontro Publico');
    await seedPost(event.id, 'post');
    await setCount(0);

    expect(bodies((await app.inject(GET)).json())).toEqual([]);
  });

  it('sorteia em vez de devolver sempre os mais novos', async () => {
    const event = await seedEvent('Encontro Publico');
    for (let i = 0; i < 20; i += 1) await seedPost(event.id, `post ${i}`);
    await setCount(3);

    const seen = new Set<string>();
    for (let call = 0; call < 6; call += 1) {
      for (const body of bodies((await app.inject(GET)).json())) seen.add(body);
    }

    // Catches: trocar shuffle(pool).slice(0, N) por pool.slice(0, N). Com 20
    // posts, 3 por chamada e 6 chamadas, ver so 3 distintos tem probabilidade
    // desprezivel; sem sorteio, e o resultado garantido.
    expect(seen.size).toBeGreaterThan(3);
  });

  it('esconde bloqueado nas duas direcoes e a conta apagada no mesmo pool', async () => {
    const event = await seedEvent('Encontro Publico');
    const reader = await newUser();
    const blocked = await newUser();
    const blocker = await newUser();
    await seedPost(event.id, 'do bloqueado', blocked.id);
    await seedPost(event.id, 'de quem me bloqueou', blocker.id);
    await seedPost(event.id, 'de terceiro');
    // O post orfao esta aqui DE PROPOSITO, nao sobrou de copiar e colar. Os
    // dois requisitos do filtro de autor moram na MESMA chave do where: ter
    // autor (`not: null`) e o autor nao estar bloqueado (`notIn`). Este e o
    // unico cenario com leitor logado, bloqueios E post orfao no mesmo pool.
    //
    // O que ele pega, verificado rodando a variante e vendo falhar: copiar
    // para ca o idiom do feed do evento (routes/feed.ts:70-76),
    // `OR: [{ authorUserId: null }, { authorUserId: { notIn } }]`. La aquele
    // OR existe para MANTER o tombstone e nao perder a thread; aqui ele
    // inverte o requisito e promove conteudo de conta apagada para a primeira
    // tela do app. Sem este post no pool, a copia passa nos outros 16 testes.
    await prisma.feedPost.create({
      data: { eventId: event.id, body: 'tombstone', authorUserId: null, status: 'visible' },
    });
    await prisma.userBlock.create({ data: { blockerId: reader.id, blockedId: blocked.id } });
    await prisma.userBlock.create({ data: { blockerId: blocker.id, blockedId: reader.id } });

    const res = await app.inject({ ...GET, headers: { authorization: bearer(env, reader.id) } });

    expect(bodies(res.json())).toEqual(['de terceiro']);
  });

  it('esconde o evento inteiro de quem tem FeedBan de view', async () => {
    const banned = await seedEvent('Banido');
    const open = await seedEvent('Aberto');
    const reader = await newUser();
    const moderator = await newUser();
    await seedPost(banned.id, 'do evento banido');
    await seedPost(open.id, 'do evento aberto');
    await prisma.feedBan.create({
      data: { eventId: banned.id, userId: reader.id, scope: 'view', bannedById: moderator.id },
    });

    const res = await app.inject({ ...GET, headers: { authorization: bearer(env, reader.id) } });

    expect(bodies(res.json())).toEqual(['do evento aberto']);
  });

  it('marca isOwn no post do proprio leitor e nunca expoe authorUserId', async () => {
    const event = await seedEvent('Encontro Publico');
    const reader = await newUser();
    await seedPost(event.id, 'meu post', reader.id);

    const res = await app.inject({ ...GET, headers: { authorization: bearer(env, reader.id) } });

    const body = homeFeedResponseSchema.parse(res.json());
    expect(body.posts[0]?.isOwn).toBe(true);
    // JSON cru, antes do .parse: o parse do zod faria o strip e esconderia o
    // vazamento que este teste existe para pegar.
    expect(JSON.stringify(res.json())).not.toContain('authorUserId');
  });

  it('isOwn e false para leitor anonimo', async () => {
    const event = await seedEvent('Encontro Publico');
    await seedPost(event.id, 'post alheio');

    const body = homeFeedResponseSchema.parse((await app.inject(GET)).json());
    expect(body.posts[0]?.isOwn).toBe(false);
  });
});
