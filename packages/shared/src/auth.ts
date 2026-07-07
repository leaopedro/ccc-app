import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 10;

export const emailInputSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());

export const emailSchema = z.string().email().max(254);

export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(200);

export const userRoleSchema = z.enum(['user', 'organizer', 'admin', 'staff']);
export type UserRoleName = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(['partial', 'active', 'disabled', 'deleted', 'anonymized']);
export type UserStatusName = z.infer<typeof userStatusSchema>;

export const INACTIVE_USER_STATUSES = ['disabled', 'deleted', 'anonymized'] as const;

export const ACCOUNT_DISABLED_ERROR = 'AccountDisabled' as const;

export const publicUserSchema = z.object({
  id: z.string().min(1),
  email: emailSchema,
  name: z.string().min(1),
  role: userRoleSchema,
  emailVerifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const signupSchema = z.object({
  email: emailInputSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailInputSchema,
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = refreshSchema;
export type LogoutInput = RefreshInput;

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerifySchema = z.object({
  email: emailInputSchema,
});
export type ResendVerifyInput = z.infer<typeof resendVerifySchema>;

export const forgotPasswordSchema = z.object({
  email: emailInputSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const googleSignInSchema = z.object({
  idToken: z.string().min(10),
});
export type GoogleSignInInput = z.infer<typeof googleSignInSchema>;

export const appleSignInSchema = z.object({
  idToken: z.string().min(10),
  fullName: z
    .object({
      givenName: z.string().min(1).nullable().optional(),
      familyName: z.string().min(1).nullable().optional(),
    })
    .optional(),
});
export type AppleSignInInput = z.infer<typeof appleSignInSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: publicUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const mfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string().min(1),
});
export type MfaChallengeResponse = z.infer<typeof mfaChallengeResponseSchema>;

export const loginResponseSchema = z.union([authResponseSchema, mfaChallengeResponseSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const messageResponseSchema = z.object({
  message: z.string().min(1),
});
export type MessageResponse = z.infer<typeof messageResponseSchema>;
