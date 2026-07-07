// F8.10 — RevenueCat SDK wrapper (iOS-only per canon §F8.16).
//
// appUserID = garageId is canonical: the RC webhook normalizer (F8.05)
// reads app_user_id from the RC payload and resolves it as garageId.
// Do NOT use userId or any other identifier here.
//
// All functions guard on Platform.OS === 'ios' as their first statement.
// Android / web paths NEVER call into the Purchases SDK.

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, {
  type PurchasesOfferings,
  type MakePurchaseResult,
} from 'react-native-purchases';

type Extra = { rcIosApiKey?: string };

const rcIosApiKey = (): string | undefined =>
  (Constants.expoConfig?.extra as Extra | undefined)?.rcIosApiKey;

// Initialise the RevenueCat SDK.
// Call once at app startup (e.g. from _layout.tsx), passing the authenticated
// garage's ID as appUserID so the RC backend ties purchases to garages.
// No-op silently on Android / web — do NOT throw; callers run unconditionally.
export const initRevenueCat = (garageId: string): void => {
  if (Platform.OS !== 'ios') return;
  const apiKey = rcIosApiKey();
  if (!apiKey) {
    console.warn('[revenuecat] EXPO_PUBLIC_RC_IOS_API_KEY not set; RC init skipped');
    return;
  }
  Purchases.configure({ apiKey, appUserID: garageId });
};

// Fetch the current RC Offerings (product catalogue).
// Returns null on Android / web — callers must guard.
export const fetchOfferings = async (): Promise<PurchasesOfferings | null> => {
  if (Platform.OS !== 'ios') return null;
  return Purchases.getOfferings();
};

// Trigger a StoreKit purchase for the given RC Package.
// Throws Error('not_ios') on Android / web — callers must guard.
// On iOS, throws whatever rc-native throws on failure (caller handles).
export const purchasePackage = async (
  pkg: Parameters<typeof Purchases.purchasePackage>[0],
): Promise<MakePurchaseResult> => {
  if (Platform.OS !== 'ios') throw new Error('not_ios');
  return Purchases.purchasePackage(pkg);
};
