import { useLocalSearchParams } from 'expo-router';

import AlterarPlanoScreen from '~/screens/assinaturas/AlterarPlanoScreen';

// Plan-change confirmation. No platform gate here on purpose: a member who
// cannot change plans right now (Apple membership, past_due, gate off) sees
// the reason INSIDE the screen, which is more useful than being bounced
// away with no explanation.
export default function AlterarRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  return <AlterarPlanoScreen slug={slug} />;
}
