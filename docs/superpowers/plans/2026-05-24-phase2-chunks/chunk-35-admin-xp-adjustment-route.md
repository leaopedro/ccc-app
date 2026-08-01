# Chunk 35 — Admin XP adjustment route + audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship `POST /admin/users/:id/garage/xp-adjustment` — admin-only, 30/min/admin rate-limit, accepts signed `delta` + free-form `reason`, writes one `XpEvent` (sourceRef `admin:<adminId>:<uuid>`) + one separate `AdminAudit` row, returns `{ xp }`. Killswitch off → `409 gamification_disabled`.

**Architecture:** New shared zod subpath (`@ccc/shared/admin-garage-xp`) + new admin route registered in its own admin-only block in `apps/api/src/routes/admin/index.ts` with a dedicated 30/min/admin rate-limit bucket (§C7 — must NOT share the `adminUserMutationRoutes` bucket). Route delegates to `awardXp(tx, garageId, 'admin_adjustment', { delta, sourceRef })` per fix-canon §4 (positional 4-arg; the only awarder reason accepting signed delta — §C8). AdminAudit is recorded INSIDE the same `prisma.$transaction` as `awardXp` (passing `tx` to `recordAudit`) so XpEvent + Garage.xp + AdminAudit roll back together — no persisted unaudited admin adjustment. Admin UI modal folded here per the decision call, with admin-garage API + server-action updates included in the same chunk so the modal has a working submit path.

**Tech Stack:** Fastify 4, Prisma 5, zod 3, `@fastify/rate-limit`, vitest + Testcontainers-Postgres, Next.js App Router, React 18 + Tailwind.

---

## Branch safety preflight (CLAUDE.md)

```bash
git branch --show-current
# If `production` → STOP. Switch to main first.
git checkout main && git pull --ff-only origin main
git checkout -b feat/jdma-garage-phase2-35
```

## Dependencies on prior chunks

Assumes on `main` before execution:

- **Chunk 23** — `XpEvent` + `XpReason` + `Garage.xp` with DB unique `@@unique([garageId, reason, sourceRef])` per §C1.
- **Chunk 27** — `apps/api/src/services/garage/xp-awarder.ts` exports `awardXp(tx, garageId, reason, opts)`. `admin_adjustment` accepts signed delta (§C8). Killswitch short-circuits at entry per §C5 returning `{ awarded: false, reason: 'gamification_disabled' }`. Internal errors swallowed per outline §290 — never throws.

If either missing, STOP. Skeleton lists chunk 35 parallel-with 29–34 (all awarder consumers, all gated on chunk 27).

## Corrections that apply

From `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md`:

- **§C7** (L124) — route shape, body, headers, rate, audit. Source of truth for this chunk.
- **§C8** (L148) — signed delta canonical; `admin_adjustment` is the only reason accepting signed delta; `sourceRef: admin:${adminId}:${crypto.randomUUID()}`.
- **§C13** (L237) — registration in `apps/api/src/routes/admin/index.ts` mandatory (verified pattern in the existing `scope.register` blocks of that file).
- **§"Killswitch"** (L510) — admin route returns `409 gamification_disabled` when off. Exact parity with chunk-20 badge-grant route (`apps/api/src/routes/admin/user-garage.ts:432-433`).
- **§"Locked invariants" #3** (L29) — XP decrement permitted only via (a) like-revert or (b) admin manual adjustment with `reason: 'admin_adjustment'`, audit-logged. This chunk implements (b).

Stale lines superseded — restate in PR body §"Deviations":

- Outline §362 "two-call for negative" — superseded by §C8 (one signed call).
- Outline §282 sourceRef `'admin:<adminId>:<freeFormReason>'` — superseded by §C7/§C8 (`admin:<adminId>:<uuid>`); free-form reason lives in AdminAudit metadata. **Fix-canon §7 confirms:** sourceRef is server-generated `admin:<adminId>:<uuid>` per outline §C7 — overrides the stale §282 free-form format.
- Outline §126 "DELTA.md §12.7 no new endpoints" — endpoint kept per kickoff (§C7).

**Fix-canon alignment (read `/tmp/phase2-fix-canon.md` before executing):**

- **§4 (awardXp signature):** canonical is positional 4-arg `awardXp(tx, garageId, reason, opts)` with `opts = { sourceRef, delta?, rarity? }`. For `'admin_adjustment'`, this chunk passes `{ delta, sourceRef }` — both required, delta signed. Matches the skeleton + all 2B consumers. Chunk 27 conforms to this signature.
- **§5 (awardXp error contract):** killswitch off → `{ awarded: false, reason: 'gamification_disabled' }` (no DB touch); P2002 → silently `{ awarded: false, reason: 'duplicate' }`; any other error rethrows so the parent `$transaction` rolls back. This route does NOT wrap `awardXp` in a defensive try/catch — unexpected throws propagate to the tx + then to the 500 reply.
- **§7 (sourceRef non-null at awarder boundary):** the route generates `admin:<adminId>:<uuid>` and always passes a non-null `sourceRef`. The `@@unique([garageId, reason, sourceRef])` constraint enforces idempotency on the non-null path.
- **Review BLOCK (audit atomicity):** `recordAudit` lives INSIDE the same `prisma.$transaction` as `awardXp`, with `tx` passed as the second arg. XpEvent + Garage.xp + AdminAudit roll back together if any step throws.
- **Review MAJOR (rate-limit isolation):** the XP route gets its OWN admin-only register block in `admin/index.ts` with a dedicated `admin-xp-adj:<sub>` bucket — NOT folded into the existing `adminUserMutationRoutes` block.
- **Review MAJOR (API/action scope):** `admin-garage-api.ts` fetcher + new `actions/admin-garage-xp.ts` server action are part of this chunk's "Files touched" so the modal has a working submit path.
- **Review MAJOR (modal validation):** client parses `Number(delta)` + requires `Number.isInteger(Number(delta))` — `Number.parseInt` would truncate `1.5 → 1` and bypass the server's non-integer rejection.

