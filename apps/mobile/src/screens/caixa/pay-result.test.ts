import { describe, expect, it } from 'vitest';
import type { BoxView } from '@ccc/shared/box';

import { boxPayOutcome, mapPayError } from './pay-result';

const base: BoxView = {
  id: 'b',
  status: 'awaiting_payment',
  cycleKey: '2026-08-01',
  cutoffAt: '2026-08-27T00:00:00.000Z',
  budgetCents: 10000,
  currency: 'BRL',
  itemsTotalCents: 12000,
  partnersTotalCents: 0,
  overflowCents: 2000,
  shippingCents: 0,
  chargeCents: 2000,
  orderId: 'ord_1',
  autoSendOptIn: false,
  shippingAddressId: 'a',
  items: [],
  partnerItems: [],
};

describe('boxPayOutcome', () => {
  it('ready with orderId is a paid success', () => {
    expect(boxPayOutcome({ ...base, status: 'ready', orderId: 'ord_1' })).toBe('paid');
  });
  it('ready with null orderId is a cutoff-trim close', () => {
    expect(boxPayOutcome({ ...base, status: 'ready', orderId: null })).toBe('closed_budget_only');
  });
  it('skipped with null orderId is a cutoff-trim close', () => {
    expect(boxPayOutcome({ ...base, status: 'skipped', orderId: null })).toBe('closed_budget_only');
  });
  it('still awaiting_payment is pending', () => {
    expect(boxPayOutcome(base)).toBe('pending');
  });
});

describe('mapPayError', () => {
  it('routes lock/awaiting errors back home', () => {
    expect(mapPayError('locked').kind).toBe('toast_home');
    expect(mapPayError('not_awaiting').kind).toBe('toast_home');
    expect(mapPayError('not_eligible').kind).toBe('toast_home');
    expect(mapPayError('not_found').kind).toBe('toast_home');
  });
  it('routes provider errors to an in-screen retry', () => {
    expect(mapPayError('unavailable').kind).toBe('retry');
    expect(mapPayError('error').kind).toBe('retry');
  });
});
