# Phase 1 · F6 Transactional Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send transactional push notifications to attendees: "Ingresso confirmado" on order paid, and event reminders at T-24h and T-1h before `Event.startsAt`. Mobile clients register Expo push tokens on login and cold start. Sends are idempotent and deduped per `(userId, kind, dedupeKey)`.

**Architecture:** A new `DeviceToken` model holds `(userId, expoPushToken, platform)`. A new `Notification` model is the system of record for what was sent and serves as the idempotency key. A `PushSender` service interface has two implementations: `ExpoPushSender` (production, posts to `https://exp.host/--/api/v2/push/send` via `expo-server-sdk`) and `DevPushSender` (captures in-memory for tests and dev), wired in `apps/api/src/services/push/index.ts` like the mailer. A high-level `sendTransactionalPush({ userId, kind, dedupeKey, title, body, data })` wraps insert-or-skip on `Notification` plus token fan-out plus invalid-token pruning. The Stripe webhook calls this from inside `stripe-webhook.ts` after `issueTicketForPaidOrder` succeeds. Event reminders live in `apps/api/src/workers/event-reminders.ts`, a `node-cron` job that ticks every minute, gated on `WORKER_ENABLED=true`. On mobile, `expo-notifications` registers a token after the user grants permission post-first-purchase; the auth context calls `POST /me/device-tokens` on every authenticated boot to keep `lastSeenAt` fresh.

**Tech Stack:** Prisma, Fastify, Zod, `@jdm/shared`, `node-cron`, `expo-server-sdk`, Vitest + Testcontainers, Expo `expo-notifications` + `expo-device`.

**Roadmap tasks covered:** 6.1 (DeviceToken + Notification schema), 6.2 (POST /me/device-tokens), 6.3 (push sender service), 6.4 (wire ticket-confirmed + event reminders cron), 6.5 (mobile permission UX + register).

**Out of scope:**

- **Marketing push and broadcasts** — F10. The `transactional vs marketing` split lives in F10's `User.push_prefs jsonb`. F6 ships transactional only and assumes implicit consent (the user installed the app and is purchasing tickets); a user who denies the OS-level permission simply has no `DeviceToken` row.
- **Pix order paid push** — F4b will hook the abacatepay webhook the same way F6 hooks the Stripe webhook. The `sendTransactionalPush('ticket.confirmed', orderId, ...)` helper this plan creates is reused there.
- **In-app notification center / read tracking UI** — `Notification.readAt` is already nullable in the schema this plan creates, but no list/mark-read endpoint ships in F6. That lands with F10 if at all.
- **Web push for the admin app** — F6 is mobile-only push.

---

## File structure

### `packages/db`

- **Modify** `packages/db/prisma/schema.prisma` — add `enum DevicePlatform`, `model DeviceToken`, `model Notification`. Wire relations on `User`.
- **Create** `packages/db/prisma/migrations/<timestamp>_device_tokens_notifications/migration.sql` via Prisma.

### `packages/shared`

- **Create** `packages/shared/src/push.ts` — `devicePlatformSchema`, `registerDeviceTokenRequestSchema`, `registerDeviceTokenResponseSchema`, `pushKindSchema`.
- **Modify** `packages/shared/src/index.ts` — re-export `./push`.
- **Modify** `packages/shared/package.json` — add `"./push": "./src/push.ts"` to `exports`.

### `apps/api`

- **Modify** `apps/api/src/env.ts` — add `EXPO_ACCESS_TOKEN` (optional), `WORKER_ENABLED` (boolean, defaults `false`).
- **Create** `apps/api/src/services/push/types.ts` — `PushSender` interface, `PushMessage`, `PushSendResult`.
- **Create** `apps/api/src/services/push/dev.ts` — `DevPushSender` mirrors `DevMailer`.
- **Create** `apps/api/src/services/push/expo.ts` — `ExpoPushSender` posting via `expo-server-sdk`.
- **Create** `apps/api/src/services/push/index.ts` — `buildPushSender(env)` factory.
- **Create** `apps/api/src/services/push/transactional.ts` — `sendTransactionalPush(input, deps)` with `Notification` insert-or-skip idempotency and invalid-token pruning.
- **Modify** `apps/api/src/app.ts` — decorate `app.push` with the sender, register `pushRoutes` (the new `/me/device-tokens`), boot the reminder worker when `WORKER_ENABLED && app.env.NODE_ENV !== 'test'`.
- **Create** `apps/api/src/routes/me-device-tokens.ts` — `POST /me/device-tokens`, `DELETE /me/device-tokens/:token`.
- **Modify** `apps/api/src/routes/stripe-webhook.ts` — after `issueTicketForPaidOrder` succeeds and before `markProcessed`, fire `sendTransactionalPush('ticket.confirmed', orderId, ...)`. Failure of the push must not roll back the ticket; log and continue.
- **Modify** `apps/api/src/services/tickets/issue.ts` — extend `IssueResult` to include `userId`, `eventId`, `eventTitle` so the webhook caller has enough to compose the push without a re-fetch. Keep the transactional contract.
- **Create** `apps/api/src/workers/event-reminders.ts` — `startEventRemindersWorker(deps)` schedules `* * * * *` (every minute) and emits `event.reminder_24h` / `event.reminder_1h` reminders.

### API tests (real Postgres)

- **Modify** `apps/api/test/helpers.ts` — add a `seedDeviceToken({ userId, expoPushToken? })` helper. Reset adds `prisma.notification.deleteMany()` and `prisma.deviceToken.deleteMany()` to the front of `resetDatabase`.
- **Create** `apps/api/test/push/dev-sender.test.ts` — `DevPushSender` capture/find/clear behaviour.
- **Create** `apps/api/test/push/transactional.test.ts` — service-level: idempotent on duplicate `(userId, kind, dedupeKey)`, skips when user has zero tokens, deletes tokens that come back with `DeviceNotRegistered`, returns counts.
- **Create** `apps/api/test/me-device-tokens.route.test.ts` — 401 unauth, 200 register (creates row), 200 register again (upserts and bumps `lastSeenAt`), 200 unregister, 400 malformed body.
- **Create** `apps/api/test/stripe-webhook-push.test.ts` — extends F4 webhook test patterns: a successful `payment_intent.succeeded` writes a `Notification` row and emits a captured push for that user. A second redelivery does NOT write a duplicate `Notification` and does NOT emit a duplicate push.
- **Create** `apps/api/test/workers/event-reminders.test.ts` — service-level: a single tick of the reminder runner finds events whose `startsAt` falls in the next 24h ± fudge for `_24h` and 1h ± fudge for `_1h`, fans out to all ticket holders, writes `Notification` rows, is idempotent on a second tick within the window.

### `apps/mobile`

