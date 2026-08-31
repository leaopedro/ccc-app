// @vitest-environment jsdom
//
// PremiumScreen tests.
// Covers: Platform.OS branching (iOS/Android CTA), status badge states,
// CTA hidden when already-active, manage-link when cancel_scheduled,
// maintenance banner when feature flag off.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// ─── hoisted mock state (must come before vi.mock factories) ─────────────────
const {
  platformMock,
  mockOpenAuthSession,
  mockGetPremiumStatus,
  mockFetchOfferings,
  mockPurchasePackage,
} = vi.hoisted(() => ({
  platformMock: { OS: 'ios' as 'ios' | 'android' | 'web' },
  mockOpenAuthSession: vi.fn(),
  mockGetPremiumStatus: vi.fn(),
  mockFetchOfferings: vi.fn(),
  mockPurchasePackage: vi.fn(),
}));

// The billing flag (`~/lib/premium-runtime`) is a top-level const evaluated
// from `process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` at module-load time —
// not re-read per render. Vitest caches the module graph across tests in the
// same file, so controlling the flag requires `vi.resetModules()` plus a
// dynamic `import()` of the screen for every test (same pattern as
// `screens/assinaturas/checkout.test.ts`). A static top-level import would
// only ever observe whatever the env var was on the very first import.
const FLAG_VAR = 'EXPO_PUBLIC_PREMIUM_BILLING_ENABLED';

// ─── react-native mock ───────────────────────────────────────────────────────

vi.mock('react-native', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) =>
    ReactMod.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        style,
        className,
        accessibilityLabel,
        accessibilityHint,
        accessibilityRole,
        accessibilityState,
        testID,
        onPress,
        hitSlop,
        numberOfLines,
        disabled,
        ...rest
      } = props;
      const aria: Record<string, unknown> = {};
      if (typeof accessibilityLabel === 'string') aria['aria-label'] = accessibilityLabel;
      if (typeof accessibilityHint === 'string') aria['aria-description'] = accessibilityHint;
      if (typeof accessibilityRole === 'string') aria.role = accessibilityRole;
      const disabledFlag =
        accessibilityState &&
        typeof accessibilityState === 'object' &&
        (accessibilityState as { disabled?: boolean }).disabled === true;
      if (disabledFlag || disabled === true) aria['aria-disabled'] = 'true';
      if (typeof className === 'string') aria['data-classname'] = className;
      if (typeof testID === 'string') aria['data-testid'] = testID;
      if (typeof onPress === 'function') aria.onClick = onPress;
      void style;
      void hitSlop;
      void numberOfLines;
      return ReactMod.createElement(tag, { ...rest, ...aria, ref });
    });
  return {
    Pressable: make('button'),
    View: make('div'),
    Text: make('span'),
    ScrollView: make('div'),
    ActivityIndicator: make('div'),
    StyleSheet: { create: <T,>(s: T): T => s, flatten: <T,>(s: T): T => s },
    Linking: { openURL: vi.fn() },
    Platform: platformMock,
  };
});

// ─── expo-web-browser mock ───────────────────────────────────────────────────
vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: mockOpenAuthSession,
}));

// ─── API mock ─────────────────────────────────────────────────────────────────
vi.mock('~/api/premium', () => ({ getPremiumStatus: mockGetPremiumStatus }));

// ─── RevenueCat mock ─────────────────────────────────────────────────────────
vi.mock('~/lib/revenuecat', () => ({
  fetchOfferings: mockFetchOfferings,
  purchasePackage: mockPurchasePackage,
}));

// ─── api/client baseUrl mock ─────────────────────────────────────────────────
vi.mock('~/api/client', () => ({
  baseUrl: () => 'http://localhost:4000',
  authedRequest: vi.fn(),
}));

// ─── lucide-react-native stub (transitive via @ccc/ui if needed) ──────────────
vi.mock('lucide-react-native', () => ({ default: {} }));

// ─── helpers ─────────────────────────────────────────────────────────────────
let container: HTMLDivElement;
let root: Root;

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  platformMock.OS = 'ios';
  vi.resetModules();
  process.env[FLAG_VAR] = 'true';
  mockGetPremiumStatus.mockReset();
  mockFetchOfferings.mockReset();
  mockPurchasePackage.mockReset();
  mockOpenAuthSession.mockReset();
});

