/**
 * Seção — posts sorteados de eventos públicos.
 *
 * Some por completo quando a lista vem vazia, igual ConfirmedCarsSection. A
 * lista fica vazia com frequência por desenho: só entram eventos publicados e
 * com feedAccess 'public', e o default de Event é 'attendees'.
 *
 * Recebe `posts` por prop em vez de buscar sozinha porque as duas homes já
 * chamam o hook no topo — a do membro precisa do refresh no pull-to-refresh.
 */

import type { HomeFeedItem } from '@ccc/shared/feed';
import { ScrollView, StyleSheet, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { FeedTeaserCard } from '~/screens/inicio/components/FeedTeaserCard';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';

export function CommunityFeedSection({
  posts,
  onOpenEvent,
}: {
  posts: HomeFeedItem[];
  onOpenEvent: (slug: string) => void;
}) {
  if (posts.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.communityFeed} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {posts.map((post) => (
          <FeedTeaserCard key={post.id} post={post} onPress={() => onOpenEvent(post.event.slug)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  row: { gap: 12 },
});
