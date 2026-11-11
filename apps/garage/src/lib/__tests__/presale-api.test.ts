import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchPresaleCampaign,
  PresaleApiError,
  PresaleConflictError,
  PresaleInvalidRequestError,
  startPresaleCheckout,
} from '../presale-api';

const validCampaign = {
  enabled: true,
  shippingFeeCents: 1990,
  deliveryAreaLabel: 'Grande SP',
  pickupAddress: 'Pocket CASA',
  pickupHours: 'seg-sex 9h-18h',
  firstBatchLabel: '1º lote',
};

const validCheckoutInput = {
  expectedTotalCents: 29990,
  fulfillmentMethod: 'pickup' as const,
  items: [{ variantId: 'variant_1', quantity: 1 }],
  guest: { name: 'Fulano', email: 'fulano@example.com' },
  acceptedTermsVersion: 'v1',
  acceptedPrivacyVersion: 'v1',
};

const validCheckoutResponse = {
  orderId: 'order_1',
  checkoutUrl: 'https://checkout.stripe.com/pay/cs_test_1',
  amountCents: 29990,
  shippingCents: 0,
  currency: 'brl',
};

const fetchSpy = vi.spyOn(globalThis, 'fetch');

beforeEach(() => {
  fetchSpy.mockReset();
});

afterEach(() => {
  fetchSpy.mockReset();
});

describe('fetchPresaleCampaign', () => {
  it('returns the parsed campaign when upstream responds with a valid payload', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(validCampaign), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await fetchPresaleCampaign();
    expect(result).toEqual(validCampaign);
  });

  it('rejects an invalid payload instead of passing it through (missing required field)', async () => {
    const invalidCampaign: Partial<typeof validCampaign> = { ...validCampaign };
    delete invalidCampaign.shippingFeeCents;
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(invalidCampaign), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(fetchPresaleCampaign()).rejects.toThrow();
  });
});

describe('startPresaleCheckout', () => {
  it('returns the parsed checkout response on 201', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(validCheckoutResponse), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await startPresaleCheckout(validCheckoutInput);
    expect(result).toEqual(validCheckoutResponse);
  });

  it('throws PresaleConflictError on 409, distinguishable from 422', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'Conflict',
          code: 'PRESALE_TOTAL_CHANGED',
          message: 'total mudou',
          totalCents: 31000,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );
    const error = await startPresaleCheckout(validCheckoutInput).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PresaleConflictError);
    expect(error).not.toBeInstanceOf(PresaleInvalidRequestError);
    expect((error as PresaleConflictError).totalCents).toBe(31000);
  });

  it('throws PresaleInvalidRequestError on 422, distinguishable from 409', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'UnprocessableEntity',
          code: 'PRESALE_INVALID_REQUEST',
          message: 'dados invalidos',
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    );
    const error = await startPresaleCheckout(validCheckoutInput).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PresaleInvalidRequestError);
    expect(error).not.toBeInstanceOf(PresaleConflictError);
  });

  it('throws a generic PresaleApiError on other upstream errors (e.g. 500)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(startPresaleCheckout(validCheckoutInput)).rejects.toBeInstanceOf(PresaleApiError);
  });

  it('sends the idempotency token (clientRequestId) in the POST body, never in the URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(validCheckoutResponse), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await startPresaleCheckout(validCheckoutInput);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toMatch(/\?/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { clientRequestId?: unknown };
    expect(typeof body.clientRequestId).toBe('string');
    expect((body.clientRequestId as string).length).toBeGreaterThan(0);
  });

  it('generates a fresh clientRequestId on each call (not persisted/reused)', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(validCheckoutResponse), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await startPresaleCheckout(validCheckoutInput);
    await startPresaleCheckout(validCheckoutInput);

    const firstBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as {
      clientRequestId: string;
    };
    const secondBody = JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string) as {
      clientRequestId: string;
    };
    expect(firstBody.clientRequestId).not.toBe(secondBody.clientRequestId);
  });
});
