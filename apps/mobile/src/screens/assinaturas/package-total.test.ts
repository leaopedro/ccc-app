import { describe, expect, it } from 'vitest';

import { packageTotalCents } from './package-total';

const modules = [
  { key: 'detailing', monthlyDeltaCents: 15000 },
  { key: 'oficina', monthlyDeltaCents: 50000 },
];

describe('packageTotalCents', () => {
  it('returns the base alone when nothing is selected', () => {
    expect(packageTotalCents(89000, modules, new Set())).toEqual({
      baseCents: 89000,
      addonsCents: 0,
      totalCents: 89000,
    });
  });

  it('sums only the selected modules', () => {
    expect(packageTotalCents(89000, modules, new Set(['oficina']))).toEqual({
      baseCents: 89000,
      addonsCents: 50000,
      totalCents: 139000,
    });
  });

  it('treats a null base as zero', () => {
    expect(packageTotalCents(null, modules, new Set(['detailing']))).toEqual({
      baseCents: 0,
      addonsCents: 15000,
      totalCents: 15000,
    });
  });

  it('ignores a selected key that is not in the catalog', () => {
    expect(packageTotalCents(89000, modules, new Set(['fantasma']))).toEqual({
      baseCents: 89000,
      addonsCents: 0,
      totalCents: 89000,
    });
  });
});
