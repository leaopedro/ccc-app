import { describe, expect, it } from 'vitest';

import { resolveOrderKindLabel } from './orders-kind-label';

describe('resolveOrderKindLabel', () => {
  it('ticket-only single item → Evento', () => {
    expect(resolveOrderKindLabel(true, false, 'ticket')).toBe('Evento');
  });

  it('ticket-only multi-item cart (kind=mixed) → Evento', () => {
    // kind=mixed is a settlement invariant for any multi-item cart;
    // two ticket line items must still show "Evento", not "Evento + loja"
    expect(resolveOrderKindLabel(true, false, 'mixed')).toBe('Evento');
  });

  it('ticket + store product → Evento + loja', () => {
    expect(resolveOrderKindLabel(true, true, 'mixed')).toBe('Evento + loja');
  });

  it('store product only → Loja', () => {
    expect(resolveOrderKindLabel(false, true, 'product')).toBe('Loja');
  });

  it('extras only → Extras', () => {
    expect(resolveOrderKindLabel(false, false, 'extras_only')).toBe('Extras');
  });

  it('ticket + extras (no store items) → Evento', () => {
    // extras are add-ons to ticket orders; containsStoreItems stays false
    expect(resolveOrderKindLabel(true, false, 'mixed')).toBe('Evento');
  });
});
