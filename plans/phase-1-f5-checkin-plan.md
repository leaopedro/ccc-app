# Phase 1 · F5 Check-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Door staff can scan a ticket QR code at an event and admit the holder, with a single atomic transition from `valid` → `used`. Check-in is performed via the admin web app by a dedicated `staff` role that cannot touch events, tiers, revenue, or any other admin surface.

**Architecture:** One POST endpoint `/admin/tickets/check-in` scoped per-event. Server verifies the HMAC ticket code (`verifyTicketCode`, from F4), then issues a single atomic `updateMany` with `WHERE status = 'valid' AND eventId = <target>` that guarantees exactly one scan wins under concurrency. A `staff` role is added to `UserRole` and wired through shared schemas, API middleware, and the admin Next.js middleware/layout. Staff log into the same admin web app but are routed to `/check-in` and blocked from `/events`. Scanner UI uses `@zxing/browser` for webcam QR decoding.

**Tech Stack:** Prisma, Fastify, Zod, `@jdm/shared`, Next.js 16 App Router (webpack build), `@zxing/browser`, Vitest + Testcontainers.

**Roadmap tasks covered:** 5.1 (API check-in endpoint), 5.2 (Admin QR scanner page). Task 5.3 (mobile door-mode) is **explicitly out of scope** — the roadmap marks it optional.

**Addresses the `[REVIEW]` note on F5:** a new `staff` role is introduced with narrow permissions (check-in only). Staff log in via the existing admin web app. Admin-only surfaces (event CRUD, tier CRUD, future revenue dashboards) remain `organizer|admin` only. Self-serve staff account provisioning (admin-side UI to mint staff users) is **not** part of this plan; staff accounts are created by a DBA/admin via direct SQL or a future user-management feature. The handoff documents this explicitly.

---

## File structure

### `packages/db`

- **Modify** `packages/db/prisma/schema.prisma` — add `staff` to `enum UserRole`.
- **Create** `packages/db/prisma/migrations/<timestamp>_user_role_staff/migration.sql` via Prisma.

### `packages/shared`

- **Modify** `packages/shared/src/auth.ts` — add `'staff'` literal to `userRoleSchema`.
- **Modify** `packages/shared/src/admin.ts` — add `'ticket.check_in'` to `adminAuditActionSchema`.
- **Create** `packages/shared/src/check-in.ts` — `ticketCheckInRequestSchema`, `ticketCheckInResultSchema`, `ticketCheckInResponseSchema`, `checkInEventSummarySchema`, `checkInEventsResponseSchema`.
- **Modify** `packages/shared/src/index.ts` — re-export `./check-in`.
- **Modify** `packages/shared/package.json` — add `"./check-in": "./src/check-in.ts"` to `exports`.

### `apps/api`

- **Create** `apps/api/src/services/tickets/check-in.ts` — `checkInTicket(input, env)` with typed errors (`InvalidTicketCodeError`, `TicketNotFoundError`, `TicketWrongEventError`, `TicketRevokedError`) and `CheckInOutcome` union (`admitted` | `already_used`).
- **Create** `apps/api/src/routes/admin/check-in.ts` — `POST /tickets/check-in` and `GET /check-in/events` (both staff-accessible).
- **Modify** `apps/api/src/routes/admin/index.ts` — split into two encapsulated scopes: one for check-in (staff|organizer|admin), one for events/tiers (organizer|admin).
- **Modify** `apps/api/src/services/admin-audit.ts` — widen `RecordAuditInput['entityType']` union to include `'ticket'`.
- **Modify** `apps/api/test/helpers.ts` — widen `createUser.role` and `bearer()` role params to include `'staff'`.

### API tests (real Postgres)

- **Create** `apps/api/test/tickets/check-in.test.ts` — service-level: happy path, invalid signature, not-found, wrong-event, revoked, idempotent already-used, concurrency (two concurrent scans — exactly one admitted).
- **Create** `apps/api/test/admin/check-in.route.test.ts` — route-level: 401 without auth, 403 for `user` role, 200 for each of staff/organizer/admin, payload shape assertions, audit row written on admit, audit row NOT written on already-used retry, 404/409 error mappings.
- **Create** `apps/api/test/admin/check-in-events.route.test.ts` — `GET /admin/check-in/events`: returns published events whose `endsAt >= now - 24h`, excludes draft/cancelled/old events, 403 for `user` role.
- **Modify** `apps/api/test/admin/require-role.test.ts` — add a 403 case for `staff` on the existing `organizer|admin`-only probe, and a 200 case on a new `organizer|admin|staff` probe.

### `apps/admin`

- **Modify** `apps/admin/middleware.ts` — accept `staff` as an authed role; add `/check-in` to `matcher`; redirect `staff` away from `/events` paths toward `/check-in`.
- **Modify** `apps/admin/src/lib/auth-actions.ts` — role-aware post-login redirect (`staff` → `/check-in`, others → `/events`).
- **Modify** `apps/admin/src/lib/admin-api.ts` — add `listCheckInEvents()`, `checkInTicket()`.
- **Modify** `apps/admin/app/(authed)/layout.tsx` — role-aware nav: staff sees "Check-in" only; organizer/admin see "Events" + "Check-in".
- **Create** `apps/admin/app/(authed)/events/layout.tsx` — server-side role gate: staff hitting `/events/*` is redirected to `/check-in`.
- **Create** `apps/admin/app/(authed)/check-in/page.tsx` — event picker.
- **Create** `apps/admin/app/(authed)/check-in/[eventId]/page.tsx` — scanner shell (server component) that renders the client scanner.
- **Create** `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx` — client component with `@zxing/browser`, camera select, scan throttle, result card, audio cue.
- **Create** `apps/admin/src/lib/check-in-actions.ts` — server action wrapping `checkInTicket()` for the scanner form submit path.
- **Modify** `apps/admin/package.json` — add `@zxing/browser` + `@zxing/library`.
- **Create** `apps/admin/app/(authed)/check-in/[eventId]/scanner.module.css` — local styles for the scanner surface (video + overlay).

### Docs

- **Modify** `plans/roadmap.md` — flip 5.1, 5.2 `[ ]`→`[~]` on branch start; flip to `[x]` in the merge-and-deploy PR.
- **Rewrite** `handoff.md` at PR time.

---

## Conventions (read before any task)

