// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, addGroupMock, searchMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  addGroupMock: vi.fn(),
  searchMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('~/lib/admin-group-actions', () => ({
  addGroupMemberAction: addGroupMock,
  searchUsersAction: searchMock,
}));

import { AddGroupMemberModal } from './add-group-member-modal';

const mockUser = { id: 'u1', name: 'João Silva', email: 'joao@jdm.test' };

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function openModal() {
  await act(async () => {
    root.render(<AddGroupMemberModal groupId="g1" />);
    await Promise.resolve();
  });
  const trigger = container.querySelector('button') as HTMLButtonElement;
  await act(async () => {
    trigger.click();
    await Promise.resolve();
  });
}

async function searchAndSelectUser() {
  const input = container.querySelector('input[type="text"]') as HTMLInputElement;
  // set value and fire change so React picks it up
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
    input,
    'João',
  );
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // advance exactly past the 300ms debounce; do NOT run all timers so
    // the 1.2s close and 2.4s dismiss timers scheduled after the add action
    // do not fire during this step.
    await vi.advanceTimersByTimeAsync(350);
    await Promise.resolve();
  });
  // click on the first search result
  const resultBtn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('João Silva'),
  );
  if (!resultBtn) throw new Error('Search result button not found');
  await act(async () => {
    resultBtn.click();
    await Promise.resolve();
  });
}

function findAddBtn(): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Adicionar' || b.textContent?.includes('...'),
  ) as HTMLButtonElement;
}

beforeEach(() => {
  refreshMock.mockReset();
  addGroupMock.mockReset();
  searchMock.mockReset();
  searchMock.mockResolvedValue([mockUser]);
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

describe('AddGroupMemberModal — happy path', () => {
  it('calls addGroupMemberAction with groupId and userId, shows success toast, calls router.refresh', async () => {
    addGroupMock.mockResolvedValue({ ok: true });
    await openModal();
    await searchAndSelectUser();
    await act(async () => {
      findAddBtn().click();
      await Promise.resolve();
    });
    expect(addGroupMock).toHaveBeenCalledWith('g1', 'u1');
    expect(refreshMock).toHaveBeenCalled();
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Membro adicionado com sucesso!');
  });
});

describe('AddGroupMemberModal — duplicate guard path', () => {
  it('shows duplicate-guard error and does not show success toast or call router.refresh', async () => {
    addGroupMock.mockResolvedValue({ ok: false, error: 'Usuário já está neste grupo.' });
    await openModal();
    await searchAndSelectUser();
    await act(async () => {
      findAddBtn().click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Usuário já está neste grupo.');
    expect(refreshMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
