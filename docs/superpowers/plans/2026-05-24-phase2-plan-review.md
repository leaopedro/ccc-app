# Phase 2 Plan Review

## BLOCK findings

### docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md

- Chunks: BLOCK: DSR export/anonymize invariant from the Phase 2 outline is not assigned to any chunk. Fix: Add a 2A chunk or explicit scope in chunk 23/28 with export and anonymize tests for `Garage.xp`, `Garage.likesReceived`, and `XpEvent`.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-23-garage-xp-columns.md

- Task 3.1: BLOCK: Each test calls `createUser()` then creates a second `Garage` for the same `userId`, but `Garage.userId` is unique. Fix: Reuse the helper-created garage via `findUniqueOrThrow({ where: { userId: user.id } })`.
- Task 3.1: BLOCK: The test types `reasons` as `Prisma.XpReason[]`, but Prisma enums are top-level types and `@ccc/db` does not export `XpReason`. Fix: Import `type { XpReason }` from `@prisma/client` or re-export it from `@ccc/db`.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-24-shared-zod-progress-stats.md

- Deviation notes / Tasks 3-4: BLOCK: The plan keeps `gamification` only under `garage`, but §C10, the skeleton, and chunk 28 require response-level `gamification`; chunk 28 will stop or fail on `body.gamification`. Fix: Add top-level `gamification` to both response schemas and tests.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-27-xp-awarder-service.md

- Canonical code shape: BLOCK: `awardXp` is defined as `(tx, garageId, opts)`, but the skeleton and chunks 29-35 call `(tx, garageId, reason, opts)`, so downstream chunks will not compile. Fix: Align chunk 27 to the positional signature or update every dependent chunk plan together.
- Canonical code shape: BLOCK: `awardXp('post_like')` does not increment `Garage.likesReceived`, while chunk 32 says awarder owns that counter and the route must not update it. Fix: Make ownership consistent by moving the `likesReceived` increment into `awardXp` or changing chunk 32 to own it.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-28-route-payloads-progress-stats.md

- Task 2: BLOCK: The tests assert `body.gamification.enabled` after `garageReadSchema.parse` / `garagePublicResponseSchema.parse`, but chunk 24 keeps `gamification` nested under `garage`, so zod strips the top-level field and these tests cannot pass. Fix: Align chunk 28 with chunk 24's `body.garage.gamification.enabled`, or update chunk 24 before this chunk.
- Task 3 / Task 4: BLOCK: The implementation calls `getGarageProgress(garage.id)` and `getGarageStats(garage.id)`, but chunks 26 and 25 define `getGarageProgress(client, garageId)` and `getGarageStats(prisma, garageId)`. Fix: Pass `prisma` as the first argument in both owner and public handlers.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-29-awarder-event-checkin.md

- Goal: BLOCK: `awardXp(tx, garageId, 'event_checkin', { sourceRef })` contradicts chunk 27's canonical signature `awardXp(tx, garageId, { reason: 'event_checkin', sourceRef })`, so the planned implementation will not typecheck. Fix: Update every call, test, and checklist reference to pass the chunk 27 options object shape.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-31-awarder-feed-post-create.md

- Code shape (target final state): BLOCK: `awardXp` import path and call signature contradict chunk 27, which defines `apps/api/src/services/garage/xp-awarder.ts` and `awardXp(tx, garageId, opts)`. Fix: Import from chunk 27's module and call the options-object form with `reason: 'post_create'` and `sourceRef: 'post:<created.id>'`.
- Task 2: BLOCK: `seedEvent()` omits required `Event.type` and `Event.capacity`, and the tests expect 201 without seeding a valid ticket for default `postingAccess: attendees`. Fix: Mirror `apps/api/test/feed/crud.test.ts` by seeding a published event with type/capacity, a tier, and a valid ticket.
- Task 2: BLOCK: The killswitch test upserts `GeneralSettings` with numeric `id: 1`, but the repo uses a string singleton id via `GENERAL_SETTINGS_SINGLETON_ID`. Fix: Import and use `GENERAL_SETTINGS_SINGLETON_ID` for the upsert.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-32-awarder-feed-post-like-unlike.md

