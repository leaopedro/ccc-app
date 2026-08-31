/**
 * Platform gate — resolves which client platform a request came from, and
 * whether premium subscriptions are enabled for it.
 *
 * Why the fallback is `ios` and not `web`: this gate exists to answer an App
 * Store rejection by removing the iOS subscription entry point. A request we
 * cannot classify must therefore get the RESTRICTIVE answer, not the
 * permissive one. Serving `subscriptionsEnabled: true` to an unclassified
 * native client is the exact failure the gate is built to prevent.
 *
 * The header is client-supplied and forgeable. That is acceptable: the threat
 * model is an App Review reviewer running an unmodified build, not an
 * adversary. Money still flows only through verified webhooks.
 */

export type ClientPlatform = 'ios' | 'android' | 'web';

export type PlatformGateEnv = {
  ios: boolean;
  android: boolean;
  web: boolean;
};

const KNOWN: readonly string[] = ['ios', 'android', 'web'];

/** React Native's fetch: okhttp on Android, CFNetwork/Darwin on iOS. */
const NATIVE_ANDROID_UA = /okhttp/i;
const NATIVE_IOS_UA = /CFNetwork|Darwin/i;
/** Browsers all send a UA starting with `Mozilla/`. Native clients do not. */
const BROWSER_UA = /^Mozilla\//i;

export const resolveClientPlatform = (headers: {
  platform?: string;
  userAgent?: string;
}): ClientPlatform => {
  const declared = headers.platform?.trim().toLowerCase();
  if (declared && KNOWN.includes(declared)) return declared as ClientPlatform;

  const ua = headers.userAgent ?? '';
  // Native markers first. A bare "Android" substring cannot discriminate
  // Chrome-on-Android (our web app) from a native Android client, because
  // both carry it — so it is not used.
  if (NATIVE_ANDROID_UA.test(ua)) return 'android';
  if (NATIVE_IOS_UA.test(ua)) return 'ios';
  if (BROWSER_UA.test(ua)) return 'web';
  return 'ios';
};

export const subscriptionsEnabledFor = (platform: ClientPlatform, env: PlatformGateEnv): boolean =>
  env[platform];
