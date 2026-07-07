# Access-Management Policy

Version: 1.0
Effective: 2026-05-15
Owner: CTO
Review cadence: every 6 months or after any role/route change

## 1. Purpose

Define how JDM Experience controls access to its API, admin panel, and mobile app.
Satisfy LGPD Art. 46 (security safeguards) requirement L15.

## 2. Roles

| Role        | Scope                                                                                | Assignment                                                                                            |
| ----------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `user`      | Default. Read public events/store, own profile, tickets, orders, feed participation. | Self-registration via `/auth/signup`, or admin creates via `POST /admin/users` (always `user` role).  |
| `staff`     | Check-in surface only: verify tickets, claim extras, issue pickup vouchers.          | Direct DB update (`UPDATE "User" SET role = 'staff'`). No API endpoint for role assignment today.     |
| `organizer` | Event/store/finance CRUD, broadcasts, feed moderation, support triage.               | Direct DB update (`UPDATE "User" SET role = 'organizer'`). No API endpoint for role assignment today. |
| `admin`     | All organizer permissions plus user create/disable/enable. Highest privilege.        | Seeded or promoted by direct DB update. No self-service escalation.                                   |

### 2.1 Principle of least privilege

- New accounts default to `user`.
- Role escalation requires direct DB access (no API endpoint for role changes today).
- No endpoint exists for self-promotion.
- `staff` cannot access events, finance, broadcasts, or user management.
- **Gap**: Role changes are unaudited. See follow-up issue for adding a role-change API with audit trail.

## 3. Authentication

| Layer               | Mechanism                                                      |
| ------------------- | -------------------------------------------------------------- |
| Token format        | JWT (access + refresh pair)                                    |
| Verification        | `verifyAccessToken()` in `plugins/auth.ts`                     |
| Account status gate | Disabled users rejected at auth layer before any route handler |
| MFA                 | Optional TOTP for admin-panel users; challenge issued at login |
| Token payload       | `sub` (user ID), `role`                                        |

### 3.1 Public routes (no token required)

| Route                          | Method | Purpose                                     |
| ------------------------------ | ------ | ------------------------------------------- |
| `/health`                      | GET    | Healthcheck                                 |
| `/auth/signup`                 | POST   | Register new account                        |
| `/auth/login`                  | POST   | Login with email/password                   |
| `/auth/verify`                 | GET    | Verify email via token (query param)        |
| `/auth/resend-verify`          | POST   | Resend verification email                   |
| `/auth/refresh`                | POST   | Refresh access token                        |
| `/auth/logout`                 | POST   | Revoke refresh token                        |
| `/auth/forgot-password`        | POST   | Request password reset                      |
| `/auth/reset-password`         | POST   | Reset password with token                   |
| `/auth/mfa/verify`             | POST   | Complete MFA challenge with TOTP code       |
| `/auth/mfa/recovery`           | POST   | Complete MFA challenge with recovery code   |
| `/events`                      | GET    | List published events                       |
| `/events/:slug`                | GET    | Event detail by slug                        |
| `/events/by-id/:id`            | GET    | Event detail by ID                          |
| `/events/:slug/confirmed-cars` | GET    | Confirmed cars for event                    |
| `/store/products`              | GET    | List store products                         |
| `/store/products/:slug`        | GET    | Product detail by slug                      |
| `/store/collections`           | GET    | List collections                            |
| `/store/product-types`         | GET    | List product types                          |
| `/store/settings`              | GET    | Public store settings                       |
| `/stripe/webhook`              | POST   | Stripe payment webhook (signature-verified) |
| `/abacatepay/webhook`          | POST   | AbacatePay Pix webhook (signature-verified) |

Feed read (`GET /events/:eventId/feed`) uses soft/optional auth via `tryAuth`.

### 3.2 Authenticated routes (valid token required)

