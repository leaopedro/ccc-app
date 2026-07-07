# Phase 1 — F1 Auth & Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ## Progress-tracking rules (read before touching this file)
>
> **This file is a live log, not a frozen artifact.** You MUST update checkboxes as you work. If you finish execution without ticking what you did, future agents will re-do it.
>
> 1. **Tick each step `- [ ]` → `- [x]` the moment that step is done.** Not at the end of the task. Not at the end of the chunk. The moment it is done on disk.
> 2. **When a task's final commit lands on-branch, mark the whole task done** by prefixing its heading with `✅ ` (e.g. `## ✅ Task 1: Prisma schema …`). Leave the individual step checkboxes `[x]` — don't erase them; they are the evidence trail.
> 3. **If you skip or merge a step** (e.g. combine two commits, skip an install because a dep is already present), write a one-line `> note:` below the step explaining why, and still tick it.
> 4. **If you deviate from the planned approach** (different library, different file layout, different test shape), edit the step text in place to match what was actually done. Future agents read the plan to understand the code; a stale plan misleads them.
> 5. **Do not delete completed tasks.** They document _what_ landed and _how_. Chunk B depends on Chunk A's evidence.
> 6. **Roadmap sync:** when a task here maps to a `roadmap.md` item (e.g. F1 sub-task 1.1), DO NOT tick the roadmap box until the PR for that work is **merged to `main` and deployed**. Plan checkboxes reflect on-branch progress; roadmap checkboxes reflect shipped progress. They are not the same.
>
> **If a step's checkbox disagrees with the code, the code wins — fix the checkbox, not the code.**

**Goal:** A user can create an account (email+password, Google, or Apple), verify email, log in, stay logged in across app restarts, reset a forgotten password, and log out. JWT access + opaque refresh tokens with rotation. All `/auth/*` endpoints rate-limited. Mobile screens in PT-BR. Tokens stored in SecureStore; expired access tokens transparently refresh.

**Architecture:** Fastify routes under `apps/api/src/routes/auth/*.ts`, service modules under `apps/api/src/services/auth/*.ts`. Prisma models in `packages/db/prisma/schema.prisma`. Shared Zod in `packages/shared/src/auth.ts` — note `emailInputSchema` (trim + lowercase) for write paths vs `emailSchema` (plain) for response shapes. Mobile screens under `apps/mobile/app/(auth)/*.tsx` with an auth context (`apps/mobile/src/auth/context.tsx`) driving route guarding via `expo-router`. Access JWT is signed `HS256`, 15-minute TTL. Refresh tokens are opaque 32-byte random strings, HMAC-SHA256 with `REFRESH_TOKEN_PEPPER` at rest, 30-day TTL, single-use (rotate on refresh). Email via a `Mailer` interface — `DevMailer` in dev/test (captures to an in-memory array), `ResendMailer` in prod. Google/Apple ID tokens are verified against the provider JWKS using `jose`.

**Tech Stack additions (on top of Phase 0):**

- `bcrypt` 5.x (password hashing)
- `jsonwebtoken` 9.x (access token signing/verification)
- `@fastify/rate-limit` 10.x
- `jose` 5.x (JWKS verification for Google + Apple)
- `resend` 4.x (prod mail)
- Mobile: `expo-secure-store`, `expo-auth-session`, `expo-apple-authentication`, `expo-web-browser`, `expo-crypto`, `react-hook-form`, `@hookform/resolvers`

**Out of scope for F1 (parked for later features):**

- Profile fields beyond `name` (bio, city, state, avatar upload) — F2.
- Car/garage — F2.
- `/me/delete`, `/me/export` — X.2 (LGPD cross-cutting).
- Push device tokens — F6 (`POST /me/device-tokens` is only scaffolded after F1 lands a user).
- Full i18n extraction — X.1. Copy lives in `apps/mobile/src/copy/auth.ts` now, ready to migrate later.
- Admin-web auth — F7a. F1 ships the shared JWT mechanism; admin routes are not wired in this plan.

**Conventions this plan locks:**

- New envs on the API side are unprefixed (`JWT_ACCESS_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID`, `APP_WEB_BASE_URL`). Mobile public envs use `EXPO_PUBLIC_*` (client IDs for Google).
- Auth route path prefix is `/auth`. Routes register under a single `authRoutes` plugin that in turn registers one file per endpoint group.
- All route handlers validate input with Zod (`parse` — throw on mismatch; the existing `errorHandlerPlugin` already maps `ZodError` → 400).
- Responses follow `{ accessToken, refreshToken, user }` where relevant; `user` is the shared `publicUserSchema` shape (never exposes `passwordHash` or tokens).
- Timestamps always `DateTime` (Prisma) / ISO 8601 strings on the wire (Zod `z.coerce.date()` / `z.string().datetime()` as appropriate).

**Secret inventory (add to `docs/secrets.md` in Task 3):**

