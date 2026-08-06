import type { AdminFinanceMembershipsItem } from '@ccc/shared/admin';
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

const cadenceLabel: Record<string, string> = { monthly: 'Mensal', annual: 'Anual' };
const tierLabel: Record<string, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const providerLabel: Record<string, string> = {
  stripe: 'Stripe',
  apple_revenuecat: 'Apple / RC',
};

/**
 * Metodo de pagamento so existe como snapshot para assinaturas que renovaram
 * depois da mudanca. Sem o snapshot, cai para um rotulo derivado do provider.
 */
function paymentLabel(item: AdminFinanceMembershipsItem): string {
  if (item.paymentBrand && item.paymentLast4) {
    return `${item.paymentBrand} ····${item.paymentLast4}`;
  }
  return item.provider === 'apple_revenuecat' ? 'App Store' : 'Cartão';
}

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
  addonKey: string | null;
  vendorName: string | null;
};

type Props = {
  items: AdminFinanceMembershipsItem[];
  page: number;
  pageSize: number;
  total: number;
  activeFilters: ActiveFilters;
  preservedParams: Record<string, string>;
  moduleOptions: Array<{ key: string; name: string }>;
  vendorOptions: string[];
};

const FILTER_KEYS = new Set([
  'status',
  'cadence',
  'tier',
  'provider',
  'addonKey',
  'vendorName',
  'page',
]);

function seedPreserved(params: URLSearchParams, preserved: Record<string, string>): void {
  for (const [k, v] of Object.entries(preserved)) {
    if (FILTER_KEYS.has(k)) continue;
    if (v) params.set(k, v);
  }
}

function applyFilters(params: URLSearchParams, f: ActiveFilters): void {
  if (f.status) params.set('status', f.status);
  if (f.cadence) params.set('cadence', f.cadence);
  if (f.tier) params.set('tier', f.tier);
  if (f.provider) params.set('provider', f.provider);
  if (f.addonKey) params.set('addonKey', f.addonKey);
  if (f.vendorName) params.set('vendorName', f.vendorName);
}

