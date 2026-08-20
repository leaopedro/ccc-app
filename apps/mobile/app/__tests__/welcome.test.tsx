// @vitest-environment jsdom
//
// Task 14: /welcome became a historic alias. The screen now lives at the
// /inicio tab route inside the (app) group (active tab state, history and
// back behaviour). /welcome must redirect there instead of rendering the
// screen directly, so old deep links, e-mails and any already-persisted
// next=/welcome keep working.

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

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <Text>{`REDIRECT:${href}`}</Text>,
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
  it('redirects to /inicio and renders nothing else', () => {
    // Catches: /welcome reverting to rendering InicioScreen directly (or
    // redirecting anywhere but /inicio), which would give the anonymous
    // and member home a route outside the tab group again, losing the
    // active-tab state the new /inicio tab is meant to provide.
    act(() => root.render(<WelcomeRoute />));
    expect(container.textContent).toBe('REDIRECT:/inicio');
  });
});
