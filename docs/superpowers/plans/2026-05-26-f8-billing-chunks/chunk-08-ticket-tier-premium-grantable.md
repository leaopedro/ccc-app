# Chunk 08 — `TicketTier.isPremiumGrantable` + Admin Tier UI + Publish Warning

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `TicketTier.isPremiumGrantable` (already in DB via F8.01) through the full admin stack: zod schemas, tier CRUD API, admin tier list UI checkbox, and a non-blocking publish warning when no grantable tier exists.

**Architecture:** Four-layer change. `packages/shared/src/admin.ts` gains the field on `adminTicketTierSchema` + `adminTierCreateSchema` + `adminTierUpdateSchema`. `apps/api/src/routes/admin/tiers.ts` (the tier CRUD handler — NOT `events.ts`) reads and persists the boolean on POST + PATCH. `apps/api/src/routes/admin/serializers.ts` emits the field. Admin UI `tier-list.tsx` renders a checkbox per row + in the create form. `event-form.tsx` shows a warning banner when the event is `draft` and no tier has `isPremiumGrantable=true`. Rebuild `@ccc/shared` after any schema export change (canon §F8.13).

**Tech Stack:** Prisma 5, zod 3, Fastify 4, vitest + Testcontainers-Postgres, Next.js App Router (server actions + `useActionState`), React 18, Tailwind.

---

## Branch safety preflight (CLAUDE.md)

```bash
git branch --show-current
# If `production` → STOP. Switch to main first.
git checkout main && git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-08
```

## Dependencies on prior chunks

- **F8.01** must be on `main` before execution. It adds `TicketTier.isPremiumGrantable Boolean @default(false)` to the Prisma schema and runs the migration. This chunk consumes that column — do NOT re-add it.

If F8.01 is not on `main`, stop. The `prisma.ticketTier.create/update` calls in Task 2 reference `isPremiumGrantable` directly; without the column the API will throw.

---

## File Structure

```
packages/shared/src/admin.ts                                   (modify — extend 3 schemas)
apps/api/src/routes/admin/tiers.ts                             (modify — accept + persist isPremiumGrantable)
apps/api/src/routes/admin/serializers.ts                       (modify — emit isPremiumGrantable)
apps/api/test/admin/tiers/create.test.ts                       (modify — add isPremiumGrantable cases)
apps/api/test/admin/tiers/update.test.ts                       (modify — add isPremiumGrantable cases)
apps/admin/app/(authed)/events/[id]/tier-list.tsx              (modify — checkbox in row + create form)
apps/admin/app/(authed)/events/[id]/event-form.tsx             (modify — publish warning banner)
apps/admin/src/lib/tier-actions.ts                             (modify — pass isPremiumGrantable through)
apps/admin/app/(authed)/events/[id]/__tests__/tier-list.test.tsx     (new — UI assertions)
apps/admin/app/(authed)/events/[id]/__tests__/event-form-publish-warning.test.tsx  (new — warning assertions)
```

**Key constraints:**

- The tier CRUD route lives in `apps/api/src/routes/admin/tiers.ts`, not `events.ts`. Do NOT modify `events.ts` for this chunk.
- `adminTicketTierSchema` extends `ticketTierSchema` (from `packages/shared/src/events.ts`). `ticketTierSchema` does NOT get `isPremiumGrantable` — it is admin-only. The field lands only on `adminTicketTierSchema`, `adminTierCreateSchema`, and `adminTierUpdateSchema`.
- `serializeAdminTier` in `serializers.ts` must emit the field so the admin UI can read it.
- The publish warning lives in `event-form.tsx` — it already receives `event: AdminEventDetail` which carries `event.tiers: AdminTicketTier[]`. No new server call needed.

---

## Task 1 — Extend shared zod schemas

**Files:** modify `packages/shared/src/admin.ts`.

- [ ] **Step 1.1 — Write the failing zod tests**

