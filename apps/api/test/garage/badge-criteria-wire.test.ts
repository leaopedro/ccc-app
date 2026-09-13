import { prisma } from '@ccc/db';
import { adminGamificationCopySchema } from '@ccc/shared/admin-gamification';
import { badgeCatalogResponseSchema, garageBadgesOwnerResponseSchema } from '@ccc/shared/badges';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { invalidateBadgesCatalogCache } from '../../src/routes/badges-catalog.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// O critério ("como ganhar") é o texto que a tela de conquistas bloqueadas
// mostra. Ele nasce numa coluna de `Badge`, é editável pelo admin, e tem de
// chegar intacto às três leituras que o app faz.

const seedOne = () =>
  prisma.badge.create({
    data: {
      code: 'EVT-001',
      category: 'eventos',
      rarity: 'common',
      icon: 'flag',
      title: 'Primeira Largada',
      description: 'Seu primeiro check-in.',
      criteria: 'Faça check-in em qualquer evento.',
    },
  });

describe('critério no wire das conquistas', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.generalSettings.deleteMany();
    invalidateBadgesCatalogCache();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /me/garage/badges devolve o critério de cada entrada do catálogo', async () => {
    await seedOne();
    const { user } = await createUser({ email: 'criteria-owner@jdm.test', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });

    expect(res.statusCode).toBe(200);
    const body = garageBadgesOwnerResponseSchema.parse(res.json());
    expect(body.catalog[0]?.criteria).toBe('Faça check-in em qualquer evento.');
  });

  it('GET /badges/catalog devolve o critério', async () => {
    await seedOne();

    const res = await app.inject({ method: 'GET', url: '/badges/catalog' });

    expect(res.statusCode).toBe(200);
    const body = badgeCatalogResponseSchema.parse(res.json());
    expect(body.catalog[0]?.criteria).toBe('Faça check-in em qualquer evento.');
  });

  it('o admin edita o critério e a leitura seguinte reflete', async () => {
    await seedOne();
    const { user: admin } = await createUser({
      email: 'criteria-admin@jdm.test',
      verified: true,
      role: 'admin',
    });
    const auth = { authorization: bearer(loadEnv(), admin.id, 'admin') };

    const before = adminGamificationCopySchema.parse(
      (await app.inject({ method: 'GET', url: '/admin/gamification/copy', headers: auth })).json(),
    );
    expect(before.badges[0]?.criteria).toBe('Faça check-in em qualquer evento.');

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/gamification/copy',
      headers: auth,
      payload: {
        expectedVersion: before.version,
        badges: [
          {
            code: 'EVT-001',
            title: before.badges[0]!.title,
            description: before.badges[0]!.description,
            criteria: 'Escaneie seu ingresso na entrada do evento.',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const after = adminGamificationCopySchema.parse(res.json());
    expect(after.badges[0]?.criteria).toBe('Escaneie seu ingresso na entrada do evento.');
    expect(after.version).toBe(before.version + 1);
  });

  it('mudar só o critério conta como mudança e entra na auditoria', async () => {
    // A versão só incrementa quando `touched` não está vazio. Se o diff não
    // enxergasse o critério, um PUT que muda apenas ele devolveria a leitura
    // sem gravar nada — falha silenciosa, a pior forma de perder uma edição.
    await seedOne();
    const { user: admin } = await createUser({
      email: 'criteria-audit@jdm.test',
      verified: true,
      role: 'admin',
    });
    const auth = { authorization: bearer(loadEnv(), admin.id, 'admin') };

    const before = adminGamificationCopySchema.parse(
      (await app.inject({ method: 'GET', url: '/admin/gamification/copy', headers: auth })).json(),
    );

    await app.inject({
      method: 'PUT',
      url: '/admin/gamification/copy',
      headers: auth,
      payload: {
        expectedVersion: before.version,
        badges: [
          {
            code: 'EVT-001',
            title: before.badges[0]!.title,
            description: before.badges[0]!.description,
            criteria: 'Critério novo.',
          },
        ],
      },
    });

    const audit = await prisma.adminAudit.findFirst({
      where: { action: 'gamification_copy.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect((audit?.metadata as { fields?: string[] } | null)?.fields).toContain(
      'badge.EVT-001.criteria',
    );
  });
});