- **Branch:** `feat/f5-checkin` off `main`. One PR at the end.
- **Commits:** one per task. Conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- **Audit on admit only:** `recordAudit` fires for `ticket.check_in` on a fresh state transition (`kind === 'admitted'`). Idempotent retries (`already_used`) do not write audit rows. This prevents duplicate entries when two scanners race.
- **Concurrency invariant:** the DB decides the winner via `updateMany({ where: { status: 'valid', ... }, data: { status: 'used', ... } })`. `result.count === 1` means this caller won; `0` means it was not valid at update-time (used/revoked/wrong-event/not-found) — we re-read the row to choose the right response code.
- **Staff scope (hard boundary):** the `staff` role can call exactly `POST /admin/tickets/check-in` and `GET /admin/check-in/events`. Nothing else under `/admin/*`. This is enforced by splitting `adminRoutes` into two encapsulated sub-scopes with different `requireRole` calls.
- **Ticket code format (from F4):** `<ticketId>.<base64url-hmac-sha256-of-ticketId>`. `verifyTicketCode(code, env)` returns the `ticketId` and throws on any malformation/tamper. We do not catch `verifyTicketCode`'s error class directly — we wrap every throw in `InvalidTicketCodeError`.
- **Event-scoped check-in:** every scan is bound to an `eventId` selected on the picker page. The API rejects `ticket.eventId !== input.eventId` with `TicketWrongEventError` / 409.
- **Check-in-able events:** `GET /admin/check-in/events` returns events where `status = 'published' AND endsAt >= now - 24h`. The 24h trailing window lets staff finish late check-ins without including stale history.
- **Scanner UX:** `@zxing/browser` `BrowserMultiFormatReader`. Scan throttle: suppress duplicate scans of the same code within 5s to prevent re-scanning the same QR mid-check-in. Audio cue: `new Audio('data:audio/wav;base64,...')` or a tiny beep file — short, non-disruptive.
- **No "Admit / Reject" server verb:** the roadmap line mentions Admit/Reject buttons. We treat "Admit" as the default outcome of a successful scan (state transition happens server-side automatically) and "Reject" as a client-only dismissal (no server call). The door staff scans only when they've visually approved the holder. If a concern is raised after the fact, revocation is a deferred feature and lives outside F5.
- **Staff account creation:** there is no UI for creating staff users in this plan. Staff rows are created via direct DB update (`UPDATE "User" SET role = 'staff' WHERE id = ...`) or psql seed. This is captured in the handoff as a deferred item. Rationale: organizer/admin accounts follow the same pattern today.
- **Tests hit real Postgres** per CLAUDE.md.
- **Dependent tasks:** T2 must land before T5/T6 (types flow through). T6 depends on T4 (shared schemas) and T5 (service). T8-T12 depend on T6/T7 (API endpoints live).
- **Prisma client re-gen:** after the migration in T2, run `pnpm --filter @jdm/db db:generate` before building/testing anything else. Commit the generated client change **as part of T2**.

---

## Task 1: Branch, plan commit, roadmap flip

**Files:**

- Create: `plans/phase-1-f5-checkin-plan.md` (this file)
- Modify: `plans/roadmap.md`

- [ ] **Step 1: Create branch from main**

```bash
git checkout main
git pull origin main
git checkout -b feat/f5-checkin
```

- [ ] **Step 2: Verify the plan file is present on branch**

Run: `ls plans/phase-1-f5-checkin-plan.md`
Expected: path prints (the plan already exists on disk — this step confirms the branch has it).

- [ ] **Step 3: Flip 5.1 and 5.2 markers to `[~]`**

Edit `plans/roadmap.md`: find the two lines:

```
#### 5.1 API: check-in endpoint

- [ ] **Scope:** `POST /admin/tickets/check-in { code }`. Verify HMAC,
```

Change `- [ ]` → `- [~]` and append `_(on feat/f5-checkin)_` at the end of the Scope sentence:

```
- [~] **Scope:** `POST /admin/tickets/check-in { code }`. Verify HMAC,
      look up ticket, atomically set `status=used`, return holder info. Reject
      already used, revoked, or wrong-event tickets. Idempotent on retry with
      same request id. _(on feat/f5-checkin)_
```

Same flip for 5.2:

```
- [~] **Scope:** Web camera scan (`@zxing/browser` or similar); shows holder
      name/photo + tier; buttons "Admit" / "Reject". _(on feat/f5-checkin)_
```

- [ ] **Step 4: Commit**

```bash
git add plans/phase-1-f5-checkin-plan.md plans/roadmap.md
git commit -m "docs(f5): add check-in implementation plan and flip roadmap markers"
```

---

## Task 2: Add `staff` role end-to-end

**Files:**

- Modify: `packages/db/prisma/schema.prisma:13-17`
- Create: `packages/db/prisma/migrations/<timestamp>_user_role_staff/migration.sql`
- Modify: `packages/shared/src/auth.ts:16`
- Modify: `apps/api/test/helpers.ts:37-62`

- [ ] **Step 1: Update the Prisma enum**

Edit `packages/db/prisma/schema.prisma` (the `UserRole` block at line 13):

```prisma
enum UserRole {
  user
  organizer
  admin
  staff
}
```

- [ ] **Step 2: Generate the migration**

Run (against the local dev DB):

```bash
pnpm --filter @jdm/db prisma migrate dev --name user_role_staff
```

Expected: Prisma emits a migration dir `20260420<time>_user_role_staff/` with SQL like:

```sql
ALTER TYPE "UserRole" ADD VALUE 'staff';
```

- [ ] **Step 3: Regenerate the Prisma client**

```bash
pnpm --filter @jdm/db db:generate
```

Expected: no errors.

- [ ] **Step 4: Update the shared schema**

Edit `packages/shared/src/auth.ts` line 16:

```ts
export const userRoleSchema = z.enum(['user', 'organizer', 'admin', 'staff']);
```

- [ ] **Step 5: Widen the test helper role params**

Edit `apps/api/test/helpers.ts`. Replace the `createUser` and `bearer` role unions:

```ts
export const createUser = async (
  overrides: Partial<{
    email: string;
    password: string;
    name: string;
    verified: boolean;
    role: 'user' | 'organizer' | 'admin' | 'staff';
  }> = {},
) => {
  const password = overrides.password ?? 'correct-horse-battery-staple';
  const user = await prisma.user.create({
    data: {
      email: overrides.email ?? 'user@jdm.test',
      name: overrides.name ?? 'Test User',
      passwordHash: await hashPassword(password),
      role: overrides.role ?? 'user',
      emailVerifiedAt: overrides.verified ? new Date() : null,
    },
  });
  return { user, password };
};

export const bearer = (
  env: ReturnType<typeof loadEnv>,
  userId: string,
  role: 'user' | 'organizer' | 'admin' | 'staff' = 'user',
) => `Bearer ${createAccessToken({ sub: userId, role }, env)}`;
```

- [ ] **Step 6: Run typecheck across the workspace**

```bash
pnpm -w typecheck
```

Expected: all 5 packages clean. If the generated Prisma client hasn't been picked up, re-run `pnpm --filter @jdm/db db:generate` and retry.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/shared/src/auth.ts apps/api/test/helpers.ts
git commit -m "feat(db): add staff user role"
```

---

## Task 3: Widen admin audit for ticket check-in

**Files:**

- Modify: `packages/shared/src/admin.ts:12-20`
- Modify: `apps/api/src/services/admin-audit.ts:5-11`

- [ ] **Step 1: Add the new audit action**

Edit `packages/shared/src/admin.ts`:

```ts
export const adminAuditActionSchema = z.enum([
  'event.create',
  'event.update',
  'event.publish',
  'event.cancel',
  'tier.create',
  'tier.update',
  'tier.delete',
  'ticket.check_in',
]);
export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>;
```

- [ ] **Step 2: Widen the entityType union**

Edit `apps/api/src/services/admin-audit.ts`:

```ts
export type RecordAuditInput = {
  actorId: string;
  action: AdminAuditAction;
  entityType: 'event' | 'tier' | 'ticket';
  entityId: string;
  metadata?: Record<string, unknown>;
};
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @jdm/api typecheck && pnpm --filter @jdm/shared typecheck
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/admin.ts apps/api/src/services/admin-audit.ts
git commit -m "feat(audit): add ticket.check_in action"
```

---

## Task 4: Shared check-in schemas

**Files:**

- Create: `packages/shared/src/check-in.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json:8-20`

- [ ] **Step 1: Write the shared schemas**

Create `packages/shared/src/check-in.ts`:

```ts
import { z } from 'zod';

