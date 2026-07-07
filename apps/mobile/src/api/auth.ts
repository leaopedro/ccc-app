import {
  authResponseSchema,
  type AuthResponse,
  type ForgotPasswordInput,
  type LoginInput,
  loginResponseSchema,
  type LoginResponse,
  type ResendVerifyInput,
  type ResetPasswordInput,
  type SignupInput,
  type VerifyEmailInput,
  messageResponseSchema,
  type MessageResponse,
  publicUserSchema,
  type PublicUser,
} from '@jdm/shared/auth';

import { authedRequest, request } from './client';

export const signupRequest = (input: SignupInput): Promise<AuthResponse> =>
  request('/auth/signup', authResponseSchema, { method: 'POST', body: input });

export const loginRequest = (input: LoginInput): Promise<LoginResponse> =>
  request('/auth/login', loginResponseSchema, { method: 'POST', body: input });

export const refreshRequest = (refreshToken: string): Promise<AuthResponse> =>
  request('/auth/refresh', authResponseSchema, { method: 'POST', body: { refreshToken } });

export const logoutRequest = (refreshToken: string): Promise<MessageResponse> =>
  request('/auth/logout', messageResponseSchema, { method: 'POST', body: { refreshToken } });

export const resendVerifyRequest = (input: ResendVerifyInput): Promise<MessageResponse> =>
  request('/auth/resend-verify', messageResponseSchema, { method: 'POST', body: input });

export const verifyEmailRequest = (input: VerifyEmailInput): Promise<MessageResponse> =>
  request(`/auth/verify?token=${encodeURIComponent(input.token)}`, messageResponseSchema);

export const forgotPasswordRequest = (input: ForgotPasswordInput): Promise<MessageResponse> =>
  request('/auth/forgot-password', messageResponseSchema, { method: 'POST', body: input });

export const resetPasswordRequest = (input: ResetPasswordInput): Promise<MessageResponse> =>
  request('/auth/reset-password', messageResponseSchema, { method: 'POST', body: input });

export const googleSignInRequest = (idToken: string): Promise<AuthResponse> =>
  request('/auth/google', authResponseSchema, { method: 'POST', body: { idToken } });

export const appleSignInRequest = (
  idToken: string,
  fullName?: { givenName?: string | null; familyName?: string | null },
): Promise<AuthResponse> =>
  request('/auth/apple', authResponseSchema, {
    method: 'POST',
    body: { idToken, fullName },
  });

export const verifyEmailChangeRequest = (token: string): Promise<MessageResponse> =>
  request('/me/email-change/verify', messageResponseSchema, { method: 'POST', body: { token } });

export const meRequest = (token: string): Promise<PublicUser> =>
  request('/me', publicUserSchema, { token });

export const meAuthed = (): Promise<PublicUser> => authedRequest('/me', publicUserSchema);
