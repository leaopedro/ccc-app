# Observability — Sentry, Railway, Stripe

How errors, performance, and infra signals reach humans across the
three apps (`api`, `admin`, `mobile`) plus Postgres on Railway and the
payment providers (Stripe, AbacatePay). Read this when an alert fires
or before changing anything that emits telemetry.

## Architecture summary

- **Sentry**: single org `jdm-experience`, three projects (`api`,
  `admin`, `mobile`). All three init from the same shared DSN
  ([JDMA-17](/JDMA/issues/JDMA-17)) and tag every event with
  `service=api|admin|mobile`. Events are routed/filtered in Sentry by
  the `service` tag, not by DSN.
- **Releases**: each app uploads release + sourcemaps automatically.
  - `api` — `Sentry.init({ release: GIT_SHA })`. The API resolves
    `GIT_SHA` from the explicit env var, falling back to
    `RAILWAY_GIT_COMMIT_SHA` (auto-injected on Railway) and finally to
    `"dev"`. No sourcemap upload (server JS, stack frames already point
    at compiled `dist/`).
  - `admin` — `withSentryConfig` in `apps/admin/next.config.mjs`
    uploads release + sourcemaps on every Vercel build using
    `SENTRY_AUTH_TOKEN` + `SENTRY_PROJECT_ADMIN`.
  - `mobile` — `@sentry/react-native/expo` plugin in `app.config.ts`
    uploads release + sourcemaps during EAS Build using
    `SENTRY_AUTH_TOKEN` + `SENTRY_PROJECT_MOBILE`.
