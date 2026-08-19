import { prisma } from '@ccc/db';
import { HOME_CONTENT_SINGLETON_ID, homeContentResponseSchema } from '@ccc/shared/home';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from './helpers.js';

const GET = { method: 'GET' as const, url: '/api/home-content' };

// resetDatabase NÃO limpa o catálogo premium: a convenção do repo é cada spec
// que toca em planos limpar por conta própria, filhas antes das pais. Mesmo
// idiom de test/billing/premium-catalog.test.ts. Sem isso, um plano vazado de
// outro spec colide no unique de PremiumPlan.tier.
const resetPremiumCatalog = async (): Promise<void> => {
  await prisma.premiumPlanPrice.deleteMany();
  await prisma.premiumPlanBenefit.deleteMany();
  await prisma.premiumPlan.deleteMany();
};

const makePlan = (input: {
  tier: 'bronze' | 'silver' | 'gold';
  slug: string;
  name: string;
  sortOrder: number;
  active?: boolean;
  homeFeatured?: boolean;
  prices: { cadence: 'monthly' | 'annual'; baseAmountCents: number; active: boolean }[];
  benefits: string[];
}) =>
  prisma.premiumPlan.create({
    data: {
      tier: input.tier,
      slug: input.slug,
      name: input.name,
      sortOrder: input.sortOrder,
      active: input.active ?? true,
      homeFeatured: input.homeFeatured ?? true,
      prices: { create: input.prices.map((p) => ({ ...p, currency: 'BRL' })) },
      benefits: {
        create: input.benefits.map((label, index) => ({ label, sortOrder: index })),
      },
    },
  });

