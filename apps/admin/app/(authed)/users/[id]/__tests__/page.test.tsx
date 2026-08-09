import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '~/lib/api';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}));

// All of these are client components with their own state; the 429 branch
// returns before any of them would render, but the module import still has
// to resolve, so stub them the same way the assinaturas page test does.
vi.mock('~/components/add-user-to-group-modal', () => ({
  AddUserToGroupModal: () => null,
}));
vi.mock('~/components/admin-user-documents-panel', () => ({
  AdminUserDocumentsPanel: () => null,
}));
vi.mock('~/components/admin-xp-adjustment-trigger', () => ({
  AdminXpAdjustmentTrigger: () => null,
}));
vi.mock('~/components/garage-badges-panel', () => ({
  GarageBadgesPanel: () => null,
}));
vi.mock('~/components/garage-membership-history', () => ({
  GarageMembershipHistory: () => null,
}));
vi.mock('~/components/grant-ticket-modal', () => ({
  GrantTicketModal: () => null,
}));
vi.mock('~/components/remove-member-button', () => ({
  RemoveMemberButton: () => null,
}));
vi.mock('~/components/user-avatar', () => ({
  UserAvatar: () => null,
}));
vi.mock('~/components/user-garage-panel', () => ({
  UserGaragePanel: () => null,
}));
vi.mock('~/components/user-status-actions', () => ({
  UserStatusActions: () => null,
}));
vi.mock('~/components/user-status-chip', () => ({
  UserStatusChip: () => null,
}));

const getAdminUser = vi.fn();
const getMe = vi.fn();
const listAdminEvents = vi.fn();
const listAdminGroups = vi.fn();
vi.mock('~/lib/admin-api', () => ({
  getAdminUser: (id: string) => getAdminUser(id),
  getMe: () => getMe(),
  listAdminEvents: () => listAdminEvents(),
  listAdminGroups: () => listAdminGroups(),
}));

const getAdminUserGarage = vi.fn();
vi.mock('~/lib/admin-garage-api', () => ({
  getAdminUserGarage: (id: string) => getAdminUserGarage(id),
}));

const fetchBadgeCatalog = vi.fn();
const fetchPublicGarage = vi.fn();
vi.mock('~/lib/public-garage', () => ({
  fetchBadgeCatalog: () => fetchBadgeCatalog(),
  fetchPublicGarage: (slug: string) => fetchPublicGarage(slug),
}));

const Page = (await import('../page')).default;

describe('tela de detalhe do usuario, degradacao do rate limit', () => {
  it('mostra aviso de limite de leitura em vez de propagar o 429', async () => {
    getAdminUser.mockRejectedValueOnce(
      new ApiError(429, 'rate_limited', 'Too many requests'),
    );

    const el = await Page({ params: Promise.resolve({ id: 'usr-1' }) });
    const html = renderToStaticMarkup(el);

    expect(html).toContain('Limite de leituras atingido');
    expect(notFoundMock).not.toHaveBeenCalled();
    // The rest of the page's data calls never run once the 429 short-circuits.
    expect(getMe).not.toHaveBeenCalled();
    expect(listAdminEvents).not.toHaveBeenCalled();
  });

  it('continua chamando notFound normalmente para 404', async () => {
    notFoundMock.mockClear();
    getAdminUser.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Usuario nao encontrado'));

    await expect(Page({ params: Promise.resolve({ id: 'usr-inexistente' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('propaga erro que nao e 404 nem 429, sem disfarcar de throttling', async () => {
    notFoundMock.mockClear();
    getAdminUser.mockRejectedValueOnce(new ApiError(500, 'internal', 'Erro interno inesperado'));

    await expect(Page({ params: Promise.resolve({ id: 'usr-1' }) })).rejects.toThrow(
      'Erro interno inesperado',
    );
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
