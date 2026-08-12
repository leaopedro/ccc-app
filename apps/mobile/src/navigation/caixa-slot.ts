export type PremiumSlot = 'caixa' | 'assinaturas';

export const resolveCaixaSlot = (args: {
  caixaEnabled: boolean;
  premiumActive: boolean;
}): PremiumSlot => {
  if (!args.caixaEnabled) return 'assinaturas';
  return args.premiumActive ? 'caixa' : 'assinaturas';
};
