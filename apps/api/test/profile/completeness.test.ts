import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadProfileCompleteness,
  missingFor,
  REQUIRED_BY_SCOPE,
} from '../../src/services/profile/completeness.js';
import { isInRollout } from '../../src/services/profile/gate.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('loadProfileCompleteness', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('returns null for an unknown user', async () => {
    expect(await loadProfileCompleteness('nope')).toBeNull();
  });

  it('reports everything missing for a fresh user', async () => {
    const { user } = await createUser();
    expect(await loadProfileCompleteness(user.id)).toEqual({
      cpf: false,
      phone: false,
      document: false,
    });
  });

  it('counts a pending document as present', async () => {
    const { user } = await createUser();
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });
    const c = await loadProfileCompleteness(user.id);
    expect(c?.document).toBe(true);
  });

  it('counts an approved document as present', async () => {
    const { user } = await createUser();
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/a.jpg`,
        status: 'approved',
      },
    });
    const c = await loadProfileCompleteness(user.id);
    expect(c?.document).toBe(true);
  });

  it('does NOT count a rejected document as present', async () => {
    const { user } = await createUser();
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/a.jpg`,
        status: 'rejected',
      },
    });
    const c = await loadProfileCompleteness(user.id);
    expect(c?.document).toBe(false);
  });

  it('treats an empty-string cpf as absent', async () => {
    const { user } = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { cpf: '', phone: '' } });
    expect(await loadProfileCompleteness(user.id)).toEqual({
      cpf: false,
      phone: false,
      document: false,
    });
  });
});

describe('missingFor', () => {
  it('requires cpf and phone for checkout, not document', () => {
    expect(REQUIRED_BY_SCOPE.checkout).toEqual(['cpf', 'phone']);
    expect(missingFor({ cpf: false, phone: false, document: false }, 'checkout')).toEqual([
      'cpf',
      'phone',
    ]);
  });

  it('requires all three for subscription', () => {
    expect(missingFor({ cpf: false, phone: false, document: false }, 'subscription')).toEqual([
      'cpf',
      'phone',
      'document',
    ]);
  });

  it('reports only what is actually missing, in contract order', () => {
    expect(missingFor({ cpf: true, phone: false, document: false }, 'subscription')).toEqual([
      'phone',
      'document',
    ]);
  });

  it('returns an empty list when complete', () => {
    expect(missingFor({ cpf: true, phone: true, document: true }, 'subscription')).toEqual([]);
  });
});

describe('isInRollout', () => {
  it('excludes everyone at 0 and includes everyone at 100', () => {
    expect(isInRollout('user-abc', 0)).toBe(false);
    expect(isInRollout('user-abc', 100)).toBe(true);
  });

  it('is stable for the same user across calls', () => {
    const first = isInRollout('user-abc', 50);
    for (let i = 0; i < 20; i += 1) expect(isInRollout('user-abc', 50)).toBe(first);
  });

  it('is monotonic: anyone in at N is in at N+delta', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`);
    for (const id of ids) {
      if (isInRollout(id, 25)) expect(isInRollout(id, 50)).toBe(true);
    }
  });

  it('lands roughly on the requested share over a large sample', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `user-${i}`);
    const share = ids.filter((id) => isInRollout(id, 25)).length / ids.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });
});
