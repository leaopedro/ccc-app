import type { AdminPremiumCatalogResponse } from '@ccc/shared/admin';
import type { AdminSubscriptionDetail } from '@ccc/shared/admin-subscription';
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

const fetchAdminSubscription = vi.fn<(id: string) => Promise<AdminSubscriptionDetail>>();
vi.mock('~/lib/assinaturas-actions', () => ({
  fetchAdminSubscription: (id: string) => fetchAdminSubscription(id),
}));

const getAdminPremiumCatalog = vi.fn<() => Promise<AdminPremiumCatalogResponse>>();
vi.mock('~/lib/admin-api', () => ({
  getAdminPremiumCatalog: () => getAdminPremiumCatalog(),
}));
// Padrao: sem override, o catalogo resolve vazio. O teste de falha do
// catalogo sobrescreve so a proxima chamada com mockRejectedValueOnce.
getAdminPremiumCatalog.mockResolvedValue({ plans: [], modules: [] });

// Os paineis de acao sao client components com estado; aqui so importa que a
// pagina os posiciona e passa `mutable`. Stub simples mantem o teste em node.
vi.mock('../plan-actions', () => ({
  PlanActions: ({ mutable }: { mutable: boolean }) => (
    <div data-testid="assinaturas-plan-actions" data-mutable={String(mutable)} />
  ),
}));
vi.mock('../status-actions', () => ({
  StatusActions: ({ mutable }: { mutable: boolean }) => (
    <div data-testid="assinaturas-status-actions" data-mutable={String(mutable)} />
  ),
}));
vi.mock('../addons-panel', () => ({
  AddonsPanel: ({ mutable }: { mutable: boolean }) => (
    <div data-testid="assinaturas-addons-panel" data-mutable={String(mutable)} />
  ),
}));

const Page = (await import('../page')).default;

const detail = (over: Partial<AdminSubscriptionDetail> = {}): AdminSubscriptionDetail => ({
  membershipId: 'mem-1',
  userId: 'usr-1',
  userName: 'Ana',
  userEmail: 'ana@example.com',
  garageId: 'gar-1',
  garageSlug: 'ana',
  tier: 'gold',
  planSlug: 'fundador',
  planName: 'Fundador',
  cadence: 'monthly',
  status: 'active',
  provider: 'stripe',
  currentPeriodStart: '2026-08-01T00:00:00.000Z',
  currentPeriodEnd: '2026-09-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  baseAmountCents: 149000,
  addonsAmountCents: 15000,
  totalAmountCents: 164000,
  currency: 'BRL',
  paymentBrand: 'visa',
  paymentLast4: '4242',
  mutable: true,
  addons: [
    {
      key: 'detailing',
      name: 'Detailing',
      vendorName: 'Lava Rápido X',
      status: 'active',
      quotaUnit: 'access',
      quotaPerCycle: 3,
      monthlyDeltaCents: 15000,
      payoutAmountCents: 9000,
      marginCents: 6000,
      billingIntegrated: true,
      currentCycle: {
        cycleStart: '2026-08-01T00:00:00.000Z',
        cycleEnd: '2026-09-01T00:00:00.000Z',
        quotaTotal: 3,
        quotaUsed: 1,
        quotaRemaining: 2,
      },
    },
  ],
  invoices: [
    {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-01T00:00:00.000Z',
      paidAt: '2026-07-01T03:00:00.000Z',
      grossAmountCents: 164000,
      addonsAmountCents: 15000,
      currency: 'BRL',
      status: 'paid',
      refundedAt: null,
      refundedAmountCents: null,
    },
  ],
  ...over,
});

const render = async (d: AdminSubscriptionDetail) => {
  fetchAdminSubscription.mockResolvedValueOnce(d);
  const el = await Page({ params: Promise.resolve({ id: d.membershipId }) });
  return renderToStaticMarkup(el);
};

