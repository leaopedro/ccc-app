// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { AdminGamificationCopy } from '@ccc/shared/admin-gamification';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));

vi.mock('~/lib/gamification-copy-actions', () => ({
  updateAdminGamificationCopyAction: updateMock,
}));

import { GamificationCopyForm } from './gamification-copy-form';

const initial: AdminGamificationCopy = {
  version: 3,
  badges: [
    { code: 'EVT-001', title: 'Primeira Largada', description: 'Desc 1' },
    { code: 'CAR-001', title: 'Garagem Aberta', description: 'Desc 2' },
  ],
  rankNames: {
    iniciante: 'Iniciante',
    pilotador: 'Pilotador',
    veterano: 'Veterano',
    lendario: 'Lendário',
    hall_of_fame: 'Hall of Fame',
  },
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const input = (label: string): HTMLInputElement =>
  container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

const setValue = (el: HTMLInputElement, value: string) => {
  /* eslint-disable @typescript-eslint/unbound-method -- intentional: invoke
     the prototype setter to bypass React's value tracker. */
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  /* eslint-enable @typescript-eslint/unbound-method */
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const clickByText = (text: string) => {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('GamificationCopyForm', () => {
  beforeEach(() => {
    updateMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('manda a versao lida junto com a edicao', async () => {
    updateMock.mockResolvedValue({ ok: true, copy: { ...initial, version: 4 } });
    await act(async () => {
      root.render(<GamificationCopyForm initial={initial} />);
      await Promise.resolve();
    });

    setValue(input('Título de EVT-001'), 'Largada');
    await act(async () => {
      clickByText('Salvar');
      await Promise.resolve();
    });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3 }));
    const sent = updateMock.mock.calls[0]![0] as { badges: { code: string; title: string }[] };
    expect(sent.badges.find((b) => b.code === 'EVT-001')?.title).toBe('Largada');
  });

  it('usa a versao nova depois de salvar', async () => {
    updateMock.mockResolvedValue({ ok: true, copy: { ...initial, version: 4 } });
    await act(async () => {
      root.render(<GamificationCopyForm initial={initial} />);
      await Promise.resolve();
    });

    await act(async () => {
      clickByText('Salvar');
      await Promise.resolve();
    });
    await act(async () => {
      clickByText('Salvar');
      await Promise.resolve();
    });

    expect(updateMock.mock.calls[1]![0]).toEqual(expect.objectContaining({ expectedVersion: 4 }));
  });

  it('mostra a mensagem de conflito', async () => {
    updateMock.mockResolvedValue({ ok: false, error: 'Alguém editou esta página. Recarregue.' });
    await act(async () => {
      root.render(<GamificationCopyForm initial={initial} />);
      await Promise.resolve();
    });
    await act(async () => {
      clickByText('Salvar');
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Recarregue');
  });
});
