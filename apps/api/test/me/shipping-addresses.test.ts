import { prisma } from '@jdm/db';
import { shippingAddressListResponseSchema, shippingAddressRecordSchema } from '@jdm/shared/store';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const baseAddress = {
  recipientName: 'Pedro Alves',
  phone: '41999998888',
  postalCode: '80000-000',
  street: 'Rua das Oficinas',
  number: '245',
  neighborhood: 'Centro',
  city: 'Curitiba',
  stateCode: 'PR',
};

describe('shipping addresses CRUD', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates the first address as default automatically', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: { authorization: bearer(env, user.id) },
      payload: baseAddress,
    });
    expect(res.statusCode).toBe(201);
    const body = shippingAddressRecordSchema.parse(res.json());
    expect(body.isDefault).toBe(true);
    expect(body.street).toBe('Rua das Oficinas');
    expect(body.neighborhood).toBe('Centro');
  });

  it('lists addresses with default first', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const auth = { authorization: bearer(env, user.id) };

    await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: auth,
      payload: baseAddress,
    });
    await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: auth,
      payload: { ...baseAddress, recipientName: 'Outra Pessoa', isDefault: true },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/me/shipping-addresses',
      headers: auth,
    });
    expect(list.statusCode).toBe(200);
    const body = shippingAddressListResponseSchema.parse(list.json());
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.isDefault).toBe(true);
    expect(body.items[0]?.recipientName).toBe('Outra Pessoa');
    expect(body.items[1]?.isDefault).toBe(false);
  });

  it('flips default atomically across addresses', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const auth = { authorization: bearer(env, user.id) };

    const first = await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: auth,
      payload: baseAddress,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: auth,
      payload: { ...baseAddress, recipientName: 'Segundo' },
    });
    const firstId = shippingAddressRecordSchema.parse(first.json()).id;
    const secondId = shippingAddressRecordSchema.parse(second.json()).id;

    const flip = await app.inject({
      method: 'PATCH',
      url: `/me/shipping-addresses/${secondId}`,
      headers: auth,
      payload: { isDefault: true },
    });
    expect(flip.statusCode).toBe(200);

    const after = await prisma.shippingAddress.findMany({
      where: { userId: user.id },
      orderBy: { id: 'asc' },
    });
    const defaults = after.filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(secondId);
    expect(after.find((a) => a.id === firstId)?.isDefault).toBe(false);
  });

  it('rejects duplicate default at the database layer', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const auth = { authorization: bearer(env, user.id) };

    const created = await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: auth,
      payload: baseAddress,
    });
    const id = shippingAddressRecordSchema.parse(created.json()).id;

    await expect(
      prisma.shippingAddress.create({
        data: {
          userId: user.id,
          recipientName: 'Bypass',
          phone: '41999998888',
          postalCode: '80000-000',
          line1: 'Rua X',
          number: '1',
          district: 'Centro',
          city: 'Curitiba',
          stateCode: 'PR',
          isDefault: true,
        },
      }),
    ).rejects.toThrow();

    const after = await prisma.shippingAddress.findUnique({ where: { id } });
    expect(after?.isDefault).toBe(true);
  });

  it('updates address fields without touching default flag', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const auth = { authorization: bearer(env, user.id) };

    const created = await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: auth,
      payload: baseAddress,
    });
    const id = shippingAddressRecordSchema.parse(created.json()).id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/me/shipping-addresses/${id}`,
      headers: auth,
      payload: { city: 'São Paulo', stateCode: 'SP' },
    });
    expect(patch.statusCode).toBe(200);
    const body = shippingAddressRecordSchema.parse(patch.json());
    expect(body.city).toBe('São Paulo');
    expect(body.stateCode).toBe('SP');
    expect(body.isDefault).toBe(true);
  });

  it('deletes an owned address', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const auth = { authorization: bearer(env, user.id) };

    const created = await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: auth,
      payload: baseAddress,
    });
    const id = shippingAddressRecordSchema.parse(created.json()).id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/me/shipping-addresses/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);

    const remaining = await prisma.shippingAddress.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(0);
  });

  it("returns 404 for someone else's address", async () => {
    const { user: alice } = await createUser({ verified: true, email: 'alice@jdm.test' });
    const { user: bob } = await createUser({ verified: true, email: 'bob@jdm.test' });
    const env = loadEnv();

    const created = await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: { authorization: bearer(env, alice.id) },
      payload: baseAddress,
    });
    const id = shippingAddressRecordSchema.parse(created.json()).id;

    const peek = await app.inject({
      method: 'PATCH',
      url: `/me/shipping-addresses/${id}`,
      headers: { authorization: bearer(env, bob.id) },
      payload: { city: 'X' },
    });
    expect(peek.statusCode).toBe(404);

    const del = await app.inject({
      method: 'DELETE',
      url: `/me/shipping-addresses/${id}`,
      headers: { authorization: bearer(env, bob.id) },
    });
    expect(del.statusCode).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me/shipping-addresses',
    });
    expect(res.statusCode).toBe(401);
  });

  it('validates CEP format', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/shipping-addresses',
      headers: { authorization: bearer(env, user.id) },
      payload: { ...baseAddress, postalCode: '8000-000' },
    });
    expect(res.statusCode).toBe(400);
  });
});
