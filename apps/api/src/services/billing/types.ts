import type { GaragePremiumTier, PremiumCadence, PremiumProvider } from '@prisma/client';

/** Pricing snapshot carried on activation, renewal, and tier_changed events. */
export type BillingPricing = {
  baseAmountCents: number;
  devFeePercent: number; // canon §F8.1: snapshotted from Stripe Price.metadata; 0 for Apple/RC
  devFeeAmountCents: number;
  grossAmountCents: number;
  currency: string; // 'BRL' v1
};

/** Invoice record carried on activated and renewed events. */
export type BillingInvoice = {
  providerInvoiceRef: string;
  providerTransactionRef?: string; // Apple original_transaction_id (iOS only)
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date;
};

export type BillingEvent =
  | {
      kind: 'subscription.activated';
      provider: PremiumProvider;
      providerCustomerRef: string;
      providerSubRef: string;
      garageId: string;
      tier: GaragePremiumTier;
      cadence: PremiumCadence;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      pricing: BillingPricing;
      invoice: BillingInvoice;
    }
  | {
      kind: 'subscription.renewed';
      provider: PremiumProvider;
      providerSubRef: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      pricing: BillingPricing; // re-snapshotted in case Stripe Price metadata changed
      invoice: BillingInvoice;
    }
  | {
      kind: 'subscription.cancelled'; // cancel_at_period_end=true; entitlement still valid
      provider: PremiumProvider;
      providerSubRef: string;
      cancelledAt: Date;
    }
  | {
      kind: 'subscription.uncancelled'; // user reverses cancel before period end
      provider: PremiumProvider;
      providerSubRef: string;
    }
  | {
      kind: 'subscription.expired';
      provider: PremiumProvider;
      providerSubRef: string;
      cancelledAt: Date;
    }
  | {
      kind: 'subscription.past_due';
      provider: PremiumProvider;
      providerSubRef: string;
    }
  | {
      kind: 'subscription.tier_changed';
      provider: PremiumProvider;
      providerSubRef: string;
      tier: GaragePremiumTier;
      cadence: PremiumCadence;
      pricing: BillingPricing;
    };

/** Convenience: all valid `kind` strings, for exhaustiveness checks in switch arms. */
export type BillingEventKind = BillingEvent['kind'];
