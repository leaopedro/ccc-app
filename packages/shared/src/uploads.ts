import { z } from 'zod';

// Client-allowed upload kinds. Drives the zod for POST /uploads/presign, so
// any kind listed here is reachable by any authenticated client. Premium-
// gated kinds (e.g. garage_cover) are intentionally NOT listed — they live
// only in the API-internal `UploadKind` union and are reachable only via
// their own gated wrapper endpoint.
export const UPLOAD_KINDS = [
  'avatar',
  'car_photo',
  'event_cover',
  'feed_photo',
  'product_photo',
  'support_attachment',
] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const presignRequestSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type PresignRequest = z.infer<typeof presignRequestSchema>;

export const presignResponseSchema = z.object({
  uploadUrl: z.string().url(),
  objectKey: z.string().min(1),
  publicUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  headers: z.record(z.string()),
});
export type PresignResponse = z.infer<typeof presignResponseSchema>;
