# F8.19 — Smoke and flag flip (TDD plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking. TDD does not apply to manual-only items (the smoke runbook is the verification record). All code changes have automated tests.

**Goal:** Author Stripe + RevenueCat dashboard-config docs, extend the F8 smoke runbook in `docs/manual-testing.md`, flip `GROWTH_PREMIUM_BILLING_ENABLED` default to `true` in production-fallback code (with deploy-order guard), record F8 completion in `.handoffs/orchestrator-state.md`, and mirror the feature flag in `apps/mobile/app.config.ts`.

**Architecture:** Documentation-and-config chunk. The only code change is a one-line default flip in `apps/api/src/env.ts`. The effective runtime value is always the Railway env override (set to `false` until smoke passes; then `true`). The code default is the fallback for new deploys after the flag is live. Deploy ordering: Railway override `GROWTH_PREMIUM_BILLING_ENABLED=false` must remain in place until smoke passes; the code default takes effect only when the override is removed.

**Tech stack:** No new deps. Zod (`apps/api/src/env.ts`), Expo `app.config.ts`. Manual verification only — no vitest suites produced by this chunk.

---

## File map

| Action    | Path                              | Purpose                                                            |
| --------- | --------------------------------- | ------------------------------------------------------------------ |
| Create    | `docs/stripe.md`                  | Stripe Dashboard config: Product, Prices, webhook, Tax             |
| Create    | `docs/revenuecat.md`              | RevenueCat dashboard config: app, offerings, entitlements, webhook |
| Modify    | `docs/manual-testing.md`          | Append §3.9 F8 smoke checklist                                     |
| Modify    | `apps/api/src/env.ts`             | Flip `GROWTH_PREMIUM_BILLING_ENABLED` default to `true`            |
| Modify    | `apps/api/test/env.test.ts`       | Flip default assertion `false` → `true` (gap #7)                   |
| Verify    | `apps/mobile/app.config.ts`       | `premiumBillingEnabled` already added by F8.18 — verify only       |
| Overwrite | `.handoffs/orchestrator-state.md` | Record F8 completion + deferred Phase F8.1 backlog                 |

---

## Task 1: Author `docs/stripe.md`

**Files:**

- Create: `docs/stripe.md`

- [ ] **Step 1: Create `docs/stripe.md`**

````markdown
# Stripe Dashboard configuration

How to configure Stripe for JDM Experience. This is operational setup — no
application code changes. Apply once per environment (test mode for staging +
smoke; live mode for production).

## 1. Product — "JDM Premium Gold"

### 1.1 Create the product

1. Open Stripe Dashboard → **Products** → **Add product**.
2. Fill the fields:

   | Field                | Value                                             |
   | -------------------- | ------------------------------------------------- |
   | Name                 | `JDM Premium Gold`                                |
   | Description          | `Acesso Premium Gold à plataforma JDM Experience` |
   | Statement descriptor | `JDM PREMIUM`                                     |
   | Tax code             | `txcd_20030000` (Software as a service)           |

3. Under **Tax behavior**: select **Inclusive** (price shown already includes
   tax). Stripe Tax for Brazil (IOF/PIS/COFINS) is operational config — no
   application code is involved.
4. Click **Save product**. Note the Product ID (`prod_...`). You will reference
   it when creating both Prices below.

### 1.2 Create the monthly Price

While still on the product detail page, click **Add price**.

| Field          | Value                                                          |
| -------------- | -------------------------------------------------------------- |
| Pricing model  | Standard pricing                                               |
| Billing period | Monthly                                                        |
| Price          | R$ XX,XX (set by product/pricing decision; not a code concern) |
| Currency       | BRL                                                            |
| Lookup key     | `premium_gold_monthly`                                         |

Under **Additional options → Metadata**, add:

| Key               | Value                                              |
| ----------------- | -------------------------------------------------- |
| `baseAmountCents` | `<price_in_cents_excluding_devfee>`                |
| `devFeePercent`   | `10` (or whatever `DEV_FEE_PERCENT` env is set to) |

These two metadata keys are **load-bearing** (spec §F8.1). The webhook
handler reads them at time-of-charge to populate
`PremiumMembershipInvoice.devFeePercent` + `devFeeAmountCents`. They are
never re-derived from env at read time — the snapshot in the invoice row is
the source of truth for historical accounting.

Keep `baseAmountCents + ceil(baseAmountCents * devFeePercent/100) = grossAmountCents`
(the gross price the customer sees). Verify the math before going live.

### 1.3 Create the annual Price

Click **Add price** again on the same product.

| Field          | Value                              |
| -------------- | ---------------------------------- |
| Pricing model  | Standard pricing                   |
| Billing period | Yearly                             |
| Price          | R$ YY,YY (set by pricing decision) |
| Currency       | BRL                                |
| Lookup key     | `premium_gold_annual`              |

Under **Additional options → Metadata**, add the same keys:

| Key               | Value                                                         |
| ----------------- | ------------------------------------------------------------- |
| `baseAmountCents` | `<annual_price_in_cents_excluding_devfee>`                    |
| `devFeePercent`   | `10` (match the monthly value unless intentionally different) |

### 1.4 Stripe Tax — Brazilian VAT behavior

Stripe Tax for Brazil handles IOF, PIS, and COFINS automatically when:

1. The product's **Tax code** is set to `txcd_20030000` (SaaS).
2. **Tax behavior** on each Price is set to **Inclusive**.
3. The Stripe account has **Tax** enabled (Stripe Dashboard → Tax → Get started).
4. The customer's billing address is collected at checkout (Stripe Checkout
   `billing_address_collection: 'required'`).