| Route                        | Method  | Purpose                                                                         |
| ---------------------------- | ------- | ------------------------------------------------------------------------------- |
| `/me`, `/me/*`               | Various | Profile, cars, tickets, orders, notifications, shipping, support, device tokens |
| `/cart`, `/cart/*`           | Various | Cart CRUD, checkout                                                             |
| `/orders`, `/orders/*`       | Various | Order creation, checkout                                                        |
| `/uploads/presign`           | POST    | Pre-signed upload URL                                                           |
| `/events/:slug/commerce`     | GET     | Event commerce data                                                             |
| `/events/by-id/:id/commerce` | GET     | Event commerce data by ID                                                       |
| `/events/:eventId/feed/*`    | Various | Feed write: posts, comments, reactions, reports                                 |

### 3.3 Admin routes (token + role guard)

All routes under `/admin` prefix. Four authorization scopes enforced by scope-level `requireRole()` hooks in `routes/admin/index.ts`.

## 4. Authorization tiers

### Tier 1a: Staff + Organizer + Admin (MFA enrollment)

MFA self-service for any admin-panel user.

| Endpoint                    | Method | Purpose                            |
| --------------------------- | ------ | ---------------------------------- |
| `/admin/mfa/status`         | GET    | Check own MFA enrollment status    |
| `/admin/mfa/setup`          | POST   | Start TOTP enrollment (returns QR) |
| `/admin/mfa/verify-setup`   | POST   | Confirm enrollment with first code |
| `/admin/mfa`                | DELETE | Disable MFA (requires valid code)  |
| `/admin/mfa/recovery-codes` | POST   | Regenerate recovery codes          |

### Tier 1b: Staff + Organizer + Admin (Check-in)

Check-in surface only.

| Endpoint                            | Method |
| ----------------------------------- | ------ |
| `/admin/tickets/check-in`           | POST   |
| `/admin/extras/claim`               | POST   |
| `/admin/store/pickup/voucher/claim` | POST   |
| `/admin/check-in/events`            | GET    |

### Tier 2: Organizer + Admin

Core admin operations: events, tiers, extras, tickets, finance, store management, broadcasts, feed moderation, support, settings.

See full route list in RBAC Audit Checklist (Appendix A).

### Tier 3: Admin only

User mutations with rate limit (30 req/min):

| Endpoint                   | Method |
| -------------------------- | ------ |
| `/admin/users`             | POST   |
| `/admin/users/:id/disable` | POST   |
| `/admin/users/:id/enable`  | POST   |

## 5. Rate limiting

| Surface                       | Limit      | Key strategy                                                                 |
| ----------------------------- | ---------- | ---------------------------------------------------------------------------- |
| `/auth/*`                     | 10 req/min | `IP:email` from request body; bodyless routes (GET /auth/verify) use IP-only |
| Admin user mutations (Tier 3) | 30 req/min | User ID or IP                                                                |

## 6. Safeguards

- Webhooks verify provider signature on every request; no auth token bypass.
- Webhook endpoints are public but idempotent with event-ID deduplication.
- Pre-signed R2 URLs use short TTL; no public-read buckets.
- CORS locked to known origins.
- Ticket QR codes HMAC-signed server-side.

## 7. Access review process

1. On any PR that adds or changes routes under `/admin`, reviewer must verify the `requireRole()` guard matches the intended tier.
2. Every 6 months, run the RBAC audit checklist (Appendix A) and attach results to a new issue.
3. Role grants are logged via `user.role_changed` audit action. The `PATCH /admin/users/:id/role` endpoint records old role, new role, and actor on every change.

## 8. Incident response

- Compromised admin account: disable via `POST /admin/users/:id/disable`, rotate JWT signing secret, rotate `MFA_ENCRYPTION_KEY`, invalidate all refresh tokens.
- Unauthorized access detected: check admin audit log, disable account, escalate to CTO.

---

## Appendix A: RBAC Audit Checklist

Last audit: 2026-05-15
Auditor: Orion (JDMA-654)
Result: **3 drift items found and addressed**

### A.1 Role definitions

