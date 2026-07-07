'use client';

import type { AdminFinanceProductRow } from '@jdm/shared/admin';
import { useCallback, useMemo, useState } from 'react';

const fmtCurrency = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const fmtNumber = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

type SortKey = 'productTitle' | 'orderCount' | 'quantitySold' | 'revenueCents';
type SortDir = 'asc' | 'desc';

function SortHeader({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th className="cursor-pointer py-2 text-left select-none" onClick={() => onSort(field)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === field ? (
          <span className="text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span>
        ) : null}
      </span>
    </th>
  );
}

export function ProductTable({ items }: { items: AdminFinanceProductRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('revenueCents');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === 'asc' ? an - bn : bn - an;
    });
    return copy;
  }, [items, sortKey, sortDir]);

  return (
    <div className="rounded-lg border border-[color:var(--color-border)] p-4">
      <h3 className="mb-3 text-sm font-semibold">Receita por produto</h3>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
              <SortHeader
                label="Produto"
                field="productTitle"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Pedidos"
                field="orderCount"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Unidades"
                field="quantitySold"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Receita"
                field="revenueCents"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.productId}
                className="border-b border-[color:var(--color-border)] last:border-0"
              >
                <td className="py-2 font-medium">{row.productTitle}</td>
                <td className="tabular-nums">{fmtNumber(row.orderCount)}</td>
                <td className="tabular-nums">{fmtNumber(row.quantitySold)}</td>
                <td className="tabular-nums font-medium">{fmtCurrency(row.revenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 sm:hidden">
        {sorted.map((row) => (
          <div
            key={row.productId}
            className="rounded-lg border border-[color:var(--color-border)] p-3"
          >
            <div className="flex items-start justify-between">
              <div className="font-medium">{row.productTitle}</div>
              <div className="tabular-nums font-semibold" style={{ color: '#f97316' }}>
                {fmtCurrency(row.revenueCents)}
              </div>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-[color:var(--color-muted)]">
              <span>{fmtNumber(row.orderCount)} pedidos</span>
              <span>{fmtNumber(row.quantitySold)} unidades</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
