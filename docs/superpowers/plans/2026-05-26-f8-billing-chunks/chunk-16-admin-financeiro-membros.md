# Chunk 16 — Admin `/financeiro/membros` page + `GarageMembershipHistory` component

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/financeiro/membros` admin page (paginated membership table with filters + empty state + row navigation) and the `GarageMembershipHistory` embedded component for the user-garage detail page.

**Architecture:** Server component `page.tsx` fetches `/admin/finance/memberships` with URL-driven query params; renders a table via a new `MembrosTable` client component. Filters reuse the chip/select pattern from `filter-bar.tsx`. `GarageMembershipHistory` is a server component that calls the same endpoint filtered by `garageId`; it is embedded on `apps/admin/app/(authed)/users/[id]/page.tsx` below `GarageBadgesPanel`. Both rely on `adminFinanceMembershipsQuerySchema` + `adminFinanceMembershipsResponseSchema` that land in F8.14. The page depends only on the API endpoint (F8.14) and the shared schemas (F8.14); it does NOT gate on the feature flag — the admin pages are internal surfaces.

**Tech Stack:** Next.js App Router (server + client components), `@ccc/shared/admin` zod schemas (`adminFinanceMembershipsQuerySchema`, `adminFinanceMembershipsResponseSchema`), existing `apiFetch` helper in `apps/admin/src/lib/api.ts`, Vitest + RTL (`renderToStaticMarkup` for server-component-style assertions), branch `feat/jdma-f8-billing-16`.

---

## Dependency

This chunk depends on **F8.14** for:

- `GET /admin/finance/memberships` endpoint (API).
- `adminFinanceMembershipsQuerySchema` and `adminFinanceMembershipsResponseSchema` from `@ccc/shared/admin`.
- The `AdminFinanceMembershipsItem` type (single row shape).

Do NOT start implementation until F8.14 is merged to `main`. Verify with:

```bash
grep -n "adminFinanceMembershipsQuerySchema\|adminFinanceMembershipsResponseSchema" \
  packages/shared/src/admin.ts
```

Expected: both symbols present. If missing, STOP.

---

## Pre-flight checklist (before Task 1)

- [ ] **PF-1: Branch safety** — `git branch --show-current` must NOT be `production`. If it is, stop.

- [ ] **PF-2: Confirm F8.14 merged**

```bash
grep -n "adminFinanceMembershipsQuerySchema\|adminFinanceMembershipsResponseSchema\|AdminFinanceMembershipsItem" \
  packages/shared/src/admin.ts
```

Expected: all three names are present. If any is absent, STOP and unblock F8.14 first.

- [ ] **PF-3: Verify API endpoint exists**

```bash
grep -rn "finance/memberships" apps/api/src/routes/admin/finance.ts
```

Expected: a Fastify `get('/finance/memberships', ...)` handler. If missing, STOP.

- [ ] **PF-4: Create branch from fresh `main`**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-16
```

---

## Files touched

| Path                                                                     | Action | Responsibility                                                                                                                  |
| ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/src/lib/finance-actions.ts`                                  | Modify | Add `fetchFinanceMemberships(q?)` server action calling `getFinanceMemberships`.                                                |
| `apps/admin/src/lib/admin-api.ts`                                        | Modify | Add `getFinanceMemberships(q?)` function using `apiFetch` + `adminFinanceMembershipsResponseSchema`.                            |
| `apps/admin/app/(authed)/financeiro/membros/page.tsx`                    | Create | Server component; reads URL search params; calls `fetchFinanceMemberships`; renders title + `MembrosTable`.                     |
| `apps/admin/app/(authed)/financeiro/membros/membros-table.tsx`           | Create | Client component: filter chips (cadence/tier/status), paginated table, empty state, row click navigation.                       |
| `apps/admin/app/(authed)/financeiro/membros/__tests__/page.test.tsx`     | Create | RTL/SSR tests: pagination, each filter, empty state, row click navigation.                                                      |
| `apps/admin/src/components/garage-membership-history.tsx`                | Create | Server component: fetches membership list filtered by `garageId`; renders invoice list + current status badge + provider label. |
| `apps/admin/src/components/__tests__/garage-membership-history.test.tsx` | Create | RTL tests: invoice list render, status badge, provider label, empty state.                                                      |
| `apps/admin/app/(authed)/users/[id]/page.tsx`                            | Modify | Import + embed `GarageMembershipHistory` below `GarageBadgesPanel`.                                                             |

---

## Types reference (from F8.14 — do not re-derive)

The plan uses these types as defined by F8.14. Copy the names exactly.

```ts
// From packages/shared/src/admin.ts (F8.14)

