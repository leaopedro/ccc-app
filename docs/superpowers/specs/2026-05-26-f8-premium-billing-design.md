# F8 — Premium Membership billing (design spec)

**Date:** 2026-05-26
**Status:** Design approved; ready for plan-skeleton.
**Source brainstorm:** `plans/brainstorm.md` §F8 + handoff `.handoffs/orchestrator-state.md` Phase 2 closeout fork.
**Prior state:** premium _read_ paths fully wired across `apps/api`, `apps/admin`, `apps/mobile`. Activation entry point today is admin-grant only (`apps/api/src/routes/admin/user-garage.ts`). Self-serve recurring billing is greenfield. Schema has `Garage.premiumTier` + `Garage.premiumUntil`, `Ticket.source = premium_grant`, `XpReason.premium_activation` — all unused by self-serve.

This spec covers the **self-serve recurring billing surface**: schema deltas, Stripe + RevenueCat (Apple IAP) webhook flows, activation effects (XP + ticket backfill), event-publish-time grant, admin financial dashboard fold-in, reconciliation sweep, and migration plan.

---

## 1. Locked product decisions

| Decision                        | Value                                                                                               | Source                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Tier model v1                   | Single product "Premium Gold". Schema enum keeps `bronze`, `silver`, `gold` open for future tiers.  | Brainstorm session 2026-05-26.                                |
| Billing cadences                | Monthly + annual (two Stripe Prices on one Stripe Product).                                         | Brainstorm session.                                           |
| Checkout surface                | **iOS:** Apple StoreKit via RevenueCat SDK. **Android + web:** Stripe Checkout (mode=subscription). | Brainstorm session. App Store compliance.                     |
| Apple IAP abstraction           | RevenueCat (iOS only). Stripe direct for Android + web.                                             | Brainstorm session.                                           |
| Trial                           | None in v1. Schema reserves a `trialing` enum value; not used.                                      | Brainstorm session.                                           |
| Self-serve management           | Stripe Billing Portal (web link) for Stripe-paid users. iOS users → App Store Settings (native).    | Brainstorm session.                                           |
| Activation gate (Stripe)        | `invoice.paid` (first invoice). NOT `subscription.created`.                                         | Stripe best practice.                                         |
| Activation gate (RC)            | `INITIAL_PURCHASE`.                                                                                 | RC docs.                                                      |
| Devfee                          | Applies. Env-driven `DEV_FEE_PERCENT` (default 10) per `apps/api/src/services/pricing/dev-fee.ts`.  | Brainstorm + existing devfee pattern (ticket, store, extras). |
| Devfee user-facing              | **Seamless.** Only gross price shown anywhere on customer surfaces (mobile, web, receipts).         | Brainstorm session.                                           |
| Devfee admin-facing             | Full breakdown surfaced in `/admin/financeiro` dashboard.                                           | Brainstorm session + parity with existing ticket/store flows. |
| Currency                        | BRL only v1. Non-BR storefront RC events logged + acked without record.                             | Brainstorm + RC docs.                                         |
| Tier on Premium feature surface | Gold-only v1 (premium-exclusive badges, premium-grant tickets, premium-marked feed posts).          | Brainstorm + existing read paths.                             |

---

## 2. Schema deltas

All new models prefixed `Premium*` to avoid collision with `UserGroupMembership` (existing schema model).

### 2.1 New enums

```prisma
enum PremiumProvider {
  stripe
  apple_revenuecat
}

enum PremiumCadence {
  monthly
  annual
}

enum PremiumMembershipStatus {
  trialing           // reserved for future; not produced by v1 code paths
  active
  past_due
  cancel_scheduled   // cancelAtPeriodEnd=true, entitlement still valid until currentPeriodEnd
  expired
  paused             // RC-specific; treat as inactive for entitlement
}
```

### 2.2 `PremiumMembership` (live + expired rows; only one _live_ row per garage)

