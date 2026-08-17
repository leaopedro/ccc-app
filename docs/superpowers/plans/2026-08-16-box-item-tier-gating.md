# Box item tier-gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin optionally restrict a box catalog item to a minimum subscription tier, choosing per item whether below-tier members see it locked or hidden.

**Architecture:** Add `minTier` + `restrictedDisplay` to `BoxCatalogItem`. The read model (`buildBoxCatalog`) receives the member's tier and hides or locks gated items; server-side write guards (selection-save + confirm) prevent a below-tier item from ever being persisted or charged. Admin form and mobile card expose the new state.

**Tech Stack:** Prisma/Postgres (`packages/db`), Zod (`packages/shared`), Fastify (`apps/api`), Next.js App Router (`apps/admin`), Expo/React Native + vitest (`apps/mobile`).

**Spec:** `docs/superpowers/specs/2026-08-16-box-item-tier-gating-design.md`

## Global Constraints

- Tiers are `GaragePremiumTier` ordered `bronze < silver < gold`.
- `minTier = null` means no restriction (default) and MUST preserve today's behavior exactly. Existing rows get `null`.
- `restrictedDisplay` default is `locked`; it only has effect when `minTier` is non-null.
- Migration is additive. No data backfill.
- Reuse `garagePremiumTierSchema` from `packages/shared/src/garage.ts`; do not redefine the tier enum.
- Client is never trusted: gating is enforced server-side at both write entry points.
- Copy is PT-BR.
- API tests hit a real Postgres via Testcontainers. Run a single API test file with `cd apps/api && pnpm exec vitest run <file>` (the `pnpm --filter … test -- <file>` form does NOT filter — it runs the whole suite).
- `dropReason` is free text (`String? @db.VarChar(40)`); the value for gated drops is the literal `'tier_restricted'`.

---

## File Structure

- `packages/db/prisma/schema.prisma` — enum `BoxItemRestrictedDisplay`, two new fields on `BoxCatalogItem`.
- `packages/db/prisma/migrations/20260816120000_box_item_tier_gating/migration.sql` — additive SQL.
- `packages/shared/src/box.ts` — `TIER_RANK`, `meetsMinTier`, and the read `boxCatalogItemSchema` fields.
- `packages/shared/src/admin-box.ts` — `minTier`/`restrictedDisplay` on read + create + update item schemas.
- `apps/api/src/services/box/catalog.ts` — `buildBoxCatalog` gains `userTier`, hides/locks items.
- `apps/api/src/routes/box.ts` — `loadEligibleMembership` returns `tier`; catalog route passes it; selection-save guard.
- `apps/api/src/services/box/confirm.ts` — load member tier, drop below-tier lines.
- `apps/api/src/routes/admin/box-catalog-admin.ts` — serialize + persist the two fields.
- `apps/admin/app/(authed)/box/catalogo/box-catalog-client.tsx` — form controls + list badge.
- `apps/admin/src/lib/box-admin-actions.ts` — parse the two fields from FormData.
- `apps/mobile/src/screens/caixa/CatalogItemCard.tsx` — locked card rendering.
- `apps/mobile/src/copy/caixa.ts` — locked badge copy.

---

### Task 1: Schema + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (enum + `BoxCatalogItem` fields)
- Create: `packages/db/prisma/migrations/20260816120000_box_item_tier_gating/migration.sql`

**Interfaces:**

- Produces: `BoxCatalogItem.minTier: GaragePremiumTier | null`, `BoxCatalogItem.restrictedDisplay: 'locked' | 'hidden'` (Prisma enum `BoxItemRestrictedDisplay`) on the generated client.

- [ ] **Step 1: Add the enum after `GaragePremiumTier`**

In `packages/db/prisma/schema.prisma`, add near the other enums:

```prisma
enum BoxItemRestrictedDisplay {
  locked
  hidden
}
```

- [ ] **Step 2: Add the two fields to `BoxCatalogItem`**

Inside `model BoxCatalogItem` (after `active` / `sortOrder`, before the relations block):

