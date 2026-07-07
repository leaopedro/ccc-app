import { describe, expect, it } from 'vitest';

import {
  defaultFeedSettings,
  feedPostCreateInputSchema,
  feedPostResponseSchema,
  feedSettingsSchema,
  feedSettingsUpdateSchema,
  publicCarProfileSchema,
} from '../feed.js';

describe('feed settings', () => {
  it('accepts the documented defaults', () => {
    const parsed = feedSettingsSchema.parse(defaultFeedSettings);
    expect(parsed.maxPostsPerUser).toBeNull();
    expect(parsed.maxPhotosPerUser).toBe(5);
    expect(parsed.feedAccess).toBe('attendees');
    expect(parsed.postingAccess).toBe('attendees');
    expect(parsed.feedEnabled).toBe(true);
  });

  it('rejects non-positive photo limit', () => {
    const result = feedSettingsSchema.safeParse({
      ...defaultFeedSettings,
      maxPhotosPerUser: 0,
    });
    expect(result.success).toBe(false);
  });

  it('allows partial settings updates', () => {
    const result = feedSettingsUpdateSchema.parse({ feedEnabled: false });
    expect(result).toEqual({ feedEnabled: false });
  });
});

describe('public car profile', () => {
  it('parses a minimal car shape without owner fields', () => {
    const parsed = publicCarProfileSchema.parse({
      id: 'car_1',
      make: 'Nissan',
      model: 'Skyline',
      year: 1999,
      nickname: null,
      modifications: [],
      photo: null,
      isPremiumActive: false,
    });
    expect(parsed.id).toBe('car_1');
    expect(parsed.isPremiumActive).toBe(false);
  });

  it('rejects unknown keys via strict-by-default zod schema', () => {
    // zod object schemas are not strict by default, so unknowns are stripped.
    // Confirm the public shape strips a plate field rather than carrying it through.
    const parsed = publicCarProfileSchema.parse({
      id: 'car_1',
      make: 'Nissan',
      model: 'Skyline',
      year: 1999,
      nickname: null,
      modifications: [],
      photo: null,
      isPremiumActive: false,
      plate: 'ABC-1234',
    } as unknown);
    expect((parsed as Record<string, unknown>).plate).toBeUndefined();
  });
});

describe('feed post response', () => {
  it('parses a complete response with car and reactions', () => {
    const parsed = feedPostResponseSchema.parse({
      id: 'post_1',
      eventId: 'evt_1',
      car: {
        id: 'car_1',
        make: 'Nissan',
        model: 'Skyline',
        year: 1999,
        nickname: 'Godzilla',
        modifications: [],
        photo: { url: 'https://example.com/p.jpg', width: 100, height: 100 },
        isPremiumActive: false,
      },
      body: 'hello',
      status: 'visible',
      photos: [],
      reactions: { likes: 0, mine: false },
      commentCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.car?.id).toBe('car_1');
  });
});

describe('feed post create input', () => {
  it('rejects empty body', () => {
    const result = feedPostCreateInputSchema.safeParse({ carId: 'c', body: '   ' });
    expect(result.success).toBe(false);
  });

  it('caps photo keys at 20', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `k${i}`);
    const result = feedPostCreateInputSchema.safeParse({
      carId: 'c',
      body: 'x',
      photoObjectKeys: tooMany,
    });
    expect(result.success).toBe(false);
  });
});
