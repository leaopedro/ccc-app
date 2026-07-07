export type RCEntitlement = {
  expiresDate: string | null; // ISO-8601 or null (lifetime)
  productIdentifier: string;
  purchaseDate: string;
};

export type RCSubscriber = {
  entitlements: Record<string, RCEntitlement>;
  subscriptions: Record<
    string,
    {
      expiresDate: string | null;
      periodType: string; // 'normal' | 'trial' | 'intro'
      productIdentifier: string;
      store: string; // 'app_store' | 'play_store' | 'stripe' | …
    }
  >;
};

export type RevenueCatClient = {
  getSubscriber: (appUserId: string) => Promise<RCSubscriber>;
};

/**
 * Minimal RevenueCat REST client — `GET /v1/subscribers/{app_user_id}`. The
 * reconciliation sweep (chunk F8.12) calls this once per stale RC-backed
 * PremiumMembership row to detect drift between RC's authoritative
 * entitlement state and the local DB snapshot. No mutation endpoints are
 * needed in v1.
 */
export const buildRevenueCatClient = (apiKey: string): RevenueCatClient => {
  return {
    getSubscriber: async (appUserId) => {
      const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`RevenueCat API error ${res.status} for subscriber ${appUserId}`);
      }
      const body = (await res.json()) as { subscriber: RCSubscriber };
      return body.subscriber;
    },
  };
};
