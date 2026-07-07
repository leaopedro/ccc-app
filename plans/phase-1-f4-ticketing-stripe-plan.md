# Phase 1 · F4 Ticketing (Stripe path) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **> note (2026-05-04, JDMA-225):** product rule is **not** one-ticket-per-user/event. Real invariant is `maxTicketsPerUser` per event; issuance/refund logic must enforce cap as `existingValidCount + order.quantity <= event.maxTicketsPerUser`. Historical text below mentioning one-ticket-per-user should be read as superseded by this note.
>
> **> note (2026-05-05, JDMA-254):** cart redesign follow-up PRs #109/#110/#112/#114 are merged on `main`, but not fully promoted on `production` yet. Do not flip roadmap 4.1–4.7 to `[x]` until post-deploy parity smoke (`C1/C3/C4`, plus `P1/P2` when Pix is in scope) is captured.
>
> **> note (2026-05-13, JDMA-574):** mobile-web resume path for Stripe Checkout Session orders is now URL-based, not API-based. Orders created via hosted Checkout have `Order.providerRef = null`, so `POST /orders/:id/resume` returns 409 for them and the native PaymentSheet resume flow cannot recover the session. The mobile-web fix (PR #276, commit `19cff47`) captures the Stripe Checkout URL at order creation and reopens it from `/profile/orders`, guarded by a fresh `GET /orders/:id` check (only navigate when `status === 'pending'` and `expiresAt` is null or future) and scoped to the canonical (first) order of a multi-order cart to prevent sibling sharing. Pix and native Stripe resume are unchanged. New mobile modules: `src/cart/resume-web-checkout.ts`, `resume-selector.ts`, `web-pending-checkout.ts`, and PT-BR copy keys `payWebUnavailable` / `payWebUnverified`. See "Post-merge follow-ups" at the bottom of this plan.

**Goal:** An authenticated attendee can buy a ticket for a published event via Stripe (card + Apple Pay), receive a server-signed QR-coded `Ticket`, and view it in the mobile "Meus ingressos" tab. Covers roadmap 4.1–4.7. Pix (4.8–4.12) and check-in (F5) are separate plans.

**Architecture:** Reserve-on-create: `POST /orders` atomically increments `TicketTier.quantitySold` inside a transaction gated by remaining capacity, creates a `pending` Order, and creates a Stripe PaymentIntent returning `clientSecret`. Stripe confirms the payment client-side via the RN Payment Sheet. A verified webhook (`payment_intent.succeeded`) marks the Order `paid` and issues a `Ticket` with an HMAC-signed code; `payment_intent.payment_failed` decrements the reservation and marks the Order `failed`. Every webhook is idempotent via a `PaymentWebhookEvent` dedup table and signature-verified. One-ticket-per-(user,event) enforced by a DB unique constraint.

**Tech Stack:** Prisma, Fastify, Zod, `stripe` SDK (Node), `@stripe/stripe-react-native` (mobile), Expo Router, HMAC-SHA256 via `node:crypto`, Vitest + Testcontainers.

**Roadmap tasks covered:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7.

---

## File structure

### `packages/db`

- **Modify** `packages/db/prisma/schema.prisma` — add enums `PaymentMethod`, `PaymentProvider`, `OrderStatus`, `TicketStatus`, `TicketSource`; add models `Order`, `Ticket`, `PaymentWebhookEvent`; add back-relations on `User`, `Event`, `TicketTier`.
- **Create migration** `packages/db/prisma/migrations/<timestamp>_ticketing_stripe/migration.sql` via Prisma.

### `packages/shared`

- **Create** `packages/shared/src/orders.ts` — `paymentMethodSchema`, `orderStatusSchema`, `createOrderRequestSchema`, `createOrderResponseSchema`.
- **Create** `packages/shared/src/tickets.ts` — `ticketStatusSchema`, `ticketSourceSchema`, `myTicketSchema`, `myTicketsResponseSchema`.
- **Modify** `packages/shared/src/index.ts` — re-export `./orders`, `./tickets`.
- **Modify** `packages/shared/package.json` — add `./orders` and `./tickets` to `exports`.

### `apps/api`

- **Modify** `apps/api/src/env.ts` — add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TICKET_CODE_SECRET` (all `z.string().min(32)` required).
- **Create** `apps/api/src/services/stripe/index.ts` — `buildStripe(env)` returning a typed client with `createPaymentIntent()` and `constructWebhookEvent()`. Production impl wraps the `stripe` SDK.
- **Create** `apps/api/src/services/stripe/fake.ts` — test-only fake implementing the same interface; records call history for assertions.
- **Create** `apps/api/src/services/tickets/codes.ts` — `signTicketCode(ticketId, env)`, `verifyTicketCode(code, env)` (HMAC-SHA256).
- **Create** `apps/api/src/services/tickets/issue.ts` — `issueTicketForPaidOrder(orderId, stripePaymentIntentId, env)`; transactional; idempotent.
- **Create** `apps/api/src/routes/orders.ts` — `POST /orders` (authed).
- **Create** `apps/api/src/routes/me-tickets.ts` — `GET /me/tickets` (authed).
- **Create** `apps/api/src/routes/stripe-webhook.ts` — `POST /stripe/webhook`; plugin-scoped raw-body parser, signature verify, dedupe.
- **Modify** `apps/api/src/app.ts` — decorate `app.stripe`; register the three new route plugins.
- **Modify** `apps/api/test/helpers.ts` — extend `resetDatabase` to clear `ticket`, `order`, `paymentWebhookEvent` before `ticketTier`.

### API tests (real Postgres)

- **Create** `apps/api/test/tickets/codes.test.ts` — sign/verify round-trip, tamper detection.
- **Create** `apps/api/test/tickets/issue.test.ts` — concurrency + idempotency + unique-per-event.
- **Create** `apps/api/test/orders/create.test.ts` — happy, sold-out race, already-has-ticket, bad event/tier, unpublished event, unauthenticated.
- **Create** `apps/api/test/orders/me-tickets.test.ts` — lists only own tickets; upcoming vs past; includes valid signed code.
- **Create** `apps/api/test/stripe/webhook.test.ts` — signature missing/bad → 400; dedup; `payment_intent.succeeded` issues ticket; `payment_intent.payment_failed` releases reservation; unknown event types no-op 200.

### `apps/mobile`

- **Modify** `apps/mobile/app.config.ts` — add `stripePublishableKey` to `extra`, read from env.
- **Modify** `apps/mobile/package.json` — add `@stripe/stripe-react-native`.
- **Modify** `apps/mobile/app/_layout.tsx` — wrap app tree in `StripeProvider`.
- **Create** `apps/mobile/src/api/orders.ts` — `createOrder()`.
- **Create** `apps/mobile/src/api/tickets.ts` — `listMyTickets()`.
- **Create** `apps/mobile/src/copy/tickets.ts` — PT-BR copy.
- **Modify** `apps/mobile/src/copy/events.ts` — unlock purchase copy (remove "Em breve").
- **Modify** `apps/mobile/app/(app)/_layout.tsx` — add **Ingressos** tab.
- **Create** `apps/mobile/app/(app)/tickets/_layout.tsx`, `index.tsx`, `[ticketId].tsx`.
- **Modify** `apps/mobile/app/(app)/events/[slug].tsx` — replace disabled CTA with a tier picker that triggers `initPaymentSheet` → `presentPaymentSheet` → success navigation to the new ticket.

### `apps/mobile/app.config.ts` + env

- **Modify** `apps/mobile/.env.example` — document `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

### Docs

- **Modify** `plans/roadmap.md` — flip 4.1–4.7 `[ ]`→`[~]` on branch start; flip to `[x]` in the merge-and-deploy PR.
- **Rewrite** `handoff.md` at PR time.

---

## Conventions (read before any task)

- **Branch:** `feat/f4-ticketing-stripe` off `main`. One PR at the end.
- **Commits:** one per task. Conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- **Money:** integer cents, currency `"BRL"`. Never use floats for money.
- **Reservation model:** `TicketTier.quantitySold` is incremented at **order creation** (not at payment). Released on `payment_intent.payment_failed` or on order abandonment (abandonment cleanup is deferred; tracked in handoff).
- **One-ticket-per-(user,event):** enforced by `@@unique([userId, eventId])` on `Ticket`. `POST /orders` also pre-checks to fail fast with 409 before creating a Stripe PaymentIntent.
- **Webhook discipline:**
  - Signature verification is **mandatory** on `/stripe/webhook`. Missing or bad signature → 400.
  - Dedup via `PaymentWebhookEvent` table, `@@unique([provider, eventId])`. Duplicate delivery is a 200 no-op after insert conflict.
  - Orders flip to `paid` **only** from verified webhooks, never from client calls.
  - Unknown event types return 200 without side effects.
- **Idempotent ticket issuance:** `issueTicketForPaidOrder` is safe to call more than once. Checks `Order.status === 'paid'` first and catches the `Ticket` unique-constraint violation.
- **Raw body for Stripe:** registered in a **sub-plugin scope** (`stripeWebhookRoutes`) using Fastify's encapsulation so the rest of the API still uses normal JSON parsing.
- **Stripe decoration:** `app.stripe` is the only call site for Stripe. Real impl in `src/services/stripe/index.ts`, fake in `src/services/stripe/fake.ts`. Tests replace `app.stripe` right after `makeApp()` returns.
- **Tests hit real Postgres** per CLAUDE.md. Stripe is stubbed because it's an external service, not our DB.
- **No pushes yet:** F6 will subscribe to a `ticketIssued` event or wrap `issueTicketForPaidOrder`. This plan leaves a structured log line in that code path so the push hook has a clear insertion point — no TODO comments.
- **PT-BR copy:** all mobile strings live in `apps/mobile/src/copy/tickets.ts` or existing copy files. No inline strings in screens.
- **Ticket code format:** `<ticketId>.<base64url-hmac-sha256-of-ticketId>`. `TICKET_CODE_SECRET` env var, 32+ chars. QR encodes the full code string.
- **Expo Go limitation:** Stripe RN SDK is a native module. Developer must run `pnpm --filter @jdm/mobile expo run:ios` or `run:android` (local dev client). Expo Go will silently fail. This is documented in the handoff; EAS config (0.9) is not unblocked by this plan.
- **No check-in here:** F5 will consume `verifyTicketCode` and add `POST /admin/tickets/check-in`. Do not add that route in this plan.

---

## Task 1: Plan commit + Prisma schema for Order, Ticket, PaymentWebhookEvent

**Files:**

- Create: `plans/phase-1-f4-ticketing-stripe-plan.md` (this file)
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Create branch and commit plan**

```bash
git checkout -b feat/f4-ticketing-stripe
git add plans/phase-1-f4-ticketing-stripe-plan.md
git commit -m "docs: add F4 ticketing Stripe implementation plan"
```

- [ ] **Step 2: Append new enums and models to `schema.prisma`**

Add to the end of `packages/db/prisma/schema.prisma`:

```prisma
enum PaymentMethod {
  card
  pix
}

enum PaymentProvider {
  stripe
  abacatepay
}

enum OrderStatus {
  pending
  paid
  failed
  refunded
  expired
}

enum TicketStatus {
  valid
  used
  revoked
}

enum TicketSource {
  purchase
  premium_grant
  comp
}

model Order {
  id              String          @id @default(cuid())
  userId          String
  eventId         String
  tierId          String
  amountCents     Int
  currency        String          @default("BRL") @db.VarChar(3)
  method          PaymentMethod
  provider        PaymentProvider
  providerRef     String?         @db.VarChar(200)
  status          OrderStatus     @default(pending)
  paidAt          DateTime?
  failedAt        DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  user   User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  event  Event      @relation(fields: [eventId], references: [id], onDelete: Restrict)
  tier   TicketTier @relation(fields: [tierId], references: [id], onDelete: Restrict)
  ticket Ticket?

  @@unique([provider, providerRef])
  @@index([userId, createdAt])
  @@index([eventId, status])
  @@index([status, createdAt])
}

model Ticket {
  id        String       @id @default(cuid())
  orderId   String?      @unique
  userId    String
  eventId   String
  tierId    String
  source    TicketSource @default(purchase)
  status    TicketStatus @default(valid)
  usedAt    DateTime?
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  order Order?     @relation(fields: [orderId], references: [id], onDelete: SetNull)
  user  User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  event Event      @relation(fields: [eventId], references: [id], onDelete: Restrict)
  tier  TicketTier @relation(fields: [tierId], references: [id], onDelete: Restrict)

  // Partial unique (valid only) added in raw SQL at the end of the migration
  @@index([userId, eventId])
  @@index([userId, createdAt])
  @@index([eventId])
}

model PaymentWebhookEvent {
  id        String          @id @default(cuid())
  provider  PaymentProvider
  eventId   String          @db.VarChar(200)
  payload   Json
  createdAt DateTime        @default(now())

  @@unique([provider, eventId])
  @@index([createdAt])
}
```

- [ ] **Step 3: Add back-relations on existing models**

Edit the existing `User`, `Event`, and `TicketTier` models to add relation fields (no other changes). In `User` (inside the relation block):

```prisma
  orders       Order[]
  tickets      Ticket[]
```

In `Event`:

```prisma
  orders Order[]
  tickets Ticket[]
```

In `TicketTier`:

```prisma
  orders  Order[]
  tickets Ticket[]
```

- [ ] **Step 4: Run the migration**

```bash
pnpm --filter @jdm/db exec prisma migrate dev --name ticketing_stripe
```

Expected: new folder `packages/db/prisma/migrations/<timestamp>_ticketing_stripe/` containing `migration.sql` with `CREATE TYPE` statements for the five enums, `CREATE TABLE "Order"`, `CREATE TABLE "Ticket"`, `CREATE TABLE "PaymentWebhookEvent"`, and associated indexes + unique constraints. Prisma client regenerates.

- [ ] **Step 5: Verify monorepo typecheck**

```bash
pnpm -w typecheck
```

Expected: all packages clean. (`@jdm/db` regenerates types; downstream consumers don't break because nothing uses these models yet.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add Order, Ticket, PaymentWebhookEvent models"
```

---

## Task 2: Shared Zod schemas — orders + tickets

**Files:**

- Create: `packages/shared/src/orders.ts`
- Create: `packages/shared/src/tickets.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Create `packages/shared/src/orders.ts`**

```ts
import { z } from 'zod';

export const paymentMethodSchema = z.enum(['card', 'pix']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const orderStatusSchema = z.enum(['pending', 'paid', 'failed', 'refunded', 'expired']);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const createOrderRequestSchema = z.object({
  eventId: z.string().min(1),
  tierId: z.string().min(1),
  method: paymentMethodSchema,
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

// clientSecret is returned only for card orders (Stripe). Pix uses a different shape in F4b.
export const createOrderResponseSchema = z.object({
  orderId: z.string().min(1),
  status: orderStatusSchema,
  clientSecret: z.string().min(1),
  publishableKey: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;
```

- [ ] **Step 2: Create `packages/shared/src/tickets.ts`**

```ts
import { z } from 'zod';

import { eventSummarySchema } from './events.js';

export const ticketStatusSchema = z.enum(['valid', 'used', 'revoked']);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketSourceSchema = z.enum(['purchase', 'premium_grant', 'comp']);
export type TicketSource = z.infer<typeof ticketSourceSchema>;

export const myTicketSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  status: ticketStatusSchema,
  source: ticketSourceSchema,
  tierName: z.string().min(1),
  usedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  event: eventSummarySchema,
});
export type MyTicket = z.infer<typeof myTicketSchema>;

export const myTicketsResponseSchema = z.object({
  items: z.array(myTicketSchema),
});
export type MyTicketsResponse = z.infer<typeof myTicketsResponseSchema>;
```

- [ ] **Step 3: Re-export from `packages/shared/src/index.ts`**

Add the two new exports alongside the existing ones:

```ts
export * from './ids';
export * from './health';
export * from './profile';
export * from './cars';
export * from './uploads';
export * from './events';
export * from './admin';
export * from './orders';
export * from './tickets';
```

- [ ] **Step 4: Add subpath exports to `packages/shared/package.json`**

In the `exports` block, add two entries (keep alphabetical order):

```jsonc
  "exports": {
    ".": "./src/index.ts",
    "./admin": "./src/admin.ts",
    "./auth": "./src/auth.ts",
    "./cars": "./src/cars.ts",
    "./events": "./src/events.ts",
    "./health": "./src/health.ts",
    "./ids": "./src/ids.ts",
    "./orders": "./src/orders.ts",
    "./profile": "./src/profile.ts",
    "./tickets": "./src/tickets.ts",
    "./uploads": "./src/uploads.ts"
  },
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @jdm/shared typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/orders.ts packages/shared/src/tickets.ts \
        packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(shared): add order + ticket zod schemas"
```

---

## Task 3: Env vars + Stripe service wrapper (+ test fake)

**Files:**

- Modify: `apps/api/src/env.ts`
- Create: `apps/api/src/services/stripe/index.ts`
- Create: `apps/api/src/services/stripe/fake.ts`
- Modify: `apps/api/package.json` (add `stripe` dependency)

- [ ] **Step 1: Add env vars**

Edit `apps/api/src/env.ts`. Insert three new entries in the `envSchema` object (anywhere after `APPLE_CLIENT_ID` is fine):

```ts
  STRIPE_SECRET_KEY: z.string().min(32),
  STRIPE_WEBHOOK_SECRET: z.string().min(32),
  TICKET_CODE_SECRET: z.string().min(32),
```

Also add them to `apps/api/.env.example` (check it exists; if not, skip):

```
STRIPE_SECRET_KEY=sk_test_redacted_replace_me_with_32_plus_chars
STRIPE_WEBHOOK_SECRET=whsec_redacted_replace_me_with_32_plus_chars
TICKET_CODE_SECRET=dev_only_ticket_hmac_secret_32_plus_chars
```

- [ ] **Step 2: Install `stripe` SDK**

```bash
pnpm --filter @jdm/api add stripe
```

Expected: `apps/api/package.json` gets `"stripe": "^latest"`; `pnpm-lock.yaml` updates.

- [ ] **Step 3: Create `apps/api/src/services/stripe/index.ts`**

```ts
import Stripe from 'stripe';

export type PaymentIntentResult = {
  id: string;
  clientSecret: string;
};

export type CreatePaymentIntentInput = {
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export type WebhookEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export type StripeClient = {
  createPaymentIntent: (input: CreatePaymentIntentInput) => Promise<PaymentIntentResult>;
  constructWebhookEvent: (payload: Buffer, signature: string) => WebhookEvent;
  refund: (paymentIntentId: string, reason: string) => Promise<void>;
  publishableKey: () => string;
};

type StripeEnv = {
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_WEBHOOK_SECRET: string;
  readonly STRIPE_PUBLISHABLE_KEY?: string;
};

export const buildStripe = (env: StripeEnv): StripeClient => {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-10-28.acacia' });

  return {
    createPaymentIntent: async ({ amountCents, currency, metadata, idempotencyKey }) => {
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: currency.toLowerCase(),
          metadata,
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey },
      );
      if (!pi.client_secret) throw new Error('stripe paymentIntent missing client_secret');
      return { id: pi.id, clientSecret: pi.client_secret };
    },
    constructWebhookEvent: (payload, signature) => {
      const event = stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
      return {
        id: event.id,
        type: event.type,
        data: { object: event.data.object as unknown as Record<string, unknown> },
      };
    },
    refund: async (paymentIntentId, reason) => {
      await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: { reason },
      });
    },
    publishableKey: () => env.STRIPE_PUBLISHABLE_KEY ?? '',
  };
};
```

> Note: `STRIPE_PUBLISHABLE_KEY` is optional in the API env (the mobile app has its own copy). If set, it's echoed back in `createOrderResponse.publishableKey` as a convenience so the mobile client doesn't need to read two env vars. Add it to `env.ts` as `STRIPE_PUBLISHABLE_KEY: z.string().optional()` alongside the two required entries.

- [ ] **Step 4: Add `STRIPE_PUBLISHABLE_KEY` to `env.ts`**

In the same file edited in Step 1, add:

```ts
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
```

- [ ] **Step 5: Create the test fake `apps/api/src/services/stripe/fake.ts`**

```ts
import type {
  CreatePaymentIntentInput,
  PaymentIntentResult,
  StripeClient,
  WebhookEvent,
} from './index.js';

type FakeCall = {
  kind: 'createPaymentIntent' | 'refund';
  payload: unknown;
};

export type FakeStripe = StripeClient & {
  calls: FakeCall[];
  nextPaymentIntent: { id: string; clientSecret: string };
  nextSignatureValid: boolean;
  nextEvent: WebhookEvent | null;
};

export const buildFakeStripe = (): FakeStripe => {
  const fake: FakeStripe = {
    calls: [],
    nextPaymentIntent: { id: 'pi_test_1', clientSecret: 'pi_test_1_secret_abc' },
    nextSignatureValid: true,
    nextEvent: null,
    createPaymentIntent: async (input: CreatePaymentIntentInput): Promise<PaymentIntentResult> => {
      fake.calls.push({ kind: 'createPaymentIntent', payload: input });
      return fake.nextPaymentIntent;
    },
    constructWebhookEvent: (_payload, _signature) => {
      if (!fake.nextSignatureValid) {
        const err = new Error('signature verification failed');
        err.name = 'StripeSignatureVerificationError';
        throw err;
      }
      if (!fake.nextEvent) throw new Error('FakeStripe.nextEvent not set');
      return fake.nextEvent;
    },
    refund: async (paymentIntentId, reason) => {
      fake.calls.push({ kind: 'refund', payload: { paymentIntentId, reason } });
    },
    publishableKey: () => 'pk_test_fake',
  };
  return fake;
};
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: clean. (`app.stripe` decoration happens in Task 6.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/env.ts apps/api/src/services/stripe/ \
        apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add Stripe client service + test fake + env"
```

---

## Task 4: Ticket code HMAC service — TDD

**Files:**

- Create: `apps/api/src/services/tickets/codes.ts`
- Create: `apps/api/test/tickets/codes.test.ts`

- [ ] **Step 1: Write failing tests** — `apps/api/test/tickets/codes.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { signTicketCode, verifyTicketCode } from '../../src/services/tickets/codes.js';

const env = { TICKET_CODE_SECRET: 'a'.repeat(32) };

describe('ticket codes', () => {
  it('signs and verifies a round-trip', () => {
    const code = signTicketCode('ticket_123', env);
    expect(code.startsWith('ticket_123.')).toBe(true);
    expect(verifyTicketCode(code, env)).toBe('ticket_123');
  });

  it('rejects tampered ticket id', () => {
    const code = signTicketCode('ticket_123', env);
    const [, sig] = code.split('.');
    expect(() => verifyTicketCode(`ticket_999.${sig}`, env)).toThrow();
  });

  it('rejects tampered signature', () => {
    const code = signTicketCode('ticket_123', env);
    const [id] = code.split('.');
    expect(() => verifyTicketCode(`${id}.deadbeef`, env)).toThrow();
  });

  it('rejects malformed code', () => {
    expect(() => verifyTicketCode('no-dot-here', env)).toThrow();
    expect(() => verifyTicketCode('', env)).toThrow();
  });

  it('signatures differ across secrets', () => {
    const a = signTicketCode('t1', { TICKET_CODE_SECRET: 'a'.repeat(32) });
    const b = signTicketCode('t1', { TICKET_CODE_SECRET: 'b'.repeat(32) });
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @jdm/api test -- tickets/codes
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/api/src/services/tickets/codes.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

type CodeEnv = { readonly TICKET_CODE_SECRET: string };

const sign = (ticketId: string, secret: string): string =>
  createHmac('sha256', secret).update(ticketId).digest('base64url');

export const signTicketCode = (ticketId: string, env: CodeEnv): string => {
  if (!ticketId) throw new Error('ticketId required');
  return `${ticketId}.${sign(ticketId, env.TICKET_CODE_SECRET)}`;
};

export const verifyTicketCode = (code: string, env: CodeEnv): string => {
  const dot = code.indexOf('.');
  if (dot <= 0 || dot === code.length - 1) throw new Error('malformed ticket code');
  const ticketId = code.slice(0, dot);
  const provided = code.slice(dot + 1);
  const expected = sign(ticketId, env.TICKET_CODE_SECRET);
  const a = Buffer.from(provided, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('invalid ticket code signature');
  }
  return ticketId;
};
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @jdm/api test -- tickets/codes
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/tickets/codes.ts apps/api/test/tickets/codes.test.ts
git commit -m "feat(api): HMAC ticket-code sign + verify"
```

---

## Task 5: Ticket issuance service (transactional, idempotent) — TDD

**Files:**

- Create: `apps/api/src/services/tickets/issue.ts`
- Create: `apps/api/test/tickets/issue.test.ts`
- Modify: `apps/api/test/helpers.ts` (extend `resetDatabase`)

- [ ] **Step 1: Extend `resetDatabase`**

Edit `apps/api/test/helpers.ts`. Add three new `deleteMany` calls at the top of `resetDatabase`, before the existing ones:

```ts
export const resetDatabase = async (): Promise<void> => {
  await prisma.ticket.deleteMany();
  await prisma.order.deleteMany();
  await prisma.paymentWebhookEvent.deleteMany();
  await prisma.adminAudit.deleteMany();
  await prisma.ticketTier.deleteMany();
  await prisma.event.deleteMany();
  await prisma.carPhoto.deleteMany();
  await prisma.car.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.authProvider.deleteMany();
  await prisma.user.deleteMany();
};
```

- [ ] **Step 2: Write failing tests** — `apps/api/test/tickets/issue.test.ts`

```ts
import { prisma } from '@jdm/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { issueTicketForPaidOrder } from '../../src/services/tickets/issue.js';
import { verifyTicketCode } from '../../src/services/tickets/codes.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedEventAndTier = async (quantityTotal = 1) => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      lat: 0,
      lng: 0,
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: quantityTotal,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal,
      quantitySold: 1, // order creation will have bumped this; issuance does not re-bump
      sortOrder: 0,
    },
  });
  return { event, tier };
};

const createPendingOrder = async (userId: string, eventId: string, tierId: string) => {
  return prisma.order.create({
    data: {
      userId,
      eventId,
      tierId,
      amountCents: 5000,
      method: 'card',
      provider: 'stripe',
      providerRef: `pi_test_${Math.random().toString(36).slice(2, 10)}`,
      status: 'pending',
    },
  });
};

describe('issueTicketForPaidOrder', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('marks order paid and issues a ticket with a valid signed code', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier();
    const order = await createPendingOrder(user.id, event.id, tier.id);

    const result = await issueTicketForPaidOrder(order.id, order.providerRef!, env);
    expect(result.ticketId).toBeTruthy();

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');
    expect(reloaded.paidAt).not.toBeNull();

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(ticket.status).toBe('valid');
    expect(ticket.source).toBe('purchase');
    expect(ticket.userId).toBe(user.id);
    expect(ticket.eventId).toBe(event.id);

    const code = result.code;
    expect(verifyTicketCode(code, env)).toBe(ticket.id);
  });

  it('is idempotent — calling twice returns the same ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier();
    const order = await createPendingOrder(user.id, event.id, tier.id);

    const a = await issueTicketForPaidOrder(order.id, order.providerRef!, env);
    const b = await issueTicketForPaidOrder(order.id, order.providerRef!, env);

    expect(a.ticketId).toBe(b.ticketId);
    const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
    expect(tickets).toHaveLength(1);
  });

  it('throws if order is already failed (webhook ordering bug)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier();
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        amountCents: 5000,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_test_failed',
        status: 'failed',
        failedAt: new Date(),
      },
    });
    await expect(issueTicketForPaidOrder(order.id, 'pi_test_failed', env)).rejects.toThrow(
      /order is not pending/i,
    );
  });

  it('throws if user already has a ticket for this event (premium-grant race, future F8)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedEventAndTier(2);
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'comp',
        status: 'valid',
      },
    });
    const order = await createPendingOrder(user.id, event.id, tier.id);

    await expect(issueTicketForPaidOrder(order.id, order.providerRef!, env)).rejects.toThrow(
      /already has a valid ticket/i,
    );

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('pending'); // caller decides to refund
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
pnpm --filter @jdm/api test -- tickets/issue
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `apps/api/src/services/tickets/issue.ts`**

```ts
import { prisma } from '@jdm/db';

import { signTicketCode } from './codes.js';

type IssueEnv = { readonly TICKET_CODE_SECRET: string };

export type IssueResult = { ticketId: string; code: string };

export const issueTicketForPaidOrder = async (
  orderId: string,
  providerRef: string,
  env: IssueEnv,
): Promise<IssueResult> => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error(`order ${orderId} not found`);

    // Idempotent: already paid → reuse existing ticket.
    if (order.status === 'paid') {
      const existing = await tx.ticket.findUnique({ where: { orderId } });
      if (!existing) throw new Error(`order ${orderId} is paid but has no ticket`);
      return { ticketId: existing.id, code: signTicketCode(existing.id, env) };
    }

    if (order.status !== 'pending') {
      throw new Error(`order ${orderId} is not pending (status=${order.status})`);
    }

    // One-valid-ticket-per-(user,event) invariant — block before insert so we
    // can refund at the caller rather than eating a unique-constraint error.
    const conflict = await tx.ticket.findUnique({
      where: { userId_eventId: { userId: order.userId, eventId: order.eventId } },
    });
    if (conflict) {
      throw new Error(`user ${order.userId} already has a valid ticket for event ${order.eventId}`);
    }

    const ticket = await tx.ticket.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        eventId: order.eventId,
        tierId: order.tierId,
        source: 'purchase',
        status: 'valid',
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'paid', paidAt: new Date(), providerRef },
    });

    return { ticketId: ticket.id, code: signTicketCode(ticket.id, env) };
  });
};
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @jdm/api test -- tickets/issue
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/tickets/issue.ts apps/api/test/tickets/issue.test.ts \
        apps/api/test/helpers.ts
