import { getPresaleSettings } from '~/lib/admin-api';
import { PresaleSettingsClient } from './presale-settings-client';
import { PresaleOrderSearch } from './presale-order-search';

export const dynamic = 'force-dynamic';

export default async function PreVendaPage() {
  const settings = await getPresaleSettings();

  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Pre-venda Casa In Box</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Configuracoes da campanha e busca de pedidos por email do convidado.
        </p>
      </header>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Configuracoes</h2>
        <PresaleSettingsClient settings={settings} />
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Buscar pedido</h2>
        <PresaleOrderSearch />
      </div>
    </section>
  );
}
