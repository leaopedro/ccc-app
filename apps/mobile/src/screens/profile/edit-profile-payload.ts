// Pure payload builder for the profile edit screen's PATCH /me submit.
// Mirrors buildSignupPayload in ~/auth/signup-submit.ts: the form keeps
// masked display strings for cpf/phone, but cpfSchema/phoneSchema only skip
// validation for `undefined` (an empty string still runs the checksum
// check and fails, 400ing the whole PATCH), so a blank optional field must
// become `undefined`, never `''`.
import type { UpdateProfileInput } from '@ccc/shared/profile';

import { unmaskCpf, unmaskPhone } from '~/lib/masks';

// Same shape as UpdateProfileInput: cpf/phone hold the masked display
// string here rather than validated digits, but that's a runtime-only
// distinction (both are plain strings to the type system).
export type EditProfileFormValues = UpdateProfileInput;

export const buildUpdateProfilePayload = (
  values: EditProfileFormValues,
  cpfLocked: boolean,
): UpdateProfileInput => {
  const phoneDigits = unmaskPhone(values.phone ?? '');
  const payload: UpdateProfileInput = {
    ...values,
    phone: phoneDigits.length > 0 ? phoneDigits : undefined,
  };

  // A locked CPF is never submitted, whether or not the field still holds a
  // (disabled, display-only) masked value.
  if (cpfLocked) {
    delete payload.cpf;
  } else {
    const cpfDigits = unmaskCpf(values.cpf ?? '');
    payload.cpf = cpfDigits.length > 0 ? cpfDigits : undefined;
  }

  return payload;
};
