import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  presignRequestSchema,
  presignResponseSchema,
  type PresignRequest,
  type PresignResponse,
} from '@jdm/shared/uploads';
import { z } from 'zod';

import { authedRequest } from './client';

export const requestPresign = (input: PresignRequest): Promise<PresignResponse> => {
  const parsed = presignRequestSchema.parse(input);
  return authedRequest('/uploads/presign', presignResponseSchema, {
    method: 'POST',
    body: parsed,
  });
};

// Body for POST /me/garage/cover/upload. No `kind` field — the server
// injects `garage_cover` so the client can never repoint the presign at
// another category. Response shape matches the generic presign response.
const garageCoverUploadRequestSchema = z
  .object({
    contentType: z.enum(ALLOWED_IMAGE_TYPES),
    size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  })
  .strict();
export type GarageCoverUploadRequest = z.infer<typeof garageCoverUploadRequestSchema>;

export const requestGarageCoverUpload = (
  input: GarageCoverUploadRequest,
): Promise<PresignResponse> => {
  const parsed = garageCoverUploadRequestSchema.parse(input);
  return authedRequest('/me/garage/cover/upload', presignResponseSchema, {
    method: 'POST',
    body: parsed,
  });
};