## Decision call — admin UI scope

Skeleton allowed fold-or-defer. **Decision: fold here.** Estimate: form ~80 LOC + page mount ~10 + interaction test ~80 = ~170 — under the 200 threshold. Splitting adds a second PR with no value (modal has no behavior without the route). **Escape hatch:** if Task 6 materially exceeds 200 LOC, commit Tasks 1–5 as `feat/jdma-garage-phase2-35`, open `feat/jdma-garage-phase2-35-5` for the modal alone, note the split in PR body §"Deviations". Route is shippable without the modal.

---

## File Structure

```
packages/shared/src/admin-garage-xp.ts                           (new — body schema)
packages/shared/src/__tests__/admin-garage-xp.test.ts            (new)
packages/shared/src/admin.ts                                     (modify — add 'xp.adjustment')
packages/shared/package.json                                     (modify — add ./admin-garage-xp)
apps/api/src/services/garage/ensure.ts                           (new — extract ensureGarageForUserId)
apps/api/src/routes/admin/user-garage.ts                         (modify — replace inline ensure with import)
apps/api/src/routes/admin/garage-xp-adjustment.ts                (new — route handler)
apps/api/src/routes/admin/index.ts                               (modify — register; §C13)
apps/api/test/garage/admin-xp-adjustment.test.ts                 (new — 11 integration cases)
apps/admin/src/lib/admin-garage-api.ts                           (modify — add `adjustGarageXp` fetcher)
apps/admin/src/actions/admin-garage-xp.ts                        (new — server action calling the fetcher)
apps/admin/src/components/admin-xp-adjustment-modal.tsx          (new)
apps/admin/src/components/admin-xp-adjustment-modal.interaction.test.tsx (new)
apps/admin/app/(authed)/users/[id]/page.tsx                      (modify — mount modal + wire server action)
```

Pattern alignment: shared subpath mirrors `./admin-garage` + `./badges-copy` blocks in `packages/shared/package.json`. Route file lives beside `user-garage.ts`; do NOT extend `user-garage.ts` — new file isolates the rate-limit scope cleanly per §C13. AdminAuditAction lives in `packages/shared/src/admin.ts:22-110`; add `'xp.adjustment'` adjacent to `'badge.award'`. Test lives at `apps/api/test/garage/` (schema-touching tests sit with the garage suite — chunk-23 precedent). Admin fetcher + server action filenames mirror existing chunk-20 patterns (`admin-garage-api.ts` already hosts `grantPremium`, `awardBadge`, etc. — extend it with `adjustGarageXp`; `actions/admin-garage-xp.ts` is a new file in the same `actions/` directory pattern used by chunk-20 badge-grant).

---

## Task 1 — Shared zod schema

**Files:** new `packages/shared/src/admin-garage-xp.ts`, new `packages/shared/src/__tests__/admin-garage-xp.test.ts`, modify `packages/shared/src/admin.ts`, modify `packages/shared/package.json`.

- [ ] **Step 1.1 — Write failing schema test**

`packages/shared/src/__tests__/admin-garage-xp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { adminXpAdjustmentSchema } from '../admin-garage-xp.js';

describe('adminXpAdjustmentSchema (§C7)', () => {
  // representative case — see remaining 8 specs below
  it('accepts valid positive delta + 3+ char reason', () => {
    expect(adminXpAdjustmentSchema.parse({ delta: 50, reason: 'Apology bonus' })).toEqual({
      delta: 50,
      reason: 'Apology bonus',
    });
  });
  // ...8 more cases
});
```

Remaining 8 `it` blocks (each `expect(...).toThrow()` unless noted):

- `accepts negative delta (§C8)` — `{ delta: -25, reason: 'Reversal of fraud' }`; `.delta === -25` (no throw).
- `rejects delta = 0` — `{ delta: 0, reason: 'noop' }`.
- `rejects non-integer delta` — `{ delta: 1.5, reason: 'fractional' }`.
- `rejects delta < -10000` — `{ delta: -10_001, reason: 'too much' }`.
- `rejects delta > 10000` — `{ delta: 10_001, reason: 'too much' }`.
- `rejects reason < 3 chars after trim` — `{ delta: 5, reason: '  a  ' }`.
- `rejects reason > 120 chars` — `{ delta: 5, reason: 'a'.repeat(121) }`.
- `trims whitespace from reason` — `{ delta: 10, reason: '   trimmed   ' }`; `.reason === 'trimmed'` (no throw).

- [ ] **Step 1.2 — Run test, confirm FAIL**

```bash
pnpm --filter @ccc/shared test -- src/__tests__/admin-garage-xp.test.ts
```

Expected FAIL: "Cannot find module '../admin-garage-xp.js'".

- [ ] **Step 1.3 — Implement schema**

`packages/shared/src/admin-garage-xp.ts`:

```ts
import { z } from 'zod';

/**
 * Body for POST /admin/users/:id/garage/xp-adjustment.
 * Per §C7: delta signed int [-10000, 10000] non-zero; reason 3..120 chars trimmed.
 * Per §C8: admin_adjustment is the ONLY awarder reason accepting signed delta.
 */
export const adminXpAdjustmentSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-10_000)
    .max(10_000)
    .refine((n) => n !== 0, { message: 'delta cannot be zero' }),
  reason: z.string().trim().min(3).max(120),
});

export type AdminXpAdjustmentInput = z.infer<typeof adminXpAdjustmentSchema>;
```

