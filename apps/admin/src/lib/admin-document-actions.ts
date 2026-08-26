'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

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

// Next App Router signals navigation by throwing an error with
// `digest: 'NEXT_REDIRECT;...'`. Any try/catch around apiFetch (which calls
// redirect('/login?reauth=1') on a failed refresh in lib/api.ts) must rethrow
// that error or the framework never performs the redirect — see
// node_modules/next/dist/docs/01-app/02-guides/redirecting.md ("redirect
// throws an error so it should be called outside the try block"). Same
// helper as apps/admin/app/premium/page.tsx, duplicated locally since it
// isn't exported from a shared module.
const isRedirectError = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  'digest' in e &&
  typeof (e as { digest: unknown }).digest === 'string' &&
  (e as { digest: string }).digest.startsWith('NEXT_REDIRECT');

// Never echo err.message: it can be the API's raw English text (e.g.
// "insufficient role" from requireRole, or "Bad Request" from res.statusText
// when a ValidationError body carries no message at all). Always fall back
// to fixed PT-BR copy instead.
const errFromApi = (err: unknown, fallback: string): string => {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Documento não encontrado.';
    if (err.status === 409) return 'Documento já foi revisado.';
    return fallback;
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
    unstable_rethrow(err);
    if (isRedirectError(err)) throw err;
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
    unstable_rethrow(err);
    if (isRedirectError(err)) throw err;
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
    unstable_rethrow(err);
    if (isRedirectError(err)) throw err;
    if (err instanceof ApiError) {
      if (err.status === 404) return { ok: false, error: 'Documento não encontrado.' };
      if (err.status === 410) return { ok: false, error: 'Arquivo não está mais disponível.' };
      return { ok: false, error: 'Falha ao obter arquivo.' };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};