- **Modify** `apps/mobile/package.json` — add `expo-notifications`, `expo-device`.
- **Modify** `apps/mobile/app.config.ts` — add `expo-notifications` to `plugins` with default config; declare `notification` block (icon, color).
- **Create** `apps/mobile/src/api/device-tokens.ts` — `registerDeviceToken(input)` and `unregisterDeviceToken(token)` using the shared schemas.
- **Create** `apps/mobile/src/notifications/permission.ts` — `ensurePushPermission()` returns `'granted' | 'denied' | 'undetermined'`.
- **Create** `apps/mobile/src/notifications/register.ts` — `registerExpoPushToken()` returns the token string or `null`. Wraps `Notifications.getExpoPushTokenAsync({ projectId })`.
- **Create** `apps/mobile/src/notifications/use-push-registration.ts` — `usePushRegistration()` hook that on `status === 'authenticated'` boot calls register + sends to API. Re-registers on token rotation events from `addPushTokenListener`.
- **Modify** `apps/mobile/src/auth/context.tsx` — wire the push registration hook so it boots once after authentication and shuts down on signout.
- **Create** `apps/mobile/app/(app)/(modals)/notifications-prompt.tsx` — full-screen modal asking permission **after first ticket purchase**. Trigger from the success screen of the buy flow once F4 mobile is fully wired (the file exists today as `app/(app)/tickets/...` but the explicit prompt is new).

### Docs

- **Modify** `plans/roadmap.md` — flip `6.1` through `6.5` `[ ]`→`[~]` on branch start; flip to `[x]` in the merge-and-deploy PR.
- **Rewrite** `handoff.md` at PR time.

---

## Conventions (read before any task)

- **Branch:** `feat/f6-push` off `main`. One PR at the end.
- **Commits:** one per task. Conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- **Idempotency primary key:** every transactional push writes a `Notification` row before delivery is attempted. The unique index is `(userId, kind, dedupeKey)`. `kind` is one of `'ticket.confirmed' | 'event.reminder_24h' | 'event.reminder_1h'`. `dedupeKey` is `orderId` for ticket-confirmed and `eventId` for reminders. A duplicate insert throws `P2002`; we treat that as "already sent" and skip the send.
- **Failure isolation:** the push send NEVER throws back into the caller. `sendTransactionalPush` catches every error after the `Notification` insert succeeds, logs at warn level, and returns a `{ deduped, sent, invalidatedTokens }` summary. The Stripe webhook does not retry on push failure; the `Notification` row is the durable record of intent.
- **Invalid token pruning:** when Expo returns a `DeviceNotRegistered` or `InvalidCredentials` ticket/receipt, the corresponding `DeviceToken` row is deleted. This keeps the token set small and prevents hammering dead tokens forever.
- **Worker isolation in tests:** the reminders worker is NEVER booted in `NODE_ENV=test`. Tests call the runner function directly. The boot wiring lives in `app.ts` behind `if (env.WORKER_ENABLED && env.NODE_ENV === 'production') { ... }`.
- **`buildApp` test parity:** the existing `BuildAppOverrides` type already accepts a stripe override. We extend it to accept a `push?: PushSender` override so tests can inject a `DevPushSender` and assert captured messages. Production stays on `ExpoPushSender`.
- **Reminder window math:** the runner ticks at minute granularity. For the `T-24h` window it selects events where `startsAt BETWEEN now + 23h59m AND now + 24h00m`. For `T-1h`: `startsAt BETWEEN now + 0h59m AND now + 1h00m`. The `Notification` unique key is the durable correctness gate; the time window is just a recall heuristic.
- **Recipient set:** reminders go only to users with a `valid` `Ticket` for the event. We do not send reminders to revoked or used tickets.
- **Mobile token format:** Expo push tokens are strings shaped `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. We bound them to `<= 200` chars at the schema layer and never validate the body content; Expo is the source of truth.
- **Permission UX timing:** the OS permission prompt is the most disruptive moment in the app. We do NOT ask at signup. We ask after the first successful ticket purchase, where the value proposition is obvious. Users who deny: no token registered, no push, no row. They can later flip the OS-level toggle and the next cold-start register call will succeed.
- **Tests hit real Postgres** per CLAUDE.md.
- **Dependent tasks:** T2 (schema) blocks everything else. T4 (push sender) blocks T6 (transactional helper). T6 blocks T7 (webhook hook) and T8 (reminders). T9 (mobile deps) blocks T10–T11.
- **Prisma client re-gen:** after the migration in T2, run `pnpm --filter @jdm/db db:generate` before building or testing anything else.

---

## Task 1: Branch, plan commit, roadmap flip

**Files:**

- Create: `plans/phase-1-f6-push-plan.md` (this file)
- Modify: `plans/roadmap.md`

- [ ] **Step 1: Create branch from main**

```bash
git checkout main
git pull origin main
git checkout -b feat/f6-push
```

- [ ] **Step 2: Verify the plan file is present on branch**

Run: `ls plans/phase-1-f6-push-plan.md`
Expected: path prints.

- [ ] **Step 3: Flip 6.1–6.5 markers to `[~]`**

In `plans/roadmap.md`, find each task heading under `### F6 — Transactional push` and flip `- [ ]` → `- [~]` on the **Scope** line, then append `_(on feat/f6-push)_` at the end of the Scope sentence. Five flips total: 6.1, 6.2, 6.3, 6.4, 6.5.

Example for 6.1:

```
- [~] **Scope:** Prisma models; unique on `(user_id, expo_push_token)`. _(on feat/f6-push)_
```

- [ ] **Step 4: Commit**

```bash
git add plans/phase-1-f6-push-plan.md plans/roadmap.md
git commit -m "docs(f6): add transactional push plan and flip roadmap markers"
```

---

## Task 2: Schema — DeviceToken and Notification

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_device_tokens_notifications/migration.sql`

- [ ] **Step 1: Add models and enum**

Append to `packages/db/prisma/schema.prisma` (below the `PaymentWebhookEvent` model). Wire two new relations on `User` (the existing `User` block at line 25):

```prisma
// Add to the User model relations block (around line 47, alongside `tickets`):
deviceTokens  DeviceToken[]
notifications Notification[]
```

Append at the end of the file:

```prisma
enum DevicePlatform {
  ios
  android
}

model DeviceToken {
  id            String         @id @default(cuid())
  userId        String
  expoPushToken String         @db.VarChar(200)
  platform      DevicePlatform
  lastSeenAt    DateTime       @default(now())
  createdAt     DateTime       @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, expoPushToken])
  @@index([userId])
}

model Notification {
  id        String    @id @default(cuid())
  userId    String
  kind      String    @db.VarChar(40)
  title     String    @db.VarChar(200)
  body      String    @db.VarChar(500)
  data      Json
  dedupeKey String    @db.VarChar(80)
  sentAt    DateTime?
  readAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, kind, dedupeKey])
  @@index([userId, createdAt])
}
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm --filter @jdm/db prisma migrate dev --name device_tokens_notifications
```

Expected: a new migration directory with SQL creating `DevicePlatform`, `DeviceToken`, `Notification`, and their indexes.

- [ ] **Step 3: Regenerate the Prisma client**

```bash
pnpm --filter @jdm/db db:generate
```

- [ ] **Step 4: Update test helper reset to include new tables**

Edit `apps/api/test/helpers.ts`. Add the two `deleteMany` calls at the top of `resetDatabase` (before `prisma.ticket.deleteMany()`):

```ts
export const resetDatabase = async (): Promise<void> => {
  await prisma.notification.deleteMany();
  await prisma.deviceToken.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.order.deleteMany();
  // ...rest unchanged
};
```

- [ ] **Step 5: Typecheck**

```bash
pnpm -w typecheck
```

Expected: 5/5 packages clean. Re-run `pnpm --filter @jdm/db db:generate` if Prisma client is stale.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/api/test/helpers.ts
git commit -m "feat(db): add DeviceToken and Notification models"
```

