import { Text } from '@jdm/ui';
import { Button } from '@jdm/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Minus, Plus, ShoppingBag } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCart } from '~/cart/context';
import { getCartAddErrorMessage } from '~/cart/error-message';
import { cartCopy } from '~/copy/cart';
import { storeCopy } from '~/copy/store';
import { useStoreProductDetail } from '~/hooks/useStoreProductDetail';
import { showMessage } from '~/lib/confirm';
import { formatBRL } from '~/lib/format';
import {
  buildProductCartItemInput,
  getDetailPurchaseMode,
  getInitialVariantSelection,
  getNextQuantity,
  getSelectedVariant,
  selectVariantForPurchase,
} from '~/screens/store/purchase-flow';
import { getVariantStockLabel, isVariantSelectable } from '~/screens/store/variant-selection';
import { theme } from '~/theme';

function productMethodsLabel(product: { canShip: boolean; canPickup: boolean }): string {
  const parts: string[] = [];
  if (product.canShip) parts.push(storeCopy.shipping);
  if (product.canPickup) parts.push(storeCopy.pickup);
  return parts.join(' · ') || storeCopy.shipping;
}

export default function StoreProductDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { product, collections, loading, error, refresh } = useStoreProductDetail(
    typeof slug === 'string' ? slug : undefined,
  );
  const { addItem, adding } = useCart();
  const insets = useSafeAreaInsets();
  const backTop = Platform.OS === 'web' ? 16 : Math.max(insets.top, 16);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [variantSheetOpen, setVariantSheetOpen] = useState(false);
  const hasMultipleVariants = product ? product.variants.length > 1 : false;

  const selectedVariant = useMemo(() => {
    if (!product) return null;
    return getSelectedVariant(product, selectedVariantId);
  }, [product, selectedVariantId]);

  useEffect(() => {
    if (!product) {
      setSelectedVariantId(null);
      setQuantity(1);
      return;
    }

    const nextSelectedVariantId =
      product.variants.length === 1 ? getInitialVariantSelection(product) : selectedVariantId;
    setSelectedVariantId(nextSelectedVariantId);
    setQuantity((current) => getNextQuantity(product, nextSelectedVariantId, current));
  }, [product, selectedVariantId]);

  const purchaseMode = product ? getDetailPurchaseMode(product, selectedVariantId) : 'unavailable';
  const selectedVariantStockLabel = selectedVariant ? getVariantStockLabel(selectedVariant) : null;
  const heroImage = product?.images[0]?.url ?? product?.coverImageUrl ?? null;

  const updateQuantity = (nextQuantity: number) => {
    if (!product) return;
    setQuantity(getNextQuantity(product, selectedVariantId, nextQuantity));
  };

  const handleAddToCart = async () => {
    if (!product) {
      showMessage(storeCopy.soldOut);
      return;
    }

    if (purchaseMode !== 'add' || !selectedVariant) {
      if (purchaseMode === 'open_picker') {
        setVariantSheetOpen(true);
        return;
      }
      showMessage(storeCopy.soldOut);
      return;
    }

    try {
      await addItem(buildProductCartItemInput(selectedVariant.id, quantity));
      showMessage(storeCopy.added);
      router.push('/cart' as never);
    } catch (error: unknown) {
      showMessage(getCartAddErrorMessage(error));
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (!product || error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{storeCopy.notFound}</Text>
        <View style={styles.retryWrap}>
          <Button label={storeCopy.retry} variant="secondary" onPress={() => void refresh()} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View>
        {heroImage ? (
          <Image source={{ uri: heroImage }} style={styles.heroImage} accessible={false} />
        ) : (
          <View style={[styles.heroImage, styles.heroFallback]} />
        )}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/events'))}
          accessibilityRole="button"
          accessibilityLabel={storeCopy.actions.back}
          hitSlop={8}
          style={[styles.backButton, { top: backTop }]}
        >
          <ArrowLeft color={theme.colors.fg} size={22} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text variant="eyebrow" tone="brand">
          {storeCopy.eyebrow}
        </Text>
        <Text variant="h1">{product.title}</Text>
        <Text variant="bodySm" tone="secondary">
          {product.productType.name} · {productMethodsLabel(product)}
        </Text>
        {selectedVariant ? (
          <View style={styles.priceRow}>
            <Text variant="h2">{formatBRL(selectedVariant.displayPriceCents)}</Text>
            {selectedVariantStockLabel ? (
              <View style={styles.stockPill}>
                <Text style={styles.stockPillText}>{selectedVariantStockLabel}</Text>
              </View>
            ) : null}
          </View>
        ) : hasMultipleVariants ? (
          <Text variant="bodySm" tone="secondary">
            {storeCopy.chooseVariant}
          </Text>
        ) : null}
      </View>

      {product.images.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.gallery}
        >
          {product.images.map((image) => (
            <Image key={image.id} source={{ uri: image.url }} style={styles.galleryImage} />
          ))}
        </ScrollView>
      ) : null}

      {collections.length > 0 ? (
        <View style={styles.section}>
          <Text variant="h3">{storeCopy.collections}</Text>
          <View style={styles.chips}>
            {collections.map((collection) => (
              <View key={collection.id} style={styles.chip}>
                <Text style={styles.chipText}>{collection.title}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="h3">{storeCopy.variants}</Text>
        {hasMultipleVariants ? (
          <Pressable
            onPress={() => setVariantSheetOpen(true)}
            style={styles.variantTrigger}
            accessibilityRole="button"
            accessibilityLabel={storeCopy.chooseVariant}
          >
            <View style={styles.variantTriggerBody}>
              <Text style={styles.variantTriggerLabel}>{storeCopy.selectedVariant}</Text>
              {selectedVariant ? (
                <>
                  <Text style={styles.variantTriggerValue}>{selectedVariant.title}</Text>
                  <Text style={styles.variantMeta}>
                    {selectedVariantStockLabel
                      ? `${formatBRL(selectedVariant.displayPriceCents)} · ${selectedVariantStockLabel}`
                      : formatBRL(selectedVariant.displayPriceCents)}
                  </Text>
                </>
              ) : (
                <Text style={styles.variantMeta}>{storeCopy.chooseVariant}</Text>
              )}
            </View>
            <Plus color={theme.colors.fg} size={16} strokeWidth={1.75} />
          </Pressable>
        ) : selectedVariant ? (
          <View style={[styles.variantCard, styles.variantCardSelected]}>
            <View style={styles.variantTop}>
              <Text style={styles.variantTitle}>{selectedVariant.title}</Text>
              <Text style={styles.variantPrice}>
                {formatBRL(selectedVariant.displayPriceCents)}
              </Text>
            </View>
            {selectedVariantStockLabel ? (
              <Text style={styles.variantMeta}>{selectedVariantStockLabel}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text variant="h3">{storeCopy.quantity}</Text>
        <View style={styles.quantityRow}>
          <Pressable
            onPress={() => updateQuantity(quantity - 1)}
            accessibilityRole="button"
            accessibilityLabel={storeCopy.actions.decreaseQuantity}
            style={styles.quantityButton}
          >
            <Minus color={theme.colors.fg} size={18} strokeWidth={2} />
          </Pressable>
          <View style={styles.quantityValue}>
            <Text variant="h3">{quantity}</Text>
          </View>
          <Pressable
            onPress={() => updateQuantity(quantity + 1)}
            accessibilityRole="button"
            accessibilityLabel={storeCopy.actions.increaseQuantity}
            style={styles.quantityButton}
          >
            <Plus color={theme.colors.fg} size={18} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text variant="h3">{storeCopy.description}</Text>
        <Text variant="body" tone="secondary">
          {product.description}
        </Text>
      </View>

      <View style={styles.section}>
        <Button
          label={adding ? storeCopy.adding : storeCopy.addToCart}
          onPress={() => void handleAddToCart()}
          disabled={adding || purchaseMode === 'unavailable'}
        />
        {purchaseMode === 'unavailable' ? (
          <Text style={styles.errorText}>{storeCopy.unavailable}</Text>
        ) : (
          <Pressable
            onPress={() => router.push('/cart' as never)}
            accessibilityRole="button"
            accessibilityLabel={cartCopy.title}
            style={styles.cartHint}
          >
            <ShoppingBag color={theme.colors.muted} size={16} strokeWidth={1.75} />
            <Text style={styles.cartHintText}>{cartCopy.title}</Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={variantSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setVariantSheetOpen(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setVariantSheetOpen(false)} />
          <View style={styles.sheetCard}>
            <View style={styles.sheetHeader}>
              <Text variant="h3">{storeCopy.variantSheetTitle}</Text>
              <Pressable
                onPress={() => setVariantSheetOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={storeCopy.closeSheet}
                style={styles.sheetClose}
              >
                <Text style={styles.sheetCloseText}>{storeCopy.closeSheet}</Text>
              </Pressable>
            </View>
            <View style={styles.variantGrid}>
              {product.variants.map((variant) => {
                const isSelected = selectedVariant?.id === variant.id;
                const selectable = isVariantSelectable(variant);
                const stockLabel = getVariantStockLabel(variant);
                return (
                  <Pressable
                    key={variant.id}
                    onPress={() => {
                      const nextVariantId = selectVariantForPurchase(product, variant.id);
                      if (!nextVariantId) return;
                      setSelectedVariantId(nextVariantId);
                      setQuantity((current) => getNextQuantity(product, nextVariantId, current));
                      setVariantSheetOpen(false);
                    }}
                    disabled={!selectable}
                    style={[
                      styles.variantGridCard,
                      isSelected && styles.variantCardSelected,
                      !selectable && styles.variantCardDisabled,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected, disabled: !selectable }}
                  >
                    <Text style={styles.variantTitle}>{variant.title}</Text>
                    <Text style={styles.variantPrice}>{formatBRL(variant.displayPriceCents)}</Text>
                    {stockLabel ? <Text style={styles.variantMeta}>{stockLabel}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: theme.spacing.xl,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  heroImage: {
    width: '100%',
    height: 320,
  },
  heroFallback: {
    backgroundColor: theme.colors.border,
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 10, 10, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  stockPill: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.accent + '18',
  },
  stockPillText: {
    color: theme.colors.accent,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  gallery: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  galleryImage: {
    width: 136,
    height: 136,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.border,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  chipText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  variantList: {
    gap: theme.spacing.sm,
  },
  variantTrigger: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    backgroundColor: '#101016',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  variantTriggerBody: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  variantTriggerLabel: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  variantTriggerValue: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  variantCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    backgroundColor: '#101016',
  },
  variantCardSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent + '12',
  },
  variantCardDisabled: {
    opacity: 0.55,
  },
  variantTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  variantTitle: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  variantPrice: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  variantMeta: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheetCard: {
    backgroundColor: '#0F1015',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  sheetClose: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
  },
  sheetCloseText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  variantGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  variantGridCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    backgroundColor: '#14151C',
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  quantityButton: {
    width: 44,
    height: 44,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101016',
  },
  quantityValue: {
    minWidth: 72,
    height: 44,
    borderRadius: theme.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.border,
  },
  retryWrap: {
    width: '100%',
    marginTop: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.muted,
    textAlign: 'center',
  },
  cartHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
  },
  cartHintText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
});
