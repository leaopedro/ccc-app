'use client';

import type { AdminProductType } from '@jdm/shared/admin';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createProductTypeAction,
  deleteProductTypeAction,
  updateProductTypeAction,
  type ProductTypeFormState,
} from '~/lib/product-type-actions';

const initial: ProductTypeFormState = { error: null };

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  );
};

const TipoRow = ({ tipo }: { tipo: AdminProductType }) => {
  const [updateState, updateAction] = useActionState(
    updateProductTypeAction.bind(null, tipo.id),
    initial,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteProductTypeAction.bind(null, tipo.id),
    initial,
  );
  return (
    <tr className="border-b border-[color:var(--color-border)]">
      <td className="py-2">
        <form action={updateAction} className="flex items-center gap-2">
          <input
            name="name"
            defaultValue={tipo.name}
            required
            maxLength={80}
            className="w-48 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <input
            name="sortOrder"
            type="number"
            defaultValue={tipo.sortOrder}
            className="w-20 rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
          <Submit label="Salvar" />
          {updateState.error ? (
            <span className="text-xs text-red-400">{updateState.error}</span>
          ) : null}
        </form>
      </td>
      <td className="text-sm">{tipo.productCount}</td>
      <td>
        <form action={deleteAction} className="flex items-center gap-2">
          <button
            type="submit"
            disabled={tipo.productCount > 0}
            title={tipo.productCount > 0 ? 'Existem produtos vinculados a este tipo.' : 'Excluir'}
            className="text-sm text-red-400 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Excluir
          </button>
          {deleteState.error ? (
            <span className="text-xs text-red-400">{deleteState.error}</span>
          ) : null}
        </form>
      </td>
    </tr>
  );
};

export const TiposList = ({ tipos }: { tipos: AdminProductType[] }) => {
  const [state, action] = useActionState(createProductTypeAction, initial);
  return (
    <section className="flex flex-col gap-3">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Nome</th>
            <th>Produtos</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tipos.map((t) => (
            <TipoRow key={t.id} tipo={t} />
          ))}
          {tipos.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-6 text-center text-[color:var(--color-muted)]">
                Nenhum tipo cadastrado ainda.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <form
        action={action}
        className="flex items-end gap-2 border-t border-[color:var(--color-border)] pt-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[color:var(--color-muted)]">Nome</span>
          <input
            name="name"
            required
            maxLength={80}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
            placeholder="Ex.: Camisetas"
          />
        </label>
        <Submit label="Adicionar" />
        {state.error ? <span className="text-xs text-red-400">{state.error}</span> : null}
      </form>
    </section>
  );
};
