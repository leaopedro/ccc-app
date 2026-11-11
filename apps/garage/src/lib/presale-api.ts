import {
  presaleCampaignSchema,
  presaleCheckoutResponseSchema,
  presaleOrderStatusResponseSchema,
  presaleProductListResponseSchema,
  type PresaleCampaign,
  type PresaleCheckoutRequest,
  type PresaleCheckoutResponse,
  type PresaleOrderStatusResponse,
  type PresaleProductListResponse,
} from '@ccc/shared/presale';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

/** Generic upstream failure: anything that isn't the named 409/422 cases below. */
export class PresaleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Checkout's 409: server recalculated price/stock and it disagrees with what
 * the client sent (`expectedTotalCents` mismatch, item now unavailable, etc).
 * The caller's answer is "reload and try again", never "fix your input".
 */
export class PresaleConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly variantIds?: string[],
    readonly totalCents?: number,
  ) {
    super(message);
  }
}

/**
 * Checkout's 422: the request payload itself failed server-side validation.
 * The caller's answer is "fix the form", never "reload".
 */
export class PresaleInvalidRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly variantIds?: string[],
  ) {
    super(message);
  }
}

type PresaleErrorBody = {
  code?: unknown;
  message?: unknown;
  variantIds?: unknown;
  totalCents?: unknown;
};

const readErrorBody = async (res: Response): Promise<PresaleErrorBody> => {
  try {
    const json: unknown = await res.json();
    return (json ?? {}) as PresaleErrorBody;
  } catch {
    return {};
  }
};

export const fetchPresaleCampaign = async (): Promise<PresaleCampaign> => {
  const res = await fetch(`${API_BASE}/presale/casa-in-box/campaign`, { cache: 'no-store' });
  if (!res.ok) throw new PresaleApiError(res.status, `upstream ${res.status}`);
  const json: unknown = await res.json();
  return presaleCampaignSchema.parse(json);
};

export const fetchPresaleProducts = async (): Promise<PresaleProductListResponse> => {
  const res = await fetch(`${API_BASE}/presale/casa-in-box/products`, { cache: 'no-store' });
  if (!res.ok) throw new PresaleApiError(res.status, `upstream ${res.status}`);
  const json: unknown = await res.json();
  return presaleProductListResponseSchema.parse(json);
};

/**
 * Everything the checkout endpoint needs except `clientRequestId`, which this
 * function generates fresh per send attempt — see below. Never pass a
 * `clientRequestId` in; there is nowhere to put one.
 */
export type StartPresaleCheckoutInput = Omit<PresaleCheckoutRequest, 'clientRequestId'>;

/**
 * POSTs the pre-sale checkout. `clientRequestId` is generated here, once per
 * call, and is never read from `payload` or persisted — it is the field that
 * gives the server its idempotency key, so a retried *attempt* must mint a
 * new one rather than resend a stale one (see services/presale/checkout.ts).
 */
export const startPresaleCheckout = async (
  payload: StartPresaleCheckoutInput,
): Promise<PresaleCheckoutResponse> => {
  const body: PresaleCheckoutRequest = {
    ...payload,
    clientRequestId: crypto.randomUUID(),
  };

  const res = await fetch(`${API_BASE}/presale/casa-in-box/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    const errorBody = await readErrorBody(res);
    throw new PresaleConflictError(
      typeof errorBody.code === 'string' ? errorBody.code : 'PRESALE_CONFLICT',
      typeof errorBody.message === 'string' ? errorBody.message : 'conflito ao processar pedido',
      Array.isArray(errorBody.variantIds) ? (errorBody.variantIds as string[]) : undefined,
      typeof errorBody.totalCents === 'number' ? errorBody.totalCents : undefined,
    );
  }

  if (res.status === 422) {
    const errorBody = await readErrorBody(res);
    throw new PresaleInvalidRequestError(
      typeof errorBody.code === 'string' ? errorBody.code : 'PRESALE_INVALID_REQUEST',
      typeof errorBody.message === 'string' ? errorBody.message : 'dados do pedido inválidos',
      Array.isArray(errorBody.variantIds) ? (errorBody.variantIds as string[]) : undefined,
    );
  }

  if (!res.ok) throw new PresaleApiError(res.status, `upstream ${res.status}`);

  const json: unknown = await res.json();
  return presaleCheckoutResponseSchema.parse(json);
};

/**
 * `orderId` + `token` travel in the POST body, never the querystring — the
 * token is the HMAC-signed proof from the checkout success redirect
 * (`verifyQrCode` in routes/presale.ts), and query params land in logs/proxies.
 */
export const fetchPresaleOrderStatus = async (
  orderId: string,
  token: string,
): Promise<PresaleOrderStatusResponse> => {
  const res = await fetch(`${API_BASE}/presale/casa-in-box/orders/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId, token }),
    cache: 'no-store',
  });
  if (!res.ok) throw new PresaleApiError(res.status, `upstream ${res.status}`);
  const json: unknown = await res.json();
  return presaleOrderStatusResponseSchema.parse(json);
};
