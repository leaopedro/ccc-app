import { describe, expect, it } from 'vitest';

import {
  adminSubscriptionActionResponseSchema,
  adminSubscriptionAddonMutationResponseSchema,
  adminSubscriptionChangePlanSchema,
  adminSubscriptionDetailSchema,
} from '../admin-subscription.js';

const validDetail = {
  membershipId: 'mem_1',
  userId: 'usr_1',
  userName: 'Ana',
  userEmail: 'ana@example.com',
  garageId: 'gar_1',
  garageSlug: 'ana',
  tier: 'gold' as const,
  planSlug: 'fundador',
  planName: 'Fundador',
  cadence: 'monthly' as const,
  status: 'active' as const,
  provider: 'stripe' as const,
  currentPeriodStart: '2026-08-01T00:00:00.000Z',
  currentPeriodEnd: '2026-09-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  baseAmountCents: 149000,
  addonsAmountCents: 15000,
  totalAmountCents: 164000,
  currency: 'BRL',
  paymentBrand: 'visa',
  paymentLast4: '4242',
  mutable: true,
  addons: [
    {
      key: 'detailing',
      name: 'Detailing',
      vendorName: 'Lava Rápido X',
      status: 'active' as const,
      quotaUnit: 'access' as const,
      quotaPerCycle: 3,
      monthlyDeltaCents: 15000,
      payoutAmountCents: 9000,
      marginCents: 6000,
      billingIntegrated: true,
      currentCycle: {
        cycleStart: '2026-08-01T00:00:00.000Z',
        cycleEnd: '2026-09-01T00:00:00.000Z',
        quotaTotal: 3,
        quotaUsed: 1,
        quotaRemaining: 2,
      },
    },
  ],
  invoices: [
    {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-01T00:00:00.000Z',
      paidAt: '2026-07-01T03:00:00.000Z',
      grossAmountCents: 164000,
      addonsAmountCents: 15000,
      currency: 'BRL',
      status: 'paid',
      refundedAt: null,
      refundedAmountCents: null,
    },
  ],
};

describe('adminSubscriptionDetailSchema', () => {
  it('aceita um detalhe completo', () => {
    expect(adminSubscriptionDetailSchema.parse(validDetail)).toEqual(validDetail);
  });

  it('aceita metodo de pagamento e ciclo ausentes', () => {
    const parsed = adminSubscriptionDetailSchema.parse({
      ...validDetail,
      paymentBrand: null,
      paymentLast4: null,
      addons: [{ ...validDetail.addons[0], currentCycle: null }],
    });
    expect(parsed.paymentBrand).toBeNull();
    expect(parsed.addons[0]?.currentCycle).toBeNull();
  });

  it('rejeita tier fora do enum', () => {
    expect(() =>
      adminSubscriptionDetailSchema.parse({ ...validDetail, tier: 'platinum' }),
    ).toThrow();
  });
});

describe('adminSubscriptionChangePlanSchema', () => {
  it('aceita tier e cadence validos', () => {
    expect(adminSubscriptionChangePlanSchema.parse({ tier: 'silver', cadence: 'monthly' })).toEqual({
      tier: 'silver',
      cadence: 'monthly',
    });
  });

  it('rejeita corpo sem cadence', () => {
    expect(() => adminSubscriptionChangePlanSchema.parse({ tier: 'silver' })).toThrow();
  });
});

describe('respostas de acao', () => {
  it('acao de provider e sempre pendente', () => {
    expect(adminSubscriptionActionResponseSchema.parse({ ok: true, pending: true })).toEqual({
      ok: true,
      pending: true,
    });
    expect(() =>
      adminSubscriptionActionResponseSchema.parse({ ok: true, pending: false }),
    ).toThrow();
  });

  it('mutacao de modulo nunca e pendente e devolve os totais', () => {
    expect(
      adminSubscriptionAddonMutationResponseSchema.parse({
        ok: true,
        pending: false,
        addonKey: 'detailing',
        status: 'active',
        addonsAmountCents: 15000,
        totalAmountCents: 164000,
      }),
    ).toMatchObject({ pending: false, addonKey: 'detailing' });
  });
});
