// @vitest-environment jsdom
//
// Tela de pagamento da caixa COM chave publicavel: o seletor aparece e o ramo
// do cartao existe. O cenario sem chave mora em caixa-pagar-no-stripe.test.tsx,
// porque `vi.mock('expo-constants')` e hoisted por modulo e os dois valores nao
// coexistem no mesmo arquivo.
//
// Este arquivo tambem trava as armadilhas que a revisao do desenho encontrou:
// o ramo do cartao nao pode vir antes dos ramos de `status` (senao a tela de
// sucesso fica inalcancavel e um erro do poll prende o usuario), o retry do
// checkout tem de carregar o metodo escolhido, e um toque duplo nao pode abrir
// duas PaymentSheets.

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
  default: { expoConfig: { extra: { stripePublishableKey: 'pk_test_1' } } },
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

const byRole = (container: HTMLElement, role: string, text: string): HTMLElement => {
  const match = Array.from(container.querySelectorAll(`[role="${role}"]`)).find((el) =>
    el.textContent?.includes(text),
  );
  if (!match) throw new Error(`no ${role} containing "${text}"`);
  return match as HTMLElement;
};

const findButton = (container: HTMLElement, text: string): HTMLButtonElement => {
  const match = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!match) throw new Error(`no button containing "${text}"`);
  return match;
};

const cardResponse: BoxCheckoutResponse = {
  method: 'card',
  clientSecret: 'cs_1',
  amountCents: 2000,
  expiresAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
};

const pixResponse: BoxCheckoutResponse = {
  method: 'pix',
  brCode: '00020126-BR',
  amountCents: 2000,
  expiresAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
};

describe('caixa/pagar com chave publicavel', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    const { default: Screen } = await import('../(app)/caixa/pagar');
    await act(async () => {
      root.render(<Screen />);
      await flush();
    });
  };

  const press = async (el: HTMLElement) => {
    await act(async () => {
      el.click();
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

  it('mostra o seletor no mount, sem chamar checkout', async () => {
    await render();

    expect(container.textContent).toContain(caixaCopy.pay.methodTitle);
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it('escolher cartao chama checkout("card") e abre a PaymentSheet', async () => {
    checkoutMock.mockResolvedValue({ result: 'ok', data: cardResponse });
    payMock.mockResolvedValue({ kind: 'paid' });
    await render();

    await press(byRole(container, 'radio', caixaCopy.pay.methodCard));

    expect(checkoutMock).toHaveBeenCalledWith('card');
    expect(payMock).toHaveBeenCalledWith('cs_1');
  });

  it('escolher pix renderiza o brCode e nunca chama a sheet', async () => {
    checkoutMock.mockResolvedValue({ result: 'ok', data: pixResponse });
    await render();

    await press(byRole(container, 'radio', caixaCopy.pay.methodPix));

    expect(checkoutMock).toHaveBeenCalledWith('pix');
    expect(payMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('00020126-BR');
  });

  it('sheet cancelada mostra a mensagem e NAO e tratada como erro', async () => {
    checkoutMock.mockResolvedValue({ result: 'ok', data: cardResponse });
    payMock.mockResolvedValue({ kind: 'cancelled' });
    await render();

    await press(byRole(container, 'radio', caixaCopy.pay.methodCard));

    expect(container.textContent).toContain(caixaCopy.pay.sheetCancelled);
    expect(container.textContent).not.toContain(caixaCopy.pay.error);
  });

  it('sheet falhada mostra a mensagem de falha', async () => {
    checkoutMock.mockResolvedValue({ result: 'ok', data: cardResponse });
    payMock.mockResolvedValue({ kind: 'failed' });
    await render();

    await press(byRole(container, 'radio', caixaCopy.pay.methodCard));

    expect(container.textContent).toContain(caixaCopy.pay.sheetFailed);
  });

  it('sheet paga com poll pendente mostra "confirmando", nao o sucesso', async () => {
    checkoutMock.mockResolvedValue({ result: 'ok', data: cardResponse });
    payMock.mockResolvedValue({ kind: 'paid' });
    await render();

    await press(byRole(container, 'radio', caixaCopy.pay.methodCard));

    // Quem vira a Order e o webhook. A tela nunca declara pago por conta.
    expect(container.textContent).toContain(caixaCopy.pay.cardWaiting);
    expect(container.textContent).not.toContain(caixaCopy.pay.success);
  });

  // O caso que o desenho anterior tornava inalcancavel: o ramo do cartao vinha
  // antes dos ramos de `status`, entao cardPhase 'waiting' era terminal.
  it('sheet paga e poll "paid" CHEGA na tela de sucesso', async () => {
    checkoutMock.mockResolvedValue({ result: 'ok', data: cardResponse });
    payMock.mockResolvedValue({ kind: 'paid' });
    // Poll ja liquidado quando a sheet fecha: `status` tem de vencer o spinner
    // do cartao. Com o ramo do cartao na frente, cardPhase 'waiting' era
    // terminal e esta tela era inalcancavel.
    pollState.status = 'paid';
    await render();

    await press(byRole(container, 'radio', caixaCopy.pay.methodCard));

    expect(container.textContent).toContain(caixaCopy.pay.success);
    expect(container.textContent).not.toContain(caixaCopy.pay.cardWaiting);
  });

  // Idem: com o ramo do cartao na frente, um erro do poll (que nao reagenda)
  // ficava escondido atras de um spinner eterno, sem botao de saida.
  it('poll "error" depois da sheet paga mostra o retry, nao um spinner eterno', async () => {
    checkoutMock.mockResolvedValue({ result: 'ok', data: cardResponse });
    payMock.mockResolvedValue({ kind: 'paid' });
    pollState.status = 'error';
    await render();

    await press(byRole(container, 'radio', caixaCopy.pay.methodCard));

    expect(container.textContent).toContain(caixaCopy.pay.error);
    expect(findButton(container, caixaCopy.pay.reconnect)).toBeTruthy();
  });

  it('toque duplo no cartao chama checkout uma vez so', async () => {
    let resolvePay: ((v: PaymentSheetOutcome) => void) | undefined;
    checkoutMock.mockResolvedValue({ result: 'ok', data: cardResponse });
    payMock.mockImplementation(
      () =>
        new Promise<PaymentSheetOutcome>((r) => {
          resolvePay = r;
        }),
    );
    await render();
    const card = byRole(container, 'radio', caixaCopy.pay.methodCard);

    await act(async () => {
      card.click();
      card.click();
      await flush();
    });

    expect(checkoutMock).toHaveBeenCalledTimes(1);
    expect(payMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePay?.({ kind: 'cancelled' });
      await flush();
    });
  });

  // Hardcodar 'pix' aqui cobraria Pix de quem escolheu cartao, e o servidor
  // trava a Order nesse metodo para sempre.
  it('o botao de erro re-tenta com o metodo escolhido', async () => {
    checkoutMock.mockResolvedValue({ result: 'error' });
    await render();

    await press(byRole(container, 'radio', caixaCopy.pay.methodCard));
    expect(container.textContent).toContain(caixaCopy.pay.error);

    checkoutMock.mockClear();
    await press(findButton(container, caixaCopy.pay.reconnect));

    expect(checkoutMock).toHaveBeenCalledWith('card');
  });
});
