// @vitest-environment jsdom
//
// welcome.tsx is a thin route wrapper (task-12 Step 9): it must render
// InicioScreen and nothing else, so a future edit can't quietly reintroduce
// screen logic into the route file. InicioScreen itself is stubbed — its
// own behaviour is covered by src/screens/inicio/__tests__/InicioScreen.test.tsx.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      ReactMod.createElement(tag, { ...props, ref }),
    );
  return { Text: make('span'), View: make('div') };
});

vi.mock('~/screens/inicio/InicioScreen', () => ({
  default: () => <Text>INICIO_SCREEN</Text>,
}));

const WelcomeRoute = (await import('../welcome')).default;

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

describe('WelcomeRoute', () => {
  it('renders InicioScreen and nothing else', () => {
    act(() => root.render(<WelcomeRoute />));
    expect(container.textContent).toBe('INICIO_SCREEN');
  });
});
