import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { APP_TAB_SPECS, getCartTabBadge, getPrimaryTabName } = await import('./app-tabs');

describe('APP_TAB_SPECS', () => {
  it('keeps the approved bottom-nav order, hiding only garage from the static spec', () => {
    expect(
      APP_TAB_SPECS.filter((tab) => tab.visible).map((tab) => `${tab.name}:${tab.title}`),
    ).toEqual([
      'events:Eventos',
      'store:Loja',
      'cart:Carrinho',
      'tickets:Ingressos',
      'profile:Perfil',
    ]);

    expect(APP_TAB_SPECS.find((tab) => tab.name === 'garage')).toMatchObject({
      title: 'Garagem',
      visible: false,
    });

    expect(APP_TAB_SPECS.find((tab) => tab.name === 'cart')).toMatchObject({
      title: 'Carrinho',
      visible: true,
    });
  });

  it('restores Ingressos into the Loja slot when the runtime store killswitch is off', () => {
    expect(getPrimaryTabName(false)).toBe('tickets');
  });

  it('keeps Loja in slot 1 when the runtime store is available', () => {
    expect(getPrimaryTabName(true)).toBe('store');
    expect(getPrimaryTabName(null)).toBe('store');
  });
});

describe('getCartTabBadge', () => {
  it('returns no badge for an empty cart', () => {
    expect(getCartTabBadge(0)).toBeUndefined();
  });

  it('returns the live cart count badge for populated carts', () => {
    expect(getCartTabBadge(3)).toBe('3');
    expect(getCartTabBadge(12)).toBe('9+');
  });
});
