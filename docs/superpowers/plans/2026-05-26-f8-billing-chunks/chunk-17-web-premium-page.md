# F8.17 — Web `/premium` pricing + Stripe Checkout integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public `/premium` pricing page, the `subscribeAction` server action that mints a Stripe Checkout session, and the `/me/billing` page that opens the Stripe Billing Portal — all gated on the `GROWTH_PREMIUM_BILLING_ENABLED` flag (canon §F8.11).

**Architecture:** Three new files under `apps/admin/app/`: a public `premium/page.tsx` (NOT inside the `(authed)` route group so unauthenticated visitors can see it; auth is checked at CTA time), a `'use server'` `premium/actions.ts` (calls `POST /api/me/premium/checkout`, returns Stripe URL), and an `(authed)` `me/billing/page.tsx` (calls `POST /api/me/premium/billing-portal`, redirects immediately). Pricing values are fetched from the public `GET /api/premium/pricing` endpoint (shipped by chunk F8.20). Member status (when authed) is fetched in parallel from `GET /api/me/premium/status` (shipped by chunk F8.11). Tests live in `apps/admin/app/premium/__tests__/page.test.tsx` using `renderToStaticMarkup` (SSR components) and `vi.mock` (server actions + pricing fetch + status fetch).

> **PLAN-REWRITE NOTE (run 10 orchestrator):** Earlier drafts of this plan extended `GET /api/me/premium/status` with `?priceCatalog=true`. That approach was REJECTED. Chunk F8.20 already shipped a dedicated unauthed `GET /api/premium/pricing` route (PR #470, merged on `main`). All pricing fetches MUST hit `/api/premium/pricing` and parse `premiumPricingResponseSchema` from `@jdm/shared/premium`. The status endpoint stays auth-only with no `priceCatalog` field. See "Pricing endpoint" section below for the locked contract.

**Tech Stack:** Next.js App Router server components, `'use server'` actions, Vitest + `react-dom/server` (`renderToStaticMarkup`) for tests, existing `apiFetch` helper, `@jdm/shared/premium` zod types (populated by chunk F8.11), existing `garageTokens.brand.*` hex values from `@jdm/ui` (no unresolved CSS vars — per XPScoreboardWeb pattern), Anton font via `font-[Anton]` Tailwind utility.

---

## Pricing endpoint: locked contract

**Chosen:** the public unauthed `GET /api/premium/pricing` endpoint shipped by chunk F8.20. Response is exactly:

```ts
// from @jdm/shared/premium — premiumPricingResponseSchema
{
  monthly: {
    priceId: string;
    cadence: 'monthly';
    baseAmountCents: number;
    devFeePercent: number;
    devFeeCents: number;
    grossAmountCents: number;
    currency: string; // upper-cased, e.g. 'BRL'
  }
  annual: {
    priceId: string;
    cadence: 'annual';
    baseAmountCents: number;
    devFeePercent: number;
    devFeeCents: number;
    grossAmountCents: number;
    currency: string;
  }
}
```

**Failure modes (canon §F8.1 + F8.20 shipped behavior):**

- Feature flag off → 503 `ServiceUnavailable`.
- Stripe Price metadata missing/unparseable → 500 `PricingMetadataMissing`.
- API down → fetch throws.

In all three cases, the page renders the maintenance message (existing UX).

**Why a dedicated endpoint (not `?priceCatalog=true`)?** The chunk F8.20 design notes locked this in: an unauthed route lets the CDN cache the page for guest visitors AND lets authed users skip a redundant pricing roundtrip when only checkout/portal calls need fresh status. Endpoint is gated by `GROWTH_PREMIUM_BILLING_ENABLED` (canon §F8.11) like every other F8 route.

**Document the consumed contract** in a code comment at the top of `premium/page.tsx`: `// Pricing fetched from GET /api/premium/pricing (F8.20). Status fetched from GET /api/me/premium/status (F8.11) only when authed.`

---

## Required reading (before coding)

1. `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` — §1 (locked decisions), §8.2 (web subscribe flow), §13 canon §F8.1 + §F8.11.
2. `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` — §F8.17 entry + canon §F8.11 + §F8.12.
3. `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-11-premium-status-endpoint.md` — `premiumStatusSchema` shape (NO `priceCatalog`; that earlier idea was dropped).
   3a. `docs/superpowers/plans/2026-05-26-f8-billing-chunks/chunk-20-public-pricing-route.md` — `premiumPricingResponseSchema` shape + `GET /api/premium/pricing` contract.
4. `apps/admin/app/(authed)/layout.tsx` — authed route group layout (AuthedNav wrapping).
5. `apps/admin/src/lib/api.ts` — `apiFetch` signature + auth cookie pattern + `redirect('/login?reauth=1')` on stale session.
6. `apps/admin/src/lib/grant-actions.ts` — canonical `'use server'` action pattern.
7. `packages/ui/src/web/XPScoreboardWeb.tsx` — brand token inline pattern (`garageTokens.brand.*`).
8. `packages/ui/src/web/index.ts` — available web exports.
9. `apps/admin/AGENTS.md` — "This is NOT the Next.js you know." Read `node_modules/next/dist/docs/` for any API you're unsure about.

---

## Pre-flight checklist (before Task 1)

- [ ] **PF-1: Branch safety**

```bash
git branch --show-current
```

Must NOT be `production`. If it is, stop.

- [ ] **PF-2: Create branch from fresh `main`**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-17
```

- [ ] **PF-3: Confirm upstream chunks F8.09 + F8.11 + F8.20 are merged**

```bash
grep -n "checkout\|billing-portal" \
  apps/api/src/routes/me-premium.ts 2>/dev/null | head -20
grep -n "premiumPricingResponseSchema\|premiumStatusSchema" \
  packages/shared/src/premium.ts 2>/dev/null | head -10
ls apps/api/src/routes/premium-pricing.ts 2>/dev/null
```

Expected: `checkout` + `billing-portal` route entries; both `premiumStatusSchema` AND `premiumPricingResponseSchema` exported from `@jdm/shared/premium`; `premium-pricing.ts` route file exists. If any is missing, the upstream chunks (F8.09 / F8.11 / F8.20) have not landed — STOP.

- [ ] **PF-3a: Confirm `@jdm/shared` dist contains pricing exports**

```bash
grep -c "premiumPricingResponseSchema" packages/shared/dist/premium.js
```

Expected: `>= 1`. If `0`, rebuild: `pnpm --filter @jdm/shared build` (canon §F8.13).

- [ ] **PF-4: Confirm `GROWTH_PREMIUM_BILLING_ENABLED` is in the API env schema**

```bash
grep "GROWTH_PREMIUM_BILLING_ENABLED" apps/api/src/env.ts
```

Expected: appears with `z.coerce.boolean().default(false)`. If missing, chunk F8.01 has not landed — STOP.

---

## Files touched

| Path                                             | Action                   | Responsibility                                                                                                                   |
| ------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/app/premium/page.tsx`                | Create                   | Public pricing page. Hero + two pricing cards (monthly + annual gross). Auth-gated CTA.                                          |
| `apps/admin/app/premium/actions.ts`              | Create                   | `'use server'` — `subscribeAction(cadence)` calls `POST /api/me/premium/checkout`, returns Stripe URL or throws.                 |
| `apps/admin/app/me/billing/page.tsx`             | Create                   | Authed server component. Calls `POST /api/me/premium/billing-portal` and redirects to the returned URL.                          |
| `apps/admin/app/premium/__tests__/page.test.tsx` | Create                   | 10 vitest specs covering render, auth gate, already-premium, CTA wiring, flag-disabled state.                                    |
| `packages/shared/src/premium.ts`                 | Depends on F8.11 + F8.20 | `premiumStatusSchema` (F8.11) AND `premiumPricingResponseSchema` (F8.20) must exist. This chunk does NOT modify it — reads only. |

**Do NOT touch:** `apps/api/`, `packages/db/`, any mobile file, `apps/admin/app/(authed)/layout.tsx`, any existing component outside the new files above.

---

## Code shape (final state — reference, not copy-paste)

### `apps/admin/app/premium/actions.ts`

```ts
'use server';

import type { PremiumCadence } from '@jdm/shared/premium';
import { z } from 'zod';

import { apiFetch } from '~/lib/api';

const checkoutResponseSchema = z.object({ url: z.string().url() });

/**
 * Mints a Stripe Checkout session for the given cadence.
 * Returns the hosted Checkout URL to redirect the browser to.
 * Throws ApiError on failure (caller must handle).
 *
 * Feature flag: if GROWTH_PREMIUM_BILLING_ENABLED is off the API returns 503;
 * apiFetch throws ApiError(503, ...) — let it propagate.
 */
export async function subscribeAction(cadence: PremiumCadence): Promise<string> {
  const data = await apiFetch('/api/me/premium/checkout', {
    method: 'POST',
    body: JSON.stringify({ cadence }),
    schema: checkoutResponseSchema,
  });
  return data.url;
}
```

### `apps/admin/app/premium/page.tsx`

```tsx
/**
 * /premium — public pricing page for JDM Gold membership.
 *
 * NOT inside the (authed) route group so unauthenticated visitors can browse.
 * Auth is checked at CTA time: unauthenticated → redirect to /login?next=/premium;
 * authed + already-premium → shows "Você já é membro" + manage link;
 * authed + not-premium → subscribe button triggers subscribeAction server action.
 *
 * Pricing fetched from GET /api/premium/pricing (F8.20, unauthed).
 * Status fetched from GET /api/me/premium/status (F8.11, authed) only when authed.
 * Both endpoints gate on GROWTH_PREMIUM_BILLING_ENABLED — flag-off → 503 → maintenance UI.
 *
 * Gross prices only — no devfee breakdown per canon §F8.1 user-facing rule.
 */

import { garageTokens } from '@jdm/ui/web';
import {
  premiumPricingResponseSchema,
  premiumStatusSchema,
  type PremiumPricingResponse,
  type PremiumStatus,
} from '@jdm/shared/premium';

import { readRole } from '~/lib/auth-session';
import { apiFetch } from '~/lib/api';

import { SubscribeButton } from './subscribe-button';

export default async function PremiumPage() {
  const role = await readRole();
  const isAuthed = role !== null;

  // Fetch pricing (always, unauthed) and status (only when authed) in parallel.
  // Pricing failure = maintenance UI. Status failure for authed users degrades to
  // "treat as not-yet-premium" — still show pricing + subscribe CTA. This keeps the
  // page usable when the user is mid-checkout but the status endpoint is briefly down.
  const [pricing, status] = await Promise.all([
    fetchPricing(),
    isAuthed ? fetchStatus() : Promise.resolve(null),
  ]);

  if (pricing === null) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center p-6">
        <p className="text-muted text-sm text-center">
          Assinaturas temporariamente indisponíveis. Tente novamente em breve.
        </p>
      </main>
    );
  }

  const { monthly, annual } = pricing;
  const isAlreadyPremium = status?.active === true;
  const manageUrl = status?.manageUrl ?? '/me/billing';

  return (
    <main className="min-h-screen bg-bg">
      {/* Hero */}
      <section
        className="px-6 pt-14 pb-10 text-center relative overflow-hidden"
        style={{
          background: `linear-gradient(180deg, ${garageTokens.brand.deep} 0%, #0b0b0f 100%)`,
        }}
      >
        <h1
          className="font-[Anton] text-[52px] leading-none text-fg tracking-tight"
          style={{ textShadow: '0 0 40px rgba(225,6,0,0.3)' }}
        >
          JDM Gold
        </h1>
        <p className="mt-3 text-muted text-sm max-w-xs mx-auto">
          Acesso premium ao melhor da comunidade JDM Experience.
        </p>
      </section>

      {/* Pricing cards */}
      <section className="px-4 mt-6 flex flex-col gap-4 max-w-sm mx-auto">
        <PricingCard
          cadence="monthly"
          grossAmountCents={monthly.grossAmountCents}
          currency={monthly.currency}
          label="Mensal"
          sublabel="Cancele quando quiser"
          isAuthed={isAuthed}
          isAlreadyPremium={isAlreadyPremium}
          manageUrl={manageUrl}
        />
        <PricingCard
          cadence="annual"
          grossAmountCents={annual.grossAmountCents}
          currency={annual.currency}
          label="Anual"
          sublabel="Melhor custo-benefício"
          isAuthed={isAuthed}
          isAlreadyPremium={isAlreadyPremium}
          manageUrl={manageUrl}
          highlighted
        />
      </section>
    </main>
  );
}

