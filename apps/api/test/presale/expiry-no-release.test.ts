// CRITICAL fix: order-expiry.ts só passou a enxergar pedido de pré-venda
// Pix depois que esta branch passou a gravar `Order.expiresAt` para a janela
// de 1h (services/presale/checkout.ts). A pré-venda NÃO reserva estoque no
// checkout — o débito só acontece na liquidação
// (services/orders/settle.ts: debitPresaleStock) — então
// `releaseAllReservationsForOrders` (services/orders/expire.ts) tem que
// pular esses pedidos, nunca tocar `Variant.quantitySold` por causa deles.
//
// Os dois testes abaixo passam pelo CAMINHO REAL de expiração
// (runOrderExpiryTick), nunca escrevendo `status: 'expired'` direto pelo
// Prisma — é exatamente esse atalho que escondeu o bug no teste da Task 5
// (pix-recovery.test.ts).
import { prisma } from '@ccc/db';
import { PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FakeAbacatePay } from '../../src/services/abacatepay/fake.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { runOrderExpiryTick } from '../../src/workers/order-expiry.js';
import { makeAppWithFakes, resetDatabase } from '../helpers.js';

import { createPresaleProduct, setPresaleSettings } from './fixtures.js';

const CHECKOUT_URL = '/presale/casa-in-box/checkout';

describe('order-expiry.ts não libera reserva de pedido de pré-venda Pix', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;
  let abacatepay: FakeAbacatePay;
  let requestCounter = 0;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.presaleSettings.deleteMany();
    await setPresaleSettings({ enabled: true, shippingFeeCents: 1990 });

    const built = await makeAppWithFakes();
    app = built.app;
    stripe = built.stripe;
    abacatepay = built.abacatepay;
  });

  afterEach(async () => {
    await app.close();
  });

  /** Cria o pedido de pré-venda Pix pelo endpoint público real de checkout,
   * nunca direto pelo Prisma — é o mesmo caminho que um comprador percorre. */
  const seedPresalePixOrder = async (opts: { quantity?: number; priceCents?: number } = {}) => {
    const quantity = opts.quantity ?? 2;
    const priceCents = opts.priceCents ?? 9900;
    const product = await createPresaleProduct(
      { allowPickup: true },
      { variants: [{ priceCents, quantityTotal: 10 }] },
    );
    const variantId = product.variants[0]!.id;

    const res = await app.inject({
      method: 'POST',
      url: CHECKOUT_URL,
      payload: {
        clientRequestId: `req-expiry-no-release-${++requestCounter}-${Math.random()
          .toString(36)
          .slice(2, 10)}`,
        expectedTotalCents: priceCents * quantity,
        fulfillmentMethod: 'pickup',
        paymentMethod: 'pix',
        items: [{ variantId, quantity }],
        guest: { name: 'Comprador Pix', email: 'comprador.pix@exemplo.com' },
        acceptedTermsVersion: 'terms-2026-01-01',
        acceptedPrivacyVersion: PRIVACY_POLICY_VERSION,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`checkout pix de pré-venda falhou: ${res.statusCode} ${res.body}`);
    }
    const body = res.json() as { orderId: string };
    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    return { order, variantId };
  };

  it('pedido de pré-venda Pix vencido expira de verdade e NÃO toca quantitySold de variante nenhuma', async () => {
    const { order, variantId } = await seedPresalePixOrder();
    expect(order.expiresAt).not.toBeNull();
    expect(order.origin).toBe('casa_in_box');

    const before = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
    expect(before.quantitySold).toBe(0); // checkout nunca reserva

    // `now` passado como dependência, derivado do expiresAt real do pedido —
    // nunca um carimbo de data fixo.
    const result = await runOrderExpiryTick({
      stripe,
      now: new Date(order.expiresAt!.getTime() + 1000),
    });

    expect(result.expired).toBe(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('expired'); // caminho real de expiração, de verdade no banco

    const afterVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
    expect(afterVariant.quantitySold).toBe(0);
  });

  it('caso de corrupção: quantitySold alto por causa de OUTROS pedidos continua EXATAMENTE o mesmo depois da expiração da pré-venda', async () => {
    const { order, variantId } = await seedPresalePixOrder({ quantity: 1 });

    // Simula outros clientes reais que compraram essa mesma variante pelo
    // carrinho (reserva de verdade, Variant.quantitySold incrementado).
    // Qualquer valor >= a quantidade do pedido de pré-venda bastaria para o
    // guard de assertReservationReleased passar silenciosamente — o ponto do
    // teste é que ele não pode nem tentar.
    await prisma.variant.update({
      where: { id: variantId },
      data: { quantitySold: { increment: 7 } },
    });
    const before = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
    expect(before.quantitySold).toBe(7);

    const result = await runOrderExpiryTick({
      stripe,
      now: new Date(order.expiresAt!.getTime() + 1000),
    });

    expect(result.expired).toBe(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('expired');

    const afterVariant = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
    expect(afterVariant.quantitySold).toBe(7); // inalterado — nada foi revendido/abatido
  });

  it('não chama o AbacatePay/Stripe de forma alguma; só o worker roda', async () => {
    // Guarda-chuva: nenhum teste acima deveria ter disparado uma segunda
    // chamada de provedor durante o tick de expiração.
    const { order } = await seedPresalePixOrder();
    const callsBefore = abacatepay.calls.length;

    await runOrderExpiryTick({ stripe, now: new Date(order.expiresAt!.getTime() + 1000) });

    expect(abacatepay.calls.length).toBe(callsBefore);
  });
});
