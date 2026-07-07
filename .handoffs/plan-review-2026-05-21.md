# Plan Review — 2026-05-21

## Summary

- Phase 1: 3 critical / 38 major / 7 minor / 0 nit
- Phase 2: 2 critical / 27 major / 2 minor / 1 nit
- Phase 3: 5 critical / 21 major / 3 minor / 1 nit
- Cross-plan: 2 critical / 8 major / 0 minor / 0 nit

## Action priority (top 10, ordered by severity then impact)

1. Cross-plan:LGPD — All three plans mishandle DSR/anonymize for new garage, badge, and XP state — fix: define explicit export/anonymize/delete/reset behavior for cover uploads, GarageBadge, XpEvent, and denormalized counters in each phase.
2. Phase 1:Chunk 03 — Cover URL validation accepts any host with a matching path and can leak tracking URLs — fix: validate against the configured R2 public base URL or persist object keys only.
3. Phase 2:Phase 2C — Manual badge grants can award premium-exclusive badges to non-premium users — fix: enforce `isPremiumActive` in every award path, including admin.
4. Phase 3:Phase 3B — XP idempotency is not DB-enforced and concurrent awards can double-increment XP — fix: add a unique idempotency constraint or serializable insert/upsert pattern.
5. Phase 3:Phase 3B — Unlike rollback can decrement XP even when no prior XP event existed — fix: only decrement after deleting a matching prior `XpEvent`.
6. Phase 1:Chunk 05 — Admin imports React Native `@jdm/ui` into Next without RN-web setup — fix: use web-compatible shared primitives or keep an admin Tailwind twin.
7. Phase 2:LGPD — Badge anonymize assumes a cascade that does not fire because Garage rows are scrubbed and retained — fix: delete `GarageBadge` rows explicitly in the anonymization transaction.
8. Phase 3:LGPD — XP anonymize assumes a cascade that does not fire and leaves XP rows/counters behind — fix: delete `XpEvent` rows and reset affected `Garage` counters explicitly.
9. Cross-plan:gamification contract — Phase 3 starts after Phase 2A but depends on Phase 2C `awardBadge` behavior — fix: gate Phase 3B badge-XP work on Phase 2C completion.
10. Cross-plan:build readiness — Phase 2 and Phase 3 are high-level plans while Phase 1 defers required §11 scope — fix: convert Phase 2/3 to executable TDD plans before implementation dispatch.

