# Garage Per-User Pivot — Manual Smoke-Test Plan

**Feature:** Garage per-user pivot (TASK-A → TASK-H + fix #366).
**Canonical spec:** [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](../docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md).
**Ledger:** [`.handoffs/garage-spots-orchestration.md`](./garage-spots-orchestration.md).
**Audience:** Human (or agent driving real device + browser) running checks against a deployed environment (staging or prod) before declaring rollout safe.
**Goal:** Catch behaviors that automated tests cannot — real Stripe/AbacatePay webhooks, real R2 uploads, real push notifications, multi-device concurrent flows, real device UI.

This is **NOT** a duplicate of the automated suite. Skip anything reproducible in vitest; focus on environment integrations.

---

## Table of contents

- [Quick smoke (15 min)](#quick-smoke-15-min)
- [UX Quick Scan (10 min)](#ux-quick-scan-10-min)
- [1. Setup](#1-setup)
- [2. Mobile attendee flows](#2-mobile-attendee-flows)
- [3. Admin organizer flows](#3-admin-organizer-flows)
- [4. API edge cases](#4-api-edge-cases)
- [5. Webhook + settlement](#5-webhook--settlement)
- [UX Audit](#ux-audit)
- [Screenshot Capture](#screenshot-capture)
- [6. Known dirt (do NOT flag)](#6-known-dirt-do-not-flag)
- [7. Rollback signals](#7-rollback-signals)
- [Sign-off](#sign-off)

---

## Quick smoke (15 min)

Highest-signal checks. Run these first; if any fail, escalate before touching the full plan.

- [ ] **Q1.** Fresh signup on mobile → app lands on `/garage` → row exists with `name='Garagem'`, `slug='user-<id8>'`, `isPublic=false`. (Locked contract: neutral defaults / no PII leak.)
- [ ] **Q2.** `curl -H "Authorization: Bearer <freshUserToken>" $API/me/garage` → response has `garage.isPremiumActive: false` AND `cars: []`. No 500.
- [ ] **Q3.** Premium user (admin-granted) hits `/me/garage` → `garage.isPremiumActive: true` AND every `cars[].isPremiumActive === true`. (Regression class PR #366.)
- [ ] **Q4.** Mobile owner viewing own garage → PremiumBadge visible on every car card for the premium user. (PR #365 + #366 visual confirmation.)
- [ ] **Q5.** Bounded-cap user at cap → tap "Add car" → UI surfaces `GARAGE_FULL` + buy-spot CTA. API returns 409 with `code: 'GARAGE_FULL'`.
- [ ] **Q6.** Buy 1× garage-spot via Pix on a real device → wait for webhook → reload `/me/garage` → new spot present with `source: 'purchase'` within 60 seconds.
- [ ] **Q7.** Attempt to add a 2× garage-spot to cart via API → 400. (Round-2 catch PR #364.)
- [ ] **Q8.** `GET /g/<knownPrivateSlug>` and `GET /g/<unknownSlug>` → identical 404 bodies. (Anti-enumeration.)
- [ ] **Q9.** `GET /g/<knownPublicSlug>` → returns `garage` + `cars` with allowlist fields only (no `userId`, no `premiumUntil`, no `createdAt`).
- [ ] **Q10.** Admin user-detail page → Garagem panel renders → grant premium (gold + premiumUntil set) → reload `/me/garage` from that user → `isPremiumActive: true`. Revoke → `isPremiumActive: false` immediately.
- [ ] **Q11.** **Screenshots — quick-smoke subset:** capture the 15 shots tagged `[quick-smoke]` in [Screenshot Capture §2](#2-capture-checklist). Drop them into `.handoffs/garage-spots-screenshots/` under their target folders. Skipping this blocks the designer agent handoff.

---

## UX Quick Scan (10 min)

Highest-leverage UX checks. Run on a phone. Goal: catch the "ships green but feels wrong" cases before the deep audit. If 2+ fail, escalate before continuing.

- [ ] **UX-Q1.** Fresh signup lands on `/garage` → does the screen explain _what this place is_ and _what to do first_, or does it look like a half-empty grid with a tiny CTA? (Currently `firstCarCta: 'Adicione seu primeiro carro'` is rendered as muted `<Text>` inside `ListEmptyComponent`, NOT a button.)
- [ ] **UX-Q2.** Tap the garage name in the header (`GarageHeader` summary row) — does anything visually signal "this is editable" before you tap? (No pencil, no underline; affordance is `accessibilityLabel="Toque para editar"` only.)
- [ ] **UX-Q3.** Toggle `Tornar pública` ON → does anything obvious happen on screen (share button + preview appear) and is the change visually unmissable? Toggle OFF → does the share/preview disappear with feedback or just vanish silently?
- [ ] **UX-Q4.** Bounded-cap user at cap → tap "Comprar Vaga Adicional" once. Count the taps + screen transitions to reach a state where the new spot is usable. (Expected: tap → cart → checkout → external payment → manual return → reload garage.)
- [ ] **UX-Q5.** Premium user views own garage → is the gold PremiumBadge legible against the card background in both light and dark mode? Tap it — does anything happen, or is it inert decoration?
- [ ] **UX-Q6.** On the empty-extra card (`FillSpotCard`), the title reads "Adicionar Carro" — identical to the free `AddCarPlaceholderCard`. Can a non-tech user tell free from extra slots at a glance? (Only the subtitle `Vaga extra disponível` vs `Use uma das suas vagas grátis` differs.)
- [ ] **UX-Q7.** Slug field on edit → type uppercase + a space → field doesn't accept uppercase (auto-lowercased) but space passes through to server-side validation. Does the user know _why_ save failed when they only see "Esta URL já está em uso"? (Validation error mapping in `GarageHeader` collapses `invalid_slug` → `slugTaken` copy — wrong message for a regex violation.)

---

## 1. Setup

### 1.1 Test accounts

- [ ] **Admin/organizer** with `role IN ('organizer','admin')` and access to admin app.
- [ ] **Attendee A — fresh signup** (no cars, no garage edits): create immediately before the run so signup hook is exercised.
- [ ] **Attendee B — free-cap user**: pre-existing user, `GeneralSettings.defaultFreeGarageSpots = N` (set N=2 for the run), no cars.
- [ ] **Attendee C — unlimited-cap user**: scoped to a window where `defaultFreeGarageSpots = NULL` (Ilimitado), or use a user grandfathered before cap. Has at least 1 car.
- [ ] **Attendee D — premium user**: admin-granted `premiumTier = 'gold'`, `premiumUntil > now() + 30d`. Has at least 1 car.
- [ ] **Attendee E — bounded user at cap**: cars equal to `defaultFreeGarageSpots`. Used to test `GARAGE_FULL`.

### 1.2 Test data

- [ ] 1× ticketed event in `published` state with at least 1 active tier.
- [ ] 1× virtual `garage-spot` Product in `active` status (singleton — slug `garage-spot`, productType `garage_spot`, `virtual=true`, `visibleInStore=false`). Verify via admin product list.
- [ ] At least 1 physical store product (with photos + a fulfillment method) so the mixed-order exclusion check works.
- [ ] (Optional) Confirm a Cars row per attendee D has at least 1 photo for the moderation feed surface.

### 1.3 Environment env-var sanity

- [ ] `STRIPE_SECRET_KEY` is the **test** key (starts `sk_test_`).
- [ ] `STRIPE_WEBHOOK_SECRET` matches the Stripe dashboard test webhook endpoint.
- [ ] `ABACATEPAY_API_KEY` is the **test** key (sandbox).
- [ ] `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` set; bucket is the staging bucket, not prod.
- [ ] Expo Push: `expo whoami` shows the project slug; mobile dev build has a registered push token (verify via admin user detail or DB).

### 1.4 DB precondition — reconcile sanity

- [ ] Run admin "view garage" on attendee B → reload → spot count matches `defaultFreeGarageSpots`. (Reconcile-before-read from PR #362.)
- [ ] Admin general-settings → set `defaultFreeGarageSpots` from `N` to `N+1` → revisit attendee B garage → spot count = `N+1`. (Self-healing reconcile from TASK-F.)
- [ ] Revert to original `N` before continuing.

---

## 2. Mobile attendee flows

Run on a real device (iOS preferred, Android second). Pixel-confirm everything that touches `PremiumBadge`.

### 2.1 Fresh signup (Attendee A)

- [ ] **2.1.1** Complete signup → app lands directly on `/garage`. **Verify:** route is `/garage`, not feed or home. (TASK-D acceptance.)
- [ ] **2.1.2** Inspect garage header → name reads `Garagem`, slug reads `user-XXXXXXXX` (8 hex chars), `Tornar pública` toggle off. **Verify:** matches locked contract "neutral defaults — no PII leak."
- [ ] **2.1.3** `curl` `/me/garage` for this user → `garage.name === 'Garagem'`, `garage.slug` matches `^user-[a-z0-9]{8}$`, `garage.isPublic === false`, `garage.isPremiumActive === false`.
- [ ] **2.1.4** Garage shows N empty slots (= `defaultFreeGarageSpots`). Empty slots labeled "Adicionar Carro" (free) — no "Preencher Vaga" yet. (PR #363.)

### 2.2 Inline garage edits (GarageHeader)

- [ ] **2.2.1** Tap name field → edit to `Garagem do Caio` → blur → optimistic update shows immediately → reload screen → persists.
- [ ] **2.2.2** Edit slug to `caio-jdm` → save → succeeds. **Verify:** `PATCH /me/garage` returned 200 with updated slug.
- [ ] **2.2.3** Edit slug to `Caio_JDM!` (uppercase + symbols) → server rejects with 400; UI reverts to last valid slug. (Slug regex `^[a-z0-9-]+$`.)
- [ ] **2.2.4** Edit slug to `admin` (reserved word) → server rejects with 400. (Reserved-word list per spec §2.1.)
- [ ] **2.2.5** Edit slug to an already-taken slug → server returns 409 `slug_taken`. UI surfaces error and reverts.
- [ ] **2.2.6** Rapid-fire slug edits (11 PATCHes in <60s from same user) → 11th returns 429. (Rate limit 10/min/user.)
- [ ] **2.2.7** Edit description to 600 chars → server rejects with 400 (max 500).
- [ ] **2.2.8** Toggle `Tornar pública` ON → success → reload → toggle still ON. Toggle OFF → reload → still OFF.
- [ ] **2.2.9** While `isPublic=false`, attempt to tap share-link control → control is disabled OR shows explanatory tooltip. (PR #363 round-2 catch.)
- [ ] **2.2.10** Public profile preview render inside `/garage` only appears when `isPublic=true`.

### 2.3 Free-cap user flows (Attendee B)

- [ ] **2.3.1** Open `/garage` → shows exactly N empty slot cards labeled "Adicionar Carro".
- [ ] **2.3.2** Tap first empty slot → car-create form opens. **Verify** form does NOT have a `description` field (dropped per pivot).
- [ ] **2.3.3** Submit car → car appears in the first empty slot. Remaining slots = N-1 empties.
- [ ] **2.3.4** Add a photo via the cameraroll → R2 pre-signed PUT succeeds → photo renders on the car card.

### 2.4 Unlimited-cap user (Attendee C)

- [ ] **2.4.1** Open `/garage` while `defaultFreeGarageSpots = NULL` → screen shows existing car(s) + one always-visible "Adicionar Carro" card (no fixed grid of empties). (PR #363 round-2 catch — add-card slot for unlimited+empty state.)
- [ ] **2.4.2** Add a car → list extends → add-card still visible.
- [ ] **2.4.3** Repeat 3× → all succeed; no `GARAGE_FULL`.

### 2.5 Bounded-cap user at cap (Attendee E)

- [ ] **2.5.1** Open `/garage` → all slots filled. No empty "Adicionar Carro" cards. One "Comprar Vaga Adicional" buy card visible.
- [ ] **2.5.2** Tap add-car somehow (deep link, retry of stale state) → server returns 409 `GARAGE_FULL` → UI surfaces buy-spot CTA. (Locked contract / PR #359.)

### 2.6 Buy virtual spot — Pix (AbacatePay)

- [ ] **2.6.1** Tap "Comprar Vaga Adicional" → cart shows 1× `garage-spot` line at the admin-set price.
- [ ] **2.6.2** Proceed to checkout → choose Pix → AbacatePay QR code renders.
- [ ] **2.6.3** Settle the QR in AbacatePay sandbox → wait → poll `/me/garage` (60s max).
- [ ] **2.6.4** New spot present with `source: 'purchase'`, `carId: null`, `sourceOrderItemId` set. (TASK-C settlement.)
- [ ] **2.6.5** Mobile garage screen now shows extra empty slot labeled "Preencher Vaga" (not "Adicionar Carro"). (Source-aware copy per TASK-D pivot notice.)
- [ ] **2.6.6** Add a car into the new extra slot → succeeds.

### 2.7 Buy virtual spot — card (Stripe)

- [ ] **2.7.1** Repeat 2.6 with a card via Stripe checkout (use test card `4242 4242 4242 4242`).
- [ ] **2.7.2** Stripe webhook fires → order flips `paid` → spot materializes within 60s.
- [ ] **2.7.3** (Negative) Reject the payment with test card `4000 0000 0000 0002` → order stays `pending` → no spot created.

### 2.8 Public profile (`/g/:slug`)

- [ ] **2.8.1** Attendee D toggles `isPublic=true`, sets slug `caio-d`.
- [ ] **2.8.2** Open `https://<api>/g/caio-d` in incognito browser → renders public garage with cars (allowlist fields only).
- [ ] **2.8.3** Inspect response: NO `userId`, NO `premiumUntil`, NO `createdAt/updatedAt`, NO car `userId`. (Spec §4.2 allowlist.)
- [ ] **2.8.4** `garage.isPremiumActive === true`, `garage.premiumTier === 'gold'`.
- [ ] **2.8.5** Attendee D toggles `isPublic=false` → `GET /g/caio-d` returns 404 immediately.
- [ ] **2.8.6** `GET /g/this-slug-does-not-exist` → 404. **Verify** response body is byte-identical to 2.8.5. (Anti-enumeration.)
- [ ] **2.8.7** Hammer 70 requests/min from same IP at `/g/<anyslug>` → 71st returns 429. (Rate limit 60/min/ip.)

### 2.9 Premium badge across surfaces (Attendee D)

For each surface, verify `PremiumBadge` renders on Attendee D's avatar/car. **No badge** on Attendee B/E (non-premium).

- [ ] **2.9.1** Own `/garage` GarageListView → badge on every car card. (PR #366 regression class.)
- [ ] **2.9.2** Feed: D posts a car-tagged post → other user's feed shows D's post with badge.
- [ ] **2.9.3** Event confirmed-cars list (after D buys a ticket for an event) → D's car carries badge.
- [ ] **2.9.4** Ticket payload — pull up D's ticket QR screen → ticket detail shows badge on car. (`isPremiumActive` on `ticket.car`.)
- [ ] **2.9.5** Check-in scanner (admin) scans D's ticket → confirm screen shows badge on attendee's car. (`ticket.car.user.garage` includes premium fields per PR #365 reviewer pushback.)
- [ ] **2.9.6** Moderation feed (admin) → posts authored by D carry badge.

### 2.10 Premium expiry edge

- [ ] **2.10.1** Admin sets D's `premiumUntil` to `now() - 1d` (keep `premiumTier='gold'`).
- [ ] **2.10.2** Reload all surfaces from 2.9 → badge **gone** on every surface (no persistence). (`isPremiumActive` is computed.)
- [ ] **2.10.3** Restore `premiumUntil` to a future date → badge returns.

### 2.11 Post-signin deep-link

- [ ] **2.11.1** Sign out → open universal link `jdm://garage` → after signin, lands on `/garage` (not home, not last-viewed). (TASK-D acceptance.)

---

## 3. Admin organizer flows

Run in the admin web app on desktop browser.

### 3.1 General Settings (TASK-F)

- [ ] **3.1.1** Navigate to General Settings → `Vagas grátis padrão` field visible with current numeric value or "Ilimitado" toggle on.
- [ ] **3.1.2** Toggle "Ilimitado" ON → save → reload → toggle stays ON. **Verify** `defaultFreeGarageSpots` is `null` in DB (curl admin general-settings GET).
- [ ] **3.1.3** Toggle OFF + set numeric to `0` → blank guard or `0` rejected? (Verify behavior matches spec: `0` is valid per pivot. **[VERIFY: spec ambiguous on whether `0` is admin-rejected — round-2 catch only mentions "blank input guard"]**.)
- [ ] **3.1.4** Set numeric to `2,147,483,648` → server rejects (Int4 cap). (PR #360 round-2.)
- [ ] **3.1.5** Save same value as current → no AdminAudit row added. (No-op skip per PR #360 round-2.)
- [ ] **3.1.6** Change from `5` to `3` → downgrade warning modal shown. Confirm → save → AdminAudit row added with `general_settings.update` action (or whichever action TASK-F emits).
- [ ] **3.1.7** Capacity-change audit: per-field detection — saving a non-capacity field with capacity unchanged → no capacity audit. (PR #360.)

### 3.2 User-detail Garage panel (TASK-G)

- [ ] **3.2.1** Open admin user detail for Attendee D → Garagem panel shows name, slug, isPublic, premiumTier, premiumUntil, spot list (no tier column).
- [ ] **3.2.2** Override slug to `admin` (reserved word in user-facing patch) → admin path bypasses regex BUT still rejects reserved? **[VERIFY: spec §6.3 says "override slug (bypasses regex but reserved-list + unique still enforced)" — confirm behavior.]**
- [ ] **3.2.3** Override slug to one already taken → 409 (unique still enforced; PR #362 retry).
- [ ] **3.2.4** Override slug + force `isPublic=false` (anti-impersonation) → succeeds → AdminAudit row with `garage.slug_override`.
- [ ] **3.2.5** Grant premium: set `premiumTier='silver'` + `premiumUntil = now+30d` → save → AdminAudit `garage.premium_grant`.
- [ ] **3.2.6** Submit mixed-state premium payload: `premiumTier: null` + `premiumUntil: <future>` → 400 rejected. (PR #362 round-2.)
- [ ] **3.2.7** Revoke premium: clear both → AdminAudit `garage.premium_revoke`. User's `/me/garage` immediately reports `isPremiumActive: false`.
- [ ] **3.2.8** Grant individual spot (admin_grant source) → spot appears in user's `/me/garage`.
- [ ] **3.2.9** Try to revoke a spot that has a car → 409. (In-tx filled-spot guard per PR #362 round-2.)
- [ ] **3.2.10** Revoke an empty admin_grant spot → succeeds. Spot count decreases.

### 3.3 Virtual product editor (TASK-H)

- [ ] **3.3.1** Open admin product list → find `garage-spot` singleton.
- [ ] **3.3.2** Edit page renders: status select is **hidden**; productTypeId is locked/read-only. (PR #361.)
- [ ] **3.3.3** Submit a PATCH attempting to change `status` → 400 server-side. (PR #361.)
- [ ] **3.3.4** Submit a PATCH attempting to change `productTypeId` → 400 server-side. (PR #361 round-2.)
- [ ] **3.3.5** Edit title, description, basePriceCents → saves cleanly.
- [ ] **3.3.6** Create a NEW non-singleton virtual product → status select IS shown, productTypeId is editable. (Split fixture test boundary.)

### 3.4 Store admin / fulfillment queue

- [ ] **3.4.1** Activate a virtual product without uploading photos and without choosing a fulfillment method → succeeds. (Carve-out per PR #364.)
- [ ] **3.4.2** Place a test order containing 1× ticket + 1× garage-spot (mixed) → admin store fulfillment queue does NOT list this order. (PR #364 round-2.)
- [ ] **3.4.3** Place a test order with garage-spot + physical product → primary-shipping selection ignores the virtual line; ships only the physical. (PR #364 round-2.)

### 3.5 Moderation, feed, scanner (TASK-E surfaces)

- [ ] **3.5.1** Moderation queue lists posts authored by premium user D → badge visible. (Covered in 2.9.6; admin-side confirmation.)
- [ ] **3.5.2** Check-in scanner UI for premium D → badge visible on the scan-success screen. (Covered in 2.9.5; admin-side confirmation.)

---

## 4. API edge cases

Use curl or admin tooling. These protect invariants that the UI doesn't expose.

- [ ] **4.1** `GET /me/garage` for premium user D:
  - `garage.isPremiumActive === true`
  - **Every** `cars[].isPremiumActive === true` (regression PR #366 — `user.garage` include on car serializer).
- [ ] **4.2** `POST /orders/cart` with `{ productId: '<garage-spot>', quantity: 2 }` → 400. (PR #364 round-2.)
- [ ] **4.3** `POST /me/cars` as Attendee E (cap full) → 409 with `code: 'GARAGE_FULL'`.
- [ ] **4.4** Concurrent allocator stress: fire two `POST /me/cars` from same user in <50ms with free spots available → both succeed.
  - With 0 free spots available + 2 concurrent requests → one 201, one 409 `GARAGE_FULL`.
  - 409 `SERIALIZATION_CONFLICT` is rare to reproduce manually — **note in log:** "monitor Sentry for `SERIALIZATION_CONFLICT` post-launch; should be near-zero." (Per PR #359 round-3.)
- [ ] **4.5** DSR export (`GET /me/dsr/export` or admin-triggered) → response payload includes `garage: { name, slug, description, isPublic, premiumTier, premiumUntil, createdAt, updatedAt }`. Excludes `id`, `userId`. (Spec §4.3.)
- [ ] **4.6** DSR delete / account anonymization:
  - Create throwaway user with slug `vanity-xyz`.
  - Trigger anonymize.
  - DB row: `garage.name === 'Garagem'`, `garage.slug === 'deleted-<id8>'`, `description = null`, `isPublic = false`, `premiumTier = null`, `premiumUntil = null`. Slug `vanity-xyz` is now free for re-use.
- [ ] **4.7** `GET /g/<knownPrivateSlug>` vs `GET /g/<unknownSlug>` → identical status (404) and identical body. Diff with `diff <(curl ...) <(curl ...)` → empty diff.

---

## 5. Webhook + settlement

Use Stripe CLI (`stripe trigger`) and AbacatePay test dashboard.

- [ ] **5.1** Stripe webhook with bad signature header → endpoint returns 400 → order stays `pending`. (Locked invariant: webhooks signature-verified.)
- [ ] **5.2** AbacatePay webhook with bad signature → same: 400, order pending.
- [ ] **5.3** Successful Stripe webhook for garage-spot order → `fulfillGarageSpotsForOrder` runs once → `GarageSpot` created with `source='purchase'`, `sourceOrderItemId` set. (TASK-C.)
- [ ] **5.4** **Idempotency:** replay the same Stripe webhook event ID → second invocation does NOT create a duplicate spot. Verify by count = 1 with that `sourceOrderItemId`. (`sourceOrderItemId @unique` + `P2002` swallow per TASK-C.)
- [ ] **5.5** Successful AbacatePay webhook for garage-spot Pix → spot materializes within 60s.
- [ ] **5.6** Verify settlement updates `order.fulfillmentStatus` to `virtual_complete` on a pure-virtual order. (Schema enum value added in TASK-A.)
- [ ] **5.7** Mixed ticket+virtual order webhook → ticket + spot both fulfilled; admin queue exclusion confirmed in 3.4.2 still holds.

---

## UX Audit

Audit how the feature **feels**, not whether it works. Functional correctness is covered above. Here we look for empty-state silence, error opacity, missing affordances, friction loops, copy drift, and a11y gaps. Every item is "what to look for", not "does it render".

Use a real device. Run with VoiceOver/TalkBack on for at least one pass. Run in both light and dark mode. Run in PT-BR (primary). Record findings in subsection J even when they don't map cleanly to A-I.

### A. Empty states

- [ ] **A.1** Fresh signup garage with N free spots: do the empty `AddCarPlaceholderCard`s explain what they are, or are they 4 identical dotted boxes with the same title? (Currently all read `Adicionar Carro / Use uma das suas vagas grátis`.) Does the screen need a one-line intro ("Bem-vindo à sua Garagem" or similar) so the user understands the construct before scrolling slot cards?
- [ ] **A.2** Unlimited garage with 0 cars: `buildGarageSlots` returns a single `add-card` slot. Is one dashed card discoverable enough, or does the screen read as "empty / something is broken"? Does it explain that there is no limit?
- [ ] **A.3** Free-cap user at cap, 0 purchased spots: only the `BuySpotCard` is rendered after the filled cards. Is the buy-spot CTA visually distinct from the slot cards above it (price + "Comprar" label vs the generic placeholder)? Or does it blend into a wall of dashed boxes?
- [ ] **A.4** Admin user-detail Garagem panel for a user whose garage has 0 spots (pre-reconcile edge or just-revoked): does the `Vagas` table render the explicit `Nenhuma vaga.` row, or skeleton/blank? (Source: `user-garage-panel.tsx` has explicit empty row — verify it appears, not a broken table head.)
- [ ] **A.5** Public profile `/g/:slug` rendered via browser when garage is empty + `isPublic=true`: today this is an API JSON response (no HTML page in the app). Does the response feel "complete" or does `cars: []` + no preview UI feel half-built? (Mark as MAJOR friction in J if there is no rendered HTML profile.)
- [ ] **A.6** Owner `/garage` with `isPublic=true` and 0 cars: the in-app `publicPreviewEmpty` copy reads `Adicione carros para preencher sua página pública.` — does that read as encouragement or as "your page is empty so nothing is shareable"?
- [ ] **A.7** Premium-revoked user's garage: does anything explain why the gold badge disappeared, or is the change silent?

### B. Error + edge messaging

- [ ] **B.1** Trigger `GARAGE_FULL` from the UI (Attendee E adds car): does the toast/banner explain _why_ (cap reached) and _what to do_ (buy spot / contact admin), or does it surface a generic "Não foi possível"? Walk the actual UI codepath, not the API response.
- [ ] **B.2** Force a `SERIALIZATION_CONFLICT` via two concurrent `POST /me/cars` (Bash `&`): does the UI show anything when the 409 returns, or does the request silently hang/retry? (No retry on client today — verify behavior.)
- [ ] **B.3** Inline slug edit → save with a taken slug: error is set on `field: 'slug'` (correct). But trigger a slug regex violation (e.g., paste `caio jdm`): `GarageHeader.validatePatch` returns `invalid_slug`, then sets the same `slugTaken` copy → wrong message. Verify and flag.
- [ ] **B.4** Inline slug edit with reserved word (`admin`): `reservedSlug` copy is correct (`Esta URL não está disponível.`). Verify it reads helpfully (no mention of "reserved" — is that intentional?).
- [ ] **B.5** Pix payment failure for virtual spot via AbacatePay sandbox: does the cart preserve state for retry, or does the user return to a cleared cart with no way to redo the purchase?
- [ ] **B.6** Mixed cart (1× event ticket + 1× garage-spot): does checkout explain split fulfillment (one ships/issues; one materializes async via webhook)? Or does the success screen lie about "all complete" while the spot is still pending?
- [ ] **B.7** Premium expires mid-session (admin sets `premiumUntil` to past while user is on `/garage`): badge disappears on next `useFocusEffect` refresh. Does anything signal _why_ to the owner? Probable answer: no — log under J.
- [ ] **B.8** Admin `EditUserGarageModal` slug override with a taken slug: 409 surfaces via `setError(res.error)` as a generic banner. Is the error inline-attached to the slug field or a wall-of-text banner?

### C. Loading + optimistic states

- [ ] **C.1** Inline garage edits (name/slug/description): on save, button shows `Salvando…`. On failure, fields revert via `reset()` — does the revert animate or snap abruptly? Does the user know which field caused the error?
- [ ] **C.2** `isPublic` toggle (`handleToggleVisibility`): the Switch flips optimistically before the network call. If the PATCH fails, code reverts to `garage.isPublic` and shows `saveFailed` toast. Does the revert feel jarring? Is the user told _what_ failed (visibility toggle vs name save vs anything else)?
- [ ] **C.3** Add-car flow (`/garage/new`): no client-side spinner on the save button during the allocator round-trip. Does the form freeze for 200-500ms? Add an `ActivityIndicator` if so.
- [ ] **C.4** Virtual checkout via Pix: the QR can take 20-60s to settle. Does the order-success page show a "Aguardando pagamento Pix" state, or a generic "Pedido criado" that looks like the job is done? Check whether `/me/garage` refresh after settlement highlights the new spot.
- [ ] **C.5** Admin spot grant/revoke: `revoke-garage-spot-button.tsx` and `grant-garage-spot-button.tsx` — verify whether the row toggle is optimistic or whether the entire panel hard-reloads (via `router.refresh()`). Hard reload may feel like a page-blink.
- [ ] **C.6** `/me/garage` GET that triggers reconcile (cap was just changed admin-side): is there perceptible jank (extra spots appearing, list reordering) on the user's next focus? `useFocusEffect` fires on every screen focus — the list will visibly re-render.
- [ ] **C.7** `BuySpotCard` has an internal `submitting` latch that disables the card during the cart-add round-trip — verify visual: the card goes to `opacity: 0.4`. Is that obvious enough that the user knows their tap was registered?

### D. Navigation + flow continuity

- [ ] **D.1** Post-signin redirect to `/garage`: deep-link target preserved if signin was interrupted? (TASK-D wires this; verify with a `jdm://garage/<id>` link launched while signed-out.)
- [ ] **D.2** `BuySpotCard` tap → `/cart` push (per `garage/index.tsx` `handleBuySpot`). Cart should be pre-loaded with the spot via `addGarageSpotToCart`. Verify: the cart line is visible immediately, not after a manual reload.
- [ ] **D.3** After successful virtual purchase + webhook settlement: where does the user end up? Generic order-success page? Does anything route them back to `/garage` with the new spot highlighted, or do they have to navigate manually? (Likely the latter — flag in J.)
- [ ] **D.4** Public profile share button (`handleShare` in `GarageHeader`): calls native `Share.share({ message: '/g/${slug}' })`. The message is a path-only string — no domain, no `https://`. On iOS this gets copied as plain text; on a phone with no email/SMS client set, the share sheet may show "Nothing to share with". Verify on real device.
- [ ] **D.5** Admin user-detail → Garagem panel: scroll position and any user-list filter state preserved when navigating back? (`Link href="/users"` is a hard nav; filters in `search-form.tsx` likely reset.)
- [ ] **D.6** `/profile/garage/*` is a duplicate route shell of `/garage/*`. Does navigation between profile tab and bottom-tab garage feel like the same screen, or do they diverge in layout/state? Currently both mount `GarageListView` — verify.

### E. Affordance + discoverability

- [ ] **E.1** `GarageHeader` summary row: the only edit affordance is `accessibilityLabel="Toque para editar"`. Visually there is no pencil, no chevron, no hover state. A first-time user has no visual signal that the name/slug/description are editable. **MAJOR candidate for J.**
- [ ] **E.2** `Tornar pública` Switch: PT-BR label is clear ("Tornar pública") but the hint (`visibilityPublicHint: 'Sua garagem fica visível em /g/<slug>.'`) is technical. Does a non-tech user understand the privacy implications (LGPD-relevant)? Compare with "Qualquer pessoa pode ver sua garagem nesta URL".
- [ ] **E.3** Slug field on edit: `editSlug: 'URL pública (/g/)'`. No example placeholder, no format hint, no list of reserved words. User has to fail-save to learn the constraints.
- [ ] **E.4** PremiumBadge (mobile `@jdm/ui`): tap target is the `Badge` `<View>` with no `onPress`. Tapping does nothing. Does this make the badge feel dead/decorative? Should it open a "What is Premium?" sheet?
- [ ] **E.5** Admin `EditUserGarageModal` slug input: helper text reads `Slug (admin override — qualquer caractere)`. Does it warn that the override bypasses regex _but reserved-word + uniqueness still apply_? Currently no — the admin discovers via the 400/409 response.
- [ ] **E.6** Admin general-settings `Ilimitado` toggle: copy reads `Marque "Ilimitado" para desativar o limite.` No warning about cost/abuse implications of unlimited garages. Should it?
- [ ] **E.7** `FillSpotCard` (extra-spot empty placeholder) vs `AddCarPlaceholderCard` (free empty): both render via `GarageSpotPlaceholderCard` with identical dashed-border styling. Only the subtitle differs. Does the user see _which_ spots are free vs extra at a glance? Probably not — flag in J.
- [ ] **E.8** Car edit screen (`/garage/[id]`) "Delete" button: red destructive styling? Currently rendered as a plain `<Button>` with no destructive variant — verify.

### F. Cross-surface consistency

- [ ] **F.1** PremiumBadge style:
  - Mobile `@jdm/ui` PremiumBadge → `Badge tone="brand"` → `bg-brand` + `text-fg-inverse`, uppercase tracking-widest, height 6/7.
  - Admin `premium-badge.tsx` → `bg-amber-500` + `text-amber-950`, uppercase tracking-widest, `text-[10px]`.
  - **These are different colors.** Verify on screen side-by-side — does the brand color match the amber? Flag inconsistency in J if not.
- [ ] **F.2** Garage name + slug rendering: owner `/garage` (`GarageHeader`), public `/g/:slug` (API JSON), admin `user-garage-panel.tsx`, feed author chip. Consistent font weight, casing, slug-prefix display (`/g/<slug>` vs `<slug>` vs `slug`)?
- [ ] **F.3** Date formatting for `premiumUntil`: admin uses `new Date(iso).toLocaleDateString('pt-BR')`. Owner-facing UI does not currently display `premiumUntil` (computed `isPremiumActive` only — by design). Verify no surface leaks raw ISO timestamps.
- [ ] **F.4** Currency formatting on `BuySpotCard` price via `formatBRL(displayPriceCents)`: matches store-product price formatting (BRL, R$, comma decimal)? Pull a physical product price next to it visually.

### G. Accessibility

- [ ] **G.1** Color-only signals:
  - PremiumBadge: brand-gold color + uppercase "PREMIUM" label — label-bearing, not color-only. Pass.
  - Admin `Pública` vs `Privada` chip: green-vs-grey background + text label. Pass.
  - Free-vs-extra empty slot: identical visual treatment — color is NOT the signal but the subtitle copy is the only differentiator. Borderline; flag if a colorblind user can't tell free from extra.
- [ ] **G.2** Touch-target sizes:
  - `GarageSpotPlaceholderCard` minHeight 88 → exceeds 44pt. Pass.
  - `GarageHeader` summary row `Pressable` → tap surface is the whole title block. Pass.
  - `BuySpotCard` → uses placeholder card. Pass.
  - `handleShare` `Pressable` → padding md ~12pt + text. Borderline; measure on device.
- [ ] **G.3** Screen-reader labels:
  - `isPublic` Switch → `accessibilityLabel={garageCopy.garage.visibilityPublicLabel}` = "Tornar pública". Does VoiceOver announce the current state correctly? Verify.
  - Slug input → no `accessibilityLabel` override; uses TextField default. Verify VoiceOver reads "URL pública (/g/)" not "TextInput".
  - PremiumBadge → no `accessibilityLabel` or `accessibilityRole`. VoiceOver reads the visible text "PREMIUM" only. Add role + hint if missing.
- [ ] **G.4** Focus order on admin `EditUserGarageModal`: tab order should flow Name → Slug → Description → isPublic → Cancel → Salvar. Verify keyboard-only navigation. `autoFocus` is on the name input — good start.
- [ ] **G.5** Color contrast:
  - PremiumBadge mobile (`bg-brand` + `text-fg-inverse`) against a feed card with `theme.colors.border` background — measure contrast in light and dark.
  - PremiumBadge admin (`bg-amber-500` + `text-amber-950`) against `var(--color-border)` background — measure.
  - Muted text (`theme.colors.muted`) used heavily for hints, subtitles, slug display — verify ≥4.5:1 contrast against `theme.colors.bg`.

### H. PT-BR copy + tone

- [ ] **H.1** "Garagem" — primary copy. Verify no surfaces leak "Garage" / "My Cars" / "Meus Carros" in PT-BR mode. Grep `garageCopy.garage.listTitle = 'Garagem'`, but check tab labels, push notification copy, email subjects.
- [ ] **H.2** Error codes localized: confirm no raw English strings leak through. Suspects: `SERIALIZATION_CONFLICT`, `GARAGE_FULL`, `slug_taken`, `reserved_slug`, `nickname_taken`, `invalid_slug`. The mobile `GarageHeader` maps these to PT-BR copy — verify exhaustive coverage by hitting each path.
- [ ] **H.3** Terminology consistency:
  - "Premium" — used in `@jdm/ui` badge label ("PREMIUM"), admin `Premium {tierLabel}`, copy in admin panel. Consistent.
  - "Vaga" / "vagas" — used in `Comprar Vaga Adicional`, `Vaga extra disponível`, `Vagas grátis por usuário`, `Vagas` panel header. Consistent.
  - "Ilimitado" — admin general-settings label. Verify no "Sem limite" / "Infinito" mix.
- [ ] **H.4** Tone: imperative ("Adicione seu primeiro carro", "Comprar Vaga Adicional") vs friendly ("Conte sobre sua garagem"). Match the rest of the app's tone? Check the brand-voice doc if one exists.
- [ ] **H.5** Microcopy on dangerous actions: admin `RevokeGaragePremiumButton`, `RevokeGarageSpotButton`, mobile `Delete car` — do they confirm in PT-BR with consequence-stating copy ("Esta ação não pode ser desfeita")?

### I. Performance perception

- [ ] **I.1** `/garage` first paint with ~10 cars + photos: feel snappy? Note time-to-interactive. `useFocusEffect` re-fetches on every focus — verify no flash-of-empty-state.
- [ ] **I.2** Public profile API response time vs owner page: `/g/:slug` vs `/me/garage`. Same DB query shape; should be comparable.
- [ ] **I.3** Admin user-detail garage tab with reconcile-on-read (`getAdminUserGarage`): noticeable delay when the cap was just changed and reconcile runs on this user? Time it.
- [ ] **I.4** Photo loading on `GarageListView`: thumbs render via `<Image source={{ uri }} />`. No explicit prefetch, no placeholder shimmer. Verify whether thumbs pop in one-by-one creating layout shift.

### J. Friction + improvement opportunities

Free-form. Record any flow that _works_ but feels one-step-too-many, buried, missing-affordance, or inconsistent. Format each as:

> **Observation:** what you saw.
> **Friction:** why it matters.
> **Suggested fix:** concrete change (component, copy, route).
> **Severity:** `NIT` / `MINOR` / `MAJOR` / `BLOCKING-LAUNCH`

Seed examples (verify on device, then keep or strike):

- **Observation:** Inline edit affordances on `GarageHeader` are visually invisible — no pencil, no underline, no hover. Only `accessibilityLabel` hints at editability.
  **Friction:** New users won't discover that name/slug/description are editable. Sharing-first users will share an unedited "Garagem" / "user-abc12345" link and reflect badly on the product.
  **Suggested fix:** add a small pencil icon to the summary row + a hairline border or `Editar` text-link. File: `apps/mobile/src/screens/garage/GarageHeader.tsx` lines 199-212.
  **Severity:** MAJOR.

- **Observation:** Buy-spot flow is `tap → cart → checkout → external payment → manual nav back to garage → reload to see spot`. No deep-link return; no highlight on the new spot.
  **Friction:** 5+ steps for a 1-click intent ("I want another spot"). User loses momentum + may not realize the purchase succeeded.
  **Suggested fix:** post-settlement deep-link back to `/garage?highlight=<spotId>` with a 2s pulse animation on the new card.
  **Severity:** MAJOR.

- **Observation:** Free vs extra empty slot cards (`AddCarPlaceholderCard` vs `FillSpotCard`) share dashed-border styling, identical title `Adicionar Carro`, differ only by subtitle.
  **Friction:** Owner has no glanceable way to see which spots are "their free allowance" vs "extras they paid for / were granted". May cause confusion if cap shrinks and spots flip status.
  **Suggested fix:** subtle background tint on extra cards, or a tag chip ("Extra") in the corner. File: `apps/mobile/src/screens/garage/FillSpotCard.tsx` + copy in `~/copy/garage.ts`.
  **Severity:** MINOR.

- **Observation:** Mobile PremiumBadge (`bg-brand`) and admin PremiumBadge (`bg-amber-500`) are visually different colors despite the admin code comment claiming "Mirrors the mobile @jdm/ui PremiumBadge visual contract".
  **Friction:** Cross-surface inconsistency; the admin twin lies about parity. May drift further over time.
  **Suggested fix:** either align admin to use the shared brand color via `var(--color-brand)`, or extract the badge into a shared design token. File: `apps/admin/src/components/premium-badge.tsx`.
  **Severity:** MINOR.

- **Observation:** `handleShare` shares the message `/g/${slug}` — a path-only string with no domain.
  **Friction:** Recipient cannot open the link by tapping; they have to know to prepend the API host. Defeats the purpose of a share button.
  **Suggested fix:** prefix with the public domain (`https://<host>/g/${slug}`). File: `apps/mobile/src/screens/garage/GarageHeader.tsx` line 153.
  **Severity:** MAJOR.

- **Observation:** Slug-regex violation surfaces as the `slugTaken` error copy.
  **Friction:** User sees "Esta URL já está em uso" when they actually typed invalid characters — they will keep trying new vanity slugs and stay confused.
  **Suggested fix:** distinguish `invalid_slug` from `slug_taken` in `validatePatch` error mapping. File: `apps/mobile/src/screens/garage/GarageHeader.tsx` lines 78-98 + add `invalidSlug` copy entry to `~/copy/garage.ts`.
  **Severity:** MAJOR.

- **Observation:** Empty-state copy `firstCarCta: 'Adicione seu primeiro carro'` renders as muted gray text inside `ListEmptyComponent`, not as a button.
  **Friction:** A wall-of-empty + plain-text CTA reads as "nothing here yet" rather than "tap here to start". First-impression hit immediately post-signup.
  **Suggested fix:** promote to an explicit `<Button>` with primary styling, or render a single oversized dashed `AddCarPlaceholderCard` with a "Bem-vindo" headline. File: `apps/mobile/app/(app)/garage/index.tsx` lines 82-86.
  **Severity:** MAJOR.

- **Observation:** PremiumBadge has no `onPress` or explanatory affordance.
  **Friction:** Premium owners may not realize what the badge means / what they get. Non-premium owners see other users' badges and have no in-app path to learn how to become premium.
  **Suggested fix:** wrap the badge in a `Pressable` that opens a sheet ("O que é Premium?") with current benefits + (deferred) purchase link. File: `packages/ui/src/PremiumBadge.tsx`.
  **Severity:** MINOR (BLOCKING-LAUNCH if premium upsell is a launch-window goal).

- **Observation:** Public profile `/g/:slug` returns JSON only — there is no rendered HTML page for non-app visitors.
  **Friction:** Owner shares the link with a friend who doesn't have the app; friend taps; gets raw JSON. Looks broken. Defeats the "public profile" feature.
  **Suggested fix:** render an SSR HTML page at `/g/:slug` (admin app or a dedicated marketing surface) with the same allowlist payload. Spec-deferred? Confirm with product. File: `apps/api/src/routes/garage.ts`.
  **Severity:** MAJOR if launch-facing; BLOCKING-LAUNCH if the marketing plan relies on shareable links.

---

### UX Audit sign-off

| Field                    | Value                             |
| ------------------------ | --------------------------------- |
| Tester name              |                                   |
| Device + OS              | e.g. iPhone 15 Pro / iOS 18.1     |
| Screen size              | e.g. 6.1" 1179×2556               |
| Color mode               | Light / Dark / Both               |
| Locale                   | pt-BR / en (circle)               |
| Reader mode              | VoiceOver / TalkBack / Off        |
| Build / commit           |                                   |
| Date                     |                                   |
| Section J findings count | (sum of NIT/MINOR/MAJOR/BLOCKING) |

---

## Screenshot Capture

Produces a visual archive of every unique screen + behavioral state of the garage-spots feature, organised so a future **designer agent** can pick it up and propose redesigns without rediscovering the surface area.

This section is **doc-driven**. The tester (human or chrome-devtools / playwriter agent) executes the captures; the plan supplies layout, naming, coverage, and tooling.

> **Why exhaustive?** The garage pivot touches owner, public, admin, fulfillment, moderation, and check-in surfaces. PR #366 proved that a silent serializer drift can nuke an entire visual state class (premium badge gone everywhere) without a single test failing. The archive doubles as a regression baseline.

### 1. Storage structure

Tester creates a folder under the repo at `.handoffs/garage-spots-screenshots/` (do **NOT** pre-create it — leave it for the capture session so the timestamp + index reflects a single run). Layout:

```
.handoffs/garage-spots-screenshots/
  README.md                              # index + capture metadata (see §4)
  mobile/
    01-onboarding/
      01-fresh-signup-empty-garage.png
      02-fresh-signup-empty-garage-light.png
      03-fresh-signup-empty-garage-dark.png
    02-garage-owner/
    03-garage-public-profile/
    04-cars/
    05-buy-spot-flow/
    06-checkout-virtual/
    07-feed-with-premium-badge/
    08-event-confirmed-cars/
    09-ticket-and-checkin/
    10-account-and-dsr/
  admin/
    01-general-settings/
    02-user-detail-garage-tab/
    03-spot-grant-revoke/
    04-premium-grant-revoke/
    05-slug-override/
    06-virtual-product-editor/
    07-store-orders-mixed/
    08-moderation-and-scanner/
  public-web/
    01-g-slug-public/
    02-g-slug-private-404/
    03-g-slug-unknown-404/
  states/                                # cross-cutting state variants
    loading/
    error/
    empty/
    optimistic-revert/
  redesigns/                             # designer agent writes here (empty at capture time)
```

**Filename convention (mandatory):**

`NN-short-kebab-description[-variant].png`

- `NN` = 2-digit sequence within folder (`01`, `02`, …). Resets per folder.
- `short-kebab-description` = lowercase, hyphen-separated, no spaces, no underscores.
- `variant` = one of `dark` / `light` / `pt-BR` / `en` / `small` / `large` / `free-cap` / `unlimited` / `at-cap` / `premium` / `expired` / `voiceover` / `ios` / `android`. Combine with hyphens: `01-owner-empty-dark-pt-BR.png`.
- Default mode is `pt-BR` + light; only annotate `-en` or `-dark` when the variant exists alongside the default.

**Coverage rule.** Every shot listed below must exist on disk before the tester ticks the box. Missing shots are recorded in README "what was NOT captured" with a one-line reason.

### 2. Capture checklist

Per-shot fields:

- **Shot ID** — folder + filename, exactly as on disk.
- **State setup** — persona + data + env to put the app into that state. References §1 personas (Attendee A-E).
- **Screen** — route or component + source file path.
- **Capture instruction** — full-screen vs viewport, scroll-to-top, hide system bars, dark + light required.
- **Why it matters for redesign** — one short sentence the designer agent will read.

`[quick-smoke]` tags the 15-shot subset the tester runs first (Q11 in Quick Smoke). Variants are nested sub-items so they don't bloat the count.

---

#### mobile/01-onboarding/

- [ ] **`01-fresh-signup-empty-garage.png`** `[quick-smoke]`
  - Setup: Attendee A (fresh signup, 0 cars, `defaultFreeGarageSpots = 2`).
  - Screen: `/garage`, file `apps/mobile/app/(app)/garage/index.tsx`.
  - Capture: full-screen, scroll to top, system bars visible.
  - Why: first-impression empty state — the screen the user sees immediately after signup. Designer needs to reimagine "what does this place mean?".
  - [ ] `02-fresh-signup-empty-garage-dark.png` — dark mode variant.
  - [ ] `03-fresh-signup-empty-garage-voiceover.png` — VoiceOver focus ring on first empty slot.
- [ ] **`04-post-signin-deep-link-landing.png`**
  - Setup: signed-out user, tap universal link `jdm://garage`, complete signin.
  - Screen: `/garage` (deep-link target preserved through signin).
  - Capture: full-screen, scroll to top.
  - Why: TASK-D acceptance — first visual after deep-link signin.

#### mobile/02-garage-owner/

- [ ] **`01-free-cap-empty.png`** `[quick-smoke]`
  - Setup: Attendee B (free-cap N=2, 0 cars).
  - Screen: `/garage` → `GarageListView`, file `apps/mobile/src/screens/garage/GarageListView.tsx`.
  - Capture: full-screen, scroll to top.
  - Why: bounded empty grid — designer baseline for "free allowance visible but nothing in it".
  - [ ] `01a-free-cap-empty-dark.png`
- [ ] **`02-free-cap-half-full.png`**
  - Setup: Attendee B, cars = 1 of 2.
  - Why: partial-fill — shows the dashed-empty mixed with a real card; designer needs to balance visual weight.
- [ ] **`03-free-cap-at-cap.png`** `[quick-smoke]`
  - Setup: Attendee E (cars = `defaultFreeGarageSpots`, 0 purchased).
  - Screen: `/garage` showing `BuySpotCard` as the trailing slot.
  - Capture: full-screen, scroll to top and bottom (two shots if needed).
  - Why: cap-reached state — designer needs to differentiate "buy more" CTA from filled-car cards.
  - [ ] `03a-free-cap-at-cap-dark.png`
- [ ] **`04-unlimited-empty.png`**
  - Setup: Attendee C in window where `defaultFreeGarageSpots = NULL`, 0 cars.
  - Screen: `/garage` showing single `AddCarPlaceholderCard` add-slot.
  - Why: edge state — one dashed card on an otherwise empty screen reads as "broken" today. PR #363 round-2 catch.
- [ ] **`05-unlimited-with-cars.png`**
  - Setup: Attendee C, 3 cars, cap NULL.
  - Why: shows the always-visible add-card next to real cars; designer evaluates whether the add affordance is discoverable mid-list.
- [ ] **`06-mixed-free-and-purchased.png`** `[quick-smoke]`
  - Setup: Attendee E (cap reached) + 1 purchased spot reconciled via webhook; spot empty (`Preencher Vaga`).
  - Screen: `/garage` — must show free `AddCarPlaceholderCard` _and_ `FillSpotCard` side by side.
  - Why: source-aware copy + visual ambiguity (both cards look identical except subtitle). Top-3 designer friction.
  - [ ] `06a-mixed-free-and-purchased-dark.png`
- [ ] **`07-premium-owner.png`** `[quick-smoke]`
  - Setup: Attendee D (premium, gold, at least 1 car).
  - Screen: `/garage` — `GarageHeader` PremiumBadge + per-car PremiumBadge.
  - Capture: full-screen, scroll so header + first car are visible together.
  - Why: PR #365 + #366 regression baseline. Every premium surface anchors here.
  - [ ] `07a-premium-owner-dark.png`
  - [ ] `07b-premium-owner-en.png` (locale variant — badge label "PREMIUM" should not change).
- [ ] **`08-premium-expired.png`**
  - Setup: Attendee D after admin sets `premiumUntil` to past.
  - Screen: same as 07 — verify badge gone everywhere.
  - Why: silent-disappearance audit (UX-Audit B.7).
- [ ] **`09-inline-edit-name.png`**
  - Setup: Attendee B owner, tap garage name in `GarageHeader`, edit field active with text selected.
  - Screen: `GarageHeader.tsx` summary row in edit mode.
  - Why: edit affordance is currently invisible — designer needs to see the entered-edit state to redesign discoverability (UX-Audit E.1).
- [ ] **`10-inline-edit-slug-error-regex.png`**
  - Setup: edit slug to `Caio JDM!` → tap save.
  - Why: shows wrong error copy ("Esta URL já está em uso") for a regex violation. Audit B.3 evidence.
- [ ] **`11-inline-edit-slug-taken.png`**
  - Setup: edit slug to a value already taken by another user → tap save.
  - Why: correct 409 collision message; pair with 10 to show error-mapping bug visually.
- [ ] **`12-public-toggle-on.png`**
  - Setup: Attendee D, `isPublic=true` just saved.
  - Screen: `GarageHeader` with share button + public preview block visible.
  - Why: success state for the privacy toggle (UX-Q3).
- [ ] **`13-public-toggle-off.png`**
  - Setup: same user, toggle OFF.
  - Why: pair with 12 to evaluate whether the disappearance is unmissable or silent.
- [ ] **`14-share-sheet-open.png`**
  - Setup: tap share button in `GarageHeader.handleShare` (Attendee D, public ON).
  - Screen: native iOS / Android share sheet over the garage screen.
  - Why: surfaces the "path-only string" bug (J seed observation — `/g/<slug>` without host).
- [ ] **`15-pull-to-refresh-loading.png`**
  - Setup: pull down on `/garage` to trigger `useFocusEffect` refresh.
  - Why: loading state baseline for the owner garage view.

#### mobile/03-garage-public-profile/

> NOTE: `/g/:slug` is currently a JSON-only API response. There is no rendered HTML/RN page. Captures are browser screenshots of the raw JSON to evidence the UX gap (UX-Audit A.5, J seed). When designer redesigns, this becomes a real page.

- [ ] **`01-public-json-response.png`**
  - Setup: Attendee D, `isPublic=true`, `slug=caio-d`, 2 cars.
  - Screen: `https://<api-host>/g/caio-d` opened in incognito Chrome.
  - Capture: full-page screenshot at viewport `1440x900`.
  - Why: evidence that "public profile" is not a profile — major designer brief item.
- [ ] **`02-public-empty-json.png`**
  - Setup: same as 01 but with 0 cars.
  - Why: empty-state of a half-built feature.
- [ ] **`03-public-premium-json.png`**
  - Setup: Attendee D (premium) public.
  - Why: confirms premium fields are in the payload but no visual rendering exists.
- [ ] **`04-deep-link-in-mobile-safari.png`**
  - Setup: tap `https://<api>/g/caio-d` link inside iOS Messages.
  - Why: shows the real recipient experience today (raw JSON in Safari) — supports "share button is broken" designer brief.

#### mobile/04-cars/

- [ ] **`01-car-create-form-empty.png`**
  - Setup: Attendee B taps first empty slot.
  - Screen: `apps/mobile/app/(app)/garage/new.tsx`.
  - Why: car form post-pivot — designer needs to confirm `description` field is gone.
- [ ] **`02-car-create-form-photo-upload.png`**
  - Setup: same flow, mid-photo-upload to R2.
  - Why: upload progress state.
- [ ] **`03-car-detail-edit.png`**
  - Setup: Attendee D, tap existing car card.
  - Screen: `apps/mobile/app/(app)/garage/[id].tsx`.
  - Why: edit screen w/ destructive delete button (UX-Audit E.8 — currently no destructive variant).
  - [ ] `03a-car-detail-edit-dark.png`
- [ ] **`04-car-delete-confirm.png`**
  - Setup: tap Delete in 03.
  - Why: dangerous-action confirm dialog copy review (UX-Audit H.5).
- [ ] **`05-profile-garage-tab.png`**
  - Setup: navigate via profile tab.
  - Screen: `apps/mobile/app/(app)/profile/garage/index.tsx`.
  - Why: duplicate route shell (UX-Audit D.6) — designer evaluates whether it should merge with bottom-tab garage.

#### mobile/05-buy-spot-flow/

- [ ] **`01-garage-full-toast.png`** `[quick-smoke]`
  - Setup: Attendee E forces an add-car request that hits `GARAGE_FULL`.
  - Screen: `/garage` with error toast/banner.
  - Why: error-messaging baseline (UX-Audit B.1).
- [ ] **`02-buy-spot-cta-pressed.png`**
  - Setup: tap `BuySpotCard` once (catch the `submitting` opacity 0.4 state).
  - Why: optimistic latch visibility (UX-Audit C.7).
- [ ] **`03-cart-with-virtual.png`**
  - Setup: post-tap, cart screen.
  - Screen: `apps/mobile/app/(app)/cart/index.tsx`.
  - Why: cart line preloaded via `addGarageSpotToCart`; designer evaluates virtual-line presentation.
- [ ] **`04-cart-mixed-ticket-and-virtual.png`**
  - Setup: cart with 1× ticket + 1× garage-spot.
  - Why: split-fulfillment visibility (UX-Audit B.6).
- [ ] **`05-checkout-stripe-card.png`**
  - Setup: proceed → Stripe Checkout test card screen.
  - Why: card flow baseline.
- [ ] **`06-checkout-pix-qr.png`**
  - Setup: proceed → AbacatePay Pix QR rendered.
  - Why: Pix waiting state — 20-60s window where UX-Audit C.4 lives.
- [ ] **`07-pix-waiting-for-payment.png`**
  - Setup: post-QR-render, before settlement webhook fires.
  - Why: "is anything happening?" baseline for the Pix wait.
- [ ] **`08-payment-success.png`**
  - Setup: post-settlement order-success screen.
  - Why: where the user lands (UX-Audit D.3 — no return-to-garage today).
- [ ] **`09-garage-after-purchase.png`** `[quick-smoke]`
  - Setup: manually navigate back to `/garage` after settlement; spot now visible as `Preencher Vaga`.
  - Why: closes the buy-spot loop; designer evaluates "spot just appeared, no highlight".

#### mobile/06-checkout-virtual/

(Reserved for additional checkout-flow detail. Promote shots from §5 here if the buy-spot folder bloats.)

- [ ] **`01-checkout-stripe-card-failure.png`**
  - Setup: Stripe test card `4000 0000 0000 0002`.
  - Why: payment-failure handling (UX-Audit B.5).
- [ ] **`02-cart-preserved-after-failure.png`**
  - Setup: post-failure return to cart.
  - Why: does the cart preserve state or clear (UX-Audit B.5).

#### mobile/07-feed-with-premium-badge/

- [ ] **`01-feed-with-premium-author.png`** `[quick-smoke]`
  - Setup: Attendee D posts a car-tagged feed entry; view from Attendee B's feed.
  - Screen: `apps/mobile/src/screens/events/feed/FeedPostCard.tsx`.
  - Why: PR #366 regression class — badge must render on feed cards.
  - [ ] `01a-feed-with-premium-author-dark.png`
- [ ] **`02-feed-without-premium-author.png`**
  - Setup: non-premium author post.
  - Why: control — badge absent.
- [ ] **`03-feed-comments-with-premium.png`**
  - Setup: premium user comments on a post.
  - Screen: `FeedComments.tsx`.
  - Why: nested-surface badge audit.
- [ ] **`04-car-picker-popover-premium.png`**
  - Setup: open car picker that lists premium + non-premium cars.
  - Screen: `CarPickerPopover.tsx`.
  - Why: cross-surface badge consistency (UX-Audit F.1).

#### mobile/08-event-confirmed-cars/

- [ ] **`01-confirmed-cars-list.png`**
  - Setup: event with Attendee D's ticketed car; view confirmed-cars list.
  - Why: badge surface (UX-Audit verifies isPremiumActive on this list).
- [ ] **`02-car-detail-sheet-premium.png`**
  - Setup: tap car in confirmed list.
  - Screen: `CarDetailSheet.tsx`.
  - Why: badge on detail sheet (size="md" variant).

#### mobile/09-ticket-and-checkin/

- [ ] **`01-ticket-qr-screen-premium.png`** `[quick-smoke]`
  - Setup: Attendee D's ticket detail.
  - Screen: `apps/mobile/app/(app)/tickets/[ticketId].tsx`.
  - Why: ticket payload includes `isPremiumActive` on `ticket.car` (recent commit `c41f692c`); badge visible.
- [ ] **`02-ticket-qr-screen-non-premium.png`**
  - Setup: Attendee B's ticket.
  - Why: control — no badge.
- [ ] **`03-cart-car-plate-picker-premium.png`**
  - Setup: ticket checkout, car-plate picker showing premium car.
  - Screen: `CarPlatePicker.tsx`.
  - Why: pre-purchase badge surface.

#### mobile/10-account-and-dsr/

- [ ] **`01-profile-index.png`**
  - Setup: Attendee D profile tab landing.
  - Screen: `apps/mobile/app/(app)/profile/index.tsx`.
  - Why: profile baseline (premium tier surface?).
- [ ] **`02-profile-edit.png`**
  - Setup: profile edit form.
  - Why: account-level edits separate from garage edits.
- [ ] **`03-orders-history.png`**
  - Setup: post-purchase orders list, virtual order visible.
  - Screen: `apps/mobile/app/(app)/profile/orders.tsx`.
  - Why: how virtual spot purchases appear in history.

---

#### admin/01-general-settings/

- [ ] **`01-general-settings-default.png`** `[quick-smoke]`
  - Setup: org with `defaultFreeGarageSpots = 5`.
  - Screen: `apps/admin/app/(authed)/configuracoes/general-settings-form.tsx`.
  - Capture: viewport `1440x900`, full-page.
  - Why: TASK-F admin surface baseline.
- [ ] **`02-ilimitado-toggle-on.png`**
  - Setup: toggle Ilimitado ON.
  - Why: NULL-cap visual state.
- [ ] **`03-downgrade-warning-modal.png`**
  - Setup: change cap `5 → 3`, trigger warning modal.
  - Why: capacity downgrade copy (PR #360 round-2).
- [ ] **`04-validation-error-int4-cap.png`**
  - Setup: enter `2147483648` and submit.
  - Why: server-side rejection visual.

#### admin/02-user-detail-garage-tab/

- [ ] **`01-garage-tab-default.png`** `[quick-smoke]`
  - Setup: admin opens user-detail for Attendee B.
  - Screen: `apps/admin/app/(authed)/users/[id]/page.tsx` rendering `user-garage-panel.tsx`.
  - Why: admin garage panel baseline.
- [ ] **`02-pre-reconcile-empty.png`**
  - Setup: brand-new user that hasn't been read yet (0 spots in DB pre-reconcile).
  - Why: explicit `Nenhuma vaga.` row (UX-Audit A.4).
- [ ] **`03-garage-tab-with-cars.png`**
  - Setup: Attendee D with 3 cars.
  - Why: full-data state.
- [ ] **`04-garage-tab-premium-active.png`** `[quick-smoke]`
  - Setup: Attendee D premium active.
  - Why: admin PremiumBadge surface (UX-Audit F.1 — admin amber vs mobile brand).
- [ ] **`05-garage-tab-premium-expired.png`**
  - Setup: Attendee D after `premiumUntil` set to past.
  - Why: expired state — admin sees no badge but `premiumUntil` still on record.
- [ ] **`06-mixed-source-spots.png`**
  - Setup: user with `free` + `purchase` + `admin_grant` spots.
  - Why: source column visibility in admin (no source-column in panel today — designer evaluates).

#### admin/03-spot-grant-revoke/

- [ ] **`01-grant-spot-button.png`**
  - Setup: hover/focus on grant button.
  - Screen: `grant-garage-spot-button.tsx`.
  - Why: affordance baseline.
- [ ] **`02-revoke-spot-confirm.png`**
  - Setup: click revoke on an empty spot.
  - Why: confirm-dialog copy (UX-Audit H.5).
- [ ] **`03-revoke-blocked-filled-spot.png`**
  - Setup: attempt revoke on a spot with a car attached → 409 error.
  - Why: in-tx filled-spot guard error surface (PR #362 round-2).

#### admin/04-premium-grant-revoke/

- [ ] **`01-grant-premium-form.png`**
  - Setup: open premium-grant form on Attendee B.
  - Why: tier + premiumUntil inputs.
- [ ] **`02-grant-premium-success.png`**
  - Setup: post-grant.
  - Why: badge appears on the panel.
- [ ] **`03-mixed-state-rejected.png`**
  - Setup: submit `premiumTier: null` + `premiumUntil: <future>` (admin override attempt).
  - Why: PR #362 round-2 rejection visual.
- [ ] **`04-revoke-premium-confirm.png`**
  - Setup: revoke button confirm.
  - Why: dangerous-action copy.

#### admin/05-slug-override/

- [ ] **`01-edit-modal-default.png`**
  - Setup: open `EditUserGarageModal` on Attendee D.
  - Why: form baseline w/ name + slug + description + isPublic.
- [ ] **`02-slug-override-helper-text.png`**
  - Setup: focus slug input, show helper `Slug (admin override — qualquer caractere)`.
  - Why: UX-Audit E.5 — helper doesn't warn about reserved/unique still applying.
- [ ] **`03-slug-override-taken-error.png`**
  - Setup: submit a taken slug.
  - Why: error rendered as wall-of-text banner (UX-Audit B.8).
- [ ] **`04-slug-override-force-private.png`**
  - Setup: admin slug override + `isPublic=false` (anti-impersonation).
  - Why: AdminAudit `garage.slug_override` flow.

#### admin/06-virtual-product-editor/

- [ ] **`01-garage-spot-singleton-edit.png`**
  - Setup: navigate to `garage-spot` product edit (TASK-H).
  - Screen: `apps/admin/app/(authed)/loja/produtos/[id]/product-form.tsx`.
  - Why: status select hidden, productTypeId locked.
- [ ] **`02-virtual-product-banner.png`**
  - Setup: same page, banner visible.
  - Screen: `virtual-product-banner.tsx`.
  - Why: banner copy review.
- [ ] **`03-non-singleton-virtual-product.png`**
  - Setup: create new non-singleton virtual product.
  - Why: control — status select IS shown.

#### admin/07-store-orders-mixed/

- [ ] **`01-fulfillment-queue-physical-only.png`**
  - Setup: order with 1× physical product.
  - Screen: admin store fulfillment queue.
  - Why: baseline.
- [ ] **`02-fulfillment-queue-excludes-virtual.png`**
  - Setup: mixed order (1× ticket + 1× garage-spot).
  - Why: must NOT appear in queue (PR #364 round-2).
- [ ] **`03-mixed-order-detail.png`**
  - Setup: open the mixed order detail page.
  - Why: shows split fulfillment status (`virtual_complete` for the spot line).

#### admin/08-moderation-and-scanner/

- [ ] **`01-moderation-feed-premium-author.png`**
  - Setup: moderation feed item authored by Attendee D.
  - Why: badge visible on admin moderation surface.
- [ ] **`02-scanner-confirm-premium-car.png`** `[quick-smoke]`
  - Setup: admin check-in scanner scans Attendee D's ticket.
  - Screen: `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx`.
  - Why: PR #365 reviewer pushback baseline — ticket.car.user.garage premium fields render here.
- [ ] **`03-scanner-confirm-non-premium-car.png`**
  - Setup: same scanner with Attendee B's ticket.
  - Why: control — no badge.
- [ ] **`04-community-management-premium.png`**
  - Setup: event community-management page with premium attendee in list.
  - Screen: `community-management.tsx`.
  - Why: another badge surface — cross-check consistency.

---

#### public-web/01-g-slug-public/

- [ ] **`01-public-slug-json-1440.png`** `[quick-smoke]`
  - Setup: incognito Chrome at `https://<api>/g/caio-d`, viewport `1440x900`.
  - Why: desktop view of "public profile".
- [ ] **`02-public-slug-json-768.png`** — tablet `768x1024`.
- [ ] **`03-public-slug-json-375.png`** — mobile-web `375x812`.

#### public-web/02-g-slug-private-404/

- [ ] **`01-private-slug-404.png`**
  - Setup: `GET /g/caio-d` while owner has `isPublic=false`.
  - Capture: full-page incognito Chrome at `1440x900`.
  - Why: 404 body — must be byte-identical to unknown-slug 404.

#### public-web/03-g-slug-unknown-404/

- [ ] **`01-unknown-slug-404.png`** `[quick-smoke]`
  - Setup: `GET /g/this-slug-does-not-exist`.
  - Capture: `1440x900` incognito.
  - Why: anti-enumeration baseline. Paired diff with private-404 evidences locked contract.

---

#### states/loading/

- [ ] **`mobile-garage-skeleton.png`** — `/garage` first paint with throttled network.
- [ ] **`mobile-cart-pending.png`** — `/cart` while `addGarageSpotToCart` round-trips.
- [ ] **`mobile-checkout-pix-waiting.png`** — Pix QR rendered, settlement pending.
- [ ] **`admin-reconcile-spinner.png`** — admin user-detail garage tab during reconcile-on-read.
- [ ] **`admin-grant-premium-saving.png`** — premium grant form mid-submit.

#### states/error/

- [ ] **`mobile-garage-full.png`** — `GARAGE_FULL` toast (paired w/ mobile/05-01).
- [ ] **`mobile-serialization-conflict.png`** — best-effort capture of 409 `SERIALIZATION_CONFLICT` (rare; if not reproducible, README annotate).
- [ ] **`mobile-payment-failed-stripe.png`** — Stripe rejected card.
- [ ] **`mobile-payment-failed-pix.png`** — AbacatePay sandbox simulated failure.
- [ ] **`mobile-slug-rate-limited.png`** — 11th slug edit in <60s → 429.
- [ ] **`mobile-photo-upload-failed.png`** — R2 PUT failure surface.
- [ ] **`admin-spot-revoke-blocked-filled.png`** — paired w/ admin/03-03.
- [ ] **`admin-premium-mixed-state-rejected.png`** — paired w/ admin/04-03.
- [ ] **`admin-slug-override-taken.png`** — paired w/ admin/05-03.
- [ ] **`public-web-rate-limited.png`** — 71st `/g/<slug>` request from same IP → 429.

#### states/empty/

- [ ] **`mobile-garage-bounded-empty.png`** — paired w/ mobile/02-01 (dedicated state archive).
- [ ] **`mobile-garage-unlimited-empty.png`** — paired w/ mobile/02-04.
- [ ] **`mobile-public-preview-empty.png`** — owner `isPublic=true` + 0 cars (UX-Audit A.6 copy).
- [ ] **`admin-garage-panel-empty.png`** — paired w/ admin/02-02.
- [ ] **`mobile-orders-empty.png`** — profile/orders before any purchase.

#### states/optimistic-revert/

- [ ] **`mobile-name-revert.png`** — name edit failure → field reverts.
- [ ] **`mobile-slug-revert.png`** — slug edit failure → field reverts.
- [ ] **`mobile-public-toggle-revert.png`** — `isPublic` toggle failure → switch flips back.

---

**Quick-smoke shot count check:** 15 shots are tagged `[quick-smoke]` across the list above. Tester captures these first per Q11.

### 3. Capture tooling guidance

Pick the tool that matches the surface. Default to whatever produces a 1:1 native-resolution PNG.

| Surface                 | Recommended tool                                                                                                  | Notes                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| iOS Simulator           | `xcrun simctl io booted screenshot <out>.png`                                                                     | Optional `frame-pkg` overlay for marketing-quality frames. Capture both `Light` and `Dark` (Features → Toggle Appearance). |
| Android emulator        | `adb exec-out screencap -p > <out>.png`                                                                           | Toggle Dark in Quick Settings. Locale via `Settings → System → Languages`.                                                 |
| Physical iOS device     | side-button + volume-up → AirDrop to laptop                                                                       | For the share-sheet shot (mobile/02-14) only physical works on iOS.                                                        |
| Physical Android device | power + volume-down → USB pull                                                                                    | Same reason.                                                                                                               |
| Admin (Next.js web)     | `mcp__chrome-devtools__take_screenshot` (Chrome DevTools MCP) or Playwright `page.screenshot({ fullPage: true })` | Capture at `1440x900` (desktop), `768x1024` (tablet), `375x812` (mobile-web). Default = desktop.                           |
| Public-web `/g/:slug`   | same as admin                                                                                                     | Always incognito — never logged-in admin session.                                                                          |
| VoiceOver focus rings   | iOS Simulator with `Accessibility Inspector` running                                                              | One shot per surface marked `-voiceover`.                                                                                  |

**Modes + locales (mandatory):**

- Every **mobile** shot must exist in **light + dark**. Default filename = light; `-dark` suffix for the dark twin.
- Every shot must be **pt-BR**. Capture `-en` only when the English copy differs structurally (not for proper nouns like "Premium" or "Pix").
- VoiceOver / TalkBack variants only for the shots explicitly listed with `-voiceover` suffix.

**Determinism:**

- Same seed user across the run.
- Same device clock (don't capture across midnight — `premiumUntil` rendering may drift).
- Hide notification banners (DND on).
- Status-bar time = `9:41` on iOS sim if going public with shots (use `xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100`).

### 4. README.md template

Tester writes `.handoffs/garage-spots-screenshots/README.md` at capture time:

```markdown
# Garage-Spots Screenshot Archive

**Capture date:** 2026-MM-DD
**Tester:** <name>
**Environment:** staging (https://staging-api.jdm.example) / app build sha <git-sha>
**DB state:** seed reset + Attendees A-E provisioned per smoke-test plan §1.1
**Mobile device(s):** iPhone 15 Pro Sim (iOS 18.x), Pixel 7 emulator (Android 14), <physical device if used>
**Browser:** Chrome <version> incognito
**Locale:** pt-BR (default) + en (where flagged)
**Color modes:** light + dark (mobile), light only (admin/public-web)

## Index

Each shot links to the plan checklist item that produced it:

- [mobile/01-onboarding/01-fresh-signup-empty-garage.png](./mobile/01-onboarding/01-fresh-signup-empty-garage.png) — plan §Screenshot Capture mobile/01-onboarding 01
- [mobile/02-garage-owner/07-premium-owner.png](./mobile/02-garage-owner/07-premium-owner.png) — plan §Screenshot Capture mobile/02-garage-owner 07
- … (one line per file on disk)

## Not captured

- `mobile/05-buy-spot-flow/05-checkout-stripe-card.png` — Apple Pay path skipped (no sandbox cards available).
- `states/error/mobile-serialization-conflict.png` — could not reproduce manually; relying on Sentry post-launch.
- … (one line per missed shot + reason)

## Open questions for designer

- Spot-card free-vs-purchased visual hierarchy is ambiguous — see shots 02-02 / 02-06.
- Share button outputs a path-only string — see 02-14 + 03-04.
- Public profile is JSON-only today — see 03-01..04. Designer must propose an HTML page.
- Premium badge color drift between mobile and admin — compare 02-07 with admin/02-04.
- (add observations encountered during capture)
```

### 5. Designer agent handoff

Designer agent picks up from here. No further plan steps from the tester after the archive is committed.

**Context the designer must read first:**

- Spec: [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](../docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md).
- This plan, especially [UX Audit §A-J](#ux-audit) — friction items already surfaced.
- Orchestration ledger: [`.handoffs/garage-spots-orchestration.md`](./garage-spots-orchestration.md) — locked contracts that bound any redesign.
- Cautionary tale: PR #366 (`fix(api): include user.garage in /me/garage car serializer`). Silent serializer drift → premium badge missing on owner's own cars → only caught by manual visual check. Implication for design system: there should be a **visible test mode** for premium state (a debug toggle that forces `isPremiumActive=true` across all surfaces) so future regressions surface in design QA, not Sentry.

**Top friction items already surfaced** (anchor links into UX Audit §J):

- Invisible edit affordances on `GarageHeader` — UX-Audit §J observation 1.
- 5+ step buy-spot loop with no return-to-garage highlight — §J observation 2.
- Free vs purchased empty cards visually indistinguishable — §J observation 3.
- PremiumBadge color drift mobile vs admin — §J observation 4.
- Share button emits path-only string — §J observation 5.
- Slug regex violation mislabelled as "URL já em uso" — §J observation 6.
- Empty-state CTA is muted text not a button — §J observation 7.
- PremiumBadge is dead (no `onPress`) — §J observation 8.
- Public profile is JSON-only — §J observation 9.

**Deliverables requested from the designer agent:**

1. Per-screen redesign proposals as Figma frames (one file per folder in `.handoffs/garage-spots-screenshots/`, mirroring the structure).
2. A markdown rationale per change set, output back into `.handoffs/garage-spots-screenshots/redesigns/<folder>/RATIONALE.md`. Each rationale must:
   - Reference the source shot by ID.
   - State the friction (link UX-Audit anchor or §J observation).
   - Describe the proposed fix.
   - Call out any change that touches a locked contract (anti-enumeration, neutral defaults, source-aware spot copy, premium serialization) — those require eng sign-off, not designer-led.
3. A design-system delta doc at `.handoffs/garage-spots-screenshots/redesigns/DESIGN-SYSTEM-DELTA.md` covering: shared `PremiumBadge` token unification, free-vs-purchased spot visual language, public-profile HTML page wireframe, empty-state CTA pattern.

Designer does **not** write code. Hand redesigns back to local-board for eng task breakdown.

---

## 6. Known dirt (do NOT flag)

These are pre-existing or intentionally deferred. Do NOT file bugs.

- 4 pre-existing react-hooks/set-state-in-effect lint errors in `apps/admin/` (cookie-banner, product-edit-form). Predates garage work.
- `apps/api/test/helpers.ts` duplicate `deleteMany` calls in reset helper (pre-existing).
- Premium membership purchase flow + Stripe-recurring + auto-grant logic is **OUT OF SCOPE** (deferred to future TASK per spec §9).
- Sweep job for `source = premium_membership` empties when premium lapses is **OUT OF SCOPE**. Empties linger until manual admin cleanup.
- Cache-Control / CDN policy for `/g/:slug` is **OUT OF SCOPE** (deferred infra task). No `Cache-Control` header assertions.
- First-car-add inside signup wizard is **OUT OF SCOPE**. Fresh signup lands on empty `/garage` with CTA, not a forced car-add step.
- Slug `0` numeric input behavior under TASK-F: spec doesn't explicitly say whether `0` is admin-rejected. Treat current behavior as canonical until product clarifies. **[VERIFY: spec ambiguous]**.
- Round-2 catch dirt that was intentionally NOT fixed: see orchestration handoff "Known dirt unrelated to pivot" section. Anything outside the locked contracts list is not in scope here.

---

## 7. Rollback signals

If any of these surface in production, **roll back the deployment** — do not patch forward.

1. **Premium badge silently absent** on owner's own cars for a non-trivial number of premium users. This is the PR #366 regression class — silent serializer drift means another car-bearing endpoint forgot the `user.garage { premiumTier, premiumUntil }` include. Search Sentry / customer reports for "I'm premium but no badge" patterns. Rollback restores last-known-good serializer behavior.
2. **Order paid but no `GarageSpot` created within 60s** of webhook acknowledgement. Settlement is broken; deferred fulfillment means users paid but didn't get spots. Rollback API to last-known-good; replay webhooks via Stripe dashboard once code restored.
3. **`/g/:slug` enumeration possible** — private slug 404 body differs from unknown slug 404 body (status code, body length, headers, error message). This is an LGPD/anti-enumeration invariant; any divergence allows brute-forcing taken slugs. Rollback immediately.

Tiebreaker: if any rollback signal fires within 24h of deploy, escalate to local-board before manual merge to `production`.

---

## Sign-off

| Field          | Value                       |
| -------------- | --------------------------- |
| Tester name    |                             |
| Environment    | staging / prod (circle one) |
| Build / commit |                             |
| Date           |                             |
| Mobile device  | iOS / Android, model        |
| Browser        | Chrome / Safari, version    |

### Section results

| Section                      | Pass / Fail / N-A | Notes |
| ---------------------------- | ----------------- | ----- |
| Quick smoke                  |                   |       |
| UX Quick Scan                |                   |       |
| 1. Setup                     |                   |       |
| 2. Mobile attendee flows     |                   |       |
| 3. Admin organizer flows     |                   |       |
| 4. API edge cases            |                   |       |
| 5. Webhook + settlement      |                   |       |
| UX Audit (A-I)               |                   |       |
| UX Audit J — friction count  |                   |       |
| 6. Known dirt acknowledged   |                   |       |
| 7. No rollback signals fired |                   |       |

### Overall verdict

- [ ] **GO** — rollout safe.
- [ ] **NO-GO** — see notes.

### Tester signature

`_________________________`
