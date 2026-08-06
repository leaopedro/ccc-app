'use client';

import type {
  AdminPremiumAddonModule,
  AdminPremiumCatalogResponse,
  AdminPremiumPlan,
} from '@ccc/shared/admin';
import { useActionState, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { fmtBRL } from '~/lib/format';
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
const legendCls = 'text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]';
const checkboxLabelCls = 'flex items-center gap-2 pb-1 text-xs text-[color:var(--color-muted)]';
const dangerBtnCls =
  'rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:hover:bg-transparent';

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-sm font-semibold text-black disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  );
};

const Err = ({ state }: { state: PremiumFormState }) =>
  state.error ? <span className="text-xs text-red-400">{state.error}</span> : null;

// A labelled group of fields inside a form: a small caps legend above a
// flex-wrapped row. Purely a spacing/grouping helper, no form semantics.
const FieldGroup = ({ legend, children }: { legend: string; children: ReactNode }) => (
  <div className="flex flex-col gap-2">
    <span className={legendCls}>{legend}</span>
    <div className="flex flex-wrap items-end gap-3">{children}</div>
  </div>
);

const StatusPill = ({ active }: { active: boolean }) => (
  <span
    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
      active
        ? 'border-green-400/30 bg-green-400/10 text-green-400'
        : 'border-[color:var(--color-border)] text-[color:var(--color-muted)]'
    }`}
  >
    {active ? 'Ativo' : 'Inativo'}
  </span>
);

// A centavos input paired with a live R$ preview so operators can see what
// they're typing without changing the submitted unit (still raw centavos).
const MoneyCentsField = ({
  label,
  name,
  cents,
  onChangeCents,
  min,
  widthCls = 'w-32',
}: {
  label: string;
  name: string;
  cents: number;
  onChangeCents: (cents: number) => void;
  min?: number;
  widthCls?: string;
}) => (
  <label className={labelCls}>
    {label}
    <input
      name={name}
      type="number"
      defaultValue={cents}
      min={min}
      placeholder="Em centavos"
      onChange={(e) => onChangeCents(Number(e.target.value) || 0)}
      className={`${inputCls} ${widthCls} tabular-nums`}
    />
    <span className="text-xs tabular-nums text-[color:var(--color-foreground)]">
      {fmtBRL(cents)}
    </span>
  </label>
);

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
      <span className={legendCls}>Benefícios</span>
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
  const [valorCents, setValorCents] = useState(monthly?.baseAmountCents ?? 0);

  return (
    <article
      className={`flex flex-col gap-5 rounded-lg border border-[color:var(--color-border)] p-4 ${
        plan.active ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">
          {plan.name}{' '}
          <span className="text-xs font-normal text-[color:var(--color-muted)]">
            ({plan.tier} · {plan.slug})
          </span>
        </h3>
        <StatusPill active={plan.active} />
      </div>

      <form action={detailAction} className="flex flex-col gap-2">
        <FieldGroup legend="Detalhes">
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
          <label className={`${labelCls} flex-1 basis-48`}>
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
          <label className={checkboxLabelCls}>
            <input name="active" type="checkbox" defaultChecked={plan.active} />
            Ativo
          </label>
          <Submit label="Salvar" />
          <Err state={detailState} />
        </FieldGroup>
      </form>

      <form
        action={priceAction}
        className="flex flex-col gap-2 border-t border-[color:var(--color-border)] pt-4"
      >
        <input type="hidden" name="cadence" value="monthly" />
        <FieldGroup legend="Preço mensal">
          <MoneyCentsField
            label="Valor"
            name="baseAmountCents"
            cents={valorCents}
            onChangeCents={setValorCents}
            min={0}
          />
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
            ID do preço (Stripe)
            <input
              name="stripePriceId"
              defaultValue={monthly?.stripePriceId ?? ''}
              maxLength={120}
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            ID do produto (RevenueCat)
            <input
              name="rcProductId"
              defaultValue={monthly?.rcProductId ?? ''}
              maxLength={120}
              className={inputCls}
            />
          </label>
          <label className={checkboxLabelCls}>
            <input name="active" type="checkbox" defaultChecked={monthly?.active ?? true} />
            Preço ativo
          </label>
          <Submit label="Salvar preço" />
          <Err state={priceState} />
        </FieldGroup>
      </form>

      <div className="border-t border-[color:var(--color-border)] pt-4">
        <BenefitsEditor plan={plan} />
      </div>

      <form
        action={deleteAction}
        className="flex items-center gap-2 border-t border-[color:var(--color-border)] pt-4"
      >
        <button type="submit" disabled={!plan.active} className={dangerBtnCls}>
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
      className="flex flex-col gap-2 rounded-lg border border-dashed border-[color:var(--color-border)] p-4"
    >
      <FieldGroup legend="Novo plano">
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
        <label className={checkboxLabelCls}>
          <input name="active" type="checkbox" defaultChecked />
          Ativo
        </label>
        <Submit label="Adicionar plano" />
        <Err state={state} />
      </FieldGroup>
    </form>
  );
};

// ── Module card ────────────────────────────────────────────────────