// Null limpa a chave. Sempre derruba `page`: trocar filtro volta para a pagina 1.
// Chaves desconhecidas (`from`, `to`, `search`) sao preservadas verbatim.
function buildFilterHref(
  preserved: Record<string, string>,
  current: ActiveFilters,
  key: keyof ActiveFilters,
  value: string | null,
): string {
  const params = new URLSearchParams();
  seedPreserved(params, preserved);
  applyFilters(params, { ...current, [key]: value });
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
  applyFilters(params, current);
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

export function AssinaturasTable({
  items,
  page,
  pageSize,
  total,
  activeFilters,
  preservedParams,
  moduleOptions,
  vendorOptions,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const statusOptions = ['active', 'past_due', 'cancel_scheduled', 'paused', 'expired'];
  const cadenceOptions = ['monthly', 'annual'];
  const tierOptions = ['bronze', 'silver', 'gold'];
  const providerOptions = ['stripe', 'apple_revenuecat'];

  const hasAnyFilter = Object.values(activeFilters).some(Boolean);

  const chipGroup = (
    key: keyof ActiveFilters,
    options: ReadonlyArray<{ value: string; label: string }>,
  ) =>
    options.map((o) => (
      <Chip
        key={`${key}-${o.value}`}
        href={buildFilterHref(
          preservedParams,
          activeFilters,
          key,
          activeFilters[key] === o.value ? null : o.value,
        )}
        label={o.label}
        active={activeFilters[key] === o.value}
      />
    ));

  const divider = <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          {chipGroup(
            'status',
            statusOptions.map((s) => ({ value: s, label: statusLabel[s] ?? s })),
          )}
          {divider}
          {chipGroup(
            'tier',
            tierOptions.map((t) => ({ value: t, label: tierLabel[t] ?? t })),
          )}
          {divider}
          {chipGroup(
            'cadence',
            cadenceOptions.map((c) => ({ value: c, label: cadenceLabel[c] ?? c })),
          )}
          {divider}
          {chipGroup(
            'provider',
            providerOptions.map((p) => ({ value: p, label: providerLabel[p] ?? p })),
          )}
        </div>

        {moduleOptions.length > 0 || vendorOptions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[color:var(--color-muted)]">Módulo</span>
            {chipGroup(
              'addonKey',
              moduleOptions.map((m) => ({ value: m.key, label: m.name })),
            )}
            {vendorOptions.length > 0 ? (
              <>
                {divider}
                <span className="text-xs text-[color:var(--color-muted)]">Fornecedor</span>
                {chipGroup(
                  'vendorName',
                  vendorOptions.map((v) => ({ value: v, label: v })),
                )}
              </>
            ) : null}
          </div>
        ) : null}

        {/*
          Periodo de renovacao. Formulario GET em vez de chip porque o valor e
          continuo, nao uma escolha entre opcoes. Os filtros ativos viajam em
          campos hidden para o submit nao apagar o resto do estado.
        */}
        <form method="get" className="flex flex-wrap items-end gap-2">
          {Object.entries(preservedParams)
            .filter(([k]) => k !== 'from' && k !== 'to' && k !== 'search')
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          {(Object.keys(activeFilters) as Array<keyof ActiveFilters>)
            .filter((k) => activeFilters[k])
            .map((k) => (
              <input key={k} type="hidden" name={k} value={activeFilters[k] as string} />
            ))}
          <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
            Renova de
            <input
              type="date"
              name="from"
              defaultValue={preservedParams.from ?? ''}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]"
              data-testid="assinaturas-from"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
            até
            <input
              type="date"
              name="to"
              defaultValue={preservedParams.to ?? ''}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]"
              data-testid="assinaturas-to"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[color:var(--color-muted)]">
            Buscar
            <input
              type="search"
              name="search"
              defaultValue={preservedParams.search ?? ''}
              placeholder="nome ou email"
              className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm text-[color:var(--color-fg)]"
              data-testid="assinaturas-search"
            />
          </label>
          <button
            type="submit"
            className="rounded border border-[color:var(--color-border)] px-3 py-1 text-sm"
            data-testid="assinaturas-apply"
          >
            Aplicar
          </button>
          {hasAnyFilter || preservedParams.from || preservedParams.to || preservedParams.search ? (
            <Link
              href={buildClearHref({})}
              className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
            >
              Limpar filtros
            </Link>
          ) : null}
        </form>
      </div>

      {items.length === 0 ? (
        <div
          className="flex min-h-[20vh] items-center justify-center rounded border border-[color:var(--color-border)]"
          data-testid="assinaturas-empty-state"
        >
          <p className="text-sm text-[color:var(--color-muted)]">Nenhuma assinatura encontrada.</p>
        </div>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-xs text-[color:var(--color-muted)]">
              <th className="py-2 pr-3">Membro</th>
              <th className="pr-3">Plano</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">Pagamento</th>
              <th className="pr-3">Renovação</th>
              <th className="pr-3">Mensal</th>
              <th className="pr-3">Módulos</th>
              <th className="pr-3">Total pago</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.membershipId}
                className="border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-border)]/30"
                data-testid={`assinaturas-row-${item.membershipId}`}
              >
                <td className="py-2 pr-3">
                  <Link
                    href={`/assinaturas/${item.membershipId}`}
                    className="font-medium hover:underline"
                    data-testid={`assinaturas-row-link-${item.membershipId}`}
                  >
                    {item.userName}
                  </Link>
                  <div className="text-xs text-[color:var(--color-muted)]">{item.userEmail}</div>
                </td>
                <td className="pr-3">
                  {tierLabel[item.tier] ?? item.tier} / {cadenceLabel[item.cadence] ?? item.cadence}
                </td>
                <td className="pr-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusColor[item.status] ?? ''}`}
                    data-testid={`assinaturas-status-${item.membershipId}`}
                  >
                    {statusLabel[item.status] ?? item.status}
                  </span>
                </td>
                <td className="pr-3 text-xs">{paymentLabel(item)}</td>
                <td className="pr-3">{fmtDate(item.currentPeriodEnd)}</td>
                <td className="pr-3">{fmtBRL(item.baseAmountCents + item.addonsAmountCents)}</td>
                <td className="pr-3">
                  {item.addonKeys.length === 0 ? (
                    <span className="text-xs text-[color:var(--color-muted)]">—</span>
                  ) : (
                    <span className="text-xs" data-testid={`assinaturas-addons-${item.membershipId}`}>
                      {item.addonKeys.join(', ')}
                    </span>
                  )}
                </td>
                <td className="pr-3">{fmtBRL(item.totalPaidCents)}</td>
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
              data-testid="assinaturas-prev"
            >
              Anterior
            </Link>
          ) : (
            <span
              className="rounded border border-[color:var(--color-border)] px-3 py-1 opacity-40"
              data-testid="assinaturas-prev"
            >
              Anterior
            </span>
          )}
          <span
            className="text-xs text-[color:var(--color-muted)]"
            data-testid="assinaturas-page-indicator"
          >
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={buildPageHref(preservedParams, activeFilters, page + 1)}
              className="rounded border border-[color:var(--color-border)] px-3 py-1"
              data-testid="assinaturas-next"
            >
              Próxima
            </Link>
          ) : (
            <span
              className="rounded border border-[color:var(--color-border)] px-3 py-1 opacity-40"
              data-testid="assinaturas-next"
            >
              Próxima
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
