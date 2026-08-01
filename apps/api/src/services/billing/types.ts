import type {
  GaragePremiumTier,
  PremiumAddonUnit,
  PremiumCadence,
  PremiumProvider,
} from '@prisma/client';

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

/**
 * One recurring line of a provider invoice, as the normalizer sees it. The
 * normalizer has no DB access, so it cannot say whether a line is the plan or
 * an add-on — the webhook route resolves that against the catalog.
 */
export type BillingLine = {
  priceRef: string;
  amountCents: number;
  subscriptionItemRef: string | null;
  metadata: Record<string, string>;
};

/**
 * An add-on line already resolved against the DB catalog by the webhook route.
 * Price and quota are snapshots: later catalog edits must not retroactively
 * change an attached add-on.
 */
export type BillingAddonLine = {
  addonKey: string;
  providerItemRef: string | null;
  monthlyDeltaCents: number;
  quotaPerCycle: number;
  quotaUnit: PremiumAddonUnit;
  currency: string;
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
      /** Raw invoice lines. Route resolves them against the catalog. */
      lines: BillingLine[];
      /** Resolved by the route; the normalizer always emits []. */
      addons: BillingAddonLine[];
      /** Resolved by the route; the normalizer always emits 0. */
      addonsAmountCents: number;
    }
  | {
      kind: 'subscription.renewed';
      provider: PremiumProvider;
      providerSubRef: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      pricing: BillingPricing; // re-snapshotted in case Stripe Price metadata changed
      invoice: BillingInvoice;
      lines: BillingLine[];
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
      /** The new price id, so the route can tell a plan swap from an add-on swap. */
      priceRef: string;
      /**
       * Raw Stripe Price.metadata of the new price. The normalizer has no DB
       * access, so it cannot resolve devFeePercent itself — the route reads it
       * from here when it resolves this line against the catalog, exactly as
       * it does for the plan line on activation/renewal (canon §F8.1).
       */
      priceMetadata: Record<string, string>;
      tier: GaragePremiumTier;
      cadence: PremiumCadence;
      pricing: BillingPricing;
    };

/** Convenience: all valid `kind` strings, for exhaustiveness checks in switch arms. */
export type BillingEventKind = BillingEvent['kind'];
