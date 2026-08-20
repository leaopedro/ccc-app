// Faixa horizontal — ingressos válidos do membro.
//
// Só ingressos com status 'valid' aparecem: 'used' e 'revoked' não têm mais
// utilidade na tela de início. Lista filtrada vazia não renderiza nada —
// não existe cabeçalho sem conteúdo embaixo.

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { inicioCopy } from '~/copy/inicio';
import { formatEventDateRange } from '~/lib/format';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

import type { MyTicket } from '@ccc/shared/tickets';

export function MyTicketsSection({
  tickets,
  onOpenTicket,
  onSeeAll,
}: {
  tickets: MyTicket[];
  onOpenTicket: (id: string) => void;
  onSeeAll: () => void;
}) {
  const valid = tickets.filter((ticket) => ticket.status === 'valid');
  if (valid.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.myTickets} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {valid.map((ticket) => (
          <Pressable
            key={ticket.id}
            onPress={() => onOpenTicket(ticket.id)}
            accessibilityRole="button"
            accessibilityLabel={ticket.event.title}
            testID={`inicio-ticket-${ticket.id}`}
            style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
          >
            <Text style={styles.title} numberOfLines={2}>
              {ticket.event.title}
            </Text>
            <Text style={styles.meta}>
              {formatEventDateRange(ticket.event.startsAt, ticket.event.endsAt)}
            </Text>
            <Text style={styles.tier}>{ticket.tierName}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        onPress={onSeeAll}
        accessibilityRole="link"
        accessibilityLabel={inicioCopy.cards.seeTickets}
        testID="inicio-tickets-see-all"
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        <Text style={styles.seeAll}>{inicioCopy.cards.seeTickets}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  row: { gap: 12 },
  card: {
    width: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: p.hairline,
    backgroundColor: p.surface,
    padding: 12,
    gap: 6,
  },
  pressed: { opacity: 0.9 },
  title: { fontFamily: 'Jost_600SemiBold', fontSize: 14, color: p.cream },
  meta: { fontFamily: 'Jost_500Medium', fontSize: 12, color: p.muted60 },
  tier: { fontFamily: 'Jost_600SemiBold', fontSize: 13, color: p.gold },
  seeAll: {
    fontFamily: 'Jost_600SemiBold',
    fontSize: 13,
    color: p.gold,
    textAlign: 'center',
  },
});
