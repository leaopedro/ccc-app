/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /me/support-tickets', () => {
  let app: FastifyInstance;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      payload: { phone: '11999999999', message: 'ajuda' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a ticket with phone, message (no attachment)', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: { phone: '11999999999', message: 'Preciso de ajuda com meu ingresso.' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      phone: '11999999999',
      message: 'Preciso de ajuda com meu ingresso.',
      status: 'open',
      attachmentUrl: null,
    });
    expect(body.id).toBeTruthy();
    expect(body.createdAt).toBeTruthy();
  });

  it('normalizes phone digits (strips formatting)', async () => {
    const { user } = await createUser({ email: 'u2@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: { phone: '(11) 9 9999-9999', message: 'Teste de normalização.' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().phone).toBe('11999999999');
  });

  it('rejects message over 2000 chars', async () => {
    const { user } = await createUser({ email: 'u3@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: { phone: '11999999999', message: 'x'.repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects phone under 10 digits', async () => {
    const { user } = await createUser({ email: 'u4@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: { phone: '119999', message: 'Mensagem válida.' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects attachment with wrong owner prefix', async () => {
    const { user } = await createUser({ email: 'u5@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        phone: '11999999999',
        message: 'Mensagem com anexo inválido.',
        attachmentObjectKey: 'support_attachment/other-user-id/arquivo.jpg',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
  });

  it('accepts valid attachment key owned by current user', async () => {
    const { user } = await createUser({ email: 'u6@jdm.test', verified: true });
    const validKey = `support_attachment/${user.id}/arquivo.jpg`;
    const res = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        phone: '11999999999',
        message: 'Mensagem com anexo válido.',
        attachmentObjectKey: validKey,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.attachmentUrl).not.toBeNull();
  });
});

describe('GET /me/support-tickets', () => {
  let app: FastifyInstance;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/support-tickets' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty list when no tickets', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('returns only open tickets (closed tickets excluded)', async () => {
    const { user } = await createUser({ email: 'u2@jdm.test', verified: true });

    await prisma.supportTicket.create({
      data: { userId: user.id, phone: '11999999999', message: 'aberto', status: 'open' },
    });
    await prisma.supportTicket.create({
      data: { userId: user.id, phone: '11999999999', message: 'fechado', status: 'closed' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].message).toBe('aberto');
    expect(body.items[0].status).toBe('open');
  });

  it('returns tickets belonging to current user only', async () => {
    const { user } = await createUser({ email: 'u3@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'other@jdm.test', verified: true });

    await prisma.supportTicket.create({
      data: { userId: user.id, phone: '11999999999', message: 'meu ticket', status: 'open' },
    });
    await prisma.supportTicket.create({
      data: { userId: other.id, phone: '11888888888', message: 'ticket alheio', status: 'open' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].message).toBe('meu ticket');
  });
});