export const adminFinanceMembershipsQuerySchema = z.object({
  status: z.enum(['active', 'past_due', 'cancel_scheduled', 'expired']).optional(),
  cadence: z.enum(['monthly', 'annual']).optional(),
  tier: z.string().optional(), // 'gold' v1
  provider: z.enum(['stripe', 'apple_revenuecat']).optional(),
  from: z.string().optional(), // ISO date, filters currentPeriodEnd >=
  to: z.string().optional(), // ISO date, filters currentPeriodEnd <=
  search: z.string().optional(), // user name/email substring
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminFinanceMembershipsQuery = z.infer<typeof adminFinanceMembershipsQuerySchema>;

export const adminFinanceMembershipsItemSchema = z.object({
  membershipId: z.string(),
  garageId: z.string(),
  garageSlug: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  userId: z.string(),
  tier: z.string(), // 'gold'
  cadence: z.enum(['monthly', 'annual']),
  status: z.enum(['active', 'past_due', 'cancel_scheduled', 'expired', 'trialing', 'paused']),
  currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  totalPaidCents: z.number().int(),
  invoiceCount: z.number().int(),
  provider: z.enum(['stripe', 'apple_revenuecat']),
  providerSubRef: z.string(),
});
export type AdminFinanceMembershipsItem = z.infer<typeof adminFinanceMembershipsItemSchema>;

export const adminFinanceMembershipsResponseSchema = z.object({
  items: z.array(adminFinanceMembershipsItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type AdminFinanceMembershipsResponse = z.infer<typeof adminFinanceMembershipsResponseSchema>;
```

If the actual F8.14 schema names or field names differ, use the F8.14 names, not the ones above.

---

## Label maps (PT-BR — use verbatim in code and tests)

```ts
const statusLabel: Record<string, string> = {
  active: 'Ativo',
  past_due: 'Inadimplente',
  cancel_scheduled: 'Cancelamento agendado',
  expired: 'Expirado',
  trialing: 'Em teste',
  paused: 'Pausado',
};

const statusColor: Record<string, string> = {
  active: 'bg-emerald-900 text-emerald-300',
  past_due: 'bg-red-900 text-red-300',
  cancel_scheduled: 'bg-yellow-900 text-yellow-300',
  expired: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
  trialing: 'bg-blue-900 text-blue-300',
  paused: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
};

const cadenceLabel: Record<string, string> = {
  monthly: 'Mensal',
  annual: 'Anual',
};

const tierLabel: Record<string, string> = {
  gold: 'Gold',
};

const providerLabel: Record<string, string> = {
  stripe: 'Stripe',
  apple_revenuecat: 'Apple / RC',
};
```

---

## Helper functions (PT-BR formatting — use verbatim)

```ts
// Format date as "dd/mm/aaaa" in pt-BR
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

// Format BRL cents as "R$ X.XXX,XX"
function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
```

---

## Code shape (final state — reference, not copy-paste)

### `apps/admin/src/lib/admin-api.ts` (modify)

Add after the existing finance functions (after `getFinancePaymentMix`):

```ts
import {
  // ... existing imports ...
  adminFinanceMembershipsResponseSchema,
  type AdminFinanceMembershipsQuery,
  type AdminFinanceMembershipsResponse,
} from '@ccc/shared/admin';

export const getFinanceMemberships = (q?: AdminFinanceMembershipsQuery) => {
  const params = new URLSearchParams();
  if (q?.status) params.set('status', q.status);
  if (q?.cadence) params.set('cadence', q.cadence);
  if (q?.tier) params.set('tier', q.tier);
  if (q?.provider) params.set('provider', q.provider);
  if (q?.from) params.set('from', q.from);
  if (q?.to) params.set('to', q.to);
  if (q?.search) params.set('search', q.search);
  if (q?.page) params.set('page', String(q.page));
  if (q?.pageSize) params.set('pageSize', String(q.pageSize));
  const qs = params.toString();
  return apiFetch(`/admin/finance/memberships${qs ? `?${qs}` : ''}`, {
    schema: adminFinanceMembershipsResponseSchema,
  });
};
```

### `apps/admin/src/lib/finance-actions.ts` (modify)

Add at the bottom (keep existing exports untouched):

```ts
import { getFinanceMemberships } from './admin-api';
import type {
  AdminFinanceMembershipsQuery,
  AdminFinanceMembershipsResponse,
} from '@ccc/shared/admin';

export async function fetchFinanceMemberships(
  q?: AdminFinanceMembershipsQuery,
): Promise<AdminFinanceMembershipsResponse> {
  return getFinanceMemberships(q);
}
```

### `apps/admin/app/(authed)/financeiro/membros/page.tsx` (create)

```tsx
import { fetchFinanceMemberships } from '~/lib/finance-actions';
import { MembrosTable } from './membros-table';

export const dynamic = 'force-dynamic';

export default async function FinanceiroMembrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const getStr = (key: string) => {
    const v = sp[key];
    return typeof v === 'string' ? v : undefined;
  };

  const page = Number(getStr('page') ?? '1');
  const pageSize = 25;

  const query = {
    status: getStr('status') as 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | undefined,
    cadence: getStr('cadence') as 'monthly' | 'annual' | undefined,
    tier: getStr('tier'),
    provider: getStr('provider') as 'stripe' | 'apple_revenuecat' | undefined,
    from: getStr('from'),
    to: getStr('to'),
    search: getStr('search'),
    page,
    pageSize,
  };

  const data = await fetchFinanceMemberships(query);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Membros premium</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Lista de membros com assinatura Premium Gold.
        </p>
      </header>
      <MembrosTable
        items={data.items}
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        activeFilters={{
          status: getStr('status') ?? null,
          cadence: getStr('cadence') ?? null,
          tier: getStr('tier') ?? null,
          provider: getStr('provider') ?? null,
        }}
      />
    </section>
  );
}
```

### `apps/admin/app/(authed)/financeiro/membros/membros-table.tsx` (create)

```tsx
'use client';

import type { AdminFinanceMembershipsItem } from '@ccc/shared/admin';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const statusLabel: Record<string, string> = {
  active: 'Ativo',
  past_due: 'Inadimplente',
  cancel_scheduled: 'Cancelamento agendado',
  expired: 'Expirado',
  trialing: 'Em teste',
  paused: 'Pausado',
};

const statusColor: Record<string, string> = {
  active: 'bg-emerald-900 text-emerald-300',
  past_due: 'bg-red-900 text-red-300',
  cancel_scheduled: 'bg-yellow-900 text-yellow-300',
  expired: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
  trialing: 'bg-blue-900 text-blue-300',
  paused: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
};

const cadenceLabel: Record<string, string> = {
  monthly: 'Mensal',
  annual: 'Anual',
};

const tierLabel: Record<string, string> = {
  gold: 'Gold',
};

const providerLabel: Record<string, string> = {
  stripe: 'Stripe',
  apple_revenuecat: 'Apple / RC',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

type ActiveFilters = {
  status: string | null;
  cadence: string | null;
  tier: string | null;
  provider: string | null;
};

type Props = {
  items: AdminFinanceMembershipsItem[];
  page: number;
  pageSize: number;
  total: number;
  activeFilters: ActiveFilters;
};

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]'
          : 'border-[color:var(--color-border)] text-[color:var(--color-muted)] hover:border-[color:var(--color-muted)]'
      }`}
    >
      {label}
    </button>
  );
}

export function MembrosTable({ items, page, pageSize, total, activeFilters }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const updateFilter = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // Reset page on filter change
    params.delete('page');
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  const goToPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(p));
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  const statusOptions = ['active', 'past_due', 'cancel_scheduled', 'expired'];
  const cadenceOptions = ['monthly', 'annual'];
  const providerOptions = ['stripe', 'apple_revenuecat'];

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
        {/* Status chips */}
        {statusOptions.map((s) => (
          <Chip
            key={s}
            label={statusLabel[s] ?? s}
            active={activeFilters.status === s}
            onClick={() => updateFilter('status', activeFilters.status === s ? null : s)}
          />
        ))}

        <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />

        {/* Cadence chips */}
        {cadenceOptions.map((c) => (
          <Chip
            key={c}
            label={cadenceLabel[c] ?? c}
            active={activeFilters.cadence === c}
            onClick={() => updateFilter('cadence', activeFilters.cadence === c ? null : c)}
          />
        ))}

        <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />

        {/* Provider chips */}
        {providerOptions.map((p) => (
          <Chip
            key={p}
            label={providerLabel[p] ?? p}
            active={activeFilters.provider === p}
            onClick={() => updateFilter('provider', activeFilters.provider === p ? null : p)}
          />
        ))}

        {Object.values(activeFilters).some(Boolean) ? (
          <>
            <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                ['status', 'cadence', 'tier', 'provider', 'page'].forEach((k) => params.delete(k));
                startTransition(() => router.replace(`${pathname}?${params.toString()}`));
              }}
              className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
            >
              Limpar filtros
            </button>
          </>
        ) : null}
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div
          className="flex min-h-[20vh] items-center justify-center rounded border border-[color:var(--color-border)]"
          data-testid="membros-empty-state"
        >
          <p className="text-sm text-[color:var(--color-muted)]">Nenhum membro encontrado.</p>
        </div>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
              <th className="py-2 pr-3">Usuário</th>
              <th className="pr-3">Plano</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">Próxima renovação</th>
              <th className="pr-3">Cancelado</th>
              <th className="pr-3">Total pago</th>
              <th className="pr-3">Faturas</th>
              <th className="pr-3">Provedor</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.membershipId}
                className="border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-border)]/30"
                data-testid={`membros-row-${item.membershipId}`}
              >
                <td className="py-2 pr-3">
                  <Link
                    href={`/users/${item.userId}`}
                    className="font-medium hover:underline"
                    data-testid={`membros-row-link-${item.membershipId}`}
                  >
                    {item.userName}
                  </Link>
                  <div className="text-xs text-[color:var(--color-muted)]">{item.userEmail}</div>
                </td>
                <td className="pr-3">
                  {tierLabel[item.tier] ?? item.tier} / {cadenceLabel[item.cadence] ?? item.cadence}
                </td>
                <td className="pr-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor[item.status] ?? ''}`}
                    data-testid={`membros-status-${item.membershipId}`}
                  >
                    {statusLabel[item.status] ?? item.status}
                  </span>
                </td>
                <td className="pr-3">{fmtDate(item.currentPeriodEnd)}</td>
                <td className="pr-3">{item.cancelAtPeriodEnd ? 'Sim' : 'Não'}</td>
                <td className="pr-3">{fmtBRL(item.totalPaidCents)}</td>
                <td className="pr-3">{item.invoiceCount}</td>
                <td className="pr-3">{providerLabel[item.provider] ?? item.provider}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="rounded border border-[color:var(--color-border)] px-3 py-1 disabled:opacity-40"
            data-testid="membros-prev"
          >
            Anterior
          </button>
          <span
            className="text-xs text-[color:var(--color-muted)]"
            data-testid="membros-page-indicator"
          >
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => goToPage(page + 1)}
            className="rounded border border-[color:var(--color-border)] px-3 py-1 disabled:opacity-40"
            data-testid="membros-next"
          >
            Próxima
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

