import { describe, expect, it } from 'vitest';

import {
  premiumPlanDetailResponseSchema,
  premiumPlanListResponseSchema,
} from '../premium-catalog.js';

const plan = {
  tier: 'gold' as const,
  slug: 'fundador',
  name: 'Fundador',
  description: null,
  sortOrder: 3,
  prices: [{ cadence: 'monthly' as const, baseAmountCents: 24990, currency: 'BRL' }],
  benefits: [{ label: 'Acesso ao clube 24 horas', sortOrder: 1 }],
};

describe('premium catalog response schemas', () => {
  it('requires subscriptionsEnabled on the list response', () => {
    expect(() => premiumPlanListResponseSchema.parse({ plans: [plan] })).toThrow();
    expect(
      premiumPlanListResponseSchema.parse({ plans: [plan], subscriptionsEnabled: false }),
    ).toMatchObject({ subscriptionsEnabled: false });
  });

  it('wraps the single-plan response so it can carry the gate', () => {
    expect(
      premiumPlanDetailResponseSchema.parse({ plan, subscriptionsEnabled: true }),
    ).toMatchObject({ subscriptionsEnabled: true, plan: { slug: 'fundador' } });
  });
});
