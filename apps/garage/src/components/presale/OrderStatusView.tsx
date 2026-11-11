import type { PresaleOrderStatusResponse } from '@ccc/shared/presale';

import { presaleCopy } from '~/copy/presale';
import { fmtCurrencyCents } from '~/lib/format';

// The real order status has six values (orderStatusSchema in orders.ts), but
// this page only distinguishes four: pending, paid, refunded, and a single
// "try again" bucket for failed/expired/cancelled. page.tsx does that
// mapping; this component just renders whatever bucket it's given.
export type OrderDisplayStatus = 'pending' | 'paid' | 'refunded' | 'failed';

type Props = {
  status: OrderDisplayStatus;
  order: PresaleOrderStatusResponse;
  /**
   * Campaign pickup address, fetched separately by page.tsx (one-shot, not
   * polled) via fetchPresaleCampaign. Only used for `paid` + `pickup`. Stays
   * optional/null so a failed or not-yet-finished campaign fetch falls back
   * to copy.paid.pickupFallback instead of rendering nothing.
   */
  pickupAddress?: string | null;
};

/**
 * PURE component: status and order arrive as props, nothing is fetched and
 * no state is held here. Polling lives in page.tsx — that split is what lets
 * this render with renderToStaticMarkup in vitest's node environment (no
 * jsdom, see apps/garage/vitest.config.ts).
 */
export function OrderStatusView({ status, order, pickupAddress = null }: Props) {
  const copy = presaleCopy.orderStatus;
  const statusCopy = copy[status];

  return (
    <div className="flex flex-col gap-6 text-fg">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{statusCopy.title}</h1>
        <p className="text-sm text-fg-secondary">{statusCopy.body}</p>
      </header>

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
