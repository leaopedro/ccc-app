import { z } from 'zod';

import { USER_DOCUMENT_STATUSES, USER_DOCUMENT_TYPES } from './documents.js';

// The two gates. `checkout` covers one-off purchases (tickets, day-use,
// store); `subscription` covers recurring membership.
export const PROFILE_SCOPES = ['checkout', 'subscription'] as const;
export const profileScopeSchema = z.enum(PROFILE_SCOPES);
export type ProfileScope = z.infer<typeof profileScopeSchema>;

// Order is part of the contract: clients render the completion form in this
// sequence. Do not sort at the call site.
export const MISSING_FIELD_KEYS = ['cpf', 'phone', 'document'] as const;
export const missingFieldKeySchema = z.enum(MISSING_FIELD_KEYS);
export type MissingFieldKey = z.infer<typeof missingFieldKeySchema>;

export const INCOMPLETE_PROFILE_CODE = 'INCOMPLETE_PROFILE' as const;
export const INCOMPLETE_PROFILE_STATUS = 'incomplete_profile' as const;
export const INCOMPLETE_PROFILE_MESSAGE = 'Complete seu cadastro para continuar.';

// `status` satisfies the product contract; `code` is what the mobile
// getApiErrorCode helper already reads off every other coded error in this
// API. Both ship so neither side needs a second parsing path.
export const incompleteProfileErrorSchema = z.object({
  error: z.literal('Forbidden'),
  status: z.literal(INCOMPLETE_PROFILE_STATUS),
  code: z.literal(INCOMPLETE_PROFILE_CODE),
  missing: z.array(missingFieldKeySchema).min(1),
  message: z.string().min(1),
});
export type IncompleteProfileError = z.infer<typeof incompleteProfileErrorSchema>;

export const buildIncompleteProfileError = (
  missing: readonly MissingFieldKey[],
): IncompleteProfileError => ({
  error: 'Forbidden',
  status: INCOMPLETE_PROFILE_STATUS,
  code: INCOMPLETE_PROFILE_CODE,
  missing: [...missing],
  message: INCOMPLETE_PROFILE_MESSAGE,
});

// CPF is a fiscal identifier tied to orders already issued, and it is
// encrypted at rest, so a silent overwrite is unrecoverable. Once a member
// has one on file, PATCH /me refuses to change it. 409 because this is a
// conflict with existing state, not a malformed request.
export const CPF_IMMUTABLE_CODE = 'CPF_IMMUTABLE' as const;
export const CPF_IMMUTABLE_STATUS = 'cpf_immutable' as const;
export const CPF_IMMUTABLE_MESSAGE =
  'Seu CPF já está cadastrado e não pode ser alterado. Fale com o suporte se precisar corrigi-lo.';

export const cpfImmutableErrorSchema = z.object({
  error: z.literal('Conflict'),
  status: z.literal(CPF_IMMUTABLE_STATUS),
  code: z.literal(CPF_IMMUTABLE_CODE),
  message: z.string().min(1),
});
export type CpfImmutableError = z.infer<typeof cpfImmutableErrorSchema>;

export const buildCpfImmutableError = (): CpfImmutableError => ({
  error: 'Conflict',
  status: CPF_IMMUTABLE_STATUS,
  code: CPF_IMMUTABLE_CODE,
  message: CPF_IMMUTABLE_MESSAGE,
});

const scopeStatusSchema = z.object({
  complete: z.boolean(),
  missing: z.array(missingFieldKeySchema),
});

export const profileStatusSchema = z.object({
  fields: z.object({
    cpf: z.boolean(),
    phone: z.boolean(),
    document: z.boolean(),
  }),
  checkout: scopeStatusSchema,
  subscription: scopeStatusSchema,
  latestDocument: z
    .object({
      id: z.string().min(1),
      type: z.enum(USER_DOCUMENT_TYPES),
      status: z.enum(USER_DOCUMENT_STATUSES),
      sentAt: z.string().datetime(),
      reviewedAt: z.string().datetime().nullable(),
      rejectionReason: z.string().nullable(),
    })
    .nullable(),
});
export type ProfileStatus = z.infer<typeof profileStatusSchema>;