The zero-delta `.refine` rejects at the schema layer. Route still keeps a defensive 0-check (belt + suspenders); both paths return the same `{ error: 'invalid_delta' }` 400.

- [ ] **Step 1.4 — Run test, confirm PASS**

```bash
pnpm --filter @ccc/shared test -- src/__tests__/admin-garage-xp.test.ts
```

Expected: 9 cases PASS.

- [ ] **Step 1.5 — Add subpath in `packages/shared/package.json`**

Insert alphabetically after `"./admin-garage"`:

```json
    "./admin-garage-xp": {
      "types": "./src/admin-garage-xp.ts",
      "default": "./dist/admin-garage-xp.js"
    },
```

- [ ] **Step 1.6 — Extend `adminAuditActionSchema` in `packages/shared/src/admin.ts`**

Insert `'xp.adjustment'` after `'badge.unpin'` and before `'gamification.toggle'` (~L108):

```ts
  'badge.award',
  'badge.pin',
  'badge.unpin',
  'xp.adjustment',
  'gamification.toggle',
```

- [ ] **Step 1.7 — Rebuild `@ccc/shared` (CLAUDE.md memory rule)**

Runtime resolves `dist/`. Without rebuild, API typechecks against `src/` but runs against stale `dist/`.

```bash
pnpm --filter @ccc/shared build
```

Expected: success. New `dist/admin-garage-xp.js` + `.d.ts`; `dist/admin.js` regenerated with the extended enum.

- [ ] **Step 1.8 — Commit task 1**

Stage the 4 touched files. Subject: `feat(shared): adminXpAdjustmentSchema + xp.adjustment audit action (chunk 35)`. Body: short paragraph naming the new subpath + the new audit-action enum value. Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 2 — Extract `ensureGarageForUserId`

**Files:** new `apps/api/src/services/garage/ensure.ts`; modify `apps/api/src/routes/admin/user-garage.ts`.

The helper currently lives inline at `apps/api/src/routes/admin/user-garage.ts:48-105` (constant `ENSURE_GARAGE_MAX_SLUG_RETRIES` + function `ensureGarageForUserId`). Extract once so chunk-20 and chunk-35 share it.

- [ ] **Step 2.1 — Create `apps/api/src/services/garage/ensure.ts`**

Copy verbatim from `apps/api/src/routes/admin/user-garage.ts:48-105` (the comment block + `ENSURE_GARAGE_MAX_SLUG_RETRIES` constant + `ensureGarageForUserId` function). Adjust:

- Add a top-level `export` to the function (`export const ensureGarageForUserId = ...`).
- Adjust the relative imports to the new location: `'../../lib/prisma-errors.js'` and `'./index.js'` for `defaultGarageSlugForUserId` + `findFreeGarageSlug`.
- Keep the `ENSURE_GARAGE_MAX_SLUG_RETRIES = 3` constant private (module-level, not exported).

No behavior change to the function body. Engineer reads the source lines, copies, and adjusts imports — do NOT introduce any logic delta from the current chunk-20 helper.

- [ ] **Step 2.2 — Replace inline copy in `apps/api/src/routes/admin/user-garage.ts`**

Delete lines 48–105 (comment block + constant + function). Add to the imports:

```ts
import { ensureGarageForUserId } from '../../services/garage/ensure.js';
```

(Alphabetical placement inside existing import block.) No other change to `user-garage.ts`.

- [ ] **Step 2.3 — Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected GREEN. Chunk-20 test suite still passes verbatim — same function, just imported.

---

## Task 3 — Route handler

**Files:** new `apps/api/src/routes/admin/garage-xp-adjustment.ts`.

Pattern reference: `apps/api/src/routes/admin/user-garage.ts:387-445` (chunk-20 badge-grant block). Same `await app.register(async (scope) => { ... })` inner block-scope for the dedicated rate-limit, same `keyGenerator` shape, same `requireUser` → `actor.sub`, same `ensureGarageForUserId`.

- [ ] **Step 3.1 — Create the route file**

