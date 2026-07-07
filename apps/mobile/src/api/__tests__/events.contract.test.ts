import { eventDetailCommerceSchema, eventDetailPublicSchema } from '@jdm/shared/events';
import { describe, expect, it } from 'vitest';

const CAPACITY_DISPLAY_ABSOLUTE = {
  status: 'available',
  mode: 'absolute',
  showAbsolute: true,
  showPercentage: false,
  remaining: 100,
  remainingPercent: null,
  thresholdPercent: 15,
} as const;

const PUBLIC_FIXTURE = {
  id: 'evt_1',
  slug: 'encontro-sp',
  title: 'Encontro SP',
  coverUrl: null,
  startsAt: '2026-06-01T20:00:00.000Z',
  endsAt: '2026-06-02T02:00:00.000Z',
  venueName: 'Autódromo',
  venueAddress: 'Rua X',
  city: 'São Paulo',
  stateCode: 'SP',
  type: 'meeting',
  status: 'published',
  description: 'd',
  capacity: 200,
  maxTicketsPerUser: 4,
  hasCarTier: false,
  feedEnabled: false,
  feedAccess: 'attendees',
  postingAccess: 'attendees',
} as const;

const COMMERCE_FIXTURE = {
  ...PUBLIC_FIXTURE,
  tiers: [
    {
      id: 'tier_1',
      name: 'Geral',
      priceCents: 5000,
      displayPriceCents: 5500,
      devFeePercent: 10,
      currency: 'BRL',
      quantityTotal: 100,
      remainingCapacity: 90,
      salesOpenAt: null,
      salesCloseAt: null,
      sortOrder: 0,
      requiresCar: false,
      capacityDisplay: CAPACITY_DISPLAY_ABSOLUTE,
    },
  ],
  extras: [
    {
      id: 'extra_1',
      name: 'Camiseta',
      description: null,
      priceCents: 4000,
      displayPriceCents: 4400,
      devFeePercent: 10,
      currency: 'BRL',
      quantityRemaining: 38,
      sortOrder: 0,
      capacityDisplay: CAPACITY_DISPLAY_ABSOLUTE,
    },
  ],
} as const;

describe('eventDetailPublicSchema', () => {
  it('accepts a public payload with no commerce fields', () => {
    const parsed = eventDetailPublicSchema.parse(PUBLIC_FIXTURE);
    expect(parsed).not.toHaveProperty('tiers');
    expect(parsed).not.toHaveProperty('extras');
  });

  it('strips tiers/extras when given a commerce-shaped payload', () => {
    const parsed = eventDetailPublicSchema.parse(COMMERCE_FIXTURE);
    expect(parsed).not.toHaveProperty('tiers');
    expect(parsed).not.toHaveProperty('extras');
  });
});

describe('eventDetailCommerceSchema', () => {
  it('accepts a commerce payload with tiers and extras', () => {
    const parsed = eventDetailCommerceSchema.parse(COMMERCE_FIXTURE);
    expect(parsed.tiers).toHaveLength(1);
    expect(parsed.extras).toHaveLength(1);
  });

  it('rejects a public-only payload missing tiers', () => {
    const result = eventDetailCommerceSchema.safeParse(PUBLIC_FIXTURE);
    expect(result.success).toBe(false);
  });
});
