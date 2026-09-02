import { describe, expect, it } from 'vitest';

import {
  LIVE_MEMBERSHIP_STATUSES,
  LIVE_PER_GARAGE_INDEX_STATUSES,
  isLiveMembershipStatus,
} from '../premium.js';

describe('LIVE_MEMBERSHIP_STATUSES', () => {
  it('inclui trialing e paused, que as tres copias antigas omitiam', () => {
    expect([...LIVE_MEMBERSHIP_STATUSES]).toEqual([
      'trialing',
      'active',
      'past_due',
      'cancel_scheduled',
      'paused',
    ]);
  });

  // expired e o unico estado que libera nova assinatura. Se ele entrar aqui,
  // ninguem consegue mais recontratar depois de o periodo acabar.
  it('nao inclui expired', () => {
    expect(isLiveMembershipStatus('expired')).toBe(false);
  });

  it('reconhece os cinco estados vivos', () => {
    for (const s of LIVE_MEMBERSHIP_STATUSES) {
      expect(isLiveMembershipStatus(s)).toBe(true);
    }
  });
});

describe('LIVE_PER_GARAGE_INDEX_STATUSES', () => {
  // Espelha a migracao 20260527094120, linhas 109-111. Se o indice mudar, esta
  // lista muda junto, e um teste vermelho e melhor do que uma pre-checagem
  // silenciosamente errada nos dois sentidos.
  it('e exatamente o que o indice parcial cobre', () => {
    expect([...LIVE_PER_GARAGE_INDEX_STATUSES]).toEqual(['active', 'past_due', 'cancel_scheduled']);
  });

  // A diferenca e o ponto da constante existir. Uma pre-checagem de P2002 com a
  // lista larga recusa ativacoes que o Postgres aceitaria: o membro com uma
  // assinatura pausada assina na Apple, e cobrado, e nao recebe nada.
  it('nao inclui trialing nem paused, que a lista de entitlement inclui', () => {
    const wide = new Set<string>(LIVE_MEMBERSHIP_STATUSES);
    const narrow = new Set<string>(LIVE_PER_GARAGE_INDEX_STATUSES);
    expect(wide.has('trialing')).toBe(true);
    expect(wide.has('paused')).toBe(true);
    expect(narrow.has('trialing')).toBe(false);
    expect(narrow.has('paused')).toBe(false);
  });

  it('e subconjunto estrito da lista de entitlement', () => {
    for (const s of LIVE_PER_GARAGE_INDEX_STATUSES) {
      expect(isLiveMembershipStatus(s)).toBe(true);
    }
    expect(LIVE_PER_GARAGE_INDEX_STATUSES.length).toBeLessThan(LIVE_MEMBERSHIP_STATUSES.length);
  });
});
