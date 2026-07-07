# Check-In Store Pickup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the event check-in scanner so staff can scan a ticket, see merchandise pickup items, and mark them collected in one tap.

**Architecture:** Extend `POST /admin/tickets/check-in` response to include a `storePickup` array (pickup orders linked to that ticket via `Order.notes.pickupTicketId`). Add `POST /admin/store/pickup/collect` that atomically transitions pickup orders to `picked_up` (idempotent — already-collected returns current state without error). Scanner UI gets a `StorePickupPanel` inside `TicketResultCard`.

**Tech Stack:** TypeScript, Zod, Prisma, Fastify, Next.js App Router server actions, React

---

## File Map

| File                                                     | Action | Purpose                                                                                                                                                       |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/check-in.ts`                        | Modify | Add `storePickupItemSchema`, `storePickupOrderSchema`, extend `ticketCheckInResponseSchema`, add `pickupCollectRequestSchema` + `pickupCollectResponseSchema` |
| `apps/api/src/services/store/pickup-collect.ts`          | Create | `getPickupOrdersForTicket()` + `collectPickupOrders()`                                                                                                        |
| `apps/api/src/routes/admin/check-in.ts`                  | Modify | Include `storePickup` in check-in response; add `POST /store/pickup/collect`                                                                                  |
| `apps/admin/src/lib/admin-api.ts`                        | Modify | Add `collectPickupOrder()` API call                                                                                                                           |
| `apps/admin/src/lib/check-in-actions.ts`                 | Modify | Add `submitPickupCollect()` server action + `PickupCollectActionResult` type                                                                                  |
| `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx` | Modify | Add `StorePickupPanel` + wire into `TicketResultCard`                                                                                                         |
| `apps/api/test/admin/check-in.route.test.ts`             | Modify | Tests: storePickup in check-in response; collect happy path; collect idempotent                                                                               |

---

### Task 1: Add shared Zod schemas

**Files:**

- Modify: `packages/shared/src/check-in.ts` (append after existing exports)

- [ ] **Step 1: Add store pickup schemas**

Append to end of `packages/shared/src/check-in.ts`:

```typescript
// ── Store pickup (JDMA-393 check-in extension) ────────────────────────

export const storePickupItemSchema = z.object({
  id: z.string().min(1),
  productTitle: z.string().nullable(),
  variantName: z.string().nullable(),
  variantSku: z.string().nullable(),
  variantAttributes: z.record(z.string()).nullable(),
  quantity: z.number().int().positive(),
});
export type StorePickupItem = z.infer<typeof storePickupItemSchema>;

export const storePickupOrderSchema = z.object({
  orderId: z.string().min(1),
  shortId: z.string().min(1),
  fulfillmentStatus: z.enum(['unfulfilled', 'pickup_ready', 'picked_up', 'cancelled']),
  items: z.array(storePickupItemSchema),
});
export type StorePickupOrder = z.infer<typeof storePickupOrderSchema>;

export const pickupCollectRequestSchema = z.object({
  ticketId: z.string().min(1).max(64),
});
export type PickupCollectRequest = z.infer<typeof pickupCollectRequestSchema>;

export const pickupCollectResponseSchema = z.object({
  orders: z.array(
    z.object({
      orderId: z.string().min(1),
      shortId: z.string().min(1),
      collected: z.boolean(),
      fulfillmentStatus: z.enum(['unfulfilled', 'pickup_ready', 'picked_up', 'cancelled']),
      items: z.array(storePickupItemSchema),
    }),
  ),
});
export type PickupCollectResponse = z.infer<typeof pickupCollectResponseSchema>;
```

- [ ] **Step 2: Extend ticketCheckInResponseSchema to include storePickup**

Replace the existing `ticketCheckInResponseSchema` in `packages/shared/src/check-in.ts`:

```typescript
export const ticketCheckInResponseSchema = z.object({
  result: checkInResultSchema,
  ticket: z.object({
    id: z.string().min(1),
    status: z.enum(['valid', 'used', 'revoked']),
    checkedInAt: z.string().datetime(),
    tier: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    }),
    holder: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    }),
    car: z
      .object({
        make: z.string().min(1),
        model: z.string().min(1),
        year: z.number().int(),
      })
      .nullable(),
    licensePlate: z.string().nullable(),
    extras: z.array(checkInExtraItemSchema),
  }),
  storePickup: z.array(storePickupOrderSchema),
});
export type TicketCheckInResponse = z.infer<typeof ticketCheckInResponseSchema>;
```

- [ ] **Step 3: Verify shared package builds**

```bash
cd packages/shared && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/check-in.ts
git commit -m "feat(shared): add store pickup schemas to check-in types

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Create pickup-collect service

