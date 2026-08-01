// @vitest-environment jsdom
//
// IdentityCard tests. Mirrors the pattern in `PremiumBadge.test.tsx`:
// react-native primitives are stubbed to plain HTML tags so jsdom can render
// them; `react-native-svg` is mocked because `@ccc/ui`'s barrel re-exports
// `ParkingStallCard`, which imports SVG primitives.

import type { GarageOwner } from '@ccc/shared/garage';
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
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityHint,
        accessibilityRole,
        accessibilityState,
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityHint === 'string') aria['aria-description'] = accessibilityHint;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      const disabledFlag =
        accessibilityState &&
        typeof accessibilityState === 'object' &&
        (accessibilityState as { disabled?: boolean }).disabled === true;
      if (disabledFlag) aria['aria-disabled'] = 'true';
      if (typeof className === 'string') aria['data-classname'] = className;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void hitSlop;
      void numberOfLines;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
  };
});

vi.mock('react-native-svg', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      ReactMod.createElement(tag, { ref, ...props }),
    );
  return {
    default: make('svg'),
    Svg: make('svg'),
    Defs: make('defs'),
    Pattern: make('pattern'),
    Rect: make('rect'),
    Line: make('line'),
    G: make('g'),
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const baseGarage: GarageOwner = {
  id: 'g1',
  name: 'Minha Garagem',
  slug: 'minha-garagem',
  description: null,
  isPublic: false,
  premiumTier: null,
  premiumUntil: null,
  isPremiumActive: false,
  coverPreset: null,
  coverImageObjectKey: null,
  coverImageUrl: null,
  daysLeftUntilExpiry: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  gamification: { enabled: true },
  badges: [],
};

describe('IdentityCard', () => {
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

  it('renders the garage name + glyph initial', async () => {
    const { IdentityCard } = await import('../IdentityCard');
    await renderEl(<IdentityCard garage={baseGarage} carCount={0} isOwner />);
    expect(container.textContent).toContain('Minha Garagem');
    // First-char glyph
    expect(container.textContent).toContain('M');
    // Pluralization: 0 cars uses CARROS
    expect(container.textContent).toContain('CARROS');
    // Private pill
    expect(container.textContent).toContain('Privada');
  });

  it('singularizes CARRO when carCount === 1', async () => {
    const { IdentityCard } = await import('../IdentityCard');
    await renderEl(<IdentityCard garage={baseGarage} carCount={1} isOwner />);
    expect(container.textContent).toContain('1 CARRO');
    expect(container.textContent).not.toContain('CARROS');
  });

  it('shows Pública pill + share Link button when public + owner', async () => {
    const { IdentityCard } = await import('../IdentityCard');
    const onShare = vi.fn();
    await renderEl(
      <IdentityCard
        garage={{ ...baseGarage, isPublic: true }}
        carCount={2}
        isOwner
        onShare={onShare}
      />,
    );
    expect(container.textContent).toContain('Pública');
    expect(container.textContent).toContain('Link');
  });

  it('shows Compartilhar button when public + non-owner', async () => {
    const { IdentityCard } = await import('../IdentityCard');
    await renderEl(
      <IdentityCard garage={{ ...baseGarage, isPublic: true }} carCount={2} isOwner={false} />,
    );
    expect(container.textContent).toContain('Compartilhar');
    // Edit/Capa buttons are owner-only
    expect(container.textContent).not.toContain('Editar');
    expect(container.textContent).not.toContain('Capa');
  });

  it('omits owner-only buttons when isOwner is false', async () => {
    const { IdentityCard } = await import('../IdentityCard');
    await renderEl(<IdentityCard garage={baseGarage} carCount={0} isOwner={false} />);
    expect(container.textContent).not.toContain('Editar');
    expect(container.textContent).not.toContain('Capa');
    // No pencil affordance either
    expect(container.textContent).not.toContain('✎');
  });

  it('hides the Capa button when owner but no onCoverEdit handler is wired', async () => {
    const { IdentityCard } = await import('../IdentityCard');
    await renderEl(<IdentityCard garage={baseGarage} carCount={0} isOwner onEdit={vi.fn()} />);
    expect(container.textContent).toContain('Editar');
    expect(container.textContent).not.toContain('Capa');
  });

  it('invokes onEdit + onCoverEdit when owner action buttons are tapped', async () => {
    const { IdentityCard } = await import('../IdentityCard');
    const onEdit = vi.fn();
    const onCoverEdit = vi.fn();
    await renderEl(
      <IdentityCard
        garage={baseGarage}
        carCount={0}
        isOwner
        onEdit={onEdit}
        onCoverEdit={onCoverEdit}
      />,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    // First Pressable matching the Capa label
    const cover = buttons.find((b) => b.textContent === 'Capa');
    const edit = buttons.find((b) => b.textContent === 'Editar');
    if (!cover || !edit) throw new Error('owner buttons not rendered');
    await act(async () => {
      cover.click();
      edit.click();
      await flush();
    });
    expect(onCoverEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('renders the premium badge when isPremiumActive', async () => {
    const { IdentityCard } = await import('../IdentityCard');
    await renderEl(
      <IdentityCard
        garage={{ ...baseGarage, isPremiumActive: true, premiumTier: 'gold' }}
        carCount={0}
        isOwner
      />,
    );
    // PremiumBadge renders the tier label (e.g. "Gold")
    expect(container.textContent?.toLowerCase()).toContain('gold');
  });
});
