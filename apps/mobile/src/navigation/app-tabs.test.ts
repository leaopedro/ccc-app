import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { APP_TAB_SPECS, getCartTabBadge, getPrimaryTabName, tabTitle } = await import('./app-tabs');

describe('APP_TAB_SPECS', () => {
  it('keeps the approved bottom-nav order, hiding only garage from the static spec', () => {
    expect(
      APP_TAB_SPECS.filter((tab) => tab.visible).map((tab) => `${tab.name}:${tab.title}`),
    ).toEqual([
      'inicio:Início',
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

  // Task 14: inicio must be the first entry so it is the leftmost tab.
  // Catches: the entry existing but landing at a different index (e.g.
  // pushed instead of unshifted, or inserted after events).
  it('puts inicio first, at index 0', () => {
    expect(APP_TAB_SPECS[0]).toEqual({ name: 'inicio', title: 'Início', visible: true });
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

describe('tabTitle', () => {
  it('looks up the title by tab name, not by position', () => {
    expect(tabTitle('inicio')).toBe('Início');
    expect(tabTitle('events')).toBe('Eventos');
    expect(tabTitle('cart')).toBe('Carrinho');
    expect(tabTitle('garage')).toBe('Garagem');
    expect(tabTitle('profile')).toBe('Perfil');
  });
});