No application code is required. Stripe computes and remits the tax.

---

## 2. Webhook endpoint

### 2.1 Register the endpoint

1. Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**.
2. Set the URL:
   - **Staging / smoke:** `https://api-preview.jdm-experience.com/webhooks/stripe-billing`
     (or your Railway preview URL)
   - **Production:** `https://api.jdm-experience.com/webhooks/stripe-billing`
3. Under **Select events to listen to**, add exactly these events:

   | Event                           | Why                                                       |
   | ------------------------------- | --------------------------------------------------------- |
   | `invoice.paid`                  | Subscription activation (create) + renewal (cycle)        |
   | `invoice.payment_failed`        | Moves membership to `past_due`                            |
   | `customer.subscription.updated` | Cancel-at-period-end, uncancellation, cadence/tier change |
   | `customer.subscription.deleted` | Natural expiry                                            |
   | `charge.refunded`               | Invoice refund accounting (canon §F8.10)                  |

4. Click **Add endpoint**. Reveal and copy the **Signing secret** (`whsec_...`).
5. Set `STRIPE_BILLING_WEBHOOK_SECRET=whsec_...` in Railway (API service → Variables).
   This is a **separate** secret from `STRIPE_WEBHOOK_SECRET` (the one-time ticket
   purchase webhook).

### 2.2 Test the endpoint

In test mode, use the Stripe CLI to verify delivery:

```bash
stripe listen --forward-to https://<preview-api>/webhooks/stripe-billing
stripe trigger invoice.paid
```
````

Expected: the CLI prints `200 OK` for each forwarded event. Check Railway logs
for the billing handler's structured log output.

---

## 3. Stripe Billing Portal

Enable the hosted billing portal for Stripe-paid users to manage their subscription
(cancel, update payment method, view invoice history):

1. Stripe Dashboard → **Settings** → **Billing** → **Customer portal**.
2. Enable the portal. Under **Cancellations**, choose **Cancel immediately** or
   **At end of billing period** (recommend "At end of billing period" — maps to
   `cancel_at_period_end=true`).
3. Enable **Invoice history**.
4. Save. No code change required; the API creates portal sessions server-side
   via `stripe.billingPortal.sessions.create({ customer, returnUrl })`.

---

## 4. Test cards (smoke reference)

| Card number           | Behavior                    |
| --------------------- | --------------------------- |
| `4242 4242 4242 4242` | Successful payment          |
| `4000 0025 0000 3155` | Requires 3DS authentication |
| `4000 0000 0000 9995` | Declined                    |

Use any future expiry, any CVC, any postal code.

---

## 5. Environment variable checklist

| Variable                        | Where set     | Notes                                                     |
| ------------------------------- | ------------- | --------------------------------------------------------- |
| `STRIPE_SECRET_KEY`             | Railway       | `sk_test_...` for test mode; `sk_live_...` for production |
| `STRIPE_BILLING_WEBHOOK_SECRET` | Railway       | Signing secret from the billing endpoint above            |
| `STRIPE_WEBHOOK_SECRET`         | Railway       | Existing one-time ticket webhook; unchanged               |
| `STRIPE_PUBLISHABLE_KEY`        | Railway + EAS | `pk_test_...` / `pk_live_...`                             |

Never commit any `sk_` or `whsec_` values. They live in Railway Variables only.

````

- [ ] **Step 2: Verify the file exists and is well-formed**

```bash
wc -l docs/stripe.md
````

Expected: non-zero line count, no error.

- [ ] **Step 3: Commit**

```bash
git add docs/stripe.md
git commit -m "docs(billing): Stripe Dashboard config — Product, Prices, webhook, Tax (F8.19)"
```

---

## Task 2: Author `docs/revenuecat.md`

**Files:**

- Create: `docs/revenuecat.md`

- [ ] **Step 1: Create `docs/revenuecat.md`**

```markdown
# RevenueCat dashboard configuration

How to configure RevenueCat for JDM Experience iOS billing. This is operational
setup only — no application code changes. Apply once; keep in sync as App Store
Connect subscription settings change.

---

## 1. Create the RevenueCat project

1. Log in at https://app.revenuecat.com/.
2. Click **+ New project** → name it `jdm-experience`.
3. Note the project ID — it will appear in the project settings URL.

---

## 2. Add the iOS app

1. In the project, click **Apps** → **+ New app**.
2. Platform: **App Store**.
3. Fill the fields:

   | Field                    | Value                                                   |
   | ------------------------ | ------------------------------------------------------- |
   | App name                 | `JDM Experience`                                        |
   | Bundle ID                | `com.jdmexperience.app`                                 |
   | App Store Connect App ID | (from App Store Connect → App Information → Apple ID)   |
   | iOS public key           | Generated by RC; copy into `EXPO_PUBLIC_RC_IOS_API_KEY` |

4. Under **App Store Connect API** → link the App Store Connect API key:
   - Key ID: (from App Store Connect → Users and Access → Keys → App Store Connect API)
   - Issuer ID: (same page)
   - `.p8` private key: upload once; RC will manage subscription status updates
     automatically.

### 2.1 Subscription group in App Store Connect

Create the subscription group before linking SKUs in RC.