- **Railway**: per-service Metrics tab shows API CPU, memory,
  network, request latency (P50/P95/P99) and Postgres CPU/memory/
  connections. Bookmarked dashboards are linked from
  [`docs/railway.md`](./railway.md#metrics-dashboards).
- **Stripe Radar / AbacatePay**: provider-side alerting on blocked
  transactions. Webhook signature mismatches and webhook-handler
  failures are captured by the API (see runbooks below) so they
  surface in Sentry alongside everything else.

Smoke-test endpoints (gated behind `SENTRY_DEBUG=1` in production):

- API: `POST /debug/boom` → throws an error captured by `onError`.
- Admin: `/debug/sentry` → client + server capture.

## Alert rules (configure in Sentry → Alerts)

These rules implement the JDMA-45 "alert rules" requirement. Owner:
CTO. Each rule routes to email + (later) the `#alerts` Slack channel
once that integration lands.

### 1. Error rate spike (any project)

- **Condition:** `event.count > 20` in 5 min for `service=api`,
  `service=admin`, or `service=mobile` (one rule per service is fine).
- **Why:** catches deploys that introduce widespread breakage before
  users start reporting it.
- **Triage:** see [Error rate spike](#runbook-1--error-rate-spike).

### 2. Webhook handler failure

- **Condition:** `event.type:error` AND transaction in
  `POST /stripe/webhook`, `POST /webhooks/stripe-billing`, or
  `POST /abacatepay/webhook`, in 5 min, threshold ≥ 1.
- **Why:** Stripe retries failed webhooks for 3 days, but we want a
  human looking inside the first hour. The rule used to cover only the
  one-off endpoint, leaving subscription billing and Pix with no alert
  at all.
- **Triage:** see
  [Webhook handler failure](#runbook-2--webhook-handler-failure).

### 2b. Payload shape or stuck event (billing)

- **Condition:** `tags[kind]:billing-webhook-unrecognized-shape` OR
  `tags[kind]:billing-webhook-poison-pill`, threshold ≥ 1, notify
  immediately.
- **Why:** both mean a paid invoice is sitting unapplied. The first says
  the endpoint renders a Stripe API version the normalizer cannot parse;
  the second says an event has been retried past the escalation
  threshold and Stripe will eventually give up. Neither self-heals.
- **Triage:** see
  [Money in, nothing out](#runbook-5--money-in-nothing-out).

### 2c. Dispute opened

- **Condition:** `tags[kind]:stripe-dispute-opened`, threshold ≥ 1,
  notify immediately.
- **Why:** the code revokes the ticket automatically, but the evidence
  deadline is a human task with a hard clock.
- **Triage:** open the dispute in the Stripe dashboard, gather the
  check-in record and the order, respond before the due date.

### 2d. Cart paid after expiry

- **Condition:** `tags[kind]:cart-paid-after-expiry`, threshold ≥ 1.
- **Why:** the customer paid inside a still-valid Checkout Session after
  the reservation had already been released. The API refunds
  automatically; the alert exists so someone can talk to the customer
  and check whether the expiry window needs widening.

### 2e. Stale cross-mode Stripe reference

- **Condition:** `tags[kind]:stripe-stale-ref`, threshold ≥ 1.
- **Why:** a row is pointing at an object from the other Stripe mode
  (test id under a live key). Permanent until purged: retrying never
  fixes it. A burst right after the live cutover means the purge script
  missed rows — see `apps/api/src/scripts/purge-test-mode.ts`.
- **Note on the purge:** it discriminates by **creation time**, not by the
  id. Stripe's test-mode ids for Customer, Subscription and PaymentIntent
  look exactly like live ones and the mode lives in `livemode`, so no
  string match on the id can work. Pass the live cutover instant:
  `--created-before=<ISO>`. There is no default on purpose — guessing it
  revokes entitlement from paying members.

### 2f. Folha velha pagou apos reabertura

- **Condition:** `tags[kind]:stripe-stale-cart-version`, threshold ≥ 1.
- **Why:** um PaymentSheet antigo confirmou um clientSecret mintado antes de o
  carrinho ser reaberto. A API reembolsa sozinha. O alerta existe porque o
  estoque pode ja ter sido revendido para outra pessoa, e alguem precisa falar
  com quem pagou. Volume alto significa que o cancelamento da PI em
  handleCartFailure parou de funcionar.

### 2g. Assinatura nativa sem segredo de confirmacao

- **Condition:** `tags[kind]:premium-native-subscription-no-secret`, threshold ≥ 1.
- **Why:** a Stripe criou a assinatura mas a primeira fatura voltou sem
  `confirmation_secret`. O membro recebe 503 e nao consegue assinar pelo app.
  Causa tipica: o `expand` de `latest_invoice.confirmation_secret` caiu num
  refactor, ou o price esta configurado com valor zero.

### 2h. Falha ao cancelar PI de pedido expirado

- **Condition:** `tags[kind]:order-expiry-cancel-failed` em 1 hora, threshold ≥ 5.
- **Why:** uma ocorrencia isolada e normal: a Stripe 400a o cancel de uma PI que
  ela propria ja fechou. Cinco em uma hora significa que a chave Stripe perdeu
  permissao ou que os refs do banco apontam para o outro modo.

### 3. Webhook signature mismatch

- **Condition:** `tags[kind]:payment-webhook-signature` in 1 hour,
  threshold ≥ 3.
- **Why:** Stripe occasionally retries with stale secrets after key
  rotation, but a steady stream means our `STRIPE_WEBHOOK_SECRET` is
  out of sync with the dashboard.
- **Triage:** see
  [Signature mismatch](#runbook-3--signature-mismatch).

### 4. Push send failure

- **Condition:** `tags[kind]:push-send-failure` in 15 min,
  threshold ≥ 5.
- **Why:** transactional push (ticket.confirmed) is part of the paid
  flow — silent failures mean buyers don't get their QR notification.
- **Triage:** see
  [Push send failure](#runbook-4--push-send-failure).

> AbacatePay equivalent rules will be added when the AbacatePay
> webhook handler lands in v0.2 (see
> [BUSINESS_PLAN.md](../BUSINESS_PLAN.md) v0.2 row). The same
> `payment-webhook-signature` tag is reused so rule 3 will already
> cover both providers.

> **Not wired yet: platform-gate write refusal.** The per-platform
> subscription gate (`docs/railway.md#variáveis-do-gate-por-plataforma`)
> refuses purchase-route writes with 403 `PlatformNotSupported` from
> `apps/api/src/services/platform-gate/guard.ts`, but that guard does not
> call Sentry today — no event is captured, so a rule on the tag
> `platform-gate-write-refused` would never fire. Once the guard is
> updated to call `Sentry.captureException` (or `captureMessage`) with
> `tags: { kind: 'platform-gate-write-refused' }` before it sends the 403,
> add a rule: condition `tags[kind]:platform-gate-write-refused`,
> threshold ≥ 1. A sudden high volume means either a stale client still
> hitting a disabled platform, or one of the `PREMIUM_SUBSCRIPTIONS_*`
> variables flipped by mistake.

> **Not wired yet: native subscription attempt reaping.**
> `reapAbandonedAttempts` (`apps/api/src/workers/billing-reconcile.ts`) flips a
> stale `PremiumSubscriptionAttempt` from `pending` to `abandoned` past its TTL
> (23h with a `providerSubRef`, 15min without one) and only logs
> `kind: 'reconcile.attempts_reaped'` — no Sentry call. This is by design, not
> an oversight to fix blindly: reaping a TTL-expired attempt is expected
> steady-state behavior, not a failure, so a naive rule on volume would be
> noise. No `premium-attempt-reaped` tag exists in code today, so no rule is
> documented for it here. If reaping volume ever needs a human (e.g. a sudden
> spike suggesting the native checkout path is failing upstream of Stripe),
> wire a `Sentry.captureMessage` at the point above with
> `tags: { kind: 'premium-attempt-reaped' }` first, then add the rule.

## Synthetic verification

Run after any change to the Sentry wiring or alert rules.

```bash
# 1. API — production must have SENTRY_DEBUG=1 set on Railway.
curl -fsS -X POST https://<prod-api>/debug/boom
# Expect: 500 + a new "intentional boom for Sentry verification"
# event in the api Sentry project within ~30s.
```

```bash
# 2. Admin — open https://<prod-admin>/debug/sentry in a browser
# (production must have SENTRY_DEBUG=1 set on Vercel) and click
# both buttons. Expect one client + one server event in the admin
# Sentry project.
```

```bash
# 3. Mobile — open the Debug Sentry screen in a dev or preview
# build (Settings → Debug → Sentry, or deep link `jdm://debug-sentry`).
# Tap "Throw error". Expect one event tagged service=mobile.
```

If rule 1 (error rate spike) is wired, tripping any of the above 25+
times within 5 minutes (loop the curl) should fire it. Document the
firing in the issue thread and switch the rule back to its real
threshold.

---

## Runbook 1 — Error rate spike

**Symptom:** Sentry alert "Error rate spike — api/admin/mobile".

**First 5 minutes:**

1. Open the Sentry issue list filtered by the alerting service.
2. Sort by "Events" desc — the top issue is almost always the cause.
3. Cross-reference the issue's `release` against the latest deploy
   (Railway Deployments tab for `api`, Vercel Deployments tab for
   `admin`, EAS Builds for `mobile`).
4. If the spike started within ~5 min of a deploy: **rollback first,
   investigate after.**
   - `api`: Railway → Deployments → previous green → "Redeploy".
   - `admin`: Vercel → Deployments → previous green → "Promote to
     Production".
   - `mobile`: cannot rollback shipped binaries. Push a hotfix OTA
     update via `eas update --branch production` instead.
5. Once the spike subsides, file a follow-up issue under
   [JDMA-10](/JDMA/issues/JDMA-10) with the Sentry issue link and
   root cause.

**Common false positives:** scraper bots hitting unknown routes
(filter via `transaction.op:http.server` and look for legitimate
routes only); Apple/Google push token churn (those are
warnings, not errors — should not trip rule 1).

## Runbook 2 — Webhook handler failure

**Symptom:** Sentry alert "Webhook handler failure" — at least one
exception thrown from `POST /stripe/webhook`.

**First 5 minutes:**

1. Open the Sentry issue. The exception name + stack tells you the
   layer:
   - `TicketAlreadyExistsForEventError` → already handled by the
     refund branch; this should not raise. If it does, investigate
     a logic regression in `stripe-webhook.ts`.
   - `Prisma*Error` → DB issue. Check Railway Postgres metrics
     (CPU, connections) and the Railway logs for the API service.
   - Anything else → a new failure mode; treat as a P1 bug.
2. Check Stripe Dashboard → Developers → Webhooks → your endpoint.
   - "Successful" should keep climbing. If "Failed" is climbing,
     Stripe will retry for 3 days. We have time.
3. If the API container is healthy and the bug is in the handler,
   ship a fix on `apps/api/src/routes/stripe-webhook.ts`. Stripe
   redelivery will pick the corrected handler up.

**Do not** manually replay events from the Stripe dashboard until
the handler is fixed — replays count against the same idempotency
table, so a broken handler will mark events as processed without
issuing tickets.

## Runbook 3 — Signature mismatch

**Symptom:** Sentry alert "Webhook signature mismatch" — 3+ events
tagged `kind=payment-webhook-signature` in 1 hour.

**Cause map:**

- `STRIPE_WEBHOOK_SECRET` on Railway is out of sync with the secret
  shown in Stripe Dashboard → Developers → Webhooks → endpoint →
  "Signing secret". Most common after key rotation.
- A non-Stripe caller is hitting `POST /stripe/webhook` (e.g. a
  scanner). Check the source IPs in Railway logs. If it's not a
  Stripe-owned IP range, ignore.

**Fix (sync secret):**

1. Stripe Dashboard → Developers → Webhooks → endpoint → "Signing
   secret" → "Click to reveal".
2. Railway → API service → Variables → update `STRIPE_WEBHOOK_SECRET`.
3. Redeploy (Railway auto-redeploys on env change).
4. Confirm the next legitimate event clears without a new alert.

## Runbook 4 — Push send failure

**Symptom:** Sentry alert "Push send failure" — 5+ events tagged
`kind=push-send-failure` in 15 min.

**Cause map:**

- Expo Push service outage → check
  https://status.expo.dev/. If degraded, no action; the user will
  still get the push when Expo recovers (we retry on the next
  notification, not the same one).
- All affected users have invalidated tokens (uninstall, OS reset).
  The handler already deletes invalidated tokens; the alert should
  self-heal once the token table catches up.
- The `EXPO_ACCESS_TOKEN` on Railway is wrong / revoked. Inspect
  the Sentry stack — if the error message says "Unauthorized",
  rotate the token (Expo dashboard → Access tokens) and update
  `EXPO_ACCESS_TOKEN` on Railway.

**Important:** push-send failures are never user-blocking — the
order/ticket is already paid + issued. The push is best-effort.
Treat alerts here as a smoke signal for a deeper integration
problem, not a customer-impact incident.

---

## Runbook 5 — Money in, nothing out

The worst class of failure: the card was charged and the member has
nothing. Never resolve this by asking the customer to pay again.

**Confirm what happened.**

1. Find the charge in the Stripe dashboard. Note the PaymentIntent or
   invoice id.
2. For a subscription: query `SubscriptionWebhookEvent` by
   `providerEventId`. `processedAt` null means the event was received and
   never applied. For a one-off: query `Order` by `providerRef`.

**If the alert was `billing-webhook-unrecognized-shape`.** The endpoint
is rendering a newer Stripe API version than the normalizer parses. Fix
the endpoint's API version in the Stripe dashboard so it matches the
version the other endpoints use, then redeliver the event from the
dashboard. The route answered 503 and left the row unprocessed so the
redelivery can pick it up.

How the pickup actually works, because it is not obvious and an earlier
version of this document got it wrong: Stripe reuses the same event id on
redelivery, so the insert hits the unique index and lands on the
duplicate-event branch. That branch used to answer 503 for **any**
unprocessed row, which meant a stored-but-unprocessed event could never be
processed — every retry bounced before reaching the dispatch. It now
compares the row's age against `STALE_UNPROCESSED_MS` (60s): a fresh row is
treated as a concurrent delivery and still gets 503, while an older row is
adopted and processed.

Practical consequence: **wait at least a minute** after fixing the API
version before redelivering. Redelivering instantly can land inside the
concurrency window and bounce.

The same mechanism is what lets an event stored while
`GROWTH_PREMIUM_BILLING_ENABLED` was false apply after the flag flips, and
what recovers a row whose first attempt crashed mid-apply.

**If the alert was `unknown-plan-price`.** The invoice carried a Stripe
Price that is not registered in `PremiumPlanPrice`. Register it in the
admin at `/premium/catalogo`, verify with `GET /api/plans`, then note
that the event is already marked processed and will NOT re-run. The
membership has to be created by hand.

**If the alert was `premium-live-membership-conflict`.** An activation
arrived for a garage that already holds a membership inside the
`premium_membership_live_per_garage` index under a different
subscription. The incumbent won, the new activation wrote nothing, and
the member was charged for it. The alert carries both subscription refs,
both providers, both amounts, and the tier, cadence, `baseAmountCents`,
`devFeePercent` and period bounds of the refused one, so it has
everything the hand-written row below needs.

Decide which subscription the member should keep. Cancel the other at
its provider and refund the charge there. Refunding is the usual answer:
the member almost always has entitlement already, through the incumbent,
and is simply paying twice. If the refused subscription is the one to
keep, expire the incumbent first, then hand-write the row.

The originating `PremiumSubscriptionAttempt` was already settled to
`failed` by the webhook, so the member is not blocked from subscribing
again once the duplicate is cleaned up.

**If the alert was `premium-unknown-subscription`.** An event arrived for
a subscription that has no `PremiumMembership` row. At `warning` level it
is housekeeping: an out-of-order delivery, or a subscription that
pre-dates F8. At `error` level it is a renewal, which means money moved
and there is nowhere to file it. The common cause of the recurring
`error` variant is a subscription that a
`premium-live-membership-conflict` refused and nobody cancelled at the
provider: it keeps billing every cycle. Cancel it at the provider.

**Creating a membership by hand.** There is no admin endpoint for this —
`/admin/subscriptions` exposes plan, add-ons, cancel, resume and pause,
but not create. Tickets have `POST /admin/tickets/grant`; memberships do
not. Until one exists, a developer inserts the `PremiumMembership` row
plus its `PremiumMembershipInvoice`, matching tier, cadence,
`baseAmountCents`, `devFeePercent` and period bounds to the Stripe
invoice, and updates `Garage.premiumTier` / `premiumUntil`. Do this
inside a transaction holding `SELECT id FROM "Garage" ... FOR UPDATE`,
the same lock the webhook takes.

**Tell the member.** Their payment is safe and kept. Give a concrete
time for the fix. Do not ask them to retry.

## Refunds and support

There is no refund tooling in the product. `app.stripe.refund` is only
called from automatic branches inside the webhook handlers (duplicate
ticket, revoked ticket, unavailable pickup, order expired, cart paid
after expiry). There is no admin endpoint and no admin screen.

- **Card, via Stripe:** refund from the Stripe dashboard. The
  `charge.refunded` webhook then flips every order in the cart to
  `refunded` and revokes the tickets. Verify in the DB, not just the
  dashboard.
- **Pix, via AbacatePay:** no documented refund API exists (see
  `plans/jdma-260-abacatepay-refund-api-path.md`). It goes through the
  vendor's support, manually.
- **Who:** the founder. Single operator, alerts by email, no paging and
  no on-call rotation. A failure that starts at 02:00 is seen in the
  morning. For payments that is the accepted exposure today; it is worth
  revisiting once volume makes a missed night expensive.

## Where to find things

| Signal                    | Where                                                    |
| ------------------------- | -------------------------------------------------------- |
| Sentry org dashboard      | https://jdm-experience.sentry.io/                        |
| Sentry alert rules        | Alerts → Issue alerts (filter by project)                |
| Railway API metrics       | [`docs/railway.md`](./railway.md#metrics-dashboards)     |
| Railway Postgres metrics  | [`docs/railway.md`](./railway.md#metrics-dashboards)     |
| Stripe webhook deliveries | Stripe Dashboard → Developers → Webhooks → your endpoint |
| AbacatePay (v0.2+)        | _to be filled when AbacatePay integration lands_         |

## Adding a new alert

1. Make sure the API/admin/mobile code emits an event with the right
   `kind` tag (or a meaningful `transaction` / message). Add a
   `Sentry.captureException(err, { tags: { kind: '<your-kind>' } })`
   at the failure point if no event would otherwise fire.
2. Sentry → Alerts → Create alert → Issue Alert (not Metric Alert
   unless you really want quantitative thresholds).
3. Conditions: use the `tags[kind]:<your-kind>` filter.
4. Actions: notify the owning team channel + email the on-call.
5. Add a runbook section to this file. Alerts without a runbook
   should not be wired — pages without a triage path waste oncall
   trust.
