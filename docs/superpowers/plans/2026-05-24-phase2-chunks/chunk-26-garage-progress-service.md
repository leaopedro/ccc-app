# Chunk 26 — `getGarageProgress` service + `RANK_TIERS` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative rank-derivation service for the Garage. `RANK_TIERS` constant + a pure `deriveProgress(xp)` function + a thin DB-read wrapper `getGarageProgress(prisma, garageId)` that loads `Garage.xp` and applies the derivation.

**Architecture:** Single new file `apps/api/src/services/garage/progress.ts`. The `RANK_TIERS` table is server-only (NOT exported via `@ccc/shared`) — clients receive the resolved `{ rank, nextRank, xpInTier, xpToNextRank, tierSpan }` from the wire payload only. Tests split into a pure-unit block over `deriveProgress` (no DB) and an integration block that exercises `getGarageProgress` against a real Postgres row.

**Tech Stack:** TypeScript, Fastify, Prisma (Postgres), Vitest. Uses the existing `@ccc/db` prisma client and the test helpers in `apps/api/test/helpers.ts`.

**Spec references (read once, do not copy):**

- `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md` §"Chunk 26" — chunk contract.
- `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`:
  - §"Corrections applied 2026-05-21 post-review" (C1–C14) — read all corrections **first**.
  - §C14 — `nextAt: null` guard + `tierSpan = 1` sentinel for Hall of Fame.
  - §"Phased outline" / chunk 2A.26 (around line 260) — locks the `RANK_TIERS` constant in `apps/api/src/services/garage/progress.ts`, **server-only**.
  - §"Rank derivation (server-authoritative)" (around line 463) — `RANK_TIERS` table, `deriveProgress` excerpt, boundary cases (line 491).
- `docs/superpowers/plans/2026-05-21-garage-ui-redesign-phase1.md` — Phase 1 service tone (small focused files, JSDoc on exported helpers, lower-camel `const` declarations, no default exports). Mirror `apps/api/src/services/garage/cover.ts` for tone.
- `CLAUDE.md` — branch safety preflight, PR-only-to-`main`, no `production` edits.

---

## Scope

**In scope:**

- New module `apps/api/src/services/garage/progress.ts` exporting:
  - `RANK_TIERS` (server-only `as const` array of 5 tier rows).
  - `GarageProgress` type (the derived shape).
  - `deriveProgress(xp: number): GarageProgress` — pure function.
  - `getGarageProgress(client, garageId): Promise<GarageProgress>` — DB wrapper.
- New tests `apps/api/test/garage/progress.test.ts` covering the 6 boundary cases plus three invariants (no-negative `xpToNextRank` at top, `tierSpan === 1` at top, `xpInTier ≥ 0` across all tiers, `nextRank === null` only at top tier) and one integration test that reads a seeded `Garage` row through `getGarageProgress`.

**Out of scope (covered by other chunks):**

- Killswitch gating of the payload (chunk 2A.28 serializer).
- Shared zod schema for `garageProgressSchema` (chunk 2A.24).
- Awarder service writes (chunk 27).
- Wiring into `GET /me/garage` and `GET /g/:slug` (chunk 2A.28).

**Corrections that apply to this chunk:** §C14 only. (C1–C13 + earlier C14 prose touch other chunks.) §C14 mandates: check `t.next === null` BEFORE reading `t.nextAt!`; emit `tierSpan = 1` (not `0`) at top tier so the UI can divide without guarding.

---

## File structure

```
apps/api/src/services/garage/progress.ts        (NEW)
apps/api/test/garage/progress.test.ts            (NEW)
```

Both files are touched-paths-only. No edits to `index.ts`, `cover.ts`, `killswitch.ts`, route files, `packages/shared`, or `packages/db`.

---

## Branch + preflight

- [ ] **Step 0.a: Branch preflight** (CLAUDE.md "Branch safety preflight")

```bash
git branch --show-current
```

If output is `production`, STOP. Otherwise:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-26
```

- [ ] **Step 0.b: Chunk 23 dependency check** (this chunk edits NO Prisma schema and depends on `Garage.xp` already existing on the working schema)

This chunk reads `Garage.xp` via `prisma.garage.findUniqueOrThrow({ ..., select: { xp: true } })` and the test seeds `prisma.garage.update({ data: { xp: ... } })`. Both fail at typecheck/runtime if chunk 23 has not landed yet.

```bash
# Confirm the migration that introduced Garage.xp is present.
ls packages/db/prisma/migrations | grep -i 'garage.*xp' || echo "MISSING: chunk 23 migration not found"

