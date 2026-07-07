# Relatório de Impacto à Proteção de Dados Pessoais (RIPD) — JDM Experience

> **Status:** Draft v1 — pending DPO/counsel sign-off and CTO co-sign on engineering controls.
> **Legal basis:** LGPD Art. 5º, XVII; Art. 38; Art. 10 §3º; Art. 32 (RIPD/DPIA). ANPD `Guia de elaboração de Relatório de Impacto à Proteção de Dados Pessoais (RIPD)` (2024). Resolução CD/ANPD nº 4/2023.
> **Document owner:** CEO (temporary, pending dedicated DPO agent per [JDMA-641](/JDMA/issues/JDMA-641)).
> **Last updated:** 2026-05-15.
> **Review cadence:** annual and on any material change to purpose, dataset, vendor, risk profile, or applicable legal basis.

This RIPD records the impact assessment for high-risk processing activities
operated by JDM Experience under LGPD. Scope is fixed by the CEO ruling on
[JDMA-628](/JDMA/issues/JDMA-628) (Q03) and the upstream `LGPD_scan.md` §§6,
12, and 16.H. The structure of every cluster below follows the `LGPD_scan.md`
§16.H outline:

1. Descrição do tratamento
2. Finalidades
3. Necessidade e proporcionalidade
4. Categorias de dados e titulares
5. Operadores envolvidos
6. Riscos para os titulares (probabilidade × impacto)
7. Salvaguardas técnicas e administrativas
8. Risco residual
9. Aprovações (encarregado, segurança, produto)
10. Cadência de revisão (anual + on material change)

The RIPD complements but does not replace `docs/ropa.md` (per-activity register
under [JDMA-644](/JDMA/issues/JDMA-644) / T22) or `docs/legal/lia-pack.md`
(legitimate-interest balancing tests under [JDMA-661](/JDMA/issues/JDMA-661) /
T36). Activity IDs (`PAY-01`, `OBS-01`, etc.) align with the ROPA register so
each cluster can be traced end-to-end.

## Activity-cluster index

