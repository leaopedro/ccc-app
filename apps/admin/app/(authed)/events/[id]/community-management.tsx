'use client';

import type { FeedBanResponse, ModerationQueueItem, ReportResponse } from '@ccc/shared/feed';
import { PremiumBadge } from '@ccc/ui/web';
import React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createFeedBanAction,
  deleteFeedBanAction,
  dismissReportAction,
  moderateFeedItemAction,
  resolveReportAction,
} from '~/lib/community-management-actions';

const initial = { error: null };

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-xs font-semibold disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  );
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString('pt-BR');
const canRestore = (status: string) => status === 'hidden' || status === 'removed';

const ItemModerationActions = ({
  eventId,
  kind,
  itemId,
  status,
}: {
  eventId: string;
  kind: 'post' | 'comment';
  itemId: string;
  status: string;
}) => {
  const [state, action] = useActionState(
    moderateFeedItemAction.bind(null, eventId, kind, itemId),
    initial,
  );

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <form action={action}>
          <input type="hidden" name="action" value="hide" />
          <Submit label="Ocultar" />
        </form>
        <form action={action}>
          <input type="hidden" name="action" value="remove" />
          <Submit label="Remover" />
        </form>
        {canRestore(status) ? (
          <form action={action}>
            <input type="hidden" name="action" value="restore" />
            <Submit label="Restaurar" />
          </form>
        ) : null}
      </div>
      {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
    </div>
  );
};

const ReportActions = ({ eventId, reportId }: { eventId: string; reportId: string }) => {
  const [resolveState, resolveAction] = useActionState(
    resolveReportAction.bind(null, eventId, reportId),
    initial,
  );
  const [dismissState, dismissAction] = useActionState(
    dismissReportAction.bind(null, eventId, reportId),
    initial,
  );

  return (
    <>
      <form action={resolveAction} className="mt-2">
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="sr-only">Resolução</span>
            <input
              name="resolution"
              placeholder="Resolução"
              className="w-full rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
              required
            />
          </label>
          <Submit label="Resolver" />
        </div>
      </form>
      {resolveState.error ? (
        <p className="mt-1 text-sm text-red-400">{resolveState.error}</p>
      ) : null}
      <form action={dismissAction} className="mt-2">
        <button
          type="submit"
          className="rounded border border-[color:var(--color-border)] px-3 py-1 text-xs"
        >
          Dispensar
        </button>
      </form>
      {dismissState.error ? (
        <p className="mt-1 text-sm text-red-400">{dismissState.error}</p>
      ) : null}
    </>
  );
};

const RemoveBanAction = ({ eventId, banId }: { eventId: string; banId: string }) => {
  const [state, action] = useActionState(deleteFeedBanAction.bind(null, eventId, banId), initial);
  return (
    <>
      <form action={action} className="mt-2">
        <button
          type="submit"
          className="rounded border border-red-600 px-2 py-1 text-xs text-red-400"
        >
          Remover
        </button>
      </form>
      {state.error ? <p className="mt-1 text-sm text-red-400">{state.error}</p> : null}
    </>
  );
};

export const CommunityManagement = ({
  eventId,
  queue,
  reports,
  bans,
}: {
  eventId: string;
  queue: ModerationQueueItem[];
  reports: ReportResponse[];
  bans: FeedBanResponse[];
}) => {
  const [banState, banAction] = useActionState(createFeedBanAction.bind(null, eventId), initial);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Moderação de Comunidade</h2>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-medium">Fila de moderação</h3>
        {queue.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Nenhum item na fila.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.map((item) => (
              <li
                key={`${item.kind}-${item.id}`}
                className="rounded border border-[color:var(--color-border)] p-3"
              >
                <p className="text-sm">
                  <span className="font-medium">
                    {item.kind === 'post' ? 'Post' : 'Comentário'}:
                  </span>{' '}
                  {item.body}
                </p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted)]">
                  <span>
                    Autor: {item.authorName ?? 'Anônimo'}
                    {item.carNickname ? ` · ${item.carNickname}` : ''} · {fmtDate(item.createdAt)} ·
                    denúncias abertas: {item.openReportCount}
                  </span>
                  <PremiumBadge isPremiumActive={item.isPremiumActive} />
                </p>
                <ItemModerationActions
                  eventId={eventId}
                  kind={item.kind}
                  itemId={item.id}
                  status={item.status}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-medium">Denúncias</h3>
        {reports.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Sem denúncias abertas.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reports.map((report) => (
              <li key={report.id} className="rounded border border-[color:var(--color-border)] p-3">
                <p className="text-sm">
                  <span className="font-medium">{report.targetKind}</span> #{report.targetId}
                </p>
                <p className="text-sm">{report.reason}</p>
                <p className="text-xs text-[color:var(--color-muted)]">
                  Por: {report.reporterName ?? 'anônimo'} · {fmtDate(report.createdAt)}
                </p>
                <ReportActions eventId={eventId} reportId={report.id} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-medium">Banimentos</h3>
        <form
          action={banAction}
          className="flex flex-col gap-2 rounded border border-[color:var(--color-border)] p-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">ID do usuário</span>
            <input
              name="userId"
              required
              className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Escopo</span>
            <select
              name="scope"
              defaultValue="view"
              className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
            >
              <option value="view">Visualizar</option>
              <option value="post">Publicar</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Motivo (opcional)</span>
            <input
              name="reason"
              className="rounded border border-[color:var(--color-border)] bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <Submit label="Adicionar banimento" />
        </form>
        {banState.error ? <p className="text-sm text-red-400">{banState.error}</p> : null}
        {bans.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Sem banimentos ativos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bans.map((ban) => (
              <li
                key={ban.id}
                className="flex flex-col rounded border border-[color:var(--color-border)] p-3"
              >
                <p className="text-sm">
                  <span className="font-medium">{ban.userName ?? ban.userId}</span> · {ban.scope}
                </p>
                <p className="text-xs text-[color:var(--color-muted)]">
                  Motivo: {ban.reason ?? '—'} · criado em {fmtDate(ban.createdAt)}
                </p>
                <RemoveBanAction eventId={eventId} banId={ban.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
