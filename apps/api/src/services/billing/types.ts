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
  /**
   * Bandeira e final do cartao, quando o provider os fornece.
   *
   * Vivem em BillingPricing porque ele ja e o portador de snapshot dos tres
   * eventos que reescrevem valores da assinatura (activated, renewed,
   * tier_changed). Nenhuma variante nova de BillingEvent, nenhuma assinatura
   * de funcao alterada.
   *
   * Opcionais de proposito. RevenueCat nunca preenche, e a Stripe so preenche
   * quando a rota consegue resolver o PaymentIntent. Ausencia nunca e erro.
   */
  paymentBrand?: string;
  paymentLast4?: string;
};

/** Invoice record carried on activated and renewed events. */
export type BillingInvoice = {
  providerInvoiceRef: string;
  providerTransactionRef?: string; // Apple original_transaction_id (iOS only)
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date;
  /**
   * Provider mode this invoice was charged in (fix round 2, IMPORTANT).
   *
   * Set from Stripe's `event.livemode` by normalize-stripe.ts. Absent for
   * RevenueCat (normalize-revenuecat.ts does not map `environment` today) and
   * for the reconcile worker's synthetic invoices, in which case
   * `PremiumMembershipInvoice.livemode` keeps its `true` default. Before this
   * existed nothing set the column at all, so every invoice after the
   * migration read as live revenue even while production pointed at a Stripe
   * sandbox account.
   */
  livemode?: boolean;
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
  /**
   * Whether `metadata` is the Price's own metadata, as opposed to an empty
   * stand-in.
   *
   * The legacy invoice shape expanded the Price inline, so an empty `metadata`
   * there is authoritative: the Price really has no devFeePercent, and 0 is the
   * right answer. The 2026 shape sends only a price id, so an empty `metadata`
   * means "not in this payload" and the route has to fetch the Price. Without
   * this flag the two are indistinguishable, and the route would either fetch
   * needlessly on every legacy line or silently record 0 on every new-shape one.
   */
  priceMetadataAvailable: boolean;
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
  /** Snapshot do repasse ao fornecedor, igual ao que attachAddon grava. */
  payoutAmountCents: number;
  /** Snapshot do fornecedor. Null = catalogo ainda sem fornecedor cadastrado. */
  vendorName: string | null;
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
    }
  | {
      /**
       * Cobranca suspensa sem cancelamento (Stripe pause_collection). Produz o
       * status `paused`, que ja existia no enum do schema mas que nenhum evento
       * gerava antes desta mudanca.
       */
      kind: 'subscription.paused';
      provider: PremiumProvider;
      providerSubRef: string;
    }
  | {
      /** Cobranca retomada: pause_collection limpo. Volta para `active`. */
      kind: 'subscription.resumed';
      provider: PremiumProvider;
      providerSubRef: string;
    };

/** Convenience: all valid `kind` strings, for exhaustiveness checks in switch arms. */
export type BillingEventKind = BillingEvent['kind'];
