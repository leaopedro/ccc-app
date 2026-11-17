import type { PresaleOrderStatusResponse } from '@ccc/shared/presale';

import { presaleCopy } from '~/copy/presale';
import { fmtCurrencyCents, fmtTime } from '~/lib/format';

// The real order status has six values (orderStatusSchema in orders.ts), but
// this page only distinguishes four: pending, paid, refunded, and a single
// "try again" bucket for failed/expired/cancelled. page.tsx does that
// mapping; this component just renders whatever bucket it's given.
export type OrderDisplayStatus = 'pending' | 'paid' | 'refunded' | 'failed';

type Props = {
  status: OrderDisplayStatus;
  order: PresaleOrderStatusResponse;
  /**
   * Current time, injected by the caller (page.tsx passes `new Date()`) —
   * never `Date.now()`/`new Date()` inside this component. It is only used
   * to decide whether a pending Pix code has passed its deadline, and
   * passing it in is what lets that decision be exercised in a test without
   * depending on the wall clock at the moment the test happens to run.
   */
  now: Date;
  /**
   * Campaign pickup address, fetched separately by page.tsx (one-shot, not
   * polled) via fetchPresaleCampaign. Only used for `paid` + `pickup`. Stays
   * optional/null so a failed or not-yet-finished campaign fetch falls back
   * to copy.paid.pickupFallback instead of rendering nothing.
   */
  pickupAddress?: string | null;
};

/** Pure: true once `pixExpiresAt` has passed `now`. Null deadline (card
 * orders, or a Pix order before the deadline exists) is never expired. */
export function isPixExpired(pixExpiresAt: string | null, now: Date): boolean {
  if (pixExpiresAt === null) return false;
  return new Date(pixExpiresAt).getTime() <= now.getTime();
}

/**
 * PURE component: status, order, and now arrive as props, nothing is
 * fetched and no state is held here. Polling lives in page.tsx — that split
 * is what lets this render with renderToStaticMarkup in vitest's node
 * environment (no jsdom, see apps/garage/vitest.config.ts).
 */
export function OrderStatusView({ status, order, now, pickupAddress = null }: Props) {
  const copy = presaleCopy.orderStatus;
  const statusCopy = copy[status];

  // A pending order carries a Pix code when brCode/pixExpiresAt are set
  // (Task 6 — null for card). The deadline can pass before the next poll
  // confirms it server-side, so this is checked against the injected `now`
  // independently of `order.status`.
  const isPixOrder = status === 'pending' && order.brCode !== null && order.pixExpiresAt !== null;
  const pixExpired = isPixOrder && isPixExpired(order.pixExpiresAt, now);
  const headerCopy = pixExpired ? copy.pix.expired : statusCopy;

  return (
    <div className="flex flex-col gap-6 text-fg">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{headerCopy.title}</h1>
        <p className="text-sm text-fg-secondary">{headerCopy.body}</p>
      </header>

      {status === 'pending' &&
      order.brCode !== null &&
      order.pixExpiresAt !== null &&
      !pixExpired ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {copy.pix.codeLabel}
          </h2>
          <p className="break-all font-mono text-sm">{order.brCode}</p>
          <p className="text-xs text-fg-secondary">
            {copy.pix.deadlineLabel(fmtTime(order.pixExpiresAt))}
          </p>
        </section>
      ) : null}

      {status === 'paid' ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {copy.paid.itemsTitle}
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {order.items.map((item, index) => (
                <li key={`${item.title}-${index}`} className="flex justify-between gap-3 text-sm">
                  <span>
                    {copy.paid.itemQuantity(item.quantity)} {item.title}
                  </span>
                  <span>{fmtCurrencyCents(item.subtotalCents, order.currency)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-between text-sm font-semibold">
            <span>{copy.paid.totalLabel}</span>
            <span>{fmtCurrencyCents(order.amountCents, order.currency)}</span>
          </div>

          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {order.fulfillmentMethod === 'ship'
                ? presaleCopy.fulfillment.ship
                : presaleCopy.fulfillment.pickup}
            </h2>

            {order.fulfillmentMethod === 'ship' && order.delivery ? (
              <p className="mt-1 text-sm text-fg-secondary">
                {order.delivery.recipientName} — {order.delivery.line1}, {order.delivery.number} ·{' '}
                {order.delivery.district}, {order.delivery.city} - {order.delivery.stateCode} ·{' '}
                {order.delivery.postalCode}
              </p>
            ) : null}

            {order.fulfillmentMethod === 'pickup' ? (
              <p className="mt-1 text-sm text-fg-secondary">
                {pickupAddress ?? copy.paid.pickupFallback}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {status === 'failed' ? (
        <a
          href="/casa-in-box"
          className="inline-flex w-fit items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-bg"
        >
          {copy.failed.retryCta}
        </a>
      ) : null}
    </div>
  );
}
