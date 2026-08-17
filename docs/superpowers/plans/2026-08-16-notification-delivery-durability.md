# Notification Delivery Durability (outbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make transactional push delivery durable and retryable: notifications survive a crash after a state commit (box), and all-error Expo responses stay retryable instead of being marked sent.

**Architecture:** Turn `Notification` into an outbox. Split creation (`enqueueNotification`, tx-aware) from delivery (`deliverNotification`). A cron worker delivers pending rows and retries failures. Box triggers enqueue inside their existing state transactions; other callers keep `sendTransactionalPush` (now retry-safe). Mirrors the existing `BroadcastDelivery` + broadcasts worker.

**Tech Stack:** TypeScript, Fastify, Prisma/Postgres, node-cron, Vitest + Testcontainers, expo-server-sdk.

**Spec:** `docs/superpowers/specs/2026-08-16-notification-delivery-durability-design.md`

## Global Constraints

- `sentAt IS NULL` means "not yet delivered" (outbox pending).
- `deliverNotification` writes `sentAt` ONLY on success: `sent > 0` OR no retryable error (all `ok`/`invalid-token`/zero-token). On `sent === 0 && hasError` it leaves `sentAt` null and bumps `attemptCount`/`lastAttemptAt`/`failureCode`.
- Worker retry cap `MAX_DELIVERY_ATTEMPTS = 5`; retry interval `RETRY_INTERVAL_MS = 60_000`; cron `'* * * * *'`.
- Never touch `Order.status`. Box `order_not_paid` guard and AdminAudit write stay intact.
- Box owner resolved via `membership.garage.userId`.
- Box enqueue happens INSIDE the state transaction; the Fase 5 post-commit sends are removed.
- Copy PT-BR with correct accents (unchanged from Fase 5).
- API tests hit real Postgres via Testcontainers (never mocks). Migrations apply via `prisma migrate deploy` in `apps/api/test/global-setup.ts`.
- Do NOT edit billing files (`stripe-webhook.ts`, the abacatepay ticket path, `settle.ts` ticket/product branches). Billing benefits from the shared worker without edits. Billing's #1 is an accepted residual.
- Do NOT touch mobile or admin-web code.

---

### Task 1: Migration — Notification delivery-state columns + backfill

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (model `Notification`)
- Create: `packages/db/prisma/migrations/20260816000000_notification_delivery_state/migration.sql`
- Test: `apps/api/test/push/notification-columns.test.ts` (Create)

**Interfaces:**

- Consumes: nothing.
- Produces: `Notification.attemptCount: number` (default 0), `Notification.lastAttemptAt: Date | null`, `Notification.failureCode: string | null`; index `[sentAt, attemptCount]`. Historical `sentAt`-null rows backfilled so the new worker never re-delivers them.

- [ ] **Step 1: Edit the Prisma schema**

In `packages/db/prisma/schema.prisma`, in `model Notification`, add three fields after `sentAt` and an index. The model becomes:

```prisma
model Notification {
  id          String    @id @default(cuid())
  userId      String
  kind        String    @db.VarChar(40)
  title       String    @db.VarChar(200)
  body        String    @db.VarChar(500)
  data        Json
  destination Json?
  dedupeKey   String    @db.VarChar(80)
  sentAt      DateTime?
  attemptCount   Int       @default(0)
  lastAttemptAt  DateTime?
  failureCode    String?   @db.VarChar(80)
  readAt      DateTime?
  createdAt   DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, kind, dedupeKey])
  @@index([userId, createdAt])
  @@index([userId, readAt])
  @@index([sentAt, attemptCount])
}
```

- [ ] **Step 2: Write the migration SQL**

Create `packages/db/prisma/migrations/20260816000000_notification_delivery_state/migration.sql`:

```sql
-- Notification becomes a delivery outbox: sentAt IS NULL means "not yet
-- delivered". attemptCount/lastAttemptAt/failureCode let a worker retry
-- transient send failures instead of the row being marked sent on all-error.
ALTER TABLE "Notification" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "failureCode" VARCHAR(80);

-- Close the historical backlog before the delivery worker turns on: any
-- pre-existing row with a null sentAt (e.g. old zero-token notifications)
-- would otherwise be picked up and (re)delivered as a stale push.
UPDATE "Notification" SET "sentAt" = "createdAt" WHERE "sentAt" IS NULL;

CREATE INDEX "Notification_sentAt_attemptCount_idx" ON "Notification"("sentAt", "attemptCount");
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm --filter @ccc/db db:generate`
Expected: success; `attemptCount`/`lastAttemptAt`/`failureCode` now on the `Notification` type.

- [ ] **Step 4: Write the failing test**

Create `apps/api/test/push/notification-columns.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

describe('Notification delivery-state columns', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('defaults attemptCount to 0 and allows null lastAttemptAt/failureCode', async () => {
    const { user } = await createUser({ verified: true });
    const n = await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'box.ready',
        dedupeKey: 'box_1',
        title: 'x',
        body: 'y',
        data: {},
      },
    });
    expect(n.attemptCount).toBe(0);
    expect(n.lastAttemptAt).toBeNull();
    expect(n.failureCode).toBeNull();
    expect(n.sentAt).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ccc/api test -- notification-columns.test.ts`
Expected: PASS (global-setup runs `prisma migrate deploy`, applying the new migration).

