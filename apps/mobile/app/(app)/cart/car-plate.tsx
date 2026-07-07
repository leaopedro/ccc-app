import type { CartItemInput } from '@jdm/shared/cart';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { updateCartItem, upsertCartItem } from '~/api/cart';
import { useCart } from '~/cart/context';
import { getCartAddErrorMessage } from '~/cart/error-message';
import { cartCopy } from '~/copy/cart';
import { CarPlatePicker } from '~/screens/cart/CarPlatePicker';

const isWeb = Platform.OS === 'web';

function showError(message: string) {
  if (isWeb && typeof window !== 'undefined') {
    window.alert(message);
  } else {
    Alert.alert(message);
  }
}

export default function CartCarPlateScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    eventId?: string;
    tierId?: string;
    itemId?: string;
    initialCarId?: string;
    initialPlate?: string;
  }>();
  const { refresh } = useCart();
  const [submitting, setSubmitting] = useState(false);

  const eventId = typeof params.eventId === 'string' ? params.eventId : '';
  const tierId = typeof params.tierId === 'string' ? params.tierId : '';
  const itemId = typeof params.itemId === 'string' ? params.itemId : undefined;
  const initialCarId = typeof params.initialCarId === 'string' ? params.initialCarId : undefined;
  const initialPlate = typeof params.initialPlate === 'string' ? params.initialPlate : undefined;

  const handleSubmit = useCallback(
    async ({ carId, licensePlate }: { carId: string; licensePlate: string }) => {
      if (!eventId || !tierId) {
        showError(cartCopy.errors.add);
        return;
      }
      setSubmitting(true);
      try {
        const input: CartItemInput = {
          eventId,
          tierId,
          source: 'purchase',
          kind: 'ticket',
          quantity: 1,
          tickets: [{ extras: [], carId, licensePlate }],
          metadata: { source: 'mobile' },
        };
        if (itemId) {
          await updateCartItem(itemId, input);
        } else {
          await upsertCartItem(input);
        }
        await refresh();
        router.replace('/cart');
      } catch (error: unknown) {
        showError(getCartAddErrorMessage(error));
      } finally {
        setSubmitting(false);
      }
    },
    [eventId, tierId, itemId, refresh, router],
  );

  return (
    <CarPlatePicker
      {...(initialCarId !== undefined ? { initialCarId } : {})}
      {...(initialPlate !== undefined ? { initialPlate } : {})}
      submitting={submitting}
      onSubmit={(value) => void handleSubmit(value)}
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/cart');
      }}
    />
  );
}