### `apps/admin/src/components/garage-membership-history.tsx` (create)

```tsx
import type { AdminFinanceMembershipsItem } from '@ccc/shared/admin';
import Link from 'next/link';

import { fetchFinanceMemberships } from '~/lib/finance-actions';

const statusLabel: Record<string, string> = {
  active: 'Ativo',
  past_due: 'Inadimplente',
  cancel_scheduled: 'Cancelamento agendado',
  expired: 'Expirado',
  trialing: 'Em teste',
  paused: 'Pausado',
};

const statusColor: Record<string, string> = {
  active: 'bg-emerald-900 text-emerald-300',
  past_due: 'bg-red-900 text-red-300',
  cancel_scheduled: 'bg-yellow-900 text-yellow-300',
  expired: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
  trialing: 'bg-blue-900 text-blue-300',
  paused: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
};

const providerLabel: Record<string, string> = {
  stripe: 'Stripe',
  apple_revenuecat: 'Apple / RC',
};

const cadenceLabel: Record<string, string> = {
  monthly: 'Mensal',
  annual: 'Anual',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

interface Props {
  garageId: string;
}

export async function GarageMembershipHistory({ garageId }: Props) {
  let data: { items: AdminFinanceMembershipsItem[]; total: number } = { items: [], total: 0 };

  try {
    // Filter by garageId — passed via `search` param until F8.14 exposes a dedicated garageId filter.
    // If F8.14 adds garageId as a first-class filter key, switch to that.
    const res = await fetchFinanceMemberships({ page: 1, pageSize: 50 });
    const filtered = res.items.filter((m) => m.garageId === garageId);
    data = { items: filtered, total: filtered.length };
  } catch {
    // Non-fatal: section falls back to empty state.
  }

  // Sort: live rows first (active/past_due/cancel_scheduled), then expired, oldest-first within each group
  const liveStatuses = new Set(['active', 'past_due', 'cancel_scheduled']);
  const sorted = [...data.items].sort((a, b) => {
    const aLive = liveStatuses.has(a.status) ? 0 : 1;
    const bLive = liveStatuses.has(b.status) ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return a.currentPeriodEnd.localeCompare(b.currentPeriodEnd);
  });

  return (
    <div data-testid="garage-membership-history">
      <h2 className="mb-2 text-lg font-semibold">Histórico de Assinaturas Premium</h2>

      {sorted.length === 0 ? (
        <p
          className="text-sm text-[color:var(--color-muted)]"
          data-testid="garage-membership-empty"
        >
          Sem assinaturas registradas.
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-4">
          {sorted.map((m) => (
            <div
              key={m.membershipId}
              className="flex flex-col gap-1 rounded border border-[color:var(--color-border)] bg-surface-alt p-3"
              data-testid={`membership-row-${m.membershipId}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor[m.status] ?? ''}`}
                    data-testid={`membership-status-badge-${m.membershipId}`}
                  >
                    {statusLabel[m.status] ?? m.status}
                  </span>
                  <span className="text-xs font-medium">
                    Gold / {cadenceLabel[m.cadence] ?? m.cadence}
                  </span>
                </div>
                <span
                  className="text-xs text-[color:var(--color-muted)]"
                  data-testid={`membership-provider-${m.membershipId}`}
                >
                  {providerLabel[m.provider] ?? m.provider}
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-[color:var(--color-muted)]">
                <span>Renovação: {fmtDate(m.currentPeriodEnd)}</span>
                <span>Total pago: {fmtBRL(m.totalPaidCents)}</span>
                <span>
                  {m.invoiceCount} {m.invoiceCount === 1 ? 'fatura' : 'faturas'}
                </span>
                {m.cancelAtPeriodEnd ? (
                  <span className="text-yellow-400">Cancelamento agendado</span>
                ) : null}
              </div>
              <Link
                href={`/financeiro/membros?search=${encodeURIComponent(m.userEmail)}`}
                className="mt-1 text-xs text-[color:var(--color-accent)] hover:underline"
                data-testid={`membership-finance-link-${m.membershipId}`}
              >
                Ver no financeiro
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### `apps/admin/app/(authed)/users/[id]/page.tsx` (modify)

Add the import after the `GarageBadgesPanel` import:

```tsx
import { GarageMembershipHistory } from '~/components/garage-membership-history';
```

Add the section after the `GarageBadgesPanel` JSX, before the Group memberships section. Read the current `adminGarage.garage.id` — it is already fetched above (`getAdminUserGarage`). Pass it through:

```tsx
{
  /* Membership history (F8.16) */
}
<GarageMembershipHistory garageId={adminGarage.garage.id} />;
```

Note: `adminGarage` is already in scope from the existing `getAdminUserGarage(user.id)` call inside the try block above line 88. If the fetch failed (caught), `adminGarage` will be undefined — guard with a conditional:

```tsx
{
  adminGarage ? <GarageMembershipHistory garageId={adminGarage.garage.id} /> : null;
}
```

To implement this cleanly, hoist `adminGarage` to the outer scope (currently declared inside the try block). The final shape:

```tsx
// Before the try block — hoist declaration
let adminGarage: Awaited<ReturnType<typeof getAdminUserGarage>> | undefined;

