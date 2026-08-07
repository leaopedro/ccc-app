import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export class R2Uploads implements Uploads {
  private readonly client: S3Client;

  constructor(
    opts: { accountId: string; accessKeyId: string; secretAccessKey: string },
    private readonly bucket: string,
    private readonly publicBase: string,
    private readonly ttlSeconds: number,
    // Dedicated private bucket for identity documents. Falls back to the main
    // bucket only so local dev and tests work — production MUST set it, since
    // the main bucket is readable through R2_PUBLIC_BASE_URL.
    private readonly documentsBucket?: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
  }

  private bucketFor(objectKey: string): string {
    return isDocumentKey(objectKey) ? (this.documentsBucket ?? this.bucket) : this.bucket;
  }

  async presignPut(input: PresignInput): Promise<PresignResult> {
    const ext = EXT_FOR_MIME[input.contentType] ?? 'bin';
    const prefix = UPLOAD_KIND_PATH_PREFIX[input.kind];
    const objectKey = `${prefix}/${input.userId}/${createId()}.${ext}`;
    const isDocument = isDocumentKey(objectKey);
    const disposition = isDocument ? DOCUMENT_CONTENT_DISPOSITION : 'inline';
    const cacheControl = isDocument ? DOCUMENT_CACHE_CONTROL : UPLOAD_CACHE_CONTROL;
    const command = new PutObjectCommand({
      Bucket: this.bucketFor(objectKey),
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.size,
      ContentDisposition: disposition,
      CacheControl: cacheControl,
      Metadata: { kind: input.kind },
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.ttlSeconds });
    return {
      uploadUrl,
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

  async presignGet(objectKey: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: this.ttlSeconds });
  }

  buildPublicUrl(objectKey: string): string {
    return `${this.publicBase.replace(/\/$/, '')}/${objectKey}`;
  }

  async buildSignedGetUrl(objectKey: string, ttlSeconds = this.ttlSeconds): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  isOwnedKey(objectKey: string, userId: string, kind: UploadKind): boolean {
    const prefix = UPLOAD_KIND_PATH_PREFIX[kind];
    return objectKey.startsWith(`${prefix}/${userId}/`);
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey }),
    );
  }
}