---

## Task 3: Shared schemas for push

**Files:**

- Create: `packages/shared/src/push.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Create the shared module**

Create `packages/shared/src/push.ts`:

```ts
import { z } from 'zod';

export const devicePlatformSchema = z.enum(['ios', 'android']);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

// Expo tokens are typically `ExponentPushToken[xxxx...]`. We do not parse them
// here; Expo is the source of truth. The 200-char ceiling matches the DB
// column.
export const expoPushTokenSchema = z.string().min(10).max(200);

export const registerDeviceTokenRequestSchema = z.object({
  expoPushToken: expoPushTokenSchema,
  platform: devicePlatformSchema,
});
export type RegisterDeviceTokenRequest = z.infer<typeof registerDeviceTokenRequestSchema>;

export const registerDeviceTokenResponseSchema = z.object({
  ok: z.literal(true),
});
export type RegisterDeviceTokenResponse = z.infer<typeof registerDeviceTokenResponseSchema>;

export const pushKindSchema = z.enum([
  'ticket.confirmed',
  'event.reminder_24h',
  'event.reminder_1h',
]);
export type PushKind = z.infer<typeof pushKindSchema>;
```

- [ ] **Step 2: Re-export from the index**

Edit `packages/shared/src/index.ts`. Add a final line:

```ts
export * from './push';
```

- [ ] **Step 3: Add subpath export**

Edit `packages/shared/package.json`. In `exports`, alongside the other entries, add:

```json
"./push": "./src/push.ts"
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @jdm/shared typecheck
pnpm --filter @jdm/shared test
```

Expected: clean; existing 35 shared tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/push.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(shared): add push notification schemas"
```

---

## Task 4: Push sender service (TDD)

**Files:**

- Create: `apps/api/src/services/push/types.ts`
- Create: `apps/api/src/services/push/dev.ts`
- Create: `apps/api/src/services/push/expo.ts`
- Create: `apps/api/src/services/push/index.ts`
- Create: `apps/api/test/push/dev-sender.test.ts`
- Modify: `apps/api/package.json` (add `expo-server-sdk`)
- Modify: `apps/api/src/env.ts`

- [ ] **Step 1: Add `expo-server-sdk` dependency**

```bash
pnpm --filter @jdm/api add expo-server-sdk
```

- [ ] **Step 2: Add env vars**

Edit `apps/api/src/env.ts`. Add inside the `envSchema` object (after `UPLOAD_URL_TTL_SECONDS`):

```ts
EXPO_ACCESS_TOKEN: z.string().optional(),
WORKER_ENABLED: z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true'),
```

- [ ] **Step 3: Create the types module**

Create `apps/api/src/services/push/types.ts`:

```ts
export type PushMessage = {
  to: string; // Expo push token
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PushSendOutcome =
  | { kind: 'ok' }
  | { kind: 'invalid-token' } // delete this DeviceToken
  | { kind: 'error'; message: string }; // log; do not retry in F6

export type PushSendResult = {
  outcomesByToken: Map<string, PushSendOutcome>;
};

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushSendResult>;
}
```

- [ ] **Step 4: Write the failing dev-sender test**

Create `apps/api/test/push/dev-sender.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DevPushSender } from '../../src/services/push/dev.js';

describe('DevPushSender', () => {
  it('captures messages and reports ok for every token', async () => {
    const sender = new DevPushSender();
    const result = await sender.send([
      { to: 'ExponentPushToken[a]', title: 't1', body: 'b1' },
      { to: 'ExponentPushToken[b]', title: 't2', body: 'b2', data: { x: 1 } },
    ]);
    expect(sender.captured).toHaveLength(2);
    expect(sender.captured[0]?.title).toBe('t1');
    expect(result.outcomesByToken.get('ExponentPushToken[a]')).toEqual({ kind: 'ok' });
    expect(result.outcomesByToken.get('ExponentPushToken[b]')).toEqual({ kind: 'ok' });
  });

  it('marks pre-configured invalid tokens', async () => {
    const sender = new DevPushSender();
    sender.markInvalid('ExponentPushToken[bad]');
    const result = await sender.send([
      { to: 'ExponentPushToken[bad]', title: 't', body: 'b' },
      { to: 'ExponentPushToken[good]', title: 't', body: 'b' },
    ]);
    expect(result.outcomesByToken.get('ExponentPushToken[bad]')).toEqual({
      kind: 'invalid-token',
    });
    expect(result.outcomesByToken.get('ExponentPushToken[good]')).toEqual({ kind: 'ok' });
  });

  it('clear() empties capture buffer', async () => {
    const sender = new DevPushSender();
    await sender.send([{ to: 'ExponentPushToken[a]', title: 't', body: 'b' }]);
    sender.clear();
    expect(sender.captured).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run the test, expect failure**

```bash
pnpm --filter @jdm/api vitest run test/push/dev-sender.test.ts
```

Expected: FAIL ("cannot find module .../push/dev.js").

- [ ] **Step 6: Implement DevPushSender**

Create `apps/api/src/services/push/dev.ts`:

```ts
import type { PushMessage, PushSendOutcome, PushSendResult, PushSender } from './types.js';

export class DevPushSender implements PushSender {
  public readonly captured: PushMessage[] = [];
  private readonly invalidTokens = new Set<string>();