Note on the backfill: it is NOT integration-tested. Testcontainers starts an empty DB and runs `migrate deploy` from scratch, so there are never pre-existing `sentAt`-null rows for the `UPDATE` to touch — it is a no-op in CI by construction. The backfill exists to protect a real deploy against an existing prod table; accept it as an untested-but-necessary line (keep the explanatory comment so it survives refactors). The equivalent runtime guarantee — the worker never touches already-`sentAt` rows — is covered by the Task 2 "no-op when already sent" test.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260816000000_notification_delivery_state apps/api/test/push/notification-columns.test.ts
git commit -m "feat(db): notification delivery-state columns + backfill"
```

---

### Task 2: Split transactional push into enqueue + deliver

**Files:**

- Modify: `apps/api/src/services/push/transactional.ts`
- Modify: `apps/api/src/services/push/dev.ts` (add `markError` for tests)
- Test: `apps/api/test/push/transactional.test.ts` (append + update one existing test), `apps/api/test/push/deliver.test.ts` (Create), `apps/api/test/stripe-webhook-push.test.ts` (update one existing assertion)

**Behavior change to reconcile:** zero device tokens is now TERMINAL (`sentAt` is set), where the old code left `sentAt` null. Two existing tests assert the old behavior and MUST be updated (Step 5b). This is a shared-service test update, not a billing-code edit.

**Interfaces:**

- Consumes: Task 1 columns.
- Produces:
  - `enqueueNotification(input: SendTransactionalPushInput, client?: Prisma.TransactionClient | typeof prisma): Promise<{ deduped: true } | { deduped: false; id: string }>`
  - `deliverNotification(notificationId: string, deps: { sender: PushSender; now?: Date }): Promise<{ sent: number; invalidatedTokens: number; delivered: boolean; attemptCount: number }>` (worker passes `now` so `sentAt`/`lastAttemptAt` are deterministic and consistent with the worker's retry-window filter; performs an optimistic compare-and-swap claim on `attemptCount` before sending so concurrent callers never double-deliver; returns the post-claim `attemptCount`)
  - `sendTransactionalPush(input, deps)` — unchanged signature/return.
  - `DevPushSender.markError(token: string)`.

- [ ] **Step 1: Add `markError` to DevPushSender**

In `apps/api/src/services/push/dev.ts`, add an error-token set mirroring `invalidTokens`. The class becomes:

```ts
import type { PushMessage, PushSendOutcome, PushSendResult, PushSender } from './types.js';

export class DevPushSender implements PushSender {
  public readonly captured: PushMessage[] = [];
  private readonly invalidTokens = new Set<string>();
  private readonly errorTokens = new Set<string>();

  markInvalid(token: string): void {
    this.invalidTokens.add(token);
  }

  markError(token: string): void {
    this.errorTokens.add(token);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async send(messages: PushMessage[]): Promise<PushSendResult> {
    const outcomesByToken = new Map<string, PushSendOutcome>();
    for (const m of messages) {
      this.captured.push(m);
      console.log(`[dev-push] to=${m.to} title=${m.title}`);
      let outcome: PushSendOutcome;
      if (this.invalidTokens.has(m.to)) outcome = { kind: 'invalid-token' };
      else if (this.errorTokens.has(m.to)) outcome = { kind: 'error', message: 'dev-error' };
      else outcome = { kind: 'ok' };
      outcomesByToken.set(m.to, outcome);
    }
    return { outcomesByToken };
  }

  clear(): void {
    this.captured.length = 0;
  }
}
```

- [ ] **Step 2: Write the failing deliver tests**

Create `apps/api/test/push/deliver.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { deliverNotification, enqueueNotification } from '../../src/services/push/transactional.js';
import { createUser, resetDatabase } from '../helpers.js';

const seed = async (tokens: string[]) => {
  const { user } = await createUser({ verified: true });
  for (const t of tokens) {
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: t, platform: 'ios' },
    });
  }
  const enq = await enqueueNotification({
    userId: user.id,
    kind: 'box.ready',
    dedupeKey: 'box_1',
    title: 'Caixa confirmada',
    body: 'ok',
    data: { boxId: 'box_1' },
    destination: { kind: 'internal_path', path: '/caixa' },
  });
  if (enq.deduped) throw new Error('unexpected dedupe');
  return { userId: user.id, id: enq.id };
};

