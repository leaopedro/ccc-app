'use client';

import type { AdminStoreCollectionDetail } from '@jdm/shared/admin';
import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import {
  deleteCollectionAction,
  setCollectionProductsAction,
  updateCollectionAction,
  type CollectionFormState,
} from '~/lib/collection-actions';

type ProductPickerItem = {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'active' | 'archived';
};

type Props = {
  collection: AdminStoreCollectionDetail;
  availableProducts: ProductPickerItem[];
};

const initial: CollectionFormState = { error: null };

const SaveButton = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
    >
      {pending ? 'Salvando…' : 'Salvar'}
    </button>
  );
};

const moveItem = <T,>(arr: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed!);
  return next;
};

export const CollectionEditor = ({ collection, availableProducts }: Props) => {
  const updateAction = updateCollectionAction.bind(null, collection.id);
  const [state, formAction] = useActionState(updateAction, initial);
  const v = state.values ?? {};

  const initialAssigned = collection.products.map((p) => ({
    id: p.productId,
    slug: p.slug,
    title: p.title,
    status: p.status,
  }));
  const [assigned, setAssigned] = useState<ProductPickerItem[]>(initialAssigned);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [pendingProducts, startProductsTransition] = useTransition();
  const [pendingDelete, startDeleteTransition] = useTransition();

  const assignedIds = new Set(assigned.map((p) => p.id));
  const unassigned = availableProducts.filter((p) => !assignedIds.has(p.id));

  const persistProducts = (next: ProductPickerItem[]) => {
    setAssigned(next);
    setProductsError(null);
    startProductsTransition(async () => {
      const result = await setCollectionProductsAction(
        collection.id,
        next.map((p) => p.id),
      );
      if (result.error) setProductsError(result.error);
    });
  };

  const onAdd = (productId: string) => {
    const product = availableProducts.find((p) => p.id === productId);
    if (!product) return;
    persistProducts([...assigned, product]);
  };

  const onRemove = (productId: string) => {
    persistProducts(assigned.filter((p) => p.id !== productId));
  };

  const onMove = (index: number, delta: number) => {
    persistProducts(moveItem(assigned, index, index + delta));
  };

  const onDelete = () => {
    if (!confirm(`Excluir a coleção "${collection.name}"?`)) return;
    startDeleteTransition(async () => {
      await deleteCollectionAction(collection.id);
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Slug</span>
          <input
            name="slug"
            required
            defaultValue={v.slug ?? collection.slug}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Nome</span>
          <input
            name="name"
            required
            defaultValue={v.name ?? collection.name}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Descrição</span>
          <textarea
            name="description"
            rows={4}
            defaultValue={v.description ?? collection.description ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Ordem</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={v.sortOrder ?? String(collection.sortOrder)}
            className="w-32 rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={collection.active} />
          <span className="text-sm">Ativa</span>
        </label>
        {state.error ? (
          <p role="alert" className="text-sm text-red-500">
            {state.error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <SaveButton />
          <button
            type="button"
            disabled={pendingDelete}
            onClick={onDelete}
            className="rounded border border-red-500 px-4 py-2 text-sm text-red-500 disabled:opacity-50"
          >
            {pendingDelete ? 'Excluindo…' : 'Excluir coleção'}
          </button>
        </div>
      </form>

      <section className="flex flex-col gap-3 border-t border-[color:var(--color-border)] pt-6">
        <header className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Produtos</h2>
          {pendingProducts ? (
            <span className="text-xs text-[color:var(--color-muted)]">Salvando…</span>
          ) : null}
        </header>
        {productsError ? (
          <p role="alert" className="text-sm text-red-500">
            {productsError}
          </p>
        ) : null}
        {assigned.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Nenhum produto associado.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {assigned.map((product, index) => (
              <li
                key={product.id}
                className="flex items-center gap-3 rounded border border-[color:var(--color-border)] px-3 py-2"
              >
                <span className="text-xs text-[color:var(--color-muted)]">{index + 1}</span>
                <div className="flex-1">
                  <div className="text-sm">{product.title}</div>
                  <div className="text-xs text-[color:var(--color-muted)]">
                    {product.slug} · {product.status}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Subir"
                  disabled={index === 0 || pendingProducts}
                  onClick={() => onMove(index, -1)}
                  className="rounded border border-[color:var(--color-border)] px-2 text-xs disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Descer"
                  disabled={index === assigned.length - 1 || pendingProducts}
                  onClick={() => onMove(index, 1)}
                  className="rounded border border-[color:var(--color-border)] px-2 text-xs disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={pendingProducts}
                  onClick={() => onRemove(product.id)}
                  className="rounded border border-red-500 px-2 py-1 text-xs text-red-500 disabled:opacity-50"
                >
                  Remover
                </button>
              </li>
            ))}
          </ol>
        )}
        {unassigned.length > 0 ? (
          <label className="mt-3 flex items-center gap-2">
            <span className="text-sm text-[color:var(--color-muted)]">Adicionar produto:</span>
            <select
              defaultValue=""
              disabled={pendingProducts}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                onAdd(value);
                event.target.value = '';
              }}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Selecione…
              </option>
              {unassigned.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title} ({product.status})
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>
    </div>
  );
};