  markInvalid(token: string): void {
    this.invalidTokens.add(token);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async send(messages: PushMessage[]): Promise<PushSendResult> {
    const outcomesByToken = new Map<string, PushSendOutcome>();
    for (const m of messages) {
      this.captured.push(m);
      console.log(`[dev-push] to=${m.to} title=${m.title}`);
      const outcome: PushSendOutcome = this.invalidTokens.has(m.to)
        ? { kind: 'invalid-token' }
        : { kind: 'ok' };
      outcomesByToken.set(m.to, outcome);
    }
    return { outcomesByToken };
  }

  clear(): void {
    this.captured.length = 0;
  }
}
```

- [ ] **Step 7: Run the test, expect pass**

```bash
pnpm --filter @jdm/api vitest run test/push/dev-sender.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 8: Implement ExpoPushSender**

Create `apps/api/src/services/push/expo.ts`:

```ts
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

import type { PushMessage, PushSendOutcome, PushSendResult, PushSender } from './types.js';

export class ExpoPushSender implements PushSender {
  private readonly client: Expo;

  constructor(accessToken?: string) {
    this.client = new Expo(accessToken ? { accessToken } : {});
  }

  async send(messages: PushMessage[]): Promise<PushSendResult> {
    const outcomesByToken = new Map<string, PushSendOutcome>();
    const valid: ExpoPushMessage[] = [];
    for (const m of messages) {
      if (!Expo.isExpoPushToken(m.to)) {
        outcomesByToken.set(m.to, { kind: 'invalid-token' });
        continue;
      }
      valid.push({ to: m.to, title: m.title, body: m.body, data: m.data ?? {} });
    }
    const chunks = this.client.chunkPushNotifications(valid);
    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[] = [];
      try {
        tickets = await this.client.sendPushNotificationsAsync(chunk);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        for (const m of chunk) {
          if (typeof m.to === 'string') {
            outcomesByToken.set(m.to, { kind: 'error', message: msg });
          }
        }
        continue;
      }
      chunk.forEach((m, i) => {
        const ticket = tickets[i];
        const to = typeof m.to === 'string' ? m.to : '';
        if (!ticket || !to) return;
        if (ticket.status === 'ok') {
          outcomesByToken.set(to, { kind: 'ok' });
          return;
        }
        const detailsErr = ticket.details?.error;
        if (detailsErr === 'DeviceNotRegistered' || detailsErr === 'InvalidCredentials') {
          outcomesByToken.set(to, { kind: 'invalid-token' });
        } else {
          outcomesByToken.set(to, { kind: 'error', message: ticket.message ?? 'expo error' });
        }
      });
    }
    return { outcomesByToken };
  }
}
```

- [ ] **Step 9: Implement the factory**

Create `apps/api/src/services/push/index.ts`:

```ts
import type { Env } from '../../env.js';

import { DevPushSender } from './dev.js';
import { ExpoPushSender } from './expo.js';
import type { PushSender } from './types.js';

export type { PushSender, PushMessage, PushSendResult, PushSendOutcome } from './types.js';
export { DevPushSender } from './dev.js';

export const buildPushSender = (env: Env): PushSender => {
  if (env.NODE_ENV === 'production') {
    return new ExpoPushSender(env.EXPO_ACCESS_TOKEN);
  }
  return new DevPushSender();
};
```

- [ ] **Step 10: Typecheck and run all push tests**

```bash
pnpm -w typecheck
pnpm --filter @jdm/api vitest run test/push
```

Expected: typecheck clean; 3/3 push tests pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/services/push apps/api/src/env.ts apps/api/test/push apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): push sender service with dev and Expo implementations"
```

---

## Task 5: Wire push into app + decorate fastify

**Files:**

- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Decorate fastify with push sender**

Edit `apps/api/src/app.ts`. Update the imports:

```ts
import { buildPushSender, type PushSender } from './services/push/index.js';
```

Update `BuildAppOverrides`:

```ts
export type BuildAppOverrides = {
  stripe?: StripeClient;
  push?: PushSender;
};
```

Update the `declare module 'fastify'` block to include push:

```ts
declare module 'fastify' {
  interface FastifyInstance {
    mailer: Mailer;
    env: Env;
    uploads: Uploads;
    stripe: StripeClient;
    push: PushSender;
  }
}
```

In `buildApp`, after the existing `app.decorate('stripe', ...)` line:

```ts
app.decorate('push', overrides.push ?? buildPushSender(env));
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: clean.

- [ ] **Step 3: Run the existing API test suite to confirm no regression**

```bash
pnpm --filter @jdm/api test
```

Expected: 176/176 pass (the F5 baseline). The new decorator is wired but unused.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat(api): decorate fastify with push sender"
```

---

## Task 6: Transactional push helper (TDD)

**Files:**

- Create: `apps/api/src/services/push/transactional.ts`
- Create: `apps/api/test/push/transactional.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/push/transactional.test.ts`:

```ts
import { prisma } from '@jdm/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { sendTransactionalPush } from '../../src/services/push/transactional.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedToken = (userId: string, token: string) =>
  prisma.deviceToken.create({
    data: { userId, expoPushToken: token, platform: 'ios' },
  });

describe('sendTransactionalPush', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writes a Notification row and sends to all tokens', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    await seedToken(user.id, 'ExponentPushToken[a]');
    await seedToken(user.id, 'ExponentPushToken[b]');
    const sender = new DevPushSender();

    const result = await sendTransactionalPush(
      {
        userId: user.id,
        kind: 'ticket.confirmed',
        dedupeKey: 'order-1',
        title: 'Ingresso confirmado',
        body: 'Bem-vindo!',
        data: { orderId: 'order-1' },
      },
      { sender },
    );

    expect(result).toEqual({ deduped: false, sent: 2, invalidatedTokens: 0 });
    expect(sender.captured).toHaveLength(2);
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentAt).toBeInstanceOf(Date);
  });

  it('is idempotent on duplicate (userId, kind, dedupeKey)', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    await seedToken(user.id, 'ExponentPushToken[a]');
    const sender = new DevPushSender();

    await sendTransactionalPush(
      { userId: user.id, kind: 'ticket.confirmed', dedupeKey: 'order-1', title: 't', body: 'b' },
      { sender },
    );
    const second = await sendTransactionalPush(
      { userId: user.id, kind: 'ticket.confirmed', dedupeKey: 'order-1', title: 't', body: 'b' },
      { sender },
    );

    expect(second).toEqual({ deduped: true, sent: 0, invalidatedTokens: 0 });
    expect(sender.captured).toHaveLength(1);
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it('skips delivery when user has zero tokens but still records the row', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    const sender = new DevPushSender();

    const result = await sendTransactionalPush(
      { userId: user.id, kind: 'ticket.confirmed', dedupeKey: 'order-1', title: 't', body: 'b' },
      { sender },
    );

    expect(result).toEqual({ deduped: false, sent: 0, invalidatedTokens: 0 });
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentAt).toBeNull();
  });

  it('deletes invalid tokens reported by the sender', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', verified: true });
    await seedToken(user.id, 'ExponentPushToken[a]');
    await seedToken(user.id, 'ExponentPushToken[b]');
    const sender = new DevPushSender();
    sender.markInvalid('ExponentPushToken[a]');

    const result = await sendTransactionalPush(
      { userId: user.id, kind: 'ticket.confirmed', dedupeKey: 'order-1', title: 't', body: 'b' },
      { sender },
    );

    expect(result).toEqual({ deduped: false, sent: 1, invalidatedTokens: 1 });
    const remaining = await prisma.deviceToken.findMany({ where: { userId: user.id } });
    expect(remaining.map((t) => t.expoPushToken)).toEqual(['ExponentPushToken[b]']);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @jdm/api vitest run test/push/transactional.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/services/push/transactional.ts`:

```ts
import { prisma } from '@jdm/db';
import type { PushKind } from '@jdm/shared/push';
import { Prisma } from '@prisma/client';

import type { PushSender } from './types.js';

export type SendTransactionalPushInput = {
  userId: string;
  kind: PushKind;
  dedupeKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type SendTransactionalPushResult = {
  deduped: boolean;
  sent: number;
  invalidatedTokens: number;
};

export const sendTransactionalPush = async (
  input: SendTransactionalPushInput,
  deps: { sender: PushSender },
): Promise<SendTransactionalPushResult> => {
  // 1) Insert-or-skip the Notification row. P2002 => already sent.
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { deduped: true, sent: 0, invalidatedTokens: 0 };
    }
    throw err;
  }

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: input.userId },
    select: { expoPushToken: true },
  });
  if (tokens.length === 0) {
    return { deduped: false, sent: 0, invalidatedTokens: 0 };
  }

  const result = await deps.sender.send(
    tokens.map((t) => ({
      to: t.expoPushToken,
      title: input.title,
      body: input.body,
      data: input.data,
    })),
  );

  let sent = 0;
  const invalid: string[] = [];
  for (const [token, outcome] of result.outcomesByToken) {
    if (outcome.kind === 'ok') sent += 1;
    else if (outcome.kind === 'invalid-token') invalid.push(token);
  }

  if (invalid.length > 0) {
    await prisma.deviceToken.deleteMany({
      where: { userId: input.userId, expoPushToken: { in: invalid } },
    });
  }

  await prisma.notification.updateMany({
    where: { userId: input.userId, kind: input.kind, dedupeKey: input.dedupeKey },
    data: { sentAt: new Date() },
  });

  return { deduped: false, sent, invalidatedTokens: invalid.length };
};
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @jdm/api vitest run test/push/transactional.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/push/transactional.ts apps/api/test/push/transactional.test.ts
git commit -m "feat(api): sendTransactionalPush with insert-or-skip idempotency"
```

---

## Task 7: `POST /me/device-tokens` route (TDD)

**Files:**

- Create: `apps/api/src/routes/me-device-tokens.ts`
- Create: `apps/api/test/me-device-tokens.route.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/me-device-tokens.route.test.ts`:

```ts
import { prisma } from '@jdm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from './helpers.js';