- Code shape: BLOCK: `awardXp(tx, authorGarageId, 'post_like', { sourceRef })` drifts from chunk 27, which exposes `awardXp(tx, garageId, { reason: 'post_like', sourceRef })`, so the planned route will not typecheck. Fix: Use chunk 27's canonical options-object signature.
- Awarder service: BLOCK: The plan assumes `awardXp(post_like)` increments `Garage.likesReceived`, but chunk 27's canonical awarder only increments `Garage.xp` and its revert tests seed `likesReceived` manually. Fix: Align chunk 27 before this chunk, or explicitly update `likesReceived` in this chunk without double-counting.
- Code shape: BLOCK: The transaction catches `FeedReaction.create` P2002 and then continues inside the same interactive Postgres transaction, which can leave the transaction aborted. Fix: Avoid expected unique errors inside the tx, or retry the whole transaction after P2002.
- Task 1: BLOCK: `enableGamification` and `disableGamification` upsert `GeneralSettings.id` as number `1`, but the schema uses a string id. Fix: Use the repo's string id convention, e.g. `general_default`.
- Task 1: BLOCK: `buildFixture` creates an invalid and inaccessible event, missing required `type` and `capacity`, and leaving `feedAccess` as `attendees` without giving the liker a ticket. Fix: Mirror feed tests by setting `type`, `status`, `capacity`, and `feedAccess: 'public'`, or seed a valid ticket.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-33-awarder-badge-grant.md

- Task 2.2: BLOCK: The plan adds an `awardBadge`-local try/catch around `awardXp` and Step 1.8 pins that behavior, contradicting §C1 and the file's own Corrections section, which say `awardBadge` does not need its own try/catch around `awardXp`. Fix: remove the local try/catch, `console.warn` path, and synthetic throw test; call `awardXp` directly after `recordAudit`.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-35-admin-xp-adjustment-route.md

- Task 3 - Route handler: BLOCK: The planned code commits XpEvent and Garage.xp before writing AdminAudit, so audit failure leaves a persisted unaudited admin adjustment. Fix: Write AdminAudit inside the same prisma.$transaction after awardXp succeeds, passing tx to recordAudit.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-36-xp-scoreboard-component.md

- File structure: BLOCK: The plan imports `expo-linear-gradient` from `@ccc/ui` but excludes `packages/ui/package.json`, so the package dependency remains undeclared. Fix: Add `packages/ui/package.json` and lockfile updates for `expo-linear-gradient`.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-39-profile-stats-wrapper.md

- Type contract: BLOCK: `GarageStats` is documented and tested with `memberSince`, but the authoritative Phase 2 shape and chunk 24 contract use required `joinedAt`, so the typed fixtures will not compile. Fix: Replace `memberSince` with `joinedAt` everywhere in this plan.
- Task 1 — Failing tests first: BLOCK: the tooltip close test calls `tooltip.props.onClose()`, but chunk 38 forwards `onClose` to the rendered `Modal` as `onRequestClose`, so the test will fail. Fix: Invoke `props.onRequestClose()` or press `${testID}-backdrop` after opening.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-41-public-ssr-integration.md

- Pre-flight checklist / Code shape: BLOCK: The plan reads `garage.gamification.enabled`, but authoritative §C10 and chunk 28 require `gamification: { enabled }` at the response top level, so SSR wires the killswitch to the wrong payload path. Fix: Pass `data.gamification.enabled` through `page.tsx` and `PublicGarageView`, or update §C10 before implementation.

## MAJOR findings

### docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md

- Chunk 23: MAJOR: `@@unique([garageId, reason, sourceRef])` does not enforce idempotency for nullable `sourceRef` values in Postgres. Fix: Make `sourceRef` non-null or require and test non-null `sourceRef` at the awarder boundary.
- Chunk 27: MAJOR: The unlike test says "killswitch off at unlike time but on at like time (no prior row)", but that setup creates a prior row and contradicts §C2. Fix: Change the no-prior-row case to "killswitch disabled at like time, then enabled before unlike".
- Chunk 39: MAJOR: §C10 makes `progress` and `stats` optional, but `ProfileStats` acceptance dereferences `progress.xp` and `stats.*` without a missing-payload contract. Fix: Add acceptance and tests that missing `progress` or `stats` returns `null`.
- Chunks 36/39/41: MAJOR: SSR requires a static `?`, but `XPScoreboard` requires an open-tooltip prop and `ProfileStats` always owns tooltip state. Fix: Define a shared `tooltipMode` or optional handler contract and test the static SSR variant.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-00-phase1-polish-foldin.md