# Confirm Garage.xp is on the schema source of truth.
grep -n '^\s*xp\s\+Int' packages/db/prisma/schema.prisma || echo "MISSING: Garage.xp not in schema.prisma"

# Confirm the generated Prisma client knows about Garage.xp.
grep -n 'xp:\s*number' node_modules/.pnpm/node_modules/@prisma/client/index.d.ts 2>/dev/null | head -1 \
  || grep -rn 'xp:\s*number' packages/db/node_modules/.prisma/client/index.d.ts 2>/dev/null | head -1 \
  || echo "MISSING: generated Prisma client does not expose Garage.xp — run pnpm --filter @ccc/db prisma generate"
```

If any of the three checks prints `MISSING`, STOP and wait for chunk 23 to land before starting this chunk. Do NOT add the `Garage.xp` column from inside chunk 26.

---

## Task 1 — Pure-unit tests for `deriveProgress`

**Files:**

- Create: `apps/api/test/garage/progress.test.ts`

Tone: mirror the top-of-file style in `apps/api/test/garage/cover.test.ts` (vitest, `describe` per surface, `it` per case). This task only adds the **pure** `describe('deriveProgress', …)` block; the integration block lands in Task 4.

- [ ] **Step 1.1: Write the failing test file**

```ts
// apps/api/test/garage/progress.test.ts
import { describe, expect, it } from 'vitest';

import { deriveProgress } from '../../src/services/garage/progress.js';

