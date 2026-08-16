# Box Builder Fase 4b — API + Shared Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fulfillment advance flow for monthly boxes (Preparando → Enviado → Entregue) as shared Zod types plus three organizer/admin API endpoints, backed by a race-safe transition service.

**Architecture:** `MonthlyBox.fulfillmentStatus` is the source of truth. A forward-only transition service advances a `ready` box through `unfulfilled → packed → shipped → delivered`, syncing `Order.fulfillmentStatus` in the same transaction when the box has an `orderId`. Three admin routes expose advance, a monthly list with progress counts, and a picking aggregation. Shared package produces the enum, the `BoxView.fulfillmentStatus` field, and the admin request/response schemas the admin-web and mobile plans consume.

**Tech Stack:** TypeScript, Zod (`@ccc/shared`), Prisma (`@ccc/db`), Fastify (`apps/api`), Vitest + Testcontainers (real Postgres).

**Spec:** `docs/superpowers/specs/2026-08-14-box-builder-fase-4b-fulfillment-design.md` (sections 1, 2, 5 are in scope for this plan).

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec and CLAUDE.md.

- **Box fulfillment enum = 5 values:** `unfulfilled, packed, shipped, delivered, cancelled` (spec §Decisoes fechadas). The Prisma `FulfillmentStatus` enum has 8 values; the box only ever uses these 5. Cast Prisma reads to `BoxFulfillmentStatus`.
- **Forward-only transition map:** `unfulfilled → packed → shipped → delivered`. `delivered` and `cancelled` are terminal. No un-advance. Predecessors: `packed←unfulfilled`, `shipped←packed`, `delivered←shipped` (spec §Mapa de transicao).
- **Orders flip to `paid` ONLY from verified provider webhooks — never from client calls (CLAUDE.md load-bearing invariant). This plan MUST NOT touch `Order.status`.** It only writes `Order.fulfillmentStatus`, and only for a box that is already `ready`.
- **Race-safe advance:** conditional `updateMany(where fulfillmentStatus = predecessor)`; a `count === 0` result means someone else moved it — re-read and return `invalid_transition`. Repeated advance to the same target is idempotent in effect (falls into `invalid_transition`, no double write).
- **Integration tests hit a REAL Postgres via Testcontainers — never mocks (CLAUDE.md).** Docker must be running.
- **PT-BR user-facing copy with accents.** API error `code` strings stay machine-readable ASCII (`box_not_found`, `box_not_ready`, `invalid_transition`); no user-facing PT-BR copy is produced by this plan (that lives in admin-web/mobile plans).
- **Auth scope = organizer/admin (Fase 1 box convention).** Staff are rejected (403), unauthenticated is 401. Register alongside the existing `adminBoxCatalogRoutes` block in `apps/api/src/routes/admin/index.ts`.
- **Worktree build order:** after any change under `packages/shared`, rebuild before API tests can resolve the new runtime exports: `pnpm --filter @ccc/db --filter @ccc/shared --filter @ccc/design build`. Run `pnpm exec prettier --write` on changed files before committing (git hooks do not fire in a worktree).

---

### Task 1: Shared — box fulfillment enum + `BoxView.fulfillmentStatus`

**Files:**

- Modify: `packages/shared/src/box.ts`
- Test: `packages/shared/src/__tests__/box.test.ts`

**Interfaces:**

- Consumes: nothing (leaf task).
- Produces:
  - `boxFulfillmentStatusSchema: z.ZodEnum<['unfulfilled','packed','shipped','delivered','cancelled']>`
  - `type BoxFulfillmentStatus = z.infer<typeof boxFulfillmentStatusSchema>`
  - `boxViewSchema` gains a **required** field `fulfillmentStatus: boxFulfillmentStatusSchema` (no default — per spec §2 "boxViewSchema ganha: fulfillmentStatus"). `boxStatusSchema` / `BoxStatus` already exist and are re-used by Task 2.

- [ ] **Step 1: Update the three existing box-view fixtures in the test to carry the new field, and add an enum test**

In `packages/shared/src/__tests__/box.test.ts`, add `fulfillmentStatus: 'unfulfilled',` to each of the three objects passed to `boxViewSchema.parse(...)` (the `view` literal on line ~12, the inline object on line ~55, and the inline object on line ~77). Then append this test inside the `describe('box shared schemas', ...)` block:

```ts
it('exposes the 5-value box fulfillment enum and requires it on the view', () => {
  expect(boxFulfillmentStatusSchema.options).toEqual([
    'unfulfilled',
    'packed',
    'shipped',
    'delivered',
    'cancelled',
  ]);
  const missing = {
    id: 'box_1',
    status: 'ready',
    cycleKey: '2026-08-01',
    cutoffAt: '2026-08-27T00:00:00.000Z',
    budgetCents: 10000,
    currency: 'BRL',
    itemsTotalCents: 0,
    partnersTotalCents: 0,
    overflowCents: 0,
    shippingCents: 0,
    chargeCents: 0,
    orderId: null,
    autoSendOptIn: false,
    shippingAddressId: null,
    items: [],
    partnerItems: [],
  };
  expect(() => boxViewSchema.parse(missing)).toThrow();
});
```

