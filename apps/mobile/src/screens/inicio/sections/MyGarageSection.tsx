// Minha garagem — resumo na tela de início.
//
// Killswitch de gamificação: o campo canônico é o TOP-LEVEL
// `garage.gamification.enabled` (não o `garage.garage.gamification.enabled`
// aninhado, que é compat legado da Phase 1 — ver
// apps/mobile/src/screens/garage/garage-progression.viewmodel.ts, que traz
// o mesmo aviso "Do NOT read data.garage.gamification.enabled"). Esta seção
// respeita o mesmo campo aqui.
//
// Divergência de escopo registrada no report da task 10: o brief pedia para
// reusar `BadgeRow` de `@ccc/ui` alimentado por `garage.garage.badges`, mas
// `BadgeRow` exige `GarageBadgesOwnerResponse` (`{ enabled, catalog, badges
// }`) — o `catalog` (ícone/raridade por código) não existe em
// `GarageReadResponse`, só na resposta separada de `GET /me/garage/badges`
// (`getMyBadges`). Como este componente é puramente apresentacional e só
// recebe `GarageReadResponse`, a fileira de badges não é renderizada aqui.
// Não reimplementamos badges em paralelo — ver instrução do brief.
//
// Segunda divergência registrada no report: o brief pede "uma linha com a
// contagem de carros e de vagas", mas não existe em `inicioCopy` nenhuma
// chave para o rótulo dessa linha (ex.: "carros"/"vagas"), e o brief é
// explícito em não inventar copy inline. `garage.cars.length` e
// `garage.spots.length` ficam disponíveis para a Task 11 (ou uma chave nova
// de copy), mas esta seção não renderiza a linha até essa decisão de
// produto ser tomada.

import { StyleSheet, View } from 'react-native';

import { XPScoreboard } from '@ccc/ui';

import { inicioCopy } from '~/copy/inicio';
import { FeatureCard } from '~/screens/inicio/components/FeatureCard';
import { SectionLabel } from '~/screens/inicio/components/SectionLabel';

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
      <FeatureCard testID="inicio-garage" accessibilityLabel={inicioCopy.sections.myGarage} onPress={onPress}>
        {garage.progress ? <XPScoreboard progress={garage.progress} /> : null}
      </FeatureCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
});
