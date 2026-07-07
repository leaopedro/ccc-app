import type { WebhookEvent } from '../stripe/index.js';

import type { BillingEvent } from './types.js';

/** Returned by normalizeStripeEvent for charge.refunded on a subscription invoice.
 * This is NOT a BillingEvent — the route handles it separately (canon §F8.10). */
export type StripeRefundMarker = {
  kind: 'charge.refunded.sub';
  invoiceRef: string;
  refundedAmountCents: number;
  totalAmountCents: number;
};

export type NormalizeStripeResult = BillingEvent | StripeRefundMarker | null;

/** Extract cadence from a Stripe Price recurring interval. */
function cadenceFromInterval(interval: string | undefined): 'monthly' | 'annual' {
  return interval === 'year' ? 'annual' : 'monthly';
}

/** Derive tier from Price metadata. v1 only has 'gold'; extend if tiers expand. */
function tierFromPrice(_priceMetadata: Record<string, string>): 'gold' {
  // v1 single tier. When additional tiers ship, read `priceMetadata.tier`.
  return 'gold';
}

type StripeInvoiceLineForPricing = {
  price: { metadata: Record<string, string>; recurring?: { interval?: string } };
};

/** Build pricing snapshot from Stripe invoice + Price.
 *
 * §F8.1 — devFeePercent is snapshotted from Price.metadata.devFeePercent.
 * grossAmountCents = invoice.amount_paid (what the customer was charged).
 * devFeeAmountCents = Math.round(baseAmountCents * devFeePercent / 100).
 */
function pricingFromInvoice(invoice: {
  amount_paid: number;
  currency: string;
  lines: { data: StripeInvoiceLineForPricing[] };
}) {
  const linePrice = invoice.lines.data[0]?.price;
  const meta = linePrice?.metadata ?? {};
  const baseAmountCents = parseInt(meta.baseAmountCents ?? '0', 10);
  const devFeePercent = parseInt(meta.devFeePercent ?? '0', 10);
  const devFeeAmountCents = Math.round((baseAmountCents * devFeePercent) / 100);
  return {
    baseAmountCents,
    devFeePercent,
    devFeeAmountCents,
    grossAmountCents: invoice.amount_paid,
    currency: (invoice.currency ?? 'brl').toUpperCase(),
  };
}

/**
 * Maps a raw Stripe webhook event payload to a normalized `BillingEvent`,
 * a refund marker, or `null` for event types that are intentionally ignored.
 *
 * §3.3 (Stripe event mapping table) drives the discriminator logic:
 *   - `invoice.paid` + billing_reason=subscription_create → activated
 *   - `invoice.paid` + billing_reason=subscription_cycle → renewed
 *   - `invoice.payment_failed` → past_due
 *   - `customer.subscription.updated` + cancel_at_period_end flip true → cancelled
 *   - `customer.subscription.updated` + cancel_at_period_end flip false → uncancelled
 *   - `customer.subscription.updated` + items.price.id change → tier_changed
 *   - `customer.subscription.deleted` → expired
 *   - `charge.refunded` (with invoice) → StripeRefundMarker (NOT a BillingEvent)
 *   - everything else → null
 *
 * The `subscription.activated` event leaves `garageId` as an empty placeholder
 * because the normalizer has no DB / Stripe API access; the webhook route
 * resolves `garageId` from Stripe Customer.metadata and patches it in before
 * dispatch.
 */