// The QR payload from F4: `<ticketId>.<base64url-sig>`. We do not try to
// parse it here — the server's verifyTicketCode is the source of truth.
// We just bound it to a sane length to reject obvious garbage early.
export const ticketCheckInRequestSchema = z.object({
  code: z.string().min(10).max(500),
  eventId: z.string().min(1).max(64),
});
export type TicketCheckInRequest = z.infer<typeof ticketCheckInRequestSchema>;

export const checkInResultSchema = z.enum(['admitted', 'already_used']);
export type CheckInResult = z.infer<typeof checkInResultSchema>;

export const ticketCheckInResponseSchema = z.object({
  result: checkInResultSchema,
  ticket: z.object({
    id: z.string().min(1),
    status: z.enum(['valid', 'used', 'revoked']),
    // ISO timestamp: on 'admitted' it's the fresh check-in; on
    // 'already_used' it's the ORIGINAL usedAt, not "now".
    checkedInAt: z.string().datetime(),
    tier: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    }),
    holder: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
    }),
  }),
});
export type TicketCheckInResponse = z.infer<typeof ticketCheckInResponseSchema>;

export const checkInEventSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  venueName: z.string().nullable(),
  city: z.string().min(1),
  stateCode: z.string().length(2),
});
export type CheckInEventSummary = z.infer<typeof checkInEventSummarySchema>;

export const checkInEventsResponseSchema = z.object({
  items: z.array(checkInEventSummarySchema),
});
export type CheckInEventsResponse = z.infer<typeof checkInEventsResponseSchema>;
```

- [ ] **Step 2: Add the re-export**

Edit `packages/shared/src/index.ts`. Add (after the existing exports):

```ts
export * from './check-in.js';
```

- [ ] **Step 3: Add the subpath export**

Edit `packages/shared/package.json`. Replace the `exports` block:

```json
  "exports": {
    ".": "./src/index.ts",
    "./admin": "./src/admin.ts",
    "./auth": "./src/auth.ts",
    "./cars": "./src/cars.ts",
    "./check-in": "./src/check-in.ts",
    "./events": "./src/events.ts",
    "./health": "./src/health.ts",
    "./ids": "./src/ids.ts",
    "./orders": "./src/orders.ts",
    "./profile": "./src/profile.ts",
    "./tickets": "./src/tickets.ts",
    "./uploads": "./src/uploads.ts"
  },
```

- [ ] **Step 4: Typecheck and run shared tests**

```bash
pnpm --filter @jdm/shared typecheck
pnpm --filter @jdm/shared test
```

Expected: both clean (shared typically has no tests, `--passWithNoTests` path).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/check-in.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(shared): add check-in request/response schemas"
```

---

## ✅ Task 5: Check-in service (TDD)

**Files:**

- Create: `apps/api/src/services/tickets/check-in.ts`
- Create: `apps/api/test/tickets/check-in.test.ts`

- [x] **Step 1: Write the failing service tests**

> note: the planned test literal `type: 'meet'` does not match the Prisma `EventType` enum (`meeting | drift | other`); changed to `'meeting'` in both event creations.

Create `apps/api/test/tickets/check-in.test.ts`:

```ts
import { prisma } from '@jdm/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import {
  checkInTicket,
  InvalidTicketCodeError,
  TicketNotFoundError,
  TicketRevokedError,
  TicketWrongEventError,
} from '../../src/services/tickets/check-in.js';
import { signTicketCode } from '../../src/services/tickets/codes.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedTicket = async (status: 'valid' | 'used' | 'revoked' = 'valid') => {
  const { user } = await createUser({ email: `h-${Math.random()}@jdm.test`, verified: true });
  const event = await prisma.event.create({
    data: {
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Test Event',
      description: 'd',
      startsAt: new Date(Date.now() + 3600_000),
      endsAt: new Date(Date.now() + 7200_000),
      venueName: 'V',
      venueAddress: 'A',
      city: 'São Paulo',
      stateCode: 'SP',
      type: 'meet',
      status: 'published',
      publishedAt: new Date(),
      capacity: 10,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'GA',
      priceCents: 1000,
      quantityTotal: 10,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      userId: user.id,
      eventId: event.id,
      tierId: tier.id,
      status,
      usedAt: status === 'used' ? new Date(Date.now() - 60_000) : null,
      source: 'purchase',
    },
  });
  return { user, event, tier, ticket, code: signTicketCode(ticket.id, env) };
};

describe('checkInTicket', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('admits a valid ticket and sets status=used', async () => {
    const { event, ticket, code } = await seedTicket('valid');
    const outcome = await checkInTicket({ code, eventId: event.id }, env);
    expect(outcome.kind).toBe('admitted');
    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe('used');
    expect(updated.usedAt).not.toBeNull();
  });

  it('is idempotent: already_used on retry returns original usedAt', async () => {
    const { event, ticket, code } = await seedTicket('valid');
    const first = await checkInTicket({ code, eventId: event.id }, env);
    expect(first.kind).toBe('admitted');
    const originalUsedAt = (
      await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      })
    ).usedAt!;
    const second = await checkInTicket({ code, eventId: event.id }, env);
    if (second.kind !== 'already_used') throw new Error('expected already_used');
    expect(second.originalUsedAt.toISOString()).toBe(originalUsedAt.toISOString());
  });

  it('throws InvalidTicketCodeError on malformed code', async () => {
    const { event } = await seedTicket('valid');
    await expect(
      checkInTicket({ code: 'not-a-valid-code', eventId: event.id }, env),
    ).rejects.toBeInstanceOf(InvalidTicketCodeError);
  });

  it('throws InvalidTicketCodeError on tampered signature', async () => {
    const { event, code } = await seedTicket('valid');
    const tampered = `${code.split('.')[0]}.aaaaaaaaaaaa`;
    await expect(checkInTicket({ code: tampered, eventId: event.id }, env)).rejects.toBeInstanceOf(
      InvalidTicketCodeError,
    );
  });

  it('throws TicketNotFoundError when the signed ticketId does not exist', async () => {
    const { event } = await seedTicket('valid');
    const orphanCode = signTicketCode('nonexistent-id', env);
    await expect(
      checkInTicket({ code: orphanCode, eventId: event.id }, env),
    ).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  it('throws TicketWrongEventError when eventId does not match', async () => {
    const { code } = await seedTicket('valid');
    const otherEvent = await prisma.event.create({
      data: {
        slug: 'other-event',
        title: 'Other',
        description: 'd',
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 7200_000),
        venueName: 'V',
        venueAddress: 'A',
        city: 'Rio',
        stateCode: 'RJ',
        type: 'meet',
        status: 'published',
        publishedAt: new Date(),
        capacity: 10,
      },
    });
    await expect(checkInTicket({ code, eventId: otherEvent.id }, env)).rejects.toBeInstanceOf(
      TicketWrongEventError,
    );
  });

  it('throws TicketRevokedError for revoked tickets', async () => {
    const { event, code } = await seedTicket('revoked');
    await expect(checkInTicket({ code, eventId: event.id }, env)).rejects.toBeInstanceOf(
      TicketRevokedError,
    );
  });

  it('concurrent scans: exactly one outcome is admitted', async () => {
    const { event, code } = await seedTicket('valid');
    const results = await Promise.allSettled([
      checkInTicket({ code, eventId: event.id }, env),
      checkInTicket({ code, eventId: event.id }, env),
      checkInTicket({ code, eventId: event.id }, env),
    ]);
    const admitted = results.filter((r) => r.status === 'fulfilled' && r.value.kind === 'admitted');
    const retried = results.filter(
      (r) => r.status === 'fulfilled' && r.value.kind === 'already_used',
    );
    expect(admitted).toHaveLength(1);
    expect(retried).toHaveLength(2);
  });
});
```