async function fetchPricing(): Promise<PremiumPricingResponse | null> {
  try {
    return await apiFetch('/api/premium/pricing', {
      schema: premiumPricingResponseSchema,
      auth: false,
    });
  } catch {
    return null; // flag off, Stripe metadata bad, or API down → maintenance UI.
  }
}

async function fetchStatus(): Promise<PremiumStatus | null> {
  try {
    return await apiFetch('/api/me/premium/status', {
      schema: premiumStatusSchema,
      auth: true,
    });
  } catch {
    return null; // flag off or transient — degrade to "treat as not-premium".
  }
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

type PricingCardProps = {
  cadence: 'monthly' | 'annual';
  grossAmountCents: number;
  currency: string;
  label: string;
  sublabel: string;
  isAuthed: boolean;
  isAlreadyPremium: boolean;
  manageUrl: string;
  highlighted?: boolean;
};

function PricingCard({
  cadence,
  grossAmountCents,
  label,
  sublabel,
  isAuthed,
  isAlreadyPremium,
  manageUrl,
  highlighted,
}: PricingCardProps) {
  const priceStr = formatBrl(grossAmountCents);
  const suffix = cadence === 'monthly' ? '/mês' : '/ano';

  return (
    <div
      className="rounded-2xl border p-5"
      style={{
        borderColor: highlighted ? garageTokens.brand.base : 'var(--color-border)',
        background: 'var(--color-surface)',
        boxShadow: highlighted ? `0 0 20px ${garageTokens.brand.soft}40` : undefined,
      }}
    >
      <div className="flex items-baseline gap-1">
        <span className="font-[Anton] text-[32px] leading-none text-fg">{priceStr}</span>
        <span className="text-muted text-sm font-mono">{suffix}</span>
      </div>
      <p className="mt-1 text-[13px] font-bold text-fg">{label}</p>
      <p className="text-muted text-xs mt-0.5">{sublabel}</p>

      {/* CTA block */}
      <div className="mt-4">
        {isAlreadyPremium ? (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-fg text-center">Você já é membro</p>
            <a
              href={manageUrl}
              className="block text-center rounded-xl py-2.5 text-sm font-semibold border"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-fg)',
              }}
            >
              Gerenciar
            </a>
          </div>
        ) : isAuthed ? (
          <SubscribeButton cadence={cadence} />
        ) : (
          <a
            href={`/login?next=/premium`}
            className="block text-center rounded-xl py-2.5 text-sm font-semibold"
            style={{
              background: garageTokens.brand.base,
              color: '#fff',
            }}
          >
            Assinar
          </a>
        )}
      </div>
    </div>
  );
}
```

**Note:** `SubscribeButton` is a small `'use client'` component that calls `subscribeAction` and does `window.location.href = url`. It lives co-located at `apps/admin/app/premium/subscribe-button.tsx` (created in Task 3 below).

### `apps/admin/app/premium/subscribe-button.tsx`

```tsx
'use client';