- Item C: MAJOR: `@testing-library/react` is absent from `apps/mobile/package.json`, but the provided `useBuySpotFlow.test.ts` imports it. Fix: Provide the no-new-deps `createRoot` hook harness in the plan.
- Item D: MAJOR: The test snippet references nonexistent `getGarageMock`, `getMyBadgesMock`, `mountRoute`, and `refocus`; the current route test mock runs `useFocusEffect` only once. Fix: Add an explicit refocus harness using the existing `apiState` mocks.
- Item E: MAJOR: A single `pendingCode` loses row-level pending state when row B is clicked while row A is still in flight. Fix: Track a `Set<string>` of pending codes and test two concurrent grants.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-23-garage-xp-columns.md

- Task 3.1: MAJOR: The "pre-existing Garage rows" test creates the Garage after migrations already ran, so it does not cover the claimed migration path. Fix: Rename it to a post-migration raw default test or add a true pre-migration seed/deploy migration test.
- Task 1.4: MAJOR: The note says future `admin_adjustment` may use `NULL` `sourceRef`, which bypasses Postgres unique enforcement and conflicts with §C1/§C7 server-generated unique sourceRefs. Fix: Keep schema nullable only if required, but state all awarder and admin writes must provide non-null `sourceRef`.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-24-shared-zod-progress-stats.md

- Deviation notes / Task 4: MAJOR: The plan rejects §C10's response-level public `badges` field and leaves badges only nested under `garage`. Fix: Add response-level `badges` per §C10 or update the authoritative correction and downstream chunks first.
- Deviation notes / Task 2: MAJOR: The plan intentionally uses `{ "types": "./src/garage-progress.ts", "default": "./dist/garage-progress.js" }`, contradicting §C12's required `{ "types": "./dist/garage-progress.d.ts", "import": "./dist/garage-progress.js" }`. Fix: Use the §C12 export shape or revise §C12 before implementation.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-25-garage-stats-service.md

- D4: MAJOR: `getGarageStats(prisma, garageId)` drifts from chunk 28, whose route snippets call `getGarageStats(garage.id)`. Fix: Update chunk 28 to pass `prisma`, or export a wrapper matching the one-arg call.
- Branch safety preflight: MAJOR: The command block omits `git branch --show-current`, so it does not enforce CLAUDE.md's production stop before switching branches. Fix: Add `git branch --show-current` as the first command and stop on `production`.
- Task 4: MAJOR: The events test never seeds a used ticket for another user, so an implementation missing the `userId` filter could still pass. Fix: Add another user's `used` ticket and keep the expected count at 3.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-26-garage-progress-service.md

- Goal: MAJOR: `getGarageProgress(client, garageId)` drifts from chunk 28, which calls `getGarageProgress(garage.id)`, so route wiring will not typecheck. Fix: Standardize the contract, preferably `getGarageProgress(garageId, client = prisma)`, and update tests accordingly.
- Verification: MAJOR: `pnpm --filter @ccc/api test -- apps/api/test/garage/progress.test.ts` uses a root-relative path while the filtered script runs from `apps/api`, so Vitest may find no tests. Fix: Use `pnpm --filter @ccc/api exec vitest run test/garage/progress.test.ts`.
- Task 4: MAJOR: `pnpm --filter @ccc/api lint -- apps/api/test/garage/progress.test.ts apps/api/src/services/garage/progress.ts` is wrong for this package script and path base. Fix: Use `pnpm --filter @ccc/api exec eslint src/services/garage/progress.ts test/garage/progress.test.ts`.
- Branch + preflight: MAJOR: The plan omits the chunk 23 dependency check for `Garage.xp`, yet this chunk edits no Prisma schema and will fail before chunk 23 lands. Fix: Add a preflight that stops unless chunk 23 migration and generated Prisma `Garage.xp` are present.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-27-xp-awarder-service.md

- Canonical code shape: MAJOR: Non-P2002 errors rethrow, contradicting skeleton §Chunk 27 and chunks 30/35, which require `awardXp` to never throw to callers. Fix: Pick one contract and update chunk 27 plus all consumer chunks and tests to match.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-28-route-payloads-progress-stats.md

