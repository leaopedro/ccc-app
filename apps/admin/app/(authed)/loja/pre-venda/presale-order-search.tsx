'use client';

import type { AdminPresaleOrderSearchItem } from '@ccc/shared/admin';
import Link from 'next/link';
import { useState } from 'react';

import { searchPresaleOrders } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';

const inputCls =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm';

export const PresaleOrderSearch = () => {
  const [email, setEmail] = useState('');
  const [orders, setOrders] = useState<AdminPresaleOrderSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const result = await searchPresaleOrders(email);
      setOrders(result.orders);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao buscar pedidos');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          void handleSearch(e);
        }}
        className="flex gap-2"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email do convidado"
          className={inputCls}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
        >
          {loading ? '...' : 'Buscar'}
        </button>
      </form>

      {error ? <div className="text-xs text-red-400">{error}</div> : null}

      {orders.length > 0 ? (
        <div className="overflow-x-auto rounded border border-[color:var(--color-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--color-border)] bg-[color:var(--color-subtle-bg)]">
                <th className="px-3 py-2 text-left font-semibold">ID</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold">Valor</th>
                <th className="px-3 py-2 text-left font-semibold">Data</th>
                <th className="px-3 py-2 text-left font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-subtle-bg)]"
                >
                  <td className="px-3 py-2">{order.shortId}</td>
                  <td className="px-3 py-2">{order.status}</td>
                  <td className="px-3 py-2">
                    {new Intl.NumberFormat('pt-BR', {
                      style: 'currency',
                      currency: order.currency,
                    }).format(order.amountCents / 100)}
                  </td>
                  <td className="px-3 py-2">
                    {new Date(order.createdAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/pedidos/${order.id}`}
                      className="text-xs text-[color:var(--color-accent)] hover:underline"
                    >
                      Detalhe
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : email && !loading && !error ? (
        <div className="text-xs text-[color:var(--color-muted)]">Nenhum pedido encontrado.</div>
      ) : null}
    </div>
  );
};
