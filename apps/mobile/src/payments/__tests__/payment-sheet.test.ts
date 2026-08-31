import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
