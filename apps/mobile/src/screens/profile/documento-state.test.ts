import { describe, expect, it } from 'vitest';

import { documentoReducer, initialDocumentoState, type ScreenState } from './documento-state';

import type { PickedImage } from '~/lib/upload-image';

const picked: PickedImage = {
  uri: 'file:///tmp/doc.jpg',
  mime: 'image/jpeg',
  size: 500,
  width: 800,
  height: 600,
};

const pendingDoc = {
  id: 'doc1',
  type: 'cnh' as const,
  status: 'pending' as const,
  sentAt: '2026-01-01T00:00:00.000Z',
  reviewedAt: null,
  rejectionReason: null,
  fileUrl: null,
};

const approvedDoc = { ...pendingDoc, id: 'doc2', status: 'approved' as const };
const rejectedDoc = {
  ...pendingDoc,
  id: 'doc3',
  status: 'rejected' as const,
  rejectionReason: 'Foto ilegível',
};

describe('documentoReducer', () => {
  it('starts loading', () => {
    expect(initialDocumentoState).toEqual({ kind: 'loading' });
  });

  it('LOAD_RESOLVED with no document goes to selecting_type', () => {
    const state = documentoReducer({ kind: 'loading' }, { type: 'LOAD_RESOLVED', latest: null });
    expect(state).toEqual({ kind: 'selecting_type' });
  });

  it('LOAD_RESOLVED with a pending document shows it', () => {
    const state = documentoReducer(
      { kind: 'loading' },
      { type: 'LOAD_RESOLVED', latest: pendingDoc },
    );
    expect(state).toEqual({ kind: 'pending', document: pendingDoc });
  });

  it('LOAD_RESOLVED with an approved document shows it', () => {
    const state = documentoReducer(
      { kind: 'loading' },
      { type: 'LOAD_RESOLVED', latest: approvedDoc },
    );
    expect(state).toEqual({ kind: 'approved', document: approvedDoc });
  });

  it('LOAD_RESOLVED with a rejected document shows it with the reason', () => {
    const state = documentoReducer(
      { kind: 'loading' },
      { type: 'LOAD_RESOLVED', latest: rejectedDoc },
    );
    expect(state).toEqual({ kind: 'rejected', document: rejectedDoc });
  });

  it('LOAD_FAILED fails open to the picker', () => {
    const state = documentoReducer({ kind: 'loading' }, { type: 'LOAD_FAILED' });
    expect(state).toEqual({ kind: 'selecting_type' });
  });

  it('CAPTURE_STARTED enters capturing for the chosen type', () => {
    const state = documentoReducer(
      { kind: 'selecting_type' },
      { type: 'CAPTURE_STARTED', docType: 'rg' },
    );
    expect(state).toEqual({ kind: 'capturing', type: 'rg' });
  });

  it('CAPTURE_CANCELLED returns to selecting_type with no message', () => {
    const state = documentoReducer(
      { kind: 'capturing', type: 'cnh' },
      { type: 'CAPTURE_CANCELLED' },
    );
    expect(state).toEqual({ kind: 'selecting_type' });
  });

  it('CAPTURE_DENIED returns to selecting_type with a message', () => {
    const state = documentoReducer(
      { kind: 'capturing', type: 'cnh' },
      { type: 'CAPTURE_DENIED', message: 'sem permissão' },
    );
    expect(state).toEqual({ kind: 'selecting_type', message: 'sem permissão' });
  });

  it('CAPTURE_PICKED moves capturing to preview, keeping the chosen type', () => {
    const state = documentoReducer(
      { kind: 'capturing', type: 'rg' },
      { type: 'CAPTURE_PICKED', picked },
    );
    expect(state).toEqual({ kind: 'preview', type: 'rg', picked });
  });

  it('CAPTURE_PICKED is a no-op outside capturing', () => {
    const current: ScreenState = { kind: 'selecting_type' };
    const state = documentoReducer(current, { type: 'CAPTURE_PICKED', picked });
    expect(state).toBe(current);
  });

  it('SEND_STARTED moves preview to uploading', () => {
    const state = documentoReducer(
      { kind: 'preview', type: 'cnh', picked },
      { type: 'SEND_STARTED' },
    );
    expect(state).toEqual({ kind: 'uploading', type: 'cnh', picked });
  });

  it('SEND_STARTED moves error to uploading (retry)', () => {
    const state = documentoReducer(
      { kind: 'error', type: 'cnh', picked, message: 'falhou', retryable: true },
      { type: 'SEND_STARTED' },
    );
    expect(state).toEqual({ kind: 'uploading', type: 'cnh', picked });
  });

  it('SEND_SUCCEEDED lands on pending with the created document', () => {
    const state = documentoReducer(
      { kind: 'uploading', type: 'cnh', picked },
      { type: 'SEND_SUCCEEDED', document: pendingDoc },
    );
    expect(state).toEqual({ kind: 'pending', document: pendingDoc });
  });

  it('SEND_FAILED moves uploading to error, retryable by default', () => {
    const state = documentoReducer(
      { kind: 'uploading', type: 'cnh', picked },
      { type: 'SEND_FAILED', message: 'deu erro', retryable: true },
    );
    expect(state).toEqual({
      kind: 'error',
      type: 'cnh',
      picked,
      message: 'deu erro',
      retryable: true,
    });
  });

  it('SEND_FAILED can mark the error as not retryable (rate limit)', () => {
    const state = documentoReducer(
      { kind: 'uploading', type: 'cnh', picked },
      { type: 'SEND_FAILED', message: 'muitas tentativas', retryable: false },
    );
    expect(state).toMatchObject({ kind: 'error', retryable: false });
  });

  it('RETRY_REQUESTED moves error back to preview with the same picked file', () => {
    const state = documentoReducer(
      { kind: 'error', type: 'rg', picked, message: 'falhou', retryable: true },
      { type: 'RETRY_REQUESTED' },
    );
    expect(state).toEqual({ kind: 'preview', type: 'rg', picked });
  });

  it('RESET_TO_SELECTING returns to selecting_type from rejected', () => {
    const state = documentoReducer(
      { kind: 'rejected', document: rejectedDoc },
      { type: 'RESET_TO_SELECTING' },
    );
    expect(state).toEqual({ kind: 'selecting_type' });
  });
});