Create `packages/shared/src/__tests__/admin-tier-premium-grantable.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { adminTicketTierSchema, adminTierCreateSchema, adminTierUpdateSchema } from '../admin.js';

describe('adminTicketTierSchema isPremiumGrantable', () => {
  it('accepts isPremiumGrantable=true on a full tier shape', () => {
    const raw = {
      id: 't_1',
      name: 'Geral',
      priceCents: 5000,
      displayPriceCents: 5500,
      devFeePercent: 10,
      currency: 'BRL',
      quantityTotal: 100,
      quantitySold: 0,
      remainingCapacity: 100,
      salesOpenAt: null,
      salesCloseAt: null,
      sortOrder: 0,
      requiresCar: false,
      isPremiumGrantable: true,
      capacityDisplay: { status: 'available', label: '100 vagas', remaining: 100, total: 100 },
    };
    expect(adminTicketTierSchema.parse(raw).isPremiumGrantable).toBe(true);
  });

  it('defaults isPremiumGrantable to false when omitted', () => {
    const raw = {
      id: 't_1',
      name: 'Geral',
      priceCents: 5000,
      displayPriceCents: 5500,
      devFeePercent: 10,
      currency: 'BRL',
      quantityTotal: 100,
      quantitySold: 0,
      remainingCapacity: 100,
      salesOpenAt: null,
      salesCloseAt: null,
      sortOrder: 0,
      requiresCar: false,
      capacityDisplay: { status: 'available', label: '100 vagas', remaining: 100, total: 100 },
    };
    expect(adminTicketTierSchema.parse(raw).isPremiumGrantable).toBe(false);
  });
});

describe('adminTierCreateSchema isPremiumGrantable', () => {
  const base = { name: 'Geral', priceCents: 5000, quantityTotal: 100 };

  it('accepts isPremiumGrantable=true', () => {
    expect(
      adminTierCreateSchema.parse({ ...base, isPremiumGrantable: true }).isPremiumGrantable,
    ).toBe(true);
  });

  it('defaults to false when omitted', () => {
    expect(adminTierCreateSchema.parse(base).isPremiumGrantable).toBe(false);
  });
});

describe('adminTierUpdateSchema isPremiumGrantable', () => {
  it('accepts isPremiumGrantable in a partial update', () => {
    expect(adminTierUpdateSchema.parse({ isPremiumGrantable: false }).isPremiumGrantable).toBe(
      false,
    );
  });

  it('passes through when not present (partial — undefined)', () => {
    const result = adminTierUpdateSchema.parse({ name: 'X' });
    expect(result.isPremiumGrantable).toBeUndefined();
  });
});
```

- [ ] **Step 1.2 — Run the test, confirm FAIL**

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/admin-tier-premium-grantable.test.ts
```

Expected: FAIL with "isPremiumGrantable is not a valid key" or type errors.

- [ ] **Step 1.3 — Extend `adminTicketTierSchema`**

In `packages/shared/src/admin.ts`, locate the `adminTicketTierSchema` definition (~line 229):

```ts
export const adminTicketTierSchema = ticketTierSchema.extend({
  quantitySold: z.number().int().nonnegative(),
});
```

Change to:

```ts
export const adminTicketTierSchema = ticketTierSchema.extend({
  quantitySold: z.number().int().nonnegative(),
  isPremiumGrantable: z.boolean().default(false),
});
```

- [ ] **Step 1.4 — Extend `adminTierCreateSchema`**

Locate `adminTierCreateSchema` (~line 273). Add `isPremiumGrantable` before the `.refine(...)`:

```ts
export const adminTierCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    priceCents: z.number().int().nonnegative(),
    currency: z.string().length(3).default('BRL'),
    quantityTotal: z.number().int().nonnegative(),
    salesOpenAt: z.string().datetime().nullable().optional(),
    salesCloseAt: z.string().datetime().nullable().optional(),
    sortOrder: z.number().int().optional(),
    requiresCar: z.boolean().optional(),
    isPremiumGrantable: z.boolean().default(false),
  })
  .refine(
    (v) => !v.salesOpenAt || !v.salesCloseAt || new Date(v.salesCloseAt) > new Date(v.salesOpenAt),
    { message: 'salesCloseAt must be after salesOpenAt', path: ['salesCloseAt'] },
  );
export type AdminTierCreate = z.infer<typeof adminTierCreateSchema>;
```

- [ ] **Step 1.5 — Extend `adminTierUpdateSchema`**

Locate `adminTierUpdateSchema` (~line 290). Add `isPremiumGrantable` before `.partial().strict()`:

```ts
export const adminTierUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    priceCents: z.number().int().nonnegative(),
    quantityTotal: z.number().int().nonnegative(),
    salesOpenAt: z.string().datetime().nullable(),
    salesCloseAt: z.string().datetime().nullable(),
    sortOrder: z.number().int(),
    requiresCar: z.boolean(),
    isPremiumGrantable: z.boolean(),
  })
  .partial()
  .strict();
