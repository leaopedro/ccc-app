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

describe('VagasSectionHeader', () => {
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

  it('renders GRÁTIS mode when under the free limit', async () => {
    const { VagasSectionHeader } = await import('../VagasSectionHeader');
    await renderEl(
      <VagasSectionHeader carCount={1} freeLimit={3} isUnlimited={false} hasExtra={false} />,
    );
    expect(container.textContent).toContain(garageCopy.garage.sectionVagasTitle);
    expect(container.textContent).toContain('1/3');
    expect(container.textContent).toContain(garageCopy.garage.sectionVagasMode.gratis);
    expect(container.textContent).not.toContain(garageCopy.garage.sectionVagasMode.gratisExtra);
  });

  it('renders GRÁTIS + EXTRA when hasExtra is true', async () => {
    const { VagasSectionHeader } = await import('../VagasSectionHeader');
    await renderEl(<VagasSectionHeader carCount={4} freeLimit={3} isUnlimited={false} hasExtra />);
    expect(container.textContent).toContain(garageCopy.garage.sectionVagasMode.gratisExtra);
    expect(container.textContent).toContain('4/3');
  });

  it('renders NO LIMITE when carCount === freeLimit and no extras', async () => {
    const { VagasSectionHeader } = await import('../VagasSectionHeader');
    await renderEl(
      <VagasSectionHeader carCount={3} freeLimit={3} isUnlimited={false} hasExtra={false} />,
    );
    expect(container.textContent).toContain(garageCopy.garage.sectionVagasMode.atCap);
    expect(container.textContent).toContain('3/3');
  });

  it('renders ILIMITADO + ∞ denom when isUnlimited', async () => {
    const { VagasSectionHeader } = await import('../VagasSectionHeader');
    await renderEl(
      <VagasSectionHeader carCount={7} freeLimit={null} isUnlimited hasExtra={false} />,
    );
    expect(container.textContent).toContain(garageCopy.garage.sectionVagasMode.unlimited);
    expect(container.textContent).toContain(`7/${garageCopy.garage.sectionVagasUnlimitedDenom}`);
  });

  it('renders ILIMITADO (not GRÁTIS + EXTRA) when both isUnlimited and hasExtra are true', async () => {
    const { VagasSectionHeader } = await import('../VagasSectionHeader');
    await renderEl(<VagasSectionHeader carCount={9} freeLimit={null} isUnlimited hasExtra />);
    expect(container.textContent).toContain(garageCopy.garage.sectionVagasMode.unlimited);
    expect(container.textContent).not.toContain(garageCopy.garage.sectionVagasMode.gratisExtra);
    expect(container.textContent).toContain(`9/${garageCopy.garage.sectionVagasUnlimitedDenom}`);
  });

  it('renders — when freeLimit is null and not unlimited', async () => {
    const { VagasSectionHeader } = await import('../VagasSectionHeader');
    await renderEl(
      <VagasSectionHeader carCount={0} freeLimit={null} isUnlimited={false} hasExtra={false} />,
    );
    expect(container.textContent).toContain(`0/${garageCopy.garage.sectionVagasUnknownDenom}`);
  });
});
