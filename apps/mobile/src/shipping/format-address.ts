import type { ShippingAddressRecord } from '@jdm/shared/store';

export function formatShippingAddress(address: ShippingAddressRecord): string {
  const base = `${address.street}, ${address.number}`;
  const neighborhood = address.neighborhood.trim().length > 0 ? ` · ${address.neighborhood}` : '';
  const city = ` · ${address.city}/${address.stateCode}`;
  return `${base}${neighborhood}${city}`;
}
