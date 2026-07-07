'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useRef } from 'react';

export function SearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = inputRef.current?.value.trim() ?? '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    router.push(`/users${params.toString() ? `?${params}` : ''}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        ref={inputRef}
        name="q"
        type="search"
        placeholder="Buscar por nome ou email..."
        defaultValue={searchParams.get('q') ?? ''}
        className="flex-1 rounded border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[color:var(--color-muted)] focus:border-[color:var(--color-accent)]"
      />
      <button
        type="submit"
        className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold"
      >
        Buscar
      </button>
    </form>
  );
}
