import type { AdminSubscriptionDetail } from '@ccc/shared/admin-subscription';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AddonsPanel } from './addons-panel';
import { PlanActions } from './plan-actions';
import { StatusActions } from './status-actions';

import { getAdminPremiumCatalog } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';
import { fetchAdminSubscription } from '~/lib/assinaturas-actions';
import { fmtBRL, fmtDate, fmtPeriod, fmtRelative } from '~/lib/format';

export const dynamic = 'force-dynamic';

const statusLabel: Record<string, string> = {
  active: 'Ativo',
  past_due: 'Inadimplente',
  cancel_scheduled: 'Cancelamento agendado',
  expired: 'Expirado',
  trialing: 'Em teste',
  paused: 'Pausado',
};

// Pilulas com fundo tintado + borda combinando, em vez do bg-*-900 solido:
// mais discreto, sem competir com o nome do membro no card acima.
const statusColor: Record<string, string> = {
  active: 'border border-emerald-900 bg-emerald-900/20 text-emerald-300',
  past_due: 'border border-red-900 bg-red-900/20 text-red-300',
  cancel_scheduled: 'border border-yellow-900 bg-yellow-900/20 text-yellow-300',
  expired:
    'border border-[color:var(--color-border)] bg-[color:var(--color-border)]/20 text-[color:var(--color-muted)]',
  trialing: 'border border-blue-900 bg-blue-900/20 text-blue-300',
  paused:
    'border border-[color:var(--color-border)] bg-[color:var(--color-border)]/20 text-[color:var(--color-muted)]',
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

function paymentLabel(d: AdminSubscriptionDetail): string {
  if (d.paymentBrand && d.paymentLast4) return `${d.paymentBrand} ····${d.paymentLast4}`;
  return d.provider === 'apple_revenuecat' ? 'App Store' : 'Cartão';
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Tile de suporte: rotulo + valor, peso visual menor que os dois numeros que
// abrem a tela (total mensal e renovacao).
function Tile({
  label,
  value,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] p-3" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

// Tile principal: o total cobrado e a data de renovacao sao a informacao que
// o operador busca primeiro; o resto (plano, cadencia, pagamento) so apoia.
function HeroTile({
  label,
  value,
  sub,
  accentValue,
  testId,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  accentValue?: boolean;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] p-4" data-testid={testId}>
      <div className="text-xs uppercase tracking-[0.16em] text-[color:var(--color-muted)]">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          accentValue ? 'text-[color:var(--color-accent)]' : ''
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-[color:var(--color-muted)]">{sub}</div> : null}
    </div>
  );
}

// Margem em destaque quando negativa: pilula tintada, mesma convencao das
// pilulas de status, em vez de so um numero perdido no meio da tabela.
function MarginValue({ cents }: { cents: number }) {
  if (cents < 0) {
    return (
      <span className="rounded border border-red-900 bg-red-900/20 px-1.5 py-0.5 font-semibold text-red-300">
        {fmtBRL(cents)}
      </span>
    );
  }
  return <span className="font-medium">{fmtBRL(cents)}</span>;
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

  const attachedKeys = detail.addons.filter((a) => a.status !== 'cancelled').map((a) => a.key);
  // Fix round 2, finding 2: so modulo 'active' pode ser removido de fato.
  // 'cancel_scheduled' ja teve o SubscriptionItem apagado na Stripe — um
  // segundo clique so reencontra o cache de idempotencia ou um 500.
  const removableKeys = detail.addons.filter((a) => a.status === 'active').map((a) => a.key);

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

  const now = new Date();
  const windingDown = detail.cancelAtPeriodEnd || detail.status === 'paused';
  const daysToRenewal = Math.round(
    (new Date(detail.currentPeriodEnd).getTime() - now.getTime()) / DAY_MS,
  );
  const renewalSoon = !windingDown && daysToRenewal >= 0 && daysToRenewal <= 7;

  return (
    <section className="flex flex-col gap-6" data-accent="ccc">
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

      {/* Os dois numeros que o operador busca primeiro: quanto e quando. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <HeroTile
          label="Total mensal"
          value={fmtBRL(detail.totalAmountCents)}
          accentValue
          testId="assinaturas-detalhe-total"
          sub={`Base ${fmtBRL(detail.baseAmountCents)} + módulos ${fmtBRL(detail.addonsAmountCents)}`}
        />
        <HeroTile
          label="Renovação"
          value={fmtDate(detail.currentPeriodEnd)}
          sub={
            <span className={renewalSoon ? 'font-medium text-[color:var(--color-accent)]' : ''}>
              {fmtRelative(detail.currentPeriodEnd, now)}
              {windingDown ? (
                <span className="ml-1.5 rounded border border-yellow-900 bg-yellow-900/20 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-300">
                  Encerra ao fim do período
                </span>
              ) : null}
            </span>
          }
        />
      </div>

      {/* Suporte: plano, cadencia e demais valores que ja compoem o total acima. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <Tile
          label="Plano"
          value={detail.planName ?? tierLabel[detail.tier] ?? detail.tier}
          testId="assinaturas-detalhe-plano"
        />
        <Tile label="Cadência" value={cadenceLabel[detail.cadence] ?? detail.cadence} />
        <Tile label="Valor base" value={fmtBRL(detail.baseAmountCents)} />
        <Tile label="Módulos" value={fmtBRL(detail.addonsAmountCents)} />
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
                <th className="pr-3 text-right">Cobrado</th>
                <th className="pr-3 text-right">Repasse</th>
                <th className="pr-3 text-right">Margem</th>
              </tr>
            </thead>
            <tbody>
              {detail.addons.map((addon) => (
                <tr
                  key={addon.key}
                  className="border-b border-[color:var(--color-border)]"
                  data-testid={`assinaturas-detalhe-modulo-${addon.key}`}
                >
                  <td className="py-3 pr-3">
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
                  <td className="py-3 pr-3 text-[color:var(--color-muted)]">
                    {addon.vendorName ?? (
                      <span className="text-[color:var(--color-muted)]">Não cadastrado</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-xs text-[color:var(--color-muted)]">
                    {addonStatusLabel[addon.status] ?? addon.status}
                  </td>
                  <td className="py-3 pr-3 text-xs text-[color:var(--color-muted)]">
                    {addon.currentCycle
                      ? `${addon.currentCycle.quotaUsed} de ${addon.currentCycle.quotaTotal} ${quotaUnitLabel[addon.quotaUnit] ?? addon.quotaUnit}`
                      : '—'}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-[color:var(--color-muted)]">
                    {fmtBRL(addon.monthlyDeltaCents)}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-[color:var(--color-muted)]">
                    {fmtBRL(addon.payoutAmountCents)}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">
                    <MarginValue cents={addon.marginCents} />
                  </td>
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
          removableKeys={removableKeys}
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
                <th className="pr-3 text-right">Valor</th>
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
                  <td className="py-3 pr-3">{fmtPeriod(inv.periodStart, inv.periodEnd)}</td>
                  <td className="py-3 pr-3 text-[color:var(--color-muted)]">
                    {fmtDate(inv.paidAt)}
                  </td>
                  <td className="py-3 pr-3 text-right font-medium tabular-nums">
                    {fmtBRL(inv.grossAmountCents)}
                  </td>
                  <td className="py-3 pr-3 text-xs text-[color:var(--color-muted)]">
                    {invoiceStatusLabel[inv.status] ?? inv.status}
                  </td>
                  <td className="py-3 pr-3 text-xs text-[color:var(--color-muted)]">
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
