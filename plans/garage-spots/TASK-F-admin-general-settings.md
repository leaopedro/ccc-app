# TASK-F — Admin General Settings: Default Free Garage Spots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `defaultFreeGarageSpots` admin control to General Settings (numeric with "Ilimitado" toggle, `null` = unlimited) that, on save, fans out a synchronous `reconcileGarageSpots(userId)` call per active user, records an `AdminAudit` entry, and is persisted through the existing PUT `/admin/general/settings` route.

**Architecture:** Extend the existing Zod schemas in `packages/shared/src/general-settings.ts` to accept a nullable non-negative integer. Extend the existing PUT route in `apps/api/src/routes/admin/general-settings.ts` to map the new field onto the new `GeneralSettings.defaultFreeGarageSpots` column (added by TASK-A), then iterate the active user set and call `reconcileGarageSpots(userId)` from TASK-B. Audit metadata captures the previous and next values. The admin web form gains a fieldset with a numeric input and an "Ilimitado" toggle, persisting via the existing server action.

**Tech Stack:** Fastify, Prisma, Zod, Vitest (real Postgres via Testcontainers — see `apps/api/test/helpers.ts`), Next.js App Router (admin), React Server Actions, TypeScript strict mode end-to-end.

**Sequencing prerequisites (must be merged first):**

- TASK-A: `GeneralSettings.defaultFreeGarageSpots Int?` column and AdminAudit action enum extension (`general_settings.update` already exists — no new action introduced by this task).
- TASK-B: `reconcileGarageSpots(userId: string, outerTx?: Prisma.TransactionClient): Promise<void>` service. The service reads `GeneralSettings.defaultFreeGarageSpots` from the DB itself; TASK-F does NOT pass the new limit as an argument. Signature is frozen as of TASK-B's plan at `apps/api/src/services/garage/index.ts`. TASK-F must be rebased onto TASK-B before Task F2 begins.

---

## File Structure