**Files:**

- Create: `apps/api/src/services/store/pickup-collect.ts`

- [ ] **Step 1: Write failing test stubs**

In `apps/api/test/admin/check-in.route.test.ts`, add at the end of the file:

```typescript
describe('storePickup in POST /admin/tickets/check-in', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns empty storePickup when ticket has no pickup order', async () => {
    const { event, code } = await seedTicket();
    const { user: adminUser } = await createUser({
      email: 'a@jdm.test',
      role: 'admin',
      verified: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: `Bearer ${bearer(adminUser)}` },
      payload: { code, eventId: event.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ storePickup: unknown[] }>();
    expect(body.storePickup).toEqual([]);
  });
});

describe('POST /admin/store/pickup/collect', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/store/pickup/collect',
      payload: { ticketId: 'abc123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty orders array when ticket has no pickup orders', async () => {
    const { ticket } = await seedTicket();
    const { user: adminUser } = await createUser({
      email: 'a2@jdm.test',
      role: 'admin',
      verified: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/store/pickup/collect',
      headers: { authorization: `Bearer ${bearer(adminUser)}` },
      payload: { ticketId: ticket.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ orders: unknown[] }>();
    expect(body.orders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && pnpm vitest run test/admin/check-in.route.test.ts 2>&1 | tail -20
```

Expected: tests for new describe blocks fail (storePickup not in response, /store/pickup/collect returns 404).

- [ ] **Step 3: Create the service**

Create `apps/api/src/services/store/pickup-collect.ts`:

```typescript
import { prisma } from '@jdm/db';
import type { StorePickupItem, StorePickupOrder } from '@jdm/shared/check-in';

import { recordAudit } from '../admin-audit.js';

const parsePickupTicketId = (notes: string | null): string | null => {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const id = (parsed as Record<string, unknown>).pickupTicketId;
      return typeof id === 'string' ? id : null;
    }
  } catch {
    // ignore malformed notes
  }
  return null;
};

const PICKUP_ITEM_INCLUDE = {
  where: { kind: 'product' as const },
  include: {
    variant: {
      select: {
        name: true,
        sku: true,
        attributes: true,
        product: { select: { title: true } },
      },
    },
  },
} as const;

const mapItems = (
  items: {
    id: string;
    quantity: number;
    variant: {
      name: string | null;
      sku: string | null;
      attributes: unknown;
      product: { title: string };
    } | null;
  }[],
): StorePickupItem[] =>
  items.map((it) => {
    const attrs =
      it.variant?.attributes && typeof it.variant.attributes === 'object'
        ? Object.fromEntries(
            Object.entries(it.variant.attributes as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === 'string',
            ),
          )
        : null;
    return {
      id: it.id,
      productTitle: it.variant?.product.title ?? null,
      variantName: it.variant?.name ?? null,
      variantSku: it.variant?.sku ?? null,
      variantAttributes: attrs,
      quantity: it.quantity,
    };
  });

const queryPickupOrders = async (ticketId: string) => {
  const candidates = await prisma.order.findMany({
    where: {
      fulfillmentMethod: 'pickup',
      status: 'paid',
      notes: { contains: ticketId },
    },
    include: { items: PICKUP_ITEM_INCLUDE },
  });
  return candidates.filter((o) => parsePickupTicketId(o.notes) === ticketId);
};

export const getPickupOrdersForTicket = async (ticketId: string): Promise<StorePickupOrder[]> => {
  const orders = await queryPickupOrders(ticketId);
  return orders.map((o) => ({
    orderId: o.id,
    shortId: o.id.slice(-8).toUpperCase(),
    fulfillmentStatus: o.fulfillmentStatus as StorePickupOrder['fulfillmentStatus'],
    items: mapItems(o.items),
  }));
};

export type PickupCollectResult = {
  orderId: string;
  shortId: string;
  collected: boolean;
  fulfillmentStatus: StorePickupOrder['fulfillmentStatus'];
  items: StorePickupItem[];
};

export const collectPickupOrders = async (
  ticketId: string,
  actorId: string,
): Promise<PickupCollectResult[]> => {
  const orders = await queryPickupOrders(ticketId);
  const results: PickupCollectResult[] = [];

  for (const order of orders) {
    const alreadyCollected = order.fulfillmentStatus === 'picked_up';
    const cancelled = order.fulfillmentStatus === 'cancelled';

    if (!alreadyCollected && !cancelled) {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { fulfillmentStatus: 'picked_up' },
        });
        await recordAudit(
          {
            actorId,
            action: 'store.order.fulfillment_update',
            entityType: 'order',
            entityId: order.id,
            metadata: {
              from: order.fulfillmentStatus,
              to: 'picked_up',
              method: 'pickup',
              source: 'check_in_scan',
            },
          },
          tx,
        );
      });
    }

    results.push({
      orderId: order.id,
      shortId: order.id.slice(-8).toUpperCase(),
      collected: !alreadyCollected && !cancelled,
      fulfillmentStatus: cancelled ? 'cancelled' : 'picked_up',
      items: mapItems(order.items),
    });
  }

  return results;
};
```

