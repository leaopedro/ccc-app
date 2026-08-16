# Box Builder — Fase 4b Admin Web (Painel D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an organizer-facing box fulfillment console at `/box/caixas` — cycle selector, fulfillment counters, boxes table with a per-row advance button, and an aggregated picking list.

**Architecture:** New Next.js App Router route under `apps/admin/app/(authed)/box/caixas/`, mirroring the proven store console at `apps/admin/app/(authed)/loja/pedidos/`. Server Component fetches list + picking through the existing `admin-api` client (`apiFetch`, cookie-based bearer auth, organizer scope enforced by the API). A thin client component drives the advance action via a Server Action + `useActionState`/`useFormStatus`. A new sub-nav entry sits beside Catálogo/Parceiros/Configuração.

**Tech Stack:** Next.js 16 (App Router, RSC, Server Actions), React 19, TypeScript, Zod (via `@ccc/shared`), Tailwind CSS v4, Vitest + `react-dom/server` for the nav test.

**Spec:** `docs/superpowers/specs/2026-08-14-box-builder-fase-4b-fulfillment-design.md` (section 3 is this plan's scope; section 2 defines the consumed API/shared contracts).

## Global Constraints

- **All user-facing copy is PT-BR with correct accents** (e.g. `Catálogo`, `Configuração`, `Confirmado`, `Preparado`, `A pagar`, `Nenhuma caixa neste ciclo.`). Match the accented style already used in `authed-nav.tsx` (`Usuários`, `Catálogo`).
- **No refund and no cancel controls** — those belong to Fase 4c. The console is advance-only (forward transitions), plus read-only status/picking display.
- **Forward-only fulfillment.** Box ship map: `unfulfilled -> packed -> shipped -> delivered`. `delivered` and `cancelled` are terminal. No un-advance, no backward buttons.
- **Advance is enabled only for boxes with `status === 'ready'`** and a defined successor status. Any other box status renders no advance button.
- **Consume, do not define, the shared/API contracts.** Shared schemas live in `packages/shared/src/admin-box.ts` and `packages/shared/src/box.ts`; endpoints are built by the API plan on this same branch. This plan only reads them. Exact shapes are quoted per task from spec section 2.
- **Mirror the store console for structure and Tailwind tokens** (`var(--color-border)`, `var(--color-muted)`, `var(--color-accent)`). Do not invent new design tokens.
- **Testing is light, matching the admin app.** `loja/pedidos` ships no page/route unit tests, so pages and the API client here are verified by `typecheck` + `lint`. Only `authed-nav` has a unit test; extend it. Do not invent a page test harness.

**Every task's requirements implicitly include this section.**

---

## Consumed contracts (produced by the API plan on this branch)

These identifiers are imported, not created. Shapes are authoritative (spec section 2); the exact export identifiers are owned by the API/shared plan — if a name differs there, align the import, the shape is the contract.

From `@ccc/shared/box`:

```ts
// boxFulfillmentStatusSchema = z.enum(['unfulfilled','packed','shipped','delivered','cancelled'])
export type BoxFulfillmentStatus = 'unfulfilled' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
// boxStatusSchema = z.enum(['open','awaiting_payment','ready','skipped','cancelled'])
export type BoxStatus = 'open' | 'awaiting_payment' | 'ready' | 'skipped' | 'cancelled';
```

From `@ccc/shared/admin-box` (added by the API plan):

```ts
// boxAdminRowSchema
export type BoxAdminRow = {
  id: string;
  memberName: string;
  memberEmail: string;
  status: BoxStatus;
  chargeCents: number;
  currency: string;
  fulfillmentStatus: BoxFulfillmentStatus;
  orderStatus: string | null; // null when the box is budget-only (no Order)
};

// pickingRowSchema
export type PickingRow = {
  refId: string;
  title: string;
  totalQuantity: number;
  boxCount: number;
};

// adminBoxMonthlyListResponseSchema
export type AdminBoxMonthlyListResponse = {
  cycleKey: string; // resolved cycle (default = latest present)
  availableCycles: string[]; // distinct cycleKeys, desc
  counts: {
    // tally over READY boxes only
    unfulfilled: number;
    packed: number;
    shipped: number;
    delivered: number;
    cancelled: number;
  };
  boxes: BoxAdminRow[]; // ALL boxes of the cycle (open/awaiting/ready/skipped/cancelled)
};

// adminBoxPickingResponseSchema
export type AdminBoxPickingResponse = {
  cycleKey: string;
  items: PickingRow[]; // grouped by catalogItemId (titleSnapshot)
  partnerItems: PickingRow[]; // grouped by partnerModuleId (nameSnapshot)
};

// boxFulfillmentAdvanceSchema — request body for POST advance
export type BoxFulfillmentAdvanceInput = { to: 'packed' | 'shipped' | 'delivered' };
```

Endpoints (spec section 2):

- `GET /admin/box/monthly?cycleKey=<optional>` -> `AdminBoxMonthlyListResponse`
- `GET /admin/box/monthly/picking?cycleKey=<optional>` -> `AdminBoxPickingResponse`
- `POST /admin/box/monthly/:id/fulfillment` body `{ to }` -> `200 { id, fulfillmentStatus }`; `404 box_not_found`; `409 box_not_ready | invalid_transition` (with `code`).

---

## File structure

- Create: `apps/admin/app/(authed)/box/caixas/page.tsx` — Server Component: cycle selector, counters, boxes table, picking section.
- Create: `apps/admin/app/(authed)/box/caixas/status-labels.ts` — PT-BR label/badge maps + forward-transition + advance-label maps.
- Create: `apps/admin/app/(authed)/box/caixas/advance-button.tsx` — client component: per-row advance form.
- Modify: `apps/admin/src/lib/admin-api.ts` — add `listAdminBoxMonthly`, `getAdminBoxPicking`, `advanceAdminBoxFulfillment`.
- Modify: `apps/admin/src/lib/box-admin-actions.ts` — add `advanceBoxFulfillmentAction`.
- Modify: `apps/admin/src/components/authed-nav.tsx` — add `/box/caixas` to `BOX_SUB_LINKS`.
- Modify (test): `apps/admin/src/components/authed-nav.test.tsx` — assert the new sub-nav link.

---

### Task 1: admin-api client — box fulfillment console calls

**Files:**

- Modify: `apps/admin/src/lib/admin-api.ts` (add functions near the existing box helpers around line 951-1021; add imports to the existing `@ccc/shared/admin-box` and `@ccc/shared/box` import groups)
- Test: none (mirrors `listAdminStoreOrders`/`getAdminStoreOrder`, which have no unit test); verified by `typecheck`.

**Interfaces:**

- Consumes: `apiFetch(path, { method?, body?, schema })` from `./api` (already imported at line 162). From `@ccc/shared/admin-box`: `adminBoxMonthlyListResponseSchema`, `adminBoxPickingResponseSchema`, and types `AdminBoxMonthlyListResponse`, `AdminBoxPickingResponse`. From `@ccc/shared/box`: `boxFulfillmentStatusSchema`. Endpoints as listed in "Consumed contracts".
- Produces:
  - `listAdminBoxMonthly(cycleKey?: string): Promise<AdminBoxMonthlyListResponse>`
  - `getAdminBoxPicking(cycleKey?: string): Promise<AdminBoxPickingResponse>`
  - `advanceAdminBoxFulfillment(id: string, to: 'packed' | 'shipped' | 'delivered'): Promise<{ id: string; fulfillmentStatus: BoxFulfillmentStatus }>`

- [ ] **Step 1: Add the shared imports**

In the existing `import { ... } from '@ccc/shared/admin-box';` value-import group, add:

```ts
  adminBoxMonthlyListResponseSchema,
  adminBoxPickingResponseSchema,
```

In the existing `import type { ... } from '@ccc/shared/admin-box';` type-import group, add:

```ts
  type AdminBoxMonthlyListResponse,
  type AdminBoxPickingResponse,
```

Add a new import for the status enum used to shape the advance response (place it beside the other `@ccc/shared` imports):

```ts
import { boxFulfillmentStatusSchema } from '@ccc/shared/box';
import { z } from 'zod';
```

(If `z` is already imported in this file, reuse it — do not duplicate the import.)

- [ ] **Step 2: Add the three functions**

Append after `updateBoxSettings` (end of the box section, ~line 1021):

```ts
// --- Box monthly fulfillment console (Fase 4b) ---

const advanceBoxResultSchema = z.object({
  id: z.string(),
  fulfillmentStatus: boxFulfillmentStatusSchema,
});

export const listAdminBoxMonthly = (cycleKey?: string): Promise<AdminBoxMonthlyListResponse> => {
  const qs = cycleKey ? `?cycleKey=${encodeURIComponent(cycleKey)}` : '';
  return apiFetch(`/admin/box/monthly${qs}`, { schema: adminBoxMonthlyListResponseSchema });
};

export const getAdminBoxPicking = (cycleKey?: string): Promise<AdminBoxPickingResponse> => {
  const qs = cycleKey ? `?cycleKey=${encodeURIComponent(cycleKey)}` : '';
  return apiFetch(`/admin/box/monthly/picking${qs}`, { schema: adminBoxPickingResponseSchema });
};

export const advanceAdminBoxFulfillment = (id: string, to: 'packed' | 'shipped' | 'delivered') =>
  apiFetch(`/admin/box/monthly/${id}/fulfillment`, {
    method: 'POST',
    body: JSON.stringify({ to }),
    schema: advanceBoxResultSchema,
  });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ccc/admin typecheck`
Expected: PASS (no errors). If it fails because `adminBoxMonthlyListResponseSchema` / `adminBoxPickingResponseSchema` are not yet exported by the shared package, that is the API/shared plan's dependency — confirm those exports exist on the branch before proceeding.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/admin-api.ts
git commit -m "feat(admin): box monthly fulfillment api client calls"
```

---

### Task 2: Server Action — advance box fulfillment

**Files:**

- Modify: `apps/admin/src/lib/box-admin-actions.ts` (add a new action + a `CAIXAS_PATH` constant, following the existing `updateOrderFulfillmentAction`/`BoxFormState` conventions)
- Test: none (mirrors `updateOrderFulfillmentAction`, untested); verified by `typecheck`.

**Interfaces:**

- Consumes: `advanceAdminBoxFulfillment(id, to)` from `./admin-api` (Task 1); `ApiError` from `./api`; `revalidatePath` from `next/cache`; existing `BoxFormState = { error: string | null }` (already defined in this file, line 43).
- Produces: `advanceBoxFulfillmentAction(boxId: string, _prev: BoxFormState, fd: FormData): Promise<BoxFormState>` — reads `fd.get('to')`, validates it is one of `packed|shipped|delivered`, calls the API, revalidates `/box/caixas`.

- [ ] **Step 1: Add the import**

Add `advanceAdminBoxFulfillment` to the existing `import { ... } from './admin-api';` group in `box-admin-actions.ts`.

- [ ] **Step 2: Add the action**

Append at the end of the file (after `updateBoxSettingsAction`):

```ts
// --- Monthly fulfillment console (Fase 4b) ---

const CAIXAS_PATH = '/box/caixas';

const ADVANCE_TARGETS = ['packed', 'shipped', 'delivered'] as const;
type AdvanceTarget = (typeof ADVANCE_TARGETS)[number];

const isAdvanceTarget = (v: unknown): v is AdvanceTarget =>
  typeof v === 'string' && (ADVANCE_TARGETS as readonly string[]).includes(v);

export const advanceBoxFulfillmentAction = async (
  boxId: string,
  _prev: BoxFormState,
  fd: FormData,
): Promise<BoxFormState> => {
  const to = fd.get('to');
  if (!isAdvanceTarget(to)) return { error: 'Transição inválida.' };
  try {
    await advanceAdminBoxFulfillment(boxId, to);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === 'box_not_ready') return { error: 'Caixa não está confirmada.' };
      if (e.code === 'invalid_transition')
        return { error: 'Transição inválida para o status atual.' };
      if (e.status === 404) return { error: 'Caixa não encontrada.' };
      return { error: e.message };
    }
    return { error: 'Erro ao avançar fulfillment.' };
  }
  revalidatePath(CAIXAS_PATH);
  return { error: null };
};
```

Note: `ApiError` exposes `code` (see `api.ts` constructor `readonly code: string`), populated from the API error body's `error` field — the API returns `box_not_ready` / `invalid_transition` there per spec section 2.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ccc/admin typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/box-admin-actions.ts
git commit -m "feat(admin): advance box fulfillment server action"
```

