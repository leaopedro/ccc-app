# LGPD Compliance Assessment — JDM Experience

> **Date:** 2026-05-14
> **Scope:** monorepo `jdm-experience` (apps/mobile, apps/admin, apps/api, packages/db, packages/shared, infra/, .github/workflows)
> **Method:** read-only static analysis + Brazilian LGPD/ANPD primary-source research

---

## 1. Executive Summary

**Overall readiness rating:** **NOT READY FOR PRODUCTION LAUNCH IN BRAZIL.** Core compliance scaffolding is absent: no privacy policy, no consent capture beyond a single checkbox with dead links, no account-deletion or data-export endpoint, no records of processing, no published Encarregado, no DPA inventory, no breach-notification runbook, no cookie banner on the admin app.

**Top 10 risks (highest first):**

1. **No data subject rights (DSR) implementation.** No account deletion, data export, or correction beyond profile edit. LGPD Art. 18 mandates 9 rights with 15-day response. (CRITICAL)
2. **No Encarregado/DPO designation or public contact.** LGPD Art. 41 + ANPD Res. 18/2024 require designation and publication. (CRITICAL)
3. **No published privacy notice or cookie policy.** Mobile signup links to placeholder text only; admin and mobile both lack policy pages. LGPD Art. 9, Art. 6 (transparência). (CRITICAL)
4. **International transfers without ANPD standard contractual clauses.** Stripe, Sentry, Resend, Expo Push, Google/Apple OAuth, Vercel all process Brazilian personal data in the US. ANPD Res. 19/2024 SCC grace period ended ~Aug 2025. (CRITICAL)
5. **No incident response runbook tied to ANPD's 3-business-day clock.** Res. 15/2024 requires notification to ANPD and affected titulares with specified content. No template, no escalation path, no breach decision tree. (CRITICAL)
6. **No cookie consent banner on admin app.** ANPD Cookies Guide (updated 2025-01) requires granular opt-in with equal-prominence Reject. Sentry session replay loads without consent. (HIGH)
7. **No consent capture stored as evidence.** Single checkbox at signup with no record of version, timestamp, or purpose. Marketing push defaults `true` in `pushPrefs`. Cannot prove valid consent. (HIGH)
8. **No retention or deletion policy in DB.** No `deletedAt`/`anonymizedAt`, no TTL job for refresh tokens beyond `expiresAt`, no purge for `PaymentWebhookEvent`, no anonymization for old `Order.notes` or `ShippingAddress`. (HIGH)
9. **Sentry receives PII without `beforeSend` scrubbing on any of the three apps.** Error context routinely carries user IDs and request URLs; potentially emails and free-text. (HIGH)
10. **R2 CORS allows `https://*.vercel.app` wildcard.** Any Vercel-hosted attacker preview could initiate direct PUT/GET to bucket if a valid presigned URL is leaked or guessed. (MEDIUM-HIGH)

**Most urgent engineering changes (next 14 days):**

- Build `/me/account/delete` + `/me/data-export` endpoints + propagation jobs.
- Wire Encarregado contact placeholder into footer + privacy notice.
- Author and publish privacy notice + cookie policy (PT-BR), linked from mobile signup and admin login.
- Add `beforeSend` to all 3 Sentry inits — strip headers, query strings, request bodies, replace user.email with hash.
- Add cookie consent banner on admin app + gate Sentry init on consent.
- Convert `pushPrefs.marketing` default to `false` and add explicit opt-in flow.
- Add `Consent` table + per-event audit log.
- Tighten R2 CORS to known production + preview domain list (drop wildcard).

**Major legal/product decisions needed:**

- Confirm small-agent classification (ME/EPP/MEI/startup per Lei Complementar 182/2021 + ANPD Res. 2/2022). Eligibility doubles incident-notification deadlines and simplifies ROPA; does not exempt baseline obligations.
- Confirm minimum signup age (LGPD Art. 14 — children = <12 requires highlighted parental consent; adolescents 12-17 require best-interest evaluation).
- Confirm legal basis per processing activity (defaults proposed in §6 below; legitimate-interest claims require a balancing test/LIA per ANPD 2024 guide).
- Confirm Encarregado person + public email channel.
- Confirm DPA position with each vendor and whether to incorporate ANPD SCCs verbatim (Res. 19/2024 Anexo II).

**Counsel/DPO review required because:** legal basis assignments, balancing tests (LIA) for legitimate interest, retention periods per data category, privacy notice text, parental consent flow, and SCC contractual amendments are legal-product calls, not pure engineering.

---

## 2. Scope, Assumptions, and Methodology

**Repositories scanned:** single monorepo at `/Users/pedro/Projects/jdm-experience`.

**Components inspected:**

- `apps/mobile` — Expo React Native client (attendees)
- `apps/admin` — Next.js App Router (organizer web)
- `apps/api` — Fastify + Prisma backend
- `packages/db` — Prisma schema + migrations
- `packages/shared` — Zod schemas
- `infra/` — R2 CORS, Railway/Vercel config
- `.github/workflows/` — CI pipelines
- All `package.json`, `.env.example`, env-validation files, security plugins, logger configs, Sentry inits

**Tools used:** file/grep search via subagents, WebFetch on planalto.gov.br and gov.br/anpd.

**Limitations:**

- No access to running production env (no DB query, no Sentry dashboard, no Railway/Vercel console).
- No access to signed DPAs or vendor agreements outside the repo.
- No access to privacy notice drafts or current cookie policy if any exists outside repo.
- Vendor regions are inferred from defaults; the deployed Sentry org/Vercel project regions were not directly verified.

**Assumptions:**

- Target users are in Brazil; UI is PT-BR; LGPD applies fully (Art. 3 II).
- Controller = JDM Experience legal entity. Vendors classified as operators except where noted (Stripe, AbacatePay = independent controllers for payment compliance plus operators for the JDM purpose).
- Small-agent status is **assumed eligible** pending business confirmation; engineering plan assumes the doubled-deadline benefit but designs for full obligations to be safe.

---

## 3. Current Legal and Regulatory Baseline

The full legal requirements matrix appears in the Appendix. Load-bearing summary:

| Legal item                   | Source                         | Concrete number                                                                               |
| ---------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| Material + territorial scope | LGPD Art. 1, 3                 | Applies to BR-targeted services regardless of server location                                 |
| 10 principles                | LGPD Art. 6                    | All must be documentable                                                                      |
| Legal bases (ordinary)       | LGPD Art. 7                    | 10 hypotheses; one per processing op                                                          |
| Legal bases (sensitive)      | LGPD Art. 11                   | Stricter; separate UX for consent                                                             |
| Children                     | LGPD Art. 14                   | <12 needs parental consent, highlighted                                                       |
| DSR                          | LGPD Art. 18                   | 9 rights; 15-day default response (Art. 19, II)                                               |
| ROPA                         | LGPD Art. 37                   | Required for controller + operator                                                            |
| RIPD                         | LGPD Art. 38                   | Required for high-risk processing                                                             |
| Security TOMs                | LGPD Art. 46                   | Encryption, RBAC, MFA, logging, audit                                                         |
| Breach notification          | LGPD Art. 48 + Res. 15/2024    | **3 business days** to ANPD + titulares; **6** if small agent; records retained **≥ 5 years** |
| DPO/Encarregado              | LGPD Art. 41 + Res. 18/2024    | Publish identity + contact                                                                    |
| Intl. transfers              | LGPD Art. 33 + Res. 19/2024    | ANPD SCC mandatory text since ~Aug 2025                                                       |
| Cookies                      | ANPD Guia (updated 23/01/2025) | Granular opt-in, equal-weight Reject button                                                   |
| Sanctions                    | LGPD Art. 52 + Res. 4/2023     | Up to **2% BR revenue ex-tax, capped R$ 50M per infração**; DB suspension up to 6 months      |
| Small agents                 | ANPD Res. 2/2022               | Simplified ROPA, DPO not required, doubled deadlines                                          |
| Operator/vendor              | LGPD Art. 39, 42               | Joint civil liability; DPA mandatory                                                          |

Source bibliography is in §18 Appendix.

---

## 4. Application and Architecture Overview

**Stack:** TypeScript end-to-end. pnpm monorepo with Turborepo.

**Components:**