---

### Task 3: Extend check-in API route

**Files:**

- Modify: `apps/api/src/routes/admin/check-in.ts`

- [ ] **Step 1: Import new service functions and schemas**

Add to the imports at top of `apps/api/src/routes/admin/check-in.ts`:

```typescript
import {
  pickupCollectRequestSchema,
  pickupCollectResponseSchema,
  storePickupOrderSchema,
} from '@jdm/shared/check-in';

import {
  collectPickupOrders,
  getPickupOrdersForTicket,
} from '../../services/store/pickup-collect.js';
```

- [ ] **Step 2: Add storePickup to check-in response**

In the `POST /tickets/check-in` handler, after building `extraItems`, add the pickup query and include in response. Replace the `return reply.send(...)` block:

```typescript
const storePickup = await getPickupOrdersForTicket(outcome.ticket.id);

const { car } = outcome.ticket;
return reply.send(
  ticketCheckInResponseSchema.parse({
    result: outcome.kind,
    ticket: {
      id: outcome.ticket.id,
      status: outcome.ticket.status,
      checkedInAt,
      tier: {
        id: outcome.ticket.tier.id,
        name: outcome.ticket.tier.name,
      },
      holder: {
        id: outcome.ticket.user.id,
        name: outcome.ticket.user.name,
      },
      car: car ? { make: car.make, model: car.model, year: car.year } : null,
      licensePlate: outcome.ticket.licensePlate,
      extras: extraItems.map((ei) => ({
        id: ei.id,
        extraId: ei.extraId,
        name: ei.extra.name,
        code: ei.code,
        status: ei.status,
        usedAt: ei.usedAt?.toISOString() ?? null,
      })),
    },
    storePickup: storePickup.map((o) => storePickupOrderSchema.parse(o)),
  }),
);
```

- [ ] **Step 3: Add POST /store/pickup/collect endpoint**

Append before the closing `};` of `adminCheckInRoutes`:

```typescript
app.post('/store/pickup/collect', async (request, reply) => {
  const { sub: actorId } = requireUser(request);
  const input = pickupCollectRequestSchema.parse(request.body);

  const orders = await collectPickupOrders(input.ticketId, actorId);

  return reply.send(pickupCollectResponseSchema.parse({ orders }));
});
```

- [ ] **Step 4: Run new tests to verify they pass**

```bash
cd apps/api && pnpm vitest run test/admin/check-in.route.test.ts 2>&1 | tail -20
```

Expected: all tests pass including new stubs.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/store/pickup-collect.ts \
        apps/api/src/routes/admin/check-in.ts \
        apps/api/test/admin/check-in.route.test.ts
git commit -m "feat(api): extend check-in with store pickup + collect endpoint

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: Extend admin API client and server action

**Files:**

- Modify: `apps/admin/src/lib/admin-api.ts`
- Modify: `apps/admin/src/lib/check-in-actions.ts`

- [ ] **Step 1: Add collectPickupOrder to admin-api.ts**

In `apps/admin/src/lib/admin-api.ts`, add these imports at top (or alongside existing check-in imports):

```typescript
import type { PickupCollectRequest, PickupCollectResponse } from '@jdm/shared/check-in';
import { pickupCollectRequestSchema, pickupCollectResponseSchema } from '@jdm/shared/check-in';
```

Then add after `claimExtraItem`:

```typescript
export const collectPickupOrder = (input: PickupCollectRequest): Promise<PickupCollectResponse> =>
  apiFetch('/admin/store/pickup/collect', {
    method: 'POST',
    body: JSON.stringify(pickupCollectRequestSchema.parse(input)),
    schema: pickupCollectResponseSchema,
  });
```