- Task 3 / Task 4 verification: MAJOR: The scoped commands use `-t "GET /me/garage"` and `-t "GET /g/:slug"`, but the planned test names are `owner:` and `public:`, so the commands do not verify the intended tests. Fix: Rename the tests/describes to include the route strings or filter by `owner:` and `public:`.
- Task 2: MAJOR: Public hide-on-empty tests cover `xp > 0` and `likesReceived > 0`, but miss `events > 0` and `posts > 0`, despite acceptance requiring any metric to reveal both blocks. Fix: Add public route cases for one used event and one visible post, or parameterize all four metrics.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-29-awarder-event-checkin.md

- Architecture: MAJOR: The defensive call-site `try/catch` swallows non-P2002 `awardXp` throws, but chunk 27 says non-P2002 errors rethrow so the parent tx rolls back; catching here can commit partial XP writes and breaks same-tx consistency. Fix: Do not catch `awardXp` at this call site, or change chunk 27's contract first.
- Task 1: MAJOR: The rollback test calls `awardXp` inside a manual `$transaction` instead of driving `checkInTicket`, so it does not prove the chunk 29 hook is inside the existing check-in transaction. Fix: Add a real `checkInTicket` rollback-path test that fails if `awardXp` is moved outside the check-in tx.
- Task 1: MAJOR: The plan says all five tests fail before implementation, but killswitch-off, awarder-throw, and manual rollback can pass with no check-in hook, leaving the splice under-tested. Fix: Make those tests assert `awardXp` is invoked from `checkInTicket` or revise the failing-test expectations.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-30-awarder-car-create.md

- Code shape — the splice in `cars.ts`: MAJOR: The call-site `try/catch` can swallow an unexpected `awardXp` throw inside the interactive transaction, allowing partial XP side effects to commit and contradicting same-tx atomicity. Fix: Call `awardXp` directly and rely on chunk 27 to swallow expected failures before partial writes.
- Test plan: MAJOR: Test 5 uses duplicate nickname, which fails at `tx.car.create` before `awardXp` runs, so it does not prove XP rollback after an award write. Fix: Replace it with a deterministic rollback test that calls `awardXp` inside a tx and throws after the call.
- Test code skeletons: MAJOR: The killswitch test upserts `GeneralSettings` with `where: { id: 1 }`, but the schema uses a string singleton id and `killswitch.ts` reads `GENERAL_SETTINGS_SINGLETON_ID`. Fix: Import `GENERAL_SETTINGS_SINGLETON_ID` and use it in both `where` and `create`.
- Verification before PR: MAJOR: Verification runs `test/garage/awarder.test.ts`, but chunk 27's XP service suite is `test/garage/xp-awarder.test.ts`; this misses the relevant XP-awarder contract. Fix: Replace that command with the chunk 27 XP awarder test path.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-31-awarder-feed-post-create.md

- Task 2: MAJOR: The tests seed `COM-001` and assert total `Garage.xp === 2`, which will fail once chunk 33 adds `badge_award` XP through the same `awardBadge` path. Fix: Pre-award/suppress the badge branch or assert only the isolated `post_create` delta.
- Task 2: MAJOR: The rollback spec calls `awardXp` directly in a manual transaction, so it does not verify that the feed POST hook uses the parent feed-post transaction. Fix: Add route-level coverage or remove the claim that this spec proves the hook's same-tx splice.
- Task 4: MAJOR: Regression commands run `apps/api/test/garage/awarder.test.ts`, but chunk 27's XP service regression files are `xp-awarder.test.ts` and `xp-revert-on-unlike.test.ts`. Fix: Replace or add the chunk 27 XP regression test commands.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-32-awarder-feed-post-like-unlike.md

- Code shape: MAJOR: Catching awarder errors inside `$transaction` can commit partial awarder writes, such as an `XpEvent` created before `Garage.update` throws. Fix: Let the tx roll back on awarder failure, then retry the reaction-only path or assert no partial XP state.
- Task 9: MAJOR: `vi.spyOn(prisma.garage, 'update')` will not reliably intercept `tx.garage.update`, so the awarder-failure test may not exercise the route catch. Fix: Mock the awarder module call or use a fault path that runs through the transaction client.
- Task 10: MAJOR: `vi.spyOn(prisma.feedReaction, 'update')` will not reliably intercept `tx.feedReaction.update`, so the rollback test can fail to trigger the intended mid-tx throw. Fix: Force rollback through the transaction client path or rewrite the test around a controlled route-level failure.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-34-awarder-premium-activation.md