- `apps/api` — Fastify (Node 22), Prisma client, deployed on Railway. Region: **gru / São Paulo, Brazil**.
- `apps/admin` — Next.js 16 App Router, deployed on Vercel. Region: **US default** (no override in `vercel.json`).
- `apps/mobile` — Expo SDK 54, built via EAS Build. Distributed via App Store / Google Play.
- `packages/db` — Prisma 6 schema + migrations against PostgreSQL on Railway (BR region).
- `packages/shared` — Zod schemas shared between API, admin, mobile.

**Data stores:**

- Postgres on Railway (São Paulo) — primary application data.
- Cloudflare R2 — user-uploaded media (avatars, car photos, support attachments, event covers, product photos). Bucket region unspecified in repo.
- No Redis / Edge Config / KV currently. Push tokens stored in Postgres.

**External services (vendor table in §7).**

**Data flow summary:**

- Auth: email/password (Argon2 hash) or Google/Apple OAuth. JWT access + opaque refresh-token hash stored in `RefreshToken`.
- Tickets: Stripe (card/Apple Pay) or AbacatePay (Pix); webhook-driven status flip; idempotent via `(provider, providerRef)` + `PaymentWebhookEvent.eventId` unique constraints.
- Media: client presigns via `/uploads/presign`, PUTs directly to R2. Ownership encoded in object-key prefix; API validates ownership on attach.
- Push: device tokens registered on app launch; Expo Push delivers; `pushPrefs.marketing` (defaults `true`) controls non-transactional sends.
- Feed: posts/comments/reactions per event; `tryAuth` soft-auth for read; reads gate on `checkFeedReadAccess`.
- Admin: organizer/admin/staff roles via `UserRole`; `AdminAudit` logs admin actions.
- Errors: Sentry on all 3 apps; Pino logger on API with redaction list.

---

## 5. Personal Data Inventory

Compressed table. References point to `packages/db/prisma/schema.prisma` unless stated otherwise.

| Model                                                   | Fields (personal/sensitive)                                                                                                                               | Type                                                  | Notes                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| **User** (`:31-73`)                                     | `email`, `name`, `passwordHash`, `bio`, `city`, `stateCode`, `avatarObjectKey`, `status`, `emailVerifiedAt`, `pushPrefs (JSONB; marketing defaults true)` | PII core + credential                                 | No `deletedAt`/`anonymizedAt`                                       |
| **AuthProvider** (`:75-87`)                             | `provider` (google/apple), `providerUserId`                                                                                                               | external identity                                     | unique `(provider, providerUserId)`                                 |
| **RefreshToken** (`:89-101`)                            | `tokenHash`, `expiresAt`, `revokedAt`                                                                                                                     | credential                                            | TTL via `expiresAt` only; no purge job found                        |
| **VerificationToken** (`:103-114`)                      | `tokenHash`, `expiresAt`, `consumedAt`                                                                                                                    | credential                                            | as above                                                            |
| **PasswordResetToken** (`:116-127`)                     | `tokenHash`, `expiresAt`, `consumedAt`                                                                                                                    | credential                                            | as above                                                            |
| **DeviceToken** (`:694-706`)                            | `expoPushToken`, `platform`, `lastSeenAt`                                                                                                                 | device ID + push credential                           | no opt-out flag per device                                          |
| **Notification** (`:708-726`)                           | `kind`, `title`, `body`, `data (JSONB)`, `destination`, `dedupeKey`, `sentAt`, `readAt`                                                                   | content (may include PII)                             | indefinite retention                                                |
| **Broadcast / BroadcastDelivery** (`:818-860`)          | `targetKind` (incl. `city`), `targetValue`, `failureMessage`                                                                                              | targeting + delivery errors                           | admin audit via `createdByAdminId`                                  |
| **SupportTicket** (`:874-892`)                          | `phone`, `message`, `attachmentObjectKey`, internal status                                                                                                | PII + free text + media                               | no retention; may carry sensitive details                           |
| **Order** (`:498-551`)                                  | `providerRef`, `brCode`, `notes`, payment status, `amountCents`                                                                                           | payment + free text                                   | no purge after refund/cancel                                        |
| **ShippingAddress** (`:440-460`)                        | `recipientName`, `line1`, `line2`, `number`, `district`, `city`, `stateCode`, `postalCode`, `phone`                                                       | postal address PII                                    | retained indefinitely                                               |
| **PaymentWebhookEvent** (`:678-687`)                    | `payload (JSONB)` (full provider payload incl. customer info)                                                                                             | financial PII                                         | no purge; indexed on `createdAt` only                               |
| **Ticket** (`:567-594`)                                 | `userId`, `eventId`, `carId`, `licensePlate`, `nickname`, `status`, `usedAt`                                                                              | vehicle PII (plate) + attendance                      | no anonymization on event-past                                      |
| **Car** + **CarPhoto** (`:129-163`)                     | `make`, `model`, `year`, `nickname`, `objectKey`                                                                                                          | vehicle data + photos                                 | retained until user deletes (no UI for deletion of photos in admin) |
| **AdminAudit** (`:263-275`)                             | `actorId`, `action`, `entityType`, `entityId`, `metadata (JSONB)`                                                                                         | admin trail; may contain user data                    | no retention defined                                                |
| **FeedPost / FeedComment / FeedReaction** (`:952-1028`) | `authorUserId`, `body`, `status`, moderation actor                                                                                                        | UGC; may contain PII or sensitive personal statements | hidden/removed = soft mark only                                     |
| **Report** (`:1030-1053`)                               | `reason`, `resolverId`, `resolution`                                                                                                                      | allegations (potentially sensitive)                   | retained indefinitely                                               |
| **FeedBan** (`:934-950`)                                | `userId`, `eventId`, `reason`, `bannedById`                                                                                                               | enforcement record                                    | retained indefinitely                                               |

**Categories present:**

- Identity: name, email, password hash, OAuth identity, IP (in logs)
- Postal address: full BR address
- Payment: indirectly via Stripe/AbacatePay (no card data stored in DB)
- Vehicle: make, model, year, licensePlate, photos
- Device: Expo push token, platform
- Behavioral/content: posts, comments, reactions, support messages
- Geolocation (low-precision): `city`, `stateCode`, broadcast city-targeting
- Authentication credentials: hashes only

**Categories absent (good):** CPF, RG, DOB, full GPS coordinates, biometric, health, racial, political, union, sex life, children-flagged data. Children may still be in system if minors sign up without an age gate — must be verified.

**Sensitive data flag:** Free-text fields (`bio`, `Notification.data`, `SupportTicket.message`, `Order.notes`, `FeedPost.body`, `FeedComment.body`, `Report.reason`) may incidentally contain LGPD Art. 11 sensitive data even though the schema does not require it. Treat free-text as elevated-risk content.

---

## 6. Processing Activities and Legal Basis Mapping

> Proposed legal bases. Counsel must confirm before launch.