Add `boxFulfillmentStatusSchema` to the import from `../box.js` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/box.test.ts`
Expected: FAIL — `boxFulfillmentStatusSchema` is not exported (import error / undefined).

- [ ] **Step 3: Add the enum and the view field in `box.ts`**

In `packages/shared/src/box.ts`, immediately after the `boxStatusSchema` / `BoxStatus` block (line ~12), add:

```ts
export const boxFulfillmentStatusSchema = z.enum([
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
]);
export type BoxFulfillmentStatus = z.infer<typeof boxFulfillmentStatusSchema>;
```

Then in `boxViewSchema` add the field (place it right after `status: boxStatusSchema,`):

```ts
  fulfillmentStatus: boxFulfillmentStatusSchema,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/box.test.ts`
Expected: PASS (all box schema tests green).

- [ ] **Step 5: Commit**

```bash
cd /Users/pedro/Projects/ccc/ccc-app/.worktrees/box-builder-fase-4b
pnpm exec prettier --write packages/shared/src/box.ts packages/shared/src/__tests__/box.test.ts
git add packages/shared/src/box.ts packages/shared/src/__tests__/box.test.ts
git commit -m "feat(shared): box fulfillment enum + BoxView.fulfillmentStatus"
```

> **Cross-plan note (not a task):** making `fulfillmentStatus` required means any mobile box-view fixture that does not yet carry the field will fail to parse until the mobile plan updates it. That is expected and sequenced by the branch coordinator; do not add a default to work around it.

---

### Task 2: Shared — admin-box fulfillment schemas

**Files:**

- Modify: `packages/shared/src/admin-box.ts`
- Test: `packages/shared/src/__tests__/admin-box.test.ts`

**Interfaces:**

- Consumes (Task 1): `boxFulfillmentStatusSchema`, `boxStatusSchema` from `./box.js`.
- Produces (exact names the API route + services and the admin-web plan depend on):
  - `boxAdvanceTargetSchema: z.ZodEnum<['packed','shipped','delivered']>`
  - `adminBoxAdvanceRequestSchema = z.object({ to: boxAdvanceTargetSchema })`; `type AdminBoxAdvanceRequest`
  - `adminBoxMonthlyQuerySchema = z.object({ cycleKey: z.string().optional() })`; `type AdminBoxMonthlyQuery`
  - `boxFulfillmentCountsSchema` — object with the 5 keys, each `z.number().int().nonnegative()`
  - `adminBoxRowSchema`; `type BoxAdminRow` (spec §2 names the type `BoxAdminRow`)
  - `adminBoxMonthlyListResponseSchema = z.object({ cycleKey, availableCycles, counts, boxes })`; `type AdminBoxMonthlyListResponse`
  - `boxPickingRowSchema`; `type PickingRow` (spec §2 names the type `PickingRow`)
  - `adminBoxPickingResponseSchema = z.object({ cycleKey, items, partnerItems })`; `type AdminBoxPickingResponse`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/__tests__/admin-box.test.ts`:

```ts
import {
  adminBoxAdvanceRequestSchema,
  adminBoxMonthlyListResponseSchema,
  adminBoxPickingResponseSchema,
  boxPickingRowSchema,
} from '../admin-box.js';

describe('admin-box fulfillment schemas', () => {
  it('accepts a valid advance request and rejects unfulfilled/cancelled targets', () => {
    expect(adminBoxAdvanceRequestSchema.safeParse({ to: 'packed' }).success).toBe(true);
    expect(adminBoxAdvanceRequestSchema.safeParse({ to: 'unfulfilled' }).success).toBe(false);
    expect(adminBoxAdvanceRequestSchema.safeParse({ to: 'cancelled' }).success).toBe(false);
  });

  it('parses a full monthly list response', () => {
    const parsed = adminBoxMonthlyListResponseSchema.parse({
      cycleKey: '2026-08-01',
      availableCycles: ['2026-08-01', '2026-07-01'],
      counts: { unfulfilled: 1, packed: 0, shipped: 0, delivered: 0, cancelled: 0 },
      boxes: [
        {
          id: 'box_1',
          memberName: 'Fulano',
          memberEmail: 'fulano@jdm.test',
          status: 'ready',
          chargeCents: 0,
          currency: 'BRL',
          fulfillmentStatus: 'unfulfilled',
          orderStatus: null,
        },
      ],
    });
    expect(parsed.boxes[0]!.orderStatus).toBeNull();
    expect(parsed.counts.unfulfilled).toBe(1);
  });

  it('parses a picking response with item and partner rows', () => {
    const row = boxPickingRowSchema.parse({
      refId: 'ci_1',
      title: 'Adesivo',
      totalQuantity: 4,
      boxCount: 2,
    });
    expect(row.boxCount).toBe(2);
    const parsed = adminBoxPickingResponseSchema.parse({
      cycleKey: '2026-08-01',
      items: [row],
      partnerItems: [],
    });
    expect(parsed.items).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/admin-box.test.ts`
Expected: FAIL — the new schemas are not exported.

- [ ] **Step 3: Add the schemas to `admin-box.ts`**

At the top of `packages/shared/src/admin-box.ts`, add imports below the existing `import { z } from 'zod';`:

```ts
import { boxFulfillmentStatusSchema, boxStatusSchema } from './box.js';
import { orderStatusSchema } from './orders.js';
```

Append at the end of the file:

```ts
// ----- Box fulfillment (Fase 4b) -----

export const boxAdvanceTargetSchema = z.enum(['packed', 'shipped', 'delivered']);
export type BoxAdvanceTarget = z.infer<typeof boxAdvanceTargetSchema>;

export const adminBoxAdvanceRequestSchema = z.object({ to: boxAdvanceTargetSchema });
export type AdminBoxAdvanceRequest = z.infer<typeof adminBoxAdvanceRequestSchema>;

export const adminBoxMonthlyQuerySchema = z.object({
  cycleKey: z.string().trim().min(1).max(10).optional(),
});
export type AdminBoxMonthlyQuery = z.infer<typeof adminBoxMonthlyQuerySchema>;

export const boxFulfillmentCountsSchema = z.object({
  unfulfilled: z.number().int().nonnegative(),
  packed: z.number().int().nonnegative(),
  shipped: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});
export type BoxFulfillmentCounts = z.infer<typeof boxFulfillmentCountsSchema>;

export const adminBoxRowSchema = z.object({
  id: z.string(),
  memberName: z.string(),
  memberEmail: z.string(),
  status: boxStatusSchema,
  chargeCents: z.number().int(),
  currency: z.string(),
  fulfillmentStatus: boxFulfillmentStatusSchema,
  orderStatus: orderStatusSchema.nullable(),
});
export type BoxAdminRow = z.infer<typeof adminBoxRowSchema>;

export const adminBoxMonthlyListResponseSchema = z.object({
  cycleKey: z.string(),
  availableCycles: z.array(z.string()),
  counts: boxFulfillmentCountsSchema,
  boxes: z.array(adminBoxRowSchema),
});
export type AdminBoxMonthlyListResponse = z.infer<typeof adminBoxMonthlyListResponseSchema>;

export const boxPickingRowSchema = z.object({
  refId: z.string(),
  title: z.string(),
  totalQuantity: z.number().int(),
  boxCount: z.number().int(),
});
export type PickingRow = z.infer<typeof boxPickingRowSchema>;

export const adminBoxPickingResponseSchema = z.object({
  cycleKey: z.string(),
  items: z.array(boxPickingRowSchema),
  partnerItems: z.array(boxPickingRowSchema),
});
export type AdminBoxPickingResponse = z.infer<typeof adminBoxPickingResponseSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/shared && pnpm exec vitest run src/__tests__/admin-box.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild shared packages so the API can resolve the new runtime exports**

Run: `cd /Users/pedro/Projects/ccc/ccc-app/.worktrees/box-builder-fase-4b && pnpm --filter @ccc/db --filter @ccc/shared --filter @ccc/design build`
Expected: build succeeds. (Required before any API task below — `apps/api` imports `@ccc/shared/*` at runtime from `dist`.)

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/shared/src/admin-box.ts packages/shared/src/__tests__/admin-box.test.ts
git add packages/shared/src/admin-box.ts packages/shared/src/__tests__/admin-box.test.ts
git commit -m "feat(shared): admin-box fulfillment advance/list/picking schemas"
```

---

### Task 3: API — serialize emits `fulfillmentStatus`

**Files:**

- Modify: `apps/api/src/services/box/serialize.ts`
- Test: `apps/api/test/box/box-get.test.ts` (add one assertion)

**Interfaces:**

- Consumes (Task 1): `type BoxFulfillmentStatus` from `@ccc/shared/box`.
- Produces: `serializeBox(box, uploads)` now returns a `BoxView` including `fulfillmentStatus: box.fulfillmentStatus as BoxFulfillmentStatus`. No signature change.

- [ ] **Step 1: Add a failing assertion to the existing box-get test**

Open `apps/api/test/box/box-get.test.ts`, find the assertion block for the successful GET response, and add (adjust the response variable name to match the file — it parses `boxViewSchema` on the JSON body):

```ts
expect(body.fulfillmentStatus).toBe('unfulfilled');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run test/box/box-get.test.ts`
Expected: FAIL — `boxViewSchema.parse` throws on the missing `fulfillmentStatus` (serialize does not emit it yet), or the new assertion is `undefined`.

- [ ] **Step 3: Emit the field in serialize**

In `apps/api/src/services/box/serialize.ts`, add the import:

```ts
import type { BoxFulfillmentStatus, BoxView } from '@ccc/shared/box';
```

(Replace the existing `import type { BoxView } from '@ccc/shared/box';` line.) Then in the returned object, add the field right after `status: box.status,`:

```ts
  fulfillmentStatus: box.fulfillmentStatus as BoxFulfillmentStatus,
```

The cast is safe: `box.fulfillmentStatus` is the Prisma 8-value `FulfillmentStatus`, but a box only ever holds one of the 5 box values.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run test/box/box-get.test.ts`
Expected: PASS.

- [ ] **Step 5: Guard against regressions in the other serialize-backed box tests**

Run: `cd apps/api && pnpm exec vitest run test/box/box-view-enrichment.test.ts test/box/box-confirm.test.ts`
Expected: PASS — the field is additive and serialize now emits it, so `boxViewSchema.parse` in those tests stays green.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/api/src/services/box/serialize.ts apps/api/test/box/box-get.test.ts
git add apps/api/src/services/box/serialize.ts apps/api/test/box/box-get.test.ts
git commit -m "feat(api): serialize box fulfillmentStatus into BoxView"
```

---

### Task 4: API — advance service + POST route + register plugin

**Files:**

- Create: `apps/api/src/services/box/fulfillment.ts`
- Create: `apps/api/src/routes/admin/box-fulfillment-admin.ts`
- Modify: `apps/api/src/routes/admin/index.ts`
- Test: `apps/api/test/box/box-fulfillment.test.ts` (new)

**Interfaces:**

- Consumes (Tasks 1–2): `BoxFulfillmentStatus` from `@ccc/shared/box`; `adminBoxAdvanceRequestSchema` from `@ccc/shared/admin-box`.
- Produces (Tasks 5–6 add more functions to the same service file, and more handlers to the same route file):
  - `type BoxAdvanceInput = { boxId: string; to: 'packed' | 'shipped' | 'delivered' }`
  - `type BoxAdvanceResult = { kind: 'ok'; fulfillmentStatus: BoxFulfillmentStatus } | { kind: 'not_found' } | { kind: 'not_ready' } | { kind: 'invalid_transition'; from: BoxFulfillmentStatus; to: string }`
  - `advanceBoxFulfillment(input: BoxAdvanceInput): Promise<BoxAdvanceResult>`
  - `adminBoxFulfillmentRoutes: FastifyPluginAsync` exposing `POST /box/monthly/:id/fulfillment` (reached at `/admin/box/monthly/:id/fulfillment`). Success body `{ id, fulfillmentStatus }`. Errors: 404 `{ error:'NotFound', code:'box_not_found' }`, 409 `{ error:'Conflict', code:'box_not_ready' }`, 409 `{ error:'Conflict', code:'invalid_transition', from, to }`.

- [ ] **Step 1: Write the failing route tests**

Create `apps/api/test/box/box-fulfillment.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const orgAuth = async () => {
  const { user } = await createUser({
    email: `org-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
    verified: true,
    role: 'organizer',
  });
  return { user, header: bearer(env, user.id, 'organizer') };
};

// Seeds a premium member with one MonthlyBox. Pass withOrder to attach a paid
// box Order so the advance path exercises the Order sync branch.
const seedBox = async (opts: {
  cycleKey?: string;
  status?: 'open' | 'awaiting_payment' | 'ready' | 'skipped' | 'cancelled';
  fulfillmentStatus?: 'unfulfilled' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
  withOrder?: boolean;
  memberName?: string;
  memberEmail?: string;
  chargeCents?: number;
}) => {
  const cycleKey = opts.cycleKey ?? '2026-08-01';
  const { user } = await createUser({
    email: opts.memberEmail ?? `member-${Math.random().toString(36).slice(2, 8)}@jdm.test`,
    name: opts.memberName ?? 'Fulano',
    verified: true,
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: `sub_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date(`${cycleKey}T00:00:00.000Z`),
      currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  let orderId: string | null = null;
  if (opts.withOrder) {
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        kind: 'box',
        amountCents: opts.chargeCents ?? 2000,
        baseAmountCents: opts.chargeCents ?? 2000,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        currency: 'BRL',
        method: 'pix',
        provider: 'abacatepay',
        status: 'paid',
        paidAt: new Date(),
        shippingCents: 0,
        fulfillmentStatus: opts.fulfillmentStatus ?? 'unfulfilled',
      },
    });
    orderId = order.id;
  }
  const box = await prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: garage.id,
      cycleKey,
      cycleStart: membership.currentPeriodStart,
      cycleEnd: membership.currentPeriodEnd,
      cutoffAt: new Date('2026-08-26T00:00:00.000Z'),
      budgetCentsSnapshot: 10000,
      status: opts.status ?? 'ready',
      fulfillmentStatus: opts.fulfillmentStatus ?? 'unfulfilled',
      orderId,
      chargeCents: opts.chargeCents ?? 0,
    },
  });
  return { user, membership, box, orderId };
};

const advance = (app: FastifyInstance, header: string, boxId: string, to: string) =>
  app.inject({
    method: 'POST',
    url: `/admin/box/monthly/${boxId}/fulfillment`,
    headers: { authorization: header, 'content-type': 'application/json' },
    payload: { to },
  });

describe('POST /admin/box/monthly/:id/fulfillment', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('advances an Order-backed box and syncs the Order in the same transaction', async () => {
    const { box, orderId } = await seedBox({ withOrder: true, fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();

    const r1 = await advance(app, header, box.id, 'packed');
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ id: box.id, fulfillmentStatus: 'packed' });
    let freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    let freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId! } });
    expect(freshBox.fulfillmentStatus).toBe('packed');
    expect(freshOrder.fulfillmentStatus).toBe('packed');
    // Order.status must never be touched by advance.
    expect(freshOrder.status).toBe('paid');

    expect((await advance(app, header, box.id, 'shipped')).statusCode).toBe(200);
    expect((await advance(app, header, box.id, 'delivered')).statusCode).toBe(200);
    freshBox = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId! } });
    expect(freshBox.fulfillmentStatus).toBe('delivered');
    expect(freshOrder.fulfillmentStatus).toBe('delivered');
  });

  it('advances a budget-only box (no Order)', async () => {
    const { box } = await seedBox({ withOrder: false, fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    const res = await advance(app, header, box.id, 'packed');
    expect(res.statusCode).toBe(200);
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.fulfillmentStatus).toBe('packed');
    expect(fresh.orderId).toBeNull();
  });

  it('rejects advancing a box that is not ready (409 box_not_ready)', async () => {
    const { box } = await seedBox({ status: 'awaiting_payment', fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    const res = await advance(app, header, box.id, 'packed');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'box_not_ready' });
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    expect(fresh.fulfillmentStatus).toBe('unfulfilled');
  });

  it('rejects a skip-ahead transition (409 invalid_transition)', async () => {
    const { box } = await seedBox({ fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    const res = await advance(app, header, box.id, 'delivered');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'invalid_transition',
      from: 'unfulfilled',
      to: 'delivered',
    });
  });

  it('is idempotent: a second advance to the same target returns 409 invalid_transition and does not double-write', async () => {
    const { box, orderId } = await seedBox({ withOrder: true, fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    expect((await advance(app, header, box.id, 'packed')).statusCode).toBe(200);
    const res = await advance(app, header, box.id, 'packed');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'invalid_transition', from: 'packed', to: 'packed' });
    const fresh = await prisma.monthlyBox.findUniqueOrThrow({ where: { id: box.id } });
    const freshOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId! } });
    expect(fresh.fulfillmentStatus).toBe('packed');
    expect(freshOrder.fulfillmentStatus).toBe('packed');
  });

  it('returns 404 box_not_found for an unknown box id', async () => {
    const { header } = await orgAuth();
    const res = await advance(app, header, 'box_missing', 'packed');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'box_not_found' });
  });

  it('rejects staff role (403) and unauthenticated (401)', async () => {
    const { box } = await seedBox({ fulfillmentStatus: 'unfulfilled' });
    const { user: staff } = await createUser({
      email: 'staff@jdm.test',
      verified: true,
      role: 'staff',
    });
    const staffRes = await advance(app, bearer(env, staff.id, 'staff'), box.id, 'packed');
    expect(staffRes.statusCode).toBe(403);
    const anonRes = await app.inject({
      method: 'POST',
      url: `/admin/box/monthly/${box.id}/fulfillment`,
      headers: { 'content-type': 'application/json' },
      payload: { to: 'packed' },
    });
    expect(anonRes.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && pnpm exec vitest run test/box/box-fulfillment.test.ts`
Expected: FAIL — route `/admin/box/monthly/:id/fulfillment` returns 404 (not registered).

- [ ] **Step 3: Create the advance service**

Create `apps/api/src/services/box/fulfillment.ts`:

```ts
import { prisma } from '@ccc/db';
import type { BoxFulfillmentStatus } from '@ccc/shared/box';

// Forward-only. delivered/cancelled are terminal. Predecessor of each target.
const PREDECESSOR: Record<'packed' | 'shipped' | 'delivered', BoxFulfillmentStatus> = {
  packed: 'unfulfilled',
  shipped: 'packed',
  delivered: 'shipped',
};

export type BoxAdvanceInput = { boxId: string; to: 'packed' | 'shipped' | 'delivered' };
export type BoxAdvanceResult =
  | { kind: 'ok'; fulfillmentStatus: BoxFulfillmentStatus }
  | { kind: 'not_found' }
  | { kind: 'not_ready' }
  | { kind: 'invalid_transition'; from: BoxFulfillmentStatus; to: string };

export const advanceBoxFulfillment = async (input: BoxAdvanceInput): Promise<BoxAdvanceResult> => {
  const box = await prisma.monthlyBox.findUnique({
    where: { id: input.boxId },
    select: { id: true, status: true, fulfillmentStatus: true, orderId: true },
  });
  if (!box) return { kind: 'not_found' };
  if (box.status !== 'ready') return { kind: 'not_ready' };

  const from = box.fulfillmentStatus as BoxFulfillmentStatus;
  const predecessor = PREDECESSOR[input.to];
  if (from !== predecessor) {
    return { kind: 'invalid_transition', from, to: input.to };
  }

  // Race-safe: only the caller that still sees `predecessor` wins. Sync the
  // Order in the same transaction when the box is Order-backed. Never touch
  // Order.status — that flips to paid only from a verified webhook.
  const advanced = await prisma.$transaction(async (tx) => {
    const updated = await tx.monthlyBox.updateMany({
      where: { id: box.id, status: 'ready', fulfillmentStatus: predecessor },
      data: { fulfillmentStatus: input.to },
    });
    if (updated.count === 0) return false;
    if (box.orderId) {
      await tx.order.update({
        where: { id: box.orderId },
        data: { fulfillmentStatus: input.to },
      });
    }
    return true;
  });

  if (!advanced) {
    const fresh = await prisma.monthlyBox.findUnique({
      where: { id: box.id },
      select: { fulfillmentStatus: true },
    });
    return {
      kind: 'invalid_transition',
      from: (fresh?.fulfillmentStatus ?? from) as BoxFulfillmentStatus,
      to: input.to,
    };
  }
  return { kind: 'ok', fulfillmentStatus: input.to };
};
```

- [ ] **Step 4: Create the route plugin**

Create `apps/api/src/routes/admin/box-fulfillment-admin.ts`:

```ts
import { adminBoxAdvanceRequestSchema } from '@ccc/shared/admin-box';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { advanceBoxFulfillment } from '../../services/box/fulfillment.js';

const paramsSchema = z.object({ id: z.string().min(1) });

// eslint-disable-next-line @typescript-eslint/require-await
export const adminBoxFulfillmentRoutes: FastifyPluginAsync = async (app) => {
  app.post('/box/monthly/:id/fulfillment', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const body = adminBoxAdvanceRequestSchema.parse(request.body);
    const result = await advanceBoxFulfillment({ boxId: id, to: body.to });
    switch (result.kind) {
      case 'ok':
        return reply.send({ id, fulfillmentStatus: result.fulfillmentStatus });
      case 'not_found':
        return reply.code(404).send({ error: 'NotFound', code: 'box_not_found' });
      case 'not_ready':
        return reply.code(409).send({ error: 'Conflict', code: 'box_not_ready' });
      case 'invalid_transition':
        return reply.code(409).send({
          error: 'Conflict',
          code: 'invalid_transition',
          from: result.from,
          to: result.to,
        });
    }
  });
};
```

- [ ] **Step 5: Register the plugin in the organizer/admin scope**

In `apps/api/src/routes/admin/index.ts`, add the import next to the other box imports (after line ~21):

```ts
import { adminBoxFulfillmentRoutes } from './box-fulfillment-admin.js';
```

Then inside the `requireRole('organizer', 'admin')` register block, next to the existing box registrations (after `await scope.register(adminBoxSettingsRoutes);`):

```ts
await scope.register(adminBoxFulfillmentRoutes);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm exec vitest run test/box/box-fulfillment.test.ts`
Expected: PASS (all 7 `describe` cases).

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write apps/api/src/services/box/fulfillment.ts apps/api/src/routes/admin/box-fulfillment-admin.ts apps/api/src/routes/admin/index.ts apps/api/test/box/box-fulfillment.test.ts
git add apps/api/src/services/box/fulfillment.ts apps/api/src/routes/admin/box-fulfillment-admin.ts apps/api/src/routes/admin/index.ts apps/api/test/box/box-fulfillment.test.ts
git commit -m "feat(api): box fulfillment advance service + admin route"
```

---

### Task 5: API — monthly list + progress counts endpoint

**Files:**

- Modify: `apps/api/src/services/box/fulfillment.ts`
- Modify: `apps/api/src/routes/admin/box-fulfillment-admin.ts`
- Test: `apps/api/test/box/box-fulfillment.test.ts` (add a `describe` block)

**Interfaces:**

- Consumes (Task 2): `AdminBoxMonthlyListResponse`, `adminBoxMonthlyQuerySchema`, `adminBoxMonthlyListResponseSchema` from `@ccc/shared/admin-box`; `BoxFulfillmentStatus` from `@ccc/shared/box`. Reuses the `seedBox` helper from Task 4.
- Produces:
  - `listAdminBoxes(cycleKeyInput?: string): Promise<AdminBoxMonthlyListResponse>`
  - `GET /box/monthly` handler in the existing route plugin. Default `cycleKey` = latest (max) cycleKey present in `MonthlyBox`; `availableCycles` = distinct cycleKeys desc; `counts` = tally over `ready` boxes only; `boxes` = all boxes of the cycle (member name/email from `membership.garage.user`).

- [ ] **Step 1: Add the failing list tests**

Append a new `describe` block to `apps/api/test/box/box-fulfillment.test.ts` (reuse the top-level `app`, `orgAuth`, `seedBox`, and add the import):

```ts
import { adminBoxMonthlyListResponseSchema } from '@ccc/shared/admin-box';

describe('GET /admin/box/monthly', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('defaults to the latest cycle, lists all its boxes, and counts only ready boxes', async () => {
    // Older cycle — must not be the default and its boxes must not appear.
    await seedBox({ cycleKey: '2026-07-01', status: 'ready', fulfillmentStatus: 'delivered' });
    // Target cycle: two ready (counted) + one open + one skipped (listed, not counted).
    await seedBox({ cycleKey: '2026-08-01', status: 'ready', fulfillmentStatus: 'unfulfilled' });
    await seedBox({ cycleKey: '2026-08-01', status: 'ready', fulfillmentStatus: 'packed' });
    await seedBox({ cycleKey: '2026-08-01', status: 'open', fulfillmentStatus: 'unfulfilled' });
    await seedBox({ cycleKey: '2026-08-01', status: 'skipped', fulfillmentStatus: 'unfulfilled' });

    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/monthly',
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(200);
    const body = adminBoxMonthlyListResponseSchema.parse(res.json());
    expect(body.cycleKey).toBe('2026-08-01');
    expect(body.availableCycles).toEqual(['2026-08-01', '2026-07-01']);
    expect(body.boxes).toHaveLength(4); // all 2026-08-01 boxes, open/skipped included
    expect(body.counts.unfulfilled).toBe(1); // only the ready+unfulfilled box
    expect(body.counts.packed).toBe(1);
    expect(body.counts.shipped).toBe(0);
    const row = body.boxes.find((b) => b.status === 'ready' && b.fulfillmentStatus === 'packed');
    expect(row?.memberEmail).toContain('@jdm.test');
    expect(row?.orderStatus).toBeNull();
  });

  it('honours an explicit cycleKey query', async () => {
    await seedBox({ cycleKey: '2026-07-01', status: 'ready', fulfillmentStatus: 'shipped' });
    await seedBox({ cycleKey: '2026-08-01', status: 'ready', fulfillmentStatus: 'unfulfilled' });
    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/monthly?cycleKey=2026-07-01',
      headers: { authorization: header },
    });
    const body = adminBoxMonthlyListResponseSchema.parse(res.json());
    expect(body.cycleKey).toBe('2026-07-01');
    expect(body.counts.shipped).toBe(1);
    expect(body.boxes).toHaveLength(1);
  });

  it('reflects orderStatus for Order-backed boxes', async () => {
    await seedBox({
      cycleKey: '2026-08-01',
      status: 'ready',
      fulfillmentStatus: 'unfulfilled',
      withOrder: true,
      chargeCents: 2000,
    });
    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/monthly',
      headers: { authorization: header },
    });
    const body = adminBoxMonthlyListResponseSchema.parse(res.json());
    expect(body.boxes[0]!.orderStatus).toBe('paid');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && pnpm exec vitest run test/box/box-fulfillment.test.ts`
Expected: FAIL — `GET /admin/box/monthly` returns 404 (handler not added).

- [ ] **Step 3: Add the list service**

Append to `apps/api/src/services/box/fulfillment.ts`. First extend the imports:

```ts
import type { AdminBoxMonthlyListResponse } from '@ccc/shared/admin-box';
```

Then add:

```ts
const EMPTY_COUNTS = (): AdminBoxMonthlyListResponse['counts'] => ({
  unfulfilled: 0,
  packed: 0,
  shipped: 0,
  delivered: 0,
  cancelled: 0,
});

const distinctCyclesDesc = async (): Promise<string[]> => {
  const rows = await prisma.monthlyBox.findMany({
    distinct: ['cycleKey'],
    select: { cycleKey: true },
    orderBy: { cycleKey: 'desc' },
  });
  return rows.map((r) => r.cycleKey);
};

export const listAdminBoxes = async (
  cycleKeyInput?: string,
): Promise<AdminBoxMonthlyListResponse> => {
  const availableCycles = await distinctCyclesDesc();
  const cycleKey = cycleKeyInput ?? availableCycles[0] ?? '';

  const rows = await prisma.monthlyBox.findMany({
    where: { cycleKey },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      chargeCents: true,
      currency: true,
      fulfillmentStatus: true,
      order: { select: { status: true } },
      membership: {
        select: { garage: { select: { user: { select: { name: true, email: true } } } } },
      },
    },
  });

  const counts = EMPTY_COUNTS();
  const boxes = rows.map((b) => {
    const fulfillmentStatus = b.fulfillmentStatus as BoxFulfillmentStatus;
    if (b.status === 'ready') counts[fulfillmentStatus] += 1;
    return {
      id: b.id,
      memberName: b.membership.garage.user.name,
      memberEmail: b.membership.garage.user.email,
      status: b.status,
      chargeCents: b.chargeCents,
      currency: b.currency,
      fulfillmentStatus,
      orderStatus: b.order?.status ?? null,
    };
  });

  return { cycleKey, availableCycles, counts, boxes };
};
```

- [ ] **Step 4: Add the GET handler**

In `apps/api/src/routes/admin/box-fulfillment-admin.ts`, extend the imports:

```ts
import {
  adminBoxAdvanceRequestSchema,
  adminBoxMonthlyListResponseSchema,
  adminBoxMonthlyQuerySchema,
} from '@ccc/shared/admin-box';
```

and

```ts
import { advanceBoxFulfillment, listAdminBoxes } from '../../services/box/fulfillment.js';
```

Add the handler at the top of the plugin body (before the POST handler):

```ts
app.get('/box/monthly', async (request, reply) => {
  const query = adminBoxMonthlyQuerySchema.parse(request.query);
  const result = await listAdminBoxes(query.cycleKey);
  return reply.send(adminBoxMonthlyListResponseSchema.parse(result));
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && pnpm exec vitest run test/box/box-fulfillment.test.ts`
Expected: PASS (advance block from Task 4 + the 3 new list cases).

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/api/src/services/box/fulfillment.ts apps/api/src/routes/admin/box-fulfillment-admin.ts apps/api/test/box/box-fulfillment.test.ts
git add apps/api/src/services/box/fulfillment.ts apps/api/src/routes/admin/box-fulfillment-admin.ts apps/api/test/box/box-fulfillment.test.ts
git commit -m "feat(api): admin box monthly list with fulfillment counts"
```

---

### Task 6: API — picking aggregation endpoint

**Files:**

- Modify: `apps/api/src/services/box/fulfillment.ts`
- Modify: `apps/api/src/routes/admin/box-fulfillment-admin.ts`
- Test: `apps/api/test/box/box-fulfillment.test.ts` (add a `describe` block)

**Interfaces:**

- Consumes (Task 2): `AdminBoxPickingResponse`, `adminBoxPickingResponseSchema`, `adminBoxMonthlyQuerySchema` from `@ccc/shared/admin-box`. Reuses `seedBox` from Task 4.
- Produces:
  - `getAdminBoxPicking(cycleKeyInput?: string): Promise<AdminBoxPickingResponse>`
  - `GET /box/monthly/picking` handler. Aggregates `included = true` lines of `ready` boxes for the cycle: `items` grouped by `catalogItemId` (`titleSnapshot`), `partnerItems` grouped by `partnerModuleId` (`nameSnapshot`). `totalQuantity` = sum of quantities; `boxCount` = count of distinct boxes contributing that ref. Source is `MonthlyBoxItem` + `MonthlyBoxPartnerItem`, never `OrderItem` (spec R12). Aggregates ALL ready boxes of the cycle, not only not-yet-packed ones.

- [ ] **Step 1: Add the failing picking tests**

Add a helper to seed box lines and a `describe` block to `apps/api/test/box/box-fulfillment.test.ts`. Add the import and this block:

```ts
import { adminBoxPickingResponseSchema } from '@ccc/shared/admin-box';

// Attaches an included catalog-item line + partner-module line to an existing box.
const addBoxLines = async (
  boxId: string,
  opts: { catalogItemId: string; itemQty: number; partnerModuleId: string; partnerQty: number },
) => {
  await prisma.monthlyBoxItem.create({
    data: {
      boxId,
      catalogItemId: opts.catalogItemId,
      quantity: opts.itemQty,
      unitPriceCents: 1000,
      subtotalCents: 1000 * opts.itemQty,
      titleSnapshot: 'Adesivo',
      included: true,
    },
  });
  await prisma.monthlyBoxPartnerItem.create({
    data: {
      boxId,
      partnerModuleId: opts.partnerModuleId,
      quantity: opts.partnerQty,
      unitPriceCents: 5000,
      subtotalCents: 5000 * opts.partnerQty,
      nameSnapshot: 'Kit lavagem',
      included: true,
    },
  });
};

describe('GET /admin/box/monthly/picking', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('aggregates included lines across ready boxes of the cycle', async () => {
    const catalogItem = await prisma.boxCatalogItem.create({
      data: {
        slug: 'adesivo',
        title: 'Adesivo',
        description: 'x',
        priceCents: 1000,
        category: 'sticker',
      },
    });
    const partner = await prisma.partner.create({
      data: { slug: 'lavacar', name: 'LavaCar' },
    });
    const module = await prisma.partnerModule.create({
      data: { partnerId: partner.id, name: 'Kit lavagem', priceCents: 5000 },
    });

    const a = await seedBox({
      cycleKey: '2026-08-01',
      status: 'ready',
      fulfillmentStatus: 'unfulfilled',
    });
    const b = await seedBox({
      cycleKey: '2026-08-01',
      status: 'ready',
      fulfillmentStatus: 'packed',
    });
    // An open box in the same cycle — its lines must NOT be aggregated.
    const c = await seedBox({
      cycleKey: '2026-08-01',
      status: 'open',
      fulfillmentStatus: 'unfulfilled',
    });
    await addBoxLines(a.box.id, {
      catalogItemId: catalogItem.id,
      itemQty: 2,
      partnerModuleId: module.id,
      partnerQty: 1,
    });
    await addBoxLines(b.box.id, {
      catalogItemId: catalogItem.id,
      itemQty: 3,
      partnerModuleId: module.id,
      partnerQty: 1,
    });
    await addBoxLines(c.box.id, {
      catalogItemId: catalogItem.id,
      itemQty: 9,
      partnerModuleId: module.id,
      partnerQty: 9,
    });

    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/monthly/picking?cycleKey=2026-08-01',
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(200);
    const body = adminBoxPickingResponseSchema.parse(res.json());
    expect(body.cycleKey).toBe('2026-08-01');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      refId: catalogItem.id,
      title: 'Adesivo',
      totalQuantity: 5,
      boxCount: 2,
    });
    expect(body.partnerItems).toHaveLength(1);
    expect(body.partnerItems[0]).toMatchObject({
      refId: module.id,
      title: 'Kit lavagem',
      totalQuantity: 2,
      boxCount: 2,
    });
  });

  it('excludes dropped (included = false) lines', async () => {
    const catalogItem = await prisma.boxCatalogItem.create({
      data: {
        slug: 'adesivo2',
        title: 'Adesivo',
        description: 'x',
        priceCents: 1000,
        category: 'sticker',
      },
    });
    const { box } = await seedBox({
      cycleKey: '2026-08-01',
      status: 'ready',
      fulfillmentStatus: 'unfulfilled',
    });
    await prisma.monthlyBoxItem.create({
      data: {
        boxId: box.id,
        catalogItemId: catalogItem.id,
        quantity: 4,
        unitPriceCents: 1000,
        subtotalCents: 4000,
        titleSnapshot: 'Adesivo',
        included: false,
      },
    });
    const { header } = await orgAuth();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/box/monthly/picking?cycleKey=2026-08-01',
      headers: { authorization: header },
    });
    const body = adminBoxPickingResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && pnpm exec vitest run test/box/box-fulfillment.test.ts`
Expected: FAIL — `GET /admin/box/monthly/picking` returns 404.

- [ ] **Step 3: Add the picking service**

Extend the imports at the top of `apps/api/src/services/box/fulfillment.ts`:

```ts
import type {
  AdminBoxMonthlyListResponse,
  AdminBoxPickingResponse,
  PickingRow,
} from '@ccc/shared/admin-box';
```

(Merge with the existing admin-box import from Task 5 — one import statement.) Then append:

```ts
type PickingAccumulator = { title: string; totalQuantity: number; boxes: Set<string> };

const foldRows = (acc: Map<string, PickingAccumulator>): PickingRow[] =>
  Array.from(acc.entries()).map(([refId, v]) => ({
    refId,
    title: v.title,
    totalQuantity: v.totalQuantity,
    boxCount: v.boxes.size,
  }));

export const getAdminBoxPicking = async (
  cycleKeyInput?: string,
): Promise<AdminBoxPickingResponse> => {
  const availableCycles = await distinctCyclesDesc();
  const cycleKey = cycleKeyInput ?? availableCycles[0] ?? '';

  const readyBoxes = await prisma.monthlyBox.findMany({
    where: { cycleKey, status: 'ready' },
    select: {
      id: true,
      items: {
        where: { included: true },
        select: { catalogItemId: true, titleSnapshot: true, quantity: true },
      },
      partnerItems: {
        where: { included: true },
        select: { partnerModuleId: true, nameSnapshot: true, quantity: true },
      },
    },
  });

  const items = new Map<string, PickingAccumulator>();
  const partnerItems = new Map<string, PickingAccumulator>();
  for (const box of readyBoxes) {
    for (const line of box.items) {
      const entry = items.get(line.catalogItemId) ?? {
        title: line.titleSnapshot,
        totalQuantity: 0,
        boxes: new Set<string>(),
      };
      entry.totalQuantity += line.quantity;
      entry.boxes.add(box.id);
      items.set(line.catalogItemId, entry);
    }
    for (const line of box.partnerItems) {
      const entry = partnerItems.get(line.partnerModuleId) ?? {
        title: line.nameSnapshot,
        totalQuantity: 0,
        boxes: new Set<string>(),
      };
      entry.totalQuantity += line.quantity;
      entry.boxes.add(box.id);
      partnerItems.set(line.partnerModuleId, entry);
    }
  }

  return { cycleKey, items: foldRows(items), partnerItems: foldRows(partnerItems) };
};
```

- [ ] **Step 4: Add the GET handler**

In `apps/api/src/routes/admin/box-fulfillment-admin.ts`, extend the shared import to include `adminBoxPickingResponseSchema`, and the service import to include `getAdminBoxPicking`:

```ts
import {
  adminBoxAdvanceRequestSchema,
  adminBoxMonthlyListResponseSchema,
  adminBoxMonthlyQuerySchema,
  adminBoxPickingResponseSchema,
} from '@ccc/shared/admin-box';
```

```ts
import {
  advanceBoxFulfillment,
  getAdminBoxPicking,
  listAdminBoxes,
} from '../../services/box/fulfillment.js';
```

Add the handler after the `GET /box/monthly` handler:

```ts
app.get('/box/monthly/picking', async (request, reply) => {
  const query = adminBoxMonthlyQuerySchema.parse(request.query);
  const result = await getAdminBoxPicking(query.cycleKey);
  return reply.send(adminBoxPickingResponseSchema.parse(result));
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && pnpm exec vitest run test/box/box-fulfillment.test.ts`
Expected: PASS (advance + list + picking blocks all green).

- [ ] **Step 6: Typecheck the API package and confirm lint baseline holds**

Run: `cd apps/api && pnpm exec tsc --noEmit`
Expected: no errors. (Lint baseline in `apps/api` is 72 warnings, 0 errors — judge only whether this change adds to either count.)

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write apps/api/src/services/box/fulfillment.ts apps/api/src/routes/admin/box-fulfillment-admin.ts apps/api/test/box/box-fulfillment.test.ts
git add apps/api/src/services/box/fulfillment.ts apps/api/src/routes/admin/box-fulfillment-admin.ts apps/api/test/box/box-fulfillment.test.ts
git commit -m "feat(api): admin box picking aggregation endpoint"
```

---

## Self-Review

**1. Spec coverage.**

- §1 Modelo de dados (no migration): honored — plan writes only existing `MonthlyBox.fulfillmentStatus` / `Order.fulfillmentStatus`, never `Order.status`, no `trackingCode` (Global Constraints, Task 4 service).
- §2 Mapa de transicao forward-only + predecessors: Task 4 `PREDECESSOR` map.
- §2 Servico de avanco (`BoxAdvanceInput`/`BoxAdvanceResult`, guards, race-safe `updateMany`, Order sync, idempotent double-advance): Task 4 service + tests.
- §2 Rotas admin (advance 200/404/409 with `code`; list `{cycleKey, availableCycles, counts, boxes}` with default = latest cycle, counts over ready only, boxes = all; picking `{cycleKey, items, partnerItems}` from box lines not OrderItem, all ready boxes): Tasks 4/5/6.
- §2 Shared `box.ts` enum + `boxViewSchema.fulfillmentStatus`: Task 1. Admin schemas (advance request, `BoxAdminRow`, `PickingRow`, list + picking responses): Task 2.
- §2 Serialize emits `fulfillmentStatus`: Task 3.
- §5 Tests (advance Order-backed + budget-only; guards not-ready/invalid/idempotent; list + counts; picking aggregation; shared fixture gains field): Tasks 1, 4, 5, 6.
- §Contrato de interface: the three routes + `BoxView.fulfillmentStatus` + named admin schemas are all produced.
- Out of scope (§3 admin web, §4 mobile, §6 refund/cancel/tracking/push): correctly excluded.

**2. Placeholder scan.** No TBD/TODO; every code step carries real code; every test step carries real assertions. No "handle edge cases" hand-waving.

**3. Type consistency.** `advanceBoxFulfillment`, `listAdminBoxes`, `getAdminBoxPicking` are named identically where produced (Tasks 4/5/6) and imported (route file). `BoxAdvanceResult.kind` values (`ok`/`not_found`/`not_ready`/`invalid_transition`) match the route's `switch` and the tests' `code` assertions (`box_not_found`/`box_not_ready`/`invalid_transition`). Shared schema/type names (`adminBoxMonthlyListResponseSchema`/`AdminBoxMonthlyListResponse`, `adminBoxPickingResponseSchema`/`AdminBoxPickingResponse`, `boxPickingRowSchema`/`PickingRow`, `adminBoxRowSchema`/`BoxAdminRow`, `adminBoxAdvanceRequestSchema`) are consistent between Task 2 (definition) and Tasks 4–6 (consumption). The `counts` shape referenced in the service (`AdminBoxMonthlyListResponse['counts']`) matches `boxFulfillmentCountsSchema`.

**Resolved ambiguities (flagged):**

- Spec lists shared schemas for advance _request_ but not an advance _response_ schema. Resolved: the advance route returns `{ id, fulfillmentStatus }` inline (typed via `BoxAdvanceResult`), no extra schema, to match the spec's schema list exactly.
- `counts` shape unspecified beyond "tally of fulfillmentStatus". Resolved: a fixed 5-key object (`boxFulfillmentCountsSchema`) mirroring the store queue-totals pattern, tallied over `ready` boxes only.
- Making `boxViewSchema.fulfillmentStatus` required (per spec, no default) will break not-yet-updated mobile box-view fixtures until the mobile plan runs. Flagged as a cross-plan sequencing note under Task 1; not worked around with a default.
