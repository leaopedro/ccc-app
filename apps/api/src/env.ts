import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  SENTRY_DSN: z.string().optional(),
  GIT_SHA: z.string().optional(),
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  JWT_ACCESS_SECRET: z.string().min(32),
  REFRESH_TOKEN_PEPPER: z.string().min(32),
  APP_WEB_BASE_URL: z.string().url(),
  MAIL_FROM: z.string().email(),
  RESEND_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().min(32),
  STRIPE_WEBHOOK_SECRET: z.string().min(32),
  TICKET_CODE_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/i),
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_PRICE_PREMIUM_GOLD_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PREMIUM_GOLD_ANNUAL: z.string().optional(),
  ABACATEPAY_API_KEY: z.string().min(1).optional(),
  ABACATEPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  ABACATEPAY_DEV_WEBHOOK_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  PUSH_PROVIDER: z.enum(['auto', 'dev', 'expo']).default('auto'),
  WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  BROADCAST_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  BROADCAST_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  RETENTION_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DEV_FEE_PERCENT: z.coerce.number().int().min(0).max(100).default(10),
  DELETION_GRACE_DAYS: z.coerce.number().int().min(0).default(30),
  // Default true — Railway override controls the effective value at runtime.
  // IMPORTANT: keep GROWTH_PREMIUM_BILLING_ENABLED=false in Railway Variables
  // until F8.19 smoke passes. Remove (or flip to true) only after all 10 smoke
  // steps pass and evidence is attached to the F8.19 Paperclip issue.
  // This code default is the FALLBACK for new deploys after the flag goes live.
  GROWTH_PREMIUM_BILLING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  STRIPE_BILLING_WEBHOOK_SECRET: z.string().min(1).optional(),
  REVENUECAT_WEBHOOK_AUTH_HEADER: z.string().min(1).optional(),
  REVENUECAT_REST_API_KEY: z.string().min(1).optional(),
  RECONCILE_ALERT_DEPTH: z.coerce.number().int().positive().default(200),
});

type RawEnv = z.infer<typeof envSchema>;

export type Env = Omit<RawEnv, 'GIT_SHA' | 'RAILWAY_GIT_COMMIT_SHA'> & {
  GIT_SHA: string;
};

const resolveGitSha = (env: RawEnv): string => {
  if (env.GIT_SHA && env.GIT_SHA.length > 0) return env.GIT_SHA;
  if (env.RAILWAY_GIT_COMMIT_SHA && env.RAILWAY_GIT_COMMIT_SHA.length > 0) {
    return env.RAILWAY_GIT_COMMIT_SHA;
  }
  return 'dev';
};

const normalizeEnv = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const normalized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === '') continue;
    normalized[key] = value;
  }
  return normalized;
};

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = envSchema.safeParse(normalizeEnv(source));
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(flat)}`);
  }
  const { RAILWAY_GIT_COMMIT_SHA: _railwaySha, ...rest } = parsed.data;
  void _railwaySha;
  return { ...rest, GIT_SHA: resolveGitSha(parsed.data) };
};