export type AdminTierUpdate = z.infer<typeof adminTierUpdateSchema>;
```

- [ ] **Step 1.6 — Run the test, confirm PASS**

```bash
pnpm --filter @ccc/shared exec vitest run src/__tests__/admin-tier-premium-grantable.test.ts
```

Expected: 6 cases PASS.

- [ ] **Step 1.7 — Rebuild `@ccc/shared` (canon §F8.13)**

```bash
pnpm --filter @ccc/shared build
```

Expected: success. Updated `dist/admin.js` + `.d.ts` exports `isPremiumGrantable` on all three schemas.

- [ ] **Step 1.8 — Commit Task 1**

```bash
git add packages/shared/src/admin.ts packages/shared/src/__tests__/admin-tier-premium-grantable.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add isPremiumGrantable to adminTicketTierSchema + create/update schemas (chunk 08)

Extends adminTicketTierSchema, adminTierCreateSchema, adminTierUpdateSchema with
isPremiumGrantable: z.boolean().default(false). Canon §F8.7: backfill + publish-hook
pick the first isPremiumGrantable=true tier per event.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Extend tier CRUD API to persist `isPremiumGrantable`

**Files:** modify `apps/api/src/routes/admin/tiers.ts`, modify `apps/api/src/routes/admin/serializers.ts`.

- [ ] **Step 2.1 — Write the failing API tests**

Extend `apps/api/test/admin/tiers/create.test.ts`. Add these two `it` blocks inside the existing `describe`:

```ts
it('creates a tier with isPremiumGrantable=true', async () => {
  const event = await mkEvent();
  const { user } = await createUser({ email: 'o2@jdm.test', verified: true, role: 'organizer' });
  const res = await app.inject({
    method: 'POST',
    url: `/admin/events/${event.id}/tiers`,
    headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    payload: { name: 'Premium', priceCents: 0, quantityTotal: 50, isPremiumGrantable: true },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ isPremiumGrantable: boolean }>();
  expect(body.isPremiumGrantable).toBe(true);
  const tier = await prisma.ticketTier.findFirstOrThrow({ where: { eventId: event.id } });
  expect(tier.isPremiumGrantable).toBe(true);
});

it('defaults isPremiumGrantable to false when omitted', async () => {
  const event = await mkEvent();
  const { user } = await createUser({ email: 'o3@jdm.test', verified: true, role: 'organizer' });
  const res = await app.inject({
    method: 'POST',
    url: `/admin/events/${event.id}/tiers`,
    headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    payload: { name: 'Geral2', priceCents: 5000, quantityTotal: 100 },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ isPremiumGrantable: boolean }>();
  expect(body.isPremiumGrantable).toBe(false);
});
```

Extend `apps/api/test/admin/tiers/update.test.ts`. Add these two `it` blocks inside the existing `describe`:

```ts
it('sets isPremiumGrantable to true via PATCH', async () => {
  const { event, tier } = await seed();
  const { user } = await createUser({ email: 'o4@jdm.test', verified: true, role: 'organizer' });
  const res = await app.inject({
    method: 'PATCH',
    url: `/admin/events/${event.id}/tiers/${tier.id}`,
    headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    payload: { isPremiumGrantable: true },
  });
  expect(res.statusCode).toBe(200);
  const row = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
  expect(row.isPremiumGrantable).toBe(true);
});

it('sets isPremiumGrantable back to false via PATCH', async () => {
  const { event } = await seed();
  const grantableTier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Gold Tier',
      priceCents: 0,
      quantityTotal: 20,
      sortOrder: 1,
      isPremiumGrantable: true,
    },
  });
  const { user } = await createUser({ email: 'o5@jdm.test', verified: true, role: 'organizer' });
  const res = await app.inject({
    method: 'PATCH',
    url: `/admin/events/${event.id}/tiers/${grantableTier.id}`,
    headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    payload: { isPremiumGrantable: false },
  });
  expect(res.statusCode).toBe(200);
  const row = await prisma.ticketTier.findUniqueOrThrow({ where: { id: grantableTier.id } });
  expect(row.isPremiumGrantable).toBe(false);
});
```