```prisma
  minTier           GaragePremiumTier?
  restrictedDisplay BoxItemRestrictedDisplay @default(locked)
```

- [ ] **Step 3: Write the migration SQL**

Create `packages/db/prisma/migrations/20260816120000_box_item_tier_gating/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "BoxItemRestrictedDisplay" AS ENUM ('locked', 'hidden');

-- AlterTable
ALTER TABLE "BoxCatalogItem" ADD COLUMN "minTier" "GaragePremiumTier";
ALTER TABLE "BoxCatalogItem" ADD COLUMN "restrictedDisplay" "BoxItemRestrictedDisplay" NOT NULL DEFAULT 'locked';
```

- [ ] **Step 4: Validate schema and regenerate the client**

Run: `pnpm --filter @ccc/db exec prisma format && pnpm --filter @ccc/db exec prisma validate && pnpm --filter @ccc/db exec prisma generate`
Expected: format + validate succeed; client generates with the new fields.

- [ ] **Step 5: Verify the migration applies against a scratch database**

Run: `pnpm --filter @ccc/db exec prisma migrate diff --from-migrations packages/db/prisma/migrations --to-schema-datamodel packages/db/prisma/schema.prisma --exit-code`
Expected: exit code 0 (migrations match the schema — no drift).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): box item minTier + restrictedDisplay"
```

---

### Task 2: Shared tier-ranking helper

**Files:**

- Modify: `packages/shared/src/box.ts` (add `TIER_RANK`, `meetsMinTier`)
- Test: `packages/shared/src/__tests__/box.test.ts`

**Interfaces:**

- Consumes: `GaragePremiumTier` from `./garage.js`.
- Produces: `meetsMinTier(userTier: GaragePremiumTier, minTier: GaragePremiumTier | null): boolean`; `TIER_RANK: Record<GaragePremiumTier, number>`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/__tests__/box.test.ts`:

```ts
import { meetsMinTier } from '../box.js';

describe('meetsMinTier', () => {
  it('null minTier is always satisfied', () => {
    expect(meetsMinTier('bronze', null)).toBe(true);
    expect(meetsMinTier('gold', null)).toBe(true);
  });
  it('enforces hierarchy bronze < silver < gold', () => {
    expect(meetsMinTier('bronze', 'silver')).toBe(false);
    expect(meetsMinTier('silver', 'silver')).toBe(true);
    expect(meetsMinTier('gold', 'silver')).toBe(true);
    expect(meetsMinTier('silver', 'gold')).toBe(false);
    expect(meetsMinTier('bronze', 'bronze')).toBe(true);
  });
});
```

(If `box.test.ts` already imports from `../box.js`, merge the `meetsMinTier` import into the existing import line rather than adding a second one.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/box.test.ts`
Expected: FAIL — `meetsMinTier` is not exported.

- [ ] **Step 3: Implement the helper**

At the top of `packages/shared/src/box.ts`, ensure the tier type is imported (add if missing):

```ts
import type { GaragePremiumTier } from './garage.js';
```

Then add near the other exports:

```ts
export const TIER_RANK: Record<GaragePremiumTier, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
};

/** true when userTier satisfies minTier. A null minTier is always satisfied. */
export const meetsMinTier = (
  userTier: GaragePremiumTier,
  minTier: GaragePremiumTier | null,
): boolean => minTier === null || TIER_RANK[userTier] >= TIER_RANK[minTier];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/box.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/box.ts packages/shared/src/__tests__/box.test.ts
git commit -m "feat(shared): meetsMinTier tier-ranking helper"
```

---

### Task 3: Admin create/update schemas gain the two fields

**Files:**

- Modify: `packages/shared/src/admin-box.ts` (`adminBoxCatalogItemCreateSchema`, `adminBoxCatalogItemUpdateSchema`)
- Test: `packages/shared/src/__tests__/admin-box.test.ts`

**Interfaces:**

- Consumes: `garagePremiumTierSchema` from `./garage.js`.
- Produces: create/update schemas now accept optional `minTier: GaragePremiumTier | null` and `restrictedDisplay: 'locked' | 'hidden'`.

Note: the admin READ schema (`adminBoxCatalogItemSchema`) gains its required fields in Task 6, alongside the API serializer that produces them — keeping this task's change purely additive and safe.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/__tests__/admin-box.test.ts`:

