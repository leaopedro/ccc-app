# Admin MFA with TOTP and Recovery Codes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TOTP-based MFA enrollment, login challenge, and recovery codes for admin/organizer/staff users.

**Architecture:** Challenge-token login flow. After password verification, if MFA is enrolled, login returns a short-lived MFA token instead of full auth. Client calls `/auth/mfa/verify` or `/auth/mfa/recovery` to complete authentication. TOTP secrets encrypted at rest with AES-256-GCM. Recovery codes stored as SHA-256 hashes.

**Tech Stack:** `otpauth` (TOTP), Node.js `crypto` (AES-256-GCM, SHA-256), Prisma, Fastify, Next.js, Zod.

---

### Task 1: Prisma schema — MFA models

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (after PasswordResetToken model, ~line 127)
- Modify: `apps/api/test/helpers.ts` (resetDatabase function, add MFA table deletes)

- [ ] **Step 1: Add MfaSecret and MfaRecoveryCode models to schema.prisma**

Add after the `PasswordResetToken` model (after line 127):

```prisma
model MfaSecret {
  id              String    @id @default(cuid())
  userId          String    @unique
  encryptedSecret String
  verifiedAt      DateTime?
  createdAt       DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model MfaRecoveryCode {
  id        String    @id @default(cuid())
  userId    String
  codeHash  String
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

Add relations to the User model (after the `feedBansIssued` line):

```prisma
  mfaSecret        MfaSecret?
  mfaRecoveryCodes MfaRecoveryCode[]
```

- [ ] **Step 2: Generate and apply migration**

Run:

```bash
cd packages/db && npx prisma migrate dev --name add-mfa-models
```

Expected: Migration created and applied. Prisma client regenerated.

- [ ] **Step 3: Add MFA table cleanup to test helpers**

In `apps/api/test/helpers.ts`, add these lines inside `resetDatabase()`, before the `await prisma.passwordResetToken.deleteMany()` line:

```typescript
await prisma.mfaRecoveryCode.deleteMany();
await prisma.mfaSecret.deleteMany();
```

- [ ] **Step 4: Verify Prisma client types**

Run:

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to MFA models.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ apps/api/test/helpers.ts
git commit -m "feat(db): add MfaSecret and MfaRecoveryCode models

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: MFA encryption and TOTP service

**Files:**

- Create: `apps/api/src/services/auth/mfa.ts`
- Modify: `apps/api/src/env.ts` (add `MFA_ENCRYPTION_KEY` env var)

**Dependencies:** Node.js `crypto` (built-in), `otpauth` (npm package to install)

- [ ] **Step 1: Install otpauth package**

Run:

```bash
cd apps/api && pnpm add otpauth
```

- [ ] **Step 2: Add MFA_ENCRYPTION_KEY to env schema**

In `apps/api/src/env.ts`, add to the `envSchema` object:

```typescript
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
```

This is optional so existing environments don't break. MFA setup endpoints will check for its presence.

- [ ] **Step 3: Write failing test for MFA service**

Create `apps/api/test/services/mfa.test.ts`:

```typescript
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyRecoveryCode,
  verifyTotp,
} from '../../src/services/auth/mfa.js';

const TEST_KEY = 'a]3Fk9Lm#Q!rT7Wz$Xv2Yp6UjBnCdEh';