- [ ] **Step 2.2 — Run failing tests**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/tiers/create.test.ts test/admin/tiers/update.test.ts
```

Expected: the 4 new cases FAIL (column accepted but not persisted; body field missing). Existing cases still PASS.

- [ ] **Step 2.3 — Extend `serializeAdminTier` to emit `isPremiumGrantable`**

In `apps/api/src/routes/admin/serializers.ts`, locate `serializeAdminTier` (~line 27). Add `isPremiumGrantable` to the returned object:

```ts
export const serializeAdminTier = (t: DbTier, devFeePercent: number) => ({
  id: t.id,
  name: t.name,
  priceCents: t.priceCents,
  displayPriceCents: calcDisplayPrice(t.priceCents, devFeePercent),
  devFeePercent,
  currency: t.currency,
  quantityTotal: t.quantityTotal,
  quantitySold: t.quantitySold,
  remainingCapacity: Math.max(0, t.quantityTotal - t.quantitySold),
  salesOpenAt: t.salesOpenAt?.toISOString() ?? null,
  salesCloseAt: t.salesCloseAt?.toISOString() ?? null,
  sortOrder: t.sortOrder,
  requiresCar: t.requiresCar,
  isPremiumGrantable: t.isPremiumGrantable,
  capacityDisplay: adminTierCapacityDisplay(t),
});
```

- [ ] **Step 2.4 — Extend tier POST handler to persist `isPremiumGrantable`**

In `apps/api/src/routes/admin/tiers.ts`, locate `prisma.ticketTier.create` inside the POST handler (~line 23). Add `isPremiumGrantable`:

```ts
const tier = await prisma.ticketTier.create({
  data: {
    eventId,
    name: input.name,
    priceCents: input.priceCents,
    currency: input.currency,
    quantityTotal: input.quantityTotal,
    salesOpenAt: input.salesOpenAt ? new Date(input.salesOpenAt) : null,
    salesCloseAt: input.salesCloseAt ? new Date(input.salesCloseAt) : null,
    sortOrder: nextSort,
    requiresCar: input.requiresCar ?? false,
    isPremiumGrantable: input.isPremiumGrantable,
  },
});
```

- [ ] **Step 2.5 — Extend tier PATCH handler to persist `isPremiumGrantable`**

In `apps/api/src/routes/admin/tiers.ts`, locate the PATCH handler's `const data` block (~line 56). Add after the `requiresCar` block:

```ts
if (input.isPremiumGrantable !== undefined) data.isPremiumGrantable = input.isPremiumGrantable;
```

- [ ] **Step 2.6 — Typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: GREEN. If `t.isPremiumGrantable` is not known to `DbTier`, it means F8.01 hasn't been merged yet — stop.

- [ ] **Step 2.7 — Run tests, confirm PASS**

```bash
pnpm --filter @ccc/api exec vitest run test/admin/tiers/create.test.ts test/admin/tiers/update.test.ts
```

Expected: all existing cases + 4 new cases PASS.

- [ ] **Step 2.8 — Commit Task 2**

```bash
git add apps/api/src/routes/admin/tiers.ts apps/api/src/routes/admin/serializers.ts apps/api/test/admin/tiers/create.test.ts apps/api/test/admin/tiers/update.test.ts
git commit -m "$(cat <<'EOF'
feat(api): persist + emit isPremiumGrantable on tier CRUD (chunk 08)

POST /events/:id/tiers and PATCH /events/:id/tiers/:id accept isPremiumGrantable;
serializeAdminTier emits the field. Default false. Canon §F8.7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Admin UI: checkbox in TierList + tier-actions

**Files:** modify `apps/admin/app/(authed)/events/[id]/tier-list.tsx`, modify `apps/admin/src/lib/tier-actions.ts`.

- [ ] **Step 3.1 — Write the failing UI test**

