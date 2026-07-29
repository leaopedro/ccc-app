import type Stripe from 'stripe';

import type {
  AddSubscriptionItemInput,
  AddSubscriptionItemResult,
  BillingPortalSessionResult,
  CancelSubscriptionAtPeriodEndInput,
  CancelSubscriptionAtPeriodEndResult,
  CheckoutSessionResult,
  CreateBillingPortalSessionInput,
  CreateCheckoutSessionInput,
  CreatePaymentIntentInput,
  CreateSubscriptionCheckoutSessionInput,
  FindOrCreateCustomerInput,
  FindOrCreateCustomerResult,
  OpenSubscriptionCheckoutSession,
  PaymentIntentResult,
  RemoveSubscriptionItemInput,
  StripeClient,
  SubscriptionCheckoutSessionResult,
  WebhookEvent,
} from './index.js';

type FakeCall = {
  kind:
    | 'createPaymentIntent'
    | 'createCheckoutSession'
    | 'refund'
    | 'cancelPaymentIntent'
    | 'retrievePaymentIntent'
    | 'retrieveSubscription'
    | 'createSubscriptionCheckoutSession'
    | 'findOrCreateCustomer'
    | 'createBillingPortalSession'
    | 'listOpenSubscriptionCheckoutSessions'
    | 'retrievePrice'
    | 'addSubscriptionItem'
    | 'removeSubscriptionItem'
    | 'cancelSubscriptionAtPeriodEnd';
  payload: unknown;
};

export type FakeStripe = StripeClient & {
  calls: FakeCall[];
  /** Next Price returned by retrievePrice. Defaults to a no-metadata throw. */
  nextRetrievedPrice: Stripe.Price | null;
  nextPaymentIntent: { id: string; clientSecret: string };
  nextRetrievedPaymentIntent: { id: string; clientSecret: string } | null;
  nextCancelPaymentIntentError: Error | null;
  nextCheckoutSession: CheckoutSessionResult;
  nextCheckoutSessionPaymentIntentId: string | null;
  nextSignatureValid: boolean;
  nextEvent: WebhookEvent | null;
  /** Map of stripe customerId → metadata. Used by retrieveCustomer in tests. */
  customers: Map<string, Record<string, string>>;
  nextRetrievedSubscription: Stripe.Subscription | null;
  /** Next subscription checkout session payload returned by createSubscriptionCheckoutSession. */
  nextSubscriptionCheckoutSession: SubscriptionCheckoutSessionResult;
  /** Next customer payload returned by findOrCreateCustomer. */
  nextFoundOrCreatedCustomer: FindOrCreateCustomerResult;
  /** Next billing portal payload returned by createBillingPortalSession. */
  nextBillingPortalSession: BillingPortalSessionResult;
  /** Next list returned by listOpenSubscriptionCheckoutSessions. Defaults to []. */
  nextOpenSubscriptionCheckoutSessions: OpenSubscriptionCheckoutSession[];
  /**
   * When set, overrides the auto-incrementing subscription-item id returned by
   * addSubscriptionItem. Leave null to get deterministic `si_fake_N` ids.
   */
  nextSubscriptionItemId: string | null;
  /** When set, addSubscriptionItem throws this error (provider-failure path). */
  nextAddSubscriptionItemError: Error | null;
  /** When set, removeSubscriptionItem throws this error (provider-failure path). */
  nextRemoveSubscriptionItemError: Error | null;
  /** Next payload returned by cancelSubscriptionAtPeriodEnd. */
  nextCancelledSubscription: CancelSubscriptionAtPeriodEndResult;
};

