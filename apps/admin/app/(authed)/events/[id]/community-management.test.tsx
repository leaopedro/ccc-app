import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/community-management-actions', () => ({
  createFeedBanAction: () => Promise.resolve({ error: null }),
  deleteFeedBanAction: () => Promise.resolve({ error: null }),
  dismissReportAction: () => Promise.resolve({ error: null }),
  moderateFeedItemAction: () => Promise.resolve({ error: null }),
  resolveReportAction: () => Promise.resolve({ error: null }),
}));

import { CommunityManagement } from './community-management';

describe('CommunityManagement moderation queue restore action', () => {
  it('renders restore action for hidden/removed items and not for active items', () => {
    const html = renderToStaticMarkup(
      <CommunityManagement
        eventId="evt_1"
        queue={[
          {
            id: 'p1',
            kind: 'post',
            body: 'Post oculto',
            status: 'hidden',
            authorName: 'Alice',
            carNickname: null,
            isPremiumActive: null,
            createdAt: '2026-05-18T12:00:00.000Z',
            openReportCount: 1,
          },
          {
            id: 'c1',
            kind: 'comment',
            body: 'Comentário ativo',
            status: 'active',
            authorName: 'Bob',
            carNickname: null,
            isPremiumActive: null,
            createdAt: '2026-05-18T12:00:00.000Z',
            openReportCount: 0,
          },
        ]}
        reports={[]}
        bans={[]}
      />,
    );

    expect(html.match(/Restaurar/g) ?? []).toHaveLength(1);
    expect(html).toContain('Ocultar');
    expect(html).toContain('Remover');
  });
});