import { useTransition } from 'react';

import { subscribeAction } from './actions';

export function SubscribeButton({ cadence }: { cadence: 'monthly' | 'annual' }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          try {
            const url = await subscribeAction(cadence);
            window.location.href = url;
          } catch {
            // TODO: surface toast on error in Phase F8.1
          }
        });
      }}
      className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
      style={{ background: '#e10600', color: '#fff' }}
    >
      {isPending ? 'Aguarde...' : 'Assinar'}
    </button>
  );
}
```

### `apps/admin/app/me/billing/page.tsx`

```tsx
/**
 * /me/billing — opens the Stripe Billing Portal immediately.
 *
 * Server component: calls POST /api/me/premium/billing-portal to obtain
 * a time-limited Stripe portal URL, then redirects the browser.
 * Lives inside the (authed) route group? No — redirect to (authed) not needed
 * because apiFetch handles the 401→/login?reauth=1 redirect automatically.
 */

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { apiFetch } from '~/lib/api';

const portalResponseSchema = z.object({ url: z.string().url() });

export default async function MeBillingPage() {
  let url: string;
  try {
    const data = await apiFetch('/api/me/premium/billing-portal', {
      method: 'POST',
      body: JSON.stringify({}),
      schema: portalResponseSchema,
    });
    url = data.url;
  } catch {
    // Unauthenticated (apiFetch redirects to /login already) or API down.
    redirect('/premium');
  }
  redirect(url);
}
```

### `packages/shared/src/premium.ts` — read-only

This chunk does NOT modify the shared schema file. Both `premiumStatusSchema` (F8.11) and `premiumPricingResponseSchema` (F8.20) already exist on `main`. Import both directly:

```ts
import {
  premiumPricingResponseSchema,
  premiumStatusSchema,
  type PremiumPricingResponse,
  type PremiumStatus,
} from '@jdm/shared/premium';
```

If `pnpm --filter @jdm/admin typecheck` reports either import as missing, the `@jdm/shared` dist is stale — rebuild with `pnpm --filter @jdm/shared build` (canon §F8.13). Do NOT compose anything locally.

---

## Test plan

All tests use `renderToStaticMarkup` from `react-dom/server` for server-component assertions and `vi.mock` for `apiFetch`. No Testcontainers (no DB needed for UI tests).

### `apps/admin/app/premium/__tests__/page.test.tsx` — 10 specs

**Test fixtures:**

```ts
import type { PremiumPricingResponse, PremiumStatus } from '@jdm/shared/premium';

