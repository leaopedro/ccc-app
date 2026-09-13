import { describe, expect, it, vi } from 'vitest';

const { notFoundMock, fetchPublicGarageMock, fetchBadgeCatalogMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  fetchPublicGarageMock: vi.fn(),
  fetchBadgeCatalogMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}));

vi.mock('~/lib/public-garage', () => ({
  fetchPublicGarage: fetchPublicGarageMock,
  fetchBadgeCatalog: fetchBadgeCatalogMock,
}));

vi.mock('~/components/public-garage-view', () => ({
  PublicGarageView: () => null,
}));

import PublicGaragePage from '../page';

const validPayload = {
  garage: {
    name: 'Quintal do JDM',
    slug: 'quintal-do-jdm',
    description: null,
    premiumTier: null,
    coverPreset: null,
    coverImageUrl: null,
    isPremiumActive: false,
    gamification: { enabled: true },
    badges: [],
  },
  cars: [],
};

const payloadWithBadges = {
  ...validPayload,
  garage: {
    ...validPayload.garage,
    badges: [{ code: 'CCC-003', earnedAt: '2026-05-01T12:00:00.000Z' }],
  },
};

describe('PublicGaragePage', () => {
  it('calls notFound() when fetchPublicGarage returns null (private OR unknown)', async () => {
    notFoundMock.mockClear();
    fetchPublicGarageMock.mockResolvedValueOnce(null);
    await expect(
      PublicGaragePage({ params: Promise.resolve({ slug: 'unknown-or-private' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT call notFound() when fetchPublicGarage returns a payload', async () => {
    notFoundMock.mockClear();
    fetchPublicGarageMock.mockResolvedValueOnce(validPayload);
    await PublicGaragePage({ params: Promise.resolve({ slug: 'quintal-do-jdm' }) });
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('passes the awaited slug to fetchPublicGarage', async () => {
    fetchPublicGarageMock.mockClear();
    fetchPublicGarageMock.mockResolvedValueOnce(validPayload);
    await PublicGaragePage({ params: Promise.resolve({ slug: 'awaited-slug' }) });
    expect(fetchPublicGarageMock).toHaveBeenCalledWith('awaited-slug');
  });

  it('skips the catalog fetch when the public payload has no pinned badges', async () => {
    fetchPublicGarageMock.mockClear();
    fetchBadgeCatalogMock.mockClear();
    fetchPublicGarageMock.mockResolvedValueOnce(validPayload);
    await PublicGaragePage({ params: Promise.resolve({ slug: 'no-badges' }) });
    expect(fetchBadgeCatalogMock).not.toHaveBeenCalled();
  });

  it('fetches the badge catalog when the public payload has pinned badges', async () => {
    fetchPublicGarageMock.mockClear();
    fetchBadgeCatalogMock.mockClear();
    fetchPublicGarageMock.mockResolvedValueOnce(payloadWithBadges);
    fetchBadgeCatalogMock.mockResolvedValueOnce({ enabled: true, catalog: [] });
    await PublicGaragePage({ params: Promise.resolve({ slug: 'has-badges' }) });
    expect(fetchBadgeCatalogMock).toHaveBeenCalledTimes(1);
  });
});