describe('GET /api/home-content', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await resetPremiumCatalog();
    app = await makeApp();
  });

  afterEach(async () => {
    await resetPremiumCatalog();
    await app.close();
  });

  it('responds 200 without auth and satisfies the shared schema', async () => {
    const res = await app.inject(GET);
    expect(res.statusCode).toBe(200);
    expect(() => homeContentResponseSchema.parse(res.json())).not.toThrow();
  });

  it('creates the singleton with defaults on first read', async () => {
    expect(await prisma.homeContent.count()).toBe(0);

    const res = await app.inject(GET);

    const body = homeContentResponseSchema.parse(res.json());
    expect(body.hero.title).toBe('DIRIGIR. CONECTAR. PERTENCER.');
    expect(body.hero.bannerUrl).toBeNull();
    expect(body.institutional.title).toBe('A Casa');
    expect(body.institutional.imageUrl).toBeNull();

    const row = await prisma.homeContent.findUnique({ where: { id: HOME_CONTENT_SINGLETON_ID } });
    expect(row).not.toBeNull();
  });

  it('returns persisted hero and institutional copy', async () => {
    await prisma.homeContent.create({
      data: {
        id: HOME_CONTENT_SINGLETON_ID,
        heroTitle: 'MOTE NOVO',
        heroSubtitle: 'Subtitulo',
        institutionalTitle: 'Titulo institucional',
        institutionalBody: 'Corpo institucional',
      },
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.hero.title).toBe('MOTE NOVO');
    expect(body.hero.subtitle).toBe('Subtitulo');
    expect(body.institutional.title).toBe('Titulo institucional');
    expect(body.institutional.body).toBe('Corpo institucional');
  });

  it('resolves objectKey columns into absolute urls', async () => {
    await prisma.homeContent.create({
      data: {
        id: HOME_CONTENT_SINGLETON_ID,
        heroBannerObjectKey: 'home/banner.webp',
        institutionalImageObjectKey: 'home/casa.webp',
      },
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.hero.bannerUrl).toContain('home/banner.webp');
    expect(body.institutional.imageUrl).toContain('home/casa.webp');
    expect(JSON.stringify(body)).not.toContain('objectKey');
  });

  it('hides inactive benefits and orders the active ones by sortOrder', async () => {
    await prisma.homeBenefit.createMany({
      data: [
        { icon: 'star', title: 'Segundo', active: true, sortOrder: 1 },
        { icon: 'tag', title: 'Oculto', active: false, sortOrder: 0 },
        { icon: 'sun', title: 'Primeiro', active: true, sortOrder: 0 },
      ],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.benefits.map((b) => b.title)).toEqual(['Primeiro', 'Segundo']);
  });

  it('hides inactive highlights and orders the active ones by sortOrder', async () => {
    await prisma.homeHighlight.createMany({
      data: [
        { kind: 'experience', title: 'Segundo', active: true, sortOrder: 1 },
        { kind: 'partner', title: 'Oculto', active: false, sortOrder: 0 },
        { kind: 'day_use', title: 'Primeiro', active: true, sortOrder: 0 },
      ],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.highlights.map((h) => h.title)).toEqual(['Primeiro', 'Segundo']);
    expect(body.highlights[0]!.kind).toBe('day_use');
  });

  it('uses the cheapest active price as fromAmountCents and caps benefits at three', async () => {
    await makePlan({
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      sortOrder: 0,
      prices: [
        { cadence: 'monthly', baseAmountCents: 49900, active: true },
        { cadence: 'annual', baseAmountCents: 39900, active: true },
      ],
      benefits: ['Um', 'Dois', 'Tres', 'Quatro'],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0]!.fromAmountCents).toBe(39900);
    expect(body.plans[0]!.currency).toBe('BRL');
    expect(body.plans[0]!.benefits).toEqual(['Um', 'Dois', 'Tres']);
  });

  it('ignores inactive prices when computing fromAmountCents', async () => {
    await makePlan({
      tier: 'silver',
      slug: 'prata',
      name: 'Prata',
      sortOrder: 0,
      prices: [
        { cadence: 'monthly', baseAmountCents: 29900, active: true },
        { cadence: 'annual', baseAmountCents: 9900, active: false },
      ],
      benefits: ['Um'],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.plans[0]!.fromAmountCents).toBe(29900);
  });

  it('excludes plans that are inactive, not featured, or have no active price', async () => {
    await makePlan({
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      sortOrder: 0,
      homeFeatured: false,
      prices: [{ cadence: 'monthly', baseAmountCents: 49900, active: true }],
      benefits: ['Um'],
    });
    await makePlan({
      tier: 'silver',
      slug: 'prata',
      name: 'Prata',
      sortOrder: 1,
      active: false,
      prices: [{ cadence: 'monthly', baseAmountCents: 29900, active: true }],
      benefits: ['Um'],
    });
    await makePlan({
      tier: 'bronze',
      slug: 'bronze',
      name: 'Bronze',
      sortOrder: 2,
      prices: [{ cadence: 'monthly', baseAmountCents: 19900, active: false }],
      benefits: ['Um'],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.plans).toEqual([]);
  });

  it('orders featured plans by sortOrder', async () => {
    await makePlan({
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      sortOrder: 2,
      prices: [{ cadence: 'monthly', baseAmountCents: 49900, active: true }],
      benefits: ['Um'],
    });
    await makePlan({
      tier: 'bronze',
      slug: 'bronze',
      name: 'Bronze',
      sortOrder: 0,
      prices: [{ cadence: 'monthly', baseAmountCents: 19900, active: true }],
      benefits: ['Um'],
    });

    const body = homeContentResponseSchema.parse((await app.inject(GET)).json());
    expect(body.plans.map((p) => p.slug)).toEqual(['bronze', 'ouro']);
  });

  it('never serializes provider price ids', async () => {
    await prisma.premiumPlan.create({
      data: {
        tier: 'gold',
        slug: 'ouro',
        name: 'Ouro',
        sortOrder: 0,
        active: true,
        homeFeatured: true,
        prices: {
          create: [
            {
              cadence: 'monthly',
              baseAmountCents: 49900,
              currency: 'BRL',
              active: true,
              stripePriceId: 'price_leak_me',
              rcProductId: 'rc_leak_me',
            },
          ],
        },
      },
    });

    const raw = (await app.inject(GET)).body;
    expect(raw).not.toContain('price_leak_me');
    expect(raw).not.toContain('rc_leak_me');
  });
});
