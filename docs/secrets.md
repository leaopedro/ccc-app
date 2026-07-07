# Secrets inventory

| Secret                                                        | Used by                  | Stored in                            | Local source                             | Rotation                                                                                                                               |
| ------------------------------------------------------------- | ------------------------ | ------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                | api, db                  | Railway variables (prod/preview)     | `apps/api/.env`, `packages/db/.env`      | Rotate by regenerating Postgres plugin creds; redeploy.                                                                                |
| `JWT_ACCESS_SECRET`                                           | api                      | Railway                              | `apps/api/.env`                          | 32+ bytes random. Rotating invalidates all access tokens instantly.                                                                    |
| `REFRESH_TOKEN_PEPPER`                                        | api                      | Railway                              | `apps/api/.env`                          | Mixed into SHA-256 refresh-token hash. Rotating forces logout everywhere.                                                              |
| `APP_WEB_BASE_URL`                                            | api                      | Railway + local                      | `apps/api/.env`                          | Used in verify/reset email links. Immutable per env.                                                                                   |
| `MAIL_FROM`                                                   | api                      | Railway + local                      | `apps/api/.env`                          | e.g. `noreply@jdmexperience.com.br`.                                                                                                   |
| `SENTRY_DSN` (shared)                                         | api, admin (server/edge) | Railway + Vercel                     | `apps/api/.env`, `apps/admin/.env.local` | One DSN reused across all three apps; events tagged by `service` (api/admin/mobile). Regenerate in Sentry project → update everywhere. |
| `NEXT_PUBLIC_SENTRY_DSN`                                      | admin (browser)          | Vercel                               | `apps/admin/.env.local`                  | Same value as `SENTRY_DSN`. Exposed to browser.                                                                                        |
| `EXPO_PUBLIC_SENTRY_DSN`                                      | mobile (native + web)    | EAS secrets + Vercel (mobile-web)    | `apps/mobile/.env`                       | Same value as `SENTRY_DSN`. Bundled at build time.                                                                                     |
| `SENTRY_DEBUG`                                                | api, admin               | Railway + Vercel (optional)          | not in local `.env`                      | Set to `1` to expose `/debug/boom` (api) and `/debug/sentry` (admin) in production for smoke tests. Leave unset otherwise.             |
| `SENTRY_AUTH_TOKEN`                                           | CI (source map upload)   | GitHub Actions secret + Vercel       | N/A                                      | 180 days.                                                                                                                              |
| `STRIPE_SECRET_KEY`                                           | api                      | Railway                              | `apps/api/.env`                          | Rotate in Stripe dashboard; update Railway; redeploy.                                                                                  |
| `STRIPE_WEBHOOK_SECRET`                                       | api                      | Railway                              | `apps/api/.env`                          | Rotated whenever webhook endpoint URL changes.                                                                                         |
| `TICKET_CODE_SECRET`                                          | api                      | Railway                              | `apps/api/.env`                          | 32+ bytes random. Rotate with a staged QR/token compatibility plan because historical signed payloads may need overlap handling.       |
| `FIELD_ENCRYPTION_KEY`                                        | api                      | Railway                              | `apps/api/.env`                          | 64 hex chars. Initial prod set can be random before any encrypted prod data exists; rotation later requires a re-encryption plan.      |
| `ABACATEPAY_API_KEY`                                          | api                      | Railway                              | `apps/api/.env`                          | Per AbacatePay dashboard.                                                                                                              |
| `ABACATEPAY_WEBHOOK_SECRET`                                   | api                      | Railway                              | `apps/api/.env`                          | Same.                                                                                                                                  |
| `ABACATEPAY_DEV_WEBHOOK_ENABLED`                              | api                      | Railway                              | `apps/api/.env`                          | Safety override for internal testing only. Default `false`. When `true`, production accepts `devMode` AbacatePay webhooks.             |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | api                      | Railway                              | `apps/api/.env`                          | Cloudflare dashboard; rotate on incident.                                                                                              |
| `R2_BUCKET` (prod + preview)                                  | api                      | Railway                              | `apps/api/.env`                          | Immutable per environment.                                                                                                             |
| `EXPO_TOKEN`                                                  | CI (EAS build)           | GitHub Actions secret                | N/A                                      | Rotate in expo.dev.                                                                                                                    |
| `EAS_PROJECT_ID`                                              | mobile                   | Committed to `app.config.ts` via env | `apps/mobile/.env`                       | Immutable.                                                                                                                             |
| `APPLE_ID` / `ASC_APP_ID`                                     | EAS submit               | EAS secrets                          | N/A                                      | Per Apple ID lifecycle.                                                                                                                |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`                            | EAS submit               | EAS secrets                          | N/A                                      | Regenerate in Play Console.                                                                                                            |
| `RESEND_API_KEY` (or Postmark)                                | api (email verify/reset) | Railway                              | `apps/api/.env`                          | Per provider; low traffic.                                                                                                             |
| `GOOGLE_CLIENT_ID`                                            | api (F1 Google sign-in)  | Railway                              | `apps/api/.env`                          | Web client ID (audience for mobile + admin ID tokens).                                                                                 |
| `APPLE_CLIENT_ID`                                             | api (F1 Apple sign-in)   | Railway                              | `apps/api/.env`                          | Apple Service ID (audience) for mobile sign-in.                                                                                        |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS`                            | mobile                   | EAS secrets                          | `apps/mobile/.env`                       | iOS OAuth client ID.                                                                                                                   |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID`                        | mobile                   | EAS secrets                          | `apps/mobile/.env`                       | Android OAuth client ID.                                                                                                               |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB`                            | mobile                   | EAS secrets                          | `apps/mobile/.env`                       | Web client ID (matches `GOOGLE_CLIENT_ID` on API).                                                                                     |

