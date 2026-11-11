import type { PresaleCampaign } from '@ccc/shared/presale';
import { describe, expect, it, vi } from 'vitest';

const { notFoundMock, fetchPresaleCampaignMock, fetchPresaleProductsMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  fetchPresaleCampaignMock: vi.fn(),
  fetchPresaleProductsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}));

vi.mock('~/lib/presale-api', () => ({
  fetchPresaleCampaign: fetchPresaleCampaignMock,
  fetchPresaleProducts: fetchPresaleProductsMock,
}));

vi.mock('~/components/presale/CasaInBoxCheckout', () => ({
  CasaInBoxCheckout: () => null,
}));

import CasaInBoxPage from '../page';

const enabledCampaign: PresaleCampaign = {
  enabled: true,
  shippingFeeCents: 1990,
  deliveryAreaLabel: 'Grande São Paulo',
  pickupAddress: 'Pocket CASA, Rua Augusta 123',
  pickupHours: 'seg a sex, 9h às 18h',
  firstBatchLabel: '1º lote',
};

const disabledCampaign: PresaleCampaign = { ...enabledCampaign, enabled: false };

describe('CasaInBoxPage', () => {
  it('calls notFound() when the campaign is disabled', async () => {
    notFoundMock.mockClear();
    fetchPresaleCampaignMock.mockResolvedValueOnce(disabledCampaign);
    fetchPresaleProductsMock.mockResolvedValueOnce({ items: [] });

    await expect(CasaInBoxPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT call notFound() when the campaign is enabled', async () => {
    notFoundMock.mockClear();
    fetchPresaleCampaignMock.mockResolvedValueOnce(enabledCampaign);
    fetchPresaleProductsMock.mockResolvedValueOnce({ items: [] });

    await CasaInBoxPage();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('does not fetch products before confirming the campaign is enabled and does not throw on an empty catalog', async () => {
    fetchPresaleCampaignMock.mockResolvedValueOnce(enabledCampaign);
    fetchPresaleProductsMock.mockResolvedValueOnce({ items: [] });

    await expect(CasaInBoxPage()).resolves.toBeTruthy();
  });
});
