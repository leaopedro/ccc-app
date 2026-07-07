'use client';

import { useState } from 'react';

import { DatePickerField } from '~/components/date-picker-field';

type Filters = {
  from: string | null;
  to: string | null;
  provider: string | null;
  method: string | null;
  search: string | null;
  eventId: string | null;
  // F8.15 additions (optional for backward-compat with parent dashboards that
  // pre-date F8.15; deviation #1 in chunk-15 plan).
  kind?: string | null;
  cadence?: string | null;
  tier?: string | null;
  membershipStatus?: string | null;
};

type EventOption = { id: string; title: string };

type Props = {
  filters: Filters;
  events: EventOption[];
  onFilterChange: (key: string, value: string | null) => void;
  onClear: () => void;
  isPending: boolean;
};

const providerOptions = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'abacatepay', label: 'AbacatePay' },
];

const methodOptions = [
  { value: 'card', label: 'Cartão' },
  { value: 'pix', label: 'Pix' },
];

const kindOptions = [
  { value: 'all', label: 'Todos' },
  { value: 'tickets', label: 'Ingressos' },
  { value: 'store', label: 'Loja' },
  { value: 'membership', label: 'Assinaturas' },
];

const cadenceOptions = [
  { value: 'all', label: 'Todas as cadências' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'annual', label: 'Anual' },
];

const tierOptions = [
  { value: 'all', label: 'Todos os planos' },
  { value: 'gold', label: 'Gold' },
];

const membershipStatusOptions = [
  { value: 'all', label: 'Todos os status' },
  { value: 'active', label: 'Ativo' },
  { value: 'past_due', label: 'Pagamento pendente' },
  { value: 'cancel_scheduled', label: 'Cancelamento agendado' },
  { value: 'expired', label: 'Expirado' },
];

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]'
          : 'border-[color:var(--color-border)] text-[color:var(--color-muted)] hover:border-[color:var(--color-muted)]'
      }`}
    >
      {label}
    </button>
  );
}

export function FilterBar({ filters, events, onFilterChange, onClear, isPending }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const hasFilters = Object.values(filters).some(Boolean);

  const filterContent = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={filters.eventId ?? ''}
        onChange={(e) => onFilterChange('eventId', e.target.value || null)}
        className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="Filtrar por evento"
      >
        <option value="">Todos os eventos</option>
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.title}
          </option>
        ))}
      </select>

      <select
        value={filters.kind ?? 'all'}
        onChange={(e) => onFilterChange('kind', e.target.value === 'all' ? null : e.target.value)}
        className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
        aria-label="Tipo de receita"
      >
        {kindOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {filters.kind === 'membership' ? (
        <>
          <select
            value={filters.cadence ?? 'all'}
            onChange={(e) =>
              onFilterChange('cadence', e.target.value === 'all' ? null : e.target.value)
            }
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
            aria-label="Cadência"
          >
            {cadenceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            value={filters.tier ?? 'all'}
            onChange={(e) =>
              onFilterChange('tier', e.target.value === 'all' ? null : e.target.value)
            }
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
            aria-label="Plano"
          >
            {tierOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            value={filters.membershipStatus ?? 'all'}
            onChange={(e) =>
              onFilterChange('membershipStatus', e.target.value === 'all' ? null : e.target.value)
            }
            className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-xs"
            aria-label="Status"
          >
            {membershipStatusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />

      <DatePickerField
        value={filters.from}
        onChange={(v) => onFilterChange('from', v)}
        placeholder="De"
      />
      <span className="text-xs text-[color:var(--color-muted)]">a</span>
      <DatePickerField
        value={filters.to}
        onChange={(v) => onFilterChange('to', v)}
        placeholder="Até"
      />

      <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />

      {providerOptions.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          active={filters.provider === opt.value}
          onClick={() =>
            onFilterChange('provider', filters.provider === opt.value ? null : opt.value)
          }
        />
      ))}

      <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />

      {methodOptions.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          active={filters.method === opt.value}
          onClick={() => onFilterChange('method', filters.method === opt.value ? null : opt.value)}
        />
      ))}

      {hasFilters ? (
        <>
          <span className="mx-1 h-4 w-px bg-[color:var(--color-border)]" />
          <button
            onClick={onClear}
            className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
          >
            Limpar filtros
          </button>
        </>
      ) : null}

      {isPending ? (
        <span className="ml-2 text-xs text-[color:var(--color-muted)]">Atualizando...</span>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Desktop: sticky inline bar */}
      <div className="sticky top-0 z-10 hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 sm:block">
        {filterContent}
      </div>

      {/* Mobile: trigger button + sheet */}
      <div className="sm:hidden">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex w-full items-center justify-between rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-sm"
        >
          <span>Filtros{hasFilters ? ' (ativos)' : ''}</span>
          <span className="text-xs">{mobileOpen ? '▲' : '▼'}</span>
        </button>
        {mobileOpen ? (
          <div className="mt-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3">
            {filterContent}
          </div>
        ) : null}
      </div>
    </>
  );
}
