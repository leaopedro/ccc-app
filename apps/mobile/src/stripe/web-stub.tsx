import type { ReactNode } from 'react';

// Web stub for @stripe/stripe-react-native. The Stripe RN SDK is native-only
// (iOS/Android); importing it on web crashes Metro's web bundle because it
// pulls in codegenNativeCommands unconditionally. We alias the module to this
// file in metro.config.js when platform === 'web'. Purchase flows are not
// usable on web; attempts return a graceful error.
export const StripeProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

const notSupported = { code: 'Unknown', message: 'Pagamento só disponível no app.' } as const;

export const useStripe = () => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  initPaymentSheet: async () => ({ error: notSupported }),
  // eslint-disable-next-line @typescript-eslint/require-await
  presentPaymentSheet: async () => ({ error: notSupported }),
});

export const PaymentSheetError = { Canceled: 'Canceled' } as const;
