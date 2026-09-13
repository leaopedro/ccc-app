import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase } from '../helpers.js';

// As 7 conquistas que dependiam de superfície de hook nova. Entram só agora,
// junto das suas regras de elegibilidade: catálogo antes da regra é conquista
// inalcançável, que foi exatamente o motivo de COM-002 e COM-003 terem sido
// removidas.
//
// Mesmo contrato da migration de seed anterior: UM statement, idempotente,
// executado aqui a partir do ARQUIVO para que um código esquecido lá quebre.
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../../../packages/db/prisma/migrations');

const readMigration = (name: string): string =>
  readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');

const BASE_MIGRATION = '20260913120100_seed_badge_catalog';
const PR2_MIGRATION = '20260913130000_seed_badge_catalog_hooks';

const NEW_CODES = ['CAR-004', 'CCC-004', 'CCC-005', 'COM-004', 'COM-005', 'COM-006', 'COM-007'];

describe('migration de seed das conquistas com hook novo', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.garageBadge.deleteMany();
    await prisma.badge.deleteMany();
  });

  it('leva o catálogo a 20 conquistas', async () => {
    await prisma.$executeRawUnsafe(readMigration(BASE_MIGRATION));
    await prisma.$executeRawUnsafe(readMigration(PR2_MIGRATION));

    const rows = await prisma.badge.findMany({ orderBy: { code: 'asc' } });
    expect(rows).toHaveLength(20);
    for (const code of NEW_CODES) {
      const row = rows.find((r) => r.code === code);
      expect(row, `catálogo sem ${code}`).toBeDefined();
      expect(row!.title.length).toBeGreaterThan(0);
      expect(row!.description.length).toBeGreaterThan(0);
      expect(row!.criteria.length).toBeGreaterThan(0);
    }
  });

  it('rodar de novo não duplica nem sobrescreve copy editada pelo admin', async () => {
    await prisma.$executeRawUnsafe(readMigration(PR2_MIGRATION));
    await prisma.badge.update({
      where: { code: 'COM-004' },
      data: { title: 'Título do admin', criteria: 'Critério do admin' },
    });

    await prisma.$executeRawUnsafe(readMigration(PR2_MIGRATION));

    expect(await prisma.badge.count()).toBe(NEW_CODES.length);
    const com4 = await prisma.badge.findUnique({ where: { code: 'COM-004' } });
    expect(com4?.title).toBe('Título do admin');
    expect(com4?.criteria).toBe('Critério do admin');
  });

  it('não reaproveita COM-002 nem COM-003', async () => {
    // Os dois códigos foram removidos por nunca terem tido regra. Trazê-los de
    // volta com significado diferente daria a alguém que recebeu um grant
    // manual antigo uma conquista que ela não ganhou.
    await prisma.$executeRawUnsafe(readMigration(PR2_MIGRATION));

    const codes = (await prisma.badge.findMany({ select: { code: true } })).map((r) => r.code);
    expect(codes).not.toContain('COM-002');
    expect(codes).not.toContain('COM-003');
  });
});
