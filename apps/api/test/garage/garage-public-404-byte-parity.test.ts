import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /g/:slug — 404 byte parity (§C9)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('unknown slug and private slug return byte-identical 404', async () => {
    const a = await app.inject({ method: 'GET', url: '/g/unknown-slug-12345' });
    const { user: owner } = await createUser({ verified: true });
    await prisma.garage.update({
      where: { userId: owner.id },
      data: { slug: 'private-slug-12345', isPublic: false },
    });
    const b = await app.inject({ method: 'GET', url: '/g/private-slug-12345' });

    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(404);
    expect(a.body).toBe(b.body);
    expect(a.headers['content-type']).toBe(b.headers['content-type']);
  });
});
