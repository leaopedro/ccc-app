import Stripe from 'stripe';

export type PaymentIntentResult = {
  id: string;
  clientSecret: string;
};

export type CreatePaymentIntentInput = {
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
  /**
   * Destinatario do recibo da Stripe. SEMPRE derivado do usuario autenticado
   * no servidor. Aceitar este valor do corpo da requisicao transformaria a
   * rota numa primitiva de e-mail para destinatario arbitrario, assinada pela
   * nossa conta Stripe.
   */
  receiptEmail?: string;
};

export type CheckoutSessionResult = {
  id: string;
  url: string;
  paymentIntentId: string | null;
};

export type CreateCheckoutSessionInput = {
  amountCents: number;
  currency: string;
  productName: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  expiresAt?: number;
};

export type WebhookEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
    /**
     * Sibling of `object` in Stripe's event envelope, present on `*.updated`
     * events. Load-bearing: the billing normalizer discriminates cancel,
     * uncancel, pause, resume and tier change by diffing the subscription
     * against it. Dropping it here silently disables every one of those
     * transitions — the normalizer returns null and the membership never
     * moves, while Stripe considers the event delivered.
     */
    previous_attributes?: Record<string, unknown>;
  };
};

export type CreateSubscriptionCheckoutSessionInput = {
  customerId: string;
  /**
   * All recurring prices in the session, plan first. Every price MUST share the
   * same interval and currency — Stripe rejects a mixed subscription session.
   */
  priceIds: string[];
  successUrl: string;
  cancelUrl: string;
  /**
   * Attached to both `session.metadata` and `subscription_data.metadata` so the
   * F8.04 webhook handler can resolve garageId from invoice.paid /
   * customer.subscription.* events without a second round-trip.
   */
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export type SubscriptionCheckoutSessionResult = {
  id: string;
  url: string;
  /**
   * Stripe's session status, load-bearing because of idempotency replay.
   * `checkout.sessions.create` with a key used in the last 24h returns the
   * STORED response, and the stored session may since have been expired — by
   * this service's own stale-session sweep. Callers must check this instead of
   * assuming a fresh create yields an open session. `null` only for fakes and
   * for a Stripe response that omits it.
   */
  status: 'open' | 'complete' | 'expired' | null;
};

export type CreateNativeSubscriptionInput = {
  customerId: string;
  /** Todos os prices recorrentes, plano primeiro. Mesmo intervalo e moeda. */
  priceIds: string[];
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export type NativeSubscriptionResult = {
  subscriptionId: string;
  /**
   * client_secret da confirmation_secret da latest_invoice. Null quando a
   * Stripe finaliza a fatura sem exigir confirmacao (valor zero, credito),
   * caso em que nao ha nada para o PaymentSheet apresentar.
   */
  clientSecret: string | null;
  status: Stripe.Subscription.Status;
};

export type FindOrCreateCustomerInput = {
  email: string;
  garageId: string;
};

export type FindOrCreateCustomerResult = {
  customerId: string;
};

export type CreateBillingPortalSessionInput = {
  customerId: string;
  returnUrl: string;
};

export type BillingPortalSessionResult = {
  url: string;
};

/**
 * Add a recurring add-on line to an existing subscription (P5 premium add-ons).
 * priceId is resolved server-side from the add-on module catalog — never from a
 * client-supplied value.
 */
export type AddSubscriptionItemInput = {
  subscriptionId: string;
  priceId: string;
  idempotencyKey: string;
};

export type AddSubscriptionItemResult = {
  subscriptionItemId: string;
};

/** Remove an add-on line from a subscription (P5 premium add-on detach). */
export type RemoveSubscriptionItemInput = {
  subscriptionItemId: string;
  idempotencyKey: string;
};

/**
 * Schedule cancellation at the end of the current paid period. Never cancels
 * immediately: canon §F8.10 keeps entitlement alive until periodEnd. The DB is
 * written by the resulting customer.subscription.updated webhook, not here.
 *
 * Deliberately does NOT return a period-end date. `current_period_end` is a
 * per-SubscriptionItem field in Stripe SDK 2026-04-22.dahlia, not a
 * subscription-wide one, and once a subscription carries add-on items
 * (multi-item subscriptions, see addSubscriptionItem) there is no
 * contractually-ordered "the plan item" to read it off safely. Scheduling a
 * cancellation does not move the period boundary anyway, so callers that need
 * the date should read `PremiumMembership.currentPeriodEnd` — the row this
 * repo's canon already treats as the source of truth, kept in sync by the
 * verified customer.subscription.updated webhook.
 */
export type CancelSubscriptionAtPeriodEndInput = {
  subscriptionId: string;
  idempotencyKey: string;
};

export type CancelSubscriptionAtPeriodEndResult = {
  cancelAtPeriodEnd: boolean;
};

/**
 * Troca o Price de um SubscriptionItem existente. Usado pela troca de plano
 * iniciada pelo admin. proration_behavior fica em 'create_prorations': a
 * diferenca proporcional entra como credito ou debito na fatura seguinte, e nao
 * como cobranca imediata fora do ciclo. Mesma politica do vinculo de add-on.
 *
 * O DB nao e escrito aqui. O customer.subscription.updated resultante e que
 * dispara subscription.tier_changed e grava o snapshot novo.
 */
export type UpdateSubscriptionItemPriceInput = {
  subscriptionItemId: string;
  priceId: string;
  idempotencyKey: string;
};

/** Desfaz um cancelamento agendado: cancel_at_period_end volta para false. */
export type ResumeSubscriptionCancellationInput = {
  subscriptionId: string;
  idempotencyKey: string;
};

/**
 * Suspende a cobranca sem cancelar a assinatura. behavior 'void' descarta as
 * faturas do periodo pausado em vez de acumular divida para o membro.
 */
export type PauseSubscriptionCollectionInput = {
  subscriptionId: string;
  idempotencyKey: string;
};

/** Retoma a cobranca de uma assinatura pausada, limpando pause_collection. */
export type ResumeSubscriptionCollectionInput = {
  subscriptionId: string;
  idempotencyKey: string;
};

/**
 * Bandeira e final do cartao de um PaymentIntent, ou null quando o pagamento nao
 * foi por cartao ou o dado nao esta disponivel. Usado apenas para exibicao no
 * admin — nunca para decisao de cobranca.
 */
export type PaymentMethodCard = { brand: string; last4: string };

export type StripeClient = {
  createPaymentIntent: (input: CreatePaymentIntentInput) => Promise<PaymentIntentResult>;
  createCheckoutSession: (input: CreateCheckoutSessionInput) => Promise<CheckoutSessionResult>;
  getCheckoutSessionPaymentIntentId: (sessionId: string) => Promise<string | null>;
  constructWebhookEvent: (
    payload: Buffer,
    signature: string,
    webhookSecret?: string,
  ) => Promise<WebhookEvent>;
  retrieveCustomer: (
    customerId: string,
  ) => Promise<{ id: string; metadata: Record<string, string> }>;
  /**
   * `idempotencyKey` is optional so the automatic webhook branches (which
   * call this with no key today) keep compiling unchanged. Any NEW caller —
   * the admin-assisted refund route is the first — must pass one: this is
   * the only mutating method on this client that ever shipped without an
   * idempotency key, and a caller with no local status flip to guard against
   * a retry needs Stripe's own dedup as the backstop.
   */
  refund: (
    paymentIntentId: string,
    reason: string,
    amountCents?: number,
    idempotencyKey?: string,
  ) => Promise<void>;
  cancelPaymentIntent: (paymentIntentId: string) => Promise<void>;
  retrievePaymentIntent: (paymentIntentId: string) => Promise<PaymentIntentResult>;
  /**
   * Fetch a Subscription with `items.data.price.product` expanded. Used by the
   * reconciliation sweep (chunk F8.12) to detect drift between Stripe's
   * authoritative subscription state and the local DB snapshot. The expand
   * surface lets the worker re-snapshot pricing from Price.metadata
   * (`baseAmountCents`, `devFeePercent`) without a second round-trip (canon
   * §F8.1).
   */
  retrieveSubscription: (subId: string) => Promise<Stripe.Subscription>;
  publishableKey: () => string;
  createSubscriptionCheckoutSession: (
    input: CreateSubscriptionCheckoutSessionInput,
  ) => Promise<SubscriptionCheckoutSessionResult>;
  /**
   * Assinatura nativa para o PaymentSheet. payment_behavior
   * 'default_incomplete' faz a Stripe criar a assinatura em `incomplete` e
   * deixar a primeira fatura aguardando confirmacao no cliente.
   *
   * O segredo sai de `latest_invoice.confirmation_secret.client_secret`. Na SDK
   * 22.1.0 com apiVersion 2026-04-22.dahlia, `Invoice` NAO tem `payment_intent`
   * no topo (Invoices.d.ts:207 e :472-481); o unico `payment_intent` do arquivo
   * esta dentro de LastFinalizationError. `invoice.payment_intent` nao compila.
   *
   * `confirmation_secret` so vem preenchida com expand explicito.
   */
  createNativeSubscription: (
    input: CreateNativeSubscriptionInput,
  ) => Promise<NativeSubscriptionResult>;
  findOrCreateCustomer: (input: FindOrCreateCustomerInput) => Promise<FindOrCreateCustomerResult>;
  /**
   * Delete (Stripe-side "forget") every live customer matching this email.
   * Used by the account-deletion vendor fan-out to purge customer PII from
   * Stripe. Returns the number of customers deleted.
   */
  deleteCustomersByEmail: (email: string) => Promise<number>;
  createBillingPortalSession: (
    input: CreateBillingPortalSessionInput,
  ) => Promise<BillingPortalSessionResult>;
  /**
   * Return open subscription-mode Checkout Sessions for the customer.
   * Used by the duplicate-subscribe guard so a user mid-checkout cannot open
   * a second session (e.g. Annual after Monthly) before the first webhook
   * activates the membership row.
   */
  listOpenSubscriptionCheckoutSessions: (
    customerId: string,
  ) => Promise<OpenSubscriptionCheckoutSession[]>;
  /**
   * Expire an open Checkout Session. Used before minting a new subscription
   * session so a member who abandoned checkout and changed their package is
   * not pushed back into the stale one.
   */
  expireCheckoutSession: (sessionId: string) => Promise<void>;
  /**
   * Retrieve a Stripe Price by ID. Used by the public pricing route (F8.20)
   * to read metadata (`baseAmountCents`, `devFeePercent`) at request time so
   * the UI shows whatever Stripe currently has configured, even if env
   * snapshot drift occurs.
   */
  retrievePrice: (priceId: string) => Promise<Stripe.Price>;
  /**
   * Add a recurring add-on item to an existing subscription (P5). Uses Stripe's
   * default proration (`create_prorations`) so the customer is charged/credited
   * the pro-rated delta immediately.
   */
  addSubscriptionItem: (input: AddSubscriptionItemInput) => Promise<AddSubscriptionItemResult>;
  /**
   * Remove an add-on item from a subscription (P5 detach). See the real impl
   * for the proration-behavior choice.
   */
  removeSubscriptionItem: (input: RemoveSubscriptionItemInput) => Promise<void>;
  cancelSubscriptionAtPeriodEnd: (
    input: CancelSubscriptionAtPeriodEndInput,
  ) => Promise<CancelSubscriptionAtPeriodEndResult>;
  updateSubscriptionItemPrice: (input: UpdateSubscriptionItemPriceInput) => Promise<void>;
  resumeSubscriptionCancellation: (input: ResumeSubscriptionCancellationInput) => Promise<void>;
  pauseSubscriptionCollection: (input: PauseSubscriptionCollectionInput) => Promise<void>;
  resumeSubscriptionCollection: (input: ResumeSubscriptionCollectionInput) => Promise<void>;
  retrievePaymentMethodCard: (paymentIntentId: string) => Promise<PaymentMethodCard | null>;
};

export type OpenSubscriptionCheckoutSession = {
  id: string;
  url: string | null;
};

/**
 * True only when the error PROVES the Stripe API rejected the request without
 * creating anything — safe for a caller to mark a pre-payment record (e.g.
 * PremiumSubscriptionAttempt) as abandoned.
 *
 * False for everything else, on purpose:
 *  - StripeIdempotencyError: a concurrent call reused the SAME key while the
 *    first call is still in flight ("request outstanding"). The subscription
 *    may be created any moment by that first call.
 *  - StripeConnectionError: the request may never have reached Stripe, or it
 *    reached Stripe and the response was lost in transit. Either way, the
 *    subscription may exist.
 *  - StripeAPIError (Stripe 5xx) and anything unrecognised: Stripe's own
 *    infrastructure failed after receiving the request — no guarantee the
 *    resource was not created.
 *
 * Callers MUST treat a false result as "outcome unknown", not "succeeded":
 * leave the pre-payment record alone (do not flip it to a terminal status)
 * and let a slower path (retry, reconciliation) resolve it later.
 */
export const isDefinitiveSubscriptionRejection = (err: unknown): boolean =>
  err instanceof Stripe.errors.StripeInvalidRequestError ||
  err instanceof Stripe.errors.StripeCardError ||
  err instanceof Stripe.errors.StripeAuthenticationError ||
  err instanceof Stripe.errors.StripePermissionError;

type StripeEnv = {
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_WEBHOOK_SECRET: string;
  readonly STRIPE_PUBLISHABLE_KEY?: string | undefined;
};

export const buildStripe = (env: StripeEnv): StripeClient => {
  // apiVersion is a string literal typed against stripe SDK's LatestApiVersion.
  // Bump in lockstep with the `stripe` package version; TS will reject stale values.
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });

  return {
    createPaymentIntent: async ({
      amountCents,
      currency,
      metadata,
      idempotencyKey,
      receiptEmail,
    }) => {
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: currency.toLowerCase(),
          metadata,
          automatic_payment_methods: { enabled: true },
          ...(receiptEmail ? { receipt_email: receiptEmail } : {}),
        },
        { idempotencyKey },
      );
      if (!pi.client_secret) throw new Error('stripe paymentIntent missing client_secret');
      return { id: pi.id, clientSecret: pi.client_secret };
    },
    createCheckoutSession: async ({
      amountCents,
      currency,
      productName,
      metadata,
      successUrl,
      cancelUrl,
      idempotencyKey,
      expiresAt,
    }) => {
      const params: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        payment_intent_data: { metadata },
        line_items: [
          {
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: amountCents,
              product_data: { name: productName },
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
      };
      if (expiresAt) params.expires_at = expiresAt;
      const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
      if (!session.url) throw new Error('stripe checkout session missing url');
      const piId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);
      return { id: session.id, url: session.url, paymentIntentId: piId };
    },
    getCheckoutSessionPaymentIntentId: async (sessionId) => {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const piId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);
      return piId;
    },
    constructWebhookEvent: async (payload, signature, webhookSecret) => {
      const secret = webhookSecret ?? env.STRIPE_WEBHOOK_SECRET;
      try {
        const event = stripe.webhooks.constructEvent(payload, signature, secret);
        const previousAttributes = (event.data as { previous_attributes?: Record<string, unknown> })
          .previous_attributes;
        return {
          id: event.id,
          type: event.type,
          data: {
            object: event.data.object as unknown as Record<string, unknown>,
            ...(previousAttributes ? { previous_attributes: previousAttributes } : {}),
          },
        };
      } catch (err) {
        const needsEventNotificationPath =
          err instanceof Error &&
          err.message.includes(
            'You passed an event notification to stripe.webhooks.constructEvent',
          );
        if (!needsEventNotificationPath) throw err;
      }

      const notification = stripe.parseEventNotification(payload, signature, secret) as
        | Stripe.V2.Core.EventNotification
        | Stripe.V2.Core.Events.UnknownEventNotification;

      const normalizedType = notification.type.startsWith('v1.')
        ? notification.type.slice(3)
        : notification.type;

      // Pings and other control-plane notifications don't carry webhook payload data.
      if (normalizedType === 'v2.core.event_destination.ping') {
        return {
          id: notification.id,
          type: normalizedType,
          data: { object: notification as unknown as Record<string, unknown> },
        };
      }

      const fetched = await notification.fetchEvent();
      const fetchedData = (fetched as { data?: { object?: unknown } }).data?.object;
      const relatedObject =
        'fetchRelatedObject' in notification &&
        typeof notification.fetchRelatedObject === 'function'
          ? await notification.fetchRelatedObject()
          : null;
      const object =
        typeof fetchedData === 'object' && fetchedData !== null
          ? (fetchedData as Record<string, unknown>)
          : typeof relatedObject === 'object' && relatedObject !== null
            ? (relatedObject as Record<string, unknown>)
            : {};

      return {
        id: fetched.id,
        type: normalizedType,
        data: { object },
      };
    },
    // Stripe's refund.reason is a constrained enum; callers pass free-form text
    // which we persist in metadata, not in the enum field.
    refund: async (paymentIntentId, reason, amountCents, idempotencyKey) => {
      const params: Stripe.RefundCreateParams = {
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: { reason },
      };
      if (amountCents !== undefined) params.amount = amountCents;
      const options: Stripe.RequestOptions = idempotencyKey ? { idempotencyKey } : {};
      await stripe.refunds.create(params, options);
    },
    cancelPaymentIntent: async (paymentIntentId) => {
      await stripe.paymentIntents.cancel(paymentIntentId);
    },
    retrievePaymentIntent: async (paymentIntentId) => {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (!pi.client_secret) throw new Error('stripe paymentIntent missing client_secret');
      return { id: pi.id, clientSecret: pi.client_secret };
    },
    retrieveCustomer: async (customerId) => {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) throw new Error(`stripe: customer ${customerId} is deleted`);
      return {
        id: customer.id,
        metadata: (customer.metadata as Record<string, string> | null) ?? {},
      };
    },
    retrieveSubscription: async (subId) => {
      return stripe.subscriptions.retrieve(subId, {
        expand: ['items.data.price.product'],
      });
    },
    // Mobile also reads its own EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY; server echo
    // is a convenience. Empty string is acceptable in dev/test; order-creating
    // routes in prod must validate non-empty before returning this to clients.
    publishableKey: () => env.STRIPE_PUBLISHABLE_KEY ?? '',
    createSubscriptionCheckoutSession: async ({
      customerId,
      priceIds,
      successUrl,
      cancelUrl,
      metadata,
      idempotencyKey,
    }) => {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: customerId,
          line_items: priceIds.map((price) => ({ price, quantity: 1 })),
          // subscription_data.metadata carries garageId so the F8.04 webhook
          // handler can resolve the garage on invoice.paid /
          // customer.subscription.* without an extra DB lookup. (Gap #15 in
          // chunk plan: also relies on Customer.metadata.garageId set by
          // findOrCreateCustomer below.)
          subscription_data: { metadata },
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata,
        },
        { idempotencyKey },
      );
      if (!session.url) throw new Error('stripe subscription checkout session missing url');
      return { id: session.id, url: session.url, status: session.status };
    },
    createNativeSubscription: async ({ customerId, priceIds, metadata, idempotencyKey }) => {
      const sub = await stripe.subscriptions.create(
        {
          customer: customerId,
          items: priceIds.map((price) => ({ price, quantity: 1 })),
          payment_behavior: 'default_incomplete',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          metadata,
          expand: ['latest_invoice.confirmation_secret'],
        },
        { idempotencyKey },
      );
      const invoice = typeof sub.latest_invoice === 'string' ? null : sub.latest_invoice;
      return {
        subscriptionId: sub.id,
        clientSecret: invoice?.confirmation_secret?.client_secret ?? null,
        status: sub.status,
      };
    },
    findOrCreateCustomer: async ({ email, garageId }) => {
      // Email-based dedup; matches Stripe's own customer-by-email convention.
      // Filter deleted customers — Stripe returns them in `list` and a deleted id
      // is rejected at checkout-session create ("No such customer").
      const existing = await stripe.customers.list({ email, limit: 10 });
      // Stripe.Customer.deleted is `void` on live customers; truthy only on deleted.
      const liveCustomer = existing.data.find((c) => !c.deleted);
      if (liveCustomer) {
        // Refresh metadata.garageId — a reused customer may have stale or
        // missing garageId (recycled email, deleted-then-recreated garage, etc).
        // Webhook attribution depends on Customer.metadata.garageId (gap #15).
        if (liveCustomer.metadata?.garageId !== garageId) {
          await stripe.customers.update(liveCustomer.id, { metadata: { garageId } });
        }
        return { customerId: liveCustomer.id };
      }
      const customer = await stripe.customers.create({
        email,
        // garageId in metadata is the canonical link for webhook resolution
        // (spec §3.1 step 4 + chunk gap #15).
        metadata: { garageId },
      });
      return { customerId: customer.id };
    },
    deleteCustomersByEmail: async (email) => {
      const existing = await stripe.customers.list({ email, limit: 100 });
      let deleted = 0;
      for (const c of existing.data) {
        if (c.deleted) continue;
        await stripe.customers.del(c.id);
        deleted += 1;
      }
      return deleted;
    },
    createBillingPortalSession: async ({ customerId, returnUrl }) => {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },
    listOpenSubscriptionCheckoutSessions: async (customerId) => {
      const sessions = await stripe.checkout.sessions.list({
        customer: customerId,
        status: 'open',
        limit: 10,
      });
      return sessions.data
        .filter((s) => s.mode === 'subscription')
        .map((s) => ({ id: s.id, url: s.url }));
    },
    expireCheckoutSession: async (sessionId) => {
      await stripe.checkout.sessions.expire(sessionId);
    },
    retrievePrice: async (priceId) => {
      return stripe.prices.retrieve(priceId);
    },
    addSubscriptionItem: async ({ subscriptionId, priceId, idempotencyKey }) => {
      // Stripe default proration_behavior for subscription-item create is
      // 'create_prorations'; we set it explicitly so the pro-rated delta is
      // charged/credited immediately when an add-on is attached mid-cycle.
      const item = await stripe.subscriptionItems.create(
        {
          subscription: subscriptionId,
          price: priceId,
          quantity: 1,
          proration_behavior: 'create_prorations',
        },
        { idempotencyKey },
      );
      return { subscriptionItemId: item.id };
    },
    removeSubscriptionItem: async ({ subscriptionItemId, idempotencyKey }) => {
      // Proration-behavior choice (P5): we delete the item immediately with
      // 'create_prorations' (Stripe's default for item delete). This issues a
      // pro-rated credit for the unused portion of the current cycle. True
      // "remove at period end" would require scheduling a subscription phase,
      // which is materially more complex; the local DB row is still marked
      // `cancel_scheduled` so the member keeps the add-on's quota through the
      // period end while Stripe stops billing it. Documented as a deliberate
      // simplification (see me-premium-addons.ts detach handler).
      await stripe.subscriptionItems.del(
        subscriptionItemId,
        { proration_behavior: 'create_prorations' },
        { idempotencyKey },
      );
    },
    cancelSubscriptionAtPeriodEnd: async ({ subscriptionId, idempotencyKey }) => {
      // Only cancel_at_period_end is read back. current_period_end is
      // intentionally NOT sourced from Stripe here — see the doc comment on
      // CancelSubscriptionAtPeriodEndResult for why (per-item field, no safe
      // "the plan item" index once add-ons attach to the subscription).
      const sub = await stripe.subscriptions.update(
        subscriptionId,
        { cancel_at_period_end: true },
        { idempotencyKey },
      );
      return {
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    },
    updateSubscriptionItemPrice: async ({ subscriptionItemId, priceId, idempotencyKey }) => {
      await stripe.subscriptionItems.update(
        subscriptionItemId,
        { price: priceId, proration_behavior: 'create_prorations' },
        { idempotencyKey },
      );
    },
    resumeSubscriptionCancellation: async ({ subscriptionId, idempotencyKey }) => {
      await stripe.subscriptions.update(
        subscriptionId,
        { cancel_at_period_end: false },
        { idempotencyKey },
      );
    },
    pauseSubscriptionCollection: async ({ subscriptionId, idempotencyKey }) => {
      await stripe.subscriptions.update(
        subscriptionId,
        { pause_collection: { behavior: 'void' } },
        { idempotencyKey },
      );
    },
    resumeSubscriptionCollection: async ({ subscriptionId, idempotencyKey }) => {
      await stripe.subscriptions.update(
        subscriptionId,
        { pause_collection: null },
        { idempotencyKey },
      );
    },
    retrievePaymentMethodCard: async (paymentIntentId) => {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['payment_method'],
      });
      const pm = pi.payment_method;
      if (!pm || typeof pm === 'string' || pm.type !== 'card' || !pm.card) return null;
      return { brand: pm.card.brand, last4: pm.card.last4 };
    },
  };
};
