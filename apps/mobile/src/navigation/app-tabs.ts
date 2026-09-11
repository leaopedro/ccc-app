import { cartCopy } from '../copy/cart';
import { resolveStoreSlot } from '../store/runtime';

export const APP_TAB_SPECS = [
  { name: 'inicio', title: 'Início', visible: true },
  { name: 'events', title: 'Eventos', visible: true },
  { name: 'store', title: 'Loja', visible: true },
  { name: 'cart', title: cartCopy.title, visible: true },
  { name: 'tickets', title: 'Ingressos', visible: true },
  { name: 'garage', title: 'Garagem', visible: false },
  { name: 'profile', title: 'Perfil', visible: true },
] as const;

// Task 14 fix round 1 (Important 1): name-based lookup so inserting or
// reordering an entry in APP_TAB_SPECS can never mislabel a tab. A positional
// APP_TAB_SPECS[n] read at a call site compiles fine even when n points at
// the wrong entry after a reorder. This removes that hazard class instead of
// merely testing for it.
export function tabTitle(name: (typeof APP_TAB_SPECS)[number]['name']): string {
  const tab = APP_TAB_SPECS.find((t) => t.name === name);
  if (!tab) throw new Error(`Unknown tab: ${name}`);
  return tab.title;
}

export function getCartTabBadge(itemCount: number) {
  return itemCount > 0 ? cartCopy.badge(itemCount) : undefined;
}

export function getPrimaryTabName(runtimeStoreEnabled: boolean | null): 'store' | 'tickets' {
  return resolveStoreSlot(runtimeStoreEnabled);
}

// Tapping the tab you are already on used to replay the navigation
// animation: the tabPress handlers `replace` unconditionally, so the router
// re-entered the same route. Replace only when the current path is not
// already the tab root. Deep routes inside the tab still pop back.
export function shouldReplaceOnTabPress(pathname: string, tabRoot: string): boolean {
  const strip = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
  return strip(pathname) !== strip(tabRoot);
}
