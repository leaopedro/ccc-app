import { describe, expect, it } from 'vitest';

import {
  BADGE_COPY_MAX_ENTRIES,
  BADGE_TITLE_MAX,
  RANK_NAME_MAX,
  adminGamificationCopySchema,
  gamificationCopyUpdateSchema,
  rankNamesSchema,
} from '../admin-gamification.js';

const base = { expectedVersion: 0 };

describe('gamificationCopyUpdateSchema', () => {
  it('exige expectedVersion', () => {
    expect(() => gamificationCopyUpdateSchema.parse({})).toThrow();
  });

  it('trima titulo e recusa branco ou longo demais', () => {
    const ok = gamificationCopyUpdateSchema.parse({
      ...base,
      badges: [{ code: 'EVT-001', title: '  X  ', description: 'ok', criteria: 'ok' }],
    });
    expect(ok.badges?.[0]?.title).toBe('X');
    expect(() =>
      gamificationCopyUpdateSchema.parse({
        ...base,
        badges: [{ code: 'EVT-001', title: '   ', description: 'ok', criteria: 'ok' }],
      }),
    ).toThrow();
    expect(() =>
      gamificationCopyUpdateSchema.parse({
        ...base,
        badges: [
          {
            code: 'EVT-001',
            title: 'a'.repeat(BADGE_TITLE_MAX + 1),
            description: 'ok',
            criteria: 'ok',
          },
        ],
      }),
    ).toThrow();
  });

  it('exige o criterio na escrita', () => {
    // O critério é o texto que a tela de conquista bloqueada mostra. Opcional
    // no wire de LEITURA (a coluna tem default vazio), obrigatório aqui: um
    // PUT parcial apagaria silenciosamente o "como ganhar".
    expect(() =>
      gamificationCopyUpdateSchema.parse({
        ...base,
        badges: [{ code: 'EVT-001', title: 'T', description: 'D' }],
      }),
    ).toThrow();
    expect(() =>
      gamificationCopyUpdateSchema.parse({
        ...base,
        badges: [{ code: 'EVT-001', title: 'T', description: 'D', criteria: '   ' }],
      }),
    ).toThrow();
  });

  it(`recusa mais de ${BADGE_COPY_MAX_ENTRIES} entradas`, () => {
    // Amarrado na constante, não num literal: quando o catálogo cresceu de 12
    // para 20 este spec continuou verde por acidente, porque as entradas de
    // teste tinham ficado sem `criteria` e o parse morria antes de chegar no
    // cap. Um teste que passa pelo motivo errado não protege nada.
    const entry = (i: number) => ({
      code: `EVT-${String(i).padStart(3, '0')}`,
      title: 'T',
      description: 'D',
      criteria: 'C',
    });
    const atCap = Array.from({ length: BADGE_COPY_MAX_ENTRIES }, (_, i) => entry(i));
    expect(() => gamificationCopyUpdateSchema.parse({ ...base, badges: atCap })).not.toThrow();

    const overCap = Array.from({ length: BADGE_COPY_MAX_ENTRIES + 1 }, (_, i) => entry(i));
    expect(() => gamificationCopyUpdateSchema.parse({ ...base, badges: overCap })).toThrow();
  });

  // z.record(z.enum(...)) tipa como Record completo mas nao valida
  // exaustividade em runtime: um PUT com uma chave so passaria e apagaria
  // quatro nomes. Por isso rankNamesSchema e z.object com as cinco chaves.
  it('exige as cinco chaves de nivel', () => {
    expect(() => rankNamesSchema.parse({ iniciante: 'X' })).toThrow();
    const full = {
      iniciante: 'A',
      pilotador: 'B',
      veterano: 'C',
      lendario: 'D',
      hall_of_fame: 'E',
    };
    expect(rankNamesSchema.parse(full)).toEqual(full);
    expect(() =>
      rankNamesSchema.parse({ ...full, iniciante: 'a'.repeat(RANK_NAME_MAX + 1) }),
    ).toThrow();
  });
});

describe('adminGamificationCopySchema', () => {
  // Mesma degradacao do badge title: um nome de nivel gravado por fora do
  // admin, mais longo que RANK_NAME_MAX, nao pode fazer o GET (leitura)
  // estourar so porque o cap de escrita e mais apertado.
  it('aceita um rankName mais longo que o cap de escrita', () => {
    const longName = 'a'.repeat(RANK_NAME_MAX + 30);
    const parsed = adminGamificationCopySchema.parse({
      version: 1,
      badges: [],
      rankNames: {
        iniciante: longName,
        pilotador: 'B',
        veterano: 'C',
        lendario: 'D',
        hall_of_fame: 'E',
      },
    });
    expect(parsed.rankNames.iniciante).toBe(longName);
  });
});
