# Mobile web deploy — Vercel

Production and per-PR preview environments for the Expo client app exported
to web. Reuses the same codebase as `apps/mobile` (iOS + Android). Build
config lives in `apps/mobile/vercel.json`.

## What works on web

- Authentication (email + password, session via localStorage —
  `src/auth/storage.web.ts`).
- Browsing events, event detail, ticket viewing.
- Cart add/remove flows and profile / garage navigation.
- Check-in QR (rendered via `react-native-qrcode-svg` under `react-native-web`).
- Sentry error reporting.

## What does not work on web (intentionally stubbed or no-op)

- **Card / Apple Pay payments (Stripe).** `@stripe/stripe-react-native` is
  native-only and aliased to a web stub at
  `apps/mobile/src/stripe/web-stub.tsx` via `metro.config.js`. The buy
  button surfaces "Pagamento só disponível no app". See
  `plans/brainstorm.md` for the planned web purchase paths (Stripe Checkout
  / Payment Element).
- **Pix (AbacatePay).** Will work on web automatically once F4 ships
  (REST-only flow, no native deps).
- **Push notifications.** `usePushRegistration` early-returns when
  `Platform.OS === 'web'`. Browser push (Web Push) is a separate future
  scope.

## One-time setup

1. **Create project.** Go to vercel.com → Add New Project → import the
   GitHub repo `leaopedro/jdm`.
   - **Project name:** `jdm-mobile-web`.
   - **Root directory:** `apps/mobile` (Vercel scopes all paths relative to
     this directory).
   - **Framework preset:** Other (not Next.js).
   - **Build & Output Settings:** leave overrides empty. The tracked
     `apps/mobile/vercel.json` overrides the build command to
     `pnpm --filter @jdm/shared build && pnpm run build`, and
     `apps/mobile`'s `build` script exports the app with Expo while only
     rebuilding `@jdm/shared` if its `dist/` output is missing in a fresh
     local worktree. `apps/mobile/vercel.json` also sets
     `outputDirectory: dist` so Vercel knows where Expo wrote the static
     export.

2. **Environment variables.** Set the following in Project → Settings →
   Environment Variables. Create a value per scope (`Production`,
   `Preview`, `Development`) where they differ.

   | Variable                             | Production / Preview                            | Notes                                                      |
   | ------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------- |
   | `EXPO_PUBLIC_API_BASE_URL`           | `https://jdm-production.up.railway.app`         | Required. Web client calls Railway prod API.               |
   | `EXPO_PUBLIC_SENTRY_DSN`             | Sentry mobile DSN                               | Optional but recommended.                                  |
   | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | leave empty                                     | Stripe is stubbed on web.                                  |
   | `APP_VARIANT`                        | `production` (Production) / `preview` (Preview) | Drives bundle id / display name suffix in `app.config.ts`. |
   | `SENTRY_ORG`                         | Sentry org slug                                 | Source-map upload during build.                            |
   | `SENTRY_PROJECT_MOBILE`              | Sentry project name                             | e.g. `mobile`.                                             |
   | `SENTRY_AUTH_TOKEN`                  | Sentry auth token                               | Source-map upload; do not expose to browser.               |

3. **Preview deploys.** Vercel enables preview deploys per PR by default.
   Every PR targeting `main` gets a unique `*.vercel.app` URL with a Vercel
   bot comment on the PR.

4. **Production domain (optional).** Project → Settings → Domains → add
   the chosen domain (e.g. `app.jdmexperience.com.br`). Vercel handles
   TLS automatically. Record the final URL and update `CORS_ORIGINS` in
   Railway (see step 5).

5. **Tighten CORS in Railway.** Once the production web domain is known,
   add it to the Railway service variables alongside the existing admin
   domain:

   ```
   CORS_ORIGINS=https://admin.jdmexperience.com.br,https://app.jdmexperience.com.br,https://jdm-admin.vercel.app,https://jdm-mobile-web.vercel.app
   ```

   Include any Vercel preview pattern if web preview builds need to hit
   the API. Redeploy the Railway service after changing this.

## Deploy

- **Preview:** automatic on every PR open/push. Vercel builds and posts a
  preview URL as a PR comment within ~2 minutes.
- **Production:** automatic on merge to `main`. Vercel promotes the build
  to production.
- **Manual redeploy:** Vercel dashboard → Deployments → Redeploy (no cache).

