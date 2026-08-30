/**
 * Task 12 — tags de Sentry dos modos de falha novos.
 *
 * Cobre apenas o modo de falha exclusivo desta task que ainda nao tinha
 * cobertura de teste: `premium-native-subscription-no-secret`, emitido em
 * `me-premium.ts` no ramo `if (!result.clientSecret)`. As outras duas tags
 * do plano (`stripe-stale-cart-version`, Task 6; `order-expiry-cancel-failed`,
 * emitida nesta mesma task) ja tem ou ganham cobertura em seus proprios
 * arquivos de teste (`stripe-webhook.test.ts` / `order-expiry.test.ts`).
 */
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => {
  const noop = () => {};
  return {
    init: vi.fn(),
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    withScope: (
      cb: (scope: {
        setTag: typeof noop;
        setLevel: typeof noop;
        setExtras: typeof noop;
        setExtra: typeof noop;
        setContext: typeof noop;
      }) => void,
    ) => cb({ setTag: noop, setLevel: noop, setExtras: noop, setExtra: noop, setContext: noop }),
  };
});

const Sentry = (await import('@sentry/node')) as unknown as {
  captureMessage: ReturnType<typeof vi.fn>;
};

import { loadEnv } from '../../src/env.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const resetCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
  await prisma.premiumAddonModule.deleteMany();
};

const seedGoldMonthly = async () => {
  const plan = await prisma.premiumPlan.create({
    data: { tier: 'gold', slug: 'fundador', name: 'Fundador', sortOrder: 1, active: true },
  });
  await prisma.premiumPlanPrice.create({
    data: {
      planId: plan.id,
      cadence: 'monthly',
      baseAmountCents: 24_990,
      currency: 'BRL',
      stripePriceId: 'price_gold_monthly',
    },
  });
};

describe('tags de Sentry dos modos de falha novos', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    await resetCatalog();
    ({ app, stripe } = await makeAppWithFakeStripe());
    await seedGoldMonthly();
  });

  afterEach(async () => {
    await app.close();
  });

  it('emite premium-native-subscription-no-secret quando a assinatura vem sem confirmation_secret', async () => {
    Sentry.captureMessage.mockClear();
    const { user } = await createUser({ verified: true });

    stripe.nextNativeSubscription = {
      subscriptionId: 'sub_sem_segredo',
      clientSecret: null,
      status: 'incomplete',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout-native',
      headers: { authorization: bearer(env, user.id), 'x-ccc-platform': 'ios' },
      payload: { cadence: 'monthly', planSlug: 'fundador' },
    });

    expect(res.statusCode).toBe(503);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tags: expect.objectContaining({ kind: 'premium-native-subscription-no-secret' }),
      }),
    );
  });
});