describe('deliverNotification', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('marks sentAt on success', async () => {
    const { id } = await seed(['ExponentPushToken[ok11111111]']);
    const sender = new DevPushSender();
    const r = await deliverNotification(id, { sender });
    expect(r).toMatchObject({ sent: 1, delivered: true });
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
  });

  it('leaves sentAt null and bumps attempt on all-error', async () => {
    const { id } = await seed(['ExponentPushToken[err11111111]']);
    const sender = new DevPushSender();
    sender.markError('ExponentPushToken[err11111111]');
    const r = await deliverNotification(id, { sender });
    expect(r.delivered).toBe(false);
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).toBeNull();
    expect(n.attemptCount).toBe(1);
    expect(n.failureCode).toBe('send_error');
    expect(n.lastAttemptAt).not.toBeNull();
  });

  it('is terminal (sentAt set) when all tokens invalid, and deletes them', async () => {
    const { id, userId } = await seed(['ExponentPushToken[bad11111111]']);
    const sender = new DevPushSender();
    sender.markInvalid('ExponentPushToken[bad11111111]');
    const r = await deliverNotification(id, { sender });
    expect(r).toMatchObject({ delivered: true, invalidatedTokens: 1 });
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
    const tokens = await prisma.deviceToken.count({ where: { userId } });
    expect(tokens).toBe(0);
  });

  it('is terminal when the user has no device tokens', async () => {
    const { id } = await seed([]);
    const sender = new DevPushSender();
    const r = await deliverNotification(id, { sender });
    expect(r.delivered).toBe(true);
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
  });

  it('is a no-op when already sent', async () => {
    const { id } = await seed(['ExponentPushToken[ok22222222]']);
    const sender = new DevPushSender();
    await deliverNotification(id, { sender });
    const r = await deliverNotification(id, { sender });
    expect(r.delivered).toBe(true);
  });

  it('delivers only once under concurrent calls (claim wins once)', async () => {
    const { id } = await seed(['ExponentPushToken[ok33333333]']);
    const sender = new DevPushSender();
    // Two concurrent deliveries of the same pending row: the compare-and-swap
    // claim lets exactly one send; the other bails.
    await Promise.all([deliverNotification(id, { sender }), deliverNotification(id, { sender })]);
    expect(sender.captured.length).toBe(1);
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
    expect(n.attemptCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @ccc/api test -- deliver.test.ts`
Expected: FAIL (`enqueueNotification`/`deliverNotification` not exported).

- [ ] **Step 4: Refactor `transactional.ts`**

Rewrite `apps/api/src/services/push/transactional.ts` to this (keeps `SendTransactionalPushInput`/`SendTransactionalPushResult` and `buildPushData` behavior; adds a row-based push-data builder):

```ts
import { prisma } from '@ccc/db';
import type { NotificationDestination } from '@ccc/shared/notifications';
import type { PushKind } from '@ccc/shared/push';
import { Prisma } from '@prisma/client';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';

import type { PushMessage, PushSender } from './types.js';

export type SendTransactionalPushInput = {
  userId: string;
  kind: PushKind;
  dedupeKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  destination?: NotificationDestination;
};

export type SendTransactionalPushResult = {
  deduped: boolean;
  sent: number;
  invalidatedTokens: number;
};

const buildPushDataFromRow = (n: {
  id: string;
  data: Prisma.JsonValue;
  destination: Prisma.JsonValue | null;
}): Record<string, unknown> => ({
  ...((n.data as Record<string, unknown> | null) ?? {}),
  route: 'notifications',
  notificationId: n.id,
  ...(n.destination ? { destination: n.destination } : {}),
});

export const enqueueNotification = async (
  input: SendTransactionalPushInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ deduped: true } | { deduped: false; id: string }> => {
  try {
    const n = await client.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        destination: input.destination
          ? (input.destination as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      select: { id: true },
    });
    return { deduped: false, id: n.id };
  } catch (err) {
    if (isUniqueConstraintError(err)) return { deduped: true };
    throw err;
  }
};

export const deliverNotification = async (
  notificationId: string,
  deps: { sender: PushSender; now?: Date },
): Promise<{
  sent: number;
  invalidatedTokens: number;
  delivered: boolean;
  attemptCount: number;
}> => {
  const now = deps.now ?? new Date();
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.sentAt) {
    return {
      sent: 0,
      invalidatedTokens: 0,
      delivered: true,
      attemptCount: notification?.attemptCount ?? 0,
    };
  }

  // Optimistic claim (compare-and-swap on attemptCount): if two overlapping
  // worker ticks — or a worker tick and an inline sendTransactionalPush — race
  // the same pending row, exactly one claim wins (the DB serialises the
  // updateMany on the row); the loser bails without sending. This is what
  // prevents duplicate Expo pushes. attemptCount is incremented HERE (once per
  // real attempt), so the failure branch below no longer increments it.
  const claim = await prisma.notification.updateMany({
    where: { id: notificationId, sentAt: null, attemptCount: notification.attemptCount },
    data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
  });
  if (claim.count === 0) {
    return {
      sent: 0,
      invalidatedTokens: 0,
      delivered: true,
      attemptCount: notification.attemptCount,
    };
  }
  const attemptCount = notification.attemptCount + 1;

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: notification.userId },
    select: { expoPushToken: true },
  });
  if (tokens.length === 0) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { sentAt: now },
    });
    return { sent: 0, invalidatedTokens: 0, delivered: true, attemptCount };
  }

  const pushData = buildPushDataFromRow(notification);
  const result = await deps.sender.send(
    tokens.map((t) => {
      const message: PushMessage = {
        to: t.expoPushToken,
        title: notification.title,
        body: notification.body,
        data: pushData,
      };
      return message;
    }),
  );

  let sent = 0;
  const invalid: string[] = [];
  let hasError = false;
  for (const [token, outcome] of result.outcomesByToken) {
    if (outcome.kind === 'ok') sent += 1;
    else if (outcome.kind === 'invalid-token') invalid.push(token);
    else hasError = true;
  }

  if (invalid.length > 0) {
    await prisma.deviceToken.deleteMany({
      where: { userId: notification.userId, expoPushToken: { in: invalid } },
    });
  }

  if (sent > 0 || !hasError) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { sentAt: now },
    });
    return { sent, invalidatedTokens: invalid.length, delivered: true, attemptCount };
  }

  await prisma.notification.update({
    where: { id: notification.id },
    data: { failureCode: 'send_error' },
  });
  return { sent, invalidatedTokens: invalid.length, delivered: false, attemptCount };
};

