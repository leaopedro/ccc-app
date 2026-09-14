import { prisma } from '@ccc/db';
import { CELEBRATION_PAGE_SIZE } from '@ccc/shared/badges';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const seedCatalog = async () => {
  await prisma.badge.createMany({
    data: [
      {
        code: 'EVT-001',
        category: 'eventos',
        rarity: 'common',
        icon: 'flag',
        title: 'A',
        description: 'a',
      },
      {
        code: 'CAR-001',
        category: 'carros',
        rarity: 'common',
        icon: 'car',
        title: 'B',
        description: 'b',
      },
    ],
  });
};

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

describe('GET /me/garage/badges/celebrations', () => {
  let app: FastifyInstance;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    await seedCatalog();
    app = await makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('devolve so as pendentes, em ordem determinista', async () => {
    const { user } = await createUser({ verified: true });
    const gid = await garageId(user.id);
    const earnedAt = new Date('2026-09-13T12:00:00.000Z');
    // earnedAt identico de proposito: e o que acontece quando duas conquistas
    // caem na mesma transacao, porque now() no Postgres e o inicio da transacao.
    await prisma.garageBadge.createMany({
      data: [
        { garageId: gid, badgeCode: 'EVT-001', earnedAt },
        { garageId: gid, badgeCode: 'CAR-001', earnedAt },
      ],
    });
    await prisma.garageBadge.update({
      where: { garageId_badgeCode: { garageId: gid, badgeCode: 'EVT-001' } },
      data: { celebratedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges/celebrations',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; pending: { code: string }[] };
    expect(body.enabled).toBe(true);
    expect(body.pending.map((p) => p.code)).toEqual(['CAR-001']);
  });

  it('desempata por badgeCode quando earnedAt empata', async () => {
    const { user } = await createUser({ verified: true });
    const gid = await garageId(user.id);
    const earnedAt = new Date('2026-09-13T12:00:00.000Z');
    await prisma.garageBadge.createMany({
      data: [
        { garageId: gid, badgeCode: 'EVT-001', earnedAt },
        { garageId: gid, badgeCode: 'CAR-001', earnedAt },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges/celebrations',
      headers: { authorization: bearer(env, user.id) },
    });
    expect((res.json() as { pending: { code: string }[] }).pending.map((p) => p.code)).toEqual([
      'CAR-001',
      'EVT-001',
    ]);
  });

  it('carimba e omite pendentes mais velhas que a janela de 7 dias', async () => {
    const { user } = await createUser({ verified: true });
    const gid = await garageId(user.id);
    const velha = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.garageBadge.create({
      data: { garageId: gid, badgeCode: 'EVT-001', earnedAt: velha },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges/celebrations',
      headers: { authorization: bearer(env, user.id) },
    });
    expect((res.json() as { pending: unknown[] }).pending).toHaveLength(0);

    const row = await prisma.garageBadge.findUniqueOrThrow({
      where: { garageId_badgeCode: { garageId: gid, badgeCode: 'EVT-001' } },
    });
    // Autolimpeza: a propria rota fecha o rabo da fila, sem worker.
    expect(row.celebratedAt).not.toBeNull();
  });

  it('respeita o teto de CELEBRATION_PAGE_SIZE quando ha mais pendentes', async () => {
    const { user } = await createUser({ verified: true });
    const gid = await garageId(user.id);
    const overflow = CELEBRATION_PAGE_SIZE + 1;
    // `@@unique([garageId, badgeCode])` exige um codigo distinto por linha,
    // entao o catalogo precisa de mais codigos do que o teto para provar o take.
    const codes = Array.from(
      { length: overflow },
      (_, i) => `PAG-${String(i + 1).padStart(3, '0')}`,
    );
    await prisma.badge.createMany({
      data: codes.map((code) => ({
        code,
        category: 'eventos' as const,
        rarity: 'common' as const,
        icon: 'flag',
        title: code,
        description: code,
      })),
    });
    const earnedAt = new Date('2026-09-13T12:00:00.000Z');
    await prisma.garageBadge.createMany({
      data: codes.map((badgeCode) => ({ garageId: gid, badgeCode, earnedAt })),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges/celebrations',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pending: { code: string }[] };
    expect(body.pending).toHaveLength(CELEBRATION_PAGE_SIZE);
  });

  it('devolve enabled false com o killswitch desligado', async () => {
    await prisma.generalSettings.deleteMany();
    await prisma.generalSettings.create({
      data: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
    });
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage/badges/celebrations',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.json()).toEqual({ enabled: false, pending: [] });
  });
});