| Activity                            | Purpose                   | Data categories                    | Proposed legal basis                                      | Confidence | Required action                                |
| ----------------------------------- | ------------------------- | ---------------------------------- | --------------------------------------------------------- | ---------- | ---------------------------------------------- |
| Signup + authentication             | Provide account + service | email, name, password hash         | Art. 7, V — contract execution                            | High       | Privacy notice disclosure                      |
| Email verification + password reset | Account security          | email, token                       | Art. 7, II — legal obligation (security; Art. 46)         | Medium     | Note in privacy notice                         |
| OAuth (Google/Apple)                | Sign-in option            | email, OAuth ID                    | Art. 7, V — contract execution                            | High       | Privacy notice; vendor DPA                     |
| Ticket purchase (Stripe)            | Service delivery          | payment status, order ref, billing | Art. 7, V — contract                                      | High       | DPA + SCC for Stripe                           |
| Ticket purchase (AbacatePay/Pix)    | Service delivery          | payment status, order ref          | Art. 7, V — contract                                      | High       | DPA review                                     |
| Premium membership recurrence       | Service delivery          | subscription data                  | Art. 7, V — contract                                      | High       | Privacy notice                                 |
| Ticket QR signing                   | Anti-fraud                | ticket id, user id, hmac           | Art. 7, IX — legitimate interest (anti-fraud)             | High       | LIA required                                   |
| Event check-in (`usedAt`)           | Attendance audit          | timestamp                          | Art. 7, V — contract                                      | High       | Privacy notice                                 |
| Car/garage data                     | Service personalization   | make/model/plate/photos            | Art. 7, V — contract                                      | Medium     | Plate may be regulated locally; privacy notice |
| Push notifications — transactional  | Service operation         | device token, message              | Art. 7, V — contract                                      | High       | Privacy notice                                 |
| Push notifications — marketing      | Promotion                 | device token, message              | Art. 7, I — consent                                       | High       | **Re-collect consent; default OFF**            |
| Email — transactional (Resend)      | Service                   | email                              | Art. 7, V — contract                                      | High       | DPA + SCC                                      |
| Email — marketing                   | Promotion                 | email                              | Art. 7, I — consent                                       | High       | **Build opt-in**                               |
| Feed posts / comments / reactions   | Community feature         | UGC                                | Art. 7, V — contract                                      | Medium     | Moderation rights + LIA for moderation         |
| Reports + bans                      | Safety/moderation         | reason, reporter, target           | Art. 7, IX — legitimate interest (safety)                 | High       | LIA required                                   |
| Support tickets                     | Customer service          | phone, message, attachment         | Art. 7, V — contract                                      | High       | Retention policy                               |
| Admin audit log                     | Accountability            | actor, action, metadata            | Art. 7, II — legal obligation (Art. 37) + Art. 7, IX — LI | High       | Retention policy                               |
| Error tracking (Sentry)             | Service stability         | error context, partial PII         | Art. 7, IX — legitimate interest                          | Medium     | **LIA + beforeSend scrubbing**                 |
| Analytics (currently none)          | n/a                       | n/a                                | n/a                                                       | n/a        | If added, consent gated                        |
| Broadcast targeting by city         | Marketing/operational     | city                               | Art. 7, IX (operational) or I (marketing)                 | Low        | Disambiguate; consent if marketing             |
| Backup retention                    | Disaster recovery         | full DB                            | Art. 7, II — legal obligation (Art. 46 security)          | High       | Retention period documentation                 |

---

## 7. Third Parties, Vendors, and International Transfers

| Vendor                       | Purpose                   | Used by            | Region                   | Data sent                               | Role                              | DPA in repo?                  | Transfer mechanism needed                     |
| ---------------------------- | ------------------------- | ------------------ | ------------------------ | --------------------------------------- | --------------------------------- | ----------------------------- | --------------------------------------------- |
| Stripe                       | Card/Apple Pay processing | api                | **US**                   | name, email, order total, IP            | Independent controller + operator | No                            | ANPD SCC or Stripe BR entity                  |
| AbacatePay                   | Pix processing            | api                | **BR**                   | name, email, order total                | Operator                          | No                            | None (domestic); confirm DPA                  |
| Cloudflare R2                | Object storage            | api, admin, mobile | **Global / unspecified** | user files, metadata                    | Operator                          | No                            | ANPD SCC; confirm region lock                 |
| Sentry                       | Error tracking            | api, admin, mobile | **US**                   | error traces, request meta, partial PII | Operator                          | No                            | ANPD SCC                                      |
| Resend                       | Transactional email       | api                | **US**                   | recipient email, code, name             | Operator                          | No                            | ANPD SCC                                      |
| Expo Push                    | Push delivery             | api                | **US**                   | device token, message body              | Operator                          | No                            | ANPD SCC                                      |
| Google OAuth                 | Sign-in                   | api, mobile, admin | **US**                   | name, email, Google sub                 | Independent controller            | No (terms accepted on signup) | ANPD SCC or Art. 33, VIII consent             |
| Apple Sign In                | Sign-in                   | api, mobile        | **US**                   | email, Apple sub                        | Independent controller            | No                            | ANPD SCC or Art. 33, VIII consent             |
| Railway (Postgres + compute) | API + DB hosting          | api                | **BR (gru)**             | All app data                            | Operator                          | Partial (docs only)           | None for DB; SCC for any non-BR Railway infra |
| Vercel                       | Admin hosting             | admin              | **US default**           | server session, admin auth state        | Operator                          | No                            | ANPD SCC; consider EU/BR region               |
| EAS Build                    | Mobile build              | mobile             | **US**                   | source code, signing certs              | Operator                          | No (terms only)               | ANPD SCC                                      |
| GitHub Actions               | CI                        | infra              | **US**                   | source code, test data                  | Operator                          | No (terms only)               | ANPD SCC                                      |

**Transfer surface:** 9 of 12 vendors process Brazilian personal data in the US. ANPD Res. 19/2024 Anexo II SCC text must be incorporated by reference into every DPA, or another Art. 33 mechanism applied.

---

## 8. Data Subject Rights Readiness

| Right (LGPD Art. 18)                                                              | Current support                             | Gap                                           | Required change                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| Confirmation of processing                                                        | None                                        | No endpoint, no UI                            | Build self-service portal entry                   |
| Access                                                                            | Partial (`/me` only)                        | Cannot retrieve everything stored             | Add `/me/data-export`                             |
| Correction                                                                        | Partial (`/me PATCH` for profile fields)    | No email change, no support-ticket correction | Add `/me/email-change`, add admin-correction tool |
| Anonymization / blocking / deletion of unnecessary, excessive, non-compliant data | None                                        | No endpoint                                   | Build admin tool tied to ROPA review              |
| Portability                                                                       | None                                        | No structured export                          | JSON + CSV export with documented schema          |
| Deletion of consent-based data                                                    | None                                        | Cannot withdraw marketing data                | Add per-purpose deletion                          |
| Information about sharing                                                         | None                                        | No notice mechanism                           | Privacy notice + on-demand list of vendors        |
| Information about consequences of refusing consent                                | None                                        | No copy                                       | Privacy notice                                    |
| Consent revocation                                                                | Partial (`pushPrefs.marketing` toggle only) | No history, no broader revocation flow        | Build `Consent` table + revocation event          |
| Account deletion                                                                  | None                                        | No endpoint                                   | Build `/me/account/delete` with propagation       |
| Petition to ANPD                                                                  | n/a                                         | Not a tech requirement                        | Include link in privacy notice                    |
| Review of automated decisions                                                     | n/a                                         | None used today                               | If profiling added later, build review            |

**Response SLA:** LGPD Art. 19 II requires 15-day response by default. Build SLA tracking from request creation.

---

## 9. Consent, Cookies, Tracking, and Profiling

**Current behavior:**

- Mobile signup: single checkbox `"Aceito os Termos e Política de privacidade"` with **dead links** (`apps/mobile/src/copy/auth.ts:51`). No granular consent. No marketing-specific opt-in.
- Admin: no cookie banner. No consent management UI.
- Sentry initializes unconditionally on all 3 apps. Session-level data captured before consent.
- Push: `User.pushPrefs.marketing` defaults `true` (`packages/db/prisma/schema.prisma`). Treated as opt-out by design, not opt-in. ANPD considers default-on marketing invalid consent.
- Analytics SDKs: **none currently installed.** Good baseline. Re-evaluate if Mixpanel/GA/Segment is added.

**Gaps:**

1. No privacy policy / cookie policy pages reachable from app UI.
2. Marketing push consent invalid by default.
3. No record of consent event (timestamp, version of policy, user ID, purpose, channel).
4. No granular cookie categories in admin app.
5. No equal-prominence Reject button (no banner exists).
6. Sentry session data captured pre-consent on admin.

**Required changes:**

- Publish PT-BR privacy notice + cookie policy (versioned).
- Add cookie banner to admin (granular categories: strict-necessary, functional, analytics, marketing). Equal-weight Accept / Reject. Persist to localStorage + server-side consent table for logged-in users.
- Gate Sentry init on consent (or rely on strict-necessary classification if `beforeSend` strips all PII).
- Add `Consent` model in Prisma: `id`, `userId`, `purpose`, `version`, `givenAt`, `withdrawnAt`, `channel` (web, mobile, email), `evidence` (JSONB: IP, UA, snapshot of UI text).
- Default `pushPrefs.marketing = false`; collect explicit opt-in via dedicated screen.
- Add per-purpose consent for sensitive future flows (newsletter, partners, profiling).

---

## 10. Retention, Deletion, and Anonymization

**Current behavior:**

- No `deletedAt`/`anonymizedAt` markers anywhere.
- Refresh, verification, password-reset tokens have `expiresAt` but no purge job in repo.
- `PaymentWebhookEvent.payload` retained indefinitely.
- `Order.notes`, `ShippingAddress`, `SupportTicket.attachmentObjectKey`, `CarPhoto.objectKey`, `Notification.body` all retained indefinitely.
- R2 objects: no lifecycle policy referenced in `infra/r2-cors.json`; bucket lifecycle not in repo.
- Postgres backups: Railway Hobby = 7 days; Pro = 30 days + PITR (per `docs/railway.md` per investigator). Backups inherit DB content; user deletion must be acknowledged in backup retention window.

