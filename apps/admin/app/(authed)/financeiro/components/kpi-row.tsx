import type { AdminFinanceSummary } from '@ccc/shared/admin';

const fmtCurrency = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const fmtNumber = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

type Tile = { label: string; value: string; accent?: boolean; unfiltered?: boolean };

type TileGroup = { title: string; tiles: Tile[] };

function buildTileGroups(s: AdminFinanceSummary): TileGroup[] {
  // F8.15: net = tickets + store net (already in s.netRevenueCents) + membership net.
  // `?? 0` guards against API payloads from before F8.13 deployed.
  const totalNetCents = s.netRevenueCents + (s.membershipNetRevenueCents ?? 0);

  // Task 5: activeMembershipsCount, membershipMRRCents, membershipARPUCents,
  // newMembershipsCount and churnedMembershipsCount read PremiumMembership
  // directly and never respond to the `livemode` selector — a different
  // mechanism (purge-test-mode.ts) excludes test rows there. Driven by the
  // API field, not a hardcoded list, so the marker disappears on its own if
  // the API ever starts filtering these too.
  const countsUnfiltered = !s.membershipCountsLivemodeFiltered;

  return [
    {
      title: 'Resumo geral',
      tiles: [
        { label: 'Receita líquida', value: fmtCurrency(totalNetCents), accent: true },
        { label: 'Receita bruta', value: fmtCurrency(s.totalRevenueCents) },
        { label: 'Pedidos', value: fmtNumber(s.orderCount) },
        { label: 'Ticket médio', value: fmtCurrency(s.avgOrderCents) },
        { label: 'Ingressos', value: fmtNumber(s.ticketCount) },
      ],
    },
    {
      title: 'Loja e ajustes',
      tiles: [
        { label: 'Receita loja', value: fmtCurrency(s.storeRevenueCents) },
        { label: 'Pedidos loja', value: fmtNumber(s.storeOrderCount) },
        { label: 'Reembolsado', value: fmtCurrency(s.refundedCents) },
        { label: 'Reembolsos', value: fmtNumber(s.refundedCount) },
      ],
    },
    {
      title: 'Assinaturas',
      tiles: [
        {
          label: 'Receita de Membros',
          value: fmtCurrency(s.membershipNetRevenueCents ?? 0),
        },
        {
          label: 'Membros Ativos',
          value: fmtNumber(s.activeMembershipsCount ?? 0),
          unfiltered: countsUnfiltered,
        },
        {
          label: 'MRR',
          value: fmtCurrency(s.membershipMRRCents ?? 0),
          accent: true,
          unfiltered: countsUnfiltered,
        },
      ],
    },
    {
      title: 'Taxa de desenvolvimento',
      tiles: [
        { label: 'Taxa atual', value: `${s.devFeePercent}%` },
        { label: 'Taxa coletada', value: fmtCurrency(s.devFeeCollectedCents) },
      ],
    },
  ];
}

export function KpiRow({ summary }: { summary: AdminFinanceSummary }) {
  const groups = buildTileGroups(summary);

  return (
    <div className="flex flex-col gap-4">
      {summary.livemodeBackfillPending ? (
        <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-panel)]/40 p-3 text-xs text-[color:var(--color-muted)]">
          Nenhuma marcação de pré-corte foi registrada. Os valores abaixo podem incluir receita de
          modo teste do Stripe.
        </div>
      ) : null}
      {groups.map((group) => (
        <div
          key={group.title}
          className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)]/40 p-4"
        >
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--color-muted)]">
            {group.title}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {group.tiles.map((t) => (
              <div
                key={t.label}
                className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-4"
              >
                <div className="text-xs text-[color:var(--color-muted)]">{t.label}</div>
                <div
                  className={`mt-1 text-xl font-semibold tabular-nums ${t.accent ? 'text-[color:var(--color-accent)]' : ''}`}
                >
                  {t.value}
                </div>
                {t.unfiltered ? (
                  <div
                    className="mt-1 text-[10px] text-[color:var(--color-muted)]"
                    title="Este número vem direto das assinaturas ativas e não responde ao filtro de modo de receita (real/teste) acima."
                  >
                    Não filtra por modo
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
