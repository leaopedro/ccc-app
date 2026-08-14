import type { BoxView } from '@ccc/shared/box';

import { caixaCopy } from '~/copy/caixa';

export type BoxPayResult =
  | 'ok'
  | 'locked'
  | 'not_awaiting'
  | 'not_eligible'
  | 'not_found'
  | 'unavailable'
  | 'error';

export type PayErrorFeedback = { kind: 'toast_home' | 'retry'; message: string };

export function mapPayError(result: Exclude<BoxPayResult, 'ok'>): PayErrorFeedback {
  switch (result) {
    case 'locked':
    case 'not_awaiting':
    case 'not_eligible':
    case 'not_found':
      return { kind: 'toast_home', message: caixaCopy.pay.closedBudgetOnly };
    case 'unavailable':
    case 'error':
      return { kind: 'retry', message: caixaCopy.pay.error };
  }
}

export function boxPayOutcome(box: BoxView): 'paid' | 'closed_budget_only' | 'pending' {
  if (box.status === 'ready' && box.orderId !== null) return 'paid';
  if ((box.status === 'ready' || box.status === 'skipped') && box.orderId === null) {
    return 'closed_budget_only';
  }
  return 'pending';
}
