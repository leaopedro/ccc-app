# JDM Experience — Technical Roadmap

> Companion to `brainstorm.md`. Tracks every implementation task, grouped by
> phase. Each task is scoped for a single agent to pick up.
>
> **Do not change the contents of this file except to update the status
> markers on task lines.** No re-scoping, no re-ordering, no rewriting
> descriptions. If scope drifts, capture the delta in `handoff.md` or the
> feature's implementation plan, not here.

## How to use this document

- **Tasks are ordered.** Within a phase, the order respects dependencies.
  Don't start a task until everything it depends on is checked.
- **Each task has a minimal spec:** scope (what to build), deliverables
  (files, endpoints, screens), and done-when (acceptance criteria).
- **Keep the status markers accurate.** Agents MUST update them whenever
  reality changes:
  - Flip `[ ]` → `[~]` when work starts on-branch (PR open or commits pushed).
  - Flip `[~]` → `[x]` only when the PR is **merged to `main` AND deployed**
    to the environment the task targets (Railway / Vercel / EAS / n/a).
    Passing locally or on a feature branch is not enough.
  - Flip any marker → `[-]` if the task is dropped; add a one-line reason
    on the same line (e.g. `[-] … — dropped: superseded by 3.2`).
- **Update as part of the merge itself**, not in a follow-up. The PR that
  lands the work is also the PR that ticks the box.
- **Multiple checkboxes per task** (scope / deliverables / done-when): tick
  each one independently as it becomes true. Partial progress is fine — the
  state should match reality.
- **Split tasks if they balloon.** If a task takes more than a day, break it
  and add sub-tasks under the parent.

Legend: `[ ]` open · `[~]` in progress (branch/PR exists) · `[x]` done
(merged + deployed) · `[-]` dropped

---

## Phase 0 — Foundations (app runs, tested, deployable)

**Goal:** a clean pnpm monorepo with `apps/api`, `apps/mobile`, `apps/admin`
wired end-to-end. CI runs lint + typecheck + tests. API + Postgres deployed
on Railway; Admin on Vercel; Mobile dev builds via EAS. Anyone cloning the
repo can `pnpm i && pnpm dev` and hit a `/health` endpoint, open the Expo app,
and load the admin page.

### 0.1 Monorepo scaffold

- [ ] **Scope:** Initialize pnpm workspaces + Turborepo at repo root.
- **Deliverables:**
  - `package.json` with `"packageManager": "pnpm@..."` and `workspaces`.
  - `pnpm-workspace.yaml`, `turbo.json` (pipelines: `build`, `lint`,
    `typecheck`, `test`, `dev`).
  - Empty `apps/` and `packages/` directories.
  - Root `.gitignore`, `.editorconfig`, `.nvmrc` (Node LTS).
- **Done when:** `pnpm install` at root succeeds; `pnpm turbo run build`
  runs (does nothing yet, but reports success).

### 0.2 Shared TypeScript config

- [ ] **Scope:** Common `tsconfig` base the other packages extend.
- **Deliverables:** `packages/tsconfig/base.json`,
  `packages/tsconfig/node.json`, `packages/tsconfig/react-native.json`,
  `packages/tsconfig/nextjs.json`.
- **Done when:** `strict: true`, `noUncheckedIndexedAccess: true`, path
  aliases set up for workspace imports.

### 0.3 Shared lint + format config

- [ ] **Scope:** Root ESLint (flat config) + Prettier.
- **Deliverables:** `eslint.config.js`, `.prettierrc`, `lint-staged.config.js`
  with `simple-git-hooks` or `husky` pre-commit.
- **Done when:** `pnpm lint` passes on an empty repo; pre-commit formats
  staged files.

### 0.4 `packages/shared`

- [ ] **Scope:** Zod schemas and API types shared between api, mobile, admin.
- **Deliverables:**
  - `packages/shared/src/index.ts`
  - Sub-modules `auth.ts`, `events.ts`, etc. (empty stubs for now).
  - Exports branded ID types (`UserId`, `EventId`, …).
- **Done when:** `@jdm/shared` imports cleanly from another workspace package.

### 0.5 `packages/db` — Prisma base

- [ ] **Scope:** Prisma client wrapper + base schema + migration workflow.
- **Deliverables:**
  - `packages/db/prisma/schema.prisma` (empty `User` placeholder so the
    generator runs).
  - `packages/db/src/index.ts` exporting a singleton `PrismaClient`.
  - `pnpm db:migrate`, `pnpm db:generate`, `pnpm db:studio` scripts.
  - `.env.example` with `DATABASE_URL`.
