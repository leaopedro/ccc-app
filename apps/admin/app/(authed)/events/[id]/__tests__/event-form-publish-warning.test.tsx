import type { AdminEventDetail, AdminTicketTier } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/event-actions', () => ({
  updateEventAction: vi.fn(() => Promise.resolve({ error: null })),
  publishEventAction: vi.fn(() => Promise.resolve({ error: null })),
  unpublishEventAction: vi.fn(() => Promise.resolve({ error: null })),
  cancelEventAction: vi.fn(() => Promise.resolve({ error: null })),
}));
vi.mock('~/components/cover-uploader', () => ({
  CoverUploader: () => null,
}));
vi.mock('~/components/date-time-field', () => ({
  DateTimeField: () => null,
}));

import { EventForm } from '../event-form';

const capacityDisplayFixture = {
  status: 'available' as const,
  mode: 'absolute' as const,
  showAbsolute: true,
  showPercentage: false,
  remaining: 100,
  remainingPercent: 100,
  thresholdPercent: 15,
};

const makeTier = (
  isPremiumGrantable: boolean,
  opts: { salesCloseAt?: string | null } = {},
): AdminTicketTier => ({
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
  salesCloseAt: opts.salesCloseAt ?? null,
  sortOrder: 0,
  requiresCar: false,
  isPremiumGrantable,
  capacityDisplay: capacityDisplayFixture,
});

const makeEvent = (
  status: 'draft' | 'published' | 'cancelled',
  tiers: AdminTicketTier[],
): AdminEventDetail => ({
  id: 'ev_1',
  slug: 'test-event',
  title: 'Test Event',
  coverUrl: null,
  coverObjectKey: 'event_cover/cover.jpg',
  startsAt: new Date(Date.now() + 86400_000).toISOString(),
  endsAt: new Date(Date.now() + 90000_000).toISOString(),
  venueName: 'Arena',
  venueAddress: 'Rua A, 1',
  city: 'São Paulo',
  stateCode: 'SP',
  type: 'meeting',
  description: 'desc',
  capacity: 100,
  maxTicketsPerUser: null,
  hasCarTier: false,
  feedEnabled: true,
  feedAccess: 'public',
  postingAccess: 'attendees',
  maxPostsPerUser: null,
  maxPhotosPerUser: 10,
  status,
  publishedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tiers,
  extras: [],
});

const WARNING_RE = /Nenhum nível concede acesso premium/i;

describe('EventForm — no-grantable-tier publish warning', () => {
  it('shows warning for draft event with no grantable tier', () => {
    const html = renderToStaticMarkup(<EventForm event={makeEvent('draft', [makeTier(false)])} />);
    expect(html).toMatch(WARNING_RE);
  });

  it('shows warning for draft event with zero tiers', () => {
    const html = renderToStaticMarkup(<EventForm event={makeEvent('draft', [])} />);
    expect(html).toMatch(WARNING_RE);
  });

  it('does NOT show warning when at least one tier is grantable', () => {
    const html = renderToStaticMarkup(<EventForm event={makeEvent('draft', [makeTier(true)])} />);
    expect(html).not.toMatch(WARNING_RE);
  });

  it('does NOT show warning for published event (warning would be noise after publish)', () => {
    const html = renderToStaticMarkup(
      <EventForm event={makeEvent('published', [makeTier(false)])} />,
    );
    expect(html).not.toMatch(WARNING_RE);
  });

  it('shows warning when only grantable tier has salesCloseAt in the past (worker would skip)', () => {
    const closedTier = makeTier(true, {
      salesCloseAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const html = renderToStaticMarkup(<EventForm event={makeEvent('draft', [closedTier])} />);
    expect(html).toMatch(WARNING_RE);
  });

  it('does NOT show warning when grantable tier has future salesCloseAt', () => {
    const openTier = makeTier(true, {
      salesCloseAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const html = renderToStaticMarkup(<EventForm event={makeEvent('draft', [openTier])} />);
    expect(html).not.toMatch(WARNING_RE);
  });
});
