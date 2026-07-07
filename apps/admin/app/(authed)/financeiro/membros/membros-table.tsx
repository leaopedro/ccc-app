import type { AdminFinanceMembershipsItem } from '@jdm/shared/admin';
import Link from 'next/link';

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

const cadenceLabel: Record<string, string> = {
  monthly: 'Mensal',
  annual: 'Anual',
};

const tierLabel: Record<string, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
};

const providerLabel: Record<string, string> = {
  stripe: 'Stripe',
  apple_revenuecat: 'Apple / RC',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

type ActiveFilters = {
  status: string | null;
  cadence: string | null;
  tier: string | null;
  provider: string | null;
};

type Props = {
  items: AdminFinanceMembershipsItem[];
  page: number;
  pageSize: number;
  total: number;
  activeFilters: ActiveFilters;
  preservedParams: Record<string, string>;
};

const FILTER_KEYS = new Set(['status', 'cadence', 'tier', 'provider', 'page']);

function seedPreserved(params: URLSearchParams, preserved: Record<string, string>): void {
  for (const [k, v] of Object.entries(preserved)) {
    if (FILTER_KEYS.has(k)) continue;
    if (v) params.set(k, v);
  }
}

// Build a query string for a filter toggle. Null clears the key; otherwise
// sets it. Always drops `page` so a filter change returns to page 1. Unknown
// query keys (`from`, `to`, `search`, etc.) are preserved verbatim.
function buildFilterHref(
  preserved: Record<string, string>,
  current: ActiveFilters,
  key: keyof ActiveFilters,
  value: string | null,
): string {
  const params = new URLSearchParams();
  seedPreserved(params, preserved);
  const next: ActiveFilters = { ...current, [key]: value };
  if (next.status) params.set('status', next.status);
  if (next.cadence) params.set('cadence', next.cadence);
  if (next.tier) params.set('tier', next.tier);
  if (next.provider) params.set('provider', next.provider);
  const qs = params.toString();
  return qs ? `?${qs}` : '?';
}

function buildPageHref(
  preserved: Record<string, string>,
  current: ActiveFilters,
  page: number,
): string {
  const params = new URLSearchParams();
  seedPreserved(params, preserved);
  if (current.status) params.set('status', current.status);
  if (current.cadence) params.set('cadence', current.cadence);
  if (current.tier) params.set('tier', current.tier);
  if (current.provider) params.set('provider', current.provider);
  params.set('page', String(page));
  return `?${params.toString()}`;
}

function buildClearHref(preserved: Record<string, string>): string {
  const params = new URLSearchParams();
  seedPreserved(params, preserved);
  const qs = params.toString();
  return qs ? `?${qs}` : '?';
}

function Chip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]'
          : 'border-[color:var(--color-border)] text-[color:var(--color-muted)] hover:border-[color:var(--color-muted)]'
      }`}
    >
      {label}
    </Link>
  );
}

export function MembrosTable({
  items,
  page,
  pageSize,
  total,
  activeFilters,
  preservedParams,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const statusOptions = ['active', 'past_due', 'cancel_scheduled', 'expired'];
  const cadenceOptions = ['monthly', 'annual'];
  const providerOptions = ['stripe', 'apple_revenuecat'];

  const hasAnyFilter = Boolean(
    activeFilters.status || activeFilters.cadence || activeFilters.tier || activeFilters.provider,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
        {statusOptions.map((s) => (
          <Chip
            key={s}
            href={buildFilterHref(
              preservedParams,
              activeFilters,
              'status',
              activeFilters.status === s ? null : s,
            )}
            label={statusLabel[s] ?? s}
            active={activeFilters.status === s}
          />
        ))}

        <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />

        {cadenceOptions.map((c) => (
          <Chip
            key={c}
            href={buildFilterHref(
              preservedParams,
              activeFilters,
              'cadence',
              activeFilters.cadence === c ? null : c,
            )}
            label={cadenceLabel[c] ?? c}
            active={activeFilters.cadence === c}
          />
        ))}

        <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />

        {providerOptions.map((p) => (
          <Chip
            key={p}
            href={buildFilterHref(
              preservedParams,
              activeFilters,
              'provider',
              activeFilters.provider === p ? null : p,
            )}
            label={providerLabel[p] ?? p}
            active={activeFilters.provider === p}
          />
        ))}

        {hasAnyFilter ? (
          <>
            <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />
            <Link
              href={buildClearHref(preservedParams)}
              className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
            >
              Limpar filtros
            </Link>
          </>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div
          className="flex min-h-[20vh] items-center justify-center rounded border border-[color:var(--color-border)]"
          data-testid="membros-empty-state"
        >
          <p className="text-sm text-[color:var(--color-muted)]">Nenhum membro encontrado.</p>
        </div>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
              <th className="py-2 pr-3">Usuário</th>
              <th className="pr-3">Plano</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">Próxima renovação</th>
              <th className="pr-3">Cancelado</th>
              <th className="pr-3">Total pago</th>
              <th className="pr-3">Faturas</th>
              <th className="pr-3">Provedor</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.membershipId}
                className="border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-border)]/30"
                data-testid={`membros-row-${item.membershipId}`}
              >
                <td className="py-2 pr-3">
                  <Link
                    href={`/users?q=${encodeURIComponent(item.userName)}`}
                    className="font-medium hover:underline"
                    data-testid={`membros-row-link-${item.membershipId}`}
                  >
                    {item.userName}
                  </Link>
                  <div className="text-xs text-[color:var(--color-muted)]">{item.garageSlug}</div>
                </td>
                <td className="pr-3">
                  {tierLabel[item.tier] ?? item.tier} / {cadenceLabel[item.cadence] ?? item.cadence}
                </td>
                <td className="pr-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor[item.status] ?? ''}`}
                    data-testid={`membros-status-${item.membershipId}`}
                  >
                    {statusLabel[item.status] ?? item.status}
                  </span>
                </td>
                <td className="pr-3">{fmtDate(item.currentPeriodEnd)}</td>
                <td className="pr-3">{item.cancelAtPeriodEnd ? 'Sim' : 'Não'}</td>
                <td className="pr-3">{fmtBRL(item.totalPaidCents)}</td>
                <td className="pr-3">{item.invoiceCount}</td>
                <td className="pr-3">{providerLabel[item.provider] ?? item.provider}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link
              href={buildPageHref(preservedParams, activeFilters, page - 1)}
              className="rounded border border-[color:var(--color-border)] px-3 py-1"
              data-testid="membros-prev"
            >
              Anterior
            </Link>
          ) : (
            <span
              className="rounded border border-[color:var(--color-border)] px-3 py-1 opacity-40"
              data-testid="membros-prev"
            >
              Anterior
            </span>
          )}
          <span
            className="text-xs text-[color:var(--color-muted)]"
            data-testid="membros-page-indicator"
          >
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={buildPageHref(preservedParams, activeFilters, page + 1)}
              className="rounded border border-[color:var(--color-border)] px-3 py-1"
              data-testid="membros-next"
            >
              Próxima
            </Link>
          ) : (
            <span
              className="rounded border border-[color:var(--color-border)] px-3 py-1 opacity-40"
              data-testid="membros-next"
            >
              Próxima
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
