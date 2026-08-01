import { useLocalSearchParams } from 'expo-router';

import PlanosScreen from '~/screens/assinaturas/PlanosScreen';

export default function AssinaturasIndexRoute() {
  const { all } = useLocalSearchParams<{ all?: string }>();
  return <PlanosScreen showAll={all === '1'} />;
}
