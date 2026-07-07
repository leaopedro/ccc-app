import { afterEach, describe, expect, it, vi } from 'vitest';

import { AbacatePayUpstreamError, buildAbacatePay } from '../../src/services/abacatepay/index.js';

const okResponse = (data: unknown): Response =>
  new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('AbacatePay client.createPixBilling wire payload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not include externalId in the request body sent to /transparents/create', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({
        id: 'pix_123',
        brCode: 'br',
        amount: 5000,
        expiresAt: new Date().toISOString(),
        status: 'PENDING',
      }),
    );

    const client = buildAbacatePay({
      ABACATEPAY_API_KEY: 'sk_test',
      ABACATEPAY_WEBHOOK_SECRET: 'whsec',
    });

    await client.createPixBilling({
      amountCents: 5000,
      description: 'Ingresso Test',
      metadata: { orderId: 'ord_abc' },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toMatch(/\/v2\/transparents\/create$/);
    const body = JSON.parse(init.body as string) as {
      method: string;
      data: Record<string, unknown>;
    };
    expect(body.method).toBe('PIX');
    expect(body.data).not.toHaveProperty('externalId');
    expect(body.data.amount).toBe(5000);
    expect(body.data.metadata).toEqual({ orderId: 'ord_abc' });
  });

  it('throws AbacatePayUpstreamError with status when upstream returns 4xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, data: null, error: "Value should be one of 'object'" }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const client = buildAbacatePay({
      ABACATEPAY_API_KEY: 'sk_test',
      ABACATEPAY_WEBHOOK_SECRET: 'whsec',
    });

    await expect(
      client.createPixBilling({
        amountCents: 5000,
        description: 'x',
      }),
    ).rejects.toMatchObject({
      name: 'AbacatePayUpstreamError',
      status: 422,
    });
  });
});

describe('AbacatePayUpstreamError', () => {
  it('exposes status and body', () => {
    const err = new AbacatePayUpstreamError(422, 'body', 'msg');
    expect(err.status).toBe(422);
    expect(err.body).toBe('body');
    expect(err.message).toBe('msg');
    expect(err.name).toBe('AbacatePayUpstreamError');
  });
});
