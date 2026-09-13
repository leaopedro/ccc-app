// Caixa — "Pagar a caixa" payment screen (Pix + card).
//
// Picks a method, kicks off checkout on that choice, then renders either the
// Pix code or the Stripe PaymentSheet, plus a poll for the webhook-driven
// payment confirmation. Mirrors the cart's checkout-pix.tsx UI idioms
// (HiddenQR, copy button, countdown) without importing from it — this screen
// is caixa-specific and does not touch order status.
//
// Render order below is load-bearing in two places; both are commented where
// they matter. Read them before moving a block.

import type { BoxCheckoutRequest } from '@ccc/shared/box';
import { Button, Text } from '@ccc/ui';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HiddenQR } from '~/components/HiddenQR';
import { caixaCopy } from '~/copy/caixa';
import { useBoxPay } from '~/hooks/useBoxPay';
import { useBoxPaymentPoll } from '~/hooks/useBoxPaymentPoll';
import { usePaymentSheet } from '~/payments/payment-sheet';
import { cardAvailable } from '~/screens/caixa/pay-method';
import { formatBRL } from '~/screens/caixa/format';
import { mapPayError, type PayErrorFeedback } from '~/screens/caixa/pay-result';
import { CaixaSkeleton } from '~/screens/caixa/CaixaSkeleton';
import { theme } from '~/theme';

const SUCCESS_DELAY_MS = 2000;

