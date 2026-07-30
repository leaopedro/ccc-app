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

---

## 6. Multi-tier subscriptions with add-on modules

### 6.1 Price creation workflow

1. In Stripe Dashboard, create one **Product** per plan (Bronze, Silver, Gold) and one
   per add-on module (Detailing, Workshop).

2. For each product, create **one monthly recurring Price in BRL**. All prices across
   the checkout — both plan and add-ons — must share the same interval (monthly or
   annual) and the same currency (BRL). Stripe combines plan and add-on prices into a
   single Checkout Session and rejects mixed intervals or currencies with a 503 error.

3. On each **plan price** (Bronze, Silver, Gold), fill the metadata field
   `devFeePercent` with a number like `10`. **This field is mandatory.** If omitted,
   the fee is recorded as `0` on both the invoice row and the membership — silently
   undercharging the customer. Add-on module prices do not need this metadata.

4. Copy the `price_...` ID from each Price (both plan and add-on) and paste it into
   the admin portal at `/premium/catalogo`, matching the plan tier or add-on key to
   the correct `stripePriceId` field.

5. Verify by calling `GET /api/plans` that all three plan tiers appear with their
   prices. If any `stripePriceId` field is empty on a plan, the checkout endpoint
   will return 503 with a list of exactly which fields are missing. For add-ons, an
   empty `stripePriceId` also returns 503 (only add-on modules selected by the member
   are validated at checkout time).

### 6.2 Common operator mistakes and their error symptoms

**Unknown or inactive add-on key:** If a member requests an add-on with a key that
does not exist in the catalog or is marked inactive, the checkout returns 400
BadRequest. This is a client error — the member sent a bad selection — not an operator
config problem.

**Missing plan or add-on price ID:** If the catalog references a Stripe Price ID that
no longer exists in Stripe, or if a plan or active add-on module has no `stripePriceId`
configured, the checkout returns 503 ServiceUnavailable. This signals an operator
misconfiguration. For add-ons, include the missing keys in the response; for plans, the
error message lists the missing field names.

**Mixed intervals or currencies:** If the plan price and any selected add-on price have
different billing intervals (e.g., monthly vs. annual) or different currencies, Stripe
rejects the Checkout Session creation with a 503. Ensure every Price — plan and all
add-ons in the catalog — uses the same interval and currency (monthly recurring, BRL).

### 6.3 Webhook behavior when invoice lines do not match the catalog

When `invoice.paid` webhook fires, the handler resolves each line item against the
`PremiumPlanPrice` and `PremiumAddonModule` catalog tables. Two scenarios cause the
webhook to refuse the invoice:

**Scenario A: No plan price match, or multiple distinct plan prices.** If zero lines
match a registered `PremiumPlanPrice`, or if lines match more than one **distinct**
registered plan price, the webhook responds with HTTP 200 (not an error to Stripe, since
Stripe must not redeliver — the fix is an operator action). The event is marked
processed in the audit table, a Sentry alert at error level is raised, and **no
membership is created or renewed**. The invoice remains unpaid from the application's
perspective.

The distinction is important: an invoice may legitimately carry two lines for the
**same** price (e.g., a proration credit on one date and a charge on another, both at
the same price across a billing cycle boundary). That is not ambiguous — both lines
resolve to one plan, and the membership applies normally. But two lines matching two
**different** registered plan prices (e.g., a plan-change invoice crediting the old
price and charging the new one) cannot be applied — the webhook does not know which
tier to activate or renew, so it refuses.

**Recovery:** After an invoice.paid refusal:

1. Examine the Sentry error alert to see which Stripe price IDs were on the invoice.
2. In the admin `/premium/catalogo`, verify that the missing price ID is registered in
   the correct plan row, and that the `devFeePercent` metadata is set in Stripe.
3. Call the member with the news: their payment was received by Stripe but the
   membership could not be activated because the price was not configured in the
   catalog. Tell them their payment is safe and will be kept.
4. Once the price is registered and verified in `/api/plans`, **the webhook does not
   automatically re-run** — the event is already marked processed. Contact a developer
   to manually trigger the invoice handler or re-create the membership row with the
   correct tier and cadence. Do not ask the member to pay again.

**Scenario B: Multiple add-on prices.** Unlike plan prices, add-on prices are allowed to
coexist on the same invoice (a member can add both Detailing and Workshop). No ambiguity
check applies to add-ons — all matching `PremiumAddonModule` rows are applied.