| File                                                              | Responsibility                                                   | Action                                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/general-settings.ts`                         | Zod schemas for read + update payloads                           | Modify: add `defaultFreeGarageSpots` to `generalSettingsSchema` and `generalSettingsUpdateSchema`.                                 |
| `packages/shared/src/__tests__/general-settings.test.ts`          | Schema-level unit tests                                          | Modify: add cases for `null`, `0`, positive ints, negative rejection, non-integer rejection.                                       |
| `apps/api/src/routes/admin/serializers.ts`                        | DB row → API payload mapping                                     | Modify: include `defaultFreeGarageSpots` in `serializeAdminGeneralSettings`.                                                       |
| `apps/api/src/routes/admin/general-settings.ts`                   | PUT handler                                                      | Modify: accept the new field, update column, fan out reconcile per active user, audit.                                             |
| `apps/api/src/services/garage/reconcile.ts` (owned by TASK-B)     | Reconciliation service                                           | Read-only import.                                                                                                                  |
| `apps/api/test/admin/general-settings.test.ts`                    | Route-level integration tests against real Postgres (zero mocks) | Modify: add persistence cases for null, 0, positive, audit metadata. No `vi.mock`.                                                 |
| `apps/api/test/admin/general-settings-fanout.test.ts`             | Route-unit tests with mocked reconcile                           | Create: fanout call-count, skip-on-same-value, partial-failure secondary audit.                                                    |
| `apps/admin/src/lib/admin-api.ts`                                 | Admin client API wrappers                                        | No change required — schemas auto-thread through `generalSettingsSchema`.                                                          |
| `apps/admin/app/(authed)/configuracoes/general-settings-form.tsx` | Admin web form                                                   | Modify: add the new "Vagas de garagem grátis por usuário" fieldset + "Ilimitado" toggle, route through the existing server action. |

No new files are created in this task. All work is additive on existing files.

---

## Goal

Ship the admin control that decides how many free garage spots each user gets. Persisting the field must trigger eager reconciliation so every existing user's `GarageSpot` rows match the new limit immediately (per the `brainstorm.md` invariant that free spots are eagerly materialised, not lazily). The admin should see the new field next to the existing capacity-display controls and the value must round-trip through GET/PUT cleanly.

## Scope summary

In scope:

- Zod schema extension on `generalSettingsSchema` and `generalSettingsUpdateSchema` for `defaultFreeGarageSpots: number | null`.
- Existing PUT `/admin/general/settings` route accepts the new field. **No new PATCH endpoint.**
- Synchronous fanout loop on save calling `reconcileGarageSpots(userId)` for each active user (`User.status='active'`, `deletedAt IS NULL`, `anonymizedAt IS NULL`).
- `AdminAudit` entry uses the existing `general_settings.update` action with metadata that includes the touched field key and the before/after values.
- Admin form in `configuracoes/general-settings-form.tsx` exposes the field with an "Ilimitado" checkbox.
- Tests cover schema parsing, route persistence, fanout behaviour, partial-failure semantics, audit metadata.

Out of scope:

- Schema column addition itself — owned by TASK-A.
- `reconcileGarageSpots` implementation — owned by TASK-B. This task only calls it.
- Admin user-detail garage management — TASK-G.
- Mobile UI — TASK-D / TASK-E.
- Job-queue replacement of the synchronous fanout — captured as a logged TODO.

---

## Zod schema delta

### `packages/shared/src/general-settings.ts`

**Add a non-exported, file-scoped helper just below `thresholdPercentSchema` (~line 25):**

```ts
const defaultFreeGarageSpotsSchema = z.number().int().nonnegative().nullable();
```

**Extend `generalSettingsSchema` (currently lines 39–44):**

```ts
export const generalSettingsSchema = z.object({
  id: z.string().min(1),
  capacityDisplay: capacityDisplayPolicySchema,
  defaultFreeGarageSpots: defaultFreeGarageSpotsSchema,
  updatedAt: z.string().datetime(),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
```

**Extend `generalSettingsUpdateSchema` (currently lines 54–77). Replace the whole declaration with:**

```ts
export const generalSettingsUpdateSchema = z
  .object({
    capacityDisplay: z
      .object({
        tickets: capacityDisplaySurfaceUpdateSchema.optional(),
        extras: capacityDisplaySurfaceUpdateSchema.optional(),
        products: capacityDisplaySurfaceUpdateSchema.optional(),
      })
      .strict()
      .optional(),
    defaultFreeGarageSpots: defaultFreeGarageSpotsSchema.optional(),
  })
  .strict()
  .refine(
    (value) => {
      const surfaces = value.capacityDisplay;
      const capacityTouched =
        surfaces !== undefined &&
        Object.values(surfaces).some(
          (surface) =>
            surface !== undefined &&
            (surface.mode !== undefined || surface.thresholdPercent !== undefined),
        );
      const garageTouched = value.defaultFreeGarageSpots !== undefined;
      return capacityTouched || garageTouched;
    },
    { message: 'envie ao menos um campo para atualizar' },
  );
export type GeneralSettingsUpdate = z.infer<typeof generalSettingsUpdateSchema>;
```

Why `.optional()` and not just `.nullable()`: `null` is a meaningful value ("Ilimitado") that must be persistable. `undefined` (i.e. omitted) means "do not touch this field". Combined `.nullable().optional()` is required.

Why a refine helper instead of leaving the existing one as-is: an update body that only sets `defaultFreeGarageSpots` (no `capacityDisplay`) must be accepted.

---

## File-by-file changes

### 1. `packages/shared/src/general-settings.ts`

See the schema delta above. Touch lines ~25 (helper), ~39 (read schema), ~54 (update schema). Do not edit `defaultCapacityDisplayPolicy`, `computeCapacityDisplay`, or any other export — they are unrelated.

### 2. `apps/api/src/routes/admin/serializers.ts`

The serializer at line 124 currently returns:

```ts
export const serializeAdminGeneralSettings = (s: DbGeneralSettings) => ({
  id: s.id,
  capacityDisplay: toCapacityDisplayPolicy(s),
  updatedAt: s.updatedAt.toISOString(),
});
```

Replace with:

```ts
export const serializeAdminGeneralSettings = (s: DbGeneralSettings) => ({
  id: s.id,
  capacityDisplay: toCapacityDisplayPolicy(s),
  defaultFreeGarageSpots: s.defaultFreeGarageSpots,
  updatedAt: s.updatedAt.toISOString(),
});
```

`s.defaultFreeGarageSpots` is `number | null` once TASK-A lands. No null-coalescing — `null` is the unlimited sentinel and must round-trip verbatim.

### 3. `apps/api/src/routes/admin/general-settings.ts` (PUT handler)

Full replacement of the file's body (keep imports, add the reconcile import + Prisma transaction usage):

```ts
import { prisma } from '@jdm/db';
import {
  GENERAL_SETTINGS_SINGLETON_ID,
  generalSettingsUpdateSchema,
} from '@jdm/shared/general-settings';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';
import { recordAudit } from '../../services/admin-audit.js';
import { reconcileGarageSpots } from '../../services/garage/reconcile.js';
import { ensureGeneralSettings } from '../../services/general-settings.js';

import { serializeAdminGeneralSettings } from './serializers.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminGeneralSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/general/settings', async () => {
    const settings = await ensureGeneralSettings();
    return serializeAdminGeneralSettings(settings);
  });

  app.put('/general/settings', async (request) => {
    const { sub } = requireUser(request);
    const input = generalSettingsUpdateSchema.parse(request.body);

    const existing = await ensureGeneralSettings();

    const data: Prisma.GeneralSettingsUpdateInput = {};
    const capacity = input.capacityDisplay ?? {};
    const touched: string[] = [];

    if (capacity.tickets) {
      if (capacity.tickets.mode !== undefined) {
        data.ticketCapacityMode = capacity.tickets.mode;
        touched.push('capacityDisplay.tickets.mode');
      }
      if (capacity.tickets.thresholdPercent !== undefined) {
        data.ticketCapacityThresholdPercent = capacity.tickets.thresholdPercent;
        touched.push('capacityDisplay.tickets.thresholdPercent');
      }
    }
    if (capacity.extras) {
      if (capacity.extras.mode !== undefined) {
        data.extraCapacityMode = capacity.extras.mode;
        touched.push('capacityDisplay.extras.mode');
      }
      if (capacity.extras.thresholdPercent !== undefined) {
        data.extraCapacityThresholdPercent = capacity.extras.thresholdPercent;
        touched.push('capacityDisplay.extras.thresholdPercent');
      }
    }
    if (capacity.products) {
      if (capacity.products.mode !== undefined) {
        data.productCapacityMode = capacity.products.mode;
        touched.push('capacityDisplay.products.mode');
      }
      if (capacity.products.thresholdPercent !== undefined) {
        data.productCapacityThresholdPercent = capacity.products.thresholdPercent;
        touched.push('capacityDisplay.products.thresholdPercent');
      }
    }

    let garageSpotsChanged = false;
    let previousFreeLimit: number | null = existing.defaultFreeGarageSpots;
    let nextFreeLimit: number | null = previousFreeLimit;
    if (input.defaultFreeGarageSpots !== undefined) {
      data.defaultFreeGarageSpots = input.defaultFreeGarageSpots;
      nextFreeLimit = input.defaultFreeGarageSpots;
      garageSpotsChanged = previousFreeLimit !== nextFreeLimit;
      if (garageSpotsChanged) {
        touched.push('defaultFreeGarageSpots');
      }
    }

    const updated = await prisma.generalSettings.update({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      data,
    });

    await recordAudit({
      actorId: sub,
      action: 'general_settings.update',
      entityType: 'general_settings',
      entityId: updated.id,
      metadata: {
        fields: touched,
        ...(garageSpotsChanged
          ? {
              defaultFreeGarageSpots: {
                previous: previousFreeLimit,
                next: nextFreeLimit,
              },
            }
          : {}),
      },
    });

    if (garageSpotsChanged) {
      // MVP fanout — synchronous loop. See plan TASK-F §"Fanout behavior".
      // TODO(JDMA): move to background job queue once active user count >
      // ~10_000 or fanout p95 exceeds 5s. Tracked in roadmap.
      const activeUsers = await prisma.user.findMany({
        where: {
          status: 'active',
          deletedAt: null,
          anonymizedAt: null,
        },
        select: { id: true },
      });

      const failures: { userId: string; error: string }[] = [];
      for (const u of activeUsers) {
        try {
          await reconcileGarageSpots(u.id);
        } catch (err) {
          failures.push({
            userId: u.id,
            error: err instanceof Error ? err.message : String(err),
          });
          request.log.warn(
            { err, userId: u.id, freeLimit: nextFreeLimit },
            'reconcileGarageSpots failed for user during settings fanout',
          );
        }
      }

      request.log.info(
        {
          actorId: sub,
          previousFreeLimit,
          nextFreeLimit,
          totalUsers: activeUsers.length,
          failureCount: failures.length,
        },
        'garage spots fanout completed',
      );

      if (failures.length > 0) {
        await recordAudit({
          actorId: sub,
          action: 'general_settings.update',
          entityType: 'general_settings',
          entityId: updated.id,
          metadata: {
            event: 'garage_fanout_partial_failure',
            totalUsers: activeUsers.length,
            failureCount: failures.length,
            failures: failures.slice(0, 50),
          },
        });
      }
    }

    return serializeAdminGeneralSettings(updated);
  });
};
```

Key behaviours codified in this handler:

- The `defaultFreeGarageSpots` field is only persisted when the request explicitly includes it (`input.defaultFreeGarageSpots !== undefined`). Setting it to `null` is a valid persistence path (unlimited).
- The fanout only runs when the value actually changed. Idempotent saves with the same value are cheap — no reconcile calls, no extra audit row.
- The `reconcileGarageSpots` call here is `reconcileGarageSpots(u.id)` with no second argument. TASK-B's service reads `GeneralSettings.defaultFreeGarageSpots` itself inside its Serializable transaction, so TASK-F does not pass the limit. The signature is `(userId: string, outerTx?: Prisma.TransactionClient)` as declared in TASK-B's plan.
- Per-user errors are caught individually so a single failing user does not abort the rest of the fanout. Failures are logged and aggregated into a secondary `AdminAudit` row capped at 50 entries to avoid unbounded metadata.
- The PUT response intentionally returns 200 with the new settings even when partial failures occurred. Operators discover failures through the audit row and structured log line. If a stricter contract is wanted, see "Open questions".

### 4. `apps/admin/app/(authed)/configuracoes/general-settings-form.tsx`

Add a new fieldset above the existing capacity surfaces and wire it through the existing server action.

**Required code changes:**

a) Extend the form's local state type at line ~43:

```ts
type FormState = {
  policy: PolicyState;
  defaultFreeGarageSpots: { unlimited: boolean; value: string };
};
```

b) Replace the `useState<PolicyState>(...)` call at line ~82 with a single combined state:

```ts
const [state, setState] = useState<FormState>({
  policy: toPolicyState(initial.capacityDisplay),
  defaultFreeGarageSpots: {
    unlimited: initial.defaultFreeGarageSpots === null,
    value: initial.defaultFreeGarageSpots === null ? '0' : String(initial.defaultFreeGarageSpots),
  },
});
```

c) Update the helpers `setSurfaceMode` / `setSurfaceThreshold` to operate on `state.policy` (rename `prev[key]` → `prev.policy[key]` and merge under `policy`).

d) Add new helpers:

```ts
const setGarageUnlimited = (unlimited: boolean) =>
  setState((prev) => ({
    ...prev,
    defaultFreeGarageSpots: { ...prev.defaultFreeGarageSpots, unlimited },
  }));