- [x] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter @jdm/api test -- tickets/check-in.test.ts
```

Expected: FAIL — module `../../src/services/tickets/check-in.js` does not exist.

- [x] **Step 3: Implement the service**

Create `apps/api/src/services/tickets/check-in.ts`:

```ts
import { prisma } from '@jdm/db';
import type { Ticket, TicketTier, User } from '@prisma/client';

import { verifyTicketCode } from './codes.js';

export class InvalidTicketCodeError extends Error {
  readonly code = 'INVALID_TICKET_CODE';
  constructor(message = 'invalid ticket code') {
    super(message);
  }
}
export class TicketNotFoundError extends Error {
  readonly code = 'TICKET_NOT_FOUND';
  constructor(message = 'ticket not found') {
    super(message);
  }
}
export class TicketWrongEventError extends Error {
  readonly code = 'TICKET_WRONG_EVENT';
  constructor(
    readonly expectedEventId: string,
    readonly actualEventId: string,
  ) {
    super('ticket is for a different event');
  }
}
export class TicketRevokedError extends Error {
  readonly code = 'TICKET_REVOKED';
  constructor(message = 'ticket revoked') {
    super(message);
  }
}

type TicketWithRelations = Ticket & { tier: TicketTier; user: User };

export type CheckInOutcome =
  | { kind: 'admitted'; ticket: TicketWithRelations; checkedInAt: Date }
  | { kind: 'already_used'; ticket: TicketWithRelations; originalUsedAt: Date };

type CheckInEnv = { readonly TICKET_CODE_SECRET: string };

export const checkInTicket = async (
  input: { code: string; eventId: string },
  env: CheckInEnv,
): Promise<CheckInOutcome> => {
  let ticketId: string;
  try {
    ticketId = verifyTicketCode(input.code, env);
  } catch {
    throw new InvalidTicketCodeError();
  }

  const now = new Date();
  const result = await prisma.ticket.updateMany({
    where: { id: ticketId, eventId: input.eventId, status: 'valid' },
    data: { status: 'used', usedAt: now },
  });

  if (result.count === 1) {
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { tier: true, user: true },
    });
    return { kind: 'admitted', ticket, checkedInAt: now };
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { tier: true, user: true },
  });
  if (!ticket) throw new TicketNotFoundError();
  if (ticket.eventId !== input.eventId) {
    throw new TicketWrongEventError(input.eventId, ticket.eventId);
  }
  if (ticket.status === 'revoked') throw new TicketRevokedError();
  // ticket.status === 'used' — idempotent replay
  return {
    kind: 'already_used',
    ticket,
    originalUsedAt: ticket.usedAt ?? now,
  };
};
```

- [x] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @jdm/api test -- tickets/check-in.test.ts
```

Expected: PASS, 8 tests (1 admit, 1 idempotent, 2 invalid-code, 1 not-found, 1 wrong-event, 1 revoked, 1 concurrency).

- [x] **Step 5: Run the full API suite to confirm no regressions**

```bash
pnpm --filter @jdm/api test
```

Expected: 151 + 8 = 159 tests, all green.

> note: actual observed total was 160 passing tests across 42 files (baseline had 152 before this task, not 151).

- [x] **Step 6: Commit**

```bash
git add apps/api/src/services/tickets/check-in.ts apps/api/test/tickets/check-in.test.ts
git commit -m "feat(api): check-in service with atomic state transition"
```

---

## Task 6: Refactor admin routes to scope staff access

**Files:**

- Modify: `apps/api/src/routes/admin/index.ts`
- Modify: `apps/api/test/admin/require-role.test.ts`

- [ ] **Step 1: Extend the requireRole test**

Edit `apps/api/test/admin/require-role.test.ts`. Add two new cases at the bottom of the `describe` block (just before the final closing brace):

```ts
it('403 for staff on organizer|admin-only probe', async () => {
  const { user } = await createUser({ email: 's@jdm.test', verified: true, role: 'staff' });
  const res = await app.inject({
    method: 'GET',
    url: '/__role-probe',
    headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
  });
  expect(res.statusCode).toBe(403);
});
```

Then add a second `describe` block for a staff-allowed probe under the file:

```ts
describe('requireRole preHandler (staff-allowed probe)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    app.get(
      '/__staff-probe',
      { preHandler: [app.authenticate, app.requireRole('organizer', 'admin', 'staff')] },
      () => ({ ok: true }),
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('200 for staff', async () => {
    const { user } = await createUser({ email: 's2@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/__staff-probe',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
    });
    expect(res.statusCode).toBe(200);
  });

  it('403 for user', async () => {
    const { user } = await createUser({ email: 'u2@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/__staff-probe',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to confirm they pass (requireRole already supports staff via schema)**

```bash
pnpm --filter @jdm/api test -- admin/require-role.test.ts
```

Expected: PASS, all cases green (staff role is accepted by `requireRole` because `UserRoleName` now includes it).

- [ ] **Step 3: Refactor `admin/index.ts` into two encapsulated scopes**

Replace the contents of `apps/api/src/routes/admin/index.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';

import { adminCheckInRoutes } from './check-in.js';
import { adminEventRoutes } from './events.js';
import { adminTierRoutes } from './tiers.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // Check-in surface: staff can reach this; organizer/admin can too.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('organizer', 'admin', 'staff'));
    await scope.register(adminCheckInRoutes);
  });

  // Event + tier management: organizer/admin only. Staff are rejected here.
  await app.register(async (scope) => {
    scope.addHook('preHandler', scope.requireRole('organizer', 'admin'));
    await scope.register(adminEventRoutes);
    await scope.register(adminTierRoutes);
  });
};
```

- [ ] **Step 4: Create an empty check-in plugin placeholder so the import resolves**

Create `apps/api/src/routes/admin/check-in.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminCheckInRoutes: FastifyPluginAsync = async (_app) => {
  // routes are wired in the next task
};
```

- [ ] **Step 5: Run the full API suite**

```bash
pnpm --filter @jdm/api test
```

Expected: all 159+ tests still green (refactor must not break existing admin routes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/index.ts apps/api/src/routes/admin/check-in.ts apps/api/test/admin/require-role.test.ts
git commit -m "refactor(api): split admin routes into staff-scoped and organizer-scoped"
```

---

## ✅ Task 7: `POST /admin/tickets/check-in` route (TDD)

