// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/api/client', () => ({
  authedRequest: vi.fn(),
}));

import { createPremiumSubscriptionNative, getPremiumStatus } from '../premium';

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

describe('createPremiumSubscriptionNative', () => {
  it('posts to checkout-native with the plan and add-ons', async () => {
    mockAuthedRequest.mockResolvedValueOnce({
      subscriptionId: 'sub_1',
      clientSecret: 'pi_sub_secret_x',
      attemptId: 'attempt_1',
    });
    const result = await createPremiumSubscriptionNative({
      planSlug: 'fundador',
      addonKeys: ['detailing'],
    });
    expect(mockAuthedRequest).toHaveBeenCalledWith(
      '/api/me/premium/checkout-native',
      expect.anything(),
      {
        method: 'POST',
        body: { cadence: 'monthly', planSlug: 'fundador', addonKeys: ['detailing'] },
      },
    );
    expect(result.clientSecret).toBe('pi_sub_secret_x');
  });
});