const setGarageValue = (value: string) =>
  setState((prev) => ({
    ...prev,
    defaultFreeGarageSpots: { ...prev.defaultFreeGarageSpots, value },
  }));
```

e) Add a new fieldset inside the form, immediately after the closing `</fieldset>` of the last capacity surface (~line 188, before the error/success blocks):

```tsx
<fieldset className="flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-4">
  <legend className="px-1 text-sm font-medium">Garagem</legend>
  <p className="text-xs text-[color:var(--color-muted)]">
    Quantas vagas grátis cada usuário recebe. "Ilimitado" desativa o limite.
  </p>

  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={state.defaultFreeGarageSpots.unlimited}
      onChange={(e) => setGarageUnlimited(e.target.checked)}
      aria-label="Vagas de garagem grátis ilimitadas"
    />
    <span>Ilimitado</span>
  </label>

  <label className={labelCls}>
    <span className="font-medium">Vagas de garagem grátis por usuário</span>
    <input
      type="number"
      min={0}
      step={1}
      value={state.defaultFreeGarageSpots.value}
      disabled={state.defaultFreeGarageSpots.unlimited}
      onChange={(e) => setGarageValue(e.target.value)}
      className={inputCls}
      aria-label="Vagas de garagem grátis por usuário"
    />
    <span className="text-xs text-[color:var(--color-muted)]">
      Quando você salvar, o sistema reconcilia as vagas de todos os usuários ativos (pode levar
      alguns segundos).
    </span>
    {/* Inline warning shown only when the new value is lower than the current persisted value */}
    {!state.defaultFreeGarageSpots.unlimited &&
      Number(state.defaultFreeGarageSpots.value) < (initial.defaultFreeGarageSpots ?? Infinity) && (
        <span className="text-xs text-amber-600" role="alert">
          Reduzir o limite remove vagas vazias de todos os usuários ativos imediatamente.
        </span>
      )}
  </label>
