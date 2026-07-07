# Phase 2 chunks skeleton — Garage progression (XP + ranks + stats)

> **For the next-stage writing-plans agents:** this is the MASTER INDEX. One agent per chunk fleshes out a TDD plan at `docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-NN-<slug>.md`. Read your chunk's section + the cited outline sections in `2026-05-21-garage-progression-phase2-xp.md` (read its `Corrections applied 2026-05-21 post-review` §C1–C14 first — they override inline chunk text). Do NOT re-derive the schema or rules; the outline owns them. Your job is per-chunk TDD detail (files, exact code, test names, verification commands, deviations).

## Status / readiness

- **Phase 1 status:** COMPLETE on `main` (22 chunks, chunk 12 no-op). `awardBadge`, `GeneralSettings.gamificationEnabled`, `readGamificationEnabled()`, `Garage.coverPreset` etc. all verified on `main`.
- **Phase 2 outline:** locked PROPOSAL-grade. §C1–C14 corrections are authoritative; inline chunk text is stale where they conflict.
- **Dispatch readiness:** 19 chunks (2A.23–2A.28, 2B.29–2B.35, 2C.36–2C.41) plus optional **chunk 0** polish fold-in (see below). 2 open questions (animation policy, SSR XPTooltip) are non-blocking for plan-writing — defaults stated below; user can override before chunk 0 / chunk 41 starts.
- **Branch policy:** every chunk PR opens `feat/jdma-garage-phase2-NN` from a fresh `main`. Never branch from `production` (per `CLAUDE.md` preflight).

## Cross-chunk canon (load-bearing — applies to every chunk plan)

All chunk plans MUST conform to these decisions. Where outline / inline chunk text drifts, canon wins.

1. **`gamification.enabled` envelope** — response top-level `body.gamification: { enabled: boolean }`. NEVER nested under `garage`. Schemas, route handlers, mobile viewmodels, SSR all read `data.gamification.enabled`.
2. **`progress` / `stats` optionality + hide-on-empty** — both zod `.optional()`. Owner: present iff killswitch on. Public: omitted iff killswitch off OR all four metrics zero (`xp === 0 && events === 0 && posts === 0 && likesReceived === 0`). UI wrappers return `null` when either field missing or (public AND all-zero).
3. **Service signatures** — `getGarageStats(client, garageId)` and `getGarageProgress(client, garageId)`. Prisma first, garageId second. `client: PrismaClient | Prisma.TransactionClient` so tx composition works. Chunk 28 passes `prisma` as first arg in both call sites.
4. **`awardXp` signature — POSITIONAL 4-arg** — `awardXp(tx, garageId, reason, opts)`. Chunk 27 conforms to this; 2B consumers do NOT switch to an options-bag. `opts = { sourceRef: string (required, non-null), delta?: number (admin_adjustment only), rarity?: BadgeRarity (badge_award only) }`. Returns `{ awarded: boolean; reason?: 'duplicate' | 'gamification_disabled' }`.
5. **`awardXp` error contract** — Killswitch off → `{ awarded: false, reason: 'gamification_disabled' }` (no DB touch). P2002 → catch silently, return `{ awarded: false, reason: 'duplicate' }`. Any other error → RETHROW (parent tx rolls back). Callers in 2B chunks (29/30/31/32/33/34/35) MUST NOT wrap `awardXp` in try/catch inside their parent tx. Same contract for `revertLikeXp`.
6. **`Garage.likesReceived` ownership** — awarder owns it. `awardXp('post_like', ...)` increments both `xp` and `likesReceived` in one `garage.update`. `revertLikeXp` decrements both. Chunk 32 route hook MUST NOT touch `likesReceived` directly.
7. **`sourceRef` non-null at awarder boundary** — DB column stays nullable for migration compat; `awardXp` + admin route MUST provide a non-null `sourceRef` on every write. `@@unique([garageId, reason, sourceRef])` only enforces idempotency for non-null rows — acceptable because the awarder layer enforces non-null at the call boundary. Chunk 23 schema notes must call this out.
8. **`GeneralSettings` singleton id** — always `GENERAL_SETTINGS_SINGLETON_ID` (string constant from Phase 1 chunk 16, in `apps/api/src/services/garage/killswitch.ts`). NEVER numeric `id: 1`. Test helpers (`enableGamification` / `disableGamification`) must import + use the constant.
9. **Feed/event test fixtures** — mirror `apps/api/test/feed/crud.test.ts`: `Event.type`, `Event.capacity`, published `Event.status`, plus either `feedAccess: 'public'` OR a valid ticket for the actor user. Applies to chunks 31 + 32.
10. **Filtered test + lint commands** — `pnpm --filter <pkg> exec vitest run <PACKAGE-ROOT-RELATIVE>` (path relative to package root, e.g. `test/garage/xp-awarder.test.ts`). Lint: `pnpm --filter <pkg> exec eslint <PACKAGE-ROOT-RELATIVE>`. Mobile package = `@jdm/mobile` (NOT `@jdm/jdma-mobile`). Avoid `pnpm --filter X test -- ...` (the `--` often drops args and runs zero tests).
11. **XP awarder test filenames** — skeleton-canonical: `xp-event-checkin.test.ts` (29), `xp-car-create.test.ts` (30), `xp-post-create.test.ts` (31), `xp-post-like.test.ts` (32), `xp-badge-award.test.ts` (33). Replace any `awarder-*.test.ts` variants.
12. **Tooltip handler contract** — `XPScoreboard` accepts `onPressHint?: () => void` (optional). Mobile `ProfileStats` owns tooltip state + passes the opener. SSR `ProfileStatsWeb` passes `undefined` → `?` renders static non-interactive. `XPTooltip` is mobile-only; SSR has no overlay (open-Q default). Composition tests cover the static-SSR variant.
13. **UI package dependency + harness** — any new dep (e.g. `expo-linear-gradient`) lands in `packages/ui/package.json` AND `pnpm-lock.yaml` — both in "Files touched". UI test harness reuses mobile RN/SVG/`lucide-react-native` mocks; pattern from `packages/ui/src/__tests__/BadgeRow.test.tsx`.
14. **DSR coverage (chunk 28)** — Phase 2 outline §"LGPD posture" + invariant #7 require: DSR **export** adds `Garage.xp`, `Garage.likesReceived`, and the user's `XpEvent` rows. DSR **anonymize** resets both counters and `prisma.xpEvent.deleteMany({ where: { garage: { userId } } })` inside the existing anonymize tx. Chunk 28 owns the export + anonymize extensions and tests. Chunk 23 schema notes call out FK cascade so XpEvent rows follow garage deletion.

## Dependency graph

```
Wave A — schema + services + payload + DSR (no UI)
  23 (schema) → 24 (zod) ┬─→ 25 (stats svc) ┐
                          └─→ 26 (progress svc) ┴─→ 27 (awarder svc) → 28 (route payloads + DSR)

Wave B — awarder hooks (parallel after 28 lands; 35 depends on 27 + admin scaffolding)
  28 ──→ 29 (event check-in)  ┐
        ──→ 30 (car create)    │
        ──→ 31 (post create)   │ all parallel
        ──→ 32 (post like/unlike, NEEDS C4 verify)
        ──→ 33 (badge award)
        ──→ 34 (premium activation)
        ──→ 35 (admin XP adjustment route)

Wave C — UI (28 ships the payload; 36/37/38 are pure leaf components, 39+ compose)
  28 → 36 (XPScoreboard) ┐
        37 (StatsRow)     ├─→ 39 (ProfileStats wrapper) → 40 (mobile owner) ─┐
        38 (XPTooltip)   ┘                              → 41 (admin SSR)    ─┘

Optional fold-in (independent of XP work; can land anywhere ≥ Phase 2A)
  Chunk 0 (Phase 1 polish — sweep)
```

| Wave   | Chunks                          | Parallel width        |
| ------ | ------------------------------- | --------------------- |
| 2A     | 23 → 24 → 25/26 → 27 → 28       | 2 mid-wave (25 ‖ 26)  |
| 2B     | 29, 30, 31, 32, 33, 34, 35      | up to 7 ‖ after 28    |
| 2C     | 36, 37, 38 ‖; then 39 → 40 ‖ 41 | 3 ‖, then 2 ‖         |
| Polish | 0                               | independent, any time |

Total: 19 (XP) + 1 optional (polish fold-in) = up to 20 chunks.

## Open questions blocking kickoff

These do NOT block step-2 plan writing — defaults below are sufficient for chunk authors to proceed. They DO need user confirmation before merge of the affected chunk.

