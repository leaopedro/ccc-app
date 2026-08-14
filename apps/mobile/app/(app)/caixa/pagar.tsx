// Caixa — "Pagar a caixa" Pix payment screen (Fase 4a payment).
//
// Kicks off checkout on mount, then renders the Pix code + a poll for the
// webhook-driven payment confirmation. Mirrors the cart's checkout-pix.tsx
// UI idioms (HiddenQR, copy button, countdown) without importing from it —
// this screen is caixa-specific and does not touch order status.

import { Button, Text } from '@ccc/ui';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { HiddenQR } from '~/components/HiddenQR';
import { caixaCopy } from '~/copy/caixa';
import { useBoxPay } from '~/hooks/useBoxPay';
import { useBoxPaymentPoll } from '~/hooks/useBoxPaymentPoll';
import { formatBRL } from '~/screens/caixa/format';
import { mapPayError, type PayErrorFeedback } from '~/screens/caixa/pay-result';
import { CaixaSkeleton } from '~/screens/caixa/CaixaSkeleton';
import { theme } from '~/theme';

const SUCCESS_DELAY_MS = 2000;

function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = new Date(expiresAt).getTime();
  const remaining = Math.max(0, target - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  // Only expired once we have a real target that has passed. An empty
  // expiresAt (before checkout resolves) yields NaN, which is not expired.
  const isExpired = Number.isFinite(target) && remaining <= 0;

  return { display, isExpired };
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={8}
      >
        <ArrowLeft color={theme.colors.fg} size={24} strokeWidth={1.75} />
      </Pressable>
      <Text variant="body" weight="semibold">
        {caixaCopy.pay.title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

export default function PagarCaixaScreen() {
  const { checkout, loading } = useBoxPay();
  const [brCode, setBrCode] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<PayErrorFeedback | null>(null);
  const [copied, setCopied] = useState(false);

  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const runCheckout = useCallback(async () => {
    setCheckoutError(null);
    const { result, data } = await checkout();
    // The screen may have unmounted while checkout was in flight; a late
    // response must not navigate or set state on a dead screen.
    if (!activeRef.current) return;
    if (result === 'ok' && data) {
      setBrCode(data.brCode);
      setAmountCents(data.amountCents);
      setExpiresAt(data.expiresAt);
      return;
    }
    if (result === 'ok') {
      setCheckoutError({ kind: 'retry', message: caixaCopy.pay.error });
      return;
    }
    const feedback = mapPayError(result);
    if (feedback.kind === 'toast_home') {
      router.replace('/caixa' as never);
      return;
    }
    setCheckoutError(feedback);
    // Intentionally no deps: `checkout` is a fresh function identity from
    // useBoxPay() on every render, and this must only run once on mount.
  }, []);

  useEffect(() => {
    void runCheckout();
  }, [runCheckout]);

  const { display, isExpired } = useCountdown(expiresAt ?? '');
  const { status, retry } = useBoxPaymentPoll({
    expiresAt: expiresAt ?? '',
    enabled: expiresAt !== null,
  });

  const navigatedRef = useRef(false);
  useEffect(() => {
    if (status !== 'paid' && status !== 'closed_budget_only') return;
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    const id = setTimeout(() => router.replace('/caixa' as never), SUCCESS_DELAY_MS);
    return () => clearTimeout(id);
  }, [status]);

  const handleCopy = async () => {
    if (!brCode) return;
    await Clipboard.setStringAsync(brCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || (expiresAt === null && !checkoutError)) {
    return <CaixaSkeleton />;
  }

  if (checkoutError) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.center}>
          <Text variant="bodySm" tone="danger" style={styles.centerBody}>
            {checkoutError.message}
          </Text>
          <Button
            label={caixaCopy.pay.reconnect}
            onPress={() => void runCheckout()}
            className="mt-5"
          />
        </View>
      </View>
    );
  }

  if (status === 'paid') {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.pay.success}
          </Text>
        </View>
      </View>
    );
  }

  if (status === 'closed_budget_only') {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.center}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.pay.closedBudgetOnly}
          </Text>
        </View>
      </View>
    );
  }

  // `isExpired` fires the instant the countdown hits 00:00, before the next
  // poll would flip status. Paid/closed are handled above, so this cannot mask
  // a settlement. Renders the expired screen immediately so the QR and copy
  // action stop being usable at the deadline.
  if (status === 'expired' || isExpired) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.center}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.pay.expired}
          </Text>
        </View>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.center}>
          <Text variant="bodySm" tone="danger" style={styles.centerBody}>
            {caixaCopy.pay.error}
          </Text>
          <Button label={caixaCopy.pay.reconnect} onPress={retry} className="mt-5" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="bodySm" tone="secondary" style={styles.instruction}>
          {caixaCopy.pay.instruction}
        </Text>
        <Text variant="bodySm" tone="muted">
          {caixaCopy.pay.amount}: {formatBRL(amountCents)}
        </Text>

        <View style={styles.qrContainer}>
          <HiddenQR
            value={brCode ?? ''}
            size={220}
            accessibilityLabel={caixaCopy.pay.instruction}
          />
        </View>

        <Pressable style={styles.copyBox} onPress={() => void handleCopy()}>
          <Text variant="bodySm" numberOfLines={3} style={styles.codeText}>
            {brCode}
          </Text>
          <Text variant="bodySm" tone="brand" weight="semibold">
            {copied ? caixaCopy.pay.copied : caixaCopy.pay.copyButton}
          </Text>
        </Pressable>

        <Text variant="bodySm" tone="muted" style={styles.countdown}>
          {caixaCopy.pay.expiresIn}: {display}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  headerSpacer: { width: 32 },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  centerTitle: { textAlign: 'center' },
  centerBody: { textAlign: 'center', maxWidth: 280 },
  instruction: { textAlign: 'center' },
  qrContainer: {
    padding: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#FFFFFF',
  },
  copyBox: {
    width: '100%',
    padding: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
  codeText: { fontFamily: 'monospace' },
  countdown: { fontSize: theme.font.size.lg, fontWeight: '600' },
});
