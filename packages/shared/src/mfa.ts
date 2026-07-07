import { z } from 'zod';

export const mfaSetupResponseSchema = z.object({
  otpauthUri: z.string(),
  recoveryCodes: z.array(z.string()),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

export const mfaVerifySetupSchema = z.object({
  code: z.string().length(6).regex(/^\d+$/, 'code must be 6 digits'),
});
export type MfaVerifySetupInput = z.infer<typeof mfaVerifySetupSchema>;

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().length(6).regex(/^\d+$/, 'code must be 6 digits'),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaRecoverySchema = z.object({
  mfaToken: z.string().min(1),
  code: z
    .string()
    .regex(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/, 'invalid recovery code format'),
});
export type MfaRecoveryInput = z.infer<typeof mfaRecoverySchema>;

export const mfaDisableSchema = z.object({
  code: z.string().min(1),
});
export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;

export const mfaStatusSchema = z.object({
  enabled: z.boolean(),
  recoveryCodes: z.number().int().nonnegative().optional(),
});
export type MfaStatus = z.infer<typeof mfaStatusSchema>;