</fieldset>
```

Note: the warning compares the typed value against `initial.defaultFreeGarageSpots` (the last-persisted value passed as a prop). When `initial.defaultFreeGarageSpots` is `null` (unlimited), `Infinity` is used so the warning never fires when going from unlimited to a bounded value, which is an increase. The warning is purely informational; it does not block the submit.

f) Update `handleSubmit` (~line 94). Add the garage payload before the `startTransition` call:

```ts
let garagePayload: number | null | undefined;
const { unlimited, value } = state.defaultFreeGarageSpots;
if (unlimited) {
  garagePayload = null;
} else {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    setError('Vagas de garagem grátis deve ser um inteiro maior ou igual a zero.');
    return;
  }
  garagePayload = parsed;
}
```

g) Change the `updateAdminGeneralSettingsAction` call to include the new field:

```ts
const result = await updateAdminGeneralSettingsAction({
  capacityDisplay: payload,
  defaultFreeGarageSpots: garagePayload,
});
```

h) On success, sync the new field back from the response:

```ts
if (result.ok) {
  setState({
    policy: toPolicyState(result.settings.capacityDisplay),
    defaultFreeGarageSpots: {
      unlimited: result.settings.defaultFreeGarageSpots === null,
      value:
        result.settings.defaultFreeGarageSpots === null
          ? '0'
          : String(result.settings.defaultFreeGarageSpots),
    },
  });
  setUpdatedAt(result.settings.updatedAt);
  setSuccess('Configurações salvas.');
}
```

i) The `payload` build loop at line ~103 must read from `state.policy[key]` instead of `state[key]` after the state restructure.

No change to `apps/admin/src/lib/general-settings-actions.ts` or `apps/admin/src/lib/admin-api.ts` — both already pass `GeneralSettingsUpdate` through to `apiFetch` and parse the response with `generalSettingsSchema`.

---

## Fanout behavior

- **Trigger:** only when `defaultFreeGarageSpots` actually changes (the saved row's prior value differs from the incoming value). Saves that only change capacity-display surfaces do not fan out.
- **Sequencing:** the audit row is written **before** the fanout starts. This guarantees the admin's intent is recorded even if the API process crashes mid-fanout. A second audit row is written **after** the fanout if any per-user reconcile failed.
- **Scope of active users:** `prisma.user.findMany({ where: { status: 'active', deletedAt: null, anonymizedAt: null } })`. Partial users and disabled/deleted/anonymized users are skipped. `UserStatus` enum lives at `packages/db/prisma/schema.prisma:25`.
- **Loop:** plain sequential `for` loop. Sequential is intentional in MVP — it avoids Prisma connection-pool exhaustion and predictable load. No `Promise.all`.
- **Error handling:** per-user `try/catch`. A failing user is collected into a `failures[]` array and the loop continues. Aggregation log line is always emitted; secondary audit row is only emitted when `failures.length > 0`. Metadata caps `failures` at the first 50 entries to bound row size. Rationale: each entry is roughly `{ userId: ~30 chars, error: ~70 chars }`, so 50 entries total around 5 KB. JSONB has no hard size limit in Postgres, but rows over ~8 KB start spilling to TOAST pages; 5 KB stays well within a single heap page. The full list is always available in the structured log line, so the cap only affects the audit record, not observability.
- **Partial-failure semantics:** the PUT still returns 200 with the new settings even on partial failure. Rationale: the settings row update is the source of truth; rerunning the save with the same value is a no-op (no fanout, since previous == next), so admins cannot easily retry by re-saving. Operators must inspect the audit log to find the affected users and rerun reconcile manually. Documented as an open question below.
- **Concurrency:** no in-process lock. If two admins save simultaneously, the second save sees the first's persisted value as `previous`, and either both fanouts run (different values) or only the differing save fans out. `reconcileGarageSpots` is expected to be idempotent per TASK-B's Serializable transaction contract.
- **Cost note:** synchronous fanout is documented as MVP-only. The TODO threshold in the handler and the Risks section both cite ~10_000 active users as the promotion trigger. A TODO comment in the route handler and a roadmap entry in `Car_spot_plan.md` §10 already capture the move-to-queue obligation. No work is done in TASK-F to introduce the queue; the failure path is the trigger for promotion.

---

## AdminAudit entry

- **Action:** `general_settings.update` (existing — no new enum value required).
- **EntityType:** `general_settings` (existing).
- **EntityId:** `GENERAL_SETTINGS_SINGLETON_ID` (the literal `'general_default'`).
- **Primary metadata payload** (always written, even if only capacity-display changed):
  ```jsonc
  {
    "fields": ["defaultFreeGarageSpots"],
    "defaultFreeGarageSpots": {
      "previous": 3, // or null when previously unlimited
      "next": 5, // or null when newly unlimited
    },
  }
  ```
  When the change touched both garage and capacity display, `fields` contains every touched key and the `defaultFreeGarageSpots` before/after sub-object is present only if that field actually changed.
- **Secondary metadata payload** (written only if fanout had at least one failure):
  ```jsonc
  {
    "event": "garage_fanout_partial_failure",
    "totalUsers": 1500,
    "failureCount": 3,
    "failures": [{ "userId": "ckxy...", "error": "P2034 transaction conflict" }],
  }
  ```
  `failures` is capped at the first 50 entries to avoid blowing up the audit row's JSON column. Full failure list is reconstructable from the structured log line.

Both audit rows share the same `actorId`, `action`, `entityType`, `entityId`. Distinguish via the `event` key inside `metadata`.

---

## Test plan

All tests live in:

- `packages/shared/src/__tests__/general-settings.test.ts` (unit, Vitest, schema only).
- `apps/api/test/admin/general-settings.test.ts` (integration, Vitest + real Postgres via existing test helpers — zero mocks, must stay that way).
- `apps/api/test/admin/general-settings-fanout.test.ts` (new route-unit file, Vitest + `vi.mock` — fanout-specific assertions only, no real Postgres required).

The existing `general-settings.test.ts` is a pure integration test with zero mocks. Injecting `vi.mock` into it would silently mix patterns and make future readers uncertain whether any test relies on the mock. All fanout-specific tests that need `reconcileGarageSpots` mocked go into the dedicated `general-settings-fanout.test.ts` file instead.

### Shared schema unit tests (`packages/shared/src/__tests__/general-settings.test.ts`)

Add a new `describe('generalSettingsUpdateSchema — defaultFreeGarageSpots', () => { ... })` block with:

- **Accepts `null`** (Ilimitado):
  ```ts
  it('accepts null as unlimited', () => {
    expect(generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: null })).toEqual({
      defaultFreeGarageSpots: null,
    });
  });
  ```
- **Accepts `0`:**
  ```ts
  it('accepts 0', () => {
    expect(generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: 0 })).toEqual({
      defaultFreeGarageSpots: 0,
    });
  });
  ```
- **Accepts a positive integer:**
  ```ts
  it('accepts a positive integer', () => {
    expect(generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: 7 })).toEqual({
      defaultFreeGarageSpots: 7,
    });
  });
  ```
- **Rejects negative integers:**
  ```ts
  it('rejects negative integers', () => {
    expect(() => generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: -1 })).toThrow();
  });
  ```
- **Rejects non-integers (decimals):**
  ```ts
  it('rejects non-integer numbers', () => {
    expect(() => generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: 2.5 })).toThrow();
  });
  ```
- **Rejects string input:**
  ```ts
  it('rejects strings', () => {
    expect(() => generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: '3' })).toThrow();
  });
  ```
- **Accepts a body that only sets defaultFreeGarageSpots (no capacityDisplay)** — guards the refine update.
- **Still rejects an empty body** — the existing test stays green.

### API route integration tests (`apps/api/test/admin/general-settings.test.ts`)

The existing file stays zero-mock. Add only the persistence cases here (no reconcile call-count assertions):

Add these cases:

**Persistence cases (no reconcile call-count assertions, real Postgres, no mocks):**

- **PUT with `defaultFreeGarageSpots: null` persists null:**
  - Call PUT with body `{ defaultFreeGarageSpots: null }`.
  - Expect 200, response `defaultFreeGarageSpots === null`, persisted row's column is `null`.
- **PUT with `defaultFreeGarageSpots: 0` persists 0:**
  - Body `{ defaultFreeGarageSpots: 0 }`. Persisted column is `0` (not null; these differ semantically).
- **PUT with a positive integer persists:**
  - Body `{ defaultFreeGarageSpots: 5 }`. Persisted column is `5`. `reconcileGarageSpots` called with `(userId)` only; the service reads the new limit from the DB.
- **PUT records primary AdminAudit row with before/after metadata:**
  - Pre-seed `defaultFreeGarageSpots = 1`, PUT body `{ defaultFreeGarageSpots: 5 }`.
  - Inspect the audit row: `metadata.fields` contains `'defaultFreeGarageSpots'`, `metadata.defaultFreeGarageSpots` deep-equals `{ previous: 1, next: 5 }`.
- **PUT with mixed body (capacityDisplay + defaultFreeGarageSpots) updates both:**
  - Body `{ capacityDisplay: { tickets: { mode: 'hidden' } }, defaultFreeGarageSpots: 2 }`.
  - Persisted row has `ticketCapacityMode === 'hidden'` and `defaultFreeGarageSpots === 2`.
- **GET returns the persisted value (null and integer):**
  - Two cases. Inspect parsed response shape against `generalSettingsSchema`.
- **Existing tests stay green:** the four existing test cases (`PUT updates only the supplied surfaces`, `PUT writes an admin audit row`, `PUT rejects empty body`, `PUT rejects out-of-range threshold`, role + auth guards) must still pass without modification.

### Route-unit fanout tests (`apps/api/test/admin/general-settings-fanout.test.ts`) — new file

This file uses `vi.mock` to avoid a real Postgres dependency for fanout-specific call-count and partial-failure assertions. It does not use the `makeApp`/`resetDatabase` integration helpers.

```ts
import { vi } from 'vitest';

const reconcileMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../src/services/garage/reconcile.js', () => ({
  reconcileGarageSpots: reconcileMock,
}));
```

Add these cases:

- **Fanout calls reconcileGarageSpots once per active user, skips inactive:**
  - Seed 3 active users + 1 disabled + 1 deleted.
  - PUT body `{ defaultFreeGarageSpots: null }`.
  - `reconcileMock` called exactly 3 times, each with an active user's id.
- **PUT with the same value does NOT fan out:**
  - Pre-seed `defaultFreeGarageSpots = 3`. PUT body `{ defaultFreeGarageSpots: 3 }`.
  - Expect 200, `reconcileMock` not called, only the primary audit row written (with `fields: []` and no `defaultFreeGarageSpots` metadata sub-object).
- **PUT records secondary AdminAudit row when a reconcile fails:**
  - `reconcileMock.mockImplementationOnce(async () => { throw new Error('boom'); }).mockImplementation(async () => undefined);`
  - Seed 2 active users. PUT body `{ defaultFreeGarageSpots: 4 }`.
  - Expect 200 response.
  - Two audit rows for `entityType='general_settings'`: one primary (`fields` contains `'defaultFreeGarageSpots'`), one secondary (`metadata.event === 'garage_fanout_partial_failure'`, `metadata.failureCount === 1`, `metadata.failures[0].userId` is the failing user).
- **PUT with only capacityDisplay does NOT fan out:**
  - Body `{ capacityDisplay: { extras: { mode: 'hidden' } } }`.
  - `reconcileMock` not called.

### Admin web form

No new tests required — `apps/admin` runs `vitest run --passWithNoTests` and the existing config has no form-level tests. The form is a thin wrapper around the server action; the API integration tests cover the contract. If a smoke component test is later requested, place it in `apps/admin/src/lib/__tests__/general-settings-form.test.tsx`.

### Commands

- `pnpm --filter @jdm/shared test` — schema unit tests.
- `pnpm --filter @jdm/api test test/admin/general-settings.test.ts` — route integration tests, zero mocks (Postgres via `apps/api/test/global-setup.ts`).
- `pnpm --filter @jdm/api test test/admin/general-settings-fanout.test.ts` — fanout unit tests with mocked reconcile.
- `pnpm --filter @jdm/shared build && pnpm --filter @jdm/api typecheck && pnpm --filter @jdm/admin typecheck` — after schema changes, rebuild shared so dist is fresh (see project rule).
- `pnpm --filter @jdm/admin lint && pnpm --filter @jdm/admin typecheck` — admin form changes.

---

## Bite-sized task breakdown

### Task F1: Extend Zod schemas in @jdm/shared

**Files:**

- Modify: `packages/shared/src/general-settings.ts`
- Modify: `packages/shared/src/__tests__/general-settings.test.ts`

- [ ] **Step 1: Branch from fresh main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-task-f-default-free-garage-spots
```

