/**
 * Pedido (qualquer tipo) — a tela de reembolso.
 *
 * /loja/pedidos/[id] só existe para pedidos de produto físico: a API 404 tudo
 * que não for `product`/`mixed` com item físico. Como `Order.kind` nasce
 * `ticket`, o pedido mais comum do clube não tinha tela nenhuma e o reembolso
 * dele só saía pelo dashboard da Stripe. Esta página cobre os outros tipos.
 *
 * O que ela NÃO faz, de propósito: nenhuma transição de fulfillment. Ingresso
 * e extra não têm fila de preparo — a liquidação já emite o ingresso. Para
 * pedidos que têm fila, a página só aponta o link da fila certa.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PAYMENT_STATUS_LABEL } from '../../loja/pedidos/status-labels';

import { RefundOrderForm } from '~/components/refund-order-form';
import { getAdminOrder } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  ticket: 'Pedido de ingresso',
  extras_only: 'Pedido de extras',
  product: 'Pedido de produtos',
  mixed: 'Pedido misto',
  box: 'Pedido de box',
};

const formatBRL = (cents: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let order;
  try {
    order = await getAdminOrder(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    // GET /admin/orders/:id é admin-only, mas /users/[id] é organizer+admin e
    // aponta para cá. Sem este ramo o 403 vira tela de erro do Next, que não
    // diz nada ao operador. Erro esperado, não crash.
    if (e instanceof ApiError && e.status === 403) {
      return (
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold">Acesso restrito</h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            Só administradores podem abrir o detalhe de um pedido.
          </p>
        </section>
      );
    }
    throw e;
  }

  // Nenhum preço por linha no caminho legado (pedido de ingresso do
  // POST /orders não tem OrderItem). Mostrar R$ 0,00 ali leria como grátis.
  const hasLinePrices = order.lines.some((l) => l.subtotalCents !== null);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pedido #{order.shortId}</h1>
          <p className="text-xs text-[color:var(--color-muted)]">
            {KIND_LABEL[order.kind] ?? order.kind} · criado em {formatDate(order.createdAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          <span className="text-xs text-[color:var(--color-muted)]">
            Pagamento: {PAYMENT_STATUS_LABEL[order.paymentStatus] ?? order.paymentStatus}
          </span>
          {order.eventTitle ? (
            <span className="text-xs text-[color:var(--color-muted)]">
              Evento: {order.eventTitle}
            </span>
          ) : null}
        </div>
      </header>

      {order.fulfillmentSurface === 'store' ? (
        <p className="text-sm">
          <Link href={`/loja/pedidos/${order.id}`} className="underline">
            Gerenciar envio/retirada na fila da loja →
          </Link>
        </p>
      ) : null}
      {order.fulfillmentSurface === 'box' ? (
        <p className="text-sm">
          <Link href="/box/caixas" className="underline">
            Gerenciar esta caixa na fila do Box →
          </Link>
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-2 flex flex-col gap-6">
          {order.lines.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
                Itens
              </h2>
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
                    <th className="py-2">Item</th>
                    <th>Qtd</th>
                    {hasLinePrices ? <th className="text-right">Unit.</th> : null}
                    {hasLinePrices ? <th className="text-right">Subtotal</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l) => (
                    <tr key={l.id} className="border-b border-[color:var(--color-border)]">
                      <td className="py-2">
                        <div>{l.label}</div>
                        {l.sublabel ? (
                          <div className="text-xs text-[color:var(--color-muted)]">
                            {l.sublabel}
                          </div>
                        ) : null}
                      </td>
                      <td>{l.quantity}</td>
                      {hasLinePrices ? (
                        <td className="text-right">
                          {l.unitPriceCents === null
                            ? '—'
                            : formatBRL(l.unitPriceCents, order.currency)}
                        </td>
                      ) : null}
                      {hasLinePrices ? (
                        <td className="text-right">
                          {l.subtotalCents === null
                            ? '—'
                            : formatBRL(l.subtotalCents, order.currency)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasLinePrices ? null : (
                <p className="mt-2 text-xs text-[color:var(--color-muted)]">
                  Este pedido não tem valor por linha registrado. Só o total abaixo é confiável.
                </p>
              )}
            </section>
          ) : null}

          {order.history.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
                Histórico
              </h2>
              <ul className="flex flex-col gap-2 text-xs">
                {order.history.map((h) => {
                  const meta = h.metadata ?? {};
                  const reason = typeof meta.reason === 'string' ? meta.reason : null;
                  return (
                    <li
                      key={h.id}
                      className="rounded border border-[color:var(--color-border)] p-2"
                    >
                      <div className="flex justify-between">
                        <span>{h.action}</span>
                        <span className="text-[color:var(--color-muted)]">
                          {formatDate(h.createdAt)}
                        </span>
                      </div>
                      <div className="text-[color:var(--color-muted)]">
                        {h.actorName ?? h.actorEmail ?? 'Operador'}
                      </div>
                      {reason ? <div className="mt-1">{reason}</div> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
              Cliente
            </h2>
            <p className="text-sm">
              <Link href={`/users/${order.customer.id}`} className="underline">
                {order.customer.name}
              </Link>
            </p>
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
            {order.shippingCents > 0 ? (
              <p className="text-xs">Frete: {formatBRL(order.shippingCents, order.currency)}</p>
            ) : null}
            <p className="mt-1 text-sm font-semibold">
              Total: {formatBRL(order.amountCents, order.currency)}
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase text-[color:var(--color-muted)]">
              Reembolso
            </h2>
            <RefundOrderForm
              orderId={order.id}
              status={order.paymentStatus}
              provider={order.provider}
              siblingOrderCount={order.refundImpact.siblingOrderCount}
              siblingTicketCount={order.refundImpact.siblingTicketCount}
              ownTicketCount={order.refundImpact.ownTicketCount ?? 0}
              ownExtraItemCount={order.refundImpact.ownExtraItemCount ?? 0}
              siblingExtraItemCount={order.refundImpact.siblingExtraItemCount ?? 0}
              ownVoucherCount={order.refundImpact.ownVoucherCount ?? 0}
              siblingVoucherCount={order.refundImpact.siblingVoucherCount ?? 0}
            />
          </section>
        </aside>
      </div>
    </section>
  );
}
