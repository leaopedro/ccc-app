/**
 * Gatilho imperativo de refetch. Existe para que as telas que CAUSAM uma
 * concessão possam pedir a celebração na hora, sem prop drilling.
 *
 * É o gatilho principal: sem ele, nenhum caminho dispara antes do cron de um
 * minuto do worker, e a média entre a ação e a animação fica em ~30s. Trinta
 * segundos depois de cadastrar um carro, um modal escuro no meio de outra tela
 * não é celebração, é interrupção.
 */
const listeners = new Set<() => void>();

export const requestCelebrationRefresh = (): void => {
  for (const l of listeners) l();
};

export const subscribeCelebrationRefresh = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