- **Done when:** `pnpm db:migrate dev --name init` creates a migration against
  a local Postgres (Docker Compose file committed at repo root).

### 0.6 `apps/api` — Fastify skeleton

- [ ] **Scope:** Fastify server with `/health`, env loader, structured logger,
      request-id middleware, Sentry hook, graceful shutdown.
- **Deliverables:**
  - `apps/api/src/server.ts`, `apps/api/src/env.ts` (Zod-validated envs),
    `apps/api/src/plugins/*` (logger, sentry, request-id, error-handler).
  - Dockerfile + `.dockerignore`.
- **Done when:** `pnpm --filter api dev` boots; `GET /health` returns
  `{ status: "ok", sha: "<git-sha>" }`; errors are logged with request id.

### 0.7 `apps/api` — integration test harness

- [ ] **Scope:** Vitest + Testcontainers-Postgres for real DB tests.
- **Deliverables:**
  - `apps/api/vitest.config.ts`, `apps/api/test/setup.ts` spins up a
    throwaway Postgres per suite and runs migrations.
  - Example test hitting `/health`.
- **Done when:** `pnpm --filter api test` green in CI.

### 0.8 `apps/mobile` — Expo skeleton

- [ ] **Scope:** Expo managed app with Expo Router, theming, and a typed
      API client that points at the deployed API.
- **Deliverables:**
  - `apps/mobile/app.config.ts` with dev / preview / prod variants.
  - `apps/mobile/app/_layout.tsx`, `index.tsx` (renders "JDM Experience" +
    health-check call).
  - `src/api/client.ts` (typed, reads base URL from env).
  - `src/theme/` + a component library seed (e.g. one `<Button>`).
- **Done when:** `pnpm --filter mobile start` loads on iOS simulator and
  Android emulator; index screen shows API health status.

### 0.9 `apps/mobile` — EAS configuration

- [ ] **Scope:** EAS Build + Submit profiles for `development`, `preview`,
      `production`. Apple + Google credentials documented (not committed).
- **Deliverables:**
  - `apps/mobile/eas.json`.
  - `docs/eas-credentials.md` with what to obtain from Apple Developer and
    Google Play Console.
- **Done when:** `eas build --profile preview --platform ios` produces an
  installable build; same for Android APK.

### 0.10 `apps/admin` — Next.js skeleton

- [ ] **Scope:** Next.js 14+ App Router + Tailwind + a placeholder login page
  - health check call.
- **Deliverables:**
  - `apps/admin/app/layout.tsx`, `app/page.tsx`,
    `app/api/health/route.ts`.
  - Tailwind + shadcn/ui seed.
- **Done when:** `pnpm --filter admin dev` serves `/` which shows API health
  pinged from a server component.

### 0.11 GitHub Actions CI

- [ ] **Scope:** Single workflow on PR + main: install (pnpm cache), build,
      lint, typecheck, test across all workspaces.
- **Deliverables:** `.github/workflows/ci.yml`.
- **Done when:** Opening a PR runs green; a deliberate lint error fails CI.

### 0.12 Railway deploy — API + Postgres

- [x] **Scope:** Production and preview environments on Railway.
- **Deliverables:**
  - Railway project with `api` service + `postgres` plugin (prod).
  - Preview environments per PR (Railway setting).
  - Migration step in deploy (`prisma migrate deploy`).
  - `RAILWAY.md` with deploy steps and required env vars.
- **Done when:** Merging to `main` auto-deploys; `/health` on prod URL
  returns `ok`; migrations applied.

### 0.13 Vercel deploy — Admin

- [~] **Scope:** Admin on Vercel with preview deploys per PR.
- **Deliverables:** Vercel project linked to repo, env vars for API URL set
  per environment.
- **Done when:** PR previews deploy; prod admin URL loads.

### 0.14 Secrets & env management

- [ ] **Scope:** Document every secret the system needs, where it lives,
      and how to rotate.
- **Deliverables:** `docs/secrets.md` listing Railway, Vercel, EAS, Stripe,
  AbacatePay, R2, Apple, Google, Sentry, Expo. One `.env.example` per app.
- **Done when:** A new developer can follow `docs/secrets.md` to get a
  fully functional local dev environment.

### 0.15 Sentry projects

- [ ] **Scope:** One Sentry project each for api, mobile, admin. DSNs wired.
- **Deliverables:** `SENTRY_DSN` in each app's env; release upload in CI.
- **Done when:** An induced error surfaces in Sentry from each app.

