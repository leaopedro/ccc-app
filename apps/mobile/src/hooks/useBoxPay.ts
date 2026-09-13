import type { BoxCheckoutRequest, BoxCheckoutResponse } from '@ccc/shared/box';
import { useState } from 'react';

import { checkoutBox } from '~/api/box';
import { ApiError } from '~/api/client';
import type { BoxPayResult } from '~/screens/caixa/pay-result';

type Outcome = { result: BoxPayResult; data?: BoxCheckoutResponse };

export function useBoxPay(): {
  checkout: (method?: BoxCheckoutRequest['method']) => Promise<Outcome>;
  loading: boolean;
} {
  const [loading, setLoading] = useState(false);

  const checkout = async (method: BoxCheckoutRequest['method'] = 'pix'): Promise<Outcome> => {
    setLoading(true);
    try {
      const data = await checkoutBox(method);
      return { result: 'ok', data };
    } catch (e) {
      if (e instanceof ApiError) {
        const code = (e.body as { error?: string } | undefined)?.error;
        if (code === 'box_locked') return { result: 'locked' };
        if (code === 'box_not_awaiting') return { result: 'not_awaiting' };
        if (e.status === 403) return { result: 'not_eligible' };
        if (e.status === 404) return { result: 'not_found' };
        if (e.status === 503) return { result: 'unavailable' };
      }
      return { result: 'error' };
    } finally {
      setLoading(false);
    }
  };

  return { checkout, loading };
}
