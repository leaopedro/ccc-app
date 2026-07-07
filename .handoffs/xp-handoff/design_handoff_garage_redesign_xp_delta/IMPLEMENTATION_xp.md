## 12. Progression — XP + Ranking + Stats

> A transparent score and 4 aggregate stats placed prominently on the profile. Sits alongside Conquistas; the two systems reinforce each other but are independent.

### 12.1 What

- **XP** — integer score, grows from in-app actions. Server-computed, exposed on `GarageOwner` and `GaragePublic`. Cannot be purchased; cannot decrease.
- **Rank** — derived from XP. 5 tiers. Cosmetic label. Server emits both the current rank label and the next-rank label + the threshold so the client can show "X → Y" without knowing the table.
- **? tooltip** — tappable `?` next to the "XP" label. Opens an overlay listing the XP-earning actions and their point values. Closes on outside tap.
- **Stats row** — 4 compact tiles right below the XP scoreboard: Eventos, Posts, Curtidas (recebidas), Desde (join date).

### 12.2 Rank tiers (client copy; thresholds are server-authoritative)

| Tier         | XP min | Next tier    | XP to advance |
| ------------ | ------ | ------------ | ------------- |
| Iniciante    | 0      | Pilotador    | 100           |
| Pilotador    | 100    | Veterano     | 500           |
| Veterano     | 500    | Lendário     | 2000          |
| Lendário     | 2000   | Hall of Fame | 5000          |
| Hall of Fame | 5000   | —            | —             |

Thresholds may be tuned post-launch without a client release because the wire payload carries the labels + next-threshold delta, not the table.

### 12.3 XP-earning rules (client tooltip; server is source of truth)

| +XP    | Action                                                  |
| ------ | ------------------------------------------------------- |
| `+10`  | Check-in em um evento.                                  |
| `+5`   | Adicionar um carro à garagem.                           |
| `+2`   | Publicar um post no feed.                               |
| `+1`   | Receber uma curtida em um post.                         |
| `+25`  | Desbloquear conquista comum.                            |
| `+50`  | Desbloquear conquista rara.                             |
| `+100` | Desbloquear conquista lendária.                         |
| `+200` | Tornar-se Premium (bônus único no momento da ativação). |

The tooltip lists these client-side for transparency. Server enforces the awards via the `xp-awarder` service.

### 12.4 Visual standard

- **XPScoreboard card** — `JDM.surface` background with a 135° brand-tinted gradient overlay. Top-right racing-stripe accent (4px tall, 64px wide, brand red fade).
- **Big XP number** — Anton 46px, letter-spacing -1.5, with a subtle `text-shadow` glow `0 0 24px rgba(225,6,0,0.18)`.
- **Rank pill** — brand-tinted, mono caps, sparkle glyph + rank label. Top-right of the card.
- **Progress bar** — 8px tall, brand-deep → brand gradient fill, glow shadow, mono ticker hatches at 10 evenly-spaced positions (every 5th tick is 8px tall, others are 4px).
- **Caption row** — mono 10px under the bar: current rank on the left, "`753 → Lendário`" on the right. Hall of Fame shows "Topo do ranking" instead.
- **? control** — 18×18 circle, surfaceAlt bg, border, sans 700 11px "?". Touch-tappable.
- **Stats tile** — 12px radius, 10/8 padding, vertical stack of (icon, big mono number, mono caps label). Date tile uses sans 13px instead of mono for the value.

### 12.5 Placement

Both owner and public profiles render the same `ProfileStats` block (XP scoreboard + stats row), inserted **between the IdentityCard and the BadgeRow**.

- **Owner** — always visible (hidden only on `fresh` signup state, when nothing has been earned yet).
- **Public** — always visible if any of the metrics are non-zero. Stats values + XP are public-readable aggregates of already-public data (events attended, posts authored, likes received on those posts, join date), so no allowlist concern is introduced.

### 12.6 Data model

```prisma
model Garage {
  // ...existing...
  xp        Int   @default(0)
  // rank label is computed, not stored.
}
```

Stats are computed from existing tables (no new columns):

- `events` = `count(Ticket where userId=… and checkedIn=true)` — or whichever check-in source is canonical.
- `posts` = `count(FeedPost where userId=…)`.
- `likesReceived` = `sum(FeedPost.likeCount where userId=…)`.
- `joinedAt` = `User.createdAt`.

Compute lives in `apps/api/src/services/garage/stats.ts` (NEW). The owner endpoint can call it directly; the public endpoint pulls only the allowlist subset.

### 12.7 API surface

Both `GET /me/garage` and `GET /g/:slug` payloads gain:

```ts
{
  // ...existing...
  progress: {
    xp: number;
    rank: string; // 'Veterano'
    nextRank: string | null; // 'Lendário' | null when at top tier
    xpInTier: number; // xp - currentTier.min
    xpToNextRank: number; // nextTier.min - xp (0 when at top)
    tierSpan: number; // nextTier.min - currentTier.min (1 sentinel for top)
  }
  stats: {
    events: number;
    posts: number;
    likesReceived: number;
    joinedAt: string; // ISO date
  }
}
```

No new endpoints. The data piggybacks on the existing garage GETs.

### 12.8 Shared zod schemas

