import { prisma } from '@jdm/db';
import { garageReadSchema } from '@jdm/shared/garage';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /me/garage', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the caller garage with neutral defaults + cars + spots', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = garageReadSchema.parse(res.json());
    expect(body.garage.name).toBe('Garagem');
    expect(body.garage.slug).toMatch(/^user-/);
    expect(body.garage.isPublic).toBe(false);
    expect(body.garage.premiumTier).toBeNull();
    expect(body.garage.isPremiumActive).toBe(false);
    // Default settings: no GeneralSettings row exists in tests until ensure*
    // creates one — defaultFreeGarageSpots starts null → isUnlimited=true.
    expect(body.isUnlimited).toBe(true);
    expect(body.freeLimit).toBeNull();
    // §15.6 capability flag — defaults to enabled (DB default + helper
    // fallback). New user has no earned badges yet, but the catalog is
    // present so unowned entries surface as `locked`/`locked_premium`.
    expect(body.garage.gamification.enabled).toBe(true);
    expect(Array.isArray(body.garage.badges)).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/garage' });
    expect(res.statusCode).toBe(401);
  });

  it('propagates owner isPremiumActive=true to every car payload', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.garage.update({
      where: { userId: user.id },
      data: { premiumTier: 'gold', premiumUntil: null },
    });
    await prisma.car.create({
      data: {
        userId: user.id,
        make: 'Toyota',
        model: 'Supra',
        year: 1994,
        nickname: 'mk4',
      },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = garageReadSchema.parse(res.json());
    expect(body.garage.isPremiumActive).toBe(true);
    expect(body.cars).toHaveLength(1);
    expect(body.cars[0]?.isPremiumActive).toBe(true);
  });
});

describe('PATCH /me/garage', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('updates name, slug, description, isPublic', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        name: 'Minha Garagem JDM',
        slug: 'minha-jdm',
        description: 'Carros antigos',
        isPublic: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = z.object({ garage: garageReadSchema.shape.garage }).parse(res.json());
    expect(body.garage.name).toBe('Minha Garagem JDM');
    expect(body.garage.slug).toBe('minha-jdm');
    expect(body.garage.description).toBe('Carros antigos');
    expect(body.garage.isPublic).toBe(true);
  });

  it('rejects reserved slug with 400', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage',
      headers: { authorization: bearer(env, user.id) },
      payload: { slug: 'admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('reserved_slug');
  });

  it('returns 409 when slug is taken by another garage', async () => {
    const { user: a } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: b } = await createUser({ email: 'b@jdm.test', verified: true });
    await prisma.garage.update({
      where: { userId: a.id },
      data: { slug: 'sneaky' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage',
      headers: { authorization: bearer(env, b.id) },
      payload: { slug: 'sneaky' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('slug_taken');
  });

  it('rejects bad slug shape with invalid_slug', async () => {
    // §C7: regex violation surfaces as `400 { error: 'invalid_slug' }` so the
    // client can distinguish "bad characters" from "slug already taken" (409)
    // and "reserved slug" (also 400 but different `error` code).
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me/garage',
      headers: { authorization: bearer(env, user.id) },
      payload: { slug: 'My Garage' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_slug');
  });
});
