import { describe, expect, it } from 'vitest';

import {
  HOME_CONTENT_SINGLETON_ID,
  HOME_PLAN_BENEFITS_LIMIT,
  homeContentResponseSchema,
  homeHighlightKindSchema,
} from '../home.js';

const VALID = {
  hero: {
    title: 'DIRIGIR. CONECTAR. PERTENCER.',
    subtitle: null,
    bannerUrl: null,
  },
  institutional: {
    title: 'A Casa',
    body: 'Um clubhouse automotivo privado em Curitiba.',
    imageUrl: 'https://cdn.example.com/casa.webp',
  },
  benefits: [
    {
      icon: 'calendar',
      title: 'Eventos exclusivos',
      description: 'Encontros fechados.',
      sortOrder: 0,
    },
  ],
  highlights: [
    {
      kind: 'day_use',
      title: 'Day Use',
      subtitle: null,
      imageUrl: null,
      linkPath: null,
      sortOrder: 0,
    },
  ],
  plans: [
    {
      tier: 'gold',
      slug: 'ouro',
      name: 'Ouro',
      description: null,
      fromAmountCents: 49900,
      currency: 'BRL',
      benefits: ['Day Use ilimitado'],
      sortOrder: 0,
    },
  ],
} as const;

describe('homeContentResponseSchema', () => {
  it('constants match the DB singleton id and the benefits cap', () => {
    expect(HOME_CONTENT_SINGLETON_ID).toBe('home_default');
    expect(HOME_PLAN_BENEFITS_LIMIT).toBe(3);
  });

  it('pins the highlight kind enum to the Prisma HomeHighlightKind values', () => {
    // Mirrors packages/db/prisma/schema.prisma's HomeHighlightKind enum, in order.
    expect(homeHighlightKindSchema.options).toEqual(['event', 'day_use', 'experience', 'partner']);
  });

  it('accepts a full valid payload', () => {
    const result = homeContentResponseSchema.parse(VALID);
    expect(result).toMatchObject(VALID);
  });

  it('rejects an unknown highlight kind', () => {
    const bad = { ...VALID, highlights: [{ ...VALID.highlights[0], kind: 'meetup' }] };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('rejects a non-url bannerUrl', () => {
    const bad = { ...VALID, hero: { ...VALID.hero, bannerUrl: 'not-a-url' } };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('rejects a negative fromAmountCents', () => {
    const bad = { ...VALID, plans: [{ ...VALID.plans[0], fromAmountCents: -1 }] };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('accepts empty benefits, highlights and plans', () => {
    const empty = { ...VALID, benefits: [], highlights: [], plans: [] };
    const result = homeContentResponseSchema.parse(empty);
    expect(result).toMatchObject(empty);
  });

  it('rejects an empty hero title', () => {
    const bad = { ...VALID, hero: { ...VALID.hero, title: '' } };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('rejects an empty institutional body', () => {
    const bad = { ...VALID, institutional: { ...VALID.institutional, body: '' } };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('rejects an empty benefit title', () => {
    const bad = { ...VALID, benefits: [{ ...VALID.benefits[0], title: '' }] };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('rejects an empty highlight title', () => {
    const bad = { ...VALID, highlights: [{ ...VALID.highlights[0], title: '' }] };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('rejects an empty plan name', () => {
    const bad = { ...VALID, plans: [{ ...VALID.plans[0], name: '' }] };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('rejects a currency that is not exactly 3 characters', () => {
    const bad = { ...VALID, plans: [{ ...VALID.plans[0], currency: 'US' }] };
    expect(() => homeContentResponseSchema.parse(bad)).toThrow();
  });

  it('strips unknown keys from a parsed plan, so provider ids cannot leak through', () => {
    const withExtra = {
      ...VALID,
      plans: [{ ...VALID.plans[0], stripePriceId: 'price_123' }],
    };
    const result = homeContentResponseSchema.parse(withExtra);
    expect(result.plans[0]).not.toHaveProperty('stripePriceId');
  });

  it('rejects a payload missing a required top-level field', () => {
    const { plans: _plans, ...missingPlans } = VALID;
    expect(() => homeContentResponseSchema.parse(missingPlans)).toThrow();
  });
});
