import Link from 'next/link';

import { NewProductForm } from './new-product-form';

import { listAdminProductTypes } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const { items: productTypes } = await listAdminProductTypes();

  if (productTypes.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Novo produto</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Cadastre um tipo de produto antes de criar um produto.{' '}
          <Link className="underline" href="/loja/tipos">
            Gerenciar tipos de produto
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Novo produto</h1>
      <NewProductForm productTypes={productTypes} />
    </section>
  );
}
