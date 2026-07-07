# JDMA-39 — F4b 4.11 GET /orders/:id Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `GET /orders/:id` endpoint so the mobile Pix screen can poll order status until `paid` (with `ticketId`) or `expired`, while keeping it cheap, owner-scoped, and rate-limited.

**Architecture:** The route already lives at `apps/api/src/routes/orders.ts` and uses `expireSingleOrder` for lazy-expiry. We extend its response shape (add `provider`, `ticketId?`), differentiate 403 (non-owner) vs 404 (missing), add a per-user rate limit scoped to order polling, and emit a `Cache-Control: no-store` header so intermediaries don't cache pending→paid transitions. We also add an integration test that drives a pending → paid transition through the existing Stripe webhook handler and asserts the next poll returns `paid` with the issued `ticketId`.

**Tech Stack:** Fastify, Prisma, Zod (`@jdm/shared/orders`), `@fastify/rate-limit`, Vitest + real Postgres.

---

## Context Notes (read before starting)

- Source-of-truth roadmap entry: `plans/roadmap.md` §F4b 4.11 (line 514).
- Existing route: `apps/api/src/routes/orders.ts:380-407` (GET handler).
- Existing service: `apps/api/src/services/orders/expire.ts:92-143` (`expireSingleOrder`). It already collapses non-owner into `null` (treated as 404). We must split.
- Existing Zod schema: `packages/shared/src/orders.ts:69-75` (`getOrderResponseSchema`). Must remain backward-compatible with mobile consumers; we ADD fields, don't remove.
- Existing rate-limit pattern: `apps/api/src/routes/auth/index.ts:13-23` registers `@fastify/rate-limit` inside a scoped plugin.
- Mobile poll cadence (per spec): every ~3s while Pix screen open. Provision for ~30 polls/min/user with headroom; cap at 60/min/user/order.
- Tickets attach to orders via `Ticket.orderId` (nullable, `model Ticket` at `packages/db/prisma/schema.prisma:340`). One ticket per order today (`tickets: z.array(...).min(1).max(1)`), but a paid order may have ≥1 issued tickets via the multi-ticket webhook (JDMA-156). Return the FIRST issued ticket id deterministically (oldest by `createdAt asc, id asc`) — mobile UI only needs one to deep-link to the ticket screen.
- Existing test file: `apps/api/test/orders/get.test.ts`. Existing assertion `expect(res.statusCode).toBe(404)` for non-owner WILL break under the new spec (must become 403); we update it.
- Tests must run from `apps/api/`, not repo root (per memory `S3498` — AbacatePay test infra).

---

## File Structure

