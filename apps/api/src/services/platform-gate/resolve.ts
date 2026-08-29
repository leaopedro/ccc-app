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

/** Browsers all send a UA starting with `Mozilla/`. Native clients do not. */
const BROWSER_UA = /^Mozilla\//i;
const ANDROID_UA = /okhttp|Android/i;

export const resolveClientPlatform = (headers: {
  platform?: string;
  userAgent?: string;
}): ClientPlatform => {
  const declared = headers.platform?.trim().toLowerCase();
  if (declared && KNOWN.includes(declared)) return declared as ClientPlatform;

  const ua = headers.userAgent ?? '';
  if (BROWSER_UA.test(ua)) return 'web';
  if (ANDROID_UA.test(ua)) return 'android';

  return 'ios';
};

export const subscriptionsEnabledFor = (platform: ClientPlatform, env: PlatformGateEnv): boolean =>
  env[platform];
