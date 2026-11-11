/**
 * presale routes — public READ surface for the Casa In Box pre-sale.
 *
 *   GET  /presale/casa-in-box/campaign  — commercial settings (shipping fee,
 *                                          pickup address, batch label, etc.)
 *   GET  /presale/casa-in-box/products  — eligible products, no display price
 *   POST /presale/casa-in-box/checkout  — server-authoritative checkout
 *
 * UNAUTHED. Consumed by SSR from apps/garage (the landing page) and by the
 * browser (box revalidation on the montagem/builder page). Task 9 adds the
 * order-status handler to this same plugin.
 *
 * O killswitch (`requirePresaleEnabled`) reads PresaleSettings.enabled. It is
 * intentionally its own preHandler, NOT storeRoutes' (routes/store.ts), which
 * reads storeSettings.storeEnabled — reusing that one would turn the pre-sale
 * off together with the store.
 *
 * It is applied to the showcase (campaign/products) and checkout routes
 * ONLY — never to `/orders/status`. Someone who already paid has to be able
 * to follow their order after the campaign closes, and the status link in
 * the confirmation e-mail has to keep working; a dead campaign cannot take
 * down a paid buyer's receipt.
 */

import {
  presaleCampaignSchema,
  presaleCheckoutRequestSchema,
  presaleCheckoutResponseSchema,
  presaleOrderStatusResponseSchema,
  presaleProductListResponseSchema,
} from '@ccc/shared/presale';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { verifyQrCode } from '../lib/qr.js';
import { createPresaleOrder } from '../services/presale/checkout.js';
import { loadEligiblePresaleProducts } from '../services/presale/eligibility.js';
import { serializePresaleProduct } from '../services/presale/serialize.js';
import { ensurePresaleSettings } from '../services/presale/settings.js';
import { prisma } from '@ccc/db';

const requirePresaleEnabled = async (_request: FastifyRequest, reply: FastifyReply) => {
  const settings = await ensurePresaleSettings();
  if (settings.enabled) return;
  // Não dar `await` aqui: FastifyReply é thenable, e dar `await` num early
  // return de guarda já fez guarda silenciosamente sumir neste repo antes.
  return reply
    .status(503)
    .send({ error: 'ServiceUnavailable', message: 'pré-venda está desligada' });
};

