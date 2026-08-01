import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { anonymizeUser } from '../../src/services/account-deletion/anonymize.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('anonymizeUser scrubs the Garage row', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rewrites garage fields to neutral defaults in the same transaction', async () => {
    const { user } = await createUser({ email: 'erase@jdm.test', verified: true });
    await prisma.garage.update({
      where: { userId: user.id },
      data: {
        name: 'Garagem do Tiago',
        slug: 'tiago-vintage',
        description: 'minha bio',
        isPublic: true,
        premiumTier: 'gold',
        premiumUntil: new Date(Date.now() + 86_400_000),
      },
    });
    const deletedAt = new Date(Date.now() - 31 * 24 * 3600_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt },
    });
    await prisma.deletionLog.create({ data: { userId: user.id, requestedAt: deletedAt } });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);

    const garage = await prisma.garage.findUnique({ where: { userId: user.id } });
    expect(garage).not.toBeNull();
    expect(garage!.name).toBe('Garagem');
    expect(garage!.slug.startsWith('deleted-')).toBe(true);
    expect(garage!.description).toBeNull();
    expect(garage!.isPublic).toBe(false);
    expect(garage!.premiumTier).toBeNull();
    expect(garage!.premiumUntil).toBeNull();

    // Original vanity slug is free for re-use by another user.
    const stillOldSlug = await prisma.garage.findUnique({ where: { slug: 'tiago-vintage' } });
    expect(stillOldSlug).toBeNull();
  });
});
