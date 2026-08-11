// Pure orchestration for the signup form's submit, pulled out of the
// component so the highest-risk behaviors (digits-not-mask, which field a
// 400 lands on, the document upload never blocking the account) are
// testable without mounting the screen.
import type { PublicUser, SignupInput, SignupRequestInput } from '@ccc/shared/auth';
import type { UserDocumentType } from '@ccc/shared/documents';

import { ApiError } from '~/api/client';
import { getValidationFieldErrors } from '~/api/errors';
import { authCopy } from '~/copy/auth';
import { unmaskCpf, unmaskPhone } from '~/lib/masks';
import type { PickedImage } from '~/lib/upload-image';

export type PickedSignupDocument = { type: UserDocumentType; picked: PickedImage };

type SignupFieldErrorField = 'email' | 'password' | 'cpf' | 'phone';

// Converts masked form display values into the payload signup() expects:
// digits only, and a blank field stays `undefined` rather than becoming an
// empty string. cpfSchema/phoneSchema's `.optional()` only skips validation
// for `undefined` — an empty string is still run through the checksum check
// and fails it, which would turn an abandoned optional field into a blocked
// signup.
// `ageAttestation` is hardcoded true because the screen already gated on the
// 18+ checkbox before calling submitSignup — signupRequestSchema types it as
// z.literal(true), so there is no false to forward.
export const buildSignupPayload = (values: SignupInput): SignupRequestInput => {
  const cpfDigits = unmaskCpf(values.cpf ?? '');
  const phoneDigits = unmaskPhone(values.phone ?? '');
  return {
    ...values,
    ageAttestation: true,
    cpf: cpfDigits.length > 0 ? cpfDigits : undefined,
    phone: phoneDigits.length > 0 ? phoneDigits : undefined,
  };
};

export type SignupOutcome =
  | { kind: 'signed_up'; documentUploadFailed: boolean }
  | { kind: 'error'; field: SignupFieldErrorField; message: string };

const mapSignupError = (err: unknown): SignupOutcome => {
  if (err instanceof ApiError && err.status === 409) {
    return { kind: 'error', field: 'email', message: authCopy.errors.emailExists };
  }
  if (err instanceof ApiError && err.status === 400) {
    const fieldErrors = getValidationFieldErrors(err);
    if (fieldErrors?.cpf) {
      return {
        kind: 'error',
        field: 'cpf',
        message: fieldErrors.cpf[0] ?? authCopy.errors.invalidCpf,
      };
    }
    if (fieldErrors?.phone) {
      return {
        kind: 'error',
        field: 'phone',
        message: fieldErrors.phone[0] ?? authCopy.errors.invalidPhone,
      };
    }
    return { kind: 'error', field: 'password', message: authCopy.errors.weakPassword };
  }
  if (err instanceof ApiError && err.status === 422) {
    return { kind: 'error', field: 'password', message: authCopy.errors.weakPassword };
  }
  if (err instanceof ApiError && err.status === 429) {
    return { kind: 'error', field: 'password', message: authCopy.errors.rateLimited };
  }
  if (err instanceof ApiError) {
    return { kind: 'error', field: 'password', message: authCopy.errors.unknown };
  }
  return { kind: 'error', field: 'password', message: authCopy.errors.network };
};

export type SubmitSignupDeps = {
  signup: (input: SignupRequestInput) => Promise<PublicUser>;
  uploadDocument: (type: UserDocumentType, picked: PickedImage) => Promise<unknown>;
};

// Orchestrates signup -> best-effort document upload. The account already
// exists once signup() resolves, so a failed upload here is reported via
// `documentUploadFailed`, never turned into an `error` outcome: the caller
// always proceeds to the verify-email step regardless, and the subscription
// flow asks for the document again later.
export const submitSignup = async (
  values: SignupInput,
  pickedDocument: PickedSignupDocument | null,
  deps: SubmitSignupDeps,
): Promise<SignupOutcome> => {
  try {
    await deps.signup(buildSignupPayload(values));
  } catch (err) {
    return mapSignupError(err);
  }

  let documentUploadFailed = false;
  if (pickedDocument) {
    try {
      await deps.uploadDocument(pickedDocument.type, pickedDocument.picked);
    } catch {
      documentUploadFailed = true;
    }
  }
  return { kind: 'signed_up', documentUploadFailed };
};