// Inside the try block — assignment instead of let+assignment
adminGarage = await getAdminUserGarage(user.id); // already fetchable in parallel
```

This change requires reading the current file carefully before editing — the existing parallel `Promise.all` assigns `catalog` and `adminGarage` inside one try. Hoist `adminGarage` declaration only; keep the assignment inside the try so failures remain non-fatal.

---

## Test plan

### `apps/admin/app/(authed)/financeiro/membros/__tests__/page.test.tsx` (new — 9 specs)

Uses `renderToStaticMarkup` for server component assertions + RTL `render` for client component interactions.

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock next/navigation for client component
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/financeiro/membros',
  useSearchParams: () => new URLSearchParams(),
}));

import { MembrosTable } from '../membros-table';
import type { AdminFinanceMembershipsItem } from '@ccc/shared/admin';

const baseItem: AdminFinanceMembershipsItem = {
  membershipId: 'mem-1',
  garageId: 'garage-1',
  garageSlug: 'garage-slug-1',
  userName: 'Fulano da Silva',
  userEmail: 'fulano@test.com',
  userId: 'user-1',
  tier: 'gold',
  cadence: 'monthly',
  status: 'active',
  currentPeriodEnd: '2026-07-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  totalPaidCents: 9900,
  invoiceCount: 3,
  provider: 'stripe',
  providerSubRef: 'sub_123',
};
```

