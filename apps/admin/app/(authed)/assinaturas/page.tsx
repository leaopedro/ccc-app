import { AssinaturasTable } from './assinaturas-table';

import { getAdminPremiumCatalog } from '~/lib/admin-api';
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

export default async function AssinaturasPage({
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
  const addonKey = getStr('addonKey');
  const vendorName = getStr('vendorName');

  // O catalogo alimenta as opcoes de modulo e a lista de fornecedores distintos.
  // Falha aqui nao pode derrubar a lista inteira: sem catalogo, os dois grupos
  // de chip simplesmente nao aparecem.
  let moduleOptions: Array<{ key: string; name: string }> = [];
  let vendorOptions: string[] = [];
  try {
    const catalog = await getAdminPremiumCatalog();
    const activeModules = catalog.modules.filter((m) => m.active);
    moduleOptions = activeModules.map((m) => ({ key: m.key, name: m.name }));
    vendorOptions = Array.from(
      new Set(
        activeModules
          .map((m) => m.vendorName)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  } catch {
    moduleOptions = [];
    vendorOptions = [];
  }

  const data = await fetchFinanceMemberships({
    status,
    cadence,
    tier,
    provider,
    from,
    to,
    search,
    addonKey,
    vendorName,
    page,
    pageSize,
  });

  const preservedParams: Record<string, string> = {};
  if (from) preservedParams.from = from;
  if (to) preservedParams.to = to;
  if (search) preservedParams.search = search;

  return (
    <section className="flex flex-col gap-6" data-accent="ccc">
      <header>
        <h1 className="text-2xl font-bold">Assinaturas</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Controle das assinaturas dos membros, planos e módulos adicionais.
        </p>
      </header>
      <AssinaturasTable
        items={data.items}
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        activeFilters={{
          status: status ?? null,
          cadence: cadence ?? null,
          tier: tier ?? null,
          provider: provider ?? null,
          addonKey: addonKey ?? null,
          vendorName: vendorName ?? null,
        }}
        preservedParams={preservedParams}
        moduleOptions={moduleOptions}
        vendorOptions={vendorOptions}
      />
    </section>
  );
}
