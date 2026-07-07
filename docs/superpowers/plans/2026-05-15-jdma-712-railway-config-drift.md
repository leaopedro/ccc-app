# JDMA-712 Railway Config Drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the live Railway deploy path, remove repo config ambiguity, restore the failed production API deploy, and document the missing secret contract that caused the crash loop.

**Architecture:** Use live Railway metadata and deployment logs as the authority for the production service, then reconcile the repo to that proven path. Keep the canonical config at repo-root `railway.json`, remove the stale nested config, document the required Railway secrets, and restore production by setting the missing `FIELD_ENCRYPTION_KEY` and redeploying.

**Tech Stack:** Railway deploy config, Dockerfile builder, pnpm workspace, Fastify API, Prisma migrations, Markdown runbook docs

---

### Task 1: Prove the authoritative deploy path and capture the root cause

**Files:**

- Modify: `docs/superpowers/plans/2026-05-15-jdma-712-railway-config-drift.md`
- Reference: `railway.json`
- Reference: `apps/api/railway.json`
- Reference: `apps/api/Dockerfile`
- Reference: `docs/railway.md`

- [x] **Step 1: Confirm the worktree is clean and isolated**

Run: `git status --short && git branch --show-current`
Expected: no modified files and branch `worktree-jdma-712`

- [x] **Step 2: Record the config drift evidence**

Run: `diff -u railway.json apps/api/railway.json || true`
Expected: root file uses `preDeployCommand` + `node apps/api/dist/server.js`; nested file uses inline `pnpm --filter @jdm/db db:deploy && node dist/server.js`

- [x] **Step 3: Prove the repo-root runtime path matches the Docker image**

Run: `rg -n "WORKDIR|CMD" apps/api/Dockerfile && test -f apps/api/dist/server.js && test ! -f dist/server.js`
Expected: Docker `WORKDIR /repo`, `CMD ["node", "apps/api/dist/server.js"]`, app build output present at `apps/api/dist/server.js`, no repo-root `dist/server.js`

- [x] **Step 4: Record the issue constraint around Railway logs**

Run: `curl -I -L 'https://railway.com/project/531409db-5d62-4db2-a1c0-96b59c6ce77b/service/ed15dc73-2b23-42d2-8d9c-1e7f56888b25?id=0b8a99af-d505-4996-8856-fcbf4b347582&environmentId=f8e16840-1687-44a7-9f2c-068f882f34d3'`
Expected: public HTML responds, but deployment logs remain unavailable without Railway auth

### Task 2: Remove the stale nested Railway config and align the runbook

**Files:**

- Delete: `apps/api/railway.json`
- Modify: `docs/railway.md`
- Test: none

- [x] **Step 1: Delete the stale nested config**

Delete `apps/api/railway.json`.
Expected: only repo-root `railway.json` remains, making config precedence unambiguous

- [x] **Step 2: Update the Railway runbook to name the repo-root config**

Edit `docs/railway.md` so it states:

- config lives in repo-root `railway.json`
- Railway service root directory is `/`
- start path is `node apps/api/dist/server.js`
- migration step runs through the repo-root deploy config

- [x] **Step 3: Update any stale path references in the runbook**

> note: The runbook was aligned to the existing repo-root deploy file instead of changing the authoritative deploy path. That keeps the fix scoped to ambiguity removal and documentation repair.

Replace references that describe `apps/api/railway.json` as canonical with `railway.json`.
Expected: docs and repo layout no longer disagree

### Task 3: Run the smallest proof and leave durable issue evidence

**Files:**

- Modify: `docs/superpowers/plans/2026-05-15-jdma-712-railway-config-drift.md`
- Reference: issue comment on `JDMA-712`

- [x] **Step 1: Re-run focused path proof after the edit**

Run: `test -f railway.json && test ! -f apps/api/railway.json && rg -n "railway.json|apps/api/dist/server.js|root directory" docs/railway.md railway.json`
Expected: root config present, nested config absent, docs point at repo-root config and app dist path

- [x] **Step 2: Capture the local verification caveat**

Run: `pnpm --filter @jdm/db db:generate && test -f apps/api/dist/server.js`
Expected: Prisma client refresh is possible locally; runtime path proof remains focused and does not require a full workspace suite

