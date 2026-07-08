# Handoff — Garage Spots Orchestration (ARCHIVED)

**Generated:** 2026-05-20
**Last updated:** 2026-05-21 (feature SHIPPED — TASK-E merged + follow-up fix #366 merged)
**Status:** ARCHIVED. Garage per-user pivot complete. Start a fresh thread for whatever comes next.
**Origin thread:** split from Car-fields extension session
**Reason:** keep garage-spots wave orchestration separate from car-fields ad-hoc work

---

## ⚠️ READ FIRST — PIVOT IN FLIGHT

The original per-spot `GarageSpotTier` model is **dead**. The canonical contract going forward is the per-user `Garage` model spec at:

`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`

That spec is on branch `plan/jdma-garage-per-user-pivot` (PR #358). When PR #358 merges, the spec lands on `main` and TASK-B-prime can start from a clean baseline. Until then, the spec is only accessible via PR #358 or the local worktree at `.worktrees/garage-pivot-plan/`.

Every `plans/garage-spots/TASK-*.md` file on PR #358 carries a **POST-PIVOT NOTICE** at the top — read those before reading the old plan body.

---

## How to resume

Open a fresh Claude Code session in `/Users/pedro/Projects/jdm-experience`. Paste the prompt at the bottom of this file (`## Resume prompt`) as your first message.

---

## State as of handoff

### PRs

- **PR #354** — `plan/jdma-garage-spots` → `main`. Status: **MERGED** as `a25931f`. Original 9 planning docs.
- **PR #355** — `feat/jdma-garage-spots-task-a` → `main`. Status: **MERGED** 2026-05-20 as `d6b50e4`. 8 commits, 17 files. Schema, virtual product, seed, backfill. Final commit `3abb6af` addressed 3 review findings + 1 test gap. **Some shipped code now superseded by the pivot** — see "Shipped-code adjustments owed" below.
- **PR #356** — `feat/jdma-car-fields-extension` → `main`. Status: **MERGED** 2026-05-20 as `b6a98c1`. Added `Car.description`, `Car.modifications`, required+unique `Car.nickname`. The `description` field will be **dropped** by the pivot (moves to `Garage.description`).
- **PR #357 / TASK-B (original)** — `feat/jdma-garage-spots-task-b` → `main`. Status: **CLOSED** 2026-05-20 (superseded by pivot). Branch still on remote; local worktree at `.worktrees/garage-spots-task-b` still alive. Cleanup deferred — neither is needed for future work; reviving the branch is harmless if anyone wants to mine the prior diff.
- **PR #358 / pivot docs** — `plan/jdma-garage-per-user-pivot` → `main`. Status: **MERGED** 2026-05-20 as `b8f7abe`. Pivot design spec + POST-PIVOT NOTICE headers + TASK-E rename. Docs-only.
- **PR #359 / TASK-B-prime** — `feat/jdma-garage-spots-task-b-prime` → `main`. Status: **MERGED** 2026-05-20 as `82df84a`. 6 commits, 23 files. Garage 1:1 with User, signup tx, public profile, DSR coverage, allocator-by-source, POST /me/cars wired to allocator with Serializable+P2034 retry. Three review rounds caught: (a) `ensureGarageForUser` P2002 race, (b) POST /me/cars not calling allocator, (c) fresh bounded-cap users hitting GARAGE_FULL because signup doesn't pre-materialize spots — allocator now self-heals when `freeFilled < freeLimit`. Final fix also returns 409 SERIALIZATION_CONFLICT (not 500) on exhausted P2034 retries.
- **PR #364 / TASK-C** — virtual checkout + settlement. **MERGED** 2026-05-21 as `958794a`. 9 commits across 2 review rounds. Helper `fulfillGarageSpotsForOrder` (Serializable tx, P2002 swallow). Cart route + checkout carve-outs for `virtual=true`. Admin store activate skips photo/fulfillment-method gate for virtual. Round-2 fixes: qty>1 reject, virtual reservation-release skip, mixed-ticket+virtual exclusion from admin queue, virtual ignored in primary-shipping selection. `fulfillmentMethod` widened to `['ship','pickup','virtual']`; `fulfillmentStatus` adds `virtual_complete`; `storeFulfillmentStatusSchema` keeps narrow set (no virtual_complete).
- **PR #361 / TASK-H** — admin virtual-product editor. **MERGED** 2026-05-21 as `33077ee`. Form carve-outs for virtual products. Status select hidden for `garage-spot` singleton; server-side rejects status + productTypeId changes on singleton. Test split for singleton vs non-singleton virtual.
- **PR #362 / TASK-G** — admin user-garage management. **MERGED** 2026-05-21 as `81acd7d`. 5 new admin routes: `GET/PATCH /admin/users/:id/garage`, premium grant/revoke, spot grant/revoke. Slug override bypasses regex (reserved-list + unique still enforced). Reconcile-before-read on GET; in-tx filled-spot guard on revoke; slug-collision P2002 retry; rejects mixed-state premium payload (`tier:null + premiumUntil:set`).
- **PR #360 / TASK-F** — admin general-settings. **MERGED** 2026-05-21 as `8155f6f`. `defaultFreeGarageSpots` field on `GeneralSettings`. Form has Ilimitado toggle + numeric input + downgrade warning. Per-field change detection (no-op saves skip both DB write and audit). Int4 max cap. Reconcile on next `/me/garage` self-heals across cap changes (already wired in TASK-B-prime).
- **PR #363 / TASK-D** — mobile garage UI. **MERGED** 2026-05-21 as `a9b197d`. `GarageListView` + slot-aware cards. Inline edits in `GarageHeader` (name/slug/description/isPublic) with optimistic revert. Post-signin redirects to `/garage`. `buildGarageSlots` uses `spot.source` (not `tier`). Add-card slot for unlimited+empty state. `purchaseOption` + `garageCartResponseSchema` mirrored locally pending TASK-C publishing to shared.

### Wave plan (post-pivot, supersedes Car_spot_plan.md §9)

- **Wave 2 (single PR, DONE):** TASK-B-prime merged as `82df84a`.
- **Wave 3a (DONE):** TASK-C #364, TASK-D #363, TASK-F #360, TASK-G #362, TASK-H #361 all merged 2026-05-21.
- **Wave 3b (IN FLIGHT):** TASK-E — PremiumBadge across surfaces. Implementer running.

#### Wave 3 sequencing (revised after reading plan files)

Plan-file bodies were written PRE-PIVOT and reference dead schemas (`garageSpotTierSchema`, `Car.tier`, `serializeCar(car, uploads, tier)`, `POST /me/cars/:id/tier`). The POST-PIVOT NOTICE at the top of each file marks the translation. Implementers MUST read the spec at `docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md` first; plan bodies are reference.

Conflict analysis:

- **TASK-D** owns mobile `/garage` page shell (new `GarageListView`, slot-aware cards, inline edit affordances for name/slug/description/isPublic, post-signin routing). Touches `apps/mobile/app/(app)/garage/*`, `apps/mobile/src/screens/garage/*`.
- **TASK-E** adds `PremiumBadge` (garage-level, reads `garage.isPremiumActive`). Touches feed serializers + admin moderation queue + check-in (read author's garage premium status), mobile `GarageListView` header (badge), `packages/ui/src/PremiumBadge.tsx`, admin badge component. **Conflicts with TASK-D** on mobile garage screen files.
- **TASK-C** is API-only (checkout + settlement + admin store product activate). No conflict with D/E/F/G/H.
- **TASK-F** admin general-settings field (`defaultFreeGarageSpots` input). Touches `apps/admin/app/.../general-settings/*`. No conflict.
- **TASK-G** admin user-garage management + premium grant/revoke + slug override. Touches `apps/admin/app/(authed)/users/[id]/*` + new admin API routes. Conflict with TASK-E only if E touches admin user-detail UI (E mostly touches mobile + admin moderation, not user-detail).
- **TASK-H** admin virtual-product editor UI. Independent.

Recommended dispatch:

**Sub-wave 3a (parallel ×5):** TASK-C, TASK-D, TASK-F, TASK-G, TASK-H. Five fresh worktrees off `main`. D owns the mobile garage shell; E waits for D.

**Sub-wave 3b (after TASK-D merges):** TASK-E. Branches off post-D `main` so the PremiumBadge can target the final `GarageListView` file path. (TASK-D plan §10 "CROSS-TASK NOTE" already flags this: E must target `apps/mobile/src/screens/garage/GarageListView.tsx`, not the old `garage/index.tsx`.)

Alternative: dispatch all 6 in parallel, accept TASK-E rebase pain. Sub-wave 3a/3b is the safer call.

### Tasks status

| Wave | Task                                                                                                 | Status                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | TASK-A — schema, virtual product, seed, backfill                                                     | **DONE** (#355 merged `d6b50e4`). Tier column dropped by TASK-B-prime.                                                                                                                 |
| —    | Pivot planning (spec + plan-notice headers + TASK-E rename)                                          | **DONE** (#358 merged `b8f7abe`).                                                                                                                                                      |
| 2    | TASK-B-prime — Garage model, public profile, owner endpoints, signup hook, DSR, allocation by source | **DONE** (#359 merged `82df84a`).                                                                                                                                                      |
| 3a   | TASK-C — virtual checkout + settlement (creates `GarageSpot { source: 'purchase' }`, no tier)        | **DONE** (#364 merged `958794a`).                                                                                                                                                      |
| 3a   | TASK-D — mobile garage UI (inline edits on `/garage`, public profile preview, post-signin routing)   | **DONE** (#363 merged `a9b197d`).                                                                                                                                                      |
| 3b   | TASK-E — Garage-level PremiumBadge (no tier picker — deleted)                                        | **DONE** (#365 merged `f5c7edb`). Follow-up fix #366 merged `e1409489` (owner /me/garage car payload was missing user.garage include — premium owners saw no badge on their own cars). |
| 3a   | TASK-F — admin general-settings field                                                                | **DONE** (#360 merged `8155f6f`).                                                                                                                                                      |
| 3a   | TASK-G — admin user-garage management + premium grant/revoke + slug override                         | **DONE** (#362 merged `81acd7d`).                                                                                                                                                      |
| 3a   | TASK-H — admin virtual-product editor UI                                                             | **DONE** (#361 merged `33077ee`).                                                                                                                                                      |

### Shipped-code adjustments owed (land in TASK-B-prime PR)

These items already exist on `main` and need pivot edits as part of TASK-B-prime — NOT deferred to later tasks:

- `packages/db/prisma/schema.prisma`: drop `GarageSpot.tier`, drop `GarageSpotTier` enum, drop `@@index([userId, tier])`, drop `Car.description`, add `Garage` model + `GaragePremiumTier` enum, add `User.garage Garage?` back-relation.
- New migrations `20260520120200_drop_garage_spot_tier` and `20260520120300_garage_model_and_car_description`. Old migration `20260520120100_garage_spots_tables` stays untouched.
- `packages/db/prisma/seed.ts`: seed Garage rows for demo users.
- `packages/shared/src/garage.ts`: drop `garageSpotTierSchema`; drop `tier` from `garageSpotSchema`; reshape `garageReadSchema` per spec §4.1.
- `packages/shared/src/garage-public.ts`: NEW file. `garagePublicProfileSchema` + `carPublicSchema`.
- `packages/shared/package.json`: add `./garage-public` exports entry.
- `packages/shared/src/cars.ts`: drop `description` from `carInputSchema`, `carUpdateSchema`, `carSchema`.
- `packages/shared/src/admin.ts`: add audit actions `garage.backfill`, `garage.premium_grant`, `garage.premium_revoke`, `garage.slug_override`; extend `entityType` with `'garage'`.
- `packages/shared/src/__tests__/garage.test.ts`: drop tier-related cases.
- `apps/api/test/migrations/garage-spot-backfill.test.ts`: drop `expect(spot.tier)` assertions; column won't exist post-migration.
- `apps/api/src/routes/cars.ts`: drop `description` from input parsing + serializer.
- `apps/api/src/services/auth/signup.ts`: wrap user + garage create in one tx with neutral defaults (`name='Garagem'`, `slug='user-<id8>'`, `isPublic=false`).
- `apps/api/src/services/account-deletion/anonymize.ts`: scrub Garage row in the same anonymization tx.
- `apps/api/src/services/data-export.ts`: include Garage fields in DSR export.
- `apps/mobile/src/api/cars.ts` + car forms: drop `description`.
- `apps/admin/...` car edit form: drop `description`.

Full file list with rationale lives in spec §6.3.

### Locked contracts (post-pivot)

- **`Garage` is 1:1 with `User`**, eager-created. Signup creates the row; migration backfills for existing users. `Garage.userId @unique`.
- **`GarageSpot` has NO `tier` field**. Free vs extra is computed from `source` (`default_free` = free; anything else = extra).
- **Neutral defaults — no PII leak.** Backfill + signup write `name='Garagem'` and `slug='user-<id8>'`. Never derived from `User.name`. `isPublic` defaults to `false`.
- **`/g/:slug` is gated on `isPublic=true`** and returns 404 when false — indistinguishable from unknown-slug 404 (anti-enumeration).
- **DSR coverage is mandatory** — export includes Garage fields; anonymize scrubs the row in the same tx with `name='Garagem'`, `slug='deleted-<id8>'`, `description=null`, `isPublic=false`, `premiumTier=null`, `premiumUntil=null`.
- **`isPremiumActive` is serializer-computed**, never persisted, never on the public payload. Compute as `premiumTier !== null && (premiumUntil === null || premiumUntil > now())`.
- **`allocateSpotForCar` returns `{ spotId, source }`** (not `tier`). Premium-allocation branch removed.
- **`Serializable` + `P2034` retry** on reconcile/allocate stays.
- **`sourceOrderItemId @unique`** enforces settlement idempotency (TASK-C).
- **Postgres `ALTER TYPE ADD VALUE` auto-commits** → keep enum-DDL migrations isolated in their own file (repo pattern). The pivot adds `GaragePremiumTier` via `CREATE TYPE` (not `ADD VALUE`), so the migration in §5.2 of the spec can mix enum + table in one file.

### Progress log

- **2026-05-20** — PR #354 (planning docs) merged as `a25931f`.
- **2026-05-20** — PR #355 (TASK-A) opened, gates green.
- **2026-05-20** — Review fixes on #355 in commit `3abb6af`: NULL-coerce on rollout, productType-squatter guard, `visibleInStore` filter on public store API, pre-rollout backfill test.
- **2026-05-20** — PR #355 squash-merged as `d6b50e4`. Wave 2 starts.
- **2026-05-20** — TASK-B implementer delivered 6 commits at sha `38ddd57`. Locked contracts honored; `z.lazy` workaround for vite-node circular-import race.
- **2026-05-20** — Both reviewers ✅ PASS on TASK-B. Applied 2 non-blockers in `7968a2a` (narrow `allocateSpotForCar` return type, gate killswitch on `hasFulfillableProductItems`).
- **2026-05-20** — Rebased TASK-B onto `b6a98c1` (car-fields PR #356 merged mid-Wave-2). Conflicts resolved in shared + api cars files.
- **2026-05-20** — TASK-B PR #357 opened.
- **2026-05-20** — **PIVOT decision.** Per-spot tier model replaced by per-user `Garage` (1:1 with User, eager-created), public profile at `/g/:slug` gated on `isPublic`, premium moves to `Garage.premiumTier` + `premiumUntil`. `Car.description` (from #356) drops in favor of `Garage.description`.
- **2026-05-20** — Spec written + reviewed twice (internal + human). PR #358 opened with plan notices + TASK-E rename.
- **2026-05-20** — PR #357 closed (superseded). PR #358 merged as `b8f7abe`.
- **2026-05-20** — TASK-B-prime implementer ran 50min, partial commits (db + shared on disk). Recovered in-session: lint-fixed 3 garage tests, committed API + mobile chunks. 1324 API tests pass.
- **2026-05-20** — Three review rounds on TASK-B-prime:
  - R1 (spec): false-positive migration name "blocker" (impl correctly used `20260521*` because car-fields PR #356 already shipped `20260521000000`; renaming to `20260520*` would break Prisma history). Documented as deliberate deviation.
  - R1 (quality): real HIGH on `ensureGarageForUser` lazy-create race → fixed `18ea6d6` (catch P2002, return winner).
  - R2 (quality): CRITICAL — POST /me/cars wasn't calling allocator → fixed `7e0f129` (Serializable tx + P2034 retry + GarageFullError → 409 GARAGE_FULL). Also reset GeneralSettings in test helper (cap leaked across files).
  - R3 (quality): CRITICAL — bounded-cap fresh signup → GARAGE_FULL because signup tx creates Garage but no GarageSpot. Fixed `3e65c60` (allocator self-heals when `freeFilled < freeLimit`; final P2034 returns 409 SERIALIZATION_CONFLICT not 500).
- **2026-05-20** — PR #359 merged as `82df84a`. Worktrees cleaned. Wave 3 ready.
- **2026-05-21** — Sub-wave 3a dispatched: TASK-C, D, F, G, H in parallel on fresh worktrees off `main`. Each: 1 implementer + 2 reviewers (caveman:cavecrew-reviewer).
- **2026-05-21** — Sub-wave 3a delivery: 5 PRs opened (#360 F, #361 H, #362 G, #363 D, #364 C). Two rounds of receiving-code-review on every PR, dispatched via `superpowers:receiving-code-review` agents.
- **2026-05-21** — Notable round-2 catches per PR:
  - #364 (C): qty>1 garage purchase reject, virtual reservation-release skip, mixed-ticket+virtual exclusion from admin queue, virtual ignored in primary-shipping.
  - #363 (D): unlimited+empty add-card slot, drop `spotId` from createCar (allocator owns precedence), gate share+preview on `isPublic`, edit-state resync, error-code routing.
  - #362 (G): reconcile-before-read on GET, ensureGarageForUserId P2002 race, in-tx filled-spot guard, slug-collision retry, mixed-state premium payload reject.
  - #361 (H): singleton status read-only client+server, productTypeId singleton guard, singleton/non-singleton fixture split.
  - #360 (F): blank input guard, Int4 max cap, no-op audit-row skip, per-field capacity change detection (drop noisy audits).
- **2026-05-21** — Merge sequence executed `#364 → #361 → #362 → #360 → #363`. Each rebased onto post-merge `main`; gates re-run; CI re-run; `gh pr merge --merge`. No actual conflicts (TASK-H's products.ts changes touched different lines than TASK-C's). Merged worktrees + local branches cleaned.
- **2026-05-21** — TASK-E (sub-wave 3b) dispatched on fresh `feat/jdma-garage-task-e` worktree off `main`.
- **2026-05-21** — TASK-E implementer DONE (~26 min, 6 commits). Threaded `isPremiumActive` through every car-bearing serializer (cars, feed, events confirmed-cars, tickets/check-in, admin moderation, scanner). New `PremiumBadge` in `@ccc/ui` + admin twin component. All gates green per implementer report.
- **2026-05-21** — TASK-E review round 1: spec reviewer flagged 1 "critical" claim — check-in uses `ticket.user.garage` instead of `ticket.car.user.garage`. **Pushback applied** (verified `validateTickets` line 64 forces `where: { id, userId }` on car → ticket holder owns the car; premium is owner-level, not car-level; admin scanner shows attendee premium status, which is correct). Reviewer-B (code quality): clean — no findings. PR #365 opened.
- **2026-05-21** — PR #365 CI round 1 failed on `test/orders/car-plate.test.ts:443` (stale toEqual missing isPremiumActive on ticket.car). Fixed in `c41f692c`. CI round 2 green. PR #365 merged as `f5c7edb`.
- **2026-05-21** — User-supplied post-merge finding: `GET /me/garage` loaded cars with only `{ photos: true }` → owner garage payload reported `isPremiumActive=true` but every `cars[].isPremiumActive` came back `false`, hiding the badge on the owner's own GarageListView. Verified by stashing the fix and confirming the new regression test fails. Fix on PR #366 added the same `user.garage { premiumTier, premiumUntil }` include used by GET /me/cars + GET /me/cars/:id, plus regression test. **Merged as `e1409489`.** **Garage per-user pivot feature SHIPPED.**

### Active worktrees + branches

None. All garage worktrees + local feature branches cleaned. Remote branches (`feat/jdma-garage-task-{b-prime,c,d,e,f,g,h}` + `fix/jdma-garage-me-premium-flag`) intentionally kept on origin (hook blocks `git push origin --delete` from main; safe to leave as archaeology).

### Memories worth checking

- `feedback_rebuild_shared_after_schema_change.md` — runtime resolves `dist/`; rebuild after schema edits.
- `feedback_no_background_shells.md` — don't spawn dev servers or trigger-and-grep loops unless asked.
- `feedback_audit_deploy_verification.md` — never close deploy issues from PR-merge state alone.
- `project_agent_handoff_policy.md` — bounded WIP ≤3, next-action per heartbeat.

### Known dirt unrelated to pivot

- `apps/admin/` has 4 pre-existing react-hooks/set-state-in-effect lint errors on `main` (cookie-banner, product-edit-form). Pre-dates all garage work.
- `apps/api/test/helpers.ts` has duplicate `deleteMany` calls in the reset helper (pre-existing).

---

## Subagent orchestration pattern (learned, still applies)

For each wave task: dispatch ONE general-purpose subagent with full plan-file path + tight scope. One TASK = one implementer (agent sub-divides). Then dispatch:

1. `caveman:cavecrew-reviewer` for spec compliance (read plan + diff, verify line-by-line).
2. `caveman:cavecrew-reviewer` for code quality (read diff only, fresh context).

Then PR. Then move to next wave.

Subagents in this codebase have a history of overreaching scope. Accept it iff the work is correct — verify with repo-wide typecheck/test/lint before approving.

**Pivot-specific:** the TASK-B-prime implementer MUST read the spec at `docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md` first. The amended `plans/garage-spots/TASK-B-public-garage-api.md` is reference-only; the spec is authoritative.

---

## Resume prompt

**This file is ARCHIVED.** Garage per-user pivot feature is fully shipped on main (all of TASK-A/B-prime/C/D/E/F/G/H + follow-up fix #366 merged 2026-05-21). Start a fresh Claude Code thread for whatever the next chunk of work is. Reference this file only as archaeology.

If a regression surfaces:

- Source of truth for the pivot is `docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`.
- Locked contracts section above lists invariants still load-bearing.
- Premium is owner/garage-level; `isPremiumActive` always computed via `computeIsPremiumActive(premiumTier, premiumUntil)` in `apps/api/src/services/garage/index.ts`, never persisted.
- Every car-bearing serializer pulls `user.garage { premiumTier, premiumUntil }` — if a new endpoint emits cars without that include, it will silently return `isPremiumActive=false` for premium owners (see PR #366 regression).

Operating rules that proved load-bearing this wave:

- Caveman mode (full). PT-BR primary. Real Postgres tests via Testcontainers (no mocks).
- Never run full pnpm test suite locally — touched files only; trust CI for the sweep.
- Always rebuild `@ccc/shared` after schema or export changes — runtime resolves `dist/`.
- Always regen prisma client (`pnpm --filter @ccc/db exec prisma generate`) after schema changes.
- Branch safety per CLAUDE.md. Never amend; always new commits. Don't push production. Never bypass hooks.
- Hook blocks `git push` from main (incl. branch deletion) — work on feature branches; leave merged remote branches as archaeology.
