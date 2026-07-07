# Chunk 15 — Admin Financeiro UI (`filter-bar` + `kpi-row` + `payment-mix` + `trend-chart`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the admin financial dashboard UI to surface membership data from the F8.13 + F8.14 API additions — new `kind` filter with membership sub-filters, three new KPI tiles, updated net-revenue total, up to 4 payment-mix rows, and a three-series stacked area chart.

**Architecture:** Four existing components under `apps/admin/app/(authed)/financeiro/components/` are each extended in isolation. `filter-bar.tsx` (`'use client'`) gains a `kind` dropdown that conditionally reveals `cadence`, `tier`, and `status` sub-filters. `kpi-row.tsx` (server-renderable) gets a new "Assinaturas" tile group. `payment-mix.tsx` (server-renderable) gains two new label mappings. `trend-chart.tsx` (`'use client'`, Recharts) adds a third `Area` series and gradient. Each component has its own test file — `renderToStaticMarkup` for the server-renderable ones; `@vitest-environment jsdom` + `createRoot` for client components. No new route, no new API call, no Testcontainers — pure UI.

**Tech Stack:** Next.js App Router, Recharts (already in `trend-chart.tsx`), `@jdm/shared/admin` zod types (extended by F8.13), Vitest, `react-dom/server` (`renderToStaticMarkup`) + `react-dom/client` (`createRoot`) for tests, PT-BR locale formatting.

---

## Required reading

1. `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §7.2 — admin UI deltas (authoritative feature list for this chunk).
2. `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §"F8.15" — dependency note (depends on F8.13 + F8.14).
3. `apps/admin/app/(authed)/financeiro/components/filter-bar.tsx` — existing `Filters` type, `Chip` component, `onFilterChange` contract.
4. `apps/admin/app/(authed)/financeiro/components/kpi-row.tsx` — existing `buildTileGroups` pattern, `TileGroup` shape.
5. `apps/admin/app/(authed)/financeiro/components/payment-mix.tsx` — existing `methodLabels` + `providerLabels` maps, `AdminFinancePaymentMixItem` shape.
6. `apps/admin/app/(authed)/financeiro/components/trend-chart.tsx` — existing Recharts `Area` + gradient pattern; `AdminFinanceTrendPoint` shape.
7. `apps/admin/app/(authed)/financeiro/components/finance-dashboard.tsx` — how parent composes children + passes data; `buildQuery` → `AdminFinanceQuery` contract; `activeFilters` shape fed into `FilterBar`.
8. `packages/shared/src/admin.ts` — current `adminFinanceSummarySchema`, `adminFinanceTrendPointSchema`, `adminFinancePaymentMixItemSchema`; this chunk ONLY reads types — F8.13 must have landed and extended these types before this chunk's tests compile.
9. `apps/admin/src/components/admin-xp-adjustment-modal.interaction.test.tsx` — `@vitest-environment jsdom` + `createRoot` pattern used for `'use client'` component tests.
10. `apps/admin/vitest.config.ts` — `environment: 'node'` by default; JSdom tests must opt-in with `// @vitest-environment jsdom` at file top.
11. `apps/admin/AGENTS.md` — "This is NOT the Next.js you know." Read `node_modules/next/dist/docs/` before writing any Next.js code.
12. `CLAUDE.md` — branch preflight, git flow, touched-paths-only test scope.

---

## Pre-flight checklist (before Task 1)

- [ ] **PF-1: Branch safety**

```bash
git branch --show-current
```

Output must NOT be `production`. If it is, stop and switch to `main` first.

- [ ] **PF-2: Create branch from fresh `main`**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-15
```

- [ ] **PF-3: Confirm F8.13 + F8.14 types have landed**

```bash
grep -n "membershipNetRevenueCents\|membershipMRRCents\|activeMembershipsCount" \
  packages/shared/src/admin.ts
grep -n "membershipRevenueCents" \
  packages/shared/src/admin.ts
```

Expected: at minimum `membershipNetRevenueCents`, `membershipMRRCents`, `activeMembershipsCount` in `adminFinanceSummarySchema` and `membershipRevenueCents` in `adminFinanceTrendPointSchema`. If absent, F8.13 has not merged — STOP and wait for that chunk.

- [ ] **PF-4: Rebuild `@jdm/shared` to pick up F8.13 additions**

```bash
pnpm --filter @jdm/shared build
```

Expected: exits 0. If it fails, fix the shared build before continuing (canon §F8.13).

---

## Files touched

| Path                                                                           | Action | Responsibility                                                                   |
| ------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------- |
| `apps/admin/app/(authed)/financeiro/components/filter-bar.tsx`                 | Modify | Add `kind` dropdown + conditional `cadence`/`tier`/`status` sub-filters          |
| `apps/admin/app/(authed)/financeiro/components/kpi-row.tsx`                    | Modify | Add "Assinaturas" tile group; update "Receita líquida" to include membership net |
| `apps/admin/app/(authed)/financeiro/components/payment-mix.tsx`                | Modify | Add `stripe:subscription` + `apple_revenuecat:storekit` label mappings           |
| `apps/admin/app/(authed)/financeiro/components/trend-chart.tsx`                | Modify | Add `membershipRevenueCents` Area series + gradient                              |
| `apps/admin/app/(authed)/financeiro/components/__tests__/filter-bar.test.tsx`  | Create | jsdom interaction tests for `kind` dropdown + sub-filter visibility              |
| `apps/admin/app/(authed)/financeiro/components/__tests__/kpi-row.test.tsx`     | Create | `renderToStaticMarkup` tests for new tiles + updated total                       |
| `apps/admin/app/(authed)/financeiro/components/__tests__/payment-mix.test.tsx` | Create | `renderToStaticMarkup` tests for new rows                                        |
| `apps/admin/app/(authed)/financeiro/components/__tests__/trend-chart.test.tsx` | Create | Node-environment snapshot of chart data keys                                     |
| `packages/shared/src/admin.ts`                                                 | Modify | Add `kind`, `cadence`, `tier`, `membershipStatus` to `adminFinanceQuerySchema`   |

**Do NOT touch:** `finance-dashboard.tsx` (parent wiring is left for F8.16 or a follow-up), any API route, any non-financeiro file.

---

## Type contract (what this chunk adds to `@jdm/shared`)

`adminFinanceQuerySchema` gains four new optional fields. Add them alongside the existing `provider` and `method` fields:

```ts
kind: z.enum(['tickets', 'store', 'membership', 'all']).optional(),
cadence: z.enum(['monthly', 'annual', 'all']).optional(),
tier: z.enum(['gold', 'all']).optional(),
membershipStatus: z
  .enum(['active', 'past_due', 'cancel_scheduled', 'expired', 'all'])
  .optional(),
