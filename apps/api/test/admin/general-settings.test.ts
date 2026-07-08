import { prisma } from '@ccc/db';
import { GENERAL_SETTINGS_SINGLETON_ID, generalSettingsSchema } from '@ccc/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, resetDatabase, makeApp } from '../helpers.js';

const ensureSettings = async () => {
  await prisma.generalSettings.upsert({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    update: {},
    create: { id: GENERAL_SETTINGS_SINGLETON_ID },
  });
};

describe('admin general settings', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.generalSettings.deleteMany();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /admin/general/settings auto-seeds defaults when missing', async () => {
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = generalSettingsSchema.parse(res.json());
    expect(body.id).toBe(GENERAL_SETTINGS_SINGLETON_ID);
    expect(body.capacityDisplay.tickets).toEqual({ mode: 'absolute', thresholdPercent: 15 });
    expect(body.capacityDisplay.extras).toEqual({ mode: 'absolute', thresholdPercent: 15 });
    expect(body.capacityDisplay.products).toEqual({ mode: 'absolute', thresholdPercent: 15 });
  });

  it('PUT updates only the supplied surfaces and persists', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: {
        capacityDisplay: {
          tickets: { mode: 'hidden' },
          products: { mode: 'percentage_threshold', thresholdPercent: 25 },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = generalSettingsSchema.parse(res.json());
    expect(body.capacityDisplay.tickets.mode).toBe('hidden');
    expect(body.capacityDisplay.tickets.thresholdPercent).toBe(15);
    expect(body.capacityDisplay.products.mode).toBe('percentage_threshold');
    expect(body.capacityDisplay.products.thresholdPercent).toBe(25);
    expect(body.capacityDisplay.extras.mode).toBe('absolute');

    const persisted = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    expect(persisted.ticketCapacityMode).toBe('hidden');
    expect(persisted.productCapacityMode).toBe('percentage_threshold');
    expect(persisted.productCapacityThresholdPercent).toBe(25);
  });

  it('PUT writes an admin audit row tagged with the touched fields', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { capacityDisplay: { extras: { mode: 'hidden' } } },
    });
    const audits = await prisma.adminAudit.findMany({
      where: { entityType: 'general_settings' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(user.id);
    expect(audits[0]!.action).toBe('general_settings.update');
    expect(audits[0]!.entityId).toBe(GENERAL_SETTINGS_SINGLETON_ID);
    const metadata = audits[0]!.metadata as { fields: string[] };
    expect(metadata.fields).toContain('capacityDisplay.extras.mode');
  });

  it('PUT rejects empty body', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT rejects out-of-range threshold', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { capacityDisplay: { events: { thresholdPercent: 150 } } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects staff role', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'staff@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/general/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('GET auto-seeded settings expose defaultFreeGarageSpots as null (unlimited)', async () => {
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = generalSettingsSchema.parse(res.json());
    expect(body.defaultFreeGarageSpots).toBeNull();
  });

  it('PUT persists defaultFreeGarageSpots = null', async () => {
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: { defaultFreeGarageSpots: 3 },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, defaultFreeGarageSpots: 3 },
    });
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { defaultFreeGarageSpots: null },
    });
    expect(res.statusCode).toBe(200);
    const body = generalSettingsSchema.parse(res.json());
    expect(body.defaultFreeGarageSpots).toBeNull();
    const persisted = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    expect(persisted.defaultFreeGarageSpots).toBeNull();
  });

  it('PUT persists defaultFreeGarageSpots = 0 (distinct from null)', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { defaultFreeGarageSpots: 0 },
    });
    expect(res.statusCode).toBe(200);
    const body = generalSettingsSchema.parse(res.json());
    expect(body.defaultFreeGarageSpots).toBe(0);
    const persisted = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    expect(persisted.defaultFreeGarageSpots).toBe(0);
  });

  it('PUT persists a positive defaultFreeGarageSpots', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { defaultFreeGarageSpots: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = generalSettingsSchema.parse(res.json());
    expect(body.defaultFreeGarageSpots).toBe(5);
    const persisted = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    expect(persisted.defaultFreeGarageSpots).toBe(5);
  });

  it('PUT records audit metadata with previous/next when defaultFreeGarageSpots changes', async () => {
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: { defaultFreeGarageSpots: 1 },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, defaultFreeGarageSpots: 1 },
    });
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { defaultFreeGarageSpots: 5 },
    });
    const audits = await prisma.adminAudit.findMany({
      where: { entityType: 'general_settings' },
    });
    expect(audits).toHaveLength(1);
    const metadata = audits[0]!.metadata as {
      fields: string[];
      defaultFreeGarageSpots: { previous: number | null; next: number | null };
    };
    expect(metadata.fields).toContain('defaultFreeGarageSpots');
    expect(metadata.defaultFreeGarageSpots).toEqual({ previous: 1, next: 5 });
  });

  it('PUT skips the audit row entirely when nothing actually changed', async () => {
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: { defaultFreeGarageSpots: 3 },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, defaultFreeGarageSpots: 3 },
    });
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { defaultFreeGarageSpots: 3 },
    });
    expect(res.statusCode).toBe(200);
    const audits = await prisma.adminAudit.findMany({
      where: { entityType: 'general_settings' },
    });
    expect(audits).toHaveLength(0);
  });

  it('PUT skips audit + DB write when full capacity payload matches existing values', async () => {
    // The admin form always submits the full capacity payload (mode +
    // thresholdPercent) for every surface, so a Save with no real changes
    // must not bump `updatedAt` or insert an audit row.
    await ensureSettings();
    const seeded = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: {
        capacityDisplay: {
          tickets: { mode: 'absolute', thresholdPercent: 15 },
          extras: { mode: 'absolute', thresholdPercent: 15 },
          products: { mode: 'absolute', thresholdPercent: 15 },
        },
      },
    });
    expect(res.statusCode).toBe(200);

    const audits = await prisma.adminAudit.findMany({
      where: { entityType: 'general_settings' },
    });
    expect(audits).toHaveLength(0);

    const after = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    expect(after.updatedAt.getTime()).toBe(seeded.updatedAt.getTime());
  });

  it('PUT records only the surface fields that actually changed when mixed with unchanged ones', async () => {
    // tickets unchanged from defaults; products mode flipped; extras
    // thresholdPercent changed; garage cap unchanged.
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: { defaultFreeGarageSpots: 4 },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, defaultFreeGarageSpots: 4 },
    });
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: {
        capacityDisplay: {
          tickets: { mode: 'absolute', thresholdPercent: 15 },
          extras: { mode: 'absolute', thresholdPercent: 30 },
          products: { mode: 'hidden', thresholdPercent: 15 },
        },
        defaultFreeGarageSpots: 4,
      },
    });
    expect(res.statusCode).toBe(200);

    const audits = await prisma.adminAudit.findMany({
      where: { entityType: 'general_settings' },
    });
    expect(audits).toHaveLength(1);
    const metadata = audits[0]!.metadata as { fields: string[] };
    expect(metadata.fields.sort()).toEqual(
      ['capacityDisplay.extras.thresholdPercent', 'capacityDisplay.products.mode'].sort(),
    );
    expect(metadata.fields).not.toContain('capacityDisplay.tickets.mode');
    expect(metadata.fields).not.toContain('capacityDisplay.tickets.thresholdPercent');
    expect(metadata.fields).not.toContain('defaultFreeGarageSpots');
  });

  it('PUT handles mixed body (capacityDisplay + defaultFreeGarageSpots)', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: {
        capacityDisplay: { tickets: { mode: 'hidden' } },
        defaultFreeGarageSpots: 2,
      },
    });
    expect(res.statusCode).toBe(200);
    const persisted = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    expect(persisted.ticketCapacityMode).toBe('hidden');
    expect(persisted.defaultFreeGarageSpots).toBe(2);
  });

  it('PUT rejects negative defaultFreeGarageSpots', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { defaultFreeGarageSpots: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT rejects defaultFreeGarageSpots above the Postgres Int4 max with a 400', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { defaultFreeGarageSpots: 9999999999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET exposes gamificationEnabled with the DB default (true) when seeded', async () => {
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = generalSettingsSchema.parse(res.json());
    expect(body.gamificationEnabled).toBe(true);
  });

  it('PUT flips gamificationEnabled to false + writes audit row with previous/next', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { gamificationEnabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = generalSettingsSchema.parse(res.json());
    expect(body.gamificationEnabled).toBe(false);

    const persisted = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    expect(persisted.gamificationEnabled).toBe(false);

    const audits = await prisma.adminAudit.findMany({
      where: { entityType: 'general_settings' },
    });
    expect(audits).toHaveLength(1);
    const metadata = audits[0]!.metadata as {
      fields: string[];
      gamificationEnabled: { previous: boolean; next: boolean };
    };
    expect(metadata.fields).toContain('gamificationEnabled');
    expect(metadata.gamificationEnabled).toEqual({ previous: true, next: false });
  });

  it('PUT no-op when gamificationEnabled matches the existing value', async () => {
    await ensureSettings();
    const { user } = await createUser({ email: 'org@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/general/settings',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { gamificationEnabled: true },
    });
    expect(res.statusCode).toBe(200);
    const audits = await prisma.adminAudit.findMany({
      where: { entityType: 'general_settings' },
    });
    expect(audits).toHaveLength(0);
  });
});
