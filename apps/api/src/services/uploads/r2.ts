import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
    // Dedicated private bucket for identity documents. Required in ANY
    // environment where R2 is configured, since the main bucket is readable
    // through R2_PUBLIC_BASE_URL — buildUploads (services/uploads/index.ts)
    // refuses to boot without it. Every real call path goes through
    // buildUploads, so the `?? this.bucket` fallback below never fires in
    // production; it exists only so tests can construct R2Uploads directly
    // without wiring a documents bucket.
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

  async objectExists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey }),
      );
      return true;
    } catch (err) {
      // The SDK surfaces a missing object either as err.name === 'NotFound'
      // or as a 404 in $metadata.httpStatusCode, depending on SDK version.
      // Any other error (network, auth, R2 outage) must propagate: treating
      // it as "does not exist" would reject a legitimate upload.
      const name = (err as { name?: string }).name;
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === 'NotFound' || status === 404) {
        return false;
      }
      throw err;
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey }),
    );
  }
}