```ts
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';

import { prisma } from '@ccc/db';
import { adminXpAdjustmentSchema } from '@ccc/shared/admin-garage-xp';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { ensureGarageForUserId } from '../../services/garage/ensure.js';
import { awardXp } from '../../services/garage/xp-awarder.js';

export const adminGarageXpAdjustmentRoutes: FastifyPluginAsync = async (app) => {
  // Per-endpoint 30/min/admin bucket — does NOT share with adminUserMutationRoutes.
  await app.register(async (scope) => {
    await scope.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => {
        const auth = (req as unknown as { user?: { sub?: string } }).user;
        return auth?.sub ? `admin-xp-adj:${auth.sub}` : `admin-xp-adj-ip:${req.ip}`;
      },
    });

    scope.post('/users/:id/garage/xp-adjustment', async (request, reply) => {
      const actor = requireUser(request);
      const { id } = request.params as { id: string };

      const parsed = adminXpAdjustmentSchema.safeParse(request.body);
      if (!parsed.success) {
        const zeroIssue = parsed.error.issues.find(
          (i) => i.path[0] === 'delta' && i.message === 'delta cannot be zero',
        );
        if (zeroIssue) return reply.status(400).send({ error: 'invalid_delta' });
        return reply.status(422).send({
          error: 'invalid_body',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const { delta, reason } = parsed.data;

      const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!target) return reply.status(404).send({ error: 'NotFound' });

      const garage = await ensureGarageForUserId(id);

      // §C7 + §C8: server-generated UUID sourceRef keeps the @@unique([garageId,
      // reason, sourceRef]) constraint deterministic across repeat support calls.
      const sourceRef = `admin:${actor.sub}:${crypto.randomUUID()}`;

      // Atomicity: awardXp + AdminAudit share ONE transaction. If recordAudit
      // throws, XpEvent + Garage.xp updates roll back together. No persisted
      // unaudited admin adjustment. Fix-canon §4 + review BLOCK (chunk 35).
      const outcome = await prisma.$transaction(async (tx) => {
        const result = await awardXp(tx, garage.id, 'admin_adjustment', { delta, sourceRef });
        if (!result.awarded) return { awarded: false as const, reason: result.reason };
        await recordAudit(
          {
            actorId: actor.sub,
            action: 'xp.adjustment',
            entityType: 'garage',
            entityId: garage.id,
            metadata: { delta, reason, sourceRef, targetUserId: id },
          },
          tx,
        );
        const after = await tx.garage.findUniqueOrThrow({
          where: { id: garage.id },
          select: { xp: true },
        });
        return { awarded: true as const, xp: after.xp };
      });

      if (!outcome.awarded) {
        if (outcome.reason === 'gamification_disabled') {
          return reply.status(409).send({ error: 'gamification_disabled' });
        }
        return reply.status(500).send({ error: 'InternalServerError' });
      }

      return reply.status(200).send({ xp: outcome.xp });
    });
  });
};
```

`awardXp` signature is the canonical positional 4-arg form per fix-canon §4: `awardXp(tx, garageId, reason, opts)` with `opts = { sourceRef, delta? , rarity? }`. For `'admin_adjustment'`, `opts.delta` is the signed int + `opts.sourceRef` is the precomputed `admin:<adminId>:<uuid>` string (fix-canon §7 + outline §C7+§C8). `recordAudit` accepts an optional `client` second arg (`apps/api/src/services/admin-audit.ts:41-54`) — pass `tx` so the AdminAudit insert lives inside the same `$transaction` as the awarder writes.

- [ ] **Step 3.2 — Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected GREEN. If the awardXp option keys differ, fix to match the actual export on `main`.

---

## Task 4 — Register the route (§C13)

**Files:** modify `apps/api/src/routes/admin/index.ts`.

Register in a **dedicated admin-only block** — NOT inside the existing `adminUserMutationRoutes` block. Rationale per review MAJOR: putting the XP route alongside `adminUserMutationRoutes` makes it share the same outer `admin-user-mut:` 30/min bucket, so a single admin running normal user mutations (create / disable / enable) can starve XP adjustments out of their own §C7 budget (and vice versa). §C7 mandates an isolated 30/min/admin bucket for the XP route. We achieve isolation by creating a **separate admin-only register block** whose only inner registration is `adminGarageXpAdjustmentRoutes`. The route file itself ALSO declares its own inner `admin-xp-adj:` rate-limit (Task 3 Step 3.1) — defense in depth: even if the outer block changed, the route still has its own bucket. Both layers use the same `keyGenerator` prefix `admin-xp-adj:<sub>` so they collapse to one logical bucket.

Organizers still retain access via `adminUserGarageRoutes` for premium grant / badge grant / etc. (those live in the organizer-or-admin scope at L46–L67); only XP write is locked to admin.

- [ ] **Step 4.1 — Add the import alphabetically**

After `import { adminFinanceRoutes }`:

```ts
import { adminGarageXpAdjustmentRoutes } from './garage-xp-adjustment.js';
```

- [ ] **Step 4.2 — Add a new admin-only register block (separate from `adminUserMutationRoutes`)**

Insert immediately AFTER the existing `adminUserMutationRoutes` block (~L93–L104) and BEFORE the final `done()` / closing of `adminRoutes`. Do NOT mutate the existing user-mutations block — leave its leading comment, `requireRole('admin')` hook, rate-limit, and `await scope.register(adminUserMutationRoutes);` exactly as-is. The new block mirrors that block's structure but registers only the XP route:

```ts
// XP adjustment: admin-only with isolated 30/min/admin bucket (§C7).
// Separate register block so the bucket does NOT collide with admin-user-mut.
await app.register(async (scope) => {
  scope.addHook('preHandler', scope.requireRole('admin'));
  await scope.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const auth = (req as unknown as { user?: { sub?: string } }).user;
      return auth?.sub ? `admin-xp-adj:${auth.sub}` : `admin-xp-adj-ip:${req.ip}`;
    },
  });
  await scope.register(adminGarageXpAdjustmentRoutes);
});
```

The outer block's `admin-xp-adj:` key matches the inner route-file rate-limit key from Step 3.1 — both layers reference the same logical bucket, so the effective limit stays at 30/min/admin (no double-counting; `@fastify/rate-limit` keys are per-store + per-key, so identical keys collapse). The `adminUserMutationRoutes` bucket (`admin-user-mut:<sub>`) and this bucket (`admin-xp-adj:<sub>`) are independent — exhausting one does NOT throttle the other.

- [ ] **Step 4.3 — Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected GREEN.

---

## Task 5 — Integration tests

**Files:** new `apps/api/test/garage/admin-xp-adjustment.test.ts`.

Pattern: read `apps/api/test/admin/badge-manual-grant.test.ts:1-185`. Same `bearer/createUser/makeApp/resetDatabase` from `../helpers.js`, same testcontainer Postgres from `test/global-setup.ts`, same killswitch via `prisma.generalSettings.upsert`.

- [ ] **Step 5.1 — Write the failing test file**

