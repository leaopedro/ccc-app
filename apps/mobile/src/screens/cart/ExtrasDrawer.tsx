import type { CartItem } from '@jdm/shared/cart';
import type { EventExtraPublic } from '@jdm/shared/extras';
import { Minus, Plus, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { updateCartItem } from '~/api/cart';
import { useCart } from '~/cart/context';
import { cartCopy } from '~/copy/cart';
import { isCapacityBlocked } from '~/lib/capacity-display';
import { formatBRL } from '~/lib/format';
import { theme } from '~/theme';

interface Props {
  visible: boolean;
  item: CartItem;
  eventExtras: EventExtraPublic[];
  onClose: () => void;
}

export function ExtrasDrawer({ visible, item, eventExtras, onClose }: Props) {
  const { refresh } = useCart();
  const selectedIds = new Set(item.extras.map((e) => e.extraId));
  const [pending, setPending] = useState<Set<string>>(new Set());

  const toggleExtra = useCallback(
    async (extraId: string) => {
      setPending((prev) => new Set(prev).add(extraId));
      try {
        const tickets = item.tickets.map((ticket) => {
          const isSelected = ticket.extras.includes(extraId);
          const extras = isSelected
            ? ticket.extras.filter((id) => id !== extraId)
            : [...ticket.extras, extraId];
          return { ...ticket, extras };
        });

        if (!item.eventId || !item.tierId) return;
        await updateCartItem(item.id, {
          eventId: item.eventId,
          tierId: item.tierId,
          source: item.source,
          kind: item.kind,
          quantity: item.quantity,
          tickets,
        });
        await refresh();
      } catch {
        // Cart state unchanged on failure
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(extraId);
          return next;
        });
      }
    },
    [item, refresh],
  );

  const extrasTotal = item.extras.reduce((sum, e) => sum + e.subtotalCents, 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.drawer}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{cartCopy.drawer.title}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cartCopy.actions.close}
          >
            <X color={theme.colors.muted} size={20} strokeWidth={2} />
          </Pressable>
        </View>

        {eventExtras.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>{cartCopy.drawer.empty}</Text>
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {eventExtras.map((extra) => {
              const owned = selectedIds.has(extra.id);
              const soldOut = !owned && isCapacityBlocked(extra.capacityDisplay);
              const isLoading = pending.has(extra.id);
              const disabled = soldOut || isLoading;

              return (
                <View key={extra.id} style={[styles.extraRow, soldOut && styles.disabled]}>
                  <View style={styles.extraInfo}>
                    <Text style={styles.extraName}>{extra.name}</Text>
                    {extra.description ? (
                      <Text style={styles.extraDesc} numberOfLines={2}>
                        {extra.description}
                      </Text>
                    ) : null}
                    <Text style={styles.extraPrice}>{formatBRL(extra.displayPriceCents)}</Text>
                  </View>
                  <Pressable
                    onPress={() => void toggleExtra(extra.id)}
                    disabled={disabled}
                    style={[styles.toggleBtn, owned && styles.toggleBtnActive]}
                    accessibilityRole="button"
                    accessibilityLabel={owned ? cartCopy.drawer.remove : cartCopy.drawer.add}
                    accessibilityState={{ disabled }}
                  >
                    {isLoading ? (
                      <ActivityIndicator size="small" color={theme.colors.fg} />
                    ) : owned ? (
                      <Minus color={theme.colors.fg} size={16} strokeWidth={2.5} />
                    ) : (
                      <Plus color={theme.colors.muted} size={16} strokeWidth={2.5} />
                    )}
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        )}

        {extrasTotal > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{cartCopy.drawer.extrasTotal}</Text>
            <Text style={styles.totalValue}>{formatBRL(extrasTotal)}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawer: {
    backgroundColor: theme.colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    paddingBottom: 34,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  emptyWrap: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    textAlign: 'center',
  },
  scroll: { flexGrow: 0 },
  scrollContent: { padding: 16, gap: 10 },
  extraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    gap: 12,
  },
  disabled: { opacity: 0.4 },
  extraInfo: { flex: 1, gap: 2 },
  extraName: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  extraDesc: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  extraPrice: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '500',
  },
  toggleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  totalLabel: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
  },
  totalValue: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
});