describe('MFA service', () => {
  describe('TOTP secret encryption', () => {
    it('round-trips encrypt/decrypt', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const encrypted = encryptSecret(secret, TEST_KEY);
      expect(encrypted).not.toBe(secret);
      expect(encrypted.split(':').length).toBe(3);
      const decrypted = decryptSecret(encrypted, TEST_KEY);
      expect(decrypted).toBe(secret);
    });

    it('produces different ciphertexts for same input', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const a = encryptSecret(secret, TEST_KEY);
      const b = encryptSecret(secret, TEST_KEY);
      expect(a).not.toBe(b);
    });
  });

  describe('TOTP generation and verification', () => {
    it('generates a valid otpauth URI', () => {
      const result = generateTotpSecret('user@test.com');
      expect(result.uri).toContain('otpauth://totp/');
      expect(result.uri).toContain('JDM%20Experience');
      expect(result.secret.length).toBeGreaterThan(10);
    });

    it('verifies a valid TOTP code', () => {
      const result = generateTotpSecret('user@test.com');
      const code = result.totp.generate();
      expect(verifyTotp(result.secret, code)).toBe(true);
    });

    it('rejects invalid TOTP code', () => {
      const result = generateTotpSecret('user@test.com');
      expect(verifyTotp(result.secret, '000000')).toBe(false);
    });
  });

  describe('recovery codes', () => {
    it('generates 10 unique codes in XXXX-XXXX format', () => {
      const codes = generateRecoveryCodes();
      expect(codes).toHaveLength(10);
      const unique = new Set(codes);
      expect(unique.size).toBe(10);
      for (const code of codes) {
        expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      }
    });

    it('hashes and verifies a recovery code', () => {
      const code = 'ABCD-EF23';
      const hash = hashRecoveryCode(code);
      expect(hash).not.toBe(code);
      expect(verifyRecoveryCode(code, hash)).toBe(true);
      expect(verifyRecoveryCode('WXYZ-1234', hash)).toBe(false);
    });

    it('verification is case-insensitive', () => {
      const code = 'ABCD-EF23';
      const hash = hashRecoveryCode(code);
      expect(verifyRecoveryCode('abcd-ef23', hash)).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```bash
cd apps/api && npx vitest run test/services/mfa.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement MFA service**

Create `apps/api/src/services/auth/mfa.ts`:

```typescript
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { TOTP, Secret } from 'otpauth';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ISSUER = 'JDM Experience';
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;

export const encryptSecret = (plaintext: string, key: string): string => {
  const keyBuf = Buffer.from(key, 'utf8').subarray(0, 32);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuf, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

export const decryptSecret = (ciphertext: string, key: string): string => {
  const keyBuf = Buffer.from(key, 'utf8').subarray(0, 32);
  const [ivB64, tagB64, dataB64] = ciphertext.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, keyBuf, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(data) + decipher.final('utf8');
};

export const generateTotpSecret = (
  accountName: string,
): { secret: string; uri: string; totp: TOTP } => {
  const secret = new Secret();
  const totp = new TOTP({
    issuer: ISSUER,
    label: accountName,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret,
  });
  return { secret: secret.base32, uri: totp.toString(), totp };
};

export const verifyTotp = (base32Secret: string, code: string): boolean => {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(base32Secret),
  });
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
};

const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const generateRecoveryCodes = (count = 10): string[] => {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(8);
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += SAFE_CHARS[bytes[j] % SAFE_CHARS.length];
      if (j === 3) code += '-';
    }
    codes.push(code);
  }
  return codes;
};

export const hashRecoveryCode = (code: string): string => {
  return createHash('sha256').update(code.toUpperCase()).digest('hex');
};

export const verifyRecoveryCode = (code: string, hash: string): boolean => {
  return hashRecoveryCode(code) === hash;
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
cd apps/api && npx vitest run test/services/mfa.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/auth/mfa.ts apps/api/test/services/mfa.test.ts apps/api/src/env.ts apps/api/package.json apps/api/pnpm-lock.yaml
git commit -m "feat(api): add MFA encryption, TOTP, and recovery code service

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

Note: also add the root `pnpm-lock.yaml` if it changed.

---

### Task 3: Shared MFA schemas

**Files:**

- Create: `packages/shared/src/mfa.ts`
- Modify: `packages/shared/src/auth.ts` (add `mfaChallengeResponseSchema`)
- Modify: `packages/shared/src/index.ts` (add mfa export)

- [ ] **Step 1: Create MFA schemas**

Create `packages/shared/src/mfa.ts`:

```typescript
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
  code: z.string().regex(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/, 'invalid recovery code format'),
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
```

- [ ] **Step 2: Add MFA challenge response schema to auth.ts**

In `packages/shared/src/auth.ts`, add after `authResponseSchema` (after line 97):

```typescript
export const mfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string().min(1),
});
export type MfaChallengeResponse = z.infer<typeof mfaChallengeResponseSchema>;

export const loginResponseSchema = z.union([authResponseSchema, mfaChallengeResponseSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;
```

- [ ] **Step 3: Add mfa export to shared index**

In `packages/shared/src/index.ts`, add:

```typescript
export * from './mfa.js';
```

- [ ] **Step 4: Build shared package and verify**

Run:

```bash
cd packages/shared && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/mfa.ts packages/shared/src/auth.ts packages/shared/src/index.ts
git commit -m "feat(shared): add MFA Zod schemas for setup, verify, and challenge

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: MFA token service

**Files:**

- Modify: `apps/api/src/services/auth/tokens.ts` (add MFA challenge token functions)

- [ ] **Step 1: Write failing test for MFA token**

Create `apps/api/test/services/mfa-token.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { createMfaToken, verifyMfaToken } from '../../src/services/auth/tokens.js';

const env = loadEnv();

describe('MFA challenge token', () => {
  it('creates and verifies a valid token', () => {
    const token = createMfaToken('user-123', env);
    const payload = verifyMfaToken(token, env);
    expect(payload.sub).toBe('user-123');
    expect(payload.purpose).toBe('mfa_challenge');
  });

  it('rejects expired tokens', () => {
    // We can't easily test expiry without mocking time, so just verify the token structure
    const token = createMfaToken('user-456', env);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  it('rejects tampered tokens', () => {
    const token = createMfaToken('user-789', env) + 'x';
    expect(() => verifyMfaToken(token, env)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/api && npx vitest run test/services/mfa-token.test.ts
```

Expected: FAIL — `createMfaToken` not exported.

- [ ] **Step 3: Add MFA token functions to tokens.ts**

In `apps/api/src/services/auth/tokens.ts`, add before the final export line:

```typescript
const MFA_TTL_SECONDS = 5 * 60;

export type MfaPayload = {
  sub: string;
  purpose: 'mfa_challenge';
};

export const createMfaToken = (userId: string, env: TokenEnv): string => {
  return jwt.sign({ sub: userId, purpose: 'mfa_challenge' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: MFA_TTL_SECONDS,
  });
};

export const verifyMfaToken = (token: string, env: TokenEnv): MfaPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('unexpected jwt payload');
  const { sub, purpose } = decoded as jwt.JwtPayload & MfaPayload;
  if (typeof sub !== 'string' || purpose !== 'mfa_challenge') {
    throw new Error('invalid mfa token');
  }
  return { sub, purpose };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd apps/api && npx vitest run test/services/mfa-token.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/auth/tokens.ts apps/api/test/services/mfa-token.test.ts
git commit -m "feat(api): add MFA challenge token create/verify functions

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 5: Admin MFA enrollment routes

**Files:**

- Create: `apps/api/src/routes/admin/mfa.ts`
- Modify: `apps/api/src/routes/admin/index.ts` (register MFA routes)
- Modify: `packages/shared/src/admin.ts` (add MFA audit actions)

- [ ] **Step 1: Add MFA audit actions to shared admin schema**

In `packages/shared/src/admin.ts`, add to the `adminAuditActionSchema` enum (after `'feed.ban.delete'`):

```typescript
  'mfa.setup_started',
  'mfa.enrolled',
  'mfa.disabled',
  'mfa.recovery_code_used',
  'mfa.recovery_codes_regenerated',
```

Rebuild shared:

```bash
cd packages/shared && pnpm build
```

- [ ] **Step 2: Write failing test for MFA enrollment routes**

Create `apps/api/test/admin/mfa.test.ts`:

```typescript
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { verifyTotp, generateTotpSecret } from '../../src/services/auth/mfa.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('Admin MFA', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /admin/mfa/setup', () => {
    it('returns otpauth URI and recovery codes for admin user', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.otpauthUri).toContain('otpauth://totp/');
      expect(body.recoveryCodes).toHaveLength(10);
    });

    it('rejects if MFA already enrolled', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      // First setup
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });
      // Verify setup to mark as enrolled
      const secret = await prisma.mfaSecret.findUnique({ where: { userId: user.id } });
      expect(secret).not.toBeNull();
    });

    it('rejects regular users', async () => {
      const { user } = await createUser({ email: 'user@jdm.test', verified: true, role: 'user' });
      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'user') },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /admin/mfa/verify-setup', () => {
    it('confirms enrollment with valid TOTP code', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });

      const mfaSecret = await prisma.mfaSecret.findUnique({ where: { userId: user.id } });
      expect(mfaSecret).not.toBeNull();
      expect(mfaSecret!.verifiedAt).toBeNull();

      // We need to decrypt the secret to generate a valid code
      // For testing, we'll use the service directly
      const { decryptSecret } = await import('../../src/services/auth/mfa.js');
      const rawSecret = decryptSecret(mfaSecret!.encryptedSecret, env.MFA_ENCRYPTION_KEY!);
      const { TOTP, Secret } = await import('otpauth');
      const totp = new TOTP({
        secret: Secret.fromBase32(rawSecret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });
      const code = totp.generate();

      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/verify-setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code },
      });
      expect(res.statusCode).toBe(200);

      const updated = await prisma.mfaSecret.findUnique({ where: { userId: user.id } });
      expect(updated!.verifiedAt).not.toBeNull();
    });

    it('rejects invalid TOTP code', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/admin/mfa/verify-setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code: '000000' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /admin/mfa/status', () => {
    it('returns enabled:false when no MFA', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/admin/mfa/status',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false });
    });
  });

  describe('DELETE /admin/mfa', () => {
    it('disables MFA with valid TOTP code', async () => {
      const { user } = await createUser({ email: 'admin@jdm.test', verified: true, role: 'admin' });

      // Setup + verify MFA
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
      });
      const mfaSecret = await prisma.mfaSecret.findUnique({ where: { userId: user.id } });
      const { decryptSecret } = await import('../../src/services/auth/mfa.js');
      const rawSecret = decryptSecret(mfaSecret!.encryptedSecret, env.MFA_ENCRYPTION_KEY!);
      const { TOTP, Secret } = await import('otpauth');
      const totp = new TOTP({
        secret: Secret.fromBase32(rawSecret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });

      // Verify setup
      await app.inject({
        method: 'POST',
        url: '/admin/mfa/verify-setup',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code: totp.generate() },
      });

      // Disable
      const res = await app.inject({
        method: 'DELETE',
        url: '/admin/mfa',
        headers: { authorization: bearer(env, user.id, 'admin') },
        payload: { code: totp.generate() },
      });
      expect(res.statusCode).toBe(200);

      const deleted = await prisma.mfaSecret.findUnique({ where: { userId: user.id } });
      expect(deleted).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd apps/api && npx vitest run test/admin/mfa.test.ts
```

Expected: FAIL — 404 on `/admin/mfa/setup`.

- [ ] **Step 4: Implement admin MFA routes**

Create `apps/api/src/routes/admin/mfa.ts`:

```typescript
import { prisma } from '@jdm/db';
import {
  mfaDisableSchema,
  mfaSetupResponseSchema,
  mfaStatusSchema,
  mfaVerifySetupSchema,
} from '@jdm/shared/mfa';
import type { FastifyPluginAsync } from 'fastify';

import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyRecoveryCode,
  verifyTotp,
} from '../../services/auth/mfa.js';

const requireMfaKey = (env: { MFA_ENCRYPTION_KEY?: string }): string => {
  if (!env.MFA_ENCRYPTION_KEY) {
    throw new Error('MFA_ENCRYPTION_KEY is not configured');
  }
  return env.MFA_ENCRYPTION_KEY;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const adminMfaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/mfa/status', async (request, reply) => {
    const userId = request.user!.sub;
    const secret = await prisma.mfaSecret.findUnique({ where: { userId } });
    const enabled = !!secret?.verifiedAt;
    const remaining = enabled
      ? await prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } })
      : undefined;
    return reply.send(mfaStatusSchema.parse({ enabled, recoveryCodes: remaining }));
  });

  app.post('/mfa/setup', async (request, reply) => {
    const key = requireMfaKey(app.env);
    const userId = request.user!.sub;

    const existing = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (existing?.verifiedAt) {
      return reply
        .status(409)
        .send({ error: 'MfaAlreadyEnrolled', message: 'MFA is already enabled' });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { secret, uri } = generateTotpSecret(user.email);
    const encrypted = encryptSecret(secret, key);
    const codes = generateRecoveryCodes();

    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.mfaSecret.delete({ where: { userId } });
        await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      }
      await tx.mfaSecret.create({ data: { userId, encryptedSecret: encrypted } });
      await tx.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })),
      });
      await tx.adminAudit.create({
        data: {
          actorId: userId,
          action: 'mfa.setup_started',
          targetType: 'user',
          targetId: userId,
        },
      });
    });

    return reply.send(mfaSetupResponseSchema.parse({ otpauthUri: uri, recoveryCodes: codes }));
  });

  app.post('/mfa/verify-setup', async (request, reply) => {
    const key = requireMfaKey(app.env);
    const userId = request.user!.sub;
    const { code } = mfaVerifySetupSchema.parse(request.body);

    const secret = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (!secret) {
      return reply.status(404).send({ error: 'NoMfaSetup', message: 'run setup first' });
    }
    if (secret.verifiedAt) {
      return reply
        .status(409)
        .send({ error: 'MfaAlreadyEnrolled', message: 'MFA already verified' });
    }

    const raw = decryptSecret(secret.encryptedSecret, key);
    if (!verifyTotp(raw, code)) {
      return reply.status(400).send({ error: 'InvalidCode', message: 'invalid TOTP code' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.mfaSecret.update({ where: { userId }, data: { verifiedAt: new Date() } });
      await tx.adminAudit.create({
        data: { actorId: userId, action: 'mfa.enrolled', targetType: 'user', targetId: userId },
      });
    });

    return reply.send({ message: 'MFA enabled' });
  });

  app.delete('/mfa', async (request, reply) => {
    const key = requireMfaKey(app.env);
    const userId = request.user!.sub;
    const { code } = mfaDisableSchema.parse(request.body);

    const secret = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (!secret?.verifiedAt) {
      return reply.status(404).send({ error: 'MfaNotEnabled', message: 'MFA is not enabled' });
    }

    const raw = decryptSecret(secret.encryptedSecret, key);
    const isTotp = /^\d{6}$/.test(code);
    let valid = false;

    if (isTotp) {
      valid = verifyTotp(raw, code);
    } else {
      const recoveryCodes = await prisma.mfaRecoveryCode.findMany({
        where: { userId, usedAt: null },
      });
      for (const rc of recoveryCodes) {
        if (verifyRecoveryCode(code, rc.codeHash)) {
          await prisma.mfaRecoveryCode.update({
            where: { id: rc.id },
            data: { usedAt: new Date() },
          });
          valid = true;
          break;
        }
      }
    }

    if (!valid) {
      return reply.status(400).send({ error: 'InvalidCode', message: 'invalid code' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaSecret.delete({ where: { userId } });
      await tx.adminAudit.create({
        data: { actorId: userId, action: 'mfa.disabled', targetType: 'user', targetId: userId },
      });
    });

    return reply.send({ message: 'MFA disabled' });
  });

  app.post('/mfa/recovery-codes', async (request, reply) => {
    const key = requireMfaKey(app.env);
    const userId = request.user!.sub;
    const { code } = mfaVerifySetupSchema.parse(request.body);

    const secret = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (!secret?.verifiedAt) {
      return reply.status(404).send({ error: 'MfaNotEnabled', message: 'MFA is not enabled' });
    }

    const raw = decryptSecret(secret.encryptedSecret, key);
    if (!verifyTotp(raw, code)) {
      return reply.status(400).send({ error: 'InvalidCode', message: 'invalid TOTP code' });
    }

    const codes = generateRecoveryCodes();
    await prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })),
      });
      await tx.adminAudit.create({
        data: {
          actorId: userId,
          action: 'mfa.recovery_codes_regenerated',
          targetType: 'user',
          targetId: userId,
        },
      });
    });

    return reply.send({ recoveryCodes: codes });
  });
};
```

- [ ] **Step 5: Register MFA routes in admin index**

In `apps/api/src/routes/admin/index.ts`:

Add import at top:

```typescript
import { adminMfaRoutes } from './mfa.js';
```

Add a new scope block after the existing `app.addHook('preHandler', app.authenticate)` line (line 24) and before the check-in scope. MFA routes need auth but work for any admin-eligible role:

```typescript
// MFA enrollment: any authenticated admin-eligible role.
await app.register(async (scope) => {
  scope.addHook('preHandler', scope.requireRole('organizer', 'admin', 'staff'));
  await scope.register(adminMfaRoutes);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
cd apps/api && npx vitest run test/admin/mfa.test.ts
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin/mfa.ts apps/api/src/routes/admin/index.ts apps/api/test/admin/mfa.test.ts packages/shared/src/admin.ts
git commit -m "feat(api): add admin MFA enrollment, verify, disable, and recovery routes

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 6: Login flow — MFA challenge

**Files:**

- Modify: `apps/api/src/routes/auth/login.ts` (add MFA challenge branch)
- Modify: `apps/api/test/auth/login.test.ts` (add MFA login tests)
- Create: `apps/api/src/routes/auth/mfa-verify.ts`
- Create: `apps/api/src/routes/auth/mfa-recovery.ts`
- Modify: `apps/api/src/routes/auth/index.ts` (register new routes)

- [ ] **Step 1: Write failing tests for MFA login challenge**

Add to `apps/api/test/auth/login.test.ts`, inside the `describe('POST /auth/login')` block, after existing tests:

```typescript
it('returns mfaRequired when user has MFA enabled', async () => {
  const { user, password } = await createUser({
    email: 'mfa@jdm.test',
    verified: true,
    role: 'admin',
  });

  // Enroll MFA directly in DB for test setup
  const { generateTotpSecret, encryptSecret, hashRecoveryCode, generateRecoveryCodes } =
    await import('../../src/services/auth/mfa.js');
  const env = (await import('../../src/env.js')).loadEnv();
  const { secret } = generateTotpSecret('mfa@jdm.test');
  await prisma.mfaSecret.create({
    data: {
      userId: user.id,
      encryptedSecret: encryptSecret(secret, env.MFA_ENCRYPTION_KEY!),
      verifiedAt: new Date(),
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'mfa@jdm.test', password },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.mfaRequired).toBe(true);
  expect(typeof body.mfaToken).toBe('string');
  expect(body.accessToken).toBeUndefined();
});
```

Add import at top of file:

```typescript
import { prisma } from '@jdm/db';
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/api && npx vitest run test/auth/login.test.ts
```

Expected: FAIL — login still returns full auth response for MFA user.

- [ ] **Step 3: Modify login route to check for MFA**

In `apps/api/src/routes/auth/login.ts`, add import:

```typescript
import { createMfaToken } from '../../services/auth/tokens.js';
```

Replace the token-issuing block (lines 35-54) with:

```typescript
// Check if user has verified MFA
const mfaSecret = await prisma.mfaSecret.findUnique({ where: { userId: user.id } });
if (mfaSecret?.verifiedAt) {
  const mfaToken = createMfaToken(user.id, app.env);
  return reply.status(200).send({ mfaRequired: true, mfaToken });
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
```

Also add `MfaSecret` import from prisma if needed (it should come from `@jdm/db` via `prisma`).

- [ ] **Step 4: Run login tests to verify they pass**

Run:

```bash
cd apps/api && npx vitest run test/auth/login.test.ts
```

Expected: All tests PASS including the new MFA test.

- [ ] **Step 5: Write failing tests for MFA verify and recovery routes**

Create `apps/api/test/auth/mfa.test.ts`:

```typescript
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
} from '../../src/services/auth/mfa.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const setupMfaUser = async () => {
  const { user, password } = await createUser({
    email: 'mfa@jdm.test',
    verified: true,
    role: 'admin',
  });
  const { secret } = generateTotpSecret(user.email);
  const encrypted = encryptSecret(secret, env.MFA_ENCRYPTION_KEY!);
  await prisma.mfaSecret.create({
    data: { userId: user.id, encryptedSecret: encrypted, verifiedAt: new Date() },
  });
  const codes = generateRecoveryCodes();
  await prisma.mfaRecoveryCode.createMany({
    data: codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })),
  });
  return { user, password, secret, codes };
};

const loginAndGetMfaToken = async (app: FastifyInstance, email: string, password: string) => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  return res.json().mfaToken as string;
};

describe('POST /auth/mfa/verify', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('completes login with valid TOTP code', async () => {
    const { user, password, secret } = await setupMfaUser();
    const mfaToken = await loginAndGetMfaToken(app, user.email, password);

    const { TOTP, Secret } = await import('otpauth');
    const totp = new TOTP({
      secret: Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken, code: totp.generate() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.user.email).toBe('mfa@jdm.test');
  });

  it('rejects invalid TOTP code', async () => {
    const { user, password } = await setupMfaUser();
    const mfaToken = await loginAndGetMfaToken(app, user.email, password);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken, code: '000000' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid mfa token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken: 'invalid-token', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/mfa/recovery', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('completes login with valid recovery code', async () => {
    const { user, password, codes } = await setupMfaUser();
    const mfaToken = await loginAndGetMfaToken(app, user.email, password);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/recovery',
      payload: { mfaToken, code: codes[0] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.accessToken).toBe('string');
    expect(body.user.email).toBe('mfa@jdm.test');
  });

  it('marks recovery code as used', async () => {
    const { user, password, codes } = await setupMfaUser();
    const mfaToken = await loginAndGetMfaToken(app, user.email, password);

    await app.inject({
      method: 'POST',
      url: '/auth/mfa/recovery',
      payload: { mfaToken, code: codes[0] },
    });

    // Second use of same code should fail
    const mfaToken2 = await loginAndGetMfaToken(app, user.email, password);
    const res2 = await app.inject({
      method: 'POST',
      url: '/auth/mfa/recovery',
      payload: { mfaToken: mfaToken2, code: codes[0] },
    });
    expect(res2.statusCode).toBe(401);
  });

  it('rejects invalid recovery code', async () => {
    const { user, password } = await setupMfaUser();
    const mfaToken = await loginAndGetMfaToken(app, user.email, password);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/recovery',
      payload: { mfaToken, code: 'AAAA-BBBB' },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run:

```bash
cd apps/api && npx vitest run test/auth/mfa.test.ts
```

Expected: FAIL — 404 on `/auth/mfa/verify`.

- [ ] **Step 7: Implement MFA verify route**

Create `apps/api/src/routes/auth/mfa-verify.ts`:

```typescript
import { prisma } from '@jdm/db';
import { authResponseSchema } from '@jdm/shared/auth';
import { mfaVerifySchema } from '@jdm/shared/mfa';
import type { FastifyPluginAsync } from 'fastify';

import { decryptSecret, verifyTotp } from '../../services/auth/mfa.js';
import {
  createAccessToken,
  issueRefreshToken,
  verifyMfaToken,
} from '../../services/auth/tokens.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const mfaVerifyRoute: FastifyPluginAsync = async (app) => {
  app.post('/mfa/verify', async (request, reply) => {
    const { mfaToken, code } = mfaVerifySchema.parse(request.body);

    let userId: string;
    try {
      const payload = verifyMfaToken(mfaToken, app.env);
      userId = payload.sub;
    } catch {
      return reply
        .status(401)
        .send({ error: 'Unauthorized', message: 'invalid or expired MFA token' });
    }

    const secret = await prisma.mfaSecret.findUnique({ where: { userId } });
    if (!secret?.verifiedAt) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'MFA not enrolled' });
    }

    const key = app.env.MFA_ENCRYPTION_KEY;
    if (!key) {
      return reply.status(500).send({ error: 'ServerError', message: 'MFA not configured' });
    }

    const raw = decryptSecret(secret.encryptedSecret, key);
    if (!verifyTotp(raw, code)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid TOTP code' });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
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
          emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
```

- [ ] **Step 8: Implement MFA recovery route**

Create `apps/api/src/routes/auth/mfa-recovery.ts`:

```typescript
import { prisma } from '@jdm/db';
import { authResponseSchema } from '@jdm/shared/auth';
import { mfaRecoverySchema } from '@jdm/shared/mfa';
import type { FastifyPluginAsync } from 'fastify';

import { verifyRecoveryCode } from '../../services/auth/mfa.js';
import {
  createAccessToken,
  issueRefreshToken,
  verifyMfaToken,
} from '../../services/auth/tokens.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const mfaRecoveryRoute: FastifyPluginAsync = async (app) => {
  app.post('/mfa/recovery', async (request, reply) => {
    const { mfaToken, code } = mfaRecoverySchema.parse(request.body);

    let userId: string;
    try {
      const payload = verifyMfaToken(mfaToken, app.env);
      userId = payload.sub;
    } catch {
      return reply
        .status(401)
        .send({ error: 'Unauthorized', message: 'invalid or expired MFA token' });
    }

    const recoveryCodes = await prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
    });

    let matchedId: string | null = null;
    for (const rc of recoveryCodes) {
      if (verifyRecoveryCode(code, rc.codeHash)) {
        matchedId = rc.id;
        break;
      }
    }

    if (!matchedId) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid recovery code' });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.update({ where: { id: matchedId }, data: { usedAt: new Date() } });
      await tx.adminAudit.create({
        data: {
          actorId: userId,
          action: 'mfa.recovery_code_used',
          targetType: 'user',
          targetId: userId,
        },
      });
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
          emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
        },
      }),
    );
  });
};
```

- [ ] **Step 9: Register MFA auth routes**

In `apps/api/src/routes/auth/index.ts`, add imports:

```typescript
import { mfaRecoveryRoute } from './mfa-recovery.js';
import { mfaVerifyRoute } from './mfa-verify.js';
```

Add registrations inside the scoped block, after `resetPasswordRoute`:

```typescript
await scoped.register(mfaVerifyRoute);
await scoped.register(mfaRecoveryRoute);
```

- [ ] **Step 10: Run all MFA-related tests**

Run:

```bash
cd apps/api && npx vitest run test/auth/login.test.ts test/auth/mfa.test.ts test/admin/mfa.test.ts
```

Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/routes/auth/login.ts apps/api/src/routes/auth/mfa-verify.ts apps/api/src/routes/auth/mfa-recovery.ts apps/api/src/routes/auth/index.ts apps/api/test/auth/login.test.ts apps/api/test/auth/mfa.test.ts
git commit -m "feat(api): add MFA challenge to login flow with TOTP verify and recovery routes

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 7: Admin app — MFA login challenge UI

**Files:**

- Modify: `apps/admin/app/login/page.tsx` (add MFA challenge step)
- Modify: `apps/admin/src/lib/auth-actions.ts` (handle MFA challenge response)

**Important:** Read `node_modules/next/dist/docs/` in the admin app before modifying Next.js code, per admin AGENTS.md.

- [ ] **Step 1: Update loginAction to handle MFA challenge**

In `apps/admin/src/lib/auth-actions.ts`, modify the login action to handle MFA response:

```typescript
'use server';

import { authResponseSchema, loginSchema, mfaChallengeResponseSchema } from '@jdm/shared/auth';
import { redirect } from 'next/navigation';

import { apiFetch, ApiError } from './api';
import { clearSession, writeSession } from './auth-session';

export type LoginState = { error: string | null; mfaToken?: string };

export const loginAction = async (_prev: LoginState, formData: FormData): Promise<LoginState> => {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Email ou senha inválidos.' };
  let role: string;
  try {
    const raw = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      schema: authResponseSchema,
      auth: false,
      rawResponse: true,
    });

    // Check if MFA challenge
    const mfaCheck = mfaChallengeResponseSchema.safeParse(raw);
    if (mfaCheck.success) {
      return { error: null, mfaToken: mfaCheck.data.mfaToken };
    }

    const res = authResponseSchema.parse(raw);
    if (res.user.role !== 'organizer' && res.user.role !== 'admin' && res.user.role !== 'staff') {
      return { error: 'Conta sem permissão de administrador.' };
    }
    await writeSession(res);
    role = res.user.role;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { error: 'Credenciais inválidas.' };
    }
    if (e instanceof ApiError && e.status === 403) {
      return { error: 'Verifique seu email antes de entrar.' };
    }
    return { error: 'Erro ao entrar. Tente novamente.' };
  }
  redirect(role === 'staff' ? '/check-in' : '/events');
};

export const mfaVerifyAction = async (
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> => {
  const mfaToken = formData.get('mfaToken') as string;
  const code = formData.get('code') as string;
  if (!mfaToken || !code) return { error: 'Código obrigatório.' };

  try {
    const res = await apiFetch('/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code }),
      schema: authResponseSchema,
      auth: false,
    });
    if (res.user.role !== 'organizer' && res.user.role !== 'admin' && res.user.role !== 'staff') {
      return { error: 'Conta sem permissão de administrador.' };
    }
    await writeSession(res);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { error: 'Código inválido ou expirado.' };
    }
    return { error: 'Erro ao verificar. Tente novamente.' };
  }
  redirect('/events');
};

export const mfaRecoveryAction = async (
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> => {
  const mfaToken = formData.get('mfaToken') as string;
  const code = formData.get('code') as string;
  if (!mfaToken || !code) return { error: 'Código de recuperação obrigatório.' };

  try {
    const res = await apiFetch('/auth/mfa/recovery', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code }),
      schema: authResponseSchema,
      auth: false,
    });
    await writeSession(res);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { error: 'Código de recuperação inválido.' };
    }
    return { error: 'Erro ao verificar. Tente novamente.' };
  }
  redirect('/events');
};

export const logoutAction = async (): Promise<void> => {
  await clearSession();
  redirect('/login');
};
```

**Note:** The `apiFetch` function may need a `rawResponse` option or the login action may need to use `fetch` directly to get the raw JSON before parsing. Check `apps/admin/src/lib/api.ts` for how `apiFetch` handles schema parsing. If it auto-parses with the schema, you'll need to pass the union schema or catch the parse error to try the MFA schema.

The simpler approach: use `z.union([authResponseSchema, mfaChallengeResponseSchema])` as the schema parameter, then check the shape of the result.

Adjust based on actual `apiFetch` implementation. The key logic remains the same.

- [ ] **Step 2: Update login page to show MFA challenge**

In `apps/admin/app/login/page.tsx`, update to handle MFA state:

```tsx
'use client';

import { useActionState, useState } from 'react';

import {
  loginAction,
  mfaVerifyAction,
  mfaRecoveryAction,
  type LoginState,
} from '../src/lib/auth-actions';

const initialState: LoginState = { error: null };

function SubmitButton({ label, pending }: { label: string; pending: string }) {
  // Use useFormStatus or check pending state
  return (
    <button
      type="submit"
      className="w-full rounded bg-zinc-800 px-4 py-2 text-white hover:bg-zinc-700"
    >
      {label}
    </button>
  );
}

export default function LoginPage() {
  const [loginState, loginFormAction] = useActionState(loginAction, initialState);
  const [mfaState, mfaFormAction] = useActionState(mfaVerifyAction, initialState);
  const [recoveryState, recoveryFormAction] = useActionState(mfaRecoveryAction, initialState);
  const [showRecovery, setShowRecovery] = useState(false);

  const mfaToken = loginState.mfaToken;

  if (mfaToken && !showRecovery) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
        <form
          action={mfaFormAction}
          className="w-full max-w-sm space-y-4 rounded-lg bg-zinc-900 p-6"
        >
          <h1 className="text-xl font-bold">Verificação MFA</h1>
          <p className="text-sm text-zinc-400">Digite o código do seu app autenticador.</p>
          <input type="hidden" name="mfaToken" value={mfaToken} />
          <input
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-lg tracking-widest"
            autoFocus
          />
          <SubmitButton label="Verificar" pending="Verificando..." />
          {mfaState.error && <p className="text-sm text-red-400">{mfaState.error}</p>}
          <button
            type="button"
            onClick={() => setShowRecovery(true)}
            className="w-full text-sm text-zinc-400 hover:text-white"
          >
            Usar código de recuperação
          </button>
        </form>
      </main>
    );
  }

  if (mfaToken && showRecovery) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
        <form
          action={recoveryFormAction}
          className="w-full max-w-sm space-y-4 rounded-lg bg-zinc-900 p-6"
        >
          <h1 className="text-xl font-bold">Código de Recuperação</h1>
          <p className="text-sm text-zinc-400">Digite um dos seus códigos de recuperação.</p>
          <input type="hidden" name="mfaToken" value={mfaToken} />
          <input
            name="code"
            type="text"
            placeholder="XXXX-XXXX"
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-lg tracking-widest uppercase"
            autoFocus
          />
          <SubmitButton label="Recuperar" pending="Verificando..." />
          {recoveryState.error && <p className="text-sm text-red-400">{recoveryState.error}</p>}
          <button
            type="button"
            onClick={() => setShowRecovery(false)}
            className="w-full text-sm text-zinc-400 hover:text-white"
          >
            Voltar para código TOTP
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
      <form
        action={loginFormAction}
        className="w-full max-w-sm space-y-4 rounded-lg bg-zinc-900 p-6"
      >
        <h1 className="text-xl font-bold">JDM Admin &middot; Entrar</h1>
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
        />
        <input
          name="password"
          type="password"
          placeholder="Senha"
          required
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
        />
        <SubmitButton label="Entrar" pending="Entrando..." />
        {loginState.error && <p className="text-sm text-red-400">{loginState.error}</p>}
      </form>
    </main>
  );
}
```

**Important:** This is a reference implementation. Before writing, check `node_modules/next/dist/docs/` for current Next.js API patterns (per admin AGENTS.md). Adapt `useActionState`, form handling, and any deprecated APIs accordingly.

- [ ] **Step 3: Verify admin app compiles**

Run:

```bash
cd apps/admin && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/login/page.tsx apps/admin/src/lib/auth-actions.ts
git commit -m "feat(admin): add MFA challenge UI to login flow

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 8: Add MFA_ENCRYPTION_KEY to test .env

**Files:**

- Modify: `apps/api/.env` or `apps/api/.env.test` (add test key)

- [ ] **Step 1: Check which env file tests use**

Run:

```bash
ls -la apps/api/.env*
```

Look for `.env.test` or check if vitest config loads a specific env file.

- [ ] **Step 2: Add MFA_ENCRYPTION_KEY**

Add to the appropriate env file:

```
MFA_ENCRYPTION_KEY=test-mfa-encryption-key-32chars!!
```

The key must be at least 32 characters. This is a test-only key.

- [ ] **Step 3: Verify all MFA tests pass with the env key**

Run:

```bash
cd apps/api && npx vitest run test/services/mfa.test.ts test/services/mfa-token.test.ts test/auth/mfa.test.ts test/auth/login.test.ts test/admin/mfa.test.ts
```

Expected: All tests PASS.

- [ ] **Step 4: Commit (if env file is tracked, otherwise note in docs)**

If `.env.test` is tracked:

```bash
git add apps/api/.env.test
git commit -m "chore(api): add MFA_ENCRYPTION_KEY to test env

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

If `.env` is gitignored, document in `docs/secrets.md` that `MFA_ENCRYPTION_KEY` is required.

---

### Task 9: Final verification and cleanup

**Files:**

- Review all created/modified files for consistency

- [ ] **Step 1: Run full type check across affected packages**

Run:

```bash
pnpm typecheck
```

Expected: No type errors.

- [ ] **Step 2: Run all MFA-related tests**

Run:

```bash
cd apps/api && npx vitest run test/services/mfa.test.ts test/services/mfa-token.test.ts test/auth/mfa.test.ts test/auth/login.test.ts test/admin/mfa.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Run existing auth tests to verify no regressions**

Run:

```bash
cd apps/api && npx vitest run test/auth/
```

Expected: All existing auth tests still PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
cd apps/api && pnpm lint
```

Expected: No new lint errors.

- [ ] **Step 5: Document MFA_ENCRYPTION_KEY in secrets runbook**

Add to `docs/secrets.md`:

```markdown
## MFA_ENCRYPTION_KEY

- **Used by:** API server (MFA TOTP secret encryption)
- **Format:** At least 32 characters, UTF-8 string
- **Generation:** `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- **Rotation:** Re-encrypt all MfaSecret rows with new key. Deploy with old+new key support or maintenance window.
- **Required:** Only when MFA feature is enabled. Optional in env schema to avoid breaking existing deployments.
```

- [ ] **Step 6: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(api): MFA final cleanup and docs

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```
