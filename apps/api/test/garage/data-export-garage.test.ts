import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _collectUserDataForTest } from '../../src/services/data-export.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('data-export collector includes Garage fields', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the allowlisted garage payload (no id, no userId)', async () => {
    const { user } = await createUser({ email: 'export@jdm.test', verified: true });
    await prisma.garage.update({
      where: { userId: user.id },
      data: {
        name: 'Garagem Export',
        slug: 'export-jdm',
        description: 'oi',
        isPublic: true,
        premiumTier: 'silver',
        premiumUntil: new Date('2030-01-01T00:00:00.000Z'),
      },
    });

    const bundle = await _collectUserDataForTest(user.id);
    expect(bundle.data['garage']).toHaveLength(1);
    const row = (bundle.data['garage'] as Record<string, unknown>[])[0]!;
    expect(row['name']).toBe('Garagem Export');
    expect(row['slug']).toBe('export-jdm');
    expect(row['description']).toBe('oi');
    expect(row['isPublic']).toBe(true);
    expect(row['premiumTier']).toBe('silver');
    expect(row['premiumUntil']).toBeInstanceOf(Date);
    // id + userId are NOT in the export (re-derivable).
    expect('id' in row).toBe(false);
    expect('userId' in row).toBe(false);
  });
});
