import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { ensurePresaleSettings } from '../../src/services/presale/settings.js';
import { resetDatabase } from '../helpers.js';

describe('ensurePresaleSettings', () => {
  beforeEach(async () => {
    await resetDatabase();
    // PresaleSettings não é limpa por resetDatabase (tabela da Task 6, fora do
    // escopo compartilhado de test/helpers.ts).
    await prisma.presaleSettings.deleteMany();
  });

  // Prova da Review do Task 6 (Important): o gap real era no WRITE, não no
  // read. Um findFirst sequencial não exercitaria a corrida; só chamadas
  // concorrentes, de banco vazio, provam que o upsert por id fixo (não um
  // findFirst/create por cuid solto) impede a segunda linha.
  it('não cria duas linhas sob chamadas concorrentes a partir de um banco vazio', async () => {
    await Promise.all(Array.from({ length: 10 }, () => ensurePresaleSettings()));

    await expect(prisma.presaleSettings.count()).resolves.toBe(1);
  });
});
