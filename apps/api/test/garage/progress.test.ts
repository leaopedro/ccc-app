import { prisma } from '@ccc/db';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@ccc/shared/general-settings';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRankNames } from '../../src/services/garage/rank-names.js';
import { deriveProgress, getGarageProgress } from '../../src/services/garage/progress.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('deriveProgress', () => {
  // Boundary cases from outline §491 (one it() per row).
  it('xp = 0 → Iniciante, 0 in tier, 100 to advance', () => {
    expect(deriveProgress(0)).toEqual({
      xp: 0,
      rank: 'Iniciante',
      nextRank: 'Pilotador',
      xpInTier: 0,
      xpToNextRank: 100,
      tierSpan: 100,
    });
  });

  it('xp = 99 → Iniciante, 99 in tier, 1 to advance', () => {
    expect(deriveProgress(99)).toEqual({
      xp: 99,
      rank: 'Iniciante',
      nextRank: 'Pilotador',
      xpInTier: 99,
      xpToNextRank: 1,
      tierSpan: 100,
    });
  });

  it('xp = 100 → Pilotador, 0 in tier, 400 to advance', () => {
    expect(deriveProgress(100)).toEqual({
      xp: 100,
      rank: 'Pilotador',
      nextRank: 'Veterano',
      xpInTier: 0,
      xpToNextRank: 400,
      tierSpan: 400,
    });
  });

  it('xp = 4999 → Lendário, 2999 in tier, 1 to advance', () => {
    expect(deriveProgress(4999)).toEqual({
      xp: 4999,
      rank: 'Lendário',
      nextRank: 'Hall of Fame',
      xpInTier: 2999,
      xpToNextRank: 1,
      tierSpan: 3000,
    });
  });

  it('xp = 5000 → Hall of Fame, 0 in tier, 0 to advance, tierSpan = 1 (§C14)', () => {
    expect(deriveProgress(5000)).toEqual({
      xp: 5000,
      rank: 'Hall of Fame',
      nextRank: null,
      xpInTier: 0,
      xpToNextRank: 0,
      tierSpan: 1,
    });
  });

  it('xp = 50000 → Hall of Fame, 45000 in tier, 0 to advance, tierSpan = 1 (no negative)', () => {
    expect(deriveProgress(50_000)).toEqual({
      xp: 50_000,
      rank: 'Hall of Fame',
      nextRank: null,
      xpInTier: 45_000,
      xpToNextRank: 0,
      tierSpan: 1,
    });
  });

  // Invariants — guard the §C14 sentinel + the UI-safety contract.
  it('nextRank is null only at the top tier', () => {
    for (const xp of [0, 99, 100, 499, 500, 1999, 2000, 4999]) {
      expect(deriveProgress(xp).nextRank).not.toBeNull();
    }
    for (const xp of [5000, 9999, 50_000]) {
      expect(deriveProgress(xp).nextRank).toBeNull();
    }
  });

  it('xpToNextRank is never negative (including arbitrarily large top-tier XP)', () => {
    for (const xp of [0, 99, 100, 4999, 5000, 50_000, 1_000_000]) {
      expect(deriveProgress(xp).xpToNextRank).toBeGreaterThanOrEqual(0);
    }
  });

  it('tierSpan is never zero (UI divides by it — §C14)', () => {
    for (const xp of [0, 99, 100, 499, 500, 1999, 2000, 4999, 5000, 50_000]) {
      expect(deriveProgress(xp).tierSpan).toBeGreaterThan(0);
    }
  });

  it('xpInTier is never negative across all tiers', () => {
    for (const xp of [0, 50, 100, 250, 500, 1000, 2000, 3500, 5000, 50_000]) {
      expect(deriveProgress(xp).xpInTier).toBeGreaterThanOrEqual(0);
    }
  });

  it('resolve rank e nextRank pelo mapa de nomes', () => {
    const names = { pilotador: 'Piloto', veterano: 'Mestre' };
    expect(deriveProgress(100, names)).toEqual({
      xp: 100,
      rank: 'Piloto',
      nextRank: 'Mestre',
      xpInTier: 0,
      xpToNextRank: 400,
      tierSpan: 400,
    });
  });

  it('cai no nome de codigo quando a chave falta no mapa', () => {
    expect(deriveProgress(100, { veterano: 'Mestre' }).rank).toBe('Pilotador');
  });

  // Guard de topo: com o encadeamento por indice, um `next === undefined`
  // passaria pelo antigo `=== null` e produziria xpToNextRank negativo, que
  // garageProgressSchema recusa e vira 500 em GET /me/garage.
  it('mantem o sentinela de topo mesmo com os nomes remapeados', () => {
    const names = { hall_of_fame: 'Panteão' };
    expect(deriveProgress(5000, names)).toEqual({
      xp: 5000,
      rank: 'Panteão',
      nextRank: null,
      xpInTier: 0,
      xpToNextRank: 0,
      tierSpan: 1,
    });
    expect(deriveProgress(999999, names).xpToNextRank).toBe(0);
    expect(deriveProgress(999999, names).tierSpan).toBe(1);
  });
});

