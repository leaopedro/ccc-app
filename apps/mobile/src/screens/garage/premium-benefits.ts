// Which benefits the PremiumSheet is allowed to advertise in THIS build.
//
// Final review C2: `garageCopy.garage.premiumBenefits` used to include the
// physical caixa unconditionally, and the sheet rendered it ungated on both
// call sites (app/(app)/garage/index.tsx, screens/garage/GarageHeader.tsx).
// The caixa screens are behind EXPO_PUBLIC_CAIXA_ENABLED, which neither eas
// profile sets, so in a shipped build the member can never opt in, add items
// or set an address — and apps/api/src/workers/box-cutoff.ts skips exactly
// those boxes. The sheet was promising a box the binary cannot deliver.
//
// ContratarScreen.tsx and PlanoDetalheScreen.tsx already gate their caixa card
// on `isCaixaBuildEnabled()`; this is the same gate for the sheet, kept as a
// pure function so the rule is testable without rendering a modal.

export type PremiumBenefit = { title: string; sub: string };

export const premiumSheetBenefits = (args: {
  caixaEnabled: boolean;
  copy: {
    premiumBenefitCaixa: PremiumBenefit;
    premiumBenefits: ReadonlyArray<PremiumBenefit>;
  };
}): ReadonlyArray<PremiumBenefit> =>
  args.caixaEnabled
    ? [args.copy.premiumBenefitCaixa, ...args.copy.premiumBenefits]
    : args.copy.premiumBenefits;
