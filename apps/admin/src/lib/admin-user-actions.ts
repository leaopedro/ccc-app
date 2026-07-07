'use server';

import type { UserStatusName } from '@jdm/shared/auth';

import { createAdminUser, disableAdminUser, enableAdminUser } from './admin-api';
import { ApiError } from './api';

export type CreateUserActionResult = { ok: true; id: string } | { ok: false; error: string };

export const createAdminUserAction = async (email: string): Promise<CreateUserActionResult> => {
  try {
    const user = await createAdminUser({ email });
    return { ok: true, id: user.id };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return { ok: false, error: 'Já existe um usuário com este email.' };
      }
      if (err.status === 400) {
        return { ok: false, error: 'Email inválido.' };
      }
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};

export type StatusActionResult =
  | { ok: true; status: UserStatusName }
  | { ok: false; error: string };

export const disableAdminUserAction = async (id: string): Promise<StatusActionResult> => {
  try {
    const res = await disableAdminUser(id);
    return { ok: true, status: res.status };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 400) {
        return { ok: false, error: 'Você não pode desabilitar a sua própria conta.' };
      }
      return { ok: false, error: err.message };
    }
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};

export const enableAdminUserAction = async (id: string): Promise<StatusActionResult> => {
  try {
    const res = await enableAdminUser(id);
    return { ok: true, status: res.status };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: 'Erro inesperado. Tente novamente.' };
  }
};
