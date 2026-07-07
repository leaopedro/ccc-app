'use client';

import type { AdminStoreVariant } from '@jdm/shared/admin';
import React from 'react';
import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createVariantAction,
  deleteVariantAction,
  updateVariantAction,
  type StoreFormState,
} from '~/lib/store-actions';

const initial: StoreFormState = { error: null };

const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fieldCls =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm';
const labelCls = 'flex flex-col gap-1 text-xs text-[color:var(--color-muted)]';

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  );
};

const Field = ({
  label,
  className,
  ...props
}: { label: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className={labelCls}>
    <span>{label}</span>
    <input {...props} className={className ? `${fieldCls} ${className}` : fieldCls} />
  </label>
);

const VariantRow = ({ productId, variant }: { productId: string; variant: AdminStoreVariant }) => {
  const update = updateVariantAction.bind(null, productId, variant.id);
  const [state, action] = useActionState(update, initial);
  return (
    <tr className="border-b border-[color:var(--color-border)]">
      <td className="py-2">
        <form action={action} className="flex flex-wrap items-end gap-3">
          <Field label="Variante" name="name" defaultValue={variant.name} className="w-40" />
          <Field
            label="SKU"
            name="sku"
            defaultValue={variant.sku ?? ''}
            placeholder="SKU"
            className="w-28"
          />
          <Field
            label="Preco (centavos)"
            name="priceCents"
            type="number"
            min={0}
            defaultValue={variant.priceCents}
            className="w-28"
          />
          <span className="flex flex-col text-xs text-[color:var(--color-muted)]">
            <span>Taxa: {variant.devFeePercent}%</span>
            <span>Preço final: {formatBRL(variant.displayPriceCents)}</span>
          </span>
          <Field
            label="Estoque total"
            name="quantityTotal"
            type="number"
            min={variant.quantitySold}
            defaultValue={variant.quantityTotal}
            className="w-24"
          />
          <select
            name="active"
            defaultValue={variant.active ? 'true' : 'false'}
            className={fieldCls}
          >
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </select>
          <span className="self-end pb-2 text-xs text-[color:var(--color-muted)]">
            vendidos: {variant.quantitySold}
          </span>
          <Submit label="Salvar" />
          {state.error ? <span className="text-sm text-red-400">{state.error}</span> : null}
        </form>
      </td>
      <td className="py-2 text-right">
        <form
          action={() => {
            void deleteVariantAction(productId, variant.id);
          }}
        >
          <button
            type="submit"
            className="rounded border border-[color:var(--color-border)] px-2 py-1 text-xs"
          >
            {variant.quantitySold > 0 ? 'Desabilitar' : 'Remover'}
          </button>
        </form>
      </td>
    </tr>
  );
};

const SIZE_PRESET = ['P', 'M', 'G', 'GG'] as const;

export const createSizePreset = async (
  productId: string,
  productPriceCents: number,
  createFn: (productId: string, prev: StoreFormState, fd: FormData) => Promise<StoreFormState>,
): Promise<string | null> => {
  for (const size of SIZE_PRESET) {
    const fd = new FormData();
    fd.append('name', size);
    fd.append('priceCents', String(productPriceCents));
    fd.append('quantityTotal', '0');
    fd.append('attributes', JSON.stringify({ size }));
    const result = await createFn(productId, initial, fd);
    if (result.error) return result.error;
  }
  return null;
};

const SizePresetButton = ({
  productId,
  productPriceCents,
}: {
  productId: string;
  productPriceCents: number;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const err = await createSizePreset(productId, productPriceCents, createVariantAction);
      setError(err);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded border border-[color:var(--color-border)] px-3 py-1 text-sm disabled:opacity-50"
      >
        {pending ? '…' : 'Criar tamanhos (P-M-G-GG)'}
      </button>
      {error ? <span className="text-sm text-red-400">{error}</span> : null}
    </>
  );
};

const NewVariantForm = ({
  productId,
  productPriceCents,
}: {
  productId: string;
  productPriceCents: number;
}) => {
  const create = createVariantAction.bind(null, productId);
  const [state, action] = useActionState(create, initial);
  const v = state.values ?? {};
  return (
    <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
      <Field
        label="Variante"
        name="name"
        placeholder="Variante (ex: Preto — M)"
        defaultValue={v.name ?? ''}
        required
        className="w-40"
      />
      <Field
        label="SKU"
        name="sku"
        placeholder="SKU (opcional)"
        defaultValue={v.sku ?? ''}
        className="w-28"
      />
      <Field
        label="Preco (centavos)"
        name="priceCents"
        type="number"
        min={0}
        placeholder="Preço (centavos)"
        defaultValue={v.priceCents ?? productPriceCents}
        required
        className="w-32"
      />
      <Field
        label="Estoque"
        name="quantityTotal"
        type="number"
        min={0}
        placeholder="Estoque"
        defaultValue={v.quantityTotal ?? ''}
        required
        className="w-24"
      />
      <Submit label="Adicionar variante" />
      {state.error ? <span className="text-sm text-red-400">{state.error}</span> : null}
    </form>
  );
};

export const VariantList = ({
  productId,
  productPriceCents,
  variants,
}: {
  productId: string;
  productPriceCents: number;
  variants: AdminStoreVariant[];
}) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center gap-3">
      <h2 className="text-lg font-semibold">Variantes</h2>
      <SizePresetButton productId={productId} productPriceCents={productPriceCents} />
    </div>
    {variants.length > 0 ? (
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Variante</th>
            <th className="py-2 text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((variant) => (
            <VariantRow key={variant.id} productId={productId} variant={variant} />
          ))}
        </tbody>
      </table>
    ) : (
      <p className="text-sm text-[color:var(--color-muted)]">Nenhuma variante ainda.</p>
    )}
    <NewVariantForm productId={productId} productPriceCents={productPriceCents} />
  </div>
);