Create `apps/admin/app/(authed)/events/[id]/__tests__/tier-list.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// Mock server actions — they are 'use server' modules; jsdom cannot call them.
vi.mock('~/lib/tier-actions', () => ({
  createTierAction: vi.fn(),
  updateTierAction: vi.fn(),
  deleteTierAction: vi.fn(),
}));

import { TierList } from '../tier-list';
import type { AdminTicketTier } from '@ccc/shared/admin';

const makeTier = (overrides: Partial<AdminTicketTier> = {}): AdminTicketTier => ({
  id: 't_1',
  name: 'Geral',
  priceCents: 5000,
  displayPriceCents: 5500,
  devFeePercent: 10,
  currency: 'BRL',
  quantityTotal: 100,
  quantitySold: 0,
  remainingCapacity: 100,
  salesOpenAt: null,
  salesCloseAt: null,
  sortOrder: 0,
  requiresCar: false,
  isPremiumGrantable: false,
  capacityDisplay: { status: 'available', label: '100 vagas', remaining: 100, total: 100 },
  ...overrides,
});

describe('TierList — isPremiumGrantable checkbox', () => {
  it('renders checkbox unchecked when isPremiumGrantable=false', () => {
    render(<TierList eventId="ev_1" tiers={[makeTier({ isPremiumGrantable: false })]} />);
    const checkbox = screen.getByRole('checkbox', { name: /conceder a membros premium/i });
    expect(checkbox).not.toBeChecked();
  });

  it('renders checkbox checked when isPremiumGrantable=true', () => {
    render(<TierList eventId="ev_1" tiers={[makeTier({ isPremiumGrantable: true })]} />);
    const checkbox = screen.getByRole('checkbox', { name: /conceder a membros premium/i });
    expect(checkbox).toBeChecked();
  });

  it('create form has an isPremiumGrantable checkbox defaulting unchecked', () => {
    render(<TierList eventId="ev_1" tiers={[]} />);
    // The create form section is visible even with no tiers.
    const createCheckbox = screen.getAllByRole('checkbox', {
      name: /conceder a membros premium/i,
    });
    // With no tiers there is only the create-form checkbox (no row checkboxes).
    expect(createCheckbox).toHaveLength(1);
    expect(createCheckbox[0]).not.toBeChecked();
  });

  it('includes isPremiumGrantable=true value in the create form submission', async () => {
    const user = userEvent.setup();
    render(<TierList eventId="ev_1" tiers={[]} />);

    const checkbox = screen.getByRole('checkbox', { name: /conceder a membros premium/i });
    // tick it on
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
```

- [ ] **Step 3.2 — Run failing test**

```bash
pnpm --filter @ccc/admin exec vitest run "app/\(authed\)/events/\[id\]/__tests__/tier-list.test.tsx"
```

