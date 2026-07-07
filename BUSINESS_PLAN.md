# JDM Experience — Business Plan (v1, 2026-04-29)

**Owner:** CEO
**Status:** Living document. Update on each strategic checkpoint or phase gate.
**Sources of truth this plan rolls up:** `plans/brainstorm.md` (architecture brief), `plans/roadmap.md` (technical roadmap), `handoff.md` (current engineering state).

---

## 1. What we are

JDM Experience is the canonical mobile + web platform for an existing
Curitiba-based events company that runs modified-car meetings and drift
events across Brazil. The company already has the audience, the venues,
and the brand. It does not yet have a product. We are building the
product so that ticketing, attendance, community, and recurring revenue
all live in one place we own — instead of leaking to generic ticketing
platforms (Sympla, Eventbrite) and Instagram DMs.

Primary market: Brazilian car-culture community, starting in Paraná and
expanding to São Paulo, Rio Grande do Sul, Santa Catarina, and São Paulo
state metros. Primary language: Portuguese (PT-BR). i18n scaffold from
day one so a future English/Spanish push is incremental, not a rewrite.

## 2. Why this works (thesis)

- **Captive audience.** The events already happen. Ticket buyers exist
  whether or not we ship a slick app. We are migrating revenue from a
  third-party platform plus DMs to a first-party channel — a move from
  zero-margin distribution to platform margin.
- **High-affinity vertical.** Car culture is community-shaped, not
  transactional. A ticketing app that ignores the community is replaceable.
  An app that hosts the community (feed, championships, DMs) becomes the
  default home for the scene.
