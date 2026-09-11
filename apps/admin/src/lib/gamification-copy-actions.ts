'use server';

import type { AdminGamificationCopy, GamificationCopyUpdate } from '@ccc/shared/admin-gamification';
import { unstable_rethrow } from 'next/navigation';

import { getAdminGamificationCopy, updateAdminGamificationCopy } from './admin-api';
import { ApiError } from './api';

export type GamificationCopyActionResult =
  | { ok: true; copy: AdminGamificationCopy }
  | { ok: false; error: string };

export const fetchAdminGamificationCopy = async (): Promise<AdminGamificationCopy> =>
  getAdminGamificationCopy();

export const updateAdminGamificationCopyAction = async (
  input: GamificationCopyUpdate,
): Promise<GamificationCopyActionResult> => {
  try {
    const copy = await updateAdminGamificationCopy(input);
    return { ok: true, copy };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return {
          ok: false,
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