Expected: FAIL (checkbox not found — it doesn't exist yet).

- [ ] **Step 3.3 — Add checkbox to `TierRow` in `tier-list.tsx`**

In `apps/admin/app/(authed)/events/[id]/tier-list.tsx`, locate `TierRow`. Inside the edit form (`<form action={action} ...>`), add the checkbox immediately after the `requiresCar` label and before `<Submit label="Salvar" />`:

```tsx
<label className="flex items-center gap-1 text-sm">
  <input
    name="isPremiumGrantable"
    type="checkbox"
    defaultChecked={tier.isPremiumGrantable}
    value="true"
    aria-label="Conceder a membros premium na publicação"
  />
  Conceder a membros premium na publicação
</label>
```

- [ ] **Step 3.4 — Add checkbox to the create form in `TierList`**

In the create form block of `TierList` (the `<form action={action} ...>` at the bottom), add after the `requiresCar` label:

```tsx
<label className="flex items-center gap-1 self-end pb-1 text-sm">
  <input
    name="isPremiumGrantable"
    type="checkbox"
    value="true"
    aria-label="Conceder a membros premium na publicação"
  />
  Conceder a membros premium na publicação
</label>
```

- [ ] **Step 3.5 — Pass `isPremiumGrantable` through `tier-actions.ts`**

In `apps/admin/src/lib/tier-actions.ts`, update `createTierAction` to read the checkbox:

```ts
export const createTierAction = async (
  eventId: string,
  _prev: TierFormState,
  fd: FormData,
): Promise<TierFormState> => {
  const parsed = adminTierCreateSchema.safeParse({
    name: fd.get('name'),
    priceCents: Math.round(toNumber(fd.get('priceReais')) * 100),
    quantityTotal: toNumber(fd.get('quantityTotal')),
    requiresCar: fd.get('requiresCar') === 'true',
    isPremiumGrantable: fd.get('isPremiumGrantable') === 'true',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  try {
    await createTier(eventId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao criar tier.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};
```

Update `updateTierAction` to read the checkbox:

```ts
export const updateTierAction = async (
  eventId: string,
  tierId: string,
  _prev: TierFormState,
  fd: FormData,
): Promise<TierFormState> => {
  const raw: Record<string, unknown> = {};
  if (typeof fd.get('name') === 'string' && fd.get('name') !== '') raw.name = fd.get('name');
  const price = fd.get('priceReais');
  if (typeof price === 'string' && price !== '') raw.priceCents = Math.round(Number(price) * 100);
  const qty = fd.get('quantityTotal');
  if (typeof qty === 'string' && qty !== '') raw.quantityTotal = Number(qty);
  raw.requiresCar = fd.get('requiresCar') === 'true';
  raw.isPremiumGrantable = fd.get('isPremiumGrantable') === 'true';

  const parsed = adminTierUpdateSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; ') };
  try {
    await updateTier(eventId, tierId, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar tier.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { error: null };
};
```

Note: HTML checkboxes only submit a value when checked; unchecked checkboxes are absent from `FormData`. The `fd.get('isPremiumGrantable') === 'true'` pattern correctly maps presence to `true` and absence (unchecked) to `false`. This matches the existing `requiresCar` pattern in the file.

- [ ] **Step 3.6 — Run test, confirm PASS**

```bash
pnpm --filter @ccc/admin exec vitest run "app/\(authed\)/events/\[id\]/__tests__/tier-list.test.tsx"
```

Expected: 4 cases PASS.

- [ ] **Step 3.7 — Typecheck admin**

```bash
pnpm --filter @ccc/admin typecheck
```

Expected: GREEN.

- [ ] **Step 3.8 — Commit Task 3**

```bash
git add apps/admin/app/\(authed\)/events/\[id\]/tier-list.tsx apps/admin/src/lib/tier-actions.ts "apps/admin/app/(authed)/events/[id]/__tests__/tier-list.test.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): isPremiumGrantable checkbox in tier list (chunk 08)

Adds checkbox "Conceder a membros premium na publicação" to TierRow edit form
and the tier create form. tier-actions reads + passes the value through. Canon §F8.7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Publish warning when no grantable tier

**Files:** modify `apps/admin/app/(authed)/events/[id]/event-form.tsx`.

The warning is non-blocking: it advises admins but does not prevent publishing.
`EventForm` already receives `event: AdminEventDetail` which contains `event.tiers: AdminTicketTier[]`.
No new prop is needed; just read `event.tiers.some(t => t.isPremiumGrantable)` inline.

- [ ] **Step 4.1 — Write the failing publish-warning test**

Create `apps/admin/app/(authed)/events/[id]/__tests__/event-form-publish-warning.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/event-actions', () => ({
  updateEventAction: vi.fn(),
  publishEventAction: vi.fn(),
  unpublishEventAction: vi.fn(),
  cancelEventAction: vi.fn(),
}));
vi.mock('~/components/cover-uploader', () => ({
  CoverUploader: () => null,
}));
vi.mock('~/components/date-time-field', () => ({
  DateTimeField: () => null,
}));

import { EventForm } from '../event-form';
import type { AdminEventDetail, AdminTicketTier } from '@ccc/shared/admin';

const makeTier = (isPremiumGrantable: boolean): AdminTicketTier => ({
  id: 't_1',
  name: 'Geral',
  priceCents: 5000,
  displayPriceCents: 5500,
  devFeePercent: 10,
  currency: 'BRL',
  quantityTotal: 100,
  quantitySold: 0,
  remainingCapacity: 100,
  salesOpenAt: null,
  salesCloseAt: null,
  sortOrder: 0,
  requiresCar: false,
  isPremiumGrantable,
  capacityDisplay: { status: 'available', label: '100 vagas', remaining: 100, total: 100 },
});