const pricing: PremiumPricingResponse = {
  monthly: {
    priceId: 'price_monthly_test',
    cadence: 'monthly',
    baseAmountCents: 2700,
    devFeePercent: 10.74,
    devFeeCents: 290,
    grossAmountCents: 2990,
    currency: 'BRL',
  },
  annual: {
    priceId: 'price_annual_test',
    cadence: 'annual',
    baseAmountCents: 25200,
    devFeePercent: 10.71,
    devFeeCents: 2700,
    grossAmountCents: 27900,
    currency: 'BRL',
  },
};

const statusInactive: PremiumStatus = {
  active: false,
  tier: null,
  cadence: null,
  provider: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  manageUrl: null,
};

const statusActive: PremiumStatus = {
  active: true,
  tier: 'gold',
  cadence: 'monthly',
  provider: 'stripe',
  currentPeriodEnd: '2026-06-26T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  manageUrl: 'https://billing.stripe.com/p/session/test-xxx',
};
```

> **NOTE on `apiFetch` mock setup:** the page calls `apiFetch('/api/premium/pricing', ...)` AND (when authed) `apiFetch('/api/me/premium/status', ...)`. Mock by URL using `mockImplementation` keyed on the path arg, NOT positional `mockResolvedValueOnce` chains (which break when `Promise.all` order is unstable). See the canonical mock setup below — applied to every test.

**Mocks (top of file):**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const { readRoleMock, apiFetchMock } = vi.hoisted(() => ({
  readRoleMock: vi.fn<[], Promise<string | null>>(),
  apiFetchMock: vi.fn(),
}));

vi.mock('~/lib/auth-session', () => ({ readRole: readRoleMock }));
vi.mock('~/lib/api', () => ({ apiFetch: apiFetchMock, ApiError: class ApiError extends Error {} }));
// SubscribeButton is client — stub it so renderToStaticMarkup works in Node
vi.mock('../subscribe-button', () => ({
  SubscribeButton: ({ cadence }: { cadence: string }) =>
    React.createElement('button', { 'data-testid': `subscribe-${cadence}` }, 'Assinar'),
}));

import PremiumPage from '../page';

// Helper: route apiFetch calls by path so Promise.all ordering doesn't matter.
const mockApiFetchByPath = (overrides: { pricing?: unknown | Error; status?: unknown | Error }) => {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === '/api/premium/pricing') {
      if (overrides.pricing instanceof Error) return Promise.reject(overrides.pricing);
      return Promise.resolve(overrides.pricing);
    }
    if (path.startsWith('/api/me/premium/status')) {
      if (overrides.status instanceof Error) return Promise.reject(overrides.status);
      return Promise.resolve(overrides.status);
    }
    return Promise.reject(new Error(`unexpected apiFetch path: ${path}`));
  });
};

beforeEach(() => {
  readRoleMock.mockReset();
  apiFetchMock.mockReset();
});
```

