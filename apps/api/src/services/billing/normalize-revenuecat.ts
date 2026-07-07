import type { BillingEvent } from './types.js';

// RC v2 webhook payload shape — only the fields read by the normalizer.
// Full RC docs: https://www.revenuecat.com/docs/webhooks
type RCEventPayload = {
  event: {
    type: string;
    id: string;
    app_user_id: string; // canon §F8 garageId resolution rule: app_user_id IS the garageId
    product_id: string;
    country_code: string;
    event_timestamp_ms: number;
    transaction_id: string;
    original_transaction_id: string;
    expiration_at_ms: number | null;
    period_type: string; // 'NORMAL' | 'TRIAL' | 'INTRO' (v1 only honors NORMAL)
    price_in_purchased_currency: number | null;
    currency: string;
    purchased_at_ms: number;
  };
};

// Sentinel returned when country_code != 'BR' (canon §F8.9).
// The route logs + acks without writing Membership/Invoice rows.
export type RCNonBrSentinel = {
  kind: '__non_br__';
  providerEventId: string;
  country_code: string;
};

export type NormalizeRCResult = BillingEvent | RCNonBrSentinel | null;

// product_id → cadence mapping. v1 only ships monthly + annual.
const resolveCadence = (productId: string): 'monthly' | 'annual' => {
  if (productId.includes('annual') || productId.includes('yearly') || productId.includes('year')) {
    return 'annual';
  }
  return 'monthly';
};

/**
 * Maps a raw RevenueCat webhook event payload to a normalized `BillingEvent`,
 * a non-BR sentinel (canon §F8.9), or `null` for event types intentionally
 * ignored in v1 (`TRANSFER`, `SUBSCRIPTION_PAUSED`, unknowns).
 */
export function normalizeRevenueCatEvent(rawEvent: unknown): NormalizeRCResult {
  const payload = rawEvent as RCEventPayload | undefined;
  const e = payload?.event;
  if (!e || typeof e.type !== 'string') return null;

  const {
    type,
    id: providerEventId,
    app_user_id: garageId,
    product_id,
    country_code,
    transaction_id,
    original_transaction_id,
    expiration_at_ms,
    purchased_at_ms,
    price_in_purchased_currency,
    currency,
  } = e;

  // Canon §F8.9: non-BR storefront — return sentinel so the route can log + ack
  // without writing Membership/Invoice rows. v1 scope is BR-only.
  if (country_code !== 'BR') {
    return { kind: '__non_br__', providerEventId, country_code };
  }

  const currentPeriodStart = new Date(purchased_at_ms);
  const currentPeriodEnd = expiration_at_ms ? new Date(expiration_at_ms) : new Date(0);
  const cadence = resolveCadence(product_id);

  // Apple/RC path (canon §F8.1): devFeePercent = 0, devFeeAmountCents = 0,
  // baseAmountCents = grossAmountCents. Apple commission is opaque; not modelled
  // as a devfee here.
  //
  // RC docs: price_in_purchased_currency is a Double in DECIMAL currency units
  // (e.g. 29.90 for BRL 29.90), not minor units. Multiply by 100 to convert to
  // cents. Field can be null/undefined when price is unknown — fall back to 0.
  // Negative values (refunds) are supported by Math.round.
  // https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
  const grossAmountCents =
    price_in_purchased_currency == null ? 0 : Math.round(price_in_purchased_currency * 100);
  const pricing = {
    baseAmountCents: grossAmountCents,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    grossAmountCents,
    currency: currency || 'BRL',
  };

  const invoice = {
    providerInvoiceRef: transaction_id,
    providerTransactionRef: original_transaction_id,
    periodStart: currentPeriodStart,
    periodEnd: currentPeriodEnd,
    paidAt: currentPeriodStart,
  };

  switch (type) {
    case 'INITIAL_PURCHASE':
      return {
        kind: 'subscription.activated',
        provider: 'apple_revenuecat',
        providerCustomerRef: garageId, // app_user_id IS the garageId
        providerSubRef: original_transaction_id,
        garageId,
        tier: 'gold', // gold-only v1 (spec §1)
        cadence,
        currentPeriodStart,
        currentPeriodEnd,
        pricing,
        invoice,
      } satisfies BillingEvent;

    case 'RENEWAL':
      return {
        kind: 'subscription.renewed',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
        currentPeriodStart,
        currentPeriodEnd,
        pricing,
        invoice,
      } satisfies BillingEvent;

    case 'PRODUCT_CHANGE':
      return {
        kind: 'subscription.tier_changed',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
        tier: 'gold',
        cadence,
        pricing,
      } satisfies BillingEvent;

    case 'CANCELLATION':
      // cancel_at_period_end — entitlement valid until expiry (spec §3.4).
      return {
        kind: 'subscription.cancelled',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
        cancelledAt: new Date(),
      } satisfies BillingEvent;

    case 'UNCANCELLATION':
      return {
        kind: 'subscription.uncancelled',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
      } satisfies BillingEvent;

    case 'EXPIRATION':
      return {
        kind: 'subscription.expired',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
        cancelledAt: new Date(),
      } satisfies BillingEvent;

    case 'BILLING_ISSUE':
      return {
        kind: 'subscription.past_due',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
      } satisfies BillingEvent;

    case 'TRANSFER':
    case 'SUBSCRIPTION_PAUSED':
    default:
      // Logged + acked without state change in v1 (spec §3.4).
      return null;
  }
}
