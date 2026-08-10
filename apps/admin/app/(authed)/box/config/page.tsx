import { BoxSettingsClient } from './box-settings-client';

import { getBoxSettings } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function BoxConfigPage() {
  const settings = await getBoxSettings();
  return (
    <section className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Configuracoes do box</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Cutoff, frete e textos. Frete gratis por faixa de CEP (Curitiba e regiao).
        </p>
      </header>
      <BoxSettingsClient settings={settings} />
    </section>
  );
}