- [ ] **Step 2: Add submitPickupCollect to check-in-actions.ts**

In `apps/admin/src/lib/check-in-actions.ts`, add import:

```typescript
import { collectPickupOrder as apiCollectPickup } from './admin-api';
```

Add type and action at end of file:

```typescript
export type PickupCollectActionResult =
  | {
      ok: true;
      orders: {
        orderId: string;
        shortId: string;
        collected: boolean;
        fulfillmentStatus: string;
        items: {
          id: string;
          productTitle: string | null;
          variantName: string | null;
          variantSku: string | null;
          variantAttributes: Record<string, string> | null;
          quantity: number;
        }[];
      }[];
    }
  | { ok: false; error: string; message: string };

export const submitPickupCollect = async (ticketId: string): Promise<PickupCollectActionResult> => {
  try {
    const res = await apiCollectPickup({ ticketId });
    return { ok: true, orders: res.orders };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, error: err.code, message: err.message };
    }
    return { ok: false, error: 'Unknown', message: 'erro inesperado' };
  }
};
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/admin && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/admin-api.ts apps/admin/src/lib/check-in-actions.ts
git commit -m "feat(admin): add pickup collect API client and server action

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 5: Scanner UI — StorePickupPanel

**Files:**

- Modify: `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx`

- [ ] **Step 1: Update imports and types in scanner.tsx**

Replace the existing import from `~/lib/check-in-actions` to include the new exports:

```typescript
import {
  submitCheckIn,
  submitExtraClaim,
  submitPickupCollect,
  type CheckInActionResult,
  type ExtraClaimActionResult,
  type PickupCollectActionResult,
} from '~/lib/check-in-actions';
```

Also import the shared type:

```typescript
import type { StorePickupOrder } from '@jdm/shared/check-in';
```

- [ ] **Step 2: Update CheckInActionResult in check-in-actions.ts to include storePickup**

The `ok: true` branch of `CheckInActionResult` needs `storePickup`. Update in `apps/admin/src/lib/check-in-actions.ts`:

```typescript
export type CheckInActionResult =
  | {
      ok: true;
      result: 'admitted' | 'already_used';
      holder: string;
      tier: string;
      checkedInAt: string;
      car: { make: string; model: string; year: number } | null;
      licensePlate: string | null;
      extras: CheckInExtraItem[];
      storePickup: StorePickupOrder[];
    }
  | { ok: false; error: string; message: string };
