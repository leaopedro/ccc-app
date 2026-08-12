import { describe, expect, it } from 'vitest';

import {
  boxCatalogSchema,
  boxHistorySchema,
  boxPreferencesSchema,
  boxViewItemSchema,
} from '../box.js';

describe('box fase 3 schemas', () => {
  it('view item carries imageUrl, included, dropReason', () => {
    const parsed = boxViewItemSchema.parse({
      catalogItemId: 'c1',
      quantity: 2,
      unitPriceCents: 1000,
      subtotalCents: 2000,
      titleSnapshot: 'Item',
      imageUrl: null,
      included: true,
      dropReason: null,
    });
    expect(parsed.included).toBe(true);
  });

  it('preferences requires autoSendOptIn boolean, optional address', () => {
    expect(() => boxPreferencesSchema.parse({ autoSendOptIn: true })).not.toThrow();
    expect(() => boxPreferencesSchema.parse({ autoSendOptIn: 'yes' })).toThrow();
  });

  it('catalog parses categories, items, partners', () => {
    const parsed = boxCatalogSchema.parse({
      categories: ['acessorios'],
      items: [
        {
          id: 'c1',
          title: 'Item',
          category: 'acessorios',
          imageUrl: null,
          priceCents: 1000,
          maxPerCycle: null,
          soldOut: false,
        },
      ],
      partners: [
        {
          id: 'p1',
          name: 'Parceiro',
          logoUrl: null,
          description: null,
          modules: [{ id: 'm1', name: 'Mod', description: null, imageUrl: null, priceCents: 5000 }],
        },
      ],
    });
    expect(parsed.items[0].soldOut).toBe(false);
  });

  it('history is an array of cycle summaries', () => {
    const parsed = boxHistorySchema.parse([
      {
        id: 'b1',
        cycleKey: '2026-08-01',
        cycleStart: '2026-08-01T00:00:00.000Z',
        status: 'ready',
        chargeCents: 0,
        thumbnails: [],
        current: true,
      },
    ]);
    expect(parsed[0].current).toBe(true);
  });
});
