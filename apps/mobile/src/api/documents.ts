import {
  createDocumentBodySchema,
  documentUploadRequestSchema,
  documentUploadResponseSchema,
  userDocumentListResponseSchema,
  userDocumentSchema,
  type CreateDocumentBody,
  type DocumentUploadRequest,
  type DocumentUploadResponse,
  type UserDocument,
} from '@ccc/shared/documents';
import type { z } from 'zod';

import { authedRequest } from './client';

// No exported type ships alongside userDocumentListResponseSchema in
// @ccc/shared/documents, so infer it locally rather than touching that
// package.
export type UserDocumentListResponse = z.infer<typeof userDocumentListResponseSchema>;

// POST /me/documents/upload. No `kind` field: the server injects
// `identity_document`, mirroring requestGarageCoverUpload in ./uploads.ts.
export const requestDocumentUpload = (
  input: DocumentUploadRequest,
): Promise<DocumentUploadResponse> => {
  const parsed = documentUploadRequestSchema.parse(input);
  return authedRequest('/me/documents/upload', documentUploadResponseSchema, {
    method: 'POST',
    body: parsed,
  });
};

export const createDocument = (input: CreateDocumentBody): Promise<UserDocument> => {
  const parsed = createDocumentBodySchema.parse(input);
  return authedRequest('/me/documents', userDocumentSchema, {
    method: 'POST',
    body: parsed,
  });
};

export const listDocuments = (): Promise<UserDocumentListResponse> =>
  authedRequest('/me/documents', userDocumentListResponseSchema);
