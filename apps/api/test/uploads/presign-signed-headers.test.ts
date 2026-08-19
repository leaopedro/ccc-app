import { describe, expect, it } from 'vitest';

import { R2Uploads } from '../../src/services/uploads/r2.js';
import type { UploadKind } from '../../src/services/uploads/types.js';

// Dummy credentials: getSignedUrl signs locally, so no network call happens.
const uploads = new R2Uploads(
  { accountId: 'dummyaccount', accessKeyId: 'AKIDUMMY', secretAccessKey: 'secretdummy' },
  'main-bucket',
  'https://public.example',
  900,
  'docs-bucket',
);

const signedHeadersOf = (uploadUrl: string): string[] =>
  (new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');

describe('presigned PUT signed headers', () => {
  // R2 (like S3) rejects a presigned PUT with 403 SignatureDoesNotMatch when the
  // request carries an x-amz-* header that is not in X-Amz-SignedHeaders. Clients
  // send back every header in `headers`, so each x-amz-* one must be signed.
  const kinds: UploadKind[] = ['avatar', 'product_photo', 'identity_document'];

  for (const kind of kinds) {
    it(`signs every x-amz-* bound header for ${kind}`, async () => {
      const result = await uploads.presignPut({
        kind,
        userId: 'u1',
        contentType: 'image/png',
        size: 69,
      });
      const signed = signedHeadersOf(result.uploadUrl);
      const amzHeaders = Object.keys(result.headers).filter((h) => h.startsWith('x-amz-'));
      expect(amzHeaders).toContain('x-amz-meta-kind');
      for (const header of amzHeaders) {
        expect(signed).toContain(header);
      }
    });
  }

  it('does not hoist x-amz-meta-kind into the query string', async () => {
    const result = await uploads.presignPut({
      kind: 'product_photo',
      userId: 'u1',
      contentType: 'image/png',
      size: 69,
    });
    expect(new URL(result.uploadUrl).searchParams.get('x-amz-meta-kind')).toBeNull();
  });
});
