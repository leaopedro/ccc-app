import type { RefObject } from 'react';
import type { View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exportTicketImage } from './export-ticket-image.web';

function makeRef(): RefObject<View | null> {
  return { current: {} as View };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exportTicketImage (web)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes window.print and resolves to printed', async () => {
    const print = vi.fn();
    vi.stubGlobal('window', { print } as unknown as Window);

    const result = await exportTicketImage(makeRef());

    expect(print).toHaveBeenCalledTimes(1);
    expect(result).toBe('printed');
  });

  it('returns error when window.print is unavailable', async () => {
    vi.stubGlobal('window', {} as unknown as Window);

    const result = await exportTicketImage(makeRef());
    expect(result).toBe('error');
  });

  it('returns error when print throws', async () => {
    const print = vi.fn(() => {
      throw new Error('blocked');
    });
    vi.stubGlobal('window', { print } as unknown as Window);

    const result = await exportTicketImage(makeRef());
    expect(result).toBe('error');
  });
});
