import type { AdminSubscriptionDetail } from '@ccc/shared/admin-subscription';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AddonsPanel } from './addons-panel';
import { PlanActions } from './plan-actions';
import { StatusActions } from './status-actions';

import { getAdminPremiumCatalog } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';
import { fetchAdminSubscription } from '~/lib/assinaturas-actions';

export const dynamic = 'force-dynamic';

const statusLabel: Record<string, string> = {
  active: 'Ativo',
  past_due: 'Inadimplente',
  cancel_scheduled: 'Cancelamento agendado',
  expired: 'Expirado',
  trialing: 'Em teste',
  paused: 'Pausado',
};

const statusColor: Record<string, string> = {
  active: 'bg-emerald-900 text-emerald-300',
  past_due: 'bg-red-900 text-red-300',
  cancel_scheduled: 'bg-yellow-900 text-yellow-300',
  expired: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
  trialing: 'bg-blue-900 text-blue-300',
  paused: 'bg-[color:var(--color-border)] text-[color:var(--color-muted)]',
};

const cadenceLabel: Record<string, string> = { monthly: 'Mensal', annual: 'Anual' };
const tierLabel: Record<string, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const providerLabel: Record<string, string> = {
  stripe: 'Stripe',
  apple_revenuecat: 'Apple / RevenueCat',
};
const addonStatusLabel: Record<string, string> = {
  active: 'Ativo',
  cancel_scheduled: 'Cancelamento agendado',
  cancelled: 'Cancelado',
};
const quotaUnitLabel: Record<string, string> = { access: 'acessos', hours: 'horas' };
const invoiceStatusLabel: Record<string, string> = {
  paid: 'Pago',
  refunded: 'Estornado',
  partial_refund: 'Estorno parcial',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function paymentLabel(d: AdminSubscriptionDetail): string {
  if (d.paymentBrand && d.paymentLast4) return `${d.paymentBrand} ····${d.paymentLast4}`;
  return d.provider === 'apple_revenuecat' ? 'App Store' : 'Cartão';
}

function Tile({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div
      className="rounded-lg border border-[color:var(--color-border)] p-3"
      data-testid={testId}
    >
      <div className="text-xs uppercase tracking-[0.16em] text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

export default async function AssinaturaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: AdminSubscriptionDetail;
  try {
    detail = await fetchAdminSubscription(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const attachedKeys = detail.addons
    .filter((a) => a.status !== 'cancelled')
    .map((a) => a.key);

  // Sem catalogo o admin ainda ve a assinatura; so nao consegue vincular modulo.
  let moduleOptions: Array<{ key: string; name: string }> = [];
  try {
    const catalog = await getAdminPremiumCatalog();
    moduleOptions = catalog.modules
      .filter((m) => m.active)
      .map((m) => ({ key: m.key, name: m.name }));
  } catch {
    moduleOptions = [];
  }

  return (
    <section className="flex flex-col gap-6">
      <Link
        href="/assinaturas"
        className="text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
      >
        ← Assinaturas
      </Link>

      {/* Card do membro */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border)] p-4">
        <div>
          <Link
            href={`/users/${detail.userId}`}
            className="text-xl font-bold hover:underline"
            data-testid="assinaturas-detalhe-membro"
          >
            {detail.userName}
          </Link>
          <div className="text-sm text-[color:var(--color-muted)]">{detail.userEmail}</div>
          <div className="text-xs text-[color:var(--color-muted)]">{detail.garageSlug}</div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${statusColor[detail.status] ?? ''}`}
            data-testid="assinaturas-detalhe-status"
          >
            {statusLabel[detail.status] ?? detail.status}
          </span>
          <span className="text-xs text-[color:var(--color-muted)]">
            {providerLabel[detail.provider] ?? detail.provider}
          </span>
        </div>
      </div>

      {!detail.mutable ? (
        <div
          className="rounded-lg border border-yellow-900 bg-yellow-900/20 p-3 text-sm text-yellow-300"
          data-testid="assinaturas-detalhe-imutavel"
        >
          Esta assinatura é gerenciada pela App Store. Alterações precisam ser feitas pelo próprio
          membro, no dispositivo. As ações abaixo ficam desabilitadas.
        </div>
      ) : null}

      {/* Tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Plano"
          value={`${detail.planName ?? tierLabel[detail.tier] ?? detail.tier}`}
          testId="assinaturas-detalhe-plano"
        />
        <Tile label="Cadência" value={cadenceLabel[detail.cadence] ?? detail.cadence} />
        <Tile label="Valor base" value={fmtBRL(detail.baseAmountCents)} />
        <Tile label="Módulos" value={fmtBRL(detail.addonsAmountCents)} />
        <Tile
          label="Total mensal"
          value={fmtBRL(detail.totalAmountCents)}
          testId="assinaturas-detalhe-total"
        />
        <Tile label="Renovação" value={fmtDate(detail.currentPeriodEnd)} />
        <Tile
          label="Cancelamento agendado"
          value={detail.cancelAtPeriodEnd ? 'Sim' : 'Não'}
        />
        <Tile
          label="Pagamento"
          value={paymentLabel(detail)}
          testId="assinaturas-detalhe-pagamento"
        />
      </div>

      {/* Modulos */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Módulos adicionais</h2>
        {detail.addons.length === 0 ? (
          <p
            className="text-sm text-[color:var(--color-muted)]"
            data-testid="assinaturas-detalhe-sem-modulos"
          >
            Nenhum módulo vinculado.
          </p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
                <th className="py-2 pr-3">Módulo</th>
                <th className="pr-3">Fornecedor</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Cota do ciclo</th>
                <th className="pr-3">Cobrado</th>
                <th className="pr-3">Repasse</th>
                <th className="pr-3">Margem</th>
              </tr>
            </thead>
            <tbody>
              {detail.addons.map((addon) => (
                <tr
                  key={addon.key}
                  className="border-b border-[color:var(--color-border)]"
                  data-testid={`assinaturas-detalhe-modulo-${addon.key}`}
                >
                  <td className="py-2 pr-3">
                    <div className="font-medium">{addon.name}</div>
                    {!addon.billingIntegrated ? (
                      <div
                        className="text-xs text-yellow-300"
                        data-testid={`assinaturas-detalhe-modulo-sem-cobranca-${addon.key}`}
                      >
                        A Stripe não está cobrando por este módulo.
                      </div>
                    ) : null}
                  </td>
                  <td className="pr-3">
                    {addon.vendorName ?? (
                      <span className="text-[color:var(--color-muted)]">Não cadastrado</span>
                    )}
                  </td>
                  <td className="pr-3 text-xs">
                    {addonStatusLabel[addon.status] ?? addon.status}
                  </td>
                  <td className="pr-3 text-xs">
                    {addon.currentCycle
                      ? `${addon.currentCycle.quotaUsed} de ${addon.currentCycle.quotaTotal} ${quotaUnitLabel[addon.quotaUnit] ?? addon.quotaUnit}`
                      : '—'}
                  </td>
                  <td className="pr-3">{fmtBRL(addon.monthlyDeltaCents)}</td>
                  <td className="pr-3">{fmtBRL(addon.payoutAmountCents)}</td>
                  <td className="pr-3">{fmtBRL(addon.marginCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AddonsPanel
          membershipId={detail.membershipId}
          mutable={detail.mutable}
          status={detail.status}
          attachedKeys={attachedKeys}
          moduleOptions={moduleOptions}
        />
      </div>

      {/* Acoes */}
      <div className="grid gap-4 md:grid-cols-2">
        <PlanActions
          membershipId={detail.membershipId}
          mutable={detail.mutable}
          status={detail.status}
          currentTier={detail.tier}
          currentCadence={detail.cadence}
        />
        <StatusActions
          membershipId={detail.membershipId}
          mutable={detail.mutable}
          status={detail.status}
        />
      </div>

      {/* Historico */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Histórico de pagamentos</h2>
        {detail.invoices.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Nenhuma fatura registrada.</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
                <th className="py-2 pr-3">Período</th>
                <th className="pr-3">Pago em</th>
                <th className="pr-3">Valor</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Estorno</th>
              </tr>
            </thead>
            <tbody>
              {detail.invoices.map((inv, i) => (
                <tr
                  key={`${inv.periodStart}-${i}`}
                  className="border-b border-[color:var(--color-border)]"
                  data-testid={`assinaturas-detalhe-fatura-${i}`}
                >
                  <td className="py-2 pr-3">
                    {fmtDate(inv.periodStart)} — {fmtDate(inv.periodEnd)}
                  </td>
                  <td className="pr-3">{fmtDate(inv.paidAt)}</td>
                  <td className="pr-3">{fmtBRL(inv.grossAmountCents)}</td>
                  <td className="pr-3 text-xs">
                    {invoiceStatusLabel[inv.status] ?? inv.status}
                  </td>
                  <td className="pr-3 text-xs">
                    {inv.refundedAt
                      ? `${fmtDate(inv.refundedAt)} · ${fmtBRL(inv.refundedAmountCents ?? 0)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
