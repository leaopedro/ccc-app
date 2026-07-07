'use client';

import type { AdminStoreCollection } from '@jdm/shared/admin';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { reorderCollectionsAction } from '~/lib/collection-actions';

type Props = {
  items: AdminStoreCollection[];
};

const moveItem = <T,>(arr: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed!);
  return next;
};

export const CollectionReorder = ({ items: initial }: Props) => {
  const [items, setItems] = useState(initial);
  const [pending, startTransition] = useTransition();

  const persist = (next: AdminStoreCollection[]) => {
    setItems(next);
    startTransition(async () => {
      await reorderCollectionsAction(next.map((c) => c.id));
    });
  };

  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
          <th className="py-2">Ordem</th>
          <th>Nome</th>
          <th>Status</th>
          <th className="text-right">Produtos</th>
          <th className="w-32"></th>
        </tr>
      </thead>
      <tbody>
        {items.map((collection, index) => (
          <tr key={collection.id} className="border-b border-[color:var(--color-border)]">
            <td className="py-2 align-middle">
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  aria-label="Mover para cima"
                  disabled={index === 0 || pending}
                  onClick={() => persist(moveItem(items, index, index - 1))}
                  className="rounded border border-[color:var(--color-border)] px-2 text-xs disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Mover para baixo"
                  disabled={index === items.length - 1 || pending}
                  onClick={() => persist(moveItem(items, index, index + 1))}
                  className="rounded border border-[color:var(--color-border)] px-2 text-xs disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
            </td>
            <td>
              <Link href={`/loja/colecoes/${collection.id}`} className="hover:underline">
                {collection.name}
              </Link>
              <div className="text-xs text-[color:var(--color-muted)]">{collection.slug}</div>
            </td>
            <td className="text-sm">{collection.active ? 'Ativa' : 'Inativa'}</td>
            <td className="text-right text-sm">{collection.productCount}</td>
            <td className="text-right text-xs text-[color:var(--color-muted)]">
              {pending ? 'Salvando…' : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
