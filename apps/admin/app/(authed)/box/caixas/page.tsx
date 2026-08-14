import Link from 'next/link';

import { AdvanceButton } from './advance-button';
import {
  BOX_FULFILLMENT_BADGE,
  BOX_FULFILLMENT_LABEL,
  BOX_STATUS_LABEL,
  COUNTER_ORDER,
  NEXT_FULFILLMENT,
} from './status-labels';

import { getAdminBoxPicking, listAdminBoxMonthly } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const formatBRL = (cents: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

export default async function CaixasPage({
  searchParams,
}: {
  searchParams: Promise<{ cycleKey?: string }>;
}) {
  const params = await searchParams;
  const requested =
    typeof params.cycleKey === 'string' && params.cycleKey.trim() !== ''
      ? params.cycleKey.trim()
      : undefined;

  const { cycleKey, availableCycles, counts, boxes } = await listAdminBoxMonthly(requested);
  const picking = await getAdminBoxPicking(cycleKey);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Caixas do mês</h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            Avance o fulfillment das caixas confirmadas e monte a lista de separação.
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm" action="/box/caixas">
          <label className="text-[color:var(--color-muted)]" htmlFor="cycleKey">
            Ciclo
          </label>
          <select
            id="cycleKey"
            name="cycleKey"
            defaultValue={cycleKey}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-1.5"
          >
            {availableCycles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded border border-[color:var(--color-border)] px-3 py-1.5"
          >
            Ver
          </button>
        </form>
      </header>

      <section aria-label="Contadores de fulfillment" className="flex flex-wrap gap-2 text-sm">
        {COUNTER_ORDER.filter((s) => s !== 'cancelled' || counts[s] > 0).map((s) => (
          <span
            key={s}
            className={`inline-flex items-center gap-2 rounded border px-3 py-1 ${BOX_FULFILLMENT_BADGE[s]}`}
          >
            {BOX_FULFILLMENT_LABEL[s]}
            <strong>{counts[s]}</strong>
          </span>
        ))}
      </section>

      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
            <th className="py-2">Membro</th>
            <th>Status</th>
            <th className="text-right">A pagar</th>
            <th>Fulfillment</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {boxes.map((row) => {
            const badge = BOX_FULFILLMENT_BADGE[row.fulfillmentStatus];
            const next = row.status === 'ready' ? NEXT_FULFILLMENT[row.fulfillmentStatus] : null;
            return (
              <tr key={row.id} className="border-b border-[color:var(--color-border)] align-top">
                <td className="py-2">
                  <div>{row.memberName}</div>
                  <div className="text-xs text-[color:var(--color-muted)]">{row.memberEmail}</div>
                </td>
                <td className="text-xs">{BOX_STATUS_LABEL[row.status]}</td>
                <td className="text-right">{formatBRL(row.chargeCents, row.currency)}</td>
                <td>
                  <span className={`inline-block rounded border px-2 py-0.5 text-xs ${badge}`}>
                    {BOX_FULFILLMENT_LABEL[row.fulfillmentStatus]}
                  </span>
                </td>
                <td className="text-right">
                  {next ? <AdvanceButton boxId={row.id} to={next} /> : null}
                </td>
              </tr>
            );
          })}
          {boxes.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-[color:var(--color-muted)]">
                Nenhuma caixa neste ciclo.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <section aria-label="Lista de separação" className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase text-[color:var(--color-muted)]">
          Lista de separação
        </h2>
        <p className="text-xs text-[color:var(--color-muted)]">
          Demanda física total das caixas confirmadas deste ciclo.
        </p>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-[color:var(--color-muted)]">
              Itens do catálogo
            </h3>
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
                  <th className="py-2">Item</th>
                  <th className="text-right">Qtd</th>
                  <th className="text-right">Caixas</th>
                </tr>
              </thead>
              <tbody>
                {picking.items.map((it) => (
                  <tr key={it.refId} className="border-b border-[color:var(--color-border)]">
                    <td className="py-2">{it.title}</td>
                    <td className="text-right">{it.totalQuantity}</td>
                    <td className="text-right">{it.boxCount}</td>
                  </tr>
                ))}
                {picking.items.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-[color:var(--color-muted)]">
                      Sem itens.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-[color:var(--color-muted)]">
              Módulos de parceiros
            </h3>
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
                  <th className="py-2">Módulo</th>
                  <th className="text-right">Qtd</th>
                  <th className="text-right">Caixas</th>
                </tr>
              </thead>
              <tbody>
                {picking.partnerItems.map((it) => (
                  <tr key={it.refId} className="border-b border-[color:var(--color-border)]">
                    <td className="py-2">{it.title}</td>
                    <td className="text-right">{it.totalQuantity}</td>
                    <td className="text-right">{it.boxCount}</td>
                  </tr>
                ))}
                {picking.partnerItems.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-[color:var(--color-muted)]">
                      Sem módulos.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="text-xs">
        <Link href="/box/catalogo" className="text-[color:var(--color-muted)] hover:underline">
          ← Voltar ao catálogo
        </Link>
      </div>
    </section>
  );
}