1. App Store Connect → your app → **Subscriptions** → **+ Subscription Group**.
2. Group reference name: `JDM Premium Gold`.
3. Create two subscriptions inside the group:

   | Reference name             | Product ID                              | Duration |
   | -------------------------- | --------------------------------------- | -------- |
   | `JDM Premium Gold Monthly` | `com.jdmexperience.app.premium.monthly` | 1 month  |
   | `JDM Premium Gold Annual`  | `com.jdmexperience.app.premium.annual`  | 1 year   |

4. Set pricing for each (BRL tier). Annual should be priced below 12x monthly
   as an incentive.
5. Confirm both subscriptions are in **Ready to Submit** state before TestFlight smoke.

---

## 3. Entitlements

1. RC Dashboard → **Entitlements** → **+ New entitlement**.
2. Name: `premium_gold`. Identifier: `premium_gold`.
3. This is the single entitlement for v1. All `active` + `cancel_scheduled`
   memberships satisfy it.

---

## 4. Products

Register the two App Store SKUs in RC:

1. RC Dashboard → **Products** → **+ New product**.
2. Add `com.jdmexperience.app.premium.monthly` (type: Auto-Renewable Subscription).
3. Add `com.jdmexperience.app.premium.annual` (type: Auto-Renewable Subscription).
4. Attach both products to the `premium_gold` entitlement.

---

## 5. Offerings

1. RC Dashboard → **Offerings** → **+ New offering**.
2. Identifier: `premium_gold_default`. Set as **Default**.
3. Add a package:
   - Identifier: `$rc_monthly` (RC well-known monthly identifier).
   - Product: `com.jdmexperience.app.premium.monthly`.
4. Add a second package:
   - Identifier: `$rc_annual` (RC well-known annual identifier).
   - Product: `com.jdmexperience.app.premium.annual`.
5. This offering is what the mobile `PremiumScreen` fetches via
   `Purchases.getOfferings()`.

---

## 6. Webhook endpoint

### 6.1 Register

1. RC Dashboard → **Project Settings** → **Webhooks** → **+ New webhook**.
2. URL:
   - **Staging / smoke:** `https://api-preview.jdm-experience.com/webhooks/revenuecat`
   - **Production:** `https://api.jdm-experience.com/webhooks/revenuecat`
3. Authorization header: generate a random 32-byte hex token. Set it as:
   - RC Dashboard → webhook **Authorization** field: `Bearer <token>`
   - Railway API Variables: `REVENUECAT_WEBHOOK_AUTH_HEADER=<token>`
4. Enable **all event types** for now (the handler logs + acks unknown types without
   writing DB rows; disabling them later is an ops-level tweak).

### 6.2 Test the endpoint

From the RC Dashboard → Webhooks → your endpoint → **Send test webhook**.
Expected: Railway API logs `revenuecat_webhook.received { type: TEST_EVENT }` and
the endpoint responds 200.

---

## 7. REST API key (reconciliation)

The hourly reconciliation sweep (`apps/api/src/workers/billing-reconcile.ts`) calls
RC's REST API to verify subscriber state when webhooks are delayed.

1. RC Dashboard → **Project Settings** → **API Keys** → **+ New secret key**.
2. Name: `jdm-api-reconciliation`. Access level: **Read-only**.
3. Copy the key into Railway: `REVENUECAT_REST_API_KEY=<key>`.

The reconciliation sweep uses this key to call `GET /v1/subscribers/{app_user_id}`
(where `app_user_id = garageId` per the RC SDK init in `apps/mobile/src/lib/revenuecat.ts`).

---

## 8. Environment variables

| Variable                         | Where set                   | Notes                                  |
| -------------------------------- | --------------------------- | -------------------------------------- |
| `EXPO_PUBLIC_RC_IOS_API_KEY`     | EAS Secrets + mobile `.env` | iOS public key from the RC app         |
| `REVENUECAT_WEBHOOK_AUTH_HEADER` | Railway                     | Bearer token for incoming RC webhooks  |
| `REVENUECAT_REST_API_KEY`        | Railway                     | Read-only key for reconciliation sweep |

The iOS API key (`EXPO_PUBLIC_RC_IOS_API_KEY`) is safe to commit to `app.config.ts`
as an env placeholder; the actual value lives in EAS Secrets and local `.env`.
The webhook auth token and REST API key are server-only secrets — Railway only.

---

## 9. Sandbox testing

To smoke-test RC flows before TestFlight:

1. In Xcode → scheme editor, use a **Sandbox Apple ID** (Settings → App Store → Sandbox Account
   on the device, or create one in App Store Connect → Users and Access → Sandbox Testers).
2. RC Dashboard → **Customer** lookup by `app_user_id` (= garageId) to verify
   entitlement state after a sandbox purchase.
3. Sandbox subscriptions auto-renew at accelerated cadence (1 month = ~5 min in sandbox).
   Use this to smoke the renewal webhook handler.
4. Cancel via Settings → Apple ID → Subscriptions on the device.
   Expected: `CANCELLATION` webhook fires → membership transitions to `cancel_scheduled`.
5. Wait for expiry (accelerated): `EXPIRATION` webhook fires →
   membership transitions to `expired` → Garage snapshot cleared.
```

- [ ] **Step 2: Verify the file exists**

```bash
wc -l docs/revenuecat.md
```

Expected: non-zero line count.

- [ ] **Step 3: Commit**

```bash
git add docs/revenuecat.md
git commit -m "docs(billing): RevenueCat dashboard config — app, offerings, entitlements, webhook (F8.19)"
```

---

## Task 3: Extend `docs/manual-testing.md` with F8 smoke checklist

**Files:**

- Modify: `docs/manual-testing.md`

This task appends a new section `### 3.9 F8 Premium subscription smoke` to the
existing `## 3. Existing smoke playbooks` section of `docs/manual-testing.md`.