git commit -m "feat(api): transactional idempotent ticket issuance"
```

---

## Task 6: Decorate `app.stripe` + wire makeApp helper for fake

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/helpers.ts`

- [ ] **Step 1: Decorate `app.stripe`**

Edit `apps/api/src/app.ts`. Add import near the other service imports:

```ts
import { buildStripe, type StripeClient } from './services/stripe/index.js';
```

Extend the `FastifyInstance` module declaration:

```ts
declare module 'fastify' {
  interface FastifyInstance {
    mailer: Mailer;
    env: Env;
    uploads: Uploads;
    stripe: StripeClient;
  }
}
```

Inside `buildApp`, decorate alongside existing ones:

```ts
app.decorate('stripe', buildStripe(env));
```

- [ ] **Step 2: Expose a fake-injection hook in tests**

Edit `apps/api/test/helpers.ts`. Add an overload on `makeApp` that lets tests swap `app.stripe` before routes are registered:

```ts
import type { FakeStripe } from '../src/services/stripe/fake.js';
import { buildFakeStripe } from '../src/services/stripe/fake.js';

export const makeApp = () => buildApp(loadEnv());

export const makeAppWithFakeStripe = async (): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  stripe: FakeStripe;
}> => {
  const app = await buildApp(loadEnv());
  const stripe = buildFakeStripe();
  // Replace the real client; decorate() stashed one already, so overwrite.
  (app as unknown as { stripe: FakeStripe }).stripe = stripe;
  return { app, stripe };
};
```

