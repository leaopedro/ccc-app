import { describe, expect, it } from 'vitest';

import { LIVE_MEMBERSHIP_STATUSES, isLiveMembershipStatus } from '../premium.js';

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