**Gaps:**

1. No retention policy document.
2. No technical TTL/purge for expired tokens, expired orders, old webhook events, support attachments past resolution + N days.
3. Account deletion = cascade delete vs anonymize unclear; nothing implemented.
4. No legal-hold mechanism.
5. R2 lifecycle (e.g., delete soft-deleted user content after 30 days) absent.

**Required changes:**

- Retention policy table per model with legal basis for the period:

| Model                                 | Retention                                                                                                                   | Rationale                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| User (active)                         | While account active                                                                                                        | Contract                                   |
| User (deletion request)               | Anonymize immediately for identity fields; preserve order/audit minimum for fiscal/regulatory (e.g., 5y for fiscal records) | Art. 16 LGPD + tax law                     |
| RefreshToken                          | Delete after `expiresAt + 7d`                                                                                               | Security                                   |
| Verification/PasswordReset token      | Delete after `expiresAt`                                                                                                    | Security                                   |
| PaymentWebhookEvent                   | 90 days unless dispute pending                                                                                              | Idempotency window                         |
| Order                                 | 5 years from purchase (fiscal)                                                                                              | Tax law                                    |
| ShippingAddress                       | While referenced by undelivered orders + 1y; else delete with user                                                          | Contract                                   |
| SupportTicket                         | 3 years from closure                                                                                                        | Service quality + dispute                  |
| Notification                          | 90 days                                                                                                                     | Operational                                |
| BroadcastDelivery                     | 1 year                                                                                                                      | Operational                                |
| AdminAudit                            | 5 years                                                                                                                     | Accountability (Art. 37)                   |
| FeedPost / FeedComment / FeedReaction | While account active; on deletion → anonymize author                                                                        | UGC retention                              |
| Report                                | 2 years from resolution                                                                                                     | Safety record                              |
| FeedBan                               | While in effect + 1 year                                                                                                    | Safety record                              |
| R2 objects (avatars, car photos)      | Delete on account deletion                                                                                                  | Contract                                   |
| Postgres backups                      | Per provider plan (7-30d)                                                                                                   | DR; covered by retention policy disclosure |

- Add nightly purge job for expired tokens, expired webhook events, soft-deleted users past retention window.
- Add R2 object lifecycle on the bucket (Cloudflare config) to delete orphaned uploads after 24h and to delete account-deletion-marked objects after the retention window.
- Document backup-window deletion lag in privacy notice.

---

## 11. Security and Incident Response

**Current controls (good):**

- Argon2 (assumed; verify against `apps/api/src/services/auth/`) for password hashes.
- Refresh-token rotation; revocation on password reset.
- Disabled-account check in `authenticate` plugin.
- Rate limits on `/auth/*` (10/min), `/me/support-tickets` (5/15min), `/me/push-preferences` (10/min), `/abacatepay/webhook` (20/min).
- Stripe + AbacatePay signature verification; `timingSafeEqual` for URL secret on AbacatePay.
- Idempotent webhooks (unique `(provider, providerRef)` + `PaymentWebhookEvent.eventId`).
- Security headers plugin: `nosniff`, `DENY frame`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `HSTS max-age=63072000; includeSubDomains; preload`.
- Pino redact list: `authorization`, `cookie`, `x-webhook-signature`, `*.password`, `*.token`.
- Tokens in `SecureStore` (mobile) / HTTP-only cookies (admin).
- No committed secrets detected.
- DB region in Brazil (Railway gru).

**Gaps:**

1. **`tryAuth` does not check disabled status** (`apps/api/src/plugins/auth.ts:78`). Disabled users remain readable on feed soft-auth.
2. **Comments-list route `tryAuth` has no explicit access control** beyond relying on `checkFeedReadAccess` on the post — confirm callers always run that check.
3. **No CSP** on admin or API. Sentry session replay loads scripts; PR previews on Vercel inherit Vercel domain.
4. **R2 CORS wildcard** `https://*.vercel.app`.
5. **No `Sentry.beforeSend`** scrubbing on any app. PII leaks: request URLs may contain ids; breadcrumb console may include user content.
6. **Encryption-at-rest for Postgres** depends on Railway default; not documented.
7. **No audit-log query endpoint** for admins (recordAudit writes only).
8. **No MFA for admin/staff users.** Role is enforced but high-privilege accounts share same password+JWT path.
9. **No CSRF defense documented** for admin (Next.js Server Actions inherit some protections; cookie-based admin still needs SameSite + origin check).
10. **No `Vary: Origin`** explicitly documented in CORS.
11. **No formal IR plan** — no runbook tied to ANPD Res. 15/2024 (3 business days), no CIS template, no internal escalation matrix, no decision tree for "risco ou dano relevante."
12. **No backup-restore rehearsal cadence** beyond a one-off entry (per investigator: docs/railway.md mentions a single rehearsal 2026-05-01).
13. **No dependency scanning** in CI; no `pnpm audit` step visible.

**Required IR changes (load-bearing):**

- Author `docs/incident-response.md`: triage flow, 3-business-day clock, decision tree, ANPD CIS portal link, titular notification template (PT-BR), internal escalation roles (encarregado, sec lead, eng on-call, legal).
- Add incident table in DB: `Incident { id, detectedAt, classifiedAt, severity, scope, affectedUserCount, notifiedAnpdAt, notifiedTitularesAt, status, evidenceObjectKey, supplementaryDueAt }`.
- Tabletop exercise quarterly.
- Retain incident records ≥ 5 years (Res. 15/2024).

---

## 12. Children, Sensitive Data, High-Risk Processing, and RIPD

**Children/adolescents (LGPD Art. 14):**

- No age gate at signup (`apps/mobile/app/(auth)/signup.tsx:29-45`).
- No parental consent flow.
- Car-event domain suggests adult audience, but no enforcement.
- **Action:** Add minimum-age field at signup or self-declared age gate. If business model permits under-18 attendees, design parental-consent flow.

**Sensitive data (LGPD Art. 11):**

- Schema does not require any sensitive category, but free-text fields can incidentally contain it.
- **Action:** Discourage sensitive disclosures in `bio`, `SupportTicket.message`, `Report.reason` via UI hint; do not log full body in Sentry.

**High-risk processing:**

- Large-scale (membership + events; could exceed thousands of users).
- Financial data via two payment providers.
- Vehicle data (plate may be cross-referenced for vehicle owner identification).
- Push targeting by city.
- Admin moderation actions on UGC.

**RIPD recommendation:**

- Produce a single RIPD covering: payment flows, feed/UGC moderation, broadcast targeting by city, push-notification marketing. Refresh annually.
- Future RIPDs required for: any future ML/profiling, biometric ticket validation, partner-data sharing.

---

## 13. Governance and Accountability

**Encarregado / DPO:**

- Not designated in any artifact in the repo.
- **Action:** Designate person; publish name + email + postal address in privacy notice and admin/mobile footer. Per ANPD Res. 18/2024, must be reachable by titulares and ANPD; document conflict-of-interest screening; small-agent option does not require designation but a contact channel is still useful.

**Records of processing (ROPA):**

- Absent. Use the table in §6 as the seed for a versioned `docs/ropa.md` with: activity, purpose, data categories, titular categories, legal basis, recipients, transfers, retention, security measures, owner.

**Policies (to author):**

- Privacy notice (titular-facing).
- Cookie policy.
- Internal data classification + handling policy.
- Retention policy.
- Incident response plan.
- Access management policy.
- Vendor management policy.
- Training plan.

**Training:**

- All engineers + admins + customer-support staff must complete LGPD basics + IR-runbook walkthrough annually.

**Vendor management:**

- Maintain `docs/vendor-register.md` with the columns in §7 + DPA status + last review date.

**Audit evidence:**

- Use `AdminAudit` + new `Consent` + new `Incident` + new `DataSubjectRequest` models as evidence trail. Surface via admin tooling with read-only query endpoints.

---

## 14. Gap Analysis

