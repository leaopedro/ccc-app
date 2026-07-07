import { Button } from '@jdm/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { getOrder } from '~/api/orders';
import { buyCopy } from '~/copy/buy';
import { theme } from '~/theme';

export default function CheckoutConfirmedScreen() {
  const router = useRouter();
  const { orderId, ticketId: ticketIdParam } = useLocalSearchParams<{
    orderId?: string;
    ticketId?: string;
  }>();

  const [ticketId, setTicketId] = useState<string | undefined>(ticketIdParam);
  const [resolving, setResolving] = useState<boolean>(!ticketIdParam && Boolean(orderId));

  useEffect(() => {
    if (ticketIdParam || !orderId) return;
    let active = true;
    void (async () => {
      try {
        const order = await getOrder(orderId);
        if (!active) return;
        setTicketId(order.ticketId);
      } catch {
        // Ignore: user can still tap "Ver meus pedidos".
      } finally {
        if (active) setResolving(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orderId, ticketIdParam]);

  const goTicket = () => {
    if (!ticketId) return;
    router.dismissAll();
    router.replace(`/tickets/${ticketId}` as never);
  };

  const goOrders = () => {
    router.dismissAll();
    router.replace('/profile/orders' as never);
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <CheckCircle2 size={96} color={theme.colors.success} strokeWidth={1.75} />
        <Text style={styles.title}>{buyCopy.confirmed.title}</Text>
        <Text style={styles.subtitle}>{buyCopy.confirmed.subtitle}</Text>

        <View style={styles.actions}>
          {resolving ? (
            <ActivityIndicator color={theme.colors.accent} />
          ) : ticketId ? (
            <>
              <Button label={buyCopy.confirmed.viewTicket} onPress={goTicket} />
              <Button label={buyCopy.confirmed.viewOrders} onPress={goOrders} variant="secondary" />
            </>
          ) : (
            <Button label={buyCopy.confirmed.viewOrders} onPress={goOrders} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: {
    color: theme.colors.fg,
    fontSize: theme.font.size.xxl,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    marginTop: 24,
    gap: 12,
  },
});