> Note: `app.decorate` disallows replacement in strict mode; overwriting via the cast works because all reads go through the decorated accessor after registration. If Fastify throws at runtime, switch the strategy: pass an optional `stripe?: StripeClient` param to `buildApp` and let tests pass `buildFakeStripe()` directly.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.ts apps/api/test/helpers.ts
git commit -m "feat(api): decorate app.stripe + test fake injection"
```

---

## Task 7: API — `POST /orders` (reserve-on-create) — TDD

**Files:**

- Create: `apps/api/src/routes/orders.ts`
- Modify: `apps/api/src/app.ts` (register)
- Create: `apps/api/test/orders/create.test.ts`

- [ ] **Step 1: Write failing tests** — `apps/api/test/orders/create.test.ts`

```ts
import { prisma } from '@jdm/db';
import { createOrderResponseSchema } from '@jdm/shared/orders';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedPublishedEvent = async (quantityTotal = 10) => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      lat: 0,
      lng: 0,
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: quantityTotal,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal,
      sortOrder: 0,
    },
  });
  return { event, tier };
};

describe('POST /orders', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a pending order, bumps quantitySold, and returns clientSecret', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card' },
    });

    expect(res.statusCode).toBe(201);
    const body = createOrderResponseSchema.parse(res.json());
    expect(body.status).toBe('pending');
    expect(body.amountCents).toBe(5000);
    expect(body.clientSecret).toBe('pi_test_1_secret_abc');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.status).toBe('pending');
    expect(order.providerRef).toBe('pi_test_1');

    const reloaded = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloaded.quantitySold).toBe(1);

    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0]!.kind).toBe('createPaymentIntent');
  });

  it('returns 409 when the tier is sold out', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent(1);
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { quantitySold: 1 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
    expect(stripe.calls).toHaveLength(0); // no Stripe call if reservation fails
  });

  it('returns 409 when the user already has a valid ticket for the event', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await prisma.ticket.create({
      data: { userId: user.id, eventId: event.id, tierId: tier.id, source: 'comp' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card' },
    });

    expect(res.statusCode).toBe(409);
    expect(stripe.calls).toHaveLength(0);
  });

  it('returns 404 when the event is not published', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    await prisma.event.update({ where: { id: event.id }, data: { status: 'draft' } });

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'card' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the tier does not belong to the event', async () => {
    const { user } = await createUser({ verified: true });
    const { event } = await seedPublishedEvent();
    const otherEvent = await seedPublishedEvent();

    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: otherEvent.tier.id, method: 'card' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const { event, tier } = await seedPublishedEvent();
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { eventId: event.id, tierId: tier.id, method: 'card' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects Pix method with 400 (Pix ships in F4b)', async () => {
    const { user } = await createUser({ verified: true });
    const { event, tier } = await seedPublishedEvent();
    const res = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { authorization: bearer(env, user.id) },
      payload: { eventId: event.id, tierId: tier.id, method: 'pix' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @jdm/api test -- orders/create
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement `apps/api/src/routes/orders.ts`**

```ts
import { prisma } from '@jdm/db';
import { createOrderRequestSchema, createOrderResponseSchema } from '@jdm/shared/orders';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.post('/orders', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);
    const input = createOrderRequestSchema.parse(request.body);

    if (input.method !== 'card') {
      return reply
        .status(400)
        .send({ error: 'BadRequest', message: 'only card is supported in this release' });
    }

    const event = await prisma.event.findFirst({
      where: { id: input.eventId, status: 'published' },
    });
    if (!event) return reply.status(404).send({ error: 'NotFound', message: 'event not found' });

    const tier = await prisma.ticketTier.findFirst({
      where: { id: input.tierId, eventId: event.id },
    });
    if (!tier) return reply.status(404).send({ error: 'NotFound', message: 'tier not found' });

    const existingTicket = await prisma.ticket.findUnique({
      where: { userId_eventId: { userId: sub, eventId: event.id } },
    });
    if (existingTicket) {
      return reply
        .status(409)
        .send({ error: 'Conflict', message: 'already has a ticket for this event' });
    }

    // Atomic reserve: increment quantitySold only if capacity remains.
    const reservation = await prisma.ticketTier.updateMany({
      where: { id: tier.id, quantitySold: { lt: tier.quantityTotal } },
      data: { quantitySold: { increment: 1 } },
    });
    if (reservation.count === 0) {
      return reply.status(409).send({ error: 'Conflict', message: 'sold out' });
    }

    // From here on, any failure must release the reservation.
    try {
      const order = await prisma.order.create({
        data: {
          userId: sub,
          eventId: event.id,
          tierId: tier.id,
          amountCents: tier.priceCents,
          currency: tier.currency,
          method: 'card',
          provider: 'stripe',
          status: 'pending',
        },
      });

      const intent = await app.stripe.createPaymentIntent({
        amountCents: tier.priceCents,
        currency: tier.currency,
        idempotencyKey: order.id,
        metadata: {
          orderId: order.id,
          userId: sub,
          eventId: event.id,
          tierId: tier.id,
        },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { providerRef: intent.id },
      });

      return reply.status(201).send(
        createOrderResponseSchema.parse({
          orderId: order.id,
          status: 'pending',
          clientSecret: intent.clientSecret,
          publishableKey: app.stripe.publishableKey(),
          amountCents: tier.priceCents,
          currency: tier.currency,
        }),
      );
    } catch (err) {
      await prisma.ticketTier.update({
        where: { id: tier.id },
        data: { quantitySold: { decrement: 1 } },
      });
      throw err;
    }
  });
};
```

- [ ] **Step 4: Register in `apps/api/src/app.ts`**

Add the import:

```ts
import { orderRoutes } from './routes/orders.js';
```

Register after `eventRoutes`:

```ts
await app.register(eventRoutes);
await app.register(orderRoutes);
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @jdm/api test -- orders/create
```

Expected: 7 tests PASS.

- [ ] **Step 6: Run full suite + typecheck**

```bash
pnpm --filter @jdm/api test
pnpm -w typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/orders.ts apps/api/src/app.ts apps/api/test/orders/create.test.ts
git commit -m "feat(api): POST /orders reserves capacity + creates Stripe PaymentIntent"
```

---

## Task 8: API — `POST /stripe/webhook` (raw body, signature, dedup, dispatch) — TDD

**Files:**

- Create: `apps/api/src/routes/stripe-webhook.ts`
- Modify: `apps/api/src/app.ts` (register)
- Create: `apps/api/test/stripe/webhook.test.ts`

- [ ] **Step 1: Write failing tests** — `apps/api/test/stripe/webhook.test.ts`

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const rawJson = (v: unknown) => Buffer.from(JSON.stringify(v));

const seedEventTierOrder = async (userId: string) => {
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento',
      description: 'desc',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      venueName: 'v',
      venueAddress: 'a',
      lat: 0,
      lng: 0,
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: 5,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal: 5,
      quantitySold: 1, // simulates a prior reservation
      sortOrder: 0,
    },
  });
  const order = await prisma.order.create({
    data: {
      userId,
      eventId: event.id,
      tierId: tier.id,
      amountCents: 5000,
      method: 'card',
      provider: 'stripe',
      providerRef: 'pi_test_abc',
      status: 'pending',
    },
  });
  return { event, tier, order };
};

