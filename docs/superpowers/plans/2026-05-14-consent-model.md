# Consent Model, Service, and Admin Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement LGPD consent capture with Prisma model, user-facing grant/withdraw API, server-side marketing gate, and admin read-only surface.

**Architecture:** New `Consent` model with `ConsentPurpose` and `ConsentChannel` enums. Consent rows are append-only event log: granting creates a row, withdrawing sets `withdrawnAt`. Idempotency on `(userId, purpose, version)` — re-granting same version is a no-op. Admin gets read-only list with cursor pagination. A `hasActiveConsent` service function gates marketing sends.

**Tech Stack:** Prisma 6, Fastify, Zod (`@jdm/shared`), Vitest with real Postgres.

**Worktree:** `/Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649`
**Branch:** `feat/jdma-649-consent-model`

---

## File Map

| Action | Path                                     | Responsibility                                                             |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| Create | `packages/shared/src/consent.ts`         | Zod schemas for consent enums, request/response types                      |
| Modify | `packages/shared/src/index.ts`           | Re-export consent module                                                   |
| Modify | `packages/db/prisma/schema.prisma`       | Add `Consent` model + enums                                                |
| Create | `apps/api/src/services/consent.ts`       | `recordConsent`, `withdrawConsent`, `hasActiveConsent`, `listUserConsents` |
| Create | `apps/api/src/routes/me-consents.ts`     | `POST /me/consents`, `DELETE /me/consents/:purpose`, `GET /me/consents`    |
| Modify | `apps/api/src/routes/admin/index.ts`     | Register admin consent routes                                              |
| Create | `apps/api/src/routes/admin/consents.ts`  | `GET /admin/consents` with cursor pagination                               |
| Modify | `apps/api/test/helpers.ts`               | Add `prisma.consent.deleteMany()` to `resetDatabase`                       |
| Create | `apps/api/test/me/consents.test.ts`      | Tests for user consent routes                                              |
| Create | `apps/api/test/admin/consents.test.ts`   | Tests for admin consent listing                                            |
| Create | `apps/api/test/services/consent.test.ts` | Tests for consent service functions                                        |

---

### Task 1: Prisma Schema — Consent Model and Enums

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add enums and model to schema**

Append after the last model in `schema.prisma`:

```prisma
enum ConsentPurpose {
  privacy_notice
  cookies_analytics
  cookies_marketing
  push_marketing
  email_marketing
  newsletter
}

enum ConsentChannel {
  web_admin
  web_public
  mobile
  email
}

model Consent {
  id          String         @id @default(cuid())
  userId      String?
  purpose     ConsentPurpose
  version     String         @db.VarChar(100)
  givenAt     DateTime       @default(now())
  withdrawnAt DateTime?
  channel     ConsentChannel
  ipAddress   String?        @db.VarChar(45)
  userAgent   String?        @db.VarChar(500)
  evidence    Json

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@unique([userId, purpose, version])
  @@index([userId, purpose])
  @@index([purpose, version])
}
```

Also add `consents Consent[]` to the `User` model's relation list.

- [ ] **Step 2: Generate migration**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx prisma migrate dev --name add_consent_model --create-only
```

Review the generated SQL, then apply:

```bash
npx prisma migrate dev
```

- [ ] **Step 3: Verify Prisma client generation**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx prisma generate
```

Expected: no errors, `Consent` type available in `@prisma/client`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/
git commit -m "feat(db): add Consent model with purpose and channel enums

LGPD consent capture model per §16.A spec. Stores purpose, version,
channel, IP, UA, and evidence snapshot. Unique on (userId, purpose, version)
for idempotent grant.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Shared Zod Schemas

**Files:**

- Create: `packages/shared/src/consent.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create consent schema file**

```typescript
// packages/shared/src/consent.ts
import { z } from 'zod';