- Task 3 / Verification: MAJOR: Skeleton Chunk 34 requires concurrent activation idempotency coverage, but the plan only tests sequential revoke/re-grant and final verification lists four tests with no concurrent double-grant case. Fix: Add a concurrent two-request premium grant test and assert `Garage.xp === 200` with one `premium_activation` `XpEvent`.
- Scope / Task 5: MAJOR: Scope says the new integration test covers awarder throw swallowing and parent transaction rollback, but Task 5 explicitly adds no runtime tests and final verification excludes both cases. Fix: Either remove those cases from Scope or add concrete verification steps for them.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-35-admin-xp-adjustment-route.md

- Task 4 - Register the route (§C13): MAJOR: Registering inside the existing admin-user-mut limiter makes XP adjustments share that 30/min bucket with user mutations, contradicting §C7. Fix: Put the XP route in its own admin-only register block, separate from adminUserMutationRoutes.
- File Structure: MAJOR: The admin UI scope omits the API/action files needed for submit, but Task 6.4 references an XP admin fetcher that does not exist. Fix: Add admin-garage API and server action updates to the touched files.
- Task 6 - Admin UI modal: MAJOR: Client validation uses Number.parseInt, so 1.5 becomes 1 and can pass despite the server rejecting non-integer deltas. Fix: Parse with Number(delta) and require Number.isInteger on the full value.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-36-xp-scoreboard-component.md

- Task 3 — Tests: MAJOR: The mobile commands use nonexistent filter `@ccc/jdma-mobile`, so verification will not run. Fix: Replace it with `@ccc/mobile`.
- Task 3 — Tests: MAJOR: `pnpm ... test -- XPScoreboard.test.tsx` runs the full mobile suite with the current script, violating touched-paths-only. Fix: Use `pnpm --filter @ccc/mobile exec vitest run XPScoreboard.test.tsx --passWithNoTests`.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-37-stats-row-component.md

- Task 1 — Helper `formatJoinedAt`: MAJOR: The proposed test mock does not mirror `BadgeRow.test.tsx`; importing `@ccc/ui` will also load exports that require `ActivityIndicator`, `Image`, `Modal`, `ScrollView`, and `react-native-svg`, so the tests can fail before reaching `StatsRow`. Fix: Copy the existing `BadgeRow.test.tsx` RN/SVG mocks and add `Platform` for `StatsRow`.
- Task 1 — Helper `formatJoinedAt`: MAJOR: Every `pnpm --filter @ccc/mobile test -- apps/mobile/src/...` command uses a repo-root path, but filtered package scripts run from `apps/mobile`; with `--passWithNoTests`, Vitest exits 0 after running zero tests. Fix: Use `src/screens/garage/__tests__/StatsRow.test.tsx` in all filtered mobile test commands.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-38-xp-tooltip-component.md

- Blur deviation (locked): MAJOR: It drops the required Phase 2 §2C.38 backdrop blur without a C1-C14 correction. Fix: Keep blur in scope, or amend the authoritative outline first.
- File structure: MAJOR: The plan limits work to five paths, but Task 1 requires `pnpm-lock.yaml`. Fix: Add `pnpm-lock.yaml` to allowed paths, or remove new dependency installs.
- Task 1 — Vitest harness for @ccc/ui: MAJOR: The proposed config does not mirror mobile and omits the `lucide-react-native` test stub needed by imported icons. Fix: Copy the relevant mobile Vitest alias setup into `@ccc/ui`.
- Task 3 — Implement XP_RULES + XPRule (no component yet): MAJOR: The expected partial pass is impossible because tests statically import missing `XPTooltip`. Fix: Add a temporary export stub, split tests, or change the staged failure expectation.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-40-owner-mobile-integration.md

- Code shape: MAJOR: The plan reads the killswitch from `data.garage.gamification.enabled`, but Phase 2 §C10 defines `gamification.enabled` on the owner response envelope. Fix: Use the §C10 envelope path consistently in the viewmodel, route, fixtures, and tests.
- Locked invariants: MAJOR: It says `<ProfileStats />` re-checks via `useFocusEffect`, but the same plan later says no new effect and relies on the route refetching. Fix: State that the route's existing `useFocusEffect` refetch refreshes the prop, while `ProfileStats` only gates on received props.
- Task 4 — Route ordering + visibility tests: MAJOR: The focus re-enable test renders `<Route />` after remount, but `Route` is scoped inside the existing `mount()` helper and will not compile. Fix: Hoist the route component into outer test scope or import it inside that test before rerendering.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-41-public-ssr-integration.md

