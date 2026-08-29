import { describe, expect, it, vi } from 'vitest';

// ../client imports react-native directly (for the x-ccc-platform header)
// and expo-constants, which also transitively pulls in react-native. Its
// Flow-flavored `import typeof` syntax vitest's SSR transform cannot parse.
// Mock both before importing, same as api/__tests__/account-disabled.test.ts.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { ApiError } = await import('../client');
const { getValidationFieldErrors } = await import('../errors');

describe('getValidationFieldErrors', () => {
  it('extracts fieldErrors from a 400 ValidationError body', () => {
    const err = new ApiError(400, 'request failed', {
      error: 'ValidationError',
      issues: { formErrors: [], fieldErrors: { cpf: ['CPF inválido'] } },
    });
    expect(getValidationFieldErrors(err)).toEqual({ cpf: ['CPF inválido'] });
  });

  it('returns null for a non-400 ApiError', () => {
    const err = new ApiError(409, 'request failed', {
      error: 'Conflict',
      message: 'email already registered',
    });
    expect(getValidationFieldErrors(err)).toBeNull();
  });

  it('returns null when the error is not an ApiError', () => {
    expect(getValidationFieldErrors(new Error('boom'))).toBeNull();
  });

  it('returns null when the body has no issues', () => {
    const err = new ApiError(400, 'request failed', { error: 'ValidationError' });
    expect(getValidationFieldErrors(err)).toBeNull();
  });

  it('returns null when body is not an object', () => {
    const err = new ApiError(400, 'request failed', null);
    expect(getValidationFieldErrors(err)).toBeNull();
  });
});
