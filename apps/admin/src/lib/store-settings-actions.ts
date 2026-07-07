'use server';

import type { StoreSettings, StoreSettingsUpdate } from '@jdm/shared/store';

import { getAdminStoreSettings, updateAdminStoreSettings } from './admin-api';
import { ApiError } from './api';

export type StoreSettingsActionResult =
  | { ok: true; settings: StoreSettings }
  | { ok: false; error: string };

export const fetchAdminStoreSettings = async (): Promise<StoreSettings> => {
  return getAdminStoreSettings();
};

export const updateAdminStoreSettingsAction = async (
  input: StoreSettingsUpdate,
): Promise<StoreSettingsActionResult> => {
  try {
    const settings = await updateAdminStoreSettings(input);
    return { ok: true, settings };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 400) {
        return { ok: false, error: 'Dados inválidos. Revise os campos e tente novamente.' };
      }
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};
