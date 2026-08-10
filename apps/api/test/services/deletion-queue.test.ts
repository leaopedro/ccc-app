import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  configureDeletionQueue,
  queueObjectDeletion,
} from '../../src/services/uploads/deletion-queue.js';
import { resetDatabase } from '../helpers.js';

const makeUploads = () => ({
  deleteObject: vi.fn((_key: string) => Promise.resolve()),
  presignPut: vi.fn(() => Promise.reject(new Error('unused'))),
  presignGet: vi.fn(() => Promise.reject(new Error('unused'))),
  buildPublicUrl: vi.fn(() => 'https://example.test/object'),
  buildSignedGetUrl: vi.fn(() => Promise.resolve('https://example.test/object?signed=1')),
  isOwnedKey: vi.fn(() => true),
  isKindKey: vi.fn(() => true),
  objectExists: vi.fn(() => Promise.resolve(true)),
});

describe('queueObjectDeletion', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('queues row without immediate delete when worker enabled', async () => {
    const uploads = makeUploads();
    configureDeletionQueue({ uploads, workerEnabled: true });

    await queueObjectDeletion({ objectKey: 'avatar/user-1/pic.png', reason: 'avatar_replaced' });

    expect(uploads.deleteObject).not.toHaveBeenCalled();
    const row = await prisma.uploadDeletionQueue.findUnique({
      where: { objectKey: 'avatar/user-1/pic.png' },
    });
    expect(row).not.toBeNull();
    expect(row!.reason).toBe('avatar_replaced');
  });

  it('queues row and immediately deletes from R2 when worker disabled (row persists as audit)', async () => {
    const uploads = makeUploads();
    configureDeletionQueue({ uploads, workerEnabled: false });

    await queueObjectDeletion({ objectKey: 'car/user-1/old.jpg', reason: 'car_photo_deleted' });

    expect(uploads.deleteObject).toHaveBeenCalledWith('car/user-1/old.jpg');
    const row = await prisma.uploadDeletionQueue.findUnique({
      where: { objectKey: 'car/user-1/old.jpg' },
    });
    expect(row).not.toBeNull();
    expect(row!.reason).toBe('car_photo_deleted');
  });

  it('keeps queue row when immediate R2 delete fails (best-effort)', async () => {
    const uploads = makeUploads();
    uploads.deleteObject.mockRejectedValueOnce(new Error('R2 unavailable'));
    configureDeletionQueue({ uploads, workerEnabled: false });

    await queueObjectDeletion({ objectKey: 'feed/post-1/img.png', reason: 'feed_post_deleted' });

    expect(uploads.deleteObject).toHaveBeenCalledWith('feed/post-1/img.png');
    const row = await prisma.uploadDeletionQueue.findUnique({
      where: { objectKey: 'feed/post-1/img.png' },
    });
    expect(row).not.toBeNull();
  });

  it('upserts when same objectKey queued twice', async () => {
    const uploads = makeUploads();
    configureDeletionQueue({ uploads, workerEnabled: true });

    await queueObjectDeletion({ objectKey: 'avatar/u/a.png', reason: 'first' });
    await queueObjectDeletion({ objectKey: 'avatar/u/a.png', reason: 'second' });

    const count = await prisma.uploadDeletionQueue.count({
      where: { objectKey: 'avatar/u/a.png' },
    });
    expect(count).toBe(1);
    const row = await prisma.uploadDeletionQueue.findUnique({
      where: { objectKey: 'avatar/u/a.png' },
    });
    expect(row!.reason).toBe('second');
  });
});
