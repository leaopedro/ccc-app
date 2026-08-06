import { PremiumCatalogClient } from './premium-catalog-client';

import { getAdminPremiumCatalog } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function PremiumPage() {
  const catalog = await getAdminPremiumCatalog();
  return (
    <section className="flex flex-col gap-8" data-accent="ccc">
      <header>
        <h1 className="text-2xl font-bold">Catálogo premium</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Planos por tier, preços, benefícios e módulos adicionais. Os ids de provedor
          (Stripe/RevenueCat) só aparecem aqui, nunca nas rotas públicas.
        </p>
      </header>
      <PremiumCatalogClient catalog={catalog} />
    </section>
  );
}