export const sendTransactionalPush = async (
  input: SendTransactionalPushInput,
  deps: { sender: PushSender },
): Promise<SendTransactionalPushResult> => {
  const enq = await enqueueNotification(input);
  if (enq.deduped) return { deduped: true, sent: 0, invalidatedTokens: 0 };
  const d = await deliverNotification(enq.id, deps);
  return { deduped: false, sent: d.sent, invalidatedTokens: d.invalidatedTokens };
};
```

- [ ] **Step 5: Append the #2 regression test**

Append to `apps/api/test/push/transactional.test.ts` (reuse the file's existing helpers/imports; add `DevPushSender` import if missing):

```ts
it('does not mark sentAt when every token errors (retryable)', async () => {
  const { user } = await createUser({ verified: true });
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: 'ExponentPushToken[erra1111111]', platform: 'ios' },
  });
  const sender = new DevPushSender();
  sender.markError('ExponentPushToken[erra1111111]');
  const r = await sendTransactionalPush(
    { userId: user.id, kind: 'broadcast', dedupeKey: 'd1', title: 't', body: 'b' },
    { sender },
  );
  expect(r.sent).toBe(0);
  const n = await prisma.notification.findFirstOrThrow({
    where: { userId: user.id, kind: 'broadcast' },
  });
  expect(n.sentAt).toBeNull();
  expect(n.attemptCount).toBe(1);
});
```

- [ ] **Step 5b: Update the two existing tests that assert the old zero-token behavior**

These currently assert `sentAt` stays null with zero tokens; the new terminal behavior sets it. Update both:

- `apps/api/test/push/transactional.test.ts` — in the test "skips delivery when user has zero tokens but still records the row", change `expect(rows[0]?.sentAt).toBeNull();` to `expect(rows[0]?.sentAt).not.toBeNull();`.
- `apps/api/test/stripe-webhook-push.test.ts` — in the test "does not block ticket issuance if user has no device tokens", change `expect(notif.sentAt).toBeNull();` to `expect(notif.sentAt).not.toBeNull();` and update the adjacent comment (`// Notification row IS written even with no tokens; delivery is terminal (no tokens to push), so sentAt is set.`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @ccc/api test -- deliver.test.ts transactional.test.ts stripe-webhook-push.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/push/transactional.ts apps/api/src/services/push/dev.ts apps/api/test/push/deliver.test.ts apps/api/test/push/transactional.test.ts apps/api/test/stripe-webhook-push.test.ts
git commit -m "feat(push): split enqueue/deliver, retry-safe sentAt"
```

---

### Task 3: Notification delivery worker

**Files:**

- Create: `apps/api/src/workers/notification-delivery.ts`
- Modify: `apps/api/src/app.ts` (register worker)
- Test: `apps/api/test/workers/notification-delivery.test.ts` (Create)

**Interfaces:**

- Consumes: `deliverNotification` (Task 2), `PushSender`.
- Produces: `runNotificationDeliveryTick(deps: { sender: PushSender; now?: Date; log?: FastifyBaseLogger })`, `startNotificationDeliveryWorker(deps: { sender: PushSender; log: FastifyBaseLogger })`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/workers/notification-delivery.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';
import { enqueueNotification } from '../../src/services/push/transactional.js';
import { runNotificationDeliveryTick } from '../../src/workers/notification-delivery.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedPending = async (token: string) => {
  const { user } = await createUser({ verified: true });
  await prisma.deviceToken.create({
    data: { userId: user.id, expoPushToken: token, platform: 'ios' },
  });
  const enq = await enqueueNotification({
    userId: user.id,
    kind: 'box.ready',
    dedupeKey: `box_${Math.random().toString(36).slice(2, 8)}`,
    title: 'Caixa confirmada',
    body: 'ok',
    data: {},
  });
  if (enq.deduped) throw new Error('dedupe');
  return { userId: user.id, id: enq.id };
};

describe('runNotificationDeliveryTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('delivers a pending notification and sets sentAt', async () => {
    const { id } = await seedPending('ExponentPushToken[wok1111111]');
    const sender = new DevPushSender();
    await runNotificationDeliveryTick({ sender, now: new Date() });
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).not.toBeNull();
    expect(sender.captured.length).toBe(1);
  });

  it('retries an all-error notification on a later tick, then caps at 5', async () => {
    const token = 'ExponentPushToken[werr111111]';
    const { id } = await seedPending(token);
    const sender = new DevPushSender();
    sender.markError(token);
    // 6 ticks, each spaced past RETRY_INTERVAL via the injected now.
    const base = new Date('2026-08-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 6; i += 1) {
      await runNotificationDeliveryTick({ sender, now: new Date(base + i * 61_000) });
    }
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.sentAt).toBeNull();
    expect(n.attemptCount).toBe(5); // capped, not 6
  });

  it('does not retry before the retry interval elapses', async () => {
    const token = 'ExponentPushToken[wint111111]';
    const { id } = await seedPending(token);
    const sender = new DevPushSender();
    sender.markError(token);
    const base = new Date('2026-08-16T00:00:00.000Z').getTime();
    await runNotificationDeliveryTick({ sender, now: new Date(base) });
    await runNotificationDeliveryTick({ sender, now: new Date(base + 10_000) }); // <60s later
    const n = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(n.attemptCount).toBe(1); // second tick skipped it
  });

  it('never delivers non-owned kinds (broadcast, badge_awarded)', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[wign111111]', platform: 'ios' },
    });
    // Rows other writers create with a null sentAt that must NOT be pushed here.
    await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'broadcast',
        dedupeKey: 'bc_1',
        title: 't',
        body: 'b',
        data: {},
      },
    });
    await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'badge_awarded',
        dedupeKey: 'bg_1',
        title: 't',
        body: 'b',
        data: {},
      },
    });
    const sender = new DevPushSender();

    await runNotificationDeliveryTick({ sender, now: new Date() });

    expect(sender.captured.length).toBe(0);
    const rows = await prisma.notification.findMany({
      where: { userId: user.id, kind: { in: ['broadcast', 'badge_awarded'] } },
    });
    expect(rows.every((r) => r.sentAt === null)).toBe(true); // untouched
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @ccc/api test -- notification-delivery.test.ts`
Expected: FAIL (worker module not found).

- [ ] **Step 3: Create the worker**

Create `apps/api/src/workers/notification-delivery.ts`:

```ts
import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { PushSender } from '../services/push/index.js';
import { deliverNotification } from '../services/push/transactional.js';

// Kinds this worker OWNS. CRITICAL: the Notification table is not a
// dedicated outbox — other writers create rows with a null sentAt that must
// NOT be push-delivered here: `broadcast` (delivered via its own
// BroadcastDelivery worker) and `badge_awarded` (inbox-only, push
// deliberately deferred, see services/garage/awarder.ts). A kind-agnostic
// `sentAt IS NULL` scan would wrongly push both. Only these kinds flow
// through enqueueNotification/sendTransactionalPush and want worker delivery.
const DELIVERABLE_KINDS = [
  'box.paid',
  'box.ready',
  'box.shipped',
  'box.delivered',
  'ticket.confirmed',
  'event.reminder_24h',
  'event.reminder_1h',
] as const;

const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 60_000;

export type DeliveryTickDeps = { sender: PushSender; now?: Date; log?: FastifyBaseLogger };

export const runNotificationDeliveryTick = async (deps: DeliveryTickDeps): Promise<void> => {
  const now = deps.now ?? new Date();
  const cutoff = new Date(now.getTime() - RETRY_INTERVAL_MS);

  const pending = await prisma.notification.findMany({
    where: {
      kind: { in: [...DELIVERABLE_KINDS] },
      sentAt: null,
      attemptCount: { lt: MAX_DELIVERY_ATTEMPTS },
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: cutoff } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true },
  });

  for (const n of pending) {
    try {
      const r = await deliverNotification(n.id, { sender: deps.sender, now });
      if (!r.delivered && r.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
        // Exhausted retries: the inbox row survives, but the push is abandoned.
        // Surface it — the whole point of this project is "no silent loss".
        deps.log?.error(
          { notificationId: n.id, attemptCount: r.attemptCount },
          '[notification-delivery] giving up after max attempts',
        );
      }
    } catch (err) {
      deps.log?.error({ err, notificationId: n.id }, '[notification-delivery] deliver failed');
    }
  }
};

export const startNotificationDeliveryWorker = (deps: {
  sender: PushSender;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('* * * * *', () => {
    void runNotificationDeliveryTick({ sender: deps.sender, log: deps.log }).catch(
      (err: unknown) => {
        deps.log.error({ err }, '[notification-delivery] tick error');
      },
    );
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
```

- [ ] **Step 4: Register in app.ts**

In `apps/api/src/app.ts`, add the import near the other worker imports:

```ts
import { startNotificationDeliveryWorker } from './workers/notification-delivery.js';
```

CRITICAL placement: register this INSIDE the existing top-level gate
`if (env.WORKER_ENABLED && env.NODE_ENV === 'production') { ... }` (the same
block that holds `startEventRemindersWorker`), NOT inside the nested
`if (env.GROWTH_PREMIUM_BILLING_ENABLED)` sub-block (this worker serves all
kinds, not just box). Placing it outside the outer gate would spin a live
1/min cron in every `buildApp`/`makeApp` test (NODE_ENV is not `production`
in tests), hitting the test Postgres and racing assertions in unrelated
suites. Add it right after the `startEventRemindersWorker` block:

```ts
const notificationDeliveryWorker = startNotificationDeliveryWorker({
  sender: app.push,
  log: app.log,
});
app.addHook('onClose', () => {
  notificationDeliveryWorker.stop();
});
```

