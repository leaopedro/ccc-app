import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/signup creates Garage atomically with User', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('produces a Garage row with neutral defaults that never leaks the user name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email: 'novato@jdm.test',
        password: 'correct-horse-battery-staple',
        name: 'Tiago Apellido Pessoal',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ user: { id: string } }>();

    const garage = await prisma.garage.findUnique({ where: { userId: body.user.id } });
    expect(garage).not.toBeNull();
    expect(garage!.name).toBe('Garagem');
    expect(garage!.slug).toMatch(/^user-/);
    expect(garage!.isPublic).toBe(false);
    expect(garage!.premiumTier).toBeNull();
    expect(garage!.premiumUntil).toBeNull();
    expect(garage!.description).toBeNull();

    // Slug must NOT be derived from the user name.
    expect(garage!.slug.toLowerCase().includes('tiago')).toBe(false);
    expect(garage!.slug.toLowerCase().includes('apellido')).toBe(false);
  });
});
