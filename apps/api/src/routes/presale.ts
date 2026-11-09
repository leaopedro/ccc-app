/**
 * presale routes — public READ surface for the Casa In Box pre-sale.
 *
 *   GET /presale/casa-in-box/campaign  — commercial settings (shipping fee,
 *                                         pickup address, batch label, etc.)
 *   GET /presale/casa-in-box/products  — eligible products, no display price
 *
 * UNAUTHED. Consumed by SSR from apps/garage (the landing page) and by the
 * browser (box revalidation on the montagem/builder page). Tasks 7 and 9 add
 * the checkout and order-status handlers to this same plugin.
 *
 * The 503 killswitch below reads PresaleSettings.enabled. It is intentionally
 * its own preHandler, NOT storeRoutes' (routes/store.ts), which reads
 * storeSettings.storeEnabled — reusing that one would turn the pre-sale off
 * together with the store.
 */

import { presaleCampaignSchema, presaleProductListResponseSchema } from '@ccc/shared/presale';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { loadEligiblePresaleProducts } from '../services/presale/eligibility.js';
import { serializePresaleProduct } from '../services/presale/serialize.js';
import { ensurePresaleSettings } from '../services/presale/settings.js';

export const presaleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (_request, reply) => {
    const settings = await ensurePresaleSettings();
    if (settings.enabled) return;
    return reply
      .status(503)
      .send({ error: 'ServiceUnavailable', message: 'pré-venda está desligada' });
  });

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

  app.get('/presale/casa-in-box/campaign', async () => {
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

  app.get('/presale/casa-in-box/products', async () => {
    const products = await loadEligiblePresaleProducts();
    return presaleProductListResponseSchema.parse({
      items: products.map((product) => serializePresaleProduct(product, app.uploads)),
    });
  });
};
