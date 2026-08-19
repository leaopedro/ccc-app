import { describe, expect, it } from 'vitest';

import {
  HOME_CONTENT_SINGLETON_ID,
  HOME_PLAN_BENEFITS_LIMIT,
  homeContentResponseSchema,
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
    { icon: 'calendar', title: 'Eventos exclusivos', description: 'Encontros fechados.', sortOrder: 0 },
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

  it('accepts a full valid payload', () => {
    expect(() => homeContentResponseSchema.parse(VALID)).not.toThrow();
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
    expect(() => homeContentResponseSchema.parse(empty)).not.toThrow();
  });
});
