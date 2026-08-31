import { describe, expect, it } from 'vitest';
import { resolveCaixaSlot } from './caixa-slot';

describe('resolveCaixaSlot', () => {
  it('shows caixa for an active member when the feature is enabled', () => {
    expect(
      resolveCaixaSlot({ caixaEnabled: true, premiumActive: true, subscriptionsEnabled: true }),
    ).toBe('caixa');
  });
  it('shows assinaturas for a free user when enabled', () => {
    expect(
      resolveCaixaSlot({ caixaEnabled: true, premiumActive: false, subscriptionsEnabled: true }),
    ).toBe('assinaturas');
  });
  it('shows assinaturas when caixa is disabled and subscriptions are open', () => {
    expect(
      resolveCaixaSlot({ caixaEnabled: false, premiumActive: true, subscriptionsEnabled: true }),
    ).toBe('assinaturas');
  });
  it('empties the slot when caixa is off and subscriptions are gated', () => {
    expect(
      resolveCaixaSlot({ caixaEnabled: false, premiumActive: false, subscriptionsEnabled: false }),
    ).toBe('none');
  });
  it('keeps assinaturas when the gate is on', () => {
    expect(
      resolveCaixaSlot({ caixaEnabled: false, premiumActive: false, subscriptionsEnabled: true }),
    ).toBe('assinaturas');
  });
  it('keeps caixa for a premium member even when subscriptions are gated', () => {
    expect(
      resolveCaixaSlot({ caixaEnabled: true, premiumActive: true, subscriptionsEnabled: false }),
    ).toBe('caixa');
  });
});
