import { describe, expect, it } from 'vitest';

import {
  BADGE_TITLE_MAX,
  RANK_NAME_MAX,
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
      badges: [{ code: 'EVT-001', title: '  X  ', description: 'ok' }],
    });
    expect(ok.badges?.[0]?.title).toBe('X');
    expect(() =>
      gamificationCopyUpdateSchema.parse({
        ...base,
        badges: [{ code: 'EVT-001', title: '   ', description: 'ok' }],
      }),
    ).toThrow();
    expect(() =>
      gamificationCopyUpdateSchema.parse({
        ...base,
        badges: [{ code: 'EVT-001', title: 'a'.repeat(BADGE_TITLE_MAX + 1), description: 'ok' }],
      }),
    ).toThrow();
  });

  it('recusa mais de 12 entradas', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({
      code: `EVT-${String(i).padStart(3, '0')}`,
      title: 'T',
      description: 'D',
    }));
    expect(() => gamificationCopyUpdateSchema.parse({ ...base, badges: many })).toThrow();
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
