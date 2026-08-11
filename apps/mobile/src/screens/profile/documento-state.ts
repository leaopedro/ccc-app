// Pure state machine for DocumentoScreen, extracted from the component so
// it can be tested without rendering, picking a real image, or hitting the
// network. The component only decides WHEN to dispatch (after pickImage(),
// after a network call resolves/rejects); this file decides WHAT the
// resulting screen state is. See plans/perfil-progressivo-plan.md §4.5 for
// the state table this implements.
import type { UserDocument, UserDocumentType } from '@ccc/shared/documents';

import type { PickedImage } from '~/lib/upload-image';

export type ScreenState =
  | { kind: 'loading' }
  | { kind: 'selecting_type'; message?: string }
  | { kind: 'capturing'; type: UserDocumentType }
  | { kind: 'preview'; type: UserDocumentType; picked: PickedImage }
  | { kind: 'uploading'; type: UserDocumentType; picked: PickedImage }
  | {
      kind: 'error';
      type: UserDocumentType;
      picked: PickedImage;
      message: string;
      // false for a rate limit: retrying immediately would just spend
      // another one of the same 5-per-15-minutes tokens and fail again, so
      // the screen hides the retry action instead of offering one that
      // cannot succeed.
      retryable: boolean;
    }
  | { kind: 'pending'; document: UserDocument }
  | { kind: 'approved'; document: UserDocument }
  | { kind: 'rejected'; document: UserDocument };

export type DocumentoAction =
  | { type: 'LOAD_STARTED' }
  | { type: 'LOAD_RESOLVED'; latest: UserDocument | null }
  | { type: 'LOAD_FAILED' }
  | { type: 'CAPTURE_STARTED'; docType: UserDocumentType }
  | { type: 'CAPTURE_CANCELLED' }
  | { type: 'CAPTURE_DENIED'; message: string }
  | { type: 'CAPTURE_PICKED'; picked: PickedImage }
  | { type: 'SEND_STARTED' }
  | { type: 'SEND_SUCCEEDED'; document: UserDocument }
  | { type: 'SEND_FAILED'; message: string; retryable: boolean }
  | { type: 'RETRY_REQUESTED' }
  | { type: 'RESET_TO_SELECTING' };

export const initialDocumentoState: ScreenState = { kind: 'loading' };

// Shared by the mount load and the 409-DOCUMENT_ALREADY_PENDING recheck: a
// live (pending/approved) doc wins, a rejected one shows its reason, no
// doc at all (or the fetch itself failing) falls back to the picker.
const resolveFromLatest = (latest: UserDocument | null): ScreenState => {
  if (latest && (latest.status === 'pending' || latest.status === 'approved')) {
    return { kind: latest.status, document: latest };
  }
  if (latest && latest.status === 'rejected') {
    return { kind: 'rejected', document: latest };
  }
  return { kind: 'selecting_type' };
};

export function documentoReducer(state: ScreenState, action: DocumentoAction): ScreenState {
  switch (action.type) {
    case 'LOAD_STARTED':
      return { kind: 'loading' };
    case 'LOAD_RESOLVED':
      return resolveFromLatest(action.latest);
    case 'LOAD_FAILED':
      // Fail open to the picker: worst case, a live document missed by this
      // fetch surfaces as a 409 on submit, handled by the same resolution.
      return { kind: 'selecting_type' };
    case 'CAPTURE_STARTED':
      return { kind: 'capturing', type: action.docType };
    case 'CAPTURE_CANCELLED':
      return { kind: 'selecting_type' };
    case 'CAPTURE_DENIED':
      return { kind: 'selecting_type', message: action.message };
    case 'CAPTURE_PICKED':
      if (state.kind !== 'capturing') return state;
      return { kind: 'preview', type: state.type, picked: action.picked };
    case 'SEND_STARTED':
      if (state.kind !== 'preview' && state.kind !== 'error') return state;
      return { kind: 'uploading', type: state.type, picked: state.picked };
    case 'SEND_SUCCEEDED':
      return { kind: 'pending', document: action.document };
    case 'SEND_FAILED':
      if (state.kind !== 'uploading') return state;
      return {
        kind: 'error',
        type: state.type,
        picked: state.picked,
        message: action.message,
        retryable: action.retryable,
      };
    case 'RETRY_REQUESTED':
      if (state.kind !== 'error') return state;
      return { kind: 'preview', type: state.type, picked: state.picked };
    case 'RESET_TO_SELECTING':
      return { kind: 'selecting_type' };
    default:
      return state;
  }
}