describe('POST /stripe/webhook', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when the stripe-signature header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json' },
      payload: rawJson({ id: 'evt_1' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    stripe.nextSignatureValid = false;
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'bad' },
      payload: rawJson({ id: 'evt_1' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('handles payment_intent.succeeded: marks order paid + issues ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);

    stripe.nextEvent = {
      id: 'evt_success_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('paid');

    const ticket = await prisma.ticket.findFirst({ where: { orderId: order.id } });
    expect(ticket).not.toBeNull();
  });

  it('is idempotent: redelivery of the same event does not re-issue a ticket', async () => {
    const { user } = await createUser({ verified: true });
    const { order } = await seedEventTierOrder(user.id);

    stripe.nextEvent = {
      id: 'evt_success_dup',
      type: 'payment_intent.succeeded',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(second.statusCode).toBe(200);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(1);
  });

  it('handles payment_intent.payment_failed: marks order failed + releases reservation', async () => {
    const { user } = await createUser({ verified: true });
    const { tier, order } = await seedEventTierOrder(user.id);

    stripe.nextEvent = {
      id: 'evt_fail_1',
      type: 'payment_intent.payment_failed',
      data: { object: { id: order.providerRef, metadata: { orderId: order.id } } },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe('failed');

    const reloadedTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(reloadedTier.quantitySold).toBe(0);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets).toHaveLength(0);
  });

  it('no-ops on unknown event type', async () => {
    stripe.nextEvent = {
      id: 'evt_unknown_1',
      type: 'charge.captured',
      data: { object: {} },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=x' },
      payload: rawJson(stripe.nextEvent),
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @jdm/api test -- stripe/webhook
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/api/src/routes/stripe-webhook.ts`**

```ts
import { prisma } from '@jdm/db';
import type { FastifyPluginAsync } from 'fastify';

import { issueTicketForPaidOrder } from '../services/tickets/issue.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const stripeWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Scoped parser: Stripe signature verification needs the raw bytes.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/stripe/webhook', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string' || signature.length === 0) {
      return reply.status(400).send({ error: 'BadRequest', message: 'missing signature' });
    }
    const raw = request.body as Buffer;
    let event;
    try {
      event = app.stripe.constructWebhookEvent(raw, signature);
    } catch {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid signature' });
    }

    // Dedupe by (provider, event.id). Unique-constraint violation → already processed.
    try {
      await prisma.paymentWebhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: event.id,
          payload: event as unknown as object,
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2002') return reply.status(200).send({ ok: true, deduped: true });
      throw err;
    }

    const intent = event.data.object as { id?: string; metadata?: Record<string, string> };
    const orderId = intent.metadata?.orderId;

    if (event.type === 'payment_intent.succeeded' && orderId && intent.id) {
      await issueTicketForPaidOrder(orderId, intent.id, app.env);
      request.log.info({ orderId, paymentIntentId: intent.id }, 'ticket issued');
      return reply.status(200).send({ ok: true });
    }

    if (event.type === 'payment_intent.payment_failed' && orderId) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (order && order.status === 'pending') {
        await prisma.$transaction([
          prisma.order.update({
            where: { id: order.id },
            data: { status: 'failed', failedAt: new Date() },
          }),
          prisma.ticketTier.update({
            where: { id: order.tierId },
            data: { quantitySold: { decrement: 1 } },
          }),
        ]);
      }
      return reply.status(200).send({ ok: true });
    }

    return reply.status(200).send({ ok: true, ignored: true });
  });
};
```

- [ ] **Step 4: Register in `apps/api/src/app.ts`**

Add the import:

```ts
import { stripeWebhookRoutes } from './routes/stripe-webhook.js';
```

Register after `orderRoutes`:

```ts
await app.register(orderRoutes);
await app.register(stripeWebhookRoutes);
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @jdm/api test -- stripe/webhook
```

Expected: 6 tests PASS.

- [ ] **Step 6: Run full API suite + typecheck**

```bash
pnpm --filter @jdm/api test
pnpm -w typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/stripe-webhook.ts apps/api/src/app.ts \
        apps/api/test/stripe/webhook.test.ts
git commit -m "feat(api): POST /stripe/webhook — verify, dedupe, issue tickets"
```

---

## Task 9: API — `GET /me/tickets` — TDD

**Files:**

- Create: `apps/api/src/routes/me-tickets.ts`
- Modify: `apps/api/src/app.ts` (register)
- Create: `apps/api/test/orders/me-tickets.test.ts`

- [ ] **Step 1: Write failing tests** — `apps/api/test/orders/me-tickets.test.ts`

```ts
import { prisma } from '@jdm/db';
import { myTicketsResponseSchema } from '@jdm/shared/tickets';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { verifyTicketCode } from '../../src/services/tickets/codes.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedTicketFor = async (userId: string, opts: { past?: boolean } = {}) => {
  const when = opts.past ? Date.now() - 30 * 86400_000 : Date.now() + 86400_000;
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Evento',
      description: 'desc',
      startsAt: new Date(when),
      endsAt: new Date(when + 3600_000),
      venueName: 'v',
      venueAddress: 'a',
      lat: 0,
      lng: 0,
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meeting',
      status: 'published',
      capacity: 1,
      publishedAt: new Date(),
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Geral',
      priceCents: 5000,
      quantityTotal: 1,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  return prisma.ticket.create({
    data: { userId, eventId: event.id, tierId: tier.id, source: 'purchase' },
  });
};

describe('GET /me/tickets', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns only the caller tickets with a valid signed code', async () => {
    const { user } = await createUser({ verified: true });
    const other = await createUser({ email: 'b@jdm.test', verified: true });
    const mine = await seedTicketFor(user.id);
    await seedTicketFor(other.user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = myTicketsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(mine.id);
    expect(verifyTicketCode(body.items[0]!.code, env)).toBe(mine.id);
  });

  it('lists upcoming first then past, sorted by event startsAt', async () => {
    const { user } = await createUser({ verified: true });
    await seedTicketFor(user.id, { past: true });
    await seedTicketFor(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/me/tickets',
      headers: { authorization: bearer(env, user.id) },
    });
    const body = myTicketsResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(2);
    // upcoming first (startsAt in the future), past last
    expect(new Date(body.items[0]!.event.startsAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(body.items[1]!.event.startsAt).getTime()).toBeLessThan(Date.now());
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/tickets' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @jdm/api test -- orders/me-tickets
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/api/src/routes/me-tickets.ts`**

```ts
import { prisma } from '@jdm/db';
import { eventSummarySchema } from '@jdm/shared/events';
import { myTicketsResponseSchema } from '@jdm/shared/tickets';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { signTicketCode } from '../services/tickets/codes.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const meTicketsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/tickets', { preHandler: [app.authenticate] }, async (request) => {
    const { sub } = requireUser(request);
    const tickets = await prisma.ticket.findMany({
      where: { userId: sub },
      include: { event: true, tier: true },
    });

    const now = Date.now();
    const sorted = tickets.slice().sort((a, b) => {
      const aFuture = a.event.startsAt.getTime() >= now;
      const bFuture = b.event.startsAt.getTime() >= now;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      // Upcoming: earliest first. Past: latest first.
      return aFuture
        ? a.event.startsAt.getTime() - b.event.startsAt.getTime()
        : b.event.startsAt.getTime() - a.event.startsAt.getTime();
    });

    return myTicketsResponseSchema.parse({
      items: sorted.map((t) => ({
        id: t.id,
        code: signTicketCode(t.id, app.env),
        status: t.status,
        source: t.source,
        tierName: t.tier.name,
        usedAt: t.usedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        event: eventSummarySchema.parse({
          id: t.event.id,
          slug: t.event.slug,
          title: t.event.title,
          coverUrl: t.event.coverObjectKey
            ? app.uploads.buildPublicUrl(t.event.coverObjectKey)
            : null,
          startsAt: t.event.startsAt.toISOString(),
          endsAt: t.event.endsAt.toISOString(),
          venueName: t.event.venueName,
          city: t.event.city,
          stateCode: t.event.stateCode,
          type: t.event.type,
        }),
      })),
    });
  });
};
```

- [ ] **Step 4: Register in `apps/api/src/app.ts`**

Add import:

```ts
import { meTicketsRoutes } from './routes/me-tickets.js';
```

Register near the other `me` route (order: `meRoutes`, then `meTicketsRoutes`):

```ts
await app.register(meRoutes);
await app.register(meTicketsRoutes);
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @jdm/api test -- orders/me-tickets
```

Expected: 3 tests PASS.

- [ ] **Step 6: Run full suite**

```bash
pnpm --filter @jdm/api test
```

Expected: all green (previous 121 + ~22 new ≈ 143).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/me-tickets.ts apps/api/src/app.ts \
        apps/api/test/orders/me-tickets.test.ts
git commit -m "feat(api): GET /me/tickets with signed codes"
```

---

## Task 10: Mobile — Stripe SDK install, provider wiring, copy, API clients

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/.env.example` (if exists)
- Modify: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/src/api/orders.ts`
- Create: `apps/mobile/src/api/tickets.ts`
- Create: `apps/mobile/src/copy/tickets.ts`
- Modify: `apps/mobile/src/copy/events.ts`

- [ ] **Step 1: Install `@stripe/stripe-react-native`**

```bash
pnpm --filter @jdm/mobile add @stripe/stripe-react-native
```

- [ ] **Step 2: Add publishable key to `app.config.ts`**

Edit `apps/mobile/app.config.ts`. In the `extra` object, add:

```ts
stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
```

Document in `apps/mobile/.env.example`:

```
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_redacted_replace_me
```

- [ ] **Step 3: Wrap root layout in `StripeProvider`**

Edit `apps/mobile/app/_layout.tsx`. Import at top:

```ts
import Constants from 'expo-constants';
import { StripeProvider } from '@stripe/stripe-react-native';
```

Read the key:

```ts
const stripeKey =
  (Constants.expoConfig?.extra as { stripePublishableKey?: string } | undefined)
    ?.stripePublishableKey ?? '';
```

Wrap the existing return tree so `StripeProvider` sits above whatever is already there (e.g. before `<Stack>`):

```tsx
return (
  <StripeProvider publishableKey={stripeKey} merchantIdentifier="merchant.com.jdm.experience">
    {/* existing tree */}
  </StripeProvider>
);
```

> Note: `merchantIdentifier` is required for Apple Pay on iOS. `merchant.com.jdm.experience` matches the brainstorm — adjust if the real bundle identifier differs. If unsure, read `apps/mobile/app.config.ts` → `ios.bundleIdentifier` first and reuse.

- [ ] **Step 4: Create `apps/mobile/src/api/orders.ts`**

```ts
import { createOrderRequestSchema, createOrderResponseSchema } from '@jdm/shared/orders';
import type { CreateOrderRequest, CreateOrderResponse } from '@jdm/shared/orders';

import { authedRequest } from './client';

export const createOrder = (input: CreateOrderRequest): Promise<CreateOrderResponse> => {
  return authedRequest('/orders', createOrderResponseSchema, {
    method: 'POST',
    body: createOrderRequestSchema.parse(input),
  });
};
```

- [ ] **Step 5: Create `apps/mobile/src/api/tickets.ts`**

```ts
import { myTicketsResponseSchema } from '@jdm/shared/tickets';
import type { MyTicketsResponse } from '@jdm/shared/tickets';

import { authedRequest } from './client';

export const listMyTickets = (): Promise<MyTicketsResponse> =>
  authedRequest('/me/tickets', myTicketsResponseSchema);
```

- [ ] **Step 6: Create `apps/mobile/src/copy/tickets.ts`**

```ts
export const ticketsCopy = {
  tab: 'Ingressos',
  list: {
    empty: 'Você ainda não tem ingressos.',
    loading: 'Carregando seus ingressos...',
    upcoming: 'Próximos',
    past: 'Anteriores',
  },
  detail: {
    title: 'Seu ingresso',
    brightness: 'Aumente o brilho da tela para o QR ser lido com facilidade.',
    used: 'Utilizado',
    revoked: 'Cancelado',
    valid: 'Válido',
  },
  purchase: {
    pickTier: 'Escolha um ingresso',
    confirm: 'Confirmar compra',
    paying: 'Processando pagamento...',
    success: 'Ingresso confirmado! 🎉',
    successCta: 'Ver ingresso',
    soldOut: 'Esgotado',
    alreadyHas: 'Você já tem um ingresso para este evento.',
    error: 'Não conseguimos concluir seu pagamento. Tente novamente.',
    cancelled: 'Pagamento cancelado.',
  },
};
```

- [ ] **Step 7: Update `apps/mobile/src/copy/events.ts`**

Change `detail.buy` / `detail.buyDisabled` usage so the plain label is available (keeps `buyDisabled` for the sold-out state):

```ts
  detail: {
    // ... existing keys stay
    buy: 'Comprar',
    buyDisabled: 'Esgotado',
  },
```

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
git add apps/mobile/package.json apps/mobile/app.config.ts apps/mobile/.env.example \
        apps/mobile/app/_layout.tsx apps/mobile/src/api/orders.ts \
        apps/mobile/src/api/tickets.ts apps/mobile/src/copy/tickets.ts \
        apps/mobile/src/copy/events.ts pnpm-lock.yaml
git commit -m "feat(mobile): install Stripe SDK, wrap in StripeProvider, add order/ticket clients"
```

---

## Task 11: Mobile — enable tier picker + Payment Sheet on event detail

**Files:**

- Modify: `apps/mobile/app/(app)/events/[slug].tsx`

- [ ] **Step 1: Replace the disabled CTA with a tier picker + purchase flow**

Full updated file:

```tsx
import type { EventDetail, TicketTier } from '@jdm/shared/events';
import { useStripe } from '@stripe/stripe-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getEvent } from '~/api/events';
import { createOrder } from '~/api/orders';
import { Button } from '~/components/Button';
import { eventsCopy } from '~/copy/events';
import { ticketsCopy } from '~/copy/tickets';
import { formatBRL, formatEventDateRange } from '~/lib/format';
import { theme } from '~/theme';

export default function EventDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      try {
        setEvent(await getEvent(slug));
      } catch {
        setError(eventsCopy.errors.notFound);
      }
    })();
  }, [slug]);

  const openMap = (e: EventDetail) => {
    const q = encodeURIComponent(`${e.venueName}, ${e.venueAddress}`);
    void Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${q}&ll=${e.lat},${e.lng}`,
    );
  };

  const buy = async (tier: TicketTier) => {
    if (!event) return;
    setPaying(true);
    try {
      const order = await createOrder({ eventId: event.id, tierId: tier.id, method: 'card' });

      const init = await initPaymentSheet({
        merchantDisplayName: 'JDM Experience',
        paymentIntentClientSecret: order.clientSecret,
        applePay: { merchantCountryCode: 'BR' },
        googlePay: { merchantCountryCode: 'BR', testEnv: true },
        defaultBillingDetails: {},
      });
      if (init.error) {
        Alert.alert(ticketsCopy.purchase.error, init.error.message);
        return;
      }

      const sheet = await presentPaymentSheet();
      if (sheet.error) {
        if (sheet.error.code === 'Canceled') {
          Alert.alert(ticketsCopy.purchase.cancelled);
        } else {
          Alert.alert(ticketsCopy.purchase.error, sheet.error.message);
        }
        return;
      }

      Alert.alert(ticketsCopy.purchase.success, undefined, [
        {
          text: ticketsCopy.purchase.successCta,
          onPress: () => router.push('/tickets' as never),
        },
      ]);
    } catch (err) {
      Alert.alert(ticketsCopy.purchase.error, err instanceof Error ? err.message : String(err));
    } finally {
      setPaying(false);
    }
  };

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!event) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const selectedTier = event.tiers.find((t) => t.id === selectedTierId) ?? null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {event.coverUrl ? (
        <Image source={{ uri: event.coverUrl }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]} />
      )}
      <View style={styles.section}>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.sub}>{formatEventDateRange(event.startsAt, event.endsAt)}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>{eventsCopy.detail.venue}</Text>
        <Text style={styles.body}>{event.venueName}</Text>
        <Text style={styles.sub}>
          {event.venueAddress} - {event.city}/{event.stateCode}
        </Text>
        <Pressable onPress={() => openMap(event)} style={styles.mapButton}>
          <Text style={styles.mapLabel}>{eventsCopy.detail.openMaps}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.body}>{event.description}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.h2}>{ticketsCopy.purchase.pickTier}</Text>
        {event.tiers.map((t) => {
          const soldOut = t.remainingCapacity === 0;
          const isSelected = selectedTierId === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => !soldOut && setSelectedTierId(t.id)}
              style={[
                styles.tier,
                isSelected && styles.tierSelected,
                soldOut && styles.tierDisabled,
              ]}
            >
              <View style={styles.tierTop}>
                <Text style={styles.tierName}>{t.name}</Text>
                <Text style={styles.tierPrice}>{formatBRL(t.priceCents)}</Text>
              </View>
              <Text style={styles.sub}>
                {soldOut
                  ? ticketsCopy.purchase.soldOut
                  : `${t.remainingCapacity} ${eventsCopy.detail.remaining}`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.section}>
        <Button
          label={paying ? ticketsCopy.purchase.paying : ticketsCopy.purchase.confirm}
          onPress={() => selectedTier && void buy(selectedTier)}
          disabled={!selectedTier || paying}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: theme.spacing.xl, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cover: { width: '100%', height: 220 },
  coverPlaceholder: { backgroundColor: theme.colors.border },
  section: { padding: theme.spacing.lg, gap: theme.spacing.xs },
  title: { color: theme.colors.fg, fontSize: theme.font.size.lg, fontWeight: '700' },
  h2: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  body: { color: theme.colors.fg, fontSize: theme.font.size.md },
  sub: { color: theme.colors.muted },
  error: { color: theme.colors.muted },
  mapButton: {
    marginTop: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.border,
    alignSelf: 'flex-start',
  },
  mapLabel: { color: theme.colors.fg },
  tier: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  tierSelected: { borderColor: theme.colors.fg, borderWidth: 2 },
  tierDisabled: { opacity: 0.5 },
  tierTop: { flexDirection: 'row', justifyContent: 'space-between' },
  tierName: { color: theme.colors.fg, fontWeight: '600' },
  tierPrice: { color: theme.colors.fg },
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
git add apps/mobile/app/\(app\)/events/\[slug\].tsx
git commit -m "feat(mobile): enable tier picker and Stripe Payment Sheet on event detail"
```

---

## Task 12: Mobile — Tickets tab, list screen, QR detail screen

**Files:**

- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Create: `apps/mobile/app/(app)/tickets/_layout.tsx`
- Create: `apps/mobile/app/(app)/tickets/index.tsx`
- Create: `apps/mobile/app/(app)/tickets/[ticketId].tsx`
- Modify: `apps/mobile/package.json` (add `expo-keep-awake`, `expo-brightness`, `react-native-qrcode-svg`, `react-native-svg`)

- [ ] **Step 1: Install QR + keep-awake + brightness**

```bash
pnpm --filter @jdm/mobile add react-native-qrcode-svg react-native-svg expo-keep-awake expo-brightness
```

- [ ] **Step 2: Add the Tickets tab**

Edit `apps/mobile/app/(app)/_layout.tsx`:

```tsx
import { Tabs } from 'expo-router';

export default function AppLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="events" options={{ title: 'Eventos' }} />
      <Tabs.Screen name="tickets" options={{ title: 'Ingressos' }} />
      <Tabs.Screen name="garage" options={{ title: 'Garagem' }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil' }} />
    </Tabs>
  );
}
```

- [ ] **Step 3: Create `apps/mobile/app/(app)/tickets/_layout.tsx`**

```tsx
import { Stack } from 'expo-router';

export default function TicketsLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: 'Meus ingressos' }} />
      <Stack.Screen name="[ticketId]" options={{ title: '' }} />
    </Stack>
  );
}
```

- [ ] **Step 4: Create `apps/mobile/app/(app)/tickets/index.tsx`**

```tsx
import type { MyTicket } from '@jdm/shared/tickets';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { listMyTickets } from '~/api/tickets';
import { ticketsCopy } from '~/copy/tickets';
import { formatEventDateRange } from '~/lib/format';
import { theme } from '~/theme';

export default function TicketsIndex() {
  const router = useRouter();
  const [items, setItems] = useState<MyTicket[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await listMyTickets();
    setItems(res.items);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (items === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>{ticketsCopy.list.empty}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(t) => t.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => router.push(`/tickets/${item.id}` as never)}>
          <Text style={styles.title}>{item.event.title}</Text>
          <Text style={styles.sub}>
            {formatEventDateRange(item.event.startsAt, item.event.endsAt)}
          </Text>
          <Text style={styles.sub}>{item.tierName}</Text>
          <Text style={styles.statusLabel(item.status)}>
            {item.status === 'valid'
              ? ticketsCopy.detail.valid
              : item.status === 'used'
                ? ticketsCopy.detail.used
                : ticketsCopy.detail.revoked}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg,
  },
  empty: { color: theme.colors.muted },
  list: { gap: theme.spacing.md, padding: theme.spacing.md, backgroundColor: theme.colors.bg },
  card: {
    backgroundColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  title: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  sub: { color: theme.colors.muted },
  statusLabel: (status: MyTicket['status']) => ({
    color: status === 'valid' ? theme.colors.fg : theme.colors.muted,
    fontWeight: '600',
    marginTop: theme.spacing.xs,
  }),
});
```

> Note: `statusLabel` is declared as a style function rather than a plain key. If the theme pattern in use prefers a flat stylesheet, hoist it into a helper inside the component and apply the color inline.

- [ ] **Step 5: Create `apps/mobile/app/(app)/tickets/[ticketId].tsx`**

```tsx
import type { MyTicket } from '@jdm/shared/tickets';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { listMyTickets } from '~/api/tickets';
import { ticketsCopy } from '~/copy/tickets';
import { formatEventDateRange } from '~/lib/format';
import { theme } from '~/theme';

export default function TicketDetail() {
  useKeepAwake();
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const [ticket, setTicket] = useState<MyTicket | null>(null);

  useEffect(() => {
    void (async () => {
      const { items } = await listMyTickets();
      setTicket(items.find((t) => t.id === ticketId) ?? null);
    })();
  }, [ticketId]);

  if (!ticket) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{ticket.event.title}</Text>
      <Text style={styles.sub}>
        {formatEventDateRange(ticket.event.startsAt, ticket.event.endsAt)}
      </Text>
      <Text style={styles.sub}>{ticket.tierName}</Text>

      <View style={styles.qrBox}>
        <QRCode value={ticket.code} size={240} />
      </View>
      <Text style={styles.hint}>{ticketsCopy.detail.brightness}</Text>
      <Text style={[styles.status, ticket.status !== 'valid' && styles.statusMuted]}>
        {ticket.status === 'valid'
          ? ticketsCopy.detail.valid
          : ticket.status === 'used'
            ? ticketsCopy.detail.used
            : ticketsCopy.detail.revoked}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg,
  },
  title: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  sub: { color: theme.colors.muted, textAlign: 'center' },
  qrBox: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.lg,
    backgroundColor: '#fff',
    borderRadius: theme.radii.md,
  },
  hint: { color: theme.colors.muted, textAlign: 'center', fontSize: theme.font.size.sm },
  status: { color: theme.colors.fg, fontWeight: '700' },
  statusMuted: { color: theme.colors.muted },
});
```

> Note: `expo-brightness` was added in Step 1 so a future iteration can boost screen brightness when the QR is shown. Not wired yet — keep the dep install but skip the API use for now.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @jdm/mobile typecheck
git add apps/mobile/app/\(app\)/_layout.tsx apps/mobile/app/\(app\)/tickets/ \
        apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat(mobile): Ingressos tab with list + QR detail"
```

---

## Task 13: Roadmap + handoff updates

**Files:**

- Modify: `plans/roadmap.md`
- Modify: `handoff.md`

- [ ] **Step 1: Flip roadmap 4.1–4.7 to `[~]`**

In `plans/roadmap.md`, change each of 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7 from `[ ]` to `[~]` and append `_(on feat/f4-ticketing-stripe)_` to each scope line. Do **not** mark `[x]` — that happens in the merge-and-deploy PR per the file's own rules.

- [ ] **Step 2: Rewrite `handoff.md`**

Replace the F7a handoff with F4 summary:

1. **Branch:** `feat/f4-ticketing-stripe`.
2. **What shipped:** Prisma Order/Ticket/PaymentWebhookEvent models, `POST /orders`, Stripe webhook with signature + dedupe, HMAC-signed ticket codes, `GET /me/tickets`, mobile tier picker → Payment Sheet, Ingressos tab with QR detail.
3. **How to exercise:** start API with `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`TICKET_CODE_SECRET` set, start mobile via `pnpm --filter @jdm/mobile expo run:ios` (Expo Go will not work — Stripe SDK is native), log in, open an event, select a tier, use Stripe test card `4242 4242 4242 4242`, verify ticket appears in Ingressos.
4. **Test status:** API suite NNN passing (was 121); mobile typecheck clean.
5. **Deploy checklist (before roadmap `[x]`):** Railway API redeploy (new migration); set `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`TICKET_CODE_SECRET`/`STRIPE_PUBLISHABLE_KEY` in Railway; register Stripe webhook → `<api>/stripe/webhook`; Vercel admin redeploy (no admin change but keeps versions aligned); Mobile dev-client build tested on iOS and Android.
6. **Open edges:**
   - Abandoned pending orders never release their reservation — cleanup job deferred (cron in F6).
   - Refund on one-ticket-per-event race is captured as an error in `issueTicketForPaidOrder`; the webhook logs it but does not yet call `app.stripe.refund`. Add before Pix ships in F4b.
   - Mobile needs a dev-client build; EAS config (roadmap 0.9) still deferred.
   - No push notification on ticket issuance — wired in F6.
7. **Next feature:** F5 Check-in (staff role + scanner), per the `[REVIEW]` block in roadmap above 5.1.

- [ ] **Step 3: Commit if applicable**

```bash
git add plans/roadmap.md handoff.md
git commit -m "docs: mark roadmap 4.1-4.7 in-progress; update handoff for F4"
```

> Note: `roadmap.md` and `handoff.md` are in `.git/info/exclude` per CLAUDE.md and may be local-only. If `git add` reports nothing staged, skip the commit — the on-disk edits stand.

---

## Task 14: Final verification + PR

- [ ] **Step 1: Full suite**

```bash
pnpm -w typecheck
pnpm --filter @jdm/api test
pnpm --filter @jdm/shared test
pnpm --filter @jdm/mobile typecheck
```

Expected: all green. API ≥ 140 tests.

- [ ] **Step 2: Manual smoke test**

User-instruction policy: no background shells without consent. The executor should prompt the user before starting dev servers. If authorized:

1. API up with Stripe test secrets.
2. Run `stripe listen --forward-to localhost:4000/stripe/webhook` (user runs locally).
3. `pnpm --filter @jdm/mobile expo run:ios` (dev client).
4. Seeded event → select tier → Stripe test card `4242 4242 4242 4242` any future expiry, any CVC.
5. Confirm Ingressos tab shows ticket with QR.
6. Decline card `4000 0000 0000 9995` → reservation released; tier capacity back up.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/f4-ticketing-stripe
gh pr create --title "feat: F4 ticketing (Stripe path)" --body "$(cat <<'EOF'
## Summary
- Adds Order, Ticket, PaymentWebhookEvent schema with migration
- POST /orders reserves capacity atomically and creates a Stripe PaymentIntent
- POST /stripe/webhook verifies signatures, dedupes by provider event id, and issues HMAC-signed tickets
- GET /me/tickets returns the caller tickets with server-signed codes
- Mobile Stripe Payment Sheet wired to the tier picker on the event detail
- New Ingressos tab with list + full-screen QR detail (keep-awake)

## Roadmap
Covers 4.1 through 4.7. Pix path (4.8 through 4.12) lands in a separate plan (F4b). Check-in (F5) consumes the signed codes in its own plan.

## Test plan
- [ ] pnpm -w typecheck clean
- [ ] pnpm --filter @jdm/api test green (140+ tests)
- [ ] pnpm --filter @jdm/mobile typecheck clean
- [ ] Dev client buy flow completes end-to-end with Stripe test card 4242 4242 4242 4242
- [ ] Declined card releases the reservation (tier.quantitySold decrements)
- [ ] Webhook redelivery is a 200 no-op (dedup verified)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Flip roadmap to `[x]` in the merge-and-deploy commit**

Once the PR is merged AND the API is redeployed on Railway AND the mobile dev-client is validated, edit `plans/roadmap.md` to flip 4.1–4.7 from `[~]` to `[x]`. This edit belongs in the merge commit per CLAUDE.md's roadmap rule — not a follow-up.

---

## Self-review

**Spec coverage vs roadmap 4.1–4.7:**

- 4.1 Schema finalized with constraints + indexes → Task 1 ✓
- 4.2 Stripe webhook signature + dedup → Task 8 ✓
- 4.3 `POST /orders` with capacity race test → Task 7 ✓
- 4.4 `payment_intent.succeeded` webhook issues ticket with signed code → Tasks 5 + 8 ✓
- 4.5 `GET /me/tickets` → Task 9 ✓
- 4.6 Mobile buy ticket (Stripe) → Tasks 10 + 11 ✓
- 4.7 Mobile My Tickets + QR → Task 12 ✓

**Placeholder scan:** no "TBD", "implement later", or "see above" references. Every step has concrete code or concrete commands. Two `> Note` blocks flag intentional deferrals (abandonment cleanup, Stripe refund on race) and are tracked in handoff.

**Type consistency:** `StripeClient` interface defined in Task 3 with methods `createPaymentIntent`, `constructWebhookEvent`, `refund`, `publishableKey`. Referenced unchanged in Tasks 6, 7, 8. `IssueResult = { ticketId; code }` defined in Task 5 and reused in Task 8 test. `MyTicket` shape defined in Task 2 matches Task 9 response builder and Task 12 UI consumer.

**Deferred (tracked in handoff, not blocking):**

- Abandoned pending order cleanup cron (belongs with F6 scheduler).
- Automatic refund on one-ticket-per-event race in the webhook handler (before F4b).
- Push notification on ticket issuance (F6).
- Rate limiting on `/orders` and `/stripe/webhook` (cross-cutting).
- EAS dev-client build automation (roadmap 0.9, still deferred).

---

## Post-merge follow-ups

### ✅ JDMA-574 — mobile-web Stripe order resume via hosted checkout URL

- **Merged:** 2026-05-13, PR [#276](https://github.com/leaopedro/jdm/pull/276), commit `19cff47fa09a390f7556e2eda4d662fe86a573f9`.
- **Problem:** Stripe Checkout Session orders created from mobile-web have `Order.providerRef = null`, so `POST /orders/:id/resume` returns 409 `OrderNotPending`. `/profile/orders` previously routed mobile-web pending orders through the native PaymentSheet resume flow, which always failed for the hosted-checkout path.
- **Fix:**
  - Capture the hosted Checkout URL alongside the pending order id at creation time (web-only persistence in mobile session storage).
  - On resume click, navigate to the stored URL instead of calling the resume endpoint. Pix and native Stripe resume behavior unchanged.
  - Re-validate freshness via `GET /orders/:id` before redirect. Only navigate when `status === 'pending'` AND `expiresAt` is null or in the future. Stripe Checkout Sessions remain payable past the local 15-min reservation, so a stale pending order could otherwise be paid after expiry.
  - Scope the stored URL to the first sibling order id only. Previously the same Checkout Session URL was stored against every order id in a multi-order cart, letting any sibling reopen the shared Stripe session and pay the full cart even after sibling-level cancellations.
- **Files touched (11):**
  - `apps/mobile/app/(app)/profile/orders.tsx` — wire `ResumeWebStripeButton` and the three-kind resolver result.
  - `apps/mobile/src/cart/resume-selector.ts` + test — pick the canonical sibling for URL storage.
  - `apps/mobile/src/cart/resume-web-checkout.ts` + test — fresh-fetch and three-kind result (`redirect`, `stale`, `unverified`).
  - `apps/mobile/src/cart/web-pending-checkout.ts` + test — session storage helpers.
  - `apps/mobile/src/cart/web-stripe-redirect.ts` + test — scope URL persistence to the canonical order id.
  - `apps/mobile/src/copy/orders.ts` — PT-BR copy keys `payWebUnavailable`, `payWebUnverified`.
  - `apps/mobile/src/screens/buy/web-checkout.ts` — capture URL at creation.
- **Resolver kinds (resume-web-checkout):**
  - `redirect` — server confirms pending + reservation not lapsed; navigate to stored URL.
  - `stale` — server returns a terminal status OR `expiresAt <= now`. UI clears the stored URL, shows `payWebUnavailable`, and reloads the list.
  - `unverified` — freshness fetch threw. UI shows `payWebUnverified`, keeps the stored URL so the user can retry.
- **Verification:** 202/202 mobile tests pass, 0 lint errors (per implementation log).
- **Watch items / open edges:**
  - URL is persisted in mobile-web session storage only. A cleared session or a different browser yields the PT-BR `payWebUnavailable` fallback — by design, but worth tracking if users report dead resume.
  - Resolver depends on accurate `expiresAt` from `GET /orders/:id`. If the order route ever stops returning `expiresAt` on Checkout Session orders, `redirect` will gate too aggressively or too loosely.
  - Pix and native Stripe resume paths still flow through `POST /orders/:id/resume` and are out of scope for this fix.
  - No backend change. If we later normalize Checkout Session orders to expose a server-side resume URL on `GET /orders/:id`, the mobile-web session-storage hop can be removed.
