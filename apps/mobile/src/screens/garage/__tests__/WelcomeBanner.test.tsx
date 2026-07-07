// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { garageCopy } from '~/copy/garage';

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
      void style;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    View: make('div'),
    Text: make('span'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('WelcomeBanner', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderEl = async (el: React.ReactElement) => {
    await act(async () => {
      root.render(el);
      await flush();
    });
  };

  it('renders the welcome title, glyph, and unlimited body when freeLimit is null', async () => {
    const { WelcomeBanner } = await import('../WelcomeBanner');
    await renderEl(<WelcomeBanner freeLimit={null} />);
    expect(container.textContent).toContain(garageCopy.garage.welcomeTitle);
    expect(container.textContent).toContain(garageCopy.garage.welcomeBody(null));
    expect(container.textContent).toContain(garageCopy.garage.welcomeGlyph);
  });

  it('singularizes "vaga grátis" when freeLimit === 1', async () => {
    const { WelcomeBanner } = await import('../WelcomeBanner');
    await renderEl(<WelcomeBanner freeLimit={1} />);
    expect(container.textContent).toContain(garageCopy.garage.welcomeBody(1));
    expect(container.textContent).not.toContain(garageCopy.garage.welcomeBody(2));
  });

  it('pluralizes "vagas grátis" when freeLimit > 1', async () => {
    const { WelcomeBanner } = await import('../WelcomeBanner');
    await renderEl(<WelcomeBanner freeLimit={3} />);
    expect(container.textContent).toContain(garageCopy.garage.welcomeBody(3));
  });
});