- [x] Roles defined in `packages/db/prisma/schema.prisma` (UserRole enum): `user`, `organizer`, `admin`, `staff`
- [x] Roles mirrored in `packages/shared/src/auth.ts` (userRoleSchema)
- [x] Default role is `user`
- [x] No self-promotion endpoint exists

### A.2 Auth middleware

- [x] `authPlugin` registered in `app.ts`
- [x] JWT verification via `verifyAccessToken()` in `plugins/auth.ts`
- [x] Disabled-user check at auth layer (line 47-50)
- [x] `requireRole()` returns 403 for unauthorized roles
- [x] `requireUser()` helper narrows TypeScript type after auth
- [x] MFA challenge flow: login returns short-lived `mfaToken` when MFA enrolled; `/auth/mfa/verify` and `/auth/mfa/recovery` exchange it for full session

### A.3 Admin route guards

- [x] All admin routes nested under `/admin` prefix
- [x] Four scope blocks with cascading `requireRole()` hooks in `routes/admin/index.ts`
- [x] Tier 1a (staff+organizer+admin): MFA enrollment self-service
- [x] Tier 1b (staff+organizer+admin): check-in surface only
- [x] Tier 2 (organizer+admin): events, tiers, extras, tickets, finance, store, broadcasts, feed moderation, support, settings
- [x] Tier 3 (admin only): user create/disable/enable with rate limit
- [x] No admin routes exist outside `/admin` prefix
- [x] No unguarded routes within `/admin`

### A.4 User-facing protected routes

- [x] All `/me/*` routes use `{ preHandler: [app.authenticate] }`
- [x] Cart routes authenticated
- [x] Order routes authenticated
- [x] Upload presign authenticated
- [x] Feed write endpoints authenticated
- [x] Support ticket creation authenticated
- [x] Commerce endpoints (`/events/:slug/commerce`, `/events/by-id/:id/commerce`) authenticated

### A.5 Public routes

- [x] Health check (`/health`): no auth
- [x] Auth endpoints (`/auth/*`): no auth (rate limited); mix of POST and GET (`/auth/verify` is GET); MFA challenge routes (`/auth/mfa/verify`, `/auth/mfa/recovery`) use short-lived MFA token, no session auth
- [x] Event list/detail (`/events`, `/events/:slug`, `/events/by-id/:id`): no auth
- [x] Confirmed cars (`/events/:slug/confirmed-cars`): no auth
- [x] Store products (`/store/products`, `/store/products/:slug`): no auth
- [x] Store collections (`/store/collections`): no auth
- [x] Store product types (`/store/product-types`): no auth
- [x] Store settings (`/store/settings`): no auth
- [x] Webhooks (`/stripe/webhook`, `/abacatepay/webhook`): no auth (signature-verified)
- [x] Feed read (`GET /events/:eventId/feed`): optional soft auth via `tryAuth`

### A.6 Rate limiting

- [x] `/auth/*` rate limited (10/min, key `IP:email` from body; bodyless GET routes fall back to IP-only)
- [x] Admin user mutations rate limited (30/min per user ID or IP)

### A.7 Drift findings

1. **`publicProfileSchema` missing `staff` role** (`packages/shared/src/profile.ts:51`): The `/me` endpoint serialization would reject staff users because `publicProfileSchema.role` only accepted `['user', 'organizer', 'admin']`. **Fixed in this PR** by adding `'staff'` to the enum.
2. **Role-change audit trail added**: `PATCH /admin/users/:id/role` endpoint added with `user.role_changed` audit action recording old role, new role, and actor. Admin-only guard (Tier 3). Rate limited at 30/min per user ID.

3. **MFA routes not documented**: Admin MFA enrollment routes (`/admin/mfa/*`) and auth MFA challenge routes (`/auth/mfa/verify`, `/auth/mfa/recovery`) were added in #307 but not reflected in this policy. **Fixed in this PR** by adding Tier 1a, updating public route table, and updating audit checklist.

All route guards are correctly applied. No unguarded endpoints found.