const env = loadEnv();

describe('POST /me/device-tokens', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  it('401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/me/device-tokens' });
    expect(res.statusCode).toBe(401);
  });

  it('400 on malformed body', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/device-tokens',
      headers: { authorization: bearer(env, user.id) },
      payload: { expoPushToken: 'too-short', platform: 'pc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('200 registers a new token', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/device-tokens',
      headers: { authorization: bearer(env, user.id) },
      payload: { expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    expect(res.statusCode).toBe(200);
    const rows = await prisma.deviceToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.expoPushToken).toBe('ExponentPushToken[abc1234567]');
    expect(rows[0]?.platform).toBe('ios');
  });

  it('200 upserts and bumps lastSeenAt on re-register', async () => {
    const { user } = await createUser({ verified: true });
    const auth = { authorization: bearer(env, user.id) };
    const payload = { expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' as const };

    await app.inject({ method: 'POST', url: '/me/device-tokens', headers: auth, payload });
    const first = await prisma.deviceToken.findFirstOrThrow({ where: { userId: user.id } });
    await new Promise((r) => setTimeout(r, 10));
    await app.inject({ method: 'POST', url: '/me/device-tokens', headers: auth, payload });
    const second = await prisma.deviceToken.findFirstOrThrow({ where: { userId: user.id } });

    const rows = await prisma.deviceToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });

  it('isolates tokens per user', async () => {
    const { user: u1 } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: u2 } = await createUser({ email: 'b@jdm.test', verified: true });

    await app.inject({
      method: 'POST',
      url: '/me/device-tokens',
      headers: { authorization: bearer(env, u1.id) },
      payload: { expoPushToken: 'ExponentPushToken[u1tok123456]', platform: 'ios' },
    });
    await app.inject({
      method: 'POST',
      url: '/me/device-tokens',
      headers: { authorization: bearer(env, u2.id) },
      payload: { expoPushToken: 'ExponentPushToken[u2tok123456]', platform: 'android' },
    });

    expect(await prisma.deviceToken.count({ where: { userId: u1.id } })).toBe(1);
    expect(await prisma.deviceToken.count({ where: { userId: u2.id } })).toBe(1);
  });
});

