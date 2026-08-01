'use client';

import type {
  AdminPremiumAddonModule,
  AdminPremiumCatalogResponse,
  AdminPremiumPlan,
} from '@ccc/shared/admin';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createModuleAction,
  createPlanAction,
  deleteModuleAction,
  deletePlanAction,
  replaceBenefitsAction,
  updateModuleAction,
  updatePlanAction,
  upsertPriceAction,
  type PremiumFormState,
} from '~/lib/premium-catalog-actions';

const initial: PremiumFormState = { error: null };

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
      {pending ? '…' : label}
    </button>
  );
};

const Err = ({ state }: { state: PremiumFormState }) =>
  state.error ? <span className="text-xs text-red-400">{state.error}</span> : null;

// ── Benefits editor ────────────────────────────────────────────────

type BenefitRow = { label: string; sortOrder: number };

const BenefitsEditor = ({ plan }: { plan: AdminPremiumPlan }) => {
  const [state, action] = useActionState(replaceBenefitsAction.bind(null, plan.id), initial);
  const [rows, setRows] = useState<BenefitRow[]>(
    plan.benefits.map((b) => ({ label: b.label, sortOrder: b.sortOrder })),
  );

  const update = (i: number, patch: Partial<BenefitRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setRows((prev) => [...prev, { label: '', sortOrder: prev.length }]);

  return (
    <form action={action} className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-[color:var(--color-muted)]">Benefícios</span>
      <input type="hidden" name="benefits" value={JSON.stringify(rows)} />
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            aria-label="Benefício"
            value={r.label}
            onChange={(e) => update(i, { label: e.target.value })}
            maxLength={140}
            className={`${inputCls} flex-1`}
            placeholder="Ex.: Acesso ao lounge"
          />
          <input
            aria-label="Ordem"
            type="number"
            value={r.sortOrder}
            onChange={(e) => update(i, { sortOrder: Number(e.target.value) })}
            className={`${inputCls} w-16`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-sm text-red-400 hover:underline"
          >
            Remover
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button type="button" onClick={add} className="text-sm underline">
          Adicionar benefício
        </button>
        <Submit label="Salvar benefícios" />
        <Err state={state} />
      </div>
    </form>
  );
};

// ── Plan card ──────────────────────────────────────────────────────

const PlanCard = ({ plan }: { plan: AdminPremiumPlan }) => {
  const [detailState, detailAction] = useActionState(updatePlanAction.bind(null, plan.id), initial);
  const [priceState, priceAction] = useActionState(upsertPriceAction.bind(null, plan.id), initial);
  const [deleteState, deleteAction] = useActionState(deletePlanAction.bind(null, plan.id), initial);
  const monthly = plan.prices.find((p) => p.cadence === 'monthly');

  return (
    <article className="flex flex-col gap-4 rounded border border-[color:var(--color-border)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {plan.name}{' '}
          <span className="text-xs text-[color:var(--color-muted)]">
            ({plan.tier} · {plan.slug})
          </span>
        </h3>
        <span
          className={`text-xs ${plan.active ? 'text-green-400' : 'text-[color:var(--color-muted)]'}`}
        >
          {plan.active ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      <form action={detailAction} className="flex flex-wrap items-end gap-3">
        <label className={labelCls}>
          Nome
          <input
            name="name"
            defaultValue={plan.name}
            required
            maxLength={80}
            className={inputCls}
          />
        </label>
        <label className={`${labelCls} flex-1`}>
          Descrição
          <input
            name="description"
            defaultValue={plan.description ?? ''}
            maxLength={500}
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          Ordem
          <input
            name="sortOrder"
            type="number"
            defaultValue={plan.sortOrder}
            className={`${inputCls} w-20`}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-[color:var(--color-muted)]">
          <input name="active" type="checkbox" defaultChecked={plan.active} />
          Ativo
        </label>
        <Submit label="Salvar" />
        <Err state={detailState} />
      </form>

      <form action={priceAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="cadence" value="monthly" />
        <label className={labelCls}>
          Preço mensal (centavos)
          <input
            name="baseAmountCents"
            type="number"
            defaultValue={monthly?.baseAmountCents ?? 0}
            min={0}
            className={`${inputCls} w-32`}
          />
        </label>
        <label className={labelCls}>
          Moeda
          <input
            name="currency"
            defaultValue={monthly?.currency ?? 'BRL'}
            maxLength={3}
            className={`${inputCls} w-16`}
          />
        </label>
        <label className={labelCls}>
          stripePriceId
          <input
            name="stripePriceId"
            defaultValue={monthly?.stripePriceId ?? ''}
            maxLength={120}
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          rcProductId
          <input
            name="rcProductId"
            defaultValue={monthly?.rcProductId ?? ''}
            maxLength={120}
            className={inputCls}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-[color:var(--color-muted)]">
          <input name="active" type="checkbox" defaultChecked={monthly?.active ?? true} />
          Preço ativo
        </label>
        <Submit label="Salvar preço" />
        <Err state={priceState} />
      </form>

      <BenefitsEditor plan={plan} />

      <form
        action={deleteAction}
        className="flex items-center gap-2 border-t border-[color:var(--color-border)] pt-3"
      >
        <button
          type="submit"
          disabled={!plan.active}
          className="text-sm text-red-400 hover:underline disabled:opacity-50"
        >
          Desativar plano
        </button>
        <Err state={deleteState} />
      </form>
    </article>
  );
};

// ── New plan form ──────────────────────────────────────────────────

const NewPlanForm = () => {
  const [state, action] = useActionState(createPlanAction, initial);
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded border border-dashed border-[color:var(--color-border)] p-4"
    >
      <label className={labelCls}>
        Tier
        <select name="tier" className={inputCls} defaultValue="bronze">
          <option value="bronze">bronze</option>
          <option value="silver">silver</option>
          <option value="gold">gold</option>
        </select>
      </label>
      <label className={labelCls}>
        Slug
        <input name="slug" required className={inputCls} placeholder="ex.: gold" />
      </label>
      <label className={labelCls}>
        Nome
        <input name="name" required maxLength={80} className={inputCls} />
      </label>
      <label className={labelCls}>
        Ordem
        <input name="sortOrder" type="number" defaultValue={0} className={`${inputCls} w-20`} />
      </label>
      <label className="flex items-center gap-2 text-xs text-[color:var(--color-muted)]">
        <input name="active" type="checkbox" defaultChecked />
        Ativo
      </label>
      <Submit label="Adicionar plano" />
      <Err state={state} />
    </form>
  );
};

// ── Module card ────────────────────────────────────────────────────

const ModuleFields = ({ mod }: { mod?: AdminPremiumAddonModule }) => (
  <>
    <label className={labelCls}>
      Nome
      <input
        name="name"
        defaultValue={mod?.name ?? ''}
        required
        maxLength={80}
        className={inputCls}
      />
    </label>
    <label className={`${labelCls} flex-1`}>
      Descrição
      <input
        name="description"
        defaultValue={mod?.description ?? ''}
        required
        maxLength={240}
        className={inputCls}
      />
    </label>
    <label className={labelCls}>
      Preço mensal (centavos)
      <input
        name="monthlyDeltaCents"
        type="number"
        defaultValue={mod?.monthlyDeltaCents ?? 0}
        min={0}
        className={`${inputCls} w-32`}
      />
    </label>
    <label className={labelCls}>
      Cota por ciclo
      <input
        name="quotaPerCycle"
        type="number"
        defaultValue={mod?.quotaPerCycle ?? 0}
        min={0}
        className={`${inputCls} w-24`}
      />
    </label>
    <label className={labelCls}>
      Unidade
      <select name="quotaUnit" defaultValue={mod?.quotaUnit ?? 'access'} className={inputCls}>
        <option value="access">access</option>
        <option value="hours">hours</option>
      </select>
    </label>
    <label className={labelCls}>
      Moeda
      <input
        name="currency"
        defaultValue={mod?.currency ?? 'BRL'}
        maxLength={3}
        className={`${inputCls} w-16`}
      />
    </label>
    <label className={labelCls}>
      Ordem
      <input
        name="sortOrder"
        type="number"
        defaultValue={mod?.sortOrder ?? 0}
        className={`${inputCls} w-20`}
      />
    </label>
    <label className={labelCls}>
      stripePriceId
      <input
        name="stripePriceId"
        defaultValue={mod?.stripePriceId ?? ''}
        maxLength={120}
        className={inputCls}
      />
    </label>
    <label className={labelCls}>
      rcProductId
      <input
        name="rcProductId"
        defaultValue={mod?.rcProductId ?? ''}
        maxLength={120}
        className={inputCls}
      />
    </label>
    <label className="flex items-center gap-2 text-xs text-[color:var(--color-muted)]">
      <input name="active" type="checkbox" defaultChecked={mod?.active ?? true} />
      Ativo
    </label>
  </>
);

const ModuleCard = ({ mod }: { mod: AdminPremiumAddonModule }) => {
  const [state, action] = useActionState(updateModuleAction.bind(null, mod.id), initial);
  const [deleteState, deleteAction] = useActionState(
    deleteModuleAction.bind(null, mod.id),
    initial,
  );
  return (
    <article className="flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-4">
      <h3 className="text-base font-semibold">
        {mod.name} <span className="text-xs text-[color:var(--color-muted)]">({mod.key})</span>
      </h3>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <ModuleFields mod={mod} />
        <Submit label="Salvar" />
        <Err state={state} />
      </form>
      <form
        action={deleteAction}
        className="flex items-center gap-2 border-t border-[color:var(--color-border)] pt-3"
      >
        <button
          type="submit"
          disabled={!mod.active}
          className="text-sm text-red-400 hover:underline disabled:opacity-50"
        >
          Desativar módulo
        </button>
        <Err state={deleteState} />
      </form>
    </article>
  );
};

const NewModuleForm = () => {
  const [state, action] = useActionState(createModuleAction, initial);
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded border border-dashed border-[color:var(--color-border)] p-4"
    >
      <label className={labelCls}>
        Chave
        <input name="key" required maxLength={40} className={inputCls} placeholder="ex.: wash" />
      </label>
      <ModuleFields />
      <Submit label="Adicionar módulo" />
      <Err state={state} />
    </form>
  );
};

// ── Root ───────────────────────────────────────────────────────────

export const PremiumCatalogClient = ({ catalog }: { catalog: AdminPremiumCatalogResponse }) => (
  <div className="flex flex-col gap-8">
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">Planos</h2>
      {catalog.plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
      {catalog.plans.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">Nenhum plano cadastrado.</p>
      ) : null}
      <NewPlanForm />
    </section>

    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">Módulos</h2>
      {catalog.modules.map((mod) => (
        <ModuleCard key={mod.id} mod={mod} />
      ))}
      {catalog.modules.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">Nenhum módulo cadastrado.</p>
      ) : null}
      <NewModuleForm />
    </section>
  </div>
);
