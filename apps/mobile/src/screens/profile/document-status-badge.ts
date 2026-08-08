// Pure decision logic for the "Documento de identidade" status row on the
// profile edit screen. Driven by `latestDocument`, NOT by
// `ProfileStatus.fields.document`: `fields.document` is the subscription
// gate's view and only counts `pending`/`approved`, so a rejected document
// reads as false there. The product owner was asked directly what a
// rejected document should show on this row and chose green "Validado":
// from the member's point of view they already sent it, and the rejection
// detail plus the retry flow live on the document screen itself. All three
// statuses (pending, approved, rejected) render green here. Do not "fix"
// this to only cover pending/approved.
import type { ProfileStatus } from '@ccc/shared/profile-status';

import { profileCopy } from '~/copy/profile';

export type DocumentBadgeTone = 'success' | 'warning';

export type DocumentBadge = {
  tone: DocumentBadgeTone;
  label: string;
};

export function resolveDocumentBadge(
  latestDocument: ProfileStatus['latestDocument'],
): DocumentBadge {
  if (latestDocument === null) {
    return { tone: 'warning', label: profileCopy.documento.statusPending };
  }
  return { tone: 'success', label: profileCopy.documento.statusValidated };
}
