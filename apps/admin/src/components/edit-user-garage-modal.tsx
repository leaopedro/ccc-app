'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { patchAdminUserGarageAction } from '~/lib/admin-garage-actions';

const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

interface Props {
  userId: string;
  current: {
    name: string;
    slug: string;
    description: string | null;
    isPublic: boolean;
  };
}

export function EditUserGarageModal({ userId, current }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(current.name);
  const [slug, setSlug] = useState(current.slug);
  const [description, setDescription] = useState(current.description ?? '');
  const [isPublic, setIsPublic] = useState(current.isPublic);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    setName(current.name);
    setSlug(current.slug);
    setDescription(current.description ?? '');
    setIsPublic(current.isPublic);
  }, [current]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const submit = () => {
    const input: {
      name?: string;
      slug?: string;
      description?: string | null;
      isPublic?: boolean;
    } = {};
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    const trimmedDesc = description.trim();
    const nextDesc = trimmedDesc === '' ? null : trimmedDesc;
    if (trimmedName !== current.name) input.name = trimmedName;
    if (trimmedSlug !== current.slug) input.slug = trimmedSlug;
    if (nextDesc !== (current.description ?? null)) input.description = nextDesc;
    if (isPublic !== current.isPublic) input.isPublic = isPublic;

    if (Object.keys(input).length === 0) {
      close();
      return;
    }

    startTransition(async () => {
      setError(null);
      const res = await patchAdminUserGarageAction(userId, input);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-border)]"
      >
        Editar garagem
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={close} />
      <div
        role="dialog"
        aria-modal={true}
        aria-labelledby="edit-garage-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-6 shadow-2xl"
      >
        <h2 id="edit-garage-title" className="mb-4 text-lg font-semibold">
          Editar garagem
        </h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Nome</span>
            <input
              autoFocus
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">
              Slug (admin override — qualquer caractere)
            </span>
            <input
              maxLength={40}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[color:var(--color-muted)]">Descrição</span>
            <textarea
              maxLength={500}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            Pública (/g/:slug visível)
          </label>

          {error ? (
            <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={close}
              className="rounded border border-[color:var(--color-border)] px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={submit}
              className="rounded bg-[color:var(--color-accent)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
