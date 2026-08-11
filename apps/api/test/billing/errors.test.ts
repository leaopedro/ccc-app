import { describe, expect, it } from 'vitest';

import { BillingActionError, isBillingActionError } from '../../src/services/billing/errors.js';

describe('BillingActionError', () => {
  it('carrega codigo, status e detalhe', () => {
    const err = new BillingActionError('InvalidStatus', 'status atual: expired', {
      status: 'expired',
    });
    expect(err.code).toBe('InvalidStatus');
    expect(err.httpStatus).toBe(409);
    expect(err.message).toBe('status atual: expired');
    expect(err.detail).toEqual({ status: 'expired' });
  });

  it('mapeia cada codigo para o status HTTP certo', () => {
    const cases: Array<[string, number]> = [
      ['MembershipNotFound', 404],
      ['ModuleNotFound', 404],
      ['AddonNotAttached', 404],
      ['AddonAlreadyAttached', 409],
      ['InvalidStatus', 409],
      ['ProviderNotMutable', 409],
      ['NoChange', 409],
      ['AmbiguousPlanItem', 409],
      ['PlanPriceMissing', 422],
    ];
    for (const [code, status] of cases) {
      expect(new BillingActionError(code as never, 'x').httpStatus).toBe(status);
    }
  });

  it('e reconhecivel pelo type guard e nao confunde erro comum', () => {
    expect(isBillingActionError(new BillingActionError('NoChange', 'x'))).toBe(true);
    expect(isBillingActionError(new Error('x'))).toBe(false);
    expect(isBillingActionError(null)).toBe(false);
  });
});