| Gap ID | Requirement / control                         | Current behavior                               | Evidence                                      | Risk        | LGPD/ANPD basis                | Recommended remediation                                              |
| ------ | --------------------------------------------- | ---------------------------------------------- | --------------------------------------------- | ----------- | ------------------------------ | -------------------------------------------------------------------- |
| G01    | Account deletion endpoint                     | Absent                                         | `apps/api/src/routes/me/*` no delete          | Critical    | Art. 18, VI                    | Build `/me/account/delete`                                           |
| G02    | Data export endpoint                          | Absent                                         | as above                                      | Critical    | Art. 18, V; II                 | Build `/me/data-export`                                              |
| G03    | Email correction endpoint                     | Absent                                         | as above                                      | High        | Art. 18, III                   | Build `/me/email-change` with reverification                         |
| G04    | Encarregado designation + public contact      | Absent                                         | no doc / footer                               | Critical    | Art. 41 + Res. 18/2024         | Designate + publish                                                  |
| G05    | Privacy notice                                | Absent                                         | `apps/mobile/src/copy/auth.ts:51` placeholder | Critical    | Art. 9                         | Author + publish PT-BR                                               |
| G06    | Cookie policy + banner                        | Absent                                         | admin app, no banner                          | Critical    | ANPD Cookies Guide v2025       | Build banner + policy                                                |
| G07    | Consent record (storage + history)            | Absent                                         | no `Consent` model                            | High        | Art. 8, §1; Art. 50            | Add `Consent` table                                                  |
| G08    | Marketing-push default off                    | Default true                                   | `schema.prisma:User.pushPrefs`                | High        | Art. 8                         | Flip default; collect opt-in                                         |
| G09    | International transfer mechanism              | None                                           | no DPAs, no SCCs                              | Critical    | Art. 33; Res. 19/2024          | Adopt ANPD SCCs vendor-by-vendor                                     |
| G10    | Incident response runbook tied to 3-day clock | Absent                                         | no `docs/incident-response.md`                | Critical    | Art. 48 + Res. 15/2024         | Author + Incident table + escalation matrix                          |
| G11    | Records of processing (ROPA)                  | Absent                                         | not in repo                                   | High        | Art. 37                        | Author `docs/ropa.md`                                                |
| G12    | RIPD                                          | Absent                                         | not in repo                                   | High        | Art. 38                        | Produce per §12                                                      |
| G13    | Retention policy + purge jobs                 | Absent                                         | no schedule, no markers                       | High        | Art. 16                        | Define policy + cron purges                                          |
| G14    | Sentry PII scrubbing                          | None                                           | no `beforeSend`                               | High        | Art. 46 + LI safeguards        | Add `beforeSend` on all 3 apps                                       |
| G15    | `tryAuth` disabled-account check              | Missing                                        | `plugins/auth.ts:78`                          | High        | Art. 46; security              | Mirror `authenticate` check                                          |
| G16    | Feed comments-list access control             | Implicit only                                  | `routes/feed.ts:368`                          | Medium      | Art. 6 + 46                    | Explicit gate via `checkFeedReadAccess` on the parent post           |
| G17    | Admin MFA                                     | Absent                                         | no flow                                       | High        | Art. 46                        | Add TOTP for organizer/admin/staff                                   |
| G18    | CSP header                                    | Absent                                         | `plugins/security-headers.ts` no CSP          | Medium      | Art. 46                        | Define CSP for admin + API                                           |
| G19    | R2 CORS wildcard                              | `*.vercel.app` allowed                         | `infra/r2-cors.json`                          | Medium-High | Art. 46                        | Pin to known domains; manage preview hostnames via allow list update |
| G20    | Children flow / age gate                      | Absent                                         | signup form                                   | High        | Art. 14                        | Add age field + parental flow if needed                              |
| G21    | Dependency vulnerability scanning             | Absent                                         | no CI step                                    | Medium      | Art. 46                        | Add `pnpm audit` + Snyk/Dependabot                                   |
| G22    | Backup-rehearsal cadence                      | One-off                                        | `docs/railway.md`                             | Medium      | Art. 46                        | Quarterly rehearsal; document                                        |
| G23    | Vendor register / DPA tracker                 | Absent                                         | not in repo                                   | High        | Art. 39, 42                    | Author + assign owner                                                |
| G24    | Training program                              | Absent                                         | none                                          | Medium      | Art. 50; dosimetria attenuator | Annual program                                                       |
| G25    | DSR portal + SLA tracking                     | Absent                                         | none                                          | High        | Art. 18, 19                    | Build endpoints + admin tool                                         |
| G26    | Free-text PII flagging                        | None                                           | `bio`, `SupportTicket.message`, etc.          | Low-Medium  | Art. 11                        | UI hint + no full-body Sentry breadcrumb                             |
| G27    | Postgres encryption-at-rest evidence          | Undocumented                                   | n/a                                           | Low         | Art. 46                        | Document Railway default + key management                            |
| G28    | Push token revocation on logout               | Verified per route                             | OK                                            | n/a         | n/a                            | None                                                                 |
| G29    | Rate-limit coverage gaps                      | `/me/orders/:id/cancel`, feed POST not limited | `routes/*`                                    | Medium      | Art. 46                        | Add rate limits                                                      |
| G30    | Admin audit query endpoint                    | Absent                                         | `recordAudit` writes only                     | Medium      | Art. 37                        | Add read endpoint with RBAC                                          |

---

## 15. Prioritized Remediation Backlog

Effort: S ≤ 1d, M ≤ 3d, L ≤ 1w, XL > 1w. Owner key: BE = backend, FE-A = admin, FE-M = mobile, SEC = security, LEG = legal/counsel, DPO = encarregado, PROD = product, DEV = devops, DAT = data.

### Bucket A — Immediate risk reduction (0-2 weeks, P0/P1)

| Task | Title                                                                                                      | Risk        | Priority | Affected                                               | Owner                    | Effort | Acceptance                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------- | ----------- | -------- | ------------------------------------------------------ | ------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| T01  | Add `Sentry.beforeSend` PII scrubbing on api/admin/mobile                                                  | High        | P0       | `apps/*/sentry.*.ts`                                   | SEC + BE + FE-A + FE-M   | M      | No emails, no auth headers, no request bodies in Sentry events; test with intentional error |
| T02  | Fix `tryAuth` to check disabled status                                                                     | High        | P0       | `apps/api/src/plugins/auth.ts:78`                      | BE                       | S      | Unit test: disabled user calling tryAuth-route gets unauth                                  |
| T03  | Tighten R2 CORS — drop `*.vercel.app` wildcard                                                             | Medium-High | P0       | `infra/r2-cors.json`                                   | DEV + SEC                | S      | Apply via wrangler; explicit allowed preview list                                           |
| T04  | Flip `User.pushPrefs.marketing` default to `false` + migrate existing rows to `false` for new consent      | High        | P0       | `packages/db/prisma/schema.prisma`, migration          | BE + LEG                 | M      | New users opt-in only; existing users prompted in-app                                       |
| T05  | Draft + publish PT-BR privacy notice + cookie policy                                                       | Critical    | P0       | new `apps/admin/app/(public)/privacy/*`, mobile screen | LEG + PROD + FE-A + FE-M | L      | Linked from mobile signup + admin login + footer                                            |
| T06  | Designate Encarregado; publish contact in policy + footer                                                  | Critical    | P0       | `docs/encarregado.md`, footer components               | DPO + LEG                | S      | Email channel live; doc signed                                                              |
| T07  | Author `docs/incident-response.md` + 3-business-day runbook                                                | Critical    | P0       | `docs/incident-response.md`                            | SEC + LEG + DPO          | M      | Tabletop scheduled                                                                          |
| T08  | Vendor register + DPA status spreadsheet                                                                   | High        | P1       | `docs/vendor-register.md`                              | LEG + DEV                | M      | All 12 vendors listed; SCC owner per row                                                    |
| T09  | Adopt ANPD SCC text where missing (Stripe, Sentry, Resend, Expo, Vercel, EAS, GitHub, R2, OAuth providers) | Critical    | P1       | external                                               | LEG                      | XL     | Each vendor confirmed (paper or via portal)                                                 |

### Bucket B — Core compliance implementation (2-6 weeks, P1)

