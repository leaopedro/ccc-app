// Whether the root layout mounts StripeProvider.
//
// Until 2026-08-29 this was `Platform.OS !== 'ios' && stripeKey`, under canon
// §F8.16. That canon entry is superseded: it cited a guideline that no longer
// says what it was quoted as saying (3.1.5 is "Cryptocurrencies" today), and
// the live text — 3.1.3(e), Goods and Services Outside of the App — requires
// purchase methods OTHER than in-app purchase for physical goods consumed
// outside the app. The only condition left is having a key to mount with.
export const shouldMountStripeProvider = (args: { platform: string; stripeKey: string }): boolean =>
  args.stripeKey.length > 0;
