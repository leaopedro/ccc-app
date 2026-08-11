// Client-side resolver schema for the "Editar dados" profile form. Paired
// with edit-profile-payload.ts, which turns the validated values into the
// PATCH /me payload (masked -> digits, cpf lock, phone-clearing guard).
//
// Diverges from updateProfileSchema (the server contract, see
// packages/shared/src/profile.ts, which this does not and must not edit)
// in ways specific to an edit form pre-filled from a partial profile, not a
// fresh signup:
//
// - city/stateCode are blankable, normalizing '' (or unset) to `undefined`.
//   `.partial()` on the server only makes the *key* optional, not the
//   value: `city: z.string().trim().min(1)` still rejects `''`. Signup
//   collects only email/password/name/cpf/phone, so every fresh account has
//   `city === null`; without this, the resolver would reject a blank
//   Cidade field and block the whole form, cpf/phone included.
// - cpf/phone reuse the shared cpfSchema/phoneSchema so an invalid value
//   surfaces their existing PT-BR messages ('CPF inválido' /
//   'Telefone inválido') as a field error, instead of passing the resolver
//   and only failing later inside updateProfile() as an uncaught ZodError
//   with no field context (see api/profile.ts). Blank stays acceptable, for
//   the same reason as city/stateCode.
// - name keeps the server's required-and-non-blank rule, but with a PT-BR
//   message: Zod's default ("String must contain at least 1 character(s)")
//   is English and would leak straight into a PT-BR screen.
// - bio is untouched (still a plain optional trimmed string): the server
//   accepts '' for it, and clearing it is a legitimate action, not a
//   blank-field edge case like city/stateCode/cpf/phone.
import { zodResolver } from '@hookform/resolvers/zod';
import {
  cpfSchema,
  phoneSchema,
  stateCodeSchema,
  type UpdateProfileInput,
} from '@ccc/shared/profile';
import type { Resolver } from 'react-hook-form';
import { z } from 'zod';

import { profileCopy } from '~/copy/profile';

const blankToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

// Validates a blankable string field against `schema` only when non-blank,
// reusing `schema`'s own issue message verbatim so the PT-BR copy has one
// source of truth (packages/shared/src/profile.ts) instead of a second
// hardcoded string here.
const blankableChecked = (schema: z.ZodTypeAny) =>
  z
    .string()
    .optional()
    .transform(blankToUndefined)
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      const result = schema.safeParse(value);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: result.error.issues[0]?.message ?? 'Valor inválido.',
        });
      }
    });

const stateCodeField = z
  .string()
  .optional()
  .transform(blankToUndefined)
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    if (!stateCodeSchema.safeParse(value).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Estado inválido.' });
    }
  })
  // Safe: the superRefine above already rejects anything that isn't
  // `undefined` or a valid state code before this ever runs.
  .transform((value) => value as UpdateProfileInput['stateCode']);

// Input type stays `string | undefined` (via `.optional()`) to match
// UpdateProfileInput['name'], even though the form always supplies a
// string in practice: react-hook-form's resolver typing is checked against
// the schema's pre-transform input type, and useForm<UpdateProfileInput>
// makes every field optional there. The min-length/PT-BR-message
// enforcement happens after normalizing `undefined` to `''`.
const nameField = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim())
  .pipe(z.string().min(1, profileCopy.profile.nameRequired).max(100));

export const editProfileFormSchema = z.object({
  name: nameField,
  bio: z.string().trim().max(500).optional(),
  city: z.string().optional().transform(blankToUndefined),
  stateCode: stateCodeField,
  cpf: blankableChecked(cpfSchema),
  phone: blankableChecked(phoneSchema),
  avatarObjectKey: z.string().min(1).max(300).nullable().optional(),
});

// react-hook-form's Resolver<T> checks TFieldValues against the schema in a
// position that requires an exact structural match, not just assignability
// (ResolverOptions<T> uses T in more than one variance position). This
// form's schema is deliberately looser at the type level than
// UpdateProfileInput -- stateCode widens to a raw string before narrowing
// via `.transform`, name is optional-at-the-input-type so a schema that
// enforces "required" can still be called with useForm<UpdateProfileInput>
// (every field optional there) -- so the resolver needs a cast to line up
// with what useForm<UpdateProfileInput> declares. The cast only changes
// what TypeScript believes; edit-profile-form-schema.test.ts exercises the
// real (uncast) schema and messages directly via `.safeParse`.
export const editProfileFormResolver = zodResolver(
  editProfileFormSchema,
) as unknown as Resolver<UpdateProfileInput>;
