import { describe, expect, it } from 'vitest';

import { homeIcon } from '../icons';

describe('homeIcon', () => {
  it('resolves a mapped key to a distinct icon from the Star fallback', () => {
    expect(homeIcon('car')).not.toBe(homeIcon('star'));
  });

  it('falls back to the same icon as the star key for an unknown key', () => {
    expect(homeIcon('chave-que-nao-existe')).toBe(homeIcon('star'));
  });

  it('does not resolve inherited Object.prototype members for prototype-chain keys', () => {
    // HomeBenefit.icon vem de uma coluna de banco editável no admin
    // (z.string().min(1)), sem allowlist. Sem o guard de Object.hasOwn,
    // essas três chaves resolveriam o membro herdado de Object.prototype
    // em vez de cair no fallback, e a tela quebraria ao tentar renderizar
    // um valor que não é um componente.
    expect(homeIcon('constructor')).toBe(homeIcon('star'));
    expect(homeIcon('toString')).toBe(homeIcon('star'));
    expect(homeIcon('valueOf')).toBe(homeIcon('star'));
  });
});
