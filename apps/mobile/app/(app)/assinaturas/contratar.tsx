import { useLocalSearchParams } from 'expo-router';

import ContratarScreen from '~/screens/assinaturas/ContratarScreen';

export default function ContratarRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  return <ContratarScreen slug={slug} />;
}