export function normalizeStripeEvent(event: WebhookEvent): NormalizeStripeResult {
  const obj = event.data.object;

  if (event.type === 'invoice.paid') {
    const invoice = obj as {
      id: string;
      subscription: string;
      customer: string;
      billing_reason: string;
      amount_paid: number;
      currency: string;
      period_start: number;
      period_end: number;
      status_transitions?: { paid_at?: number | null };
      lines: { data: StripeInvoiceLineForPricing[] };
    };

    if (!invoice.subscription) return null;

    const linePrice = invoice.lines.data[0]?.price;
    if (!linePrice) return null;

    const pricing = pricingFromInvoice(invoice);
    const cadence = cadenceFromInterval(linePrice.recurring?.interval);
    const tier = tierFromPrice(linePrice.metadata ?? {});
    const paidAt = invoice.status_transitions?.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000)
      : new Date();

    const invoiceShape = {
      providerInvoiceRef: invoice.id,
      periodStart: new Date(invoice.period_start * 1000),
      periodEnd: new Date(invoice.period_end * 1000),
      paidAt,
    };

    if (invoice.billing_reason === 'subscription_create') {
      return {
        kind: 'subscription.activated',
        provider: 'stripe',
        providerCustomerRef: invoice.customer,
        providerSubRef: invoice.subscription,
        // garageId placeholder — route patches it from Stripe Customer.metadata.
        garageId: '',
        tier,
        cadence,
        currentPeriodStart: new Date(invoice.period_start * 1000),
        currentPeriodEnd: new Date(invoice.period_end * 1000),
        pricing,
        invoice: invoiceShape,
      } satisfies BillingEvent & { kind: 'subscription.activated' };
    }

    if (invoice.billing_reason === 'subscription_cycle') {
      return {
        kind: 'subscription.renewed',
        provider: 'stripe',
        providerSubRef: invoice.subscription,
        currentPeriodStart: new Date(invoice.period_start * 1000),
        currentPeriodEnd: new Date(invoice.period_end * 1000),
        pricing,
        invoice: invoiceShape,
      } satisfies BillingEvent & { kind: 'subscription.renewed' };
    }

    return null;
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = obj as { subscription?: string; customer?: string };
    if (!invoice.subscription) return null;
    return {
      kind: 'subscription.past_due',
      provider: 'stripe',
      providerSubRef: invoice.subscription,
    } satisfies BillingEvent & { kind: 'subscription.past_due' };
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = obj as {
      id: string;
      customer: string;
      cancel_at_period_end: boolean;
      current_period_start: number;
      current_period_end: number;
      canceled_at: number | null;
      items: {
        data: Array<{
          price: {
            id: string;
            metadata: Record<string, string>;
            recurring?: { interval?: string };
          };
        }>;
      };
      previous_attributes?: {
        cancel_at_period_end?: boolean;
        items?: { data: Array<{ price: { id: string } }> };
      };
    };

    const prev = sub.previous_attributes ?? {};

    // Discriminator 1: cancel_at_period_end flip
    if (prev.cancel_at_period_end !== undefined) {
      if (sub.cancel_at_period_end === true && prev.cancel_at_period_end === false) {
        return {
          kind: 'subscription.cancelled',
          provider: 'stripe',
          providerSubRef: sub.id,
          cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(),
        } satisfies BillingEvent & { kind: 'subscription.cancelled' };
      }
      if (sub.cancel_at_period_end === false && prev.cancel_at_period_end === true) {
        return {
          kind: 'subscription.uncancelled',
          provider: 'stripe',
          providerSubRef: sub.id,
        } satisfies BillingEvent & { kind: 'subscription.uncancelled' };
      }
    }

    // Discriminator 2: price swap (cadence or tier change)
    const currentPriceId = sub.items.data[0]?.price.id;
    const prevPriceId = prev.items?.data[0]?.price.id;
    if (prevPriceId && currentPriceId && prevPriceId !== currentPriceId) {
      const currentPrice = sub.items.data[0]!.price;
      const cadence = cadenceFromInterval(currentPrice.recurring?.interval);
      const tier = tierFromPrice(currentPrice.metadata ?? {});
      const baseAmountCents = parseInt(currentPrice.metadata?.baseAmountCents ?? '0', 10);
      const devFeePercent = parseInt(currentPrice.metadata?.devFeePercent ?? '0', 10);
      const devFeeAmountCents = Math.round((baseAmountCents * devFeePercent) / 100);
      return {
        kind: 'subscription.tier_changed',
        provider: 'stripe',
        providerSubRef: sub.id,
        tier,
        cadence,
        pricing: {
          baseAmountCents,
          devFeePercent,
          devFeeAmountCents,
          grossAmountCents: baseAmountCents + devFeeAmountCents,
          currency: 'BRL',
        },
      } satisfies BillingEvent & { kind: 'subscription.tier_changed' };
    }

    return null;
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = obj as {
      id: string;
      customer: string;
      canceled_at: number | null;
    };
    return {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: sub.id,
      cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(),
    } satisfies BillingEvent & { kind: 'subscription.expired' };
  }

  if (event.type === 'charge.refunded') {
    const charge = obj as {
      invoice?: string | null;
      amount: number;
      amount_refunded: number;
    };
    // Only handle if this charge is linked to a subscription invoice.
    // One-time payment charges have invoice=null — those are handled by
    // the existing stripe-webhook.ts route (canon §F8.10 scope = sub invoices).
    if (!charge.invoice) return null;

    return {
      kind: 'charge.refunded.sub',
      invoiceRef: charge.invoice,
      refundedAmountCents: charge.amount_refunded,
      totalAmountCents: charge.amount,
    };
  }

  // customer.subscription.created and all other event types → ignore
  return null;
}