| Var                                    | Where  | Scope                                | Notes                                                                           |
| -------------------------------------- | ------ | ------------------------------------ | ------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`                    | API    | Railway prod + preview, `.env` local | 32+ bytes, random. Rotate → all access tokens invalidated instantly.            |
| `REFRESH_TOKEN_PEPPER`                 | API    | same                                 | Mixed into SHA-256 refresh-token hash. Rotating invalidates all refresh tokens. |
| `RESEND_API_KEY`                       | API    | Railway only (skip in tests)         | `re_*`. Loaded only when `NODE_ENV=production`.                                 |
| `MAIL_FROM`                            | API    | Railway + local                      | e.g. `noreply@jdmexperience.com.br`.                                            |
| `APP_WEB_BASE_URL`                     | API    | Railway + local                      | Used in verification + reset emails. Local: `http://localhost:3000` (admin).    |
| `GOOGLE_CLIENT_ID`                     | API    | Railway + local                      | Web client ID (audience for ID tokens from mobile + admin).                     |
| `APPLE_CLIENT_ID`                      | API    | Railway + local                      | Apple Service ID (audience) for mobile sign-in.                                 |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS`     | Mobile | EAS secrets                          | iOS OAuth client ID.                                                            |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID` | Mobile | EAS secrets                          | Android OAuth client ID.                                                        |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB`     | Mobile | EAS secrets                          | Web client ID (matches `GOOGLE_CLIENT_ID` on API).                              |

---

## Task ordering & dependency graph

```
Task 1  (schema + migration)
  └─ Task 2  (shared Zod auth schemas)
       ├─ Task 3  (env + secrets doc)
       │    └─ Task 4  (password hasher)
       │         └─ Task 5  (JWT + refresh token services)
       │              └─ Task 6  (mailer abstraction)
       │                   └─ Task 7  (authenticate decorator + GET /me)
       │                        ├─ Task 8  (POST /auth/signup)
       │                        │    └─ Task 9  (GET /auth/verify)
       │                        │         └─ Task 10 (POST /auth/resend-verify)
       │                        ├─ Task 11 (POST /auth/login)
       │                        │    └─ Task 12 (POST /auth/refresh)
       │                        │         └─ Task 13 (POST /auth/logout)
       │                        ├─ Task 14 (POST /auth/forgot-password)
       │                        │    └─ Task 15 (POST /auth/reset-password)
       │                        ├─ Task 16 (Google verifier + POST /auth/google)
       │                        ├─ Task 17 (Apple verifier + POST /auth/apple)
       │                        └─ Task 18 (rate limiting on /auth/*)
       └─ Task 19 (mobile SecureStore wrapper)
            └─ Task 20 (mobile auth client + typed API)
                 └─ Task 21 (mobile auth context + root guard)
                      ├─ Task 22 (mobile login screen)
                      ├─ Task 23 (mobile signup screen)
                      ├─ Task 24 (mobile verify-email-pending screen)
                      ├─ Task 25 (mobile forgot + reset screens)
                      ├─ Task 26 (mobile Google sign-in)
                      ├─ Task 27 (mobile Apple sign-in)
                      └─ Task 28 (mobile refresh interceptor + e2e happy path)
```

Each task ends with a Conventional Commit. Keep commits small — do not batch tasks.

---

## ✅ Task 1: Prisma schema — User fields, AuthProvider, RefreshToken, VerificationToken, PasswordResetToken (roadmap 1.1)

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_auth/migration.sql`

- [x] **Step 1: Rewrite `packages/db/prisma/schema.prisma` to the F1 target**

```prisma
// Auth lands in F1 (roadmap 1.1). Subsequent features extend these models.

generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  user
  organizer
  admin
}

enum AuthProviderKind {
  google
  apple
}

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  passwordHash    String?
  name            String
  role            UserRole  @default(user)
  emailVerifiedAt DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  authProviders       AuthProvider[]
  refreshTokens       RefreshToken[]
  verificationTokens  VerificationToken[]
  passwordResetTokens PasswordResetToken[]

  @@index([createdAt])
}

model AuthProvider {
  id             String           @id @default(cuid())
  userId         String
  provider       AuthProviderKind
  providerUserId String
  createdAt      DateTime         @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@index([userId])
}

model RefreshToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}

model VerificationToken {
  id         String    @id @default(cuid())
  userId     String
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model PasswordResetToken {
  id         String    @id @default(cuid())
  userId     String
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

- [x] **Step 2: Run the migration against local Postgres**

Run from repo root:

```bash
pnpm --filter @jdm/db exec prisma migrate dev --name auth
```

> note: original command was `pnpm --filter @jdm/db db:migrate -- --name auth`, but pnpm doesn't forward the trailing `--name auth` through the script. Use `exec prisma migrate dev` directly.

Expected: a new folder `packages/db/prisma/migrations/<timestamp>_auth/` with a `migration.sql` that drops the placeholder `User` columns we didn't have and creates the new tables + enums. Applied migration: `20260418110341_auth`.

An additional migration `20260418112703_authprovider_userid_unique` was added in review fixes to enforce `@@unique([userId, provider])` on `AuthProvider` (prevents one user linking two rows for the same provider).

- [x] **Step 3: Regenerate the Prisma client**

Run:

```bash
pnpm --filter @jdm/db db:generate
```

Expected: stdout ends with `Generated Prisma Client … to ./node_modules/@prisma/client`.

- [x] **Step 4: Extend `packages/db/src/index.ts` re-exports**

Replace the `export type` line with:

```typescript
export type {
  Prisma,
  User,
  AuthProvider,
  AuthProviderKind,
  RefreshToken,
  VerificationToken,
  PasswordResetToken,
  UserRole,
} from '@prisma/client';
```

- [x] **Step 5: Typecheck the workspace**

Run:

```bash
pnpm typecheck
```

Expected: all packages green (nothing consumes the new types yet, so this just confirms the re-exports compile).

- [x] **Step 6: Commit**

```bash
git add packages/db/prisma packages/db/src
git commit -m "feat(db): add auth models (user, authprovider, refresh/verification/reset tokens)"
```

---

## ✅ Task 2: Shared Zod auth schemas (roadmap 1.1)

**Files:**

- Modify: `packages/shared/src/auth.ts`
- Test: `packages/shared/test/auth.test.ts`
- Modify: `packages/shared/src/index.ts`

- [x] **Step 1: Write the failing test `packages/shared/test/auth.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';

import {
  appleSignInSchema,
  authResponseSchema,
  forgotPasswordSchema,
  googleSignInSchema,
  loginSchema,
  publicUserSchema,
  refreshSchema,
  resendVerifySchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
} from '../src/auth';

describe('auth schemas', () => {
  it('accepts a valid signup', () => {
    expect(() =>
      signupSchema.parse({
        email: 'alice@jdm.app',
        password: 'correct-horse-battery-staple',
        name: 'Alice',
      }),
    ).not.toThrow();
  });

  it('rejects short passwords', () => {
    expect(() => signupSchema.parse({ email: 'a@b.co', password: 'short', name: 'A' })).toThrow();
  });

  it('normalizes email to lower-case', () => {
    const parsed = signupSchema.parse({
      email: 'Alice@JDM.APP',
      password: 'correct-horse-battery-staple',
      name: 'Alice',
    });
    expect(parsed.email).toBe('alice@jdm.app');
  });

  it('accepts login + refresh + logout shapes', () => {
    expect(() => loginSchema.parse({ email: 'a@b.co', password: 'x'.repeat(10) })).not.toThrow();
    expect(() => refreshSchema.parse({ refreshToken: 't'.repeat(10) })).not.toThrow();
  });

  it('accepts verify + resend + forgot + reset shapes', () => {
    expect(() => verifyEmailSchema.parse({ token: 't'.repeat(10) })).not.toThrow();
    expect(() => resendVerifySchema.parse({ email: 'a@b.co' })).not.toThrow();
    expect(() => forgotPasswordSchema.parse({ email: 'a@b.co' })).not.toThrow();
    expect(() =>
      resetPasswordSchema.parse({ token: 't'.repeat(10), password: 'x'.repeat(10) }),
    ).not.toThrow();
  });

  it('accepts social sign-in shapes', () => {
    expect(() => googleSignInSchema.parse({ idToken: 'jwt-from-google' })).not.toThrow();
    expect(() => appleSignInSchema.parse({ idToken: 'jwt-from-apple' })).not.toThrow();
    expect(() =>
      appleSignInSchema.parse({
        idToken: 'jwt',
        fullName: { givenName: 'A', familyName: 'B' },
      }),
    ).not.toThrow();
  });

  it('publicUserSchema omits password hash', () => {
    const user = publicUserSchema.parse({
      id: 'clx',
      email: 'a@b.co',
      name: 'A',
      role: 'user',
      emailVerifiedAt: null,
      createdAt: new Date().toISOString(),
    });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('authResponseSchema composes tokens + user', () => {
    expect(() =>
      authResponseSchema.parse({
        accessToken: 'a.b.c',
        refreshToken: 'r'.repeat(30),
        user: {
          id: 'clx',
          email: 'a@b.co',
          name: 'A',
          role: 'user',
          emailVerifiedAt: null,
          createdAt: new Date().toISOString(),
        },
      }),
    ).not.toThrow();
  });
});
```

- [x] **Step 2: Run the test — expect failure**

```bash
pnpm --filter @jdm/shared test
```

Expected: fail with "has no exported member 'signupSchema'" (and siblings).

- [x] **Step 3: Replace `packages/shared/src/auth.ts`**

```typescript
import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 10;

export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());

export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(200);

export const userRoleSchema = z.enum(['user', 'organizer', 'admin']);
export type UserRoleName = z.infer<typeof userRoleSchema>;

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
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
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
  email: emailSchema,
});
export type ResendVerifyInput = z.infer<typeof resendVerifySchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
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

export const messageResponseSchema = z.object({
  message: z.string().min(1),
});
export type MessageResponse = z.infer<typeof messageResponseSchema>;
```

- [x] **Step 4: Re-run the test — expect pass**

```bash
pnpm --filter @jdm/shared test
```

Expected: 7 passed.

- [x] **Step 5: Lint + typecheck shared**

```bash
pnpm --filter @jdm/shared lint && pnpm --filter @jdm/shared typecheck
```

Expected: both green.

- [x] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add zod auth schemas (signup, login, refresh, verify, reset, social)"
```

---

## ✅ Task 3: Env + secrets inventory (cross-cutting prep)

**Files:**

- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/.env.example`
- Modify: `docs/secrets.md`

- [x] **Step 1: Extend `apps/api/src/env.ts`**

```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  SENTRY_DSN: z.string().optional(),
  GIT_SHA: z.string().default('dev'),
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
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(flat)}`);
  }
  return parsed.data;
};
```

- [x] **Step 2: Update `apps/api/.env.example`**

Append:

```
JWT_ACCESS_SECRET=change-me-to-a-random-32-plus-byte-string
REFRESH_TOKEN_PEPPER=change-me-to-a-different-random-32-plus-byte-string
APP_WEB_BASE_URL=http://localhost:3000
MAIL_FROM=noreply@jdmexperience.test
RESEND_API_KEY=
GOOGLE_CLIENT_ID=
APPLE_CLIENT_ID=
```

- [x] **Step 3: Extend `docs/secrets.md`**

Add a new section titled `## F1 — Auth` with the table from this plan's header (the secret inventory table above). Include a paragraph: "Generate `JWT_ACCESS_SECRET` and `REFRESH_TOKEN_PEPPER` with `openssl rand -base64 48`. Rotate them together when compromise is suspected; doing so logs every user out."

- [x] **Step 4: Update `apps/api/test/setup.ts` to inject the new test envs**

Add after `process.env.CORS_ORIGINS = '';`:

```typescript
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.REFRESH_TOKEN_PEPPER = 'b'.repeat(48);
process.env.APP_WEB_BASE_URL = 'http://localhost:3000';
process.env.MAIL_FROM = 'noreply@jdm.test';
```

- [x] **Step 5: Run API tests — still green**

```bash
pnpm --filter @jdm/api test
```

Expected: 2 passed (health.test.ts).

- [x] **Step 6: Commit**

```bash
git add apps/api/src/env.ts apps/api/.env.example apps/api/test/setup.ts docs/secrets.md
git commit -m "feat(api): extend env schema with auth secrets and mail config"
```

---

## ✅ Task 4: Password hasher service

**Files:**

- Create: `apps/api/src/services/auth/password.ts`
- Test: `apps/api/test/services/password.test.ts`
- Modify: `apps/api/package.json` (add `bcrypt`, `@types/bcrypt`)

- [x] **Step 1: Install deps**

```bash
pnpm --filter @jdm/api add bcrypt
pnpm --filter @jdm/api add -D @types/bcrypt
```

Expected: two installs; `apps/api/package.json` dependencies now include `bcrypt`.

- [x] **Step 2: Write failing test `apps/api/test/services/password.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../src/services/auth/password.js';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).not.toBe('correct-horse-battery-staple');
    expect(hash.startsWith('$2')).toBe(true);
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects wrong passwords', async () => {
    const hash = await hashPassword('aaaaaaaaaa');
    expect(await verifyPassword('bbbbbbbbbb', hash)).toBe(false);
  });
});
```

- [x] **Step 3: Run the test — expect failure**

```bash
pnpm --filter @jdm/api test -- services/password
```

Expected: fail with "Cannot find module '.../src/services/auth/password.js'".

- [x] **Step 4: Create `apps/api/src/services/auth/password.ts`**

```typescript
import bcrypt from 'bcrypt';

const ROUNDS = 12;

export const hashPassword = async (plain: string): Promise<string> => {
  return bcrypt.hash(plain, ROUNDS);
};

export const verifyPassword = async (plain: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plain, hash);
};
```

- [x] **Step 5: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test -- services/password
```

Expected: 2 passed.

- [x] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/services apps/api/test/services
git commit -m "feat(api): add bcrypt password hasher"
```

---

## ✅ Task 5: JWT + refresh token services

**Files:**

- Create: `apps/api/src/services/auth/tokens.ts`
- Test: `apps/api/test/services/tokens.test.ts`
- Modify: `apps/api/package.json` (add `jsonwebtoken` + types)

- [x] **Step 1: Install deps**

```bash
pnpm --filter @jdm/api add jsonwebtoken
pnpm --filter @jdm/api add -D @types/jsonwebtoken
```

- [x] **Step 2: Write failing test `apps/api/test/services/tokens.test.ts`**

```typescript
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createAccessToken,
  hashRefreshToken,
  issueRefreshToken,
  verifyAccessToken,
} from '../../src/services/auth/tokens.js';

const env = {
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  REFRESH_TOKEN_PEPPER: 'b'.repeat(48),
} as const;

describe('access tokens', () => {
  it('round-trips a payload', () => {
    const token = createAccessToken({ sub: 'u_1', role: 'user' }, env);
    const verified = verifyAccessToken(token, env);
    expect(verified.sub).toBe('u_1');
    expect(verified.role).toBe('user');
  });

  it('rejects a token signed with a different secret', () => {
    const token = createAccessToken({ sub: 'u_1', role: 'user' }, env);
    expect(() => verifyAccessToken(token, { ...env, JWT_ACCESS_SECRET: 'z'.repeat(48) })).toThrow();
  });
});

describe('refresh tokens', () => {
  it('issues a high-entropy opaque token', () => {
    const { token, hash, expiresAt } = issueRefreshToken(env);
    expect(token).toHaveLength(43);
    expect(hash).toHaveLength(64);
    const expected = createHmac('sha256', env.REFRESH_TOKEN_PEPPER).update(token).digest('hex');
    expect(hash).toBe(expected);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3_600_000);
  });

  it('hashes deterministically via the pepper', () => {
    const { token, hash } = issueRefreshToken(env);
    expect(hashRefreshToken(token, env)).toBe(hash);
  });
});
```

- [x] **Step 3: Run test — expect failure**

```bash
pnpm --filter @jdm/api test -- services/tokens
```

Expected: module-not-found failure.

- [x] **Step 4: Create `apps/api/src/services/auth/tokens.ts`**

```typescript
import { createHmac, randomBytes } from 'node:crypto';

import jwt from 'jsonwebtoken';

import type { UserRoleName } from '@jdm/shared/auth';

type TokenEnv = {
  readonly JWT_ACCESS_SECRET: string;
  readonly REFRESH_TOKEN_PEPPER: string;
};

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3_600_000;

export type AccessPayload = {
  sub: string;
  role: UserRoleName;
};

export const createAccessToken = (payload: AccessPayload, env: TokenEnv): string => {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL_SECONDS,
  });
};

export const verifyAccessToken = (token: string, env: TokenEnv): AccessPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('unexpected jwt payload');
  const { sub, role } = decoded as jwt.JwtPayload & AccessPayload;
  if (typeof sub !== 'string' || typeof role !== 'string') throw new Error('invalid jwt payload');
  return { sub, role };
};

export const hashRefreshToken = (token: string, env: TokenEnv): string => {
  return createHmac('sha256', env.REFRESH_TOKEN_PEPPER).update(token).digest('hex');
};

export const issueRefreshToken = (
  env: TokenEnv,
): { token: string; hash: string; expiresAt: Date } => {
  const token = randomBytes(32).toString('base64url');
  const hash = hashRefreshToken(token, env);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  return { token, hash, expiresAt };
};

export const accessTtlSeconds = ACCESS_TTL_SECONDS;
```

Note: Using `jsonwebtoken` directly (no `@fastify/jwt` wrapper) keeps the services unit-testable without a Fastify instance.

- [x] **Step 5: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test -- services/tokens
```

Expected: 4 passed.

- [x] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/services/auth/tokens.ts apps/api/test/services/tokens.test.ts
git commit -m "feat(api): add jwt access + opaque refresh token services"
```

---

## ✅ Task 6: Mailer abstraction (Dev + Resend)

**Files:**

- Create: `apps/api/src/services/mailer/types.ts`
- Create: `apps/api/src/services/mailer/dev.ts`
- Create: `apps/api/src/services/mailer/resend.ts`
- Create: `apps/api/src/services/mailer/index.ts`
- Test: `apps/api/test/services/mailer.test.ts`
- Modify: `apps/api/src/app.ts` (decorate `app.mailer`)
- Modify: `apps/api/package.json` (add `resend`)

- [x] **Step 1: Install deps**

```bash
pnpm --filter @jdm/api add resend
```

- [x] **Step 2: Write failing test `apps/api/test/services/mailer.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';

import { DevMailer } from '../../src/services/mailer/dev.js';

describe('DevMailer', () => {
  it('captures sent mail in memory', async () => {
    const mailer = new DevMailer();
    await mailer.send({ to: 'a@b.co', subject: 'Hi', html: '<p>hello</p>' });
    expect(mailer.captured).toHaveLength(1);
    expect(mailer.captured[0]).toMatchObject({ to: 'a@b.co', subject: 'Hi' });
  });

  it('can be reset', async () => {
    const mailer = new DevMailer();
    await mailer.send({ to: 'a@b.co', subject: 'x', html: 'y' });
    mailer.clear();
    expect(mailer.captured).toHaveLength(0);
  });

  it('find() returns the most recent match', async () => {
    const mailer = new DevMailer();
    await mailer.send({ to: 'a@b.co', subject: 'first', html: '' });
    await mailer.send({ to: 'a@b.co', subject: 'second', html: '' });
    expect(mailer.find('a@b.co')?.subject).toBe('second');
  });
});
```

- [x] **Step 3: Run — expect failure (module not found)**

```bash
pnpm --filter @jdm/api test -- services/mailer
```

- [x] **Step 4: Create `apps/api/src/services/mailer/types.ts`**

```typescript
export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
```

- [x] **Step 5: Create `apps/api/src/services/mailer/dev.ts`**

```typescript
import type { MailMessage, Mailer } from './types.js';

export class DevMailer implements Mailer {
  public readonly captured: MailMessage[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await
  async send(message: MailMessage): Promise<void> {
    this.captured.push(message);
    // eslint-disable-next-line no-console
    console.log(`[dev-mail] to=${message.to} subject=${message.subject}`);
  }

  clear(): void {
    this.captured.length = 0;
  }

  find(to: string): MailMessage | undefined {
    for (let i = this.captured.length - 1; i >= 0; i -= 1) {
      if (this.captured[i]?.to === to) return this.captured[i];
    }
    return undefined;
  }
}
```

- [x] **Step 6: Create `apps/api/src/services/mailer/resend.ts`**

```typescript
import { Resend } from 'resend';

import type { MailMessage, Mailer } from './types.js';

export class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) throw new Error(`resend send failed: ${error.message}`);
  }
}
```

- [x] **Step 7: Create `apps/api/src/services/mailer/index.ts`**

```typescript
import type { Env } from '../../env.js';
import { DevMailer } from './dev.js';
import { ResendMailer } from './resend.js';
import type { Mailer } from './types.js';

export type { Mailer, MailMessage } from './types.js';
export { DevMailer } from './dev.js';

export const buildMailer = (env: Env): Mailer => {
  if (env.NODE_ENV === 'production') {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY required in production');
    }
    return new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  }
  return new DevMailer();
};
```

- [x] **Step 8: Decorate the Fastify instance in `apps/api/src/app.ts`**

Add imports:

```typescript
import { buildMailer, type Mailer } from './services/mailer/index.js';
```

After `const app = Fastify(...)` but before `await app.register(requestIdPlugin)`, add:

```typescript
app.decorate('mailer', buildMailer(env));
app.decorate('env', env);
```

Then add at the top level of the file (module scope, after imports):

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    mailer: Mailer;
    env: Env;
  }
}
```

- [x] **Step 9: Re-run mailer test and full API suite**

```bash
pnpm --filter @jdm/api test
```

Expected: mailer test passes; existing `health.test.ts` still green.

- [x] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): add mailer abstraction with dev capture and resend driver"
```

---

## ✅ Task 7: `authenticate` decorator + `GET /me`

**Files:**

- Create: `apps/api/src/plugins/auth.ts`
- Create: `apps/api/src/routes/me.ts`
- Modify: `apps/api/src/app.ts` (register `authPlugin` and `meRoutes`)
- Test: `apps/api/test/auth/me.test.ts`
- Test: `apps/api/test/helpers.ts`

- [x] **Step 1: Create shared test helpers `apps/api/test/helpers.ts`**

```typescript
import { prisma } from '@jdm/db';

import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { hashPassword } from '../src/services/auth/password.js';
import { createAccessToken } from '../src/services/auth/tokens.js';

export const makeApp = () => buildApp(loadEnv());

export const resetDatabase = async (): Promise<void> => {
  await prisma.passwordResetToken.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.authProvider.deleteMany();
  await prisma.user.deleteMany();
};

export const createUser = async (
  overrides: Partial<{
    email: string;
    password: string;
    name: string;
    verified: boolean;
    role: 'user' | 'organizer' | 'admin';
  }> = {},
) => {
  const password = overrides.password ?? 'correct-horse-battery-staple';
  const user = await prisma.user.create({
    data: {
      email: overrides.email ?? 'user@jdm.test',
      name: overrides.name ?? 'Test User',
      passwordHash: await hashPassword(password),
      role: overrides.role ?? 'user',
      emailVerifiedAt: overrides.verified ? new Date() : null,
    },
  });
  return { user, password };
};

export const bearer = (
  env: ReturnType<typeof loadEnv>,
  userId: string,
  role: 'user' | 'organizer' | 'admin' = 'user',
) => `Bearer ${createAccessToken({ sub: userId, role }, env)}`;
```

- [x] **Step 2: Write failing test `apps/api/test/auth/me.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';
import { loadEnv } from '../../src/env.js';

describe('GET /me', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a bad signature', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the current user for a valid token', async () => {
    const { user } = await createUser({ email: 'me@jdm.test', verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: user.id, email: 'me@jdm.test', role: 'user' });
    expect(res.json()).not.toHaveProperty('passwordHash');
  });
});
```

- [x] **Step 3: Run — expect failure**

```bash
pnpm --filter @jdm/api test -- auth/me
```

- [x] **Step 4: Create `apps/api/src/plugins/auth.ts`**

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { verifyAccessToken, type AccessPayload } from '../services/auth/tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: AccessPayload;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
export const authPlugin = fp(async (app) => {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'missing bearer token' });
    }
    const token = header.slice('Bearer '.length);
    try {
      request.user = verifyAccessToken(token, app.env);
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid token' });
    }
    return undefined;
  });
});
```

- [x] **Step 5: Create `apps/api/src/routes/me.ts`**

```typescript
import { publicUserSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '@jdm/db';

// eslint-disable-next-line @typescript-eslint/require-await
export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const sub = request.user?.sub;
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: sub } });
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    return publicUserSchema.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
    });
  });
};
```

- [x] **Step 6: Wire both into `apps/api/src/app.ts`**

Add imports at the top:

```typescript
import { authPlugin } from './plugins/auth.js';
import { meRoutes } from './routes/me.js';
```

After `await app.register(healthRoutes);`, add:

```typescript
await app.register(authPlugin);
await app.register(meRoutes);
```

- [x] **Step 7: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test
```

Expected: `me.test.ts` all green + prior tests still pass.

- [x] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add authenticate decorator and GET /me"
```

---

## ✅ Task 8: `POST /auth/signup` (roadmap 1.2)

**Files:**

- Create: `apps/api/src/services/auth/verification.ts`
- Create: `apps/api/src/services/auth/mail-templates.ts`
- Create: `apps/api/src/routes/auth/index.ts`
- Create: `apps/api/src/routes/auth/signup.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/auth/signup.test.ts`

- [x] **Step 1: Failing test `apps/api/test/auth/signup.test.ts`**

```typescript
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { DevMailer } from '../../src/services/mailer/dev.js';
import { makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/signup', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    (app.mailer as DevMailer).clear();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a user and sends a verification email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'new@jdm.test', password: 'correct-horse-battery-staple', name: 'New' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe('new@jdm.test');
    expect(body.user.emailVerifiedAt).toBeNull();
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');

    const saved = await prisma.user.findUnique({ where: { email: 'new@jdm.test' } });
    expect(saved?.passwordHash).not.toBeNull();

    const captured = (app.mailer as DevMailer).find('new@jdm.test');
    expect(captured?.subject).toMatch(/verifique/i);
    expect(captured?.html).toContain('/verify?token=');
  });

  it('rejects duplicate emails', async () => {
    const payload = {
      email: 'dup@jdm.test',
      password: 'correct-horse-battery-staple',
      name: 'Dup',
    };
    const first = await app.inject({ method: 'POST', url: '/auth/signup', payload });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/auth/signup', payload });
    expect(second.statusCode).toBe(409);
  });

  it('rejects weak passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'weak@jdm.test', password: 'short', name: 'Weak' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('normalizes email casing', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'Alice@JDM.Test', password: 'correct-horse-battery-staple', name: 'Alice' },
    });
    const saved = await prisma.user.findUnique({ where: { email: 'alice@jdm.test' } });
    expect(saved).not.toBeNull();
  });
});
```

- [x] **Step 2: Run — expect failure**

```bash
pnpm --filter @jdm/api test -- auth/signup
```

- [x] **Step 3: Create `apps/api/src/services/auth/verification.ts`**

```typescript
import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '@jdm/db';

const VERIFY_TTL_MS = 24 * 3_600_000;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const issueVerificationToken = async (userId: string): Promise<string> => {
  const token = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });
  return token;
};

export const consumeVerificationToken = async (
  token: string,
): Promise<{ userId: string } | null> => {
  const hash = sha256(token);
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: hash } });
  if (!record) return null;
  if (record.consumedAt) return null;
  if (record.expiresAt.getTime() < Date.now()) return null;
  await prisma.$transaction([
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
  ]);
  return { userId: record.userId };
};
```

- [x] **Step 4: Create `apps/api/src/services/auth/mail-templates.ts`**

```typescript
export type VerificationMail = { to: string; subject: string; html: string };
export type ResetMail = VerificationMail;

export const verificationMail = (to: string, link: string): VerificationMail => ({
  to,
  subject: 'JDM Experience — verifique seu e-mail',
  html: `
    <p>Olá!</p>
    <p>Clique no link abaixo para confirmar seu e-mail. Ele expira em 24h.</p>
    <p><a href="${link}">${link}</a></p>
    <p>Se você não criou a conta, ignore este e-mail.</p>
  `,
});

export const resetMail = (to: string, link: string): ResetMail => ({
  to,
  subject: 'JDM Experience — redefinição de senha',
  html: `
    <p>Recebemos um pedido para redefinir sua senha.</p>
    <p>Clique no link abaixo (expira em 1h):</p>
    <p><a href="${link}">${link}</a></p>
    <p>Se você não solicitou, ignore este e-mail.</p>
  `,
});
```

- [x] **Step 5: Create `apps/api/src/routes/auth/signup.ts`**

```typescript
import { prisma } from '@jdm/db';
import { authResponseSchema, signupSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { hashPassword } from '../../services/auth/password.js';
import { createAccessToken, issueRefreshToken } from '../../services/auth/tokens.js';
import { issueVerificationToken } from '../../services/auth/verification.js';
import { verificationMail } from '../../services/auth/mail-templates.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const signupRoute: FastifyPluginAsync = async (app) => {
  app.post('/signup', async (request, reply) => {
    const input = signupSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      return reply.status(409).send({ error: 'Conflict', message: 'email already registered' });
    }

    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
      },
    });

    const verifyToken = await issueVerificationToken(user.id);
    const link = `${app.env.APP_WEB_BASE_URL}/verify?token=${encodeURIComponent(verifyToken)}`;
    await app.mailer.send(verificationMail(user.email, link));

    const access = createAccessToken({ sub: user.id, role: user.role }, app.env);
    const refresh = issueRefreshToken(app.env);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
    });

    return reply.status(201).send(
      authResponseSchema.parse({
        accessToken: access,
        refreshToken: refresh.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerifiedAt: null,
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
```

- [x] **Step 6: Create `apps/api/src/routes/auth/index.ts`**

```typescript
import type { FastifyPluginAsync } from 'fastify';

import { signupRoute } from './signup.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const authRoutes: FastifyPluginAsync = async (app) => {
  await app.register(signupRoute);
};
```

- [x] **Step 7: Register in `apps/api/src/app.ts`**

Add import:

```typescript
import { authRoutes } from './routes/auth/index.js';
```

After `await app.register(meRoutes);`, add:

```typescript
await app.register(authRoutes, { prefix: '/auth' });
```

- [x] **Step 8: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test -- auth/signup
```

Expected: 4 passed.

- [x] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /auth/signup with verification email"
```

---

## ✅ Task 9: `GET /auth/verify` (roadmap 1.5, first half)

**Files:**

- Create: `apps/api/src/routes/auth/verify.ts`
- Modify: `apps/api/src/routes/auth/index.ts`
- Test: `apps/api/test/auth/verify.test.ts`

- [x] **Step 1: Failing test**

```typescript
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { issueVerificationToken } from '../../src/services/auth/verification.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /auth/verify', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('marks email verified on valid token', async () => {
    const { user } = await createUser();
    const token = await issueVerificationToken(user.id);
    const res = await app.inject({ method: 'GET', url: `/auth/verify?token=${token}` });
    expect(res.statusCode).toBe(200);
    const saved = await prisma.user.findUnique({ where: { id: user.id } });
    expect(saved?.emailVerifiedAt).not.toBeNull();
  });

  it('rejects expired tokens', async () => {
    const { user } = await createUser();
    const token = await issueVerificationToken(user.id);
    await prisma.verificationToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const res = await app.inject({ method: 'GET', url: `/auth/verify?token=${token}` });
    expect(res.statusCode).toBe(400);
  });

  it('rejects reused tokens', async () => {
    const { user } = await createUser();
    const token = await issueVerificationToken(user.id);
    await app.inject({ method: 'GET', url: `/auth/verify?token=${token}` });
    const second = await app.inject({ method: 'GET', url: `/auth/verify?token=${token}` });
    expect(second.statusCode).toBe(400);
  });
});
```

- [x] **Step 2: Run — expect failure**

```bash
pnpm --filter @jdm/api test -- auth/verify
```

- [x] **Step 3: Create `apps/api/src/routes/auth/verify.ts`**

```typescript
import { verifyEmailSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { consumeVerificationToken } from '../../services/auth/verification.js';

const querySchema = z.object({ token: z.string().min(10) });

// eslint-disable-next-line @typescript-eslint/require-await
export const verifyRoute: FastifyPluginAsync = async (app) => {
  app.get('/verify', async (request, reply) => {
    const { token } = querySchema.parse(request.query);
    verifyEmailSchema.parse({ token });
    const result = await consumeVerificationToken(token);
    if (!result) {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid or expired token' });
    }
    return reply.status(200).send({ message: 'email verified' });
  });
};
```

- [x] **Step 4: Register in `apps/api/src/routes/auth/index.ts`**

Add import and register:

```typescript
import { verifyRoute } from './verify.js';
// ...inside authRoutes:
await app.register(verifyRoute);
```

- [x] **Step 5: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test -- auth/verify
```

Expected: 3 passed.

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add GET /auth/verify (email confirmation)"
```

---

## ✅ Task 10: `POST /auth/resend-verify` (roadmap 1.5, second half)

**Files:**

- Create: `apps/api/src/routes/auth/resend-verify.ts`
- Modify: `apps/api/src/routes/auth/index.ts`
- Test: `apps/api/test/auth/resend-verify.test.ts`

- [x] **Step 1: Failing test**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { DevMailer } from '../../src/services/mailer/dev.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/resend-verify', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    (app.mailer as DevMailer).clear();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends a new email for unverified users', async () => {
    const { user } = await createUser({ email: 'u@jdm.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-verify',
      payload: { email: user.email },
    });
    expect(res.statusCode).toBe(200);
    expect((app.mailer as DevMailer).find('u@jdm.test')).toBeDefined();
  });

  it('returns 200 even for unknown emails (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-verify',
      payload: { email: 'ghost@jdm.test' },
    });
    expect(res.statusCode).toBe(200);
    expect((app.mailer as DevMailer).captured).toHaveLength(0);
  });

  it('no-ops for already-verified users', async () => {
    const { user } = await createUser({ email: 'v@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-verify',
      payload: { email: user.email },
    });
    expect(res.statusCode).toBe(200);
    expect((app.mailer as DevMailer).captured).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run — expect failure**

- [x] **Step 3: Create `apps/api/src/routes/auth/resend-verify.ts`**

```typescript
import { prisma } from '@jdm/db';
import { resendVerifySchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { verificationMail } from '../../services/auth/mail-templates.js';
import { issueVerificationToken } from '../../services/auth/verification.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const resendVerifyRoute: FastifyPluginAsync = async (app) => {
  app.post('/resend-verify', async (request, reply) => {
    const { email } = resendVerifySchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      const token = await issueVerificationToken(user.id);
      const link = `${app.env.APP_WEB_BASE_URL}/verify?token=${encodeURIComponent(token)}`;
      await app.mailer.send(verificationMail(user.email, link));
    }
    return reply.status(200).send({ message: 'if the email exists, a verification link was sent' });
  });
};
```

- [x] **Step 4: Register in `apps/api/src/routes/auth/index.ts`**

```typescript
import { resendVerifyRoute } from './resend-verify.js';
// ...
await app.register(resendVerifyRoute);
```

- [x] **Step 5: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test -- auth/resend-verify
```

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /auth/resend-verify with enumeration resistance"
```

---

## ✅ Task 11: `POST /auth/login` (roadmap 1.3)

**Files:**

- Create: `apps/api/src/routes/auth/login.ts`
- Modify: `apps/api/src/routes/auth/index.ts`
- Test: `apps/api/test/auth/login.test.ts`

- [x] **Step 1: Failing test**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/login', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns tokens and user on success', async () => {
    const { user, password } = await createUser({ email: 'login@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe('login@jdm.test');
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('rejects bad passwords', async () => {
    await createUser({ email: 'a@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@jdm.test', password: 'x'.repeat(10) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unverified users', async () => {
    const { user, password } = await createUser({ email: 'nv@jdm.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('EmailNotVerified');
  });

  it('rejects unknown users with the same 401 shape as bad passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ghost@jdm.test', password: 'correct-horse-battery-staple' },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [x] **Step 2: Run — expect failure**

- [x] **Step 3: Create `apps/api/src/routes/auth/login.ts`**

```typescript
import { prisma } from '@jdm/db';
import { authResponseSchema, loginSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { verifyPassword } from '../../services/auth/password.js';
import { createAccessToken, issueRefreshToken } from '../../services/auth/tokens.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const loginRoute: FastifyPluginAsync = async (app) => {
  app.post('/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid credentials' });
    }

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid credentials' });
    }

    if (!user.emailVerifiedAt) {
      return reply
        .status(403)
        .send({ error: 'EmailNotVerified', message: 'verify your email first' });
    }

    const access = createAccessToken({ sub: user.id, role: user.role }, app.env);
    const refresh = issueRefreshToken(app.env);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
    });

    return reply.status(200).send(
      authResponseSchema.parse({
        accessToken: access,
        refreshToken: refresh.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerifiedAt: user.emailVerifiedAt.toISOString(),
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
```

- [x] **Step 4: Register in `apps/api/src/routes/auth/index.ts`**

```typescript
import { loginRoute } from './login.js';
// ...
await app.register(loginRoute);
```

- [x] **Step 5: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test -- auth/login
```

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /auth/login with verified-email guard"
```

---

## ✅ Task 12: `POST /auth/refresh` (roadmap 1.4, first half)

**Files:**

- Create: `apps/api/src/routes/auth/refresh.ts`
- Modify: `apps/api/src/routes/auth/index.ts`
- Test: `apps/api/test/auth/refresh.test.ts`

- [x] **Step 1: Failing test**

```typescript
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { issueRefreshToken } from '../../src/services/auth/tokens.js';
import { loadEnv } from '../../src/env.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const seedRefresh = async (userId: string) => {
  const env = loadEnv();
  const issued = issueRefreshToken(env);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: issued.hash, expiresAt: issued.expiresAt },
  });
  return issued.token;
};

describe('POST /auth/refresh', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rotates the refresh token', async () => {
    const { user } = await createUser({ verified: true });
    const original = await seedRefresh(user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: original },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.refreshToken).not.toBe(original);

    const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(2);
    const revoked = stored.find((r) => r.revokedAt !== null);
    expect(revoked).toBeDefined();
  });

  it('rejects unknown tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'z'.repeat(43) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects revoked tokens', async () => {
    const { user } = await createUser({ verified: true });
    const token = await seedRefresh(user.id);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { revokedAt: new Date() },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects expired tokens', async () => {
    const { user } = await createUser({ verified: true });
    const token = await seedRefresh(user.id);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('does not accept the same refresh token twice (rotation)', async () => {
    const { user } = await createUser({ verified: true });
    const token = await seedRefresh(user.id);
    await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: token } });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [x] **Step 2: Run — expect failure**

- [x] **Step 3: Create `apps/api/src/routes/auth/refresh.ts`**

```typescript
import { prisma } from '@jdm/db';
import { authResponseSchema, refreshSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import {
  createAccessToken,
  hashRefreshToken,
  issueRefreshToken,
} from '../../services/auth/tokens.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const refreshRoute: FastifyPluginAsync = async (app) => {
  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const hash = hashRefreshToken(refreshToken, app.env);

    const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const next = issueRefreshToken(app.env);
    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: next.hash, expiresAt: next.expiresAt },
      }),
    ]);

    const access = createAccessToken({ sub: user.id, role: user.role }, app.env);

    return reply.status(200).send(
      authResponseSchema.parse({
        accessToken: access,
        refreshToken: next.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
```

- [x] **Step 4: Register in `apps/api/src/routes/auth/index.ts`**

```typescript
import { refreshRoute } from './refresh.js';
// ...
await app.register(refreshRoute);
```

- [x] **Step 5: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test -- auth/refresh
```

Expected: 5 passed.

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /auth/refresh with single-use token rotation"
```

---

## ✅ Task 13: `POST /auth/logout` (roadmap 1.4, second half)

**Files:**

- Create: `apps/api/src/routes/auth/logout.ts`
- Modify: `apps/api/src/routes/auth/index.ts`
- Test: `apps/api/test/auth/logout.test.ts`

- [x] **Step 1: Failing test**

```typescript
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { issueRefreshToken } from '../../src/services/auth/tokens.js';
import { loadEnv } from '../../src/env.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/logout', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('revokes the refresh token', async () => {
    const env = loadEnv();
    const { user } = await createUser({ verified: true });
    const issued = issueRefreshToken(env);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: issued.hash, expiresAt: issued.expiresAt },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: issued.token },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(after[0]?.revokedAt).not.toBeNull();
  });

  it('returns 200 for unknown tokens (idempotent)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: 'z'.repeat(43) },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [x] **Step 2: Run — expect failure**

- [x] **Step 3: Create `apps/api/src/routes/auth/logout.ts`**

```typescript
import { prisma } from '@jdm/db';
import { logoutSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { hashRefreshToken } from '../../services/auth/tokens.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const logoutRoute: FastifyPluginAsync = async (app) => {
  app.post('/logout', async (request, reply) => {
    const { refreshToken } = logoutSchema.parse(request.body);
    const hash = hashRefreshToken(refreshToken, app.env);
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return reply.status(200).send({ message: 'logged out' });
  });
};
```

- [x] **Step 4: Register**

```typescript
import { logoutRoute } from './logout.js';
// ...
await app.register(logoutRoute);
```

- [x] **Step 5: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test -- auth/logout
```

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /auth/logout with idempotent revocation"
```

---

## ✅ Task 14: `POST /auth/forgot-password` (roadmap 1.6, first half)

**Files:**

- Create: `apps/api/src/services/auth/password-reset.ts`
- Create: `apps/api/src/routes/auth/forgot-password.ts`
- Modify: `apps/api/src/routes/auth/index.ts`
- Test: `apps/api/test/auth/forgot-password.test.ts`

- [x] **Step 1: Failing test**

```typescript
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { DevMailer } from '../../src/services/mailer/dev.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/forgot-password', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    (app.mailer as DevMailer).clear();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a reset token and emails the user', async () => {
    const { user } = await createUser({ email: 'reset@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: user.email },
    });
    expect(res.statusCode).toBe(200);
    const mail = (app.mailer as DevMailer).find('reset@jdm.test');
    expect(mail?.html).toContain('/reset-password?token=');
    const count = await prisma.passwordResetToken.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it('returns 200 for unknown emails (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'ghost@jdm.test' },
    });
    expect(res.statusCode).toBe(200);
    expect((app.mailer as DevMailer).captured).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run — expect failure**

- [x] **Step 3: Create `apps/api/src/services/auth/password-reset.ts`**

```typescript
import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '@jdm/db';

const RESET_TTL_MS = 3_600_000;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const issuePasswordResetToken = async (userId: string): Promise<string> => {
  const token = randomBytes(32).toString('base64url');
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  return token;
};

export const consumePasswordResetToken = async (
  token: string,
): Promise<{ userId: string } | null> => {
  const hash = sha256(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });
  if (!record) return null;
  if (record.consumedAt) return null;
  if (record.expiresAt.getTime() < Date.now()) return null;
  await prisma.passwordResetToken.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });
  return { userId: record.userId };
};
```

- [x] **Step 4: Create `apps/api/src/routes/auth/forgot-password.ts`**

```typescript
import { prisma } from '@jdm/db';
import { forgotPasswordSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { resetMail } from '../../services/auth/mail-templates.js';
import { issuePasswordResetToken } from '../../services/auth/password-reset.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const forgotPasswordRoute: FastifyPluginAsync = async (app) => {
  app.post('/forgot-password', async (request, reply) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await issuePasswordResetToken(user.id);
      const link = `${app.env.APP_WEB_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await app.mailer.send(resetMail(user.email, link));
    }
    return reply.status(200).send({ message: 'if the email exists, a reset link was sent' });
  });
};
```

- [x] **Step 5: Register**

```typescript
import { forgotPasswordRoute } from './forgot-password.js';
// ...
await app.register(forgotPasswordRoute);
```

- [x] **Step 6: Re-run — expect pass**

- [x] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /auth/forgot-password"
```

---

## ✅ Task 15: `POST /auth/reset-password` (roadmap 1.6, second half)

**Files:**

- Create: `apps/api/src/routes/auth/reset-password.ts`
- Modify: `apps/api/src/routes/auth/index.ts`
- Test: `apps/api/test/auth/reset-password.test.ts`

- [x] **Step 1: Failing test**

```typescript
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { issuePasswordResetToken } from '../../src/services/auth/password-reset.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/reset-password', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('resets the password and revokes all refresh tokens', async () => {
    const { user, password } = await createUser({ email: 'r@jdm.test', verified: true });
    const token = await issuePasswordResetToken(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'a-brand-new-passphrase' },
    });
    expect(res.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'a-brand-new-passphrase' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects reused tokens', async () => {
    const { user } = await createUser({ verified: true });
    const token = await issuePasswordResetToken(user.id);
    await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'a-brand-new-passphrase' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'another-passphrase-1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects expired tokens', async () => {
    const { user } = await createUser({ verified: true });
    const token = await issuePasswordResetToken(user.id);
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'a-brand-new-passphrase' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [x] **Step 2: Run — expect failure**

- [x] **Step 3: Create `apps/api/src/routes/auth/reset-password.ts`**

```typescript
import { prisma } from '@jdm/db';
import { resetPasswordSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { hashPassword } from '../../services/auth/password.js';
import { consumePasswordResetToken } from '../../services/auth/password-reset.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const resetPasswordRoute: FastifyPluginAsync = async (app) => {
  app.post('/reset-password', async (request, reply) => {
    const { token, password } = resetPasswordSchema.parse(request.body);
    const consumed = await consumePasswordResetToken(token);
    if (!consumed) {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid or expired token' });
    }
    const hash = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: consumed.userId }, data: { passwordHash: hash } }),
      prisma.refreshToken.updateMany({
        where: { userId: consumed.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return reply.status(200).send({ message: 'password updated' });
  });
};
```

- [x] **Step 4: Register**

```typescript
import { resetPasswordRoute } from './reset-password.js';
// ...
await app.register(resetPasswordRoute);
```

- [x] **Step 5: Re-run — expect pass**

- [x] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /auth/reset-password (revokes refresh tokens)"
```

---

## Task 16: Google sign-in (roadmap 1.7)

> note (2026-04-18): deferred to post-MVP. Email+password is sufficient for v0.1. Plan body retained for future pickup; AuthProvider schema is already in place from chunk A, so no migration will be needed when this is revived.

**Files:**

- Create: `apps/api/src/services/auth/google-verifier.ts`
- Create: `apps/api/src/services/auth/social-upsert.ts`
- Create: `apps/api/src/routes/auth/google.ts`
- Modify: `apps/api/src/routes/auth/index.ts`
- Modify: `apps/api/package.json` (add `jose`)
- Test: `apps/api/test/auth/google.test.ts`

- [ ] **Step 1: Install `jose`**

```bash
pnpm --filter @jdm/api add jose
```

- [ ] **Step 2: Create `apps/api/src/services/auth/google-verifier.ts`**

The verifier is injectable so tests can stub it (we don't want to call Google during tests).

```typescript
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export type GoogleClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

export interface GoogleVerifier {
  verify(idToken: string): Promise<GoogleClaims>;
}

export class JoseGoogleVerifier implements GoogleVerifier {
  private readonly jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

  constructor(private readonly audience: string) {}

  async verify(idToken: string): Promise<GoogleClaims> {
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
      audience: this.audience,
    });
    return toClaims(payload);
  }
}

const toClaims = (payload: JWTPayload): GoogleClaims => {
  const sub = payload.sub;
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (!sub || !email) throw new Error('google claims missing sub or email');
  return {
    sub,
    email,
    emailVerified,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  };
};
```

- [ ] **Step 3: Create `apps/api/src/services/auth/social-upsert.ts`**

```typescript
import { prisma } from '@jdm/db';

export type SocialIdentity = {
  provider: 'google' | 'apple';
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

export const upsertSocialUser = async (identity: SocialIdentity) => {
  const existingProvider = await prisma.authProvider.findUnique({
    where: {
      provider_providerUserId: {
        provider: identity.provider,
        providerUserId: identity.providerUserId,
      },
    },
    include: { user: true },
  });
  if (existingProvider) {
    return existingProvider.user;
  }

  const existingUser = await prisma.user.findUnique({ where: { email: identity.email } });
  if (existingUser) {
    await prisma.authProvider.create({
      data: {
        userId: existingUser.id,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
      },
    });
    return existingUser;
  }

  return prisma.user.create({
    data: {
      email: identity.email,
      name: identity.name || identity.email,
      emailVerifiedAt: identity.emailVerified ? new Date() : null,
      authProviders: {
        create: { provider: identity.provider, providerUserId: identity.providerUserId },
      },
    },
  });
};
```

- [ ] **Step 4: Failing test `apps/api/test/auth/google.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import type { GoogleVerifier } from '../../src/services/auth/google-verifier.js';
import { makeApp, resetDatabase } from '../helpers.js';

class StubVerifier implements GoogleVerifier {
  constructor(private readonly response: Awaited<ReturnType<GoogleVerifier['verify']>>) {}
  async verify() {
    return this.response;
  }
}

const withStub = (app: FastifyInstance, verifier: GoogleVerifier) => {
  (app as unknown as { googleVerifier: GoogleVerifier }).googleVerifier = verifier;
};

describe('POST /auth/google', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a new user and returns tokens', async () => {
    withStub(
      app,
      new StubVerifier({
        sub: 'google-123',
        email: 'g@jdm.test',
        emailVerified: true,
        name: 'G User',
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'stub' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('g@jdm.test');
  });

  it('links a second sign-in to the same account', async () => {
    withStub(
      app,
      new StubVerifier({
        sub: 'google-456',
        email: 'same@jdm.test',
        emailVerified: true,
        name: 'Same',
      }),
    );
    await app.inject({ method: 'POST', url: '/auth/google', payload: { idToken: 'stub' } });
    const again = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: 'stub' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().user.email).toBe('same@jdm.test');
  });
});
```

- [ ] **Step 5: Create `apps/api/src/routes/auth/google.ts`**

```typescript
import { prisma } from '@jdm/db';
import { authResponseSchema, googleSignInSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { JoseGoogleVerifier, type GoogleVerifier } from '../../services/auth/google-verifier.js';
import { upsertSocialUser } from '../../services/auth/social-upsert.js';
import { createAccessToken, issueRefreshToken } from '../../services/auth/tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    googleVerifier: GoogleVerifier;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
export const googleRoute: FastifyPluginAsync = async (app) => {
  if (!app.hasDecorator('googleVerifier')) {
    const audience = app.env.GOOGLE_CLIENT_ID;
    if (!audience) {
      app.log.warn('GOOGLE_CLIENT_ID not set — /auth/google will 503');
    }
    app.decorate(
      'googleVerifier',
      audience
        ? new JoseGoogleVerifier(audience)
        : {
            async verify() {
              throw Object.assign(new Error('google sign-in not configured'), { statusCode: 503 });
            },
          },
    );
  }

  app.post('/google', async (request, reply) => {
    const { idToken } = googleSignInSchema.parse(request.body);
    const claims = await app.googleVerifier.verify(idToken);
    if (!claims.emailVerified) {
      return reply.status(400).send({ error: 'BadRequest', message: 'google email not verified' });
    }

    const user = await upsertSocialUser({
      provider: 'google',
      providerUserId: claims.sub,
      email: claims.email.toLowerCase(),
      emailVerified: true,
      name: claims.name ?? claims.email,
    });

    const access = createAccessToken({ sub: user.id, role: user.role }, app.env);
    const refresh = issueRefreshToken(app.env);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
    });

    return reply.status(200).send(
      authResponseSchema.parse({
        accessToken: access,
        refreshToken: refresh.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
```

- [ ] **Step 6: Register**

```typescript
import { googleRoute } from './google.js';
// ...
await app.register(googleRoute);
```

- [ ] **Step 7: Re-run — expect pass**

```bash
pnpm --filter @jdm/api test -- auth/google
```

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /auth/google with injectable verifier"
```

---

## Task 17: Apple sign-in (roadmap 1.8)

> note (2026-04-18): deferred to post-MVP alongside Task 16. Revive when social sign-in enters the backlog again.

**Files:**

- Create: `apps/api/src/services/auth/apple-verifier.ts`
- Create: `apps/api/src/routes/auth/apple.ts`
- Modify: `apps/api/src/routes/auth/index.ts`
- Test: `apps/api/test/auth/apple.test.ts`

- [ ] **Step 1: Create `apps/api/src/services/auth/apple-verifier.ts`**

```typescript
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export type AppleClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
  isPrivateEmail: boolean;
};

export interface AppleVerifier {
  verify(idToken: string): Promise<AppleClaims>;
}

export class JoseAppleVerifier implements AppleVerifier {
  private readonly jwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

  constructor(private readonly audience: string) {}

  async verify(idToken: string): Promise<AppleClaims> {
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: 'https://appleid.apple.com',
      audience: this.audience,
    });
    return toClaims(payload);
  }
}

const toClaims = (payload: JWTPayload): AppleClaims => {
  const sub = payload.sub;
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  if (!sub || !email) throw new Error('apple claims missing sub or email');
  return {
    sub,
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    isPrivateEmail: payload.is_private_email === true || payload.is_private_email === 'true',
  };
};
```

- [ ] **Step 2: Failing test `apps/api/test/auth/apple.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import type { AppleVerifier } from '../../src/services/auth/apple-verifier.js';
import { makeApp, resetDatabase } from '../helpers.js';

class StubAppleVerifier implements AppleVerifier {
  constructor(private readonly r: Awaited<ReturnType<AppleVerifier['verify']>>) {}
  async verify() {
    return this.r;
  }
}

const stub = (app: FastifyInstance, verifier: AppleVerifier) => {
  (app as unknown as { appleVerifier: AppleVerifier }).appleVerifier = verifier;
};

describe('POST /auth/apple', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a user for a regular apple email', async () => {
    stub(
      app,
      new StubAppleVerifier({
        sub: 'apple-1',
        email: 'a@jdm.test',
        emailVerified: true,
        isPrivateEmail: false,
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/auth/apple',
      payload: { idToken: 'stub', fullName: { givenName: 'Sam', familyName: 'I' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('a@jdm.test');
    expect(res.json().user.name).toBe('Sam I');
  });

  it('accepts hide-my-email relay addresses', async () => {
    stub(
      app,
      new StubAppleVerifier({
        sub: 'apple-2',
        email: 'abc123@privaterelay.appleid.com',
        emailVerified: true,
        isPrivateEmail: true,
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/auth/apple',
      payload: { idToken: 'stub' },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 3: Create `apps/api/src/routes/auth/apple.ts`**

```typescript
import { prisma } from '@jdm/db';
import { appleSignInSchema, authResponseSchema } from '@jdm/shared/auth';
import type { FastifyPluginAsync } from 'fastify';

import { JoseAppleVerifier, type AppleVerifier } from '../../services/auth/apple-verifier.js';
import { upsertSocialUser } from '../../services/auth/social-upsert.js';
import { createAccessToken, issueRefreshToken } from '../../services/auth/tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    appleVerifier: AppleVerifier;
  }
}

const nameFrom = (
  fullName: { givenName?: string | null; familyName?: string | null } | undefined,
  fallback: string,
): string => {
  if (!fullName) return fallback;
  const parts = [fullName.givenName, fullName.familyName].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : fallback;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const appleRoute: FastifyPluginAsync = async (app) => {
  if (!app.hasDecorator('appleVerifier')) {
    const audience = app.env.APPLE_CLIENT_ID;
    app.decorate(
      'appleVerifier',
      audience
        ? new JoseAppleVerifier(audience)
        : {
            async verify() {
              throw Object.assign(new Error('apple sign-in not configured'), { statusCode: 503 });
            },
          },
    );
  }

  app.post('/apple', async (request, reply) => {
    const input = appleSignInSchema.parse(request.body);
    const claims = await app.appleVerifier.verify(input.idToken);

    const user = await upsertSocialUser({
      provider: 'apple',
      providerUserId: claims.sub,
      email: claims.email.toLowerCase(),
      emailVerified: claims.emailVerified,
      name: nameFrom(input.fullName, claims.email),
    });

    const access = createAccessToken({ sub: user.id, role: user.role }, app.env);
    const refresh = issueRefreshToken(app.env);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
    });

    return reply.status(200).send(
      authResponseSchema.parse({
        accessToken: access,
        refreshToken: refresh.token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
```

- [ ] **Step 4: Register**

```typescript
import { appleRoute } from './apple.js';
// ...
await app.register(appleRoute);
```

- [ ] **Step 5: Re-run — expect pass**

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /auth/apple with hide-my-email support"
```

---

## ✅ Task 18: Rate limiting on `/auth/*` (roadmap 1.9)

> note (2026-04-18): the planned `global:false` + per-route `onRoute` hook in `routes/auth/index.ts` did not fire before `@fastify/rate-limit`'s own `onRoute` hook (parent hook ordering), so per-route config was never read. Switched to registering `@fastify/rate-limit` _inside_ the auth scope with global limits — every `/auth/*` route inherits the same `(ip,email)` limit, no opt-in needed. `app.ts` no longer registers rate-limit. Same external behavior; simpler wiring.

**Files:**

- Modify: `apps/api/src/routes/auth/index.ts` (scoped registration of `@fastify/rate-limit`)
- Modify: `apps/api/package.json`
- Test: `apps/api/test/auth/rate-limit.test.ts`

- [x] **Step 1: Install**

```bash
pnpm --filter @jdm/api add @fastify/rate-limit
```

- [x] **Step 2: ~~Register globally in `apps/api/src/app.ts`~~** — skipped per deviation note above (rate-limit registered inside the auth scope instead).

- [x] **Step 3: Register `@fastify/rate-limit` inside the auth scope in `apps/api/src/routes/auth/index.ts`**

(Google + Apple route imports omitted — Tasks 16/17 deferred.)

```typescript
import rateLimit from '@fastify/rate-limit';

import type { FastifyPluginAsync } from 'fastify';

import { forgotPasswordRoute } from './forgot-password.js';
import { loginRoute } from './login.js';
import { logoutRoute } from './logout.js';
import { refreshRoute } from './refresh.js';
import { resendVerifyRoute } from './resend-verify.js';
import { resetPasswordRoute } from './reset-password.js';
import { signupRoute } from './signup.js';
import { verifyRoute } from './verify.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 10,
      timeWindow: '1 minute',
      keyGenerator: (req) => {
        const body = req.body as { email?: string } | undefined;
        const email = body?.email ?? '';
        return `${req.ip}:${email}`;
      },
    });

    await scoped.register(signupRoute);
    await scoped.register(verifyRoute);
    await scoped.register(resendVerifyRoute);
    await scoped.register(loginRoute);
    await scoped.register(refreshRoute);
    await scoped.register(logoutRoute);
    await scoped.register(forgotPasswordRoute);
    await scoped.register(resetPasswordRoute);
  });
};
```

- [x] **Step 4: Test `apps/api/test/auth/rate-limit.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { makeApp, resetDatabase } from '../helpers.js';

describe('auth rate limit', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 429 after 10 login attempts from the same (ip,email)', async () => {
    const payload = { email: 'rl@jdm.test', password: 'correct-horse-battery-staple' };
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/auth/login', payload });
      expect(res.statusCode).toBe(401);
    }
    const res11 = await app.inject({ method: 'POST', url: '/auth/login', payload });
    expect(res11.statusCode).toBe(429);
  });
});
```

- [x] **Step 5: Run — expect pass**

```bash
pnpm --filter @jdm/api test -- auth/rate-limit
```

- [x] **Step 6: Full API suite green**

```bash
pnpm --filter @jdm/api test
```

Expected: every auth/\* test plus `health.test.ts` pass. Result: 14 files / 43 tests green.

- [x] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): rate-limit /auth/* endpoints per (ip,email)"
```

---

## ✅ Task 19: Mobile SecureStore wrapper (roadmap 1.13, storage half)

**Files:**

- Create: `apps/mobile/src/auth/storage.ts`
- Modify: `apps/mobile/package.json` (add `expo-secure-store`)

- [ ] **Step 1: Install**

```bash
pnpm --filter @jdm/mobile add expo-secure-store
```

- [ ] **Step 2: Create `apps/mobile/src/auth/storage.ts`**

```typescript
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'jdm.auth.access';
const REFRESH_KEY = 'jdm.auth.refresh';

export type StoredTokens = { accessToken: string; refreshToken: string };

export const saveTokens = async (tokens: StoredTokens): Promise<void> => {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken),
  ]);
};

export const loadTokens = async (): Promise<StoredTokens | null> => {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
};

export const clearTokens = async (): Promise<void> => {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/package.json apps/mobile/src/auth/storage.ts
git commit -m "feat(mobile): add SecureStore wrapper for auth tokens"
```

---

## ✅ Task 20: Mobile typed auth API client

**Files:**

- Modify: `apps/mobile/src/api/client.ts`
- Create: `apps/mobile/src/api/auth.ts`

- [ ] **Step 1: Replace `apps/mobile/src/api/client.ts`**

```typescript
import Constants from 'expo-constants';
import type { z } from 'zod';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
const DEFAULT_BASE = 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
};

export const baseUrl = (): string => extra.apiBaseUrl ?? DEFAULT_BASE;

export const request = async <T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const init: RequestInit = { method: options.method ?? 'GET', headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;
  const response = await fetch(`${baseUrl()}${path}`, init);
  // > note (2026-04-18): init built conditionally — exactOptionalPropertyTypes rejects undefined body/signal.
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`, parsed);
  }
  return schema.parse(parsed);
};
```

- [ ] **Step 2: Create `apps/mobile/src/api/auth.ts`**

```typescript
import {
  authResponseSchema,
  type AuthResponse,
  type ForgotPasswordInput,
  type LoginInput,
  type ResendVerifyInput,
  type ResetPasswordInput,
  type SignupInput,
  messageResponseSchema,
  type MessageResponse,
  publicUserSchema,
  type PublicUser,
} from '@jdm/shared/auth';

import { request } from './client';

export const signupRequest = (input: SignupInput): Promise<AuthResponse> =>
  request('/auth/signup', authResponseSchema, { method: 'POST', body: input });

export const loginRequest = (input: LoginInput): Promise<AuthResponse> =>
  request('/auth/login', authResponseSchema, { method: 'POST', body: input });

export const refreshRequest = (refreshToken: string): Promise<AuthResponse> =>
  request('/auth/refresh', authResponseSchema, { method: 'POST', body: { refreshToken } });

export const logoutRequest = (refreshToken: string): Promise<MessageResponse> =>
  request('/auth/logout', messageResponseSchema, { method: 'POST', body: { refreshToken } });

export const resendVerifyRequest = (input: ResendVerifyInput): Promise<MessageResponse> =>
  request('/auth/resend-verify', messageResponseSchema, { method: 'POST', body: input });

export const forgotPasswordRequest = (input: ForgotPasswordInput): Promise<MessageResponse> =>
  request('/auth/forgot-password', messageResponseSchema, { method: 'POST', body: input });

export const resetPasswordRequest = (input: ResetPasswordInput): Promise<MessageResponse> =>
  request('/auth/reset-password', messageResponseSchema, { method: 'POST', body: input });

export const googleSignInRequest = (idToken: string): Promise<AuthResponse> =>
  request('/auth/google', authResponseSchema, { method: 'POST', body: { idToken } });

export const appleSignInRequest = (
  idToken: string,
  fullName?: { givenName?: string | null; familyName?: string | null },
): Promise<AuthResponse> =>
  request('/auth/apple', authResponseSchema, {
    method: 'POST',
    body: { idToken, fullName },
  });

export const meRequest = (token: string): Promise<PublicUser> =>
  request('/me', publicUserSchema, { token });
```

- [ ] **Step 3: Update `apps/mobile/app/index.tsx` to use the new `request` helper**

The Phase 0 home screen imports the now-removed `api.health` export. Replace the import + call in the same commit so typecheck stays green (Task 21 will delete this file entirely):

```typescript
import { request } from '~/api/client';
import { healthResponseSchema } from '@jdm/shared/health';
// ...
const result = await request('/health', healthResponseSchema);
```

- [ ] **Step 4: Typecheck mobile — green**

```bash
pnpm --filter @jdm/mobile typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api apps/mobile/app/index.tsx
git commit -m "feat(mobile): add typed auth api client"
```

---

## ✅ Task 21: Mobile auth context + root route guard

**Files:**

- Create: `apps/mobile/src/auth/context.tsx`
- Create: `apps/mobile/src/copy/auth.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Delete: `apps/mobile/app/index.tsx` (replaced by `app/(tabs)/index.tsx` in F3; for F1 we redirect home → login if logged out, `/welcome` otherwise)
- Create: `apps/mobile/app/(auth)/_layout.tsx`
- Create: `apps/mobile/app/welcome.tsx` (placeholder authenticated home)

- [ ] **Step 1: Create copy file `apps/mobile/src/copy/auth.ts`**

```typescript
export const authCopy = {
  common: {
    appName: 'JDM Experience',
    continue: 'Continuar',
    submit: 'Enviar',
    cancel: 'Cancelar',
    back: 'Voltar',
    or: 'ou',
    loading: 'Carregando…',
  },
  errors: {
    network: 'Sem conexão. Tente novamente.',
    unknown: 'Algo deu errado.',
    invalidCredentials: 'E-mail ou senha inválidos.',
    emailExists: 'Esse e-mail já está cadastrado.',
    emailNotVerified: 'Confirme seu e-mail antes de entrar.',
    weakPassword: 'Use pelo menos 10 caracteres.',
  },
  login: {
    title: 'Entrar',
    email: 'E-mail',
    password: 'Senha',
    submit: 'Entrar',
    forgot: 'Esqueci minha senha',
    noAccount: 'Ainda não tenho conta',
    withGoogle: 'Entrar com Google',
    withApple: 'Entrar com Apple',
  },
  signup: {
    title: 'Criar conta',
    name: 'Nome',
    email: 'E-mail',
    password: 'Senha (mín. 10 caracteres)',
    submit: 'Criar conta',
    haveAccount: 'Já tenho conta',
    agree: 'Ao continuar você concorda com os Termos e a Política de Privacidade.',
  },
  forgot: {
    title: 'Recuperar senha',
    email: 'E-mail cadastrado',
    submit: 'Enviar link',
    sent: 'Se o e-mail existir, enviaremos um link em instantes.',
  },
  verifyPending: {
    title: 'Confirme seu e-mail',
    body: (email: string) => `Enviamos um link para ${email}. Toque no link para ativar sua conta.`,
    resend: 'Reenviar e-mail',
    resent: 'Enviamos novamente. Verifique sua caixa de entrada.',
  },
};
```

- [ ] **Step 2: Create `apps/mobile/src/auth/context.tsx`**

```typescript
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { PublicUser } from '@jdm/shared/auth';

import {
  loginRequest,
  logoutRequest,
  meRequest,
  refreshRequest,
  signupRequest,
  type LoginInput,
  type SignupInput,
} from '~/api/auth';
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from './storage';

type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

type AuthState = {
  status: AuthStatus;
  user: PublicUser | null;
  tokens: StoredTokens | null;
};

type AuthContextValue = AuthState & {
  signup: (input: SignupInput) => Promise<PublicUser>;
  login: (input: LoginInput) => Promise<PublicUser>;
  setSession: (tokens: StoredTokens, user: PublicUser) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, tokens: null });

  const applySession = useCallback(async (tokens: StoredTokens, user: PublicUser) => {
    await saveTokens(tokens);
    setState({ status: 'authenticated', tokens, user });
  }, []);

  useEffect(() => {
    const boot = async () => {
      const stored = await loadTokens();
      if (!stored) {
        setState({ status: 'unauthenticated', user: null, tokens: null });
        return;
      }
      try {
        const user = await meRequest(stored.accessToken);
        setState({ status: 'authenticated', user, tokens: stored });
      } catch {
        try {
          const refreshed = await refreshRequest(stored.refreshToken);
          await applySession(
            { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken },
            refreshed.user,
          );
        } catch {
          await clearTokens();
          setState({ status: 'unauthenticated', user: null, tokens: null });
        }
      }
    };
    void boot();
  }, [applySession]);

  const signup: AuthContextValue['signup'] = useCallback(
    async (input) => {
      const res = await signupRequest(input);
      await applySession(
        { accessToken: res.accessToken, refreshToken: res.refreshToken },
        res.user,
      );
      return res.user;
    },
    [applySession],
  );

  const login: AuthContextValue['login'] = useCallback(
    async (input) => {
      const res = await loginRequest(input);
      await applySession(
        { accessToken: res.accessToken, refreshToken: res.refreshToken },
        res.user,
      );
      return res.user;
    },
    [applySession],
  );

  const logout: AuthContextValue['logout'] = useCallback(async () => {
    const current = state.tokens;
    if (current) {
      try {
        await logoutRequest(current.refreshToken);
      } catch {
        // swallow — local clear proceeds
      }
    }
    await clearTokens();
    setState({ status: 'unauthenticated', user: null, tokens: null });
  }, [state.tokens]);

  const refreshUser: AuthContextValue['refreshUser'] = useCallback(async () => {
    if (!state.tokens) return;
    try {
      const user = await meRequest(state.tokens.accessToken);
      setState((prev) => ({ ...prev, user }));
    } catch {
      // interceptor handles refresh; leave state alone
    }
  }, [state.tokens]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signup, login, setSession: applySession, logout, refreshUser }),
    [state, signup, login, applySession, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
};
```

- [ ] **Step 3: Replace `apps/mobile/app/_layout.tsx`**

```typescript
import { Redirect, Slot, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';

import { AuthProvider, useAuth } from '~/auth/context';
import { initSentry } from '~/lib/sentry';
import { theme } from '~/theme';

const Gate = () => {
  const auth = useAuth();
  const pathname = usePathname();
  const inAuth = pathname.startsWith('/login') || pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot') || pathname.startsWith('/reset-password') ||
    pathname.startsWith('/verify-email-pending');

  if (auth.status === 'loading') {
    return <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />;
  }
  if (auth.status === 'unauthenticated' && !inAuth) {
    return <Redirect href="/login" />;
  }
  if (auth.status === 'authenticated' && inAuth) {
    return <Redirect href="/welcome" />;
  }
  if (auth.status === 'authenticated' && auth.user && !auth.user.emailVerifiedAt && pathname !== '/verify-email-pending') {
    return <Redirect href="/verify-email-pending" />;
  }
  return <Slot />;
};

export default function RootLayout() {
  useEffect(() => {
    initSentry();
  }, []);
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Gate />
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Remove old `apps/mobile/app/index.tsx`**

```bash
rm apps/mobile/app/index.tsx
```

- [ ] **Step 5: Create `apps/mobile/app/welcome.tsx`**

```typescript
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '~/auth/context';
import { Button } from '~/components/Button';
import { theme } from '~/theme';

export default function WelcomeScreen() {
  const { user, logout } = useAuth();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Olá, {user?.name ?? 'piloto'}</Text>
      <Text style={styles.body}>Você está dentro. Em breve, eventos e ingressos.</Text>
      <Button label="Sair" onPress={() => void logout()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
    justifyContent: 'center',
  },
  title: { color: theme.colors.fg, fontSize: theme.font.size.xxl, fontWeight: '700' },
  body: { color: theme.colors.muted, fontSize: theme.font.size.md },
});
```

- [ ] **Step 6: Create `apps/mobile/app/(auth)/_layout.tsx`**

```typescript
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 7: Typecheck and smoke-test**

```bash
pnpm --filter @jdm/mobile typecheck
```

Expected: green. (Screens under `(auth)/` arrive in the next tasks; `expo-router` tolerates an empty group.)

> note (2026-04-18): expo-router v6 with `typedRoutes: true` requires the `.expo/types/router.d.ts` file to list every route as a literal type for `Redirect` hrefs to typecheck. The file is normally regenerated by `expo start`. In CI without a dev server, stubs must exist before typecheck AND the router.d.ts must be regenerated (manually or by starting the dev server once). Chunk D created all 6 route stubs (login/signup/forgot/verify-email-pending/reset-password/welcome) inside Task 21 and hand-edited `.expo/types/router.d.ts` to include them. Task 22–25 replace the stubs in place.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/auth apps/mobile/src/copy apps/mobile/app
git commit -m "feat(mobile): add auth context and root route guard"
```

---

## ✅ Task 22: Mobile login screen (roadmap 1.10, login half)

**Files:**

- Create: `apps/mobile/app/(auth)/login.tsx`
- Create: `apps/mobile/src/components/TextField.tsx`
- Modify: `apps/mobile/package.json` (add `react-hook-form`, `@hookform/resolvers`)

- [ ] **Step 1: Install deps**

```bash
pnpm --filter @jdm/mobile add react-hook-form @hookform/resolvers
```

- [ ] **Step 2: Create `apps/mobile/src/components/TextField.tsx`**

```typescript
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { theme } from '~/theme';

type Props = TextInputProps & {
  label: string;
  error?: string;
};

export const TextField = ({ label, error, style, ...rest }: Props) => (
  <View style={styles.wrap}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      placeholderTextColor={theme.colors.muted}
      style={[styles.input, error ? styles.inputError : null, style]}
      {...rest}
    />
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing.xs },
  label: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  input: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    borderWidth: 1,
    borderColor: theme.colors.muted,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  inputError: { borderColor: theme.colors.accent },
  error: { color: theme.colors.accent, fontSize: theme.font.size.sm },
});
```

- [ ] **Step 3: Create `apps/mobile/app/(auth)/login.tsx`**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { loginSchema, type LoginInput } from '@jdm/shared/auth';

import { ApiError } from '~/api/client';
import { useAuth } from '~/auth/context';
import { Button } from '~/components/Button';
import { TextField } from '~/components/TextField';
import { authCopy } from '~/copy/auth';
import { theme } from '~/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values);
      router.replace('/welcome');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError('password', { message: authCopy.errors.invalidCredentials });
        else if (err.status === 403) setError('email', { message: authCopy.errors.emailNotVerified });
        else setError('password', { message: authCopy.errors.unknown });
      } else {
        setError('password', { message: authCopy.errors.network });
      }
    }
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{authCopy.login.title}</Text>
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, value } }) => (
          <TextField
            label={authCopy.login.email}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={value}
            onChangeText={onChange}
            error={errors.email?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, value } }) => (
          <TextField
            label={authCopy.login.password}
            secureTextEntry
            autoComplete="password"
            value={value}
            onChangeText={onChange}
            error={errors.password?.message}
          />
        )}
      />
      <Button label={isSubmitting ? authCopy.common.loading : authCopy.login.submit} onPress={onSubmit} />
      <Link style={styles.link} href="/forgot">{authCopy.login.forgot}</Link>
      <Link style={styles.link} href="/signup">{authCopy.login.noAccount}</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, padding: theme.spacing.xl, gap: theme.spacing.md, justifyContent: 'center' },
  title: { color: theme.colors.fg, fontSize: theme.font.size.xxl, fontWeight: '700' },
  link: { color: theme.colors.fg, fontSize: theme.font.size.md, textDecorationLine: 'underline' },
});
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
```

Expected: green. (`/forgot` and `/signup` land in next tasks — expo-router tolerates missing hrefs at typecheck if `experiments.typedRoutes` is on? Yes, it will complain. Keep the href string literals but add the referenced screens as empty stubs in Task 23 + 25 before committing here.)

Alternative: stub `apps/mobile/app/(auth)/signup.tsx` and `forgot.tsx` with single-liner returns before this task's commit. Do so:

```typescript
// apps/mobile/app/(auth)/signup.tsx
export default function SignupScreen() {
  return null;
}
```

```typescript
// apps/mobile/app/(auth)/forgot.tsx
export default function ForgotScreen() {
  return null;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add login screen with react-hook-form + zod"
```

---

## ✅ Task 23: Mobile signup screen (roadmap 1.10, signup half)

**Files:**

- Modify: `apps/mobile/app/(auth)/signup.tsx` (replace stub)

- [ ] **Step 1: Replace stub with the real screen**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { signupSchema, type SignupInput } from '@jdm/shared/auth';

import { ApiError } from '~/api/client';
import { useAuth } from '~/auth/context';
import { Button } from '~/components/Button';
import { TextField } from '~/components/TextField';
import { authCopy } from '~/copy/auth';
import { theme } from '~/theme';

export default function SignupScreen() {
  const { signup } = useAuth();
  const router = useRouter();
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', password: '', name: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await signup(values);
      router.replace('/verify-email-pending');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('email', { message: authCopy.errors.emailExists });
      } else if (err instanceof ApiError && err.status === 400) {
        setError('password', { message: authCopy.errors.weakPassword });
      } else {
        setError('password', { message: authCopy.errors.unknown });
      }
    }
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{authCopy.signup.title}</Text>
      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, value } }) => (
          <TextField
            label={authCopy.signup.name}
            value={value}
            onChangeText={onChange}
            error={errors.name?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, value } }) => (
          <TextField
            label={authCopy.signup.email}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={value}
            onChangeText={onChange}
            error={errors.email?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, value } }) => (
          <TextField
            label={authCopy.signup.password}
            secureTextEntry
            value={value}
            onChangeText={onChange}
            error={errors.password?.message}
          />
        )}
      />
      <Button label={isSubmitting ? authCopy.common.loading : authCopy.signup.submit} onPress={onSubmit} />
      <Text style={styles.agree}>{authCopy.signup.agree}</Text>
      <Link style={styles.link} href="/login">{authCopy.signup.haveAccount}</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, padding: theme.spacing.xl, gap: theme.spacing.md, justifyContent: 'center' },
  title: { color: theme.colors.fg, fontSize: theme.font.size.xxl, fontWeight: '700' },
  agree: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  link: { color: theme.colors.fg, fontSize: theme.font.size.md, textDecorationLine: 'underline' },
});
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
```

Expected: green (the `/verify-email-pending` route is added in Task 24; stub it first).

- [ ] **Step 3: Stub `/verify-email-pending` if not yet present**

```typescript
// apps/mobile/app/verify-email-pending.tsx
export default function VerifyPending() {
  return null;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add signup screen"
```

---

## ✅ Task 24: Mobile verify-email-pending screen (roadmap 1.10)

**Files:**

- Modify: `apps/mobile/app/verify-email-pending.tsx` (replace stub)

- [ ] **Step 1: Replace stub**

```typescript
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { resendVerifyRequest } from '~/api/auth';
import { useAuth } from '~/auth/context';
import { Button } from '~/components/Button';
import { authCopy } from '~/copy/auth';
import { theme } from '~/theme';

export default function VerifyEmailPendingScreen() {
  const { user, logout, refreshUser } = useAuth();
  const [pending, setPending] = useState(false);

  const onResend = async () => {
    if (!user) return;
    setPending(true);
    try {
      await resendVerifyRequest({ email: user.email });
      Alert.alert(authCopy.verifyPending.resent);
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{authCopy.verifyPending.title}</Text>
      <Text style={styles.body}>{user ? authCopy.verifyPending.body(user.email) : ''}</Text>
      <Button label={pending ? authCopy.common.loading : authCopy.verifyPending.resend} onPress={() => void onResend()} />
      <Button label={authCopy.common.cancel} onPress={() => void logout()} />
      <Button label={authCopy.common.continue} onPress={() => void refreshUser()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, padding: theme.spacing.xl, gap: theme.spacing.md, justifyContent: 'center' },
  title: { color: theme.colors.fg, fontSize: theme.font.size.xxl, fontWeight: '700' },
  body: { color: theme.colors.muted, fontSize: theme.font.size.md },
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
git add apps/mobile/app/verify-email-pending.tsx
git commit -m "feat(mobile): add verify-email-pending screen with resend"
```

---

## ✅ Task 25: Mobile forgot + reset password screens (roadmap 1.10)

**Files:**

- Modify: `apps/mobile/app/(auth)/forgot.tsx` (replace stub)
- Create: `apps/mobile/app/reset-password.tsx`

- [ ] **Step 1: Replace `forgot.tsx` stub**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { forgotPasswordSchema, type ForgotPasswordInput } from '@jdm/shared/auth';

import { forgotPasswordRequest } from '~/api/auth';
import { Button } from '~/components/Button';
import { TextField } from '~/components/TextField';
import { authCopy } from '~/copy/auth';
import { theme } from '~/theme';

export default function ForgotScreen() {
  const [sent, setSent] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    await forgotPasswordRequest(values);
    setSent(true);
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{authCopy.forgot.title}</Text>
      {!sent ? (
        <>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, value } }) => (
              <TextField
                label={authCopy.forgot.email}
                autoCapitalize="none"
                keyboardType="email-address"
                value={value}
                onChangeText={onChange}
                error={errors.email?.message}
              />
            )}
          />
          <Button label={isSubmitting ? authCopy.common.loading : authCopy.forgot.submit} onPress={onSubmit} />
        </>
      ) : (
        <Text style={styles.body}>{authCopy.forgot.sent}</Text>
      )}
      <Link style={styles.link} href="/login">{authCopy.common.back}</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, padding: theme.spacing.xl, gap: theme.spacing.md, justifyContent: 'center' },
  title: { color: theme.colors.fg, fontSize: theme.font.size.xxl, fontWeight: '700' },
  body: { color: theme.colors.fg, fontSize: theme.font.size.md },
  link: { color: theme.colors.fg, fontSize: theme.font.size.md, textDecorationLine: 'underline' },
});
```

- [ ] **Step 2: Create `apps/mobile/app/reset-password.tsx`**

Reset flow arrives via a deep link (`jdm://reset-password?token=…`) pushed from the email. For F1 we accept the token on query params and let the user set a new password.

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { resetPasswordSchema, type ResetPasswordInput } from '@jdm/shared/auth';

import { resetPasswordRequest } from '~/api/auth';
import { Button } from '~/components/Button';
import { TextField } from '~/components/TextField';
import { authCopy } from '~/copy/auth';
import { theme } from '~/theme';

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const [done, setDone] = useState(false);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: token ?? '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await resetPasswordRequest(values);
      setDone(true);
      setTimeout(() => router.replace('/login'), 1_500);
    } catch {
      setError('password', { message: authCopy.errors.unknown });
    }
  });

  if (!token) {
    return (
      <View style={styles.container}>
        <Text style={styles.body}>Link inválido.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nova senha</Text>
      {done ? (
        <Text style={styles.body}>Senha atualizada.</Text>
      ) : (
        <>
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, value } }) => (
              <TextField
                label={authCopy.signup.password}
                secureTextEntry
                value={value}
                onChangeText={onChange}
                error={errors.password?.message}
              />
            )}
          />
          <Button label={isSubmitting ? authCopy.common.loading : authCopy.common.submit} onPress={onSubmit} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, padding: theme.spacing.xl, gap: theme.spacing.md, justifyContent: 'center' },
  title: { color: theme.colors.fg, fontSize: theme.font.size.xxl, fontWeight: '700' },
  body: { color: theme.colors.fg, fontSize: theme.font.size.md },
});
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
git add apps/mobile
git commit -m "feat(mobile): add forgot + reset password screens"
```

---

## Task 26: Mobile Google sign-in (roadmap 1.11)

> note (2026-04-18): deferred to post-MVP, blocked on Task 16. Skip during the mobile chunk.

**Files:**

- Create: `apps/mobile/src/auth/google.ts`
- Modify: `apps/mobile/app/(auth)/login.tsx` (add Google button)
- Modify: `apps/mobile/app/(auth)/signup.tsx` (add Google button)
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.config.ts` (expose Google client IDs via `extra`)

- [ ] **Step 1: Install**

```bash
pnpm --filter @jdm/mobile add expo-auth-session expo-web-browser expo-crypto
```

- [ ] **Step 2: Expose Google client IDs in `apps/mobile/app.config.ts` `extra` block**

Inside `extra`, add:

```typescript
    googleClientIdIos: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS,
    googleClientIdAndroid: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID,
    googleClientIdWeb: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB,
```

- [ ] **Step 3: Create `apps/mobile/src/auth/google.ts`**

```typescript
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';

WebBrowser.maybeCompleteAuthSession();

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleClientIdIos?: string;
  googleClientIdAndroid?: string;
  googleClientIdWeb?: string;
};

export const useGoogleAuth = () => {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: extra.googleClientIdIos,
    androidClientId: extra.googleClientIdAndroid,
    webClientId: extra.googleClientIdWeb,
  });

  const idToken =
    response?.type === 'success' ? (response.params.id_token as string | undefined) : undefined;

  return { promptAsync, request, idToken, response };
};
```

- [ ] **Step 4: Add Google button to `login.tsx`**

Above the closing `</View>`, add:

```typescript
      <GoogleSignInButton onUser={() => router.replace('/welcome')} />
```

Create `apps/mobile/src/components/GoogleSignInButton.tsx`:

```typescript
import { useEffect } from 'react';

import { googleSignInRequest } from '~/api/auth';
import { useAuth } from '~/auth/context';
import { useGoogleAuth } from '~/auth/google';
import { authCopy } from '~/copy/auth';
import { Button } from './Button';

export const GoogleSignInButton = ({ onUser }: { onUser: () => void }) => {
  const { setSession } = useAuth();
  const { promptAsync, request, idToken } = useGoogleAuth();

  useEffect(() => {
    if (!idToken) return;
    const run = async () => {
      const auth = await googleSignInRequest(idToken);
      await setSession(
        { accessToken: auth.accessToken, refreshToken: auth.refreshToken },
        auth.user,
      );
      onUser();
    };
    void run();
  }, [idToken, onUser, setSession]);

  return (
    <Button
      label={authCopy.login.withGoogle}
      disabled={!request}
      onPress={() => void promptAsync()}
    />
  );
};
```

- [ ] **Step 5: Also add the button to `signup.tsx`** at the bottom, passing `onUser={() => router.replace('/welcome')}`.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add Google sign-in via expo-auth-session"
```

---

## Task 27: Mobile Apple sign-in (roadmap 1.12)

> note (2026-04-18): deferred to post-MVP, blocked on Task 17. Skip during the mobile chunk.

**Files:**

- Create: `apps/mobile/src/components/AppleSignInButton.tsx`
- Modify: `apps/mobile/app/(auth)/login.tsx`
- Modify: `apps/mobile/app/(auth)/signup.tsx`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.config.ts` (add the plugin)

- [ ] **Step 1: Install**

```bash
pnpm --filter @jdm/mobile add expo-apple-authentication
```

- [ ] **Step 2: Add the plugin to `apps/mobile/app.config.ts`**

In `plugins`, add `'expo-apple-authentication'`.

- [ ] **Step 3: Create `apps/mobile/src/components/AppleSignInButton.tsx`**

```typescript
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform, StyleSheet } from 'react-native';

import { appleSignInRequest } from '~/api/auth';
import { useAuth } from '~/auth/context';
import { theme } from '~/theme';

export const AppleSignInButton = ({ onUser }: { onUser: () => void }) => {
  const { setSession } = useAuth();

  if (Platform.OS !== 'ios') return null;

  const onPress = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        ],
      });
      if (!credential.identityToken) return;
      const auth = await appleSignInRequest(credential.identityToken, {
        givenName: credential.fullName?.givenName ?? null,
        familyName: credential.fullName?.familyName ?? null,
      });
      await setSession(
        { accessToken: auth.accessToken, refreshToken: auth.refreshToken },
        auth.user,
      );
      onUser();
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
      throw err;
    }
  };

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
      cornerRadius={theme.radius.md}
      style={styles.button}
      onPress={() => void onPress()}
    />
  );
};

const styles = StyleSheet.create({
  button: { height: 48, width: '100%' },
});
```

- [ ] **Step 4: Add the button in both login and signup screens** (under the Google button).

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add Apple sign-in (ios only)"
```

---

## ✅ Task 28: Mobile refresh interceptor + end-to-end smoke (roadmap 1.13 second half)

**Files:**

- Modify: `apps/mobile/src/api/client.ts` (add a request helper that auto-refreshes on 401)
- Modify: `apps/mobile/src/auth/context.tsx` (expose `getAccessToken()` hook used by the interceptor)

- [ ] **Step 1: Add a token-aware request helper to `apps/mobile/src/api/client.ts`**

Append to the file:

```typescript
type TokenProvider = {
  getAccessToken: () => string | null;
  refresh: () => Promise<string>;
  onSignOut: () => Promise<void>;
};

let provider: TokenProvider | null = null;

export const registerTokenProvider = (p: TokenProvider): void => {
  provider = p;
};

export const authedRequest = async <T>(
  path: string,
  schema: import('zod').ZodType<T>,
  options: Omit<RequestOptions, 'token'> = {},
): Promise<T> => {
  if (!provider) throw new Error('token provider not registered');
  const attempt = async (token: string): Promise<Response> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    };
    return fetch(`${baseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  };

  const current = provider.getAccessToken();
  if (!current) throw new ApiError(401, 'no access token');

  let response = await attempt(current);
  if (response.status === 401) {
    try {
      const refreshed = await provider.refresh();
      response = await attempt(refreshed);
    } catch {
      await provider.onSignOut();
      throw new ApiError(401, 'session expired');
    }
  }
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, 'request failed', parsed);
  return schema.parse(parsed);
};
```

- [ ] **Step 2: Register the provider inside `AuthProvider` boot**

In `apps/mobile/src/auth/context.tsx`, after setting state in `boot()`, wire the provider:

```typescript
import { registerTokenProvider } from '~/api/client';

// inside AuthProvider, in a useEffect that depends on [state.tokens]:
useEffect(() => {
  registerTokenProvider({
    getAccessToken: () => state.tokens?.accessToken ?? null,
    refresh: async () => {
      if (!state.tokens) throw new Error('no refresh token');
      const refreshed = await refreshRequest(state.tokens.refreshToken);
      await applySession(
        { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken },
        refreshed.user,
      );
      return refreshed.accessToken;
    },
    onSignOut: async () => {
      await clearTokens();
      setState({ status: 'unauthenticated', user: null, tokens: null });
    },
  });
}, [state.tokens, applySession]);
```

- [ ] **Step 3: Update `meRequest` to use the authed helper**

In `apps/mobile/src/api/auth.ts`, add an alternative that uses `authedRequest`:

```typescript
import { authedRequest } from './client';

export const meAuthed = (): Promise<PublicUser> => authedRequest('/me', publicUserSchema);
```

Keep the existing `meRequest(token)` (boot still needs it — it runs before the provider is registered).

- [ ] **Step 4: Typecheck + lint**

```bash
pnpm --filter @jdm/mobile typecheck && pnpm --filter @jdm/mobile lint
```

- [ ] **Step 5: Smoke test the full flow locally**

1. `pnpm dev` at repo root.
2. Open Expo Go (or simulator). Sign up with an email+password. Observe console log `[dev-mail] to=... subject=JDM Experience — verifique seu e-mail`.
3. Copy the token from the dev-mail log into `curl "http://localhost:4000/auth/verify?token=<TOKEN>"`.
4. Back in the app, tap `Continuar` on the verify-email-pending screen. The guard should route to `/welcome`.
5. Force-quit + reopen app. Still logged in — SecureStore restored tokens, `meRequest` succeeded.
6. Wait 16 minutes (or manually shorten access TTL for testing) and call any authed endpoint — the interceptor should refresh transparently.
7. Tap `Sair`. Re-login. Re-test forgot-password by hitting `/auth/forgot-password` via the screen, capturing the dev-mail token, and opening `jdm://reset-password?token=<TOKEN>` via `xcrun simctl openurl booted "jdm://reset-password?token=<TOKEN>"`.

Capture any issues in the handoff doc (not in this plan).

- [ ] **Step 6: Run every workspace test + lint + typecheck**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all green. `apps/api` has ~40+ new tests; others unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): auto-refresh 401s via token provider and wire session restore"
```

---

## Post-implementation checklist (before ticking roadmap boxes)

- [ ] `/auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/verify`, `/auth/resend-verify`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/google`, `/auth/apple`, `/me` all reachable on the deployed API.
- [ ] Resend configured in Railway prod; one test signup produces a real email (DO NOT commit the message — just confirm delivery).
- [ ] Rate-limit test proven in prod by sending 11 rapid logins from the same IP (expect the 11th to 429).
- [ ] EAS preview build installs; sign up → verify (via link) → login on TestFlight.
- [ ] Sentry captures a deliberate 500 from `/debug/boom` on the API and a thrown error on mobile (use the existing dev-only hook).
- [ ] Tick roadmap items 1.1–1.13 only after the deployed checks above pass.

---

## Self-review

**Spec coverage (roadmap 1.1–1.13):**

| Roadmap item                               | Task                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| 1.1 Schema: User/AuthProvider/RefreshToken | Task 1 (also adds VerificationToken + PasswordResetToken needed for 1.5/1.6) |
| 1.2 Signup                                 | Task 8                                                                       |
| 1.3 Login                                  | Task 11                                                                      |
| 1.4 Refresh + logout                       | Tasks 12, 13                                                                 |
| 1.5 Email verification                     | Tasks 9, 10                                                                  |
| 1.6 Password reset                         | Tasks 14, 15                                                                 |
| 1.7 Google sign-in                         | Task 16                                                                      |
| 1.8 Apple sign-in                          | Task 17                                                                      |
| 1.9 Rate limiting                          | Task 18                                                                      |
| 1.10 Mobile auth screens                   | Tasks 22, 23, 24, 25                                                         |
| 1.11 Mobile Google                         | Task 26                                                                      |
| 1.12 Mobile Apple                          | Task 27                                                                      |
| 1.13 Token storage + auto-refresh          | Tasks 19, 28                                                                 |

Cross-cutting bits not on the roadmap but required:

- Shared Zod (Task 2), env extension (Task 3), password hasher (Task 4), token services (Task 5), mailer (Task 6), `authenticate` decorator + `/me` (Task 7), mobile API client rewrite (Task 20), auth context (Task 21).

**Placeholder scan:** No `TBD`, no "implement later", no `// Add error handling here`. Every code step contains the code.

**Type consistency:**

- `UserRoleName` (shared) ↔ `UserRole` (Prisma enum) — distinct by name, but `publicUserSchema.role` uses the string enum `['user','organizer','admin']` which matches the Prisma enum values.
- `StoredTokens` (mobile) ↔ `{ accessToken, refreshToken }` (API response) — matches.
- `authResponseSchema` is the canonical wire shape; used identically in signup/login/refresh/google/apple on both API and mobile.
- `hashRefreshToken(token, env)` signature is consistent between `tokens.ts` and all route handlers.
- `consumeVerificationToken` and `consumePasswordResetToken` both return `{ userId: string } | null` — same shape.

**Known soft spots (track, don't fix in F1):**

- `authedRequest` uses module-scope `provider`. If the app ever runs two Fastify/auth contexts, this breaks — but that's not in scope.
- Google/Apple verifier decorators are added inside route plugins with `hasDecorator` guards so tests can inject a stub before routes register. If a future refactor moves decoration elsewhere, re-check the test helper `withStub` still works.
- No rate-limit backing store (in-memory only). Fine for MVP; swap for Redis under `X.7` observability or when scaling past one API instance.
- No Admin sign-in surface in F1 — a future F7a plan wires the Next.js side.
- `verify-email-pending` screen has a `Continuar` button that calls `refreshUser`. The user isn't actually verified until they clicked the email link; tapping `Continuar` before that won't advance. That's intentional — a poll is overkill for v0.1.