describe('deriveProgress', () => {
  // Boundary cases from outline §491 (one it() per row).
  it('xp = 0 → Iniciante, 0 in tier, 100 to advance', () => {
    expect(deriveProgress(0)).toEqual({
      xp: 0,
      rank: 'Iniciante',
      nextRank: 'Pilotador',
      xpInTier: 0,
      xpToNextRank: 100,
      tierSpan: 100,
    });
  });

  it('xp = 99 → Iniciante, 99 in tier, 1 to advance', () => {
    expect(deriveProgress(99)).toEqual({
      xp: 99,
      rank: 'Iniciante',
      nextRank: 'Pilotador',
      xpInTier: 99,
      xpToNextRank: 1,
      tierSpan: 100,
    });
  });

  it('xp = 100 → Pilotador, 0 in tier, 400 to advance', () => {
    expect(deriveProgress(100)).toEqual({
      xp: 100,
      rank: 'Pilotador',
      nextRank: 'Veterano',
      xpInTier: 0,
      xpToNextRank: 400,
      tierSpan: 400,
    });
  });

  it('xp = 4999 → Lendário, 2999 in tier, 1 to advance', () => {
    expect(deriveProgress(4999)).toEqual({
      xp: 4999,
      rank: 'Lendário',
      nextRank: 'Hall of Fame',
      xpInTier: 2999,
      xpToNextRank: 1,
      tierSpan: 3000,
    });
  });

  it('xp = 5000 → Hall of Fame, 0 in tier, 0 to advance, tierSpan = 1 (§C14)', () => {
    expect(deriveProgress(5000)).toEqual({
      xp: 5000,
      rank: 'Hall of Fame',
      nextRank: null,
      xpInTier: 0,
      xpToNextRank: 0,
      tierSpan: 1,
    });
  });

  it('xp = 50000 → Hall of Fame, 45000 in tier, 0 to advance, tierSpan = 1 (no negative)', () => {
    expect(deriveProgress(50_000)).toEqual({
      xp: 50_000,
      rank: 'Hall of Fame',
      nextRank: null,
      xpInTier: 45_000,
      xpToNextRank: 0,
      tierSpan: 1,
    });
  });

  // Invariants — guard the §C14 sentinel + the UI-safety contract.
  it('nextRank is null only at the top tier', () => {
    for (const xp of [0, 99, 100, 499, 500, 1999, 2000, 4999]) {
      expect(deriveProgress(xp).nextRank).not.toBeNull();
    }
    for (const xp of [5000, 9999, 50_000]) {
      expect(deriveProgress(xp).nextRank).toBeNull();
    }
  });

  it('xpToNextRank is never negative (including arbitrarily large top-tier XP)', () => {
    for (const xp of [0, 99, 100, 4999, 5000, 50_000, 1_000_000]) {
      expect(deriveProgress(xp).xpToNextRank).toBeGreaterThanOrEqual(0);
    }
  });

  it('tierSpan is never zero (UI divides by it — §C14)', () => {
    for (const xp of [0, 99, 100, 499, 500, 1999, 2000, 4999, 5000, 50_000]) {
      expect(deriveProgress(xp).tierSpan).toBeGreaterThan(0);
    }
  });

  it('xpInTier is never negative across all tiers', () => {
    for (const xp of [0, 50, 100, 250, 500, 1000, 2000, 3500, 5000, 50_000]) {
      expect(deriveProgress(xp).xpInTier).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 1.2: Run the file to confirm it fails on the import**

```bash
pnpm --filter @ccc/api exec vitest run test/garage/progress.test.ts
```

Expected: module-not-found / import error on `../../src/services/garage/progress.js`. (Vitest under pnpm-workspace resolves the path through the source map; the failing import is the signal.)

- [ ] **Step 1.3: Commit the failing test**

```bash
git add apps/api/test/garage/progress.test.ts
git commit -m "test(api): add failing progress.deriveProgress boundary tests (chunk 26)"
```

---

## Task 2 — Implement `RANK_TIERS` + `deriveProgress`

**Files:**

- Create: `apps/api/src/services/garage/progress.ts`

Tone: mirror `apps/api/src/services/garage/cover.ts` — JSDoc on every exported symbol, `as const` arrays, `Readonly` types where helpful, no default export, no classes.

- [ ] **Step 2.1: Write the minimal module to pass the pure-unit tests**

```ts
// apps/api/src/services/garage/progress.ts
import type { Prisma, PrismaClient } from '@prisma/client';

// ── Server-authoritative rank table ─────────────────────────────────────
//
// Five cosmetic tiers. The top tier ("Hall of Fame") is open-ended:
// `next === null` and `nextAt === null`. The §C14 correction requires
// `deriveProgress` to check `next === null` BEFORE reading `nextAt!`,
// and to emit `tierSpan = 1` (not 0) at the top so the UI progress bar
// can divide without a guard.
//
// This constant is SERVER-ONLY by design (skeleton chunk 26 + outline
// §260): clients never receive the thresholds, only the resolved
// payload. Do NOT re-export through `@ccc/shared`.
export const RANK_TIERS = [
  { name: 'Iniciante', min: 0, next: 'Pilotador', nextAt: 100 },
  { name: 'Pilotador', min: 100, next: 'Veterano', nextAt: 500 },
  { name: 'Veterano', min: 500, next: 'Lendário', nextAt: 2000 },
  { name: 'Lendário', min: 2000, next: 'Hall of Fame', nextAt: 5000 },
  { name: 'Hall of Fame', min: 5000, next: null, nextAt: null },
] as const;

export type RankName = (typeof RANK_TIERS)[number]['name'];

/**
 * The derived progress shape sent on the wire to mobile + admin clients.
 * Field order matches the outline §"Rank derivation" excerpt so a future
 * `garageProgressSchema` (chunk 2A.24) can `z.object({ ... })` against
 * the same key set in the same order.
 */
export type GarageProgress = {
  xp: number;
  rank: RankName;
  nextRank: RankName | null;
  xpInTier: number;
  xpToNextRank: number;
  tierSpan: number;
};

// Either the global Prisma client or a transaction client. Callers
// already inside a `$transaction` MUST pass the tx client so the read
// participates in the surrounding snapshot. Same shape as canon §3 in
// `2026-05-24-phase2-fix-canon.md` (matches `getGarageStats` in chunk 25).
type ReadClient = PrismaClient | Prisma.TransactionClient;

/**
 * Pure rank-derivation over the `RANK_TIERS` table. No DB access.
 *
 *  - Picks the highest tier whose `min` is ≤ `xp`.
 *  - Top-tier guard (§C14): when `tier.next === null`, returns
 *    `nextRank: null`, `xpToNextRank: 0`, and the `tierSpan = 1`
 *    sentinel so the UI can divide without dividing by zero.
 *  - Non-top tiers: `xpToNextRank = tier.nextAt - xp` (always ≥ 0
 *    because the iteration above already picked the matching tier),
 *    and `tierSpan = tier.nextAt - tier.min`.
 *
 * `xp` is treated as a non-negative integer (Garage.xp is `Int @default(0)`
 * and the awarder enforces non-negative writes — see chunk 27).
 */
export const deriveProgress = (xp: number): GarageProgress => {
  // Iterate from the highest tier down so the first match is correct.
  // `RANK_TIERS` is short + immutable; an indexed loop avoids a
  // throwaway `[...RANK_TIERS].reverse()` allocation per call.
  let tier: (typeof RANK_TIERS)[number] = RANK_TIERS[0];
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (xp >= RANK_TIERS[i].min) {
      tier = RANK_TIERS[i];
      break;
    }
  }

  // §C14: top-tier guard must come BEFORE any `nextAt!` non-null read.
  const atTop = tier.next === null;
  if (atTop) {
    return {
      xp,
      rank: tier.name,
      nextRank: null,
      xpInTier: xp - tier.min,
      xpToNextRank: 0,
      tierSpan: 1,
    };
  }

  // `tier.nextAt` is non-null on non-top rows by construction.
  const nextAt = tier.nextAt as number;
  return {
    xp,
    rank: tier.name,
    nextRank: tier.next,
    xpInTier: xp - tier.min,
    xpToNextRank: nextAt - xp,
    tierSpan: nextAt - tier.min,
  };
};

/**
 * DB-backed wrapper. Reads `Garage.xp` by primary key and derives the
 * progress shape. Throws Prisma's `P2025` (RecordNotFound) when the
 * garage row does not exist — same semantics as Prisma's
 * `findUniqueOrThrow`, so the caller can rely on a non-null result.
 *
 * Killswitch gating is NOT applied here — the chunk-2A.28 serializer
 * decides whether to include the resulting block on the wire. Keeping
 * this service unconditional means an admin-side debug surface can
 * always inspect a user's progress even when the public surface is off.
 */
export const getGarageProgress = async (
  client: ReadClient,
  garageId: string,
): Promise<GarageProgress> => {
  const row = await client.garage.findUniqueOrThrow({
    where: { id: garageId },
    select: { xp: true },
  });
  return deriveProgress(row.xp);
};
```

- [ ] **Step 2.2: Run only the pure-unit tests to verify they pass**

```bash
pnpm --filter @ccc/api exec vitest run test/garage/progress.test.ts -t 'deriveProgress'
```

Expected: 10 passing tests under `deriveProgress` (6 boundary cases + 4 invariants).

- [ ] **Step 2.3: Run touched-file typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: clean. If TS complains about `tier.nextAt as number`, double-check the `as const` on `RANK_TIERS` — the literal types should narrow correctly.

- [ ] **Step 2.4: Commit the implementation**

```bash
git add apps/api/src/services/garage/progress.ts
git commit -m "feat(api): add RANK_TIERS + deriveProgress (chunk 26)"
```

---

## Task 3 — Add `getGarageProgress` integration test (real Postgres)

**Files:**

- Modify: `apps/api/test/garage/progress.test.ts`

This task adds a second `describe('getGarageProgress', …)` block that exercises the DB wrapper against a real Postgres row. Per CLAUDE.md "Integration tests for the API must hit a real Postgres". Uses the existing `resetDatabase()` + `createUser()` helpers, which create a `Garage` row automatically through the signup hook.

- [ ] **Step 3.1: Add the failing integration block**

Append to `apps/api/test/garage/progress.test.ts` (after the closing brace of the `deriveProgress` describe block):

```ts
import { prisma } from '@ccc/db';
import { afterEach, beforeEach } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';
import { getGarageProgress } from '../../src/services/garage/progress.js';

describe('getGarageProgress (real Postgres)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('reads Garage.xp and returns the derived progress shape', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    // Seed an XP value that lands inside the Pilotador tier so all the
    // non-top fields are exercised end-to-end.
    await prisma.garage.update({ where: { id: garage.id }, data: { xp: 250 } });

    const progress = await getGarageProgress(prisma, garage.id);
    expect(progress).toEqual({
      xp: 250,
      rank: 'Pilotador',
      nextRank: 'Veterano',
      xpInTier: 150,
      xpToNextRank: 250,
      tierSpan: 400,
    });
  });

  it('returns the Hall of Fame sentinel for a top-tier garage', async () => {
    const { user } = await createUser({ verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await prisma.garage.update({ where: { id: garage.id }, data: { xp: 10_000 } });

    const progress = await getGarageProgress(prisma, garage.id);
    expect(progress.rank).toBe('Hall of Fame');
    expect(progress.nextRank).toBeNull();
    expect(progress.xpToNextRank).toBe(0);
    expect(progress.tierSpan).toBe(1);
    expect(progress.xpInTier).toBe(5_000);
  });

  it('throws Prisma P2025 when the garage id does not exist', async () => {
    await expect(getGarageProgress(prisma, 'nonexistent-garage-id')).rejects.toMatchObject({
      code: 'P2025',
    });
  });
});
```

NOTE on imports: the second `import` block is appended at the bottom intentionally so the file diff is easy to read; the linter / formatter pass in Step 5 will hoist the imports to the top. If the repo's `eslint-import-order` rule rejects this on the commit hook, hoist them manually before committing.

- [ ] **Step 3.2: Run the integration block to confirm it passes**

Real Postgres must be reachable per repo standards (Testcontainers or `DATABASE_URL` to a preview DB — same setup the rest of `apps/api/test/garage/*.test.ts` already relies on).

```bash
pnpm --filter @ccc/api exec vitest run test/garage/progress.test.ts
```

Expected: 10 `deriveProgress` cases + 3 `getGarageProgress` cases = 13 passing.

If the integration block fails with "Garage row missing for user", confirm `createUser({ verified: true })` still mints a `Garage` row through the signup hook. (Check `apps/api/src/services/auth/signup.ts` / the existing `signup-garage.test.ts` for the canonical pattern.)

- [ ] **Step 3.3: Re-run touched-file typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: clean.

- [ ] **Step 3.4: Commit**

```bash
git add apps/api/test/garage/progress.test.ts
git commit -m "test(api): add getGarageProgress integration tests (chunk 26)"
```

---

## Task 4 — Hoist imports + linter pass

**Files:**

- Modify: `apps/api/test/garage/progress.test.ts`

Only needed if Task 3's appended import block tripped the import-order rule.

- [ ] **Step 4.1: Hoist all imports to the top of the test file**

Move the `import { prisma } from '@ccc/db';`, `import { afterEach, beforeEach } from 'vitest';`, `import { createUser, resetDatabase } from '../helpers.js';`, and `import { getGarageProgress } from '../../src/services/garage/progress.js';` lines to join the single top-of-file import section. Merge the `vitest` import into the existing `{ describe, expect, it }` import.

- [ ] **Step 4.2: Run lint on touched files only**

```bash
pnpm --filter @ccc/api exec eslint src/services/garage/progress.ts test/garage/progress.test.ts
```

Expected: clean. Paths are package-root-relative because `--filter @ccc/api exec` runs from `apps/api/` (canon §10).

- [ ] **Step 4.3: Commit (only if Step 4.1 changed the file)**

```bash
git add apps/api/test/garage/progress.test.ts
git commit -m "chore(api): hoist progress.test.ts imports (chunk 26)"
```

---

## Verification (final)

- [ ] **Step V.1: Targeted vitest run**

```bash
pnpm --filter @ccc/api exec vitest run test/garage/progress.test.ts
```

Expected output (counts):

- `deriveProgress` describe: **10 passing** (6 boundary + 4 invariants).
- `getGarageProgress (real Postgres)` describe: **3 passing**.
- Total: **13 passing, 0 failing, 0 skipped**.

- [ ] **Step V.2: Touched-file typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: clean.

- [ ] **Step V.3: Memory-rule check — no shared rebuild needed**

`@ccc/shared` was not touched (RANK_TIERS stays server-only per chunk skeleton + outline §260). The CLAUDE.md memory rule about rebuilding `@ccc/shared/dist` after schema changes does NOT apply here — confirm the diff against `main` shows nothing under `packages/shared/` or `packages/db/`.

```bash
git diff --name-only main...HEAD
```

Expected touched paths only:

- `apps/api/src/services/garage/progress.ts`
- `apps/api/test/garage/progress.test.ts`

(Using `git diff --name-only main...HEAD` instead of `git status` because all task commits already landed locally — `git status` would be clean and tell us nothing.)

Per CLAUDE.md memory `feedback_no_full_test_suite_locally.md`: do NOT run the full workspace test suite locally. CI on the PR will run the full sweep.

---

## Corrections (post-review 2026-05-24)

Applied from `docs/superpowers/plans/2026-05-24-phase2-plan-review.md` and `/tmp/phase2-fix-canon.md`:

- **Signature locked (canon §3):** `getGarageProgress(client: PrismaClient | Prisma.TransactionClient, garageId: string)`. The review flagged drift against chunk 28's earlier `getGarageProgress(garage.id)` call sites; canon §3 resolves the drift in this direction — chunk 28 must adopt `(prisma, garage.id)`, NOT chunk 26 collapsing to one arg. `ReadClient` is the union of `PrismaClient | Prisma.TransactionClient` (was a bespoke `Pick<typeof prisma, 'garage'> | Prisma.TransactionClient` shape).
- **Canon §10 commands:** all `pnpm --filter @ccc/api test -- apps/api/test/garage/progress.test.ts` runs are now `pnpm --filter @ccc/api exec vitest run test/garage/progress.test.ts` (package-root-relative path). Lint command is `pnpm --filter @ccc/api exec eslint src/services/garage/progress.ts test/garage/progress.test.ts`.
- **Chunk-23 dependency preflight (new Step 0.b):** stops the implementer if `Garage.xp` migration / schema / generated client are not present yet. Chunk 26 reads `Garage.xp` but edits no Prisma schema, so it cannot land before chunk 23.
- **Verification (MINOR):** Step V.3 now uses `git diff --name-only main...HEAD` instead of `git status` (commits are already in by V.3, so `git status` would be clean and uninformative).

## Deviation log

None expected. The single deviation candidate flagged in the skeleton (chunk 26 line 190 — "inline outline §476 derivation reads `t.nextAt!`") is **applied** in Task 2, not deviated. §C14 is the load-bearing correction; the implementation already routes around the non-null assertion by guarding on `tier.next === null` first.

Post-review (2026-05-24) sweep: the `ReadClient` type alias deviates from `killswitch.ts` (which uses `Pick<typeof prisma, 'garage'> | Prisma.TransactionClient`) in favor of canon §3's `PrismaClient | Prisma.TransactionClient` — accepted because canon §3 is authoritative across the route-payload wiring (chunks 25, 26, 28) and a narrow `Pick<...>` would prevent chunk 28 from passing the full `prisma` client without an extra cast.

If any further deviation arises during implementation (e.g. typecheck forces a different narrowing pattern), append a single line here in the format `- [path:line] § ref — reason`.

---

## PR checklist (branch `feat/jdma-garage-phase2-26`)

- [ ] Branch was cut from a freshly-pulled `main` (Step 0 preflight passed).
- [ ] Only two files changed: `apps/api/src/services/garage/progress.ts` (new) + `apps/api/test/garage/progress.test.ts` (new). Verify with `git diff --stat main...HEAD`.
- [ ] `RANK_TIERS` array matches outline §467 exactly (5 rows; top row has `next: null, nextAt: null`).
- [ ] `deriveProgress` checks `tier.next === null` BEFORE reading `tier.nextAt` (§C14).
- [ ] Top-tier sentinel: `xpToNextRank === 0` AND `tierSpan === 1` (§C14).
- [ ] All 6 boundary cases from outline §491 are individual `it()` blocks.
- [ ] `RANK_TIERS` is NOT exported from `packages/shared` (chunk-26 contract).
- [ ] `pnpm --filter @ccc/api typecheck` clean.
- [ ] Targeted vitest passes: 13/13 in `progress.test.ts`.
- [ ] No edits to `packages/shared`, `packages/db`, routes, or `index.ts`.
- [ ] No edits to `production` branch (CLAUDE.md branch safety).
- [ ] PR opened against `main` (not `production`).
- [ ] PR body links to: (a) skeleton §Chunk 26, (b) outline §C14, (c) outline §463–498 ("Rank derivation"). Reference paths only; do not copy the table inline.
- [ ] PR title: `feat(api): RANK_TIERS + getGarageProgress service (chunk 26)`.

---

## Self-review notes

- **Spec coverage:** every skeleton "acceptance criteria" bullet for chunk 26 maps to a task (RANK_TIERS shape → Task 2 Step 2.1; shape contract → Task 1 test cases; top-tier sentinel → Task 1 `xp = 5000` + `xp = 50000` cases; boundary cases → 6 dedicated `it()` blocks).
- **Placeholders:** none. Every code block is final source.
- **Type consistency:** `GarageProgress`, `deriveProgress`, `getGarageProgress`, `RANK_TIERS`, `RankName` are all referenced consistently across tasks. The `ReadClient` alias matches canon §3 (`PrismaClient | Prisma.TransactionClient`) so chunk 28 can pass either the global client or a tx client without a cast.
- **§C14 compliance:** the top-tier guard runs before any `nextAt` read in Task 2 Step 2.1, and Task 1's `xp = 5000` test asserts `tierSpan: 1` (not `0`).
