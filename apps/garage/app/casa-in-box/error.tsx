'use client';

import { useEffect } from 'react';

import { presaleCopy } from '~/copy/presale';

// Fronteira de erro só para /casa-in-box, não app/error.tsx global: o único
// throw de renderização conhecido nesta árvore é `classifyTier` (slug de
// produto fora da allowlist, components/presale/selection.ts) e ele só
// acontece dentro desta página, a que cobra dinheiro. (garage) e (legal)
// não têm fronteira própria ainda, mas nenhuma delas lança em render hoje —
// ampliar o escopo agora seria consertar um problema que não existe.
//
// apps/garage não tem @sentry/* (diferente de apps/admin e apps/api, que
// têm) — console.error é o canal de operador disponível aqui. A copy visível
// nunca inclui `error.message`/stack: a mensagem de slug desconhecido cita
// constantes internas (PRESALE_TIER_SLUGS) que não são para o comprador ver.
export default function CasaInBoxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[casa-in-box] falha ao renderizar a página de pré-venda:', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-fg text-lg font-bold">{presaleCopy.pageError.title}</h1>
      <p className="text-muted max-w-xs text-sm leading-relaxed">{presaleCopy.pageError.body}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded bg-accent px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-deep"
      >
        {presaleCopy.pageError.retryCta}
      </button>
    </main>
  );
}
