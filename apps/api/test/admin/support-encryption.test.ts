import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { encryptField } from '../../src/services/crypto/field-encryption.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('Admin support ticket encryption', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('admin list returns decrypted messages', async () => {
    const { user } = await createUser({ verified: true });
    const { user: admin } = await createUser({
      email: 'admin@jdm.test',
      role: 'admin',
      verified: true,
    });
    const plain = 'Mensagem criptografada para admin';

    await prisma.supportTicket.create({
      data: {
        userId: user.id,
        phone: '11999999999',
        message: encryptField(plain, env.FIELD_ENCRYPTION_KEY),
        status: 'open',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/support',
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [{ message: plain }] });
  });

  it('admin detail returns decrypted message', async () => {
    const { user } = await createUser({ verified: true });
    const { user: admin } = await createUser({
      email: 'admin@jdm.test',
      role: 'admin',
      verified: true,
    });
    const plain = 'Detalhes da mensagem criptografada';

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        phone: '11999999999',
        message: encryptField(plain, env.FIELD_ENCRYPTION_KEY),
        status: 'open',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/support/${ticket.id}`,
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ message: plain });
  });
});
