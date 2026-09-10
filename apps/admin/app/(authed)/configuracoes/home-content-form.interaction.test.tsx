// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { AdminHomeContent } from '@ccc/shared/admin-home';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateMock, presignMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  presignMock: vi.fn(),
}));

vi.mock('~/lib/home-content-actions', () => ({
  updateAdminHomeContentAction: updateMock,
  presignHomeImageAction: presignMock,
}));

import { HomeContentForm } from './home-content-form';

const initial: AdminHomeContent = {
  heroTitle: 'DIRIGIR. CONECTAR. PERTENCER.',
  heroSubtitle: null,
  heroBannerObjectKey: 'home-media/u1/banner.jpg',
  heroBannerUrl: 'http://localhost:4000/dev-uploads/home-media/u1/banner.jpg',
  institutionalTitle: 'A Casa',
  institutionalBody: 'Um clubhouse automotivo privado em Curitiba.',
  institutionalImageObjectKey: null,
  institutionalImageUrl: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const input = (label: string): HTMLInputElement =>
  container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  /* eslint-disable @typescript-eslint/unbound-method -- intentional: invoke
     the prototype setter to bypass React's value tracker. */
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
  setter?.call(el, value);
  /* eslint-enable @typescript-eslint/unbound-method */
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const findAlert = (): HTMLElement | null => container.querySelector('[role="alert"]');

const clickByText = (text: string) => {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('HomeContentForm', () => {
  beforeEach(() => {
    updateMock.mockReset();
    presignMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('manda o campo editado e o expectedUpdatedAt que leu', async () => {
    updateMock.mockResolvedValue({ ok: true, content: { ...initial, heroTitle: 'NOVO' } });
    await act(async () => {
      root.render(<HomeContentForm initial={initial} />);
      await Promise.resolve();
    });

    setValue(input('Mote do hero'), 'NOVO');
    await act(async () => {
      clickByText('Salvar');
      await Promise.resolve();
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ heroTitle: 'NOVO', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }),
    );
  });

  it('remover imagem manda string vazia', async () => {
    updateMock.mockResolvedValue({ ok: true, content: { ...initial, heroBannerObjectKey: null } });
    await act(async () => {
      root.render(<HomeContentForm initial={initial} />);
      await Promise.resolve();
    });

    await act(async () => {
      clickByText('Remover banner do hero');
      await Promise.resolve();
    });
    await act(async () => {
      clickByText('Salvar');
      await Promise.resolve();
    });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ heroBannerObjectKey: '' }));
  });

  it('mostra o erro do servidor', async () => {
    updateMock.mockResolvedValue({ ok: false, error: 'Dados inválidos.' });
    await act(async () => {
      root.render(<HomeContentForm initial={initial} />);
      await Promise.resolve();
    });

    await act(async () => {
      clickByText('Salvar');
      await Promise.resolve();
    });

    expect(findAlert()?.textContent).toContain('Dados inválidos.');
  });

  it('mostra a mensagem de recarregar no conflito', async () => {
    updateMock.mockResolvedValue({
      ok: false,
      stale: true,
      error: 'Alguém editou esta página enquanto você escrevia. Recarregue e refaça a alteração.',
    });
    await act(async () => {
      root.render(<HomeContentForm initial={initial} />);
      await Promise.resolve();
    });

    await act(async () => {
      clickByText('Salvar');
      await Promise.resolve();
    });

    expect(findAlert()?.textContent).toContain('Recarregue');
  });

  it('usa o updatedAt devolvido pela resposta no segundo save', async () => {
    updateMock.mockResolvedValue({
      ok: true,
      content: { ...initial, updatedAt: '2026-02-02T00:00:00.000Z' },
    });
    await act(async () => {
      root.render(<HomeContentForm initial={initial} />);
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

    expect(updateMock.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ expectedUpdatedAt: '2026-02-02T00:00:00.000Z' }),
    );
  });
});