### 0.16 README + CONTRIBUTING

- [ ] **Scope:** Root README covering: what this is, prereqs, first-run
      steps, how to run each app, how to run tests, how to deploy.
- **Deliverables:** `README.md`, `CONTRIBUTING.md`.
- **Done when:** A new engineer can clone and run the whole stack in
  under 30 minutes following only the README.

---

## Phase 1 — MVP

**Goal:** a user can sign up, browse events, buy a ticket (Stripe, then Pix),
and attend — scanned at the door by the admin web. Matches brainstorm v0.1 +
v0.2.

### F1 — Auth & identity

#### 1.1 Schema: User, AuthProvider, RefreshToken

- [x] **Scope:** Add User/AuthProvider/RefreshToken models and email
      verification fields. _(merged via PR #1; deployed to Railway)_
- **Deliverables:** Prisma migration; Zod schemas in `@jdm/shared/auth`.
- **Done when:** `db:migrate` green in CI; shared schemas typecheck.

#### 1.2 Signup with email + password

- [x] **Scope:** `POST /auth/signup`. Bcrypt hash, create User, send
      verification email (Resend or Postmark). _(merged via PR #2; deployed to Railway)_
- **Deliverables:** route, service, email template, tests (happy + duplicate
  email + weak password).
- **Done when:** New user row + verification email in mailtrap in tests.

#### 1.3 Login with email + password

- [x] **Scope:** `POST /auth/login`. Return access JWT (15m) + refresh
      (30d, stored hashed). _(merged via PR #2; deployed to Railway)_
- **Done when:** integration test covers success, bad password, unverified.

#### 1.4 Refresh + logout

- [x] **Scope:** `POST /auth/refresh` (rotate), `POST /auth/logout` (revoke).
      _(merged via PR #2; deployed to Railway)_
- **Done when:** refresh rotates token hash; logout invalidates.

#### 1.5 Email verification

- [x] **Scope:** `GET /auth/verify?token=…` and `POST /auth/resend-verify`.
      _(merged via PR #2; deployed to Railway)_
- **Done when:** clicking link sets `email_verified_at`; expired/invalid
  tokens rejected.

#### 1.6 Password reset

- [x] **Scope:** `POST /auth/forgot-password`, `POST /auth/reset-password`.
      _(merged via PR #2; deployed to Railway)_
- **Done when:** e2e: request → receive email → reset → log in with new pw.

#### 1.7 Google sign-in

- [-] **Scope:** `POST /auth/google` accepts Google ID token, verifies via
  Google's JWKS, finds or creates User + AuthProvider row, returns app JWT.
  — deferred to post-MVP (email+password is sufficient for v0.1)
- **Done when:** integration test with a mocked Google JWKS.

#### 1.8 Apple sign-in

- [-] **Scope:** `POST /auth/apple` accepts Apple ID token, verifies via
  Apple's JWKS, handles hide-my-email relay addresses.
  — deferred to post-MVP (email+password is sufficient for v0.1)
- **Done when:** integration test with a mocked Apple JWKS.

#### 1.9 Rate limiting on auth endpoints

- [~] **Scope:** `@fastify/rate-limit` on every `/auth/*` route (strict per
  IP + per email).
- **Done when:** test confirms 429 after N attempts.

#### 1.10 Mobile: auth screens

- [ ] **Scope:** Signup, login, forgot-password, verify-email-pending screens.
      PT-BR copy. Validation with zod-resolver + react-hook-form.
- **Done when:** user can complete email+password signup and login against
  the deployed API.

#### 1.11 Mobile: Google sign-in

- [-] **Scope:** `expo-auth-session/providers/google` button. Send ID token
  to `/auth/google`. Store JWTs in SecureStore.
  — deferred to post-MVP (follows API 1.7)
- **Done when:** Google account creates a user and logs in.

#### 1.12 Mobile: Apple sign-in

- [-] **Scope:** `expo-apple-authentication` button (iOS only visible).
  — deferred to post-MVP (follows API 1.8)
- **Done when:** Apple account creates a user and logs in.

#### 1.13 Mobile: token storage + auto-refresh

- [ ] **Scope:** SecureStore wrapper, axios/ky interceptor that refreshes on
      401, logs out on refresh failure.
- **Done when:** expired access token transparently refreshes; revoked
  refresh logs out user.

### F2 — Profile & garage

#### 2.1 Schema: Car, CarPhoto, profile fields

- [~] **Scope:** Prisma models + migrations + shared Zod. _(merged via PR #8 — awaiting Railway/EAS deploy)_
- **Done when:** migration green; schemas typecheck.

#### 2.2 API: GET/PATCH /me

- [~] **Scope:** Profile fetch and update (name, bio, city, state, avatar). _(merged via PR #8 — awaiting Railway/EAS deploy)_
- **Done when:** tests cover happy + validation.

#### 2.3 R2 pre-signed upload endpoint

- [~] **Scope:** `POST /uploads/presign` returns a pre-signed PUT URL + final
  object key + content-type whitelist + size cap. _(merged via PR #8 — awaiting Railway/EAS deploy)_
- **Deliverables:** R2 bucket (prod + preview), CORS config, S3-compatible
  client.
- **Done when:** mobile can PUT an image and then confirm the key to the API.

#### 2.4 API: cars CRUD

- [~] **Scope:** `/me/cars` list/create/update/delete; `/me/cars/:id/photos`
  add/remove. _(merged via PR #8 — awaiting Railway/EAS deploy)_
- **Done when:** tests cover all happy + ownership guard (can't edit another
  user's car).

#### 2.5 Mobile: profile screen

- [~] **Scope:** View + edit profile. Avatar picker with R2 upload. _(merged via PR #8 — awaiting Railway/EAS deploy)_
- **Done when:** edits persist; avatar updates in UI and on backend.

#### 2.6 Mobile: garage screen

- [~] **Scope:** List cars, add/edit/remove, manage photos. _(merged via PR #8 — awaiting Railway/EAS deploy)_
- **Done when:** flow works end-to-end against deployed API.

### F3 — Events catalog

#### 3.1 Schema: Event + enums

- [~] **Scope:** Event model; event type + status enums; indexes on
  (state, city, starts*at), (status, starts_at). *(on feat/f3-events)\_
- **Done when:** migration green.

#### 3.2 API: list events

- [~] **Scope:** `GET /events` with filters (state, city, type,
  upcoming|past|all) and cursor pagination. _(on feat/f3-events)_
- **Done when:** tests cover pagination + filters.

#### 3.3 API: event detail

- [~] **Scope:** `GET /events/:slug` returns event + tiers + remaining
  capacity per tier. _(on feat/f3-events; concurrent-purchase correctness deferred to F4 when Ticket model lands)_
- **Done when:** counts are accurate under concurrent purchase.

#### 3.4 Mobile: events list

- [~] **Scope:** Tabs "Próximos" / "Anteriores" / "Perto de mim" with
  filters. Pull-to-refresh. _(on feat/f3-events; "Perto de mim" uses profile stateCode — real geolocation deferred)_
- **Done when:** renders real data from API; filters work.

#### 3.5 Mobile: event detail

- [~] **Scope:** Hero, description, date/time, venue card with map pin,
  tiers with prices, "Buy" CTA. _(on feat/f3-events; CTA disabled "Em breve" until F4)_
- **Done when:** tapping map opens native maps with directions.

### F7a — Admin: event CRUD (first pass)

#### 7.1 Admin auth

- [~] **Scope:** Admin logs in with email+password against the same API;
  session cookie/JWT. Guard by `role in (organizer, admin)`. _(on feat/f7a-admin-event-crud)_
- **Done when:** only organizers/admins can access admin routes.

#### 7.2 Admin: events list + CRUD

- [~] **Scope:** Table view, create/edit/publish/cancel event, cover upload
  via R2. _(on feat/f7a-admin-event-crud)_
- **Done when:** a published event immediately shows on mobile list.

#### 7.3 Admin: ticket tier CRUD

- [~] **Scope:** Nested under event. Name, price (BRL cents),
  quantity*total, sales window. *(on feat/f7a-admin-event-crud)\_
- **Done when:** attendees see correct tiers + remaining counts.

#### 7.4 API: organizer-scoped mutations

- [~] **Scope:** All event/tier mutations require role check; audit log table
  (`AdminAudit`) records who did what. _(on feat/f7a-admin-event-crud)_
- **Done when:** unauthenticated or user-role request returns 403; audit rows
  written.

### F4 — Ticketing (Stripe path)

> note (2026-05-05, JDMA-254): cart redesign execution is merged on `main`
> (PRs #109/#110/#112/#114), but `production` currently includes #109/#110
> only. Keep 4.1–4.7 as `[~]` until `main -> production` promotion plus
> post-deploy smoke evidence (matrix `C1/C3/C4`, plus `P1/P2` when Pix is in
> scope).

#### 4.1 Schema: TicketTier, Order, Ticket

- [~] **Scope:** Already partially above; finalize constraints + indexes
  (unique `Ticket.code`; `@@index([user_id, event_id])`). _(on feat/f4-ticketing-stripe)_
- **Done when:** migration green.

#### 4.2 Stripe account + webhook plumbing

- [~] **Scope:** Register webhook endpoint, verify signatures, dedupe by
  `event.id`. _(on feat/f4-ticketing-stripe)_
- **Deliverables:** `POST /stripe/webhook` route, Stripe event deduplication
  table.
- **Done when:** duplicate webhooks are ignored; bad signatures 400.

#### 4.3 API: create Stripe order

- [~] **Scope:** `POST /orders {eventId, tierId, method: "card"}`. Create
  Order (pending), create PaymentIntent with metadata, return `clientSecret`. _(on feat/f4-ticketing-stripe)_
- **Done when:** capacity race-condition test (two concurrent orders on last
  seat) — only one succeeds.

#### 4.4 Webhook: payment_intent.succeeded

- [~] **Scope:** Mark Order paid, issue Ticket with HMAC-signed code, send
  "Ticket confirmed" push (hooked in F6). _(on feat/f4-ticketing-stripe; push deferred to F6)_
- **Done when:** e2e: Stripe test card → Ticket row appears with valid code.

#### 4.5 API: my tickets

- [~] **Scope:** `GET /me/tickets` (upcoming + past); includes code for QR. _(on feat/f4-ticketing-stripe)_
- **Done when:** only valid, own tickets returned.

#### 4.6 Mobile: buy ticket (Stripe)

- [~] **Scope:** Tier picker → Stripe RN SDK payment sheet (Apple Pay + card)
  → success screen → ticket in My Tickets. _(on feat/f4-ticketing-stripe; needs dev-client build, Expo Go will not work)_
- **Done when:** flow works end-to-end on TestFlight.

#### 4.7 Mobile: My Tickets + QR

- [~] **Scope:** List tickets; tap to full-screen QR with brightness boost
  and screen-keep-awake. _(on feat/f4-ticketing-stripe; screen-keep-awake done, brightness boost deferred)_
- **Done when:** QR renders reliably; used tickets visibly greyed out.

### F5 — Check-in

[REVIEW]: the event check in (event arrival) will be done by staff, not admins. We need to add a new type of user that does this kind of operational stuff but can't edit event info, see revenue or has any admin-only permissions. for now they are able to check-in and on demand we can define more actions they can do.
Staff logs in via admin web app for now, in the future we can have a separate app for them.

#### 5.1 API: check-in endpoint

- [~] **Scope:** `POST /admin/tickets/check-in { code }`. Verify HMAC,
  look up ticket, atomically set `status=used`, return holder info. Reject
  already used, revoked, or wrong-event tickets. Idempotent on retry with
  same request id. _(on feat/f5-checkin)_
- **Done when:** concurrent scans of same code → exactly one success.

#### 5.2 Admin: QR scanner page

- [~] **Scope:** Web camera scan (`@zxing/browser` or similar); shows holder
  name/photo + tier; buttons "Admit" / "Reject". _(on feat/f5-checkin)_
- **Done when:** door staff can scan 100+ tickets comfortably.

#### 5.3 (Optional) Mobile door-mode

- [ ] **Scope:** Role-gated screen in the RN app for staff using phones.
- **Done when:** parity with admin page for core scan flow.

### F6 — Transactional push

#### 6.1 Schema: DeviceToken, Notification

- [~] **Scope:** Prisma models; unique on `(user_id, expo_push_token)`. _(on feat/f6-push)_
- **Done when:** migration green.

#### 6.2 API: register device token

- [~] **Scope:** `POST /me/device-tokens` on login and cold start. _(on feat/f6-push)_
- **Done when:** duplicate registrations no-op; `last_seen_at` updates.

#### 6.3 Push sender service

- [~] **Scope:** `sendPush(userIds, { title, body, data })` wrapping Expo
  Push API with retry, invalid-token pruning. _(on feat/f6-push)_
- **Done when:** unit tested; invalid tokens removed after failure response.

#### 6.4 Wire transactional hooks

- [~] **Scope:** On Order paid → push "Ingresso confirmado". On event
  starts*at − 24h and − 1h → reminder (cron worker). *(on feat/f6-push)\_
- **Deliverables:** `apps/api/src/workers/event-reminders.ts` (cron via
  `@fastify/schedule` or external scheduler).
- **Done when:** test event triggers both reminders at the right times.

#### 6.5 Mobile: register + permission UX

- [~] **Scope:** Ask for push permission at the right moment (after first
  ticket purchase). Handle token rotation on reinstall. _(on feat/f6-push)_
- **Done when:** tokens stay in sync after reinstall.

### F4b — Ticketing (Pix path, AbacatePay)

#### 4.8 AbacatePay setup

- [ ] **Scope:** Register webhook, handle signature verification, dedupe.
- **Done when:** bad signature → 400; duplicate events ignored.

#### 4.9 API: create Pix order

- [ ] **Scope:** `POST /orders {..., method: "pix"}`. Call AbacatePay create
      charge (TTL ~30min), persist `provider_ref`, return `{ qrCode,
copyPaste, expiresAt }`.
- **Done when:** charge expires automatically; expired orders cannot be paid.

#### 4.10 Webhook: charge.paid

- [ ] **Scope:** Mark Order paid, issue Ticket, push "Pagamento recebido".
- **Done when:** e2e with AbacatePay sandbox: paid sandbox charge →
  ticket issued.

#### 4.11 API: order status polling

- [~] **Scope:** `GET /orders/:id` returns current status for mobile poll.
- **Done when:** polling stops after `paid` or `expired`.

#### 4.12 Mobile: Pix screen

- [ ] **Scope:** QR (large, scannable), copy-paste with copy button,
      countdown timer, status poll every 3s + push listener.
- **Done when:** on-screen confirmation arrives within seconds of payment.

---

## Phase 2 — Revenue expansion (v0.3 + v0.4)

### F8 — Premium membership

#### 8.1 Schema: Membership

- [ ] **Scope:** Membership model + enum (tier, status); unique per user
      active membership (partial unique index).
- **Done when:** migration green.

#### 8.2 API: start subscription

- [ ] **Scope:** `POST /memberships/checkout { tier }` creates Stripe
      Customer if needed, creates Subscription with `default_incomplete` +
      PaymentIntent, returns `clientSecret`.
- **Done when:** test mode card subscribes successfully.

#### 8.3 Webhook: subscription lifecycle

- [ ] **Scope:** Handle `customer.subscription.created/updated/deleted` and
      `invoice.payment_failed`. Update Membership accordingly.
- **Done when:** cancel-at-period-end, past_due, cancelled states reflected.

#### 8.4 Ticket grants service

- [ ] **Scope:** On Membership activation: backfill Tickets
      (source=`premium_grant`) for all currently-published future events.
      On event publish: grant Ticket to every active member. Idempotent:
      only grant if no valid Ticket for (user, event) already.
- **Done when:** integration test covers activation + publish + cancel
  paths.

#### 8.5 API: membership info

- [ ] **Scope:** `GET /me/membership`; `POST /me/membership/cancel` (calls
      Stripe to cancel_at_period_end); `POST /me/membership/portal-session`
      returning Stripe Billing Portal URL.
- **Done when:** all three work against Stripe test mode.

#### 8.6 Mobile: premium paywall

- [ ] **Scope:** Benefits list, tier selector (Mensal, Anual), checkout.
- **Done when:** subscribing reflects in My Tickets (future events granted).

#### 8.7 Mobile: manage membership

- [ ] **Scope:** Status card, next billing date, cancel button, link to
      Billing Portal (in-app browser).
- **Done when:** cancel → shows "expires on … " next billing cycle.

#### 8.8 Premium badge

- [ ] **Scope:** Badge component + surface on profile and feed posts.
- **Done when:** active members show badge everywhere.

### F9 — Event feed

#### 9.1 Schema: FeedPost, FeedLike, FeedComment, Report

- [~] **Done when:** migration green; shared schemas in `@jdm/shared/feed`.

> note: model named `FeedReaction` (kind-flexible) instead of `FeedLike`; `Report` covers posts and comments; feed settings persisted on `Event`.

#### 9.2 API: feed CRUD

- [ ] **Scope:** `GET /events/:id/feed` (cursor-paginated),
      `POST /events/:id/feed` (text + media keys), `DELETE /feed/:id` (author or
      admin).
- **Done when:** tests cover authorship + visibility rules.

#### 9.3 API: likes + comments

- [ ] **Scope:** `POST/DELETE /feed/:id/like`, `POST /feed/:id/comments`,
      `GET /feed/:id/comments`.
- **Done when:** counts consistent under concurrency.

#### 9.4 API: visibility rule

- [ ] **Scope:** A user may read a feed if they have a valid Ticket for the
      event, or an active Membership. Enforced in query, not in UI.
- **Done when:** access test matrix green.

#### 9.5 API: reporting + moderation

- [ ] **Scope:** `POST /feed/:id/report`. Admin endpoints to list reports,
      hide a post, ban a user from a feed.
- **Done when:** hidden posts disappear from attendee feed within one refresh.

#### 9.6 Mobile: feed tab

- [ ] **Scope:** Feed tab on event detail. Post composer (text + up to
      4 photos or 1 video). Like, comment, report actions.
- **Done when:** usable on slow 3G (progress indicators on uploads).

#### 9.7 Admin: moderation queue

- [ ] **Scope:** List of open reports; resolve (hide / dismiss / ban).
- **Done when:** moderator can clear a 50-item queue efficiently.

### F10 — Promotions & marketing push

#### 10.1 Schema: push preferences

- [ ] **Scope:** `User.push_prefs jsonb` with
      `{ transactional: true, marketing: true }`.
- **Done when:** migration green; mobile exposes toggle.

#### 10.2 API: broadcasts

- [ ] **Scope:** `POST /admin/broadcasts` creates a Broadcast with targeting
      (all / premium / attendees_of:eventId / city:XX). Persist + enqueue.
- **Done when:** dry-run returns target user count.

#### 10.3 Broadcast worker

- [ ] **Scope:** Background worker sends via Expo Push in batches with
      rate-limit + retry. Respects `push_prefs.marketing`.
- **Done when:** 10k-user broadcast completes within minutes; opt-outs
  excluded.

#### 10.4 Admin: broadcast composer

- [ ] **Scope:** UI to compose, target, preview estimated reach, schedule
      or send now. Recent broadcasts table with stats.
- **Done when:** operator can compose and schedule a broadcast in under
  two minutes.

---

## Phase 3 — Community (v0.5 + v0.6)

### F11 — Private messaging

#### 11.1 Schema: Conversation, Message, Block

- [ ] **Done when:** migration green.

#### 11.2 API: conversations

- [ ] **Scope:** `GET /me/conversations`, `POST /conversations` (start or
      resume with user), `GET /conversations/:id/messages` (cursor),
      `POST /conversations/:id/messages` (text or image key), `POST .../read`.
- **Done when:** unread counts accurate; read acks persist.

#### 11.3 API: block + report

- [ ] **Scope:** `POST /users/:id/block`, `DELETE /users/:id/block`;
      sending to a blocker is rejected.
- **Done when:** cannot DM someone who blocked you.

#### 11.4 Push on new message

- [ ] **Scope:** On message insert, push to recipient unless thread is
      currently open on a device (heuristic: last `read_at` within 10s).
- **Done when:** no push when chat is visibly open.

#### 11.5 Mobile: conversations + thread

- [ ] **Scope:** List view; thread view with send input + image attach;
      poll open thread every 3s + read-receipts.
- **Done when:** conversation feels responsive on normal connectivity.

#### 11.6 Admin: abuse review

- [ ] **Scope:** View reported conversations; ban user from messaging.
- **Done when:** banned user cannot send new messages.

### F12 — Championships & voting

#### 12.1 Schema: Category, Nominee, Vote

- [ ] **Scope:** Include `UNIQUE(category_id, user_id)` on Vote.
- **Done when:** migration green; duplicate-vote insert fails at DB level.

#### 12.2 API: category lifecycle

- [ ] **Scope:** Admin opens (sets `opens_at`/`closes_at`), publishes
      results (`results_published_at`).
- **Done when:** state transitions enforced server-side.

#### 12.3 API: nominees

- [ ] **Scope:** `GET /categories/:id/nominees`. Admin can add/remove.
      Optionally nominate from an existing FeedPost (link via `feed_post_id`).
- **Done when:** list visible to attendees + premium during voting window.

#### 12.4 API: cast vote

- [ ] **Scope:** `POST /categories/:id/vote { nomineeId }`. Weight = 2 if
      user has active Membership, else 1. One vote per category enforced.
- **Done when:** weighted tally matches expectation in tests.

#### 12.5 API: results

- [ ] **Scope:** `GET /categories/:id/results` returns tallies only after
      `results_published_at`.
- **Done when:** premature requests return 403 or masked data.

#### 12.6 Admin: categories + nominees UI

- [ ] **Scope:** Per-event categories CRUD; nominee CRUD; open/close/publish.
- **Done when:** operator can set up a 3-category championship in 5 minutes.

#### 12.7 Mobile: vote UI

- [ ] **Scope:** Category card with nominees (photos), tap to select, confirm
      vote. Locked once cast. Results appear after publish.
- **Done when:** user understands weight rule from UI copy.

---

## Cross-cutting — run alongside phases

- [ ] **X.1** i18n scaffolding (mobile + admin), PT-BR default, copy in
      `packages/i18n/`.
- [ ] **X.2** LGPD: `POST /me/delete` (soft delete + 30-day purge job),
      `POST /me/export` (async, emails a download link).
- [ ] **X.3** App Store + Play Store listings (screenshots, privacy
      questionnaire, content rating).
- [ ] **X.4** Legal: Terms of Service, Privacy Policy, LGPD notice; linked
      from signup + profile.
- [ ] **X.5** E2E happy-path tests on mobile with Maestro: signup → buy
      ticket → show QR.
- [x] **X.6** Accessibility pass on mobile (dynamic type, contrast,
      VoiceOver/TalkBack labels).
- [~] **X.7** Observability dashboards (Sentry releases, Railway metrics,
  Stripe radar alerts). Code + docs landed via JDMA-45; Sentry alert
  rules + synthetic-fire test pending CEO confirmation in the Sentry
  UI before the box can flip to `[x]`.
- [x] **X.8** Backups + restore rehearsal for Postgres (Railway provides;
      verify a restore).

---

## Ownership + status (fill in as you go)

| Phase                       | Owner | Target date | Status |
| --------------------------- | ----- | ----------- | ------ |
| Phase 0                     |       |             | ⬜     |
| Phase 1 / F1 Auth           |       |             | ⬜     |
| Phase 1 / F2 Profile        |       |             | ⬜     |
| Phase 1 / F3 Events         |       |             | ⬜     |
| Phase 1 / F7a Admin CRUD    |       |             | ⬜     |
| Phase 1 / F4 Stripe tickets |       |             | ⬜     |
| Phase 1 / F5 Check-in       |       |             | ⬜     |
| Phase 1 / F6 Push           |       |             | ⬜     |
| Phase 1 / F4b Pix tickets   |       |             | ⬜     |
| Phase 2 / F8 Premium        |       |             | ⬜     |
| Phase 2 / F9 Feed           |       |             | ⬜     |
| Phase 2 / F10 Broadcasts    |       |             | ⬜     |
| Phase 3 / F11 DMs           |       |             | ⬜     |
| Phase 3 / F12 Voting        |       |             | ⬜     |

---

## Deferred items (carry-over from earlier phases)

Items that were in scope for a prior phase but were intentionally pushed out
because they were not on the critical path for the current feature chunk.
Each one still counts against the `[x]` gate — later phases can ship work
that depends on these, but the earlier task's checkbox cannot flip to `[x]`
until the deferred piece lands.

**Agents:** when you pick up work that lifts one of these, also flip the
originating checkbox above (one PR, one box, in the same merge).

### From Phase 0

- **0.9 EAS configuration** — deferred until the first real mobile build is
  needed (Chunk D / roadmap 1.10 onward).
- **0.12 Railway deploy (API + Postgres)** — ✅ landed. Railway prod live
  at `jdm-production.up.railway.app` as of 2026-05-02. F1.1–F1.6 flipped
  to `[x]`.
- **0.13 Vercel deploy (Admin)** — deferred until F7a admin work starts
  (roadmap 7.1+). Not on the critical path for F1–F6.
- **0.14 Secrets & env management** — partially done (`docs/secrets.md`
  covers auth secrets from chunk A). Full inventory still owed for Stripe,
  AbacatePay, R2, Sentry, Expo.
- **0.15 Sentry projects** — deferred. `sentryPlugin` hook exists in the
  API but no DSN wired; admin + mobile not wired at all.
- **0.16 README + CONTRIBUTING** — deferred until a new engineer actually
  needs to onboard.

### From Phase 1 — F1 Auth

- **1.7 Google sign-in (API)** — deferred to post-MVP. Email+password is
  sufficient for v0.1 release. Plan: `phase-1-f1-auth-plan.md` Task 16
  stays in the plan for later pickup; AuthProvider table already exists
  in the schema so the future implementation can start without a migration.
- **1.8 Apple sign-in (API)** — deferred to post-MVP. Same reasoning as 1.7.
  Plan: Task 17.
- **1.11 Mobile Google sign-in** — deferred, blocked on 1.7. Plan: Task 26.
- **1.12 Mobile Apple sign-in** — deferred, blocked on 1.8. Plan: Task 27.

No other phase has deferrals yet. When a later phase carries work forward,
add a `### From Phase N` subsection here with the same format.