## Phase 1 findings

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:88: 🚨 Critical: Plan says DSR export/anonymize need no new work, but new `Garage.coverImageUrl` can be user-uploaded personal content and current anonymize/export code explicitly selects and scrubs garage fields. Add export fields, anonymize scrubbing, and cover object deletion queue coverage.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:856: 🚨 Critical: URL validation accepts any host if the path starts with `/garage-cover/<userId>/`, allowing public tracking URLs. Restrict to configured R2 public base URL or store/validate object keys server-side.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1468: 🚨 Critical: Importing `@jdm/ui` PremiumBadge into admin pulls React Native components into Next.js without `react-native-web` setup. Provide a web-compatible shared badge export or keep the admin Tailwind twin.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:7: ⚠️ Major: Plan omits required `POST /me/garage/cover/upload`, `GET /me/garage/cover/presets`, and uses generic `/uploads/presign` instead of the handoff API surface. Add the missing cover endpoints or document and approve the contract deviation.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:11: ⚠️ Major: Conquistas are deferred, but README.md lines 16 and 263-317 plus IMPLEMENTATION.md §11 include them in the v1 redesign scope. Add chunks 15-22 to this plan or get an explicit scope waiver.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:35: ⚠️ Major: `apps/admin/src/app/g/[slug]/page.tsx` is an invalid route path; this repo's App Router lives under `apps/admin/app`, not `apps/admin/src/app`. Use `apps/admin/app/g/[slug]/page.tsx` and matching `not-found.tsx`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:51: ⚠️ Major: The file list says `apps/mobile/src/theme/index.ts` is modified, but no chunk actually implements the theme re-export or color slots. Add an implementation step or remove the file-list claim.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:55: ⚠️ Major: Copy keys are inconsistent across chunks: file list names `welcomeBannerTitle`, `premiumExpiredTitle`, `editGarageSheetTitle`, `buySpotSheetTitle`, but code uses `welcomeTitle`, `expiredTitle`, `editSheetTitle`, and literals. Pick one key set and update all chunks.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:69: ⚠️ Major: CLAUDE.md branch safety preflight is missing before edits. Add `git branch --show-current`, stop on `production`, pull `main --ff-only`, and create the feature branch before chunk work.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:99: ⚠️ Major: The plan does not require a `@jdm/shared/garage-covers` package export, but later imports that subpath. Add `./garage-covers` to `packages/shared/package.json` exports.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:269: ⚠️ Major: `pnpm --filter @jdm/ui build` is invalid because `packages/ui/package.json` has no `build` script. Use `pnpm --filter @jdm/ui typecheck` or add a build script.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:389: ⚠️ Major: Extending `garagePatchSchema` with cover fields lets existing `PATCH /me/garage` accept cover payloads without the premium/ownership gate. Use a separate `garageCoverPatchSchema` for `/me/garage/cover` or make both routes share the same validation and write path.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:472: ⚠️ Major: `pnpm --filter api ...` uses the wrong package filter; the package is named `@jdm/api`. Replace all `api`, `mobile`, and `admin` filters with `@jdm/api`, `@jdm/mobile`, and `@jdm/admin`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:545: ⚠️ Major: Public serializer masks lapsed cover fields, contradicting the locked invariant that premium-cover lapse is renderer logic. Keep stored fields in payload and route all rendering through `resolveGarageCoverSlug`, or centralize the mask in one shared resolver.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:661: ⚠️ Major: File list promises `applyCoverPatch` plus audit emit, but implementation only adds `validateCoverPatch` and updates in the route. Implement `applyCoverPatch` to perform validation, update, and audit logging.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:664: ⚠️ Major: New garage cover upload presigns are not rate-limited; `/uploads/presign` currently has no limiter. Add a per-user limiter for `garage_cover` presign or for the whole upload presign route.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:696: ⚠️ Major: `../helpers/build-app.js` and `../helpers/users.js` do not exist in `apps/api/test`; existing tests use `../helpers.js` with `makeApp`, `resetDatabase`, `createUser`, and `bearer`. Rewrite the test scaffold to match the repo helpers.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:813: ⚠️ Major: Cover API tests use nonexistent helper signatures like `createUserWithGarage(ctx.prisma, { premium })`. Use existing `createUser` plus direct `prisma.garage.update` setup.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:905: ⚠️ Major: Cover changes never write `garage.cover_set` or `garage.cover_reset`, and the plan never extends `adminAuditActionSchema`. Add the shared audit action enum entries and write audit rows.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1003: ⚠️ Major: Test snippet calls `vi.fn()` without importing `vi` from `vitest`. Add `import { describe, expect, it, vi } from 'vitest';`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1455: ⚠️ Major: Plan assumes `apps/admin` already depends on `@jdm/ui`, but `apps/admin/package.json` does not. Add the dependency or keep a web-safe admin badge component.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1578: ⚠️ Major: ParkingStallCard tests call `vi.fn()` without importing `vi`. Add the Vitest import.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1590: ⚠️ Major: `pnpm --filter @jdm/ui test` is invalid because `packages/ui/package.json` has no `test` script. Add a UI test script and dependencies or move these tests under `@jdm/mobile`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1595: ⚠️ Major: ParkingStallCard defers asphalt texture and chevrons even though README.md lines 89-99 and atoms.jsx lines 353-380 require them for high-fidelity parity. Implement the grid/chevron treatment.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1605: ⚠️ Major: `StallSource` excludes both `buy` from IMPLEMENTATION.md §5.1 and existing `premium_membership` from `GarageSpotSource`. Include or normalize all source values before rendering.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1837: ⚠️ Major: `GarageSlotV2` is declared without `export`, but `GarageListView.tsx` imports it. Export the type from `garage-slots.ts`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1874: ⚠️ Major: `GarageSlotV2 extends { car: infer C } ? C : never` resolves to `never` for the union, making `toCarPayload` type-invalid. Use `Extract<GarageSlotV2, { kind: 'filled' }>['car']`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:2060: ⚠️ Major: `@jdm/ui` imports `expo-linear-gradient` and `@jdm/shared/garage-covers`, but `packages/ui/package.json` declares neither dependency. Add the dependencies or move `GarageCover` to mobile.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:2749: ⚠️ Major: Chunk 09 contradicts itself on whether `CoverPickerSheet` state lives in the route or `GarageHeader`. Choose one owner and update chunk 08/09 props consistently.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:2881: ⚠️ Major: Locked cover tiles are disabled, so `selectPreset` never calls `onPremiumUpsell`, contradicting README.md line 145. Keep tiles pressable and handle locked taps in `onPress`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:2908: ⚠️ Major: Free users cannot tap the disabled upload tile, so the upsell path is unreachable. Keep it pressable and call `onPremiumUpsell`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3038: ⚠️ Major: Webhook/deep-link return is optional, but README.md line 147 and IMPLEMENTATION.md §4.8 require post-settlement return to `/garage?highlight=<spotId>`. Wire the checkout success/deep-link path.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3138: ⚠️ Major: BuySpotSheet still sends users to `/cart`, so the 5-tap/manual-return UX issue is not actually fixed. Implement the thin in-context checkout return flow or mark the requirement unmet.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3277: ⚠️ Major: The proposed `invalid_slug` guard runs after `garagePatchSchema.parse`, so invalid slugs throw before the guard can emit `{ error: 'invalid_slug' }`. Validate raw body before zod parsing or map Zod errors globally.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3325: ⚠️ Major: Admin fetch helper defaults API base to `http://localhost:3000`, but this repo's API default is `http://localhost:4000`. Use existing admin API base logic or default to 4000.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3341: ⚠️ Major: `lucide-react` is not an admin dependency; only `lucide-react-native` exists in the workspace. Add the dependency or use a local/icon-free 404 component.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3368: ⚠️ Major: Admin imports use `@/components` and `@/lib`, but `apps/admin/tsconfig.json` only maps `~/*` to `src/*`. Use `~/components/public-garage-view` and `~/lib/public-garage`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3374: ⚠️ Major: Next 16 route params in this repo are typed as `Promise<{ ... }>` and awaited. Change `params: { slug: string }` to `params: Promise<{ slug: string }>` and `const { slug } = await params`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3384: ⚠️ Major: Public SSR component uses classes like `bg-surface`, `bg-surface-alt`, `bg-surface-deep`, and `text-fg-secondary`, but admin theme only defines `bg`, `fg`, `accent`, `muted`, and `border`. Add theme tokens or use existing CSS variable classes.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3437: ⚠️ Major: Public car cards render a blank placeholder instead of the car photo and stall-card layout required by README.md lines 111-116. Render public filled stall cards with `cars[].photos[0]`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3459: ⚠️ Major: SSR cover renderer only handles `urban-night`, `tokyo-wangan`, and default, dropping six valid preset slugs. Use `GARAGE_COVER_PRESETS` and `resolveGarageCoverSlug` for all presets.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1091: ℹ️ Minor: PremiumBadge V2 omits the required key glyph and clock glyph from the prototype and IMPLEMENTATION.md §5.2. Add the icons or document an approved visual deviation.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1382: ℹ️ Minor: PremiumSheet drops benefit-row icons despite the prototype showing icon-led rows. Add the icons using existing dependencies or record the visual deviation against the handoff.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1970: ℹ️ Minor: `onBadgePress={() => undefined /* wired in chunk 08 */}` is a stub comment standing in for behavior. Wire it in the same chunk or mark chunk dependency so the stub cannot ship.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:2256: ℹ️ Minor: IdentityCard uses the first letter as the garage glyph, but README.md lines 77 and 328 require a garage/Warehouse-style icon. Use the specified icon and tier-tinted styling.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:2346: ℹ️ Minor: Premium accent line is hardcoded red, but README.md line 83 and screens.jsx lines 34-40 require a tier-color gradient. Use `tierColors(garage.premiumTier)`.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:2990: ℹ️ Minor: Copy promises max 4 MB and 1600×600 minimum, but upload code enforces neither and shared upload max is 10 MB. Add client/server validation or remove the claim.

docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:3477: ℹ️ Minor: `apps/admin/src/__tests__/public-garage-page.test.tsx` does not match existing admin test placement patterns. Put tests beside `apps/admin/app/g/[slug]` or under existing `src/components`/`src/lib` test locations.

## Phase 2 findings

docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:29: 🚨 Critical: Anonymize assumes FK cascade drops `GarageBadge`, but current anonymization scrubs and keeps `Garage`, so badge rows would survive DSR anonymization. Explicitly `deleteMany` the user garage's `GarageBadge` rows inside the anonymization transaction.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:83: 🚨 Critical: Manual admin grants can award premium-exclusive badges to non-premium users, violating the locked premium-exclusive gate at award time. Enforce `isPremiumActive` for every award path or remove premium-exclusive override.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:3: ⚠️ Major: Plan is explicitly not a build-ready TDD plan, so branch safety, exact commands, schema rebuilds, and per-chunk verification are deferred. Convert this file before kickoff and include the required CLAUDE.md gates.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:18: ⚠️ Major: `event-checkin.ts` does not resolve in the repo. Use `apps/api/src/services/tickets/check-in.ts` plus the admin check-in route wiring.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:43: ⚠️ Major: The persisted/server catalog omits `icon`, but `HexBadge` later depends on catalog `icon` and the client no longer ships the catalog constant. Add `Badge.icon` and expose it in `BadgeCatalogEntry`, or define a shared deterministic icon map.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:44: ⚠️ Major: `garageBadgeSchema` only models earned rows, but `GET /me/garage/badges` promises locked and `lockedPremium` entries. Define a separate owner catalog-state schema covering earned, locked, and lockedPremium.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:47: ⚠️ Major: New `apps/api/src/routes/badges-catalog.ts` is not paired with an `apps/api/src/app.ts` registration. Add the route import and `app.register` step.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:65: ⚠️ Major: Phase 1 places `VagasSectionHeader` in the route `ListHeaderComponent`, not inside `GarageHeader`, so this insertion point is wrong. Wire `BadgeRow` in the garage route header between `<GarageHeader />` and `<VagasSectionHeader />`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:66: ⚠️ Major: `BadgesSheet` from `@jdm/ui` would be React Native UI, but the admin SSR app is Next and currently has no `@jdm/ui` transpile or RN-web setup. Add admin/web badge components or explicitly limit SSR to a static `BadgeRow`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:78: ⚠️ Major: `badge.award` is not in `adminAuditActionSchema`, and automatic awards have no defined `AdminAudit.actorId` semantics. Extend shared audit action/entity schemas and define the actor/source mapping.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:79: ⚠️ Major: `EVT-002` requires three consecutive events, but the plan only describes independent counter reads. Specify the ordered attendance streak query and missed-event reset behavior.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:81: ⚠️ Major: Deferring `COM-002` and `COM-003` leaves two seeded v1 badges unawardable despite §11.6 covering post engagement counters. Either move those badges out of v1 catalog or include the comment/reaction award hooks.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:82: ⚠️ Major: `JDM-003` is only backfilled, so users signing up before 2026-06-01 after the migration would miss Founder. Add signup-path award logic for `User.createdAt < 2026-06-01`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:83: ⚠️ Major: Manual grant introduces a mutation without a concrete route, role guard, or rate limit. Define the admin endpoint, required role, audit metadata, and mutation rate limit.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:84: ⚠️ Major: Existing `Notification` requires `title`, `body`, `data`, and `dedupeKey`; the plan only writes `kind` and `payload`. Use the existing notification schema/service with a deterministic badge dedupe key.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:149: ⚠️ Major: `AdminGeneralSettings` does not exist; the repo model is `GeneralSettings`. Add `gamificationEnabled` to `GeneralSettings` and its shared/admin schemas.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:176: ⚠️ Major: Payloads gain `gamification`, but the shared schema chunk only adds `badges`. Add `gamification: { enabled: boolean }` to owner and public zod response schemas.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:188: ⚠️ Major: New `packages/shared/src/badges.ts` lacks `packages/shared/package.json` export and index export steps. Add the `./badges` subpath and rebuild `@jdm/shared`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:194: ⚠️ Major: `apps/api/src/services/notifications/index.ts` does not match the existing notification infrastructure. Reuse `apps/api/src/services/push/transactional.ts` or add a narrowly named in-app helper.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:195: ⚠️ Major: `apps/api/src/routes/notifications.ts` is wrong for this repo; existing routes live in `apps/api/src/routes/me-notifications.ts`. Extend the existing route only if needed.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:199: ⚠️ Major: Test description says disabled payloads omit badges, but the killswitch spec says badges return `[]`. Make tests and schemas use one contract.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:208: ⚠️ Major: `apps/admin/src/app/g/[slug]/page.tsx` does not resolve; Next app routes are under `apps/admin/app`. Use `apps/admin/app/g/[slug]/page.tsx`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:217: ⚠️ Major: `POST /events/:id/checkin` does not match the repo route; check-in is mounted under admin as `/admin/tickets/check-in`. Update the awarder map to the actual route and service.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:228: ⚠️ Major: `badge.award` audit action is referenced but not added to shared audit schemas. Add `badge.award`, `gamification.toggle`, and needed badge entity types to `packages/shared/src/admin.ts`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:238: ⚠️ Major: Disabled response `{ enabled: false, earned: [], catalog: [] }` conflicts with API surface `{ earned, catalog }`. Define a single response schema including `enabled`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:239: ⚠️ Major: Disabled catalog response adds `enabled`, but `/badges/catalog` API surface only returns `{ catalog }`. Update `BadgeCatalogResponse` to include `enabled`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:257: ⚠️ Major: DSR export test path is named correctly, but the plan does not specify updating the export implementation. Add `GarageBadge` rows to `apps/api/src/services/data-export.ts`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:294: ⚠️ Major: This open question contradicts the locked invariant that earned premium-exclusive badges keep rendering publicly if pinned after premium lapse. Remove the question and keep the locked behavior.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:295: ⚠️ Major: Notification infrastructure is already present, so the fallback to create a minimal `Notification` model/route would duplicate existing schema and routes. Replace with explicit integration against existing `Notification` and `/me/notifications`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:7: ℹ️ Minor: `Owner: TBD` is a placeholder. Replace it with the owning agent or team before locking Phase 2.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:63: ℹ️ Minor: Category tab `All` violates PT-BR primary copy and differs from `badges.jsx` `Todas`. Use `Todas`.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:279: 💭 Nit: `TBD with motion designer` is a placeholder. Replace with a named deferred decision or remove it from the locked plan.

