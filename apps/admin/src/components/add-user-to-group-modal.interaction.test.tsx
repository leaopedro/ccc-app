// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, addGroupMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  addGroupMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('~/lib/admin-group-actions', () => ({
  addGroupMemberAction: addGroupMock,
}));

import { AddUserToGroupModal } from './add-user-to-group-modal';

const mockGroups = [
  { id: 'g1', name: 'VIP' },
  { id: 'g2', name: 'Membros Premium' },
];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function selectGroup(id: string) {
  const select = container.querySelector('select') as HTMLSelectElement;
  act(() => {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function findSubmitBtn(): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Adicionar'),
  ) as HTMLButtonElement;
}

async function renderOpen() {
  await act(async () => {
    root.render(<AddUserToGroupModal userId="u1" groups={mockGroups} initialOpen={true} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  refreshMock.mockReset();
  addGroupMock.mockReset();
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

describe('AddUserToGroupModal — disabled-submit path', () => {
  it('submit button is disabled when no group is selected', async () => {
    await renderOpen();
    const btn = findSubmitBtn();
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it('submit button is enabled after selecting a group', async () => {
    await renderOpen();
    selectGroup('g1');
    expect(findSubmitBtn().disabled).toBe(false);
  });
});

describe('AddUserToGroupModal — success path', () => {
  it('calls addGroupMemberAction with groupId and userId, then shows toast and calls router.refresh', async () => {
    addGroupMock.mockResolvedValue({ ok: true });
    await renderOpen();
    selectGroup('g1');
    await act(async () => {
      findSubmitBtn().click();
      await Promise.resolve();
    });
    expect(addGroupMock).toHaveBeenCalledWith('g1', 'u1');
    expect(refreshMock).toHaveBeenCalled();
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Usuário adicionado ao grupo!');
  });
});

describe('AddUserToGroupModal — duplicate guard path', () => {
  it('shows duplicate-guard error and does not show success toast or call router.refresh', async () => {
    addGroupMock.mockResolvedValue({ ok: false, error: 'Usuário já está neste grupo.' });
    await renderOpen();
    selectGroup('g1');
    await act(async () => {
      findSubmitBtn().click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Usuário já está neste grupo.');
    expect(refreshMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
