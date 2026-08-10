import { prisma } from '@ccc/db';
import { adminBoxSettingsSchema, BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();
const org = async () => {
  const { user } = await createUser({
    email: `org-${Date.now()}@jdm-test.local`,
    name: 'org',
    verified: true,
    role: 'organizer',
  });
  return bearer(env, user.id, 'organizer');
};

describe('admin box settings', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('returns defaults then persists an update', async () => {
    const header = await org();

    const get = await app.inject({
      method: 'GET',
      url: '/admin/box/settings',
      headers: { authorization: header },
    });
    expect(get.statusCode).toBe(200);
    const defaults = adminBoxSettingsSchema.parse(get.json());
    expect(defaults.boxEnabled).toBe(false);

    const put = await app.inject({
      method: 'PUT',
      url: '/admin/box/settings',
      headers: { authorization: header },
      payload: {
        boxEnabled: true,
        cutoffDaysBeforeRenewal: 7,
        freeShippingCepRanges: [{ from: '80000-000', to: '83800-999' }],
        shippingFeeCents: 1990,
      },
    });
    expect(put.statusCode).toBe(200);
    const saved = adminBoxSettingsSchema.parse(put.json());
    expect(saved.boxEnabled).toBe(true);
    expect(saved.cutoffDaysBeforeRenewal).toBe(7);
    expect(saved.freeShippingCepRanges).toHaveLength(1);
  });

  it('keeps a single settings row under the fixed id', async () => {
    const header = await org();
    await app.inject({
      method: 'GET',
      url: '/admin/box/settings',
      headers: { authorization: header },
    });
    await app.inject({
      method: 'GET',
      url: '/admin/box/settings',
      headers: { authorization: header },
    });
    const rows = await prisma.boxSettings.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(BOX_SETTINGS_SINGLETON_ID);
  });
});
