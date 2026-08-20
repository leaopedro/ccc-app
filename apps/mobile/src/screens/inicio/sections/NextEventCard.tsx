// Cartão do próximo evento — eixo visual da tela do membro logado.
//
// Diferente das outras seções desta task, `event` nulo NÃO renderiza null:
// mostra um vazio discreto com `inicioCopy.empty.noNextEvent`. É a única
// seção que quebra a regra de "sem conteúdo, sem cabeçalho" — decisão do
// brief (task-10, resposta à primeira pergunta aberta do handoff): um
// buraco aqui, sem cabeçalho e sem faixa dourada, fica pior que uma linha
// de texto.
//
// A pílula "VER EVENTO" é um `View` com o mesmo tratamento visual de
// `GoldPill` (mesmo gradiente, raio e tipografia), não o componente
// `GoldPill` em si — fix round 1 (Minor 7): `GoldPill` exige `onPress` e
// vira seu próprio `Pressable` com `accessibilityRole="button"`, o que
// aninhava um segundo alvo de toque dentro do `FeatureCard` que já cobre o
// card inteiro. Um card com dois alvos de toque sobrepostos é pior a11y do
// que um card com um alvo e uma pílula puramente visual.

import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { formatEventDateRange } from '~/lib/format';
import { FeatureCard } from '~/screens/inicio/components/FeatureCard';
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
              <Text style={styles.metaText}>
                {formatEventDateRange(event.startsAt, event.endsAt)}
              </Text>
            </View>
            {locationLine ? (
              <View style={styles.meta}>
                <CarIcon color={p.gold} size={16} strokeWidth={1.75} />
                <Text style={styles.metaText}>{locationLine}</Text>
              </View>
            ) : null}
            <View style={styles.pillWrap} testID="inicio-next-event-pill">
              <LinearGradient
                colors={[p.goldLight, p.goldDeep]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.pillGradient}
              >
                <Text style={styles.pillLabel}>{inicioCopy.cards.seeEvent}</Text>
              </LinearGradient>
            </View>
          </View>
          {event.coverUrl ? (
            <Image
              source={{ uri: event.coverUrl }}
              accessible={false}
              testID="inicio-next-event-thumb"
              style={styles.thumb}
              resizeMode="cover"
            />
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
  // Mesmos valores de GoldPill.tsx (wrap/gradient/label), reproduzidos aqui
  // como affordance puramente visual — ver nota no topo do arquivo.
  pillWrap: { borderRadius: 9, overflow: 'hidden' },
  pillGradient: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  pillLabel: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 11,
    letterSpacing: 2,
    color: p.bg,
    textTransform: 'uppercase',
  },
  thumb: {
    width: 96,
    borderRadius: 12,
    alignSelf: 'stretch',
  },
});
