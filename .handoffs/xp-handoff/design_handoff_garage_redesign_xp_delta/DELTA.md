# Delta Handoff — XP + Ranking + Stats

This is a **delta-only bundle**. It assumes you already received the prior `design_handoff_garage_redesign` package (covering parking-stall card system, cover image, PremiumBadge V2, sheets, and Conquistas/badges). Apply this on top.

---

## What's new

A profile progression system: a **prominent XP score**, **5 rank tiers**, a **`?` tooltip** explaining how to earn points, and **4 stats tiles** (Eventos / Posts / Curtidas / Desde).

The XP score is the chamativo element on the profile — Anton 46px number with a red glow, brand-gradient progress bar with mono ticker hatches, and a 4×64px corner racing-stripe accent. Sits between the IdentityCard and the BadgeRow on both owner and public profiles.

---

## Files in this bundle

| File                       | Action  | Notes                                                                                                                                                                                                  |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jdma-garage/progress.jsx` | **NEW** | Drop into `jdma-garage/` alongside `atoms.jsx`, `badges.jsx` etc.                                                                                                                                      |
| `jdma-garage/screens.jsx`  | REPLACE | Adds `progress` + `stats` + `forceXpTooltip` props to `OwnerGarage` and `PublicGarage`; inserts `<ProfileStats>` between IdentityCard and BadgeRow.                                                    |
| `JDMA-590 · Garagem.html`  | REPLACE | Adds `<script src="jdma-garage/progress.jsx">` load + 6 new artboards (Row 6, IDs Z–EE). Existing artboards updated to pass `progress`/`stats` props for the premium-owner + public-populated screens. |
| `IMPLEMENTATION_xp.md`     | **NEW** | The §12 chunk you should append to your existing `IMPLEMENTATION.md`. Self-contained — data model, API, services, chunks 23–32, LGPD posture, out-of-scope notes.                                      |

No other prior files (`atoms.jsx`, `badges.jsx`, `design-canvas.jsx`, `ios-frame.jsx`, `tweaks-panel.jsx`) need replacement.

---

## How to apply

1. Drop `jdma-garage/progress.jsx` into your existing `jdma-garage/` directory.
2. Overwrite `jdma-garage/screens.jsx` and `JDMA-590 · Garagem.html`.
3. Append the contents of `IMPLEMENTATION_xp.md` to the bottom of your existing `IMPLEMENTATION.md` (or keep it as a sibling — it's self-contained).
4. Open `JDMA-590 · Garagem.html` and pan down to Row 6 to see the new artboards.

---

## New artboards (Row 6 — XP · Ranking · Stats)

| ID  | Label                                       | Shows                                                 |
| --- | ------------------------------------------- | ----------------------------------------------------- |
| Z   | System · 5 tiers + tabela de XP             | All 5 rank tiers with example XP + full earning table |
| AA  | Owner · XP em destaque no perfil            | Scoreboard + 4 stats tiles inline on the owner garage |
| BB  | Tooltip aberto · regras de XP               | Overlay listing all 8 XP-earning actions              |
| CC  | Public profile · XP + stats visíveis        | Same block on `/g/:slug`                              |
| DD  | Iniciante · pouco XP, longe do próximo rank | Newbie state, 32 XP, far from Pilotador               |
| EE  | Hall of Fame · topo do ranking              | Top-tier variant, "Topo do ranking" instead of arrow  |

---

## Component spec (TL;DR — see `IMPLEMENTATION_xp.md` §12.4 for details)

- **`XPScoreboard`** — full-width card. Top row: "XP" mono label + `?` button on the left, rank pill on the right. Middle: big Anton 46px XP number. Bottom: 8px progress bar with mono hatches + caption row.
- **`StatsRow`** — 4-column grid. 12px radius tiles, icon + big mono number + uppercase mono label. The "Desde" tile uses sans for the value (month + year).
- **`XPTooltip`** — modal overlay (not a bottom sheet — it's a tooltip-style centered card). Backdrop dismisses. Lists `XP_RULES` with icon + action + `+N XP` value.
- **`ProfileStats`** — composite wrapper. Manages tooltip-open state. This is the only component the host screen renders; everything else is internal.

---

## Data model (delta only)

```prisma
model Garage {
  // ...existing...
  xp Int @default(0)
}

// New audit table — one row per XP award.
model XpEvent {
  id        String   @id @default(cuid())
  garageId  String
  delta     Int                    // signed; un-like is -1
  reason    XpReason
  sourceRef String?                // postId, eventId, badgeCode, etc.
  createdAt DateTime @default(now())
  garage    Garage   @relation(fields: [garageId], references: [id], onDelete: Cascade)
  @@index([garageId, createdAt])
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
```

Stats (`events`, `posts`, `likesReceived`, `joinedAt`) are computed — no new columns needed.

---

## API delta

`GET /me/garage` and `GET /g/:slug` payloads gain:

```ts
progress: {
  xp: number;
  rank: string;
  nextRank: string | null;
  xpInTier: number;
  xpToNextRank: number;
  tierSpan: number;
}
stats: {
  events: number;
  posts: number;
  likesReceived: number;
  joinedAt: string; // ISO
}
```

No new endpoints. Thresholds stay server-side — the wire payload carries labels + delta so the table is invisible to the client.

---

## Chunks (continues from §11 chunk 22 in your IMPLEMENTATION.md)

23 schema · 24 shared zod · 25 stats service · 26 progress service · 27 XP-awarder · 28 API payload wiring · 29 UI components · 30 owner integration · 31 public SSR integration · 32 XP backfill.

Chunk 32 is important: without it, every existing user shows 0 XP on launch day. The backfill replays event check-ins + post creates + likes against the new rules to seed historical XP.

Full breakdown in `IMPLEMENTATION_xp.md` §12.10.
