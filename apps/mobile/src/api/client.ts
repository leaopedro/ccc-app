import { ACCOUNT_DISABLED_ERROR } from '@jdm/shared/auth';
import Constants from 'expo-constants';
import type { z } from 'zod';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
const DEFAULT_BASE = 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
};

export const baseUrl = (): string => extra.apiBaseUrl ?? DEFAULT_BASE;

export const request = async <T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const init: RequestInit = { method: options.method ?? 'GET', headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;
  const response = await fetch(`${baseUrl()}${path}`, init);
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`, parsed);
  }
  return schema.parse(parsed);
};

type TokenProvider = {
  getAccessToken: () => string | null;
  refresh: () => Promise<string>;
  onSignOut: () => Promise<void>;
  onAccountDisabled?: () => Promise<void>;
};

let provider: TokenProvider | null = null;
let refreshInflight: Promise<string> | null = null;

export const registerTokenProvider = (p: TokenProvider): void => {
  provider = p;
};

const dedupedRefresh = (): Promise<string> => {
  if (!provider) throw new Error('token provider not registered');
  if (!refreshInflight) {
    refreshInflight = provider.refresh().finally(() => {
      refreshInflight = null;
    });
  }
  return refreshInflight;
};

export const authedRequest = async <T>(
  path: string,
  schema: z.ZodType<T>,
  options: Omit<RequestOptions, 'token'> = {},
): Promise<T> => {
  if (!provider) throw new Error('token provider not registered');
  const attempt = async (token: string): Promise<Response> => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const init: RequestInit = { method: options.method ?? 'GET', headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    if (options.signal) init.signal = options.signal;
    return fetch(`${baseUrl()}${path}`, init);
  };

  const current = provider.getAccessToken();
  if (!current) throw new ApiError(401, 'no access token');

  let response = await attempt(current);
  if (response.status === 401) {
    const cloned = response.clone();
    let errorBody: unknown = null;
    try {
      const errText = await cloned.text();
      errorBody = errText.length > 0 ? JSON.parse(errText) : null;
    } catch {
      errorBody = null;
    }
    if (
      typeof errorBody === 'object' &&
      errorBody !== null &&
      (errorBody as { error?: unknown }).error === ACCOUNT_DISABLED_ERROR
    ) {
      if (provider.onAccountDisabled) await provider.onAccountDisabled();
      else await provider.onSignOut();
      throw new ApiError(401, 'account disabled', errorBody);
    }
    try {
      const refreshed = await dedupedRefresh();
      response = await attempt(refreshed);
    } catch {
      await provider.onSignOut();
      throw new ApiError(401, 'session expired');
    }
  }
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, 'request failed', parsed);
  return schema.parse(parsed);
};
