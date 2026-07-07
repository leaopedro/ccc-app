'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { createCollectionAction, type CollectionFormState } from '~/lib/collection-actions';

const initial: CollectionFormState = { error: null };

const Submit = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-semibold disabled:opacity-50"
    >
      {pending ? 'Criando…' : 'Criar coleção'}
    </button>
  );
};

export default function NewCollectionPage() {
  const [state, action] = useActionState(createCollectionAction, initial);
  const v = state.values ?? {};

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-bold">Nova coleção</h1>
      <form action={action} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Slug</span>
          <input
            name="slug"
            required
            placeholder="drift-2026"
            defaultValue={v.slug ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Nome</span>
          <input
            name="name"
            required
            placeholder="Drift 2026"
            defaultValue={v.name ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[color:var(--color-muted)]">Descrição</span>
          <textarea
            name="description"
            rows={4}
            defaultValue={v.description ?? ''}
            className="rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked />
          <span className="text-sm">Ativa</span>
        </label>
        {state.error ? (
          <p role="alert" className="text-sm text-red-500">
            {state.error}
          </p>
        ) : null}
        <Submit />
      </form>
    </section>
  );
}
