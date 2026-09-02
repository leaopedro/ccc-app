// Whether the "pay this pending order with a card" button may use the native
// Stripe sheet. Until 2026-08-29 this was hardcoded false on iOS under canon
// §F8.16, which left iOS members with a pending card order and no way to pay
// it: selectResumeKind fell through to 'none' and rendered nothing.
export const stripeResumeAvailable = (args: {
  platform: string;
  hasPublishableKey: boolean;
}): boolean => args.hasPublishableKey;
