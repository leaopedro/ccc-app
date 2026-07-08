# Garage Progression — XP + Ranking + Stats (Phase 2)

> **Scope:** High-level plan only. Phase 1 (UI redesign + Conquistas) ships first. This file becomes a full per-chunk TDD plan when Phase 1 lands. Use it now for architectural alignment, not as a build instruction.

**Status:** PROPOSAL — locked for Phase 2 kickoff. **DO NOT** start any of the work in this file until:

1. `2026-05-21-garage-ui-redesign-phase1.md` merged + verified in staging. Phase 1 absorbs Conquistas, so the badge tables + awarder service that Phase 2's badge-XP hook depends on already exist on `main` by then.

**Owner:** TBD by user before Phase 2 starts.

**Goal:** Add a prominent transparent score (XP) + 5 cosmetic rank tiers + tappable `?` tooltip + 4 stats tiles (Eventos · Posts · Curtidas · Desde) to both owner `/garage` and public `/g/:slug`. Insertion point: between BadgeRow (Phase 1 Conquistas) and VagasSectionHeader. Awarder fires from 6 existing write paths. **No backfill** — day-one launch shows `xp = 0` for everyone; XP accrues forward.

**Visual canon:** `.handoffs/xp-handoff/design_handoff_garage_redesign_xp_delta/jdma-garage/progress.jsx` + the updated `screens.jsx` + Row 6 of the prototype HTML (artboards Z, AA, BB, CC, DD, EE).

---

## Why this is Phase 2

1. **Depends on Phase 1 Conquistas.** "Unlock a badge" is one of the 8 XP-earning actions. Awarder needs `GarageBadge` rows + the `awardBadge` service to hook into. Both ship in Phase 1.
2. **UI insertion point depends on Phase 1.** XP scoreboard + stats sit _between_ BadgeRow (Conquistas) and VagasSectionHeader. Both edges live in Phase 1 — wait for Phase 1 merge before slotting in.
3. **No backfill.** Day-one XP = 0 for everyone. Decision locked at kickoff.

---

## Locked invariants (carries forward from `.handoffs/garage-spots-orchestration.md`)

1. **XP is server-computed.** Client never sums. Wire payload carries `xp` (number), `rank` (label), `nextRank` (label or null), and the deltas (`xpInTier`, `xpToNextRank`, `tierSpan`). Table of thresholds lives server-side only.
2. **Public payload allowlist stays strict.** Adding `progress` and `stats` to `GaragePublic` is **safe** — both are aggregates over already-public-or-aggregate data (check-ins, posts authored, likes received on those posts, join date). **Hide-on-empty rule**: public-side serializer omits the entire `progress` + `stats` block when `xp === 0 && events === 0 && posts === 0 && likesReceived === 0`. Owner-side always renders.
3. **XP cannot be purchased; cannot decrease** except via (a) like-revert (hard-deletes original XpEvent row + decrements `Garage.xp`), or (b) admin manual adjustment (`reason: 'admin_adjustment'`, audit-logged). **Premium activation is +200 XP, one-shot ever** — idempotency key `(garageId, 'premium_activation', 'garage:<garageId>')` — lapse + re-activate does NOT fire a second bonus.
4. **Like / unlike symmetry.** Like applies `+1 XP` to the post author's garage AND `+1` to `Garage.likesReceived` (denormalized). Un-like **hard-deletes** the original `+1 XpEvent` row AND decrements both counters. No `-1` audit row. The audit log loses the like/unlike cycle history — intentional simplification per kickoff decision.
5. **Rank tier is a label, not a perk gate.** v1 ships zero per-tier perks. Future "Veterano unlocks X" entangles with Premium gating — defer.
6. **`isPremiumActive` still serializer-computed.** Premium-activation bonus fires from the existing premium-grant write path, never client-side.
7. **DSR export + anonymize:** include `Garage.xp` + `Garage.likesReceived` + the user's `XpEvent` rows in export. Anonymize FK cascade does NOT fire (Garage row scrubbed, not deleted). Explicit cleanup required: `prisma.xpEvent.deleteMany({ where: { garage: { userId } } })` + reset `Garage.xp = 0` + `Garage.likesReceived = 0` inside the existing anonymization tx. See §Corrections / DSR.
8. **Gamification killswitch.** `GeneralSettings.gamificationEnabled` (introduced in Phase 1) controls XP + stats surface too. When `false`: serializer omits `progress` + `stats`; awarder short-circuits at `awardXp` entry; `Garage.xp` + `Garage.likesReceived` preserved (re-enabling restores). **Sync read every call** — no 30s cache. Killswitch flips propagate within one DB round trip.
9. **No backfill, no reconcile.** Day-one launch shows `xp = 0` AND `Garage.likesReceived = 0` for every existing user. XP + likes counters start accruing from launch forward. Decision locked at Phase 2 kickoff.

---

## Corrections applied 2026-05-21 post-review

These overrides replace inline content in the chunks below. **Engineer reads this section first** — each correction supersedes the chunk text it cites.

### C1 — `XpEvent` DB-enforced uniqueness (overrides Data model §)

