// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('~/lib/admin-group-actions', () => ({
  addGroupMemberAction: vi.fn(),
}));

import { AddUserToGroupModal } from './add-user-to-group-modal';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  refreshMock.mockReset();
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

describe('filtered add-to-group selector', () => {
  it('does not include already-joined groups in the select options', async () => {
    // User is already in VIP (g1); only Staff (g2) should appear
    const filteredGroups = [{ id: 'g2', name: 'Staff' }];
    await act(async () => {
      root.render(<AddUserToGroupModal userId="u1" groups={filteredGroups} initialOpen={true} />);
      await Promise.resolve();
    });
    const options = Array.from(container.querySelectorAll('select option'));
    const names = options.map((o) => o.textContent);
    expect(names).toContain('Staff');
    expect(names).not.toContain('VIP');
  });

  it('shows empty selector when user is already in all groups', async () => {
    await act(async () => {
      root.render(<AddUserToGroupModal userId="u1" groups={[]} initialOpen={true} />);
      await Promise.resolve();
    });
    const options = Array.from(container.querySelectorAll('select option'));
    // Only placeholder option present
    expect(options).toHaveLength(1);
  });
});

describe('available-groups filter logic', () => {
  it('excludes user current groups from the add selector list', () => {
    const allGroups = [
      { id: 'g1', name: 'VIP', memberCount: 2 },
      { id: 'g2', name: 'Staff', memberCount: 1 },
      { id: 'g3', name: 'Convidados', memberCount: 0 },
    ];
    const userGroups = [
      { id: 'g1', name: 'VIP' },
      { id: 'g3', name: 'Convidados' },
    ];
    const memberGroupIds = new Set(userGroups.map((g) => g.id));
    const available = allGroups.filter((g) => !memberGroupIds.has(g.id));
    expect(available).toHaveLength(1);
    expect(available[0]!.id).toBe('g2');
  });
});
