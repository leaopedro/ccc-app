import MinhaAssinaturaScreen from '~/screens/assinaturas/MinhaAssinaturaScreen';

// Deliberately NOT gated by useSubscriptionsGate. This route manages an
// EXISTING subscription (view, cancel) — it is not a purchase entry point.
// A member who already pays and deep-links here is not attempting a
// purchase; bouncing them away from their own billing information would be
// hostile. Mirrors the API side, where /billing-portal and /cancel stay open
// on a gated platform for the same reason.
export default MinhaAssinaturaScreen;
