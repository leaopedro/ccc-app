'use server';

import { mfaRecoverySchema, mfaVerifySchema } from '@jdm/shared';
import { authResponseSchema, loginResponseSchema, loginSchema } from '@jdm/shared/auth';
import { redirect } from 'next/navigation';

import { apiFetch, ApiError } from './api';
import { clearSession, writeSession } from './auth-session';

export type LoginState = { error: string | null; mfaToken?: string };

export const loginAction = async (_prev: LoginState, formData: FormData): Promise<LoginState> => {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Email ou senha inválidos.' };
  let role: string;
  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      schema: loginResponseSchema,
      auth: false,
    });
    if ('mfaRequired' in res) {
      return { error: null, mfaToken: res.mfaToken };
    }
    if (res.user.role !== 'organizer' && res.user.role !== 'admin' && res.user.role !== 'staff') {
      return { error: 'Conta sem permissão de administrador.' };
    }
    await writeSession(res);
    role = res.user.role;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { error: 'Credenciais inválidas.' };
    }
    if (e instanceof ApiError && e.status === 403) {
      return { error: 'Verifique seu email antes de entrar.' };
    }
    return { error: 'Erro ao entrar. Tente novamente.' };
  }
  redirect(role === 'staff' ? '/check-in' : '/events');
};

export const mfaVerifyAction = async (
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> => {
  const mfaToken = formData.get('mfaToken') as string;
  const code = formData.get('code') as string;
  const parsed = mfaVerifySchema.safeParse({ mfaToken, code });
  if (!parsed.success) return { error: 'Código inválido. Use 6 dígitos.', mfaToken };
  let role: string;
  try {
    const res = await apiFetch('/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      schema: authResponseSchema,
      auth: false,
    });
    if (res.user.role !== 'organizer' && res.user.role !== 'admin' && res.user.role !== 'staff') {
      return { error: 'Conta sem permissão de administrador.' };
    }
    await writeSession(res);
    role = res.user.role;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { error: 'Código inválido ou expirado.', mfaToken };
    }
    return { error: 'Erro ao verificar. Tente novamente.', mfaToken };
  }
  redirect(role === 'staff' ? '/check-in' : '/events');
};

export const mfaRecoveryAction = async (
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> => {
  const mfaToken = formData.get('mfaToken') as string;
  const code = formData.get('code') as string;
  const parsed = mfaRecoverySchema.safeParse({ mfaToken, code });
  if (!parsed.success) return { error: 'Formato inválido. Use XXXX-XXXX-XXXX.', mfaToken };
  let role: string;
  try {
    const res = await apiFetch('/auth/mfa/recovery', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      schema: authResponseSchema,
      auth: false,
    });
    if (res.user.role !== 'organizer' && res.user.role !== 'admin' && res.user.role !== 'staff') {
      return { error: 'Conta sem permissão de administrador.' };
    }
    await writeSession(res);
    role = res.user.role;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { error: 'Código de recuperação inválido.', mfaToken };
    }
    return { error: 'Erro ao verificar. Tente novamente.', mfaToken };
  }
  redirect(role === 'staff' ? '/check-in' : '/events');
};

export const logoutAction = async (): Promise<void> => {
  await clearSession();
  redirect('/login');
};