**Files:**

- Modify: `apps/api/src/routes/admin/check-in.ts`
- Create: `apps/api/test/admin/check-in.route.test.ts`

- [x] **Step 1: Write the failing route tests**

> note: `res.json() as T` casts hit `@typescript-eslint/no-unsafe-assignment`. Used the project's `res.json<T>()` generic form instead.

Create `apps/api/test/admin/check-in.route.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { signTicketCode } from '../../src/services/tickets/codes.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedTicket = async (status: 'valid' | 'used' | 'revoked' = 'valid') => {
  const { user: holder } = await createUser({
    email: `h-${Math.random()}@jdm.test`,
    verified: true,
  });
  const event = await prisma.event.create({
    data: {
      slug: `ev-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Test Event',
      description: 'd',
      startsAt: new Date(Date.now() + 3600_000),
      endsAt: new Date(Date.now() + 7200_000),
      venueName: 'V',
      venueAddress: 'A',
      city: 'SP',
      stateCode: 'SP',
      type: 'meet',
      status: 'published',
      publishedAt: new Date(),
      capacity: 10,
    },
  });
  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'GA',
      priceCents: 1000,
      quantityTotal: 10,
      quantitySold: 1,
      sortOrder: 0,
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      userId: holder.id,
      eventId: event.id,
      tierId: tier.id,
      status,
      usedAt: status === 'used' ? new Date(Date.now() - 60_000) : null,
      source: 'purchase',
    },
  });
  return { holder, event, tier, ticket, code: signTicketCode(ticket.id, env) };
};

describe('POST /admin/tickets/check-in', () => {
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
    const { event, code } = await seedTicket();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      payload: { code, eventId: event.id },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for regular user role', async () => {
    const { event, code } = await seedTicket();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { code, eventId: event.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it.each(['staff', 'organizer', 'admin'] as const)('200 admitted for %s', async (role) => {
    const { event, code, holder, tier } = await seedTicket();
    const { user: actor } = await createUser({
      email: `a-${role}@jdm.test`,
      verified: true,
      role,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, actor.id, role) },
      payload: { code, eventId: event.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      result: string;
      ticket: { id: string; status: string; tier: { name: string }; holder: { name: string } };
    };
    expect(body.result).toBe('admitted');
    expect(body.ticket.status).toBe('used');
    expect(body.ticket.tier.name).toBe(tier.name);
    expect(body.ticket.holder.name).toBe(holder.name);
  });

  it('writes a ticket.check_in audit row on admit (once)', async () => {
    const { event, code } = await seedTicket();
    const { user: actor } = await createUser({
      email: 'a-audit@jdm.test',
      verified: true,
      role: 'staff',
    });
    await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, actor.id, 'staff') },
      payload: { code, eventId: event.id },
    });
    const rows = await prisma.adminAudit.findMany({ where: { action: 'ticket.check_in' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(actor.id);
    expect(rows[0]!.entityType).toBe('ticket');
  });

  it('idempotent: already_used on second call does NOT write a second audit row', async () => {
    const { event, code } = await seedTicket();
    const { user: actor } = await createUser({
      email: 'a-idem@jdm.test',
      verified: true,
      role: 'staff',
    });
    const auth = { authorization: bearer(env, actor.id, 'staff') };
    await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: auth,
      payload: { code, eventId: event.id },
    });
    const res2 = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: auth,
      payload: { code, eventId: event.id },
    });
    expect(res2.statusCode).toBe(200);
    expect((res2.json() as { result: string }).result).toBe('already_used');
    const rows = await prisma.adminAudit.findMany({ where: { action: 'ticket.check_in' } });
    expect(rows).toHaveLength(1);
  });

  it('400 on malformed code', async () => {
    const { event } = await seedTicket();
    const { user: actor } = await createUser({
      email: 'a-bad@jdm.test',
      verified: true,
      role: 'staff',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, actor.id, 'staff') },
      payload: { code: 'definitely-bogus-payload', eventId: event.id },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('InvalidTicketCode');
  });

  it('404 when the signed ticket does not exist', async () => {
    const { event } = await seedTicket();
    const orphan = signTicketCode('orphan-id', env);
    const { user: actor } = await createUser({
      email: 'a-orphan@jdm.test',
      verified: true,
      role: 'staff',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, actor.id, 'staff') },
      payload: { code: orphan, eventId: event.id },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('TicketNotFound');
  });

  it('409 for wrong-event', async () => {
    const { code } = await seedTicket();
    const other = await prisma.event.create({
      data: {
        slug: 'wrong-ev',
        title: 'Other',
        description: 'd',
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 7200_000),
        venueName: 'V',
        venueAddress: 'A',
        city: 'RJ',
        stateCode: 'RJ',
        type: 'meet',
        status: 'published',
        publishedAt: new Date(),
        capacity: 10,
      },
    });
    const { user: actor } = await createUser({
      email: 'a-wrong@jdm.test',
      verified: true,
      role: 'staff',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, actor.id, 'staff') },
      payload: { code, eventId: other.id },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('TicketWrongEvent');
  });

  it('409 for revoked ticket', async () => {
    const { event, code } = await seedTicket('revoked');
    const { user: actor } = await createUser({
      email: 'a-rev@jdm.test',
      verified: true,
      role: 'staff',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tickets/check-in',
      headers: { authorization: bearer(env, actor.id, 'staff') },
      payload: { code, eventId: event.id },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('TicketRevoked');
  });
});
```

- [x] **Step 2: Run tests to confirm failure**

```bash
pnpm --filter @jdm/api test -- admin/check-in.route.test.ts
```

Expected: FAIL — route returns 404 because the placeholder plugin registers nothing.

- [x] **Step 3: Implement the route**

Replace `apps/api/src/routes/admin/check-in.ts`:

```ts
import { ticketCheckInRequestSchema, ticketCheckInResponseSchema } from '@jdm/shared/check-in';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import {
  checkInTicket,
  InvalidTicketCodeError,
  TicketNotFoundError,
  TicketRevokedError,
  TicketWrongEventError,
} from '../../services/tickets/check-in.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminCheckInRoutes: FastifyPluginAsync = async (app) => {
  app.post('/tickets/check-in', async (request, reply) => {
    const { sub: actorId } = requireUser(request);
    const input = ticketCheckInRequestSchema.parse(request.body);

    try {
      const outcome = await checkInTicket(input, app.env);

      if (outcome.kind === 'admitted') {
        await recordAudit({
          actorId,
          action: 'ticket.check_in',
          entityType: 'ticket',
          entityId: outcome.ticket.id,
          metadata: { eventId: input.eventId },
        });
      }

      const checkedInAt =
        outcome.kind === 'admitted'
          ? outcome.checkedInAt.toISOString()
          : outcome.originalUsedAt.toISOString();

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
          },
        }),
      );
    } catch (err) {
      if (err instanceof InvalidTicketCodeError) {
        return reply.status(400).send({ error: 'InvalidTicketCode', message: err.message });
      }
      if (err instanceof TicketNotFoundError) {
        return reply.status(404).send({ error: 'TicketNotFound', message: err.message });
      }
      if (err instanceof TicketWrongEventError) {
        return reply.status(409).send({ error: 'TicketWrongEvent', message: err.message });
      }
      if (err instanceof TicketRevokedError) {
        return reply.status(409).send({ error: 'TicketRevoked', message: err.message });
      }
      throw err;
    }
  });
};
```

- [x] **Step 4: Run tests to confirm green**

```bash
pnpm --filter @jdm/api test -- admin/check-in.route.test.ts
```

Expected: PASS.

- [x] **Step 5: Full suite**

```bash
pnpm --filter @jdm/api test
```

Expected: all tests green.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/check-in.ts apps/api/test/admin/check-in.route.test.ts
git commit -m "feat(api): POST /admin/tickets/check-in with idempotent admit + audit"
```