File scaffolding (imports + `seedAdminAndTarget` helper + `post` helper + `describe` shell):

```ts
// apps/api/test/garage/admin-xp-adjustment.test.ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const seedAdminAndTarget = async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const { user: admin } = await createUser({
    email: `admin-${stamp}@jdm.test`,
    verified: true,
    role: 'admin',
  });
  const { user: target } = await createUser({ email: `target-${stamp}@jdm.test`, verified: true });
  return { admin, target };
};

const post = (
  app: FastifyInstance,
  env: ReturnType<typeof loadEnv>,
  adminId: string,
  role: 'admin' | 'organizer',
  targetId: string,
  body: { delta: number; reason: string },
) =>
  app.inject({
    method: 'POST',
    url: `/admin/users/${targetId}/garage/xp-adjustment`,
    headers: { authorization: bearer(env, adminId, role) },
    payload: body,
  });

describe('POST /admin/users/:id/garage/xp-adjustment (chunk 35)', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });
  // 11 it() blocks — see spec list below
});
```

**12 `it` blocks** — each: seed via `seedAdminAndTarget()` + `loadEnv()` + `post(app, env, admin.id, role, target.id, body)` → assert. Each bullet lists name, payload, load-bearing assertions:

1. **`positive delta — writes XpEvent + AdminAudit + returns updated xp (audit inside tx)`** (REPRESENTATIVE) — `{ delta: 50, reason: 'Compensação por bug no checkin' }`; `statusCode === 200`; `res.json()` === `{ xp: 50 }`; `garage.xp === 50`; `prisma.xpEvent.findMany(...)` length 1 — `events[0].reason === 'admin_adjustment'`, `delta === 50`, `sourceRef.match(/^admin:${admin.id}:[0-9a-f-]{36}$/)`; `prisma.adminAudit.findFirstOrThrow({ where: { action: 'xp.adjustment', actorId: admin.id } })` — `entityType === 'garage'`, `entityId === garage.id`, `metadata.delta === 50`, `metadata.reason === 'Compensação por bug no checkin'`, `metadata.targetUserId === target.id`, `metadata.sourceRef === events[0].sourceRef`. Additionally assert audit + xp event share the same row via timestamp ordering: `adminAudit.createdAt >= events[0].createdAt` (audit recorded after awardXp inside the tx) and both rows exist together (atomicity baseline; the dedicated rollback test below proves the inverse).

2. **`401 without auth header`** — `app.inject(...)` with no `headers.authorization`; `statusCode === 401`.

3. **`403 for non-admin role (organizer denied)`** — `role: 'organizer'`; `post(...)` with `'organizer'`; `statusCode === 403`. §C7 admin-only gate.

4. **`negative delta — single signed XpEvent row, decrements Garage.xp (§C8)`** — first `post(...)` with `{ delta: 100, reason: 'seed' }` (status 200); then `{ delta: -30, reason: 'Reversão de fraude detectada' }`; `res.json() === { xp: 70 }`; `garage.xp === 70`; `prisma.xpEvent.findMany(...)` **length 2** (NOT 3 — refutes outline §362 two-call); second row `delta: -30`, `reason: 'admin_adjustment'`.

5. **`400 invalid_delta when delta = 0`** — `{ delta: 0, reason: 'noop' }`; `statusCode === 400`; body `{ error: 'invalid_delta' }`; `prisma.xpEvent.count() === 0`.

6. **`422 invalid_body when reason too short`** — `{ delta: 10, reason: 'ab' }`; `statusCode === 422`; `body.error === 'invalid_body'`.

7. **`422 invalid_body when delta out of range`** — `{ delta: 99_999, reason: 'too big' }`; `statusCode === 422`.

8. **`409 gamification_disabled when killswitch off (§"Killswitch" L510)`** — `prisma.generalSettings.upsert({ where: { id: 'general_default' }, create: { id: 'general_default', gamificationEnabled: false }, update: { gamificationEnabled: false } })` BEFORE seeding; `post(...)` with `{ delta: 25, reason: 'should be blocked' }`; `statusCode === 409`; body `{ error: 'gamification_disabled' }`; `prisma.xpEvent.count() === 0` AND `prisma.adminAudit.count({ where: { action: 'xp.adjustment' } }) === 0`.

9. **`404 NotFound when target user does not exist`** — `targetId: 'nonexistent-user-id'`; `statusCode === 404`.

10. **`UUID sourceRef ensures no collision on repeat support calls (§C1 + §C7)`** — 3 sequential `post(...)` with **identical** `{ delta: 5, reason: 'same reason' }`; all 200; final `res.json() === { xp: 15 }`; `prisma.xpEvent.findMany(...)` length 3; `new Set(events.map(e => e.sourceRef)).size === 3`; each matches `/^admin:${admin.id}:[0-9a-f-]{36}$/`.

11. **`429 when rate-limit exceeded (30/min/admin inner bucket)`** — `for (let i = 0; i < 30; i++) post(...)` all 200; 31st returns `429`.

12. **`AdminAudit failure rolls back XpEvent + Garage.xp (atomicity inside tx)`** — `vi.spyOn(adminAuditModule, 'recordAudit').mockRejectedValueOnce(new Error('audit-down'))` where `adminAuditModule` is `import * as adminAuditModule from '../../src/services/admin-audit.js'`; `post(...)` with `{ delta: 75, reason: 'should fully roll back' }`; `statusCode === 500`; `prisma.xpEvent.count({ where: { reason: 'admin_adjustment' } }) === 0`; `prisma.garage.findUniqueOrThrow({ where: { userId: target.id }, select: { xp: true } }).xp === 0`; `prisma.adminAudit.count({ where: { action: 'xp.adjustment' } }) === 0`. Restore the spy in an `afterEach` (or `mockRejectedValueOnce` is sufficient — the next test resets state via `resetDatabase()`). Load-bearing: proves audit + xp share the same tx; without the in-tx audit fix this test would observe persisted XpEvent + xp=75 with no audit row.

