import type { AdminFinanceMembershipsItem } from '@jdm/shared/admin';
import Link from 'next/link';

import { fetchFinanceMemberships } from '~/lib/finance-actions';

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

const providerLabel: Record<string, string> = {
  stripe: 'Stripe',
  apple_revenuecat: 'Apple / RC',
};

const cadenceLabel: Record<string, string> = {
  monthly: 'Mensal',
  annual: 'Anual',
};

const tierLabel: Record<string, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

interface Props {
  garageId: string;
}

export async function GarageMembershipHistory({ garageId }: Props) {
  // Uses F8.14's server-side `garageId` query filter so the API returns
  // only the rows belonging to this garage. The page/pageSize defaults
  // from the shared schema (1 / 25) are sufficient for the history view.
  let items: AdminFinanceMembershipsItem[] = [];
  try {
    const res = await fetchFinanceMemberships({ garageId, page: 1, pageSize: 25 });
    items = res.items;
  } catch {
    // Non-fatal: section falls back to empty state.
  }

  // Sort: live rows first (active/past_due/cancel_scheduled/trialing), then
  // expired/paused, oldest-first within each group.
  const liveStatuses = new Set(['active', 'past_due', 'cancel_scheduled', 'trialing']);
  const sorted = [...items].sort((a, b) => {
    const aLive = liveStatuses.has(a.status) ? 0 : 1;
    const bLive = liveStatuses.has(b.status) ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return a.currentPeriodEnd.localeCompare(b.currentPeriodEnd);
  });

  return (
    <div data-testid="garage-membership-history">
      <h2 className="mb-2 text-lg font-semibold">Histórico de Assinaturas Premium</h2>

      {sorted.length === 0 ? (
        <p
          className="text-sm text-[color:var(--color-muted)]"
          data-testid="garage-membership-empty"
        >
          Sem assinaturas registradas.
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-4">
          {sorted.map((m) => (
            <div
              key={m.membershipId}
              className="flex flex-col gap-1 rounded border border-[color:var(--color-border)] bg-surface-alt p-3"
              data-testid={`membership-row-${m.membershipId}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor[m.status] ?? ''}`}
                    data-testid={`membership-status-badge-${m.membershipId}`}
                  >
                    {statusLabel[m.status] ?? m.status}
                  </span>
                  <span className="text-xs font-medium">
                    {tierLabel[m.tier] ?? m.tier} / {cadenceLabel[m.cadence] ?? m.cadence}
                  </span>
                </div>
                <span
                  className="text-xs text-[color:var(--color-muted)]"
                  data-testid={`membership-provider-${m.membershipId}`}
                >
                  {providerLabel[m.provider] ?? m.provider}
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-[color:var(--color-muted)]">
                <span>Renovação: {fmtDate(m.currentPeriodEnd)}</span>
                <span>Total pago: {fmtBRL(m.totalPaidCents)}</span>
                <span>
                  {m.invoiceCount} {m.invoiceCount === 1 ? 'fatura' : 'faturas'}
                </span>
                {m.cancelAtPeriodEnd ? (
                  <span className="text-yellow-400">Cancelamento agendado</span>
                ) : null}
              </div>
              <Link
                href={`/financeiro/membros?search=${encodeURIComponent(m.userName)}`}
                className="mt-1 text-xs text-[color:var(--color-accent)] hover:underline"
                data-testid={`membership-finance-link-${m.membershipId}`}
              >
                Ver no financeiro
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