Expected: clean working tree on the new feature branch.

- [ ] **Step 2: Write the failing schema tests**

Append a new `describe('generalSettingsUpdateSchema — defaultFreeGarageSpots', () => { ... })` block to `packages/shared/src/__tests__/general-settings.test.ts` containing every case enumerated in the "Shared schema unit tests" section above.

- [ ] **Step 3: Run tests to verify failure**

```bash
pnpm --filter @jdm/shared test
```

Expected: FAIL — `defaultFreeGarageSpots` is not yet recognised.

- [ ] **Step 4: Apply the schema delta**

Add `defaultFreeGarageSpotsSchema` helper, update `generalSettingsSchema`, and replace `generalSettingsUpdateSchema` per the Zod schema delta section.

- [ ] **Step 5: Run tests and the build**

```bash
pnpm --filter @jdm/shared test
pnpm --filter @jdm/shared build
```

Expected: tests PASS, build succeeds (per project rule "rebuild @jdm/shared after schema changes").

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/general-settings.ts packages/shared/src/__tests__/general-settings.test.ts
git commit -m "feat(shared): add defaultFreeGarageSpots to general settings schema"
```

### Task F2: Extend serializer + add fanout to admin PUT route

**Prerequisites for this task:**

- TASK-A must be merged and the feature branch rebased onto it (`git rebase origin/main` after TASK-A merges to main). TASK-A adds `GeneralSettings.defaultFreeGarageSpots Int?` to the Prisma schema.
- TASK-B must be merged and the feature branch rebased onto it for `reconcileGarageSpots` to be importable.
- `prisma generate` must have been run after the TASK-A rebase so that `@prisma/client` exports the `defaultFreeGarageSpots` field. Verify with: `grep -r "defaultFreeGarageSpots" node_modules/.prisma/client/index.d.ts` — if the field is absent, re-run `pnpm db:generate` before continuing.

**Files:**

- Modify: `apps/api/src/routes/admin/serializers.ts:124-128`
- Modify: `apps/api/src/routes/admin/general-settings.ts`

- [ ] **Step 1: Verify TASK-A column is present in the generated client**

```bash
grep -r "defaultFreeGarageSpots" node_modules/.prisma/client/index.d.ts | head -3
```

Expected: at least one matching line. If absent, run `pnpm db:generate` first.

- [ ] **Step 2: Update serializer**

Edit `serializeAdminGeneralSettings` to include `defaultFreeGarageSpots: s.defaultFreeGarageSpots` (see file-by-file changes section).

- [ ] **Step 3: Verify the API typechecks**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: PASS (requires TASK-A column in generated client, verified in step 1).

- [ ] **Step 4: Replace the PUT handler**

Apply the full replacement of `apps/api/src/routes/admin/general-settings.ts` per the file-by-file changes section.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter @jdm/api typecheck
pnpm --filter @jdm/api lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/serializers.ts apps/api/src/routes/admin/general-settings.ts
git commit -m "feat(api): persist defaultFreeGarageSpots and fan out reconcile"
```