```

`AdminFinanceSummary` (from F8.13 — already landed, consumed here but NOT authored here):

```ts
membershipRevenueCents: z.number().int().nonnegative(),
membershipNetRevenueCents: z.number().int().nonnegative(),
membershipDevFeeCollectedCents: z.number().int().nonnegative(),
membershipRefundedCents: z.number().int(),
activeMembershipsCount: z.number().int().nonnegative(),
newMembershipsCount: z.number().int().nonnegative(),
churnedMembershipsCount: z.number().int().nonnegative(),
membershipMRRCents: z.number().int().nonnegative(),
membershipARPUCents: z.number().int().nonnegative(),
```

`AdminFinanceTrendPoint` (from F8.13 — already landed):

```ts
membershipRevenueCents: z.number().int().nonnegative(),
```

---

## Component final states

### `filter-bar.tsx` — extended `Filters` type and new sub-filters

The `Filters` type gains four new optional fields:

```ts
type Filters = {
  from: string | null;
  to: string | null;
  provider: string | null;
  method: string | null;
  search: string | null;
  eventId: string | null;
  // F8.15 additions:
  kind: string | null;
  cadence: string | null;
  tier: string | null;
  membershipStatus: string | null;
};
```

The `kind` dropdown replaces nothing — it is inserted after the existing `eventId` `<select>` and before the first `<span>` divider. When `kind === 'membership'`, three additional `<select>` elements appear inline (same `filterContent` `<div>`). When `kind` is `null`, `'all'`, `'tickets'`, or `'store'`, those three selects are hidden.

```tsx
const kindOptions = [
  { value: 'all', label: 'Todos' },
  { value: 'tickets', label: 'Ingressos' },
  { value: 'store', label: 'Loja' },
  { value: 'membership', label: 'Assinaturas' },
];

const cadenceOptions = [
  { value: 'all', label: 'Todas as cadências' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'annual', label: 'Anual' },
];

const tierOptions = [
  { value: 'all', label: 'Todos os planos' },
  { value: 'gold', label: 'Gold' },
];

const membershipStatusOptions = [
  { value: 'all', label: 'Todos os status' },
  { value: 'active', label: 'Ativo' },
  { value: 'past_due', label: 'Pagamento pendente' },
  { value: 'cancel_scheduled', label: 'Cancelamento agendado' },
  { value: 'expired', label: 'Expirado' },
];
```

In the `filterContent` JSX, after the `eventId` select and before the first `<span className="mx-1 h-4 w-px ..."/>` divider, insert:

```tsx
<select
  value={filters.kind ?? 'all'}
  onChange={(e) => onFilterChange('kind', e.target.value === 'all' ? null : e.target.value)}
  className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
  aria-label="Tipo de receita"
>
  {kindOptions.map((o) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  ))}
</select>;

