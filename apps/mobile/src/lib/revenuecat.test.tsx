// F8.10 — unit tests for the RC library wrapper.
//
// Strategy: mock react-native-purchases entirely; mock react-native's
// Platform.OS to test iOS vs Android branches.
// No DB, no Testcontainers — mobile tests run in vitest/jsdom.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks (must be before any import of the module under test) ----------
// vi.mock factories are hoisted above top-level variables, so anything they
// reference must come from vi.hoisted (also hoisted) — not a plain const.

const { mockConfigure, mockGetOfferings, mockPurchasePackage, platformMock, extraMock } =
  vi.hoisted(() => ({
    mockConfigure: vi.fn(),
    mockGetOfferings: vi.fn(),
    mockPurchasePackage: vi.fn(),
    platformMock: { OS: 'ios' as 'ios' | 'android' | 'web' },
    extraMock: { rcIosApiKey: 'appl_test_key_123' as string | undefined },
  }));

vi.mock('react-native-purchases', () => ({
  default: {
    configure: mockConfigure,
    getOfferings: mockGetOfferings,
    purchasePackage: mockPurchasePackage,
  },
}));

// expo-constants mock: expose rcIosApiKey so init path can read it.
// extraMock is hoisted + mutable so a test can flip rcIosApiKey to undefined.
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      get extra() {
        return extraMock;
      },
    },
  },
}));

// react-native Platform mock — mutable so tests can flip OS
vi.mock('react-native', () => ({
  Platform: platformMock,
}));

// ---------- import module under test (AFTER mocks are registered) ----------

import { fetchOfferings, initRevenueCat, purchasePackage } from './revenuecat';

// ---------- tests ----------

describe('initRevenueCat', () => {
  beforeEach(() => {
    platformMock.OS = 'ios';
    extraMock.rcIosApiKey = 'appl_test_key_123';
    mockConfigure.mockReset();
  });

  it('calls Purchases.configure exactly once on iOS with correct args', () => {
    initRevenueCat('garage_abc123');
    expect(mockConfigure).toHaveBeenCalledOnce();
    expect(mockConfigure).toHaveBeenCalledWith({
      apiKey: 'appl_test_key_123',
      appUserID: 'garage_abc123',
    });
  });

  it('passes appUserID equal to the garageId argument (canon F8.10 mapping)', () => {
    const garageId = 'garage_xyz_canonical';
    initRevenueCat(garageId);
    const call = mockConfigure.mock.calls[0]?.[0] as { appUserID: string };
    expect(call.appUserID).toBe(garageId);
  });

  it('does NOT call Purchases.configure on Android', () => {
    platformMock.OS = 'android';
    initRevenueCat('garage_abc123');
    expect(mockConfigure).not.toHaveBeenCalled();
  });

  it('does NOT call Purchases.configure on web', () => {
    platformMock.OS = 'web';
    initRevenueCat('garage_abc123');
    expect(mockConfigure).not.toHaveBeenCalled();
  });

  it('does NOT call Purchases.configure on iOS when rcIosApiKey is undefined (warns instead)', () => {
    extraMock.rcIosApiKey = undefined;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initRevenueCat('garage_no_key');
    expect(mockConfigure).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('EXPO_PUBLIC_RC_IOS_API_KEY'));
    warnSpy.mockRestore();
  });
});

describe('fetchOfferings', () => {
  beforeEach(() => {
    platformMock.OS = 'ios';
    mockGetOfferings.mockReset();
  });

  it('calls Purchases.getOfferings and returns its result on iOS', async () => {
    const fakeOfferings = { current: { identifier: 'default' } };
    mockGetOfferings.mockResolvedValueOnce(fakeOfferings);
    const result = await fetchOfferings();
    expect(mockGetOfferings).toHaveBeenCalledOnce();
    expect(result).toBe(fakeOfferings);
  });

  it('returns null on Android without calling Purchases.getOfferings', async () => {
    platformMock.OS = 'android';
    const result = await fetchOfferings();
    expect(result).toBeNull();
    expect(mockGetOfferings).not.toHaveBeenCalled();
  });

  it('returns null on web without calling Purchases.getOfferings', async () => {
    platformMock.OS = 'web';
    const result = await fetchOfferings();
    expect(result).toBeNull();
    expect(mockGetOfferings).not.toHaveBeenCalled();
  });
});

describe('purchasePackage', () => {
  const fakePackage = { identifier: '$rc_monthly' } as Parameters<typeof purchasePackage>[0];

  beforeEach(() => {
    platformMock.OS = 'ios';
    mockPurchasePackage.mockReset();
  });

  it('calls Purchases.purchasePackage and returns MakePurchaseResult on iOS', async () => {
    const fakePurchaseResult = { transaction: { transactionIdentifier: 'txn_1' } };
    mockPurchasePackage.mockResolvedValueOnce(fakePurchaseResult);
    const result = await purchasePackage(fakePackage);
    expect(mockPurchasePackage).toHaveBeenCalledOnce();
    expect(mockPurchasePackage).toHaveBeenCalledWith(fakePackage);
    expect(result).toBe(fakePurchaseResult);
  });

  it('throws Error("not_ios") on Android without calling Purchases.purchasePackage', async () => {
    platformMock.OS = 'android';
    await expect(purchasePackage(fakePackage)).rejects.toThrow('not_ios');
    expect(mockPurchasePackage).not.toHaveBeenCalled();
  });

  it('throws Error("not_ios") on web without calling Purchases.purchasePackage', async () => {
    platformMock.OS = 'web';
    await expect(purchasePackage(fakePackage)).rejects.toThrow('not_ios');
    expect(mockPurchasePackage).not.toHaveBeenCalled();
  });
});
