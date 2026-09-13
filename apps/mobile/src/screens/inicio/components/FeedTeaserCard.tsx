/**
 * Card de um post no carrossel da Início.
 *
 * Texto-first porque o composer do mobile ainda não envia foto
 * (FeedComposerSheet.onSubmit só passa body e carId), então post com foto é a
 * exceção. A foto, quando existe, vira fundo sob o mesmo degradê de três
 * paradas do HeroSection: p.scrimBottom sozinho é 86% de preto chapado e
 * apagaria a foto que ele deveria realçar.
 */

import type { HomeFeedItem } from '@ccc/shared/feed';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { p } from '~/screens/inicio/palette';

const CARD_WIDTH = 240;

export function FeedTeaserCard({ post, onPress }: { post: HomeFeedItem; onPress: () => void }) {
  const photo = post.photos[0] ?? null;
  const car = post.car;
  // O CONTRATO manda aqui, não a coluna: publicCarProfileSchema.nickname é
  // `z.string().nullable()` (packages/shared/src/feed.ts) mesmo com a coluna
  // NOT NULL, então `car.nickname` tipa como `string | null` e o `??` evita o
  // accessibilityLabel virar "Por null" no leitor de tela. Sem carro, o post é
  // de um membro que não escolheu carro na hora de postar.
  const authorLabel = car?.nickname ?? 'Membro';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // O corpo entra no label porque Pressable colapsa os filhos num nó só:
      // o que não estiver aqui não existe para leitor de tela.
      accessibilityLabel={`${post.event.title}. ${post.body}. Por ${authorLabel}`}
      accessibilityHint="Abre a página do evento"
      testID={`inicio-feed-card-${post.id}`}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {photo ? (
        <>
          <Image source={{ uri: photo.url }} style={styles.fill} accessible={false} />
          <LinearGradient
            colors={[p.scrimTop, p.scrimMid, p.scrimBottom]}
            style={styles.fill}
            pointerEvents="none"
          />
        </>
      ) : null}

      <View style={styles.content}>
        <Text style={styles.event} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {post.event.title}
        </Text>
        <Text style={styles.body} numberOfLines={3} maxFontSizeMultiplier={1.3}>
          {post.body}
        </Text>
        <View style={styles.authorRow}>
          {car?.photo ? (
            <Image source={{ uri: car.photo.url }} style={styles.avatar} accessible={false} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]} />
          )}
          <Text style={styles.author} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {authorLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    // minHeight, não height: lineHeight de StyleSheet não escala com Dynamic
    // Type, e altura fixa mais overflow hidden cortaria o texto em 150%.
    minHeight: 168,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.featureSurface,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },
  // Offsets explícitos em vez de StyleSheet.absoluteFill: seu tipo é
  // RegisteredStyle<AbsoluteFillStyle>, que não é atribuível a
  // ViewStyle | TextStyle | ImageStyle (usado aqui em Image e em
  // LinearGradient), e um cast esconderia esse desvio de tipo.
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  content: { flex: 1, padding: 14, gap: 8 },
  event: {
    fontFamily: 'Jost_500Medium',
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: p.gold,
  },
  body: {
    flex: 1,
    // Jost_400Regular NÃO existe neste app: _layout.tsx:177-180 registra só
    // Jost_300Regular (alias de Jost_300Light), 500Medium, 600SemiBold e
    // 700Bold. Um nome não registrado cai no system font sem aviso.
    fontFamily: 'Jost_500Medium',
    fontSize: 14,
    lineHeight: 20,
    color: p.cream,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 22, height: 22, borderRadius: 11 },
  avatarPlaceholder: { backgroundColor: p.surface },
  author: { flex: 1, fontFamily: 'Jost_500Medium', fontSize: 11, color: p.muted60 },
});
