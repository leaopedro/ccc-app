import type { Env } from '../../env.js';

export type DevFeeBreakdown = {
  baseAmountCents: number;
  devFeePercent: number;
  devFeeAmountCents: number;
  grossAmountCents: number;
};

export type DevFeeLineInput = {
  baseAmountCents: number;
};

export type DevFeeLineBreakdown<T extends DevFeeLineInput = DevFeeLineInput> = T & {
  devFeeAmountCents: number;
  grossAmountCents: number;
};

export function getDevFeePercent(env: Pick<Env, 'DEV_FEE_PERCENT'>): number {
  return env.DEV_FEE_PERCENT;
}

function roundFeeCents(baseCents: number, percent: number): number {
  if (baseCents <= 0 || percent <= 0) return 0;
  return Math.round((baseCents * percent) / 100);
}

export function applyDevFee(baseAmountCents: number, devFeePercent: number): DevFeeBreakdown {
  const base = Math.max(0, Math.trunc(baseAmountCents));
  const fee = roundFeeCents(base, devFeePercent);
  return {
    baseAmountCents: base,
    devFeePercent,
    devFeeAmountCents: fee,
    grossAmountCents: base + fee,
  };
}

export function applyDevFeeToLines<T extends DevFeeLineInput>(
  lines: T[],
  devFeePercent: number,
): {
  lines: Array<DevFeeLineBreakdown<T>>;
  baseAmountCents: number;
  devFeeAmountCents: number;
  grossAmountCents: number;
  devFeePercent: number;
} {
  const lineBreakdowns = lines.map((line) => {
    const fee = roundFeeCents(line.baseAmountCents, devFeePercent);
    return {
      ...line,
      devFeeAmountCents: fee,
      grossAmountCents: line.baseAmountCents + fee,
    } as DevFeeLineBreakdown<T>;
  });

  const baseAmountCents = lineBreakdowns.reduce((sum, l) => sum + l.baseAmountCents, 0);
  const devFeeAmountCents = lineBreakdowns.reduce((sum, l) => sum + l.devFeeAmountCents, 0);

  return {
    lines: lineBreakdowns,
    baseAmountCents,
    devFeeAmountCents,
    grossAmountCents: baseAmountCents + devFeeAmountCents,
    devFeePercent,
  };
}

export function displayPriceCents(baseCents: number, devFeePercent: number): number {
  const base = Math.max(0, Math.trunc(baseCents));
  return base + roundFeeCents(base, devFeePercent);
}
