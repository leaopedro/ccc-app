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

- **Condition:** `event.type:error` AND `transaction:POST /stripe/webhook`
  in 5 min, threshold ≥ 1.
- **Why:** Stripe retries failed webhooks for 3 days, but we want a
  human looking inside the first hour.
- **Triage:** see
  [Webhook handler failure](#runbook-2--webhook-handler-failure).

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
