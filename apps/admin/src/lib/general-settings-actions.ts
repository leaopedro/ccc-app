'use server';

import type { GeneralSettings, GeneralSettingsUpdate } from '@jdm/shared/general-settings';

import { getAdminGeneralSettings, updateAdminGeneralSettings } from './admin-api';
import { ApiError } from './api';

export type GeneralSettingsActionResult =
  | { ok: true; settings: GeneralSettings }
  | { ok: false; error: string };

export const fetchAdminGeneralSettings = async (): Promise<GeneralSettings> => {
  return getAdminGeneralSettings();
};

export const updateAdminGeneralSettingsAction = async (
  input: GeneralSettingsUpdate,
): Promise<GeneralSettingsActionResult> => {
  try {
    const settings = await updateAdminGeneralSettings(input);
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
