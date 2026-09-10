import { HomeContentForm } from '../home-content-form';

import { fetchAdminHomeContent } from '~/lib/home-content-actions';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesHomePage() {
  const content = await fetchAdminHomeContent();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Conteúdo da Início</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Texto e imagens da primeira tela do app. A alteração aparece no próximo carregamento da
          tela, sem publicar versão nova.
        </p>
      </header>
      <HomeContentForm initial={content} />
    </div>
  );
}