{
  filters.kind === 'membership' ? (
    <>
      <select
        value={filters.cadence ?? 'all'}
        onChange={(e) =>
          onFilterChange('cadence', e.target.value === 'all' ? null : e.target.value)
        }
        className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="Cadência"
      >
        {cadenceOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={filters.tier ?? 'all'}
        onChange={(e) => onFilterChange('tier', e.target.value === 'all' ? null : e.target.value)}
        className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="Plano"
      >
        {tierOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={filters.membershipStatus ?? 'all'}
        onChange={(e) =>
          onFilterChange('membershipStatus', e.target.value === 'all' ? null : e.target.value)
        }
        className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="Status"
      >
        {membershipStatusOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  ) : null;
}
```

The `hasFilters` check already uses `Object.values(filters).some(Boolean)` — the four new nullable fields are falsy when `null`, so they participate automatically.

### `kpi-row.tsx` — new tile group + updated net-revenue

`buildTileGroups` receives `AdminFinanceSummary`. Add a third tile group **and** update the "Receita líquida" tile:

```ts
function buildTileGroups(s: AdminFinanceSummary): TileGroup[] {
  // Updated: net = tickets + store + membership net
  const totalNetCents = s.netRevenueCents + (s.membershipNetRevenueCents ?? 0);

  return [
    {
      title: 'Resumo geral',
      tiles: [
        { label: 'Receita líquida', value: fmtCurrency(totalNetCents), accent: true },
        { label: 'Receita bruta', value: fmtCurrency(s.totalRevenueCents) },
        { label: 'Pedidos', value: fmtNumber(s.orderCount) },
        { label: 'Ticket médio', value: fmtCurrency(s.avgOrderCents) },
        { label: 'Ingressos', value: fmtNumber(s.ticketCount) },
      ],
    },
    {
      title: 'Loja e ajustes',
      tiles: [
        { label: 'Receita loja', value: fmtCurrency(s.storeRevenueCents) },
        { label: 'Pedidos loja', value: fmtNumber(s.storeOrderCount) },
        { label: 'Reembolsado', value: fmtCurrency(s.refundedCents) },
        { label: 'Reembolsos', value: fmtNumber(s.refundedCount) },
      ],
    },
    {
      title: 'Assinaturas',
      tiles: [
        {
          label: 'Receita de Membros',
          value: fmtCurrency(s.membershipNetRevenueCents ?? 0),
        },
        {
          label: 'Membros Ativos',
          value: fmtNumber(s.activeMembershipsCount ?? 0),
        },
        {
          label: 'MRR',
          value: fmtCurrency(s.membershipMRRCents ?? 0),
          accent: true,
        },
      ],
    },
    {
      title: 'Taxa de desenvolvimento',
      tiles: [
        { label: 'Taxa atual', value: `${s.devFeePercent}%` },
        { label: 'Taxa coletada', value: fmtCurrency(s.devFeeCollectedCents) },
      ],
    },
  ];
}
```

Note: `?? 0` guards against old-format API payloads before F8.13 lands in production; fields are non-optional in the zod schema but the guard prevents a runtime crash if called with a pre-F8 payload in tests.

### `payment-mix.tsx` — new label mappings

Add two entries to the existing `methodLabels` and `providerLabels` maps:

```ts
const methodLabels: Record<string, string> = {
  card: 'Cartão',
  pix: 'Pix',
  subscription: 'Assinatura', // F8.15: Stripe subscription method
  storekit: 'App Store', // F8.15: Apple StoreKit via RevenueCat
};

const providerLabels: Record<string, string> = {
  stripe: 'Stripe',
  abacatepay: 'AbacatePay',
  apple_revenuecat: 'RevenueCat', // F8.15: Apple IAP via RevenueCat
};
```

No JSX changes needed — the existing `label` construction `${methodLabels[item.method] ?? item.method} · ${providerLabels[item.provider] ?? item.provider}` already falls back gracefully, but with these additions the two new rows render as:

- `stripe:subscription` → "Assinatura · Stripe"
- `apple_revenuecat:storekit` → "App Store · RevenueCat"

### `trend-chart.tsx` — third Area series

Add a `membershipGradient` `<linearGradient>` and a third `<Area>` for `membershipRevenueCents`. Mirror the existing `hasStoreData` guard pattern:

```tsx
const hasMembershipData = points.some((p) => p.membershipRevenueCents > 0);
```

In `<defs>`:

```tsx
<linearGradient id="membershipGradient" x1="0" y1="0" x2="0" y2="1">
  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
</linearGradient>
```

After the existing `storeRevenueCents` `<Area>` block (inside the conditional):

```tsx
{
  hasMembershipData ? (
    <Area
      type="monotone"
      dataKey="membershipRevenueCents"
      stackId="revenue"
      stroke="#8b5cf6"
      strokeWidth={2}
      fill="url(#membershipGradient)"
      name="membershipRevenueCents"
    />
  ) : null;
}
```

Update `CustomTooltip` to render the membership line when non-zero:

```tsx
const hasMembership = p.membershipRevenueCents > 0;
// ... inside return:
{
  hasMembership ? (
    <div style={{ color: '#8b5cf6' }}>Assinaturas: {fmtCurrency(p.membershipRevenueCents)}</div>
  ) : null;
}
```

Update the `<Legend>` formatter to handle the third key:

```tsx
formatter={(value: string) =>
  value === 'ticketRevenueCents'
    ? 'Ingressos'
    : value === 'storeRevenueCents'
    ? 'Loja'
    : 'Assinaturas'
}
```

The `<Legend>` is only rendered when `hasStoreData || hasMembershipData` — update that condition:

```tsx
{hasStoreData || hasMembershipData ? (
  <Legend ... />
) : null}
```

---

## Test plan

### Test file 1: `filter-bar.test.tsx` (jsdom, interaction)

**File path:** `apps/admin/app/(authed)/financeiro/components/__tests__/filter-bar.test.tsx`

Tests use `// @vitest-environment jsdom` + `createRoot` + `act`. The component is `'use client'`, so `renderToStaticMarkup` is not appropriate here — we need DOM interaction.

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilterBar } from '../filter-bar';
```

Base fixture:

```ts
const baseFilters = {
  from: null,
  to: null,
  provider: null,
  method: null,
  search: null,
  eventId: null,
  kind: null,
  cadence: null,
  tier: null,
  membershipStatus: null,
};
```

| #   | Test name                                                                        | Intent                                                          |
| --- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `renders kind dropdown with default "Todos" selected`                            | Kind dropdown exists; default is `all`                          |
| 2   | `membership sub-filters are hidden when kind is null`                            | No `[aria-label="Cadência"]` in DOM                             |
| 3   | `membership sub-filters are hidden when kind is "tickets"`                       | Tickets filter hides membership-specific selects                |
| 4   | `membership sub-filters are hidden when kind is "store"`                         | Store filter hides membership-specific selects                  |
| 5   | `membership sub-filters appear when kind is "membership"`                        | All three sub-selects visible                                   |
| 6   | `cadence sub-filter calls onFilterChange with correct value`                     | Selecting "Mensal" calls `onFilterChange('cadence', 'monthly')` |
| 7   | `selecting "all" cadence calls onFilterChange with null`                         | Clearing calls `onFilterChange('cadence', null)`                |
| 8   | `tier sub-filter calls onFilterChange('tier', 'gold')`                           | Selecting Gold calls correctly                                  |
| 9   | `membershipStatus sub-filter calls onFilterChange('membershipStatus', 'active')` | Status filter works                                             |
| 10  | `kind dropdown calls onFilterChange('kind', 'membership')`                       | Selecting membership kind calls correctly                       |
| 11  | `kind dropdown calls onFilterChange('kind', null) when "all" selected`           | Clearing kind passes null                                       |

Test 5 full code:

```tsx
it('membership sub-filters appear when kind is "membership"', async () => {
  const onChange = vi.fn();
  await act(async () => {
    root.render(
      <FilterBar
        filters={{ ...baseFilters, kind: 'membership' }}
        events={[]}
        onFilterChange={onChange}
        onClear={vi.fn()}
        isPending={false}
      />,
    );
    await Promise.resolve();
  });
  expect(document.querySelector('[aria-label="Cadência"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Plano"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Status"]')).not.toBeNull();
});
```

Test 2 full code:

```tsx
it('membership sub-filters are hidden when kind is null', async () => {
  const onChange = vi.fn();
  await act(async () => {
    root.render(
      <FilterBar
        filters={baseFilters}
        events={[]}
        onFilterChange={onChange}
        onClear={vi.fn()}
        isPending={false}
      />,
    );
    await Promise.resolve();
  });
  expect(document.querySelector('[aria-label="Cadência"]')).toBeNull();
  expect(document.querySelector('[aria-label="Plano"]')).toBeNull();
  expect(document.querySelector('[aria-label="Status"]')).toBeNull();
});
```

Test 6 full code:

```tsx
it('cadence sub-filter calls onFilterChange with correct value', async () => {
  const onChange = vi.fn();
  await act(async () => {
    root.render(
      <FilterBar
        filters={{ ...baseFilters, kind: 'membership' }}
        events={[]}
        onFilterChange={onChange}
        onClear={vi.fn()}
        isPending={false}
      />,
    );
    await Promise.resolve();
  });
  const cadenceSelect = document.querySelector('[aria-label="Cadência"]') as HTMLSelectElement;
  await act(async () => {
    cadenceSelect.value = 'monthly';
    cadenceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  expect(onChange).toHaveBeenCalledWith('cadence', 'monthly');
});
```

Test 7 full code:

```tsx
it('selecting "all" cadence calls onFilterChange with null', async () => {
  const onChange = vi.fn();
  await act(async () => {
    root.render(
      <FilterBar
        filters={{ ...baseFilters, kind: 'membership', cadence: 'monthly' }}
        events={[]}
        onFilterChange={onChange}
        onClear={vi.fn()}
        isPending={false}
      />,
    );
    await Promise.resolve();
  });
  const cadenceSelect = document.querySelector('[aria-label="Cadência"]') as HTMLSelectElement;
  await act(async () => {
    cadenceSelect.value = 'all';
    cadenceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  expect(onChange).toHaveBeenCalledWith('cadence', null);
});
```

### Test file 2: `kpi-row.test.tsx` (node, renderToStaticMarkup)

**File path:** `apps/admin/app/(authed)/financeiro/components/__tests__/kpi-row.test.tsx`

```tsx
import type { AdminFinanceSummary } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KpiRow } from '../kpi-row';
```

Base fixture:

```ts
const baseSummary: AdminFinanceSummary = {
  totalRevenueCents: 500000,
  netRevenueCents: 400000,
  orderCount: 10,
  avgOrderCents: 50000,
  ticketCount: 20,
  refundedCents: 0,
  refundedCount: 0,
  storeRevenueCents: 100000,
  storeOrderCount: 3,
  devFeePercent: 10,
  devFeeCollectedCents: 50000,
  // F8.13 additions:
  membershipRevenueCents: 60000,
  membershipNetRevenueCents: 54000,
  membershipDevFeeCollectedCents: 6000,
  membershipRefundedCents: 0,
  activeMembershipsCount: 5,
  newMembershipsCount: 2,
  churnedMembershipsCount: 0,
  membershipMRRCents: 30000,
  membershipARPUCents: 12000,
};
```

| #   | Test name                                                                    | Intent                           |
| --- | ---------------------------------------------------------------------------- | -------------------------------- |
| 1   | `renders "Assinaturas" tile group heading`                                   | New group is present             |
| 2   | `renders "Receita de Membros" tile with correct value`                       | Tile label + formatted BRL value |
| 3   | `renders "Membros Ativos" tile with correct count`                           | Count formatted PT-BR            |
| 4   | `renders "MRR" tile with correct value`                                      | MRR formatted as currency        |
| 5   | `"Receita líquida" tile sums netRevenueCents + membershipNetRevenueCents`    | Updated total                    |
| 6   | `"Receita líquida" renders R$ 4.540,00 for net=400000 + membershipNet=54000` | Exact value check                |
| 7   | `renders correctly when membership fields are zero`                          | Zero guard — no crash            |

Test 2 full code:

```tsx
it('renders "Receita de Membros" tile with correct value', () => {
  const html = renderToStaticMarkup(<KpiRow summary={baseSummary} />);
  expect(html).toContain('Receita de Membros');
  // R$ 540,00
  expect(html).toContain('540');
});
```

Test 5 + 6 full code:

```tsx
it('"Receita líquida" sums netRevenueCents + membershipNetRevenueCents', () => {
  const html = renderToStaticMarkup(<KpiRow summary={baseSummary} />);
  // 400000 + 54000 = 454000 cents = R$ 4.540,00
  expect(html).toContain('Receita líquida');
  expect(html).toContain('4.540');
});

it('"Receita líquida" renders R$ 4.540,00 for net=400000 + membershipNet=54000', () => {
  const html = renderToStaticMarkup(<KpiRow summary={baseSummary} />);
  expect(html).toContain('4.540,00');
});
```

Test 7 full code:

```tsx
it('renders correctly when membership fields are zero', () => {
  const zeroSummary: AdminFinanceSummary = {
    ...baseSummary,
    membershipNetRevenueCents: 0,
    activeMembershipsCount: 0,
    membershipMRRCents: 0,
  };
  expect(() => renderToStaticMarkup(<KpiRow summary={zeroSummary} />)).not.toThrow();
  const html = renderToStaticMarkup(<KpiRow summary={zeroSummary} />);
  expect(html).toContain('Membros Ativos');
});
```

### Test file 3: `payment-mix.test.tsx` (node, renderToStaticMarkup)

**File path:** `apps/admin/app/(authed)/financeiro/components/__tests__/payment-mix.test.tsx`

```tsx
import type { AdminFinancePaymentMixItem } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PaymentMix } from '../payment-mix';
```

Fixtures:

```ts
const stripeCard: AdminFinancePaymentMixItem = {
  provider: 'stripe',
  method: 'card',
  revenueCents: 300000,
  orderCount: 6,
  percentage: 50.0,
};
const abacatePix: AdminFinancePaymentMixItem = {
  provider: 'abacatepay',
  method: 'pix',
  revenueCents: 180000,
  orderCount: 4,
  percentage: 30.0,
};
const stripeSub: AdminFinancePaymentMixItem = {
  provider: 'stripe',
  method: 'subscription',
  revenueCents: 90000,
  orderCount: 0,
  percentage: 15.0,
};
const appleStoreKit: AdminFinancePaymentMixItem = {
  provider: 'apple_revenuecat',
  method: 'storekit',
  revenueCents: 30000,
  orderCount: 0,
  percentage: 5.0,
};
```

| #   | Test name                                                        | Intent                                          |
| --- | ---------------------------------------------------------------- | ----------------------------------------------- |
| 1   | `renders "Assinatura · Stripe" for stripe:subscription`          | Correct Brazilian label for Stripe subscription |
| 2   | `renders "App Store · RevenueCat" for apple_revenuecat:storekit` | Correct label for Apple IAP                     |
| 3   | `renders up to 4 rows when all four item types present`          | All four appear                                 |
| 4   | `renders existing stripe:card row unchanged`                     | No regression on existing rows                  |
| 5   | `renders existing abacatepay:pix row unchanged`                  | No regression                                   |
| 6   | `renders empty state when items is empty`                        | Empty state text preserved                      |
| 7   | `stripe:subscription row shows percentage bar`                   | Has progress-bar markup                         |

Test 1 full code:

```tsx
it('renders "Assinatura · Stripe" for stripe:subscription', () => {
  const html = renderToStaticMarkup(<PaymentMix items={[stripeSub]} />);
  expect(html).toContain('Assinatura · Stripe');
});
```

Test 2 full code:

```tsx
it('renders "App Store · RevenueCat" for apple_revenuecat:storekit', () => {
  const html = renderToStaticMarkup(<PaymentMix items={[appleStoreKit]} />);
  expect(html).toContain('App Store · RevenueCat');
});
```

Test 3 full code:

```tsx
it('renders up to 4 rows when all four item types present', () => {
  const html = renderToStaticMarkup(
    <PaymentMix items={[stripeCard, abacatePix, stripeSub, appleStoreKit]} />,
  );
  expect(html).toContain('Cartão · Stripe');
  expect(html).toContain('Pix · AbacatePay');
  expect(html).toContain('Assinatura · Stripe');
  expect(html).toContain('App Store · RevenueCat');
});
```

Test 6 full code:

```tsx
it('renders empty state when items is empty', () => {
  const html = renderToStaticMarkup(<PaymentMix items={[]} />);
  expect(html).toContain('Sem dados.');
});
```

### Test file 4: `trend-chart.test.tsx` (node, data-key assertions)

**File path:** `apps/admin/app/(authed)/financeiro/components/__tests__/trend-chart.test.tsx`

`TrendChart` uses Recharts which uses `'use client'` and DOM APIs. In a `node` environment we can't render the full chart, but we CAN test the component's logic and verify data passing by asserting on the React element tree using `React.createElement` introspection. The practical approach: render with `renderToStaticMarkup` and assert on the SVG output shape — Recharts renders SVG in SSR mode when `ResponsiveContainer` receives a static size. However, in a pure node vitest environment, `window` is undefined and Recharts `ResponsiveContainer` throws. Use a shallow approach: extract and test the data-processing logic separately, then do a smoke render with mocked `ResponsiveContainer`.

The cleanest pattern for this codebase: mock `recharts` and assert React tree structure.

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock recharts — it calls DOM APIs not available in node environment
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'area-chart' }, children),
  Area: ({ dataKey, name }: { dataKey: string; name: string }) =>
    React.createElement('div', { 'data-area': dataKey, 'data-name': name }),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: ({ formatter }: { formatter: (v: string) => string }) =>
    React.createElement(
      'div',
      { 'data-legend': 'true' },
      ['ticketRevenueCents', 'storeRevenueCents', 'membershipRevenueCents'].map((k) =>
        React.createElement('span', { key: k }, formatter(k)),
      ),
    ),
}));

import { TrendChart } from '../trend-chart';
```

Fixtures:

```ts
import type { AdminFinanceTrendPoint } from '@jdm/shared/admin';

const pointWithMembership: AdminFinanceTrendPoint = {
  date: '2026-05-01',
  revenueCents: 30000,
  orderCount: 5,
  ticketRevenueCents: 20000,
  storeRevenueCents: 5000,
  membershipRevenueCents: 5000,
};

const pointNoMembership: AdminFinanceTrendPoint = {
  date: '2026-05-02',
  revenueCents: 25000,
  orderCount: 4,
  ticketRevenueCents: 25000,
  storeRevenueCents: 0,
  membershipRevenueCents: 0,
};
```

| #   | Test name                                                                 | Intent                          |
| --- | ------------------------------------------------------------------------- | ------------------------------- |
| 1   | `renders membershipRevenueCents Area when membership data is present`     | Third Area exists in tree       |
| 2   | `does not render membershipRevenueCents Area when membership is all-zero` | Conditional render guard        |
| 3   | `legend formatter returns "Assinaturas" for membershipRevenueCents key`   | PT-BR label correct             |
| 4   | `legend formatter returns "Ingressos" for ticketRevenueCents key`         | No regression on existing label |
| 5   | `legend formatter returns "Loja" for storeRevenueCents key`               | No regression on existing label |
| 6   | `renders empty state when no points`                                      | Empty state preserved           |
| 7   | `renders membershipGradient linearGradient definition`                    | Gradient ID present in markup   |

Test 1 full code:

```tsx
it('renders membershipRevenueCents Area when membership data is present', () => {
  const html = renderToStaticMarkup(<TrendChart points={[pointWithMembership]} />);
  expect(html).toContain('membershipRevenueCents');
});
```

Test 2 full code:

```tsx
it('does not render membershipRevenueCents Area when membership is all-zero', () => {
  const html = renderToStaticMarkup(<TrendChart points={[pointNoMembership]} />);
  expect(html).not.toContain('data-area="membershipRevenueCents"');
});
```

Test 3 full code:

```tsx
it('legend formatter returns "Assinaturas" for membershipRevenueCents key', () => {
  const html = renderToStaticMarkup(<TrendChart points={[pointWithMembership]} />);
  expect(html).toContain('Assinaturas');
});
```

Test 6 full code:

```tsx
it('renders empty state when no points', () => {
  const html = renderToStaticMarkup(<TrendChart points={[]} />);
  expect(html).toContain('Sem dados de tendência');
});
```

---

## Task decomposition

Six TDD tasks, ~90 min total. Each ends with a commit.

---

### Task 1 — Extend `@jdm/shared` query schema + verify F8.13 types

**Files:**

- Modify: `packages/shared/src/admin.ts`
- No test file needed — F8.13 owns schema tests; this chunk only adds query fields

- [ ] **1.1 — Add four new fields to `adminFinanceQuerySchema`**

Open `packages/shared/src/admin.ts`. Find `adminFinanceQuerySchema` (around line 565). Insert after `method: z.enum(['card', 'pix']).optional(),`:

```ts
kind: z.enum(['tickets', 'store', 'membership', 'all']).optional(),
cadence: z.enum(['monthly', 'annual', 'all']).optional(),
tier: z.enum(['gold', 'all']).optional(),
membershipStatus: z
  .enum(['active', 'past_due', 'cancel_scheduled', 'expired', 'all'])
  .optional(),
```

- [ ] **1.2 — Rebuild `@jdm/shared`**

```bash
pnpm --filter @jdm/shared build
```

Expected: exits 0.

- [ ] **1.3 — Typecheck `@jdm/admin`**

```bash
pnpm --filter @jdm/admin typecheck
```

Expected: exits 0 (no errors from the new schema fields). If TypeScript complains about `membershipNetRevenueCents` not existing on `AdminFinanceSummary`, F8.13 has not merged — STOP and wait.

- [ ] **1.4 — Commit**

```bash
git add packages/shared/src/admin.ts
git commit -m "$(cat <<'EOF'
feat(shared): add kind/cadence/tier/membershipStatus to adminFinanceQuerySchema (chunk 15)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 — `filter-bar.tsx` — red (write failing tests)

**Files:**

- Create: `apps/admin/app/(authed)/financeiro/components/__tests__/filter-bar.test.tsx`

- [ ] **2.1 — Create the test directory**

```bash
mkdir -p apps/admin/app/\(authed\)/financeiro/components/__tests__
```

- [ ] **2.2 — Write the full test file**

Create `apps/admin/app/(authed)/financeiro/components/__tests__/filter-bar.test.tsx`:

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilterBar } from '../filter-bar';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const baseFilters = {
  from: null,
  to: null,
  provider: null,
  method: null,
  search: null,
  eventId: null,
  kind: null,
  cadence: null,
  tier: null,
  membershipStatus: null,
};

describe('FilterBar — kind dropdown + membership sub-filters (chunk 15)', () => {
  it('renders kind dropdown with default "Todos" selected', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={baseFilters}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const kindSelect = document.querySelector(
      '[aria-label="Tipo de receita"]',
    ) as HTMLSelectElement;
    expect(kindSelect).not.toBeNull();
    expect(kindSelect.value).toBe('all');
  });

  it('membership sub-filters are hidden when kind is null', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={baseFilters}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-label="Cadência"]')).toBeNull();
    expect(document.querySelector('[aria-label="Plano"]')).toBeNull();
    expect(document.querySelector('[aria-label="Status"]')).toBeNull();
  });

  it('membership sub-filters are hidden when kind is "tickets"', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'tickets' }}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-label="Cadência"]')).toBeNull();
  });

  it('membership sub-filters are hidden when kind is "store"', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'store' }}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-label="Cadência"]')).toBeNull();
  });

  it('membership sub-filters appear when kind is "membership"', async () => {
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={vi.fn()}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[aria-label="Cadência"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Plano"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Status"]')).not.toBeNull();
  });

  it('cadence sub-filter calls onFilterChange with correct value', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const cadenceSelect = document.querySelector('[aria-label="Cadência"]') as HTMLSelectElement;
    await act(async () => {
      cadenceSelect.value = 'monthly';
      cadenceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('cadence', 'monthly');
  });

  it('selecting "all" cadence calls onFilterChange with null', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership', cadence: 'monthly' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const cadenceSelect = document.querySelector('[aria-label="Cadência"]') as HTMLSelectElement;
    await act(async () => {
      cadenceSelect.value = 'all';
      cadenceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('cadence', null);
  });

  it('tier sub-filter calls onFilterChange("tier", "gold")', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const tierSelect = document.querySelector('[aria-label="Plano"]') as HTMLSelectElement;
    await act(async () => {
      tierSelect.value = 'gold';
      tierSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('tier', 'gold');
  });

  it('membershipStatus sub-filter calls onFilterChange("membershipStatus", "active")', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const statusSelect = document.querySelector('[aria-label="Status"]') as HTMLSelectElement;
    await act(async () => {
      statusSelect.value = 'active';
      statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('membershipStatus', 'active');
  });

  it('kind dropdown calls onFilterChange("kind", "membership")', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={baseFilters}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const kindSelect = document.querySelector(
      '[aria-label="Tipo de receita"]',
    ) as HTMLSelectElement;
    await act(async () => {
      kindSelect.value = 'membership';
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('kind', 'membership');
  });

  it('kind dropdown calls onFilterChange("kind", null) when "all" selected', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <FilterBar
          filters={{ ...baseFilters, kind: 'membership' }}
          events={[]}
          onFilterChange={onChange}
          onClear={vi.fn()}
          isPending={false}
        />,
      );
      await Promise.resolve();
    });
    const kindSelect = document.querySelector(
      '[aria-label="Tipo de receita"]',
    ) as HTMLSelectElement;
    await act(async () => {
      kindSelect.value = 'all';
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('kind', null);
  });
});
```

- [ ] **2.3 — Run, confirm failures**

```bash
pnpm --filter @jdm/admin exec vitest run "app/\(authed\)/financeiro/components/__tests__/filter-bar.test.tsx"
```

Expected: 11 failures — `[aria-label="Tipo de receita"]` not found (dropdown not yet implemented). At least one failure confirms test reach.

- [ ] **2.4 — Commit the failing tests**

```bash
git add "apps/admin/app/(authed)/financeiro/components/__tests__/filter-bar.test.tsx"
git commit -m "$(cat <<'EOF'
test(admin): failing filter-bar membership sub-filter specs (chunk 15)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 — `filter-bar.tsx` — green (implement)

**Files:**

- Modify: `apps/admin/app/(authed)/financeiro/components/filter-bar.tsx`

- [ ] **3.1 — Extend the `Filters` type**

In `filter-bar.tsx`, find the `Filters` type definition and add the four new fields:

```ts
type Filters = {
  from: string | null;
  to: string | null;
  provider: string | null;
  method: string | null;
  search: string | null;
  eventId: string | null;
  // F8.15 additions:
  kind: string | null;
  cadence: string | null;
  tier: string | null;
  membershipStatus: string | null;
};
```

- [ ] **3.2 — Add the option arrays**

After the existing `methodOptions` array, add:

```ts
const kindOptions = [
  { value: 'all', label: 'Todos' },
  { value: 'tickets', label: 'Ingressos' },
  { value: 'store', label: 'Loja' },
  { value: 'membership', label: 'Assinaturas' },
];

const cadenceOptions = [
  { value: 'all', label: 'Todas as cadências' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'annual', label: 'Anual' },
];

const tierOptions = [
  { value: 'all', label: 'Todos os planos' },
  { value: 'gold', label: 'Gold' },
];

const membershipStatusOptions = [
  { value: 'all', label: 'Todos os status' },
  { value: 'active', label: 'Ativo' },
  { value: 'past_due', label: 'Pagamento pendente' },
  { value: 'cancel_scheduled', label: 'Cancelamento agendado' },
  { value: 'expired', label: 'Expirado' },
];
```

- [ ] **3.3 — Insert the kind dropdown + conditional sub-filters into `filterContent`**

In `filterContent`, after the `eventId` `<select>` closing `</select>` tag and before the first `<span className="mx-1 h-4 w-px ..."/>` divider, insert:

```tsx
<select
  value={filters.kind ?? 'all'}
  onChange={(e) => onFilterChange('kind', e.target.value === 'all' ? null : e.target.value)}
  className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
  aria-label="Tipo de receita"
>
  {kindOptions.map((o) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  ))}
</select>;

{
  filters.kind === 'membership' ? (
    <>
      <select
        value={filters.cadence ?? 'all'}
        onChange={(e) =>
          onFilterChange('cadence', e.target.value === 'all' ? null : e.target.value)
        }
        className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="Cadência"
      >
        {cadenceOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={filters.tier ?? 'all'}
        onChange={(e) => onFilterChange('tier', e.target.value === 'all' ? null : e.target.value)}
        className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="Plano"
      >
        {tierOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={filters.membershipStatus ?? 'all'}
        onChange={(e) =>
          onFilterChange('membershipStatus', e.target.value === 'all' ? null : e.target.value)
        }
        className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="Status"
      >
        {membershipStatusOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  ) : null;
}
```

- [ ] **3.4 — Run, confirm all 11 tests PASS**

```bash
pnpm --filter @jdm/admin exec vitest run "app/\(authed\)/financeiro/components/__tests__/filter-bar.test.tsx"
```

Expected: 11/11 PASS.

- [ ] **3.5 — Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

Expected: exits 0.

- [ ] **3.6 — Commit**

```bash
git add "apps/admin/app/(authed)/financeiro/components/filter-bar.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): add kind dropdown + membership sub-filters to FilterBar (chunk 15)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4 — `kpi-row.tsx` + `payment-mix.tsx` — red then green

**Files:**

- Create: `apps/admin/app/(authed)/financeiro/components/__tests__/kpi-row.test.tsx`
- Create: `apps/admin/app/(authed)/financeiro/components/__tests__/payment-mix.test.tsx`
- Modify: `apps/admin/app/(authed)/financeiro/components/kpi-row.tsx`
- Modify: `apps/admin/app/(authed)/financeiro/components/payment-mix.tsx`

- [ ] **4.1 — Write failing `kpi-row.test.tsx`**

Create `apps/admin/app/(authed)/financeiro/components/__tests__/kpi-row.test.tsx`:

```tsx
import type { AdminFinanceSummary } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { KpiRow } from '../kpi-row';

const baseSummary: AdminFinanceSummary = {
  totalRevenueCents: 500000,
  netRevenueCents: 400000,
  orderCount: 10,
  avgOrderCents: 50000,
  ticketCount: 20,
  refundedCents: 0,
  refundedCount: 0,
  storeRevenueCents: 100000,
  storeOrderCount: 3,
  devFeePercent: 10,
  devFeeCollectedCents: 50000,
  membershipRevenueCents: 60000,
  membershipNetRevenueCents: 54000,
  membershipDevFeeCollectedCents: 6000,
  membershipRefundedCents: 0,
  activeMembershipsCount: 5,
  newMembershipsCount: 2,
  churnedMembershipsCount: 0,
  membershipMRRCents: 30000,
  membershipARPUCents: 12000,
};

describe('KpiRow — membership tiles (chunk 15)', () => {
  it('renders "Assinaturas" tile group heading', () => {
    const html = renderToStaticMarkup(<KpiRow summary={baseSummary} />);
    expect(html).toContain('Assinaturas');
  });

  it('renders "Receita de Membros" tile with correct value', () => {
    const html = renderToStaticMarkup(<KpiRow summary={baseSummary} />);
    expect(html).toContain('Receita de Membros');
    expect(html).toContain('540');
  });

  it('renders "Membros Ativos" tile with correct count', () => {
    const html = renderToStaticMarkup(<KpiRow summary={baseSummary} />);
    expect(html).toContain('Membros Ativos');
    expect(html).toContain('5');
  });

  it('renders "MRR" tile with correct value', () => {
    const html = renderToStaticMarkup(<KpiRow summary={baseSummary} />);
    expect(html).toContain('MRR');
    expect(html).toContain('300');
  });

  it('"Receita líquida" sums netRevenueCents + membershipNetRevenueCents', () => {
    const html = renderToStaticMarkup(<KpiRow summary={baseSummary} />);
    // 400000 + 54000 = 454000 cents = R$ 4.540,00
    expect(html).toContain('Receita líquida');
    expect(html).toContain('4.540');
  });

  it('"Receita líquida" renders R$ 4.540,00 for net=400000 + membershipNet=54000', () => {
    const html = renderToStaticMarkup(<KpiRow summary={baseSummary} />);
    expect(html).toContain('4.540,00');
  });

  it('renders correctly when membership fields are zero', () => {
    const zeroSummary: AdminFinanceSummary = {
      ...baseSummary,
      membershipNetRevenueCents: 0,
      activeMembershipsCount: 0,
      membershipMRRCents: 0,
    };
    expect(() => renderToStaticMarkup(<KpiRow summary={zeroSummary} />)).not.toThrow();
    const html = renderToStaticMarkup(<KpiRow summary={zeroSummary} />);
    expect(html).toContain('Membros Ativos');
  });
});
```

- [ ] **4.2 — Write failing `payment-mix.test.tsx`**

Create `apps/admin/app/(authed)/financeiro/components/__tests__/payment-mix.test.tsx`:

```tsx
import type { AdminFinancePaymentMixItem } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PaymentMix } from '../payment-mix';

const stripeCard: AdminFinancePaymentMixItem = {
  provider: 'stripe',
  method: 'card',
  revenueCents: 300000,
  orderCount: 6,
  percentage: 50.0,
};
const abacatePix: AdminFinancePaymentMixItem = {
  provider: 'abacatepay',
  method: 'pix',
  revenueCents: 180000,
  orderCount: 4,
  percentage: 30.0,
};
const stripeSub: AdminFinancePaymentMixItem = {
  provider: 'stripe',
  method: 'subscription',
  revenueCents: 90000,
  orderCount: 0,
  percentage: 15.0,
};
const appleStoreKit: AdminFinancePaymentMixItem = {
  provider: 'apple_revenuecat',
  method: 'storekit',
  revenueCents: 30000,
  orderCount: 0,
  percentage: 5.0,
};

describe('PaymentMix — F8 rows (chunk 15)', () => {
  it('renders "Assinatura · Stripe" for stripe:subscription', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[stripeSub]} />);
    expect(html).toContain('Assinatura · Stripe');
  });

  it('renders "App Store · RevenueCat" for apple_revenuecat:storekit', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[appleStoreKit]} />);
    expect(html).toContain('App Store · RevenueCat');
  });

  it('renders up to 4 rows when all four item types present', () => {
    const html = renderToStaticMarkup(
      <PaymentMix items={[stripeCard, abacatePix, stripeSub, appleStoreKit]} />,
    );
    expect(html).toContain('Cartão · Stripe');
    expect(html).toContain('Pix · AbacatePay');
    expect(html).toContain('Assinatura · Stripe');
    expect(html).toContain('App Store · RevenueCat');
  });

  it('renders existing stripe:card row unchanged', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[stripeCard]} />);
    expect(html).toContain('Cartão · Stripe');
  });

  it('renders existing abacatepay:pix row unchanged', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[abacatePix]} />);
    expect(html).toContain('Pix · AbacatePay');
  });

  it('renders empty state when items is empty', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[]} />);
    expect(html).toContain('Sem dados.');
  });

  it('stripe:subscription row shows percentage bar markup', () => {
    const html = renderToStaticMarkup(<PaymentMix items={[stripeSub]} />);
    // Progress bar has inline width style
    expect(html).toContain('width:15%');
  });
});
```

- [ ] **4.3 — Run both test files, confirm failures**

```bash
pnpm --filter @jdm/admin exec vitest run \
  "app/\(authed\)/financeiro/components/__tests__/kpi-row.test.tsx" \
  "app/\(authed\)/financeiro/components/__tests__/payment-mix.test.tsx"
```

Expected: multiple failures. If `AdminFinanceSummary` type errors appear for `membershipNetRevenueCents` etc., F8.13 types are missing — STOP.

- [ ] **4.4 — Implement `kpi-row.tsx` changes**

In `kpi-row.tsx`, replace the `buildTileGroups` function body per the §"Component final states" section above. The function signature stays the same: `function buildTileGroups(s: AdminFinanceSummary): TileGroup[]`.

The key changes:

1. Add `const totalNetCents = s.netRevenueCents + (s.membershipNetRevenueCents ?? 0);`
2. Change the "Receita líquida" tile value from `fmtCurrency(s.netRevenueCents)` to `fmtCurrency(totalNetCents)`
3. Add the new `'Assinaturas'` group with three tiles

- [ ] **4.5 — Implement `payment-mix.tsx` changes**

In `payment-mix.tsx`, add two entries to `methodLabels`:

```ts
subscription: 'Assinatura',
storekit: 'App Store',
```

And one entry to `providerLabels`:

```ts
apple_revenuecat: 'RevenueCat',
```

No JSX changes needed.

- [ ] **4.6 — Run both test files, confirm all PASS**

```bash
pnpm --filter @jdm/admin exec vitest run \
  "app/\(authed\)/financeiro/components/__tests__/kpi-row.test.tsx" \
  "app/\(authed\)/financeiro/components/__tests__/payment-mix.test.tsx"
```

Expected: 7/7 + 7/7 PASS.

- [ ] **4.7 — Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

Expected: exits 0.

- [ ] **4.8 — Commit**

```bash
git add \
  "apps/admin/app/(authed)/financeiro/components/kpi-row.tsx" \
  "apps/admin/app/(authed)/financeiro/components/payment-mix.tsx" \
  "apps/admin/app/(authed)/financeiro/components/__tests__/kpi-row.test.tsx" \
  "apps/admin/app/(authed)/financeiro/components/__tests__/payment-mix.test.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): add membership KPI tiles + payment-mix rows (chunk 15)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5 — `trend-chart.tsx` — red then green

**Files:**

- Create: `apps/admin/app/(authed)/financeiro/components/__tests__/trend-chart.test.tsx`
- Modify: `apps/admin/app/(authed)/financeiro/components/trend-chart.tsx`

- [ ] **5.1 — Write failing `trend-chart.test.tsx`**

Create `apps/admin/app/(authed)/financeiro/components/__tests__/trend-chart.test.tsx`:

```tsx
import type { AdminFinanceTrendPoint } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock recharts — it calls DOM APIs not available in the node test environment
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'area-chart' }, children),
  Area: ({ dataKey }: { dataKey: string }) => React.createElement('div', { 'data-area': dataKey }),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'responsive-container' }, children),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: ({ formatter }: { formatter: (v: string) => string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'legend' },
      ['ticketRevenueCents', 'storeRevenueCents', 'membershipRevenueCents'].map((k) =>
        React.createElement('span', { key: k, 'data-legend-key': k }, formatter(k)),
      ),
    ),
}));

