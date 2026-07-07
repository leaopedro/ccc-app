import { Button } from '@jdm/ui';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useWizard } from './context';
import type { TicketData } from './types';

interface SelectedExtra {
  id: string;
  name: string;
  displayPriceCents: number;
}

import { getApiErrorCode } from '~/api/errors';
import { createOrder, createPixOrder } from '~/api/orders';
import { buyCopy } from '~/copy/buy';
import { formatBRL } from '~/lib/format';
import { isWeb, startWebCheckout } from '~/screens/buy/web-checkout';
import { theme } from '~/theme';

const ticketExtras = (t: TicketData): SelectedExtra[] =>
  (t.extras as SelectedExtra[] | undefined) ?? [];

export function ReviewScreen() {
  const { state, dispatch, onOrderCreated, onExitWizard } = useWizard();
  const { tier, quantity, tickets, eventId, extrasOnly, method } = state;
  const canGoBack = state.steps.length > 0;
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const unitPrice = extrasOnly ? 0 : tier.displayPriceCents;
  const extrasCents = tickets.reduce((sum, t) => {
    return sum + ticketExtras(t).reduce((s, e) => s + e.displayPriceCents, 0);
  }, 0);
  const totalCents = unitPrice * quantity + extrasCents;

  const [redirecting, setRedirecting] = useState(false);

  const ticketPayloads = () =>
    tickets.map((t) => ({
      extras: ticketExtras(t).map((e) => e.id),
      ...(t.carId ? { carId: t.carId as string } : {}),
      ...(t.licensePlate ? { licensePlate: t.licensePlate as string } : {}),
    }));

  const orderPayload = () => ({
    eventId,
    tierId: tier.id,
    quantity,
    method: 'card' as const,
    extrasOnly: false as const,
    tickets: ticketPayloads(),
  });

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (method === 'pix') {
        const pixOrder = await createPixOrder({
          eventId,
          tierId: tier.id,
          quantity,
          extrasOnly,
          tickets: ticketPayloads(),
        });
        router.push({
          pathname: '/(app)/events/buy/checkout-pix',
          params: {
            orderId: pixOrder.orderId,
            brCode: pixOrder.brCode,
            expiresAt: pixOrder.expiresAt,
            amountCents: String(pixOrder.amountCents),
            currency: pixOrder.currency,
          },
        } as never);
        return;
      }
      if (isWeb) {
        setRedirecting(true);
        await startWebCheckout(orderPayload());
        return;
      }
      const order = await createOrder(orderPayload());
      await onOrderCreated(order);
    } catch (err) {
      setRedirecting(false);
      if (getApiErrorCode(err) === 'PENDING_TICKET_ORDER_FOR_EVENT') {
        Alert.alert(buyCopy.review.pendingOrderTitle, buyCopy.review.pendingOrderBody);
      } else {
        Alert.alert(buyCopy.review.errorTitle, buyCopy.review.errorBody);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={canGoBack ? () => dispatch({ type: 'BACK' }) : onExitWizard}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          hitSlop={8}
          style={styles.backButton}
        >
          <ArrowLeft color={theme.colors.fg} size={20} />
        </Pressable>
        <Text style={styles.title}>{buyCopy.review.title}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {tickets.map((ticketData, idx) => {
          const extras = ticketExtras(ticketData);
          return (
            <View key={idx} style={styles.ticketCard}>
              <Text style={styles.ticketTitle}>
                {extrasOnly
                  ? buyCopy.extrasOnly.subtitle
                  : buyCopy.wizard.ticketLabel(idx + 1, quantity)}
              </Text>
              {!extrasOnly && (
                <View style={styles.lineItem}>
                  <Text style={styles.lineLabel}>{tier.name}</Text>
                  <Text style={styles.lineValue}>{formatBRL(unitPrice)}</Text>
                </View>
              )}
              {extras.map((extra) => (
                <View key={extra.id} style={styles.lineItem}>
                  <Text style={styles.lineLabel}>{extra.name}</Text>
                  <Text style={styles.lineValue}>{formatBRL(extra.displayPriceCents)}</Text>
                </View>
              ))}
              {typeof ticketData.carLabel === 'string' ? (
                <View style={styles.lineItem}>
                  <Text style={styles.lineLabel}>{ticketData.carLabel}</Text>
                  <Text style={styles.lineValue}>{ticketData.licensePlate as string}</Text>
                </View>
              ) : null}
            </View>
          );
        })}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{buyCopy.review.total}</Text>
          <Text style={styles.totalValue}>{formatBRL(totalCents)}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {redirecting ? (
          <View style={styles.redirecting}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.redirectingText}>{buyCopy.webCheckout.redirecting}</Text>
          </View>
        ) : (
          <Button
            label={submitting ? buyCopy.review.submitting : buyCopy.review.confirm}
            onPress={() => void handleSubmit()}
            disabled={submitting}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backButton: { padding: 4 },
  title: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  ticketCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: 14,
    gap: 8,
  },
  ticketTitle: {
    color: theme.colors.fg,
    fontWeight: '600',
    fontSize: theme.font.size.sm,
    marginBottom: 4,
  },
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  lineLabel: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  lineValue: { color: theme.colors.fg, fontSize: theme.font.size.sm },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    marginTop: 4,
  },
  totalLabel: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '700',
  },
  totalValue: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '700',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  redirecting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  redirectingText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
});
