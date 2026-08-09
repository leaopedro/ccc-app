import { BoxCatalogClient } from './box-catalog-client';

import { getBoxCatalog } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function BoxCatalogoPage() {
  const catalog = await getBoxCatalog();
  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Catalogo do box</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Itens que o assinante escolhe dentro do budget mensal.
        </p>
      </header>
      <BoxCatalogClient catalog={catalog} />
    </section>
  );
}