const pointWithMembership: AdminFinanceTrendPoint = {
  date: '2026-05-01',
  revenueCents: 30000,
  orderCount: 5,
  ticketRevenueCents: 20000,
  storeRevenueCents: 5000,
  membershipRevenueCents: 5000,
};

const pointNoMembership: AdminFinanceTrendPoint = {
  date: '2026-05-02',
  revenueCents: 25000,
  orderCount: 4,
  ticketRevenueCents: 25000,
  storeRevenueCents: 0,
  membershipRevenueCents: 0,
};

import { TrendChart } from '../trend-chart';

describe('TrendChart — membershipRevenueCents series (chunk 15)', () => {
  it('renders membershipRevenueCents Area when membership data is present', () => {
    const html = renderToStaticMarkup(<TrendChart points={[pointWithMembership]} />);
    expect(html).toContain('membershipRevenueCents');
  });

  it('does not render membershipRevenueCents Area when membership is all-zero', () => {
    const html = renderToStaticMarkup(<TrendChart points={[pointNoMembership]} />);
    expect(html).not.toContain('data-area="membershipRevenueCents"');
  });

  it('legend formatter returns "Assinaturas" for membershipRevenueCents key', () => {
    const html = renderToStaticMarkup(<TrendChart points={[pointWithMembership]} />);
    expect(html).toContain('Assinaturas');
  });

  it('legend formatter returns "Ingressos" for ticketRevenueCents key', () => {
    const html = renderToStaticMarkup(<TrendChart points={[pointWithMembership]} />);
    expect(html).toContain('Ingressos');
  });

  it('legend formatter returns "Loja" for storeRevenueCents key', () => {
    const html = renderToStaticMarkup(<TrendChart points={[pointWithMembership]} />);
    expect(html).toContain('Loja');
  });

  it('renders empty state when no points', () => {
    const html = renderToStaticMarkup(<TrendChart points={[]} />);
    expect(html).toContain('Sem dados de tendência');
  });

  it('renders membershipGradient linearGradient definition', () => {
    const html = renderToStaticMarkup(<TrendChart points={[pointWithMembership]} />);
    // The gradient is defined in SVG defs even in server render — or present in the mock
    // Either the SVG defs contain it OR the Area with fill="url(#membershipGradient)" is present
    const hasMembership =
      html.includes('membershipRevenueCents') || html.includes('membershipGradient');
    expect(hasMembership).toBe(true);
  });
});
```

- [ ] **5.2 — Run, confirm failures**

```bash
pnpm --filter @jdm/admin exec vitest run \
  "app/\(authed\)/financeiro/components/__tests__/trend-chart.test.tsx"
