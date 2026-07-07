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