Note: The file already references "F8 Premium subscription + grant backfill" in
§"Future playbooks to author" (line ~97). Section 3.9 replaces that placeholder
with the full smoke.

TDD does not apply here — this is a documentation task with no test code.

- [ ] **Step 1: Locate the anchor line in `docs/manual-testing.md`**

Open `docs/manual-testing.md` and find the section header `### 3.8 F10 marketing push preference opt-out`.
The new section `### 3.9 F8 Premium subscription smoke` will be appended after
`### 3.8`'s content, before the `## 4. Roles` section.

Also find the "Future playbooks" bullet:

```
- F8 Premium subscription + grant backfill.
```

and change it to:

```
- F8b Annual-vs-monthly upgrade mid-cycle (future).
```

- [ ] **Step 2: Add the section**

Add the following new section immediately before `## 4. Roles` in
`docs/manual-testing.md`:

````markdown
### 3.9 F8 Premium subscription smoke

Covers Stripe test-mode and RevenueCat sandbox billing flows end-to-end.
Run after all 19 F8 chunks have merged and before flipping
`GROWTH_PREMIUM_BILLING_ENABLED` in Railway.

**Prerequisites (all required)**

- All 19 F8 chunks merged to `main` and deployed to the Railway preview environment.
- `GROWTH_PREMIUM_BILLING_ENABLED=true` set in the **preview** Railway service
  (NOT production yet — the flag stays `false` in production until this smoke passes).
- Stripe CLI installed: `brew install stripe/stripe-cli/stripe`.
- Stripe CLI logged in: `stripe login`.
- Stripe test-mode secret key (`sk_test_...`) and billing webhook secret
  (`whsec_...`) set in the preview API environment.
- RC sandbox Apple ID registered (App Store Connect → Users → Sandbox Testers).
- TestFlight preview build installed on an iPhone (from `eas build --profile preview`).
- An organizer admin account with at least one published future event that has a
  `TicketTier.isPremiumGrantable = true` tier.
- Stripe Billing Portal enabled (see `docs/stripe.md §3`).

**Step 1 — Start the Stripe CLI billing listener (terminal A)**

```bash
stripe listen --forward-to https://<preview-api>/webhooks/stripe-billing
```
````

Leave this running. Copy the printed `whsec_...` into the preview Railway
`STRIPE_BILLING_WEBHOOK_SECRET` variable if not already set. Redeploy.

**Step 2 — Stripe: monthly subscribe (web / Android path)**

1. Open `https://<preview-admin>/premium` while signed in as a test user.
2. Click **Assinar Gold** (monthly card).
3. In the Stripe Checkout page, enter test card `4242 4242 4242 4242` /
   future expiry / any CVC / any zip.
4. Complete the payment.

Expected:

- Browser redirects back to `/me/billing` (or the configured `successUrl`).
- Terminal A prints: `invoice.paid → forwarded → 200 OK`.
- In the Railway preview API logs:
  `billing_event.applied { kind: "subscription.activated", provider: "stripe" }`.
- DB (Railway → Postgres → Prisma Studio or `psql`):
  `SELECT status, tier, cadence FROM "PremiumMembership" WHERE "garageId" = '<id>'`
  → `active | gold | monthly`.
- `SELECT "premiumTier", "premiumUntil" FROM "Garage" WHERE id = '<id>'`
  → `gold | <now + 1 month>`.
- Admin `/financeiro`: "Membros Ativos" KPI increments by 1. Invoice appears
  in `/financeiro/membros`.
- XP: `SELECT delta, reason FROM "XpEvent" WHERE "garageId" = '<id>'`
  → one row with `reason = 'premium_activation'`, `delta = 200`.

**Step 3 — Stripe: verify backfill**

After activation, the post-commit backfill worker should have run.

Expected:

- `SELECT * FROM "Ticket" WHERE "userId" = '<uid>' AND source = 'premium_grant'`
  → one row per published future event that has a grantable tier.
- If an event has no grantable tier: Railway API logs contain
  `premium_grant.no_tier { eventId: '<id>' }`.

**Step 4 — Stripe: annual subscribe (web path)**

Repeat step 2 with the **annual** card selected. Use a second test user.

Expected: same as step 2 but `cadence = annual`. `currentPeriodEnd` is ~1 year out.
Admin `/financeiro` MRR tile: `Math.round(gross/12)` added (not full gross).

**Step 5 — Stripe: cancel at period end**

1. Signed in as the monthly subscriber from step 2, open `/me/billing`.
2. Click **Gerenciar assinatura** → Stripe Billing Portal opens.
3. In the portal, click **Cancel plan** → confirm.
4. Close the portal tab.

Expected:

- Terminal A prints: `customer.subscription.updated → forwarded → 200 OK`.
- Railway API logs: `billing_event.applied { kind: "subscription.cancelled" }`.
- DB: `PremiumMembership.status = 'cancel_scheduled'`,
  `cancelAtPeriodEnd = true`, `cancelledAt` set.
- `Garage.premiumTier` and `premiumUntil` unchanged (entitlement persists
  through current period).
- Admin `/financeiro/membros`: row shows `cancel_scheduled` status.

**Step 6 — Stripe: refund flow**

1. In Stripe Dashboard → Payments → find the latest charge for the monthly
   subscriber.
2. Click **Refund** → full refund.
3. Observe Terminal A: `charge.refunded → forwarded → 200 OK`.

Expected:

