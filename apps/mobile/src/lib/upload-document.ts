import {
  MAX_DOCUMENT_BYTES,
  type UserDocument,
  type UserDocumentType,
} from '@ccc/shared/documents';

import { createDocument, requestDocumentUpload } from '~/api/documents';
import { uploadBlobToR2, type PickedImage } from '~/lib/upload-image';

// Thrown when the picked file is too large. Checked client-side, before the
// presign round trip, so an oversized pick fails fast with a message the
// screen can distinguish from a generic upload error.
export class DocumentTooLargeError extends Error {
  constructor() {
    super('document file exceeds the maximum allowed size');
    this.name = 'DocumentTooLargeError';
  }
}

// Composes the identity-document upload pipeline: blob -> presign -> PUT to
// R2 -> confirm. Takes an already-picked image (from pickImage() in
// ~/lib/upload-image) rather than picking itself: both callers (the document
// screen's preview step, and signup's inline row) pick first and only
// upload later, on an explicit "enviar"/submit action, so the network calls
// must not be bundled with the picker. Errors (ApiError,
// DocumentTooLargeError, network) propagate for the caller to map to copy.
export const uploadDocument = async (
  type: UserDocumentType,
  picked: PickedImage,
): Promise<UserDocument> => {
  const blob = await (await fetch(picked.uri)).blob();
  if (blob.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentTooLargeError();
  }
  const presign = await requestDocumentUpload({ contentType: picked.mime, size: blob.size });
  await uploadBlobToR2(blob, presign);
  return createDocument({ type, objectKey: presign.objectKey });
};
