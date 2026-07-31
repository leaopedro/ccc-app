// Premium billing feature flag. Read from the environment variable directly —
// `Constants.expoConfig?.extra` (expo-constants) never resolves on web: its
// web implementation reads `process.env.APP_MANIFEST`, which is not set in
// this app's web build, so `expoConfig` stays empty there. Native builds do
// populate it via the native module, but reading the env var directly works
// on every platform, so there is no reason to keep the two paths.
//
// Mirrors the pattern in `~/store/runtime.ts` (STORE_BUILD_ENABLED).
export const PREMIUM_BILLING_ENABLED = process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED === 'true';
