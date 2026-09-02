# F8 Premium Membership billing — chunks skeleton

> **For agentic workers:** REQUIRED SUB-SKILL — Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. This file is the MASTER INDEX. One planning agent per chunk fleshes out a TDD plan at `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-NN-<slug>.md`. Read your chunk's section + the cited spec sections in `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` (canon §F8.1–§F8.10 there is load-bearing). Do NOT re-derive the schema or rules; the spec owns them. Your job is per-chunk TDD detail (files, exact code, test names, verification commands, deviations).

**Goal:** ship self-serve recurring billing for Premium Gold via Stripe (Android + web) and RevenueCat/Apple StoreKit (iOS), wired into existing premium read-paths, with seamless devfee on customer surfaces and full breakdown in the admin financial dashboard.

**Architecture:** dual-provider (Stripe direct + RevenueCat for iOS), single `PremiumMembership` table per garage (one live row enforced by partial unique index; expired rows persist as history), normalized `BillingEvent` adapter funneling both webhook surfaces into one `applyMembershipEvent(tx, evt)` service. Activation tx is atomic (Membership + Invoice + Garage snapshot + XP); ticket backfill runs post-commit via a background worker. Reconciliation sweep closes drift windows hourly. Admin financial dashboard adds membership KPIs, filters, payment-mix rows, and a new `/financeiro/membros` page.

**Tech stack:** Prisma + Postgres (real DB in tests via Testcontainers), Fastify (api), Next.js App Router (admin), Expo RN (mobile), Stripe Node SDK + Stripe RN SDK, `react-native-purchases` (RevenueCat SDK), existing background worker infra in `apps/api/src/workers/`, existing devfee abstraction in `apps/api/src/services/pricing/dev-fee.ts`, zod schemas in `@ccc/shared`.

## Status / readiness