```

Update `submitCheckIn` to pass through `storePickup`:

```typescript
export const submitCheckIn = async (
  code: string,
  eventId: string,
): Promise<CheckInActionResult> => {
  try {
    const res: TicketCheckInResponse = await apiCheckInTicket({ code, eventId });
    return {
      ok: true,
      result: res.result,
      holder: res.ticket.holder.name,
      tier: res.ticket.tier.name,
      checkedInAt: res.ticket.checkedInAt,
      car: res.ticket.car ?? null,
      licensePlate: res.ticket.licensePlate ?? null,
      extras: res.ticket.extras,
      storePickup: res.storePickup,
    };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, error: err.code, message: err.message };
    }
    return { ok: false, error: 'Unknown', message: 'erro inesperado' };
  }
};
```

Also import `StorePickupOrder` in check-in-actions.ts:

```typescript
import type {
  CheckInExtraItem,
  ExtraClaimResponse,
  StorePickupOrder,
  TicketCheckInResponse,
} from '@jdm/shared/check-in';
```

- [ ] **Step 3: Add TicketResultCard ticketId prop and StorePickupPanel**

In `scanner.tsx`, update `TicketResultCard` to accept `ticketId` and pass storePickup to the panel:

```typescript
function TicketResultCard({
  data,
  ticketId,
  eventId,
  onDismiss,
}: {
  data: CheckInActionResult;
  ticketId: string;
  eventId: string;
  onDismiss: () => void;
}) {
```

Inside `TicketResultCard`, after the `ExtrasPanel`, add:

```typescript
      {data.ok && data.storePickup.length > 0 && (
        <StorePickupPanel ticketId={ticketId} initialOrders={data.storePickup} />
      )}
```

Update the render in `Scanner` to pass `ticketId` (get it from `state.data`):

In the `ScanState` type, the `ticket-result` branch already has `data: CheckInActionResult`. We need to pass the ticket ID to the card. We can store it separately since `CheckInActionResult` doesn't currently include `ticketId` — but we can add it, or we can pass `state.code` and let the server look it up.

Actually the cleanest approach: add `ticketId` to `CheckInActionResult.ok = true` branch. Update `submitCheckIn`:

```typescript
export type CheckInActionResult =
  | {
      ok: true;
      ticketId: string;
      result: 'admitted' | 'already_used';
      holder: string;
      tier: string;
      checkedInAt: string;
      car: { make: string; model: string; year: number } | null;
      licensePlate: string | null;
      extras: CheckInExtraItem[];
      storePickup: StorePickupOrder[];
    }
  | { ok: false; error: string; message: string };
```

And in `submitCheckIn`:

```typescript
    return {
      ok: true,
      ticketId: res.ticket.id,
      result: res.result,
      ...
    };
```

Then `TicketResultCard` does not need a separate `ticketId` prop — it's in `data.ticketId` when `data.ok`.

- [ ] **Step 4: Add StorePickupPanel component to scanner.tsx**

```typescript
function StorePickupPanel({
  ticketId,
  initialOrders,
}: {
  ticketId: string;
  initialOrders: StorePickupOrder[];
}) {
  const [orders, setOrders] = useState<StorePickupOrder[]>(initialOrders);
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);

  const allCollected = orders.every((o) => o.fulfillmentStatus === 'picked_up' || o.fulfillmentStatus === 'cancelled');

  const handleCollect = async () => {
    setCollecting(true);
    setCollectError(null);
    const result = await submitPickupCollect(ticketId);
    if (result.ok) {
      setOrders(
        result.orders.map((o) => ({
          orderId: o.orderId,
          shortId: o.shortId,
          fulfillmentStatus: o.fulfillmentStatus as StorePickupOrder['fulfillmentStatus'],
          items: o.items,
        })),
      );
    } else {
      setCollectError(result.message);
    }
    setCollecting(false);
  };

  return (
    <div className="mt-3 border-t border-[color:var(--color-border)] pt-3">
      <p className="mb-2 text-sm font-semibold">Retirada na loja</p>
      {orders.map((order) => (
        <div key={order.orderId} className="mb-2">
          <p className="text-xs text-muted-foreground mb-1">
            Pedido #{order.shortId}
            {order.fulfillmentStatus === 'picked_up' && (
              <span className="ml-2 text-green-600 font-medium">Coletado</span>
            )}
            {order.fulfillmentStatus === 'cancelled' && (
              <span className="ml-2 text-red-500 font-medium">Cancelado</span>
            )}
          </p>
          <ul className="flex flex-col gap-1">
            {order.items.map((item) => (
              <li key={item.id} className="text-sm">
                <span className="font-medium">{item.productTitle ?? 'Produto'}</span>
                {item.variantName && <span className="ml-1 opacity-70">— {item.variantName}</span>}
                {item.variantSku && <span className="ml-1 opacity-50 text-xs">SKU: {item.variantSku}</span>}
                {item.variantAttributes &&
                  Object.entries(item.variantAttributes).map(([k, v]) => (
                    <span key={k} className="ml-1 text-xs opacity-70">
                      {k}: {v}
                    </span>
                  ))}
                <span className="ml-2 opacity-70">× {item.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {collectError && (
        <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          {collectError}
        </p>
      )}
      {!allCollected && (
        <button
          type="button"
          disabled={collecting}
          onClick={() => void handleCollect()}
          className="mt-2 rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {collecting ? '…' : 'Marcar coletado'}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire TicketResultCard to use data.ticketId and show StorePickupPanel**

In `TicketResultCard`, after `ExtrasPanel`:

```typescript
      {data.storePickup.length > 0 && (
        <StorePickupPanel ticketId={data.ticketId} initialOrders={data.storePickup} />
      )}
```

- [ ] **Step 6: Typecheck admin**

```bash
cd apps/admin && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/lib/check-in-actions.ts \
        apps/admin/app/'(authed)'/check-in/'[eventId]'/scanner.tsx \
        apps/admin/src/lib/admin-api.ts
git commit -m "feat(admin): store pickup panel in check-in scanner

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full API test suite**

```bash
cd apps/api && pnpm vitest run test/admin/check-in.route.test.ts 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 2: Typecheck all packages**

```bash
pnpm --filter @jdm/shared tsc --noEmit && pnpm --filter api tsc --noEmit && pnpm --filter admin tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Open PR**

```bash
git push -u origin feat/jdma-393-checkin-store-pickup
```

Then open PR to `main` with description covering: storePickup in check-in response, collect endpoint, scanner panel, idempotency.
