// Pure package arithmetic for the contratação screen. Kept out of the screen so
// the total is unit-testable without rendering React Native.

export type PackageModule = { key: string; monthlyDeltaCents: number };

export type PackageTotals = {
  baseCents: number;
  addonsCents: number;
  totalCents: number;
};

/** Base plan price plus every selected module. Unknown keys are ignored. */
export function packageTotalCents(
  baseCents: number | null,
  modules: PackageModule[],
  selected: Set<string>,
): PackageTotals {
  const base = baseCents ?? 0;
  const addonsCents = modules
    .filter((m) => selected.has(m.key))
    .reduce((sum, m) => sum + m.monthlyDeltaCents, 0);
  return { baseCents: base, addonsCents, totalCents: base + addonsCents };
}
