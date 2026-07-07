import Link from 'next/link';

import { CollectionReorder } from './reorder-client';

import { listAdminCollections } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function CollectionsPage() {
  const { items } = await listAdminCollections();

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Coleções</h1>
        <Link
          href="/loja/colecoes/new"
          className="rounded bg-[color:var(--color-accent)] px-3 py-2 text-sm font-semibold"
        >
          Nova coleção
        </Link>
      </header>
      {items.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)]">Nenhuma coleção cadastrada.</p>
      ) : (
        <CollectionReorder items={items} />
      )}
    </section>
  );
}