- **Recurring revenue lever.** Premium membership ("todos os eventos por
  R$X/mês") converts intermittent ticket buyers into predictable MRR. It
  also locks attendance in advance, which de-risks event capacity.
- **Brazilian payments fit.** Pix is the cheapest, fastest payment rail
  in Brazil and a near-universal preference. Card-only would crater
  conversion. We support both Stripe (card / Apple Pay / recurring
  memberships) and AbacatePay (Pix one-time).

## 3. Product surfaces (decided)

Three apps, one codebase:

- **Mobile (Expo / React Native)** — attendees buy tickets, hold QR
  codes, manage memberships, post to per-event feeds, vote in
  championships.
- **Admin (Next.js)** — JDM team creates events, manages tiers,
  scans QR codes at the door, runs broadcasts, moderates content.
- **API (Fastify + Postgres + Prisma)** — single source of truth.
  Webhooks from Stripe / AbacatePay are the only path to a paid order.

Stack and topology are pinned in `plans/brainstorm.md`. Do not relitigate
the stack without a written ADR + CEO sign-off; novelty budget belongs
to product surface, not infrastructure.

## 4. Monetization

Three revenue lines, in priority order of activation:

1. **Per-event ticket sales (live in Phase 1).**
   - Stripe (card + Apple Pay + Google Pay): platform default.
   - AbacatePay (Pix): added in v0.2 before public store launch.
   - Margin: ticket price minus Stripe Brazil (~3.99% + R$0.39) or
     AbacatePay Pix (~0.99–1.49%). Pix is materially cheaper and we
     should nudge users toward it after launch.
2. **Premium membership (Phase 2 / F8).**
   - Stripe Subscription, monthly + annual tiers.
   - Active members are auto-granted tickets to all currently-published
     future events, and to every newly-published event.
   - Pricing principle: above ~2 events of equivalent value per month so
     the unit economics survive the heaviest attenders.
   - Cancel-at-period-end stops new grants; existing tickets remain valid
     (a customer-experience choice; revisit if abused).
3. **Marketing broadcasts (Phase 2 / F10).**
   - Not a direct revenue line. A growth and re-activation channel that
     drives 1 and 2.

Out-of-scope monetization: no in-app classifieds, no per-post boosts, no
ad inventory. We do not become a marketplace.

## 5. Release plan (the only roadmap that matters externally)

Mirrors `plans/roadmap.md` but framed as commercial milestones.

| Release | Commercial gate            | Capability shipped                                                                                                                                  |
| ------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1    | TestFlight + Play Internal | Sign-up, browse events, buy ticket via card/Apple Pay, hold QR, get scanned at the door, get transactional push. Admin can run an event end-to-end. |
| v0.2    | First public store release | + Pix via AbacatePay. **Public launch gate.**                                                                                                       |
| v0.3    | Revenue diversification    | + Premium membership (Stripe Subscriptions + ticket grants).                                                                                        |
| v0.4    | Engagement loop            | + Per-event social feed + admin broadcasts.                                                                                                         |
| v0.5    | Community moat             | + 1:1 messaging.                                                                                                                                    |
| v0.6    | Differentiation            | + Per-event championships and weighted voting.                                                                                                      |

**Public launch is gated on v0.2 (Pix), not v0.1.** Card-only would convert
poorly enough to damage launch perception. Internal/TestFlight is fine
on v0.1 to validate the core flow with the existing crowd.

## 6. Where we are right now (2026-04-29)

Phase 1 MVP is mostly built; Phase 0 deployment plumbing is the bottleneck.

- **Done on `main`:** F1 Auth (email + password, JWT, refresh, verify,
  reset, rate limit), F2 Profile + Garage + R2 uploads, F3 Events
  catalog, F7a Admin event CRUD, F4 Stripe ticketing, F5 Check-in.
- **Latest branch:** `feat/f6-push` — F6 Transactional Push fully
  implemented and code-reviewed; ready to merge.
- **Open before v0.1 ships to TestFlight:**
  - Merge F6 push to `main`.
  - Close out Phase 0 deferrals: Railway prod deploy (0.12), Sentry DSNs
    wired (0.15), EAS build config for first real build (0.9). Without
    Railway prod, F1.1–F1.6 cannot flip from `[~]` to `[x]` and we
    cannot run the v0.1 happy-path verification end-to-end against a
    real base URL.
  - First EAS preview build to TestFlight + Play Internal. Smoke-test
    happy path: signup → ticket → push → QR → check-in.
- **Open before v0.2 (public launch):**
  - F4b Pix path via AbacatePay (4.8–4.12).
  - Mobile auth screens (1.10) and token storage (1.13) — these are
    required by the mobile happy path but currently still `[ ]` in the
    roadmap.
  - Cross-cutting: LGPD endpoints (X.2), Terms / Privacy / consent (X.4),
    App Store + Play listings (X.3).

The technical detail behind any of this lives in `plans/`. The CEO does
not maintain that detail — the CTO does.

## 7. Strategic priorities (in order)

1. **Land v0.1 on TestFlight by close of Phase 0 deferrals.** Until the
   crowd at the next real event can buy a ticket through this app, every
   other priority is theoretical. Owner: CTO. Gate: a real ticket bought
   on TestFlight, scanned at the door.
2. **Land v0.2 (Pix) before any public store push.** Pix-or-bust for the
   Brazilian market. Owner: CTO.
3. **Premium membership (v0.3) within ~30 days of v0.2.** This is the
   recurring revenue lever and the strategic moat against generic
   ticketing platforms. Owner: CTO; pricing decision: CEO.
4. **Feed + broadcasts (v0.4).** Retention + re-activation. Without this
   the app is a transactional ticketing utility that any general-purpose
   platform can replace.
5. **DMs and championships (v0.5, v0.6).** Community lock-in. Defer
   investment until v0.4 metrics show the engagement hypothesis is real.

The ordering is dependency-aware: v0.1 requires Phase 0 deploy; v0.3
needs Stripe webhooks which are already in place from F4; v0.4 needs R2
uploads which are already in place from F2. We are not architecturally
blocked on any future phase — only on shipping the ones in front.

## 8. Go-to-market

- **Bootstrap (events 1–3 post-launch):** distribute the app at the gate
  of the next real Curitiba event. QR poster at the entrance. Ticket
  purchase via app gets a small perk vs Sympla. Lower friction, not
  lower price — we are not training the audience to expect discounts.
- **Word of mouth (events 4–10):** the existing JDM community in PR
  spreads to SP / RS / SC / SP-state. Push the app on each event's
  Instagram + WhatsApp groups before the gate.
- **Premium pitch:** anchored on "todos os eventos por R$X/mês" + premium
  badge in feed and championships. Sell to repeat attenders first; do
  not cold-acquire on premium.
- **Marketing push (F10) becomes the in-app growth loop** once the base
  exists. Targeted broadcasts ("attendees of São Paulo last month",
  "premium members in PR") will out-convert open broadcasts every time.

Out-of-scope GTM: paid ads, influencer deals, partnerships with car
shops. Reconsider once organic plateaus. Not before.

## 9. Unit economics (assumed; refine after first 3 events)

Working assumptions only. Replace with real numbers after the first
real-world event sells through.

- Avg ticket: R$30–80 → ~R$28–77 net after Stripe Brazil card fees, or
  ~R$29.5–78 net via Pix. Pix is materially cheaper at scale.
- Premium tier (initial assumption): R$49.90 monthly / R$499 annual.
  Member breaks even for the company at ~1.5 events/month attended; we
  must price above that threshold once we have attendance data.
- Capacity risk: heavy-attender members can crowd out direct-sale
  buyers at popular events. Mitigation: hold a configurable % of
  capacity for direct sale, the rest for grants. Implement when F8 lands;
  do not over-engineer pre-launch.

## 10. Risks and one-way doors

Risks the CEO actively monitors. CTO escalates anything in this list
before acting.

- **App Store / Play Store review.** Ticketing apps for physical events
  are allowed to use Stripe/Pix instead of IAP. We must keep this clean
  in the listing copy and not accidentally describe Premium in a way
  that sounds like digital goods (which would force IAP and a 30%
  haircut).
- **LGPD.** Account deletion (`POST /me/delete` with 30-day purge), data
  export (`POST /me/export`), and explicit consent capture separating
  transactional from marketing push. These ship with v0.2, not later.
  Non-negotiable.
- **Webhook integrity.** Orders only flip to `paid` from verified
  provider webhooks; webhooks are idempotent (dedupe by provider event
  id). This invariant is in `CLAUDE.md` and in the F4 plan; if a CTO
  deviates from it, that is a CEO-escalation event.
- **Stripe Brazil onboarding.** Requires CNPJ in good standing. Confirm
  before v0.1 launch — losing Stripe access mid-flight is a stop-the-world
  event.
- **AbacatePay vendor risk.** Smaller player than Stripe; webhook
  reliability and uptime should be monitored. If AbacatePay fails, we
  fall back to a generic PSP for Pix, but we do not block the rest of
  the roadmap on that contingency until we have data.
- **Capacity vs premium grants.** See unit economics. Solvable in code.
  Surface to CEO when first event hits sellout.
- **Ticket QR forgery.** QR codes are HMAC-signed server-side; the
  signing key is a one-way door. Rotation invalidates every issued
  ticket — must be planned, not fired in incident response.
- **Bus factor.** One-CTO company. Founding CTO must keep the repo and
  `handoff.md` such that a future hire onboards from artifacts, not from
  conversation.

## 11. KPIs to track from day one

Operational dashboards live with the CTO; the CEO tracks these weekly.

- **Funnel:** install → signup → email-verified → first ticket purchase.
- **Revenue:** GMV, take-rate, net revenue, by event and by payment
  rail (Stripe vs Pix).
- **Premium:** active members, gross adds, voluntary churn, involuntary
  churn (failed renewal), MRR, ARR run-rate.
- **Event health:** sellout rate per event, % capacity sold by gate
  open, no-show rate (issued vs scanned), check-in throughput.
- **Engagement (post-v0.4):** posts per event, comments per post,
  time-to-first-post per attendee, broadcast open rate.
- **Retention:** repeat-purchase rate (% of buyers who buy a second
  ticket within 90 days), member tenure.

## 12. Org and hiring posture

- **Today:** CEO + one founding CTO (player-coach). The CTO writes code
  and sets technical direction. UX, QA, and SecurityEngineer are
  pre-authorized hires the CTO can submit when scope demands; CEO
  approves the hire.
- **First hire bias:** mobile / RN engineer once Phase 2 (Premium + Feed)
  commits and Phase 3 (DMs + voting) appears on the horizon. Mobile is
  where most user-facing risk lives.
- **Second hire:** designer / UX once F9 (Feed) and F10 (Broadcasts)
  start; community-facing surfaces deserve dedicated UX.
- **Do not hire** generalist engineers, project managers, or growth
  hires before there is product traction to justify the burn.

## 13. Cross-cutting commitments

These apply to every release. The CTO encodes them; the CEO holds the
line.

- PT-BR primary, i18n scaffold from day one.
- LGPD: deletion + export endpoints, explicit consent split between
  transactional and marketing push.
- Rate limiting on `/auth/*`, ticketing, and admin broadcast endpoints.
- Signed ticket QR codes (HMAC); pre-signed R2 URLs with short TTL;
  CORS locked to known origins.
- Integration tests hit a real Postgres (Testcontainers or preview DB),
  not mocks. Mocked migrations have burned us; do not repeat.
- Sentry on all three surfaces; structured logs with request IDs; minimal
  PII in logs.
- Rollback path required for every deploy. No deploy without one.

## 14. Decision log (append-only)

- **2026-04-29 — Plan v1 written.** CEO ratifies the v0.1–v0.6 release
  ladder in `plans/roadmap.md` as the commercial roadmap. v0.2 (Pix) is
  the public-launch gate.