| Path                                                            | Action                                     | Responsibility                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/orders.ts`                                 | Modify                                     | Extend `getOrderResponseSchema` with `provider`, `ticketId?`.                                                                                  |
| `apps/api/src/services/orders/expire.ts`                        | Modify                                     | Return a discriminated result so the route can split 403 vs 404.                                                                               |
| `apps/api/src/routes/orders.ts`                                 | Modify                                     | Wire `provider` + `ticketId` into response, return 403 for non-owner, set `Cache-Control: no-store`.                                           |
| `apps/api/src/routes/orders/get-rate-limit.ts`                  | Create                                     | Tiny scoped Fastify plugin that registers `@fastify/rate-limit` for the polling route only.                                                    |
| `apps/api/src/app.ts` (or wherever `orderRoutes` is registered) | Modify (only if registration restructured) | Confirm rate-limit plugin is registered — see Task 4 for scope.                                                                                |
| `apps/api/test/orders/get.test.ts`                              | Modify                                     | Update existing 404-for-non-owner test to 403; add `provider` + `ticketId` assertions; add pending→paid via webhook test; add rate-limit test. |
| `plans/roadmap.md`                                              | Modify (last)                              | Flip §F4b 4.11 to `[~]` while in review (NEVER `[x]` until merged + deployed — per AGENTS.md).                                                 |

---

## Task 1: Extend `getOrderResponseSchema` with `provider` + `ticketId`

**Files:**

- Modify: `packages/shared/src/orders.ts:1-8, 69-75`
- Test: covered later via API integration tests; package exports no runtime to test directly.

- [ ] **Step 1: Add `paymentProviderSchema` enum (mirroring Prisma `PaymentProvider`)**

In `packages/shared/src/orders.ts`, just below `paymentMethodSchema`:

```ts
export const paymentProviderSchema = z.enum(['stripe', 'abacatepay']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;
```

- [ ] **Step 2: Extend `getOrderResponseSchema`**

Replace the existing definition (currently lines 69-75):

```ts
export const getOrderResponseSchema = z.object({
  orderId: z.string().min(1),
  status: orderStatusSchema,
  provider: paymentProviderSchema,
  expiresAt: z.string().datetime().nullable(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  ticketId: z.string().min(1).optional(),
});
export type GetOrderResponse = z.infer<typeof getOrderResponseSchema>;
```

- [ ] **Step 3: Typecheck shared**

Run from repo root: `pnpm --filter @jdm/shared typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/orders.ts
git commit -m "feat(shared): extend getOrderResponseSchema with provider + ticketId

JDMA-39 — F4b 4.11: mobile Pix poll needs provider for analytics and
ticketId for deep-link on first paid response.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 2: Split owner-mismatch from missing in `expireSingleOrder`

**Files:**

- Modify: `apps/api/src/services/orders/expire.ts:72-143`
- Test: covered via route tests in Task 5.

- [ ] **Step 1: Update `ExpiredOrderResult` to a discriminated union**

Replace the existing `ExpiredOrderResult` type and the `expireSingleOrder` body so the function returns one of three states: `not_found`, `forbidden`, `ok` (with the order). Keep DB transaction semantics identical.

```ts
export type ExpireSingleOrderOutcome =
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | {
      kind: 'ok';
      wasExpired: boolean;
      order: {
        id: string;
        userId: string;
        tierId: string;
        kind: string;
        status: string;
        expiresAt: Date | null;
        amountCents: number;
        currency: string;
        provider: 'stripe' | 'abacatepay';
        providerRef: string | null;
      };
    };

export const expireSingleOrder = async (
  orderId: string,
  ownerId: string,
): Promise<ExpireSingleOrderOutcome> => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        tierId: true,
        kind: true,
        status: true,
        expiresAt: true,
        amountCents: true,
        currency: true,
        provider: true,
        providerRef: true,
      },
    });
    if (!order) return { kind: 'not_found' };
    if (order.userId !== ownerId) return { kind: 'forbidden' };

    const isStale =
      order.status === 'pending' && order.expiresAt !== null && order.expiresAt < new Date();
    if (!isStale) return { kind: 'ok', wasExpired: false, order };

    await tx.order.updateMany({
      where: { id: orderId, status: 'pending' },
      data: { status: 'expired' },
    });
    if (order.kind !== 'extras_only') {
      await tx.ticketTier.updateMany({
        where: { id: order.tierId, quantitySold: { gt: 0 } },
        data: { quantitySold: { decrement: 1 } },
      });
    }

    const orderExtras = await tx.orderExtra.findMany({
      where: { orderId },
      select: { extraId: true, quantity: true },
    });
    for (const { extraId, quantity } of orderExtras) {
      await tx.ticketExtra.updateMany({
        where: { id: extraId, quantitySold: { gte: quantity } },
        data: { quantitySold: { decrement: quantity } },
      });
    }

    return {
      kind: 'ok',
      wasExpired: true,
      order: { ...order, status: 'expired' },
    };
  });
};
```

- [ ] **Step 2: Remove the now-unused `ExpiredOrderResult` export**

Delete the old `ExpiredOrderResult` type (lines 72-85 in the original).

- [ ] **Step 3: Typecheck API to surface call-site breaks**

Run: `pnpm --filter @jdm/api typecheck`
Expected: errors only at the call site in `apps/api/src/routes/orders.ts` (Task 3 fixes it). If errors appear elsewhere, audit and fix in this task.

- [ ] **Step 4: Commit (deferred — bundle with Task 3 since signature change has no standalone caller). Skip commit; proceed to Task 3.**

---

## Task 3: Update `GET /orders/:id` route — 403, response shape, cache header

**Files:**

- Modify: `apps/api/src/routes/orders.ts:380-407`

- [ ] **Step 1: Update the handler**

Replace the existing handler block with:

```ts
app.get('/orders/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };

  const result = await expireSingleOrder(id, sub);
  if (result.kind === 'not_found') {
    return reply.status(404).send({ error: 'NotFound', message: 'order not found' });
  }
  if (result.kind === 'forbidden') {
    return reply.status(403).send({ error: 'Forbidden', message: 'not your order' });
  }

  const { order, wasExpired } = result;

  if (wasExpired && order.providerRef && order.provider === 'stripe') {
    app.stripe.cancelPaymentIntent(order.providerRef).catch((cancelErr) => {
      request.log.warn(
        { err: cancelErr, orderId: id },
        'orders: stripe PI cancel failed after lazy expiry',
      );
    });
  }

  let ticketId: string | undefined;
  if (order.status === 'paid') {
    const ticket = await prisma.ticket.findFirst({
      where: { orderId: order.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    ticketId = ticket?.id;
  }

  reply.header('Cache-Control', 'no-store');

  return reply.status(200).send(
    getOrderResponseSchema.parse({
      orderId: order.id,
      status: order.status,
      provider: order.provider,
      expiresAt: order.expiresAt?.toISOString() ?? null,
      amountCents: order.amountCents,
      currency: order.currency,
      ...(ticketId ? { ticketId } : {}),
    }),
  );
});
```

> Note: AbacatePay does not expose a "cancel" path the way Stripe does — only invoke `stripe.cancelPaymentIntent` for `provider === 'stripe'` orders. AbacatePay-expired orders just rely on charge TTL + the AbacatePay webhook side handling cancellation upstream (per `services/abacatepay/`).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @jdm/api typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit (still defer — Task 5 brings tests; we want one logical commit per AGENTS.md "logical commits"). Continue.**

---

## Task 4: Add per-user rate limit on `GET /orders/:id`

**Files:**

- Modify: `apps/api/src/routes/orders.ts` (top of `orderRoutes`)

The existing `orderRoutes` plugin registers POST + GET as siblings on the same Fastify instance. We scope the rate limit so only the GET poller is constrained — POST `/orders` and `/orders/checkout` remain unaffected.

- [ ] **Step 1: Move the GET handler inside a scoped sub-plugin with rate-limit**

Wrap only the `app.get('/orders/:id', ...)` block in a `register` scope at the bottom of `orderRoutes`. Add `import rateLimit from '@fastify/rate-limit';` at the top of the file.

```ts
await app.register(async (scoped) => {
  await scoped.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const auth = (req as unknown as { user?: { sub?: string } }).user;
      return auth?.sub ? `order-poll:${auth.sub}` : `order-poll-ip:${req.ip}`;
    },
  });

  scoped.get('/orders/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    // ... handler body from Task 3 ...
  });
});
```

> Cap rationale: 60 req/min/user = 1 poll/sec ceiling, 20× headroom over the 3s mobile cadence. Hits return 429 before any DB work, protecting the lazy-expiry transaction.

- [ ] **Step 2: Confirm `@fastify/rate-limit` is already in `apps/api/package.json` deps**

Run: `cd apps/api && grep '@fastify/rate-limit' package.json`
Expected: a version line (it's already used by auth routes).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @jdm/api typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/services/orders/expire.ts
git commit -m "feat(api): polling-friendly GET /orders/:id

JDMA-39 — F4b 4.11. Returns provider + ticketId, splits 403 vs 404,
adds Cache-Control: no-store, and rate-limits per-user at 60/min so
mobile poll-every-3s cannot DoS the endpoint.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 5: Update existing tests + add new ones

**Files:**

- Modify: `apps/api/test/orders/get.test.ts`

- [ ] **Step 1: Adjust existing happy-path test to assert new fields**

In the `'returns 200 with a live pending order unchanged'` test (line 55), replace the assertion block with:

```ts
expect(res.statusCode).toBe(200);
expect(res.headers['cache-control']).toBe('no-store');
const body = getOrderResponseSchema.parse(res.json());
expect(body.status).toBe('pending');
expect(body.orderId).toBe(order.id);
expect(body.provider).toBe('stripe');
expect(body.amountCents).toBe(5000);
expect(body.currency).toBe('BRL');
expect(body.ticketId).toBeUndefined();
```

- [ ] **Step 2: Flip the non-owner test from 404 to 403**

Replace the `'returns 404 when the order belongs to a different user'` test (line 139) with:

```ts
it('returns 403 when the order belongs to a different user', async () => {
  const { user } = await createUser({ verified: true });
  const { user: other } = await createUser({ email: 'other@jdm.test', verified: true });
  const { event, tier } = await seedPublishedEvent();
  const order = await prisma.order.create({
    data: {
      userId: other.id,
      eventId: event.id,
      tierId: tier.id,
      amountCents: 5000,
      method: 'card',
      provider: 'stripe',
      status: 'pending',
      expiresAt: new Date(Date.now() + 900_000),
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: `/orders/${order.id}`,
    headers: { authorization: bearer(env, user.id) },
  });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ error: 'Forbidden' });
});
```

- [ ] **Step 3: Add pending → paid via Stripe webhook test**

Append to the `describe('GET /orders/:id', ...)` block:

```ts
it('returns paid + ticketId after webhook flips order to paid', async () => {
  const { user } = await createUser({ verified: true });
  const { event, tier } = await seedPublishedEvent();
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      amountCents: 5000,
      method: 'card',
      provider: 'stripe',
      providerRef: 'pi_paid_flow',
      status: 'pending',
      expiresAt: new Date(Date.now() + 900_000),
    },
  });
  await prisma.ticketTier.update({
    where: { id: tier.id },
    data: { quantitySold: 1 },
  });

  // 1st poll: still pending
  const pre = await app.inject({
    method: 'GET',
    url: `/orders/${order.id}`,
    headers: { authorization: bearer(env, user.id) },
  });
  expect(pre.statusCode).toBe(200);
  expect(getOrderResponseSchema.parse(pre.json()).status).toBe('pending');

  // Drive the existing webhook handler to flip to paid + issue ticket.
  const event_ = stripe.makePaymentIntentSucceededEvent({
    paymentIntentId: 'pi_paid_flow',
    metadata: {
      orderId: order.id,
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      tickets: JSON.stringify([{ extras: [] }]),
    },
    amountCents: 5000,
    currency: 'brl',
  });
  const webhookRes = await app.inject({
    method: 'POST',
    url: '/stripe/webhook',
    payload: event_.payload,
    headers: { 'stripe-signature': event_.signature, 'content-type': 'application/json' },
  });
  expect(webhookRes.statusCode).toBe(200);

  // 2nd poll: paid + ticketId
  const post = await app.inject({
    method: 'GET',
    url: `/orders/${order.id}`,
    headers: { authorization: bearer(env, user.id) },
  });
  expect(post.statusCode).toBe(200);
  const paid = getOrderResponseSchema.parse(post.json());
  expect(paid.status).toBe('paid');
  expect(paid.ticketId).toBeDefined();
  const dbTicket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } });
  expect(paid.ticketId).toBe(dbTicket.id);
});
```

> If `stripe.makePaymentIntentSucceededEvent` does not exist on `FakeStripe` with this exact name, mirror the helper used by `apps/api/test/stripe/webhook.test.ts` (read that file first; the helper there is the canonical signing path). If the existing test inlines signing, copy that pattern verbatim. Do not invent a new helper.

- [ ] **Step 4: Add rate-limit smoke test**

Append:

```ts
it('rate-limits the poller after 60 hits/minute/user', async () => {
  const { user } = await createUser({ verified: true });
  const { event, tier } = await seedPublishedEvent();
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      amountCents: 5000,
      method: 'card',
      provider: 'stripe',
      status: 'pending',
      expiresAt: new Date(Date.now() + 900_000),
    },
  });

  let last = 200;
  for (let i = 0; i < 65; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    last = res.statusCode;
    if (last === 429) break;
  }
  expect(last).toBe(429);
});
```

> If the test harness disables rate-limit globally (check `makeAppWithFakeStripe` in `apps/api/test/helpers.ts`), this test must enable it locally or build a dedicated app instance. Do not paper over by deleting the assertion — fix the harness path.

- [ ] **Step 5: Run the test file**

Run from `apps/api/`:

```bash
cd apps/api && pnpm test test/orders/get.test.ts
```

Expected: all tests pass (4 existing + 2 new = 6).

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/orders/get.test.ts
git commit -m "test(api): cover GET /orders/:id polling semantics

JDMA-39: provider+ticketId fields, 403 vs 404 split, pending→paid via
Stripe webhook, and rate-limit ceiling at 60/min/user.

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Task 6: Verification before completion

**Files:** none

- [ ] **Step 1: Full API test suite + typecheck**

Run from `apps/api/`:

```bash
cd apps/api && pnpm typecheck && pnpm test
```

Expected: green typecheck + all tests pass. Capture counts for the PR description.

- [ ] **Step 2: Sanity-check no other route consumer broke from the `expireSingleOrder` signature change**

Run: `grep -rn "expireSingleOrder" apps packages` (use Grep tool).
Expected: only the route in `orders.ts` consumes it. If anything else does, audit + adjust.

- [ ] **Step 3: Update `plans/roadmap.md` 4.11 to in-progress**

Flip line 516's `[ ]` to `[~]` (per AGENTS.md status legend). Do NOT flip to `[x]` — only after merge + deploy.

> AGENTS.md says "avoid changing plan files as much as possible, submit to CTO for review and announce very clearly if you do". The roadmap status flip is the standard ticked-progress edit, not a structural plan change. Announce it in the PR description.

- [ ] **Step 4: Commit roadmap tick**

```bash
git add plans/roadmap.md
git commit -m "docs: mark roadmap §F4b 4.11 in-progress

JDMA-39

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

- [ ] **Step 5: Push + open PR**

Run:

```bash
git push -u origin feat/jdma-39-orders-get
gh pr create --title "feat(api): JDMA-39 GET /orders/:id polling" --body "$(cat <<'EOF'
## Summary
- Extend `getOrderResponseSchema` with `provider` + `ticketId?`.
- Split 403 (non-owner) vs 404 (missing) on the polling endpoint.
- Add `Cache-Control: no-store` so intermediaries don't cache pending→paid transitions.
- Per-user rate limit at 60/min (20× headroom over mobile 3s cadence).
- Roadmap §F4b 4.11 ticked to in-progress.

## Test plan
- [x] `pnpm --filter @jdm/api test`
- [x] `pnpm --filter @jdm/api typecheck`
- [x] New: pending→paid via Stripe webhook returns ticketId.
- [x] New: 65th poll/min returns 429.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run before handoff)

- [x] **Spec coverage:**
  - `{ status, provider, expiresAt, ticketId? }` → Task 1 + Task 3
  - Buyer-only authorization → Task 2 + Task 3 (403 split)
  - Cache-friendly → Task 3 (`Cache-Control: no-store`)
  - Rate-limited → Task 4
  - `apps/api/src/routes/orders/get.ts` → Spec asks for this exact path; the route already lives in `apps/api/src/routes/orders.ts`. Splitting it into a separate file is a refactor adjacent to the bugfix and would expand scope. **Decision: keep the handler in `orders.ts` and call this out for CTO review.** If CTO insists on the file split, add a Task 1.5 to extract.
  - Shared Zod response → Task 1
  - Integration test pending → poll → webhook → paid + ticketId → Task 5 step 3
  - Done-when 403 / 404 → Task 5 steps 2 + (existing 404 test left intact)
- [x] **Placeholder scan:** none.
- [x] **Type consistency:** `expireSingleOrder` outcome `kind` values (`not_found` | `forbidden` | `ok`) match Task 2 → Task 3 → Task 5.

## Open question for CTO (must resolve before merge)

> Spec says **"Deliverables: `apps/api/src/routes/orders/get.ts`"**. The current code keeps GET in `orders.ts` alongside POST. Splitting now would touch route registration in `app.ts`. **Should I (a) ship it inline as planned, or (b) extract to `routes/orders/get.ts` and refactor sibling routes for consistency?** I recommend (a) for blast radius; (b) is a follow-up.