| Task | Title                                                                                                                    | Risk        | Priority | Affected                                                 | Owner            | Effort | Acceptance                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ----------- | -------- | -------------------------------------------------------- | ---------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| T10  | `Consent` model + service + admin tool                                                                                   | High        | P1       | `packages/db`, `apps/api/src/services/consent`, admin UI | BE + DAT + FE-A  | M      | Every consent event recorded with version, IP, UA, purpose                                                     |
| T11  | Cookie banner on admin (granular + equal-weight Reject)                                                                  | Critical    | P1       | `apps/admin/app/layout.tsx`, new component               | FE-A + LEG       | M      | Lighthouse + manual review; consent persisted server-side for logged users                                     |
| T12  | Gate Sentry init on consent in admin (or rely on strict-necessary classification once `beforeSend` is provably PII-free) | High        | P1       | admin sentry configs                                     | FE-A + SEC       | S      | Sentry not initialized before consent or before PII-safe init confirmed                                        |
| T13  | `/me/account/delete` endpoint + propagation job                                                                          | Critical    | P1       | `apps/api/src/routes/me/account.ts`, new worker          | BE + DAT         | L      | E2E test: user deletes; profile anonymized; R2 objects removed; vendor (Sentry, Resend) deletion fanout queued |
| T14  | `/me/data-export` endpoint (JSON + CSV)                                                                                  | Critical    | P1       | `apps/api/src/routes/me/data-export.ts`, new worker      | BE + DAT         | L      | Export includes user + cars + tickets + orders + addresses + support + feed; schema documented                 |
| T15  | `/me/email-change` with reverification                                                                                   | High        | P1       | `apps/api/src/routes/me/email.ts`                        | BE + FE-M + FE-A | M      | New email verified before swap; old email notified                                                             |
| T16  | DSR admin tool — intake, identity check, SLA, history                                                                    | High        | P1       | new admin section + `DataSubjectRequest` model           | BE + FE-A        | L      | SLA visible; 15-day countdown; audit per action                                                                |
| T17  | Retention policy + nightly purge job                                                                                     | High        | P1       | new worker, `RetentionPolicy` doc                        | BE + DAT         | L      | Cron deletes per §10 table; logs purge counts                                                                  |
| T18  | Add `deletedAt`/`anonymizedAt` markers + `User.status` extension                                                         | High        | P1       | schema migrations                                        | BE + DAT         | M      | Backfilled; soft-delete behavior consistent across queries                                                     |
| T19  | R2 object lifecycle (24h orphan purge + post-deletion sweep)                                                             | Medium-High | P1       | Cloudflare config + worker                               | DEV + BE         | M      | Verified via test object                                                                                       |
| T20  | Marketing-push opt-in screen (mobile) + bulk re-consent for existing users                                               | High        | P1       | `apps/mobile/app/(authed)/notifications/...`             | FE-M + PROD      | M      | All sends gated on consent record                                                                              |
| T21  | Age field at signup + adolescent/child flow decision                                                                     | High        | P1       | mobile + api signup                                      | FE-M + BE + LEG  | M      | Self-declared DOB; under-12 path defined (block or parental flow)                                              |
| T22  | ROPA `docs/ropa.md` (machine-friendly markdown table)                                                                    | High        | P1       | new doc                                                  | DPO + BE         | M      | Reviewed by counsel                                                                                            |
| T23  | RIPD for payments + UGC moderation + city-targeted broadcast + marketing push                                            | High        | P1       | new doc                                                  | DPO + LEG        | L      | Owner sign-off                                                                                                 |

### Bucket C — Governance, documentation, vendor work (1-3 months, P2)

| Task | Title                                                             | Risk       | Priority | Affected                    | Owner           | Effort |
| ---- | ----------------------------------------------------------------- | ---------- | -------- | --------------------------- | --------------- | ------ |
| T24  | Admin MFA (TOTP) for organizer/admin/staff                        | High       | P2       | api + admin                 | BE + FE-A + SEC | L      |
| T25  | CSP header for admin + API responses                              | Medium     | P2       | next config, fastify plugin | SEC + FE-A      | M      |
| T26  | Dependency scanning in CI (`pnpm audit --json`, Dependabot, Snyk) | Medium     | P2       | `.github/workflows`         | DEV + SEC       | S      |
| T27  | Quarterly backup-restore rehearsal calendarized                   | Medium     | P2       | `docs/railway.md`           | DEV             | S      |
| T28  | Vendor management policy + annual review                          | Medium     | P2       | new doc                     | LEG + DEV       | M      |
| T29  | Access management policy + RBAC review                            | Medium     | P2       | new doc + audit             | SEC + BE        | M      |
| T30  | Annual LGPD training plan for staff                               | Medium     | P2       | new policy                  | DPO + LEG       | M      |
| T31  | Admin audit query endpoint + UI                                   | Medium     | P2       | api + admin                 | BE + FE-A       | M      |
| T32  | Rate-limit coverage gaps (`/me/orders/:id/cancel`, feed POST)     | Medium     | P2       | api                         | BE              | S      |
| T33  | Free-text PII UI hints + body truncation in Sentry breadcrumbs    | Low-Medium | P2       | mobile + admin              | FE-M + FE-A     | S      |
| T34  | Internal data classification + handling policy                    | Medium     | P2       | new doc                     | SEC + LEG       | M      |
| T35  | Document Postgres encryption-at-rest + key management             | Low        | P2       | `docs/security.md`          | DEV + SEC       | S      |
| T36  | LIA (balancing tests) for each legitimate-interest activity in §6 | High       | P2       | new doc                     | LEG + DPO       | M      |

### Bucket D — Privacy engineering maturity (> 3 months, P3)

| Task | Title                                                                                  | Priority | Effort |
| ---- | -------------------------------------------------------------------------------------- | -------- | ------ |
| T37  | Field-level encryption for `SupportTicket.message`, `Order.notes`                      | P3       | L      |
| T38  | Tokenized data warehouse for analytics (when added)                                    | P3       | XL     |
| T39  | Pseudonymization-by-default in non-prod environments                                   | P3       | L      |
| T40  | Differential privacy / k-anonymity layer for any future analytics export               | P3       | XL     |
| T41  | Move admin hosting region to BR (Vercel BR/EU, or self-host)                           | P3       | L      |
| T42  | Pin R2 bucket to a documented region (BR-region requires verification or alt provider) | P3       | M      |
| T43  | Penetration test before public launch                                                  | P3       | L      |
| T44  | Bug-bounty program                                                                     | P3       | M      |

---

## 16. Implementation Specifications

### A. Consent + Preference Management (covers T10–T12, T20)

**Model:**

```prisma
model Consent {
  id          String       @id @default(cuid())
  userId      String?
  purpose     ConsentPurpose
  version     String       // e.g., "privacy-2026-05-14"
  givenAt     DateTime     @default(now())
  withdrawnAt DateTime?
  channel     ConsentChannel
  ipAddress   String?
  userAgent   String?
  evidence    Json         // snapshot of UI text + checkbox state
  user        User?        @relation(fields: [userId], references: [id], onDelete: SetNull)
  @@index([userId, purpose])
  @@index([purpose, version])
}
enum ConsentPurpose {
  privacy_notice
  cookies_analytics
  cookies_marketing
  push_marketing
  email_marketing
  newsletter
}
enum ConsentChannel { web_admin web_public mobile email }
```

**Backend:**

- `POST /me/consents` — record consent event; idempotent on `(userId, purpose, version)`.
- `DELETE /me/consents/:purpose` — withdraw; write `withdrawnAt`; downstream side effects (e.g., remove from Resend audience).
- Server-enforced gates: marketing-push send checks active consent row before queuing.

**Cookie banner (admin):**

- React component, no third-party dependency unless audit-clean.
- Categories: strict-necessary (always on), functional, analytics, marketing.
- "Aceitar tudo" and "Rejeitar não essenciais" buttons same size, weight, color contrast.
- Persist to `localStorage.consent_v1` + server `Consent` row for logged users.
- Re-prompt when `version` increments.

**Sentry init gate:**

- Strict-necessary if `beforeSend` provably scrubs PII (preferred). If not, default-off until consent.

**Mobile re-consent:**

- After deploy, app shows full-screen modal once: "We've updated our practices. Please choose your preferences." Stores 1+ `Consent` rows.

---

### B. Data Subject Request Workflow (T13–T16)

**Model:**

