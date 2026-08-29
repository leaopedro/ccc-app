import { describe, expect, it } from 'vitest';

import { premiumCheckoutRejectionSchema } from '../premium.js';

describe('premiumCheckoutRejectionSchema', () => {
  it('aceita a rejeicao de anual mais add-on', () => {
    const parsed = premiumCheckoutRejectionSchema.parse({
      error: 'PremiumCheckoutRejected',
      code: 'ANNUAL_CADENCE_ADDON_UNSUPPORTED',
      message: 'Modulos adicionais sao mensais e nao podem ser contratados no plano anual.',
      addonKeys: ['detail'],
    });
    expect(parsed.code).toBe('ANNUAL_CADENCE_ADDON_UNSUPPORTED');
  });

  it('recusa um code que nao esta no catalogo de erros', () => {
    expect(() =>
      premiumCheckoutRejectionSchema.parse({
        error: 'PremiumCheckoutRejected',
        code: 'QUALQUER_COISA',
        message: 'x',
        addonKeys: [],
      }),
    ).toThrow();
  });
});
