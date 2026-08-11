import type { ProfileStatus } from '@ccc/shared/profile-status';
import { describe, expect, it } from 'vitest';

import { resolveDocumentBadge } from './document-status-badge';

const baseDoc = {
  id: 'doc1',
  type: 'cnh' as const,
  sentAt: '2026-01-01T00:00:00.000Z',
  reviewedAt: null,
  rejectionReason: null,
};

describe('resolveDocumentBadge', () => {
  it('renders the pending (warning) badge when no document was ever sent', () => {
    const badge = resolveDocumentBadge(null);
    expect(badge).toEqual({ tone: 'warning', label: 'Pendente' });
  });

  it('renders the validated (success) badge for a document under review', () => {
    const doc: ProfileStatus['latestDocument'] = { ...baseDoc, status: 'pending' };
    expect(resolveDocumentBadge(doc)).toEqual({ tone: 'success', label: 'Validado' });
  });

  it('renders the validated (success) badge for an approved document', () => {
    const doc: ProfileStatus['latestDocument'] = { ...baseDoc, status: 'approved' };
    expect(resolveDocumentBadge(doc)).toEqual({ tone: 'success', label: 'Validado' });
  });

  // Deliberate: a rejected document still reads green here. The member did
  // send something; the rejection reason and retry action live on the
  // document screen, not on this summary row.
  it('renders the validated (success) badge for a rejected document too', () => {
    const doc: ProfileStatus['latestDocument'] = {
      ...baseDoc,
      status: 'rejected',
      rejectionReason: 'Foto ilegível',
    };
    expect(resolveDocumentBadge(doc)).toEqual({ tone: 'success', label: 'Validado' });
  });
});
