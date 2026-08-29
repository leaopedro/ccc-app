import { describe, expect, it, vi } from 'vitest';

import type { SignupInput } from '@ccc/shared/auth';
import type { PickedImage } from '~/lib/upload-image';

import { authCopy } from '~/copy/auth';

// ~/api/client imports react-native directly (for the x-ccc-platform header)
// and reads expo-constants at module load, which also pulls in react-native.
// Its Flow-flavored `import typeof` syntax vitest's SSR transform cannot
// parse. Mock both before importing, same as api/__tests__/errors.test.ts.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { ApiError } = await import('~/api/client');
const { buildSignupPayload, submitSignup } = await import('./signup-submit');

const baseValues: SignupInput = {
  name: 'Piloto',
  email: 'piloto@example.com',
  password: 'senhaforte123',
};

const picked: PickedImage = {
  uri: 'file:///tmp/doc.jpg',
  mime: 'image/jpeg',
  size: 500,
  width: 800,
  height: 600,
};

describe('buildSignupPayload', () => {
  it('submits digits, not the display mask', () => {
    const payload = buildSignupPayload({
      ...baseValues,
      cpf: '529.982.247-25',
      phone: '(11) 98765-4321',
    });
    expect(payload.cpf).toBe('52998224725');
    expect(payload.phone).toBe('11987654321');
  });

  it('turns a blank optional field into undefined, not an empty string', () => {
    const payload = buildSignupPayload({ ...baseValues, cpf: '', phone: '' });
    expect(payload.cpf).toBeUndefined();
    expect(payload.phone).toBeUndefined();
  });

  it('passes through when cpf/phone are already absent', () => {
    const payload = buildSignupPayload({ ...baseValues });
    expect(payload.cpf).toBeUndefined();
    expect(payload.phone).toBeUndefined();
  });
});

describe('submitSignup', () => {
  it('routes a 400 on cpf to the cpf field', async () => {
    const signup = vi.fn().mockRejectedValue(
      new ApiError(400, 'request failed', {
        error: 'ValidationError',
        issues: { formErrors: [], fieldErrors: { cpf: ['CPF inválido'] } },
      }),
    );
    const uploadDocument = vi.fn();

    const outcome = await submitSignup(baseValues, null, { signup, uploadDocument });

    expect(outcome).toEqual({ kind: 'error', field: 'cpf', message: 'CPF inválido' });
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('falls back to the copy message when the server sends no cpf detail', async () => {
    const signup = vi.fn().mockRejectedValue(
      new ApiError(400, 'request failed', {
        error: 'ValidationError',
        issues: { formErrors: [], fieldErrors: { cpf: [] } },
      }),
    );

    const outcome = await submitSignup(baseValues, null, { signup, uploadDocument: vi.fn() });

    expect(outcome).toEqual({
      kind: 'error',
      field: 'cpf',
      message: authCopy.errors.invalidCpf,
    });
  });

  it('routes a 400 on phone to the phone field', async () => {
    const signup = vi.fn().mockRejectedValue(
      new ApiError(400, 'request failed', {
        error: 'ValidationError',
        issues: { formErrors: [], fieldErrors: { phone: ['Telefone inválido'] } },
      }),
    );

    const outcome = await submitSignup(baseValues, null, { signup, uploadDocument: vi.fn() });

    expect(outcome).toEqual({ kind: 'error', field: 'phone', message: 'Telefone inválido' });
  });

  it('routes a 409 to the email field', async () => {
    const signup = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'request failed', { error: 'Conflict', message: 'exists' }),
      );

    const outcome = await submitSignup(baseValues, null, { signup, uploadDocument: vi.fn() });

    expect(outcome).toEqual({
      kind: 'error',
      field: 'email',
      message: authCopy.errors.emailExists,
    });
  });

  it('does not attempt a document upload when signup itself fails', async () => {
    const signup = vi.fn().mockRejectedValue(new Error('network down'));
    const uploadDocument = vi.fn();

    await submitSignup(baseValues, { type: 'cnh', picked }, { signup, uploadDocument });

    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('signs up successfully with no picked document', async () => {
    const signup = vi.fn().mockResolvedValue({ id: 'u1' });
    const uploadDocument = vi.fn();

    const outcome = await submitSignup(baseValues, null, { signup, uploadDocument });

    expect(outcome).toEqual({ kind: 'signed_up', documentUploadFailed: false });
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('reports a failed document upload without failing the signup', async () => {
    const signup = vi.fn().mockResolvedValue({ id: 'u1' });
    const uploadDocument = vi.fn().mockRejectedValue(new Error('upload failed'));

    const outcome = await submitSignup(
      baseValues,
      { type: 'cnh', picked },
      { signup, uploadDocument },
    );

    // The account exists at this point: a failed upload must never turn
    // into an `error` outcome, which is what would abandon the user on the
    // signup form instead of moving them on to verify-email.
    expect(outcome).toEqual({ kind: 'signed_up', documentUploadFailed: true });
    expect(uploadDocument).toHaveBeenCalledWith('cnh', picked);
  });

  it('uploads the picked document on success and reports no failure', async () => {
    const signup = vi.fn().mockResolvedValue({ id: 'u1' });
    const uploadDocument = vi.fn().mockResolvedValue({ id: 'doc1', status: 'pending' });

    const outcome = await submitSignup(
      baseValues,
      { type: 'rg', picked },
      { signup, uploadDocument },
    );

    expect(outcome).toEqual({ kind: 'signed_up', documentUploadFailed: false });
    expect(uploadDocument).toHaveBeenCalledWith('rg', picked);
  });
});