const ModuleFields = ({ mod }: { mod?: AdminPremiumAddonModule }) => {
  const [monthlyDeltaCents, setMonthlyDeltaCents] = useState(mod?.monthlyDeltaCents ?? 0);
  const [payoutAmountCents, setPayoutAmountCents] = useState(mod?.payoutAmountCents ?? 0);
  const marginCents = monthlyDeltaCents - payoutAmountCents;
  const marginColor =
    marginCents > 0
      ? 'text-green-400'
      : marginCents < 0
        ? 'text-red-400'
        : 'text-[color:var(--color-muted)]';

  return (
    <>
      <FieldGroup legend="Detalhes">
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
        <label className={`${labelCls} flex-1 basis-48`}>
          Descrição
          <input
            name="description"
            defaultValue={mod?.description ?? ''}
            required
            maxLength={240}
            className={inputCls}
          />
        </label>
      </FieldGroup>

      <FieldGroup legend="Precificação e repasse">
        <MoneyCentsField
          label="Preço mensal"
          name="monthlyDeltaCents"
          cents={monthlyDeltaCents}
          onChangeCents={setMonthlyDeltaCents}
          min={0}
        />
        <MoneyCentsField
          label="Repasse ao fornecedor"
          name="payoutAmountCents"
          cents={payoutAmountCents}
          onChangeCents={setPayoutAmountCents}
          min={0}
        />
        <label className={labelCls}>
          Fornecedor
          <input
            name="vendorName"
            defaultValue={mod?.vendorName ?? ''}
            maxLength={120}
            className={inputCls}
          />
        </label>
        <span className={labelCls}>
          Margem
          <span className={`py-1 text-sm font-semibold tabular-nums ${marginColor}`}>
            {fmtBRL(marginCents)}
          </span>
        </span>
      </FieldGroup>

      <FieldGroup legend="Cota e ordenação">
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
          Unidade da cota
          <select name="quotaUnit" defaultValue={mod?.quotaUnit ?? 'access'} className={inputCls}>
            <option value="access">Acesso</option>
            <option value="hours">Horas</option>
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
      </FieldGroup>

      <FieldGroup legend="Integração">
        <label className={labelCls}>
          ID do preço (Stripe)
          <input
            name="stripePriceId"
            defaultValue={mod?.stripePriceId ?? ''}
            maxLength={120}
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          ID do produto (RevenueCat)
          <input
            name="rcProductId"
            defaultValue={mod?.rcProductId ?? ''}
            maxLength={120}
            className={inputCls}
          />
        </label>
        <label className={checkboxLabelCls}>
          <input name="active" type="checkbox" defaultChecked={mod?.active ?? true} />
          Ativo
        </label>
      </FieldGroup>
    </>
  );
};

const ModuleCard = ({ mod }: { mod: AdminPremiumAddonModule }) => {
  const [state, action] = useActionState(updateModuleAction.bind(null, mod.id), initial);
  const [deleteState, deleteAction] = useActionState(
    deleteModuleAction.bind(null, mod.id),
    initial,
  );
  return (
    <article
      className={`flex flex-col gap-4 rounded-lg border border-[color:var(--color-border)] p-4 ${
        mod.active ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">
          {mod.name} <span className="text-xs text-[color:var(--color-muted)]">({mod.key})</span>
        </h3>
        <StatusPill active={mod.active} />
      </div>
      <form action={action} className="flex flex-col gap-3">
        <ModuleFields mod={mod} />
        <div className="flex items-center gap-3">
          <Submit label="Salvar" />
          <Err state={state} />
        </div>
      </form>
      <form
        action={deleteAction}
        className="flex items-center gap-2 border-t border-[color:var(--color-border)] pt-3"
      >
        <button type="submit" disabled={!mod.active} className={dangerBtnCls}>
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
      className="flex flex-col gap-3 rounded-lg border border-dashed border-[color:var(--color-border)] p-4"
    >
      <FieldGroup legend="Novo módulo">
        <label className={labelCls}>
          Chave
          <input name="key" required maxLength={40} className={inputCls} placeholder="ex.: wash" />
        </label>
      </FieldGroup>
      <ModuleFields />
      <div className="flex items-center gap-3">
        <Submit label="Adicionar módulo" />
        <Err state={state} />
      </div>
    </form>
  );
};

// ── Root ───────────────────────────────────────────────────────────

export const PremiumCatalogClient = ({ catalog }: { catalog: AdminPremiumCatalogResponse }) => (
  <div className="flex flex-col gap-10">
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">Planos</h2>
      <div className="flex flex-col gap-4">
        {catalog.plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>
      {catalog.plans.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">Nenhum plano cadastrado.</p>
      ) : null}
      <NewPlanForm />
    </section>

    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">Módulos</h2>
      <div className="flex flex-col gap-4">
        {catalog.modules.map((mod) => (
          <ModuleCard key={mod.id} mod={mod} />
        ))}
      </div>
      {catalog.modules.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">Nenhum módulo cadastrado.</p>
      ) : null}
      <NewModuleForm />
    </section>
  </div>
);
