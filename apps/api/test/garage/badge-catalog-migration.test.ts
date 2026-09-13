import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase } from '../helpers.js';

// A migration de seed do catálogo é o único caminho pelo qual produção ganha
// linhas em `Badge` — `pnpm seed` nunca rodou lá, e sem linhas o app mostra
// 0/0 e o awarder não tem FK para gravar. O teste executa o ARQUIVO da
// migration, não uma cópia do SQL, para que um código esquecido na migration
// quebre aqui.
//
// Cada arquivo carrega UM statement de propósito: `$executeRawUnsafe` usa o
// protocolo estendido do Postgres, que recusa múltiplos statements.
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../../../packages/db/prisma/migrations');

const readMigration = (name: string): string =>
  readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');

const SEED_MIGRATION = '20260913120100_seed_badge_catalog';
const PRUNE_MIGRATION = '20260913120200_prune_unearnable_badges';

// As 13 conquistas do PR 1: as que já têm hook de elegibilidade. As outras 7
// (CAR-004, COM-004..007, CCC-004, CCC-005) entram no PR 2 junto das suas
// superfícies de hook — inserir o catálogo antes da regra criaria conquista
// inalcançável, que é exatamente o que COM-002/COM-003 eram.
const EXPECTED_CODES = [
  'CAR-001',
  'CAR-002',
  'CAR-003',
  'CCC-001',
  'CCC-002',
  'CCC-003',
  'COM-001',
  'COM-008',
  'EVT-001',
  'EVT-002',
  'EVT-003',
  'EVT-004',
  'EVT-005',
];

describe('migration de seed do catálogo de conquistas', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.garageBadge.deleteMany();
    await prisma.badge.deleteMany();
  });

  it('popula o catálogo num banco sem nenhuma conquista', async () => {
    await prisma.$executeRawUnsafe(readMigration(SEED_MIGRATION));

    const rows = await prisma.badge.findMany({ orderBy: { code: 'asc' } });

    expect(rows.map((r) => r.code)).toEqual(EXPECTED_CODES);
    for (const row of rows) {
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.description.length).toBeGreaterThan(0);
      expect(row.criteria.length).toBeGreaterThan(0);
    }
  });

  it('rodar de novo não duplica nem sobrescreve copy editada pelo admin', async () => {
    await prisma.$executeRawUnsafe(readMigration(SEED_MIGRATION));
    await prisma.badge.update({
      where: { code: 'EVT-001' },
      data: { title: 'Título do admin', criteria: 'Critério do admin' },
    });

    await prisma.$executeRawUnsafe(readMigration(SEED_MIGRATION));

    const rows = await prisma.badge.findMany();
    expect(rows).toHaveLength(EXPECTED_CODES.length);
    const evt1 = rows.find((r) => r.code === 'EVT-001');
    expect(evt1?.title).toBe('Título do admin');
    expect(evt1?.criteria).toBe('Critério do admin');
  });

  it('preenche o critério de uma linha antiga que ficou com o default vazio', async () => {
    await prisma.$executeRawUnsafe(readMigration(SEED_MIGRATION));
    await prisma.badge.update({ where: { code: 'CAR-001' }, data: { criteria: '' } });

    await prisma.$executeRawUnsafe(readMigration(SEED_MIGRATION));

    const car1 = await prisma.badge.findUnique({ where: { code: 'CAR-001' } });
    expect(car1?.criteria.length).toBeGreaterThan(0);
  });
});

describe('migration que remove as conquistas inalcançáveis', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.garageBadge.deleteMany();
    await prisma.badge.deleteMany();
  });

  it('remove COM-002 e COM-003 de um catálogo legado', async () => {
    await prisma.badge.createMany({
      data: [
        {
          code: 'COM-002',
          title: 'Voz da Comunidade',
          description: 'Legado.',
          criteria: 'Legado.',
          category: 'comunidade',
          rarity: 'rare',
          icon: 'chat',
        },
        {
          code: 'COM-003',
          title: 'Em Chamas',
          description: 'Legado.',
          criteria: 'Legado.',
          category: 'comunidade',
          rarity: 'legendary',
          icon: 'fire',
        },
      ],
    });

    await prisma.$executeRawUnsafe(readMigration(PRUNE_MIGRATION));

    expect(await prisma.badge.count()).toBe(0);
  });

  it('preserva uma conquista inalcançável que alguém já recebeu', async () => {
    // O FK de GarageBadge é Restrict: apagar a linha do catálogo derrubaria a
    // migration inteira e travaria o deploy. Um grant manual pelo admin põe
    // exatamente esse caso em produção.
    const user = await prisma.user.create({
      data: { email: 'com002@example.com', passwordHash: 'x', name: 'Com' },
    });
    const garage = await prisma.garage.create({
      data: { userId: user.id, name: 'Garagem', slug: `com002-${user.id}` },
    });
    await prisma.badge.create({
      data: {
        code: 'COM-002',
        title: 'Voz da Comunidade',
        description: 'Legado.',
        criteria: 'Legado.',
        category: 'comunidade',
        rarity: 'rare',
        icon: 'chat',
      },
    });
    await prisma.garageBadge.create({ data: { garageId: garage.id, badgeCode: 'COM-002' } });

    await prisma.$executeRawUnsafe(readMigration(PRUNE_MIGRATION));

    expect(await prisma.badge.findUnique({ where: { code: 'COM-002' } })).not.toBeNull();
  });
});
