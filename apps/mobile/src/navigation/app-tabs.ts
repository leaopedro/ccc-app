import { cartCopy } from '../copy/cart';
import { resolveStoreSlot } from '../store/runtime';

export const APP_TAB_SPECS = [
  { name: 'events', title: 'Eventos', visible: true },
  { name: 'store', title: 'Loja', visible: true },
  { name: 'cart', title: cartCopy.title, visible: true },
  { name: 'tickets', title: 'Ingressos', visible: true },
  { name: 'garage', title: 'Garagem', visible: false },
  { name: 'profile', title: 'Perfil', visible: true },
] as const;

export function getCartTabBadge(itemCount: number) {
  return itemCount > 0 ? cartCopy.badge(itemCount) : undefined;
}

export function getPrimaryTabName(runtimeStoreEnabled: boolean | null): 'store' | 'tickets' {
  return resolveStoreSlot(runtimeStoreEnabled);
}
