import { useLocalSearchParams } from 'expo-router';

import PlanoDetalheScreen from '~/screens/assinaturas/PlanoDetalheScreen';
import { useSubscriptionsGate } from '~/screens/assinaturas/useSubscriptionsGate';

// Purchase entry point — reachable by deep link even with the premium tab
// hidden (Task 9 kept `href: null` for exactly this reason). Gated: redirects
// away instead of rendering a plan page whose "Assinar" CTA is hidden.
export default function PlanoDetalheRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { canRender } = useSubscriptionsGate();
  if (!canRender) return null;
  return <PlanoDetalheScreen slug={typeof slug === 'string' ? slug : undefined} />;
}
