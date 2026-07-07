# JDMA-640: Flip Marketing Push Default to Opt-In

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `User.pushPrefs.marketing` from opt-out (default `true`) to opt-in (default `false`) and migrate all existing rows to `false` until re-consent is collected.

**Architecture:** Prisma schema default flip + data migration for existing rows. Shared Zod storage schema default update. Broadcast targeting already gates on `marketing !== false`, so existing rows flipped to `false` will be excluded from marketing broadcasts. Transactional push is unaffected.

**Tech Stack:** Prisma, Zod, Vitest (real Postgres)

---

### Task 1: Prisma Schema Default + Migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma:49`
- Create: `packages/db/prisma/migrations/<timestamp>_marketing_opt_in/migration.sql` (via `prisma migrate dev`)

- [ ] **Step 1: Update Prisma schema default**

In `packages/db/prisma/schema.prisma`, change line 49 from:

```prisma
pushPrefs Json @default("{\"transactional\":true,\"marketing\":true}")
```

to:

```prisma
pushPrefs Json @default("{\"transactional\":true,\"marketing\":false}")
```

- [ ] **Step 2: Generate Prisma migration**

Run from `packages/db`:

```bash
npx prisma migrate dev --name marketing_opt_in
```

Expected: Creates a migration file. The auto-generated SQL will only change the column default.

- [ ] **Step 3: Add data migration to the generated SQL**

The auto-generated migration will contain the ALTER COLUMN SET DEFAULT. Append this UPDATE statement to the same migration file to flip existing rows:

```sql
-- Flip all existing users' marketing pref to false until re-consent
UPDATE "User"
SET "pushPrefs" = jsonb_set("pushPrefs"::jsonb, '{marketing}', 'false')
WHERE ("pushPrefs"::jsonb ->> 'marketing')::boolean IS DISTINCT FROM false;
```

This is idempotent: re-running on rows already set to `false` is a no-op via `IS DISTINCT FROM`.

- [ ] **Step 4: Apply the migration locally**

```bash
npx prisma migrate dev
```

Expected: Migration applies cleanly.

- [ ] **Step 5: Verify migration worked**

```bash
npx prisma migrate status
```

Expected: All migrations applied, no pending.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): flip pushPrefs.marketing default to false (LGPD opt-in)

Change schema default from marketing=true to marketing=false.
Migrate all existing rows to marketing=false until re-consent.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Update Shared Zod Storage Default

**Files:**

- Modify: `packages/shared/src/broadcasts.ts:98`

- [ ] **Step 1: Change pushPrefsStorageSchema marketing default**

In `packages/shared/src/broadcasts.ts`, line 98, change:

```typescript
  marketing: z.boolean().default(true),
```

to:

```typescript
  marketing: z.boolean().default(false),
```

This schema is used by `normalizePushPrefs` in `apps/api/src/routes/me.ts` to fill missing fields when parsing stored JSON. After this change, if a user's stored `pushPrefs` omits `marketing`, it defaults to `false` (opt-in) rather than `true`.

- [ ] **Step 2: Rebuild shared package**

```bash
cd packages/shared && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/broadcasts.ts
git commit -m "feat(shared): flip pushPrefsStorageSchema marketing default to false

Aligns Zod storage schema with new LGPD opt-in default.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 3: Update Existing Tests + Add Regression Tests

**Files:**

- Modify: `apps/api/test/me/push-preferences.test.ts`

- [ ] **Step 1: Update existing test — new user default is marketing=false**

In `apps/api/test/me/push-preferences.test.ts`, the first test (`returns the current push preferences`) expects `marketing: true`. Change the expectation:

```typescript
it('returns the current push preferences', async () => {
  const { user } = await createUser({ verified: true });
  const env = loadEnv();

  const res = await app.inject({
    method: 'GET',
    url: '/me/push-preferences',
    headers: { authorization: bearer(env, user.id) },
  });

  expect(res.statusCode).toBe(200);
  expect(pushPrefsSchema.parse(res.json())).toEqual({
    transactional: true,
    marketing: false,
  });
});
```

- [ ] **Step 2: Update the "preserves transactional when older rows omit it" test**

This test patches pushPrefs to `{ marketing: false }` then PATCHes marketing to `true`. After the flip, also add a scenario confirming that a row with only `{ marketing: false }` still normalizes transactional to `true`. The existing test already covers this, no change needed.

- [ ] **Step 3: Add regression test — opt-in via PATCH sets marketing=true**

Add this test to confirm users can explicitly opt in:

```typescript
it('allows user to opt into marketing push', async () => {
  const { user } = await createUser({ verified: true });
  const env = loadEnv();

  // New user starts with marketing=false
  const before = await app.inject({
    method: 'GET',
    url: '/me/push-preferences',
    headers: { authorization: bearer(env, user.id) },
  });
  expect(before.json().marketing).toBe(false);

  // Opt in
  const res = await app.inject({
    method: 'PATCH',
    url: '/me/push-preferences',
    headers: { authorization: bearer(env, user.id) },
    payload: { marketing: true },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().marketing).toBe(true);

  // Verify persisted
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { pushPrefs: true },
  });
  expect((row.pushPrefs as { marketing: boolean }).marketing).toBe(true);
});
```

- [ ] **Step 4: Add regression test — migrated user (marketing=false) excluded from broadcast targeting**

```typescript
it('migrated user with marketing=false is excluded from broadcast recipients', async () => {
  const { user } = await createUser({ verified: true });

  // Simulate migrated user: marketing=false + has device token
  await prisma.user.update({
    where: { id: user.id },
    data: { pushPrefs: { transactional: true, marketing: false } },
  });
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: 'ExponentPushToken[mkttest1]', platform: 'ios' },
  });

  const { resolveRecipients } = await import('../../src/services/broadcasts/targets.js');
  const recipients = await resolveRecipients({ kind: 'all' });

  expect(recipients.find((r) => r.userId === user.id)).toBeUndefined();
});
```

- [ ] **Step 5: Add regression test — opted-in user IS included in broadcast targeting**

```typescript
it('user who opted into marketing is included in broadcast recipients', async () => {
  const { user } = await createUser({ verified: true });

  await prisma.user.update({
    where: { id: user.id },
    data: { pushPrefs: { transactional: true, marketing: true } },
  });
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: 'ExponentPushToken[mkttest2]', platform: 'ios' },
  });

  const { resolveRecipients } = await import('../../src/services/broadcasts/targets.js');
  const recipients = await resolveRecipients({ kind: 'all' });

  expect(recipients.find((r) => r.userId === user.id)).toBeDefined();
});
```

- [ ] **Step 6: Run tests**

```bash
cd apps/api && pnpm vitest run test/me/push-preferences.test.ts
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/me/push-preferences.test.ts
git commit -m "test: update push-preferences tests for marketing opt-in default

New user defaults to marketing=false. Add regression tests for opt-in
flow and broadcast targeting exclusion.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: Final Verification

- [ ] **Step 1: Run full push-preferences + broadcast test suite**

```bash
cd apps/api && pnpm vitest run test/me/push-preferences.test.ts test/workers/broadcasts-dispatch.test.ts
```

Expected: All tests pass.

- [ ] **Step 2: Run TypeScript type check**

```bash
cd apps/api && pnpm tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Record outputs in implementation comment**

Post the migration name and test command outputs to the issue thread.
