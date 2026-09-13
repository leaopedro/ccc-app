import BoasVindasScreen from '~/screens/assinaturas/BoasVindasScreen';

// Post-purchase welcome. Deliberately NOT gated by useSubscriptionsGate, for
// the same reason checkout-return is not: reaching this route means a payment
// already completed, and the gate only blocks starting a NEW purchase.
export default function BoasVindasRoute() {
  return <BoasVindasScreen />;
}
