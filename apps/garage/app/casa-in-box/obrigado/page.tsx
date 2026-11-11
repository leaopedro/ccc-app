'use client';

import type { OrderStatus } from '@ccc/shared/orders';
import { PRESALE_ORDER_STATUS_QUERY, type PresaleOrderStatusResponse } from '@ccc/shared/presale';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { OrderStatusView, type OrderDisplayStatus } from '~/components/presale/OrderStatusView';
import { presaleCopy } from '~/copy/presale';
import { fetchPresaleCampaign, fetchPresaleOrderStatus, PresaleApiError } from '~/lib/presale-api';

// Settlement arrives via Stripe webhook (CLAUDE.md: orders only flip to
// `paid` from verified provider webhooks, never from a client call), which
// can lag the success redirect by a few seconds. This page only reads
// status — it polls, it never writes one.
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 30; // 30 * 2s = 60s cap, then stop and offer a manual check.

// The real order status has six values (orderStatusSchema, orders.ts), but
// this page distinguishes only four: pending, paid, refunded, and a single
// "try again" bucket for failed/expired/cancelled.
function toDisplayStatus(status: OrderStatus): OrderDisplayStatus {
  if (status === 'pending') return 'pending';
  if (status === 'paid') return 'paid';
  if (status === 'refunded') return 'refunded';
  return 'failed';
}

type PollState =
  | { phase: 'loading' }
  | { phase: 'notFound' }
  | { phase: 'error' }
  | { phase: 'loaded'; order: PresaleOrderStatusResponse; timedOut: boolean };

function Column({ children }: { children: React.ReactNode }) {
  // Outside the (garage) route group's layout, so this page carries its own
  // copy of the 430px column — same reasoning as app/not-found.tsx.
  return (
    <div className="mx-auto min-h-screen w-full max-w-[430px] bg-bg px-5 py-10 shadow-2xl">
      {children}
    </div>
  );
}

function Heading({ title, body }: { title: string; body?: string }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold text-fg">{title}</h1>
      {body ? <p className="text-sm text-fg-secondary">{body}</p> : null}
    </header>
  );
}

function PollingOrderStatus({ orderId, token }: { orderId: string; token: string }) {
  const [state, setState] = useState<PollState>({ phase: 'loading' });
  const [pickupAddress, setPickupAddress] = useState<string | null>(null);
  const attemptsRef = useRef(0);
  // Bumped by the "verificar novamente" button to restart the effect below
  // after the 60s cap gives up while still `pending`.
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    attemptsRef.current = 0;

    const check = () => {
      fetchPresaleOrderStatus(orderId, token)
        .then((order) => {
          if (cancelled) return;
          const displayStatus = toDisplayStatus(order.status);

          if (displayStatus === 'pending') {
            attemptsRef.current += 1;
            const timedOut = attemptsRef.current >= POLL_MAX_ATTEMPTS;
            setState({ phase: 'loaded', order, timedOut });
            if (!timedOut) {
              timer = setTimeout(check, POLL_INTERVAL_MS);
            }
            return;
          }

          // Terminal state (paid, refunded, or the failed/expired/cancelled
          // bucket): stop immediately, do not keep polling.
          setState({ phase: 'loaded', order, timedOut: false });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // A 404 means the token did not match the order — its own state,
          // not a crash (the bookmarked-link-opened-days-later case).
          if (err instanceof PresaleApiError && err.status === 404) {
            setState({ phase: 'notFound' });
            return;
          }
          setState({ phase: 'error' });
        });
    };

    check();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, token, retryTick]);

  // One-shot campaign lookup for the pickup address, only once the order is
  // confirmed paid and fulfillment is pickup. Not polled, and failure falls
  // back to copy.orderStatus.paid.pickupFallback (fail-open).
  useEffect(() => {
    if (
      state.phase === 'loaded' &&
      state.order.status === 'paid' &&
      state.order.fulfillmentMethod === 'pickup' &&
      pickupAddress === null
    ) {
      fetchPresaleCampaign()
        .then((campaign) => setPickupAddress(campaign.pickupAddress))
        .catch(() => {
          // Fail-open: OrderStatusView falls back to pickupFallback copy.
        });
    }
  }, [state, pickupAddress]);

  if (state.phase === 'notFound') {
    return (
      <Heading
        title={presaleCopy.orderStatus.notFound.title}
        body={presaleCopy.orderStatus.notFound.body}
      />
    );
  }

  if (state.phase === 'error') {
    return (
      <Heading title={presaleCopy.errors.generic.title} body={presaleCopy.errors.generic.body} />
    );
  }

  if (state.phase === 'loading') {
    return <Heading title={presaleCopy.orderStatus.loading.title} />;
  }

  const displayStatus = toDisplayStatus(state.order.status);

  return (
    <div className="flex flex-col gap-6">
      <OrderStatusView status={displayStatus} order={state.order} pickupAddress={pickupAddress} />
      {displayStatus === 'pending' && state.timedOut ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm text-fg-secondary">{presaleCopy.orderStatus.pollingTimeout.body}</p>
          <button
            type="button"
            onClick={() => setRetryTick((n) => n + 1)}
            className="inline-flex w-fit items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-bg"
          >
            {presaleCopy.orderStatus.pollingTimeout.checkAgainCta}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ObrigadoContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get(PRESALE_ORDER_STATUS_QUERY.orderId);
  const token = searchParams.get(PRESALE_ORDER_STATUS_QUERY.token);

  // orderId/token missing from the page's own querystring — not one of the
  // four order states, the page can't even ask for one.
  if (!orderId || !token) {
    return (
      <Heading
        title={presaleCopy.orderStatus.missingParams.title}
        body={presaleCopy.orderStatus.missingParams.body}
      />
    );
  }

  return <PollingOrderStatus orderId={orderId} token={token} />;
}

export default function ObrigadoPage() {
  return (
    <Column>
      <Suspense fallback={<Heading title={presaleCopy.orderStatus.loading.title} />}>
        <ObrigadoContent />
      </Suspense>
    </Column>
  );
}
