import { brand } from '@ccc/design';
import type {
  StoreCollection,
  StoreProduct,
  StoreProductSummary,
  StoreSettings,
  StoreProductType,
  StoreProductVariant,
} from '@ccc/shared/store';
import { Badge, Button, Text } from '@ccc/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { ShoppingCart } from 'lucide-react-native';
import { startTransition, useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getStoreProduct,
  getStoreSettings,
  listStoreCollections,
  listStoreProducts,
  listStoreProductTypes,
} from '~/api/store';
import { useCart } from '~/cart/context';
import { getCartAddErrorMessage } from '~/cart/error-message';
import { cartCopy } from '~/copy/cart';
import { storeCopy } from '~/copy/store';
import { showMessage } from '~/lib/confirm';
import { formatBRL } from '~/lib/format';
import { DEFAULT_STORE_HERO_HEADER, loadStoreHeroHeader } from '~/store/hero-header';
import { resolveAddToCartVariantSelection } from '~/store/variant-selection';
import { theme } from '~/theme';

const BRAND_RED = brand.color.brand;

const formatPriceRange = (product: StoreProductSummary): string => {
  const { minDisplayPriceCents, maxDisplayPriceCents } = product.priceRange;
  if (minDisplayPriceCents === maxDisplayPriceCents) return formatBRL(minDisplayPriceCents);
  return `${formatBRL(minDisplayPriceCents)} - ${formatBRL(maxDisplayPriceCents)}`;
};

const formatVariantPrice = (variant: StoreProductVariant): string =>
  formatBRL(variant.displayPriceCents);

const productBadgeLabel = (product: { canShip: boolean; canPickup: boolean }): string => {
  const parts: string[] = [];
  if (product.canShip) parts.push(storeCopy.badges.shipping);
  if (product.canPickup) parts.push(storeCopy.badges.pickup);
  return parts.join(' · ') || storeCopy.badges.shipping;
};

type VariantPickerState = {
  product: StoreProduct;
  variants: StoreProductVariant[];
};