1. **Animation policy on XP changes** (affects chunk 36). Outline §559 #1. Default for v1: **hard-set on read**. Tween + glow animations deferred to Phase 2D. Chunk 36 plan-author proceeds with hard-set; calls out animation as a §"Deviations / deferrals" line.
2. **XPTooltip on SSR `/g/:slug`** (affects chunk 41). Outline §559 #3. Default for v1: **static `?` button, no overlay** on SSR (mobile-only tooltip). Rationale: SSR page is for non-app visitors; tooltip details live behind the install funnel. Chunk 41 plan-author proceeds with static; defers client-island variant to Phase 2D.

No other open questions found. §559 #2 (likes reconcile) is resolved by §C6.

## Carry-over fold-ins (from Phase 1 closeout)

Per `.handoffs/orchestrator-state.md` §"Deferred work carried into Phase 2 or polish chunk":

1. **Chunk-17 decorative drift:** no category-tabs filter in BadgesSheet, no legendary corner-dot on HexBadge (mobile + web twins). Reviewers across chunks 19/20/21 marked non-blocking.
2. **§C10 in-context return path for buy spot:** sheet ships in chunk-10 but `/cart` deep-link return path is unfixed.
3. **Chunk 19 minor:** `useFocusEffect` on killswitch re-enable without garageId change. Edge case.
4. **Chunk 20 minor:** shared `isPending` serializes rapid admin grants (acceptable UX).
5. **Chunk 20 minor:** focus trap absent on premium-bypass confirm dialog (matches existing pattern).
6. **Chunk 21 minor:** BadgeRow overflow chip dashed-border double-spec (cosmetic dead Tailwind decl).

**Recommendation:** fold all six into **Chunk 0 — Phase 1 polish sweep** dispatched first (independent of Phase 2 XP work, low blast radius, all non-blocking). Run it parallel with 2A.23 to keep wall-clock tight; merges in any order. If user prefers to ship Phase 2 first and polish later, drop chunk 0 and migrate items 1, 4, 5, 6 to a separate polish PR after Phase 2D — that's also valid; the items are cosmetic.

---

## Chunks

### Chunk 0 (optional) — Phase 1 polish fold-in

- **Goal:** Address 6 non-blocking carry-overs from Phase 1 in a single PR so they don't bit-rot.
- **Files touched:**
  - `packages/ui/src/HexBadge.tsx` + web twin (legendary corner-dot)
  - `apps/mobile/src/screens/garage/BadgesSheet.tsx` + web twin (category-tabs filter)
  - `apps/mobile/src/screens/garage/BuySpotSheet.tsx` or `useBuySpotFlow.ts` (return path)
  - `apps/mobile/src/screens/garage/index.tsx` (`useFocusEffect` killswitch re-enable)
  - `apps/admin/src/components/garage-badges-panel.tsx` (`isPending` per-row, focus trap on confirm)
  - `packages/ui/src/web/BadgeRow.tsx` (remove dashed dead Tailwind)
- **Reads from:** none (carry-over).
- **Parallel-with:** any 2A chunk (independent surface area).
- **Acceptance criteria:**
  - HexBadge renders the legendary corner-dot per §canon, mobile + web pixel-equivalent.
  - BadgesSheet exposes a category filter; selecting a category narrows the grid.
  - BuySpot post-purchase return lands the user back on `/garage` with the highlighted stall, not on `/cart`.
  - Admin grant panel: per-row `isPending`, focus trap on the premium-bypass confirm dialog.
  - BadgeRow overflow chip: single source of truth for border styles (inline OR Tailwind, not both).
- **Test scope:**
  - `HexBadge.test.tsx`: "renders legendary corner-dot when rarity === 'legendary'"
  - `BadgesSheet.test.tsx`: "filters grid by selected category", "shows all when filter cleared"
  - `useBuySpotFlow.test.ts`: "after purchase, returns to /garage?highlight=<slot>"
  - Admin panel: "second rapid grant click does not disable the first row"
- **Corrections that apply:** none (Phase 1 fold-in, not Phase 2).
- **Deviation candidates:** none — this is pure Phase 1 reconciliation.
- **Step-2 brief seed:** Open six small, independent UI/UX fix-ups left over from Phase 1 (see `.handoffs/orchestrator-state.md` §"Deferred work"). Each item has a single-file fix; group them so reviewer sees one PR. Confirm each item with a unit test (RNTL for mobile, RTL for web) and a screenshot diff against Row 5 of the design canon HTML. Pixel parity is the bar; no functional behavior changes.

---

### Chunk 23 — `Garage.xp` + `Garage.likesReceived` columns + `XpEvent` + `XpReason`

- **Goal:** Land the additive Prisma migration (two `Garage` columns + new `XpEvent` table + `XpReason` enum). No backfill.
- **Files touched:**
  - `packages/db/prisma/schema.prisma`
  - `packages/db/prisma/migrations/<ts>_garage_xp/migration.sql`
- **Reads from:** none.
- **Parallel-with:** chunk 0.
- **Acceptance criteria:**
  - `Garage` gains `xp Int @default(0)` and `likesReceived Int @default(0)` (NOT NULL).
  - `XpReason` enum has 7 values (per outline §332).
  - `XpEvent` has the 6 columns + `@@unique([garageId, reason, sourceRef])` (per §C1) + `@@index([garageId, createdAt])`.
  - `XpEvent.garageId` FK has `onDelete: Cascade` so XpEvent rows follow garage deletion (DSR anonymize relies on this; canon §14).
  - Schema notes (header comment or migration README block) MUST state: `sourceRef` is nullable at the DB layer for migration compat, but the awarder layer (chunk 27) + admin route (chunk 35) MUST always write non-null `sourceRef`. The `@@unique` only enforces idempotency on non-null rows; the call-boundary invariant is what makes this safe (canon §7).
  - Migration runs forward + reverse cleanly on a fresh DB.
- **Test scope:**
  - `xp-schema.test.ts` (testcontainers Postgres): "Garage.xp defaults to 0 on insert", "Garage.likesReceived defaults to 0 on insert", "duplicate (garageId, reason, sourceRef) raises P2002 when sourceRef non-null", "deleting Garage cascades XpEvent rows" (DSR invariant — canon §14).
- **Corrections that apply:** §C1 (the `@@unique`), §C8 (signed delta admin awarder).
- **Deviation candidates:**
  - Inline outline §357 says "DB-level not enforced as `@@unique`" — STALE. §C1 supersedes with the unique constraint.
  - Inline outline §362 "Admin manual adjustment uses positive delta + a separate admin-driven negative-delta call" — STALE. §C8 supersedes (signed delta).
- **Step-2 brief seed:** Write the Prisma migration that adds `Garage.xp` + `Garage.likesReceived` + `XpEvent` + `XpReason` per outline §321 with §C1's DB-enforced uniqueness on `(garageId, reason, sourceRef)`. Single additive migration, no backfill (§C6). FK `onDelete: Cascade` on `XpEvent.garageId` (DSR — canon §14). Schema header documents the non-null `sourceRef` call-boundary invariant (canon §7). Migration test = testcontainers Postgres asserting defaults + unique violation + cascade. See outline §C1, §C8, §321 and canon §7, §14.

---

### Chunk 24 — Shared zod (`garageProgressSchema` + `garageStatsSchema`)

- **Goal:** Add `packages/shared/src/garage-progress.ts` with both schemas + subpath export. Extend owner + public response shapes with optional fields.
- **Files touched:**
  - `packages/shared/src/garage-progress.ts` (new)
  - `packages/shared/package.json` (add `./garage-progress` subpath per §C12)
  - `packages/shared/src/garage.ts` (extend `garageReadSchema` per §C10)
  - `packages/shared/src/garage-public.ts` (extend `garagePublicResponseSchema` per §C10)
- **Reads from:** chunk 23 (XpReason enum names not used in client schemas, but `garage_progress` reads `Garage.xp`).
- **Parallel-with:** none (gates 25/26/27/28).
- **Acceptance criteria:**
  - `garageProgressSchema` has `xp`, `rank`, `nextRank` (nullable), `xpInTier`, `xpToNextRank`, `tierSpan` (per outline §382).
  - `garageStatsSchema` has `events`, `posts`, `likesReceived`, `joinedAt` (ISO string; required field — canon §2 / cross-chunk matrix row "memberSince").
  - Owner + public response shapes carry `progress` + `stats` as `.optional()` per §C10.
  - `gamification: { enabled: boolean }` lives at the response TOP LEVEL (`body.gamification.enabled`), NOT nested under `garage` (canon §1). Both owner + public envelopes carry it.
  - Public response also carries `badges` at the response top level per §C10 (mirror of `progress` / `stats` placement).
  - Subpath export shape exactly per §C12: `{ "types": "./dist/garage-progress.d.ts", "import": "./dist/garage-progress.js" }`.
  - `@jdm/shared` rebuilt to publish `dist/garage-progress.js` (CLAUDE.md memory rule).
