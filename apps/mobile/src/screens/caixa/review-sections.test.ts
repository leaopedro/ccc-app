import { describe, expect, it } from 'vitest';

import { canConfirm } from './review-sections';

const withItem = {
  items: [{ quantity: 1 }],
  partnerItems: [] as { quantity: number }[],
};
const empty = { items: [] as { quantity: number }[], partnerItems: [] as { quantity: number }[] };

describe('canConfirm', () => {
  it('needs both a non-empty selection and an address', () => {
    expect(canConfirm(withItem, 'a1')).toBe(true);
    expect(canConfirm(withItem, null)).toBe(false);
    expect(canConfirm(empty, 'a1')).toBe(false);
  });

  it('counts partner-only selections', () => {
    expect(canConfirm({ items: [], partnerItems: [{ quantity: 1 }] }, 'a1')).toBe(true);
  });
});
