import type { NotificationDestination } from '@jdm/shared/notifications';
import { Linking } from 'react-native';

import { captureException } from '~/lib/sentry';

export type DestinationResult =
  | { kind: 'internal'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' };

export const resolveDestination = (
  destination: NotificationDestination | null,
): DestinationResult => {
  if (!destination || destination.kind === 'none') return { kind: 'none' };
  if (destination.kind === 'tickets') return { kind: 'internal', path: '/tickets' };
  if (destination.kind === 'event')
    return { kind: 'internal', path: `/events/${destination.eventId}` };
  if (destination.kind === 'product')
    return { kind: 'internal', path: `/store/${destination.productId}` };
  if (destination.kind === 'internal_path') return { kind: 'internal', path: destination.path };
  if (destination.kind === 'external_url') return { kind: 'external', url: destination.url };
  return { kind: 'none' };
};

export const openDestination = async (
  destination: NotificationDestination | null,
  push: (path: string) => void,
): Promise<void> => {
  const resolved = resolveDestination(destination);
  if (resolved.kind === 'none') return;
  if (resolved.kind === 'internal') {
    push(resolved.path);
    return;
  }
  try {
    const supported = await Linking.canOpenURL(resolved.url);
    if (!supported) {
      captureException(new Error(`Cannot open URL: ${resolved.url}`), 'notification.destination');
      return;
    }
    await Linking.openURL(resolved.url);
  } catch (err) {
    captureException(err, 'notification.destination.open');
  }
};
