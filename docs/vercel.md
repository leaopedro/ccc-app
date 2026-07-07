# Vercel deploy — admin

Production and per-PR preview environments for the Next.js admin app.
Build config lives in `apps/admin/vercel.json` (monorepo-aware install +
build commands, `.next` output directory).

## One-time setup

1. **Create project.** Go to vercel.com → Add New Project → import the
   GitHub repo `leaopedro/jdm`.
   - **Root directory:** `apps/admin` (Vercel scopes all paths relative to
     this directory).
   - **Framework preset:** Next.js (auto-detected).
   - **Build & Output Settings:** leave overrides empty — `apps/admin/vercel.json`
     already sets `buildCommand`, `installCommand`, and `outputDirectory`.
     Vercel picks this up automatically.

2. **Environment variables.** Set the following in Project → Settings →
   Environment Variables. Create a value per scope (`Production`,
   `Preview`, `Development`) where they differ.

   | Variable                   | Production          | Preview              | Notes                                                                   |
   | -------------------------- | ------------------- | -------------------- | ----------------------------------------------------------------------- |
   | `NEXT_PUBLIC_API_BASE_URL` | Railway prod URL¹   | Railway preview URL² | Required before first deploy                                            |
   | `SENTRY_DSN`               | Sentry admin DSN    | same                 | Exposed to browser (NEXT*PUBLIC* not needed — set in `next.config.mjs`) |
   | `SENTRY_ORG`               | Sentry org slug     | same                 | e.g. `jdm-experience`                                                   |
   | `SENTRY_PROJECT_ADMIN`     | Sentry project name | same                 | e.g. `admin`                                                            |
   | `SENTRY_AUTH_TOKEN`        | Sentry auth token   | same                 | Source-map upload; keep out of browser (no `NEXT_PUBLIC_` prefix)       |

   ¹ Railway prod API URL from `docs/railway.md` → Step 5 (Generate Domain).
   ² For preview envs, use the same prod URL unless you have Railway PR environments configured; admin preview builds still call prod API.

3. **Preview deploys.** Vercel enables preview deploys per PR by default.
   Every PR targeting `main` gets a unique `*.vercel.app` URL with a Vercel
   bot comment on the PR.

4. **Production domain (optional).** Project → Settings → Domains → add
   your custom domain (e.g. `admin.jdmexperience.com.br`). Vercel handles
   TLS automatically. Record the final URL and update `CORS_ORIGINS` in
   Railway (see below).

5. **Tighten CORS in Railway.** Once the production admin domain is known,
   replace the bootstrap `CORS_ORIGINS=*` in Railway variables with the
   exact origins:

   ```
   CORS_ORIGINS=https://admin.jdmexperience.com.br,https://jdm-admin.vercel.app
   ```

   Include any Vercel preview domain pattern if the admin calls the API
   from preview builds. Redeploy the Railway service after changing this.

## Deploy

- **Preview:** automatic on every PR open/push. Vercel builds and posts a
  preview URL as a PR comment within ~2 minutes.
- **Production:** automatic on merge to `main`. Vercel promotes the build
  to production.
- **Manual redeploy:** Vercel dashboard → Deployments → Redeploy (no cache).

## Verification

After the first deploy:

1. Open the Vercel preview URL from a PR → the admin login page loads.
2. Log in with a test organizer account → `/events` page loads and lists
   events fetched from the Railway API.
3. On production: `https://<admin-domain>/` redirects to `/login` (HTTP 200
   after redirect); `https://<api-domain>/health` returns `{ "status": "ok" }`.
4. Check Sentry → new session appears under the `admin` project after
   navigating a few pages.

## Troubleshooting

| Symptom                                            | Likely cause                                                     | Fix                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Build fails: `Cannot find module '@jdm/shared'`    | `installCommand` not running from repo root                      | Ensure `vercel.json` `installCommand` is `cd ../.. && pnpm install --frozen-lockfile` |
| `NEXT_PUBLIC_API_BASE_URL` is undefined in browser | Env var not set for the `Preview` scope                          | Add it under Preview in Vercel → Settings → Env vars                                  |
| API calls return CORS errors                       | `CORS_ORIGINS` not updated in Railway after adding Vercel domain | Update Railway `CORS_ORIGINS` and redeploy                                            |
| Sentry source maps missing                         | `SENTRY_AUTH_TOKEN` not set                                      | Set the token in Vercel env vars (non-`NEXT_PUBLIC_`)                                 |
| Build fails: `pnpm: command not found`             | Vercel Node/corepack version                                     | Set `ENABLE_EXPERIMENTAL_COREPACK=1` in Vercel env vars                               |