export const consentPurposeSchema = z.enum([
  'privacy_notice',
  'cookies_analytics',
  'cookies_marketing',
  'push_marketing',
  'email_marketing',
  'newsletter',
]);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

export const consentChannelSchema = z.enum(['web_admin', 'web_public', 'mobile', 'email']);
export type ConsentChannel = z.infer<typeof consentChannelSchema>;

export const grantConsentBodySchema = z.object({
  purpose: consentPurposeSchema,
  version: z.string().min(1).max(100),
  channel: consentChannelSchema,
  evidence: z.record(z.unknown()),
});
export type GrantConsentBody = z.infer<typeof grantConsentBodySchema>;

export const consentRecordSchema = z.object({
  id: z.string(),
  purpose: consentPurposeSchema,
  version: z.string(),
  givenAt: z.string().datetime(),
  withdrawnAt: z.string().datetime().nullable(),
  channel: consentChannelSchema,
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

export const consentListResponseSchema = z.object({
  items: z.array(consentRecordSchema),
});
export type ConsentListResponse = z.infer<typeof consentListResponseSchema>;

export const adminConsentListQuerySchema = z.object({
  userId: z.string().optional(),
  purpose: consentPurposeSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminConsentListQuery = z.infer<typeof adminConsentListQuerySchema>;

export const adminConsentRecordSchema = consentRecordSchema.extend({
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type AdminConsentRecord = z.infer<typeof adminConsentRecordSchema>;

export const adminConsentListResponseSchema = z.object({
  items: z.array(adminConsentRecordSchema),
  nextCursor: z.string().nullable(),
});
export type AdminConsentListResponse = z.infer<typeof adminConsentListResponseSchema>;
```

- [ ] **Step 2: Add re-export to shared index**

Add to `packages/shared/src/index.ts`:

```typescript
export * from './consent.js';
```

- [ ] **Step 3: Build shared package**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649/packages/shared
pnpm build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add consent Zod schemas

Grant body, consent record, list response, and admin-facing schemas
for the consent API surface.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 3: Consent Service

**Files:**

- Create: `apps/api/src/services/consent.ts`
- Create: `apps/api/test/services/consent.test.ts`
- Modify: `apps/api/test/helpers.ts`

- [ ] **Step 1: Add `consent.deleteMany()` to `resetDatabase` in test helpers**

In `apps/api/test/helpers.ts`, add `await prisma.consent.deleteMany();` at the top of the `resetDatabase` function (before user deletion, since consent has optional FK to user with `onDelete: SetNull`).

- [ ] **Step 2: Write failing tests for consent service**

Create `apps/api/test/services/consent.test.ts`:

```typescript
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  hasActiveConsent,
  listUserConsents,
  recordConsent,
  withdrawConsent,
} from '../../src/services/consent.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('consent service', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    // noop — prisma connection managed globally
  });

  describe('recordConsent', () => {
    it('creates a new consent row', async () => {
      const { user } = await createUser({ verified: true });
      const result = await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1-2026-05-14',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true, text: 'Aceito receber notificações de marketing' },
      });

      expect(result.id).toBeDefined();
      expect(result.purpose).toBe('push_marketing');
      expect(result.version).toBe('v1-2026-05-14');
      expect(result.withdrawnAt).toBeNull();
    });

    it('is idempotent on (userId, purpose, version)', async () => {
      const { user } = await createUser({ verified: true });
      const params = {
        userId: user.id,
        purpose: 'push_marketing' as const,
        version: 'v1-2026-05-14',
        channel: 'mobile' as const,
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      };

      const first = await recordConsent(params);
      const second = await recordConsent(params);
      expect(first.id).toBe(second.id);

      const count = await prisma.consent.count({
        where: { userId: user.id, purpose: 'push_marketing' },
      });
      expect(count).toBe(1);
    });

    it('re-granting after withdrawal clears withdrawnAt', async () => {
      const { user } = await createUser({ verified: true });
      const params = {
        userId: user.id,
        purpose: 'email_marketing' as const,
        version: 'v1',
        channel: 'mobile' as const,
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      };

      await recordConsent(params);
      await withdrawConsent(user.id, 'email_marketing');
      const regranted = await recordConsent(params);
      expect(regranted.withdrawnAt).toBeNull();
    });
  });

  describe('withdrawConsent', () => {
    it('sets withdrawnAt on the active consent row', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });

      const result = await withdrawConsent(user.id, 'push_marketing');
      expect(result).toBe(true);

      const row = await prisma.consent.findFirst({
        where: { userId: user.id, purpose: 'push_marketing' },
      });
      expect(row?.withdrawnAt).not.toBeNull();
    });

    it('returns false when no active consent exists', async () => {
      const { user } = await createUser({ verified: true });
      const result = await withdrawConsent(user.id, 'push_marketing');
      expect(result).toBe(false);
    });
  });

  describe('hasActiveConsent', () => {
    it('returns true when consent is active', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });

      const result = await hasActiveConsent(user.id, 'push_marketing');
      expect(result).toBe(true);
    });

    it('returns false when consent is withdrawn', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });
      await withdrawConsent(user.id, 'push_marketing');

      const result = await hasActiveConsent(user.id, 'push_marketing');
      expect(result).toBe(false);
    });

    it('returns false when no consent row exists', async () => {
      const { user } = await createUser({ verified: true });
      const result = await hasActiveConsent(user.id, 'push_marketing');
      expect(result).toBe(false);
    });
  });

  describe('listUserConsents', () => {
    it('returns all consent records for the user', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });
      await recordConsent({
        userId: user.id,
        purpose: 'email_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });

      const records = await listUserConsents(user.id);
      expect(records).toHaveLength(2);
      expect(records.map((r) => r.purpose).sort()).toEqual(['email_marketing', 'push_marketing']);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx vitest run apps/api/test/services/consent.test.ts
```

Expected: FAIL — module `../../src/services/consent.js` not found.

- [ ] **Step 4: Implement the consent service**

Create `apps/api/src/services/consent.ts`:

```typescript
import { prisma } from '@jdm/db';
import type { ConsentChannel, ConsentPurpose } from '@prisma/client';

type RecordConsentParams = {
  userId: string;
  purpose: ConsentPurpose;
  version: string;
  channel: ConsentChannel;
  ipAddress: string | null;
  userAgent: string | null;
  evidence: Record<string, unknown>;
};

export const recordConsent = async (params: RecordConsentParams) => {
  const { userId, purpose, version, channel, ipAddress, userAgent, evidence } = params;

  return prisma.consent.upsert({
    where: {
      userId_purpose_version: { userId, purpose, version },
    },
    create: {
      userId,
      purpose,
      version,
      channel,
      ipAddress,
      userAgent,
      evidence,
    },
    update: {
      withdrawnAt: null,
      channel,
      ipAddress,
      userAgent,
      evidence,
    },
  });
};

export const withdrawConsent = async (
  userId: string,
  purpose: ConsentPurpose,
): Promise<boolean> => {
  const row = await prisma.consent.findFirst({
    where: { userId, purpose, withdrawnAt: null },
    orderBy: { givenAt: 'desc' },
  });

  if (!row) return false;

  await prisma.consent.update({
    where: { id: row.id },
    data: { withdrawnAt: new Date() },
  });

  return true;
};

export const hasActiveConsent = async (
  userId: string,
  purpose: ConsentPurpose,
): Promise<boolean> => {
  const count = await prisma.consent.count({
    where: { userId, purpose, withdrawnAt: null },
  });
  return count > 0;
};

export const listUserConsents = async (userId: string) => {
  return prisma.consent.findMany({
    where: { userId },
    orderBy: { givenAt: 'desc' },
    select: {
      id: true,
      purpose: true,
      version: true,
      givenAt: true,
      withdrawnAt: true,
      channel: true,
    },
  });
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx vitest run apps/api/test/services/consent.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/consent.ts apps/api/test/services/consent.test.ts apps/api/test/helpers.ts
git commit -m "feat(api): add consent service with record, withdraw, and gate

recordConsent upserts on (userId, purpose, version) for idempotency.
withdrawConsent sets withdrawnAt. hasActiveConsent is the server-side
gate for marketing sends. All tested against real Postgres.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: User Consent Routes

**Files:**

- Create: `apps/api/src/routes/me-consents.ts`
- Create: `apps/api/test/me/consents.test.ts`

- [ ] **Step 1: Write failing tests for consent routes**

Create `apps/api/test/me/consents.test.ts`:

```typescript
import { prisma } from '@jdm/db';
import { consentListResponseSchema, consentRecordSchema } from '@jdm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('/me/consents', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /me/consents', () => {
    it('grants consent and returns the record', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          purpose: 'push_marketing',
          version: 'v1-2026-05-14',
          channel: 'mobile',
          evidence: { checkbox: true, text: 'Aceito marketing push' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = consentRecordSchema.parse(res.json());
      expect(body.purpose).toBe('push_marketing');
      expect(body.withdrawnAt).toBeNull();
    });

    it('is idempotent — same (purpose, version) returns same record', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();
      const payload = {
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        evidence: { checkbox: true },
      };

      const r1 = await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload,
      });
      const r2 = await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload,
      });

      expect(r1.json().id).toBe(r2.json().id);
      const count = await prisma.consent.count({ where: { userId: user.id } });
      expect(count).toBe(1);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/me/consents',
        payload: {
          purpose: 'push_marketing',
          version: 'v1',
          channel: 'mobile',
          evidence: { checkbox: true },
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /me/consents/:purpose', () => {
    it('withdraws an active consent', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          purpose: 'push_marketing',
          version: 'v1',
          channel: 'mobile',
          evidence: { checkbox: true },
        },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/me/consents/push_marketing',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ withdrawn: true });
    });

    it('returns withdrawn: false when no active consent exists', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      const res = await app.inject({
        method: 'DELETE',
        url: '/me/consents/push_marketing',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ withdrawn: false });
    });

    it('rejects invalid purpose', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      const res = await app.inject({
        method: 'DELETE',
        url: '/me/consents/invalid_purpose',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /me/consents', () => {
    it('lists all consents for the authenticated user', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          purpose: 'push_marketing',
          version: 'v1',
          channel: 'mobile',
          evidence: { checkbox: true },
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(200);
      const body = consentListResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0].purpose).toBe('push_marketing');
    });

    it('returns empty list when no consents exist', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      const res = await app.inject({
        method: 'GET',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx vitest run apps/api/test/me/consents.test.ts
```

Expected: FAIL — routes not registered, 404s.

- [ ] **Step 3: Implement the consent routes**

Create `apps/api/src/routes/me-consents.ts`:

```typescript
import rateLimit from '@fastify/rate-limit';
import { consentPurposeSchema, grantConsentBodySchema } from '@jdm/shared';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { listUserConsents, recordConsent, withdrawConsent } from '../services/consent.js';

export const meConsentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/consents', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const records = await listUserConsents(sub);
    return {
      items: records.map((r) => ({
        id: r.id,
        purpose: r.purpose,
        version: r.version,
        givenAt: r.givenAt.toISOString(),
        withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
        channel: r.channel,
      })),
    };
  });

  await app.register(async (scoped) => {
    await scoped.register(rateLimit, { max: 20, timeWindow: '1 minute' });

    scoped.post('/me/consents', { preHandler: [scoped.authenticate] }, async (request) => {
      const { sub } = requireUser(request);
      const body = grantConsentBodySchema.parse(request.body);

      const row = await recordConsent({
        userId: sub,
        purpose: body.purpose,
        version: body.version,
        channel: body.channel,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        evidence: body.evidence,
      });

      return {
        id: row.id,
        purpose: row.purpose,
        version: row.version,
        givenAt: row.givenAt.toISOString(),
        withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
        channel: row.channel,
      };
    });

    scoped.delete(
      '/me/consents/:purpose',
      { preHandler: [scoped.authenticate] },
      async (request, reply) => {
        const { sub } = requireUser(request);
        const { purpose } = request.params as { purpose: string };

        const parsed = consentPurposeSchema.safeParse(purpose);
        if (!parsed.success) {
          return reply
            .status(400)
            .send({ error: 'BadRequest', message: 'Invalid consent purpose' });
        }

        const withdrawn = await withdrawConsent(sub, parsed.data);
        return { withdrawn };
      },
    );
  });
};
```

- [ ] **Step 4: Register routes in app**

Find where routes are registered in the main app file and add `meConsentRoutes`. Check `apps/api/src/app.ts` for the pattern and add:

```typescript
import { meConsentRoutes } from './routes/me-consents.js';
```

And register it alongside other `me-*` routes.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx vitest run apps/api/test/me/consents.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/me-consents.ts apps/api/test/me/consents.test.ts apps/api/src/app.ts
git commit -m "feat(api): add user consent routes — grant, withdraw, list

POST /me/consents records consent idempotently on (userId, purpose, version).
DELETE /me/consents/:purpose sets withdrawnAt. GET /me/consents lists all.
Rate-limited. Captures IP and UA for LGPD evidence trail.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 5: Admin Consent Listing

**Files:**

- Create: `apps/api/src/routes/admin/consents.ts`
- Modify: `apps/api/src/routes/admin/index.ts`
- Create: `apps/api/test/admin/consents.test.ts`

- [ ] **Step 1: Write failing tests for admin consent listing**

Create `apps/api/test/admin/consents.test.ts`:

```typescript
import { prisma } from '@jdm/db';
import { adminConsentListResponseSchema } from '@jdm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { recordConsent } from '../../src/services/consent.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /admin/consents', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists consent records for admins', async () => {
    const { user: admin } = await createUser({
      role: 'admin',
      verified: true,
      email: 'admin@jdm.test',
    });
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    await recordConsent({
      userId: user.id,
      purpose: 'push_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
      evidence: { checkbox: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consents',
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    const body = adminConsentListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0].purpose).toBe('push_marketing');
    expect(body.items[0].userName).toBe('Test User');
    expect(body.items[0].userEmail).toBe('user@jdm.test');
  });

  it('filters by userId', async () => {
    const { user: admin } = await createUser({
      role: 'admin',
      verified: true,
      email: 'admin@jdm.test',
    });
    const { user: u1 } = await createUser({ verified: true, email: 'u1@jdm.test', name: 'U1' });
    const { user: u2 } = await createUser({ verified: true, email: 'u2@jdm.test', name: 'U2' });
    const env = loadEnv();

    await recordConsent({
      userId: u1.id,
      purpose: 'push_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: null,
      userAgent: null,
      evidence: {},
    });
    await recordConsent({
      userId: u2.id,
      purpose: 'push_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: null,
      userAgent: null,
      evidence: {},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/consents?userId=${u1.id}`,
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    const body = adminConsentListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0].userEmail).toBe('u1@jdm.test');
  });

  it('filters by purpose', async () => {
    const { user: admin } = await createUser({
      role: 'admin',
      verified: true,
      email: 'admin@jdm.test',
    });
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    await recordConsent({
      userId: user.id,
      purpose: 'push_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: null,
      userAgent: null,
      evidence: {},
    });
    await recordConsent({
      userId: user.id,
      purpose: 'email_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: null,
      userAgent: null,
      evidence: {},
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consents?purpose=push_marketing',
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });

  it('rejects non-admin users', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consents',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(403);
  });

  it('paginates with cursor', async () => {
    const { user: admin } = await createUser({
      role: 'admin',
      verified: true,
      email: 'admin@jdm.test',
    });
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    for (const p of ['push_marketing', 'email_marketing', 'newsletter'] as const) {
      await recordConsent({
        userId: user.id,
        purpose: p,
        version: 'v1',
        channel: 'mobile',
        ipAddress: null,
        userAgent: null,
        evidence: {},
      });
    }

    const r1 = await app.inject({
      method: 'GET',
      url: '/admin/consents?limit=2',
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(r1.statusCode).toBe(200);
    const page1 = adminConsentListResponseSchema.parse(r1.json());
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const r2 = await app.inject({
      method: 'GET',
      url: `/admin/consents?limit=2&cursor=${page1.nextCursor}`,
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    const page2 = adminConsentListResponseSchema.parse(r2.json());
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx vitest run apps/api/test/admin/consents.test.ts
```

Expected: FAIL — 404 on `/admin/consents`.

- [ ] **Step 3: Implement admin consent route**

Create `apps/api/src/routes/admin/consents.ts`:

```typescript
import { prisma } from '@jdm/db';
import { adminConsentListQuerySchema } from '@jdm/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

const encodeCursor = (row: { givenAt: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ g: row.givenAt.toISOString(), i: row.id })).toString('base64url');

const decodeCursor = (raw: string): { givenAt: Date; id: string } => {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { g: string; i: string };
  return { givenAt: new Date(parsed.g), id: parsed.i };
};

export const adminConsentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/consents', async (request, reply) => {
    const { userId, purpose, cursor, limit } = adminConsentListQuerySchema.parse(request.query);

    const where: Prisma.ConsentWhereInput = {};
    if (userId) where.userId = userId;
    if (purpose) where.purpose = purpose;

    if (cursor) {
      try {
        const { givenAt, id } = decodeCursor(cursor);
        where.AND = [
          {
            OR: [{ givenAt: { lt: givenAt } }, { givenAt, id: { lt: id } }],
          },
        ];
      } catch {
        return reply.status(400).send({ error: 'BadRequest', message: 'invalid cursor' });
      }
    }

    const rows = await prisma.consent.findMany({
      where,
      orderBy: [{ givenAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.user?.name ?? null,
        userEmail: r.user?.email ?? null,
        purpose: r.purpose,
        version: r.version,
        givenAt: r.givenAt.toISOString(),
        withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
        channel: r.channel,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
      })),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  });
};
```

- [ ] **Step 4: Register admin consent route in admin/index.ts**

In `apps/api/src/routes/admin/index.ts`, add import:

```typescript
import { adminConsentRoutes } from './consents.js';
```

Register inside the organizer/admin scope block alongside other admin routes:

```typescript
await scope.register(adminConsentRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx vitest run apps/api/test/admin/consents.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/consents.ts apps/api/src/routes/admin/index.ts apps/api/test/admin/consents.test.ts
git commit -m "feat(api): add admin consent listing with cursor pagination

GET /admin/consents with optional userId and purpose filters.
Includes user name/email, IP, UA for LGPD accountability evidence.
Organizer/admin role required.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 6: Full Test Suite Verification

- [ ] **Step 1: Run all consent-related tests together**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx vitest run apps/api/test/services/consent.test.ts apps/api/test/me/consents.test.ts apps/api/test/admin/consents.test.ts
```

Expected: all 20 tests pass.

- [ ] **Step 2: Run TypeScript check**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx tsc --noEmit -p apps/api/tsconfig.json
```

Expected: no type errors.

- [ ] **Step 3: Run ESLint on changed files**

```bash
cd /Users/pedro/Projects/jdm-experience/.claude/worktrees/jdma-649
npx eslint apps/api/src/services/consent.ts apps/api/src/routes/me-consents.ts apps/api/src/routes/admin/consents.ts packages/shared/src/consent.ts
```

Expected: no errors.
