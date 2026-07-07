import { GeneralSettingsForm } from './general-settings-form';

import { readRole } from '~/lib/auth-session';
import { fetchAdminGeneralSettings } from '~/lib/general-settings-actions';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesPage() {
  const role = await readRole();

  if (role === 'staff') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Acesso restrito</h1>
          <p className="mt-2 text-[color:var(--color-muted)]">
            Você não tem permissão para acessar esta página.
          </p>
        </div>
      </div>
    );
  }

  const settings = await fetchAdminGeneralSettings();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Configurações gerais</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Define como o app público exibe disponibilidade de eventos, ingressos, extras e produtos.
        </p>
      </header>
      <GeneralSettingsForm initial={settings} />
    </div>
  );
}
