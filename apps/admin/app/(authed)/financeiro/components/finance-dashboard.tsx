'use client';

import type {
  AdminFinanceByEventResponse,
  AdminFinanceByProductResponse,
  AdminFinancePaymentMixResponse,
  AdminFinanceQuery,
  AdminFinanceSummary,
  AdminFinanceTrendResponse,
} from '@jdm/shared/admin';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  startTransition as reactTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';

import { FilterBar } from './filter-bar';
import { KpiRow } from './kpi-row';
import { PaymentMix } from './payment-mix';
import { ProductTable } from './product-table';
import { RevenueTable } from './revenue-table';
import { TrendChart } from './trend-chart';

import {
  fetchFinanceDashboard,
  fetchFinanceExportCsv,
  fetchFinanceFilterEvents,
  type FinanceFilterEvent,
} from '~/lib/finance-actions';

type DashboardData = {
  summary: AdminFinanceSummary;
  byEvent: AdminFinanceByEventResponse;
  trends: AdminFinanceTrendResponse;
  paymentMix: AdminFinancePaymentMixResponse;
  byProduct: AdminFinanceByProductResponse;
};

type ViewState =
  | { status: 'loading' }
  | { status: 'data'; data: DashboardData }
  | { status: 'error'; message: string; id: string }
  | { status: 'empty' };

function DashboardInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [view, setView] = useState<ViewState>({ status: 'loading' });
  const [isExporting, setIsExporting] = useState(false);
  const [events, setEvents] = useState<FinanceFilterEvent[]>([]);
  const abortRef = useRef(0);

  const buildQuery = useCallback((): AdminFinanceQuery | undefined => {
    const from = searchParams.get('from') ?? undefined;
    const to = searchParams.get('to') ?? undefined;
    const provider = searchParams.get('provider') as AdminFinanceQuery['provider'] | undefined;
    const method = searchParams.get('method') as AdminFinanceQuery['method'] | undefined;
    const search = searchParams.get('search') ?? undefined;
    const eventId = searchParams.get('eventId') ?? undefined;
    const eventIds = eventId ? [eventId] : undefined;
    // F8.15 fix-up: surface the 4 new filter keys to the API so the FilterBar
    // dropdowns actually scope the dashboard data. Without these the controls
    // would update internal state but never reach the request.
    const kind = searchParams.get('kind') as AdminFinanceQuery['kind'] | undefined;
    const cadence = searchParams.get('cadence') as AdminFinanceQuery['cadence'] | undefined;
    const tier = searchParams.get('tier') as AdminFinanceQuery['tier'] | undefined;
    const membershipStatus = searchParams.get('membershipStatus') as
      | AdminFinanceQuery['membershipStatus']
      | undefined;

    if (
      !from &&
      !to &&
      !provider &&
      !method &&
      !search &&
      !eventIds &&
      !kind &&
      !cadence &&
      !tier &&
      !membershipStatus
    ) {
      return undefined;
    }
    return {
      from,
      to,
      provider,
      method,
      search,
      eventIds,
      kind,
      cadence,
      tier,
      membershipStatus,
    };
  }, [searchParams]);

  const updateFilter = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`);
      });
    },
    [searchParams, router, pathname],
  );

  const clearFilters = useCallback(() => {
    startTransition(() => {
      router.replace(pathname);
    });
  }, [router, pathname]);

  useEffect(() => {
    let cancelled = false;
    fetchFinanceFilterEvents()
      .then((list) => {
        if (!cancelled) setEvents(list);
      })
      .catch(() => {
        // Non-critical: dashboard still works without the dropdown options.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = ++abortRef.current;

    reactTransition(() => {
      setView({ status: 'loading' });
    });

    fetchFinanceDashboard(buildQuery())
      .then((result) => {
        if (abortRef.current === id) {
          const isEmpty = result.summary.orderCount === 0 && result.byEvent.items.length === 0;
          setView(isEmpty ? { status: 'empty' } : { status: 'data', data: result });
        }
      })
      .catch((err) => {
        if (abortRef.current === id) {
          setView({
            status: 'error',
            message: String(err),
            id: crypto.randomUUID().slice(0, 8),
          });
        }
      });
  }, [buildQuery]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const csv = await fetchFinanceExportCsv(buildQuery());
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financeiro-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Silently fail — export is non-critical
    } finally {
      setIsExporting(false);
    }
  };

  const activeFilters = {
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    provider: searchParams.get('provider'),
    method: searchParams.get('method'),
    search: searchParams.get('search'),
    eventId: searchParams.get('eventId'),
    kind: searchParams.get('kind'),
    cadence: searchParams.get('cadence'),
    tier: searchParams.get('tier'),
    membershipStatus: searchParams.get('membershipStatus'),
  };

  if (view.status === 'error') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold">Erro ao carregar dados</h2>
          <p className="mt-2 text-[color:var(--color-muted)]">{view.message}</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold"
            >
              Tentar novamente
            </button>
            <button
              onClick={() => void navigator.clipboard.writeText(view.id)}
              className="rounded border border-[color:var(--color-border)] px-4 py-2 text-sm text-[color:var(--color-muted)]"
            >
              Copiar ID: {view.id}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Financeiro</h1>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            O CSV exporta apenas grupos agregados. Recortes com menos de 5 pedidos ficam ocultos por
            privacidade.
          </p>
        </div>
        <button
          onClick={() => void handleExport()}
          disabled={isExporting || view.status === 'loading'}
          className="rounded border border-[color:var(--color-border)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {isExporting ? 'Exportando...' : 'Exportar CSV agregado'}
        </button>
      </header>

      <FilterBar
        filters={activeFilters}
        events={events}
        onFilterChange={updateFilter}
        onClear={clearFilters}
        isPending={isPending}
      />

      {view.status === 'loading' ? (
        <DashboardSkeleton />
      ) : view.status === 'data' ? (
        <DashboardContent data={view.data} />
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function DashboardContent({ data }: { data: DashboardData }) {
  return (
    <div className="flex flex-col gap-6">
      <KpiRow summary={data.summary} />
      <TrendChart points={data.trends.points} />
      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <RevenueTable items={data.byEvent.items} />
        </div>
        <PaymentMix items={data.paymentMix.items} />
      </div>
      {data.byProduct.items.length > 0 ? <ProductTable items={data.byProduct.items} /> : null}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-[color:var(--color-border)]" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-[color:var(--color-border)]" />
      <div className="h-48 animate-pulse rounded-lg bg-[color:var(--color-border)]" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Sem dados financeiros</h2>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Nenhum pedido encontrado para os filtros selecionados.
        </p>
      </div>
    </div>
  );
}

export function FinanceDashboard() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardInner />
    </Suspense>
  );
}