afterEach(() => {
  root.unmount();
  container.remove();
  delete process.env[FLAG_VAR];
});

const mount = async () => {
  const { default: PremiumScreen } = await import('../PremiumScreen');
  await act(async () => {
    root.render(<PremiumScreen />);
    for (let i = 0; i < 6; i++) await flush();
  });
};

// ─── active-status fixture ───────────────────────────────────────────────────
// Note: noon UTC keeps the pt-BR date stable across the worker's local TZ
// (a midnight-UTC ISO would roll back a calendar day in any TZ west of UTC).
const activeStatus = {
  active: true,
  tier: 'gold' as const,
  cadence: 'monthly' as const,
  provider: 'apple_revenuecat' as const,
  currentPeriodEnd: '2026-06-26T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  manageUrl: null,
};

const cancelScheduledStatus = {
  ...activeStatus,
  cancelAtPeriodEnd: true,
  manageUrl: 'https://apps.apple.com/account/subscriptions',
};

const inactiveStatus = {
  active: false,
  tier: null,
  cadence: null,
  provider: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  manageUrl: null,
};

const pastDueStatus = {
  active: false,
  tier: 'gold' as const,
  cadence: 'monthly' as const,
  provider: 'apple_revenuecat' as const,
  currentPeriodEnd: '2026-06-26T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  manageUrl: null,
};

// ─── tests ────────────────────────────────────────────────────────────────────

describe('feature flag', () => {
  it('shows maintenance banner when EXPO_PUBLIC_PREMIUM_BILLING_ENABLED is not "true"', async () => {
    process.env[FLAG_VAR] = 'false';
    await mount();
    expect(container.querySelector('[data-testid="premium-maintenance"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="premium-status-badge"]')).toBeNull();
    expect(mockGetPremiumStatus).not.toHaveBeenCalled();
  });

  // Regression test for the actual bug (Task 23): the flag used to be read
  // from `Constants.expoConfig?.extra`, which is always empty on web (its
  // web implementation resolves from `process.env.APP_MANIFEST`, never set
  // in this app), so the whole premium module silently disabled itself on
  // every web build regardless of the env var. This asserts the reverse
  // direction of the test above: a truthy env var actually reaches the
  // screen and lets the real status flow render. Fails if the flag reverts
  // to reading `Constants` instead of `process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED`.
  it('reads the flag from EXPO_PUBLIC_PREMIUM_BILLING_ENABLED=true and calls the status endpoint', async () => {
    process.env[FLAG_VAR] = 'true';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-maintenance"]')).toBeNull();
    expect(mockGetPremiumStatus).toHaveBeenCalledOnce();
  });

  it('treats an unset env var as disabled (not just the literal "false")', async () => {
    delete process.env[FLAG_VAR];
    await mount();
    expect(container.querySelector('[data-testid="premium-maintenance"]')).not.toBeNull();
    expect(mockGetPremiumStatus).not.toHaveBeenCalled();
  });
});

describe('status display', () => {
  it('shows "Membro Gold" badge for active non-cancelled subscription', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(activeStatus);
    await mount();
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toBe('Membro Gold');
  });

  it('shows "Membro Gold (cancelamento agendado)" badge for cancel_scheduled', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(cancelScheduledStatus);
    await mount();
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toContain('cancelamento agendado');
  });

  it('shows "Inativo" badge for inactive subscription', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toBe('Inativo');
  });

  it('shows "Pagamento pendente" badge when status has tier but not active', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(pastDueStatus);
    await mount();
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toBe('Pagamento pendente');
  });

  it('renders period-end date in pt-BR format when currentPeriodEnd is set', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(activeStatus);
    await mount();
    const periodEndEl = container.querySelector('[data-testid="premium-period-end"]');
    // '2026-06-26' → 26/06/2026 in pt-BR
    expect(periodEndEl?.textContent).toContain('26/06/2026');
  });

  it('does not render period-end when currentPeriodEnd is null', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-period-end"]')).toBeNull();
  });
});

