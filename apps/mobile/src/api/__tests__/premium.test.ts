// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client', () => ({
  authedRequest: vi.fn(),
}));

import { getPremiumStatus } from '../premium';

import { authedRequest } from '~/api/client';

const mockAuthedRequest = vi.mocked(authedRequest);

describe('getPremiumStatus', () => {
  it('calls authedRequest with the correct path', async () => {
    mockAuthedRequest.mockResolvedValueOnce({
      active: true,
      tier: 'gold',
      cadence: 'monthly',
      provider: 'apple_revenuecat',
      currentPeriodEnd: '2026-06-26T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      manageUrl: null,
    });
    await getPremiumStatus();
    expect(mockAuthedRequest).toHaveBeenCalledWith('/api/me/premium/status', expect.anything());
  });
});
