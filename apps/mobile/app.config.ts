import { brand } from '@ccc/design';
import type { ExpoConfig } from 'expo/config';

type Variant = 'development' | 'preview' | 'production';

const variantFromEnv = (): Variant => {
  const raw = process.env.APP_VARIANT ?? 'development';
  if (raw === 'development' || raw === 'preview' || raw === 'production') return raw;
  return 'development';
};

const variant = variantFromEnv();

const suffix: Record<Variant, string> = {
  development: ' (Dev)',
  preview: ' (Preview)',
  production: '',
};

const bundleId: Record<Variant, string> = {
  development: `${brand.app.bundleIdBase}.dev`,
  preview: `${brand.app.bundleIdBase}.preview`,
  production: brand.app.bundleIdBase,
};

// Use `||` not `??` so that an empty string in .env.local (a common footgun
// when teammates blank out the var) still falls back to the default instead
// of silently producing an empty projectId — which makes
// Notifications.getExpoPushTokenAsync throw 'no-project-id' and breaks the
// local broadcast push smoke (JDMA-534).
const easProjectId = process.env.EAS_PROJECT_ID || 'c071216e-6224-4f00-9eb0-6737fb5e1691';

const stripeMerchantIdentifier =
  variant === 'production' ? brand.app.stripeMerchantId : undefined;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProjectMobile = process.env.SENTRY_PROJECT_MOBILE;

const devLauncherPlugins: ExpoConfig['plugins'] =
  variant === 'development'
    ? [
        [
          'expo-dev-launcher',
          {
            launchMode: 'launcher',
          },
        ],
      ]
    : [];

const sentryExpoPlugin: ExpoConfig['plugins'] =
  sentryOrg && sentryProjectMobile
    ? [
        [
          '@sentry/react-native/expo',
          {
            organization: sentryOrg,
            project: sentryProjectMobile,
          },
        ],
      ]
    : [];

const config: ExpoConfig = {
  name: `${brand.name}${suffix[variant]}`,
  slug: brand.app.scheme,
  owner: 'leaopedro',
  scheme: brand.app.scheme,
  version: '0.0.1',
  runtimeVersion: {
    policy: 'appVersion',
  },
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  updates: {
    url: 'https://u.expo.dev/c071216e-6224-4f00-9eb0-6737fb5e1691',
  },
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0A0A0A',
  },
  ios: {
    bundleIdentifier: bundleId[variant],
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: bundleId[variant],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0A0A',
    },
  },
  plugins: [
    'expo-router',
    ...devLauncherPlugins,
    'expo-secure-store',
    [
      '@stripe/stripe-react-native',
      stripeMerchantIdentifier ? { merchantIdentifier: stripeMerchantIdentifier } : {},
    ],
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: brand.color.brand,
      },
    ],
    ...sentryExpoPlugin,
  ],
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/icon.png',
  },
  experiments: { typedRoutes: true },
  extra: {
    variant,
    // `||` (not `??`) so an empty string in .env.local falls back to the
    // default instead of producing an empty baseUrl. See easProjectId above
    // for the same reasoning.
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000',
    r2PublicBaseUrl: process.env.EXPO_PUBLIC_R2_PUBLIC_BASE_URL || '',
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
    stripeMerchantIdentifier,
    // RevenueCat iOS API key — populated at build time via .env.local or EAS secret.
    // Only consumed on iOS; Android bundle never reads this value.
    rcIosApiKey: process.env.EXPO_PUBLIC_RC_IOS_API_KEY,
    // Premium billing feature flag — inlined at build time (canon §F8.11).
    // Default false; flip to true in .env.local after all 19 F8 chunks land.
    premiumBillingEnabled: process.env.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED === 'true',
    eas: { projectId: easProjectId },
  },
};

export default config;