| #   | Test name                                                                                  | Intent                                                                                  |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 1   | `renders monthly + annual pricing cards with gross amounts`                                | Happy path: card titles "Mensal" and "Anual"; `R$ 29,90` + `R$ 279,00` present in HTML. |
| 2   | `renders "JDM Gold" headline in the hero section`                                          | Brand headline present.                                                                 |
| 3   | `renders "Assinar" link to /login?next=/premium for unauthenticated visitor`               | CTA links to sign-in for guest; status NOT fetched.                                     |
| 4   | `renders SubscribeButton for authed user not yet subscribed`                               | `data-testid="subscribe-monthly"` + `"subscribe-annual"` present.                       |
| 5   | `renders "Você já é membro" when status.active is true`                                    | Already-premium state.                                                                  |
| 6   | `renders "Gerenciar" link to manageUrl when status.active is true`                         | `href` equals `status.manageUrl`.                                                       |
| 7   | `renders "Gerenciar" link to /me/billing when manageUrl is null but status.active is true` | Fallback manage URL.                                                                    |
| 8   | `renders maintenance message when pricing fetch throws (flag off / API down)`              | 503/flag-off state — pricing failure → maintenance UI.                                  |
| 9   | `does NOT render devfee breakdown (no "taxa" or "net" text)`                               | Canon §F8.1 user-facing gross only.                                                     |
| 10  | `degrades to not-premium when authed status fetch throws but pricing succeeds`             | Status transient failure does NOT block subscribe flow.                                 |

