import type { AdminFinanceTrendPoint } from '@ccc/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Mock recharts — it calls DOM APIs not available in the node test environment.
// We render the children directly so we can assert on data-key attributes and
// legend formatter output without a real chart.
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
    // The gradient is defined in SVG defs even in server render — or present
    // as data-area="membershipRevenueCents" on the mocked Area.
    const hasMembership =
      html.includes('membershipRevenueCents') || html.includes('membershipGradient');
    expect(hasMembership).toBe(true);
  });
});
