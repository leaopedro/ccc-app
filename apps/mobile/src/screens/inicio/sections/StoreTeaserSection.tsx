// Seção — vitrine da loja.
//
// Exceção deliberada à regra de seção pura (task-9 brief, D2): consome
// useStoreProducts diretamente. A loja já é rota pública (apps/mobile/app/(app)/store),
// então isto funciona para o visitante anônimo sem login. `useStoreProducts`
// aceita `limit` na própria query (packages/shared/src/store.ts,
// storeProductListQuerySchema), então pedimos uma página pequena em vez de
// fatiar o resultado no cliente.
//
// Preço exibido é `priceRange.minDisplayPriceCents`, não `minPriceCents`:
// display* já inclui o dev fee repassado ao comprador (mesma convenção de
// apps/mobile/app/(app)/store/index.tsx e dos steps de compra de ingresso).

import { router } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { useStoreProducts } from '~/hooks/useStoreProducts';
import { formatBRL } from '~/lib/format';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

const TEASER_LIMIT = 8;

export function StoreTeaserSection() {
  const { items, error } = useStoreProducts({ limit: TEASER_LIMIT });

  if (error || items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.store} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((product) => (
          <Pressable
            key={product.slug}
            onPress={() => router.push(`/store/${product.slug}` as never)}
            accessibilityRole="button"
            accessibilityLabel={product.title}
            testID={`inicio-store-${product.slug}`}
            style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
          >
            {product.coverImageUrl ? (
              <Image
                source={{ uri: product.coverImageUrl }}
                accessible={false}
                style={styles.image}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.image, styles.imagePlaceholder]} />
            )}
            <Text style={styles.title} numberOfLines={2}>
              {product.title}
            </Text>
            <Text style={styles.price}>
              {formatBRL(product.priceRange.minDisplayPriceCents)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable
        onPress={() => router.push('/store' as never)}
        accessibilityRole="link"
        accessibilityLabel={inicioCopy.cards.seeAllStore}
        testID="inicio-store-see-all"
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        <Text style={styles.seeAll}>{inicioCopy.cards.seeAllStore}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  row: { gap: 12 },
  card: {
    width: 140,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
    padding: 12,
    gap: 8,
  },
  pressed: { opacity: 0.9 },
  image: { width: '100%', height: 100, borderRadius: 10 },
  imagePlaceholder: { backgroundColor: p.featureSurface },
  title: { fontFamily: 'Jost_500Medium', fontSize: 13, color: p.cream },
  price: { fontFamily: 'Jost_600SemiBold', fontSize: 14, color: p.gold },
  seeAll: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 13,
    color: p.gold,
    textAlign: 'center',
  },
});