- DB: `PremiumMembershipInvoice.status = 'refunded'`, `refundedAt` set.
- `PremiumMembership.status` unchanged (still `cancel_scheduled`).
- Entitlement persists through `currentPeriodEnd` (canon §F8.10).

**Step 7 — RevenueCat sandbox: iOS subscribe via TestFlight**

1. On the iPhone with the TestFlight build, sign in as the RC sandbox test user.
2. Open **Settings → Premium** in the app.
3. Tap **Assinar Gold** (monthly or annual).
4. The native StoreKit sheet appears. Confirm with the sandbox Apple ID.

Expected:

- RC Dashboard → Customers → find by garageId: entitlement `premium_gold` shows
  `active`.
- Railway API logs (or Railway log stream): `billing_event.applied { kind:
"subscription.activated", provider: "apple_revenuecat" }`.
- DB:
  - `SELECT status, provider FROM "PremiumMembership"` → `active | apple_revenuecat`.
  - `SELECT "devFeePercent" FROM "PremiumMembershipInvoice"` → `0` (Apple/RC path
    always sets devFeePercent = 0 per canon §F8.1).
  - `Garage.premiumTier = 'gold'`.
- Ticket backfill runs as in step 3.

**Step 8 — RevenueCat sandbox: expiration triggers reconciliation**

Sandbox subscriptions renew at accelerated cadence (~5 minutes for a monthly plan).
Wait for one renewal to confirm the `invoice.renewed` DB row appears. Then:

1. Cancel the subscription via **Settings → Apple ID → Subscriptions** on the iPhone.
2. Expected: `CANCELLATION` RC webhook fires →
   `PremiumMembership.status = 'cancel_scheduled'`.
3. Wait for the sandbox subscription to expire (~5 minutes after cancellation).
4. Expected: `EXPIRATION` RC webhook fires →
   `PremiumMembership.status = 'expired'` → `Garage.premiumTier = null`,
   `Garage.premiumUntil = null`.

If the webhook is delayed: the hourly reconciliation sweep
(`billing-reconcile.ts`) catches the drift. In the smoke environment you can
trigger it manually via the worker cron or a direct API call (if a debug trigger
endpoint is wired for the sweep).

**Step 9 — Non-BR storefront filter check**

Send a synthetic RC event with `country_code != 'BR'` to the preview webhook
endpoint. You can do this with `curl`:

```bash
curl -s -X POST \
  -H "Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH_HEADER>" \
  -H "Content-Type: application/json" \
  https://<preview-api>/webhooks/revenuecat \
  -d '{
    "event": {
      "type": "INITIAL_PURCHASE",
      "id": "test-non-br-01",
      "app_user_id": "garage-smoke-001",
      "country_code": "US",
      "product_id": "com.jdmexperience.app.premium.monthly",
      "currency": "USD",
      "price_in_purchased_currency": 9.99,
      "period_type": "NORMAL"
    }
  }'
```

Expected: `200 OK`. No `PremiumMembership` row created.
Railway API logs contain `premium_rc.non_br_storefront { providerEventId: "test-non-br-01", country_code: "US" }` (canon §F8.9).

**Step 10 — `checkout-precheck` cross-platform dup guard**

With the iOS-subscribed user from step 7 also logged in on a web session:

1. Open `https://<preview-admin>/premium` in the browser.
2. Attempt to start a Stripe checkout (click "Assinar").
3. The client calls `GET /api/me/premium/checkout-precheck` first.

Expected: API returns `409 { error: 'AlreadySubscribed', provider: 'apple_revenuecat', manageUrl: ... }`.
The web UI shows a "Você já tem o Premium Gold ativo" message with a link to manage
via App Store Settings.

**Pass criteria**

All "Expected" results in steps 1–10 must match. Do not flip the production flag
until all 10 steps pass and evidence is attached.

**Evidence to attach**

- Screenshot of admin `/financeiro` with "Membros Ativos" KPI after step 2.
- DB query output for `PremiumMembership` + `Garage` after steps 2, 4, 5, 7.
- Railway log excerpt showing `billing_event.applied` for each provider.
- RC Dashboard screenshot of entitlement `premium_gold` active (step 7).
- Terminal A Stripe CLI output for steps 2–6.
- DB evidence of `PremiumMembershipInvoice.devFeePercent = 0` for RC path (step 7).
- DB evidence of `PremiumMembershipInvoice.status = 'refunded'` after step 6.
- Screenshot of 409 response for the dup-subscribe guard (step 10).

**Production flag flip — deploy ordering**

Only after all 10 steps pass and evidence is attached to the Paperclip F8.19 issue:

1. Railway → Production API service → Variables:
   - Change `GROWTH_PREMIUM_BILLING_ENABLED` from `false` to `true`
   - (or remove the override entirely — the code default is now `true`)
2. Railway auto-redeploys. Verify `/health` returns 200.
3. Verify the Stripe live-mode webhook is registered and delivering.
4. Verify RC production app is pointing at `https://api.jdm-experience.com/webhooks/revenuecat`.
5. Do a single live-mode monthly subscribe on the web as a final sanity check
   (use a real card; refund it immediately via the Billing Portal).

**Common failures**