- ProfileStatsWeb.tsx: MAJOR: `ProfileStatsWeb` claims to own public hide-on-empty but only checks missing `progress` or `stats`, so a present all-zero payload still renders contrary to Phase 2C.39. Fix: Return null when `progress.xp`, `stats.events`, `stats.posts`, and `stats.likesReceived` are all zero, and test that case.
- Task 5: MAJOR: Task 5.1 claims to verify §C9 byte-identical 404 parity with an admin component test filter, which does not exercise the API unknown-slug vs private-slug status/body/header invariant. Fix: Run the existing API §C9 404 byte-parity test or an admin route-level equivalent that compares both paths.

## MINOR findings

### docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md

- Dependency graph: MINOR: The graph says 2B can start after chunk 27, but dispatch order gates 2B on chunk 28. Fix: Align both sections on whether 28 is required before chunks 29-35.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-00-phase1-polish-foldin.md

- Corrections + deviations: MINOR: The file says Phase 2 `§C` references are none, but Item C repeatedly cites `§C10`, which means Phase 1 C10, not Phase 2 C10. Fix: Rename those references to `Phase 1 §C10` or `.handoffs §72 #2`.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-25-garage-stats-service.md

- Task 5: MINOR: The posts test omits `status='removed'`, despite `FeedPostStatus` having `removed` and the skeleton requiring deleted/hidden exclusion. Fix: Add a removed authored row and keep the expected visible count at 2.
- D4: MINOR: The plan claims prisma injection allows transaction composition, but the signature uses `PrismaClient` and rejects `Prisma.TransactionClient`. Fix: Use a narrow read-client type that includes `Prisma.TransactionClient`, or remove the tx-composition claim.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-26-garage-progress-service.md

- Verification: MINOR: `git status` expects staged paths after all task commits, which contradicts the planned commit flow and will usually be clean. Fix: Verify touched paths with `git diff --name-only main...HEAD` instead.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-27-xp-awarder-service.md

- Task 3: MINOR: The admin negative-delta test asserts `findMany().map(e => e.delta)` equals `[100, -40]` without an `orderBy`, so Postgres row order can make it flaky. Fix: Add deterministic ordering or assert the two deltas as an unordered set.
- Task 10: MINOR: Final verification claims `8 awarder + 5 revert = 13 tests`, but Tasks 2-6 define 12 awarder tests and Tasks 7-9 define 5 revert tests. Fix: Correct the expected total to 17 or remove the brittle count.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-29-awarder-event-checkin.md

- File Structure: MINOR: The test path `apps/api/test/garage/awarder-event-checkin.test.ts` drifts from the skeleton's `apps/api/test/garage/xp-event-checkin.test.ts`. Fix: Use the skeleton filename or document the deviation consistently.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-30-awarder-car-create.md

- Files touched: MINOR: The new test path drifts from the skeleton's canonical `apps/api/test/garage/xp-car-create.test.ts` to `awarder-car-create.test.ts`. Fix: Use `apps/api/test/garage/xp-car-create.test.ts` consistently.
- Corrections from §"Corrections applied 2026-05-21 post-review" that apply: MINOR: The section says only §C1 applies while the plan also depends on §C5 killswitch behavior. Fix: List §C1 and §C5 as applicable, with §C5 owned by chunk 27 and covered by the killswitch-off test.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-31-awarder-feed-post-create.md

- Files touched: MINOR: Test file path drifts from skeleton chunk 31, which names `apps/api/test/garage/xp-post-create.test.ts`. Fix: Use the skeleton path or document the coordinated deviation.

### docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-32-awarder-feed-post-like-unlike.md

- Verification: MINOR: `pnpm --filter @ccc/api lint -- apps/api/src/routes/feed.ts apps/api/test/garage/awarder-feed-post-like.test.ts` passes package-root-relative paths to a script that already runs `eslint src`, so the test path and prefixed paths are wrong. Fix: Use `pnpm --filter @ccc/api exec eslint src/routes/feed.ts test/garage/awarder-feed-post-like.test.ts`.

## Cross-chunk consistency matrix