type Method = BoxCheckoutRequest['method'];

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
  // Stack header is hidden, so the in-screen header has to clear the status
  // bar / notch itself.
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + theme.spacing.md }]}>
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
  const { pay } = usePaymentSheet();
  // Read INSIDE the component: at module scope the value freezes on first
  // import and the two test scenarios (key present / key absent) cannot
  // coexist without resetting modules.
  const publishableKey = (
    Constants.expoConfig?.extra as { stripePublishableKey?: string } | undefined
  )?.stripePublishableKey;
  const canUseCard = cardAvailable({ isWeb: Platform.OS === 'web', publishableKey });
  // `null` = still choosing. With no card available there is nothing to
  // choose, so it starts at 'pix' and the mount effect fires the checkout.
  const [method, setMethod] = useState<Method | null>(canUseCard ? null : 'pix');
  const [cardPhase, setCardPhase] = useState<'idle' | 'sheet' | 'waiting'>('idle');
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  const [brCode, setBrCode] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<PayErrorFeedback | null>(null);
  const [copied, setCopied] = useState(false);
  // Double-tap guard. `useState` does not work here: two fast taps read the
  // same stale `false` in their own closures before the re-render lands. Same
  // reason the cart keeps a `checkingOutRef`.
  const runningRef = useRef(false);

  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const runCheckout = useCallback(async (chosen: Method) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setCheckoutError(null);
    setSheetMessage(null);
    try {
      const { result, data } = await checkout(chosen);
      // The screen may have unmounted while checkout was in flight; a late
      // response must not navigate or set state on a dead screen.
      if (!activeRef.current) return;

      if (result !== 'ok') {
        const feedback = mapPayError(result);
        if (feedback.kind === 'toast_home') {
          router.replace('/caixa' as never);
          return;
        }
        setCheckoutError(feedback);
        return;
      }
      if (!data) {
        setCheckoutError({ kind: 'retry', message: caixaCopy.pay.error });
        return;
      }

      setAmountCents(data.amountCents);
      setExpiresAt(data.expiresAt);
      // The server locks the method on the first charge, so asking for card
      // can hand back Pix. Render from the RESPONSE, never from the request.
      setMethod(data.method);

      if (data.method === 'pix') {
        setBrCode(data.brCode);
        return;
      }

      setCardPhase('sheet');
      const outcome = await pay(data.clientSecret);
      if (!activeRef.current) return;
      if (outcome.kind === 'cancelled') {
        // A closed sheet is a choice, not a failure — never the error path.
        setCardPhase('idle');
        setSheetMessage(caixaCopy.pay.sheetCancelled);
        return;
      }
      if (outcome.kind === 'failed') {
        setCardPhase('idle');
        setSheetMessage(caixaCopy.pay.sheetFailed);
        return;
      }
      // 'paid' on the sheet still waits on the webhook to flip the order. The
      // screen only waits for the poll; it never writes order state itself.
      setCardPhase('waiting');
    } finally {
      runningRef.current = false;
    }
    // Intentionally no deps: `checkout` and `pay` are fresh function
    // identities on every render, and this only runs when called.
  }, []);

  // `checkoutError` is deliberately NOT a dependency. `runCheckout` starts by
  // clearing it, so listing it here made the "Reconectar" button fire a second
  // concurrent checkout: one of the two loses the stamp race, gets a 409
  // `box_locked`, and mapPayError bounces the user to /caixa mid-sheet.
  const startedRef = useRef(false);
  useEffect(() => {
    if (method === null) return; // waiting on the choice
    if (startedRef.current) return;
    startedRef.current = true;
    void runCheckout(method);
  }, [method, runCheckout]);

  const { display, isExpired } = useCountdown(expiresAt ?? '');
  const { status, retry } = useBoxPaymentPoll({
    expiresAt: expiresAt ?? '',
    // Do not poll while the sheet is presented: a network blip there parks
    // `status` at 'error' forever (the hook never reschedules), and a fast
    // webhook would navigate to /caixa underneath an open native modal.
    enabled: expiresAt !== null && cardPhase !== 'sheet',
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

  // BEFORE the skeleton guard, and that order is load-bearing: on the first
  // render `loading` is false and `expiresAt` is null, so the guard below
  // would swallow the picker entirely.
  if (method === null) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.center}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.pay.methodTitle}
          </Text>
          {(
            [
              ['pix', caixaCopy.pay.methodPix, caixaCopy.pay.methodPixHint],
              ['card', caixaCopy.pay.methodCard, caixaCopy.pay.methodCardHint],
            ] as const
          ).map(([value, label, hint]) => (
            <Pressable
              key={value}
              style={styles.methodCard}
              accessibilityRole="radio"
              accessibilityState={{ selected: false }}
              accessibilityLabel={`${label}. ${hint}`}
              onPress={() => setMethod(value)}
            >
              <Text variant="body" weight="semibold">
                {label}
              </Text>
              <Text variant="bodySm" tone="muted">
                {hint}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

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
            // Must carry the chosen method through. Hardcoding 'pix' here
            // would charge Pix to someone who picked card and hit a transient
            // 502, and the server then locks that Order to Pix for good.
            onPress={() => void runCheckout(method ?? 'pix')}
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
            {method === 'card' ? caixaCopy.pay.expiredCard : caixaCopy.pay.expired}
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

  // AFTER every `status` block, not before: 'paid', 'closed_budget_only',
  // 'expired' and 'error' have to win over the card spinner. Placed earlier,
  // `cardPhase: 'waiting'` becomes terminal — the success screen is
  // unreachable and a poll error (which never reschedules) traps the user.
  if (method === 'card' && cardPhase !== 'idle') {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text variant="h3" style={styles.centerTitle}>
            {cardPhase === 'sheet' ? caixaCopy.pay.cardInstruction : caixaCopy.pay.cardWaiting}
          </Text>
        </View>
      </View>
    );
  }

  if (method === 'card') {
    // cardPhase 'idle' on the card method: the sheet closed without paying.
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.center}>
          {sheetMessage ? (
            <Text variant="bodySm" tone="secondary" style={styles.centerBody}>
              {sheetMessage}
            </Text>
          ) : null}
          <Button
            label={caixaCopy.pay.cardOpenSheet}
            onPress={() => void runCheckout('card')}
            className="mt-5"
          />
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
  methodCard: {
    width: '100%',
    padding: theme.spacing.md,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
  codeText: { fontFamily: 'monospace' },
  countdown: { fontSize: theme.font.size.lg, fontWeight: '600' },
});
