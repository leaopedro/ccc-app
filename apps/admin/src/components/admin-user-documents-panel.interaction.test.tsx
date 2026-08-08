// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { AdminUserDetailDocument } from '@ccc/shared/admin';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, approveMock, rejectMock, getFileUrlMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  approveMock: vi.fn(),
  rejectMock: vi.fn(),
  getFileUrlMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('~/lib/admin-document-actions', () => ({
  approveAdminDocumentAction: approveMock,
  rejectAdminDocumentAction: rejectMock,
  getAdminDocumentFileUrlAction: getFileUrlMock,
}));

import { AdminUserDocumentsPanel } from './admin-user-documents-panel';

const pendingDoc: AdminUserDetailDocument = {
  id: 'doc_1',
  type: 'rg',
  status: 'pending',
  sentAt: '2026-01-01T00:00:00.000Z',
  reviewedAt: null,
  rejectionReason: null,
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const findButton = (text: string): HTMLButtonElement | null =>
  Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').trim().startsWith(text),
  ) ?? null;

const renderPanel = async (props: { isAdmin: boolean; documents?: AdminUserDetailDocument[] }) => {
  await act(async () => {
    root.render(
      <AdminUserDocumentsPanel
        userId="u1"
        documents={props.documents ?? [pendingDoc]}
        isAdmin={props.isAdmin}
      />,
    );
    await Promise.resolve();
  });
};

beforeEach(() => {
  refreshMock.mockReset();
  approveMock.mockReset();
  rejectMock.mockReset();
  getFileUrlMock.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

describe('AdminUserDocumentsPanel — non-admin viewer', () => {
  it('renders nothing actionable when isAdmin is false', async () => {
    await renderPanel({ isAdmin: false });

    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.textContent).toBe('');
  });
});

describe('AdminUserDocumentsPanel — reject validation', () => {
  it('blocks confirming rejection with an empty reason', async () => {
    await renderPanel({ isAdmin: true });

    const rejeitar = findButton('Rejeitar');
    if (!rejeitar) throw new Error('Rejeitar button missing');
    await act(async () => {
      rejeitar.click();
      await Promise.resolve();
    });

    const confirmar = findButton('Confirmar rejeição');
    if (!confirmar) throw new Error('Confirmar rejeição button missing');
    expect(confirmar.disabled).toBe(true);
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it('caps the rejection reason textarea at 200 characters', async () => {
    await renderPanel({ isAdmin: true });

    const rejeitar = findButton('Rejeitar');
    if (!rejeitar) throw new Error('Rejeitar button missing');
    await act(async () => {
      rejeitar.click();
      await Promise.resolve();
    });

    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('reason textarea missing');
    expect(textarea.maxLength).toBe(200);
  });
});

describe('AdminUserDocumentsPanel — approve flow', () => {
  it('updates the status badge after a successful approve', async () => {
    approveMock.mockResolvedValue({
      ok: true,
      status: 'approved',
      reviewedAt: '2026-01-02T00:00:00.000Z',
      rejectionReason: null,
    });
    await renderPanel({ isAdmin: true });

    expect(container.textContent).toContain('Pendente');

    const aprovar = findButton('Aprovar');
    if (!aprovar) throw new Error('Aprovar button missing');
    await act(async () => {
      aprovar.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(approveMock).toHaveBeenCalledWith('u1', 'doc_1');
    expect(container.textContent).toContain('Aprovado');
    expect(refreshMock).toHaveBeenCalled();
  });
});