export const presaleRoutes: FastifyPluginAsync = async (app) => {
  // `trustProxy` não está setado em app.ts (apps/api/src/app.ts:99-103), então
  // atrás do Railway `req.ip` é o endereço do proxy para todo mundo — esta
  // chave colapsa num ÚNICO BALDE GLOBAL, não um limite por cliente (mesma
  // consequência documentada em routes/premium-catalog.ts:78-86). Ligar
  // trustProxy consertaria isso, mas muda todo rate limit do app e é tarefa
  // própria, não esta.
  //
  // Dado isso, este teto não é proteção contra abuso — é backstop de banco
  // contra cliente em loop (um retry sem backoff, um deploy quebrado). Ele
  // precisa absorver sozinho o tráfego normal de um dia de lançamento: toda
  // carga da SSR da landing em apps/garage chama /campaign e /products, e a
  // página de montagem rechama /products a cada revalidação de CEP/caixa no
  // navegador — o tráfego de todo mundo soma no mesmo balde. Um teto apertado
  // derrubaria comprador legítimo justamente no pico. 6000/min (100 req/s)
  // cobre isso com folga e ainda pega um loop de verdade.
  await app.register(rateLimit, {
    max: 6000,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => `presale:${req.ip}`,
  });

  app.get('/presale/casa-in-box/campaign', { preHandler: requirePresaleEnabled }, async () => {
    const settings = await ensurePresaleSettings();
    return presaleCampaignSchema.parse({
      enabled: settings.enabled,
      shippingFeeCents: settings.shippingFeeCents,
      deliveryAreaLabel: settings.deliveryAreaLabel,
      pickupAddress: settings.pickupAddress,
      pickupHours: settings.pickupHours,
      firstBatchLabel: settings.firstBatchLabel,
    });
  });

  app.get('/presale/casa-in-box/products', { preHandler: requirePresaleEnabled }, async () => {
    const products = await loadEligiblePresaleProducts();
    return presaleProductListResponseSchema.parse({
      items: products.map((product) => serializePresaleProduct(product, app.uploads)),
    });
  });

  // Escopo próprio só para o checkout. O teto de 6000/min acima foi
  // dimensionado para LEITURA (SSR da landing + revalidação da caixa no
  // navegador); um POST que cria pedido e fala com a Stripe não deve herdar
  // aquele número. Registrado num contexto aninhado e com `hook: 'preHandler'`
  // igual ao de cima, para que este rode DEPOIS do teto herdado e o limite
  // efetivo seja o menor dos dois.
  //
  // Vale a mesma ressalva do comentário anterior: enquanto `trustProxy`
  // estiver desligado (app.ts:99-103), `req.ip` é o proxy do Railway para
  // todo mundo e este balde continua GLOBAL. Ou seja, continua sendo backstop
  // de banco contra cliente em loop, não proteção contra abuso — quem quiser
  // esgotar a campanha não é barrado aqui (e é por isso que o checkout
  // também não reserva estoque). 120/min (2 req/s) é folgado para o pico de
  // um lançamento e ainda pega um retry sem backoff.
  await app.register(async (scoped) => {
    await scoped.register(rateLimit, {
      max: 120,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => `presale-checkout:${req.ip}`,
    });
    // Killswitch depois do rate limit nesta mesma escopo: roda só pra quem
    // não foi barrado pelo teto acima.
    scoped.addHook('preHandler', requirePresaleEnabled);

    scoped.post('/presale/casa-in-box/checkout', async (request, reply) => {
      const parsed = presaleCheckoutRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          code: 'PRESALE_INVALID_REQUEST',
          message: 'dados do pedido inválidos',
        });
      }

      const result = await createPresaleOrder(
        {
          ...parsed.data,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        },
        { stripe: app.stripe, env: app.env, log: request.log },
      );

      if (!result.ok) {
        return reply.status(result.status).send({
          error: result.error,
          code: result.code,
          message: result.message,
          ...(result.variantIds ? { variantIds: result.variantIds } : {}),
          ...(result.totalCents === undefined ? {} : { totalCents: result.totalCents }),
        });
      }

      return reply.status(201).send(
        presaleCheckoutResponseSchema.parse({
          orderId: result.orderId,
          checkoutUrl: result.checkoutUrl,
          amountCents: result.amountCents,
          shippingCents: result.shippingCents,
          currency: result.currency,
        }),
      );
    });
  });

  app.post('/presale/casa-in-box/orders/status', async (request, reply) => {
    const statusRequestSchema = z.object({
      orderId: z.string().min(1),
      token: z.string().min(1),
    });

    const parsed = statusRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(422).send({
        error: 'UnprocessableEntity',
        message: 'dados invalidos',
      });
    }

    const { orderId, token } = parsed.data;

    // Verify token: verifyQrCode throws on invalid token
    try {
      const verified = verifyQrCode(token, app.env);
      // Token must be the presale-status kind, and must match the orderId
      if (verified.kind !== 'p' || verified.id !== orderId) {
        return reply.status(404).send({
          error: 'NotFound',
          message: 'pedido nao encontrado',
        });
      }
    } catch {
      // Token invalid or malformed
      return reply.status(404).send({
        error: 'NotFound',
        message: 'pedido nao encontrado',
      });
    }

    // Load order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        amountCents: true,
        shippingCents: true,
        currency: true,
        fulfillmentMethod: true,
        presaleGuest: {
          select: {
            recipientName: true,
            line1: true,
            number: true,
            district: true,
            city: true,
            stateCode: true,
            postalCode: true,
          },
        },
        items: {
          select: {
            quantity: true,
            unitPriceCents: true,
            subtotalCents: true,
            variant: {
              select: {
                product: {
                  select: { title: true },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      return reply.status(404).send({
        error: 'NotFound',
        message: 'pedido nao encontrado',
      });
    }

    const guest = order.presaleGuest;
    const delivery =
      order.fulfillmentMethod === 'ship' &&
      guest?.recipientName &&
      guest.line1 &&
      guest.number &&
      guest.district &&
      guest.city &&
      guest.stateCode &&
      guest.postalCode
        ? {
            recipientName: guest.recipientName,
            line1: guest.line1,
            number: guest.number,
            district: guest.district,
            city: guest.city,
            stateCode: guest.stateCode,
            postalCode: guest.postalCode,
          }
        : null;

    // Return order status
    return reply.status(200).send(
      presaleOrderStatusResponseSchema.parse({
        orderId: order.id,
        status: order.status,
        fulfillmentMethod: order.fulfillmentMethod,
        amountCents: order.amountCents,
        shippingCents: order.shippingCents,
        currency: order.currency,
        items: order.items.map((item) => ({
          title: item.variant?.product?.title ?? 'Desconhecido',
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          subtotalCents: item.subtotalCents,
        })),
        delivery,
      }),
    );
  });
};
