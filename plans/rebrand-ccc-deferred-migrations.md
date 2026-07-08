# Deferred rebrand migrations — agent brief (JDM → CCC)

## Context

The app was rebranded from "JDM Experience" to "Casa Car Club" (CCC). Most of the
rebrand is done and merged/on branch `feat/rebrand-ccc-app-sweep`:

- `packages/design/src/brand.ts` is the single source of truth (name, gold palette
  `#D4AF37`, Jost display font, domains `casacarclub.com.br`, `storagePrefix: 'ccc'`,
  `scheme: 'ccc'`, bundle `com.casacarclub.app`).
- App icons / splash / favicons replaced with CCC art.
- User-facing copy scrubbed of "JDM" (badges, seed demo data, premium sheet).
- Internal package scope renamed `@jdm/*` → `@ccc/*` across the whole monorepo.
- Non-persisted internal identifiers renamed (`cccNavTheme`, `ccc-mobile` eslint
  plugin, `data-ccc-*` DOM attrs, `x-ccc-k-anonymity` headers, `ccc-dev-uploads`,
  `ccc-data-export` filename).
- CORS origins updated to `admin/app.casacarclub.com.br`.

Everything typechecks (13/13) and unit tests pass (shared/ui/admin/mobile).

What remains are the items that touch **persisted data**, the **public API
contract**, **native build output**, or **deployed infra** — i.e. real migrations
that need a plan + coordinated rollout, deliberately left out of the sweep.

Your job: plan and execute these. Think it through; the notes below are context,
not a rigid recipe.

## 1. Badge codes + category enum (DB + API contract)  — highest care

Badge codes `JDM-001 / JDM-002 / JDM-003` and the badge **category enum value**
`jdm` still travel over the API verbatim and are persisted in Postgres. Display
labels already read "CCC" — only the identifiers remain. Target: `CCC-001..003`
and category `ccc` (confirm the desired names with the owner first).

Touch points to reconcile in lockstep (grep `JDM-00` and `'jdm'` category):

- DB (persisted): `Badge.code`, `Badge.category`, `GarageBadge.badgeCode`. Existing
  rows must be backfilled. Write a Prisma migration.
- Zod contract: `packages/shared/src/badges.ts` (`badgeCategorySchema` enum includes
  `'jdm'`; codes documented in the header comment).
- Seed: `packages/db/prisma/seed.ts` (BADGES array — `code: 'JDM-00x'`, `category: 'jdm'`).
- Award/eligibility logic: `apps/api/src/services/garage/eligibility/events.ts`
  (`codes.push('JDM-001'/'JDM-002')`), `.../eligibility/signup.ts`
  (`codes.push('JDM-003')`), `.../awarder.ts`, `apps/api/src/routes/auth/signup.ts`.
- Copy maps keyed by code: `apps/mobile/src/copy/badges.ts` (catalog keys +
  `categories.jdm`), `packages/shared/src/badges-copy.ts` (`BADGE_TITLES_PT_BR`),
  `packages/ui/src/{BadgeDetail,BadgesSheet,BadgeGlyph}.tsx` + web twins, and
  `apps/admin/src/components/garage-badges-panel.tsx` (category label + `CATEGORY_ORDER`).
- Tests asserting old codes/category.

Plan for zero-downtime: either (a) migrate rows + ship code together behind a deploy
window, or (b) dual-accept old+new codes during a transition. Decide and justify.

## 2. Persisted client storage keys + deep-link scheme (existing users)

`brand.app.storagePrefix` already flipped `jdm` → `ccc`, so runtime now reads/writes
`ccc:*` keys. Users who used the old build still hold `jdm:*` keys and may lose
in-flight state / offline data:

- `jdm:pendingOrderId`, `jdm:pendingCheckoutUrl:<id>` (`apps/mobile/src/cart/web-stripe-redirect.ts`).
- Offline saved tickets and any other AsyncStorage/localStorage/cookie keys built
  from `storagePrefix` (grep `storagePrefix`).
- Deep-link scheme changed `jdm://` → `ccc://`; any persisted/return URLs
  (e.g. premium return `ccc://premium/return`) or externally shared links.

Plan a one-time read-old→write-new migration on boot, or a dual-read fallback with a
cleanup pass. Confirm whether old links are live anywhere before dropping `jdm://`.

## 3. Native build identifiers (managed prebuild)

`apps/mobile/package.json` `ios:preview:*` scripts hardcode
`JDMExperiencePreview.xcworkspace` / scheme. There is no committed `ios/` dir
(managed prebuild), so the workspace name is generated from the app name at
`expo prebuild`. Regenerate under the CCC app name and update the script names to
match the new prebuild output.

## 4. Deploy-coupled infra

`apps/mobile/eas.json` and `apps/mobile/package.json` reference
`https://jdm-production.up.railway.app` (the live API host). Renaming requires
renaming the Railway service/domain and updating the env URLs in the same rollout.
Coordinate with whoever owns the Railway project.

## 5. Cosmetic / optional (no functional impact)

- Test infra: Testcontainers DB name `jdm_test` + username/password `jdm`
  (`apps/api/test/global-setup.ts`); test emails `@jdm.test`.
- ~35 API/mobile test fixtures use inline `'Camiseta JDM'` / `'Encontro JDM'` mock
  strings (not coupled to seed). Rename only if you want zero "JDM" in the tree.
- Doc/plan references and the GitHub repo slug `leaopedro/jdm` (README, CONTRIBUTING,
  LGPD_scan.md, plans/*).

## Guardrails

- Branch from fresh `main`; PR to `main` only; never touch `production`.
- API integration tests must hit real Postgres (Testcontainers), not mocks.
- Confirm the target code/category names and the storage-migration strategy with the
  owner before executing item 1 or 2.
