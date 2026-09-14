import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-native's Flow-flavored `import typeof` syntax can't be parsed by
// vitest's SSR transform. Mock it before importing, same as
// api/__tests__/client-platform-header.test.ts.
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

// The SDK is native-only; the enum is all we need from it here.
const initPaymentSheet = vi.fn();
const presentPaymentSheet = vi.fn();
vi.mock('@stripe/stripe-react-native', () => ({
  PaymentSheetError: { Canceled: 'Canceled', Failed: 'Failed', Timeout: 'Timeout' },
  useStripe: () => ({ initPaymentSheet, presentPaymentSheet }),
}));

const { buildPaymentSheetConfig, resolveSheetOutcome, usePaymentSheet, PAYMENT_SHEET_RETURN_URL } =
  await import('../payment-sheet');

// `payment-sheet.ts` imports `acquireCelebrationHold` from the
// `@ccc/ui/celebration-hold` subpath, not the `@ccc/ui` barrel, specifically
// so this pure counter module has no rendering deps (`react-native-svg` via
// `HexBadge`, etc.) and needs no mock here. Real, unmocked module: assert the
// actual hold state, not a spy.
const { isCelebrationHeld } = await import('@ccc/ui/celebration-hold');

/** Lets a test observe hold state while an async call is still in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('buildPaymentSheetConfig', () => {
  it('always carries the client secret, the merchant name and a returnURL', () => {
    const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'android' });
    expect(cfg.paymentIntentClientSecret).toBe('pi_1_secret_x');
    expect(cfg.merchantDisplayName).toBeTruthy();
    // Brazilian cards authenticate through 3DS constantly. Without a returnURL
    // the web view never hands control back and the payment hangs forever.
    expect(cfg.returnURL).toBe(PAYMENT_SHEET_RETURN_URL);
  });

  it('declares Apple Pay on iOS', () => {
    const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'ios' });
    expect(cfg.applePay).toEqual({ merchantCountryCode: 'BR' });
  });

  it('does not declare Apple Pay off iOS', () => {
    const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'android' });
    expect(cfg.applePay).toBeUndefined();
  });

  // Google Pay is opt-in in @stripe/stripe-react-native 0.50.3 (PaymentSheet.d.ts:18).
  // It stays off until the Android decision (H4 / Task 13) is recorded.
  it('does not declare Google Pay yet', () => {
    const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'android' });
    expect(cfg.googlePay).toBeUndefined();
  });
});

describe('resolveSheetOutcome', () => {
  it('treats no error as paid', () => {
    expect(resolveSheetOutcome(null)).toEqual({ kind: 'paid' });
  });

  // Cancellation is not a failure. Showing an error alert to someone who chose
  // to close the sheet is how a working flow reads as broken.
  it('separates cancellation from failure', () => {
    expect(resolveSheetOutcome({ code: 'Canceled' })).toEqual({ kind: 'cancelled' });
    expect(resolveSheetOutcome({ code: 'Failed' })).toEqual({ kind: 'failed', code: 'Failed' });
  });

  it('reports a failure with no code as a plain failure', () => {
    expect(resolveSheetOutcome({})).toEqual({ kind: 'failed' });
  });
});

describe('usePaymentSheet().pay', () => {
  beforeEach(() => {
    initPaymentSheet.mockReset();
    presentPaymentSheet.mockReset();
  });

  it('returns paid when init and present both succeed', async () => {
    initPaymentSheet.mockResolvedValue({ error: undefined });
    presentPaymentSheet.mockResolvedValue({ error: undefined });

    const { pay } = usePaymentSheet();
    await expect(pay('pi_1_secret_x')).resolves.toEqual({ kind: 'paid' });
  });

  it('returns cancelled, not an error, when the user closes the sheet', async () => {
    initPaymentSheet.mockResolvedValue({ error: undefined });
    presentPaymentSheet.mockResolvedValue({ error: { code: 'Canceled' } });

    const { pay } = usePaymentSheet();
    await expect(pay('pi_1_secret_x')).resolves.toEqual({ kind: 'cancelled' });
  });

  it('returns failed on a genuine presentation failure', async () => {
    initPaymentSheet.mockResolvedValue({ error: undefined });
    presentPaymentSheet.mockResolvedValue({ error: { code: 'Failed' } });

    const { pay } = usePaymentSheet();
    await expect(pay('pi_1_secret_x')).resolves.toEqual({ kind: 'failed', code: 'Failed' });
  });

  // The field-failure case: without returnURL, a 3DS redirect never comes
  // back and the payment hangs. Assert it lands in the actual SDK call,
  // not just in the config object initPaymentSheet is built from.
  it('passes returnURL through to initPaymentSheet', async () => {
    initPaymentSheet.mockResolvedValue({ error: undefined });
    presentPaymentSheet.mockResolvedValue({ error: undefined });

    const { pay } = usePaymentSheet();
    await pay('pi_1_secret_x');

    expect(initPaymentSheet).toHaveBeenCalledWith(
      expect.objectContaining({ returnURL: PAYMENT_SHEET_RETURN_URL }),
    );
  });

  // Task 8: this is the single chokepoint all four `usePaymentSheet` callers
  // share, so the celebration hold has to wrap it here, once, rather than at
  // each call site. A leaked hold on any exit path disables the badge overlay
  // for the rest of the session — assert release on every branch, not just
  // the happy path.
  describe('celebration hold', () => {
    // The module-level counter in `@ccc/ui/celebration-hold` is process-global
    // and has no reset export (see `packages/ui/src/__tests__/celebration-hold.test.ts`).
    // Every test below acquires exactly one hold and must see it released by
    // the time it finishes, or the next test starts from a corrupted `true`.
    afterEach(() => {
      expect(isCelebrationHeld()).toBe(false);
    });

    it('holds while init and present are in flight, releases once paid', async () => {
      const init = deferred<{ error: undefined }>();
      initPaymentSheet.mockReturnValue(init.promise);
      presentPaymentSheet.mockResolvedValue({ error: undefined });

      expect(isCelebrationHeld()).toBe(false);
      const { pay } = usePaymentSheet();
      const outcome = pay('pi_1_secret_x');

      // Still awaiting `initPaymentSheet` — the hold must already be up.
      expect(isCelebrationHeld()).toBe(true);
      init.resolve({ error: undefined });

      await expect(outcome).resolves.toEqual({ kind: 'paid' });
      expect(isCelebrationHeld()).toBe(false);
    });

    it('releases the hold when init fails, before present is ever called', async () => {
      initPaymentSheet.mockResolvedValue({ error: { code: 'Failed' } });

      const { pay } = usePaymentSheet();
      await pay('pi_1_secret_x');

      expect(presentPaymentSheet).not.toHaveBeenCalled();
      expect(isCelebrationHeld()).toBe(false);
    });

    it('releases the hold when the user cancels the sheet', async () => {
      initPaymentSheet.mockResolvedValue({ error: undefined });
      presentPaymentSheet.mockResolvedValue({ error: { code: 'Canceled' } });

      const { pay } = usePaymentSheet();
      await pay('pi_1_secret_x');

      expect(isCelebrationHeld()).toBe(false);
    });

    it('releases the hold even when presentPaymentSheet throws', async () => {
      initPaymentSheet.mockResolvedValue({ error: undefined });
      presentPaymentSheet.mockRejectedValue(new Error('native module crashed'));

      const { pay } = usePaymentSheet();
      await expect(pay('pi_1_secret_x')).rejects.toThrow('native module crashed');

      expect(isCelebrationHeld()).toBe(false);
    });
  });
});
