import { brand } from '@ccc/design';
import type { CreateWebCheckoutRequest } from '@ccc/shared/orders';
import { Platform } from 'react-native';

import { createWebCheckout } from '~/api/orders';
import { setPendingCheckoutUrl } from '~/cart/web-pending-checkout';

export const isWeb = Platform.OS === 'web';

function getReturnUrls(): { successUrl: string; cancelUrl: string } {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = `${origin}/events/buy/checkout-return`;
  return {
    successUrl: base,
    cancelUrl: `${base}?cancelled=true`,
  };
}

export async function startWebCheckout(
  order: Omit<CreateWebCheckoutRequest, 'successUrl' | 'cancelUrl'>,
): Promise<void> {
  const { successUrl, cancelUrl } = getReturnUrls();
  const result = await createWebCheckout({ ...order, successUrl, cancelUrl });
  sessionStorage.setItem(`${brand.app.storagePrefix}:pendingOrderId`, result.orderId);
  setPendingCheckoutUrl(result.orderId, result.checkoutUrl);
  window.location.href = result.checkoutUrl;
}
