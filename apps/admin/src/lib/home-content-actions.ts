'use server';

import type { AdminHomeContent, HomeContentUpdate } from '@ccc/shared/admin-home';
import { presignResponseSchema } from '@ccc/shared/uploads';
import { unstable_rethrow } from 'next/navigation';

import { getAdminHomeContent, updateAdminHomeContent } from './admin-api';
import { ApiError, apiFetch } from './api';

export type HomeContentActionResult =
  | { ok: true; content: AdminHomeContent }
  | { ok: false; error: string; stale?: true };

export const fetchAdminHomeContent = async (): Promise<AdminHomeContent> => getAdminHomeContent();

export const updateAdminHomeContentAction = async (
  input: HomeContentUpdate,
): Promise<HomeContentActionResult> => {
  try {
    const content = await updateAdminHomeContent(input);
    return { ok: true, content };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return {
          ok: false,
          stale: true,
          error:
            'Alguém editou esta página enquanto você escrevia. Recarregue e refaça a alteração.',
        };
      }
      if (err.status === 400) {
        return { ok: false, error: 'Dados inválidos. Revise os campos e tente novamente.' };
      }
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};

/**
 * Sem parametro `kind` na assinatura de proposito: o kind e injetado no
 * servidor pela rota admin, entao nem por esta action o cliente consegue
 * apontar o presign para outra categoria de upload.
 */
export const presignHomeImageAction = async (input: { contentType: string; size: number }) =>
  apiFetch('/admin/home/images/presign', {
    method: 'POST',
    body: JSON.stringify(input),
    schema: presignResponseSchema,
  });
