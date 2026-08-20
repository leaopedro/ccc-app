// Seção 6 — eventos e experiências.
//
// Duas fontes: eventos reais (EventSummary, de GET /api/events) e destaques
// curados no banco (HomeHighlight ativos, ordenados, cobrindo Day Use e
// experiências automotivas, que não têm modelo de domínio próprio). Eventos
// reais aparecem antes dos destaques curados — decisão da emenda de escopo
// da Task 9. Destaque sem linkPath é informativo: FeatureCard não recebe
// onPress e portanto não vira alvo de toque nem anuncia role de botão.

import type { EventSummary } from '@ccc/shared/events';
import type { HomeHighlight } from '@ccc/shared/home';
import { Image, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { formatEventDateRange } from '~/lib/format';
import { FeatureCard } from '~/screens/inicio/components/FeatureCard';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

export function HighlightsSection({
  highlights,
  events,
  onOpenLink,
  onOpenEvent,
}: {
  highlights: HomeHighlight[];
  events: EventSummary[];
  onOpenLink: (path: string) => void;
  onOpenEvent: (slug: string) => void;
}) {
  if (highlights.length === 0 && events.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.highlights} />
      <View style={styles.list}>
        {events.map((event) => (
          <FeatureCard
            key={event.id}
            testID={`inicio-event-${event.slug}`}
            accessibilityLabel={event.title}
            onPress={() => onOpenEvent(event.slug)}
          >
            {event.coverUrl ? (
              <Image
                source={{ uri: event.coverUrl }}
                accessible={false}
                style={styles.image}
                resizeMode="cover"
              />
            ) : null}
            <Text style={styles.eyebrow}>{inicioCopy.highlightKind.event}</Text>
            <Text style={styles.title}>{event.title}</Text>
            <Text style={styles.subtitle}>
              {formatEventDateRange(event.startsAt, event.endsAt)}
            </Text>
          </FeatureCard>
        ))}

        {highlights.map((highlight, index) => {
          const { linkPath } = highlight;
          return (
            <FeatureCard
              key={`${highlight.sortOrder}-${highlight.title}`}
              testID={`inicio-highlight-${index}`}
              accessibilityLabel={highlight.title}
              {...(linkPath ? { onPress: () => onOpenLink(linkPath) } : {})}
            >
              {highlight.imageUrl ? (
                <Image
                  source={{ uri: highlight.imageUrl }}
                  accessible={false}
                  style={styles.image}
                  resizeMode="cover"
                />
              ) : null}
              <Text style={styles.eyebrow}>{inicioCopy.highlightKind[highlight.kind]}</Text>
              <Text style={styles.title}>{highlight.title}</Text>
              {highlight.subtitle ? (
                <Text style={styles.subtitle}>{highlight.subtitle}</Text>
              ) : null}
            </FeatureCard>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  list: { gap: 12 },
  image: {
    width: '100%',
    height: 140,
    borderRadius: 12,
    backgroundColor: p.surface,
  },
  eyebrow: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: p.goldDeep,
  },
  title: { fontFamily: 'Jost_600SemiBold', fontSize: 17, color: p.cream },
  subtitle: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    lineHeight: 19,
    color: p.muted60,
  },
});
