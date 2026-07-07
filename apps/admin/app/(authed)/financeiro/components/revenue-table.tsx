'use client';

import type { AdminFinanceEventRow } from '@jdm/shared/admin';
import { useCallback, useMemo, useState } from 'react';

const fmtCurrency = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const fmtNumber = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

type SortKey = 'eventTitle' | 'revenueCents' | 'orderCount' | 'ticketCount' | 'startsAt';
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

export function RevenueTable({ items }: { items: AdminFinanceEventRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('revenueCents');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-[color:var(--color-border)] p-4">
        <h3 className="mb-3 text-sm font-semibold">Receita por evento</h3>
        <p className="text-sm text-[color:var(--color-muted)]">Nenhum evento encontrado.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[color:var(--color-border)] p-4">
      <h3 className="mb-3 text-sm font-semibold">Receita por evento</h3>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
              <SortHeader
                label="Evento"
                field="eventTitle"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Data"
                field="startsAt"
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
              <SortHeader
                label="Pedidos"
                field="orderCount"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Ingressos"
                field="ticketCount"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <>
                <tr
                  key={row.eventId}
                  className="cursor-pointer border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-border)]/30"
                  onClick={() =>
                    setExpandedId((prev) => (prev === row.eventId ? null : row.eventId))
                  }
                >
                  <td className="py-2">
                    <div>{row.eventTitle}</div>
                    {row.city ? (
                      <div className="text-xs text-[color:var(--color-muted)]">
                        {[row.city, row.stateCode].filter(Boolean).join('/')}
                      </div>
                    ) : null}
                  </td>
                  <td className="tabular-nums">{fmtDate(row.startsAt)}</td>
                  <td className="tabular-nums font-medium">{fmtCurrency(row.revenueCents)}</td>
                  <td className="tabular-nums">{fmtNumber(row.orderCount)}</td>
                  <td className="tabular-nums">{fmtNumber(row.ticketCount)}</td>
                </tr>
                {expandedId === row.eventId ? (
                  <tr key={`${row.eventId}-detail`}>
                    <td colSpan={5} className="bg-[color:var(--color-border)]/20 px-4 py-3 text-sm">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs text-[color:var(--color-muted)]">
                            Reembolsado
                          </span>
                          <div className="tabular-nums">{fmtCurrency(row.refundedCents)}</div>
                        </div>
                        <div>
                          <span className="text-xs text-[color:var(--color-muted)]">
                            Receita líquida
                          </span>
                          <div className="tabular-nums font-medium">
                            {fmtCurrency(row.revenueCents - row.refundedCents)}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 sm:hidden">
        {sorted.map((row) => (
          <div
            key={row.eventId}
            className="rounded-lg border border-[color:var(--color-border)] p-3"
            onClick={() => setExpandedId((prev) => (prev === row.eventId ? null : row.eventId))}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{row.eventTitle}</div>
                <div className="text-xs text-[color:var(--color-muted)]">
                  {fmtDate(row.startsAt)}
                  {row.city ? ` · ${[row.city, row.stateCode].filter(Boolean).join('/')}` : ''}
                </div>
              </div>
              <div className="text-right tabular-nums font-semibold text-[color:var(--color-accent)]">
                {fmtCurrency(row.revenueCents)}
              </div>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-[color:var(--color-muted)]">
              <span>{fmtNumber(row.orderCount)} pedidos</span>
              <span>{fmtNumber(row.ticketCount)} ingressos</span>
            </div>
            {expandedId === row.eventId ? (
              <div className="mt-2 border-t border-[color:var(--color-border)] pt-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-xs text-[color:var(--color-muted)]">Reembolsado</span>
                  <span className="tabular-nums">{fmtCurrency(row.refundedCents)}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-xs text-[color:var(--color-muted)]">Receita líquida</span>
                  <span className="tabular-nums font-medium">
                    {fmtCurrency(row.revenueCents - row.refundedCents)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
