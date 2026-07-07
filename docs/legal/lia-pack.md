# Legitimate Interest Assessment (LIA) Pack — JDM Experience

> **Status:** Draft v1 — pending DPO/counsel sign-off.
> **Legal basis:** LGPD Art. 7, IX; Art. 10 (assessment of legitimate interest); ANPD orientation `Guia de Tratamento com Base em Legítimo Interesse` (2024).
> **Owner of this document:** CEO (temporary, pending dedicated DPO agent per [JDMA-641](/JDMA/issues/JDMA-641)).
> **Last updated:** 2026-05-15.
> **Review cadence:** annual or on material change to purpose, dataset, vendor, or risk profile.

This pack records one balancing test per processing activity for which JDM
Experience claims **legitimate interest (LI)** as the legal basis under LGPD
Art. 7, IX. The activity scope is fixed by the CEO ruling on
[JDMA-628](/JDMA/issues/JDMA-628) (Q03) and the upstream `LGPD_scan.md` §§6, 12.
Each LIA is structured per the ANPD 2024 LI guide:

1. Activity and purpose
2. Necessity test (could the purpose be reached with less data or a different basis?)
3. Balancing test (controller interest vs. data-subject rights and reasonable expectations)
4. Minimization scope and safeguards
5. Opt-out path and Art. 18 §2 objection handling
6. Decision owner and review cadence
7. Outcome (approved / conditional / rejected)

Activities with `consent` or `contract` legal basis are not in scope here and
are recorded in `docs/ropa.md` under their respective rows. Marketing push,
marketing email, promotional broadcasts, and per-user engagement analytics
are explicitly **not** LI per [JDMA-628](/JDMA/issues/JDMA-628) §B and must
use consent (Art. 7, I).

The full Relatório de Impacto à Proteção de Dados (RIPD / DPIA) for high-risk
activities is tracked separately under
[JDMA-672](/JDMA/issues/JDMA-672) (T23). The LIAs below cite the RIPD where
the activity is also high-risk.

---

## LIA index

| #      | Activity                                 | LGPD basis                     | RIPD required?                          | Outcome                                                    |
| ------ | ---------------------------------------- | ------------------------------ | --------------------------------------- | ---------------------------------------------------------- |
| LIA-01 | Ticket QR signing and anti-fraud         | Art. 7, IX                     | No (low risk)                           | Approved                                                   |
| LIA-02 | Feed moderation — automated and admin    | Art. 7, IX                     | Yes ([JDMA-672](/JDMA/issues/JDMA-672)) | Approved                                                   |
| LIA-03 | Reports and bans (user-flagged abuse)    | Art. 7, IX                     | Yes ([JDMA-672](/JDMA/issues/JDMA-672)) | Approved                                                   |
| LIA-04 | Admin audit log — accountability portion | Art. 7, II + Art. 7, IX (dual) | No                                      | **Conditional** — `AdminAudit` live; LI safeguards pending |
| LIA-05 | Error tracking (Sentry)                  | Art. 7, IX                     | Yes ([JDMA-672](/JDMA/issues/JDMA-672)) | **Conditional** — see preconditions                        |
| LIA-06 | Push delivery diagnostics                | Art. 7, IX                     | No (operational telemetry)              | Approved                                                   |
| LIA-07 | Payment-flow fraud signals               | Art. 7, IX                     | Yes ([JDMA-672](/JDMA/issues/JDMA-672)) | Approved                                                   |

---

## LIA-01 — Ticket QR signing and anti-fraud

| Field              | Value                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity ID        | `TICK-01` (per `docs/ropa.md`)                                                                                                                             |
| Purpose            | Prevent ticket forgery, replay, and resale fraud at event check-in.                                                                                        |
| Legal basis        | LGPD Art. 7, IX — legitimate interest of controller and ticketed attendees.                                                                                |
| Data categories    | `Ticket.id` (UUID), `Ticket.userId` (UUID), `Ticket.eventId`, issuance timestamp, HMAC signature. No name, no document number, no plate in the QR payload. |
| Titular categories | Registered users holding a valid ticket.                                                                                                                   |
| Recipients         | API service (verification), gate-staff admin client (verification only).                                                                                   |
| Retention          | Same as `Ticket` row (event + 5 years per CDC); HMAC keys rotated per policy.                                                                              |

