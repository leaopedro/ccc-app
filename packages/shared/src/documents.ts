import { z } from 'zod';

export const USER_DOCUMENT_TYPES = ['cnh', 'rg'] as const;
export type UserDocumentType = (typeof USER_DOCUMENT_TYPES)[number];

export const USER_DOCUMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type UserDocumentStatus = (typeof USER_DOCUMENT_STATUSES)[number];

// Deliberately separate from ALLOWED_IMAGE_TYPES in ./uploads. Adding PDF to
// documents must not widen what avatars and car photos accept.
export const ALLOWED_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const documentUploadRequestSchema = z
  .object({
    contentType: z.enum(ALLOWED_DOCUMENT_TYPES),
    size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  })
  .strict();
export type DocumentUploadRequest = z.infer<typeof documentUploadRequestSchema>;

// No `publicUrl`: presignResponseSchema in ./uploads requires it to be a valid
// URL, and an identity document has no public URL by design.
export const documentUploadResponseSchema = z.object({
  uploadUrl: z.string().url(),
  objectKey: z.string().min(1),
  expiresAt: z.string().datetime(),
  headers: z.record(z.string()),
});
export type DocumentUploadResponse = z.infer<typeof documentUploadResponseSchema>;

export const createDocumentBodySchema = z
  .object({
    type: z.enum(USER_DOCUMENT_TYPES),
    objectKey: z.string().min(1).max(500),
  })
  .strict();
export type CreateDocumentBody = z.infer<typeof createDocumentBodySchema>;

export const userDocumentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(USER_DOCUMENT_TYPES),
  status: z.enum(USER_DOCUMENT_STATUSES),
  sentAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
  // Null once retention purged the object; the row survives for audit.
  fileUrl: z.string().nullable(),
});
export type UserDocument = z.infer<typeof userDocumentSchema>;

export const userDocumentListResponseSchema = z.object({
  items: z.array(userDocumentSchema),
});

export const DOCUMENT_ALREADY_PENDING_CODE = 'DOCUMENT_ALREADY_PENDING' as const;

// A "live" document is one that satisfies the subscription gate. Single source
// of truth: services/profile/completeness.ts filters on it, and
// routes/me-documents.ts enforces one-live-at-a-time with it. Optimistic
// auto-approval is exactly the decision that `pending` belongs in this list.
export const LIVE_DOCUMENT_STATUSES = ['pending', 'approved'] as const;