---

### Task 3: Status labels and transition maps

**Files:**

- Create: `apps/admin/app/(authed)/box/caixas/status-labels.ts`
- Test: none (mirrors `loja/pedidos/status-labels.ts`, untested); verified by `typecheck`.

**Interfaces:**

- Consumes: `BoxFulfillmentStatus` from `@ccc/shared/box`, `BoxStatus` from `@ccc/shared/box`.
- Produces:
  - `BOX_FULFILLMENT_LABEL: Record<BoxFulfillmentStatus, string>`
  - `BOX_FULFILLMENT_BADGE: Record<BoxFulfillmentStatus, string>`
  - `BOX_STATUS_LABEL: Record<BoxStatus, string>`
  - `NEXT_FULFILLMENT: Record<BoxFulfillmentStatus, 'packed' | 'shipped' | 'delivered' | null>`
  - `ADVANCE_LABEL: Record<'packed' | 'shipped' | 'delivered', string>`
  - `COUNTER_ORDER: BoxFulfillmentStatus[]`

- [ ] **Step 1: Write the file**

```ts
import type { BoxFulfillmentStatus, BoxStatus } from '@ccc/shared/box';

export const BOX_FULFILLMENT_LABEL: Record<BoxFulfillmentStatus, string> = {
  unfulfilled: 'A preparar',
  packed: 'Preparado',
  shipped: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

export const BOX_FULFILLMENT_BADGE: Record<BoxFulfillmentStatus, string> = {
  unfulfilled: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  packed: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  shipped: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  delivered: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  cancelled: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40',
};

export const BOX_STATUS_LABEL: Record<BoxStatus, string> = {
  open: 'Em aberto',
  awaiting_payment: 'Aguardando pagamento',
  ready: 'Confirmada',
  skipped: 'Pulada',
  cancelled: 'Cancelada',
};

// Forward-only ship map. delivered/cancelled are terminal (no successor).
export const NEXT_FULFILLMENT: Record<
  BoxFulfillmentStatus,
  'packed' | 'shipped' | 'delivered' | null
> = {
  unfulfilled: 'packed',
  packed: 'shipped',
  shipped: 'delivered',
  delivered: null,
  cancelled: null,
};

export const ADVANCE_LABEL: Record<'packed' | 'shipped' | 'delivered', string> = {
  packed: 'Marcar preparada',
  shipped: 'Marcar enviada',
  delivered: 'Marcar entregue',
};

// Counter display order (ready-box tally). cancelled shown last, only if > 0.
export const COUNTER_ORDER: BoxFulfillmentStatus[] = [
  'unfulfilled',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
];
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ccc/admin typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/app/(authed)/box/caixas/status-labels.ts"
git commit -m "feat(admin): box fulfillment status labels and transition maps"
```

