import { describe, expect, it } from 'vitest';

import {
  adminAuditActionSchema,
  adminEventCreateSchema,
  adminEventUpdateSchema,
  adminTierCreateSchema,
  adminTierUpdateSchema,
} from '../admin.js';

describe('adminEventCreateSchema', () => {
  const base = {
    slug: 'encontro-sp-maio',
    title: 'Encontro SP',
    description: 'Descrição longa.',
    startsAt: '2026-05-10T14:00:00.000Z',
    endsAt: '2026-05-10T20:00:00.000Z',
    venueName: 'Autódromo',
    venueAddress: 'Rua X, 100',
    lat: -23.55,
    lng: -46.63,
    city: 'São Paulo',
    stateCode: 'SP',
    type: 'meeting',
    capacity: 200,
    coverObjectKey: null,
    feedEnabled: true,
    feedAccess: 'attendees',
    postingAccess: 'attendees',
    maxPostsPerUser: null,
    maxPhotosPerUser: 5,
  };

  it('accepts a valid payload', () => {
    expect(() => adminEventCreateSchema.parse(base)).not.toThrow();
  });

  it('rejects endsAt before startsAt', () => {
    expect(() =>
      adminEventCreateSchema.parse({ ...base, endsAt: '2026-05-10T13:00:00.000Z' }),
    ).toThrow();
  });

  it('rejects slug with spaces', () => {
    expect(() => adminEventCreateSchema.parse({ ...base, slug: 'not a slug' })).toThrow();
  });

  it('rejects capacity < 0', () => {
    expect(() => adminEventCreateSchema.parse({ ...base, capacity: -1 })).toThrow();
  });

  it('defaults maxTicketsPerUser to null (unlimited) when omitted', () => {
    const result = adminEventCreateSchema.parse(base);
    expect(result.maxTicketsPerUser).toBeNull();
  });

  it('accepts feed fields with defaults', () => {
    const result = adminEventCreateSchema.parse(base);
    expect(result.feedEnabled).toBe(true);
    expect(result.feedAccess).toBe('attendees');
    expect(result.postingAccess).toBe('attendees');
    expect(result.maxPostsPerUser).toBeNull();
    expect(result.maxPhotosPerUser).toBe(5);
  });

  it('accepts maxTicketsPerUser at any positive integer', () => {
    expect(() => adminEventCreateSchema.parse({ ...base, maxTicketsPerUser: 5 })).not.toThrow();
    expect(() => adminEventCreateSchema.parse({ ...base, maxTicketsPerUser: 100 })).not.toThrow();
    expect(() => adminEventCreateSchema.parse({ ...base, maxTicketsPerUser: 500 })).not.toThrow();
  });

  it('accepts maxTicketsPerUser=null (unlimited)', () => {
    expect(() => adminEventCreateSchema.parse({ ...base, maxTicketsPerUser: null })).not.toThrow();
  });

  it('rejects maxTicketsPerUser < 1', () => {
    expect(() => adminEventCreateSchema.parse({ ...base, maxTicketsPerUser: 0 })).toThrow();
  });
});

describe('adminEventUpdateSchema', () => {
  it('accepts a single-field patch', () => {
    expect(() => adminEventUpdateSchema.parse({ title: 'New title' })).not.toThrow();
  });

  it('accepts empty object (no-op)', () => {
    expect(() => adminEventUpdateSchema.parse({})).not.toThrow();
  });

  it('rejects status — must go through publish/cancel actions', () => {
    expect(() => adminEventUpdateSchema.parse({ status: 'published' })).toThrow();
  });

  it('accepts maxTicketsPerUser patch with high value', () => {
    expect(() => adminEventUpdateSchema.parse({ maxTicketsPerUser: 3 })).not.toThrow();
    expect(() => adminEventUpdateSchema.parse({ maxTicketsPerUser: 500 })).not.toThrow();
  });

  it('accepts maxTicketsPerUser=null in patch (clear limit)', () => {
    expect(() => adminEventUpdateSchema.parse({ maxTicketsPerUser: null })).not.toThrow();
  });

  it('accepts feed field updates', () => {
    expect(() =>
      adminEventUpdateSchema.parse({
        feedEnabled: false,
        feedAccess: 'public',
        postingAccess: 'organizers_only',
        maxPostsPerUser: 20,
        maxPhotosPerUser: 8,
      }),
    ).not.toThrow();
  });

  it('rejects maxTicketsPerUser < 1 in patch', () => {
    expect(() => adminEventUpdateSchema.parse({ maxTicketsPerUser: 0 })).toThrow();
  });
});

describe('adminTierCreateSchema', () => {
  const base = { name: 'Geral', priceCents: 5000, quantityTotal: 100 };

  it('accepts base', () => {
    expect(() => adminTierCreateSchema.parse(base)).not.toThrow();
  });

  it('accepts optional sales window', () => {
    expect(() =>
      adminTierCreateSchema.parse({
        ...base,
        salesOpenAt: '2026-05-01T00:00:00.000Z',
        salesCloseAt: '2026-05-10T14:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects priceCents < 0', () => {
    expect(() => adminTierCreateSchema.parse({ ...base, priceCents: -1 })).toThrow();
  });

  it('rejects salesCloseAt before salesOpenAt', () => {
    expect(() =>
      adminTierCreateSchema.parse({
        ...base,
        salesOpenAt: '2026-05-10T00:00:00.000Z',
        salesCloseAt: '2026-05-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('adminTierUpdateSchema', () => {
  it('accepts partial patch', () => {
    expect(() => adminTierUpdateSchema.parse({ priceCents: 7500 })).not.toThrow();
  });
});

describe('adminAuditActionSchema', () => {
  it.each([
    'event.create',
    'event.update',
    'event.publish',
    'event.unpublish',
    'event.cancel',
    'tier.create',
    'tier.update',
    'tier.delete',
  ])('accepts %s', (action) => {
    expect(adminAuditActionSchema.parse(action)).toBe(action);
  });

  it('rejects unknown action', () => {
    expect(() => adminAuditActionSchema.parse('event.explode')).toThrow();
  });
});
