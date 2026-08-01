// F8.18 — PremiumScreen.
//
// iOS  → CTA calls purchasePackage from ~/lib/revenuecat (canon §F8.16: no Stripe).
// Android → CTA opens WebBrowser to the web subscribe flow + deep-link return.
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
import { PREMIUM_BILLING_ENABLED } from '~/lib/premium-runtime';
import { fetchOfferings, purchasePackage } from '~/lib/revenuecat';
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
  const [purchasing, setPurchasing] = useState(false);

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
        <Text style={styles.maintenanceText}>Premium em breve</Text>
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

  const onSubscribeIos = async () => {
    setPurchasing(true);
    try {
      const offerings = await fetchOfferings();
      const pkg = offerings?.current?.monthly;
      if (!pkg) {
        setError('Oferta não disponível no momento.');
        return;
      }
      await purchasePackage(pkg);
      // After purchase, the RC webhook fires server-side.
      // Poll status after a short delay to reflect activation.
      await new Promise<void>((r) => setTimeout(r, 2000));
      await load();
    } catch (e: unknown) {
      if (e instanceof Error && e.message !== 'purchaseCancelled') {
        setError('Erro ao processar compra. Tente novamente.');
      }
    } finally {
      setPurchasing(false);
    }
  };

  const onSubscribeAndroid = async () => {
    const url = `${baseUrl()}/premium`;
    const result = await WebBrowser.openAuthSessionAsync(url, DEEP_LINK_RETURN);
    if (result.type === 'success') {
      await load();
    }
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

      {/* Subscribe CTA — iOS: RC / Android: WebBrowser */}
      {showSubscribeCTA ? (
        Platform.OS === 'ios' ? (
          <Pressable
            onPress={() => void onSubscribeIos()}
            style={styles.cta}
            disabled={purchasing}
            accessibilityRole="button"
            accessibilityLabel="Assinar Premium Gold"
            testID="premium-cta-ios"
          >
            <Text style={styles.ctaText}>{purchasing ? 'Processando…' : 'Assinar Gold'}</Text>
          </Pressable>
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
