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
