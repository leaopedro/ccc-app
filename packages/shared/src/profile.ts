import { z } from 'zod';

export const BRAZIL_STATE_CODES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
export const stateCodeSchema = z.enum(BRAZIL_STATE_CODES);

const CPF_DIGITS_RE = /^\d{11}$/;
const CPF_REPEATED_RE = /^(\d)\1{10}$/;

// Modulo-11 check digits, the standard Receita Federal algorithm. The
// repeated-digit guard is not redundant: sequences like 111.111.111-11
// satisfy the arithmetic and would otherwise pass.
const isValidCpf = (digits: string): boolean => {
  if (!CPF_DIGITS_RE.test(digits)) return false;
  if (CPF_REPEATED_RE.test(digits)) return false;
  const nums = digits.split('').map(Number);
  const rounds: ReadonlyArray<readonly [number, number]> = [
    [9, 10],
    [10, 11],
  ];
  for (const [len, startWeight] of rounds) {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += nums[i]! * (startWeight - i);
    const expected = ((sum * 10) % 11) % 10;
    if (expected !== nums[len]) return false;
  }
  return true;
};

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

// Both schemas accept masked input from the client and normalize to digits.
// Digits are what the DB stores, so every read path sees one shape.
export const cpfSchema = z
  .string()
  .transform(digitsOnly)
  .refine(isValidCpf, { message: 'CPF inválido' });

// Brazilian DDD + subscriber number: 10 digits (landline) or 11 (mobile).
// No DDD starts with 0.
export const phoneSchema = z
  .string()
  .transform(digitsOnly)
  .refine((v) => /^[1-9]{2}\d{8,9}$/.test(v), { message: 'Telefone inválido' });

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    bio: z.string().trim().max(500),
    city: z.string().trim().min(1).max(100),
    stateCode: stateCodeSchema,
    avatarObjectKey: z.string().min(1).max(300).nullable(),
    cpf: cpfSchema,
    phone: phoneSchema,
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// publicProfileSchema is the API response shape. `avatarUrl` is server-derived
// from User.avatarObjectKey via app.uploads.buildPublicUrl.
export const publicProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().max(254),
  name: z.string().min(1),
  role: z.enum(['user', 'organizer', 'admin', 'staff']),
  emailVerifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  bio: z.string().nullable(),
  city: z.string().nullable(),
  stateCode: stateCodeSchema.nullable(),
  avatarUrl: z.string().nullable(),
  cpf: z.string().nullable(),
  phone: z.string().nullable(),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;