(Match the existing stop/onClose idiom used by `startEventRemindersWorker`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ccc/api test -- notification-delivery.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/notification-delivery.ts apps/api/src/app.ts apps/api/test/workers/notification-delivery.test.ts
git commit -m "feat(push): notification delivery worker (retry until cap)"
```

---

### Task 4: Box box.paid enqueue-in-tx (+ helper) — remove Fase 5 post-commit send

**Files:**

- Modify: `apps/api/src/services/box/notifications.ts` (add `enqueueBoxNotification`; keep `sendBoxPush` until Task 6)
- Modify: `apps/api/src/services/orders/settle.ts` (box branch: enqueue in-tx; revert `paidBox`)
- Modify: `apps/api/src/routes/abacatepay-webhook.ts` (remove box.paid `sendBoxPush` block)
- Test: `apps/api/test/box/box-settle.test.ts` (update), `apps/api/test/box/box-webhook.test.ts` (update)

**Interfaces:**

- Consumes: `enqueueNotification` (Task 2), box `COPY` (existing).
- Produces: `enqueueBoxNotification(tx: Prisma.TransactionClient, input: { userId: string; boxId: string; kind: BoxPushKind }): Promise<void>`. `SettledOrderResult` box member reverts to `{ kind: 'box' }`.

- [ ] **Step 1: Add the in-tx helper**

In `apps/api/src/services/box/notifications.ts`, keep `COPY` and `BoxPushKind`. Replace the imports and add `enqueueBoxNotification` (leave `sendBoxPush` in place for now — Tasks 5/6 still use it):

```ts
import type { Prisma } from '@prisma/client';

import type { PushSender } from '../push/index.js';
import { enqueueNotification, sendTransactionalPush } from '../push/transactional.js';
```

Add, below `COPY`:

```ts
// Enqueue a box milestone notification INSIDE a state-change transaction, so
// the inbox row is durable with the transition (a crash cannot lose it). The
// delivery worker sends it. dedupeKey = boxId. Destination lands the member on
// the Caixa screen after opening the inbox item.
export const enqueueBoxNotification = async (
  tx: Prisma.TransactionClient,
  input: { userId: string; boxId: string; kind: BoxPushKind },
): Promise<void> => {
  const copy = COPY[input.kind];
  await enqueueNotification(
    {
      userId: input.userId,
      kind: input.kind,
      dedupeKey: input.boxId,
      title: copy.title,
      body: copy.body,
      data: { boxId: input.boxId },
      destination: { kind: 'internal_path', path: '/caixa' },
    },
    tx,
  );
};
```

(`sendBoxPush` stays unchanged for now.)

- [ ] **Step 2: Update the box.paid tests (write them to the new behavior)**

In `apps/api/test/box/box-settle.test.ts`, replace the Fase 5 `paidBox` assertion test with one asserting the box branch still returns `{ kind: 'box' }` AND enqueues a pending `box.paid` notification:

```ts
it('settles a box order and enqueues a pending box.paid notification', async () => {
  const { user, order, box } = await seedAwaitingBox(2000);
  const result = await settlePaidOrder(order.id, 'bill_paid_1', env);
  expect(result).toEqual({ kind: 'box' });
  const n = await prisma.notification.findFirstOrThrow({
    where: { userId: user.id, kind: 'box.paid' },
  });
  expect(n.dedupeKey).toBe(box.id);
  expect(n.sentAt).toBeNull(); // delivered later by the worker
});
```

In `apps/api/test/box/box-webhook.test.ts`, the box.paid test should still assert a `box.paid` Notification exists after the webhook (it is now created inside settle's tx, `sentAt` null). Keep the existing exact-value assertions (dedupeKey === box.id, title, destination); just add `expect(notif?.sentAt).toBeNull()`.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @ccc/api test -- box-settle.test.ts box-webhook.test.ts`
Expected: FAIL (`result` still has `paidBox`; and/or no notification created in-tx yet).

- [ ] **Step 4: Move the enqueue into settle's box transaction**

In `apps/api/src/services/orders/settle.ts`:

Revert the box member of `SettledOrderResult` to:

```ts
  | { kind: 'box' };
```

Add the import:

```ts
import { enqueueBoxNotification } from '../box/notifications.js';
```

In the box branch, extend the `findFirst` select to include the owner, and enqueue inside the existing `$transaction` after the box `updateMany`, then return `{ kind: 'box' }`:

```ts
const box = await prisma.monthlyBox.findFirst({
  where: { orderId },
  select: {
    id: true,
    garageId: true,
    membership: { select: { garage: { select: { userId: true } } } },
  },
});
if (!box) throw new OrderNotPendingError(orderId, 'cancelled');

await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${box.garageId} FOR UPDATE`;
  const flipped = await tx.order.updateMany({
    where: { id: orderId, status: 'pending' },
    data: { status: 'paid', paidAt: new Date(), providerRef },
  });
  if (flipped.count === 0) {
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    throw new OrderNotPendingError(orderId, current?.status ?? 'unknown');
  }
  await tx.monthlyBox.updateMany({
    where: { id: box.id, status: 'awaiting_payment' },
    data: { status: 'ready' },
  });
  await enqueueBoxNotification(tx, {
    userId: box.membership.garage.userId,
    boxId: box.id,
    kind: 'box.paid',
  });
});
return { kind: 'box' };
```

- [ ] **Step 5: Remove the webhook box.paid send**

In `apps/api/src/routes/abacatepay-webhook.ts`, delete the `if (settled.kind === 'box' && settled.paidBox) { ... sendBoxPush ... }` block added in Fase 5, and remove the now-unused `sendBoxPush` import if this file no longer references it.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @ccc/api test -- box-settle.test.ts box-webhook.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/box/notifications.ts apps/api/src/services/orders/settle.ts apps/api/src/routes/abacatepay-webhook.ts apps/api/test/box/box-settle.test.ts apps/api/test/box/box-webhook.test.ts
git commit -m "feat(box): box.paid enqueue in settle transaction"
```

---

### Task 5: Box box.ready enqueue-in-tx — revert cutoff sender

**Files:**

- Modify: `apps/api/src/workers/box-cutoff.ts` (enqueue in-tx; drop `Deps.sender`)
- Modify: `apps/api/src/app.ts` (revert `startBoxCutoffWorker` to `{ log }`)
- Test: `apps/api/test/box/box-cutoff.test.ts` (update)

**Interfaces:**

- Consumes: `enqueueBoxNotification` (Task 4).
- Produces: `runBoxCutoffTick` no longer takes `sender`; `box.ready` enqueued in-tx on the ready path.

- [ ] **Step 1: Update the cutoff tests to the new behavior**

In `apps/api/test/box/box-cutoff.test.ts`, the box.ready tests should call `runBoxCutoffTick({})` (no sender) and assert a pending `box.ready` notification. Replace the Fase 5 sender-based assertions:

```ts
it('enqueues a pending box.ready when a budget-only box resolves to ready', async () => {
  const { user, box } = await makeBox({
    status: 'open',
    autoSendOptIn: true,
    withItem: true,
    withAddress: true,
    budget: 10000,
  });
  await runBoxCutoffTick({});
  const box2 = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
  expect(box2.status).toBe('ready');
  const n = await prisma.notification.findFirstOrThrow({
    where: { userId: user.id, kind: 'box.ready' },
  });
  expect(n.dedupeKey).toBe(box.id);
  expect(n.sentAt).toBeNull();
});

it('does not enqueue box.ready when a box is skipped', async () => {
  const { user } = await makeBox({ status: 'open', withItem: false });
  await runBoxCutoffTick({});
  const count = await prisma.notification.count({ where: { userId: user.id, kind: 'box.ready' } });
  expect(count).toBe(0);
});
```