**Representative assertions:**

```ts
// Test 1
it('renders monthly + annual pricing cards with gross amounts', async () => {
  readRoleMock.mockResolvedValueOnce('member');
  mockApiFetchByPath({ pricing, status: statusInactive });
  const html = renderToStaticMarkup(await PremiumPage());
  expect(html).toContain('R$ 29,90');
  expect(html).toContain('/mês');
  expect(html).toContain('R$ 279,00');
  expect(html).toContain('/ano');
  expect(html).toContain('Mensal');
  expect(html).toContain('Anual');
});

// Test 2
it('renders "JDM Gold" headline in the hero section', async () => {
  readRoleMock.mockResolvedValueOnce(null);
  mockApiFetchByPath({ pricing });
  const html = renderToStaticMarkup(await PremiumPage());
  expect(html).toContain('JDM Gold');
});

// Test 3 — guest does NOT fetch status
it('renders "Assinar" link to /login?next=/premium for unauthenticated visitor', async () => {
  readRoleMock.mockResolvedValueOnce(null);
  mockApiFetchByPath({ pricing });
  const html = renderToStaticMarkup(await PremiumPage());
  expect(html).toContain('href="/login?next=/premium"');
  expect(html).not.toContain('data-testid="subscribe-monthly"');
  const calls = apiFetchMock.mock.calls.map(([p]) => p as string);
  expect(calls).toContain('/api/premium/pricing');
  expect(calls.every((p) => !p.startsWith('/api/me/premium/status'))).toBe(true);
});

// Test 4
it('renders SubscribeButton for authed user not yet subscribed', async () => {
  readRoleMock.mockResolvedValueOnce('member');
  mockApiFetchByPath({ pricing, status: statusInactive });
  const html = renderToStaticMarkup(await PremiumPage());
  expect(html).toContain('data-testid="subscribe-monthly"');
  expect(html).toContain('data-testid="subscribe-annual"');
});

// Test 5 + 6
it('renders "Você já é membro" + Gerenciar when status.active is true', async () => {
  readRoleMock.mockResolvedValueOnce('member');
  mockApiFetchByPath({ pricing, status: statusActive });
  const html = renderToStaticMarkup(await PremiumPage());
  expect(html).toContain('Você já é membro');
  expect(html).toContain(`href="${statusActive.manageUrl}"`);
});

// Test 7 — null manageUrl falls back to /me/billing
it('renders Gerenciar link to /me/billing when manageUrl is null', async () => {
  readRoleMock.mockResolvedValueOnce('member');
  mockApiFetchByPath({ pricing, status: { ...statusActive, manageUrl: null } });
  const html = renderToStaticMarkup(await PremiumPage());
  expect(html).toContain('href="/me/billing"');
});

// Test 8 — pricing failure → maintenance UI
it('renders maintenance message when pricing fetch throws', async () => {
  readRoleMock.mockResolvedValueOnce('member');
  mockApiFetchByPath({ pricing: new Error('503'), status: statusInactive });
  const html = renderToStaticMarkup(await PremiumPage());
  expect(html).toContain('temporariamente indisponíveis');
});

// Test 9 — canon §F8.1 no devfee on customer surfaces
it('does not render devfee breakdown', async () => {
  readRoleMock.mockResolvedValueOnce(null);
  mockApiFetchByPath({ pricing });
  const html = renderToStaticMarkup(await PremiumPage());
  expect(html).not.toMatch(/taxa|devfee|net.*revenue|receita.*líquida/i);
});

// Test 10 — status fetch transient failure does NOT block subscribe flow
it('degrades to not-premium when authed status fetch throws but pricing succeeds', async () => {
  readRoleMock.mockResolvedValueOnce('member');
  mockApiFetchByPath({ pricing, status: new Error('503') });
  const html = renderToStaticMarkup(await PremiumPage());
  expect(html).toContain('R$ 29,90');
  expect(html).toContain('data-testid="subscribe-monthly"');
  expect(html).not.toContain('Você já é membro');
});
```

