// Minha garagem — resumo na tela de início.
//
// Killswitch de gamificação: o campo canônico é o TOP-LEVEL
// `garage.gamification.enabled` (não o `garage.garage.gamification.enabled`
// aninhado, que é compat legado da Phase 1 — ver
// apps/mobile/src/screens/garage/garage-progression.viewmodel.ts, que traz
// o mesmo aviso "Do NOT read data.garage.gamification.enabled"). Esta seção
// respeita o mesmo campo aqui.
//
// Divergência de escopo (task-10 report, ruling R1 no fix round 1): o brief
// pedia para reusar `BadgeRow` de `@ccc/ui` alimentado por
// `garage.garage.badges`, mas `BadgeRow` exige `GarageBadgesOwnerResponse`
// (`{ enabled, catalog, badges }`) — o `catalog` (ícone/raridade por
// código) não existe em `GarageReadResponse`, só na resposta separada de
// `GET /me/garage/badges`. `BadgeRow` também exige `onOpenSheet` e
// `onLockedPress` e traz seus próprios `Pressable`s, que aninhariam dentro
// do `Pressable` de card inteiro do `FeatureCard`. Ruling do fix round 1:
// badges ficam só em `/garage`, não entram aqui. Nenhuma reimplementação
// paralela foi escrita.
//
// Linha de contagem (ruling R3 no fix round 1): com badges fora do escopo,
// esta é a única peça de conteúdo do card além do XPScoreboard opcional, e
// agora tem uma chave de copy dedicada (`inicioCopy.garage.counts`,
// autorizada no fix round 1). Ela SEMPRE renderiza (0 é um valor válido de
// `cars.length`/`spots.length`), então o card nunca fica vazio sob
// `SectionLabel` — não é preciso um guard adicional além do killswitch e do
// `garage` nulo já cobertos acima.

import { StyleSheet, Text, View } from 'react-native';

import { XPScoreboard } from '@ccc/ui';

import { inicioCopy } from '~/copy/inicio';
import { FeatureCard } from '~/screens/inicio/components/FeatureCard';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';
import { p } from '~/screens/inicio/palette';

import type { GarageReadResponse } from '~/api/garage';

export function MyGarageSection({
  garage,
  onPress,
}: {
  garage: GarageReadResponse | null;
  onPress: () => void;
}) {
  if (!garage) return null;
  if (!garage.gamification.enabled) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel label={inicioCopy.sections.myGarage} />
      <FeatureCard
        testID="inicio-garage"
        accessibilityLabel={inicioCopy.sections.myGarage}
        onPress={onPress}
      >
        {garage.progress ? <XPScoreboard progress={garage.progress} /> : null}
        <Text style={styles.counts}>
          {inicioCopy.garage.counts(garage.cars.length, garage.spots.length)}
        </Text>
      </FeatureCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  counts: {
    fontFamily: 'Jost_500Medium',
    fontSize: 13,
    color: p.muted60,
  },
});
