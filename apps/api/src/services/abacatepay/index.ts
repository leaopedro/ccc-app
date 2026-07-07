import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE_URL = 'https://api.abacatepay.com/v2';

// AbacatePay signs webhooks with this fixed public key (not merchant-specific).
// https://docs.abacatepay.com/pages/webhooks/security
const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

export type PixBillingResult = {
  id: string;
  brCode: string;
  brCodeBase64?: string;
  amount: number;
  expiresAt: string;
  status: string;
};

export type PixBillingCustomer = {
  name: string;
  taxId: string;
  email?: string;
  cellphone?: string;
};

export type CreatePixBillingInput = {
  amountCents: number;
  description: string;
  expiresInSeconds?: number;
  customer?: PixBillingCustomer;
  metadata?: Record<string, string>;
};

export class AbacatePayUpstreamError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = 'AbacatePayUpstreamError';
    this.status = status;
    this.body = body;
  }
}

export type PixBillingStatus = {
  id: string;
  status: string;
  paidAt: string | null;
};

export type AbacateWebhookEvent = {
  id: string;
  event: string;
  devMode: boolean;
  data: Record<string, unknown>;
};

export type AbacatePayClient = {
  createPixBilling: (input: CreatePixBillingInput) => Promise<PixBillingResult>;
  getPixBilling: (id: string) => Promise<PixBillingStatus>;
  verifyWebhookSignature: (payload: Buffer, signature: string) => void;
};

type AbacatePayEnv = {
  readonly ABACATEPAY_API_KEY: string;
  readonly ABACATEPAY_WEBHOOK_SECRET: string;
};

export const buildAbacatePay = (env: AbacatePayEnv): AbacatePayClient => {
  const headers = {
    Authorization: `Bearer ${env.ABACATEPAY_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const init: RequestInit = { method, headers };
    if (body) init.body = JSON.stringify(body);
    const res = await fetch(`${BASE_URL}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AbacatePayUpstreamError(
        res.status,
        text,
        `AbacatePay ${method} ${path} failed: ${res.status} ${text}`,
      );
    }
    const json = (await res.json()) as { data: T; success: boolean; error: string | null };
    if (!json.success) {
      throw new AbacatePayUpstreamError(
        res.status,
        JSON.stringify(json),
        `AbacatePay error: ${json.error}`,
      );
    }
    return json.data;
  };

  return {
    createPixBilling: async ({
      amountCents,
      description,
      expiresInSeconds,
      customer,
      metadata,
    }) => {
      // AbacatePay rejects unknown fields on /transparents/create with 422.
      // Order linkage is preserved via metadata.orderId and the returned billing.id.
      const dataBody: Record<string, unknown> = {
        amount: amountCents,
        description,
        metadata: metadata ?? {},
      };
      if (expiresInSeconds !== undefined) dataBody.expiresIn = expiresInSeconds;
      if (customer) dataBody.customer = customer;

      const result = await request<{
        id: string;
        brCode: string;
        brCodeBase64?: string;
        amount: number;
        expiresAt: string;
        status: string;
      }>('POST', '/transparents/create', {
        method: 'PIX',
        data: dataBody,
      });
      return result;
    },

    getPixBilling: async (id) => {
      const result = await request<{ id: string; status: string; updatedAt: string | null }>(
        'GET',
        `/transparents/${id}`,
      );
      return {
        id: result.id,
        status: result.status,
        paidAt: result.status === 'PAID' ? result.updatedAt : null,
      };
    },

    verifyWebhookSignature: (payload, signature) => {
      const expected = createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(payload).digest('base64');
      const a = Buffer.from(signature, 'base64');
      const b = Buffer.from(expected, 'base64');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error('invalid webhook signature');
      }
    },
  };
};
