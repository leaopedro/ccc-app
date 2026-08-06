// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const cancelSubscriptionAction = vi.fn();
const resumeSubscriptionAction = vi.fn();
const pauseSubscriptionAction = vi.fn();
const changePlanAction = vi.fn();
const detachAddonAction = vi.fn();

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
  });
};

describe('StatusActions', () => {
  it('cancela, mostra aviso de pendente e chama refresh', async () => {
    cancelSubscriptionAction.mockResolvedValue({ ok: true, pending: true });
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="active" />);
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
    });

    await click('assinaturas-acao-cancelar');

    expect(container.textContent).toContain('assinatura Apple');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('desabilita tudo quando mutable e falso', async () => {
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={false} status="active" />);
    });
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="assinaturas-acao-cancelar"]',
    );
    expect(btn?.disabled).toBe(true);
  });

  it('mostra retomar em vez de cancelar quando cancel_scheduled', async () => {
    resumeSubscriptionAction.mockResolvedValue({ ok: true, pending: true });
    await act(async () => {
      root.render(
        <StatusActions membershipId="mem-1" mutable={true} status="cancel_scheduled" />,
      );
    });

    expect(
      container.querySelector('[data-testid="assinaturas-acao-cancelar"]'),
    ).toBeNull();
    await click('assinaturas-acao-retomar');
    expect(resumeSubscriptionAction).toHaveBeenCalledWith('mem-1');
  });

  it('mostra retomar quando paused e nao mostra pausar', async () => {
    await act(async () => {
      root.render(<StatusActions membershipId="mem-1" mutable={true} status="paused" />);
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
          currentTier="gold"
          currentCadence="monthly"
        />,
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="assinaturas-plano-tier"]',
    );
    await act(async () => {
      select!.value = 'silver';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
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
          currentTier="gold"
          currentCadence="monthly"
        />,
      );
    });
    expect(container.textContent).toContain('próxima fatura');
  });
});