---

## ✅ Task 8: `GET /admin/check-in/events` route (TDD)

**Files:**

- Modify: `apps/api/src/routes/admin/check-in.ts`
- Create: `apps/api/test/admin/check-in-events.route.test.ts`

- [x] **Step 1: Write the failing tests**

Create `apps/api/test/admin/check-in-events.route.test.ts`:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('GET /admin/check-in/events', () => {
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

  const seedEvent = (
    overrides: Partial<{
      slug: string;
      status: 'draft' | 'published' | 'cancelled';
      startsAt: Date;
      endsAt: Date;
    }>,
  ) =>
    prisma.event.create({
      data: {
        slug: overrides.slug ?? `e-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Test Event',
        description: 'd',
        startsAt: overrides.startsAt ?? new Date(Date.now() + 3600_000),
        endsAt: overrides.endsAt ?? new Date(Date.now() + 7200_000),
        venueName: 'V',
        venueAddress: 'A',
        city: 'SP',
        stateCode: 'SP',
        type: 'meet',
        status: overrides.status ?? 'published',
        publishedAt: overrides.status === 'published' ? new Date() : null,
        capacity: 10,
      },
    });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/check-in/events',
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('200 for staff and returns only published events in the 24h-back window', async () => {
    const upcoming = await seedEvent({ slug: 'upcoming' });
    const justEnded = await seedEvent({
      slug: 'just-ended',
      startsAt: new Date(Date.now() - 3 * 3600_000),
      endsAt: new Date(Date.now() - 3600_000),
    });
    await seedEvent({
      slug: 'long-past',
      startsAt: new Date(Date.now() - 72 * 3600_000),
      endsAt: new Date(Date.now() - 48 * 3600_000),
    });
    await seedEvent({ slug: 'draft-ev', status: 'draft' });
    await seedEvent({ slug: 'cancelled-ev', status: 'cancelled' });

    const { user } = await createUser({ email: 's@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/check-in/events',
      headers: { authorization: bearer(env, user.id, 'staff') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; slug: string }> };
    const slugs = body.items.map((i) => i.slug).sort();
    expect(slugs).toEqual(['just-ended', 'upcoming']);
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(upcoming.id);
    expect(ids).toContain(justEnded.id);
  });
});
```

- [x] **Step 2: Confirm they fail**

```bash
pnpm --filter @jdm/api test -- admin/check-in-events.route.test.ts
```

Expected: FAIL — route returns 404.

- [x] **Step 3: Implement the list endpoint**

Edit `apps/api/src/routes/admin/check-in.ts`. Add the following imports at the top (alongside existing):

```ts
import { prisma } from '@jdm/db';
import { checkInEventsResponseSchema } from '@jdm/shared/check-in';
```

Append the GET handler inside the plugin, before the closing brace:

```ts
app.get('/check-in/events', async (_request, reply) => {
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  const events = await prisma.event.findMany({
    where: {
      status: 'published',
      endsAt: { gte: cutoff },
    },
    orderBy: [{ startsAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      startsAt: true,
      endsAt: true,
      venueName: true,
      city: true,
      stateCode: true,
    },
  });

  return reply.send(
    checkInEventsResponseSchema.parse({
      items: events.map((e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        venueName: e.venueName,
        city: e.city,
        stateCode: e.stateCode,
      })),
    }),
  );
});
```

- [x] **Step 4: Run tests**

```bash
pnpm --filter @jdm/api test -- admin/check-in-events.route.test.ts
```

Expected: PASS.

- [x] **Step 5: Full suite**

```bash
pnpm --filter @jdm/api test
```

Expected: all tests green.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/check-in.ts apps/api/test/admin/check-in-events.route.test.ts
git commit -m "feat(api): GET /admin/check-in/events lists active events for staff"
```

---

## Task 9: Admin middleware — staff access + role-based redirects

**Files:**

- Modify: `apps/admin/middleware.ts`

- [ ] **Step 1: Rewrite the middleware**

Replace the contents of `apps/admin/middleware.ts`:

```ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = {
  matcher: ['/', '/events/:path*', '/check-in/:path*', '/login'],
};

type Role = 'organizer' | 'admin' | 'staff';

const isRole = (v: string | undefined): v is Role =>
  v === 'organizer' || v === 'admin' || v === 'staff';

const homeFor = (role: Role) => (role === 'staff' ? '/check-in' : '/events');

export const middleware = (req: NextRequest) => {
  const rawRole = req.cookies.get('session_role')?.value;
  const role = isRole(rawRole) ? rawRole : null;
  const path = req.nextUrl.pathname;

  // Not authed: only /login and / are reachable.
  if (!role) {
    if (path !== '/login' && path !== '/') {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    return NextResponse.next();
  }

  // Authed but hitting /login: send home.
  if (path === '/login' || path === '/') {
    return NextResponse.redirect(new URL(homeFor(role), req.url));
  }

  // Staff cannot touch /events/*.
  if (role === 'staff' && path.startsWith('/events')) {
    return NextResponse.redirect(new URL('/check-in', req.url));
  }

  return NextResponse.next();
};
```

- [ ] **Step 2: Typecheck the admin app**

```bash
pnpm --filter @jdm/admin typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/middleware.ts
git commit -m "feat(admin): allow staff role and route-gate check-in"
```

---

## Task 10: Admin nav + post-login redirect + events layout guard

**Files:**

- Modify: `apps/admin/app/(authed)/layout.tsx`
- Modify: `apps/admin/src/lib/auth-actions.ts`
- Create: `apps/admin/app/(authed)/events/layout.tsx`

- [ ] **Step 1: Role-aware nav**

Replace `apps/admin/app/(authed)/layout.tsx`:

```tsx
import Link from 'next/link';

import { LogoutButton } from '~/components/logout-button';
import { readRole } from '~/lib/auth-session';

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const role = await readRole();
  const isStaff = role === 'staff';

  return (
    <div className="min-h-screen">
      <nav className="flex items-center justify-between border-b border-[color:var(--color-border)] px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href={isStaff ? '/check-in' : '/events'} className="font-semibold">
            JDM Admin
          </Link>
          {!isStaff ? (
            <Link href="/events" className="text-sm opacity-80 hover:opacity-100">
              Eventos
            </Link>
          ) : null}
          <Link href="/check-in" className="text-sm opacity-80 hover:opacity-100">
            Check-in
          </Link>
        </div>
        <LogoutButton />
      </nav>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Role-aware post-login redirect**

Open `apps/admin/src/lib/auth-actions.ts`. Find the line that redirects after successful login (it will be a `redirect('/events')` call). Replace that call with:

```ts
redirect(res.user.role === 'staff' ? '/check-in' : '/events');
```

Where `res` is the `AuthResponse` already available in scope (the login action parses the API response into it). If the local name differs (e.g. `authResponse`, `data`), adapt accordingly — the intent is "use the role from the server's auth response to branch."

- [ ] **Step 3: Events layout server-side guard (defense in depth)**

Create `apps/admin/app/(authed)/events/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';

import { readRole } from '~/lib/auth-session';

export default async function EventsLayout({ children }: { children: React.ReactNode }) {
  const role = await readRole();
  if (role === 'staff') {
    redirect('/check-in');
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/(authed)/layout.tsx apps/admin/app/(authed)/events/layout.tsx apps/admin/src/lib/auth-actions.ts
git commit -m "feat(admin): role-aware nav, post-login redirect, events layout guard"
```

---

## Task 11: Admin API client for check-in

**Files:**

- Modify: `apps/admin/src/lib/admin-api.ts`

- [ ] **Step 1: Add the client functions**

Edit `apps/admin/src/lib/admin-api.ts`. Add new imports at the top (alongside existing):

```ts
import {
  checkInEventsResponseSchema,
  ticketCheckInRequestSchema,
  ticketCheckInResponseSchema,
  type TicketCheckInRequest,
  type TicketCheckInResponse,
} from '@jdm/shared/check-in';
```

Append the two functions at the bottom of the file:

```ts
export const listCheckInEvents = () =>
  apiFetch('/admin/check-in/events', { schema: checkInEventsResponseSchema });

export const checkInTicket = (input: TicketCheckInRequest): Promise<TicketCheckInResponse> =>
  apiFetch('/admin/tickets/check-in', {
    method: 'POST',
    body: JSON.stringify(ticketCheckInRequestSchema.parse(input)),
    schema: ticketCheckInResponseSchema,
  });
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/lib/admin-api.ts
git commit -m "feat(admin): check-in API client functions"
```

---

## ✅ Task 12: `/check-in` event picker page

**Files:**

- Create: `apps/admin/app/(authed)/check-in/page.tsx`

- [x] **Step 1: Write the page**

Create `apps/admin/app/(authed)/check-in/page.tsx`:

```tsx
import Link from 'next/link';

import { listCheckInEvents } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const formatWindow = (startsAtIso: string, endsAtIso: string): string => {
  const start = new Date(startsAtIso);
  const end = new Date(endsAtIso);
  const date = start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const startTime = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${startTime}–${endTime}`;
};

export default async function CheckInIndexPage() {
  const { items } = await listCheckInEvents();

  if (items.length === 0) {
    return (
      <section>
        <h1 className="mb-4 text-2xl font-semibold">Check-in</h1>
        <p className="opacity-80">Nenhum evento disponível para check-in no momento.</p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Check-in</h1>
      <p className="mb-4 opacity-80">Escolha o evento que você está operando.</p>
      <ul className="flex flex-col gap-2">
        {items.map((event) => (
          <li key={event.id}>
            <Link
              href={`/check-in/${event.id}`}
              className="flex flex-col rounded border border-[color:var(--color-border)] p-4 hover:bg-[color:var(--color-surface-hover)]"
            >
              <span className="font-semibold">{event.title}</span>
              <span className="text-sm opacity-80">
                {formatWindow(event.startsAt, event.endsAt)} · {event.venueName ?? '—'} ·{' '}
                {event.city}/{event.stateCode}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [x] **Step 2: Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

Expected: clean.

- [x] **Step 3: Commit**

```bash
git add apps/admin/app/(authed)/check-in/page.tsx
git commit -m "feat(admin): /check-in event picker page"
```

> note: adapted hover class from `hover:bg-[color:var(--color-surface-hover)]` to `hover:opacity-80` (variable does not exist in theme)

---

## ✅ Task 13: Scanner page with `@zxing/browser`

**Files:**

- Modify: `apps/admin/package.json`
- Create: `apps/admin/src/lib/check-in-actions.ts`
- Create: `apps/admin/app/(authed)/check-in/[eventId]/page.tsx`
- Create: `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx`

- [x] **Step 1: Add the QR decoder dep**

Edit `apps/admin/package.json`. Add to `dependencies`:

```json
    "@zxing/browser": "^0.1.5",
    "@zxing/library": "^0.21.3",
```

Then install:

```bash
pnpm --filter @jdm/admin install
```

- [x] **Step 2: Server action wrapping the API call**

Create `apps/admin/src/lib/check-in-actions.ts`:

```ts
'use server';

import { ApiError } from './api';
import { checkInTicket as apiCheckInTicket } from './admin-api';

export type CheckInActionResult =
  | {
      ok: true;
      result: 'admitted' | 'already_used';
      holder: string;
      tier: string;
      checkedInAt: string;
    }
  | { ok: false; error: string; message: string };

export const submitCheckIn = async (
  code: string,
  eventId: string,
): Promise<CheckInActionResult> => {
  try {
    const res = await apiCheckInTicket({ code, eventId });
    return {
      ok: true,
      result: res.result,
      holder: res.ticket.holder.name,
      tier: res.ticket.tier.name,
      checkedInAt: res.ticket.checkedInAt,
    };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, error: err.code, message: err.message };
    }
    return { ok: false, error: 'Unknown', message: 'erro inesperado' };
  }
};
```

- [x] **Step 3: Server page shell**

Create `apps/admin/app/(authed)/check-in/[eventId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';

import { listCheckInEvents } from '~/lib/admin-api';

import { Scanner } from './scanner';

export const dynamic = 'force-dynamic';

export default async function CheckInScannerPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { items } = await listCheckInEvents();
  const event = items.find((e) => e.id === eventId);
  if (!event) notFound();

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold">Check-in · {event.title}</h1>
      <p className="mb-4 opacity-80">
        {event.venueName ?? '—'} · {event.city}/{event.stateCode}
      </p>
      <Scanner eventId={event.id} />
    </section>
  );
}
```

- [x] **Step 4: Client scanner component**

Create `apps/admin/app/(authed)/check-in/[eventId]/scanner.tsx`:

```tsx
'use client';

import { BrowserMultiFormatReader } from '@zxing/browser';
import { useEffect, useRef, useState } from 'react';

import { submitCheckIn, type CheckInActionResult } from '~/lib/check-in-actions';

type ScanState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'result'; data: CheckInActionResult; code: string };

const RESCAN_COOLDOWN_MS = 5000;

export function Scanner({ eventId }: { eventId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>({ kind: 'idle' });
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;
    let stopped = false;

    const start = async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const deviceId = devices[0]?.deviceId;
        if (!deviceId) {
          setCameraError('Nenhuma câmera detectada.');
          return;
        }
        await reader.decodeFromVideoDevice(deviceId, videoRef.current!, (res) => {
          if (stopped || !res) return;
          const code = res.getText();
          const now = Date.now();
          const last = lastScanRef.current;
          if (last && last.code === code && now - last.at < RESCAN_COOLDOWN_MS) return;
          lastScanRef.current = { code, at: now };
          void handleScan(code);
        });
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'erro câmera');
      }
    };

    const handleScan = async (code: string) => {
      setState({ kind: 'pending' });
      const data = await submitCheckIn(code, eventId);
      setState({ kind: 'result', data, code });
    };

    void start();

    return () => {
      stopped = true;
      // @zxing 0.1.x exposes stopStreams via the prototype:
      (reader as unknown as { stopContinuousDecode: () => void }).stopContinuousDecode?.();
      (reader as unknown as { reset: () => void }).reset?.();
    };
  }, [eventId]);

  const dismiss = () => setState({ kind: 'idle' });

  return (
    <div className="flex flex-col gap-4">
      {cameraError ? (
        <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">{cameraError}</p>
      ) : null}
      <video
        ref={videoRef}
        className="w-full max-w-md rounded border border-[color:var(--color-border)] bg-black"
        muted
        playsInline
      />
      <ResultCard state={state} onDismiss={dismiss} />
    </div>
  );
}

function ResultCard({ state, onDismiss }: { state: ScanState; onDismiss: () => void }) {
  if (state.kind === 'idle') {
    return <p className="opacity-80">Aponte para o QR code do ingresso.</p>;
  }
  if (state.kind === 'pending') {
    return <p className="opacity-80">Validando…</p>;
  }
  const { data } = state;
  if (!data.ok) {
    const human = friendlyError(data.error);
    return (
      <div className="rounded border border-red-500/40 bg-red-500/10 p-4">
        <p className="text-lg font-semibold">{human.title}</p>
        <p className="text-sm opacity-80">{human.subtitle ?? data.message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
        >
          Escanear próximo
        </button>
      </div>
    );
  }
  const admitted = data.result === 'admitted';
  return (
    <div
      className={
        admitted
          ? 'rounded border border-green-500/40 bg-green-500/10 p-4'
          : 'rounded border border-amber-500/40 bg-amber-500/10 p-4'
      }
    >
      <p className="text-lg font-semibold">{admitted ? 'Admitido' : 'Ingresso já utilizado'}</p>
      <p>
        {data.holder} · {data.tier}
      </p>
      {!admitted ? (
        <p className="text-sm opacity-80">
          Utilizado em {new Date(data.checkedInAt).toLocaleString('pt-BR')}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
        >
          Escanear próximo
        </button>
      </div>
    </div>
  );
}

function friendlyError(code: string): { title: string; subtitle?: string } {
  switch (code) {
    case 'InvalidTicketCode':
      return { title: 'QR inválido', subtitle: 'Este código não é um ingresso válido.' };
    case 'TicketNotFound':
      return { title: 'Ingresso não encontrado' };
    case 'TicketWrongEvent':
      return {
        title: 'Evento errado',
        subtitle: 'Este ingresso é de outro evento.',
      };
    case 'TicketRevoked':
      return { title: 'Ingresso revogado' };
    default:
      return { title: 'Erro', subtitle: code };
  }
}
```

- [x] **Step 5: Typecheck + lint**

```bash
pnpm --filter @jdm/admin typecheck
pnpm --filter @jdm/admin lint
```

Expected: both clean.

- [x] **Step 6: Build verification**

```bash
pnpm --filter @jdm/admin build
```

Expected: build completes without errors (confirms the @zxing/browser import resolves under webpack).

- [x] **Step 7: Commit**

```bash
git add apps/admin/package.json apps/admin/src/lib/check-in-actions.ts apps/admin/app/(authed)/check-in apps/admin/../pnpm-lock.yaml
git commit -m "feat(admin): QR scanner page for event check-in"
```

(If `pnpm-lock.yaml` changed at the repo root, include it; otherwise drop that path.)

---

## Task 14: Merge-time roadmap + handoff

**Files:**

- Modify: `plans/roadmap.md`
- Rewrite: `handoff.md`

This task runs only at PR-merge time (see CLAUDE.md: the merge PR ticks the boxes).

- [ ] **Step 1: Flip 5.1 and 5.2 markers `[~]` → `[x]` on merge+deploy**

Edit `plans/roadmap.md`: change the two `- [~]` lines for 5.1 and 5.2 to `- [x]`.

- [ ] **Step 2: Rewrite `handoff.md` for the next agent**

Replace `handoff.md` with a summary covering:

- What shipped (new `staff` role, check-in endpoint, scanner UI).
- Test status (`pnpm --filter @jdm/api test` green count, admin typecheck/lint clean, admin build clean).
- Deploy checklist: run the `user_role_staff` migration on Railway; no new env vars.
- Deferred items:
  - No UI to promote a user to `staff` — DBA/seed path only. Capture as "F7b admin user mgmt" follow-up.
  - Mobile door-mode (roadmap 5.3) remains open — optional.
  - Rate limiting on `/admin/tickets/check-in` — to land with the global rate-limit sweep.
  - Scanner manual-entry fallback (type the code) — not in MVP.
  - Ticket holder photo on scan — needs `User.avatarUrl` flow from F2; deferred.
- Manual smoke test for reviewer:
  1. Seed a `staff` user: `UPDATE "User" SET role = 'staff' WHERE email = 'staff@test'`.
  2. Log in at admin as staff — redirected to `/check-in`.
  3. Pick the seeded event; scan a QR from the mobile Ingressos tab.
  4. First scan → green "Admitido" card. Second scan → amber "Ingresso já utilizado" card.
  5. Scan the same QR via an `organizer` account → also works (check-in is staff+organizer+admin).
  6. Log in as staff and manually visit `/events` → redirected back to `/check-in`.

- [ ] **Step 3: Commit at PR time**

```bash
git add plans/roadmap.md handoff.md
git commit -m "docs(f5): tick roadmap 5.1/5.2 and write handoff"
```

---

## Self-review notes

**Spec coverage:**

- Roadmap 5.1 (API check-in endpoint, HMAC verify, atomic used, reject already-used / revoked / wrong-event, idempotent on retry, concurrent-scan → exactly one success) — Tasks 5, 7.
- Roadmap 5.2 (Admin QR scanner page with `@zxing/browser`, holder/tier display, Admit/Reject buttons) — Tasks 12, 13. ("Reject" is client-only dismiss; Admit is automatic on successful scan — rationale in Conventions.)
- Roadmap 5.3 (mobile door-mode) — explicitly deferred; noted in Goal and Deferred items.
- `[REVIEW]` note (staff role, can only check-in, no admin/revenue access, logs in via admin web) — Tasks 2 (DB + shared), 6 (scoped route roles), 9 (middleware), 10 (nav + redirects + events layout guard).

**Placeholder scan:** no "TBD", no "handle edge cases", no "similar to Task N"; every code block is complete.

**Type consistency:**

- `CheckInOutcome.kind` is `'admitted' | 'already_used'` in Task 5 and matches `checkInResultSchema` in Task 4.
- `TicketCheckInResponse.ticket.checkedInAt` is always an ISO string (admit → `now`, already_used → original `usedAt`) — Task 4 schema, Task 7 route, Task 13 scanner all agree.
- `adminAuditActionSchema` includes `'ticket.check_in'` in Task 3; consumed in Task 7.
- `RecordAuditInput.entityType` includes `'ticket'` in Task 3; consumed in Task 7.
- `userRoleSchema` includes `'staff'` in Task 2; consumed in Task 6 (requireRole widening) and Task 10 (admin nav role check).
- Admin API client function names match between Tasks 11, 12, 13 (`listCheckInEvents`, `checkInTicket`).