Also revert the Fase 5 fix-wave assertion in the "awaiting_payment already-paid" test: it should call `runBoxCutoffTick({})` (no sender) and assert `notification.count({ where: { kind: 'box.ready' } })` is 0 (device-token/sender setup no longer needed).

MUST ALSO: remove the now-unused `import { DevPushSender } from '../../src/services/push/index.js';` from `box-cutoff.test.ts` — no test in the file uses a sender anymore, and `@typescript-eslint/no-unused-vars` is an error (the plan's final `lint` step would fail otherwise).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @ccc/api test -- box-cutoff.test.ts`
Expected: FAIL (`runBoxCutoffTick({})` currently needs sender for the send; notification not enqueued in-tx).

- [ ] **Step 3: Enqueue in-tx, drop the sender**

In `apps/api/src/workers/box-cutoff.ts`:

- Remove `import type { PushSender }` and the `sendBoxPush` import; add `import { enqueueBoxNotification } from '../services/box/notifications.js';`.
- Change `type Deps = { log?: FastifyBaseLogger };` (drop `sender`).
- Replace the whole per-box transaction (the Fase 5 version returns `{ userId } | null` and sends post-commit). The new version enqueues in-tx and the transaction returns `void`; the post-commit `if (notify && deps.sender) { ... sendBoxPush ... }` block is deleted. Keep the outer `for (const { id, garageId } of due)` loop and its `try/catch`. The transaction body becomes:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
  const box = await tx.monthlyBox.findUnique({
    where: { id },
    include: {
      items: true,
      membership: { select: { garage: { select: { userId: true } } } },
    },
  });
  if (!box) return;
  if (box.status !== 'open' && box.status !== 'awaiting_payment') return;

  const hasItems = box.items.some((i) => i.included);
  const userId = box.membership.garage.userId;

  if (box.status === 'open') {
    if (!hasItems || !box.autoSendOptIn || !box.shippingAddressId) {
      await tx.monthlyBox.update({ where: { id }, data: { status: 'skipped' } });
      return;
    }
    const status = await resolveBudgetOnly(tx, id);
    if (status === 'ready') {
      await enqueueBoxNotification(tx, { userId, boxId: id, kind: 'box.ready' });
    }
    return;
  }

  // awaiting_payment: cancel the pending Order unless it already settled.
  if (box.orderId) {
    const cancelled = await tx.order.updateMany({
      where: { id: box.orderId, status: 'pending' },
      data: { status: 'cancelled', fulfillmentStatus: 'cancelled' },
    });
    if (cancelled.count === 0) {
      const ord = await tx.order.findUnique({
        where: { id: box.orderId },
        select: { status: true },
      });
      if (ord?.status === 'paid') {
        // Pix already settled: box.paid fired in settle; leave for the paid
        // path and do not double-resolve/notify here.
        return;
      }
    }
    await tx.monthlyBox.update({ where: { id }, data: { orderId: null } });
    for (const line of box.items.filter((i) => i.included)) {
      await releaseCycleStock(tx, {
        catalogItemId: line.catalogItemId,
        cycleKey: box.cycleKey,
        quantity: line.quantity,
      });
    }
  }

  const status = await resolveBudgetOnly(tx, id);
  if (status === 'ready') {
    await enqueueBoxNotification(tx, { userId, boxId: id, kind: 'box.ready' });
  }
});
```

(Preserve any additional explanatory comments from the current awaiting_payment block that still apply. `box.membership.garage.userId` is already selected — Fase 5 added it.)

- [ ] **Step 4: Revert app.ts wiring**

In `apps/api/src/app.ts`, change back to:

```ts
const boxCutoffWorker = startBoxCutoffWorker({ log: app.log });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ccc/api test -- box-cutoff.test.ts box-cutoff-optin.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/box-cutoff.ts apps/api/src/app.ts apps/api/test/box/box-cutoff.test.ts
git commit -m "feat(box): box.ready enqueue in cutoff transaction"
```

---

### Task 6: Box box.shipped/delivered enqueue-in-tx — remove sendBoxPush

**Files:**

- Modify: `apps/api/src/services/box/fulfillment.ts` (enqueue in advance tx; revert `ok` extra fields)
- Modify: `apps/api/src/routes/admin/box-fulfillment-admin.ts` (remove `sendBoxPush` block)
- Modify: `apps/api/src/services/box/notifications.ts` (remove now-unused `sendBoxPush` + its unused imports)
- Test: `apps/api/test/box/box-fulfillment.test.ts` (update), `apps/api/test/box/box-notifications.test.ts` (rewrite to `enqueueBoxNotification`)

**Interfaces:**

- Consumes: `enqueueBoxNotification` (Task 4).
- Produces: `advanceBoxFulfillment` `ok` result reverts to `{ kind: 'ok'; fulfillmentStatus }`; `box.shipped`/`box.delivered` enqueued in the advance tx; `sendBoxPush` removed.

- [ ] **Step 1: Update the tests to the new behavior**

In `apps/api/test/box/box-fulfillment.test.ts`, advance tests should assert a pending notification is enqueued (not a route-sent push). After advancing to `shipped`/`delivered`, assert `prisma.notification.findFirst({ where: { kind: 'box.shipped' | 'box.delivered' } })` exists with `dedupeKey === boxId` and `sentAt === null`; after `packed`, assert no box notification. The service `ok` result is `{ kind: 'ok', fulfillmentStatus: to }` (no `userId`/`boxId`). Drive via the route (`app.inject`) as the file already does.

MUST ALSO: delete the existing Fase 5 test `it('advanceBoxFulfillment ok result includes userId and boxId', ...)` in this file — Task 6 reverts those fields off the `ok` result, so that `toMatchObject({ ..., userId, boxId })` assertion would fail. Remove the whole `it(...)` block.

In `apps/api/test/box/box-notifications.test.ts`, rewrite the two `sendBoxPush` tests to `enqueueBoxNotification`. Since it needs a tx client, call it via `prisma.$transaction`:

```ts
it('enqueues a pending box notification with copy, destination and boxId dedupe', async () => {
  const { user } = await createUser({ verified: true });
  await prisma.$transaction((tx) =>
    enqueueBoxNotification(tx, { userId: user.id, boxId: 'box_1', kind: 'box.shipped' }),
  );
  const n = await prisma.notification.findFirstOrThrow({
    where: { userId: user.id, kind: 'box.shipped' },
  });
  expect(n.dedupeKey).toBe('box_1');
  expect(n.title).toBe('Caixa enviada');
  expect(n.destination).toEqual({ kind: 'internal_path', path: '/caixa' });
  expect(n.sentAt).toBeNull();
});

