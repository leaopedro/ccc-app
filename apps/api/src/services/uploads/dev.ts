import { createId } from '@paralleldrive/cuid2';

import type { PresignInput, PresignResult, UploadKind, Uploads } from './types.js';
import {
  DOCUMENT_CACHE_CONTROL,
  DOCUMENT_CONTENT_DISPOSITION,
  EXT_FOR_MIME,
  isDocumentKey,
  UPLOAD_CACHE_CONTROL,
  UPLOAD_KIND_PATH_PREFIX,
} from './types.js';

export class DevUploads implements Uploads {
  constructor(
    private readonly publicBase = 'http://localhost:4000/dev-uploads',
    private readonly ttlSeconds = 300,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async presignPut(input: PresignInput): Promise<PresignResult> {
    const ext = EXT_FOR_MIME[input.contentType] ?? 'bin';
    const prefix = UPLOAD_KIND_PATH_PREFIX[input.kind];
    const objectKey = `${prefix}/${input.userId}/${createId()}.${ext}`;
    const isDocument = isDocumentKey(objectKey);
    const disposition = isDocument ? DOCUMENT_CONTENT_DISPOSITION : 'inline';
    const cacheControl = isDocument ? DOCUMENT_CACHE_CONTROL : UPLOAD_CACHE_CONTROL;
    return {
      uploadUrl: `${this.publicBase}/put/${objectKey}`,
      objectKey,
      // An identity document has no public URL by design: callers must
      // request a short-lived signed URL via buildSignedGetUrl instead.
      publicUrl: isDocument ? '' : this.buildPublicUrl(objectKey),
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.size),
        'content-disposition': disposition,
        'cache-control': cacheControl,
        'x-amz-meta-kind': input.kind,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async presignGet(objectKey: string): Promise<string> {
    return this.buildPublicUrl(objectKey);
  }

  buildPublicUrl(objectKey: string): string {
    return `${this.publicBase}/${objectKey}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async buildSignedGetUrl(objectKey: string, ttlSeconds = this.ttlSeconds): Promise<string> {
    return `${this.publicBase}/${objectKey}?signed=dev&exp=${Date.now() + ttlSeconds * 1000}`;
  }

  isOwnedKey(objectKey: string, userId: string, kind: UploadKind): boolean {
    const prefix = UPLOAD_KIND_PATH_PREFIX[kind];
    return objectKey.startsWith(`${prefix}/${userId}/`);
  }

  async deleteObject(_objectKey: string): Promise<void> {
    // no-op in dev
  }
}
