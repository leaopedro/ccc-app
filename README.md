# JDM Experience

Event-company app (React Native attendee app + Next.js admin web + Fastify API).
Brazilian, PT-BR first, LGPD-aware.

## Prereqs

- Node 22 LTS (`nvm use` honors `.nvmrc`)
- pnpm 10 (`corepack enable && corepack prepare pnpm@10.4.1 --activate`)
- Docker Desktop (for local Postgres)
- (Optional, for mobile) Xcode 16 + iOS Simulator, Android Studio with an AVD,
  EAS CLI (`pnpm dlx eas-cli login`)

## First run

```bash
# 1. Clone + install
git clone git@github.com:leaopedro/jdm.git
cd jdm
pnpm install

# 2. Copy env files
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env
cp packages/db/.env.example packages/db/.env

# 3. Start Postgres + run migrations
docker compose up -d postgres
pnpm --filter @jdm/db db:migrate
pnpm --filter @jdm/db db:generate

# 4. Run everything
pnpm dev
```

After `pnpm dev`:

- API → http://localhost:4000/health
- Admin → http://localhost:3000
- Mobile → open the Expo Dev Tools QR, scan with Expo Go or a dev build.

Local Postgres binds host port **5433** (not the default 5432) to dodge
conflicts with any Homebrew Postgres already running.

## Running individual apps

```bash
pnpm --filter @jdm/api dev
pnpm --filter @jdm/admin dev
pnpm --filter @jdm/mobile start
```

## Tests

```bash
pnpm test                    # all workspaces
pnpm --filter @jdm/api test  # api only (spins up Postgres via Testcontainers)
```

Run a single test:

```bash
pnpm --filter @jdm/api exec vitest run test/health.test.ts -t "returns ok"
```

## Lint + typecheck + format

```bash
pnpm lint
pnpm typecheck
pnpm format         # write
pnpm format:check   # verify
```

## Deploying

- **API** → push to `main` → Railway auto-deploys. See `RAILWAY.md`.
- **Admin** → push to `main` → Vercel auto-deploys. See `docs/vercel.md`.
- **Mobile** → `eas build --profile preview --platform ios|android`. See
  `docs/eas-credentials.md`.

## Repo layout

```
apps/api           Fastify + Prisma REST API
apps/admin         Next.js organizer web app
apps/mobile        Expo attendee app (React Native)
packages/shared    Zod schemas shared across apps
packages/db        Prisma schema + client singleton
packages/tsconfig  Shared tsconfig bases
```

## Planning docs

High-level product and architecture decisions live in two **local-only**
documents maintained by the team lead: `brainstorm.md` (architecture brief,
feature map F1–F12) and `roadmap.md` (ordered task list per phase). They are
listed in `.git/info/exclude` and are never committed.

The Phase 0 scaffold was driven by `phase-0-plan.md` (committed for audit
trail).

## Support

- Bugs: GitHub Issues in this repo.
- Internal channels: see `docs/secrets.md` for where each external service
  lives.
