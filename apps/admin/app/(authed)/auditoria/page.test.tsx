import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

globalThis.React = React;

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...(rest as object)}>
      {children}
    </a>
  ),
}));

const { listAdminAuditLogs } = vi.hoisted(() => ({
  listAdminAuditLogs: vi.fn(),
}));

vi.mock('~/lib/admin-api', () => ({
  listAdminAuditLogs,
}));

import AuditoriaPage from './page';

describe('AuditoriaPage', () => {
  it('renders empty state when no items', async () => {
    listAdminAuditLogs.mockResolvedValue({ items: [], nextCursor: null });
    const element = await AuditoriaPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('Nenhum registro');
  });

  it('renders audit row data', async () => {
    listAdminAuditLogs.mockResolvedValue({
      items: [
        {
          id: 'c1',
          actorId: 'u1',
          action: 'event.create',
          entityType: 'event',
          entityId: 'evt_1',
          metadata: null,
          createdAt: new Date('2026-01-01T12:00:00Z').toISOString(),
        },
      ],
      nextCursor: null,
    });
    const element = await AuditoriaPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('event.create');
    expect(html).toContain('event');
    expect(html).toContain('evt_1');
  });

  it('renders badge.award row with badgeCode from metadata', async () => {
    listAdminAuditLogs.mockResolvedValue({
      items: [
        {
          id: 'b1',
          actorId: 'admin1',
          action: 'badge.award',
          entityType: 'garage',
          entityId: 'g1',
          metadata: { badgeCode: 'EVT-001', sourceRef: 'admin:admin1' },
          createdAt: new Date('2026-05-01T12:00:00Z').toISOString(),
        },
      ],
      nextCursor: null,
    });
    const element = await AuditoriaPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('badge.award');
    expect(html).toContain('EVT-001');
  });

  it('renders badge.pin row with badgeCode from metadata', async () => {
    listAdminAuditLogs.mockResolvedValue({
      items: [
        {
          id: 'b2',
          actorId: 'admin1',
          action: 'badge.pin',
          entityType: 'garage',
          entityId: 'g1',
          metadata: { badgeCode: 'CAR-003' },
          createdAt: new Date('2026-05-02T12:00:00Z').toISOString(),
        },
      ],
      nextCursor: null,
    });
    const element = await AuditoriaPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('badge.pin');
    expect(html).toContain('CAR-003');
  });

  it('does not crash when badge.* metadata is missing badgeCode', async () => {
    listAdminAuditLogs.mockResolvedValue({
      items: [
        {
          id: 'b3',
          actorId: 'admin1',
          action: 'badge.unpin',
          entityType: 'garage',
          entityId: 'g1',
          metadata: null,
          createdAt: new Date('2026-05-03T12:00:00Z').toISOString(),
        },
      ],
      nextCursor: null,
    });
    const element = await AuditoriaPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('badge.unpin');
  });

  it('shows next page link when nextCursor present', async () => {
    listAdminAuditLogs.mockResolvedValue({
      items: [
        {
          id: 'c2',
          actorId: 'u1',
          action: 'tier.create',
          entityType: 'tier',
          entityId: 't1',
          metadata: null,
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: 'abc123',
    });
    const element = await AuditoriaPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('cursor=abc123');
    expect(html).toContain('róxima');
  });
});
