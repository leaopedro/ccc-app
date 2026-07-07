import type { StoreFulfillmentStatus } from '@jdm/shared/store';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  FULFILLMENT_METHOD_LABEL,
  FULFILLMENT_STATUS_BADGE,
  FULFILLMENT_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
} from '../status-labels';

import { FulfillmentForm } from './fulfillment-form';

import { getAdminStoreOrder } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';

export const dynamic = 'force-dynamic';

const SHIP_TRANSITIONS: Record<StoreFulfillmentStatus, StoreFulfillmentStatus[]> = {
  unfulfilled: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  pickup_ready: [],
  picked_up: [],
  cancelled: [],
};

const PICKUP_TRANSITIONS: Record<StoreFulfillmentStatus, StoreFulfillmentStatus[]> = {
  unfulfilled: ['pickup_ready', 'cancelled'],
  pickup_ready: ['picked_up', 'cancelled'],
  picked_up: [],
  packed: [],
  shipped: [],
  delivered: [],
  cancelled: [],
};

const formatBRL = (cents: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export default async function PedidoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let order;
  try {
    order = await getAdminStoreOrder(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const transitions =
    order.paymentStatus !== 'paid'
      ? []
      : (order.fulfillmentMethod === 'ship' ? SHIP_TRANSITIONS : PICKUP_TRANSITIONS)[
          order.fulfillmentStatus
        ];
  const badge = FULFILLMENT_STATUS_BADGE[order.fulfillmentStatus];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/loja/pedidos" className="text-[color:var(--color-muted)] hover:underline">
          ← Pedidos
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pedido #{order.shortId}</h1>
          <p className="text-xs text-[color:var(--color-muted)]">
            {order.kind === 'mixed' ? 'Pedido misto' : 'Pedido de produtos'} · criado em{' '}
            {formatDate(order.createdAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          <span className={`inline-block rounded border px-2 py-0.5 text-xs ${badge}`}>
            {FULFILLMENT_STATUS_LABEL[order.fulfillmentStatus]}
          </span>
          <span className="text-xs text-[color:var(--color-muted)]">
            Pagamento: {PAYMENT_STATUS_LABEL[order.paymentStatus] ?? order.paymentStatus}
          </span>
          <span className="text-xs text-[color:var(--color-muted)]">
            Método: {FULFILLMENT_METHOD_LABEL[order.fulfillmentMethod]}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-2 flex flex-col gap-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
              Itens
            </h2>
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
                  <th className="py-2">Item</th>
                  <th>Qtd</th>
                  <th className="text-right">Unit.</th>
                  <th className="text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((it) => {
                  const title =
                    it.kind === 'product'
                      ? it.productTitle
                      : it.kind === 'ticket'
                        ? `Ingresso · ${it.tierName ?? ''}`
                        : `Extra · ${it.extraLabel ?? ''}`;
                  const subtitle =
                    it.kind === 'product'
                      ? `${it.variantName ?? ''}${it.variantSku ? ` · SKU ${it.variantSku}` : ''}`
                      : null;
                  return (
                    <tr key={it.id} className="border-b border-[color:var(--color-border)]">
                      <td className="py-2">
                        <div>{title}</div>
                        {subtitle ? (
                          <div className="text-xs text-[color:var(--color-muted)]">{subtitle}</div>
                        ) : null}
                      </td>
                      <td>{it.quantity}</td>
                      <td className="text-right">{formatBRL(it.unitPriceCents, order.currency)}</td>
                      <td className="text-right">{formatBRL(it.subtotalCents, order.currency)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={3} className="py-2 text-right text-[color:var(--color-muted)]">
                    Frete
                  </td>
                  <td className="text-right">{formatBRL(order.shippingCents, order.currency)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="py-2 text-right font-semibold">
                    Total
                  </td>
                  <td className="text-right font-semibold">
                    {formatBRL(order.amountCents, order.currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
              Histórico
            </h2>
            {order.history.length === 0 ? (
              <p className="text-sm text-[color:var(--color-muted)]">Sem registros ainda.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-xs">
                {order.history.map((h) => {
                  const meta = h.metadata ?? {};
                  const from = typeof meta.from === 'string' ? meta.from : null;
                  const to = typeof meta.to === 'string' ? meta.to : null;
                  const tracking = typeof meta.trackingCode === 'string' ? meta.trackingCode : null;
                  const note = typeof meta.note === 'string' ? meta.note : null;
                  return (
                    <li
                      key={h.id}
                      className="rounded border border-[color:var(--color-border)] p-2"
                    >
                      <div className="flex justify-between">
                        <span>
                          {from && to
                            ? `${FULFILLMENT_STATUS_LABEL[from as StoreFulfillmentStatus] ?? from} → ${
                                FULFILLMENT_STATUS_LABEL[to as StoreFulfillmentStatus] ?? to
                              }`
                            : h.action}
                        </span>
                        <span className="text-[color:var(--color-muted)]">
                          {formatDate(h.createdAt)}
                        </span>
                      </div>
                      <div className="text-[color:var(--color-muted)]">
                        {h.actorName ?? h.actorEmail ?? 'Operador'}
                        {tracking ? ` · rastreio ${tracking}` : ''}
                      </div>
                      {note ? <div className="mt-1">{note}</div> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
              Cliente
            </h2>
            <p className="text-sm">{order.customer.name}</p>
            <p className="text-xs text-[color:var(--color-muted)]">{order.customer.email}</p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
              Pagamento
            </h2>
            <p className="text-xs">
              Provedor: <span className="uppercase">{order.provider}</span>
            </p>
            <p className="text-xs break-all">Ref: {order.providerRef ?? '—'}</p>
            <p className="text-xs">Pago em: {formatDate(order.paidAt)}</p>
          </section>

          {order.shippingAddress ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
                Endereço de envio
              </h2>
              <p className="text-sm">{order.shippingAddress.recipientName}</p>
              <p className="text-xs text-[color:var(--color-muted)]">
                {order.shippingAddress.line1}, {order.shippingAddress.number}
                {order.shippingAddress.line2 ? ` — ${order.shippingAddress.line2}` : ''}
              </p>
              <p className="text-xs text-[color:var(--color-muted)]">
                {order.shippingAddress.district} · {order.shippingAddress.city}/
                {order.shippingAddress.stateCode} · {order.shippingAddress.postalCode}
              </p>
              {order.shippingAddress.phone ? (
                <p className="text-xs text-[color:var(--color-muted)]">
                  Tel: {order.shippingAddress.phone}
                </p>
              ) : null}
            </section>
          ) : null}

          {order.pickupEventId ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
                Retirada no evento
              </h2>
              <p className="text-sm">{order.pickupEventTitle ?? order.pickupEventId}</p>
              {order.pickupTicketId ? (
                <p className="text-xs text-[color:var(--color-muted)]">
                  Ticket: {order.pickupTicketId}
                </p>
              ) : null}
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
              Atualizar fulfillment
            </h2>
            {order.paymentStatus !== 'paid' ? (
              <p className="text-sm text-[color:var(--color-muted)]">
                Pedido ainda não foi pago. Aguarde a confirmação do webhook.
              </p>
            ) : (
              <FulfillmentForm order={order} allowedTransitions={transitions} />
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