| Symptom                                                     | Fix                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GROWTH_PREMIUM_BILLING_ENABLED` route returns 503          | Flag is `false` in this env. Set to `true` in Railway Variables and redeploy.                        |
| `invoice.paid` fires but no `PremiumMembership` row appears | Check `STRIPE_BILLING_WEBHOOK_SECRET` matches the Stripe CLI / Dashboard signing secret.             |
| RC webhook returns 401                                      | `REVENUECAT_WEBHOOK_AUTH_HEADER` in Railway does not match the token set in RC Dashboard.            |
| Backfill tickets not appearing (step 3)                     | Check the background worker is enabled (`WORKER_ENABLED=true`) and the job queue is running.         |
| XP not awarded after activation                             | Verify `sourceRef = 'garage:<garageId>'` in the XpEvent row. Prior admin grant may have consumed it. |
| Reconciliation not catching RC expiry                       | Check `REVENUECAT_REST_API_KEY` is set and has read-only access to the correct RC project.           |

```

- [ ] **Step 3: Also update the "Future playbooks" bullet**

In `docs/manual-testing.md`, locate:
```

- F8 Premium subscription + grant backfill.

```
and replace it with:
```

- F8b Annual-vs-monthly upgrade mid-cycle (future).

````

- [ ] **Step 4: Run a quick sanity check**

```bash
grep -n "3.9" docs/manual-testing.md
````

Expected: one line showing `### 3.9 F8 Premium subscription smoke`.

- [ ] **Step 5: Commit**

```bash
git add docs/manual-testing.md
git commit -m "docs(testing): add F8 premium subscription smoke checklist to manual-testing.md (§3.9)"
```

---

## Task 4: Flip `GROWTH_PREMIUM_BILLING_ENABLED` default in `apps/api/src/env.ts`

**Files:**

- Modify: `apps/api/src/env.ts`

CAUTION: This is a one-line change. The Railway env override `GROWTH_PREMIUM_BILLING_ENABLED=false`
MUST remain in place until the smoke (Task 3) passes. The code default only becomes the
effective runtime value when the override is removed (or set to `true`). Do not remove
the Railway override as part of this chunk — that is a manual post-smoke ops step.