describe('tela de detalhe da assinatura', () => {
  it('mostra membro, email e link para o usuario', async () => {
    const html = await render(detail());
    expect(html).toContain('Ana');
    expect(html).toContain('ana@example.com');
    expect(html).toContain('href="/users/usr-1"');
  });

  it('mostra plano, valores e metodo de pagamento', async () => {
    const html = await render(detail());
    expect(html).toContain('Fundador');
    expect(html).toMatch(/data-testid="assinaturas-detalhe-total"/);
    expect(html).toContain('visa');
    expect(html).toContain('4242');
  });

  it('cai para rotulo do provider quando nao ha cartao', async () => {
    const html = await render(detail({ paymentBrand: null, paymentLast4: null }));
    expect(html).toContain('Cartão');
  });

  it('cai para App Store quando o provider e apple e nao ha cartao', async () => {
    const html = await render(
      detail({ provider: 'apple_revenuecat', paymentBrand: null, paymentLast4: null }),
    );
    expect(html).toContain('App Store');
  });

  it('mostra o modulo com fornecedor, repasse e margem', async () => {
    const html = await render(detail());
    expect(html).toMatch(/data-testid="assinaturas-detalhe-modulo-detailing"/);
    expect(html).toContain('Lava Rápido X');
    // cobrado 150,00 / repasse 90,00 / margem 60,00
    expect(html).toContain('90,00');
    expect(html).toContain('60,00');
    // billingIntegrated: true no fixture — aviso de cobranca nao deve aparecer
    expect(html).not.toMatch(/data-testid="assinaturas-detalhe-modulo-sem-cobranca-detailing"/);
  });

  it('avisa quando o modulo nao esta integrado a cobranca', async () => {
    const d = detail();
    d.addons[0]!.billingIntegrated = false;
    const html = await render(d);
    expect(html).toMatch(/data-testid="assinaturas-detalhe-modulo-sem-cobranca-detailing"/);
  });

  it('mostra o historico de pagamentos', async () => {
    const html = await render(detail());
    expect(html).toMatch(/data-testid="assinaturas-detalhe-fatura-0"/);
  });

  it('avisa e desabilita acoes em assinatura da Apple', async () => {
    const html = await render(detail({ provider: 'apple_revenuecat', mutable: false }));
    expect(html).toMatch(/data-testid="assinaturas-detalhe-imutavel"/);
    expect(html).toContain('data-mutable="false"');
  });

  it('mostra os tres paineis de acao', async () => {
    const html = await render(detail());
    expect(html).toMatch(/data-testid="assinaturas-plan-actions"/);
    expect(html).toMatch(/data-testid="assinaturas-status-actions"/);
    expect(html).toMatch(/data-testid="assinaturas-addons-panel"/);
  });

  it('chama notFound quando a API responde 404', async () => {
    notFoundMock.mockClear();
    fetchAdminSubscription.mockRejectedValueOnce(
      new ApiError(404, 'not_found', 'Assinatura não encontrada'),
    );
    await expect(Page({ params: Promise.resolve({ id: 'mem-inexistente' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('propaga erro que nao e 404, sem chamar notFound', async () => {
    notFoundMock.mockClear();
    fetchAdminSubscription.mockRejectedValueOnce(
      new ApiError(500, 'internal', 'Erro interno inesperado'),
    );
    await expect(Page({ params: Promise.resolve({ id: 'mem-1' }) })).rejects.toThrow(
      'Erro interno inesperado',
    );
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('renderiza com planSlug e planName nulos, caindo no rotulo do tier', async () => {
    const html = await render(detail({ planSlug: null, planName: null }));
    expect(html).toMatch(/data-testid="assinaturas-detalhe-plano"/);
    expect(html).toContain('Gold');
  });

  it('renderiza a assinatura mesmo quando o catalogo de modulos falha', async () => {
    getAdminPremiumCatalog.mockRejectedValueOnce(new Error('catalogo indisponivel'));
    const html = await render(detail());
    expect(html).toContain('Ana');
    expect(html).toMatch(/data-testid="assinaturas-detalhe-total"/);
  });
});
