import { prisma } from '@ccc/db';
import { incompleteProfileErrorSchema } from '@ccc/shared/profile-status';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { encryptField } from '../../src/services/crypto/field-encryption.js';
import type { FakeStripe } from '../../src/services/stripe/fake.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const CPF = '52998224725';
const PHONE = '11987654321';

const setCpfAndPhone = (userId: string) =>
  prisma.user.update({
    where: { id: userId },
    data: { cpf: encryptField(CPF, loadEnv().FIELD_ENCRYPTION_KEY), phone: PHONE },
  });

describe('subscription profile gate', () => {
  let app: FastifyInstance;
  let stripe: FakeStripe;

  beforeEach(async () => {
    await resetDatabase();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    process.env.PROFILE_GATE_ENABLED = 'true';
    process.env.PROFILE_GATE_ROLLOUT_PERCENT = '100';
    process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = 'price_gold_monthly';
    ({ app, stripe } = await makeAppWithFakeStripe());
  });

  afterEach(async () => {
    await app.close();
    delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
    await resetDatabase();
  });

  it('blocks the precheck with all three fields missing', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual([
      'cpf',
      'phone',
      'document',
    ]);
  });

  it('blocks the precheck on the document alone once cpf and phone are set', async () => {
    const { user } = await createUser({ verified: true });
    await setCpfAndPhone(user.id);
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['document']);
  });

  it('blocks POST /checkout and creates no Stripe session', async () => {
    const { user } = await createUser({ verified: true });
    await setCpfAndPhone(user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cadence: 'monthly' },
    });
    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['document']);
    // FakeStripe records every call in `calls` with a `kind` discriminator
    // (apps/api/src/services/stripe/fake.ts). No session may have been minted.
    expect(stripe.calls.filter((c) => c.kind === 'createSubscriptionCheckoutSession')).toHaveLength(
      0,
    );
  });

  it('lets a pending document through — optimistic auto-approval', async () => {
    const { user } = await createUser({ verified: true });
    await setCpfAndPhone(user.id);
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });

    const precheck = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(precheck.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cadence: 'monthly' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveProperty('url');
  });

  it('re-blocks after the document is rejected', async () => {
    const { user } = await createUser({ verified: true });
    await setCpfAndPhone(user.id);
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/a.jpg`,
        status: 'rejected',
        rejectionReason: 'Foto ilegível',
        reviewedAt: new Date(),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cadence: 'monthly' },
    });
    expect(res.statusCode).toBe(403);
    expect(incompleteProfileErrorSchema.parse(res.json()).missing).toEqual(['document']);
  });

  it('keeps the billing flag ahead of the profile gate', async () => {
    await app.close();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
    ({ app, stripe } = await makeAppWithFakeStripe());

    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    // 503 wins: an unavailable feature is not an incomplete profile.
    expect(res.statusCode).toBe(503);
  });

  it('is inert when the profile flag is off', async () => {
    await app.close();
    process.env.PROFILE_GATE_ENABLED = 'false';
    ({ app, stripe } = await makeAppWithFakeStripe());

    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(200);
  });
});
