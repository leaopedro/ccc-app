import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_STORE_HERO_HEADER, loadStoreHeroHeader } from './hero-header';

describe('loadStoreHeroHeader', () => {
  it('returns header values from store settings when fetch succeeds', async () => {
    const fetchStoreSettings = vi.fn().mockResolvedValue({
      id: 'store_default',
      storeEnabled: true,
      defaultShippingFeeCents: 0,
      lowStockThreshold: 5,
      storeHeaderTitle: 'Drop novo. Corre antes que acabe.',
      storeHeaderSubtitle: 'Itens oficiais da cena JDM com estoque limitado.',
      eventPickupEnabled: false,
      pickupDisplayLabel: null,
      supportPhone: null,
      updatedAt: '2026-05-16T00:00:00.000Z',
    });

    const header = await loadStoreHeroHeader(fetchStoreSettings);

    expect(header).toEqual({
      storeHeaderTitle: 'Drop novo. Corre antes que acabe.',
      storeHeaderSubtitle: 'Itens oficiais da cena JDM com estoque limitado.',
    });
  });

  it('falls back to default header when settings fetch fails', async () => {
    const fetchStoreSettings = vi.fn().mockRejectedValue(new Error('settings down'));

    const header = await loadStoreHeroHeader(fetchStoreSettings);

    expect(header).toEqual(DEFAULT_STORE_HERO_HEADER);
  });
});