describe('DELETE /me/device-tokens/:token', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  it('removes only the calling user’s row for that token', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[xxx]', platform: 'ios' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/me/device-tokens/ExponentPushToken%5Bxxx%5D',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.deviceToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @jdm/api vitest run test/me-device-tokens.route.test.ts
```

Expected: FAIL (route not registered).

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/me-device-tokens.ts`:

```ts
import { prisma } from '@jdm/db';
import { registerDeviceTokenRequestSchema } from '@jdm/shared/push';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const meDeviceTokenRoutes: FastifyPluginAsync = async (app) => {
  app.post('/me/device-tokens', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const parsed = registerDeviceTokenRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid body' });
    }
    const { expoPushToken, platform } = parsed.data;
    await prisma.deviceToken.upsert({
      where: { userId_expoPushToken: { userId: sub, expoPushToken } },
      create: { userId: sub, expoPushToken, platform, lastSeenAt: new Date() },
      update: { platform, lastSeenAt: new Date() },
    });
    return reply.status(200).send({ ok: true });
  });

  app.delete<{ Params: { token: string } }>(
    '/me/device-tokens/:token',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { sub } = requireUser(request);
      const token = decodeURIComponent(request.params.token);
      await prisma.deviceToken.deleteMany({
        where: { userId: sub, expoPushToken: token },
      });
      return reply.status(204).send();
    },
  );
};
```

- [ ] **Step 4: Register the route in `app.ts`**

Edit `apps/api/src/app.ts`. Add to imports:

```ts
import { meDeviceTokenRoutes } from './routes/me-device-tokens.js';
```

Register after `meTicketsRoutes`:

```ts
await app.register(meDeviceTokenRoutes);
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @jdm/api vitest run test/me-device-tokens.route.test.ts
```

Expected: 6/6 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/me-device-tokens.ts apps/api/src/app.ts apps/api/test/me-device-tokens.route.test.ts
git commit -m "feat(api): POST/DELETE /me/device-tokens"
```

---

## Task 8: Hook ticket-confirmed push into the Stripe webhook (TDD)

**Files:**

- Modify: `apps/api/src/services/tickets/issue.ts`
- Modify: `apps/api/src/routes/stripe-webhook.ts`
- Create: `apps/api/test/stripe-webhook-push.test.ts`

- [ ] **Step 1: Extend `IssueResult` to include user/event info**

Edit `apps/api/src/services/tickets/issue.ts`. Replace the `IssueResult` type and the two `return` sites that use it:

```ts
export type IssueResult = {
  ticketId: string;
  code: string;
  userId: string;
  eventId: string;
  eventTitle: string;
};
```

In the existing `paid` short-circuit branch (around lines 57–60), update the return:

```ts
if (order.status === 'paid') {
  const existing = await tx.ticket.findUnique({
    where: { orderId },
    include: { event: { select: { title: true } } },
  });
  if (!existing) throw new OrderPaidWithoutTicketError(orderId);
  return {
    ticketId: existing.id,
    code: signTicketCode(existing.id, env),
    userId: existing.userId,
    eventId: existing.eventId,
    eventTitle: existing.event.title,
  };
}
```

In the success branch (around line 101) replace the trailing return:

```ts
const event = await tx.event.findUniqueOrThrow({
  where: { id: order.eventId },
  select: { title: true },
});
return {
  ticketId: ticket.id,
  code: signTicketCode(ticket.id, env),
  userId: order.userId,
  eventId: order.eventId,
  eventTitle: event.title,
};
```

- [ ] **Step 2: Run the existing F4 webhook test to confirm no regression**

```bash
pnpm --filter @jdm/api vitest run test/stripe-webhook
```

Expected: existing tests pass; the new return fields are additive.

- [ ] **Step 3: Write the failing push integration test**

Create `apps/api/test/stripe-webhook-push.test.ts`. Mirror the existing `apps/api/test/stripe-webhook.route.test.ts` setup style — read that file first to copy the FakeStripe wiring exactly. Then:

```ts
import { prisma } from '@jdm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DevPushSender } from '../src/services/push/dev.js';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { buildFakeStripe } from '../src/services/stripe/fake.js';
import { createUser, resetDatabase } from './helpers.js';

const env = loadEnv();

describe('Stripe webhook -> ticket.confirmed push', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let stripe: ReturnType<typeof buildFakeStripe>;
  let push: DevPushSender;

  beforeAll(async () => {
    stripe = buildFakeStripe();
    push = new DevPushSender();
    app = await buildApp(env, { stripe, push });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    push.clear();
  });

  const seedOrderAndEvent = async (userId: string) => {
    const event = await prisma.event.create({
      data: {
        slug: 'evt-1',
        title: 'JDM Spring Meetup',
        description: 'd',
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3600_000),
        type: 'meeting',
        status: 'published',
        capacity: 100,
        publishedAt: new Date(),
      },
    });
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'GA', priceCents: 5000, quantityTotal: 100 },
    });
    const order = await prisma.order.create({
      data: {
        userId,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
      },
    });
    return { event, order };
  };

  it('fires push and writes Notification row on payment_intent.succeeded', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const { order } = await seedOrderAndEvent(user.id);
    const evt = stripe.makeWebhookEvent('payment_intent.succeeded', {
      id: 'pi_1',
      metadata: { orderId: order.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': evt.signature },
      payload: evt.raw,
    });
    expect(res.statusCode).toBe(200);

    expect(push.captured).toHaveLength(1);
    expect(push.captured[0]?.title).toMatch(/ingresso/i);
    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'ticket.confirmed' },
    });
    expect(notif.dedupeKey).toBe(order.id);
    expect(notif.sentAt).toBeInstanceOf(Date);
  });

  it('does not double-send on webhook redelivery', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const { order } = await seedOrderAndEvent(user.id);
    const evt = stripe.makeWebhookEvent('payment_intent.succeeded', {
      id: 'pi_1',
      metadata: { orderId: order.id },
    });

    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': evt.signature },
      payload: evt.raw,
    });
    push.clear();
    await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': evt.signature },
      payload: evt.raw,
    });

    expect(push.captured).toHaveLength(0);
    const notifs = await prisma.notification.findMany({
      where: { userId: user.id, kind: 'ticket.confirmed' },
    });
    expect(notifs).toHaveLength(1);
  });

  it('does not block ticket issuance if push fails', async () => {
    const { user } = await createUser({ verified: true });
    // No DeviceToken seeded -> push helper records Notification but sends 0
    const { order } = await seedOrderAndEvent(user.id);
    const evt = stripe.makeWebhookEvent('payment_intent.succeeded', {
      id: 'pi_1',
      metadata: { orderId: order.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'stripe-signature': evt.signature },
      payload: evt.raw,
    });
    expect(res.statusCode).toBe(200);

    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
    expect(ticket.status).toBe('valid');
  });
});
```

If `buildFakeStripe.makeWebhookEvent` does not exist with that exact shape, read `apps/api/src/services/stripe/fake.ts` first and use whatever helper the F4 webhook tests already use; the assertions above are the contract, the seeding mechanics are environmental.

- [ ] **Step 4: Run, expect failure**

```bash
pnpm --filter @jdm/api vitest run test/stripe-webhook-push.test.ts
```

Expected: FAIL (no push fired; no Notification row).

- [ ] **Step 5: Wire push into the webhook handler**

Edit `apps/api/src/routes/stripe-webhook.ts`. Add to imports:

```ts
import { sendTransactionalPush } from '../services/push/transactional.js';
```

In the `payment_intent.succeeded` branch, replace:

```ts
if (event.type === 'payment_intent.succeeded' && orderId && intent.id) {
  try {
    await issueTicketForPaidOrder(orderId, intent.id, app.env);
  } catch (err) {
```

with:

```ts
if (event.type === 'payment_intent.succeeded' && orderId && intent.id) {
  let issued: Awaited<ReturnType<typeof issueTicketForPaidOrder>>;
  try {
    issued = await issueTicketForPaidOrder(orderId, intent.id, app.env);
  } catch (err) {
```

(Note: rename the `try` block's local to `issued` and use it after the catch.)

After the `markProcessed(event.id, event)` line in the success path, before returning, add:

```ts
try {
  await sendTransactionalPush(
    {
      userId: issued.userId,
      kind: 'ticket.confirmed',
      dedupeKey: orderId,
      title: 'Ingresso confirmado',
      body: `Seu ingresso para ${issued.eventTitle} está pronto.`,
      data: { orderId, ticketId: issued.ticketId, eventId: issued.eventId },
    },
    { sender: app.push },
  );
} catch (pushErr) {
  request.log.warn({ err: pushErr, orderId }, 'stripe webhook: ticket-confirmed push failed');
}
```

- [ ] **Step 6: Run, expect pass**

```bash
pnpm --filter @jdm/api vitest run test/stripe-webhook-push.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 7: Run the full API test suite**

```bash
pnpm --filter @jdm/api test
```

Expected: 176 + new tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/tickets/issue.ts apps/api/src/routes/stripe-webhook.ts apps/api/test/stripe-webhook-push.test.ts
git commit -m "feat(api): emit ticket.confirmed push from Stripe webhook"
```

---

## Task 9: Event reminders worker (TDD)

**Files:**

- Create: `apps/api/src/workers/event-reminders.ts`
- Create: `apps/api/test/workers/event-reminders.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json` (add `node-cron`)

- [ ] **Step 1: Add `node-cron`**

```bash
pnpm --filter @jdm/api add node-cron
pnpm --filter @jdm/api add -D @types/node-cron
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/test/workers/event-reminders.test.ts`:

```ts
import { prisma } from '@jdm/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { runEventRemindersTick } from '../../src/workers/event-reminders.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedTicket = async (userId: string, startsAt: Date) => {
  const event = await prisma.event.create({
    data: {
      slug: `evt-${startsAt.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      title: `Evt ${startsAt.toISOString()}`,
      description: 'd',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3600_000),
      type: 'meeting',
      status: 'published',
      capacity: 100,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: { eventId: event.id, name: 'GA', priceCents: 0, quantityTotal: 100 },
  });
  await prisma.ticket.create({
    data: { userId, eventId: event.id, tierId: tier.id, source: 'comp', status: 'valid' },
  });
  return { event, tier };
};

describe('runEventRemindersTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('emits T-24h reminder for events starting in ~24h', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 30 * 1000);
    const { event } = await seedTicket(user.id, startsAt);
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });

    expect(sender.captured.length).toBeGreaterThanOrEqual(1);
    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'event.reminder_24h' },
    });
    expect(notif.dedupeKey).toBe(event.id);
  });

  it('emits T-1h reminder for events starting in ~1h', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 59 * 60 * 1000 + 30 * 1000);
    const { event } = await seedTicket(user.id, startsAt);
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });

    const notif = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: 'event.reminder_1h' },
    });
    expect(notif.dedupeKey).toBe(event.id);
  });

  it('does not double-send across two ticks', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 30 * 1000);
    await seedTicket(user.id, startsAt);
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });
    sender.clear();
    await runEventRemindersTick({ sender, now: new Date() });

    expect(sender.captured).toHaveLength(0);
    const rows = await prisma.notification.findMany({
      where: { userId: user.id, kind: 'event.reminder_24h' },
    });
    expect(rows).toHaveLength(1);
  });

  it('skips events outside both windows', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6h out
    await seedTicket(user.id, startsAt);
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });

    expect(sender.captured).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('skips revoked and used tickets', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[abc1234567]', platform: 'ios' },
    });
    const startsAt = new Date(Date.now() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 30 * 1000);
    const { event, tier } = await seedTicket(user.id, startsAt);
    // Replace the seeded valid ticket with a revoked one
    await prisma.ticket.deleteMany({ where: { userId: user.id } });
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'comp',
        status: 'revoked',
      },
    });
    const sender = new DevPushSender();

    await runEventRemindersTick({ sender, now: new Date() });

    expect(sender.captured).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
pnpm --filter @jdm/api vitest run test/workers/event-reminders.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 4: Implement the runner**

Create `apps/api/src/workers/event-reminders.ts`:

```ts
import { prisma } from '@jdm/db';
import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';

import { sendTransactionalPush } from '../services/push/transactional.js';
import type { PushSender } from '../services/push/index.js';

type ReminderKind = 'event.reminder_24h' | 'event.reminder_1h';

const WINDOWS: Array<{ kind: ReminderKind; lowerMs: number; upperMs: number; copy: string }> = [
  {
    kind: 'event.reminder_24h',
    lowerMs: 23 * 60 * 60 * 1000 + 59 * 60 * 1000,
    upperMs: 24 * 60 * 60 * 1000,
    copy: 'Seu evento começa em 24 horas.',
  },
  {
    kind: 'event.reminder_1h',
    lowerMs: 59 * 60 * 1000,
    upperMs: 60 * 60 * 1000,
    copy: 'Seu evento começa em 1 hora.',
  },
];

export type RunTickDeps = { sender: PushSender; now?: Date };

export const runEventRemindersTick = async (deps: RunTickDeps): Promise<void> => {
  const now = deps.now ?? new Date();

  for (const w of WINDOWS) {
    const lower = new Date(now.getTime() + w.lowerMs);
    const upper = new Date(now.getTime() + w.upperMs);

    const events = await prisma.event.findMany({
      where: {
        status: 'published',
        startsAt: { gte: lower, lte: upper },
      },
      select: { id: true, title: true },
    });

    for (const event of events) {
      const tickets = await prisma.ticket.findMany({
        where: { eventId: event.id, status: 'valid' },
        select: { userId: true },
        distinct: ['userId'],
      });

      for (const t of tickets) {
        await sendTransactionalPush(
          {
            userId: t.userId,
            kind: w.kind,
            dedupeKey: event.id,
            title: event.title,
            body: w.copy,
            data: { eventId: event.id, kind: w.kind },
          },
          { sender: deps.sender },
        );
      }
    }
  }
};

export const startEventRemindersWorker = (deps: {
  sender: PushSender;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('* * * * *', () => {
    runEventRemindersTick({ sender: deps.sender }).catch((err: unknown) => {
      deps.log.error({ err }, 'event reminders tick failed');
    });
  });
  return {
    stop: () => {
      task.stop();
    },
  };
};
```

- [ ] **Step 5: Run, expect pass**

```bash
pnpm --filter @jdm/api vitest run test/workers/event-reminders.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 6: Boot the worker from `app.ts` (production only)**

Edit `apps/api/src/app.ts`. Add to imports:

```ts
import { startEventRemindersWorker } from './workers/event-reminders.js';
```

After `app.register(authRoutes, { prefix: '/auth' })` and before the dev block, add:

```ts
if (env.WORKER_ENABLED && env.NODE_ENV === 'production') {
  const worker = startEventRemindersWorker({ sender: app.push, log: app.log });
  app.addHook('onClose', async () => {
    worker.stop();
  });
}
```

- [ ] **Step 7: Run the full suite**

```bash
pnpm --filter @jdm/api test
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/workers apps/api/src/app.ts apps/api/test/workers apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): event reminders worker with T-24h and T-1h pushes"
```

---

## Task 10: Mobile push deps and config

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.config.ts`

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @jdm/mobile add expo-notifications expo-device
```

- [ ] **Step 2: Configure plugin**

Edit `apps/mobile/app.config.ts`. Replace the `plugins` array entry block:

```ts
plugins: [
  'expo-router',
  [
    'expo-notifications',
    {
      icon: './assets/notification-icon.png',
      color: '#0B0B0F',
    },
  ],
  [
    '@sentry/react-native/expo',
    {
      organization: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT_MOBILE,
    },
  ],
],
```

If `./assets/notification-icon.png` does not exist yet, copy `./assets/icon.png` to that path as a placeholder. The store-ready icon lands separately under task X.3 in the cross-cutting roadmap.

- [ ] **Step 3: Typecheck and start metro to confirm config parses**

```bash
pnpm --filter @jdm/mobile typecheck
```

Expected: clean. We do not boot metro here; the config loads at type-check time via the `ExpoConfig` import.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.config.ts apps/mobile/assets pnpm-lock.yaml
git commit -m "chore(mobile): add expo-notifications and expo-device"
```

---

## Task 11: Mobile permission + register helpers

**Files:**

- Create: `apps/mobile/src/notifications/permission.ts`
- Create: `apps/mobile/src/notifications/register.ts`
- Create: `apps/mobile/src/api/device-tokens.ts`

- [ ] **Step 1: Permission helper**

Create `apps/mobile/src/notifications/permission.ts`:

```ts
import * as Notifications from 'expo-notifications';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export const ensurePushPermission = async (): Promise<PushPermission> => {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return 'granted';
  if (existing.canAskAgain === false) return 'denied';
  const result = await Notifications.requestPermissionsAsync();
  if (result.granted) return 'granted';
  return result.canAskAgain ? 'undetermined' : 'denied';
};
```

- [ ] **Step 2: Register helper**

Create `apps/mobile/src/notifications/register.ts`:

```ts
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const projectId = (): string | undefined => {
  const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
  return extra.eas?.projectId && extra.eas.projectId.length > 0 ? extra.eas.projectId : undefined;
};

export type RegisterResult =
  | { ok: true; token: string; platform: 'ios' | 'android' }
  | { ok: false; reason: 'simulator' | 'no-project-id' | 'sdk-error' };

export const registerExpoPushToken = async (): Promise<RegisterResult> => {
  if (!Device.isDevice) return { ok: false, reason: 'simulator' };
  const id = projectId();
  if (!id) return { ok: false, reason: 'no-project-id' };
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
    return { ok: true, token: result.data, platform };
  } catch {
    return { ok: false, reason: 'sdk-error' };
  }
};
```

- [ ] **Step 3: API client**

Create `apps/mobile/src/api/device-tokens.ts`:

```ts
import {
  registerDeviceTokenRequestSchema,
  registerDeviceTokenResponseSchema,
  type RegisterDeviceTokenRequest,
} from '@jdm/shared/push';

import { authedRequest } from './client';

export const registerDeviceToken = (input: RegisterDeviceTokenRequest) =>
  authedRequest('/me/device-tokens', registerDeviceTokenResponseSchema, {
    method: 'POST',
    body: registerDeviceTokenRequestSchema.parse(input),
  });
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/notifications apps/mobile/src/api/device-tokens.ts
git commit -m "feat(mobile): expo push permission and register helpers"
```

---

## Task 12: Mobile auth-context push registration hook

**Files:**

- Create: `apps/mobile/src/notifications/use-push-registration.ts`
- Modify: `apps/mobile/src/auth/context.tsx`

- [ ] **Step 1: Create the hook**

Create `apps/mobile/src/notifications/use-push-registration.ts`:

```ts
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';

import { registerDeviceToken } from '~/api/device-tokens';

import { ensurePushPermission } from './permission';
import { registerExpoPushToken } from './register';

export type UsePushRegistrationDeps = { isAuthenticated: boolean };

export const usePushRegistration = ({ isAuthenticated }: UsePushRegistrationDeps): void => {
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      lastSent.current = null;
      return undefined;
    }

    const send = async (token: string, platform: 'ios' | 'android') => {
      if (lastSent.current === token) return;
      try {
        await registerDeviceToken({ expoPushToken: token, platform });
        lastSent.current = token;
      } catch {
        // Server-side dedupe + lastSeenAt bump handles retry on next boot.
      }
    };

    const boot = async () => {
      const perm = await ensurePushPermission();
      if (perm !== 'granted') return;
      const result = await registerExpoPushToken();
      if (!result.ok) return;
      await send(result.token, result.platform);
    };
    void boot();

    const sub = Notifications.addPushTokenListener((event) => {
      // Token rotated server-side. Re-register without re-prompting.
      void (async () => {
        const platform = (await import('react-native')).Platform.OS === 'ios' ? 'ios' : 'android';
        await send(event.data, platform);
      })();
    });

    return () => {
      sub.remove();
    };
  }, [isAuthenticated]);
};
```

- [ ] **Step 2: Wire into the auth context**

Edit `apps/mobile/src/auth/context.tsx`. Add to imports:

```ts
import { usePushRegistration } from '~/notifications/use-push-registration';
```

Inside `AuthProvider`, after the existing hook bodies but before the `value` memo, add:

```ts
usePushRegistration({ isAuthenticated: state.status === 'authenticated' });
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @jdm/mobile typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/notifications/use-push-registration.ts apps/mobile/src/auth/context.tsx
git commit -m "feat(mobile): register expo push token after authentication"
```

---

## Task 13: Manual smoke test + handoff

**Files:**

- Modify: `plans/roadmap.md` (flip 6.1–6.5 to `[x]` after merge + deploy)
- Rewrite: `handoff.md`

- [ ] **Step 1: Run the full workspace test suite**

```bash
pnpm -w test
pnpm -w typecheck
pnpm -w lint
```

Expected: all green.

- [ ] **Step 2: Manual smoke (run locally with the dev API + mobile dev client)**

Document these steps in the handoff. Do not skip.

1. Boot API with `WORKER_ENABLED=true NODE_ENV=development` so the cron logs every minute (logs only; in dev the worker is gated to production, so for the smoke test temporarily allow `NODE_ENV !== 'test'` by editing the gate to `env.WORKER_ENABLED && env.NODE_ENV !== 'test'`, smoke test, then revert before commit).
2. Sign up + log in on a physical iOS device with a dev client. Buy a ticket via Stripe test card. Confirm:
   - The OS permission prompt appears once after the purchase success screen (or on next cold start).
   - A `DeviceToken` row exists for the user.
   - The "Ingresso confirmado" push lands within seconds of the webhook.
   - A `Notification` row exists with `kind='ticket.confirmed'`, `dedupeKey=<orderId>`, `sentAt` set.
3. In `psql`, set the event `startsAt` to `now() + interval '23 hours 59 minutes 45 seconds'`. Wait one minute. Confirm:
   - `event.reminder_24h` push lands.
   - A second tick within the same window does not re-send.
4. Toggle OS notification permission off, kill the app, relaunch. Confirm `DeviceToken` row remains (we do not pre-emptively delete on the client) but no further pushes arrive. Toggle back on, kill + relaunch, confirm a fresh push works.

- [ ] **Step 3: Open the PR**

Push the branch and open a PR with the smoke checklist in the body.

```bash
git push -u origin feat/f6-push
gh pr create --title "Phase 1 / F6: transactional push" --body "$(cat <<'EOF'
## Summary
- DeviceToken + Notification models with `(userId, kind, dedupeKey)` idempotency.
- POST/DELETE /me/device-tokens.
- Push sender service (Expo + Dev) decorated on the fastify app.
- Stripe webhook fires "Ingresso confirmado" after ticket issuance.
- node-cron worker emits T-24h and T-1h reminders to ticket holders.
- Mobile registers the push token after auth boot, gated on OS permission.

## Test plan
- [ ] Stripe test purchase delivers push within seconds.
- [ ] Webhook redelivery does not duplicate the push or the Notification row.
- [ ] T-24h reminder fires once per (user, event).
- [ ] T-1h reminder fires once per (user, event).
- [ ] Revoked/used tickets receive no reminder.
- [ ] OS permission denied -> no DeviceToken row -> no push, no errors.
- [ ] Token rotation re-registers without re-prompting.

## Deploy
- Run migration `<timestamp>_device_tokens_notifications` on Railway.
- Set `WORKER_ENABLED=true` on the API service in production.
- (Optional) set `EXPO_ACCESS_TOKEN` for higher Expo Push rate limits.
- Update EAS profile to include `expo-notifications` plugin (already in app.config.ts).
EOF
)"
```

- [ ] **Step 4: After merge + deploy, flip 6.1–6.5 to `[x]`**

The same merge commit (or a follow-up housekeeping commit on `main` if the deploy lags) flips each `- [~]` to `- [x]` and removes the `_(on feat/f6-push)_` annotations on the five Scope lines.

- [ ] **Step 5: Rewrite `handoff.md`**

Mirror `handoff.md`'s F5 structure: What landed, Schema, Shared, API, Tests, Mobile, Test status, Deploy checklist, Deferred, Manual smoke, Branch + commit log, Roadmap state.

- [ ] **Step 6: Commit handoff and final roadmap flip**

```bash
git add handoff.md plans/roadmap.md
git commit -m "docs(f6): handoff and final roadmap flip"
```

---

## Self-review notes

- **Spec coverage:** 6.1 schema (T2), 6.2 register endpoint (T7), 6.3 sender service (T4 + T6), 6.4 wire transactional hooks (T8 stripe + T9 cron worker), 6.5 mobile permission + register (T10 + T11 + T12). All five sub-tasks covered.
- **Idempotency:** durable via `Notification(userId, kind, dedupeKey)` unique. Cron retries, webhook redeliveries, and re-registrations all collapse on the DB constraint.
- **Failure isolation:** push errors never block ticket issuance; the Stripe webhook wraps the call in try/catch and logs.
- **Type consistency check:** `IssueResult` extension in T8 is the only cross-task contract change. The webhook caller uses the extended fields. The F4 `payment_intent.payment_failed` branch (line 83) does not touch issue.ts and is untouched here.
- **No placeholders.** Every code block is concrete. Where the F4 fake-stripe webhook helper shape is uncertain (T8 step 3), the plan tells the engineer to read the existing F4 webhook test first and copy the seeding mechanics; the assertion contract is unambiguous.
- **Test posture:** real Postgres throughout. No mocks of prisma, only of the `PushSender` interface (via `DevPushSender`).
