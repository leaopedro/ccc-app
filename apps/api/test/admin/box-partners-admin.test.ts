import { adminPartnerListSchema, adminPartnerSchema } from '@ccc/shared/admin-box';
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

describe('admin box partners', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('creates a partner, adds a module, lists nested, soft-deletes', async () => {
    const header = await org();

    const p = await app.inject({
      method: 'POST',
      url: '/admin/box/partners',
      headers: { authorization: header },
      payload: { slug: 'oficina-x', name: 'Oficina X' },
    });
    expect(p.statusCode).toBe(201);
    const partner = adminPartnerSchema.parse(p.json());
    expect(partner.modules).toEqual([]);

    const m = await app.inject({
      method: 'POST',
      url: `/admin/box/partners/${partner.id}/modules`,
      headers: { authorization: header },
      payload: { name: 'Kit lavagem', priceCents: 9900 },
    });
    expect(m.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/admin/box/partners',
      headers: { authorization: header },
    });
    const parsed = adminPartnerListSchema.parse(list.json());
    expect(parsed.partners[0]?.modules).toHaveLength(1);

    const moduleId = parsed.partners[0]!.modules[0]!.id;
    const delMod = await app.inject({
      method: 'DELETE',
      url: `/admin/box/partner-modules/${moduleId}`,
      headers: { authorization: header },
    });
    expect(delMod.statusCode).toBe(200);
  });
});
