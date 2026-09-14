import { useEffect } from 'react';

/**
 * Hold da celebração. Enquanto a contagem for maior que zero, o overlay de
 * conquista espera.
 *
 * Por que não uma lista de rotas: o PaymentSheet da Stripe é apresentado
 * imperativamente e `usePathname` não muda enquanto ele está aberto, então
 * roteador é o sinal errado por natureza. E `SheetShell` usa `Modal`, que é
 * janela nativa separada — o overlay sobe ATRÁS de toda folha do app,
 * inclusive da `BadgesSheet`. Cada ponto que chama daqui é chokepoint único,
 * então a cobertura não sai de sincronia quando alguém adiciona uma tela.
 */
let holds = 0;
const listeners = new Set<(held: boolean) => void>();

const emit = (): void => {
  const held = holds > 0;
  for (const l of listeners) l(held);
};

export const acquireCelebrationHold = (): (() => void) => {
  holds += 1;
  if (holds === 1) emit();
  let released = false;
  return () => {
    // Idempotente: um `release` chamado duas vezes não pode derrubar o hold
    // de outro dono.
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) emit();
  };
};

export const isCelebrationHeld = (): boolean => holds > 0;

export const subscribeCelebrationHold = (l: (held: boolean) => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Segura enquanto `active` for verdadeiro, e libera no unmount. */
export const useCelebrationHold = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;
    const release = acquireCelebrationHold();
    return release;
  }, [active]);
};
