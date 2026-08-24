// Seção — prova social: carros já confirmados no próximo evento.
//
// Exceção deliberada à regra de seção pura (task-9 brief, D3): busca via
// getConfirmedCars diretamente, porque o slug do próximo evento só é
// conhecido no momento da montagem da tela. `ConfirmedCar` (packages/shared/
// src/events.ts) é um payload anonimizado: sem id/placa/apelido, só
// make/model/year/photoUrl/isPremiumActive — não há um campo "nome" único,
// então o nome exibido é `${make} ${model}`.
//
// Renderiza null quando eventSlug é nulo (sem chamar a API), e quando a
// lista volta vazia — decisão explícita do brief: a seção só aparece quando
// tem substância. Não é clicável nesta entrega.

import type { ConfirmedCar } from '@ccc/shared/events';
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getConfirmedCars } from '~/api/events';
import { inicioCopy } from '~/copy/inicio';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

export function ConfirmedCarsSection({ eventSlug }: { eventSlug: string | null }) {
  const [cars, setCars] = useState<ConfirmedCar[]>([]);

  useEffect(() => {
    if (!eventSlug) {
      setCars([]);
      return;
    }

    let cancelled = false;
    void getConfirmedCars(eventSlug)
      .then((response) => {
        if (!cancelled) setCars(response.items);
      })
      .catch(() => {
        if (!cancelled) setCars([]);
      });

    return () => {
      cancelled = true;
    };
  }, [eventSlug]);

  if (!eventSlug || cars.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.confirmedCars} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {cars.map((car) => (
          <View key={car.ref} style={styles.item}>
            {car.photoUrl ? (
              <Image
                source={{ uri: car.photoUrl }}
                accessible={false}
                style={styles.photo}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.photo, styles.placeholder]} />
            )}
            <Text style={styles.name} numberOfLines={1}>
              {car.make} {car.model}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  row: { gap: 12 },
  item: { width: 72, alignItems: 'center', gap: 6 },
  photo: { width: 56, height: 56, borderRadius: 28 },
  placeholder: { backgroundColor: p.surface },
  name: {
    fontFamily: 'Jost_500Medium',
    fontSize: 11,
    color: p.muted60,
    textAlign: 'center',
  },
});