```ts
import { adminBoxCatalogItemCreateSchema } from '../admin-box.js';

describe('adminBoxCatalogItemCreateSchema tier fields', () => {
  const base = {
    slug: 'adesivo',
    title: 'Adesivo',
    description: 'x',
    priceCents: 1000,
    category: 'acessorios',
  };
  it('accepts minTier + restrictedDisplay', () => {
    const r = adminBoxCatalogItemCreateSchema.parse({
      ...base,
      minTier: 'silver',
      restrictedDisplay: 'hidden',
    });
    expect(r.minTier).toBe('silver');
    expect(r.restrictedDisplay).toBe('hidden');
  });
  it('accepts null minTier and omitted display', () => {
    const r = adminBoxCatalogItemCreateSchema.parse({ ...base, minTier: null });
    expect(r.minTier).toBe(null);
  });
  it('rejects an unknown tier', () => {
    expect(() => adminBoxCatalogItemCreateSchema.parse({ ...base, minTier: 'platinum' })).toThrow();
  });
});
```

(Merge the import with any existing `../admin-box.js` import line.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/admin-box.test.ts`
Expected: FAIL — `minTier` is stripped/unknown, `r.minTier` is `undefined`.

- [ ] **Step 3: Implement the schema additions**

In `packages/shared/src/admin-box.ts`, add the import at the top (with the other imports):

```ts
import { garagePremiumTierSchema } from './garage.js';
```

Add to `adminBoxCatalogItemCreateSchema` (inside the `z.object({ ... })`):

```ts
  minTier: garagePremiumTierSchema.nullable().optional(),
  restrictedDisplay: z.enum(['locked', 'hidden']).optional(),
```

Add the same two lines to `adminBoxCatalogItemUpdateSchema`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/admin-box.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/admin-box.ts packages/shared/src/__tests__/admin-box.test.ts
git commit -m "feat(shared): admin box item create/update accept minTier"
```

---

### Task 4: API read — hide/lock gated items in the catalog

**Files:**

- Modify: `packages/shared/src/box.ts` (`boxCatalogItemSchema` gains `locked`, `minTier`)
- Modify: `apps/api/src/services/box/catalog.ts` (`buildBoxCatalog` signature + logic)
- Modify: `apps/api/src/routes/box.ts` (`loadEligibleMembership` returns `tier`; catalog route passes it)
- Test: `apps/api/test/box/box-catalog.test.ts` (create if absent — see Step 1)

**Interfaces:**

- Consumes: `meetsMinTier` (Task 2); `BoxCatalogItem.minTier` / `restrictedDisplay` (Task 1).
- Produces: `buildBoxCatalog(uploads: Uploads, cycleKey: string, userTier: GaragePremiumTier): Promise<BoxCatalog>`; `loadEligibleMembership` now resolves `{ id: string; tier: GaragePremiumTier } | null`; catalog read items now carry `locked: boolean` and `minTier: GaragePremiumTier | null`.

- [ ] **Step 1: Write the failing test**

Look first at an existing box API test (e.g. `apps/api/test/box/box-get.test.ts`) for the seed helpers and Testcontainers harness this suite uses, and mirror them. Create `apps/api/test/box/box-catalog.test.ts` that seeds: a garage with a `bronze` membership and an open `MonthlyBox`, plus three active catalog items — one ungated, one `minTier=silver` `restrictedDisplay=locked`, one `minTier=silver` `restrictedDisplay=hidden`. Then GET `/me/box/catalog` (or call `buildBoxCatalog` directly with `'bronze'`) and assert:

```ts
// bronze member
const ungated = res.items.find((i) => i.title === 'Ungated');
expect(ungated).toMatchObject({ locked: false });

const locked = res.items.find((i) => i.title === 'LockedSilver');
expect(locked).toMatchObject({ locked: true, minTier: 'silver' });

// hidden item is absent entirely
expect(res.items.find((i) => i.title === 'HiddenSilver')).toBeUndefined();

// a category whose only item is hidden for this member does not appear
expect(res.categories).not.toContain('secretos');
```

Add a second assertion block for a `gold` member (seed a second garage/membership, or call `buildBoxCatalog(..., 'gold')`): every item present, all `locked: false`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/box/box-catalog.test.ts`
Expected: FAIL — `locked`/`minTier` undefined, or `buildBoxCatalog` arity mismatch.

- [ ] **Step 3: Add the read-schema fields**

In `packages/shared/src/box.ts`, ensure `garagePremiumTierSchema` is imported, then extend `boxCatalogItemSchema`:

```ts
export const boxCatalogItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  imageUrl: z.string().nullable(),
  priceCents: z.number().int(),
  maxPerCycle: z.number().int().nullable(),
  soldOut: z.boolean(),
  locked: z.boolean(),
  minTier: garagePremiumTierSchema.nullable(),
});
```

- [ ] **Step 4: Update `buildBoxCatalog`**

In `apps/api/src/services/box/catalog.ts`:

Add imports:

```ts
import { meetsMinTier } from '@ccc/shared/box';
import type { GaragePremiumTier } from '@ccc/shared/garage';
```

Change the signature and compute visibility. Replace the `catalogItems` map and the `categories` line:

```ts
export const buildBoxCatalog = async (
  uploads: Uploads,
  cycleKey: string,
  userTier: GaragePremiumTier,
): Promise<BoxCatalog> => {
  const items = await prisma.boxCatalogItem.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  });
  const ledger = await prisma.boxCatalogItemCycleStock.findMany({ where: { cycleKey } });
  const ledgerById = new Map(ledger.map((l) => [l.catalogItemId, l]));

  // Hide items the member may not see; keep locked ones (flagged) for upsell.
  const visible = items.filter((i) => {
    if (meetsMinTier(userTier, i.minTier)) return true;
    return i.restrictedDisplay === 'locked';
  });

  const catalogItems = visible.map((i) => {
    const row = ledgerById.get(i.id);
    const total = row ? row.total : i.stockPerCycle;
    const reserved = row ? row.reserved : 0;
    const soldOut = total != null && total - reserved <= 0;
    const locked = !meetsMinTier(userTier, i.minTier);
    return {
      id: i.id,
      title: i.title,
      category: i.category,
      imageUrl: i.imageObjectKey ? uploads.buildPublicUrl(i.imageObjectKey) : null,
      priceCents: i.priceCents,
      maxPerCycle: i.maxPerCycle,
      soldOut,
      locked,
      minTier: i.minTier,
    };
  });
  // ... partners block unchanged ...
