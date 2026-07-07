# JDMA-258 — Research: Replace Stripe with AbacatePay

Date: 2026-05-05  
Owner: CTO  
Scope: Research + plan only (no implementation)

## Board decision outcome

Decision captured on 2026-05-05 by `local-board`:

- Keep current hybrid payment architecture now.
- Defer AbacatePay card replacement work to Phase 2 or Phase 3.

## Decision summary

Recommendation: **do not replace Stripe completely right now**.

Use AbacatePay for Pix (current F4b path) and keep Stripe for card + Apple Pay + membership billing until AbacatePay card/subscription behavior is validated in production with a controlled pilot.

## Why this is the recommendation

1. **Mobile checkout regression risk (high)**  
   Current mobile flow uses in-app Stripe Payment Sheet (`@stripe/stripe-react-native`) with Apple Pay/Google Pay support.  
   AbacatePay checkout returns a hosted URL (`url`) and is redirect-based for card; transparent API is Pix/Boleto-focused.

- Stripe in-app payments / Payment Sheet docs:
  - https://docs.stripe.com/payments/mobile/accept-payment?platform=react-native&type=payment
  - https://docs.stripe.com/payments/mobile
- AbacatePay checkout reference (`/checkouts/create` returns URL):
  - https://docs.abacatepay.com/pages/payment/reference
- AbacatePay transparent checkout (`method` = PIX/BOLETO only):
  - https://docs.abacatepay.com/pages/transparents/create

2. **Membership invariant mismatch risk (high)**  
   Our invariant requires cancel-at-period-end behavior for membership grants.  
   AbacatePay cancel endpoint states immediate, irreversible cancel.

- AbacatePay subscription cancel docs:
  - https://docs.abacatepay.com/pages/subscriptions/cancel
- Stripe supports `cancel_at_period_end`:
  - https://docs.stripe.com/api/subscriptions/update
  - https://docs.stripe.com/billing/subscriptions/cancel

3. **Documentation/contract consistency risk (medium)**  
   AbacatePay subscription docs show conflicting signals:

- `POST /subscriptions/create` says only CARD for subscriptions.
- Subscription webhook examples include PIX and CARD for subscriptions.

Sources:

- https://docs.abacatepay.com/pages/subscriptions/create
- https://docs.abacatepay.com/pages/webhooks/events/subscriptions
- https://docs.abacatepay.com/pages/changelog

4. **Webhook model is compatible, but migration still non-trivial (medium)**  
   AbacatePay supports signed webhooks and event IDs, which matches our idempotency/security pattern, but this alone does not offset the checkout UX and recurring-billing gaps above.

Sources:

- https://docs.abacatepay.com/pages/webhooks/security
- https://docs.abacatepay.com/pages/webhooks/reference

## Tradeoffs

### Option A — Keep hybrid stack (recommended now)

- Card/Apple Pay + recurring: Stripe
- Pix one-time: AbacatePay

Pros:

- Preserves v0.1/v0.3 mobile UX and membership invariants.
- Lowest regression risk to paid conversion.
- Keeps F4b scope intact and launch-critical.

Cons:

- Two PSPs to operate.
- More webhook/ops surface area.

### Option B — Full replace Stripe with AbacatePay now (not recommended now)

Pros:

- Single PSP for Pix + card (+ possible subscriptions).
- Potential simplification on paper.

Cons:

- Rebuild checkout flow from in-app native sheet to redirect flow.
- Apple Pay/Google Pay parity unclear in current AbacatePay docs.
- Membership cancel-at-period-end contract mismatch.
- Higher chance of delays on v0.2/v0.3 roadmap gates.

## If leadership still wants full replacement: gated execution plan

Gate 0 (1–2 days): **Contract validation spike**

- Validate in AbacatePay sandbox:
  - Card one-time via checkout URL on mobile deep-link return.
  - Subscription creation and renewal events end-to-end.
  - Whether cancel-at-period-end equivalent exists (or definitive “no”).
  - Failure/retry webhooks for recurring billing.
- Exit criteria: written evidence for all four points.

Gate 1 (3–5 days): **Card-only pilot (tickets only)**

- Keep Stripe as fallback.
- Feature flag by environment and optional traffic %.
- Metrics: conversion, drop-off between app -> hosted checkout -> return, webhook latency, support tickets.

Gate 2 (2–4 days): **Subscription pilot decision**

- Proceed only if Gate 0 confirms lifecycle parity (especially period-end cancellation semantics).
- If parity missing, keep Stripe for F8 and revisit later.

Gate 3 (1–2 days): **Cutover decision**

- Decision criteria:
  - No invariant violations.
  - Conversion not worse than Stripe baseline.
  - Support load acceptable.
  - Rollback path tested.

## Epic update proposal (approved direction)

Epic `JDMA-9` stays unchanged for v0.2 (Pix scope only).

Create deferred backlog scope for Phase 2/3 as a separate follow-up issue:

1. `F4c 4.13` — AbacatePay card checkout pilot (feature-flagged, Stripe fallback).
2. `F4c 4.14` — Mobile redirect/return hardening + analytics instrumentation.
3. `F4c 4.15` — Subscription lifecycle parity spike (cancel policy + renew/fail webhooks).
4. `F4c 4.16` — Cutover ADR + rollback runbook.

## Final recommendation

Proceed with current roadmap strategy:

- v0.2: Pix via AbacatePay (no Stripe replacement yet).
- v0.3: keep Stripe for membership billing.
- Defer AbacatePay card-replacement exploration to Phase 2/3 backlog.
