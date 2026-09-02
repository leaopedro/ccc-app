// F8.18 — PremiumScreen.
//
// iOS  → CTA routes into the `assinaturas` flow (native PaymentSheet, Task 6).
//         Opening a web checkout from inside the app is an App Store 3.1.3
//         violation on the Brazil storefront — no US-storefront exception
//         applies — so iOS must not use WebBrowser here.
// Android → CTA opens WebBrowser to the web subscribe flow + deep-link return.
//         Untouched by this fix; migrating Android is a separate Task 13
//         decision blocked on a human.
//
// Feature-flag: when EXPO_PUBLIC_PREMIUM_BILLING_ENABLED is false,
// show maintenance banner and return early (canon §F8.11).
//
// Status badge copy (PT-BR):
//   active + !cancelAtPeriodEnd  → "Membro Gold"
//   active + cancelAtPeriodEnd   → "Membro Gold (cancelamento agendado)"
//   past_due                     → "Pagamento pendente"
//   default / inactive           → "Inativo"

import { brand } from '@ccc/design';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { baseUrl } from '~/api/client';
import type { PremiumStatusResponse } from '~/api/premium';
import { getPremiumStatus } from '~/api/premium';
import { usePremiumPlans } from '~/hooks/usePremiumPlans';
import { PREMIUM_BILLING_ENABLED } from '~/lib/premium-runtime';
import { theme } from '~/theme';

// Deep-link return scheme for Android WebBrowser flow.
// MUST match `scheme` in apps/mobile/app.config.ts.
const DEEP_LINK_RETURN = `${brand.app.scheme}://premium/return`;

function statusLabel(status: PremiumStatusResponse): string {
  if (status.active && !status.cancelAtPeriodEnd) return 'Membro Gold';
  if (status.active && status.cancelAtPeriodEnd) return 'Membro Gold (cancelamento agendado)';
  if (!status.active && status.tier !== null) return 'Pagamento pendente';
  return 'Inativo';
}

function formatPeriodEnd(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function PremiumScreen() {
  const enabled = PREMIUM_BILLING_ENABLED;
  const [status, setStatus] = useState<PremiumStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Platform gate from the same source as `useSubscriptionsGate` /
  // `usePremiumSlot` (Task 6/9/10) — server-driven, refetched fresh here
  // rather than invented locally, so ops can kill iOS purchasing without a
  // new binary and this screen honors it the same way the assinaturas
  // routes do.
  const { subscriptionsEnabled } = usePremiumPlans();

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setStatus(await getPremiumStatus());
    } catch {
      setError('Não foi possível carregar o status. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  // Feature flag disabled — maintenance banner.
  if (!enabled) {
    return (
      <View style={styles.center} testID="premium-maintenance">
        <Text style={styles.maintenanceText}>Assinaturas indisponíveis no momento.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator testID="premium-loading" />
      </View>
    );
  }

  if (error || !status) {
    return (
      <View style={styles.center} testID="premium-error">
        <Text style={styles.errorText}>{error ?? 'Erro ao carregar.'}</Text>
      </View>
    );
  }

  const label = statusLabel(status);
  const periodEnd = formatPeriodEnd(status.currentPeriodEnd);
  // Show subscribe CTA only when not already active (or cancel_scheduled = still active).
  const showSubscribeCTA = !status.active;
  // Show manage link when active (includes cancel_scheduled).
  const showManageLink = status.active && !!status.manageUrl;

  const onSubscribeAndroid = async () => {
    const url = `${baseUrl()}/premium`;
    const result = await WebBrowser.openAuthSessionAsync(url, DEEP_LINK_RETURN);
    if (result.type === 'success') {
      await load();
    }
  };

  // No WebBrowser here on purpose — see header comment.
  const onSubscribeIos = () => {
    router.push('/assinaturas');
  };

  const onManage = () => {
    if (status.manageUrl) void Linking.openURL(status.manageUrl);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Status badge */}
      <View style={styles.badgeRow} testID="premium-badge-row">
        <View style={[styles.badge, status.active ? styles.badgeActive : styles.badgeInactive]}>
          <Text style={styles.badgeText} testID="premium-status-badge">
            {label}
          </Text>
        </View>
      </View>

      {/* Period end */}
      {periodEnd ? (
        <Text style={styles.periodEnd} testID="premium-period-end">
          {'Válido até ' + periodEnd}
        </Text>
      ) : null}

      {/* Subscribe CTA. The iOS branch used to call a RevenueCat SDK that is
          never initialised (lib/revenuecat.ts has no caller), so the button did
          nothing when tapped — an App Store 2.1 finding by itself. Removed on
          2026-08-29; RevenueCat was deliberately NOT wired up.

          iOS does NOT fall back to the Android WebBrowser CTA either: opening
          a web checkout inside the app is an App Store 3.1.3 violation on
          the Brazil storefront. iOS routes into the `assinaturas` flow
          instead (native PaymentSheet, Task 6), and only when the platform
          gate (subscriptionsEnabled) allows it — otherwise no purchase-shaped
          affordance renders at all, matching how the assinaturas routes
          themselves react to the same gate. */}
      {showSubscribeCTA ? (
        Platform.OS === 'ios' ? (
          subscriptionsEnabled ? (
            // Final review (minor): this button navigates to `/assinaturas`,
            // the plan LIST — it does not subscribe, and it does not pick
            // Gold. "Assinar Gold" promised both. Label it for where it goes.
            <Pressable
              onPress={onSubscribeIos}
              style={styles.cta}
              accessibilityRole="button"
              accessibilityLabel="Ver planos de assinatura"
              testID="premium-cta-ios-native"
            >
              <Text style={styles.ctaText}>Ver planos</Text>
            </Pressable>
          ) : null
        ) : (
          <Pressable
            onPress={() => void onSubscribeAndroid()}
            style={styles.cta}
            accessibilityRole="button"
            accessibilityLabel="Assinar Premium Gold"
            testID="premium-cta-android"
          >
            <Text style={styles.ctaText}>Assinar Gold</Text>
          </Pressable>
        )
      ) : null}

      {/* Manage link */}
      {showManageLink ? (
        <Pressable
          onPress={onManage}
          style={styles.manageLink}
          accessibilityRole="link"
          accessibilityLabel="Gerenciar assinatura"
          testID="premium-manage-link"
        >
          <Text style={styles.manageLinkText}>Gerenciar assinatura</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.xl, gap: theme.spacing.lg, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  maintenanceText: { color: theme.colors.muted, fontSize: theme.font.size.lg },
  errorText: { color: theme.colors.accent, fontSize: theme.font.size.md },
  badgeRow: { flexDirection: 'row' },
  badge: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.md,
  },
  badgeActive: { backgroundColor: '#1A3A1A' },
  badgeInactive: { backgroundColor: '#2A2A30' },
  badgeText: { color: theme.colors.fg, fontSize: theme.font.size.md, fontWeight: '600' },
  periodEnd: { color: theme.colors.muted, fontSize: theme.font.size.md },
  cta: {
    backgroundColor: '#C0A000',
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    alignItems: 'center',
  },
  ctaText: { color: '#0a0a0a', fontWeight: '700', fontSize: theme.font.size.lg },
  manageLink: { paddingVertical: theme.spacing.sm },
  manageLinkText: {
    color: theme.colors.muted,
    textDecorationLine: 'underline',
    fontSize: theme.font.size.md,
  },
});