### Task F3: Add API tests — persistence cases + fanout unit file

**Files:**

- Modify: `apps/api/test/admin/general-settings.test.ts` (persistence cases, zero mocks)
- Create: `apps/api/test/admin/general-settings-fanout.test.ts` (fanout/mock cases)

- [ ] **Step 1: Add persistence cases to the integration file**

Append the persistence-only test cases from the "Persistence cases" subsection to `apps/api/test/admin/general-settings.test.ts`. Do NOT add any `vi.mock` call to this file.

- [ ] **Step 2: Create the fanout unit file**

Create `apps/api/test/admin/general-settings-fanout.test.ts`. At the top of the file add:

```ts
import { vi } from 'vitest';

const reconcileMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../src/services/garage/reconcile.js', () => ({
  reconcileGarageSpots: reconcileMock,
}));
```

Add a `beforeEach` that clears the mock between tests:

```ts
beforeEach(() => {
  reconcileMock.mockClear();
});
```

Then add every case from the "Route-unit fanout tests" subsection.

- [ ] **Step 3: Run both files**

```bash
pnpm --filter @jdm/api test test/admin/general-settings.test.ts
pnpm --filter @jdm/api test test/admin/general-settings-fanout.test.ts
```

Expected: all new cases PASS, existing cases stay PASS.

If a case fails, do not soften the assertion — fix the handler. Likely culprits: forgot to skip non-active users in the `findMany` filter; audit metadata shape diverged from the test's expectation; `garageSpotsChanged` flag not correctly computed.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/admin/general-settings.test.ts apps/api/test/admin/general-settings-fanout.test.ts
git commit -m "test(api): cover defaultFreeGarageSpots persistence and fanout"
```

### Task F4: Wire the admin form fieldset

**Files:**

- Modify: `apps/admin/app/(authed)/configuracoes/general-settings-form.tsx`

- [ ] **Step 1: Read the latest version of the file**

Refresh context before editing (the file already has the capacity-display fieldsets and the submit handler).

- [ ] **Step 2: Apply the form changes**

Restructure local state to the `FormState` shape, add the two helpers, render the new fieldset, update `handleSubmit` to assemble `garagePayload`, and sync the response back into the new shape. See subsections (a)–(i) of the file-by-file changes section.

- [ ] **Step 3: Typecheck and lint**

```bash
pnpm --filter @jdm/admin typecheck
pnpm --filter @jdm/admin lint
```

Expected: PASS.

- [ ] **Step 4: Smoke run locally (optional but recommended)**

```bash
pnpm --filter @jdm/admin dev
```

Open `http://localhost:3000/configuracoes`. Verify:

- Toggling "Ilimitado" disables the numeric input.
- Negative value shows the inline error and does not submit.
- Saving with a new positive value persists (refresh shows the value); saving "Ilimitado" persists null.

If the local API is not running, skip this step and rely on the API integration tests + form typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/\(authed\)/configuracoes/general-settings-form.tsx
git commit -m "feat(admin): default free garage spots field with unlimited toggle"
```

### Task F5: Open a PR to main

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/jdma-task-f-default-free-garage-spots
gh pr create --base main --title "TASK-F: admin default free garage spots + reconcile fanout"   --body "Implements TASK-F per /Users/pedro/Projects/jdm-experience/plans/garage-spots/TASK-F-admin-general-settings.md. Depends on TASK-A column + TASK-B reconcileGarageSpots(); merge order enforced by Car_spot_plan.md §9."
```

- [ ] **Step 2: Request review on the PR (not on the branch).**

Per `CLAUDE.md` git flow.

---

## Risks

