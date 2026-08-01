// @vitest-environment jsdom
//
// BuySpotSheet tests. Mirrors the CoverPickerSheet/IdentityCard pattern:
// react-native primitives + Modal are stubbed to plain HTML tags so jsdom can
// render them; `react-native-svg` is mocked because `@ccc/ui`'s barrel
// re-exports `ParkingStallCard` which imports SVG primitives.

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
        accessibilityViewIsModal,
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        source,
        resizeMode,
        animationType,
        transparent,
        onRequestClose,
        contentContainerStyle,
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
      if (
        source &&
        typeof source === 'object' &&
        typeof (source as { uri?: unknown }).uri === 'string'
      ) {
        aria['data-src'] = (source as { uri: string }).uri;
      }
      void style;
      void hitSlop;
      void numberOfLines;
      void resizeMode;
      void animationType;
      void transparent;
      void onRequestClose;
      void accessibilityViewIsModal;
      void contentContainerStyle;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });

  const Modal = ReactMod.forwardRef(
    (props: Record<string, unknown>, ref: unknown): React.ReactElement | null => {
      const { visible, children, testID, ...rest } = props as {
        visible?: boolean;
        children?: React.ReactNode;
        testID?: string;
      };
      if (!visible) return null;
      const aria: Record<string, unknown> = {};
      if (typeof testID === 'string') aria['data-testid'] = testID;
      void rest;
      return ReactMod.createElement('div', { ref, ...aria }, children);
    },
  );

  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    Image: make('img'),
    ScrollView: make('div'),
    Modal,
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

const findButtonByA11y = (root: HTMLElement, label: string): HTMLButtonElement => {
  const btns = Array.from(root.querySelectorAll('button'));
  const found = btns.find((b) => b.getAttribute('aria-label') === label);
  if (!found) throw new Error(`button with aria-label "${label}" not found`);
  return found;
};

describe('BuySpotSheet', () => {
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

  it('renders title, line item, price, and the 3 bullet lines when visible', async () => {
    const { BuySpotSheet } = await import('../BuySpotSheet');
    await renderEl(
      <BuySpotSheet
        visible
        priceLabel="R$ 9,90"
        onClose={() => undefined}
        onCheckoutPix={() => undefined}
        onCheckoutCard={() => undefined}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Comprar vaga adicional');
    expect(text).toContain('Vaga adicional');
    expect(text).toContain('+1 espaço permanente na sua garagem.');
    expect(text).toContain('R$ 9,90');
    expect(text).toContain('Pagamento único (não é assinatura).');
    expect(text).toContain('A vaga aparece em até 60s após a confirmação.');
    expect(text).toContain('Você volta para a garagem automaticamente.');
    expect(text).toContain('Você pode cancelar antes de finalizar o pagamento.');
  });

  it('fires onCheckoutPix when the Pix CTA is tapped', async () => {
    const { BuySpotSheet } = await import('../BuySpotSheet');
    const onCheckoutPix = vi.fn();
    await renderEl(
      <BuySpotSheet
        visible
        priceLabel="R$ 9,90"
        onClose={() => undefined}
        onCheckoutPix={onCheckoutPix}
        onCheckoutCard={() => undefined}
      />,
    );
    const btn = findButtonByA11y(container, 'Pagar com Pix');
    await act(async () => {
      btn.click();
      await flush();
    });
    expect(onCheckoutPix).toHaveBeenCalledTimes(1);
  });

  it('fires onCheckoutCard when the Cartão CTA is tapped', async () => {
    const { BuySpotSheet } = await import('../BuySpotSheet');
    const onCheckoutCard = vi.fn();
    await renderEl(
      <BuySpotSheet
        visible
        priceLabel="R$ 9,90"
        onClose={() => undefined}
        onCheckoutPix={() => undefined}
        onCheckoutCard={onCheckoutCard}
      />,
    );
    const btn = findButtonByA11y(container, 'Pagar com cartão');
    await act(async () => {
      btn.click();
      await flush();
    });
    expect(onCheckoutCard).toHaveBeenCalledTimes(1);
  });

  it('marks both CTAs aria-disabled when submitting=true', async () => {
    const { BuySpotSheet } = await import('../BuySpotSheet');
    await renderEl(
      <BuySpotSheet
        visible
        priceLabel="R$ 9,90"
        submitting
        onClose={() => undefined}
        onCheckoutPix={() => undefined}
        onCheckoutCard={() => undefined}
      />,
    );
    const pix = findButtonByA11y(container, 'Pagar com Pix');
    const card = findButtonByA11y(container, 'Pagar com cartão');
    expect(pix.getAttribute('aria-disabled')).toBe('true');
    expect(card.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not fire CTA handlers when submitting=true', async () => {
    const { BuySpotSheet } = await import('../BuySpotSheet');
    const onCheckoutPix = vi.fn();
    const onCheckoutCard = vi.fn();
    await renderEl(
      <BuySpotSheet
        visible
        priceLabel="R$ 9,90"
        submitting
        onClose={() => undefined}
        onCheckoutPix={onCheckoutPix}
        onCheckoutCard={onCheckoutCard}
      />,
    );
    const pix = findButtonByA11y(container, 'Pagar com Pix');
    const card = findButtonByA11y(container, 'Pagar com cartão');
    await act(async () => {
      pix.click();
      card.click();
      await flush();
    });
    expect(onCheckoutPix).not.toHaveBeenCalled();
    expect(onCheckoutCard).not.toHaveBeenCalled();
  });

  it('fires onClose when the SheetShell close affordance is tapped', async () => {
    const { BuySpotSheet } = await import('../BuySpotSheet');
    const onClose = vi.fn();
    await renderEl(
      <BuySpotSheet
        visible
        priceLabel="R$ 9,90"
        onClose={onClose}
        onCheckoutPix={() => undefined}
        onCheckoutCard={() => undefined}
      />,
    );
    // SheetShell renders two pressables with aria-label "Fechar" — the
    // backdrop and the explicit ✕ button. Either should close.
    const closers = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.getAttribute('aria-label') === 'Fechar',
    );
    expect(closers.length).toBeGreaterThan(0);
    await act(async () => {
      closers[0]!.click();
      await flush();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when visible=false (Modal mock returns null)', async () => {
    const { BuySpotSheet } = await import('../BuySpotSheet');
    await renderEl(
      <BuySpotSheet
        visible={false}
        priceLabel="R$ 9,90"
        onClose={() => undefined}
        onCheckoutPix={() => undefined}
        onCheckoutCard={() => undefined}
      />,
    );
    expect(container.textContent ?? '').toBe('');
  });
});
