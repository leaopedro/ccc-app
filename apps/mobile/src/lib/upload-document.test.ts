import { afterEach, describe, expect, it, vi } from 'vitest';

const requestDocumentUploadMock = vi.fn();
const createDocumentMock = vi.fn();
const uploadBlobToR2Mock = vi.fn();

vi.mock('~/api/documents', () => ({
  requestDocumentUpload: (...args: unknown[]) => requestDocumentUploadMock(...args),
  createDocument: (...args: unknown[]) => createDocumentMock(...args),
}));

vi.mock('~/lib/upload-image', () => ({
  uploadBlobToR2: (...args: unknown[]) => uploadBlobToR2Mock(...args),
}));

const { uploadDocument, DocumentTooLargeError } = await import('./upload-document');

const picked = {
  uri: 'file:///tmp/doc.jpg',
  mime: 'image/jpeg' as const,
  size: 500,
  width: 800,
  height: 600,
};

describe('uploadDocument', () => {
  afterEach(() => {
    requestDocumentUploadMock.mockReset();
    createDocumentMock.mockReset();
    uploadBlobToR2Mock.mockReset();
    vi.unstubAllGlobals();
  });

  it('composes presign, PUT and confirm for a normal-sized file', async () => {
    const blob = { size: 500 } as Blob;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) } as unknown as Response),
    );
    requestDocumentUploadMock.mockResolvedValueOnce({
      uploadUrl: 'https://r2.example/upload',
      objectKey: 'identity-document/u1/doc.jpg',
      expiresAt: '2099-01-01T00:00:00.000Z',
      headers: {},
    });
    uploadBlobToR2Mock.mockResolvedValueOnce(undefined);
    createDocumentMock.mockResolvedValueOnce({
      id: 'doc1',
      type: 'cnh',
      status: 'pending',
      sentAt: '2026-01-01T00:00:00.000Z',
      reviewedAt: null,
      rejectionReason: null,
      fileUrl: null,
    });

    const result = await uploadDocument('cnh', picked);

    expect(requestDocumentUploadMock).toHaveBeenCalledWith({
      contentType: 'image/jpeg',
      size: 500,
    });
    expect(uploadBlobToR2Mock).toHaveBeenCalledWith(
      blob,
      expect.objectContaining({ objectKey: 'identity-document/u1/doc.jpg' }),
    );
    expect(createDocumentMock).toHaveBeenCalledWith({
      type: 'cnh',
      objectKey: 'identity-document/u1/doc.jpg',
    });
    expect(result.status).toBe('pending');
  });

  it('throws DocumentTooLargeError before presigning when the blob exceeds the max size', async () => {
    const oversized = { size: 11 * 1024 * 1024 } as Blob;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ blob: () => Promise.resolve(oversized) } as unknown as Response),
    );

    await expect(uploadDocument('rg', picked)).rejects.toBeInstanceOf(DocumentTooLargeError);
    expect(requestDocumentUploadMock).not.toHaveBeenCalled();
    expect(uploadBlobToR2Mock).not.toHaveBeenCalled();
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it('propagates a presign failure without calling createDocument', async () => {
    const blob = { size: 500 } as Blob;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) } as unknown as Response),
    );
    requestDocumentUploadMock.mockRejectedValueOnce(new Error('network down'));

    await expect(uploadDocument('cnh', picked)).rejects.toThrow('network down');
    expect(createDocumentMock).not.toHaveBeenCalled();
  });
});