- **Test scope:**
  - `garage-progress.schema.test.ts`: "accepts canonical progress shape", "rejects negative xpInTier", "accepts `nextRank: null` at top tier", "accepts response with both progress/stats absent (killswitch off)", "envelope-level `gamification.enabled` parses (rejects nested-under-garage)".
- **Corrections that apply:** §C10, §C12.
- **Deviation candidates:**
  - Inline outline §381 schema shape stays correct.
  - Outline §28 "GarageStats include `joinedAt`" — confirm field name resolves to existing `Garage.createdAt` at serializer time (stats svc decides; schema just carries the ISO string).
- **Step-2 brief seed:** Add shared zod for the new `progress` + `stats` payload blocks. Both are optional on owner + public response per §C10 (killswitch off / hide-on-empty). `gamification` + public `badges` live at response top level (canon §1). Wire the `./garage-progress` subpath export per §C12 — same pattern as `./badges-copy` — with `dist/`-pointing keys. Rebuild `@jdm/shared` after edits (CLAUDE.md memory rule). See outline §C10, §C12, §380–402 and canon §1, §2.

---

### Chunk 25 — `getGarageStats` service

- **Goal:** Service that returns the 4-tile stats payload. Reads `Garage.likesReceived` directly (§C4); counts events + posts via Prisma; reads `Garage.createdAt` for `joinedAt`.
- **Files touched:**
  - `apps/api/src/services/garage/stats.ts` (new)
  - `apps/api/test/garage/stats.test.ts` (new)
- **Reads from:** chunk 23, chunk 24.
- **Parallel-with:** chunk 26 (independent service).
- **Acceptance criteria:**
  - Signature: `getGarageStats(client: PrismaClient | Prisma.TransactionClient, garageId: string): Promise<GarageStats>` (canon §3 — prisma first, garageId second; accepts both clients so tx composition works in chunk 28).
  - Returns the 4 fields (`events`, `posts`, `likesReceived`, `joinedAt`).
  - `events` = `client.checkin.count({ where: { garageId } })`. `posts` = `client.feedPost.count({ where: { authorUserId: garage.userId, status: 'visible' } })` — also exclude `'removed'` status (verify enum values against `apps/api/src/routes/feed.ts`).
  - `likesReceived` reads `Garage.likesReceived` column directly — NEVER aggregates `FeedReaction` (§C4).
  - 3 reads run in parallel via `Promise.all`.
- **Test scope:**
  - `stats.test.ts` (testcontainers): "zero-default for a fresh garage", "events count matches inserted checkins", "events count excludes another user's `used` ticket on same event" (covers `garageId` filter regression), "posts count excludes `removed` + hidden statuses", "likesReceived comes from column, not aggregate".
- **Corrections that apply:** §C4.
- **Deviation candidates:**
  - Outline §259 "3 reads in parallel" stays correct (events + posts + joinedAt; likesReceived is a single field already on the row passed in).
  - Outline mentions "FeedPost.likeCount" elsewhere — §C4 explicitly negates this; do NOT use such a field.
- **Step-2 brief seed:** Implement `getGarageStats(client, garageId)` reading `Garage.likesReceived` directly (denormalized counter, §C4) and counting events + visible posts. Signature per canon §3 — prisma-first, both client types accepted. Test in testcontainers Postgres; assert no `FeedReaction.aggregate` calls in implementation; cover `'removed'` status + foreign-user `used` ticket cases. See outline §259, §395, §C4 and canon §3.

---

### Chunk 26 — `getGarageProgress` service + `RANK_TIERS`

- **Goal:** Server-authoritative rank derivation. `RANK_TIERS` constant + `deriveProgress(xp)` function. Server-only (not exported via shared).
- **Files touched:**
  - `apps/api/src/services/garage/progress.ts` (new)
  - `apps/api/test/garage/progress.test.ts` (new)
- **Reads from:** chunk 23, chunk 24.
- **Parallel-with:** chunk 25.
- **Acceptance criteria:**
  - `RANK_TIERS` matches outline §467 (5 tiers, top tier `next: null, nextAt: null`).
  - Pure helper: `deriveProgress(xp: number)` returns `{ xp, rank, nextRank, xpInTier, xpToNextRank, tierSpan }`.
  - DB-reading wrapper: `getGarageProgress(client: PrismaClient | Prisma.TransactionClient, garageId: string)` reads `Garage.xp` then returns `deriveProgress(xp)` (canon §3 — prisma first, both client types accepted).
  - Top-tier sentinel: `xpToNextRank = 0`, `tierSpan = 1` (§C14).
  - Boundary cases per outline §492 all green.
- **Test scope:**
  - `progress.test.ts`: 6 boundary cases from outline §492 (xp = 0 / 99 / 100 / 4999 / 5000 / 50000) plus "tierSpan never zero", "nextRank null only at top tier", "getGarageProgress(client, garageId) reads Garage.xp" (testcontainers).
- **Corrections that apply:** §C14.
- **Deviation candidates:**
  - Inline outline §476 derivation reads `t.nextAt!` — §C14 requires checking `t.next === null` first to avoid the non-null assertion on the top-tier row.
- **Step-2 brief seed:** Implement pure `deriveProgress(xp)` over the server-only `RANK_TIERS` constant per outline §467, plus the DB-reading wrapper `getGarageProgress(client, garageId)` (canon §3 — prisma-first, both client types accepted). Pre-check `t.next === null` before reading `nextAt` (§C14). Sentinel: `tierSpan = 1` at top tier. Test the 6 boundary cases from outline §492 + the wrapper. See outline §C14, §463–498 and canon §3.

---

### Chunk 27 — `XPAwarder` service (`awardXp` + `revertLikeXp`)

- **Goal:** Single-file awarder with the 8-rule table, killswitch short-circuit, idempotency via DB unique catch-and-skip (§C1).
- **Files touched:**
  - `apps/api/src/services/garage/xp-awarder.ts` (new)
  - `apps/api/test/garage/xp-awarder.test.ts` (new)
  - `apps/api/test/garage/xp-revert-on-unlike.test.ts` (new)
- **Reads from:** chunks 23, 24, 26. Also imports `readGamificationEnabled` from `apps/api/src/services/garage/killswitch.ts` (verified on `main`).
- **Parallel-with:** none in 2A (28 depends on it).
- **Acceptance criteria:**
  - Signature: `awardXp(tx, garageId, reason, opts)` — POSITIONAL 4-arg per canon §4. Chunk 27 conforms to consumers (29–35), not the other way around. `opts = { sourceRef: string (required, non-null), delta?: number (admin_adjustment only), rarity?: BadgeRarity (badge_award only) }`. Returns `{ awarded: boolean; reason?: 'duplicate' | 'gamification_disabled' }`.
  - Writes one `XpEvent` row + `Garage.xp { increment }` in same tx.
  - `awardXp('post_like', ...)` ALSO increments `Garage.likesReceived` in the SAME `garage.update` statement (canon §6 — awarder owns the counter). `revertLikeXp` decrements both in one statement.
  - Error contract per canon §5:
    - Killswitch off → `{ awarded: false, reason: 'gamification_disabled' }`, no DB touch.
    - P2002 caught silently → `{ awarded: false, reason: 'duplicate' }`, no DB rollback.
    - Any other error → RETHROW so parent tx rolls back. Awarder does NOT swallow unknown errors.
  - `revertLikeXp(tx, postId, reactionId, authorGarageId)` per §C2 exact signature (takes `reactionId`, NOT `likerUserId`). Same canon §5 error contract.
  - Killswitch read happens at entry per call — no TTL cache (§C5). Sync `SELECT gamificationEnabled FROM "GeneralSettings" LIMIT 1` using `GENERAL_SETTINGS_SINGLETON_ID` (canon §8).
  - `admin_adjustment` accepts signed delta (§C8).
  - `sourceRef` is required non-null in `AwardXpOpts` TypeScript type (canon §7); call boundary rejects undefined.