## Phase 3 findings

docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:70: 🚨 Critical: Unlike always decrements `Garage.xp` and `Garage.likesReceived` after "matching" an `XpEvent`, but the plan does not say to decrement only when a row was actually found and deleted. Make `revertLikeXp` conditional on the prior `XpEvent` existing, or killswitch/pre-XP likes can drive counters negative.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:81: 🚨 Critical: This says a unique constraint enforces XP idempotency, but the schema only adds `@@index([garageId, reason, sourceRef])` at line 143 and line 149 says DB uniqueness is not enforced. Add a real uniqueness strategy or remove the DB-enforced claim.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:143: 🚨 Critical: The idempotency lookup is indexed but not unique, so concurrent award calls can both insert and double-increment XP. Add `@@unique([garageId, reason, sourceRef])` for deterministic awards or a separate idempotency key table that excludes explicit admin adjustments.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:242: 🚨 Critical: Application-layer pre-check idempotency is race-prone under concurrent awards and contradicts the "same tx, no race" contract. Move deterministic award idempotency to a DB unique constraint or serializable insert/upsert pattern.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:310: 🚨 Critical: Anonymization claims `XpEvent` rows are FK-cascaded through `Garage`, but existing anonymization scrubs the `Garage` row and does not delete the user or garage, so no cascade fires. Explicitly delete `XpEvent` rows and reset `Garage.xp`/`likesReceived` inside the anonymization transaction.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:3: ⚠️ Major: The file declares itself "high-level plan only" and "not as a build instruction", so it cannot satisfy the requested per-chunk implementation/test audit. Convert it to the full TDD plan before locking Phase 3.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:8: ⚠️ Major: Phase 3 is allowed to start after Phase 2A, but `awardBadge` needed by 3B.33 only lands in Phase 2C per the Phase 2 plan. Gate 3B badge-XP work and its tests on Phase 2C completion.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:12: ⚠️ Major: The goal promises historical XP backfill, while lines 36, 77, and 340 say no backfill; this also contradicts `DELTA.md` lines 121-123 and `IMPLEMENTATION_xp.md` lines 152-154. Choose one policy and make every chunk, goal, and migration step match it.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:35: ⚠️ Major: The killswitch model is named `AdminGeneralSettings`, but the actual Prisma model is `GeneralSettings` and Phase 2 also hangs this field off that singleton. Rename every `AdminGeneralSettings.gamificationEnabled` reference to `GeneralSettings.gamificationEnabled`.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:48: ⚠️ Major: Adding `Garage.likesReceived` contradicts the XP handoff, which says stats are computed and "no new columns needed" in `DELTA.md` line 90 and `IMPLEMENTATION_xp.md` lines 66-70. Either compute from `FeedReaction` on read or explicitly update the handoff and add a reconciliation migration.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:53: ⚠️ Major: Public `/g/:slug` payload wiring does not require a byte-identical 404 regression for unknown slug versus private garage. Add public-garage tests asserting identical status, body bytes, and relevant headers after adding `progress` and `stats`.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:55: ⚠️ Major: API awarder coverage is described as unit tests, but `CLAUDE.md` requires API integration tests against real Postgres/Testcontainers, not mocks. Make these Vitest integration tests under `apps/api/test/...` and rely on the existing Testcontainers global setup.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:68: ⚠️ Major: The plan targets an abstract like/unlike path, but the repo implements reactions in `apps/api/src/routes/feed.ts` and has no `apps/api/src/services/feed/likes.ts`; it also supports like, dislike, update, and delete in one route. Specify hooks for create like, delete like, like-to-dislike, and dislike-to-like transitions in the actual route or extract a real service first.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:73: ⚠️ Major: `POST /admin/users/:id/garage/xp-adjustment` contradicts the "No new endpoints" API contract in `DELTA.md` line 115 and this plan's line 161. Either remove the endpoint or explicitly revise the API surface and handoff.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:73: ⚠️ Major: The new admin mutation has no rate limit, no shared body schema, no delta bounds, and no `reason` max length despite embedding it into a `@db.VarChar(120)` `sourceRef`. Add a zod schema, bounded delta, bounded reason, admin mutation rate limit, and tests.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:94: ⚠️ Major: Public SSR says the `?` opens nothing, but the done condition at line 96 says tapping `?` opens the tooltip and `DELTA.md` includes a tooltip-open artboard. Decide static or interactive SSR and align the chunk acceptance criteria.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:137: ⚠️ Major: `sourceRef` includes raw `likerUserId`, and line 309 exports `XpEvent` rows to the garage owner, leaking another user's identifier through DSR export. Use an opaque reaction id or redact cross-user identifiers in export.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:151: ⚠️ Major: Admin adjustment semantics contradict themselves: line 151 says negative adjustment is a separate positive-delta call, while line 153 says `delta` is signed for admin adjustments. Define one model and enforce it in schema, service, and tests.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:161: ⚠️ Major: The API surface says no new endpoints even though 3B.35 adds `POST /admin/users/:id/garage/xp-adjustment`. Update the API table to include the admin route or remove 3B.35.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:193: ⚠️ Major: This says progress/stats are always present and never undefined, but lines 29, 293, and 294 require omitting them for public-empty and killswitch-off responses. Make the shared schemas optional/nullable where omitted and document exact response shapes.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:200: ⚠️ Major: Adding `packages/shared/src/garage-progress.ts` omits the required `packages/shared/package.json` export entry and shared rebuild step. Add the export and verification command to rebuild `@jdm/shared` after shared/schema changes.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:206: ⚠️ Major: The new admin route file is listed, but the plan does not register it in `apps/api/src/routes/admin/index.ts`; unregistered Fastify route files are dead code in this repo. Add the import, `scope.register(...)`, and route registration test.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:246: ⚠️ Major: Caching `gamificationEnabled` for 30 seconds allows XP awards and user-facing surfaces to remain active after the single killswitch is flipped. Remove caching on awarder decisions or invalidate synchronously on `gamification.toggle`.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:349: ⚠️ Major: The proposed likes reconciliation SQL references `FeedPost.likeCount`, but the actual schema has no `likeCount`; likes are `FeedReaction` rows. Rewrite reconciliation against `FeedReaction` or drop the denormalized column.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:349: ⚠️ Major: The plan says no backfill, then defaults to a one-shot historical likes reconciliation, which still backfills a public stat. Decide whether historical engagement is included and align the no-backfill decision, migration plan, and public launch behavior.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:359: ⚠️ Major: The plan defers exact code, file paths, and test steps to a future conversion, leaving many chunks without executable code blocks or commands. Inline the per-chunk implementation and verification steps before dispatching implementers.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:115: ℹ️ Minor: `// ...existing from Phase 1 + Phase 2...` is a stub-style placeholder inside the canonical schema block. Replace it with the concrete `Garage` fields or state this is a partial diff, not canonical schema.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:358: ℹ️ Minor: The referenced `JDMA-590 · Garagem.html` path does not match the actual bundle file name `.handoffs/xp-handoff/design_handoff_garage_redesign_xp_delta/JDMA-590_-_Garagem.html`. Use the real path in the kickoff checklist.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:360: ℹ️ Minor: The checklist says "Resolve the 6 open questions" and references open questions `#2 + #5`, but the section only has three questions. Correct the count and references.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:10: 💭 Nit: `Owner: TBD` is an unresolved placeholder. Assign the owner or remove the field before kickoff.

