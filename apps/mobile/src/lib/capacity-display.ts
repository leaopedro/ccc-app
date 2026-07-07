import type { CapacityDisplayDescriptor } from '@jdm/shared/general-settings';

export function capacityLabel(descriptor: CapacityDisplayDescriptor): string | null {
  if (descriptor.status === 'sold_out') return 'Esgotado';
  if (descriptor.status === 'unavailable') return 'Indisponível';
  if (descriptor.mode === 'hidden') return null;
  if (descriptor.showAbsolute && descriptor.remaining !== null)
    return `${descriptor.remaining} disponíveis`;
  if (descriptor.showPercentage && descriptor.remainingPercent !== null)
    return `${descriptor.remainingPercent}% disponíveis`;
  return null;
}

export function isCapacityBlocked(descriptor: CapacityDisplayDescriptor): boolean {
  return descriptor.status !== 'available';
}
