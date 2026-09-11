import type { AdminGamificationCopy } from '@ccc/shared/admin-gamification';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { readRoleMock } = vi.hoisted(() => ({ readRoleMock: vi.fn() }));
vi.mock('~/lib/auth-session', () => ({ readRole: readRoleMock }));

const { fetchCopyMock } = vi.hoisted(() => ({ fetchCopyMock: vi.fn() }));
vi.mock('~/lib/gamification-copy-actions', () => ({ fetchAdminGamificationCopy: fetchCopyMock }));

vi.mock('../gamification-copy-form', () => ({
  GamificationCopyForm: () => <div data-testid="gamification-copy-form" />,
}));

const Page = (await import('./page')).default;

const copy: AdminGamificationCopy = {
  version: 1,
  badges: [{ code: 'EVT-001', title: 'Primeira Largada', description: 'Desc' }],
  rankNames: {
    iniciante: 'Iniciante',
    pilotador: 'Pilotador',
    veterano: 'Veterano',
    lendario: 'Lendário',
    hall_of_fame: 'Hall of Fame',
  },
};

describe('/configuracoes/conquistas — non-admin', () => {
  it('renders Acesso restrito for organizer and never calls the API', async () => {
    readRoleMock.mockResolvedValue('organizer');
    const ui = await Page();
    const html = renderToStaticMarkup(ui);
    expect(html).toContain('Acesso restrito');
    expect(html).not.toContain('data-testid="gamification-copy-form"');
    expect(fetchCopyMock).not.toHaveBeenCalled();
  });
});

describe('/configuracoes/conquistas — admin', () => {
  it('renders the copy form and calls the API', async () => {
    readRoleMock.mockResolvedValue('admin');
    fetchCopyMock.mockResolvedValue(copy);
    const ui = await Page();
    const html = renderToStaticMarkup(ui);
    expect(html).not.toContain('Acesso restrito');
    expect(html).toContain('data-testid="gamification-copy-form"');
    expect(fetchCopyMock).toHaveBeenCalled();
  });
});