## F1 — Auth notes

Generate `JWT_ACCESS_SECRET` and `REFRESH_TOKEN_PEPPER` with `openssl rand -base64 48`. Rotate them together when compromise is suspected; doing so logs every user out (access tokens expire immediately; refresh tokens no longer hash-match).

## New-developer setup

1. `cp apps/api/.env.example apps/api/.env`
2. `cp apps/admin/.env.example apps/admin/.env.local`
3. `cp apps/mobile/.env.example apps/mobile/.env`
4. `cp packages/db/.env.example packages/db/.env`
5. `docker compose up -d postgres`
6. `pnpm install && pnpm --filter @jdm/db db:migrate && pnpm --filter @jdm/db db:generate`
7. `pnpm dev` — runs all three apps via Turbo.
8. Ask the team lead for dev values of any remaining secrets above (most can
   start empty for Phase 0).

## Production secret rotation checklist

- [ ] Update secret in source (Stripe/Sentry/etc.).
- [ ] Update secret in Railway / Vercel / EAS / GitHub Actions.
- [ ] Redeploy affected service.
- [ ] Verify `/health` + a canary endpoint still return 200.
- [ ] Record rotation date in this doc's change log below.

## Admin (Vercel)

The admin app runs on Vercel and calls the Railway API from the browser. All `NEXT_PUBLIC_*` vars are exposed to clients.

- `NEXT_PUBLIC_API_BASE_URL` — Railway API base URL. Local dev: `http://localhost:4000`. Production: e.g. `https://api-production.up.railway.app`. Immutable per environment.
- `SENTRY_DSN` — Sentry ingest URL (shared across api/admin/mobile). Server-side only.
- `NEXT_PUBLIC_SENTRY_DSN` — Same DSN, exposed to the admin browser bundle.
- `SENTRY_DEBUG` (optional) — Set to `1` to enable `/debug/sentry` in production (admin). Leave unset normally.
- `SENTRY_ORG` — Sentry organization slug (used at build time for source map upload).
- `SENTRY_PROJECT_ADMIN` — Sentry project identifier for admin (used at build time).
- `SENTRY_AUTH_TOKEN` — Sentry API token for releasing/source map uploads. Build-time only; never sent to browser.

Note: The Railway API must configure `CORS_ORIGINS` to include the admin domain (Vercel preview URL + production domain) so browser requests succeed.

Note: R2 buckets enforce their own CORS policy, separate from the API's `CORS_ORIGINS`. Browser PUTs to presigned URLs require the bucket's CORS rules to include the requesting origin. See `docs/r2.md` for the canonical spec (`infra/r2-cors.json`) and runbook.

## Change log

- (append entries: `YYYY-MM-DD · secret · rotated by`)
