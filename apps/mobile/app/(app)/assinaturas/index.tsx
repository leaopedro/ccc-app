import { useLocalSearchParams } from 'expo-router';

import PlanosScreen from '~/screens/assinaturas/PlanosScreen';
import { useSubscriptionsGate } from '~/screens/assinaturas/useSubscriptionsGate';

// Purchase entry point — reachable by deep link even with the premium tab
// hidden (Task 9 kept `href: null` for exactly this reason). Fix round 1
// (Task 10): this route was missed originally. It only hid its per-card
// "Assinar" CTA, leaving a fully browsable pricing page (tier, price, full
// benefit list) with no way to buy on a gated platform. Gated: redirects
// away instead.
export default function AssinaturasIndexRoute() {
  const { all } = useLocalSearchParams<{ all?: string }>();
  const { canRender } = useSubscriptionsGate();
  if (!canRender) return null;
  return <PlanosScreen showAll={all === '1'} />;
}