| #   | Test name                                                       | Intent                  | Key assertion                                                                                        |
| --- | --------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `renders table rows for each item`                              | Happy path table render | `data-testid="membros-row-mem-1"` present                                                            |
| 2   | `renders user name and email in first column`                   | Column content          | `Fulano da Silva` + `fulano@test.com`                                                                |
| 3   | `renders PT-BR status badge "Ativo" for active status`          | Status label + PT-BR    | `data-testid="membros-status-mem-1"` text = `Ativo`                                                  |
| 4   | `renders "Inadimplente" for past_due status`                    | Status label variant    | Badge text = `Inadimplente`                                                                          |
| 5   | `renders empty state when items is empty array`                 | Empty state             | `data-testid="membros-empty-state"` present; "Nenhum membro encontrado."                             |
| 6   | `renders pagination controls when totalPages > 1`               | Pagination visible      | `data-testid="membros-prev"` + `data-testid="membros-next"` + `data-testid="membros-page-indicator"` |
| 7   | `page indicator shows "Página 2 de 4"`                          | Pagination text         | Correct page/total display                                                                           |
| 8   | `row link navigates to /users/:userId`                          | Row click navigation    | `href="/users/user-1"`                                                                               |
| 9   | `clicking a status chip calls router.replace with status param` | Filter interaction      | `router.replace` called with `?status=active`                                                        |

Full test code:

```tsx
describe('MembrosTable', () => {
  it('renders table rows for each item', () => {
    render(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={{ status: null, cadence: null, tier: null, provider: null }}
      />,
    );
    expect(screen.getByTestId('membros-row-mem-1')).toBeDefined();
  });

  it('renders user name and email in first column', () => {
    render(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={{ status: null, cadence: null, tier: null, provider: null }}
      />,
    );
    expect(screen.getByText('Fulano da Silva')).toBeDefined();
    expect(screen.getByText('fulano@test.com')).toBeDefined();
  });

  it('renders PT-BR status badge "Ativo" for active status', () => {
    render(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={{ status: null, cadence: null, tier: null, provider: null }}
      />,
    );
    const badge = screen.getByTestId('membros-status-mem-1');
    expect(badge.textContent).toBe('Ativo');
  });

  it('renders "Inadimplente" for past_due status', () => {
    const pastDueItem = { ...baseItem, status: 'past_due' as const, membershipId: 'mem-2' };
    render(
      <MembrosTable
        items={[pastDueItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={{ status: null, cadence: null, tier: null, provider: null }}
      />,
    );
    const badge = screen.getByTestId('membros-status-mem-2');
    expect(badge.textContent).toBe('Inadimplente');
  });

  it('renders empty state when items is empty array', () => {
    render(
      <MembrosTable
        items={[]}
        page={1}
        pageSize={25}
        total={0}
        activeFilters={{ status: null, cadence: null, tier: null, provider: null }}
      />,
    );
    expect(screen.getByTestId('membros-empty-state')).toBeDefined();
    expect(screen.getByText('Nenhum membro encontrado.')).toBeDefined();
  });

  it('renders pagination controls when totalPages > 1', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      ...baseItem,
      membershipId: `mem-${i}`,
    }));
    render(
      <MembrosTable
        items={items}
        page={2}
        pageSize={25}
        total={100}
        activeFilters={{ status: null, cadence: null, tier: null, provider: null }}
      />,
    );
    expect(screen.getByTestId('membros-prev')).toBeDefined();
    expect(screen.getByTestId('membros-next')).toBeDefined();
    expect(screen.getByTestId('membros-page-indicator')).toBeDefined();
  });

  it('page indicator shows "Página 2 de 4"', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      ...baseItem,
      membershipId: `mem-${i}`,
    }));
    render(
      <MembrosTable
        items={items}
        page={2}
        pageSize={25}
        total={100}
        activeFilters={{ status: null, cadence: null, tier: null, provider: null }}
      />,
    );
    expect(screen.getByTestId('membros-page-indicator').textContent).toBe('Página 2 de 4');
  });

  it('row link navigates to /users/:userId', () => {
    render(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={{ status: null, cadence: null, tier: null, provider: null }}
      />,
    );
    const link = screen.getByTestId('membros-row-link-mem-1') as HTMLAnchorElement;
    expect(link.href).toContain('/users/user-1');
  });

  it('clicking a status chip calls router.replace with status param', () => {
    const mockReplace = vi.fn();
    vi.mocked(require('next/navigation').useRouter).mockReturnValue({ replace: mockReplace });

    render(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={{ status: null, cadence: null, tier: null, provider: null }}
      />,
    );
    fireEvent.click(screen.getByText('Ativo'));
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('status=active'));
  });
});
```

### `apps/admin/src/components/__tests__/garage-membership-history.test.tsx` (new — 6 specs)

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Mock finance-actions
vi.mock('~/lib/finance-actions', () => ({
  fetchFinanceMemberships: vi.fn(),
}));

