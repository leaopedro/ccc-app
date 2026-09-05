// Import the leaf `brand` module, not the package barrel. Expo loads this
// config through Node's native ESM loader, which (unlike Metro/webpack) does
// not remap NodeNext `./x.js` specifiers to their `.ts` source. The barrel
// (`@ccc/design`) re-exports `./brand.js` + `./tokens.js`, so loading it here
// throws ERR_MODULE_NOT_FOUND. `brand.ts` has no relative imports, so the
// subpath resolves cleanly. See packages/design/package.json "./brand".
import { brand } from '@ccc/design/brand';
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
const easProjectId = process.env.EAS_PROJECT_ID || 'bd5bfc09-9874-47f5-9ded-5dcf3bd8c3c3';

const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

// A production build carrying a Stripe TEST key is the quiet failure we can
// actually prevent here, so fail the build instead of shipping it.
//
// Today this is the NORMAL state: the production API runs on the Casa Car Club
// sandbox account (`sk_test_51U4ESa…`), so the only publishable key that lets
// the native PaymentSheet work is that account's test key. That is correct for
// TestFlight and for App Review, and it is wrong the moment the app is on sale:
// members would complete a purchase and never be charged.
//
// Both Casa Car Club accounts still have `charges_enabled: false`, so no build
// can take real money yet regardless. Going live means moving the WHOLE stack
// to the CNPJ account together — API secret key, both webhook secrets, and this
// publishable key — not just this line.
//
// Set ALLOW_TEST_STRIPE_KEY=1 for a TestFlight or review build.
if (
  variant === 'production' &&
  stripePublishableKey.startsWith('pk_test_') &&
  !process.env.ALLOW_TEST_STRIPE_KEY
) {
  throw new Error(
    'Build de producao com chave Stripe de TEST (pk_test_). ' +
      'Para TestFlight ou App Review: ALLOW_TEST_STRIPE_KEY=1. ' +
      'Para venda ao publico: migrar a stack inteira para a conta do CNPJ antes.',
  );
}

const stripeMerchantIdentifier = variant === 'production' ? brand.app.stripeMerchantId : undefined;
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
  version: '1.0.0',
  runtimeVersion: {
    policy: 'appVersion',
  },
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  updates: {
    url: 'https://u.expo.dev/bd5bfc09-9874-47f5-9ded-5dcf3bd8c3c3',
  },
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0A0A0A',
  },
  ios: {
    bundleIdentifier: bundleId[variant],
    supportsTablet: false,
    // Declares what the app actually collects. Shipping the default empty
    // NSPrivacyCollectedDataTypes while collecting email, phone, CPF, photos and
    // an identity document is an App Store 5.1.2 problem, and it also contradicts
    // the privacy policy the app itself renders.
    //
    // Linked: true everywhere because all of it hangs off an authenticated
    // account. Tracking: false everywhere — nothing here is shared with a data
    // broker or used for cross-app advertising, and there is no ad SDK.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhoneNumber',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeName',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          // CPF and the CNH/RG upload. Apple has no dedicated national-ID type;
          // OtherDataTypes is the documented catch-all.
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherDataTypes',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhotosorVideos',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePurchaseHistory',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserContent',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          // Sentry crash and performance data.
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'],
        },
      ],
    },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSPhotoLibraryUsageDescription:
        'O Casa Car Club acessa suas fotos para definir seu avatar, adicionar fotos de veículos e anexar imagens ao suporte.',
      NSPhotoLibraryAddUsageDescription:
        'O Casa Car Club salva o QR Code do seu ingresso na sua galeria de fotos.',
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
    // faceIDPermission: false omits NSFaceIDUsageDescription. The default
    // injects a generic English string, and the app has no biometrics at all
    // (no expo-local-authentication anywhere) — a permission string for an
    // absent feature is an App Store 5.1.1 rejection.
    ['expo-secure-store', { faceIDPermission: false }],
    // Same reasoning. expo-image-picker is autolinked as a dependency and was
    // not listed here, so its config plugin injected generic English camera and
    // microphone strings. The app only picks from the library (no
    // launchCameraAsync, no expo-camera), so the photo string is the PT-BR one
    // already declared in ios.infoPlist below.
    //
    // The camera string cannot be dropped, though: build 1.0.0 (9) was rejected
    // at upload with ITMS-90683 because expo-image-picker's native code links
    // the camera APIs regardless of what JS calls. Apple's validator demands the
    // key, so it gets an honest PT-BR string. Nothing in the app can trigger the
    // prompt today (upload-image.ts only calls launchImageLibraryAsync).
    // Microphone stays dropped — the validator did not ask for it.
    [
      'expo-image-picker',
      {
        photosPermission:
          'O Casa Car Club acessa suas fotos para definir seu avatar, adicionar fotos de veículos e anexar imagens ao suporte.',
        cameraPermission:
          'O Casa Car Club pode usar a câmera para você fotografar seu veículo ou um anexo de suporte na hora.',
        microphonePermission: false,
      },
    ],
    'expo-web-browser',
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
    stripePublishableKey,
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
