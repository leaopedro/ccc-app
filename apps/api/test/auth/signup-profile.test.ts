import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isEncrypted } from '../../src/services/crypto/field-encryption.js';
import { makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/signup with optional profile fields', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  const base = {
    name: 'Ana Souza',
    email: 'ana@ccc.test',
    password: 'correct-horse-battery-staple',
  };

  it('creates the account with only name, email and password', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: base });
    expect(res.statusCode).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: base.email } });
    expect(row.cpf).toBeNull();
    expect(row.phone).toBeNull();
    // The garage invariant must survive the change.
    expect(await prisma.garage.count({ where: { userId: row.id } })).toBe(1);
  });

  it('persists cpf encrypted and phone in the clear when supplied', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...base, cpf: '529.982.247-25', phone: '(11) 98765-4321' },
    });
    expect(res.statusCode).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: base.email } });
    expect(isEncrypted(row.cpf!)).toBe(true);
    expect(row.cpf).not.toContain('52998224725');
    expect(row.phone).toBe('11987654321');
  });

  it('rejects an invalid cpf with 400 and creates no user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...base, cpf: '529.982.247-26' },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { email: base.email } })).toBe(0);
  });

  it('rejects an invalid phone with 400 and creates no user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...base, phone: '0198765' },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { email: base.email } })).toBe(0);
  });

  it('never echoes cpf or phone in the auth response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...base, cpf: '529.982.247-25', phone: '11987654321' },
    });
    expect(res.body).not.toContain('52998224725');
    expect(res.body).not.toContain('11987654321');
    expect(res.body).not.toContain('enc_v1:');
  });
});
