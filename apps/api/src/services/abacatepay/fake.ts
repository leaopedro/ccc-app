import type {
  AbacatePayClient,
  AbacateWebhookEvent,
  CreatePixBillingInput,
  PixBillingResult,
  PixBillingStatus,
} from './index.js';

type FakeCall = { method: string; args: unknown[] };

export type FakeAbacatePay = AbacatePayClient & {
  calls: FakeCall[];
  nextBilling: PixBillingResult | null;
  nextBillingError: Error | null;
  nextStatus: PixBillingStatus | null;
  nextSignatureValid: boolean;
  nextEvent: AbacateWebhookEvent | null;
};

export const buildFakeAbacatePay = (): FakeAbacatePay => {
  const fake: FakeAbacatePay = {
    calls: [],
    nextBilling: null,
    nextBillingError: null,
    nextStatus: null,
    nextSignatureValid: true,
    nextEvent: null,

    createPixBilling: (input: CreatePixBillingInput) => {
      fake.calls.push({ method: 'createPixBilling', args: [input] });
      if (fake.nextBillingError) return Promise.reject(fake.nextBillingError);
      if (fake.nextBilling) return Promise.resolve(fake.nextBilling);
      return Promise.resolve({
        id: `pix_char_${Date.now()}`,
        brCode: '00020126580014br.gov.bcb.pix...fake',
        brCodeBase64: 'data:image/png;base64,iVBORw0KG...fake',
        amount: input.amountCents,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        status: 'PENDING',
      });
    },

    getPixBilling: (id: string) => {
      fake.calls.push({ method: 'getPixBilling', args: [id] });
      if (fake.nextStatus) return Promise.resolve(fake.nextStatus);
      return Promise.resolve({ id, status: 'PAID', paidAt: new Date().toISOString() });
    },

    verifyWebhookSignature: (_payload: Buffer, _signature: string) => {
      if (!fake.nextSignatureValid) {
        throw new Error('invalid webhook signature');
      }
    },
  };

  return fake;
};
