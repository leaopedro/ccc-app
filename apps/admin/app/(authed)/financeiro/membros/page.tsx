import { MembrosTable } from './membros-table';

import { fetchFinanceMemberships } from '~/lib/finance-actions';

export const dynamic = 'force-dynamic';

type StatusFilter = 'trialing' | 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | 'paused';
type CadenceFilter = 'monthly' | 'annual';
type TierFilter = 'bronze' | 'silver' | 'gold';
type ProviderFilter = 'stripe' | 'apple_revenuecat';

const statusValues: ReadonlyArray<StatusFilter> = [
  'trialing',
  'active',
  'past_due',
  'cancel_scheduled',
  'expired',
  'paused',
];
const cadenceValues: ReadonlyArray<CadenceFilter> = ['monthly', 'annual'];
const tierValues: ReadonlyArray<TierFilter> = ['bronze', 'silver', 'gold'];
const providerValues: ReadonlyArray<ProviderFilter> = ['stripe', 'apple_revenuecat'];

export default async function FinanceiroMembrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const getStr = (key: string) => {
    const v = sp[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  const pageRaw = Number(getStr('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const pageSize = 25;

  const rawStatus = getStr('status');
  const rawCadence = getStr('cadence');
  const rawTier = getStr('tier');
  const rawProvider = getStr('provider');

  const status = statusValues.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : undefined;
  const cadence = cadenceValues.includes(rawCadence as CadenceFilter)
    ? (rawCadence as CadenceFilter)
    : undefined;
  const tier = tierValues.includes(rawTier as TierFilter) ? (rawTier as TierFilter) : undefined;
  const provider = providerValues.includes(rawProvider as ProviderFilter)
    ? (rawProvider as ProviderFilter)
    : undefined;

  const from = getStr('from');
  const to = getStr('to');
  const search = getStr('search');

  const data = await fetchFinanceMemberships({
    status,
    cadence,
    tier,
    provider,
    from,
    to,
    search,
    page,
    pageSize,
  });

  const preservedParams: Record<string, string> = {};
  if (from) preservedParams.from = from;
  if (to) preservedParams.to = to;
  if (search) preservedParams.search = search;

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Membros premium</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Lista de membros com assinatura Premium.
        </p>
      </header>
      <MembrosTable
        items={data.items}
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        activeFilters={{
          status: status ?? null,
          cadence: cadence ?? null,
          tier: tier ?? null,
          provider: provider ?? null,
        }}
        preservedParams={preservedParams}
      />
    </section>
  );
}
