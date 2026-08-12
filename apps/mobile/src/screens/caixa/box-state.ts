import type { BoxStatus, BoxView } from '@ccc/shared/box';

import { caixaCopy } from '~/copy/caixa';

export function homeVariant(
  status: BoxStatus,
): 'open' | 'skipped' | 'awaiting_payment' | 'ready' | 'post_cutoff' {
  if (status === 'cancelled') {
    return 'skipped';
  }
  return status;
}

export interface BudgetMeterResult {
  usedCents: number;
  budgetCents: number;
  overflowCents: number;
  includedCents: number;
  fillRatio: number;
  overflowRatio: number;
}

export function budgetMeter(
  box: Pick<BoxView, 'itemsTotalCents' | 'budgetCents' | 'overflowCents'>,
): BudgetMeterResult {
  const { itemsTotalCents, budgetCents, overflowCents } = box;

  const includedCents = Math.min(itemsTotalCents, budgetCents);

  // Guard against division by zero
  const fillRatio = budgetCents === 0 ? 0 : Math.min(includedCents / budgetCents, 1);
  const overflowRatio = budgetCents === 0 ? 0 : overflowCents / budgetCents;

  return {
    usedCents: itemsTotalCents,
    budgetCents,
    overflowCents,
    includedCents,
    fillRatio,
    overflowRatio,
  };
}

export function hasDroppedLines(box: Pick<BoxView, 'items' | 'partnerItems'>): boolean {
  return (
    box.items.some((item) => !item.included) ||
    box.partnerItems.some((partnerItem) => !partnerItem.included)
  );
}

// A skipped box can only go back to "montando" while the cutoff hasn't
// passed yet — after that the cycle is locked, so the skip stands.
export function canUnskip(cutoffAt: string): boolean {
  return new Date(cutoffAt).getTime() > Date.now();
}

const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });
const monthYearFormatter = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

// cycleKey is a date-only string like "2026-08-01". Parsed as UTC midnight so
// the month never shifts under a local timezone offset.
export function cycleMonthLabel(cycleKey: string): string {
  return monthFormatter.format(new Date(`${cycleKey}T00:00:00Z`));
}

// Same as cycleMonthLabel but includes the year, so history rows spanning
// more than one year don't show ambiguous duplicate month labels (used by
// /caixa/historico, screen 12 — the home screen only ever shows one cycle,
// so it keeps the month-only label).
export function cycleMonthYearLabel(cycleKey: string): string {
  return monthYearFormatter.format(new Date(`${cycleKey}T00:00:00Z`));
}

// PT-BR label for a history entry's status — copy lives in caixaCopy so this
// stays a pure lookup (used by the /caixa/historico list, screen 12).
export function boxStatusLabel(status: BoxStatus): string {
  return caixaCopy.history.status[status];
}