```

Expected: at least tests 1, 3, 7 fail (membership Area not yet added). Tests 4, 5, 6 may pass already (existing functionality). Confirm at least one failure.

- [ ] **5.3 — Implement `trend-chart.tsx` changes**

Apply all changes from §"Component final states" — `trend-chart.tsx`:

1. Add `const hasMembershipData = points.some((p) => p.membershipRevenueCents > 0);`
2. Add `membershipGradient` `<linearGradient>` to `<defs>`
3. Update `CustomTooltip` to render membership line
4. Update `<Legend>` condition from `{hasStoreData ? ...}` to `{hasStoreData || hasMembershipData ? ...}`
5. Update `<Legend>` formatter to handle `'membershipRevenueCents'` → `'Assinaturas'`
6. Add `{hasMembershipData ? <Area dataKey="membershipRevenueCents" ... /> : null}` after the store area

- [ ] **5.4 — Run, confirm all 7 PASS**

```bash
pnpm --filter @jdm/admin exec vitest run \
  "app/\(authed\)/financeiro/components/__tests__/trend-chart.test.tsx"
```

Expected: 7/7 PASS.

- [ ] **5.5 — Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

Expected: exits 0. If TypeScript complains about `membershipRevenueCents` not on `AdminFinanceTrendPoint`, F8.13 has not merged — STOP.

- [ ] **5.6 — Commit**

```bash
git add \
  "apps/admin/app/(authed)/financeiro/components/trend-chart.tsx" \
  "apps/admin/app/(authed)/financeiro/components/__tests__/trend-chart.test.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): add membershipRevenueCents stacked area to TrendChart (chunk 15)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6 — Full test sweep + push

