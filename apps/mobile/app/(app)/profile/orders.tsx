import type { MyOrder } from '@ccc/shared/orders';
import { Button } from '@ccc/ui';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiError } from '~/api/client';
import { cancelMyOrder, getOrder, listMyOrders, resumeOrder } from '~/api/orders';
import { resolveResumeSheetOutcomeAction } from '~/cart/resume-sheet-outcome';
import { selectResumeKind } from '~/cart/resume-selector';
import { stripeResumeAvailable } from '~/cart/resume-stripe-availability';
import { resolveWebResume } from '~/cart/resume-web-checkout';
import { clearPendingCheckoutUrl, getPendingCheckoutUrl } from '~/cart/web-pending-checkout';
import { ordersCopy } from '~/copy/orders';
import { showMessage } from '~/lib/confirm';
import { formatBRL, formatEventDateRange } from '~/lib/format';
import { usePaymentSheet } from '~/payments/payment-sheet';
import { resolveOrderKindLabel } from '~/screens/profile/orders-kind-label';
import { theme } from '~/theme';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function paymentBadgeStyle(status: MyOrder['status']) {
  if (status === 'paid') return styles.badgePaid;
  if (status === 'pending') return styles.badgePending;
  return styles.badgeMuted;
}

function fulfillmentBadgeStyle(status: NonNullable<MyOrder['fulfillmentStatus']>) {
  if (status === 'delivered' || status === 'picked_up') return styles.badgePaid;
  if (status === 'cancelled') return styles.badgeMuted;
  return styles.badgeFulfillment;
}

const STRIPE_AVAILABLE = !!(
  Constants.expoConfig?.extra as { stripePublishableKey?: string } | undefined
)?.stripePublishableKey;

// Resumes a Pix order. Stripe SDK not touched, so this button is safe
// in any build regardless of whether StripeProvider is mounted.
function ResumePixButton({ orderId }: { orderId: string }) {
  const router = useRouter();

  const handlePay = async () => {
    try {
      const data = await resumeOrder(orderId);
      if (data.method !== 'pix') {
        Alert.alert(ordersCopy.payError, ordersCopy.payErrorBody);
        return;
      }
      router.push({
        pathname: '/events/buy/checkout-pix',
        params: {
          orderId: data.orderId,
          brCode: data.brCode,
          expiresAt: data.expiresAt,
          amountCents: String(data.amountCents),
        },
      } as never);
    } catch {
      Alert.alert(ordersCopy.payError, ordersCopy.payErrorBody);
    }
  };

  return (
    <Pressable onPress={() => void handlePay()} accessibilityRole="button" style={styles.payLink}>
      <Text style={styles.payLinkText}>{ordersCopy.pay}</Text>
    </Pressable>
  );
}

// Resumes a Stripe (card) order via the shared PaymentSheet seam
// (usePaymentSheet, src/payments/payment-sheet.ts) — the same seam the cart
// and subscription flows use. Only rendered when a publishable key is
// configured (stripeResumeAvailable). That gate is NOT a crash guard: it
// never was one. useStripe() from @stripe/stripe-react-native has no
// useContext call anywhere in the package, its web stub is likewise
// context-free, and initPaymentSheet wraps its native call in a try/catch
// and resolves `{ error }` rather than rejecting — so calling it works
// identically whether or not StripeProvider is mounted. The gate exists so
// we don't render a "Pagar" button with nothing behind it when no key is
// configured at all.
function PayWithStripeButton({ orderId, reload }: { orderId: string; reload: () => unknown }) {
  const router = useRouter();
  const { pay } = usePaymentSheet();

  const handlePay = async () => {
    try {
      const data = await resumeOrder(orderId);
      if (data.method === 'pix') {
        // Provider says stripe but server returned pix: fall back to the Pix flow.
        router.push({
          pathname: '/events/buy/checkout-pix',
          params: {
            orderId: data.orderId,
            brCode: data.brCode,
            expiresAt: data.expiresAt,
            amountCents: String(data.amountCents),
          },
        } as never);
        return;
      }
      const outcome = await pay(data.clientSecret);
      const action = resolveResumeSheetOutcomeAction(outcome);
      if (action.kind === 'silent') return;
      if (action.kind === 'error') {
        Alert.alert(ordersCopy.payError, action.text);
        return;
      }
      reload();
    } catch {
      Alert.alert(ordersCopy.payError, ordersCopy.payErrorBody);
    }
  };

  return (
    <Pressable onPress={() => void handlePay()} accessibilityRole="button" style={styles.payLink}>
      <Text style={styles.payLinkText}>{ordersCopy.pay}</Text>
    </Pressable>
  );
}

