import { describe, expect, it, vi } from 'vitest';

import { requestCelebrationRefresh, subscribeCelebrationRefresh } from '../refresh-bus';
import { resolveEntries } from '../queue';

const pending = [{ code: 'EVT-001', earnedAt: '2026-09-13T12:00:00.000Z' }];

describe('refresh bus', () => {
  it('avisa os assinantes e para depois do unsubscribe', () => {
    const spy = vi.fn();
    const unsub = subscribeCelebrationRefresh(spy);
    requestCelebrationRefresh();
    unsub();
    requestCelebrationRefresh();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('resolveEntries', () => {
  const catalog = [
    {
      code: 'EVT-001',
      category: 'eventos' as const,
      rarity: 'common' as const,
      premiumExclusive: false,
      icon: 'flag',
      title: 'Do banco',
      description: 'd',
    },
  ];
  const bundled = { 'EVT-001': { title: 'Do bundle', description: 'b' } };

  it('prefere o catalogo da API', () => {
    const out = resolveEntries(pending, catalog, bundled);
    expect(out.entries[0]!.title).toBe('Do banco');
    expect(out.resolvable).toBe(true);
  });

  it('cai no bundle quando a API nao manda titulo', () => {
    const semTitulo = [
      {
        code: 'EVT-001',
        category: 'eventos' as const,
        rarity: 'common' as const,
        premiumExclusive: false,
        icon: 'flag',
      },
    ];
    const out = resolveEntries(pending, semTitulo, bundled);
    expect(out.entries[0]!.title).toBe('Do bundle');
  });

  it('marca para ack sem animar quando falta titulo em catalogo e bundle', () => {
    const semTitulo = [
      {
        code: 'EVT-001',
        category: 'eventos' as const,
        rarity: 'common' as const,
        premiumExclusive: false,
        icon: 'flag',
      },
    ];
    const bundledEmpty = {};
    const out = resolveEntries(pending, semTitulo, bundledEmpty);
    expect(out.entries).toHaveLength(0);
    expect(out.ackOnly).toEqual(['EVT-001']);
    expect(out.resolvable).toBe(true);
  });

  it('marca para ack sem animar o codigo ausente de um catalogo carregado', () => {
    const out = resolveEntries([{ code: 'CAR-009', earnedAt: '...' }], catalog, bundled);
    expect(out.entries).toHaveLength(0);
    expect(out.ackOnly).toEqual(['CAR-009']);
  });

  it('NAO marca nada para ack quando o catalogo nao carregou', () => {
    // Regra load-bearing: acked aqui queimaria a fila inteira, para sempre,
    // por causa de uma requisicao ruim.
    const out = resolveEntries(pending, null, bundled);
    expect(out.ackOnly).toEqual([]);
    expect(out.resolvable).toBe(false);
  });

  it('NAO marca nada para ack quando o catalogo veio vazio', () => {
    const out = resolveEntries(pending, [], bundled);
    expect(out.ackOnly).toEqual([]);
    expect(out.resolvable).toBe(false);
  });
});
