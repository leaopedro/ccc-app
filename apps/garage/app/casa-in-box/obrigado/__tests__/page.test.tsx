import type { PresaleOrderStatusResponse } from '@ccc/shared/presale';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  OrderStatusView,
  type OrderDisplayStatus,
} from '../../../../src/components/presale/OrderStatusView';

import { presaleCopy } from '~/copy/presale';

const shipOrder: PresaleOrderStatusResponse = {
  orderId: 'order_1',
  status: 'paid',
  fulfillmentMethod: 'ship',
  amountCents: 23900,
  shippingCents: 1900,
  currency: 'BRL',
  items: [{ title: 'Caixa Essencial', quantity: 1, unitPriceCents: 22000, subtotalCents: 22000 }],
  delivery: {
    recipientName: 'Fulano de Tal',
    line1: 'Rua das Flores',
    number: '123',
    district: 'Centro',
    city: 'São Paulo',
    stateCode: 'SP',
    postalCode: '01000-000',
  },
};

const pickupOrder: PresaleOrderStatusResponse = {
  ...shipOrder,
  fulfillmentMethod: 'pickup',
  delivery: null,
};

describe('OrderStatusView', () => {
  it.each<OrderDisplayStatus>(['pending', 'paid', 'refunded', 'failed'])(
    'cobre o estado %s com a copy daquele estado',
    (status) => {
      const html = renderToStaticMarkup(<OrderStatusView status={status} order={shipOrder} />);
      expect(html).toContain(presaleCopy.orderStatus[status].title);
      expect(html).not.toContain('undefined');
    },
  );

  it('pending avisa que a confirmação pode levar instantes', () => {
    const html = renderToStaticMarkup(<OrderStatusView status="pending" order={shipOrder} />);
    expect(html).toContain(presaleCopy.orderStatus.pending.body);
  });

  it('paid mostra a composição do pedido e o endereço de entrega', () => {
    const html = renderToStaticMarkup(<OrderStatusView status="paid" order={shipOrder} />);
    expect(html).toContain('Caixa Essencial');
    expect(html).toContain('Rua das Flores');
    expect(html).toContain('123');
    expect(html).not.toContain('undefined');
  });

  it('paid na retirada mostra o endereço de retirada da campanha, não um endereço de entrega vazio', () => {
    const html = renderToStaticMarkup(
      <OrderStatusView
        status="paid"
        order={pickupOrder}
        pickupAddress="Pocket CASA, Rua Augusta 500"
      />,
    );
    expect(html).toContain('Pocket CASA, Rua Augusta 500');
    expect(html).not.toContain(presaleCopy.orderStatus.paid.pickupFallback);
    expect(html).not.toContain('undefined');
  });

  it('paid na retirada sem endereço de campanha ainda cai no fallback, nunca em branco', () => {
    const html = renderToStaticMarkup(<OrderStatusView status="paid" order={pickupOrder} />);
    expect(html).toContain(presaleCopy.orderStatus.paid.pickupFallback);
    expect(html).not.toContain('undefined');
  });

  it('refunded explica o estorno', () => {
    const html = renderToStaticMarkup(<OrderStatusView status="refunded" order={shipOrder} />);
    expect(html).toContain(presaleCopy.orderStatus.refunded.title);
    expect(html).toContain(presaleCopy.orderStatus.refunded.body);
  });

  it('failed oferece tentar de novo', () => {
    const html = renderToStaticMarkup(<OrderStatusView status="failed" order={shipOrder} />);
    expect(html).toContain(presaleCopy.orderStatus.failed.retryCta);
  });
});
