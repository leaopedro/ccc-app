import { BoxPartnersClient } from './box-partners-client';

import { getBoxPartners } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function BoxParceirosPage() {
  const data = await getBoxPartners();
  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Parceiros</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Cada parceiro oferece modulos cobrados a parte do budget.
        </p>
      </header>
      <BoxPartnersClient data={data} />
    </section>
  );
}
