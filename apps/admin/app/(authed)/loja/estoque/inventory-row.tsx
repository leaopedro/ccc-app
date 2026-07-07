'use client';

import type { AdminStoreInventoryRow } from '@jdm/shared/admin';
import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { updateInventoryAction, type StoreFormState } from '~/lib/store-actions';

const initial: StoreFormState = { error: null };

const STATUS_BADGE: Record<AdminStoreInventoryRow['status'], { label: string; cls: string }> = {
  zero: { label: 'Esgotado', cls: 'bg-red-500/20 text-red-300 border-red-500/40' },
  low: { label: 'Baixo', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  ok: { label: 'OK', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
};

const Submit = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-2 py-1 text-xs font-semibold text-black disabled:opacity-50"
    >
      {pending ? '…' : 'Salvar'}
    </button>
  );
};

export const InventoryRow = ({ row }: { row: AdminStoreInventoryRow }) => {
  const action = updateInventoryAction.bind(null, row.variantId);
  const [state, dispatch] = useActionState(action, initial);
  const badge = STATUS_BADGE[row.status];
  return (
    <tr className="border-b border-[color:var(--color-border)] align-middle">
      <td className="py-2">
        <Link href={`/loja/produtos/${row.productId}`} className="hover:underline">
          {row.productTitle}
        </Link>
        <div className="text-xs text-[color:var(--color-muted)]">
          {row.productSlug}
          {row.productStatus !== 'active' ? ` · ${row.productStatus}` : ''}
        </div>
      </td>
      <td>
        {row.variantName}
        {!row.active ? (
          <span className="ml-2 text-xs text-[color:var(--color-muted)]">(inativa)</span>
        ) : null}
      </td>
      <td className="text-xs text-[color:var(--color-muted)]">{row.sku ?? '—'}</td>
      <td className="text-right">{row.quantitySold}</td>
      <td className="text-right font-semibold">{row.available}</td>
      <td>
        <form action={dispatch} className="flex items-center gap-2">
          <input
            name="quantityTotal"
            type="number"
            min={row.quantitySold}
            defaultValue={row.quantityTotal}
            aria-label={`Estoque total para ${row.variantName}`}
            className="w-20 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <Submit />
          {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
        </form>
      </td>
      <td>
        <span className={`inline-block rounded border px-2 py-0.5 text-xs ${badge.cls}`}>
          {badge.label}
        </span>
      </td>
    </tr>
  );
};