export default function StoreIndex() {
  const router = useRouter();
  const { addItem, adding, itemCount } = useCart();
  const insets = useSafeAreaInsets();
  const headerTop = Platform.OS === 'web' ? 8 : Math.max(insets.top, 16) + 8;
  const [search, setSearch] = useState('');
  const [collections, setCollections] = useState<StoreCollection[]>([]);
  const [productTypes, setProductTypes] = useState<StoreProductType[]>([]);
  const [heroHeader, setHeroHeader] =
    useState<Pick<StoreSettings, 'storeHeaderTitle' | 'storeHeaderSubtitle'>>(
      DEFAULT_STORE_HERO_HEADER,
    );
  const [items, setItems] = useState<StoreProductSummary[] | null>(null);
  const [collectionSlug, setCollectionSlug] = useState<string | null>(null);
  const [productTypeSlug, setProductTypeSlug] = useState<string | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [variantPicker, setVariantPicker] = useState<VariantPickerState | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const searchQuery = useDeferredValue(search.trim());
  const hasMountedRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadFilters = useCallback(async () => {
    setLoadingFilters(true);
    try {
      const [[nextCollections, nextProductTypes], header] = await Promise.all([
        Promise.all([listStoreCollections(), listStoreProductTypes()]),
        loadStoreHeroHeader(getStoreSettings),
      ]);
      setCollections(nextCollections.items);
      setProductTypes(nextProductTypes.items);
      setHeroHeader(header);
    } finally {
      setLoadingFilters(false);
    }
  }, []);

  const loadProducts = useCallback(
    async ({ cursor, append = false }: { cursor?: string; append?: boolean } = {}) => {
      const requestId = append ? requestIdRef.current : ++requestIdRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadingProducts(true);
        setError(false);
        setNextCursor(null);
      }
      try {
        const response = await listStoreProducts({
          q: searchQuery.length > 0 ? searchQuery : undefined,
          collectionSlug: collectionSlug ?? undefined,
          productTypeSlug: productTypeSlug ?? undefined,
          cursor,
        });
        if (requestId !== requestIdRef.current) return;
        setItems((current) => (append ? [...(current ?? []), ...response.items] : response.items));
        setNextCursor(response.nextCursor);
      } catch {
        if (requestId !== requestIdRef.current) return;
        if (!append) {
          setItems([]);
          setError(true);
          setNextCursor(null);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          if (append) {
            setLoadingMore(false);
          } else {
            setLoadingProducts(false);
          }
        }
      }
    },
    [collectionSlug, productTypeSlug, searchQuery],
  );

  useEffect(() => {
    void loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useFocusEffect(
    useCallback(() => {
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        return;
      }

      void loadFilters();
      void loadProducts();
    }, [loadFilters, loadProducts]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadFilters(), loadProducts()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadFilters, loadProducts]);

  const addVariantToCart = useCallback(
    async (productId: string, variantId: string) => {
      setPendingProductId(productId);
      try {
        await addItem({
          variantId,
          source: 'purchase',
          kind: 'product',
          quantity: 1,
          tickets: [],
          metadata: { source: 'mobile' },
        });
        showMessage(storeCopy.actions.added);
      } finally {
        setPendingProductId(null);
      }
    },
    [addItem],
  );

  const closeVariantPicker = useCallback(() => {
    if (pendingProductId) return;
    setVariantPicker(null);
    setSelectedVariantId(null);
  }, [pendingProductId]);

  const onConfirmVariant = useCallback(async () => {
    if (!variantPicker || !selectedVariantId) {
      showMessage(storeCopy.variantPicker.confirmHint);
      return;
    }

    try {
      await addVariantToCart(variantPicker.product.id, selectedVariantId);
      setVariantPicker(null);
      setSelectedVariantId(null);
    } catch (error: unknown) {
      showMessage(getCartAddErrorMessage(error));
    }
  }, [addVariantToCart, selectedVariantId, variantPicker]);

  const onAddToCart = useCallback(
    async (product: StoreProductSummary) => {
      if (adding || pendingProductId) return;
      setPendingProductId(product.id);
      try {
        const detail = await getStoreProduct(product.slug);
        const selection = resolveAddToCartVariantSelection(detail.product.variants);

        if (selection.kind === 'sold_out') {
          showMessage(cartCopy.errors.variantSoldOut);
          return;
        }

        if (selection.kind === 'requires_selection') {
          setVariantPicker({
            product: detail.product,
            variants: selection.variants,
          });
          setSelectedVariantId(null);
          return;
        }

        await addVariantToCart(detail.product.id, selection.variant.id);
      } catch (error: unknown) {
        showMessage(getCartAddErrorMessage(error));
      } finally {
        setPendingProductId(null);
      }
    },
    [addVariantToCart, adding, pendingProductId],
  );

  const renderHero = () => (
    <View style={[styles.headerWrap, { paddingTop: headerTop }]}>
      <LinearGradient colors={['#2D0603', '#130D0D', '#0B0B0F']} style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text variant="eyebrow" tone="brand">
            {storeCopy.header.eyebrow}
          </Text>
          <Text variant="h1" className="mt-2">
            {heroHeader.storeHeaderTitle ?? storeCopy.header.title}
          </Text>
          <Text variant="body" tone="secondary" className="mt-3">
            {heroHeader.storeHeaderSubtitle ?? storeCopy.header.subtitle}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/cart' as never)}
          accessibilityRole="button"
          accessibilityLabel={storeCopy.actions.openCartWithCount(itemCount)}
          hitSlop={8}
          style={styles.cartButton}
        >
          <ShoppingCart color="#F5F5F5" size={22} strokeWidth={1.75} />
          {itemCount > 0 ? (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{cartCopy.badge(itemCount)}</Text>
            </View>
          ) : null}
        </Pressable>
      </LinearGradient>
    </View>
  );

  const listHeader = (
    <View>
      {renderHero()}
      <SearchInput value={search} onChangeText={setSearch} />
      <FilterRow
        label={storeCopy.filters.productTypes}
        loading={loadingFilters}
        allLabel={storeCopy.filters.allProductTypes}
        selectedSlug={productTypeSlug}
        items={productTypes.map((item) => ({ slug: item.slug, label: item.name }))}
        onSelect={(slug) => startTransition(() => setProductTypeSlug(slug))}
      />
      <FilterRow
        label={storeCopy.filters.collections}
        loading={loadingFilters}
        allLabel={storeCopy.filters.allCollections}
        selectedSlug={collectionSlug}
        items={collections.map((item) => ({ slug: item.slug, label: item.title }))}
        onSelect={(slug) => startTransition(() => setCollectionSlug(slug))}
      />
      <View style={styles.summaryRow}>
        <Text variant="bodySm" tone="muted">
          {storeCopy.summary.itemCount(items?.length ?? 0)}
        </Text>
      </View>
    </View>
  );

  if (loadingProducts && items === null) {
    return (
      <View style={styles.center}>
        {listHeader}
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={BRAND_RED} />
          <Text variant="bodySm" tone="secondary" className="mt-3">
            {storeCopy.states.loading}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? (
        <View style={styles.container}>
          {listHeader}
          <View style={styles.emptyState}>
            <Text variant="h3">{storeCopy.states.error}</Text>
            <Button
              label={storeCopy.actions.retry}
              onPress={() => {
                void loadProducts();
              }}
              className="mt-4"
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.listContent}
          onEndReached={() => {
            if (loadingMore || loadingProducts || error || !nextCursor) return;
            void loadProducts({ cursor: nextCursor, append: true });
          }}
          onEndReachedThreshold={0.45}
          ListHeaderComponent={listHeader}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.paginationFooter}>
                <ActivityIndicator color={BRAND_RED} />
                <Text variant="bodySm" tone="secondary" className="mt-3">
                  {storeCopy.pagination.loadingMore}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text variant="h3">{storeCopy.states.empty}</Text>
              <Text variant="body" tone="secondary" className="mt-2">
                {storeCopy.states.emptyHint}
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void onRefresh();
              }}
              tintColor={BRAND_RED}
              colors={[BRAND_RED]}
            />
          }
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              adding={pendingProductId === item.id}
              onPress={() => {
                router.push(`/store/${item.slug}` as never);
              }}
              onAdd={() => {
                void onAddToCart(item);
              }}
            />
          )}
        />
      )}
      <VariantPickerModal
        visible={variantPicker !== null}
        product={variantPicker?.product ?? null}
        variants={variantPicker?.variants ?? []}
        selectedVariantId={selectedVariantId}
        adding={pendingProductId === variantPicker?.product.id}
        onSelect={setSelectedVariantId}
        onClose={closeVariantPicker}
        onConfirm={() => {
          void onConfirmVariant();
        }}
      />
    </View>
  );
}

function SearchInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.searchBlock}>
      <Text variant="caption" tone="secondary" className="mb-2">
        {storeCopy.search.label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={storeCopy.search.placeholder}
        placeholderTextColor={theme.colors.muted}
        accessibilityLabel={storeCopy.search.label}
        style={styles.searchInput}
      />
    </View>
  );
}

function FilterRow({
  label,
  loading,
  allLabel,
  selectedSlug,
  items,
  onSelect,
}: {
  label: string;
  loading: boolean;
  allLabel: string;
  selectedSlug: string | null;
  items: { slug: string; label: string }[];
  onSelect: (slug: string | null) => void;
}) {
  return (
    <View style={styles.filterSection}>
      <Text variant="caption" tone="secondary" className="mb-2">
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <Chip active={selectedSlug === null} label={allLabel} onPress={() => onSelect(null)} />
        {items.map((item) => (
          <Chip
            key={item.slug}
            active={selectedSlug === item.slug}
            label={item.label}
            onPress={() => onSelect(item.slug)}
          />
        ))}
        {loading ? (
          <View style={styles.chipLoading}>
            <ActivityIndicator color={BRAND_RED} size="small" />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text
        variant="bodySm"
        weight={active ? 'bold' : 'medium'}
        tone={active ? 'inverse' : 'secondary'}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ProductCard({
  product,
  adding,
  onPress,
  onAdd,
}: {
  product: StoreProductSummary;
  adding: boolean;
  onPress: () => void;
  onAdd: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={product.title}>
        {product.coverImageUrl ? (
          <Image
            source={{ uri: product.coverImageUrl }}
            style={styles.cardImage}
            accessible={false}
          />
        ) : (
          <View style={[styles.cardImage, styles.cardImagePlaceholder]} />
        )}
        <View style={styles.cardBody}>
          <View style={styles.cardMeta}>
            <Badge label={productBadgeLabel(product)} tone="neutral" size="sm" />
            <Text variant="caption" tone="muted">
              {product.productType.name}
            </Text>
          </View>
          <Text variant="body" weight="bold" numberOfLines={2}>
            {product.title}
          </Text>
          {product.shortDescription ? (
            <Text variant="bodySm" tone="secondary" numberOfLines={2} className="mt-1">
              {product.shortDescription}
            </Text>
          ) : null}
          <Text variant="bodyLg" weight="bold" className="mt-3">
            {formatPriceRange(product)}
          </Text>
        </View>
      </Pressable>
      <View style={styles.cardActions}>
        <Button
          label={
            !product.inStock
              ? storeCopy.actions.soldOut
              : adding
                ? storeCopy.actions.adding
                : storeCopy.actions.add
          }
          onPress={onAdd}
          disabled={!product.inStock || adding}
          loading={adding}
          size="sm"
          className="mt-4"
        />
      </View>
    </View>
  );
}

function VariantPickerModal({
  visible,
  product,
  variants,
  selectedVariantId,
  adding,
  onSelect,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  product: StoreProduct | null;
  variants: StoreProductVariant[];
  selectedVariantId: string | null;
  adding: boolean;
  onSelect: (variantId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.modalScrim} onPress={onClose} />
        <View style={styles.modalCard}>
          <Text variant="h3">{storeCopy.variantPicker.title}</Text>
          <Text variant="bodySm" tone="secondary" className="mt-2">
            {storeCopy.variantPicker.subtitle}
          </Text>
          {product ? (
            <Text variant="body" weight="bold" className="mt-4">
              {product.title}
            </Text>
          ) : null}

          <Text variant="caption" tone="secondary" className="mt-4 mb-2">
            {storeCopy.variantPicker.label}
          </Text>
          <View style={styles.variantList}>
            {variants.map((variant) => {
              const selected = selectedVariantId === variant.id;

              return (
                <Pressable
                  key={variant.id}
                  onPress={() => onSelect(variant.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.variantOption, selected && styles.variantOptionSelected]}
                >
                  <View style={styles.variantOptionBody}>
                    <Text variant="bodySm" weight="bold" tone={selected ? 'inverse' : 'primary'}>
                      {variant.title}
                    </Text>
                    <Text variant="caption" tone={selected ? 'inverse' : 'secondary'}>
                      {formatVariantPrice(variant)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.modalActions}>
            <Button
              label={storeCopy.actions.cancelVariant}
              onPress={onClose}
              disabled={adding}
              variant="secondary"
              className="flex-1"
            />
            <Button
              label={adding ? storeCopy.actions.adding : storeCopy.actions.confirmVariant}
              onPress={onConfirm}
              disabled={adding || !selectedVariantId}
              loading={adding}
              className="flex-1"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  headerWrap: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
  },
  hero: {
    borderRadius: 20,
    padding: theme.spacing.xl,
    minHeight: 196,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  heroCopy: {
    maxWidth: '82%',
  },
  cartButton: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  cartBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: BRAND_RED,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cartBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  searchBlock: {
    paddingHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.lg,
  },
  searchInput: {
    minHeight: 52,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#26262D',
    backgroundColor: '#111116',
    color: theme.colors.fg,
    fontFamily: 'Inter_400Regular',
    fontSize: theme.font.size.lg,
  },
  filterSection: {
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
  },
  chipRow: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.lg,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A33',
    backgroundColor: '#111116',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: BRAND_RED,
    backgroundColor: BRAND_RED,
  },
  chipLoading: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
  summaryRow: {
    paddingHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  listContent: {
    paddingBottom: 120,
  },
  paginationFooter: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xl,
    alignItems: 'center',
  },
  gridRow: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  card: {
    flex: 1,
    maxWidth: '48%',
    backgroundColor: '#111116',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1B1B22',
  },
  cardImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#1A1A20',
  },
  cardImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    padding: theme.spacing.md,
  },
  cardActions: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,10,10,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111116',
    padding: theme.spacing.xl,
  },
  variantList: {
    gap: theme.spacing.sm,
  },
  variantOption: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#17171D',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  variantOptionSelected: {
    borderColor: BRAND_RED,
    backgroundColor: '#2D0603',
  },
  variantOptionBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xl,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 56,
  },
  loadingBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: 56,
  },
});
