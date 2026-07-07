import { StoreSettingsForm } from '../../configuracoes/store-settings-form';

import { readRole } from '~/lib/auth-session';
import { fetchAdminStoreSettings } from '~/lib/store-settings-actions';

export const StoreSettingsPage = async () => {
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

  const settings = await fetchAdminStoreSettings();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Configurações da loja</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Frete padrão, limite de estoque baixo e textos de retirada local. Aplicam-se a todos os
          produtos.
        </p>
      </header>
      <StoreSettingsForm initial={settings} />
    </div>
  );
};