Add `@@unique([garageId, reason, sourceRef])` to the `XpEvent` model. Application-layer pre-check is race-prone under concurrent awards — only a DB unique constraint prevents the double-increment. `admin_adjustment` sourceRefs include the timestamp + adminId so they remain unique across calls. If admin must repeat the exact same `(garageId, 'admin_adjustment', sourceRef)` triple, the admin API generates the sourceRef server-side (uuid suffix) to guarantee uniqueness.

```prisma
model XpEvent {
  // ...
  @@unique([garageId, reason, sourceRef])
  @@index([garageId, createdAt])
}
```

The awarder uses upsert-style pattern: `tx.xpEvent.create({ ... })` inside try/catch for `P2002`. On conflict → idempotent skip (no second increment). Removes the contradiction between line 81 ("DB unique enforces") and line 149 ("DB uniqueness not enforced").

### C2 — Like-revert conditional on prior row existing (overrides Like / unlike §)

```ts
export const revertLikeXp = async (
  tx: Prisma.TransactionClient,
  postId: string,
  reactionId: string, // opaque, NOT likerUserId
  authorGarageId: string,
): Promise<{ reverted: boolean }> => {
  const enabled = await readGamificationEnabled();
  if (!enabled) return { reverted: false };

  const sourceRef = `post:${postId}:reaction:${reactionId}`;
  const row = await tx.xpEvent.findUnique({
    where: {
      garageId_reason_sourceRef: { garageId: authorGarageId, reason: 'post_like', sourceRef },
    },
  });
  if (!row) return { reverted: false }; // no prior XP to revert; safe no-op

  await tx.xpEvent.delete({ where: { id: row.id } });
  await tx.garage.update({
    where: { id: authorGarageId },
    data: {
      xp: { decrement: row.delta },
      likesReceived: { decrement: 1 },
    },
  });
  return { reverted: true };
};
```

Conditional check prevents counters going negative when:

- Killswitch was disabled at like time, then re-enabled before unlike (no prior XpEvent).
- Like happened before Phase 2 launch (no prior XpEvent).
- Race / replay (already reverted).

### C3 — `sourceRef` redacts cross-user identifiers (overrides Data model §)

