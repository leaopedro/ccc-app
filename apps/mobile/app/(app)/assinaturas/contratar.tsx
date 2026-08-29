import { useLocalSearchParams } from 'expo-router';

import ContratarScreen from '~/screens/assinaturas/ContratarScreen';
import { useSubscriptionsGate } from '~/screens/assinaturas/useSubscriptionsGate';

// Purchase entry point — reachable by deep link even with the premium tab
// hidden (Task 9 kept `href: null` for exactly this reason). Gated: redirects
// away instead of rendering a package-builder screen with no CTA.
export default function ContratarRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const { canRender } = useSubscriptionsGate();
  if (!canRender) return null;
  return <ContratarScreen slug={slug} />;
}