```prisma
model DataSubjectRequest {
  id              String      @id @default(cuid())
  userId          String?
  contactEmail    String
  type            DSRType
  status          DSRStatus   @default(received)
  createdAt       DateTime    @default(now())
  acknowledgedAt  DateTime?
  resolvedAt      DateTime?
  dueAt           DateTime    // createdAt + 15 days
  identityProof   Json?       // method + evidence ref
  evidenceObjectKey String?
  resolverId      String?
  notes           String?
  user            User?       @relation(fields: [userId], references: [id], onDelete: SetNull)
  @@index([status, dueAt])
}
enum DSRType {
  access export correction deletion anonymization
  consent_withdrawal sharing_info automated_review
}
enum DSRStatus { received in_identity_check in_progress completed denied withdrawn }
```

**Endpoints:**

- `POST /me/dsr` — authenticated; type + payload.
- `POST /public/dsr` — unauthenticated; via encarregado email channel; identity verification then routed.
- `GET /admin/dsr` — staff with role≥staff; lists + SLA.

**Account deletion (T13):**

- Atomic transaction:
  1. Anonymize `User`: replace `email` with `deleted-<id>@anon.local`, null `name`, `bio`, `city`, `stateCode`, set `status=deleted`, fill `anonymizedAt`.
  2. Cascade: nullify `authorUserId` on FeedPost/FeedComment to preserve thread integrity; delete CarPhoto/Car/ShippingAddress/SupportTicket/Notification rows (or anonymize per retention table).
  3. Revoke all RefreshTokens.
  4. Enqueue R2 deletion job for owned object keys.
  5. Enqueue vendor-fanout job: Sentry deletion endpoint, Resend audience remove, Expo Push token cleanup, Stripe customer detach (do not delete Stripe object — fiscal retention).
  6. Write `DataSubjectRequest.status=completed` + `AdminAudit`.
- Failure path: idempotent retry; manual escalation flagged after 24h.

**Data export (T14):**

- Worker generates a JSON + CSV bundle:
  - `user.json`, `cars.json`, `tickets.json`, `orders.json`, `shipping_addresses.json`, `support_tickets.json`, `feed_posts.json`, `feed_comments.json`, `feed_reactions.json`, `device_tokens.json`, `consents.json`, `notifications.json`.
- Uploaded to R2 under `exports/<userId>/<requestId>.zip` with 7-day TTL.
- Pre-signed GET URL emailed to verified address.

**Email change (T15):**

- New email triggers a confirmation email; old email notified.
- On confirm: swap, invalidate sessions, write Consent + Audit rows.

---

### C. Retention + Purge Jobs (T17–T19)

**Worker:** `apps/api/src/workers/retention.ts`, scheduled via fly/railway cron or `node-cron`.

**Schedule:** Daily 02:00 BRT.

**Jobs (one transaction each, with row-count log):**

- Delete `RefreshToken WHERE expiresAt < now() - interval '7 days'`.
- Delete `VerificationToken / PasswordResetToken WHERE expiresAt < now() OR consumedAt IS NOT NULL`.
- Delete `PaymentWebhookEvent WHERE createdAt < now() - interval '90 days'`.
- Anonymize `User` rows with `status='deletion_pending' AND anonymizedAt IS NULL AND deletionConfirmedAt < now() - interval '30 days'` (cooling-off period configurable).
- Delete `Notification WHERE createdAt < now() - interval '90 days'`.
- Delete `BroadcastDelivery WHERE createdAt < now() - interval '1 year'`.
- R2 lifecycle (Cloudflare side): orphan uploads (no DB ref) > 24h purged; deletion-tagged objects purged after retention window.

**Legal hold:** add `retentionHoldUntil` column on relevant tables; purge job skips rows where the hold is in effect.

**Audit:** every purge run writes one `AdminAudit { actor: 'system:retention', action: 'purge', metadata: { table, rowCount } }`.

---

### D. ROPA structure (T22)

`docs/ropa.md`, columns: Activity ID | Purpose | Data categories | Titular categories | Legal basis (Art. 7/11) | Retention | Recipients (internal) | Recipients (external) | International transfer? | Mechanism | Security measures | Owner | Last reviewed.

Seed rows from §6 + §7. Review quarterly + on any new processing activity.

---

### E. Privacy Notice + Cookie Policy outline (T05)

Sections (PT-BR, plain language, anchored TOC):

1. Quem somos / dados do controlador.
2. Encarregado / canal de contato.
3. Quais dados coletamos (mapeamento a partir do §5).
4. Por que coletamos e base legal (mapeamento a partir do §6).
5. Com quem compartilhamos (lista vendor a partir do §7).
6. Transferências internacionais e mecanismos.
7. Por quanto tempo guardamos (mapeamento a partir do §10).
8. Cookies e tecnologias semelhantes (incluindo SDK Sentry, Expo Push).
9. Seus direitos (Art. 18) e como exercer.
10. Crianças e adolescentes (depende do age-gate decision).
11. Segurança da informação.
12. Alterações desta política (versão + data + changelog público).
13. Como reclamar à ANPD.

Engineering note: render from a single `privacy.md` source so admin web, mobile in-app, and PDF export stay consistent. Version-pinned. Increment triggers re-consent.

---

### F. Security Hardening (T01-T03, T24-T26, T29-T35)

- `Sentry.beforeSend` template (Node + browser + RN):
  - Strip `event.request.headers`, `event.request.cookies`, `event.request.data`.
  - Strip URL query strings except a hardcoded allow-list.
  - Replace `event.user.email` with SHA-256 of the email.
  - Drop breadcrumbs of type `console` containing more than 200 chars or matching email/CPF regex.
- CSP for admin: `default-src 'self'; img-src 'self' https://*.cloudflare.com https://*.r2.cloudflarestorage.com; script-src 'self' 'nonce-…'; connect-src 'self' https://api.* https://*.sentry.io; frame-ancestors 'none';`
- CSP for API JSON responses: `default-src 'none'; frame-ancestors 'none';`
- `Sec-Fetch-*` validation on cookie-bearing admin routes.
- MFA: TOTP enrollment + recovery codes for `UserRole IN (organizer, admin, staff)`; gate sensitive admin actions on recent MFA.
- Dependency scan: GitHub Dependabot enabled + `pnpm audit --audit-level=high` in CI.

---

### G. Vendor + Transfer Register (T08-T09, T28)

`docs/vendor-register.md`, one row per vendor with: name | purpose | data categories | role | country | transfer mechanism | DPA reference | last reviewed | next review | owner. Re-review annually.

Vendor onboarding template: legal must complete the row + sign-off before any new SDK lands in `package.json`.

---

### H. RIPD outline (T23)

Per activity cluster:

1. Descrição do tratamento.
2. Finalidades.
3. Necessidade e proporcionalidade.
4. Categorias de dados e titulares.
5. Operadores envolvidos.
6. Riscos para os titulares (probabilidade × impacto).
7. Salvaguardas técnicas e administrativas.
8. Risco residual.
9. Aprovações (encarregado, segurança, produto).
10. Cadência de revisão (anual + on material change).

---

### I. Incident Response (T07)

`docs/incident-response.md`:

1. Detecção (Sentry alerta, suporte, Bug-bounty futuro, Railway alerta, monitoria).
2. Triagem em 4h: classificação severidade (1-4) + escopo + tipo de dado afetado.
3. Decisão "risco ou dano relevante" — checklist: dados sensíveis? credenciais? dados financeiros? menores? mais de N titulares? exposição pública confirmada?
4. Relógio de 3 dias úteis (6 se pequeno porte) iniciado em "ciência de que o incidente afetou dados pessoais".
5. Conteúdo da CIS (Res. 15/2024 Art. 5): descrição, natureza, dados afetados, número de titulares, técnicas adotadas, medidas, riscos, medidas adotadas para reverter/mitigar, contato.
6. Canal: portal ANPD CIS + email titulares (modelo PT-BR pronto).
7. Informações suplementares em 20 dias úteis.
8. Retenção dos registros ≥ 5 anos (`Incident` table).
9. Pós-mortem público (resumo) + plano de prevenção.

Tabletop quarterly. Roles: incident commander, comms, legal, encarregado, eng on-call.

---

## 17. Open Questions for Legal / Product / Leadership

