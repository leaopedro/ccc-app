import { GamificationCopyForm } from '../gamification-copy-form';

import { fetchAdminGamificationCopy } from '~/lib/gamification-copy-actions';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesConquistasPage() {
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