## Cross-plan findings (issues spanning multiple plans)

docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:310: 🚨 Critical: All phases add user-owned or derived garage data while relying on no-op/cascade DSR assumptions that do not match retained Garage rows. Add explicit export/anonymize/delete/reset steps for cover uploads, badges, XP events, and counters in each plan.
docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:1468: 🚨 Critical: Phase 1 and Phase 2 both route React Native `@jdm/ui` surfaces into the Next admin/public app without a web compatibility layer. Define web-safe shared components or keep separate admin implementations before either phase lands.
docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:11: ⚠️ Major: Phase 1 defers §11 Conquistas while Phase 2 and Phase 3 are only high-level plans, leaving the handoff's v1 gamification scope without any build-ready plan. Convert Phase 2/3 to full TDD chunks or record a scope waiver for §11/§12.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:8: ⚠️ Major: Phase 3 allows kickoff after Phase 2A, but its badge-XP hooks require the Phase 2C `awardBadge` service and premium-gate semantics. Gate Phase 3B badge-XP work on Phase 2C completion.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:149: ⚠️ Major: Phase 2 and Phase 3 both name the killswitch model `AdminGeneralSettings`, but the repo and intended singleton are `GeneralSettings`. Standardize on `GeneralSettings.gamificationEnabled` across both plans and shared schemas.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:199: ⚠️ Major: Phase 2 alternates between omitting badges and returning empty arrays when disabled, while Phase 3 alternates between always-present and omitted `progress/stats`. Define one killswitch response contract for owner/public payloads before schemas are generated.
docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md:35: ⚠️ Major: Phase 1 and Phase 2 both reference `apps/admin/src/app/g/[slug]/page.tsx`, but the actual route root is `apps/admin/app`. Update all public SSR insertion points and tests to the real App Router path.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:200: ⚠️ Major: All three phases add new shared subpaths but omit at least one package export or rebuild gate. Add `packages/shared/package.json` exports and `@jdm/shared` rebuild verification to every phase that adds shared modules.
docs/superpowers/plans/2026-05-21-garage-progression-phase3-xp.md:246: ⚠️ Major: Phase 2 defines a single killswitch governance model, but Phase 3 caches the flag for 30 seconds, allowing stale award and public-render decisions. Require synchronous read/invalidation for award paths and payload render decisions.
docs/superpowers/plans/2026-05-21-garage-gamification-phase2-conquistas.md:65: ⚠️ Major: Phase 2's `BadgeRow` insertion point targets `GarageHeader`, but Phase 1 moves section-header composition into the route `ListHeaderComponent`. Update Phase 2 to insert between `<GarageHeader />` and `<VagasSectionHeader />` in the route header.

