import { describe, expect, it } from 'vitest';
import { resolveCaixaSlot } from './caixa-slot';

describe('resolveCaixaSlot', () => {
  it('shows caixa for an active member when the feature is enabled', () => {
    expect(resolveCaixaSlot({ caixaEnabled: true, premiumActive: true })).toBe('caixa');
  });
  it('shows assinaturas for a free user when enabled', () => {
    expect(resolveCaixaSlot({ caixaEnabled: true, premiumActive: false })).toBe('assinaturas');
  });
  it('always shows assinaturas when the feature is disabled', () => {
    expect(resolveCaixaSlot({ caixaEnabled: false, premiumActive: true })).toBe('assinaturas');
  });
});