- [ ] **Step 5.2 — Run tests**

```bash
pnpm --filter @ccc/api test -- test/garage/admin-xp-adjustment.test.ts
```

Expected: 12 PASS. If `prisma.xpEvent` is undefined → `pnpm --filter @ccc/db build` (chunk 23 dist not regenerated locally).

- [ ] **Step 5.3 — Commit Tasks 2 + 3 + 4 + 5 together**

Stage the 5 touched files (`ensure.ts`, `user-garage.ts`, `garage-xp-adjustment.ts`, `admin/index.ts`, the test). Subject: `feat(api): admin XP adjustment route + audit (chunk 35)`. Body: paragraph naming the route + sourceRef format + AdminAudit-in-tx atomicity + isolated rate-limit bucket + killswitch behavior + `ensureGarageForUserId` extraction. Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 6 — Admin UI modal

**Files:** new `apps/admin/src/components/admin-xp-adjustment-modal.tsx`, new `*.interaction.test.tsx`, modify `apps/admin/app/(authed)/users/[id]/page.tsx`.

Folded per decision call. Escape hatch: if implementation creeps past 200 LOC, split per §"Decision call".

- [ ] **Step 6.1 — Locate the existing admin modal primitive**

Read `apps/admin/src/components/grant-garage-premium-modal.tsx` + `edit-user-garage-modal.tsx` to identify the modal wrapper (shadcn `Dialog` vs hand-rolled `<dialog>`). Copy the wrapper verbatim. Do NOT introduce a new dialog library.

- [ ] **Step 6.2 — Write the interaction test first**

`apps/admin/src/components/admin-xp-adjustment-modal.interaction.test.tsx` — 5 `it` blocks, all use `@testing-library/react` + `userEvent.setup()` + `render(<AdminXpAdjustmentModal userId="u_1" open onClose={...} onSubmit={...} />)`:

1. **`disables submit until delta + reason valid`** — render with `onSubmit={vi.fn()}`; assert "Aplicar" button disabled; type `'50'` into `getByLabelText(/delta/i)` — still disabled; type `'Compensação'` into `getByLabelText(/motivo/i)` — enabled.
2. **`rejects delta = 0 client-side`** — type `'0'` into delta + `'noop attempt'` into reason; assert button stays disabled.
3. **`rejects non-integer delta client-side (1.5 must NOT submit)`** — type `'1.5'` into delta + `'fractional attempt'` into reason; assert button stays disabled. Load-bearing for the `Number()` + `Number.isInteger` fix; with the prior `Number.parseInt` form this test fails because `parseInt('1.5', 10) === 1` passes `Number.isInteger` and enables submit. Also type `'10abc'` + valid reason in a follow-up step — button still disabled.
4. **`calls onSubmit + closes on success`** — `onSubmit = vi.fn().mockResolvedValue({ xp: 120 })`; type `'-25'` + `'Reversão fraude'`; click "Aplicar"; `waitFor` `onSubmit` called with `{ delta: -25, reason: 'Reversão fraude' }`; `waitFor` `onClose` called.
5. **`renders gamification_disabled error from server`** — `onSubmit = vi.fn().mockRejectedValue({ status: 409, body: { error: 'gamification_disabled' } })`; type valid inputs; click "Aplicar"; `waitFor` `screen.getByText(/gamificação desativada/i)` is present.

```bash
pnpm --filter @ccc/admin test -- src/components/admin-xp-adjustment-modal.interaction.test.tsx
```

Expected FAIL: module not found.

- [ ] **Step 6.3 — Implement the modal**

`apps/admin/src/components/admin-xp-adjustment-modal.tsx`. Tailwind classes copied from `grant-garage-premium-modal.tsx`.

Props: `{ userId: string; open: boolean; onClose: () => void; onSubmit: (input: AdminXpAdjustmentInput) => Promise<{ xp: number }>; gamificationDisabled?: boolean }`. Import `AdminXpAdjustmentInput` from `@ccc/shared/admin-garage-xp`.

State: `delta` (string), `reason` (string), `error` (string | null), `submitting` (boolean).

Validation (must match server-side schema verbatim — load-bearing for the "delta=0 client-side" + "non-integer client-side" tests). Use `Number(delta)` + `Number.isInteger(Number(delta))` — NOT `Number.parseInt`, which silently truncates `1.5 → 1` and `1e6 → 1` and `'10abc' → 10`, letting non-integer/garbled input bypass the client check and rely on server rejection (review MAJOR — chunk 35):

```ts
const parsedDelta = Number(delta);
const deltaValid =
  Number.isFinite(parsedDelta) &&
  Number.isInteger(parsedDelta) &&
  parsedDelta !== 0 &&
  parsedDelta >= -10_000 &&
  parsedDelta <= 10_000;
const reasonValid = reason.trim().length >= 3 && reason.trim().length <= 120;
const canSubmit = deltaValid && reasonValid && !submitting && !gamificationDisabled;
```

`Number('')` returns `0` and `Number('abc')` returns `NaN`; both fall through `deltaValid` correctly (the zero check + `Number.isFinite` catch them). `Number('1.5')` returns `1.5` and `Number.isInteger(1.5) === false` — the fix preserves the rejection at the client layer. `Number.parseInt('1.5', 10)` returns `1`, which would pass `Number.isInteger` and submit a request the server would reject; the canonical fix prevents that round-trip.