// Resumes a Stripe Checkout Session order on web by reopening the hosted
// checkout URL captured at order creation. Checkout Session orders have
// Order.providerRef = null, so /orders/:id/resume returns 409 for them;
// we therefore avoid that endpoint entirely on web. resolveWebResume
// re-validates server-side freshness (status === 'pending' and reservation
// not expired) before redirecting, so a stale order cannot be paid by
// reopening a stored Stripe Checkout URL.
function ResumeWebStripeButton({ orderId, reload }: { orderId: string; reload: () => unknown }) {
  const [busy, setBusy] = useState(false);

  const handlePay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const action = await resolveWebResume(orderId, {
        getStoredUrl: (id) => getPendingCheckoutUrl(id),
        fetchOrderStatus: async (id) => {
          const order = await getOrder(id);
          return { status: order.status, expiresAt: order.expiresAt };
        },
      });
      if (action.kind === 'redirect') {
        if (typeof window !== 'undefined') {
          window.location.href = action.url;
        }
        return;
      }
      if (action.kind === 'stale') {
        // Server confirmed the order is no longer payable. Safe to drop
        // the stored URL and reload the list to reflect the new status.
        clearPendingCheckoutUrl(orderId);
        showMessage(ordersCopy.payWebUnavailable);
        reload();
        return;
      }
      // action.kind === 'unverified': transient fetch failure. Keep the
      // stored URL so a retry can still resume payment for a still-
      // pending order; do NOT reload (the list state is unchanged).
      showMessage(ordersCopy.payWebUnverified);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={() => void handlePay()}
      accessibilityRole="button"
      disabled={busy}
      style={[styles.payLink, busy && styles.actionDisabled]}
    >
      <Text style={styles.payLinkText}>{ordersCopy.pay}</Text>
    </Pressable>
  );
}

function ResumeOrderButton({
  order,
  reload,
}: {
  order: MyOrder;
  reload: () => unknown;
}): React.ReactElement | null {
  const kind = selectResumeKind(order, {
    platform: Platform.OS === 'web' ? 'web' : 'native',
    hasStoredCheckoutUrl:
      Platform.OS === 'web' &&
      order.provider === 'stripe' &&
      getPendingCheckoutUrl(order.id) !== null,
    // Canon §F8.16 used to force this false on iOS. That rule is superseded
    // (2026-08-29): iOS now resumes through the same PaymentSheet seam as
    // every other platform. See stripeResumeAvailable.
    stripeAvailable: stripeResumeAvailable({
      platform: Platform.OS,
      hasPublishableKey: STRIPE_AVAILABLE,
    }),
  });

  switch (kind) {
    case 'pix':
      return <ResumePixButton orderId={order.id} />;
    case 'web':
      return <ResumeWebStripeButton orderId={order.id} reload={reload} />;
    case 'native-stripe':
      return <PayWithStripeButton orderId={order.id} reload={reload} />;
    case 'none':
    default:
      return null;
  }
}