```prisma
model PremiumMembership {
  id                   String                  @id @default(cuid())
  garageId             String
  provider             PremiumProvider
  providerCustomerRef  String                  @db.VarChar(120)   // Stripe customer ID or RC app_user_id
  providerSubRef       String                  @db.VarChar(120)   // Stripe sub ID or RC entitlement ID
  tier                 GaragePremiumTier                          // gold-only v1; enum already exists
  cadence              PremiumCadence
  status               PremiumMembershipStatus
  currentPeriodStart   DateTime
  currentPeriodEnd     DateTime
  cancelAtPeriodEnd    Boolean                 @default(false)
  cancelledAt          DateTime?

  // Pricing snapshot — refreshed on activation/renewed/tier_changed.
  // Stripe path: values from Stripe.Price.metadata { baseAmountCents, devFeePercent }.
  // Apple/RC path: baseAmountCents = grossAmountCents, devFeePercent = 0, devFeeAmountCents = 0
  //                (Apple commission is opaque; not modelled as devfee).
  baseAmountCents      Int
  devFeePercent        Int                                        // no default — server MUST set explicitly
  devFeeAmountCents    Int
  grossAmountCents     Int
  currency             String                  @db.VarChar(3)     // 'BRL'

  createdAt            DateTime                @default(now())
  updatedAt            DateTime                @updatedAt

  garage   Garage                       @relation(fields: [garageId], references: [id], onDelete: Cascade)
  invoices PremiumMembershipInvoice[]

  @@unique([provider, providerSubRef])         // hard idempotency for Stripe sub / RC entitlement
  @@index([garageId, status])                  // live-row lookup + history queries
  @@index([currentPeriodEnd])                  // reconciliation sweep
}
```

**One-live-row invariant** is enforced by a raw-SQL **partial unique index** added in the migration step (Prisma schema syntax cannot express partial uniques):

```sql
CREATE UNIQUE INDEX premium_membership_live_per_garage
  ON "PremiumMembership" ("garageId")
  WHERE status IN ('active', 'past_due', 'cancel_scheduled');
```

