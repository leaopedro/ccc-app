import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getMyPremiumSubscription } = vi.hoisted(() => ({
  getMyPremiumSubscription: vi.fn(),
}));
vi.mock('~/api/premium-catalog', () => ({ getMyPremiumSubscription }));

const { pollSubscriptionTier } = await import('./poll-subscription');

describe('pollSubscriptionTier', () => {
  beforeEach(() => {
    getMyPremiumSubscription.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolve true quando tier E cadencia batem com o alvo', async () => {
    getMyPremiumSubscription
      .mockResolvedValueOnce({ active: true, tier: 'gold', cadence: 'monthly' })
      .mockResolvedValueOnce({ active: true, tier: 'silver', cadence: 'monthly' });

    const promise = pollSubscriptionTier('silver', 'monthly');
    await vi.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.toBe(true);
    expect(getMyPremiumSubscription).toHaveBeenCalledTimes(2);
  });

  it('nao da falso positivo quando so a cadencia muda', async () => {
    // O tier já é o alvo desde a primeira leitura. Comparar só o tier faria o
    // poll resolver true antes de qualquer webhook e mostrar sucesso para uma
    // mudança que não aconteceu.
    getMyPremiumSubscription.mockResolvedValue({ active: true, tier: 'gold', cadence: 'monthly' });

    const promise = pollSubscriptionTier('gold', 'annual');
    await vi.advanceTimersByTimeAsync(2000 * 16);

    await expect(promise).resolves.toBe(false);
  });

  it('resolve false quando as tentativas acabam com o plano antigo', async () => {
    getMyPremiumSubscription.mockResolvedValue({ active: true, tier: 'gold', cadence: 'monthly' });

    const promise = pollSubscriptionTier('silver', 'monthly');
    await vi.advanceTimersByTimeAsync(2000 * 16);

    await expect(promise).resolves.toBe(false);
  });

  it('segue tentando quando uma leitura falha antes de resolver', async () => {
    getMyPremiumSubscription
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ active: true, tier: 'silver', cadence: 'monthly' });

    const promise = pollSubscriptionTier('silver', 'monthly');
    await vi.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.toBe(true);
  });
});
