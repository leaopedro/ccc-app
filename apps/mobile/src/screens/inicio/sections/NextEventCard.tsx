// Cartão do próximo evento — eixo visual da tela do membro logado.
//
// Diferente das outras seções desta task, `event` nulo NÃO renderiza null:
// mostra um vazio discreto com `inicioCopy.empty.noNextEvent`. É a única
// seção que quebra a regra de "sem conteúdo, sem cabeçalho" — decisão do
// brief (task-10, resposta à primeira pergunta aberta do handoff): um
// buraco aqui, sem cabeçalho e sem faixa dourada, fica pior que uma linha
// de texto.
//
// `GoldPill` "VER EVENTO" recebe o mesmo `onPress` do card: é affordance
// visual, não um segundo alvo de toque — o card inteiro (FeatureCard) já
// dispara a mesma ação.

import { Image, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { formatEventDateRange } from '~/lib/format';
import { FeatureCard } from '~/screens/inicio/components/FeatureCard';
import { GoldPill } from '~/screens/inicio/components/GoldPill';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { homeIcon } from '~/screens/inicio/icons';
import { p } from '~/screens/inicio/palette';

import type { EventSummary } from '@ccc/shared/events';

const CalendarIcon = homeIcon('calendar');
const CarIcon = homeIcon('car');

export function NextEventCard({
  event,
  onPress,
}: {
  event: EventSummary | null;
  onPress: (slug: string) => void;
}) {
  if (!event) {
    return (
      <View style={styles.empty} testID="inicio-next-event-empty">
        <SectionLabel label={inicioCopy.sections.nextEvent} />
        <Text style={styles.emptyText}>{inicioCopy.empty.noNextEvent}</Text>
      </View>
    );
  }

  const locationLine = event.city && event.stateCode ? `${event.city}/${event.stateCode}` : null;
  const handlePress = () => onPress(event.slug);

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.nextEvent} />
      <FeatureCard
        testID="inicio-next-event"
        accessibilityLabel={event.title}
        onPress={handlePress}
      >
        <View style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.title}>{event.title}</Text>
            <View style={styles.meta}>
              <CalendarIcon color={p.gold} size={16} strokeWidth={1.75} />
              <Text style={styles.metaText}>{formatEventDateRange(event.startsAt, event.endsAt)}</Text>
            </View>
            {locationLine ? (
              <View style={styles.meta}>
                <CarIcon color={p.gold} size={16} strokeWidth={1.75} />
                <Text style={styles.metaText}>{locationLine}</Text>
              </View>
            ) : null}
            <GoldPill label={inicioCopy.cards.seeEvent} onPress={handlePress} />
          </View>
          {event.coverUrl ? (
            <Image source={{ uri: event.coverUrl }} accessible={false} style={styles.thumb} resizeMode="cover" />
          ) : null}
        </View>
      </FeatureCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  empty: { gap: 14 },
  emptyText: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    color: p.muted50,
  },
  row: { flexDirection: 'row', gap: 12 },
  info: { flex: 1, gap: 8, alignItems: 'flex-start' },
  title: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 17,
    color: p.cream,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    color: p.muted60,
  },
  thumb: {
    width: 96,
    borderRadius: 12,
    alignSelf: 'stretch',
  },
});
