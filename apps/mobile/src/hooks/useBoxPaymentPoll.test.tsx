// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoxView } from '@ccc/shared/box';

const { getBox } = vi.hoisted(() => ({ getBox: vi.fn() }));
vi.mock('~/api/box', () => ({ getBox: () => getBox() }));

import { useBoxPaymentPoll } from './useBoxPaymentPoll';

const view = (over: Partial<BoxView>): BoxView => ({
  id: 'b',
  status: 'awaiting_payment',
  fulfillmentStatus: 'unfulfilled',
  cycleKey: '2026-08-01',
  cutoffAt: '2026-08-27T00:00:00.000Z',
  budgetCents: 10000,
  currency: 'BRL',
  itemsTotalCents: 0,
  partnersTotalCents: 0,
  overflowCents: 0,
  shippingCents: 0,
  chargeCents: 2000,
  orderId: 'ord_1',
  autoSendOptIn: false,
  shippingAddressId: 'a',
  items: [],
  partnerItems: [],
  ...over,
});

let snap: ReturnType<typeof useBoxPaymentPoll>;
function Probe({ expiresAt }: { expiresAt: string }) {
  snap = useBoxPaymentPoll({ expiresAt, enabled: true });
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const future = new Date(Date.now() + 3_600_000).toISOString();

beforeEach(() => getBox.mockReset());
afterEach(() => vi.useRealTimers());

async function mount(expiresAt = future) {
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<Probe expiresAt={expiresAt} />);
    await flush();
  });
}

describe('useBoxPaymentPoll', () => {
  it('resolves paid when the box goes ready with an orderId', async () => {
    getBox.mockResolvedValueOnce(view({ status: 'ready', orderId: 'ord_1' }));
    await mount();
    expect(snap.status).toBe('paid');
  });

  it('resolves closed_budget_only when the box goes ready with null orderId', async () => {
    getBox.mockResolvedValueOnce(view({ status: 'ready', orderId: null }));
    await mount();
    expect(snap.status).toBe('closed_budget_only');
  });

  it('resolves error when getBox throws', async () => {
    getBox.mockRejectedValueOnce(new Error('net'));
    await mount();
    expect(snap.status).toBe('error');
  });

  it('resolves expired when expiresAt is in the past', async () => {
    getBox.mockResolvedValue(view({}));
    await mount(new Date(Date.now() - 1000).toISOString());
    expect(snap.status).toBe('expired');
  });
});
