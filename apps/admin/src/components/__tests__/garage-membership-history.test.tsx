import type { AdminFinanceMembershipsItem } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement('a', { href, ...rest }, children),
}));

vi.mock('~/lib/finance-actions', () => ({
  fetchFinanceMemberships: vi.fn(),
}));

import { GarageMembershipHistory } from '../garage-membership-history';

import { fetchFinanceMemberships } from '~/lib/finance-actions';

const memberships: AdminFinanceMembershipsItem[] = [
  {
    membershipId: 'mem-a',
    garageSlug: 'garage-slug-x',
    userName: 'Beltrano',
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
    garageSlug: 'garage-slug-x',
    userName: 'Beltrano',
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

describe('GarageMembershipHistory', () => {
  it('renders membership rows for the garage', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: memberships,
      page: 1,
      pageSize: 25,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    expect(html).toContain('data-testid="membership-row-mem-a"');
  });

  it('renders status badge with PT-BR label "Ativo"', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: memberships,
      page: 1,
      pageSize: 25,
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
      pageSize: 25,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    expect(html).toContain('Apple / RC');
  });

  it('renders provider label "Stripe" for stripe row', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: memberships,
      page: 1,
      pageSize: 25,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    expect(html).toContain('Stripe');
  });

  it('renders empty state when no memberships are returned', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    expect(html).toContain('data-testid="garage-membership-empty"');
    expect(html).toContain('Sem assinaturas registradas.');
  });

  it('renders both rows sorted live-first then expired', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: [...memberships].reverse(), // expired first in mock to verify sort
      page: 1,
      pageSize: 25,
      total: 2,
    });
    const html = renderToStaticMarkup(await GarageMembershipHistory({ garageId: 'garage-x' }));
    const idxActive = html.indexOf('membership-row-mem-a');
    const idxExpired = html.indexOf('membership-row-mem-b');
    expect(idxActive).toBeGreaterThanOrEqual(0);
    expect(idxExpired).toBeGreaterThanOrEqual(0);
    expect(idxActive).toBeLessThan(idxExpired);
  });

  it('passes the garageId server-side filter to fetchFinanceMemberships', async () => {
    vi.mocked(fetchFinanceMemberships).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    await GarageMembershipHistory({ garageId: 'garage-x' });
    expect(fetchFinanceMemberships).toHaveBeenCalledWith(
      expect.objectContaining({ garageId: 'garage-x' }),
    );
  });
});
