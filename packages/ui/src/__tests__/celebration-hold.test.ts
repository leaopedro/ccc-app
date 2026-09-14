import { afterEach, describe, expect, it } from 'vitest';

import {
  acquireCelebrationHold,
  isCelebrationHeld,
  subscribeCelebrationHold,
} from '../celebration-hold.js';

// The module holds process-global mutable state (a module-level counter with
// no reset export). Every test below is written to release everything it
// acquires, but this guard fails loudly, right at the test that leaked,
// instead of letting a leaked hold silently corrupt every later test's
// starting state into an order-dependent false positive/negative.
afterEach(() => {
  expect(isCelebrationHeld()).toBe(false);
});

describe('celebration hold', () => {
  it('conta aninhado e so libera no ultimo', () => {
    expect(isCelebrationHeld()).toBe(false);
    const a = acquireCelebrationHold();
    const b = acquireCelebrationHold();
    expect(isCelebrationHeld()).toBe(true);
    a();
    expect(isCelebrationHeld()).toBe(true);
    b();
    expect(isCelebrationHeld()).toBe(false);
  });

  it('liberar duas vezes nao zera o contador de outro dono', () => {
    const a = acquireCelebrationHold();
    const b = acquireCelebrationHold();
    a();
    a();
    expect(isCelebrationHeld()).toBe(true);
    b();
    expect(isCelebrationHeld()).toBe(false);
  });

  it('notifica assinantes na virada', () => {
    const seen: boolean[] = [];
    const unsub = subscribeCelebrationHold((held) => seen.push(held));
    const a = acquireCelebrationHold();
    a();
    unsub();
    expect(seen).toEqual([true, false]);
  });

  it('para de notificar depois do unsubscribe', () => {
    const seen: boolean[] = [];
    const unsub = subscribeCelebrationHold((held) => seen.push(held));
    unsub();
    const a = acquireCelebrationHold();
    a();
    expect(seen).toEqual([]);
  });
});