| Drift                                                                                                | Affected files                                                                                        | Canonical version                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gamification.enabled` envelope path differs between top-level response and nested `garage` payload. | `chunk-24`, `chunk-28`, `chunk-40`, `chunk-41`; skeleton also expects top-level.                      | §C10 canonical is response-level `gamification: { enabled: boolean }`; align schemas, route tests, mobile viewmodel, and SSR to `body.gamification.enabled`.                                                |
| `progress` / `stats` optionality and hide-on-empty contract is under-specified.                      | Skeleton, `chunk-24`, `chunk-28`, `chunk-39`, `chunk-41`.                                             | Owner returns `progress` and `stats` when `gamification.enabled === true`; public omits when killswitch is off or all metrics are zero; UI wrappers return null when fields are missing or public all-zero. |
| Service signatures for route payload wiring differ.                                                  | `chunk-25`, `chunk-26`, `chunk-28`.                                                                   | Choose one signature before dispatch; reviewers recommend `getGarageStats(prisma, garageId)` and `getGarageProgress(client, garageId)` unless chunks 25/26 are revised to one-arg wrappers.                 |
| `awardXp` signature differs across the awarder and all 2B hooks.                                     | Skeleton, `chunk-27`, `chunk-29`, `chunk-31`, `chunk-32`; likely chunks 30, 33, 34, 35 by dependency. | Pick one API and update all plans together; current chunk 27 canonical is `awardXp(tx, garageId, { reason, sourceRef, ... })`, while skeleton/consumers use `(tx, garageId, reason, opts)`.                 |
| `awardXp` error behavior differs between service and call sites.                                     | Skeleton, `chunk-27`, `chunk-29`, `chunk-30`, `chunk-32`, `chunk-33`, `chunk-34`, `chunk-35`.         | Pick one atomicity contract; safest is chunk 27 catches expected duplicates only, rethrows unexpected errors, and callers do not swallow inside parent transactions.                                        |
| `post_like` ownership of `Garage.likesReceived` is split.                                            | `chunk-27`, `chunk-32`, skeleton.                                                                     | Canonical owner must be one place only; if awarder owns `post_like`, `awardXp` increments `Garage.likesReceived` and `revertLikeXp` decrements it.                                                          |
| `sourceRef` idempotency relies on nullable schema.                                                   | Skeleton, `chunk-23`, `chunk-27`, `chunk-35`.                                                         | §C1/§C7 require DB-enforced idempotency; require non-null server-generated `sourceRef` for every awarder/admin write, even if schema remains nullable for migration compatibility.                          |
| GeneralSettings singleton id is inconsistent.                                                        | `chunk-30`, `chunk-31`, `chunk-32`; chunk 28 uses the shared constant.                                | Use `GENERAL_SETTINGS_SINGLETON_ID` everywhere, never numeric `id: 1`.                                                                                                                                      |
| Feed/event fixtures omit required event access fields.                                               | `chunk-31`, `chunk-32`.                                                                               | Mirror existing feed tests with valid `Event.type`, `capacity`, published status, and either `feedAccess: 'public'` or a valid ticket for attendee-only access.                                             |
| Filtered package test and lint commands use repo-root paths or wrong package names.                  | `chunk-26`, `chunk-28`, `chunk-36`, `chunk-37`, `chunk-38`; `chunk-32` lint.                          | Use package-root-relative paths with `pnpm --filter <pkg> exec vitest run ...` and `pnpm --filter <pkg> exec eslint ...`; mobile package is `@ccc/mobile`.                                                  |
| XP regression test filenames drift from skeleton names.                                              | `chunk-29`, `chunk-30`, `chunk-31`, `chunk-32`.                                                       | Use skeleton names consistently: `xp-event-checkin.test.ts`, `xp-car-create.test.ts`, `xp-post-create.test.ts`, and the agreed post-like test filename.                                                     |
| Tooltip interaction contract is not shared for mobile and SSR.                                       | Skeleton, `chunk-36`, `chunk-38`, `chunk-39`, `chunk-41`.                                             | Define a shared optional handler or `tooltipMode` contract; mobile can open modal, SSR/static web can render a non-interactive `?` without owning modal state.                                              |
| UI package dependency and harness setup drift.                                                       | `chunk-36`, `chunk-38`, `chunk-37`.                                                                   | Any new UI dependency must update `packages/ui/package.json` and lockfile; UI tests should reuse mobile/RN/SVG mocks including `lucide-react-native` stubs.                                                 |