```

And derive categories from the visible list (not the raw `items`):

```ts
    categories: [...new Set(visible.map((i) => i.category))],
```

Keep the existing stock/soldOut comments and the partners block as-is.

- [ ] **Step 5: Thread the tier through the route**

In `apps/api/src/routes/box.ts`:

Import the tier type if not present:

```ts
import type { GaragePremiumTier } from '@ccc/shared/garage';
```

Update `loadEligibleMembership` to select and return `tier`:

```ts
export const loadEligibleMembership = async (
  userId: string,
): Promise<{ id: string; tier: GaragePremiumTier } | null> => {
  const garage = await prisma.garage.findUnique({ where: { userId }, select: { id: true } });
  if (!garage) return null;
  const membership = await prisma.premiumMembership.findFirst({
    where: { garageId: garage.id, status: { in: [...ELIGIBLE_STATUSES] } },
    orderBy: { currentPeriodEnd: 'desc' },
    select: { id: true, tier: true },
  });
  return membership;
};
```

In the `/me/box/catalog` handler, pass the tier:

```ts
return reply.send(await buildBoxCatalog(app.uploads, box.cycleKey, membership.tier));
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/box/box-catalog.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the broader box read suite for regressions**

Run: `cd apps/api && pnpm exec vitest run test/box/box-get.test.ts`
Expected: PASS (ungated catalog behavior unchanged).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/box.ts apps/api/src/services/box/catalog.ts apps/api/src/routes/box.ts apps/api/test/box/box-catalog.test.ts
git commit -m "feat(api): tier-gate the box catalog read"
```

---

### Task 5: API write guards — block below-tier items on save and confirm

**Files:**

- Modify: `apps/api/src/routes/box.ts` (selection-save loop guard)
- Modify: `apps/api/src/services/box/confirm.ts` (load tier, drop below-tier lines)
- Test: `apps/api/test/box/box-tier-guard.test.ts` (create)

**Interfaces:**

- Consumes: `meetsMinTier` (Task 2); `loadEligibleMembership` now returns `tier` (Task 4).
- Produces: below-tier items never persist to `MonthlyBoxItem` via selection-save; a below-tier line at confirm is dropped with `included=false`, `droppedAt`, `dropReason='tier_restricted'`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/box/box-tier-guard.test.ts`, mirroring the seed harness of `box-catalog.test.ts`. Two cases:

