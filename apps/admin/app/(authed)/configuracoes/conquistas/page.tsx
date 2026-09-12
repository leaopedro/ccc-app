import { GamificationCopyForm } from '../gamification-copy-form';

import { readRole } from '~/lib/auth-session';
import { fetchAdminGamificationCopy } from '~/lib/gamification-copy-actions';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesConquistasPage() {
  const role = await readRole();

  // A API por tras desta pagina exige role admin. O layout so bloqueia staff,
  // entao um organizer chegaria aqui e a chamada abaixo devolveria 403 sem
  // tratamento. Barra aqui, com a mesma tela de recusa do layout.
  if (role !== 'admin') {
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

  const copy = await fetchAdminGamificationCopy();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Conquistas e níveis</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Nome e descrição das conquistas e nome dos níveis. A alteração aparece no próximo
          carregamento da garagem, sem publicar versão nova.
        </p>
      </header>
      <GamificationCopyForm initial={copy} />
    </div>
  );
}
