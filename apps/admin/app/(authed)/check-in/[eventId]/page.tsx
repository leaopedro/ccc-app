import { notFound } from 'next/navigation';

import { Scanner } from './scanner';

import { listCheckInEvents } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function CheckInScannerPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { items } = await listCheckInEvents();
  const event = items.find((e) => e.id === eventId);
  if (!event) notFound();

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold">Check-in · {event.title}</h1>
      <p className="mb-4 opacity-80">
        {event.venueName ?? '—'} · {event.city ?? '—'}/{event.stateCode ?? '—'}
      </p>
      <Scanner eventId={event.id} />
    </section>
  );
}