- **Test scope:**
  - `xp-awarder.test.ts`: "8 rules table — each emits the expected delta", "idempotent: second call with same triple returns `{ awarded: false, reason: 'duplicate' }`", "killswitch off returns `{ awarded: false, reason: 'gamification_disabled' }` with no DB write", "non-P2002 prisma error rethrows (parent tx rolls back)", "signed delta only for admin_adjustment", "post_like awarder increments both xp and likesReceived in same garage.update", "admin_adjustment with negative delta findMany result asserted as unordered set (no orderBy drift)".
  - `xp-revert-on-unlike.test.ts`: "hard-deletes the matching XpEvent row", "decrements Garage.xp + Garage.likesReceived in same tx", "no-op when no matching row found (replay safe — e.g. killswitch was off at like time so no row was ever written)", "non-P2002 errors rethrow".
- **Corrections that apply:** §C1, §C2, §C3, §C5, §C8.
- **Deviation candidates:**
  - Inline outline §458 "Cached for 30 seconds" — STALE per §C5 (sync read).
  - Inline outline §362 "two-call for negative" — STALE per §C8 (signed delta).
  - Inline outline §444 idempotency key for `post_like` uses `likerUserId` — STALE per §C3 (use opaque reaction id).
  - Skeleton-previous "Awarder NEVER throws" — REVISED per canon §5: only expected outcomes (killswitch / P2002) return a result object; unexpected errors rethrow. Callers in 2B chunks do NOT wrap `awardXp` in try/catch.
- **Step-2 brief seed:** Implement the XP awarder service per outline §437–460 with §C1 (DB-enforced uniqueness; catch P2002), §C2 (revertLikeXp signature + no-prior-row safe), §C3 (sourceRef = `post:<postId>:reaction:<reactionId>`, NOT likerUserId), §C5 (sync killswitch read), §C8 (signed delta for admin_adjustment only). Signature is POSITIONAL 4-arg per canon §4. Awarder owns `likesReceived` for `post_like` per canon §6. Error contract per canon §5 (rethrow unexpected). `sourceRef` non-null required at call boundary (canon §7). Tests in testcontainers Postgres; cover the 8 rules + revert + killswitch + idempotency + rethrow path + `likesReceived` increment.

---

### Chunk 28 — Wire `progress` + `stats` into route payloads + 404 byte parity + DSR

- **Goal:** `GET /me/garage` and `GET /g/:slug` carry `progress`, `stats`, top-level `gamification: { enabled }` (with §C10 optional semantics). Extend DSR export + anonymize to cover XP (canon §14). Add the byte-identical 404 regression test (§C9).
- **Files touched:**
  - `apps/api/src/routes/garage.ts`
  - `apps/api/src/services/garage/index.ts` (extend serializers; `serializeGarageOwner` + `serializeGaragePublic`)
  - `apps/api/src/services/users/dsr-export.ts` (existing — add `Garage.xp`, `Garage.likesReceived`, and `xpEvent` rows for the user)
  - `apps/api/src/services/users/anonymize.ts` (existing — reset `xp = 0`, `likesReceived = 0`, `prisma.xpEvent.deleteMany({ where: { garage: { userId } } })` inside the existing anonymize tx)
  - `apps/api/test/garage/garage-route.test.ts` (extend or new file)
  - `apps/api/test/garage/garage-public-404-parity.test.ts` (new, §C9)
  - `apps/api/test/users/dsr-xp.test.ts` (new — export + anonymize coverage, canon §14)
- **Reads from:** chunks 25, 26, 27 (services exist + return shapes match shared schemas).
- **Parallel-with:** none in 2A (final wave gate; also gates all of 2B).
- **Acceptance criteria:**
  - Route handlers call `getGarageProgress(prisma, garage.id)` and `getGarageStats(prisma, garage.id)` (canon §3 — prisma passed as first arg).
  - Owner payload always includes `progress` + `stats` when `gamificationEnabled === true`; omits both when killswitch off.
  - Public payload includes `progress` + `stats` only when `gamificationEnabled === true` AND the hide-on-empty rule is false (`xp > 0 || events > 0 || posts > 0 || likesReceived > 0`).
  - `gamification: { enabled }` capability flag lives at response TOP LEVEL (`body.gamification.enabled`), NOT nested under `garage` (canon §1). Always present on both payloads.
  - `GET /g/<unknown-slug>` and `GET /g/<private-slug>` produce byte-identical 404 (§C9).
  - DSR export includes `garage.xp`, `garage.likesReceived`, and an `xpEvents` array for the requesting user (canon §14).
  - DSR anonymize resets `garage.xp = 0` + `garage.likesReceived = 0` and deletes all `XpEvent` rows for the user, inside the existing anonymize tx (canon §14).
- **Test scope:**
  - Route tests (rename or include the route string in `describe`, e.g. `"GET /me/garage — owner: ..."` so `-t` filters land on the right block):
    - "owner: returns progress + stats", "owner: killswitch off omits both, keeps `body.gamification.enabled === false`", "public: all-zero metrics omits both", "public: xp > 0 reveals both", "public: events > 0 reveals both", "public: posts > 0 reveals both", "public: likesReceived > 0 reveals both" (all four hide-on-empty metrics covered), "envelope-level `body.gamification.enabled` present on owner + public payloads".
  - §C9's exact assertion (status, body, headers) — byte-identical 404 between unknown-slug + private-slug.
  - `dsr-xp.test.ts` (canon §14): "export payload contains garage.xp + garage.likesReceived + xpEvents", "anonymize resets garage.xp + garage.likesReceived to 0", "anonymize hard-deletes all XpEvent rows for the user", "anonymize wraps all 3 mutations in the existing anonymize tx (rollback on failure leaves XP intact)".
- **Corrections that apply:** §C9, §C10, plus canon §1 (envelope), §3 (service signatures), §14 (DSR).
- **Deviation candidates:**
  - Outline §28 hide-on-empty rule still uses `progress` + `stats`; this chunk implements it at the serializer level.
- **Step-2 brief seed:** Extend `GET /me/garage` + `GET /g/:slug` payloads to carry `progress` + `stats` + top-level `gamification: { enabled }` per outline §374 with optional semantics from §C10 (omit on killswitch off, public hide-on-empty per §28). Call `getGarageProgress(prisma, id)` + `getGarageStats(prisma, id)` per canon §3. Add the byte-identical 404 regression test from §C9. Extend DSR export + anonymize for XP per canon §14 (export adds xp/likesReceived/xpEvents; anonymize resets counters + deletes XpEvent rows). Route describes name the verb+path so `-t` filters work. See outline §C9, §C10, §28, §504 and canon §1, §3, §14.

---

### Chunk 29 — Hook awarder into event check-in (+10)

- **Goal:** `Checkin.create` success in the existing check-in tx fires `awardXp(tx, garageId, 'event_checkin', { sourceRef: 'event:<eventId>' })`.
- **Files touched:**
  - `apps/api/src/services/tickets/check-in.ts` (existing — `awardBadge` already called here per Phase 1 chunk 18)
  - `apps/api/test/garage/xp-event-checkin.test.ts` (new)
- **Reads from:** chunk 27.
- **Parallel-with:** 30, 31, 32, 33, 34, 35.
- **Acceptance criteria:**
  - Successful check-in writes `+10 XpEvent` + `Garage.xp += 10` in the SAME tx as the checkin row.
  - Failed check-in rolls back the XP write.
  - Duplicate check-in attempt (idempotent) does not double-award.
- **Test scope:** "successful check-in awards +10", "rolled-back checkin leaves xp unchanged", "second check-in into same event is idempotent (no second +10)".
- **Corrections that apply:** §C1 (idempotency via DB unique), §C5 (killswitch sync read inside awardXp).
- **Deviation candidates:** none.
- **Step-2 brief seed:** Splice `awardXp(tx, garageId, 'event_checkin', { sourceRef: 'event:<eventId>' })` directly into the existing checkin tx alongside the Phase 1 `awardBadge` call — POSITIONAL 4-arg per canon §4. Do NOT wrap in try/catch (canon §5 — awarder swallows expected outcomes; let unexpected errors propagate so the parent checkin tx rolls back atomically). Idempotency triple is `(garageId, 'event_checkin', 'event:<eventId>')`. Test rollback by driving `checkInTicket` (not by calling `awardXp` directly in a manual tx) so the test actually proves the splice is inside the check-in tx. Replay safety: second check-in for same event returns `{ awarded: false, reason: 'duplicate' }`. Test file = `apps/api/test/garage/xp-event-checkin.test.ts` (canon §11). Verify with `pnpm --filter @jdm/api exec vitest run test/garage/xp-event-checkin.test.ts` (canon §10). See outline §274, §C1 and canon §4, §5, §10, §11.

---

### Chunk 30 — Hook awarder into car create (+5)

