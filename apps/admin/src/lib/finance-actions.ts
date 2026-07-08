'use server';

import type {
  AdminFinanceMembershipsQuery,
  AdminFinanceMembershipsResponse,
  AdminFinanceQuery,
} from '@ccc/shared/admin';

import {
  financeQs,
  getFinanceByEvent,
  getFinanceByProduct,
  getFinanceMemberships,
  getFinancePaymentMix,
  getFinanceSummary,
  getFinanceTrends,
  listAdminEvents,
} from './admin-api';

export type FinanceFilterEvent = { id: string; title: string; startsAt: string };

export async function fetchFinanceFilterEvents(): Promise<FinanceFilterEvent[]> {
  const res = await listAdminEvents();
  return res.items
    .map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt }))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

export async function fetchFinanceDashboard(q?: AdminFinanceQuery) {
  const [summary, byEvent, trends, paymentMix, byProduct] = await Promise.all([
    getFinanceSummary(q),
    getFinanceByEvent(q),
    getFinanceTrends(q),
    getFinancePaymentMix(q),
    getFinanceByProduct(q),
  ]);
  return { summary, byEvent, trends, paymentMix, byProduct };
}

export async function fetchFinanceMemberships(
  q?: AdminFinanceMembershipsQuery,
): Promise<AdminFinanceMembershipsResponse> {
  return getFinanceMemberships(q);
}

export async function fetchFinanceExportCsv(q?: AdminFinanceQuery): Promise<string> {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  const access = jar.get('session_access')?.value;
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
  const h = new Headers();
  if (access) h.set('authorization', `Bearer ${access}`);

  const res = await fetch(`${base}/admin/finance/export${financeQs(q)}`, {
    headers: h,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.text();
}