- **Fanout cost.** Synchronous loop is O(active users) per save. Reconcile per user is a Serializable Prisma transaction. With ~10_000 users and a 50ms median reconcile, a single save takes ~8 minutes and ties up a Fastify worker. Mitigations baked into MVP: the loop only fires when the value changes; saves with the same value are free; sequential execution caps DB connection pressure. Promotion path: move to a job queue (BullMQ or Postgres-backed) and return 202 from the PUT with a poll endpoint. Trigger conditions captured as inline TODO in the handler (threshold: active user count > ~10_000).
- **Partial-failure UX.** The PUT returns 200 even when individual users' reconcile threw. An admin who saves and gets a green toast may assume the system is consistent. Mitigated by the secondary audit row and the structured log line. Reasonable enhancement (out of scope) is to add a `partial_failure` flag to the response body and surface it in the toast.
- **Active-user definition drift.** This task hardcodes `status: 'active' AND deletedAt IS NULL AND anonymizedAt IS NULL`. If the team later adds a sixth `UserStatus` value or a soft-archive flag, this query must be updated in lockstep. Mitigated by the audit row's `totalUsers` count, which surfaces in monitoring if the population shifts unexpectedly.
- **Reconcile-signature contract.** This plan locks the signature to TASK-B's declared `reconcileGarageSpots(userId: string, outerTx?: Prisma.TransactionClient)`. TASK-F must be rebased onto TASK-B before Task F2. If TASK-B's signature changes after that rebase, update the call site in `apps/api/src/routes/admin/general-settings.ts` accordingly. The call is a single line, so the blast radius is minimal.
- **Audit-row size.** `failures` capped at 50. If 51+ users fail, the diagnostic is partial. Operators must use the structured log line for the full list.

---

## Open questions

1. **Should partial fanout failures return non-200?** The current plan returns 200 with a secondary audit row. The alternative is 207 (Multi-Status) or 200 with a `partialFailure: true` flag in the response body and a yellow toast in the admin UI. Decision: defer to PR review — easier to widen later than to roll back.
2. **Should the fanout be bounded to a max user count in MVP?** E.g. refuse to save if active user count > 5_000 and force an admin to use a CLI tool. Current plan does not gate. Decision: defer until production user count gets within 2× the documented threshold.
3. **Should the form preserve the typed numeric value when toggling "Ilimitado" off-then-on?** Current plan keeps the last typed value in `state.defaultFreeGarageSpots.value` even when `unlimited=true`, so toggling back restores it. Confirm UX preference with design; behaviour is easy to flip.
4. **Should the reconcile service be invoked inside the same DB transaction as the settings update?** The plan runs the settings update and the fanout as separate database operations. A single Serializable transaction across all users would be atomic but lock-heavy and likely blow connection limits. Status quo: two-phase with the audit row as the consistency marker. Capture for TASK-B reviewer in case a different boundary is preferred.
5. **Is the inline warning on decrease sufficient, or does a confirmation dialog make more sense?** The current plan shows a non-blocking amber label when the admin types a value lower than the persisted one. If the team wants a harder gate (e.g. "Are you sure? X users will lose empty spots."), replace the label with a confirmation dialog before submit. The modal approach requires knowing the current active-user count, which adds a secondary GET. Defer decision to design review; the inline label is the default.

---

## Self-review checklist (run before opening PR)

- [ ] Spec coverage — every bullet in §9 TASK-F maps to one of F1–F5.
- [ ] No `TODO` / `TBD` / `implement later` / "similar to" placeholders in the plan (the inline route `TODO(JDMA)` is documented intentional product debt, not a plan placeholder).
- [ ] `reconcileGarageSpots(userId)` call (no second argument) consistent across handler, tests, and plan prose. Matches TASK-B declared signature.
- [ ] Audit metadata shape consistent between handler code, plan section "AdminAudit entry", and test assertions.
- [ ] `defaultFreeGarageSpots: null` is preserved through GET → Zod parse → form state → form submit → PUT body → Zod parse → DB write — round-trip drawn out in test cases.
- [ ] `pnpm --filter @jdm/shared build` re-run after schema edits (per memory rule "Rebuild @jdm/shared after schema changes").
- [ ] Branch is feature/\* off main, never off production.
- [ ] `apps/api/test/admin/general-settings.test.ts` has zero `vi.mock` calls after edits.
- [ ] `apps/api/test/admin/general-settings-fanout.test.ts` has `reconcileMock.mockClear()` in `beforeEach`.
- [ ] TASK-A rebase confirmed: `grep defaultFreeGarageSpots node_modules/.prisma/client/index.d.ts` returns a match before running Task F2.

---

## Reviewer pushback

### Finding: "reconcile signature — TASK-F calls `(userId, { freeLimit })` while TASK-B takes `(userId, outerTx?)`"

Accepted and corrected. Verified TASK-B's plan at `apps/api/src/services/garage/index.ts` (declared signature line 672: `reconcileGarageSpots(userId: string, outerTx?: Tx)`). The service reads `GeneralSettings.defaultFreeGarageSpots` itself; TASK-F does not need to pass the limit. All occurrences of `reconcileGarageSpots(u.id, { freeLimit: nextFreeLimit })` in handler code and test references have been updated to `reconcileGarageSpots(u.id)`.

### Finding: "em dash in reviewer's suggested PT-BR warning copy"

Reviewer's suggestion contained an em dash ("Reduzir o limite remove vagas vazias de todos os usuários ativos imediatamente"). CLAUDE.md prohibits em dashes. The copy implemented here uses no em dash: "Reduzir o limite remove vagas vazias de todos os usuários ativos imediatamente." (plain period, no dash). Accepted with rephrasing.

### Finding: "open question about prune-empties UX warning should be added"

Accepted. Added as open question 5. The finding is valid: the warning introduced in section 4 is a new behavioral decision that deserves a tracked open question alongside the others.