---

### Task 4: Advance button (client component)

**Files:**

- Create: `apps/admin/app/(authed)/box/caixas/advance-button.tsx`
- Test: none (mirrors `loja/pedidos/[id]/fulfillment-form.tsx`, untested); verified by `typecheck`.

**Interfaces:**

- Consumes: `advanceBoxFulfillmentAction` + `BoxFormState` from `~/lib/box-admin-actions` (Task 2); `ADVANCE_LABEL` from `./status-labels` (Task 3); React `useActionState`, `react-dom` `useFormStatus`.
- Produces: `AdvanceButton({ boxId, to }: { boxId: string; to: 'packed' | 'shipped' | 'delivered' })` — a per-row form that submits `to` and calls the action bound to `boxId`. Renders the inline error from `BoxFormState` when present.

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { ADVANCE_LABEL } from './status-labels';

import { advanceBoxFulfillmentAction, type BoxFormState } from '~/lib/box-admin-actions';

const initial: BoxFormState = { error: null };

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-[color:var(--color-border)] px-2 py-1 text-xs hover:bg-[color:var(--color-border)] disabled:opacity-50"
    >
      {pending ? 'Salvando…' : label}
    </button>
  );
};

export const AdvanceButton = ({
  boxId,
  to,
}: {
  boxId: string;
  to: 'packed' | 'shipped' | 'delivered';
}) => {
  const action = advanceBoxFulfillmentAction.bind(null, boxId);
  const [state, dispatch] = useActionState(action, initial);
  return (
    <form action={dispatch} className="flex flex-col items-end gap-1">
      <input type="hidden" name="to" value={to} />
      <Submit label={ADVANCE_LABEL[to]} />
      {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
    </form>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ccc/admin typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/app/(authed)/box/caixas/advance-button.tsx"
git commit -m "feat(admin): per-row box fulfillment advance button"
```

---

### Task 5: Caixas page (Server Component)

**Files:**

- Create: `apps/admin/app/(authed)/box/caixas/page.tsx`
- Test: none (mirrors `loja/pedidos/page.tsx`, untested); verified by `typecheck` + `lint`.

**Interfaces:**

- Consumes: `listAdminBoxMonthly`, `getAdminBoxPicking` from `~/lib/admin-api` (Task 1); `BOX_FULFILLMENT_LABEL`, `BOX_FULFILLMENT_BADGE`, `BOX_STATUS_LABEL`, `NEXT_FULFILLMENT`, `COUNTER_ORDER` from `./status-labels` (Task 3); `AdvanceButton` from `./advance-button` (Task 4). Route reads `searchParams: Promise<{ cycleKey?: string }>` (Next.js 16 async searchParams, as in `loja/pedidos/page.tsx`).
- Produces: default-exported async page component at path `/box/caixas`.

- [ ] **Step 1: Write the page**

```tsx
import Link from 'next/link';

import { AdvanceButton } from './advance-button';
import {
  BOX_FULFILLMENT_BADGE,
  BOX_FULFILLMENT_LABEL,
  BOX_STATUS_LABEL,
  COUNTER_ORDER,
  NEXT_FULFILLMENT,
} from './status-labels';

import { getAdminBoxPicking, listAdminBoxMonthly } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const formatBRL = (cents: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

export default async function CaixasPage({
  searchParams,
}: {
  searchParams: Promise<{ cycleKey?: string }>;
}) {
  const params = await searchParams;
  const requested =
    typeof params.cycleKey === 'string' && params.cycleKey.trim() !== ''
      ? params.cycleKey.trim()
      : undefined;

  const { cycleKey, availableCycles, counts, boxes } = await listAdminBoxMonthly(requested);
  const picking = await getAdminBoxPicking(cycleKey);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Caixas do mês</h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            Avance o fulfillment das caixas confirmadas e monte a lista de separação.
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm" action="/box/caixas">
          <label className="text-[color:var(--color-muted)]" htmlFor="cycleKey">
            Ciclo
          </label>
          <select
            id="cycleKey"
            name="cycleKey"
            defaultValue={cycleKey}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-1.5"
          >
            {availableCycles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded border border-[color:var(--color-border)] px-3 py-1.5"
          >
            Ver
          </button>
        </form>
      </header>

      <section aria-label="Contadores de fulfillment" className="flex flex-wrap gap-2 text-sm">
        {COUNTER_ORDER.filter((s) => s !== 'cancelled' || counts[s] > 0).map((s) => (
          <span
            key={s}
            className={`inline-flex items-center gap-2 rounded border px-3 py-1 ${BOX_FULFILLMENT_BADGE[s]}`}
          >
            {BOX_FULFILLMENT_LABEL[s]}
            <strong>{counts[s]}</strong>
          </span>
        ))}
      </section>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
            <th className="py-2">Membro</th>
            <th>Status</th>
            <th className="text-right">A pagar</th>
            <th>Fulfillment</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {boxes.map((row) => {
            const badge = BOX_FULFILLMENT_BADGE[row.fulfillmentStatus];
            const next = row.status === 'ready' ? NEXT_FULFILLMENT[row.fulfillmentStatus] : null;
            return (
              <tr key={row.id} className="border-b border-[color:var(--color-border)] align-top">
                <td className="py-2">
                  <div>{row.memberName}</div>
                  <div className="text-xs text-[color:var(--color-muted)]">{row.memberEmail}</div>
                </td>
                <td className="text-xs">{BOX_STATUS_LABEL[row.status]}</td>
                <td className="text-right">{formatBRL(row.chargeCents, row.currency)}</td>
                <td>
                  <span className={`inline-block rounded border px-2 py-0.5 text-xs ${badge}`}>
                    {BOX_FULFILLMENT_LABEL[row.fulfillmentStatus]}
                  </span>
                </td>
                <td className="text-right">
                  {next ? <AdvanceButton boxId={row.id} to={next} /> : null}
                </td>
              </tr>
            );
          })}
          {boxes.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-[color:var(--color-muted)]">
                Nenhuma caixa neste ciclo.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <section aria-label="Lista de separação" className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase text-[color:var(--color-muted)]">
          Lista de separação
        </h2>
        <p className="text-xs text-[color:var(--color-muted)]">
          Demanda física total das caixas confirmadas deste ciclo.
        </p>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-[color:var(--color-muted)]">
              Itens do catálogo
            </h3>
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
                  <th className="py-2">Item</th>
                  <th className="text-right">Qtd</th>
                  <th className="text-right">Caixas</th>
                </tr>
              </thead>
              <tbody>
                {picking.items.map((it) => (
                  <tr key={it.refId} className="border-b border-[color:var(--color-border)]">
                    <td className="py-2">{it.title}</td>
                    <td className="text-right">{it.totalQuantity}</td>
                    <td className="text-right">{it.boxCount}</td>
                  </tr>
                ))}
                {picking.items.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-[color:var(--color-muted)]">
                      Sem itens.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-[color:var(--color-muted)]">
              Módulos de parceiros
            </h3>
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
                  <th className="py-2">Módulo</th>
                  <th className="text-right">Qtd</th>
                  <th className="text-right">Caixas</th>
                </tr>
              </thead>
              <tbody>
                {picking.partnerItems.map((it) => (
                  <tr key={it.refId} className="border-b border-[color:var(--color-border)]">
                    <td className="py-2">{it.title}</td>
                    <td className="text-right">{it.totalQuantity}</td>
                    <td className="text-right">{it.boxCount}</td>
                  </tr>
                ))}
                {picking.partnerItems.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-[color:var(--color-muted)]">
                      Sem módulos.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="text-xs">
        <Link href="/box/catalogo" className="text-[color:var(--color-muted)] hover:underline">
          ← Voltar ao catálogo
        </Link>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ccc/admin typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm --filter @ccc/admin lint`
Expected: PASS (no errors on the new files).

- [ ] **Step 4: Commit**

```bash
git add "apps/admin/app/(authed)/box/caixas/page.tsx"
git commit -m "feat(admin): box monthly fulfillment console page"
```

---

### Task 6: Sub-nav entry (TDD — nav is the one unit-tested piece)

**Files:**

- Modify: `apps/admin/src/components/authed-nav.tsx:31-35` (`BOX_SUB_LINKS`)
- Test: `apps/admin/src/components/authed-nav.test.tsx` (existing "box sub-nav" describe block, ~line 145)

**Interfaces:**

- Consumes: existing `BOX_SUB_LINKS` array and the sub-nav rendering already present in `authed-nav.tsx` (renders one `<Link>` per entry when `pathname.startsWith('/box')`).
- Produces: a new `{ href: '/box/caixas', label: 'Caixas' }` entry in `BOX_SUB_LINKS`, rendered in both the desktop sub-nav and the mobile dropdown.

- [ ] **Step 1: Add the failing assertion**

In `authed-nav.test.tsx`, inside the existing test `it('exposes catalogo, parceiros and config when on a /box path', ...)` (~line 146), add an assertion for the new link:

```tsx
expect(html).toContain('href="/box/caixas"');
expect(html).toContain('Caixas');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ccc/admin test -- authed-nav`
Expected: FAIL — the rendered markup does not contain `href="/box/caixas"`.

- [ ] **Step 3: Add the nav entry**

In `authed-nav.tsx`, add the caixas link to `BOX_SUB_LINKS`:

```tsx
const BOX_SUB_LINKS = [
  { href: '/box/catalogo', label: 'Catálogo' },
  { href: '/box/parceiros', label: 'Parceiros' },
  { href: '/box/caixas', label: 'Caixas' },
  { href: '/box/config', label: 'Configuração' },
] as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ccc/admin test -- authed-nav`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/authed-nav.tsx apps/admin/src/components/authed-nav.test.tsx
git commit -m "feat(admin): add Caixas entry to box sub-nav"
```

---

## Final verification

- [ ] `pnpm --filter @ccc/admin typecheck` — PASS
- [ ] `pnpm --filter @ccc/admin lint` — PASS
- [ ] `pnpm --filter @ccc/admin test` — PASS (nav test green, others unaffected)

---

## Self-review

**1. Spec coverage (section 3):**

- "Nova página `apps/admin/app/(authed)/box/caixas/`" → Task 5 (page.tsx), supported by Tasks 3-4.
- "seletor de ciclo" → Task 5, GET form with `<select name="cycleKey">` over `availableCycles`, default `cycleKey`.
- "contadores por status de fulfillment" → Task 5, counters section driven by `counts` + `COUNTER_ORDER` (Task 3).
- "tabela de caixas (membro, status, a pagar, fulfillment)" → Task 5, table columns Membro / Status / A pagar / Fulfillment.
- "com botão de avanço por linha" → Task 4 (`AdvanceButton`) wired per row in Task 5; shown only for `status === 'ready'` with a successor (`NEXT_FULFILLMENT`).
- "seção de picking list agregada" → Task 5, two tables from `picking.items` and `picking.partnerItems`.
- "Nova entrada de nav sob Box (junto de Catálogo/Parceiros/Config)" → Task 6.
- "Consome os endpoints da seção 2" → Task 1 (client) + Task 2 (advance action).
- "Sem refund/cancel" → honored: no refund/cancel controls anywhere; Global Constraints states it.

**2. Placeholder scan:** No TBD/TODO. Every code step contains full source. Error handling in the action is concrete (maps `box_not_ready` / `invalid_transition` / 404). No "similar to Task N" references — the advance-button and page repeat their full code.

**3. Type consistency:** `BoxAdminRow` fields (`id`, `memberName`, `memberEmail`, `status`, `chargeCents`, `currency`, `fulfillmentStatus`, `orderStatus`) are used exactly in Task 5. `NEXT_FULFILLMENT`, `ADVANCE_LABEL`, `BOX_FULFILLMENT_LABEL/BADGE`, `BOX_STATUS_LABEL`, `COUNTER_ORDER` names match between Task 3 (definition) and Tasks 4-5 (use). Advance target union `'packed' | 'shipped' | 'delivered'` is identical across Tasks 1, 2, 4, 5. `advanceBoxFulfillmentAction(boxId, _prev, fd)` signature matches its `.bind(null, boxId)` use in Task 4.

**Resolved ambiguities:**

- The spec does not fix admin-facing PT-BR copy for box fulfillment labels (only the mobile timeline copy Preparando/Enviado/Entregue). Chose console labels A preparar / Preparado / Enviado / Entregue / Cancelado, matching the store console's label style while keeping box gender agreement ("Confirmada", "Marcar preparada").
- The exact shared export identifiers (`adminBoxMonthlyListResponseSchema`, `adminBoxPickingResponseSchema`, `BoxAdminRow`, `PickingRow`) are owned by the API/shared plan; this plan consumes them by the names above and flags that the executor aligns the import if the shared plan named them differently. Shapes are taken verbatim from spec section 2.
- The advance response schema is shaped locally in the API client (`{ id, fulfillmentStatus }` via `boxFulfillmentStatusSchema`) rather than assuming a dedicated shared export, minimizing cross-plan name coupling.
- Cycle selector implemented as a no-JS GET form (mirrors the store console's search form) instead of a client component, since RSC cannot use `onChange`.