const makeEvent = (
  status: 'draft' | 'published' | 'cancelled',
  tiers: AdminTicketTier[],
): AdminEventDetail => ({
  id: 'ev_1',
  slug: 'test-event',
  title: 'Test Event',
  coverUrl: null,
  coverObjectKey: 'cover.jpg',
  startsAt: new Date(Date.now() + 86400_000).toISOString(),
  endsAt: new Date(Date.now() + 90000_000).toISOString(),
  venueName: 'Arena',
  venueAddress: 'Rua A, 1',
  city: 'São Paulo',
  stateCode: 'SP',
  type: 'meeting',
  description: 'desc',
  capacity: 100,
  maxTicketsPerUser: null,
  hasCarTier: false,
  feedEnabled: true,
  feedAccess: 'public',
  postingAccess: 'attendees',
  maxPostsPerUser: null,
  maxPhotosPerUser: 10,
  status,
  publishedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tiers,
  extras: [],
});

describe('EventForm — no-grantable-tier publish warning', () => {
  it('shows warning for draft event with no grantable tier', () => {
    render(<EventForm event={makeEvent('draft', [makeTier(false)])} />);
    expect(screen.getByText(/nenhum nível concede acesso premium/i)).toBeInTheDocument();
  });

  it('shows warning for draft event with zero tiers', () => {
    render(<EventForm event={makeEvent('draft', [])} />);
    expect(screen.getByText(/nenhum nível concede acesso premium/i)).toBeInTheDocument();
  });

  it('does NOT show warning when at least one tier is grantable', () => {
    render(<EventForm event={makeEvent('draft', [makeTier(true)])} />);
    expect(screen.queryByText(/nenhum nível concede acesso premium/i)).not.toBeInTheDocument();
  });

  it('does NOT show warning for published event (already published, warning would be noise)', () => {
    render(<EventForm event={makeEvent('published', [makeTier(false)])} />);
    expect(screen.queryByText(/nenhum nível concede acesso premium/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4.2 — Run failing test**

```bash
pnpm --filter @ccc/admin exec vitest run "app/\(authed\)/events/\[id\]/__tests__/event-form-publish-warning.test.tsx"
```

Expected: FAIL (warning text not found).

- [ ] **Step 4.3 — Add warning to `event-form.tsx`**

In `apps/admin/app/(authed)/events/[id]/event-form.tsx`, locate the block after the status-action buttons and before the cover-uploader check (~line 109):

```tsx
{
  event.status === 'draft' && !hasPersistedCover ? (
    <p className="text-xs text-[color:var(--color-muted)]">
      Adicione e salve uma capa antes de publicar o evento.
    </p>
  ) : null;
}
```

Add the premium warning immediately after that block:

```tsx
{
  event.status === 'draft' && !event.tiers.some((t) => t.isPremiumGrantable) ? (
    <p className="text-xs text-amber-400">
      Nenhum nível concede acesso premium; membros não receberão ticket automático.
    </p>
  ) : null;
}
```

This renders only on `draft` events. Once published, the event-form shows the published-state buttons; the warning is suppressed to avoid noise on an event that is already live.

- [ ] **Step 4.4 — Run test, confirm PASS**

```bash
pnpm --filter @ccc/admin exec vitest run "app/\(authed\)/events/\[id\]/__tests__/event-form-publish-warning.test.tsx"
```

Expected: 4 cases PASS.

- [ ] **Step 4.5 — Typecheck admin**

```bash
pnpm --filter @ccc/admin typecheck
```

Expected: GREEN.

- [ ] **Step 4.6 — Commit Task 4**

```bash
git add "apps/admin/app/(authed)/events/[id]/event-form.tsx" "apps/admin/app/(authed)/events/[id]/__tests__/event-form-publish-warning.test.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): non-blocking warning when no isPremiumGrantable tier at publish (chunk 08)

Shows amber advisory "Nenhum nível concede acesso premium; membros não receberão
ticket automático." on draft events with zero grantable tiers. Non-blocking per spec §2.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification — run before push

Stop and fix at the first failure.

```bash
# 1. Shared — must build before any downstream package tests.
pnpm --filter @ccc/shared build
pnpm --filter @ccc/shared exec vitest run src/__tests__/admin-tier-premium-grantable.test.ts

# 2. API tier CRUD.
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api exec vitest run test/admin/tiers/create.test.ts test/admin/tiers/update.test.ts

# 3. Admin UI.
pnpm --filter @ccc/admin typecheck
pnpm --filter @ccc/admin exec vitest run "app/(authed)/events/[id]/__tests__/tier-list.test.tsx" "app/(authed)/events/[id]/__tests__/event-form-publish-warning.test.tsx"
```

`pnpm --filter @ccc/shared build` is required before API tests (canon §F8.13). Only the files touched in this chunk run (per `feedback_no_full_test_suite_locally.md`). All commands one-shot (per `feedback_no_background_shells.md`).

---

## Task 5 — PR

- [ ] **Step 5.1 — Push**

```bash
git push -u origin feat/jdma-f8-billing-08
```

- [ ] **Step 5.2 — Open PR (`gh pr create --base main`)**

```bash
gh pr create --title "feat(shared,api,admin): TicketTier.isPremiumGrantable admin CRUD + UI (chunk 08)" --body "$(cat <<'EOF'
## Summary

- Extends `adminTicketTierSchema`, `adminTierCreateSchema`, `adminTierUpdateSchema` in `@ccc/shared` with `isPremiumGrantable: z.boolean().default(false)`.
- `apps/api/src/routes/admin/tiers.ts` POST + PATCH handlers persist the boolean; `serializeAdminTier` emits it.
- `tier-list.tsx` renders a "Conceder a membros premium na publicação" checkbox on each tier row and in the create form; `tier-actions.ts` reads + passes the value through.
- `event-form.tsx` shows a non-blocking amber advisory on draft events with zero grantable tiers: "Nenhum nível concede acesso premium; membros não receberão ticket automático."
- Consumed by F8.07 (event-publish-grant hook) and F8.06 (ticket backfill worker) via canon §F8.7 tier-selection rule.

## Test plan

- [ ] `pnpm --filter @ccc/shared build` — shared rebuilds cleanly (canon §F8.13)
- [ ] `pnpm --filter @ccc/shared exec vitest run src/__tests__/admin-tier-premium-grantable.test.ts` — 6 zod cases PASS
- [ ] `pnpm --filter @ccc/api typecheck` — GREEN
- [ ] `pnpm --filter @ccc/api exec vitest run test/admin/tiers/create.test.ts test/admin/tiers/update.test.ts` — all cases PASS including 4 new
- [ ] `pnpm --filter @ccc/admin typecheck` — GREEN
- [ ] `pnpm --filter @ccc/admin exec vitest run "app/(authed)/events/[id]/__tests__/tier-list.test.tsx"` — 4 UI cases PASS
- [ ] `pnpm --filter @ccc/admin exec vitest run "app/(authed)/events/[id]/__tests__/event-form-publish-warning.test.tsx"` — 4 warning cases PASS

## Chunk notes

- F8.01 is a hard prerequisite (adds `isPremiumGrantable` column). This chunk consumes it — column is NOT re-added here.
- Schema exports `ticketTierSchema` (public-facing, `packages/shared/src/events.ts`) is NOT modified — `isPremiumGrantable` is admin-only.
- PR opens against `main`, never `production`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (before requesting review)

- [ ] Branch `feat/jdma-f8-billing-08`, cut from fresh `main`. F8.01 confirmed on `main`.
- [ ] `@ccc/shared` rebuilt after schema changes (`pnpm --filter @ccc/shared build`).
- [ ] `adminTicketTierSchema` has `isPremiumGrantable: z.boolean().default(false)`.
- [ ] `adminTierCreateSchema` has `isPremiumGrantable: z.boolean().default(false)`.
- [ ] `adminTierUpdateSchema` has `isPremiumGrantable: z.boolean()` inside `.partial().strict()`.
- [ ] `ticketTierSchema` in `events.ts` is NOT modified (public schema; admin-only field).
- [ ] `serializeAdminTier` emits `isPremiumGrantable: t.isPremiumGrantable`.
- [ ] POST handler passes `isPremiumGrantable: input.isPremiumGrantable` to `prisma.ticketTier.create`.
- [ ] PATCH handler applies `if (input.isPremiumGrantable !== undefined) data.isPremiumGrantable = input.isPremiumGrantable`.
- [ ] `tier-list.tsx` checkbox uses `aria-label="Conceder a membros premium na publicação"` (enables test query by role+name).
- [ ] Create-form checkbox is present; unchecked maps to `false` via `fd.get(...) === 'true'` pattern (consistent with `requiresCar`).
- [ ] Publish warning renders only on `draft` events with zero grantable tiers. Warning copy: "Nenhum nível concede acesso premium; membros não receberão ticket automático."
- [ ] Warning is non-blocking: no guard on the publish action itself.
- [ ] PR opens against `main`, never `production`.
