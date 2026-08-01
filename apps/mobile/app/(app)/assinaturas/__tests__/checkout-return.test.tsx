// @vitest-environment jsdom
//
// Web-only checkout-return route. Stripe drops the member here after a
// successful Checkout Session, but the `invoice.paid` webhook that actually
// provisions the membership is asynchronous — landing here never proves
// activation. This pins the two outcomes of the poll that pollSubscription
// Active (Task 12, tested separately) resolves to: active now, or not yet.
//
// pollSubscriptionActive is mocked so the suite doesn't sleep up to 30s
// (15 attempts * 2s) waiting on the real poller.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assinaturasCopy } from '~/copy/assinaturas';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const pollSubscriptionActive = vi.fn<() => Promise<boolean>>();
const routerReplace = vi.fn();

vi.mock('~/screens/assinaturas/poll-subscription', () => ({
  pollSubscriptionActive: () => pollSubscriptionActive(),
}));

vi.mock('expo-router', () => ({
  router: { replace: routerReplace },
}));

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { style, accessibilityLabel, accessibilityRole, testID, onPress, color, ...rest } =
        props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void color;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ActivityIndicator: make('div'),
    StyleSheet: {
      create: <T,>(s: T): T => s,
    },
  };
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('checkout-return route', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    pollSubscriptionActive.mockReset();
    routerReplace.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  const renderRoute = async () => {
    const { default: CheckoutReturnRoute } = await import('../checkout-return');
    await act(async () => {
      root.render(<CheckoutReturnRoute />);
      await flush();
    });
  };

  const text = () => container.textContent ?? '';

  // 1. Poll resolves true -> navigate straight to minha-assinatura, no
  // pending UI ever shown. Fails if the `if (active)` branch is dropped or
  // inverted (a paid member would get stuck on the pending screen instead of
  // landing on their subscription).
  it('navigates to minha-assinatura when the poll resolves active', async () => {
    pollSubscriptionActive.mockResolvedValue(true);
    await renderRoute();

    expect(pollSubscriptionActive).toHaveBeenCalledTimes(1);
    expect(routerReplace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
    expect(text()).not.toContain(assinaturasCopy.contratar.pendingTitle);
  });

  // 2. Poll resolves false -> pending state renders (webhook still in
  // flight), and its CTA is a real way forward to the same destination.
  // Fails if `setPending(true)` stops firing on a false resolve (member
  // stuck on the spinner forever) or if the pending CTA's onPress is
  // dropped/miswired (dead-end screen with no way forward).
  it('renders the pending state and navigates via its CTA when the poll resolves inactive', async () => {
    pollSubscriptionActive.mockResolvedValue(false);
    await renderRoute();

    expect(text()).toContain(assinaturasCopy.contratar.pendingTitle);
    expect(text()).toContain(assinaturasCopy.contratar.pendingSubcopy);
    expect(routerReplace).not.toHaveBeenCalled();

    const pendingCta = container.querySelector(
      '[data-testid="checkout-return-pending-cta"]',
    ) as HTMLElement;
    if (!pendingCta) throw new Error('pending CTA not rendered');

    await act(async () => {
      pendingCta.click();
      await flush();
    });

    expect(routerReplace).toHaveBeenCalledWith('/assinaturas/minha-assinatura');
  });
});
