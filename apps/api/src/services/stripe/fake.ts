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
  PauseSubscriptionCollectionInput,
  PaymentIntentResult,
  PaymentMethodCard,
  RemoveSubscriptionItemInput,
  ResumeSubscriptionCancellationInput,
  ResumeSubscriptionCollectionInput,
  StripeClient,
  SubscriptionCheckoutSessionResult,
  UpdateSubscriptionItemPriceInput,
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
    | 'deleteCustomersByEmail'
    | 'createBillingPortalSession'
    | 'listOpenSubscriptionCheckoutSessions'
    | 'expireCheckoutSession'
    | 'retrievePrice'
    | 'addSubscriptionItem'
    | 'removeSubscriptionItem'
    | 'cancelSubscriptionAtPeriodEnd'
    | 'updateSubscriptionItemPrice'
    | 'resumeSubscriptionCancellation'
    | 'pauseSubscriptionCollection'
    | 'resumeSubscriptionCollection'
    | 'retrievePaymentMethodCard';
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
  /**
   * Consumed before `nextSubscriptionCheckoutSession`, one entry per call.
   * Lets a test drive the idempotency-replay path, where the first mint returns
   * an already-expired session and the retry returns an open one.
   */
  subscriptionCheckoutSessionQueue: SubscriptionCheckoutSessionResult[];
  /** Next customer payload returned by findOrCreateCustomer. */
  nextFoundOrCreatedCustomer: FindOrCreateCustomerResult;
  /** Count returned by deleteCustomersByEmail. Defaults to 0. */
  nextDeletedCustomerCount: number;
  /** Next billing portal payload returned by createBillingPortalSession. */
  nextBillingPortalSession: BillingPortalSessionResult;
  /**
   * When set, createBillingPortalSession throws this instead of returning.
   * Used to drive the stale cross-mode reference path (Stripe `resource_missing`
   * for a customer id created in the other mode).
   */
  nextBillingPortalError: Error | null;
  /** Next list returned by listOpenSubscriptionCheckoutSessions. Defaults to []. */
  nextOpenSubscriptionCheckoutSessions: OpenSubscriptionCheckoutSession[];
  /** When set, createSubscriptionCheckoutSession throws this error. */
  nextCreateSubscriptionCheckoutSessionError: Error | null;
  /** When set, expireCheckoutSession throws this error (provider-failure path). */
  nextExpireCheckoutSessionError: Error | null;
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
  /** When set, updateSubscriptionItemPrice throws this error. */
  nextUpdateSubscriptionItemPriceError: Error | null;
  /** When set, resumeSubscriptionCancellation throws this error. */
  nextResumeSubscriptionCancellationError: Error | null;
  /** When set, pauseSubscriptionCollection throws this error. */
  nextPauseSubscriptionCollectionError: Error | null;
  /** When set, resumeSubscriptionCollection throws this error. */
  nextResumeSubscriptionCollectionError: Error | null;
  /** Next card returned by retrievePaymentMethodCard. Defaults to null. */
  nextPaymentMethodCard: PaymentMethodCard | null;
  /** When set, retrievePaymentMethodCard throws this error. */
  nextRetrievePaymentMethodCardError: Error | null;
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
      status: 'open',
    },
    subscriptionCheckoutSessionQueue: [],
    nextFoundOrCreatedCustomer: { customerId: 'cus_test_sub_1' },
    nextDeletedCustomerCount: 0,
    nextBillingPortalSession: { url: 'https://billing.stripe.com/session/test_1' },
    nextBillingPortalError: null,
    nextOpenSubscriptionCheckoutSessions: [],
    nextCreateSubscriptionCheckoutSessionError: null,
    nextExpireCheckoutSessionError: null,
    nextRetrievedPrice: null,
    nextSubscriptionItemId: null,
    nextAddSubscriptionItemError: null,
    nextRemoveSubscriptionItemError: null,
    nextCancelledSubscription: {
      cancelAtPeriodEnd: true,
    },
    nextUpdateSubscriptionItemPriceError: null,
    nextResumeSubscriptionCancellationError: null,
    nextPauseSubscriptionCollectionError: null,
    nextResumeSubscriptionCollectionError: null,
    nextPaymentMethodCard: null,
    nextRetrievePaymentMethodCardError: null,

    createPaymentIntent: async (input: CreatePaymentIntentInput): Promise<PaymentIntentResult> => {
      fake.calls.push({ kind: 'createPaymentIntent', payload: input });
      return fake.nextPaymentIntent;
    },

    createCheckoutSession: async (
      input: CreateCheckoutSessionInput,
    ): Promise<CheckoutSessionResult> => {
      fake.calls.push({ kind: 'createCheckoutSession', payload: input });
      return fake.nextCheckoutSession;
    },

    getCheckoutSessionPaymentIntentId: async (_sessionId) => {
      return fake.nextCheckoutSessionPaymentIntentId;
    },

    constructWebhookEvent: async (_payload, _signature, _webhookSecret) => {
      if (!fake.nextSignatureValid) {
        const err = new Error('signature verification failed');
        err.name = 'StripeSignatureVerificationError';
        throw err;
      }
      if (!fake.nextEvent) throw new Error('FakeStripe.nextEvent not set');
      return fake.nextEvent;
    },

    retrieveCustomer: async (customerId) => {
      const metadata = fake.customers.get(customerId);
      if (!metadata) {
        throw new Error(`FakeStripe: unknown customer ${customerId}`);
      }
      return { id: customerId, metadata };
    },

    refund: async (paymentIntentId, reason, amountCents) => {
      fake.calls.push({ kind: 'refund', payload: { paymentIntentId, reason, amountCents } });
    },

    cancelPaymentIntent: async (paymentIntentId) => {
      fake.calls.push({ kind: 'cancelPaymentIntent', payload: { paymentIntentId } });
      if (fake.nextCancelPaymentIntentError) {
        throw fake.nextCancelPaymentIntentError;
      }
    },

    retrievePaymentIntent: async (paymentIntentId: string): Promise<PaymentIntentResult> => {
      fake.calls.push({ kind: 'retrievePaymentIntent', payload: { paymentIntentId } });
      return (
        fake.nextRetrievedPaymentIntent ?? {
          id: paymentIntentId,
          clientSecret: `${paymentIntentId}_secret_retrieved`,
        }
      );
    },

    retrieveSubscription: async (subId: string): Promise<Stripe.Subscription> => {
      fake.calls.push({ kind: 'retrieveSubscription', payload: { subId } });
      if (!fake.nextRetrievedSubscription) {
        throw new Error('FakeStripe.nextRetrievedSubscription not set');
      }
      return fake.nextRetrievedSubscription;
    },
    publishableKey: () => 'pk_test_fake',

    createSubscriptionCheckoutSession: async (
      input: CreateSubscriptionCheckoutSessionInput,
    ): Promise<SubscriptionCheckoutSessionResult> => {
      fake.calls.push({ kind: 'createSubscriptionCheckoutSession', payload: input });
      if (fake.nextCreateSubscriptionCheckoutSessionError) {
        throw fake.nextCreateSubscriptionCheckoutSessionError;
      }
      return fake.subscriptionCheckoutSessionQueue.shift() ?? fake.nextSubscriptionCheckoutSession;
    },

    findOrCreateCustomer: async (
      input: FindOrCreateCustomerInput,
    ): Promise<FindOrCreateCustomerResult> => {
      fake.calls.push({ kind: 'findOrCreateCustomer', payload: input });
      return fake.nextFoundOrCreatedCustomer;
    },

    deleteCustomersByEmail: async (email: string): Promise<number> => {
      fake.calls.push({ kind: 'deleteCustomersByEmail', payload: { email } });
      return fake.nextDeletedCustomerCount;
    },

    createBillingPortalSession: async (
      input: CreateBillingPortalSessionInput,
    ): Promise<BillingPortalSessionResult> => {
      fake.calls.push({ kind: 'createBillingPortalSession', payload: input });
      if (fake.nextBillingPortalError) throw fake.nextBillingPortalError;
      return fake.nextBillingPortalSession;
    },

    listOpenSubscriptionCheckoutSessions: async (
      customerId: string,
    ): Promise<OpenSubscriptionCheckoutSession[]> => {
      fake.calls.push({ kind: 'listOpenSubscriptionCheckoutSessions', payload: { customerId } });
      return fake.nextOpenSubscriptionCheckoutSessions;
    },

    expireCheckoutSession: async (sessionId: string): Promise<void> => {
      fake.calls.push({ kind: 'expireCheckoutSession', payload: { sessionId } });
      if (fake.nextExpireCheckoutSessionError) {
        throw fake.nextExpireCheckoutSessionError;
      }
    },

    retrievePrice: async (priceId: string): Promise<Stripe.Price> => {
      fake.calls.push({ kind: 'retrievePrice', payload: { priceId } });
      if (!fake.nextRetrievedPrice) {
        throw new Error('FakeStripe.nextRetrievedPrice not set');
      }
      return fake.nextRetrievedPrice;
    },

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

    removeSubscriptionItem: async (input: RemoveSubscriptionItemInput): Promise<void> => {
      fake.calls.push({ kind: 'removeSubscriptionItem', payload: input });
      if (fake.nextRemoveSubscriptionItemError) {
        throw fake.nextRemoveSubscriptionItemError;
      }
    },

    cancelSubscriptionAtPeriodEnd: async (
      input: CancelSubscriptionAtPeriodEndInput,
    ): Promise<CancelSubscriptionAtPeriodEndResult> => {
      fake.calls.push({ kind: 'cancelSubscriptionAtPeriodEnd', payload: input });
      return fake.nextCancelledSubscription;
    },

    updateSubscriptionItemPrice: async (input: UpdateSubscriptionItemPriceInput): Promise<void> => {
      fake.calls.push({ kind: 'updateSubscriptionItemPrice', payload: input });
      if (fake.nextUpdateSubscriptionItemPriceError) {
        throw fake.nextUpdateSubscriptionItemPriceError;
      }
    },

    resumeSubscriptionCancellation: async (
      input: ResumeSubscriptionCancellationInput,
    ): Promise<void> => {
      fake.calls.push({ kind: 'resumeSubscriptionCancellation', payload: input });
      if (fake.nextResumeSubscriptionCancellationError) {
        throw fake.nextResumeSubscriptionCancellationError;
      }
    },

    pauseSubscriptionCollection: async (input: PauseSubscriptionCollectionInput): Promise<void> => {
      fake.calls.push({ kind: 'pauseSubscriptionCollection', payload: input });
      if (fake.nextPauseSubscriptionCollectionError) {
        throw fake.nextPauseSubscriptionCollectionError;
      }
    },

    resumeSubscriptionCollection: async (
      input: ResumeSubscriptionCollectionInput,
    ): Promise<void> => {
      fake.calls.push({ kind: 'resumeSubscriptionCollection', payload: input });
      if (fake.nextResumeSubscriptionCollectionError) {
        throw fake.nextResumeSubscriptionCollectionError;
      }
    },

    retrievePaymentMethodCard: async (paymentIntentId: string) => {
      fake.calls.push({ kind: 'retrievePaymentMethodCard', payload: { paymentIntentId } });
      if (fake.nextRetrievePaymentMethodCardError) {
        throw fake.nextRetrievePaymentMethodCardError;
      }
      return fake.nextPaymentMethodCard;
    },
  };
  return fake;
};
