// Seção — vitrine da loja.
//
// Exceção deliberada à regra de seção pura (task-9 brief, D2): consome
// useStoreProducts diretamente. A loja já é rota pública (apps/mobile/app/(app)/store),
// então isto funciona para o visitante anônimo sem login. `useStoreProducts`
// aceita `limit` na própria query (packages/shared/src/store.ts,
// storeProductListQuerySchema), então pedimos uma página pequena em vez de
// fatiar o resultado no cliente.
//
// TEASER_QUERY é module-scoped de propósito (fix round 1, CRITICAL 1): um
// objeto literal `{ limit: TEASER_LIMIT }` inline no corpo do componente
// teria identidade nova a cada render. Dentro de useStoreProducts.ts, esse
// objeto alimenta `useCallback(refresh, [resolvedQuery])`, e `refresh` é a
// única dependência do `useEffect` que dispara o fetch — nova identidade a
// cada render dispara o effect de novo, que troca `loading` e força outro
// render, loop infinito de GET /store/products. Módulo-scoped garante a
// mesma referência entre renders sem tocar em useStoreProducts.ts (outros
// chamadores do hook não passam query nenhuma, então nunca bateram nisso).
//
// Preço exibido é `priceRange.minDisplayPriceCents`/`maxDisplayPriceCents`,
// não `min/maxPriceCents`: display* já inclui o dev fee repassado ao
// comprador. `formatProductPrice` espelha `formatPriceRange` de
// apps/mobile/app/(app)/store/index.tsx: produto de preço único mostra um
// valor, produto de faixa (variantes com preços diferentes) mostra
// "min - max" — a Início não pode anunciar um preço mais baixo do que a
// loja mostra para o mesmo produto.

import type { StoreProductSummary } from '@ccc/shared/store';
import { router } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { useStoreProducts } from '~/hooks/useStoreProducts';
import { formatBRL } from '~/lib/format';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

const TEASER_LIMIT = 8;

// Module scope, not inline in the component body — see the CRITICAL 1 note
// above. Must stay a stable reference across renders.
const TEASER_QUERY = { limit: TEASER_LIMIT } as const;

const formatProductPrice = (priceRange: StoreProductSummary['priceRange']): string => {
  const { minDisplayPriceCents, maxDisplayPriceCents } = priceRange;
  if (minDisplayPriceCents === maxDisplayPriceCents) return formatBRL(minDisplayPriceCents);
  return `${formatBRL(minDisplayPriceCents)} - ${formatBRL(maxDisplayPriceCents)}`;
};

export function StoreTeaserSection() {
  const { items, error } = useStoreProducts(TEASER_QUERY);

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
            <Text style={styles.price}>{formatProductPrice(product.priceRange)}</Text>
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
