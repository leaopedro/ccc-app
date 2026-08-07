import { describe, expect, it } from 'vitest';

import { DevUploads } from '../../src/services/uploads/dev.js';
import {
  DOCUMENT_CACHE_CONTROL,
  DOCUMENT_PATH_PREFIX,
  UPLOAD_KIND_PATH_PREFIX,
} from '../../src/services/uploads/types.js';

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
});