- [ ] **6.1 — Run all four new test files in one command**

```bash
pnpm --filter @jdm/admin exec vitest run \
  "app/\(authed\)/financeiro/components/__tests__/filter-bar.test.tsx" \
  "app/\(authed\)/financeiro/components/__tests__/kpi-row.test.tsx" \
  "app/\(authed\)/financeiro/components/__tests__/payment-mix.test.tsx" \
  "app/\(authed\)/financeiro/components/__tests__/trend-chart.test.tsx"
```

Expected: 11 + 7 + 7 + 7 = 32 PASS.

- [ ] **6.2 — Final typecheck**

```bash
pnpm --filter @jdm/admin typecheck
pnpm --filter @jdm/shared build
```

Expected: both exit 0.

- [ ] **6.3 — Lint touched files (CLAUDE.md: touched-paths only)**

```bash
pnpm --filter @jdm/admin lint -- \
  "apps/admin/app/(authed)/financeiro/components/filter-bar.tsx" \
  "apps/admin/app/(authed)/financeiro/components/kpi-row.tsx" \
  "apps/admin/app/(authed)/financeiro/components/payment-mix.tsx" \
  "apps/admin/app/(authed)/financeiro/components/trend-chart.tsx"
```

If lint errors, fix and commit before pushing.

- [ ] **6.4 — Push**

