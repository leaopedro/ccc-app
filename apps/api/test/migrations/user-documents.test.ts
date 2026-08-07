import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

describe('User profile columns and UserDocument table', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('creates a user with null cpf and phone', async () => {
    const { user } = await createUser();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.cpf).toBeNull();
    expect(row.phone).toBeNull();
  });

  it('stores cpf and phone when provided', async () => {
    const { user } = await createUser();
    const row = await prisma.user.update({
      where: { id: user.id },
      data: { cpf: 'enc_v1:aa:bb:cc', phone: '11987654321' },
    });
    expect(row.cpf).toBe('enc_v1:aa:bb:cc');
    expect(row.phone).toBe('11987654321');
  });

  it('creates a document defaulting to pending', async () => {
    const { user } = await createUser();
    const doc = await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });
    expect(doc.status).toBe('pending');
    expect(doc.reviewedAt).toBeNull();
    expect(doc.fileDeletedAt).toBeNull();
    expect(doc.sentAt).toBeInstanceOf(Date);
  });

  it('cascades document deletion when the user is removed', async () => {
    const { user } = await createUser();
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'rg', objectKey: `identity-document/${user.id}/b.jpg` },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.userDocument.count({ where: { userId: user.id } })).toBe(0);
  });
});