import { fetchFinanceMemberships } from '~/lib/finance-actions';
import { GarageMembershipHistory } from '../garage-membership-history';
import type { AdminFinanceMembershipsItem } from '@ccc/shared/admin';

const memberships: AdminFinanceMembershipsItem[] = [
  {
    membershipId: 'mem-a',
    garageId: 'garage-x',
    garageSlug: 'garage-slug-x',
    userName: 'Beltrano',
    userEmail: 'beltrano@test.com',
    userId: 'user-x',
    tier: 'gold',
    cadence: 'annual',
    status: 'active',
    currentPeriodEnd: '2027-01-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    totalPaidCents: 119900,
    invoiceCount: 1,
    provider: 'apple_revenuecat',
    providerSubRef: 'rc_abc',
  },
  {
    membershipId: 'mem-b',
    garageId: 'garage-x',
    garageSlug: 'garage-slug-x',
    userName: 'Beltrano',
    userEmail: 'beltrano@test.com',
    userId: 'user-x',
    tier: 'gold',
    cadence: 'monthly',
    status: 'expired',
    currentPeriodEnd: '2026-01-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    totalPaidCents: 49500,
    invoiceCount: 5,
    provider: 'stripe',
    providerSubRef: 'sub_old',
  },
];
```

| #   | Test name                                                | Intent           | Key assertion                                                 |
| --- | -------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| 1   | `renders membership rows for the garage`                 | Happy path       | `data-testid="membership-row-mem-a"` present                  |
| 2   | `renders status badge with PT-BR label "Ativo"`          | Status badge     | `data-testid="membership-status-badge-mem-a"` text = `Ativo`  |
| 3   | `renders provider label "Apple / RC"`                    | Provider PT-BR   | `data-testid="membership-provider-mem-a"` text = `Apple / RC` |
| 4   | `renders provider label "Stripe" for stripe row`         | Provider variant | `data-testid="membership-provider-mem-b"` text = `Stripe`     |
| 5   | `renders empty state when no memberships match garageId` | Empty state      | `data-testid="garage-membership-empty"` present               |
| 6   | `renders both rows sorted live-first then expired`       | Sort order       | `mem-a` appears before `mem-b` in rendered HTML               |

Full test code:

```tsx
describe('GarageMembershipHistory', () => {
  it('renders membership rows for the garage', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: memberships,
      page: 1,
      pageSize: 50,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    expect(html).toContain('data-testid="membership-row-mem-a"');
  });

  it('renders status badge with PT-BR label "Ativo"', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: memberships,
      page: 1,
      pageSize: 50,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    expect(html).toContain('data-testid="membership-status-badge-mem-a"');
    expect(html).toContain('Ativo');
  });

  it('renders provider label "Apple / RC"', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: memberships,
      page: 1,
      pageSize: 50,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    expect(html).toContain('Apple / RC');
  });

  it('renders provider label "Stripe" for stripe row', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: memberships,
      page: 1,
      pageSize: 50,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    expect(html).toContain('Stripe');
  });

  it('renders empty state when no memberships match garageId', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: memberships.map((m) => ({ ...m, garageId: 'OTHER' })),
      page: 1,
      pageSize: 50,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    expect(html).toContain('data-testid="garage-membership-empty"');
    expect(html).toContain('Sem assinaturas registradas.');
  });

  it('renders both rows sorted live-first then expired', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: [...memberships].reverse(), // expired first in mock to verify sort
      page: 1,
      pageSize: 50,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    const idxActive = html.indexOf('membership-row-mem-a');
    const idxExpired = html.indexOf('membership-row-mem-b');
    expect(idxActive).toBeLessThan(idxExpired); // live row before expired
  });
});
```

---

## Task decomposition

Five TDD tasks. Each ends with a commit. ~90 min total.

### Task 1 — Add `getFinanceMemberships` to `admin-api.ts` + `fetchFinanceMemberships` to `finance-actions.ts` (red then green)

**Files:**

- Modify: `apps/admin/src/lib/admin-api.ts`
- Modify: `apps/admin/src/lib/finance-actions.ts`

- [ ] **1.1 — Verify F8.14 symbols present**

```bash
grep -n "adminFinanceMembershipsResponseSchema\|AdminFinanceMembershipsItem" \
  packages/shared/src/admin.ts
```

Expected: both present. If absent, STOP.

- [ ] **1.2 — Write a minimal failing test** to confirm the function does not yet exist:

```bash
grep -n "getFinanceMemberships\|fetchFinanceMemberships" \
  apps/admin/src/lib/admin-api.ts apps/admin/src/lib/finance-actions.ts
