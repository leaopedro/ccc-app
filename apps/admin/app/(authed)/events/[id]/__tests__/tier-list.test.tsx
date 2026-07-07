import type { AdminTicketTier } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Mock server actions — they are 'use server' modules; node renderer cannot call them.
vi.mock('~/lib/tier-actions', () => ({
  createTierAction: vi.fn(() => Promise.resolve({ error: null })),
  updateTierAction: vi.fn(() => Promise.resolve({ error: null })),
  deleteTierAction: vi.fn(() => Promise.resolve({ error: null })),
}));

import { TierList } from '../tier-list';

const capacityDisplayFixture = {
  status: 'available' as const,
  mode: 'absolute' as const,
  showAbsolute: true,
  showPercentage: false,
  remaining: 100,
  remainingPercent: 100,
  thresholdPercent: 15,
};

const makeTier = (overrides: Partial<AdminTicketTier> = {}): AdminTicketTier => ({
  id: 't_1',
  name: 'Geral',
  priceCents: 5000,
  displayPriceCents: 5500,
  devFeePercent: 10,
  currency: 'BRL',
  quantityTotal: 100,
  quantitySold: 0,
  remainingCapacity: 100,
  salesOpenAt: null,
  salesCloseAt: null,
  sortOrder: 0,
  requiresCar: false,
  isPremiumGrantable: false,
  capacityDisplay: capacityDisplayFixture,
  ...overrides,
});

// React's static renderer may emit attributes in any order, so all assertions
// scan within a single `<input ...>` tag without assuming attribute order.
const inputTagsWithName = (html: string, name: string): string[] => {
  // Capture every <input ...> tag whose attributes include name="<name>".
  const tags: string[] = [];
  const re = /<input\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[0].includes(`name="${name}"`)) tags.push(m[0]);
  }
  return tags;
};

describe('TierList — isPremiumGrantable checkbox', () => {
  it('renders the premium-grantable checkbox unchecked when isPremiumGrantable=false', () => {
    const html = renderToStaticMarkup(
      <TierList eventId="ev_1" tiers={[makeTier({ isPremiumGrantable: false })]} />,
    );
    expect(html).toContain('Conceder a membros premium na publicação');
    const tags = inputTagsWithName(html, 'isPremiumGrantable');
    expect(tags.length).toBeGreaterThanOrEqual(1);
    // Both the row checkbox and the create-form checkbox exist, neither pre-checked.
    expect(tags.every((t) => t.includes('type="checkbox"'))).toBe(true);
    expect(tags.some((t) => /\bchecked\b/.test(t))).toBe(false);
  });

  it('renders the row premium-grantable checkbox CHECKED when isPremiumGrantable=true', () => {
    const html = renderToStaticMarkup(
      <TierList eventId="ev_1" tiers={[makeTier({ isPremiumGrantable: true })]} />,
    );
    const tags = inputTagsWithName(html, 'isPremiumGrantable');
    // Row checkbox (pre-checked) + create-form checkbox (unchecked) = 2 tags.
    expect(tags.length).toBe(2);
    expect(tags.some((t) => /\bchecked\b/.test(t))).toBe(true);
  });

  it('shows the create-form premium-grantable checkbox when no tiers exist', () => {
    const html = renderToStaticMarkup(<TierList eventId="ev_1" tiers={[]} />);
    expect(html).toContain('Conceder a membros premium na publicação');
    const tags = inputTagsWithName(html, 'isPremiumGrantable');
    // With no tiers, only the create-form checkbox renders.
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('type="checkbox"');
    expect(/\bchecked\b/.test(tags[0]!)).toBe(false);
  });

  it('uses value="true" on the premium-grantable checkbox (FormData parses as truthy)', () => {
    const html = renderToStaticMarkup(<TierList eventId="ev_1" tiers={[]} />);
    const tags = inputTagsWithName(html, 'isPremiumGrantable');
    expect(tags.length).toBeGreaterThanOrEqual(1);
    expect(tags.every((t) => t.includes('value="true"'))).toBe(true);
  });
});