**Necessity test.** The purpose is to bind a QR to a single user + event without
exposing PII at the gate. A non-signed QR would let an attacker mint tickets.
A signed QR using only opaque IDs achieves the purpose with the minimum
dataset. Consent is not appropriate because a user objecting to QR signing
would have no enforceable mechanism to enter the event, the basis is
contractual fulfillment supported by LI for the integrity check itself.

**Balancing test.**

- Controller interest: revenue protection, attendee safety (gate flow control), fairness to paying customers.
- Data-subject rights: identity confidentiality at the gate (no plaintext PII in the QR), no profiling, no resale tracking.
- Reasonable expectation: ticketed attendees expect verification at the gate. Signed QR is industry-standard.
- Net balance: controller interest is proportionate. No sensitive data (Art. 11) involved. No automated decision under Art. 20, verification result is mechanical.

**Minimization and safeguards.**

- QR payload limited to opaque identifiers and signature.
- HMAC secret stored in `FIELD_ENCRYPTION_KEY`-adjacent env var, never in source.
- Key rotation policy: at least annually and after any suspected exposure.
- No plaintext name, no CPF, no plate inside the QR.
- Verification log retains only ticket id + timestamp + outcome, not the QR image.

**Opt-out and Art. 18 §2 objection.** Objection blocks gate entry by design;
the privacy notice must explain that QR signing is intrinsic to ticket
validity. Users may request deletion of their account and tickets per Art. 18
III, handled by the LGPD data-subject request workflow (T17/T18).

**Decision owner.** CEO (temporary DPO ownership). Reviewed by counsel before
production launch.

**Outcome.** **Approved.** Low-risk telemetry; no RIPD required.

---

## LIA-02 — Feed moderation (automated and admin)

| Field              | Value                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity ID        | `SAFE-02`                                                                                                                                                                                         |
| Purpose            | Detect and remove content that violates community rules or law (hate speech, illegal sale, harassment, doxxing).                                                                                  |
| Legal basis        | LGPD Art. 7, IX — legitimate interest in user safety and platform integrity.                                                                                                                      |
| Data categories    | Post body, attached media metadata (R2 key, type, byte length, not image content beyond moderation hash), authorId (UUID), createdAt, moderator decision, reason code, retention of decision log. |
| Titular categories | All users posting to feed; reporting users; targets of moderation actions.                                                                                                                        |
| Recipients         | Internal: admin moderators, security on-call. External: none.                                                                                                                                     |
| Retention          | Removed-post records retained 24 months for appeal and repeat-offender pattern detection.                                                                                                         |

**Necessity test.** A platform allowing user-generated content cannot rely
purely on consent for moderation because the people most harmed are often
not the posters. Contract basis covers terms-of-service enforcement but
moderation evidence retention beyond an active ban requires LI. The narrowest
dataset that supports moderation is the post body, author, timestamp, and
decision. We do not retain biometric inference, sentiment scoring, or
political profiling.

**Balancing test.**

- Controller interest: user-safety duty, ANPD-aligned reasonable-expectation framework, third-party victim protection.
- Data-subject rights: free expression, contestability of moderation decisions, no over-broad surveillance.
- Reasonable expectation: posters acknowledge ToS that authorizes moderation; victims and law-enforcement-adjacent processing falls under Art. 7, IX precedent for user-safety platforms.
- Net balance: proportionate. Out-of-scope items (mass keyword tracking, political view profiling) are explicitly excluded.

**Current-state safeguards (implemented today).**

- Moderation admin routes are gated by the coarse `requireRole('organizer', 'admin', 'staff')` check in `apps/api/src/plugins/auth.ts`; only those role-bearing accounts can act on moderation.
- `Report` and `FeedBan` rows persist reporter id, resolver id, decision reason, and ban actor in the Prisma schema (`packages/db/prisma/schema.prisma`).
- Sensitive data (Art. 11) is not deliberately collected; the UI does not solicit it, and any sensitive content that lands inside a moderated post is treated as evidence rather than indexed.

**Future-state preconditions (not yet live, tracked as follow-ups).**

