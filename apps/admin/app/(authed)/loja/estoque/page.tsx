import { adminStoreInventoryFilterSchema, type AdminStoreInventoryFilter } from '@jdm/shared/admin';
import Link from 'next/link';

import { InventoryRow } from './inventory-row';

import { listAdminStoreInventory } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const FILTER_LABELS: Record<AdminStoreInventoryFilter, string> = {
  all: 'Todos',
  low: 'Estoque baixo',
  zero: 'Esgotados',
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const parsedFilter = adminStoreInventoryFilterSchema.safeParse(params.status);
  const filter: AdminStoreInventoryFilter = parsedFilter.success ? parsedFilter.data : 'all';

  const { threshold, totals, items } = await listAdminStoreInventory(filter);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Estoque</h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            Limite de estoque baixo: <strong>{threshold}</strong>{' '}
            <Link
              href="/loja/configuracoes"
              className="underline decoration-dotted hover:decoration-solid"
            >
              ajustar
            </Link>
          </p>
        </div>
        <nav className="flex gap-1 text-sm" aria-label="Filtro de estoque">
          {(['all', 'low', 'zero'] as const).map((f) => {
            const count = f === 'all' ? totals.all : f === 'low' ? totals.low : totals.zero;
            const active = filter === f;
            return (
              <Link
                key={f}
                href={f === 'all' ? '/loja/estoque' : `/loja/estoque?status=${f}`}
                className={`rounded border px-3 py-1 ${
                  active
                    ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-black'
                    : 'border-[color:var(--color-border)]'
                }`}
              >
                {FILTER_LABELS[f]} ({count})
              </Link>
            );
          })}
        </nav>
      </header>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
            <th className="py-2">Produto</th>
            <th>Variante</th>
            <th>SKU</th>
            <th className="text-right">Vendidos</th>
            <th className="text-right">Disponível</th>
            <th>Estoque total</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <InventoryRow key={row.variantId} row={row} />
          ))}
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-6 text-center text-[color:var(--color-muted)]">
                Nenhuma variante para este filtro.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