Expired rows accumulate as history. Re-subscribe = fresh `PremiumMembership` row insert (the previous row's `status='expired'` is excluded from the partial unique). Invoices keep their `membershipId` FK pointing at whichever row they were issued under; finance queries that aggregate across resub history join by `garageId` not `membershipId`.

### 2.3 `PremiumMembershipInvoice` (per-period payment record)

```prisma
model PremiumMembershipInvoice {
  id                     String           @id @default(cuid())
  membershipId           String
  provider               PremiumProvider
  providerInvoiceRef     String           @db.VarChar(120)        // Stripe invoice ID or RC transaction ID
  providerTransactionRef String?          @db.VarChar(200)        // Apple original_transaction_id (iOS)
  periodStart            DateTime
  periodEnd              DateTime
  baseAmountCents        Int
  devFeePercent          Int                                       // snapshotted from Stripe Price.metadata at time-of-charge
  devFeeAmountCents      Int
  grossAmountCents       Int
  currency               String           @db.VarChar(3)
  paidAt                 DateTime
  refundedAt             DateTime?
  refundedAmountCents    Int?                                      // null = no refund; equals grossAmountCents = full refund
  status                 String           @db.VarChar(20)          // 'paid' | 'refunded' | 'partial_refund'
  createdAt              DateTime         @default(now())

  membership PremiumMembership @relation(fields: [membershipId], references: [id], onDelete: Cascade)

  @@unique([provider, providerInvoiceRef])                          // webhook replay idempotency
  @@index([membershipId, periodStart])
  @@index([paidAt])                                                 // finance dashboard date filter
}
```

### 2.4 `SubscriptionWebhookEvent` (idempotency)

Existing `PaymentWebhookEvent` (`schema.prisma:878`) covers one-time order providers (`stripe`, `abacatepay`). Its `provider` field is `PaymentProvider` enum — extending it to include `apple_revenuecat` would orphan that value for one-time `Order.provider` reads. **Keep separate**:

```prisma
model SubscriptionWebhookEvent {
  id              String           @id @default(cuid())
  provider        PremiumProvider
  providerEventId String           @db.VarChar(200)
  type            String           @db.VarChar(80)
  payload         Json
  receivedAt      DateTime         @default(now())
  processedAt     DateTime?

  @@unique([provider, providerEventId])
  @@index([receivedAt])
}
```

`payload Json` is **load-bearing for production debugging** (parity with `PaymentWebhookEvent.payload`). Do not omit.

### 2.5 `TicketTier.isPremiumGrantable` (premium-grant target)

```prisma
model TicketTier {
  // ...existing...
  isPremiumGrantable Boolean @default(false)
  // ...existing...

  @@index([eventId, isPremiumGrantable])
}
```

Admin **must** set on at least one tier per event before the event publishes. Backfill + event-publish-grant pick the first `isPremiumGrantable=true` tier. If no grantable tier exists at backfill time: skip event, log structured warning (`premium_grant.no_tier`), continue. Admin UI nudges during event publish (non-blocking warning).

### 2.6 Partial unique on `Ticket` (narrowed to `source='premium_grant'`)

```sql
-- migration: raw SQL after Prisma generates the base CREATE TABLE
CREATE UNIQUE INDEX ticket_one_premium_grant_per_user_event
  ON "Ticket" ("userId", "eventId")
  WHERE status = 'valid' AND source = 'premium_grant';
```

**Scope correction (from external review of F8.01 PR #445):** an earlier draft of this spec called for `WHERE status='valid'` without a `source` predicate, asserting "one valid Ticket per (user, event) regardless of source." That invariant is FALSE in current code — migration `20260503163319_drop_ticket_user_event_unique` explicitly dropped the broader index to support multi-ticket purchases (`Event.maxTicketsPerUser > 1`) and multi-comp grants. F8 narrows the constraint to `source='premium_grant'` so the new flows (F8.06 backfill worker + F8.07 publish-hook) get DB-level idempotency without regressing purchase/comp. Purchase + comp cap enforcement remains in `apps/api/src/services/tickets/{issue,grant}.ts` via `existingValidCount` checks against `Event.maxTicketsPerUser`.

### 2.7 Snapshot on `Garage`

`Garage.premiumTier` + `Garage.premiumUntil` **stay**. They remain the denormalized read-path snapshot. Webhook handler updates them in the same tx as the `PremiumMembership` upsert, using `max(existing premiumUntil, new currentPeriodEnd)` so admin-grant extensions are never clobbered by sub state changes.

---

## 3. Webhook flows

### 3.1 Two routes feeding one service

```
POST /webhooks/stripe-billing  ──┐
                                 │
POST /webhooks/revenuecat ───────┤
                                 │
                                 ▼
            services/billing/applyMembershipEvent(tx, normalizedEvent)
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
PremiumMembership          Garage snapshot            Side-effects
upsert/update              (max() rule)               (XP, post-commit
                                                       backfill queue)
```

Each route:

1. Verifies provider signature (Stripe-Signature header / RC Authorization Bearer).
2. Inserts `SubscriptionWebhookEvent` row keyed on `(provider, providerEventId)` for hard idempotency. On `P2002` (replay), short-circuit 200 OK without further work.
3. Parses provider payload into a normalized `BillingEvent` (see §3.2).
4. Resolves `garageId`. Stripe: `Customer.metadata.garageId` (set at Checkout-Session create time). RC: `app_user_id`.
5. Opens a Prisma `$transaction`. First statement: `SELECT id FROM "Garage" WHERE id = $1 FOR UPDATE` (serializes concurrent webhooks for the same garage — closes the race window).
6. Calls `applyMembershipEvent(tx, normalizedEvent)`.
7. Marks `SubscriptionWebhookEvent.processedAt = now()` in the same tx.
8. On commit: enqueues post-commit side-effects (ticket backfill queue — see §4.3).

**Activation side-effects that MUST happen inside the tx:** Membership upsert, Invoice insert, Garage snapshot write, `awardXp` call.

**Side-effects that MUST happen post-commit (async):** ticket backfill for currently-published future events (50+ ticket inserts shouldn't extend the activation tx).

### 3.2 Normalized `BillingEvent` shape

```ts
type BillingEvent =
  | { kind: 'subscription.activated'
      provider; providerCustomerRef; providerSubRef
      garageId
      tier; cadence
      currentPeriodStart; currentPeriodEnd
      pricing: { baseAmountCents; devFeePercent; devFeeAmountCents; grossAmountCents; currency }
      invoice: { providerInvoiceRef; providerTransactionRef?; periodStart; periodEnd; paidAt } }
  | { kind: 'subscription.renewed'
      provider; providerSubRef
      currentPeriodStart; currentPeriodEnd
      pricing: { ... }       // re-snapshotted in case Stripe Price metadata changed
      invoice: { ... } }
  | { kind: 'subscription.cancelled'      // cancel_at_period_end=true
      provider; providerSubRef
      cancelledAt }
  | { kind: 'subscription.uncancelled'    // user reverses cancel before period end
      provider; providerSubRef }
  | { kind: 'subscription.expired'
      provider; providerSubRef
      cancelledAt }
  | { kind: 'subscription.past_due'
      provider; providerSubRef }
  | { kind: 'subscription.tier_changed'
      provider; providerSubRef
      tier; cadence
      pricing: { ... } }
```

### 3.3 Stripe event mapping

| Stripe event                                                                        | → BillingEvent                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `customer.subscription.created`                                                     | ignored (await `invoice.paid`)                        |
| `invoice.paid` (`billing_reason='subscription_create'`)                             | `activated`                                           |
| `invoice.paid` (`billing_reason='subscription_cycle'`)                              | `renewed`                                             |
| `invoice.payment_failed`                                                            | `past_due`                                            |
| `customer.subscription.updated` w/ `cancel_at_period_end` flip true                 | `cancelled`                                           |
| `customer.subscription.updated` w/ `cancel_at_period_end` flip false (after cancel) | `uncancelled`                                         |
| `customer.subscription.updated` w/ `items[].price` swap (cadence or tier)           | `tier_changed`                                        |
| `customer.subscription.deleted`                                                     | `expired`                                             |
| `charge.refunded` for a sub invoice                                                 | (handled separately — flips invoice status, see §4.5) |

### 3.4 RevenueCat event mapping

| RC event                                  | → BillingEvent                                     |
| ----------------------------------------- | -------------------------------------------------- |
| `INITIAL_PURCHASE`                        | `activated`                                        |
| `RENEWAL`                                 | `renewed`                                          |
| `PRODUCT_CHANGE`                          | `tier_changed`                                     |
| `CANCELLATION`                            | `cancelled` (entitlement still valid until expiry) |
| `UNCANCELLATION`                          | `uncancelled`                                      |
| `EXPIRATION`                              | `expired`                                          |
| `BILLING_ISSUE`                           | `past_due`                                         |
| `TRANSFER`, `SUBSCRIPTION_PAUSED`, others | logged + acked, no state change v1                 |

**Non-BR storefront filter:** RC payload `event.country_code != 'BR'` → log + 200 OK without writing Membership/Invoice rows. v1 scope is BR-only.

### 3.5 Garage snapshot write rule

```
on activated | renewed | uncancelled | tier_changed:
  Garage.premiumTier  = membership.tier  (gold v1)
  Garage.premiumUntil = max(Garage.premiumUntil ?? epoch, membership.currentPeriodEnd)

on cancelled (cancel_scheduled):
  no snapshot change — user remains active through currentPeriodEnd

on expired:
  if Garage.premiumUntil <= now()
     AND no other PremiumMembership row with status='active' for this garage
     AND no admin-grant pushed premiumUntil > now()
  then:
    Garage.premiumTier  = null
    Garage.premiumUntil = null

on past_due:
  no immediate snapshot change — Stripe's automatic dunning retries 3× over ~7d.
  Reconciliation sweep (§6) handles eventual snapshot expiry.
```

The `max()` rule is **load-bearing** for admin-grant coexistence. Document inline at the call site.

### 3.6 Shared XP-idempotency contract (canon)

`sourceRef = 'garage:<garageId>'` is the **shared idempotency key** across:

- Admin grant route (`apps/api/src/routes/admin/user-garage.ts`)
- Self-serve webhook activation (this spec)

Both paths call `awardXp(tx, garageId, 'premium_activation', { sourceRef, delta: 200 })`. The XpEvent unique `(garageId, reason, sourceRef)` (canon §C1 from Phase 2) makes `premium_activation` **one-shot-ever per garage**, regardless of which path fires first. The second path silently no-ops via the awarder's P2002 swallow + canon §5 (no caller try/catch).

**Integration test required:** "admin grant then webhook activate does not double-award; webhook activate then admin grant does not double-award." Lives in `apps/api/test/billing/premium-activation-idempotency.test.ts`.

---

## 4. Activation effects

### 4.1 Inside the activation tx (synchronous, atomic)

```
1. SubscriptionWebhookEvent insert (idempotency)
2. SELECT garage FOR UPDATE                                                  ← serializes
3. PremiumMembership upsert
4. PremiumMembershipInvoice insert
5. Garage.premiumTier + .premiumUntil snapshot write (max() rule)
6. awardXp(tx, garageId, 'premium_activation', { sourceRef: `garage:${garageId}`, delta: 200 })
7. SubscriptionWebhookEvent.processedAt = now()
8. COMMIT
```

### 4.2 Post-commit async (ticket backfill)

On successful activation commit, enqueue a job to the existing background worker (`apps/api/src/workers/`). Job payload: `{ garageId, activatedAt }`.

Job body (its own DB tx):

```
for each published Event where startsAt > now()
  AND no valid Ticket exists for (garage.userId, event.id):
    pick first TicketTier where isPremiumGrantable=true and (sales open or salesCloseAt > now())
    if no grantable tier: log warning, continue
    insert Ticket { userId, eventId, tierId, source: 'premium_grant', code: HMAC(...), status: 'valid' }
```

Chunked 100 events per inner tx. Failures retry; ticket insert is idempotent via the partial-unique-on-Ticket (§2.7). Job log surfaces in admin financial dashboard via existing job-log table.

### 4.3 Renewal — synchronous tx only

```
1. SubscriptionWebhookEvent insert
2. SELECT garage FOR UPDATE
3. PremiumMembership update (period + pricing snapshot)
4. PremiumMembershipInvoice insert
5. Garage.premiumUntil = max(existing, new currentPeriodEnd)
6. SubscriptionWebhookEvent.processedAt = now()
7. COMMIT
```

**No XP, no backfill.** New events published mid-cycle are caught by §4.6 publish hook.

### 4.4 Tier change v1

Single-tier (gold). Cadence swap (monthly↔annual) updates `PremiumMembership.cadence` + pricing snapshot. **No XP** (premium_activation is one-shot-ever per garage; tier upgrades to future paid tiers are out of v1 scope).

### 4.5 Refund

Stripe `charge.refunded` for a sub invoice:

- `PremiumMembershipInvoice.refundedAt = now()`, `.refundedAmountCents = chargeRefundAmount`
- `.status = 'partial_refund'` if `refundedAmountCents < grossAmountCents`, else `'refunded'`
- **Membership stays active.** Refund does NOT revoke entitlement mid-period. User continues through `currentPeriodEnd`. Admin tool can force-revoke for abuse cases via existing admin route (`POST /users/:id/garage/premium` with `tier=null`).

This matches brainstorm semantics ("On cancel at period end, stop granting new tickets but let existing ones remain valid"). Refund is treated as an after-the-fact accounting event, not an entitlement transition.

### 4.6 Event-publish-time premium-grant hook

When `Event.status` flips `draft → published`:

1. Publish tx writes ONLY `Event.status='published'`, `publishedAt=now()`.
2. **Post-commit:** enqueue `premium-grant-on-event-publish` job. Payload: `{ eventId, publishedAt }`.
3. Job body:
   - Pick first `TicketTier` where `isPremiumGrantable=true`. If none: log warning, exit.
   - Page through active premium members: `PremiumMembership WHERE status='active' AND cancelAtPeriodEnd=false AND currentPeriodEnd > event.startsAt`, 500 garages per inner tx.
   - For each: if no valid Ticket exists for `(garage.userId, event.id)`, insert `premium_grant` Ticket.
4. Idempotent via partial unique on Ticket. Retries safe.

`cancelAtPeriodEnd=false` filter prevents new grants to users whose sub ends before the event starts.

### 4.7 SAVEPOINT note (deferred follow-up, see orchestrator-state #12)

`awardXp` uses a fixed SAVEPOINT name `awardxp`. Activation tx calls `awardXp` **exactly once** → safe v1. If a future chunk introduces a second `awardXp` call in the same tx (e.g., premium-tier badge auto-award), the second savepoint silently replaces the first. **Spec mandates a single `awardXp` per activation tx in v1 + an integration test asserting it.** Multi-call fix tracked separately at the awarder level.

---

## 5. Pre-checkout duplicate-subscribe guard

Before creating a Stripe Checkout Session OR before the RC SDK initiates a purchase:

```
GET /api/me/premium/checkout-precheck
→ 200 { available: true }                              // user can subscribe
→ 409 { error: 'AlreadySubscribed', provider, manageUrl } // route to portal/settings
```

Server checks `PremiumMembership WHERE garageId = me.garage.id AND status IN ('active','past_due','cancel_scheduled')`. If found, returns 409 with `provider` and the appropriate manage URL (Stripe Billing Portal for Stripe; deep link to App Store Settings for Apple).

Closes the cross-platform dup-subscribe race (iOS user logs in on Android, tries to subscribe again).

---

## 6. Reconciliation sweep

Cron-driven worker `apps/api/src/workers/billing-reconcile.ts`. Schedule: **hourly**. Runs against the production DB; idempotent.

```
query: SELECT * FROM "PremiumMembership"
       WHERE status IN ('active', 'past_due', 'cancel_scheduled')
         AND currentPeriodEnd < now()
       LIMIT 200;

for each row:
  if provider = 'stripe':
    sub = stripe.subscriptions.retrieve(providerSubRef)
    if sub.status = 'active' AND sub.current_period_end > now:
      // webhook lost; replay state
      update Membership + Invoice (if new invoice ref) + Garage snapshot
    elif sub.status in ('canceled','incomplete_expired','unpaid'):
      transition to 'expired'; clear Garage snapshot per §3.5

  if provider = 'apple_revenuecat':
    sub = revenuecat.GET /v1/subscribers/{providerCustomerRef}
    apply same reconciliation
```

Log every transition. Alert if reconciliation queue depth grows (Grafana / Sentry).

---

## 7. Admin finance dashboard fold-in

### 7.1 API deltas (`apps/api/src/routes/admin/finance.ts`)

New helper:

```ts
async function findMembershipInvoices(
  where: PremiumInvoiceWhereInput,
): Promise<PremiumMembershipInvoice[]>;
```

Filter parity with `findFinanceOrders`: date range (`paidAt`), `status`, `provider`, plus new filters `cadence`, `tier`.

Modified endpoints (all keyed off the existing `buildWhere(query)` plus a new `membershipWhere`):

- `/finance/summary` — add fields:

  ```
  membershipRevenueCents
  membershipNetRevenueCents
  membershipDevFeeCollectedCents
  membershipRefundedCents
  activeMembershipsCount
  newMembershipsCount       // activated within [from, to]
  churnedMembershipsCount   // status flipped to expired within [from, to]
  membershipMRRCents        // sum of (cadence='monthly' ? gross : round(gross/12)) across active
  membershipARPUCents       // membershipNetRevenueCents / activeMembershipsCount (guarded /0)
  ```

- `/finance/trends` — add `membershipRevenueCents` to each daily bucket.

- `/finance/payment-mix` — adds rows `stripe:subscription` and `apple_revenuecat:storekit`.

- **New `/finance/memberships`** — paginated list. Returns:

  ```
  { items: [{ membershipId, garageSlug, userName, tier, cadence, status,
              currentPeriodEnd, cancelAtPeriodEnd, totalPaidCents, invoiceCount,
              provider, providerSubRef }],
    page, pageSize, total }
  ```

  Filters: `status`, `cadence`, `tier`, `provider`, date range on `currentPeriodEnd`, search by user name/email.

- `/finance/export` — CSV gains columns: `cadence`, `is_membership`, `membership_invoice_id`. **k-anonymity ≥ 5 cohort threshold (`MIN_FINANCE_EXPORT_COHORT_SIZE`) applies to membership cohorts too.**

### 7.2 Admin UI deltas (`apps/admin/app/(authed)/financeiro/`)

- `filter-bar.tsx` — new `kind` dropdown (`tickets | store | membership | all`, default `all`). When `membership`: expose `cadence`, `tier`, `status` sub-filters.
- `kpi-row.tsx` — three new tiles: "Receita de Membros", "Membros Ativos", "MRR". Total "Receita líquida" KPI sums tickets + store + membership.
- `revenue-table.tsx` — optional "Tipo" column, or new tab.
- `payment-mix.tsx` — render up to 4 rows.
- `trend-chart.tsx` — stacked area: ticketRevenue + storeRevenue + membershipRevenue.
- **New page** `apps/admin/app/(authed)/financeiro/membros/page.tsx` — table from `/finance/memberships` with member-level actions: view detail, audit log of grants/revokes, link to `/users/:id/garage`.

### 7.3 MRR math rounding

- Monthly subs: `MRR += grossAmountCents`.
- Annual subs: `MRR += Math.round(grossAmountCents / 12)`.
- Never store a rounded monthly value. Always store annual gross + derive on query.

---

## 8. Mobile + web user-facing surfaces

### 8.1 Mobile (Expo RN) — `apps/mobile`

- **iOS:** `Settings → Premium` route. RevenueCat SDK loads the offering. User taps "Assinar Gold (R$ X/mês)" or "Assinar Gold anual (R$ Y/ano)". RC SDK presents StoreKit native sheet. On purchase: webhook fires server-side; client polls `/api/me/premium/status` for activation (or RC SDK's `purchaserInfo` listener).
- **Android:** same `Premium` route. Stripe RN SDK opens `PaymentSheet` for subscription confirmation (after `/api/me/premium/checkout-precheck` returns OK and server creates a SetupIntent + Subscription). Or: WebBrowser → Stripe Checkout hosted page; deep-link return.
- **Both:** premium status badge on profile. "Gerenciar assinatura" deep-link to App Store settings (iOS) or Stripe Billing Portal (Android web view).

### 8.2 Web (admin Next.js) — `apps/admin`

- New route `/premium` — pricing page (monthly vs annual), "Assinar" button → Stripe Checkout (mode=subscription).
- `/me/billing` — links to Stripe Billing Portal (server-generates portal URL via Stripe API).
- Shared SSR component for the pricing card (Anton font, brand-tinted card; reuse `@ccc/ui` design tokens).

### 8.3 Shared zod schemas (`packages/shared/src/premium.ts` — new)

```ts
export const premiumCheckoutPrecheckSchema = z.object({ ... });
export const premiumStatusSchema = z.object({
  active: z.boolean(),
  tier: z.enum(['gold']).nullable(),
  cadence: z.enum(['monthly','annual']).nullable(),
  provider: z.enum(['stripe','apple_revenuecat']).nullable(),
  currentPeriodEnd: z.string().datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  manageUrl: z.string().url().nullable(),
});
export const adminFinanceMembershipsQuerySchema = z.object({ ... });
```

---

## 9. Migration plan

1. Schema migration `0042_f8_premium_billing.sql` (number TBD by Prisma migrate state at land time):
   - Create `PremiumProvider`, `PremiumCadence`, `PremiumMembershipStatus` enums.
   - Create `PremiumMembership`, `PremiumMembershipInvoice`, `SubscriptionWebhookEvent` tables.
   - Raw SQL: `CREATE UNIQUE INDEX premium_membership_live_per_garage ON "PremiumMembership" ("garageId") WHERE status IN ('active','past_due','cancel_scheduled');` (partial unique — one live row per garage; expired rows accumulate as history).
   - Raw SQL: `CREATE UNIQUE INDEX ticket_one_premium_grant_per_user_event ON "Ticket" ("userId","eventId") WHERE status = 'valid' AND source = 'premium_grant';` (DB-level idempotency backstop for F8.06 + F8.07 only — see §2.6 for why the broader form was rejected).
   - Add `TicketTier.isPremiumGrantable Boolean DEFAULT false`.
2. Generate Prisma client, rebuild `@ccc/shared`.
3. Land schema chunk + tests behind a feature flag (`GROWTH_PREMIUM_BILLING_ENABLED=false` by default; flip after smoke).
4. Stripe Dashboard config (manual, documented in `docs/stripe.md`):
   - Create Product "JDM Premium Gold".
   - Two Prices: `price_premium_monthly` (BRL, R$ X/month), `price_premium_annual` (BRL, R$ Y/year).
   - Price metadata: `{ baseAmountCents, devFeePercent }` per Price.
   - Webhook endpoint: `https://api.jdm-experience.com/webhooks/stripe-billing`. Events: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`.
5. RevenueCat dashboard config:
   - Add iOS app, link App Store Connect.
   - Add Stripe app (for cross-platform purchaser sync; optional v1 — can stay iOS-only).
   - Configure Offerings + Entitlements (single entitlement: `premium_gold`).
   - Webhook endpoint: `https://api.jdm-experience.com/webhooks/revenuecat`. Auth header set in RC dashboard; server validates.
6. Apple App Store Connect: create subscription group + monthly/annual SKUs matching RC Offerings.
7. Smoke test in Stripe test mode + RC sandbox + App Store sandbox (TestFlight).
8. Flip feature flag in production after smoke passes.

---

## 10. Out of scope (v1)

| Item                                                       | Reason                                                                                   | Notes                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------- |
| Trial period (free 7/14 day)                               | Locked decision: no trial v1. Schema reserves `trialing` enum value.                     | Phase F8.1.               |
| Multiple tiers (silver, bronze)                            | Single product. Schema enum + Garage.premiumTier ready for it.                           | Phase F8.2+.              |
| Dunning push notifications + receipt emails                | Brainstorm-out-of-scope.                                                                 | Phase F8.1.               |
| Family / gift subscriptions                                | Out-of-scope.                                                                            | Phase F8.2+.              |
| Brazilian Stripe Tax / VAT compliance                      | Stripe-side config; doesn't change application code. Tax behavior set on Stripe Product. | Pre-launch ops, not code. |
| Cohort retention dashboard (`/finance/membership-cohorts`) | Polish; needs separate UX brief.                                                         | Phase F8.1.               |
| Promo codes / coupons                                      | Out-of-scope v1.                                                                         | Phase F8.1.               |
| Per-tier perk-gating code paths                            | Single tier v1; perks are global to "is premium active".                                 | Phase F8.2+.              |
| Animated "Welcome to Gold" splash                          | UI polish.                                                                               | Phase F8.1.               |

---

## 11. Risks + open follow-ups

| Risk                                                                                                                           | Posture                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple may reject the iOS build if it implies an external payment surface or shares a user account with a Stripe-paid web user. | iOS code path MUST NOT link to, mention, or redirect to Stripe checkout. iOS sees ONLY the RC/StoreKit purchase flow. Web/Android Stripe checkout is fully isolated from the iOS bundle. Document this constraint in App Review notes + enforce via a lint rule (forbid Stripe URLs in `apps/mobile/src/` for iOS-conditional code). Reader-app exemption is for media apps; we do NOT rely on it. |
| Google Play parity — Stripe-on-Android may violate Play billing policy.                                                        | Brainstorm-pinned trade-off. If Google rejects: pivot Android to Google Play Billing (separate chunk; Stripe path becomes web-only). Defer until Play review feedback received.                                                                                                                                                                                                                    |
| RC webhook latency (hours).                                                                                                    | Reconciliation sweep §6 closes the entitlement window.                                                                                                                                                                                                                                                                                                                                             |
| Stripe Price metadata drift vs server env.                                                                                     | Snapshotted on every invoice; finance dashboard surfaces mismatch warnings. Historical accounting preserved.                                                                                                                                                                                                                                                                                       |
| Multi-call `awardXp` SAVEPOINT collision.                                                                                      | v1 mandates single `awardXp` per activation tx + integration test. Multi-call fix is a separate awarder-level chunk.                                                                                                                                                                                                                                                                               |

---

## 12. Test strategy

- **Real Postgres** (Testcontainers) for all webhook handler tests. Mocks forbidden per CLAUDE.md.
- **Stripe test mode** for end-to-end smoke (`stripe trigger invoice.paid`, etc.).
- **RC sandbox** for iOS-side smoke.
- Integration tests under `apps/api/test/billing/`:
  - `premium-activation-idempotency.test.ts` — admin grant then webhook, webhook then admin grant, double webhook fire.
  - `premium-renewal.test.ts` — `invoice.paid` for recurring billing.
  - `premium-cancel-uncancel.test.ts` — cancel_at_period_end flow.
  - `premium-expired.test.ts` — natural expiry, Garage snapshot clearing rule.
  - `premium-tier-changed.test.ts` — cadence swap.
  - `premium-past-due.test.ts` — payment retry window.
  - `premium-refund.test.ts` — refund honors through period end.
  - `premium-event-publish-grant.test.ts` — backfill on event publish, batched, idempotent.
  - `premium-checkout-precheck.test.ts` — 409 cross-platform guard.
  - `premium-reconciliation.test.ts` — sweep against drift.
  - `premium-rc-non-br-storefront.test.ts` — non-BR ack-without-record.

---

## 13. Canon entries (cross-chunk invariants)

Numbered to extend Phase 2's canon §1–§15 series. Plan-skeleton will renumber if needed.

- **§F8.1 — devfee storage.** `PremiumMembershipInvoice.devFeePercent` is snapshotted from `Stripe.Price.metadata.devFeePercent` at time-of-charge. Never re-derived from env at read time. Apple/RC path: `devFeePercent = 0`.
- **§F8.2 — XP shared sourceRef.** `sourceRef = 'garage:<garageId>'` for `premium_activation` is the shared idempotency key across admin grant + webhook activation. One-shot-ever per garage.
- **§F8.3 — Garage snapshot max() rule.** `Garage.premiumUntil = max(existing, new currentPeriodEnd)`. Admin extensions are never clobbered.
- **§F8.4 — Activation tx atomicity.** Membership upsert + Invoice insert + Garage snapshot + XP MUST happen in one tx. Ticket backfill MUST happen post-commit (queued).
- **§F8.5 — Garage row lock.** Every webhook handler opens its tx with `SELECT id FROM Garage WHERE id = $1 FOR UPDATE`. Closes the concurrent-webhook race.
- **§F8.6 — Single awardXp per activation tx.** v1 invariant. Multi-call awardXp inside one tx is a known awarder bug (savepoint name collision); spec mandates only one call per activation tx + a guard test.
- **§F8.7 — Premium-grant tier selection.** Backfill + publish-hook pick the first `TicketTier WHERE eventId = E AND isPremiumGrantable = true`. If none: skip event, log `premium_grant.no_tier`.
- **§F8.8 — Partial unique on Ticket (narrowed).** `UNIQUE (userId, eventId) WHERE status = 'valid' AND source = 'premium_grant'`. F8.06 backfill + F8.07 publish-hook rely on this as DB-level dedup; purchase + comp flows are unconstrained at the DB level (per migration `20260503163319_drop_ticket_user_event_unique` which dropped the broader form for multi-ticket / multi-comp support). See §2.6 for rationale.
- **§F8.9 — Non-BR RC events.** Logged + 200-OK acked without writing Membership/Invoice rows. v1 BR-only.
- **§F8.10 — Refund honors period end.** `MembershipInvoice.status` flips to `refunded`/`partial_refund`; entitlement persists through `currentPeriodEnd`. Admin tool force-revokes for abuse.

---

## 14. Done definition

- Migrations land, behind `GROWTH_PREMIUM_BILLING_ENABLED` feature flag (default off).
- Webhook handlers + reconciliation sweep + post-commit worker shipping.
- Admin financial dashboard surfaces membership KPIs, filters, payment-mix rows, trends, new `/financeiro/membros` page.
- Mobile + web subscribe routes wired (iOS via RC, Android/web via Stripe).
- Stripe Billing Portal link works for Stripe-paid users.
- Integration tests pass against real Postgres.
- Smoke test passes in Stripe test mode + RC sandbox + App Store TestFlight.
- Feature flag flipped on after manual smoke.
- Handoff written for any deferred items.
