'use client';

import { BRAZIL_STATE_CODES } from '@jdm/shared/profile';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { CoverUploader } from '~/components/cover-uploader';
import { DateTimeField } from '~/components/date-time-field';
import { createEventAction, type EventFormState } from '~/lib/event-actions';

const initial: EventFormState = { error: null };

// Pre-fill start = today 19:00, end = today 22:00 in the local timezone, in
// the "YYYY-MM-DDTHH:MM" format that <input type="datetime-local"> expects.
const defaultDateTimes = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { starts: `${date}T19:00`, ends: `${date}T22:00` };
};

const Submit = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
    >
      {pending ? 'Criando…' : 'Criar evento'}
    </button>
  );
};

const isChecked = (value: string | undefined, fallback = true) =>
  value ? value === 'on' || value === 'true' : fallback;

const Field = ({
  label,
  name,
  type = 'text',
  defaultValue,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'defaultValue'>) => (
  <label className="flex flex-col gap-1">
    <span className="text-sm text-[color:var(--color-muted)]">{label}</span>
    <input
      name={name}
      type={type}
      defaultValue={defaultValue}
      {...rest}
      className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
    />
  </label>
);

export default function NewEventPage() {
  const [state, action] = useActionState(createEventAction, initial);
  const defaults = defaultDateTimes();
  const v = state.values ?? {};

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Novo evento</h1>
      <form action={action} className="grid grid-cols-2 gap-4">
        <Field
          label="Slug"
          name="slug"
          required
          placeholder="encontro-sp-maio"
          defaultValue={v.slug ?? ''}
        />
        <Field label="Título" name="title" required defaultValue={v.title ?? ''} />
        <div className="col-span-2">
          <CoverUploader initialKey={v.coverObjectKey ?? null} initialUrl={null} />
        </div>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Descrição</span>
          <textarea
            name="description"
            required
            rows={5}
            defaultValue={v.description ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <DateTimeField
          label="Início"
          name="startsAt"
          required
          defaultValue={v.startsAt ?? defaults.starts}
        />
        <DateTimeField
          label="Fim"
          name="endsAt"
          required
          defaultValue={v.endsAt ?? defaults.ends}
        />
        <Field label="Local (opcional)" name="venueName" defaultValue={v.venueName ?? ''} />
        <Field
          label="Endereço (opcional)"
          name="venueAddress"
          defaultValue={v.venueAddress ?? ''}
        />
        <Field label="Cidade (opcional)" name="city" defaultValue={v.city ?? ''} />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Estado (opcional)</span>
          <select
            name="stateCode"
            defaultValue={v.stateCode ?? ''}
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
            required
            defaultValue={v.type ?? 'meeting'}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          >
            <option value="meeting">Encontro</option>
            <option value="drift">Drift</option>
            <option value="other">Outro</option>
          </select>
        </label>
        <Field
          label="Capacidade"
          name="capacity"
          type="number"
          min={0}
          required
          defaultValue={v.capacity ?? ''}
        />
        <Field
          label="Máx. ingressos por usuário (em branco = sem limite)"
          name="maxTicketsPerUser"
          type="number"
          min={1}
          placeholder="Sem limite"
          defaultValue={v.maxTicketsPerUser ?? ''}
        />
        <div className="col-span-2 flex flex-col gap-3 rounded border border-[color:var(--color-border)] p-3">
          <h2 className="text-lg font-semibold">Feed da comunidade</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="feedEnabled" defaultChecked={isChecked(v.feedEnabled)} />
            Ativar feed
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[color:var(--color-muted)]">Acesso de leitura</span>
            <select
              name="feedAccess"
              defaultValue={v.feedAccess ?? 'attendees'}
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
              defaultValue={v.postingAccess ?? 'attendees'}
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
              defaultValue={v.maxPostsPerUser ?? ''}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-[color:var(--color-muted)]">Máx. fotos por post</span>
            <input
              name="maxPhotosPerUser"
              type="number"
              min={1}
              defaultValue={v.maxPhotosPerUser ?? '5'}
              className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
            />
          </label>
        </div>
        {state.error ? <p className="col-span-2 text-sm text-red-400">{state.error}</p> : null}
        <div className="col-span-2">
          <Submit />
        </div>
      </form>
    </section>
  );
}