- Fine-grained moderation role (e.g., a dedicated `moderation` capability that narrows access beyond `organizer/admin/staff`) — to be created as a follow-up against the RBAC model. Until then, every `organizer/admin/staff` account can read moderation data, which the LIA records as the operating reality.
- A fixed moderation-reason taxonomy enforced at write time — to be specified by counsel + CTO; until then reasons remain free-text.
- A moderation appeal flow surfaced to end users — to be specified by product before public launch.

**Opt-out and Art. 18 §2 objection.** Objection to the existence of
moderation itself is rejected because it would defeat the user-safety
purpose (LGPD Art. 10 §1, LI grounded in third-party rights). The privacy
notice must document the appeal path before public launch; the route does
not exist today.

**RIPD reference.** Required, see [JDMA-672](/JDMA/issues/JDMA-672)
section on `UGC + moderation`.

**Decision owner.** CEO (temporary). Counsel + CTO co-sign.

**Outcome.** **Approved subject to preconditions** above and the RIPD
landing before public launch.

---

## LIA-03 — Reports and bans (user-flagged abuse)

| Field              | Value                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity ID        | `SAFE-03`                                                                                                                                                                     |
| Purpose            | Allow users to flag abusive content or behaviour and let admins act on those reports, including temporary or permanent bans.                                                  |
| Legal basis        | LGPD Art. 7, IX — legitimate interest in user safety, third-party protection.                                                                                                 |
| Data categories    | Reporter userId, reporter timestamp, target userId or content id, free-text reason (sensitive-data discouraged in UI copy), admin decision, decision rationale, ban duration. |
| Titular categories | Reporting users, reported users / authors of reported content.                                                                                                                |
| Recipients         | Internal admin moderators only.                                                                                                                                               |
| Retention          | Reporter identity retained for the lifetime of the report record (5 years) for audit and abuse-of-report detection.                                                           |

**Necessity test.** Anonymous reports are useful but materially less reliable
than identified reports for repeat-offender detection. Retention of reporter
identity is necessary to deter weaponized reporting and to support
contestability of bans. We considered hashing reporter id; rejected because
admins must be able to contact reporters in escalations.

**Balancing test.**

- Controller interest: keep platform safe; provide due process to banned users.
- Reporter rights: confidentiality from the reported user (admins only); protection from retaliation.
- Reported user rights: contestability, proportionality, no shadow-ban.
- Reasonable expectation: users posting content accept that other users may flag it; reporters accept admin visibility.
- Net balance: proportionate. Reporter identity is **never** disclosed to the reported user.

**Current-state safeguards (implemented today).**

- `Report` rows store reporter id, target, status, and resolver id per the Prisma schema. `FeedBan` rows store `bannedById` and ban metadata.
- Sentry `beforeSend` scrubbing is wired across `api`, `admin`, `mobile` via `scrubSentryEvent` (`packages/shared/src/sentry-scrubber.ts`) and removes breadcrumb `data` payloads.

**Future-state preconditions (not yet live, tracked as follow-ups).**

- UI copy nudging reporters away from sensitive-data Art. 11 disclosures — to be added by product when the report form ships its final copy.
- Server-side sanitization on the report reason free-text field (e.g., length cap, redaction pass) — to be added before public launch.
- Structured reason taxonomy + evidence-ref field on ban decisions — schema change planned as a follow-up.

**Opt-out and Art. 18 §2 objection.** Reported users may appeal a ban or
request review. Reporters may withdraw a report; the withdrawn report is
retained for fraud-of-report audit but flagged as withdrawn.

**RIPD reference.** Required, see [JDMA-672](/JDMA/issues/JDMA-672)
section on `Reports/bans`.

**Decision owner.** CEO (temporary). Counsel co-sign.

**Outcome.** **Approved**, contingent on the RIPD.

---

## LIA-04 — Admin audit log (LI portion above legal-obligation floor)

