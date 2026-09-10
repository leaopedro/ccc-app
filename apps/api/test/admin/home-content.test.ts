import { prisma } from '@ccc/db';
import { adminHomeContentSchema } from '@ccc/shared/admin-home';
import { HOME_CONTENT_SINGLETON_ID } from '@ccc/shared/home';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, resetDatabase, makeApp } from '../helpers.js';

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
});