it('dedupes a repeated enqueue for the same box and kind', async () => {
  const { user } = await createUser({ verified: true });
  await prisma.$transaction((tx) =>
    enqueueBoxNotification(tx, { userId: user.id, boxId: 'box_1', kind: 'box.ready' }),
  );
  await prisma.$transaction((tx) =>
    enqueueBoxNotification(tx, { userId: user.id, boxId: 'box_1', kind: 'box.ready' }),
  );
  const count = await prisma.notification.count({ where: { userId: user.id, kind: 'box.ready' } });
  expect(count).toBe(1);
});
```

Update the import to `enqueueBoxNotification` and drop `DevPushSender` if unused.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @ccc/api test -- box-fulfillment.test.ts box-notifications.test.ts`
Expected: FAIL.

- [ ] **Step 3: Enqueue in the advance transaction**

In `apps/api/src/services/box/fulfillment.ts`:

- Add `import { enqueueBoxNotification } from './notifications.js';`.
- Revert the `ok` member of `BoxAdvanceResult` to `{ kind: 'ok'; fulfillmentStatus: BoxFulfillmentStatus }` (drop `userId`/`boxId`).
- Keep the `membership.garage.userId` select (Fase 5). Inside the advance `$transaction`, after the `recordAudit` call and still inside the tx, enqueue when advancing to a notifying status:

```ts
await recordAudit(
  {
    actorId: input.actorId,
    action: 'box.fulfillment.advance',
    entityType: 'monthly_box',
    entityId: box.id,
    metadata: { from: predecessor, to: input.to, orderId: box.orderId },
  },
  tx,
);
if (input.to === 'shipped' || input.to === 'delivered') {
  await enqueueBoxNotification(tx, {
    userId: box.membership.garage.userId,
    boxId: box.id,
    kind: `box.${input.to}`,
  });
}
return 'ok';
```

- Revert the final ok return to `return { kind: 'ok', fulfillmentStatus: input.to };`.

- [ ] **Step 4: Remove the route send**

In `apps/api/src/routes/admin/box-fulfillment-admin.ts`, revert `case 'ok':` to:

```ts
      case 'ok':
        return reply.send({ id, fulfillmentStatus: result.fulfillmentStatus });
```

Remove the `sendBoxPush` import.

- [ ] **Step 5: Remove `sendBoxPush`**

In `apps/api/src/services/box/notifications.ts`, delete `sendBoxPush` and the now-unused imports (`PushSender`, `sendTransactionalPush`). Keep `COPY`, `BoxPushKind`, `enqueueBoxNotification` and its imports (`Prisma`, `enqueueNotification`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @ccc/api test -- box-fulfillment.test.ts box-notifications.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/box/fulfillment.ts apps/api/src/routes/admin/box-fulfillment-admin.ts apps/api/src/services/box/notifications.ts apps/api/test/box/box-fulfillment.test.ts apps/api/test/box/box-notifications.test.ts
git commit -m "feat(box): box.shipped/delivered enqueue in advance transaction; drop sendBoxPush"
```

---

## Verificação final (após todas as tasks)

- [ ] `pnpm --filter @ccc/api test` verde (suíte completa; foco em push, box, broadcasts, webhooks).
- [ ] `pnpm --filter @ccc/db db:generate` verde; `pnpm -w typecheck` verde.
- [ ] `pnpm --filter @ccc/api lint` e `pnpm --filter @ccc/db lint` sem erros.
- [ ] Migration sem drift: `pnpm --filter @ccc/db exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code` retorna 0 (schema e migrations em sincronia).
- [ ] Worker registrado DENTRO do gate `WORKER_ENABLED && NODE_ENV === 'production'` (não dispara cron em testes).
- [ ] Nenhuma referência restante a `sendBoxPush` (`grep -rn sendBoxPush apps/api/src`).
- [ ] Worker só entrega os kinds próprios (`grep -n DELIVERABLE_KINDS`); `broadcast` e `badge_awarded` nunca entram na query.
- [ ] Nenhum arquivo de billing (código) editado: `stripe-webhook.ts` e os ramos ticket/product de `settle.ts` intactos (só o teste `stripe-webhook-push.test.ts` teve uma asserção ajustada).

## Nota de atomicidade (achado de review, sem tarefa própria)

A durabilidade in-tx do box (#1) é garantida estruturalmente: `enqueueBoxNotification` roda dentro da mesma `$transaction` da transição de estado, então um rollback descarta a linha junto. Não há teste dedicado de "rollback ⇒ sem linha" porque, sendo o enqueue a última operação de cada transação, não há caminho de produção que aborte depois dele sem injeção de falha artificial. Confia-se na semântica transacional do Postgres; os testes de negativo existentes cobrem "não enfileira no caminho que aborta antes".