| Field              | Value                                                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity ID        | `GOV-01`                                                                                                                                                                                                                                                                                |
| Purpose            | Maintain a full audit log of admin actions (status changes, refunds, bans, role changes, exports, deletions) for accountability and ANPD investigation support.                                                                                                                         |
| Legal basis        | **Dual.** Art. 7, II, legal obligation (LGPD Art. 6, X and Art. 37 record-keeping duty) for the minimum compliance floor. Art. 7, IX, legitimate interest for the additional accountability fields beyond that floor (e.g., evidence captures, internal review notes, screenshot refs). |
| Data categories    | Actor admin id, target user/order/event id, action verb, before/after diff snippets, timestamp, IP, user-agent.                                                                                                                                                                         |
| Titular categories | Admin users (as actors), data subjects whose records are touched.                                                                                                                                                                                                                       |
| Recipients         | Internal: compliance, CTO, CEO. External: ANPD on regulatory request.                                                                                                                                                                                                                   |
| Retention          | 5 years aligned with CDC and ANPD investigation timelines.                                                                                                                                                                                                                              |

**Current implementation reality.** The repo ships an `AdminAudit` Prisma
model (`packages/db/prisma/schema.prisma`, columns `id`, `actorId`,
`action`, `entityType`, `entityId`, `metadata` (Json), `createdAt`; indexed
on `actorId+createdAt`, `entityType+entityId`, `createdAt`). Writes go
through `recordAudit` in `apps/api/src/services/admin-audit.ts`, which
inserts one row per recorded admin action with optional `metadata` JSON.
The table is therefore live, but the LI-specific safeguards listed below
(append-only DB enforcement, narrowed audit-reader role, structured diff
redaction, IP/UA capture, defined retention) are **not** in place yet, so
the LI portion of this LIA stays conditional until they land.

**Necessity test.** The legal-obligation floor (Art. 7, II) covers a minimal
audit. The richer dataset (diffs, internal review notes) is not strictly
required by statute but is necessary for actual accountability and for
defending the platform against ANPD inquiries or civil claims. A purely
contract basis is inappropriate because the data subjects logged are not
parties to the contract being recorded (they are the _subjects_ of admin
action).

**Balancing test.**

- Controller interest: accountability, ANPD investigation support, defense of operational decisions, fraud audit.
- Data-subject rights: admin actors have reduced expectation of privacy on actions taken in their privileged role; affected end users gain a record they can request via Art. 18 II (access).
- Net balance: proportionate **once the safeguards below are implemented**. LI portion strictly additive to the legal-obligation floor; no behavioural profiling of admins beyond action logging.

**Current safeguards already in code.**

- `AdminAudit` rows are created server-side by `recordAudit` only, called from admin routes. Clients cannot author audit entries directly.
- `entityType` is constrained to a fixed string union in `RecordAuditInput` (e.g., `event`, `tier`, `ticket`, `order`, `user`, `feed_post`, `report`, `feed_ban`, etc.), which bounds what can be logged.
- The Prisma model captures actor id, action verb, target entity type and id, free-form `metadata` JSON, and creation timestamp, with indexes on `(actorId, createdAt)`, `(entityType, entityId)`, and `(createdAt)`.

**Future-state safeguards (must land before the LI portion is effective).**

- DB-layer append-only enforcement (`REVOKE UPDATE, DELETE` on `AdminAudit` for application roles, or a row-level immutability trigger) so the log is tamper-evident. Today nothing prevents an UPDATE/DELETE through the same Prisma connection.
- Structured `metadata` redaction allowlist that excludes secret fields by name, plus a documented schema for the diff fields actually stored under `metadata`.
- A dedicated audit-reader role narrower than the current coarse `requireRole('organizer','admin','staff')` gate (e.g., compliance/CTO/CEO only); bulk export gated and itself audited.
- Captured fields for actor IP and user-agent on each audit row, retained only on this log and not reused for marketing or scoring.
- Defined retention (proposal: 5 years aligned with CDC + ANPD investigation timelines) enforced as policy and as a deletion job; today retention is implicit and indefinite.

**Opt-out and Art. 18 §2 objection.** Admins cannot opt out of being logged
on the role, it is a condition of holding admin access (Art. 7, V, contract
with respect to their admin role). End users may exercise Art. 18 II (access)
to obtain a record of admin actions against them. Objection under Art. 18 §2
is rejected on third-party-protection grounds (Art. 10 §1) where the log is
needed to defend other users.

**RIPD reference.** Not required (low risk, accountability-only).

**Decision owner.** CEO (temporary). CTO co-sign for the technical retention model.