```

Expected: no matches (functions not yet defined). If they already exist (from a prior attempt), skip to Step 1.5.

- [ ] **1.3 — Add `getFinanceMemberships` to `admin-api.ts`** per code shape above. Add import for `adminFinanceMembershipsResponseSchema`, `AdminFinanceMembershipsQuery` from `@ccc/shared/admin` to the existing import block at the top of the file.

- [ ] **1.4 — Add `fetchFinanceMemberships` to `finance-actions.ts`** per code shape above.

- [ ] **1.5 — Typecheck**

```bash
pnpm --filter @ccc/admin typecheck
```

Expected: clean. If TypeScript errors on missing types from `@ccc/shared/admin`, confirm F8.14 is merged and `@ccc/shared` is rebuilt:

```bash
pnpm --filter @ccc/shared build
pnpm --filter @ccc/admin typecheck
```

- [ ] **1.6 — Commit**

```bash
git add apps/admin/src/lib/admin-api.ts apps/admin/src/lib/finance-actions.ts
git commit -m "feat(admin): add getFinanceMemberships + fetchFinanceMemberships (chunk 16)"
```

---

### Task 2 — Write failing tests for `MembrosTable` + `page.tsx` (red)

**Files:**

- Create: `apps/admin/app/(authed)/financeiro/membros/__tests__/page.test.tsx`

- [ ] **2.1 — Create the `__tests__` directory**

```bash
mkdir -p apps/admin/app/\(authed\)/financeiro/membros/__tests__
```

- [ ] **2.2 — Write the failing test file** with all 9 specs from the test plan above. Use the fixture `baseItem` and the test bodies shown verbatim. The module-under-test is `../membros-table` — it does not exist yet.

- [ ] **2.3 — Run, confirm failures**

```bash
pnpm --filter @ccc/admin exec vitest run "app/\(authed\)/financeiro/membros/__tests__/page.test.tsx"
```

Expected: FAIL with "Cannot find module '../membros-table'" or similar. Confirms test reach.

- [ ] **2.4 — Commit the failing test**

```bash
git add "apps/admin/app/(authed)/financeiro/membros/__tests__/page.test.tsx"
git commit -m "test(admin): failing MembrosTable specs (chunk 16)"
```

---

### Task 3 — Implement `membros-table.tsx` + `page.tsx` (green)

**Files:**

- Create: `apps/admin/app/(authed)/financeiro/membros/membros-table.tsx`
- Create: `apps/admin/app/(authed)/financeiro/membros/page.tsx`

- [ ] **3.1 — Create `membros-table.tsx`** per code shape above. Copy the label maps, helper functions, `Chip` component, and `MembrosTable` component verbatim. Do not omit the `data-testid` attributes — the tests assert on them.

- [ ] **3.2 — Create `page.tsx`** per code shape above. It is a server component (`async function`). Import `MembrosTable` from `./membros-table`.

- [ ] **3.3 — Run, confirm all 9 tests PASS**

```bash
pnpm --filter @ccc/admin exec vitest run "app/\(authed\)/financeiro/membros/__tests__/page.test.tsx"
```

Expected: 9/9 PASS.

- [ ] **3.4 — Typecheck**

```bash
pnpm --filter @ccc/admin typecheck
```

Expected: clean.

- [ ] **3.5 — Commit**

```bash
git add "apps/admin/app/(authed)/financeiro/membros/membros-table.tsx" \
        "apps/admin/app/(authed)/financeiro/membros/page.tsx"
git commit -m "feat(admin): /financeiro/membros page + MembrosTable (chunk 16)"
```

---

### Task 4 — Write failing tests + implement `GarageMembershipHistory` (red then green)

**Files:**

- Create: `apps/admin/src/components/__tests__/garage-membership-history.test.tsx`
- Create: `apps/admin/src/components/garage-membership-history.tsx`

- [ ] **4.1 — Write the failing test file** with all 6 specs from the test plan above. The module-under-test is `../garage-membership-history` — it does not exist yet.

- [ ] **4.2 — Run, confirm failures**

```bash
pnpm --filter @ccc/admin exec vitest run "src/components/__tests__/garage-membership-history.test.tsx"
```

Expected: FAIL with "Cannot find module '../garage-membership-history'". Confirms test reach.

- [ ] **4.3 — Commit the failing tests**

```bash
git add "apps/admin/src/components/__tests__/garage-membership-history.test.tsx"
git commit -m "test(admin): failing GarageMembershipHistory specs (chunk 16)"
```

- [ ] **4.4 — Create `garage-membership-history.tsx`** per code shape above. Copy the label maps, helper functions, and `GarageMembershipHistory` component verbatim. Include all `data-testid` attributes.

- [ ] **4.5 — Run, confirm all 6 tests PASS**

```bash
pnpm --filter @ccc/admin exec vitest run "src/components/__tests__/garage-membership-history.test.tsx"
```

Expected: 6/6 PASS.

- [ ] **4.6 — Typecheck**

```bash
pnpm --filter @ccc/admin typecheck
```

Expected: clean.

- [ ] **4.7 — Commit**

```bash
git add "apps/admin/src/components/garage-membership-history.tsx"
git commit -m "feat(admin): GarageMembershipHistory embedded component (chunk 16)"
```

---

### Task 5 — Embed `GarageMembershipHistory` on user-garage detail page + final verification

**Files:**

- Modify: `apps/admin/app/(authed)/users/[id]/page.tsx`

- [ ] **5.1 — Read the current file before editing**

```bash
# Confirm the current structure and adminGarage hoisting need
grep -n "adminGarage\|GarageBadgesPanel\|let badgeCatalog" \
  apps/admin/app/\(authed\)/users/\[id\]/page.tsx
