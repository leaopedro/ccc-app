import { prisma } from '@ccc/db';
import { adminHomeContentSchema, HOME_MEDIA_OBJECT_KEY_PREFIX } from '@ccc/shared/admin-home';
import { HOME_CONTENT_SINGLETON_ID, homeContentResponseSchema } from '@ccc/shared/home';
import { MAX_UPLOAD_BYTES, presignResponseSchema } from '@ccc/shared/uploads';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, resetDatabase, makeApp } from '../helpers.js';

const ensureRowViaGet = async (app: FastifyInstance, userId: string) => {
  const res = await app.inject({
    method: 'GET',
    url: '/admin/home/content',
    headers: { authorization: bearer(loadEnv(), userId, 'organizer') },
  });
  return adminHomeContentSchema.parse(res.json());
};

describe('admin home content', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.homeContent.deleteMany();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const organizer = async () =>
    (await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' })).user;

  const readRow = () =>
    prisma.homeContent.findUniqueOrThrow({ where: { id: HOME_CONTENT_SINGLETON_ID } });

  const put = async (userId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url: '/admin/home/content',
      headers: { authorization: bearer(loadEnv(), userId, 'organizer') },
      payload,
    });

  it('GET cria a linha com os defaults quando ainda nao existe', async () => {
    const user = await organizer();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/home/content',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminHomeContentSchema.parse(res.json());
    expect(body.heroTitle).toBe('DIRIGIR. CONECTAR. PERTENCER.');
    expect(body.heroBannerObjectKey).toBeNull();
    expect(body.heroBannerUrl).toBeNull();
  });

  it('GET resolve a URL publica a partir da object key', async () => {
    await prisma.homeContent.create({
      data: {
        id: HOME_CONTENT_SINGLETON_ID,
        heroBannerObjectKey: 'home-media/seed/banner.jpg',
      },
    });
    const user = await organizer();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/home/content',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    const body = adminHomeContentSchema.parse(res.json());
    expect(body.heroBannerObjectKey).toBe('home-media/seed/banner.jpg');
    expect(body.heroBannerUrl).toContain('home-media/seed/banner.jpg');
  });

  it('rejeita staff, user comum e request sem auth', async () => {
    const { user: staff } = await createUser({
      email: 'staff@jdm.test',
      verified: true,
      role: 'staff',
    });
    const { user: member } = await createUser({ email: 'member@jdm.test', verified: true });

    const anon = await app.inject({ method: 'GET', url: '/admin/home/content' });
    expect(anon.statusCode).toBe(401);

    for (const [id, role] of [
      [staff.id, 'staff'],
      [member.id, 'user'],
    ] as const) {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/home/content',
        headers: { authorization: bearer(loadEnv(), id, role) },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('PUT altera so os campos enviados', async () => {
    const user = await organizer();
    const before = await ensureRowViaGet(app, user.id);

    const res = await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      heroTitle: 'NOVO MOTE',
    });

    expect(res.statusCode).toBe(200);
    const body = adminHomeContentSchema.parse(res.json());
    expect(body.heroTitle).toBe('NOVO MOTE');
    expect(body.institutionalTitle).toBe('A Casa');
  });

  it('PUT identico nao escreve e nao audita', async () => {
    const user = await organizer();
    const before = await ensureRowViaGet(app, user.id);
    const seeded = await readRow();

    const res = await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      heroTitle: before.heroTitle,
      institutionalTitle: before.institutionalTitle,
      institutionalBody: before.institutionalBody,
    });

    expect(res.statusCode).toBe(200);
    const after = await readRow();
    // A assercao e sobre updatedAt, nao sobre contagem de auditoria: so contar
    // auditoria passa verde enquanto todo Salvar bumpa a linha, que e
    // exatamente a regressao que o diff existe para evitar.
    expect(after.updatedAt.getTime()).toBe(seeded.updatedAt.getTime());
    expect(await prisma.adminAudit.count()).toBe(0);
  });

  it('PUT com mudanca audita os campos tocados e o antes/depois das imagens', async () => {
    const user = await organizer();
    const before = await ensureRowViaGet(app, user.id);

    await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      heroTitle: 'NOVO MOTE',
      heroBannerObjectKey: `${HOME_MEDIA_OBJECT_KEY_PREFIX}/${user.id}/banner.jpg`,
    });

    const audit = await prisma.adminAudit.findFirstOrThrow();
    expect(audit.action).toBe('home_content.update');
    expect(audit.entityType).toBe('home_content');
    expect(audit.entityId).toBe(HOME_CONTENT_SINGLETON_ID);
    const metadata = audit.metadata as {
      fields: string[];
      images: { heroBannerObjectKey: { previous: string | null; next: string | null } };
    };
    expect(metadata.fields).toContain('heroTitle');
    expect(metadata.images.heroBannerObjectKey).toEqual({
      previous: null,
      next: `${HOME_MEDIA_OBJECT_KEY_PREFIX}/${user.id}/banner.jpg`,
    });
  });

  it('PUT recusa object key de outro prefixo', async () => {
    const user = await organizer();
    const before = await ensureRowViaGet(app, user.id);

    const badKeys = [
      'identity-document/someone/x.jpg',
      'feed_photo/someone/x.jpg',
      'avatar/someone/x.jpg',
      'home-media/../feed_photo/someone/x.jpg',
      'home-media/x/..%2f..%2ffeed_photo%2fvictim%2fx.jpg',
    ];
    const imageFields = ['heroBannerObjectKey', 'institutionalImageObjectKey'] as const;

    for (const field of imageFields) {
      for (const key of badKeys) {
        const res = await put(user.id, {
          expectedUpdatedAt: before.updatedAt,
          [field]: key,
        });
        expect(res.statusCode).toBe(400);
      }
    }

    const after = await readRow();
    expect(after.heroBannerObjectKey).toBeNull();
    expect(after.institutionalImageObjectKey).toBeNull();
  });

  it('PUT com string vazia limpa a coluna em vez de dar 400', async () => {
    const user = await organizer();
    // Garante a linha singleton antes do update direto: o beforeEach limpa a
    // tabela e prisma.homeContent.update() falha em linha inexistente.
    await ensureRowViaGet(app, user.id);
    await prisma.homeContent.update({
      where: { id: HOME_CONTENT_SINGLETON_ID },
      data: {
        heroSubtitle: 'antigo',
        heroBannerObjectKey: `${HOME_MEDIA_OBJECT_KEY_PREFIX}/x/old.jpg`,
      },
    });
    const current = await readRow();

    const res = await put(user.id, {
      expectedUpdatedAt: current.updatedAt.toISOString(),
      heroSubtitle: '',
      heroBannerObjectKey: '',
    });

    expect(res.statusCode).toBe(200);
    const after = await readRow();
    expect(after.heroSubtitle).toBeNull();
    expect(after.heroBannerObjectKey).toBeNull();
  });

  it('PUT recusa titulo so com espaco e texto acima do limite', async () => {
    const user = await organizer();
    const before = await ensureRowViaGet(app, user.id);

    const blank = await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      heroTitle: '   ',
    });
    expect(blank.statusCode).toBe(400);

    const tooLong = await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      institutionalBody: 'a'.repeat(1001),
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it('PUT com expectedUpdatedAt velho responde 409 e nao escreve', async () => {
    const user = await organizer();
    const before = await ensureRowViaGet(app, user.id);

    const first = await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      heroTitle: 'PRIMEIRO',
    });
    expect(first.statusCode).toBe(200);

    const stale = await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      heroTitle: 'SEGUNDO',
    });
    expect(stale.statusCode).toBe(409);
    expect((await readRow()).heroTitle).toBe('PRIMEIRO');
  });

  // Serial nao prova nada aqui: ler, comparar em JS e depois escrever passa
  // em serie e perde update em paralelo, porque Read Committed nao trava
  // linha no SELECT. Este teste e o unico que falha se o updateMany
  // condicional virar um update simples.
  it('duas escritas concorrentes com o mesmo expectedUpdatedAt: uma vence, a outra 409', async () => {
    const user = await organizer();
    const before = await ensureRowViaGet(app, user.id);

    const [a, b] = await Promise.all([
      put(user.id, { expectedUpdatedAt: before.updatedAt, heroTitle: 'A' }),
      put(user.id, { expectedUpdatedAt: before.updatedAt, heroTitle: 'B' }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const row = await readRow();
    expect(['A', 'B']).toContain(row.heroTitle);
  });

  it('PUT rejeita staff', async () => {
    const { user: staff } = await createUser({
      email: 'staff2@jdm.test',
      verified: true,
      role: 'staff',
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/home/content',
      headers: { authorization: bearer(loadEnv(), staff.id, 'staff') },
      payload: { expectedUpdatedAt: new Date().toISOString(), heroTitle: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('edicao no admin aparece no GET publico com a URL resolvida', async () => {
    const user = await organizer();
    const before = await ensureRowViaGet(app, user.id);
    const key = `${HOME_MEDIA_OBJECT_KEY_PREFIX}/${user.id}/banner.jpg`;

    const saved = await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      heroTitle: 'MOTE PUBLICO',
      heroSubtitle: 'subtitulo publico',
      heroBannerObjectKey: key,
      institutionalBody: 'Corpo institucional novo.',
    });
    expect(saved.statusCode).toBe(200);

    const publicRes = await app.inject({ method: 'GET', url: '/api/home-content' });
    expect(publicRes.statusCode).toBe(200);
    const body = homeContentResponseSchema.parse(publicRes.json());
    expect(body.hero.title).toBe('MOTE PUBLICO');
    expect(body.hero.subtitle).toBe('subtitulo publico');
    expect(body.hero.bannerUrl).toContain(key);
    // toContain sozinho passa para .../home-media/home-media/<id>/banner.jpg,
    // que e justamente o prefixo duplicado que este teste existe para pegar.
    expect(body.hero.bannerUrl?.match(/home-media\//g)).toHaveLength(1);
    expect(body.institutional.body).toBe('Corpo institucional novo.');
  });

  it('remover a imagem no admin zera a URL no GET publico', async () => {
    const user = await organizer();
    const before = await ensureRowViaGet(app, user.id);
    const key = `${HOME_MEDIA_OBJECT_KEY_PREFIX}/${user.id}/banner.jpg`;

    const first = await put(user.id, {
      expectedUpdatedAt: before.updatedAt,
      heroBannerObjectKey: key,
    });
    const afterFirst = adminHomeContentSchema.parse(first.json());
    // Sem isto o teste passa mesmo que o PUT nunca tenha gravado a key: a URL
    // ja estaria nula antes do clear e o toBeNull final nao provaria nada.
    expect(afterFirst.heroBannerObjectKey).toBe(key);
    expect(afterFirst.heroBannerUrl).not.toBeNull();

    await put(user.id, {
      expectedUpdatedAt: afterFirst.updatedAt,
      heroBannerObjectKey: '',
    });

    const publicRes = await app.inject({ method: 'GET', url: '/api/home-content' });
    const body = homeContentResponseSchema.parse(publicRes.json());
    expect(body.hero.bannerUrl).toBeNull();
  });

  it('presign devolve o shape padrao e uma key sob home-media/', async () => {
    const user = await organizer();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/home/images/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { contentType: 'image/jpeg', size: 1024 },
    });
    expect(res.statusCode).toBe(200);
    const body = presignResponseSchema.parse(res.json());
    expect(body.objectKey.startsWith(`${HOME_MEDIA_OBJECT_KEY_PREFIX}/`)).toBe(true);
  });

  it('presign ignora contentType e size invalidos', async () => {
    const user = await organizer();
    for (const payload of [
      { contentType: 'application/pdf', size: 1024 },
      { contentType: 'image/jpeg', size: 0 },
      { contentType: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1 },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/home/images/presign',
        headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('presign aceita o tamanho maximo exato', async () => {
    const user = await organizer();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/home/images/presign',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { contentType: 'image/jpeg', size: MAX_UPLOAD_BYTES },
    });
    expect(res.statusCode).toBe(200);
  });

  it('presign nao divide quota entre dois usuarios no mesmo IP', async () => {
    const a = await organizer();
    const { user: b } = await createUser({
      email: 'org2@jdm.test',
      verified: true,
      role: 'organizer',
    });

    const call = (id: string) =>
      app.inject({
        method: 'POST',
        url: '/admin/home/images/presign',
        headers: { authorization: bearer(loadEnv(), id, 'organizer') },
        payload: { contentType: 'image/jpeg', size: 1024 },
      });

    // Esgota a cota de A.
    for (let i = 0; i < 10; i++) await call(a.id);
    const exhausted = await call(a.id);
    expect(exhausted.statusCode).toBe(429);

    // B, mesmo IP, ainda passa. E isto que prova o hook: 'preHandler'; sem ele
    // o keyGenerator roda antes de request.user existir e cai para balde por IP.
    const other = await call(b.id);
    expect(other.statusCode).toBe(200);
  });

  it('presign rejeita staff', async () => {
    const { user: staff } = await createUser({
      email: 'staff3@jdm.test',
      verified: true,
      role: 'staff',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/home/images/presign',
      headers: { authorization: bearer(loadEnv(), staff.id, 'staff') },
      payload: { contentType: 'image/jpeg', size: 1024 },
    });
    expect(res.statusCode).toBe(403);
  });
});
