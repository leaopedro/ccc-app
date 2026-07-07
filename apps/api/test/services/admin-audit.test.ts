import { prisma } from '@jdm/db';
import { describe, expect, it, beforeEach } from 'vitest';

import { recordAudit } from '../../src/services/admin-audit.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('recordAudit', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('inserts a row with the given shape', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', role: 'admin', verified: true });
    await recordAudit({
      actorId: user.id,
      action: 'event.create',
      entityType: 'event',
      entityId: 'evt_123',
      metadata: { slug: 'x' },
    });
    const rows = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: user.id,
      action: 'event.create',
      entityType: 'event',
      entityId: 'evt_123',
      metadata: { slug: 'x' },
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('metadata is optional', async () => {
    const { user } = await createUser({ email: 'b@jdm.test', role: 'admin', verified: true });
    await recordAudit({
      actorId: user.id,
      action: 'tier.delete',
      entityType: 'tier',
      entityId: 'tier_1',
    });
    const [row] = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(row?.metadata).toBeNull();
  });
});
