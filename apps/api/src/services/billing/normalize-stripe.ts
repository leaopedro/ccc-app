import type { WebhookEvent } from '../stripe/index.js';

import type { BillingEvent, BillingLine } from './types.js';

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

type StripeInvoiceLine = {
  price: { id: string; metadata?: Record<string, string>; recurring?: { interval?: string } };
  amount?: number;
  subscription_item?: string | null;
};

/**
 * Pricing shell from the invoice itself.
 *
 * baseAmountCents / devFeePercent / devFeeAmountCents are PLACEHOLDERS — with a
 * multi-line subscription the normalizer cannot tell which line is the plan.
 * The webhook route resolves the plan line against PremiumPlanPrice and patches
 * these three, exactly as it already patches garageId (see the header comment
 * on normalizeStripeEvent). grossAmountCents and currency are real.
 */
function pricingFromInvoice(invoice: { amount_paid: number; currency: string }) {
  return {
    baseAmountCents: 0,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    grossAmountCents: invoice.amount_paid,
    currency: (invoice.currency ?? 'brl').toUpperCase(),
  };
}

/** Map raw Stripe invoice lines to the provider-neutral BillingLine shape. */
function linesFromInvoice(lines: StripeInvoiceLine[]): BillingLine[] {
  return lines.map((line) => ({
    priceRef: line.price.id,
    amountCents: line.amount ?? 0,
    subscriptionItemRef: line.subscription_item ?? null,
    metadata: line.price.metadata ?? {},
  }));
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
      lines: { data: StripeInvoiceLine[] };
    };

    if (!invoice.subscription) return null;

    const linePrice = invoice.lines.data[0]?.price;
    if (!linePrice) return null;

    const pricing = pricingFromInvoice(invoice);
    const lines = linesFromInvoice(invoice.lines.data);
    // `cadence` here is ALSO effectively a placeholder, same as `tier` below:
    // it reads lines.data[0]'s recurring.interval, which is invoice-line-order
    // dependent (an add-on line could sort before the plan line). The route
    // unconditionally overwrites it from the resolved PremiumPlanPrice's own
    // `cadence` column before dispatch (subscription.activated only — renewed
    // does not carry a cadence field). `tier` gets the explicit placeholder
    // comment below because it additionally carries the load-bearing safety
    // risk of being a valid enum value ('bronze') on its own; a wrong cadence
    // just gets silently corrected downstream, a wrong tier would not.
    const cadence = cadenceFromInterval(linePrice.recurring?.interval);
    // Placeholder — the route patches this from the catalog, like garageId.
    const tier = 'bronze' as const;
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
        lines,
        addons: [],
        addonsAmountCents: 0,
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
        lines,
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
      // cadence here is also a placeholder, same reasoning as the invoice.paid
      // branch above: the route overwrites it from the resolved
      // PremiumPlanPrice's own `cadence` column, since items.data[0] is a
      // single-item read that still shouldn't be trusted over the catalog.
      const cadence = cadenceFromInterval(currentPrice.recurring?.interval);
      return {
        kind: 'subscription.tier_changed',
        provider: 'stripe',
        providerSubRef: sub.id,
        priceRef: currentPrice.id,
        priceMetadata: currentPrice.metadata,
        // Placeholders — the route resolves tier + cadence + pricing from the
        // catalog and drops the event entirely when the swapped price is an
        // add-on.
        tier: 'bronze',
        cadence,
        pricing: {
          baseAmountCents: 0,
          devFeePercent: 0,
          devFeeAmountCents: 0,
          grossAmountCents: 0,
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
