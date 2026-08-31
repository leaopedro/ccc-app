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

  it('flattens the single-plan response with the gate, not nested under a `plan` key', () => {
    // Fix (final review, Important 2): this route used to wrap the plan in
    // `{ plan, subscriptionsEnabled }`. Already-shipped binaries call this
    // route and parse the bare plan shape directly, so re-nesting it would
    // throw on every installed app. The flattened shape must carry every
    // `premiumPlanSchema` field alongside the gate, at the top level.
    const parsed = premiumPlanDetailResponseSchema.parse({ ...plan, subscriptionsEnabled: true });
    expect(parsed).toMatchObject({ ...plan, subscriptionsEnabled: true });
    expect(parsed).not.toHaveProperty('plan');
  });

  it('requires subscriptionsEnabled on the single-plan response too', () => {
    expect(() => premiumPlanDetailResponseSchema.parse(plan)).toThrow();
  });
});
