// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { BadgeCatalogEntry } from '@jdm/shared/badges';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, grantMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  grantMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('~/lib/admin-garage-actions', async () => {
  const actual: object = await vi.importActual('~/lib/admin-garage-actions');
  return {
    ...actual,
    grantAdminUserBadgeAction: grantMock,
  };
});

import { GarageBadgesPanel } from './garage-badges-panel';

const catalog: BadgeCatalogEntry[] = [
  { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag', premiumExclusive: false },
  {
    code: 'CAR-003',
    category: 'carros',
    rarity: 'legendary',
    icon: 'curator',
    premiumExclusive: true,
  },
  {
    code: 'COM-001',
    category: 'comunidade',
    rarity: 'common',
    icon: 'message-square',
    premiumExclusive: false,
  },
];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function findGrantButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter((b) =>
    (b.textContent ?? '').includes('Conceder'),
  );
}

function findConfirmButton(): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Conceder mesmo assim',
    ) ?? null
  );
}

function findCancelButton(): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Cancelar',
    ) ?? null
  );
}

beforeEach(() => {
  refreshMock.mockReset();
  grantMock.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

describe('GarageBadgesPanel — grant non-premium-exclusive badge', () => {
  it('calls grant action without a confirm dialog and refreshes the page', async () => {
    grantMock.mockResolvedValue({ ok: true });
    await act(async () => {
      root.render(
        <GarageBadgesPanel
          userId="u1"
          catalog={catalog}
          earnedCodes={[]}
          isPremiumActive={false}
        />,
      );
      await Promise.resolve();
    });

    // Find EVT-001 grant button. We rely on the panel rendering grant
    // buttons in catalog order, so the first one is EVT-001 (common,
    // not premium-exclusive).
    const buttons = findGrantButtons();
    const evtBtn = buttons[0];
    if (!evtBtn) throw new Error('EVT-001 grant button missing');

    await act(async () => {
      evtBtn.click();
      await Promise.resolve();
    });

    expect(grantMock).toHaveBeenCalledWith('u1', 'EVT-001');
    expect(refreshMock).toHaveBeenCalled();
    // No confirm dialog should be open.
    expect(findConfirmButton()).toBeNull();
  });
});

describe('GarageBadgesPanel — premium-exclusive on non-premium user', () => {
  it('opens a PT-BR confirm dialog and only calls grant after confirmation', async () => {
    grantMock.mockResolvedValue({ ok: true });
    await act(async () => {
      root.render(
        <GarageBadgesPanel
          userId="u1"
          catalog={catalog}
          earnedCodes={[]}
          isPremiumActive={false}
        />,
      );
      await Promise.resolve();
    });

    // The second grant button corresponds to CAR-003 (premium-exclusive).
    const buttons = findGrantButtons();
    const carBtn = buttons[1];
    if (!carBtn) throw new Error('CAR-003 grant button missing');

    await act(async () => {
      carBtn.click();
      await Promise.resolve();
    });

    // Grant has NOT been called yet — confirm dialog should be visible.
    expect(grantMock).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent ?? '').toContain('Exclusivo Premium');
    expect(dialog?.textContent ?? '').toContain('não é Premium');

    // Confirm — now the action runs.
    const confirmBtn = findConfirmButton();
    if (!confirmBtn) throw new Error('Confirm button missing');
    await act(async () => {
      confirmBtn.click();
      await Promise.resolve();
    });

    expect(grantMock).toHaveBeenCalledWith('u1', 'CAR-003');
    expect(refreshMock).toHaveBeenCalled();
  });

  it('cancel closes the dialog without calling the action', async () => {
    await act(async () => {
      root.render(
        <GarageBadgesPanel
          userId="u1"
          catalog={catalog}
          earnedCodes={[]}
          isPremiumActive={false}
        />,
      );
      await Promise.resolve();
    });

    const buttons = findGrantButtons();
    const carBtn = buttons[1];
    if (!carBtn) throw new Error('CAR-003 grant button missing');

    await act(async () => {
      carBtn.click();
      await Promise.resolve();
    });

    const cancelBtn = findCancelButton();
    if (!cancelBtn) throw new Error('Cancel button missing');
    await act(async () => {
      cancelBtn.click();
      await Promise.resolve();
    });

    expect(grantMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('GarageBadgesPanel — premium-exclusive on premium user (no confirm)', () => {
  it('grants directly without a confirm dialog when isPremiumActive is true', async () => {
    grantMock.mockResolvedValue({ ok: true });
    await act(async () => {
      root.render(
        <GarageBadgesPanel userId="u1" catalog={catalog} earnedCodes={[]} isPremiumActive={true} />,
      );
      await Promise.resolve();
    });

    const buttons = findGrantButtons();
    const carBtn = buttons[1];
    if (!carBtn) throw new Error('CAR-003 grant button missing');

    await act(async () => {
      carBtn.click();
      await Promise.resolve();
    });

    expect(grantMock).toHaveBeenCalledWith('u1', 'CAR-003');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('GarageBadgesPanel — grant error surfaces inline', () => {
  it('shows the error message returned by the action and does not refresh', async () => {
    grantMock.mockResolvedValue({ ok: false, error: 'Conquista já concedida.' });
    await act(async () => {
      root.render(
        <GarageBadgesPanel
          userId="u1"
          catalog={catalog}
          earnedCodes={[]}
          isPremiumActive={false}
        />,
      );
      await Promise.resolve();
    });

    const buttons = findGrantButtons();
    const evtBtn = buttons[0];
    if (!evtBtn) throw new Error('EVT-001 grant button missing');

    await act(async () => {
      evtBtn.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Conquista já concedida.');
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe('GarageBadgesPanel — per-row pending + focus trap', () => {
  const render = async (premium = false) => {
    await act(async () => {
      root.render(
        <GarageBadgesPanel
          userId="u1"
          catalog={catalog}
          earnedCodes={[]}
          isPremiumActive={premium}
        />,
      );
      await Promise.resolve();
    });
  };
  const openConfirm = async () => {
    await render(false);
    const carBtn = findGrantButtons().find((b) =>
      (b.closest('li')?.textContent ?? '').includes('CAR-003'),
    )!;
    await act(async () => {
      carBtn.click();
      await Promise.resolve();
    });
    return carBtn;
  };
  const key = (t: EventTarget, k: string, shift = false) =>
    t.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, shiftKey: shift }),
    );

  it('per-row pending: EVT-001 grant in flight leaves CAR-003 enabled', async () => {
    let resolve: ((v: { ok: false; error: string }) => void) | null = null;
    grantMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await render(true);
    const [evtBtn, carBtn] = findGrantButtons();
    await act(async () => {
      evtBtn?.click();
      await Promise.resolve();
    });
    expect(evtBtn?.hasAttribute('disabled')).toBe(true);
    expect(carBtn?.hasAttribute('disabled')).toBe(false);
    await act(async () => {
      resolve?.({ ok: false, error: 'already_earned' });
      await Promise.resolve();
    });
  });

  it('per-row pending: two concurrent grants — both rows disabled, third stays enabled', async () => {
    let resolveEvt: ((v: { ok: false; error: string }) => void) | null = null;
    let resolveCar: ((v: { ok: false; error: string }) => void) | null = null;
    grantMock
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveEvt = r;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveCar = r;
          }),
      );
    await render(true);
    const btn = (code: string) =>
      findGrantButtons().find((b) => (b.closest('li')?.textContent ?? '').includes(code))!;
    const evtBtn = btn('EVT-001');
    const carBtn = btn('CAR-003');
    const comBtn = btn('COM-001');
    await act(async () => {
      evtBtn.click();
      await Promise.resolve();
    });
    await act(async () => {
      carBtn.click();
      await Promise.resolve();
    });
    expect(evtBtn.hasAttribute('disabled')).toBe(true);
    expect(carBtn.hasAttribute('disabled')).toBe(true);
    expect(comBtn.hasAttribute('disabled')).toBe(false);
    // Resolving EVT only clears EVT — CAR is still in flight.
    await act(async () => {
      resolveEvt?.({ ok: false, error: 'already_earned' });
      await Promise.resolve();
    });
    expect(carBtn.hasAttribute('disabled')).toBe(true);
    await act(async () => {
      resolveCar?.({ ok: false, error: 'already_earned' });
      await Promise.resolve();
    });
  });

  it('focus trap: dialog open focuses Cancel', async () => {
    await openConfirm();
    expect(document.activeElement).toBe(findCancelButton());
  });

  it('focus trap: Tab wraps Cancel→Conceder and back', async () => {
    await openConfirm();
    const cancel = findCancelButton()!;
    const confirm = findConfirmButton()!;
    cancel.focus();
    await act(async () => {
      key(cancel, 'Tab');
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(confirm);
    await act(async () => {
      key(confirm, 'Tab', true);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(cancel);
  });

  it('focus trap: Esc dismisses + restores focus to the grant button', async () => {
    const carBtn = await openConfirm();
    await act(async () => {
      key(document, 'Escape');
      await Promise.resolve();
    });
    expect(findCancelButton()).toBeNull();
    expect(document.activeElement).toBe(carBtn);
  });

  it('focus trap: confirm-completion dismisses + restores focus to the grant button', async () => {
    let resolveGrant: ((v: { ok: false; error: string }) => void) | null = null;
    grantMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveGrant = r;
        }),
    );
    const carBtn = await openConfirm();
    const confirm = findConfirmButton()!;
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(findCancelButton()).toBeNull();
    expect(document.activeElement).toBe(carBtn);
    await act(async () => {
      resolveGrant?.({ ok: false, error: 'already_earned' });
      await Promise.resolve();
    });
  });
});
