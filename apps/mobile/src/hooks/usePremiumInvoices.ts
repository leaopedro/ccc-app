import type { PremiumInvoicesResponse } from '@ccc/shared/premium-subscription';
import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '~/api/client';
import { listPremiumInvoices } from '~/api/premium-catalog';

type Extra = { premiumBillingEnabled?: boolean };

const billingEnabled =
  (Constants.expoConfig?.extra as Extra | undefined)?.premiumBillingEnabled ?? false;

type UsePremiumInvoicesResult = {
  invoices: PremiumInvoicesResponse['invoices'];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

/**
 * GET /api/me/premium/invoices. Mirrors usePremiumSubscription: gated on the
 * billing flag, and a 503 is not an error — it just means no history to show.
 */
export function usePremiumInvoices(): UsePremiumInvoicesResult {
  const [invoices, setInvoices] = useState<PremiumInvoicesResponse['invoices']>([]);
  const [loading, setLoading] = useState(billingEnabled);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!billingEnabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const res = await listPremiumInvoices();
      setInvoices(res.invoices);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 503)) setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { invoices, loading, error, refresh };
}