> **CORRECTED 2026-05-28 (orchestrator pre-dispatch, gap #32 + gap #7):** The
> F8.01 entry is NOT `z.coerce.boolean().default(false)`. The actual shape on
> `main` is an enum-transform. The edit below matches the real code. This task
> ALSO flips the `env.test.ts` default assertion (Step 3) — gap #7.

- [ ] **Step 1: Read `apps/api/src/env.ts` to confirm current line**

The F8.01 chunk added this entry to `envSchema` (verified on `main`):

```ts
  GROWTH_PREMIUM_BILLING_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
```

This task changes `.default('false')` to `.default('true')`.

- [ ] **Step 2: Edit `apps/api/src/env.ts`**

Locate the entry above and replace it with:

```typescript
  // Default true — Railway override controls the effective value at runtime.
  // IMPORTANT: keep GROWTH_PREMIUM_BILLING_ENABLED=false in Railway Variables
  // until F8.19 smoke passes. Remove (or flip to true) only after all 10 smoke
  // steps pass and evidence is attached to the F8.19 Paperclip issue.
  // This code default is the FALLBACK for new deploys after the flag goes live.
  GROWTH_PREMIUM_BILLING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
```

- [ ] **Step 3: Flip the `env.test.ts` default assertion (gap #7 — REQUIRED)**

The default flip breaks `apps/api/test/env.test.ts:19-21`, which asserts the
flag defaults to `false`. Update that one test only. Open the file and locate:

```typescript
it('GROWTH_PREMIUM_BILLING_ENABLED defaults to false when absent', () => {
  const env = loadEnv({ ...baseEnv });
  expect(env.GROWTH_PREMIUM_BILLING_ENABLED).toBe(false);
});
```

Replace with:

```typescript
it('GROWTH_PREMIUM_BILLING_ENABLED defaults to true when absent', () => {
  const env = loadEnv({ ...baseEnv });
  expect(env.GROWTH_PREMIUM_BILLING_ENABLED).toBe(true);
});
```

Do NOT touch the two explicit-parse tests (`parses "true"` / `parses "false"`) —
they pass regardless of the default.

- [ ] **Step 4: Typecheck + run the env test**

```bash
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api exec vitest run test/env.test.ts
```

Expected: 0 typecheck errors; env.test.ts all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/env.ts apps/api/test/env.test.ts
git commit -m "feat(api): flip GROWTH_PREMIUM_BILLING_ENABLED default to true after smoke passes (F8.19)

CAUTION: Railway override must stay false until F8.19 smoke evidence is attached.
The Railway env var controls the effective value; this code default is the fallback
only — it activates when the override is removed post-smoke.

env.test.ts default assertion flipped false -> true (gap #7)."
```

---

## Task 5: Mirror feature flag in `apps/mobile/app.config.ts` — ALREADY DONE

> **CORRECTED 2026-05-28 (orchestrator pre-dispatch):** F8.18 (commit `ed13757a`)
> ALREADY added `premiumBillingEnabled` to the `extra` block. This task is now
> VERIFY-ONLY. Do NOT add a duplicate key.

**Files:**

- Verify only: `apps/mobile/app.config.ts`

- [ ] **Step 1: Confirm the flag already exists**

```bash
grep -n 'premiumBillingEnabled' apps/mobile/app.config.ts
```

Expected: one match — `premiumBillingEnabled: process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED === 'true',`
(currently `apps/mobile/app.config.ts:134`, inside the `extra` block, after `rcIosApiKey`).

If the match is present: this task is complete, no edit, no commit. Skip to Task 6.

If (and only if) the match is ABSENT: add it to the `extra` block after
`rcIosApiKey`, then `pnpm --filter @ccc/mobile typecheck` and commit with
`feat(mobile): add EXPO_PUBLIC_PREMIUM_BILLING_ENABLED to app.config extra (F8.19)`.

The mobile app reads this from `Constants.expoConfig?.extra?.premiumBillingEnabled`
to conditionally render the Premium subscribe CTA (canon §F8.11 — disabled state
returns 503 from the server anyway; the client gate is defense-in-depth for UX).
EAS env var `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` must be set to `true` in the EAS
preview profile after the server flag flips.

---

## Task 6: Overwrite `.handoffs/orchestrator-state.md` — record F8 completion

**Files:**

- Overwrite: `.handoffs/orchestrator-state.md`

- [ ] **Step 1: Write the new orchestrator state file**

````markdown
# Orchestrator state — F8 completion

**Date:** 2026-05-26  
**Phase:** F8 Premium Membership Billing — COMPLETE (19 chunks merged)  
**Main tip at F8 closeout:** (update with actual SHA after all 19 PRs merge)

---

## F8 dispatch summary

| Wave | Chunks                        | Status   |
| ---- | ----------------------------- | -------- |
| A    | F8.01 → F8.02 → F8.03         | COMPLETE |
| B    | F8.04 ‖ F8.05                 | COMPLETE |
| C    | F8.06 ‖ F8.07 ‖ F8.08         | COMPLETE |
| D    | F8.09 ‖ F8.10 ‖ F8.11         | COMPLETE |
| E    | F8.12                         | COMPLETE |
| F    | F8.13 ‖ F8.14 → F8.15 ‖ F8.16 | COMPLETE |
| G    | F8.17 ‖ F8.18                 | COMPLETE |
| H    | F8.19                         | COMPLETE |

All 19 chunks merged to `main`. Feature flag `GROWTH_PREMIUM_BILLING_ENABLED`
flipped to `true` in Railway production after F8.19 smoke evidence attached.

---

## Canon carried forward (F8 + Phase 2)

**Phase 2 §C1–§C14** carry forward unchanged.

**F8 canon §F8.1–§F8.16** — all load-bearing. Key entries:

- §F8.1: `devFeePercent` snapshotted at time-of-charge; never re-derived from env.
- §F8.2: `sourceRef = 'garage:<garageId>'` for XP `premium_activation` — one-shot-ever.
- §F8.3: `Garage.premiumUntil = max(existing, new)` — admin grants never clobbered.
- §F8.4: Activation tx atomicity — Membership + Invoice + Garage + XP in one tx.
- §F8.5: `SELECT garage FOR UPDATE` at tx start — closes webhook race.
- §F8.6: Single `awardXp` per activation tx — SAVEPOINT collision guard.
- §F8.7: Premium-grant tier selection — first `isPremiumGrantable = true` tier; skip + log if none.
- §F8.8: Partial unique on Ticket `(userId, eventId) WHERE status='valid' AND source='premium_grant'` (narrowed; see spec §2.6).
- §F8.9: Non-BR RC events — 200-OK ack, no DB writes.
- §F8.10: Refund honors period end — entitlement persists; invoice status flips only.
- §F8.11: Feature flag `GROWTH_PREMIUM_BILLING_ENABLED` — now default `true` post-smoke.
- §F8.12: Filtered test command shape (same as Phase 2 §10).
- §F8.13: Rebuild `@ccc/shared` after schema/export changes.
- §F8.14: UI dep + harness in same chunk.
- §F8.15: Webhook idempotency two-layer model.
- §F8.16: iOS bundle isolation — no Stripe references in iOS-conditional code.

---

## Phase F8.1 backlog (deferred from F8 v1)

Items deferred per spec §10 + brainstorm. None of these block the F8 launch.
Track as a future phase.

| Item                                                       | Spec ref     | Notes                                   |
| ---------------------------------------------------------- | ------------ | --------------------------------------- |
| Trial period (free 7/14 day)                               | §10 + §1     | Schema reserves `trialing` enum value.  |
| Dunning push notifications + receipt emails                | §10          | Brainstorm-out-of-scope for v1.         |
| Family / gift subscriptions                                | §10          | Schema open for future tiers.           |
| Promo codes / coupons                                      | §10          | Stripe Coupons API ready to wire.       |
| Cohort retention dashboard (`/finance/membership-cohorts`) | §10          | Needs separate UX brief.                |
| Animated "Welcome to Gold" splash                          | §10          | UI polish; low priority.                |
| Per-tier perk-gating (silver, bronze)                      | §10 §1       | Schema enum ready (`bronze`, `silver`). |
| Google Play Billing (Android RC path)                      | §11 risk     | Depends on Play Store review feedback.  |
| Multi-call `awardXp` SAVEPOINT fix                         | §4.7 + §F8.6 | Awarder-level fix; separate chunk.      |

---

## Active worktrees at F8 closeout

All F8 chunk worktrees are safe to remove after their respective PRs merge.
Remove with:

```bash
git worktree remove .claude/worktrees/agent-f8-billing-<NN>
```
````

---

## Next phase

No next phase planned at F8 closeout. The Phase F8.1 backlog items above are the
natural candidates. Await product/CEO direction before dispatching Phase F8.1.

Load-bearing invariants from both Phase 2 (§C1–§C14) and F8 (§F8.1–§F8.16) apply
to all future work that touches the billing, XP, premium, or ticket surfaces.

````

- [ ] **Step 2: Verify the file is valid**

```bash
wc -l .handoffs/orchestrator-state.md
````

Expected: more lines than the prior state file (non-trivially sized).

- [ ] **Step 3: Commit**

```bash
git add .handoffs/orchestrator-state.md
git commit -m "chore(handoff): record F8 billing completion — 19 chunks merged, Phase F8.1 backlog (F8.19)"
```

---

## Task 7: Open the PR

- [ ] **Step 1: Branch preflight**

```bash
git branch --show-current
```

Expected: `feat/jdma-f8-billing-19`. If on `production`, STOP.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin feat/jdma-f8-billing-19
```

Open PR to `main`. Title: `docs(billing): F8.19 — smoke runbook, Stripe + RC config, flag flip + handoff`

PR body template:

```markdown
## Summary

- Adds `docs/stripe.md`: Stripe Dashboard config (Product, Prices metadata,
  webhook endpoint events, Tax behavior, Billing Portal, env checklist).
- Adds `docs/revenuecat.md`: RC dashboard config (iOS app, App Store Connect
  subscription group + SKUs, Offerings + Entitlements, webhook auth header,
  REST API key for reconciliation).
- Extends `docs/manual-testing.md §3.9`: F8 smoke checklist covering
  Stripe test-mode monthly + annual subscribe, cancel, refund; RC sandbox
  subscribe via TestFlight, expiration, reconciliation; non-BR storefront
  filter; cross-platform dup-subscribe guard (10 steps, evidence requirements,
  production flag-flip deploy ordering).
- Flips `GROWTH_PREMIUM_BILLING_ENABLED` code default to `true` in
  `apps/api/src/env.ts`. CAUTION: Railway override must remain `false` until
  smoke evidence is attached (see deploy ordering in §3.9 and inline comment).
- Adds `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` to `apps/mobile/app.config.ts`
  `extra` block for client-side gate (defense-in-depth; server is the authority).
- Overwrites `.handoffs/orchestrator-state.md` with F8 completion record,
  §F8.1–§F8.16 canon forward, and Phase F8.1 deferred backlog.

## Verification

Manual only (TDD not applicable for smoke runbook docs). Code changes:

- `apps/api/src/env.ts` typecheck: 0 errors.
- `apps/mobile/app.config.ts` typecheck: 0 errors.

## Deploy ordering (CRITICAL — do not skip)

1. Merge this PR.
2. Deploy to Railway preview.
3. Run all 10 steps in `docs/manual-testing.md §3.9`. Attach evidence.
4. Only after evidence attached: flip `GROWTH_PREMIUM_BILLING_ENABLED=true`
   in Railway PRODUCTION (or remove the override — the code default now `true`).
5. Flip `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED=true` in EAS preview + production.

Canon refs: §F8.11 (feature flag gate), §F8.9 (non-BR RC), §F8.10 (refund),
§F8.1 (devFeePercent snapshot), §F8.3 (Garage max() rule).
```

---

## Verification summary (touched paths only)

```bash
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/mobile typecheck
```

Expected: 0 errors on both. No vitest runs — this chunk has no new test code.

---

## Corrections + deviations

1. **TDD not applicable** for the smoke runbook (§3.9 in `docs/manual-testing.md`).
   The manual smoke runbook IS the verification artifact for this chunk. The only
   code changes (`env.ts` default flip + `app.config.ts` extra field) are trivial
   one-liners verified by typecheck only.

2. **`app.config.ts` not `app.json`**: the skeleton listed `apps/mobile/app.json`
   as the file to modify. The JDM Experience mobile app uses `app.config.ts` (a TS
   config file), not a static `app.json`. The `extra` block is at
   `apps/mobile/app.config.ts:119`. This deviation is correct.

3. **Orchestrator state overwrites prior Phase 2 state**: the prior
   `.handoffs/orchestrator-state.md` records Phase 2 chunk 40 + 41 state. F8.19
   replaces it entirely per the skeleton's "Overwrite" instruction. Phase 2 history
   is preserved in git log.

4. **`stripe.md` is a new file** (the `docs/` directory has no existing `stripe.md`
   as of plan-write). `docs/revenuecat.md` is also new. Both are dashboard-config
   docs, not code.

5. **env.test.ts default assertion flip** (gap #7): the default-`true` change
   breaks `apps/api/test/env.test.ts:19-21` (`defaults to false`). Task 4 Step 3
   now handles this inline — flip the assertion to `.toBe(true)` and rename the
   test. The two explicit-parse tests stay untouched. Run
   `pnpm --filter @ccc/api exec vitest run test/env.test.ts` before committing.

6. **Task 5 is verify-only**: F8.18 (commit `ed13757a`) already added
   `premiumBillingEnabled` to `apps/mobile/app.config.ts:134`. Do not add a
   duplicate. Task 5 confirms presence via grep and commits nothing if present.

---

## PR checklist

- [ ] `git branch --show-current` → must NOT be `production` (`CLAUDE.md` preflight).
- [ ] `git checkout main && git pull --ff-only origin main`.
- [ ] `git checkout -b feat/jdma-f8-billing-19`.
- [ ] Tasks 1 → 6 in order; one commit per task using the subjects above.
- [ ] `pnpm --filter @ccc/api typecheck` — 0 errors.
- [ ] `pnpm --filter @ccc/mobile typecheck` — 0 errors.
- [ ] `pnpm --filter @ccc/api exec vitest run test/env.test.ts` — update if default-value assertion fails (Deviation §5).
- [ ] `git push -u origin feat/jdma-f8-billing-19`.
- [ ] Open PR to `main` only. Never push to `production`.
- [ ] Request review on the PR per `CLAUDE.md`.
