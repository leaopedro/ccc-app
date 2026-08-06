import type { AdminFinanceMembershipsItem } from '@ccc/shared/admin';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AssinaturasTable } = await import('../assinaturas-table');

const item = (over: Partial<AdminFinanceMembershipsItem> = {}): AdminFinanceMembershipsItem => ({
  membershipId: 'mem-1',
  garageSlug: 'ana',
  userId: 'usr-1',
  userName: 'Ana',
  userEmail: 'ana@example.com',
  tier: 'gold',
  cadence: 'monthly',
  status: 'active',
  currentPeriodEnd: '2026-09-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  totalPaidCents: 164000,
  invoiceCount: 1,
  provider: 'stripe',
  providerSubRef: 'sub_1',
  baseAmountCents: 149000,
  addonsAmountCents: 15000,
  paymentBrand: 'visa',
  paymentLast4: '4242',
  addonKeys: ['detailing'],
  ...over,
});

const base = {
  page: 1,
  pageSize: 25,
  total: 1,
  activeFilters: {
    status: null,
    cadence: null,
    tier: null,
    provider: null,
    addonKey: null,
    vendorName: null,
  },
  preservedParams: {},
  moduleOptions: [{ key: 'detailing', name: 'Detailing' }],
  vendorOptions: ['Lava Rápido X'],
};

describe('AssinaturasTable', () => {
  it('renderiza a linha com nome, email, plano e metodo de pagamento', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[item()]} />);
    expect(html).toMatch(/data-testid="assinaturas-row-mem-1"/);
    expect(html).toContain('Ana');
    expect(html).toContain('ana@example.com');
    expect(html).toMatch(/data-testid="assinaturas-status-mem-1"[^>]*>Ativo</);
    expect(html).toContain('visa');
    expect(html).toContain('4242');
  });

  it('linka a linha para o detalhe', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[item()]} />);
    expect(html).toContain('href="/assinaturas/mem-1"');
  });

  it('cai para rotulo derivado do provider quando nao ha cartao', () => {
    const html = renderToStaticMarkup(
      <AssinaturasTable {...base} items={[item({ paymentBrand: null, paymentLast4: null })]} />,
    );
    expect(html).toContain('Cartão');
  });

  it('mostra App Store para assinatura Apple sem cartao', () => {
    const html = renderToStaticMarkup(
      <AssinaturasTable
        {...base}
        items={[item({ provider: 'apple_revenuecat', paymentBrand: null, paymentLast4: null })]}
      />,
    );
    expect(html).toContain('App Store');
  });

  it('renderiza chips de modulo e de fornecedor', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[item()]} />);
    expect(html).toContain('addonKey=detailing');
    // URLSearchParams#toString() codifica espaco como "+", nao "%20".
    expect(html).toContain(new URLSearchParams({ vendorName: 'Lava Rápido X' }).toString());
  });

  it('mostra estado vazio quando nao ha itens', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[]} total={0} />);
    expect(html).toMatch(/data-testid="assinaturas-empty-state"/);
  });

  it('preserva filtros ativos ao paginar e reseta page ao trocar filtro', () => {
    const html = renderToStaticMarkup(
      <AssinaturasTable
        {...base}
        items={[item()]}
        page={2}
        total={60}
        activeFilters={{ ...base.activeFilters, status: 'active' }}
      />,
    );
    expect(html).toMatch(/data-testid="assinaturas-prev"/);
    expect(html).toMatch(/data-testid="assinaturas-page-indicator"/);
    // link de pagina carrega o filtro
    expect(html).toContain('status=active');
  });

  it('renderiza os campos de periodo de renovacao', () => {
    const html = renderToStaticMarkup(<AssinaturasTable {...base} items={[item()]} />);
    expect(html).toMatch(/name="from"/);
    expect(html).toMatch(/name="to"/);
  });

  it('nao duplica o campo search quando ja ha um termo de busca ativo', () => {
    const html = renderToStaticMarkup(
      <AssinaturasTable {...base} items={[item()]} preservedParams={{ search: 'ana' }} />,
    );
    const searchFields = html.match(/name="search"/g) ?? [];
    expect(searchFields).toHaveLength(1);
  });
});
