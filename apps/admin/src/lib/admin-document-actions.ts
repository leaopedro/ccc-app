'use server';

import { revalidatePath } from 'next/cache';

import { approveAdminDocument, getAdminDocumentFileUrl, rejectAdminDocument } from './admin-api';
import { ApiError } from './api';

export type DocumentReviewResult =
  | {
      ok: true;
      status: 'approved' | 'rejected';
      reviewedAt: string;
      rejectionReason: string | null;
    }
  | { ok: false; error: string };

const errFromApi = (err: unknown, fallback: string): string => {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Documento não encontrado.';
    if (err.status === 409) return 'Documento já foi revisado.';
    return err.message || fallback;
  }
  return fallback;
};

export const approveAdminDocumentAction = async (
  userId: string,
  documentId: string,
): Promise<DocumentReviewResult> => {
  try {
    const data = await approveAdminDocument(documentId);
    revalidatePath(`/users/${userId}`);
    return { ok: true, status: 'approved', reviewedAt: data.reviewedAt, rejectionReason: null };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao aprovar documento.') };
  }
};

export const rejectAdminDocumentAction = async (
  userId: string,
  documentId: string,
  reason: string,
): Promise<DocumentReviewResult> => {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: 'Informe o motivo da rejeição.' };
  if (trimmed.length > 200) return { ok: false, error: 'Motivo deve ter até 200 caracteres.' };
  try {
    const data = await rejectAdminDocument(documentId, trimmed);
    revalidatePath(`/users/${userId}`);
    return {
      ok: true,
      status: 'rejected',
      reviewedAt: data.reviewedAt,
      rejectionReason: data.rejectionReason ?? trimmed,
    };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao rejeitar documento.') };
  }
};

export type DocumentFileUrlResult = { ok: true; url: string } | { ok: false; error: string };

// Minted on demand, never on page load: this is a short-TTL credential for a
// private identity document (see AGENTS.md task brief). The server action
// boundary means the URL never sits in server-rendered HTML.
export const getAdminDocumentFileUrlAction = async (
  documentId: string,
): Promise<DocumentFileUrlResult> => {
  try {
    const url = await getAdminDocumentFileUrl(documentId);
    return { ok: true, url };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) return { ok: false, error: 'Documento não encontrado.' };
      if (err.status === 410) return { ok: false, error: 'Arquivo não está mais disponível.' };
      return { ok: false, error: err.message || 'Falha ao obter arquivo.' };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};