## Local branch smoke

Use this when a mobile PR changes navigation, IA, auth-adjacent behavior,
or other flows that can be exercised on Expo web before a native smoke.

### Preconditions

1. Bring up Postgres:

```bash
docker compose up -d
```

2. If you are in a Paperclip / Claude worktree, bootstrap the worktree
   itself before starting Expo or the API. Borrowed/symlinked installs can
   produce false negatives such as Metro failing to resolve
   `@jdm/shared/*`.

```bash
pnpm install --offline --force
pnpm --filter @jdm/shared build
pnpm --filter @jdm/db db:generate
pnpm --filter @jdm/db build
```

3. Create local env files if missing:

```bash
cp -n apps/api/.env.example apps/api/.env
cp -n packages/db/.env.example packages/db/.env
```

4. Remove blank AbacatePay dev vars from `apps/api/.env` or replace them
   with real values. The current env parser treats empty strings as
   invalid values rather than "unset", so the API will fail fast if these
   keys are present but blank.

5. Apply migrations and seed:

```bash
pnpm --filter @jdm/db db:deploy
pnpm --filter @jdm/db db:seed
```

6. Start the API and Expo web:

```bash
pnpm --filter @jdm/api dev
pnpm --filter @jdm/mobile start:web --port 8081
```

Wait for API `listening on 0.0.0.0:4000` and Expo `Web is waiting on http://localhost:8081`.

### Smoke flow

1. Open `http://localhost:8081/signup`.
2. Create a fresh account with email/password.
3. Watch the API terminal for the `[dev-mail]` verification link and open
   that link in the browser. The app currently lands on
   `/verify-email-pending` until the verification URL is followed.
4. Continue through the target flow.

### Good fits for web smoke

- Profile / account information architecture changes.
- Cart add/remove flows up to the point where native payment would start.
- Event browsing, event detail, and ticket list/detail rendering.
- Deep-link and post-auth routing behavior.

### Known limits

- Stripe remains stubbed on web; payment completion still needs a native
  device/dev-client smoke.
- Push registration is intentionally skipped on web.
- Some native-only package drift warnings may appear in Expo startup logs;
  treat those as maintenance follow-up, not automatic blockers, unless
  they break bundling or the target flow.

## Verification (smoke test after first deploy)

Open the Vercel preview URL from a PR and verify:

- [ ] `/login` loads and email/password auth succeeds (auth → localStorage session).
- [ ] `/events` lists events fetched from Railway prod API.
- [ ] Event detail page renders (image, copy, ticket button).
- [ ] Ticket purchase button on web shows graceful "Pagamento só disponível no app" message (Stripe stub).
- [ ] No console errors from `react-native-web`, Expo Router, or Sentry init.
- [ ] Sentry receives a session.

## Troubleshooting

| Symptom                                                 | Likely cause                                                     | Fix                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Build fails: `Cannot find module '@jdm/shared'`         | `installCommand` not running from repo root                      | Ensure `vercel.json` `buildCommand` starts with `cd ../.. && pnpm install --frozen-lockfile`.   |
| `EXPO_PUBLIC_API_BASE_URL` undefined in browser         | Env var not set for the deploy scope                             | Add it under the matching scope (Preview/Production) in Vercel → Settings → Env vars.           |
| API calls return CORS errors                            | `CORS_ORIGINS` not updated in Railway after adding Vercel domain | Update Railway `CORS_ORIGINS` and redeploy.                                                     |
| API fails at boot with `ABACATEPAY_*` validation errors | `apps/api/.env` copied empty optional AbacatePay keys            | Delete the blank `ABACATEPAY_*` lines or set real values.                                       |
| Local worktree Metro cannot resolve `@jdm/shared/*`     | Worktree dependencies were borrowed instead of installed locally | Run `pnpm install --offline --force` in the worktree, then rebuild `@jdm/shared` and `@jdm/db`. |
| Bundle includes `codegenNativeCommands` errors          | Native-only module not aliased on web                            | Add the package to the platform alias map in `apps/mobile/metro.config.js` (see Stripe).        |
| Push notification UI prompts in browser                 | Missing `Platform.OS === 'web'` guard                            | Guard the call site; see `src/notifications/use-push-registration.ts`.                          |
| Sentry source maps missing                              | `SENTRY_AUTH_TOKEN` not set                                      | Set the token in Vercel env vars.                                                               |