- **Goal:** `POST /me/cars` success fires `awardXp(tx, garageId, 'car_create', { sourceRef: 'car:<carId>' })` in same tx.
- **Files touched:**
  - `apps/api/src/routes/cars.ts` (existing — `awardBadge` already called)
  - `apps/api/test/garage/xp-car-create.test.ts` (new)
- **Reads from:** chunk 27.
- **Parallel-with:** 29, 31, 32, 33, 34, 35.
- **Acceptance criteria:** car create writes `+5 XpEvent` + `Garage.xp += 5` in same tx; second create awards +5 again (unique sourceRef per carId).
- **Test scope:** "car create awards +5", "second car create awards another +5 (different carId)", "tx rollback on FK failure leaves xp unchanged".
- **Corrections that apply:** §C1.
- **Deviation candidates:** none.
- **Step-2 brief seed:** Add `awardXp(tx, garageId, 'car_create', { sourceRef: 'car:<carId>' })` to the cars POST handler immediately after `awardBadge` — POSITIONAL 4-arg per canon §4. Same-tx splice; do NOT wrap in try/catch (canon §5 — let unexpected errors propagate so the cars-create tx rolls back). Rollback test must throw AFTER `awardXp` writes (e.g. force a post-award error inside the tx) — duplicate-nickname rollback proves nothing because it fails before `awardXp` runs. Killswitch fixture uses `GENERAL_SETTINGS_SINGLETON_ID` (canon §8). Test file = `apps/api/test/garage/xp-car-create.test.ts` (canon §11). Verify with `pnpm --filter @jdm/api exec vitest run test/garage/xp-car-create.test.ts` (canon §10). Corrections-that-apply lists §C1 + §C5 (killswitch behavior is exercised by the killswitch-off test). See outline §275, §C1 and canon §4, §5, §8, §10, §11.

---

### Chunk 31 — Hook awarder into feed-post create (+2)

- **Goal:** `FeedPost.create` success fires `awardXp(tx, garageId, 'post_create', { sourceRef: 'post:<postId>' })`.
- **Files touched:**
  - `apps/api/src/routes/feed.ts` (existing — `awardBadge` already called at line 332)
  - `apps/api/test/garage/xp-post-create.test.ts` (new)
- **Reads from:** chunk 27.
- **Parallel-with:** 29, 30, 32, 33, 34, 35.
- **Acceptance criteria:** feed post create writes `+2 XpEvent` + `Garage.xp += 2` in same tx.
- **Test scope:** "post create awards +2", "deleted post does not refund (no auto-revert path)", "killswitch off skips entirely".
- **Corrections that apply:** §C1.
- **Deviation candidates:** none.
- **Step-2 brief seed:** Add `awardXp(tx, garageId, 'post_create', { sourceRef: 'post:<postId>' })` adjacent to the Phase 1 `awardBadge` at `apps/api/src/routes/feed.ts:332` — POSITIONAL 4-arg per canon §4. Same-tx splice; do NOT wrap in try/catch (canon §5). Tests MUST seed a fully-valid event (`type`, `capacity`, published `status`, plus `feedAccess: 'public'` or a valid ticket for the actor) per canon §9 — mirror `apps/api/test/feed/crud.test.ts`. Killswitch fixture uses `GENERAL_SETTINGS_SINGLETON_ID` (canon §8). Assertion on `Garage.xp` MUST isolate the `post_create` delta — if a `COM-001`-style first-post badge is seeded, pre-grant the badge OR assert only the `post_create` `XpEvent` row (so chunk 33's `badge_award` XP doesn't make this test flaky cross-merge). Test file = `apps/api/test/garage/xp-post-create.test.ts` (canon §11). Verify with `pnpm --filter @jdm/api exec vitest run test/garage/xp-post-create.test.ts` (canon §10). Rollback claim only stands if the test drives the actual feed-POST route (not a manual tx around `awardXp`). See outline §276, §C1 and canon §4, §5, §8, §9, §10, §11.

---

### Chunk 32 — Hook awarder into feed-post like/unlike (VERIFY-FIRST)

- **Goal:** Reaction transitions wire to `awardXp` + `revertLikeXp` per §C4's transition table. Increment/decrement `Garage.likesReceived` in same tx.
- **Files touched:**
  - `apps/api/src/routes/feed.ts` (the reaction route — verify its file location is here, not under `apps/api/src/services/feed/reactions.ts`)
  - `apps/api/test/garage/xp-post-like-transitions.test.ts` (new)
- **Reads from:** chunk 27.
- **Parallel-with:** 29, 30, 31, 33, 34, 35.
- **PRE-IMPLEMENTATION VERIFY (§C4):**
  1. Read `apps/api/src/routes/feed.ts` (and any `feed-reactions.*` files) to confirm reaction model = `FeedReaction` (already verified by skeleton author — see schema.prisma:1201).
  2. Determine whether transitions (like → dislike) happen as **same-row update** (mutating `FeedReaction.kind`) or **delete-then-insert pair**. The wiring differs:
     - Same-row update → wrap pre/post diff inside the tx and call awarder/revert based on the transition matrix.
     - Delete+insert → wire awarder to the insert path and revert to the delete path; transitions naturally decompose.
  3. **Confirm with a test** before writing the awarder calls — the chunk's first test asserts the existing route behavior for "like → dislike", THEN add the awarder wiring on top.
- **Acceptance criteria:** all 6 transitions from §C4's matrix produce the right XP + likesReceived deltas. No transition leaves counters in an inconsistent state.
- **Test scope:** 6 specs, one per transition row in §C4 table. Plus: "killswitch off short-circuits", "self-like does not award" (verify product decision; outline silent — default: no award if `likerUserId === post.authorUserId`).
- **Corrections that apply:** §C2 (revert signature + no-prior-row safety), §C3 (sourceRef uses opaque reaction id), §C4 (transition matrix + verify-first).
- **Deviation candidates:**
  - Inline outline §278 sourceRef `'post:<postId>:like:<likerUserId>'` — STALE per §C3 (use `:reaction:<reactionId>`).
  - Inline outline §103 lists transitions but the implementer MUST verify and codify against actual code, not the docs.
