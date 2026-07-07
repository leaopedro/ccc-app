import { notFound } from 'next/navigation';

import { CollectionEditor } from './editor-client';

import { getAdminCollection, listAdminStoreProducts } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';

export const dynamic = 'force-dynamic';

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let collection;
  try {
    collection = await getAdminCollection(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const products = await listAdminStoreProducts();
  const availableProducts = products.items.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status,
  }));

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">{collection.name}</h1>
        <p className="text-sm text-[color:var(--color-muted)]">{collection.slug}</p>
      </header>
      <CollectionEditor collection={collection} availableProducts={availableProducts} />
    </section>
  );
}