1. Selection-save guard: seed a `bronze` member with an open box and a `minTier=silver` item. PUT `/me/box/selection` with that item at quantity 1. Assert the box has no `MonthlyBoxItem` for it:

```ts
const line = await prisma.monthlyBoxItem.findFirst({
  where: { boxId, catalogItemId: silverItem.id },
});
expect(line).toBeNull();
```

2. Confirm drop: seed a `bronze` member whose box already has a persisted `MonthlyBoxItem` (`included=true`) for the `minTier=silver` item (insert it directly, simulating a pre-existing line). Call `confirmBox({ userId, membershipId, shippingAddressId })`. Assert the line is dropped:

```ts
const line = await prisma.monthlyBoxItem.findUniqueOrThrow({ where: { id: lineId } });
expect(line.included).toBe(false);
expect(line.dropReason).toBe('tier_restricted');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/box/box-tier-guard.test.ts`
Expected: FAIL — the line persists / is not dropped.

- [ ] **Step 3: Add the selection-save guard**

In `apps/api/src/routes/box.ts`, add the import if missing:

```ts
import { meetsMinTier } from '@ccc/shared/box';
```

Inside the `for (const line of input.items)` loop, immediately after the existing `if (!item || !item.active) continue;`:

```ts
if (!meetsMinTier(membership.tier, item.minTier)) continue; // gated: silently ignore
```

`membership.tier` is available because `loadEligibleMembership` now returns it (Task 4).

- [ ] **Step 4: Add the confirm guard**

In `apps/api/src/services/box/confirm.ts`, add the import:

```ts
import { meetsMinTier } from '@ccc/shared/box';
```

Inside the transaction, before the `for (const line of box.items.filter((i) => i.included))` loop, load the member tier once:

```ts
const member = await tx.premiumMembership.findUniqueOrThrow({
  where: { id: args.membershipId },
  select: { tier: true },
});
```

Then, inside that loop, right after `const item = await tx.boxCatalogItem.findUniqueOrThrow(...)`:

```ts
if (!meetsMinTier(member.tier, item.minTier)) {
  await tx.monthlyBoxItem.update({
    where: { id: line.id },
    data: { included: false, droppedAt: new Date(), dropReason: 'tier_restricted' },
  });
  continue;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/box/box-tier-guard.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the confirm suite for regressions**

Run: `cd apps/api && pnpm exec vitest run test/box/box-confirm.test.ts`
Expected: PASS (locate the actual confirm test filename with `ls apps/api/test/box` if it differs; run it).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/box.ts apps/api/src/services/box/confirm.ts apps/api/test/box/box-tier-guard.test.ts
git commit -m "feat(api): guard below-tier items on save and confirm"
```

---

### Task 6: API admin — persist and serialize the two fields

**Files:**

