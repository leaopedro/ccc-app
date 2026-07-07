import type { SupportTicketInternalStatus } from '@jdm/shared/support';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getAdminSupportTicket } from '~/lib/admin-api';
import { closeSupportTicketAction, updateInternalStatusAction } from '~/lib/support-actions';

export const dynamic = 'force-dynamic';

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

const INTERNAL_STATUS_LABELS: Record<SupportTicketInternalStatus, string> = {
  unread: 'Não lido',
  seen: 'Visto',
  in_progress: 'Em andamento',
  done: 'Resolvido',
};

const INTERNAL_STATUS_OPTIONS: SupportTicketInternalStatus[] = [
  'unread',
  'seen',
  'in_progress',
  'done',
];

export default async function SupportTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let ticket;
  try {
    ticket = await getAdminSupportTicket(id);
  } catch {
    notFound();
  }

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-4">
        <Link href="/support" className="text-sm opacity-60 hover:opacity-100">
          ← Suporte
        </Link>
        <h1 className="text-2xl font-bold">Chamado</h1>
        <span
          className={`ml-auto rounded px-2 py-1 text-xs font-semibold ${
            ticket.status === 'open' ? 'bg-green-900 text-green-200' : 'bg-zinc-700 text-zinc-300'
          }`}
        >
          {ticket.status === 'open' ? 'Aberto' : 'Fechado'}
        </span>
      </header>

      <div className="flex flex-col gap-4 rounded border border-[color:var(--color-border)] p-4">
        <div>
          <span className="text-xs text-[color:var(--color-muted)]">Usuário</span>
          <div className="font-medium">{ticket.user.name}</div>
          <div className="text-sm text-[color:var(--color-muted)]">{ticket.user.email}</div>
        </div>
        <div>
          <span className="text-xs text-[color:var(--color-muted)]">Telefone</span>
          <div className="font-mono">{ticket.phone}</div>
        </div>
        <div>
          <span className="text-xs text-[color:var(--color-muted)]">Mensagem</span>
          <div className="whitespace-pre-wrap">{ticket.message}</div>
        </div>
        {ticket.attachmentUrl && (
          <div>
            <span className="text-xs text-[color:var(--color-muted)]">Anexo</span>
            <div className="mt-1">
              <a
                href={ticket.attachmentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline"
              >
                Ver imagem
              </a>
            </div>
          </div>
        )}
        <div className="flex gap-6 text-sm text-[color:var(--color-muted)]">
          <div>Criado: {fmtDate(ticket.createdAt)}</div>
          {ticket.closedAt && <div>Fechado: {fmtDate(ticket.closedAt)}</div>}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-[color:var(--color-muted)]">Status interno:</span>
        <div className="flex gap-2">
          {INTERNAL_STATUS_OPTIONS.map((s) => (
            <form key={s} action={updateInternalStatusAction.bind(null, ticket.id, s)}>
              <button
                type="submit"
                className={`rounded px-3 py-1 text-xs font-medium ${
                  ticket.internalStatus === s
                    ? 'bg-blue-700 text-white'
                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                {INTERNAL_STATUS_LABELS[s]}
              </button>
            </form>
          ))}
        </div>
      </div>

      {ticket.status === 'open' && (
        <form action={closeSupportTicketAction.bind(null, ticket.id)}>
          <button type="submit" className="rounded bg-zinc-700 px-4 py-2 text-sm hover:bg-zinc-600">
            Fechar chamado
          </button>
        </form>
      )}
    </section>
  );
}
