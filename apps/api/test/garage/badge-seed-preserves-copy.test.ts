import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase } from '../helpers.js';

describe('seedBadgeCatalog preserva copy editada', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('upsert de catalogo nao sobrescreve title nem description', async () => {
    await prisma.badge.create({
      data: {
        code: 'EVT-001',
        category: 'eventos',
        rarity: 'common',
        icon: 'flag',
        premiumExclusive: false,
        title: 'Editado pelo admin',
        description: 'Descrição editada.',
      },
    });

    // Mesma forma do upsert de packages/db/prisma/seed.ts:488-500.
    await prisma.badge.upsert({
      where: { code: 'EVT-001' },
      create: {
        code: 'EVT-001',
        category: 'eventos',
        rarity: 'common',
        icon: 'flag',
        premiumExclusive: false,
        title: 'Primeira Largada',
        description: 'Desc canônica.',
      },
      update: { category: 'eventos', rarity: 'common', icon: 'flag', premiumExclusive: false },
    });

    const row = await prisma.badge.findUniqueOrThrow({ where: { code: 'EVT-001' } });
    expect(row.title).toBe('Editado pelo admin');
    expect(row.description).toBe('Descrição editada.');
  });
});
