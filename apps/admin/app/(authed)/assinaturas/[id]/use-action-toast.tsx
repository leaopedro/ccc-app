'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { AssinaturaActionResult } from '~/lib/assinaturas-actions';

type Toast = { kind: 'success' | 'error'; message: string } | null;

/**
 * Estado compartilhado pelos tres paineis desta tela.
 *
 * O admin nao tem sistema de toast: o padrao do projeto e um bloco local com
 * role="status" por componente. Aqui os tres paineis vivem na mesma pasta e
 * teriam o bloco identico, entao o hook fica local a esta rota. Nao e uma
 * abstracao nova para o app inteiro.
 */
export function useActionToast() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast>(null);

  const run = useCallback(
    (fn: () => Promise<AssinaturaActionResult>) => {
      startTransition(async () => {
        const result = await fn();
        if (result.ok) {
          setToast({
            kind: 'success',
            message: result.pending
              ? 'Alteração enviada ao provedor. Aparece aqui em instantes.'
              : 'Alteração aplicada.',
          });
          // Sempre relê. Quando pending e true, a tela pode continuar mostrando o
          // valor antigo — isso e a verdade ate o webhook chegar.
          router.refresh();
        } else {
          setToast({ kind: 'error', message: result.error });
        }
        setTimeout(() => setToast(null), 2400);
      });
    },
    [router],
  );

  return { pending, toast, run };
}

export function ActionToast({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 rounded px-4 py-2 text-sm ${
        toast.kind === 'success' ? 'bg-emerald-900 text-emerald-200' : 'bg-red-900 text-red-200'
      }`}
      data-testid="assinaturas-toast"
    >
      {toast.message}
    </div>
  );
}