**Verification command:**

```bash
pnpm --filter @jdm/admin exec vitest run app/premium/__tests__/page.test.tsx
```

---

## Task decomposition

Five tasks, ~90 min total. Each ends with a commit.

### Task 1 — Write the failing tests (red)

**Files:** `apps/admin/app/premium/__tests__/page.test.tsx` (new).

- [ ] **1.1 — Create the test directory**

```bash
mkdir -p apps/admin/app/premium/__tests__
```

- [ ] **1.2 — Write the test file** with all 10 specs from the test plan above. Use the exact mock setup, fixtures, and assertion snippets provided.

- [ ] **1.3 — Run to confirm failure**

```bash
pnpm --filter @jdm/admin exec vitest run app/premium/__tests__/page.test.tsx
```

Expected: "Cannot find module '../page'" or "Failed to resolve import". That is the red signal.

- [ ] **1.4 — Commit the failing tests**

```bash
git add apps/admin/app/premium/__tests__/page.test.tsx
git commit -m "test(admin): failing F8.17 premium page specs"
```

---

### Task 2 — Create `premium/actions.ts` (server action)

**Files:** `apps/admin/app/premium/actions.ts` (new).

- [ ] **2.1 — Write `actions.ts`** per the code shape above.

- [ ] **2.2 — Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

If `PremiumCadence` is missing from `@jdm/shared/premium`, define a local fallback type and document the deviation:

```ts
type PremiumCadence = 'monthly' | 'annual';
```

- [ ] **2.3 — Commit**

```bash
git add apps/admin/app/premium/actions.ts
git commit -m "feat(admin): subscribeAction server action (F8.17)"
```

---

### Task 3 — Create `premium/subscribe-button.tsx` (client stub for tests)

**Files:** `apps/admin/app/premium/subscribe-button.tsx` (new).

- [ ] **3.1 — Write `subscribe-button.tsx`** per the code shape above.

- [ ] **3.2 — Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

- [ ] **3.3 — Commit**

```bash
git add apps/admin/app/premium/subscribe-button.tsx
git commit -m "feat(admin): SubscribeButton client component (F8.17)"
```

---

### Task 4 — Create `premium/page.tsx` + `me/billing/page.tsx` (green)

**Files:** `apps/admin/app/premium/page.tsx` (new), `apps/admin/app/me/billing/page.tsx` (new).

- [ ] **4.1 — Create the `me/billing` directory**

```bash
mkdir -p apps/admin/app/me/billing
```

- [ ] **4.2 — Confirm both required exports land in `@jdm/shared/premium`**

```bash
grep -n "premiumPricingResponseSchema\|premiumStatusSchema" packages/shared/src/premium.ts | head -10
```

Both names must appear (F8.20 + F8.11). If either is missing, the upstream chunk has not landed — STOP. Do NOT compose anything locally.

- [ ] **4.3 — Write `premium/page.tsx`** per the code shape above. Import `premiumPricingResponseSchema`, `premiumStatusSchema`, `PremiumPricingResponse`, `PremiumStatus` from `@jdm/shared/premium` directly.

- [ ] **4.4 — Write `me/billing/page.tsx`** per the code shape above.

- [ ] **4.5 — Run the tests (expect green)**

```bash
pnpm --filter @jdm/admin exec vitest run app/premium/__tests__/page.test.tsx
```

Expected: all 10 specs PASS.

- [ ] **4.6 — Typecheck**

```bash
pnpm --filter @jdm/admin typecheck
```

Fix any TypeScript errors. Common: `readRole` return type mismatch (it returns `string | null`; the `isAuthed` boolean cast is `role !== null`). If `garageTokens` is not importable from `@jdm/ui/web`, check `packages/ui/src/web/index.ts` — it already exports `garageTokens` as of chunk 41.

- [ ] **4.7 — Commit**

```bash
git add apps/admin/app/premium/page.tsx apps/admin/app/me/billing/page.tsx
git commit -m "feat(admin): /premium pricing page + /me/billing portal redirect (F8.17)"
```

---

### Task 5 — Verification + lint sweep

- [ ] **5.1 — Confirm all 10 tests PASS**

```bash
pnpm --filter @jdm/admin exec vitest run app/premium/__tests__/page.test.tsx
```

Expected output: `10 passed`.

- [ ] **5.2 — Typecheck clean**

```bash
pnpm --filter @jdm/admin typecheck
```