- Modify: `packages/shared/src/admin-box.ts` (`adminBoxCatalogItemSchema` read schema gains the two fields)
- Modify: `apps/api/src/routes/admin/box-catalog-admin.ts` (serialize + create + update)
- Test: `apps/api/test/box/box-catalog-admin.test.ts` (create or extend the existing admin catalog test — locate with `ls apps/api/test/box | grep -i admin`)

**Interfaces:**

- Consumes: Task 3 create/update schemas; Task 1 Prisma fields.
- Produces: admin read schema requires `minTier: GaragePremiumTier | null` and `restrictedDisplay: 'locked' | 'hidden'`; POST/PATCH persist them.

- [ ] **Step 1: Write the failing test**

Create/extend an admin catalog API test. Mirror the harness of an existing admin box test (`ls apps/api/test/box`, look for a fulfillment/admin one for the auth/seed pattern). Assert:

```ts
// POST creates with tier gating
const created = await post('/admin/box/catalog-items', {
  slug: 'gold-item',
  title: 'Gold',
  description: 'x',
  priceCents: 5000,
  category: 'premium',
  minTier: 'gold',
  restrictedDisplay: 'hidden',
});
expect(created.minTier).toBe('gold');
expect(created.restrictedDisplay).toBe('hidden');

// PATCH clears the restriction
const patched = await patch(`/admin/box/catalog-items/${created.id}`, { minTier: null });
expect(patched.minTier).toBe(null);

// GET list echoes the fields
const list = await get('/admin/box/catalog-items');
expect(list.items.find((i) => i.id === created.id)?.restrictedDisplay).toBe('hidden');
```

