import type { AdminOrderDetail } from '@ccc/shared/admin';
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
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

const getAdminOrder = vi.fn<(id: string) => Promise<AdminOrderDetail>>();
vi.mock('~/lib/admin-api', () => ({
  getAdminOrder: (id: string) => getAdminOrder(id),
}));

// The refund form is a client component with state; the page test only cares
// that it is mounted and fed the right blast radius.
vi.mock('~/components/refund-order-form', () => ({
  RefundOrderForm: (props: {
    orderId: string;
    siblingOrderCount?: number;
    siblingTicketCount?: number;
    ownTicketCount?: number;
  }) => (
    <div
      data-testid="refund-form"
      data-order={props.orderId}
      data-siblings={String(props.siblingOrderCount)}
      data-sibling-tickets={String(props.siblingTicketCount)}
      data-own-tickets={String(props.ownTicketCount)}
    />
  ),
}));

const Page = (await import('../page')).default;

const ticketOrder = (over: Partial<AdminOrderDetail> = {}): AdminOrderDetail => ({
  id: 'ord_ticket_1',
  shortId: 'TICKET01',
  kind: 'ticket',
  paymentStatus: 'paid',
  provider: 'stripe',
  providerRef: 'pi_123',
  amountCents: 30000,
  shippingCents: 0,
  currency: 'BRL',
  customer: { id: 'usr_1', name: 'Ana', email: 'ana@example.com' },
  eventId: 'evt_1',
  eventTitle: 'Track Day Interlagos',
  lines: [
    {
      id: 'ord_ticket_1:ticket',
      kind: 'ticket',
      label: 'Ingresso · Pista',
      sublabel: 'Track Day Interlagos',
      quantity: 2,
      unitPriceCents: null,
      subtotalCents: null,
    },
  ],
  history: [],
  refundImpact: { siblingOrderCount: 0, siblingTicketCount: 0, ownTicketCount: 2 },
  fulfillmentSurface: 'none',
  paidAt: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T11:00:00.000Z',
  ...over,
});

const render = async (detail: AdminOrderDetail) => {
  getAdminOrder.mockResolvedValue(detail);
  const ui = await Page({ params: Promise.resolve({ id: detail.id }) });
  return renderToStaticMarkup(ui);
};

describe('/pedidos/[id]', () => {
  it('renders a ticket order, which /loja/pedidos/[id] could never show', async () => {
    const html = await render(ticketOrder());
    expect(html).toContain('TICKET01');
    expect(html).toContain('Pedido de ingresso');
    expect(html).toContain('Ingresso · Pista');
    expect(html).toContain('Track Day Interlagos');
  });

  // The whole point of a separate surface: nothing here drives fulfillment.
  it('offers no fulfillment workflow for a kind that has none', async () => {
    const html = await render(ticketOrder());
    expect(html).not.toContain('Atualizar fulfillment');
    expect(html).not.toContain('Aguardando preparo');
    expect(html).not.toContain('Retirada');
    expect(html).not.toContain('/loja/pedidos/');
  });

  it('passes the full blast radius to the refund form, own tickets included', async () => {
    const html = await render(
      ticketOrder({
        refundImpact: { siblingOrderCount: 2, siblingTicketCount: 4, ownTicketCount: 2 },
      }),
    );
    expect(html).toContain('data-own-tickets="2"');
    expect(html).toContain('data-siblings="2"');
    expect(html).toContain('data-sibling-tickets="4"');
  });

  // Null prices mean "not itemised". Rendering them as R$ 0,00 would read as
  // free, so the price columns are dropped entirely for a legacy ticket order.
  it('never prints R$ 0,00 for a line that carries no price', async () => {
    const html = await render(ticketOrder());
    // Intl separa "R$" do número com NBSP, então a asserção olha só o número.
    expect(html).not.toMatch(/R\$\s0,00/);
    expect(html).not.toContain('Subtotal');
    expect(html).toContain('não tem valor por linha registrado');
    expect(html).toMatch(/Total: R\$\s300,00/);
  });

  it('renders no empty sections when the order has no lines and no history', async () => {
    const html = await render(ticketOrder({ lines: [], history: [] }));
    expect(html).not.toContain('Itens');
    expect(html).not.toContain('Histórico');
  });

  it('links a store order to the fulfillment queue instead of duplicating it', async () => {
    const html = await render(
      ticketOrder({ id: 'ord_prod_1', kind: 'product', fulfillmentSurface: 'store' }),
    );
    expect(html).toContain('/loja/pedidos/ord_prod_1');
    expect(html).not.toContain('Atualizar fulfillment');
  });

  it('404s when the API does not know the order', async () => {
    getAdminOrder.mockRejectedValue(new ApiError(404, 'NotFound', 'nope'));
    await expect(Page({ params: Promise.resolve({ id: 'nope' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalled();
  });
});
