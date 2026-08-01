import { useLocalSearchParams } from 'expo-router';

import PlanoDetalheScreen from '~/screens/assinaturas/PlanoDetalheScreen';

export default function PlanoDetalheRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <PlanoDetalheScreen slug={typeof slug === 'string' ? slug : undefined} />;
}