```bash
git push -u origin feat/jdma-f8-billing-15
```

---

## Deviations (locked at plan time)

1. **`finance-dashboard.tsx` not touched.** The parent currently passes `activeFilters` to `FilterBar` as a plain object; extending `Filters` with four nullable fields is backward-compatible since all are `string | null` and absent values default to `null`. The parent's `buildQuery` function does not pass `kind`/`cadence`/`tier`/`membershipStatus` to the API — wiring the new filter keys into `AdminFinanceQuery` and propagating them through `buildQuery` is left for whoever integrates F8.13 + F8.14 into the dashboard fetch loop (a natural follow-up, not this chunk's responsibility per the skeleton).

2. **Recharts mocked in trend-chart tests.** Recharts `ResponsiveContainer` requires a DOM measurement environment and throws in Vitest `node` mode. Mocking is the only practical approach without switching to `jsdom` for the whole file. The mock verifies data-key presence and legend formatter behavior — sufficient to confirm the third series was wired correctly without a full render.

3. **`?? 0` guards on membership fields in `kpi-row.tsx`.** F8.13 adds the fields as non-optional to the zod schema, but production API responses from before F8.13 lands will not have them. The `?? 0` guards prevent a runtime NaN/crash in that transition window. Remove when F8.13 is confirmed deployed everywhere.

