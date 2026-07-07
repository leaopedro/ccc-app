import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('~/lib/admin-group-actions', () => ({
  addGroupMemberAction: vi.fn(),
}));

import { AddUserToGroupModal } from './add-user-to-group-modal';

const mockGroups = [
  { id: 'g1', name: 'VIP' },
  { id: 'g2', name: 'Membros Premium' },
];

describe('AddUserToGroupModal — closed state', () => {
  it('renders trigger button with correct label', () => {
    const html = renderToStaticMarkup(<AddUserToGroupModal userId="u1" groups={mockGroups} />);
    expect(html).toContain('Adicionar a grupo');
  });

  it('does not render dialog when closed', () => {
    const html = renderToStaticMarkup(<AddUserToGroupModal userId="u1" groups={mockGroups} />);
    expect(html).not.toContain('role="dialog"');
  });
});

describe('AddUserToGroupModal — groups prop', () => {
  it('passes userId prop without error (used in action call)', () => {
    const html = renderToStaticMarkup(
      <AddUserToGroupModal userId="user-abc" groups={mockGroups} />,
    );
    expect(html).toBeTruthy();
  });

  it('renders without error when groups list is empty', () => {
    const html = renderToStaticMarkup(<AddUserToGroupModal userId="u1" groups={[]} />);
    expect(html).toContain('Adicionar a grupo');
  });
});
