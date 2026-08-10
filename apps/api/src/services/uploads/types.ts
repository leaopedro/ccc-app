export type UploadKind =
  | 'avatar'
  | 'car_photo'
  | 'event_cover'
  | 'feed_photo'
  | 'product_photo'
  | 'support_attachment'
  | 'garage_cover'
  | 'box_item'
  | 'partner_logo'
  | 'partner_module';

// Maps a UploadKind to its R2 path prefix. Identity for pre-existing kinds
// that already use the snake_case kind id verbatim in their R2 paths;
// explicit entries override when an external naming contract (e.g. the
// hyphenated 'garage-cover/' the renderer expects) diverges from the
// snake_case kind id. New kinds default to using the kind id verbatim.
export const UPLOAD_KIND_PATH_PREFIX: Record<UploadKind, string> = {
  avatar: 'avatar',
  car_photo: 'car_photo',
  event_cover: 'event_cover',
  feed_photo: 'feed_photo',
  product_photo: 'product_photo',
  support_attachment: 'support_attachment',
  garage_cover: 'garage-cover',
  box_item: 'box_item',
  partner_logo: 'partner_logo',
  partner_module: 'partner_module',
};

export type PresignInput = {
  kind: UploadKind;
  userId: string;
  contentType: string;
  size: number;
};

export type PresignResult = {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  expiresAt: Date;
  headers: Record<string, string>;
};

export interface Uploads {
  presignPut(input: PresignInput): Promise<PresignResult>;
  presignGet(objectKey: string): Promise<string>;
  buildPublicUrl(objectKey: string): string;
  buildSignedGetUrl(objectKey: string, ttlSeconds?: number): Promise<string>;
  isOwnedKey(objectKey: string, userId: string, kind: UploadKind): boolean;
  isKindKey(objectKey: string, kind: UploadKind): boolean;
  deleteObject(objectKey: string): Promise<void>;
}

export const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const UPLOAD_CACHE_CONTROL = 'public, max-age=31536000, immutable';