describe('getGarageProgress (real Postgres)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('reads Garage.xp and returns the derived progress shape', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    // Seed an XP value that lands inside the Pilotador tier so all the
    // non-top fields are exercised end-to-end.
    await prisma.garage.update({ where: { id: garage.id }, data: { xp: 250 } });

    const progress = await getGarageProgress(prisma, garage.id);
    expect(progress).toEqual({
      xp: 250,
      rank: 'Pilotador',
      nextRank: 'Veterano',
      xpInTier: 150,
      xpToNextRank: 250,
      tierSpan: 400,
    });
  });

  it('returns the Hall of Fame sentinel for a top-tier garage', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await prisma.garage.update({ where: { id: garage.id }, data: { xp: 10_000 } });

    const progress = await getGarageProgress(prisma, garage.id);
    expect(progress.rank).toBe('Hall of Fame');
    expect(progress.nextRank).toBeNull();
    expect(progress.xpToNextRank).toBe(0);
    expect(progress.tierSpan).toBe(1);
    expect(progress.xpInTier).toBe(5_000);
  });

  it('throws Prisma P2025 when the garage id does not exist', async () => {
    await expect(getGarageProgress(prisma, 'nonexistent-garage-id')).rejects.toMatchObject({
      code: 'P2025',
    });
  });
});

describe('readRankNames', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.generalSettings.deleteMany();
  });

  it('devolve mapa vazio quando a linha nao existe', async () => {
    expect(await readRankNames()).toEqual({});
  });

  it('devolve mapa vazio quando rankNames e nulo', async () => {
    await prisma.generalSettings.create({ data: { id: GENERAL_SETTINGS_SINGLETON_ID } });
    expect(await readRankNames()).toEqual({});
  });

  it('devolve o mapa quando valido', async () => {
    await prisma.generalSettings.create({
      data: {
        id: GENERAL_SETTINGS_SINGLETON_ID,
        rankNames: {
          iniciante: 'Novato',
          pilotador: 'Piloto',
          veterano: 'Veterano',
          lendario: 'Lenda',
          hall_of_fame: 'Panteão',
        },
      },
    });
    expect((await readRankNames()).iniciante).toBe('Novato');
  });

  // A coluna e Json sem forma no banco: migration, psql na mao ou um writer
  // futuro podem deixar lixo la. As duas rotas que consomem isso fazem parse
  // da propria resposta, entao um throw aqui e 500 em caminho quente.
  it('nao explode com forma invalida, cai no mapa vazio', async () => {
    await prisma.generalSettings.create({
      data: { id: GENERAL_SETTINGS_SINGLETON_ID, rankNames: { iniciante: 42 } },
    });
    expect(await readRankNames()).toEqual({});
  });
});
