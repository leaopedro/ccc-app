import { prisma } from '@ccc/db';
import { adminGamificationCopySchema } from '@ccc/shared/admin-gamification';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, resetDatabase, makeApp } from '../helpers.js';

const seedTwo = async () => {
  await prisma.badge.createMany({
    data: [
      {
        code: 'EVT-001',
        category: 'eventos',
        rarity: 'common',
        icon: 'flag',
        title: 'Primeira Largada',
        description: 'Desc 1',
      },
      {
        code: 'CAR-001',
        category: 'carros',
        rarity: 'common',
        icon: 'car',
        title: 'Garagem Aberta',
        description: 'Desc 2',
      },
    ],
  });
};

const FULL_RANKS = {
  iniciante: 'Novato',
  pilotador: 'Piloto',
  veterano: 'Veterano',
  lendario: 'Lenda',
  hall_of_fame: 'Panteão',
};

describe('admin gamification copy', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.generalSettings.deleteMany();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const admin = async () =>
    (await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' })).user;

  const get = (id: string) =>
    app.inject({
      method: 'GET',
      url: '/admin/gamification/copy',
      headers: { authorization: bearer(loadEnv(), id, 'admin') },
    });

  const put = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url: '/admin/gamification/copy',
      headers: { authorization: bearer(loadEnv(), id, 'admin') },
      payload,
    });

  it('GET funciona com a linha de GeneralSettings ausente', async () => {
    await seedTwo();
    const user = await admin();
    const res = await get(user.id);
    expect(res.statusCode).toBe(200);
    const body = adminGamificationCopySchema.parse(res.json());
    expect(body.version).toBe(0);
    expect(body.badges).toHaveLength(2);
    expect(body.rankNames.iniciante).toBe('Iniciante');
  });

  it('PUT altera texto e nomes, e o GET seguinte reflete', async () => {
    await seedTwo();
    const user = await admin();
    const before = adminGamificationCopySchema.parse((await get(user.id)).json());

    const res = await put(user.id, {
      expectedVersion: before.version,
      badges: [{ code: 'EVT-001', title: 'Largada', description: 'Nova desc.' }],
      rankNames: FULL_RANKS,
    });
    expect(res.statusCode).toBe(200);

    const after = adminGamificationCopySchema.parse((await get(user.id)).json());
    expect(after.badges.find((b) => b.code === 'EVT-001')?.title).toBe('Largada');
    expect(after.rankNames.hall_of_fame).toBe('Panteão');
    expect(after.version).toBe(before.version + 1);
  });

  it('codigo fora do catalogo responde 400 e nao cria linha', async () => {
    await seedTwo();
    const user = await admin();
    const res = await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'ZZZ-999', title: 'X', description: 'Y' }],
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.badge.count()).toBe(2);
  });

  it('codigo repetido responde 400', async () => {
    await seedTwo();
    const user = await admin();
    const res = await put(user.id, {
      expectedVersion: 0,
      badges: [
        { code: 'EVT-001', title: 'A', description: 'A' },
        { code: 'EVT-001', title: 'B', description: 'B' },
      ],
    });
    expect(res.statusCode).toBe(400);
  });

  it('expectedVersion velho responde 409 e nao escreve nada', async () => {
    await seedTwo();
    const user = await admin();
    await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Primeiro', description: 'D' }],
    });

    const stale = await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Segundo', description: 'D' }],
    });
    expect(stale.statusCode).toBe(409);
    const row = await prisma.badge.findUniqueOrThrow({ where: { code: 'EVT-001' } });
    expect(row.title).toBe('Primeiro');
  });

  // Serial nao prova nada aqui: ler-comparar-escrever passa em serie e perde
  // update em paralelo, porque Read Committed nao trava linha no SELECT.
  it('duas escritas concorrentes com a mesma versao: uma vence, a outra 409', async () => {
    await seedTwo();
    const user = await admin();
    const [a, b] = await Promise.all([
      put(user.id, {
        expectedVersion: 0,
        badges: [{ code: 'EVT-001', title: 'A', description: 'D' }],
      }),
      put(user.id, {
        expectedVersion: 0,
        badges: [{ code: 'EVT-001', title: 'B', description: 'D' }],
      }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const settings = await prisma.generalSettings.findUniqueOrThrow({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    });
    expect(settings.gamificationCopyVersion).toBe(1);
  });

  it('PUT sem mudanca nao audita e nao incrementa versao', async () => {
    await seedTwo();
    const user = await admin();
    const res = await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Primeira Largada', description: 'Desc 1' }],
    });
    expect(res.statusCode).toBe(200);
    const body = adminGamificationCopySchema.parse(res.json());
    expect(body.version).toBe(0);
    expect(await prisma.adminAudit.count()).toBe(0);
  });

  it('PUT ecoando o GET (badges e rankNames intactos) nao audita e nao incrementa versao', async () => {
    await seedTwo();
    const user = await admin();
    const before = adminGamificationCopySchema.parse((await get(user.id)).json());

    // rankNames aqui vem do GET, ou seja, ja com o default de codigo aplicado
    // (a coluna esta NULL numa linha nova). Se o detector de mudanca comparar
    // contra o valor CRU da coluna em vez do nome efetivo, isto falsamente
    // marca 'rankNames' como alterado.
    const res = await put(user.id, {
      expectedVersion: before.version,
      badges: before.badges,
      rankNames: before.rankNames,
    });
    expect(res.statusCode).toBe(200);
    const body = adminGamificationCopySchema.parse(res.json());
    expect(body.version).toBe(before.version);
    expect(await prisma.adminAudit.count()).toBe(0);
  });

  it('PUT com mudanca audita os campos tocados', async () => {
    await seedTwo();
    const user = await admin();
    await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Largada', description: 'Desc 1' }],
    });
    const audit = await prisma.adminAudit.findFirstOrThrow();
    expect(audit.action).toBe('gamification_copy.update');
    expect(audit.entityType).toBe('gamification_copy');
    const metadata = audit.metadata as { fields: string[] };
    expect(metadata.fields).toContain('badge.EVT-001.title');
  });

  it('staff e organizer tomam 403, sem auth toma 401', async () => {
    const { user: staff } = await createUser({
      email: 's@jdm.test',
      verified: true,
      role: 'staff',
    });
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });

    expect((await app.inject({ method: 'GET', url: '/admin/gamification/copy' })).statusCode).toBe(
      401,
    );
    for (const [id, role] of [
      [staff.id, 'staff'],
      [org.id, 'organizer'],
    ] as const) {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/gamification/copy',
        headers: { authorization: bearer(loadEnv(), id, role) },
      });
      expect(res.statusCode).toBe(403);
    }

    // A fronteira que importa e a escrita: um organizer com um PUT bem
    // formado tambem tem que tomar 403, nao so o GET.
    const putRes = await app.inject({
      method: 'PUT',
      url: '/admin/gamification/copy',
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { expectedVersion: 0 },
    });
    expect(putRes.statusCode).toBe(403);
  });

  it('GET /badges/catalog logo apos o PUT ja mostra o titulo novo', async () => {
    await seedTwo();
    const user = await admin();

    // Popula o cache de 5 minutos antes da escrita.
    await app.inject({ method: 'GET', url: '/badges/catalog' });

    await put(user.id, {
      expectedVersion: 0,
      badges: [{ code: 'EVT-001', title: 'Depois do PUT', description: 'D' }],
    });

    const res = await app.inject({ method: 'GET', url: '/badges/catalog' });
    const body = res.json() as { catalog: { code: string; title?: string }[] };
    expect(body.catalog.find((c) => c.code === 'EVT-001')?.title).toBe('Depois do PUT');
  });

  it('as chaves de nivel do shared batem com as do progress', async () => {
    const { RANK_KEYS: serverKeys } = await import('../../src/services/garage/progress.js');
    const { RANK_KEYS: sharedKeys } = await import('@ccc/shared/admin-gamification');
    expect([...sharedKeys]).toEqual([...serverKeys]);
  });
});
