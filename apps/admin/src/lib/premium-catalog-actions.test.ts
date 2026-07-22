import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const upsertAdminPremiumPrice =
  vi.fn<(id: string, cadence: string, payload: unknown) => Promise<unknown>>();
const replaceAdminPremiumBenefits = vi.fn<(id: string, payload: unknown) => Promise<unknown>>();
const createAdminPremiumModule = vi.fn<(payload: unknown) => Promise<unknown>>();

vi.mock('./admin-api', () => ({
  upsertAdminPremiumPrice: (id: string, cadence: string, payload: unknown) =>
    upsertAdminPremiumPrice(id, cadence, payload),
  replaceAdminPremiumBenefits: (id: string, payload: unknown) =>
    replaceAdminPremiumBenefits(id, payload),
  createAdminPremiumModule: (payload: unknown) => createAdminPremiumModule(payload),
  // Unused by these tests but imported by the module under test.
  createAdminPremiumPlan: vi.fn(),
  updateAdminPremiumPlan: vi.fn(),
  deleteAdminPremiumPlan: vi.fn(),
  updateAdminPremiumModule: vi.fn(),
  deleteAdminPremiumModule: vi.fn(),
}));

import {
  createModuleAction,
  replaceBenefitsAction,
  upsertPriceAction,
} from './premium-catalog-actions';

describe('premium-catalog-actions', () => {
  beforeEach(() => {
    upsertAdminPremiumPrice.mockReset().mockResolvedValue({});
    replaceAdminPremiumBenefits.mockReset().mockResolvedValue({});
    createAdminPremiumModule.mockReset().mockResolvedValue({});
  });

  it('upsertPriceAction coerces cents + clears blank provider ids to null', async () => {
    const fd = new FormData();
    fd.set('cadence', 'monthly');
    fd.set('baseAmountCents', '2990');
    fd.set('currency', 'BRL');
    fd.set('stripePriceId', '');
    fd.set('rcProductId', 'rc_1');
    fd.set('active', 'on');

    const result = await upsertPriceAction('plan-1', { error: null }, fd);
    expect(result).toEqual({ error: null });
    const call = upsertAdminPremiumPrice.mock.calls[0]!;
    expect(call[0]).toBe('plan-1');
    expect(call[1]).toBe('monthly');
    expect(call[2]).toEqual({
      baseAmountCents: 2990,
      currency: 'BRL',
      stripePriceId: null,
      rcProductId: 'rc_1',
      active: true,
    });
  });

  it('replaceBenefitsAction parses the JSON hidden field', async () => {
    const fd = new FormData();
    fd.set(
      'benefits',
      JSON.stringify([
        { label: 'A', sortOrder: 0 },
        { label: 'B', sortOrder: 1 },
      ]),
    );
    const result = await replaceBenefitsAction('plan-1', { error: null }, fd);
    expect(result).toEqual({ error: null });
    const call = replaceAdminPremiumBenefits.mock.calls[0]!;
    expect(call[1]).toEqual({
      benefits: [
        { label: 'A', sortOrder: 0 },
        { label: 'B', sortOrder: 1 },
      ],
    });
  });

  it('createModuleAction rejects an invalid body without calling the API', async () => {
    const fd = new FormData();
    fd.set('key', 'Bad Key!');
    fd.set('name', '');
    const result = await createModuleAction({ error: null }, fd);
    expect(result.error).toBeTruthy();
    expect(createAdminPremiumModule).not.toHaveBeenCalled();
  });
});
