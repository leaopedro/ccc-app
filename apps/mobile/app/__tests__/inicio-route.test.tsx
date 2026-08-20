// @vitest-environment jsdom
//
// Task 14: /inicio is the tab route inside the (app) group. It must render
// InicioScreen and nothing else, so a future edit can't quietly reintroduce
// screen logic into the route file (same guard as welcome.test.tsx from
// task-12 Step 9). InicioScreen itself is stubbed — its own behaviour is
// covered by src/screens/inicio/__tests__/InicioScreen.test.tsx.

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

const InicioTabRoute = (await import('../(app)/inicio')).default;

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

describe('InicioTabRoute', () => {
  it('renders InicioScreen and nothing else', () => {
    // Catches: reintroducing screen logic (fetches, conditionals, extra
    // markup) directly into the route file instead of delegating to
    // InicioScreen.
    act(() => root.render(<InicioTabRoute />));
    expect(container.textContent).toBe('INICIO_SCREEN');
  });
});
