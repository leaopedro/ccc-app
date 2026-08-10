import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createId } from '@paralleldrive/cuid2';

import type { PresignInput, PresignResult, UploadKind, Uploads } from './types.js';
import { EXT_FOR_MIME, UPLOAD_CACHE_CONTROL, UPLOAD_KIND_PATH_PREFIX } from './types.js';

export class R2Uploads implements Uploads {
  private readonly client: S3Client;

  constructor(
    opts: { accountId: string; accessKeyId: string; secretAccessKey: string },
    private readonly bucket: string,
    private readonly publicBase: string,
    private readonly ttlSeconds: number,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      // R2 rejects the SDK's default CRC32 request checksum on presigned PUTs
      // (403 Forbidden). Only add checksum headers when explicitly required.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  async presignPut(input: PresignInput): Promise<PresignResult> {
    const ext = EXT_FOR_MIME[input.contentType] ?? 'bin';
    const prefix = UPLOAD_KIND_PATH_PREFIX[input.kind];
    const objectKey = `${prefix}/${input.userId}/${createId()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.size,
      ContentDisposition: 'inline',
      CacheControl: UPLOAD_CACHE_CONTROL,
      Metadata: { kind: input.kind },
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.ttlSeconds });
    return {
      uploadUrl,
      objectKey,
      publicUrl: this.buildPublicUrl(objectKey),
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.size),
        'content-disposition': 'inline',
        'cache-control': UPLOAD_CACHE_CONTROL,
        'x-amz-meta-kind': input.kind,
      },
    };
  }

  async presignGet(objectKey: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: this.ttlSeconds });
  }

  buildPublicUrl(objectKey: string): string {
    return `${this.publicBase.replace(/\/$/, '')}/${objectKey}`;
  }

  async buildSignedGetUrl(objectKey: string, ttlSeconds = this.ttlSeconds): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  isOwnedKey(objectKey: string, userId: string, kind: UploadKind): boolean {
    const prefix = UPLOAD_KIND_PATH_PREFIX[kind];
    return objectKey.startsWith(`${prefix}/${userId}/`);
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }
}
