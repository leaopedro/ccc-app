// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const { listStoreProducts } = vi.hoisted(() => ({
  listStoreProducts: vi.fn(),
}));

vi.mock('../api/store', () => ({
  listStoreProducts,
}));

import { useStoreProducts } from './useStoreProducts';

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function Probe() {
  useStoreProducts();
  return null;
}

describe('useStoreProducts', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listStoreProducts.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it('fetches only once when called without a query object', async () => {
    listStoreProducts.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    await act(async () => {
      root.render(<Probe />);
      await flush();
      await flush();
    });

    expect(listStoreProducts).toHaveBeenCalledTimes(1);
    expect(listStoreProducts).toHaveBeenCalledWith({});

    await act(async () => {
      await flush();
      await flush();
    });

    expect(listStoreProducts).toHaveBeenCalledTimes(1);
  });
});
