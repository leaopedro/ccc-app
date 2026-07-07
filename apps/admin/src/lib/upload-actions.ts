'use server';

import { presignRequestSchema, presignResponseSchema } from '@jdm/shared/uploads';

import { apiFetch } from './api';

export type PresignInput = { contentType: string; size: number };

export const presignEventCoverAction = async (input: PresignInput) => {
  const body = presignRequestSchema.parse({ kind: 'event_cover', ...input });
  return apiFetch('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify(body),
    schema: presignResponseSchema,
  });
};

export const presignProductPhotoAction = async (input: PresignInput) => {
  const body = presignRequestSchema.parse({ kind: 'product_photo', ...input });
  return apiFetch('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify(body),
    schema: presignResponseSchema,
  });
};
