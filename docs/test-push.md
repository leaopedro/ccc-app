# F6 — Manual Push Flow Test

How to manually verify ticket-confirmed and event-reminder pushes end-to-end.

## 0. Prerequisites

- Real iOS or Android device. Expo Go does **not** deliver push reliably — needs an EAS dev build.
- API + Postgres + admin running locally.
- Stripe CLI installed and logged in (`stripe login`).
- API `.env` has `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TICKET_CODE_SECRET`. Leave `WORKER_ENABLED=false`.

## 1. Build and install the mobile dev client

```sh
cd apps/mobile
eas build --profile development --platform ios   # or --platform android
```

Install the resulting build on the device. Expo Go will not work — `expo-notifications` is a native module.

## 2. Start the API with Stripe webhook forwarding

Two shells:

```sh
pnpm --filter @jdm/api dev
stripe listen --forward-to localhost:3030/stripe/webhook
```

Copy the `whsec_…` value Stripe prints into `STRIPE_WEBHOOK_SECRET` and restart the API.

## 3. Register a push token from the device

1. Launch the dev build, sign up, log in.
2. Accept the OS push permission prompt (fires once on the first authenticated cold start).
3. Verify in DB:

```sh
psql $DATABASE_URL -c 'select id, "userId", "expoPushToken", platform, "lastSeenAt" from "DeviceToken";'
```

Expected: one row for the user.

## 4. Test ticket-confirmed push

1. Browse to an event in the mobile app, buy a ticket with Stripe test card `4242 4242 4242 4242`.
2. Within seconds of `payment_intent.succeeded`:
   - "Ingresso confirmado" lands on the device.
   - DB check:

```sh
psql $DATABASE_URL -c $'select kind, "dedupeKey", "sentAt" from "Notification" where kind=\'ticket.confirmed\' order by "createdAt" desc limit 1;'
```

`sentAt` is set; `dedupeKey` equals the order id.

## 5. Test webhook idempotency

In the Stripe dashboard → Developers → Events → click the `payment_intent.succeeded` event → "Resend".

- No new push lands on the device.
- DB still has exactly one `Notification` row for that `(userId, kind='ticket.confirmed', dedupeKey=orderId)`.

## 6. Test "no device tokens" path

1. On the device, force-stop the app and revoke push permission in OS settings (or `DELETE` the `DeviceToken` row in DB).
2. Buy a second ticket (different event).
3. Expected: ticket issuance still succeeds (200 from webhook), and a `Notification` row is written with `sentAt = null`.

## 7. Test event reminders (T-24h)

The cron only boots in production. Two ways:

### Option A — call the runner directly (recommended)

```sh
psql $DATABASE_URL -c $'update "Event" set "startsAt" = now() + interval \'23 hours 59 minutes 45 seconds\' where id=\'<eventId>\';'
```

Then in `apps/api`:

```sh
pnpm tsx -e "import{runEventRemindersTick}from'./src/workers/event-reminders.ts';import{buildPushSender}from'./src/services/push/index.ts';import{loadEnv}from'./src/env.ts';await runEventRemindersTick({sender:buildPushSender(loadEnv())});"
```

Push lands. Run it again — no duplicate (only one `Notification` with `kind='event.reminder_24h'`, `dedupeKey=<eventId>`).

### Option B — temporarily flip the gate

In `apps/api/src/app.ts`, change `env.NODE_ENV === 'production'` to `env.NODE_ENV !== 'test'`, set `WORKER_ENABLED=true`, restart. Wait one minute. Confirm the push, then a second tick a minute later does not re-send. **Revert before committing.**

## 8. Test T-1h reminder

Same as step 7 but with `startsAt = now() + interval '59 minutes 45 seconds'`. Expect `kind='event.reminder_1h'`.

## 9. Test invalid-token pruning (optional)

1. Insert a junk `DeviceToken` row for your user with `expoPushToken='ExponentPushToken[totally-fake]'`.
2. Trigger a ticket-confirmed push (replay the webhook with a fresh `dedupeKey`).
3. Expo returns `DeviceNotRegistered` for the fake token; check DB — that row is gone, your real token is still there.

## 10. Test local broadcast smoke path (F10)