`post_like` `sourceRef` uses the opaque `FeedReaction.id` (or whatever the repo's reaction row id is), NOT `likerUserId`. Format: `post:<postId>:reaction:<reactionId>`. Owner's DSR export does NOT leak the identity of other users who liked their posts. Cross-reference: `apps/api/src/routes/feed.ts` reaction routes (verify model name via `grep -nE 'model Feed(Reaction|Like)' packages/db/prisma/schema.prisma`).

### C4 — Likes data source is `FeedReaction`, not `FeedPost.likeCount` (overrides Stats §)

`FeedPost.likeCount` does NOT exist in this repo. Likes are individual `FeedReaction` rows. The denormalized `Garage.likesReceived` is the only stats source — read it directly, never aggregate.

Like-awarder hook: when a `FeedReaction` row is inserted (`kind: 'like'` or whatever the repo uses), the awarder increments `Garage.likesReceived` on the **post author's garage** + writes the `XpEvent`. When the reaction is deleted, the revert path fires. Reaction transitions (like → dislike, dislike → like) MUST be modeled explicitly:

| Transition            | Likes XP           | LikesReceived |
| --------------------- | ------------------ | ------------- |
| no reaction → like    | +1                 | +1            |
| like → no reaction    | -1 (revert via C2) | -1            |
| no reaction → dislike | 0                  | 0             |
| dislike → no reaction | 0                  | 0             |
| like → dislike        | -1 (revert)        | -1            |
| dislike → like        | +1                 | +1            |

Verify the actual reaction model + transitions in `apps/api/src/routes/feed.ts` and codify each transition's awarder call. If the repo treats like + dislike as separate row inserts with a unique constraint, transitions happen via delete+insert pairs — wire both halves.

### C5 — Sync read killswitch (overrides chunk 2A.27 + ProfileStats)

Drop any 30s cache language. `readGamificationEnabled()` lives in `apps/api/src/services/garage/killswitch.ts` (introduced in Phase 1 chunk 16). Every awarder + serializer invocation reads the flag. Performance: a single Postgres `SELECT gamificationEnabled FROM "GeneralSettings" LIMIT 1` is < 1ms; fine. If profiling later shows hot-path impact, introduce request-scoped memoization (one read per request), NOT a TTL cache.

### C6 — Reconcile decision: NO reconcile (overrides open question + line 349)

The "one-shot likes reconcile UPDATE at launch" referenced in some sections is dropped. Day-one launch is `Garage.likesReceived = 0` everywhere; counter accrues from launch forward. Same policy as XP — no historical data is imported. Consistent + simple. If product requests a launch reconcile later, treat as a separate migration ticket.

### C7 — Admin XP adjustment endpoint: kept + documented deviation (overrides chunk 2B.35 + API surface §)

Endpoint kept per kickoff decision. API surface § updated to acknowledge the deviation from DELTA.md §12.7 "no new endpoints":

```
POST /admin/users/:id/garage/xp-adjustment
  Body:    { delta: number (-10000..10000); reason: string (3..120 chars) }
  Headers: admin Bearer token
  Returns: { xp: number }
  Rate:    30/min/admin
  Audit:   AdminAudit { actorId: adminId, action: 'xp.adjustment', metadata: { delta, reason } }
```

Body schema (`packages/shared/src/admin-garage-xp.ts`):

```ts
export const adminXpAdjustmentSchema = z.object({
  delta: z.number().int().min(-10_000).max(10_000),
  reason: z.string().trim().min(3).max(120),
});
```

`sourceRef` server-generated as `admin:<adminId>:<uuid>` so the unique constraint holds across multiple support adjustments to the same garage. Admin route registered under `apps/api/src/routes/admin/index.ts` (verify with `grep -n 'admin/index' apps/api/src/routes/`).

### C8 — Signed delta vs two-call: signed (canonical)

The "negative admin adjustment is a separate positive-delta call" sentence is wrong — delete it. `admin_adjustment` is the ONLY reason that accepts a signed delta. Awarder route:

```ts
const delta = body.delta;
if (delta === 0) return reply.status(400).send({ error: 'invalid_delta' });
await tx.xpEvent.create({
  data: {
    garageId,
    delta,
    reason: 'admin_adjustment',
    sourceRef: `admin:${adminId}:${crypto.randomUUID()}`,
  },
});
await tx.garage.update({ where: { id: garageId }, data: { xp: { increment: delta } } });
```

All other reasons store positive delta; revert paths hard-delete.

### C9 — Byte-identical 404 regression test (adds to chunk 2A.28 verification)

Adding `progress` + `stats` to `GET /g/:slug` MUST NOT introduce any byte difference between unknown-slug and private-garage responses. Add a regression test:

```ts
it('unknown slug and private slug return byte-identical 404', async () => {
  const a = await app.inject({ method: 'GET', url: '/g/unknown-slug-12345' });
  const owner = await createUser();
  await prisma.garage.update({
    where: { userId: owner.id },
    data: { slug: 'private-slug-12345', isPublic: false },
  });
  const b = await app.inject({ method: 'GET', url: '/g/private-slug-12345' });

  expect(a.statusCode).toBe(404);
  expect(b.statusCode).toBe(404);
  expect(a.body).toBe(b.body);
  expect(a.headers['content-type']).toBe(b.headers['content-type']);
});
```

### C10 — Optional/nullable schemas for omitted fields (overrides §Shared zod)

Public response schema must accept BOTH presence (progress + stats objects) AND absence (when killswitch off OR hide-on-empty). Use `.optional()`:

```ts
export const garagePublicResponseSchema = z.object({
  garage: garagePublicProfileSchema,
  cars: z.array(carPublicSchema),
  badges: z.array(garageBadgePublicSchema), // from Phase 1 Conquistas
  progress: garageProgressSchema.optional(),
  stats: garageStatsSchema.optional(),
  gamification: z.object({ enabled: z.boolean() }),
});
```

Owner response schema: `progress` + `stats` ALWAYS present when `gamification.enabled === true`. Both optional only on the `gamification.enabled === false` killswitch-off branch:

```ts
export const garageReadSchema = z.object({
  garage: garageOwnerSchema,
  // ...
  progress: garageProgressSchema.optional(),
  stats: garageStatsSchema.optional(),
  gamification: z.object({ enabled: z.boolean() }),
});
```

Mobile/admin clients treat missing as "render nothing".

### C11 — Phase 1 Conquistas chunks renumbered (overrides outdated cross-references)

Phase 2 references to "Phase 2 chunk 2B.11" etc. are stale — Conquistas chunks live in Phase 1 chunks 15-22 now. Fix references in this file:

- "BadgeRow (Phase 2 chunk 2B.11)" → "BadgeRow (Phase 1 chunk 19 — Mobile route integration)"
- "Phase 2 `awardBadge` service" → "Phase 1 `awardBadge` service (chunk 18)"
- "after Phase 2A but depends on Phase 2C `awardBadge`" → drop; Phase 1 is one merged unit, all of it ships before Phase 2 starts.
- "Phase 1 chunk 14 (welcome banner + section header) already established the order" — still correct.

### C12 — `garage-progress.ts` shared subpath export (overrides chunk 2A.24)

Same pattern as `garage-covers` + `badges` subpaths. Add to `packages/shared/package.json`:

```json
"./garage-progress": { "types": "./dist/garage-progress.d.ts", "import": "./dist/garage-progress.js" }
```

Rebuild `@ccc/shared` after edit per CLAUDE.md memory rule.

### C13 — Admin XP route registration (overrides File structure §)

`apps/api/src/routes/admin/garage-xp-adjustment.ts` must be registered in `apps/api/src/routes/admin/index.ts` (verify path via `grep -nE 'admin.register|scope.register' apps/api/src/`). Without registration the route file is dead code.

### C14 — Hall of Fame `nextAt: null` handled in derivation (overrides RANK_TIERS sentinel)

The derivation must check `t.next === null` BEFORE reading `t.nextAt!` (since the top-tier `nextAt` is `null`). Sentinel `tierSpan = 1` (avoid division by zero in UI progress bar). Test boundary cases enumerated in plan stay correct.

---

---

## Phased outline

### Phase 2A — Foundations (schema, services, payload wiring, no UI)

Goal: API ships the new payload fields, awarder service is implemented and idempotent, but no UI uses them yet.

**Chunks:**

- **2A.23** `Garage.xp Int @default(0)` column + `Garage.likesReceived Int @default(0)` denormalized counter + `XpEvent` audit table + `XpReason` enum. Additive migration. The denormalized `likesReceived` avoids a `COUNT(FeedReaction WHERE kind='like' AND post.userId=…)` aggregate on every garage read; awarder maintains it in same tx as the XP write.
- **2A.24** Shared zod: `garageProgressSchema` + `garageStatsSchema`. Extend `garageOwnerSchema` + `garagePublicProfileSchema` to include both. Both serializers respect the gamification killswitch (omit when disabled) AND the public hide-on-empty rule (omit on public when all metrics zero).
- **2A.25** `getGarageStats(garageId): GarageStats` service. Reads `Garage.likesReceived` directly (no aggregate). `events` + `posts` still computed via `prisma.<table>.count` — both are small per-user. 3 reads in parallel.
- **2A.26** `getGarageProgress(garageId): GarageProgress` service. Reads `Garage.xp` + derives rank label + next-rank label + deltas from the server-authoritative `RANK_TIERS` constant. Constant lives in `apps/api/src/services/garage/progress.ts` — server-only, not exported via shared.
- **2A.27** `XPAwarder` service. One file lists all 8 rules in one table. Public surface: `awardXp(tx, garageId, reason, opts)` + `revertLikeXp(tx, postId, likerUserId)` (like-revert path — hard-deletes the matching `XpEvent` row + decrements `Garage.xp` + decrements `Garage.likesReceived` atomically). Killswitch short-circuit at entry: if `GeneralSettings.gamificationEnabled === false`, return `{ awarded: false, reason: 'gamification_disabled' }` without touching the DB.
- **2A.28** Wire `progress` + `stats` into `GET /me/garage` and `GET /g/:slug` payload responses (route in `apps/api/src/routes/garage.ts`). Both responses gain `gamification: { enabled: boolean }` capability flag — clients early-return when disabled.

**Done when:** API ships the new fields; all existing users see `xp: 0` and `stats` derived from their real activity. Awarder service has unit tests. No call sites wired yet — awarder won't fire from any write path.

**Risk:** N+1 on `getGarageStats` if not careful. Mitigation: use `Promise.all` over 4 separate parallel queries — Postgres handles 4 fast aggregate reads fine. If the existing `loadOwnerView` already pulls cars + spots, add the stats reads to that same `Promise.all`.

### Phase 2B — Awarder hooks into write paths

Goal: real XP starts flowing as users do things. Backfill makes this real on day one.

**Chunks:**

- **2B.29** Hook awarder into event check-in success path. `+10` per check-in. `sourceRef: 'event:<eventId>'`. Inside the existing check-in transaction so the award is rolled back if the check-in fails.
- **2B.30** Hook awarder into car create success path. `+5` per car. `sourceRef: 'car:<carId>'`. Same tx pattern.
- **2B.31** Hook awarder into feed-post create. `+2` per post. `sourceRef: 'post:<postId>'`. Same tx pattern.
- **2B.32** Hook awarder into feed-post like + un-like paths.
  - **Like:** `+1` XP to the post author's garage. `+1` to `Garage.likesReceived` denormalized counter. Idempotent — `XpEvent` row written only on first like by that user. `sourceRef: 'post:<postId>:like:<likerUserId>'`.
  - **Un-like:** **hard-deletes** the matching `XpEvent` row. Decrements `Garage.xp` by 1. Decrements `Garage.likesReceived` by 1. All three in the same tx as the un-like DB op. No `-1` audit row.
- **2B.33** Hook awarder into Conquistas badge-award path. `+25` / `+50` / `+100` by rarity. Called from inside the Phase 2 `awardBadge` service — when a badge inserts successfully, the XP-awarder fires with `reason: 'badge_award'` and `sourceRef: 'badge:<code>'`. Killswitch short-circuit happens upstream in `awardBadge` itself (Phase 2 §Killswitch); awarder still no-ops independently if invoked.
- **2B.34** Hook awarder into premium activation. **One-shot ever** per garage. Idempotency key `(garageId, 'premium_activation', 'garage:<garageId>')`. Lapse + re-activate does NOT fire a second bonus.
- **2B.35** Admin XP manual adjustment. New route `POST /admin/users/:id/garage/xp-adjustment` (admin role gated). Body: `{ delta: number; reason: string }`. Writes one `XpEvent` row with `reason: 'admin_adjustment'` + `sourceRef: 'admin:<adminId>:<freeFormReason>'`. Also writes an `AdminAudit` row separately. Admin-only — never user-callable.

**Done when:** every write path fires the awarder. Manual smoke: a fresh user adds 3 cars + checks into 1 event + posts twice + earns 1 common badge ⇒ `xp = 15 + 10 + 4 + 25 = 54`, rank `Iniciante` (4 XP from Pilotador if any rounding tested).

> **No backfill.** Day-one launch is `xp = 0` for everyone. Locked at kickoff per the simplicity tradeoff.

**Risk:** awarder in the same tx as the parent write path. If awarder throws, parent operation rolls back. Mitigation:

- `awardXp` catches its own internal errors (e.g. XpEvent insert race), logs, returns silently — never bubbles to caller.
- Unique constraint on `(garageId, reason, sourceRef)` enforces idempotency at the DB layer.

### Phase 2C — UI

Goal: the new payload renders.

**Chunks:**

- **2C.36** `XPScoreboard` component in `@ccc/ui`. Card with brand-tinted 135° gradient, 4×64px corner racing stripe, Anton 46px XP number with red glow text-shadow, rank pill on the right, `?` button (18×18), progress bar (8px tall, brand-deep → brand gradient, glow shadow), mono ticker hatches (10 across, every 5th tall), caption row (current rank + "`N → Next`" or "Topo do ranking" on top tier).
- **2C.37** `StatsRow` component. 4-column grid. 12px radius tiles. Icon + big mono number + uppercase mono label per tile. "Desde" tile uses sans 13px instead of mono for the value (`'fev. 26'` style abbreviated PT-BR date).
- **2C.38** `XPTooltip` component. **Tooltip-style centered card, NOT a bottom sheet.** Backdrop + blur. Lists the 8 `XP_RULES` with icon + action + `+N XP`. Footer dashed note: "XP não expira e não pode ser comprado. Premium dá um bônus único de +200 XP no momento da ativação." Backdrop tap dismisses.
- **2C.39** `ProfileStats` composite wrapper. Owns tooltip-open state. Only renders if `progress.xp > 0 || stats.events > 0 || stats.posts > 0 || stats.likesReceived > 0` on public view (hides for newly-active public profiles with zero activity). Owner view always renders unless `fresh` signup state.
- **2C.40** Owner integration: insert `<ProfileStats />` between IdentityCard and BadgeRow in the garage route. Phase 1 chunk 14 (welcome banner + section header) already established the order; this slots in between IdentityCard (chunk 08) and BadgeRow (Phase 2 chunk 2B.11). Confirm both still live where they did when Phase 2 starts.
- **2C.41** Public SSR integration: same `<ProfileStats />` block on the admin `/g/:slug` HTML view from Phase 1 chunk 13. SSR-friendly variant — no client-side tooltip in v1 of the SSR view (defer to a small client-island component if product wants the tooltip in SSR; v1 just renders a static "?" that opens nothing).

**Done when:** the redesigned `/garage` and `/g/:slug` render the XP scoreboard + stats below the IdentityCard. Tapping `?` opens the tooltip. The rank pill shows the right label. The progress bar shows the right percentage.

**Risk:** Anton 46px font weight + text-shadow may not match the prototype's glow visually on RN. Mitigation: the design specifies `text-shadow: '0 0 24px rgba(225,6,0,0.18)'` — RN's `textShadowColor` + `textShadowRadius` + `textShadowOffset` is the equivalent. May need to tune the radius for visual parity. Document the deviation if exact match impossible.

### Phase 2D — Polish (deferred from launch)

- Animation on level-up (e.g., XP number tweens, progress bar fills, rank pill flashes when crossing a tier threshold).
- Per-tier perks (e.g., "Veterano unlocks X"). Entangles with Premium gating — separate product decision.
- Leaderboard surface ("Top 10 XP" globally). Different LGPD posture; needs a consent review before exposing everyone's XP publicly. Out of scope.
- XP decay (monthly bleed-off if inactive). Big product call; v1 is monotonic.
- Stats v2 — replace one of the 4 tiles (e.g., swap "Desde" for "Encontros este mês"). Stats deliberately stops at 4 tiles to preserve the chamativo treatment of XP. Future tiles **replace**, not add.
- Push notification on rank-up.

---

## Data model deltas (canonical — propose locked once Phase 2 kicks off)

```prisma
model Garage {
  // ...existing from Phase 1 + Phase 2...
  xp             Int @default(0)
  likesReceived  Int @default(0)  // denormalized — awarder maintains in same tx as XP write

  xpEvents XpEvent[]
}

enum XpReason {
  event_checkin
  car_create
  post_create
  post_like
  badge_award
  premium_activation
  admin_adjustment
}

model XpEvent {
  id        String   @id @default(cuid())
  garageId  String
  delta     Int                    // always positive; revert paths hard-delete rather than insert negatives
  reason    XpReason
  sourceRef String?  @db.VarChar(120)  // 'post:<id>:like:<userId>', 'event:<id>', 'badge:<code>', 'garage:<id>', 'admin:<adminId>:<note>'
  createdAt DateTime @default(now())

  garage Garage @relation(fields: [garageId], references: [id], onDelete: Cascade)

  @@index([garageId, createdAt])
  @@index([garageId, reason, sourceRef])  // idempotency lookups + revert path matching
}
```

Idempotency strategy:

- Per-source `(garageId, reason, sourceRef)` lookup before insert. If a row already exists, skip.
- DB-level not enforced as `@@unique` because `admin_adjustment` has free-form sourceRef. Idempotency lives in the awarder code for the deterministic reasons.
- **No `backfill` reason** — backfill skipped per kickoff. If reintroduced later, add the enum value + migration step.
- **Revert paths hard-delete** (like-revert is the only auto-revert in v1) — keeps `XpEvent.delta` non-negative, simplifies sum reconciliation. Admin manual adjustment uses positive delta + a separate admin-driven negative-delta call (NOT a single signed delta — keeps the awarder semantics pure-additive).

Wait: admin adjustment MUST support negative deltas (refund/dispute case). Revised: `delta` is signed for `admin_adjustment` only; all other reasons keep `delta > 0` + use hard-delete for revert. Awarder enforces this rule at write time.

Migration order: `XpReason` enum first, `Garage.xp` + `Garage.likesReceived` second (NULL not allowed — `DEFAULT 0`), `XpEvent` table third (depends on enum + Garage).

---

## API surface

No new endpoints. Payload extensions only.

| Endpoint                                         | Added fields                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `GET /me/garage`                                 | `progress: GarageProgress`, `stats: GarageStats`                 |
| `GET /g/:slug`                                   | `progress: GarageProgress`, `stats: GarageStats`                 |
| `GET /admin/users/:id/garage` (Phase 2 chunk 22) | Optionally extend with `progress` + `stats` for admin visibility |

`GarageProgress`:

```ts
{
  xp: number; // monotonic non-negative integer
  rank: string; // 'Veterano'
  nextRank: string | null; // 'Lendário' | null at top tier
  xpInTier: number; // xp - currentTier.min — non-negative
  xpToNextRank: number; // nextTier.min - xp — 0 at top tier
  tierSpan: number; // nextTier.min - currentTier.min — 1 at top tier (sentinel for division by zero)
}
```

`GarageStats`:

```ts
{
  events: number;
  posts: number;
  likesReceived: number;
  joinedAt: string; // ISO datetime; client formats to 'fev. 26'
}
```

Both shapes carry zero-defaults if nothing earned (so the client always renders something, never undefined).

---

## File structure (new, additive)

```
packages/shared/src/garage-progress.ts             (new — zod for both progress + stats)
packages/db/prisma/schema.prisma                   (extend — Garage.xp + Garage.likesReceived + XpEvent + XpReason enum)
packages/db/prisma/migrations/<ts>_garage_xp/      (single additive migration — no backfill)
apps/api/src/services/garage/progress.ts           (rank derivation + RANK_TIERS table)
apps/api/src/services/garage/stats.ts              (3-counter read; likesReceived from column)
apps/api/src/services/garage/xp-awarder.ts         (rules table + killswitch gate + revertLikeXp hard-delete)
apps/api/src/routes/admin/garage-xp-adjustment.ts  (POST /admin/users/:id/garage/xp-adjustment, admin-only)
apps/api/test/garage/xp-awarder.test.ts            (idempotency + 8 rules end-to-end + killswitch off)
apps/api/test/garage/xp-revert-on-unlike.test.ts   (hard-delete + decrements both counters in one tx)
apps/api/test/garage/progress.test.ts              (rank derivation, edge cases at threshold boundaries)
apps/api/test/garage/stats.test.ts                 (counter accuracy + denormalized likesReceived correctness)
apps/api/test/garage/admin-xp-adjustment.test.ts   (admin role gate + audit row)
apps/api/src/routes/garage.ts                      (extend payloads; hide-on-empty public rule)
packages/ui/src/XPScoreboard.tsx                   (chamativo card)
packages/ui/src/StatsRow.tsx                       (4-tile grid)
packages/ui/src/XPTooltip.tsx                      (centered overlay — NOT a bottom sheet)
packages/ui/src/ProfileStats.tsx                   (composite wrapper; reads gamification.enabled, returns null when off)
packages/ui/src/__tests__/XPScoreboard.test.tsx
packages/ui/src/__tests__/ProfileStats.test.tsx
apps/mobile/src/screens/garage/__tests__/garage-progression.viewmodel.test.ts (insertion point tests + killswitch off)
apps/admin/src/components/public-garage-view.tsx   (extend: ProfileStats slot)
apps/admin/src/components/admin-xp-adjustment-modal.tsx  (admin manual delta input)
```

---

## XP-awarder rules (canonical)

| Reason                    | Delta       | Trigger                                                                                                                | Idempotency key                                                             |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `event_checkin`           | `+10`       | `Checkin.create` in checkin tx                                                                                         | `(garageId, 'event_checkin', 'event:<eventId>')`                            |
| `car_create`              | `+5`        | `prisma.car.create` success in `POST /me/cars`                                                                         | `(garageId, 'car_create', 'car:<carId>')`                                   |
| `post_create`             | `+2`        | `FeedPost.create` success                                                                                              | `(garageId, 'post_create', 'post:<postId>')`                                |
| `post_like` (apply)       | `+1`        | First like applied — fires against the **post author's garage** + increments `Garage.likesReceived`                    | `(authorGarageId, 'post_like', 'post:<postId>:like:<likerUserId>')`         |
| `post_like` (revert)      | hard-delete | Un-like — hard-deletes the matching `XpEvent` row + `Garage.xp -= 1` + `Garage.likesReceived -= 1`. No audit row left. | (matches the prior insert key — service finds + deletes)                    |
| `badge_award` (common)    | `+25`       | Phase 2 `awardBadge` success, badge.rarity = 'common'                                                                  | `(garageId, 'badge_award', 'badge:<code>')`                                 |
| `badge_award` (rare)      | `+50`       | Phase 2 `awardBadge` success, badge.rarity = 'rare'                                                                    | same                                                                        |
| `badge_award` (legendary) | `+100`      | Phase 2 `awardBadge` success, badge.rarity = 'legendary'                                                               | same                                                                        |
| `premium_activation`      | `+200`      | Premium grant write path                                                                                               | `(garageId, 'premium_activation', 'garage:<garageId>')` — **one-shot ever** |
| `admin_adjustment`        | `±N`        | `POST /admin/users/:id/garage/xp-adjustment`                                                                           | (no idempotency — admin operations are explicit)                            |

Awarder rules:

1. Always idempotent on `(garageId, reason, sourceRef)` triple — pre-check before insert. (The triple isn't a DB unique constraint because `admin_adjustment` has free-form sourceRef; checked at the service layer.)
2. Always non-throwing relative to the caller — internal failures log + swallow. (Likes especially: a failed XP-awarder must never crash the like operation.)
3. Always writes the `XpEvent` row in the **same transaction** as the parent write so the audit can never disagree with `Garage.xp`. Service signature accepts `Prisma.TransactionClient` so callers can splice it into their tx.
4. Single `awardXp` call updates `Garage.xp` via `prisma.garage.update({ data: { xp: { increment: delta } } })` — atomic SQL, no race. Same idiom for `likesReceived`.
5. **Killswitch short-circuit at entry.** Reads `GeneralSettings.gamificationEnabled`. Cached for 30 seconds at the service layer to avoid a `SELECT` on every awarder call. When `false`, returns `{ awarded: false, reason: 'gamification_disabled' }` without touching the DB. Re-enabling restores everything because nothing was deleted.
6. `admin_adjustment` is the only path that can write a negative delta directly. Used for moderation / support cases ("we awarded by mistake, deduct X"). Manual `AdminAudit` entry written separately.

---

## Rank derivation (server-authoritative)

```ts
// apps/api/src/services/garage/progress.ts (excerpt)
const RANK_TIERS = [
  { name: 'Iniciante', min: 0, next: 'Pilotador', nextAt: 100 },
  { name: 'Pilotador', min: 100, next: 'Veterano', nextAt: 500 },
  { name: 'Veterano', min: 500, next: 'Lendário', nextAt: 2000 },
  { name: 'Lendário', min: 2000, next: 'Hall of Fame', nextAt: 5000 },
  { name: 'Hall of Fame', min: 5000, next: null, nextAt: null },
] as const;

export const deriveProgress = (xp: number) => {
  const tier = [...RANK_TIERS].reverse().find((t) => xp >= t.min)!;
  const atTop = tier.next === null;
  return {
    xp,
    rank: tier.name,
    nextRank: tier.next,
    xpInTier: xp - tier.min,
    xpToNextRank: atTop ? 0 : tier.nextAt! - xp,
    tierSpan: atTop ? 1 : tier.nextAt! - tier.min,
  };
};
```

Threshold tunability: change the table → restart the API. No client release needed because the payload carries labels + deltas, not the table itself.

Boundary cases (test in chunk 2A.26):

- `xp = 0` → Iniciante / 0 in tier / 100 to advance.
- `xp = 99` → Iniciante / 99 in tier / 1 to advance.
- `xp = 100` → Pilotador / 0 in tier / 400 to advance.
- `xp = 4999` → Lendário / 2999 in tier / 1 to advance.
- `xp = 5000` → Hall of Fame / 0 in tier / 0 to advance / tierSpan=1.
- `xp = 50000` → Hall of Fame / 45000 in tier / 0 to advance / tierSpan=1 (no negative).

---

## Killswitch — admin disables every user-facing gamification surface

The flag introduced in Phase 2 (`GeneralSettings.gamificationEnabled`) governs Phase 2 surfaces too. When `false`:

- `GET /me/garage` payload: omits `progress` + `stats` blocks. `gamification: { enabled: false }` capability flag.
- `GET /g/:slug` payload: same — omits `progress` + `stats`.
- `getGarageStats` + `getGarageProgress` short-circuit and return `null`. Route layer reads the flag once per request (cached 30s).
- `awardXp` short-circuits at entry. **Existing `Garage.xp` + `Garage.likesReceived` values preserved** — re-enabling restores everything.
- `POST /admin/users/:id/garage/xp-adjustment` returns `409 gamification_disabled`.
- Mobile renders nothing — `<ProfileStats />` reads `gamification.enabled` from the response + returns null when false.
- SSR public profile renders nothing — same gate.
- Admin panel still shows the user's `xp` value (read-only) under the Garagem tab; the manual-adjustment modal is disabled with an "Gamificação desativada" banner.

Single source of truth: one boolean flips every gamification surface across Phase 2 + Phase 2 in unison. No partial states. Audit row `gamification.toggle` written on every flip.

---

## LGPD posture (unchanged invariants apply)

- `progress.xp` and `stats.*` are aggregates over already-public-or-aggregate data. Public payload addition is safe.
- DSR export adds `garage.xp` + the user's `XpEvent` rows. User's own activity log — they have the right to see it.
- Anonymization: `XpEvent` rows are FK-cascaded with the Garage (which cascades with the User). `Garage.xp` is reset to 0 alongside the existing garage scrub. Extend `apps/api/test/garage/anonymize-garage.test.ts` to assert both.
- No new public-payload leak surface beyond the disclosed aggregates.

---

## UX-Audit / brief tie-back

The brief frames XP as the chamativo element on the profile (Anton 46px + red glow + brand-gradient bar + corner racing-stripe). Three product wins:

1. **Re-engagement loop.** XP gives an always-visible "next thing to chase" metric, complementing the discrete Conquistas earn surface.
2. **Premium soft upsell.** "+200 XP for becoming Premium" sits inside the tooltip, not as a competing CTA. Reinforces the PremiumSheet without overlap.
3. **Transparency.** The `?` tooltip is a defensive UX choice — users can verify exactly what generates XP, defusing the "is this rigged?" question that gamification systems otherwise invite.

---

## Out of scope (will not ship in Phase 2)

- Per-tier perks (Premium-style unlocks at tier boundaries).
- Global / scoped leaderboard.
- XP decay / inactivity bleed-off.
- Animation polish (level-up celebrations, number tweens, lottie).
- Push notifications on rank-up.
- A 5th stats tile (deliberately frozen at 4).
- Cross-user XP comparison surfaces ("Você vs Caio: 1247 a 982").

---

## Decisions locked at kickoff

1. **Premium re-activation bonus.** No second +200. Idempotency key `(garageId, 'premium_activation', 'garage:<garageId>')` — one-shot ever per garage.
2. **Backfill.** Skipped entirely. Day-one launch is `xp = 0` for everyone. Chunk 2B.35 (the original backfill chunk) does NOT exist; the slot is repurposed for admin manual adjustment.
3. **Like-revert audit row.** Hard-delete the original `+1 XpEvent` row + decrement both counters. No `-1` audit row. Simpler reconciliation, audit log loses the like/unlike history (intentional).
4. **Public XP zero-threshold.** Hide the entire `progress` + `stats` block on `/g/:slug` when `xp === 0 && events === 0 && posts === 0 && likesReceived === 0`. Owner view always renders.
5. **Stats refresh strategy.** Denormalize `Garage.likesReceived` (Int @default(0)) column. Like-awarder + un-like awarder maintain it in same tx as XP. No aggregate SUM on read paths.
6. **Admin manual XP adjustment.** Yes, gated to admin role. New route `POST /admin/users/:id/garage/xp-adjustment` lands as chunk 2B.35.

## Open questions still to resolve before Phase 2 kickoff

1. **Animation policy on XP changes.** When XP increases on the foreground garage screen (e.g., user just earned +5 for a car create), does the number tween? Or hard-set on next read? Default: hard-set in v1; animation pass in Phase 2D.
2. ~~Stats refresh after backfill-free launch.~~ **Resolved at kickoff:** no reconcile. `Garage.likesReceived = 0` for every existing user at launch. Historical `FeedReaction` rows are not counted. Counter accrues from launch forward. Matches the no-backfill policy.
3. **XPTooltip on SSR view.** The mobile XPTooltip is a tap-to-open overlay. SSR `/g/:slug` rendering in chunk 2C.41 — should the `?` button work, or stay static? Default: static in v1 (the SSR page is for non-app visitors; if they want details they install the app). Lock before chunk 2C.41.

---

## What to do when starting Phase 2

1. **Confirm Phase 1 fully merged + verified.** If any Phase 1 chunk is still in flight, finish that first.
2. **Confirm Phase 2A minimum.** XP-awarder hooks into badge awards (chunk 2B.33). Need at minimum Phase 2 schema + awarder service to exist on `main` before Phase 2B starts. Phase 2 UI doesn't block Phase 2 — only the awarder hook.
3. **Re-read this file** + `IMPLEMENTATION_xp.md` + the design `progress.jsx` source + Row 6 of `JDMA-590 · Garagem.html`.
4. **Convert this outline into a full TDD plan** following the `superpowers:writing-plans` skill structure. Each Phase 2 chunk becomes a section in that plan with the exact code, file paths, and test steps.
5. **Resolve the 6 open questions** above before writing the chunk plan. Some answers reshape the schema (open Q #2 + #5 specifically).
6. **Coordinate the cutover.** Phase 2C UI inserts between IdentityCard (Phase 1 chunk 08) and BadgeRow (Phase 2 chunk 2B.11). Confirm both have stayed structurally stable on `main` since Phase 1 + Phase 2 merged. If they drifted, adjust the insertion point first.

---

## Tie-back to prior phases

| Phase | Dependency                                                                 |
| ----- | -------------------------------------------------------------------------- |
| 1     | IdentityCard exists + stable insertion point above BadgeRow                |
| 1     | Theme tokens already extended (`brand.*` ramp used for gradients + glow)   |
| 1     | SSR public profile route exists (chunk 13) — Phase 2C.41 extends it        |
| 2     | `awardBadge` service exists — Phase 2B.33 hooks XP awarder into it         |
| 2     | BadgeRow component exists + stable insertion point below ProfileStats      |
| 2     | `Badge.rarity` enum exists — Phase 2 awarder reads it to pick +25/+50/+100 |

If Phase 1 or 2 lands a change that invalidates any of the above, that change blocks Phase 2 until reconciled.
