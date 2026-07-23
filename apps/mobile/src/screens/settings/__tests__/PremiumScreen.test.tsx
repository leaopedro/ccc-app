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
  extraMock,
  mockOpenAuthSession,
  mockGetPremiumStatus,
  mockFetchOfferings,
  mockPurchasePackage,
} = vi.hoisted(() => ({
  platformMock: { OS: 'ios' as 'ios' | 'android' | 'web' },
  extraMock: { premiumBillingEnabled: true },
  mockOpenAuthSession: vi.fn(),
  mockGetPremiumStatus: vi.fn(),
  mockFetchOfferings: vi.fn(),
  mockPurchasePackage: vi.fn(),
}));

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

// ─── expo-constants mock (feature flag on by default) ───────────────────────

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      get extra() {
        return extraMock;
      },
    },
  },
}));

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

// ─── lucide-react-native stub (transitive via @jdm/ui if needed) ──────────────
vi.mock('lucide-react-native', () => ({ default: {} }));

// ─── import SUT ──────────────────────────────────────────────────────────────
import PremiumScreen from '../PremiumScreen';

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
  extraMock.premiumBillingEnabled = true;
  mockGetPremiumStatus.mockReset();
  mockFetchOfferings.mockReset();
  mockPurchasePackage.mockReset();
  mockOpenAuthSession.mockReset();
});

afterEach(() => {
  root.unmount();
  container.remove();
});

const mount = async () => {
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
  it('shows maintenance banner when premiumBillingEnabled is false', async () => {
    extraMock.premiumBillingEnabled = false;
    await mount();
    expect(container.querySelector('[data-testid="premium-maintenance"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="premium-status-badge"]')).toBeNull();
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
  it('shows iOS CTA on Platform.OS === "ios" when not active', async () => {
    platformMock.OS = 'ios';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus);
    await mount();
    expect(container.querySelector('[data-testid="premium-cta-ios"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="premium-cta-android"]')).toBeNull();
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

describe('Platform.OS branching — iOS calls RC, Android opens WebBrowser', () => {
  it('calls fetchOfferings + purchasePackage on iOS CTA tap', async () => {
    platformMock.OS = 'ios';
    mockGetPremiumStatus.mockResolvedValueOnce(inactiveStatus).mockResolvedValueOnce(activeStatus); // reload after purchase
    mockFetchOfferings.mockResolvedValueOnce({
      current: { monthly: { identifier: '$rc_monthly' } },
    });
    mockPurchasePackage.mockResolvedValueOnce({ transaction: { transactionIdentifier: 'txn_1' } });
    await mount();
    const cta = container.querySelector('[data-testid="premium-cta-ios"]') as HTMLElement;
    expect(cta).not.toBeNull();
    await act(async () => {
      cta.click();
      for (let i = 0; i < 10; i++) await flush();
    });
    expect(mockFetchOfferings).toHaveBeenCalledOnce();
    expect(mockPurchasePackage).toHaveBeenCalledWith({ identifier: '$rc_monthly' });
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