```ts
// packages/shared/src/garage-progress.ts (new)
export const garageProgressSchema = z.object({
  xp: z.number().int().min(0),
  rank: z.string(),
  nextRank: z.string().nullable(),
  xpInTier: z.number().int().min(0),
  xpToNextRank: z.number().int().min(0),
  tierSpan: z.number().int().min(1),
});

export const garageStatsSchema = z.object({
  events: z.number().int().min(0),
  posts: z.number().int().min(0),
  likesReceived: z.number().int().min(0),
  joinedAt: z.string().datetime(),
});

// Extend GarageOwner and GaragePublic to include both.
```

### 12.9 XP-awarder service

Server-side service that increments `Garage.xp` and writes an audit row. Fires from the existing write paths:

| Trigger                 | Source                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Event check-in succeeds | `apps/api/src/services/checkin/*.ts`                                                                                                    |
| Car create succeeds     | `apps/api/src/routes/cars.ts` (POST handler)                                                                                            |
| Post create succeeds    | `apps/api/src/services/feed/*.ts`                                                                                                       |
| Like applied to a post  | `apps/api/src/services/feed/likes.ts` (idempotent — un-like reverts the +1)                                                             |
| Badge awarded           | `badge-awarder.ts` (calls XP-awarder per badge rarity)                                                                                  |
| Premium activated       | premium activation hook (one-shot, idempotent via `garage.xpBonuses` array if needed; v1: simple `garage.premiumBonusApplied: boolean`) |

Implementation note: keep the XP-awarder in its own service file so all rules live in one table. Each call is an `INSERT INTO XpEvent` (audit) + `UPDATE Garage SET xp = xp + N WHERE id = …`. Idempotency where it matters: liking a post that's already liked, re-awarding the same badge.

### 12.10 PR-sized chunks (continues from §11.7)

| #   | Chunk                                                                                              | Depends on | Files                                                                     |
| --- | -------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| 23  | **Schema** — `Garage.xp` column + `XpEvent` audit table + migration                                | 15         | `packages/db/prisma/schema.prisma`; new migration                         |
| 24  | **Shared schemas** — `garageProgressSchema`, `garageStatsSchema`; extend payloads                  | 23         | `packages/shared/src/garage-progress.ts` (new); payload schema extensions |
| 25  | **Stats service** — `getGarageStats(garageId): GarageStats`                                        | 23         | `apps/api/src/services/garage/stats.ts` (new)                             |
| 26  | **Progress service** — `getGarageProgress(garageId): GarageProgress` (rank derivation)             | 23         | `apps/api/src/services/garage/progress.ts` (new)                          |
| 27  | **XP-awarder** — hooks into check-in, car-create, post-create, like, badge-award, premium-activate | 25–26      | new service + call-site injections; idempotency tests                     |
| 28  | **API payload wiring** — `progress` + `stats` on `GET /me/garage` and `GET /g/:slug`               | 25–26      | `apps/api/src/routes/garage.ts`                                           |
| 29  | **UI components** — `XPScoreboard`, `StatsRow`, `XPTooltip`, `ProfileStats` in `@jdm/ui`           | 24         | `packages/ui/src/XPScoreboard.tsx` etc                                    |
| 30  | **Owner integration** — `ProfileStats` slot between IdentityCard and BadgeRow                      | 29, 19     | `apps/mobile/src/screens/garage/GarageListView.tsx`                       |
| 31  | **Public SSR integration** — same block on `/g/:slug` HTML view                                    | 29, 13     | new Next.js components                                                    |
| 32  | **XP backfill** — one-shot migration computes xp for existing users from historical events         | 27         | `packages/db/prisma/migrations/...` (Postgres function or data migration) |

Chunks 23 → 28 are the API floor. 29 → 31 are the UI. 32 is the backfill that makes the redesign feel right on day one (otherwise everyone shows 0 XP).

### 12.11 LGPD posture

- `progress.xp` and `stats.*` are aggregates over already-public-or-aggregate data. No new PII surface introduced.
- DSR export adds `garage.xp` and per-action `XpEvent` rows (the audit table) — this is the user's own activity log, so they have the right to see it.
- Anonymization: `XpEvent` rows are FK-cascaded with the user; `Garage.xp` is reset to 0 alongside the existing garage scrub. No content-bearing data lives in either.
- No new public-payload leak surface beyond the already-disclosed aggregates.

### 12.12 Friction / UX hooks

- The tooltip's "+200 XP for Premium" line is a soft upsell that doesn't compete with the PremiumSheet's main benefits list — it's a "see, you also get this" callout.
- The "Hall of Fame" tier is intentionally aspirational. At launch, almost no one will reach it. Designed so the top-tier label is rare and meaningful, not common.
- Stats deliberately stops at 4 tiles. Adding more dilutes the chamativo treatment of XP. Future stats should replace, not add.

### 12.13 Out of scope for v1

- Per-tier perks (e.g. "Veterano unlocks X"). Today, rank is purely cosmetic. Adding perks would entangle with Premium gating — leave for v2.
- A leaderboard surface. The brief mentioned "like o Ranking" as a visual cue, but a global leaderboard is a separate feature with its own LGPD review (it surfaces everyone's XP publicly, which is a different consent posture than per-profile display).
- XP loss / decay. v1 is monotonic — XP only grows. Decaying is a bigger product decision.
- Animation on level-up. Killer feature for a follow-up motion-design pass.
