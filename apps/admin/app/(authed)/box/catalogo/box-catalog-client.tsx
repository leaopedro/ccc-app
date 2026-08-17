'use client';

import type { AdminBoxCatalogList } from '@ccc/shared/admin-box';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { BoxImageUploader } from '~/components/box-image-uploader';
import {
  createBoxCatalogItemAction,
  deleteBoxCatalogItemAction,
  updateBoxCatalogItemAction,
  type BoxFormState,
} from '~/lib/box-admin-actions';

const initial: BoxFormState = { error: null };
const inputCls =
  'rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm';
const labelCls = 'flex flex-col gap-1 text-xs text-[color:var(--color-muted)]';

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
    >
      {pending ? '...' : label}
    </button>
  );
};

const Err = ({ state }: { state: BoxFormState }) =>
  state.error ? <span className="text-xs text-red-400">{state.error}</span> : null;

const CreateForm = () => {
  const [state, action] = useActionState(createBoxCatalogItemAction, initial);
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded border border-[color:var(--color-border)] p-4"
    >
      <label className={labelCls}>
        Slug
        <input name="slug" required maxLength={140} className={inputCls} />
      </label>
      <label className={labelCls}>
        Titulo
        <input name="title" required maxLength={140} className={inputCls} />
      </label>
      <label className={labelCls}>
        Categoria
        <input name="category" required maxLength={60} className={inputCls} />
      </label>
      <label className={labelCls}>
        Preco (centavos)
        <input name="priceCents" type="number" min={0} required className={`${inputCls} w-28`} />
      </label>
      <label className={labelCls}>
        Estoque/ciclo
        <input name="stockPerCycle" type="number" min={1} className={`${inputCls} w-24`} />
      </label>
      <label className={labelCls}>
        Max/ciclo
        <input name="maxPerCycle" type="number" min={1} className={`${inputCls} w-24`} />
      </label>
      <label className={labelCls}>
        Descricao
        <textarea name="description" required className={inputCls} />
      </label>
      <BoxImageUploader kind="box_item" name="imageObjectKey" initialKey={null} initialUrl={null} />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" name="active" defaultChecked /> Ativo
      </label>
      <label className={labelCls}>
        Ordem
        <input
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={0}
          className={`${inputCls} w-20`}
        />
      </label>
      <label className={labelCls}>
        Nível mínimo
        <select name="minTier" defaultValue="" className={inputCls}>
          <option value="">Todos</option>
          <option value="bronze">Bronze</option>
          <option value="silver">Silver</option>
          <option value="gold">Gold</option>
        </select>
      </label>
      <label className={labelCls}>
        Para níveis abaixo
        <select name="restrictedDisplay" defaultValue="locked" className={inputCls}>
          <option value="locked">Bloquear</option>
          <option value="hidden">Ocultar</option>
        </select>
      </label>
      <Submit label="Criar item" />
      <Err state={state} />
    </form>
  );
};

const ItemRow = ({ item }: { item: AdminBoxCatalogList['items'][number] }) => {
  const [state, action] = useActionState(updateBoxCatalogItemAction.bind(null, item.id), initial);
  const [delState, delAction] = useActionState(
    deleteBoxCatalogItemAction.bind(null, item.id),
    initial,
  );
  return (
    <article className="flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <span className="text-xs text-[color:var(--color-muted)]">{item.slug}</span>
        {item.minTier ? (
          <span className="rounded bg-[color:var(--color-accent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase">
            {item.minTier}+
          </span>
        ) : null}
        <label className={labelCls}>
          Titulo
          <input name="title" defaultValue={item.title} maxLength={140} className={inputCls} />
        </label>
        <label className={labelCls}>
          Categoria
          <input name="category" defaultValue={item.category} maxLength={60} className={inputCls} />
        </label>
        <label className={labelCls}>
          Preco
          <input
            name="priceCents"
            type="number"
            min={0}
            defaultValue={item.priceCents}
            className={`${inputCls} w-28`}
          />
        </label>
        <label className={labelCls}>
          Estoque/ciclo
          <input
            name="stockPerCycle"
            type="number"
            min={1}
            defaultValue={item.stockPerCycle ?? ''}
            className={`${inputCls} w-24`}
          />
        </label>
        <label className={labelCls}>
          Max/ciclo
          <input
            name="maxPerCycle"
            type="number"
            min={1}
            defaultValue={item.maxPerCycle ?? ''}
            className={`${inputCls} w-24`}
          />
        </label>
        <label className={labelCls}>
          Descricao
          <textarea name="description" defaultValue={item.description} className={inputCls} />
        </label>
        <BoxImageUploader
          kind="box_item"
          name="imageObjectKey"
          initialKey={item.imageObjectKey}
          initialUrl={item.imageUrl}
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="active" defaultChecked={item.active} /> Ativo
        </label>
        <label className={labelCls}>
          Ordem
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={item.sortOrder}
            className={`${inputCls} w-20`}
          />
        </label>
        <label className={labelCls}>
          Nível mínimo
          <select name="minTier" defaultValue={item.minTier ?? ''} className={inputCls}>
            <option value="">Todos</option>
            <option value="bronze">Bronze</option>
            <option value="silver">Silver</option>
            <option value="gold">Gold</option>
          </select>
        </label>
        <label className={labelCls}>
          Para níveis abaixo
          <select
            name="restrictedDisplay"
            defaultValue={item.restrictedDisplay}
            className={inputCls}
          >
            <option value="locked">Bloquear</option>
            <option value="hidden">Ocultar</option>
          </select>
        </label>
        <Submit label="Salvar" />
        <Err state={state} />
      </form>
      <form action={delAction}>
        <button type="submit" className="text-xs text-red-400 underline">
          Desativar
        </button>
        <Err state={delState} />
      </form>
    </article>
  );
};

export const BoxCatalogClient = ({ catalog }: { catalog: AdminBoxCatalogList }) => (
  <div className="flex flex-col gap-6">
    <CreateForm />
    <div className="flex flex-col gap-4">
      {catalog.items.map((item) => (
        <ItemRow key={item.id} item={item} />
      ))}
    </div>
  </div>
);
