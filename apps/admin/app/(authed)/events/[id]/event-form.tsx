'use client';

import type { AdminEventDetail } from '@ccc/shared/admin';
import { BRAZIL_STATE_CODES } from '@ccc/shared/profile';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { CoverUploader } from '~/components/cover-uploader';
import { DateTimeField } from '~/components/date-time-field';
import {
  cancelEventAction,
  publishEventAction,
  unpublishEventAction,
  updateEventAction,
  type EventFormState,
} from '~/lib/event-actions';

const initial: EventFormState = { error: null };

const Submit = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
    >
      {pending ? '…' : label}
    </button>
  );
};

const StatusActionButton = ({ label, className }: { label: string; className?: string }) => {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? '…' : label}
    </button>
  );
};

const isoToLocal = (iso: string) => iso.slice(0, 16);
const isChecked = (value: string | undefined, fallback = false) =>
  value ? value === 'on' || value === 'true' : fallback;

export const EventForm = ({ event }: { event: AdminEventDetail }) => {
  const [state, action] = useActionState(updateEventAction.bind(null, event.id), initial);
  const [publishState, publishAction] = useActionState(
    publishEventAction.bind(null, event.id),
    initial,
  );
  const [unpublishState, unpublishAction] = useActionState(
    unpublishEventAction.bind(null, event.id),
    initial,
  );
  const [cancelState, cancelAction] = useActionState(
    cancelEventAction.bind(null, event.id),
    initial,
  );
  const values = state.values ?? {};
  const statusError = publishState.error ?? unpublishState.error ?? cancelState.error;
  const hasPersistedCover = Boolean(event.coverObjectKey);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {event.status === 'draft' ? (
            <>
              <form action={publishAction}>
                <StatusActionButton
                  label="Publicar"
                  className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
                />
              </form>
              <form action={cancelAction}>
                <StatusActionButton
                  label="Cancelar evento"
                  className="rounded border border-red-700 px-3 py-2 text-sm text-red-400 disabled:opacity-50"
                />
              </form>
            </>
          ) : null}
          {event.status === 'published' ? (
            <>
              <form action={unpublishAction}>
                <StatusActionButton
                  label="Despublicar"
                  className="rounded border border-[color:var(--color-border)] px-4 py-2 font-semibold disabled:opacity-50"
                />
              </form>
              <form action={cancelAction}>
                <StatusActionButton
                  label="Cancelar evento"
                  className="rounded border border-red-700 px-3 py-2 text-sm text-red-400 disabled:opacity-50"
                />
              </form>
            </>
          ) : null}
          {event.status === 'cancelled' ? (
            <form action={publishAction}>
              <StatusActionButton
                label="Publicar novamente"
                className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
              />
            </form>
          ) : null}
        </div>
        {event.status === 'draft' && !hasPersistedCover ? (
          <p className="text-xs text-[color:var(--color-muted)]">
            Adicione e salve uma capa antes de publicar o evento.
          </p>
        ) : null}
        {event.status === 'draft' &&
        !event.tiers.some(
          (t) =>
            t.isPremiumGrantable &&
            (t.salesCloseAt == null || new Date(t.salesCloseAt) > new Date()),
        ) ? (
          <p className="text-xs text-amber-400">
            Nenhum nível concede acesso premium; membros não receberão ticket automático.
          </p>
        ) : null}
        {statusError ? <p className="text-sm text-red-400">{statusError}</p> : null}
      </div>

      <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Título</span>
          <input
            name="title"
            defaultValue={values.title ?? event.title}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <div className="sm:col-span-2">
          <CoverUploader
            initialKey={values.coverObjectKey ?? event.coverObjectKey}
            initialUrl={event.coverUrl}
          />
        </div>
        <label className="sm:col-span-2 flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Descrição</span>
          <textarea
            name="description"
            defaultValue={values.description ?? event.description}
            rows={5}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <DateTimeField
          label="Início"
          name="startsAt"
          defaultValue={values.startsAt ?? isoToLocal(event.startsAt)}
        />
        <DateTimeField
          label="Fim"
          name="endsAt"
          defaultValue={values.endsAt ?? isoToLocal(event.endsAt)}
        />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Local (opcional)</span>
          <input
            name="venueName"
            defaultValue={values.venueName ?? event.venueName ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Endereço (opcional)</span>
          <input
            name="venueAddress"
            defaultValue={values.venueAddress ?? event.venueAddress ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Cidade (opcional)</span>
          <input
            name="city"
            defaultValue={values.city ?? event.city ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Estado (opcional)</span>
          <select
            name="stateCode"
            defaultValue={values.stateCode ?? event.stateCode ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          >
            <option value="">—</option>
            {BRAZIL_STATE_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Tipo</span>
          <select
            name="type"
            defaultValue={values.type ?? event.type}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          >
            <option value="meeting">Encontro</option>
            <option value="drift">Drift</option>
            <option value="other">Outro</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Capacidade</span>
          <input
            name="capacity"
            type="number"
            min={0}
            defaultValue={values.capacity ?? event.capacity}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">
            Máx. ingressos por usuário
          </span>
          <input
            name="maxTicketsPerUser"
            type="number"
            min={1}
            placeholder="Sem limite"
            defaultValue={values.maxTicketsPerUser ?? event.maxTicketsPerUser ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
          <span className="text-xs text-[color:var(--color-muted)]">
            Deixe em branco para não limitar.
          </span>
        </label>
        <section className="sm:col-span-2 flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-3">
          <h2 className="text-lg font-semibold">Feed da comunidade</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="feedEnabled"
              defaultChecked={isChecked(values.feedEnabled, event.feedEnabled)}
            />
            Ativar feed
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[color:var(--color-muted)]">Acesso de leitura</span>
            <select
              name="feedAccess"
              defaultValue={values.feedAccess ?? event.feedAccess}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
            >
              <option value="public">Público</option>
              <option value="attendees">Participantes</option>
              <option value="members_only">Só membros</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[color:var(--color-muted)]">Acesso de postagem</span>
            <select
              name="postingAccess"
              defaultValue={values.postingAccess ?? event.postingAccess}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
            >
              <option value="attendees">Participantes</option>
              <option value="members_only">Só membros</option>
              <option value="organizers_only">Apenas organizadores</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[color:var(--color-muted)]">Máx. posts por usuário</span>
            <input
              name="maxPostsPerUser"
              type="number"
              min={1}
              placeholder="Sem limite"
              defaultValue={values.maxPostsPerUser ?? event.maxPostsPerUser ?? ''}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[color:var(--color-muted)]">Máx. fotos por post</span>
            <input
              name="maxPhotosPerUser"
              type="number"
              min={1}
              defaultValue={values.maxPhotosPerUser ?? String(event.maxPhotosPerUser)}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
            />
          </label>
        </section>
        {state.error ? <p className="sm:col-span-2 text-sm text-red-400">{state.error}</p> : null}
        <div className="sm:col-span-2">
          <Submit label="Salvar" />
        </div>
      </form>
    </div>
  );
};
