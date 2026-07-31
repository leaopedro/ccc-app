import type { MySubscriptionResponse } from '@ccc/shared/premium-subscription';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '~/api/client';
import { getMyPremiumSubscription } from '~/api/premium-catalog';
import { PREMIUM_BILLING_ENABLED as billingEnabled } from '~/lib/premium-runtime';

type UsePremiumSubscriptionResult = {
  subscription: MySubscriptionResponse | null;
  loading: boolean;
  error: boolean;
  /** Billing is switched off (flag or 503) — show an informative state, not an error. */
  billingUnavailable: boolean;
  refresh: () => Promise<void>;
};

// GET /api/me/premium/subscription (authed). Gated on the billing flag; a 503
// from the API is treated as "billing unavailable" rather than a hard error.
export function usePremiumSubscription(): UsePremiumSubscriptionResult {
  const [subscription, setSubscription] = useState<MySubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(billingEnabled);
  const [error, setError] = useState(false);
  const [billingUnavailable, setBillingUnavailable] = useState(!billingEnabled);

  const refresh = useCallback(async () => {
    if (!billingEnabled) {
      setBillingUnavailable(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    setBillingUnavailable(false);
    try {
      setSubscription(await getMyPremiumSubscription());
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setBillingUnavailable(true);
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { subscription, loading, error, billingUnavailable, refresh };
}