- **Phase 2 (Garage XP) status:** COMPLETE on `main` (chunks 23–41 merged 2026-05-27). Awarder canon §C1–§C14 is load-bearing for F8.
- **Spec:** `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` — committed on `chore/f8-premium-billing-spec` (PR #444). All product decisions locked in §1; canon §F8.1–§F8.10 pinned in §13.
- **Dispatch readiness:** 19 chunks (F8.01 → F8.19) — comparable to Phase 2's 19. Decomposition mirrors Phase 2 waves (foundations → adapters → activation effects → UI → smoke).
- **Branch policy:** every chunk PR opens `feat/jdma-f8-billing-NN` from a fresh `main`. Never branch from `production` (per `CLAUDE.md` preflight).

## Cross-chunk canon (load-bearing — applies to every chunk plan)

All chunk plans MUST conform to these. Where spec inline text drifts, canon wins. Canon §F8.1–§F8.10 are mirrored from spec §13 and EXTEND the Phase 2 §1–§15 set (do not redefine §C1–§C14 — they carry forward).

**§F8.1 — Devfee storage.** `PremiumMembershipInvoice.devFeePercent` is snapshotted from `Stripe.Price.metadata.devFeePercent` at time-of-charge. NEVER re-derived from env at read time. Apple/RC path: `devFeePercent = 0`, `devFeeAmountCents = 0`, `baseAmountCents = grossAmountCents`.

**§F8.2 — XP shared sourceRef.** `sourceRef = 'garage:<garageId>'` for `XpReason.premium_activation` is the SHARED idempotency key across admin grant route (`apps/api/src/routes/admin/user-garage.ts`) AND self-serve webhook activation (F8 chunks). One-shot-ever per garage. The XpEvent unique `(garageId, reason, sourceRef)` (Phase 2 §C1) makes the second path silently no-op via the awarder's P2002 swallow.

**§F8.3 — Garage snapshot max() rule.** Webhook handler writes `Garage.premiumUntil = max(existing, new currentPeriodEnd)`. NEVER overwrite unconditionally. Admin-grant extensions are never clobbered. Document inline at every call site.

**§F8.4 — Activation tx atomicity.** Inside one Prisma `$transaction`: `SubscriptionWebhookEvent` insert (idempotency dedup) → `SELECT garage FOR UPDATE` → `PremiumMembership` upsert → `PremiumMembershipInvoice` insert → `Garage` snapshot write → `awardXp` call → `SubscriptionWebhookEvent.processedAt = now()` → COMMIT. Ticket backfill MUST happen POST-COMMIT (queued background job — never inside the activation tx).

**§F8.5 — Garage row lock.** Every webhook tx in `applyMembershipEvent` opens with `await tx.$queryRaw\`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE\``. Serializes concurrent webhooks for the same garage. Closes the upsert-race window.

**§F8.6 — Single awardXp per activation tx.** v1 invariant: the activation tx calls `awardXp` EXACTLY ONCE. Multi-call inside one tx is a known awarder bug (savepoint name collision — orchestrator deferred item #12 from Phase 2). Integration test in chunk F8.03 asserts only one call.

**§F8.7 — Premium-grant tier selection.** Backfill + publish-hook MUST pick the first `TicketTier WHERE eventId = E AND isPremiumGrantable = true AND (salesCloseAt IS NULL OR salesCloseAt > now())`. If none: skip the event, emit a structured log `premium_grant.no_tier { eventId, reason }`, continue. NEVER raise; the loop must not abort.

**§F8.8 — Partial unique on Ticket (narrowed to `source='premium_grant'`).** `CREATE UNIQUE INDEX ticket_one_premium_grant_per_user_event ON "Ticket" ("userId","eventId") WHERE status = 'valid' AND source = 'premium_grant';`. Lands in chunk F8.01 migration. F8.06 backfill + F8.07 publish-hook are the only flows that create `source='premium_grant'` rows; this narrowed index is their DB-level idempotency backstop. Application-level `findFirst` checks remain belt-and-braces. **Why narrowed:** the broader `WHERE status='valid'` form was dropped in `20260503163319_drop_ticket_user_event_unique` because multi-ticket purchases (`Event.maxTicketsPerUser > 1`) and comp grants legitimately create multiple valid Ticket rows per `(userId, eventId)`; restoring the broader form would regress those flows. Purchase + comp paths stay unconstrained at the DB level — their cap enforcement lives in `apps/api/src/services/tickets/{issue,grant}.ts` via `existingValidCount` checks.

**§F8.9 — Non-BR RC events.** RC payload `event.country_code != 'BR'` → log + 200-OK ack WITHOUT writing Membership/Invoice rows. v1 BR-only. Log: `premium_rc.non_br_storefront { providerEventId, country_code }`. Returning 4xx triggers RC retries; we return 200 to acknowledge receipt.

**§F8.10 — Refund honors period end.** `charge.refunded` for a sub invoice flips `PremiumMembershipInvoice.status` to `refunded` (full) or `partial_refund` (partial), sets `refundedAt`+`refundedAmountCents`. **Membership row stays active** through `currentPeriodEnd`; Garage snapshot unchanged. Admin tool `POST /users/:id/garage/premium { tier: null }` is the only path that mid-period revokes entitlement (abuse cases).

**§F8.11 — Feature flag.** All F8 routes + webhook handlers + background workers gate on `env.GROWTH_PREMIUM_BILLING_ENABLED` (default `false`). Disabled state: webhook routes return 200 OK + log + skip; mobile/web subscribe routes return 503 + maintenance message. Flag flips on AFTER all 19 chunks land + smoke passes (chunk F8.19). Add to `apps/api/src/env.ts` zod schema in chunk F8.01.

**§F8.12 — Filtered test + lint commands.** Same as Phase 2 §10: `pnpm --filter <pkg> exec vitest run <PACKAGE-ROOT-RELATIVE>`. Mobile is `@ccc/mobile`. Never use `pnpm --filter X test -- ...` (drops args).

**§F8.13 — Rebuild @ccc/shared after schema changes.** Schema migrations or new `packages/shared/src/*.ts` exports require `pnpm --filter @ccc/shared build` before any downstream package's tests are accurate. Phase 2 lesson recorded in handoff. Chunks F8.01, F8.02, F8.11 all touch shared exports.

**§F8.14 — UI dep + harness.** Any new mobile/UI dep (e.g. `react-native-purchases`) lands in both `apps/mobile/package.json` AND `pnpm-lock.yaml` in the same chunk. UI test harness reuses mobile mocks from `packages/ui/src/__tests__/BadgeRow.test.tsx`. (Phase 2 §13 carryover.)

**§F8.15 — Webhook idempotency model.** Two-layer: (a) `SubscriptionWebhookEvent @@unique(provider, providerEventId)` — provider-level event dedup; (b) `PremiumMembershipInvoice @@unique(provider, providerInvoiceRef)` — per-invoice dedup. Replays MUST short-circuit at layer (a) with 200 OK + no further work. Chunks F8.04 + F8.05 own (a); chunk F8.03 owns (b). NEVER skip storing `payload Json` on `SubscriptionWebhookEvent` (load-bearing for prod debugging — Phase 2 didn't have this gap, but other one-time webhook code in `stripe-webhook.ts` does).

**§F8.16 — SUPERSEDIDO em 2026-08-29.** Motivo: a diretriz citada como base
(`3.1.5(a)`) não existe mais; `3.1.5` hoje é "Cryptocurrencies". O texto vivo é
`3.1.3(e) — Goods and Services Outside of the App`, que exige método de pagamento
**fora** do in-app purchase para bens e serviços **físicos** consumidos fora do
app. O iOS passa a pagar por Stripe nativo. A regra de lint `no-stripe-on-ios` e
o teste de isolamento foram removidos. Ver
`docs/superpowers/specs/2026-08-29-pagamentos-mobile-consolidado-design.md` (C1) e
`docs/superpowers/plans/2026-08-29-pagamentos-mobile-app.md` (Task 1). Texto
original preservado abaixo para histórico.

**§F8.16 — iOS bundle isolation.** iOS code path MUST NOT link to, mention, or redirect to Stripe checkout. Enforced via a lint rule added in chunk F8.18 (forbid `stripe://`, `checkout.stripe.com`, `STRIPE_PUBLISHABLE_KEY` references inside iOS-conditional `apps/mobile/src/` code blocks). App Review hinges on this.

## Dependency graph

```
Wave A — schema + adapters + core service (no UI)
  F8.01 (schema migration + env + flag) → F8.02 (BillingEvent types + provider interfaces)
                                        → F8.03 (applyMembershipEvent service + canon §F8.4 atomicity)

Wave B — webhook routes (parallel after F8.03)
  F8.03 ──→ F8.04 (Stripe billing webhook + event normalizer)
        ──→ F8.05 (RevenueCat webhook + event normalizer + non-BR filter)

Wave C — activation side-effects (parallel after F8.03 + F8.08)
  F8.03 ──→ F8.06 (post-commit ticket backfill worker)
  F8.08 ──→ F8.07 (event-publish premium-grant hook)
  F8.01 ──→ F8.08 (TicketTier.isPremiumGrantable + admin event-tier UI)

Wave D — checkout + status APIs (parallel after F8.04 + F8.05)
  F8.04 ──→ F8.09 (Stripe checkout + portal routes + duplicate-subscribe precheck)
  F8.05 ──→ F8.10 (RevenueCat SDK mobile integration + app_user_id)
  F8.03 ──→ F8.11 (premium status endpoint)

Wave E — reconciliation (after F8.03)
  F8.03 ──→ F8.12 (hourly reconciliation sweep worker)

Wave F — admin financial dashboard (parallel after F8.03)
  F8.03 ──→ F8.13 (finance API: summary/trends/payment-mix membership fields)
        ──→ F8.14 (finance API: /finance/memberships endpoint + CSV export columns)
  F8.13 + F8.14 ──→ F8.15 (admin UI: filter-bar + KPI tiles + trend-chart + payment-mix)
                  → F8.16 (admin UI: /financeiro/membros page + member-detail actions)

Wave G — subscribe UI (after F8.09 + F8.10 + F8.11)
  F8.09 + F8.11 ──→ F8.17 (web /premium pricing + checkout integration)
  F8.10 + F8.11 ──→ F8.18 (mobile premium settings + iOS RC purchase + Android Stripe + lint rule)

Wave H — smoke + flag flip
  ALL ──→ F8.19 (Stripe test mode + RC sandbox + TestFlight smoke + flag flip + handoff)
```

| Wave | Chunks                        | Parallel width           |
| ---- | ----------------------------- | ------------------------ |
| A    | F8.01 → F8.02 → F8.03         | sequential               |
| B    | F8.04 ‖ F8.05                 | 2                        |
| C    | F8.06 ‖ F8.07 ‖ F8.08         | 3 (F8.07 gated on F8.08) |
| D    | F8.09 ‖ F8.10 ‖ F8.11         | 3                        |
| E    | F8.12                         | 1                        |
| F    | F8.13 ‖ F8.14 → F8.15 ‖ F8.16 | 2 ‖ then 2 ‖             |
| G    | F8.17 ‖ F8.18                 | 2                        |
| H    | F8.19                         | sequential               |

Total: **19 chunks.** Peak parallelism: 3 (Waves C + D). Following the orchestrator's ≤3-chunks-per-run cap, the wall-clock dispatch needs ~7 runs minimum.

## Open questions blocking kickoff

None at this time. All product decisions locked in spec §1. Pricing values (`baseAmountCents` for monthly + annual Prices) are operational config in Stripe Dashboard, NOT a code concern — pin before launch but no chunk blocks on them.

Two product calls deferred to post-launch (Phase F8.1 backlog):

- Trial period (none v1)
- Push notifications on `past_due` / `activated` / `renewed`

If product overrides either before any specific chunk lands, the affected chunk's plan needs a revision pass.

## Carry-over fold-ins (from Phase 2 closeout)

Items 1–4 from the Phase 2 `.handoffs/orchestrator-state.md` Phase 2D backlog do NOT block F8:

- Item 1 (React-pin alignment) — F8 mobile chunks (F8.10, F8.18) touch `apps/mobile`, but do NOT revive `expo-blur`. No pin alignment needed.
- Item 2 (XPTooltip blur revival) — out of F8 scope.
- Item 3a–e (XP UI polish backlog) — out of F8 scope.
- Item 4 (animation policy) — out of F8 scope.

If Phase 2D ever ships in parallel, coordinate the React-pin alignment timing with chunk F8.18 (which adds `react-native-purchases`).

## Chunks

### Wave A — Foundations (sequential)

#### F8.01 — Schema migration + env flag + zod skeletons

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-01-schema-and-flag.md`

**Files touched:**

- `packages/db/prisma/schema.prisma` — add enums (`PremiumProvider`, `PremiumCadence`, `PremiumMembershipStatus`), models (`PremiumMembership`, `PremiumMembershipInvoice`, `SubscriptionWebhookEvent`), `TicketTier.isPremiumGrantable Boolean @default(false)`.
- `packages/db/prisma/migrations/NNNN_f8_premium_billing/migration.sql` — Prisma-generated + manual append of two raw partial unique indexes: `premium_membership_live_per_garage` and `ticket_one_premium_grant_per_user_event` (narrowed to `WHERE status='valid' AND source='premium_grant'` — canon §F8.8).
- `apps/api/src/env.ts` — add `GROWTH_PREMIUM_BILLING_ENABLED: z.coerce.boolean().default(false)` + `REVENUECAT_WEBHOOK_AUTH_HEADER`, `STRIPE_BILLING_WEBHOOK_SECRET` env entries.
- `packages/shared/src/premium.ts` (NEW) — zod skeletons (empty exports; chunk F8.11 populates).
- `packages/shared/src/index.ts` — re-export `./premium`.

**Done when:** Prisma client regenerates; `@ccc/shared` builds (canon §F8.13); migration applies cleanly on a test DB; both partial unique indexes created; env zod parses with new vars defaulted.

**Tests:** `packages/db/test/schema.test.ts` (extend) — assert partial unique index existence via `pg_indexes` query; `apps/api/test/env.test.ts` (extend) — assert feature-flag default `false`.

**Verification:**

```
pnpm --filter @ccc/db run db:migrate
pnpm --filter @ccc/db build
pnpm --filter @ccc/shared build
pnpm --filter @ccc/db exec vitest run test/schema.test.ts
pnpm --filter @ccc/api exec vitest run test/env.test.ts
```

**Canon refs:** §F8.8, §F8.11, §F8.13. Spec §2 (full schema text), §9 (migration plan).

#### F8.02 — `BillingEvent` types + provider adapter interfaces

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-02-billing-event-types.md`

**Files touched:**

- `apps/api/src/services/billing/types.ts` (NEW) — discriminated-union `BillingEvent` (spec §3.2); type-narrowing test fixtures.
- `apps/api/src/services/billing/normalize-stripe.ts` (NEW, stub) — `normalizeStripeEvent(rawEvent): BillingEvent | null` signature only.
- `apps/api/src/services/billing/normalize-revenuecat.ts` (NEW, stub) — `normalizeRevenueCatEvent(rawEvent): BillingEvent | null` signature only.
- `apps/api/src/services/billing/index.ts` (NEW) — barrel re-exports.

**Done when:** TypeScript compiles end-to-end; types correctly narrow under switch-on-`kind`; stubs throw `Error('not implemented')` and are explicitly tested for that.

**Tests:** `apps/api/test/billing/billing-event-types.test.ts` — type-narrowing assertions on each discriminant; stub-throws check.

**Verification:**

```
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api exec vitest run test/billing/billing-event-types.test.ts
```

**Canon refs:** §F8.13. Spec §3.2, §3.3, §3.4.

#### F8.03 — `applyMembershipEvent` core service (atomicity + XP + canon §F8.4–§F8.6)

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-03-apply-membership-event.md`

**Files touched:**

- `apps/api/src/services/billing/apply-membership-event.ts` (NEW) — main service: opens `prisma.$transaction`, `SELECT garage FOR UPDATE` (canon §F8.5), branches on `BillingEvent.kind`, calls `awardXp` exactly once (canon §F8.6) on `subscription.activated`.
- `apps/api/src/services/billing/apply-membership-event.test.ts` (NEW) — Testcontainers Postgres; tests one transition per event kind + idempotency + admin-grant coexistence.
- `apps/api/test/billing/premium-activation-idempotency.test.ts` (NEW) — admin-grant-then-webhook + webhook-then-admin-grant + double-webhook scenarios (spec §3.6 + §13 §F8.2).

**Done when:** all 11 BillingEvent transitions (`activated`, `renewed`, `cancelled`, `uncancelled`, `expired`, `past_due`, `tier_changed` × 2 providers) write the expected Membership / Invoice / Garage rows; canon §F8.5 `FOR UPDATE` lock is asserted via concurrent-tx test (two concurrent activations for the same garage, one wins, one P2002s); canon §F8.6 single-`awardXp`-per-tx assertion holds.

**Tests:** see above. Mocks forbidden per CLAUDE.md — Testcontainers Postgres only.

**Verification:**

```
pnpm --filter @ccc/api exec vitest run test/billing/apply-membership-event.test.ts test/billing/premium-activation-idempotency.test.ts
```

**Canon refs:** §F8.2, §F8.3, §F8.4, §F8.5, §F8.6, §F8.15. Spec §3, §4.1, §4.3, §4.4, §4.7.

### Wave B — Webhook routes (parallel after F8.03)

#### F8.04 — Stripe billing webhook route

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-04-stripe-billing-webhook.md`

**Files touched:**

- `apps/api/src/services/billing/normalize-stripe.ts` — fill in body: map `invoice.paid` (billing_reason discriminator), `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `charge.refunded` per spec §3.3.
- `apps/api/src/routes/stripe-billing-webhook.ts` (NEW) — Fastify route; signature verification via `app.stripe.constructWebhookEvent`; idempotency insert into `SubscriptionWebhookEvent`; calls `applyMembershipEvent` for non-refund events; refund handler updates `PremiumMembershipInvoice.status` (canon §F8.10) without touching Membership.
- `apps/api/src/app.ts` — register the route.
- `apps/api/test/billing/stripe-billing-webhook.test.ts` (NEW) — full integration suite: each Stripe event type → expected DB state; signature-failure 400; replay short-circuit; flag-disabled state.

**Done when:** all spec §3.3 event mappings produce expected `BillingEvent` outputs and downstream DB writes; replay returns 200 OK without further DB writes; signature failure returns 400.

**Verification:**

```
pnpm --filter @ccc/api exec vitest run test/billing/stripe-billing-webhook.test.ts
```

**Canon refs:** §F8.10, §F8.11, §F8.15. Spec §3.1, §3.3, §4.5.

#### F8.05 — RevenueCat webhook route

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-05-revenuecat-webhook.md`

**Files touched:**

- `apps/api/src/services/billing/normalize-revenuecat.ts` — fill in body: map `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `CANCELLATION`, `UNCANCELLATION`, `EXPIRATION`, `BILLING_ISSUE` per spec §3.4; non-BR storefront filter (canon §F8.9).
- `apps/api/src/routes/revenuecat-webhook.ts` (NEW) — Fastify route; auth-header constant-time compare to `env.REVENUECAT_WEBHOOK_AUTH_HEADER`; idempotency insert into `SubscriptionWebhookEvent`; calls `applyMembershipEvent`.
- `apps/api/src/app.ts` — register the route.
- `apps/api/test/billing/revenuecat-webhook.test.ts` (NEW) — full integration suite: each RC event → DB state; non-BR storefront ack-without-record (canon §F8.9); auth-failure 401; replay short-circuit; flag-disabled state.

**Done when:** all spec §3.4 mappings work; non-BR returns 200 + log + no DB writes; auth fail returns 401; replay 200 OK.

**Verification:**

```
pnpm --filter @ccc/api exec vitest run test/billing/revenuecat-webhook.test.ts
```

**Canon refs:** §F8.9, §F8.11, §F8.15. Spec §3.1, §3.4.

### Wave C — Activation side-effects

#### F8.06 — Post-commit ticket backfill worker

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-06-ticket-backfill-worker.md`

**Files touched:**

- `apps/api/src/workers/premium-ticket-backfill.ts` (NEW) — job consumer; iterates published future events for the given garage; calls `pickPremiumGrantableTier` (canon §F8.7); inserts `Ticket { source: 'premium_grant' }` chunked 100/tx; relies on canon §F8.8 partial-unique for idempotency.
- `apps/api/src/services/billing/apply-membership-event.ts` — on `subscription.activated`, enqueue backfill job via existing worker infra (registered in `apps/api/src/workers/index.ts`) AFTER tx commits.
- `apps/api/src/workers/premium-ticket-backfill.test.ts` (NEW) — Testcontainers; tests: 50-event backfill batched correctly; idempotent on replay; skips events with no grantable tier; skips events where user already has valid ticket.

**Done when:** activation enqueues + worker fully processes backfill for a freshly-activated garage; idempotent across re-runs; structured logs per skipped event (canon §F8.7).

**Verification:**

```
pnpm --filter @ccc/api exec vitest run test/billing/apply-membership-event.test.ts src/workers/premium-ticket-backfill.test.ts
```

**Canon refs:** §F8.4, §F8.7, §F8.8. Spec §4.2.

#### F8.07 — Event-publish premium-grant hook

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-07-event-publish-grant.md`

**Files touched:**

- `apps/api/src/workers/premium-event-publish-grant.ts` (NEW) — job consumer; on event published, pages through active premium members 500/tx, inserts `premium_grant` Ticket if user has no valid ticket; relies on canon §F8.8.
- `apps/api/src/routes/admin/events.ts` (extend) — locate the publish handler; on tx commit (NOT inside the tx), enqueue the grant job. Wire via existing worker bus.
- `apps/api/src/workers/premium-event-publish-grant.test.ts` (NEW) — Testcontainers; tests: 1k-active-member event batched; idempotent; skips members with `cancelAtPeriodEnd=true` AND `currentPeriodEnd < event.startsAt`; skips event with no grantable tier (canon §F8.7).

**Done when:** publishing an event enqueues + processes the grant job; canon §F8.8 dedup confirmed; batching observed; no DB writes inside the publish tx itself.

**Verification:**

```
pnpm --filter @ccc/api exec vitest run src/workers/premium-event-publish-grant.test.ts test/admin/events.test.ts
```

**Canon refs:** §F8.7, §F8.8. Spec §4.6.

#### F8.08 — `TicketTier.isPremiumGrantable` + admin event-tier UI

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-08-ticket-tier-premium-grantable.md`

**Files touched:**

- `packages/db/prisma/schema.prisma` — already lands in F8.01; this chunk consumes it.
- `apps/api/src/routes/admin/events.ts` — extend tier CRUD to accept `isPremiumGrantable` boolean.
- `packages/shared/src/admin.ts` — extend `adminTicketTierSchema` with the field.
- `apps/admin/app/(authed)/events/[id]/tier-list.tsx` — checkbox UI ("Grant to premium members on publish") + warning if event has zero grantable tiers at publish time (advisory, non-blocking).
- `apps/admin/app/(authed)/events/[id]/__tests__/tier-list.test.tsx` (NEW or extend) — UI assertions.

**Done when:** admin can flag a tier; admin event publish UI nudges when no grantable tier exists (non-blocking); shared zod schema accepts the field.

**Verification:**

```
pnpm --filter @ccc/api exec vitest run test/admin/events.test.ts
pnpm --filter @ccc/admin exec vitest run app/\(authed\)/events/\[id\]/__tests__/tier-list.test.tsx
```

**Canon refs:** §F8.7. Spec §2.5.

### Wave D — Checkout + status APIs (parallel after F8.04 + F8.05)

#### F8.09 — Stripe checkout + portal routes + duplicate-subscribe precheck

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-09-stripe-checkout-routes.md`

**Files touched:**

- `apps/api/src/services/stripe/index.ts` — add `createSubscriptionCheckoutSession({ customerId, priceId, successUrl, cancelUrl, metadata, idempotencyKey })` (mode='subscription') + `createBillingPortalSession(customerId)` + `findOrCreateCustomer({ email, garageId })` (sets `metadata.garageId`).
- `apps/api/src/routes/me-premium.ts` (NEW) — endpoints: `GET /api/me/premium/checkout-precheck` (spec §5), `POST /api/me/premium/checkout` (creates Stripe Checkout session for the chosen cadence; passes `garageId` in metadata), `POST /api/me/premium/billing-portal` (returns portal URL).
- `apps/api/src/app.ts` — register the route group.
- `packages/shared/src/premium.ts` — populate request/response schemas.
- `apps/api/test/billing/me-premium.test.ts` (NEW) — happy path + 409 cross-platform guard (canon §F8 dup-subscribe rule) + flag-disabled 503.

**Done when:** precheck returns 200 `{ available: true }` for users with no live membership; 409 with `provider` + `manageUrl` for users with one; checkout returns Stripe-hosted URL; portal returns portal URL.

**Verification:**

```
pnpm --filter @ccc/api exec vitest run test/billing/me-premium.test.ts
```

**Canon refs:** §F8.11. Spec §5, §8.2.

#### F8.10 — RevenueCat SDK mobile integration

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-10-revenuecat-sdk-mobile.md`

**Files touched:**

- `apps/mobile/package.json` — add `react-native-purchases` (or `react-native-purchases-ui` if RC ships paywall UI v1). Pin version. Update `pnpm-lock.yaml` (canon §F8.14).
- `apps/mobile/app.json` — add RC iOS API key env (`EXPO_PUBLIC_RC_IOS_API_KEY`).
- `apps/mobile/src/lib/revenuecat.ts` (NEW) — SDK init (iOS-only branch via `Platform.OS === 'ios'`); `app_user_id = garageId`; offerings fetch helper; purchase trigger helper. ANDROID PATH IS A NO-OP (canon §F8.16).
- `apps/mobile/src/lib/revenuecat.test.tsx` (NEW) — mock RC SDK; iOS path called; Android path no-op; `app_user_id` matches garageId.

**Done when:** SDK initializes on iOS; Android path is no-op; integration test mocks confirmed.

**Verification:**

```
pnpm --filter @ccc/mobile exec vitest run src/lib/revenuecat.test.tsx
```

**Canon refs:** §F8.14, §F8.16. Spec §8.1.

#### F8.11 — Premium status endpoint

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-11-premium-status-endpoint.md`

**Files touched:**

- `apps/api/src/routes/me-premium.ts` — add `GET /api/me/premium/status`. Returns spec §8.3 `premiumStatusSchema` shape.
- `packages/shared/src/premium.ts` — populate `premiumStatusSchema`.
- `packages/shared/src/index.ts` — re-export (canon §F8.13).
- `apps/api/test/billing/me-premium-status.test.ts` (NEW) — covers: never-subscribed user, active, past_due, cancel_scheduled (with `manageUrl`), expired.

**Done when:** endpoint returns the documented zod shape across all `PremiumMembershipStatus` values for the requesting user's garage.

**Verification:**

```
pnpm --filter @ccc/api exec vitest run test/billing/me-premium-status.test.ts
pnpm --filter @ccc/shared build
```

**Canon refs:** §F8.13. Spec §8.3.

### Wave E — Reconciliation (after F8.03)

#### F8.12 — Hourly reconciliation sweep worker

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-12-reconciliation-sweep.md`

**Files touched:**

- `apps/api/src/workers/billing-reconcile.ts` (NEW) — cron-driven worker; query `WHERE status IN ('active','past_due','cancel_scheduled') AND currentPeriodEnd < now()`; per-row: Stripe `subscriptions.retrieve` OR RC `/v1/subscribers/{customerRef}` API call; reconcile state via `applyMembershipEvent` (or direct snapshot-clear if expired).
- `apps/api/src/workers/index.ts` — register cron schedule (hourly).
- `apps/api/src/services/revenuecat/client.ts` (NEW) — minimal REST client for `GET /v1/subscribers/{app_user_id}` with RC API key from `env.REVENUECAT_REST_API_KEY` (add to env in this chunk).
- `apps/api/src/workers/billing-reconcile.test.ts` (NEW) — Testcontainers + mocked Stripe SDK + mocked RC client; tests: Stripe-drift recovery, RC-drift recovery, no-op when no rows due, alert when queue depth exceeds threshold.

**Done when:** sweep recovers from a manually-induced drift (Stripe sub canceled but DB still active); covers both providers; alert path tested.

**Verification:**

```
pnpm --filter @ccc/api exec vitest run src/workers/billing-reconcile.test.ts
```

**Canon refs:** §F8.4, §F8.11. Spec §6.

### Wave F — Admin financial dashboard (parallel after F8.03)

#### F8.13 — Finance API: summary/trends/payment-mix membership fields

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-13-finance-api-membership-summary.md`

**Files touched:**

- `apps/api/src/routes/admin/finance.ts` — extend `/finance/summary` with membership KPIs (spec §7.1); extend `/finance/trends` with `membershipRevenueCents` per bucket; extend `/finance/payment-mix` to include `stripe:subscription` + `apple_revenuecat:storekit`. Add helper `findMembershipInvoices(where)` parallel to `findFinanceOrders`.
- `packages/shared/src/admin.ts` — extend `adminFinanceSummarySchema`, `adminFinanceTrendsSchema`, `adminFinancePaymentMixSchema` with the new fields.
- `apps/api/test/admin/finance-summary-memberships.test.ts` (NEW) — covers MRR rounding (canon §F8 §17), ARPU /0 guard, churn count, payment-mix rendering.

**Done when:** API returns membership-aware payloads; zod schemas validate; MRR math matches spec §7.3 rounding rule (`Math.round(gross/12)` for annual).

**Verification:**

```
pnpm --filter @ccc/api exec vitest run test/admin/finance-summary-memberships.test.ts
pnpm --filter @ccc/shared build
```

**Canon refs:** §F8.1, §F8.13. Spec §7.1, §7.3.

#### F8.14 — Finance API: /finance/memberships endpoint + CSV export columns

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-14-finance-memberships-endpoint.md`

**Files touched:**

- `apps/api/src/routes/admin/finance.ts` — add `GET /finance/memberships` paginated list (spec §7.1 shape); extend `/finance/export` CSV with `cadence`, `is_membership`, `membership_invoice_id` columns; apply `MIN_FINANCE_EXPORT_COHORT_SIZE = 5` to membership cohorts.
- `packages/shared/src/admin.ts` — `adminFinanceMembershipsQuerySchema`, `adminFinanceMembershipsResponseSchema`.
- `apps/api/test/admin/finance-memberships-list.test.ts` (NEW) — pagination, filters (status, cadence, tier, provider, date, search), k-anonymity-suppression on CSV.

**Done when:** endpoint paginates and filters per spec; CSV includes new columns; k-anonymity guard active on membership cohorts.

**Verification:**

```
pnpm --filter @ccc/api exec vitest run test/admin/finance-memberships-list.test.ts
pnpm --filter @ccc/shared build
```

**Canon refs:** §F8.13. Spec §7.1.

#### F8.15 — Admin UI: filter-bar + KPI tiles + trend-chart + payment-mix

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-15-admin-financeiro-ui.md`

**Files touched:**

- `apps/admin/app/(authed)/financeiro/components/filter-bar.tsx` — add `kind` dropdown + `cadence`/`tier`/`status` sub-filters.
- `apps/admin/app/(authed)/financeiro/components/kpi-row.tsx` — three new tiles (`Receita de Membros`, `Membros Ativos`, `MRR`); update total "Receita líquida".
- `apps/admin/app/(authed)/financeiro/components/payment-mix.tsx` — render up to 4 rows incl. `stripe:subscription` + `apple_revenuecat:storekit`.
- `apps/admin/app/(authed)/financeiro/components/trend-chart.tsx` — stacked area: ticketRevenue + storeRevenue + membershipRevenue.
- `apps/admin/app/(authed)/financeiro/components/__tests__/*` — extend existing test files per component change; add snapshot/interaction tests for new tiles and stacking.

**Done when:** dashboard renders membership KPIs; filter-bar narrows by kind; payment-mix shows new rows; trend stacking visible in snapshot.

**Verification:**

```
pnpm --filter @ccc/admin exec vitest run app/\(authed\)/financeiro/components/__tests__/
```

**Canon refs:** Spec §7.2.

#### F8.16 — Admin UI: /financeiro/membros page + member-detail actions

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-16-admin-financeiro-membros.md`

**Files touched:**

- `apps/admin/app/(authed)/financeiro/membros/page.tsx` (NEW) — paginated table from `/finance/memberships`; filters bar (reuses `filter-bar` cadence/tier/status); per-row "Ver detalhes" deep-link to `/users/:id/garage` with audit-log section showing grants/revokes + invoice history.
- `apps/admin/app/(authed)/financeiro/membros/__tests__/page.test.tsx` (NEW) — pagination, filter passes through, row click navigation, empty state.
- `apps/admin/src/components/garage-membership-history.tsx` (NEW) — embedded invoice history component for the user-garage detail page; reads from `/finance/memberships` filtered by garage.

**Done when:** page renders; pagination + filters work; navigation to user-garage detail works; invoice history component visible on `/users/:id/garage`.

**Verification:**

```
pnpm --filter @ccc/admin exec vitest run app/\(authed\)/financeiro/membros/__tests__/ src/components/__tests__/garage-membership-history.test.tsx
```

**Canon refs:** Spec §7.2.

### Wave G — Subscribe UI (after F8.09 + F8.10 + F8.11)

#### F8.17 — Web `/premium` pricing + Stripe Checkout integration

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-17-web-premium-page.md`

**Files touched:**

- `apps/admin/app/premium/page.tsx` (NEW) — pricing page (monthly vs annual cards; brand-tinted; "Assinar" CTA). NOT authed-only; visitors must sign in to subscribe.
- `apps/admin/app/premium/actions.ts` (NEW) — server action calling `POST /api/me/premium/checkout` to mint a Stripe Checkout session, returns URL; client redirects.
- `apps/admin/app/me/billing/page.tsx` (NEW) — links to Stripe Billing Portal (calls `POST /api/me/premium/billing-portal`).
- `apps/admin/app/premium/__tests__/page.test.tsx` (NEW) — pricing render + CTA wiring.

**Done when:** signed-in user can subscribe via Stripe Checkout; signed-in user can open the billing portal from `/me/billing`; signed-out user sees a sign-in nudge.

**Verification:**

```
pnpm --filter @ccc/admin exec vitest run app/premium/__tests__/page.test.tsx
```

**Canon refs:** §F8.11. Spec §8.2.

#### F8.18 — Mobile premium settings + iOS RC + Android Stripe + lint rule

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-18-mobile-premium-screen.md`

**Files touched:**

- `apps/mobile/src/screens/settings/PremiumScreen.tsx` (NEW) — premium status read (`/api/me/premium/status`); subscribe CTA: iOS branch calls RC SDK (chunk F8.10); Android branch opens WebBrowser to `/premium` web flow + deep-link return.
- `apps/mobile/src/screens/settings/PremiumScreen.test.tsx` (NEW) — Platform.OS branching; iOS RC purchase mocked; Android opens WebBrowser; status display per state.
- `apps/mobile/src/navigation/SettingsStack.tsx` — register `PremiumScreen`.
- `.eslintrc.cjs` (root) — add custom rule (or inline `eslint-disable` allowlist) forbidding `stripe://`, `checkout.stripe.com`, `STRIPE_PUBLISHABLE_KEY` inside any file matching `apps/mobile/src/**/*.{ts,tsx}` UNLESS guarded by `Platform.OS !== 'ios'` (canon §F8.16).
- `apps/mobile/test/lint/ios-stripe-isolation.test.ts` (NEW) — spawns eslint on a fixture file containing a forbidden token under iOS path; asserts failure.

**Done when:** mobile premium screen ships; iOS uses RC, Android uses Stripe via WebBrowser; lint rule fires on a fixture iOS-bound Stripe reference; status display matches `/api/me/premium/status` payload per state.

**Verification:**

```
pnpm --filter @ccc/mobile exec vitest run src/screens/settings/PremiumScreen.test.tsx test/lint/ios-stripe-isolation.test.ts
```

**Canon refs:** §F8.11, §F8.14, §F8.16. Spec §8.1.

### Wave H — Smoke + flag flip

#### F8.19 — Stripe test mode + RC sandbox + TestFlight smoke + flag flip + handoff

**Plan file:** `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-19-smoke-and-flag.md`

**Files touched:**

- `docs/stripe.md` — document Stripe Dashboard config (Product, Prices, Price metadata, webhook endpoint registration); Stripe Tax config note.
- `docs/revenuecat.md` (NEW) — document RC dashboard config (iOS app, offerings, entitlement, webhook auth header, REST API key).
- `docs/manual-testing.md` — add F8 smoke checklist: Stripe test-mode subscribe + cancel; RC sandbox subscribe + expire; TestFlight subscribe + restore-purchases.
- `apps/api/src/env.ts` — flip default of `GROWTH_PREMIUM_BILLING_ENABLED` ONLY after smoke passes on a deployed preview env. The code change is one line; the deploy is the actual gate.
- `.handoffs/orchestrator-state.md` — overwrite to record F8 completion + deferred items (trial, dunning push, family plans, promo codes, cohort dashboard).

**Done when:** smoke passes in all three environments; feature flag flipped on production; handoff reflects deferred Phase F8.1 backlog.

**Verification:** manual + dashboards (no automated test). Documented smoke runbook in `docs/manual-testing.md`.

**Canon refs:** §F8.11. Spec §9, §10.

---

## Risks + open follow-ups (mirror spec §11)

| Risk                                                                      | Posture                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Apple rejects iOS build for implying Stripe/external payment surface.     | Canon §F8.16 lint rule enforces isolation. App Review notes document the constraint. Chunk F8.18 owns the rule.                      |
| Google Play parity — Android Stripe path may violate Play billing policy. | Brainstorm-pinned trade-off. If Play rejects: chunk F8.20 (NEW; out of v1 scope) pivots Android to Google Play Billing via RC.       |
| RC webhook latency (hours).                                               | Chunk F8.12 reconciliation sweep closes the entitlement window.                                                                      |
| Stripe Price metadata drift vs server env.                                | Snapshotted on every invoice (canon §F8.1). Admin dashboard (chunk F8.13/14) surfaces mismatch warnings.                             |
| Multi-call `awardXp` SAVEPOINT collision.                                 | v1 mandates single `awardXp` per activation tx (canon §F8.6). Integration test in F8.03. Multi-call fix is a separate awarder chunk. |

## Deferred to Phase F8.1 (post-launch backlog)

- Trial period (free 7/14 day) — spec §10 + brainstorm.
- Dunning push notifications + receipt emails — spec §10 + finding #22.
- Family / gift subscriptions — spec §10.
- Brazilian Stripe Tax / VAT compliance — operational, not code.
- Cohort retention dashboard (`/finance/membership-cohorts`) — spec §10.
- Promo codes / coupons — spec §10.
- Per-tier perk-gating code paths — single tier v1; spec §10.
- Animated "Welcome to Gold" splash — UI polish.

## Pointer to plan files

- F8 spec (canonical): `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md`.
- F8 per-chunk plans: `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-NN-<slug>.md` (19 files, to be authored by dispatched subagent planners).
- Phase 2 master index (canon §C1–§C14 carry forward): `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md`.
- Phase 2 per-chunk plans (reference for TDD format): `docs/superpowers/plans/2026-05-24-phase2-chunks/`.
