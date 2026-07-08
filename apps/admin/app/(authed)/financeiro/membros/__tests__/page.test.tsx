import type { AdminFinanceMembershipsItem } from '@ccc/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `next/link` reads from React context that is only set up in a real Next.js
// render. Stub it to a plain anchor so renderToStaticMarkup works in node.
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

import { MembrosTable } from '../membros-table';

const baseItem: AdminFinanceMembershipsItem = {
  membershipId: 'mem-1',
  garageSlug: 'garage-slug-1',
  userName: 'Fulano da Silva',
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

const emptyFilters = { status: null, cadence: null, tier: null, provider: null };
const noPreserved: Record<string, string> = {};

describe('MembrosTable', () => {
  it('renders table rows for each item', () => {
    const html = renderToStaticMarkup(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={emptyFilters}
        preservedParams={noPreserved}
      />,
    );
    expect(html).toContain('data-testid="membros-row-mem-1"');
  });

  it('renders user name and garage slug in first column', () => {
    const html = renderToStaticMarkup(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={emptyFilters}
        preservedParams={noPreserved}
      />,
    );
    expect(html).toContain('Fulano da Silva');
    expect(html).toContain('garage-slug-1');
  });

  it('renders PT-BR status badge "Ativo" for active status', () => {
    const html = renderToStaticMarkup(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={emptyFilters}
        preservedParams={noPreserved}
      />,
    );
    expect(html).toContain('data-testid="membros-status-mem-1"');
    expect(html).toMatch(/data-testid="membros-status-mem-1"[^>]*>Ativo</);
  });

  it('renders "Inadimplente" for past_due status', () => {
    const pastDueItem = { ...baseItem, status: 'past_due' as const, membershipId: 'mem-2' };
    const html = renderToStaticMarkup(
      <MembrosTable
        items={[pastDueItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={emptyFilters}
        preservedParams={noPreserved}
      />,
    );
    expect(html).toMatch(/data-testid="membros-status-mem-2"[^>]*>Inadimplente</);
  });

  it('renders empty state when items is empty array', () => {
    const html = renderToStaticMarkup(
      <MembrosTable
        items={[]}
        page={1}
        pageSize={25}
        total={0}
        activeFilters={emptyFilters}
        preservedParams={noPreserved}
      />,
    );
    expect(html).toContain('data-testid="membros-empty-state"');
    expect(html).toContain('Nenhum membro encontrado.');
  });

  it('renders pagination controls when totalPages > 1', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      ...baseItem,
      membershipId: `mem-${i}`,
    }));
    const html = renderToStaticMarkup(
      <MembrosTable
        items={items}
        page={2}
        pageSize={25}
        total={100}
        activeFilters={emptyFilters}
        preservedParams={noPreserved}
      />,
    );
    expect(html).toContain('data-testid="membros-prev"');
    expect(html).toContain('data-testid="membros-next"');
    expect(html).toContain('data-testid="membros-page-indicator"');
  });

  it('page indicator shows "Página 2 de 4"', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      ...baseItem,
      membershipId: `mem-${i}`,
    }));
    const html = renderToStaticMarkup(
      <MembrosTable
        items={items}
        page={2}
        pageSize={25}
        total={100}
        activeFilters={emptyFilters}
        preservedParams={noPreserved}
      />,
    );
    expect(html).toContain('Página 2 de 4');
  });

  it('row link navigates to /users with user name query', () => {
    const html = renderToStaticMarkup(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={emptyFilters}
        preservedParams={noPreserved}
      />,
    );
    expect(html).toContain('data-testid="membros-row-link-mem-1"');
    expect(html).toContain('href="/users?q=Fulano%20da%20Silva"');
  });

  it('status chip "Ativo" links to status=active filter', () => {
    const html = renderToStaticMarkup(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={emptyFilters}
        preservedParams={noPreserved}
      />,
    );
    // The "Ativo" chip is a link that sets status=active in the URL
    expect(html).toMatch(/href="[^"]*status=active[^"]*"[^>]*>[^<]*Ativo/);
  });

  it('filter chip preserves search/from/to query state', () => {
    const html = renderToStaticMarkup(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={emptyFilters}
        preservedParams={{ from: '2026-01-01', to: '2026-12-31', search: 'fulano' }}
      />,
    );
    // Every chip href must carry the preserved keys forward.
    expect(html).toMatch(/href="[^"]*from=2026-01-01[^"]*status=active/);
    expect(html).toMatch(/href="[^"]*to=2026-12-31[^"]*status=active/);
    expect(html).toMatch(/href="[^"]*search=fulano[^"]*status=active/);
  });

  it('pagination link preserves search/from/to query state', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      ...baseItem,
      membershipId: `mem-${i}`,
    }));
    const html = renderToStaticMarkup(
      <MembrosTable
        items={items}
        page={2}
        pageSize={25}
        total={100}
        activeFilters={emptyFilters}
        preservedParams={{ from: '2026-01-01', to: '2026-12-31', search: 'fulano' }}
      />,
    );
    expect(html).toMatch(/href="[^"]*from=2026-01-01[^"]*"[^>]*data-testid="membros-prev"/);
    expect(html).toMatch(/href="[^"]*to=2026-12-31[^"]*"[^>]*data-testid="membros-prev"/);
    expect(html).toMatch(/href="[^"]*search=fulano[^"]*"[^>]*data-testid="membros-prev"/);
    expect(html).toMatch(/href="[^"]*page=3[^"]*"[^>]*data-testid="membros-next"/);
  });

  it('"Limpar filtros" link preserves search/from/to query state', () => {
    const html = renderToStaticMarkup(
      <MembrosTable
        items={[baseItem]}
        page={1}
        pageSize={25}
        total={1}
        activeFilters={{ ...emptyFilters, status: 'active' }}
        preservedParams={{ from: '2026-01-01', search: 'fulano' }}
      />,
    );
    expect(html).toMatch(/>Limpar filtros</);
    expect(html).toMatch(/href="\?[^"]*from=2026-01-01[^"]*"[^>]*>Limpar filtros</);
    expect(html).toMatch(/href="\?[^"]*search=fulano[^"]*"[^>]*>Limpar filtros</);
    // The clear href must NOT carry status=active forward.
    expect(html).not.toMatch(/href="\?[^"]*status=active[^"]*"[^>]*>Limpar filtros</);
  });
});
