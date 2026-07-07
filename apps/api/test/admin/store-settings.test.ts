import { prisma } from '@jdm/db';
import { STORE_SETTINGS_SINGLETON_ID, storeSettingsSchema } from '@jdm/shared/store';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, resetDatabase, makeApp } from '../helpers.js';

const ensureSettings = async () => {
  await prisma.storeSettings.upsert({
    where: { id: STORE_SETTINGS_SINGLETON_ID },
    update: {},
    create: { id: STORE_SETTINGS_SINGLETON_ID },
  });
};

describe('admin store settings', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.storeSettings.deleteMany();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /admin/store/settings returns the singleton even when not pre-seeded', async () => {
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = storeSettingsSchema.parse(res.json());
    expect(body.id).toBe(STORE_SETTINGS_SINGLETON_ID);
    expect(body.storeEnabled).toBe(true);
    expect(body.defaultShippingFeeCents).toBe(0);
    expect(body.lowStockThreshold).toBe(5);
    expect(body.storeHeaderTitle).toBeNull();
    expect(body.storeHeaderSubtitle).toBeNull();
    expect(body.eventPickupEnabled).toBe(false);
    expect(body.pickupDisplayLabel).toBeNull();
    expect(body.supportPhone).toBeNull();
  });

  it('GET returns the seeded singleton without 404 on first load', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: STORE_SETTINGS_SINGLETON_ID });
  });

  it('PUT updates only the supplied fields and persists', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/store/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: {
        storeEnabled: false,
        defaultShippingFeeCents: 1990,
        storeHeaderTitle: 'Drop novo. Corre antes que acabe.',
        storeHeaderSubtitle: 'Itens oficiais da cena JDM com estoque limitado.',
        eventPickupEnabled: true,
        pickupDisplayLabel: 'Retirada na sede',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = storeSettingsSchema.parse(res.json());
    expect(body.storeEnabled).toBe(false);
    expect(body.defaultShippingFeeCents).toBe(1990);
    expect(body.storeHeaderTitle).toBe('Drop novo. Corre antes que acabe.');
    expect(body.storeHeaderSubtitle).toBe('Itens oficiais da cena JDM com estoque limitado.');
    expect(body.eventPickupEnabled).toBe(true);
    expect(body.pickupDisplayLabel).toBe('Retirada na sede');
    expect(body.lowStockThreshold).toBe(5);

    const persisted = await prisma.storeSettings.findUniqueOrThrow({
      where: { id: STORE_SETTINGS_SINGLETON_ID },
    });
    expect(persisted.storeEnabled).toBe(false);
    expect(persisted.defaultShippingFeeCents).toBe(1990);
    expect(persisted.storeHeaderTitle).toBe('Drop novo. Corre antes que acabe.');
    expect(persisted.storeHeaderSubtitle).toBe('Itens oficiais da cena JDM com estoque limitado.');
    expect(persisted.eventPickupEnabled).toBe(true);
    expect(persisted.pickupDisplayLabel).toBe('Retirada na sede');
  });

  it('PUT writes an admin audit row', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    await app.inject({
      method: 'PUT',
      url: '/admin/store/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { lowStockThreshold: 12 },
    });
    const audits = await prisma.adminAudit.findMany({
      where: { entityType: 'store_settings' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(user.id);
    expect(audits[0]!.action).toBe('store_settings.update');
    expect(audits[0]!.entityId).toBe(STORE_SETTINGS_SINGLETON_ID);
  });

  it('PUT rejects empty body', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/store/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT rejects negative shipping fee', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/store/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { defaultShippingFeeCents: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects staff role', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'staff@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/store/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/store/settings' });
    expect(res.statusCode).toBe(401);
  });
});