- [ ] **5.3 — Lint touched files only**

```bash
pnpm --filter @jdm/admin lint -- \
  apps/admin/app/premium/page.tsx \
  apps/admin/app/premium/actions.ts \
  apps/admin/app/premium/subscribe-button.tsx \
  apps/admin/app/me/billing/page.tsx \
  apps/admin/app/premium/__tests__/page.test.tsx
```

Fix lint errors in a separate commit if needed.

- [ ] **5.4 — Confirm feature flag guard: flag-off test (spec #8 already covers it via apiFetch throw, but verify the 503 path manually via the mock)**

Spec #8 already asserts this. If it passed in 5.1, this is confirmed.

- [ ] **5.5 — Push the branch**

```bash
git push -u origin feat/jdma-f8-billing-17
```

---

## Deviations (lock at plan time, document in PR body)

1. **Pricing via the dedicated unauthed `GET /api/premium/pricing` endpoint (F8.20), NOT `?priceCatalog=true`.** Earlier plan drafts proposed extending the status endpoint with a `?priceCatalog=true` query param; that approach was rejected during run 9 in favor of the standalone route shipped by chunk F8.20. The current plan consumes `premiumPricingResponseSchema` from `@jdm/shared/premium` and fetches pricing separately from status. Status is only fetched when the visitor is authed. Documented at the top of `premium/page.tsx`.

2. **`SubscribeButton` is a co-located `'use client'` component** (`premium/subscribe-button.tsx`). The pricing page itself is a server component; the subscribe button cannot be — it calls a server action on user interaction and updates `window.location.href`. Splitting avoids making the whole page a client component. Tests stub it with `vi.mock('../subscribe-button', ...)`.

3. **`me/billing/page.tsx` is NOT inside the `(authed)` group.** The `apiFetch` helper automatically redirects to `/login?reauth=1` on a 401 (see `apps/admin/src/lib/api.ts` line 63). Adding the page inside `(authed)` would also work but requires the authed layout + nav to render before the redirect — unnecessary for a page that only exists to redirect. Outside `(authed)`, the layout is the bare root layout. The user experiences a clean redirect to the Stripe portal.

4. **`garageTokens.brand.*` hex values used for gradients** (not CSS vars). Mirrors the `XPScoreboardWeb.tsx` pattern per admin `globals.css` which only defines `--color-*` tokens, not `--brand-*`. Verified in `packages/ui/src/web/XPScoreboardWeb.tsx` lines 7–9 and the `profile-stats-web.test.tsx` assertion on line 118 that forbids unresolved `--brand-*` CSS vars.

5. **No `/me/billing` button rendered on the premium page for already-premium users.** The "Gerenciar" link uses `status.manageUrl` (Stripe-hosted portal URL) directly, or falls back to `/me/billing` if `manageUrl` is null. This avoids a double-redirect. `status.manageUrl` is pre-populated by the API (chunk F8.09/F8.11) with a pre-generated Stripe portal session URL.

---

## PR checklist (after Task 5)

- [ ] Branch `feat/jdma-f8-billing-17` from fresh `main` (PF-1 + PF-2 verified).
- [ ] All 10 specs in `app/premium/__tests__/page.test.tsx` PASS.
- [ ] `pnpm --filter @jdm/admin typecheck` clean.
- [ ] Lint clean on touched files.
- [ ] Feature-flag-off state renders maintenance message (spec #8 covers it).
- [ ] No devfee text on pricing cards (spec #9 + canon §F8.1 user-facing).
- [ ] PR body documents deviations 1–5 above.
- [ ] PR title: `feat(admin): web /premium pricing + Stripe Checkout integration (F8.17)`.
- [ ] PR target: `main`. No `production` touches anywhere.
- [ ] Cross-references: skeleton §F8.17, spec §8.2, canon §F8.1 + §F8.11.

---

## Out of scope (Phase F8.1 / post-launch)

- Animated hero entrance or "Welcome to Gold" splash — spec §10.
- Toast/error UI in `SubscribeButton` on failed `subscribeAction` — the `catch` block is a silent no-op in v1 (a TODO comment is left in place).
- Annual vs monthly savings badge ("Economize 22%") — not in spec §8.2 v1.
- `/me/billing` full page with invoices list — portal redirect is the v1 surface.
- Promo code input on the pricing page — out of v1 scope per spec §10.
- Android Stripe WebBrowser integration — owned by chunk F8.18 (mobile).
