import Link from 'next/link';

import { listCheckInEvents } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const formatWindow = (startsAtIso: string, endsAtIso: string): string => {
  const start = new Date(startsAtIso);
  const end = new Date(endsAtIso);
  const date = start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const startTime = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${startTime}–${endTime}`;
};

export default async function CheckInIndexPage() {
  const { items } = await listCheckInEvents();

  if (items.length === 0) {
    return (
      <section>
        <h1 className="mb-4 text-2xl font-semibold">Check-in</h1>
        <p className="opacity-80">Nenhum evento disponível para check-in no momento.</p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Check-in</h1>
      <p className="mb-4 opacity-80">Escolha o evento que você está operando.</p>
      <ul className="flex flex-col gap-2">
        {items.map((event) => (
          <li key={event.id}>
            <Link
              href={`/check-in/${event.id}`}
              className="flex flex-col rounded border border-[color:var(--color-border)] p-4 hover:opacity-80"
            >
              <span className="font-semibold">{event.title}</span>
              <span className="text-sm opacity-80">
                {formatWindow(event.startsAt, event.endsAt)} · {event.venueName ?? '—'} ·{' '}
                {event.city ?? '—'}/{event.stateCode ?? '—'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
