// Click-time resolver for the web Stripe resume CTA on /profile/orders.
//
// Stripe Checkout Sessions remain payable past the local reservation
// window, so reopening a stored hosted URL without a server-side status
// check would let the user pay for a stale (expired/cancelled) order.
// /orders/:id/resume cannot be reused here (those orders have
// providerRef = null and the endpoint returns 409), so we re-validate
// freshness via the read-only GET /orders/:id before redirecting.
//
// Result kinds are intentionally split into three cases:
//   - redirect:   order is still pending and reservation has not lapsed.
//   - stale:      server confirms the order is no longer payable
//                 (terminal status or reservation expiresAt <= now).
//                 Caller may safely discard the stored URL.
//   - unverified: freshness could not be confirmed (fetch threw, e.g.
//                 transient network/API error). Caller MUST keep the
//                 stored URL so the user can retry — one bad fetch must
//                 not permanently remove the only resume path for a
//                 still-pending order.

export type WebResumeAction =
  | { kind: 'redirect'; url: string }
  | { kind: 'stale' }
  | { kind: 'unverified' };

export interface ResumeFreshnessOrder {
  status: string;
  expiresAt: string | null;
}

export interface ResolveWebResumeDeps {
  fetchOrderStatus: (orderId: string) => Promise<ResumeFreshnessOrder>;
  getStoredUrl: (orderId: string) => string | null;
  now?: () => Date;
}

export async function resolveWebResume(
  orderId: string,
  deps: ResolveWebResumeDeps,
): Promise<WebResumeAction> {
  const url = deps.getStoredUrl(orderId);
  if (!url) return { kind: 'stale' };

  let order: ResumeFreshnessOrder;
  try {
    order = await deps.fetchOrderStatus(orderId);
  } catch {
    return { kind: 'unverified' };
  }

  if (order.status !== 'pending') return { kind: 'stale' };

  if (order.expiresAt) {
    const nowMs = (deps.now ?? (() => new Date()))().getTime();
    const expiresMs = new Date(order.expiresAt).getTime();
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
      return { kind: 'stale' };
    }
  }

  return { kind: 'redirect', url };
}
