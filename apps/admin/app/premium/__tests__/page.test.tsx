/**
 * F8.17 — /premium page tests.
 *
 * Server component rendered via renderToStaticMarkup; apiFetch + readRole +
 * SubscribeButton mocked. Tests route apiFetch calls by path so Promise.all
 * ordering does not matter.
 */
import type { PremiumPricingResponse, PremiumStatus } from '@ccc/shared/premium';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readRoleMock, apiFetchMock } = vi.hoisted(() => ({
  readRoleMock: vi.fn<() => Promise<string | null>>(),
  apiFetchMock: vi.fn(),
}));

vi.mock('~/lib/auth-session', () => ({ readRole: readRoleMock }));
vi.mock('~/lib/api', () => ({
  apiFetch: apiFetchMock,
  ApiError: class ApiError extends Error {},
}));
vi.mock('../subscribe-button', () => ({
  SubscribeButton: ({ cadence }: { cadence: string }) =>
    React.createElement('button', { 'data-testid': `subscribe-${cadence}` }, 'Assinar'),
}));

import PremiumPage from '../page';

const pricing: PremiumPricingResponse = {
  monthly: {
    priceId: 'price_monthly_test',
    cadence: 'monthly',
    baseAmountCents: 2700,
    devFeePercent: 11,
    devFeeCents: 290,
    grossAmountCents: 2990,
    currency: 'BRL',
  },
  annual: {
    priceId: 'price_annual_test',
    cadence: 'annual',
    baseAmountCents: 25200,
    devFeePercent: 11,
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

const mockApiFetchByPath = (overrides: { pricing?: unknown; status?: unknown }) => {
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

describe('/premium page (F8.17)', () => {
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

  it('renders "CCC Gold" headline in the hero section', async () => {
    readRoleMock.mockResolvedValueOnce(null);
    mockApiFetchByPath({ pricing });
    const html = renderToStaticMarkup(await PremiumPage());
    expect(html).toContain('CCC Gold');
  });

  it('renders informational "Assine pelo aplicativo" copy (NOT a /login link) for unauthenticated visitor', async () => {
    readRoleMock.mockResolvedValueOnce(null);
    mockApiFetchByPath({ pricing });
    const html = renderToStaticMarkup(await PremiumPage());
    // Admin login rejects member roles + ignores ?next= so a /login redirect
    // would break the flow. Guest sees informational copy instead. Member-auth
    // on web is Phase F8.1 work.
    expect(html).toContain('Assine pelo aplicativo');
    expect(html).not.toContain('href="/login?next=/premium"');
    expect(html).toContain('data-testid="guest-cta-monthly"');
    expect(html).toContain('data-testid="guest-cta-annual"');
    expect(html).not.toContain('data-testid="subscribe-monthly"');
    const calls = apiFetchMock.mock.calls.map(([p]) => p as string);
    expect(calls).toContain('/api/premium/pricing');
    expect(calls.every((p) => !p.startsWith('/api/me/premium/status'))).toBe(true);
  });

  // Simulate apiFetch calling Next.js `redirect()` — which throws an Error
  // subclass with `digest: 'NEXT_REDIRECT;...'`. Helper class avoids the
  // `Object.assign` overload that typescript-eslint flags as `any`-assignment.
  class FakeNextRedirectError extends Error {
    digest: string;
    constructor(digest: string) {
      super('NEXT_REDIRECT');
      this.digest = digest;
    }
  }

  it('rethrows NEXT_REDIRECT from apiFetch so the framework can perform the redirect', async () => {
    readRoleMock.mockResolvedValueOnce('member');
    mockApiFetchByPath({
      pricing,
      status: new FakeNextRedirectError('NEXT_REDIRECT;replace;/login?reauth=1;303;'),
    });
    const caught: unknown = await PremiumPage().then(
      () => null,
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(Error);
    const digest = (caught as { digest?: unknown } | null)?.digest;
    expect(typeof digest).toBe('string');
    expect(String(digest)).toMatch(/^NEXT_REDIRECT/);
  });

  it('renders SubscribeButton for authed user not yet subscribed', async () => {
    readRoleMock.mockResolvedValueOnce('member');
    mockApiFetchByPath({ pricing, status: statusInactive });
    const html = renderToStaticMarkup(await PremiumPage());
    expect(html).toContain('data-testid="subscribe-monthly"');
    expect(html).toContain('data-testid="subscribe-annual"');
  });

  it('renders "Você já é membro" when status.active is true', async () => {
    readRoleMock.mockResolvedValueOnce('member');
    mockApiFetchByPath({ pricing, status: statusActive });
    const html = renderToStaticMarkup(await PremiumPage());
    expect(html).toContain('Você já é membro');
  });

  it('renders "Gerenciar" link to manageUrl when status.active is true', async () => {
    readRoleMock.mockResolvedValueOnce('member');
    mockApiFetchByPath({ pricing, status: statusActive });
    const html = renderToStaticMarkup(await PremiumPage());
    expect(html).toContain(`href="${statusActive.manageUrl}"`);
  });

  it('renders "Gerenciar" link to /me/billing when manageUrl is null', async () => {
    readRoleMock.mockResolvedValueOnce('member');
    mockApiFetchByPath({ pricing, status: { ...statusActive, manageUrl: null } });
    const html = renderToStaticMarkup(await PremiumPage());
    expect(html).toContain('href="/me/billing"');
  });

  it('renders maintenance message when pricing fetch throws (flag off / API down)', async () => {
    readRoleMock.mockResolvedValueOnce('member');
    mockApiFetchByPath({ pricing: new Error('503'), status: statusInactive });
    const html = renderToStaticMarkup(await PremiumPage());
    expect(html).toContain('temporariamente indisponíveis');
  });

  it('does NOT render devfee breakdown (no "taxa" / "net" / "receita líquida")', async () => {
    readRoleMock.mockResolvedValueOnce(null);
    mockApiFetchByPath({ pricing });
    const html = renderToStaticMarkup(await PremiumPage());
    expect(html).not.toMatch(/taxa|devfee|net.*revenue|receita.*líquida/i);
  });

  it('degrades to not-premium when authed status fetch throws but pricing succeeds', async () => {
    readRoleMock.mockResolvedValueOnce('member');
    mockApiFetchByPath({ pricing, status: new Error('503') });
    const html = renderToStaticMarkup(await PremiumPage());
    expect(html).toContain('R$ 29,90');
    expect(html).toContain('data-testid="subscribe-monthly"');
    expect(html).not.toContain('Você já é membro');
  });
});
