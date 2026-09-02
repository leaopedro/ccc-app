import { describe, expect, it } from 'vitest';

import {
  PREVIOUS_PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_VERSION,
  privacyPolicySections,
} from '../legal.js';

const sectionBody = (id: string): string => {
  const section = privacyPolicySections.find((s) => s.id === id);
  if (!section) throw new Error(`section not found: ${id}`);
  return section.body;
};

describe('privacy policy — subscription processor', () => {
  it('names Stripe, not RevenueCat, in the payment prose', () => {
    const body = sectionBody('dados-coletados');
    expect(body).not.toMatch(/RevenueCat/i);
    expect(body).toMatch(/Assinaturas premium:.*\*\*Stripe\*\*/);
  });

  it('lists Stripe and not RevenueCat in the subprocessor table', () => {
    const body = sectionBody('compartilhamento');
    expect(body).not.toMatch(/RevenueCat/i);
    expect(body).toMatch(
      /\| Stripe \| Processamento de pagamentos com cart.o e gest.o de assinaturas \| EUA \| Operador \|/,
    );
  });

  it('bumps both version constants together', () => {
    expect(PRIVACY_POLICY_VERSION).toBe('privacy-2026-08-29');
    // Bumping the current version without moving the previous one makes
    // section 12 announce a predecessor two versions back.
    expect(PREVIOUS_PRIVACY_POLICY_VERSION).toBe('privacy-2026-08-14');
  });

  it('interpolates both versions into section 12', () => {
    const body = sectionBody('alteracoes');
    expect(body).toContain('privacy-2026-08-29');
    expect(body).toContain('privacy-2026-08-14');
  });
});