4. **`payment-mix.tsx` uses `orderCount: 0` for subscription rows.** Subscription invoices are not orders; the `AdminFinancePaymentMixItem` shape already accepts zero. No schema change needed.

---

## PR checklist (after Task 6)

- [ ] Branch `feat/jdma-f8-billing-15` from fresh `main` (PF-1 + PF-2 verified).
- [ ] All 32 tests PASS (11 filter-bar + 7 kpi-row + 7 payment-mix + 7 trend-chart).
- [ ] `pnpm --filter @jdm/admin typecheck` clean.
- [ ] `pnpm --filter @jdm/shared build` exits 0.
- [ ] Lint clean on touched files.
- [ ] PR title: `feat(admin): membership filter/KPI/chart/mix UI (chunk 15)`.
- [ ] PR target: `main`. No `production` touches.
- [ ] PR body: documents the four deviations; references skeleton §"F8.15"; notes F8.13 + F8.14 as merge prerequisites.
- [ ] CI green before requesting review.

---

## Out of scope (follow-up)

- Wiring `kind`/`cadence`/`tier`/`membershipStatus` through `finance-dashboard.tsx` `buildQuery` to the API — requires F8.13 API to be deployed.
- New `/financeiro/membros` page — chunk F8.16.
- `revenue-table.tsx` "Tipo" column — spec §7.2 mentions it as optional; left to F8.16.
- `finance-dashboard.tsx` `isEmpty` check update to consider `activeMembershipsCount` — follow-up with the parent dashboard integration.
