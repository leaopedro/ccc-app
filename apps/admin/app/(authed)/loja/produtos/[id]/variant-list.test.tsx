import type { AdminStoreVariant } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/store-actions', () => ({
  createVariantAction: vi.fn(),
  deleteVariantAction: vi.fn(),
  updateVariantAction: vi.fn(),
}));

import { VariantList, createSizePreset } from './variant-list';

const variant: AdminStoreVariant = {
  id: 'var_1',
  productId: 'prod_1',
  name: 'Preto M',
  sku: 'SKU-1',
  priceCents: 15900,
  displayPriceCents: 17490,
  devFeePercent: 10,
  quantityTotal: 8,
  quantitySold: 2,
  attributes: { tamanho: 'M', cor: 'Preto' },
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('VariantList', () => {
  it('does not render the backend-only variant attributes field', () => {
    const html = renderToStaticMarkup(
      <VariantList productId="prod_1" productPriceCents={9900} variants={[variant]} />,
    );

    expect(html).not.toContain('Atributos da variante');
    expect(html).not.toContain('Use JSON com pares chave/valor, como tamanho e cor.');
    expect(html).not.toContain('name="attributes"');
  });
});

describe('createSizePreset', () => {
  it('calls createFn four times in order with correct payloads using product price', async () => {
    const calls: Array<{ productId: string; fd: FormData }> = [];
    const mockCreate = vi.fn((productId: string, _prev: unknown, fd: FormData) => {
      calls.push({ productId, fd });
      return Promise.resolve({ error: null });
    });

    const result = await createSizePreset('prod_1', 9900, mockCreate);

    expect(result).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(4);

    const expectedSizes = ['P', 'M', 'G', 'GG'];
    for (let i = 0; i < 4; i++) {
      const { productId, fd } = calls[i]!;
      expect(productId).toBe('prod_1');
      expect(fd.get('name')).toBe(expectedSizes[i]);
      expect(fd.get('priceCents')).toBe('9900');
      expect(fd.get('quantityTotal')).toBe('0');
      expect(fd.get('attributes')).toBe(JSON.stringify({ size: expectedSizes[i] }));
    }
  });

  it('stops on first failure and returns the error message', async () => {
    const mockCreate = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: 'Falha ao criar M' });

    const result = await createSizePreset('prod_1', 9900, mockCreate);

    expect(result).toBe('Falha ao criar M');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
