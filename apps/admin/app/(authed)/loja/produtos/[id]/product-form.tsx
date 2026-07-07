'use client';

import type { AdminProductType, AdminStoreProductDetail } from '@jdm/shared/admin';
import { GARAGE_SPOT_PRODUCT_SLUG } from '@jdm/shared/garage';
import React, { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  archiveProductAction,
  updateProductAction,
  type StoreFormState,
} from '~/lib/store-actions';

const initial: StoreFormState = { error: null };

// Singleton slugs whose lifecycle is owned by seeds/webhooks; admins must not
// archive or reactivate them from the UI. Server-side guards enforce the same
// invariant (see assertVirtualSingletonProtected in @jdm/db).
const SINGLETON_PRODUCT_SLUGS = new Set<string>([GARAGE_SPOT_PRODUCT_SLUG]);

const Submit = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
    >
      {pending ? 'Salvando…' : 'Salvar alterações'}
    </button>
  );
};

const Field = ({
  label,
  name,
  type = 'text',
  defaultValue,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'defaultValue'>) => (
  <label className="flex flex-col gap-1">
    <span className="text-sm text-[color:var(--color-muted)]">{label}</span>
    <input
      name={name}
      type={type}
      defaultValue={defaultValue}
      {...rest}
      className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
    />
  </label>
);

export const ProductForm = ({
  product,
  productTypes,
}: {
  product: AdminStoreProductDetail;
  productTypes: AdminProductType[];
}) => {
  const update = updateProductAction.bind(null, product.id);
  const [state, action] = useActionState(update, initial);
  const v = state.values ?? {};
  const [allowPickup, setAllowPickup] = useState(product.allowPickup);
  const [allowShip, setAllowShip] = useState(product.allowShip);
  useEffect(() => {
    setAllowPickup(product.allowPickup);
  }, [product.allowPickup]);
  useEffect(() => {
    setAllowShip(product.allowShip);
  }, [product.allowShip]);
  const currentTypeMissing = !productTypes.some((t) => t.id === product.productTypeId);
  const hasPhotos = product.photos.length > 0;
  const isVirtual = product.virtual === true;
  const isSingleton = SINGLETON_PRODUCT_SLUGS.has(product.slug);
  // Client-side: don't show the "needs photo" warning for virtual products.
  // Server-side carve-out for the activate-without-photo path ships in
  // TASK-C (`apps/api/src/routes/admin/store/products.ts`). Until that
  // lands, activating a fresh virtual product will still 400.
  const photoGateActive = !isVirtual && !hasPhotos && product.status !== 'active';

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Título" name="title" required defaultValue={v.title ?? product.title} />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Tipo de produto</span>
          {isVirtual ? (
            <>
              <input
                type="text"
                value={product.productTypeName}
                readOnly
                aria-readonly="true"
                className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2 opacity-70"
              />
              <span className="text-xs text-[color:var(--color-muted)]">
                Tipo gerenciado pelo sistema.
              </span>
            </>
          ) : (
            <select
              name="productTypeId"
              required
              defaultValue={v.productTypeId ?? product.productTypeId}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
            >
              {currentTypeMissing ? (
                <option value={product.productTypeId}>(tipo removido — selecione outro)</option>
              ) : null}
              {productTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="sm:col-span-2 flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Descrição</span>
          <textarea
            name="description"
            required
            rows={5}
            defaultValue={v.description ?? product.description}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <Field
          label="Preço base (centavos)"
          name="basePriceCents"
          type="number"
          min={0}
          required
          defaultValue={v.basePriceCents ?? String(product.basePriceCents)}
        />
        {!isVirtual ? (
          <>
            <fieldset className="sm:col-span-2 flex flex-col gap-2">
              <legend className="mb-1 text-sm text-[color:var(--color-muted)]">
                Modo de entrega
              </legend>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowPickup}
                  onChange={(e) => setAllowPickup(e.target.checked)}
                />
                <span>Retirada no evento</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowShip}
                  onChange={(e) => setAllowShip(e.target.checked)}
                />
                <span>Envio</span>
              </label>
            </fieldset>
            <input type="hidden" name="allowPickup" value={allowPickup ? 'true' : 'false'} />
            <input type="hidden" name="allowShip" value={allowShip ? 'true' : 'false'} />
            {allowShip ? (
              <Field
                label="Frete fixo (centavos)"
                name="shippingFeeCents"
                type="number"
                min={0}
                defaultValue={
                  v.shippingFeeCents ??
                  (product.shippingFeeCents == null ? '' : String(product.shippingFeeCents))
                }
              />
            ) : (
              <input type="hidden" name="shippingFeeCents" value="" />
            )}
          </>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Status</span>
          {isSingleton ? (
            <>
              <input
                type="text"
                value={product.status}
                readOnly
                aria-readonly="true"
                className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2 opacity-70"
              />
              <span className="text-xs text-[color:var(--color-muted)]">
                Status gerenciado pelo sistema.
              </span>
            </>
          ) : (
            <>
              <select
                name="status"
                defaultValue={v.status ?? product.status}
                className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
              >
                <option value="draft">Rascunho</option>
                <option value="active" disabled={photoGateActive}>
                  Ativo
                </option>
                <option value="archived">Arquivado</option>
              </select>
              {photoGateActive ? (
                <span className="text-xs text-[color:var(--color-muted)]">
                  Adicione pelo menos uma foto para ativar o produto.
                </span>
              ) : null}
            </>
          )}
        </label>
        {isVirtual ? (
          <fieldset className="sm:col-span-2 flex flex-col gap-2 rounded border border-dashed border-[color:var(--color-border)] px-3 py-2">
            <legend className="text-xs text-[color:var(--color-muted)]">
              Atributos do sistema
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked readOnly aria-readonly="true" />
              <span>Produto virtual</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={product.visibleInStore}
                readOnly
                aria-readonly="true"
              />
              <span>Visível na loja</span>
            </label>
            <p className="text-xs text-[color:var(--color-muted)]">
              Esses campos são definidos pelo sistema e não podem ser editados.
            </p>
          </fieldset>
        ) : null}
        {state.error ? <p className="sm:col-span-2 text-sm text-red-400">{state.error}</p> : null}
        <div className="sm:col-span-2 flex gap-3">
          <Submit />
          {isSingleton ? null : product.status !== 'archived' ? (
            <button
              type="submit"
              formAction={() => {
                void archiveProductAction(product.id);
              }}
              className="rounded border border-[color:var(--color-border)] px-3 py-2 text-sm"
            >
              Arquivar
            </button>
          ) : (
            <button
              type="submit"
              formAction={async (fd: FormData) => {
                fd.set('status', 'active');
                await updateProductAction(product.id, initial, fd);
              }}
              disabled={!isVirtual && !hasPhotos}
              title={
                !isVirtual && !hasPhotos
                  ? 'Adicione pelo menos uma foto antes de ativar.'
                  : undefined
              }
              className="rounded border border-[color:var(--color-border)] px-3 py-2 text-sm disabled:opacity-50"
            >
              Reativar
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
