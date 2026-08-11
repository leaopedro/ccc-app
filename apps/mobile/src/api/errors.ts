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

// Per-field messages from a 400 ValidationError, shaped by ZodError.flatten()
// in apps/api/src/plugins/error-handler.ts: `{ error, issues: { fieldErrors,
// formErrors } }`. Returns null when the error is not a 400 ValidationError,
// or has no field-level issues at all.
export function getValidationFieldErrors(error: unknown): Record<string, string[]> | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  const body = error.body;
  if (typeof body !== 'object' || body === null) return null;
  const issues = (body as { issues?: unknown }).issues;
  if (typeof issues !== 'object' || issues === null) return null;
  const fieldErrors = (issues as { fieldErrors?: unknown }).fieldErrors;
  if (typeof fieldErrors !== 'object' || fieldErrors === null) return null;
  return fieldErrors as Record<string, string[]>;
}
