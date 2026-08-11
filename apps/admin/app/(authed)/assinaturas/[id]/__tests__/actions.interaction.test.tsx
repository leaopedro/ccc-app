// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssinaturaActionResult } from '~/lib/assinaturas-actions';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

// Tipar os mocks com a assinatura real evita que os wrappers do factory
// devolvam `any` (regra no-unsafe-return) e mantem os mockResolvedValue
// presos ao contrato das actions.
type ActionMock = (...args: unknown[]) => Promise<AssinaturaActionResult>;

const cancelSubscriptionAction = vi.fn<ActionMock>();
const resumeSubscriptionAction = vi.fn<ActionMock>();
const pauseSubscriptionAction = vi.fn<ActionMock>();
const changePlanAction = vi.fn<ActionMock>();
const detachAddonAction = vi.fn<ActionMock>();

vi.mock('~/lib/assinaturas-actions', () => ({
  cancelSubscriptionAction: (...a: unknown[]) => cancelSubscriptionAction(...a),
  resumeSubscriptionAction: (...a: unknown[]) => resumeSubscriptionAction(...a),
  pauseSubscriptionAction: (...a: unknown[]) => pauseSubscriptionAction(...a),
  changePlanAction: (...a: unknown[]) => changePlanAction(...a),
  attachAddonAction: vi.fn(),
  detachAddonAction: (...a: unknown[]) => detachAddonAction(...a),
}));

const { StatusActions } = await import('../status-actions');
const { PlanActions } = await import('../plan-actions');
const { AddonsPanel } = await import('../addons-panel');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const click = async (testId: string) => {
  const el = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing ${testId}`);
  await act(async () => {
    el.click();
    await Promise.resolve();
  });
};

describe('StatusActions', () => {
  it('cancela, mostra aviso de pendente e chama refresh', async () => {
    cancelSubscriptionAction.mockResolvedValue({ ok: true, pending: true });
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="active" />);
      await Promise.resolve();
    });

    await click('assinaturas-acao-cancelar');

    expect(cancelSubscriptionAction).toHaveBeenCalledWith('mem-1');
    expect(refresh).toHaveBeenCalled();
    expect(container.textContent).toContain('enviada');
  });

  it('mostra o erro devolvido pela action', async () => {
    cancelSubscriptionAction.mockResolvedValue({ ok: false, error: 'assinatura Apple' });
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="active" />);
      await Promise.resolve();
    });

    await click('assinaturas-acao-cancelar');

    expect(container.textContent).toContain('assinatura Apple');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('desabilita tudo quando mutable e falso', async () => {
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={false} status="active" />);
      await Promise.resolve();
    });
    // status="active" renders both Cancelar and Pausar (Retomar is not
    // applicable for this status). Assert every rendered action button is
    // disabled, not just one, so dropping `disabled` from any of them fails
    // this test regardless of which button it is.
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[data-testid^="assinaturas-acao-"]'),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
    }
  });

  it('mostra retomar em vez de cancelar quando cancel_scheduled', async () => {
    resumeSubscriptionAction.mockResolvedValue({ ok: true, pending: true });
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="cancel_scheduled" />);
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="assinaturas-acao-cancelar"]')).toBeNull();
    await click('assinaturas-acao-retomar');
    expect(resumeSubscriptionAction).toHaveBeenCalledWith('mem-1');
  });

  it('mostra retomar quando paused e nao mostra pausar', async () => {
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="paused" />);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="assinaturas-acao-retomar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="assinaturas-acao-pausar"]')).toBeNull();
  });
});

describe('PlanActions', () => {
  it('envia tier e cadence selecionados', async () => {
    changePlanAction.mockResolvedValue({ ok: true, pending: true });
    await act(async () => {
      root.render(
        <PlanActions
          membershipId="mem-1"
          mutable={true}
          status="active"
          currentTier="gold"
          currentCadence="monthly"
        />,
      );
      await Promise.resolve();
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="assinaturas-plano-tier"]',
    );
    await act(async () => {
      select!.value = 'silver';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    await click('assinaturas-acao-trocar-plano');

    expect(changePlanAction).toHaveBeenCalledWith('mem-1', 'silver', 'monthly');
  });

  it('avisa sobre rateio na proxima fatura', async () => {
    await act(async () => {
      root.render(
        <PlanActions
          membershipId="mem-1"
          mutable={true}
          status="active"
          currentTier="gold"
          currentCadence="monthly"
        />,
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain('próxima fatura');
  });

  it('desabilita os controles quando o status nao permite troca de plano', async () => {
    await act(async () => {
      root.render(
        <PlanActions
          membershipId="mem-1"
          mutable={true}
          status="trialing"
          currentTier="gold"
          currentCadence="monthly"
        />,
      );
      await Promise.resolve();
    });

    const tierSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="assinaturas-plano-tier"]',
    );
    const cadenceSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="assinaturas-plano-cadencia"]',
    );
    const submit = container.querySelector<HTMLButtonElement>(
      '[data-testid="assinaturas-acao-trocar-plano"]',
    );

    expect(tierSelect?.disabled).toBe(true);
    expect(cadenceSelect?.disabled).toBe(true);
    expect(submit?.disabled).toBe(true);
  });
});

describe('AddonsPanel', () => {
  it('desabilita os controles quando o status nao permite vincular/remover modulo', async () => {
    await act(async () => {
      root.render(
        <AddonsPanel
          membershipId="mem-1"
          mutable={true}
          status="paused"
          attachedKeys={['track-days']}
          moduleOptions={[{ key: 'valet', name: 'Valet' }]}
        />,
      );
      await Promise.resolve();
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="assinaturas-modulo-select"]',
    );
    const attachButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="assinaturas-acao-vincular-modulo"]',
    );
    const detachButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="assinaturas-acao-remover-modulo-track-days"]',
    );

    expect(select?.disabled).toBe(true);
    expect(attachButton?.disabled).toBe(true);
    expect(detachButton?.disabled).toBe(true);
  });
});