Default local dev does not run the broadcast worker and does not deliver real
pushes — both behaviors are gated so ordinary `pnpm --filter @jdm/api dev`
never sends accidental traffic. Use the env flags below to opt into a
production-shaped local smoke.

> **Simulator cannot receive Expo push.** The iOS Simulator (and Android
> emulator) cannot register for real Expo push tokens. JDMA-531 inserts a
> synthetic `ExponentPushToken[simulator-…]` row into `DeviceToken` so the
> mobile signup flow does not block, but Expo will not deliver to that token.
> Any device-level verification (variant 10B) **requires a physical device**.

> **Watch out for `apps/mobile/.env.local`.** A blank line like
> `EAS_PROJECT_ID=` or `EXPO_PUBLIC_API_BASE_URL=` in `.env.local` overrides
> the value in `.env` because dotenv loads `.env.local` second and treats the
> empty string as set. `app.config.ts` now uses `||` (not `??`) on those two
> defaults so empty falls back, but if you see `[push] registerExpoPushToken:
no projectId resolved` in the Metro console, that file is the first place
> to look — either remove the empty line or set the value. Restart Metro with
> `--clear` after editing.

### 10A — Worker only (DB-level smoke, no real device)

Verifies dispatch claims a `scheduled` broadcast and transitions it to `sent`,
without hitting Expo. Works with simulator tokens.

1. Stop the API. Set in `apps/api/.env`:

   ```sh
   BROADCAST_WORKER_ENABLED=true
   # PUSH_PROVIDER unset (defaults to auto → DevPushSender in dev)
   ```

2. `pnpm --filter @jdm/api dev`. On boot you will see
   `[broadcasts] worker enabled with DevPushSender — broadcasts will be marked
sent but no real push will be delivered.` That is the signal you are in
   10A, not 10B.
3. From the admin composer (or `POST /admin/broadcasts`), create a send-now
   broadcast targeting yourself or a small audience.
4. Within ~60 s, the admin list flips `Agendado` → `Enviado`. DB check:

   ```sh
   psql $DATABASE_URL -c $'select id, status, "startedAt", "completedAt" from "Broadcast" order by "createdAt" desc limit 1;'
   psql $DATABASE_URL -c $'select status, count(*) from "BroadcastDelivery" group by status;'
   ```

   `Broadcast.status='sent'`, `BroadcastDelivery.status='sent'` for each target.
   API logs include `[broadcasts] dispatch complete` and per-message
   `[dev-push] to=… title=…` lines (delivery is stubbed locally).

   No notification will arrive on any device or simulator in this mode — by
   design.

### 10B — Worker + real Expo delivery (requires physical device)

Adds real device delivery on top of 10A. **Will not work against a simulator.**

1. On a real iOS or Android device, install an EAS dev build, sign up, log in,
   accept push permission. Verify a real `ExponentPushToken[…]` row landed in
   `DeviceToken` (not `ExponentPushToken[simulator-…]`).
2. Stop the API. In `apps/api/.env`:

   ```sh
   BROADCAST_WORKER_ENABLED=true
   PUSH_PROVIDER=expo
   EXPO_ACCESS_TOKEN=<your-expo-access-token>
   ```

3. `pnpm --filter @jdm/api dev`. The DevPushSender warning from 10A must
   **not** appear; absence of that warn line confirms `ExpoPushSender` is wired.
4. From the admin composer (or `POST /admin/broadcasts`), create a send-now
   broadcast targeting that user.
5. Within ~60 s, the push lands on the real device and the admin list shows
   `Enviado`. `BroadcastDelivery.status='sent'` for that user; invalid tokens
   (synthetic simulator rows for that user included) are pruned from
   `DeviceToken` automatically.

### Notes

- Both flags default off / `auto`. Forgetting to set them keeps the safe local
  default (no background worker, no real Expo traffic).
- `PUSH_PROVIDER=dev` is also available as an explicit safety override (e.g.
  to run a production-shaped build without hitting Expo).
- Revert the env values when you are done so subsequent dev runs stay quiet.

## Cleanup

- Reset the event `startsAt` to its real future value.
- If you flipped the gate in step 7B, revert it.
- If you set `BROADCAST_WORKER_ENABLED` or `PUSH_PROVIDER` for step 10, unset them.
- Delete test `Notification`, `BroadcastDelivery`, and `DeviceToken` rows for a clean slate.