- **Step-2 brief seed:** **VERIFY-THEN-CODE.** First read `apps/api/src/routes/feed.ts` reaction route + write a test asserting the existing transition behavior (same-row update vs delete+insert). Then wire awarder per §C4's transition table: 6 distinct cases. POSITIONAL 4-arg call: `awardXp(tx, authorGarageId, 'post_like', { sourceRef: 'post:<postId>:reaction:<FeedReaction.id>' })` per canon §4. SourceRef format per §C3: `post:<postId>:reaction:<FeedReaction.id>`. Revert path uses §C2's exact `revertLikeXp` signature. **Awarder owns `Garage.likesReceived`** (canon §6) — the route hook MUST NOT touch the counter; `awardXp('post_like')` and `revertLikeXp` both update both counters in their own `garage.update`. Do NOT wrap `awardXp` in try/catch inside the parent reaction tx (canon §5) — let unexpected errors roll the tx back. AVOID expected unique violations inside the interactive Postgres tx: pre-check before `FeedReaction.create` (or rely on the awarder's P2002 path only on the XpEvent table, NOT on the reaction-row create — Postgres marks the tx as aborted on any constraint failure inside the tx). Killswitch fixture uses `GENERAL_SETTINGS_SINGLETON_ID` (canon §8). Event/feed fixture must be valid per canon §9 — mirror `apps/api/test/feed/crud.test.ts`. Mock route-level failures via the awarder module (`vi.mock('.../xp-awarder')`) rather than spying on `prisma.garage.update` — spies on the outer client don't intercept `tx.garage.update`. Decide self-like policy and document in §"Deviations". Test file = `apps/api/test/garage/xp-post-like.test.ts` (canon §11). Verify with `pnpm --filter @jdm/api exec vitest run test/garage/xp-post-like.test.ts` and `pnpm --filter @jdm/api exec eslint src/routes/feed.ts test/garage/xp-post-like.test.ts` (canon §10). See outline §C2, §C3, §C4, §278 and canon §4, §5, §6, §8, §9, §10, §11.

---

### Chunk 33 — Hook awarder into Conquistas badge award (+25/+50/+100)

- **Goal:** Phase 1 `awardBadge` success fires `awardXp` with rarity-tiered delta.
- **Files touched:**
  - `apps/api/src/services/garage/awarder.ts` (Phase 1 file — extend `awardBadge` success path to call `awardXp`)
  - `apps/api/test/garage/xp-badge-award.test.ts` (new)
- **Reads from:** chunk 27.
- **Parallel-with:** 29, 30, 31, 32, 34, 35.
- **Acceptance criteria:**
  - Common badge → +25 XP. Rare → +50. Legendary → +100.
  - Idempotency triple uses badge code: `(garageId, 'badge_award', 'badge:<code>')` so re-award attempts no-op.
  - Killswitch off short-circuits at the upstream `awardBadge` level (Phase 1 already gates this); awarder also no-ops independently.
- **Test scope:** "common badge awards +25", "rare → +50", "legendary → +100", "second grant of same badge does not double-award XP", "killswitch off awards no XP".
- **Corrections that apply:** §C1, §C5.
- **Deviation candidates:**
  - Inline outline §C11 — Phase 1 chunk references now point at correct Phase 1 chunk numbers (18 for awarder, not 2B.11).
  - Note: rarity → delta mapping lives inside the XP awarder (xp-awarder.ts), NOT `awardBadge`. Pass the rarity through or have the XP awarder re-read it from the badge row.
- **Step-2 brief seed:** Extend the Phase 1 `awardBadge` (in `apps/api/src/services/garage/awarder.ts`) to call `awardXp(tx, garageId, 'badge_award', { sourceRef: 'badge:<code>', rarity })` directly after `recordAudit` and the GarageBadge insert succeed — POSITIONAL 4-arg per canon §4. Do NOT add a try/catch around `awardXp` inside `awardBadge` (canon §5 + §C1 explicitly say the awarder layer handles expected outcomes and rethrows unexpected; wrapping here would defeat parent-tx atomicity). The XP awarder switches on `opts.rarity` → delta (Common +25 / Rare +50 / Legendary +100). Idempotent per §C1 — `(garageId, 'badge_award', 'badge:<code>')` triple. Test file = `apps/api/test/garage/xp-badge-award.test.ts` (canon §11). See outline §280, §C11 (Phase 1 awarder is chunk 18) and canon §4, §5.

---

### Chunk 34 — Hook awarder into premium activation (+200 one-shot)

- **Goal:** Premium grant write path (existing Stripe webhook handler or admin grant route) fires `awardXp(tx, garageId, 'premium_activation', { sourceRef: 'garage:<garageId>' })`.
- **Files touched:**
  - `apps/api/src/routes/stripe-webhook.ts` (existing — verify location of premium grant logic)
  - `apps/api/test/garage/xp-premium-activation.test.ts` (new)
- **Reads from:** chunk 27.
- **Parallel-with:** 29, 30, 31, 32, 33, 35.
- **Acceptance criteria:**
  - First premium activation awards +200.
  - Premium lapse + re-activation does NOT award a second +200 (idempotency triple is `(garageId, 'premium_activation', 'garage:<garageId>')` — one-shot ever).
  - AbacatePay webhook path (one-time Pix → premium) treated identically.
- **Test scope:** "first activation +200", "lapse + re-activate → no second +200", "concurrent activation events idempotent (DB unique catches P2002)".
- **Corrections that apply:** §C1.
- **Deviation candidates:** none.
- **Step-2 brief seed:** Locate the premium-grant write path (likely `stripe-webhook.ts` + `abacatepay-webhook.ts` — verify before editing). Splice `awardXp(tx, garageId, 'premium_activation', { sourceRef: 'garage:<garageId>' })` — POSITIONAL 4-arg per canon §4. Do NOT wrap in try/catch (canon §5). One-shot ever per §552 + §C1. Test lapse + re-activate boundary AND a concurrent-double-grant case (two near-simultaneous webhooks → only one `XpEvent` row, `Garage.xp === 200`, second call returns `{ awarded: false, reason: 'duplicate' }`). If scope claims awarder-throw rollback coverage, add a concrete test that mocks the awarder to throw and asserts the premium grant rolls back; otherwise drop that claim from Scope. See outline §281, §552 and canon §4, §5.

---

### Chunk 35 — Admin XP adjustment route + audit

- **Goal:** `POST /admin/users/:id/garage/xp-adjustment` with signed delta + `AdminAudit` row.
- **Files touched:**
  - `packages/shared/src/admin-garage-xp.ts` (new — §C7 body schema)
  - `apps/api/src/routes/admin/garage-xp-adjustment.ts` (new)
  - `apps/api/src/routes/admin/index.ts` (register the new route — §C13)
  - `apps/api/test/garage/admin-xp-adjustment.test.ts` (new)
- **Reads from:** chunk 27.
- **Parallel-with:** 29, 30, 31, 32, 33, 34.
- **Acceptance criteria:**
  - Admin-only Bearer token gated (per §C7).
  - Body: `{ delta: -10000..10000 int, reason: 3..120 chars }`.
  - Rate limit 30/min/admin in its OWN bucket — NOT shared with `adminUserMutationRoutes` (canon for §C7).
  - Writes one `XpEvent` with server-generated `sourceRef: admin:<adminId>:<uuid>` (§C7) and one `AdminAudit { action: 'xp.adjustment', metadata: { delta, reason } }` INSIDE the same `prisma.$transaction` as the `awardXp` call — audit failure rolls back the XP write so an unaudited admin adjustment can never persist (revised from skeleton-previous; reviewer BLOCK).
  - Returns `{ xp: number }` (new total).
  - `409 gamification_disabled` when killswitch off.
- **Test scope:** "admin only — 401 for non-admin", "rejects delta=0", "rejects out-of-range delta", "writes XpEvent + AdminAudit", "negative delta decrements xp", "killswitch off → 409", "rate-limit enforced".
- **Corrections that apply:** §C7, §C8, §C13.
- **Deviation candidates:**
  - Outline §126 acknowledged the DELTA.md §12.7 deviation — restate in PR body §"Deviations".
  - Outline §362 stale "two-call for negative" — §C8 fully supersedes.
- **Step-2 brief seed:** Implement the new admin route per §C7 (schema, headers, rate, returns) with §C8's signed delta semantics. POSITIONAL 4-arg call: `awardXp(tx, garageId, 'admin_adjustment', { sourceRef, delta })` per canon §4. SourceRef server-generated as `admin:<adminId>:<uuid>` (non-null per canon §7) for §C1 uniqueness across repeat support adjustments. Register the new route in `apps/api/src/routes/admin/index.ts` in its OWN admin-only register block — NOT inside the existing `adminUserMutationRoutes` 30/min limiter, because §C7 specifies a separate 30/min/admin bucket for this route (do not share the user-mutation bucket). Verify the registration path with `grep -n 'admin.register' apps/api/src/`. **AdminAudit row must be written inside the same `prisma.$transaction` as `awardXp`** (revised from skeleton-previous "separately, not in tx") — audit failure should roll back the XP write so we never persist an unaudited admin adjustment. Pass `tx` to `recordAudit`. Add the admin UI files (admin garage API client + server action) to "Files touched" if Task 6 references an XP admin fetcher. Client validation parses delta with `Number(...)` + `Number.isInteger(...)` (NOT `Number.parseInt`, which silently truncates `1.5`). Body schema: `{ delta: -10000..10000 int, reason: 3..120 chars }`. Returns `{ xp: number }`. 409 on killswitch off. Rate limit 30/min/admin in its own bucket. Tests: admin-only 401, reject delta=0, reject out-of-range, reject non-integer (`1.5`), writes XpEvent + AdminAudit, negative delta decrements xp, killswitch off → 409, rate-limit enforced, audit-write-failure rolls back the XP write (canon §5 + revised same-tx audit). See outline §C1, §C7, §C8, §C13, §282 and canon §4, §5, §7.

---

### Chunk 36 — `XPScoreboard` component (`@jdm/ui`)

- **Goal:** Card with brand-tinted gradient + racing-stripe corner + Anton 46px XP number + rank pill + `?` button + progress bar + caption row.
- **Files touched:**
  - `packages/ui/src/XPScoreboard.tsx` (new)
  - `packages/ui/src/index.ts` (export)
  - `packages/ui/src/__tests__/XPScoreboard.test.tsx` (new)
  - `packages/ui/package.json` (add `expo-linear-gradient` dep — canon §13)
  - `pnpm-lock.yaml` (lockfile update — canon §13)
- **Reads from:** chunk 28 (consumes `progress` shape).
- **Parallel-with:** 37, 38.
- **Acceptance criteria:**
  - Renders progress fraction `xpInTier / tierSpan`.
  - Top tier (`nextRank === null`) shows "Topo do ranking" caption + full bar (no `N → Next`).
  - `?` button accepts an **optional** `onPressHint?: () => void` prop (canon §12). When the handler is provided → renders as a tap target. When undefined → renders as a static non-interactive element (SSR variant). No internal tooltip state ever.
  - Visual canon: 135° gradient, 4×64px corner stripe, Anton 46px (`textShadowColor: rgba(225,6,0,0.18)`, `textShadowRadius: 24`), rank pill right-aligned, 8px tall progress bar with brand-deep → brand gradient, 10 mono ticker hatches (every 5th tall).
  - **Animation:** hard-set (no tween) per open-question default.
- **Test scope:** "renders XP number + rank pill", "top tier hides next-rank caption", "tierSpan=1 sentinel does not divide-by-zero", "tap on `?` calls `onPressHint` when provided", "static variant: `?` has no press handler when `onPressHint` undefined".
- **Corrections that apply:** §C14 (tierSpan sentinel), canon §12 (tooltip handler), canon §13 (UI dep).
- **Deviation candidates:**
  - Outline §299 calls for an animation — defer to Phase 2D per open Q #1. Document in §"Deferred".
- **Step-2 brief seed:** Build `XPScoreboard` as a pure-prop RN component in `@jdm/ui`. Consumes the `GarageProgress` shape from chunk 24. Visual canon per outline §299 + design `.handoffs/xp-handoff/.../progress.jsx`. Top-tier sentinel from §C14 (tierSpan=1 → bar at 100%). No animation in v1 — note as Phase 2D deferral. `onPressHint?: () => void` optional prop per canon §12 — undefined renders static, defined renders tappable. Add `expo-linear-gradient` to `packages/ui/package.json` AND update `pnpm-lock.yaml` (canon §13). UI test harness reuses mobile RN/SVG/`lucide-react-native` mocks from `packages/ui/src/__tests__/BadgeRow.test.tsx`. Verify with `pnpm --filter @jdm/ui exec vitest run src/__tests__/XPScoreboard.test.tsx` (canon §10 — package-root-relative path; mobile package is `@jdm/mobile` NOT `@jdm/jdma-mobile`, but this is a `@jdm/ui` test). See outline §299, §C14, §559 #1 and canon §10, §12, §13.

---

### Chunk 37 — `StatsRow` component (`@jdm/ui`)

- **Goal:** 4-column grid of tiles (Eventos · Posts · Curtidas · Desde).
- **Files touched:**
  - `packages/ui/src/StatsRow.tsx` (new)
  - `packages/ui/src/index.ts` (export)
  - `packages/ui/src/__tests__/StatsRow.test.tsx` (new)
- **Reads from:** chunk 28 (consumes `garage.stats` shape).
- **Parallel-with:** 36, 38.
- **Acceptance criteria:**
  - 4 tiles, 12px radius, icon + big mono number + uppercase mono label per tile.
  - "Desde" tile uses sans 13px and an abbreviated PT-BR date (e.g. `'fev. 26'`).
  - Zero-default rendering (never shows "undefined").
- **Test scope:** "renders 4 tiles in order", "joinedAt formats to PT-BR abbreviated month", "zero values render as '0'".
- **Corrections that apply:** none directly (consumes §C4 likesReceived from stats).
- **Deviation candidates:** none.
- **Step-2 brief seed:** Pure-prop 4-tile `StatsRow` per outline §300. "Desde" uses sans 13px (deviation from mono in the other 3 tiles). PT-BR abbreviated month via `Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' })` — confirm output matches the design canon's `'fev. 26'` style. UI test harness MUST reuse the existing `packages/ui/src/__tests__/BadgeRow.test.tsx` RN/SVG/lucide mocks (canon §13) — bare `@jdm/ui` import otherwise drags in `ActivityIndicator`, `Image`, `Modal`, `ScrollView`, `react-native-svg` and fails before reaching `StatsRow`. Verify with `pnpm --filter @jdm/ui exec vitest run src/__tests__/StatsRow.test.tsx` (canon §10 — package-root-relative; mobile package = `@jdm/mobile`). See outline §300, §395 and canon §10, §13.

---

### Chunk 38 — `XPTooltip` component (`@jdm/ui`)

- **Goal:** Centered overlay card (NOT a bottom sheet) listing the 8 XP rules + footer note.
- **Files touched:**
  - `packages/ui/src/XPTooltip.tsx` (new)
  - `packages/ui/src/index.ts` (export)
  - `packages/ui/src/__tests__/XPTooltip.test.tsx` (new)
  - `packages/ui/package.json` (any blur dep, e.g. `expo-blur` — canon §13)
  - `pnpm-lock.yaml` (lockfile update — canon §13)
- **Reads from:** none (static content; pulls XP rules from a local constant or a tiny shared copy module — decide and document).
- **Parallel-with:** 36, 37.
- **Acceptance criteria:**
  - Backdrop + blur, centered card. NOT a `SheetShell` variant. Blur stays in scope per Phase 2 §2C.38 (do NOT drop the blur — no §C correction has waived it).
  - 8 rows: icon + action + `+N XP` per rule (matches the awarder rules table — keep the source of truth in one place to avoid drift).
  - Footer dashed-note: "XP não expira e não pode ser comprado. Premium dá um bônus único de +200 XP no momento da ativação."
  - Backdrop tap dismisses (calls `onDismiss` / `onRequestClose` prop — name aligned with `Modal`'s `onRequestClose` so chunk 39's composition tests dispatch the right handler).
- **Test scope:** "renders 8 rules", "backdrop tap dismisses (via testID press)", "`onRequestClose` fires on backdrop tap", "footer copy matches PT-BR canon", "esc/back dismiss on Android".
- **Corrections that apply:** none from §C; canon §12 (mobile-only overlay), canon §13 (UI dep + harness).
- **Deviation candidates:**
  - Outline §301 emphasis "NOT a bottom sheet" — preserve verbatim in the plan.
- **Step-2 brief seed:** Build `XPTooltip` as a centered overlay per outline §301 (NOT a bottom sheet — that's the canonical UI deviation from Phase 1's sheet pattern). KEEP the backdrop blur (Phase 2 §2C.38 — no waiver exists). Render 8 rules from a local copy module; keep the rule list in lockstep with the awarder rules table (single source of truth — chunk plan author decides where it lives). Footer note copy is locked PT-BR. Backdrop dismiss handler named `onRequestClose` to match React Native `Modal` (so chunk 39 composition tests can press `${testID}-backdrop` reliably). Add any new UI dep (e.g. blur lib) to `packages/ui/package.json` AND `pnpm-lock.yaml` (canon §13). UI test harness mirrors mobile setup including `lucide-react-native` stub for imported icons; copy from `BadgeRow.test.tsx` (canon §13). If staged-test sequencing is used (failing-before-implementing), add a temporary `XPTooltip` export stub so static imports don't crash the partial-pass stage. SSR variant: per canon §12, `XPTooltip` is mobile-only — SSR has no overlay; chunk 41 does not import this component. Verify with `pnpm --filter @jdm/ui exec vitest run src/__tests__/XPTooltip.test.tsx` (canon §10). See outline §301, §437 and canon §10, §12, §13.

---

### Chunk 39 — `ProfileStats` composite wrapper (`@jdm/ui`)

- **Goal:** Wrap `<XPScoreboard />` + `<StatsRow />` + `<XPTooltip />` with shared open-state. Owns the hide-on-empty rule for public view + the killswitch gate.
- **Files touched:**
  - `packages/ui/src/ProfileStats.tsx` (new)
  - `packages/ui/src/index.ts` (export)
  - `packages/ui/src/__tests__/ProfileStats.test.tsx` (new)
- **Reads from:** chunks 36, 37, 38.
- **Parallel-with:** none (gates 40 + 41).
- **Acceptance criteria:**
  - Reads top-level `gamification.enabled` from props (canon §1) — NOT `garage.gamification`.
  - Returns `null` when `gamification.enabled === false`.
  - **Returns `null` when `progress` is missing (undefined)** — canon §2 missing-payload contract.
  - **Returns `null` when `stats` is missing (undefined)** — same contract.
  - Public view returns `null` when `progress.xp === 0 && stats.events === 0 && stats.posts === 0 && stats.likesReceived === 0` (hide-on-empty rule). Owner view ignores this rule.
  - `GarageStats` field is `joinedAt` (string), NOT `memberSince` (cross-chunk matrix — align with chunk 24 contract).
  - Owner view always renders when killswitch on AND both payloads present.
  - **Mobile mode** (`mode === 'owner'` or `'public'` on mobile): owns tooltip open/close state, passes `onPressHint` to `XPScoreboard` to toggle the local `XPTooltip` overlay. Tooltip dismiss handler wired to `XPTooltip.onRequestClose` (canon §12; matches chunk 38 prop name).
  - **SSR/web mode** (consumed by `ProfileStatsWeb` in chunk 41): wrapper passes `onPressHint={undefined}` so the `?` renders static; no tooltip is mounted at all. Tests cover this variant explicitly.
- **Test scope:** "returns null when killswitch off", "returns null when progress missing", "returns null when stats missing", "owner with zero metrics still renders", "public with zero metrics returns null", "public with any metric > 0 renders", "mobile tooltip opens on `?` tap and closes via onRequestClose", "SSR static variant: `?` has no press handler, no `XPTooltip` rendered", "uses `joinedAt` (rejects fixtures with `memberSince`)".
- **Corrections that apply:** §C5 (killswitch capability flag), §C10 (consumes optional schemas), canon §1 (envelope), §2 (missing-payload + hide-on-empty), §12 (tooltip handler contract).
- **Deviation candidates:** none.
- **Step-2 brief seed:** Composite wrapper that owns tooltip-open state in mobile mode and applies the hide-on-empty rule for public + the killswitch gate + the missing-payload null-return for both. Mode prop (`'owner' | 'public'`) drives the hide policy. SSR variant gets `onPressHint={undefined}` per canon §12. Fixtures use `joinedAt` (canon §2 / cross-chunk row). Verify with `pnpm --filter @jdm/ui exec vitest run src/__tests__/ProfileStats.test.tsx` (canon §10). See outline §302, §C10 and canon §1, §2, §10, §12.

---

### Chunk 40 — Owner mobile integration (`apps/mobile/src/screens/garage`)

- **Goal:** Insert `<ProfileStats />` between `IdentityCard` and `BadgeRow` on the mobile garage route.
- **Files touched:**
  - `apps/mobile/app/(app)/garage/index.tsx` (host)
  - `apps/mobile/src/screens/garage/GarageListView.tsx` (insertion point — verify it lives here vs. the route file before plan-write)
  - `apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts` (new)
- **Reads from:** chunk 39.
- **Parallel-with:** 41.
- **Acceptance criteria:**
  - `<ProfileStats mode="owner" />` renders between IdentityCard (chunk 08) and BadgeRow (Phase 1 chunk 19).
  - Killswitch off → both ProfileStats and BadgeRow gone, IdentityCard sits flush to VagasSectionHeader.
  - Fresh signup (zero metrics) still shows ProfileStats (owner-side always renders).
- **Test scope:** "owner garage renders ProfileStats between IdentityCard and BadgeRow", "killswitch off hides ProfileStats", "fresh signup with xp=0 still shows scoreboard".
- **Corrections that apply:** §C11 (cross-refs to chunks 08 + 19).
- **Deviation candidates:**
  - Outline §303 "BadgeRow (Phase 2 chunk 2B.11)" — STALE per §C11 (it's Phase 1 chunk 19).
- **Step-2 brief seed:** Slot `<ProfileStats mode="owner" />` into the mobile garage screen between Phase 1's `IdentityCard` (chunk 08) and `BadgeRow` (chunk 19 — see §C11 for the corrected cross-ref). Verify the insertion point in `GarageListView.tsx` (or the route file) hasn't drifted since Phase 1 merged. **Killswitch read MUST go through `data.gamification.enabled`** (response top-level) per canon §1 — NOT `data.garage.gamification.enabled`. Apply consistently in the viewmodel, route, fixtures, and tests. `ProfileStats` gates on received props only (no new `useFocusEffect` — the route's existing `useFocusEffect` refetch refreshes the prop downstream). Hoist `Route` out of any test `mount()` helper if a focus-re-enable test needs to re-render it after remount. Verify with `pnpm --filter @jdm/mobile exec vitest run src/screens/garage/__tests__/garage-progression.viewmodel.test.ts` (canon §10 — package = `@jdm/mobile`). See outline §303, §C11 and canon §1, §10.

---

### Chunk 41 — Public SSR integration (`apps/admin/app/g/[slug]`)

- **Goal:** Insert the same `<ProfileStats mode="public" />` block on the SSR `/g/:slug` view. Static `?` button (no tooltip in v1 per open-Q default).
- **Files touched:**
  - `apps/admin/src/components/public-garage-view.tsx` (existing — Phase 1 chunk 13 file)
  - `apps/admin/app/g/[slug]/page.tsx` (consume the new payload fields)
  - `apps/admin/src/components/__tests__/public-garage-view.test.tsx` (new or extend)
- **Reads from:** chunk 39.
- **Parallel-with:** 40.
- **Acceptance criteria:**
  - Killswitch read goes through `data.gamification.enabled` (response top-level) per canon §1 — NOT `data.garage.gamification.enabled`. Apply in `page.tsx` and `PublicGarageView`.
  - Public garage with any metric > 0 renders the block.
  - Public garage with all-zero metrics omits the block. `ProfileStatsWeb` MUST handle all three cases: (a) missing `progress` OR `stats` → null, (b) `gamification.enabled === false` → null, (c) `progress.xp === 0 && stats.events === 0 && stats.posts === 0 && stats.likesReceived === 0` → null (canon §2 — full hide-on-empty rule, not just missing-field check).
  - `?` button is rendered as static (no tap handler) per outline §304 + open Q #3 default — `ProfileStatsWeb` passes `onPressHint={undefined}` to `XPScoreboard` (canon §12). No `XPTooltip` mounted on SSR.
  - Killswitch off → block hidden.
- **Test scope:** "public with metrics renders ProfileStats", "public with all-zero (server returned the fields anyway) hides client-side", "public with missing progress hides", "public with missing stats hides", "killswitch off hides", "`?` button has no click handler in SSR variant", "§C9 404 parity exercised via the API-level test (not via component-level filter — see Step-2 seed)".
- **Corrections that apply:** §C10 (optional schema → client treats missing as render-nothing), canon §1 (envelope), §2 (hide-on-empty), §12 (static `?` SSR variant).
- **Deviation candidates:**
  - Outline §301 tooltip overlay does NOT apply to SSR variant — document the static `?` deviation.
  - Outline §559 #3 default (static) locked here; can revisit in Phase 2D.
- **Step-2 brief seed:** Wire the SSR public-garage view to render `<ProfileStats mode="public" />` (or the `ProfileStatsWeb` web twin) with the new `progress` + `stats` payload. Killswitch path is `data.gamification.enabled` (top-level — canon §1). `ProfileStatsWeb` applies the full canon §2 hide-on-empty rule: null when killswitch off, when either field missing, OR when all four metrics are zero. Use the static `?` variant per open Q #3 default — pass `onPressHint={undefined}` (canon §12), no tooltip in SSR v1. Phase 1 chunk 13 owns the SSR page structure; this just slots a new section in. §C9 404 parity verification MUST exercise the API endpoint (run the existing `apps/api/test/garage/garage-public-404-parity.test.ts` from chunk 28), NOT an admin component-level filter — the byte-identical 404 invariant lives at the API layer. See outline §304, §C10, §559 #3 and canon §1, §2, §12.

---

## Phase split summary

| Sub-phase  | Chunks                     | Ships                                                                                        |
| ---------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| 0 (opt)    | 0                          | Phase 1 polish fold-ins (6 cosmetic/edge items)                                              |
| 2A         | 23, 24, 25, 26, 27, 28     | Schema + zod + stats svc + progress svc + awarder + route payloads. **No call sites wired.** |
| 2B         | 29, 30, 31, 32, 33, 34, 35 | Awarder wired into 6 write paths + admin XP adjustment route. XP starts accruing forward.    |
| 2C         | 36, 37, 38, 39, 40, 41     | UI lands on mobile owner garage + SSR public garage. Tooltip on mobile; static `?` on SSR.   |
| 2D (later) | (none in this skeleton)    | Animations, per-tier perks, leaderboard, XP decay, push on rank-up, 5th tile. Out of scope.  |

**Dispatch order recommendation:**

1. Chunk 0 (if user opts in) ‖ chunk 23. Both have no XP-domain deps.
2. After 23 merges: 24.
3. After 24 merges: 25 ‖ 26.
4. After 25 + 26 merge: 27.
5. After 27 merges: 28. After 28 merges (route payloads + DSR landed): 29 / 30 / 31 / 32 / 33 / 34 / 35 in PARALLEL.
6. After 28 + 2B chunks merge: 36 ‖ 37 ‖ 38.
7. After 36 + 37 + 38 merge: 39.
8. After 39 merges: 40 ‖ 41.

**Wall-clock optimization:** 2A is the sequential bottleneck (24 → 27 → 28). 2B is 7-wide parallel (gated on 28, not 27 — keeps the envelope + DSR contract in place before any awarder hook is spliced). 2C narrows back to 3-then-1-then-2.