Submit handler: catch error, branch on `err.body?.error`:

- `'gamification_disabled'` → `setError('Gamificação desativada.')`
- `'invalid_delta'` → `setError('Delta inválido.')`
- default → `setError('Erro ao aplicar ajuste.')`

On success: clear state + call `onClose()`.

Markup: `<div role="dialog" aria-modal="true">` wrapper (or the admin app's existing `Dialog` primitive from Step 6.1) containing `<h2>Ajuste manual de XP</h2>`, `<label>Delta <input type="number" min={-10_000} max={10_000} step={1} .../></label>`, `<label>Motivo <textarea maxLength={120} .../></label>`, killswitch banner `<p>Gamificação desativada — ajustes bloqueados.</p>` when `gamificationDisabled`, `<p role="alert">` for the error string, Cancelar button (`disabled={submitting}`), Aplicar button (`disabled={!canSubmit}`; label switches `'Aplicando...'` while submitting).

```bash
pnpm --filter @ccc/admin test -- src/components/admin-xp-adjustment-modal.interaction.test.tsx
pnpm --filter @ccc/admin typecheck
```

Expected: 5 PASS, typecheck GREEN.

- [ ] **Step 6.4 — Extend the admin fetcher with `adjustGarageXp`**

`apps/admin/src/lib/admin-garage-api.ts` already hosts the chunk-20 admin-garage fetchers (`grantPremium`, `awardBadge`, etc.). Add a sibling export:

```ts
import type { AdminXpAdjustmentInput } from '@ccc/shared/admin-garage-xp';

export const adjustGarageXp = async (
  userId: string,
  input: AdminXpAdjustmentInput,
): Promise<{ xp: number }> => {
  // Use the existing helper (look for `adminFetch` / `postJson` already in the file)
  // — do NOT introduce a new fetch wrapper. Error mapping: a non-OK response
  // throws `{ status, body }` so the modal can switch on body.error.
  return adminFetch(`/admin/users/${userId}/garage/xp-adjustment`, {
    method: 'POST',
    body: input,
  });
};
```

Read the existing file first to confirm the helper name (`adminFetch` vs `postJson` vs hand-rolled) — reuse, do NOT introduce a new fetch wrapper.

- [ ] **Step 6.5 — Create the server action**

`apps/admin/src/actions/admin-garage-xp.ts` — new file mirroring the chunk-20 action pattern:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { adminXpAdjustmentSchema, type AdminXpAdjustmentInput } from '@ccc/shared/admin-garage-xp';
import { adjustGarageXp } from '../lib/admin-garage-api.js';

export const adjustGarageXpAction = async (
  userId: string,
  input: AdminXpAdjustmentInput,
): Promise<{ xp: number }> => {
  const parsed = adminXpAdjustmentSchema.parse(input); // server-side re-validation
  const result = await adjustGarageXp(userId, parsed);
  revalidatePath(`/users/${userId}`);
  return result;
};
```

Pattern mirrors `apps/admin/src/actions/admin-garage.ts` (chunk-20 badge-grant action). The `revalidatePath` invalidates the user-detail page cache so the refreshed `xp` renders without a manual reload.

- [ ] **Step 6.6 — Mount on the user-detail page**

`apps/admin/app/(authed)/users/[id]/page.tsx`: locate the existing modal mounts (`GrantGaragePremiumModal`, `EditUserGarageModal`). Add the XP-adjustment trigger button + modal alongside them, gated on the same admin role check those modals already use. Wire `onSubmit={(input) => adjustGarageXpAction(userId, input)}` (the new server action from Step 6.5). After success, the action's `revalidatePath` triggers a refetch — the page's `xp` display updates without additional client logic.

Engineer reads the page first — reuse existing state/fetch patterns; do NOT introduce new ones.

- [ ] **Step 6.7 — Commit Task 6**

Stage the 5 touched files (modal `.tsx`, interaction test, admin-garage-api fetcher, server action, mounted page). Subject: `feat(admin): XP adjustment modal on user-detail page (chunk 35)`. Body: paragraph naming the fetcher + server action + mount + validation (`Number()` + `Number.isInteger`) + error mapping (gamification_disabled banner per XP plan §"Killswitch" L513). Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Verification — run before push

Stop and fix at the first failure.

```bash
# 1. Shared.
pnpm --filter @ccc/shared build
pnpm --filter @ccc/shared typecheck
pnpm --filter @ccc/shared test -- src/__tests__/admin-garage-xp.test.ts

# 2. API.
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api test -- test/garage/admin-xp-adjustment.test.ts

# 3. Admin.
pnpm --filter @ccc/admin typecheck
pnpm --filter @ccc/admin test -- src/components/admin-xp-adjustment-modal.interaction.test.tsx
```

`pnpm --filter @ccc/shared build` is **required** before the API tests (CLAUDE.md `feedback_rebuild_shared_after_schema_change.md`). Per `feedback_no_full_test_suite_locally.md`, only the new files run. Per `feedback_no_background_shells.md`, all commands are one-shot.

---

## Task 7 — PR

- [ ] **Step 7.1 — Push**

```bash
git push -u origin feat/jdma-garage-phase2-35
```

- [ ] **Step 7.2 — Open PR (`gh pr create --base main`)**

PR title: `feat(api,admin): admin XP adjustment route + audit (chunk 35)`.

PR body sections (HEREDOC):

- **Summary** — bullets: route (path, admin Bearer, isolated 30/min/admin bucket, body shape, returns `{ xp }`); awarder delegation to `awardXp(tx, garageId, 'admin_adjustment', { delta, sourceRef })` per fix-canon §4; sourceRef format `admin:<adminId>:<uuid>` per §C7+§C1+fix-canon §7; AdminAudit `{ action: 'xp.adjustment', metadata: { delta, reason, sourceRef, targetUserId } }` INSIDE the awarder tx (audit + XP atomic per review BLOCK fix); killswitch off → 409 (§"Killswitch" L510); admin UI modal reuses existing primitive with `Number()` + `Number.isInteger` validation; admin fetcher + server action wired so the modal submits; bonus refactor extracts `ensureGarageForUserId` to `services/garage/ensure.ts`.
- **Out of scope** — XPScoreboard (chunk 36), public progress wiring (chunk 28), XP tooltips.
- **Deviations from plan** — seven entries: (1) outline §362 two-call → §C8 one signed call; (2) outline §282 free-form sourceRef → server-generated `admin:<adminId>:<uuid>` per fix-canon §7; (3) outline §126 no-new-endpoints → endpoint kept per kickoff (§C7); (4) fold-or-defer decision (admin UI folded here); (5) `ensureGarageForUserId` extraction not called out in the skeleton; (6) review BLOCK fix — AdminAudit moved INSIDE the awarder `$transaction`; (7) review MAJOR fix — separate admin-only register block with isolated `admin-xp-adj:<sub>` rate-limit bucket, NOT folded into `adminUserMutationRoutes`.
- **Test plan** — checkbox list of the seven verification commands from §"Verification — run before push".
- **Reviewer checklist** — the twelve self-review items from the §"Self-review checklist" below.
- **Outline refs** — outline §C1, §C5, §C7, §C8, §C13, §"Killswitch" L510, §"Locked invariants" #3 L29; skeleton lines 361–383; fix-canon §4, §5, §7.

PR opens against `main`. Never `production`.

---

## Cross-references

- Skeleton: `docs/superpowers/plans/2026-05-24-phase2-chunks-skeleton.md:361-383`.
- Outline (all §-refs): `docs/superpowers/plans/2026-05-21-garage-progression-phase2-xp.md` — §C7 (L124), §C8 (L148), §C13 (L237), §"Killswitch" (L510), §"Locked invariants" #3 (L29), §261 (`awardXp` signature; verify against `main` before writing the call site).
- Phase 1 admin route + test precedent: `apps/api/src/routes/admin/user-garage.ts:387-445` + `apps/api/test/admin/badge-manual-grant.test.ts:1-185` (chunk-20 badge-grant).
- Phase 1 chunk-23 plan (tone): `docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-23-garage-xp-columns.md`.
- Source references: shared subpaths in `packages/shared/package.json` (`./admin-garage` + `./badges-copy`); `AdminAuditAction` in `packages/shared/src/admin.ts:22-110`; `recordAudit` in `apps/api/src/services/admin-audit.ts:41-54`; killswitch in `apps/api/src/services/garage/killswitch.ts`.

## Self-review checklist (before requesting review)

- [ ] Branch `feat/jdma-garage-phase2-35`, cut from fresh `main`. Chunks 23 + 24 + 27 on `main`.
- [ ] `packages/shared/package.json` subpath alphabetical. `pnpm --filter @ccc/shared build` ran after the schema change; `dist/admin-garage-xp.js` exists.
- [ ] `adminAuditActionSchema` includes `'xp.adjustment'`; new `recordAudit` typechecks.
- [ ] Route has inner rate-limit bucket `admin-xp-adj:<sub>`. Registered in its OWN admin-only `app.register` block in `admin/index.ts` — NOT inside the `adminUserMutationRoutes` block (review MAJOR).
- [ ] `crypto.randomUUID()` for `sourceRef` (fix-canon §7) — NOT timestamp, NOT hash of reason. Format matches `/^admin:[^:]+:[0-9a-f-]{36}$/`.
- [ ] `awardXp` called with positional 4-arg form `awardXp(tx, garage.id, 'admin_adjustment', { delta, sourceRef })` per fix-canon §4.
- [ ] AdminAudit written INSIDE the same `prisma.$transaction` as `awardXp`, with `tx` passed to `recordAudit` (review BLOCK). Audit + XpEvent + Garage.xp roll back together on any throw. Verified by the audit-failure rollback integration test (Task 5 test 12).
- [ ] Killswitch-off returns 409 `{ error: 'gamification_disabled' }` (NOT 500, NOT 200 with `awarded: false`).
- [ ] 12 `it` blocks cover: 200-positive (audit-in-tx), 401, 403, 200-negative, 400-delta-zero, 422-reason-short, 422-delta-range, 409-killswitch, 404-missing-user, UUID-collision, 429-rate-limit, audit-failure-rollback.
- [ ] `ensureGarageForUserId` import in `user-garage.ts` replaces inline cleanly (no orphan `ENSURE_GARAGE_MAX_SLUG_RETRIES`).
- [ ] Admin modal reuses existing modal primitive — no new dialog library. Validation uses `Number(delta)` + `Number.isInteger(Number(delta))` — NOT `Number.parseInt` (review MAJOR).
- [ ] Admin fetcher (`admin-garage-api.ts` extension) + server action (`actions/admin-garage-xp.ts`) wired; modal `onSubmit` calls the server action; `revalidatePath` refreshes the user-detail page.
- [ ] PR body §"Deviations" lists the seven entries (three stale-outline supersedes + fold-or-defer + `ensureGarageForUserId` extraction + audit-in-tx BLOCK fix + rate-limit isolation MAJOR fix).
- [ ] PR opens against `main`, never `production`.
