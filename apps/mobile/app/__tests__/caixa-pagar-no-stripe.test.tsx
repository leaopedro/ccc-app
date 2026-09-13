// @vitest-environment jsdom
//
// Tela de pagamento da caixa SEM chave publicavel. Gemeo de
// caixa-pagar-card.test.tsx: `vi.mock('expo-constants')` e hoisted por modulo,
// entao os dois valores da chave nao coexistem no mesmo arquivo — o repo ja
// separa payment-screen-wiring de cart-checkout-stripe-unavailable pelo mesmo
// motivo.
//
// Sem chave nao ha PaymentSheet para montar, e a caixa nao tem hosted
// checkout. Logo nao ha o que escolher: a tela vai direto pro Pix.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoxCheckoutResponse } from '@ccc/shared/box';
import type { PaymentSheetOutcome } from '~/payments/payment-sheet';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } },
}));

const checkoutMock =
  vi.fn<(method?: 'pix' | 'card') => Promise<{ result: string; data?: BoxCheckoutResponse }>>();
vi.mock('~/hooks/useBoxPay', () => ({
  useBoxPay: () => ({ checkout: checkoutMock, loading: false }),
}));

const pollState = { status: 'polling' as string };
const retryMock = vi.fn();
vi.mock('~/hooks/useBoxPaymentPoll', () => ({
  useBoxPaymentPoll: () => ({ status: pollState.status, retry: retryMock }),
}));

const payMock = vi.fn<(clientSecret: string) => Promise<PaymentSheetOutcome>>();
vi.mock('~/payments/payment-sheet', () => ({
  usePaymentSheet: () => ({ pay: (clientSecret: string) => payMock(clientSecret) }),
}));

const routerReplaceMock = vi.fn();
vi.mock('expo-router', () => ({
  router: {
    replace: routerReplaceMock,
    push: vi.fn(),
    back: vi.fn(),
    canGoBack: () => true,
  },
}));

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => true) }));

vi.mock('~/components/HiddenQR', async () => {
  const ReactMod = await import('react');
  return { HiddenQR: () => ReactMod.createElement('div', { 'data-testid': 'qr' }) };
});

vi.mock('~/screens/caixa/CaixaSkeleton', async () => {
  const ReactMod = await import('react');
  return { CaixaSkeleton: () => ReactMod.createElement('div', { 'data-testid': 'skeleton' }) };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('lucide-react-native', async () => {
  const ReactMod = await import('react');
  const icon = () => ReactMod.createElement('span');
  return { ArrowLeft: icon };
});

vi.mock('@ccc/ui', async () => {
  const ReactMod = await import('react');
  return {
    Button: ({ label, onPress }: { label: string; onPress?: () => void }) =>
      ReactMod.createElement('button', { onClick: onPress, type: 'button' }, label),
    Text: ({ children }: { children?: unknown }) =>
      ReactMod.createElement('span', null, children as never),
  };
});

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityRole,
        accessibilityState,
        testID,
        onPress,
        hitSlop,
        contentContainerStyle,
        numberOfLines,
        size,
        color,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void className;
      void accessibilityState;
      void hitSlop;
      void contentContainerStyle;
      void numberOfLines;
      void size;
      void color;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    View: make('div'),
    Text: make('span'),
    Pressable: make('div'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    Platform: { OS: 'ios' },
    StyleSheet: { create: (s: unknown) => s },
  };
});

const { caixaCopy } = await import('~/copy/caixa');

const pixResponse: BoxCheckoutResponse = {
  method: 'pix',
  brCode: '00020126-BR',
  amountCents: 2000,
  expiresAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
};

describe('caixa/pagar sem chave publicavel', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    const { default: Screen } = await import('../(app)/caixa/pagar');
    await act(async () => {
      root.render(<Screen />);
      await flush();
    });
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    checkoutMock.mockReset();
    payMock.mockReset();
    retryMock.mockReset();
    routerReplaceMock.mockReset();
    pollState.status = 'polling';
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it('pula o seletor e chama checkout("pix") no mount', async () => {
    checkoutMock.mockResolvedValue({ result: 'ok', data: pixResponse });

    await render();

    expect(checkoutMock).toHaveBeenCalledWith('pix');
    expect(container.textContent).toContain('00020126-BR');
  });

  it('nunca renderiza o seletor', async () => {
    checkoutMock.mockResolvedValue({ result: 'ok', data: pixResponse });

    await render();

    expect(container.textContent).not.toContain(caixaCopy.pay.methodTitle);
    expect(payMock).not.toHaveBeenCalled();
  });
});
