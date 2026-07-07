import { BroadcastComposer } from './broadcast-composer';
import { RecentBroadcasts } from './recent-broadcasts';

import { listAdminBroadcasts, listAdminEvents, lookupAdminStoreProducts } from '~/lib/admin-api';
import { readRole } from '~/lib/auth-session';

export const dynamic = 'force-dynamic';

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR');

export default async function BroadcastsPage() {
  const role = await readRole();

  if (role === 'staff') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Acesso restrito</h1>
          <p className="mt-2 text-[color:var(--color-muted)]">
            Você não tem permissão para acessar esta página.
          </p>
        </div>
      </div>
    );
  }

  const [{ broadcasts }, { items: events }, { items: products }] = await Promise.all([
    listAdminBroadcasts(),
    listAdminEvents(),
    lookupAdminStoreProducts(),
  ]);

  const totalSent = broadcasts.reduce((sum, item) => sum + item.sentCount, 0);
  const totalFailed = broadcasts.reduce((sum, item) => sum + item.failedCount, 0);
  const scheduledCount = broadcasts.filter((item) => item.status === 'scheduled').length;
  const latestCreatedAt = broadcasts[0]?.createdAt ?? null;

  const eventOptions = events
    .map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
    }))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  const productOptions = products
    .map((product) => ({
      id: product.id,
      title: product.title,
      slug: product.slug,
      status: product.status,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Broadcasts</h1>
        <p className="max-w-3xl text-sm text-[color:var(--color-muted)]">
          Dispare avisos para toda a base, membros premium, participantes de um evento ou uma cidade
          específica. Escolha se a entrega fica só na central ou na central com push e valide o
          alcance antes de enviar.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-[color:var(--color-border)] p-4">
          <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
            Broadcasts recentes
          </p>
          <p className="mt-2 text-2xl font-semibold">{broadcasts.length}</p>
        </div>
        <div className="rounded-lg border border-[color:var(--color-border)] p-4">
          <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
            Entregas enviadas
          </p>
          <p className="mt-2 text-2xl font-semibold">{totalSent}</p>
        </div>
        <div className="rounded-lg border border-[color:var(--color-border)] p-4">
          <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
            Falhas acumuladas
          </p>
          <p className="mt-2 text-2xl font-semibold">{totalFailed}</p>
        </div>
        <div className="rounded-lg border border-[color:var(--color-border)] p-4">
          <p className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
            Agendados
          </p>
          <p className="mt-2 text-2xl font-semibold">{scheduledCount}</p>
          <p className="mt-1 text-xs text-[color:var(--color-muted)]">
            {latestCreatedAt
              ? `Último criado em ${fmtDateTime(latestCreatedAt)}`
              : 'Sem histórico.'}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <BroadcastComposer
          key={`${broadcasts.length}:${latestCreatedAt ?? 'empty'}`}
          events={eventOptions}
          products={productOptions}
        />
        <RecentBroadcasts broadcasts={broadcasts} events={eventOptions} products={productOptions} />
      </div>
    </section>
  );
}