1. Small-agent classification: does JDM Experience qualify (ME/EPP/MEI/startup)? Confirmation changes incident-notification deadlines and ROPA depth.
2. Minimum signup age: is the product intended for under-18? Drives Art. 14 design.
3. Legitimate-interest activities (Sentry, moderation, fraud, broadcasts): counsel must validate each LIA.
4. Fiscal retention period for `Order` rows: confirm tax-law minimum (typically 5 years; depends on entity setup).
5. Encarregado designation: name + email + appointment letter.
6. Vendor SCC posture: which vendors will accept ANPD SCC verbatim; which require alternative mechanisms (e.g., Stripe BR entity vs Stripe US).
7. Vercel admin region: keep US (cheaper, fewer ops) or move BR/EU to limit transfer surface.
8. Cookie banner copy and policy version cadence.
9. Marketing channels currently planned (email newsletter, push, in-app campaigns) — needs explicit list to design consent UX.
10. Whether to implement DSR public intake without account (email channel) or restrict to authenticated users.
11. Whether to support partner data sharing in any flow (e.g., sponsored events) — if yes, additional DPA + RIPD.

---

## 18. Appendix

### 18.1 Legal Requirements Matrix (full)

| ID  | Topic                      | Requirement                                                                                                                            | Source                                             | URL             | Implication                                    | Risk                                 |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------- | ---------------------------------------------- | ------------------------------------ |
| L01 | Material scope             | Applies to any processing of personal data (digital or not)                                                                            | LGPD Art. 1                                        | planalto.gov.br | All app processing in scope                    | Full obligations                     |
| L02 | Territorial scope          | (i) processing in BR, (ii) offer of goods/services to BR users, (iii) data collected in BR                                             | LGPD Art. 3                                        | planalto.gov.br | BR-targeted apps in scope regardless of server | ANPD jurisdiction                    |
| L04 | Definitions                | dado pessoal, dado sensível, anonimização, controlador, operador, encarregado                                                          | LGPD Art. 5                                        | planalto.gov.br | Define roles in DPAs                           | Wrong role → wrong obligations       |
| L05 | 10 principles              | finalidade, adequação, necessidade, livre acesso, qualidade, transparência, segurança, prevenção, não discriminação, responsabilização | LGPD Art. 6                                        | planalto.gov.br | Each documentable                              | Accountability is on controller      |
| L06 | Legal bases ordinary       | 10 hypotheses (Art. 7, I-X)                                                                                                            | LGPD Art. 7                                        | planalto.gov.br | Map every operation                            | No base = unlawful                   |
| L07 | Legitimate interest limits | Concrete purpose + necessity + LIA; not for sensitive data                                                                             | LGPD Art. 7 IX + Art. 10; ANPD LI guide 02/02/2024 | gov.br/anpd     | Document LIA per op                            | Undocumented LI rejected             |
| L08 | Sensitive data             | Specific & highlighted consent or limited non-consent hypotheses                                                                       | LGPD Art. 11                                       | planalto.gov.br | Separate consent UX                            | Strict liability                     |
| L09 | Children/adolescents       | Best interest + specific parental consent for <12                                                                                      | LGPD Art. 14                                       | planalto.gov.br | Age-gate + parental flow                       | ANPD priority enforcement            |
| L10 | DSR (9 rights)             | Confirmation, access, correction, anon/block/delete, portability, deletion-of-consent, sharing info, refusal info, revocation          | LGPD Art. 18                                       | planalto.gov.br | DSR portal + 15-day SLA                        | Direct enforcement                   |
| L11 | ROPA                       | Records of processing required                                                                                                         | LGPD Art. 37                                       | planalto.gov.br | Maintain register                              | Required for small agents too        |
| L12 | RIPD                       | Required by ANPD or proactively for high-risk                                                                                          | LGPD Art. 38                                       | gov.br/anpd     | Produce for high-risk flows                    | Cannot defend LI without it          |
| L13 | Operator governance        | Joint liability; instructions; contracts                                                                                               | LGPD Art. 39, 42                                   | planalto.gov.br | DPA per vendor                                 | Joint civil liability                |
| L14 | Encarregado                | Designate + publish identity/contact                                                                                                   | LGPD Art. 41 + ANPD Res. 18/2024                   | gov.br/anpd     | Footer + privacy notice                        | Required even when small agent       |
| L15 | Security TOMs              | Encrypt, RBAC, MFA, logging                                                                                                            | LGPD Art. 46                                       | planalto.gov.br | Tech + admin measures                          | Strict liability for breaches        |
| L17 | Breach notification        | 3 business days; small agent 6; supplementary 20; retain ≥5y                                                                           | LGPD Art. 48 + ANPD Res. 15/2024                   | gov.br/anpd     | Runbook + Incident table                       | Separate Art. 52 infraction          |
| L20 | Intl. transfer hypotheses  | 9 (Art. 33, I-IX)                                                                                                                      | LGPD Art. 33                                       | planalto.gov.br | Inventory + mechanism per vendor               | Default unlawful                     |
| L21 | SCC                        | Anexo II text without alterations; grace period ended ~Aug 2025                                                                        | ANPD Res. 19/2024                                  | gov.br/anpd     | Patch DPAs verbatim                            | Post-grace transfers unlawful        |
| L22 | Cookies                    | Granular, equal-prominence Reject, categorize, no pre-tick                                                                             | ANPD Cookies Guide v2025                           | gov.br/anpd     | Banner + cookie policy                         | ANPD active enforcement              |
| L23 | Small agents               | Simplified ROPA, doubled deadlines, DPO optional                                                                                       | ANPD Res. 2/2022                                   | gov.br/anpd     | Self-classify                                  | Misclassification = full obligations |
| L25 | Sanctions caps             | 2% BR revenue ex-tax, R$ 50M per infraction; DB suspension ≤6m                                                                         | LGPD Art. 52                                       | planalto.gov.br | Map worst-case                                 | Revenue + operational risk           |
| L26 | Dosimetria                 | Severity bands; aggravating/attenuating factors                                                                                        | ANPD Res. 4/2023                                   | gov.br/anpd     | Governance evidence attenuates                 | ANPD using dosimetria                |

### 18.2 Source bibliography

- Lei nº 13.709/2018 (LGPD) — https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- ANPD Res. CD/ANPD nº 2, de 27/01/2022 (small agents)
- ANPD Res. CD/ANPD nº 4, de 24/02/2023 (dosimetria)
- ANPD Res. CD/ANPD nº 15, de 24/04/2024 (RCIS — incident communication)
- ANPD Res. CD/ANPD nº 18, de 16/07/2024 (encarregado)
- ANPD Res. CD/ANPD nº 19, de 23/08/2024 (international transfer + SCC)
- ANPD Guia — Segurança da Informação para Agentes de Pequeno Porte (04/10/2021)
- ANPD Guia — Cookies e Proteção de Dados Pessoais (last update 23/01/2025)
- ANPD Guia — Hipóteses Legais — Legítimo Interesse (02/02/2024)
- ANPD — Página RIPD: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd
- ANPD — Página CIS: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis

### 18.3 Glossary

- **ANPD** — Autoridade Nacional de Proteção de Dados.
- **CIS** — Comunicação de Incidente de Segurança.
- **DPbD** — Data Protection by Design.
- **DSR** — Data Subject Request.
- **LIA** — Legitimate Interest Assessment.
- **RIPD** — Relatório de Impacto à Proteção de Dados Pessoais.
- **ROPA** — Records of Processing Activities.
- **SCC** — Standard Contractual Clauses (Cláusulas-Padrão ANPD).
- **TOM** — Technical and Organizational Measures.

### 18.4 Files inspected (sample, non-exhaustive)

- `packages/db/prisma/schema.prisma` (all models)
- `packages/db/prisma/migrations/**`
- `apps/api/src/routes/auth.ts`, `me*.ts`, `feed.ts`, `admin/*.ts`, `webhooks/*.ts`, `uploads/presign.ts`
- `apps/api/src/plugins/auth.ts`, `security-headers.ts`, `sentry.ts`, `error-handler.ts`
- `apps/api/src/logger.ts`, `env.ts`, `app.ts`
- `apps/api/src/services/stripe/*`, `services/abacatepay/*`, `services/uploads/r2.ts`, `services/mailer/*`, `services/push/*`
- `apps/admin/middleware.ts`, `sentry.{client,server,edge}.config.ts`, `src/lib/auth-session.ts`, `src/lib/upload-actions.ts`
- `apps/mobile/app.config.ts`, `app/(auth)/signup.tsx`, `src/copy/auth.ts`, `src/notifications/*`, `src/lib/upload-image.ts`, `src/auth/storage.ts`, `src/lib/sentry.ts`
- `infra/r2-cors.json`, `railway.json`, `RAILWAY.md`, `vercel.json`
- `.github/workflows/ci.yml`
- All `package.json`, all `.env.example`
