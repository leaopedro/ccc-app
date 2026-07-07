import {
  adminStoreOrderQueueFilterSchema,
  type AdminStoreOrderQueueFilter,
} from '@jdm/shared/admin';
import Link from 'next/link';

import {
  FULFILLMENT_METHOD_LABEL,
  FULFILLMENT_STATUS_BADGE,
  FULFILLMENT_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  QUEUE_FILTER_LABEL,
} from './status-labels';

import { listAdminStoreOrders } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const KIND_FILTER = ['all', 'product', 'mixed'] as const;
type KindFilter = (typeof KIND_FILTER)[number];

const formatBRL = (cents: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const FILTER_ORDER: AdminStoreOrderQueueFilter[] = [
  'all',
  'open',
  'unfulfilled',
  'packed',
  'shipped',
  'pickup_ready',
  'picked_up',
  'delivered',
  'cancelled',
];

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string; q?: string }>;
}) {
  const params = await searchParams;
  const parsedStatus = adminStoreOrderQueueFilterSchema.safeParse(params.status);
  const status: AdminStoreOrderQueueFilter = parsedStatus.success ? parsedStatus.data : 'all';
  const kind: KindFilter = KIND_FILTER.includes(params.kind as KindFilter)
    ? (params.kind as KindFilter)
    : 'all';
  const q = typeof params.q === 'string' && params.q.trim() !== '' ? params.q.trim() : undefined;

  const { totals, items } = await listAdminStoreOrders({ status, kind, q });

  const buildHref = (overrides: {
    status?: AdminStoreOrderQueueFilter;
    kind?: KindFilter;
    q?: string;
  }) => {
    const next = new URLSearchParams();
    const s = overrides.status ?? status;
    const k = overrides.kind ?? kind;
    const query = overrides.q ?? q;
    if (s !== 'all') next.set('status', s);
    if (k !== 'all') next.set('kind', k);
    if (query) next.set('q', query);
    const qs = next.toString();
    return `/loja/pedidos${qs ? `?${qs}` : ''}`;
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Pedidos</h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            Pedidos de produtos e mistos. Atualize o status de fulfillment.
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm" action="/loja/pedidos">
          {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
          {kind !== 'all' ? <input type="hidden" name="kind" value={kind} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar por id, e-mail, nome..."
            className="w-64 rounded border border-[color:var(--color-border)] bg-transparent px-3 py-1.5"
            aria-label="Buscar pedido"
          />
          <button
            type="submit"
            className="rounded border border-[color:var(--color-border)] px-3 py-1.5"
          >
            Buscar
          </button>
        </form>
      </header>

      <nav className="flex flex-wrap gap-1 text-sm" aria-label="Filtro de status">
        {FILTER_ORDER.map((f) => {
          const count = totals[f];
          const active = status === f;
          return (
            <Link
              key={f}
              href={buildHref({ status: f })}
              aria-current={active ? 'page' : undefined}
              className={`rounded border px-3 py-1 ${
                active
                  ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-black'
                  : 'border-[color:var(--color-border)]'
              }`}
            >
              {QUEUE_FILTER_LABEL[f]} ({count})
            </Link>
          );
        })}
      </nav>

      <nav className="flex flex-wrap gap-1 text-xs" aria-label="Filtro por tipo">
        {KIND_FILTER.map((k) => {
          const active = kind === k;
          const label = k === 'all' ? 'Todos os tipos' : k === 'product' ? 'Produto' : 'Misto';
          return (
            <Link
              key={k}
              href={buildHref({ kind: k })}
              aria-current={active ? 'page' : undefined}
              className={`rounded border px-2 py-0.5 ${
                active
                  ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                  : 'border-[color:var(--color-border)] text-[color:var(--color-muted)]'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
            <th className="py-2">Pedido</th>
            <th>Cliente</th>
            <th>Tipo</th>
            <th>Pagamento</th>
            <th>Fulfillment</th>
            <th>Método</th>
            <th className="text-right">Total</th>
            <th>Pago em</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((row) => {
            const badge = FULFILLMENT_STATUS_BADGE[row.fulfillmentStatus];
            return (
              <tr key={row.id} className="border-b border-[color:var(--color-border)] align-top">
                <td className="py-2">
                  <div className="font-mono text-xs">#{row.shortId}</div>
                  <div className="text-xs text-[color:var(--color-muted)]">
                    {row.itemCount} {row.itemCount === 1 ? 'item' : 'itens'}
                    {row.trackingCode ? ` · ${row.trackingCode}` : ''}
                  </div>
                </td>
                <td>
                  <div>{row.customerName}</div>
                  <div className="text-xs text-[color:var(--color-muted)]">{row.customerEmail}</div>
                </td>
                <td className="text-xs uppercase text-[color:var(--color-muted)]">{row.kind}</td>
                <td className="text-xs">
                  {PAYMENT_STATUS_LABEL[row.paymentStatus] ?? row.paymentStatus}
                </td>
                <td>
                  <span className={`inline-block rounded border px-2 py-0.5 text-xs ${badge}`}>
                    {FULFILLMENT_STATUS_LABEL[row.fulfillmentStatus]}
                  </span>
                </td>
                <td className="text-xs">{FULFILLMENT_METHOD_LABEL[row.fulfillmentMethod]}</td>
                <td className="text-right">{formatBRL(row.amountCents, row.currency)}</td>
                <td className="text-xs">{formatDate(row.paidAt)}</td>
                <td className="text-right">
                  <Link
                    href={`/loja/pedidos/${row.id}`}
                    className="rounded border border-[color:var(--color-border)] px-2 py-1 text-xs hover:bg-[color:var(--color-border)]"
                  >
                    Detalhes
                  </Link>
                </td>
              </tr>
            );
          })}
          {items.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-6 text-center text-[color:var(--color-muted)]">
                Nenhum pedido para este filtro.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
