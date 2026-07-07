import { Button } from '@jdm/ui';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HiddenQR } from '~/components/HiddenQR';
import { pixCopy } from '~/copy/pix';
import { useOrderStatus } from '~/hooks/useOrderStatus';
import { formatBRL } from '~/lib/format';
import { theme } from '~/theme';

function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const isExpired = remaining <= 0;

  return { display, isExpired };
}

export default function CheckoutPixScreen() {
  const params = useLocalSearchParams<{
    orderId: string;
    brCode: string;
    expiresAt: string;
    amountCents: string;
    currency: string;
  }>();

  const { orderId, brCode, expiresAt, amountCents } = params;
  const amountNum = Number(amountCents);
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const { display, isExpired } = useCountdown(expiresAt);
  const { status, ticketId, retry } = useOrderStatus({
    orderId,
    expiresAt,
    enabled: !isExpired,
  });

  const handleCopy = async () => {
    await Clipboard.setStringAsync(brCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTryAgain = () => {
    router.back();
  };

  useEffect(() => {
    if (status !== 'paid') return;
    router.replace({
      pathname: '/(app)/events/buy/checkout-confirmed',
      params: ticketId ? { orderId, ticketId } : { orderId },
    } as never);
  }, [status, ticketId, orderId, router]);

  if (status === 'paid') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={styles.successTitle}>{pixCopy.paid}</Text>
        <Text style={styles.sub}>{pixCopy.paidSub}</Text>
      </View>
    );
  }

  if (status === 'expired' || isExpired) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{pixCopy.expired}</Text>
        <Text style={styles.sub}>{pixCopy.expiredSub}</Text>
        <Button label={pixCopy.tryAgain} onPress={handleTryAgain} style={styles.cta} />
      </View>
    );
  }

  if (status === 'failed') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{pixCopy.failed}</Text>
        <Text style={styles.sub}>{pixCopy.failedSub}</Text>
        <Button label={pixCopy.tryAgain} onPress={handleTryAgain} style={styles.cta} />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{pixCopy.errorPolling}</Text>
        <Button label={pixCopy.errorReconnect} onPress={retry} style={styles.cta} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{pixCopy.title}</Text>
      <Text style={styles.amount}>
        {pixCopy.amount}: {formatBRL(amountNum)}
      </Text>

      <View style={styles.qrContainer}>
        <HiddenQR value={brCode} size={220} accessibilityLabel={pixCopy.scanQr} />
      </View>

      <Text style={styles.hint}>{pixCopy.scanQr}</Text>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{pixCopy.orCopy}</Text>
        <View style={styles.dividerLine} />
      </View>

      <Pressable style={styles.copyBox} onPress={() => void handleCopy()}>
        <Text style={styles.codeText} numberOfLines={3}>
          {brCode}
        </Text>
        <Text style={styles.copyLabel}>{copied ? pixCopy.copied : pixCopy.copyButton}</Text>
      </Pressable>

      <View style={styles.timerRow}>
        <ActivityIndicator size="small" color={theme.colors.muted} />
        <Text style={styles.timerText}>{pixCopy.waiting}</Text>
      </View>
      <Text style={styles.countdown}>
        {pixCopy.expiresIn}: {display}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 24, alignItems: 'center', gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: theme.font.size.lg, fontWeight: '700', color: theme.colors.fg },
  amount: { fontSize: theme.font.size.md, color: theme.colors.muted },
  qrContainer: {
    padding: 16,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#FFFFFF',
  },
  hint: { fontSize: theme.font.size.sm, color: theme.colors.muted, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { fontSize: theme.font.size.sm, color: theme.colors.muted },
  copyBox: {
    width: '100%',
    padding: 12,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  },
  codeText: { fontSize: theme.font.size.sm, color: theme.colors.fg, fontFamily: 'monospace' },
  copyLabel: { fontSize: theme.font.size.md, color: theme.colors.accent, fontWeight: '600' },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerText: { fontSize: theme.font.size.sm, color: theme.colors.muted },
  countdown: { fontSize: theme.font.size.lg, fontWeight: '600', color: theme.colors.fg },
  successTitle: { fontSize: theme.font.size.xl, fontWeight: '700', color: theme.colors.fg },
  errorTitle: { fontSize: theme.font.size.xl, fontWeight: '700', color: theme.colors.fg },
  sub: { fontSize: theme.font.size.md, color: theme.colors.muted, textAlign: 'center' },
  cta: { marginTop: 12 },
});