(Use whatever authed request helpers the sibling admin test uses.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/box/box-catalog-admin.test.ts`
Expected: FAIL — fields missing from response / not persisted.

- [ ] **Step 3: Add the read-schema fields**

In `packages/shared/src/admin-box.ts`, add to `adminBoxCatalogItemSchema` (the read schema, ~line 19):

```ts
  minTier: garagePremiumTierSchema.nullable(),
  restrictedDisplay: z.enum(['locked', 'hidden']),
```

(The `garagePremiumTierSchema` import was added in Task 3.)

- [ ] **Step 4: Serialize the fields**

In `apps/api/src/routes/admin/box-catalog-admin.ts`, add to the `serialize` object (after `sortOrder`):

```ts
  minTier: row.minTier,
  restrictedDisplay: row.restrictedDisplay,
```

- [ ] **Step 5: Persist on create**

In the POST handler's `prisma.boxCatalogItem.create({ data: { ... } })`, add:

```ts
          minTier: input.minTier ?? null,
          restrictedDisplay: input.restrictedDisplay ?? 'locked',
```

- [ ] **Step 6: Persist on update**

In the PATCH handler, after the existing `if (input.sortOrder !== undefined) ...` lines:

```ts
if (input.minTier !== undefined) data.minTier = input.minTier;
if (input.restrictedDisplay !== undefined) data.restrictedDisplay = input.restrictedDisplay;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/box/box-catalog-admin.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/admin-box.ts apps/api/src/routes/admin/box-catalog-admin.ts apps/api/test/box/box-catalog-admin.test.ts
git commit -m "feat(api): admin catalog persists minTier + restrictedDisplay"
```

---

### Task 7: Admin UI — form controls + list badge

**Files:**

- Modify: `apps/admin/src/lib/box-admin-actions.ts` (parse two fields in create + update)
- Modify: `apps/admin/app/(authed)/box/catalogo/box-catalog-client.tsx` (form controls + badge)
- Test: `apps/admin/src/lib/box-admin-actions.test.ts` (extend)

**Interfaces:**

- Consumes: Task 3 create/update schemas; Task 6 read schema (`item.minTier`, `item.restrictedDisplay` on `AdminBoxCatalogList['items'][number]`).
- Produces: admin can set/clear `minTier` and pick `restrictedDisplay` per item.

- [ ] **Step 1: Write the failing test**

In `apps/admin/src/lib/box-admin-actions.test.ts`, add a case that builds a `FormData` with `minTier=silver` and `restrictedDisplay=hidden` and asserts the action forwards them to the (mocked) `createBoxCatalogItem`. Follow the existing mock setup in that file. Core assertion:

```ts
expect(createBoxCatalogItem).toHaveBeenCalledWith(
  expect.objectContaining({ minTier: 'silver', restrictedDisplay: 'hidden' }),
);
```

Add a second case: `minTier` empty string parses to `null` (option "Todos").

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/admin && pnpm exec vitest run src/lib/box-admin-actions.test.ts`
Expected: FAIL — the action doesn't read `minTier`/`restrictedDisplay`.

- [ ] **Step 3: Parse the fields in the actions**

In `apps/admin/src/lib/box-admin-actions.ts`, add a small helper near `str`/`num`/`bool`:

```ts
const tier = (fd: FormData, key: string): 'bronze' | 'silver' | 'gold' | null => {
  const v = fd.get(key);
  return v === 'bronze' || v === 'silver' || v === 'gold' ? v : null;
};
const display = (fd: FormData, key: string): 'locked' | 'hidden' | undefined => {
  const v = fd.get(key);
  return v === 'locked' || v === 'hidden' ? v : undefined;
};
```

Add to the `safeParse({ ... })` object in BOTH `createBoxCatalogItemAction` and `updateBoxCatalogItemAction`:

```ts
    minTier: tier(fd, 'minTier'),
    restrictedDisplay: display(fd, 'restrictedDisplay'),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/admin && pnpm exec vitest run src/lib/box-admin-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the form controls**

In `apps/admin/app/(authed)/box/catalogo/box-catalog-client.tsx`, add to BOTH `CreateForm` and `ItemRow`'s form (near the "Ordem" field). For `CreateForm` (no defaults):

```tsx
      <label className={labelCls}>
        Nível mínimo
        <select name="minTier" defaultValue="" className={inputCls}>
          <option value="">Todos</option>
          <option value="bronze">Bronze</option>
          <option value="silver">Silver</option>
          <option value="gold">Gold</option>
        </select>
      </label>
      <label className={labelCls}>
        Para níveis abaixo
        <select name="restrictedDisplay" defaultValue="locked" className={inputCls}>
          <option value="locked">Bloquear</option>
          <option value="hidden">Ocultar</option>
        </select>
      </label>
```

For `ItemRow`, the same two controls but seeded from the item:

```tsx
      <label className={labelCls}>
        Nível mínimo
        <select name="minTier" defaultValue={item.minTier ?? ''} className={inputCls}>
          <option value="">Todos</option>
          <option value="bronze">Bronze</option>
          <option value="silver">Silver</option>
          <option value="gold">Gold</option>
        </select>
      </label>
      <label className={labelCls}>
        Para níveis abaixo
        <select
          name="restrictedDisplay"
          defaultValue={item.restrictedDisplay}
          className={inputCls}
        >
          <option value="locked">Bloquear</option>
          <option value="hidden">Ocultar</option>
        </select>
      </label>
```

- [ ] **Step 6: Add the list badge**

In `ItemRow`, next to the `item.slug` span, show the tier when set:

```tsx
{
  item.minTier ? (
    <span className="rounded bg-[color:var(--color-accent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase">
      {item.minTier}+
    </span>
  ) : null;
}
```

- [ ] **Step 7: Typecheck the admin app**

Run: `pnpm --filter @ccc/admin exec tsc --noEmit`
Expected: no type errors (the `AdminBoxCatalogList` item type now carries `minTier`/`restrictedDisplay` from Task 6).

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/lib/box-admin-actions.ts apps/admin/src/lib/box-admin-actions.test.ts "apps/admin/app/(authed)/box/catalogo/box-catalog-client.tsx"
git commit -m "feat(admin): tier-gating controls on the box catalog form"
```

---

### Task 8: Mobile UI — locked catalog card

**Files:**

- Modify: `apps/mobile/src/copy/caixa.ts` (locked badge copy)
- Modify: `apps/mobile/src/screens/caixa/CatalogItemCard.tsx` (locked rendering)
- Test: `apps/mobile/src/screens/caixa/catalog-card-locked.test.ts` (create — pure helper test)

**Interfaces:**

- Consumes: catalog items now carry `locked: boolean` and `minTier: GaragePremiumTier | null` (Task 4).
- Produces: a locked item renders disabled with a "Silver+"/"Gold+" badge and cannot be added.

- [ ] **Step 1: Write the failing test**

The card is a component; test the label helper as a pure function instead of rendering. Create `apps/mobile/src/screens/caixa/catalog-card-locked.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { lockedBadgeLabel } from './CatalogItemCard';

describe('lockedBadgeLabel', () => {
  it('formats the required tier', () => {
    expect(lockedBadgeLabel('silver')).toBe('Silver+');
    expect(lockedBadgeLabel('gold')).toBe('Gold+');
    expect(lockedBadgeLabel('bronze')).toBe('Bronze+');
  });
  it('returns null when no tier', () => {
    expect(lockedBadgeLabel(null)).toBe(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/caixa/catalog-card-locked.test.ts`
Expected: FAIL — `lockedBadgeLabel` not exported.

- [ ] **Step 3: Export the label helper and render the locked card**

In `apps/mobile/src/screens/caixa/CatalogItemCard.tsx`, add the helper (top-level export) and a `Lock` import:

```ts
import { Lock, Plus } from 'lucide-react-native';
import type { GaragePremiumTier } from '@ccc/shared/garage';

export function lockedBadgeLabel(minTier: GaragePremiumTier | null): string | null {
  if (!minTier) return null;
  return `${minTier.charAt(0).toUpperCase()}${minTier.slice(1)}+`;
}
```

Add a copy string in `apps/mobile/src/copy/caixa.ts` under `builder`:

```ts
    lockedTierPrefix: 'Exclusivo',
```

In the card body, before the sold-out / stepper branch, short-circuit for locked items. Right after the image `<View>` block (where `soldOut` overlay is), add a locked overlay+badge, and replace the action area so a locked item shows a disabled pill instead of the Add button. Concretely, wrap the existing action `Pressable`/`QuantityStepper` selection so that when `item.locked` is true it renders:

```tsx
      {item.locked ? (
        <View style={styles.lockedRow}>
          <Lock color={theme.colors.fg} size={14} strokeWidth={2} />
          <Text variant="caption" tone="muted">
            {lockedBadgeLabel(item.minTier)}
          </Text>
        </View>
      ) : item.soldOut ? (
        // ...existing soldOut branch...
      ) : inBox ? (
        // ...existing stepper branch...
      ) : (
        // ...existing add branch...
      )}
```

Add a `locked` visual to the card container style array:

```tsx
        item.locked && styles.cardSoldOut,
```

And the style:

```ts
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    height: 32,
  },
```

A locked item has no `onChange` path wired, so it cannot be added. (The server guard in Task 5 is the real enforcement; this is UX.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/caixa/catalog-card-locked.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck mobile**

Run: `pnpm --filter @ccc/mobile exec tsc --noEmit`
Expected: no type errors (catalog item type now has `locked`/`minTier`).

- [ ] **Step 6: Run the mobile caixa suite for regressions**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/caixa`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/caixa/CatalogItemCard.tsx apps/mobile/src/copy/caixa.ts apps/mobile/src/screens/caixa/catalog-card-locked.test.ts
git commit -m "feat(mobile): locked catalog card for gated box items"
```

---

## Final verification

- [ ] Run the full API box suite: `cd apps/api && pnpm exec vitest run test/box`
- [ ] Run shared + admin + mobile suites: `pnpm --filter @ccc/shared test && pnpm --filter @ccc/admin test && pnpm --filter @ccc/mobile test`
- [ ] Confirm default behavior unchanged: an item with `minTier=null` appears for a bronze member with `locked:false`.