describe('CTA gating', () => {
  // A purchase button wired to an uninitialised SDK is an App Store 2.1
  // rejection on its own: it does nothing when tapped, and the route is
  // deep-linkable so a reviewer can reach it without a tab. The iOS CTA is
  // gone entirely — iOS now falls through to the same hosted-checkout CTA
  // as Android, so the screen is never a dead end.
  it('never renders an iOS RevenueCat CTA, and shows the hosted-checkout CTA instead', async () => {
    platformMock.OS = 'ios';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-cta-ios"]')).toBeNull();
    expect(container.querySelector('[data-testid="premium-cta-android"]')).not.toBeNull();
  });

  it('never calls into the RevenueCat SDK on iOS', async () => {
    platformMock.OS = 'ios';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(mockFetchOfferings).not.toHaveBeenCalled();
    expect(mockPurchasePackage).not.toHaveBeenCalled();
  });

  it('shows Android CTA on Platform.OS === "android" when not active', async () => {
    platformMock.OS = 'android';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-cta-android"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="premium-cta-ios"]')).toBeNull();
  });

  it('hides CTA when already active (non-cancelled)', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(activeStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-cta-ios"]')).toBeNull();
    expect(container.querySelector('[data-testid="premium-cta-android"]')).toBeNull();
  });

  it('hides CTA when cancel_scheduled (still active — manage link shown instead)', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(cancelScheduledStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-cta-ios"]')).toBeNull();
    expect(container.querySelector('[data-testid="premium-cta-android"]')).toBeNull();
  });
});

describe('Subscribe CTA — hosted web checkout on both platforms (RevenueCat removed)', () => {
  it('opens the hosted WebBrowser checkout on iOS tap too, without touching RevenueCat', async () => {
    platformMock.OS = 'ios';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    mockOpenAuthSession.mockResolvedValueOnce({ type: 'cancel' });
    await mount();
    const cta = container.querySelector('[data-testid="premium-cta-android"]') as HTMLElement;
    expect(cta).not.toBeNull();
    await act(async () => {
      cta.click();
      for (let i = 0; i < 6; i++) await flush();
    });
    expect(mockOpenAuthSession).toHaveBeenCalledWith(
      'http://localhost:4000/premium',
      'ccc://premium/return',
    );
    expect(mockFetchOfferings).not.toHaveBeenCalled();
    expect(mockPurchasePackage).not.toHaveBeenCalled();
  });

  it('does NOT call fetchOfferings on Android (opens WebBrowser instead)', async () => {
    platformMock.OS = 'android';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    mockOpenAuthSession.mockResolvedValueOnce({ type: 'cancel' });
    await mount();
    const cta = container.querySelector('[data-testid="premium-cta-android"]') as HTMLElement;
    expect(cta).not.toBeNull();
    await act(async () => {
      cta.click();
      for (let i = 0; i < 6; i++) await flush();
    });
    expect(mockFetchOfferings).not.toHaveBeenCalled();
    expect(mockOpenAuthSession).toHaveBeenCalledWith(
      'http://localhost:4000/premium',
      'ccc://premium/return',
    );
  });

  it('reloads status after successful Android WebBrowser flow', async () => {
    platformMock.OS = 'android';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus).mockResolvedValueOnce(activeStatus);
    mockOpenAuthSession.mockResolvedValueOnce({
      type: 'success',
      url: 'ccc://premium/return',
    });
    await mount();
    const cta = container.querySelector('[data-testid="premium-cta-android"]') as HTMLElement;
    await act(async () => {
      cta.click();
      for (let i = 0; i < 10; i++) await flush();
    });
    expect(mockGetPremiumStatus).toHaveBeenCalledTimes(2);
    const badge = container.querySelector('[data-testid="premium-status-badge"]');
    expect(badge?.textContent).toBe('Membro Gold');
  });
});

describe('manage link', () => {
  it('renders manage link when cancel_scheduled and manageUrl is set', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(cancelScheduledStatus);
    await mount();
    const manageLink = container.querySelector('[data-testid="premium-manage-link"]');
    expect(manageLink).not.toBeNull();
  });

  it('does not render manage link when not active', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-manage-link"]')).toBeNull();
  });

  it('does not render manage link when active but manageUrl is null', async () => {
    mockGetPremiumStatus.mockResolvedValueOnce(activeStatus); // manageUrl: null
    await mount();
    expect(container.querySelector('[data-testid="premium-manage-link"]')).toBeNull();
  });
});