**Outcome.** **Conditional.** The `AdminAudit` table and `recordAudit`
writes are live, so the legal-obligation floor (Art. 7, II) is supported
in code today. The LI portion (richer accountability dataset on top of
that floor) is **not yet defensible** until append-only DB enforcement,
narrowed audit-reader role, structured metadata redaction, IP/UA capture,
and defined retention are implemented.

---

## LIA-05 — Error tracking (Sentry)

| Field              | Value                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Activity ID        | `OBS-01`                                                                                                                                                                                               |
| Purpose            | Detect, diagnose, and fix production errors and runtime failures across `api`, `admin`, and `mobile`.                                                                                                  |
| Legal basis        | LGPD Art. 7, IX, legitimate interest in operational integrity.                                                                                                                                         |
| Data categories    | Exception type, stack trace, route, request id, user id (pseudonymized), breadcrumbs after `beforeSend` PII scrubbing. **No** plaintext email, CPF, plate, payment ids, message bodies, free-text PII. |
| Titular categories | Users encountering errors; admin staff using the admin client.                                                                                                                                         |
| Recipients         | Internal engineering on-call. External: Sentry (US, international transfer, see DPA + SCC).                                                                                                            |
| Retention          | 90 days hot, then anonymized aggregate metrics.                                                                                                                                                        |

**Necessity test.** Operational error telemetry is necessary to detect
incidents that risk user data (LGPD Art. 46 security duty). Disabling Sentry
entirely would harm user safety by slowing breach detection. Consent is not
suitable because errors occur on unauthenticated paths (signup, OAuth
callback) where a consent record may not exist before the failure.

**Balancing test.**

- Controller interest: regulator-grade incident response, Art. 46 security duty, ANPD breach-notification (Art. 48) readiness.
- Data-subject rights: protection from over-broad telemetry, no marketing reuse, no third-party sale.
- Reasonable expectation: users tolerate error telemetry only if it is minimized and never contains plaintext PII.
- Net balance: proportionate **only with** PII scrubbing in place.

**Current implementation reality.**

- `beforeSend` PII scrubbing is wired in `apps/api/src/plugins/sentry.ts`, `apps/admin/sentry.{client,server,edge}.config.ts`, and `apps/mobile/src/lib/sentry.ts` via `scrubSentryEvent` (`packages/shared/src/sentry-scrubber.ts`). The scrubber strips request headers to a fixed `SAFE_HEADERS` allowlist (accept, content-type, host, origin, user-agent, x-request-id, etc.), removes breadcrumb `data` payloads, and truncates long breadcrumb messages. Console breadcrumbs run through an additional `dropRiskyConsoleBreadcrumbs` filter on the api.
- Sentry session replay **is configured today** on the admin client in `apps/admin/sentry.client.config.ts` with `replaysSessionSampleRate: 0` and `replaysOnErrorSampleRate: 1.0`, so steady-state sessions are not sampled but every error-bearing session is fully replayed. `apps/admin/sentry.client.config.ts` also runs an additional console-breadcrumb filter that drops breadcrumbs over 200 chars or matching an email/CPF regex. Replay is not configured on `api` or `mobile`. Until the cookie-consent gate ships, error-replay processing on `admin` runs without an explicit consent record, which is the gap that drives this LIA's conditional status.
- The Sentry DPA / SCC posture for ANPD purposes is **not** yet confirmed; tracked under vendor governance (T19/T28).
- A cookie-consent banner gating optional telemetry is **not** in place today.

**Preconditions for LI defensibility (still open).**

1. Confirm and harden the `beforeSend` PII scrubber against email, CPF, plate, payment refs, and free-text PII paths the current `SAFE_HEADERS` + breadcrumb-data scrubber does not yet explicitly target (follow-up under T01).
2. Admin Sentry replay (today: `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 1.0`) must either be set to `0/0` until a cookie-consent banner ships (T12), or kept on error only after the consent gate is live and recorded per user. The LI claim is not defensible while error-replay runs ungated.
3. Sentry DPA must include ANPD-aligned SCC (T19/T28).

Until all three conditions hold, the Sentry LI claim is treated as
**conditional**: the platform may continue to send error events because the
existing scrubber materially reduces PII exposure today, but the LI basis
is not yet defensible without the follow-ups above.

**Future-state minimization targets (not all live yet).**

