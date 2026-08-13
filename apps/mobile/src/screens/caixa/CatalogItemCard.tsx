// Caixa — catalog item card (builder, Fase 3b-2a).
//
// Per-item selection state: "Adicionar" button outside the box, a
// QuantityStepper once it's in the box, sold-out overlay, and an EXTRA badge
// when the item's quantity pushes the box over budget (isOverflow).

import type { BoxCatalog } from '@ccc/shared/box';
import { Text } from '@ccc/ui';
import { Plus } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { QuantityStepper } from '~/screens/buy/per-ticket-wizard/QuantityStepper';
import { theme } from '~/theme';

import { formatBRL } from './format';

const SURFACE = '#0F0E0B';
const BORDER = 'rgba(212,175,55,0.14)';
const BORDER_ACTIVE = 'rgba(212,175,55,0.28)';
const BORDER_EXTRA = 'rgba(34,197,94,0.4)';
const EXTRA_BG = '#22C55E';

type CatalogItemCardProps = {
  item: BoxCatalog['items'][number];
  qty: number;
  isOverflow: boolean;
  onChange: (next: number) => void;
};

export function CatalogItemCard({ item, qty, isOverflow, onChange }: CatalogItemCardProps) {
  const inBox = qty > 0;
  const max = item.maxPerCycle ?? 1000;

  return (
    <View
      style={[
        styles.card,
        inBox && styles.cardActive,
        inBox && isOverflow && styles.cardExtra,
        item.soldOut && styles.cardSoldOut,
      ]}
    >
      <View>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]} />
        )}
        {inBox && isOverflow ? (
          <View style={styles.extraTag}>
            <Text style={styles.extraTagText}>{caixaCopy.builder.extraTag}</Text>
          </View>
        ) : null}
        {item.soldOut ? (
          <View style={styles.soldOutOverlay}>
            <Text style={styles.soldOutText}>{caixaCopy.builder.soldOut}</Text>
          </View>
        ) : null}
      </View>

      <Text variant="bodySm" weight="medium" numberOfLines={2} style={styles.title}>
        {item.title}
      </Text>
      <Text variant="bodySm" style={styles.price}>
        {formatBRL(item.priceCents)}
      </Text>

      {item.soldOut ? (
        <Pressable
          disabled
          style={[styles.addButton, styles.addDisabled]}
          accessibilityRole="button"
        >
          <Text variant="caption" tone="muted">
            {caixaCopy.builder.soldOutButton}
          </Text>
        </Pressable>
      ) : inBox ? (
        <QuantityStepper value={qty} min={0} max={max} onChange={onChange} />
      ) : (
        <Pressable
          onPress={() => onChange(1)}
          style={styles.addButton}
          accessibilityRole="button"
          accessibilityLabel={`${caixaCopy.builder.add} ${item.title}`}
        >
          <Plus color={theme.colors.fg} size={16} strokeWidth={2} />
          <Text variant="caption" weight="medium">
            {caixaCopy.builder.add}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  cardActive: { borderColor: BORDER_ACTIVE },
  cardExtra: { borderColor: BORDER_EXTRA },
  cardSoldOut: { opacity: 0.5 },
  photo: { width: '100%', height: 104, borderRadius: 10 },
  photoPlaceholder: { backgroundColor: 'rgba(242,232,216,0.05)' },
  extraTag: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: EXTRA_BG,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  extraTagText: { color: '#0A0A0A', fontSize: 10, fontWeight: '600' },
  soldOutOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  soldOutText: { color: theme.colors.fg, fontSize: 11, fontWeight: '600', letterSpacing: 1.5 },
  title: { minHeight: 34 },
  price: { color: '#D4AF37' },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
  },
  addDisabled: { opacity: 0.5 },
});
