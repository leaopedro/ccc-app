import '../global.css';

import { brand } from '@ccc/design';
// Display font. Jost ships its 300 weight as Jost_300Light; we register it
// under the brand key 'Jost_300Regular' (brand.typography.displayFont).
import { Jost_300Light } from '@expo-google-fonts/jost';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { DarkTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { StripeProvider } from '@stripe/stripe-react-native';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import {
  Redirect,
  Slot,
  type ErrorBoundaryProps,
  useGlobalSearchParams,
  usePathname,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { AuthProvider, useAuth } from '~/auth/context';
import {
  buildLoginHref,
  DEFAULT_POST_AUTH,
  isPublicPath,
  sanitizeNext,
} from '~/auth/redirect-intent';
import { MarketingConsentModal } from '~/consent/MarketingConsentModal';
import { useMarketingConsentGate } from '~/consent/useMarketingConsentGate';
import { captureException, initSentry } from '~/lib/sentry';
import { ToastHost } from '~/lib/toast';
import { usePushOpenHandler } from '~/notifications/use-push-open-handler';
import { StoreRuntimeProvider } from '~/store/runtime-context';
import { theme } from '~/theme';

// Override @react-navigation default light bg ('rgb(242,242,242)') so the
// Stack/Tabs/SafeAreaView containers paint #0A0A0A on web — without this
// the unfilled portion of every screen below the form bleeds the light
// default theme through the mobile shell on the web export.
const cccNavTheme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    background: '#0a0a0a',
    card: '#0a0a0a',
    text: brand.color.textPrimary,
    primary: brand.color.brand,
    border: '#2a2a2a',
    notification: brand.color.brand,
  },
};

const Gate = () => {
  const auth = useAuth();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ next?: string }>();
  const next = sanitizeNext(params.next);
  usePushOpenHandler();
  const isAuthenticated = auth.status === 'authenticated' && !!auth.user?.emailVerifiedAt;
  const consentGate = useMarketingConsentGate(isAuthenticated);
  const inAuth =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot') ||
    pathname.startsWith('/reset-password') ||
    pathname === '/verify' ||
    pathname === '/verify-email-pending';

  if (auth.status === 'loading') {
    return <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />;
  }
  if (auth.status === 'unauthenticated' && !inAuth && !isPublicPath(pathname)) {
    return <Redirect href={buildLoginHref(pathname) as never} />;
  }
  if (
    auth.status === 'authenticated' &&
    auth.user &&
    !auth.user.emailVerifiedAt &&
    pathname !== '/verify-email-pending' &&
    pathname !== '/verify' &&
    pathname !== '/verify-email-change'
  ) {
    return <Redirect href="/verify-email-pending" />;
  }
  if (
    auth.status === 'authenticated' &&
    inAuth &&
    auth.user?.emailVerifiedAt &&
    pathname !== '/verify-email-change'
  ) {
    return <Redirect href={(next ?? DEFAULT_POST_AUTH) as never} />;
  }
  return (
    <>
      <Slot />
      <MarketingConsentModal
        visible={consentGate.visible}
        submitting={consentGate.submitting}
        onAccept={() => void consentGate.handleAccept()}
        onDecline={() => void consentGate.handleDecline()}
      />
    </>
  );
};

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    captureException(error, 'root-layout');
  }, [error]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        backgroundColor: theme.colors.bg,
      }}
    >
      <Text style={{ color: '#f5f5f5', fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
        Falha ao iniciar o app.
      </Text>
      <Text style={{ color: '#a3a3a3', fontSize: 14, textAlign: 'center' }}>
        Abra os logs do dispositivo. O erro de boot foi enviado ao console e ao Sentry quando
        configurado.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void retry();
        }}
        style={{
          borderRadius: 999,
          backgroundColor: brand.color.brand,
          paddingHorizontal: 20,
          paddingVertical: 12,
        }}
      >
        <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}>Tentar novamente</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    initSentry();
  }, []);
  const [fontsLoaded, fontError] = useFonts({
    Jost_300Regular: Jost_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
  });

  const stripeKey =
    (Constants.expoConfig?.extra as { stripePublishableKey?: string } | undefined)
      ?.stripePublishableKey ?? '';
  const stripeMerchantIdentifier = (
    Constants.expoConfig?.extra as { stripeMerchantIdentifier?: string } | undefined
  )?.stripeMerchantIdentifier;
  if (!stripeKey) {
    // Preview builds still need to boot even when Stripe is unset.
    console.warn('Stripe publishable key is not set — order payments will fail.');
  }
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />;
  }
  const app = (
    <>
      {/* StoreRuntimeProvider must wrap AuthProvider so the store probe fires
          before auth state settles. The probe uses an unauthenticated endpoint;
          do not move it inside AuthProvider without verifying the probe auth. */}
      <StoreRuntimeProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <Gate />
          <ToastHost />
        </AuthProvider>
      </StoreRuntimeProvider>
    </>
  );

  // Canon §F8.16 — iOS bundle MUST NOT mount StripeProvider (Apple App Store
  // Review Guideline 3.1.1 forbids external payment paths for digital goods).
  // iOS users subscribe via Apple StoreKit through RevenueCat; ticket-order
  // payments on iOS are deferred to Phase F8.1 (RC or in-app fallback).
  return (
    <ThemeProvider value={cccNavTheme}>
      {Platform.OS !== 'ios' && stripeKey ? (
        <StripeProvider
          publishableKey={stripeKey}
          {...(stripeMerchantIdentifier ? { merchantIdentifier: stripeMerchantIdentifier } : {})}
        >
          {app}
        </StripeProvider>
      ) : (
        app
      )}
    </ThemeProvider>
  );
}