- Explicit scrub list for `email`, `cpf`, `plate`, `Authorization` headers, payment refs — to be verified against the current scrubber and extended where gaps exist.
- Sentry replay remains absent on `mobile` and `api`; on `admin` it stays disabled (or, post-consent gate, gated) so error-replay never runs without a recorded consent.
- Sentry user-context limited to `userId` UUID with an opt-in to drop the id entirely on objection.

**Opt-out and Art. 18 §2 objection.** Authenticated users may request that
their `userId` not be attached to Sentry events; the platform replaces it
with a per-session ephemeral id. Anonymous error reports are minimization-by-default.

**RIPD reference.** Required, see [JDMA-672](/JDMA/issues/JDMA-672)
section on `Sentry PII handling`.

**Decision owner.** CEO (temporary). CTO co-sign on the engineering controls.

**Outcome.** **Conditional / not effective** until T01, T12, and vendor SCC
land. Until then the LI basis is **not defensible** and full-breadcrumb
incident review must be paused.

---

## LIA-06 — Push delivery diagnostics

| Field              | Value                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity ID        | `MSG-03`                                                                                                                                     |
| Purpose            | Diagnose push-notification delivery failures (invalid tokens, vendor errors, retry routing) to keep transactional push reliable.             |
| Legal basis        | LGPD Art. 7, IX, legitimate interest in service reliability.                                                                                 |
| Data categories    | Push token reference (opaque), provider response code, timestamp, retry count. **No** message body retained beyond 30 days under this basis. |
| Titular categories | Users who have registered a push token.                                                                                                      |
| Recipients         | Internal engineering. External: Expo Push (US, vendor DPA).                                                                                  |
| Retention          | 30 days for delivery telemetry; aggregate counters retained longer.                                                                          |

**Necessity test.** Push delivery is integral to transactional flows
(ticket-confirmation, gate-change notifications). Without delivery
diagnostics, the platform cannot detect token expiry, vendor outages, or
silent drops that put attendees at risk of missing event-critical
communication. Consent is not suitable because the diagnostics underpin
transactional push (which is already on contract basis).

**Balancing test.**

- Controller interest: reliable transactional delivery, Art. 46 quality duty.
- Data-subject rights: no per-user engagement profiling, no marketing reuse.
- Reasonable expectation: users expect their notifications to arrive; minimal telemetry to that end is expected.
- Net balance: proportionate.

**Minimization and safeguards.**

- Message body **not retained** beyond 30 days under this basis.
- No per-user engagement profile (open/click), engagement analytics on push fall under consent (see [JDMA-628](/JDMA/issues/JDMA-628) §B).
- Provider response stored as code + descriptor, not full payload.

**Opt-out and Art. 18 §2 objection.** Users may revoke push permissions in
device settings; the platform retains no diagnostics after revocation.
Objection under Art. 18 §2 is honored by switching transactional
communication to email-only (already on contract basis).

**RIPD reference.** Not required.

**Decision owner.** CEO (temporary). CTO co-sign on engineering scope.

**Outcome.** **Approved.**

---

## LIA-07 — Payment-flow fraud signals

| Field              | Value                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity ID        | `PAY-03`                                                                                                                                       |
| Purpose            | Detect and block fraudulent ticket purchases (Stripe risk signals, AbacatePay anti-abuse, rate limiting on `/auth/*` and `/orders/*`).         |
| Legal basis        | LGPD Art. 7, IX, legitimate interest in fraud prevention; supported by Art. 11 §2 II if any sensitive proxy data ever appears (it should not). |
| Data categories    | Order id, user id, IP, user-agent, attempt counter, Stripe risk score, AbacatePay risk score, decision outcome.                                |
| Titular categories | Purchasers and would-be purchasers.                                                                                                            |
| Recipients         | Internal payments + security on-call. External: Stripe, AbacatePay (per their DPAs).                                                           |
| Retention          | 24 months aligned with chargeback and dispute windows.                                                                                         |

**Necessity test.** Fraud signals cannot be reduced to a contract basis
because they apply _before_ a contract exists (rate-limiting `/auth/*` on
unauthenticated traffic). Consent is impossible, an attacker would never
consent to anti-fraud processing of their own attempts. LI is the only
viable basis. Minimum dataset is the request metadata plus the provider
risk score.