```

Expected: `adminGarage` declared inside the try block (around line 88). Note its line number.

- [ ] **5.2 — Hoist `adminGarage` declaration** to the outer scope (above the try block), keeping the assignment inside:

The current pattern is approximately:

```ts
try {
  const [catalog, adminGarage] = await Promise.all([...]);
  // uses adminGarage.garage.isPremiumActive
  // uses adminGarage.garage.isPublic
}
```

Change to:

```ts
let adminGarage: Awaited<ReturnType<typeof getAdminUserGarage>> | undefined;
try {
  const [catalog, _adminGarage] = await Promise.all([...]);
  adminGarage = _adminGarage;
  // ...rest of existing code using adminGarage
}
```

Confirm `getAdminUserGarage` is already imported (it is, per the existing file read).

- [ ] **5.3 — Add import for `GarageMembershipHistory`** in the imports block, after `GarageBadgesPanel`:

```tsx
import { GarageMembershipHistory } from '~/components/garage-membership-history';
```

- [ ] **5.4 — Add the component to the JSX** after the `GarageBadgesPanel` section and before the Group memberships section:

```tsx
{
  /* Membership history (F8.16) */
}
{
  adminGarage ? <GarageMembershipHistory garageId={adminGarage.garage.id} /> : null;
}
```

- [ ] **5.5 — Typecheck**

```bash
pnpm --filter @ccc/admin typecheck
```

Expected: clean.

- [ ] **5.6 — Run both test scopes to confirm nothing regressed**

```bash
pnpm --filter @ccc/admin exec vitest run \
  "app/(authed)/financeiro/membros/__tests__/page.test.tsx" \
  "src/components/__tests__/garage-membership-history.test.tsx"
```

Expected: 15/15 PASS.

- [ ] **5.7 — Lint touched files**

```bash
pnpm --filter @ccc/admin lint -- \
  apps/admin/app/\(authed\)/financeiro/membros/page.tsx \
  apps/admin/app/\(authed\)/financeiro/membros/membros-table.tsx \
  "apps/admin/app/(authed)/financeiro/membros/__tests__/page.test.tsx" \
  apps/admin/src/components/garage-membership-history.tsx \
  "apps/admin/src/components/__tests__/garage-membership-history.test.tsx" \
  "apps/admin/app/(authed)/users/[id]/page.tsx" \
  apps/admin/src/lib/admin-api.ts \
  apps/admin/src/lib/finance-actions.ts
```

Fix any errors before the PR commit.

- [ ] **5.8 — Commit**

```bash
git add "apps/admin/app/(authed)/users/[id]/page.tsx"
git commit -m "feat(admin): embed GarageMembershipHistory on user-garage detail (chunk 16)"
```

- [ ] **5.9 — Push**

```bash
git push -u origin feat/jdma-f8-billing-16
```

---

## Verification commands (filtered — per canon §F8.12)

```bash
# All tests for this chunk
pnpm --filter @ccc/admin exec vitest run \
  "app/(authed)/financeiro/membros/__tests__/page.test.tsx" \
  "src/components/__tests__/garage-membership-history.test.tsx"

# Typecheck
pnpm --filter @ccc/admin typecheck
```

---

## Deviations (locked at plan time)

1. **`GarageMembershipHistory` filters client-side by `garageId`.** The F8.14 endpoint does not expose a `garageId` query param (only `status`, `cadence`, `tier`, `provider`, date range, `search`). The component fetches page 1 + 50 items and filters by `garageId` in the component. If F8.14 later adds a `garageId` param, switch to a server-side filter. This is noted inline in the component code.

2. **No Testcontainers.** All tests in this chunk are RTL/SSR tests against React components. The API call is mocked via `vi.mock('~/lib/finance-actions', ...)`. Real-DB integration tests for the underlying `/finance/memberships` endpoint belong to F8.14, not F8.16.

3. **Feature flag not checked on the page.** The `/financeiro/membros` page is an admin-internal surface. It does not gate on `GROWTH_PREMIUM_BILLING_ENABLED`. If the flag is off, the API returns an empty list (or a 503 if F8.14 applies the flag at the API level); the page renders the empty state. This is consistent with how the existing `/financeiro` page works.

4. **No "Ver detalhes" modal.** The skeleton spec mentions "per-row 'Ver detalhes' deep-link to `/users/:id/garage`". This chunk implements it as a `<Link href="/users/:id">` (to the user detail page where `GarageMembershipHistory` is embedded). A dedicated `/users/:id/garage` sub-route does not exist; the user detail page IS the garage detail page per the existing `apps/admin/app/(authed)/users/[id]/page.tsx` structure.

5. **`GarageMembershipHistory` does not list individual invoice rows.** The `AdminFinanceMembershipsItem` shape (from F8.14) provides `invoiceCount` and `totalPaidCents` as aggregates. Per-invoice rows (with `periodStart`, `periodEnd`, `paidAt`, `refundedAt` per `PremiumMembershipInvoice`) are not exposed by the `/finance/memberships` endpoint — that endpoint returns membership-level summaries. The component renders the aggregate counts. A future chunk that adds a `/finance/memberships/:id/invoices` endpoint can extend this component with a detail view.

---

## PR checklist (after Task 5)

- [ ] Branch `feat/jdma-f8-billing-16` from fresh `main`.
- [ ] F8.14 merged before this PR is raised.
- [ ] All 9 `page.test.tsx` specs PASS.
- [ ] All 6 `garage-membership-history.test.tsx` specs PASS.
- [ ] `pnpm --filter @ccc/admin typecheck` clean.
- [ ] Lint clean on all touched files.
- [ ] `GarageMembershipHistory` visible on the existing user detail page (`/users/:id`).
- [ ] PR title: `feat(admin): /financeiro/membros page + GarageMembershipHistory (chunk 16)`.
- [ ] PR target: `main`.
- [ ] PR body documents the 5 deviations above (especially #1 client-side garageId filter; #5 aggregate-only invoice display).
- [ ] Cross-references in PR body: spec §7.2, skeleton §"F8.16", F8.14 PR number.
- [ ] CI green before requesting review.
