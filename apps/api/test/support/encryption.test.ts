/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { decryptField, encryptField } from '../../src/services/crypto/field-encryption.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('SupportTicket field encryption', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('stores message encrypted in DB, returns decrypted via API', async () => {
    const { user } = await createUser({ verified: true });
    const plainMessage = 'Preciso de ajuda com meu ingresso do evento';

    const res = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: { phone: '11999999999', message: plainMessage },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ message: plainMessage });

    const dbRow = await prisma.supportTicket.findFirst({ where: { userId: user.id } });
    expect(dbRow!.message).not.toBe(plainMessage);
    expect(dbRow!.message.startsWith('enc_v1:')).toBe(true);

    const decrypted = decryptField(dbRow!.message, env.FIELD_ENCRYPTION_KEY);
    expect(decrypted).toBe(plainMessage);
  });

  it('list endpoint returns decrypted messages', async () => {
    const { user } = await createUser({ verified: true });
    const msg = 'Mensagem de teste para listagem';

    await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: { phone: '11999999999', message: msg },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [{ message: msg }] });
  });

  it('admin close endpoint returns decrypted message', async () => {
    const { user } = await createUser({ verified: true });
    const { user: admin } = await createUser({
      email: 'admin@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const plainMsg = 'Ticket para fechar com criptografia';

    const createRes = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: { phone: '11999999999', message: plainMsg },
    });
    const ticketId = createRes.json().id as string;

    const closeRes = await app.inject({
      method: 'PATCH',
      url: `/admin/support/${ticketId}/close`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });

    expect(closeRes.statusCode).toBe(200);
    expect(closeRes.json()).toMatchObject({ message: plainMsg, status: 'closed' });
  });

  it('admin internal-status endpoint returns decrypted message', async () => {
    const { user } = await createUser({ verified: true });
    const { user: admin } = await createUser({
      email: 'admin2@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const plainMsg = 'Ticket para atualizar status interno';

    const createRes = await app.inject({
      method: 'POST',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
      payload: { phone: '11999999999', message: plainMsg },
    });
    const ticketId = createRes.json().id as string;

    const statusRes = await app.inject({
      method: 'PATCH',
      url: `/admin/support/${ticketId}/internal-status`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
      payload: { internalStatus: 'in_progress' },
    });

    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toMatchObject({
      message: plainMsg,
      internalStatus: 'in_progress',
    });
  });

  it('read paths survive undecryptable rows without 500', async () => {
    const { user } = await createUser({ verified: true });
    const { user: admin } = await createUser({
      email: 'admin3@jdm.test',
      verified: true,
      role: 'organizer',
    });

    const wrongKey = 'cd'.repeat(32);
    const corruptCipher = encryptField('secret message', wrongKey);

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        phone: '11999999999',
        message: corruptCipher,
        status: 'open',
      },
    });

    const userList = await app.inject({
      method: 'GET',
      url: '/me/support-tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(userList.statusCode).toBe(200);
    expect(userList.json().items).toHaveLength(1);
    expect(userList.json().items[0].message).toBe(corruptCipher);

    const adminList = await app.inject({
      method: 'GET',
      url: '/admin/support',
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().items).toHaveLength(1);

    const adminDetail = await app.inject({
      method: 'GET',
      url: `/admin/support/${ticket.id}`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(adminDetail.statusCode).toBe(200);

    const closeRes = await app.inject({
      method: 'PATCH',
      url: `/admin/support/${ticket.id}/close`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });
    expect(closeRes.statusCode).toBe(200);
  });
});