**Balancing test.**

- Controller interest: chargeback exposure, revenue protection, attendee trust.
- Data-subject rights: avoidance of false-positive blocks, no automated denial under Art. 20 without recourse.
- Reasonable expectation: payment fraud screening is universally expected.
- Net balance: proportionate, **with** human review on high-stakes denials.

**Minimization and safeguards.**

- **No automated denial of service without human review when the stakes are high** (e.g., banning a verified member). High-stakes denials route to a human admin queue.
- No reuse of fraud signals for marketing or for user-trust scoring outside the payment path.
- IP retained for 24 months; not exposed to non-security roles.
- Stripe / AbacatePay risk scores stored opaque; we do not attempt to reverse-engineer them.

**Opt-out and Art. 18 §2 objection.** Objection to fraud screening is
rejected on third-party-protection grounds (Art. 10 §1). Users denied a
purchase may request human review via the support flow, explicit Art. 20
recourse path.

**RIPD reference.** Required, see [JDMA-672](/JDMA/issues/JDMA-672)
section on `Payments + payments-fraud`.

**Decision owner.** CEO (temporary). CTO co-sign on the engineering rule
catalog. Counsel co-sign on the Art. 20 recourse wording.

**Outcome.** **Approved.**

---

## Mandatory conditions for every LI claim above

These conditions are restated from [JDMA-628](/JDMA/issues/JDMA-628) §C and
apply to **all** LIAs in this pack:

1. **LIA on file** before production launch in Brazil; refreshed annually or on material change.
2. **Minimization**, the narrowest dataset that achieves the purpose; out-of-scope data is cut, not retroactively justified.
3. **Opt-out path published** in the privacy notice for every LI-backed activity, including Art. 18 §2 objection handling.
4. **No sensitive data** (Art. 11) handled under LI. Sensitive disclosures in `bio`, `SupportTicket.message`, and `Report.reason` must be discouraged at the UI and stripped from Sentry breadcrumbs (T01).
5. **High-risk activities go to RIPD** ([JDMA-672](/JDMA/issues/JDMA-672)).
6. **Sentry-specific gate**, LIA-05 is **conditional** on T01 (beforeSend) and T12 (consent gate) shipping.

---

## Document hygiene

- This document is the canonical artifact for T36 ([JDMA-661](/JDMA/issues/JDMA-661)).
- Cross-referenced by `docs/ropa.md` (per-activity rows) and the upcoming
  RIPD in [JDMA-672](/JDMA/issues/JDMA-672).
- Annual review owner: **DPO** once appointed under
  [JDMA-641](/JDMA/issues/JDMA-641); CEO until then.
- Change record: append-only below.

### Change history

| Date       | Author | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-15 | CEO    | Initial v1 draft. 7 LIAs covering activities flagged "LI approved" in [JDMA-628](/JDMA/issues/JDMA-628). LIA-05 (Sentry) marked conditional pending T01 + T12.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-15 | CEO    | v1.1 — CTO review on PR #308. Reframed LIA-02, LIA-03, LIA-04, LIA-05 to separate current-state safeguards from future-state preconditions. LIA-04 outcome flipped to "Conditional / not effective" because the `AuditLog` table and append-only enforcement do not exist in the repo today. LIA-02 dropped the unimplemented `admin:moderation` RBAC claim; today's gate is the coarse `requireRole('organizer','admin','staff')`. LIA-05 dropped claims that scrubber coverage is complete and that a cookie-consent banner exists; both are tracked as still-open follow-ups.                                                                                                                                                                      |
| 2026-05-15 | CEO    | v1.2 — CTO second review on PR #308. Two v1.1 claims contradicted the repo: (a) the audit-log table does exist as `AdminAudit` in `packages/db/prisma/schema.prisma` with live writes via `apps/api/src/services/admin-audit.ts`, and (b) Sentry session replay is configured on the admin client (`replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 1.0`). LIA-04 now states the table is live and lists the LI-specific safeguards (append-only enforcement, narrowed reader role, metadata redaction, IP/UA capture, retention) as the still-open conditions. LIA-05 now describes the actual admin replay sample rates and frames the LI gap as ungated error-replay until the consent banner ships, not as replay being entirely absent. |
