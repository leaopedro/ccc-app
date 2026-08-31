export type PremiumSlot = 'caixa' | 'assinaturas' | 'none';

export const resolveCaixaSlot = (args: {
  caixaEnabled: boolean;
  premiumActive: boolean;
  subscriptionsEnabled: boolean;
}): PremiumSlot => {
  if (args.caixaEnabled && args.premiumActive) return 'caixa';
  if (args.subscriptionsEnabled) return 'assinaturas';
  return 'none';
};
