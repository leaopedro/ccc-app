import type { BoxStatus, BoxView } from '@ccc/shared/box';

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

const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });

// cycleKey is a date-only string like "2026-08-01". Parsed as UTC midnight so
// the month never shifts under a local timezone offset.
export function cycleMonthLabel(cycleKey: string): string {
  return monthFormatter.format(new Date(`${cycleKey}T00:00:00Z`));
}