function OrderCard({
  order,
  reload,
  onRequestCancel,
  cancelling,
}: {
  order: MyOrder;
  reload: () => unknown;
  onRequestCancel: (order: MyOrder) => void;
  cancelling: boolean;
}) {
  const router = useRouter();
  const eventDate = order.event
    ? formatEventDateRange(order.event.startsAt, order.event.endsAt)
    : null;
  const canCancel = order.status === 'pending';

  const isPendingAndActive = order.status === 'pending';

  const openTicket = (ticketIds: string[]) => {
    if (ticketIds.length === 1) {
      router.push({
        pathname: '/tickets/[ticketId]',
        params: { ticketId: ticketIds[0]! },
      } as never);
    } else {
      router.push('/tickets');
    }
  };

  const openVoucher = (ticketId: string) => {
    router.push({
      pathname: '/tickets/[ticketId]',
      params: { ticketId },
    } as never);
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {ordersCopy.summary.orderId} #{order.shortId}
          </Text>
          <Text style={styles.subtitle}>
            {resolveOrderKindLabel(order.containsTickets, order.containsStoreItems, order.kind)}
          </Text>
        </View>
        <View style={styles.badges}>
          <View style={[styles.badge, paymentBadgeStyle(order.status)]}>
            <Text style={styles.badgeText}>{ordersCopy.paymentStatus[order.status]}</Text>
          </View>
          {order.containsStoreItems && order.status === 'paid' && order.fulfillmentStatus ? (
            <View style={[styles.badge, fulfillmentBadgeStyle(order.fulfillmentStatus)]}>
              <Text style={styles.badgeText}>
                {ordersCopy.fulfillmentStatus[order.fulfillmentStatus]}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.metaBlock}>
        <Text style={styles.metaLabel}>
          {ordersCopy.summary.orderDate} {dateFormatter.format(new Date(order.createdAt))}
        </Text>
        {eventDate ? (
          <Text style={styles.metaLabel}>
            {ordersCopy.summary.eventDate} {eventDate}
          </Text>
        ) : null}
        {order.containsStoreItems && order.fulfillmentMethod ? (
          <Text style={styles.metaLabel}>
            {ordersCopy.fulfillmentMethod[order.fulfillmentMethod]}
            {order.shippingCents > 0
              ? ` ${ordersCopy.summary.separator} ${ordersCopy.summary.shipping} ${formatBRL(order.shippingCents)}`
              : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.items}>
        {order.items.map((item) => {
          const ticketIds =
            item.kind === 'ticket' && order.status === 'paid' && item.ticketIds
              ? item.ticketIds
              : null;
          return (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemText}>
                <Text style={styles.itemTitle}>
                  {item.quantity}x {item.title}
                </Text>
                {item.detail ? <Text style={styles.itemDetail}>{item.detail}</Text> : null}
                {ticketIds && ticketIds.length > 0 ? (
                  <Pressable
                    onPress={() => openTicket(ticketIds)}
                    accessibilityRole="button"
                    style={styles.ticketLink}
                  >
                    <Text style={styles.ticketLinkText}>
                      {ticketIds.length === 1 ? ordersCopy.viewTicket : ordersCopy.viewTickets}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.itemPrice}>{formatBRL(item.subtotalCents)}</Text>
            </View>
          );
        })}
      </View>

      {order.pickupTicketId ? (
        <Pressable
          onPress={() => openVoucher(order.pickupTicketId!)}
          accessibilityRole="button"
          style={styles.voucherLink}
        >
          <Text style={styles.ticketLinkText}>{ordersCopy.viewVoucher}</Text>
        </Pressable>
      ) : null}

      <View style={styles.footerRow}>
        <View>
          <Text style={styles.footerText}>{ordersCopy.summary.total}</Text>
          <Text style={styles.total}>{formatBRL(order.amountCents)}</Text>
        </View>
        <View style={styles.footerActions}>
          {isPendingAndActive ? <ResumeOrderButton order={order} reload={reload} /> : null}
          {canCancel ? (
            <Pressable
              onPress={() => onRequestCancel(order)}
              accessibilityRole="button"
              disabled={cancelling}
              style={[styles.cancelButton, cancelling && styles.actionDisabled]}
            >
              <Text style={styles.cancelButtonText}>
                {cancelling ? ordersCopy.actions.cancelling : ordersCopy.actions.cancel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function ProfileOrdersScreen() {
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [confirmingOrder, setConfirmingOrder] = useState<MyOrder | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(false);
      const res = await listMyOrders();
      setOrders(res.items);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const requestCancel = useCallback((order: MyOrder) => {
    setConfirmingOrder(order);
  }, []);

  const closeCancelModal = useCallback(() => {
    if (cancellingOrderId) return;
    setConfirmingOrder(null);
  }, [cancellingOrderId]);

  const confirmCancel = useCallback(async () => {
    if (!confirmingOrder) return;

    setCancellingOrderId(confirmingOrder.id);
    try {
      await cancelMyOrder(confirmingOrder.id);
      setConfirmingOrder(null);
      showMessage(ordersCopy.cancelModal.success);
      await load();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        showMessage(ordersCopy.cancelModal.conflictError);
        setConfirmingOrder(null);
        await load();
      } else {
        showMessage(ordersCopy.cancelModal.genericError);
      }
    } finally {
      setCancellingOrderId(null);
    }
  }, [confirmingOrder, load]);

  const content = useMemo(() => {
    if (orders === null) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      );
    }

    if (error && orders.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>{ordersCopy.loadFailed}</Text>
          <View style={styles.retryWrap}>
            <Button label={ordersCopy.retry} onPress={() => void load()} />
          </View>
        </View>
      );
    }

    if (orders.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>{ordersCopy.empty}</Text>
          <Text style={styles.emptyText}>{ordersCopy.emptySub}</Text>
        </View>
      );
    }

    return (
      <View style={styles.list}>
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            reload={load}
            onRequestCancel={requestCancel}
            cancelling={cancellingOrderId === order.id}
          />
        ))}
      </View>
    );
  }, [cancellingOrderId, error, load, orders, requestCancel]);

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={
          orders && orders.length > 0 ? styles.content : styles.contentCentered
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {content}
      </ScrollView>

      <Modal
        visible={confirmingOrder !== null}
        animationType="fade"
        transparent
        onRequestClose={closeCancelModal}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeCancelModal} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{ordersCopy.cancelModal.title}</Text>
            <Text style={styles.modalBody}>{ordersCopy.cancelModal.body}</Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={closeCancelModal}
                style={[styles.actionButton, styles.actionSecondary]}
                accessibilityRole="button"
                disabled={cancellingOrderId !== null}
              >
                <Text style={styles.actionSecondaryText}>{ordersCopy.actions.keep}</Text>
              </Pressable>
              <Pressable
                onPress={() => void confirmCancel()}
                style={[
                  styles.actionButton,
                  styles.actionPrimary,
                  cancellingOrderId !== null && styles.actionDisabled,
                ]}
                accessibilityRole="button"
                disabled={cancellingOrderId !== null}
              >
                <Text style={styles.actionPrimaryText}>
                  {cancellingOrderId !== null
                    ? ordersCopy.actions.cancelling
                    : ordersCopy.actions.confirm}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  content: {
    padding: theme.spacing.md,
  },
  contentCentered: {
    flexGrow: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.bg,
  },
  retryWrap: {
    marginTop: theme.spacing.md,
  },
  emptyTitle: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyText: {
    marginTop: theme.spacing.sm,
    color: theme.colors.muted,
    textAlign: 'center',
  },
  list: {
    gap: theme.spacing.md,
  },
  card: {
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#111217',
    gap: theme.spacing.md,
  },
  headerRow: {
    gap: theme.spacing.sm,
  },
  headerText: {
    gap: 2,
  },
  title: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgePaid: {
    backgroundColor: 'rgba(34, 197, 94, 0.14)',
    borderColor: 'rgba(34, 197, 94, 0.32)',
  },
  badgePending: {
    backgroundColor: 'rgba(225, 106, 0, 0.14)',
    borderColor: 'rgba(225, 106, 0, 0.36)',
  },
  badgeFulfillment: {
    backgroundColor: 'rgba(245, 245, 247, 0.08)',
    borderColor: theme.colors.border,
  },
  badgeMuted: {
    backgroundColor: 'rgba(138, 138, 147, 0.12)',
    borderColor: 'rgba(138, 138, 147, 0.2)',
  },
  badgeText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  metaBlock: {
    gap: 4,
  },
  metaLabel: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  items: {
    gap: theme.spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '500',
  },
  itemDetail: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  ticketLink: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start',
  },
  voucherLink: {
    alignSelf: 'flex-start',
  },
  ticketLinkText: {
    color: theme.colors.accent,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  itemPrice: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footerText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  cancelButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: 'rgba(225, 106, 0, 0.36)',
    backgroundColor: 'rgba(225, 106, 0, 0.14)',
  },
  cancelButtonText: {
    color: theme.colors.fg,
    fontWeight: '600',
  },
  total: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  modalTitle: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
  },
  modalBody: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
    lineHeight: 22,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  actionButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.sm,
  },
  actionSecondary: {
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionSecondaryText: {
    color: theme.colors.fg,
    fontWeight: '600',
  },
  actionPrimary: {
    backgroundColor: theme.colors.accent,
  },
  actionPrimaryText: {
    color: theme.colors.fg,
    fontWeight: '700',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  payLink: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.accent,
  },
  payLinkText: {
    color: '#fff',
    fontSize: theme.font.size.sm,
    fontWeight: '700',
  },
});