## Coverage matrix

| Handoff section                                                                | Phase 1 chunk                         | Phase 2 chunk                | Phase 3 chunk                   | Status                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------- | ------------------------------- | ------------------------------------------------------- |
| IMPLEMENTATION §0 Reading order                                                | Plan preamble / wave ordering         | N/A                          | N/A                             | Covered                                                 |
| IMPLEMENTATION §1 Visual direction — three additive systems                    | Chunks 04, 06, 07, 08, 09, 10, 13, 14 | N/A                          | N/A                             | Partial: fidelity gaps flagged                          |
| IMPLEMENTATION §1.1 Cover image                                                | Chunks 01, 02, 03, 07, 08, 09, 13     | N/A                          | N/A                             | Partial: endpoint and validation gaps flagged           |
| IMPLEMENTATION §1.2 Parking-stall card system                                  | Chunks 06, 13                         | N/A                          | N/A                             | Partial: asphalt/chevron/card-photo gaps flagged        |
| IMPLEMENTATION §1.3 PremiumBadge directions                                    | Chunks 04, 05, 08, 13                 | N/A                          | N/A                             | Partial: icon and admin-web gaps flagged                |
| IMPLEMENTATION §2 Data-model + API deltas                                      | Chunks 02, 03, 10, 11, 12, 13         | N/A                          | N/A                             | Partial: endpoint, audit, DSR, and gate gaps flagged    |
| IMPLEMENTATION §2.1 New columns on Garage                                      | Chunk 02                              | N/A                          | N/A                             | Covered                                                 |
| IMPLEMENTATION §2.2 Premium gating                                             | Chunks 02, 03, 07, 09                 | N/A                          | N/A                             | Partial: serializer/lapse logic gap flagged             |
| IMPLEMENTATION §2.3 New API endpoints                                          | Chunk 03                              | N/A                          | N/A                             | Partial: missing handoff endpoints flagged              |
| IMPLEMENTATION §2.4 Shared zod schemas                                         | Chunk 02                              | N/A                          | N/A                             | Partial: cover schema gate gap flagged                  |
| IMPLEMENTATION §2.5 Audit-log entries                                          | Chunk 03                              | N/A                          | N/A                             | Partial: audit action gaps flagged                      |
| IMPLEMENTATION §3 Design tokens patch                                          | Chunk 01                              | N/A                          | N/A                             | Partial: theme re-export gap flagged                    |
| IMPLEMENTATION §3.1 Existing tokens — no change                                | Chunk 01                              | N/A                          | N/A                             | Covered                                                 |
| IMPLEMENTATION §3.2 New tier tokens                                            | Chunk 01                              | N/A                          | N/A                             | Covered                                                 |
| IMPLEMENTATION §3.3 Cover preset definitions                                   | Chunk 01                              | N/A                          | N/A                             | Partial: shared export gap flagged                      |
| IMPLEMENTATION §4 Per-screen change list                                       | Chunks 06, 08, 09, 10, 11, 13, 14     | N/A                          | N/A                             | Partial: several parity gaps flagged                    |
| IMPLEMENTATION §4.1 Fresh signup                                               | Chunks 08, 14                         | N/A                          | N/A                             | Covered                                                 |
| IMPLEMENTATION §4.2 Partial fill / At cap / Unlimited                          | Chunk 06                              | N/A                          | N/A                             | Partial: stall-card fidelity gaps flagged               |
| IMPLEMENTATION §4.3 Mixed                                                      | Chunk 06                              | N/A                          | N/A                             | Covered                                                 |
| IMPLEMENTATION §4.4 Premium owner                                              | Chunks 07, 08                         | N/A                          | N/A                             | Partial: tier/accent gaps flagged                       |
| IMPLEMENTATION §4.5 Edit garage sheet                                          | Chunk 08                              | N/A                          | N/A                             | Covered                                                 |
| IMPLEMENTATION §4.6 Premium sheet                                              | Chunk 04                              | N/A                          | N/A                             | Partial: benefit icon gap flagged                       |
| IMPLEMENTATION §4.7 Cover picker                                               | Chunk 09                              | N/A                          | N/A                             | Partial: locked-tile upsell gaps flagged                |
| IMPLEMENTATION §4.8 Buy-spot sheet                                             | Chunk 10                              | N/A                          | N/A                             | Partial: checkout-return gap flagged                    |
| IMPLEMENTATION §4.9 Public populated/empty/404                                 | Chunk 13                              | N/A                          | N/A                             | Partial: path, token, photo, and preset gaps flagged    |
| IMPLEMENTATION §4.10 Share link bug                                            | Chunk 11                              | N/A                          | N/A                             | Covered                                                 |
| IMPLEMENTATION §5 Component spec sheet                                         | Chunks 04, 06, 07, 08, 09, 10         | N/A                          | N/A                             | Partial                                                 |
| IMPLEMENTATION §5.1 ParkingStallCard                                           | Chunk 06                              | N/A                          | N/A                             | Partial                                                 |
| IMPLEMENTATION §5.2 PremiumBadge                                               | Chunks 04, 05                         | N/A                          | N/A                             | Partial                                                 |
| IMPLEMENTATION §5.3 GarageCover                                                | Chunks 07, 09, 13                     | N/A                          | N/A                             | Partial                                                 |
| IMPLEMENTATION §5.4 PremiumSheet/CoverPickerSheet/BuySpotSheet/EditGarageSheet | Chunks 04, 08, 09, 10                 | N/A                          | N/A                             | Partial                                                 |
| IMPLEMENTATION §6 Accessibility checklist                                      | Chunks 04, 06, 07, 08, 09, 10, 13, 14 | N/A                          | N/A                             | Partial: no dedicated checklist gate                    |
| IMPLEMENTATION §7 PR-sized chunk list                                          | Chunks 01-14                          | N/A                          | N/A                             | Covered                                                 |
| IMPLEMENTATION §8 What's NOT in this v1                                        | Deferred section                      | Phase 2 covers §11           | Phase 3 covers §12              | Partial: §11 scope conflict flagged                     |
| IMPLEMENTATION §9 UX Audit J ties                                              | Chunks 10, 11, 13, 14 / tie-back      | Phase 2 tie-back             | Phase 3 tie-back                | Partial                                                 |
| IMPLEMENTATION §10 Open questions                                              | Deferred/open questions               | Phase 2 open questions       | Phase 3 open questions          | Partial: unresolved placeholders/open questions flagged |
| IMPLEMENTATION §11 Gamification — Conquistas                                   | MISSING/deferred in Phase 1           | Phase 2A-2D                  | N/A                             | Partial: high-level only and critical gaps flagged      |
| IMPLEMENTATION §11.1 What                                                      | MISSING/deferred                      | Phase 2A-2C                  | N/A                             | Partial                                                 |
| IMPLEMENTATION §11.2 Design standard                                           | MISSING/deferred                      | Phase 2B, 2D                 | N/A                             | Partial                                                 |
| IMPLEMENTATION §11.3 Placement                                                 | MISSING/deferred                      | Phase 2B                     | N/A                             | Partial: insertion-point drift flagged                  |
| IMPLEMENTATION §11.4 Data model                                                | MISSING/deferred                      | Phase 2A / Data model deltas | N/A                             | Partial: schema gaps flagged                            |
| IMPLEMENTATION §11.5 API surface                                               | MISSING/deferred                      | Phase 2B / API surface       | N/A                             | Partial: route/schema registration gaps flagged         |
| IMPLEMENTATION §11.6 Awarder                                                   | MISSING/deferred                      | Phase 2C / Awarder map       | N/A                             | Partial: premium gate and unawardable badges flagged    |
| IMPLEMENTATION §11.7 PR-sized chunks                                           | MISSING/deferred                      | Phase 2A-2D                  | N/A                             | Partial: not build-ready TDD                            |
| IMPLEMENTATION §11.8 LGPD posture                                              | MISSING/deferred                      | Phase 2 LGPD posture         | N/A                             | Partial: anonymize/export gaps flagged                  |
| IMPLEMENTATION §11.9 Friction / UX-Audit ties                                  | MISSING/deferred                      | Phase 2 UX tie-back          | N/A                             | Covered at outline level                                |
| IMPLEMENTATION §11.10 Out of scope for v1                                      | MISSING/deferred                      | Phase 2 out-of-scope         | N/A                             | Partial: COM badge scope mismatch flagged               |
| IMPLEMENTATION_xp §12 Progression — XP + Ranking + Stats                       | N/A                                   | Dependency surface           | Phase 3A-3D                     | Partial: high-level only and critical gaps flagged      |
| IMPLEMENTATION_xp §12.1 What                                                   | N/A                                   | Dependency surface           | Phase 3A, 3C                    | Partial                                                 |
| IMPLEMENTATION_xp §12.2 Rank tiers                                             | N/A                                   | Dependency surface           | Phase 3A / Rank derivation / 3C | Partial                                                 |
| IMPLEMENTATION_xp §12.3 XP-earning rules                                       | N/A                                   | Dependency surface           | Phase 3B / XP-awarder rules     | Partial: idempotency and rollback gaps flagged          |
| IMPLEMENTATION_xp §12.4 Visual standard                                        | N/A                                   | Dependency surface           | Phase 3C                        | Partial                                                 |
| IMPLEMENTATION_xp §12.5 Placement                                              | N/A                                   | Dependency surface           | Phase 3C                        | Partial                                                 |
| IMPLEMENTATION_xp §12.6 Data model                                             | N/A                                   | Dependency surface           | Phase 3A / Data model deltas    | Partial: handoff contradiction flagged                  |
| IMPLEMENTATION_xp §12.7 API surface                                            | N/A                                   | Dependency surface           | Phase 3A / API surface          | Partial: endpoint contradiction flagged                 |
| IMPLEMENTATION_xp §12.8 Shared zod schemas                                     | N/A                                   | Dependency surface           | Phase 3A / File structure       | Partial: optionality/export gaps flagged                |
| IMPLEMENTATION_xp §12.9 XP-awarder service                                     | N/A                                   | Dependency surface           | Phase 3A, 3B / XP-awarder rules | Partial: race/idempotency gaps flagged                  |
| IMPLEMENTATION_xp §12.10 PR-sized chunks                                       | N/A                                   | Dependency surface           | Phase 3A-3D                     | Partial: not build-ready TDD                            |
| IMPLEMENTATION_xp §12.11 LGPD posture                                          | N/A                                   | Dependency surface           | Phase 3 LGPD posture            | Partial: export/anonymize gaps flagged                  |
| IMPLEMENTATION_xp §12.12 Friction / UX hooks                                   | N/A                                   | Dependency surface           | Phase 3 UX tie-back             | Covered at outline level                                |
| IMPLEMENTATION_xp §12.13 Out of scope for v1                                   | N/A                                   | Dependency surface           | Phase 3 out-of-scope            | Partial: backfill contradiction flagged                 |

## Subagent token usage

- Phase 1 reviewer `019e4b5f-c228-7fe0-aef8-34012d0ba951` / Mill: not exposed by `spawn_agent` or `wait_agent` tool output.
- Phase 2 reviewer `019e4b5f-c25c-7121-b081-4977f1cff6da` / Kant: not exposed by `spawn_agent` or `wait_agent` tool output.
- Phase 3 reviewer `019e4b5f-c289-7041-9d40-4be35184dbc4` / Godel: not exposed by `spawn_agent` or `wait_agent` tool output.
