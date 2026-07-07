/**
 * premium-pricing route — F8.20 (gap #4).
 *
 * GET /api/premium/pricing — UNAUTHED, flag-gated. Returns the catalog of
 * the monthly + annual Gold prices currently configured in Stripe.
 *
 * Used by:
 *   F8.17 — apps/admin /premium page
 *   F8.18 — apps/mobile Premium screen
 *
 * Both surfaces render pricing BEFORE the user signs in, so no auth
 * preHandler is attached. The route reads:
 *   STRIPE_PRICE_PREMIUM_GOLD_MONTHLY
 *   STRIPE_PRICE_PREMIUM_GOLD_ANNUAL
 * from env, fetches each Stripe Price via app.stripe.retrievePrice, parses
 * metadata.{baseAmountCents,devFeePercent} as integers, computes
 *   devFeeCents = Math.round(baseAmountCents * devFeePercent / 100)
 *   grossAmountCents = baseAmountCents + devFeeCents
 * (canon §F8.1 + canon Stripe gross formula), and returns the parsed
 * response.
 *
 * Failure modes:
 *   503 ServiceUnavailable — flag off OR env missing OR Stripe call throws
 *   500 PricingMetadataMissing — Stripe Price metadata invalid / unparseable
 */

import { premiumPricingResponseSchema } from '@jdm/shared/premium';
import type { FastifyPluginAsync } from 'fastify';

type Cadence = 'monthly' | 'annual';

const parsePositiveInt = (value: string | undefined): number | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const parsePercent = (value: string | undefined): number | null => {
  const parsed = parsePositiveInt(value);
  if (parsed === null) return null;
  if (parsed > 100) return null;
  return parsed;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const premiumPricingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/premium/pricing', async (request, reply) => {
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
    }

    const monthlyId = app.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
    const annualId = app.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;

    if (!monthlyId || !annualId) {
      request.log.error(
        { hasMonthly: Boolean(monthlyId), hasAnnual: Boolean(annualId) },
        'premium-pricing: STRIPE_PRICE_PREMIUM_GOLD_* env vars missing',
      );
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'billing price not configured' });
    }

    // Fetch both prices in parallel. If either throws, return 503 — the page
    // can show a retry button. We do NOT return a partial response (canon
    // "Always returns both cadences").
    let monthlyPrice;
    let annualPrice;
    try {
      [monthlyPrice, annualPrice] = await Promise.all([
        app.stripe.retrievePrice(monthlyId),
        app.stripe.retrievePrice(annualId),
      ]);
    } catch (err) {
      request.log.error({ err }, 'premium-pricing: Stripe Price retrieval failed');
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'pricing temporarily unavailable' });
    }

    const buildEntry = (priceId: string, cadence: Cadence, price: typeof monthlyPrice) => {
      const baseAmountCents = parsePositiveInt(price.metadata?.baseAmountCents);
      const devFeePercent = parsePercent(price.metadata?.devFeePercent);
      if (baseAmountCents === null || devFeePercent === null) {
        return null;
      }
      const devFeeCents = Math.round((baseAmountCents * devFeePercent) / 100);
      const grossAmountCents = baseAmountCents + devFeeCents;
      return {
        priceId,
        cadence,
        baseAmountCents,
        devFeePercent,
        devFeeCents,
        grossAmountCents,
        currency: price.currency.toUpperCase(),
      };
    };

    const monthly = buildEntry(monthlyId, 'monthly', monthlyPrice);
    const annual = buildEntry(annualId, 'annual', annualPrice);

    if (!monthly || !annual) {
      request.log.error(
        {
          monthlyOk: Boolean(monthly),
          annualOk: Boolean(annual),
          monthlyMetadata: monthlyPrice.metadata,
          annualMetadata: annualPrice.metadata,
        },
        'premium-pricing: Stripe Price metadata missing or unparseable',
      );
      return reply.status(500).send({
        error: 'PricingMetadataMissing',
        message: 'Stripe Price metadata is missing baseAmountCents or devFeePercent',
      });
    }

    return reply.status(200).send(premiumPricingResponseSchema.parse({ monthly, annual }));
  });
};