> note: In the fresh `jdma-712` worktree, `pnpm --filter @jdm/db db:generate` fails before execution because the worktree does not have its own `node_modules` install (`prisma: command not found`). Verification stayed focused on the touched deploy-config paths plus the shared-root proof that `node_modules/.bin/prisma` exists and the app dist path is `apps/api/dist/server.js`.

- [x] **Step 3: Post the issue update with root cause, change, verification, and Railway follow-up**

Comment must include:

- exact repo drift found
- why repo-root `railway.json` is authoritative
- note that the linked Railway page is public HTML but deploy logs require authenticated Railway access
- rollback: restore deleted nested file and revert docs if needed
- next action: push branch / open PR / trigger Railway redeploy

> note: Live Railway CLI access made the final proof stronger than the original plan. Production explicitly reported `configFile=/railway.json`, `rootDirectory=/`, `preDeployCommand=node_modules/.bin/prisma migrate deploy --schema packages/db/prisma/schema.prisma`, and `startCommand=node apps/api/dist/server.js`. The actual failed deploy root cause was not config-path selection; it was a missing production secret: `FIELD_ENCRYPTION_KEY`.

### Task 4: Restore the production deployment and document the missing secret

**Files:**

- Modify: `docs/railway.md`
- Modify: `docs/secrets.md`
- Reference: Railway production service `ed15dc73-2b23-42d2-8d9c-1e7f56888b25`

- [x] **Step 1: Confirm the exact deployment failure from Railway logs**

Run: `railway logs 0b8a99af-d505-4996-8856-fcbf4b347582 --service ed15dc73-2b23-42d2-8d9c-1e7f56888b25 --environment f8e16840-1687-44a7-9f2c-068f882f34d3 --deployment --lines 200`
Expected: migrations succeed, then API startup fails with `Invalid environment: {"FIELD_ENCRYPTION_KEY":["Required"]}`

Observed: Railway applied the pending migrations successfully, then restarted the container repeatedly with `startup failed: Error: Invalid environment: {"FIELD_ENCRYPTION_KEY":["Required"]}` while `cwd=/repo`.

- [x] **Step 2: Confirm the missing secret in Railway production**

Run: `railway variable list --service ed15dc73-2b23-42d2-8d9c-1e7f56888b25 --environment f8e16840-1687-44a7-9f2c-068f882f34d3 --json | jq 'has("FIELD_ENCRYPTION_KEY")'`
Expected: `false` before remediation

Observed: `false`

- [x] **Step 3: Update the runbooks so the required secret is documented**

Edit `docs/railway.md` and `docs/secrets.md` to list:

- `FIELD_ENCRYPTION_KEY` as required in Railway
- generation format `openssl rand -hex 32`
- `TICKET_CODE_SECRET` in the same required-secret inventory

- [x] **Step 4: Set the missing production secret and redeploy**

Run:

- `FIELD_KEY=$(openssl rand -hex 32) && railway variable set FIELD_ENCRYPTION_KEY="$FIELD_KEY" --service ed15dc73-2b23-42d2-8d9c-1e7f56888b25 --environment f8e16840-1687-44a7-9f2c-068f882f34d3 --skip-deploys`
- `railway deployment redeploy --service ed15dc73-2b23-42d2-8d9c-1e7f56888b25 --environment f8e16840-1687-44a7-9f2c-068f882f34d3 --from-source --yes --json`

Expected: Railway accepts the variable and starts a new deployment from source

Observed: Railway accepted the secret, and the source redeploy returned `{"success":true}`.

- [x] **Step 5: Verify the production deploy is healthy**

Run:

- `railway deployment list --service ed15dc73-2b23-42d2-8d9c-1e7f56888b25 --environment f8e16840-1687-44a7-9f2c-068f882f34d3 --json | jq '.[0] | {id,status}'`
- `curl -fsS https://jdm-production.up.railway.app/health | jq .`

Expected:

- latest deployment `9dd67590-4896-4c1c-8463-8d4f53dcb150` reaches `SUCCESS`
- `/health` returns `{"status":"ok","sha":"7506b6e0999445ac5745f987c49a74357f9030d8",...}`

Observed:

- `railway deployment list ...` returned `{ "id": "9dd67590-4896-4c1c-8463-8d4f53dcb150", "status": "SUCCESS" }`
- `curl -fsS https://jdm-production.up.railway.app/health | jq .` returned `{"status":"ok","sha":"7506b6e0999445ac5745f987c49a74357f9030d8","uptimeSeconds":7}`