export const buildFakeStripe = (): FakeStripe => {
  // Auto-incrementing subscription-item id counter — deterministic per fake so
  // tests can assert on `si_fake_1`, `si_fake_2`, ... unless overridden.
  let subItemCounter = 0;
  const fake: FakeStripe = {
    calls: [],
    nextPaymentIntent: { id: 'pi_test_1', clientSecret: 'pi_test_1_secret_abc' },
    nextRetrievedPaymentIntent: null,
    nextCancelPaymentIntentError: null,
    nextCheckoutSession: {
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/cs_test_1',
      paymentIntentId: 'pi_test_cs_1',
    },
    nextCheckoutSessionPaymentIntentId: 'pi_test_cs_1',
    nextSignatureValid: true,
    nextEvent: null,
    customers: new Map<string, Record<string, string>>(),
    nextRetrievedSubscription: null,
    nextSubscriptionCheckoutSession: {
      id: 'cs_test_sub_1',
      url: 'https://checkout.stripe.com/pay/cs_test_sub_1',
    },
    nextFoundOrCreatedCustomer: { customerId: 'cus_test_sub_1' },
    nextBillingPortalSession: { url: 'https://billing.stripe.com/session/test_1' },
    nextOpenSubscriptionCheckoutSessions: [],
    nextRetrievedPrice: null,
    nextSubscriptionItemId: null,
    nextAddSubscriptionItemError: null,
    nextRemoveSubscriptionItemError: null,
    nextCancelledSubscription: {
      cancelAtPeriodEnd: true,
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    createPaymentIntent: async (input: CreatePaymentIntentInput): Promise<PaymentIntentResult> => {
      fake.calls.push({ kind: 'createPaymentIntent', payload: input });
      return fake.nextPaymentIntent;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    createCheckoutSession: async (
      input: CreateCheckoutSessionInput,
    ): Promise<CheckoutSessionResult> => {
      fake.calls.push({ kind: 'createCheckoutSession', payload: input });
      return fake.nextCheckoutSession;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    getCheckoutSessionPaymentIntentId: async (_sessionId) => {
      return fake.nextCheckoutSessionPaymentIntentId;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    constructWebhookEvent: async (_payload, _signature, _webhookSecret) => {
      if (!fake.nextSignatureValid) {
        const err = new Error('signature verification failed');
        err.name = 'StripeSignatureVerificationError';
        throw err;
      }
      if (!fake.nextEvent) throw new Error('FakeStripe.nextEvent not set');
      return fake.nextEvent;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    retrieveCustomer: async (customerId) => {
      const metadata = fake.customers.get(customerId);
      if (!metadata) {
        throw new Error(`FakeStripe: unknown customer ${customerId}`);
      }
      return { id: customerId, metadata };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    refund: async (paymentIntentId, reason, amountCents) => {
      fake.calls.push({ kind: 'refund', payload: { paymentIntentId, reason, amountCents } });
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    cancelPaymentIntent: async (paymentIntentId) => {
      fake.calls.push({ kind: 'cancelPaymentIntent', payload: { paymentIntentId } });
      if (fake.nextCancelPaymentIntentError) {
        throw fake.nextCancelPaymentIntentError;
      }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    retrievePaymentIntent: async (paymentIntentId: string): Promise<PaymentIntentResult> => {
      fake.calls.push({ kind: 'retrievePaymentIntent', payload: { paymentIntentId } });
      return (
        fake.nextRetrievedPaymentIntent ?? {
          id: paymentIntentId,
          clientSecret: `${paymentIntentId}_secret_retrieved`,
        }
      );
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    retrieveSubscription: async (subId: string): Promise<Stripe.Subscription> => {
      fake.calls.push({ kind: 'retrieveSubscription', payload: { subId } });
      if (!fake.nextRetrievedSubscription) {
        throw new Error('FakeStripe.nextRetrievedSubscription not set');
      }
      return fake.nextRetrievedSubscription;
    },
    publishableKey: () => 'pk_test_fake',
    // eslint-disable-next-line @typescript-eslint/require-await
    createSubscriptionCheckoutSession: async (
      input: CreateSubscriptionCheckoutSessionInput,
    ): Promise<SubscriptionCheckoutSessionResult> => {
      fake.calls.push({ kind: 'createSubscriptionCheckoutSession', payload: input });
      return fake.nextSubscriptionCheckoutSession;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    findOrCreateCustomer: async (
      input: FindOrCreateCustomerInput,
    ): Promise<FindOrCreateCustomerResult> => {
      fake.calls.push({ kind: 'findOrCreateCustomer', payload: input });
      return fake.nextFoundOrCreatedCustomer;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    createBillingPortalSession: async (
      input: CreateBillingPortalSessionInput,
    ): Promise<BillingPortalSessionResult> => {
      fake.calls.push({ kind: 'createBillingPortalSession', payload: input });
      return fake.nextBillingPortalSession;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    listOpenSubscriptionCheckoutSessions: async (
      customerId: string,
    ): Promise<OpenSubscriptionCheckoutSession[]> => {
      fake.calls.push({ kind: 'listOpenSubscriptionCheckoutSessions', payload: { customerId } });
      return fake.nextOpenSubscriptionCheckoutSessions;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    retrievePrice: async (priceId: string): Promise<Stripe.Price> => {
      fake.calls.push({ kind: 'retrievePrice', payload: { priceId } });
      if (!fake.nextRetrievedPrice) {
        throw new Error('FakeStripe.nextRetrievedPrice not set');
      }
      return fake.nextRetrievedPrice;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    addSubscriptionItem: async (
      input: AddSubscriptionItemInput,
    ): Promise<AddSubscriptionItemResult> => {
      fake.calls.push({ kind: 'addSubscriptionItem', payload: input });
      if (fake.nextAddSubscriptionItemError) {
        throw fake.nextAddSubscriptionItemError;
      }
      const subscriptionItemId = fake.nextSubscriptionItemId ?? `si_fake_${++subItemCounter}`;
      return { subscriptionItemId };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    removeSubscriptionItem: async (input: RemoveSubscriptionItemInput): Promise<void> => {
      fake.calls.push({ kind: 'removeSubscriptionItem', payload: input });
      if (fake.nextRemoveSubscriptionItemError) {
        throw fake.nextRemoveSubscriptionItemError;
      }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    cancelSubscriptionAtPeriodEnd: async (
      input: CancelSubscriptionAtPeriodEndInput,
    ): Promise<CancelSubscriptionAtPeriodEndResult> => {
      fake.calls.push({ kind: 'cancelSubscriptionAtPeriodEnd', payload: input });
      return fake.nextCancelledSubscription;
    },
  };
  return fake;
};
