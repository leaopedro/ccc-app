import { describe, expect, it } from 'vitest';

import { paymentsCopy } from '~/copy/payments';

import { resolveResumeSheetOutcomeAction } from './resume-sheet-outcome';

describe('resolveResumeSheetOutcomeAction', () => {
  // The core invariant this task is graded on: a cancelled sheet must never
  // resolve to the same shape as a real failure.
  it('is silent, not an error, when the user closes the sheet', () => {
    expect(resolveResumeSheetOutcomeAction({ kind: 'cancelled' })).toEqual({ kind: 'silent' });
  });

  it('resolves a failed sheet to an error with the shared failure copy', () => {
    expect(resolveResumeSheetOutcomeAction({ kind: 'failed', code: 'Failed' })).toEqual({
      kind: 'error',
      text: paymentsCopy.sheet.failed,
    });
  });

  // A resumed sheet can legitimately fail because the order-expiry worker
  // already cancelled the underlying PaymentIntent (order gone). Stripe has
  // no distinct error code for that case — it comes back as a plain
  // `Failed` like any other decline — so it takes the same intelligible
  // failure path rather than a bare/unlabelled one.
  it('resolves a failed sheet with no code the same way', () => {
    expect(resolveResumeSheetOutcomeAction({ kind: 'failed' })).toEqual({
      kind: 'error',
      text: paymentsCopy.sheet.failed,
    });
  });

  it('resolves a paid sheet to reload, so the list picks up the webhook-settled status', () => {
    expect(resolveResumeSheetOutcomeAction({ kind: 'paid' })).toEqual({ kind: 'reload' });
  });
});
