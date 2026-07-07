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

const { listAdminSupportTickets } = vi.hoisted(() => ({
  listAdminSupportTickets: vi.fn(),
}));

vi.mock('~/lib/admin-api', () => ({
  listAdminSupportTickets,
}));

import SupportPage from './page';

describe('SupportPage', () => {
  it('renders both client-facing and internal statuses in newest-first order', async () => {
    listAdminSupportTickets.mockResolvedValue({
      items: [
        {
          id: 'ticket-new',
          phone: '11999999999',
          message: 'Ticket novo',
          attachmentUrl: null,
          status: 'open',
          internalStatus: 'in_progress',
          createdAt: '2026-05-14T15:00:00.000Z',
          user: { id: 'user-1', name: 'Ana', email: 'ana@jdm.test' },
        },
        {
          id: 'ticket-old',
          phone: '11888888888',
          message: 'Ticket antigo',
          attachmentUrl: null,
          status: 'closed',
          internalStatus: 'done',
          createdAt: '2026-05-13T15:00:00.000Z',
          user: { id: 'user-2', name: 'Bruno', email: 'bruno@jdm.test' },
        },
      ],
      hasMore: false,
      nextCursor: null,
    });

    const element = await SupportPage({
      searchParams: Promise.resolve({ status: 'open' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Status cliente');
    expect(html).toContain('Status interno');
    expect(html).toContain('Aberto');
    expect(html).toContain('Em andamento');
    expect(html).toContain('Fechado');
    expect(html).toContain('Resolvido');
    expect(html.indexOf('Ticket novo')).toBeLessThan(html.indexOf('Ticket antigo'));
  });
});
