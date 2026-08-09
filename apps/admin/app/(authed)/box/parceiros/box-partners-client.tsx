'use client';

import type { AdminPartnerList } from '@ccc/shared/admin-box';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { BoxImageUploader } from '~/components/box-image-uploader';
import {
  createPartnerAction,
  createPartnerModuleAction,
  deletePartnerAction,
  deletePartnerModuleAction,
  updatePartnerAction,
  updatePartnerModuleAction,
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

const ModuleRow = ({ mod }: { mod: AdminPartnerList['partners'][number]['modules'][number] }) => {
  const [state, action] = useActionState(updatePartnerModuleAction.bind(null, mod.id), initial);
  const [delState, delAction] = useActionState(
    deletePartnerModuleAction.bind(null, mod.id),
    initial,
  );
  return (
    <div className="flex flex-col gap-2 rounded border border-[color:var(--color-border)] p-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className={labelCls}>
          Nome
          <input name="name" defaultValue={mod.name} maxLength={80} className={inputCls} />
        </label>
        <label className={labelCls}>
          Preco
          <input
            name="priceCents"
            type="number"
            min={0}
            defaultValue={mod.priceCents}
            className={`${inputCls} w-28`}
          />
        </label>
        <label className={labelCls}>
          Descricao
          <input
            name="description"
            defaultValue={mod.description ?? ''}
            maxLength={240}
            className={inputCls}
          />
        </label>
        <BoxImageUploader
          kind="partner_module"
          name="imageObjectKey"
          initialKey={mod.imageObjectKey}
          initialUrl={null}
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="active" defaultChecked={mod.active} /> Ativo
        </label>
        <label className={labelCls}>
          Ordem
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={mod.sortOrder}
            className={`${inputCls} w-20`}
          />
        </label>
        <Submit label="Salvar modulo" />
        <Err state={state} />
      </form>
      <form action={delAction}>
        <button type="submit" className="text-xs text-red-400 underline">
          Desativar modulo
        </button>
        <Err state={delState} />
      </form>
    </div>
  );
};

const AddModuleForm = ({ partnerId }: { partnerId: string }) => {
  const [state, action] = useActionState(createPartnerModuleAction.bind(null, partnerId), initial);
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 border-t border-[color:var(--color-border)] pt-3"
    >
      <label className={labelCls}>
        Novo modulo
        <input name="name" required maxLength={80} className={inputCls} />
      </label>
      <label className={labelCls}>
        Preco
        <input name="priceCents" type="number" min={0} required className={`${inputCls} w-28`} />
      </label>
      <label className={labelCls}>
        Descricao
        <input name="description" maxLength={240} className={inputCls} />
      </label>
      <BoxImageUploader
        kind="partner_module"
        name="imageObjectKey"
        initialKey={null}
        initialUrl={null}
      />
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
      <Submit label="Adicionar modulo" />
      <Err state={state} />
    </form>
  );
};

const PartnerCard = ({ partner }: { partner: AdminPartnerList['partners'][number] }) => {
  const [state, action] = useActionState(updatePartnerAction.bind(null, partner.id), initial);
  const [delState, delAction] = useActionState(deletePartnerAction.bind(null, partner.id), initial);
  return (
    <article className="flex flex-col gap-4 rounded border border-[color:var(--color-border)] p-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <span className="text-xs text-[color:var(--color-muted)]">{partner.slug}</span>
        <label className={labelCls}>
          Nome
          <input name="name" defaultValue={partner.name} maxLength={80} className={inputCls} />
        </label>
        <label className={labelCls}>
          Descricao
          <input
            name="description"
            defaultValue={partner.description ?? ''}
            maxLength={240}
            className={inputCls}
          />
        </label>
        <BoxImageUploader
          kind="partner_logo"
          name="logoObjectKey"
          initialKey={partner.logoObjectKey}
          initialUrl={null}
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="active" defaultChecked={partner.active} /> Ativo
        </label>
        <label className={labelCls}>
          Ordem
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={partner.sortOrder}
            className={`${inputCls} w-20`}
          />
        </label>
        <Submit label="Salvar parceiro" />
        <Err state={state} />
      </form>
      <div className="flex flex-col gap-2">
        {partner.modules.map((mod) => (
          <ModuleRow key={mod.id} mod={mod} />
        ))}
        <AddModuleForm partnerId={partner.id} />
      </div>
      <form action={delAction}>
        <button type="submit" className="text-xs text-red-400 underline">
          Desativar parceiro
        </button>
        <Err state={delState} />
      </form>
    </article>
  );
};

const CreatePartnerForm = () => {
  const [state, action] = useActionState(createPartnerAction, initial);
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded border border-[color:var(--color-border)] p-4"
    >
      <label className={labelCls}>
        Slug
        <input name="slug" required maxLength={60} className={inputCls} />
      </label>
      <label className={labelCls}>
        Nome
        <input name="name" required maxLength={80} className={inputCls} />
      </label>
      <label className={labelCls}>
        Descricao
        <input name="description" maxLength={240} className={inputCls} />
      </label>
      <BoxImageUploader
        kind="partner_logo"
        name="logoObjectKey"
        initialKey={null}
        initialUrl={null}
      />
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
      <Submit label="Criar parceiro" />
      <Err state={state} />
    </form>
  );
};

export const BoxPartnersClient = ({ data }: { data: AdminPartnerList }) => (
  <div className="flex flex-col gap-6">
    <CreatePartnerForm />
    <div className="flex flex-col gap-4">
      {data.partners.map((partner) => (
        <PartnerCard key={partner.id} partner={partner} />
      ))}
    </div>
  </div>
);