| #       | Cluster                               | Activities (ROPA IDs)           | Legal basis                                | LIA cross-ref                                                         | Outcome                                                                              |
| ------- | ------------------------------------- | ------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| RIPD-01 | Payments + payment-flow fraud signals | `PAY-01`, `PAY-02`, `PAY-03`    | Art. 7, V (contract) + Art. 7, IX (fraud)  | [LIA-07](/JDMA/issues/JDMA-661#document-plan)                         | **Approved**, conditional on counsel SCC sign-off                                    |
| RIPD-02 | Feed UGC + moderation + reports/bans  | `COMM-01`, `SAFE-02`, `SAFE-03` | Art. 7, V (contract) + Art. 7, IX (safety) | [LIA-02](/JDMA/issues/JDMA-661), [LIA-03](/JDMA/issues/JDMA-661)      | **Conditional** — preconditions named below                                          |
| RIPD-03 | City-targeted operational broadcasts  | `OPS-01`                        | Art. 7, V (operational/contract)           | n/a (operational, not LI)                                             | **Approved**, conditional on broadcast cap and logging                               |
| RIPD-04 | Marketing push                        | `MKT-01`                        | Art. 7, I (consent)                        | n/a (consent-only; LI rejected per [JDMA-628](/JDMA/issues/JDMA-628)) | **Conditional** — pending T20 legacy-user re-consent UX and T12 admin consent banner |
| RIPD-05 | Sentry PII handling (error tracking)  | `OBS-01`                        | Art. 7, IX (legitimate interest)           | [LIA-05](/JDMA/issues/JDMA-661)                                       | **Conditional / not effective** until T01 + T12 + SCC                                |

Excluded from this RIPD by current scope (will require a separate RIPD before
launch):

- Partner / sponsor data sharing — not in scope per [JDMA-636](/JDMA/issues/JDMA-636) (Q11). No flow exists or is planned.
- ML, behavioural profiling, automated decisioning under LGPD Art. 20.
- Biometric ticket validation.
- Children/adolescent processing under LGPD Art. 14 (no age gate yet — tracked separately).

---

## RIPD-01 — Payments and payment-flow fraud signals

### 1. Descrição do tratamento

Processing required to take ticket and membership payments and to detect and
block fraudulent purchase attempts. Covers Stripe (card, Apple Pay, recurring
membership), AbacatePay (Pix), and the cross-cutting fraud-signal layer that
applies to both: rate-limiting on `/auth/*` and `/orders/*`, Stripe risk
scoring, AbacatePay anti-abuse, and webhook idempotency / signature
verification for ticket settlement.

### 2. Finalidades

- Execute card and Pix payments for tickets and recurring premium memberships.
- Settle paid orders and grant the resulting `Ticket` rows only on verified provider webhook events.
- Prevent ticket forgery, replay, and resale fraud on the buy path.
- Protect attendee, controller, and provider from chargeback abuse.
- Comply with anti-money-laundering and consumer-defence obligations applicable to ticketed events.

### 3. Necessidade e proporcionalidade

The payment activity itself is necessary for service delivery (Art. 7, V):
without it there is no ticket. Fraud screening cannot be reduced to contract
basis because it applies before any contract exists (rate-limiting on
unauthenticated `/auth/*`). Consent is structurally impossible — an attacker
will not consent to anti-fraud processing of their own attempts — so LI is
the only viable basis for the fraud-signal layer.

Minimum dataset is: order id, user id when authenticated, IP, user-agent,
attempt counters, and the opaque provider risk scores. We do not retain the
PAN, full card data, or the unsalted Pix payer key beyond the providers'
own systems. Order flips to `paid` only on a verified provider webhook
(controller invariant in `CLAUDE.md`); no client call can promote an order.

### 4. Categorias de dados e titulares

| Field                    | Detail                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data categories          | name, email, billing-flag/order metadata, payment status, `provider_ref`, IP, user-agent, attempt counter, Stripe risk score, AbacatePay risk score, decision outcome |
| Sensitive data (Art. 11) | None collected. Card PAN handled exclusively by Stripe under PCI-DSS; we never see plaintext PAN.                                                                     |
| Titular categories       | Registered users buying tickets or memberships; would-be purchasers (incl. unauthenticated traffic on /auth/\*); admins acting on refunds.                            |

### 5. Operadores envolvidos

| Operator                 | Role                              | Region   | Mechanism / DPA status                                                  |
| ------------------------ | --------------------------------- | -------- | ----------------------------------------------------------------------- |
| Stripe                   | Independent controller + operator | US       | DPA + ANPD SCC required (T19/T28 — open). Tracked in `LGPD_scan.md` §7. |
| AbacatePay               | Operator                          | BR       | DPA confirmation required (T28 — open). Domestic transfer.              |
| Railway (Postgres + API) | Operator (hosting)                | BR (gru) | Order, fraud-decision, and webhook rows persisted on BR-region DB.      |
| Resend                   | Operator (transactional email)    | US       | Used only for receipt / refund email. SCC required (T28 — open).        |
| Sentry                   | Operator (error tracking)         | US       | Errors on the payment path inherit RIPD-05 controls.                    |

No data is shared with sponsors, marketing partners, or independent
third-party controllers other than the payment providers themselves
(per [JDMA-636](/JDMA/issues/JDMA-636) / Q11).

### 6. Riscos para os titulares (probabilidade × impacto)

| Risk                                                                | Probability | Impact | Inherent rating |
| ------------------------------------------------------------------- | ----------- | ------ | --------------- |
| Order-status forgery (client flips order to `paid` without webhook) | Low         | High   | Medium-high     |
| Webhook replay or signature spoof granting a ticket                 | Low         | High   | Medium-high     |
| False-positive fraud denial (legitimate user blocked, no recourse)  | Medium      | Medium | Medium          |
| Payment-provider data breach exposing email + order metadata        | Low         | High   | Medium-high     |
| Disputed chargeback without retained anti-fraud evidence            | Medium      | Medium | Medium          |
| Provider international transfer without an Art. 33 mechanism        | High        | Medium | High            |

### 7. Salvaguardas técnicas e administrativas

**Implemented today:**

- Orders flip to `paid` only from a verified provider webhook event. Client calls cannot promote an order (load-bearing invariant — `CLAUDE.md`).
- Webhook handlers verify the provider signature on every call. Idempotency is enforced by the `PaymentWebhookEvent` Prisma model's composite `@@unique([provider, eventId])` constraint (`packages/db/prisma/schema.prisma`), so duplicate provider events cannot be processed twice.
- Rate limiting in place on `/auth/*` and ticket purchase endpoints (`LGPD_scan.md` §11; cross-cutting requirement in `CLAUDE.md`).
- Stripe / AbacatePay risk scores stored as opaque provider values; we do not attempt to reverse-engineer them.
- Admin actions on orders and refunds are recorded in `AdminAudit` (`packages/db/prisma/schema.prisma`) via the server-side `recordAudit` helper called from `apps/api/src/services/admin-audit.ts`.

**Future-state preconditions (must land before this RIPD is fully effective):**

- Counter-signed DPA + ANPD-aligned SCC with Stripe, AbacatePay, Resend, and any non-BR Railway infrastructure (T19/T28 — open).
- Documented Art. 20 recourse path: a human-review queue for high-stakes fraud denials (e.g., banning a verified member). Recourse copy must be approved by counsel.
- 24-month retention enforcement on fraud-signal rows aligned with chargeback / dispute windows, with a purge job at the end of that window.
- Privacy notice (T05) discloses the fraud screening, the international transfer to Stripe / Resend / Sentry, and the Art. 20 recourse path.
- Field-level encryption for payment-adjacent free-text fields. `Order.notes` is **plain text on `main` today** (`String? @db.Text` in `packages/db/prisma/schema.prisma`); the encryption work is in flight under [JDMA-705](/JDMA/issues/JDMA-705) (PR #309, open) and must land before any production data accumulates in that column.

### 8. Risco residual

After the implemented controls and assuming the future-state preconditions
above land, the residual risk is **medium-low**:

- Provider international-transfer risk is the dominant residual until SCC sign-off lands.
- A small false-positive denial risk remains; the Art. 20 recourse path mitigates harm but does not eliminate friction.
- Provider-side data-breach exposure is outside the controller's direct technical reach and is mitigated only by vendor selection, contractual notification clauses, and incident response (T07).

### 9. Aprovações

| Role                    | Name / placeholder                                        | Status                                                     |
| ----------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Encarregado (DPO)       | Vacant — CEO acting per [JDMA-641](/JDMA/issues/JDMA-641) | Provisional sign-off pending dedicated DPO appointment.    |
| Segurança da informação | CTO                                                       | Co-sign required on rate-limit / webhook / fraud controls. |
| Produto                 | CEO                                                       | Sign-off on Art. 20 recourse copy and refund flow.         |
| Counsel (LEG)           | External counsel — to be retained                         | Required on SCC posture before public launch.              |

### 10. Cadência de revisão

Annual review by 2027-05-15, and on any of: new payment provider, new payment
method, change to webhook architecture, change to fraud-signal vendor, or
material change to the Art. 20 recourse path. Reviewer of record is the
incumbent DPO (CEO until appointed).

---

## RIPD-02 — Feed UGC, moderation, reports and bans

### 1. Descrição do tratamento

Processing of user-generated content posted to the in-app feed (posts,
comments, reactions, attached media metadata) and the moderation operations
that act on it: automated rule-based moderation, admin moderation decisions,
and the user-flagging-plus-ban workflow. Includes retention of moderation
actor identity and the decision audit trail.

### 2. Finalidades

- Provide the community feature itself (post, comment, react, view).
- Detect and remove content that violates community rules or law (hate speech, illegal sale, harassment, doxxing).
- Allow users to flag abusive content or behaviour and let admins act on those flags, including temporary or permanent bans.
- Retain moderation evidence for appeals, repeat-offender pattern detection, and ANPD investigation support.

### 3. Necessidade e proporcionalidade

Feed participation itself is contract-basis (Art. 7, V). Moderation cannot
rely purely on consent because the people most harmed by abusive content
are typically not the posters; the only viable basis for moderation
evidence retention beyond an active ban is LI (Art. 7, IX). The narrowest
dataset that supports moderation is: post body, author id, timestamp, and
decision metadata. We do not retain biometric inference, sentiment scoring,
or political profiling.

Reports likewise rely on LI: anonymous reports are materially less reliable
than identified reports for repeat-offender detection, and reporter identity
must be retained to deter weaponized reporting and support contestability of
bans.

### 4. Categorias de dados e titulares

| Field                    | Detail                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data categories          | post body, attached media metadata (R2 key, type, byte length), `authorId`, `createdAt`, moderator decision, reason code, reporter id, target id, ban duration, ban actor id                          |
| Sensitive data (Art. 11) | Not deliberately collected. Free-text fields (`bio`, `SupportTicket.message`, `Report.reason`) can incidentally contain it; UI must discourage it (T01 PII strip in Sentry; T05 privacy-notice copy). |
| Titular categories       | All users posting to feed; reporting users; targets of moderation actions; admin moderators (as actors).                                                                                              |

### 5. Operadores envolvidos

| Operator                 | Role                      | Region               | Mechanism / DPA status                                         |
| ------------------------ | ------------------------- | -------------------- | -------------------------------------------------------------- |
| Cloudflare R2            | Operator (object storage) | Global / unspecified | SCC + region-lock confirmation required (T28 — open).          |
| Railway (Postgres + API) | Operator (hosting)        | BR (gru)             | Feed, `Report`, `FeedBan`, and `AdminAudit` rows persisted BR. |
| Sentry                   | Operator (error tracking) | US                   | Errors on the moderation path inherit RIPD-05 controls.        |

No data is shared with external moderation services, sponsors, or
marketing partners (per [JDMA-636](/JDMA/issues/JDMA-636) / Q11).

### 6. Riscos para os titulares (probabilidade × impacto)

| Risk                                                                         | Probability | Impact      | Inherent rating |
| ---------------------------------------------------------------------------- | ----------- | ----------- | --------------- |
| Over-broad admin access to moderation data (no fine-grained moderation role) | High        | Medium      | High            |
| Free-text moderation reasons containing sensitive data (Art. 11)             | Medium      | High        | High            |
| Reporter identity disclosed to reported user                                 | Low         | High        | Medium-high     |
| Weaponized reporting causing wrongful ban                                    | Medium      | Medium      | Medium          |
| Indefinite retention of moderation evidence beyond purpose                   | Medium      | Medium      | Medium          |
| Shadow-ban or non-contestable ban (no appeal flow yet)                       | High        | Medium-high | High            |

### 7. Salvaguardas técnicas e administrativas

**Implemented today:**

- Moderation admin routes are mounted under the `requireRole('organizer','admin')` scope in `apps/api/src/routes/admin/index.ts` (verified at the registration block that registers `adminFeedModerationRoutes`). `staff` is **excluded** from the moderation gate; the only role-bearing accounts that can act on moderation are `organizer` and `admin`. End users have no path to moderation data. The LIA-02 wording in `docs/legal/lia-pack.md` predates this narrowing and is being corrected in a follow-up; this RIPD reflects the actual `main` wiring.
- `Report` and `FeedBan` rows persist reporter id, resolver id, decision reason, ban actor id, and ban metadata in `packages/db/prisma/schema.prisma`.
- Admin actions on reports / bans / posts go through `recordAudit` and land in `AdminAudit` for accountability.
- Sentry `beforeSend` scrubbing (`packages/shared/src/sentry-scrubber.ts`) is wired across `api`, `admin`, and `mobile`; it removes breadcrumb `data` payloads and limits headers to a `SAFE_HEADERS` allowlist.
- Sensitive data (Art. 11) is not deliberately solicited by the moderation UI; any sensitive content arriving inside a moderated post is treated as evidence rather than indexed.

**Future-state preconditions (must land before this RIPD is fully effective):**

- Fine-grained `moderation` capability narrower than the current `organizer/admin` gate, so non-moderator organizers/admins cannot read moderation data.
- Server-side sanitization on `Report.reason` and moderator `reason` free-text fields (length cap, redaction pass) plus a fixed reason taxonomy enforced at write time.
- User-facing moderation appeal flow with documented SLA, surfaced before public launch.
- Retention policy enforced as a deletion job (LIA proposal: removed-post records 24 months for appeal and repeat-offender detection; `Report` 2 years from resolution; `FeedBan` while in effect + 1 year — `LGPD_scan.md` §10).
- Privacy-notice (T05) entry covering feed, moderation, reports, bans, and the appeal path.

### 8. Risco residual

After the implemented controls and assuming the future-state preconditions
above land, the residual risk is **medium**. The dominant residual driver
is the absence of a fine-grained moderation role and the appeal flow:
**until both are live**, this RIPD must be treated as **conditional**, and
the LIA-02 / LIA-03 outcomes ride on the same preconditions.

### 9. Aprovações

| Role                    | Name / placeholder                                        | Status                                                             |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Encarregado (DPO)       | Vacant — CEO acting per [JDMA-641](/JDMA/issues/JDMA-641) | Provisional sign-off pending dedicated DPO appointment.            |
| Segurança da informação | CTO                                                       | Co-sign on RBAC narrowing, free-text sanitization, retention jobs. |
| Produto                 | CEO                                                       | Sign-off on appeal flow UX and reason taxonomy.                    |
| Counsel (LEG)           | External counsel — to be retained                         | Required on appeal-flow SLA copy before public launch.             |

### 10. Cadência de revisão

Annual review by 2027-05-15, and on any of: new moderation surface, new
reportable category, third-party moderation vendor, schema change to
`Report` / `FeedBan`, or material change to the appeal flow.

---

## RIPD-03 — City-targeted operational broadcasts

### 1. Descrição do tratamento

Push and in-app broadcast messages targeted by `city` (and `stateCode`)
attribute on the user profile, used to communicate operational
event-related information at scale: gate changes, schedule shifts, weather
diversions, safety alerts, and other event-day operational notices.

### 2. Finalidades

- Reach all users in a given city for an event-related operational reason.
- Avoid notifying users in unrelated regions.
- Maintain an audit trail of who triggered the broadcast and when.

### 3. Necessidade e proporcionalidade

Broadcast targeting by `city` is necessary because the platform serves
multiple cities and untargeted notifications would be both ineffective
operationally and harmful to user trust (notification fatigue). Per
[JDMA-628](/JDMA/issues/JDMA-628) §B the **operational** broadcast use case
sits on contract basis (Art. 7, V), not on legitimate interest, because it
is a necessary part of the service the user signed up for. The city-only
targeting attribute already in the schema is the minimum data required;
finer-grained targeting (neighbourhood, GPS) is **out of scope** of this
RIPD and would require a separate balancing test or a consent flow.

This RIPD covers operational broadcasts only. **Marketing or promotional
broadcasts** are explicitly carved out and must use the consent-based
marketing-push flow assessed in RIPD-04 below.

### 4. Categorias de dados e titulares

| Field                    | Detail                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Data categories          | `User.city`, `User.stateCode`, `User.pushToken` (opaque), broadcast id, broadcast body, sender admin id, `BroadcastDelivery` row per recipient |
| Sensitive data (Art. 11) | None collected.                                                                                                                                |
| Titular categories       | Registered users with a recorded `city` who match the broadcast filter.                                                                        |

### 5. Operadores envolvidos

| Operator                 | Role                      | Region   | Mechanism / DPA status                             |
| ------------------------ | ------------------------- | -------- | -------------------------------------------------- |
| Expo Push                | Operator (push delivery)  | US       | DPA + ANPD SCC required (T19/T28 — open).          |
| Railway (Postgres + API) | Operator (hosting)        | BR (gru) | Broadcast and `BroadcastDelivery` rows persist BR. |
| Sentry                   | Operator (error tracking) | US       | Errors inherit RIPD-05 controls.                   |

### 6. Riscos para os titulares (probabilidade × impacto)

| Risk                                                                           | Probability | Impact | Inherent rating |
| ------------------------------------------------------------------------------ | ----------- | ------ | --------------- |
| Mis-classification of a marketing message as operational (LI/contract drift)   | Medium      | High   | High            |
| Broadcast over-reach: too-broad audience filter (e.g., national)               | Medium      | Medium | Medium          |
| Lack of rate-limit on broadcast endpoint enabling abuse by a compromised admin | Medium      | High   | High            |
| Notification fatigue degrading transactional channel trust                     | Medium      | Medium | Medium          |
| `BroadcastDelivery` retention beyond purpose                                   | Low         | Low    | Low             |

### 7. Salvaguardas técnicas e administrativas

**Implemented today:**

- City-only targeting attribute exists in the schema (`User.city`, `stateCode` per `LGPD_scan.md` §5); no neighbourhood / GPS targeting is wired.
- Broadcast endpoints (`apps/api/src/routes/admin/broadcasts.ts`) are mounted under the `requireRole('organizer','admin')` admin scope in `apps/api/src/routes/admin/index.ts`. `staff` is **excluded**.
- Each `Broadcast` row captures `createdByAdminId` server-side, so the actor for every broadcast is recorded in the broadcast table itself even though the routes do **not** currently call `recordAudit`.
- For marketing-target broadcasts, `apps/api/src/services/broadcasts/targets.ts` filters recipients with `hasActiveConsent(u.id, 'push_marketing')`, so users without an active consent record are excluded from the audience set at compute time.
- `BroadcastDelivery` rows are persisted on the BR-region Railway DB.

**Future-state preconditions (must land before this RIPD is fully effective):**

- `recordAudit` calls in `apps/api/src/routes/admin/broadcasts.ts` for create / update / cancel and (later) send actions, so the `AdminAudit` trail covers broadcasts the same way it covers other admin mutations. Today only `Broadcast.createdByAdminId` is recorded; no `AdminAudit` rows are written from this surface.
- Rate-limiting on the admin broadcast endpoint (called out as required in `CLAUDE.md`'s cross-cutting requirements).
- A documented audience cap and / or a 4-eyes / approval gate on broadcasts above a threshold size (CTO + CEO sign-off on the threshold).
- Operational-vs-marketing classification at write time: an admin issuing a broadcast must explicitly label it `operational` or `marketing`, and `marketing` falls into RIPD-04's consent-gated flow.
- `BroadcastDelivery` retention enforced at 1 year (`LGPD_scan.md` §10) with a purge job.
- Privacy notice (T05) discloses operational broadcasts as part of the service.

### 8. Risco residual

After the implemented controls and assuming the future-state preconditions
above land, the residual risk is **medium-low**. The dominant residual
driver today is the **absence of `AdminAudit` writes from broadcast
routes**: only `Broadcast.createdByAdminId` is persisted, so the canonical
admin-action audit trail does not yet cover broadcasts. Operator
discipline at write time is the secondary driver — even with classification
labels, a careless admin can still mis-tag a marketing message as
operational. The rate-limit + audience-cap controls bound the blast radius
once they land, but do not eliminate the risk.

### 9. Aprovações

| Role                    | Name / placeholder                                        | Status                                                            |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Encarregado (DPO)       | Vacant — CEO acting per [JDMA-641](/JDMA/issues/JDMA-641) | Provisional sign-off pending dedicated DPO appointment.           |
| Segurança da informação | CTO                                                       | Co-sign on rate-limit, audience-cap, and classification flag.     |
| Produto                 | CEO                                                       | Sign-off on broadcast cadence policy and admin training material. |
| Counsel (LEG)           | External counsel — to be retained                         | Required on operational-vs-marketing copy before public launch.   |

### 10. Cadência de revisão

Annual review by 2027-05-15, and on any of: new targeting attribute
(neighbourhood, GPS, behaviour), new push provider, schema change to
`BroadcastDelivery`, or material change to the audience-cap policy.

---

## RIPD-04 — Marketing push

### 1. Descrição do tratamento

Sending push notifications whose purpose is promotional (drive ticket sales,
promote membership, surface non-operational content). Re-classified to
**consent only** (Art. 7, I) per the CEO ruling on
[JDMA-628](/JDMA/issues/JDMA-628) §B; LI is explicitly rejected for this
activity.

### 2. Finalidades

- Promote ticket sales, premium membership, and non-operational platform announcements to users who have given an explicit, granular, opt-in consent for marketing push.

### 3. Necessidade e proporcionalidade

Marketing push is **not necessary** for the service. It is, by definition,
discretionary processing that requires the controller to obtain a free,
informed, unambiguous, and granular consent (LGPD Art. 8). The schema
default `User.pushPrefs` is `{"transactional":true,"marketing":false}`
on `main` (`packages/db/prisma/schema.prisma`), so new users start
opted-out of marketing push. Existing users who pre-date the consent
work must still pass through the T20 re-consent flow
([JDMA-668](/JDMA/issues/JDMA-668)) before marketing push can be sent
to them.

### 4. Categorias de dados e titulares

| Field                    | Detail                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Data categories          | `User.id`, `User.pushToken` (opaque), `Consent` row (purpose, version, channel, timestamp, evidence), broadcast body |
| Sensitive data (Art. 11) | None collected.                                                                                                      |
| Titular categories       | Registered users with an active opt-in `Consent` row for purpose `marketing_push`.                                   |

### 5. Operadores envolvidos

| Operator                 | Role                      | Region   | Mechanism / DPA status                    |
| ------------------------ | ------------------------- | -------- | ----------------------------------------- |
| Expo Push                | Operator (push delivery)  | US       | DPA + ANPD SCC required (T19/T28 — open). |
| Railway (Postgres + API) | Operator (hosting)        | BR (gru) | `Consent` and broadcast rows persist BR.  |
| Sentry                   | Operator (error tracking) | US       | Errors inherit RIPD-05 controls.          |

### 6. Riscos para os titulares (probabilidade × impacto)

| Risk                                                                                                | Probability | Impact | Inherent rating |
| --------------------------------------------------------------------------------------------------- | ----------- | ------ | --------------- |
| Pre-consent legacy users receiving marketing push before T20 re-consent UI ships                    | Medium      | High   | High            |
| Dark-pattern UI making opt-out harder than opt-in                                                   | Medium      | High   | High            |
| Drift between `pushPrefs.marketing` toggle, `Consent` row, and the broadcast `targets` audience set | Medium      | Medium | Medium          |
| Marketing message sent to a withdrawn-consent user (race between withdrawal and queued send)        | Medium      | High   | High            |
| Engagement-analytics reuse of marketing push (open / click profiling) without further consent       | Medium      | High   | High            |

### 7. Salvaguardas técnicas e administrativas

**Implemented today:**

- `Consent` Prisma model exists with `id, userId, purpose, version, givenAt, withdrawnAt, channel, evidence` columns (per `LGPD_scan.md` §9 required spec; consent foundation shipped under PR #304 — `bf4ab1c`).
- Schema default on `main` is `pushPrefs = {"transactional":true,"marketing":false}` (`packages/db/prisma/schema.prisma`), so new users start opted-out of marketing push.
- `PATCH /me/push-preferences` (`apps/api/src/routes/me.ts`) writes a `recordConsent({ purpose: 'push_marketing', ... })` row when the user opts in, and calls `withdrawConsent(sub, 'push_marketing')` when the user opts out. The toggle and the `Consent` row are mutated in the same request, so the consent event is recorded with timestamp, version, channel, IP, UA, and evidence.
- Server-side audience filtering: `apps/api/src/services/broadcasts/targets.ts` excludes any user without `hasActiveConsent(u.id, 'push_marketing')` from the marketing-target audience set. Users without a current consent row are dropped before the broadcast send.
- Mobile re-consent modal scaffolding shipped on `feat/jdma-668-marketing-consent` (T20) — wired into `app/_layout.tsx` root gate. Not yet merged to `main`.

**Future-state preconditions (must land before this RIPD is fully effective):**

- T20 mobile re-consent flow ([JDMA-668](/JDMA/issues/JDMA-668)) merged to `main` and verified end-to-end on iOS and Android, so legacy users without a `push_marketing` consent row pass through the modal before any marketing push is composed.
- Granular consent banner / preference centre on `admin` with equal-prominence Accept and Reject (T12).
- Withdrawal honoured within 24h, including in any queued sends — `targets.ts` already enforces at audience-compute time, but the queue worker should re-check `hasActiveConsent` immediately before the per-recipient send for the long-tail case.
- Engagement analytics on marketing push remain **out of scope** of this RIPD until a separate consent purpose and balancing test cover them.
- Privacy notice (T05) discloses marketing push as a separate, opt-in purpose with the withdrawal path.

### 8. Risco residual

Schema default opt-out, the consent record on `/me/push-preferences`, and
the audience-set filter in `targets.ts` are live on `main`, so the
residual risk for **new users** is already **low-medium**. The dominant
residual driver today is **legacy users**: any pre-consent user account
that pre-dates the `Consent` table cannot have a recorded
`push_marketing` consent until T20 ships and forces a re-consent decision.
Until then, this RIPD remains **conditional**: the audience filter
already excludes those users from a marketing send (no live consent row),
so no actual marketing push goes out, but the formal sign-off cannot
land until the re-consent UX is on `main`.

### 9. Aprovações

| Role                    | Name / placeholder                                        | Status                                                          |
| ----------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| Encarregado (DPO)       | Vacant — CEO acting per [JDMA-641](/JDMA/issues/JDMA-641) | Provisional sign-off pending dedicated DPO appointment.         |
| Segurança da informação | CTO                                                       | Co-sign on schema default flip and server-side enforcement.     |
| Produto                 | CEO                                                       | Sign-off on consent UI copy and the re-consent flow.            |
| Counsel (LEG)           | External counsel — to be retained                         | Required on consent-form copy and withdrawal SLA before launch. |

### 10. Cadência de revisão

Annual review by 2027-05-15, and on any of: new marketing channel, new
purpose added to `Consent`, change to consent UI copy, or change to the
withdrawal flow.

---

## RIPD-05 — Sentry PII handling (error tracking)

### 1. Descrição do tratamento

Capturing, transmitting, and processing application-error telemetry from
`api`, `admin`, and `mobile` to detect, diagnose, and fix production
errors and runtime failures. Includes Sentry session replay on the admin
client (`replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 1.0`).

### 2. Finalidades

- Detect production incidents that risk user data (LGPD Art. 46 security duty).
- Diagnose root cause and ship a fix.
- Support ANPD breach-notification (Art. 48) timeline by giving incident response teams the trace context they need.

### 3. Necessidade e proporcionalidade

Operational error telemetry is necessary to discharge the controller's Art.
46 security duty: disabling Sentry entirely would slow breach detection and
extend titular harm. Consent is structurally unsuitable because errors
occur on unauthenticated paths (signup, OAuth callback) where no consent
record may yet exist. LI (Art. 7, IX) is the only viable basis; the LIA is
[LIA-05](/JDMA/issues/JDMA-661).

The minimum dataset for the purpose is: exception type, stack trace,
route, request id, pseudonymized user id, breadcrumbs after `beforeSend`
PII scrubbing. Plaintext email, CPF, plate, payment refs, message bodies,
and free-text PII are explicitly out of scope and must be stripped at
ingest time.

### 4. Categorias de dados e titulares

| Field                    | Detail                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data categories          | exception type, stack trace, route, request id, pseudonymized `userId` (UUID), breadcrumbs (post-scrub), session replay frames on errors only (admin)                      |
| Sensitive data (Art. 11) | None deliberately captured. Free-text PII may incidentally appear in breadcrumbs and is scrubbed by `scrubSentryEvent`; coverage gaps drive the conditional outcome below. |
| Titular categories       | Users encountering errors on `api` / `mobile`; admin staff using the admin client.                                                                                         |

### 5. Operadores envolvidos

| Operator                 | Role                      | Region               | Mechanism / DPA status                               |
| ------------------------ | ------------------------- | -------------------- | ---------------------------------------------------- |
| Sentry                   | Operator (error tracking) | US                   | DPA + ANPD SCC required (T19/T28 — open).            |
| Cloudflare R2            | Operator (object storage) | Global / unspecified | Source-map / artefact storage if used; SCC required. |
| Railway (Postgres + API) | Operator (hosting)        | BR (gru)             | Source of error events; rows persist BR.             |

### 6. Riscos para os titulares (probabilidade × impacto)

| Risk                                                                       | Probability  | Impact | Inherent rating |
| -------------------------------------------------------------------------- | ------------ | ------ | --------------- |
| Plaintext PII (email, CPF, plate, payment ref) leaking into Sentry events  | Medium       | High   | High            |
| Session replay on admin running ungated (no cookie-consent banner)         | High (today) | High   | **Critical**    |
| International transfer to Sentry without an Art. 33 mechanism (no SCC yet) | High (today) | Medium | High            |
| `userId` re-identification of a logged user from error context             | Medium       | Medium | Medium          |
| Source map exposure leaking server-side code paths to client error tooling | Medium       | Medium | Medium          |

### 7. Salvaguardas técnicas e administrativas

**Implemented today:**

- `beforeSend` PII scrubbing (`scrubSentryEvent` in `packages/shared/src/sentry-scrubber.ts`) is wired across `api`, `admin`, and `mobile`. Strips request headers to a fixed `SAFE_HEADERS` allowlist, removes breadcrumb `data` payloads, and truncates long breadcrumb messages.
- `dropRiskyConsoleBreadcrumbs` filter active on `api` console breadcrumbs.
- Admin client (`apps/admin/sentry.client.config.ts`) drops console breadcrumbs over 200 chars or matching email / CPF regex.
- Recent hardening: breadcrumb serialization hardened against circular refs and BigInt (`77623b9`); breadcrumb selector and `data.arguments` PII check fixed (`8f8d438`); CPF regex tightened to require dash separator (`13470da`).
- Sentry user context limited to UUID `userId`, never plaintext email or name.

**Future-state preconditions (must land before this RIPD is fully effective):**

- Confirm and harden the `beforeSend` PII scrubber against email, CPF, plate, payment refs, and free-text PII paths the current `SAFE_HEADERS` + breadcrumb-data scrubber does not yet explicitly target (T01 — open).
- Cookie-consent banner (T12) shipped on `admin` so error-replay never runs without a recorded user consent. Until then, admin replay must be set to `replaysOnErrorSampleRate: 0` so the LI claim stays defensible. The current `1.0` rate is the gap that drives the conditional outcome.
- Counter-signed Sentry DPA + ANPD-aligned SCC (T19/T28).
- Documented opt-out path: authenticated users may request that their `userId` be replaced by a per-session ephemeral id on Sentry events.
- Privacy notice (T05) discloses error tracking, the international transfer to Sentry, and the opt-out path.

### 8. Risco residual

Today the residual risk is **high** because admin error-replay runs ungated
and the SCC posture is not yet confirmed. After the future-state
preconditions above land, residual risk falls to **medium-low**:
operational telemetry remains a measured intrusion mitigated by scrubbing,
minimization, and a published opt-out.

This RIPD is therefore **conditional / not effective** until T01, T12, and
SCC sign-off all land. Until then, full-breadcrumb incident review must
be paused (consistent with [LIA-05](/JDMA/issues/JDMA-661)).

### 9. Aprovações

| Role                    | Name / placeholder                                        | Status                                                              |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Encarregado (DPO)       | Vacant — CEO acting per [JDMA-641](/JDMA/issues/JDMA-641) | Provisional sign-off pending dedicated DPO appointment.             |
| Segurança da informação | CTO                                                       | Co-sign on scrubber coverage, replay gate, and source-map handling. |
| Produto                 | CEO                                                       | Sign-off on opt-out copy and consent banner UX.                     |
| Counsel (LEG)           | External counsel — to be retained                         | Required on SCC posture for Sentry before public launch.            |

### 10. Cadência de revisão

Annual review by 2027-05-15, and on any of: new error-tracking vendor, new
data category routed to Sentry, change to scrubber rules, change to
session-replay sample rates, or material change to the Sentry DPA.

---

## Cross-cutting conditions for every RIPD cluster

These conditions are restated from [JDMA-628](/JDMA/issues/JDMA-628) and the
LIA pack and apply to **all** clusters above:

1. **RIPD on file** before public launch; refreshed annually or on material change to purpose, dataset, vendor, or risk profile.
2. **Minimization** — narrowest dataset that achieves the purpose.
3. **Opt-out / objection handling** documented in the privacy notice (T05) for every cluster, including the Art. 18 §2 objection path.
4. **No sensitive data (Art. 11)** under any RIPD cluster. Any inadvertent disclosure (`bio`, `SupportTicket.message`, `Report.reason`) must be discouraged at the UI and stripped from Sentry breadcrumbs (T01).
5. **High-risk activities not covered here** (ML / profiling, biometric ticket validation, partner sharing, children Art. 14) must each get their own RIPD before launch.
6. **International transfers** (Stripe, Sentry, Resend, Expo Push, R2, Vercel, EAS, GitHub Actions, Google, Apple) require ANPD-aligned SCC under Resolução CD/ANPD nº 19/2024 Anexo II or another Art. 33 mechanism (T19 / T28).

## Outstanding residual risks tracked as follow-ups

The following residual risks are **not** masked inside this RIPD and must be
tracked as their own product / engineering tickets. They are listed here so
that approval of this RIPD does not implicitly accept them:

- T01 — Sentry `beforeSend` PII coverage hardening for email / CPF / plate / payment refs / free-text paths.
- T05 — PT-BR privacy notice and cookie policy publication.
- T12 — Granular cookie / consent banner on `admin` with equal-prominence Accept and Reject.
- T19 / T28 — Counter-signed DPA + ANPD-aligned SCC for Stripe, AbacatePay, Sentry, Resend, Expo Push, R2, Vercel, EAS, GitHub Actions.
- T20 ([JDMA-668](/JDMA/issues/JDMA-668)) — Mobile marketing push re-consent flow for legacy users (the schema default is already `marketing = false` on `main`; the residual gap is the legacy-user re-consent UX, not the default).
- Fine-grained `moderation` capability narrower than the current `organizer/admin` gate, and a user-facing moderation appeal flow before public launch.
- Broadcast rate-limit, audience-cap policy, operational-vs-marketing classification flag at write time, and `recordAudit` calls on broadcast create / update / cancel routes (`apps/api/src/routes/admin/broadcasts.ts`).
- Field-level encryption for `Order.notes` ([JDMA-705](/JDMA/issues/JDMA-705) / PR #309) — currently plain text on `main`.
- Append-only enforcement on `AdminAudit`, narrowed audit-reader role, structured metadata redaction, IP / UA capture, and 5-year retention.
- Retention-and-purge jobs per `LGPD_scan.md` §10 (tokens, webhook events, removed-post records, reports, bans, broadcasts, support tickets).

When a residual risk above is closed, the corresponding RIPD cluster's
**Outcome** must be re-evaluated in the next refresh; do **not** silently
upgrade an outcome from "Conditional" to "Approved" without that refresh.

## Document hygiene

- This document is the canonical artifact for T23 ([JDMA-672](/JDMA/issues/JDMA-672)).
- Cross-references: `docs/ropa.md` (per-activity register, [JDMA-644](/JDMA/issues/JDMA-644) / T22) and `docs/legal/lia-pack.md` (LI balancing tests, [JDMA-661](/JDMA/issues/JDMA-661) / T36).
- Annual review owner: **DPO** once appointed under [JDMA-641](/JDMA/issues/JDMA-641); CEO until then.
- Change record: append-only below.

### Change history

| Date       | Author | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-15 | CEO    | Initial v1 draft. 5 RIPD clusters covering payments + fraud, feed UGC + moderation, city-targeted operational broadcasts, marketing push, and Sentry PII handling. Partner sharing excluded per [JDMA-636](/JDMA/issues/JDMA-636) / Q11.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-05-15 | CEO    | v1.1 — CTO review on PR #311. Five `Implemented today` claims contradicted `main`: (a) `pushPrefs.marketing` already defaults to `false` and `/me/push-preferences` already records / withdraws `push_marketing` consent (RIPD-04 reframed); (b) moderation routes are `requireRole('organizer','admin')` with `staff` excluded (RIPD-02 corrected); (c) broadcast routes are `requireRole('organizer','admin')` with **no** `recordAudit` calls — only `Broadcast.createdByAdminId` is captured (RIPD-03 corrected, audit gap moved to preconditions); (d) webhook idempotency is enforced by the `PaymentWebhookEvent.@@unique([provider, eventId])` constraint, not by `provider_ref` (RIPD-01 corrected); (e) `Order.notes` is plain text on `main`; encryption work is open under PR #309 (RIPD-01 moved to preconditions). |
