import Link from 'next/link';

import { StatusBadge } from '~/components/status-badge';
import { listAdminEvents } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export default async function EventsPage() {
  const { items } = await listAdminEvents();
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Eventos</h1>
        <Link
          href="/events/new"
          className="rounded bg-[color:var(--color-accent)] px-3 py-2 text-sm font-semibold"
        >
          Novo evento
        </Link>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
              <th className="py-2">Título</th>
              <th>Status</th>
              <th>Data</th>
              <th>Cidade</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="border-b border-[color:var(--color-border)]">
                <td className="py-2">
                  <Link href={`/events/${e.id}`} className="hover:underline">
                    {e.title}
                  </Link>
                  <div className="text-xs text-[color:var(--color-muted)]">{e.slug}</div>
                </td>
                <td>
                  <StatusBadge status={e.status} />
                </td>
                <td className="text-sm">{fmtDate(e.startsAt)}</td>
                <td className="text-sm">
                  {[e.city, e.stateCode].filter(Boolean).join('/') || '—'}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-[color:var(--color-muted)]">
                  Nenhum evento ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
