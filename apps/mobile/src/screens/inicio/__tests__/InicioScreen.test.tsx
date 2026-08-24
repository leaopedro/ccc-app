// @vitest-environment jsdom
//
// InicioScreen só decide entre três estados de autenticação. GuestHome e
// MemberHome são stubados: o comportamento de cada um tem teste próprio.
// O que vale pinar aqui é que o membro NÃO vê a vitrine, e que o anônimo NÃO
// vê a home do membro, sem flicker durante o carregamento da sessão.
//
// Deviation from the task-12 brief's Step 6 sample: that sample imports
// `Text` from the real `react-native` package with no mock. Under vitest
// that package fails to even parse (`Parse failure: Expected 'from', got
// 'typeOf'`) — the same root cause MemberHome.test.tsx documents ("vitest
// can't transform the real package's ESM build under jsdom"). Added the
// same per-file `vi.mock('react-native', ...)` every other test in this
// plan carries, so the genuine RED below is the missing-file import error,
// not an unrelated environment parse error.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { style, testID, ...rest } = props;
      const aria: Record<string, unknown> = {};
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (style && typeof style === 'object') aria['data-style'] = JSON.stringify(style);
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    View: make('div'),
    Text: make('span'),
    StyleSheet: {
      create: <T,>(s: T): T => s,
      flatten: <T,>(s: T): T => s,
      absoluteFill: {},
    },
  };
});

const { Text } = await import('react-native');

const authState = vi.hoisted(() => ({
  status: 'unauthenticated' as 'loading' | 'unauthenticated' | 'authenticated',
}));

vi.mock('~/auth/context', () => ({
  useAuth: () => authState,
}));

vi.mock('~/screens/inicio/GuestHome', () => ({
  GuestHome: () => <Text>GUEST_HOME</Text>,
}));

vi.mock('~/screens/inicio/MemberHome', () => ({
  MemberHome: () => <Text>MEMBER_HOME</Text>,
}));

const InicioScreen = (await import('../InicioScreen')).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () => act(() => root.render(<InicioScreen />));

describe('InicioScreen', () => {
  it('renders the guest showcase for an anonymous visitor', () => {
    authState.status = 'unauthenticated';
    render();
    expect(container.textContent).toContain('GUEST_HOME');
    expect(container.textContent).not.toContain('MEMBER_HOME');
  });

  it('renders the member home for an authenticated member', () => {
    authState.status = 'authenticated';
    render();
    expect(container.textContent).toContain('MEMBER_HOME');
    expect(container.textContent).not.toContain('GUEST_HOME');
  });

  it('renders neither variant while the session is still loading', () => {
    authState.status = 'loading';
    render();
    expect(container.textContent).not.toContain('GUEST_HOME');
    expect(container.textContent).not.toContain('MEMBER_HOME');
    expect(container.querySelector('[data-testid="inicio-auth-pending"]')).not.toBeNull();
  });
});
