import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DevMailer } from '../../src/services/mailer/dev.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/forgot-password', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    (app.mailer as DevMailer).clear();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a reset token and emails the user', async () => {
    const { user } = await createUser({ email: 'reset@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: user.email },
    });
    expect(res.statusCode).toBe(200);
    const mail = (app.mailer as DevMailer).find('reset@jdm.test');
    expect(mail?.html).toContain('/reset-password?token=');
    const count = await prisma.passwordResetToken.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it('returns 200 for unknown emails (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'ghost@jdm.test' },
    });
    expect(res.statusCode).toBe(200);
    expect((app.mailer as DevMailer).captured).toHaveLength(0);
  });
});
