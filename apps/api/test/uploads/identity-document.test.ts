import { describe, expect, it } from 'vitest';

import { DevUploads } from '../../src/services/uploads/dev.js';
import { R2Uploads } from '../../src/services/uploads/r2.js';
import {
  DOCUMENT_CACHE_CONTROL,
  DOCUMENT_PATH_PREFIX,
  UPLOAD_KIND_PATH_PREFIX,
} from '../../src/services/uploads/types.js';

// Dummy credentials: getSignedUrl computes a SigV4 signature locally and
// makes no network call, so these tests need no real R2 account.
const DUMMY_OPTS = {
  accountId: 'dummyaccount',
  accessKeyId: 'AKIDUMMY',
  secretAccessKey: 'secretdummy',
};
const MAIN_BUCKET = 'main-bucket';
const DOCUMENTS_BUCKET = 'docs-bucket';

describe('identity_document upload kind', () => {
  it('maps to a hyphenated private prefix', () => {
    expect(UPLOAD_KIND_PATH_PREFIX.identity_document).toBe('identity-document');
    expect(DOCUMENT_PATH_PREFIX).toBe('identity-document');
  });

  it('presigns under the owner-scoped document prefix', async () => {
    const uploads = new DevUploads();
    const result = await uploads.presignPut({
      kind: 'identity_document',
      userId: 'u1',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(result.objectKey).toMatch(/^identity-document\/u1\/[a-z0-9]+\.jpg$/);
  });

  it('sends private, non-inline headers for documents', async () => {
    const uploads = new DevUploads();
    const result = await uploads.presignPut({
      kind: 'identity_document',
      userId: 'u1',
      contentType: 'image/png',
      size: 1024,
    });
    expect(result.headers['content-disposition']).toBe('attachment');
    expect(result.headers['cache-control']).toBe(DOCUMENT_CACHE_CONTROL);
    expect(result.headers['x-amz-meta-kind']).toBe('identity_document');
  });

  it('keeps public headers for a non-document kind', async () => {
    const uploads = new DevUploads();
    const result = await uploads.presignPut({
      kind: 'avatar',
      userId: 'u1',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(result.headers['content-disposition']).toBe('inline');
    expect(result.headers['cache-control']).not.toBe(DOCUMENT_CACHE_CONTROL);
  });

  it('scopes ownership to the requesting user', () => {
    const uploads = new DevUploads();
    expect(uploads.isOwnedKey('identity-document/u1/a.jpg', 'u1', 'identity_document')).toBe(true);
    expect(uploads.isOwnedKey('identity-document/u2/a.jpg', 'u1', 'identity_document')).toBe(false);
    expect(uploads.isOwnedKey('avatar/u1/a.jpg', 'u1', 'identity_document')).toBe(false);
  });

  it('returns no public URL for a document, unlike a non-document kind', async () => {
    const uploads = new DevUploads();
    const docResult = await uploads.presignPut({
      kind: 'identity_document',
      userId: 'u1',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(docResult.publicUrl).toBe('');

    const avatarResult = await uploads.presignPut({
      kind: 'avatar',
      userId: 'u1',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(avatarResult.publicUrl).not.toBe('');
  });
});

describe('R2Uploads bucket routing', () => {
  it('presigns a document key into the private documents bucket', async () => {
    const uploads = new R2Uploads(
      DUMMY_OPTS,
      MAIN_BUCKET,
      'https://public.example.com',
      60,
      DOCUMENTS_BUCKET,
    );
    const result = await uploads.presignPut({
      kind: 'identity_document',
      userId: 'u1',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(result.uploadUrl).toContain(`https://${DOCUMENTS_BUCKET}.`);
    expect(result.uploadUrl).not.toContain(`https://${MAIN_BUCKET}.`);
    expect(result.publicUrl).toBe('');
  });

  it('presigns a non-document key into the main bucket', async () => {
    const uploads = new R2Uploads(
      DUMMY_OPTS,
      MAIN_BUCKET,
      'https://public.example.com',
      60,
      DOCUMENTS_BUCKET,
    );
    const result = await uploads.presignPut({
      kind: 'avatar',
      userId: 'u1',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(result.uploadUrl).toContain(`https://${MAIN_BUCKET}.`);
    expect(result.uploadUrl).not.toContain(`https://${DOCUMENTS_BUCKET}.`);
  });

  it('buildSignedGetUrl on a document key targets the documents bucket', async () => {
    const uploads = new R2Uploads(
      DUMMY_OPTS,
      MAIN_BUCKET,
      'https://public.example.com',
      60,
      DOCUMENTS_BUCKET,
    );
    const url = await uploads.buildSignedGetUrl(`${DOCUMENT_PATH_PREFIX}/u1/a.jpg`);
    expect(url).toContain(`https://${DOCUMENTS_BUCKET}.`);
    expect(url).not.toContain(`https://${MAIN_BUCKET}.`);
  });

  it('falls back to the main bucket for a document key when documentsBucket is unset', async () => {
    const uploads = new R2Uploads(DUMMY_OPTS, MAIN_BUCKET, 'https://public.example.com', 60);
    const result = await uploads.presignPut({
      kind: 'identity_document',
      userId: 'u1',
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(result.uploadUrl).toContain(`https://${MAIN_BUCKET}.`);
  });
});
