import { ApiError } from './client';

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) {
    return fallback;
  }

  const body = error.body;
  if (typeof body !== 'object' || body === null) {
    return fallback;
  }

  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export function getApiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}
